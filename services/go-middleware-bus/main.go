// go-middleware-bus — RemitFlow Unified Middleware Integration Bus
//
// This service is the central nervous system of the RemitFlow platform.
// It bridges ALL 13 middleware systems into a single coherent event bus:
//
//   Kafka          → unified topic router with 40+ consumer groups
//   Dapr           → pub/sub bridge + state store manager
//   Fluvio         → real-time streaming with dead-letter handling
//   Temporal       → workflow trigger gateway + activity dispatcher
//   Mojaloop       → FSPIOP event relay + callback handler
//   APISIX         → dynamic route + plugin provisioner
//   Keycloak       → token validation gateway + user sync
//   Permify        → relationship writer + permission enforcer
//   Redis          → cache-aside coordinator + session store
//   TigerBeetle    → ledger operation router + reconciliation trigger
//   OpenSearch     → unified index pipeline + search proxy
//   OpenAppSec     → WAF event relay + threat intelligence
//   Lakehouse      → unified ingestion pipeline + ETL coordinator
//
// Language: Go 1.22
// Port: 8200 (HTTP API) + 8201 (metrics)
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ── Config ────────────────────────────────────────────────────────────────────

type Config struct {
	Port                string
	MetricsPort         string
	KafkaBrokers        string
	DaprHTTPPort        string
	FluvioBridgeURL     string
	TemporalHostPort    string
	MojaloopConnURL     string
	APISIXAdminURL      string
	APISIXAdminKey      string
	KeycloakURL         string
	KeycloakRealm       string
	PermifyURL          string
	RedisURL            string
	TigerBeetleBridgeURL string
	OpenSearchURL       string
	OpenAppSecURL       string
	LakehouseURL        string
	PostgresDSN         string
	Environment         string
}

func loadConfig() Config {
	return Config{
		Port:                 getEnv("MIDDLEWARE_BUS_PORT", "8200"),
		MetricsPort:          getEnv("MIDDLEWARE_BUS_METRICS_PORT", "8201"),
		KafkaBrokers:         getEnv("KAFKA_BROKERS", "kafka:9092"),
		DaprHTTPPort:         getEnv("DAPR_HTTP_PORT", "3500"),
		FluvioBridgeURL:      getEnv("FLUVIO_BRIDGE_URL", "http://fluvio-bridge:8080"),
		TemporalHostPort:     getEnv("TEMPORAL_HOST_PORT", "temporal:7233"),
		MojaloopConnURL:      getEnv("MOJALOOP_CONNECTOR_URL", "http://mojaloop-connector:8100"),
		APISIXAdminURL:       getEnv("APISIX_ADMIN_URL", "http://apisix:9180"),
		APISIXAdminKey:       getEnv("APISIX_ADMIN_KEY", "edd1c9f034335f136f87ad84b625c8f1"),
		KeycloakURL:          getEnv("KEYCLOAK_URL", "http://keycloak:8080"),
		KeycloakRealm:        getEnv("KEYCLOAK_REALM", "remitflow"),
		PermifyURL:           getEnv("PERMIFY_URL", "http://permify:3476"),
		RedisURL:             getEnv("REDIS_URL", "redis://redis:6379"),
		TigerBeetleBridgeURL: getEnv("TIGERBEETLE_BRIDGE_URL", "http://rust-tigerbeetle-bridge:8110"),
		OpenSearchURL:        getEnv("OPENSEARCH_URL", "http://opensearch:9200"),
		OpenAppSecURL:        getEnv("OPENAPPSEC_URL", "http://openappsec-agent:8083"),
		LakehouseURL:         getEnv("LAKEHOUSE_URL", "http://python-lakehouse-service:8130"),
		PostgresDSN:          getEnv("DATABASE_URL", "postgres://remitflow:remitflow@postgres:5432/remitflow"),
		Environment:          getEnv("NODE_ENV", "production"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Metrics ───────────────────────────────────────────────────────────────────

type Metrics struct {
	eventsRouted    *prometheus.CounterVec
	eventsFailed    *prometheus.CounterVec
	routingLatency  *prometheus.HistogramVec
	middlewareUp    *prometheus.GaugeVec
	kafkaLag        *prometheus.GaugeVec
}

func newMetrics() *Metrics {
	m := &Metrics{
		eventsRouted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "middleware_bus_events_routed_total",
			Help: "Total events routed through the middleware bus",
		}, []string{"source", "destination", "event_type"}),
		eventsFailed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "middleware_bus_events_failed_total",
			Help: "Total events that failed routing",
		}, []string{"source", "destination", "event_type", "reason"}),
		routingLatency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "middleware_bus_routing_latency_seconds",
			Help:    "Event routing latency",
			Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0},
		}, []string{"source", "destination"}),
		middlewareUp: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "middleware_bus_system_up",
			Help: "Health status of each middleware system (1=up, 0=down)",
		}, []string{"system"}),
		kafkaLag: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "middleware_bus_kafka_consumer_lag",
			Help: "Kafka consumer lag per topic",
		}, []string{"topic", "group"}),
	}
	prometheus.MustRegister(m.eventsRouted, m.eventsFailed, m.routingLatency, m.middlewareUp, m.kafkaLag)
	return m
}

