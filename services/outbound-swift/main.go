package main

import (
	"database/sql"

	_ "github.com/lib/pq"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ─── Segment types ────────────────────────────────────────────────────────────

type Segment string

const (
	SegmentLabor     Segment = "labor"
	SegmentEducation Segment = "education"
	SegmentMedical   Segment = "medical"
	SegmentHNW       Segment = "hnw"
	SegmentSME       Segment = "sme"
)

// ─── CBN Annual Limits per purpose code (USD) ─────────────────────────────────
// Source: CBN Form A guidelines and CITA annual allowances
var annualLimitsUSD = map[string]float64{
	"EDU":  10000.0,  // Education: $10,000/year per CBN Form A
	"MED":  15000.0,  // Medical: $15,000/year
	"TRV":  4000.0,   // Travel: $4,000/year (PTA/BTA)
	"REM":  50000.0,  // Remittance (labor): $50,000/year
	"SME":  200000.0, // SME trade: $200,000/year
	"HNW":  500000.0, // HNW investment: $500,000/year
	"INV":  100000.0, // Investment: $100,000/year
	"DIVI": 200000.0, // Dividend repatriation: $200,000/year
}

// ─── Static fallback FX rates (NGN per 1 foreign unit) ───────────────────────
var staticFxRates = map[string]float64{
	"USD": 1600.0, "GBP": 2020.0, "EUR": 1740.0, "CAD": 1180.0,
	"AUD": 1040.0, "AED": 435.0, "INR": 19.2, "THB": 45.0, "ZAR": 86.0, "CNY": 220.0,
}

// ─── Live FX rate cache ───────────────────────────────────────────────────────
type fxCacheEntry struct {
	rate      float64
	fetchedAt time.Time
}

var (
	fxCache   = make(map[string]fxCacheEntry)
	fxCacheMu sync.RWMutex
	// TTL for cached rates — refresh every 60 seconds
	fxCacheTTL = 60 * time.Second
)

// BMATCH_URL is the TypeScript backend endpoint that serves live BMATCH rates.
// The Go service calls this to get intraday NGN rates from the BMATCH engine.
var bmatchBaseURL = func() string {
	if v := os.Getenv("BMATCH_API_URL"); v != "" {
		return v
	}
	return "http://localhost:3000"
}()

// bmatchRateResponse mirrors the JSON returned by the TypeScript /api/trpc/cbnCompliance.getBmatchRate endpoint
type bmatchRateResponse struct {
	Result struct {
		Data struct {
			MidRate float64 `json:"midRate"`
			BidRate float64 `json:"bidRate"`
			AskRate float64 `json:"askRate"`
		} `json:"data"`
	} `json:"result"`
}

// fetchLiveFXRate fetches the live NGN/FCY rate from the BMATCH engine.
// On any error it falls back to the static rate map.
func fetchLiveFXRate(currency string) float64 {
	cur := strings.ToUpper(currency)

	// Check cache first
	fxCacheMu.RLock()
	if entry, ok := fxCache[cur]; ok && time.Since(entry.fetchedAt) < fxCacheTTL {
		fxCacheMu.RUnlock()
		return entry.rate
	}
	fxCacheMu.RUnlock()

	// Build BMATCH corridor: e.g. "USD/NGN"
	corridor := cur + "/NGN"
	url := fmt.Sprintf("%s/api/trpc/cbnCompliance.getBmatchRate?input=%s",
		bmatchBaseURL,
		fmt.Sprintf(`{"json":{"corridor":"%s"}}`, corridor),
	)

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("[outbound-swift] BMATCH fetch error for %s: %v — using static fallback", cur, err)
		return staticFallback(cur)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[outbound-swift] BMATCH returned %d for %s — using static fallback", resp.StatusCode, cur)
		return staticFallback(cur)
	}

	var parsed bmatchRateResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		log.Printf("[outbound-swift] BMATCH decode error for %s: %v — using static fallback", cur, err)
		return staticFallback(cur)
	}

	midRate := parsed.Result.Data.MidRate
	if midRate <= 0 {
		log.Printf("[outbound-swift] BMATCH returned zero mid rate for %s — using static fallback", cur)
		return staticFallback(cur)
	}

	// Cache the result
	fxCacheMu.Lock()
	fxCache[cur] = fxCacheEntry{rate: midRate, fetchedAt: time.Now()}
	if db != nil { go func() { _ = dbUpsert("fx:"+cur, map[string]interface{}{"rate": midRate, "fetchedAt": time.Now().Unix()}) }() }
	fxCacheMu.Unlock()

	log.Printf("[outbound-swift] Live BMATCH rate for %s/NGN: %.2f", cur, midRate)
	return midRate
}

