"""
Common utilities for core services.

This module provides shared functionality across all microservices including:
- Circuit breaker pattern for resilient service calls
- Database connection and session management
- OAuth2/JWT authentication middleware
- Prometheus metrics instrumentation
- Kafka event publishing
- Vault secrets management
"""

from .circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitBreakerError,
    CircuitBreakerRegistry,
    CircuitState,
    get_circuit_breaker,
    circuit_breaker,
)

__all__ = [
    # Circuit Breaker
    "CircuitBreaker",
    "CircuitBreakerConfig",
    "CircuitBreakerError",
    "CircuitBreakerRegistry",
    "CircuitState",
    "get_circuit_breaker",
    "circuit_breaker",
]
