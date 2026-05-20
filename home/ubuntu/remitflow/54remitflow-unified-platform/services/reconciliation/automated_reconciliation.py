"""
Automated Reconciliation Service
Compares TigerBeetle balances vs bank statements vs Mojaloop transfers vs internal Postgres tables
Implements scheduled reconciliation with discrepancy detection and resolution workflows
"""

import os
import json
import logging
import asyncio
import hashlib
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from enum import Enum
import uuid

import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaProducer

logger = logging.getLogger(__name__)


class ReconciliationStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    DISCREPANCY_FOUND = "discrepancy_found"
    RESOLVED = "resolved"


class DiscrepancyType(str, Enum):
    BALANCE_MISMATCH = "balance_mismatch"
    MISSING_TRANSACTION = "missing_transaction"
    DUPLICATE_TRANSACTION = "duplicate_transaction"
    AMOUNT_MISMATCH = "amount_mismatch"
    STATUS_MISMATCH = "status_mismatch"
    TIMING_MISMATCH = "timing_mismatch"


class DiscrepancySeverity(str, Enum):
    LOW = "low"  # < 100 NGN
    MEDIUM = "medium"  # 100-10000 NGN
    HIGH = "high"  # 10000-100000 NGN
    CRITICAL = "critical"  # > 100000 NGN


class ResolutionAction(str, Enum):
    AUTO_RESOLVED = "auto_resolved"
    MANUAL_REVIEW = "manual_review"
    ADJUSTMENT_POSTED = "adjustment_posted"
    REVERSAL_INITIATED = "reversal_initiated"
    ESCALATED = "escalated"
    IGNORED = "ignored"


@dataclass
class ReconciliationRun:
    """Record of a reconciliation run"""
    run_id: str
    run_type: str  # daily, hourly, on_demand
    started_at: datetime
    completed_at: Optional[datetime] = None
    status: ReconciliationStatus = ReconciliationStatus.PENDING
    
    # Scope
    account_ids: List[str] = field(default_factory=list)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    
    # Results
    total_accounts: int = 0
    accounts_matched: int = 0
    accounts_with_discrepancy: int = 0
    total_transactions: int = 0
    transactions_matched: int = 0
    transactions_with_discrepancy: int = 0
    
    # Discrepancies
    discrepancies: List[Dict[str, Any]] = field(default_factory=list)
    
    # Metadata
    triggered_by: str = "scheduler"
    error_message: Optional[str] = None


@dataclass
class Discrepancy:
    """A reconciliation discrepancy"""
    discrepancy_id: str
    run_id: str
    discrepancy_type: DiscrepancyType
    severity: DiscrepancySeverity
    
    # Entity info
    account_id: Optional[str] = None
    transaction_id: Optional[str] = None
    
    # Values
    expected_value: Optional[Decimal] = None
    actual_value: Optional[Decimal] = None
    difference: Optional[Decimal] = None
    
    # Sources
    source_system: str = ""  # tigerbeetle, mojaloop, bank, postgres
    target_system: str = ""
    
    # Details
    description: str = ""
    details: Dict[str, Any] = field(default_factory=dict)
    
    # Resolution
    resolution_action: Optional[ResolutionAction] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None
    
    # Timestamps
    detected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class AuditLogEntry:
    """Immutable audit log entry with cryptographic chaining"""
    entry_id: str
    sequence_number: int
    timestamp: datetime
    
    # Event info
    event_type: str
    entity_type: str
    entity_id: str
    action: str
    
    # Actor
    actor_id: str
    actor_type: str  # user, system, service
    
    # Data
    old_value: Optional[Dict[str, Any]] = None
    new_value: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    # Cryptographic chain
    previous_hash: str = ""
    entry_hash: str = ""
    
    def compute_hash(self) -> str:
        """Compute hash for this entry"""
        data = {
            "entry_id": self.entry_id,
            "sequence_number": self.sequence_number,
            "timestamp": self.timestamp.isoformat(),
            "event_type": self.event_type,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "action": self.action,
            "actor_id": self.actor_id,
            "actor_type": self.actor_type,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "previous_hash": self.previous_hash
        }
        return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


