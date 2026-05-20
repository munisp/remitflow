"""
Production-Ready Mojaloop Central Ledger Service
Manages participant positions, liquidity, limits, and orchestration state.
Integrates with TigerBeetle for monetary truth.

Features:
- Participant position management
- Net Debit Cap (NDC) enforcement
- Liquidity management and reserves
- Transfer orchestration state
- Settlement preparation
- Real-time position monitoring
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

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import asyncpg
import httpx
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ==================== Configuration ====================

class Config:
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://mojaloop:mojaloop@localhost:5432/mojaloop")
    TIGERBEETLE_URL = os.getenv("TIGERBEETLE_URL", "http://localhost:8160")
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
    KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
    
    # Position limits
    DEFAULT_NDC = Decimal(os.getenv("DEFAULT_NDC", "1000000000"))  # 1 billion Naira default
    POSITION_CHECK_INTERVAL = int(os.getenv("POSITION_CHECK_INTERVAL", "60"))  # seconds

config = Config()

# Database pool
db_pool: Optional[asyncpg.Pool] = None

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
    pool = await get_db_pool()
    await initialize_database(pool)
    logger.info("Central Ledger started with PostgreSQL and TigerBeetle integration")
    # Start background position monitoring
    asyncio.create_task(position_monitor_worker())
    yield
    if db_pool:
        await db_pool.close()

app = FastAPI(
    title="Mojaloop Central Ledger (Production)",
    description="Production-ready central ledger with position management, NDC enforcement, and TigerBeetle integration",
    version="2.0.0",
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
    POSITION = "POSITION"  # Current position
    RESERVED = "RESERVED"  # Reserved for pending transfers
    SETTLEMENT = "SETTLEMENT"  # Settlement position

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

class LimitResponse(BaseModel):
    fsp_id: str
    limit_type: LimitType
    value: Decimal
    currency: str
    current_usage: Decimal
    remaining: Decimal
    reset_at: Optional[datetime]

class TransferPrepareRequest(BaseModel):
    transfer_id: str
    payer_fsp: str
    payee_fsp: str
    amount: Decimal
    currency: str = "NGN"
    
    @validator('transfer_id')
    def validate_transfer_id(cls, v):
        try:
            uuid.UUID(v)
            return v
        except:
            raise ValueError("transfer_id must be a valid UUID")

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
    adjustment_type: str  # "DEPOSIT" or "WITHDRAWAL"
    reference: str
    description: Optional[str] = None

# ==================== Database Schema ====================

async def initialize_database(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            -- Participants table
            CREATE TABLE IF NOT EXISTS participants (
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
            
            -- Participant positions
            CREATE TABLE IF NOT EXISTS participant_positions (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL REFERENCES participants(fsp_id),
                currency VARCHAR(3) NOT NULL,
                position_type VARCHAR(20) NOT NULL,
                value DECIMAL(18, 4) NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(fsp_id, currency, position_type)
            );
            
            -- Position history for audit
            CREATE TABLE IF NOT EXISTS position_history (
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
            
            -- Transfer orchestration state
            CREATE TABLE IF NOT EXISTS transfer_state (
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
            
            -- Daily usage tracking
            CREATE TABLE IF NOT EXISTS daily_usage (
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
            
            -- Liquidity adjustments
            CREATE TABLE IF NOT EXISTS liquidity_adjustments (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL REFERENCES participants(fsp_id),
                amount DECIMAL(18, 4) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                adjustment_type VARCHAR(20) NOT NULL,
                reference VARCHAR(255) NOT NULL UNIQUE,
                description TEXT,
                tigerbeetle_transfer_id VARCHAR(100),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_positions_fsp ON participant_positions(fsp_id);
            CREATE INDEX IF NOT EXISTS idx_transfer_state_payer ON transfer_state(payer_fsp);
            CREATE INDEX IF NOT EXISTS idx_transfer_state_payee ON transfer_state(payee_fsp);
            CREATE INDEX IF NOT EXISTS idx_transfer_state_state ON transfer_state(state);
            CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage(usage_date);
            CREATE INDEX IF NOT EXISTS idx_position_history_fsp ON position_history(fsp_id, created_at);
        """)
        logger.info("Central Ledger database schema initialized")

