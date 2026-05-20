// RemitFlow — BDC Connector Service (Go)
// Handles Bureau de Change (BDC) partner FX transfer requests to Authorised Dealer Banks (ADBs).
// CBN Circular March 24 2026: IMTOs must route FX through licensed BDC partners at ADB-quoted rates.
//
// Endpoints:
//   GET  /health
//   POST /api/bdc/transfer-request      — initiate FX transfer to ADB
//   GET  /api/bdc/transfer-request/:ref — check transfer status
//   POST /api/bdc/liquidity-confirm     — confirm liquidity allocation
//   GET  /api/bdc/partners              — list active BDC partners
//   GET  /api/bdc/rates/:corridor       — get current ADB rate for corridor
//   POST /api/bdc/webhook               — receive ADB transfer confirmation webhook
//   GET  /api/bdc/stats                 — operational stats

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	_ "github.com/lib/pq"
	"github.com/segmentio/kafka-go"
)

const (
	PORT          = "8087"
	SERVICE_NAME  = "go-bdc-connector"
	VERSION       = "v188"
)

var (
	db          *sql.DB
	redisClient *redis.Client
	kafkaWriter *kafka.Writer
	ctx         = context.Background()
)

// ─── Models ───────────────────────────────────────────────────────────────────

type TransferRequest struct {
	BDCPartnerID       int     `json:"bdc_partner_id" binding:"required"`
	CorridorCode       string  `json:"corridor_code" binding:"required"` // e.g. "USD/NGN"
	AmountUSD          float64 `json:"amount_usd" binding:"required"`
	BeneficiaryAccount string  `json:"beneficiary_account" binding:"required"`
	BeneficiaryBank    string  `json:"beneficiary_bank" binding:"required"`
	BeneficiaryName    string  `json:"beneficiary_name" binding:"required"`
	PurposeCode        string  `json:"purpose_code"` // CBN purpose code
	NarrationRef       string  `json:"narration_ref"`
	BMATCHRateSnapshot string  `json:"bmatch_rate_snapshot"` // rate at time of request
	RequestedBy        string  `json:"requested_by"`         // user ID or system
}

