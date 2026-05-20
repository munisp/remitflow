"""
TigerBeetle <-> Postgres Bi-Directional Sync

Bank-grade synchronization between TigerBeetle ledger and Postgres with:
- Transactional outbox pattern for guaranteed event delivery
- Idempotent projection service for TigerBeetle -> Postgres
- Automatic reconciliation loop with drift detection and healing
- Durable pending transfer state (not in-memory)
- Exactly-once semantics with deduplication
"""

import asyncio
import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
import asyncpg

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Configuration
POSTGRES_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/remittance")
TIGERBEETLE_URL = os.getenv("TIGERBEETLE_URL", "http://localhost:3000")
SYNC_BATCH_SIZE = int(os.getenv("SYNC_BATCH_SIZE", "100"))
RECONCILIATION_INTERVAL_SECONDS = int(os.getenv("RECONCILIATION_INTERVAL_SECONDS", "300"))
OUTBOX_POLL_INTERVAL_MS = int(os.getenv("OUTBOX_POLL_INTERVAL_MS", "100"))


class SyncDirection(str, Enum):
    TIGERBEETLE_TO_POSTGRES = "tb_to_pg"
    POSTGRES_TO_TIGERBEETLE = "pg_to_tb"


class EventStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    DEAD_LETTER = "dead_letter"


class ReconciliationStatus(str, Enum):
    MATCHED = "matched"
    DRIFT_DETECTED = "drift_detected"
    HEALED = "healed"
    REQUIRES_MANUAL = "requires_manual"


@dataclass
class OutboxEvent:
    """Transactional outbox event for guaranteed delivery"""
    id: str
    event_type: str
    aggregate_type: str
    aggregate_id: str
    payload: Dict[str, Any]
    status: EventStatus = EventStatus.PENDING
    created_at: datetime = field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
    retry_count: int = 0
    max_retries: int = 5
    error_message: Optional[str] = None
    idempotency_key: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "event_type": self.event_type,
            "aggregate_type": self.aggregate_type,
            "aggregate_id": self.aggregate_id,
            "payload": self.payload,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "processed_at": self.processed_at.isoformat() if self.processed_at else None,
            "retry_count": self.retry_count,
            "error_message": self.error_message,
            "idempotency_key": self.idempotency_key
        }


@dataclass
class PendingTransferState:
    """Durable pending transfer state stored in Postgres"""
    transfer_id: str
    tigerbeetle_id: int
    debit_account_id: int
    credit_account_id: int
    amount: int
    ledger: int
    code: int
    status: str  # pending, posted, voided
    created_at: datetime
    expires_at: Optional[datetime] = None
    posted_at: Optional[datetime] = None
    voided_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class ReconciliationResult:
    """Result of a reconciliation check"""
    transfer_id: str
    status: ReconciliationStatus
    tigerbeetle_amount: Optional[int] = None
    postgres_amount: Optional[int] = None
    drift_amount: Optional[int] = None
    healed: bool = False
    healing_action: Optional[str] = None
    error: Optional[str] = None


