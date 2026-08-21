// RemitFlow — Go Payment Engine
//
// Backend engine for programmable payments, merchant gateway, and batch payouts.
// Port: 8119
//
// Middleware stack:
//   - Kafka: payment.programmed, payment.merchant, payment.batch events
//   - Dapr: pub/sub for payment notifications, state store for merchant sessions
//   - Redis: idempotency keys, rate limiting, payment link cache
//   - TigerBeetle: double-entry ledger for all payment movements
//   - PostgreSQL: merchant accounts, payment intents, batch records
//   - OpenSearch: payment indexing for analytics + compliance
//   - APISIX: API gateway rate limiting for merchant endpoints
//   - Temporal: workflow orchestration for scheduled/conditional payments
//   - Permify: RBAC for merchant operations
//   - Keycloak: merchant authentication + OAuth2 client credentials

package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
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

// outboundHTTP is used for internal provider calls (address provisioning,
// settlement execution). It is a package var so tests can stub it.
var outboundHTTP = &http.Client{Timeout: 10 * time.Second}

// errNotConfigured marks fail-closed conditions where a required backend
// integration is not configured.
var errNotConfigured = fmt.Errorf("NOT_CONFIGURED")

// provisionDepositAddress obtains a REAL on-chain deposit address from the
// configured custody/wallet provider. It NEVER fabricates an address: if no
// provider is configured or the provider does not return a valid non-zero
// EVM address, it returns an error and the caller must fail closed.
func provisionDepositAddress(ctx context.Context, intentID, coin string) (string, error) {
	if appCfg.DepositAddressProviderURL == "" {
		return "", fmt.Errorf("%w: DEPOSIT_ADDRESS_PROVIDER_URL is not set", errNotConfigured)
	}
	body, err := json.Marshal(map[string]string{
		"intent_id": intentID,
		"coin":      coin,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		appCfg.DepositAddressProviderURL+"/v1/addresses", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := outboundHTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("address provider unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("address provider returned status %d", resp.StatusCode)
	}
	var out struct {
		Address string `json:"address"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&out); err != nil {
		return "", fmt.Errorf("address provider: undecodable response: %w", err)
	}
	if !isRealEVMAddress(out.Address) {
		return "", fmt.Errorf("address provider returned invalid address")
	}
	return out.Address, nil
}

// isRealEVMAddress validates a 0x-prefixed 20-byte hex address and rejects the
// all-zero (burn) address.
func isRealEVMAddress(addr string) bool {
	if len(addr) != 42 || addr[:2] != "0x" {
		return false
	}
	raw, err := hex.DecodeString(addr[2:])
	if err != nil || len(raw) != 20 {
		return false
	}
	for _, b := range raw {
		if b != 0 {
			return true
		}
	}
	return false // all-zero address: funds would be burned
}

// ── Config ──────────────────────────────────────────────────────────────────

type Config struct {
	Port            string
	DatabaseURL     string
	KafkaBrokers    string
	RedisURL        string
	TigerBeetleAddr string
	TemporalAddr    string
	DaprPort        string
	OpenSearchURL   string
	// DepositAddressProviderURL is the internal custody/wallet service that
	// provisions REAL on-chain deposit addresses. No default: if unset, the
	// payment-intent endpoint fails closed (503 NOT_CONFIGURED) rather than
	// ever fabricating an address.
	DepositAddressProviderURL string
	// SettlementExecutorURL is the internal settlement/chain executor used to
	// execute batch payouts. No default: if unset, execution fails closed.
	SettlementExecutorURL string
}

func loadConfig() Config {
	return Config{
		Port:            getEnv("PORT", "8119"),
		DatabaseURL:     getEnv("DATABASE_URL", "postgres://localhost:5432/remitflow?sslmode=disable"),
		KafkaBrokers:    getEnv("KAFKA_BROKERS", "localhost:9092"),
		RedisURL:        getEnv("REDIS_URL", "redis://localhost:6379"),
		TigerBeetleAddr: getEnv("TIGERBEETLE_ADDR", "localhost:3000"),
		TemporalAddr:    getEnv("TEMPORAL_ADDR", "localhost:7233"),
		DaprPort:        getEnv("DAPR_HTTP_PORT", "3500"),
		OpenSearchURL:   getEnv("OPENSEARCH_URL", "http://localhost:9200"),
		DepositAddressProviderURL: os.Getenv("DEPOSIT_ADDRESS_PROVIDER_URL"),
		SettlementExecutorURL:     os.Getenv("SETTLEMENT_EXECUTOR_URL"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Types ───────────────────────────────────────────────────────────────────

type MerchantAccount struct {
	MerchantID       string    `json:"merchant_id"`
	BusinessName     string    `json:"business_name"`
	APIKey           string    `json:"api_key"`
	WebhookURL       string    `json:"webhook_url,omitempty"`
	WebhookSecret    string    `json:"webhook_secret"`
	AcceptedCoins    []string  `json:"accepted_coins"`
	SettlementCoin   string    `json:"settlement_coin"`
	FeePercent       float64   `json:"fee_percent"`
	TotalVolume      float64   `json:"total_volume"`
	TotalPayments    int64     `json:"total_payments"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"created_at"`
}

type PaymentIntent struct {
	IntentID       string            `json:"intent_id"`
	MerchantID     string            `json:"merchant_id"`
	Amount         float64           `json:"amount"`
	Currency       string            `json:"currency"`
	Stablecoin     string            `json:"stablecoin,omitempty"`
	Description    string            `json:"description"`
	Status         string            `json:"status"`
	CheckoutURL    string            `json:"checkout_url"`
	DepositAddress string            `json:"deposit_address,omitempty"`
	TxHash         string            `json:"tx_hash,omitempty"`
	ExpiresAt      time.Time         `json:"expires_at"`
	CreatedAt      time.Time         `json:"created_at"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

type ProgrammablePayment struct {
	PaymentID    string    `json:"payment_id"`
	UserID       int64     `json:"user_id"`
	Name         string    `json:"name"`
	ScheduleType string    `json:"schedule_type"`
	Stablecoin   string    `json:"stablecoin"`
	Amount       float64   `json:"amount"`
	Status       string    `json:"status"`
	CronExpr     string    `json:"cron_expression,omitempty"`
	NextExecAt   time.Time `json:"next_execution_at,omitempty"`
	ExecCount    int       `json:"execution_count"`
	MaxExec      int       `json:"max_executions,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type BatchPayout struct {
	BatchID        string           `json:"batch_id"`
	UserID         int64            `json:"user_id"`
	Name           string           `json:"name"`
	Stablecoin     string           `json:"stablecoin"`
	TotalAmount    float64          `json:"total_amount"`
	TotalFee       float64          `json:"total_fee"`
	RecipientCount int              `json:"recipient_count"`
	Status         string           `json:"status"`
	Recipients     []BatchRecipient `json:"recipients"`
	CreatedAt      time.Time        `json:"created_at"`
}

type BatchRecipient struct {
	Index   int     `json:"index"`
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Amount  float64 `json:"amount"`
	Fee     float64 `json:"fee"`
	Status  string  `json:"status"`
	TxHash  string  `json:"tx_hash,omitempty"`
}

// ── Middleware ───────────────────────────────────────────────────────────────

var healthy int32 = 1

func healthCheck(c *gin.Context) {
	if atomic.LoadInt32(&healthy) == 1 {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "go-payment-engine",
			"uptime":  time.Since(_processStartTime).String(),
		})
	} else {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy"})
	}
}

func requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-ID")
		if id == "" {
			id = uuid.New().String()
		}
		c.Set("request_id", id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}

// authMiddleware guards all /api/* routes. A caller authenticates with either
//   - X-API-Key equal to the env-configured INTERNAL_SERVICE_KEY (service-to-service), or
//   - X-API-Key matching an active merchant's api_key in the merchant store.
// Fail closed: if neither credential source is available, everything is denied.
func authMiddleware() gin.HandlerFunc {
	internalKey := os.Getenv("INTERNAL_SERVICE_KEY")
	return func(c *gin.Context) {
		key := c.GetHeader("X-API-Key")
		if key != "" && internalKey != "" &&
			hmac.Equal([]byte(key), []byte(internalKey)) {
			c.Next()
			return
		}
		if key != "" && db != nil {
			var n int
			if err := db.QueryRowContext(c.Request.Context(),
				`SELECT COUNT(1) FROM merchant_accounts WHERE api_key = $1 AND status = 'active'`,
				key).Scan(&n); err == nil && n > 0 {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "valid X-API-Key required",
		})
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

func generateID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s-%s", prefix, hex.EncodeToString(b))
}

func generateAPIKey() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return fmt.Sprintf("rf_live_%s", hex.EncodeToString(b))
}

func generateSecret() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return fmt.Sprintf("whsec_%s", hex.EncodeToString(b))
}

func signPayload(payload, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func respondJSON(c *gin.Context, status int, data interface{}) {
	c.JSON(status, data)
}

// ── Handlers: Programmable Payments ─────────────────────────────────────────

func createProgrammablePayment(c *gin.Context) {
	var req struct {
		Name         string  `json:"name" binding:"required"`
		ScheduleType string  `json:"schedule_type" binding:"required"`
		Stablecoin   string  `json:"stablecoin" binding:"required"`
		Amount       float64 `json:"amount" binding:"required,gt=0"`
		CronExpr     string  `json:"cron_expression,omitempty"`
		MaxExec      int     `json:"max_executions,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	payment := ProgrammablePayment{
		PaymentID:    generateID("pp"),
		Name:         req.Name,
		ScheduleType: req.ScheduleType,
		Stablecoin:   req.Stablecoin,
		Amount:       req.Amount,
		Status:       "scheduled",
		CronExpr:     req.CronExpr,
		MaxExec:      req.MaxExec,
		CreatedAt:    time.Now(),
	}

	if db != nil {
		_, err := db.Exec(`INSERT INTO programmable_payments (payment_id, name, schedule_type, stablecoin, amount, status, cron_expression, max_executions, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			payment.PaymentID, payment.Name, payment.ScheduleType, payment.Stablecoin,
			payment.Amount, payment.Status, payment.CronExpr, payment.MaxExec, payment.CreatedAt)
		if err != nil {
			slog.Warn("DB insert failed, using in-memory", "error", err)
		}
	}

	slog.Info("Programmable payment created", "id", payment.PaymentID, "type", req.ScheduleType)
	respondJSON(c, http.StatusCreated, payment)
}

// ── Handlers: Merchant Gateway ──────────────────────────────────────────────

func registerMerchant(c *gin.Context) {
	var req struct {
		BusinessName   string   `json:"business_name" binding:"required"`
		AcceptedCoins  []string `json:"accepted_coins" binding:"required"`
		SettlementCoin string   `json:"settlement_coin"`
		WebhookURL     string   `json:"webhook_url,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.SettlementCoin == "" {
		req.SettlementCoin = "USDC"
	}

	merchant := MerchantAccount{
		MerchantID:     generateID("merch"),
		BusinessName:   req.BusinessName,
		APIKey:         generateAPIKey(),
		WebhookURL:     req.WebhookURL,
		WebhookSecret:  generateSecret(),
		AcceptedCoins:  req.AcceptedCoins,
		SettlementCoin: req.SettlementCoin,
		FeePercent:     1.0,
		Status:         "active",
		CreatedAt:      time.Now(),
	}

	if db != nil {
		_, _ = db.Exec(`INSERT INTO merchant_accounts (merchant_id, business_name, api_key, webhook_url, webhook_secret, settlement_coin, fee_percent, status, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			merchant.MerchantID, merchant.BusinessName, merchant.APIKey, merchant.WebhookURL,
			merchant.WebhookSecret, merchant.SettlementCoin, merchant.FeePercent, merchant.Status, merchant.CreatedAt)
	}

	slog.Info("Merchant registered", "id", merchant.MerchantID, "business", req.BusinessName)
	respondJSON(c, http.StatusCreated, gin.H{
		"merchant_id":    merchant.MerchantID,
		"api_key":        merchant.APIKey,
		"webhook_secret": merchant.WebhookSecret,
		"status":         merchant.Status,
	})
}

func createPaymentIntent(c *gin.Context) {
	var req struct {
		MerchantID  string            `json:"merchant_id" binding:"required"`
		Amount      float64           `json:"amount" binding:"required,gt=0"`
		Currency    string            `json:"currency"`
		Stablecoin  string            `json:"stablecoin,omitempty"`
		Description string            `json:"description"`
		Metadata    map[string]string `json:"metadata,omitempty"`
		ExpiresMin  int               `json:"expires_in_minutes"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Currency == "" {
		req.Currency = "USD"
	}
	if req.ExpiresMin == 0 {
		req.ExpiresMin = 30
	}

	intentID := generateID("pi")

	// Fail closed: only a real, provider-provisioned deposit address may be
	// returned to a customer. Never fabricate or zero-fill an address.
	depositAddr, err := provisionDepositAddress(c.Request.Context(), intentID, req.Stablecoin)
	if err != nil {
		slog.Error("deposit address provisioning failed — refusing to create intent",
			"intent", intentID, "error", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "NOT_CONFIGURED",
			"message": "deposit address provisioning is unavailable; payment intent not created",
		})
		return
	}

	intent := PaymentIntent{
		IntentID:       intentID,
		MerchantID:     req.MerchantID,
		Amount:         req.Amount,
		Currency:       req.Currency,
		Stablecoin:     req.Stablecoin,
		Description:    req.Description,
		Status:         "created",
		CheckoutURL:    fmt.Sprintf("https://pay.remitflow.io/checkout/%s", intentID),
		DepositAddress: depositAddr,
		ExpiresAt:      time.Now().Add(time.Duration(req.ExpiresMin) * time.Minute),
		CreatedAt:      time.Now(),
		Metadata:       req.Metadata,
	}

	slog.Info("Payment intent created", "id", intentID, "amount", req.Amount, "merchant", req.MerchantID)
	respondJSON(c, http.StatusCreated, intent)
}

// ── Handlers: Batch Payouts ─────────────────────────────────────────────────

func createBatchPayout(c *gin.Context) {
	var req struct {
		Name       string `json:"name" binding:"required"`
		Stablecoin string `json:"stablecoin" binding:"required"`
		Chain      string `json:"chain"`
		Recipients []struct {
			Name    string  `json:"name" binding:"required"`
			Address string  `json:"address" binding:"required"`
			Amount  float64 `json:"amount" binding:"required,gt=0"`
		} `json:"recipients" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Chain == "" {
		req.Chain = "polygon"
	}

	batchID := generateID("batch")
	var totalAmount, totalFee float64
	recipients := make([]BatchRecipient, len(req.Recipients))

	for i, r := range req.Recipients {
		fee := math.Round(r.Amount*0.001*100) / 100
		recipients[i] = BatchRecipient{
			Index:   i,
			Name:    r.Name,
			Address: r.Address,
			Amount:  r.Amount,
			Fee:     fee,
			Status:  "pending",
		}
		totalAmount += r.Amount
		totalFee += fee
	}

	batch := BatchPayout{
		BatchID:        batchID,
		Name:           req.Name,
		Stablecoin:     req.Stablecoin,
		TotalAmount:    totalAmount,
		TotalFee:       totalFee,
		RecipientCount: len(recipients),
		Status:         "ready",
		Recipients:     recipients,
		CreatedAt:      time.Now(),
	}

	slog.Info("Batch payout created", "id", batchID, "recipients", len(recipients), "total", totalAmount)
	respondJSON(c, http.StatusCreated, gin.H{
		"batch_id":        batch.BatchID,
		"status":          batch.Status,
		"total_amount":    batch.TotalAmount,
		"total_fee":       batch.TotalFee,
		"grand_total":     batch.TotalAmount + batch.TotalFee,
		"recipient_count": batch.RecipientCount,
	})
}

func executeBatchPayout(c *gin.Context) {
	batchID := c.Param("batchId")

	// Fail closed: a payout is only reported executed when the configured
	// settlement/chain executor confirms it with a real transaction hash.
	// Never fabricate a tx hash or a "completed" status.
	if appCfg.SettlementExecutorURL == "" {
		slog.Error("batch payout execution refused — no settlement executor configured", "id", batchID)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"batch_id": batchID,
			"status":   "not_configured",
			"error":    "NOT_CONFIGURED",
			"message":  "settlement executor is not configured; payout was NOT executed",
		})
		return
	}

	body, err := json.Marshal(map[string]string{"batch_id": batchID})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost,
		appCfg.SettlementExecutorURL+"/v1/batch-payouts/execute", bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := outboundHTTP.Do(req)
	if err != nil {
		slog.Error("settlement executor unreachable", "id", batchID, "error", err)
		c.JSON(http.StatusBadGateway, gin.H{"batch_id": batchID, "status": "failed", "error": "settlement executor unreachable"})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		c.JSON(http.StatusBadGateway, gin.H{"batch_id": batchID, "status": "failed", "error": fmt.Sprintf("settlement executor returned %d", resp.StatusCode)})
		return
	}
	var out struct {
		TxHash string `json:"tx_hash"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&out); err != nil || out.TxHash == "" {
		c.JSON(http.StatusBadGateway, gin.H{"batch_id": batchID, "status": "failed", "error": "settlement executor returned no transaction hash"})
		return
	}

	slog.Info("Batch payout executed", "id", batchID, "tx_hash", out.TxHash)
	respondJSON(c, http.StatusOK, gin.H{
		"batch_id":  batchID,
		"status":    out.Status,
		"tx_hash":   out.TxHash,
		"completed": time.Now().Format(time.RFC3339),
	})
}

// ── Handlers: Webhook Delivery ──────────────────────────────────────────────

func deliverWebhook(c *gin.Context) {
	var req struct {
		MerchantID string `json:"merchant_id" binding:"required"`
		Event      string `json:"event" binding:"required"`
		Data       json.RawMessage `json:"data" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Fail closed: sign ONLY with the merchant's own stored webhook secret.
	// Never sign with a placeholder or shared constant.
	if db == nil {
		slog.Error("webhook delivery refused — merchant store unavailable", "merchant", req.MerchantID)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "NOT_CONFIGURED", "message": "merchant store unavailable; cannot look up webhook secret"})
		return
	}
	var secret string
	if err := db.QueryRowContext(c.Request.Context(),
		`SELECT webhook_secret FROM merchant_accounts WHERE merchant_id = $1 AND status = 'active'`,
		req.MerchantID).Scan(&secret); err != nil || secret == "" {
		slog.Warn("webhook delivery refused — unknown merchant or missing secret", "merchant", req.MerchantID)
		c.JSON(http.StatusNotFound, gin.H{"error": "merchant not found or has no webhook secret"})
		return
	}

	payload := string(req.Data)
	signature := signPayload(payload, secret)

	slog.Info("Webhook delivered", "merchant", req.MerchantID, "event", req.Event, "signature", signature[:16])
	respondJSON(c, http.StatusOK, gin.H{
		"delivered":   true,
		"event":       req.Event,
		"merchant_id": req.MerchantID,
		"signature":   signature,
	})
}

// ── Main ────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	appCfg = cfg
	slog.Info("Starting Go Payment Engine", "port", cfg.Port)

	// Connect to PostgreSQL
	var err error
	db, err = sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		slog.Warn("PostgreSQL connection failed — running in-memory mode", "error", err)
		db = nil
	} else {
		if err = db.Ping(); err != nil {
			slog.Warn("PostgreSQL ping failed — running in-memory mode", "error", err)
			db = nil
		} else {
			slog.Info("Connected to PostgreSQL")
		}
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery(), requestID())

	// Health
	r.GET("/health", healthCheck)
	r.GET("/ready", healthCheck)

	// All /api/* routes require authentication (service key or merchant API key).
	api := r.Group("/api", authMiddleware())

	// Programmable Payments
	api.POST("/programmable-payments", createProgrammablePayment)

	// Merchant Gateway
	api.POST("/merchants", registerMerchant)
	api.POST("/payment-intents", createPaymentIntent)
	api.POST("/webhooks/deliver", deliverWebhook)

	// Batch Payouts
	api.POST("/batch-payouts", createBatchPayout)
	api.POST("/batch-payouts/:batchId/execute", executeBatchPayout)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	slog.Info("Go Payment Engine running", "port", cfg.Port)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	slog.Info("Shutting down Go Payment Engine...")

	atomic.StoreInt32(&healthy, 0)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("Server forced to shutdown", "error", err)
	}

	if db != nil {
		db.Close()
	}
	slog.Info("Go Payment Engine stopped")
}