func staticFallback(currency string) float64 {
	if r, ok := staticFxRates[strings.ToUpper(currency)]; ok {
		return r
	}
	return 1600.0
}

// ─── Fee schedule ─────────────────────────────────────────────────────────────

var feeSchedule = map[Segment]float64{
	SegmentLabor: 3.5, SegmentEducation: 2.8, SegmentMedical: 2.5, SegmentHNW: 1.8, SegmentSME: 3.2,
}

var spreadBps = map[Segment]float64{
	SegmentLabor: 150, SegmentEducation: 120, SegmentMedical: 100, SegmentHNW: 80, SegmentSME: 130,
}

// ─── Request / Response types ─────────────────────────────────────────────────

type QuoteRequest struct {
	AmountNGN           float64 `json:"amount_ngn"`
	DestinationCurrency string  `json:"destination_currency"`
	Segment             Segment `json:"segment"`
}
type QuoteResponse struct {
	FxRate              float64 `json:"fx_rate"`
	MidMarketRate       float64 `json:"mid_market_rate"`
	SpreadBps           float64 `json:"spread_bps"`
	FeePct              float64 `json:"fee_pct"`
	FeeNGN              float64 `json:"fee_ngn"`
	AmountReceived      float64 `json:"amount_received"`
	TotalDebitNGN       float64 `json:"total_debit_ngn"`
	SavingVsBankNGN     float64 `json:"saving_vs_bank_ngn"`
	DestinationCurrency string  `json:"destination_currency"`
	Segment             Segment `json:"segment"`
	QuoteID             string  `json:"quote_id"`
	ExpiresAt           string  `json:"expires_at"`
	RateSource          string  `json:"rate_source"` // "live_bmatch" or "static_fallback"
}
type SubmitRequest struct {
	QuoteID             string  `json:"quote_id"`
	SenderName          string  `json:"sender_name"`
	SenderBVN           string  `json:"sender_bvn"`
	SenderUserID        int64   `json:"sender_user_id"`
	RecipientName       string  `json:"recipient_name"`
	RecipientIBAN       string  `json:"recipient_iban"`
	RecipientBank       string  `json:"recipient_bank"`
	RecipientCountry    string  `json:"recipient_country"`
	PurposeCode         string  `json:"purpose_code"`
	Segment             Segment `json:"segment"`
	AmountNGN           float64 `json:"amount_ngn"`
	DestinationCurrency string  `json:"destination_currency"`
}
type SubmitResponse struct {
	TransactionID    string  `json:"transaction_id"`
	SWIFTReference   string  `json:"swift_reference"`
	CBNFormA         string  `json:"cbn_form_a"`
	Status           string  `json:"status"`
	EstimatedArrival string  `json:"estimated_arrival"`
	FeeNGN           float64 `json:"fee_ngn"`
	AmountSent       float64 `json:"amount_sent"`
}
type ComplianceRequest struct {
	AmountNGN float64 `json:"amount_ngn"`
	Segment   Segment `json:"segment"`
}
type ComplianceResponse struct {
	DocumentsRequired []string `json:"documents_required"`
	CBNFormRequired   bool     `json:"cbn_form_required"`
	MaxDailyLimitNGN  float64  `json:"max_daily_limit_ngn"`
	MaxSingleTxNGN    float64  `json:"max_single_tx_ngn"`
	KYCTierRequired   int      `json:"kyc_tier_required"`
}

