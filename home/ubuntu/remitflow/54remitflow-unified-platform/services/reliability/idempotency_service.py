"""
Idempotency Service
Ensures exactly-once semantics for financial operations
Implements outbox/inbox pattern for reliable event publishing
"""

import os
import json
import logging
import asyncio
import hashlib
from typing import Optional, Dict, Any, List, Callable, TypeVar, Generic
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
import uuid

import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer

logger = logging.getLogger(__name__)

T = TypeVar('T')


class IdempotencyStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class IdempotencyRecord:
    """Record of an idempotent operation"""
    idempotency_key: str
    operation: str
    status: IdempotencyStatus
    request_hash: str
    
    # Result
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    
    # Timestamps
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: Optional[datetime] = None
    
    # Metadata
    client_id: Optional[str] = None
    correlation_id: Optional[str] = None


@dataclass
class OutboxMessage:
    """Message in the outbox for reliable publishing"""
    message_id: str
    topic: str
    key: Optional[str]
    value: Dict[str, Any]
    headers: Dict[str, str] = field(default_factory=dict)
    
    # Status
    status: str = "pending"  # pending, published, failed
    retry_count: int = 0
    max_retries: int = 5
    
    # Timestamps
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    published_at: Optional[datetime] = None
    next_retry_at: Optional[datetime] = None


