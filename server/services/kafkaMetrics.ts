/**
 * Kafka Atomic Metrics — Lesson 12 from 1B Payments/Day research
 *
 * The benchmark uses sync/atomic for lock-free progress tracking.
 * This module provides atomic-style counters for Kafka consumer metrics
 * using Atomics.add() on SharedArrayBuffer in cluster mode,
 * falling back to plain object counters in single-process mode.
 *
 * Reference: https://github.com/pratikgajjar/1b-payments/blob/main/cmd/tb/transfers/main.go
 */

import { logger } from '../_core/logger';

// Index positions in the SharedArrayBuffer
const IDX_PRODUCED = 0;
const IDX_CONSUMED = 1;
const IDX_ERRORS = 2;
const IDX_LAG = 3;
const COUNTER_COUNT = 4;

class KafkaMetrics {
  private sab: SharedArrayBuffer | null = null;
  private view: Int32Array | null = null;
  private fallback = { produced: 0, consumed: 0, errors: 0, lag: 0 };
  private useAtomic: boolean;

  // Per-topic stats (not shared across workers — aggregated on read)
  private topicStats = new Map<string, { produced: number; consumed: number; errors: number }>();

  constructor() {
    this.useAtomic = typeof SharedArrayBuffer !== "undefined";
    if (this.useAtomic) {
      try {
        this.sab = new SharedArrayBuffer(COUNTER_COUNT * Int32Array.BYTES_PER_ELEMENT);
        this.view = new Int32Array(this.sab);
        logger.info("KafkaMetrics: using SharedArrayBuffer atomic counters");
      } catch {
        this.useAtomic = false;
        logger.info("KafkaMetrics: SharedArrayBuffer unavailable, using plain counters");
      }
    }
  }

  incrementProduced(topic?: string): void {
    if (this.useAtomic && this.view) {
      Atomics.add(this.view, IDX_PRODUCED, 1);
    } else {
      this.fallback.produced++;
    }
    if (topic) this.incrementTopicStat(topic, "produced");
  }

  incrementConsumed(topic?: string): void {
    if (this.useAtomic && this.view) {
      Atomics.add(this.view, IDX_CONSUMED, 1);
    } else {
      this.fallback.consumed++;
    }
    if (topic) this.incrementTopicStat(topic, "consumed");
  }

  incrementErrors(topic?: string): void {
    if (this.useAtomic && this.view) {
      Atomics.add(this.view, IDX_ERRORS, 1);
    } else {
      this.fallback.errors++;
    }
    if (topic) this.incrementTopicStat(topic, "errors");
  }

  setLag(lag: number): void {
    if (this.useAtomic && this.view) {
      Atomics.store(this.view, IDX_LAG, lag);
    } else {
      this.fallback.lag = lag;
    }
  }

  private incrementTopicStat(topic: string, field: "produced" | "consumed" | "errors"): void {
    const stat = this.topicStats.get(topic) ?? { produced: 0, consumed: 0, errors: 0 };
    stat[field]++;
    this.topicStats.set(topic, stat);
  }

  getStats() {
    const totals = this.useAtomic && this.view
      ? {
          produced: Atomics.load(this.view, IDX_PRODUCED),
          consumed: Atomics.load(this.view, IDX_CONSUMED),
          errors: Atomics.load(this.view, IDX_ERRORS),
          lag: Atomics.load(this.view, IDX_LAG),
        }
      : { ...this.fallback };

    const topics = Object.fromEntries(this.topicStats.entries());

    return {
      ...totals,
      topics,
      mode: this.useAtomic ? "atomic" : "plain",
    };
  }

  reset(): void {
    if (this.useAtomic && this.view) {
      Atomics.store(this.view, IDX_PRODUCED, 0);
      Atomics.store(this.view, IDX_CONSUMED, 0);
      Atomics.store(this.view, IDX_ERRORS, 0);
      Atomics.store(this.view, IDX_LAG, 0);
    } else {
      this.fallback = { produced: 0, consumed: 0, errors: 0, lag: 0 };
    }
    this.topicStats.clear();
  }
}

// Singleton
export const kafkaMetrics = new KafkaMetrics();
