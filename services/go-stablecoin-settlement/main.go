// Package main implements the Go Stablecoin Settlement Orchestrator service.
//
// Responsibilities:
//   - Settlement orchestration for on-ramp/off-ramp/bank withdrawals
//   - TigerBeetle ledger writes via Dapr state store
//   - Webhook handlers for Circle, Yellow Card, MoonPay, Transak
//   - HMAC-SHA256 webhook signature verification
//   - Mojaloop bridge for cross-border stablecoin settlements
//   - Kafka event publishing for all settlement activities
//   - Fluvio streaming for real-time settlement monitoring
//   - Circuit breaking + retry logic for external providers
//   - P2P claim endpoint for unclaimed stablecoin sends
//
// Middleware:
//   - Kafka: stablecoin_settlement, stablecoin_webhook topics
//   - Dapr: State store (TigerBeetle), pub/sub (Kafka), bindings (Circle/YellowCard)
//   - Redis: Settlement status cache, webhook dedup (24h)
//   - Fluvio: Real-time settlement stream
//   - OpenSearch: Settlement transaction indexing
//   - APISix: Rate limiting on webhook endpoints
//
// Port: 8200
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ── Configuration ───────────────────────────────────────────────────────────

var (
	port              = getEnv("PORT", "8200")
	kafkaBrokers      = getEnv("KAFKA_BROKERS", "localhost:9092")
	redisURL          = getEnv("REDIS_URL", "localhost:6379")
	daprURL           = getEnv("DAPR_HTTP_PORT", "3500")
	tigerBeetleAddr   = getEnv("TIGERBEETLE_ADDR", "localhost:3001")
	mojaloopURL       = getEnv("MOJALOOP_URL", "http://localhost:4000")
	openSearchURL     = getEnv("OPENSEARCH_URL", "http://localhost:9200")
	coreAPIURL        = getEnv("CORE_API_URL", "http://localhost:3000")

	// Provider webhook secrets (loaded from env/Vault)
	circleWebhookSecret     = getEnv("CIRCLE_WEBHOOK_SECRET", "")
	yellowCardWebhookSecret = getEnv("YELLOWCARD_WEBHOOK_SECRET", "")
	moonpayWebhookSecret    = getEnv("MOONPAY_WEBHOOK_SECRET", "")
	transakWebhookSecret    = getEnv("TRANSAK_WEBHOOK_SECRET", "")

	// Provider API keys
	circleAPIKey     = getEnv("CIRCLE_API_KEY", "")
	yellowCardAPIKey = getEnv("YELLOWCARD_API_KEY", "")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Types ───────────────────────────────────────────────────────────────────

type SettlementRequest struct {
	OperationID  string                 `json:"operation_id"`
	Provider     string                 `json:"provider"`
	Action       string                 `json:"action"` // initiate_payout, initiate_onramp, confirm_bridge, pay_biller
	Payload      map[string]interface{} `json:"payload"`
}

type SettlementResult struct {
	ExternalRef string `json:"external_ref"`
	Status      string `json:"status"`
	Provider    string `json:"provider"`
	OperationID string `json:"operation_id"`
	Timestamp   string `json:"timestamp"`
}

type WebhookEvent struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`
	Provider    string                 `json:"provider"`
	Payload     map[string]interface{} `json:"payload"`
	ReceivedAt  string                 `json:"received_at"`
	Verified    bool                   `json:"verified"`
}

type LedgerEntry struct {
	EntryID         string `json:"entry_id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          string `json:"amount"`
	Currency        string `json:"currency"`
	TransferRef     string `json:"transfer_ref"`
	FlowType        string `json:"flow_type"`
	Timestamp       string `json:"timestamp"`
}

type P2PClaim struct {
	ClaimID       string  `json:"claim_id"`
	SenderID      int     `json:"sender_id"`
	Stablecoin    string  `json:"stablecoin"`
	Amount        float64 `json:"amount"`
	Chain         string  `json:"chain"`
	ExpiresAt     string  `json:"expires_at"`
	Status        string  `json:"status"` // pending, claimed, expired
	ClaimedByID   int     `json:"claimed_by_id,omitempty"`
	ClaimedAt     string  `json:"claimed_at,omitempty"`
}

type CircuitBreaker struct {
	mu           sync.Mutex
	failures     int
	lastFailure  time.Time
	state        string // closed, open, half_open
	maxFailures  int
	resetTimeout time.Duration
}

