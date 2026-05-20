"""
Resilience Patterns for ML Services
Circuit breakers, fallbacks, timeouts, and bulkheads
"""

import os
import json
import logging
import asyncio
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Callable, TypeVar, Generic
from dataclasses import dataclass, field
from enum import Enum
from functools import wraps
import threading

import redis.asyncio as redis

logger = logging.getLogger(__name__)

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'redis.remittance.svc.cluster.local')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_URL = os.getenv('REDIS_URL', f'redis://{REDIS_HOST}:{REDIS_PORT}')

T = TypeVar('T')


class CircuitState(str, Enum):
    """Circuit breaker states"""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker"""
    failure_threshold: int = 5          # Failures before opening
    success_threshold: int = 3          # Successes to close from half-open
    timeout_seconds: float = 30.0       # Time before half-open
    half_open_max_calls: int = 3        # Max calls in half-open state
    excluded_exceptions: List[type] = field(default_factory=list)


@dataclass
class CircuitBreakerState:
    """State of a circuit breaker"""
    state: CircuitState = CircuitState.CLOSED
    failure_count: int = 0
    success_count: int = 0
    last_failure_time: Optional[datetime] = None
    last_state_change: datetime = field(default_factory=datetime.utcnow)
    half_open_calls: int = 0


class CircuitBreaker:
    """Circuit breaker implementation"""
    
    def __init__(
        self,
        name: str,
        config: CircuitBreakerConfig = None,
        fallback: Callable = None
    ):
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self.fallback = fallback
        self._state = CircuitBreakerState()
        self._lock = threading.Lock()
    
    @property
    def state(self) -> CircuitState:
        """Get current state, checking for timeout"""
        with self._lock:
            if self._state.state == CircuitState.OPEN:
                if self._should_attempt_reset():
                    self._state.state = CircuitState.HALF_OPEN
                    self._state.half_open_calls = 0
                    self._state.last_state_change = datetime.utcnow()
            return self._state.state
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to try half-open"""
        if not self._state.last_failure_time:
            return True
        elapsed = (datetime.utcnow() - self._state.last_failure_time).total_seconds()
        return elapsed >= self.config.timeout_seconds
    
    def record_success(self):
        """Record a successful call"""
        with self._lock:
            if self._state.state == CircuitState.HALF_OPEN:
                self._state.success_count += 1
                if self._state.success_count >= self.config.success_threshold:
                    self._state.state = CircuitState.CLOSED
                    self._state.failure_count = 0
                    self._state.success_count = 0
                    self._state.last_state_change = datetime.utcnow()
                    logger.info(f"Circuit {self.name} closed after recovery")
            elif self._state.state == CircuitState.CLOSED:
                self._state.failure_count = 0
    
    def record_failure(self, exception: Exception = None):
        """Record a failed call"""
        # Check if exception should be excluded
        if exception and type(exception) in self.config.excluded_exceptions:
            return
        
        with self._lock:
            self._state.failure_count += 1
            self._state.last_failure_time = datetime.utcnow()
            
            if self._state.state == CircuitState.HALF_OPEN:
                self._state.state = CircuitState.OPEN
                self._state.last_state_change = datetime.utcnow()
                logger.warning(f"Circuit {self.name} reopened after half-open failure")
            elif self._state.state == CircuitState.CLOSED:
                if self._state.failure_count >= self.config.failure_threshold:
                    self._state.state = CircuitState.OPEN
                    self._state.last_state_change = datetime.utcnow()
                    logger.warning(f"Circuit {self.name} opened after {self._state.failure_count} failures")
    
    def can_execute(self) -> bool:
        """Check if a call can be executed"""
        state = self.state
        
        if state == CircuitState.CLOSED:
            return True
        elif state == CircuitState.OPEN:
            return False
        else:  # HALF_OPEN
            with self._lock:
                if self._state.half_open_calls < self.config.half_open_max_calls:
                    self._state.half_open_calls += 1
                    return True
                return False
    
    def get_status(self) -> Dict[str, Any]:
        """Get circuit breaker status"""
        return {
            'name': self.name,
            'state': self.state.value,
            'failure_count': self._state.failure_count,
            'success_count': self._state.success_count,
            'last_failure': self._state.last_failure_time.isoformat() if self._state.last_failure_time else None,
            'last_state_change': self._state.last_state_change.isoformat()
        }


