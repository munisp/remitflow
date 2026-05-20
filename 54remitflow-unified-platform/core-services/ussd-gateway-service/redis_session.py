"""
Redis Session Store for USSD Gateway Service
Replaces in-memory session storage with Redis for production use
"""

import os
import json
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Redis configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
SESSION_TTL_MINUTES = int(os.getenv("SESSION_TTL_MINUTES", "5"))
USE_REDIS = os.getenv("USE_REDIS", "true").lower() == "true"

# Redis client (lazy initialization)
_redis_client = None


def get_redis_client():
    """Get or create Redis client"""
    global _redis_client
    if _redis_client is None:
        try:
            import redis
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            # Test connection
            _redis_client.ping()
            logger.info("Redis connection established for USSD sessions")
        except ImportError:
            logger.error("redis package not installed. Install with: pip install redis")
            raise
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
    return _redis_client


class RedisSessionStore:
    """Redis-backed session store for USSD sessions"""
    
    SESSION_PREFIX = "ussd:session:"
    
    @classmethod
    def _get_key(cls, session_id: str) -> str:
        """Get Redis key for session"""
        return f"{cls.SESSION_PREFIX}{session_id}"
    
    @classmethod
    def get(cls, session_id: str) -> Optional[Dict[str, Any]]:
        """Get session from Redis"""
        try:
            client = get_redis_client()
            key = cls._get_key(session_id)
            data = client.get(key)
            if data:
                session = json.loads(data)
                logger.debug(f"Session retrieved from Redis: {session_id}")
                return session
            return None
        except Exception as e:
            logger.error(f"Failed to get session from Redis: {e}")
            return None
    
    @classmethod
    def set(cls, session_id: str, data: Dict[str, Any]) -> bool:
        """Store session in Redis with TTL"""
        try:
            client = get_redis_client()
            key = cls._get_key(session_id)
            
            # Add timestamp for debugging
            data["updated_at"] = datetime.utcnow().isoformat()
            
            # Store with TTL
            ttl_seconds = SESSION_TTL_MINUTES * 60
            client.setex(key, ttl_seconds, json.dumps(data, default=str))
            logger.debug(f"Session stored in Redis: {session_id}, TTL={ttl_seconds}s")
            return True
        except Exception as e:
            logger.error(f"Failed to store session in Redis: {e}")
            return False
    
    @classmethod
    def delete(cls, session_id: str) -> bool:
        """Delete session from Redis"""
        try:
            client = get_redis_client()
            key = cls._get_key(session_id)
            client.delete(key)
            logger.debug(f"Session deleted from Redis: {session_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete session from Redis: {e}")
            return False
    
    @classmethod
    def cleanup_expired(cls) -> int:
        """
        Cleanup expired sessions.
        Note: Redis handles TTL automatically, so this is mostly a no-op.
        Returns 0 since Redis auto-expires keys.
        """
        logger.debug("Redis auto-expires sessions via TTL, no manual cleanup needed")
        return 0
    
    @classmethod
    def get_active_session_count(cls) -> int:
        """Get count of active sessions"""
        try:
            client = get_redis_client()
            keys = client.keys(f"{cls.SESSION_PREFIX}*")
            return len(keys)
        except Exception as e:
            logger.error(f"Failed to count sessions: {e}")
            return 0


class InMemorySessionStore:
    """In-memory session store (fallback for development only)"""
    
    _sessions: Dict[str, Dict[str, Any]] = {}
    
    @classmethod
    def get(cls, session_id: str) -> Optional[Dict[str, Any]]:
        session = cls._sessions.get(session_id)
        if session and session.get("expires_at", datetime.min) > datetime.utcnow():
            return session
        return None
    
    @classmethod
    def set(cls, session_id: str, data: Dict[str, Any]) -> bool:
        data["expires_at"] = datetime.utcnow() + timedelta(minutes=SESSION_TTL_MINUTES)
        cls._sessions[session_id] = data
        return True
    
    @classmethod
    def delete(cls, session_id: str) -> bool:
        cls._sessions.pop(session_id, None)
        return True
    
    @classmethod
    def cleanup_expired(cls) -> int:
        now = datetime.utcnow()
        expired = [k for k, v in cls._sessions.items() if v.get("expires_at", datetime.min) < now]
        for k in expired:
            del cls._sessions[k]
        return len(expired)
    
    @classmethod
    def get_active_session_count(cls) -> int:
        return len(cls._sessions)


def get_session_store():
    """
    Get the appropriate session store based on configuration.
    
    In production (USE_REDIS=true): Uses Redis
    In development (USE_REDIS=false): Uses in-memory store
    """
    if USE_REDIS:
        try:
            # Test Redis connection
            get_redis_client()
            return RedisSessionStore
        except Exception as e:
            logger.error(f"Redis unavailable, cannot use in-memory fallback in production: {e}")
            # FAIL CLOSED - do not fall back to in-memory in production
            raise RuntimeError("Redis is required for USSD sessions in production mode")
    else:
        logger.warning("Using in-memory session store (development mode only)")
        return InMemorySessionStore


# Export the session store class
SessionStore = None


def init_session_store():
    """Initialize the session store on startup"""
    global SessionStore
    SessionStore = get_session_store()
    logger.info(f"Session store initialized: {SessionStore.__name__}")
    return SessionStore
