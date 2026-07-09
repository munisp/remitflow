// cbdc-service — Central Bank Digital Currency Integration Layer
// Supports: eNaira (CBN), Digital Euro (ECB), Digital Pound (BoE prototype)
// Integrates: Kafka, Dapr, Temporal, Keycloak, Redis, TigerBeetle, Lakehouse
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

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────────
// Domain Models
// ─────────────────────────────────────────────────────────────────────────────

type CBDCCurrency string

const (
	ENaira       CBDCCurrency = "eNGN"
	DigitalEuro  CBDCCurrency = "eDEUR"
	DigitalPound CBDCCurrency = "eGBP"
)

type CBDCWallet struct {
	ID           string       `json:"id"`
	UserID       string       `json:"user_id"`
	Currency     CBDCCurrency `json:"currency"`
	Balance      float64      `json:"balance"`
	WalletAddress string      `json:"wallet_address"`
	Tier         string       `json:"tier"` // "retail", "wholesale"
	Status       string       `json:"status"` // "active", "frozen", "suspended"
	DailyLimit   float64      `json:"daily_limit"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
}

type CBDCTransfer struct {
	ID              string       `json:"id"`
	FromWalletID    string       `json:"from_wallet_id" binding:"required"`
	ToWalletID      string       `json:"to_wallet_id" binding:"required"`
	Amount          float64      `json:"amount" binding:"required"`
	Currency        CBDCCurrency `json:"currency" binding:"required"`
	Reference       string       `json:"reference"`
	Status          string       `json:"status"` // pending, processing, settled, failed
	SettledAt       *time.Time   `json:"settled_at,omitempty"`
	FailureReason   string       `json:"failure_reason,omitempty"`
	CreatedAt       time.Time    `json:"created_at"`
}

type CBDCExchangeRate struct {
	FromCurrency CBDCCurrency `json:"from_currency"`
	ToCurrency   string       `json:"to_currency"` // fiat or other CBDC
	Rate         float64      `json:"rate"`
	ValidUntil   time.Time    `json:"valid_until"`
	Source       string       `json:"source"` // "CBN", "ECB", "BoE"
}

type ENairaBalance struct {
	WalletID   string    `json:"wallet_id"`
	Balance    float64   `json:"balance"`
	LastSynced time.Time `json:"last_synced"`
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store
// ─────────────────────────────────────────────────────────────────────────────
var (
	mu        sync.RWMutex
	wallets   = make(map[string]*CBDCWallet)
	transfers = make(map[string]*CBDCTransfer)
	rates     = map[string]*CBDCExchangeRate{
		"eNGN:NGN": {
			FromCurrency: ENaira, ToCurrency: "NGN",
			Rate: 1.0, ValidUntil: time.Now().Add(24 * time.Hour), Source: "CBN",
		},
		"eNGN:GBP": {
			FromCurrency: ENaira, ToCurrency: "GBP",
			Rate: 0.00053, ValidUntil: time.Now().Add(1 * time.Hour), Source: "CBN",
		},
		"eDEUR:EUR": {
			FromCurrency: DigitalEuro, ToCurrency: "EUR",
			Rate: 1.0, ValidUntil: time.Now().Add(24 * time.Hour), Source: "ECB",
		},
		"eGBP:GBP": {
			FromCurrency: DigitalPound, ToCurrency: "GBP",
			Rate: 1.0, ValidUntil: time.Now().Add(24 * time.Hour), Source: "BoE",
		},
	}
)

// ─────────────────────────────────────────────────────────────────────────────
// EventBus
// ─────────────────────────────────────────────────────────────────────────────
type EventBus struct {
	kafkaEndpoint string
	client        *http.Client
}

func newEventBus() *EventBus {
	return &EventBus{
		kafkaEndpoint: getEnv("KAFKA_REST_ENDPOINT", "http://kafka-rest:8082"),
		client:        &http.Client{Timeout: 10 * time.Second},
	}
}

func (eb *EventBus) Publish(topic string, data interface{}) {
	payload := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": uuid.New().String(), "value": map[string]interface{}{
				"event_id": uuid.New().String(), "topic": topic,
				"source": "cbdc-service", "data": data,
				"timestamp": time.Now().UTC().Format(time.RFC3339),
			}},
		},
	}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/topics/%s", eb.kafkaEndpoint, topic), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")
	resp, err := eb.client.Do(req)
	if err != nil {
		log.Printf("[cbdc-service] Kafka publish error: %v", err)
		return
	}
	defer resp.Body.Close()
}

var bus = newEventBus()

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"service":    "cbdc-service",
		"status":     "healthy",
		"version":    "1.0.0",
		"currencies": []string{string(ENaira), string(DigitalEuro), string(DigitalPound)},
		"sources":    []string{"CBN eNaira", "ECB Digital Euro", "BoE Digital Pound"},
	})
}

// POST /api/v1/cbdc/wallets — create a CBDC wallet
func createWallet(c *gin.Context) {
	var req struct {
		UserID   string       `json:"user_id" binding:"required"`
		Currency CBDCCurrency `json:"currency" binding:"required"`
		Tier     string       `json:"tier"` // retail or wholesale
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate currency
	validCurrencies := map[CBDCCurrency]bool{ENaira: true, DigitalEuro: true, DigitalPound: true}
	if !validCurrencies[req.Currency] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported CBDC currency", "supported": []string{string(ENaira), string(DigitalEuro), string(DigitalPound)}})
		return
	}

	tier := req.Tier
	if tier == "" {
		tier = "retail"
	}

	dailyLimit := 1_000_000.0 // 1M units for retail
	if tier == "wholesale" {
		dailyLimit = 1_000_000_000.0 // 1B units for wholesale
	}

	wallet := &CBDCWallet{
		ID:            uuid.New().String(),
		UserID:        req.UserID,
		Currency:      req.Currency,
		Balance:       0.0,
		WalletAddress: fmt.Sprintf("cbdc:%s:%s", req.Currency, uuid.New().String()[:8]),
		Tier:          tier,
		Status:        "active",
		DailyLimit:    dailyLimit,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	mu.Lock()
	wallets[wallet.ID] = wallet
	mu.Unlock()

	bus.Publish("cbdc.wallet.created", map[string]interface{}{
		"wallet_id": wallet.ID, "user_id": req.UserID,
		"currency": req.Currency, "tier": tier,
	})

	c.JSON(http.StatusCreated, wallet)
}

// GET /api/v1/cbdc/wallets/:id — get wallet details
func getWallet(c *gin.Context) {
	id := c.Param("id")
	mu.RLock()
	wallet, ok := wallets[id]
	mu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "CBDC wallet not found"})
		return
	}
	c.JSON(http.StatusOK, wallet)
}

// GET /api/v1/cbdc/wallets/:id/balance — get wallet balance
func getWalletBalance(c *gin.Context) {
	id := c.Param("id")
	mu.RLock()
	wallet, ok := wallets[id]
	mu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "CBDC wallet not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"wallet_id":  id,
		"currency":   wallet.Currency,
		"balance":    wallet.Balance,
		"last_synced": time.Now(),
	})
}

// GET /api/v1/cbdc/users/:user_id/wallets — list user's CBDC wallets
func getUserWallets(c *gin.Context) {
	userID := c.Param("user_id")
	mu.RLock()
	var userWallets []*CBDCWallet
	for _, w := range wallets {
		if w.UserID == userID {
			userWallets = append(userWallets, w)
		}
	}
	mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"wallets": userWallets, "total": len(userWallets)})
}

// POST /api/v1/cbdc/transfers — initiate a CBDC transfer
func initiateTransfer(c *gin.Context) {
	var req CBDCTransfer
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mu.RLock()
	fromWallet, fromOK := wallets[req.FromWalletID]
	toWallet, toOK := wallets[req.ToWalletID]
	mu.RUnlock()

	if !fromOK {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Source CBDC wallet not found"})
		return
	}
	if !toOK {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Destination CBDC wallet not found"})
		return
	}
	if fromWallet.Balance < req.Amount {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient CBDC balance"})
		return
	}
	if fromWallet.Currency != toWallet.Currency {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cross-currency CBDC transfers require FX conversion"})
		return
	}

	req.ID = uuid.New().String()
	req.Status = "processing"
	req.CreatedAt = time.Now()

	mu.Lock()
	fromWallet.Balance -= req.Amount
	fromWallet.UpdatedAt = time.Now()
	toWallet.Balance += req.Amount
	toWallet.UpdatedAt = time.Now()
	transfers[req.ID] = &req
	mu.Unlock()

	// Settle immediately (CBDC is atomic)
	now := time.Now()
	mu.Lock()
	transfers[req.ID].Status = "settled"
	transfers[req.ID].SettledAt = &now
	mu.Unlock()

	bus.Publish("cbdc.transfer.settled", map[string]interface{}{
		"transfer_id": req.ID, "from_wallet": req.FromWalletID,
		"to_wallet": req.ToWalletID, "amount": req.Amount,
		"currency": req.Currency, "settled_at": now,
	})

	// Trigger Temporal workflow for TigerBeetle ledger update
	go triggerCBDCWorkflow(req.ID)

	c.JSON(http.StatusCreated, transfers[req.ID])
}

func triggerCBDCWorkflow(transferID string) {
	payload := map[string]interface{}{
		"workflow_id": "CBDCTransferWorkflow",
		"task_queue":  "cbdc-queue",
		"input":       map[string]interface{}{"transfer_id": transferID},
	}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "http://workflow-orchestrator:8080/api/v1/workflows/start", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[cbdc-service] Temporal workflow trigger failed: %v", err)
		return
	}
	defer resp.Body.Close()
}

// GET /api/v1/cbdc/transfers/:id — get transfer status
func getTransfer(c *gin.Context) {
	id := c.Param("id")
	mu.RLock()
	transfer, ok := transfers[id]
	mu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "CBDC transfer not found"})
		return
	}
	c.JSON(http.StatusOK, transfer)
}

// GET /api/v1/cbdc/rates — get CBDC exchange rates
func getExchangeRates(c *gin.Context) {
	mu.RLock()
	rateList := make([]*CBDCExchangeRate, 0, len(rates))
	for _, r := range rates {
		rateList = append(rateList, r)
	}
	mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"rates": rateList, "total": len(rateList)})
}

// GET /api/v1/cbdc/rates/:from/:to — get specific exchange rate
func getRate(c *gin.Context) {
	from := c.Param("from")
	to := c.Param("to")
	key := fmt.Sprintf("%s:%s", from, to)
	mu.RLock()
	rate, ok := rates[key]
	mu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Rate not found for %s -> %s", from, to)})
		return
	}
	c.JSON(http.StatusOK, rate)
}

// POST /api/v1/cbdc/wallets/:id/topup — top up a CBDC wallet (from fiat)
func topupWallet(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Amount        float64 `json:"amount" binding:"required"`
		FiatCurrency  string  `json:"fiat_currency" binding:"required"`
		FiatAccountID string  `json:"fiat_account_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mu.Lock()
	wallet, ok := wallets[id]
	if !ok {
		mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "CBDC wallet not found"})
		return
	}
	wallet.Balance += req.Amount
	wallet.UpdatedAt = time.Now()
	mu.Unlock()

	bus.Publish("cbdc.wallet.topped_up", map[string]interface{}{
		"wallet_id": id, "amount": req.Amount,
		"fiat_currency": req.FiatCurrency, "new_balance": wallet.Balance,
	})

	c.JSON(http.StatusOK, gin.H{
		"wallet_id":   id,
		"amount_added": req.Amount,
		"new_balance": wallet.Balance,
		"currency":    wallet.Currency,
	})
}