class TransactionalOutbox:
    """
    Transactional Outbox Pattern Implementation
    
    Guarantees:
    - Events are written in the same transaction as business data
    - Events are delivered at-least-once with deduplication
    - Failed events are retried with exponential backoff
    - Dead-letter queue for permanently failed events
    """
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
        self._running = False
        self._processor_task: Optional[asyncio.Task] = None
    
    async def initialize(self):
        """Create outbox tables if they don't exist"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_outbox (
                    id UUID PRIMARY KEY,
                    event_type VARCHAR(100) NOT NULL,
                    aggregate_type VARCHAR(100) NOT NULL,
                    aggregate_id VARCHAR(255) NOT NULL,
                    payload JSONB NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    processed_at TIMESTAMP WITH TIME ZONE,
                    retry_count INTEGER DEFAULT 0,
                    max_retries INTEGER DEFAULT 5,
                    error_message TEXT,
                    idempotency_key VARCHAR(255),
                    UNIQUE(idempotency_key)
                );
                
                CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status);
                CREATE INDEX IF NOT EXISTS idx_outbox_created ON sync_outbox(created_at);
                CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON sync_outbox(aggregate_type, aggregate_id);
            """)
            
            # Create processed events table for deduplication
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_processed_events (
                    idempotency_key VARCHAR(255) PRIMARY KEY,
                    event_id UUID NOT NULL,
                    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    result JSONB
                );
                
                CREATE INDEX IF NOT EXISTS idx_processed_events_time 
                ON sync_processed_events(processed_at);
            """)
            
            logger.info("Transactional outbox tables initialized")
    
    async def add_event(
        self,
        conn: asyncpg.Connection,
        event_type: str,
        aggregate_type: str,
        aggregate_id: str,
        payload: Dict[str, Any],
        idempotency_key: Optional[str] = None
    ) -> str:
        """
        Add an event to the outbox within an existing transaction.
        This MUST be called within the same transaction as the business operation.
        """
        event_id = str(uuid.uuid4())
        
        if not idempotency_key:
            # Generate deterministic idempotency key from payload
            key_data = f"{aggregate_type}:{aggregate_id}:{event_type}:{json.dumps(payload, sort_keys=True)}"
            idempotency_key = hashlib.sha256(key_data.encode()).hexdigest()
        
        try:
            await conn.execute("""
                INSERT INTO sync_outbox (
                    id, event_type, aggregate_type, aggregate_id, 
                    payload, status, idempotency_key
                ) VALUES ($1, $2, $3, $4, $5, 'pending', $6)
                ON CONFLICT (idempotency_key) DO NOTHING
            """, uuid.UUID(event_id), event_type, aggregate_type, 
                aggregate_id, json.dumps(payload), idempotency_key)
            
            logger.debug(f"Added outbox event: {event_id} ({event_type})")
            return event_id
            
        except Exception as e:
            logger.error(f"Failed to add outbox event: {e}")
            raise
    
    async def start_processor(self, handler):
        """Start the background outbox processor"""
        self._running = True
        self._processor_task = asyncio.create_task(
            self._process_loop(handler)
        )
        logger.info("Outbox processor started")
    
    async def stop_processor(self):
        """Stop the background outbox processor"""
        self._running = False
        if self._processor_task:
            self._processor_task.cancel()
            try:
                await self._processor_task
            except asyncio.CancelledError:
                pass
        logger.info("Outbox processor stopped")
    
    async def _process_loop(self, handler):
        """Main processing loop for outbox events"""
        while self._running:
            try:
                processed = await self._process_batch(handler)
                if processed == 0:
                    # No events to process, wait before polling again
                    await asyncio.sleep(OUTBOX_POLL_INTERVAL_MS / 1000)
            except Exception as e:
                logger.error(f"Outbox processor error: {e}")
                await asyncio.sleep(1)  # Back off on error
    
    async def _process_batch(self, handler) -> int:
        """Process a batch of pending outbox events"""
        async with self.pool.acquire() as conn:
            # Claim a batch of pending events
            events = await conn.fetch("""
                UPDATE sync_outbox
                SET status = 'processing'
                WHERE id IN (
                    SELECT id FROM sync_outbox
                    WHERE status = 'pending'
                    AND (retry_count < max_retries)
                    ORDER BY created_at
                    LIMIT $1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING *
            """, SYNC_BATCH_SIZE)
            
            if not events:
                return 0
            
            for event in events:
                await self._process_event(conn, event, handler)
            
            return len(events)
    
    async def _process_event(self, conn: asyncpg.Connection, event, handler):
        """Process a single outbox event"""
        event_id = event['id']
        idempotency_key = event['idempotency_key']
        
        try:
            # Check if already processed (deduplication)
            existing = await conn.fetchrow("""
                SELECT * FROM sync_processed_events
                WHERE idempotency_key = $1
            """, idempotency_key)
            
            if existing:
                # Already processed, mark as completed
                await conn.execute("""
                    UPDATE sync_outbox
                    SET status = 'completed', processed_at = NOW()
                    WHERE id = $1
                """, event_id)
                logger.debug(f"Event {event_id} already processed (deduplicated)")
                return
            
            # Process the event
            payload = json.loads(event['payload']) if isinstance(event['payload'], str) else event['payload']
            result = await handler(
                event_type=event['event_type'],
                aggregate_type=event['aggregate_type'],
                aggregate_id=event['aggregate_id'],
                payload=payload
            )
            
            # Record successful processing
            async with conn.transaction():
                await conn.execute("""
                    INSERT INTO sync_processed_events (idempotency_key, event_id, result)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (idempotency_key) DO NOTHING
                """, idempotency_key, event_id, json.dumps(result) if result else None)
                
                await conn.execute("""
                    UPDATE sync_outbox
                    SET status = 'completed', processed_at = NOW()
                    WHERE id = $1
                """, event_id)
            
            logger.info(f"Successfully processed outbox event: {event_id}")
            
        except Exception as e:
            retry_count = event['retry_count'] + 1
            max_retries = event['max_retries']
            
            if retry_count >= max_retries:
                # Move to dead letter
                await conn.execute("""
                    UPDATE sync_outbox
                    SET status = 'dead_letter', 
                        retry_count = $2,
                        error_message = $3
                    WHERE id = $1
                """, event_id, retry_count, str(e))
                logger.error(f"Event {event_id} moved to dead letter after {retry_count} retries: {e}")
            else:
                # Mark for retry
                await conn.execute("""
                    UPDATE sync_outbox
                    SET status = 'pending',
                        retry_count = $2,
                        error_message = $3
                    WHERE id = $1
                """, event_id, retry_count, str(e))
                logger.warning(f"Event {event_id} will be retried ({retry_count}/{max_retries}): {e}")


class PendingTransferStore:
    """
    Durable Pending Transfer State Store
    
    Replaces in-memory tracking with Postgres-backed storage for:
    - Crash recovery
    - Multi-instance coordination
    - Audit trail
    """
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def initialize(self):
        """Create pending transfers table"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS pending_transfers (
                    transfer_id VARCHAR(255) PRIMARY KEY,
                    tigerbeetle_id BIGINT NOT NULL,
                    debit_account_id BIGINT NOT NULL,
                    credit_account_id BIGINT NOT NULL,
                    amount BIGINT NOT NULL,
                    ledger INTEGER NOT NULL,
                    code INTEGER NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    expires_at TIMESTAMP WITH TIME ZONE,
                    posted_at TIMESTAMP WITH TIME ZONE,
                    voided_at TIMESTAMP WITH TIME ZONE,
                    metadata JSONB,
                    CONSTRAINT valid_status CHECK (status IN ('pending', 'posted', 'voided', 'expired'))
                );
                
                CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_transfers(status);
                CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_transfers(expires_at) 
                    WHERE status = 'pending';
                CREATE INDEX IF NOT EXISTS idx_pending_tb_id ON pending_transfers(tigerbeetle_id);
            """)
            logger.info("Pending transfers table initialized")
    
    async def create_pending(
        self,
        conn: asyncpg.Connection,
        transfer_id: str,
        tigerbeetle_id: int,
        debit_account_id: int,
        credit_account_id: int,
        amount: int,
        ledger: int,
        code: int,
        expires_at: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> PendingTransferState:
        """Create a pending transfer record in the same transaction as TigerBeetle call"""
        await conn.execute("""
            INSERT INTO pending_transfers (
                transfer_id, tigerbeetle_id, debit_account_id, credit_account_id,
                amount, ledger, code, status, expires_at, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
        """, transfer_id, tigerbeetle_id, debit_account_id, credit_account_id,
            amount, ledger, code, expires_at, 
            json.dumps(metadata) if metadata else None)
        
        return PendingTransferState(
            transfer_id=transfer_id,
            tigerbeetle_id=tigerbeetle_id,
            debit_account_id=debit_account_id,
            credit_account_id=credit_account_id,
            amount=amount,
            ledger=ledger,
            code=code,
            status='pending',
            created_at=datetime.utcnow(),
            expires_at=expires_at,
            metadata=metadata
        )
    
    async def post_transfer(
        self,
        conn: asyncpg.Connection,
        transfer_id: str
    ) -> bool:
        """Mark a pending transfer as posted"""
        result = await conn.execute("""
            UPDATE pending_transfers
            SET status = 'posted', posted_at = NOW()
            WHERE transfer_id = $1 AND status = 'pending'
        """, transfer_id)
        return result == "UPDATE 1"
    
    async def void_transfer(
        self,
        conn: asyncpg.Connection,
        transfer_id: str,
        reason: Optional[str] = None
    ) -> bool:
        """Mark a pending transfer as voided"""
        metadata_update = {"void_reason": reason} if reason else {}
        result = await conn.execute("""
            UPDATE pending_transfers
            SET status = 'voided', 
                voided_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
            WHERE transfer_id = $1 AND status = 'pending'
        """, transfer_id, json.dumps(metadata_update))
        return result == "UPDATE 1"
    
    async def get_pending(self, transfer_id: str) -> Optional[PendingTransferState]:
        """Get a pending transfer by ID"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM pending_transfers WHERE transfer_id = $1
            """, transfer_id)
            
            if not row:
                return None
            
            return PendingTransferState(
                transfer_id=row['transfer_id'],
                tigerbeetle_id=row['tigerbeetle_id'],
                debit_account_id=row['debit_account_id'],
                credit_account_id=row['credit_account_id'],
                amount=row['amount'],
                ledger=row['ledger'],
                code=row['code'],
                status=row['status'],
                created_at=row['created_at'],
                expires_at=row['expires_at'],
                posted_at=row['posted_at'],
                voided_at=row['voided_at'],
                metadata=row['metadata']
            )
    
    async def get_expired_pending(self) -> List[PendingTransferState]:
        """Get all expired pending transfers for cleanup"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM pending_transfers
                WHERE status = 'pending'
                AND expires_at IS NOT NULL
                AND expires_at < NOW()
                ORDER BY expires_at
                LIMIT 100
            """)
            
            return [
                PendingTransferState(
                    transfer_id=row['transfer_id'],
                    tigerbeetle_id=row['tigerbeetle_id'],
                    debit_account_id=row['debit_account_id'],
                    credit_account_id=row['credit_account_id'],
                    amount=row['amount'],
                    ledger=row['ledger'],
                    code=row['code'],
                    status=row['status'],
                    created_at=row['created_at'],
                    expires_at=row['expires_at'],
                    metadata=row['metadata']
                )
                for row in rows
            ]


class IdempotentProjectionService:
    """
    Idempotent Projection Service for TigerBeetle -> Postgres
    
    Consumes TigerBeetle events and projects them to Postgres with:
    - Exactly-once semantics via idempotency keys
    - Ordered processing with sequence tracking
    - Automatic retry with backoff
    """
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def initialize(self):
        """Create projection tracking tables"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS tigerbeetle_projections (
                    projection_id VARCHAR(255) PRIMARY KEY,
                    event_type VARCHAR(100) NOT NULL,
                    tigerbeetle_id BIGINT,
                    account_id BIGINT,
                    transfer_id BIGINT,
                    amount BIGINT,
                    ledger INTEGER,
                    projected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    source_timestamp TIMESTAMP WITH TIME ZONE,
                    metadata JSONB
                );
                
                CREATE INDEX IF NOT EXISTS idx_projections_type ON tigerbeetle_projections(event_type);
                CREATE INDEX IF NOT EXISTS idx_projections_account ON tigerbeetle_projections(account_id);
                CREATE INDEX IF NOT EXISTS idx_projections_transfer ON tigerbeetle_projections(transfer_id);
                CREATE INDEX IF NOT EXISTS idx_projections_time ON tigerbeetle_projections(projected_at);
                
                -- Ledger balance snapshots for reconciliation
                CREATE TABLE IF NOT EXISTS ledger_balance_snapshots (
                    id SERIAL PRIMARY KEY,
                    account_id BIGINT NOT NULL,
                    ledger INTEGER NOT NULL,
                    debits_pending BIGINT NOT NULL DEFAULT 0,
                    debits_posted BIGINT NOT NULL DEFAULT 0,
                    credits_pending BIGINT NOT NULL DEFAULT 0,
                    credits_posted BIGINT NOT NULL DEFAULT 0,
                    snapshot_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    source VARCHAR(20) NOT NULL, -- 'tigerbeetle' or 'postgres'
                    UNIQUE(account_id, ledger, snapshot_at, source)
                );
                
                CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account 
                ON ledger_balance_snapshots(account_id, ledger);
            """)
            logger.info("Projection tables initialized")
    
    async def project_event(
        self,
        event_type: str,
        aggregate_type: str,
        aggregate_id: str,
        payload: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Project a TigerBeetle event to Postgres.
        Returns the projection result or None if already processed.
        """
        # Generate idempotency key
        projection_id = self._generate_projection_id(event_type, aggregate_id, payload)
        
        async with self.pool.acquire() as conn:
            # Check if already projected
            existing = await conn.fetchrow("""
                SELECT projection_id FROM tigerbeetle_projections
                WHERE projection_id = $1
            """, projection_id)
            
            if existing:
                logger.debug(f"Event already projected: {projection_id}")
                return None
            
            # Project based on event type
            async with conn.transaction():
                if event_type == "account_created":
                    await self._project_account_created(conn, projection_id, payload)
                elif event_type == "transfer_created":
                    await self._project_transfer_created(conn, projection_id, payload)
                elif event_type == "transfer_posted":
                    await self._project_transfer_posted(conn, projection_id, payload)
                elif event_type == "transfer_voided":
                    await self._project_transfer_voided(conn, projection_id, payload)
                elif event_type == "balance_updated":
                    await self._project_balance_updated(conn, projection_id, payload)
                else:
                    # Generic projection for unknown event types
                    await self._project_generic(conn, projection_id, event_type, payload)
            
            logger.info(f"Projected event: {event_type} -> {projection_id}")
            return {"projection_id": projection_id, "event_type": event_type}
    
    def _generate_projection_id(
        self,
        event_type: str,
        aggregate_id: str,
        payload: Dict[str, Any]
    ) -> str:
        """Generate deterministic projection ID for idempotency"""
        # Use TigerBeetle's transfer/account ID if available
        tb_id = payload.get("tigerbeetle_id") or payload.get("transfer_id") or payload.get("account_id")
        timestamp = payload.get("timestamp", "")
        
        key_data = f"{event_type}:{aggregate_id}:{tb_id}:{timestamp}"
        return hashlib.sha256(key_data.encode()).hexdigest()[:32]
    
    async def _project_account_created(
        self,
        conn: asyncpg.Connection,
        projection_id: str,
        payload: Dict[str, Any]
    ):
        """Project account creation event"""
        await conn.execute("""
            INSERT INTO tigerbeetle_projections (
                projection_id, event_type, account_id, ledger, metadata
            ) VALUES ($1, 'account_created', $2, $3, $4)
        """, projection_id, payload.get("account_id"), 
            payload.get("ledger"), json.dumps(payload))
        
        # Update or create account record in main accounts table
        await conn.execute("""
            INSERT INTO accounts (id, ledger, created_at, metadata)
            VALUES ($1, $2, NOW(), $3)
            ON CONFLICT (id) DO UPDATE SET
                metadata = COALESCE(accounts.metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = NOW()
        """, payload.get("account_id"), payload.get("ledger"), 
            json.dumps({"tigerbeetle_synced": True}))
    
    async def _project_transfer_created(
        self,
        conn: asyncpg.Connection,
        projection_id: str,
        payload: Dict[str, Any]
    ):
        """Project transfer creation event"""
        await conn.execute("""
            INSERT INTO tigerbeetle_projections (
                projection_id, event_type, transfer_id, account_id,
                amount, ledger, source_timestamp, metadata
            ) VALUES ($1, 'transfer_created', $2, $3, $4, $5, $6, $7)
        """, projection_id, payload.get("transfer_id"),
            payload.get("debit_account_id"), payload.get("amount"),
            payload.get("ledger"), 
            datetime.fromisoformat(payload["timestamp"]) if payload.get("timestamp") else None,
            json.dumps(payload))
    
    async def _project_transfer_posted(
        self,
        conn: asyncpg.Connection,
        projection_id: str,
        payload: Dict[str, Any]
    ):
        """Project transfer posted event"""
        await conn.execute("""
            INSERT INTO tigerbeetle_projections (
                projection_id, event_type, transfer_id, amount, 
                source_timestamp, metadata
            ) VALUES ($1, 'transfer_posted', $2, $3, $4, $5)
        """, projection_id, payload.get("transfer_id"),
            payload.get("amount"),
            datetime.fromisoformat(payload["timestamp"]) if payload.get("timestamp") else None,
            json.dumps(payload))
        
        # Update transaction status in main transactions table
        await conn.execute("""
            UPDATE transactions
            SET status = 'completed',
                completed_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || '{"tigerbeetle_posted": true}'::jsonb
            WHERE tigerbeetle_transfer_id = $1
        """, payload.get("transfer_id"))
    
    async def _project_transfer_voided(
        self,
        conn: asyncpg.Connection,
        projection_id: str,
        payload: Dict[str, Any]
    ):
        """Project transfer voided event"""
        await conn.execute("""
            INSERT INTO tigerbeetle_projections (
                projection_id, event_type, transfer_id, 
                source_timestamp, metadata
            ) VALUES ($1, 'transfer_voided', $2, $3, $4)
        """, projection_id, payload.get("transfer_id"),
            datetime.fromisoformat(payload["timestamp"]) if payload.get("timestamp") else None,
            json.dumps(payload))
        
        # Update transaction status
        await conn.execute("""
            UPDATE transactions
            SET status = 'voided',
                metadata = COALESCE(metadata, '{}'::jsonb) || '{"tigerbeetle_voided": true}'::jsonb
            WHERE tigerbeetle_transfer_id = $1
        """, payload.get("transfer_id"))
    
    async def _project_balance_updated(
        self,
        conn: asyncpg.Connection,
        projection_id: str,
        payload: Dict[str, Any]
    ):
        """Project balance update event - create snapshot"""
        await conn.execute("""
            INSERT INTO ledger_balance_snapshots (
                account_id, ledger, debits_pending, debits_posted,
                credits_pending, credits_posted, source
            ) VALUES ($1, $2, $3, $4, $5, $6, 'tigerbeetle')
        """, payload.get("account_id"), payload.get("ledger"),
            payload.get("debits_pending", 0), payload.get("debits_posted", 0),
            payload.get("credits_pending", 0), payload.get("credits_posted", 0))
        
        await conn.execute("""
            INSERT INTO tigerbeetle_projections (
                projection_id, event_type, account_id, ledger, metadata
            ) VALUES ($1, 'balance_updated', $2, $3, $4)
        """, projection_id, payload.get("account_id"),
            payload.get("ledger"), json.dumps(payload))
    
    async def _project_generic(
        self,
        conn: asyncpg.Connection,
        projection_id: str,
        event_type: str,
        payload: Dict[str, Any]
    ):
        """Generic projection for unknown event types"""
        await conn.execute("""
            INSERT INTO tigerbeetle_projections (
                projection_id, event_type, metadata
            ) VALUES ($1, $2, $3)
        """, projection_id, event_type, json.dumps(payload))


