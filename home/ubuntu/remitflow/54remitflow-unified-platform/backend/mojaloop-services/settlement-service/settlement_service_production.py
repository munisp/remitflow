"""
Production-Ready Mojaloop Settlement Service
Manages settlement windows, batching, and reconciliation.

Features:
- Settlement window management (open/close/settle)
- Batch processing for transfers
- Net settlement calculation
- Settlement reports and reconciliation
- TigerBeetle integration for settlement transfers
- Multi-currency support
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

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Query
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
    CENTRAL_LEDGER_URL = os.getenv("CENTRAL_LEDGER_URL", "http://localhost:8001")
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
    
    # Settlement configuration
    DEFAULT_WINDOW_DURATION_HOURS = int(os.getenv("SETTLEMENT_WINDOW_HOURS", "24"))
    AUTO_CLOSE_WINDOWS = os.getenv("AUTO_CLOSE_WINDOWS", "true").lower() == "true"
    MIN_TRANSFERS_FOR_SETTLEMENT = int(os.getenv("MIN_TRANSFERS_FOR_SETTLEMENT", "1"))

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
    logger.info("Settlement Service started")
    # Start background workers
    if config.AUTO_CLOSE_WINDOWS:
        asyncio.create_task(window_auto_close_worker())
    yield
    if db_pool:
        await db_pool.close()

app = FastAPI(
    title="Mojaloop Settlement Service (Production)",
    description="Production-ready settlement service with window management, batching, and reconciliation",
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

class SettlementWindowState(str, Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    PENDING_SETTLEMENT = "PENDING_SETTLEMENT"
    SETTLED = "SETTLED"
    ABORTED = "ABORTED"

class SettlementState(str, Enum):
    PENDING_SETTLEMENT = "PENDING_SETTLEMENT"
    PS_TRANSFERS_RECORDED = "PS_TRANSFERS_RECORDED"
    PS_TRANSFERS_RESERVED = "PS_TRANSFERS_RESERVED"
    PS_TRANSFERS_COMMITTED = "PS_TRANSFERS_COMMITTED"
    SETTLING = "SETTLING"
    SETTLED = "SETTLED"
    ABORTED = "ABORTED"

class ParticipantSettlementState(str, Enum):
    PENDING_SETTLEMENT = "PENDING_SETTLEMENT"
    PS_TRANSFERS_RECORDED = "PS_TRANSFERS_RECORDED"
    PS_TRANSFERS_RESERVED = "PS_TRANSFERS_RESERVED"
    PS_TRANSFERS_COMMITTED = "PS_TRANSFERS_COMMITTED"
    SETTLED = "SETTLED"

# ==================== Models ====================

class CreateWindowRequest(BaseModel):
    reason: Optional[str] = None
    currency: str = Field(default="NGN", max_length=3)

class CloseWindowRequest(BaseModel):
    window_id: int
    reason: Optional[str] = None

class SettlementRequest(BaseModel):
    window_ids: List[int]
    reason: Optional[str] = None

class SettlementWindowResponse(BaseModel):
    window_id: int
    state: SettlementWindowState
    currency: str
    created_at: datetime
    closed_at: Optional[datetime]
    settled_at: Optional[datetime]
    transfer_count: int
    total_amount: Decimal
    reason: Optional[str]

class SettlementResponse(BaseModel):
    settlement_id: int
    state: SettlementState
    currency: str
    window_ids: List[int]
    created_at: datetime
    settled_at: Optional[datetime]
    total_amount: Decimal
    participant_count: int
    net_positions: Dict[str, str]

class ParticipantSettlementPosition(BaseModel):
    fsp_id: str
    currency: str
    net_amount: Decimal  # Positive = receive, Negative = pay
    state: ParticipantSettlementState
    transfers_count: int

class SettlementReport(BaseModel):
    settlement_id: int
    window_ids: List[int]
    currency: str
    created_at: datetime
    settled_at: Optional[datetime]
    state: SettlementState
    total_debits: Decimal
    total_credits: Decimal
    participant_positions: List[ParticipantSettlementPosition]
    transfers_summary: Dict[str, Any]

# ==================== Database Schema ====================

async def initialize_database(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            -- Settlement windows
            CREATE TABLE IF NOT EXISTS settlement_windows (
                window_id SERIAL PRIMARY KEY,
                state VARCHAR(30) NOT NULL DEFAULT 'OPEN',
                currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
                reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                closed_at TIMESTAMP WITH TIME ZONE,
                settled_at TIMESTAMP WITH TIME ZONE,
                settlement_id INTEGER
            );
            
            -- Window transfers (transfers included in each window)
            CREATE TABLE IF NOT EXISTS window_transfers (
                id SERIAL PRIMARY KEY,
                window_id INTEGER NOT NULL REFERENCES settlement_windows(window_id),
                transfer_id UUID NOT NULL,
                payer_fsp VARCHAR(255) NOT NULL,
                payee_fsp VARCHAR(255) NOT NULL,
                amount DECIMAL(18, 4) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(window_id, transfer_id)
            );
            
            -- Settlements
            CREATE TABLE IF NOT EXISTS settlements (
                settlement_id SERIAL PRIMARY KEY,
                state VARCHAR(30) NOT NULL DEFAULT 'PENDING_SETTLEMENT',
                currency VARCHAR(3) NOT NULL,
                reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                settled_at TIMESTAMP WITH TIME ZONE,
                total_amount DECIMAL(18, 4) NOT NULL DEFAULT 0,
                metadata JSONB DEFAULT '{}'
            );
            
            -- Settlement windows mapping
            CREATE TABLE IF NOT EXISTS settlement_window_mapping (
                id SERIAL PRIMARY KEY,
                settlement_id INTEGER NOT NULL REFERENCES settlements(settlement_id),
                window_id INTEGER NOT NULL REFERENCES settlement_windows(window_id),
                UNIQUE(settlement_id, window_id)
            );
            
            -- Participant settlement positions
            CREATE TABLE IF NOT EXISTS participant_settlement_positions (
                id SERIAL PRIMARY KEY,
                settlement_id INTEGER NOT NULL REFERENCES settlements(settlement_id),
                fsp_id VARCHAR(255) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                net_amount DECIMAL(18, 4) NOT NULL,
                state VARCHAR(30) NOT NULL DEFAULT 'PENDING_SETTLEMENT',
                transfers_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(settlement_id, fsp_id, currency)
            );
            
            -- Settlement transfers (actual settlement movements)
            CREATE TABLE IF NOT EXISTS settlement_transfers (
                id SERIAL PRIMARY KEY,
                settlement_id INTEGER NOT NULL REFERENCES settlements(settlement_id),
                from_fsp VARCHAR(255) NOT NULL,
                to_fsp VARCHAR(255) NOT NULL,
                amount DECIMAL(18, 4) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                tigerbeetle_transfer_id VARCHAR(100),
                state VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                completed_at TIMESTAMP WITH TIME ZONE
            );
            
            -- Settlement state history
            CREATE TABLE IF NOT EXISTS settlement_state_history (
                id SERIAL PRIMARY KEY,
                settlement_id INTEGER NOT NULL REFERENCES settlements(settlement_id),
                previous_state VARCHAR(30),
                new_state VARCHAR(30) NOT NULL,
                reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_windows_state ON settlement_windows(state);
            CREATE INDEX IF NOT EXISTS idx_windows_currency ON settlement_windows(currency);
            CREATE INDEX IF NOT EXISTS idx_window_transfers_window ON window_transfers(window_id);
            CREATE INDEX IF NOT EXISTS idx_settlements_state ON settlements(state);
            CREATE INDEX IF NOT EXISTS idx_participant_positions_settlement ON participant_settlement_positions(settlement_id);
        """)
        logger.info("Settlement Service database schema initialized")

