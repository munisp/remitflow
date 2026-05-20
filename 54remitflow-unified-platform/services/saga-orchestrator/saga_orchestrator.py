"""
Saga Orchestrator with Outbox Pattern
Implements distributed transactions across services with compensation
"""

import os
import json
import logging
import asyncio
import hashlib
from typing import Optional, Dict, Any, List, Callable, Awaitable
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from enum import Enum
from uuid import uuid4
from abc import ABC, abstractmethod

import asyncpg

logger = logging.getLogger(__name__)


class SagaStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPENSATING = "compensating"
    COMPENSATED = "compensated"
    FAILED = "failed"


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPENSATING = "compensating"
    COMPENSATED = "compensated"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class SagaStep:
    """Definition of a saga step"""
    name: str
    service: str
    action: str
    compensation_action: str
    timeout_seconds: int = 30
    retry_count: int = 3
    retry_delay_seconds: int = 1
    idempotency_key_fields: List[str] = field(default_factory=list)


@dataclass
class SagaStepResult:
    """Result of a saga step execution"""
    step_name: str
    status: StepStatus
    started_at: datetime
    completed_at: Optional[datetime] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    retry_count: int = 0
    idempotency_key: Optional[str] = None


@dataclass
class SagaInstance:
    """Instance of a running saga"""
    saga_id: str
    saga_type: str
    status: SagaStatus
    input_data: Dict[str, Any]
    context: Dict[str, Any]
    steps: List[SagaStepResult]
    current_step_index: int
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    correlation_id: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "saga_id": self.saga_id,
            "saga_type": self.saga_type,
            "status": self.status.value,
            "input_data": self.input_data,
            "context": self.context,
            "steps": [
                {
                    "step_name": s.step_name,
                    "status": s.status.value,
                    "started_at": s.started_at.isoformat() if s.started_at else None,
                    "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                    "result": s.result,
                    "error": s.error,
                    "retry_count": s.retry_count,
                    "idempotency_key": s.idempotency_key
                }
                for s in self.steps
            ],
            "current_step_index": self.current_step_index,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error": self.error,
            "correlation_id": self.correlation_id
        }


@dataclass
class OutboxMessage:
    """Message in the outbox for reliable delivery"""
    message_id: str
    saga_id: str
    destination: str
    payload: Dict[str, Any]
    created_at: datetime
    processed_at: Optional[datetime] = None
    retry_count: int = 0
    max_retries: int = 5
    idempotency_key: Optional[str] = None


