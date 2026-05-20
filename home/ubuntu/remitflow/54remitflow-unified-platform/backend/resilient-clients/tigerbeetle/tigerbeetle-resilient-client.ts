/**
 * TigerBeetle Resilient Client
 * 
 * Implements retry logic with exponential backoff and circuit breaker pattern
 * for reliable TigerBeetle operations in production environments.
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Circuit breaker pattern (Closed, Open, Half-Open states)
 * - Configurable timeout policies
 * - Comprehensive error handling
 * - Metrics and monitoring integration
 * - Type-safe TypeScript implementation
 * 
 * @module TigerBeetleResilientClient
 * @version 1.0.0
 * @author Manus AI
 * @date 2025-11-02
 */

import { createClient, Client, Account, Transfer, CreateAccountError, CreateTransferError } from 'tigerbeetle-node';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing, reject requests immediately
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier (e.g., 2 for exponential backoff) */
  backoffMultiplier: number;
  /** Add random jitter to prevent thundering herd */
  jitter: boolean;
  /** Timeout for each operation in milliseconds */
  timeoutMs: number;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in milliseconds to wait before attempting recovery */
  resetTimeoutMs: number;
  /** Number of successful requests in half-open state before closing */
  successThreshold: number;
  /** Time window in milliseconds for counting failures */
  windowMs: number;
}

/**
 * Client configuration
 */
export interface ResilientClientConfig {
  /** TigerBeetle cluster ID */
  clusterId: bigint;
  /** Replica addresses */
  replicaAddresses: string[];
  /** Retry configuration */
  retry: RetryConfig;
  /** Circuit breaker configuration */
  circuitBreaker: CircuitBreakerConfig;
  /** Enable detailed logging */
  enableLogging: boolean;
}

/**
 * Operation result with metadata
 */
export interface OperationResult<T> {
  /** Operation success status */
  success: boolean;
  /** Result data (if successful) */
  data?: T;
  /** Error information (if failed) */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Circuit breaker state during operation */
  circuitState: CircuitState;
}

/**
 * Circuit breaker metrics
 */
interface CircuitMetrics {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  lastStateChangeTime: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
  timeoutMs: 5000
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  successThreshold: 3,
  windowMs: 60000
};

// ============================================================================
// RESILIENT CLIENT IMPLEMENTATION
// ============================================================================

/**
 * TigerBeetle Resilient Client
 * 
 * Wraps the standard TigerBeetle client with retry logic and circuit breaker
 * to provide resilient operations in production environments.
 */
export class TigerBeetleResilientClient {
  private client: Client;
  private config: ResilientClientConfig;
  private circuitMetrics: CircuitMetrics;
  private failureTimestamps: number[] = [];

  constructor(config: Partial<ResilientClientConfig>) {
    // Merge with defaults
    this.config = {
      clusterId: config.clusterId || 0n,
      replicaAddresses: config.replicaAddresses || ['127.0.0.1:3000'],
      retry: { ...DEFAULT_RETRY_CONFIG, ...config.retry },
      circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config.circuitBreaker },
      enableLogging: config.enableLogging !== undefined ? config.enableLogging : true
    };

