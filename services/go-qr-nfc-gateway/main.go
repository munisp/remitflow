// go-qr-nfc-gateway — QR Code & NFC Payment Gateway (Go)
// Port: 8122
//
// Handles:
//   - EMV QR code validation and parsing (ISO 18004 / EMVCo)
//   - NFC terminal registration and heartbeat management
//   - Transaction authorization and settlement
//   - Offline batch settlement (store-and-forward)
//   - NDEF message validation
//   - POS terminal firmware management
//
// Middleware: Kafka, Dapr, Redis, TigerBeetle, PostgreSQL, Temporal, APISIX, OpenSearch

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ── Configuration ────────────────────────────────────────────────────────────

type Config struct {
	Port              string
	KafkaBrokers      string
	RedisURL          string
	PostgresURL       string
	TigerBeetleAddr   string
	DaprHTTPPort      string
	TemporalAddr      string
	OpenSearchURL     string
	APISIXAdminKey    string
	QRSigningSecret   string
	MaxTerminalAmount float64
}

func loadConfig() Config {
	return Config{
		Port:              getEnv("PORT", "8122"),
		KafkaBrokers:      getEnv("KAFKA_BROKERS", "localhost:9092"),
		RedisURL:          getEnv("REDIS_URL", "redis://localhost:6379"),
		PostgresURL:       getEnv("DATABASE_URL", "postgres://remitflow:remitflow123@localhost:5432/remitflow"),
		TigerBeetleAddr:   getEnv("TIGERBEETLE_ADDR", "localhost:3000"),
		DaprHTTPPort:      getEnv("DAPR_HTTP_PORT", "3500"),
		TemporalAddr:      getEnv("TEMPORAL_ADDR", "localhost:7233"),
		OpenSearchURL:     getEnv("OPENSEARCH_URL", "http://localhost:9200"),
		APISIXAdminKey:    getEnv("APISIX_ADMIN_KEY", ""),
		QRSigningSecret:   getEnv("QR_SIGNING_SECRET", "dev-qr-secret"),
		MaxTerminalAmount: 10000000,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── EMV QR Code Parser ──────────────────────────────────────────────────────

type EMVField struct {
	Tag   string `json:"tag"`
	Value string `json:"value"`
}

type ParsedEMVQR struct {
	PayloadFormat       string     `json:"payloadFormat"`
	PointOfInitiation   string     `json:"pointOfInitiation"`
	MerchantAccountInfo string     `json:"merchantAccountInfo"`
	MCC                 string     `json:"mcc"`
	CurrencyCode        string     `json:"currencyCode"`
	Amount              string     `json:"amount,omitempty"`
	CountryCode         string     `json:"countryCode"`
	MerchantName        string     `json:"merchantName"`
	MerchantCity        string     `json:"merchantCity"`
	CRC                 string     `json:"crc"`
	AdditionalData      string     `json:"additionalData,omitempty"`
	Valid               bool       `json:"valid"`
	Fields              []EMVField `json:"fields"`
}

func parseEMVQR(payload string) ParsedEMVQR {
	result := ParsedEMVQR{Fields: []EMVField{}, Valid: true}
	pos := 0

	for pos < len(payload)-4 {
		if pos+4 > len(payload) {
			result.Valid = false
			break
		}
		tag := payload[pos : pos+2]
		lenStr := payload[pos+2 : pos+4]
		fieldLen, err := strconv.Atoi(lenStr)
		if err != nil || pos+4+fieldLen > len(payload) {
			result.Valid = false
			break
		}
		value := payload[pos+4 : pos+4+fieldLen]
		result.Fields = append(result.Fields, EMVField{Tag: tag, Value: value})

		switch tag {
		case "00":
			result.PayloadFormat = value
		case "01":
			result.PointOfInitiation = value
		case "26":
			result.MerchantAccountInfo = value
		case "52":
			result.MCC = value
		case "53":
			result.CurrencyCode = value
		case "54":
			result.Amount = value
		case "58":
			result.CountryCode = value
		case "59":
			result.MerchantName = value
		case "60":
			result.MerchantCity = value
		case "62":
			result.AdditionalData = value
		case "63":
			result.CRC = value
		}
		pos += 4 + fieldLen
	}

	// Validate CRC
	if result.CRC != "" {
		crcInput := payload[:len(payload)-4]
		expected := crc16CCITT(crcInput)
		if strings.ToUpper(result.CRC) != expected {
			result.Valid = false
		}
	}

	return result
}

func crc16CCITT(data string) string {
	crc := uint16(0xFFFF)
	for i := 0; i < len(data); i++ {
		crc ^= uint16(data[i]) << 8
		for j := 0; j < 8; j++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return strings.ToUpper(fmt.Sprintf("%04X", crc))
}

// ── NFC Terminal Manager ─────────────────────────────────────────────────────

type Terminal struct {
	ID             string    `json:"terminalId"`
	MerchantID     string    `json:"merchantId"`
	Name           string    `json:"terminalName"`
	Type           string    `json:"terminalType"`
	Status         string    `json:"status"`
	Protocols      []string  `json:"supportedProtocols"`
	MaxAmount      float64   `json:"maxTransactionAmount"`
	Currency       string    `json:"currency"`
	FirmwareVer    string    `json:"firmwareVersion"`
	LastHeartbeat  time.Time `json:"lastHeartbeat"`
	HeartbeatCount int64     `json:"heartbeatCount"`
	Location       *Location `json:"location,omitempty"`
}

type Location struct {
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Address string  `json:"address"`
}

type TerminalManager struct {
	mu        sync.RWMutex
	terminals map[string]*Terminal
}

func NewTerminalManager() *TerminalManager {
	return &TerminalManager{terminals: make(map[string]*Terminal)}
}

func (tm *TerminalManager) Register(t *Terminal) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	t.LastHeartbeat = time.Now()
	tm.terminals[t.ID] = t
}

func (tm *TerminalManager) Heartbeat(terminalID string) (*Terminal, bool) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	t, ok := tm.terminals[terminalID]
	if !ok {
		return nil, false
	}
	t.LastHeartbeat = time.Now()
	t.HeartbeatCount++
	return t, true
}

func (tm *TerminalManager) Get(terminalID string) (*Terminal, bool) {
	tm.mu.RLock()
	defer tm.mu.RUnlock()
	t, ok := tm.terminals[terminalID]
	return t, ok
}

func (tm *TerminalManager) ListByMerchant(merchantID string) []*Terminal {
	tm.mu.RLock()
	defer tm.mu.RUnlock()
	var result []*Terminal
	for _, t := range tm.terminals {
		if t.MerchantID == merchantID {
			result = append(result, t)
		}
	}
	return result
}

func (tm *TerminalManager) HealthCheck() map[string]interface{} {
	tm.mu.RLock()
	defer tm.mu.RUnlock()
	total := len(tm.terminals)
	active := 0
	stale := 0
	for _, t := range tm.terminals {
		if time.Since(t.LastHeartbeat) < 5*time.Minute {
			active++
		} else {
			stale++
		}
	}
	return map[string]interface{}{
		"total": total, "active": active, "stale": stale,
	}
}

// ── Transaction Authorizer ───────────────────────────────────────────────────

type AuthRequest struct {
	TerminalID string  `json:"terminalId"`
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	Nonce      string  `json:"nonce"`
	CardType   string  `json:"cardType,omitempty"`
	Method     string  `json:"method"`
}

type AuthResponse struct {
	Authorized   bool    `json:"authorized"`
	AuthCode     string  `json:"authCode,omitempty"`
	DeclineCode  string  `json:"declineCode,omitempty"`
	DeclineMsg   string  `json:"declineMessage,omitempty"`
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	TxID         string  `json:"txId,omitempty"`
	TerminalID   string  `json:"terminalId"`
	ProcessedAt  string  `json:"processedAt"`
}

type NonceTracker struct {
	mu     sync.Mutex
	nonces map[string]bool
}

func NewNonceTracker() *NonceTracker {
	return &NonceTracker{nonces: make(map[string]bool)}
}

func (nt *NonceTracker) Check(nonce string) bool {
	nt.mu.Lock()
	defer nt.mu.Unlock()
	if nt.nonces[nonce] {
		return false
	}
	nt.nonces[nonce] = true
	// GC: keep max 100K nonces
	if len(nt.nonces) > 100000 {
		count := 0
		for k := range nt.nonces {
			delete(nt.nonces, k)
			count++
			if count >= 50000 {
				break
			}
		}
	}
	return true
}

func generateAuthCode() string {
	b := make([]byte, 3)
	rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
}

func generateTxID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// ── QR Signature Validator ───────────────────────────────────────────────────

func validateQRSignature(payload, signature, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))[:16]
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ── NDEF Validator ───────────────────────────────────────────────────────────

