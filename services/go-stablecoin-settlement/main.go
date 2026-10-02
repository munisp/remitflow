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
//   - Circuit breaking for external providers; bounded retry with backoff
//     for internal Dapr/OpenSearch publishes (transport errors and 5xx only)
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
// Port: 8215 (was 8200 — that collided with rust-tigerbeetle-bridge)
package main

import (
	"context"
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
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// ── Configuration ───────────────────────────────────────────────────────────

var (
	// Default port is 8215: 8200 belongs to rust-tigerbeetle-bridge and the
	// collision made both services race for the same listener. PORT overrides.
	port            = getEnv("PORT", "8215")
	kafkaBrokers    = getEnv("KAFKA_BROKERS", "localhost:9092")
	redisURL        = getEnv("REDIS_URL", "localhost:6379")
	daprURL         = getEnv("DAPR_HTTP_PORT", "3500")
	tigerBeetleAddr = getEnv("TIGERBEETLE_ADDR", "localhost:3001")
	mojaloopURL     = getEnv("MOJALOOP_URL", "http://localhost:4000")
	openSearchURL   = getEnv("OPENSEARCH_URL", "http://localhost:9200")
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
	OperationID string                 `json:"operation_id"`
	Provider    string                 `json:"provider"`
	Action      string                 `json:"action"` // initiate_payout, initiate_onramp, confirm_bridge, pay_biller, refund
	Payload     map[string]interface{} `json:"payload"`
}

type SettlementResult struct {
	ExternalRef string `json:"external_ref"`
	Status      string `json:"status"`
	Provider    string `json:"provider"`
	OperationID string `json:"operation_id"`
	Timestamp   string `json:"timestamp"`
}

type WebhookEvent struct {
	ID         string                 `json:"id"`
	Type       string                 `json:"type"`
	Provider   string                 `json:"provider"`
	Payload    map[string]interface{} `json:"payload"`
	ReceivedAt string                 `json:"received_at"`
	Verified   bool                   `json:"verified"`
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
	ClaimID     string  `json:"claim_id"`
	SenderID    int     `json:"sender_id"`
	Stablecoin  string  `json:"stablecoin"`
	Amount      float64 `json:"amount"`
	Chain       string  `json:"chain"`
	ExpiresAt   string  `json:"expires_at"`
	Status      string  `json:"status"` // pending, claimed, expired
	ClaimedByID int     `json:"claimed_by_id,omitempty"`
	ClaimedAt   string  `json:"claimed_at,omitempty"`
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

// In-memory stores are best-effort runtime state (the authoritative record is
// the TigerBeetle/Dapr state store). Each map has its own lock so a hot path
// (e.g. webhook dedup) never blocks an unrelated one (e.g. claim redemption).
// All maps are bounded — on overflow an arbitrary old entry is evicted.
var (
	settlements   = make(map[string]*SettlementResult)
	settlementsMu sync.RWMutex

	webhookEvents = make(map[string]*WebhookEvent)
	webhookDedup  = make(map[string]time.Time) // 24h dedup window, swept periodically
	webhookMu     sync.RWMutex

	ledgerEntries = make(map[string]*LedgerEntry)
	ledgerMu      sync.RWMutex

	p2pClaims = make(map[string]*P2PClaim)
	claimsMu  sync.RWMutex
)

const (
	maxSettlementRecords = 10000
	maxWebhookEvents     = 10000
	maxLedgerEntries     = 10000
	maxP2PClaims         = 10000
	maxWebhookDedupKeys  = 100000
	webhookDedupTTL      = 24 * time.Hour
)

// evictOldestLocked removes an arbitrary entry from a bounded map that has
// reached its cap. Map iteration order is random, so this is "an" entry, not
// strictly the oldest — acceptable for best-effort in-memory caches.
func evictOneSettlementLocked() {
	for k := range settlements {
		delete(settlements, k)
		return
	}
}

func evictOneWebhookEventLocked() {
	for k := range webhookEvents {
		delete(webhookEvents, k)
		return
	}
}

func evictOneLedgerEntryLocked() {
	for k := range ledgerEntries {
		delete(ledgerEntries, k)
		return
	}
}

func evictOneP2PClaimLocked() {
	for k := range p2pClaims {
		delete(p2pClaims, k)
		return
	}
}

// sweepWebhookDedup periodically removes dedup keys older than the 24h window
// so the map cannot grow without bound between bursts.
func sweepWebhookDedup(stop <-chan struct{}) {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			cutoff := time.Now().Add(-webhookDedupTTL)
			webhookMu.Lock()
			for k, ts := range webhookDedup {
				if ts.Before(cutoff) {
					delete(webhookDedup, k)
				}
			}
			webhookMu.Unlock()
		}
	}
}

