package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type RateResponse struct {
	Base  string             `json:"base"`
	Rates map[string]float64 `json:"rates"`
	Time  int64              `json:"time"`
}

type QuoteRequest struct {
	From   string  `json:"from" binding:"required"`
	To     string  `json:"to" binding:"required"`
	Amount float64 `json:"amount" binding:"required,gt=0"`
	FSP    string  `json:"fsp"` // payment rail: remitflow, wise, mpesa
}

type QuoteResponse struct {
	From          string  `json:"from"`
	To            string  `json:"to"`
	SendAmount    float64 `json:"sendAmount"`
	ReceiveAmount float64 `json:"receiveAmount"`
	Rate          float64 `json:"rate"`
	FXRate        float64 `json:"fxRate"`
	Fee           float64 `json:"fee"`
	TotalCost     float64 `json:"totalCost"`
	Spread        float64 `json:"spread"`
	FSP           string  `json:"fsp"`
	ExpiresAt     int64   `json:"expiresAt"`
	SendAmountSnake    float64 `json:"send_amount"`
	ReceiveAmountSnake float64 `json:"receive_amount"`
}

type ExecuteRequest struct {
	From        string  `json:"from" binding:"required"`
	To          string  `json:"to" binding:"required"`
	Amount      float64 `json:"amount" binding:"required,gt=0"`
	RecipientID string  `json:"recipientId" binding:"required"`
	UserID      string  `json:"userId" binding:"required"`
	Reference   string  `json:"reference"`
	FSP         string  `json:"fsp"`
}

type ExecuteResponse struct {
	TransactionID string  `json:"transactionId"`
	Status        string  `json:"status"`
	FXRate        float64 `json:"fxRate"`
	Fee           float64 `json:"fee"`
	ReceiveAmount float64 `json:"receiveAmount"`
	AuditEvent    string  `json:"auditEvent"`
	Timestamp     int64   `json:"timestamp"`
}

type Corridor struct {
	From        string  `json:"from"`
	To          string  `json:"to"`
	MinAmount   float64 `json:"minAmount"`
	MaxAmount   float64 `json:"maxAmount"`
	AvgFeeUSD   float64 `json:"avgFeeUSD"`
	SpeedHours  float64 `json:"speedHours"`
	Popular     bool    `json:"popular"`
}

// ─── Globals ──────────────────────────────────────────────────────────────────

var (
	rdb         *redis.Client
	ratesAPIKey = os.Getenv("EXCHANGE_RATE_API_KEY") // optional; falls back to free tier
)

// Spread per FSP (basis points above mid-rate)
var fspSpreads = map[string]float64{
	"remitflow": 0.015, // 1.5%
	"wise":      0.005, // 0.5%
	"mpesa":     0.020, // 2.0%
	"default":   0.015,
}

// Fee schedule: flat USD fee per FSP
var fspFees = map[string]float64{
	"remitflow": 3.99,
	"wise":      1.50,
	"mpesa":     2.50,
	"default":   3.99,
}

var corridors = []Corridor{
	{From: "GBP", To: "NGN", MinAmount: 10, MaxAmount: 50000, AvgFeeUSD: 4.50, SpeedHours: 0.5, Popular: true},
	{From: "USD", To: "NGN", MinAmount: 10, MaxAmount: 50000, AvgFeeUSD: 3.99, SpeedHours: 0.5, Popular: true},
	{From: "USD", To: "KES", MinAmount: 10, MaxAmount: 25000, AvgFeeUSD: 3.50, SpeedHours: 0.25, Popular: true},
	{From: "GBP", To: "GHS", MinAmount: 10, MaxAmount: 20000, AvgFeeUSD: 4.00, SpeedHours: 1.0, Popular: true},
	{From: "EUR", To: "XOF", MinAmount: 10, MaxAmount: 30000, AvgFeeUSD: 3.75, SpeedHours: 1.0, Popular: false},
	{From: "USD", To: "TZS", MinAmount: 10, MaxAmount: 15000, AvgFeeUSD: 3.50, SpeedHours: 2.0, Popular: false},
	{From: "CAD", To: "NGN", MinAmount: 10, MaxAmount: 20000, AvgFeeUSD: 4.25, SpeedHours: 1.0, Popular: false},
	{From: "AUD", To: "KES", MinAmount: 10, MaxAmount: 15000, AvgFeeUSD: 4.00, SpeedHours: 2.0, Popular: false},
	{From: "USD", To: "RWF", MinAmount: 10, MaxAmount: 10000, AvgFeeUSD: 3.25, SpeedHours: 0.5, Popular: false},
	{From: "GBP", To: "ZMW", MinAmount: 10, MaxAmount: 10000, AvgFeeUSD: 4.50, SpeedHours: 2.0, Popular: false},
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

func initRedis() {
	addr := os.Getenv("REDIS_URL")
	if addr == "" {
		addr = "localhost:6379"
	}
	rdb = redis.NewClient(&redis.Options{Addr: addr})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("[FX] Redis unavailable (%v) — rate caching disabled", err)
		rdb = nil
	} else {
		log.Printf("[FX] Redis connected at %s", addr)
	}
}

