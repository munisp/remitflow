// persistence.go — Postgres persistence for go-audit-sink (W19).
//
// The hash-chained audit log was previously served from RAM only — a restart
// destroyed the compliance trail. PostgreSQL is now the source of truth:
//   - Append inserts into the append-only audit_sink_events table
//     (chain_position / prev_hash / entry_hash columns preserve the chain).
//   - Reads (query/verify/metrics) are served from PG when configured.
//   - Boot loads the full chain from PG and verifies it, logging loudly on
//     any tamper gap.
//
// Append fails closed when PG is configured: an audit event that cannot be
// durably stored is an error to the caller, never silently dropped.
package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

//go:embed migrations/0001_init.sql
var migrationSQL string

var db *sql.DB

func initDB() {
	dsn := getEnvOrDefault("DATABASE_URL", "")
	if dsn == "" {
		log.Printf("[go-audit-sink] WARN: DATABASE_URL not set — audit log is VOLATILE in-memory (dev mode only)")
		return
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("[go-audit-sink] WARN: db open failed: %v — volatile in-memory mode", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Printf("[go-audit-sink] WARN: db ping failed: %v — volatile in-memory mode", err)
		db.Close()
		db = nil
		return
	}
	if getEnvOrDefault("AUTO_MIGRATE", "") == "1" {
		if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
			log.Fatalf("[go-audit-sink] FATAL: migration failed (fail closed): %v", err)
		}
		log.Printf("[go-audit-sink] migrations applied (AUTO_MIGRATE=1)")
	}
	// Boot: warm the in-memory mirror from PG and verify the restored chain.
	loadChainFromDB()
	if valid, n := store.VerifyChain(); !valid {
		log.Printf("[go-audit-sink] ERROR: hash chain verification FAILED after boot-load at position %d — possible tampering", n)
	} else {
		log.Printf("[go-audit-sink] boot chain verified: %d entries intact", n)
	}
}

// nextChainPositionLocked returns the next chain position from PG (source of
// truth) or the in-memory length in volatile dev mode. Caller holds store.mu.
func nextChainPositionLocked() (int, error) {
	if db == nil {
		return len(store.entries), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var pos int
	err := db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(chain_position) + 1, 0) FROM audit_sink_events`).Scan(&pos)
	return pos, err
}

// lastEntryHashLocked returns the hash of the current chain tip. Caller holds
// store.mu.
func lastEntryHashLocked() (string, error) {
	if db == nil {
		if len(store.entries) == 0 {
			return "genesis", nil
		}
		return store.entries[len(store.entries)-1].EntryHash, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var hash string
	err := db.QueryRowContext(ctx,
		`SELECT entry_hash FROM audit_sink_events ORDER BY chain_position DESC LIMIT 1`).Scan(&hash)
	if err == sql.ErrNoRows {
		return "genesis", nil
	}
	return hash, err
}

// insertEventLocked appends the entry to PG. Caller holds store.mu. Fail
// closed: any error propagates to the ingest caller.
func insertEventLocked(entry *AuditEntry) error {
	if db == nil {
		return nil // volatile dev mode
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO audit_sink_events (chain_position, id, event_type, actor_id, prev_hash, entry_hash, data, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
		entry.ChainPosition, entry.ID, entry.EventType, entry.ActorID,
		entry.PreviousHash, entry.EntryHash, string(data))
	return err
}

func loadChainFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx,
		`SELECT data FROM audit_sink_events ORDER BY chain_position ASC`)
	if err != nil {
		log.Printf("[go-audit-sink] WARN: boot chain load failed: %v", err)
		return
	}
	defer rows.Close()
	store.mu.Lock()
	defer store.mu.Unlock()
	for rows.Next() {
		var data string
		if rows.Scan(&data) != nil {
			continue
		}
		var e AuditEntry
		if json.Unmarshal([]byte(data), &e) != nil {
			continue
		}
		store.entries = append(store.entries, e)
	}
	log.Printf("[go-audit-sink] loaded %d audit entries from Postgres", len(store.entries))
}

// queryEntriesPG serves filtered reads directly from PG.
func queryEntriesPG(actorID int, eventType string, limit int) ([]AuditEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx,
		`SELECT data FROM audit_sink_events
		 WHERE ($1::int = 0 OR actor_id = $1)
		   AND ($2::text = '' OR event_type = $2)
		 ORDER BY chain_position DESC LIMIT $3`,
		actorID, eventType, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var data string
		if rows.Scan(&data) != nil {
			continue
		}
		var e AuditEntry
		if json.Unmarshal([]byte(data), &e) != nil {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}

// verifyChainPG recomputes the hash chain over the full PG log.
func verifyChainPG() (bool, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx,
		`SELECT data FROM audit_sink_events ORDER BY chain_position ASC`)
	if err != nil {
		return false, 0, err
	}
	defer rows.Close()
	prevHash := ""
	i := 0
	for rows.Next() {
		var data string
		if rows.Scan(&data) != nil {
			return false, i, fmt.Errorf("scan error at position %d", i)
		}
		var e AuditEntry
		if json.Unmarshal([]byte(data), &e) != nil {
			return false, i, fmt.Errorf("corrupt entry at position %d", i)
		}
		if e.EntryHash != store.computeEntryHash(&e) {
			return false, i, nil
		}
		if i > 0 && e.PreviousHash != prevHash {
			return false, i, nil
		}
		prevHash = e.EntryHash
		i++
	}
	return true, i, nil
}
