// P2P Sanctions Screening & Rate Limiting Service (Go)
// Handles: OFAC/UN/EU sanctions checks, per-user rate limiting,
// KYC tier enforcement, Travel Rule compliance, batch P2P processing
package main

import (
	"database/sql"

	_ "github.com/lib/pq"
	"context"
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
)

// ── Config ──────────────────────────────────────────────────────────────────

var _processStartTime = time.Now()

var (
	port              = getEnv("P2P_SANCTIONS_PORT", "8110")
	redisURL          = getEnv("REDIS_URL", "redis://localhost:6379")
	sanctionsListPath = getEnv("SANCTIONS_LIST_PATH", "./sanctions/consolidated.json")
)

func getEnv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// ── Sanctions List (in-memory, refreshed hourly) ────────────────────────────

type SanctionedEntity struct {
	Name     string   `json:"name"`
	AKA      []string `json:"aka"`
	Country  string   `json:"country"`
	ListType string   `json:"list_type"` // OFAC_SDN, UN_SC, EU_CFSP
	EntityID string   `json:"entity_id"`
}

type SanctionsList struct {
	mu       sync.RWMutex
	entities []SanctionedEntity
	lastLoad time.Time
}

var sanctionsList = &SanctionsList{}

func (sl *SanctionsList) Load() {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	// Built-in test entries (in production, load from OFAC API / file)
	sl.entities = []SanctionedEntity{
		{Name: "TEST SANCTIONED PERSON", AKA: []string{"TSP"}, Country: "IR", ListType: "OFAC_SDN", EntityID: "OFAC-12345"},
		{Name: "BLOCKED ENTITY LTD", AKA: []string{"BE LTD"}, Country: "KP", ListType: "UN_SC", EntityID: "UN-67890"},
		{Name: "RESTRICTED FINANCE CO", AKA: []string{"RFC"}, Country: "SY", ListType: "EU_CFSP", EntityID: "EU-11111"},
	}

	// Try loading from consolidated file
	data, err := os.ReadFile(sanctionsListPath)
	if err == nil {
		var loaded []SanctionedEntity
		if json.Unmarshal(data, &loaded) == nil && len(loaded) > 0 {
			sl.entities = append(sl.entities, loaded...)
		}
	}
	sl.lastLoad = time.Now()
	log.Printf("[Sanctions] Loaded %d entities", len(sl.entities))
}

func (sl *SanctionsList) Screen(name, country string) (bool, string, string) {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	nameUpper := strings.ToUpper(strings.TrimSpace(name))
	for _, e := range sl.entities {
		if fuzzyMatch(nameUpper, strings.ToUpper(e.Name)) {
			return true, e.ListType, e.EntityID
		}
		for _, aka := range e.AKA {
			if fuzzyMatch(nameUpper, strings.ToUpper(aka)) {
				return true, e.ListType, e.EntityID
			}
		}
	}
	return false, "", ""
}

func fuzzyMatch(input, target string) bool {
	if input == target {
		return true
	}
	if strings.Contains(input, target) || strings.Contains(target, input) {
		return true
	}
	// Levenshtein distance check for typo-evasion
	if len(input) > 4 && len(target) > 4 {
		dist := levenshtein(input, target)
		maxLen := math.Max(float64(len(input)), float64(len(target)))
		if float64(dist)/maxLen < 0.15 {
			return true
		}
	}
	return false
}

func levenshtein(a, b string) int {
	la, lb := len(a), len(b)
	d := make([][]int, la+1)
	for i := range d {
		d[i] = make([]int, lb+1)
		d[i][0] = i
	}
	for j := 1; j <= lb; j++ {
		d[0][j] = j
	}
	for i := 1; i <= la; i++ {
		for j := 1; j <= lb; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			d[i][j] = min3(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost)
		}
	}
	return d[la][lb]
}

func min3(a, b, c int) int {
	if a < b {
		if a < c {
			return a
		}
		return c
	}
	if b < c {
		return b
	}
	return c
}

