// persistence.go — Postgres persistence + transactional outbox for
// go-stablecoin-settlement (W19).
//
// The in-memory stores (settlements, webhookEvents, webhookDedup,
// ledgerEntries, p2pClaims) were volatile runtime state, and the Dapr
// dual-write was best-effort: "no outbox table exists — failed writes are
// logged, not queued". PostgreSQL is now the durable layer:
//
//   - Every store mutation writes through to its PG table.
//   - Every failed Dapr/Kafka/OpenSearch side-effect is enqueued into
//     settlement_outbox (durable) and replayed by the outbox relay worker
//     until delivered — no more log-and-drop.
//   - Webhook dedup claims are cross-replica (INSERT ... ON CONFLICT DO
//     NOTHING) when PG is configured.
//   - P2P claim redemption uses a conditional UPDATE ... WHERE status='pending'
//     so two replicas cannot both redeem the same claim.
//   - Maps are warmed from PG at boot.
//
// Fail-closed on money paths (settlement record, claim create/redeem);
// fail-open with loud logs for telemetry side-effects, which are always
// covered by the outbox.
package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

//go:embed migrations/0001_init.sql
var migrationSQL string

var db *sql.DB

func initDB() {
	dsn := getEnv("DATABASE_URL", "")
	if dsn == "" {
		log.Printf("[Settlement] WARN: DATABASE_URL not set — stores are VOLATILE in-memory and Dapr dual-write has NO outbox (dev mode only)")
		return
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("[Settlement] WARN: db open failed: %v — volatile in-memory mode", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Printf("[Settlement] WARN: db ping failed: %v — volatile in-memory mode", err)
		db.Close()
		db = nil
		return
	}
	if getEnv("AUTO_MIGRATE", "") == "1" {
		if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
			log.Fatalf("[Settlement] FATAL: migration failed (fail closed): %v", err)
		}
		log.Printf("[Settlement] migrations applied (AUTO_MIGRATE=1)")
	}
	loadFromDB()
}

func loadFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Settlements (most recent 10k)
	if rows, err := db.QueryContext(ctx,
		`SELECT data FROM settlement_records ORDER BY updated_at DESC LIMIT 10000`); err != nil {
		log.Printf("[Settlement] WARN: settlement boot-load failed: %v", err)
	} else {
		n := 0
		for rows.Next() {
			var data string
			if rows.Scan(&data) != nil {
				continue
			}
			var s SettlementResult
			if json.Unmarshal([]byte(data), &s) != nil {
				continue
			}
			settlements[s.OperationID] = &s
			n++
		}
		rows.Close()
		log.Printf("[Settlement] loaded %d settlement records from Postgres", n)
	}

	// Ledger entries (most recent 10k)
	if rows, err := db.QueryContext(ctx,
		`SELECT data FROM settlement_ledger_entries ORDER BY created_at DESC LIMIT 10000`); err != nil {
		log.Printf("[Settlement] WARN: ledger boot-load failed: %v", err)
	} else {
		n := 0
		for rows.Next() {
			var data string
			if rows.Scan(&data) != nil {
				continue
			}
			var e LedgerEntry
			if json.Unmarshal([]byte(data), &e) != nil {
				continue
			}
			ledgerEntries[e.EntryID] = &e
			n++
		}
		rows.Close()
		log.Printf("[Settlement] loaded %d ledger entries from Postgres", n)
	}

	// Webhook dedup keys still inside the 24h window
	if rows, err := db.QueryContext(ctx,
		`SELECT dedup_key, created_at FROM settlement_webhook_dedup
		 WHERE created_at > NOW() - INTERVAL '24 hours'`); err != nil {
		log.Printf("[Settlement] WARN: dedup boot-load failed: %v", err)
	} else {
		n := 0
		for rows.Next() {
			var k string
			var ts time.Time
			if rows.Scan(&k, &ts) != nil {
				continue
			}
			webhookDedup[k] = ts
			n++
		}
		rows.Close()
		log.Printf("[Settlement] loaded %d webhook dedup keys from Postgres", n)
	}

	// P2P claims
	if rows, err := db.QueryContext(ctx,
		`SELECT data FROM settlement_p2p_claims`); err != nil {
		log.Printf("[Settlement] WARN: claims boot-load failed: %v", err)
	} else {
		n := 0
		for rows.Next() {
			var data string
			if rows.Scan(&data) != nil {
				continue
			}
			var cl P2PClaim
			if json.Unmarshal([]byte(data), &cl) != nil {
				continue
			}
			p2pClaims[cl.ClaimID] = &cl
			n++
		}
		rows.Close()
		log.Printf("[Settlement] loaded %d p2p claims from Postgres", n)
	}
}