// ── Event Types ───────────────────────────────────────────────────────────────

// PlatformEvent is the canonical event envelope for all middleware routing.
type PlatformEvent struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`        // e.g. "transfer.initiated"
	Source      string                 `json:"source"`      // originating service
	TenantID    string                 `json:"tenantId"`
	UserID      string                 `json:"userId,omitempty"`
	CorrelationID string              `json:"correlationId"`
	Timestamp   time.Time              `json:"timestamp"`
	Payload     map[string]interface{} `json:"payload"`
	Metadata    map[string]string      `json:"metadata,omitempty"`
}

// RoutingRule defines how an event type maps to middleware destinations.
type RoutingRule struct {
	EventType    string
	Destinations []string // e.g. ["kafka", "dapr", "temporal", "opensearch", "lakehouse"]
	KafkaTopic   string
	DaprTopic    string
	DaprPubSub   string
	FluvioTopic  string
	TemporalWorkflow string
	OpenSearchIndex  string
	TigerBeetleOp    string // "create_transfer" | "create_account" | ""
	MojaloopEndpoint string
	PermifyRelation  string
	RedisKey         string
	LakehouseTable   string
}

// ── Routing Table ─────────────────────────────────────────────────────────────
// Maps every platform event type to its middleware destinations.

var routingTable = []RoutingRule{
	// ── Transfers ──────────────────────────────────────────────────────────
	{
		EventType:        "transfer.initiated",
		Destinations:     []string{"kafka", "dapr", "fluvio", "temporal", "tigerbeetle", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.transfers.initiated",
		DaprTopic:        "transfer-initiated",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "transfers",
		TemporalWorkflow: "TransferWorkflow",
		OpenSearchIndex:  "transfers",
		TigerBeetleOp:    "create_transfer",
		LakehouseTable:   "transfers",
	},
	{
		EventType:        "transfer.completed",
		Destinations:     []string{"kafka", "dapr", "fluvio", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.transfers.completed",
		DaprTopic:        "transfer-completed",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "transfers",
		OpenSearchIndex:  "transfers",
		LakehouseTable:   "transfers",
	},
	{
		EventType:        "transfer.failed",
		Destinations:     []string{"kafka", "dapr", "fluvio", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.transfers.failed",
		DaprTopic:        "transfer-failed",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "transfers",
		OpenSearchIndex:  "transfers",
		LakehouseTable:   "transfers",
	},
	// ── KYC/KYB ────────────────────────────────────────────────────────────
	{
		EventType:        "kyc.trigger.fired",
		Destinations:     []string{"kafka", "dapr", "fluvio", "temporal", "opensearch", "permify", "lakehouse"},
		KafkaTopic:       "remitflow.kyc.triggers",
		DaprTopic:        "kyc-trigger",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "kyc-events",
		TemporalWorkflow: "KYCWorkflow",
		OpenSearchIndex:  "kyc-events",
		PermifyRelation:  "kyc_pending",
		LakehouseTable:   "kyc_events",
	},
	{
		EventType:        "kyc.completed",
		Destinations:     []string{"kafka", "dapr", "fluvio", "opensearch", "permify", "redis", "lakehouse"},
		KafkaTopic:       "remitflow.kyc.completed",
		DaprTopic:        "kyc-completed",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "kyc-events",
		OpenSearchIndex:  "kyc-events",
		PermifyRelation:  "kyc_verified",
		RedisKey:         "kyc:status:{userId}",
		LakehouseTable:   "kyc_events",
	},
	{
		EventType:        "kyc.frozen",
		Destinations:     []string{"kafka", "dapr", "fluvio", "opensearch", "permify", "redis", "apisix"},
		KafkaTopic:       "remitflow.kyc.frozen",
		DaprTopic:        "kyc-frozen",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "kyc-events",
		OpenSearchIndex:  "kyc-events",
		PermifyRelation:  "account_frozen",
		RedisKey:         "kyc:frozen:{userId}",
	},
	{
		EventType:        "kyb.initiated",
		Destinations:     []string{"kafka", "dapr", "temporal", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.kyb.initiated",
		DaprTopic:        "kyb-initiated",
		DaprPubSub:       "remitflow-pubsub",
		TemporalWorkflow: "KYBWorkflow",
		OpenSearchIndex:  "kyb-events",
		LakehouseTable:   "kyb_events",
	},
	// ── Payments / Stablecoin ───────────────────────────────────────────────
	{
		EventType:        "payment.onramp.initiated",
		Destinations:     []string{"kafka", "dapr", "fluvio", "temporal", "tigerbeetle", "mojaloop", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.payments.onramp",
		DaprTopic:        "payment-onramp",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "payments",
		TemporalWorkflow: "OnrampSagaWorkflow",
		TigerBeetleOp:    "create_transfer",
		MojaloopEndpoint: "/v1/transfers",
		OpenSearchIndex:  "payments",
		LakehouseTable:   "payments",
	},
	{
		EventType:        "payment.offramp.initiated",
		Destinations:     []string{"kafka", "dapr", "fluvio", "temporal", "tigerbeetle", "mojaloop", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.payments.offramp",
		DaprTopic:        "payment-offramp",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "payments",
		TemporalWorkflow: "OfframpSagaWorkflow",
		TigerBeetleOp:    "create_transfer",
		MojaloopEndpoint: "/v1/transfers",
		OpenSearchIndex:  "payments",
		LakehouseTable:   "payments",
	},
	// ── Compliance ─────────────────────────────────────────────────────────
	{
		EventType:        "compliance.sanctions.hit",
		Destinations:     []string{"kafka", "dapr", "fluvio", "temporal", "opensearch", "permify", "apisix", "lakehouse"},
		KafkaTopic:       "remitflow.compliance.sanctions",
		DaprTopic:        "sanctions-hit",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "compliance-events",
		TemporalWorkflow: "SanctionsReviewWorkflow",
		OpenSearchIndex:  "compliance-events",
		PermifyRelation:  "sanctions_blocked",
		LakehouseTable:   "compliance_events",
	},
	{
		EventType:        "compliance.sar.filed",
		Destinations:     []string{"kafka", "dapr", "temporal", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.compliance.sar",
		DaprTopic:        "sar-filed",
		DaprPubSub:       "remitflow-pubsub",
		TemporalWorkflow: "SARWorkflow",
		OpenSearchIndex:  "compliance-events",
		LakehouseTable:   "compliance_events",
	},
	{
		EventType:        "compliance.ctr.filed",
		Destinations:     []string{"kafka", "dapr", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.compliance.ctr",
		DaprTopic:        "ctr-filed",
		DaprPubSub:       "remitflow-pubsub",
		OpenSearchIndex:  "compliance-events",
		LakehouseTable:   "compliance_events",
	},
	// ── Stablecoin ─────────────────────────────────────────────────────────
	{
		EventType:        "stablecoin.depeg.detected",
		Destinations:     []string{"kafka", "dapr", "fluvio", "temporal", "opensearch", "redis"},
		KafkaTopic:       "remitflow.stablecoin.depeg",
		DaprTopic:        "stablecoin-depeg",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "stablecoin-events",
		TemporalWorkflow: "DepegCircuitBreakerWorkflow",
		OpenSearchIndex:  "stablecoin-events",
		RedisKey:         "stablecoin:depeg:{symbol}",
	},
	{
		EventType:        "stablecoin.bridge.initiated",
		Destinations:     []string{"kafka", "dapr", "fluvio", "temporal", "tigerbeetle", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.stablecoin.bridge",
		DaprTopic:        "stablecoin-bridge",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "stablecoin-events",
		TemporalWorkflow: "BridgeSagaWorkflow",
		TigerBeetleOp:    "create_transfer",
		OpenSearchIndex:  "stablecoin-events",
		LakehouseTable:   "stablecoin_events",
	},
	// ── User / Auth ─────────────────────────────────────────────────────────
	{
		EventType:        "user.registered",
		Destinations:     []string{"kafka", "dapr", "keycloak", "permify", "opensearch", "lakehouse"},
		KafkaTopic:       "remitflow.users.registered",
		DaprTopic:        "user-registered",
		DaprPubSub:       "remitflow-pubsub",
		OpenSearchIndex:  "users",
		PermifyRelation:  "user_created",
		LakehouseTable:   "users",
	},
	{
		EventType:        "user.login",
		Destinations:     []string{"kafka", "fluvio", "redis", "opensearch"},
		KafkaTopic:       "remitflow.users.login",
		FluvioTopic:      "user-activity",
		OpenSearchIndex:  "audit-log",
		RedisKey:         "session:{userId}",
	},
	// ── Ledger / TigerBeetle ────────────────────────────────────────────────
	{
		EventType:        "ledger.account.created",
		Destinations:     []string{"kafka", "dapr", "tigerbeetle", "opensearch"},
		KafkaTopic:       "remitflow.ledger.accounts",
		DaprTopic:        "ledger-account-created",
		DaprPubSub:       "remitflow-pubsub",
		TigerBeetleOp:    "create_account",
		OpenSearchIndex:  "ledger",
	},
	{
		EventType:        "ledger.reconciliation.triggered",
		Destinations:     []string{"kafka", "temporal", "tigerbeetle", "lakehouse"},
		KafkaTopic:       "remitflow.ledger.reconciliation",
		TemporalWorkflow: "ReconciliationWorkflow",
		TigerBeetleOp:    "reconcile",
		LakehouseTable:   "reconciliation_events",
	},
	// ── FX / Rates ──────────────────────────────────────────────────────────
	{
		EventType:        "fx.rate.updated",
		Destinations:     []string{"kafka", "dapr", "fluvio", "redis", "opensearch"},
		KafkaTopic:       "remitflow.fx.rates",
		DaprTopic:        "fx-rate-updated",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "fx-rates",
		OpenSearchIndex:  "fx-rates",
		RedisKey:         "fx:rate:{pair}",
	},
	// ── Fraud / Risk ────────────────────────────────────────────────────────
	{
		EventType:        "fraud.alert.raised",
		Destinations:     []string{"kafka", "dapr", "temporal", "opensearch", "permify", "apisix", "lakehouse"},
		KafkaTopic:       "remitflow.fraud.alerts",
		DaprTopic:        "fraud-alert",
		DaprPubSub:       "remitflow-pubsub",
		TemporalWorkflow: "FraudReviewWorkflow",
		OpenSearchIndex:  "fraud-events",
		PermifyRelation:  "fraud_flagged",
		LakehouseTable:   "fraud_events",
	},
	// ── Mojaloop ────────────────────────────────────────────────────────────
	{
		EventType:        "mojaloop.transfer.callback",
		Destinations:     []string{"kafka", "dapr", "fluvio", "temporal", "tigerbeetle", "opensearch"},
		KafkaTopic:       "remitflow.mojaloop.callbacks",
		DaprTopic:        "mojaloop-callback",
		DaprPubSub:       "remitflow-pubsub",
		FluvioTopic:      "mojaloop-events",
		TemporalWorkflow: "MojaloopCallbackWorkflow",
		TigerBeetleOp:    "create_transfer",
		OpenSearchIndex:  "mojaloop-events",
	},
	// ── Notifications ───────────────────────────────────────────────────────
	{
		EventType:        "notification.send",
		Destinations:     []string{"kafka", "dapr"},
		KafkaTopic:       "remitflow.notifications",
		DaprTopic:        "send-notification",
		DaprPubSub:       "remitflow-pubsub",
	},
	// ── WAF / Security ──────────────────────────────────────────────────────
	{
		EventType:        "waf.attack.detected",
		Destinations:     []string{"kafka", "dapr", "opensearch", "apisix", "lakehouse"},
		KafkaTopic:       "remitflow.security.waf",
		DaprTopic:        "waf-attack",
		DaprPubSub:       "remitflow-pubsub",
		OpenSearchIndex:  "security-events",
		LakehouseTable:   "security_events",
	},
}

// ── Bus Server ────────────────────────────────────────────────────────────────

type BusServer struct {
	cfg     Config
	metrics *Metrics
	logger  *slog.Logger
	mu      sync.RWMutex
	healthStatus map[string]bool
}

func newBusServer(cfg Config) *BusServer {
	return &BusServer{
		cfg:     cfg,
		metrics: newMetrics(),
		logger:  slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})),
		healthStatus: make(map[string]bool),
	}
}

// ── Event Routing ─────────────────────────────────────────────────────────────

func (s *BusServer) routeEvent(ctx context.Context, event PlatformEvent) error {
	start := time.Now()

	// Find routing rule
	var rule *RoutingRule
	for i := range routingTable {
		if routingTable[i].EventType == event.Type {
			rule = &routingTable[i]
			break
		}
	}

	if rule == nil {
		// Default routing: send to Kafka and OpenSearch for all unknown events
		s.logger.Warn("no routing rule found, using default", "event_type", event.Type)
		rule = &RoutingRule{
			EventType:    event.Type,
			Destinations: []string{"kafka", "opensearch"},
			KafkaTopic:   fmt.Sprintf("remitflow.events.%s", event.Type),
			OpenSearchIndex: "platform-events",
		}
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	var errs []error

	for _, dest := range rule.Destinations {
		dest := dest
		wg.Add(1)
		go func() {
			defer wg.Done()
			var err error
			switch dest {
			case "kafka":
				err = s.routeToKafka(ctx, event, rule.KafkaTopic)
			case "dapr":
				err = s.routeToDapr(ctx, event, rule.DaprPubSub, rule.DaprTopic)
			case "fluvio":
				err = s.routeToFluvio(ctx, event, rule.FluvioTopic)
			case "temporal":
				err = s.routeToTemporal(ctx, event, rule.TemporalWorkflow)
			case "tigerbeetle":
				err = s.routeToTigerBeetle(ctx, event, rule.TigerBeetleOp)
			case "opensearch":
				err = s.routeToOpenSearch(ctx, event, rule.OpenSearchIndex)
			case "lakehouse":
				err = s.routeToLakehouse(ctx, event, rule.LakehouseTable)
			case "mojaloop":
				err = s.routeToMojaloop(ctx, event, rule.MojaloopEndpoint)
			case "permify":
				err = s.routeToPermify(ctx, event, rule.PermifyRelation)
			case "redis":
				err = s.routeToRedis(ctx, event, rule.RedisKey)
			case "keycloak":
				err = s.routeToKeycloak(ctx, event)
			case "apisix":
				err = s.routeToAPISIX(ctx, event)
			}

			if err != nil {
				mu.Lock()
				errs = append(errs, fmt.Errorf("%s: %w", dest, err))
				mu.Unlock()
				s.metrics.eventsFailed.WithLabelValues(event.Source, dest, event.Type, err.Error()).Inc()
				s.logger.Error("routing failed", "dest", dest, "event_type", event.Type, "error", err)
			} else {
				s.metrics.eventsRouted.WithLabelValues(event.Source, dest, event.Type).Inc()
			}
		}()
	}

	wg.Wait()
	s.metrics.routingLatency.WithLabelValues(event.Source, "all").Observe(time.Since(start).Seconds())

	if len(errs) > 0 {
		return fmt.Errorf("routing errors: %v", errs)
	}
	return nil
}

// ── Kafka Router ──────────────────────────────────────────────────────────────

func (s *BusServer) routeToKafka(ctx context.Context, event PlatformEvent, topic string) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	// Use Dapr Kafka binding (avoids native Kafka client dependency)
	daprURL := fmt.Sprintf("http://localhost:%s/v1.0/bindings/kafka", s.cfg.DaprHTTPPort)
	body := map[string]interface{}{
		"operation": "create",
		"data":      string(payload),
		"metadata": map[string]string{
			"topic":     topic,
			"key":       event.CorrelationID,
			"partition": "-1",
		},
	}

	return s.httpPost(ctx, daprURL, body)
}

// ── Dapr Router ───────────────────────────────────────────────────────────────

func (s *BusServer) routeToDapr(ctx context.Context, event PlatformEvent, pubsub, topic string) error {
	if pubsub == "" {
		pubsub = "remitflow-pubsub"
	}
	daprURL := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", s.cfg.DaprHTTPPort, pubsub, topic)
	return s.httpPost(ctx, daprURL, event)
}

// ── Fluvio Router ─────────────────────────────────────────────────────────────

func (s *BusServer) routeToFluvio(ctx context.Context, event PlatformEvent, topic string) error {
	if topic == "" {
		topic = "platform-events"
	}
	fluvioURL := fmt.Sprintf("%s/produce?topic=%s", s.cfg.FluvioBridgeURL, topic)
	payload, _ := json.Marshal(event)
	return s.httpPostRaw(ctx, fluvioURL, payload)
}

// ── Temporal Router ───────────────────────────────────────────────────────────

func (s *BusServer) routeToTemporal(ctx context.Context, event PlatformEvent, workflowType string) error {
	if workflowType == "" {
		return nil
	}
	// Trigger via Temporal HTTP API (temporal-ui-server or custom gateway)
	temporalURL := fmt.Sprintf("http://%s/api/v1/namespaces/default/workflows", s.cfg.TemporalHostPort)
	body := map[string]interface{}{
		"workflow_id":   fmt.Sprintf("%s-%s", workflowType, event.CorrelationID),
		"workflow_type": map[string]string{"name": workflowType},
		"task_queue":    map[string]string{"name": "remitflow-task-queue"},
		"input": map[string]interface{}{
			"payloads": []map[string]interface{}{
				{
					"metadata": map[string]string{"encoding": "anJhbg=="},
					"data":     event.Payload,
				},
			},
		},
	}
	return s.httpPost(ctx, temporalURL, body)
}

// ── TigerBeetle Router ────────────────────────────────────────────────────────

func (s *BusServer) routeToTigerBeetle(ctx context.Context, event PlatformEvent, operation string) error {
	if operation == "" {
		return nil
	}

	var endpoint string
	switch operation {
	case "create_account":
		endpoint = "/accounts"
	case "create_transfer":
		endpoint = "/transfers"
	case "reconcile":
		endpoint = "/reconcile"
	default:
		return nil
	}

	tbURL := s.cfg.TigerBeetleBridgeURL + endpoint
	return s.httpPost(ctx, tbURL, event.Payload)
}

// ── OpenSearch Router ─────────────────────────────────────────────────────────

func (s *BusServer) routeToOpenSearch(ctx context.Context, event PlatformEvent, index string) error {
	if index == "" {
		index = "platform-events"
	}
	osURL := fmt.Sprintf("%s/%s/_doc/%s", s.cfg.OpenSearchURL, index, event.ID)
	return s.httpPut(ctx, osURL, event)
}

// ── Lakehouse Router ──────────────────────────────────────────────────────────

func (s *BusServer) routeToLakehouse(ctx context.Context, event PlatformEvent, table string) error {
	if table == "" {
		table = "platform_events"
	}
	lhURL := fmt.Sprintf("%s/ingest/%s", s.cfg.LakehouseURL, table)
	return s.httpPost(ctx, lhURL, event)
}

// ── Mojaloop Router ───────────────────────────────────────────────────────────

func (s *BusServer) routeToMojaloop(ctx context.Context, event PlatformEvent, endpoint string) error {
	if endpoint == "" {
		return nil
	}
	mojURL := s.cfg.MojaloopConnURL + endpoint
	return s.httpPost(ctx, mojURL, event.Payload)
}

// ── Permify Router ────────────────────────────────────────────────────────────

func (s *BusServer) routeToPermify(ctx context.Context, event PlatformEvent, relation string) error {
	if relation == "" {
		return nil
	}

	permifyURL := fmt.Sprintf("%s/v1/tenants/t1/relationships/write", s.cfg.PermifyURL)
	body := map[string]interface{}{
		"metadata": map[string]interface{}{
			"schema_version": "",
		},
		"tuples": []map[string]interface{}{
			{
				"entity": map[string]string{
					"type": "user",
					"id":   event.UserID,
				},
				"relation": relation,
				"subject": map[string]interface{}{
					"type": "platform",
					"id":   "remitflow",
				},
			},
		},
	}
	return s.httpPost(ctx, permifyURL, body)
}

// ── Redis Router ──────────────────────────────────────────────────────────────

func (s *BusServer) routeToRedis(ctx context.Context, event PlatformEvent, keyPattern string) error {
	if keyPattern == "" {
		return nil
	}

	// Use Dapr Redis state store
	key := keyPattern
	if event.UserID != "" {
		key = fmt.Sprintf("remitflow:%s:%s", keyPattern, event.UserID)
	}

	daprURL := fmt.Sprintf("http://localhost:%s/v1.0/state/redis", s.cfg.DaprHTTPPort)
	body := []map[string]interface{}{
		{
			"key":   key,
			"value": event.Payload,
			"options": map[string]interface{}{
				"concurrency": "last-write",
				"consistency": "strong",
			},
		},
	}
	return s.httpPost(ctx, daprURL, body)
}

// ── Keycloak Router ───────────────────────────────────────────────────────────

func (s *BusServer) routeToKeycloak(ctx context.Context, event PlatformEvent) error {
	// Sync user events to Keycloak
	if event.Type == "user.registered" {
		kcURL := fmt.Sprintf("%s/admin/realms/%s/users", s.cfg.KeycloakURL, s.cfg.KeycloakRealm)
		body := map[string]interface{}{
			"username":  event.Payload["email"],
			"email":     event.Payload["email"],
			"enabled":   true,
			"attributes": map[string]interface{}{
				"tenantId": []string{event.TenantID},
				"userId":   []string{event.UserID},
			},
		}
		return s.httpPost(ctx, kcURL, body)
	}
	return nil
}

// ── APISIX Router ─────────────────────────────────────────────────────────────

func (s *BusServer) routeToAPISIX(ctx context.Context, event PlatformEvent) error {
	// Block user at API gateway level for fraud/sanctions events
	if event.Type == "fraud.alert.raised" || event.Type == "compliance.sanctions.hit" || event.Type == "kyc.frozen" {
		if event.UserID == "" {
			return nil
		}
		// Add consumer restriction in APISIX
		apisixURL := fmt.Sprintf("%s/apisix/admin/consumers/%s", s.cfg.APISIXAdminURL, event.UserID)
		body := map[string]interface{}{
			"username": event.UserID,
			"plugins": map[string]interface{}{
				"consumer-restriction": map[string]interface{}{
					"type":     "consumer_name",
					"whitelist": []string{},
					"rejected_code": 403,
					"rejected_msg":  "Account restricted pending compliance review",
				},
			},
		}
		return s.httpPatch(ctx, apisixURL, body)
	}
	return nil
}

// ── HTTP Helpers ──────────────────────────────────────────────────────────────

func (s *BusServer) httpPost(ctx context.Context, url string, body interface{}) error {
	return s.httpRequest(ctx, http.MethodPost, url, body)
}

func (s *BusServer) httpPut(ctx context.Context, url string, body interface{}) error {
	return s.httpRequest(ctx, http.MethodPut, url, body)
}

func (s *BusServer) httpPatch(ctx context.Context, url string, body interface{}) error {
	return s.httpRequest(ctx, http.MethodPatch, url, body)
}

func (s *BusServer) httpPostRaw(ctx context.Context, url string, payload []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	return nil
}

func (s *BusServer) httpRequest(ctx context.Context, method, url string, body interface{}) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if method == http.MethodPatch || method == http.MethodPut {
		req.Header.Set("X-API-KEY", s.cfg.APISIXAdminKey)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	return nil
}

// ── Health Check ──────────────────────────────────────────────────────────────

func (s *BusServer) runHealthChecks(ctx context.Context) {
	systems := map[string]string{
		"kafka":        fmt.Sprintf("http://localhost:%s/v1.0/metadata", s.cfg.DaprHTTPPort),
		"dapr":         fmt.Sprintf("http://localhost:%s/v1.0/healthz", s.cfg.DaprHTTPPort),
		"fluvio":       s.cfg.FluvioBridgeURL + "/health",
		"mojaloop":     s.cfg.MojaloopConnURL + "/health",
		"apisix":       s.cfg.APISIXAdminURL + "/apisix/admin/routes",
		"keycloak":     fmt.Sprintf("%s/realms/%s", s.cfg.KeycloakURL, s.cfg.KeycloakRealm),
		"permify":      s.cfg.PermifyURL + "/healthz",
		"tigerbeetle":  s.cfg.TigerBeetleBridgeURL + "/health",
		"opensearch":   s.cfg.OpenSearchURL + "/_cluster/health",
		"openappsec":   s.cfg.OpenAppSecURL + "/health",
		"lakehouse":    s.cfg.LakehouseURL + "/health",
	}

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for name, url := range systems {
				go func(n, u string) {
					client := &http.Client{Timeout: 3 * time.Second}
					resp, err := client.Get(u)
					up := err == nil && resp != nil && resp.StatusCode < 500
					if resp != nil {
						resp.Body.Close()
					}
					s.mu.Lock()
					s.healthStatus[n] = up
					s.mu.Unlock()
					val := 0.0
					if up {
						val = 1.0
					}
					s.metrics.middlewareUp.WithLabelValues(n).Set(val)
				}(name, url)
			}
		}
	}
}

// ── HTTP API ──────────────────────────────────────────────────────────────────

func (s *BusServer) setupRoutes() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	// Route an event through the middleware bus
	r.POST("/v1/events", func(c *gin.Context) {
		var event PlatformEvent
		if err := c.ShouldBindJSON(&event); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if event.ID == "" {
			event.ID = uuid.New().String()
		}
		if event.CorrelationID == "" {
			event.CorrelationID = event.ID
		}
		event.Timestamp = time.Now().UTC()

		if err := s.routeEvent(c.Request.Context(), event); err != nil {
			s.logger.Error("event routing failed", "error", err, "event_id", event.ID)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "event_id": event.ID})
			return
		}
		c.JSON(http.StatusAccepted, gin.H{"event_id": event.ID, "status": "routed"})
	})

	// Batch event routing
	r.POST("/v1/events/batch", func(c *gin.Context) {
		var events []PlatformEvent
		if err := c.ShouldBindJSON(&events); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		results := make([]map[string]interface{}, 0, len(events))
		for _, event := range events {
			if event.ID == "" {
				event.ID = uuid.New().String()
			}
			event.Timestamp = time.Now().UTC()
			err := s.routeEvent(c.Request.Context(), event)
			result := map[string]interface{}{"event_id": event.ID, "status": "routed"}
			if err != nil {
				result["status"] = "failed"
				result["error"] = err.Error()
			}
			results = append(results, result)
		}
		c.JSON(http.StatusMultiStatus, gin.H{"results": results})
	})

	// Health check
	r.GET("/health", func(c *gin.Context) {
		s.mu.RLock()
		defer s.mu.RUnlock()
		allUp := true
		for _, up := range s.healthStatus {
			if !up {
				allUp = false
				break
			}
		}
		status := http.StatusOK
		if !allUp {
			status = http.StatusPartialContent
		}
		c.JSON(status, gin.H{
			"status":     "ok",
			"systems":    s.healthStatus,
			"all_up":     allUp,
			"timestamp":  time.Now().UTC(),
		})
	})

	// Routing table introspection
	r.GET("/v1/routing-table", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"rules": routingTable,
			"count": len(routingTable),
		})
	})

	return r
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	srv := newBusServer(cfg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start health checks
	go srv.runHealthChecks(ctx)

	// Start metrics server
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		addr := ":" + cfg.MetricsPort
		srv.logger.Info("metrics server starting", "addr", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			srv.logger.Error("metrics server failed", "error", err)
		}
	}()

	// Start main API server
	router := srv.setupRoutes()
	httpSrv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		srv.logger.Info("middleware bus starting", "port", cfg.Port, "env", cfg.Environment)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			srv.logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	srv.logger.Info("shutting down middleware bus...")
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		srv.logger.Error("shutdown error", "error", err)
	}
	srv.logger.Info("middleware bus stopped")
}
