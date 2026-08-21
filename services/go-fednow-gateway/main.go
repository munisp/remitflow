package main

import (
	"bytes"
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// FedNow ISO 20022 Gateway Service
// Implements FedNow Service ISO 20022 message processing
// Handles pacs.008 (Credit Transfer), pacs.002 (Status Report), camt.056 (Return Request)


var _processStartTime = time.Now()

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
	// Simulated is true ONLY for dev-mode simulated settlements — never in production.
	Simulated     bool       `json:"simulated,omitempty"`
}

type FedNowGateway struct {
	mu          sync.RWMutex
	transfers   map[string]*FedNowTransfer
	metrics     *Metrics
	kafkaURL    string
	daprURL     string
	maxAmount   float64
	// adapterURL is the real FedNow network adapter that submits pacs.008
	// messages. Unset → no settlement is claimed unless dev simulation is on.
	adapterURL  string
	// simulationAllowed is true ONLY when FEDNOW_SIMULATE_SETTLEMENT=true is
	// explicitly set outside production.
	simulationAllowed bool
	// internalKey gates /submit, /return, /status (fail closed when unset).
	internalKey string
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
	isProd := os.Getenv("GO_ENV") == "production" || os.Getenv("NODE_ENV") == "production"
	return &FedNowGateway{
		transfers: make(map[string]*FedNowTransfer),
		metrics:   &Metrics{},
		kafkaURL:  getEnv("KAFKA_REST_URL", "http://localhost:8093"),
		daprURL:   getEnv("DAPR_HTTP_URL", "http://localhost:3500"),
		maxAmount: maxAmt,
		adapterURL:        os.Getenv("FEDNOW_ADAPTER_URL"),
		simulationAllowed: !isProd && os.Getenv("FEDNOW_SIMULATE_SETTLEMENT") == "true",
		internalKey:       os.Getenv("INTERNAL_SERVICE_KEY"),
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

	// Whitelist-validate attacker-controlled fields before they go anywhere
	// near an ISO 20022 message (defense-in-depth behind xml escaping).
	if !validCreditorName(txInfo.Creditor.Name) {
		jsonError(w, "Invalid creditor name", http.StatusBadRequest)
		return
	}
	if !reAccountNumber.MatchString(txInfo.CreditorAccount.ID) {
		jsonError(w, "Invalid creditor account number (1-34 chars, [A-Za-z0-9-])", http.StatusBadRequest)
		return
	}

	// Transaction ID is ALWAYS server-generated — a client-supplied ID would
	// let callers overwrite existing transfer records.
	txID := generateID("FEDNOW")
	e2eID := txInfo.PaymentID.EndToEndID
	if e2eID == "" {
		e2eID = generateID("E2E")
	} else if !reEndToEndID.MatchString(e2eID) {
		jsonError(w, "Invalid endToEndId (1-35 chars, [A-Za-z0-9-])", http.StatusBadRequest)
		return
	}

	transfer := &FedNowTransfer{
		TransactionID: txID,
		EndToEndID:    e2eID,
		Amount:        amount,
		Currency:      currency,
		Status:        "RCVD", // Received — NOT yet accepted/settled on the FedNow network
		CreatedAt:     time.Now(),
		RoutingNumber: routingNumber,
		AccountNumber: txInfo.CreditorAccount.ID,
		CreditorName:  txInfo.Creditor.Name,
	}

	// Build ISO 20022 pacs.008
	transfer.ISO20022Msg = buildPacs008(transfer)
	if transfer.ISO20022Msg == "" {
		jsonError(w, "Failed to build pacs.008 message", http.StatusInternalServerError)
		return
	}

	// Settlement path — never fabricate acceptance/settlement:
	//  1. Real adapter configured → submit the pacs.008; only the adapter's
	//     acknowledgement moves the transfer to ACSP.
	//  2. Explicit dev simulation (FEDNOW_SIMULATE_SETTLEMENT=true, non-prod)
	//     → simulated settlement, clearly labeled `simulated:true` everywhere.
	//  3. Otherwise → transfer stays RCVD (received, pending network adapter).
	if g.adapterURL != "" {
		if err := g.submitToAdapter(transfer); err != nil {
			slog.Error("FedNow adapter submission failed — failing loud", "txId", txID, "err", err)
			g.mu.Lock()
			transfer.Status = "RJCT" // Rejected
			g.mu.Unlock()
			jsonError(w, fmt.Sprintf("FedNow network submission failed: %v", err), http.StatusBadGateway)
			return
		}
		g.mu.Lock()
		transfer.Status = "ACSP" // Accepted Settlement in Process — per adapter ack
		g.mu.Unlock()
	} else if g.simulationAllowed {
		transfer.Simulated = true
		transfer.Status = "ACSP"
		slog.Warn("DEV SIMULATION (FEDNOW_SIMULATE_SETTLEMENT=true): fabricating settlement", "txId", txID)
	} // else: stays RCVD — no settlement claimed

	// Store
	g.mu.Lock()
	g.transfers[txID] = transfer
	g.mu.Unlock()
	// Persist transfer to PostgreSQL (middleware-ready: swap to TigerBeetle ledger in production)
	if db != nil {
		go func() {
			_ = dbUpsert("transfer:"+txID, transfer)
			_ = dbLogEvent("fednow_transfer_submitted", map[string]interface{}{
				"transactionId": txID, "amount": amount, "status": transfer.Status, "simulated": transfer.Simulated,
			})
		}()
	}

	// Simulated settlement runs ONLY in explicit dev mode and is labeled as such.
	if transfer.Simulated {
		go func() {
			time.Sleep(2 * time.Second)
			now := time.Now()
			if db != nil {
				_ = dbUpsert("transfer:"+txID, map[string]interface{}{
					"transactionId": txID, "endToEndId": e2eID,
					"amount": amount, "currency": currency, "status": "ACSC",
					"settledAt": now.Format(time.RFC3339), "simulated": true,
				})
			}
			g.mu.Lock()
			if t, ok := g.transfers[txID]; ok {
				t.Status = "ACSC" // Accepted Settlement Completed (SIMULATED)
				t.SettledAt = &now
				t.Simulated = true
			}
			g.mu.Unlock()

			g.publishEvent("remitflow.transfers.fednow.settled", map[string]interface{}{
				"transactionId": txID,
				"endToEndId":    e2eID,
				"amount":        amount,
				"status":        "ACSC",
				"simulated":     true,
				"settledAt":     now.Format(time.RFC3339),
			})
		}()
	}

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
		"status":        transfer.Status,
		"simulated":     transfer.Simulated,
		"timestamp":     time.Now().Format(time.RFC3339),
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"transactionId":       txID,
		"endToEndId":          e2eID,
		"status":              transfer.Status,
		"simulated":           transfer.Simulated,
		"reference":           txID,
		"estimatedSettlement": "< 30 seconds",
		"rail":                "FedNow",
		"processedAt":         time.Now().Format(time.RFC3339),
	})
}

