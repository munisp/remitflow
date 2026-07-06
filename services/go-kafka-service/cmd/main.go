// RemitFlow — Kafka Event Bus Service (Go)
// Implements Kafka producers and consumers for all RemitFlow domain events.
// Topics: transfers, compliance, fx-alerts, notifications, audit, payment-rails
//
// Uses: github.com/IBM/sarama (Kafka client)
// Broker: kafka:9092 (default)

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/IBM/sarama"
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
)

// ─── Topic Definitions ────────────────────────────────────────────────────────
const (
	TopicTransferInitiated   = "remitflow.transfers.initiated"
	TopicTransferCompleted   = "remitflow.transfers.completed"
	TopicTransferFailed      = "remitflow.transfers.failed"
	TopicComplianceAlert     = "remitflow.compliance.alerts"
	TopicAMLFlag             = "remitflow.compliance.aml-flags"
	TopicFXAlert             = "remitflow.fx.alerts"
	TopicFXRate              = "remitflow.fx.rates"
	TopicNotification        = "remitflow.notifications"
	TopicAuditLog            = "remitflow.audit.logs"
	TopicKYCUpdate           = "remitflow.kyc.updates"
	TopicPaymentRailCIPS     = "remitflow.rails.cips"
	TopicPaymentRailUPI      = "remitflow.rails.upi"
	TopicPaymentRailPIX      = "remitflow.rails.pix"
	TopicPaymentRailMojaloop = "remitflow.rails.mojaloop"
	TopicSettlement          = "remitflow.settlement"
	TopicWebhook             = "remitflow.webhooks"
	TopicDLQ                 = "remitflow.dlq" // Dead Letter Queue

	// Core fund flow topics (from coreAtomicity middleware)
	TopicSavingsDeposit  = "remitflow.savings.deposit"
	TopicSavingsWithdraw = "remitflow.savings.withdraw"
	TopicCBDCTransfer    = "remitflow.cbdc.transfer"
	TopicCBDCReceive     = "remitflow.cbdc.receive"
	TopicBillPayment     = "remitflow.bill.payment"
	TopicAirtimeTopup    = "remitflow.airtime.topup"
	TopicBatchPayment    = "remitflow.batch.payment"
	TopicWalletTopup     = "remitflow.wallet.topup"
	TopicWalletWithdraw  = "remitflow.wallet.withdraw"
	TopicStablecoinSwap    = "remitflow.stablecoin.swap"
	TopicStablecoinOnramp  = "remitflow.stablecoin.onramp"
	TopicStablecoinOfframp = "remitflow.stablecoin.offramp"
	TopicStablecoinBridge  = "remitflow.stablecoin.bridge"
	TopicStablecoinYield   = "remitflow.stablecoin.yield"
	TopicFundCompensated   = "remitflow.fund.compensated"
)

var AllTopics = []string{
	TopicTransferInitiated, TopicTransferCompleted, TopicTransferFailed,
	TopicComplianceAlert, TopicAMLFlag, TopicFXAlert, TopicFXRate,
	TopicNotification, TopicAuditLog, TopicKYCUpdate,
	TopicPaymentRailCIPS, TopicPaymentRailUPI, TopicPaymentRailPIX,
	TopicPaymentRailMojaloop, TopicSettlement, TopicWebhook, TopicDLQ,
	TopicSavingsDeposit, TopicSavingsWithdraw,
	TopicCBDCTransfer, TopicCBDCReceive,
	TopicBillPayment, TopicAirtimeTopup, TopicBatchPayment,
	TopicWalletTopup, TopicWalletWithdraw, TopicStablecoinSwap,
	TopicStablecoinOnramp, TopicStablecoinOfframp,
	TopicStablecoinBridge, TopicStablecoinYield, TopicFundCompensated,
}

// ─── Event Types ──────────────────────────────────────────────────────────────
type BaseEvent struct {
	EventID   string          `json:"event_id"`
	EventType string          `json:"event_type"`
	Source    string          `json:"source"`
	Timestamp time.Time       `json:"timestamp"`
	Version   string          `json:"version"`
	Payload   json.RawMessage `json:"payload"`
}

type TransferEvent struct {
	TransactionID string  `json:"transaction_id"`
	UserID        int64   `json:"user_id"`
	Rail          string  `json:"rail"`
	Amount        float64 `json:"amount"`
	FromCurrency  string  `json:"from_currency"`
	ToCurrency    string  `json:"to_currency"`
	Status        string  `json:"status"`
	ExternalRef   string  `json:"external_ref"`
}

type ComplianceEvent struct {
	TransactionID string   `json:"transaction_id"`
	UserID        int64    `json:"user_id"`
	RiskScore     float64  `json:"risk_score"`
	RiskLevel     string   `json:"risk_level"`
	Flags         []string `json:"flags"`
	RequiresSAR   bool     `json:"requires_sar"`
	SanctionsHit  bool     `json:"sanctions_hit"`
}

type FXRateEvent struct {
	FromCurrency string  `json:"from_currency"`
	ToCurrency   string  `json:"to_currency"`
	Rate         float64 `json:"rate"`
	Source       string  `json:"source"`
	Timestamp    int64   `json:"timestamp"`
}

type CoreFundFlowEvent struct {
	EventType     string                 `json:"eventType"`
	TransactionID string                 `json:"transactionId"`
	UserID        int64                  `json:"userId"`
	Amount        float64                `json:"amount"`
	Currency      string                 `json:"currency"`
	Status        string                 `json:"status"`
	Timestamp     string                 `json:"timestamp"`
	Feature       string                 `json:"feature"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

// ─── Producer ─────────────────────────────────────────────────────────────────
type EventProducer struct {
	producer sarama.SyncProducer
	config   *sarama.Config
}

func NewEventProducer(brokers []string) (*EventProducer, error) {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V3_6_0_0
	cfg.Producer.Return.Successes = true
	cfg.Producer.Return.Errors = true
	cfg.Producer.RequiredAcks = sarama.WaitForAll
	cfg.Producer.Retry.Max = 5
	cfg.Producer.Retry.Backoff = 100 * time.Millisecond
	cfg.Producer.Compression = sarama.CompressionSnappy
	cfg.Producer.Idempotent = true
	cfg.Net.MaxOpenRequests = 1

	producer, err := sarama.NewSyncProducer(brokers, cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create Kafka producer: %w", err)
	}
	return &EventProducer{producer: producer, config: cfg}, nil
}

func (p *EventProducer) Publish(topic string, key string, event interface{}) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	msg := &sarama.ProducerMessage{
		Topic:     topic,
		Key:       sarama.StringEncoder(key),
		Value:     sarama.ByteEncoder(payload),
		Timestamp: time.Now(),
		Headers: []sarama.RecordHeader{
			{Key: []byte("source"), Value: []byte("remitflow-core")},
			{Key: []byte("version"), Value: []byte("v110")},
			{Key: []byte("content-type"), Value: []byte("application/json")},
		},
	}
	partition, offset, err := p.producer.SendMessage(msg)
	if err != nil {
		return fmt.Errorf("send error: %w", err)
	}
	log.Printf("[Kafka] Published to %s partition=%d offset=%d key=%s", topic, partition, offset, key)
	return nil
}

func (p *EventProducer) PublishTransferInitiated(tx TransferEvent) error {
	return p.Publish(TopicTransferInitiated, tx.TransactionID, tx)
}

func (p *EventProducer) PublishTransferCompleted(tx TransferEvent) error {
	return p.Publish(TopicTransferCompleted, tx.TransactionID, tx)
}

func (p *EventProducer) PublishComplianceAlert(ev ComplianceEvent) error {
	return p.Publish(TopicComplianceAlert, ev.TransactionID, ev)
}

func (p *EventProducer) PublishFXRate(ev FXRateEvent) error {
	key := fmt.Sprintf("%s-%s", ev.FromCurrency, ev.ToCurrency)
	return p.Publish(TopicFXRate, key, ev)
}

func (p *EventProducer) Close() error {
	return p.producer.Close()
}

// ─── Consumer Group ───────────────────────────────────────────────────────────
type EventConsumer struct {
	group  sarama.ConsumerGroup
	topics []string
}

type ConsumerGroupHandler struct {
	handlers map[string]func([]byte) error
}

func (h *ConsumerGroupHandler) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (h *ConsumerGroupHandler) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }
func (h *ConsumerGroupHandler) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		handler, ok := h.handlers[msg.Topic]
		if ok {
			if err := handler(msg.Value); err != nil {
				log.Printf("[Kafka] Handler error topic=%s: %v", msg.Topic, err)
				// In production: publish to DLQ
			}
		}
		session.MarkMessage(msg, "")
	}
	return nil
}

func NewEventConsumer(brokers []string, groupID string, topics []string) (*EventConsumer, error) {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V3_6_0_0
	cfg.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRoundRobin()}
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest
	cfg.Consumer.Offsets.AutoCommit.Enable = true
	cfg.Consumer.Offsets.AutoCommit.Interval = 1 * time.Second

	group, err := sarama.NewConsumerGroup(brokers, groupID, cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create consumer group: %w", err)
	}
	return &EventConsumer{group: group, topics: topics}, nil
}

func (c *EventConsumer) Consume(ctx context.Context, handlers map[string]func([]byte) error) error {
	handler := &ConsumerGroupHandler{handlers: handlers}
	for {
		if err := c.group.Consume(ctx, c.topics, handler); err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
}

// ─── Topic Admin ──────────────────────────────────────────────────────────────
func EnsureTopics(brokers []string) error {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V3_6_0_0
	admin, err := sarama.NewClusterAdmin(brokers, cfg)
	if err != nil {
		return fmt.Errorf("admin connect error: %w", err)
	}
	defer admin.Close()

	existing, err := admin.ListTopics()
	if err != nil {
		return fmt.Errorf("list topics error: %w", err)
	}

	for _, topic := range AllTopics {
		if _, ok := existing[topic]; ok {
			continue
		}
		detail := &sarama.TopicDetail{
			NumPartitions:     3,
			ReplicationFactor: 1,
			ConfigEntries: map[string]*string{
				"retention.ms":        strPtr("604800000"), // 7 days
				"compression.type":    strPtr("snappy"),
				"cleanup.policy":      strPtr("delete"),
				"min.insync.replicas": strPtr("1"),
			},
		}
		if topic == TopicDLQ {
			detail.ConfigEntries["retention.ms"] = strPtr("2592000000") // 30 days for DLQ
		}
		if err := admin.CreateTopic(topic, detail, false); err != nil {
			log.Printf("[Kafka] Topic %s already exists or error: %v", topic, err)
		} else {
			log.Printf("[Kafka] Created topic: %s", topic)
		}
	}
	return nil
}

func strPtr(s string) *string { return &s }

// ─── Main ─────────────────────────────────────────────────────────────────────

// ── PostgreSQL Persistence Layer ─────────────────────────────────────────────
var db *sql.DB

func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("db connect: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("db ping: %w", err)
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS go_kafka_service_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_go_kafka_service_updated ON go_kafka_service_state(updated_at);
		CREATE TABLE IF NOT EXISTS go_kafka_service_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_go_kafka_service_events_type ON go_kafka_service_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("create tables: %w", err)
	}
	slog.Info("PostgreSQL connected", "service", "go-kafka-service", "table", "go_kafka_service_state")
	return nil
}

func dbUpsert(id string, data interface{}) error {
	if db == nil { return nil }
	jsonData, err := json.Marshal(data)
	if err != nil { return err }
	_, err = db.Exec(`INSERT INTO go_kafka_service_state (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`, id, jsonData)
	return err
}

func dbGet(id string, dest interface{}) error {
	if db == nil { return fmt.Errorf("no db") }
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM go_kafka_service_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil { return err }
	return json.Unmarshal(jsonData, dest)
}

func dbList(limit int) ([]json.RawMessage, error) {
	if db == nil { return nil, nil }
	rows, err := db.Query("SELECT data FROM go_kafka_service_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil { return nil, err }
		results = append(results, data)
	}
	return results, rows.Err()
}

func dbLogEvent(eventType string, payload interface{}) error {
	if db == nil { return nil }
	jsonData, err := json.Marshal(payload)
	if err != nil { return err }
	_, err = db.Exec("INSERT INTO go_kafka_service_events (event_type, payload) VALUES ($1, $2)", eventType, jsonData)
	return err
}
// ── End PostgreSQL Layer ─────────────────────────────────────────────────────

func main() {
	if err := initDB(); err != nil {
		slog.Warn("PostgreSQL init failed, using in-memory fallback", "err", err)
	}

	brokers := []string{os.Getenv("KAFKA_BROKERS")}
	if brokers[0] == "" {
		brokers[0] = "kafka:9092"
	}

	log.Printf("[Kafka] Connecting to brokers: %v", brokers)

	// Ensure all topics exist
	if err := EnsureTopics(brokers); err != nil {
		log.Printf("[Kafka] Topic setup warning: %v (continuing)", err)
	}

	// Create producer
	producer, err := NewEventProducer(brokers)
	if err != nil {
		log.Fatalf("[Kafka] Producer error: %v", err)
	}
	defer producer.Close()

	// Publish startup event
	_ = producer.Publish(TopicAuditLog, "startup", map[string]interface{}{
		"event":     "kafka_service_started",
		"timestamp": time.Now().UTC(),
		"version":   "v110",
	})

	// Start consumer group
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	consumer, err := NewEventConsumer(brokers, "remitflow-core", AllTopics)
	if err != nil {
		log.Fatalf("[Kafka] Consumer error: %v", err)
	}

	coreFundFlowHandler := func(topicLabel string) func([]byte) error {
		return func(data []byte) error {
			var ev CoreFundFlowEvent
			if err := json.Unmarshal(data, &ev); err != nil {
				return err
			}
			log.Printf("[Kafka] %s: txn=%s user=%d amount=%.2f %s status=%s",
				topicLabel, ev.TransactionID, ev.UserID, ev.Amount, ev.Currency, ev.Status)
			_ = dbLogEvent(topicLabel, ev)
			return nil
		}
	}

	handlers := map[string]func([]byte) error{
		TopicTransferInitiated: func(data []byte) error {
			var ev TransferEvent
			if err := json.Unmarshal(data, &ev); err != nil {
				return err
			}
			log.Printf("[Kafka] Transfer initiated: %s rail=%s amount=%.2f %s",
				ev.TransactionID, ev.Rail, ev.Amount, ev.FromCurrency)
			return nil
		},
		TopicComplianceAlert: func(data []byte) error {
			var ev ComplianceEvent
			if err := json.Unmarshal(data, &ev); err != nil {
				return err
			}
			log.Printf("[Kafka] Compliance alert: txn=%s risk=%s score=%.2f",
				ev.TransactionID, ev.RiskLevel, ev.RiskScore)
			if ev.SanctionsHit {
				log.Printf("[Kafka] CRITICAL: Sanctions hit for txn=%s", ev.TransactionID)
			}
			return nil
		},
		TopicFXRate: func(data []byte) error {
			var ev FXRateEvent
			if err := json.Unmarshal(data, &ev); err != nil {
				return err
			}
			log.Printf("[Kafka] FX rate: %s/%s = %.6f", ev.FromCurrency, ev.ToCurrency, ev.Rate)
			return nil
		},
		TopicSavingsDeposit:  coreFundFlowHandler("SAVINGS_DEPOSIT"),
		TopicSavingsWithdraw: coreFundFlowHandler("SAVINGS_WITHDRAW"),
		TopicCBDCTransfer:    coreFundFlowHandler("CBDC_TRANSFER"),
		TopicCBDCReceive:     coreFundFlowHandler("CBDC_RECEIVE"),
		TopicBillPayment:     coreFundFlowHandler("BILL_PAYMENT"),
		TopicAirtimeTopup:    coreFundFlowHandler("AIRTIME_TOPUP"),
		TopicBatchPayment:    coreFundFlowHandler("BATCH_PAYMENT"),
		TopicWalletTopup:     coreFundFlowHandler("WALLET_TOPUP"),
		TopicWalletWithdraw:  coreFundFlowHandler("WALLET_WITHDRAW"),
		TopicStablecoinSwap:  coreFundFlowHandler("STABLECOIN_SWAP"),
	}

	go func() {
		if err := consumer.Consume(ctx, handlers); err != nil {
			log.Printf("[Kafka] Consumer stopped: %v", err)
		}
	}()

	// Graceful shutdown
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("[Kafka] Shutting down...")
	cancel()
}
