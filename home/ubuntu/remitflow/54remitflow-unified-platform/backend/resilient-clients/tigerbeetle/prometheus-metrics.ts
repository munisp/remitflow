/**
 * Prometheus Metrics Exporter for TigerBeetle Resilient Client
 * 
 * Exports circuit breaker and retry metrics to Prometheus for monitoring
 * 
 * @module PrometheusMetrics
 * @version 1.0.0
 */

import { register, Counter, Histogram, Gauge } from 'prom-client';
import { CircuitState, CircuitMetrics, OperationResult } from './tigerbeetle-resilient-client';

// ============================================================================
// METRIC DEFINITIONS
// ============================================================================

/**
 * Circuit breaker state gauge
 * Values: 0 = CLOSED, 1 = OPEN, 2 = HALF_OPEN
 */
export const circuitBreakerStateGauge = new Gauge({
  name: 'tigerbeetle_circuit_breaker_state',
  help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
  labelNames: ['operation']
});

/**
 * Total requests counter
 */
export const requestCounter = new Counter({
  name: 'tigerbeetle_requests_total',
  help: 'Total number of TigerBeetle requests',
  labelNames: ['operation', 'status']
});

/**
 * Retry attempts counter
 */
export const retryCounter = new Counter({
  name: 'tigerbeetle_retries_total',
  help: 'Total number of retry attempts',
  labelNames: ['operation']
});

/**
 * Operation duration histogram
 */
export const durationHistogram = new Histogram({
  name: 'tigerbeetle_operation_duration_ms',
  help: 'Operation duration in milliseconds',
  labelNames: ['operation', 'status'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
});

/**
 * Circuit breaker failure count gauge
 */
export const failureCountGauge = new Gauge({
  name: 'tigerbeetle_circuit_breaker_failure_count',
  help: 'Current number of failures in the circuit breaker window',
  labelNames: ['operation']
});

/**
 * Circuit breaker success count gauge (in half-open state)
 */
export const successCountGauge = new Gauge({
  name: 'tigerbeetle_circuit_breaker_success_count',
  help: 'Current number of successes in half-open state',
  labelNames: ['operation']
});

/**
 * Total circuit breaker state transitions counter
 */
export const stateTransitionCounter = new Counter({
  name: 'tigerbeetle_circuit_breaker_state_transitions_total',
  help: 'Total number of circuit breaker state transitions',
  labelNames: ['from_state', 'to_state']
});

/**
 * Success rate gauge
 */
export const successRateGauge = new Gauge({
  name: 'tigerbeetle_success_rate',
  help: 'Success rate of TigerBeetle operations (0-1)',
  labelNames: ['operation']
});

// ============================================================================
// METRIC RECORDING FUNCTIONS
// ============================================================================

/**
 * Record operation result metrics
 */
export function recordOperationMetrics(
  operationName: string,
  result: OperationResult<any>
): void {
  // Record request
  requestCounter.inc({
    operation: operationName,
    status: result.success ? 'success' : 'failure'
  });

  // Record retries (if any)
  if (result.attempts > 1) {
    retryCounter.inc({
      operation: operationName
    }, result.attempts - 1);
  }

  // Record duration
  durationHistogram.observe({
    operation: operationName,
    status: result.success ? 'success' : 'failure'
  }, result.durationMs);

  // Record circuit breaker state
  const stateValue = circuitStateToNumber(result.circuitState);
  circuitBreakerStateGauge.set({ operation: operationName }, stateValue);
}

/**
 * Record circuit breaker metrics
 */
export function recordCircuitBreakerMetrics(
  operationName: string,
  metrics: CircuitMetrics
): void {
  // Record state
  const stateValue = circuitStateToNumber(metrics.state);
  circuitBreakerStateGauge.set({ operation: operationName }, stateValue);

  // Record failure count
  failureCountGauge.set({ operation: operationName }, metrics.failureCount);

  // Record success count (in half-open state)
  successCountGauge.set({ operation: operationName }, metrics.successCount);

  // Calculate and record success rate
  if (metrics.totalRequests > 0) {
    const successRate = metrics.totalSuccesses / metrics.totalRequests;
    successRateGauge.set({ operation: operationName }, successRate);
  }
}

/**
 * Record circuit breaker state transition
 */
export function recordStateTransition(fromState: CircuitState, toState: CircuitState): void {
  stateTransitionCounter.inc({
    from_state: fromState,
    to_state: toState
  });
}

/**
 * Convert circuit state enum to number for Prometheus gauge
 */
function circuitStateToNumber(state: CircuitState): number {
  switch (state) {
    case CircuitState.CLOSED:
      return 0;
    case CircuitState.OPEN:
      return 1;
    case CircuitState.HALF_OPEN:
      return 2;
    default:
      return -1;
  }
}

// ============================================================================
// METRICS ENDPOINT
// ============================================================================

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/**
 * Get metrics as JSON
 */
export async function getMetricsJSON(): Promise<any> {
  return register.getMetricsAsJSON();
}

/**
 * Clear all metrics (for testing)
 */
export function clearMetrics(): void {
  register.clear();
}

// ============================================================================
// EXPRESS MIDDLEWARE
// ============================================================================

/**
 * Express middleware to expose Prometheus metrics endpoint
 * 
 * Usage:
 * ```typescript
 * import express from 'express';
 * import { metricsMiddleware } from './prometheus-metrics';
 * 
 * const app = express();
 * app.get('/metrics', metricsMiddleware);
 * ```
 */
export async function metricsMiddleware(req: any, res: any): Promise<void> {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await getMetrics();
    res.end(metrics);
  } catch (error) {
    res.status(500).end(error);
  }
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

/**
 * Example: Recording metrics after an operation
 * 
 * ```typescript
 * import { getTigerBeetleClient } from './example-integration';
 * import { recordOperationMetrics, recordCircuitBreakerMetrics } from './prometheus-metrics';
 * 
 * const client = getTigerBeetleClient();
 * const result = await client.createTransfers(transfers);
 * 
 * // Record operation metrics
 * recordOperationMetrics('createTransfers', result);
 * 
 * // Record circuit breaker metrics
 * const metrics = client.getMetrics();
 * recordCircuitBreakerMetrics('createTransfers', metrics);
 * ```
 */

// ============================================================================
// PERIODIC METRICS COLLECTION
// ============================================================================

/**
 * Start periodic metrics collection
 * 
 * @param client TigerBeetle resilient client instance
 * @param intervalMs Collection interval in milliseconds (default: 10000)
 */
export function startPeriodicMetricsCollection(
  client: any,
  intervalMs: number = 10000
): NodeJS.Timer {
  const interval = setInterval(() => {
    const metrics = client.getMetrics();
    
    // Record metrics for all operations
    recordCircuitBreakerMetrics('global', metrics);
    
  }, intervalMs);

  return interval;
}

/**
 * Stop periodic metrics collection
 */
export function stopPeriodicMetricsCollection(interval: NodeJS.Timer): void {
  clearInterval(interval);
}

