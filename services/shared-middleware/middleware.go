// shared-middleware/middleware.go
// RemitFlow — Shared Middleware Client Library (Go)
//
// Provides unified clients for all middleware components used across rail adapters:
//   - Kafka (Confluent): event publishing and consuming
//   - Dapr: pub/sub, state store, service invocation
//   - Fluvio: real-time streaming (via HTTP gateway)
//   - Temporal: workflow execution
//   - Redis: rate limiting, idempotency, caching
//   - TigerBeetle: double-entry ledger accounting
//   - OpenSearch: transfer indexing and search
//   - Permify: fine-grained authorization
//   - Keycloak: JWT validation
//   - APISix: gateway registration
//   - Lakehouse: ETL event emission
//
// All clients implement graceful degradation — if a middleware is unavailable,
// the rail adapter continues operating with reduced observability.

package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	KafkaBrokers      string
	DaprHTTPPort      string
	FluvioGatewayURL  string
	TemporalHostPort  string
	RedisAddr         string
	TigerBeetleAddr   string
	OpenSearchURL     string
	PermifyGRPCAddr   string
	KeycloakURL       string
	APISixAdminURL    string
	LakehouseURL      string
	ServiceName       string
}

func LoadConfig(serviceName string) Config {
	return Config{
		KafkaBrokers:     getEnv("KAFKA_BROKERS", "localhost:9092"),
		DaprHTTPPort:     getEnv("DAPR_HTTP_PORT", "3500"),
		FluvioGatewayURL: getEnv("FLUVIO_GATEWAY_URL", "http://localhost:9003"),
		TemporalHostPort: getEnv("TEMPORAL_HOST_PORT", "localhost:7233"),
		RedisAddr:        getEnv("REDIS_ADDR", "localhost:6379"),
		TigerBeetleAddr:  getEnv("TIGERBEETLE_ADDR", "localhost:3001"),
		OpenSearchURL:    getEnv("OPENSEARCH_URL", "http://localhost:9200"),
		PermifyGRPCAddr:  getEnv("PERMIFY_GRPC_ADDR", "localhost:3478"),
		KeycloakURL:      getEnv("KEYCLOAK_URL", "http://localhost:8080"),
		APISixAdminURL:   getEnv("APISIX_ADMIN_URL", "http://localhost:9180"),
		LakehouseURL:     getEnv("LAKEHOUSE_URL", "http://localhost:8090"),
		ServiceName:      serviceName,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

var httpClient = &http.Client{Timeout: 5 * time.Second}

func postJSON(url string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

// ── Kafka Client ──────────────────────────────────────────────────────────────

// KafkaEvent represents a domain event published to Kafka.
type KafkaEvent struct {
	EventType   string          `json:"eventType"`
	ServiceName string          `json:"serviceName"`
	TraceID     string          `json:"traceId"`
	Timestamp   string          `json:"timestamp"`
	Payload     json.RawMessage `json:"payload"`
}

// PublishKafkaEvent publishes a domain event via the go-kafka-service sidecar.
// Falls back gracefully if Kafka is unavailable.
func PublishKafkaEvent(ctx context.Context, cfg Config, topic string, event KafkaEvent) error {
	event.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	event.ServiceName = cfg.ServiceName
	url := fmt.Sprintf("http://localhost:8095/publish/%s", topic)
	if err := postJSON(url, event); err != nil {
		log.Printf("[Kafka] WARN: failed to publish %s to %s: %v (degraded mode)", event.EventType, topic, err)
		return nil // graceful degradation
	}
	return nil
}

// ── Dapr Pub/Sub ──────────────────────────────────────────────────────────────

type DaprPubSubMessage struct {
	Data map[string]any `json:"data"`
}

// PublishDapr publishes a message to a Dapr pub/sub topic.
func PublishDapr(ctx context.Context, cfg Config, pubsubName, topic string, data map[string]any) error {
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", cfg.DaprHTTPPort, pubsubName, topic)
	if err := postJSON(url, DaprPubSubMessage{Data: data}); err != nil {
		log.Printf("[Dapr] WARN: failed to publish to %s/%s: %v (degraded mode)", pubsubName, topic, err)
		return nil
	}
	return nil
}

// SetDaprState stores a key-value pair in the Dapr state store.
func SetDaprState(ctx context.Context, cfg Config, storeName, key string, value any) error {
	url := fmt.Sprintf("http://localhost:%s/v1.0/state/%s", cfg.DaprHTTPPort, storeName)
	payload := []map[string]any{{"key": key, "value": value}}
	if err := postJSON(url, payload); err != nil {
		log.Printf("[Dapr] WARN: failed to set state %s/%s: %v", storeName, key, err)
		return nil
	}
	return nil
}

// ── Fluvio Streaming ──────────────────────────────────────────────────────────

type FluvioRecord struct {
	Topic   string `json:"topic"`
	Key     string `json:"key"`
	Value   string `json:"value"`
}

// ProduceFluvio sends a record to a Fluvio topic via the HTTP gateway.
func ProduceFluvio(ctx context.Context, cfg Config, topic, key, value string) error {
	url := fmt.Sprintf("%s/produce", cfg.FluvioGatewayURL)
	if err := postJSON(url, FluvioRecord{Topic: topic, Key: key, Value: value}); err != nil {
		log.Printf("[Fluvio] WARN: failed to produce to %s: %v (degraded mode)", topic, err)
		return nil
	}
	return nil
}

// ── TigerBeetle Ledger ────────────────────────────────────────────────────────

type TigerBeetleTransfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debitAccountId"`
	CreditAccountID string `json:"creditAccountId"`
	Amount          int64  `json:"amount"`
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	UserData        string `json:"userData"`
}

// RecordLedgerEntry posts a double-entry to TigerBeetle via the rust-tigerbeetle-service.
func RecordLedgerEntry(ctx context.Context, cfg Config, transfer TigerBeetleTransfer) error {
	url := fmt.Sprintf("http://localhost:8096/transfers")
	if err := postJSON(url, transfer); err != nil {
		log.Printf("[TigerBeetle] WARN: failed to record ledger entry %s: %v (degraded mode)", transfer.ID, err)
		return nil
	}
	return nil
}

// ── OpenSearch Indexing ───────────────────────────────────────────────────────

// IndexTransfer indexes a transfer document in OpenSearch for search and analytics.
func IndexTransfer(ctx context.Context, cfg Config, index, docID string, doc map[string]any) error {
	url := fmt.Sprintf("%s/%s/_doc/%s", cfg.OpenSearchURL, index, docID)
	body, _ := json.Marshal(doc)
	req, _ := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[OpenSearch] WARN: failed to index %s/%s: %v (degraded mode)", index, docID, err)
		return nil
	}
	defer resp.Body.Close()
	return nil
}

// ── Redis Idempotency ─────────────────────────────────────────────────────────

// CheckIdempotency checks if a transfer ID has already been processed.
// Returns true if already processed (duplicate), false if new.
func CheckIdempotency(ctx context.Context, cfg Config, transferID string) (bool, error) {
	url := fmt.Sprintf("http://localhost:8097/idempotency/%s", transferID)
	resp, err := httpClient.Get(url)
	if err != nil {
		log.Printf("[Redis] WARN: idempotency check failed for %s: %v (allowing)", transferID, err)
		return false, nil // fail open
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200, nil
}

// MarkProcessed marks a transfer ID as processed in Redis with TTL.
func MarkProcessed(ctx context.Context, cfg Config, transferID string, ttlSeconds int) error {
	url := fmt.Sprintf("http://localhost:8097/idempotency/%s?ttl=%d", transferID, ttlSeconds)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[Redis] WARN: failed to mark processed %s: %v", transferID, err)
		return nil
	}
	defer resp.Body.Close()
	return nil
}

// ── Lakehouse ETL ─────────────────────────────────────────────────────────────

type LakehouseEvent struct {
	Source    string         `json:"source"`
	EventType string         `json:"eventType"`
	Timestamp string         `json:"timestamp"`
	Data      map[string]any `json:"data"`
}

// EmitLakehouseEvent sends a transfer event to the Lakehouse ETL pipeline.
func EmitLakehouseEvent(ctx context.Context, cfg Config, eventType string, data map[string]any) error {
	event := LakehouseEvent{
		Source:    cfg.ServiceName,
		EventType: eventType,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Data:      data,
	}
	url := fmt.Sprintf("%s/events", cfg.LakehouseURL)
	if err := postJSON(url, event); err != nil {
		log.Printf("[Lakehouse] WARN: failed to emit %s event: %v (degraded mode)", eventType, err)
		return nil
	}
	return nil
}

// ── Temporal Workflow Trigger ─────────────────────────────────────────────────

type TemporalWorkflowRequest struct {
	WorkflowType string         `json:"workflowType"`
	WorkflowID   string         `json:"workflowId"`
	TaskQueue    string         `json:"taskQueue"`
	Input        map[string]any `json:"input"`
}

// TriggerTemporalWorkflow starts a Temporal workflow via the go-temporal-worker HTTP API.
func TriggerTemporalWorkflow(ctx context.Context, cfg Config, req TemporalWorkflowRequest) error {
	url := "http://localhost:8098/workflows/start"
	if err := postJSON(url, req); err != nil {
		log.Printf("[Temporal] WARN: failed to trigger workflow %s: %v (degraded mode)", req.WorkflowType, err)
		return nil
	}
	return nil
}

// ── Permify Authorization ─────────────────────────────────────────────────────

type PermifyCheckRequest struct {
	TenantID string `json:"tenantId"`
	Entity   struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	} `json:"entity"`
	Permission string `json:"permission"`
	Subject    struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	} `json:"subject"`
}

