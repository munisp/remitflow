// RemitFlow — ODL Orchestrator Test Suite
package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
		if route.Provider == ProviderRipple {
			// XRP corridors intentionally carry NO static liquidity figure —
			// real depth/cost comes from configured partner endpoints at quote
			// time, or the corridor reports UNAVAILABLE.
			if route.Liquidity != 0 || route.EstimatedCost != 0 {
				t.Errorf("route %s (XRP) must not carry fabricated cost/liquidity, got cost=%f liquidity=%f",
					key, route.EstimatedCost, route.Liquidity)
			}
			continue
		}
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

// ── Fail-Closed Settlement Honesty ────────────────────────────────────────────

// TestODL_SettlementFailsClosedWithoutRailAdapter asserts that no settlement
// can reach COMPLETED or carry fabricated transaction IDs when no real rail
// adapter is implemented.
func TestODL_SettlementFailsClosedWithoutRailAdapter(t *testing.T) {
	successBefore := successfulSettlements.Load()
	failedBefore := failedSettlements.Load()

	settlement := &ODLSettlement{
		SettlementID:  "test-failclosed-001",
		TransferID:    "tx-test-001",
		QuoteID:       "quote-test-001",
		Status:        StatusPending,
		FromCurrency:  "USD",
		ToCurrency:    "NGN",
		SendAmount:    100,
		ReceiveAmount: 150000,
		BridgeAsset:   BridgeUSDC,
		Provider:      ProviderCircle,
		CreatedAt:     time.Now(),
		AuditTrail:    []AuditEvent{},
	}

	executeODLSettlement(context.Background(), settlement)

	if settlement.Status == StatusCompleted {
		t.Fatal("settlement must NEVER be COMPLETED without real rail execution")
	}
	if settlement.Status != StatusUnavailable {
		t.Errorf("expected UNAVAILABLE, got %s", settlement.Status)
	}
	if settlement.OnRampTxID != "" || settlement.BridgeTxHash != "" || settlement.OffRampTxID != "" {
		t.Error("fabricated transaction IDs must not be attached without a real rail adapter")
	}
	if settlement.CompletedAt != nil {
		t.Error("CompletedAt must not be set for an unavailable settlement")
	}
	if settlement.FailureReason == "" {
		t.Error("failure reason must explain that the rail adapter is not implemented")
	}
	if !strings.Contains(settlement.FailureReason, "rail adapter not implemented") {
		t.Errorf("failure reason should cite the missing rail adapter, got: %s", settlement.FailureReason)
	}
	if successfulSettlements.Load() != successBefore {
		t.Error("successfulSettlements must not increase without real rail execution")
	}
	if failedSettlements.Load() != failedBefore+1 {
		t.Error("unavailable settlement must be counted as failed, not successful")
	}
}

