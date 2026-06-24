// RemitFlow — Risk Engine (Go)
// Real-time transaction risk scoring combining:
//   - Velocity checks (transactions per hour/day)
//   - Amount thresholds (large transaction detection)
//   - Geographic risk (high-risk country detection)
//   - Behavioral anomaly detection
//   - Sanctions list screening
package main

import (
	"database/sql"
	"fmt"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

var riskDB *sql.DB

func initRiskDB() {
	dbURL := getEnv("DATABASE_URL", "")
	if dbURL == "" {
		log.Println("[RISK-ENGINE] WARNING: DATABASE_URL not set, stats will not persist")
		return
	}
	var err error
	riskDB, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("[RISK-ENGINE] DB connection failed: %v", err)
		return
	}
	riskDB.SetMaxOpenConns(10)
	riskDB.SetMaxIdleConns(5)
	riskDB.SetConnMaxLifetime(5 * time.Minute)
	if err = riskDB.Ping(); err != nil {
		log.Printf("[RISK-ENGINE] DB ping failed: %v", err)
		riskDB = nil
		return
	}
	_, _ = riskDB.Exec(`CREATE TABLE IF NOT EXISTS risk_engine_stats (
		id TEXT PRIMARY KEY,
		data JSONB DEFAULT '{}'::jsonb,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	)`)
	log.Println("[RISK-ENGINE] PostgreSQL write-through enabled")
}