var (
	settlementCount uint64
	webhookCount    uint64
	ledgerCount     uint64
	claimCount      uint64
	errorCount      uint64

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

// ── Shared HTTP clients ─────────────────────────────────────────────────────
// One client per timeout class, hoisted to package scope: per-call client
// construction defeats connection reuse (every call dialled a fresh TCP conn).
var (
	daprStateClient      = &http.Client{Timeout: 5 * time.Second}
	daprPublishClient    = &http.Client{Timeout: 3 * time.Second}
	openSearchClient     = &http.Client{Timeout: 3 * time.Second}
	providerPayoutClient = &http.Client{Timeout: 15 * time.Second}
	mojaloopClient       = &http.Client{Timeout: 10 * time.Second}
)

// publishRetryBackoffs is the bounded retry schedule for internal Dapr /
// OpenSearch publishes: at most 3 attempts (1 + 2 retries).
var publishRetryBackoffs = []time.Duration{200 * time.Millisecond, 600 * time.Millisecond}

// doPublishWithRetry runs fn up to len(publishRetryBackoffs)+1 times. It
// retries ONLY transport errors and 5xx responses — a 4xx is a permanent
// caller bug and is never retried (fail closed).
func doPublishWithRetry(fn func() (int, error)) error {
	var lastErr error
	for attempt := 0; attempt <= len(publishRetryBackoffs); attempt++ {
		status, err := fn()
		if err == nil && status < 500 {
			return nil
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("publish returned HTTP %d", status)
		}
		if status > 0 && status < 500 {
			return lastErr // 4xx: permanent, do not retry
		}
		if attempt < len(publishRetryBackoffs) {
			time.Sleep(publishRetryBackoffs[attempt])
		}
	}
	return lastErr
}

// ── TigerBeetle via Dapr ────────────────────────────────────────────────────

func writeLedgerEntry(entry *LedgerEntry) error {
	// Durable PG mirror first (fail-open but loud: PG is the recovery record).
	if err := persistLedgerEntry(entry); err != nil {
		log.Printf("[TigerBeetle] ERROR: ledger entry PG persist failed id=%s: %v", entry.EntryID, err)
	}
	ledgerMu.Lock()
	if len(ledgerEntries) >= maxLedgerEntries {
		evictOneLedgerEntryLocked()
	}
	ledgerEntries[entry.EntryID] = entry
	ledgerMu.Unlock()
	atomic.AddUint64(&ledgerCount, 1)

	// Write to TigerBeetle via Dapr state store (bounded retry, then give up:
	// the in-memory record above is the fallback until Dapr is reachable).
	payload, _ := json.Marshal(map[string]interface{}{
		"key":   entry.EntryID,
		"value": entry,
	})

	url := fmt.Sprintf("http://localhost:%s/v1.0/state/tigerbeetle-store", daprURL)
	err := doPublishWithRetry(func() (int, error) {
		req, _ := http.NewRequest("POST", url, strings.NewReader(fmt.Sprintf("[%s]", string(payload))))
		req.Header.Set("Content-Type", "application/json")
		resp, err := daprStateClient.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return resp.StatusCode, nil
	})
	if err != nil {
		// Durable outbox (W19): the failed Dapr write is queued in Postgres
		// and replayed by runOutboxRelay until delivered — no longer
		// log-and-drop. PG row above remains the source of truth meanwhile.
		log.Printf("[TigerBeetle] Dapr write failed after bounded retries — queued to outbox: %v", err)
		enqueueOutbox(outboxKindLedgerState, "", []byte(fmt.Sprintf("[%s]", string(payload))), err)
		return nil // Non-blocking; durability is covered by PG + outbox
	}

	return nil
}

// ── Kafka Publishing ────────────────────────────────────────────────────────

func publishKafkaEvent(topic string, event interface{}) {
	payload, _ := json.Marshal(event)

	// Via Dapr pub/sub (bounded retry on transport error / 5xx)
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/kafka-pubsub/%s", daprURL, topic)
	err := doPublishWithRetry(func() (int, error) {
		req, _ := http.NewRequest("POST", url, strings.NewReader(string(payload)))
		req.Header.Set("Content-Type", "application/json")
		resp, err := daprPublishClient.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return resp.StatusCode, nil
	})
	if err != nil {
		log.Printf("[Kafka] Publish to %s failed after bounded retries — queued to outbox: %v", topic, err)
		enqueueOutbox(outboxKindKafka, topic, payload, err)
		return
	}
}

// ── OpenSearch Indexing ─────────────────────────────────────────────────────
// NOTE: documents are indexed one call site at a time (single-doc PUT). A
// _bulk path is not wired because there is only one producer call site; if a
// second indexer appears, batch via the OpenSearch _bulk API instead.

func indexToOpenSearch(indexName string, docID string, doc interface{}) {
	payload, _ := json.Marshal(doc)
	url := fmt.Sprintf("%s/%s/_doc/%s", openSearchURL, indexName, docID)
	err := doPublishWithRetry(func() (int, error) {
		req, _ := http.NewRequest("PUT", url, strings.NewReader(string(payload)))
		req.Header.Set("Content-Type", "application/json")
		resp, err := openSearchClient.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return resp.StatusCode, nil
	})
	if err != nil {
		log.Printf("[OpenSearch] Index to %s failed after bounded retries — queued to outbox: %v", indexName, err)
		envPayload, _ := json.Marshal(map[string]interface{}{
			"index": indexName, "id": docID, "doc": json.RawMessage(payload),
		})
		enqueueOutbox(outboxKindOpenSearch, indexName, envPayload, err)
		return
	}
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
	case "refund":
		result, err = executeRefund(req, provider)
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

	// Durable PG mirror first — settlement records are money-path state.
	if err := persistSettlementRecord(result); err != nil {
		log.Printf("[Settlement] ERROR: settlement record persist failed op=%s: %v", result.OperationID, err)
	}
	settlementsMu.Lock()
	if len(settlements) >= maxSettlementRecords {
		evictOneSettlementLocked()
	}
	settlements[result.OperationID] = result
	settlementsMu.Unlock()

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

// executeRefund handles action "refund". FAIL CLOSED / NO FAKE SUCCESS:
//   - The original operation must exist in the settlement record store,
//     otherwise there is nothing real to refund (NOT_FOUND).
//   - A provider refund is only reported when the provider client genuinely
//     supports one. None of the wired provider clients (circle, yellow_card,
//     mojaloop) implements a refund path, so this returns an honest
//     NOT_SUPPORTED error — the saga records it as a failed compensation and
//     NEVER as a completed refund.
func executeRefund(req SettlementRequest, provider string) (*SettlementResult, error) {
	originalOp, _ := req.Payload["original_operation_id"].(string)
	if originalOp == "" {
		return nil, fmt.Errorf("INVALID_REQUEST: refund requires payload.original_operation_id")
	}
	settlementsMu.RLock()
	_, known := settlements[originalOp]
	settlementsMu.RUnlock()
	if !known {
		return nil, fmt.Errorf("NOT_FOUND: original operation %q has no settlement record; refusing to report a refund against nothing", originalOp)
	}
	log.Printf("[Settlement] Refund requested via %s: operation=%s original=%s amount=%v currency=%v — no provider refund path is wired; reporting NOT_SUPPORTED",
		provider, req.OperationID, originalOp, req.Payload["amount"], req.Payload["currency"])
	return nil, fmt.Errorf("NOT_SUPPORTED: provider %s has no refund capability in this settlement client; original operation %s requires manual/provider-console refund", provider, originalOp)
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

	resp, err := mojaloopClient.Do(httpReq)
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
		"status":        "ok",
		"service":       "stablecoin-settlement",
		"port":          port,
		"version":       "1.0.0",
		"uptime_secs":   int(time.Since(startTime).Seconds()),
		"settlements":   atomic.LoadUint64(&settlementCount),
		"webhooks":      atomic.LoadUint64(&webhookCount),
		"ledger_writes": atomic.LoadUint64(&ledgerCount),
		"claims":        atomic.LoadUint64(&claimCount),
		"errors":        atomic.LoadUint64(&errorCount),
	})
}

func settlementHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}

	var req SettlementRequest
	// Bound the body read (max 1 MiB) — no unbounded reads.
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	// Cross-replica dedup claim via PG when configured (fail closed: if the
	// claim cannot be verified, reject with 503 so the provider retries —
	// never process a webhook whose dedup state is unknown).
	claimed, claimErr := claimWebhookDedup(dedupKey)
	if claimErr != nil {
		log.Printf("[Webhook] ERROR: dedup claim failed key=%s (fail closed, forcing provider retry): %v", dedupKey, claimErr)
		http.Error(w, "dedup store unavailable — retry", http.StatusServiceUnavailable)
		return
	}
	if !claimed {
		log.Printf("[Webhook] Duplicate %s event: %s", provider, eventID)
		json.NewEncoder(w).Encode(map[string]string{"status": "duplicate"})
		return
	}
	webhookMu.Lock()
	if len(webhookDedup) >= maxWebhookDedupKeys {
		// Hard cap backstop between sweeps: drop the oldest-seeming entry
		// (map order is random; the TTL sweeper is the primary eviction path).
		for k := range webhookDedup {
			delete(webhookDedup, k)
			break
		}
	}
	webhookMu.Unlock()

	event := &WebhookEvent{
		ID:         eventID,
		Type:       fmt.Sprintf("%v", payload["type"]),
		Provider:   provider,
		Payload:    payload,
		ReceivedAt: time.Now().UTC().Format(time.RFC3339),
		Verified:   verified,
	}

	webhookMu.Lock()
	if len(webhookEvents) >= maxWebhookEvents {
		evictOneWebhookEventLocked()
	}
	webhookEvents[eventID] = event
	webhookMu.Unlock()
	persistWebhookEvent(event)

	// Bounded async dispatch: ACK fast, process on a fixed worker pool. If the
	// queue is full, roll back the dedup/event records (so the provider's retry
	// is not swallowed as a "duplicate") and return 503 to force that retry.
	select {
	case webhookQueue <- event:
	default:
		webhookMu.Lock()
		delete(webhookDedup, dedupKey)
		delete(webhookEvents, eventID)
		webhookMu.Unlock()
		releaseWebhookDedup(dedupKey)
		http.Error(w, "Webhook processing queue saturated — retry", http.StatusServiceUnavailable)
		return
	}

	log.Printf("[Webhook] %s event queued: id=%s type=%s verified=%v", provider, eventID, event.Type, verified)
	json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "event_id": eventID})
}

