/**
 * circuitBreaker.ts — Re-exports CircuitBreaker from circuit-breaker.ts with
 * a compatibility shim for the { failureThreshold, resetTimeoutMs } options shape.
 */
export { CircuitBreakerOpenError, circuitBreakerRegistry, breakers, getAllCircuitStatus } from "./circuit-breaker";
export type { CircuitState, CircuitBreakerOptions } from "./circuit-breaker";
import { CircuitBreaker as _CircuitBreaker } from "./circuit-breaker";

interface CompatOptions {
  failureThreshold?: number;
  successThreshold?: number;
  resetTimeoutMs?: number;
  timeout?: number;
  volumeThreshold?: number;
}

/**
 * CircuitBreaker with compatibility for both `timeout` and `resetTimeoutMs` option names.
 */
export class CircuitBreaker extends _CircuitBreaker {
  constructor(name: string, options: CompatOptions = {}) {
    super({
      name,
      failureThreshold: options.failureThreshold,
      successThreshold: options.successThreshold,
      timeout: options.resetTimeoutMs ?? options.timeout,
      volumeThreshold: options.volumeThreshold,
    });
  }
}
