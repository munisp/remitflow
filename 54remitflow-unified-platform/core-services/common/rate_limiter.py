"""
Rate Limiting Middleware for FastAPI Services

Provides configurable rate limiting with multiple backends:
- In-memory (default, for development/single instance)
- Redis (for production/distributed)

Supports:
- Per-IP rate limiting
- Per-user rate limiting
- Per-endpoint rate limiting
- Sliding window algorithm
"""

import os
import time
import logging
import hashlib
from abc import ABC, abstractmethod
from typing import Optional, Dict, Tuple
from dataclasses import dataclass
from functools import wraps
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


@dataclass
class RateLimitConfig:
    """Rate limit configuration"""
    requests_per_minute: int = 60
    requests_per_hour: int = 1000
    requests_per_day: int = 10000
    burst_size: int = 10
    enabled: bool = True
    
    @classmethod
    def from_env(cls, prefix: str = "RATE_LIMIT") -> "RateLimitConfig":
        """Load config from environment variables"""
        return cls(
            requests_per_minute=int(os.getenv(f"{prefix}_PER_MINUTE", "60")),
            requests_per_hour=int(os.getenv(f"{prefix}_PER_HOUR", "1000")),
            requests_per_day=int(os.getenv(f"{prefix}_PER_DAY", "10000")),
            burst_size=int(os.getenv(f"{prefix}_BURST", "10")),
            enabled=os.getenv(f"{prefix}_ENABLED", "true").lower() == "true"
        )


class RateLimitBackend(ABC):
    """Abstract base class for rate limit storage backends"""
    
    @abstractmethod
    def is_rate_limited(self, key: str, limit: int, window_seconds: int) -> Tuple[bool, int, int]:
        """
        Check if a key is rate limited.
        
        Returns:
            Tuple of (is_limited, remaining_requests, reset_time_seconds)
        """
        pass
    
    @abstractmethod
    def increment(self, key: str, window_seconds: int) -> int:
        """Increment the counter for a key and return current count"""
        pass
    
    @abstractmethod
    def reset(self, key: str) -> None:
        """Reset the counter for a key"""
        pass


class InMemoryRateLimitBackend(RateLimitBackend):
    """
    In-memory rate limit backend using sliding window.
    Suitable for single-instance deployments or development.
    
    WARNING: Not suitable for distributed deployments.
    """
    
    def __init__(self):
        self._windows: Dict[str, Dict[int, int]] = {}
        self._cleanup_interval = 60
        self._last_cleanup = time.time()
    
    def _cleanup_old_windows(self):
        """Remove expired window entries"""
        current_time = time.time()
        if current_time - self._last_cleanup < self._cleanup_interval:
            return
        
        self._last_cleanup = current_time
        cutoff = int(current_time) - 86400  # Keep 24 hours of data
        
        keys_to_remove = []
        for key, windows in self._windows.items():
            windows_to_remove = [ts for ts in windows if ts < cutoff]
            for ts in windows_to_remove:
                del windows[ts]
            if not windows:
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self._windows[key]
    
    def is_rate_limited(self, key: str, limit: int, window_seconds: int) -> Tuple[bool, int, int]:
        self._cleanup_old_windows()
        
        current_time = int(time.time())
        window_start = current_time - window_seconds
        
        if key not in self._windows:
            self._windows[key] = {}
        
        # Count requests in the window
        count = sum(
            c for ts, c in self._windows[key].items()
            if ts >= window_start
        )
        
        remaining = max(0, limit - count)
        reset_time = window_seconds
        
        return count >= limit, remaining, reset_time
    
    def increment(self, key: str, window_seconds: int) -> int:
        current_time = int(time.time())
        
        if key not in self._windows:
            self._windows[key] = {}
        
        if current_time not in self._windows[key]:
            self._windows[key][current_time] = 0
        
        self._windows[key][current_time] += 1
        
        # Return total count in window
        window_start = current_time - window_seconds
        return sum(
            c for ts, c in self._windows[key].items()
            if ts >= window_start
        )
    
    def reset(self, key: str) -> None:
        if key in self._windows:
            del self._windows[key]


