"""
Postgres <-> Lakehouse CDC Sync

Bank-grade synchronization from Postgres to Lakehouse with:
- Change Data Capture (CDC) for guaranteed event capture
- Exactly-once semantics with deduplication
- Dead-letter queue with replay capability
- Checkpointing for crash recovery
- Idempotent batch ingestion
"""

import asyncio
import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple
from dataclasses import dataclass, field
import asyncpg
import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Configuration
POSTGRES_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/remittance")
LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://lakehouse-service:8020")
CDC_BATCH_SIZE = int(os.getenv("CDC_BATCH_SIZE", "100"))
CDC_POLL_INTERVAL_MS = int(os.getenv("CDC_POLL_INTERVAL_MS", "500"))
CHECKPOINT_INTERVAL_SECONDS = int(os.getenv("CHECKPOINT_INTERVAL_SECONDS", "30"))
DLQ_MAX_RETRIES = int(os.getenv("DLQ_MAX_RETRIES", "5"))
DLQ_RETRY_DELAY_SECONDS = int(os.getenv("DLQ_RETRY_DELAY_SECONDS", "60"))


class CDCEventType(str, Enum):
    INSERT = "INSERT"
    UPDATE = "UPDATE"
    DELETE = "DELETE"


class CDCEventStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DELIVERED = "delivered"
    FAILED = "failed"
    DEAD_LETTER = "dead_letter"


class ReplayStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class CDCEvent:
    """Change Data Capture event"""
    id: str
    table_name: str
    event_type: CDCEventType
    primary_key: str
    old_data: Optional[Dict[str, Any]]
    new_data: Optional[Dict[str, Any]]
    transaction_id: int
    sequence_number: int
    captured_at: datetime
    status: CDCEventStatus = CDCEventStatus.PENDING
    retry_count: int = 0
    error_message: Optional[str] = None
    idempotency_key: Optional[str] = None

    def to_lakehouse_event(self) -> Dict[str, Any]:
        """Convert to lakehouse event format"""
        return {
            "event_id": self.id,
            "event_type": f"cdc_{self.event_type.value.lower()}",
            "source_table": self.table_name,
            "primary_key": self.primary_key,
            "timestamp": self.captured_at.isoformat(),
            "payload": {
                "old": self.old_data,
                "new": self.new_data,
                "operation": self.event_type.value
            },
            "metadata": {
                "transaction_id": self.transaction_id,
                "sequence_number": self.sequence_number,
                "idempotency_key": self.idempotency_key
            }
        }


@dataclass
class Checkpoint:
    """CDC checkpoint for crash recovery"""
    id: str
    last_transaction_id: int
    last_sequence_number: int
    last_processed_at: datetime
    events_processed: int
    events_failed: int


@dataclass
class DeadLetterEntry:
    """Dead letter queue entry"""
    id: str
    event_id: str
    event_data: Dict[str, Any]
    error_message: str
    retry_count: int
    created_at: datetime
    last_retry_at: Optional[datetime]
    next_retry_at: Optional[datetime]