// CheckPermission verifies if a subject has permission on an entity via Permify.
// Returns true (allowed) on error to avoid blocking payments in degraded mode.
func CheckPermission(ctx context.Context, cfg Config, req PermifyCheckRequest) (bool, error) {
	url := "http://localhost:8099/permify/check"
	body, _ := json.Marshal(req)
	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("[Permify] WARN: permission check failed: %v (allowing)", err)
		return true, nil // fail open for payments
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200, nil
}

// ── Keycloak JWT Validation ───────────────────────────────────────────────────

// ValidateKeycloakToken validates a JWT token via the python-keycloak-service.
func ValidateKeycloakToken(ctx context.Context, cfg Config, token string) (map[string]any, error) {
	url := "http://localhost:8100/keycloak/validate"
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("keycloak validation failed: %w", err)
	}
	defer resp.Body.Close()
	var claims map[string]any
	json.NewDecoder(resp.Body).Decode(&claims)
	return claims, nil
}

// ── Auth Middleware (net/http) ────────────────────────────────────────────────

// AuthMiddleware validates the Authorization header (Bearer JWT or internal API key).
// Fail-closed: returns 401 if no valid credential is presented.
func AuthMiddleware(cfg Config, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || r.URL.Path == "/healthz" || r.URL.Path == "/ready" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		internalKey := os.Getenv("INTERNAL_SERVICE_KEY")
		if internalKey == "" {
			internalKey = "remitflow-internal-2026"
		}
		apiKey := r.Header.Get("X-API-Key")
		if apiKey == internalKey {
			next.ServeHTTP(w, r)
			return
		}
		if len(auth) > 7 && auth[:7] == "Bearer " {
			token := auth[7:]
			if token == internalKey {
				next.ServeHTTP(w, r)
				return
			}
			claims, err := ValidateKeycloakToken(r.Context(), cfg, token)
			if err == nil && claims != nil {
				next.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"unauthorized","message":"valid Bearer token or X-API-Key required"}`))
	})
}

// GinAuthMiddleware returns a Gin-compatible middleware that validates credentials.
func GinAuthMiddleware(cfg Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return AuthMiddleware(cfg, next)
	}
}
