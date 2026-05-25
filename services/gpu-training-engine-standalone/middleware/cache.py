"""
GPU Training Engine — Redis Cache & Job Queue Middleware

Provides:
  - Response caching for device listings, model lists, health checks
  - Job queue for training tasks (async dispatch)
  - Session management for API tokens
  - Rate limiting per user/API key
"""

import hashlib
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("middleware.cache")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CACHE_TTL_DEVICES = int(os.getenv("CACHE_TTL_DEVICES", "30"))
CACHE_TTL_MODELS = int(os.getenv("CACHE_TTL_MODELS", "10"))
CACHE_TTL_HEALTH = int(os.getenv("CACHE_TTL_HEALTH", "5"))

_redis = None


def _get_redis():
    global _redis
    if _redis is not None:
        return _redis
    try:
        import redis
        _redis = redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=3)
        _redis.ping()
        logger.info(f"Redis connected: {REDIS_URL}")
        return _redis
    except Exception as e:
        logger.warning(f"Redis unavailable ({e}) — using in-memory fallback")
        return None


class InMemoryCache:
    """Fallback when Redis is unavailable."""

    def __init__(self):
        self._store: Dict[str, tuple] = {}

    def get(self, key: str) -> Optional[str]:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at and time.time() > expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: str, ttl: int = 60):
        self._store[key] = (value, time.time() + ttl)

    def delete(self, key: str):
        self._store.pop(key, None)

    def incr(self, key: str) -> int:
        val = int(self.get(key) or "0") + 1
        self.set(key, str(val), ttl=3600)
        return val

    def expire(self, key: str, ttl: int):
        entry = self._store.get(key)
        if entry:
            self._store[key] = (entry[0], time.time() + ttl)


_fallback = InMemoryCache()


def cache_get(key: str) -> Optional[str]:
    r = _get_redis()
    if r:
        try:
            return r.get(key)
        except Exception:
            pass
    return _fallback.get(key)


def cache_set(key: str, value: str, ttl: int = 60):
    r = _get_redis()
    if r:
        try:
            r.setex(key, ttl, value)
            return
        except Exception:
            pass
    _fallback.set(key, value, ttl)


def cache_delete(key: str):
    r = _get_redis()
    if r:
        try:
            r.delete(key)
            return
        except Exception:
            pass
    _fallback.delete(key)


def cache_response(prefix: str, ttl: int = 30):
    """Decorator to cache endpoint responses."""
    def decorator(func):
        async def wrapper(*args, **kwargs):
            key = f"gpu_engine:{prefix}:{hashlib.md5(json.dumps(kwargs, sort_keys=True, default=str).encode()).hexdigest()}"
            cached = cache_get(key)
            if cached:
                return json.loads(cached)
            result = await func(*args, **kwargs)
            cache_set(key, json.dumps(result, default=str), ttl)
            return result
        wrapper.__name__ = func.__name__
        wrapper.__doc__ = func.__doc__
        return wrapper
    return decorator


# ─── Job Queue ───────────────────────────────────────────────────────────────

def enqueue_job(job_id: str, payload: Dict[str, Any]):
    """Push a training job to the Redis queue."""
    r = _get_redis()
    if r:
        try:
            r.lpush("gpu_engine:job_queue", json.dumps({"job_id": job_id, **payload}))
            r.set(f"gpu_engine:job:{job_id}", json.dumps({"status": "queued", **payload}), ex=86400)
            return True
        except Exception as e:
            logger.warning(f"Failed to enqueue job {job_id}: {e}")
    return False


def dequeue_job() -> Optional[Dict]:
    """Pop next job from the queue."""
    r = _get_redis()
    if r:
        try:
            data = r.rpop("gpu_engine:job_queue")
            if data:
                return json.loads(data)
        except Exception:
            pass
    return None


def update_job_status(job_id: str, status: str, extra: Optional[Dict] = None):
    """Update job status in Redis."""
    r = _get_redis()
    if r:
        try:
            existing = r.get(f"gpu_engine:job:{job_id}")
            data = json.loads(existing) if existing else {}
            data["status"] = status
            if extra:
                data.update(extra)
            r.set(f"gpu_engine:job:{job_id}", json.dumps(data, default=str), ex=86400)
        except Exception:
            pass


# ─── Rate Limiting ───────────────────────────────────────────────────────────

def check_rate_limit(identifier: str, limit: int = 60, window: int = 60) -> tuple:
    """
    Token bucket rate limiter.
    Returns (allowed: bool, remaining: int, reset_at: float).
    """
    key = f"gpu_engine:ratelimit:{identifier}"
    r = _get_redis()
    if r:
        try:
            current = r.incr(key)
            if current == 1:
                r.expire(key, window)
            ttl = r.ttl(key)
            return (current <= limit, max(0, limit - current), time.time() + max(ttl, 0))
        except Exception:
            pass

    current = _fallback.incr(key)
    if current == 1:
        _fallback.expire(key, window)
    return (current <= limit, max(0, limit - current), time.time() + window)


# ─── Session Management ─────────────────────────────────────────────────────

def store_session(token: str, user_data: Dict, ttl: int = 86400):
    """Store an authenticated session."""
    cache_set(f"gpu_engine:session:{token}", json.dumps(user_data, default=str), ttl)


def get_session(token: str) -> Optional[Dict]:
    """Retrieve session by token."""
    data = cache_get(f"gpu_engine:session:{token}")
    return json.loads(data) if data else None


def revoke_session(token: str):
    """Revoke an active session."""
    cache_delete(f"gpu_engine:session:{token}")
