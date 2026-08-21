// RemitFlow — Go Stablecoin Engine
//
// On-ramp/off-ramp settlement engine for stablecoin ↔ fiat conversions.
// Handles bank payouts (ACH/SEPA/SWIFT), mobile money disbursement,
// FX rate aggregation, compliance checks, and settlement orchestration.
//
// Port: 8113
//
// Middleware stack:
//   - Kafka: stablecoin.onramp, stablecoin.offramp, stablecoin.settlement events
//   - Dapr: pub/sub for settlement notifications, state store for FX cache
//   - Redis: FX rate cache, idempotency keys, rate limiting
//   - TigerBeetle: double-entry ledger for stablecoin movements
//   - OpenSearch: transaction indexing for AML/compliance
//   - Permify: RBAC for admin operations
//   - Mojaloop: mobile money last-mile delivery
//   - PostgreSQL: settlement records, payout tracking
//
// Supported stablecoins: USDT, USDC, BUSD, DAI, NGNT, cUSD, PYUSD
// Supported chains: Ethereum, Polygon, BSC, Solana, Tron, Arbitrum, Optimism, Base

package main

import (
	"context"
	"crypto/hmac"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

var _processStartTime = time.Now()

var db *sql.DB

// appCfg is the process-wide configuration, set in main().
var appCfg Config

// ── Config ──────────────────────────────────────────────────────────────────

type Config struct {
	Port            string
	DatabaseURL     string
	KafkaBrokers    string
	RedisURL        string
	TigerBeetleAddr string
	MojaloopHubURL  string
	// SanctionsServiceURL is the real sanctions-screening backend (e.g. the
	// AML scorer). No default: if unset, screening fails closed (503).
	SanctionsServiceURL string
	// ChainSettlementURL is the on-chain settlement/minter service. No
	// default: if unset, on-ramp fails closed instead of fabricating a tx hash.
	ChainSettlementURL string
}

func loadConfig() Config {
	return Config{
		Port:            getEnv("STABLECOIN_ENGINE_PORT", "8113"),
		DatabaseURL:     getEnv("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow"),
		KafkaBrokers:    getEnv("KAFKA_BROKERS", "localhost:9092"),
		RedisURL:        getEnv("REDIS_URL", "localhost:6379"),
		TigerBeetleAddr: getEnv("TIGERBEETLE_ADDR", "localhost:3000"),
		MojaloopHubURL:  getEnv("MOJALOOP_HUB_URL", "http://localhost:4001"),
		SanctionsServiceURL: os.Getenv("SANCTIONS_SERVICE_URL"),
		ChainSettlementURL:  os.Getenv("CHAIN_SETTLEMENT_URL"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Types ───────────────────────────────────────────────────────────────────

type FXRate struct {
	Base      string             `json:"base"`
	Rates     map[string]float64 `json:"rates"`
	Timestamp time.Time          `json:"timestamp"`
}

type OnRampRequest struct {
	UserID       int     `json:"userId" binding:"required"`
	FiatCurrency string  `json:"fiatCurrency" binding:"required"`
	FiatAmount   float64 `json:"fiatAmount" binding:"required,gt=0"`
	Stablecoin   string  `json:"stablecoin" binding:"required"`
	Chain        string  `json:"chain"`
}

type OffRampRequest struct {
	UserID           int     `json:"userId" binding:"required"`
	Stablecoin       string  `json:"stablecoin" binding:"required"`
	StablecoinAmount float64 `json:"stablecoinAmount" binding:"required,gt=0"`
	FiatCurrency     string  `json:"fiatCurrency" binding:"required"`
	PayoutRail       string  `json:"payoutRail"`
	BankAccount      string  `json:"bankAccount"`
	BankName         string  `json:"bankName"`
}

type SettlementResult struct {
	OrderID          string  `json:"orderId"`
	Status           string  `json:"status"`
	StablecoinAmount float64 `json:"stablecoinAmount"`
	FiatAmount       float64 `json:"fiatAmount"`
	Fee              float64 `json:"fee"`
	FXRate           float64 `json:"fxRate"`
	PayoutRail       string  `json:"payoutRail,omitempty"`
	EstimatedTime    string  `json:"estimatedTime"`
	TxHash           string  `json:"txHash,omitempty"`
}

type DePegAlert struct {
	Symbol    string  `json:"symbol"`
	Price     float64 `json:"price"`
	Deviation float64 `json:"deviation"`
	Depegged  bool    `json:"depegged"`
	Threshold float64 `json:"threshold"`
}

type YieldPool struct {
	Symbol   string  `json:"symbol"`
	Protocol string  `json:"protocol"`
	APY      float64 `json:"apy"`
	TVL      float64 `json:"tvl"`
	Risk     string  `json:"risk"`
	Chain    string  `json:"chain"`
}

type GasEstimate struct {
	Chain    string  `json:"chain"`
	GasUsd   float64 `json:"gasUsd"`
	GasGwei  int     `json:"gasGwei"`
	BlockTime float64 `json:"blockTime"`
}

// ── FX Rates ────────────────────────────────────────────────────────────────

var fallbackRates = map[string]float64{
	"USD": 1.0, "NGN": 1600.0, "GBP": 0.79, "EUR": 0.92,
	"GHS": 15.5, "KES": 155.0, "ZAR": 18.5, "XOF": 605.0,
	"INR": 83.0, "BRL": 4.95, "CNY": 7.25,
}

var stablecoinRates = map[string]float64{
	"USDT": 1.0, "USDC": 1.0, "BUSD": 1.0, "DAI": 1.0,
	"PYUSD": 1.0, "NGNT": 1.0 / 1600.0, "cUSD": 1.0,
}

func getFXRate(from, to string) float64 {
	fromRate, ok1 := fallbackRates[strings.ToUpper(from)]
	toRate, ok2 := fallbackRates[strings.ToUpper(to)]
	if !ok1 {
		fromRate = 1.0
	}
	if !ok2 {
		toRate = 1.0
	}
	return toRate / fromRate
}

// ── Sanctions Screening ─────────────────────────────────────────────────────

type SanctionsResult struct {
	Name        string `json:"name"`
	Sanctioned  bool   `json:"isSanctioned"`
	RiskLevel   string `json:"riskLevel"`
	Action      string `json:"action"`
}

// errScreeningUnavailable marks a fail-closed sanctions-screening outage.
var errScreeningUnavailable = fmt.Errorf("SANCTIONS_SCREENING_UNAVAILABLE")

// screeningHTTP is the client used to reach the sanctions backend; a package
// var so tests can stub it.
var screeningHTTP = &http.Client{Timeout: 8 * time.Second}

// screenSanctions checks a name against the configured sanctions-screening
// backend (OFAC/UN/EU lists). FAIL CLOSED: if no backend is configured or the
// backend errors/does not answer 200, it returns an error — the caller must
// refuse the transaction. It never pattern-matches the name locally.
func screenSanctions(name string) (SanctionsResult, error) {
	if appCfg.SanctionsServiceURL == "" {
		return SanctionsResult{}, fmt.Errorf("%w: SANCTIONS_SERVICE_URL is not set", errScreeningUnavailable)
	}
	body, err := json.Marshal(map[string]string{"name": name})
	if err != nil {
		return SanctionsResult{}, err
	}
	req, err := http.NewRequest(http.MethodPost,
		strings.TrimRight(appCfg.SanctionsServiceURL, "/")+"/screen", strings.NewReader(string(body)))
	if err != nil {
		return SanctionsResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := screeningHTTP.Do(req)
	if err != nil {
		return SanctionsResult{}, fmt.Errorf("%w: backend unreachable: %v", errScreeningUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		return SanctionsResult{}, fmt.Errorf("%w: backend returned status %d", errScreeningUnavailable, resp.StatusCode)
	}
	var out struct {
		Sanctioned bool   `json:"isSanctioned"`
		RiskLevel  string `json:"riskLevel"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&out); err != nil {
		return SanctionsResult{}, fmt.Errorf("%w: undecodable backend response: %v", errScreeningUnavailable, err)
	}
	action := "allow"
	risk := out.RiskLevel
	if out.Sanctioned {
		action = "block"
		if risk == "" {
			risk = "high"
		}
	} else if risk == "" {
		risk = "low"
	}
	return SanctionsResult{
		Name:       name,
		Sanctioned: out.Sanctioned,
		RiskLevel:  risk,
		Action:     action,
	}, nil
}

// ── Settlement Engine ───────────────────────────────────────────────────────

var settlementCounter int64

func processOnRamp(req OnRampRequest) (*SettlementResult, error) {
	fxRate := getFXRate(req.FiatCurrency, "USD")
	stableRate := stablecoinRates[req.Stablecoin]
	if stableRate == 0 {
		stableRate = 1.0
	}

	usdAmount := req.FiatAmount * fxRate
	stablecoinAmount := usdAmount / stableRate
	fee := req.FiatAmount * 0.005 // 0.5% on-ramp fee

	orderID := fmt.Sprintf("ONRAMP-%s", uuid.New().String()[:8])
	atomic.AddInt64(&settlementCounter, 1)

	// FAIL CLOSED: an on-ramp order is only "settled" when the configured
	// on-chain settlement service confirms a real transaction hash. Never
	// fabricate a tx hash.
	if appCfg.ChainSettlementURL == "" {
		return nil, fmt.Errorf("NOT_CONFIGURED: CHAIN_SETTLEMENT_URL is not set; on-ramp order %s was NOT settled", orderID)
	}
	settleBody, err := json.Marshal(map[string]interface{}{
		"order_id":         orderID,
		"user_id":          req.UserID,
		"stablecoin":       req.Stablecoin,
		"stablecoin_amount": math.Round(stablecoinAmount*1e6) / 1e6,
		"chain":            req.Chain,
	})
	if err != nil {
		return nil, err
	}
	settleReq, err := http.NewRequest(http.MethodPost,
		strings.TrimRight(appCfg.ChainSettlementURL, "/")+"/v1/mint", strings.NewReader(string(settleBody)))
	if err != nil {
		return nil, err
	}
	settleReq.Header.Set("Content-Type", "application/json")
	resp, err := screeningHTTP.Do(settleReq)
	if err != nil {
		return nil, fmt.Errorf("chain settlement unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("chain settlement rejected on-ramp order %s (HTTP %d)", orderID, resp.StatusCode)
	}
	var settleOut struct {
		TxHash string `json:"tx_hash"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&settleOut); err != nil {
		return nil, fmt.Errorf("chain settlement: undecodable response: %w", err)
	}
	if !isRealTxHash(settleOut.TxHash) {
		return nil, fmt.Errorf("chain settlement returned no valid transaction hash for order %s", orderID)
	}

	slog.Info("on-ramp settlement",
		"orderId", orderID,
		"userId", req.UserID,
		"fiat", fmt.Sprintf("%.2f %s", req.FiatAmount, req.FiatCurrency),
		"stablecoin", fmt.Sprintf("%.6f %s", stablecoinAmount, req.Stablecoin),
		"chain", req.Chain,
		"fee", fee,
		"txHash", settleOut.TxHash,
	)

	return &SettlementResult{
		OrderID:          orderID,
		Status:           "settled",
		StablecoinAmount: math.Round(stablecoinAmount*1e6) / 1e6,
		FiatAmount:       req.FiatAmount,
		Fee:              math.Round(fee*100) / 100,
		FXRate:           math.Round(fxRate/stableRate*1e8) / 1e8,
		EstimatedTime:    "instant",
		TxHash:           settleOut.TxHash,
	}, nil
}

// isRealTxHash validates a 0x-prefixed 32-byte transaction hash and rejects
// the all-zero value.
func isRealTxHash(h string) bool {
	if len(h) != 66 || h[:2] != "0x" {
		return false
	}
	raw, err := hex.DecodeString(h[2:])
	if err != nil || len(raw) != 32 {
		return false
	}
	for _, b := range raw {
		if b != 0 {
			return true
		}
	}
	return false
}

func processOffRamp(req OffRampRequest) (*SettlementResult, error) {
	stableRate := stablecoinRates[req.Stablecoin]
	if stableRate == 0 {
		stableRate = 1.0
	}

	usdAmount := req.StablecoinAmount * stableRate
	fxRate := getFXRate("USD", req.FiatCurrency)
	fiatAmount := usdAmount * fxRate
	fee := fiatAmount * 0.0075 // 0.75% off-ramp fee
	netPayout := fiatAmount - fee

	rail := req.PayoutRail
	if rail == "" {
		rail = "ach"
	}

	estimatedTimes := map[string]string{
		"ach": "1-3 business days", "sepa": "1 business day",
		"swift": "2-5 business days", "mobile_money": "instant",
		"mojaloop": "< 30 seconds",
	}

	orderID := fmt.Sprintf("OFFRAMP-%s", uuid.New().String()[:8])
	atomic.AddInt64(&settlementCounter, 1)

	slog.Info("off-ramp settlement",
		"orderId", orderID,
		"userId", req.UserID,
		"stablecoin", fmt.Sprintf("%.6f %s", req.StablecoinAmount, req.Stablecoin),
		"fiat", fmt.Sprintf("%.2f %s", netPayout, req.FiatCurrency),
		"rail", rail,
		"fee", fee,
	)

	return &SettlementResult{
		OrderID:          orderID,
		Status:           "processing",
		StablecoinAmount: req.StablecoinAmount,
		FiatAmount:       math.Round(netPayout*100) / 100,
		Fee:              math.Round(fee*100) / 100,
		FXRate:           math.Round(stableRate*fxRate*1e8) / 1e8,
		PayoutRail:       rail,
		EstimatedTime:    estimatedTimes[rail],
	}, nil
}

// ── De-Peg Monitor ──────────────────────────────────────────────────────────

const dePegThreshold = 0.005 // 0.5%

func checkDePeg() []DePegAlert {
	alerts := []DePegAlert{}
	for symbol, rate := range stablecoinRates {
		targetPrice := 1.0
		if symbol == "NGNT" {
			targetPrice = 1.0 / 1600.0
		}
		deviation := math.Abs(rate-targetPrice) / targetPrice
		alerts = append(alerts, DePegAlert{
			Symbol:    symbol,
			Price:     rate,
			Deviation: math.Round(deviation*10000) / 100,
			Depegged:  deviation > dePegThreshold,
			Threshold: dePegThreshold * 100,
		})
	}
	return alerts
}

// ── Yield Aggregator ────────────────────────────────────────────────────────

func getYieldPools() []YieldPool {
	return []YieldPool{
		{Symbol: "USDT", Protocol: "Aave V3", APY: 4.2, TVL: 2_500_000_000, Risk: "low", Chain: "ethereum"},
		{Symbol: "USDC", Protocol: "Aave V3", APY: 4.5, TVL: 3_100_000_000, Risk: "low", Chain: "ethereum"},
		{Symbol: "DAI", Protocol: "Compound V3", APY: 3.8, TVL: 1_800_000_000, Risk: "low", Chain: "ethereum"},
		{Symbol: "USDT", Protocol: "Venus", APY: 5.1, TVL: 800_000_000, Risk: "medium", Chain: "bsc"},
		{Symbol: "USDC", Protocol: "Aave V3", APY: 5.8, TVL: 500_000_000, Risk: "low", Chain: "polygon"},
		{Symbol: "USDT", Protocol: "Stargate", APY: 3.2, TVL: 400_000_000, Risk: "medium", Chain: "arbitrum"},
		{Symbol: "cUSD", Protocol: "Moola Market", APY: 6.5, TVL: 50_000_000, Risk: "medium", Chain: "celo"},
	}
}

// ── Gas Estimator ───────────────────────────────────────────────────────────

func getGasEstimates() []GasEstimate {
	return []GasEstimate{
		{Chain: "ethereum", GasUsd: 3.50, GasGwei: 25, BlockTime: 12},
		{Chain: "polygon", GasUsd: 0.01, GasGwei: 50, BlockTime: 2},
		{Chain: "bsc", GasUsd: 0.10, GasGwei: 3, BlockTime: 3},
		{Chain: "solana", GasUsd: 0.001, GasGwei: 0, BlockTime: 0.4},
		{Chain: "tron", GasUsd: 1.00, GasGwei: 0, BlockTime: 3},
		{Chain: "arbitrum", GasUsd: 0.15, GasGwei: 1, BlockTime: 0.25},
		{Chain: "optimism", GasUsd: 0.10, GasGwei: 1, BlockTime: 2},
		{Chain: "base", GasUsd: 0.05, GasGwei: 1, BlockTime: 2},
		{Chain: "avalanche", GasUsd: 0.05, GasGwei: 25, BlockTime: 2},
	}
}

// ── Panic Recovery Middleware ────────────────────────────────────────────────

func panicRecoveryMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("panic recovered", "error", r, "path", c.Request.URL.Path)
				c.AbortWithStatusJSON(500, gin.H{"error": "internal server error", "recovered": true})
			}
		}()
		c.Next()
	}
}

// ── Main ────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	appCfg = cfg

	// DB connection
	var err error
	db, err = sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		slog.Warn("database connection failed, running without persistence", "error", err)
	} else {
		db.SetMaxOpenConns(10)
		db.SetMaxIdleConns(5)
		db.SetConnMaxLifetime(5 * time.Minute)
		if pingErr := db.Ping(); pingErr != nil {
			slog.Warn("database ping failed", "error", pingErr)
		} else {
			slog.Info("database connected")
		}
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), panicRecoveryMiddleware())

	// ── Health ──────────────────────────────────────────────────────────
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "healthy",
			"service": "go-stablecoin-engine",
			"uptime":  time.Since(_processStartTime).String(),
		})
	})
	r.GET("/livez", func(c *gin.Context) { c.JSON(200, gin.H{"status": "alive"}) })
	r.GET("/readyz", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ready"}) })

	// ── Metrics ─────────────────────────────────────────────────────────
	r.GET("/metrics", func(c *gin.Context) {
		uptime := time.Since(_processStartTime).Seconds()
		settled := atomic.LoadInt64(&settlementCounter)
		c.String(200, fmt.Sprintf(
			"# HELP stablecoin_engine_uptime_seconds Service uptime\n"+
				"# TYPE stablecoin_engine_uptime_seconds gauge\n"+
				"stablecoin_engine_uptime_seconds %.2f\n"+
				"# HELP stablecoin_settlements_total Total settlements processed\n"+
				"# TYPE stablecoin_settlements_total counter\n"+
				"stablecoin_settlements_total %d\n",
			uptime, settled,
		))
	})

	// ── Auth: funds-moving endpoints require the internal service key ────
	// Fail closed: when INTERNAL_SERVICE_KEY is unset, all guarded routes deny.
	internalKey := os.Getenv("INTERNAL_SERVICE_KEY")
	authRequired := func(c *gin.Context) {
		key := c.GetHeader("X-API-Key")
		if internalKey == "" || key == "" || !hmac.Equal([]byte(key), []byte(internalKey)) {
			c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized", "message": "valid X-API-Key required"})
			return
		}
		c.Next()
	}
	guarded := r.Group("/stablecoin", authRequired)

	// ── On-Ramp ─────────────────────────────────────────────────────────
	guarded.POST("/onramp", func(c *gin.Context) {
		var req OnRampRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if req.Chain == "" {
			req.Chain = "ethereum"
		}
		sanctions, sErr := screenSanctions(fmt.Sprintf("user-%d", req.UserID))
		if sErr != nil {
			slog.Error("sanctions screening unavailable — refusing on-ramp", "error", sErr)
			c.JSON(503, gin.H{"error": "NOT_CONFIGURED", "message": "sanctions screening unavailable; transaction refused (fail-closed)"})
			return
		}
		if sanctions.Sanctioned {
			c.JSON(403, gin.H{"error": "sanctioned entity", "sanctions": sanctions})
			return
		}
		result, err := processOnRamp(req)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, result)
	})

	// ── Off-Ramp ────────────────────────────────────────────────────────
	guarded.POST("/offramp", func(c *gin.Context) {
		var req OffRampRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		sanctions, sErr := screenSanctions(fmt.Sprintf("user-%d", req.UserID))
		if sErr != nil {
			slog.Error("sanctions screening unavailable — refusing off-ramp", "error", sErr)
			c.JSON(503, gin.H{"error": "NOT_CONFIGURED", "message": "sanctions screening unavailable; transaction refused (fail-closed)"})
			return
		}
		if sanctions.Sanctioned {
			c.JSON(403, gin.H{"error": "sanctioned entity", "sanctions": sanctions})
			return
		}
		result, err := processOffRamp(req)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, result)
	})

	// ── FX Rates ────────────────────────────────────────────────────────
	r.GET("/stablecoin/fx-rates", func(c *gin.Context) {
		base := c.DefaultQuery("base", "USD")
		c.JSON(200, FXRate{
			Base:      base,
			Rates:     fallbackRates,
			Timestamp: time.Now(),
		})
	})

	// ── De-Peg Monitor ──────────────────────────────────────────────────
	r.GET("/stablecoin/depeg", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"alerts":    checkDePeg(),
			"threshold": dePegThreshold * 100,
			"checkedAt": time.Now(),
		})
	})

	// ── Yield Pools ─────────────────────────────────────────────────────
	r.GET("/stablecoin/yield", func(c *gin.Context) {
		c.JSON(200, gin.H{"pools": getYieldPools()})
	})

	// ── Gas Estimates ───────────────────────────────────────────────────
	r.GET("/stablecoin/gas", func(c *gin.Context) {
		c.JSON(200, gin.H{"estimates": getGasEstimates()})
	})

	// ── Batch Screening ─────────────────────────────────────────────────
	guarded.POST("/batch-screen", func(c *gin.Context) {
		var body struct {
			Names []string `json:"names" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		results := make([]SanctionsResult, len(body.Names))
		for i, name := range body.Names {
			res, sErr := screenSanctions(name)
			if sErr != nil {
				c.JSON(503, gin.H{"error": "NOT_CONFIGURED", "message": "sanctions screening unavailable (fail-closed)"})
				return
			}
			results[i] = res
		}
		c.JSON(200, gin.H{"results": results})
	})

	// ── Supported Assets ────────────────────────────────────────────────
	r.GET("/stablecoin/supported", func(c *gin.Context) {
		chains := []string{"ethereum", "polygon", "bsc", "solana", "tron", "arbitrum", "optimism", "base", "avalanche"}
		stablecoins := []string{"USDT", "USDC", "BUSD", "DAI", "NGNT", "cUSD", "PYUSD"}
		c.JSON(200, gin.H{
			"stablecoins": stablecoins,
			"chains":      chains,
			"fiatCurrencies": []string{"USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR", "XOF"},
		})
	})

	// ── Start Server ────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("go-stablecoin-engine starting", "port", cfg.Port)
		startupMs := time.Since(_processStartTime).Milliseconds()
		_, _ = json.Marshal(map[string]interface{}{
			"event": "startup_complete", "service": "go-stablecoin-engine",
			"port": cfg.Port, "startup_ms": startupMs,
		})
		slog.Info("startup complete", "startup_ms", startupMs)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	slog.Info("shutting down", "signal", sig)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("server forced shutdown", "error", err)
	}
	if db != nil {
		db.Close()
	}
	slog.Info("shutdown complete", "uptime", time.Since(_processStartTime).String())
}
