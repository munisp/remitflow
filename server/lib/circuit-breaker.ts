/**
 * RemitFlow — Circuit Breaker (TypeScript)
 * ══════════════════════════════════════════
 * Implements the circuit breaker pattern to prevent cascading failures
 * when downstream services (TigerBeetle, Temporal, Permify, etc.) are
 * unavailable or slow.
 *
 * States:
 *   CLOSED   → Normal operation. Requests pass through.
 *   OPEN     → Service is failing. Requests fail fast without calling downstream.
 *   HALF_OPEN → Testing recovery. One request is allowed through.
 *
 * Configuration per service:
 *   - failureThreshold: failures before opening (default: 5)
 *   - successThreshold: successes to close from half-open (default: 2)
 *   - timeout: ms before trying half-open (default: 30000)
 *   - volumeThreshold: min requests before evaluating (default: 10)
 */

import { logger } from "../_core/logger";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  volumeThreshold?: number;
  onOpen?: (name: string) => void;
  onClose?: (name: string) => void;
  onHalfOpen?: (name: string) => void;
}

export class CircuitBreakerOpenError extends Error {
  constructor(public readonly serviceName: string) {
    super(`Circuit breaker OPEN for service: ${serviceName}`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private requestCount = 0;
  private lastFailureTime = 0;
  private nextAttemptTime = 0;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly volumeThreshold: number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 30000;
    this.volumeThreshold = options.volumeThreshold ?? 10;
  }

  get name(): string {
    return this.options.name;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get stats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      requestCount: this.requestCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() < this.nextAttemptTime) {
        throw new CircuitBreakerOpenError(this.options.name);
      }
      // Transition to HALF_OPEN to test recovery
      this.transitionTo("HALF_OPEN");
    }

    this.requestCount++;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err as Error);
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.transitionTo("CLOSED");
      }
    }
  }

  private onFailure(err: Error): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;
    this.successCount = 0;

    if (
      this.state === "HALF_OPEN" ||
      (this.state === "CLOSED" &&
        this.requestCount >= this.volumeThreshold &&
        this.failureCount >= this.failureThreshold)
    ) {
      this.transitionTo("OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === "OPEN") {
      this.nextAttemptTime = Date.now() + this.timeout;
      logger.warn(
        { service: this.options.name, failureCount: this.failureCount },
        `[CircuitBreaker] ${this.options.name} OPENED after ${this.failureCount} failures`
      );
      this.options.onOpen?.(this.options.name);
    } else if (newState === "CLOSED") {
      this.failureCount = 0;
      this.successCount = 0;
      this.requestCount = 0;
      logger.info(
        { service: this.options.name },
        `[CircuitBreaker] ${this.options.name} CLOSED — service recovered`
      );
      this.options.onClose?.(this.options.name);
    } else if (newState === "HALF_OPEN") {
      this.successCount = 0;
      logger.info(
        { service: this.options.name },
        `[CircuitBreaker] ${this.options.name} HALF_OPEN — testing recovery`
      );
      this.options.onHalfOpen?.(this.options.name);
    }
  }

  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.successCount = 0;
    this.requestCount = 0;
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;
  }
}

// ─── Global Circuit Breaker Registry ─────────────────────────────────────────

class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  register(options: CircuitBreakerOptions): CircuitBreaker {
    const breaker = new CircuitBreaker(options);
    this.breakers.set(options.name, breaker);
    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getOrCreate(options: CircuitBreakerOptions): CircuitBreaker {
    return this.breakers.get(options.name) ?? this.register(options);
  }

  getAll(): Map<string, CircuitBreaker> {
    return this.breakers;
  }

  getAllStats(): Record<string, ReturnType<CircuitBreaker["stats"]["valueOf"]>> {
    const stats: Record<string, any> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.stats;
    }
    return stats;
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();

// ─── Pre-registered Breakers for All Downstream Services ─────────────────────

export const breakers = {
  tigerBeetle: circuitBreakerRegistry.register({
    name: "TigerBeetle",
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 15000,
    volumeThreshold: 5,
  }),
  temporal: circuitBreakerRegistry.register({
    name: "Temporal",
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
    volumeThreshold: 10,
  }),
  permify: circuitBreakerRegistry.register({
    name: "Permify",
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 20000,
    volumeThreshold: 10,
  }),
  keycloak: circuitBreakerRegistry.register({
    name: "Keycloak",
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 20000,
    volumeThreshold: 5,
  }),
  amlScorer: circuitBreakerRegistry.register({
    name: "AMLScorer",
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 10000,
    volumeThreshold: 5,
  }),
  fluvio: circuitBreakerRegistry.register({
    name: "Fluvio",
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 15000,
    volumeThreshold: 10,
  }),
  redis: circuitBreakerRegistry.register({
    name: "Redis",
    failureThreshold: 10,
    successThreshold: 3,
    timeout: 5000,
    volumeThreshold: 20,
  }),
  dapr: circuitBreakerRegistry.register({
    name: "Dapr",
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 15000,
    volumeThreshold: 10,
  }),
  cryptoUtils: circuitBreakerRegistry.register({
    name: "CryptoUtils",
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 10000,
    volumeThreshold: 5,
  }),
  rateLimiter: circuitBreakerRegistry.register({
    name: "RateLimiter",
    failureThreshold: 10,
    successThreshold: 3,
    timeout: 5000,
    volumeThreshold: 20,
  }),
};

// ─── Retry with Circuit Breaker ───────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 10000;
  const jitter = options.jitter ?? true;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      // Don't retry circuit breaker errors
      if (err instanceof CircuitBreakerOpenError) {
        throw err;
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
        const actualDelay = jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
        await new Promise((resolve) => setTimeout(resolve, actualDelay));
      }
    }
  }

  throw lastError!;
}

// ─── Convenience: Execute with Circuit Breaker + Retry ───────────────────────

export async function withCircuitBreaker<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
  retryOptions?: RetryOptions
): Promise<T> {
  return breaker.execute(() => withRetry(fn, retryOptions));
}
