"""
Resilience Patterns for Mojaloop
Implements circuit breaker, retry, timeout, and bulkhead patterns
"""

import asyncio
import time
import logging
from typing import Callable, Any, Optional, Dict
from enum import Enum
from datetime import datetime, timedelta
from functools import wraps
import random

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    """Circuit breaker states"""
    CLOSED = "CLOSED"  # Normal operation
    OPEN = "OPEN"      # Failing, reject requests
    HALF_OPEN = "HALF_OPEN"  # Testing if service recovered


class CircuitBreaker:
    """
    Circuit Breaker Pattern
    Prevents cascading failures by failing fast when a service is down
    """
    
    def __init__(
        self,
        failure_threshold: int = 5,
        success_threshold: int = 2,
        timeout: float = 60.0,
        name: str = "circuit_breaker"
    ):
        """
        Initialize circuit breaker
        
        Args:
            failure_threshold: Number of failures before opening circuit
            success_threshold: Number of successes in half-open before closing
            timeout: Seconds to wait before trying half-open
            name: Circuit breaker name for logging
        """
        self.failure_threshold = failure_threshold
        self.success_threshold = success_threshold
        self.timeout = timeout
        self.name = name
        
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None
        self.last_state_change = datetime.now()
    
    def call(self, func: Callable, *args, **kwargs) -> Any:
        """Execute function with circuit breaker protection"""
        if self.state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self.state = CircuitState.HALF_OPEN
                logger.info(f"Circuit breaker '{self.name}' entering HALF_OPEN state")
            else:
                raise CircuitBreakerOpenError(
                    f"Circuit breaker '{self.name}' is OPEN"
                )
        
        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise
    
    async def call_async(self, func: Callable, *args, **kwargs) -> Any:
        """Execute async function with circuit breaker protection"""
        if self.state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self.state = CircuitState.HALF_OPEN
                logger.info(f"Circuit breaker '{self.name}' entering HALF_OPEN state")
            else:
                raise CircuitBreakerOpenError(
                    f"Circuit breaker '{self.name}' is OPEN"
                )
        
        try:
            result = await func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise
    
    def _on_success(self):
        """Handle successful call"""
        if self.state == CircuitState.HALF_OPEN:
            self.success_count += 1
            if self.success_count >= self.success_threshold:
                self._close_circuit()
        elif self.state == CircuitState.CLOSED:
            self.failure_count = 0
    
    def _on_failure(self):
        """Handle failed call"""
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.state == CircuitState.HALF_OPEN:
            self._open_circuit()
        elif self.failure_count >= self.failure_threshold:
            self._open_circuit()
    
    def _open_circuit(self):
        """Open the circuit"""
        self.state = CircuitState.OPEN
        self.last_state_change = datetime.now()
        logger.warning(
            f"Circuit breaker '{self.name}' OPENED after {self.failure_count} failures"
        )
    
    def _close_circuit(self):
        """Close the circuit"""
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_state_change = datetime.now()
        logger.info(f"Circuit breaker '{self.name}' CLOSED")
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to attempt reset"""
        if self.last_failure_time is None:
            return True
        return (time.time() - self.last_failure_time) >= self.timeout
    
    def get_state(self) -> Dict[str, Any]:
        """Get circuit breaker state"""
        return {
            'name': self.name,
            'state': self.state.value,
            'failure_count': self.failure_count,
            'success_count': self.success_count,
            'last_state_change': self.last_state_change.isoformat()
        }


class CircuitBreakerOpenError(Exception):
    """Raised when circuit breaker is open"""
    pass


class RetryPolicy:
    """
    Retry Pattern with Exponential Backoff
    Automatically retries failed operations with increasing delays
    """
    
    def __init__(
        self,
        max_attempts: int = 3,
        initial_delay: float = 1.0,
        max_delay: float = 60.0,
        exponential_base: float = 2.0,
        jitter: bool = True
    ):
        """
        Initialize retry policy
        
        Args:
            max_attempts: Maximum number of retry attempts
            initial_delay: Initial delay in seconds
            max_delay: Maximum delay in seconds
            exponential_base: Base for exponential backoff
            jitter: Add random jitter to delays
        """
        self.max_attempts = max_attempts
        self.initial_delay = initial_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter
    
    def execute(self, func: Callable, *args, **kwargs) -> Any:
        """Execute function with retry logic"""
        last_exception = None
        
        for attempt in range(self.max_attempts):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                last_exception = e
                
                if attempt < self.max_attempts - 1:
                    delay = self._calculate_delay(attempt)
                    logger.warning(
                        f"Attempt {attempt + 1}/{self.max_attempts} failed: {e}. "
                        f"Retrying in {delay:.2f}s..."
                    )
                    time.sleep(delay)
                else:
                    logger.error(
                        f"All {self.max_attempts} attempts failed. Last error: {e}"
                    )
        
        raise last_exception
    
    async def execute_async(self, func: Callable, *args, **kwargs) -> Any:
        """Execute async function with retry logic"""
        last_exception = None
        
        for attempt in range(self.max_attempts):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                last_exception = e
                
                if attempt < self.max_attempts - 1:
                    delay = self._calculate_delay(attempt)
                    logger.warning(
                        f"Attempt {attempt + 1}/{self.max_attempts} failed: {e}. "
                        f"Retrying in {delay:.2f}s..."
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        f"All {self.max_attempts} attempts failed. Last error: {e}"
                    )
        
        raise last_exception
    
    def _calculate_delay(self, attempt: int) -> float:
        """Calculate delay for retry attempt"""
        delay = min(
            self.initial_delay * (self.exponential_base ** attempt),
            self.max_delay
        )
        
        if self.jitter:
            # Add random jitter (±25%)
            jitter_amount = delay * 0.25
            delay += random.uniform(-jitter_amount, jitter_amount)
        
        return max(0, delay)


class Timeout:
    """
    Timeout Pattern
    Ensures operations don't hang indefinitely
    """
    
    def __init__(self, seconds: float):
        """
        Initialize timeout
        
        Args:
            seconds: Timeout in seconds
        """
        self.seconds = seconds
    
    def execute(self, func: Callable, *args, **kwargs) -> Any:
        """Execute function with timeout"""
        import signal
        
        def timeout_handler(signum, frame):
            raise TimeoutError(f"Operation timed out after {self.seconds} seconds")
        
        # Set timeout alarm
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(int(self.seconds))
        
        try:
            result = func(*args, **kwargs)
            signal.alarm(0)  # Cancel alarm
            return result
        except TimeoutError:
            logger.error(f"Operation timed out after {self.seconds} seconds")
            raise
    
    async def execute_async(self, func: Callable, *args, **kwargs) -> Any:
        """Execute async function with timeout"""
        try:
            return await asyncio.wait_for(
                func(*args, **kwargs),
                timeout=self.seconds
            )
        except asyncio.TimeoutError:
            logger.error(f"Async operation timed out after {self.seconds} seconds")
            raise TimeoutError(f"Operation timed out after {self.seconds} seconds")


class Bulkhead:
    """
    Bulkhead Pattern
    Limits concurrent operations to prevent resource exhaustion
    """
    
    def __init__(self, max_concurrent: int = 10):
        """
        Initialize bulkhead
        
        Args:
            max_concurrent: Maximum concurrent operations
        """
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.current_count = 0
    
    async def execute(self, func: Callable, *args, **kwargs) -> Any:
        """Execute function with concurrency limit"""
        async with self.semaphore:
            self.current_count += 1
            try:
                return await func(*args, **kwargs)
            finally:
                self.current_count -= 1
    
    def get_stats(self) -> Dict[str, int]:
        """Get bulkhead statistics"""
        return {
            'max_concurrent': self.max_concurrent,
            'current_count': self.current_count,
            'available': self.max_concurrent - self.current_count
        }


class ResilientClient:
    """
    Resilient HTTP client with all patterns combined
    """
    
    def __init__(
        self,
        name: str,
        circuit_breaker: Optional[CircuitBreaker] = None,
        retry_policy: Optional[RetryPolicy] = None,
        timeout: Optional[Timeout] = None,
        bulkhead: Optional[Bulkhead] = None
    ):
        """Initialize resilient client"""
        self.name = name
        self.circuit_breaker = circuit_breaker or CircuitBreaker(name=name)
        self.retry_policy = retry_policy or RetryPolicy()
        self.timeout = timeout or Timeout(30.0)
        self.bulkhead = bulkhead or Bulkhead(max_concurrent=100)
    
    async def call(self, func: Callable, *args, **kwargs) -> Any:
        """
        Execute function with all resilience patterns
        Order: Bulkhead -> Circuit Breaker -> Retry -> Timeout -> Function
        """
        async def execute_with_patterns():
            # Apply circuit breaker
            async def with_circuit_breaker():
                return await self.circuit_breaker.call_async(
                    self._execute_with_retry,
                    func, *args, **kwargs
                )
            
            # Apply timeout
            return await self.timeout.execute_async(with_circuit_breaker)
        
        # Apply bulkhead (concurrency limit)
        return await self.bulkhead.execute(execute_with_patterns)
    
    async def _execute_with_retry(self, func: Callable, *args, **kwargs) -> Any:
        """Execute with retry policy"""
        return await self.retry_policy.execute_async(func, *args, **kwargs)
    
    def get_health(self) -> Dict[str, Any]:
        """Get client health status"""
        return {
            'name': self.name,
            'circuit_breaker': self.circuit_breaker.get_state(),
            'bulkhead': self.bulkhead.get_stats()
        }


# Decorators for easy use

def with_circuit_breaker(
    failure_threshold: int = 5,
    timeout: float = 60.0,
    name: str = None
):
    """Decorator to add circuit breaker to function"""
    def decorator(func):
        cb_name = name or func.__name__
        cb = CircuitBreaker(
            failure_threshold=failure_threshold,
            timeout=timeout,
            name=cb_name
        )
        
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await cb.call_async(func, *args, **kwargs)
        
        wrapper.circuit_breaker = cb
        return wrapper
    
    return decorator


def with_retry(max_attempts: int = 3, initial_delay: float = 1.0):
    """Decorator to add retry logic to function"""
    def decorator(func):
        retry = RetryPolicy(
            max_attempts=max_attempts,
            initial_delay=initial_delay
        )
        
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await retry.execute_async(func, *args, **kwargs)
        
        return wrapper
    
    return decorator


def with_timeout(seconds: float):
    """Decorator to add timeout to function"""
    def decorator(func):
        timeout = Timeout(seconds)
        
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await timeout.execute_async(func, *args, **kwargs)
        
        return wrapper
    
    return decorator


# Example usage
if __name__ == '__main__':
    async def example_api_call():
        """Simulated API call"""
        await asyncio.sleep(0.1)
        if random.random() < 0.3:  # 30% failure rate
            raise Exception("API call failed")
        return {"status": "success"}
    
    async def main():
        # Create resilient client
        client = ResilientClient(
            name="payment_api",
            circuit_breaker=CircuitBreaker(failure_threshold=3, timeout=10.0),
            retry_policy=RetryPolicy(max_attempts=3),
            timeout=Timeout(5.0),
            bulkhead=Bulkhead(max_concurrent=10)
        )
        
        # Make resilient calls
        for i in range(10):
            try:
                result = await client.call(example_api_call)
                print(f"Call {i+1}: {result}")
            except Exception as e:
                print(f"Call {i+1} failed: {e}")
        
        # Check health
        health = client.get_health()
        print(f"\nClient health: {health}")
    
    asyncio.run(main())

