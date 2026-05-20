// CIPS Adapter integration tests
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/remitflow/cips-adapter/internal/handlers"
)

func setupRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/health", handlers.Health)
	r.GET("/api/v1/participants", handlers.ListParticipants)
	r.POST("/api/v1/lookup", handlers.LookupAccount)
	r.POST("/api/v1/transfers", handlers.InitiateTransfer)
	r.GET("/api/v1/transfers/:id", handlers.GetTransferStatus)
	r.POST("/api/v1/compliance/screen", handlers.ScreenTransaction)
	return r
}

func TestHealth(t *testing.T) {
	r := setupRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/health", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["status"] != "healthy" {
		t.Errorf("Expected status=healthy, got %v", resp["status"])
	}
}

func TestListParticipants(t *testing.T) {
	r := setupRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/participants", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	participants := resp["participants"].([]interface{})
	if len(participants) == 0 {
		t.Error("Expected at least one participant")
	}
}

func TestAccountLookup(t *testing.T) {
	r := setupRouter()
	body := map[string]string{
		"account_number": "6222021001234567890",
		"bank_bic":       "ICBKCNBJ",
		"cnaps_code":     "102100099996",
	}
	b, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/lookup", bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["found"] != true {
		t.Error("Expected found=true")
	}
}

func TestInitiateTransfer(t *testing.T) {
	r := setupRouter()
	body := map[string]interface{}{
		"payer_name":    "RemitFlow Technologies Ltd",
		"payer_account": "999000000001",
		"payer_bic":     "REMFFLOW",
		"payer_country": "CN",
		"payee_name":    "张伟",
		"payee_account": "6222021001234567890",
		"payee_bic":     "ICBKCNBJ",
		"payee_country": "CN",
		"amount":        1000.00,
		"currency":      "CNY",
		"purpose":       "TRAD",
		"reference":     "TEST-REF-001",
	}
	b, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/transfers", bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Errorf("Expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["transaction_id"] == "" {
		t.Error("Expected transaction_id in response")
	}
	if resp["status"] != "ACCP" {
		t.Errorf("Expected status=ACCP, got %v", resp["status"])
	}
}

func TestComplianceScreen_LowRisk(t *testing.T) {
	r := setupRouter()
	body := map[string]interface{}{
		"payer_name":    "John Smith",
		"payee_name":    "Zhang Wei",
		"amount":        500.00,
		"currency":      "CNY",
		"payer_country": "US",
		"payee_country": "CN",
	}
	b, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/compliance/screen", bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["cleared"] != true {
		t.Errorf("Expected cleared=true for low-risk transaction, got %v", resp["cleared"])
	}
}

func TestComplianceScreen_SanctionedCountry(t *testing.T) {
	r := setupRouter()
	body := map[string]interface{}{
		"payer_name":    "Kim Jong",
		"payee_name":    "Zhang Wei",
		"amount":        100.00,
		"currency":      "CNY",
		"payer_country": "KP", // North Korea — sanctioned
		"payee_country": "CN",
	}
	b, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/compliance/screen", bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["cleared"] != false {
		t.Error("Expected cleared=false for sanctioned country")
	}
	if resp["sanctions_hit"] != true {
		t.Error("Expected sanctions_hit=true for KP")
	}
}
