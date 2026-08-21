package main

// Tests for GO-C1 / GO-H4 / GO-H5 fail-closed fixes.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// GO-C1: with no deposit-address provider configured, creating a payment
// intent must fail closed with 503 and must NEVER return a zero/fabricated address.
func TestCreatePaymentIntent_FailsClosedWithoutProvider(t *testing.T) {
	appCfg = Config{} // no DepositAddressProviderURL
	r := gin.New()
	r.POST("/api/payment-intents", createPaymentIntent)

	body := `{"merchant_id":"m1","amount":10,"currency":"USD","stablecoin":"USDC"}`
	req := httptest.NewRequest("POST", "/api/payment-intents", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
	if strings.Contains(w.Body.String(), "0x0000000000000000000000000000000000000000") {
		t.Fatal("response contains the all-zero burn address")
	}
	if strings.Contains(w.Body.String(), "deposit_address\":\"") {
		t.Fatal("response contains a deposit address despite provisioning failure")
	}
}

// GO-C1: a configured provider that returns a real address is used verbatim.
func TestCreatePaymentIntent_UsesProvisionedAddress(t *testing.T) {
	real := "0x1111111111111111111111111111111111111111"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"address": real})
	}))
	defer srv.Close()
	appCfg = Config{DepositAddressProviderURL: srv.URL}

	r := gin.New()
	r.POST("/api/payment-intents", createPaymentIntent)
	body := `{"merchant_id":"m1","amount":10,"currency":"USD","stablecoin":"USDC"}`
	req := httptest.NewRequest("POST", "/api/payment-intents", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), real) {
		t.Fatalf("expected provisioned address in response, got %s", w.Body.String())
	}
	appCfg = Config{}
}

// GO-C1: a provider returning the zero address must be rejected (fail closed).
func TestCreatePaymentIntent_RejectsZeroAddressFromProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"address": "0x0000000000000000000000000000000000000000"})
	}))
	defer srv.Close()
	appCfg = Config{DepositAddressProviderURL: srv.URL}

	r := gin.New()
	r.POST("/api/payment-intents", createPaymentIntent)
	body := `{"merchant_id":"m1","amount":10,"currency":"USD","stablecoin":"USDC"}`
	req := httptest.NewRequest("POST", "/api/payment-intents", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for zero address, got %d", w.Code)
	}
	appCfg = Config{}
}

// GO-H5: batch payout execution must fail closed when no settlement executor
// is configured — never fabricate a tx hash or "completed" status.
func TestExecuteBatchPayout_FailsClosedWithoutExecutor(t *testing.T) {
	appCfg = Config{}
	r := gin.New()
	r.POST("/api/batch-payouts/:batchId/execute", executeBatchPayout)
	req := httptest.NewRequest("POST", "/api/batch-payouts/batch-1/execute", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
	if strings.Contains(w.Body.String(), "\"completed\"") {
		t.Fatal("fabricated completed status returned")
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if _, ok := resp["tx_hash"]; ok {
		t.Fatal("fabricated tx_hash returned")
	}
}

// GO-H5: auth middleware rejects unauthenticated calls (fail closed without DB/key).
func TestAuthMiddleware_FailsClosed(t *testing.T) {
	db = nil
	t.Setenv("INTERNAL_SERVICE_KEY", "")
	r := gin.New()
	api := r.Group("/api", authMiddleware())
	api.POST("/batch-payouts/:batchId/execute", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	req := httptest.NewRequest("POST", "/api/batch-payouts/b1/execute", bytes.NewReader(nil))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
	// Correct internal key passes.
	t.Setenv("INTERNAL_SERVICE_KEY", "svc-key")
	r2 := gin.New()
	api2 := r2.Group("/api", authMiddleware())
	api2.POST("/x", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	req2 := httptest.NewRequest("POST", "/api/x", nil)
	req2.Header.Set("X-API-Key", "svc-key")
	w2 := httptest.NewRecorder()
	r2.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 with internal key, got %d", w2.Code)
	}
}

// GO-H4: webhook delivery must fail closed without a merchant store (no placeholder secret).
func TestDeliverWebhook_FailsClosedWithoutDB(t *testing.T) {
	db = nil
	r := gin.New()
	r.POST("/api/webhooks/deliver", deliverWebhook)
	body := `{"merchant_id":"m1","event":"payment.completed","data":{"x":1}}`
	req := httptest.NewRequest("POST", "/api/webhooks/deliver", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
	// No signature derived from the old placeholder may appear.
	placeholderSig := signPayload(`{"x":1}`, "webhook-secret-placeholder")
	if strings.Contains(w.Body.String(), placeholderSig) {
		t.Fatal("placeholder-derived signature leaked")
	}
}