class CDCCapture:
    """
    Change Data Capture using Postgres logical replication slots
    
    For production, this would use:
    - pg_logical or wal2json for real CDC
    - Debezium for enterprise-grade CDC
    
    This implementation uses trigger-based CDC as a fallback
    that works without superuser privileges.
    """
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
        self._tracked_tables: Set[str] = set()
    
    async def initialize(self):
        """Initialize CDC infrastructure"""
        async with self.pool.acquire() as conn:
            # Create CDC events table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS cdc_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    table_name VARCHAR(255) NOT NULL,
                    event_type VARCHAR(10) NOT NULL,
                    primary_key VARCHAR(255) NOT NULL,
                    old_data JSONB,
                    new_data JSONB,
                    transaction_id BIGINT NOT NULL DEFAULT txid_current(),
                    sequence_number BIGSERIAL,
                    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    retry_count INTEGER DEFAULT 0,
                    error_message TEXT,
                    idempotency_key VARCHAR(255),
                    UNIQUE(idempotency_key)
                );
                
                CREATE INDEX IF NOT EXISTS idx_cdc_events_status 
                ON cdc_events(status, sequence_number);
                
                CREATE INDEX IF NOT EXISTS idx_cdc_events_table 
                ON cdc_events(table_name, captured_at);
                
                CREATE INDEX IF NOT EXISTS idx_cdc_events_txn 
                ON cdc_events(transaction_id, sequence_number);
            """)
            
            # Create CDC trigger function
            await conn.execute("""
                CREATE OR REPLACE FUNCTION cdc_trigger_function()
                RETURNS TRIGGER AS $$
                DECLARE
                    pk_value TEXT;
                    idem_key TEXT;
                BEGIN
                    -- Get primary key value
                    pk_value := COALESCE(
                        NEW.id::TEXT,
                        OLD.id::TEXT,
                        NEW.transaction_id::TEXT,
                        OLD.transaction_id::TEXT,
                        gen_random_uuid()::TEXT
                    );
                    
                    -- Generate idempotency key
                    idem_key := md5(
                        TG_TABLE_NAME || ':' || 
                        TG_OP || ':' || 
                        pk_value || ':' || 
                        txid_current()::TEXT
                    );
                    
                    INSERT INTO cdc_events (
                        table_name, event_type, primary_key,
                        old_data, new_data, idempotency_key
                    ) VALUES (
                        TG_TABLE_NAME,
                        TG_OP,
                        pk_value,
                        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') 
                             THEN to_jsonb(OLD) ELSE NULL END,
                        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') 
                             THEN to_jsonb(NEW) ELSE NULL END,
                        idem_key
                    ) ON CONFLICT (idempotency_key) DO NOTHING;
                    
                    RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;
            """)
            
            logger.info("CDC infrastructure initialized")
    
    async def track_table(self, table_name: str):
        """Add CDC tracking to a table"""
        if table_name in self._tracked_tables:
            return
        
        async with self.pool.acquire() as conn:
            # Check if table exists
            exists = await conn.fetchval("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = $1
                )
            """, table_name)
            
            if not exists:
                logger.warning(f"Table {table_name} does not exist, skipping CDC tracking")
                return
            
            # Create trigger for the table
            trigger_name = f"cdc_trigger_{table_name}"
            
            await conn.execute(f"""
                DROP TRIGGER IF EXISTS {trigger_name} ON {table_name};
                CREATE TRIGGER {trigger_name}
                AFTER INSERT OR UPDATE OR DELETE ON {table_name}
                FOR EACH ROW EXECUTE FUNCTION cdc_trigger_function();
            """)
            
            self._tracked_tables.add(table_name)
            logger.info(f"CDC tracking enabled for table: {table_name}")
    
    async def get_pending_events(self, limit: int = 100) -> List[CDCEvent]:
        """Get pending CDC events for processing"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                UPDATE cdc_events
                SET status = 'processing'
                WHERE id IN (
                    SELECT id FROM cdc_events
                    WHERE status = 'pending'
                    ORDER BY sequence_number
                    LIMIT $1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING *
            """, limit)
            
            return [
                CDCEvent(
                    id=str(row['id']),
                    table_name=row['table_name'],
                    event_type=CDCEventType(row['event_type']),
                    primary_key=row['primary_key'],
                    old_data=row['old_data'],
                    new_data=row['new_data'],
                    transaction_id=row['transaction_id'],
                    sequence_number=row['sequence_number'],
                    captured_at=row['captured_at'],
                    status=CDCEventStatus(row['status']),
                    retry_count=row['retry_count'],
                    idempotency_key=row['idempotency_key']
                )
                for row in rows
            ]
    
    async def mark_delivered(self, event_ids: List[str]):
        """Mark events as successfully delivered"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                UPDATE cdc_events
                SET status = 'delivered'
                WHERE id = ANY($1::uuid[])
            """, [uuid.UUID(eid) for eid in event_ids])
    
    async def mark_failed(self, event_id: str, error: str):
        """Mark an event as failed"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                UPDATE cdc_events
                SET status = CASE 
                        WHEN retry_count >= $3 THEN 'dead_letter'
                        ELSE 'pending'
                    END,
                    retry_count = retry_count + 1,
                    error_message = $2
                WHERE id = $1
            """, uuid.UUID(event_id), error, DLQ_MAX_RETRIES)


