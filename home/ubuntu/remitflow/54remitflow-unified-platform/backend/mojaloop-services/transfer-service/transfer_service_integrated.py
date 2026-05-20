"""
Production-Ready Mojaloop Transfer Service with Full Middleware Integration
Integrates: Kafka, Dapr, Fluvio, Temporal, Keycloak, Permify, Redis, PostgreSQL, APISIX, TigerBeetle

This is the fully integrated transfer service that uses all middleware components
for event streaming, workflow orchestration, authentication, authorization, and caching.
"""

import os
import json
import logging
import asyncio
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from contextlib import asynccontextmanager
import uuid
import hashlib
import base64
import hmac

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import asyncpg
import httpx
import uvicorn

# Import middleware integration
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.middleware_integration import (
    MojaloopMiddlewareManager, MiddlewareConfig,
    TransferEvent, TransferEventType, PositionEvent,
    get_middleware_manager, shutdown_middleware_manager,
    create_auth_middleware
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ==================== Configuration ====================

class Config:
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://mojaloop:mojaloop@localhost:5432/mojaloop")
    TIGERBEETLE_URL = os.getenv("TIGERBEETLE_URL", "http://localhost:8160")
    CENTRAL_LEDGER_URL = os.getenv("CENTRAL_LEDGER_URL", "http://localhost:8001")
    SETTLEMENT_SERVICE_URL = os.getenv("SETTLEMENT_SERVICE_URL", "http://localhost:8002")
    ILP_SECRET = os.getenv("ILP_SECRET")  # REQUIRED - no default
    CALLBACK_TIMEOUT = int(os.getenv("CALLBACK_TIMEOUT", "30"))
    MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
    
    # Middleware
    ENABLE_KAFKA = os.getenv("ENABLE_KAFKA", "true").lower() == "true"
    ENABLE_REDIS_CACHE = os.getenv("ENABLE_REDIS_CACHE", "true").lower() == "true"
    ENABLE_KEYCLOAK_AUTH = os.getenv("ENABLE_KEYCLOAK_AUTH", "true").lower() == "true"
    ENABLE_PERMIFY_AUTHZ = os.getenv("ENABLE_PERMIFY_AUTHZ", "true").lower() == "true"
    ENABLE_TEMPORAL = os.getenv("ENABLE_TEMPORAL", "true").lower() == "true"
    ENABLE_DAPR = os.getenv("ENABLE_DAPR", "true").lower() == "true"
    ENABLE_FLUVIO = os.getenv("ENABLE_FLUVIO", "true").lower() == "true"


config = Config()

if not config.ILP_SECRET:
    raise RuntimeError("ILP_SECRET env var is required")

# Database pool
db_pool: Optional[asyncpg.Pool] = None
middleware: Optional[MojaloopMiddlewareManager] = None


async def get_db_pool() -> asyncpg.Pool:
    global db_pool
    if db_pool is None:
        db_pool = await asyncpg.create_pool(
            config.DATABASE_URL,
            min_size=5,
            max_size=20,
            command_timeout=60
        )
    return db_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    global middleware
    
    # Initialize database
    pool = await get_db_pool()
    await initialize_database(pool)
    
    # Initialize middleware manager
    middleware = await get_middleware_manager()
    
    logger.info("Transfer service started with full middleware integration")
    logger.info(f"  Kafka: {config.ENABLE_KAFKA}")
    logger.info(f"  Redis: {config.ENABLE_REDIS_CACHE}")
    logger.info(f"  Keycloak: {config.ENABLE_KEYCLOAK_AUTH}")
    logger.info(f"  Permify: {config.ENABLE_PERMIFY_AUTHZ}")
    logger.info(f"  Temporal: {config.ENABLE_TEMPORAL}")
    logger.info(f"  Dapr: {config.ENABLE_DAPR}")
    logger.info(f"  Fluvio: {config.ENABLE_FLUVIO}")
    
    yield
    
    # Cleanup
    if db_pool:
        await db_pool.close()
    await shutdown_middleware_manager()


app = FastAPI(
    title="Mojaloop Transfer Service (Fully Integrated)",
    description="Production-ready transfer service with Kafka, Dapr, Fluvio, Temporal, Keycloak, Permify, Redis, APISIX, TigerBeetle integration",
    version="4.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== Models ====================

class TransferState(str, Enum):
    RECEIVED = "RECEIVED"
    RESERVED = "RESERVED"
    COMMITTED = "COMMITTED"
    ABORTED = "ABORTED"


class Currency(str, Enum):
    NGN = "NGN"
    USD = "USD"
    KES = "KES"
    GHS = "GHS"
    ZAR = "ZAR"


class Money(BaseModel):
    currency: Currency
    amount: str
    
    @validator('amount')
    def validate_amount(cls, v):
        try:
            amount = Decimal(v)
            if amount <= 0:
                raise ValueError("Amount must be positive")
            return v
        except:
            raise ValueError("Invalid amount format")


class PartyIdInfo(BaseModel):
    partyIdType: str
    partyIdentifier: str
    partySubIdOrType: Optional[str] = None
    fspId: Optional[str] = None


class Party(BaseModel):
    partyIdInfo: PartyIdInfo
    name: Optional[str] = None


class TransferRequest(BaseModel):
    transferId: str
    payerFsp: str
    payeeFsp: str
    amount: Money
    ilpPacket: str
    condition: str
    expiration: str
    
    @validator('transferId')
    def validate_transfer_id(cls, v):
        try:
            uuid.UUID(v)
            return v
        except:
            raise ValueError("transferId must be a valid UUID")


class TransferFulfil(BaseModel):
    fulfilment: str
    completedTimestamp: str
    transferState: str


class ErrorInformation(BaseModel):
    errorCode: str
    errorDescription: str
    extensionList: Optional[Dict[str, Any]] = None


# ==================== Database ====================

async def initialize_database(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE SCHEMA IF NOT EXISTS transfers;
            
            CREATE TABLE IF NOT EXISTS transfers.transfers (
                transfer_id UUID PRIMARY KEY,
                payer_fsp VARCHAR(255) NOT NULL,
                payee_fsp VARCHAR(255) NOT NULL,
                amount DECIMAL(18, 4) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                state VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
                ilp_packet TEXT,
                condition VARCHAR(64),
                fulfilment VARCHAR(64),
                expiration TIMESTAMP WITH TIME ZONE,
                error_code VARCHAR(10),
                error_description TEXT,
                tigerbeetle_pending_id VARCHAR(100),
                tigerbeetle_transfer_id VARCHAR(100),
                central_ledger_prepared BOOLEAN DEFAULT FALSE,
                settlement_recorded BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                completed_at TIMESTAMP WITH TIME ZONE,
                metadata JSONB DEFAULT '{}'
            );
            
            CREATE INDEX IF NOT EXISTS idx_transfers_state ON transfers.transfers(state);
            CREATE INDEX IF NOT EXISTS idx_transfers_payer_fsp ON transfers.transfers(payer_fsp);
            CREATE INDEX IF NOT EXISTS idx_transfers_payee_fsp ON transfers.transfers(payee_fsp);
            CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers.transfers(created_at);
            
            CREATE TABLE IF NOT EXISTS transfers.transfer_state_changes (
                id SERIAL PRIMARY KEY,
                transfer_id UUID NOT NULL REFERENCES transfers.transfers(transfer_id),
                previous_state VARCHAR(20),
                new_state VARCHAR(20) NOT NULL,
                reason TEXT,
                changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            CREATE INDEX IF NOT EXISTS idx_state_changes_transfer ON transfers.transfer_state_changes(transfer_id);
        """)
        logger.info("Transfer service database schema initialized")


# ==================== TigerBeetle Client ====================

class TigerBeetleClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def close(self):
        await self.client.aclose()
    
    async def create_pending_transfer(
        self,
        from_account_id: str,
        to_account_id: str,
        amount: Decimal,
        currency: str,
        idempotency_key: str,
        timeout_seconds: int = 300
    ) -> Dict[str, Any]:
        """Create pending transfer in TigerBeetle"""
        payload = {
            "from_account_id": from_account_id,
            "to_account_id": to_account_id,
            "amount": str(amount),
            "currency": currency,
            "transfer_code": 3,
            "description": "Mojaloop transfer reservation",
            "idempotency_key": idempotency_key,
            "timeout_seconds": timeout_seconds
        }
        
        response = await self.client.post(f"{self.base_url}/transfers/pending", json=payload)
        
        if response.status_code == 200:
            return {"success": True, **response.json()}
        
        logger.error(f"TigerBeetle pending transfer failed: {response.text}")
        return {"success": False, "error": response.text}
    
    async def post_pending_transfer(self, pending_id: str, idempotency_key: str) -> Dict[str, Any]:
        """Post (commit) pending transfer"""
        payload = {
            "pending_transfer_id": pending_id,
            "idempotency_key": idempotency_key
        }
        
        response = await self.client.post(f"{self.base_url}/transfers/pending/post", json=payload)
        
        if response.status_code == 200:
            return {"success": True, **response.json()}
        
        return {"success": False, "error": response.text}
    
    async def void_pending_transfer(self, pending_id: str, idempotency_key: str) -> Dict[str, Any]:
        """Void (abort) pending transfer"""
        payload = {
            "pending_transfer_id": pending_id,
            "idempotency_key": idempotency_key
        }
        
        response = await self.client.post(f"{self.base_url}/transfers/pending/void", json=payload)
        
        if response.status_code == 200:
            return {"success": True, **response.json()}
        
        return {"success": False, "error": response.text}


tigerbeetle = TigerBeetleClient(config.TIGERBEETLE_URL)


# ==================== ILP Utilities ====================

class ILPUtils:
    @staticmethod
    def generate_fulfilment() -> str:
        fulfilment_bytes = os.urandom(32)
        return base64.urlsafe_b64encode(fulfilment_bytes).decode('utf-8').rstrip('=')
    
    @staticmethod
    def generate_condition(fulfilment: str) -> str:
        padding = 4 - len(fulfilment) % 4
        if padding != 4:
            fulfilment += '=' * padding
        fulfilment_bytes = base64.urlsafe_b64decode(fulfilment)
        condition_bytes = hashlib.sha256(fulfilment_bytes).digest()
        return base64.urlsafe_b64encode(condition_bytes).decode('utf-8').rstrip('=')
    
    @staticmethod
    def verify_fulfilment(condition: str, fulfilment: str) -> bool:
        try:
            expected_condition = ILPUtils.generate_condition(fulfilment)
            return hmac.compare_digest(condition, expected_condition)
        except Exception as e:
            logger.error(f"Fulfilment verification error: {e}")
            return False


# ==================== Authentication Dependency ====================

async def get_current_user(request: Request) -> Dict[str, Any]:
    """Get current authenticated user from request"""
    if not config.ENABLE_KEYCLOAK_AUTH:
        return {"sub": "anonymous", "fsp_id": None, "roles": []}
    
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization header")
    
    token = auth_header.replace("Bearer ", "")
    
    try:
        token_data = await middleware.authenticate_request(token)
        return {
            "sub": token_data.get("sub"),
            "fsp_id": middleware.keycloak.get_fsp_id(token_data),
            "roles": middleware.keycloak.get_user_roles(token_data)
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


# ==================== API Endpoints ====================

@app.get("/health")
async def health_check():
    """Health check with middleware status"""
    pool = await get_db_pool()
    
    # Check database
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {e}"
    
    # Check TigerBeetle
    try:
        response = await tigerbeetle.client.get(f"{config.TIGERBEETLE_URL}/health")
        tb_status = "healthy" if response.status_code == 200 else "unhealthy"
    except:
        tb_status = "unavailable"
    
    # Check Redis
    try:
        await middleware.redis.connect()
        await middleware.redis.client.ping()
        redis_status = "healthy"
    except:
        redis_status = "unavailable"
    
    # Check Kafka
    kafka_status = "enabled" if config.ENABLE_KAFKA and middleware.kafka._started else "disabled"
    
    return {
        "status": "healthy" if db_status == "healthy" else "degraded",
        "service": "transfer-service-integrated",
        "version": "4.0.0",
        "components": {
            "database": db_status,
            "tigerbeetle": tb_status,
            "redis": redis_status,
            "kafka": kafka_status,
            "keycloak": "enabled" if config.ENABLE_KEYCLOAK_AUTH else "disabled",
            "permify": "enabled" if config.ENABLE_PERMIFY_AUTHZ else "disabled",
            "temporal": "enabled" if config.ENABLE_TEMPORAL else "disabled",
            "dapr": "enabled" if config.ENABLE_DAPR else "disabled",
            "fluvio": "enabled" if config.ENABLE_FLUVIO else "disabled"
        }
    }


@app.post("/transfers")
async def prepare_transfer(
    request: TransferRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Prepare a transfer (Phase 1 of 2PC)
    
    Middleware Integration:
    - Keycloak: Authenticate request
    - Permify: Authorize transfer initiation
    - Redis: Check idempotency, cache transfer
    - Kafka: Publish TRANSFER_RECEIVED event
    - Fluvio: Stream real-time event
    - Dapr: Service invocation to Central Ledger
    - TigerBeetle: Create pending transfer
    - Temporal: Start transfer workflow (optional)
    """
    pool = await get_db_pool()
    transfer_id = request.transferId
    amount = Decimal(request.amount.amount)
    currency = request.amount.currency.value
    
    # Check idempotency via Redis
    if config.ENABLE_REDIS_CACHE:
        if await middleware.redis.check_idempotency(f"transfer:{transfer_id}"):
            # Return existing transfer
            cached = await middleware.redis.get_transfer(transfer_id)
            if cached:
                return cached
    
    # Authorization check via Permify
    if config.ENABLE_PERMIFY_AUTHZ:
        user_id = current_user.get("sub")
        if not await middleware.authorize_transfer(user_id, request.payerFsp):
            raise HTTPException(
                status_code=403,
                detail=f"User {user_id} not authorized to initiate transfers for {request.payerFsp}"
            )
    
    async with pool.acquire() as conn:
        # Check if transfer already exists
        existing = await conn.fetchrow(
            "SELECT * FROM transfers.transfers WHERE transfer_id = $1",
            uuid.UUID(transfer_id)
        )
        
        if existing:
            return {
                "transferId": transfer_id,
                "transferState": existing['state'],
                "message": "Transfer already exists"
            }
        
        # Parse expiration
        try:
            expiration = datetime.fromisoformat(request.expiration.replace('Z', '+00:00'))
        except:
            expiration = datetime.utcnow() + timedelta(hours=1)
        
        # Create transfer record
        await conn.execute("""
            INSERT INTO transfers.transfers 
            (transfer_id, payer_fsp, payee_fsp, amount, currency, state, ilp_packet, condition, expiration)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """, uuid.UUID(transfer_id), request.payerFsp, request.payeeFsp, 
            amount, currency, TransferState.RECEIVED.value,
            request.ilpPacket, request.condition, expiration)
        
        # Record state change
        await conn.execute("""
            INSERT INTO transfers.transfer_state_changes (transfer_id, previous_state, new_state, reason)
            VALUES ($1, NULL, $2, $3)
        """, uuid.UUID(transfer_id), TransferState.RECEIVED.value, "Transfer initiated")
    
    # Publish TRANSFER_RECEIVED event via middleware
    await middleware.on_transfer_received(
        transfer_id=transfer_id,
        payer_fsp=request.payerFsp,
        payee_fsp=request.payeeFsp,
        amount=amount,
        currency=currency
    )
    
    # Start Temporal workflow if enabled
    if config.ENABLE_TEMPORAL:
        try:
            await middleware.temporal.start_transfer_workflow(
                transfer_id=transfer_id,
                payer_fsp=request.payerFsp,
                payee_fsp=request.payeeFsp,
                amount=amount,
                currency=currency,
                expiration=expiration
            )
        except Exception as e:
            logger.warning(f"Failed to start Temporal workflow: {e}")
    
    # Reserve funds in TigerBeetle (background)
    background_tasks.add_task(
        reserve_funds,
        transfer_id,
        request.payerFsp,
        request.payeeFsp,
        amount,
        currency
    )
    
    return {
        "transferId": transfer_id,
        "transferState": TransferState.RECEIVED.value,
        "completedTimestamp": None
    }


async def reserve_funds(
    transfer_id: str,
    payer_fsp: str,
    payee_fsp: str,
    amount: Decimal,
    currency: str
):
    """Reserve funds in TigerBeetle and update state"""
    pool = await get_db_pool()
    
    try:
        # Generate idempotency key
        idempotency_key = hashlib.sha256(f"reserve:{transfer_id}".encode()).hexdigest()
        
        # Get participant accounts from Central Ledger via Dapr
        if config.ENABLE_DAPR:
            try:
                payer_info = await middleware.dapr.invoke_central_ledger(
                    f"participants/{payer_fsp}", {}
                )
                payee_info = await middleware.dapr.invoke_central_ledger(
                    f"participants/{payee_fsp}", {}
                )
                payer_account = payer_info.get("tigerbeetle_account_id")
                payee_account = payee_info.get("tigerbeetle_account_id")
            except:
                payer_account = f"participant:{payer_fsp}"
                payee_account = f"participant:{payee_fsp}"
        else:
            payer_account = f"participant:{payer_fsp}"
            payee_account = f"participant:{payee_fsp}"
        
        # Create pending transfer in TigerBeetle
        result = await tigerbeetle.create_pending_transfer(
            from_account_id=payer_account,
            to_account_id=payee_account,
            amount=amount,
            currency=currency,
            idempotency_key=idempotency_key
        )
        
        if not result.get("success"):
            raise Exception(result.get("error", "TigerBeetle reservation failed"))
        
        pending_id = result.get("transfer_id", idempotency_key)
        
        # Update transfer state
        async with pool.acquire() as conn:
            await conn.execute("""
                UPDATE transfers.transfers
                SET state = $2, tigerbeetle_pending_id = $3, updated_at = NOW()
                WHERE transfer_id = $1
            """, uuid.UUID(transfer_id), TransferState.RESERVED.value, pending_id)
            
            await conn.execute("""
                INSERT INTO transfers.transfer_state_changes (transfer_id, previous_state, new_state, reason)
                VALUES ($1, $2, $3, $4)
            """, uuid.UUID(transfer_id), TransferState.RECEIVED.value, 
                TransferState.RESERVED.value, "Funds reserved in TigerBeetle")
        
        # Publish TRANSFER_RESERVED event
        await middleware.on_transfer_reserved(
            transfer_id=transfer_id,
            payer_fsp=payer_fsp,
            payee_fsp=payee_fsp,
            amount=amount,
            currency=currency,
            tigerbeetle_id=pending_id
        )
        
        # Publish TigerBeetle event
        await middleware.kafka.publish_tigerbeetle_event("transfer.pending_created", {
            "transfer_id": transfer_id,
            "pending_id": pending_id,
            "amount": str(amount),
            "currency": currency,
            "payer_fsp": payer_fsp,
            "payee_fsp": payee_fsp
        })
        
        logger.info(f"Transfer {transfer_id} reserved in TigerBeetle: {pending_id}")
        
    except Exception as e:
        logger.error(f"Failed to reserve funds for {transfer_id}: {e}")
        
        # Update to ABORTED state
        async with pool.acquire() as conn:
            await conn.execute("""
                UPDATE transfers.transfers
                SET state = $2, error_code = $3, error_description = $4, 
                    updated_at = NOW(), completed_at = NOW()
                WHERE transfer_id = $1
            """, uuid.UUID(transfer_id), TransferState.ABORTED.value,
                "RESERVATION_FAILED", str(e))
        
        # Publish TRANSFER_ABORTED event
        await middleware.on_transfer_aborted(
            transfer_id=transfer_id,
            payer_fsp=payer_fsp,
            payee_fsp=payee_fsp,
            amount=amount,
            currency=currency,
            error_code="RESERVATION_FAILED",
            error_description=str(e)
        )


@app.put("/transfers/{transfer_id}")
async def fulfil_transfer(
    transfer_id: str,
    request: TransferFulfil,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Fulfil a transfer (Phase 2 of 2PC)
    
    Middleware Integration:
    - Keycloak: Authenticate request
    - Permify: Authorize fulfillment
    - Redis: Update cache
    - Kafka: Publish TRANSFER_COMMITTED event
    - Fluvio: Stream real-time event
    - TigerBeetle: Post pending transfer
    - Temporal: Signal workflow completion
    """
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        transfer = await conn.fetchrow(
            "SELECT * FROM transfers.transfers WHERE transfer_id = $1",
            uuid.UUID(transfer_id)
        )
        
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer not found")
        
        if transfer['state'] != TransferState.RESERVED.value:
            raise HTTPException(
                status_code=400,
                detail=f"Transfer cannot be fulfilled in state: {transfer['state']}"
            )
        
        # Verify fulfilment
        if not ILPUtils.verify_fulfilment(transfer['condition'], request.fulfilment):
            raise HTTPException(status_code=400, detail="Invalid fulfilment")
        
        # Authorization check
        if config.ENABLE_PERMIFY_AUTHZ:
            user_id = current_user.get("sub")
            if not await middleware.authorize_transfer(user_id, transfer['payee_fsp']):
                raise HTTPException(
                    status_code=403,
                    detail=f"User not authorized to fulfill transfers for {transfer['payee_fsp']}"
                )
        
        # Post pending transfer in TigerBeetle
        pending_id = transfer['tigerbeetle_pending_id']
        if pending_id:
            idempotency_key = hashlib.sha256(f"post:{transfer_id}".encode()).hexdigest()
            result = await tigerbeetle.post_pending_transfer(pending_id, idempotency_key)
            
            if not result.get("success"):
                raise HTTPException(
                    status_code=500,
                    detail=f"TigerBeetle commit failed: {result.get('error')}"
                )
        
        # Update transfer state
        completed_at = datetime.utcnow()
        await conn.execute("""
            UPDATE transfers.transfers
            SET state = $2, fulfilment = $3, updated_at = NOW(), completed_at = $4
            WHERE transfer_id = $1
        """, uuid.UUID(transfer_id), TransferState.COMMITTED.value, 
            request.fulfilment, completed_at)
        
        await conn.execute("""
            INSERT INTO transfers.transfer_state_changes (transfer_id, previous_state, new_state, reason)
            VALUES ($1, $2, $3, $4)
        """, uuid.UUID(transfer_id), TransferState.RESERVED.value,
            TransferState.COMMITTED.value, "Transfer fulfilled")
    
    # Publish TRANSFER_COMMITTED event
    await middleware.on_transfer_committed(
        transfer_id=transfer_id,
        payer_fsp=transfer['payer_fsp'],
        payee_fsp=transfer['payee_fsp'],
        amount=transfer['amount'],
        currency=transfer['currency'],
        tigerbeetle_id=pending_id
    )
    
    # Signal Temporal workflow
    if config.ENABLE_TEMPORAL:
        try:
            await middleware.temporal.signal_transfer_fulfilled(transfer_id, request.fulfilment)
        except Exception as e:
            logger.warning(f"Failed to signal Temporal workflow: {e}")
    
    # Record settlement (background)
    background_tasks.add_task(
        record_settlement,
        transfer_id,
        transfer['payer_fsp'],
        transfer['payee_fsp'],
        transfer['amount'],
        transfer['currency']
    )
    
    return {
        "transferId": transfer_id,
        "transferState": TransferState.COMMITTED.value,
        "completedTimestamp": completed_at.isoformat()
    }


async def record_settlement(
    transfer_id: str,
    payer_fsp: str,
    payee_fsp: str,
    amount: Decimal,
    currency: str
):
    """Record transfer for settlement"""
    try:
        if config.ENABLE_DAPR:
            await middleware.dapr.invoke_settlement_service("transfers/record", {
                "transfer_id": transfer_id,
                "payer_fsp": payer_fsp,
                "payee_fsp": payee_fsp,
                "amount": str(amount),
                "currency": currency
            })
        
        # Update settlement recorded flag
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute("""
                UPDATE transfers.transfers
                SET settlement_recorded = TRUE
                WHERE transfer_id = $1
            """, uuid.UUID(transfer_id))
        
        logger.info(f"Transfer {transfer_id} recorded for settlement")
        
    except Exception as e:
        logger.error(f"Failed to record settlement for {transfer_id}: {e}")


@app.put("/transfers/{transfer_id}/error")
async def abort_transfer(
    transfer_id: str,
    error: ErrorInformation,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Abort a transfer
    
    Middleware Integration:
    - Keycloak: Authenticate request
    - Redis: Update cache
    - Kafka: Publish TRANSFER_ABORTED event
    - TigerBeetle: Void pending transfer
    - Temporal: Signal workflow abort
    """
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        transfer = await conn.fetchrow(
            "SELECT * FROM transfers.transfers WHERE transfer_id = $1",
            uuid.UUID(transfer_id)
        )
        
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer not found")
        
        if transfer['state'] in [TransferState.COMMITTED.value, TransferState.ABORTED.value]:
            raise HTTPException(
                status_code=400,
                detail=f"Transfer cannot be aborted in state: {transfer['state']}"
            )
        
        # Void pending transfer in TigerBeetle
        pending_id = transfer['tigerbeetle_pending_id']
        if pending_id:
            idempotency_key = hashlib.sha256(f"void:{transfer_id}".encode()).hexdigest()
            result = await tigerbeetle.void_pending_transfer(pending_id, idempotency_key)
            
            if not result.get("success"):
                logger.warning(f"TigerBeetle void failed: {result.get('error')}")
        
        # Update transfer state
        await conn.execute("""
            UPDATE transfers.transfers
            SET state = $2, error_code = $3, error_description = $4,
                updated_at = NOW(), completed_at = NOW()
            WHERE transfer_id = $1
        """, uuid.UUID(transfer_id), TransferState.ABORTED.value,
            error.errorCode, error.errorDescription)
        
        await conn.execute("""
            INSERT INTO transfers.transfer_state_changes (transfer_id, previous_state, new_state, reason)
            VALUES ($1, $2, $3, $4)
        """, uuid.UUID(transfer_id), transfer['state'],
            TransferState.ABORTED.value, error.errorDescription)
    
    # Publish TRANSFER_ABORTED event
    await middleware.on_transfer_aborted(
        transfer_id=transfer_id,
        payer_fsp=transfer['payer_fsp'],
        payee_fsp=transfer['payee_fsp'],
        amount=transfer['amount'],
        currency=transfer['currency'],
        error_code=error.errorCode,
        error_description=error.errorDescription
    )
    
    # Signal Temporal workflow
    if config.ENABLE_TEMPORAL:
        try:
            await middleware.temporal.signal_transfer_aborted(
                transfer_id, error.errorCode, error.errorDescription
            )
        except Exception as e:
            logger.warning(f"Failed to signal Temporal workflow: {e}")
    
    return {
        "transferId": transfer_id,
        "transferState": TransferState.ABORTED.value
    }


@app.get("/transfers/{transfer_id}")
async def get_transfer(
    transfer_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get transfer details with Redis caching"""
    
    # Check Redis cache first
    if config.ENABLE_REDIS_CACHE:
        cached = await middleware.redis.get_transfer(transfer_id)
        if cached:
            return cached
    
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        transfer = await conn.fetchrow(
            "SELECT * FROM transfers.transfers WHERE transfer_id = $1",
            uuid.UUID(transfer_id)
        )
        
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer not found")
        
        result = {
            "transferId": str(transfer['transfer_id']),
            "payerFsp": transfer['payer_fsp'],
            "payeeFsp": transfer['payee_fsp'],
            "amount": {
                "currency": transfer['currency'],
                "amount": str(transfer['amount'])
            },
            "transferState": transfer['state'],
            "completedTimestamp": transfer['completed_at'].isoformat() if transfer['completed_at'] else None,
            "errorInformation": {
                "errorCode": transfer['error_code'],
                "errorDescription": transfer['error_description']
            } if transfer['error_code'] else None
        }
        
        # Cache result
        if config.ENABLE_REDIS_CACHE:
            await middleware.redis.cache_transfer(transfer_id, result)
        
        return result


@app.get("/transfers")
async def list_transfers(
    state: Optional[str] = None,
    payer_fsp: Optional[str] = None,
    payee_fsp: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """List transfers with filtering"""
    pool = await get_db_pool()
    
    query = "SELECT * FROM transfers.transfers WHERE 1=1"
    params = []
    param_idx = 1
    
    if state:
        query += f" AND state = ${param_idx}"
        params.append(state)
        param_idx += 1
    
    if payer_fsp:
        query += f" AND payer_fsp = ${param_idx}"
        params.append(payer_fsp)
        param_idx += 1
    
    if payee_fsp:
        query += f" AND payee_fsp = ${param_idx}"
        params.append(payee_fsp)
        param_idx += 1
    
    query += f" ORDER BY created_at DESC LIMIT ${param_idx} OFFSET ${param_idx + 1}"
    params.extend([limit, offset])
    
    async with pool.acquire() as conn:
        transfers = await conn.fetch(query, *params)
        
        return {
            "transfers": [
                {
                    "transferId": str(t['transfer_id']),
                    "payerFsp": t['payer_fsp'],
                    "payeeFsp": t['payee_fsp'],
                    "amount": str(t['amount']),
                    "currency": t['currency'],
                    "state": t['state'],
                    "createdAt": t['created_at'].isoformat()
                }
                for t in transfers
            ],
            "limit": limit,
            "offset": offset
        }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