class CircuitBreakerRegistry:
    """Registry for circuit breakers"""
    
    def __init__(self):
        self._breakers: Dict[str, CircuitBreaker] = {}
        self._lock = threading.Lock()
    
    def get_or_create(
        self,
        name: str,
        config: CircuitBreakerConfig = None,
        fallback: Callable = None
    ) -> CircuitBreaker:
        """Get or create a circuit breaker"""
        with self._lock:
            if name not in self._breakers:
                self._breakers[name] = CircuitBreaker(name, config, fallback)
            return self._breakers[name]
    
    def get_all_status(self) -> List[Dict[str, Any]]:
        """Get status of all circuit breakers"""
        return [cb.get_status() for cb in self._breakers.values()]


# Global registry
circuit_breaker_registry = CircuitBreakerRegistry()


def circuit_breaker(
    name: str,
    config: CircuitBreakerConfig = None,
    fallback: Callable = None
):
    """Decorator for circuit breaker pattern"""
    def decorator(func):
        cb = circuit_breaker_registry.get_or_create(name, config, fallback)
        
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            if not cb.can_execute():
                if cb.fallback:
                    return await cb.fallback(*args, **kwargs) if asyncio.iscoroutinefunction(cb.fallback) else cb.fallback(*args, **kwargs)
                raise CircuitBreakerOpenError(f"Circuit {name} is open")
            
            try:
                result = await func(*args, **kwargs)
                cb.record_success()
                return result
            except Exception as e:
                cb.record_failure(e)
                if cb.fallback:
                    return await cb.fallback(*args, **kwargs) if asyncio.iscoroutinefunction(cb.fallback) else cb.fallback(*args, **kwargs)
                raise
        
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            if not cb.can_execute():
                if cb.fallback:
                    return cb.fallback(*args, **kwargs)
                raise CircuitBreakerOpenError(f"Circuit {name} is open")
            
            try:
                result = func(*args, **kwargs)
                cb.record_success()
                return result
            except Exception as e:
                cb.record_failure(e)
                if cb.fallback:
                    return cb.fallback(*args, **kwargs)
                raise
        
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    
    return decorator


class CircuitBreakerOpenError(Exception):
    """Raised when circuit breaker is open"""
    pass


@dataclass
class TimeoutConfig:
    """Configuration for timeouts"""
    timeout_seconds: float = 5.0
    fallback: Callable = None


def with_timeout(timeout_seconds: float, fallback: Callable = None):
    """Decorator for timeout pattern"""
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            try:
                return await asyncio.wait_for(
                    func(*args, **kwargs),
                    timeout=timeout_seconds
                )
            except asyncio.TimeoutError:
                logger.warning(f"Timeout after {timeout_seconds}s in {func.__name__}")
                if fallback:
                    return await fallback(*args, **kwargs) if asyncio.iscoroutinefunction(fallback) else fallback(*args, **kwargs)
                raise
        
        return async_wrapper
    return decorator


@dataclass
class RetryConfig:
    """Configuration for retries"""
    max_retries: int = 3
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 30.0
    exponential_base: float = 2.0
    retryable_exceptions: List[type] = field(default_factory=lambda: [Exception])