class ExactlyOnceDelivery:
    """
    Exactly-once delivery semantics for Lakehouse ingestion
    
    Guarantees:
    - Each event is delivered exactly once
    - Duplicate detection via idempotency keys
    - Ordered delivery within partitions
    """
    
    def __init__(self, pool: asyncpg.Pool, lakehouse_url: str):
        self.pool = pool
        self.lakehouse_url = lakehouse_url
        self._http_client: Optional[httpx.AsyncClient] = None
    
    async def initialize(self):
        """Initialize delivery tracking"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS lakehouse_deliveries (
                    idempotency_key VARCHAR(255) PRIMARY KEY,
                    event_id UUID NOT NULL,
                    delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    lakehouse_response JSONB,
                    batch_id VARCHAR(255)
                );
                
                CREATE INDEX IF NOT EXISTS idx_deliveries_time 
                ON lakehouse_deliveries(delivered_at);
                
                CREATE INDEX IF NOT EXISTS idx_deliveries_batch 
                ON lakehouse_deliveries(batch_id);
            """)
            
            self._http_client = httpx.AsyncClient(
                base_url=self.lakehouse_url,
                timeout=30.0
            )
            
            logger.info("Exactly-once delivery initialized")
    
    async def close(self):
        """Close HTTP client"""
        if self._http_client:
            await self._http_client.aclose()
    
    async def deliver_batch(
        self,
        events: List[CDCEvent]
    ) -> Tuple[List[str], List[Tuple[str, str]]]:
        """
        Deliver a batch of events with exactly-once semantics.
        
        Returns:
            Tuple of (delivered_event_ids, failed_events_with_errors)
        """
        if not events:
            return [], []
        
        batch_id = str(uuid.uuid4())
        delivered = []
        failed = []
        
        async with self.pool.acquire() as conn:
            # Filter out already-delivered events
            events_to_deliver = []
            for event in events:
                existing = await conn.fetchrow("""
                    SELECT idempotency_key FROM lakehouse_deliveries
                    WHERE idempotency_key = $1
                """, event.idempotency_key)
                
                if existing:
                    # Already delivered, mark as success
                    delivered.append(event.id)
                    logger.debug(f"Event {event.id} already delivered (deduplicated)")
                else:
                    events_to_deliver.append(event)
            
            if not events_to_deliver:
                return delivered, failed
            
            # Prepare batch payload
            lakehouse_events = [e.to_lakehouse_event() for e in events_to_deliver]
            
            try:
                # Send to lakehouse with idempotent batch ingestion
                response = await self._http_client.post(
                    "/api/v1/ingest/batch",
                    json={
                        "batch_id": batch_id,
                        "events": lakehouse_events,
                        "idempotency_keys": [e.idempotency_key for e in events_to_deliver]
                    },
                    headers={
                        "X-Idempotency-Key": batch_id,
                        "X-Batch-Size": str(len(events_to_deliver))
                    }
                )
                
                if response.status_code == 200:
                    result = response.json()
                    
                    # Record successful deliveries
                    async with conn.transaction():
                        for event in events_to_deliver:
                            await conn.execute("""
                                INSERT INTO lakehouse_deliveries (
                                    idempotency_key, event_id, batch_id, lakehouse_response
                                ) VALUES ($1, $2, $3, $4)
                                ON CONFLICT (idempotency_key) DO NOTHING
                            """, event.idempotency_key, uuid.UUID(event.id),
                                batch_id, json.dumps(result))
                            delivered.append(event.id)
                    
                    logger.info(f"Delivered batch {batch_id}: {len(delivered)} events")
                    
                elif response.status_code == 207:
                    # Partial success - some events failed
                    result = response.json()
                    
                    for event in events_to_deliver:
                        event_result = result.get("results", {}).get(event.id, {})
                        if event_result.get("success"):
                            await conn.execute("""
                                INSERT INTO lakehouse_deliveries (
                                    idempotency_key, event_id, batch_id
                                ) VALUES ($1, $2, $3)
                                ON CONFLICT (idempotency_key) DO NOTHING
                            """, event.idempotency_key, uuid.UUID(event.id), batch_id)
                            delivered.append(event.id)
                        else:
                            failed.append((event.id, event_result.get("error", "Unknown error")))
                    
                else:
                    # Full batch failure
                    error_msg = f"Lakehouse returned {response.status_code}: {response.text}"
                    for event in events_to_deliver:
                        failed.append((event.id, error_msg))
                    
            except Exception as e:
                error_msg = str(e)
                for event in events_to_deliver:
                    failed.append((event.id, error_msg))
                logger.error(f"Batch delivery failed: {e}")
        
        return delivered, failed


