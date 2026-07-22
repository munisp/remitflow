/**
 * Central middleware facade.
 *
 * This module is the compatibility boundary used by older routers. Every public
 * operation delegates to the concrete clients in `middlewareIntegration`; it
 * does not emulate remote systems or return fabricated success values.
 */
import { randomUUID } from "node:crypto";
import { logger } from "../_core/logger.js";
import {
  dapr as daprClient,
  kafka as kafkaClient,
  openSearch as openSearchClient,
  permify as permifyClient,
  redis as redisClient,
  temporal as temporalClient,
  tigerBeetle as tigerBeetleClient,
} from "../middleware/middlewareIntegration.js";

export interface MiddlewareHealthStatus {
  kafka: boolean;
  redis: boolean;
  postgres: boolean;
  temporal: boolean;
  tigerbeetle: boolean;
  permify: boolean;
  opensearch: boolean;
  dapr: boolean;
}

type JsonObject = Record<string, unknown>;

type TigerBeetleAccount = {
  id: bigint;
  ledger: number;
  code: number;
  userData128?: bigint;
  flags?: number;
};

type TigerBeetleTransfer = {
  id: bigint;
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  pending?: boolean;
  timeout?: number;
  userData128?: bigint;
};

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`TigerBeetle ${field} must be an unsigned integer`);
}