// ── Store write-through ─────────────────────────────────────────────────────

func persistSettlementRecord(s *SettlementResult) error {
	if db == nil {
		return nil
	}
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO settlement_records (operation_id, status, data, updated_at)
		 VALUES ($1, $2, $3::jsonb, NOW())
		 ON CONFLICT (operation_id) DO UPDATE SET status = EXCLUDED.status,
		 data = EXCLUDED.data, updated_at = NOW()`,
		s.OperationID, s.Status, string(data))
	return err
}

func persistLedgerEntry(e *LedgerEntry) error {
	if db == nil {
		return nil
	}
	data, err := json.Marshal(e)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO settlement_ledger_entries (entry_id, data, created_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (entry_id) DO UPDATE SET data = EXCLUDED.data`,
		e.EntryID, string(data))
	return err
}

func persistWebhookEvent(ev *WebhookEvent) {
	if db == nil {
		return
	}
	data, err := json.Marshal(ev)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx,
		`INSERT INTO settlement_webhook_events (id, provider, data, created_at)
		 VALUES ($1, $2, $3::jsonb, NOW())
		 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
		ev.ID, ev.Provider, string(data)); err != nil {
		log.Printf("[Settlement] ERROR: webhook event persist failed id=%s: %v", ev.ID, err)
	}
}

// claimWebhookDedup returns true when this instance wins the dedup claim.
// With PG configured the claim is cross-replica (INSERT ON CONFLICT DO
// NOTHING); a claim-query failure fails closed (treated as duplicate-safe:
// the caller must NOT process the webhook when the claim cannot be verified).
func claimWebhookDedup(dedupKey string) (claimed bool, claimErr error) {
	if db == nil {
		webhookMu.Lock()
		defer webhookMu.Unlock()
		if ts, seen := webhookDedup[dedupKey]; seen && time.Since(ts) < webhookDedupTTL {
			return false, nil
		}
		webhookDedup[dedupKey] = time.Now()
		return true, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	res, err := db.ExecContext(ctx,
		`INSERT INTO settlement_webhook_dedup (dedup_key, created_at)
		 VALUES ($1, NOW()) ON CONFLICT (dedup_key) DO NOTHING`, dedupKey)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		webhookMu.Lock()
		webhookDedup[dedupKey] = time.Now()
		webhookMu.Unlock()
		return true, nil
	}
	// Row existed — verify it is still inside the TTL window.
	var createdAt time.Time
	if err := db.QueryRowContext(ctx,
		`SELECT created_at FROM settlement_webhook_dedup WHERE dedup_key = $1`, dedupKey).Scan(&createdAt); err != nil {
		return false, nil // cannot verify age — treat as duplicate (fail closed)
	}
	if time.Since(createdAt) < webhookDedupTTL {
		return false, nil
	}
	// Expired: refresh the claim atomically.
	res, err = db.ExecContext(ctx,
		`UPDATE settlement_webhook_dedup SET created_at = NOW()
		 WHERE dedup_key = $1 AND created_at < NOW() - INTERVAL '24 hours'`, dedupKey)
	if err != nil {
		return false, err
	}
	n, _ = res.RowsAffected()
	return n > 0, nil
}

// releaseWebhookDedup rolls back a claim when the webhook cannot be queued.
func releaseWebhookDedup(dedupKey string) {
	if db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := db.ExecContext(ctx,
			`DELETE FROM settlement_webhook_dedup WHERE dedup_key = $1`, dedupKey); err != nil {
			log.Printf("[Settlement] ERROR: dedup rollback failed key=%s: %v", dedupKey, err)
		}
	}
}

func persistClaim(c *P2PClaim) error {
	if db == nil {
		return nil
	}
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO settlement_p2p_claims (claim_id, status, data, updated_at)
		 VALUES ($1, $2, $3::jsonb, NOW())
		 ON CONFLICT (claim_id) DO UPDATE SET status = EXCLUDED.status,
		 data = EXCLUDED.data, updated_at = NOW()`,
		c.ClaimID, c.Status, string(data))
	return err
}