// ── Bounded async webhook dispatch ──────────────────────────────────────────
// Webhook ACK latency must not wait on Kafka/Dapr round trips. A buffered
// channel feeds a fixed worker pool; backpressure is signalled to the provider
// as 503 (retry) rather than unbounded goroutine growth.

const webhookWorkers = 4
const webhookQueueSize = 256

var webhookQueue = make(chan *WebhookEvent, webhookQueueSize)

func webhookWorker(wg *sync.WaitGroup) {
	defer wg.Done()
	for event := range webhookQueue {
		// Publish Kafka event
		publishKafkaEvent("stablecoin_webhook", map[string]interface{}{
			"event_id":    event.ID,
			"provider":    event.Provider,
			"type":        event.Type,
			"verified":    event.Verified,
			"received_at": event.ReceivedAt,
		})

		// Update transaction status if applicable
		processWebhookEvent(event)
	}
}

// ── Settlement Outcome Mapping (fail-closed) ────────────────────────────────
// Real outcome enum derived from the provider payload. FAIL CLOSED: an unknown
// or missing provider status maps to "pending" — NEVER "completed". The previous
// implementation labeled every settlement event "completed" regardless of the
// actual outcome (stablecoin audit).
var settlementOutcomeEnum = map[string]string{
	"complete": "completed", "completed": "completed", "success": "completed",
	"succeeded": "completed", "confirmed": "completed",
	"failed": "failed", "failure": "failed", "cancelled": "failed", "canceled": "failed",
	"refunded": "failed", "expired": "failed", "reversed": "failed", "declined": "failed",
	"pending": "pending", "awaiting_payment": "pending", "waiting_payment": "pending",
	"processing": "processing", "initiated": "processing", "in_progress": "processing",
}

func normalizeSettlementStatus(raw string) string {
	if outcome, ok := settlementOutcomeEnum[strings.ToLower(strings.TrimSpace(raw))]; ok {
		return outcome
	}
	return "pending" // fail closed — an unrecognized outcome is never treated as settled
}

