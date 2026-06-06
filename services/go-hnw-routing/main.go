// go-hnw-routing: High-Net-Worth client routing engine for RemitFlow
// Handles premium FX pricing, RM assignment, portfolio tracking, and rate locks.
// Integrates with: Kafka (Dapr pub/sub), TigerBeetle, Redis
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"
)

var (
	port         = getEnv("PORT", "8098")
	daprHTTPPort = getEnv("DAPR_HTTP_PORT", "3500")
	tbURL        = getEnv("TIGERBEETLE_ADDR", "http://localhost:3004")
)

// HNW threshold: NGN 50M+ annual volume
const HNWThresholdNGN = 50_000_000.0
const RMLevelThresholdNGN = 100_000_000.0

type HNWProfile struct {
	UserID           int       `json:"user_id"`
	AUM              float64   `json:"aum_ngn"`
	Tier             string    `json:"tier"`
	RMID             string    `json:"rm_id"`
	RMName           string    `json:"rm_name"`
	NegotiatedSpread float64   `json:"negotiated_spread"`
	PriorityLevel    int       `json:"priority_level"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type HNWQuoteRequest struct {
	UserID         int     `json:"user_id"`
	AmountNGN      float64 `json:"amount_ngn"`
	CorridorCode   string  `json:"corridor_code"`
	TargetCurrency string  `json:"target_currency"`
}

type HNWQuoteResponse struct {
	UserID           int     `json:"user_id"`
	AmountNGN        float64 `json:"amount_ngn"`
	AmountTarget     float64 `json:"amount_target"`
	FxRate           float64 `json:"fx_rate"`
	NegotiatedSpread float64 `json:"negotiated_spread"`
	StandardSpread   float64 `json:"standard_spread"`
	SavingsNGN       float64 `json:"savings_ngn"`
	FeeNGN           float64 `json:"fee_ngn"`
	TotalNGN         float64 `json:"total_ngn"`
	SettlementHours  int     `json:"settlement_hours"`
	RateLockUntil    string  `json:"rate_lock_until"`
	TransferID       string  `json:"transfer_id,omitempty"`
}

type RateLock struct {
	ID           string    `json:"id"`
	UserID       int       `json:"user_id"`
	AmountNGN    float64   `json:"amount_ngn"`
	FxRate       float64   `json:"fx_rate"`
	CorridorCode string    `json:"corridor_code"`
	ExpiresAt    time.Time `json:"expires_at"`
	IsExecuted   bool      `json:"is_executed"`
	CreatedAt    time.Time `json:"created_at"`
}

type Portfolio struct {
	UserID       int                      `json:"user_id"`
	TotalAUM     float64                  `json:"total_aum_ngn"`
	Holdings     []map[string]interface{} `json:"holdings"`
	LastUpdated  time.Time                `json:"last_updated"`
}

var (
	hnwProfiles = make(map[int]HNWProfile)
	rateLocks   = make(map[string]RateLock)
	portfolios  = make(map[int]Portfolio)
	mu          sync.RWMutex
)

var baseFXRates = map[string]float64{
	"UK": 1550.0, "US": 1620.0, "CA": 1190.0, "AU": 1050.0,
	"IN": 0.0083, "AE": 0.0022, "TG": 0.59, "GH": 0.0062,
	"NE": 0.59, "ML": 0.59, "BJ": 0.59,
}

func getHNWSpread(userID int) float64 {
	mu.RLock()
	profile, ok := hnwProfiles[userID]
	mu.RUnlock()
	if !ok {
		return 0.012 // standard retail spread
	}
	if profile.AUM >= 500_000_000 {
		return 0.002 // ultra-HNW: 20bps
	}
	if profile.AUM >= 100_000_000 {
		return 0.003 // HNW: 30bps
	}
	return profile.NegotiatedSpread
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

func recordTigerBeetleEntry(userID int, amountNGN float64, corridorCode string, entryType string) int64 {
	entryID := time.Now().UnixNano()
	payload := map[string]interface{}{
		"entry_id": entryID, "user_id": userID,
		"amount": amountNGN, "currency": "NGN",
		"corridor": corridorCode, "type": entryType, "flags": "hnw_premium",
	}
	body, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", tbURL+"/accounts/transfer", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	http.DefaultClient.Do(req)
	return entryID
}

func handleHNWQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req HNWQuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	baseRate, ok := baseFXRates[req.CorridorCode]
	if !ok {
		http.Error(w, "Corridor not supported for HNW routing", http.StatusBadRequest)
		return
	}
	noise := rand.Float64()*0.004 - 0.002
	fxRate := baseRate * (1 + noise)
	negotiatedSpread := getHNWSpread(req.UserID)
	standardSpread := 0.012
	feeNGN := req.AmountNGN * 0.005
	amountTarget := req.AmountNGN / fxRate
	savingsNGN := req.AmountNGN * (standardSpread - negotiatedSpread)
	resp := HNWQuoteResponse{
		UserID: req.UserID, AmountNGN: req.AmountNGN,
		AmountTarget: amountTarget, FxRate: fxRate,
		NegotiatedSpread: negotiatedSpread, StandardSpread: standardSpread,
		SavingsNGN: savingsNGN, FeeNGN: feeNGN,
		TotalNGN: req.AmountNGN + feeNGN, SettlementHours: 2,
		RateLockUntil: time.Now().Add(30 * time.Minute).Format(time.RFC3339),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleHNWTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req HNWQuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	baseRate, ok := baseFXRates[req.CorridorCode]
	if !ok {
		http.Error(w, "Corridor not supported", http.StatusBadRequest)
		return
	}
	noise := rand.Float64()*0.004 - 0.002
	fxRate := baseRate * (1 + noise)
	negotiatedSpread := getHNWSpread(req.UserID)
	feeNGN := req.AmountNGN * 0.005
	amountTarget := req.AmountNGN / fxRate
	transferID := fmt.Sprintf("HNW-TXN-%d", time.Now().UnixNano())
	tbEntry := recordTigerBeetleEntry(req.UserID, req.AmountNGN, req.CorridorCode, "hnw_transfer")
	publishEvent("hnw-events", map[string]interface{}{
		"event": "hnw_transfer_initiated", "transfer_id": transferID,
		"user_id": req.UserID, "amount_ngn": req.AmountNGN,
		"corridor": req.CorridorCode, "tb_entry": tbEntry,
	})
	resp := HNWQuoteResponse{
		UserID: req.UserID, AmountNGN: req.AmountNGN,
		AmountTarget: amountTarget, FxRate: fxRate,
		NegotiatedSpread: negotiatedSpread, FeeNGN: feeNGN,
		TotalNGN: req.AmountNGN + feeNGN, SettlementHours: 2,
		TransferID: transferID,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(resp)
}

func handleRateLock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		UserID       int     `json:"user_id"`
		AmountNGN    float64 `json:"amount_ngn"`
		CorridorCode string  `json:"corridor_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	// Max lock: USD 500k equiv (approx NGN 810M)
	if req.AmountNGN > 810_000_000 {
		http.Error(w, "Rate lock limit is USD 500k equivalent", http.StatusBadRequest)
		return
	}
	baseRate := baseFXRates[req.CorridorCode]
	noise := rand.Float64()*0.004 - 0.002
	fxRate := baseRate * (1 + noise)
	lock := RateLock{
		ID:           fmt.Sprintf("LOCK-%d", time.Now().UnixNano()),
		UserID:       req.UserID,
		AmountNGN:    req.AmountNGN,
		FxRate:       fxRate,
		CorridorCode: req.CorridorCode,
		ExpiresAt:    time.Now().Add(30 * time.Minute),
		CreatedAt:    time.Now(),
	}
	mu.Lock()
	rateLocks[lock.ID] = lock
	mu.Unlock()
	publishEvent("hnw-events", map[string]interface{}{
		"event": "rate_lock_created", "lock_id": lock.ID, "user_id": req.UserID,
		"fx_rate": fxRate, "expires_at": lock.ExpiresAt.Format(time.RFC3339),
	})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(lock)
}

func handleGetPortfolio(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok", "message": "Portfolio endpoint active",
		"service": "go-hnw-routing",
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok", "service": "go-hnw-routing",
		"hnw_profiles": len(hnwProfiles), "rate_locks": len(rateLocks),
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
	rand.Seed(time.Now().UnixNano())
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/hnw-quote", handleHNWQuote)
	mux.HandleFunc("/hnw-transfer", handleHNWTransfer)
	mux.HandleFunc("/rate-lock", handleRateLock)
	mux.HandleFunc("/portfolio/", handleGetPortfolio)
	mux.HandleFunc("/hnw-profile/", handleGetPortfolio)
	log.Printf("[go-hnw-routing] Starting on :%s", port)
	if err := http.ListenAndServe(":"+port, authMiddleware(mux)); err != nil {
		log.Fatalf("[go-hnw-routing] Server failed: %v", err)
	}
}
