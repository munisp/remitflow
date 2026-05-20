"""
Circuit Breaker Pattern Implementation

Provides resilience for service-to-service communication by preventing
cascading failures when downstream services are unavailable.

States:
- CLOSED: Normal operation, requests pass through
- OPEN: Service is failing, requests are rejected immediately
- HALF_OPEN: Testing if service has recovered
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Optional, TypeVar, Generic
from functools import wraps

logger = logging.getLogger(__name__)

T = TypeVar('T')


class CircuitState(str, Enum):
    """Circuit breaker states"""
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker behavior"""
    failure_threshold: int = 5
    recovery_timeout: float = 30.0
    half_open_requests: int = 3
    success_threshold: int = 2
    timeout: float = 10.0
    excluded_exceptions: tuple = ()


@dataclass
class CircuitBreakerStats:
    """Statistics for circuit breaker monitoring"""
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    rejected_requests: int = 0
    last_failure_time: Optional[float] = None
    last_success_time: Optional[float] = None
    state_changes: int = 0
    consecutive_failures: int = 0
    consecutive_successes: int = 0


class CircuitBreakerError(Exception):
    """Raised when circuit breaker is open"""
    def __init__(self, service_name: str, state: CircuitState, retry_after: float):
        self.service_name = service_name
        self.state = state
        self.retry_after = retry_after
        super().__init__(
            f"Circuit breaker for '{service_name}' is {state.value}. "
            f"Retry after {retry_after:.1f} seconds."
        )


class CircuitBreaker:
    """
    Circuit breaker implementation for resilient service calls.
    
    Usage:
        breaker = CircuitBreaker("payment-service")
        
        @breaker
        async def call_payment_service():
            ...
        
        # Or use directly
        result = await breaker.call(some_async_function, arg1, arg2)
    """
    
    def __init__(
        self,
        name: str,
        config: Optional[CircuitBreakerConfig] = None
    ):
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self._state = CircuitState.CLOSED
        self._stats = CircuitBreakerStats()
        self._last_state_change = time.time()
        self._half_open_requests = 0
        self._lock = asyncio.Lock()
        
        logger.info(f"Circuit breaker '{name}' initialized with config: {self.config}")
    
    @property
    def state(self) -> CircuitState:
        """Get current circuit state"""
        return self._state
    
    @property
    def stats(self) -> CircuitBreakerStats:
        """Get circuit breaker statistics"""
        return self._stats
    
    @property
    def is_closed(self) -> bool:
        """Check if circuit is closed (normal operation)"""
        return self._state == CircuitState.CLOSED
    
    @property
    def is_open(self) -> bool:
        """Check if circuit is open (rejecting requests)"""
        return self._state == CircuitState.OPEN
    
    @property
    def is_half_open(self) -> bool:
        """Check if circuit is half-open (testing recovery)"""
        return self._state == CircuitState.HALF_OPEN
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to attempt reset"""
        if self._state != CircuitState.OPEN:
            return False
        
        time_since_open = time.time() - self._last_state_change
        return time_since_open >= self.config.recovery_timeout
    
    def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state"""
        if self._state != new_state:
            old_state = self._state
            self._state = new_state
            self._last_state_change = time.time()
            self._stats.state_changes += 1
            
            if new_state == CircuitState.HALF_OPEN:
                self._half_open_requests = 0
            
            logger.warning(
                f"Circuit breaker '{self.name}' transitioned from "
                f"{old_state.value} to {new_state.value}"
            )
    
    def _record_success(self) -> None:
        """Record a successful request"""
        self._stats.total_requests += 1
        self._stats.successful_requests += 1
        self._stats.last_success_time = time.time()
        self._stats.consecutive_successes += 1
        self._stats.consecutive_failures = 0
        
        if self._state == CircuitState.HALF_OPEN:
            if self._stats.consecutive_successes >= self.config.success_threshold:
                self._transition_to(CircuitState.CLOSED)
    
    def _record_failure(self, exception: Exception) -> None:
        """Record a failed request"""
        self._stats.total_requests += 1
        self._stats.failed_requests += 1
        self._stats.last_failure_time = time.time()
        self._stats.consecutive_failures += 1
        self._stats.consecutive_successes = 0
        
        logger.error(
            f"Circuit breaker '{self.name}' recorded failure: {exception}"
        )
        
        if self._state == CircuitState.CLOSED:
            if self._stats.consecutive_failures >= self.config.failure_threshold:
                self._transition_to(CircuitState.OPEN)
        elif self._state == CircuitState.HALF_OPEN:
            self._transition_to(CircuitState.OPEN)
    
    def _record_rejection(self) -> None:
        """Record a rejected request"""
        self._stats.total_requests += 1
        self._stats.rejected_requests += 1
    
    async def _can_execute(self) -> bool:
        """Check if a request can be executed"""
        async with self._lock:
            if self._state == CircuitState.CLOSED:
                return True
            
            if self._state == CircuitState.OPEN:
                if self._should_attempt_reset():
                    self._transition_to(CircuitState.HALF_OPEN)
                    self._half_open_requests = 1
                    return True
                return False
            
            if self._state == CircuitState.HALF_OPEN:
                if self._half_open_requests < self.config.half_open_requests:
                    self._half_open_requests += 1
                    return True
                return False
            
            return False
    
    def _get_retry_after(self) -> float:
        """Calculate time until retry is allowed"""
        if self._state != CircuitState.OPEN:
            return 0.0
        
        time_since_open = time.time() - self._last_state_change
        return max(0.0, self.config.recovery_timeout - time_since_open)
    
    async def call(
        self,
        func: Callable[..., Any],
        *args,
        **kwargs
    ) -> Any:
        """
        Execute a function through the circuit breaker.
        
        Args:
            func: Async function to execute
            *args: Positional arguments for the function
            **kwargs: Keyword arguments for the function
            
        Returns:
            Result of the function call
            
        Raises:
            CircuitBreakerError: If circuit is open
            Exception: If the function raises an exception
        """
        if not await self._can_execute():
            self._record_rejection()
            raise CircuitBreakerError(
                self.name,
                self._state,
                self._get_retry_after()
            )
        
        try:
            if asyncio.iscoroutinefunction(func):
                result = await asyncio.wait_for(
                    func(*args, **kwargs),
                    timeout=self.config.timeout
                )
            else:
                result = func(*args, **kwargs)
            
            self._record_success()
            return result
            
        except asyncio.TimeoutError as e:
            self._record_failure(e)
            raise
        except self.config.excluded_exceptions:
            self._record_success()
            raise
        except Exception as e:
            self._record_failure(e)
            raise
    
    def __call__(self, func: Callable[..., T]) -> Callable[..., T]:
        """Decorator for wrapping functions with circuit breaker"""
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await self.call(func, *args, **kwargs)
        return wrapper
    
    def reset(self) -> None:
        """Manually reset the circuit breaker to closed state"""
        self._transition_to(CircuitState.CLOSED)
        self._stats.consecutive_failures = 0
        self._stats.consecutive_successes = 0
        logger.info(f"Circuit breaker '{self.name}' manually reset")
    
    def get_health(self) -> Dict[str, Any]:
        """Get health information for monitoring"""
        return {
            "name": self.name,
            "state": self._state.value,
            "stats": {
                "total_requests": self._stats.total_requests,
                "successful_requests": self._stats.successful_requests,
                "failed_requests": self._stats.failed_requests,
                "rejected_requests": self._stats.rejected_requests,
                "consecutive_failures": self._stats.consecutive_failures,
                "consecutive_successes": self._stats.consecutive_successes,
                "state_changes": self._stats.state_changes,
            },
            "config": {
                "failure_threshold": self.config.failure_threshold,
                "recovery_timeout": self.config.recovery_timeout,
                "half_open_requests": self.config.half_open_requests,
            },
            "retry_after": self._get_retry_after() if self.is_open else None,
        }


