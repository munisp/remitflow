"""
RemitFlow Shared Rate Limiting Middleware
Redis-backed token bucket rate limiter for all services

Usage (in any FastAPI service):
    from shared.rate_limiter import RateLimitMiddleware, rate_limit
    app.add_middleware(RateLimitMiddleware)

    @app.get("/api/resource")
    @rate_limit(requests=100, window=60)  # 100 requests per 60 seconds
    async def get_resource():
        ...

REQUIRED:
  - REDIS_URL
  - RATE_LIMIT_ENABLED (default: true)

FAIL-CLOSED:
  If Redis is unavailable, rate limiting is bypassed but logged as a warning.
  Service continues operating (graceful degradation, not hard failure).
"""
from __future__ import annotations

import functools
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# ─── Redis Configuration ─────────────────────────────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"

_redis_client = None

def _get_redis():
    global _redis_client
    if _redis_client is None and RATE_LIMIT_ENABLED:
        try:
            import redis
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            _redis_client.ping()
            logger.info("Rate limiter connected to Redis")
        except Exception as e:
            logger.warning(f"Redis unavailable for rate limiting: {e}")
            _redis_client = False  # Mark as unavailable
    return _redis_client

# ─── Token Bucket Implementation ─────────────────────────────────────────────────

class TokenBucket:
    """Redis-backed token bucket rate limiter."""

    def __init__(self, key_prefix: str = "rl"):
        self.key_prefix = key_prefix

    def _key(self, identifier: str, route: str) -> str:
        return f"{self.key_prefix}:{identifier}:{hashlib.sha256(route.encode()).hexdigest()[:16]}"

    def is_allowed(self, identifier: str, route: str, max_requests: int, window_seconds: int) -> tuple[bool, dict]:
        """Check if request is allowed. Returns (allowed, metadata)."""
        redis_client = _get_redis()
        if redis_client is False or redis_client is None:
            # Redis unavailable — allow but log
            return True, {"limit": max_requests, "remaining": max_requests, "window": window_seconds, "redis": "unavailable"}

        key = self._key(identifier, route)
        now = time.time()

        pipe = redis_client.pipeline()
        pipe.zremrangebyscore(key, 0, now - window_seconds)
        pipe.zcard(key)
        pipe.zadd(key, {str(now): now})
        pipe.expire(key, window_seconds + 1)
        results = pipe.execute()

        current_count = results[1]
        allowed = current_count < max_requests

        metadata = {
            "limit": max_requests,
            "remaining": max(0, max_requests - current_count - 1),
            "window": window_seconds,
            "reset_at": now + window_seconds,
        }

        return allowed, metadata

_bucket = TokenBucket()

# ─── Middleware ──────────────────────────────────────────────────────────────────

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Global rate limiting middleware. Applies default limits to all routes."""

    DEFAULT_LIMIT = int(os.getenv("RATE_LIMIT_DEFAULT", "1000"))
    DEFAULT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))

    async def dispatch(self, request: Request, call_next):
        if not RATE_LIMIT_ENABLED:
            return await call_next(request)

        # Identify client by API key > Authorization header > IP address
        identifier = self._get_identifier(request)
        route = request.url.path

        allowed, metadata = _bucket.is_allowed(identifier, route, self.DEFAULT_LIMIT, self.DEFAULT_WINDOW)

        response = await call_next(request)

        # Add rate limit headers
        response.headers["X-RateLimit-Limit"] = str(metadata["limit"])
        response.headers["X-RateLimit-Remaining"] = str(metadata["remaining"])
        response.headers["X-RateLimit-Reset"] = str(int(metadata["reset_at"]))

        if not allowed:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: {metadata['limit']} requests per {metadata['window']} seconds",
                headers={"Retry-After": str(int(metadata["reset_at"] - time.time()))},
            )

        return response

    def _get_identifier(self, request: Request) -> str:
        # Priority: API Key > Bearer Token > IP Address
        api_key = request.headers.get("X-API-Key")
        if api_key:
            return f"apikey:{api_key[:16]}"

        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
            return f"token:{token[:16]}"

        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return f"ip:{forwarded.split(',')[0].strip()}"

        client = request.client
        return f"ip:{client.host if client else 'unknown'}"

# ─── Decorator ───────────────────────────────────────────────────────────────────

def rate_limit(requests: int = 100, window: int = 60, key_func: Optional[Callable] = None):
    """Decorator for per-route rate limiting.

    Args:
        requests: Maximum number of requests allowed in the window
        window: Time window in seconds
        key_func: Optional function to extract rate limit key from request
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            if not RATE_LIMIT_ENABLED:
                return await func(*args, **kwargs)

            # Extract request from args (FastAPI injects it)
            request = None
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break

            if request is None:
                # Try to find in kwargs
                request = kwargs.get("request")

            if request:
                identifier = key_func(request) if key_func else RateLimitMiddleware()._get_identifier(request)
                route = request.url.path

                allowed, metadata = _bucket.is_allowed(identifier, route, requests, window)

                if not allowed:
                    raise HTTPException(
                        status_code=429,
                        detail=f"Rate limit exceeded: {requests} requests per {window} seconds",
                        headers={
                            "Retry-After": str(int(metadata["reset_at"] - time.time())),
                            "X-RateLimit-Limit": str(metadata["limit"]),
                            "X-RateLimit-Remaining": "0",
                            "X-RateLimit-Reset": str(int(metadata["reset_at"])),
                        },
                    )

            return await func(*args, **kwargs)
        return wrapper
    return decorator

# ─── Health Check ────────────────────────────────────────────────────────────────

def get_rate_limiter_health() -> dict:
    redis_client = _get_redis()
    return {
        "enabled": RATE_LIMIT_ENABLED,
        "redis_connected": redis_client is not False and redis_client is not None,
        "default_limit": RateLimitMiddleware.DEFAULT_LIMIT,
        "default_window": RateLimitMiddleware.DEFAULT_WINDOW,
    }