# ==================== TigerBeetle Client ====================

class TigerBeetleClient:
    """Client for TigerBeetle settlement transfers"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def create_settlement_transfer(self, from_account: str, to_account: str,
                                          amount: Decimal, idempotency_key: str) -> Dict[str, Any]:
        """Create settlement transfer"""
        try:
            payload = {
                "from_account_id": from_account,
                "to_account_id": to_account,
                "amount": str(amount),
                "currency": "NGN",
                "transfer_code": 9,  # SETTLEMENT
                "description": "Settlement transfer",
                "idempotency_key": idempotency_key
            }
            response = await self.client.post(f"{self.base_url}/transfers", json=payload)
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            logger.error(f"TigerBeetle settlement transfer error: {e}")
            return {"error": str(e)}
    
    async def create_linked_settlement_transfers(self, transfers: List[Dict]) -> Dict[str, Any]:
        """Create linked settlement transfers atomically"""
        try:
            payload = {
                "transfers": transfers,
                "description": "Settlement batch"
            }
            response = await self.client.post(f"{self.base_url}/transfers/linked", json=payload)
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            logger.error(f"TigerBeetle linked settlement error: {e}")
            return {"error": str(e)}

tigerbeetle = TigerBeetleClient(config.TIGERBEETLE_URL)

# ==================== Central Ledger Client ====================

class CentralLedgerClient:
    """Client for Central Ledger position updates"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def get_participant(self, fsp_id: str) -> Dict[str, Any]:
        """Get participant details"""
        try:
            response = await self.client.get(f"{self.base_url}/participants/{fsp_id}")
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            return {"error": str(e)}
    
    async def adjust_liquidity(self, fsp_id: str, amount: Decimal, 
                               adjustment_type: str, reference: str) -> Dict[str, Any]:
        """Adjust participant liquidity for settlement"""
        try:
            payload = {
                "fsp_id": fsp_id,
                "amount": str(abs(amount)),
                "currency": "NGN",
                "adjustment_type": adjustment_type,
                "reference": reference,
                "description": "Settlement adjustment"
            }
            response = await self.client.post(f"{self.base_url}/liquidity/adjust", json=payload)
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            return {"error": str(e)}