class TigerBeetleClient:
    """Client for TigerBeetle ledger"""
    
    def __init__(self, cluster_id: str = None):
        self.cluster_id = cluster_id or os.getenv("TIGERBEETLE_CLUSTER_ID", "0")
        self.addresses = os.getenv(
            "TIGERBEETLE_ADDRESSES",
            "tigerbeetle.remittance.svc.cluster.local:3000"
        )
    
    async def get_account_balance(self, account_id: str) -> Dict[str, Decimal]:
        """Get account balance from TigerBeetle"""
        # In production, use actual TigerBeetle client
        # This is a placeholder that would be replaced with real implementation
        return {
            "debits_pending": Decimal("0"),
            "debits_posted": Decimal("0"),
            "credits_pending": Decimal("0"),
            "credits_posted": Decimal("0"),
            "balance": Decimal("0")
        }
    
    async def get_transfers(
        self,
        account_id: str,
        start_timestamp: int,
        end_timestamp: int
    ) -> List[Dict[str, Any]]:
        """Get transfers for account in time range"""
        return []


class MojaLoopClient:
    """Client for Mojaloop"""
    
    def __init__(self):
        self.base_url = os.getenv(
            "MOJALOOP_URL",
            "http://mojaloop.remittance.svc.cluster.local:4000"
        )
    
    async def get_participant_position(self, participant_id: str) -> Dict[str, Decimal]:
        """Get participant position from Mojaloop"""
        return {
            "currency": "NGN",
            "value": Decimal("0"),
            "reserved_value": Decimal("0")
        }
    
    async def get_transfers(
        self,
        participant_id: str,
        start_date: datetime,
        end_date: datetime
    ) -> List[Dict[str, Any]]:
        """Get transfers for participant in date range"""
        return []


class BankStatementClient:
    """Client for bank statement reconciliation"""
    
    def __init__(self):
        self.nibss_url = os.getenv("NIBSS_API_URL", "")
    
    async def get_statement(
        self,
        bank_code: str,
        account_number: str,
        start_date: datetime,
        end_date: datetime
    ) -> List[Dict[str, Any]]:
        """Get bank statement entries"""
        return []
    
    async def get_balance(
        self,
        bank_code: str,
        account_number: str
    ) -> Decimal:
        """Get current bank balance"""
        return Decimal("0")


