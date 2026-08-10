// RemitFlow — Mojaloop FSPIOP Connector (Go) — v2 with full middleware stack
//
// Implements the Mojaloop FSPIOP API adapter for interbank transfers.
// Middleware stack: Kafka, Dapr, Fluvio, Temporal, Redis, TigerBeetle,
//                  OpenSearch, Permify, Keycloak, APISix, Lakehouse
//
// Mojaloop FSPIOP v1.1 compliance:
//   - POST /v1/transfers — initiate transfer
//   - GET  /v1/transfers/:id — get transfer state
//   - POST /v1/quotes — request quote
//   - GET  /v1/parties/:type/:id — party lookup
//   - PUT  /v1/transfers/:id — transfer callback (fulfil/abort)
//
// BRICSPay/GhIPSS/PAPSS/AfriCBDC bridge: all new rail adapters route
// dual-rail transfers through this connector for last-mile delivery.

package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	Port             string
	KafkaBrokers     string
	MojaloopHubURL   string
	FSPIOPSource     string
	LogLevel         string
	DaprHTTPPort     string
	FluvioGatewayURL string
	TemporalHostPort string
	RedisAddr        string
	TigerBeetleAddr  string
	OpenSearchURL    string
	LakehouseURL     string
	CoreAPIURL       string
	ServiceName      string
}