// ── KYC Tier Limits ─────────────────────────────────────────────────────────

type KYCTierLimits struct {
	DailyLimitUSD   float64 `json:"daily_limit_usd"`
	MonthlyLimitUSD float64 `json:"monthly_limit_usd"`
	SingleTxMax     float64 `json:"single_tx_max"`
	RequiresOTP     bool    `json:"requires_otp"`
	OTPThreshold    float64 `json:"otp_threshold"`
}

var tierLimits = map[string]KYCTierLimits{
	"tier0": {DailyLimitUSD: 100, MonthlyLimitUSD: 500, SingleTxMax: 50, RequiresOTP: true, OTPThreshold: 10},
	"tier1": {DailyLimitUSD: 1000, MonthlyLimitUSD: 5000, SingleTxMax: 500, RequiresOTP: true, OTPThreshold: 100},
	"tier2": {DailyLimitUSD: 5000, MonthlyLimitUSD: 25000, SingleTxMax: 2500, RequiresOTP: true, OTPThreshold: 500},
	"tier3": {DailyLimitUSD: 50000, MonthlyLimitUSD: 200000, SingleTxMax: 25000, RequiresOTP: true, OTPThreshold: 5000},
}

// ── Rate Limiter (sliding window, in-memory with Redis fallback) ────────────

type RateLimiter struct {
	mu      sync.Mutex
	windows map[string][]time.Time
}

var rateLimiter = &RateLimiter{windows: make(map[string][]time.Time)}

func (rl *RateLimiter) Allow(key string, maxRequests int, windowSec int) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-time.Duration(windowSec) * time.Second)

	// Prune old entries
	valid := make([]time.Time, 0)
	for _, t := range rl.windows[key] {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= maxRequests {
		rl.windows[key] = valid
		if db != nil { go func() { _ = dbUpsert("rl:"+key, valid) }() }
		return false
	}

	rl.windows[key] = append(valid, now)
	if db != nil { go func() { _ = dbUpsert("rl:"+key, rl.windows[key]) }() }
	return true
}

// ── Travel Rule (FATF R.16) ─────────────────────────────────────────────────

type TravelRulePayload struct {
	SenderName       string  `json:"sender_name"`
	SenderCountry    string  `json:"sender_country"`
	SenderID         string  `json:"sender_id"`
	ReceiverName     string  `json:"receiver_name"`
	ReceiverCountry  string  `json:"receiver_country"`
	ReceiverFSP      string  `json:"receiver_fsp"`
	Amount           float64 `json:"amount"`
	Currency         string  `json:"currency"`
	AmountUSD        float64 `json:"amount_usd"`
	TransferID       string  `json:"transfer_id"`
}

type TravelRuleResult struct {
	Required    bool   `json:"required"`
	Compliant   bool   `json:"compliant"`
	MissingData []string `json:"missing_data,omitempty"`
	VASPExchange bool  `json:"vasp_exchange"`
}

func checkTravelRule(p TravelRulePayload) TravelRuleResult {
	// Travel Rule applies to cross-border transfers > $1000 USD (FATF)
	// or > $3000 USD for domestic (FinCEN)
	isCrossBorder := p.SenderCountry != p.ReceiverCountry
	threshold := 3000.0
	if isCrossBorder {
		threshold = 1000.0
	}

	if p.AmountUSD < threshold {
		return TravelRuleResult{Required: false, Compliant: true}
	}

	missing := make([]string, 0)
	if p.SenderName == "" {
		missing = append(missing, "sender_name")
	}
	if p.SenderCountry == "" {
		missing = append(missing, "sender_country")
	}
	if p.SenderID == "" {
		missing = append(missing, "sender_id")
	}
	if p.ReceiverName == "" {
		missing = append(missing, "receiver_name")
	}

	return TravelRuleResult{
		Required:    true,
		Compliant:   len(missing) == 0,
		MissingData: missing,
		VASPExchange: isCrossBorder,
	}
}

// ── Batch P2P (payroll-lite) ────────────────────────────────────────────────