type NDEFValidation struct {
	Valid    bool   `json:"valid"`
	Type     string `json:"type"`
	URI      string `json:"uri,omitempty"`
	PayeeID  string `json:"payeeId,omitempty"`
	Amount   string `json:"amount,omitempty"`
	Currency string `json:"currency,omitempty"`
	TagID    string `json:"tagId,omitempty"`
	Error    string `json:"error,omitempty"`
}

func validateNDEF(payload string) NDEFValidation {
	if !strings.HasPrefix(payload, "remitflow://") {
		return NDEFValidation{Valid: false, Error: "invalid scheme — expected remitflow://"}
	}

	result := NDEFValidation{Valid: true, URI: payload}

	if strings.Contains(payload, "nfc-pay") {
		result.Type = "nfc_payment"
	} else if strings.Contains(payload, "pay") {
		result.Type = "qr_payment"
	} else {
		result.Type = "unknown"
	}

	// Parse query parameters
	if idx := strings.Index(payload, "?"); idx >= 0 {
		params := payload[idx+1:]
		for _, pair := range strings.Split(params, "&") {
			parts := strings.SplitN(pair, "=", 2)
			if len(parts) != 2 {
				continue
			}
			switch parts[0] {
			case "uid":
				result.PayeeID = parts[1]
			case "amt":
				result.Amount = parts[1]
			case "cur":
				result.Currency = parts[1]
			case "tag":
				result.TagID = parts[1]
			}
		}
	}

	return result
}