@dataclass
class InboxMessage:
    """Message in the inbox for deduplication"""
    message_id: str
    topic: str
    partition: int
    offset: int
    
    # Processing
    status: str = "received"  # received, processing, processed, failed
    processed_at: Optional[datetime] = None
    
    # Timestamps
    received_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class IdempotencyService:
    """
    Service for ensuring idempotent operations.
    Uses Redis for fast lookups and PostgreSQL for persistence.
    """
    
    def __init__(self):
        self.db_url = os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank"
        )
        self.redis_url = os.getenv(
            "REDIS_URL",
            "redis://redis.remittance.svc.cluster.local:6379"
        )
        
        self.db_pool: Optional[asyncpg.Pool] = None
        self.redis_client: Optional[redis.Redis] = None
        
        # Default TTL for idempotency keys (24 hours)
        self.default_ttl = timedelta(hours=24)
        
        # Lock timeout
        self.lock_timeout = 30  # seconds
    
    async def initialize(self):
        """Initialize connections"""
        self.db_pool = await asyncpg.create_pool(self.db_url, min_size=2, max_size=10)
        self.redis_client = redis.from_url(self.redis_url)
        await self._init_schema()
    
    async def _init_schema(self):
        """Initialize database schema"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS idempotency_records (
                    idempotency_key TEXT PRIMARY KEY,
                    operation TEXT NOT NULL,
                    status TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    result JSONB,
                    error TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    expires_at TIMESTAMPTZ,
                    client_id TEXT,
                    correlation_id TEXT
                );
                
                CREATE INDEX IF NOT EXISTS idx_idempotency_expires 
                    ON idempotency_records(expires_at) 
                    WHERE expires_at IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_idempotency_status 
                    ON idempotency_records(status);
            """)
    
    def _compute_request_hash(self, request: Dict[str, Any]) -> str:
        """Compute hash of request for duplicate detection"""
        canonical = json.dumps(request, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()
    
    async def check_idempotency(
        self,
        idempotency_key: str,
        operation: str,
        request: Dict[str, Any]
    ) -> Optional[IdempotencyRecord]:
        """
        Check if operation was already executed.
        Returns existing record if found, None if new operation.
        """
        request_hash = self._compute_request_hash(request)
        
        # Check Redis cache first
        cached = await self.redis_client.get(f"idempotency:{idempotency_key}")
        if cached:
            data = json.loads(cached)
            
            # Verify request hash matches
            if data.get("request_hash") != request_hash:
                raise ValueError(
                    f"Idempotency key {idempotency_key} already used with different request"
                )
            
            return IdempotencyRecord(
                idempotency_key=idempotency_key,
                operation=data["operation"],
                status=IdempotencyStatus(data["status"]),
                request_hash=data["request_hash"],
                result=data.get("result"),
                error=data.get("error")
            )
        
        # Check database
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM idempotency_records
                WHERE idempotency_key = $1
            """, idempotency_key)
            
            if row:
                if row["request_hash"] != request_hash:
                    raise ValueError(
                        f"Idempotency key {idempotency_key} already used with different request"
                    )
                
                record = IdempotencyRecord(
                    idempotency_key=row["idempotency_key"],
                    operation=row["operation"],
                    status=IdempotencyStatus(row["status"]),
                    request_hash=row["request_hash"],
                    result=row["result"],
                    error=row["error"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                    expires_at=row["expires_at"],
                    client_id=row["client_id"],
                    correlation_id=row["correlation_id"]
                )
                
                # Cache in Redis
                await self._cache_record(record)
                
                return record
        
        return None
    
    async def start_operation(
        self,
        idempotency_key: str,
        operation: str,
        request: Dict[str, Any],
        client_id: str = None,
        correlation_id: str = None,
        ttl: timedelta = None
    ) -> bool:
        """
        Start an idempotent operation.
        Returns True if operation should proceed, False if already in progress.
        """
        request_hash = self._compute_request_hash(request)
        ttl = ttl or self.default_ttl
        expires_at = datetime.now(timezone.utc) + ttl
        
        # Try to acquire lock
        lock_key = f"idempotency:lock:{idempotency_key}"
        acquired = await self.redis_client.set(
            lock_key,
            "1",
            nx=True,
            ex=self.lock_timeout
        )
        
        if not acquired:
            # Another process is handling this operation
            return False
        
        try:
            # Check if already exists
            existing = await self.check_idempotency(idempotency_key, operation, request)
            if existing:
                if existing.status == IdempotencyStatus.COMPLETED:
                    return False  # Already completed
                elif existing.status == IdempotencyStatus.IN_PROGRESS:
                    return False  # Still in progress
                elif existing.status == IdempotencyStatus.FAILED:
                    # Allow retry of failed operations
                    pass
            
            # Create or update record
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO idempotency_records (
                        idempotency_key, operation, status, request_hash,
                        expires_at, client_id, correlation_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (idempotency_key) DO UPDATE SET
                        status = $3,
                        updated_at = NOW()
                """, idempotency_key, operation, IdempotencyStatus.IN_PROGRESS.value,
                    request_hash, expires_at, client_id, correlation_id)
            
            # Cache in Redis
            await self.redis_client.setex(
                f"idempotency:{idempotency_key}",
                int(ttl.total_seconds()),
                json.dumps({
                    "operation": operation,
                    "status": IdempotencyStatus.IN_PROGRESS.value,
                    "request_hash": request_hash
                })
            )
            
            return True
            
        except Exception as e:
            # Release lock on error
            await self.redis_client.delete(lock_key)
            raise
    
    async def complete_operation(
        self,
        idempotency_key: str,
        result: Dict[str, Any]
    ):
        """Mark operation as completed with result"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE idempotency_records
                SET status = $1, result = $2, updated_at = NOW()
                WHERE idempotency_key = $3
            """, IdempotencyStatus.COMPLETED.value, json.dumps(result), idempotency_key)
        
        # Update cache
        cached = await self.redis_client.get(f"idempotency:{idempotency_key}")
        if cached:
            data = json.loads(cached)
            data["status"] = IdempotencyStatus.COMPLETED.value
            data["result"] = result
            ttl = await self.redis_client.ttl(f"idempotency:{idempotency_key}")
            if ttl > 0:
                await self.redis_client.setex(
                    f"idempotency:{idempotency_key}",
                    ttl,
                    json.dumps(data)
                )
        
        # Release lock
        await self.redis_client.delete(f"idempotency:lock:{idempotency_key}")
    
    async def fail_operation(
        self,
        idempotency_key: str,
        error: str
    ):
        """Mark operation as failed"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE idempotency_records
                SET status = $1, error = $2, updated_at = NOW()
                WHERE idempotency_key = $3
            """, IdempotencyStatus.FAILED.value, error, idempotency_key)
        
        # Update cache
        cached = await self.redis_client.get(f"idempotency:{idempotency_key}")
        if cached:
            data = json.loads(cached)
            data["status"] = IdempotencyStatus.FAILED.value
            data["error"] = error
            ttl = await self.redis_client.ttl(f"idempotency:{idempotency_key}")
            if ttl > 0:
                await self.redis_client.setex(
                    f"idempotency:{idempotency_key}",
                    ttl,
                    json.dumps(data)
                )
        
        # Release lock
        await self.redis_client.delete(f"idempotency:lock:{idempotency_key}")
    
    async def _cache_record(self, record: IdempotencyRecord):
        """Cache record in Redis"""
        ttl = 3600  # 1 hour default
        if record.expires_at:
            remaining = (record.expires_at - datetime.now(timezone.utc)).total_seconds()
            if remaining > 0:
                ttl = int(remaining)
        
        await self.redis_client.setex(
            f"idempotency:{record.idempotency_key}",
            ttl,
            json.dumps({
                "operation": record.operation,
                "status": record.status.value,
                "request_hash": record.request_hash,
                "result": record.result,
                "error": record.error
            })
        )
    
    async def cleanup_expired(self):
        """Clean up expired idempotency records"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                DELETE FROM idempotency_records
                WHERE expires_at < NOW()
            """)