class RedisRateLimitBackend(RateLimitBackend):
    """
    Redis-based rate limit backend using sliding window.
    Suitable for distributed deployments.
    
    Configuration:
    - REDIS_URL: Redis connection URL
    - RATE_LIMIT_KEY_PREFIX: Prefix for rate limit keys (default: "rl:")
    """
    
    def __init__(self):
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        self.key_prefix = os.getenv("RATE_LIMIT_KEY_PREFIX", "rl:")
        self._client = None
        
        try:
            import redis
            self._client = redis.from_url(self.redis_url, decode_responses=True)
            self._client.ping()
            logger.info("Redis rate limit backend initialized")
        except ImportError:
            logger.error("redis package not installed - falling back to in-memory")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
    
    def _get_key(self, key: str) -> str:
        return f"{self.key_prefix}{key}"
    
    def is_rate_limited(self, key: str, limit: int, window_seconds: int) -> Tuple[bool, int, int]:
        if not self._client:
            return False, limit, window_seconds
        
        redis_key = self._get_key(key)
        current_time = int(time.time())
        window_start = current_time - window_seconds
        
        try:
            # Remove old entries and count current
            pipe = self._client.pipeline()
            pipe.zremrangebyscore(redis_key, 0, window_start)
            pipe.zcard(redis_key)
            results = pipe.execute()
            
            count = results[1]
            remaining = max(0, limit - count)
            
            # Get TTL for reset time
            ttl = self._client.ttl(redis_key)
            reset_time = ttl if ttl > 0 else window_seconds
            
            return count >= limit, remaining, reset_time
            
        except Exception as e:
            logger.error(f"Redis rate limit check failed: {e}")
            return False, limit, window_seconds
    
    def increment(self, key: str, window_seconds: int) -> int:
        if not self._client:
            return 0
        
        redis_key = self._get_key(key)
        current_time = int(time.time())
        window_start = current_time - window_seconds
        
        try:
            pipe = self._client.pipeline()
            pipe.zremrangebyscore(redis_key, 0, window_start)
            pipe.zadd(redis_key, {f"{current_time}:{time.time_ns()}": current_time})
            pipe.zcard(redis_key)
            pipe.expire(redis_key, window_seconds)
            results = pipe.execute()
            
            return results[2]
            
        except Exception as e:
            logger.error(f"Redis rate limit increment failed: {e}")
            return 0
    
    def reset(self, key: str) -> None:
        if self._client:
            try:
                self._client.delete(self._get_key(key))
            except Exception as e:
                logger.error(f"Redis rate limit reset failed: {e}")


