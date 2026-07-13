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
)

// ─── Core Fund Flow Topics ────────────────────────────────────────────────────

const (
	TopicSavingsDeposit      = "remitflow.savings.deposit"
	TopicSavingsWithdraw     = "remitflow.savings.withdraw"
	TopicCBDCTransfer        = "remitflow.cbdc.transfer"
	TopicCBDCReceive         = "remitflow.cbdc.receive"
	TopicBillPayment         = "remitflow.bill.payment"
	TopicAirtimeTopup        = "remitflow.airtime.topup"
	TopicBatchPayment        = "remitflow.batch.payment"
	TopicWalletTopup         = "remitflow.wallet.topup"
	TopicWalletWithdraw      = "remitflow.wallet.withdraw"
	TopicStablecoinSwap      = "remitflow.stablecoin.swap"
	TopicStablecoinOnramp    = "remitflow.stablecoin.onramp"
	TopicStablecoinOfframp   = "remitflow.stablecoin.offramp"
	TopicStablecoinBridge    = "remitflow.stablecoin.bridge"
	TopicStablecoinYield     = "remitflow.stablecoin.yield"
	TopicFundFlowCompensated = "remitflow.fund.compensated"
)

// CoreFundFlowEvent is the canonical event envelope for all core fund flow operations.
type CoreFundFlowEvent struct {
	EventID       string          `json:"eventId"`
	EventType     string          `json:"eventType"`
	TransactionID string          `json:"transactionId"`
	UserID        string          `json:"userId"`
	Amount        float64         `json:"amount"`
	Currency      string          `json:"currency"`
	ToCurrency    string          `json:"toCurrency,omitempty"`
	Timestamp     time.Time       `json:"timestamp"`
	Metadata      json.RawMessage `json:"metadata,omitempty"`
	CorrelationID string          `json:"correlationId,omitempty"`
	TenantID      string          `json:"tenantId,omitempty"`
}

// ─── Consumer Group Handler ───────────────────────────────────────────────────

type coreFundFlowConsumerGroup struct {
	ready chan bool
}

func (c *coreFundFlowConsumerGroup) Setup(_ sarama.ConsumerGroupSession) error {
	close(c.ready)
	return nil
}

func (c *coreFundFlowConsumerGroup) Cleanup(_ sarama.ConsumerGroupSession) error {
	return nil
}

func (c *coreFundFlowConsumerGroup) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		var event CoreFundFlowEvent
		if err := json.Unmarshal(msg.Value, &event); err != nil {
			log.Printf("[WARN] Failed to unmarshal CoreFundFlowEvent on topic %s: %v", msg.Topic, err)
			session.MarkMessage(msg, "")
			continue
		}

		switch msg.Topic {
		case TopicSavingsDeposit:
			coreFundFlowHandler("SAVINGS_DEPOSIT")(event)
		case TopicSavingsWithdraw:
			coreFundFlowHandler("SAVINGS_WITHDRAW")(event)
		case TopicCBDCTransfer:
			coreFundFlowHandler("CBDC_TRANSFER")(event)
		case TopicCBDCReceive:
			coreFundFlowHandler("CBDC_RECEIVE")(event)
		case TopicBillPayment:
			coreFundFlowHandler("BILL_PAYMENT")(event)
		case TopicAirtimeTopup:
			coreFundFlowHandler("AIRTIME_TOPUP")(event)
		case TopicBatchPayment:
			coreFundFlowHandler("BATCH_PAYMENT")(event)
		case TopicWalletTopup:
			coreFundFlowHandler("WALLET_TOPUP")(event)
		case TopicWalletWithdraw:
			coreFundFlowHandler("WALLET_WITHDRAW")(event)
		case TopicStablecoinSwap:
			coreFundFlowHandler("STABLECOIN_SWAP")(event)
		case TopicStablecoinOnramp:
			coreFundFlowHandler("STABLECOIN_ONRAMP")(event)
		case TopicStablecoinOfframp:
			coreFundFlowHandler("STABLECOIN_OFFRAMP")(event)
		case TopicStablecoinBridge:
			coreFundFlowHandler("STABLECOIN_BRIDGE")(event)
		case TopicStablecoinYield:
			coreFundFlowHandler("STABLECOIN_YIELD")(event)
		case TopicFundFlowCompensated:
			coreFundFlowHandler("FUND_FLOW_COMPENSATED")(event)
		default:
			log.Printf("[WARN] Unhandled topic: %s", msg.Topic)
		}

		session.MarkMessage(msg, "")
	}
	return nil
}