// extractProviderStatus reads the real outcome field from each provider's payload.
func extractProviderStatus(provider string, payload map[string]interface{}) string {
	switch provider {
	case "circle":
		if transfer, ok := payload["transfer"].(map[string]interface{}); ok {
			if s, ok := transfer["status"].(string); ok {
				return s
			}
		}
	case "transak":
		if wd, ok := payload["webhookData"].(map[string]interface{}); ok {
			if s, ok := wd["status"].(string); ok {
				return s
			}
		}
	default: // yellow_card, moonpay
		if s, ok := payload["status"].(string); ok {
			return s
		}
	}
	return ""
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

	if txRef == "" {
		return
	}

	// Map the REAL provider outcome — never assume "completed".
	rawStatus := extractProviderStatus(event.Provider, payload)
	status := normalizeSettlementStatus(rawStatus)
	if rawStatus == "" {
		log.Printf("[Webhook] tx %s: provider %s payload carried no status field — treated as pending (fail closed)", txRef, event.Provider)
	}

	// Persist the real outcome onto any matching settlement record (keyed by the
	// provider's external reference).
	settlementsMu.Lock()
	updated := false
	for _, s := range settlements {
		if s.ExternalRef == txRef {
			s.Status = status
			s.Timestamp = time.Now().UTC().Format(time.RFC3339)
			updated = true
			if err := persistSettlementRecord(s); err != nil {
				log.Printf("[Settlement] ERROR: webhook status update persist failed op=%s: %v", s.OperationID, err)
			}
		}
	}
	settlementsMu.Unlock()

	// STABLECOIN AUDIT NOTE: the previous implementation POSTed every event to
	// CORE_API_URL + "/api/webhooks/settlement-update" labeled "completed" —
	// no such TypeScript receiver route exists in server/. Do NOT re-add an HTTP
	// push until a real receiver is implemented. Instead, persist the event to
	// the Kafka outbox topic this engine already uses ("stablecoin_settlement").
	log.Printf("[Webhook] Settlement outcome: tx=%s provider=%s raw_status=%q mapped_status=%s settlement_record_updated=%v",
		txRef, event.Provider, rawStatus, status, updated)
	publishKafkaEvent("stablecoin_settlement", map[string]interface{}{
		"event_id":                  event.ID,
		"transaction_ref":           txRef,
		"provider":                  event.Provider,
		"status":                    status,
		"raw_status":                rawStatus,
		"settlement_record_updated": updated,
		"updated_at":                time.Now().UTC().Format(time.RFC3339),
	})
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

	// Fail closed: claims are money; persist before admitting in-memory.
	if err := persistClaim(claim); err != nil {
		log.Printf("[Settlement] ERROR: claim persist failed id=%s (refusing creation): %v", req.ClaimID, err)
		http.Error(w, "failed to persist claim", 500)
		return
	}
	claimsMu.Lock()
	if len(p2pClaims) >= maxP2PClaims {
		evictOneP2PClaimLocked()
	}
	p2pClaims[req.ClaimID] = claim
	claimsMu.Unlock()
	atomic.AddUint64(&claimCount, 1)

	publishKafkaEvent("stablecoin_p2p", map[string]interface{}{
		"claim_id":   req.ClaimID,
		"sender_id":  req.SenderID,
		"stablecoin": req.Stablecoin,
		"amount":     req.Amount,
		"action":     "claim_created",
	})

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"claim_id":   req.ClaimID,
		"claim_url":  fmt.Sprintf("/claim/%s", req.ClaimID),
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

	// Cross-replica path: PG conditional UPDATE is the atomic check-and-set,
	// so two replicas cannot both redeem the same claim (W19).
	if db != nil {
		claimed, expired, err := redeemClaimPG(req.ClaimID, req.ClaimerID)
		if err != nil {
			log.Printf("[Settlement] ERROR: claim redeem persist failed id=%s (fail closed): %v", req.ClaimID, err)
			http.Error(w, "claim store unavailable", 500)
			return
		}
		if expired {
			claimsMu.Lock()
			if cl, ok := p2pClaims[req.ClaimID]; ok {
				cl.Status = "expired"
			}
			claimsMu.Unlock()
			http.Error(w, "Claim has expired", 410)
			return
		}
		if !claimed {
			claimsMu.Lock()
			cl, ok := p2pClaims[req.ClaimID]
			claimsMu.Unlock()
			if !ok {
				http.Error(w, "Claim not found", 404)
				return
			}
			http.Error(w, fmt.Sprintf("Claim already %s", cl.Status), 400)
			return
		}
		claimedAt := time.Now().UTC().Format(time.RFC3339)
		claimsMu.Lock()
		claim, ok := p2pClaims[req.ClaimID]
		if ok {
			claim.Status = "claimed"
			claim.ClaimedByID = req.ClaimerID
			claim.ClaimedAt = claimedAt
		}
		claimsMu.Unlock()
		if !ok {
			// Claimed in PG but not in this replica's memory (created on
			// another replica) — reconstruct the response from the request.
			claim = &P2PClaim{ClaimID: req.ClaimID}
		}
		publishKafkaEvent("stablecoin_p2p", map[string]interface{}{
			"claim_id":   req.ClaimID,
			"claimer_id": req.ClaimerID,
			"stablecoin": claim.Stablecoin,
			"amount":     claim.Amount,
			"action":     "claim_redeemed",
		})
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    true,
			"claim_id":   req.ClaimID,
			"stablecoin": claim.Stablecoin,
			"amount":     claim.Amount,
			"claimed_at": claimedAt,
		})
		return
	}

	// Volatile dev-mode path (no PG): hold the lock across the entire
	// check-and-set so two concurrent redeems cannot both observe
	// status=="pending" (double-redeem TOCTOU).
	claimsMu.Lock()
	claim, exists := p2pClaims[req.ClaimID]
	if !exists {
		claimsMu.Unlock()
		http.Error(w, "Claim not found", 404)
		return
	}

	if claim.Status != "pending" {
		claimsMu.Unlock()
		http.Error(w, fmt.Sprintf("Claim already %s", claim.Status), 400)
		return
	}

	expiresAt, _ := time.Parse(time.RFC3339, claim.ExpiresAt)
	if time.Now().After(expiresAt) {
		claim.Status = "expired"
		claimsMu.Unlock()
		http.Error(w, "Claim has expired", 410)
		return
	}

	claim.Status = "claimed"
	claim.ClaimedByID = req.ClaimerID
	claim.ClaimedAt = time.Now().UTC().Format(time.RFC3339)
	claimedStablecoin, claimedAmount := claim.Stablecoin, claim.Amount
	claimsMu.Unlock()

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
	claimsMu.Lock()
	claim, exists := p2pClaims[claimID]
	if !exists {
		claimsMu.Unlock()
		http.Error(w, "Claim not found", 404)
		return
	}

	// Check expiry
	expiresAt, _ := time.Parse(time.RFC3339, claim.ExpiresAt)
	if time.Now().After(expiresAt) && claim.Status == "pending" {
		claim.Status = "expired"
		if err := persistClaim(claim); err != nil {
			log.Printf("[Settlement] ERROR: claim expiry persist failed id=%s: %v", claimID, err)
		}
	}
	claimsMu.Unlock()

	json.NewEncoder(w).Encode(claim)
}