class OutboxService:
    """
    Outbox pattern implementation for reliable event publishing.
    Ensures events are published exactly once even if the service crashes.
    """
    
    def __init__(self):
        self.db_url = os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank"
        )
        self.kafka_bootstrap = os.getenv(
            "KAFKA_BOOTSTRAP_SERVERS",
            "kafka.remittance.svc.cluster.local:9092"
        )
        
        self.db_pool: Optional[asyncpg.Pool] = None
        self.kafka_producer: Optional[AIOKafkaProducer] = None
        
        self._running = False
        self._publisher_task: Optional[asyncio.Task] = None
    
    async def initialize(self):
        """Initialize connections"""
        self.db_pool = await asyncpg.create_pool(self.db_url, min_size=2, max_size=10)
        self.kafka_producer = AIOKafkaProducer(
            bootstrap_servers=self.kafka_bootstrap,
            value_serializer=lambda v: json.dumps(v, default=str).encode(),
            acks='all',
            enable_idempotence=True
        )
        await self.kafka_producer.start()
        await self._init_schema()
    
    async def _init_schema(self):
        """Initialize database schema"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS outbox_messages (
                    message_id TEXT PRIMARY KEY,
                    topic TEXT NOT NULL,
                    key TEXT,
                    value JSONB NOT NULL,
                    headers JSONB DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'pending',
                    retry_count INTEGER DEFAULT 0,
                    max_retries INTEGER DEFAULT 5,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    published_at TIMESTAMPTZ,
                    next_retry_at TIMESTAMPTZ
                );
                
                CREATE INDEX IF NOT EXISTS idx_outbox_pending 
                    ON outbox_messages(status, next_retry_at) 
                    WHERE status = 'pending';
            """)
    
    async def add_message(
        self,
        topic: str,
        value: Dict[str, Any],
        key: str = None,
        headers: Dict[str, str] = None,
        conn: asyncpg.Connection = None
    ) -> str:
        """
        Add a message to the outbox.
        Should be called within the same transaction as the business operation.
        """
        message_id = f"msg-{uuid.uuid4().hex}"
        
        async def _insert(c):
            await c.execute("""
                INSERT INTO outbox_messages (message_id, topic, key, value, headers)
                VALUES ($1, $2, $3, $4, $5)
            """, message_id, topic, key, json.dumps(value), json.dumps(headers or {}))
        
        if conn:
            await _insert(conn)
        else:
            async with self.db_pool.acquire() as c:
                await _insert(c)
        
        return message_id
    
    async def start_publisher(self):
        """Start the background publisher"""
        self._running = True
        self._publisher_task = asyncio.create_task(self._publish_loop())
    
    async def stop_publisher(self):
        """Stop the background publisher"""
        self._running = False
        if self._publisher_task:
            self._publisher_task.cancel()
            try:
                await self._publisher_task
            except asyncio.CancelledError:
                pass
    
    async def _publish_loop(self):
        """Background loop to publish pending messages"""
        while self._running:
            try:
                await self._publish_pending_messages()
            except Exception as e:
                logger.error(f"Error in publish loop: {e}")
            
            await asyncio.sleep(1)  # Poll every second
    
    async def _publish_pending_messages(self):
        """Publish pending messages from outbox"""
        async with self.db_pool.acquire() as conn:
            # Get pending messages
            rows = await conn.fetch("""
                SELECT * FROM outbox_messages
                WHERE status = 'pending'
                AND (next_retry_at IS NULL OR next_retry_at <= NOW())
                ORDER BY created_at
                LIMIT 100
                FOR UPDATE SKIP LOCKED
            """)
            
            for row in rows:
                try:
                    # Publish to Kafka
                    headers = [
                        (k, v.encode() if isinstance(v, str) else v)
                        for k, v in json.loads(row["headers"]).items()
                    ]
                    
                    await self.kafka_producer.send_and_wait(
                        row["topic"],
                        value=json.loads(row["value"]) if isinstance(row["value"], str) else row["value"],
                        key=row["key"].encode() if row["key"] else None,
                        headers=headers
                    )
                    
                    # Mark as published
                    await conn.execute("""
                        UPDATE outbox_messages
                        SET status = 'published', published_at = NOW()
                        WHERE message_id = $1
                    """, row["message_id"])
                    
                except Exception as e:
                    logger.error(f"Failed to publish message {row['message_id']}: {e}")
                    
                    # Update retry count
                    retry_count = row["retry_count"] + 1
                    if retry_count >= row["max_retries"]:
                        await conn.execute("""
                            UPDATE outbox_messages
                            SET status = 'failed', retry_count = $1
                            WHERE message_id = $2
                        """, retry_count, row["message_id"])
                    else:
                        # Exponential backoff
                        next_retry = datetime.now(timezone.utc) + timedelta(seconds=2 ** retry_count)
                        await conn.execute("""
                            UPDATE outbox_messages
                            SET retry_count = $1, next_retry_at = $2
                            WHERE message_id = $3
                        """, retry_count, next_retry, row["message_id"])


