"""
Production-Ready Mojaloop Central Ledger with Full Middleware Integration
Integrates: Kafka, Dapr, Fluvio, Temporal, Keycloak, Permify, Redis, PostgreSQL, APISIX, TigerBeetle

This is the fully integrated central ledger that uses all middleware components
for position management, event streaming, authentication, authorization, and caching.
"""

import os
import json
import logging
import asyncio
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from contextlib import asynccontextmanager
import uuid

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
    get_middleware_manager, shutdown_middleware_manager
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ==================== Configuration ====================

class Config:
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://mojaloop:mojaloop@localhost:5432/mojaloop")
    TIGERBEETLE_URL = os.getenv("TIGERBEETLE_URL", "http://localhost:8160")
    DEFAULT_NDC = Decimal(os.getenv("DEFAULT_NDC", "1000000000"))
    POSITION_CHECK_INTERVAL = int(os.getenv("POSITION_CHECK_INTERVAL", "60"))
    
    # Middleware
    ENABLE_KAFKA = os.getenv("ENABLE_KAFKA", "true").lower() == "true"
    ENABLE_REDIS_CACHE = os.getenv("ENABLE_REDIS_CACHE", "true").lower() == "true"
    ENABLE_KEYCLOAK_AUTH = os.getenv("ENABLE_KEYCLOAK_AUTH", "true").lower() == "true"
    ENABLE_PERMIFY_AUTHZ = os.getenv("ENABLE_PERMIFY_AUTHZ", "true").lower() == "true"
    ENABLE_DAPR = os.getenv("ENABLE_DAPR", "true").lower() == "true"
    ENABLE_FLUVIO = os.getenv("ENABLE_FLUVIO", "true").lower() == "true"


config = Config()

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
    
    pool = await get_db_pool()
    await initialize_database(pool)
    
    middleware = await get_middleware_manager()
    
    # Start background position monitoring
    asyncio.create_task(position_monitor_worker())
    
    logger.info("Central Ledger started with full middleware integration")
    
    yield
    
    if db_pool:
        await db_pool.close()
    await shutdown_middleware_manager()