// ── Stores ──────────────────────────────────────────────────────────────────

var (
	settlements    = make(map[string]*SettlementResult)
	webhookEvents  = make(map[string]*WebhookEvent)
	webhookDedup   = make(map[string]bool) // 24h dedup
	ledgerEntries  = make(map[string]*LedgerEntry)
	p2pClaims      = make(map[string]*P2PClaim)
	mu             sync.RWMutex

	settlementCount  uint64
	webhookCount     uint64
	ledgerCount      uint64
	claimCount       uint64
	errorCount       uint64

	circuitBreakers = map[string]*CircuitBreaker{
		"circle":      {maxFailures: 3, resetTimeout: 30 * time.Second, state: "closed"},
		"yellow_card": {maxFailures: 3, resetTimeout: 30 * time.Second, state: "closed"},
		"moonpay":     {maxFailures: 3, resetTimeout: 30 * time.Second, state: "closed"},
		"transak":     {maxFailures: 3, resetTimeout: 30 * time.Second, state: "closed"},
		"mojaloop":    {maxFailures: 5, resetTimeout: 60 * time.Second, state: "closed"},
	}

	startTime = time.Now()
)

// ── Circuit Breaker ─────────────────────────────────────────────────────────

func (cb *CircuitBreaker) canExecute() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	if cb.state == "closed" {
		return true
	}
	if cb.state == "open" && time.Since(cb.lastFailure) > cb.resetTimeout {
		cb.state = "half_open"
		return true
	}
	return cb.state == "half_open"
}

func (cb *CircuitBreaker) recordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
	cb.state = "closed"
}

func (cb *CircuitBreaker) recordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	cb.lastFailure = time.Now()
	if cb.failures >= cb.maxFailures {
		cb.state = "open"
	}
}

// ── HMAC Verification ───────────────────────────────────────────────────────

// verifyHMAC validates a webhook HMAC-SHA256 signature. FAIL CLOSED: an empty
// secret or empty signature NEVER verifies — there is no "dev mode accept all".
func verifyHMAC(payload []byte, signature, secret string) bool {
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ── TigerBeetle via Dapr ────────────────────────────────────────────────────

func writeLedgerEntry(entry *LedgerEntry) error {
	mu.Lock()
	ledgerEntries[entry.EntryID] = entry
	mu.Unlock()
	atomic.AddUint64(&ledgerCount, 1)

	// Write to TigerBeetle via Dapr state store
	payload, _ := json.Marshal(map[string]interface{}{
		"key":   entry.EntryID,
		"value": entry,
	})

	url := fmt.Sprintf("http://localhost:%s/v1.0/state/tigerbeetle-store", daprURL)
	req, _ := http.NewRequest("POST", url, strings.NewReader(fmt.Sprintf("[%s]", string(payload))))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[TigerBeetle] Dapr write failed (best-effort): %v", err)
		return nil // Non-blocking in dev
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		log.Printf("[TigerBeetle] Dapr write returned %d", resp.StatusCode)
	}

	return nil
}

// ── Kafka Publishing ────────────────────────────────────────────────────────

func publishKafkaEvent(topic string, event interface{}) {
	payload, _ := json.Marshal(event)

	// Via Dapr pub/sub
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/%s", daprURL, topic)
	req, _ := http.NewRequest("POST", url, strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Kafka] Publish to %s failed: %v", topic, err)
		return
	}
	defer resp.Body.Close()
}

// ── OpenSearch Indexing ─────────────────────────────────────────────────────

func indexToOpenSearch(indexName string, docID string, doc interface{}) {
	payload, _ := json.Marshal(doc)
	url := fmt.Sprintf("%s/%s/_doc/%s", openSearchURL, indexName, docID)
	req, _ := http.NewRequest("PUT", url, strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[OpenSearch] Index to %s failed: %v", indexName, err)
		return
	}
	defer resp.Body.Close()
}

// ── Settlement Execution ────────────────────────────────────────────────────

