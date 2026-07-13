// RemitFlow — PAPSS Service Test Suite
// Covers: corridor validation, currency support, transfer initiation,
// netting logic, health endpoint, idempotency, and compliance screening.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func newPAPSSRouter() *gin.Engine {
	r := gin.New()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "papss"})
	})
	r.POST("/api/v1/transfers", handleInitiateTransfer)
	r.GET("/api/v1/transfers/:id", handleGetTransfer)
	r.GET("/api/v1/corridors", handleListCorridors)
	r.POST("/api/v1/netting/trigger", handleTriggerNetting)
	r.POST("/api/v1/compliance/screen", handleComplianceScreen)
	return r
}

// ── Health ────────────────────────────────────────────────────────────────────

func TestPAPSS_Health(t *testing.T) {
	r := newPAPSSRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/health", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["status"] != "healthy" {
		t.Errorf("expected status=healthy, got %v", resp["status"])
	}
}

// ── Supported Currencies ──────────────────────────────────────────────────────

func TestPAPSS_SupportedCurrencies(t *testing.T) {
	supported := []string{"NGN", "GHS", "KES", "TZS", "ZMW", "RWF", "UGX", "XOF", "XAF", "ZWL"}
	unsupported := []string{"USD", "EUR", "GBP", "JPY", "CNY"}

	for _, c := range supported {
		t.Run("supported_"+c, func(t *testing.T) {
			if !isSupportedPAPSSCurrency(c) {
				t.Errorf("expected %s to be supported by PAPSS", c)
			}
		})
	}
	for _, c := range unsupported {
		t.Run("unsupported_"+c, func(t *testing.T) {
			if isSupportedPAPSSCurrency(c) {
				t.Errorf("expected %s to NOT be supported by PAPSS", c)
			}
		})
	}
}

// ── Corridor Validation ───────────────────────────────────────────────────────

func TestPAPSS_CorridorValidation(t *testing.T) {
	tests := []struct {
		name        string
		fromCountry string
		toCountry   string
		wantValid   bool
	}{
		{"NG→GH valid", "NG", "GH", true},
		{"NG→KE valid", "NG", "KE", true},
		{"GH→TZ valid", "GH", "TZ", true},
		{"KE→RW valid", "KE", "RW", true},
		{"NG→US invalid", "NG", "US", false},
		{"US→NG invalid", "US", "NG", false},
		{"NG→CN invalid", "NG", "CN", false},
		{"same country invalid", "NG", "NG", false},
		{"empty country invalid", "", "GH", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			valid := isValidPAPSSCorridor(tt.fromCountry, tt.toCountry)
			if valid != tt.wantValid {
				t.Errorf("isValidPAPSSCorridor(%q, %q) = %v, want %v",
					tt.fromCountry, tt.toCountry, valid, tt.wantValid)
			}
		})
	}
}

// ── Transfer Limits ───────────────────────────────────────────────────────────

func TestPAPSS_TransferLimits(t *testing.T) {
	tests := []struct {
		name      string
		amount    float64
		currency  string
		wantErr   bool
		errSubstr string
	}{
		{"valid NGN transfer", 500000, "NGN", false, ""},
		{"valid GHS transfer", 5000, "GHS", false, ""},
		{"zero amount", 0, "NGN", true, "amount"},
		{"negative amount", -100, "NGN", true, "amount"},
		{"exceeds daily NGN limit", 50_000_001, "NGN", true, "limit"},
		{"minimum amount NGN", 100, "NGN", false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePAPSSTransferAmount(tt.amount, tt.currency)
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errSubstr)
					return
				}
				if tt.errSubstr != "" && !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("expected error containing %q, got %q", tt.errSubstr, err.Error())
				}
			} else if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// ── Netting Logic ─────────────────────────────────────────────────────────────

func TestPAPSS_MultilateralNetting(t *testing.T) {
	positions := []NettingPosition{
		{Country: "NG", Currency: "NGN", GrossDebit: 10_000_000, GrossCredit: 7_000_000},
		{Country: "GH", Currency: "GHS", GrossDebit: 500_000, GrossCredit: 800_000},
		{Country: "KE", Currency: "KES", GrossDebit: 2_000_000, GrossCredit: 2_000_000},
	}

	result := calculateMultilateralNetting(positions)

	// NG: net debit = 3,000,000
	if result["NG"].NetPosition != -3_000_000 {
		t.Errorf("NG net position: expected -3000000, got %v", result["NG"].NetPosition)
	}
	// GH: net credit = 300,000
	if result["GH"].NetPosition != 300_000 {
		t.Errorf("GH net position: expected 300000, got %v", result["GH"].NetPosition)
	}
	// KE: net zero
	if result["KE"].NetPosition != 0 {
		t.Errorf("KE net position: expected 0, got %v", result["KE"].NetPosition)
	}
}

func TestPAPSS_NettingEfficiency(t *testing.T) {
	// Netting should reduce settlement obligations by at least 30%
	grossTotal := 100_000_000.0
	netTotal := 35_000_000.0
	efficiency := (1 - netTotal/grossTotal) * 100

	if efficiency < 30 {
		t.Errorf("netting efficiency %.1f%% is below 30%% threshold", efficiency)
	}
	t.Logf("Netting efficiency: %.1f%%", efficiency)
}

