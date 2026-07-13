// RemitFlow — ODL Orchestrator Test Suite
package main

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func init() {
	initCorridorRoutes()
}

// ── Health ────────────────────────────────────────────────────────────────────

func TestODL_Health(t *testing.T) {
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/health", nil)
	handleHealth(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["status"] != "healthy" {
		t.Errorf("expected status=healthy, got %v", resp["status"])
	}
}

// ── Bridge Asset Validation ───────────────────────────────────────────────────

func TestODL_ValidBridgeAssets(t *testing.T) {
	valid := []BridgeAsset{BridgeUSDC, BridgeUSDT, BridgeXLM, BridgeXRP}
	for _, a := range valid {
		if !IsValidBridgeAsset(a) {
			t.Errorf("expected %s to be valid bridge asset", a)
		}
	}
	if IsValidBridgeAsset("INVALID") {
		t.Error("INVALID should not be a valid bridge asset")
	}
}

// ── Corridor Routes ───────────────────────────────────────────────────────────

func TestODL_CorridorRoutesInitialized(t *testing.T) {
	store.mu.RLock()
	count := len(store.routes)
	store.mu.RUnlock()
	if count == 0 {
		t.Error("corridor routes should be initialized")
	}
	t.Logf("Initialized %d corridor routes", count)
}

func TestODL_GetOptimalRoute_KnownCorridor(t *testing.T) {
	route, err := GetOptimalRoute("USD", "NGN")
	if err != nil {
		t.Fatalf("expected route for USD→NGN, got error: %v", err)
	}
	if route.BridgeAsset == "" {
		t.Error("route must have a bridge asset")
	}
	if route.Provider == "" {
		t.Error("route must have a provider")
	}
	if route.EstimatedCost <= 0 {
		t.Error("route must have a positive estimated cost")
	}
	if route.Liquidity <= 0 {
		t.Error("route must have positive liquidity")
	}
}

func TestODL_GetOptimalRoute_UnknownCorridor(t *testing.T) {
	_, err := GetOptimalRoute("XYZ", "ABC")
	if err == nil {
		t.Error("unknown corridor should return error")
	}
}

func TestODL_AllRoutesHaveValidBridgeAssets(t *testing.T) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	for key, route := range store.routes {
		if !IsValidBridgeAsset(route.BridgeAsset) {
			t.Errorf("route %s has invalid bridge asset: %s", key, route.BridgeAsset)
		}
	}
}

func TestODL_AllRoutesHavePositiveLiquidity(t *testing.T) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	for key, route := range store.routes {
		if route.Liquidity <= 0 {
			t.Errorf("route %s has non-positive liquidity: %f", key, route.Liquidity)
		}
	}
}

// ── Quote Generation ──────────────────────────────────────────────────────────

func TestODL_GetQuote_ValidRequest(t *testing.T) {
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/api/v1/quote?from=USD&to=NGN&amount=1000", nil)
	handleGetQuote(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var quote ODLQuote
	if err := json.Unmarshal(w.Body.Bytes(), &quote); err != nil {
		t.Fatalf("failed to parse quote: %v", err)
	}
	if quote.QuoteID == "" {
		t.Error("quote must have an ID")
	}
	if quote.ReceiveAmount <= 0 {
		t.Error("receive amount must be positive")
	}
	if quote.TotalFeePct <= 0 {
		t.Error("total fee must be positive")
	}
	if quote.ExpiresAt.Before(time.Now()) {
		t.Error("quote must not be expired immediately")
	}
	if !quote.LockedRate {
		t.Error("quote rate should be locked")
	}
}

func TestODL_GetQuote_MissingParams(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{"missing from", "/api/v1/quote?to=NGN&amount=1000"},
		{"missing to", "/api/v1/quote?from=USD&amount=1000"},
		{"missing amount", "/api/v1/quote?from=USD&to=NGN"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r, _ := http.NewRequest("GET", tt.url, nil)
			handleGetQuote(w, r)
			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d", w.Code)
			}
		})
	}
}