app = FastAPI(
    title="Mojaloop Central Ledger (Fully Integrated)",
    description="Production-ready central ledger with full middleware integration",
    version="3.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== Enums ====================

class ParticipantStatus(str, Enum):
    CREATED = "CREATED"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DISABLED = "DISABLED"


class PositionType(str, Enum):
    POSITION = "POSITION"
    RESERVED = "RESERVED"
    SETTLEMENT = "SETTLEMENT"


class LimitType(str, Enum):
    NET_DEBIT_CAP = "NET_DEBIT_CAP"
    DAILY_LIMIT = "DAILY_LIMIT"
    TRANSACTION_LIMIT = "TRANSACTION_LIMIT"


class TransferState(str, Enum):
    RECEIVED = "RECEIVED"
    RESERVED = "RESERVED"
    COMMITTED = "COMMITTED"
    ABORTED = "ABORTED"


# ==================== Models ====================

class ParticipantCreate(BaseModel):
    fsp_id: str = Field(..., min_length=1, max_length=255)
    name: str
    currency: str = Field(default="NGN", max_length=3)
    net_debit_cap: Decimal = Field(default=config.DEFAULT_NDC)
    daily_limit: Optional[Decimal] = None
    transaction_limit: Optional[Decimal] = None
    is_active: bool = Field(default=True)
    metadata: Optional[Dict[str, Any]] = {}


class ParticipantUpdate(BaseModel):
    name: Optional[str] = None
    net_debit_cap: Optional[Decimal] = None
    daily_limit: Optional[Decimal] = None
    transaction_limit: Optional[Decimal] = None
    is_active: Optional[bool] = None
    status: Optional[ParticipantStatus] = None


class ParticipantResponse(BaseModel):
    fsp_id: str
    name: str
    currency: str
    status: ParticipantStatus
    net_debit_cap: Decimal
    daily_limit: Optional[Decimal]
    transaction_limit: Optional[Decimal]
    current_position: Decimal
    reserved_position: Decimal
    available_position: Decimal
    tigerbeetle_account_id: Optional[str]
    created_at: datetime
    updated_at: datetime


class PositionResponse(BaseModel):
    fsp_id: str
    currency: str
    position: Decimal
    reserved: Decimal
    available: Decimal
    net_debit_cap: Decimal
    utilization_percent: Decimal
    last_updated: datetime
    tigerbeetle_balance: Optional[Decimal] = None


class TransferPrepareRequest(BaseModel):
    transfer_id: str
    payer_fsp: str
    payee_fsp: str
    amount: Decimal
    currency: str = "NGN"


class TransferFulfillRequest(BaseModel):
    transfer_id: str
    fulfilment: str


class TransferAbortRequest(BaseModel):
    transfer_id: str
    error_code: str
    error_description: str


class LiquidityAdjustment(BaseModel):
    fsp_id: str
    amount: Decimal
    currency: str = "NGN"
    adjustment_type: str
    reference: str
    description: Optional[str] = None


# ==================== Database ====================

async def initialize_database(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE SCHEMA IF NOT EXISTS central_ledger;
            
            CREATE TABLE IF NOT EXISTS central_ledger.participants (
                fsp_id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
                status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
                net_debit_cap DECIMAL(18, 4) NOT NULL,
                daily_limit DECIMAL(18, 4),
                transaction_limit DECIMAL(18, 4),
                tigerbeetle_account_id VARCHAR(100),
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS central_ledger.participant_positions (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL REFERENCES central_ledger.participants(fsp_id),
                currency VARCHAR(3) NOT NULL,
                position_type VARCHAR(20) NOT NULL,
                value DECIMAL(18, 4) NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(fsp_id, currency, position_type)
            );
            
            CREATE TABLE IF NOT EXISTS central_ledger.position_history (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                position_type VARCHAR(20) NOT NULL,
                previous_value DECIMAL(18, 4),
                new_value DECIMAL(18, 4),
                change_amount DECIMAL(18, 4),
                transfer_id UUID,
                reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS central_ledger.transfer_state (
                transfer_id UUID PRIMARY KEY,
                payer_fsp VARCHAR(255) NOT NULL,
                payee_fsp VARCHAR(255) NOT NULL,
                amount DECIMAL(18, 4) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                state VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
                payer_position_reserved DECIMAL(18, 4),
                tigerbeetle_pending_id VARCHAR(100),
                error_code VARCHAR(10),
                error_description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                completed_at TIMESTAMP WITH TIME ZONE
            );
            
            CREATE TABLE IF NOT EXISTS central_ledger.daily_usage (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                usage_date DATE NOT NULL,
                total_debits DECIMAL(18, 4) NOT NULL DEFAULT 0,
                total_credits DECIMAL(18, 4) NOT NULL DEFAULT 0,
                transaction_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(fsp_id, currency, usage_date)
            );
            
            CREATE TABLE IF NOT EXISTS central_ledger.liquidity_adjustments (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL REFERENCES central_ledger.participants(fsp_id),
                amount DECIMAL(18, 4) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                adjustment_type VARCHAR(20) NOT NULL,
                reference VARCHAR(255) NOT NULL UNIQUE,
                description TEXT,
                tigerbeetle_transfer_id VARCHAR(100),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            CREATE INDEX IF NOT EXISTS idx_positions_fsp ON central_ledger.participant_positions(fsp_id);
            CREATE INDEX IF NOT EXISTS idx_transfer_state_payer ON central_ledger.transfer_state(payer_fsp);
            CREATE INDEX IF NOT EXISTS idx_transfer_state_payee ON central_ledger.transfer_state(payee_fsp);
            CREATE INDEX IF NOT EXISTS idx_transfer_state_state ON central_ledger.transfer_state(state);
            CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON central_ledger.daily_usage(usage_date);
            CREATE INDEX IF NOT EXISTS idx_position_history_fsp ON central_ledger.position_history(fsp_id, created_at);
        """)
        logger.info("Central Ledger database schema initialized")


# ==================== TigerBeetle Client ====================

class TigerBeetleClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def close(self):
        await self.client.aclose()
    
    async def create_account(self, user_id: str, account_type: int, currency: str,
                            initial_balance: Decimal = Decimal("0")) -> Dict[str, Any]:
        payload = {
            "user_id": user_id,
            "account_type": account_type,
            "currency": currency,
            "initial_balance": str(initial_balance),
            "enable_history": True
        }
        
        response = await self.client.post(f"{self.base_url}/accounts", json=payload)
        
        if response.status_code == 200:
            return {"success": True, **response.json()}
        
        return {"success": False, "error": response.text}
    
    async def get_balance(self, account_id: str) -> Dict[str, Any]:
        response = await self.client.get(f"{self.base_url}/accounts/{account_id}/balance")
        
        if response.status_code == 200:
            return {"success": True, **response.json()}
        
        return {"success": False, "error": response.text}
    
    async def create_pending_transfer(self, from_account: str, to_account: str,
                                      amount: Decimal, idempotency_key: str) -> Dict[str, Any]:
        payload = {
            "from_account_id": from_account,
            "to_account_id": to_account,
            "amount": str(amount),
            "currency": "NGN",
            "transfer_code": 3,
            "idempotency_key": idempotency_key
        }
        
        response = await self.client.post(f"{self.base_url}/transfers/pending", json=payload)
        
        if response.status_code == 200:
            return {"success": True, **response.json()}
        
        return {"success": False, "error": response.text}
    
    async def post_pending(self, pending_id: str, idempotency_key: str) -> Dict[str, Any]:
        payload = {
            "pending_transfer_id": pending_id,
            "idempotency_key": idempotency_key
        }
        
        response = await self.client.post(f"{self.base_url}/transfers/pending/post", json=payload)
        
        if response.status_code == 200:
            return {"success": True, **response.json()}
        
        return {"success": False, "error": response.text}
    
    async def void_pending(self, pending_id: str, idempotency_key: str) -> Dict[str, Any]:
        payload = {
            "pending_transfer_id": pending_id,
            "idempotency_key": idempotency_key
        }
        
        response = await self.client.post(f"{self.base_url}/transfers/pending/void", json=payload)
        
        if response.status_code == 200:
            return {"success": True, **response.json()}
        
        return {"success": False, "error": response.text}


tigerbeetle = TigerBeetleClient(config.TIGERBEETLE_URL)


# ==================== Position Manager ====================

class PositionManager:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def get_position(self, fsp_id: str, currency: str) -> Dict[str, Decimal]:
        # Check Redis cache first
        if config.ENABLE_REDIS_CACHE and middleware:
            cached = await middleware.redis.get_position(fsp_id, currency)
            if cached:
                return {
                    PositionType.POSITION.value: Decimal(cached.get("position", "0")),
                    PositionType.RESERVED.value: Decimal(cached.get("reserved", "0")),
                    PositionType.SETTLEMENT.value: Decimal(cached.get("settlement", "0"))
                }
        
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT position_type, value FROM central_ledger.participant_positions
                WHERE fsp_id = $1 AND currency = $2
            """, fsp_id, currency)
            
            positions = {
                PositionType.POSITION.value: Decimal("0"),
                PositionType.RESERVED.value: Decimal("0"),
                PositionType.SETTLEMENT.value: Decimal("0")
            }
            
            for row in rows:
                positions[row['position_type']] = row['value']
            
            # Cache in Redis
            if config.ENABLE_REDIS_CACHE and middleware:
                await middleware.redis.cache_position(fsp_id, currency, {
                    "position": str(positions[PositionType.POSITION.value]),
                    "reserved": str(positions[PositionType.RESERVED.value]),
                    "settlement": str(positions[PositionType.SETTLEMENT.value])
                })
            
            return positions
    
    async def check_ndc(self, fsp_id: str, currency: str, amount: Decimal) -> Tuple[bool, str]:
        async with self.pool.acquire() as conn:
            participant = await conn.fetchrow(
                "SELECT net_debit_cap FROM central_ledger.participants WHERE fsp_id = $1",
                fsp_id
            )
            
            if not participant:
                return False, "Participant not found"
            
            ndc = participant['net_debit_cap']
            positions = await self.get_position(fsp_id, currency)
            
            current_position = positions[PositionType.POSITION.value]
            reserved = positions[PositionType.RESERVED.value]
            
            new_position = current_position - amount - reserved
            
            if abs(new_position) > ndc:
                return False, f"Transfer would exceed NDC. Current: {current_position}, Reserved: {reserved}, NDC: {ndc}"
            
            return True, "OK"
    
    async def reserve_position(self, fsp_id: str, currency: str, amount: Decimal,
                              transfer_id: str) -> bool:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                current = await conn.fetchval("""
                    SELECT value FROM central_ledger.participant_positions
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                """, fsp_id, currency, PositionType.RESERVED.value)
                
                current = current or Decimal("0")
                new_value = current + amount
                
                await conn.execute("""
                    INSERT INTO central_ledger.participant_positions (fsp_id, currency, position_type, value)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (fsp_id, currency, position_type)
                    DO UPDATE SET value = $4, updated_at = NOW()
                """, fsp_id, currency, PositionType.RESERVED.value, new_value)
                
                await conn.execute("""
                    INSERT INTO central_ledger.position_history 
                    (fsp_id, currency, position_type, previous_value, new_value, change_amount, transfer_id, reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, fsp_id, currency, PositionType.RESERVED.value, current, new_value,
                    amount, uuid.UUID(transfer_id), "Transfer reservation")
        
        # Invalidate cache and publish event
        if config.ENABLE_REDIS_CACHE and middleware:
            await middleware.redis.invalidate_position(fsp_id, currency)
        
        if middleware:
            await middleware.on_position_updated(
                fsp_id=fsp_id,
                currency=currency,
                previous_position=current,
                new_position=new_value,
                reason="Transfer reservation",
                transfer_id=transfer_id
            )
        
        return True
    
    async def commit_position(self, fsp_id: str, currency: str, amount: Decimal,
                             transfer_id: str, is_payer: bool) -> bool:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                if is_payer:
                    # Reduce reserved
                    await conn.execute("""
                        UPDATE central_ledger.participant_positions 
                        SET value = value - $3, updated_at = NOW()
                        WHERE fsp_id = $1 AND currency = $2 AND position_type = $4
                    """, fsp_id, currency, amount, PositionType.RESERVED.value)
                    
                    # Update position (debit)
                    current_pos = await conn.fetchval("""
                        SELECT value FROM central_ledger.participant_positions
                        WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                    """, fsp_id, currency, PositionType.POSITION.value) or Decimal("0")
                    
                    new_pos = current_pos - amount
                else:
                    # Update position (credit)
                    current_pos = await conn.fetchval("""
                        SELECT value FROM central_ledger.participant_positions
                        WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                    """, fsp_id, currency, PositionType.POSITION.value) or Decimal("0")
                    
                    new_pos = current_pos + amount
                
                await conn.execute("""
                    INSERT INTO central_ledger.participant_positions (fsp_id, currency, position_type, value)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (fsp_id, currency, position_type)
                    DO UPDATE SET value = $4, updated_at = NOW()
                """, fsp_id, currency, PositionType.POSITION.value, new_pos)
                
                await conn.execute("""
                    INSERT INTO central_ledger.position_history 
                    (fsp_id, currency, position_type, previous_value, new_value, change_amount, transfer_id, reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, fsp_id, currency, PositionType.POSITION.value, current_pos, new_pos,
                    -amount if is_payer else amount, uuid.UUID(transfer_id), 
                    "Transfer commit (debit)" if is_payer else "Transfer commit (credit)")
        
        # Invalidate cache and publish event
        if config.ENABLE_REDIS_CACHE and middleware:
            await middleware.redis.invalidate_position(fsp_id, currency)
        
        if middleware:
            await middleware.on_position_updated(
                fsp_id=fsp_id,
                currency=currency,
                previous_position=current_pos,
                new_position=new_pos,
                reason="Transfer commit",
                transfer_id=transfer_id
            )
        
        return True
    
    async def release_reservation(self, fsp_id: str, currency: str, amount: Decimal,
                                  transfer_id: str) -> bool:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                current = await conn.fetchval("""
                    SELECT value FROM central_ledger.participant_positions
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                """, fsp_id, currency, PositionType.RESERVED.value) or Decimal("0")
                
                new_value = max(Decimal("0"), current - amount)
                
                await conn.execute("""
                    UPDATE central_ledger.participant_positions
                    SET value = $4, updated_at = NOW()
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                """, fsp_id, currency, PositionType.RESERVED.value, new_value)
                
                await conn.execute("""
                    INSERT INTO central_ledger.position_history 
                    (fsp_id, currency, position_type, previous_value, new_value, change_amount, transfer_id, reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, fsp_id, currency, PositionType.RESERVED.value, current, new_value,
                    -amount, uuid.UUID(transfer_id), "Reservation released")
        
        if config.ENABLE_REDIS_CACHE and middleware:
            await middleware.redis.invalidate_position(fsp_id, currency)
        
        return True


# ==================== Background Worker ====================

async def position_monitor_worker():
    """Background worker to monitor positions and sync with TigerBeetle"""
    while True:
        try:
            pool = await get_db_pool()
            
            async with pool.acquire() as conn:
                participants = await conn.fetch(
                    "SELECT fsp_id, currency, tigerbeetle_account_id FROM central_ledger.participants WHERE status = 'ACTIVE'"
                )
                
                for p in participants:
                    if p['tigerbeetle_account_id']:
                        # Get TigerBeetle balance
                        tb_result = await tigerbeetle.get_balance(p['tigerbeetle_account_id'])
                        
                        if tb_result.get("success"):
                            tb_balance = Decimal(str(tb_result.get("available_balance", 0)))
                            
                            # Get Postgres position
                            pg_position = await conn.fetchval("""
                                SELECT value FROM central_ledger.participant_positions
                                WHERE fsp_id = $1 AND currency = $2 AND position_type = 'POSITION'
                            """, p['fsp_id'], p['currency']) or Decimal("0")
                            
                            # Check for mismatch
                            if abs(tb_balance - pg_position) > Decimal("0.01"):
                                logger.warning(
                                    f"Position mismatch for {p['fsp_id']}: "
                                    f"Postgres={pg_position}, TigerBeetle={tb_balance}"
                                )
                                
                                # Publish alert via Kafka
                                if middleware and config.ENABLE_KAFKA:
                                    await middleware.kafka.publish_tigerbeetle_event(
                                        "position.mismatch",
                                        {
                                            "fsp_id": p['fsp_id'],
                                            "postgres_position": str(pg_position),
                                            "tigerbeetle_balance": str(tb_balance),
                                            "difference": str(tb_balance - pg_position)
                                        }
                                    )
            
        except Exception as e:
            logger.error(f"Position monitor error: {e}")
        
        await asyncio.sleep(config.POSITION_CHECK_INTERVAL)


# ==================== Authentication ====================

async def get_current_user(request: Request) -> Dict[str, Any]:
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
    pool = await get_db_pool()
    
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {e}"
    
    try:
        response = await tigerbeetle.client.get(f"{config.TIGERBEETLE_URL}/health")
        tb_status = "healthy" if response.status_code == 200 else "unhealthy"
    except:
        tb_status = "unavailable"
    
    return {
        "status": "healthy" if db_status == "healthy" else "degraded",
        "service": "central-ledger-integrated",
        "version": "3.0.0",
        "components": {
            "database": db_status,
            "tigerbeetle": tb_status,
            "kafka": "enabled" if config.ENABLE_KAFKA else "disabled",
            "redis": "enabled" if config.ENABLE_REDIS_CACHE else "disabled",
            "keycloak": "enabled" if config.ENABLE_KEYCLOAK_AUTH else "disabled",
            "permify": "enabled" if config.ENABLE_PERMIFY_AUTHZ else "disabled"
        }
    }


@app.post("/participants")
async def create_participant(
    request: ParticipantCreate,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Create a new participant with TigerBeetle account"""
    pool = await get_db_pool()
    
    # Authorization check
    if config.ENABLE_PERMIFY_AUTHZ:
        user_id = current_user.get("sub")
        can_create = await middleware.permify.check_permission(
            "user", user_id, "create", "participant", "system"
        )
        if not can_create:
            raise HTTPException(status_code=403, detail="Not authorized to create participants")
    
    async with pool.acquire() as conn:
        # Check if exists
        existing = await conn.fetchrow(
            "SELECT fsp_id FROM central_ledger.participants WHERE fsp_id = $1",
            request.fsp_id
        )
        
        if existing:
            raise HTTPException(status_code=409, detail="Participant already exists")
        
        # Create TigerBeetle account
        tb_result = await tigerbeetle.create_account(
            user_id=f"participant:{request.fsp_id}",
            account_type=10,
            currency=request.currency
        )
        
        tb_account_id = tb_result.get("account_id") if tb_result.get("success") else None
        
        # Create participant
        await conn.execute("""
            INSERT INTO central_ledger.participants 
            (fsp_id, name, currency, status, net_debit_cap, daily_limit, transaction_limit, tigerbeetle_account_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """, request.fsp_id, request.name, request.currency, 
            ParticipantStatus.ACTIVE.value if request.is_active else ParticipantStatus.CREATED.value,
            request.net_debit_cap, request.daily_limit, request.transaction_limit,
            tb_account_id, json.dumps(request.metadata or {}))
        
        # Initialize positions
        for pos_type in PositionType:
            await conn.execute("""
                INSERT INTO central_ledger.participant_positions (fsp_id, currency, position_type, value)
                VALUES ($1, $2, $3, 0)
            """, request.fsp_id, request.currency, pos_type.value)
    
    # Publish event via Kafka
    if middleware and config.ENABLE_KAFKA:
        await middleware.kafka.publish_tigerbeetle_event("participant.created", {
            "fsp_id": request.fsp_id,
            "name": request.name,
            "tigerbeetle_account_id": tb_account_id
        })
    
    # Write Permify relationship
    if middleware and config.ENABLE_PERMIFY_AUTHZ:
        await middleware.permify.write_relationship(
            "fsp", request.fsp_id, "owner", "user", current_user.get("sub")
        )
    
    return {
        "fsp_id": request.fsp_id,
        "name": request.name,
        "status": ParticipantStatus.ACTIVE.value if request.is_active else ParticipantStatus.CREATED.value,
        "tigerbeetle_account_id": tb_account_id
    }


@app.get("/participants/{fsp_id}")
async def get_participant(
    fsp_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get participant details with position"""
    pool = await get_db_pool()
    position_manager = PositionManager(pool)
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM central_ledger.participants WHERE fsp_id = $1",
            fsp_id
        )
        
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        positions = await position_manager.get_position(fsp_id, participant['currency'])
        
        current_pos = positions[PositionType.POSITION.value]
        reserved = positions[PositionType.RESERVED.value]
        available = participant['net_debit_cap'] - abs(current_pos) - reserved
        
        return {
            "fsp_id": participant['fsp_id'],
            "name": participant['name'],
            "currency": participant['currency'],
            "status": participant['status'],
            "net_debit_cap": str(participant['net_debit_cap']),
            "daily_limit": str(participant['daily_limit']) if participant['daily_limit'] else None,
            "transaction_limit": str(participant['transaction_limit']) if participant['transaction_limit'] else None,
            "current_position": str(current_pos),
            "reserved_position": str(reserved),
            "available_position": str(available),
            "tigerbeetle_account_id": participant['tigerbeetle_account_id'],
            "created_at": participant['created_at'].isoformat(),
            "updated_at": participant['updated_at'].isoformat()
        }


@app.get("/participants/{fsp_id}/position")
async def get_participant_position(
    fsp_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get participant position with TigerBeetle balance"""
    pool = await get_db_pool()
    position_manager = PositionManager(pool)
    
    # Authorization check
    if config.ENABLE_PERMIFY_AUTHZ:
        user_id = current_user.get("sub")
        if not await middleware.authorize_position_view(user_id, fsp_id):
            raise HTTPException(status_code=403, detail="Not authorized to view position")
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM central_ledger.participants WHERE fsp_id = $1",
            fsp_id
        )
        
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        positions = await position_manager.get_position(fsp_id, participant['currency'])
        
        current_pos = positions[PositionType.POSITION.value]
        reserved = positions[PositionType.RESERVED.value]
        ndc = participant['net_debit_cap']
        available = ndc - abs(current_pos) - reserved
        utilization = (abs(current_pos) + reserved) / ndc * 100 if ndc > 0 else Decimal("0")
        
        # Get TigerBeetle balance
        tb_balance = None
        if participant['tigerbeetle_account_id']:
            tb_result = await tigerbeetle.get_balance(participant['tigerbeetle_account_id'])
            if tb_result.get("success"):
                tb_balance = Decimal(str(tb_result.get("available_balance", 0)))
        
        return {
            "fsp_id": fsp_id,
            "currency": participant['currency'],
            "position": str(current_pos),
            "reserved": str(reserved),
            "available": str(available),
            "net_debit_cap": str(ndc),
            "utilization_percent": str(round(utilization, 2)),
            "tigerbeetle_balance": str(tb_balance) if tb_balance else None,
            "last_updated": datetime.utcnow().isoformat()
        }


@app.post("/transfers/prepare")
async def prepare_transfer(
    request: TransferPrepareRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Prepare transfer - check NDC and reserve position"""
    pool = await get_db_pool()
    position_manager = PositionManager(pool)
    
    # Check NDC
    ndc_ok, ndc_msg = await position_manager.check_ndc(
        request.payer_fsp, request.currency, request.amount
    )
    
    if not ndc_ok:
        raise HTTPException(status_code=400, detail=ndc_msg)
    
    # Reserve position
    await position_manager.reserve_position(
        request.payer_fsp, request.currency, request.amount, request.transfer_id
    )
    
    # Record transfer state
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO central_ledger.transfer_state 
            (transfer_id, payer_fsp, payee_fsp, amount, currency, state, payer_position_reserved)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (transfer_id) DO UPDATE SET
                state = $6, payer_position_reserved = $7, updated_at = NOW()
        """, uuid.UUID(request.transfer_id), request.payer_fsp, request.payee_fsp,
            request.amount, request.currency, TransferState.RESERVED.value, request.amount)
    
    return {
        "transfer_id": request.transfer_id,
        "state": TransferState.RESERVED.value,
        "message": "Position reserved"
    }


@app.post("/transfers/fulfill")
async def fulfill_transfer(
    request: TransferFulfillRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Fulfill transfer - commit positions"""
    pool = await get_db_pool()
    position_manager = PositionManager(pool)
    
    async with pool.acquire() as conn:
        transfer = await conn.fetchrow(
            "SELECT * FROM central_ledger.transfer_state WHERE transfer_id = $1",
            uuid.UUID(request.transfer_id)
        )
        
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer not found")
        
        if transfer['state'] != TransferState.RESERVED.value:
            raise HTTPException(status_code=400, detail=f"Cannot fulfill in state: {transfer['state']}")
        
        # Commit payer position (debit)
        await position_manager.commit_position(
            transfer['payer_fsp'], transfer['currency'], transfer['amount'],
            request.transfer_id, is_payer=True
        )
        
        # Commit payee position (credit)
        await position_manager.commit_position(
            transfer['payee_fsp'], transfer['currency'], transfer['amount'],
            request.transfer_id, is_payer=False
        )
        
        # Update transfer state
        await conn.execute("""
            UPDATE central_ledger.transfer_state
            SET state = $2, updated_at = NOW(), completed_at = NOW()
            WHERE transfer_id = $1
        """, uuid.UUID(request.transfer_id), TransferState.COMMITTED.value)
        
        # Update daily usage
        today = datetime.utcnow().date()
        
        await conn.execute("""
            INSERT INTO central_ledger.daily_usage (fsp_id, currency, usage_date, total_debits, transaction_count)
            VALUES ($1, $2, $3, $4, 1)
            ON CONFLICT (fsp_id, currency, usage_date)
            DO UPDATE SET total_debits = central_ledger.daily_usage.total_debits + $4,
                         transaction_count = central_ledger.daily_usage.transaction_count + 1,
                         updated_at = NOW()
        """, transfer['payer_fsp'], transfer['currency'], today, transfer['amount'])
        
        await conn.execute("""
            INSERT INTO central_ledger.daily_usage (fsp_id, currency, usage_date, total_credits, transaction_count)
            VALUES ($1, $2, $3, $4, 1)
            ON CONFLICT (fsp_id, currency, usage_date)
            DO UPDATE SET total_credits = central_ledger.daily_usage.total_credits + $4,
                         transaction_count = central_ledger.daily_usage.transaction_count + 1,
                         updated_at = NOW()
        """, transfer['payee_fsp'], transfer['currency'], today, transfer['amount'])
    
    return {
        "transfer_id": request.transfer_id,
        "state": TransferState.COMMITTED.value,
        "message": "Transfer fulfilled"
    }


@app.post("/transfers/abort")
async def abort_transfer(
    request: TransferAbortRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Abort transfer - release reservation"""
    pool = await get_db_pool()
    position_manager = PositionManager(pool)
    
    async with pool.acquire() as conn:
        transfer = await conn.fetchrow(
            "SELECT * FROM central_ledger.transfer_state WHERE transfer_id = $1",
            uuid.UUID(request.transfer_id)
        )
        
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer not found")
        
        if transfer['state'] in [TransferState.COMMITTED.value, TransferState.ABORTED.value]:
            raise HTTPException(status_code=400, detail=f"Cannot abort in state: {transfer['state']}")
        
        # Release reservation
        if transfer['payer_position_reserved']:
            await position_manager.release_reservation(
                transfer['payer_fsp'], transfer['currency'],
                transfer['payer_position_reserved'], request.transfer_id
            )
        
        # Update transfer state
        await conn.execute("""
            UPDATE central_ledger.transfer_state
            SET state = $2, error_code = $3, error_description = $4,
                updated_at = NOW(), completed_at = NOW()
            WHERE transfer_id = $1
        """, uuid.UUID(request.transfer_id), TransferState.ABORTED.value,
            request.error_code, request.error_description)
    
    return {
        "transfer_id": request.transfer_id,
        "state": TransferState.ABORTED.value,
        "message": "Transfer aborted"
    }


@app.post("/participants/{fsp_id}/liquidity")
async def adjust_liquidity(
    fsp_id: str,
    request: LiquidityAdjustment,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Adjust participant liquidity"""
    pool = await get_db_pool()
    
    # Authorization check
    if config.ENABLE_PERMIFY_AUTHZ:
        user_id = current_user.get("sub")
        if not await middleware.authorize_liquidity_adjustment(user_id, fsp_id):
            raise HTTPException(status_code=403, detail="Not authorized to adjust liquidity")
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM central_ledger.participants WHERE fsp_id = $1",
            fsp_id
        )
        
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        # Get current position
        current_pos = await conn.fetchval("""
            SELECT value FROM central_ledger.participant_positions
            WHERE fsp_id = $1 AND currency = $2 AND position_type = 'POSITION'
        """, fsp_id, request.currency) or Decimal("0")
        
        # Calculate new position
        if request.adjustment_type == "DEPOSIT":
            new_pos = current_pos + request.amount
        elif request.adjustment_type == "WITHDRAWAL":
            new_pos = current_pos - request.amount
        else:
            raise HTTPException(status_code=400, detail="Invalid adjustment type")
        
        # Update position
        await conn.execute("""
            INSERT INTO central_ledger.participant_positions (fsp_id, currency, position_type, value)
            VALUES ($1, $2, 'POSITION', $3)
            ON CONFLICT (fsp_id, currency, position_type)
            DO UPDATE SET value = $3, updated_at = NOW()
        """, fsp_id, request.currency, new_pos)
        
        # Record adjustment
        await conn.execute("""
            INSERT INTO central_ledger.liquidity_adjustments 
            (fsp_id, amount, currency, adjustment_type, reference, description)
            VALUES ($1, $2, $3, $4, $5, $6)
        """, fsp_id, request.amount, request.currency, request.adjustment_type,
            request.reference, request.description)
        
        # Record history
        await conn.execute("""
            INSERT INTO central_ledger.position_history 
            (fsp_id, currency, position_type, previous_value, new_value, change_amount, reason)
            VALUES ($1, $2, 'POSITION', $3, $4, $5, $6)
        """, fsp_id, request.currency, current_pos, new_pos,
            request.amount if request.adjustment_type == "DEPOSIT" else -request.amount,
            f"Liquidity {request.adjustment_type}: {request.reference}")
    
    # Invalidate cache
    if config.ENABLE_REDIS_CACHE and middleware:
        await middleware.redis.invalidate_position(fsp_id, request.currency)
    
    # Publish event
    if middleware:
        await middleware.on_position_updated(
            fsp_id=fsp_id,
            currency=request.currency,
            previous_position=current_pos,
            new_position=new_pos,
            reason=f"Liquidity {request.adjustment_type}"
        )
    
    return {
        "fsp_id": fsp_id,
        "adjustment_type": request.adjustment_type,
        "amount": str(request.amount),
        "previous_position": str(current_pos),
        "new_position": str(new_pos),
        "reference": request.reference
    }


@app.get("/participants")
async def list_participants(
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """List all participants"""
    pool = await get_db_pool()
    
    query = "SELECT * FROM central_ledger.participants WHERE 1=1"
    params = []
    param_idx = 1
    
    if status:
        query += f" AND status = ${param_idx}"
        params.append(status)
        param_idx += 1
    
    query += f" ORDER BY created_at DESC LIMIT ${param_idx} OFFSET ${param_idx + 1}"
    params.extend([limit, offset])
    
    async with pool.acquire() as conn:
        participants = await conn.fetch(query, *params)
        
        return {
            "participants": [
                {
                    "fsp_id": p['fsp_id'],
                    "name": p['name'],
                    "currency": p['currency'],
                    "status": p['status'],
                    "net_debit_cap": str(p['net_debit_cap']),
                    "created_at": p['created_at'].isoformat()
                }
                for p in participants
            ],
            "limit": limit,
            "offset": offset
        }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
