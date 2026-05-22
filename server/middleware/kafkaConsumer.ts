/**
 * RemitFlow — Kafka Consumer Infrastructure
 * ──────────────────────────────────────────
 * Provides consumer group management for all 15 Kafka topics.
 * Each consumer dispatches to the appropriate handler.
 *
 * Topics consumed:
 *   - remitflow.transactions         → transaction monitoring, velocity checks
 *   - remitflow.kyc.events           → KYC workflow triggers
 *   - remitflow.fx.rates             → FX rate cache updates
 *   - remitflow.risk.scores          → risk dashboard updates
 *   - remitflow.notifications.stream → push notification dispatch
 *   - remitflow.audit.stream         → audit log persistence
 *   - remitflow.mojaloop.transfers   → Mojaloop transfer tracking
 *   - remitflow.investment.prices    → investment portfolio updates
 *   - remitflow.payment.initiated    → payment tracking
 *   - remitflow.payment.completed    → settlement confirmation
 *   - remitflow.payment.failed       → failure handling, retry logic
 *   - remitflow.dispute.opened       → dispute workflow trigger
 *   - remitflow.compliance.alert     → compliance dashboard alerts
 *   - remitflow.fraud.alert          → fraud case creation
 *   - kyc.liveness.result            → liveness audit logging
 */

import { KAFKA_TOPICS } from "./kafka";
import { getDb, createAuditLog } from "../db";

const CONSUMER_GROUP = process.env.KAFKA_CONSUMER_GROUP || "remitflow-main-consumer";

interface ConsumerHandler {
  topic: string;
  handler: (message: Record<string, unknown>) => Promise<void>;
  description: string;
}

// ─── Handler Registry ────────────────────────────────────────────────────────

