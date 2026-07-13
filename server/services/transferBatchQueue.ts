/**
 * Transfer Batch Queue — Lesson 1 from 1B Payments/Day research
 *
 * Instead of committing one row per HTTP request (1 fsync/transfer),
 * this queue accumulates transactions and flushes them in configurable
 * batch sizes (default: 100 rows per commit), reducing fsync pressure
 * by up to 100×.
 *
 * Reference: https://backend.how/posts/1b-payments-per-day/
 */

import { getDb } from "../db";
import { transactions as transactions } from "../../drizzle/schema";
import { logger } from '../_core/logger';

const BATCH_SIZE = parseInt(process.env.TRANSFER_BATCH_SIZE ?? "100", 10);
const FLUSH_INTERVAL_MS = parseInt(process.env.TRANSFER_BATCH_FLUSH_MS ?? "50", 10);

type PendingTransfer = typeof transactions.$inferInsert;

type BatchResult = {
  success: boolean;
  transferId?: number;
  error?: string;
};

type QueueEntry = {
  transfer: PendingTransfer;
  resolve: (result: BatchResult) => void;
  reject: (err: Error) => void;
};

class TransferBatchQueue {
  private queue: QueueEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private totalEnqueued = 0;
  private totalFlushed = 0;
  private totalErrors = 0;

  constructor() {
    // Do NOT auto-start — call start() explicitly from scheduler.ts
  }

  /**
   * Start the batch queue flush timer (call once on server startup).
   */
  start(): void {
    if (!this.flushTimer) {
      this.scheduleFlush();
    }
  }

  /**
   * Enqueue a transfer for batch insertion.
   * Returns a Promise that resolves when the transfer has been committed.
   */
  enqueue(transfer: PendingTransfer): Promise<BatchResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ transfer, resolve, reject });
      this.totalEnqueued++;

      // If the batch is full, flush immediately without waiting for the timer
      if (this.queue.length >= BATCH_SIZE) {
        this.flush();
      }
    });
  }

  private scheduleFlush() {
    this.flushTimer = setTimeout(() => {
      this.flush().finally(() => this.scheduleFlush());
    }, FLUSH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;

    this.flushing = true;
    const batch = this.queue.splice(0, BATCH_SIZE);

    try {
      const db = await getDb();
      const rows = batch.map((e) => e.transfer);

      // Single INSERT with all rows — one fsync for the entire batch
      const inserted = await db.insert(transactions).values(rows).returning({ id: transactions.id });

      // Resolve each promise with its assigned ID
      batch.forEach((entry, i) => {
        entry.resolve({ success: true, transferId: inserted[i]?.id });
      });

      this.totalFlushed += batch.length;
      logger.info({ batchSize: batch.length, totalFlushed: this.totalFlushed }, "Transfer batch flushed");
    } catch (err) {
      this.totalErrors += batch.length;
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ error: error.message, batchSize: batch.length }, "Transfer batch flush failed");

      // Reject all promises in the failed batch
      batch.forEach((entry) => entry.reject(error));
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Graceful shutdown: flush remaining items before process exit.
   * Called by the SIGTERM handler in server/_core/index.ts
   */
  async drain(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.queue.length > 0 && Date.now() < deadline) {
      await this.flush();
      if (this.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    logger.info(
      { totalEnqueued: this.totalEnqueued, totalFlushed: this.totalFlushed, totalErrors: this.totalErrors },
      "Transfer batch queue drained"
    );
  }

  getStats() {
    return {
      queueDepth: this.queue.length,
      totalEnqueued: this.totalEnqueued,
      totalFlushed: this.totalFlushed,
      totalErrors: this.totalErrors,
      batchSize: BATCH_SIZE,
      flushIntervalMs: FLUSH_INTERVAL_MS,
    };
  }
}

// Singleton — shared across all tRPC procedure calls in the same process
export const transferBatchQueue = new TransferBatchQueue();