// redeemClaimPG atomically redeems a pending claim in PG (cross-replica safe).
// Returns (claimed, expired, error).
func redeemClaimPG(claimID string, claimerID int) (bool, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := db.ExecContext(ctx,
		`UPDATE settlement_p2p_claims
		 SET status = 'claimed', updated_at = NOW(),
		     data = data || jsonb_build_object('status','claimed','claimed_by_id',$2::int,'claimed_at',$3::text)
		 WHERE claim_id = $1 AND status = 'pending'
		   AND (data->>'expires_at')::timestamptz > NOW()`,
		claimID, claimerID, now)
	if err != nil {
		return false, false, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return true, false, nil
	}
	// Distinguish expired vs already-claimed vs missing.
	var status string
	var expiresAt string
	err = db.QueryRowContext(ctx,
		`SELECT status, data->>'expires_at' FROM settlement_p2p_claims WHERE claim_id = $1`,
		claimID).Scan(&status, &expiresAt)
	if err == sql.ErrNoRows {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	if status == "pending" {
		if t, perr := time.Parse(time.RFC3339, expiresAt); perr == nil && time.Now().After(t) {
			return false, true, nil
		}
	}
	return false, false, nil
}

// ── Transactional outbox ────────────────────────────────────────────────────

// OutboxKind identifies which side-effect a queued row replays.
const (
	outboxKindLedgerState = "ledger_state" // Dapr tigerbeetle-store write
	outboxKindKafka       = "kafka"        // Dapr pub/sub publish
	outboxKindOpenSearch  = "opensearch"   // OpenSearch index PUT
)

// enqueueOutbox durably queues a failed side-effect for replay. This replaces
// the previous log-and-drop gap (the in-code TODO admitted "no outbox table").
func enqueueOutbox(kind, topic string, payload []byte, cause error) {
	if db == nil {
		log.Printf("[Outbox] ERROR: side-effect failed and NO outbox available (DATABASE_URL unset): kind=%s topic=%s cause=%v", kind, topic, cause)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx,
		`INSERT INTO settlement_outbox (kind, topic, payload, attempts, last_error)
		 VALUES ($1, $2, $3::jsonb, 0, $4)`,
		kind, topic, string(payload), cause.Error()); err != nil {
		log.Printf("[Outbox] ERROR: failed to enqueue %s to %s (payload lost): %v", kind, topic, err)
		return
	}
	log.Printf("[Outbox] queued failed %s write for replay: topic=%s cause=%v", kind, topic, cause)
}

// runOutboxRelay replays pending outbox rows until delivered. Runs for the
// process lifetime; 10s cadence. Rows exceeding 100 attempts are kept but
// skipped from fast-path replay (logged for operator intervention).
func runOutboxRelay(stop <-chan struct{}) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if db != nil {
				replayOutboxBatch()
			}
		}
	}
}

