// go-sme-trade-service: SME bulk trade payments, Form M documentation, and trade finance for RemitFlow
// Handles China/UAE/India trade corridors, LC support, and CBN Form M compliance.
// Integrates with: Kafka (Dapr pub/sub), TigerBeetle, OpenSearch
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

var (
	port         = getEnv("PORT", "8097")
	daprHTTPPort = getEnv("DAPR_HTTP_PORT", "3500")
	tbURL        = getEnv("TIGERBEETLE_ADDR", "http://localhost:3004")
	osURL        = getEnv("OPENSEARCH_URL", "http://localhost:9200")
)

const (
	MaxPaymentsPerBatch = 500
	FormMThresholdUSD   = 10000.0
)

type Payment struct {
	ID            string  `json:"id"`
	BatchID       string  `json:"batch_id"`
	RecipientName string  `json:"recipient_name"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	Status        string  `json:"status"`
	Reference     string  `json:"reference"`
	BankAccount   string  `json:"bank_account,omitempty"`
	SwiftCode     string  `json:"swift_code,omitempty"`
}

type BulkBatch struct {
	ID           string    `json:"id"`
	Status       string    `json:"status"`
	Payments     []Payment `json:"payments"`
	TotalAmtNGN  float64   `json:"total_amount_ngn"`
	Currency     string    `json:"currency"`
	CorridorCode string    `json:"corridor_code"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type FormM struct {
	ID               string    `json:"id"`
	ImporterName     string    `json:"importer_name"`
	ExporterName     string    `json:"exporter_name"`
	GoodsDescription string    `json:"goods_description"`
	ValueUSD         float64   `json:"value_usd"`
	CorridorCode     string    `json:"corridor_code"`
	Status           string    `json:"status"`
	CBNReference     string    `json:"cbn_reference,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type TradeQuoteRequest struct {
	AmountNGN    float64 `json:"amount_ngn"`
	CorridorCode string  `json:"corridor_code"`
	PaymentCount int     `json:"payment_count"`
}

type TradeQuoteResponse struct {
	AmountNGN      float64 `json:"amount_ngn"`
	AmountTarget   float64 `json:"amount_target"`
	TargetCurrency string  `json:"target_currency"`
	FxRate         float64 `json:"fx_rate"`
	FeeNGN         float64 `json:"fee_ngn"`
	TotalNGN       float64 `json:"total_ngn"`
	FormMRequired  bool    `json:"form_m_required"`
	SettlementDays int     `json:"settlement_days"`
}

var (
	batches = make(map[string]BulkBatch)
	formMs  = make(map[string]FormM)
	mu      sync.RWMutex
)

// Trade corridor FX rates and config
var tradeCorridors = map[string]struct {
	Currency       string
	FxRate         float64
	FeePercent     float64
	SettlementDays int
}{
	"CN": {Currency: "CNY", FxRate: 0.0044, FeePercent: 0.010, SettlementDays: 3},
	"AE": {Currency: "AED", FxRate: 0.0022, FeePercent: 0.009, SettlementDays: 2},
	"IN": {Currency: "INR", FxRate: 0.0083, FeePercent: 0.010, SettlementDays: 2},
	"UK": {Currency: "GBP", FxRate: 0.00065, FeePercent: 0.009, SettlementDays: 1},
	"US": {Currency: "USD", FxRate: 0.00062, FeePercent: 0.009, SettlementDays: 1},
}

func publishEvent(topic string, data interface{}) {
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/%s", daprHTTPPort, topic)
	body, _ := json.Marshal(data)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(req)
}

func indexOpenSearch(index, id string, doc interface{}) {
	body, _ := json.Marshal(doc)
	url := fmt.Sprintf("%s/%s/_doc/%s", osURL, index, id)
	req, _ := http.NewRequest("PUT", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	client.Do(req)
}

func handleCreateBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var batch BulkBatch
	if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if len(batch.Payments) > MaxPaymentsPerBatch {
		http.Error(w, fmt.Sprintf("Maximum %d payments per batch", MaxPaymentsPerBatch), http.StatusBadRequest)
		return
	}
	batch.ID = fmt.Sprintf("BATCH-%d", time.Now().UnixNano())
	batch.Status = "pending"
	batch.CreatedAt = time.Now()
	batch.UpdatedAt = time.Now()
	// Assign payment IDs
	for i := range batch.Payments {
		batch.Payments[i].ID = fmt.Sprintf("PAY-%d-%d", time.Now().UnixNano(), i)
		batch.Payments[i].BatchID = batch.ID
		batch.Payments[i].Status = "pending"
	}
	mu.Lock()
	batches[batch.ID] = batch
	mu.Unlock()
	// Record in TigerBeetle
	tbPayload := map[string]interface{}{
		"entry_type": "sme_batch_created", "batch_id": batch.ID,
		"payment_count": len(batch.Payments), "total_ngn": batch.TotalAmtNGN,
	}
	tbBody, _ := json.Marshal(tbPayload)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	tbReq, _ := http.NewRequestWithContext(ctx, "POST", tbURL+"/accounts", bytes.NewReader(tbBody))
	tbReq.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(tbReq)
	go indexOpenSearch("sme-batches", batch.ID, batch)
	publishEvent("sme-trade-events", map[string]interface{}{
		"event": "batch_created", "batch_id": batch.ID, "payment_count": len(batch.Payments),
	})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(batch)
}

func handleGetBatch(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Path[len("/bulk-batch/"):]
	mu.RLock()
	batch, ok := batches[id]
	mu.RUnlock()
	if !ok {
		http.Error(w, "Batch not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(batch)
}

func handleCreateFormM(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var fm FormM
	if err := json.NewDecoder(r.Body).Decode(&fm); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	fm.ID = fmt.Sprintf("FORMM-%d", time.Now().UnixNano())
	fm.Status = "draft"
	fm.CBNReference = fmt.Sprintf("CBN-FM-%d", time.Now().Unix())
	fm.CreatedAt = time.Now()
	fm.UpdatedAt = time.Now()
	mu.Lock()
	formMs[fm.ID] = fm
	mu.Unlock()
	publishEvent("sme-trade-events", map[string]interface{}{
		"event": "form_m_created", "form_m_id": fm.ID, "value_usd": fm.ValueUSD,
	})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(fm)
}

func handleGetFormM(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Path[len("/form-m/"):]
	mu.RLock()
	fm, ok := formMs[id]
	mu.RUnlock()
	if !ok {
		http.Error(w, "Form M not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(fm)
}

func handleQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req TradeQuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	corridor, ok := tradeCorridors[req.CorridorCode]
	if !ok {
		http.Error(w, fmt.Sprintf("Trade corridor %s not supported", req.CorridorCode), http.StatusBadRequest)
		return
	}
	feeNGN := req.AmountNGN * corridor.FeePercent
	amountTarget := req.AmountNGN * corridor.FxRate
	amountUSD := req.AmountNGN / 1620.0
	resp := TradeQuoteResponse{
		AmountNGN:      req.AmountNGN,
		AmountTarget:   amountTarget,
		TargetCurrency: corridor.Currency,
		FxRate:         corridor.FxRate,
		FeeNGN:         feeNGN,
		TotalNGN:       req.AmountNGN + feeNGN,
		FormMRequired:  amountUSD > FormMThresholdUSD,
		SettlementDays: corridor.SettlementDays,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok", "service": "go-sme-trade-service",
		"batches": len(batches), "form_ms": len(formMs),
		"supported_corridors": len(tradeCorridors),
		"timestamp": time.Now().Unix(),
	})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}


func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || r.URL.Path == "/healthz" || r.URL.Path == "/ready" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		key := os.Getenv("INTERNAL_SERVICE_KEY")
		if key == "" {
			key = "remitflow-internal-2026"
		}
		if apiKey := r.Header.Get("X-API-Key"); apiKey == key {
			next.ServeHTTP(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if len(auth) > 7 && auth[:7] == "Bearer " && auth[7:] == key {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"unauthorized"}`))
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/bulk-batch", handleCreateBatch)
	mux.HandleFunc("/bulk-batch/", handleGetBatch)
	mux.HandleFunc("/form-m", handleCreateFormM)
	mux.HandleFunc("/form-m/", handleGetFormM)
	mux.HandleFunc("/quote", handleQuote)
	log.Printf("[go-sme-trade-service] Starting on :%s", port)
	if err := http.ListenAndServe(":"+port, authMiddleware(mux)); err != nil {
		log.Fatalf("[go-sme-trade-service] Server failed: %v", err)
	}
}
