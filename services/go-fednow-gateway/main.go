package main

import (
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// FedNow ISO 20022 Gateway Service
// Implements FedNow Service ISO 20022 message processing
// Handles pacs.008 (Credit Transfer), pacs.002 (Status Report), camt.056 (Return Request)


var db *sql.DB

type FedNowTransfer struct {
	TransactionID string    `json:"transactionId"`
	EndToEndID    string    `json:"endToEndId"`
	Amount        float64   `json:"amount"`
	Currency      string    `json:"currency"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
	SettledAt     *time.Time `json:"settledAt,omitempty"`
	RoutingNumber string    `json:"creditorRoutingNumber"`
	AccountNumber string    `json:"creditorAccountNumber"`
	CreditorName  string    `json:"creditorName"`
	ISO20022Msg   string    `json:"iso20022Message,omitempty"`
}

type FedNowGateway struct {
	mu          sync.RWMutex
	transfers   map[string]*FedNowTransfer
	metrics     *Metrics
	kafkaURL    string
	daprURL     string
	maxAmount   float64
}

type Metrics struct {
	mu              sync.Mutex
	TotalTransfers  int64   `json:"totalTransfers"`
	SuccessCount    int64   `json:"successCount"`
	FailureCount    int64   `json:"failureCount"`
	TotalVolume     float64 `json:"totalVolumeUSD"`
	AvgLatencyMs    float64 `json:"avgLatencyMs"`
	latencySum      float64
}

type SubmitRequest struct {
	MessageID           string `json:"messageId"`
	CreationDateTime    string `json:"creationDateTime"`
	PaymentInformation  struct {
		PaymentInformationID      string `json:"paymentInformationId"`
		PaymentMethod             string `json:"paymentMethod"`
		CreditTransferTransaction struct {
			PaymentID struct {
				EndToEndID    string `json:"endToEndId"`
				TransactionID string `json:"transactionId"`
			} `json:"paymentId"`
			Amount struct {
				InstructedAmount float64 `json:"instructedAmount"`
				Currency         string  `json:"currency"`
			} `json:"amount"`
			CreditorAgent struct {
				FinancialInstitutionID struct {
					ClearingSystemMemberID string `json:"clearingSystemMemberId"`
				} `json:"financialInstitutionId"`
			} `json:"creditorAgent"`
			Creditor struct {
				Name string `json:"name"`
			} `json:"creditor"`
			CreditorAccount struct {
				ID string `json:"id"`
			} `json:"creditorAccount"`
		} `json:"creditTransferTransaction"`
	} `json:"paymentInformation"`
}

func NewFedNowGateway() *FedNowGateway {
	maxAmt, _ := strconv.ParseFloat(os.Getenv("FEDNOW_MAX_AMOUNT"), 64)
	if maxAmt <= 0 {
		maxAmt = 500000
	}
	return &FedNowGateway{
		transfers: make(map[string]*FedNowTransfer),
		metrics:   &Metrics{},
		kafkaURL:  getEnv("KAFKA_REST_URL", "http://localhost:8093"),
		daprURL:   getEnv("DAPR_HTTP_URL", "http://localhost:3500"),
		maxAmount: maxAmt,
	}
}

func (g *FedNowGateway) handleSubmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	start := time.Now()
	var req SubmitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	txInfo := req.PaymentInformation.CreditTransferTransaction
	amount := txInfo.Amount.InstructedAmount
	currency := txInfo.Amount.Currency

	// Validate
	if currency != "USD" {
		jsonError(w, "FedNow only supports USD", http.StatusBadRequest)
		return
	}
	if amount <= 0 || amount > g.maxAmount {
		jsonError(w, fmt.Sprintf("Amount must be between $0.01 and $%.2f", g.maxAmount), http.StatusBadRequest)
		return
	}
	routingNumber := txInfo.CreditorAgent.FinancialInstitutionID.ClearingSystemMemberID
	if len(routingNumber) != 9 {
		jsonError(w, "Invalid ABA routing number (must be 9 digits)", http.StatusBadRequest)
		return
	}
	if !validateABARouting(routingNumber) {
		jsonError(w, "ABA routing number check digit validation failed", http.StatusBadRequest)
		return
	}

	// Generate FedNow transaction
	txID := req.MessageID
	if txID == "" {
		txID = generateID("FEDNOW")
	}
	e2eID := txInfo.PaymentID.EndToEndID
	if e2eID == "" {
		e2eID = generateID("E2E")
	}

	transfer := &FedNowTransfer{
		TransactionID: txID,
		EndToEndID:    e2eID,
		Amount:        amount,
		Currency:      currency,
		Status:        "ACSP", // Accepted Settlement in Process
		CreatedAt:     time.Now(),
		RoutingNumber: routingNumber,
		AccountNumber: txInfo.CreditorAccount.ID,
		CreditorName:  txInfo.Creditor.Name,
	}

	// Build ISO 20022 pacs.008
	transfer.ISO20022Msg = buildPacs008(transfer)

	// Store
	g.mu.Lock()
	g.transfers[txID] = transfer
	g.mu.Unlock()

	// Simulate instant settlement (FedNow settles in <30 seconds)
	go func() {
		time.Sleep(2 * time.Second)
		g.mu.Lock()
		if t, ok := g.transfers[txID]; ok {
			now := time.Now()
			t.Status = "ACSC" // Accepted Settlement Completed
			t.SettledAt = &now
		}
		g.mu.Unlock()

		// Publish settlement event to Kafka via Dapr
		g.publishEvent("remitflow.transfers.fednow.settled", map[string]interface{}{
			"transactionId": txID,
			"endToEndId":    e2eID,
			"amount":        amount,
			"status":        "ACSC",
			"settledAt":     time.Now().Format(time.RFC3339),
		})
	}()

	// Update metrics
	latency := float64(time.Since(start).Milliseconds())
	g.metrics.mu.Lock()
	g.metrics.TotalTransfers++
	g.metrics.SuccessCount++
	g.metrics.TotalVolume += amount
	g.metrics.latencySum += latency
	g.metrics.AvgLatencyMs = g.metrics.latencySum / float64(g.metrics.TotalTransfers)
	g.metrics.mu.Unlock()

	// Publish to Kafka
	g.publishEvent("remitflow.transfers.fednow", map[string]interface{}{
		"transactionId": txID,
		"endToEndId":    e2eID,
		"amount":        amount,
		"currency":      currency,
		"status":        "ACSP",
		"timestamp":     time.Now().Format(time.RFC3339),
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"transactionId":      txID,
		"endToEndId":         e2eID,
		"status":             "ACSP",
		"reference":          txID,
		"estimatedSettlement": "< 30 seconds",
		"rail":               "FedNow",
		"processedAt":        time.Now().Format(time.RFC3339),
	})
}

func (g *FedNowGateway) handleStatus(w http.ResponseWriter, r *http.Request) {
	txID := r.URL.Query().Get("transactionId")
	if txID == "" {
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) > 2 {
			txID = parts[len(parts)-1]
		}
	}
	if txID == "" {
		jsonError(w, "transactionId required", http.StatusBadRequest)
		return
	}

	g.mu.RLock()
	transfer, ok := g.transfers[txID]
	g.mu.RUnlock()

	if !ok {
		jsonError(w, "Transaction not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(transfer)
}

func (g *FedNowGateway) handleReturn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TransactionID string `json:"transactionId"`
		Reason        string `json:"reason"`
		ReasonCode    string `json:"reasonCode"` // ISO 20022 return reason codes
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	g.mu.Lock()
	transfer, ok := g.transfers[req.TransactionID]
	if ok {
		transfer.Status = "RJCT"
	}
	g.mu.Unlock()

	if !ok {
		jsonError(w, "Transaction not found", http.StatusNotFound)
		return
	}

	returnID := generateID("RTN")
	g.publishEvent("remitflow.transfers.fednow.returned", map[string]interface{}{
		"transactionId": req.TransactionID,
		"returnId":      returnID,
		"reason":        req.Reason,
		"reasonCode":    req.ReasonCode,
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"returnId":      returnID,
		"transactionId": req.TransactionID,
		"status":        "RJCT",
		"reason":        req.Reason,
		"reasonCode":    req.ReasonCode,
	})
}

func (g *FedNowGateway) handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "go-fednow-gateway",
		"version":   "1.0.0",
		"uptime":    time.Since(startTime).String(),
		"rail":      "FedNow",
		"operator":  "Federal Reserve",
		"currency":  "USD",
		"maxAmount": g.maxAmount,
	})
}

func (g *FedNowGateway) handleMetrics(w http.ResponseWriter, r *http.Request) {
	g.metrics.mu.Lock()
	defer g.metrics.mu.Unlock()
	json.NewEncoder(w).Encode(g.metrics)
}

func (g *FedNowGateway) publishEvent(topic string, data interface{}) {
	payload, _ := json.Marshal(data)
	// Try Dapr pub/sub first
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/v1.0/publish/pubsub/%s", g.daprURL, topic), strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err == nil {
		resp.Body.Close()
		return
	}
	// Fallback to direct Kafka REST proxy
	kafkaPayload, _ := json.Marshal(map[string]interface{}{
		"records": []map[string]interface{}{{"value": data}},
	})
	req2, _ := http.NewRequest("POST", fmt.Sprintf("%s/topics/%s", g.kafkaURL, topic), strings.NewReader(string(kafkaPayload)))
	req2.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")
	resp2, err2 := client.Do(req2)
	if err2 == nil {
		resp2.Body.Close()
	}
}

func buildPacs008(t *FedNowTransfer) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.12">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>%s</MsgId>
      <CreDtTm>%s</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf><SttlmMtd>CLRG</SttlmMtd></SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId><EndToEndId>%s</EndToEndId><TxId>%s</TxId></PmtId>
      <IntrBkSttlmAmt Ccy="%s">%.2f</IntrBkSttlmAmt>
      <CdtrAgt><FinInstnId><ClrSysMmbId><MmbId>%s</MmbId></ClrSysMmbId></FinInstnId></CdtrAgt>
      <Cdtr><Nm>%s</Nm></Cdtr>
      <CdtrAcct><Id><Othr><Id>%s</Id></Othr></Id></CdtrAcct>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`, t.TransactionID, t.CreatedAt.Format(time.RFC3339), t.EndToEndID, t.TransactionID,
		t.Currency, t.Amount, t.RoutingNumber, t.CreditorName, t.AccountNumber)
}