// TestODL_InitiateSettlement_ReportsUnavailable asserts the API response
// explicitly reports the unavailable rail instead of implying settlement.
func TestODL_InitiateSettlement_ReportsUnavailable(t *testing.T) {
	quote := &ODLQuote{
		QuoteID:       "quote-unavailable-001",
		FromCurrency:  "USD",
		ToCurrency:    "KES",
		SendAmount:    500,
		ReceiveAmount: 64500,
		BridgeAsset:   BridgeXRP,
		Provider:      ProviderRipple,
		ExpiresAt:     time.Now().Add(30 * time.Second),
		LockedRate:    true,
	}
	store.mu.Lock()
	store.quotes[quote.QuoteID] = quote
	store.mu.Unlock()

	body := `{"quote_id":"quote-unavailable-001","transfer_id":"tx-002","user_id":"user-001"}`
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("POST", "/api/v1/settlements", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	handleInitiateSettlement(w, r)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when rail adapter is unavailable, got %d", w.Code)
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["status"] != string(StatusUnavailable) {
		t.Errorf("response status must be UNAVAILABLE, got %v", resp["status"])
	}
	if msg, _ := resp["message"].(string); !strings.Contains(msg, "rail adapter not implemented") {
		t.Errorf("response message must state the rail adapter is not implemented, got %v", resp["message"])
	}
}

// ── Slippage Calculation ──────────────────────────────────────────────────────

func TestODL_SlippageCalculation(t *testing.T) {
	tests := []struct {
		name         string
		quoted       float64
		actual       float64
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

// ── XRPL Rail Adapter (fake rippled via httptest; no live network) ───────────

// fakeRippled is an httptest server emulating the rippled JSON-RPC surface the
// adapter uses. It records the request shapes for assertions.
type fakeRippled struct {
	srv *httptest.Server
	mu  sync.Mutex
	// requests records every (method, params) the adapter sent.
	requests []struct {
		Method string
		Params map[string]interface{}
	}
	// behavior knobs
	engineResult string // engine_result for submit
	txValidated  bool   // validated flag for tx lookups
	txHash       string // hash rippled "returns" — adapter must echo it
}

func newFakeRippled(t *testing.T, engineResult string, txValidated bool) *fakeRippled {
	t.Helper()
	f := &fakeRippled{
		engineResult: engineResult,
		txValidated:  txValidated,
		txHash:       "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
	}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string                   `json:"method"`
			Params []map[string]interface{} `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		p := map[string]interface{}{}
		if len(req.Params) > 0 {
			p = req.Params[0]
		}
		f.mu.Lock()
		f.requests = append(f.requests, struct {
			Method string
			Params map[string]interface{}
		}{req.Method, p})
		f.mu.Unlock()

		var result interface{}
		switch req.Method {
		case "account_info":
			result = map[string]interface{}{
				"status": "success",
				"account_data": map[string]interface{}{
					"Account":  "rODLSourceAccount111111111111111111",
					"Balance":  "1000000000",
					"Sequence": 42,
				},
				"ledger_current_index": 900,
			}
		case "fee":
			result = map[string]interface{}{
				"status": "success",
				"drops": map[string]interface{}{
					"median_fee":      "2000",
					"minimum_fee":     "10",
					"open_ledger_fee": "10",
					"base_fee_xrp":    "0.00001",
				},
				"ledger_current_index": 900,
			}
		case "server_state":
			result = map[string]interface{}{
				"status": "success",
				"state": map[string]interface{}{
					"validated_ledger": map[string]interface{}{"seq": 900},
					"server_state":     "full",
				},
			}
		case "sign":
			// Assert server-side signing request shape.
			if p["secret"] == nil {
				t.Error("sign request must carry the seed as 'secret'")
			}
			txj, _ := p["tx_json"].(map[string]interface{})
			if txj == nil || txj["TransactionType"] != "Payment" {
				t.Errorf("sign tx_json must be a Payment, got %v", p["tx_json"])
			}
			result = map[string]interface{}{
				"status":  "success",
				"tx_blob": "SIGNEDBLOB0000",
				"tx_json": map[string]interface{}{
					"Account": "rODLSourceAccount111111111111111111",
					"hash":    f.txHash,
				},
			}
		case "submit":
			if p["tx_blob"] == nil {
				t.Error("submit request must carry tx_blob")
			}
			result = map[string]interface{}{
				"status":                "success",
				"engine_result":         f.engineResult,
				"engine_result_message": "The transaction was applied.",
				"tx_json":               map[string]interface{}{"hash": f.txHash},
				"accepted":              f.engineResult == "tesSUCCESS",
				"ledger_current_index":  901,
			}
		case "tx":
			if p["transaction"] != f.txHash {
				t.Errorf("tx lookup must use the rippled-returned hash, got %v", p["transaction"])
			}
			metaResult := f.engineResult
			result = map[string]interface{}{
				"status":       "success",
				"hash":         f.txHash,
				"validated":    f.txValidated,
				"ledger_index": 902,
				"meta":         map[string]interface{}{"TransactionResult": metaResult},
			}
		default:
			result = map[string]interface{}{
				"status":        "error",
				"error":         "unknownCmd",
				"error_message": "unknown method " + req.Method,
				"error_code":    32,
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"result": result})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func testXRPLConfig(url string) XRPLConfig {
	return XRPLConfig{
		RPCURL:              url,
		Seed:                "sTestSeedDoNotUseOnMainnet",
		Account:             "rODLSourceAccount111111111111111111",
		Destination:         "rOffRampDest22222222222222222222",
		RequestTimeout:      5 * time.Second,
		ConfirmTimeout:      10 * time.Second,
		MaxTransportRetries: 1,
	}
}

func TestXRPL_RailAdapterGating(t *testing.T) {
	// Unconfigured: fail closed.
	t.Setenv("XRPL_RPC_URL", "")
	t.Setenv("XRPL_SEED", "")
	if railAdapterAvailable(ProviderRipple) {
		t.Error("Ripple rail must be unavailable without XRPL_RPC_URL/XRPL_SEED")
	}
	// Other providers never available.
	for _, p := range []ODLProvider{ProviderCircle, ProviderStellar, ProviderPolygon} {
		if railAdapterAvailable(p) {
			t.Errorf("provider %s must remain fail-closed", p)
		}
	}
	// Configured: available.
	t.Setenv("XRPL_RPC_URL", "http://127.0.0.1:1")
	t.Setenv("XRPL_SEED", "sXXX")
	if !railAdapterAvailable(ProviderRipple) {
		t.Error("Ripple rail must be available when XRPL_RPC_URL+XRPL_SEED are set")
	}
}

func TestXRPL_SendPayment_Success(t *testing.T) {
	fake := newFakeRippled(t, "tesSUCCESS", true)
	a := newXRPLAdapter(testXRPLConfig(fake.srv.URL))

	outcome, err := a.SendXRPPayment(context.Background(), "25000000") // 25 XRP
	if err != nil {
		t.Fatalf("SendXRPPayment failed: %v", err)
	}
	if outcome.TxHash != fake.txHash {
		t.Errorf("tx hash must come from rippled, got %q", outcome.TxHash)
	}
	if outcome.EngineResult != "tesSUCCESS" {
		t.Errorf("engine_result = %q", outcome.EngineResult)
	}
	if outcome.LedgerIndex != 902 {
		t.Errorf("ledger index = %d, want 902", outcome.LedgerIndex)
	}
	if outcome.FeeDrops != "2000" {
		t.Errorf("fee = %q, want median_fee 2000", outcome.FeeDrops)
	}

	// Verify the JSON-RPC request sequence and shapes.
	fake.mu.Lock()
	defer fake.mu.Unlock()
	methods := []string{}
	for _, r := range fake.requests {
		methods = append(methods, r.Method)
	}
	wantPrefix := []string{"account_info", "fee", "server_state", "sign", "submit", "tx"}
	if len(methods) < len(wantPrefix) {
		t.Fatalf("too few RPC calls: %v", methods)
	}
	for i, m := range wantPrefix {
		if methods[i] != m {
			t.Errorf("rpc call %d = %s, want %s (all: %v)", i, methods[i], m, methods)
		}
	}
}

func TestXRPL_SendPayment_DestinationTag(t *testing.T) {
	fake := newFakeRippled(t, "tesSUCCESS", true)
	cfg := testXRPLConfig(fake.srv.URL)
	tag := uint32(12345)
	cfg.DestinationTag = &tag
	a := newXRPLAdapter(cfg)

	if _, err := a.SendXRPPayment(context.Background(), "1000000"); err != nil {
		t.Fatalf("SendXRPPayment failed: %v", err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, r := range fake.requests {
		if r.Method == "sign" {
			txj, _ := r.Params["tx_json"].(map[string]interface{})
			if txj["DestinationTag"].(float64) != 12345 {
				t.Errorf("DestinationTag not propagated, got %v", txj["DestinationTag"])
			}
			return
		}
	}
	t.Error("no sign request recorded")
}

func TestXRPL_SendPayment_EngineFailure(t *testing.T) {
	fake := newFakeRippled(t, "tecPATH_PARTIAL", false)
	a := newXRPLAdapter(testXRPLConfig(fake.srv.URL))

	outcome, err := a.SendXRPPayment(context.Background(), "25000000")
	if err == nil {
		t.Fatal("must fail when engine_result != tesSUCCESS")
	}
	if !strings.Contains(err.Error(), "tecPATH_PARTIAL") {
		t.Errorf("error must cite the real engine_result, got %v", err)
	}
	// The outcome still carries the rippled-returned hash for reconciliation.
	if outcome == nil || outcome.TxHash != fake.txHash {
		t.Error("failed submission must still surface the rippled-returned hash")
	}
}

func TestXRPL_SendPayment_RejectsIOUAmount(t *testing.T) {
	fake := newFakeRippled(t, "tesSUCCESS", true)
	a := newXRPLAdapter(testXRPLConfig(fake.srv.URL))
	// Non-integer (e.g. decimal XRP or an IOU-ish value) must be refused.
	for _, bad := range []string{"1.5", "abc", "", "-100"} {
		if _, err := a.SendXRPPayment(context.Background(), bad); err == nil {
			t.Errorf("amount %q must be rejected (XRP drops only)", bad)
		}
	}
}

func TestXRPL_SendPayment_TransportRetry(t *testing.T) {
	// First server dies immediately; adapter must fail honestly after bounded
	// retries, never hanging forever.
	cfg := testXRPLConfig("http://127.0.0.1:1") // nothing listening
	cfg.MaxTransportRetries = 1
	cfg.RequestTimeout = 500 * time.Millisecond
	cfg.ConfirmTimeout = 5 * time.Second
	a := newXRPLAdapter(cfg)
	start := time.Now()
	_, err := a.SendXRPPayment(context.Background(), "1000000")
	if err == nil {
		t.Fatal("must fail against an unreachable rippled")
	}
	if time.Since(start) > 15*time.Second {
		t.Error("bounded retries/timeouts violated — call took too long")
	}
}

// TestODL_ExecuteSettlement_XRPL exercises the full Ripple dispatch with a
// fake rippled and asserts the honest persistence payload.
func TestODL_ExecuteSettlement_XRPL(t *testing.T) {
	fake := newFakeRippled(t, "tesSUCCESS", true)
	t.Setenv("XRPL_RPC_URL", fake.srv.URL)
	t.Setenv("XRPL_SEED", "sTestSeed")
	t.Setenv("XRPL_ACCOUNT", "rODLSourceAccount111111111111111111")
	t.Setenv("XRPL_DESTINATION_ACCOUNT", "rOffRampDest22222222222222222222")

	settlement := &ODLSettlement{
		SettlementID:  "test-xrpl-001",
		TransferID:    "tx-xrpl-001",
		QuoteID:       "quote-xrpl-001",
		Status:        StatusPending,
		FromCurrency:  "USD",
		ToCurrency:    "KES",
		SendAmount:    100,
		ReceiveAmount: 13000,
		BridgeAsset:   BridgeXRP,
		Provider:      ProviderRipple,
		BridgeDrops:   "25000000",
		CreatedAt:     time.Now(),
		AuditTrail:    []AuditEvent{},
	}

	executeODLSettlement(context.Background(), settlement)

	if settlement.Status != StatusCompleted {
		t.Fatalf("expected COMPLETED, got %s (%s)", settlement.Status, settlement.FailureReason)
	}
	if settlement.BridgeTxHash != fake.txHash {
		t.Errorf("bridge tx hash must be the rippled-returned hash, got %q", settlement.BridgeTxHash)
	}
	if settlement.XRPL == nil {
		t.Fatal("XRPL execution record must be attached for persistence")
	}
	if settlement.XRPL.EngineResult != "tesSUCCESS" || settlement.XRPL.LedgerIndex != 902 {
		t.Errorf("XRPL payload wrong: %+v", settlement.XRPL)
	}
	if settlement.CompletedAt == nil {
		t.Error("CompletedAt must be set for a completed settlement")
	}

	// Missing bridge amount must fail honestly, never invent one.
	s2 := &ODLSettlement{
		SettlementID: "test-xrpl-002", Status: StatusPending,
		FromCurrency: "USD", ToCurrency: "KES",
		BridgeAsset: BridgeXRP, Provider: ProviderRipple,
		CreatedAt: time.Now(), AuditTrail: []AuditEvent{},
	}
	executeODLSettlement(context.Background(), s2)
	if s2.Status == StatusCompleted {
		t.Error("settlement without partner-committed drops must never complete")
	}
}

// ── XRP Corridor Quote Honesty ────────────────────────────────────────────────

func TestODL_XRPQuote_UnavailableWithoutPartners(t *testing.T) {
	// Outside dev, without partner endpoints, the XRP corridor is UNAVAILABLE
	// rather than quoting fabricated figures.
	t.Setenv("APP_ENV", "")
	t.Setenv("ENV", "")
	t.Setenv("GO_ENV", "")
	t.Setenv("ODL_ONRAMP_URL", "")
	t.Setenv("ODL_OFFRAMP_URL", "")
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/api/v1/quote?from=USD&to=KES&amount=1000", nil)
	handleGetQuote(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 for unconfigured XRP corridor, got %d: %s", w.Code, w.Body.String())
	}
}

func TestODL_XRPQuote_DevSyntheticLabeled(t *testing.T) {
	t.Setenv("APP_ENV", "dev")
	t.Setenv("ODL_ONRAMP_URL", "")
	t.Setenv("ODL_OFFRAMP_URL", "")
	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/api/v1/quote?from=USD&to=KES&amount=1000", nil)
	handleGetQuote(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 in dev mode, got %d: %s", w.Code, w.Body.String())
	}
	var q ODLQuote
	if err := json.Unmarshal(w.Body.Bytes(), &q); err != nil {
		t.Fatalf("parse quote: %v", err)
	}
	if !q.Synthetic {
		t.Error("dev-mode placeholder quote MUST be labeled synthetic")
	}
}

func TestODL_XRPQuote_PartnerEndpoints(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("ENV", "")
	t.Setenv("GO_ENV", "")
	onramp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{"fee_pct": 0.20})
	}))
	defer onramp.Close()
	offramp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"fee_pct":        0.10,
			"receive_amount": 128700,
			"xrp_drops":      "50000000",
		})
	}))
	defer offramp.Close()
	t.Setenv("ODL_ONRAMP_URL", onramp.URL)
	t.Setenv("ODL_OFFRAMP_URL", offramp.URL)

	w := httptest.NewRecorder()
	r, _ := http.NewRequest("GET", "/api/v1/quote?from=USD&to=KES&amount=1000", nil)
	handleGetQuote(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with partner endpoints, got %d: %s", w.Code, w.Body.String())
	}
	var q ODLQuote
	if err := json.Unmarshal(w.Body.Bytes(), &q); err != nil {
		t.Fatalf("parse quote: %v", err)
	}
	if q.Synthetic {
		t.Error("partner-backed quote must not be labeled synthetic")
	}
	if math.Abs(q.TotalFeePct-0.30) > 0.0001 {
		t.Errorf("fee must be the sum of partner fees (0.30), got %f", q.TotalFeePct)
	}
	if q.ReceiveAmount != 128700 {
		t.Errorf("receive amount must come from off-ramp partner, got %f", q.ReceiveAmount)
	}
	if q.BridgeDrops != "50000000" {
		t.Errorf("bridge drops must come from partner commitment, got %q", q.BridgeDrops)
	}
}