func replayOutboxBatch() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx,
		`SELECT id, kind, topic, payload FROM settlement_outbox
		 WHERE delivered_at IS NULL AND attempts < 100 ORDER BY id LIMIT 100`)
	if err != nil {
		log.Printf("[Outbox] ERROR: relay query failed: %v", err)
		return
	}
	type pendingRow struct {
		id      int64
		kind    string
		topic   string
		payload string
	}
	var pending []pendingRow
	for rows.Next() {
		var p pendingRow
		if rows.Scan(&p.id, &p.kind, &p.topic, &p.payload) == nil {
			pending = append(pending, p)
		}
	}
	rows.Close()

	for _, p := range pending {
		var deliverErr error
		switch p.kind {
		case outboxKindLedgerState:
			deliverErr = deliverLedgerState(p.payload)
		case outboxKindKafka:
			deliverErr = deliverKafka(p.topic, p.payload)
		case outboxKindOpenSearch:
			deliverErr = deliverOpenSearch(p.payload)
		default:
			deliverErr = nil // unknown kind: drop to avoid poison loop
			log.Printf("[Outbox] ERROR: unknown kind %q id=%d — marking delivered to avoid poison loop", p.kind, p.id)
		}
		if deliverErr == nil {
			if _, err := db.ExecContext(ctx,
				`UPDATE settlement_outbox SET delivered_at = NOW() WHERE id = $1`, p.id); err != nil {
				log.Printf("[Outbox] ERROR: mark-delivered failed id=%d: %v", p.id, err)
			}
		} else {
			if _, err := db.ExecContext(ctx,
				`UPDATE settlement_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
				p.id, deliverErr.Error()); err != nil {
				log.Printf("[Outbox] ERROR: attempt bookkeeping failed id=%d: %v", p.id, err)
			}
			log.Printf("[Outbox] replay failed id=%d kind=%s: %v", p.id, p.kind, deliverErr)
		}
	}

	// TTL sweep for dedup keys beyond the 24h window.
	if _, err := db.ExecContext(ctx,
		`DELETE FROM settlement_webhook_dedup WHERE created_at < NOW() - INTERVAL '24 hours'`); err != nil {
		log.Printf("[Outbox] WARN: dedup TTL sweep failed: %v", err)
	}
}

func httpPost(url, body string) (*http.Request, error) {
	req, err := http.NewRequest("POST", url, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func httpPut(url, body string) (*http.Request, error) {
	req, err := http.NewRequest("PUT", url, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

// deliverLedgerState replays a Dapr tigerbeetle-store write. Payload is the
// original [{"key","value"}] array body.
func deliverLedgerState(payload string) error {
	url := "http://localhost:" + daprURL + "/v1.0/state/tigerbeetle-store"
	return doPublishWithRetry(func() (int, error) {
		req, _ := httpPost(url, payload)
		resp, err := daprStateClient.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		return resp.StatusCode, nil
	})
}

// deliverKafka replays a Dapr pub/sub publish.
func deliverKafka(topic, payload string) error {
	url := "http://localhost:" + daprURL + "/v1.0/publish/kafka-pubsub/" + topic
	return doPublishWithRetry(func() (int, error) {
		req, _ := httpPost(url, payload)
		resp, err := daprPublishClient.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		return resp.StatusCode, nil
	})
}

// deliverOpenSearch replays an OpenSearch index PUT. Payload is
// {"index":..., "id":..., "doc":...}.
func deliverOpenSearch(payload string) error {
	var env struct {
		Index string          `json:"index"`
		ID    string          `json:"id"`
		Doc   json.RawMessage `json:"doc"`
	}
	if err := json.Unmarshal([]byte(payload), &env); err != nil {
		return err
	}
	url := openSearchURL + "/" + env.Index + "/_doc/" + env.ID
	return doPublishWithRetry(func() (int, error) {
		req, _ := httpPut(url, string(env.Doc))
		resp, err := openSearchClient.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		return resp.StatusCode, nil
	})
}