function asObject(value: unknown, subject: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`);
  }
  return value as JsonObject;
}

function eventKey(payload: unknown): string {
  const data = payload && typeof payload === "object" ? payload as JsonObject : undefined;
  const candidate = data?.id ?? data?.eventId ?? data?.transactionId ?? data?.correlationId;
  return candidate === undefined ? randomUUID() : String(candidate);
}

/** Kafka is the durable platform event transport. */
export const kafka = {
  async publish(topic: string, message: unknown, key = eventKey(message)): Promise<void> {
    if (!topic.trim()) throw new Error("Kafka topic is required");
    await kafkaClient.produce(topic, key, JSON.stringify(message));
    if (!kafkaClient.isConnected()) {
      throw new Error(`Kafka is unavailable; event ${topic} was not published`);
    }
  },
};

/** Redis operations are delegated to the concrete client; production never treats its memory fallback as healthy. */
export const redis = {
  async get(key: string): Promise<string | null> {
    return redisClient.get(key);
  },
  async set(key: string, value: string, ttlSeconds?: number): Promise<"OK"> {
    await redisClient.set(key, value, ttlSeconds);
    if (process.env.NODE_ENV === "production" && redisClient.isUsingFallback()) {
      throw new Error("Redis is unavailable in production");
    }
    return "OK";
  },
  async del(key: string): Promise<number> {
    await redisClient.del(key);
    if (process.env.NODE_ENV === "production" && redisClient.isUsingFallback()) {
      throw new Error("Redis is unavailable in production");
    }
    return 1;
  },
};

/**
 * Supports both legacy object parameters and the concrete positional client
 * contract. Positional calls return document rows; legacy object calls retain
 * the OpenSearch client response envelope expected by older routers.
 */
export const openSearch = {
  async index(
    indexOrParams: string | { index: string; id?: string; body: unknown },
    idOrDocument?: string | JsonObject,
    documentOrId?: JsonObject | string,
  ): Promise<{ result: "created" }> {
    let indexName: string;
    let id: string;
    let document: JsonObject;

    if (typeof indexOrParams === "string") {
      indexName = indexOrParams;
      if (typeof idOrDocument === "string") {
        id = idOrDocument;
        document = asObject(documentOrId, "OpenSearch document");
      } else {
        document = asObject(idOrDocument, "OpenSearch document");
        id = typeof documentOrId === "string" ? documentOrId : randomUUID();
      }
    } else {
      indexName = indexOrParams.index;
      id = indexOrParams.id ?? randomUUID();
      document = asObject(indexOrParams.body, "OpenSearch document");
    }

    await openSearchClient.index(indexName, id, document);
    return { result: "created" };
  },

  async search(
    indexOrParams: string | { index: string; body: unknown },
    query?: JsonObject,
    size = 20,
  ): Promise<unknown> {
    if (typeof indexOrParams === "string") {
      return openSearchClient.search(indexOrParams, query ?? { match_all: {} }, size);
    }
    const body = asObject(indexOrParams.body, "OpenSearch search body");
    const rows = await openSearchClient.search(
      indexOrParams.index,
      (body.query as JsonObject | undefined) ?? { match_all: {} },
      typeof body.size === "number" ? body.size : size,
    );
    return { hits: { hits: rows, total: { value: rows.length } } };
  },

  async bulk(params: { body: unknown[] }): Promise<{ items: unknown[] }> {
    const pairs: Array<{ id: string; doc: JsonObject; index: string }> = [];
    for (let index = 0; index < params.body.length; index += 2) {
      const action = asObject(params.body[index], "OpenSearch bulk action");
      const actionIndex = asObject(action.index, "OpenSearch bulk index action");
      const document = asObject(params.body[index + 1], "OpenSearch bulk document");
      const indexName = String(actionIndex._index ?? "");
      if (!indexName) throw new Error("OpenSearch bulk action is missing _index");
      pairs.push({ index: indexName, id: String(actionIndex._id ?? randomUUID()), doc: document });
    }
    const grouped = new Map<string, Array<{ id: string; doc: JsonObject }>>();
    for (const pair of pairs) grouped.set(pair.index, [...(grouped.get(pair.index) ?? []), { id: pair.id, doc: pair.doc }]);
    const items: unknown[] = [];
    for (const [indexName, documents] of grouped) {
      const result = await openSearchClient.bulkIndex(indexName, documents);
      if (result.errors > 0) throw new Error(`OpenSearch bulk index failed for ${result.errors} documents`);
      items.push(...documents.map(document => ({ index: { _index: indexName, _id: document.id, status: 201 } })));
    }
    return { items };
  },
};

export const tigerBeetle = {
  async createAccounts(accounts: unknown[]): Promise<unknown[]> {
    const normalized = accounts.map((account): TigerBeetleAccount => {
      const data = asObject(account, "TigerBeetle account");
      return {
        id: asBigInt(data.id, "account id"),
        ledger: Number(data.ledger),
        code: Number(data.code),
        flags: data.flags === undefined ? undefined : Number(data.flags),
        userData128: data.userData128 === undefined && data.user_data_128 === undefined
          ? undefined
          : asBigInt(data.userData128 ?? data.user_data_128, "account userData128"),
      };
    });
    await tigerBeetleClient.createAccounts(normalized);
    return [];
  },

  async createTransfers(transfers: unknown[]): Promise<unknown[]> {
    for (const transfer of transfers) {
      const data = asObject(transfer, "TigerBeetle transfer");
      const normalized: TigerBeetleTransfer = {
        id: asBigInt(data.id, "transfer id"),
        debitAccountId: asBigInt(data.debitAccountId ?? data.debit_account_id, "debit account id"),
        creditAccountId: asBigInt(data.creditAccountId ?? data.credit_account_id, "credit account id"),
        amount: asBigInt(data.amount, "amount"),
        ledger: Number(data.ledger),
        code: Number(data.code),
        pending: Boolean(data.pending ?? (Number(data.flags ?? 0) & 1)),
        timeout: data.timeout === undefined ? undefined : Number(data.timeout),
        userData128: data.userData128 === undefined && data.user_data_128 === undefined
          ? undefined
          : asBigInt(data.userData128 ?? data.user_data_128, "transfer userData128"),
      };
      await tigerBeetleClient.createTransfer(normalized);
    }
    return [];
  },

  async lookupAccounts(ids: bigint[]): Promise<Array<{ credits_posted: bigint; debits_posted: bigint }>> {
    return tigerBeetleClient.lookupAccounts(ids);
  },
};

export const temporal = {
  async startWorkflow(workflowType: string, args: unknown, taskQueue = "remitflow-tasks"): Promise<{ workflowId: string }> {
    const workflowId = `${workflowType}-${randomUUID()}`;
    const started = await temporalClient.startWorkflow(workflowId, workflowType, [args], taskQueue);
    if (!started) throw new Error(`Temporal is unavailable; workflow ${workflowType} was not started`);
    return { workflowId: started.workflowId };
  },
  async signalWorkflow(workflowId: string, signal: string, args?: unknown): Promise<void> {
    await temporalClient.signalWorkflow(workflowId, signal, args === undefined ? [] : [args]);
  },
  async queryWorkflow(workflowId: string, query: string): Promise<unknown> {
    return temporalClient.queryWorkflow(workflowId, query);
  },
};

export const dapr = {
  async invoke(appId: string, method: string, data?: unknown): Promise<unknown> {
    return daprClient.invokeService(appId, method, data);
  },
  async publishEvent(_pubsubName: string, topic: string, data: unknown): Promise<void> {
    await daprClient.publishEvent(topic, data);
  },
};

export const permify = {
  async check(params: { subject: string; permission: string; resource: string }): Promise<boolean> {
    const [subject, subjectId] = params.subject.split(":", 2);
    const [entity, entityId] = params.resource.split(":", 2);
    if (!subject || !subjectId || !entity || !entityId) {
      throw new Error("Permify subject and resource must be formatted as type:id");
    }
    return permifyClient.check({ entity, entityId, permission: params.permission, subject, subjectId });
  },
};

export async function publishEvent(topic: string, payload: unknown): Promise<void>;
export async function publishEvent(topic: string, key: string, payload: unknown): Promise<void>;
export async function publishEvent(topic: string, keyOrPayload: string | unknown, maybePayload?: unknown): Promise<void> {
  const hasExplicitKey = typeof keyOrPayload === "string" && maybePayload !== undefined;
  const key = hasExplicitKey ? keyOrPayload : eventKey(keyOrPayload);
  const payload = hasExplicitKey ? maybePayload : keyOrPayload;
  await kafka.publish(topic, payload, key);
}

export async function publishPlatformEvent(event: unknown): Promise<void>;
export async function publishPlatformEvent(topic: string, payload: unknown): Promise<void>;
export async function publishPlatformEvent(topicOrEvent: string | unknown, maybePayload?: unknown): Promise<void> {
  if (typeof topicOrEvent === "string" && maybePayload !== undefined) {
    await publishEvent(topicOrEvent, maybePayload);
    return;
  }
  await publishEvent("platform.lifecycle", topicOrEvent);
}

async function checkPostgres(): Promise<boolean> {
  try {
    const { getDb } = await import("../db.js");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return false;
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (error) {
    logger.warn({ error }, "[Middleware] PostgreSQL health check failed");
    return false;
  }
}

export async function checkMiddlewareHealth(): Promise<MiddlewareHealthStatus> {
  const [postgres, temporalHealthy, tigerBeetleHealth, apisixIgnored] = await Promise.all([
    checkPostgres(),
    temporalClient.getHealth(),
    tigerBeetleClient.healthCheck(),
    Promise.resolve(undefined),
  ]);
  void apisixIgnored;

  let kafkaHealthy = false;
  try {
    await kafkaClient.connect();
    kafkaHealthy = kafkaClient.isConnected();
  } catch { /* result remains false */ }

  let redisHealthy = false;
  try {
    await redisClient.get("middleware-health");
    redisHealthy = !redisClient.isUsingFallback();
  } catch { /* result remains false */ }

  let openSearchHealthy = false;
  try {
    openSearchHealthy = await openSearchClient.retryConnection();
  } catch { /* result remains false */ }

  let permifyHealthy = false;
  try {
    permifyHealthy = await permifyClient.check({
      entity: "system", entityId: "health", permission: "read", subject: "service", subjectId: "remitflow-api",
    });
  } catch { /* result remains false */ }

  let daprHealthy = false;
  try {
    await daprClient.getState("middleware-health");
    daprHealthy = true;
  } catch { /* result remains false */ }

  return {
    kafka: kafkaHealthy,
    redis: redisHealthy,
    postgres,
    temporal: temporalHealthy,
    tigerbeetle: tigerBeetleHealth.connected,
    permify: permifyHealthy,
    opensearch: openSearchHealthy,
    dapr: daprHealthy,
  };
}

/**
 * The database layer supplies row-level tenant enforcement. This compatibility
 * helper deliberately does not claim to change a connection session; callers
 * execute in the existing authenticated request context.
 */
export async function withRLSContext<T>(_ctx: { userId: number }, fn: () => Promise<T>): Promise<T> {
  return fn();
}
