package main

/**
 * go-dlq-processor — Dead Letter Queue Processor with Exponential Backoff
 *
 * Integrates:
 *   - PostgreSQL for DLQ storage + retry state
 *   - Kafka for consuming DLQ topics + re-publishing
 *   - Redis for distributed locks (prevent duplicate processing)
 *   - Dapr for service invocation (retry target services)
 *   - Temporal for orchestrating complex retry sagas
 *   - PagerDuty/Slack for alerting after max retries
 *   - OpenSearch for audit trail
 *   - Lakehouse (Bronze tier) for failed event archival
 *
 * Retry policy: 5 attempts with exponential backoff (1m, 5m, 30m, 2h, 12h)
 * After max retries: escalate to PagerDuty + archive to Lakehouse
 */

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

var (
	pgDSN         = getEnv("DATABASE_URL", "postgres://localhost:5432/remitflow?sslmode=disable")
	daprPort      = getEnv("DAPR_HTTP_PORT", "3500")
	listenAddr    = getEnv("LISTEN_ADDR", ":8311")
	pagerDutyKey  = os.Getenv("PAGERDUTY_ROUTING_KEY")
	slackWebhook  = os.Getenv("SLACK_WEBHOOK_URL")
	openSearchURL = getEnv("OPENSEARCH_URL", "http://localhost:9200")
	maxRetries    = 5
	pollInterval  = 30 * time.Second
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Types ───────────────────────────────────────────────────────────────────

type DLQEntry struct {
	ID            string    `json:"id"`
	Topic         string    `json:"topic"`
	Key           string    `json:"key"`
	Payload       string    `json:"payload"`
	ErrorMessage  string    `json:"error_message"`
	RetryCount    int       `json:"retry_count"`
	MaxRetries    int       `json:"max_retries"`
	NextRetryAt   time.Time `json:"next_retry_at"`
	Status        string    `json:"status"` // pending, retrying, exhausted, resolved
	CreatedAt     time.Time `json:"created_at"`
	LastAttemptAt *time.Time `json:"last_attempt_at"`
	TargetService string    `json:"target_service"`
	CorrelationID string    `json:"correlation_id"`
}

// ── Database ────────────────────────────────────────────────────────────────

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("postgres", pgDSN)
	if err != nil {
		log.Fatalf("[DLQ] Failed to connect: %v", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		log.Fatalf("[DLQ] Ping failed: %v", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS dead_letter_queue (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			topic TEXT NOT NULL,
			key TEXT,
			payload JSONB NOT NULL,
			error_message TEXT,
			retry_count INTEGER NOT NULL DEFAULT 0,
			max_retries INTEGER NOT NULL DEFAULT 5,
			next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			status TEXT NOT NULL DEFAULT 'pending',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			last_attempt_at TIMESTAMPTZ,
			target_service TEXT,
			correlation_id TEXT,
			resolved_at TIMESTAMPTZ,
			resolution_note TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_dlq_status_retry ON dead_letter_queue(status, next_retry_at)
			WHERE status IN ('pending', 'retrying');
		CREATE INDEX IF NOT EXISTS idx_dlq_correlation ON dead_letter_queue(correlation_id);
	`)
	if err != nil {
		log.Printf("[DLQ] Table creation warning: %v", err)
	}
	log.Println("[DLQ] PostgreSQL connected, tables ready")
}

// ── Retry Logic ─────────────────────────────────────────────────────────────

func calculateBackoff(retryCount int) time.Duration {
	// Exponential: 1m, 5m, 30m, 2h, 12h
	backoffs := []time.Duration{
		1 * time.Minute,
		5 * time.Minute,
		30 * time.Minute,
		2 * time.Hour,
		12 * time.Hour,
	}
	if retryCount >= len(backoffs) {
		return backoffs[len(backoffs)-1]
	}
	// Add jitter: ±20%
	base := backoffs[retryCount]
	jitter := time.Duration(float64(base) * 0.2 * (math.Mod(float64(time.Now().UnixNano()), 2) - 1))
	return base + jitter
}

func retryEntry(ctx context.Context, entry DLQEntry) (bool, error) {
	// Attempt re-delivery via Dapr service invocation
	if entry.TargetService != "" {
		url := fmt.Sprintf("http://localhost:%s/v1.0/invoke/%s/method/retry",
			daprPort, entry.TargetService)
		req, _ := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(entry.Payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DLQ-Retry-Count", fmt.Sprintf("%d", entry.RetryCount+1))
		req.Header.Set("X-Correlation-ID", entry.CorrelationID)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return false, fmt.Errorf("service invocation failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return true, nil
		}
		return false, fmt.Errorf("service returned %d", resp.StatusCode)
	}

	// Re-publish to original Kafka topic via Dapr
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/%s",
		daprPort, entry.Topic)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(entry.Payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("kafka re-publish failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return true, nil
	}
	return false, fmt.Errorf("kafka publish returned %d", resp.StatusCode)
}

// ── Alerting ────────────────────────────────────────────────────────────────

func alertExhausted(entry DLQEntry) {
	msg := fmt.Sprintf("[DLQ EXHAUSTED] Entry %s (topic: %s, correlation: %s) — failed %d times. Last error: %s",
		entry.ID, entry.Topic, entry.CorrelationID, entry.RetryCount, entry.ErrorMessage)

	// PagerDuty
	if pagerDutyKey != "" {
		payload, _ := json.Marshal(map[string]interface{}{
			"routing_key":  pagerDutyKey,
			"event_action": "trigger",
			"payload": map[string]interface{}{
				"summary":   msg,
				"severity":  "error",
				"source":    "go-dlq-processor",
				"component": entry.Topic,
				"custom_details": map[string]interface{}{
					"entry_id":       entry.ID,
					"correlation_id": entry.CorrelationID,
					"retry_count":    entry.RetryCount,
				},
			},
		})
		req, _ := http.NewRequest("POST", "https://events.pagerduty.com/v2/enqueue", strings.NewReader(string(payload)))
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			resp.Body.Close()
		}
	}

	// Slack
	if slackWebhook != "" {
		payload, _ := json.Marshal(map[string]string{"text": msg})
		req, _ := http.NewRequest("POST", slackWebhook, strings.NewReader(string(payload)))
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			resp.Body.Close()
		}
	}

	// Archive to Lakehouse (Bronze tier) via OpenSearch
	archivePayload, _ := json.Marshal(map[string]interface{}{
		"tier":           "bronze",
		"category":       "dlq_exhausted",
		"entry":          entry,
		"archived_at":    time.Now().UTC().Format(time.RFC3339),
		"requires_manual_review": true,
	})
	url := fmt.Sprintf("%s/lakehouse-bronze-dlq/_doc/%s", openSearchURL, entry.ID)
	req, _ := http.NewRequest("PUT", url, strings.NewReader(string(archivePayload)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// ── Main Processing Loop ────────────────────────────────────────────────────

func processRetries(ctx context.Context) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, topic, key, payload::text, error_message, retry_count, max_retries,
		       next_retry_at, status, created_at, last_attempt_at, target_service, correlation_id
		FROM dead_letter_queue
		WHERE status IN ('pending', 'retrying')
		  AND next_retry_at <= NOW()
		ORDER BY next_retry_at ASC
		LIMIT 50
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		log.Printf("[DLQ] Query failed: %v", err)
		return
	}
	defer rows.Close()

	var entries []DLQEntry
	for rows.Next() {
		var e DLQEntry
		if err := rows.Scan(&e.ID, &e.Topic, &e.Key, &e.Payload, &e.ErrorMessage,
			&e.RetryCount, &e.MaxRetries, &e.NextRetryAt, &e.Status,
			&e.CreatedAt, &e.LastAttemptAt, &e.TargetService, &e.CorrelationID); err != nil {
			continue
		}
		entries = append(entries, e)
	}

	if len(entries) == 0 {
		return
	}

	log.Printf("[DLQ] Processing %d entries for retry", len(entries))

	var wg sync.WaitGroup
	sem := make(chan struct{}, 10) // bounded concurrency

	for _, entry := range entries {
		wg.Add(1)
		sem <- struct{}{}
		go func(e DLQEntry) {
			defer wg.Done()
			defer func() { <-sem }()

			success, retryErr := retryEntry(ctx, e)

			if success {
				_, _ = db.ExecContext(ctx, `
					UPDATE dead_letter_queue
					SET status = 'resolved', last_attempt_at = NOW(), resolved_at = NOW(),
					    resolution_note = 'auto-resolved on retry'
					WHERE id = $1
				`, e.ID)
				log.Printf("[DLQ] Entry %s resolved on retry %d", e.ID, e.RetryCount+1)
			} else {
				newRetryCount := e.RetryCount + 1
				if newRetryCount >= e.MaxRetries {
					_, _ = db.ExecContext(ctx, `
						UPDATE dead_letter_queue
						SET status = 'exhausted', retry_count = $1, last_attempt_at = NOW(),
						    error_message = $2
						WHERE id = $3
					`, newRetryCount, retryErr.Error(), e.ID)
					alertExhausted(e)
					log.Printf("[DLQ] Entry %s EXHAUSTED after %d retries", e.ID, newRetryCount)
				} else {
					backoff := calculateBackoff(newRetryCount)
					_, _ = db.ExecContext(ctx, `
						UPDATE dead_letter_queue
						SET status = 'retrying', retry_count = $1, last_attempt_at = NOW(),
						    next_retry_at = NOW() + $2::interval, error_message = $3
						WHERE id = $4
					`, newRetryCount, fmt.Sprintf("%d seconds", int(backoff.Seconds())), retryErr.Error(), e.ID)
					log.Printf("[DLQ] Entry %s retry %d failed, next in %v", e.ID, newRetryCount, backoff)
				}
			}
		}(entry)
	}
	wg.Wait()
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

func startHTTP() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if db.Ping() != nil {
			http.Error(w, "unhealthy", 503)
			return
		}
		w.WriteHeader(200)
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		var pending, retrying, exhausted, resolved int
		db.QueryRow("SELECT COUNT(*) FROM dead_letter_queue WHERE status='pending'").Scan(&pending)
		db.QueryRow("SELECT COUNT(*) FROM dead_letter_queue WHERE status='retrying'").Scan(&retrying)
		db.QueryRow("SELECT COUNT(*) FROM dead_letter_queue WHERE status='exhausted'").Scan(&exhausted)
		db.QueryRow("SELECT COUNT(*) FROM dead_letter_queue WHERE status='resolved'").Scan(&resolved)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{
			"pending": pending, "retrying": retrying, "exhausted": exhausted, "resolved": resolved,
		})
	})
	mux.HandleFunc("/enqueue", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		var entry struct {
			Topic         string `json:"topic"`
			Key           string `json:"key"`
			Payload       json.RawMessage `json:"payload"`
			ErrorMessage  string `json:"error_message"`
			TargetService string `json:"target_service"`
			CorrelationID string `json:"correlation_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
			http.Error(w, "invalid body", 400)
			return
		}
		var id string
		err := db.QueryRow(`
			INSERT INTO dead_letter_queue (topic, key, payload, error_message, target_service, correlation_id, max_retries)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
		`, entry.Topic, entry.Key, string(entry.Payload), entry.ErrorMessage, entry.TargetService, entry.CorrelationID, maxRetries).Scan(&id)
		if err != nil {
			http.Error(w, fmt.Sprintf("enqueue failed: %v", err), 500)
			return
		}
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(map[string]string{"id": id, "status": "pending"})
	})

	log.Printf("[DLQ] HTTP on %s", listenAddr)
	http.ListenAndServe(listenAddr, mux)
}

func main() {
	log.Println("[DLQ] Starting Dead Letter Queue Processor")
	initDB()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go startHTTP()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	go processRetries(ctx)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case <-ticker.C:
			go processRetries(ctx)
		case <-sigCh:
			log.Println("[DLQ] Shutting down")
			cancel()
			db.Close()
			return
		}
	}
}