func validateABARouting(routing string) bool {
	if len(routing) != 9 {
		return false
	}
	weights := []int{3, 7, 1, 3, 7, 1, 3, 7, 1}
	sum := 0
	for i, w := range weights {
		d := int(routing[i] - '0')
		sum += d * w
	}
	return sum%10 == 0
}

func generateID(prefix string) string {
	b := make([]byte, 6)
	rand.Read(b)
	return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UnixMilli(), hex.EncodeToString(b))
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var startTime = time.Now()


func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	// Create table if not exists
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS fednow_gateway_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_fednow_gateway_updated ON fednow_gateway_state(updated_at);
		CREATE TABLE IF NOT EXISTS fednow_gateway_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_fednow_gateway_events_type ON fednow_gateway_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-fednow-gateway", "table", "fednow_gateway_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO fednow_gateway_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM fednow_gateway_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(limit int) ([]json.RawMessage, error) {
	rows, err := db.Query("SELECT data FROM fednow_gateway_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		results = append(results, data)
	}
	return results, rows.Err()
}

// dbLogEvent stores an event in the events table
func dbLogEvent(eventType string, payload interface{}) error {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO fednow_gateway_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}

func main() {
	gateway := NewFedNowGateway()
	port := getEnv("PORT", "9003")

	mux := http.NewServeMux()
	mux.HandleFunc("/submit", gateway.handleSubmit)
	mux.HandleFunc("/status", gateway.handleStatus)
	mux.HandleFunc("/status/", gateway.handleStatus)
	mux.HandleFunc("/return", gateway.handleReturn)
	mux.HandleFunc("/health", gateway.handleHealth)
	mux.HandleFunc("/healthz", gateway.handleHealth)
	mux.HandleFunc("/metrics", gateway.handleMetrics)
	mux.HandleFunc("/corridors", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"rail": "FedNow", "currency": "USD", "countries": []string{"US"},
			"maxAmount": gateway.maxAmount, "settlementTime": "< 30 seconds",
			"availability": "24/7/365",
		})
	})

	srv := &http.Server{Addr: ":" + port, Handler: mux}

	go func() {
		log.Printf("[FedNow Gateway] Starting on :%s", port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[FedNow Gateway] Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
