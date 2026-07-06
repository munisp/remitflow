package main

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
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Rail represents a payment rail with health metrics
type Rail struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Corridors    []string `json:"corridors"`
	SuccessRate  float64 `json:"success_rate"`
	AvgLatencyMs int64   `json:"avg_latency_ms"`
	MaxAmount    float64 `json:"max_amount"`
	MinAmount    float64 `json:"min_amount"`
	IsHealthy    bool    `json:"is_healthy"`
	CurrentLoad  float64 `json:"current_load"`
	LastFailure  *string `json:"last_failure,omitempty"`
	HealthScore  float64 `json:"health_score"`
}

// FailoverRequest is the input for rail selection
type FailoverRequest struct {
	Corridor string  `json:"corridor"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Priority string  `json:"priority"` // "speed", "cost", "reliability"
}

// FailoverResponse contains the selected rail and fallbacks
type FailoverResponse struct {
	SelectedRail string             `json:"selected_rail"`
	FallbackRails []string          `json:"fallback_rails"`
	Reason       string             `json:"reason"`
	HealthScores map[string]float64 `json:"health_scores"`
}

// HealthCheckResult from monitoring a rail
type HealthCheckResult struct {
	RailID    string    `json:"rail_id"`
	IsHealthy bool      `json:"is_healthy"`
	LatencyMs int64     `json:"latency_ms"`
	CheckedAt time.Time `json:"checked_at"`
	Error     string    `json:"error,omitempty"`
}

var (
	db       *sql.DB
	railsMu  sync.RWMutex
	railsMap map[string]*Rail
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://localhost:5432/remitflow?sslmode=disable"
	}

	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	initSchema()
	loadRailsFromDB()

	// Start health monitoring goroutine
	go monitorRailHealth()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/select", selectRailHandler)
	mux.HandleFunc("/rails", listRailsHandler)
	mux.HandleFunc("/rails/health", railHealthHandler)
	mux.HandleFunc("/failover", executeFailoverHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8316"
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		log.Printf("[multi-rail-failover] Starting on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("[multi-rail-failover] Shutdown complete")
}

func initSchema() {
	schema := `
	CREATE TABLE IF NOT EXISTS rail_registry (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		corridors JSONB NOT NULL DEFAULT '[]',
		max_amount NUMERIC NOT NULL DEFAULT 1000000,
		min_amount NUMERIC NOT NULL DEFAULT 0.01,
		is_active BOOLEAN NOT NULL DEFAULT true,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS rail_health_checks (
		id SERIAL PRIMARY KEY,
		rail_id TEXT NOT NULL REFERENCES rail_registry(id),
		is_healthy BOOLEAN NOT NULL,
		latency_ms BIGINT NOT NULL DEFAULT 0,
		error_message TEXT,
		checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS rail_failover_decisions (
		id SERIAL PRIMARY KEY,
		corridor TEXT NOT NULL,
		amount NUMERIC NOT NULL,
		currency TEXT NOT NULL,
		selected_rail TEXT NOT NULL,
		fallback_rails JSONB NOT NULL DEFAULT '[]',
		reason TEXT,
		health_scores JSONB NOT NULL DEFAULT '{}',
		decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_rail_health_rail ON rail_health_checks(rail_id, checked_at DESC);
	CREATE INDEX IF NOT EXISTS idx_failover_corridor ON rail_failover_decisions(corridor, decided_at DESC);
	`

	if _, err := db.Exec(schema); err != nil {
		log.Printf("[schema] Warning: %v", err)
	}

	// Seed default rails if empty
	var count int
	db.QueryRow("SELECT COUNT(*) FROM rail_registry").Scan(&count)
	if count == 0 {
		seedDefaultRails()
	}
}

func seedDefaultRails() {
	rails := []struct {
		id        string
		name      string
		corridors string
		maxAmount float64
	}{
		{"swift", "SWIFT", `["US-NG","GB-NG","US-KE","US-GH","US-ZA","EU-NG","CA-NG"]`, 1000000},
		{"sepa", "SEPA", `["EU-GB","EU-NG","EU-KE","DE-NG"]`, 500000},
		{"pix", "PIX", `["BR-US","BR-NG","BR-EU"]`, 100000},
		{"upi", "UPI", `["IN-US","IN-GB","IN-NG"]`, 50000},
		{"mobile_money", "Mobile Money", `["US-NG","GB-NG","US-KE","US-GH","KE-NG"]`, 10000},
		{"stablecoin", "Stablecoin Bridge", `["US-NG","GB-NG","US-KE","EU-NG","US-GH","US-ZA"]`, 500000},
		{"rtgs", "RTGS", `["US-ZA","GB-ZA","ZA-NG"]`, 2000000},
		{"fedwire", "Fedwire", `["US-US","US-CA"]`, 10000000},
		{"cips", "CIPS", `["CN-NG","CN-KE","CN-US"]`, 5000000},
		{"papss", "PAPSS", `["NG-KE","NG-GH","KE-GH","GH-ZA"]`, 200000},
	}

	for _, r := range rails {
		db.Exec(
			"INSERT INTO rail_registry (id, name, corridors, max_amount) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT DO NOTHING",
			r.id, r.name, r.corridors, r.maxAmount,
		)
	}
}

func loadRailsFromDB() {
	railsMu.Lock()
	defer railsMu.Unlock()

	railsMap = make(map[string]*Rail)

	rows, err := db.Query(`
		SELECT r.id, r.name, r.corridors, r.max_amount, r.min_amount, r.is_active,
			COALESCE((SELECT AVG(CASE WHEN is_healthy THEN 1.0 ELSE 0.0 END) FROM rail_health_checks WHERE rail_id = r.id AND checked_at > NOW() - INTERVAL '1 hour'), 1.0) as success_rate,
			COALESCE((SELECT AVG(latency_ms) FROM rail_health_checks WHERE rail_id = r.id AND checked_at > NOW() - INTERVAL '1 hour' AND is_healthy = true), 0) as avg_latency
		FROM rail_registry r WHERE r.is_active = true
	`)
	if err != nil {
		log.Printf("[loadRails] Error: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var r Rail
		var corridorsJSON string
		var isActive bool
		if err := rows.Scan(&r.ID, &r.Name, &corridorsJSON, &r.MaxAmount, &r.MinAmount, &isActive, &r.SuccessRate, &r.AvgLatencyMs); err != nil {
			continue
		}
		json.Unmarshal([]byte(corridorsJSON), &r.Corridors)
		r.IsHealthy = r.SuccessRate > 0.5
		r.HealthScore = calculateHealthScore(&r)
		railsMap[r.ID] = &r
	}
}

func calculateHealthScore(r *Rail) float64 {
	// Weighted score: success_rate (0.5) + latency (0.3) + load (0.2)
	latencyScore := math.Max(0, 1.0-float64(r.AvgLatencyMs)/30000.0)
	loadScore := 1.0 - r.CurrentLoad
	return r.SuccessRate*0.5 + latencyScore*0.3 + loadScore*0.2
}

func monitorRailHealth() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		railsMu.RLock()
		rails := make([]*Rail, 0, len(railsMap))
		for _, r := range railsMap {
			rails = append(rails, r)
		}
		railsMu.RUnlock()

		for _, rail := range rails {
			go checkRailHealth(rail)
		}

		// Reload from DB periodically
		loadRailsFromDB()
	}
}

func checkRailHealth(rail *Rail) {
	start := time.Now()
	isHealthy := true
	var errMsg string

	// Simulate health check (in production, ping the actual rail endpoint)
	railEndpoints := map[string]string{
		"swift":        os.Getenv("SWIFT_HEALTH_URL"),
		"sepa":         os.Getenv("SEPA_HEALTH_URL"),
		"mobile_money": os.Getenv("MOMO_HEALTH_URL"),
		"stablecoin":   os.Getenv("STABLECOIN_BRIDGE_HEALTH_URL"),
	}

	if endpoint, ok := railEndpoints[rail.ID]; ok && endpoint != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		req, _ := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			isHealthy = false
			errMsg = err.Error()
		} else {
			resp.Body.Close()
			isHealthy = resp.StatusCode < 500
			if !isHealthy {
				errMsg = fmt.Sprintf("HTTP %d", resp.StatusCode)
			}
		}
	}

	latencyMs := time.Since(start).Milliseconds()

	// Persist health check
	db.Exec(
		"INSERT INTO rail_health_checks (rail_id, is_healthy, latency_ms, error_message) VALUES ($1, $2, $3, $4)",
		rail.ID, isHealthy, latencyMs, errMsg,
	)
}

func selectRailHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req FailoverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	railsMu.RLock()
	defer railsMu.RUnlock()

	// Filter eligible rails for this corridor and amount
	eligible := make([]*Rail, 0)
	for _, rail := range railsMap {
		if !rail.IsHealthy {
			continue
		}
		if req.Amount > rail.MaxAmount || req.Amount < rail.MinAmount {
			continue
		}
		for _, c := range rail.Corridors {
			if c == req.Corridor {
				eligible = append(eligible, rail)
				break
			}
		}
	}

	if len(eligible) == 0 {
		http.Error(w, "No eligible rails for corridor", http.StatusServiceUnavailable)
		return
	}

	// Sort by health score (descending)
	for i := 0; i < len(eligible)-1; i++ {
		for j := i + 1; j < len(eligible); j++ {
			if eligible[j].HealthScore > eligible[i].HealthScore {
				eligible[i], eligible[j] = eligible[j], eligible[i]
			}
		}
	}

	// Apply priority-based selection
	selected := eligible[0]
	switch req.Priority {
	case "speed":
		// Select lowest latency
		for _, r := range eligible {
			if r.AvgLatencyMs < selected.AvgLatencyMs && r.IsHealthy {
				selected = r
			}
		}
	case "cost":
		// Select cheapest (mobile_money < stablecoin < sepa < swift)
		costPriority := map[string]int{"pix": 1, "upi": 2, "mobile_money": 3, "stablecoin": 4, "papss": 5, "sepa": 6, "rtgs": 7, "swift": 8, "fedwire": 9, "cips": 10}
		lowestCost := 999
		for _, r := range eligible {
			if cost, ok := costPriority[r.ID]; ok && cost < lowestCost {
				lowestCost = cost
				selected = r
			}
		}
	}

	fallbacks := make([]string, 0)
	healthScores := make(map[string]float64)
	for _, r := range eligible {
		healthScores[r.ID] = r.HealthScore
		if r.ID != selected.ID {
			fallbacks = append(fallbacks, r.ID)
		}
	}

	resp := FailoverResponse{
		SelectedRail:  selected.ID,
		FallbackRails: fallbacks,
		Reason:        fmt.Sprintf("health_score=%.3f, priority=%s", selected.HealthScore, req.Priority),
		HealthScores:  healthScores,
	}

	// Persist decision
	fallbacksJSON, _ := json.Marshal(fallbacks)
	scoresJSON, _ := json.Marshal(healthScores)
	db.Exec(
		"INSERT INTO rail_failover_decisions (corridor, amount, currency, selected_rail, fallback_rails, reason, health_scores) VALUES ($1, $2, $3, $4, $5, $6, $7)",
		req.Corridor, req.Amount, req.Currency, selected.ID, string(fallbacksJSON), resp.Reason, string(scoresJSON),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func executeFailoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TransferID string `json:"transfer_id"`
		FailedRail string `json:"failed_rail"`
		Corridor   string `json:"corridor"`
		Amount     float64 `json:"amount"`
		Currency   string `json:"currency"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Mark the failed rail as unhealthy
	db.Exec(
		"INSERT INTO rail_health_checks (rail_id, is_healthy, latency_ms, error_message) VALUES ($1, false, 0, $2)",
		req.FailedRail, fmt.Sprintf("Transfer %s failed", req.TransferID),
	)

	// Select next available rail (excluding the failed one)
	railsMu.RLock()
	defer railsMu.RUnlock()

	var nextRail *Rail
	for _, rail := range railsMap {
		if rail.ID == req.FailedRail || !rail.IsHealthy {
			continue
		}
		if req.Amount > rail.MaxAmount {
			continue
		}
		for _, c := range rail.Corridors {
			if c == req.Corridor {
				if nextRail == nil || rail.HealthScore > nextRail.HealthScore {
					nextRail = rail
				}
				break
			}
		}
	}

	if nextRail == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    false,
			"error":      "No fallback rails available",
			"transferId": req.TransferID,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"new_rail":     nextRail.ID,
		"health_score": nextRail.HealthScore,
		"transferId":   req.TransferID,
	})
}

func listRailsHandler(w http.ResponseWriter, r *http.Request) {
	railsMu.RLock()
	defer railsMu.RUnlock()

	rails := make([]*Rail, 0, len(railsMap))
	for _, r := range railsMap {
		rails = append(rails, r)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rails)
}

func railHealthHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT rail_id, is_healthy, latency_ms, error_message, checked_at
		FROM rail_health_checks
		WHERE checked_at > NOW() - INTERVAL '5 minutes'
		ORDER BY checked_at DESC
		LIMIT 50
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var checks []HealthCheckResult
	for rows.Next() {
		var hc HealthCheckResult
		var errMsg sql.NullString
		if err := rows.Scan(&hc.RailID, &hc.IsHealthy, &hc.LatencyMs, &errMsg, &hc.CheckedAt); err != nil {
			continue
		}
		if errMsg.Valid {
			hc.Error = errMsg.String
		}
		checks = append(checks, hc)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(checks)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "multi-rail-failover"})
}