// coreFundFlowHandler returns a typed handler function for a given event type.
func coreFundFlowHandler(eventType string) func(CoreFundFlowEvent) {
	return func(event CoreFundFlowEvent) {
		log.Printf("[INFO] Processing %s | txID=%s | userID=%s | amount=%.2f %s",
			eventType, event.TransactionID, event.UserID, event.Amount, event.Currency)

		switch eventType {
		case "SAVINGS_DEPOSIT":
			handleSavingsDeposit(event)
		case "SAVINGS_WITHDRAW":
			handleSavingsWithdraw(event)
		case "CBDC_TRANSFER":
			handleCBDCTransfer(event)
		case "CBDC_RECEIVE":
			handleCBDCReceive(event)
		case "BILL_PAYMENT":
			handleBillPayment(event)
		case "AIRTIME_TOPUP":
			handleAirtimeTopup(event)
		case "BATCH_PAYMENT":
			handleBatchPayment(event)
		case "WALLET_TOPUP":
			handleWalletTopup(event)
		case "WALLET_WITHDRAW":
			handleWalletWithdraw(event)
		case "STABLECOIN_SWAP":
			handleStablecoinSwap(event)
		case "STABLECOIN_ONRAMP":
			handleStablecoinOnramp(event)
		case "STABLECOIN_OFFRAMP":
			handleStablecoinOfframp(event)
		case "STABLECOIN_BRIDGE":
			handleStablecoinBridge(event)
		case "STABLECOIN_YIELD":
			handleStablecoinYield(event)
		case "FUND_FLOW_COMPENSATED":
			handleFundFlowCompensated(event)
		}
	}
}

// ─── Individual Handlers ──────────────────────────────────────────────────────

func handleSavingsDeposit(e CoreFundFlowEvent) {
	log.Printf("[SAVINGS_DEPOSIT] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleSavingsWithdraw(e CoreFundFlowEvent) {
	log.Printf("[SAVINGS_WITHDRAW] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleCBDCTransfer(e CoreFundFlowEvent) {
	log.Printf("[CBDC_TRANSFER] tx=%s user=%s amount=%.2f %s", e.TransactionID, e.UserID, e.Amount, e.Currency)
}

func handleCBDCReceive(e CoreFundFlowEvent) {
	log.Printf("[CBDC_RECEIVE] tx=%s user=%s amount=%.2f %s", e.TransactionID, e.UserID, e.Amount, e.Currency)
}

func handleBillPayment(e CoreFundFlowEvent) {
	log.Printf("[BILL_PAYMENT] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleAirtimeTopup(e CoreFundFlowEvent) {
	log.Printf("[AIRTIME_TOPUP] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleBatchPayment(e CoreFundFlowEvent) {
	log.Printf("[BATCH_PAYMENT] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleWalletTopup(e CoreFundFlowEvent) {
	log.Printf("[WALLET_TOPUP] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleWalletWithdraw(e CoreFundFlowEvent) {
	log.Printf("[WALLET_WITHDRAW] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleStablecoinSwap(e CoreFundFlowEvent) {
	log.Printf("[STABLECOIN_SWAP] user=%s amount=%.2f %s->%s", e.UserID, e.Amount, e.Currency, e.ToCurrency)
}

func handleStablecoinOnramp(e CoreFundFlowEvent) {
	log.Printf("[STABLECOIN_ONRAMP] user=%s amount=%.2f %s->%s", e.UserID, e.Amount, e.Currency, e.ToCurrency)
}

func handleStablecoinOfframp(e CoreFundFlowEvent) {
	log.Printf("[STABLECOIN_OFFRAMP] user=%s amount=%.2f %s->%s", e.UserID, e.Amount, e.Currency, e.ToCurrency)
}

func handleStablecoinBridge(e CoreFundFlowEvent) {
	log.Printf("[STABLECOIN_BRIDGE] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleStablecoinYield(e CoreFundFlowEvent) {
	log.Printf("[STABLECOIN_YIELD] user=%s amount=%.2f %s", e.UserID, e.Amount, e.Currency)
}

func handleFundFlowCompensated(e CoreFundFlowEvent) {
	log.Printf("[FUND_FLOW_COMPENSATED] tx=%s user=%s amount=%.2f %s", e.TransactionID, e.UserID, e.Amount, e.Currency)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	brokers := []string{getEnv("KAFKA_BROKERS", "localhost:9092")}
	groupID := getEnv("KAFKA_GROUP_ID", "remitflow-core-fund-flow")

	config := sarama.NewConfig()
	config.Version = sarama.V3_0_0_0
	config.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRoundRobin()}
	config.Consumer.Offsets.Initial = sarama.OffsetNewest

	topics := []string{
		TopicSavingsDeposit,
		TopicSavingsWithdraw,
		TopicCBDCTransfer,
		TopicCBDCReceive,
		TopicBillPayment,
		TopicAirtimeTopup,
		TopicBatchPayment,
		TopicWalletTopup,
		TopicWalletWithdraw,
		TopicStablecoinSwap,
		TopicStablecoinOnramp,
		TopicStablecoinOfframp,
		TopicStablecoinBridge,
		TopicStablecoinYield,
		TopicFundFlowCompensated,
	}

	client, err := sarama.NewConsumerGroup(brokers, groupID, config)
	if err != nil {
		log.Fatalf("[FATAL] Failed to create consumer group: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	handler := &coreFundFlowConsumerGroup{ready: make(chan bool)}

	go func() {
		for {
			if err := client.Consume(ctx, topics, handler); err != nil {
				log.Printf("[ERROR] Consumer group error: %v", err)
			}
			if ctx.Err() != nil {
				return
			}
			handler.ready = make(chan bool)
		}
	}()

	<-handler.ready
	fmt.Printf("[INFO] RemitFlow Go Kafka Service started | group=%s | topics=%d\n", groupID, len(topics))

	sigterm := make(chan os.Signal, 1)
	signal.Notify(sigterm, syscall.SIGINT, syscall.SIGTERM)
	<-sigterm

	fmt.Println("[INFO] Shutting down gracefully...")
	cancel()
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