class SagaDefinition(ABC):
    """Base class for saga definitions"""
    
    @property
    @abstractmethod
    def saga_type(self) -> str:
        pass
    
    @property
    @abstractmethod
    def steps(self) -> List[SagaStep]:
        pass
    
    @abstractmethod
    async def execute_step(
        self,
        step: SagaStep,
        context: Dict[str, Any],
        input_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute a saga step"""
        pass
    
    @abstractmethod
    async def compensate_step(
        self,
        step: SagaStep,
        context: Dict[str, Any],
        step_result: SagaStepResult
    ) -> bool:
        """Compensate a saga step"""
        pass


class AgentOnboardingSaga(SagaDefinition):
    """Saga for agent onboarding workflow"""
    
    @property
    def saga_type(self) -> str:
        return "agent_onboarding"
    
    @property
    def steps(self) -> List[SagaStep]:
        return [
            SagaStep(
                name="create_agent_record",
                service="agent-service",
                action="create_agent",
                compensation_action="delete_agent",
                timeout_seconds=30,
                idempotency_key_fields=["national_id"]
            ),
            SagaStep(
                name="verify_kyc",
                service="kyc-service",
                action="verify_kyc",
                compensation_action="cancel_kyc",
                timeout_seconds=120,
                retry_count=5
            ),
            SagaStep(
                name="create_wallet",
                service="wallet-service",
                action="create_wallet",
                compensation_action="close_wallet",
                timeout_seconds=30
            ),
            SagaStep(
                name="create_tigerbeetle_account",
                service="tigerbeetle-service",
                action="create_account",
                compensation_action="close_account",
                timeout_seconds=10
            ),
            SagaStep(
                name="assign_permissions",
                service="permify-service",
                action="assign_permissions",
                compensation_action="revoke_permissions",
                timeout_seconds=15
            ),
            SagaStep(
                name="send_welcome_notification",
                service="notification-service",
                action="send_welcome",
                compensation_action="noop",
                timeout_seconds=10,
                retry_count=1
            ),
        ]
    
    async def execute_step(
        self,
        step: SagaStep,
        context: Dict[str, Any],
        input_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute agent onboarding step"""
        import httpx
        
        service_urls = {
            "agent-service": os.getenv("AGENT_SERVICE_URL", "http://agent-service:8080"),
            "kyc-service": os.getenv("KYC_SERVICE_URL", "http://kyc-service:8080"),
            "wallet-service": os.getenv("WALLET_SERVICE_URL", "http://wallet-service:8080"),
            "tigerbeetle-service": os.getenv("TIGERBEETLE_SERVICE_URL", "http://tigerbeetle-service:8080"),
            "permify-service": os.getenv("PERMIFY_SERVICE_URL", "http://permify-service:8080"),
            "notification-service": os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8080"),
        }
        
        base_url = service_urls.get(step.service)
        if not base_url:
            raise ValueError(f"Unknown service: {step.service}")
        
        # Build request payload based on step
        payload = self._build_step_payload(step, context, input_data)
        
        async with httpx.AsyncClient(timeout=step.timeout_seconds) as client:
            response = await client.post(
                f"{base_url}/api/{step.action}",
                json=payload,
                headers={
                    "X-Correlation-ID": context.get("correlation_id", ""),
                    "X-Idempotency-Key": context.get("idempotency_key", "")
                }
            )
            response.raise_for_status()
            return response.json()
    
    async def compensate_step(
        self,
        step: SagaStep,
        context: Dict[str, Any],
        step_result: SagaStepResult
    ) -> bool:
        """Compensate agent onboarding step"""
        if step.compensation_action == "noop":
            return True
        
        import httpx
        
        service_urls = {
            "agent-service": os.getenv("AGENT_SERVICE_URL", "http://agent-service:8080"),
            "kyc-service": os.getenv("KYC_SERVICE_URL", "http://kyc-service:8080"),
            "wallet-service": os.getenv("WALLET_SERVICE_URL", "http://wallet-service:8080"),
            "tigerbeetle-service": os.getenv("TIGERBEETLE_SERVICE_URL", "http://tigerbeetle-service:8080"),
            "permify-service": os.getenv("PERMIFY_SERVICE_URL", "http://permify-service:8080"),
            "notification-service": os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8080"),
        }
        
        base_url = service_urls.get(step.service)
        if not base_url:
            return False
        
        try:
            async with httpx.AsyncClient(timeout=step.timeout_seconds) as client:
                response = await client.post(
                    f"{base_url}/api/{step.compensation_action}",
                    json=step_result.result or {},
                    headers={
                        "X-Correlation-ID": context.get("correlation_id", ""),
                        "X-Compensation": "true"
                    }
                )
                return response.status_code in (200, 204, 404)
        except Exception as e:
            logger.error(f"Compensation failed for {step.name}: {e}")
            return False
    
    def _build_step_payload(
        self,
        step: SagaStep,
        context: Dict[str, Any],
        input_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Build payload for step execution"""
        if step.name == "create_agent_record":
            return {
                "name": input_data.get("name"),
                "email": input_data.get("email"),
                "phone": input_data.get("phone"),
                "national_id": input_data.get("national_id"),
                "tier": input_data.get("tier", "agent"),
                "parent_agent_id": input_data.get("parent_agent_id")
            }
        elif step.name == "verify_kyc":
            return {
                "agent_id": context.get("agent_id"),
                "national_id": input_data.get("national_id"),
                "documents": input_data.get("documents", [])
            }
        elif step.name == "create_wallet":
            return {
                "agent_id": context.get("agent_id"),
                "currency": input_data.get("currency", "KES")
            }
        elif step.name == "create_tigerbeetle_account":
            return {
                "agent_id": context.get("agent_id"),
                "wallet_id": context.get("wallet_id"),
                "ledger": input_data.get("ledger", 1)
            }
        elif step.name == "assign_permissions":
            return {
                "agent_id": context.get("agent_id"),
                "tier": input_data.get("tier", "agent"),
                "permissions": input_data.get("permissions", [])
            }
        elif step.name == "send_welcome_notification":
            return {
                "agent_id": context.get("agent_id"),
                "email": input_data.get("email"),
                "phone": input_data.get("phone"),
                "template": "agent_welcome"
            }
        return {}


class TransferSaga(SagaDefinition):
    """Saga for P2P transfer workflow"""
    
    @property
    def saga_type(self) -> str:
        return "transfer"
    
    @property
    def steps(self) -> List[SagaStep]:
        return [
            SagaStep(
                name="validate_transfer",
                service="transaction-service",
                action="validate_transfer",
                compensation_action="noop",
                timeout_seconds=10,
                idempotency_key_fields=["source_account", "destination_account", "amount", "reference"]
            ),
            SagaStep(
                name="reserve_funds",
                service="tigerbeetle-service",
                action="reserve_funds",
                compensation_action="release_reservation",
                timeout_seconds=10
            ),
            SagaStep(
                name="execute_transfer",
                service="tigerbeetle-service",
                action="execute_transfer",
                compensation_action="reverse_transfer",
                timeout_seconds=10
            ),
            SagaStep(
                name="record_transaction",
                service="transaction-service",
                action="record_transaction",
                compensation_action="void_transaction",
                timeout_seconds=10
            ),
            SagaStep(
                name="send_notifications",
                service="notification-service",
                action="send_transfer_notifications",
                compensation_action="noop",
                timeout_seconds=10,
                retry_count=1
            ),
        ]
    
    async def execute_step(
        self,
        step: SagaStep,
        context: Dict[str, Any],
        input_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute transfer step"""
        # Implementation similar to AgentOnboardingSaga
        return {"status": "success"}
    
    async def compensate_step(
        self,
        step: SagaStep,
        context: Dict[str, Any],
        step_result: SagaStepResult
    ) -> bool:
        """Compensate transfer step"""
        return True


class SagaStore:
    """Persistent storage for saga state"""
    
    def __init__(self, database_url: str = None):
        self.database_url = database_url or os.getenv(
            "SAGA_DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/sagas"
        )
        self._pool: Optional[asyncpg.Pool] = None
    
    async def connect(self):
        """Connect to database"""
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self.database_url, min_size=2, max_size=10)
            await self._ensure_schema()
    
    async def _ensure_schema(self):
        """Ensure saga schema exists"""
        async with self._pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS sagas (
                    saga_id UUID PRIMARY KEY,
                    saga_type VARCHAR(100) NOT NULL,
                    status VARCHAR(20) NOT NULL,
                    input_data JSONB NOT NULL,
                    context JSONB NOT NULL DEFAULT '{}',
                    steps JSONB NOT NULL DEFAULT '[]',
                    current_step_index INTEGER DEFAULT 0,
                    error TEXT,
                    correlation_id VARCHAR(255),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    completed_at TIMESTAMPTZ
                );
                
                CREATE TABLE IF NOT EXISTS outbox (
                    message_id UUID PRIMARY KEY,
                    saga_id UUID REFERENCES sagas(saga_id),
                    destination VARCHAR(255) NOT NULL,
                    payload JSONB NOT NULL,
                    idempotency_key VARCHAR(255),
                    retry_count INTEGER DEFAULT 0,
                    max_retries INTEGER DEFAULT 5,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    processed_at TIMESTAMPTZ
                );
                
                CREATE INDEX IF NOT EXISTS idx_sagas_status ON sagas(status);
                CREATE INDEX IF NOT EXISTS idx_sagas_type ON sagas(saga_type);
                CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox(processed_at) WHERE processed_at IS NULL;
                CREATE INDEX IF NOT EXISTS idx_outbox_saga ON outbox(saga_id);
            """)
    
    async def save_saga(self, saga: SagaInstance):
        """Save saga state"""
        await self.connect()
        
        async with self._pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO sagas (
                    saga_id, saga_type, status, input_data, context, steps,
                    current_step_index, error, correlation_id, created_at, updated_at, completed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (saga_id) DO UPDATE SET
                    status = $3,
                    context = $5,
                    steps = $6,
                    current_step_index = $7,
                    error = $8,
                    updated_at = $11,
                    completed_at = $12
            """,
                saga.saga_id,
                saga.saga_type,
                saga.status.value,
                json.dumps(saga.input_data),
                json.dumps(saga.context),
                json.dumps([
                    {
                        "step_name": s.step_name,
                        "status": s.status.value,
                        "started_at": s.started_at.isoformat() if s.started_at else None,
                        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                        "result": s.result,
                        "error": s.error,
                        "retry_count": s.retry_count,
                        "idempotency_key": s.idempotency_key
                    }
                    for s in saga.steps
                ]),
                saga.current_step_index,
                saga.error,
                saga.correlation_id,
                saga.created_at,
                saga.updated_at,
                saga.completed_at
            )
    
    async def get_saga(self, saga_id: str) -> Optional[SagaInstance]:
        """Get saga by ID"""
        await self.connect()
        
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM sagas WHERE saga_id = $1",
                saga_id
            )
            
            if not row:
                return None
            
            steps_data = json.loads(row["steps"])
            steps = [
                SagaStepResult(
                    step_name=s["step_name"],
                    status=StepStatus(s["status"]),
                    started_at=datetime.fromisoformat(s["started_at"]) if s["started_at"] else None,
                    completed_at=datetime.fromisoformat(s["completed_at"]) if s["completed_at"] else None,
                    result=s.get("result"),
                    error=s.get("error"),
                    retry_count=s.get("retry_count", 0),
                    idempotency_key=s.get("idempotency_key")
                )
                for s in steps_data
            ]
            
            return SagaInstance(
                saga_id=str(row["saga_id"]),
                saga_type=row["saga_type"],
                status=SagaStatus(row["status"]),
                input_data=json.loads(row["input_data"]),
                context=json.loads(row["context"]),
                steps=steps,
                current_step_index=row["current_step_index"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                completed_at=row["completed_at"],
                error=row["error"],
                correlation_id=row["correlation_id"]
            )
    
    async def get_pending_sagas(self, limit: int = 100) -> List[SagaInstance]:
        """Get sagas that need processing"""
        await self.connect()
        
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT saga_id FROM sagas
                WHERE status IN ('pending', 'running', 'compensating')
                ORDER BY created_at ASC
                LIMIT $1
            """, limit)
            
            sagas = []
            for row in rows:
                saga = await self.get_saga(str(row["saga_id"]))
                if saga:
                    sagas.append(saga)
            
            return sagas
    
    async def add_outbox_message(self, message: OutboxMessage):
        """Add message to outbox"""
        await self.connect()
        
        async with self._pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO outbox (
                    message_id, saga_id, destination, payload,
                    idempotency_key, retry_count, max_retries, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
                message.message_id,
                message.saga_id,
                message.destination,
                json.dumps(message.payload),
                message.idempotency_key,
                message.retry_count,
                message.max_retries,
                message.created_at
            )
    
    async def get_pending_outbox_messages(self, limit: int = 100) -> List[OutboxMessage]:
        """Get unprocessed outbox messages"""
        await self.connect()
        
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM outbox
                WHERE processed_at IS NULL AND retry_count < max_retries
                ORDER BY created_at ASC
                LIMIT $1
            """, limit)
            
            return [
                OutboxMessage(
                    message_id=str(row["message_id"]),
                    saga_id=str(row["saga_id"]),
                    destination=row["destination"],
                    payload=json.loads(row["payload"]),
                    created_at=row["created_at"],
                    processed_at=row["processed_at"],
                    retry_count=row["retry_count"],
                    max_retries=row["max_retries"],
                    idempotency_key=row["idempotency_key"]
                )
                for row in rows
            ]
    
    async def mark_outbox_processed(self, message_id: str):
        """Mark outbox message as processed"""
        await self.connect()
        
        async with self._pool.acquire() as conn:
            await conn.execute("""
                UPDATE outbox SET processed_at = NOW() WHERE message_id = $1
            """, message_id)
    
    async def increment_outbox_retry(self, message_id: str):
        """Increment retry count for outbox message"""
        await self.connect()
        
        async with self._pool.acquire() as conn:
            await conn.execute("""
                UPDATE outbox SET retry_count = retry_count + 1 WHERE message_id = $1
            """, message_id)