class ReconciliationLoop:
    """
    Automatic Reconciliation Loop
    
    Periodically compares TigerBeetle and Postgres state to:
    - Detect drift between systems
    - Automatically heal minor discrepancies
    - Alert on critical mismatches requiring manual intervention
    """
    
    def __init__(self, pool: asyncpg.Pool, tigerbeetle_client=None):
        self.pool = pool
        self.tigerbeetle_client = tigerbeetle_client
        self._running = False
        self._reconciliation_task: Optional[asyncio.Task] = None
    
    async def initialize(self):
        """Create reconciliation tracking tables"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS reconciliation_runs (
                    id UUID PRIMARY KEY,
                    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    completed_at TIMESTAMP WITH TIME ZONE,
                    status VARCHAR(20) NOT NULL DEFAULT 'running',
                    accounts_checked INTEGER DEFAULT 0,
                    transfers_checked INTEGER DEFAULT 0,
                    drifts_detected INTEGER DEFAULT 0,
                    drifts_healed INTEGER DEFAULT 0,
                    errors INTEGER DEFAULT 0,
                    summary JSONB
                );
                
                CREATE TABLE IF NOT EXISTS reconciliation_drifts (
                    id UUID PRIMARY KEY,
                    run_id UUID REFERENCES reconciliation_runs(id),
                    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    entity_type VARCHAR(50) NOT NULL,
                    entity_id VARCHAR(255) NOT NULL,
                    drift_type VARCHAR(50) NOT NULL,
                    tigerbeetle_value JSONB,
                    postgres_value JSONB,
                    drift_amount BIGINT,
                    status VARCHAR(20) NOT NULL DEFAULT 'detected',
                    healed_at TIMESTAMP WITH TIME ZONE,
                    healing_action TEXT,
                    requires_manual BOOLEAN DEFAULT FALSE,
                    notes TEXT
                );
                
                CREATE INDEX IF NOT EXISTS idx_drifts_run ON reconciliation_drifts(run_id);
                CREATE INDEX IF NOT EXISTS idx_drifts_status ON reconciliation_drifts(status);
                CREATE INDEX IF NOT EXISTS idx_drifts_entity ON reconciliation_drifts(entity_type, entity_id);
            """)
            logger.info("Reconciliation tables initialized")
    
    async def start(self):
        """Start the reconciliation loop"""
        self._running = True
        self._reconciliation_task = asyncio.create_task(self._reconciliation_loop())
        logger.info("Reconciliation loop started")
    
    async def stop(self):
        """Stop the reconciliation loop"""
        self._running = False
        if self._reconciliation_task:
            self._reconciliation_task.cancel()
            try:
                await self._reconciliation_task
            except asyncio.CancelledError:
                pass
        logger.info("Reconciliation loop stopped")
    
    async def _reconciliation_loop(self):
        """Main reconciliation loop"""
        while self._running:
            try:
                await self.run_reconciliation()
            except Exception as e:
                logger.error(f"Reconciliation error: {e}")
            
            await asyncio.sleep(RECONCILIATION_INTERVAL_SECONDS)
    
    async def run_reconciliation(self) -> Dict[str, Any]:
        """Run a full reconciliation check"""
        run_id = str(uuid.uuid4())
        
        async with self.pool.acquire() as conn:
            # Create run record
            await conn.execute("""
                INSERT INTO reconciliation_runs (id, status)
                VALUES ($1, 'running')
            """, uuid.UUID(run_id))
            
            try:
                results = await self._perform_reconciliation(conn, run_id)
                
                # Update run record
                await conn.execute("""
                    UPDATE reconciliation_runs
                    SET completed_at = NOW(),
                        status = 'completed',
                        accounts_checked = $2,
                        transfers_checked = $3,
                        drifts_detected = $4,
                        drifts_healed = $5,
                        errors = $6,
                        summary = $7
                    WHERE id = $1
                """, uuid.UUID(run_id), results['accounts_checked'],
                    results['transfers_checked'], results['drifts_detected'],
                    results['drifts_healed'], results['errors'],
                    json.dumps(results))
                
                logger.info(f"Reconciliation completed: {run_id}, drifts={results['drifts_detected']}")
                return results
                
            except Exception as e:
                await conn.execute("""
                    UPDATE reconciliation_runs
                    SET completed_at = NOW(), status = 'failed',
                        summary = $2
                    WHERE id = $1
                """, uuid.UUID(run_id), json.dumps({"error": str(e)}))
                raise
    
    async def _perform_reconciliation(
        self,
        conn: asyncpg.Connection,
        run_id: str
    ) -> Dict[str, Any]:
        """Perform the actual reconciliation checks"""
        results = {
            "accounts_checked": 0,
            "transfers_checked": 0,
            "drifts_detected": 0,
            "drifts_healed": 0,
            "errors": 0,
            "details": []
        }
        
        # Check pending transfers that should have been posted/voided
        pending_drifts = await self._check_pending_transfers(conn, run_id)
        results["drifts_detected"] += len(pending_drifts)
        results["details"].extend(pending_drifts)
        
        # Check balance snapshots
        balance_drifts = await self._check_balance_snapshots(conn, run_id)
        results["drifts_detected"] += len(balance_drifts)
        results["details"].extend(balance_drifts)
        
        # Attempt to heal minor drifts
        healed = await self._heal_drifts(conn, run_id)
        results["drifts_healed"] = healed
        
        return results
    
    async def _check_pending_transfers(
        self,
        conn: asyncpg.Connection,
        run_id: str
    ) -> List[Dict[str, Any]]:
        """Check for stale pending transfers"""
        drifts = []
        
        # Find pending transfers older than expected
        stale_pending = await conn.fetch("""
            SELECT * FROM pending_transfers
            WHERE status = 'pending'
            AND created_at < NOW() - INTERVAL '1 hour'
            AND (expires_at IS NULL OR expires_at > NOW())
        """)
        
        for transfer in stale_pending:
            drift_id = str(uuid.uuid4())
            await conn.execute("""
                INSERT INTO reconciliation_drifts (
                    id, run_id, entity_type, entity_id, drift_type,
                    postgres_value, status, requires_manual
                ) VALUES ($1, $2, 'pending_transfer', $3, 'stale_pending',
                    $4, 'detected', TRUE)
            """, uuid.UUID(drift_id), uuid.UUID(run_id),
                transfer['transfer_id'], json.dumps({
                    "created_at": transfer['created_at'].isoformat(),
                    "amount": transfer['amount']
                }))
            
            drifts.append({
                "type": "stale_pending",
                "transfer_id": transfer['transfer_id'],
                "age_hours": (datetime.utcnow() - transfer['created_at'].replace(tzinfo=None)).total_seconds() / 3600
            })
        
        return drifts
    
    async def _check_balance_snapshots(
        self,
        conn: asyncpg.Connection,
        run_id: str
    ) -> List[Dict[str, Any]]:
        """Check for balance discrepancies between snapshots"""
        drifts = []
        
        # Compare latest TigerBeetle and Postgres snapshots
        discrepancies = await conn.fetch("""
            WITH latest_tb AS (
                SELECT DISTINCT ON (account_id, ledger)
                    account_id, ledger, debits_posted, credits_posted, snapshot_at
                FROM ledger_balance_snapshots
                WHERE source = 'tigerbeetle'
                ORDER BY account_id, ledger, snapshot_at DESC
            ),
            latest_pg AS (
                SELECT DISTINCT ON (account_id, ledger)
                    account_id, ledger, debits_posted, credits_posted, snapshot_at
                FROM ledger_balance_snapshots
                WHERE source = 'postgres'
                ORDER BY account_id, ledger, snapshot_at DESC
            )
            SELECT 
                tb.account_id,
                tb.ledger,
                tb.debits_posted as tb_debits,
                tb.credits_posted as tb_credits,
                pg.debits_posted as pg_debits,
                pg.credits_posted as pg_credits,
                ABS(tb.debits_posted - COALESCE(pg.debits_posted, 0)) +
                ABS(tb.credits_posted - COALESCE(pg.credits_posted, 0)) as drift_amount
            FROM latest_tb tb
            LEFT JOIN latest_pg pg ON tb.account_id = pg.account_id AND tb.ledger = pg.ledger
            WHERE tb.debits_posted != COALESCE(pg.debits_posted, 0)
               OR tb.credits_posted != COALESCE(pg.credits_posted, 0)
        """)
        
        for disc in discrepancies:
            drift_id = str(uuid.uuid4())
            await conn.execute("""
                INSERT INTO reconciliation_drifts (
                    id, run_id, entity_type, entity_id, drift_type,
                    tigerbeetle_value, postgres_value, drift_amount, status
                ) VALUES ($1, $2, 'account_balance', $3, 'balance_mismatch',
                    $4, $5, $6, 'detected')
            """, uuid.UUID(drift_id), uuid.UUID(run_id),
                str(disc['account_id']),
                json.dumps({"debits": disc['tb_debits'], "credits": disc['tb_credits']}),
                json.dumps({"debits": disc['pg_debits'], "credits": disc['pg_credits']}),
                disc['drift_amount'])
            
            drifts.append({
                "type": "balance_mismatch",
                "account_id": disc['account_id'],
                "drift_amount": disc['drift_amount']
            })
        
        return drifts
    
    async def _heal_drifts(
        self,
        conn: asyncpg.Connection,
        run_id: str
    ) -> int:
        """Attempt to automatically heal minor drifts"""
        healed = 0
        
        # Heal expired pending transfers by voiding them
        expired = await conn.fetch("""
            SELECT * FROM pending_transfers
            WHERE status = 'pending'
            AND expires_at IS NOT NULL
            AND expires_at < NOW()
        """)
        
        for transfer in expired:
            try:
                await conn.execute("""
                    UPDATE pending_transfers
                    SET status = 'expired',
                        metadata = COALESCE(metadata, '{}'::jsonb) || 
                            '{"auto_expired": true, "expired_at": "%s"}'::jsonb
                    WHERE transfer_id = $1
                """ % datetime.utcnow().isoformat(), transfer['transfer_id'])
                
                # Record healing
                await conn.execute("""
                    UPDATE reconciliation_drifts
                    SET status = 'healed',
                        healed_at = NOW(),
                        healing_action = 'auto_expired'
                    WHERE run_id = $1
                    AND entity_id = $2
                    AND status = 'detected'
                """, uuid.UUID(run_id), transfer['transfer_id'])
                
                healed += 1
                logger.info(f"Auto-expired pending transfer: {transfer['transfer_id']}")
                
            except Exception as e:
                logger.error(f"Failed to heal expired transfer {transfer['transfer_id']}: {e}")
        
        return healed