class CircuitBreakerRegistry:
    """
    Registry for managing multiple circuit breakers.
    
    Usage:
        registry = CircuitBreakerRegistry()
        
        # Get or create a circuit breaker
        breaker = registry.get("payment-service")
        
        # Get all circuit breakers health
        health = registry.get_all_health()
    """
    
    _instance: Optional['CircuitBreakerRegistry'] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._breakers: Dict[str, CircuitBreaker] = {}
            cls._instance._default_config = CircuitBreakerConfig()
        return cls._instance
    
    def get(
        self,
        name: str,
        config: Optional[CircuitBreakerConfig] = None
    ) -> CircuitBreaker:
        """Get or create a circuit breaker by name"""
        if name not in self._breakers:
            self._breakers[name] = CircuitBreaker(
                name,
                config or self._default_config
            )
        return self._breakers[name]
    
    def set_default_config(self, config: CircuitBreakerConfig) -> None:
        """Set default configuration for new circuit breakers"""
        self._default_config = config
    
    def get_all_health(self) -> Dict[str, Dict[str, Any]]:
        """Get health information for all circuit breakers"""
        return {
            name: breaker.get_health()
            for name, breaker in self._breakers.items()
        }
    
    def reset_all(self) -> None:
        """Reset all circuit breakers"""
        for breaker in self._breakers.values():
            breaker.reset()
    
    def remove(self, name: str) -> None:
        """Remove a circuit breaker from the registry"""
        if name in self._breakers:
            del self._breakers[name]


def get_circuit_breaker(
    name: str,
    config: Optional[CircuitBreakerConfig] = None
) -> CircuitBreaker:
    """
    Convenience function to get a circuit breaker from the global registry.
    
    Args:
        name: Name of the circuit breaker (usually service name)
        config: Optional configuration override
        
    Returns:
        CircuitBreaker instance
    """
    return CircuitBreakerRegistry().get(name, config)


def circuit_breaker(
    name: str,
    config: Optional[CircuitBreakerConfig] = None
):
    """
    Decorator factory for applying circuit breaker to functions.
    
    Usage:
        @circuit_breaker("payment-service")
        async def call_payment_service():
            ...
    """
    breaker = get_circuit_breaker(name, config)
    return breaker