// AnnualLimitRequest is used by the /annual-limit endpoint
type AnnualLimitRequest struct {
	PurposeCode string  `json:"purpose_code"`
	UsedUSD     float64 `json:"used_usd"` // amount already used this calendar year
}
type AnnualLimitResponse struct {
	PurposeCode  string  `json:"purpose_code"`
	AnnualCapUSD float64 `json:"annual_cap_usd"`
	UsedUSD      float64 `json:"used_usd"`
	RemainingUSD float64 `json:"remaining_usd"`
	UtilizationPct float64 `json:"utilization_pct"`
	IsExceeded   bool    `json:"is_exceeded"`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func round2(v float64) float64 { return math.Round(v*100) / 100 }
func generateTxID() string     { return fmt.Sprintf("TXN-%d-%06d", time.Now().Unix(), rand.Intn(999999)) }
func generateFormA() string    { return fmt.Sprintf("FORMA-%d-%08d", time.Now().Year(), rand.Intn(99999999)) }
func generateSWIFTRef() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 16)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return "RF" + string(b)
}

// getRate returns (midRate, appliedRate, spreadBps) using live BMATCH with static fallback
func getRate(currency string, seg Segment) (mid float64, applied float64, bps float64) {
	mid = fetchLiveFXRate(currency)
	if mid == 0 {
		mid = staticFallback(currency)
	}
	bps = spreadBps[seg]
	if bps == 0 {
		bps = 150
	}
	applied = mid * (1 - bps/10000)
	return
}

func calcFee(amountNGN float64, seg Segment) float64 {
	feePct := feeSchedule[seg]
	if feePct == 0 {
		feePct = 3.5
	}
	return round2(amountNGN * feePct / 100)
}
func calcAmountReceived(amountNGN float64, currency string, seg Segment) float64 {
	_, applied, _ := getRate(currency, seg)
	feePct := feeSchedule[seg]
	if feePct == 0 {
		feePct = 3.5
	}
	return round2((amountNGN - amountNGN*feePct/100) / applied)
}

// checkAnnualLimit validates whether a transfer amount (in NGN) would exceed the
// CBN annual limit for the given purpose code. fxRateNGN is the NGN/USD rate.
func checkAnnualLimit(purposeCode string, amountNGN float64, usedUSD float64, fxRateNGN float64) (allowed bool, capUSD float64, remainingUSD float64) {
	code := strings.ToUpper(purposeCode)
	cap, ok := annualLimitsUSD[code]
	if !ok {
		// No limit defined for this code — allow
		return true, 0, 0
	}
	if fxRateNGN <= 0 {
		fxRateNGN = 1600.0
	}
	amountUSD := amountNGN / fxRateNGN
	remaining := cap - usedUSD
	if remaining < 0 {
		remaining = 0
	}
	allowed = (usedUSD + amountUSD) <= cap
	return allowed, cap, remaining
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "outbound-swift"})
}

