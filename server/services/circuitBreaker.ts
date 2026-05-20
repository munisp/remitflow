/**
 * Circuit Breaker — Lesson 9 from 1B Payments/Day research
 *
 * Prevents cascade failures when external payment rails (Mojaloop, SWIFT,
 * Stripe, Flutterwave) become unavailable. The benchmark shows that without
 * circuit breakers, a single slow downstream causes thread starvation
 * across the entire payment processing pipeline.
 *
 * States:
 * - CLOSED: Normal operation. Requests pass through.
 * - OPEN: Failure threshold exceeded. Requests fail fast (no downstream call).
 * - HALF_OPEN: Probe state. One request allowed through to test recovery.
 *
 * Reference: https://backend.how/posts/1b-payments-per-day/
 */

import { logger } from '../_core/logger';

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

type CircuitBreakerConfig = {
  name: string;
  failureThreshold?: number;   // Number of failures before opening (default: 5)
  successThreshold?: number;   // Successes in HALF_OPEN before closing (default: 2)
  timeout?: number;            // ms before attempting HALF_OPEN (default: 30_000)
  volumeThreshold?: number;    // Min requests before evaluating (default: 10)
};

type CircuitBreakerStats = {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  lastFailureAt: string | null;
  nextAttemptAt: string | null;
  failureRate: string;
};

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private totalRequests = 0;
  private lastFailureAt: Date | null = null;
  private nextAttemptAt: Date | null = null;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly volumeThreshold: number;

  constructor(private readonly config: CircuitBreakerConfig) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.successThreshold = config.successThreshold ?? 2;
    this.timeout = config.timeout ?? 30_000;
    this.volumeThreshold = config.volumeThreshold ?? 10;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === "OPEN") {
      // Check if timeout has elapsed — transition to HALF_OPEN
      if (this.nextAttemptAt && Date.now() >= this.nextAttemptAt.getTime()) {
        this.state = "HALF_OPEN";
        logger.info({ circuit: this.config.name }, "Circuit breaker transitioning to HALF_OPEN");
      } else {
        throw new CircuitOpenError(
          `Circuit breaker [${this.config.name}] is OPEN. Next attempt at ${this.nextAttemptAt?.toISOString()}`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  private onSuccess(): void {
    this.successes++;

    if (this.state === "HALF_OPEN") {
      if (this.successes >= this.successThreshold) {
        this.state = "CLOSED";
        this.failures = 0;
        this.successes = 0;
        logger.info({ circuit: this.config.name }, "Circuit breaker CLOSED after recovery");
      }
    } else if (this.state === "CLOSED") {
      // Reset failure count on success
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  private onFailure(err: Error): void {
    this.failures++;
    this.lastFailureAt = new Date();

    if (this.state === "HALF_OPEN") {
      // Single failure in HALF_OPEN reopens the circuit
      this.open();
      return;
    }

    if (
      this.state === "CLOSED" &&
      this.totalRequests >= this.volumeThreshold &&
      this.failures >= this.failureThreshold
    ) {
      this.open();
    }
  }

  private open(): void {
    this.state = "OPEN";
    this.nextAttemptAt = new Date(Date.now() + this.timeout);
    logger.warn(
      {
        circuit: this.config.name,
        failures: this.failures,
        nextAttemptAt: this.nextAttemptAt.toISOString(),
      },
      "Circuit breaker OPENED"
    );
  }

  getStats(): CircuitBreakerStats {
    const total = this.totalRequests;
    return {
      name: this.config.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: total,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      nextAttemptAt: this.nextAttemptAt?.toISOString() ?? null,
      failureRate: total > 0 ? ((this.failures / total) * 100).toFixed(2) + "%" : "0%",
    };
  }

  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.successes = 0;
    this.lastFailureAt = null;
    this.nextAttemptAt = null;
    logger.info({ circuit: this.config.name }, "Circuit breaker manually reset");
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

// ─── Pre-configured circuit breakers for each payment rail ───────────────────

export const circuitBreakers = {
  mojaloop: new CircuitBreaker({
    name: "mojaloop",
    failureThreshold: 5,
    timeout: 30_000,
    volumeThreshold: 10,
  }),
  stripe: new CircuitBreaker({
    name: "stripe",
    failureThreshold: 3,
    timeout: 60_000,
    volumeThreshold: 5,
  }),
  flutterwave: new CircuitBreaker({
    name: "flutterwave",
    failureThreshold: 5,
    timeout: 30_000,
    volumeThreshold: 10,
  }),
  swift: new CircuitBreaker({
    name: "swift",
    failureThreshold: 3,
    timeout: 120_000,
    volumeThreshold: 5,
  }),
  sepa: new CircuitBreaker({
    name: "sepa",
    failureThreshold: 3,
    timeout: 120_000,
    volumeThreshold: 5,
  }),
  fxProvider: new CircuitBreaker({
    name: "fxProvider",
    failureThreshold: 5,
    timeout: 15_000,
    volumeThreshold: 20,
  }),
};

/**
 * Get all circuit breaker stats for the admin dashboard.
 */
export function getAllCircuitBreakerStats(): CircuitBreakerStats[] {
  return Object.values(circuitBreakers).map((cb) => cb.getStats());
}