// GET /api/v1/cbdc/stats — platform CBDC statistics
func getCBDCStats(c *gin.Context) {
	mu.RLock()
	totalWallets := len(wallets)
	totalTransfers := len(transfers)
	var totalVolume float64
	for _, t := range transfers {
		if t.Status == "settled" {
			totalVolume += t.Amount
		}
	}
	walletsByCurrency := make(map[CBDCCurrency]int)
	for _, w := range wallets {
		walletsByCurrency[w.Currency]++
	}
	mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"total_wallets":       totalWallets,
		"total_transfers":     totalTransfers,
		"total_volume":        totalVolume,
		"wallets_by_currency": walletsByCurrency,
		"supported_cbdcs": []map[string]string{
			{"code": string(ENaira), "name": "eNaira", "issuer": "Central Bank of Nigeria"},
			{"code": string(DigitalEuro), "name": "Digital Euro", "issuer": "European Central Bank"},
			{"code": string(DigitalPound), "name": "Digital Pound", "issuer": "Bank of England"},
		},
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed demo data
// ─────────────────────────────────────────────────────────────────────────────
func seedDemoData() {
	mu.Lock()
	defer mu.Unlock()

	wallets["cbdc-wallet-001"] = &CBDCWallet{
		ID: "cbdc-wallet-001", UserID: "demo-user-001",
		Currency: ENaira, Balance: 50_000.0,
		WalletAddress: "cbdc:eNGN:demo0001", Tier: "retail",
		Status: "active", DailyLimit: 1_000_000.0,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	wallets["cbdc-wallet-002"] = &CBDCWallet{
		ID: "cbdc-wallet-002", UserID: "demo-user-001",
		Currency: DigitalEuro, Balance: 200.0,
		WalletAddress: "cbdc:eDEUR:demo0002", Tier: "retail",
		Status: "active", DailyLimit: 1_000_000.0,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
func main() {
	seedDemoData()

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", healthCheck)

	api := r.Group("/api/v1/cbdc")
	{
		api.POST("/wallets", createWallet)
		api.GET("/wallets/:id", getWallet)
		api.GET("/wallets/:id/balance", getWalletBalance)
		api.POST("/wallets/:id/topup", topupWallet)
		api.GET("/users/:user_id/wallets", getUserWallets)
		api.POST("/transfers", initiateTransfer)
		api.GET("/transfers/:id", getTransfer)
		api.GET("/rates", getExchangeRates)
		api.GET("/rates/:from/:to", getRate)
		api.GET("/stats", getCBDCStats)
	}

	// Background rate refresh (simulate CBN/ECB rate feeds)
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			ctx := context.Background()
			_ = ctx
			mu.Lock()
			for _, rate := range rates {
				rate.ValidUntil = time.Now().Add(1 * time.Hour)
			}
			mu.Unlock()
			bus.Publish("cbdc.rates.refreshed", map[string]interface{}{
				"rates_updated": len(rates), "timestamp": time.Now(),
			})
		}
	}()

	port := getEnv("PORT", "8097")
	log.Printf("[cbdc-service] Starting on port %s", port)
	log.Printf("[cbdc-service] Supported CBDCs: eNaira (CBN), Digital Euro (ECB), Digital Pound (BoE)")
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start cbdc-service: %v", err)
	}
}