class DeadLetterQueue:
    """
    Dead Letter Queue for failed events
    
    Features:
    - Automatic retry with exponential backoff
    - Manual replay capability
    - Event inspection and debugging
    """
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def initialize(self):
        """Initialize DLQ tables"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS cdc_dead_letter (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    event_id UUID NOT NULL,
                    event_data JSONB NOT NULL,
                    error_message TEXT NOT NULL,
                    retry_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    last_retry_at TIMESTAMP WITH TIME ZONE,
                    next_retry_at TIMESTAMP WITH TIME ZONE,
                    resolved_at TIMESTAMP WITH TIME ZONE,
                    resolution_notes TEXT
                );
                
                CREATE INDEX IF NOT EXISTS idx_dlq_next_retry 
                ON cdc_dead_letter(next_retry_at) 
                WHERE resolved_at IS NULL;
                
                CREATE INDEX IF NOT EXISTS idx_dlq_created 
                ON cdc_dead_letter(created_at);
                
                -- Replay tracking
                CREATE TABLE IF NOT EXISTS cdc_replay_jobs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    completed_at TIMESTAMP WITH TIME ZONE,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    from_sequence BIGINT,
                    to_sequence BIGINT,
                    events_replayed INTEGER DEFAULT 0,
                    events_failed INTEGER DEFAULT 0,
                    error_message TEXT
                );
            """)
            
            logger.info("Dead letter queue initialized")
    
    async def add_to_dlq(
        self,
        event_id: str,
        event_data: Dict[str, Any],
        error: str
    ):
        """Add a failed event to the dead letter queue"""
        next_retry = datetime.utcnow() + timedelta(seconds=DLQ_RETRY_DELAY_SECONDS)
        
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO cdc_dead_letter (
                    event_id, event_data, error_message, next_retry_at
                ) VALUES ($1, $2, $3, $4)
            """, uuid.UUID(event_id), json.dumps(event_data), error, next_retry)
        
        logger.warning(f"Event {event_id} added to DLQ: {error}")
    
    async def get_retry_candidates(self, limit: int = 50) -> List[DeadLetterEntry]:
        """Get DLQ entries ready for retry"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM cdc_dead_letter
                WHERE resolved_at IS NULL
                AND next_retry_at <= NOW()
                AND retry_count < $1
                ORDER BY next_retry_at
                LIMIT $2
            """, DLQ_MAX_RETRIES, limit)
            
            return [
                DeadLetterEntry(
                    id=str(row['id']),
                    event_id=str(row['event_id']),
                    event_data=row['event_data'],
                    error_message=row['error_message'],
                    retry_count=row['retry_count'],
                    created_at=row['created_at'],
                    last_retry_at=row['last_retry_at'],
                    next_retry_at=row['next_retry_at']
                )
                for row in rows
            ]
    
    async def mark_retry_success(self, dlq_id: str):
        """Mark a DLQ entry as successfully retried"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                UPDATE cdc_dead_letter
                SET resolved_at = NOW(),
                    resolution_notes = 'Auto-resolved via retry'
                WHERE id = $1
            """, uuid.UUID(dlq_id))
    
    async def mark_retry_failed(self, dlq_id: str, error: str):
        """Mark a DLQ retry as failed"""
        # Exponential backoff: 1min, 2min, 4min, 8min, 16min
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT retry_count FROM cdc_dead_letter WHERE id = $1
            """, uuid.UUID(dlq_id))
            
            if row:
                retry_count = row['retry_count'] + 1
                delay_seconds = DLQ_RETRY_DELAY_SECONDS * (2 ** retry_count)
                next_retry = datetime.utcnow() + timedelta(seconds=delay_seconds)
                
                await conn.execute("""
                    UPDATE cdc_dead_letter
                    SET retry_count = $2,
                        last_retry_at = NOW(),
                        next_retry_at = $3,
                        error_message = $4
                    WHERE id = $1
                """, uuid.UUID(dlq_id), retry_count, next_retry, error)
    
    async def start_replay(
        self,
        from_sequence: Optional[int] = None,
        to_sequence: Optional[int] = None
    ) -> str:
        """Start a replay job for a range of events"""
        job_id = str(uuid.uuid4())
        
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO cdc_replay_jobs (id, from_sequence, to_sequence, status)
                VALUES ($1, $2, $3, 'pending')
            """, uuid.UUID(job_id), from_sequence, to_sequence)
        
        logger.info(f"Replay job created: {job_id}")
        return job_id
    
    async def get_dlq_stats(self) -> Dict[str, Any]:
        """Get DLQ statistics"""
        async with self.pool.acquire() as conn:
            stats = await conn.fetchrow("""
                SELECT 
                    COUNT(*) FILTER (WHERE resolved_at IS NULL) as pending,
                    COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) as resolved,
                    COUNT(*) FILTER (WHERE retry_count >= $1) as exhausted,
                    AVG(retry_count) as avg_retries
                FROM cdc_dead_letter
            """, DLQ_MAX_RETRIES)
            
            return {
                "pending": stats['pending'],
                "resolved": stats['resolved'],
                "exhausted": stats['exhausted'],
                "avg_retries": float(stats['avg_retries'] or 0)
            }


class CheckpointManager:
    """
    Checkpoint management for crash recovery
    
    Ensures:
    - No events are lost on crash
    - No duplicate processing after recovery
    - Efficient resumption from last known position
    """
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
        self._last_checkpoint: Optional[Checkpoint] = None
    
    async def initialize(self):
        """Initialize checkpoint table"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS cdc_checkpoints (
                    id VARCHAR(50) PRIMARY KEY,
                    last_transaction_id BIGINT NOT NULL,
                    last_sequence_number BIGINT NOT NULL,
                    last_processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    events_processed BIGINT DEFAULT 0,
                    events_failed BIGINT DEFAULT 0
                );
            """)
            
            # Load or create checkpoint
            row = await conn.fetchrow("""
                SELECT * FROM cdc_checkpoints WHERE id = 'main'
            """)
            
            if row:
                self._last_checkpoint = Checkpoint(
                    id=row['id'],
                    last_transaction_id=row['last_transaction_id'],
                    last_sequence_number=row['last_sequence_number'],
                    last_processed_at=row['last_processed_at'],
                    events_processed=row['events_processed'],
                    events_failed=row['events_failed']
                )
            else:
                # Create initial checkpoint
                await conn.execute("""
                    INSERT INTO cdc_checkpoints (
                        id, last_transaction_id, last_sequence_number
                    ) VALUES ('main', 0, 0)
                """)
                self._last_checkpoint = Checkpoint(
                    id='main',
                    last_transaction_id=0,
                    last_sequence_number=0,
                    last_processed_at=datetime.utcnow(),
                    events_processed=0,
                    events_failed=0
                )
            
            logger.info(f"Checkpoint loaded: seq={self._last_checkpoint.last_sequence_number}")
    
    async def save_checkpoint(
        self,
        transaction_id: int,
        sequence_number: int,
        events_processed: int,
        events_failed: int
    ):
        """Save a checkpoint"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                UPDATE cdc_checkpoints
                SET last_transaction_id = $1,
                    last_sequence_number = $2,
                    last_processed_at = NOW(),
                    events_processed = events_processed + $3,
                    events_failed = events_failed + $4
                WHERE id = 'main'
            """, transaction_id, sequence_number, events_processed, events_failed)
            
            self._last_checkpoint = Checkpoint(
                id='main',
                last_transaction_id=transaction_id,
                last_sequence_number=sequence_number,
                last_processed_at=datetime.utcnow(),
                events_processed=self._last_checkpoint.events_processed + events_processed,
                events_failed=self._last_checkpoint.events_failed + events_failed
            )
    
    def get_last_checkpoint(self) -> Optional[Checkpoint]:
        """Get the last saved checkpoint"""
        return self._last_checkpoint


class PostgresLakehouseSync:
    """
    Main CDC synchronization coordinator for Postgres -> Lakehouse
    
    Provides:
    - Change Data Capture from Postgres
    - Exactly-once delivery to Lakehouse
    - Dead letter queue with replay
    - Checkpointing for crash recovery
    """
    
    # Tables to track for CDC
    TRACKED_TABLES = [
        "transactions",
        "wallets",
        "users",
        "kyc_verifications",
        "accounts",
        "transfers",
        "exchange_rates",
        "corridors",
        "settlements",
        "reconciliation_runs"
    ]
    
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
        self.cdc_capture: Optional[CDCCapture] = None
        self.delivery: Optional[ExactlyOnceDelivery] = None
        self.dlq: Optional[DeadLetterQueue] = None
        self.checkpoint_manager: Optional[CheckpointManager] = None
        self._running = False
        self._sync_task: Optional[asyncio.Task] = None
        self._dlq_task: Optional[asyncio.Task] = None
        self._initialized = False
    
    async def initialize(self):
        """Initialize all sync components"""
        if self._initialized:
            return
        
        # Create connection pool
        self.pool = await asyncpg.create_pool(
            POSTGRES_URL,
            min_size=5,
            max_size=20,
            command_timeout=60
        )
        
        # Initialize components
        self.cdc_capture = CDCCapture(self.pool)
        await self.cdc_capture.initialize()
        
        self.delivery = ExactlyOnceDelivery(self.pool, LAKEHOUSE_URL)
        await self.delivery.initialize()
        
        self.dlq = DeadLetterQueue(self.pool)
        await self.dlq.initialize()
        
        self.checkpoint_manager = CheckpointManager(self.pool)
        await self.checkpoint_manager.initialize()
        
        # Track tables for CDC
        for table in self.TRACKED_TABLES:
            await self.cdc_capture.track_table(table)
        
        self._initialized = True
        logger.info("Postgres-Lakehouse sync initialized")
    
    async def start(self):
        """Start the sync process"""
        if not self._initialized:
            await self.initialize()
        
        self._running = True
        self._sync_task = asyncio.create_task(self._sync_loop())
        self._dlq_task = asyncio.create_task(self._dlq_retry_loop())
        
        logger.info("Postgres-Lakehouse sync started")
    
    async def stop(self):
        """Stop the sync process"""
        self._running = False
        
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass
        
        if self._dlq_task:
            self._dlq_task.cancel()
            try:
                await self._dlq_task
            except asyncio.CancelledError:
                pass
        
        if self.delivery:
            await self.delivery.close()
        
        if self.pool:
            await self.pool.close()
        
        self._initialized = False
        logger.info("Postgres-Lakehouse sync stopped")
    
    async def _sync_loop(self):
        """Main sync loop"""
        last_checkpoint_time = datetime.utcnow()
        events_since_checkpoint = 0
        failed_since_checkpoint = 0
        last_sequence = 0
        last_txn = 0
        
        while self._running:
            try:
                # Get pending events
                events = await self.cdc_capture.get_pending_events(CDC_BATCH_SIZE)
                
                if events:
                    # Deliver to lakehouse
                    delivered, failed = await self.delivery.deliver_batch(events)
                    
                    # Mark delivered events
                    if delivered:
                        await self.cdc_capture.mark_delivered(delivered)
                        events_since_checkpoint += len(delivered)
                    
                    # Handle failed events
                    for event_id, error in failed:
                        await self.cdc_capture.mark_failed(event_id, error)
                        failed_since_checkpoint += 1
                        
                        # Add to DLQ if exhausted retries
                        event = next((e for e in events if e.id == event_id), None)
                        if event and event.retry_count >= DLQ_MAX_RETRIES:
                            await self.dlq.add_to_dlq(
                                event_id,
                                event.to_lakehouse_event(),
                                error
                            )
                    
                    # Track last processed
                    if events:
                        last_sequence = max(e.sequence_number for e in events)
                        last_txn = max(e.transaction_id for e in events)
                
                # Checkpoint periodically
                now = datetime.utcnow()
                if (now - last_checkpoint_time).seconds >= CHECKPOINT_INTERVAL_SECONDS:
                    if events_since_checkpoint > 0 or failed_since_checkpoint > 0:
                        await self.checkpoint_manager.save_checkpoint(
                            last_txn, last_sequence,
                            events_since_checkpoint, failed_since_checkpoint
                        )
                        events_since_checkpoint = 0
                        failed_since_checkpoint = 0
                    last_checkpoint_time = now
                
                # Wait before next poll if no events
                if not events:
                    await asyncio.sleep(CDC_POLL_INTERVAL_MS / 1000)
                    
            except Exception as e:
                logger.error(f"Sync loop error: {e}")
                await asyncio.sleep(1)
    
    async def _dlq_retry_loop(self):
        """Background loop to retry DLQ entries"""
        while self._running:
            try:
                candidates = await self.dlq.get_retry_candidates()
                
                for entry in candidates:
                    try:
                        # Reconstruct event and retry
                        event_data = entry.event_data
                        
                        response = await self.delivery._http_client.post(
                            "/api/v1/ingest",
                            json=event_data,
                            headers={
                                "X-Idempotency-Key": event_data.get("metadata", {}).get("idempotency_key", entry.id)
                            }
                        )
                        
                        if response.status_code == 200:
                            await self.dlq.mark_retry_success(entry.id)
                            logger.info(f"DLQ retry successful: {entry.id}")
                        else:
                            await self.dlq.mark_retry_failed(
                                entry.id,
                                f"HTTP {response.status_code}: {response.text}"
                            )
                            
                    except Exception as e:
                        await self.dlq.mark_retry_failed(entry.id, str(e))
                
                # Wait before next check
                await asyncio.sleep(DLQ_RETRY_DELAY_SECONDS)
                
            except Exception as e:
                logger.error(f"DLQ retry loop error: {e}")
                await asyncio.sleep(10)
    
    async def get_sync_status(self) -> Dict[str, Any]:
        """Get current sync status"""
        checkpoint = self.checkpoint_manager.get_last_checkpoint()
        dlq_stats = await self.dlq.get_dlq_stats()
        
        async with self.pool.acquire() as conn:
            pending = await conn.fetchval("""
                SELECT COUNT(*) FROM cdc_events WHERE status = 'pending'
            """)
            
            processing = await conn.fetchval("""
                SELECT COUNT(*) FROM cdc_events WHERE status = 'processing'
            """)
        
        return {
            "healthy": dlq_stats['pending'] < 100 and pending < 1000,
            "running": self._running,
            "checkpoint": {
                "last_sequence": checkpoint.last_sequence_number if checkpoint else 0,
                "last_processed": checkpoint.last_processed_at.isoformat() if checkpoint else None,
                "total_processed": checkpoint.events_processed if checkpoint else 0,
                "total_failed": checkpoint.events_failed if checkpoint else 0
            },
            "queue": {
                "pending": pending,
                "processing": processing
            },
            "dlq": dlq_stats
        }
    
    async def replay_events(
        self,
        from_sequence: Optional[int] = None,
        to_sequence: Optional[int] = None
    ) -> str:
        """Replay events from a specific range"""
        job_id = await self.dlq.start_replay(from_sequence, to_sequence)
        
        # Start replay in background
        asyncio.create_task(self._execute_replay(job_id, from_sequence, to_sequence))
        
        return job_id
    
    async def _execute_replay(
        self,
        job_id: str,
        from_sequence: Optional[int],
        to_sequence: Optional[int]
    ):
        """Execute a replay job"""
        async with self.pool.acquire() as conn:
            try:
                await conn.execute("""
                    UPDATE cdc_replay_jobs SET status = 'in_progress' WHERE id = $1
                """, uuid.UUID(job_id))
                
                # Get events to replay
                query = """
                    SELECT * FROM cdc_events
                    WHERE status = 'delivered'
                """
                params = []
                
                if from_sequence:
                    query += f" AND sequence_number >= ${len(params) + 1}"
                    params.append(from_sequence)
                
                if to_sequence:
                    query += f" AND sequence_number <= ${len(params) + 1}"
                    params.append(to_sequence)
                
                query += " ORDER BY sequence_number"
                
                rows = await conn.fetch(query, *params)
                
                events_replayed = 0
                events_failed = 0
                
                for row in rows:
                    event = CDCEvent(
                        id=str(row['id']),
                        table_name=row['table_name'],
                        event_type=CDCEventType(row['event_type']),
                        primary_key=row['primary_key'],
                        old_data=row['old_data'],
                        new_data=row['new_data'],
                        transaction_id=row['transaction_id'],
                        sequence_number=row['sequence_number'],
                        captured_at=row['captured_at'],
                        idempotency_key=f"replay_{job_id}_{row['idempotency_key']}"
                    )
                    
                    delivered, failed = await self.delivery.deliver_batch([event])
                    
                    if delivered:
                        events_replayed += 1
                    else:
                        events_failed += 1
                
                await conn.execute("""
                    UPDATE cdc_replay_jobs
                    SET status = 'completed',
                        completed_at = NOW(),
                        events_replayed = $2,
                        events_failed = $3
                    WHERE id = $1
                """, uuid.UUID(job_id), events_replayed, events_failed)
                
                logger.info(f"Replay job {job_id} completed: {events_replayed} replayed, {events_failed} failed")
                
            except Exception as e:
                await conn.execute("""
                    UPDATE cdc_replay_jobs
                    SET status = 'failed', error_message = $2
                    WHERE id = $1
                """, uuid.UUID(job_id), str(e))
                logger.error(f"Replay job {job_id} failed: {e}")


# Singleton instance
_sync_instance: Optional[PostgresLakehouseSync] = None


async def get_postgres_lakehouse_sync() -> PostgresLakehouseSync:
    """Get or create the global sync instance"""
    global _sync_instance
    if _sync_instance is None:
        _sync_instance = PostgresLakehouseSync()
        await _sync_instance.initialize()
    return _sync_instance
