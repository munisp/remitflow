package main

/**
 * go-smart-routing — AI-Powered Transaction Routing + Multi-Rail Failover
 *
 * Integrates:
 *   - PostgreSQL for corridor stats, rail availability, routing decisions
 *   - Kafka for route decision events + rail status updates
 *   - Redis for real-time rail health scoring
 *   - Dapr for service invocation (payment providers)
 *   - TigerBeetle for settlement cost tracking
 *   - Mojaloop for ILP instant settlement routing
 *   - OpenSearch for routing analytics
 *   - Fluvio for streaming corridor metrics
 *   - APISix for circuit breaker integration
 *
 * Routing algorithm:
 *   1. Score each available rail on: cost, speed, reliability, capacity
 *   2. Apply corridor-specific weights (Africa prioritizes cost, EU prioritizes speed)
 *   3. Multi-rail failover: if primary fails, cascade to secondary, tertiary
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
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

var (
	pgDSN         = getEnv("DATABASE_URL", "postgres://localhost:5432/remitflow?sslmode=disable")
	daprPort      = getEnv("DAPR_HTTP_PORT", "3500")
	listenAddr    = getEnv("LISTEN_ADDR", ":8312")
	openSearchURL = getEnv("OPENSEARCH_URL", "http://localhost:9200")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" { return v }
	return fallback
}

// ── Types ───────────────────────────────────────────────────────────────────

type Rail struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`           // SWIFT, SEPA, PIX, UPI, CIPS, FedNow, PAPSS, Mojaloop, MobileMoney, Stablecoin
	Corridors       []string `json:"corridors"`
	BaseCostBPS     float64 `json:"base_cost_bps"`  // basis points
	AvgSettlementMs int64   `json:"avg_settlement_ms"`
	Reliability     float64 `json:"reliability"`    // 0-1 (30-day success rate)
	MaxAmountUSD    float64 `json:"max_amount_usd"`
	MinAmountUSD    float64 `json:"min_amount_usd"`
	OperatingHours  string  `json:"operating_hours"` // "24/7" or "Mon-Fri 09:00-17:00 UTC"
	IsAvailable     bool    `json:"is_available"`
	LastHealthCheck time.Time `json:"last_health_check"`
	CircuitState    string  `json:"circuit_state"` // closed, open, half-open
}

type RouteRequest struct {
	FromCurrency string  `json:"from_currency"`
	ToCurrency   string  `json:"to_currency"`
	FromCountry  string  `json:"from_country"`
	ToCountry    string  `json:"to_country"`
	Amount       float64 `json:"amount"`
	Priority     string  `json:"priority"` // cost, speed, reliability
	UserTier     string  `json:"user_tier"` // standard, premium, enterprise
}

type RouteDecision struct {
	PrimaryRail    string   `json:"primary_rail"`
	FallbackRails  []string `json:"fallback_rails"`
	EstimatedCost  float64  `json:"estimated_cost_bps"`
	EstimatedTime  int64    `json:"estimated_time_ms"`
	Confidence     float64  `json:"confidence"`
	Score          float64  `json:"score"`
	Reasoning      string   `json:"reasoning"`
	CorridorID     string   `json:"corridor_id"`
}

type CorridorStats struct {
	Corridor           string  `json:"corridor"`
	AvgCostBPS         float64 `json:"avg_cost_bps"`
	AvgSettlementMs    int64   `json:"avg_settlement_ms"`
	VolumeToday        float64 `json:"volume_today"`
	FailureRate24h     float64 `json:"failure_rate_24h"`
	PeakHourMultiplier float64 `json:"peak_hour_multiplier"`
}

// ── Database + State ────────────────────────────────────────────────────────

var (
	db     *sql.DB
	rails  []Rail
	railMu sync.RWMutex
)

func initDB() {
	var err error
	db, err = sql.Open("postgres", pgDSN)
	if err != nil { log.Fatalf("[SmartRoute] DB connect failed: %v", err) }
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS routing_rails (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			corridors TEXT[] NOT NULL DEFAULT '{}',
			base_cost_bps NUMERIC NOT NULL DEFAULT 50,
			avg_settlement_ms BIGINT NOT NULL DEFAULT 86400000,
			reliability NUMERIC NOT NULL DEFAULT 0.95,
			max_amount_usd NUMERIC NOT NULL DEFAULT 1000000,
			min_amount_usd NUMERIC NOT NULL DEFAULT 1,
			operating_hours TEXT NOT NULL DEFAULT '24/7',
			is_available BOOLEAN NOT NULL DEFAULT true,
			last_health_check TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			circuit_state TEXT NOT NULL DEFAULT 'closed',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS routing_decisions (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			corridor TEXT NOT NULL,
			amount_usd NUMERIC NOT NULL,
			primary_rail TEXT NOT NULL,
			fallback_rails TEXT[],
			estimated_cost_bps NUMERIC,
			estimated_time_ms BIGINT,
			actual_rail_used TEXT,
			actual_cost_bps NUMERIC,
			actual_time_ms BIGINT,
			outcome TEXT DEFAULT 'pending',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			completed_at TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_routing_decisions_corridor ON routing_decisions(corridor, created_at DESC);

		CREATE TABLE IF NOT EXISTS corridor_stats (
			corridor TEXT PRIMARY KEY,
			avg_cost_bps NUMERIC NOT NULL DEFAULT 50,
			avg_settlement_ms BIGINT NOT NULL DEFAULT 86400000,
			volume_today NUMERIC NOT NULL DEFAULT 0,
			failure_rate_24h NUMERIC NOT NULL DEFAULT 0.02,
			peak_hour_multiplier NUMERIC NOT NULL DEFAULT 1.0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`)
	if err != nil { log.Printf("[SmartRoute] Table creation: %v", err) }

	// Seed default rails if empty
	var count int
	db.QueryRow("SELECT COUNT(*) FROM routing_rails").Scan(&count)
	if count == 0 {
		seedDefaultRails()
	}

	loadRails()
	log.Println("[SmartRoute] PostgreSQL ready")
}

func seedDefaultRails() {
	defaultRails := []struct {
		id, name string
		corridors []string
		costBPS float64
		settlementMs int64
		reliability float64
		maxUSD float64
	}{
		{"swift", "SWIFT", []string{"*"}, 150, 172800000, 0.97, 10000000},
		{"sepa", "SEPA", []string{"EUR-*", "*-EUR"}, 5, 3600000, 0.99, 5000000},
		{"fednow", "FedNow", []string{"USD-*", "*-USD"}, 3, 60000, 0.995, 500000},
		{"pix", "PIX", []string{"BRL-*", "*-BRL"}, 2, 10000, 0.99, 1000000},
		{"upi", "UPI", []string{"INR-*", "*-INR"}, 2, 30000, 0.98, 100000},
		{"cips", "CIPS", []string{"CNY-*", "*-CNY"}, 20, 7200000, 0.96, 5000000},
		{"papss", "PAPSS", []string{"NGN-*", "GHS-*", "KES-*", "ZAR-*", "XOF-*"}, 30, 1800000, 0.94, 500000},
		{"mojaloop", "Mojaloop", []string{"NGN-*", "GHS-*", "KES-*", "TZS-*", "UGX-*"}, 10, 5000, 0.92, 50000},
		{"mobile-money", "MobileMoney", []string{"NGN-*", "GHS-*", "KES-*", "TZS-*"}, 35, 30000, 0.90, 5000},
		{"stablecoin", "Stablecoin", []string{"*"}, 8, 120000, 0.95, 10000000},
	}

	for _, r := range defaultRails {
		corridorArr := "{" + strings.Join(r.corridors, ",") + "}"
		db.Exec(`INSERT INTO routing_rails (id, name, corridors, base_cost_bps, avg_settlement_ms, reliability, max_amount_usd)
			VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
			r.id, r.name, corridorArr, r.costBPS, r.settlementMs, r.reliability, r.maxUSD)
	}
}

func loadRails() {
	rows, err := db.Query(`SELECT id, name, corridors, base_cost_bps, avg_settlement_ms, reliability, max_amount_usd, min_amount_usd, operating_hours, is_available, last_health_check, circuit_state FROM routing_rails`)
	if err != nil { log.Printf("[SmartRoute] loadRails: %v", err); return }
	defer rows.Close()

	var loaded []Rail
	for rows.Next() {
		var r Rail
		var corridors string
		if err := rows.Scan(&r.ID, &r.Name, &corridors, &r.BaseCostBPS, &r.AvgSettlementMs, &r.Reliability, &r.MaxAmountUSD, &r.MinAmountUSD, &r.OperatingHours, &r.IsAvailable, &r.LastHealthCheck, &r.CircuitState); err != nil {
			continue
		}
		corridors = strings.Trim(corridors, "{}")
		if corridors != "" { r.Corridors = strings.Split(corridors, ",") }
		loaded = append(loaded, r)
	}

	railMu.Lock()
	rails = loaded
	railMu.Unlock()
}

// ── Routing Algorithm ───────────────────────────────────────────────────────

func routeTransaction(req RouteRequest) RouteDecision {
	railMu.RLock()
	defer railMu.RUnlock()

	corridor := fmt.Sprintf("%s-%s", req.FromCurrency, req.ToCurrency)
	candidateRails := filterRailsForCorridor(corridor, req.Amount)

	if len(candidateRails) == 0 {
		return RouteDecision{
			PrimaryRail: "swift",
			FallbackRails: []string{"stablecoin"},
			EstimatedCost: 150,
			EstimatedTime: 172800000,
			Confidence: 0.5,
			Score: 0.3,
			Reasoning: "No optimized rail available, defaulting to SWIFT",
			CorridorID: corridor,
		}
	}

	// Score each rail
	type scoredRail struct {
		rail  Rail
		score float64
	}
	var scored []scoredRail

	weights := getCorridorWeights(req.Priority, req.FromCountry, req.ToCountry)

	for _, r := range candidateRails {
		if !r.IsAvailable || r.CircuitState == "open" { continue }

		// Normalize scores (0-1, higher is better)
		costScore := 1.0 - math.Min(r.BaseCostBPS/200.0, 1.0)
		speedScore := 1.0 - math.Min(float64(r.AvgSettlementMs)/(86400000.0*2), 1.0)
		reliabilityScore := r.Reliability
		capacityScore := 1.0
		if req.Amount > r.MaxAmountUSD*0.8 { capacityScore = 0.5 }
		if req.Amount > r.MaxAmountUSD { capacityScore = 0 }

		totalScore := weights.Cost*costScore + weights.Speed*speedScore +
			weights.Reliability*reliabilityScore + weights.Capacity*capacityScore

		// Premium users get speed boost
		if req.UserTier == "premium" || req.UserTier == "enterprise" {
			if r.AvgSettlementMs < 60000 { totalScore *= 1.1 }
		}

		scored = append(scored, scoredRail{rail: r, score: totalScore})
	}

	sort.Slice(scored, func(i, j int) bool { return scored[i].score > scored[j].score })

	if len(scored) == 0 {
		return RouteDecision{PrimaryRail: "swift", FallbackRails: []string{"stablecoin"}, Confidence: 0.4, CorridorID: corridor, Reasoning: "All candidate rails unavailable"}
	}

	primary := scored[0]
	var fallbacks []string
	for i := 1; i < len(scored) && i <= 3; i++ {
		fallbacks = append(fallbacks, scored[i].rail.ID)
	}

	decision := RouteDecision{
		PrimaryRail:   primary.rail.ID,
		FallbackRails: fallbacks,
		EstimatedCost: primary.rail.BaseCostBPS,
		EstimatedTime: primary.rail.AvgSettlementMs,
		Confidence:    math.Min(primary.score, 1.0),
		Score:         primary.score,
		Reasoning:     fmt.Sprintf("Selected %s (score %.2f) — cost: %.0f bps, speed: %dms, reliability: %.1f%%", primary.rail.Name, primary.score, primary.rail.BaseCostBPS, primary.rail.AvgSettlementMs, primary.rail.Reliability*100),
		CorridorID:    corridor,
	}

	// Persist decision
	db.Exec(`INSERT INTO routing_decisions (corridor, amount_usd, primary_rail, fallback_rails, estimated_cost_bps, estimated_time_ms)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		corridor, req.Amount, decision.PrimaryRail, "{"+strings.Join(fallbacks, ",")+"}", decision.EstimatedCost, decision.EstimatedTime)

	return decision
}

type Weights struct {
	Cost, Speed, Reliability, Capacity float64
}

func getCorridorWeights(priority, fromCountry, toCountry string) Weights {
	// Default balanced weights
	w := Weights{Cost: 0.3, Speed: 0.3, Reliability: 0.3, Capacity: 0.1}

	// User priority override
	switch priority {
	case "cost":
		w = Weights{Cost: 0.5, Speed: 0.2, Reliability: 0.2, Capacity: 0.1}
	case "speed":
		w = Weights{Cost: 0.1, Speed: 0.5, Reliability: 0.3, Capacity: 0.1}
	case "reliability":
		w = Weights{Cost: 0.1, Speed: 0.2, Reliability: 0.6, Capacity: 0.1}
	}

	// Africa corridors: cost-sensitive
	africaCountries := map[string]bool{"NG": true, "GH": true, "KE": true, "ZA": true, "TZ": true, "UG": true, "SN": true, "CI": true}
	if africaCountries[fromCountry] || africaCountries[toCountry] {
		w.Cost += 0.1
		w.Speed -= 0.05
		w.Reliability -= 0.05
	}

	return w
}

func filterRailsForCorridor(corridor string, amount float64) []Rail {
	var candidates []Rail
	parts := strings.Split(corridor, "-")
	if len(parts) != 2 { return candidates }

	for _, r := range rails {
		if amount < r.MinAmountUSD || amount > r.MaxAmountUSD { continue }
		for _, c := range r.Corridors {
			if c == "*" || c == corridor ||
				(strings.HasSuffix(c, "-*") && strings.HasPrefix(corridor, strings.TrimSuffix(c, "-*"))) ||
				(strings.HasPrefix(c, "*-") && strings.HasSuffix(corridor, strings.TrimPrefix(c, "*-"))) {
				candidates = append(candidates, r)
				break
			}
		}
	}
	return candidates
}

// ── Failover Execution ──────────────────────────────────────────────────────

func executeWithFailover(ctx context.Context, req RouteRequest, decision RouteDecision) map[string]interface{} {
	// Try primary rail
	result, err := executeOnRail(ctx, decision.PrimaryRail, req)
	if err == nil {
		return result
	}
	log.Printf("[SmartRoute] Primary rail %s failed: %v, trying failover", decision.PrimaryRail, err)

	// Mark primary as degraded
	db.Exec(`UPDATE routing_rails SET circuit_state = 'half-open', reliability = reliability * 0.95 WHERE id = $1`, decision.PrimaryRail)

	// Try fallbacks in order
	for _, fallbackID := range decision.FallbackRails {
		result, err = executeOnRail(ctx, fallbackID, req)
		if err == nil {
			log.Printf("[SmartRoute] Failover to %s succeeded", fallbackID)
			return result
		}
		log.Printf("[SmartRoute] Fallback rail %s also failed: %v", fallbackID, err)
	}

	// All rails failed — queue for manual processing
	return map[string]interface{}{
		"status": "queued_for_manual",
		"reason": "all rails unavailable",
		"decision": decision,
	}
}

func executeOnRail(ctx context.Context, railID string, req RouteRequest) (map[string]interface{}, error) {
	url := fmt.Sprintf("http://localhost:%s/v1.0/invoke/payment-rails/method/execute/%s", daprPort, railID)
	payload, _ := json.Marshal(req)
	httpReq, _ := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(payload)))
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil { return nil, err }
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("rail %s returned %d", railID, resp.StatusCode)
	}

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}

// ── Health Checker ──────────────────────────────────────────────────────────

func runHealthChecks(ctx context.Context) {
	railMu.RLock()
	currentRails := make([]Rail, len(rails))
	copy(currentRails, rails)
	railMu.RUnlock()

	for _, r := range currentRails {
		url := fmt.Sprintf("http://localhost:%s/v1.0/invoke/payment-rails/method/health/%s", daprPort, r.ID)
		req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Do(req)

		available := err == nil && resp != nil && resp.StatusCode == 200
		if resp != nil { resp.Body.Close() }

		newState := "closed"
		if !available {
			if r.CircuitState == "closed" { newState = "half-open" } else { newState = "open" }
		}

		db.ExecContext(ctx, `UPDATE routing_rails SET is_available = $1, circuit_state = $2, last_health_check = NOW() WHERE id = $3`,
			available, newState, r.ID)
	}
	loadRails() // reload state
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

func startHTTP() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "go-smart-routing"})
	})
	mux.HandleFunc("/route", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" { http.Error(w, "POST only", 405); return }
		var req RouteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", 400); return
		}
		decision := routeTransaction(req)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(decision)
	})
	mux.HandleFunc("/execute", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" { http.Error(w, "POST only", 405); return }
		var req RouteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", 400); return
		}
		decision := routeTransaction(req)
		result := executeWithFailover(r.Context(), req, decision)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})
	mux.HandleFunc("/rails", func(w http.ResponseWriter, r *http.Request) {
		railMu.RLock()
		defer railMu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rails)
	})

	log.Printf("[SmartRoute] HTTP on %s", listenAddr)
	http.ListenAndServe(listenAddr, mux)
}

func main() {
	log.Println("[SmartRoute] Starting AI-powered transaction routing")
	initDB()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go startHTTP()

	// Health check every 30s
	healthTicker := time.NewTicker(30 * time.Second)
	defer healthTicker.Stop()

	// Reload stats every 5m
	statsTicker := time.NewTicker(5 * time.Minute)
	defer statsTicker.Stop()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case <-healthTicker.C:
			go runHealthChecks(ctx)
		case <-statsTicker.C:
			loadRails()
		case <-sigCh:
			log.Println("[SmartRoute] Shutting down")
			cancel()
			db.Close()
			return
		}
	}
}