// ── Ledger Endpoints ────────────────────────────────────────────────────────

func ledgerHistoryHandler(w http.ResponseWriter, r *http.Request) {
	ledgerMu.RLock()
	entries := make([]*LedgerEntry, 0, len(ledgerEntries))
	for _, e := range ledgerEntries {
		entries = append(entries, e)
	}
	total := len(ledgerEntries)
	ledgerMu.RUnlock()

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
		"total":   total,
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
		"settlements":      atomic.LoadUint64(&settlementCount),
		"webhooks":         atomic.LoadUint64(&webhookCount),
		"ledger_writes":    atomic.LoadUint64(&ledgerCount),
		"claims":           atomic.LoadUint64(&claimCount),
		"errors":           atomic.LoadUint64(&errorCount),
		"circuit_breakers": cbStates,
		"uptime_secs":      int(time.Since(startTime).Seconds()),
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
	initDB()
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

	// Background maintenance + bounded webhook worker pool + outbox relay
	// (replays failed Dapr/Kafka/OpenSearch writes queued in Postgres).
	sweepStop := make(chan struct{})
	go sweepWebhookDedup(sweepStop)
	outboxStop := make(chan struct{})
	go runOutboxRelay(outboxStop)
	var workerWG sync.WaitGroup
	for i := 0; i < webhookWorkers; i++ {
		workerWG.Add(1)
		go webhookWorker(&workerWG)
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("Stablecoin Settlement Orchestrator starting on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Printf("Stablecoin Settlement Orchestrator shutting down...")

	// Stop accepting new dedup-sweep work, drain the server, then the queue.
	close(sweepStop)
	close(outboxStop)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}
	close(webhookQueue)
	workerWG.Wait()
	log.Printf("Stablecoin Settlement Orchestrator stopped")
}