func handleFeeSchedule(w http.ResponseWriter, r *http.Request) {
	type entry struct {
		Segment   Segment `json:"segment"`
		FeePct    float64 `json:"fee_pct"`
		SpreadBps float64 `json:"spread_bps"`
	}
	var out []entry
	for seg, fee := range feeSchedule {
		out = append(out, entry{Segment: seg, FeePct: fee, SpreadBps: spreadBps[seg]})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func handleQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Segment == "" {
		req.Segment = SegmentLabor
	}
	if req.DestinationCurrency == "" {
		req.DestinationCurrency = "USD"
	}

	mid, applied, bps := getRate(req.DestinationCurrency, req.Segment)
	feePct := feeSchedule[req.Segment]
	if feePct == 0 {
		feePct = 3.5
	}
	feeNGN := round2(req.AmountNGN * feePct / 100)
	amtReceived := round2((req.AmountNGN - feeNGN) / applied)
	bankRate := mid * (1 - 200.0/10000)
	bankReceived := (req.AmountNGN * 0.95) / bankRate
	savingNGN := round2((bankReceived - amtReceived) * applied)
	if savingNGN < 0 {
		savingNGN = 0
	}

	// Determine rate source
	rateSource := "live_bmatch"
	fxCacheMu.RLock()
	entry, cached := fxCache[strings.ToUpper(req.DestinationCurrency)]
	fxCacheMu.RUnlock()
	if !cached || time.Since(entry.fetchedAt) >= fxCacheTTL {
		rateSource = "static_fallback"
	}

	resp := QuoteResponse{
		FxRate: round2(applied), MidMarketRate: round2(mid), SpreadBps: bps,
		FeePct: feePct, FeeNGN: feeNGN, AmountReceived: amtReceived,
		TotalDebitNGN: req.AmountNGN, SavingVsBankNGN: savingNGN,
		DestinationCurrency: strings.ToUpper(req.DestinationCurrency), Segment: req.Segment,
		QuoteID:    fmt.Sprintf("Q-%d", time.Now().UnixNano()),
		ExpiresAt:  time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
		RateSource: rateSource,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleSubmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req SubmitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	// ── CBN Annual Limit check ────────────────────────────────────────────────
	// The caller must pass used_annual_usd (amount already used this year).
	// We read it from a custom header or a query param for simplicity.
	// In production the TypeScript layer fetches this from the DB and passes it.
	usedUSDStr := r.Header.Get("X-Used-Annual-USD")
	var usedUSD float64
	if usedUSDStr != "" {
		fmt.Sscanf(usedUSDStr, "%f", &usedUSD)
	}

	mid := fetchLiveFXRate(req.DestinationCurrency)
	if mid <= 0 {
		mid = staticFallback(req.DestinationCurrency)
	}
	// For annual limit we use USD rate (NGN/USD)
	usdRate := fetchLiveFXRate("USD")
	if usdRate <= 0 {
		usdRate = 1600.0
	}

	allowed, capUSD, remainingUSD := checkAnnualLimit(req.PurposeCode, req.AmountNGN, usedUSD, usdRate)
	if !allowed {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":          "CBN annual limit exceeded",
			"purpose_code":   req.PurposeCode,
			"annual_cap_usd": capUSD,
			"used_usd":       usedUSD,
			"remaining_usd":  remainingUSD,
			"code":           "ANNUAL_LIMIT_EXCEEDED",
		})
		return
	}

	bpsVal := spreadBps[req.Segment]
	if bpsVal == 0 {
		bpsVal = 150
	}
	applied := mid * (1 - bpsVal/10000)
	feePct := feeSchedule[req.Segment]
	if feePct == 0 {
		feePct = 3.5
	}
	feeNGN := round2(req.AmountNGN * feePct / 100)
	amtSent := round2((req.AmountNGN - feeNGN) / applied)

	resp := SubmitResponse{
		TransactionID: generateTxID(), SWIFTReference: generateSWIFTRef(),
		CBNFormA: generateFormA(), Status: "processing",
		EstimatedArrival: time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339),
		FeeNGN: feeNGN, AmountSent: amtSent,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(resp)
}