func cacheGet(key string) (string, bool) {
	if rdb == nil {
		return "", false
	}
	val, err := rdb.Get(context.Background(), key).Result()
	if err != nil {
		return "", false
	}
	return val, true
}

func cacheSet(key, value string, ttl time.Duration) {
	if rdb == nil {
		return
	}
	rdb.Set(context.Background(), key, value, ttl)
}

// ─── FX Rate fetching ─────────────────────────────────────────────────────────

func fetchRates(base string) (map[string]float64, error) {
	cacheKey := "fx:rates:" + strings.ToUpper(base)
	if cached, ok := cacheGet(cacheKey); ok {
		var rates map[string]float64
		if err := json.Unmarshal([]byte(cached), &rates); err == nil {
			return rates, nil
		}
	}

	url := fmt.Sprintf("https://open.er-api.com/v6/latest/%s", strings.ToUpper(base))
	if ratesAPIKey != "" {
		url = fmt.Sprintf("https://v6.exchangerate-api.com/v6/%s/latest/%s", ratesAPIKey, strings.ToUpper(base))
	}

	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("rate fetch failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Rates map[string]float64 `json:"rates"`
	}
	if err := json.Unmarshal(body, &result); err != nil || result.Rates == nil {
		return nil, fmt.Errorf("rate parse failed")
	}

	if data, err := json.Marshal(result.Rates); err == nil {
		cacheSet(cacheKey, string(data), 5*time.Minute)
	}
	return result.Rates, nil
}

func getMidRate(from, to string) (float64, error) {
	rates, err := fetchRates(from)
	if err != nil {
		return 0, err
	}
	rate, ok := rates[strings.ToUpper(to)]
	if !ok {
		return 0, fmt.Errorf("unsupported currency pair %s/%s", from, to)
	}
	return rate, nil
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func handleHealth(c *gin.Context) {
	c.JSON(200, gin.H{"status": "ok", "service": "fx-engine", "version": "1.0.0"})
}

func handleRates(c *gin.Context) {
	base := c.DefaultQuery("from", "USD")
	rates, err := fetchRates(base)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, RateResponse{
		Base:  strings.ToUpper(base),
		Rates: rates,
		Time:  time.Now().Unix(),
	})
}

var validCurrencies = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "NGN": true, "GHS": true, "KES": true,
	"ZAR": true, "TZS": true, "UGX": true, "RWF": true, "XOF": true, "XAF": true,
	"EGP": true, "MAD": true, "BRL": true, "INR": true, "CNY": true, "JPY": true,
	"CAD": true, "AUD": true, "CHF": true, "SEK": true, "NOK": true, "DKK": true,
	"MXN": true, "ARS": true, "COP": true, "PEN": true, "CLP": true, "PHP": true,
	"THB": true, "IDR": true, "MYR": true, "SGD": true, "HKD": true, "TWD": true,
	"KRW": true, "AED": true, "SAR": true, "QAR": true, "BHD": true, "OMR": true,
}

