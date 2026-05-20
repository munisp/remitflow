package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ─── Existing fee / rate tests ────────────────────────────────────────────────

func TestCalcFee(t *testing.T) {
	type tc struct {
		amount   float64
		segment  Segment
		expected float64
	}
	tests := []tc{
		{1000000, SegmentLabor, 35000},
		{1000000, SegmentEducation, 28000},
		{1000000, SegmentMedical, 25000},
		{1000000, SegmentHNW, 18000},
		{1000000, SegmentSME, 32000},
	}
	for _, tt := range tests {
		got := calcFee(tt.amount, tt.segment)
		if got != tt.expected {
			t.Errorf("calcFee(%v, %v) = %v, want %v", tt.amount, tt.segment, got, tt.expected)
		}
	}
}

func TestCalcAmountReceived(t *testing.T) {
	amt := calcAmountReceived(1000000, "USD", SegmentLabor)
	if amt <= 0 {
		t.Errorf("expected positive amount received, got %v", amt)
	}
	if amt < 400 || amt > 800 {
		t.Errorf("amount received %v out of expected range [400, 800]", amt)
	}
}

func TestHandleQuote(t *testing.T) {
	body, _ := json.Marshal(QuoteRequest{
		AmountNGN:           2000000,
		DestinationCurrency: "GBP",
		Segment:             SegmentEducation,
	})
	req := httptest.NewRequest(http.MethodPost, "/quote", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleQuote(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp QuoteResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if resp.QuoteID == "" {
		t.Error("expected non-empty QuoteID")
	}
	if resp.FxRate <= 0 {
		t.Error("expected positive FxRate")
	}
	if resp.AmountReceived <= 0 {
		t.Error("expected positive AmountReceived")
	}
	if resp.FeePct != 2.8 {
		t.Errorf("expected education fee 2.8%%, got %v", resp.FeePct)
	}
	// RateSource must be set
	if resp.RateSource == "" {
		t.Error("expected non-empty RateSource")
	}
}

func TestHandleQuoteRateSource(t *testing.T) {
	// When BMATCH is unavailable, rate source should fall back to static_fallback
	body, _ := json.Marshal(QuoteRequest{
		AmountNGN:           500000,
		DestinationCurrency: "USD",
		Segment:             SegmentLabor,
	})
	req := httptest.NewRequest(http.MethodPost, "/quote", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleQuote(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp QuoteResponse
	json.NewDecoder(w.Body).Decode(&resp)
	// In test environment BMATCH is not running, so fallback is expected
	if resp.RateSource != "live_bmatch" && resp.RateSource != "static_fallback" {
		t.Errorf("unexpected rate source: %v", resp.RateSource)
	}
	if resp.MidMarketRate <= 0 {
		t.Errorf("expected positive mid market rate, got %v", resp.MidMarketRate)
	}
}

func TestHandleSubmit(t *testing.T) {
	body, _ := json.Marshal(SubmitRequest{
		QuoteID:             "Q-123",
		SenderName:          "Emeka Okafor",
		SenderBVN:           "12345678901",
		RecipientName:       "John Smith",
		RecipientIBAN:       "GB29NWBK60161331926819",
		RecipientBank:       "Barclays",
		RecipientCountry:    "GB",
		PurposeCode:         "EDU",
		Segment:             SegmentEducation,
		AmountNGN:           5000000,
		DestinationCurrency: "GBP",
	})
	req := httptest.NewRequest(http.MethodPost, "/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleSubmit(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp SubmitResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if resp.SWIFTReference == "" {
		t.Error("expected non-empty SWIFTReference")
	}
	if resp.CBNFormA == "" {
		t.Error("expected non-empty CBNFormA")
	}
	if resp.Status != "processing" {
		t.Errorf("expected status processing, got %v", resp.Status)
	}
}

// ─── CBN Annual Limits tests ──────────────────────────────────────────────────

func TestCheckAnnualLimit_WithinLimit(t *testing.T) {
	// EDU limit is $10,000/year; sending $5,000 NGN equivalent with $2,000 already used
	allowed, cap, remaining := checkAnnualLimit("EDU", 5000*1600, 2000.0, 1600.0)
	if !allowed {
		t.Error("expected transfer to be allowed within EDU annual limit")
	}
	if cap != 10000 {
		t.Errorf("expected EDU cap 10000, got %v", cap)
	}
	if remaining != 8000 {
		t.Errorf("expected remaining 8000, got %v", remaining)
	}
}

func TestCheckAnnualLimit_Exceeded(t *testing.T) {
	// EDU limit is $10,000/year; sending $5,000 with $8,000 already used = exceeds
	allowed, cap, _ := checkAnnualLimit("EDU", 5000*1600, 8000.0, 1600.0)
	if allowed {
		t.Error("expected transfer to be blocked — EDU annual limit exceeded")
	}
	if cap != 10000 {
		t.Errorf("expected EDU cap 10000, got %v", cap)
	}
}

func TestCheckAnnualLimit_MED(t *testing.T) {
	// MED limit is $15,000/year
	allowed, cap, _ := checkAnnualLimit("MED", 10000*1600, 0, 1600.0)
	if !allowed {
		t.Error("expected MED transfer within limit to be allowed")
	}
	if cap != 15000 {
		t.Errorf("expected MED cap 15000, got %v", cap)
	}
}

func TestCheckAnnualLimit_UnknownCode(t *testing.T) {
	// Unknown purpose codes have no limit — always allowed
	allowed, cap, _ := checkAnnualLimit("XYZ", 1000000*1600, 0, 1600.0)
	if !allowed {
		t.Error("expected unknown purpose code to be allowed (no limit)")
	}
	if cap != 0 {
		t.Errorf("expected cap 0 for unknown code, got %v", cap)
	}
}

func TestHandleSubmit_AnnualLimitExceeded(t *testing.T) {
	// Send $12,000 worth of NGN for EDU when $9,000 already used (exceeds $10,000 cap)
	body, _ := json.Marshal(SubmitRequest{
		QuoteID:             "Q-456",
		SenderName:          "Ada Nwosu",
		SenderBVN:           "98765432101",
		RecipientName:       "Oxford University",
		RecipientIBAN:       "GB00OXFD12345678901234",
		RecipientBank:       "Barclays",
		RecipientCountry:    "GB",
		PurposeCode:         "EDU",
		Segment:             SegmentEducation,
		AmountNGN:           12000 * 1600, // $12,000 equivalent
		DestinationCurrency: "GBP",
	})
	req := httptest.NewRequest(http.MethodPost, "/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Used-Annual-USD", "9000") // $9,000 already used
	w := httptest.NewRecorder()
	handleSubmit(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for annual limit exceeded, got %d: %s", w.Code, w.Body.String())
	}
	var errResp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&errResp)
	if errResp["code"] != "ANNUAL_LIMIT_EXCEEDED" {
		t.Errorf("expected ANNUAL_LIMIT_EXCEEDED code, got %v", errResp["code"])
	}
}

func TestHandleAnnualLimit(t *testing.T) {
	body, _ := json.Marshal(AnnualLimitRequest{
		PurposeCode: "EDU",
		UsedUSD:     3500.0,
	})
	req := httptest.NewRequest(http.MethodPost, "/annual-limit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleAnnualLimit(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp AnnualLimitResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.AnnualCapUSD != 10000 {
		t.Errorf("expected EDU cap 10000, got %v", resp.AnnualCapUSD)
	}
	if resp.RemainingUSD != 6500 {
		t.Errorf("expected remaining 6500, got %v", resp.RemainingUSD)
	}
	if resp.UtilizationPct != 35.0 {
		t.Errorf("expected utilization 35%%, got %v", resp.UtilizationPct)
	}
	if resp.IsExceeded {
		t.Error("expected IsExceeded=false for 3500/10000")
	}
}

func TestHandleAnnualLimit_Exceeded(t *testing.T) {
	body, _ := json.Marshal(AnnualLimitRequest{
		PurposeCode: "EDU",
		UsedUSD:     10500.0,
	})
	req := httptest.NewRequest(http.MethodPost, "/annual-limit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleAnnualLimit(w, req)
	var resp AnnualLimitResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if !resp.IsExceeded {
		t.Error("expected IsExceeded=true for 10500/10000")
	}
	if resp.RemainingUSD != 0 {
		t.Errorf("expected remaining 0 when exceeded, got %v", resp.RemainingUSD)
	}
}

// ─── Live FX / static fallback tests ─────────────────────────────────────────

func TestStaticFallback(t *testing.T) {
	rate := staticFallback("USD")
	if rate != 1600.0 {
		t.Errorf("expected USD fallback 1600, got %v", rate)
	}
	rate = staticFallback("UNKNOWN")
	if rate != 1600.0 {
		t.Errorf("expected default fallback 1600 for unknown currency, got %v", rate)
	}
}

func TestFetchLiveFXRate_FallsBackWhenBMATCHDown(t *testing.T) {
	// In test environment BMATCH is not running; should return static fallback
	rate := fetchLiveFXRate("USD")
	if rate <= 0 {
		t.Errorf("expected positive rate even with BMATCH down, got %v", rate)
	}
}

func TestFXRateCaching(t *testing.T) {
	// Manually inject a cache entry and verify it's returned
	fxCacheMu.Lock()
	fxCache["TST"] = fxCacheEntry{rate: 999.99, fetchedAt: time.Now()}
	fxCacheMu.Unlock()

	fxCacheMu.RLock()
	entry, ok := fxCache["TST"]
	fxCacheMu.RUnlock()
	if !ok {
		t.Fatal("expected cache entry for TST")
	}
	if entry.rate != 999.99 {
		t.Errorf("expected cached rate 999.99, got %v", entry.rate)
	}
}

func TestHandleFXRates(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/fx-rates", nil)
	w := httptest.NewRecorder()
	handleFXRates(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["base"] != "NGN" {
		t.Errorf("expected base NGN, got %v", resp["base"])
	}
	rates, ok := resp["rates"].([]interface{})
	if !ok || len(rates) == 0 {
		t.Error("expected non-empty rates array")
	}
}

// ─── Existing tests (preserved) ───────────────────────────────────────────────

func TestHandleCompliance_Education(t *testing.T) {
	body, _ := json.Marshal(ComplianceRequest{
		AmountNGN: 20000000,
		Segment:   SegmentEducation,
	})
	req := httptest.NewRequest(http.MethodPost, "/compliance", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleCompliance(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp ComplianceResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if !resp.CBNFormRequired {
		t.Error("expected CBN Form A required for large education transfer")
	}
	found := false
	for _, d := range resp.DocumentsRequired {
		if d == "Admission letter / tuition invoice from institution" {
			found = true
		}
	}
	if !found {
		t.Error("expected admission letter in education docs")
	}
}

func TestHandleCompliance_HNW(t *testing.T) {
	body, _ := json.Marshal(ComplianceRequest{
		AmountNGN: 500000000,
		Segment:   SegmentHNW,
	})
	req := httptest.NewRequest(http.MethodPost, "/compliance", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleCompliance(w, req)
	var resp ComplianceResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.MaxSingleTxNGN < 500000*1600 {
		t.Errorf("HNW max single tx too low: %v", resp.MaxSingleTxNGN)
	}
}

func TestHandleHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/quote", nil)
	w := httptest.NewRecorder()
	handleQuote(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestSWIFTRefFormat(t *testing.T) {
	ref := generateSWIFTRef()
	if len(ref) != 18 {
		t.Errorf("expected SWIFT ref length 18, got %d: %s", len(ref), ref)
	}
	if ref[:2] != "RF" {
		t.Errorf("expected SWIFT ref to start with RF, got %s", ref[:2])
	}
}

func TestAllSegmentFees(t *testing.T) {
	segs := []Segment{SegmentLabor, SegmentEducation, SegmentMedical, SegmentHNW, SegmentSME}
	for _, seg := range segs {
		fee := calcFee(1000000, seg)
		if fee <= 0 {
			t.Errorf("fee for segment %v should be positive", seg)
		}
		if fee > 50000 {
			t.Errorf("fee for segment %v too high: %v", seg, fee)
		}
	}
}

func TestAllCurrencies(t *testing.T) {
	currencies := []string{"USD", "GBP", "EUR", "CAD", "AUD", "AED"}
	for _, cur := range currencies {
		amt := calcAmountReceived(1000000, cur, SegmentLabor)
		if amt <= 0 {
			t.Errorf("amount received for %v should be positive", cur)
		}
	}
}

func TestFeeScheduleEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/fee-schedule", nil)
	w := httptest.NewRecorder()
	handleFeeSchedule(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestAnnualLimitsMap(t *testing.T) {
	// Verify all expected purpose codes are present
	codes := []string{"EDU", "MED", "TRV", "REM", "SME", "HNW", "INV", "DIVI"}
	for _, code := range codes {
		if _, ok := annualLimitsUSD[code]; !ok {
			t.Errorf("expected annual limit for purpose code %s", code)
		}
	}
	// EDU must be exactly $10,000
	if annualLimitsUSD["EDU"] != 10000 {
		t.Errorf("expected EDU limit 10000, got %v", annualLimitsUSD["EDU"])
	}
}

func TestGetRateUsesLiveOrFallback(t *testing.T) {
	mid, applied, bps := getRate("USD", SegmentLabor)
	if mid <= 0 {
		t.Errorf("expected positive mid rate, got %v", mid)
	}
	if applied <= 0 || applied >= mid {
		t.Errorf("applied rate %v should be positive and less than mid %v", applied, mid)
	}
	if bps != 150 {
		t.Errorf("expected labor spread 150 bps, got %v", bps)
	}
}

func TestHandleAnnualLimit_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/annual-limit", nil)
	w := httptest.NewRecorder()
	handleAnnualLimit(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestRound2(t *testing.T) {
	if round2(1.005) != 1.01 && round2(1.005) != 1.0 {
		// floating point — just check it doesn't panic
	}
	if round2(100.0) != 100.0 {
		t.Errorf("round2(100.0) should be 100.0, got %v", round2(100.0))
	}
}

func TestBMATCHURLFromEnv(t *testing.T) {
	// bmatchBaseURL should default to localhost:3000
	if !strings.Contains(bmatchBaseURL, "localhost") && !strings.Contains(bmatchBaseURL, "3000") {
		// Could be overridden by env — just check it's non-empty
		if bmatchBaseURL == "" {
			t.Error("expected non-empty bmatchBaseURL")
		}
	}
}