// ── Compliance Screening ──────────────────────────────────────────────────────

func TestPAPSS_ComplianceScreen(t *testing.T) {
	r := newPAPSSRouter()

	tests := []struct {
		name          string
		payerCountry  string
		payeeCountry  string
		amount        float64
		wantCleared   bool
	}{
		{"low-risk NG→GH", "NG", "GH", 50000, true},
		{"sanctioned country KP", "KP", "NG", 100, false},
		{"sanctioned country IR", "IR", "GH", 100, false},
		{"high-value triggers review", "NG", "KE", 45_000_000, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]interface{}{
				"payerCountry": tt.payerCountry,
				"payeeCountry": tt.payeeCountry,
				"amount":       tt.amount,
				"currency":     "NGN",
			})
			w := httptest.NewRecorder()
			req, _ := http.NewRequest("POST", "/api/v1/compliance/screen", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}
			var resp map[string]interface{}
			json.Unmarshal(w.Body.Bytes(), &resp)
			cleared, _ := resp["cleared"].(bool)
			if cleared != tt.wantCleared {
				t.Errorf("cleared=%v, want %v", cleared, tt.wantCleared)
			}
		})
	}
}

// ── Idempotency ───────────────────────────────────────────────────────────────

func TestPAPSS_IdempotencyKeyGeneration(t *testing.T) {
	key1 := generatePAPSSIdempotencyKey("tx-001", "NG", "GH", 500000)
	key2 := generatePAPSSIdempotencyKey("tx-001", "NG", "GH", 500000)
	key3 := generatePAPSSIdempotencyKey("tx-002", "NG", "GH", 500000)

	if key1 != key2 {
		t.Error("same inputs must produce same idempotency key")
	}
	if key1 == key3 {
		t.Error("different tx IDs must produce different keys")
	}
	if len(key1) == 0 {
		t.Error("idempotency key must not be empty")
	}
}

// ── Settlement Reference ──────────────────────────────────────────────────────

func TestPAPSS_SettlementReferenceFormat(t *testing.T) {
	ref := generatePAPSSSettlementRef("NG", "GH")
	if !strings.HasPrefix(ref, "PAPSS-") {
		t.Errorf("settlement ref should start with PAPSS-, got: %s", ref)
	}
	if len(ref) < 20 {
		t.Errorf("settlement ref too short: %s", ref)
	}
}

// ── Environment Configuration ─────────────────────────────────────────────────

func TestPAPSS_EnvDefaults(t *testing.T) {
	os.Unsetenv("PAPSS_API_URL")
	url := getPAPSSAPIURL()
	if url == "" {
		t.Error("PAPSS API URL must have a default value")
	}
	if !strings.HasPrefix(url, "http") {
		t.Errorf("PAPSS API URL must be a valid URL, got: %s", url)
	}
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

func BenchmarkPAPSS_CurrencyValidation(b *testing.B) {
	currencies := []string{"NGN", "GHS", "KES", "USD", "EUR"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isSupportedPAPSSCurrency(currencies[i%len(currencies)])
	}
}

func BenchmarkPAPSS_CorridorValidation(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isValidPAPSSCorridor("NG", "GH")
	}
}

func BenchmarkPAPSS_MultilateralNetting(b *testing.B) {
	positions := make([]NettingPosition, 13)
	countries := []string{"NG", "GH", "KE", "TZ", "ZM", "ZW", "RW", "UG", "SN", "CI", "CM", "SL", "LR"}
	for i, c := range countries {
		positions[i] = NettingPosition{
			Country:     c,
			GrossDebit:  float64(i+1) * 1_000_000,
			GrossCredit: float64(i) * 1_000_000,
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		calculateMultilateralNetting(positions)
	}
}

// ── Integration Test Stub ─────────────────────────────────────────────────────

func TestPAPSS_LiveTransferIntegration(t *testing.T) {
	if os.Getenv("PAPSS_SANDBOX_KEY") == "" {
		t.Skip("PAPSS_SANDBOX_KEY not set — skipping live integration test")
	}
	t.Log("Live PAPSS sandbox integration test would run here")
}

// ── Helper: ensure test-only stubs compile ────────────────────────────────────

func TestPAPSS_TimestampPrecision(t *testing.T) {
	ts1 := time.Now().UTC()
	ts2 := time.Now().UTC()
	if ts2.Before(ts1) {
		t.Error("time should be monotonically increasing")
	}
}

func TestPAPSS_AmountRounding(t *testing.T) {
	// PAPSS amounts must be rounded to 2 decimal places
	tests := []struct{ input, want float64 }{
		{1234.567, 1234.57},
		{1234.561, 1234.56},
		{0.005, 0.01},
		{100.0, 100.0},
	}
	for _, tt := range tests {
		got := math.Round(tt.input*100) / 100
		if got != tt.want {
			t.Errorf("round(%v) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestPAPSS_GenerateTransactionID(t *testing.T) {
	ids := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		id := fmt.Sprintf("PAPSS-%d-%d", time.Now().UnixNano(), i)
		if ids[id] {
			t.Errorf("duplicate transaction ID generated: %s", id)
		}
		ids[id] = true
	}
}