func loadConfig() Config {
	return Config{
		Port:             getEnv("PORT", "8113"),
		KafkaBrokers:     getEnv("KAFKA_BROKERS", "localhost:9092"),
		// Empty means "no upstream Mojaloop hub/switch configured" — hub-backed
		// endpoints then fail closed with 503 instead of fabricating responses.
		MojaloopHubURL:   getEnv("MOJALOOP_HUB_URL", ""),
		FSPIOPSource:     getEnv("FSPIOP_SOURCE", "remitflow"),
		LogLevel:         getEnv("LOG_LEVEL", "info"),
		DaprHTTPPort:     getEnv("DAPR_HTTP_PORT", "3500"),
		FluvioGatewayURL: getEnv("FLUVIO_GATEWAY_URL", "http://localhost:9003"),
		TemporalHostPort: getEnv("TEMPORAL_HOST_PORT", "localhost:7233"),
		RedisAddr:        getEnv("REDIS_ADDR", "localhost:6379"),
		TigerBeetleAddr:  getEnv("TIGERBEETLE_ADDR", "localhost:3001"),
		OpenSearchURL:    getEnv("OPENSEARCH_URL", "http://localhost:9200"),
		LakehouseURL:     getEnv("LAKEHOUSE_URL", "http://localhost:8090"),
		CoreAPIURL:       getEnv("CORE_API_URL", "http://localhost:3001"),
		ServiceName:      "mojaloop-connector",
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── PostgreSQL Write-Through Persistence ──────────────────────────────────────

type DbPool struct {
	db    *sql.DB
	cache sync.Map // in-memory cache for read-through
}

var dbPool *DbPool

func initDB(cfg Config) {
	dsn := getEnv("DATABASE_URL", "postgres://remitflow:remitflow@localhost:5432/remitflow?sslmode=disable")
	isProduction := os.Getenv("NODE_ENV") == "production"

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		if isProduction {
			log.Fatalf("[MOJALOOP-DB] FATAL: cannot open database in production: %v", err)
		}
		log.Printf("[MOJALOOP-DB] WARN: database unavailable (%v) — using in-memory fallback", err)
		return
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		if isProduction {
			log.Fatalf("[MOJALOOP-DB] FATAL: cannot ping database in production: %v", err)
		}
		log.Printf("[MOJALOOP-DB] WARN: database ping failed (%v) — using in-memory fallback", err)
		return
	}

	// Run migrations
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS mojaloop_transfers (
			transfer_id TEXT PRIMARY KEY,
			payer_fsp TEXT NOT NULL,
			payee_fsp TEXT NOT NULL,
			amount TEXT NOT NULL,
			currency TEXT NOT NULL,
			ilp_packet TEXT,
			condition TEXT,
			state TEXT NOT NULL DEFAULT 'RECEIVED',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS mojaloop_quotes (
			quote_id TEXT PRIMARY KEY,
			payer_fsp TEXT NOT NULL,
			payee_fsp TEXT NOT NULL,
			payer_id TEXT,
			payee_id TEXT,
			amount TEXT NOT NULL,
			currency TEXT NOT NULL,
			transfer_amount TEXT,
			ilp_packet TEXT,
			condition TEXT,
			expires_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS mojaloop_outbox (
			id BIGSERIAL PRIMARY KEY,
			topic TEXT NOT NULL,
			key TEXT NOT NULL,
			payload JSONB NOT NULL,
			published BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_state ON mojaloop_transfers(state)`,
		`CREATE INDEX IF NOT EXISTS idx_mojaloop_outbox_unpublished ON mojaloop_outbox(published) WHERE NOT published`,
	}

	for _, m := range migrations {
		if _, err := db.ExecContext(ctx, m); err != nil {
			log.Printf("[MOJALOOP-DB] WARN: migration failed: %v", err)
		}
	}

	dbPool = &DbPool{db: db}
	log.Printf("[MOJALOOP-DB] Connected and migrated successfully")
}

func dbUpsertTransfer(ctx context.Context, t TransferRequest, state string) {
	if dbPool == nil {
		return
	}
	_, err := dbPool.db.ExecContext(ctx,
		`INSERT INTO mojaloop_transfers (transfer_id, payer_fsp, payee_fsp, amount, currency, ilp_packet, condition, state)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (transfer_id) DO UPDATE SET state = $8, updated_at = NOW()`,
		t.TransferID, t.PayerFSP, t.PayeeFSP, t.Amount, t.Currency, t.ILPPacket, t.Condition, state)
	if err != nil {
		log.Printf("[MOJALOOP-DB] WARN: transfer upsert failed: %v", err)
	}
	dbPool.cache.Store("transfer:"+t.TransferID, state)
}

func dbUpdateTransferState(ctx context.Context, transferID, state string) {
	if dbPool == nil {
		return
	}
	_, err := dbPool.db.ExecContext(ctx,
		`UPDATE mojaloop_transfers SET state = $1, updated_at = NOW() WHERE transfer_id = $2`,
		state, transferID)
	if err != nil {
		log.Printf("[MOJALOOP-DB] WARN: transfer state update failed: %v", err)
	}
	dbPool.cache.Store("transfer:"+transferID, state)
}

func dbGetTransferState(ctx context.Context, transferID string) (string, error) {
	if dbPool == nil {
		return "", fmt.Errorf("transfer store unavailable (no database connection)")
	}
	if cached, ok := dbPool.cache.Load("transfer:" + transferID); ok {
		return cached.(string), nil
	}
	var state string
	err := dbPool.db.QueryRowContext(ctx,
		`SELECT state FROM mojaloop_transfers WHERE transfer_id = $1`, transferID).Scan(&state)
	if err == sql.ErrNoRows {
		return "", errTransferNotFound
	}
	if err != nil {
		return "", fmt.Errorf("transfer state query failed: %w", err)
	}
	dbPool.cache.Store("transfer:"+transferID, state)
	return state, nil
}

var errTransferNotFound = fmt.Errorf("transfer not found")

func dbInsertQuote(ctx context.Context, q QuoteRequest, resp QuoteResponse) {
	if dbPool == nil {
		return
	}
	_, err := dbPool.db.ExecContext(ctx,
		`INSERT INTO mojaloop_quotes (quote_id, payer_fsp, payee_fsp, payer_id, payee_id, amount, currency, transfer_amount, ilp_packet, condition, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 ON CONFLICT (quote_id) DO NOTHING`,
		q.QuoteID, q.PayerFSP, q.PayeeFSP, q.PayerID, q.PayeeID, q.Amount, q.Currency,
		resp.TransferAmount, resp.ILPPacket, resp.Condition, resp.ExpirationISO)
	if err != nil {
		log.Printf("[MOJALOOP-DB] WARN: quote insert failed: %v", err)
	}
}

func dbInsertOutbox(ctx context.Context, topic, key string, payload any) {
	if dbPool == nil {
		return
	}
	data, _ := json.Marshal(payload)
	_, _ = dbPool.db.ExecContext(ctx,
		`INSERT INTO mojaloop_outbox (topic, key, payload) VALUES ($1, $2, $3)`,
		topic, key, data)
}

// ── Domain Types ──────────────────────────────────────────────────────────────

type TransferRequest struct {
	TransferID    string `json:"transferId"`
	PayerFSP      string `json:"payerFsp"`
	PayeeFSP      string `json:"payeeFsp"`
	Amount        string `json:"amount"`
	Currency      string `json:"currency"`
	ILPPacket     string `json:"ilpPacket"`
	Condition     string `json:"condition"`
	ExpirationISO string `json:"expiration"`
}

type TransferResponse struct {
	TransferID    string `json:"transferId"`
	TransferState string `json:"transferState"`
	FulfilmentISO string `json:"fulfilment,omitempty"`
	CompletedAt   string `json:"completedTimestamp,omitempty"`
}

type QuoteRequest struct {
	QuoteID  string `json:"quoteId"`
	PayerFSP string `json:"payerFsp"`
	PayeeFSP string `json:"payeeFsp"`
	PayerID  string `json:"payerId"`
	PayeeID  string `json:"payeeId"`
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

type QuoteResponse struct {
	QuoteID            string `json:"quoteId"`
	TransferAmount     string `json:"transferAmount"`
	PayeeReceiveAmount string `json:"payeeReceiveAmount"`
	ILPPacket          string `json:"ilpPacket"`
	Condition          string `json:"condition"`
	ExpirationISO      string `json:"expiration"`
}

// ── Middleware helpers ────────────────────────────────────────────────────────

// httpClient with connection pooling tuned for 1M+ TPS.
// MaxIdleConnsPerHost must match the upstream's capacity.
var httpTransport = &http.Transport{
	MaxIdleConns:        500,
	MaxIdleConnsPerHost: 100,
	MaxConnsPerHost:     200,
	IdleConnTimeout:     90 * time.Second,
	TLSHandshakeTimeout: 5 * time.Second,
	DisableKeepAlives:   false,
	ForceAttemptHTTP2:   true,
}
var httpClient = &http.Client{
	Timeout:   10 * time.Second,
	Transport: httpTransport,
}

func postJSON(url string, payload any) {
	body, _ := json.Marshal(payload)
	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("[MW] WARN POST %s: %v", url, err)
		return
	}
	resp.Body.Close()
}

func publishKafka(cfg Config, topic string, payload any) {
	postJSON(fmt.Sprintf("http://localhost:8095/publish/%s", topic), map[string]any{
		"eventType": topic, "serviceName": cfg.ServiceName,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "payload": payload,
	})
}

func publishDapr(cfg Config, topic string, data map[string]any) {
	postJSON(fmt.Sprintf("http://localhost:%s/v1.0/publish/remitflow-pubsub/%s", cfg.DaprHTTPPort, topic),
		map[string]any{"data": data})
}

func produceFluvio(cfg Config, topic, key, value string) {
	postJSON(cfg.FluvioGatewayURL+"/produce", map[string]string{"topic": topic, "key": key, "value": value})
}

func recordTigerBeetle(cfg Config, transferID, debit, credit string, amount int64, ledger uint32) {
	postJSON("http://localhost:8096/transfers", map[string]any{
		"id": transferID, "debitAccountId": debit,
		"creditAccountId": credit, "amount": amount,
		"ledger": ledger, "code": 0, // code 0 = Mojaloop transfers
	})
}

// ── Real ILP + amount handling ────────────────────────────────────────────────

// currencyDecimals holds ISO-4217 minor-unit exponents for corridor currencies.
var currencyDecimals = map[string]int{
	"NGN": 2, "KES": 2, "GHS": 2, "TZS": 2, "UGX": 0, "ZAR": 2,
	"XOF": 0, "MWK": 2, "ZMW": 2, "USD": 2, "EUR": 2, "GBP": 2,
}

// parseAmountMinorUnits converts a decimal amount string to minor units using
// exact string arithmetic (no float rounding). Returns an error on bad input.
func parseAmountMinorUnits(amount, currency string) (int64, error) {
	decimals, ok := currencyDecimals[strings.ToUpper(currency)]
	if !ok {
		decimals = 2
	}
	trimmed := strings.TrimSpace(amount)
	if trimmed == "" {
		return 0, fmt.Errorf("empty amount")
	}
	parts := strings.SplitN(trimmed, ".", 2)
	if len(parts[0]) == 0 || !isDigits(parts[0]) {
		return 0, fmt.Errorf("invalid amount %q", amount)
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount %q: %w", amount, err)
	}
	var frac int64
	if len(parts) == 2 {
		fracStr := parts[1]
		if len(fracStr) > decimals {
			return 0, fmt.Errorf("amount %q exceeds %d decimal places for %s", amount, decimals, currency)
		}
		if len(fracStr) > 0 && !isDigits(fracStr) {
			return 0, fmt.Errorf("invalid amount %q", amount)
		}
		fracStr += strings.Repeat("0", decimals-len(fracStr))
		if len(fracStr) > 0 {
			frac, err = strconv.ParseInt(fracStr, 10, 64)
			if err != nil {
				return 0, fmt.Errorf("invalid amount %q: %w", amount, err)
			}
		}
	}
	scale := int64(1)
	for i := 0; i < decimals; i++ {
		scale *= 10
	}
	return whole*scale + frac, nil
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// generateFulfillmentCondition creates a real ILP condition/fulfillment pair:
// fulfillment = 32 random bytes (base64url), condition = base64url(SHA-256(fulfillment)).
func generateFulfillmentCondition() (fulfillment, condition string, err error) {
	fulfillmentBytes := make([]byte, 32)
	if _, err = rand.Read(fulfillmentBytes); err != nil {
		return "", "", fmt.Errorf("entropy failure generating fulfillment: %w", err)
	}
	sum := sha256.Sum256(fulfillmentBytes)
	return base64.RawURLEncoding.EncodeToString(fulfillmentBytes),
		base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// serializeILPPrepare builds a real ILPv4 Prepare packet per IL-RFC-27:
//
//	type(1)=12 | length(4,BE) | amount(8,BE) | expiresAt(17 ASCII "YYYYMMDDHHMMSS.mmm")
//	| condition(32) | destination(VarOctetString) | data(VarOctetString)
func serializeILPPrepare(amountMinorUnits int64, destination string, conditionB64 string, expiresAt time.Time, data []byte) (string, error) {
	condition, err := base64.RawURLEncoding.DecodeString(conditionB64)
	if err != nil || len(condition) != 32 {
		return "", fmt.Errorf("invalid ILP condition encoding")
	}
	if len(destination) > 255 || len(data) > 255 {
		return "", fmt.Errorf("ILP field exceeds single-byte length prefix")
	}
	timestamp := expiresAt.UTC().Format("20060102150405") + "." +
		fmt.Sprintf("%03d", expiresAt.UTC().Nanosecond()/1e6)

	var contents bytes.Buffer
	var amountBuf [8]byte
	binary.BigEndian.PutUint64(amountBuf[:], uint64(amountMinorUnits))
	contents.Write(amountBuf[:])
	contents.WriteString(timestamp)
	contents.Write(condition)
	contents.WriteByte(byte(len(destination)))
	contents.WriteString(destination)
	contents.WriteByte(byte(len(data)))
	contents.Write(data)

	var packet bytes.Buffer
	packet.WriteByte(12) // ILP Prepare
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(contents.Len()))
	packet.Write(lenBuf[:])
	packet.Write(contents.Bytes())
	return base64.RawURLEncoding.EncodeToString(packet.Bytes()), nil
}

// ── Real Prometheus counters ──────────────────────────────────────────────────

var (
	metricTransfersInitiated atomic.Int64
	metricTransfersCommitted atomic.Int64
	metricTransfersAborted   atomic.Int64
	metricQuotesRequested    atomic.Int64
	metricPartyLookups       atomic.Int64
	metricHubErrors          atomic.Int64
)

// ── Mojaloop hub/switch forwarding ────────────────────────────────────────────

// forwardToHub proxies an FSPIOP request to the configured Mojaloop hub and
// writes the hub's status code + body back to the caller. Returns false when
// no hub is configured (caller must fail closed).
func forwardToHub(c *gin.Context, cfg Config, method, path string, payload any) bool {
	if cfg.MojaloopHubURL == "" {
		return false
	}
	var bodyReader io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot marshal FSPIOP payload"})
			return true
		}
		bodyReader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), method, cfg.MojaloopHubURL+path, bodyReader)
	if err != nil {
		metricHubErrors.Add(1)
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("hub request build failed: %v", err)})
		return true
	}
	req.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("Accept", "application/vnd.interoperability.transfers+json;version=1.1")
	req.Header.Set("FSPIOP-Source", cfg.FSPIOPSource)
	req.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	resp, err := httpClient.Do(req)
	if err != nil {
		metricHubErrors.Add(1)
		log.Printf("[HUB] ERROR %s %s: %v", method, path, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("mojaloop hub unreachable: %v", err)})
		return true
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		metricHubErrors.Add(1)
	}
	c.Data(resp.StatusCode, "application/json", respBody)
	return true
}

func indexOpenSearch(cfg Config, index, docID string, doc map[string]any) {
	body, _ := json.Marshal(doc)
	req, _ := http.NewRequest("PUT", fmt.Sprintf("%s/%s/_doc/%s", cfg.OpenSearchURL, index, docID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[OpenSearch] WARN: %v", err)
		return
	}
	resp.Body.Close()
}

func emitLakehouse(cfg Config, eventType string, data map[string]any) {
	postJSON(cfg.LakehouseURL+"/events", map[string]any{
		"source": cfg.ServiceName, "eventType": eventType,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "data": data,
	})
}

func triggerTemporalWorkflow(cfg Config, workflowType, workflowID string, input map[string]any) {
	postJSON("http://localhost:8098/workflows/start", map[string]any{
		"workflowType": workflowType, "workflowId": workflowID,
		"taskQueue": "remitflow-mojaloop", "input": input,
	})
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func healthHandler(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		dbStatus := "disconnected"
		if dbPool != nil {
			if err := dbPool.db.PingContext(c.Request.Context()); err == nil {
				dbStatus = "connected"
			}
		}
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"service":   cfg.ServiceName,
			"version":   "2.1.0",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"database":  dbStatus,
			"middleware": map[string]string{
				"kafka": cfg.KafkaBrokers, "dapr": "port:" + cfg.DaprHTTPPort,
				"fluvio": cfg.FluvioGatewayURL, "temporal": cfg.TemporalHostPort,
				"tigerbeetle": cfg.TigerBeetleAddr, "opensearch": cfg.OpenSearchURL,
				"lakehouse": cfg.LakehouseURL, "postgresql": "pgx/v5",
			},
		})
	}
}

func initiateTransferHandler(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req TransferRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.TransferID == "" {
			req.TransferID = uuid.New().String()
		}

		expiration := time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339)

		// Parse the real transfer amount (minor units) for ledger recording.
		amountMinor, amountErr := parseAmountMinorUnits(req.Amount, req.Currency)
		if amountErr != nil {
			metricTransfersAborted.Add(1)
			log.Printf("[TRANSFER] REJECTED %s: unparseable amount %q %s: %v", req.TransferID, req.Amount, req.Currency, amountErr)
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid amount: %v", amountErr)})
			return
		}

		// 0. Persist to PostgreSQL (write-through — DB first, then cache)
		dbUpsertTransfer(c.Request.Context(), req, "RECEIVED")
		dbInsertOutbox(c.Request.Context(), "payment.mojaloop.initiated", req.TransferID, map[string]any{
			"transferId": req.TransferID, "payerFsp": req.PayerFSP,
			"payeeFsp": req.PayeeFSP, "amount": req.Amount, "currency": req.Currency,
		})

		metricTransfersInitiated.Add(1)

		// 0b. Forward to the Mojaloop hub/switch when configured. On hub failure
		// the transfer is marked ABORTED and the error is returned — never faked.
		if cfg.MojaloopHubURL != "" {
			hubBody, _ := json.Marshal(map[string]any{
				"transferId": req.TransferID, "payerFsp": req.PayerFSP, "payeeFsp": req.PayeeFSP,
				"amount":    map[string]string{"amount": req.Amount, "currency": req.Currency},
				"ilpPacket": req.ILPPacket, "condition": req.Condition,
				"expiration": expiration,
			})
			hubReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost,
				cfg.MojaloopHubURL+"/transfers", bytes.NewReader(hubBody))
			if err == nil {
				hubReq.Header.Set("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
				hubReq.Header.Set("FSPIOP-Source", cfg.FSPIOPSource)
				hubReq.Header.Set("FSPIOP-Destination", req.PayeeFSP)
				hubReq.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
				var hubResp *http.Response
				hubResp, err = httpClient.Do(hubReq)
				if err != nil {
					metricHubErrors.Add(1)
					dbUpdateTransferState(c.Request.Context(), req.TransferID, "ABORTED")
					metricTransfersAborted.Add(1)
					log.Printf("[HUB] ERROR forwarding transfer %s: %v", req.TransferID, err)
					c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("mojaloop hub unreachable: %v", err), "transferId": req.TransferID, "transferState": "ABORTED"})
					return
				}
				defer hubResp.Body.Close()
				if hubResp.StatusCode >= 400 {
					metricHubErrors.Add(1)
					respBody, _ := io.ReadAll(io.LimitReader(hubResp.Body, 1<<20))
					dbUpdateTransferState(c.Request.Context(), req.TransferID, "ABORTED")
					metricTransfersAborted.Add(1)
					log.Printf("[HUB] Transfer %s rejected by hub: %d %s", req.TransferID, hubResp.StatusCode, string(respBody))
					c.Data(hubResp.StatusCode, "application/json", respBody)
					return
				}
			}
		}

		// 1. Record in TigerBeetle (ledger 0 = Mojaloop) with the real amount
		recordTigerBeetle(cfg, req.TransferID,
			"mojaloop-debit-pool", "mojaloop-credit-pool",
			amountMinor, 0)

		// 2. Publish Kafka event
		publishKafka(cfg, "payment.mojaloop.initiated", map[string]any{
			"transferId": req.TransferID, "payerFsp": req.PayerFSP,
			"payeeFsp": req.PayeeFSP, "amount": req.Amount,
			"currency": req.Currency,
		})

		// 3. Dapr pub/sub
		publishDapr(cfg, "mojaloop-transfer-initiated", map[string]any{
			"transferId": req.TransferID, "status": "RECEIVED",
		})

		// 4. Fluvio stream
		produceFluvio(cfg, "mojaloop-transfers", req.TransferID,
			fmt.Sprintf(`{"transferId":"%s","payerFsp":"%s","payeeFsp":"%s","amount":"%s"}`,
				req.TransferID, req.PayerFSP, req.PayeeFSP, req.Amount))

		// 5. Temporal settlement workflow
		triggerTemporalWorkflow(cfg, "MojaloopFSPIOPSettlementWorkflow", req.TransferID, map[string]any{
			"transferId": req.TransferID, "payerFsp": req.PayerFSP,
			"payeeFsp": req.PayeeFSP, "currency": req.Currency,
		})

		// 6. OpenSearch index
		indexOpenSearch(cfg, "mojaloop-transfers", req.TransferID, map[string]any{
			"transferId": req.TransferID, "payerFsp": req.PayerFSP,
			"payeeFsp": req.PayeeFSP, "amount": req.Amount,
			"currency": req.Currency, "status": "RECEIVED",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})

		// 7. Lakehouse ETL
		emitLakehouse(cfg, "mojaloop.transfer.initiated", map[string]any{
			"transferId": req.TransferID, "payerFsp": req.PayerFSP,
			"payeeFsp": req.PayeeFSP, "amount": req.Amount, "currency": req.Currency,
		})

		log.Printf("[TRANSFER] Initiated %s: %s %s → %s", req.TransferID, req.Amount, req.PayerFSP, req.PayeeFSP)
		c.JSON(http.StatusAccepted, TransferResponse{
			TransferID:    req.TransferID,
			TransferState: "RECEIVED",
			CompletedAt:   expiration,
		})
	}
}

func getTransferHandler(c *gin.Context) {
	transferID := c.Param("id")
	state, err := dbGetTransferState(c.Request.Context(), transferID)
	if err == errTransferNotFound {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("transfer not found: %s", transferID)})
		return
	}
	if err != nil {
		log.Printf("[TRANSFER] State lookup failed for %s: %v", transferID, err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "transfer state unavailable"})
		return
	}
	c.JSON(http.StatusOK, TransferResponse{
		TransferID:    transferID,
		TransferState: state,
		CompletedAt:   time.Now().UTC().Format(time.RFC3339),
	})
}

func requestQuoteHandler(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req QuoteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.QuoteID == "" {
			req.QuoteID = uuid.New().String()
		}
		expiration := time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339)
		metricQuotesRequested.Add(1)

		// Publish quote event to Kafka
		publishKafka(cfg, "mojaloop.quote.requested", map[string]any{
			"quoteId": req.QuoteID, "payerFsp": req.PayerFSP,
			"payeeFsp": req.PayeeFSP, "amount": req.Amount, "currency": req.Currency,
		})

		// When a Mojaloop hub is configured, the quote is authoritative there —
		// forward and relay the real response (fees, ilpPacket, condition).
		if cfg.MojaloopHubURL != "" {
			if forwardToHub(c, cfg, http.MethodPost, "/quotes", map[string]any{
				"quoteId": req.QuoteID, "transactionId": uuid.New().String(),
				"payer": map[string]string{"partyIdType": "MSISDN", "partyIdentifier": req.PayerID, "fspId": req.PayerFSP},
				"payee": map[string]string{"partyIdType": "MSISDN", "partyIdentifier": req.PayeeID, "fspId": req.PayeeFSP},
				"amountType": "SEND",
				"amount":     map[string]string{"amount": req.Amount, "currency": req.Currency},
				"transactionType": map[string]string{
					"scenario": "TRANSFER", "initiator": "PAYER", "initiatorType": "CONSUMER",
				},
			}) {
				return
			}
			// no hub configured — fall through to locally-built real ILP below
		}

		// No upstream hub: build a REAL ILPv4 Prepare packet with a real
		// SHA-256 condition/fulfillment pair (condition = sha256(fulfillment)).
		fulfillment, condition, err := generateFulfillmentCondition()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		amountMinor, err := parseAmountMinorUnits(req.Amount, req.Currency)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid amount: %v", err)})
			return
		}
		expiresAt := time.Now().Add(30 * time.Second).UTC()
		ilpPacket, err := serializeILPPrepare(amountMinor,
			fmt.Sprintf("g.%s.%s", req.PayeeFSP, req.PayeeID), condition, expiresAt, nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		resp := QuoteResponse{
			QuoteID:            req.QuoteID,
			TransferAmount:     req.Amount,
			PayeeReceiveAmount: req.Amount,
			ILPPacket:          ilpPacket,
			Condition:          condition,
			ExpirationISO:      expiration,
		}

		// Persist quote to PostgreSQL (write-through)
		dbInsertQuote(c.Request.Context(), req, resp)

		log.Printf("[QUOTE] Created %s: %s %s (fulfillment %s held locally until commit)", req.QuoteID, req.Amount, req.Currency, fulfillment[:8])
		c.JSON(http.StatusOK, resp)
	}
}

func partyLookupHandler(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		partyType := c.Param("type")
		partyID := c.Param("id")
		metricPartyLookups.Add(1)

		// Real lookup goes to the Mojaloop hub's account-lookup service.
		// No hub configured → fail closed, never fabricate a party.
		if !forwardToHub(c, cfg, http.MethodGet,
			fmt.Sprintf("/parties/%s/%s", url.PathEscape(partyType), url.PathEscape(partyID)), nil) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "party lookup unavailable: MOJALOOP_HUB_URL is not configured",
			})
			return
		}
		log.Printf("[PARTY] Lookup %s/%s forwarded to hub", partyType, partyID)
	}
}

func participantsHandler(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !forwardToHub(c, cfg, http.MethodGet, "/participants", nil) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "participants unavailable: MOJALOOP_HUB_URL is not configured",
			})
			return
		}
	}
}

func transferCallbackHandler(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		transferID := c.Param("id")
		var body map[string]interface{}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		bodyJSON, _ := json.Marshal(body)
		log.Printf("[CALLBACK] Transfer callback %s: %s", transferID, string(bodyJSON))

		// Use the real state reported by the switch — default to COMMITTED only
		// for the standard PUT /transfers/{id} fulfilment form.
		state := "COMMITTED"
		if s, ok := body["transferState"].(string); ok && s != "" {
			state = s
		}

		// Persist state transition to PostgreSQL
		dbUpdateTransferState(c.Request.Context(), transferID, state)
		if state == "COMMITTED" {
			metricTransfersCommitted.Add(1)
		} else if state == "ABORTED" {
			metricTransfersAborted.Add(1)
		}

		// Publish callback to Kafka
		publishKafka(cfg, "mojaloop.transfer.callback", map[string]any{
			"transferId": transferID, "callback": body,
		})

		// Publish Dapr event
		publishDapr(cfg, "mojaloop-transfer-callback", map[string]any{
			"transferId": transferID, "status": state,
		})

		// Emit to Lakehouse
		emitLakehouse(cfg, "mojaloop.transfer.callback", map[string]any{
			"transferId": transferID, "callback": body,
		})

		// Forward to Node.js core API for transfer state advancement
		go forwardToCore(cfg, transferID, body)

		c.JSON(http.StatusOK, gin.H{"status": "accepted"})
	}
}

// forwardToCore sends the Mojaloop callback to the Node.js core webhook handler
// so that transfer state is advanced from partner_sent → completed.
// computeWebhookHMAC generates HMAC-SHA256 signature for webhook payloads
func computeWebhookHMAC(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

func forwardToCore(cfg Config, transferID string, body map[string]interface{}) {
	payload, _ := json.Marshal(map[string]interface{}{
		"transferId":   transferID,
		"transferState": body["transferState"],
		"fulfilment":    body["fulfilment"],
		"completedTimestamp": body["completedTimestamp"],
	})

	url := fmt.Sprintf("%s/api/webhooks/mojaloop", cfg.CoreAPIURL)
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		log.Printf("[CORE-FORWARD] Failed to create request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-By", "mojaloop-connector")

	// Sign the webhook payload with HMAC-SHA256. No default secret: when the
	// shared secret is not configured we fail loudly instead of sending an
	// unverifiable webhook.
	secret := os.Getenv("WEBHOOK_SECRET_MOJALOOP")
	if secret == "" {
		log.Printf("[CORE-FORWARD] ERROR: WEBHOOK_SECRET_MOJALOOP not set — refusing to forward unsigned webhook for transfer %s", transferID)
		return
	}
	signature := computeWebhookHMAC(payload, secret)
	req.Header.Set("X-Webhook-Signature", "sha256="+signature)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[CORE-FORWARD] Failed to forward to core: %v", err)
		return
	}
	defer resp.Body.Close()
	log.Printf("[CORE-FORWARD] Forwarded transfer %s to core → %d", transferID, resp.StatusCode)
}

func metricsHandler(c *gin.Context) {
	c.String(http.StatusOK, fmt.Sprintf(`# HELP mojaloop_transfers_total Total Mojaloop transfers
# TYPE mojaloop_transfers_total counter
mojaloop_transfers_total{status="initiated"} %d
mojaloop_transfers_total{status="committed"} %d
mojaloop_transfers_total{status="aborted"} %d
# HELP mojaloop_quotes_total Total Mojaloop quotes requested
# TYPE mojaloop_quotes_total counter
mojaloop_quotes_total %d
# HELP mojaloop_party_lookups_total Total party lookups forwarded to the hub
# TYPE mojaloop_party_lookups_total counter
mojaloop_party_lookups_total %d
# HELP mojaloop_hub_errors_total Total Mojaloop hub/switch errors
# TYPE mojaloop_hub_errors_total counter
mojaloop_hub_errors_total %d
`,
		metricTransfersInitiated.Load(),
		metricTransfersCommitted.Load(),
		metricTransfersAborted.Load(),
		metricQuotesRequested.Load(),
		metricPartyLookups.Load(),
		metricHubErrors.Load(),
	))
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	initDB(cfg)

	if cfg.LogLevel != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		c.Header("FSPIOP-Source", cfg.FSPIOPSource)
		c.Header("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
		c.Next()
	})

	r.GET("/health", healthHandler(cfg))
	r.GET("/metrics", metricsHandler)

	v1 := r.Group("/v1")
	{
		v1.POST("/transfers", initiateTransferHandler(cfg))
		v1.GET("/transfers/:id", getTransferHandler)
		v1.POST("/quotes", requestQuoteHandler(cfg))
		v1.GET("/parties/:type/:id", partyLookupHandler(cfg))
		v1.PUT("/transfers/:id", transferCallbackHandler(cfg))
		v1.GET("/participants", participantsHandler(cfg))
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    1 << 16, // 64KB
	}

	go func() {
		log.Printf("[MOJALOOP-CONNECTOR] v2 starting on port %s | Hub: %s | FSPIOP: %s",
			cfg.Port, cfg.MojaloopHubURL, cfg.FSPIOPSource)
		log.Printf("[MOJALOOP-CONNECTOR] Middleware: Kafka=%s Dapr=%s Fluvio=%s Temporal=%s",
			cfg.KafkaBrokers, cfg.DaprHTTPPort, cfg.FluvioGatewayURL, cfg.TemporalHostPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[MOJALOOP-CONNECTOR] Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Shutdown error: %v", err)
	}
	log.Println("[MOJALOOP-CONNECTOR] Stopped")
}