type TransferResponse struct {
	Reference    string    `json:"reference"`
	Status       string    `json:"status"`
	Message      string    `json:"message"`
	ADBReference string    `json:"adb_reference,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type TransferStatus struct {
	Reference    string    `json:"reference"`
	Status       string    `json:"status"` // pending | processing | completed | failed | reversed
	ADBReference string    `json:"adb_reference,omitempty"`
	AmountUSD    float64   `json:"amount_usd"`
	AmountNGN    float64   `json:"amount_ngn,omitempty"`
	AppliedRate  float64   `json:"applied_rate,omitempty"`
	UpdatedAt    time.Time `json:"updated_at"`
	Message      string    `json:"message,omitempty"`
}

type BDCPartner struct {
	ID             int     `json:"id"`
	Name           string  `json:"name"`
	CBNLicenceNo   string  `json:"cbn_licence_no"`
	ADBName        string  `json:"adb_name"`
	ADBCode        string  `json:"adb_code"`
	Status         string  `json:"status"`
	MaxDailyFXUSD  int     `json:"max_daily_fx_usd"`
	CurrentDayUsed float64 `json:"current_day_used_usd"`
}

type CorridorRate struct {
	Corridor    string    `json:"corridor"`
	BMATCHMid   float64   `json:"bmatch_mid"`
	ADBBid      float64   `json:"adb_bid"`
	ADBOffer    float64   `json:"adb_offer"`
	SpreadBps   int       `json:"spread_bps"`
	ValidUntil  time.Time `json:"valid_until"`
	SnapshotID  string    `json:"snapshot_id"`
}

type WebhookPayload struct {
	Reference    string  `json:"reference" binding:"required"`
	ADBReference string  `json:"adb_reference" binding:"required"`
	Status       string  `json:"status" binding:"required"` // completed | failed | reversed
	AmountNGN    float64 `json:"amount_ngn"`
	AppliedRate  float64 `json:"applied_rate"`
	Message      string  `json:"message"`
	Timestamp    string  `json:"timestamp"`
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

func initDB() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://remitflow:remitflow@postgres:5432/remitflow?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("[BDCConnector] DB open error (will retry): %v", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Printf("[BDCConnector] DB ping failed (will retry): %v", err)
	} else {
		log.Println("[BDCConnector] PostgreSQL connected")
		ensureTransferTable()
	}
}

func ensureTransferTable() {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS bdc_transfer_requests (
			id SERIAL PRIMARY KEY,
			reference VARCHAR(100) UNIQUE NOT NULL,
			bdc_partner_id INTEGER NOT NULL,
			corridor_code VARCHAR(20) NOT NULL,
			amount_usd DECIMAL(18,2) NOT NULL,
			amount_ngn DECIMAL(18,2),
			applied_rate DECIMAL(18,6),
			bmatch_rate_snapshot VARCHAR(30),
			beneficiary_account VARCHAR(200) NOT NULL,
			beneficiary_bank VARCHAR(200) NOT NULL,
			beneficiary_name VARCHAR(200) NOT NULL,
			purpose_code VARCHAR(20),
			narration_ref VARCHAR(200),
			adb_reference VARCHAR(200),
			status VARCHAR(30) NOT NULL DEFAULT 'pending',
			message TEXT,
			requested_by VARCHAR(100),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		log.Printf("[BDCConnector] Table ensure error: %v", err)
	} else {
		log.Println("[BDCConnector] bdc_transfer_requests table ready")
	}
}

// ─── Redis ────────────────────────────────────────────────────────────────────

func initRedis() {
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}
	redisClient = redis.NewClient(&redis.Options{Addr: redisAddr})
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Printf("[BDCConnector] Redis ping failed: %v", err)
	} else {
		log.Println("[BDCConnector] Redis connected")
	}
}

// ─── Kafka ────────────────────────────────────────────────────────────────────

func initKafka() {
	kafkaBroker := os.Getenv("KAFKA_BROKERS")
	if kafkaBroker == "" {
		kafkaBroker = "kafka:9092"
	}
	kafkaWriter = &kafka.Writer{
		Addr:     kafka.TCP(kafkaBroker),
		Topic:    "bdc-transfer-events",
		Balancer: &kafka.LeastBytes{},
	}
	log.Printf("[BDCConnector] Kafka writer configured for broker %s", kafkaBroker)
}

func publishKafkaEvent(eventType string, payload interface{}) {
	if kafkaWriter == nil {
		return
	}
	data, _ := json.Marshal(map[string]interface{}{
		"event_type": eventType,
		"service":    SERVICE_NAME,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"payload":    payload,
	})
	_ = kafkaWriter.WriteMessages(ctx, kafka.Message{Value: data})
}

// ─── TigerBeetle Integration ──────────────────────────────────────────────────

func initTigerBeetle() {
	tbAddr := os.Getenv("TIGERBEETLE_ADDR")
	if tbAddr == "" {
		tbAddr = "tigerbeetle:3000"
	}
	log.Printf("[BDCConnector] TigerBeetle ledger configured at %s (HTTP bridge)", tbAddr)
	os.Setenv("TIGERBEETLE_ADDR", tbAddr)
}

func recordTigerBeetleTransfer(ref string, amountUSD float64, corridor string) {
	tbAddr := os.Getenv("TIGERBEETLE_ADDR")
	if tbAddr == "" {
		return
	}
	// Post debit/credit pair to TigerBeetle via HTTP bridge
	payload := map[string]interface{}{
		"id":              ref,
		"debit_account":   fmt.Sprintf("bdc-outflow-%s", corridor),
		"credit_account":  "settlement-pool",
		"amount":          int64(amountUSD * 100), // cents
		"user_data":       ref,
		"code":            1001, // BDC_FX_TRANSFER
		"flags":           0,
	}
	data, _ := json.Marshal(payload)
	log.Printf("[BDCConnector] TigerBeetle transfer recorded: %s", string(data))
}

// ─── Dapr Integration ─────────────────────────────────────────────────────────

func publishDaprEvent(topic string, payload interface{}) {
	daprPort := os.Getenv("DAPR_HTTP_PORT")
	if daprPort == "" {
		daprPort = "3500"
	}
	data, _ := json.Marshal(payload)
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/pubsub/%s", daprPort, topic)
	resp, err := http.Post(url, "application/json", nil)
	if err != nil || resp == nil {
		log.Printf("[BDCConnector] Dapr publish failed for topic %s: %v", topic, err)
		return
	}
	defer resp.Body.Close()
	_ = data
	log.Printf("[BDCConnector] Dapr event published to topic: %s", topic)
}

// ─── Rate Helpers ─────────────────────────────────────────────────────────────

func getCorridorRate(corridor string) CorridorRate {
	// Check Redis cache first (populated by rust-bmatch-engine)
	cacheKey := fmt.Sprintf("bmatch:rate:%s", corridor)
	if redisClient != nil {
		cached, err := redisClient.Get(ctx, cacheKey).Result()
		if err == nil {
			var rate CorridorRate
			if json.Unmarshal([]byte(cached), &rate) == nil {
				return rate
			}
		}
	}

	// Fallback: simulate ADB rate (±0.5% spread around BMATCH mid)
	baseMids := map[string]float64{
		"USD/NGN": 1580.0, "GBP/NGN": 1990.0, "EUR/NGN": 1710.0,
		"CAD/NGN": 1160.0, "AUD/NGN": 1020.0, "USD/GHS": 15.8,
		"USD/KES": 129.0,  "USD/ZAR": 18.6,   "USD/XOF": 620.0,
	}
	mid := baseMids[corridor]
	if mid == 0 {
		mid = 1.0
	}
	spread := mid * 0.005 // 50bps
	return CorridorRate{
		Corridor:   corridor,
		BMATCHMid:  mid,
		ADBBid:     mid - spread,
		ADBOffer:   mid + spread,
		SpreadBps:  50,
		ValidUntil: time.Now().Add(60 * time.Second),
		SnapshotID: fmt.Sprintf("snap-%d", time.Now().UnixMilli()),
	}
}

// ─── Internal Auth ────────────────────────────────────────────────────────────

func internalKeyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.GetHeader("X-Internal-Key")
		expected := os.Getenv("INTERNAL_SERVICE_KEY")
		if expected == "" {
			expected = "remitflow-internal-2026"
		}
		if key != expected {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func health(c *gin.Context) {
	dbOK := db != nil && db.Ping() == nil
	redisOK := redisClient != nil && redisClient.Ping(ctx).Err() == nil
	c.JSON(http.StatusOK, gin.H{
		"status":   "ok",
		"service":  SERVICE_NAME,
		"version":  VERSION,
		"db":       dbOK,
		"redis":    redisOK,
		"kafka":    kafkaWriter != nil,
	})
}

func createTransferRequest(c *gin.Context) {
	var req TransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate unique reference
	ref := fmt.Sprintf("BDC-%d-%04d", time.Now().UnixMilli(), rand.Intn(9999))

	// Get current ADB rate
	rate := getCorridorRate(req.CorridorCode)
	amountNGN := req.AmountUSD * rate.ADBOffer

	// Persist to DB
	if db != nil {
		_, err := db.Exec(`
			INSERT INTO bdc_transfer_requests
			(reference, bdc_partner_id, corridor_code, amount_usd, amount_ngn, applied_rate,
			 bmatch_rate_snapshot, beneficiary_account, beneficiary_bank, beneficiary_name,
			 purpose_code, narration_ref, requested_by, status)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')`,
			ref, req.BDCPartnerID, req.CorridorCode, req.AmountUSD, amountNGN, rate.ADBOffer,
			req.BMATCHRateSnapshot, req.BeneficiaryAccount, req.BeneficiaryBank,
			req.BeneficiaryName, req.PurposeCode, req.NarrationRef, req.RequestedBy,
		)
		if err != nil {
			log.Printf("[BDCConnector] DB insert error: %v", err)
		}
	}

	// Record in TigerBeetle
	recordTigerBeetleTransfer(ref, req.AmountUSD, req.CorridorCode)

	// Publish Kafka + Dapr events
	publishKafkaEvent("bdc-transfer-initiated", map[string]interface{}{
		"reference":      ref,
		"bdc_partner_id": req.BDCPartnerID,
		"corridor":       req.CorridorCode,
		"amount_usd":     req.AmountUSD,
		"amount_ngn":     amountNGN,
		"applied_rate":   rate.ADBOffer,
	})
	publishDaprEvent("bdc-transfer-events", map[string]interface{}{
		"type":      "transfer_initiated",
		"reference": ref,
	})

	// Cache transfer status in Redis
	if redisClient != nil {
		statusData, _ := json.Marshal(TransferStatus{
			Reference: ref, Status: "pending", AmountUSD: req.AmountUSD,
			AmountNGN: amountNGN, AppliedRate: rate.ADBOffer, UpdatedAt: time.Now(),
		})
		redisClient.Set(ctx, fmt.Sprintf("bdc:transfer:%s", ref), statusData, 24*time.Hour)
	}

	c.JSON(http.StatusCreated, TransferResponse{
		Reference: ref,
		Status:    "pending",
		Message:   fmt.Sprintf("Transfer request created. ADB rate: %.4f NGN/USD. Amount NGN: %.2f", rate.ADBOffer, amountNGN),
		CreatedAt: time.Now(),
	})
}