// ── Kafka Event Publisher (via Dapr) ─────────────────────────────────────────

type EventPublisher struct {
	daprPort string
	buffer   []map[string]interface{}
	mu       sync.Mutex
}

func NewEventPublisher(daprPort string) *EventPublisher {
	ep := &EventPublisher{daprPort: daprPort}
	go ep.flushLoop()
	return ep
}

func (ep *EventPublisher) Publish(topic string, data map[string]interface{}) {
	data["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)
	data["source"] = "go-qr-nfc-gateway"

	ep.mu.Lock()
	ep.buffer = append(ep.buffer, map[string]interface{}{
		"topic": topic, "data": data,
	})
	if len(ep.buffer) >= 100 {
		ep.flush()
	}
	ep.mu.Unlock()
}

func (ep *EventPublisher) flush() {
	if len(ep.buffer) == 0 {
		return
	}
	events := make([]map[string]interface{}, len(ep.buffer))
	copy(events, ep.buffer)
	ep.buffer = ep.buffer[:0]

	// Publish via Dapr sidecar
	for _, event := range events {
		topic, _ := event["topic"].(string)
		data, _ := event["data"].(map[string]interface{})
		body, _ := json.Marshal(data)

		url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/%s", ep.daprPort, topic)
		resp, err := http.Post(url, "application/json", strings.NewReader(string(body)))
		if err != nil {
			log.Printf("[Kafka/Dapr] publish failed: %v", err)
			continue
		}
		resp.Body.Close()
	}
}

func (ep *EventPublisher) flushLoop() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for range ticker.C {
		ep.mu.Lock()
		ep.flush()
		ep.mu.Unlock()
	}
}

// ── TigerBeetle Ledger ──────────────────────────────────────────────────────

type LedgerEntry struct {
	DebitAccount  string  `json:"debitAccountId"`
	CreditAccount string  `json:"creditAccountId"`
	Amount        float64 `json:"amount"`
	Currency      string  `json:"currency"`
	Reference     string  `json:"reference"`
	Code          int     `json:"code"`
}

