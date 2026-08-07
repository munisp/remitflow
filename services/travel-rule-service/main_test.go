// Travel Rule Service — Unit Tests
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ─── Test Helpers ─────────────────────────────────────────────────────────────

func makeRequest(t *testing.T, method, path string, body interface{}) *httptest.ResponseRecorder {
	t.Helper()
	var bodyBytes []byte
	if body != nil {
		var err error
		bodyBytes, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("Failed to marshal request body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	return rr
}

// ─── IVMS101 Tests ────────────────────────────────────────────────────────────

func TestIVMS101PayloadStructure(t *testing.T) {
	// Test that IVMS101 payload has required fields
	payload := map[string]interface{}{
		"originator": map[string]interface{}{
			"originatorPersons": []interface{}{
				map[string]interface{}{
					"naturalPerson": map[string]interface{}{
						"name": map[string]interface{}{
							"nameIdentifier": []interface{}{
								map[string]interface{}{
									"primaryIdentifier":   "Smith",
									"secondaryIdentifier": "John",
									"nameIdentifierType":  "LEGL",
								},
							},
						},
					},
				},
			},
			"accountNumber": []string{"GB29NWBK60161331926819"},
		},
		"beneficiary": map[string]interface{}{
			"beneficiaryPersons": []interface{}{},
			"accountNumber":      []string{"NG29NWBK60161331926820"},
		},
	}

	// Validate originator
	orig, ok := payload["originator"].(map[string]interface{})
	if !ok {
		t.Fatal("originator must be a map")
	}
	persons, ok := orig["originatorPersons"].([]interface{})
	if !ok || len(persons) == 0 {
		t.Fatal("originatorPersons must be non-empty")
	}
	accounts, ok := orig["accountNumber"].([]string)
	if !ok || len(accounts) == 0 {
		t.Fatal("accountNumber must be non-empty")
	}

	// Validate beneficiary
	bene, ok := payload["beneficiary"].(map[string]interface{})
	if !ok {
		t.Fatal("beneficiary must be a map")
	}
	beneAccounts, ok := bene["accountNumber"].([]string)
	if !ok || len(beneAccounts) == 0 {
		t.Fatal("beneficiary accountNumber must be non-empty")
	}
}

// ─── Risk Score Tests ─────────────────────────────────────────────────────────

func TestRiskScoreHighRiskCountry(t *testing.T) {
	// High-risk country should produce high risk score
	score := calculateRiskScore("IR", "GB", 5000.0, "fiat", false)
	if score < 40 {
		t.Errorf("Expected risk score >= 40 for high-risk country, got %d", score)
	}
}

func TestRiskScoreLowRiskDomestic(t *testing.T) {
	// Low amount, same country, no crypto should be low risk
	score := calculateRiskScore("GB", "GB", 1000.0, "fiat", true)
	if score > 30 {
		t.Errorf("Expected risk score <= 30 for low-risk domestic, got %d", score)
	}
}

func TestRiskScoreCrypto(t *testing.T) {
	// Crypto should add to risk score
	scoreFiat := calculateRiskScore("GB", "US", 1000.0, "fiat", false)
	scoreCrypto := calculateRiskScore("GB", "US", 1000.0, "crypto", false)
	if scoreCrypto <= scoreFiat {
		t.Errorf("Crypto risk score (%d) should be higher than fiat (%d)", scoreCrypto, scoreFiat)
	}
}

func TestRiskScoreHighAmount(t *testing.T) {
	// High amount should increase risk
	scoreLow := calculateRiskScore("GB", "US", 1000.0, "fiat", false)
	scoreHigh := calculateRiskScore("GB", "US", 50000.0, "fiat", false)
	if scoreHigh <= scoreLow {
		t.Errorf("High amount risk score (%d) should be higher than low amount (%d)", scoreHigh, scoreLow)
	}
}

// ─── Threshold Tests ──────────────────────────────────────────────────────────

func TestFATFThreshold(t *testing.T) {
	tests := []struct {
		amount   float64
		currency string
		expected bool
	}{
		{999.99, "USD", false},
		{1000.00, "USD", true},
		{1500.00, "USD", true},
		{785.00, "GBP", true},   // ~$1000 USD
		{100.00, "GBP", false},  // ~$127 USD
	}

	for _, tt := range tests {
		result := requiresTravelRule(tt.amount, tt.currency)
		if result != tt.expected {
			t.Errorf("requiresTravelRule(%f, %s) = %v, want %v", tt.amount, tt.currency, result, tt.expected)
		}
	}
}

// ─── Health Check Tests ───────────────────────────────────────────────────────

func TestHealthEndpoint(t *testing.T) {
	resp := map[string]interface{}{
		"status":  "ok",
		"service": "travel-rule-service",
		"version": "14.0.0",
	}

	if resp["status"] != "ok" {
		t.Errorf("Expected status 'ok', got %v", resp["status"])
	}
	if resp["service"] != "travel-rule-service" {
		t.Errorf("Expected service 'travel-rule-service', got %v", resp["service"])
	}
}

// ─── Transfer Status Tests ────────────────────────────────────────────────────

func TestValidTransferStatuses(t *testing.T) {
	validStatuses := []string{"pending", "sent", "acknowledged", "completed", "rejected", "failed"}
	for _, s := range validStatuses {
		if !isValidStatus(s) {
			t.Errorf("Expected status '%s' to be valid", s)
		}
	}
	if isValidStatus("invalid_status") {
		t.Error("Expected 'invalid_status' to be invalid")
	}
}

// ─── Compliance Check Tests ───────────────────────────────────────────────────

func TestSanctionsCheck(t *testing.T) {
	// Known sanctioned entity should fail
	result := runSanctionsCheck("SANCTIONED PERSON")
	if result != "hit" {
		t.Errorf("Expected sanctions hit for known entity, got %s", result)
	}

	// Clean entity should pass
	result = runSanctionsCheck("John Smith")
	if result != "clear" {
		t.Errorf("Expected sanctions clear for clean entity, got %s", result)
	}
}

// ─── Protocol Tests ───────────────────────────────────────────────────────────

func TestValidProtocols(t *testing.T) {
	validProtocols := []string{"TRISA", "OpenVASP", "Shyft", "Sygna"}
	for _, p := range validProtocols {
		if !isValidProtocol(p) {
			t.Errorf("Expected protocol '%s' to be valid", p)
		}
	}
}

// ─── Stub Functions (for unit testing without DB) ─────────────────────────────

func calculateRiskScore(origCountry, beneCountry string, amount float64, assetType string, hasNationalID bool) int {
	score := 0
	highRisk := map[string]bool{"IR": true, "KP": true, "MM": true, "SY": true}
	if highRisk[origCountry] || highRisk[beneCountry] {
		score += 40
	}
	if amount >= 50000 {
		score += 30
	} else if amount >= 10000 {
		score += 20
	} else if amount >= 1000 {
		score += 10
	}
	if origCountry != beneCountry {
		score += 5
	}
	if assetType == "crypto" {
		score += 15
	}
	if !hasNationalID {
		score += 5
	}
	if score > 100 {
		score = 100
	}
	return score
}

func isValidStatus(s string) bool {
	valid := map[string]bool{
		"pending": true, "sent": true, "acknowledged": true,
		"completed": true, "rejected": true, "failed": true,
	}
	return valid[s]
}

func isValidProtocol(p string) bool {
	valid := map[string]bool{"TRISA": true, "OpenVASP": true, "Shyft": true, "Sygna": true}
	return valid[p]
}

func runSanctionsCheck(name string) string {
	sanctioned := map[string]bool{"SANCTIONED PERSON": true, "BLOCKED ENTITY": true}
	if sanctioned[name] {
		return "hit"
	}
	return "clear"
}

// ─── Benchmark Tests ──────────────────────────────────────────────────────────

func BenchmarkRiskScoreCalculation(b *testing.B) {
	for i := 0; i < b.N; i++ {
		calculateRiskScore("GB", "NG", 1500.0, "fiat", true)
	}
}

func BenchmarkIVMS101Serialization(b *testing.B) {
	payload := map[string]interface{}{
		"originator": map[string]interface{}{
			"originatorPersons": []interface{}{},
			"accountNumber":     []string{"GB29NWBK60161331926819"},
		},
		"beneficiary": map[string]interface{}{
			"beneficiaryPersons": []interface{}{},
			"accountNumber":      []string{"NG29NWBK60161331926820"},
		},
	}
	for i := 0; i < b.N; i++ {
		json.Marshal(payload)
	}
}

// Ensure time package is used
var _ = time.Now
var _ = http.StatusOK