class InboxService:
    """
    Inbox pattern implementation for idempotent message consumption.
    Ensures messages are processed exactly once.
    """
    
    def __init__(self):
        self.db_url = os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank"
        )
        
        self.db_pool: Optional[asyncpg.Pool] = None
    
    async def initialize(self):
        """Initialize connections"""
        self.db_pool = await asyncpg.create_pool(self.db_url, min_size=2, max_size=10)
        await self._init_schema()
    
    async def _init_schema(self):
        """Initialize database schema"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS inbox_messages (
                    message_id TEXT PRIMARY KEY,
                    topic TEXT NOT NULL,
                    partition INTEGER NOT NULL,
                    offset_num BIGINT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'received',
                    received_at TIMESTAMPTZ DEFAULT NOW(),
                    processed_at TIMESTAMPTZ,
                    UNIQUE(topic, partition, offset_num)
                );
                
                CREATE INDEX IF NOT EXISTS idx_inbox_status 
                    ON inbox_messages(status);
            """)
    
    async def is_duplicate(
        self,
        message_id: str,
        topic: str,
        partition: int,
        offset: int
    ) -> bool:
        """Check if message was already processed"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT status FROM inbox_messages
                WHERE message_id = $1 OR (topic = $2 AND partition = $3 AND offset_num = $4)
            """, message_id, topic, partition, offset)
            
            return row is not None
    
    async def record_message(
        self,
        message_id: str,
        topic: str,
        partition: int,
        offset: int
    ):
        """Record a received message"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO inbox_messages (message_id, topic, partition, offset_num)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
            """, message_id, topic, partition, offset)
    
    async def mark_processed(self, message_id: str):
        """Mark message as processed"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE inbox_messages
                SET status = 'processed', processed_at = NOW()
                WHERE message_id = $1
            """, message_id)
    
    async def mark_failed(self, message_id: str):
        """Mark message as failed"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE inbox_messages
                SET status = 'failed'
                WHERE message_id = $1
            """, message_id)


def idempotent(operation: str):
    """Decorator for idempotent operations"""
    def decorator(func: Callable):
        async def wrapper(
            idempotency_key: str,
            request: Dict[str, Any],
            *args,
            **kwargs
        ):
            service = await get_idempotency_service()
            
            # Check for existing result
            existing = await service.check_idempotency(idempotency_key, operation, request)
            if existing and existing.status == IdempotencyStatus.COMPLETED:
                return existing.result
            
            # Start operation
            should_proceed = await service.start_operation(
                idempotency_key,
                operation,
                request,
                correlation_id=kwargs.get("correlation_id")
            )
            
            if not should_proceed:
                # Wait and check again
                await asyncio.sleep(1)
                existing = await service.check_idempotency(idempotency_key, operation, request)
                if existing and existing.status == IdempotencyStatus.COMPLETED:
                    return existing.result
                raise Exception("Operation in progress by another process")
            
            try:
                result = await func(idempotency_key, request, *args, **kwargs)
                await service.complete_operation(idempotency_key, result)
                return result
            except Exception as e:
                await service.fail_operation(idempotency_key, str(e))
                raise
        
        return wrapper
    return decorator


# Global instances
_idempotency_service: Optional[IdempotencyService] = None
_outbox_service: Optional[OutboxService] = None
_inbox_service: Optional[InboxService] = None


async def get_idempotency_service() -> IdempotencyService:
    """Get or create idempotency service"""
    global _idempotency_service
    if _idempotency_service is None:
        _idempotency_service = IdempotencyService()
        await _idempotency_service.initialize()
    return _idempotency_service


async def get_outbox_service() -> OutboxService:
    """Get or create outbox service"""
    global _outbox_service
    if _outbox_service is None:
        _outbox_service = OutboxService()
        await _outbox_service.initialize()
    return _outbox_service


async def get_inbox_service() -> InboxService:
    """Get or create inbox service"""
    global _inbox_service
    if _inbox_service is None:
        _inbox_service = InboxService()
        await _inbox_service.initialize()
    return _inbox_service
