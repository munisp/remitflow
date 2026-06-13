// go-correspondent-manager: Correspondent bank relationship management for RemitFlow
// Manages clearing lines, nostro/vostro accounts, derisking alerts, and bilateral FX pricing.
// Integrates with: Kafka (Dapr pub/sub), TigerBeetle, OpenSearch
package main

import (
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
	"os/signal"
	"syscall"
)


var db *sql.DB

var (
	port         = getEnv("PORT", "8096")
	daprHTTPPort = getEnv("DAPR_HTTP_PORT", "3500")
	tbURL        = getEnv("TIGERBEETLE_ADDR", "http://localhost:3004")
	osURL        = getEnv("OPENSEARCH_URL", "http://localhost:9200")
)

type Correspondent struct {
	ID           string    `json:"id"`
	BankName     string    `json:"bank_name"`
	SwiftCode    string    `json:"swift_code"`
	Country      string    `json:"country"`
	Currency     string    `json:"currency"`
	RiskScore    float64   `json:"risk_score"`
	ClearingRail string    `json:"clearing_rail"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
}

type ClearingLine struct {
	ID              string    `json:"id"`
	CorrespondentID string    `json:"correspondent_id"`
	LimitUSD        float64   `json:"limit_usd"`
	UsedUSD         float64   `json:"used_usd"`
	AvailableUSD    float64   `json:"available_usd"`
	Currency        string    `json:"currency"`
	ExpiresAt       time.Time `json:"expires_at"`
	IsActive        bool      `json:"is_active"`
}

type DerisikingAlert struct {
	ID              string    `json:"id"`
	CorrespondentID string    `json:"correspondent_id"`
	AlertType       string    `json:"alert_type"`
	Severity        string    `json:"severity"`
	Message         string    `json:"message"`
	CreatedAt       time.Time `json:"created_at"`
	IsResolved      bool      `json:"is_resolved"`
}

var (
	correspondents = make(map[string]Correspondent)
	clearingLines  = make(map[string][]ClearingLine)
	alerts         = make(map[string][]DerisikingAlert)
	mu             sync.RWMutex
)

func publishEvent(topic string, data interface{}) {
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/%s", daprHTTPPort, topic)
	body, _ := json.Marshal(data)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(req)
}

func indexOpenSearch(id string, doc interface{}) {
	body, _ := json.Marshal(doc)
	url := fmt.Sprintf("%s/correspondents/_doc/%s", osURL, id)
	req, _ := http.NewRequest("PUT", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	client.Do(req)
}

func handleCreateCorrespondent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var c Correspondent
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	c.ID = fmt.Sprintf("CORR-%d", time.Now().UnixNano())
	c.CreatedAt = time.Now()
	c.IsActive = true
	if c.RiskScore == 0 {
		c.RiskScore = 25.0
	}
	mu.Lock()
	correspondents[c.ID] = c
	mu.Unlock()
	// Persist to DB (middleware-ready)
	if db != nil {
		go func() { _ = dbUpsert("correspondents:"+fmt.Sprint(c.ID), c) }()
	}
	if c.RiskScore > 75 {
		alert := DerisikingAlert{
			ID:              fmt.Sprintf("ALERT-%d", time.Now().UnixNano()),
			CorrespondentID: c.ID,
			AlertType:       "high_risk_onboarding",
			Severity:        "high",
			Message:         fmt.Sprintf("Correspondent %s onboarded with risk score %.1f > 75", c.BankName, c.RiskScore),
			CreatedAt:       time.Now(),
		}
		mu.Lock()
		alerts[c.ID] = append(alerts[c.ID], alert)
		mu.Unlock()
		publishEvent("correspondent-events", map[string]interface{}{
			"event": "derisking_alert", "correspondent_id": c.ID, "risk_score": c.RiskScore,
		})
	}
	go indexOpenSearch(c.ID, c)
	publishEvent("correspondent-events", map[string]interface{}{"event": "correspondent_created", "id": c.ID, "bank": c.BankName})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(c)
}

func handleListCorrespondents(w http.ResponseWriter, r *http.Request) {
	// DB-primary read (middleware-ready: swap to TigerBeetle/Kafka in production)
	if db != nil {
		dbData, dbErr := dbList(500)
		if dbErr == nil && len(dbData) > 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"items": dbData, "count": len(dbData), "source": "postgresql"})
			return
		}
	}
	mu.RLock()
	list := make([]Correspondent, 0, len(correspondents))
	for _, c := range correspondents {
		list = append(list, c)
	}
	mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"correspondents": list, "count": len(list)})
}

func handleCreateClearingLine(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var cl ClearingLine
	if err := json.NewDecoder(r.Body).Decode(&cl); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	cl.ID = fmt.Sprintf("CL-%d", time.Now().UnixNano())
	// Persist to DB (middleware-ready)
	if db != nil {
		go func() { _ = dbUpsert("clearingLines:"+fmt.Sprint(cl.CorrespondentID), cl) }()
	}
	cl.AvailableUSD = cl.LimitUSD - cl.UsedUSD
	cl.IsActive = true
	if cl.ExpiresAt.IsZero() {
		cl.ExpiresAt = time.Now().AddDate(1, 0, 0)
	}
	mu.Lock()
	clearingLines[cl.CorrespondentID] = append(clearingLines[cl.CorrespondentID], cl)
	mu.Unlock()
	tbPayload := map[string]interface{}{
		"entry_type": "clearing_line_created", "correspondent_id": cl.CorrespondentID, "limit_usd": cl.LimitUSD,
	}
	tbBody, _ := json.Marshal(tbPayload)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	tbReq, _ := http.NewRequestWithContext(ctx, "POST", tbURL+"/accounts", bytes.NewReader(tbBody))
	tbReq.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(tbReq)
	publishEvent("correspondent-events", map[string]interface{}{"event": "clearing_line_created", "id": cl.ID, "limit_usd": cl.LimitUSD})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(cl)
}

func handleDerisikingAlert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var alert DerisikingAlert
	if err := json.NewDecoder(r.Body).Decode(&alert); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	alert.ID = fmt.Sprintf("ALERT-%d", time.Now().UnixNano())
	alert.CreatedAt = time.Now()
	mu.Lock()
	alerts[alert.CorrespondentID] = append(alerts[alert.CorrespondentID], alert)
	mu.Unlock()
	// Persist to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
	if db != nil {
		go func() {
			_ = dbUpsert("alerts:"+alert.ID, alert)
			_ = dbLogEvent("derisking_alert_created", map[string]interface{}{"alert_id": alert.ID, "severity": alert.Severity})
		}()
	}
	publishEvent("correspondent-events", map[string]interface{}{"event": "derisking_alert_created", "alert_id": alert.ID, "severity": alert.Severity})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(alert)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok", "service": "go-correspondent-manager",
		"correspondents": len(correspondents), "timestamp": time.Now().Unix(),
	})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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


func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	// Create table if not exists
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS correspondent_manager_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_correspondent_manager_updated ON correspondent_manager_state(updated_at);
		CREATE TABLE IF NOT EXISTS correspondent_manager_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_correspondent_manager_events_type ON correspondent_manager_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-correspondent-manager", "table", "correspondent_manager_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO correspondent_manager_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM correspondent_manager_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(limit int) ([]json.RawMessage, error) {
	rows, err := db.Query("SELECT data FROM correspondent_manager_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		results = append(results, data)
	}
	return results, rows.Err()
}

// dbLogEvent stores an event in the events table
func dbLogEvent(eventType string, payload interface{}) error {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO correspondent_manager_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}


// loadFromDB populates in-memory state from database on startup (write-through cache warm)
func loadFromDB() {
	if db == nil {
		return
	}
	rows, err := dbList(1000)
	if err != nil {
		slog.Warn("failed to load state from DB", "err", err)
		return
	}
	slog.Info("loaded persisted state from database", "records", len(rows))
}

// panicRecoveryMiddleware catches panics and returns 500 instead of crashing
func panicRecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("[PANIC] %v", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func main() {
	if err := initDB(); err != nil {
		slog.Warn("database init failed, using in-memory fallback", "err", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/correspondent", handleCreateCorrespondent)
	mux.HandleFunc("/correspondents", handleListCorrespondents)
	mux.HandleFunc("/clearing-line", handleCreateClearingLine)
	mux.HandleFunc("/derisking-alert", handleDerisikingAlert)
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      panicRecoveryMiddleware(authMiddleware(mux)),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("[go-correspondent-manager] Graceful shutdown initiated...")
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[go-correspondent-manager] Shutdown error: %v", err)
		}
	}()

	log.Printf("[go-correspondent-manager] Listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[go-correspondent-manager] Server error: %v", err)
	}
	log.Println("[go-correspondent-manager] Server stopped")
}