# ==================== TigerBeetle Client ====================

class TigerBeetleClient:
    """Client for TigerBeetle production service"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def create_participant_account(self, fsp_id: str, currency: str, 
                                         initial_balance: Decimal = Decimal("0")) -> Dict[str, Any]:
        """Create TigerBeetle account for participant"""
        try:
            payload = {
                "user_id": f"participant:{fsp_id}",
                "account_type": 10,  # AGENT_FLOAT
                "currency": currency,
                "initial_balance": str(initial_balance),
                "enable_history": True,
                "metadata": {"fsp_id": fsp_id}
            }
            response = await self.client.post(f"{self.base_url}/accounts", json=payload)
            if response.status_code == 200:
                return response.json()
            logger.error(f"TigerBeetle account creation failed: {response.text}")
            return {"error": response.text}
        except Exception as e:
            logger.error(f"TigerBeetle error: {e}")
            return {"error": str(e)}
    
    async def create_pending_transfer(self, from_account: str, to_account: str,
                                       amount: Decimal, idempotency_key: str,
                                       timeout_seconds: int = 300) -> Dict[str, Any]:
        """Create pending transfer for 2PC"""
        try:
            payload = {
                "from_account_id": from_account,
                "to_account_id": to_account,
                "amount": str(amount),
                "currency": "NGN",
                "transfer_code": 3,  # TRANSFER
                "description": "Mojaloop transfer reservation",
                "idempotency_key": idempotency_key,
                "timeout_seconds": timeout_seconds
            }
            response = await self.client.post(f"{self.base_url}/transfers/pending", json=payload)
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            logger.error(f"TigerBeetle pending transfer error: {e}")
            return {"error": str(e)}
    
    async def post_pending_transfer(self, pending_id: str, idempotency_key: str) -> Dict[str, Any]:
        """Post (commit) pending transfer"""
        try:
            payload = {
                "pending_transfer_id": pending_id,
                "idempotency_key": idempotency_key
            }
            response = await self.client.post(f"{self.base_url}/transfers/pending/post", json=payload)
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            logger.error(f"TigerBeetle post pending error: {e}")
            return {"error": str(e)}
    
    async def void_pending_transfer(self, pending_id: str, idempotency_key: str) -> Dict[str, Any]:
        """Void (abort) pending transfer"""
        try:
            payload = {
                "pending_transfer_id": pending_id,
                "idempotency_key": idempotency_key
            }
            response = await self.client.post(f"{self.base_url}/transfers/pending/void", json=payload)
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            logger.error(f"TigerBeetle void pending error: {e}")
            return {"error": str(e)}
    
    async def get_account_balance(self, account_id: str) -> Dict[str, Any]:
        """Get account balance from TigerBeetle"""
        try:
            response = await self.client.get(f"{self.base_url}/accounts/{account_id}/balance")
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            logger.error(f"TigerBeetle balance error: {e}")
            return {"error": str(e)}

tigerbeetle = TigerBeetleClient(config.TIGERBEETLE_URL)

# ==================== Position Manager ====================

class PositionManager:
    """Manages participant positions and NDC enforcement"""
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def get_position(self, fsp_id: str, currency: str) -> Dict[str, Decimal]:
        """Get current position for participant"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT position_type, value FROM participant_positions
                WHERE fsp_id = $1 AND currency = $2
            """, fsp_id, currency)
            
            positions = {
                PositionType.POSITION.value: Decimal("0"),
                PositionType.RESERVED.value: Decimal("0"),
                PositionType.SETTLEMENT.value: Decimal("0")
            }
            
            for row in rows:
                positions[row['position_type']] = row['value']
            
            return positions
    
    async def check_ndc(self, fsp_id: str, currency: str, amount: Decimal) -> Tuple[bool, str]:
        """Check if transfer would exceed Net Debit Cap"""
        async with self.pool.acquire() as conn:
            participant = await conn.fetchrow(
                "SELECT net_debit_cap FROM participants WHERE fsp_id = $1",
                fsp_id
            )
            
            if not participant:
                return False, "Participant not found"
            
            ndc = participant['net_debit_cap']
            positions = await self.get_position(fsp_id, currency)
            
            current_position = positions[PositionType.POSITION.value]
            reserved = positions[PositionType.RESERVED.value]
            
            # Position after this transfer (negative means net debit)
            new_position = current_position - amount - reserved
            
            if abs(new_position) > ndc:
                return False, f"Transfer would exceed NDC. Current: {current_position}, Reserved: {reserved}, NDC: {ndc}"
            
            return True, "OK"
    
    async def reserve_position(self, fsp_id: str, currency: str, amount: Decimal,
                               transfer_id: str) -> bool:
        """Reserve position for pending transfer"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Get current reserved position
                current = await conn.fetchval("""
                    SELECT value FROM participant_positions
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                """, fsp_id, currency, PositionType.RESERVED.value)
                
                current = current or Decimal("0")
                new_value = current + amount
                
                # Upsert reserved position
                await conn.execute("""
                    INSERT INTO participant_positions (fsp_id, currency, position_type, value)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (fsp_id, currency, position_type)
                    DO UPDATE SET value = $4, updated_at = NOW()
                """, fsp_id, currency, PositionType.RESERVED.value, new_value)
                
                # Record history
                await conn.execute("""
                    INSERT INTO position_history 
                    (fsp_id, currency, position_type, previous_value, new_value, change_amount, transfer_id, reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, fsp_id, currency, PositionType.RESERVED.value, current, new_value, 
                    amount, uuid.UUID(transfer_id), "Transfer reservation")
                
                return True
    
    async def commit_position(self, fsp_id: str, currency: str, amount: Decimal,
                              transfer_id: str) -> bool:
        """Commit reserved position (move from reserved to position)"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Reduce reserved
                await conn.execute("""
                    UPDATE participant_positions 
                    SET value = value - $3, updated_at = NOW()
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $4
                """, fsp_id, currency, amount, PositionType.RESERVED.value)
                
                # Update position (debit for payer)
                current_pos = await conn.fetchval("""
                    SELECT value FROM participant_positions
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                """, fsp_id, currency, PositionType.POSITION.value)
                
                current_pos = current_pos or Decimal("0")
                new_pos = current_pos - amount
                
                await conn.execute("""
                    INSERT INTO participant_positions (fsp_id, currency, position_type, value)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (fsp_id, currency, position_type)
                    DO UPDATE SET value = $4, updated_at = NOW()
                """, fsp_id, currency, PositionType.POSITION.value, new_pos)
                
                # Record history
                await conn.execute("""
                    INSERT INTO position_history 
                    (fsp_id, currency, position_type, previous_value, new_value, change_amount, transfer_id, reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, fsp_id, currency, PositionType.POSITION.value, current_pos, new_pos,
                    -amount, uuid.UUID(transfer_id), "Transfer committed")
                
                return True
    
    async def release_reservation(self, fsp_id: str, currency: str, amount: Decimal,
                                  transfer_id: str) -> bool:
        """Release reserved position (abort transfer)"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                current = await conn.fetchval("""
                    SELECT value FROM participant_positions
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                """, fsp_id, currency, PositionType.RESERVED.value)
                
                current = current or Decimal("0")
                new_value = max(Decimal("0"), current - amount)
                
                await conn.execute("""
                    UPDATE participant_positions 
                    SET value = $3, updated_at = NOW()
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $4
                """, fsp_id, currency, new_value, PositionType.RESERVED.value)
                
                # Record history
                await conn.execute("""
                    INSERT INTO position_history 
                    (fsp_id, currency, position_type, previous_value, new_value, change_amount, transfer_id, reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, fsp_id, currency, PositionType.RESERVED.value, current, new_value,
                    -amount, uuid.UUID(transfer_id), "Reservation released (abort)")
                
                return True
    
    async def credit_position(self, fsp_id: str, currency: str, amount: Decimal,
                              transfer_id: str) -> bool:
        """Credit position (for payee)"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                current_pos = await conn.fetchval("""
                    SELECT value FROM participant_positions
                    WHERE fsp_id = $1 AND currency = $2 AND position_type = $3
                """, fsp_id, currency, PositionType.POSITION.value)
                
                current_pos = current_pos or Decimal("0")
                new_pos = current_pos + amount
                
                await conn.execute("""
                    INSERT INTO participant_positions (fsp_id, currency, position_type, value)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (fsp_id, currency, position_type)
                    DO UPDATE SET value = $4, updated_at = NOW()
                """, fsp_id, currency, PositionType.POSITION.value, new_pos)
                
                # Record history
                await conn.execute("""
                    INSERT INTO position_history 
                    (fsp_id, currency, position_type, previous_value, new_value, change_amount, transfer_id, reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, fsp_id, currency, PositionType.POSITION.value, current_pos, new_pos,
                    amount, uuid.UUID(transfer_id), "Transfer credit received")
                
                return True

# ==================== Background Workers ====================

async def position_monitor_worker():
    """Background worker to monitor positions and alert on NDC breaches"""
    while True:
        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                # Check for participants approaching NDC
                rows = await conn.fetch("""
                    SELECT p.fsp_id, p.net_debit_cap, p.currency,
                           COALESCE(pos.value, 0) as position,
                           COALESCE(res.value, 0) as reserved
                    FROM participants p
                    LEFT JOIN participant_positions pos 
                        ON p.fsp_id = pos.fsp_id AND pos.position_type = 'POSITION'
                    LEFT JOIN participant_positions res 
                        ON p.fsp_id = res.fsp_id AND res.position_type = 'RESERVED'
                    WHERE p.status = 'ACTIVE'
                """)
                
                for row in rows:
                    utilization = abs(row['position'] + row['reserved']) / row['net_debit_cap'] * 100
                    if utilization > 80:
                        logger.warning(
                            f"NDC Alert: {row['fsp_id']} at {utilization:.1f}% utilization "
                            f"(Position: {row['position']}, Reserved: {row['reserved']}, NDC: {row['net_debit_cap']})"
                        )
            
            await asyncio.sleep(config.POSITION_CHECK_INTERVAL)
        except Exception as e:
            logger.error(f"Position monitor error: {e}")
            await asyncio.sleep(config.POSITION_CHECK_INTERVAL)

# ==================== API Endpoints ====================

@app.get("/health")
async def health_check():
    pool = await get_db_pool()
    db_healthy = False
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
            db_healthy = True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
    
    return {
        "status": "healthy" if db_healthy else "degraded",
        "service": "central-ledger",
        "version": "2.0.0",
        "database": "connected" if db_healthy else "disconnected",
        "tigerbeetle_url": config.TIGERBEETLE_URL,
        "timestamp": datetime.utcnow().isoformat()
    }

# Participant Management
@app.post("/participants", response_model=ParticipantResponse)
async def create_participant(participant: ParticipantCreate):
    """Create a new participant (FSP)"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        # Check if exists
        existing = await conn.fetchrow(
            "SELECT fsp_id FROM participants WHERE fsp_id = $1",
            participant.fsp_id
        )
        if existing:
            raise HTTPException(status_code=400, detail="Participant already exists")
        
        # Create TigerBeetle account
        tb_result = await tigerbeetle.create_participant_account(
            participant.fsp_id, participant.currency
        )
        tb_account_id = tb_result.get("account_id") if "error" not in tb_result else None
        
        # Create participant
        row = await conn.fetchrow("""
            INSERT INTO participants 
            (fsp_id, name, currency, status, net_debit_cap, daily_limit, transaction_limit, 
             tigerbeetle_account_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        """, participant.fsp_id, participant.name, participant.currency,
            ParticipantStatus.ACTIVE.value, participant.net_debit_cap,
            participant.daily_limit, participant.transaction_limit,
            tb_account_id, json.dumps(participant.metadata or {}))
        
        # Initialize positions
        for pos_type in [PositionType.POSITION, PositionType.RESERVED, PositionType.SETTLEMENT]:
            await conn.execute("""
                INSERT INTO participant_positions (fsp_id, currency, position_type, value)
                VALUES ($1, $2, $3, 0)
            """, participant.fsp_id, participant.currency, pos_type.value)
        
        return ParticipantResponse(
            fsp_id=row['fsp_id'],
            name=row['name'],
            currency=row['currency'],
            status=ParticipantStatus(row['status']),
            net_debit_cap=row['net_debit_cap'],
            daily_limit=row['daily_limit'],
            transaction_limit=row['transaction_limit'],
            current_position=Decimal("0"),
            reserved_position=Decimal("0"),
            available_position=row['net_debit_cap'],
            tigerbeetle_account_id=tb_account_id,
            created_at=row['created_at'],
            updated_at=row['updated_at']
        )

@app.get("/participants/{fsp_id}", response_model=ParticipantResponse)
async def get_participant(fsp_id: str):
    """Get participant details"""
    pool = await get_db_pool()
    position_mgr = PositionManager(pool)
    
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM participants WHERE fsp_id = $1", fsp_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        positions = await position_mgr.get_position(fsp_id, row['currency'])
        current_pos = positions[PositionType.POSITION.value]
        reserved = positions[PositionType.RESERVED.value]
        available = row['net_debit_cap'] - abs(current_pos) - reserved
        
        return ParticipantResponse(
            fsp_id=row['fsp_id'],
            name=row['name'],
            currency=row['currency'],
            status=ParticipantStatus(row['status']),
            net_debit_cap=row['net_debit_cap'],
            daily_limit=row['daily_limit'],
            transaction_limit=row['transaction_limit'],
            current_position=current_pos,
            reserved_position=reserved,
            available_position=available,
            tigerbeetle_account_id=row['tigerbeetle_account_id'],
            created_at=row['created_at'],
            updated_at=row['updated_at']
        )

@app.get("/participants")
async def list_participants(status: Optional[str] = None, currency: Optional[str] = None):
    """List all participants"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        query = "SELECT * FROM participants WHERE 1=1"
        params = []
        
        if status:
            params.append(status)
            query += f" AND status = ${len(params)}"
        if currency:
            params.append(currency)
            query += f" AND currency = ${len(params)}"
        
        rows = await conn.fetch(query, *params)
        
        return {
            "participants": [dict(row) for row in rows],
            "count": len(rows)
        }

@app.patch("/participants/{fsp_id}")
async def update_participant(fsp_id: str, update: ParticipantUpdate):
    """Update participant settings"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM participants WHERE fsp_id = $1", fsp_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        updates = []
        params = [fsp_id]
        
        if update.name is not None:
            params.append(update.name)
            updates.append(f"name = ${len(params)}")
        if update.net_debit_cap is not None:
            params.append(update.net_debit_cap)
            updates.append(f"net_debit_cap = ${len(params)}")
        if update.daily_limit is not None:
            params.append(update.daily_limit)
            updates.append(f"daily_limit = ${len(params)}")
        if update.transaction_limit is not None:
            params.append(update.transaction_limit)
            updates.append(f"transaction_limit = ${len(params)}")
        if update.is_active is not None:
            status = ParticipantStatus.ACTIVE if update.is_active else ParticipantStatus.SUSPENDED
            params.append(status.value)
            updates.append(f"status = ${len(params)}")
        if update.status is not None:
            params.append(update.status.value)
            updates.append(f"status = ${len(params)}")
        
        if updates:
            updates.append("updated_at = NOW()")
            query = f"UPDATE participants SET {', '.join(updates)} WHERE fsp_id = $1 RETURNING *"
            row = await conn.fetchrow(query, *params)
            return dict(row)
        
        return dict(existing)

# Position Management
@app.get("/participants/{fsp_id}/position", response_model=PositionResponse)
async def get_participant_position(fsp_id: str):
    """Get participant position details"""
    pool = await get_db_pool()
    position_mgr = PositionManager(pool)
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM participants WHERE fsp_id = $1", fsp_id
        )
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        positions = await position_mgr.get_position(fsp_id, participant['currency'])
        current_pos = positions[PositionType.POSITION.value]
        reserved = positions[PositionType.RESERVED.value]
        available = participant['net_debit_cap'] - abs(current_pos) - reserved
        utilization = abs(current_pos + reserved) / participant['net_debit_cap'] * 100
        
        return PositionResponse(
            fsp_id=fsp_id,
            currency=participant['currency'],
            position=current_pos,
            reserved=reserved,
            available=available,
            net_debit_cap=participant['net_debit_cap'],
            utilization_percent=utilization,
            last_updated=datetime.utcnow()
        )

@app.get("/participants/{fsp_id}/limits")
async def get_participant_limits(fsp_id: str):
    """Get participant limits and usage"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM participants WHERE fsp_id = $1", fsp_id
        )
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        # Get daily usage
        today = datetime.utcnow().date()
        daily_usage = await conn.fetchrow("""
            SELECT total_debits, transaction_count FROM daily_usage
            WHERE fsp_id = $1 AND currency = $2 AND usage_date = $3
        """, fsp_id, participant['currency'], today)
        
        limits = []
        
        # NDC limit
        limits.append({
            "limit_type": LimitType.NET_DEBIT_CAP.value,
            "value": str(participant['net_debit_cap']),
            "currency": participant['currency'],
            "current_usage": "0",  # Would need position calculation
            "remaining": str(participant['net_debit_cap'])
        })
        
        # Daily limit
        if participant['daily_limit']:
            daily_used = daily_usage['total_debits'] if daily_usage else Decimal("0")
            limits.append({
                "limit_type": LimitType.DAILY_LIMIT.value,
                "value": str(participant['daily_limit']),
                "currency": participant['currency'],
                "current_usage": str(daily_used),
                "remaining": str(participant['daily_limit'] - daily_used),
                "reset_at": (datetime.utcnow().replace(hour=0, minute=0, second=0) + timedelta(days=1)).isoformat()
            })
        
        # Transaction limit
        if participant['transaction_limit']:
            limits.append({
                "limit_type": LimitType.TRANSACTION_LIMIT.value,
                "value": str(participant['transaction_limit']),
                "currency": participant['currency'],
                "current_usage": "0",
                "remaining": str(participant['transaction_limit'])
            })
        
        return {"limits": limits}

# Transfer Orchestration
@app.post("/transfers/prepare")
async def prepare_transfer(request: TransferPrepareRequest):
    """Prepare a transfer (Phase 1 - reserve position and create pending transfer)"""
    pool = await get_db_pool()
    position_mgr = PositionManager(pool)
    
    # Check NDC
    ndc_ok, ndc_msg = await position_mgr.check_ndc(request.payer_fsp, request.currency, request.amount)
    if not ndc_ok:
        raise HTTPException(status_code=400, detail={
            "errorInformation": {"errorCode": "4001", "errorDescription": ndc_msg}
        })
    
    async with pool.acquire() as conn:
        # Get payer's TigerBeetle account
        payer = await conn.fetchrow(
            "SELECT tigerbeetle_account_id FROM participants WHERE fsp_id = $1",
            request.payer_fsp
        )
        payee = await conn.fetchrow(
            "SELECT tigerbeetle_account_id FROM participants WHERE fsp_id = $1",
            request.payee_fsp
        )
        
        if not payer or not payee:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        # Create pending transfer in TigerBeetle
        tb_result = await tigerbeetle.create_pending_transfer(
            payer['tigerbeetle_account_id'],
            payee['tigerbeetle_account_id'],
            request.amount,
            f"mojaloop:{request.transfer_id}"
        )
        
        if "error" in tb_result:
            raise HTTPException(status_code=500, detail={
                "errorInformation": {"errorCode": "2001", "errorDescription": f"Ledger error: {tb_result['error']}"}
            })
        
        # Reserve position
        await position_mgr.reserve_position(request.payer_fsp, request.currency, request.amount, request.transfer_id)
        
        # Store transfer state
        await conn.execute("""
            INSERT INTO transfer_state 
            (transfer_id, payer_fsp, payee_fsp, amount, currency, state, payer_position_reserved, tigerbeetle_pending_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """, uuid.UUID(request.transfer_id), request.payer_fsp, request.payee_fsp,
            request.amount, request.currency, TransferState.RESERVED.value,
            request.amount, tb_result.get('transfer_id'))
        
        return {
            "transferId": request.transfer_id,
            "transferState": TransferState.RESERVED.value,
            "tigerbeetlePendingId": tb_result.get('transfer_id')
        }

@app.post("/transfers/fulfill")
async def fulfill_transfer(request: TransferFulfillRequest):
    """Fulfill a transfer (Phase 2 - commit)"""
    pool = await get_db_pool()
    position_mgr = PositionManager(pool)
    
    async with pool.acquire() as conn:
        transfer = await conn.fetchrow(
            "SELECT * FROM transfer_state WHERE transfer_id = $1",
            uuid.UUID(request.transfer_id)
        )
        
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer not found")
        
        if transfer['state'] != TransferState.RESERVED.value:
            raise HTTPException(status_code=400, detail={
                "errorInformation": {"errorCode": "3101", "errorDescription": f"Transfer not in RESERVED state"}
            })
        
        # Post pending transfer in TigerBeetle
        if transfer['tigerbeetle_pending_id']:
            tb_result = await tigerbeetle.post_pending_transfer(
                transfer['tigerbeetle_pending_id'],
                f"mojaloop:fulfill:{request.transfer_id}"
            )
            if "error" in tb_result:
                raise HTTPException(status_code=500, detail={
                    "errorInformation": {"errorCode": "2001", "errorDescription": f"Ledger error: {tb_result['error']}"}
                })
        
        # Commit payer position
        await position_mgr.commit_position(
            transfer['payer_fsp'], transfer['currency'],
            transfer['amount'], request.transfer_id
        )
        
        # Credit payee position
        await position_mgr.credit_position(
            transfer['payee_fsp'], transfer['currency'],
            transfer['amount'], request.transfer_id
        )
        
        # Update transfer state
        await conn.execute("""
            UPDATE transfer_state 
            SET state = $2, updated_at = NOW(), completed_at = NOW()
            WHERE transfer_id = $1
        """, uuid.UUID(request.transfer_id), TransferState.COMMITTED.value)
        
        # Update daily usage
        today = datetime.utcnow().date()
        await conn.execute("""
            INSERT INTO daily_usage (fsp_id, currency, usage_date, total_debits, transaction_count)
            VALUES ($1, $2, $3, $4, 1)
            ON CONFLICT (fsp_id, currency, usage_date)
            DO UPDATE SET total_debits = daily_usage.total_debits + $4,
                          transaction_count = daily_usage.transaction_count + 1,
                          updated_at = NOW()
        """, transfer['payer_fsp'], transfer['currency'], today, transfer['amount'])
        
        return {
            "transferId": request.transfer_id,
            "transferState": TransferState.COMMITTED.value,
            "completedTimestamp": datetime.utcnow().isoformat() + "Z"
        }

@app.post("/transfers/abort")
async def abort_transfer(request: TransferAbortRequest):
    """Abort a transfer (Phase 2 - abort)"""
    pool = await get_db_pool()
    position_mgr = PositionManager(pool)
    
    async with pool.acquire() as conn:
        transfer = await conn.fetchrow(
            "SELECT * FROM transfer_state WHERE transfer_id = $1",
            uuid.UUID(request.transfer_id)
        )
        
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer not found")
        
        if transfer['state'] != TransferState.RESERVED.value:
            raise HTTPException(status_code=400, detail={
                "errorInformation": {"errorCode": "3101", "errorDescription": f"Transfer not in RESERVED state"}
            })
        
        # Void pending transfer in TigerBeetle
        if transfer['tigerbeetle_pending_id']:
            tb_result = await tigerbeetle.void_pending_transfer(
                transfer['tigerbeetle_pending_id'],
                f"mojaloop:abort:{request.transfer_id}"
            )
            if "error" in tb_result:
                logger.warning(f"TigerBeetle void failed: {tb_result['error']}")
        
        # Release reservation
        await position_mgr.release_reservation(
            transfer['payer_fsp'], transfer['currency'],
            transfer['payer_position_reserved'], request.transfer_id
        )
        
        # Update transfer state
        await conn.execute("""
            UPDATE transfer_state 
            SET state = $2, error_code = $3, error_description = $4, 
                updated_at = NOW(), completed_at = NOW()
            WHERE transfer_id = $1
        """, uuid.UUID(request.transfer_id), TransferState.ABORTED.value,
            request.error_code, request.error_description)
        
        return {
            "transferId": request.transfer_id,
            "transferState": TransferState.ABORTED.value
        }

# Liquidity Management
@app.post("/liquidity/adjust")
async def adjust_liquidity(adjustment: LiquidityAdjustment):
    """Adjust participant liquidity (deposit/withdrawal)"""
    pool = await get_db_pool()
    position_mgr = PositionManager(pool)
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM participants WHERE fsp_id = $1",
            adjustment.fsp_id
        )
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        # Check for duplicate reference
        existing = await conn.fetchrow(
            "SELECT id FROM liquidity_adjustments WHERE reference = $1",
            adjustment.reference
        )
        if existing:
            raise HTTPException(status_code=400, detail="Duplicate adjustment reference")
        
        # Update position
        if adjustment.adjustment_type == "DEPOSIT":
            await position_mgr.credit_position(
                adjustment.fsp_id, adjustment.currency,
                adjustment.amount, str(uuid.uuid4())
            )
        elif adjustment.adjustment_type == "WITHDRAWAL":
            # Check if withdrawal is allowed
            positions = await position_mgr.get_position(adjustment.fsp_id, adjustment.currency)
            current_pos = positions[PositionType.POSITION.value]
            if current_pos < adjustment.amount:
                raise HTTPException(status_code=400, detail="Insufficient balance for withdrawal")
            
            await position_mgr.commit_position(
                adjustment.fsp_id, adjustment.currency,
                adjustment.amount, str(uuid.uuid4())
            )
        else:
            raise HTTPException(status_code=400, detail="Invalid adjustment type")
        
        # Record adjustment
        await conn.execute("""
            INSERT INTO liquidity_adjustments 
            (fsp_id, amount, currency, adjustment_type, reference, description)
            VALUES ($1, $2, $3, $4, $5, $6)
        """, adjustment.fsp_id, adjustment.amount, adjustment.currency,
            adjustment.adjustment_type, adjustment.reference, adjustment.description)
        
        return {
            "status": "success",
            "adjustment_type": adjustment.adjustment_type,
            "amount": str(adjustment.amount),
            "reference": adjustment.reference
        }

@app.get("/positions/summary")
async def get_positions_summary():
    """Get summary of all participant positions"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT p.fsp_id, p.name, p.currency, p.net_debit_cap, p.status,
                   COALESCE(pos.value, 0) as position,
                   COALESCE(res.value, 0) as reserved
            FROM participants p
            LEFT JOIN participant_positions pos 
                ON p.fsp_id = pos.fsp_id AND pos.position_type = 'POSITION'
            LEFT JOIN participant_positions res 
                ON p.fsp_id = res.fsp_id AND res.position_type = 'RESERVED'
            ORDER BY p.fsp_id
        """)
        
        summary = []
        for row in rows:
            available = row['net_debit_cap'] - abs(row['position']) - row['reserved']
            utilization = abs(row['position'] + row['reserved']) / row['net_debit_cap'] * 100
            summary.append({
                "fsp_id": row['fsp_id'],
                "name": row['name'],
                "currency": row['currency'],
                "status": row['status'],
                "position": str(row['position']),
                "reserved": str(row['reserved']),
                "available": str(available),
                "net_debit_cap": str(row['net_debit_cap']),
                "utilization_percent": float(utilization)
            })
        
        return {
            "positions": summary,
            "count": len(summary),
            "timestamp": datetime.utcnow().isoformat()
        }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