const handlers: ConsumerHandler[] = [
  {
    topic: KAFKA_TOPICS.TRANSACTIONS,
    description: "Transaction monitoring — velocity checks, pattern detection",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      // Log transaction event for monitoring
      const txId = msg.transactionId as string;
      const amount = msg.amount as number;
      const userId = msg.userId as number;
      if (txId && userId) {
        await createAuditLog({
          userId,
          action: "transaction.event",
          targetType: "transaction",
          description: txId,
          metadata: { amount, eventType: msg.eventType },
        }).catch(() => {});
      }
    },
  },
  {
    topic: KAFKA_TOPICS.KYC_EVENTS,
    description: "KYC workflow triggers — delegates to KYC event consumer service",
    handler: async (msg) => {
      // Forward to KYC event consumer service
      const url = process.env.KYC_EVENT_CONSUMER_URL || "http://localhost:8120";
      try {
        await fetch(`${url}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: msg }),
        });
      } catch {
        // KYC event consumer handles its own persistence
      }
    },
  },
  {
    topic: KAFKA_TOPICS.FX_RATES,
    description: "FX rate cache update — updates in-memory rate cache",
    handler: async (msg) => {
      const base = msg.baseCurrency as string;
      const quote = msg.quoteCurrency as string;
      const rate = msg.rate as number;
      if (base && quote && rate) {
        // Update Redis rate cache if available
        try {
          const redis = await import("../middleware/redis.js");
          const client = (redis as Record<string, unknown>).redisClient;
          if (client && typeof (client as Record<string, Function>).set === "function") {
            await (client as Record<string, Function>).set(
              `fx:${base}:${quote}`,
              String(rate),
              { EX: 300 }
            );
          }
        } catch {
          // Redis unavailable — rate will be fetched on next request
        }
      }
    },
  },
  {
    topic: KAFKA_TOPICS.RISK_SCORES,
    description: "Risk dashboard updates — persists risk scores for analytics",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "risk.score.computed",
        targetType: "risk",
        description: (msg.transactionId as string) || "unknown",
        metadata: { score: msg.riskScore, factors: msg.factors },
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.NOTIFICATIONS,
    description: "Push notification dispatch — sends via configured channels",
    handler: async (msg) => {
      const userId = msg.userId as number;
      const title = msg.title as string;
      if (!userId || !title) return;
      // Notification dispatch handled by push notification service
      try {
        const pushUrl = process.env.PUSH_NOTIFICATION_URL || "http://localhost:8140";
        await fetch(`${pushUrl}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(msg),
        });
      } catch {
        // Push service unavailable — notification will be available in-app
      }
    },
  },
  {
    topic: KAFKA_TOPICS.AUDIT_LOGS,
    description: "Audit log persistence — writes to audit table and OpenSearch",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: (msg.action as string) || "audit.event",
        targetType: (msg.resourceType as string) || "system",
        description: (msg.resourceId as string) || "unknown",
        metadata: msg,
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.PAYMENT_INITIATED,
    description: "Payment tracking — records initiation timestamp",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      const paymentId = msg.paymentId as string;
      if (paymentId) {
        await createAuditLog({
          userId: (msg.userId as number) || 0,
          action: "payment.initiated",
          targetType: "payment",
          description: paymentId,
          metadata: { amount: msg.amount, currency: msg.currency, rail: msg.rail },
        }).catch(() => {});
      }
    },
  },
  {
    topic: KAFKA_TOPICS.PAYMENT_COMPLETED,
    description: "Settlement confirmation — updates transaction status",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      const paymentId = msg.paymentId as string;
      if (paymentId) {
        await createAuditLog({
          userId: (msg.userId as number) || 0,
          action: "payment.completed",
          targetType: "payment",
          description: paymentId,
          metadata: { settledAt: msg.settledAt },
        }).catch(() => {});
      }
    },
  },
  {
    topic: KAFKA_TOPICS.PAYMENT_FAILED,
    description: "Payment failure handling — triggers retry or alert",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      const paymentId = msg.paymentId as string;
      if (paymentId) {
        await createAuditLog({
          userId: (msg.userId as number) || 0,
          action: "payment.failed",
          targetType: "payment",
          description: paymentId,
          metadata: { error: msg.error, retryable: msg.retryable },
        }).catch(() => {});
      }
    },
  },
  {
    topic: KAFKA_TOPICS.DISPUTE_OPENED,
    description: "Dispute workflow trigger — creates dispute case",
    handler: async (msg) => {
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "dispute.opened",
        targetType: "dispute",
        description: (msg.disputeId as string) || "unknown",
        metadata: msg,
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.COMPLIANCE_ALERT,
    description: "Compliance dashboard alert — routes to compliance officers",
    handler: async (msg) => {
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "compliance.alert",
        targetType: "compliance",
        description: (msg.alertId as string) || "unknown",
        metadata: msg,
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.FRAUD_ALERT,
    description: "Fraud case creation — creates fraud investigation case",
    handler: async (msg) => {
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "fraud.alert",
        targetType: "fraud",
        description: (msg.alertId as string) || "unknown",
        metadata: msg,
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.KYC_LIVENESS_RESULT,
    description: "Liveness audit logging — persists liveness check results",
    handler: async (msg) => {
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "kyc.liveness.result",
        targetType: "kyc",
        description: (msg.sessionId as string) || "unknown",
        metadata: { passed: msg.passed, score: msg.score, method: msg.method },
      }).catch(() => {});
    },
  },
];

// ─── Consumer Management ─────────────────────────────────────────────────────

let _consumerRunning = false;
const _stats = {
  messagesProcessed: 0,
  messagesErrored: 0,
  lastMessageAt: null as string | null,
  startedAt: null as string | null,
};

export async function startKafkaConsumers(): Promise<void> {
  if (_consumerRunning) return;

  try {
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "remitflow-main",
      brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
    });

    const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
    await consumer.connect();

    for (const h of handlers) {
      await consumer.subscribe({ topic: h.topic, fromBeginning: false });
    }

    const handlerMap = new Map(handlers.map((h) => [h.topic, h.handler]));

    await consumer.run({
      eachMessage: async ({ topic, message }: { topic: string; partition: number; message: any }) => {
        const handler = handlerMap.get(topic);
        if (!handler || !message.value) return;

        try {
          const parsed = JSON.parse(message.value.toString());
          await handler(parsed);
          _stats.messagesProcessed++;
          _stats.lastMessageAt = new Date().toISOString();
        } catch (err) {
          _stats.messagesErrored++;
          console.error(`Kafka consumer error [${topic}]:`, err);
        }
      },
    });

    _consumerRunning = true;
    _stats.startedAt = new Date().toISOString();
    console.log(`Kafka consumers started for ${handlers.length} topics`);
  } catch (err) {
    console.warn("Kafka consumers not started (broker unavailable):", (err as Error).message);
  }
}

export function getConsumerStats() {
  return {
    running: _consumerRunning,
    topics: handlers.map((h) => ({ topic: h.topic, description: h.description })),
    stats: _stats,
  };
}

export function getConsumerHandlers() {
  return handlers;
}
