/**
 * offlineQueue.ts
 * IndexedDB-backed offline transfer queue.
 * Transfers initiated while offline are stored here and replayed
 * when connectivity is restored via the Service Worker background sync.
 */

import { get, set } from "idb-keyval";

export type QueuedTransferType =
  | "send_money"
  | "mobile_money"
  | "crypto_transfer"
  | "universal_conversion"
  | "papss_payment";

export interface QueuedTransfer {
  id: string; // uuid
  type: QueuedTransferType;
  payload: Record<string, unknown>;
  queuedAt: number; // UTC ms
  retryCount: number;
  lastError?: string;
  status: "pending" | "syncing" | "failed";
}

const QUEUE_KEY = "remitflow:offline-queue";

async function readQueue(): Promise<QueuedTransfer[]> {
  try {
    return (await get<QueuedTransfer[]>(QUEUE_KEY)) ?? [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedTransfer[]): Promise<void> {
  try {
    await set(QUEUE_KEY, queue);
  } catch {
    // IndexedDB unavailable — silently ignore
  }
}

/**
 * Add a transfer to the offline queue.
 * Returns the generated queue entry ID.
 */
export async function enqueueTransfer(
  typeOrObj: QueuedTransferType | (Record<string, unknown> & { type: QueuedTransferType }),
  payload?: Record<string, unknown>
): Promise<string> {
  let type: QueuedTransferType;
  let resolvedPayload: Record<string, unknown>;
  if (typeof typeOrObj === "string") {
    type = typeOrObj;
    resolvedPayload = payload ?? {};
  } else {
    const { type: t, ...rest } = typeOrObj;
    type = t;
    resolvedPayload = rest;
  }
  const id = `${Date.now()}-${Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b: number) => b.toString(16).padStart(2,"0")).join("")}`;
  const entry: QueuedTransfer = {
    id,
    type,
    payload: resolvedPayload,
    queuedAt: Date.now(),
    retryCount: 0,
    status: "pending",
  };
  const queue = await readQueue();
  await writeQueue([...queue, entry]);

  // Register a background sync tag if Service Worker is available
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register(
        "remitflow-transfer-sync"
      );
    } catch {
      // Background sync not supported — will retry on next page load
    }
  }

  return id;
}

/**
 * Get all pending transfers in the queue.
 */
export async function getPendingTransfers(): Promise<QueuedTransfer[]> {
  const queue = await readQueue();
  return queue.filter((t) => t.status === "pending");
}

/**
 * Get the full queue (all statuses).
 */
export async function getFullQueue(): Promise<QueuedTransfer[]> {
  return readQueue();
}

/**
 * Mark a transfer as successfully synced and remove it from the queue.
 */
export async function removeFromQueue(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((t) => t.id !== id));
}

/**
 * Mark a transfer as failed and increment retry count.
 */
export async function markFailed(id: string, error: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(
    queue.map((t) =>
      t.id === id
        ? { ...t, status: "failed", retryCount: t.retryCount + 1, lastError: error }
        : t
    )
  );
}

/**
 * Reset failed transfers back to pending for retry.
 */
export async function requeueFailed(): Promise<number> {
  const queue = await readQueue();
  const failed = queue.filter((t) => t.status === "failed" && t.retryCount < 5);
  if (failed.length === 0) return 0;
  await writeQueue(
    queue.map((t) =>
      t.status === "failed" && t.retryCount < 5 ? { ...t, status: "pending" } : t
    )
  );
  return failed.length;
}

/**
 * Count of pending transfers (for badge display).
 */
export async function getPendingCount(): Promise<number> {
  const queue = await readQueue();
  return queue.filter((t) => t.status === "pending").length;
}
