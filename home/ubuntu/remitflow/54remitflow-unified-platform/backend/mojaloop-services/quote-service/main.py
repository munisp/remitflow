"""
Production-Ready Mojaloop Quote Service
Calculates fees and commissions for transfers with PostgreSQL persistence
Implements FSPIOP API v1.1 compliant quote management
"""

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from decimal import Decimal
from contextlib import asynccontextmanager
import uuid
import base64
import hashlib
import os
import json
import logging
import asyncpg

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
class Config:
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://mojaloop:mojaloop@localhost:5432/mojaloop")
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
    QUOTE_EXPIRY_MINUTES = int(os.getenv("QUOTE_EXPIRY_MINUTES", "5"))

config = Config()

# Database connection pool
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
    await load_fee_configurations(pool)
    logger.info("Quote service started with PostgreSQL persistence")
    yield
    if db_pool:
        await db_pool.close()

app = FastAPI(
    title="Mojaloop Quote Service",
    description="Production-ready quote service with PostgreSQL and dynamic fee configuration",
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

class Money(BaseModel):
    currency: str
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

class GeoCode(BaseModel):
    latitude: str
    longitude: str

class PartyIdInfo(BaseModel):
    partyIdType: str
    partyIdentifier: str
    partySubIdOrType: Optional[str] = None
    fspId: Optional[str] = None

class Party(BaseModel):
    partyIdInfo: PartyIdInfo
    name: Optional[str] = None

class TransactionType(BaseModel):
    scenario: str
    initiator: str
    initiatorType: str

class QuoteRequest(BaseModel):
    quoteId: str
    transactionId: str
    payee: Party
    payer: Party
    amountType: str
    amount: Money
    transactionType: TransactionType
    note: Optional[str] = None
    geoCode: Optional[GeoCode] = None
    expiration: Optional[str] = None
    
    @validator('quoteId')
    def validate_quote_id(cls, v):
        try:
            uuid.UUID(v)
            return v
        except:
            raise ValueError("quoteId must be a valid UUID")

class QuoteResponse(BaseModel):
    transferAmount: Money
    payeeReceiveAmount: Optional[Money] = None
    payeeFspFee: Optional[Money] = None
    payeeFspCommission: Optional[Money] = None
    expiration: str
    ilpPacket: str
    condition: str

# Database initialization
async def initialize_database(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS quotes (
                quote_id UUID PRIMARY KEY,
                transaction_id UUID NOT NULL,
                payer_fsp VARCHAR(255) NOT NULL,
                payee_fsp VARCHAR(255) NOT NULL,
                amount DECIMAL(18, 4) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                amount_type VARCHAR(10) NOT NULL,
                transfer_amount DECIMAL(18, 4),
                payee_receive_amount DECIMAL(18, 4),
                fee_amount DECIMAL(18, 4),
                commission_amount DECIMAL(18, 4),
                ilp_packet TEXT,
                condition VARCHAR(64),
                fulfilment VARCHAR(64),
                expiration TIMESTAMP WITH TIME ZONE,
                state VARCHAR(20) DEFAULT 'PENDING',
                error_code VARCHAR(10),
                error_description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                metadata JSONB DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_quotes_transaction ON quotes(transaction_id);
            CREATE INDEX IF NOT EXISTS idx_quotes_state ON quotes(state);
            CREATE INDEX IF NOT EXISTS idx_quotes_expiration ON quotes(expiration);
            
            CREATE TABLE IF NOT EXISTS fee_configurations (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255),
                currency VARCHAR(3) NOT NULL,
                transaction_type VARCHAR(50),
                fixed_fee DECIMAL(18, 4) NOT NULL DEFAULT 10.00,
                percentage_fee DECIMAL(8, 6) NOT NULL DEFAULT 0.01,
                min_fee DECIMAL(18, 4) NOT NULL DEFAULT 5.00,
                max_fee DECIMAL(18, 4) NOT NULL DEFAULT 1000.00,
                commission_rate DECIMAL(8, 6) NOT NULL DEFAULT 0.005,
                effective_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                effective_to TIMESTAMP WITH TIME ZONE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(fsp_id, currency, transaction_type, effective_from)
            );
            
            -- Insert default fee configuration if not exists
            INSERT INTO fee_configurations (fsp_id, currency, transaction_type, fixed_fee, percentage_fee, min_fee, max_fee, commission_rate)
            VALUES (NULL, 'NGN', NULL, 10.00, 0.01, 5.00, 1000.00, 0.005)
            ON CONFLICT DO NOTHING;
            
            INSERT INTO fee_configurations (fsp_id, currency, transaction_type, fixed_fee, percentage_fee, min_fee, max_fee, commission_rate)
            VALUES (NULL, 'USD', NULL, 1.00, 0.01, 0.50, 100.00, 0.005)
            ON CONFLICT DO NOTHING;
            
            INSERT INTO fee_configurations (fsp_id, currency, transaction_type, fixed_fee, percentage_fee, min_fee, max_fee, commission_rate)
            VALUES (NULL, 'KES', NULL, 50.00, 0.01, 25.00, 5000.00, 0.005)
            ON CONFLICT DO NOTHING;
        """)
        logger.info("Quote database schema initialized")

# Fee configuration cache
fee_configs: Dict[str, Dict] = {}

async def load_fee_configurations(pool: asyncpg.Pool):
    """Load fee configurations from database into cache"""
    global fee_configs
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM fee_configurations WHERE is_active = TRUE
            AND (effective_to IS NULL OR effective_to > NOW())
        """)
        for row in rows:
            key = f"{row['fsp_id'] or 'default'}_{row['currency']}_{row['transaction_type'] or 'default'}"
            fee_configs[key] = {
                "fixed_fee": row['fixed_fee'],
                "percentage_fee": row['percentage_fee'],
                "min_fee": row['min_fee'],
                "max_fee": row['max_fee'],
                "commission_rate": row['commission_rate']
            }
    logger.info(f"Loaded {len(fee_configs)} fee configurations")

def get_fee_config(fsp_id: Optional[str], currency: str, transaction_type: Optional[str]) -> Dict:
    """Get fee configuration with fallback to defaults"""
    # Try specific FSP + currency + type
    key = f"{fsp_id}_{currency}_{transaction_type}"
    if key in fee_configs:
        return fee_configs[key]
    
    # Try FSP + currency
    key = f"{fsp_id}_{currency}_default"
    if key in fee_configs:
        return fee_configs[key]
    
    # Try default + currency
    key = f"default_{currency}_default"
    if key in fee_configs:
        return fee_configs[key]
    
    # Return hardcoded defaults
    return {
        "fixed_fee": Decimal("10.00"),
        "percentage_fee": Decimal("0.01"),
        "min_fee": Decimal("5.00"),
        "max_fee": Decimal("1000.00"),
        "commission_rate": Decimal("0.005")
    }

# Quote repository with PostgreSQL
class QuoteRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def create(self, quote_data: Dict[str, Any]) -> Dict[str, Any]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO quotes (quote_id, transaction_id, payer_fsp, payee_fsp, amount, currency,
                    amount_type, transfer_amount, payee_receive_amount, fee_amount, commission_amount,
                    ilp_packet, condition, expiration, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING *
            """, uuid.UUID(quote_data['quote_id']), uuid.UUID(quote_data['transaction_id']),
                quote_data['payer_fsp'], quote_data['payee_fsp'], quote_data['amount'],
                quote_data['currency'], quote_data['amount_type'], quote_data['transfer_amount'],
                quote_data['payee_receive_amount'], quote_data['fee_amount'], quote_data['commission_amount'],
                quote_data['ilp_packet'], quote_data['condition'], quote_data['expiration'],
                json.dumps(quote_data.get('metadata', {})))
            return dict(row) if row else None
    
    async def get_by_id(self, quote_id: str) -> Optional[Dict[str, Any]]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM quotes WHERE quote_id = $1", uuid.UUID(quote_id))
            return dict(row) if row else None
    
    async def update(self, quote_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                UPDATE quotes SET state = COALESCE($2, state), fulfilment = COALESCE($3, fulfilment),
                    error_code = COALESCE($4, error_code), error_description = COALESCE($5, error_description),
                    updated_at = NOW()
                WHERE quote_id = $1 RETURNING *
            """, uuid.UUID(quote_id), updates.get('state'), updates.get('fulfilment'),
                updates.get('error_code'), updates.get('error_description'))
            return dict(row) if row else None
    
    async def exists(self, quote_id: str) -> bool:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT 1 FROM quotes WHERE quote_id = $1", uuid.UUID(quote_id))
            return row is not None

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
        "service": "quote-service",
        "version": "2.0.0",
        "database": "connected" if db_healthy else "disconnected",
        "fee_configs_loaded": len(fee_configs),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/quotes")
async def create_quote(
    quote: QuoteRequest,
    fspiop_source: str = Header(..., alias="FSPIOP-Source"),
    fspiop_destination: str = Header(..., alias="FSPIOP-Destination")
):
    """Mojaloop API: Create a quote for a transfer with dynamic fee calculation"""
    pool = await get_db_pool()
    repo = QuoteRepository(pool)
    
    if await repo.exists(quote.quoteId):
        raise HTTPException(status_code=400, detail={
            "errorInformation": {"errorCode": "3100", "errorDescription": "Quote already exists"}
        })
    
    # Get fee configuration for this FSP/currency/transaction type
    fee_config = get_fee_config(
        quote.payee.partyIdInfo.fspId,
        quote.amount.currency,
        quote.transactionType.scenario
    )
    
    amount = Decimal(quote.amount.amount)
    percentage_fee = amount * Decimal(str(fee_config["percentage_fee"]))
    total_fee = Decimal(str(fee_config["fixed_fee"])) + percentage_fee
    total_fee = max(Decimal(str(fee_config["min_fee"])), min(total_fee, Decimal(str(fee_config["max_fee"]))))
    commission = amount * Decimal(str(fee_config["commission_rate"]))
    
    if quote.amountType == "SEND":
        transfer_amount = amount
        payee_receive_amount = amount - total_fee
    else:
        transfer_amount = amount + total_fee
        payee_receive_amount = amount
    
    ilp_packet = generate_ilp_packet(quote)
    condition = generate_condition(ilp_packet)
    expiration = datetime.utcnow() + timedelta(minutes=config.QUOTE_EXPIRY_MINUTES)
    
    quote_data = {
        'quote_id': quote.quoteId,
        'transaction_id': quote.transactionId,
        'payer_fsp': fspiop_source,
        'payee_fsp': fspiop_destination,
        'amount': amount,
        'currency': quote.amount.currency,
        'amount_type': quote.amountType,
        'transfer_amount': transfer_amount,
        'payee_receive_amount': payee_receive_amount,
        'fee_amount': total_fee,
        'commission_amount': commission,
        'ilp_packet': ilp_packet,
        'condition': condition,
        'expiration': expiration,
        'metadata': {'payer': quote.payer.dict(), 'payee': quote.payee.dict()}
    }
    
    await repo.create(quote_data)
    
    return {
        "quoteId": quote.quoteId,
        "transactionId": quote.transactionId,
        "transferAmount": {"currency": quote.amount.currency, "amount": str(transfer_amount)},
        "payeeReceiveAmount": {"currency": quote.amount.currency, "amount": str(payee_receive_amount)},
        "payeeFspFee": {"currency": quote.amount.currency, "amount": str(total_fee)},
        "payeeFspCommission": {"currency": quote.amount.currency, "amount": str(commission)},
        "expiration": expiration.isoformat() + "Z",
        "ilpPacket": ilp_packet,
        "condition": condition
    }

@app.put("/quotes/{quoteId}")
async def update_quote(
    quoteId: str,
    quote_response: QuoteResponse,
    fspiop_source: str = Header(..., alias="FSPIOP-Source"),
    fspiop_destination: str = Header(..., alias="FSPIOP-Destination")
):
    """Mojaloop API: Update a quote (callback from payee FSP)"""
    pool = await get_db_pool()
    repo = QuoteRepository(pool)
    
    if not await repo.exists(quoteId):
        raise HTTPException(status_code=404, detail={
            "errorInformation": {"errorCode": "3205", "errorDescription": "Quote not found"}
        })
    
    await repo.update(quoteId, {'state': 'ACCEPTED'})
    return {"status": "updated"}

@app.get("/quotes/{quoteId}")
async def get_quote(quoteId: str, fspiop_source: Optional[str] = Header(None, alias="FSPIOP-Source")):
    """Mojaloop API: Get quote details"""
    pool = await get_db_pool()
    repo = QuoteRepository(pool)
    
    quote = await repo.get_by_id(quoteId)
    if not quote:
        raise HTTPException(status_code=404, detail={
            "errorInformation": {"errorCode": "3205", "errorDescription": "Quote not found"}
        })
    
    return {
        "quoteId": str(quote['quote_id']),
        "transactionId": str(quote['transaction_id']),
        "transferAmount": {"currency": quote['currency'], "amount": str(quote['transfer_amount'])},
        "payeeReceiveAmount": {"currency": quote['currency'], "amount": str(quote['payee_receive_amount'])},
        "payeeFspFee": {"currency": quote['currency'], "amount": str(quote['fee_amount'])},
        "payeeFspCommission": {"currency": quote['currency'], "amount": str(quote['commission_amount'])},
        "expiration": quote['expiration'].isoformat() + "Z" if quote['expiration'] else None,
        "ilpPacket": quote['ilp_packet'],
        "condition": quote['condition'],
        "state": quote['state']
    }

@app.post("/quotes/{quoteId}/error")
async def quote_error(quoteId: str, error: Dict):
    """Mojaloop API: Handle quote errors"""
    pool = await get_db_pool()
    repo = QuoteRepository(pool)
    
    if await repo.exists(quoteId):
        await repo.update(quoteId, {
            'state': 'ERROR',
            'error_code': error.get('errorCode'),
            'error_description': error.get('errorDescription')
        })
    return {"status": "error_received"}

def generate_ilp_packet(quote: QuoteRequest) -> str:
    """Generate proper ILP packet with JSON encoding"""
    packet_data = {
        "transactionId": quote.transactionId,
        "quoteId": quote.quoteId,
        "payee": quote.payee.dict(),
        "payer": quote.payer.dict(),
        "amount": quote.amount.dict(),
        "transactionType": quote.transactionType.dict()
    }
    packet_json = json.dumps(packet_data, separators=(',', ':'))
    return base64.urlsafe_b64encode(packet_json.encode()).decode().rstrip('=')

def generate_condition(ilp_packet: str) -> str:
    """Generate condition using proper SHA-256 of fulfilment"""
    fulfilment = hashlib.sha256(ilp_packet.encode()).digest()
    condition = hashlib.sha256(fulfilment).digest()
    return base64.urlsafe_b64encode(condition).decode().rstrip('=')

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)