def with_retry(config: RetryConfig = None):
    """Decorator for retry pattern with exponential backoff"""
    config = config or RetryConfig()
    
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(config.max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except tuple(config.retryable_exceptions) as e:
                    last_exception = e
                    if attempt < config.max_retries:
                        delay = min(
                            config.base_delay_seconds * (config.exponential_base ** attempt),
                            config.max_delay_seconds
                        )
                        logger.warning(f"Retry {attempt + 1}/{config.max_retries} for {func.__name__} after {delay}s: {e}")
                        await asyncio.sleep(delay)
            
            raise last_exception
        
        return async_wrapper
    return decorator


class Bulkhead:
    """Bulkhead pattern for limiting concurrent calls"""
    
    def __init__(self, name: str, max_concurrent: int = 10, max_wait_seconds: float = 5.0):
        self.name = name
        self.max_concurrent = max_concurrent
        self.max_wait_seconds = max_wait_seconds
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._active_count = 0
        self._rejected_count = 0
    
    async def acquire(self) -> bool:
        """Try to acquire a slot"""
        try:
            acquired = await asyncio.wait_for(
                self._semaphore.acquire(),
                timeout=self.max_wait_seconds
            )
            if acquired:
                self._active_count += 1
            return acquired
        except asyncio.TimeoutError:
            self._rejected_count += 1
            return False
    
    def release(self):
        """Release a slot"""
        self._semaphore.release()
        self._active_count -= 1
    
    def get_status(self) -> Dict[str, Any]:
        """Get bulkhead status"""
        return {
            'name': self.name,
            'max_concurrent': self.max_concurrent,
            'active_count': self._active_count,
            'rejected_count': self._rejected_count,
            'available_slots': self.max_concurrent - self._active_count
        }


class BulkheadRegistry:
    """Registry for bulkheads"""
    
    def __init__(self):
        self._bulkheads: Dict[str, Bulkhead] = {}
    
    def get_or_create(
        self,
        name: str,
        max_concurrent: int = 10,
        max_wait_seconds: float = 5.0
    ) -> Bulkhead:
        """Get or create a bulkhead"""
        if name not in self._bulkheads:
            self._bulkheads[name] = Bulkhead(name, max_concurrent, max_wait_seconds)
        return self._bulkheads[name]
    
    def get_all_status(self) -> List[Dict[str, Any]]:
        """Get status of all bulkheads"""
        return [b.get_status() for b in self._bulkheads.values()]


bulkhead_registry = BulkheadRegistry()


def with_bulkhead(name: str, max_concurrent: int = 10, max_wait_seconds: float = 5.0):
    """Decorator for bulkhead pattern"""
    def decorator(func):
        bulkhead = bulkhead_registry.get_or_create(name, max_concurrent, max_wait_seconds)
        
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if not await bulkhead.acquire():
                raise BulkheadFullError(f"Bulkhead {name} is full")
            try:
                return await func(*args, **kwargs)
            finally:
                bulkhead.release()
        
        return wrapper
    return decorator


class BulkheadFullError(Exception):
    """Raised when bulkhead is full"""
    pass


class MLFallbackStrategy:
    """Fallback strategies for ML services"""
    
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
        self._rule_based_defaults: Dict[str, Dict[str, Any]] = {}
        self._last_known_good: Dict[str, Any] = {}
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
        await self._load_defaults()
    
    async def _load_defaults(self):
        """Load rule-based defaults"""
        # Routing fallback defaults
        self._rule_based_defaults['routing_success'] = {
            'default_prediction': 0.85,
            'bank_defaults': {
                'GTBank': 0.92,
                'Access': 0.90,
                'Zenith': 0.91,
                'UBA': 0.88,
                'FirstBank': 0.87
            },
            'rail_defaults': {
                'nip': 0.88,
                'on_us': 0.95,
                'direct': 0.90,
                'neft': 0.85
            }
        }
        
        # Fraud detection fallback defaults
        self._rule_based_defaults['fraud_detection'] = {
            'default_score': 0.1,
            'high_risk_threshold': 50000,
            'high_risk_score': 0.5,
            'velocity_threshold': 5,
            'velocity_score': 0.4
        }
        
        # Credit scoring fallback defaults
        self._rule_based_defaults['credit_scoring'] = {
            'default_score': 650,
            'min_score': 300,
            'max_score': 850
        }
    
    async def get_routing_fallback(
        self,
        bank_code: str,
        rail: str,
        amount: float
    ) -> Dict[str, Any]:
        """Get fallback prediction for routing"""
        defaults = self._rule_based_defaults.get('routing_success', {})
        
        # Try bank-specific default
        bank_defaults = defaults.get('bank_defaults', {})
        prediction = bank_defaults.get(bank_code, defaults.get('default_prediction', 0.85))
        
        # Adjust for rail
        rail_defaults = defaults.get('rail_defaults', {})
        rail_factor = rail_defaults.get(rail, 0.88) / 0.88
        prediction *= rail_factor
        
        # Adjust for amount (higher amounts slightly lower success)
        if amount > 1000000:
            prediction *= 0.95
        elif amount > 100000:
            prediction *= 0.98
        
        return {
            'prediction': min(prediction, 0.99),
            'confidence': 0.5,  # Low confidence for fallback
            'is_fallback': True,
            'fallback_reason': 'ml_service_unavailable'
        }
    
    async def get_fraud_fallback(
        self,
        amount: float,
        transaction_count_1h: int = 0
    ) -> Dict[str, Any]:
        """Get fallback prediction for fraud detection"""
        defaults = self._rule_based_defaults.get('fraud_detection', {})
        
        score = defaults.get('default_score', 0.1)
        
        # Rule-based adjustments
        if amount > defaults.get('high_risk_threshold', 50000):
            score = max(score, defaults.get('high_risk_score', 0.5))
        
        if transaction_count_1h > defaults.get('velocity_threshold', 5):
            score = max(score, defaults.get('velocity_score', 0.4))
        
        return {
            'fraud_score': score,
            'is_fraud': score > 0.5,
            'confidence': 0.3,
            'is_fallback': True,
            'fallback_reason': 'ml_service_unavailable'
        }
    
    async def get_credit_fallback(
        self,
        income: float,
        debt_to_income: float
    ) -> Dict[str, Any]:
        """Get fallback prediction for credit scoring"""
        defaults = self._rule_based_defaults.get('credit_scoring', {})
        
        base_score = defaults.get('default_score', 650)
        
        # Simple rule-based adjustments
        if debt_to_income > 0.5:
            base_score -= 100
        elif debt_to_income < 0.2:
            base_score += 50
        
        if income > 10000000:  # High income
            base_score += 50
        elif income < 500000:  # Low income
            base_score -= 50
        
        # Clamp to valid range
        score = max(
            defaults.get('min_score', 300),
            min(defaults.get('max_score', 850), base_score)
        )
        
        return {
            'credit_score': score,
            'confidence': 0.4,
            'is_fallback': True,
            'fallback_reason': 'ml_service_unavailable'
        }
    
    async def cache_last_known_good(
        self,
        model_name: str,
        request_key: str,
        prediction: Any
    ):
        """Cache a successful prediction for fallback"""
        cache_key = f"ml:fallback:lkg:{model_name}:{request_key}"
        await self.redis.setex(
            cache_key,
            3600,  # 1 hour TTL
            json.dumps(prediction, default=str)
        )
    
    async def get_last_known_good(
        self,
        model_name: str,
        request_key: str
    ) -> Optional[Any]:
        """Get last known good prediction"""
        cache_key = f"ml:fallback:lkg:{model_name}:{request_key}"
        cached = await self.redis.get(cache_key)
        if cached:
            result = json.loads(cached)
            result['is_fallback'] = True
            result['fallback_reason'] = 'last_known_good'
            return result
        return None


class ResilientMLService:
    """Wrapper for resilient ML service calls"""
    
    def __init__(
        self,
        service_name: str,
        predict_func: Callable,
        fallback_strategy: MLFallbackStrategy,
        circuit_config: CircuitBreakerConfig = None,
        timeout_seconds: float = 5.0,
        max_concurrent: int = 100
    ):
        self.service_name = service_name
        self.predict_func = predict_func
        self.fallback_strategy = fallback_strategy
        self.timeout_seconds = timeout_seconds
        
        # Initialize resilience components
        self.circuit_breaker = circuit_breaker_registry.get_or_create(
            f"ml:{service_name}",
            circuit_config or CircuitBreakerConfig()
        )
        self.bulkhead = bulkhead_registry.get_or_create(
            f"ml:{service_name}",
            max_concurrent
        )
    
    async def predict(
        self,
        features: Dict[str, Any],
        request_key: str = None
    ) -> Dict[str, Any]:
        """Make a resilient prediction"""
        start_time = time.time()
        
        # Check circuit breaker
        if not self.circuit_breaker.can_execute():
            logger.warning(f"Circuit open for {self.service_name}, using fallback")
            return await self._get_fallback(features, request_key, "circuit_open")
        
        # Check bulkhead
        if not await self.bulkhead.acquire():
            logger.warning(f"Bulkhead full for {self.service_name}, using fallback")
            return await self._get_fallback(features, request_key, "bulkhead_full")
        
        try:
            # Execute with timeout
            result = await asyncio.wait_for(
                self.predict_func(features),
                timeout=self.timeout_seconds
            )
            
            # Record success
            self.circuit_breaker.record_success()
            
            # Cache for fallback
            if request_key:
                await self.fallback_strategy.cache_last_known_good(
                    self.service_name, request_key, result
                )
            
            # Add latency info
            result['latency_ms'] = (time.time() - start_time) * 1000
            result['is_fallback'] = False
            
            return result
            
        except asyncio.TimeoutError:
            self.circuit_breaker.record_failure()
            logger.warning(f"Timeout for {self.service_name}")
            return await self._get_fallback(features, request_key, "timeout")
            
        except Exception as e:
            self.circuit_breaker.record_failure(e)
            logger.error(f"Error in {self.service_name}: {e}")
            return await self._get_fallback(features, request_key, f"error:{type(e).__name__}")
            
        finally:
            self.bulkhead.release()
    
    async def _get_fallback(
        self,
        features: Dict[str, Any],
        request_key: str,
        reason: str
    ) -> Dict[str, Any]:
        """Get fallback prediction"""
        # Try last known good first
        if request_key:
            lkg = await self.fallback_strategy.get_last_known_good(
                self.service_name, request_key
            )
            if lkg:
                lkg['fallback_reason'] = f"lkg:{reason}"
                return lkg
        
        # Use rule-based fallback
        if self.service_name == 'routing_success':
            return await self.fallback_strategy.get_routing_fallback(
                features.get('bank_code', ''),
                features.get('rail', 'nip'),
                features.get('amount', 0)
            )
        elif self.service_name == 'fraud_detection':
            return await self.fallback_strategy.get_fraud_fallback(
                features.get('amount', 0),
                features.get('user_transaction_count_1h', 0)
            )
        elif self.service_name == 'credit_scoring':
            return await self.fallback_strategy.get_credit_fallback(
                features.get('income', 0),
                features.get('debt_to_income', 0.3)
            )
        
        # Generic fallback
        return {
            'prediction': 0.5,
            'confidence': 0.1,
            'is_fallback': True,
            'fallback_reason': reason
        }
    
    def get_status(self) -> Dict[str, Any]:
        """Get service status"""
        return {
            'service_name': self.service_name,
            'circuit_breaker': self.circuit_breaker.get_status(),
            'bulkhead': self.bulkhead.get_status()
        }


# Export classes
__all__ = [
    'CircuitBreaker',
    'CircuitBreakerConfig',
    'CircuitBreakerOpenError',
    'CircuitBreakerRegistry',
    'circuit_breaker',
    'circuit_breaker_registry',
    'with_timeout',
    'with_retry',
    'RetryConfig',
    'Bulkhead',
    'BulkheadFullError',
    'BulkheadRegistry',
    'bulkhead_registry',
    'with_bulkhead',
    'MLFallbackStrategy',
    'ResilientMLService'
]