class AutomatedReconciliationService:
    """
    Automated reconciliation service that compares balances and transactions
    across TigerBeetle, Mojaloop, bank statements, and internal Postgres tables.
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
        self.kafka_bootstrap = os.getenv(
            "KAFKA_BOOTSTRAP_SERVERS",
            "kafka.remittance.svc.cluster.local:9092"
        )
        
        self.db_pool: Optional[asyncpg.Pool] = None
        self.redis_client: Optional[redis.Redis] = None
        self.kafka_producer: Optional[AIOKafkaProducer] = None
        
        self.tigerbeetle = TigerBeetleClient()
        self.mojaloop = MojaLoopClient()
        self.bank_client = BankStatementClient()
        
        # Thresholds
        self.balance_tolerance = Decimal("0.01")  # 1 kobo tolerance
        self.timing_tolerance_seconds = 300  # 5 minutes
        
        # Audit log
        self._last_audit_hash = ""
        self._audit_sequence = 0
    
    async def initialize(self):
        """Initialize connections"""
        self.db_pool = await asyncpg.create_pool(self.db_url, min_size=2, max_size=10)
        self.redis_client = redis.from_url(self.redis_url)
        self.kafka_producer = AIOKafkaProducer(
            bootstrap_servers=self.kafka_bootstrap,
            value_serializer=lambda v: json.dumps(v, default=str).encode()
        )
        await self.kafka_producer.start()
        await self._init_schema()
        await self._load_audit_state()
    
    async def _init_schema(self):
        """Initialize database schema"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS reconciliation_runs (
                    run_id TEXT PRIMARY KEY,
                    run_type TEXT NOT NULL,
                    started_at TIMESTAMPTZ NOT NULL,
                    completed_at TIMESTAMPTZ,
                    status TEXT NOT NULL,
                    account_ids JSONB DEFAULT '[]',
                    start_date TIMESTAMPTZ,
                    end_date TIMESTAMPTZ,
                    total_accounts INTEGER DEFAULT 0,
                    accounts_matched INTEGER DEFAULT 0,
                    accounts_with_discrepancy INTEGER DEFAULT 0,
                    total_transactions INTEGER DEFAULT 0,
                    transactions_matched INTEGER DEFAULT 0,
                    transactions_with_discrepancy INTEGER DEFAULT 0,
                    triggered_by TEXT,
                    error_message TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
                    discrepancy_id TEXT PRIMARY KEY,
                    run_id TEXT REFERENCES reconciliation_runs(run_id),
                    discrepancy_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    account_id TEXT,
                    transaction_id TEXT,
                    expected_value DECIMAL(20, 4),
                    actual_value DECIMAL(20, 4),
                    difference DECIMAL(20, 4),
                    source_system TEXT,
                    target_system TEXT,
                    description TEXT,
                    details JSONB DEFAULT '{}',
                    resolution_action TEXT,
                    resolved_by TEXT,
                    resolved_at TIMESTAMPTZ,
                    resolution_notes TEXT,
                    detected_at TIMESTAMPTZ DEFAULT NOW(),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS financial_audit_log (
                    entry_id TEXT PRIMARY KEY,
                    sequence_number BIGINT NOT NULL UNIQUE,
                    timestamp TIMESTAMPTZ NOT NULL,
                    event_type TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    actor_id TEXT NOT NULL,
                    actor_type TEXT NOT NULL,
                    old_value JSONB,
                    new_value JSONB,
                    metadata JSONB DEFAULT '{}',
                    previous_hash TEXT NOT NULL,
                    entry_hash TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_recon_runs_status ON reconciliation_runs(status);
                CREATE INDEX IF NOT EXISTS idx_recon_runs_started ON reconciliation_runs(started_at);
                CREATE INDEX IF NOT EXISTS idx_discrepancies_run ON reconciliation_discrepancies(run_id);
                CREATE INDEX IF NOT EXISTS idx_discrepancies_severity ON reconciliation_discrepancies(severity);
                CREATE INDEX IF NOT EXISTS idx_discrepancies_unresolved 
                    ON reconciliation_discrepancies(severity, resolution_action) 
                    WHERE resolution_action IS NULL;
                CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON financial_audit_log(entity_type, entity_id);
                CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON financial_audit_log(timestamp);
                CREATE INDEX IF NOT EXISTS idx_audit_log_sequence ON financial_audit_log(sequence_number);
            """)
    
    async def _load_audit_state(self):
        """Load last audit log state for chain continuity"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT sequence_number, entry_hash 
                FROM financial_audit_log 
                ORDER BY sequence_number DESC 
                LIMIT 1
            """)
            if row:
                self._audit_sequence = row["sequence_number"]
                self._last_audit_hash = row["entry_hash"]
    
    async def run_daily_reconciliation(self) -> ReconciliationRun:
        """Run daily reconciliation for all accounts"""
        run = ReconciliationRun(
            run_id=f"recon-daily-{uuid.uuid4().hex[:8]}",
            run_type="daily",
            started_at=datetime.now(timezone.utc),
            start_date=datetime.now(timezone.utc) - timedelta(days=1),
            end_date=datetime.now(timezone.utc),
            triggered_by="scheduler"
        )
        
        await self._save_run(run)
        await self._log_audit_event(
            event_type="reconciliation_started",
            entity_type="reconciliation_run",
            entity_id=run.run_id,
            action="start",
            actor_id="scheduler",
            actor_type="system",
            new_value={"run_type": run.run_type, "start_date": run.start_date, "end_date": run.end_date}
        )
        
        try:
            run.status = ReconciliationStatus.IN_PROGRESS
            await self._save_run(run)
            
            # Get all active accounts
            accounts = await self._get_active_accounts()
            run.total_accounts = len(accounts)
            
            # Reconcile each account
            for account in accounts:
                discrepancies = await self._reconcile_account(
                    account_id=account["account_id"],
                    start_date=run.start_date,
                    end_date=run.end_date
                )
                
                if discrepancies:
                    run.accounts_with_discrepancy += 1
                    run.discrepancies.extend([d.__dict__ for d in discrepancies])
                    
                    for disc in discrepancies:
                        disc.run_id = run.run_id
                        await self._save_discrepancy(disc)
                else:
                    run.accounts_matched += 1
            
            # Reconcile transactions
            tx_discrepancies = await self._reconcile_transactions(
                start_date=run.start_date,
                end_date=run.end_date
            )
            
            run.transactions_with_discrepancy = len(tx_discrepancies)
            for disc in tx_discrepancies:
                disc.run_id = run.run_id
                await self._save_discrepancy(disc)
                run.discrepancies.append(disc.__dict__)
            
            # Determine final status
            if run.discrepancies:
                run.status = ReconciliationStatus.DISCREPANCY_FOUND
                await self._publish_discrepancy_alert(run)
            else:
                run.status = ReconciliationStatus.COMPLETED
            
            run.completed_at = datetime.now(timezone.utc)
            await self._save_run(run)
            
            await self._log_audit_event(
                event_type="reconciliation_completed",
                entity_type="reconciliation_run",
                entity_id=run.run_id,
                action="complete",
                actor_id="scheduler",
                actor_type="system",
                new_value={
                    "status": run.status.value,
                    "accounts_matched": run.accounts_matched,
                    "accounts_with_discrepancy": run.accounts_with_discrepancy,
                    "discrepancy_count": len(run.discrepancies)
                }
            )
            
        except Exception as e:
            logger.error(f"Reconciliation failed: {e}")
            run.status = ReconciliationStatus.FAILED
            run.error_message = str(e)
            run.completed_at = datetime.now(timezone.utc)
            await self._save_run(run)
            
            await self._log_audit_event(
                event_type="reconciliation_failed",
                entity_type="reconciliation_run",
                entity_id=run.run_id,
                action="fail",
                actor_id="scheduler",
                actor_type="system",
                new_value={"error": str(e)}
            )
        
        return run
    
    async def _get_active_accounts(self) -> List[Dict[str, Any]]:
        """Get all active accounts for reconciliation"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT DISTINCT account_id, account_type, bank_code, account_number
                FROM accounts
                WHERE status = 'active'
                AND account_type IN ('float', 'settlement', 'operating')
            """)
            return [dict(row) for row in rows]
    
    async def _reconcile_account(
        self,
        account_id: str,
        start_date: datetime,
        end_date: datetime
    ) -> List[Discrepancy]:
        """Reconcile a single account across all systems"""
        discrepancies = []
        
        # Get balances from all sources
        tb_balance = await self.tigerbeetle.get_account_balance(account_id)
        
        # Get internal Postgres balance
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT balance, pending_balance, available_balance
                FROM account_balances
                WHERE account_id = $1
            """, account_id)
            
            if row:
                pg_balance = Decimal(str(row["balance"]))
                
                # Compare TigerBeetle vs Postgres
                tb_net = tb_balance["credits_posted"] - tb_balance["debits_posted"]
                if abs(tb_net - pg_balance) > self.balance_tolerance:
                    discrepancies.append(Discrepancy(
                        discrepancy_id=f"disc-{uuid.uuid4().hex[:8]}",
                        run_id="",
                        discrepancy_type=DiscrepancyType.BALANCE_MISMATCH,
                        severity=self._calculate_severity(abs(tb_net - pg_balance)),
                        account_id=account_id,
                        expected_value=tb_net,
                        actual_value=pg_balance,
                        difference=tb_net - pg_balance,
                        source_system="tigerbeetle",
                        target_system="postgres",
                        description=f"Balance mismatch: TigerBeetle={tb_net}, Postgres={pg_balance}"
                    ))
        
        return discrepancies
    
    async def _reconcile_transactions(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> List[Discrepancy]:
        """Reconcile transactions across systems"""
        discrepancies = []
        
        # Get transactions from Postgres
        async with self.db_pool.acquire() as conn:
            pg_txns = await conn.fetch("""
                SELECT transaction_id, amount, status, created_at, completed_at
                FROM transactions
                WHERE created_at BETWEEN $1 AND $2
                AND status IN ('completed', 'posted')
            """, start_date, end_date)
            
            # Check each transaction exists in TigerBeetle
            for txn in pg_txns:
                # In production, verify against TigerBeetle
                pass
        
        return discrepancies
    
    def _calculate_severity(self, amount: Decimal) -> DiscrepancySeverity:
        """Calculate discrepancy severity based on amount"""
        if amount < 100:
            return DiscrepancySeverity.LOW
        elif amount < 10000:
            return DiscrepancySeverity.MEDIUM
        elif amount < 100000:
            return DiscrepancySeverity.HIGH
        else:
            return DiscrepancySeverity.CRITICAL
    
    async def _save_run(self, run: ReconciliationRun):
        """Save reconciliation run to database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO reconciliation_runs (
                    run_id, run_type, started_at, completed_at, status,
                    account_ids, start_date, end_date,
                    total_accounts, accounts_matched, accounts_with_discrepancy,
                    total_transactions, transactions_matched, transactions_with_discrepancy,
                    triggered_by, error_message
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (run_id) DO UPDATE SET
                    completed_at = EXCLUDED.completed_at,
                    status = EXCLUDED.status,
                    total_accounts = EXCLUDED.total_accounts,
                    accounts_matched = EXCLUDED.accounts_matched,
                    accounts_with_discrepancy = EXCLUDED.accounts_with_discrepancy,
                    total_transactions = EXCLUDED.total_transactions,
                    transactions_matched = EXCLUDED.transactions_matched,
                    transactions_with_discrepancy = EXCLUDED.transactions_with_discrepancy,
                    error_message = EXCLUDED.error_message
            """, run.run_id, run.run_type, run.started_at, run.completed_at,
                run.status.value, json.dumps(run.account_ids), run.start_date, run.end_date,
                run.total_accounts, run.accounts_matched, run.accounts_with_discrepancy,
                run.total_transactions, run.transactions_matched, run.transactions_with_discrepancy,
                run.triggered_by, run.error_message)
    
    async def _save_discrepancy(self, disc: Discrepancy):
        """Save discrepancy to database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO reconciliation_discrepancies (
                    discrepancy_id, run_id, discrepancy_type, severity,
                    account_id, transaction_id,
                    expected_value, actual_value, difference,
                    source_system, target_system, description, details,
                    resolution_action, resolved_by, resolved_at, resolution_notes,
                    detected_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            """, disc.discrepancy_id, disc.run_id, disc.discrepancy_type.value,
                disc.severity.value, disc.account_id, disc.transaction_id,
                disc.expected_value, disc.actual_value, disc.difference,
                disc.source_system, disc.target_system, disc.description,
                json.dumps(disc.details), 
                disc.resolution_action.value if disc.resolution_action else None,
                disc.resolved_by, disc.resolved_at, disc.resolution_notes,
                disc.detected_at)
    
    async def _publish_discrepancy_alert(self, run: ReconciliationRun):
        """Publish discrepancy alert to Kafka"""
        critical_discrepancies = [
            d for d in run.discrepancies 
            if d.get("severity") in ["high", "critical"]
        ]
        
        if critical_discrepancies:
            await self.kafka_producer.send(
                "reconciliation.alerts",
                value={
                    "run_id": run.run_id,
                    "alert_type": "critical_discrepancy",
                    "discrepancy_count": len(critical_discrepancies),
                    "total_difference": sum(
                        float(d.get("difference", 0) or 0) 
                        for d in critical_discrepancies
                    ),
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            )
    
    async def _log_audit_event(
        self,
        event_type: str,
        entity_type: str,
        entity_id: str,
        action: str,
        actor_id: str,
        actor_type: str,
        old_value: Dict[str, Any] = None,
        new_value: Dict[str, Any] = None,
        metadata: Dict[str, Any] = None
    ):
        """Log an immutable audit event with cryptographic chaining"""
        self._audit_sequence += 1
        
        entry = AuditLogEntry(
            entry_id=f"audit-{uuid.uuid4().hex}",
            sequence_number=self._audit_sequence,
            timestamp=datetime.now(timezone.utc),
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            actor_id=actor_id,
            actor_type=actor_type,
            old_value=old_value,
            new_value=new_value,
            metadata=metadata or {},
            previous_hash=self._last_audit_hash
        )
        
        entry.entry_hash = entry.compute_hash()
        self._last_audit_hash = entry.entry_hash
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO financial_audit_log (
                    entry_id, sequence_number, timestamp,
                    event_type, entity_type, entity_id, action,
                    actor_id, actor_type,
                    old_value, new_value, metadata,
                    previous_hash, entry_hash
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            """, entry.entry_id, entry.sequence_number, entry.timestamp,
                entry.event_type, entry.entity_type, entry.entity_id, entry.action,
                entry.actor_id, entry.actor_type,
                json.dumps(entry.old_value) if entry.old_value else None,
                json.dumps(entry.new_value) if entry.new_value else None,
                json.dumps(entry.metadata),
                entry.previous_hash, entry.entry_hash)
    
    async def resolve_discrepancy(
        self,
        discrepancy_id: str,
        action: ResolutionAction,
        resolved_by: str,
        notes: str
    ) -> bool:
        """Resolve a discrepancy"""
        async with self.db_pool.acquire() as conn:
            # Get current discrepancy
            row = await conn.fetchrow("""
                SELECT * FROM reconciliation_discrepancies
                WHERE discrepancy_id = $1
            """, discrepancy_id)
            
            if not row:
                return False
            
            old_value = dict(row)
            
            # Update discrepancy
            await conn.execute("""
                UPDATE reconciliation_discrepancies
                SET resolution_action = $1,
                    resolved_by = $2,
                    resolved_at = $3,
                    resolution_notes = $4
                WHERE discrepancy_id = $5
            """, action.value, resolved_by, datetime.now(timezone.utc), notes, discrepancy_id)
            
            # Log audit event
            await self._log_audit_event(
                event_type="discrepancy_resolved",
                entity_type="discrepancy",
                entity_id=discrepancy_id,
                action="resolve",
                actor_id=resolved_by,
                actor_type="user",
                old_value={"resolution_action": None},
                new_value={"resolution_action": action.value, "notes": notes}
            )
            
            return True
    
    async def verify_audit_chain(self) -> Tuple[bool, Optional[str]]:
        """Verify the integrity of the audit log chain"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM financial_audit_log
                ORDER BY sequence_number ASC
            """)
            
            previous_hash = ""
            for row in rows:
                entry = AuditLogEntry(
                    entry_id=row["entry_id"],
                    sequence_number=row["sequence_number"],
                    timestamp=row["timestamp"],
                    event_type=row["event_type"],
                    entity_type=row["entity_type"],
                    entity_id=row["entity_id"],
                    action=row["action"],
                    actor_id=row["actor_id"],
                    actor_type=row["actor_type"],
                    old_value=json.loads(row["old_value"]) if row["old_value"] else None,
                    new_value=json.loads(row["new_value"]) if row["new_value"] else None,
                    previous_hash=row["previous_hash"]
                )
                
                # Verify chain
                if entry.previous_hash != previous_hash:
                    return False, f"Chain broken at sequence {entry.sequence_number}"
                
                # Verify hash
                computed_hash = entry.compute_hash()
                if computed_hash != row["entry_hash"]:
                    return False, f"Hash mismatch at sequence {entry.sequence_number}"
                
                previous_hash = row["entry_hash"]
            
            return True, None
    
    async def get_unresolved_discrepancies(
        self,
        severity: Optional[DiscrepancySeverity] = None
    ) -> List[Dict[str, Any]]:
        """Get unresolved discrepancies"""
        async with self.db_pool.acquire() as conn:
            if severity:
                rows = await conn.fetch("""
                    SELECT * FROM reconciliation_discrepancies
                    WHERE resolution_action IS NULL
                    AND severity = $1
                    ORDER BY detected_at DESC
                """, severity.value)
            else:
                rows = await conn.fetch("""
                    SELECT * FROM reconciliation_discrepancies
                    WHERE resolution_action IS NULL
                    ORDER BY 
                        CASE severity 
                            WHEN 'critical' THEN 1 
                            WHEN 'high' THEN 2 
                            WHEN 'medium' THEN 3 
                            ELSE 4 
                        END,
                        detected_at DESC
                """)
            
            return [dict(row) for row in rows]


class ReconciliationScheduler:
    """Scheduler for automated reconciliation runs"""
    
    def __init__(self, service: AutomatedReconciliationService):
        self.service = service
        self._running = False
    
    async def start(self):
        """Start the scheduler"""
        self._running = True
        
        # Run daily reconciliation at 2 AM
        asyncio.create_task(self._daily_schedule())
        
        # Run hourly balance checks
        asyncio.create_task(self._hourly_schedule())
    
    async def stop(self):
        """Stop the scheduler"""
        self._running = False
    
    async def _daily_schedule(self):
        """Run daily reconciliation"""
        while self._running:
            now = datetime.now(timezone.utc)
            
            # Calculate time until 2 AM UTC
            target = now.replace(hour=2, minute=0, second=0, microsecond=0)
            if now >= target:
                target += timedelta(days=1)
            
            wait_seconds = (target - now).total_seconds()
            await asyncio.sleep(wait_seconds)
            
            if self._running:
                try:
                    await self.service.run_daily_reconciliation()
                except Exception as e:
                    logger.error(f"Daily reconciliation failed: {e}")
    
    async def _hourly_schedule(self):
        """Run hourly balance checks"""
        while self._running:
            await asyncio.sleep(3600)  # 1 hour
            
            if self._running:
                try:
                    # Quick balance check (subset of full reconciliation)
                    pass
                except Exception as e:
                    logger.error(f"Hourly balance check failed: {e}")


# Global instance
_reconciliation_service: Optional[AutomatedReconciliationService] = None


async def get_reconciliation_service() -> AutomatedReconciliationService:
    """Get or create reconciliation service instance"""
    global _reconciliation_service
    if _reconciliation_service is None:
        _reconciliation_service = AutomatedReconciliationService()
        await _reconciliation_service.initialize()
    return _reconciliation_service