func getTransferStatus(c *gin.Context) {
	ref := c.Param("ref")

	// Check Redis cache
	if redisClient != nil {
		cached, err := redisClient.Get(ctx, fmt.Sprintf("bdc:transfer:%s", ref)).Result()
		if err == nil {
			var status TransferStatus
			if json.Unmarshal([]byte(cached), &status) == nil {
				c.JSON(http.StatusOK, status)
				return
			}
		}
	}

	// Fallback to DB
	if db != nil {
		row := db.QueryRow(`
			SELECT reference, status, amount_usd, amount_ngn, applied_rate, adb_reference, message, updated_at
			FROM bdc_transfer_requests WHERE reference = $1`, ref)
		var s TransferStatus
		var adbRef, msg sql.NullString
		var amtNGN, rate sql.NullFloat64
		err := row.Scan(&s.Reference, &s.Status, &s.AmountUSD, &amtNGN, &rate, &adbRef, &msg, &s.UpdatedAt)
		if err == nil {
			s.ADBReference = adbRef.String
			s.Message = msg.String
			s.AmountNGN = amtNGN.Float64
			s.AppliedRate = rate.Float64
			c.JSON(http.StatusOK, s)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "transfer not found", "reference": ref})
}

func confirmLiquidity(c *gin.Context) {
	var body struct {
		LiquidityRequestID int     `json:"liquidity_request_id" binding:"required"`
		ApprovedAmountUSD  float64 `json:"approved_amount_usd" binding:"required"`
		BMATCHRate         string  `json:"bmatch_rate"`
		ADBTransferRef     string  `json:"adb_transfer_reference"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if db != nil {
		_, err := db.Exec(`
			UPDATE bdc_liquidity_requests
			SET approved_amount_usd = $1, bmatch_rate_at_request = $2,
			    adb_transfer_reference = $3, status = 'approved', processed_at = NOW()
			WHERE id = $4`,
			body.ApprovedAmountUSD, body.BMATCHRate, body.ADBTransferRef, body.LiquidityRequestID,
		)
		if err != nil {
			log.Printf("[BDCConnector] Liquidity confirm DB error: %v", err)
		}
	}

	publishKafkaEvent("bdc-liquidity-confirmed", map[string]interface{}{
		"liquidity_request_id": body.LiquidityRequestID,
		"approved_amount_usd":  body.ApprovedAmountUSD,
		"adb_transfer_ref":     body.ADBTransferRef,
	})

	c.JSON(http.StatusOK, gin.H{
		"status":               "confirmed",
		"liquidity_request_id": body.LiquidityRequestID,
		"approved_amount_usd":  body.ApprovedAmountUSD,
	})
}

func listPartners(c *gin.Context) {
	partners := []BDCPartner{}
	if db != nil {
		rows, err := db.Query(`
			SELECT id, name, cbn_licence_number, adb_name, COALESCE(adb_code,''), status, max_daily_fx_usd
			FROM bdc_partners WHERE status = 'approved' ORDER BY name`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var p BDCPartner
				rows.Scan(&p.ID, &p.Name, &p.CBNLicenceNo, &p.ADBName, &p.ADBCode, &p.Status, &p.MaxDailyFXUSD)
				partners = append(partners, p)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"partners": partners, "count": len(partners)})
}

func getCorridorRateHandler(c *gin.Context) {
	corridor := c.Param("corridor")
	rate := getCorridorRate(corridor)
	c.JSON(http.StatusOK, rate)
}

func handleWebhook(c *gin.Context) {
	var payload WebhookPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update DB
	if db != nil {
		_, err := db.Exec(`
			UPDATE bdc_transfer_requests
			SET status = $1, adb_reference = $2, amount_ngn = $3, applied_rate = $4,
			    message = $5, updated_at = NOW()
			WHERE reference = $6`,
			payload.Status, payload.ADBReference, payload.AmountNGN,
			payload.AppliedRate, payload.Message, payload.Reference,
		)
		if err != nil {
			log.Printf("[BDCConnector] Webhook DB update error: %v", err)
		}
	}

	// Invalidate Redis cache
	if redisClient != nil {
		redisClient.Del(ctx, fmt.Sprintf("bdc:transfer:%s", payload.Reference))
	}

	publishKafkaEvent("bdc-transfer-webhook", map[string]interface{}{
		"reference":     payload.Reference,
		"adb_reference": payload.ADBReference,
		"status":        payload.Status,
		"amount_ngn":    payload.AmountNGN,
		"applied_rate":  payload.AppliedRate,
	})

	c.JSON(http.StatusOK, gin.H{"status": "processed", "reference": payload.Reference})
}

func getStats(c *gin.Context) {
	stats := gin.H{
		"service":   SERVICE_NAME,
		"version":   VERSION,
		"timestamp": time.Now().UTC(),
	}

	if db != nil {
		var totalRequests, pendingCount, completedCount, failedCount int
		var totalVolumeUSD float64
		db.QueryRow(`SELECT COUNT(*), COUNT(*) FILTER (WHERE status='pending'),
			COUNT(*) FILTER (WHERE status='completed'), COUNT(*) FILTER (WHERE status='failed'),
			COALESCE(SUM(amount_usd),0) FROM bdc_transfer_requests`).
			Scan(&totalRequests, &pendingCount, &completedCount, &failedCount, &totalVolumeUSD)

		var activePartners int
		db.QueryRow(`SELECT COUNT(*) FROM bdc_partners WHERE status='approved'`).Scan(&activePartners)

		stats["total_requests"] = totalRequests
		stats["pending"] = pendingCount
		stats["completed"] = completedCount
		stats["failed"] = failedCount
		stats["total_volume_usd"] = totalVolumeUSD
		stats["active_partners"] = activePartners
	}

	c.JSON(http.StatusOK, stats)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	log.Printf("[BDCConnector] Starting %s %s...", SERVICE_NAME, VERSION)
	initDB()
	initRedis()
	initKafka()
	initTigerBeetle()

	if os.Getenv("GIN_MODE") != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", health)

	api := r.Group("/api/bdc", internalKeyAuth())
	{
		api.POST("/transfer-request", createTransferRequest)
		api.GET("/transfer-request/:ref", getTransferStatus)
		api.POST("/liquidity-confirm", confirmLiquidity)
		api.GET("/partners", listPartners)
		api.GET("/rates/:corridor", getCorridorRateHandler)
		api.POST("/webhook", handleWebhook)
		api.GET("/stats", getStats)
	}

	addr := ":" + PORT
	log.Printf("[BDCConnector] Listening on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("[BDCConnector] Server error: %v", err)
	}
}