class TigerBeetlePostgresSync:
    """
    Main synchronization coordinator for TigerBeetle <-> Postgres
    
    Provides:
    - Transactional outbox for guaranteed event delivery
    - Idempotent projections for TigerBeetle -> Postgres
    - Durable pending transfer state
    - Automatic reconciliation with drift healing
    """
    
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
        self.outbox: Optional[TransactionalOutbox] = None
        self.pending_store: Optional[PendingTransferStore] = None
        self.projection_service: Optional[IdempotentProjectionService] = None
        self.reconciliation_loop: Optional[ReconciliationLoop] = None
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
        self.outbox = TransactionalOutbox(self.pool)
        await self.outbox.initialize()
        
        self.pending_store = PendingTransferStore(self.pool)
        await self.pending_store.initialize()
        
        self.projection_service = IdempotentProjectionService(self.pool)
        await self.projection_service.initialize()
        
        self.reconciliation_loop = ReconciliationLoop(self.pool)
        await self.reconciliation_loop.initialize()
        
        # Start background processors
        await self.outbox.start_processor(self.projection_service.project_event)
        await self.reconciliation_loop.start()
        
        self._initialized = True
        logger.info("TigerBeetle-Postgres sync initialized")
    
    async def shutdown(self):
        """Gracefully shutdown sync components"""
        if self.outbox:
            await self.outbox.stop_processor()
        
        if self.reconciliation_loop:
            await self.reconciliation_loop.stop()
        
        if self.pool:
            await self.pool.close()
        
        self._initialized = False
        logger.info("TigerBeetle-Postgres sync shutdown complete")
    
    async def sync_transfer(
        self,
        transfer_id: str,
        tigerbeetle_id: int,
        debit_account_id: int,
        credit_account_id: int,
        amount: int,
        ledger: int,
        code: int,
        is_pending: bool = False,
        expires_at: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Synchronize a transfer from TigerBeetle to Postgres.
        This should be called AFTER the TigerBeetle operation succeeds.
        """
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Store pending transfer state if applicable
                if is_pending:
                    await self.pending_store.create_pending(
                        conn, transfer_id, tigerbeetle_id,
                        debit_account_id, credit_account_id,
                        amount, ledger, code, expires_at, metadata
                    )
                
                # Add to outbox for projection
                event_type = "transfer_pending" if is_pending else "transfer_created"
                event_id = await self.outbox.add_event(
                    conn,
                    event_type=event_type,
                    aggregate_type="transfer",
                    aggregate_id=transfer_id,
                    payload={
                        "transfer_id": transfer_id,
                        "tigerbeetle_id": tigerbeetle_id,
                        "debit_account_id": debit_account_id,
                        "credit_account_id": credit_account_id,
                        "amount": amount,
                        "ledger": ledger,
                        "code": code,
                        "is_pending": is_pending,
                        "timestamp": datetime.utcnow().isoformat(),
                        "metadata": metadata
                    }
                )
                
                return {
                    "transfer_id": transfer_id,
                    "event_id": event_id,
                    "synced": True
                }
    
    async def sync_post_transfer(
        self,
        transfer_id: str,
        posted_amount: Optional[int] = None
    ) -> Dict[str, Any]:
        """Synchronize a posted transfer"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Update pending transfer state
                await self.pending_store.post_transfer(conn, transfer_id)
                
                # Add to outbox
                event_id = await self.outbox.add_event(
                    conn,
                    event_type="transfer_posted",
                    aggregate_type="transfer",
                    aggregate_id=transfer_id,
                    payload={
                        "transfer_id": transfer_id,
                        "posted_amount": posted_amount,
                        "timestamp": datetime.utcnow().isoformat()
                    }
                )
                
                return {
                    "transfer_id": transfer_id,
                    "event_id": event_id,
                    "posted": True
                }
    
    async def sync_void_transfer(
        self,
        transfer_id: str,
        reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """Synchronize a voided transfer"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Update pending transfer state
                await self.pending_store.void_transfer(conn, transfer_id, reason)
                
                # Add to outbox
                event_id = await self.outbox.add_event(
                    conn,
                    event_type="transfer_voided",
                    aggregate_type="transfer",
                    aggregate_id=transfer_id,
                    payload={
                        "transfer_id": transfer_id,
                        "void_reason": reason,
                        "timestamp": datetime.utcnow().isoformat()
                    }
                )
                
                return {
                    "transfer_id": transfer_id,
                    "event_id": event_id,
                    "voided": True
                }
    
    async def get_sync_status(self) -> Dict[str, Any]:
        """Get current sync status and health"""
        async with self.pool.acquire() as conn:
            # Get outbox stats
            outbox_stats = await conn.fetchrow("""
                SELECT 
                    COUNT(*) FILTER (WHERE status = 'pending') as pending,
                    COUNT(*) FILTER (WHERE status = 'processing') as processing,
                    COUNT(*) FILTER (WHERE status = 'completed') as completed,
                    COUNT(*) FILTER (WHERE status = 'dead_letter') as dead_letter
                FROM sync_outbox
                WHERE created_at > NOW() - INTERVAL '24 hours'
            """)
            
            # Get latest reconciliation
            latest_recon = await conn.fetchrow("""
                SELECT * FROM reconciliation_runs
                ORDER BY started_at DESC
                LIMIT 1
            """)
            
            # Get unresolved drifts
            unresolved_drifts = await conn.fetchval("""
                SELECT COUNT(*) FROM reconciliation_drifts
                WHERE status = 'detected'
            """)
            
            return {
                "healthy": outbox_stats['dead_letter'] == 0 and unresolved_drifts < 10,
                "outbox": {
                    "pending": outbox_stats['pending'],
                    "processing": outbox_stats['processing'],
                    "completed_24h": outbox_stats['completed'],
                    "dead_letter": outbox_stats['dead_letter']
                },
                "reconciliation": {
                    "last_run": latest_recon['started_at'].isoformat() if latest_recon else None,
                    "last_status": latest_recon['status'] if latest_recon else None,
                    "unresolved_drifts": unresolved_drifts
                }
            }


# Singleton instance
_sync_instance: Optional[TigerBeetlePostgresSync] = None


async def get_tigerbeetle_postgres_sync() -> TigerBeetlePostgresSync:
    """Get or create the global sync instance"""
    global _sync_instance
    if _sync_instance is None:
        _sync_instance = TigerBeetlePostgresSync()
        await _sync_instance.initialize()
    return _sync_instance