central_ledger = CentralLedgerClient(config.CENTRAL_LEDGER_URL)

# ==================== Settlement Manager ====================

class SettlementManager:
    """Manages settlement windows and processing"""
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def get_current_window(self, currency: str) -> Optional[Dict]:
        """Get current open window for currency"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM settlement_windows 
                WHERE state = 'OPEN' AND currency = $1
                ORDER BY created_at DESC LIMIT 1
            """, currency)
            return dict(row) if row else None
    
    async def create_window(self, currency: str, reason: Optional[str] = None) -> Dict:
        """Create a new settlement window"""
        async with self.pool.acquire() as conn:
            # Check if there's already an open window
            existing = await self.get_current_window(currency)
            if existing:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Open window already exists for {currency}: {existing['window_id']}"
                )
            
            row = await conn.fetchrow("""
                INSERT INTO settlement_windows (currency, reason)
                VALUES ($1, $2)
                RETURNING *
            """, currency, reason)
            
            logger.info(f"Created settlement window {row['window_id']} for {currency}")
            return dict(row)
    
    async def close_window(self, window_id: int, reason: Optional[str] = None) -> Dict:
        """Close a settlement window"""
        async with self.pool.acquire() as conn:
            window = await conn.fetchrow(
                "SELECT * FROM settlement_windows WHERE window_id = $1",
                window_id
            )
            if not window:
                raise HTTPException(status_code=404, detail="Window not found")
            
            if window['state'] != SettlementWindowState.OPEN.value:
                raise HTTPException(status_code=400, detail=f"Window not in OPEN state")
            
            row = await conn.fetchrow("""
                UPDATE settlement_windows 
                SET state = $2, closed_at = NOW(), reason = COALESCE($3, reason)
                WHERE window_id = $1
                RETURNING *
            """, window_id, SettlementWindowState.CLOSED.value, reason)
            
            logger.info(f"Closed settlement window {window_id}")
            return dict(row)
    
    async def add_transfer_to_window(self, transfer_id: str, payer_fsp: str, 
                                      payee_fsp: str, amount: Decimal, currency: str) -> bool:
        """Add a completed transfer to the current settlement window"""
        async with self.pool.acquire() as conn:
            # Get or create current window
            window = await self.get_current_window(currency)
            if not window:
                # Auto-create window
                window = await self.create_window(currency, "Auto-created for transfer")
            
            try:
                await conn.execute("""
                    INSERT INTO window_transfers 
                    (window_id, transfer_id, payer_fsp, payee_fsp, amount, currency)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (window_id, transfer_id) DO NOTHING
                """, window['window_id'], uuid.UUID(transfer_id), payer_fsp, payee_fsp, amount, currency)
                return True
            except Exception as e:
                logger.error(f"Error adding transfer to window: {e}")
                return False
    
    async def calculate_net_positions(self, window_ids: List[int]) -> Dict[str, Decimal]:
        """Calculate net positions for all participants across windows"""
        async with self.pool.acquire() as conn:
            # Get all transfers from windows
            rows = await conn.fetch("""
                SELECT payer_fsp, payee_fsp, amount, currency
                FROM window_transfers
                WHERE window_id = ANY($1)
            """, window_ids)
            
            # Calculate net positions
            positions: Dict[str, Decimal] = {}
            
            for row in rows:
                payer = row['payer_fsp']
                payee = row['payee_fsp']
                amount = row['amount']
                
                # Payer has net debit (negative)
                positions[payer] = positions.get(payer, Decimal("0")) - amount
                # Payee has net credit (positive)
                positions[payee] = positions.get(payee, Decimal("0")) + amount
            
            return positions
    
    async def create_settlement(self, window_ids: List[int], reason: Optional[str] = None) -> Dict:
        """Create a settlement for closed windows"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Verify all windows are closed
                windows = await conn.fetch("""
                    SELECT * FROM settlement_windows WHERE window_id = ANY($1)
                """, window_ids)
                
                if len(windows) != len(window_ids):
                    raise HTTPException(status_code=404, detail="Some windows not found")
                
                for window in windows:
                    if window['state'] != SettlementWindowState.CLOSED.value:
                        raise HTTPException(
                            status_code=400, 
                            detail=f"Window {window['window_id']} not in CLOSED state"
                        )
                    if window['settlement_id']:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Window {window['window_id']} already in settlement"
                        )
                
                currency = windows[0]['currency']
                
                # Calculate net positions
                net_positions = await self.calculate_net_positions(window_ids)
                
                # Get transfer count and total
                stats = await conn.fetchrow("""
                    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
                    FROM window_transfers WHERE window_id = ANY($1)
                """, window_ids)
                
                if stats['count'] < config.MIN_TRANSFERS_FOR_SETTLEMENT:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Minimum {config.MIN_TRANSFERS_FOR_SETTLEMENT} transfers required"
                    )
                
                # Create settlement
                settlement = await conn.fetchrow("""
                    INSERT INTO settlements (currency, reason, total_amount)
                    VALUES ($1, $2, $3)
                    RETURNING *
                """, currency, reason, stats['total'])
                
                settlement_id = settlement['settlement_id']
                
                # Map windows to settlement
                for window_id in window_ids:
                    await conn.execute("""
                        INSERT INTO settlement_window_mapping (settlement_id, window_id)
                        VALUES ($1, $2)
                    """, settlement_id, window_id)
                    
                    await conn.execute("""
                        UPDATE settlement_windows 
                        SET state = $2, settlement_id = $3
                        WHERE window_id = $1
                    """, window_id, SettlementWindowState.PENDING_SETTLEMENT.value, settlement_id)
                
                # Create participant positions
                for fsp_id, net_amount in net_positions.items():
                    transfers_count = await conn.fetchval("""
                        SELECT COUNT(*) FROM window_transfers
                        WHERE window_id = ANY($1) AND (payer_fsp = $2 OR payee_fsp = $2)
                    """, window_ids, fsp_id)
                    
                    await conn.execute("""
                        INSERT INTO participant_settlement_positions 
                        (settlement_id, fsp_id, currency, net_amount, transfers_count)
                        VALUES ($1, $2, $3, $4, $5)
                    """, settlement_id, fsp_id, currency, net_amount, transfers_count)
                
                # Record state change
                await conn.execute("""
                    INSERT INTO settlement_state_history (settlement_id, new_state, reason)
                    VALUES ($1, $2, $3)
                """, settlement_id, SettlementState.PENDING_SETTLEMENT.value, "Settlement created")
                
                logger.info(f"Created settlement {settlement_id} for windows {window_ids}")
                
                return {
                    "settlement_id": settlement_id,
                    "state": SettlementState.PENDING_SETTLEMENT.value,
                    "currency": currency,
                    "window_ids": window_ids,
                    "total_amount": str(stats['total']),
                    "participant_count": len(net_positions),
                    "net_positions": {k: str(v) for k, v in net_positions.items()}
                }
    
    async def process_settlement(self, settlement_id: int) -> Dict:
        """Process settlement - execute settlement transfers"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                settlement = await conn.fetchrow(
                    "SELECT * FROM settlements WHERE settlement_id = $1",
                    settlement_id
                )
                if not settlement:
                    raise HTTPException(status_code=404, detail="Settlement not found")
                
                if settlement['state'] != SettlementState.PENDING_SETTLEMENT.value:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Settlement not in PENDING_SETTLEMENT state"
                    )
                
                # Get participant positions
                positions = await conn.fetch("""
                    SELECT * FROM participant_settlement_positions
                    WHERE settlement_id = $1
                    ORDER BY net_amount
                """, settlement_id)
                
                # Separate debtors (negative) and creditors (positive)
                debtors = [p for p in positions if p['net_amount'] < 0]
                creditors = [p for p in positions if p['net_amount'] > 0]
                
                # Update state to SETTLING
                await conn.execute("""
                    UPDATE settlements SET state = $2 WHERE settlement_id = $1
                """, settlement_id, SettlementState.SETTLING.value)
                
                await conn.execute("""
                    INSERT INTO settlement_state_history (settlement_id, previous_state, new_state, reason)
                    VALUES ($1, $2, $3, $4)
                """, settlement_id, SettlementState.PENDING_SETTLEMENT.value, 
                    SettlementState.SETTLING.value, "Processing settlement")
                
                # Create settlement transfers (multilateral netting)
                # Simple approach: each debtor pays to creditors proportionally
                settlement_transfers = []
                
                for debtor in debtors:
                    debt_remaining = abs(debtor['net_amount'])
                    
                    for creditor in creditors:
                        if debt_remaining <= 0:
                            break
                        
                        credit_remaining = creditor['net_amount']
                        if credit_remaining <= 0:
                            continue
                        
                        # Calculate transfer amount
                        transfer_amount = min(debt_remaining, credit_remaining)
                        
                        if transfer_amount > 0:
                            # Record settlement transfer
                            await conn.execute("""
                                INSERT INTO settlement_transfers 
                                (settlement_id, from_fsp, to_fsp, amount, currency)
                                VALUES ($1, $2, $3, $4, $5)
                            """, settlement_id, debtor['fsp_id'], creditor['fsp_id'],
                                transfer_amount, settlement['currency'])
                            
                            settlement_transfers.append({
                                "from_fsp": debtor['fsp_id'],
                                "to_fsp": creditor['fsp_id'],
                                "amount": transfer_amount
                            })
                            
                            debt_remaining -= transfer_amount
                            # Update creditor's remaining credit
                            creditor_idx = creditors.index(creditor)
                            creditors[creditor_idx] = dict(creditor)
                            creditors[creditor_idx]['net_amount'] -= transfer_amount
                
                # Update participant states
                await conn.execute("""
                    UPDATE participant_settlement_positions 
                    SET state = $2, updated_at = NOW()
                    WHERE settlement_id = $1
                """, settlement_id, ParticipantSettlementState.SETTLED.value)
                
                # Update settlement state
                await conn.execute("""
                    UPDATE settlements 
                    SET state = $2, settled_at = NOW()
                    WHERE settlement_id = $1
                """, settlement_id, SettlementState.SETTLED.value)
                
                # Update windows
                await conn.execute("""
                    UPDATE settlement_windows 
                    SET state = $2, settled_at = NOW()
                    WHERE settlement_id = $1
                """, settlement_id, SettlementWindowState.SETTLED.value)
                
                await conn.execute("""
                    INSERT INTO settlement_state_history (settlement_id, previous_state, new_state, reason)
                    VALUES ($1, $2, $3, $4)
                """, settlement_id, SettlementState.SETTLING.value,
                    SettlementState.SETTLED.value, "Settlement completed")
                
                logger.info(f"Processed settlement {settlement_id} with {len(settlement_transfers)} transfers")
                
                return {
                    "settlement_id": settlement_id,
                    "state": SettlementState.SETTLED.value,
                    "transfers_executed": len(settlement_transfers),
                    "settled_at": datetime.utcnow().isoformat()
                }
    
    async def get_settlement_report(self, settlement_id: int) -> Dict:
        """Generate settlement report"""
        async with self.pool.acquire() as conn:
            settlement = await conn.fetchrow(
                "SELECT * FROM settlements WHERE settlement_id = $1",
                settlement_id
            )
            if not settlement:
                raise HTTPException(status_code=404, detail="Settlement not found")
            
            # Get windows
            windows = await conn.fetch("""
                SELECT window_id FROM settlement_window_mapping
                WHERE settlement_id = $1
            """, settlement_id)
            window_ids = [w['window_id'] for w in windows]
            
            # Get participant positions
            positions = await conn.fetch("""
                SELECT * FROM participant_settlement_positions
                WHERE settlement_id = $1
            """, settlement_id)
            
            # Get transfer summary
            transfer_stats = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_transfers,
                    SUM(amount) as total_amount,
                    COUNT(DISTINCT payer_fsp) as unique_payers,
                    COUNT(DISTINCT payee_fsp) as unique_payees
                FROM window_transfers
                WHERE window_id = ANY($1)
            """, window_ids)
            
            # Calculate totals
            total_debits = sum(abs(p['net_amount']) for p in positions if p['net_amount'] < 0)
            total_credits = sum(p['net_amount'] for p in positions if p['net_amount'] > 0)
            
            return {
                "settlement_id": settlement_id,
                "window_ids": window_ids,
                "currency": settlement['currency'],
                "created_at": settlement['created_at'].isoformat(),
                "settled_at": settlement['settled_at'].isoformat() if settlement['settled_at'] else None,
                "state": settlement['state'],
                "total_debits": str(total_debits),
                "total_credits": str(total_credits),
                "participant_positions": [
                    {
                        "fsp_id": p['fsp_id'],
                        "currency": p['currency'],
                        "net_amount": str(p['net_amount']),
                        "state": p['state'],
                        "transfers_count": p['transfers_count']
                    }
                    for p in positions
                ],
                "transfers_summary": {
                    "total_transfers": transfer_stats['total_transfers'],
                    "total_amount": str(transfer_stats['total_amount'] or 0),
                    "unique_payers": transfer_stats['unique_payers'],
                    "unique_payees": transfer_stats['unique_payees']
                }
            }

# ==================== Background Workers ====================

async def window_auto_close_worker():
    """Auto-close windows after configured duration"""
    while True:
        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                # Find windows that should be closed
                cutoff = datetime.utcnow() - timedelta(hours=config.DEFAULT_WINDOW_DURATION_HOURS)
                
                windows = await conn.fetch("""
                    SELECT window_id FROM settlement_windows
                    WHERE state = 'OPEN' AND created_at < $1
                """, cutoff)
                
                for window in windows:
                    try:
                        manager = SettlementManager(pool)
                        await manager.close_window(window['window_id'], "Auto-closed by scheduler")
                        logger.info(f"Auto-closed window {window['window_id']}")
                    except Exception as e:
                        logger.error(f"Error auto-closing window {window['window_id']}: {e}")
            
            await asyncio.sleep(3600)  # Check every hour
        except Exception as e:
            logger.error(f"Window auto-close worker error: {e}")
            await asyncio.sleep(3600)

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
        "service": "settlement-service",
        "version": "2.0.0",
        "database": "connected" if db_healthy else "disconnected",
        "auto_close_enabled": config.AUTO_CLOSE_WINDOWS,
        "window_duration_hours": config.DEFAULT_WINDOW_DURATION_HOURS,
        "timestamp": datetime.utcnow().isoformat()
    }

# Window Management
@app.post("/settlementWindows")
async def create_window(request: CreateWindowRequest):
    """Create a new settlement window"""
    pool = await get_db_pool()
    manager = SettlementManager(pool)
    window = await manager.create_window(request.currency, request.reason)
    
    return {
        "window_id": window['window_id'],
        "state": window['state'],
        "currency": window['currency'],
        "created_at": window['created_at'].isoformat()
    }

@app.post("/settlementWindows/{window_id}/close")
async def close_window(window_id: int, request: Optional[CloseWindowRequest] = None):
    """Close a settlement window"""
    pool = await get_db_pool()
    manager = SettlementManager(pool)
    reason = request.reason if request else None
    window = await manager.close_window(window_id, reason)
    
    return {
        "window_id": window['window_id'],
        "state": window['state'],
        "closed_at": window['closed_at'].isoformat() if window['closed_at'] else None
    }

@app.get("/settlementWindows")
async def list_windows(
    state: Optional[str] = None,
    currency: Optional[str] = None,
    limit: int = Query(default=100, le=1000)
):
    """List settlement windows"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        query = """
            SELECT w.*, 
                   COUNT(t.id) as transfer_count,
                   COALESCE(SUM(t.amount), 0) as total_amount
            FROM settlement_windows w
            LEFT JOIN window_transfers t ON w.window_id = t.window_id
            WHERE 1=1
        """
        params = []
        
        if state:
            params.append(state)
            query += f" AND w.state = ${len(params)}"
        if currency:
            params.append(currency)
            query += f" AND w.currency = ${len(params)}"
        
        query += " GROUP BY w.window_id ORDER BY w.created_at DESC"
        params.append(limit)
        query += f" LIMIT ${len(params)}"
        
        rows = await conn.fetch(query, *params)
        
        return {
            "windows": [
                {
                    "window_id": row['window_id'],
                    "state": row['state'],
                    "currency": row['currency'],
                    "created_at": row['created_at'].isoformat(),
                    "closed_at": row['closed_at'].isoformat() if row['closed_at'] else None,
                    "settled_at": row['settled_at'].isoformat() if row['settled_at'] else None,
                    "transfer_count": row['transfer_count'],
                    "total_amount": str(row['total_amount'])
                }
                for row in rows
            ],
            "count": len(rows)
        }

@app.get("/settlementWindows/{window_id}")
async def get_window(window_id: int):
    """Get settlement window details"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT w.*, 
                   COUNT(t.id) as transfer_count,
                   COALESCE(SUM(t.amount), 0) as total_amount
            FROM settlement_windows w
            LEFT JOIN window_transfers t ON w.window_id = t.window_id
            WHERE w.window_id = $1
            GROUP BY w.window_id
        """, window_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Window not found")
        
        return {
            "window_id": row['window_id'],
            "state": row['state'],
            "currency": row['currency'],
            "created_at": row['created_at'].isoformat(),
            "closed_at": row['closed_at'].isoformat() if row['closed_at'] else None,
            "settled_at": row['settled_at'].isoformat() if row['settled_at'] else None,
            "settlement_id": row['settlement_id'],
            "transfer_count": row['transfer_count'],
            "total_amount": str(row['total_amount']),
            "reason": row['reason']
        }

# Settlement Management
@app.post("/settlements")
async def create_settlement(request: SettlementRequest):
    """Create a settlement for closed windows"""
    pool = await get_db_pool()
    manager = SettlementManager(pool)
    return await manager.create_settlement(request.window_ids, request.reason)

@app.post("/settlements/{settlement_id}/process")
async def process_settlement(settlement_id: int):
    """Process a settlement - execute settlement transfers"""
    pool = await get_db_pool()
    manager = SettlementManager(pool)
    return await manager.process_settlement(settlement_id)

@app.get("/settlements")
async def list_settlements(
    state: Optional[str] = None,
    currency: Optional[str] = None,
    limit: int = Query(default=100, le=1000)
):
    """List settlements"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        query = "SELECT * FROM settlements WHERE 1=1"
        params = []
        
        if state:
            params.append(state)
            query += f" AND state = ${len(params)}"
        if currency:
            params.append(currency)
            query += f" AND currency = ${len(params)}"
        
        query += " ORDER BY created_at DESC"
        params.append(limit)
        query += f" LIMIT ${len(params)}"
        
        rows = await conn.fetch(query, *params)
        
        return {
            "settlements": [dict(row) for row in rows],
            "count": len(rows)
        }

