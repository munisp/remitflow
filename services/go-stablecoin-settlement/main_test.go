package main

// Tests for GO-C2 fail-closed webhook HMAC verification.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func hmacSig(payload, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

// GO-C2: empty secret must NEVER verify (the old "dev mode: accept all" is gone).
func TestVerifyHMAC_EmptySecretRejected(t *testing.T) {
	if verifyHMAC([]byte(`{"id":"x"}`), "anysig", "") {
		t.Fatal("empty secret verified — webhook forgery possible")
	}
	if verifyHMAC([]byte(`{"id":"x"}`), "", "") {
		t.Fatal("empty secret + empty signature verified")
	}
}

// GO-C2: valid signature verifies; wrong/empty signature does not.
func TestVerifyHMAC_Correctness(t *testing.T) {
	payload := []byte(`{"id":"tx1","type":"settlement.completed"}`)
	secret := "top-secret"
	if !verifyHMAC(payload, hmacSig(string(payload), secret), secret) {
		t.Fatal("valid signature rejected")
	}
	if verifyHMAC(payload, hmacSig(string(payload)+"tampered", secret), secret) {
		t.Fatal("tampered payload verified")
	}
	if verifyHMAC(payload, "", secret) {
		t.Fatal("empty signature verified")
	}
}

// GO-C2: forged webhook with no secret configured must get 401 (not processed).
func TestWebhookHandler_FailClosedNoSecret(t *testing.T) {
	body := `{"id":"forged-1","type":"settlement.completed"}`
	req := httptest.NewRequest("POST", "/webhook/circle", strings.NewReader(body))
	req.Header.Set("X-Signature-256", hmacSig(body, "attacker-guess"))
	w := httptest.NewRecorder()
	handleWebhook(w, req, "circle", "") // no secret configured
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// GO-C2: correctly signed webhook passes verification gate.
func TestWebhookHandler_ValidSignatureAccepted(t *testing.T) {
	body := `{"id":"evt-1","type":"settlement.completed"}`
	secret := "real-secret"
	req := httptest.NewRequest("POST", "/webhook/circle", strings.NewReader(body))
	req.Header.Set("X-Signature-256", hmacSig(body, secret))
	w := httptest.NewRecorder()
	handleWebhook(w, req, "circle", secret)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
}

// GO-C2/M7: oversized body is rejected (bounded read).
func TestWebhookHandler_BodyBounded(t *testing.T) {
	body := strings.Repeat("a", (1<<20)+10)
	req := httptest.NewRequest("POST", "/webhook/circle", strings.NewReader(body))
	req.Header.Set("X-Signature-256", "x")
	w := httptest.NewRecorder()
	handleWebhook(w, req, "circle", "secret")
	if w.Code != http.StatusRequestEntityTooLarge && w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 413 or 401, got %d", w.Code)
	}
}

// GO-H17: provider payout without API key fails closed unless dev simulation opted in.
func TestCallCirclePayout_FailClosed(t *testing.T) {
	old := circleAPIKey
	circleAPIKey = ""
	defer func() { circleAPIKey = old }()
	t.Setenv("SETTLEMENT_ALLOW_SIMULATED", "")
	t.Setenv("GO_ENV", "")
	t.Setenv("NODE_ENV", "")
	t.Setenv("APP_ENV", "")
	if _, err := callCirclePayout(SettlementRequest{OperationID: "op1"}, "ref1"); err == nil {
		t.Fatal("payout succeeded without API key and without dev opt-in")
	}
	// Explicit dev opt-in yields a clearly-labeled SIMULATED result.
	t.Setenv("SETTLEMENT_ALLOW_SIMULATED", "true")
	res, err := callCirclePayout(SettlementRequest{OperationID: "op1"}, "ref1")
	if err != nil {
		t.Fatalf("dev simulation should be allowed with explicit opt-in: %v", err)
	}
	if res.Status != "simulated" || !strings.HasPrefix(res.ExternalRef, "SIMULATED-") {
		t.Fatalf("simulated payout not labeled as such: %+v", res)
	}
	// Never in production, even with opt-in.
	t.Setenv("GO_ENV", "production")
	if _, err := callCirclePayout(SettlementRequest{OperationID: "op1"}, "ref1"); err == nil {
		t.Fatal("simulated payout allowed in production")
	}
}
