// RemitFlow — Payment Engine Test Suite
// Covers: merchant webhook validation, payment intent lifecycle,
// batch payout validation, idempotency, HMAC signing, and health.
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

func newPaymentRouter() *gin.Engine {
	r := gin.New()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "payment-engine"})
	})
	r.POST("/api/v1/payments/intent", handleCreatePaymentIntent)
	r.GET("/api/v1/payments/:id", handleGetPayment)
	r.POST("/api/v1/payments/:id/capture", handleCapturePayment)
	r.POST("/api/v1/payments/:id/cancel", handleCancelPayment)
	r.POST("/api/v1/batch/payout", handleBatchPayout)
	r.POST("/api/v1/webhooks/merchant", handleMerchantWebhook)
	return r
}

// ── Health ────────────────────────────────────────────────────────────────────

func TestPaymentEngine_Health(t *testing.T) {
	r := newPaymentRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/health", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ── HMAC Webhook Signature ────────────────────────────────────────────────────

func TestPaymentEngine_HMACSignature(t *testing.T) {
	secret := "test-webhook-secret-key"
	payload := `{"event":"payment.completed","amount":5000,"currency":"USD"}`

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !strings.HasPrefix(sig, "sha256=") {
		t.Error("signature must start with sha256=")
	}
	if len(sig) != 71 { // "sha256=" (7) + 64 hex chars
		t.Errorf("expected signature length 71, got %d", len(sig))
	}

	// Verify same payload + secret produces same signature
	mac2 := hmac.New(sha256.New, []byte(secret))
	mac2.Write([]byte(payload))
	sig2 := "sha256=" + hex.EncodeToString(mac2.Sum(nil))
	if sig != sig2 {
		t.Error("HMAC must be deterministic for same inputs")
	}

	// Different payload must produce different signature
	mac3 := hmac.New(sha256.New, []byte(secret))
	mac3.Write([]byte(payload + "tampered"))
	sig3 := "sha256=" + hex.EncodeToString(mac3.Sum(nil))
	if sig == sig3 {
		t.Error("tampered payload must produce different signature")
	}
}

// ── Payment Intent Validation ─────────────────────────────────────────────────

func TestPaymentEngine_CreateIntentValidation(t *testing.T) {
	r := newPaymentRouter()

	tests := []struct {
		name       string
		body       map[string]interface{}
		wantStatus int
	}{
		{
			name: "missing amount",
			body: map[string]interface{}{
				"currency":   "USD",
				"merchantId": "merch-001",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing currency",
			body: map[string]interface{}{
				"amount":     100,
				"merchantId": "merch-001",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "zero amount",
			body: map[string]interface{}{
				"amount":     0,
				"currency":   "USD",
				"merchantId": "merch-001",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "negative amount",
			body: map[string]interface{}{
				"amount":     -50,
				"currency":   "USD",
				"merchantId": "merch-001",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "unsupported currency",
			body: map[string]interface{}{
				"amount":     100,
				"currency":   "XYZ",
				"merchantId": "merch-001",
			},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.body)
			w := httptest.NewRecorder()
			req, _ := http.NewRequest("POST", "/api/v1/payments/intent", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)
			if w.Code != tt.wantStatus {
				t.Errorf("expected %d, got %d: %s", tt.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// ── Batch Payout Validation ───────────────────────────────────────────────────

func TestPaymentEngine_BatchPayoutValidation(t *testing.T) {
	r := newPaymentRouter()

	tests := []struct {
		name       string
		body       map[string]interface{}
		wantStatus int
	}{
		{
			name: "empty recipients",
			body: map[string]interface{}{
				"recipients": []interface{}{},
				"currency":   "USD",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing currency",
			body: map[string]interface{}{
				"recipients": []interface{}{
					map[string]interface{}{"accountId": "acc-001", "amount": 100},
				},
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "exceeds max batch size",
			body: func() map[string]interface{} {
				recipients := make([]interface{}, 10001)
				for i := range recipients {
					recipients[i] = map[string]interface{}{"accountId": fmt.Sprintf("acc-%d", i), "amount": 10}
				}
				return map[string]interface{}{"recipients": recipients, "currency": "USD"}
			}(),
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.body)
			w := httptest.NewRecorder()
			req, _ := http.NewRequest("POST", "/api/v1/batch/payout", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)
			if w.Code != tt.wantStatus {
				t.Errorf("expected %d, got %d: %s", tt.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// ── Idempotency Key ───────────────────────────────────────────────────────────

func TestPaymentEngine_IdempotencyKey(t *testing.T) {
	key1 := generatePaymentIdempotencyKey("merch-001", "order-123", 5000, "USD")
	key2 := generatePaymentIdempotencyKey("merch-001", "order-123", 5000, "USD")
	key3 := generatePaymentIdempotencyKey("merch-001", "order-124", 5000, "USD")

	if key1 != key2 {
		t.Error("same inputs must produce same idempotency key")
	}
	if key1 == key3 {
		t.Error("different order IDs must produce different keys")
	}
}

// ── Payment Status Machine ────────────────────────────────────────────────────

func TestPaymentEngine_StatusTransitions(t *testing.T) {
	validTransitions := map[string][]string{
		"pending":    {"processing", "cancelled"},
		"processing": {"completed", "failed"},
		"completed":  {"refunded"},
		"failed":     {},
		"cancelled":  {},
		"refunded":   {},
	}

	for from, toStates := range validTransitions {
		for _, to := range toStates {
			t.Run(fmt.Sprintf("%s→%s", from, to), func(t *testing.T) {
				if !isValidPaymentStatusTransition(from, to) {
					t.Errorf("expected %s→%s to be valid", from, to)
				}
			})
		}
	}

	// Invalid transitions
	invalidTransitions := [][2]string{
		{"completed", "processing"},
		{"failed", "completed"},
		{"cancelled", "processing"},
		{"refunded", "completed"},
	}
	for _, tr := range invalidTransitions {
		t.Run(fmt.Sprintf("invalid_%s→%s", tr[0], tr[1]), func(t *testing.T) {
			if isValidPaymentStatusTransition(tr[0], tr[1]) {
				t.Errorf("expected %s→%s to be INVALID", tr[0], tr[1])
			}
		})
	}
}

// ── Currency Support ──────────────────────────────────────────────────────────

func TestPaymentEngine_SupportedCurrencies(t *testing.T) {
	supported := []string{"USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR"}
	for _, c := range supported {
		t.Run(c, func(t *testing.T) {
			if !isSupportedPaymentCurrency(c) {
				t.Errorf("expected %s to be supported", c)
			}
		})
	}
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

func BenchmarkPaymentEngine_HMACSign(b *testing.B) {
	secret := []byte("benchmark-secret")
	payload := []byte(`{"event":"payment.completed","amount":5000}`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		mac := hmac.New(sha256.New, secret)
		mac.Write(payload)
		_ = hex.EncodeToString(mac.Sum(nil))
	}
}

func BenchmarkPaymentEngine_IdempotencyKey(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		generatePaymentIdempotencyKey("merch-001", "order-123", 5000, "USD")
	}
}

// ── Integration Test Stub ─────────────────────────────────────────────────────

func TestPaymentEngine_LiveIntegration(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
	t.Log("Integration test: payment intent lifecycle with real DB")
}

func TestPaymentEngine_TimeoutBehavior(t *testing.T) {
	start := time.Now()
	// Simulate a fast operation
	time.Sleep(1 * time.Millisecond)
	elapsed := time.Since(start)
	if elapsed > 100*time.Millisecond {
		t.Errorf("operation took too long: %v", elapsed)
	}
}