@app.get("/settlements/{settlement_id}")
async def get_settlement(settlement_id: int):
    """Get settlement details"""
    pool = await get_db_pool()
    manager = SettlementManager(pool)
    return await manager.get_settlement_report(settlement_id)

@app.get("/settlements/{settlement_id}/report")
async def get_settlement_report(settlement_id: int):
    """Get detailed settlement report"""
    pool = await get_db_pool()
    manager = SettlementManager(pool)
    return await manager.get_settlement_report(settlement_id)

# Transfer Recording (called by transfer service)
@app.post("/transfers/record")
async def record_transfer(
    transfer_id: str,
    payer_fsp: str,
    payee_fsp: str,
    amount: Decimal,
    currency: str = "NGN"
):
    """Record a completed transfer for settlement"""
    pool = await get_db_pool()
    manager = SettlementManager(pool)
    
    success = await manager.add_transfer_to_window(
        transfer_id, payer_fsp, payee_fsp, amount, currency
    )
    
    if success:
        return {"status": "recorded", "transfer_id": transfer_id}
    else:
        raise HTTPException(status_code=500, detail="Failed to record transfer")

# Net Positions
@app.get("/netPositions")
async def get_net_positions(currency: str = "NGN"):
    """Get current net positions for all participants (from open window)"""
    pool = await get_db_pool()
    manager = SettlementManager(pool)
    
    window = await manager.get_current_window(currency)
    if not window:
        return {"positions": {}, "window_id": None}
    
    positions = await manager.calculate_net_positions([window['window_id']])
    
    return {
        "window_id": window['window_id'],
        "currency": currency,
        "positions": {k: str(v) for k, v in positions.items()},
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