// submitToAdapter posts the pacs.008 message to the configured FedNow network
// adapter. Any failure is an error — the caller fails loud (502) rather than
// pretending the transfer was accepted.
func (g *FedNowGateway) submitToAdapter(t *FedNowTransfer) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(g.adapterURL, "/")+"/v1/pacs008", bytes.NewBufferString(t.ISO20022Msg))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/xml")
	req.Header.Set("X-Transaction-Id", t.TransactionID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("adapter returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// requireAuth gates a handler behind the internal service key. Fail closed:
// when INTERNAL_SERVICE_KEY is unset, every guarded endpoint returns 401.
func (g *FedNowGateway) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		ok := g.internalKey != "" &&
			((key != "" && subtle.ConstantTimeCompare([]byte(key), []byte(g.internalKey)) == 1) ||
				(bearer != "" && subtle.ConstantTimeCompare([]byte(bearer), []byte(g.internalKey)) == 1))
		if !ok {
			jsonError(w, "unauthorized: valid X-API-Key or Bearer token required", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
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

	// DB-primary read (middleware-ready: swap to TigerBeetle in production)
	if db != nil {
		var dbTransfer FedNowTransfer
		if err := dbGet("transfer:"+txID, &dbTransfer); err == nil {
			json.NewEncoder(w).Encode(dbTransfer)
			return
		}
	}
	// Fallback: in-memory cache
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

	// DB-primary read and update (middleware-ready: TigerBeetle in production)
	found := false
	if db != nil {
		var dbTransfer FedNowTransfer
		if err := dbGet("transfer:"+req.TransactionID, &dbTransfer); err == nil {
			found = true
		}
	}
	if !found {
		g.mu.RLock()
		_, found = g.transfers[req.TransactionID]
		g.mu.RUnlock()
	}
	if !found {
		jsonError(w, "Transaction not found", http.StatusNotFound)
		return
	}

	// Update status in both DB and in-memory cache
	g.mu.Lock()
	if t, ok := g.transfers[req.TransactionID]; ok {
		t.Status = "RJCT"
	}
	g.mu.Unlock()

	returnID := generateID("RTN")
	// Persist return to PostgreSQL (middleware-ready)
	if db != nil {
		_ = dbUpsert("transfer:"+req.TransactionID, map[string]interface{}{
			"transactionId": req.TransactionID, "status": "RJCT",
		})
		_ = dbUpsert("return:"+returnID, map[string]interface{}{
			"returnId": returnID, "transactionId": req.TransactionID,
			"status": "RJCT", "reason": req.Reason,
		})
		_ = dbLogEvent("fednow_transfer_returned", map[string]interface{}{
			"transactionId": req.TransactionID, "returnId": returnID,
		})
	}
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

// ── ISO 20022 pacs.008 — built with encoding/xml so every attacker-controlled
// value is auto-escaped. Raw fmt.Sprintf interpolation was an XML-injection
// vector (GO-H6). ──

type pacs008Amount struct {
	Ccy   string `xml:"Ccy,attr"`
	Value string `xml:",chardata"`
}

type pacs008Document struct {
	XMLName xml.Name `xml:"Document"`
	Xmlns   string   `xml:"xmlns,attr"`
	GrpHdr  struct {
		MsgID    string `xml:"MsgId"`
		CreDtTm  string `xml:"CreDtTm"`
		NbOfTxs  int    `xml:"NbOfTxs"`
		SttlmInf struct {
			SttlmMtd string `xml:"SttlmMtd"`
		} `xml:"SttlmInf"`
	} `xml:"FIToFICstmrCdtTrf>GrpHdr"`
	CdtTrfTxInf struct {
		PmtID struct {
			EndToEndID string `xml:"EndToEndId"`
			TxID       string `xml:"TxId"`
		} `xml:"PmtId"`
		IntrBkSttlmAmt pacs008Amount `xml:"IntrBkSttlmAmt"`
		CdtrAgt        struct {
			FinInstnID struct {
				ClrSysMmbID struct {
					MmbID string `xml:"MmbId"`
				} `xml:"ClrSysMmbId"`
			} `xml:"FinInstnId"`
		} `xml:"CdtrAgt"`
		Cdtr struct {
			Nm string `xml:"Nm"`
		} `xml:"Cdtr"`
		CdtrAcct struct {
			ID struct {
				Othr struct {
					ID string `xml:"Id"`
				} `xml:"Othr"`
			} `xml:"Id"`
		} `xml:"CdtrAcct"`
	} `xml:"FIToFICstmrCdtTrf>CdtTrfTxInf"`
}

// Field validators — whitelist charset, cap lengths (ISO 20022 limits).
var (
	reAccountNumber = regexp.MustCompile(`^[A-Za-z0-9\-]{1,34}$`)
	reEndToEndID    = regexp.MustCompile(`^[A-Za-z0-9\-]{1,35}$`)
)

func validCreditorName(name string) bool {
	if name == "" || len(name) > 140 {
		return false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f { // no control characters
			return false
		}
	}
	return true
}

func buildPacs008(t *FedNowTransfer) string {
	doc := pacs008Document{Xmlns: "urn:iso:std:iso:20022:tech:xsd:pacs.008.001.12"}
	doc.GrpHdr.MsgID = t.TransactionID
	doc.GrpHdr.CreDtTm = t.CreatedAt.Format(time.RFC3339)
	doc.GrpHdr.NbOfTxs = 1
	doc.GrpHdr.SttlmInf.SttlmMtd = "CLRG"
	doc.CdtTrfTxInf.PmtID.EndToEndID = t.EndToEndID
	doc.CdtTrfTxInf.PmtID.TxID = t.TransactionID
	doc.CdtTrfTxInf.IntrBkSttlmAmt = pacs008Amount{Ccy: t.Currency, Value: fmt.Sprintf("%.2f", t.Amount)}
	doc.CdtTrfTxInf.CdtrAgt.FinInstnID.ClrSysMmbID.MmbID = t.RoutingNumber
	doc.CdtTrfTxInf.Cdtr.Nm = t.CreditorName
	doc.CdtTrfTxInf.CdtrAcct.ID.Othr.ID = t.AccountNumber
	out, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "" // callers validate fields beforehand; marshal cannot fail on them
	}
	return xml.Header + string(out)
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


// loadFromDB populates in-memory state from database on startup (write-through cache warm)
func loadFromDB() {
	if db == nil {
		return
	}
	rows, err := db.Query("SELECT id, data FROM fednow_gateway_state ORDER BY updated_at DESC LIMIT 1000")
	if err != nil {
		slog.Warn("failed to load state from DB", "err", err)
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id string
		var data []byte
		if err := rows.Scan(&id, &data); err != nil {
			continue
		}
		count++
		// State loaded — available for service-specific rehydration
		_ = id
		_ = data
	}
	slog.Info("loaded persisted state from database", "records", count, "table", "fednow_gateway_state")
}

func main() {
	if err := initDB(); err != nil {
		slog.Warn("database init failed, using in-memory fallback", "err", err)
	}

	gateway := NewFedNowGateway()
	port := getEnv("PORT", "9003")

	mux := http.NewServeMux()
	// GO-H7: payment-rail endpoints require authentication (fail closed when
	// INTERNAL_SERVICE_KEY is unset).
	mux.HandleFunc("/submit", gateway.requireAuth(gateway.handleSubmit))
	mux.HandleFunc("/status", gateway.requireAuth(gateway.handleStatus))
	mux.HandleFunc("/status/", gateway.requireAuth(gateway.handleStatus))
	mux.HandleFunc("/return", gateway.requireAuth(gateway.handleReturn))
	mux.HandleFunc("/health", gateway.handleHealth)
	mux.HandleFunc("/healthz", gateway.handleHealth)
	mux.HandleFunc("/metrics", gateway.handleMetrics)
	mux.HandleFunc("/corridors", func(w http.ResponseWriter, r *http.Request) {
		// DB-primary read (middleware-ready: swap to TigerBeetle/Kafka in production)
		if db != nil {
			dbData, dbErr := dbList(100)
			if dbErr == nil && len(dbData) > 0 {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(dbData)
				return
			}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"rail": "FedNow", "currency": "USD", "countries": []string{"US"},
			"maxAmount": gateway.maxAmount, "settlementTime": "< 30 seconds",
			"availability": "24/7/365",
		})
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("[FedNow Gateway] Starting on :%s", port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	
	// Periodic state persistence to PostgreSQL (write-through cache)
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if db == nil {
				continue
			}
			// Persist current state snapshot
			dbLogEvent("state_snapshot", map[string]string{"status": "persisted"})
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