class RateLimiter:
    """
    Rate limiter with configurable backend and limits.
    
    Usage:
        limiter = RateLimiter()
        
        # Check if rate limited
        is_limited, remaining, reset = limiter.check("user:123", 60, 60)
        
        # Or use as decorator
        @limiter.limit(requests_per_minute=60)
        async def my_endpoint():
            pass
    """
    
    def __init__(self, config: Optional[RateLimitConfig] = None):
        self.config = config or RateLimitConfig.from_env()
        self._backend = self._create_backend()
    
    def _create_backend(self) -> RateLimitBackend:
        """Create the appropriate backend based on configuration"""
        backend_type = os.getenv("RATE_LIMIT_BACKEND", "memory").lower()
        
        if backend_type == "redis":
            backend = RedisRateLimitBackend()
            if backend._client:
                return backend
            logger.warning("Redis unavailable, falling back to in-memory rate limiting")
        
        return InMemoryRateLimitBackend()
    
    def _get_key(self, identifier: str, endpoint: str = "") -> str:
        """Generate a rate limit key"""
        if endpoint:
            return f"{identifier}:{endpoint}"
        return identifier
    
    def check(
        self,
        identifier: str,
        limit: int,
        window_seconds: int,
        endpoint: str = ""
    ) -> Tuple[bool, int, int]:
        """
        Check if an identifier is rate limited.
        
        Args:
            identifier: User ID, IP address, or other identifier
            limit: Maximum requests allowed
            window_seconds: Time window in seconds
            endpoint: Optional endpoint for per-endpoint limiting
            
        Returns:
            Tuple of (is_limited, remaining_requests, reset_time_seconds)
        """
        if not self.config.enabled:
            return False, limit, 0
        
        key = self._get_key(identifier, endpoint)
        return self._backend.is_rate_limited(key, limit, window_seconds)
    
    def increment(self, identifier: str, window_seconds: int = 60, endpoint: str = "") -> int:
        """Increment the counter for an identifier"""
        if not self.config.enabled:
            return 0
        
        key = self._get_key(identifier, endpoint)
        return self._backend.increment(key, window_seconds)
    
    def reset(self, identifier: str, endpoint: str = "") -> None:
        """Reset the counter for an identifier"""
        key = self._get_key(identifier, endpoint)
        self._backend.reset(key)
    
    def limit(
        self,
        requests_per_minute: Optional[int] = None,
        requests_per_hour: Optional[int] = None,
        key_func=None
    ):
        """
        Decorator for rate limiting endpoints.
        
        Args:
            requests_per_minute: Override default per-minute limit
            requests_per_hour: Override default per-hour limit
            key_func: Function to extract identifier from request (default: IP)
        """
        def decorator(func):
            @wraps(func)
            async def wrapper(request: Request, *args, **kwargs):
                if not self.config.enabled:
                    return await func(request, *args, **kwargs)
                
                # Get identifier
                if key_func:
                    identifier = key_func(request)
                else:
                    identifier = self._get_client_ip(request)
                
                endpoint = f"{request.method}:{request.url.path}"
                
                # Check per-minute limit
                minute_limit = requests_per_minute or self.config.requests_per_minute
                is_limited, remaining, reset = self.check(
                    identifier, minute_limit, 60, f"{endpoint}:minute"
                )
                
                if is_limited:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="Rate limit exceeded. Please try again later.",
                        headers={
                            "X-RateLimit-Limit": str(minute_limit),
                            "X-RateLimit-Remaining": str(remaining),
                            "X-RateLimit-Reset": str(reset),
                            "Retry-After": str(reset)
                        }
                    )
                
                # Check per-hour limit
                hour_limit = requests_per_hour or self.config.requests_per_hour
                is_limited, remaining, reset = self.check(
                    identifier, hour_limit, 3600, f"{endpoint}:hour"
                )
                
                if is_limited:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="Hourly rate limit exceeded. Please try again later.",
                        headers={
                            "X-RateLimit-Limit": str(hour_limit),
                            "X-RateLimit-Remaining": str(remaining),
                            "X-RateLimit-Reset": str(reset),
                            "Retry-After": str(reset)
                        }
                    )
                
                # Increment counters
                self.increment(identifier, 60, f"{endpoint}:minute")
                self.increment(identifier, 3600, f"{endpoint}:hour")
                
                return await func(request, *args, **kwargs)
            
            return wrapper
        return decorator
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request"""
        # Check for forwarded headers (behind proxy/load balancer)
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip
        
        return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware for global rate limiting.
    
    Usage:
        app = FastAPI()
        app.add_middleware(RateLimitMiddleware)
    """
    
    def __init__(self, app, config: Optional[RateLimitConfig] = None):
        super().__init__(app)
        self.limiter = RateLimiter(config)
    
    async def dispatch(self, request: Request, call_next):
        if not self.limiter.config.enabled:
            return await call_next(request)
        
        # Skip rate limiting for health checks
        if request.url.path in ["/health", "/healthz", "/ready", "/metrics"]:
            return await call_next(request)
        
        identifier = self.limiter._get_client_ip(request)
        
        # Check global rate limit
        is_limited, remaining, reset = self.limiter.check(
            identifier,
            self.limiter.config.requests_per_minute,
            60
        )
        
        if is_limited:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please try again later."},
                headers={
                    "X-RateLimit-Limit": str(self.limiter.config.requests_per_minute),
                    "X-RateLimit-Remaining": str(remaining),
                    "X-RateLimit-Reset": str(reset),
                    "Retry-After": str(reset)
                }
            )
        
        # Increment counter
        self.limiter.increment(identifier, 60)
        
        # Add rate limit headers to response
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.limiter.config.requests_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        
        return response


# Singleton instance
_rate_limiter: Optional[RateLimiter] = None


def get_rate_limiter() -> RateLimiter:
    """Get the global rate limiter instance"""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter
