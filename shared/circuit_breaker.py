"""
RemitFlow Circuit Breaker Pattern
Resilience middleware for external API calls

States:
  CLOSED   — Normal operation, requests pass through
  OPEN     — Failure threshold exceeded, requests fail fast
  HALF_OPEN — Testing if service recovered (limited requests)

Usage:
    from shared.circuit_breaker import CircuitBreaker

    cb = CircuitBreaker(name="complyadvantage", failure_threshold=5, recovery_timeout=60)

    async def call_api():
        return await cb.call(_actual_api_call)

REQUIRED:
  - REDIS_URL (for distributed state across instances)
"""
from __future__ import annotations

import asyncio
import functools
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional, TypeVar

import httpx

logger = logging.getLogger(__name__)

# ─── Redis Configuration ─────────────────────────────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

_redis_client = None

def _get_redis():
    global _redis_client
    if _redis_client is None:
        try:
            import redis
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            _redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis unavailable for circuit breaker: {e}")
            _redis_client = False
    return _redis_client

T = TypeVar("T")

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreakerOpenException(Exception):
    """Raised when circuit breaker is OPEN and request is rejected."""
    pass

class CircuitBreaker:
    """Distributed circuit breaker with Redis-backed state."""

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        half_open_max_calls: int = 3,
        expected_exception: tuple = (Exception,),
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self.expected_exception = expected_exception
        self._key_prefix = f"cb:{name}"

    def _state_key(self) -> str:
        return f"{self._key_prefix}:state"

    def _failures_key(self) -> str:
        return f"{self._key_prefix}:failures"

    def _last_failure_key(self) -> str:
        return f"{self._key_prefix}:last_failure"

    def _half_open_calls_key(self) -> str:
        return f"{self._key_prefix}:half_open_calls"

    def _get_state(self) -> tuple[CircuitState, dict]:
        """Get current circuit state and metadata."""
        redis_client = _get_redis()
        if redis_client is False or redis_client is None:
            # Redis unavailable — operate in local-only mode (always closed)
            return CircuitState.CLOSED, {}

        state = redis_client.get(self._state_key())
        if not state:
            return CircuitState.CLOSED, {}

        metadata = {
            "failures": int(redis_client.get(self._failures_key()) or 0),
            "last_failure": redis_client.get(self._last_failure_key()),
            "half_open_calls": int(redis_client.get(self._half_open_calls_key()) or 0),
        }

        return CircuitState(state), metadata

    def _set_state(self, state: CircuitState):
        redis_client = _get_redis()
        if redis_client and redis_client is not False:
            redis_client.set(self._state_key(), state.value)

    def _record_success(self):
        redis_client = _get_redis()
        if redis_client and redis_client is not False:
            redis_client.delete(self._failures_key())
            redis_client.delete(self._last_failure_key())
            redis_client.delete(self._half_open_calls_key())
            self._set_state(CircuitState.CLOSED)

    def _record_failure(self):
        redis_client = _get_redis()
        if redis_client and redis_client is not False:
            failures = redis_client.incr(self._failures_key())
            redis_client.set(self._last_failure_key(), str(time.time()))

            if failures >= self.failure_threshold:
                self._set_state(CircuitState.OPEN)
                logger.warning(f"Circuit breaker '{self.name}' OPENED after {failures} failures")

    def _record_half_open_call(self):
        redis_client = _get_redis()
        if redis_client and redis_client is not False:
            calls = redis_client.incr(self._half_open_calls_key())
            if calls >= self.half_open_max_calls:
                self._set_state(CircuitState.OPEN)

    def _should_attempt_reset(self, metadata: dict) -> bool:
        last_failure = metadata.get("last_failure")
        if not last_failure:
            return True

        elapsed = time.time() - float(last_failure)
        return elapsed >= self.recovery_timeout

    async def call(self, func: Callable[..., T], *args, **kwargs) -> T:
        """Execute function with circuit breaker protection."""
        state, metadata = self._get_state()

        if state == CircuitState.OPEN:
            if self._should_attempt_reset(metadata):
                self._set_state(CircuitState.HALF_OPEN)
                logger.info(f"Circuit breaker '{self.name}' entering HALF_OPEN state")
            else:
                raise CircuitBreakerOpenException(
                    f"Circuit breaker '{self.name}' is OPEN. "
                    f"Service temporarily unavailable. Retry after {self.recovery_timeout} seconds."
                )

        if state == CircuitState.HALF_OPEN:
            self._record_half_open_call()

        try:
            if asyncio.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                result = func(*args, **kwargs)

            self._record_success()
            return result

        except self.expected_exception as e:
            self._record_failure()
            raise

    def __call__(self, func: Callable) -> Callable:
        """Decorator usage."""
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            return await self.call(func, *args, **kwargs)
        return wrapper

    def get_status(self) -> dict:
        """Get current circuit breaker status for monitoring."""
        state, metadata = self._get_state()

        return {
            "name": self.name,
            "state": state.value,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout": self.recovery_timeout,
            "half_open_max_calls": self.half_open_max_calls,
            "current_failures": metadata.get("failures", 0),
            "last_failure": metadata.get("last_failure"),
            "half_open_calls": metadata.get("half_open_calls", 0),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

# ─── Pre-configured Circuit Breakers ───────────────────────────────────────────

CIRCUIT_BREAKERS = {
    "complyadvantage": CircuitBreaker("complyadvantage", failure_threshold=5, recovery_timeout=60),
    "dowjones": CircuitBreaker("dowjones", failure_threshold=5, recovery_timeout=60),
    "treasury_prime": CircuitBreaker("treasury_prime", failure_threshold=3, recovery_timeout=30),
    "sygna_bridge": CircuitBreaker("sygna_bridge", failure_threshold=5, recovery_timeout=120),
    "trisa": CircuitBreaker("trisa", failure_threshold=3, recovery_timeout=60),
    "exchangerate_api": CircuitBreaker("exchangerate_api", failure_threshold=10, recovery_timeout=30),
    "openexchangerates": CircuitBreaker("openexchangerates", failure_threshold=10, recovery_timeout=30),
    "nca_sar": CircuitBreaker("nca_sar", failure_threshold=3, recovery_timeout=300),
    "fincen_sar": CircuitBreaker("fincen_sar", failure_threshold=3, recovery_timeout=300),
    "kafka": CircuitBreaker("kafka", failure_threshold=10, recovery_timeout=30),
}

def get_circuit_breaker(name: str) -> CircuitBreaker:
    if name not in CIRCUIT_BREAKERS:
        raise ValueError(f"Unknown circuit breaker: {name}")
    return CIRCUIT_BREAKERS[name]
