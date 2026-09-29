/**
 * Offline Queue for React Native
 *
 * Stores pending operations in AsyncStorage when network is unavailable,
 * then syncs when connectivity is restored.
 *
 * Middleware-ready: in production, swap AsyncStorage → WatermelonDB or
 * react-native-mmkv for encrypted local storage.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "@remitflow/offline_queue";
const MAX_RETRIES = 5;
/**
 * wave14 perf (M2): hard cap on persisted queue length so AsyncStorage
 * payloads stay bounded (each enqueue rewrites the whole JSON blob).
 * Terminal entries are pruned on every enqueue; if the cap is still
 * exceeded by pending work, the OLDEST entries are evicted first — newest
 * user intent is the most likely to still matter.
 */
const MAX_QUEUE_LENGTH = 200;

export interface QueuedOperation {
  id: string;
  operationType: string;
  endpoint: string;
  payload: Record<string, unknown>;
  status: "pending" | "completed" | "failed";
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  lastAttemptAt?: string;
  errorMessage?: string;
  idempotencyKey: string;
}

async function loadQueue(): Promise<QueuedOperation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedOperation[]) : [];
}

async function saveQueue(queue: QueuedOperation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueue(params: {
  operationType: string;
  endpoint: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<string> {
  // wave14 perf (M2): prune terminal (completed/failed) entries before
  // append — they are never replayed (getPending filters them out) and only
  // inflate the persisted blob otherwise.
  const queue = (await loadQueue()).filter((op) => op.status === "pending");
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const key =
    params.idempotencyKey ??
    `${params.operationType}_${Date.now()}`;

  if (queue.some((op) => op.idempotencyKey === key)) {
    return key;
  }

  // Cap the queue: evict oldest pending entries if we are already full.
  while (queue.length >= MAX_QUEUE_LENGTH) {
    const evicted = queue.shift();
    console.warn(
      `[offlineQueue] queue full (${MAX_QUEUE_LENGTH}); evicting oldest op ${evicted?.id}`
    );
  }

  queue.push({
    id,
    operationType: params.operationType,
    endpoint: params.endpoint,
    payload: params.payload,
    status: "pending",
    retryCount: 0,
    maxRetries: MAX_RETRIES,
    createdAt: new Date().toISOString(),
    idempotencyKey: key,
  });

  await saveQueue(queue);
  return id;
}

export async function getPending(): Promise<QueuedOperation[]> {
  const queue = await loadQueue();
  return queue.filter(
    (op) => op.status === "pending" && op.retryCount < op.maxRetries
  );
}

export async function markCompleted(id: string): Promise<void> {
  const queue = await loadQueue();
  const op = queue.find((o) => o.id === id);
  if (op) {
    op.status = "completed";
    op.lastAttemptAt = new Date().toISOString();
  }
  await saveQueue(queue);
}

export async function markFailed(
  id: string,
  errorMessage: string
): Promise<void> {
  const queue = await loadQueue();
  const op = queue.find((o) => o.id === id);
  if (op) {
    op.retryCount += 1;
    op.lastAttemptAt = new Date().toISOString();
    op.errorMessage = errorMessage;
    if (op.retryCount >= op.maxRetries) {
      op.status = "failed";
    }
  }
  await saveQueue(queue);
}

export async function pendingCount(): Promise<number> {
  const pending = await getPending();
  return pending.length;
}

export async function cleanup(): Promise<number> {
  const queue = await loadQueue();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const remaining = queue.filter(
    (op) => !(op.status === "completed" && op.createdAt < cutoff)
  );
  const removed = queue.length - remaining.length;
  await saveQueue(remaining);
  return removed;
}