func TestODL_GetQuote_ZeroAmount(t *testing.T) {
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/api/v1/quote?from=USD&to=NGN&amount=0", nil)
	handleGetQuote(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for zero amount, got %d", w.Code)
	}
}

func TestODL_GetQuote_UnknownCorridor(t *testing.T) {
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/api/v1/quote?from=XYZ&to=ABC&amount=1000", nil)
	handleGetQuote(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for unknown corridor, got %d", w.Code)
	}
}

// ── Settlement Initiation ─────────────────────────────────────────────────────

func TestODL_InitiateSettlement_ExpiredQuote(t *testing.T) {
	// Insert an expired quote
	expiredQuote := &ODLQuote{
		QuoteID:       "expired-quote-001",
		FromCurrency:  "USD",
		ToCurrency:    "NGN",
		SendAmount:    1000,
		ReceiveAmount: 1490000,
		BridgeAsset:   BridgeUSDC,
		Provider:      ProviderCircle,
		ExpiresAt:     time.Now().Add(-1 * time.Minute), // expired
		LockedRate:    true,
	}
	store.mu.Lock()
	store.quotes[expiredQuote.QuoteID] = expiredQuote
	store.mu.Unlock()

	body := `{"quote_id":"expired-quote-001","transfer_id":"tx-001","user_id":"user-001"}`
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("POST", "/api/v1/settlements", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	handleInitiateSettlement(w, r)
	if w.Code != http.StatusGone {
		t.Errorf("expected 410 Gone for expired quote, got %d", w.Code)
	}
}

func TestODL_InitiateSettlement_NonExistentQuote(t *testing.T) {
	body := `{"quote_id":"nonexistent-quote","transfer_id":"tx-001","user_id":"user-001"}`
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("POST", "/api/v1/settlements", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	handleInitiateSettlement(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for nonexistent quote, got %d", w.Code)
	}
}

// ── Slippage Calculation ──────────────────────────────────────────────────────

func TestODL_SlippageCalculation(t *testing.T) {
	tests := []struct {
		name        string
		quoted      float64
		actual      float64
		wantSlippage float64
	}{
		{"no slippage", 1500.0, 1500.0, 0.0},
		{"0.5% slippage", 1500.0, 1492.5, 0.5},
		{"1% slippage", 1500.0, 1485.0, 1.0},
		{"negative direction", 1500.0, 1507.5, 0.5}, // favorable slippage
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			slippage := CalculateSlippage(tt.quoted, tt.actual)
			if math.Abs(slippage-tt.wantSlippage) > 0.001 {
				t.Errorf("slippage=%.4f, want %.4f", slippage, tt.wantSlippage)
			}
		})
	}
}

func TestODL_MaxSlippageThreshold(t *testing.T) {
	maxSlippage := GetMaxSlippagePct()
	if maxSlippage <= 0 {
		t.Error("max slippage must be positive")
	}
	if maxSlippage > 5.0 {
		t.Errorf("max slippage %.2f%% seems too high (>5%%)", maxSlippage)
	}
}

// ── List Routes ───────────────────────────────────────────────────────────────

func TestODL_ListRoutes(t *testing.T) {
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/api/v1/routes", nil)
	handleListRoutes(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	count := int(resp["count"].(float64))
	if count == 0 {
		t.Error("should have at least one route")
	}
	t.Logf("Found %d ODL routes", count)
}

// ── Metrics ───────────────────────────────────────────────────────────────────

func TestODL_Metrics(t *testing.T) {
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/metrics", nil)
	handleMetrics(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	requiredMetrics := []string{
		"odl_settlements_total",
		"odl_settlements_successful",
		"odl_settlements_failed",
		"odl_slippage_events_total",
		"odl_success_rate_pct",
	}
	for _, metric := range requiredMetrics {
		if !strings.Contains(body, metric) {
			t.Errorf("metrics response missing: %s", metric)
		}
	}
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

func BenchmarkODL_GetOptimalRoute(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = GetOptimalRoute("USD", "NGN")
	}
}

func BenchmarkODL_SlippageCalculation(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CalculateSlippage(1500.0, 1492.5)
	}
}

func BenchmarkODL_GenerateID(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		generateID("ODL")
	}
}