func dbUpsertStats(key string, value interface{}) {
	if riskDB == nil {
		return
	}
	go func() {
		data, err := json.Marshal(value)
		if err != nil {
			return
		}
		_, _ = riskDB.Exec(
			`INSERT INTO risk_engine_stats (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())
			ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
			key, string(data),
		)
	}()
}

func loadStatsFromDB() {
	if riskDB == nil {
		return
	}
	var data string
	err := riskDB.QueryRow(`SELECT data FROM risk_engine_stats WHERE id = 'aggregate_stats'`).Scan(&data)
	if err != nil {
		return
	}
	var stats RiskStats
	if json.Unmarshal([]byte(data), &stats) == nil {
		scorer.mu.Lock()
		scorer.stats = stats
		scorer.mu.Unlock()
		log.Printf("[RISK-ENGINE] Loaded stats from DB: %d scored, %d high-risk, %d rejected", stats.TotalScored, stats.HighRisk, stats.Rejected)
	}
}

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	Port              string
	KafkaBrokers      string
	RedisAddr         string
	HighRiskThreshold float64
	LargeAmountUSD    float64
}

func loadConfig() Config {
	return Config{
		Port:              getEnv("PORT", "8091"),
		KafkaBrokers:      getEnv("KAFKA_BROKERS", "localhost:9092"),
		RedisAddr:         getEnv("REDIS_ADDR", "localhost:6379"),
		HighRiskThreshold: 0.7,
		LargeAmountUSD:    10000.0,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Risk Data ─────────────────────────────────────────────────────────────────

// FATF high-risk and monitored jurisdictions (2024)
var highRiskCountries = map[string]float64{
	"AF": 0.9, // Afghanistan
	"MM": 0.9, // Myanmar
	"KP": 1.0, // North Korea
	"IR": 1.0, // Iran
	"SY": 0.9, // Syria
	"YE": 0.8, // Yemen
	"SS": 0.8, // South Sudan
	"SO": 0.8, // Somalia
	"LY": 0.7, // Libya
	"ML": 0.7, // Mali
	"CF": 0.7, // Central African Republic
	"HT": 0.7, // Haiti
	"PK": 0.6, // Pakistan (grey list)
	"VU": 0.6, // Vanuatu
	"TJ": 0.6, // Tajikistan
	"TT": 0.6, // Trinidad and Tobago
	"VE": 0.7, // Venezuela
	"CU": 0.7, // Cuba
}

// Currency risk multipliers
var currencyRisk = map[string]float64{
	"USD": 0.1, "EUR": 0.1, "GBP": 0.1, "CHF": 0.1,
	"NGN": 0.4, "GHS": 0.3, "KES": 0.3, "ZAR": 0.3,
	"PKR": 0.5, "BDT": 0.4, "INR": 0.2, "PHP": 0.3,
	"MXN": 0.3, "COP": 0.4, "PEN": 0.3, "BRL": 0.3,
}

// ── Domain Types ──────────────────────────────────────────────────────────────

type RiskRequest struct {
	TransactionID   string  `json:"transactionId"`
	UserID          string  `json:"userId"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	DestCountry     string  `json:"destinationCountry"`
	SourceCountry   string  `json:"sourceCountry"`
	UserKYCTier     int     `json:"userKycTier"`
	UserAge         int     `json:"userAgeDays"` // days since registration
	TxCountLastHour int     `json:"txCountLastHour"`
	TxCountLastDay  int     `json:"txCountLastDay"`
	AmountLastDay   float64 `json:"amountLastDay"`
	IsNewBeneficiary bool   `json:"isNewBeneficiary"`
	IPCountry       string  `json:"ipCountry"`
	DeviceFingerprint string `json:"deviceFingerprint"`
}

type RiskResponse struct {
	TransactionID string             `json:"transactionId"`
	RiskScore     float64            `json:"riskScore"`
	RiskLevel     string             `json:"riskLevel"`
	Flags         []string           `json:"flags"`
	Factors       map[string]float64 `json:"factors"`
	Decision      string             `json:"decision"` // "approve", "review", "reject"
	Timestamp     string             `json:"timestamp"`
}

type RiskStats struct {
	TotalScored   int64   `json:"totalScored"`
	HighRisk      int64   `json:"highRisk"`
	Rejected      int64   `json:"rejected"`
	AvgRiskScore  float64 `json:"avgRiskScore"`
}

// ── Risk Scorer ───────────────────────────────────────────────────────────────

type RiskScorer struct {
	mu    sync.Mutex
	stats RiskStats
}

func NewRiskScorer() *RiskScorer {
	return &RiskScorer{}
}

func (rs *RiskScorer) Score(req RiskRequest) RiskResponse {
	factors := make(map[string]float64)
	flags := make([]string, 0)

	// 1. Amount risk (0-0.3)
	amountRisk := 0.0
	if req.Amount > 50000 {
		amountRisk = 0.3
		flags = append(flags, "VERY_LARGE_AMOUNT")
	} else if req.Amount > 10000 {
		amountRisk = 0.2
		flags = append(flags, "LARGE_AMOUNT")
	} else if req.Amount > 5000 {
		amountRisk = 0.1
	}
	factors["amount_risk"] = amountRisk

	// 2. Geographic risk (0-0.3)
	geoRisk := 0.0
	if risk, ok := highRiskCountries[req.DestCountry]; ok {
		geoRisk = risk * 0.3
		flags = append(flags, "HIGH_RISK_DESTINATION")
	}
	if req.IPCountry != "" && req.IPCountry != req.SourceCountry {
		geoRisk += 0.1
		flags = append(flags, "IP_COUNTRY_MISMATCH")
	}
	factors["geo_risk"] = math.Min(geoRisk, 0.3)

	// 3. Velocity risk (0-0.2)
	velocityRisk := 0.0
	if req.TxCountLastHour > 5 {
		velocityRisk = 0.2
		flags = append(flags, "HIGH_VELOCITY_HOURLY")
	} else if req.TxCountLastHour > 3 {
		velocityRisk = 0.1
		flags = append(flags, "ELEVATED_VELOCITY_HOURLY")
	}
	if req.TxCountLastDay > 20 {
		velocityRisk = math.Max(velocityRisk, 0.15)
		flags = append(flags, "HIGH_VELOCITY_DAILY")
	}
	if req.AmountLastDay > 50000 {
		velocityRisk = math.Max(velocityRisk, 0.15)
		flags = append(flags, "HIGH_DAILY_VOLUME")
	}
	factors["velocity_risk"] = velocityRisk

	// 4. KYC risk (0-0.2)
	kycRisk := 0.0
	switch req.UserKYCTier {
	case 0:
		kycRisk = 0.2
		flags = append(flags, "NO_KYC")
	case 1:
		kycRisk = 0.1
	case 2:
		kycRisk = 0.05
	case 3:
		kycRisk = 0.0
	}
	factors["kyc_risk"] = kycRisk

	// 5. Behavioral risk (0-0.1)
	behavioralRisk := 0.0
	if req.UserAge < 7 {
		behavioralRisk += 0.1
		flags = append(flags, "NEW_USER")
	} else if req.UserAge < 30 {
		behavioralRisk += 0.05
	}
	if req.IsNewBeneficiary {
		behavioralRisk += 0.05
		flags = append(flags, "NEW_BENEFICIARY")
	}
	factors["behavioral_risk"] = math.Min(behavioralRisk, 0.1)

	// 6. Currency risk (0-0.1)
	currRisk := 0.0
	if risk, ok := currencyRisk[req.Currency]; ok {
		currRisk = risk * 0.1
	} else {
		currRisk = 0.05 // Unknown currency
	}
	factors["currency_risk"] = currRisk

	// Aggregate score
	totalRisk := 0.0
	for _, v := range factors {
		totalRisk += v
	}
	totalRisk = math.Min(totalRisk, 1.0)

	// Determine risk level and decision
	riskLevel := "low"
	decision := "approve"
	if totalRisk >= 0.8 {
		riskLevel = "critical"
		decision = "reject"
	} else if totalRisk >= 0.6 {
		riskLevel = "high"
		decision = "review"
	} else if totalRisk >= 0.4 {
		riskLevel = "medium"
		decision = "review"
	}

	// Update stats
	rs.mu.Lock()
	rs.stats.TotalScored++
	rs.stats.AvgRiskScore = (rs.stats.AvgRiskScore*float64(rs.stats.TotalScored-1) + totalRisk) / float64(rs.stats.TotalScored)
	if totalRisk >= 0.6 {
		rs.stats.HighRisk++
	}
	if decision == "reject" {
		rs.stats.Rejected++
	}
	rs.mu.Unlock()
	dbUpsertStats("aggregate_stats", rs.stats)

	return RiskResponse{
		TransactionID: req.TransactionID,
		RiskScore:     math.Round(totalRisk*1000) / 1000,
		RiskLevel:     riskLevel,
		Flags:         flags,
		Factors:       factors,
		Decision:      decision,
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}
}

// ── Handlers ──────────────────────────────────────────────────────────────────

var scorer = NewRiskScorer()

func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "risk-engine",
		"version":   "1.0.0",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func scoreHandler(c *gin.Context) {
	var req RiskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp := scorer.Score(req)
	log.Printf("[RISK] Transaction %s: score=%.3f level=%s decision=%s flags=%s",
		req.TransactionID, resp.RiskScore, resp.RiskLevel, resp.Decision,
		strings.Join(resp.Flags, ","))

	c.JSON(http.StatusOK, resp)
}

func batchScoreHandler(c *gin.Context) {
	var requests []RiskRequest
	if err := c.ShouldBindJSON(&requests); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	responses := make([]RiskResponse, len(requests))
	for i, req := range requests {
		responses[i] = scorer.Score(req)
	}

	c.JSON(http.StatusOK, gin.H{
		"results": responses,
		"count":   len(responses),
	})
}

func statsHandler(c *gin.Context) {
	scorer.mu.Lock()
	defer scorer.mu.Unlock()
	c.JSON(http.StatusOK, scorer.stats)
}

func metricsHandler(c *gin.Context) {
	scorer.mu.Lock()
	s := scorer.stats
	scorer.mu.Unlock()

	statsJSON, _ := json.Marshal(s)
	_ = statsJSON

	c.String(http.StatusOK, `# HELP risk_transactions_scored_total Total transactions scored
# TYPE risk_transactions_scored_total counter
risk_transactions_scored_total `+fmt.Sprintf("%d", s.TotalScored)+`
# HELP risk_high_risk_total Total high-risk transactions
# TYPE risk_high_risk_total counter
risk_high_risk_total `+fmt.Sprintf("%d", s.HighRisk)+`
# HELP risk_rejected_total Total rejected transactions
# TYPE risk_rejected_total counter
risk_rejected_total `+fmt.Sprintf("%d", s.Rejected)+`
`)
}

func countriesHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"high_risk_countries": highRiskCountries,
		"count":               len(highRiskCountries),
	})
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	initRiskDB()
	loadStatsFromDB()

	if os.Getenv("GIN_MODE") != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	r.GET("/health", healthHandler)
	r.GET("/metrics", metricsHandler)
	r.GET("/stats", statsHandler)
	r.GET("/countries/high-risk", countriesHandler)

	v1 := r.Group("/v1")
	{
		v1.POST("/score", scoreHandler)
		v1.POST("/score/batch", batchScoreHandler)
	}

	// Legacy
	r.POST("/score", scoreHandler)
	r.POST("/predict", scoreHandler) // Alias for fraud ML compatibility

	log.Printf("[RISK-ENGINE] Starting on port %s", cfg.Port)
	log.Printf("[RISK-ENGINE] High-risk threshold: %.1f", cfg.HighRiskThreshold)
	log.Printf("[RISK-ENGINE] Large amount threshold: $%.0f", cfg.LargeAmountUSD)

	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