func handleSingleRate(c *gin.Context) {
	from := strings.ToUpper(c.DefaultQuery("from", "USD"))
	to := strings.ToUpper(c.DefaultQuery("to", "NGN"))
	if !validCurrencies[from] || !validCurrencies[to] {
		c.JSON(400, gin.H{"error": "invalid currency pair"})
		return
	}
	rates, err := fetchRates(from)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	rate, ok := rates[to]
	if !ok {
		c.JSON(404, gin.H{"error": "pair not found"})
		return
	}
	c.JSON(200, gin.H{"from": from, "to": to, "rate": rate, "timestamp": time.Now().Unix()})
}

func handleQuote(c *gin.Context) {
	var req QuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	midRate, err := getMidRate(req.From, req.To)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}

	fsp := req.FSP
	if fsp == "" {
		fsp = "remitflow"
	}
	spread := fspSpreads[fsp]
	if spread == 0 {
		spread = fspSpreads["default"]
	}
	fee := fspFees[fsp]
	if fee == 0 {
		fee = fspFees["default"]
	}

	// Apply spread to mid-rate
	appliedRate := midRate * (1 - spread)
	receiveAmount := math.Round((req.Amount-fee)*appliedRate*100) / 100
	if receiveAmount < 0 {
		receiveAmount = 0
	}

	roundedRate := math.Round(appliedRate*10000) / 10000
	c.JSON(200, QuoteResponse{
		From:               req.From,
		To:                 req.To,
		SendAmount:         req.Amount,
		ReceiveAmount:      receiveAmount,
		Rate:               roundedRate,
		FXRate:             roundedRate,
		Fee:                fee,
		TotalCost:          req.Amount,
		Spread:             spread,
		FSP:                fsp,
		ExpiresAt:          time.Now().Add(5 * time.Minute).Unix(),
		SendAmountSnake:    req.Amount,
		ReceiveAmountSnake: receiveAmount,
	})
}

func handleExecute(c *gin.Context) {
	var req ExecuteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	midRate, err := getMidRate(req.From, req.To)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}

	fsp := req.FSP
	if fsp == "" {
		fsp = "remitflow"
	}
	spread := fspSpreads[fsp]
	fee := fspFees[fsp]
	appliedRate := midRate * (1 - spread)
	receiveAmount := math.Round((req.Amount-fee)*appliedRate*100) / 100

	txID := fmt.Sprintf("TXN-%d-%s", time.Now().UnixMilli(), strings.ToUpper(req.From[:3]))
	auditEvent := fmt.Sprintf("TRANSFER_EXECUTED user=%s from=%s to=%s amount=%.2f rate=%.4f fee=%.2f receive=%.2f fsp=%s txid=%s",
		req.UserID, req.From, req.To, req.Amount, appliedRate, fee, receiveAmount, fsp, txID)

	log.Printf("[FX] %s", auditEvent)

	c.JSON(200, ExecuteResponse{
		TransactionID: txID,
		Status:        "processing",
		FXRate:        math.Round(appliedRate*10000) / 10000,
		Fee:           fee,
		ReceiveAmount: receiveAmount,
		AuditEvent:    auditEvent,
		Timestamp:     time.Now().Unix(),
	})
}

func handleCorridors(c *gin.Context) {
	from := c.Query("from")
	to := c.Query("to")
	result := corridors
	if from != "" || to != "" {
		var filtered []Corridor
		for _, cor := range corridors {
			if (from == "" || strings.EqualFold(cor.From, from)) &&
				(to == "" || strings.EqualFold(cor.To, to)) {
				filtered = append(filtered, cor)
			}
		}
		result = filtered
	}
	c.JSON(200, gin.H{"corridors": result, "count": len(result)})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	initRedis()

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// CORS — use env-based origin in production
	r.Use(func(c *gin.Context) {
		origin := os.Getenv("CORS_ALLOWED_ORIGIN")
		if origin == "" && os.Getenv("NODE_ENV") != "production" {
			origin = c.GetHeader("Origin")
		}
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	r.GET("/health", handleHealth)
	r.GET("/rates", handleRates)
	r.GET("/rate", handleSingleRate)
	r.POST("/quote", handleQuote)
	r.POST("/execute", handleExecute)
	r.GET("/corridors", handleCorridors)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	log.Printf("[FX] RemitFlow FX Engine starting on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[FX] Server failed: %v", err)
	}
}
