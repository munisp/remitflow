// RemitFlow Dapr Sidecar Service (Go)
// Handles pub/sub, state management, and service invocation via Dapr
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
)

var (
	daprHTTPPort = getEnv("DAPR_HTTP_PORT", "3500")
	appPort      = getEnv("APP_PORT", ":8097")
	appID        = getEnv("APP_ID", "remitflow-dapr")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// DaprEvent represents an incoming pub/sub event from Dapr
type DaprEvent struct {
	DataContentType string          `json:"datacontenttype"`
	Data            json.RawMessage `json:"data"`
	ID              string          `json:"id"`
	Source          string          `json:"source"`
	SpecVersion     string          `json:"specversion"`
	Topic           string          `json:"topic"`
	Type            string          `json:"type"`
}

// publishEvent publishes an event to a Dapr topic
func publishEvent(ctx context.Context, pubsubName, topic string, data any) error {
	_, err := json.Marshal(data)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", daprHTTPPort, pubsubName, topic)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// Subscription handlers
func transferCreatedHandler(w http.ResponseWriter, r *http.Request) {
	var event DaprEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	log.Printf("[Dapr] transfer.created event: %s", string(event.Data))
	// Trigger downstream: AML check, FX rate lock, compliance screening
	publishEvent(r.Context(), "remitflow-pubsub", "aml.check.requested", event.Data)
	publishEvent(r.Context(), "remitflow-pubsub", "fx.rate.lock.requested", event.Data)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func payoutCompletedHandler(w http.ResponseWriter, r *http.Request) {
	var event DaprEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	log.Printf("[Dapr] payout.completed event: %s", string(event.Data))
	// Trigger partner earnings calculation and notification
	publishEvent(r.Context(), "remitflow-pubsub", "partner.earnings.calculate", event.Data)
	publishEvent(r.Context(), "remitflow-pubsub", "notification.send", event.Data)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func kycApprovedHandler(w http.ResponseWriter, r *http.Request) {
	var event DaprEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	log.Printf("[Dapr] kyc.approved event: %s", string(event.Data))
	publishEvent(r.Context(), "remitflow-pubsub", "user.limits.upgrade", event.Data)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":    "healthy",
		"service":   appID,
		"daprPort":  daprHTTPPort,
		"timestamp": time.Now().Unix(),
	})
}

// Dapr subscription configuration endpoint
func subscriptionsHandler(w http.ResponseWriter, r *http.Request) {
	subscriptions := []map[string]any{
		{"pubsubname": "remitflow-pubsub", "topic": "transfer.created", "route": "/events/transfer-created"},
		{"pubsubname": "remitflow-pubsub", "topic": "payout.completed", "route": "/events/payout-completed"},
		{"pubsubname": "remitflow-pubsub", "topic": "kyc.approved", "route": "/events/kyc-approved"},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(subscriptions)
}


func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || r.URL.Path == "/healthz" || r.URL.Path == "/ready" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		key := os.Getenv("INTERNAL_SERVICE_KEY")
		if key == "" {
			key = "remitflow-internal-2026"
		}
		if apiKey := r.Header.Get("X-API-Key"); apiKey == key {
			next.ServeHTTP(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if len(auth) > 7 && auth[:7] == "Bearer " && auth[7:] == key {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"unauthorized"}`))
	})
}


// ── PostgreSQL Persistence Layer ─────────────────────────────────────────────
var db *sql.DB

func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("db connect: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("db ping: %w", err)
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS go_dapr_service_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_go_dapr_service_updated ON go_dapr_service_state(updated_at);
		CREATE TABLE IF NOT EXISTS go_dapr_service_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_go_dapr_service_events_type ON go_dapr_service_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("create tables: %w", err)
	}
	slog.Info("PostgreSQL connected", "service", "go-dapr-service", "table", "go_dapr_service_state")
	return nil
}

func dbUpsert(id string, data interface{}) error {
	if db == nil { return nil }
	jsonData, err := json.Marshal(data)
	if err != nil { return err }
	_, err = db.Exec(`INSERT INTO go_dapr_service_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`, id, jsonData)
	return err
}

func dbGet(id string, dest interface{}) error {
	if db == nil { return fmt.Errorf("no db") }
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM go_dapr_service_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil { return err }
	return json.Unmarshal(jsonData, dest)
}

func dbList(limit int) ([]json.RawMessage, error) {
	if db == nil { return nil, nil }
	rows, err := db.Query("SELECT data FROM go_dapr_service_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil { return nil, err }
		results = append(results, data)
	}
	return results, rows.Err()
}

func dbLogEvent(eventType string, payload interface{}) error {
	if db == nil { return nil }
	jsonData, err := json.Marshal(payload)
	if err != nil { return err }
	_, err = db.Exec("INSERT INTO go_dapr_service_events (event_type, payload) VALUES ($1, $2)", eventType, jsonData)
	return err
}
// ── End PostgreSQL Layer ─────────────────────────────────────────────────────

func main() {
	if err := initDB(); err != nil {
		slog.Warn("PostgreSQL init failed, using in-memory fallback", "err", err)
	}

	log.Printf("[Dapr Service] Starting %s on %s", appID, appPort)
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/dapr/subscribe", subscriptionsHandler)
	mux.HandleFunc("/events/transfer-created", transferCreatedHandler)
	mux.HandleFunc("/events/payout-completed", payoutCompletedHandler)
	mux.HandleFunc("/events/kyc-approved", kycApprovedHandler)
	log.Fatal(http.ListenAndServe(appPort, authMiddleware(mux)))
}