    // Initialize circuit breaker metrics
    this.circuitMetrics = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      lastStateChangeTime: Date.now(),
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0
    };

    // Create TigerBeetle client
    this.client = createClient({
      cluster_id: this.config.clusterId,
      replica_addresses: this.config.replicaAddresses
    });

    this.log('TigerBeetleResilientClient initialized', {
      clusterId: this.config.clusterId.toString(),
      replicas: this.config.replicaAddresses,
      retryConfig: this.config.retry,
      circuitBreakerConfig: this.config.circuitBreaker
    });
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Create accounts with retry logic and circuit breaker
   */
  async createAccounts(accounts: Account[]): Promise<OperationResult<CreateAccountError[]>> {
    return this.executeWithResilience(
      'createAccounts',
      () => this.client.createAccounts(accounts),
      accounts.length
    );
  }

  /**
   * Create transfers with retry logic and circuit breaker
   */
  async createTransfers(transfers: Transfer[]): Promise<OperationResult<CreateTransferError[]>> {
    return this.executeWithResilience(
      'createTransfers',
      () => this.client.createTransfers(transfers),
      transfers.length
    );
  }

  /**
   * Lookup accounts with retry logic and circuit breaker
   */
  async lookupAccounts(ids: bigint[]): Promise<OperationResult<Account[]>> {
    return this.executeWithResilience(
      'lookupAccounts',
      () => this.client.lookupAccounts(ids),
      ids.length
    );
  }

  /**
   * Lookup transfers with retry logic and circuit breaker
   */
  async lookupTransfers(ids: bigint[]): Promise<OperationResult<Transfer[]>> {
    return this.executeWithResilience(
      'lookupTransfers',
      () => this.client.lookupTransfers(ids),
      ids.length
    );
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics(): CircuitMetrics {
    return { ...this.circuitMetrics };
  }

  /**
   * Reset circuit breaker (for testing or manual intervention)
   */
  resetCircuitBreaker(): void {
    this.circuitMetrics = {
      ...this.circuitMetrics,
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      lastStateChangeTime: Date.now()
    };
    this.failureTimestamps = [];
    this.log('Circuit breaker manually reset');
  }

  /**
   * Close the client connection
   */
  async close(): Promise<void> {
    await this.client.destroy();
    this.log('TigerBeetleResilientClient closed');
  }

  // ==========================================================================
  // RESILIENCE IMPLEMENTATION
  // ==========================================================================

  /**
   * Execute operation with retry logic and circuit breaker
   */
  private async executeWithResilience<T>(
    operationName: string,
    operation: () => Promise<T>,
    batchSize: number
  ): Promise<OperationResult<T>> {
    const startTime = Date.now();
    let attempts = 0;
    let lastError: Error | undefined;

    this.circuitMetrics.totalRequests++;

    // Check circuit breaker state
    if (!this.canProceed()) {
      this.log(`Circuit breaker OPEN, rejecting ${operationName}`, {
        state: this.circuitMetrics.state,
        failureCount: this.circuitMetrics.failureCount
      });

      return {
        success: false,
        error: new Error(`Circuit breaker is OPEN. Service unavailable.`),
        attempts: 0,
        durationMs: Date.now() - startTime,
        circuitState: this.circuitMetrics.state
      };
    }

    // Retry loop with exponential backoff
    while (attempts < this.config.retry.maxAttempts) {
      attempts++;

      try {
        this.log(`${operationName} attempt ${attempts}/${this.config.retry.maxAttempts}`, {
          batchSize,
          circuitState: this.circuitMetrics.state
        });

        // Execute operation with timeout
        const result = await this.executeWithTimeout(operation, this.config.retry.timeoutMs);

        // Operation succeeded
        this.onSuccess();

        const durationMs = Date.now() - startTime;
        this.log(`${operationName} succeeded`, { attempts, durationMs });

        return {
          success: true,
          data: result,
          attempts,
          durationMs,
          circuitState: this.circuitMetrics.state
        };

      } catch (error) {
        lastError = error as Error;
        this.log(`${operationName} failed on attempt ${attempts}`, {
          error: lastError.message,
          circuitState: this.circuitMetrics.state
        });

        // Check if we should retry
        if (!this.shouldRetry(lastError, attempts)) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        if (attempts < this.config.retry.maxAttempts) {
          const delay = this.calculateDelay(attempts);
          this.log(`Retrying after ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.onFailure(lastError!);

    const durationMs = Date.now() - startTime;
    this.log(`${operationName} failed after ${attempts} attempts`, {
      error: lastError?.message,
      durationMs,
      circuitState: this.circuitMetrics.state
    });

    return {
      success: false,
      error: lastError,
      attempts,
      durationMs,
      circuitState: this.circuitMetrics.state
    };
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Calculate delay for next retry with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    const { initialDelayMs, maxDelayMs, backoffMultiplier, jitter } = this.config.retry;

    // Exponential backoff: delay = initialDelay * (multiplier ^ (attempt - 1))
    let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);

    // Cap at maximum delay
    delay = Math.min(delay, maxDelayMs);

    // Add jitter to prevent thundering herd
    if (jitter) {
      // Random jitter between 0% and 25% of delay
      const jitterAmount = delay * 0.25 * Math.random();
      delay += jitterAmount;
    }

    return Math.floor(delay);
  }

  /**
   * Determine if operation should be retried
   */
  private shouldRetry(error: Error, attempt: number): boolean {
    // Don't retry if max attempts reached
    if (attempt >= this.config.retry.maxAttempts) {
      return false;
    }

    // Retry on network errors, timeouts, and temporary failures
    const retryableErrors = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'timeout',
      'unavailable'
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableErrors.some(retryable => errorMessage.includes(retryable.toLowerCase()));
  }

  // ==========================================================================
  // CIRCUIT BREAKER IMPLEMENTATION
  // ==========================================================================

  /**
   * Check if operation can proceed based on circuit breaker state
   */
  private canProceed(): boolean {
    const now = Date.now();

    switch (this.circuitMetrics.state) {
      case CircuitState.CLOSED:
        // Normal operation
        return true;

      case CircuitState.OPEN:
        // Check if reset timeout has elapsed
        const timeSinceLastFailure = now - this.circuitMetrics.lastFailureTime;
        if (timeSinceLastFailure >= this.config.circuitBreaker.resetTimeoutMs) {
          // Transition to half-open state
          this.transitionTo(CircuitState.HALF_OPEN);
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited requests to test if service recovered
        return true;

      default:
        return false;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.circuitMetrics.totalSuccesses++;

    if (this.circuitMetrics.state === CircuitState.HALF_OPEN) {
      this.circuitMetrics.successCount++;

      // If enough successes, close the circuit
      if (this.circuitMetrics.successCount >= this.config.circuitBreaker.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        this.failureTimestamps = [];
      }
    } else if (this.circuitMetrics.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.circuitMetrics.failureCount = 0;
      this.cleanupOldFailures();
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: Error): void {
    const now = Date.now();
    this.circuitMetrics.totalFailures++;
    this.circuitMetrics.lastFailureTime = now;
    this.failureTimestamps.push(now);

    // Clean up old failures outside the window
    this.cleanupOldFailures();

    // Count failures within the window
    const recentFailures = this.failureTimestamps.length;

    if (this.circuitMetrics.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state opens the circuit
      this.transitionTo(CircuitState.OPEN);
      this.circuitMetrics.successCount = 0;

    } else if (this.circuitMetrics.state === CircuitState.CLOSED) {
      this.circuitMetrics.failureCount = recentFailures;

      // Open circuit if failure threshold exceeded
      if (recentFailures >= this.config.circuitBreaker.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Remove failure timestamps outside the time window
   */
  private cleanupOldFailures(): void {
    const now = Date.now();
    const windowStart = now - this.config.circuitBreaker.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter(timestamp => timestamp >= windowStart);
  }

  /**
   * Transition circuit breaker to new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.circuitMetrics.state;
    this.circuitMetrics.state = newState;
    this.circuitMetrics.lastStateChangeTime = Date.now();

    this.log(`Circuit breaker state transition: ${oldState} → ${newState}`, {
      failureCount: this.circuitMetrics.failureCount,
      successCount: this.circuitMetrics.successCount,
      totalRequests: this.circuitMetrics.totalRequests,
      totalFailures: this.circuitMetrics.totalFailures
    });
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log message with metadata
   */
  private log(message: string, metadata?: any): void {
    if (!this.config.enableLogging) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: 'INFO',
      message,
      ...metadata
    };

    console.log(JSON.stringify(logEntry));
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new resilient TigerBeetle client
 * 
 * @example
 * ```typescript
 * const client = createResilientClient({
 *   clusterId: 0n,
 *   replicaAddresses: ['127.0.0.1:3000', '127.0.0.1:3001'],
 *   retry: {
 *     maxAttempts: 5,
 *     initialDelayMs: 100,
 *     maxDelayMs: 10000
 *   },
 *   circuitBreaker: {
 *     failureThreshold: 5,
 *     resetTimeoutMs: 30000
 *   }
 * });
 * 
 * const result = await client.createAccounts([...]);
 * if (result.success) {
 *   console.log('Accounts created:', result.data);
 * } else {
 *   console.error('Failed after', result.attempts, 'attempts:', result.error);
 * }
 * ```
 */
export function createResilientClient(config: Partial<ResilientClientConfig>): TigerBeetleResilientClient {
  return new TigerBeetleResilientClient(config);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default TigerBeetleResilientClient;