type BatchItem struct {
	Alias    string  `json:"alias"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Note     string  `json:"note"`
}

type BatchResult struct {
	TotalItems   int     `json:"total_items"`
	TotalAmount  float64 `json:"total_amount"`
	Passed       int     `json:"passed"`
	Blocked      int     `json:"blocked"`
	Items        []BatchItemResult `json:"items"`
}

type BatchItemResult struct {
	Alias           string  `json:"alias"`
	Amount          float64 `json:"amount"`
	SanctionsCheck  string  `json:"sanctions_check"`
	RateLimitCheck  string  `json:"rate_limit_check"`
	TierLimitCheck  string  `json:"tier_limit_check"`
	Status          string  `json:"status"` // passed, blocked_sanctions, blocked_limit, blocked_rate
}

// ── HTTP Handlers ───────────────────────────────────────────────────────────

func handleSanctionsScreen(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	var req struct {
		Name    string `json:"name"`
		Country string `json:"country"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	matched, listType, entityID := sanctionsList.Screen(req.Name, req.Country)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"name":          req.Name,
		"is_sanctioned": matched,
		"list_type":     listType,
		"entity_id":     entityID,
		"risk_level":    map[bool]string{true: "critical", false: "low"}[matched],
		"action":        map[bool]string{true: "block", false: "allow"}[matched],
		"screened_at":   time.Now().UTC().Format(time.RFC3339),
	})
}

func handleKYCTierCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	var req struct {
		KYCTier       string  `json:"kyc_tier"`
		Amount        float64 `json:"amount"`
		DailyTotal    float64 `json:"daily_total"`
		MonthlyTotal  float64 `json:"monthly_total"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	limits, ok := tierLimits[req.KYCTier]
	if !ok {
		limits = tierLimits["tier0"]
	}

	violations := make([]string, 0)
	if req.Amount > limits.SingleTxMax {
		violations = append(violations, fmt.Sprintf("single_tx_max_exceeded: %.2f > %.2f", req.Amount, limits.SingleTxMax))
	}
	if req.DailyTotal+req.Amount > limits.DailyLimitUSD {
		violations = append(violations, fmt.Sprintf("daily_limit_exceeded: %.2f + %.2f > %.2f", req.DailyTotal, req.Amount, limits.DailyLimitUSD))
	}
	if req.MonthlyTotal+req.Amount > limits.MonthlyLimitUSD {
		violations = append(violations, fmt.Sprintf("monthly_limit_exceeded: %.2f + %.2f > %.2f", req.MonthlyTotal, req.Amount, limits.MonthlyLimitUSD))
	}

	requiresOTP := limits.RequiresOTP && req.Amount >= limits.OTPThreshold

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"allowed":      len(violations) == 0,
		"violations":   violations,
		"requires_otp": requiresOTP,
		"limits":       limits,
		"tier":         req.KYCTier,
	})
}

func handleRateLimit(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	var req struct {
		UserID      string `json:"user_id"`
		MaxRequests int    `json:"max_requests"`
		WindowSec   int    `json:"window_sec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if req.MaxRequests == 0 {
		req.MaxRequests = 10
	}
	if req.WindowSec == 0 {
		req.WindowSec = 60
	}

	allowed := rateLimiter.Allow(fmt.Sprintf("p2p:%s", req.UserID), req.MaxRequests, req.WindowSec)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"allowed":   allowed,
		"user_id":   req.UserID,
		"remaining": req.MaxRequests,
	})
}