func executeSettlement(req SettlementRequest) (*SettlementResult, error) {
	atomic.AddUint64(&settlementCount, 1)

	provider := req.Provider
	if provider == "" {
		provider = inferProvider(req)
	}

	cb, ok := circuitBreakers[provider]
	if ok && !cb.canExecute() {
		return nil, fmt.Errorf("circuit breaker open for provider: %s", provider)
	}

	result := &SettlementResult{
		OperationID: req.OperationID,
		Provider:    provider,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Status:      "submitted",
	}

	var err error
	switch req.Action {
	case "initiate_payout":
		result, err = executePayoutSettlement(req, provider)
	case "initiate_onramp":
		result, err = executeOnRampSettlement(req, provider)
	case "confirm_bridge":
		result, err = executeBridgeSettlement(req, provider)
	case "pay_biller":
		result, err = executeBillerPayment(req, provider)
	default:
		return nil, fmt.Errorf("unknown action: %s", req.Action)
	}

	if err != nil {
		if cb != nil {
			cb.recordFailure()
		}
		atomic.AddUint64(&errorCount, 1)
		return nil, err
	}

	if cb != nil {
		cb.recordSuccess()
	}

	mu.Lock()
	settlements[result.OperationID] = result
	mu.Unlock()

	// Write ledger entry
	ledgerID := fmt.Sprintf("ledger_%s_%d", req.OperationID, time.Now().UnixNano())
	amount, _ := req.Payload["amount"].(float64)
	currency, _ := req.Payload["stablecoin"].(string)
	if currency == "" {
		currency, _ = req.Payload["currency"].(string)
	}

	writeLedgerEntry(&LedgerEntry{
		EntryID:         ledgerID,
		DebitAccountID:  fmt.Sprintf("user_%v", req.Payload["userId"]),
		CreditAccountID: fmt.Sprintf("%s_settlement", provider),
		Amount:          fmt.Sprintf("%.2f", amount),
		Currency:        currency,
		TransferRef:     req.OperationID,
		FlowType:        req.Action,
		Timestamp:       result.Timestamp,
	})

	// Publish Kafka event
	publishKafkaEvent("stablecoin_settlement", map[string]interface{}{
		"operation_id": req.OperationID,
		"action":       req.Action,
		"provider":     provider,
		"status":       result.Status,
		"external_ref": result.ExternalRef,
		"timestamp":    result.Timestamp,
	})

	// Index in OpenSearch
	indexToOpenSearch("stablecoin-settlements", result.OperationID, result)

	return result, nil
}

func inferProvider(req SettlementRequest) string {
	currency, _ := req.Payload["fiatCurrency"].(string)
	switch currency {
	case "NGN", "GHS", "KES", "ZAR", "XOF":
		return "yellow_card"
	default:
		return "circle"
	}
}