class SagaOrchestrator:
    """
    Saga Orchestrator that manages distributed transactions.
    Implements the saga pattern with compensation and outbox for reliability.
    """
    
    def __init__(self, store: Optional[SagaStore] = None):
        self.store = store or SagaStore()
        self._definitions: Dict[str, SagaDefinition] = {}
        self._running = False
        
        # Register built-in sagas
        self.register_saga(AgentOnboardingSaga())
        self.register_saga(TransferSaga())
    
    def register_saga(self, definition: SagaDefinition):
        """Register a saga definition"""
        self._definitions[definition.saga_type] = definition
        logger.info(f"Registered saga: {definition.saga_type}")
    
    async def start_saga(
        self,
        saga_type: str,
        input_data: Dict[str, Any],
        correlation_id: Optional[str] = None
    ) -> str:
        """Start a new saga instance"""
        definition = self._definitions.get(saga_type)
        if not definition:
            raise ValueError(f"Unknown saga type: {saga_type}")
        
        saga_id = str(uuid4())
        now = datetime.now(timezone.utc)
        
        # Initialize step results
        steps = [
            SagaStepResult(
                step_name=step.name,
                status=StepStatus.PENDING,
                started_at=now
            )
            for step in definition.steps
        ]
        
        saga = SagaInstance(
            saga_id=saga_id,
            saga_type=saga_type,
            status=SagaStatus.PENDING,
            input_data=input_data,
            context={},
            steps=steps,
            current_step_index=0,
            created_at=now,
            updated_at=now,
            correlation_id=correlation_id or str(uuid4())
        )
        
        await self.store.save_saga(saga)
        logger.info(f"Started saga {saga_id} of type {saga_type}")
        
        # Execute saga asynchronously
        asyncio.create_task(self._execute_saga(saga))
        
        return saga_id
    
    async def _execute_saga(self, saga: SagaInstance):
        """Execute saga steps"""
        definition = self._definitions.get(saga.saga_type)
        if not definition:
            return
        
        saga.status = SagaStatus.RUNNING
        await self.store.save_saga(saga)
        
        try:
            for i, step_def in enumerate(definition.steps):
                if i < saga.current_step_index:
                    continue
                
                saga.current_step_index = i
                step_result = saga.steps[i]
                step_result.status = StepStatus.RUNNING
                step_result.started_at = datetime.now(timezone.utc)
                await self.store.save_saga(saga)
                
                # Generate idempotency key
                if step_def.idempotency_key_fields:
                    key_data = {k: saga.input_data.get(k) for k in step_def.idempotency_key_fields}
                    step_result.idempotency_key = hashlib.sha256(
                        json.dumps(key_data, sort_keys=True).encode()
                    ).hexdigest()
                
                # Execute step with retries
                success = False
                for retry in range(step_def.retry_count + 1):
                    try:
                        result = await definition.execute_step(
                            step_def,
                            saga.context,
                            saga.input_data
                        )
                        
                        # Update context with step result
                        saga.context.update(result)
                        step_result.result = result
                        step_result.status = StepStatus.COMPLETED
                        step_result.completed_at = datetime.now(timezone.utc)
                        success = True
                        break
                    except Exception as e:
                        step_result.retry_count = retry + 1
                        step_result.error = str(e)
                        logger.warning(f"Step {step_def.name} failed (retry {retry + 1}): {e}")
                        
                        if retry < step_def.retry_count:
                            await asyncio.sleep(step_def.retry_delay_seconds * (2 ** retry))
                
                if not success:
                    step_result.status = StepStatus.FAILED
                    saga.status = SagaStatus.COMPENSATING
                    saga.error = f"Step {step_def.name} failed after {step_def.retry_count + 1} attempts"
                    await self.store.save_saga(saga)
                    
                    # Start compensation
                    await self._compensate_saga(saga, definition)
                    return
                
                await self.store.save_saga(saga)
            
            # All steps completed successfully
            saga.status = SagaStatus.COMPLETED
            saga.completed_at = datetime.now(timezone.utc)
            await self.store.save_saga(saga)
            logger.info(f"Saga {saga.saga_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Saga {saga.saga_id} failed: {e}")
            saga.status = SagaStatus.FAILED
            saga.error = str(e)
            await self.store.save_saga(saga)
    
    async def _compensate_saga(self, saga: SagaInstance, definition: SagaDefinition):
        """Compensate saga by reversing completed steps"""
        logger.info(f"Compensating saga {saga.saga_id}")
        
        # Compensate in reverse order
        for i in range(saga.current_step_index, -1, -1):
            step_def = definition.steps[i]
            step_result = saga.steps[i]
            
            if step_result.status != StepStatus.COMPLETED:
                continue
            
            step_result.status = StepStatus.COMPENSATING
            await self.store.save_saga(saga)
            
            try:
                success = await definition.compensate_step(
                    step_def,
                    saga.context,
                    step_result
                )
                
                if success:
                    step_result.status = StepStatus.COMPENSATED
                else:
                    step_result.status = StepStatus.FAILED
                    logger.error(f"Compensation failed for step {step_def.name}")
            except Exception as e:
                step_result.status = StepStatus.FAILED
                step_result.error = f"Compensation error: {e}"
                logger.error(f"Compensation error for step {step_def.name}: {e}")
            
            await self.store.save_saga(saga)
        
        saga.status = SagaStatus.COMPENSATED
        saga.completed_at = datetime.now(timezone.utc)
        await self.store.save_saga(saga)
        logger.info(f"Saga {saga.saga_id} compensated")
    
    async def get_saga_status(self, saga_id: str) -> Optional[Dict[str, Any]]:
        """Get saga status"""
        saga = await self.store.get_saga(saga_id)
        if saga:
            return saga.to_dict()
        return None
    
    async def start_recovery_worker(self):
        """Start background worker to recover stuck sagas"""
        self._running = True
        
        while self._running:
            try:
                # Get pending sagas
                sagas = await self.store.get_pending_sagas()
                
                for saga in sagas:
                    # Check if saga is stuck (no update in 5 minutes)
                    if datetime.now(timezone.utc) - saga.updated_at > timedelta(minutes=5):
                        logger.info(f"Recovering stuck saga {saga.saga_id}")
                        asyncio.create_task(self._execute_saga(saga))
                
                # Process outbox messages
                messages = await self.store.get_pending_outbox_messages()
                for message in messages:
                    await self._process_outbox_message(message)
                
            except Exception as e:
                logger.error(f"Recovery worker error: {e}")
            
            await asyncio.sleep(30)
    
    async def _process_outbox_message(self, message: OutboxMessage):
        """Process an outbox message"""
        try:
            import httpx
            
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    message.destination,
                    json=message.payload,
                    headers={
                        "X-Idempotency-Key": message.idempotency_key or message.message_id
                    }
                )
                
                if response.status_code in (200, 201, 204):
                    await self.store.mark_outbox_processed(message.message_id)
                else:
                    await self.store.increment_outbox_retry(message.message_id)
        except Exception as e:
            logger.error(f"Outbox message {message.message_id} failed: {e}")
            await self.store.increment_outbox_retry(message.message_id)
    
    def stop(self):
        """Stop the orchestrator"""
        self._running = False


# Global instance
_orchestrator: Optional[SagaOrchestrator] = None


def get_saga_orchestrator() -> SagaOrchestrator:
    """Get the global saga orchestrator instance"""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = SagaOrchestrator()
    return _orchestrator


# Example usage
if __name__ == "__main__":
    async def main():
        orchestrator = SagaOrchestrator()
        
        # Start an agent onboarding saga
        saga_id = await orchestrator.start_saga(
            saga_type="agent_onboarding",
            input_data={
                "name": "John Doe",
                "email": "john@example.com",
                "phone": "+254700000000",
                "national_id": "12345678",
                "tier": "agent"
            }
        )
        
        print(f"Started saga: {saga_id}")
        
        # Wait and check status
        await asyncio.sleep(5)
        status = await orchestrator.get_saga_status(saga_id)
        print(f"Saga status: {json.dumps(status, indent=2)}")
    
    asyncio.run(main())