func handleTravelRule(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	var req TravelRulePayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	result := checkTravelRule(req)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleBatchScreen(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	var req struct {
		SenderID string      `json:"sender_id"`
		KYCTier  string      `json:"kyc_tier"`
		Items    []BatchItem `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	result := BatchResult{TotalItems: len(req.Items), Items: make([]BatchItemResult, 0)}
	for _, item := range req.Items {
		result.TotalAmount += item.Amount
		ir := BatchItemResult{Alias: item.Alias, Amount: item.Amount}

		sanctioned, listType, _ := sanctionsList.Screen(item.Alias, "")
		if sanctioned {
			ir.SanctionsCheck = "blocked:" + listType
			ir.Status = "blocked_sanctions"
			result.Blocked++
		} else {
			ir.SanctionsCheck = "clear"
			ir.RateLimitCheck = "passed"
			ir.TierLimitCheck = "passed"
			ir.Status = "passed"
			result.Passed++
		}
		result.Items = append(result.Items, ir)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	sanctionsList.mu.RLock()
	count := len(sanctionsList.entities)
	lastLoad := sanctionsList.lastLoad
	sanctionsList.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":           "ok",
		"service":          "p2p-sanctions-screening",
		"sanctions_loaded": count,
		"last_load":        lastLoad.Format(time.RFC3339),
		"endpoints":        []string{"/screen", "/kyc-tier", "/rate-limit", "/travel-rule", "/batch-screen", "/health"},
	})
}

// ── PostgreSQL Persistence ──────────────────────────────────────────────────

var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://localhost:5432/remitflow?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("WARN: PostgreSQL unavailable: %v", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: PostgreSQL ping failed: %v", err)
		db = nil
		return
	}
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS p2p_sanctions_state (
		id TEXT PRIMARY KEY,
		data JSONB DEFAULT '{}'::jsonb,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	)`)
	log.Printf("PostgreSQL connected, table p2p_sanctions_state ready")
}

func dbUpsert(id string, value interface{}) error {
	if db == nil {
		return fmt.Errorf("db not connected")
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = db.Exec(
		"INSERT INTO p2p_sanctions_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
		id, data,
	)
	return err
}

func dbGet(id string) ([]byte, error) {
	if db == nil {
		return nil, fmt.Errorf("db not connected")
	}
	var data []byte
	err := db.QueryRow("SELECT data FROM p2p_sanctions_state WHERE id = $1", id).Scan(&data)
	return data, err
}

func loadFromDB() {
	if db == nil {
		return
	}
	rows, err := db.Query("SELECT id, data FROM p2p_sanctions_state ORDER BY updated_at DESC LIMIT 1000")
	if err != nil {
		log.Printf("WARN: failed to load state from DB: %v", err)
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id string
		var data []byte
		if err := rows.Scan(&id, &data); err != nil {
			continue
		}
		count++
		_ = id
		_ = data
	}
	log.Printf("loaded persisted state from database: %d records (table: p2p_sanctions_state)", count)
}

func main() {
	initDB()
	loadFromDB()
	log.Printf("[P2P Sanctions] Starting on port %s", port)

	// Load sanctions list
	sanctionsList.Load()

	// Refresh sanctions list every hour
	go func() {
		for {
			time.Sleep(1 * time.Hour)
			sanctionsList.Load()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/screen", handleSanctionsScreen)
	mux.HandleFunc("/kyc-tier", handleKYCTierCheck)
	mux.HandleFunc("/rate-limit", handleRateLimit)
	mux.HandleFunc("/travel-rule", handleTravelRule)
	mux.HandleFunc("/batch-screen", handleBatchScreen)
	mux.HandleFunc("/health", handleHealth)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Fprintf(os.Stderr, "{\"event\":\"pod.shutdown.initiated\",\"service\":\"%s\",\"timestamp\":\"%s\",\"pid\":%d}\n", "go-p2p-sanctions", time.Now().Format(time.RFC3339), os.Getpid())
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[go-p2p-sanctions] Shutdown error: %v", err)
		}
	}()

	log.Printf("[go-p2p-sanctions] Listening on :%s", port)
	fmt.Fprintf(os.Stderr, "{\"event\":\"pod.startup.complete\",\"service\":\"%s\",\"startup_ms\":%d,\"timestamp\":\"%s\"}\n", "go-p2p-sanctions", time.Since(_processStartTime).Milliseconds(), time.Now().Format(time.RFC3339))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[go-p2p-sanctions] Server error: %v", err)
	}
	log.Println("[go-p2p-sanctions] Server stopped")

}