func postLedgerEntry(entry LedgerEntry) error {
	body, _ := json.Marshal(entry)
	resp, err := http.Post("http://localhost:8117/api/ledger/transfer", "application/json",
		strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// ── HTTP Handlers ────────────────────────────────────────────────────────────

type Server struct {
	config    Config
	terminals *TerminalManager
	nonces    *NonceTracker
	events    *EventPublisher
	db        *sql.DB
}

func NewServer(cfg Config) *Server {
	return &Server{
		config:    cfg,
		terminals: NewTerminalManager(),
		nonces:    NewNonceTracker(),
		events:    NewEventPublisher(cfg.DaprHTTPPort),
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	terminalHealth := s.terminals.HealthCheck()
	resp := map[string]interface{}{
		"service":   "go-qr-nfc-gateway",
		"status":    "healthy",
		"port":      s.config.Port,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"terminals": terminalHealth,
		"middleware": map[string]string{
			"kafka":       s.config.KafkaBrokers,
			"redis":       s.config.RedisURL,
			"tigerbeetle": s.config.TigerBeetleAddr,
			"dapr":        s.config.DaprHTTPPort,
			"temporal":    s.config.TemporalAddr,
			"opensearch":  s.config.OpenSearchURL,
		},
	}
	writeJSON(w, 200, resp)
}

func (s *Server) handleParseEMV(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Payload string `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request body"})
		return
	}
	result := parseEMVQR(req.Payload)
	s.events.Publish("qr-nfc.emv-parsed", map[string]interface{}{
		"valid": result.Valid, "merchantName": result.MerchantName,
	})
	writeJSON(w, 200, result)
}

func (s *Server) handleValidateQRSignature(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Payload   string `json:"payload"`
		Signature string `json:"signature"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	valid := validateQRSignature(req.Payload, req.Signature, s.config.QRSigningSecret)
	writeJSON(w, 200, map[string]interface{}{"valid": valid})
}

func (s *Server) handleValidateNDEF(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Payload string `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	result := validateNDEF(req.Payload)
	writeJSON(w, 200, result)
}

func (s *Server) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	// Validate nonce
	if !s.nonces.Check(req.Nonce) {
		writeJSON(w, 409, AuthResponse{
			Authorized: false, DeclineCode: "DUPLICATE_NONCE",
			DeclineMsg: "Transaction nonce already used — possible replay",
			TerminalID: req.TerminalID, ProcessedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	// Check terminal
	terminal, ok := s.terminals.Get(req.TerminalID)
	if !ok {
		writeJSON(w, 404, AuthResponse{
			Authorized: false, DeclineCode: "TERMINAL_NOT_FOUND",
			DeclineMsg: "Terminal not registered", TerminalID: req.TerminalID,
			ProcessedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	if terminal.Status != "active" {
		writeJSON(w, 403, AuthResponse{
			Authorized: false, DeclineCode: "TERMINAL_INACTIVE",
			DeclineMsg: "Terminal is not active", TerminalID: req.TerminalID,
			ProcessedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	if req.Amount > terminal.MaxAmount {
		writeJSON(w, 403, AuthResponse{
			Authorized: false, DeclineCode: "AMOUNT_EXCEEDED",
			DeclineMsg: fmt.Sprintf("Amount %.2f exceeds terminal max %.2f", req.Amount, terminal.MaxAmount),
			TerminalID: req.TerminalID, ProcessedAt: time.Now().UTC().Format(time.RFC3339),
		})
		return
	}

	txID := generateTxID("nfctx-")
	authCode := generateAuthCode()

	// Post to TigerBeetle ledger
	go postLedgerEntry(LedgerEntry{
		DebitAccount: "customer-pool", CreditAccount: "merchant-" + terminal.MerchantID,
		Amount: req.Amount, Currency: req.Currency,
		Reference: "nfc-" + txID, Code: 710,
	})

	// Publish event
	s.events.Publish("qr-nfc.payment-authorized", map[string]interface{}{
		"txId": txID, "terminalId": req.TerminalID, "amount": req.Amount,
		"currency": req.Currency, "method": req.Method, "authCode": authCode,
	})

	writeJSON(w, 200, AuthResponse{
		Authorized: true, AuthCode: authCode, Amount: req.Amount,
		Currency: req.Currency, TxID: txID, TerminalID: req.TerminalID,
		ProcessedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleRegisterTerminal(w http.ResponseWriter, r *http.Request) {
	var t Terminal
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	if t.ID == "" {
		t.ID = generateTxID("nfc-")
	}
	t.Status = "active"
	t.FirmwareVer = "1.0.0"
	s.terminals.Register(&t)

	s.events.Publish("qr-nfc.terminal-registered", map[string]interface{}{
		"terminalId": t.ID, "merchantId": t.MerchantID, "type": t.Type,
	})

	writeJSON(w, 201, t)
}

func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TerminalID      string `json:"terminalId"`
		FirmwareVersion string `json:"firmwareVersion,omitempty"`
		BatteryLevel    int    `json:"batteryLevel,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	t, ok := s.terminals.Heartbeat(req.TerminalID)
	if !ok {
		writeJSON(w, 404, map[string]string{"error": "terminal not found"})
		return
	}
	if req.FirmwareVersion != "" {
		t.FirmwareVer = req.FirmwareVersion
	}
	writeJSON(w, 200, map[string]interface{}{
		"terminalId": t.ID, "status": t.Status, "heartbeatCount": t.HeartbeatCount,
		"lastHeartbeat": t.LastHeartbeat.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleOfflineBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TerminalID   string `json:"terminalId"`
		Transactions []struct {
			Amount    float64 `json:"amount"`
			Currency  string  `json:"currency"`
			Nonce     string  `json:"nonce"`
			Timestamp string  `json:"timestamp"`
		} `json:"transactions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	settled := 0
	duplicates := 0
	totalAmount := 0.0

	for _, tx := range req.Transactions {
		if !s.nonces.Check(tx.Nonce) {
			duplicates++
			continue
		}
		settled++
		totalAmount += tx.Amount
	}

	batchID := generateTxID("batch-")
	if totalAmount > 0 {
		go postLedgerEntry(LedgerEntry{
			DebitAccount: "offline-pool", CreditAccount: "merchant-batch-" + req.TerminalID,
			Amount: totalAmount, Currency: "NGN", Reference: "offline-" + batchID, Code: 715,
		})
	}

	s.events.Publish("qr-nfc.offline-batch-settled", map[string]interface{}{
		"batchId": batchID, "terminalId": req.TerminalID,
		"settled": settled, "duplicates": duplicates, "totalAmount": totalAmount,
	})

	writeJSON(w, 200, map[string]interface{}{
		"batchId": batchID, "settled": settled, "duplicatesSkipped": duplicates, "totalAmount": totalAmount,
	})
}

// ── Prometheus Metrics ───────────────────────────────────────────────────────

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	th := s.terminals.HealthCheck()
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "# HELP go_qr_nfc_terminals_total Total registered NFC terminals\n")
	fmt.Fprintf(w, "# TYPE go_qr_nfc_terminals_total gauge\n")
	fmt.Fprintf(w, "go_qr_nfc_terminals_total %d\n", th["total"])
	fmt.Fprintf(w, "# HELP go_qr_nfc_terminals_active Active NFC terminals (heartbeat < 5m)\n")
	fmt.Fprintf(w, "# TYPE go_qr_nfc_terminals_active gauge\n")
	fmt.Fprintf(w, "go_qr_nfc_terminals_active %d\n", th["active"])
	fmt.Fprintf(w, "# HELP go_qr_nfc_terminals_stale Stale NFC terminals (heartbeat > 5m)\n")
	fmt.Fprintf(w, "# TYPE go_qr_nfc_terminals_stale gauge\n")
	fmt.Fprintf(w, "go_qr_nfc_terminals_stale %d\n", th["stale"])
}

// ── OpenSearch Indexer ───────────────────────────────────────────────────────

func (s *Server) indexToOpenSearch(index string, doc map[string]interface{}) {
	body, _ := json.Marshal(doc)
	url := fmt.Sprintf("%s/%s/_doc", s.config.OpenSearchURL, index)
	resp, err := http.Post(url, "application/json", strings.NewReader(string(body)))
	if err != nil {
		log.Printf("[OpenSearch] index failed: %v", err)
		return
	}
	resp.Body.Close()
}

// ── Utility ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// ── Main ─────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	srv := NewServer(cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", srv.handleHealth)
	mux.HandleFunc("/metrics", srv.handleMetrics)
	mux.HandleFunc("/api/qr/parse-emv", srv.handleParseEMV)
	mux.HandleFunc("/api/qr/validate-signature", srv.handleValidateQRSignature)
	mux.HandleFunc("/api/nfc/validate-ndef", srv.handleValidateNDEF)
	mux.HandleFunc("/api/nfc/authorize", srv.handleAuthorize)
	mux.HandleFunc("/api/nfc/terminal/register", srv.handleRegisterTerminal)
	mux.HandleFunc("/api/nfc/terminal/heartbeat", srv.handleHeartbeat)
	mux.HandleFunc("/api/nfc/offline/batch", srv.handleOfflineBatch)

	httpSrv := &http.Server{Addr: ":" + cfg.Port, Handler: mux}

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[QR/NFC Gateway Go] listening on :%s", cfg.Port)
		log.Printf("[QR/NFC Gateway Go] endpoints: /api/qr/parse-emv, /api/qr/validate-signature, /api/nfc/validate-ndef, /api/nfc/authorize, /api/nfc/terminal/register, /api/nfc/terminal/heartbeat, /api/nfc/offline/batch")
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[QR/NFC Gateway Go] server error: %v", err)
		}
	}()

	<-stop
	log.Println("[QR/NFC Gateway Go] shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpSrv.Shutdown(ctx)
	log.Println("[QR/NFC Gateway Go] stopped")
}
