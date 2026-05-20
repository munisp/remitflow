"""
Redis Caching Client for Mojaloop
Implements caching layer for performance optimization
"""

import json
import logging
from typing import Any, Optional
import redis.asyncio as redis


logger = logging.getLogger(__name__)


class CacheConfig:
    """Cache configuration"""
    
    def __init__(
        self,
        host: str = "localhost",
        port: int = 6379,
        db: int = 0,
        password: Optional[str] = None,
        max_connections: int = 50,
        socket_timeout: int = 5,
        socket_connect_timeout: int = 5
    ):
        self.host = host
        self.port = port
        self.db = db
        self.password = password
        self.max_connections = max_connections
        self.socket_timeout = socket_timeout
        self.socket_connect_timeout = socket_connect_timeout


class CacheClient:
    """Async Redis client for caching"""
    
    def __init__(self, config: CacheConfig):
        self.config = config
        self.client: Optional[redis.Redis] = None
    
    async def connect(self):
        """Connect to Redis"""
        try:
            self.client = await redis.Redis(
                host=self.config.host,
                port=self.config.port,
                db=self.config.db,
                password=self.config.password,
                max_connections=self.config.max_connections,
                socket_timeout=self.config.socket_timeout,
                socket_connect_timeout=self.config.socket_connect_timeout,
                decode_responses=True
            )
            await self.client.ping()
            logger.info(f"Connected to Redis: {self.config.host}:{self.config.port}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
    
    async def disconnect(self):
        """Disconnect from Redis"""
        if self.client:
            await self.client.close()
            logger.info("Disconnected from Redis")
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        try:
            value = await self.client.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception as e:
            logger.error(f"Cache get failed for key {key}: {e}")
            return None
    
    async def set(self, key: str, value: Any, ttl: int = 300) -> bool:
        """Set value in cache with TTL"""
        try:
            serialized = json.dumps(value)
            await self.client.setex(key, ttl, serialized)
            return True
        except Exception as e:
            logger.error(f"Cache set failed for key {key}: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete value from cache"""
        try:
            await self.client.delete(key)
            return True
        except Exception as e:
            logger.error(f"Cache delete failed for key {key}: {e}")
            return False
    
    async def exists(self, key: str) -> bool:
        """Check if key exists"""
        try:
            return await self.client.exists(key) > 0
        except Exception as e:
            logger.error(f"Cache exists check failed for key {key}: {e}")
            return False
    
    async def expire(self, key: str, ttl: int) -> bool:
        """Set expiration on key"""
        try:
            await self.client.expire(key, ttl)
            return True
        except Exception as e:
            logger.error(f"Cache expire failed for key {key}: {e}")
            return False


class MojaloopCache:
    """High-level cache for Mojaloop entities"""
    
    def __init__(self, cache_client: CacheClient):
        self.cache = cache_client
        self.prefix = "mojaloop"
    
    def _make_key(self, entity_type: str, entity_id: str) -> str:
        """Create cache key"""
        return f"{self.prefix}:{entity_type}:{entity_id}"
    
    # Participant caching
    
    async def get_participant(self, participant_id: str) -> Optional[dict]:
        """Get participant from cache"""
        key = self._make_key("participant", participant_id)
        return await self.cache.get(key)
    
    async def set_participant(self, participant_id: str, participant_data: dict, ttl: int = 3600) -> bool:
        """Set participant in cache"""
        key = self._make_key("participant", participant_id)
        return await self.cache.set(key, participant_data, ttl)
    
    async def delete_participant(self, participant_id: str) -> bool:
        """Delete participant from cache"""
        key = self._make_key("participant", participant_id)
        return await self.cache.delete(key)
    
    # Quote caching
    
    async def get_quote(self, quote_id: str) -> Optional[dict]:
        """Get quote from cache"""
        key = self._make_key("quote", quote_id)
        return await self.cache.get(key)
    
    async def set_quote(self, quote_id: str, quote_data: dict, ttl: int = 300) -> bool:
        """Set quote in cache (5 min TTL)"""
        key = self._make_key("quote", quote_id)
        return await self.cache.set(key, quote_data, ttl)
    
    async def delete_quote(self, quote_id: str) -> bool:
        """Delete quote from cache"""
        key = self._make_key("quote", quote_id)
        return await self.cache.delete(key)
    
    # Transfer caching
    
    async def get_transfer(self, transfer_id: str) -> Optional[dict]:
        """Get transfer from cache"""
        key = self._make_key("transfer", transfer_id)
        return await self.cache.get(key)
    
    async def set_transfer(self, transfer_id: str, transfer_data: dict, ttl: int = 600) -> bool:
        """Set transfer in cache (10 min TTL)"""
        key = self._make_key("transfer", transfer_id)
        return await self.cache.set(key, transfer_data, ttl)
    
    async def delete_transfer(self, transfer_id: str) -> bool:
        """Delete transfer from cache"""
        key = self._make_key("transfer", transfer_id)
        return await self.cache.delete(key)
    
    # Exchange rate caching
    
    async def get_exchange_rate(self, source_currency: str, target_currency: str) -> Optional[float]:
        """Get exchange rate from cache"""
        key = self._make_key("fx", f"{source_currency}_{target_currency}")
        return await self.cache.get(key)
    
    async def set_exchange_rate(
        self,
        source_currency: str,
        target_currency: str,
        rate: float,
        ttl: int = 60
    ) -> bool:
        """Set exchange rate in cache (1 min TTL)"""
        key = self._make_key("fx", f"{source_currency}_{target_currency}")
        return await self.cache.set(key, rate, ttl)


# Cache-aside pattern

class CacheAsideRepository:
    """Repository with cache-aside pattern"""
    
    def __init__(self, db_repository, cache: MojaloopCache):
        self.db = db_repository
        self.cache = cache
    
    async def get_participant(self, participant_id: str) -> Optional[dict]:
        """Get participant with cache-aside"""
        # Try cache first
        cached = await self.cache.get_participant(participant_id)
        if cached:
            logger.debug(f"Cache hit for participant {participant_id}")
            return cached
        
        # Cache miss, get from database
        logger.debug(f"Cache miss for participant {participant_id}")
        participant = await self.db.get(participant_id)
        
        # Update cache
        if participant:
            await self.cache.set_participant(participant_id, participant)
        
        return participant
    
    async def create_participant(self, participant_data: dict) -> str:
        """Create participant and update cache"""
        participant_id = await self.db.create(participant_data)
        
        # Update cache
        await self.cache.set_participant(participant_id, participant_data)
        
        return participant_id
    
    async def update_participant(self, participant_id: str, updates: dict) -> bool:
        """Update participant and invalidate cache"""
        success = await self.db.update(participant_id, updates)
        
        if success:
            # Invalidate cache
            await self.cache.delete_participant(participant_id)
        
        return success

