package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRateLimitCheck_Allowed(t *testing.T) {
	body, _ := json.Marshal(RateLimitRequest{Key: "test:user:1", Limit: 10, WindowSecs: 60})
	req := httptest.NewRequest(http.MethodPost, "/ratelimit/check", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleRateLimitCheck(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp RateLimitResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if !resp.Allowed {
		t.Error("Expected allowed=true on first request")
	}
}

func TestRateLimitCheck_Exceeded(t *testing.T) {
	// Use a unique key to avoid interference
	key := "test:exceed:999"
	// Exhaust the limit using in-memory fallback
	for i := 0; i < 3; i++ {
		memRateLimit(key, 2, 60)
	}
	body, _ := json.Marshal(RateLimitRequest{Key: key, Limit: 2, WindowSecs: 60})
	req := httptest.NewRequest(http.MethodPost, "/ratelimit/check", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleRateLimitCheck(w, req)
	var resp RateLimitResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Allowed {
		t.Error("Expected allowed=false after limit exceeded")
	}
}

func TestRateLimitCheck_InvalidBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/ratelimit/check", bytes.NewReader([]byte("invalid")))
	w := httptest.NewRecorder()
	handleRateLimitCheck(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400, got %d", w.Code)
	}
}

func TestValidate_TransferCreate_Valid(t *testing.T) {
	input := map[string]interface{}{
		"amount":       100.0,
		"fromCurrency": "USD",
		"toCurrency":   "EUR",
		"beneficiaryId": 1.0,
	}
	body, _ := json.Marshal(ValidateRequest{Schema: "transfer.create", Input: input})
	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleValidate(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp ValidateResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if !resp.Valid {
		t.Errorf("Expected valid=true, errors: %v", resp.Errors)
	}
}

func TestValidate_TransferCreate_MissingRequired(t *testing.T) {
	input := map[string]interface{}{
		"amount": 100.0,
		// missing fromCurrency, toCurrency, beneficiaryId
	}
	body, _ := json.Marshal(ValidateRequest{Schema: "transfer.create", Input: input})
	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleValidate(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("Expected 422, got %d", w.Code)
	}
	var resp ValidateResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Valid {
		t.Error("Expected valid=false")
	}
	if len(resp.Errors) == 0 {
		t.Error("Expected validation errors")
	}
}

func TestValidate_TransferCreate_InvalidCurrencyFormat(t *testing.T) {
	input := map[string]interface{}{
		"amount":        100.0,
		"fromCurrency":  "usd", // lowercase — should fail pattern
		"toCurrency":    "EUR",
		"beneficiaryId": 1.0,
	}
	body, _ := json.Marshal(ValidateRequest{Schema: "transfer.create", Input: input})
	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleValidate(w, req)
	var resp ValidateResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Valid {
		t.Error("Expected valid=false for lowercase currency")
	}
}

func TestValidate_KYCSubmit_InvalidDocType(t *testing.T) {
	input := map[string]interface{}{
		"documentType":   "selfie", // not in enum
		"documentNumber": "AB123456",
		"dateOfBirth":    "1990-01-01",
		"nationality":    "US",
	}
	body, _ := json.Marshal(ValidateRequest{Schema: "kyc.submit", Input: input})
	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleValidate(w, req)
	var resp ValidateResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Valid {
		t.Error("Expected valid=false for invalid document type")
	}
}

func TestValidate_UnknownSchema_PassThrough(t *testing.T) {
	body, _ := json.Marshal(ValidateRequest{Schema: "unknown.schema", Input: map[string]interface{}{}})
	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleValidate(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 pass-through for unknown schema, got %d", w.Code)
	}
}

func TestHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "ok" {
		t.Errorf("Expected status=ok, got %s", resp["status"])
	}
}

func TestMetrics(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	w := httptest.NewRecorder()
	handleMetrics(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	if !bytes.Contains([]byte(body), []byte("remitflow_ratelimit_checks_total")) {
		t.Error("Expected Prometheus metrics in response")
	}
}

func TestIdempotencyCheck_NotExists(t *testing.T) {
	body, _ := json.Marshal(IdempotencyCheckRequest{Key: "test-key-not-exists"})
	req := httptest.NewRequest(http.MethodPost, "/idempotency/check", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleIdempotencyCheck(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp IdempotencyCheckResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Exists {
		t.Error("Expected exists=false for new key")
	}
}

func TestIdempotencyStore(t *testing.T) {
	body, _ := json.Marshal(IdempotencyStoreRequest{Key: "test-store-key", Result: map[string]string{"id": "123"}, TTLSecs: 60})
	req := httptest.NewRequest(http.MethodPost, "/idempotency/store", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleIdempotencyStore(w, req)
	if w.Code != http.StatusCreated {
		t.Errorf("Expected 201, got %d", w.Code)
	}
}
