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
  const queue = await loadQueue();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const key =
    params.idempotencyKey ??
    `${params.operationType}_${Date.now()}`;

  if (queue.some((op) => op.idempotencyKey === key)) {
    return key;
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