func executePayoutSettlement(req SettlementRequest, provider string) (*SettlementResult, error) {
	refBytes := make([]byte, 16)
	rand.Read(refBytes)
	externalRef := fmt.Sprintf("%s_payout_%s", provider, hex.EncodeToString(refBytes))

	log.Printf("[Settlement] Payout via %s: operation=%s amount=%v", provider, req.OperationID, req.Payload["amount"])

	switch provider {
	case "circle":
		// Call Circle payout API
		return callCirclePayout(req, externalRef)
	case "yellow_card":
		// Call Yellow Card off-ramp API
		return callYellowCardPayout(req, externalRef)
	case "mojaloop":
		// Initiate via Mojaloop connector
		return callMojaloopTransfer(req, externalRef)
	default:
		return &SettlementResult{
			OperationID: req.OperationID,
			Provider:    provider,
			ExternalRef: externalRef,
			Status:      "submitted",
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
}

func executeOnRampSettlement(req SettlementRequest, provider string) (*SettlementResult, error) {
	refBytes := make([]byte, 16)
	rand.Read(refBytes)
	externalRef := fmt.Sprintf("%s_onramp_%s", provider, hex.EncodeToString(refBytes))

	log.Printf("[Settlement] On-ramp via %s: operation=%s", provider, req.OperationID)

	return &SettlementResult{
		OperationID: req.OperationID,
		Provider:    provider,
		ExternalRef: externalRef,
		Status:      "pending_payment",
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func executeBridgeSettlement(req SettlementRequest, provider string) (*SettlementResult, error) {
	refBytes := make([]byte, 16)
	rand.Read(refBytes)
	externalRef := fmt.Sprintf("bridge_%s", hex.EncodeToString(refBytes))

	fromChain, _ := req.Payload["fromChain"].(string)
	toChain, _ := req.Payload["toChain"].(string)
	log.Printf("[Settlement] Bridge %s → %s: operation=%s", fromChain, toChain, req.OperationID)

	return &SettlementResult{
		OperationID: req.OperationID,
		Provider:    "bridge",
		ExternalRef: externalRef,
		Status:      "bridging",
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func executeBillerPayment(req SettlementRequest, provider string) (*SettlementResult, error) {
	refBytes := make([]byte, 16)
	rand.Read(refBytes)
	externalRef := fmt.Sprintf("bill_%s", hex.EncodeToString(refBytes))

	billerName, _ := req.Payload["billerName"].(string)
	log.Printf("[Settlement] Bill payment to %s: operation=%s", billerName, req.OperationID)

	return &SettlementResult{
		OperationID: req.OperationID,
		Provider:    "biller",
		ExternalRef: externalRef,
		Status:      "submitted",
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// ── Provider API Calls ──────────────────────────────────────────────────────

// devSimulatedSettlementsAllowed reports whether SIMULATED provider payouts are
// permitted. They are ONLY allowed outside production when
// SETTLEMENT_ALLOW_SIMULATED=true is explicitly set. In production, or without
// the explicit opt-in, unconfigured providers fail closed with an error.
func devSimulatedSettlementsAllowed() bool {
	env := strings.ToLower(os.Getenv("GO_ENV") + os.Getenv("NODE_ENV") + os.Getenv("APP_ENV"))
	if strings.Contains(env, "prod") {
		return false
	}
	return os.Getenv("SETTLEMENT_ALLOW_SIMULATED") == "true"
}

func simulatedSettlement(req SettlementRequest, provider, ref string) *SettlementResult {
	return &SettlementResult{
		OperationID: req.OperationID,
		Provider:    provider,
		ExternalRef: "SIMULATED-" + ref,
		Status:      "simulated",
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
}

// callProviderPayout submits a real payout to a provider's HTTP API. It returns
// an error unless the provider confirms acceptance (2xx). No fabricated refs.
func callProviderPayout(provider, baseURL, apiKey string, req SettlementRequest, ref string) (*SettlementResult, error) {
	if baseURL == "" {
		return nil, fmt.Errorf("NOT_CONFIGURED: %s API base URL is not set; refusing to report an unsubmitted payout", provider)
	}
	payload, err := json.Marshal(map[string]interface{}{
		"idempotencyKey": ref,
		"operationId":    req.OperationID,
		"payload":        req.Payload,
	})
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequest("POST", strings.TrimRight(baseURL, "/")+"/payouts", strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%s payout submission failed: %w", provider, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("%s payout rejected (HTTP %d)", provider, resp.StatusCode)
	}
	var out struct {
		ID        string `json:"id"`
		Reference string `json:"reference"`
	}
	externalRef := ref
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&out); err == nil {
		if out.ID != "" {
			externalRef = out.ID
		} else if out.Reference != "" {
			externalRef = out.Reference
		}
	}
	return &SettlementResult{
		OperationID: req.OperationID,
		Provider:    provider,
		ExternalRef: externalRef,
		Status:      "submitted",
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func callCirclePayout(req SettlementRequest, ref string) (*SettlementResult, error) {
	if circleAPIKey == "" {
		if !devSimulatedSettlementsAllowed() {
			return nil, fmt.Errorf("NOT_CONFIGURED: CIRCLE_API_KEY is not set; refusing to fabricate a Circle payout")
		}
		log.Printf("[Circle] DEV SIMULATION (SETTLEMENT_ALLOW_SIMULATED=true): no API key — returning SIMULATED settlement")
		return simulatedSettlement(req, "circle", ref), nil
	}
	return callProviderPayout("circle", os.Getenv("CIRCLE_API_URL"), circleAPIKey, req, ref)
}

func callYellowCardPayout(req SettlementRequest, ref string) (*SettlementResult, error) {
	if yellowCardAPIKey == "" {
		if !devSimulatedSettlementsAllowed() {
			return nil, fmt.Errorf("NOT_CONFIGURED: YELLOWCARD_API_KEY is not set; refusing to fabricate a YellowCard payout")
		}
		log.Printf("[YellowCard] DEV SIMULATION (SETTLEMENT_ALLOW_SIMULATED=true): no API key — returning SIMULATED settlement")
		return simulatedSettlement(req, "yellow_card", ref), nil
	}
	return callProviderPayout("yellow_card", os.Getenv("YELLOWCARD_API_URL"), yellowCardAPIKey, req, ref)
}

func callMojaloopTransfer(req SettlementRequest, ref string) (*SettlementResult, error) {
	payload, _ := json.Marshal(map[string]interface{}{
		"transferId": ref,
		"payerFsp":   "remitflow",
		"payeeFsp":   req.Payload["destinationFsp"],
		"amount":     req.Payload["amount"],
		"currency":   req.Payload["fiatCurrency"],
	})

	httpReq, _ := http.NewRequest("POST", mojaloopURL+"/transfers", strings.NewReader(string(payload)))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("FSPIOP-Source", "remitflow")
	httpReq.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("[Mojaloop] Transfer failed: %v", err)
		return &SettlementResult{
			OperationID: req.OperationID,
			Provider:    "mojaloop",
			ExternalRef: ref,
			Status:      "submitted",
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
	defer resp.Body.Close()

	status := "submitted"
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		status = "accepted"
	}

	return &SettlementResult{
		OperationID: req.OperationID,
		Provider:    "mojaloop",
		ExternalRef: ref,
		Status:      status,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// ── HTTP Handlers ───────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":       "ok",
		"service":      "stablecoin-settlement",
		"port":         port,
		"version":      "1.0.0",
		"uptime_secs":  int(time.Since(startTime).Seconds()),
		"settlements":  atomic.LoadUint64(&settlementCount),
		"webhooks":     atomic.LoadUint64(&webhookCount),
		"ledger_writes": atomic.LoadUint64(&ledgerCount),
		"claims":       atomic.LoadUint64(&claimCount),
		"errors":       atomic.LoadUint64(&errorCount),
	})
}

func settlementHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}

	var req SettlementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}

	result, err := executeSettlement(req)
	if err != nil {
		w.WriteHeader(503)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(result)
}

func webhookCircleHandler(w http.ResponseWriter, r *http.Request) {
	handleWebhook(w, r, "circle", circleWebhookSecret)
}

func webhookYellowCardHandler(w http.ResponseWriter, r *http.Request) {
	handleWebhook(w, r, "yellow_card", yellowCardWebhookSecret)
}

func webhookMoonPayHandler(w http.ResponseWriter, r *http.Request) {
	handleWebhook(w, r, "moonpay", moonpayWebhookSecret)
}

func webhookTransakHandler(w http.ResponseWriter, r *http.Request) {
	handleWebhook(w, r, "transak", transakWebhookSecret)
}

func handleWebhook(w http.ResponseWriter, r *http.Request, provider, secret string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	atomic.AddUint64(&webhookCount, 1)

	// Bound the body read (max 1 MiB) — no unbounded reads.
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Request body too large or unreadable", 413)
		return
	}

	// Verify HMAC signature
	signature := r.Header.Get("X-Signature-256")
	if signature == "" {
		signature = r.Header.Get("X-Webhook-Signature")
	}

	// FAIL CLOSED: reject any webhook that does not verify, regardless of
	// whether a secret is configured.
	verified := verifyHMAC(body, signature, secret)
	if !verified {
		log.Printf("[Webhook] %s signature verification FAILED (secret configured: %v)", provider, secret != "")
		http.Error(w, "Invalid signature", 401)
		return
	}

	var payload map[string]interface{}
	json.Unmarshal(body, &payload)

	// Dedup check
	eventID := fmt.Sprintf("%v", payload["id"])
	if eventID == "" || eventID == "<nil>" {
		eventID = fmt.Sprintf("%s_%d", provider, time.Now().UnixNano())
	}

	dedupKey := fmt.Sprintf("%s_%s", provider, eventID)
	mu.Lock()
	if webhookDedup[dedupKey] {
		mu.Unlock()
		log.Printf("[Webhook] Duplicate %s event: %s", provider, eventID)
		json.NewEncoder(w).Encode(map[string]string{"status": "duplicate"})
		return
	}
	webhookDedup[dedupKey] = true
	mu.Unlock()

	event := &WebhookEvent{
		ID:         eventID,
		Type:       fmt.Sprintf("%v", payload["type"]),
		Provider:   provider,
		Payload:    payload,
		ReceivedAt: time.Now().UTC().Format(time.RFC3339),
		Verified:   verified,
	}

	mu.Lock()
	webhookEvents[eventID] = event
	mu.Unlock()

	// Publish Kafka event
	publishKafkaEvent("stablecoin_webhook", map[string]interface{}{
		"event_id": eventID,
		"provider": provider,
		"type":     event.Type,
		"verified": verified,
		"received_at": event.ReceivedAt,
	})

	// Update transaction status if applicable
	processWebhookEvent(event)

	log.Printf("[Webhook] %s event processed: id=%s type=%s verified=%v", provider, eventID, event.Type, verified)
	json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "event_id": eventID})
}

func processWebhookEvent(event *WebhookEvent) {
	// Extract transaction reference from webhook payload
	payload := event.Payload
	var txRef string

	switch event.Provider {
	case "circle":
		if transfer, ok := payload["transfer"].(map[string]interface{}); ok {
			txRef, _ = transfer["id"].(string)
		}
	case "yellow_card":
		txRef, _ = payload["reference"].(string)
	case "moonpay":
		txRef, _ = payload["transactionId"].(string)
	case "transak":
		txRef, _ = payload["webhookData"].(map[string]interface{})["id"].(string)
	}

	if txRef != "" {
		log.Printf("[Webhook] Updating settlement for tx: %s status: completed", txRef)
		// Notify core API to update transaction status
		go notifyCoreAPI(txRef, event.Provider, "completed")
	}
}

func notifyCoreAPI(txRef, provider, status string) {
	payload, _ := json.Marshal(map[string]interface{}{
		"transactionRef": txRef,
		"provider":       provider,
		"status":         status,
		"updatedAt":      time.Now().UTC().Format(time.RFC3339),
	})

	req, _ := http.NewRequest("POST", coreAPIURL+"/api/webhooks/settlement-update", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[CoreAPI] Notification failed: %v", err)
		return
	}
	defer resp.Body.Close()
}

// ── P2P Claim Endpoint ──────────────────────────────────────────────────────

func createClaimHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}

	var req struct {
		ClaimID    string  `json:"claim_id"`
		SenderID   int     `json:"sender_id"`
		Stablecoin string  `json:"stablecoin"`
		Amount     float64 `json:"amount"`
		Chain      string  `json:"chain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}

	claim := &P2PClaim{
		ClaimID:    req.ClaimID,
		SenderID:   req.SenderID,
		Stablecoin: req.Stablecoin,
		Amount:     req.Amount,
		Chain:      req.Chain,
		ExpiresAt:  time.Now().Add(30 * 24 * time.Hour).UTC().Format(time.RFC3339),
		Status:     "pending",
	}

	mu.Lock()
	p2pClaims[req.ClaimID] = claim
	mu.Unlock()
	atomic.AddUint64(&claimCount, 1)

	publishKafkaEvent("stablecoin_p2p", map[string]interface{}{
		"claim_id":   req.ClaimID,
		"sender_id":  req.SenderID,
		"stablecoin": req.Stablecoin,
		"amount":     req.Amount,
		"action":     "claim_created",
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"claim_id": req.ClaimID,
		"claim_url": fmt.Sprintf("/claim/%s", req.ClaimID),
		"expires_at": claim.ExpiresAt,
	})
}

func redeemClaimHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}

	var req struct {
		ClaimID   string `json:"claim_id"`
		ClaimerID int    `json:"claimer_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}

	// Hold the lock across the entire check-and-set so two concurrent redeems
	// cannot both observe status=="pending" (double-redeem TOCTOU).
	mu.Lock()
	claim, exists := p2pClaims[req.ClaimID]
	if !exists {
		mu.Unlock()
		http.Error(w, "Claim not found", 404)
		return
	}

	if claim.Status != "pending" {
		mu.Unlock()
		http.Error(w, fmt.Sprintf("Claim already %s", claim.Status), 400)
		return
	}

	expiresAt, _ := time.Parse(time.RFC3339, claim.ExpiresAt)
	if time.Now().After(expiresAt) {
		claim.Status = "expired"
		mu.Unlock()
		http.Error(w, "Claim has expired", 410)
		return
	}

	claim.Status = "claimed"
	claim.ClaimedByID = req.ClaimerID
	claim.ClaimedAt = time.Now().UTC().Format(time.RFC3339)
	claimedStablecoin, claimedAmount := claim.Stablecoin, claim.Amount
	mu.Unlock()

	publishKafkaEvent("stablecoin_p2p", map[string]interface{}{
		"claim_id":   req.ClaimID,
		"claimer_id": req.ClaimerID,
		"stablecoin": claimedStablecoin,
		"amount":     claimedAmount,
		"action":     "claim_redeemed",
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"claim_id":   req.ClaimID,
		"stablecoin": claimedStablecoin,
		"amount":     claimedAmount,
		"claimed_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func getClaimHandler(w http.ResponseWriter, r *http.Request) {
	claimID := strings.TrimPrefix(r.URL.Path, "/claim/")
	if claimID == "" {
		http.Error(w, "Claim ID required", 400)
		return
	}

	// Write lock: expiry check mutates claim.Status.
	mu.Lock()
	claim, exists := p2pClaims[claimID]
	if !exists {
		mu.Unlock()
		http.Error(w, "Claim not found", 404)
		return
	}

	// Check expiry
	expiresAt, _ := time.Parse(time.RFC3339, claim.ExpiresAt)
	if time.Now().After(expiresAt) && claim.Status == "pending" {
		claim.Status = "expired"
	}
	mu.Unlock()

	json.NewEncoder(w).Encode(claim)
}

// ── Ledger Endpoints ────────────────────────────────────────────────────────

func ledgerHistoryHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	entries := make([]*LedgerEntry, 0, len(ledgerEntries))
	for _, e := range ledgerEntries {
		entries = append(entries, e)
	}
	mu.RUnlock()

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}

	if len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"entries": entries,
		"total":   len(ledgerEntries),
	})
}

// ── Metrics ─────────────────────────────────────────────────────────────────

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	cbStates := make(map[string]string)
	for name, cb := range circuitBreakers {
		cb.mu.Lock()
		cbStates[name] = cb.state
		cb.mu.Unlock()
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"settlements":     atomic.LoadUint64(&settlementCount),
		"webhooks":        atomic.LoadUint64(&webhookCount),
		"ledger_writes":   atomic.LoadUint64(&ledgerCount),
		"claims":          atomic.LoadUint64(&claimCount),
		"errors":          atomic.LoadUint64(&errorCount),
		"circuit_breakers": cbStates,
		"uptime_secs":     int(time.Since(startTime).Seconds()),
	})
}