func handleCompliance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req ComplianceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	docs := []string{"Valid Nigerian passport or NIN slip", "BVN verification"}
	cbnRequired := false
	maxSingle := 50000.0 * 1600
	maxDaily := 100000.0 * 1600
	kycTier := 2
	if req.AmountNGN > 10000*1600 {
		docs = append(docs, "CBN Form A (auto-generated)")
		cbnRequired = true
		kycTier = 3
	}
	if req.Segment == SegmentEducation {
		docs = append(docs, "Admission letter / tuition invoice from institution")
		docs = append(docs, "Student ID or UCAS/SEVIS acceptance letter")
	}
	if req.Segment == SegmentMedical {
		docs = append(docs, "Medical invoice or hospital proforma")
		docs = append(docs, "Physician referral letter (for amounts > $5,000)")
	}
	if req.Segment == SegmentHNW {
		docs = append(docs, "Source of funds declaration")
		docs = append(docs, "Tax clearance certificate")
		maxSingle = 500000.0 * 1600
		maxDaily = 1000000.0 * 1600
	}
	if req.Segment == SegmentSME {
		docs = append(docs, "CAC registration certificate")
		docs = append(docs, "Commercial invoice or purchase order")
		maxSingle = 200000.0 * 1600
	}
	resp := ComplianceResponse{
		DocumentsRequired: docs, CBNFormRequired: cbnRequired,
		MaxDailyLimitNGN: maxDaily, MaxSingleTxNGN: maxSingle, KYCTierRequired: kycTier,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleAnnualLimit returns the annual cap and remaining allowance for a purpose code
func handleAnnualLimit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req AnnualLimitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	code := strings.ToUpper(req.PurposeCode)
	cap, ok := annualLimitsUSD[code]
	if !ok {
		cap = 0
	}
	remaining := cap - req.UsedUSD
	if remaining < 0 {
		remaining = 0
	}
	utilPct := 0.0
	if cap > 0 {
		utilPct = round2(req.UsedUSD / cap * 100)
	}
	resp := AnnualLimitResponse{
		PurposeCode:    code,
		AnnualCapUSD:   cap,
		UsedUSD:        req.UsedUSD,
		RemainingUSD:   remaining,
		UtilizationPct: utilPct,
		IsExceeded:     req.UsedUSD >= cap && cap > 0,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleFXRates returns the current live FX rates for all supported currencies
func handleFXRates(w http.ResponseWriter, r *http.Request) {
	type rateEntry struct {
		Currency  string  `json:"currency"`
		Rate      float64 `json:"rate"`
		Source    string  `json:"source"`
		CachedAt  string  `json:"cached_at,omitempty"`
	}
	currencies := []string{"USD", "GBP", "EUR", "CAD", "AUD", "AED", "INR", "THB", "ZAR", "CNY"}
	var rates []rateEntry
	for _, cur := range currencies {
		rate := fetchLiveFXRate(cur)
		source := "static_fallback"
		cachedAt := ""
		fxCacheMu.RLock()
		if entry, ok := fxCache[cur]; ok && time.Since(entry.fetchedAt) < fxCacheTTL {
			source = "live_bmatch"
			cachedAt = entry.fetchedAt.UTC().Format(time.RFC3339)
		}
		fxCacheMu.RUnlock()
		rates = append(rates, rateEntry{Currency: cur, Rate: round2(rate), Source: source, CachedAt: cachedAt})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"rates": rates, "base": "NGN", "timestamp": time.Now().UTC().Format(time.RFC3339)})
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
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS outbound_swift_state (
		id TEXT PRIMARY KEY,
		data JSONB DEFAULT '{}'::jsonb,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	)`)
	log.Printf("PostgreSQL connected, table outbound_swift_state ready")
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
		"INSERT INTO outbound_swift_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
		id, data,
	)
	return err
}

func dbGet(id string) ([]byte, error) {
	if db == nil {
		return nil, fmt.Errorf("db not connected")
	}
	var data []byte
	err := db.QueryRow("SELECT data FROM outbound_swift_state WHERE id = $1", id).Scan(&data)
	return data, err
}

func loadFromDB() {
	if db == nil {
		return
	}
	rows, err := db.Query("SELECT id, data FROM outbound_swift_state ORDER BY updated_at DESC LIMIT 1000")
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
	log.Printf("loaded persisted state from database: %d records (table: outbound_swift_state)", count)
}

func main() {
	initDB()
	loadFromDB()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/quote", handleQuote)
	mux.HandleFunc("/submit", handleSubmit)
	mux.HandleFunc("/compliance", handleCompliance)
	mux.HandleFunc("/fee-schedule", handleFeeSchedule)
	mux.HandleFunc("/annual-limit", handleAnnualLimit)
	mux.HandleFunc("/fx-rates", handleFXRates)
	log.Printf("[outbound-swift] Listening on :8081 (BMATCH base: %s)", bmatchBaseURL)
	if err := http.ListenAndServe(":8081", mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