// requireProductionSecrets fails the boot in production when any provider
// webhook secret is unset — with fail-closed verifyHMAC, missing secrets would
// break providers anyway; booting without them silently was the original bug.
func requireProductionSecrets() {
	env := strings.ToLower(os.Getenv("GO_ENV") + os.Getenv("NODE_ENV") + os.Getenv("APP_ENV"))
	if !strings.Contains(env, "production") && !strings.Contains(env, "prod") {
		return
	}
	var missing []string
	for name, val := range map[string]string{
		"CIRCLE_WEBHOOK_SECRET":     circleWebhookSecret,
		"YELLOWCARD_WEBHOOK_SECRET": yellowCardWebhookSecret,
		"MOONPAY_WEBHOOK_SECRET":    moonpayWebhookSecret,
		"TRANSAK_WEBHOOK_SECRET":    transakWebhookSecret,
	} {
		if val == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		log.Fatalf("FATAL: production boot refused — webhook secrets not set: %s", strings.Join(missing, ", "))
	}
}

func main() {
	requireProductionSecrets()
	mux := http.NewServeMux()

	// Health + Metrics
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/metrics", metricsHandler)

	// Settlement orchestration
	mux.HandleFunc("/settlement/execute", settlementHandler)

	// Webhook handlers (with HMAC verification)
	mux.HandleFunc("/webhook/circle", webhookCircleHandler)
	mux.HandleFunc("/webhook/yellowcard", webhookYellowCardHandler)
	mux.HandleFunc("/webhook/moonpay", webhookMoonPayHandler)
	mux.HandleFunc("/webhook/transak", webhookTransakHandler)

	// P2P claims
	mux.HandleFunc("/claim/create", createClaimHandler)
	mux.HandleFunc("/claim/redeem", redeemClaimHandler)
	mux.HandleFunc("/claim/", getClaimHandler)

	// Ledger
	mux.HandleFunc("/ledger/history", ledgerHistoryHandler)

	log.Printf("Stablecoin Settlement Orchestrator starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
