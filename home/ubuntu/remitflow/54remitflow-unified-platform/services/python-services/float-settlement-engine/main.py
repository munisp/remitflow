#!/usr/bin/env python3
"""
Float Settlement Engine Service
Automated settlement processing for float management operations
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from decimal import Decimal
import asyncpg
import aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from enum import Enum

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8121"))

# FastAPI app
app = FastAPI(
    title="Float Settlement Engine",
    description="Automated settlement processing for float management operations",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
db_pool = None
redis_client = None

# Enums
class SettlementStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class SettlementType(str, Enum):
    AGENT_TO_BANK = "AGENT_TO_BANK"
    BANK_TO_AGENT = "BANK_TO_AGENT"
    AGENT_TO_AGENT = "AGENT_TO_AGENT"
    BULK_SETTLEMENT = "BULK_SETTLEMENT"

# Pydantic models
class SettlementRequest(BaseModel):
    settlement_id: str
    settlement_type: SettlementType
    source_agent_id: Optional[str] = None
    destination_agent_id: Optional[str] = None
    bank_account_id: Optional[str] = None
    amount: Decimal
    currency: str = "NGN"
    reference: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class SettlementResponse(BaseModel):
    settlement_id: str
    status: SettlementStatus
    amount: Decimal
    currency: str
    processing_fee: Decimal
    net_amount: Decimal
    created_at: datetime
    processed_at: Optional[datetime] = None
    reference: Optional[str] = None
    transaction_hash: Optional[str] = None

class BulkSettlementRequest(BaseModel):
    batch_id: str
    settlements: List[SettlementRequest]
    processing_mode: str = "PARALLEL"  # PARALLEL or SEQUENTIAL

class SettlementSummary(BaseModel):
    total_settlements: int
    completed_settlements: int
    failed_settlements: int
    total_amount: Decimal
    total_fees: Decimal
    success_rate: float

# Database functions
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS float_settlements (
                    id SERIAL PRIMARY KEY,
                    settlement_id VARCHAR(255) UNIQUE NOT NULL,
                    settlement_type VARCHAR(50) NOT NULL,
                    source_agent_id VARCHAR(255),
                    destination_agent_id VARCHAR(255),
                    bank_account_id VARCHAR(255),
                    amount DECIMAL(15,2) NOT NULL,
                    currency VARCHAR(10) DEFAULT 'NGN',
                    processing_fee DECIMAL(15,2) DEFAULT 0,
                    net_amount DECIMAL(15,2) NOT NULL,
                    status VARCHAR(20) DEFAULT 'PENDING',
                    reference VARCHAR(255),
                    transaction_hash VARCHAR(255),
                    metadata JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed_at TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_settlement_id (settlement_id),
                    INDEX idx_status (status),
                    INDEX idx_source_agent (source_agent_id),
                    INDEX idx_destination_agent (destination_agent_id),
                    INDEX idx_created_at (created_at)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS settlement_batches (
                    id SERIAL PRIMARY KEY,
                    batch_id VARCHAR(255) UNIQUE NOT NULL,
                    total_settlements INTEGER DEFAULT 0,
                    completed_settlements INTEGER DEFAULT 0,
                    failed_settlements INTEGER DEFAULT 0,
                    total_amount DECIMAL(15,2) DEFAULT 0,
                    total_fees DECIMAL(15,2) DEFAULT 0,
                    processing_mode VARCHAR(20) DEFAULT 'PARALLEL',
                    status VARCHAR(20) DEFAULT 'PENDING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    INDEX idx_batch_id (batch_id),
                    INDEX idx_status (status)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS settlement_logs (
                    id SERIAL PRIMARY KEY,
                    settlement_id VARCHAR(255) NOT NULL,
                    event_type VARCHAR(50) NOT NULL,
                    event_data JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_settlement_id (settlement_id),
                    INDEX idx_event_type (event_type)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_balances (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(255) UNIQUE NOT NULL,
                    available_balance DECIMAL(15,2) DEFAULT 0,
                    pending_balance DECIMAL(15,2) DEFAULT 0,
                    reserved_balance DECIMAL(15,2) DEFAULT 0,
                    currency VARCHAR(10) DEFAULT 'NGN',
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_agent_id (agent_id)
                )
            """)
        
        logger.info("Database initialized successfully")
        
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise

async def init_redis():
    """Initialize Redis connection"""
    global redis_client
    
    try:
        redis_client = await aioredis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Redis connection established")
        
    except Exception as e:
        logger.error(f"Redis initialization failed: {e}")
        raise

# Settlement processing functions
class FloatSettlementEngine:
    """Main settlement processing engine"""
    
    def __init__(self):
        self.processing_queue = asyncio.Queue()
        self.is_processing = False
        
    async def start_processing(self):
        """Start background settlement processing"""
        if not self.is_processing:
            self.is_processing = True
            asyncio.create_task(self._process_settlements())
            logger.info("Settlement processing started")
    
    async def stop_processing(self):
        """Stop background settlement processing"""
        self.is_processing = False
        logger.info("Settlement processing stopped")
    
    async def _process_settlements(self):
        """Background task to process settlements"""
        while self.is_processing:
            try:
                # Get pending settlements
                pending_settlements = await self._get_pending_settlements()
                
                for settlement in pending_settlements:
                    await self._process_single_settlement(settlement)
                
                # Wait before next cycle
                await asyncio.sleep(5)
                
            except Exception as e:
                logger.error(f"Settlement processing error: {e}")
                await asyncio.sleep(10)
    
    async def _get_pending_settlements(self) -> List[Dict]:
        """Get pending settlements from database"""
        try:
            async with db_pool.acquire() as conn:
                settlements = await conn.fetch("""
                    SELECT * FROM float_settlements 
                    WHERE status = 'PENDING' 
                    ORDER BY created_at ASC 
                    LIMIT 50
                """)
                
                return [dict(settlement) for settlement in settlements]
                
        except Exception as e:
            logger.error(f"Failed to get pending settlements: {e}")
            return []
    
    async def create_settlement(self, request: SettlementRequest) -> SettlementResponse:
        """Create a new settlement"""
        try:
            # Calculate processing fee
            processing_fee = self._calculate_processing_fee(request.amount, request.settlement_type)
            net_amount = request.amount - processing_fee
            
            # Validate settlement
            await self._validate_settlement(request)
            
            # Create settlement record
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO float_settlements 
                    (settlement_id, settlement_type, source_agent_id, destination_agent_id, 
                     bank_account_id, amount, currency, processing_fee, net_amount, 
                     reference, metadata, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING')
                """, 
                request.settlement_id, request.settlement_type.value,
                request.source_agent_id, request.destination_agent_id,
                request.bank_account_id, request.amount, request.currency,
                processing_fee, net_amount, request.reference,
                json.dumps(request.metadata) if request.metadata else None
                )
                
                # Log creation
                await self._log_settlement_event(
                    request.settlement_id, 
                    "CREATED", 
                    {"amount": str(request.amount), "type": request.settlement_type.value}
                )
            
            # Cache in Redis
            await redis_client.setex(
                f"settlement:{request.settlement_id}",
                3600,  # 1 hour TTL
                json.dumps({
                    "settlement_id": request.settlement_id,
                    "status": "PENDING",
                    "amount": str(request.amount),
                    "created_at": datetime.now().isoformat()
                })
            )
            
            return SettlementResponse(
                settlement_id=request.settlement_id,
                status=SettlementStatus.PENDING,
                amount=request.amount,
                currency=request.currency,
                processing_fee=processing_fee,
                net_amount=net_amount,
                created_at=datetime.now(),
                reference=request.reference
            )
            
        except Exception as e:
            logger.error(f"Failed to create settlement: {e}")
            raise HTTPException(status_code=500, detail=f"Settlement creation failed: {str(e)}")
    
    async def _validate_settlement(self, request: SettlementRequest):
        """Validate settlement request"""
        # Check if settlement already exists
        async with db_pool.acquire() as conn:
            existing = await conn.fetchval(
                "SELECT settlement_id FROM float_settlements WHERE settlement_id = $1",
                request.settlement_id
            )
            
            if existing:
                raise HTTPException(status_code=400, detail="Settlement already exists")
        
        # Validate amount
        if request.amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        
        # Validate agent balances for agent-to-agent transfers
        if request.settlement_type == SettlementType.AGENT_TO_AGENT:
            if not request.source_agent_id or not request.destination_agent_id:
                raise HTTPException(status_code=400, detail="Source and destination agents required")
            
            # Check source agent balance
            source_balance = await self._get_agent_balance(request.source_agent_id)
            if source_balance < request.amount:
                raise HTTPException(status_code=400, detail="Insufficient balance")
    
    async def _process_single_settlement(self, settlement: Dict):
        """Process a single settlement"""
        settlement_id = settlement['settlement_id']
        
        try:
            # Update status to processing
            await self._update_settlement_status(settlement_id, SettlementStatus.PROCESSING)
            
            # Process based on settlement type
            settlement_type = SettlementType(settlement['settlement_type'])
            
            if settlement_type == SettlementType.AGENT_TO_BANK:
                await self._process_agent_to_bank(settlement)
            elif settlement_type == SettlementType.BANK_TO_AGENT:
                await self._process_bank_to_agent(settlement)
            elif settlement_type == SettlementType.AGENT_TO_AGENT:
                await self._process_agent_to_agent(settlement)
            elif settlement_type == SettlementType.BULK_SETTLEMENT:
                await self._process_bulk_settlement(settlement)
            
            # Mark as completed
            await self._update_settlement_status(settlement_id, SettlementStatus.COMPLETED)
            await self._log_settlement_event(settlement_id, "COMPLETED", {"net_amount": str(settlement['net_amount'])})
            
            logger.info(f"Settlement {settlement_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Settlement {settlement_id} failed: {e}")
            await self._update_settlement_status(settlement_id, SettlementStatus.FAILED)
            await self._log_settlement_event(settlement_id, "FAILED", {"error": str(e)})
    
    async def _process_agent_to_bank(self, settlement: Dict):
        """Process agent to bank settlement"""
        agent_id = settlement['source_agent_id']
        amount = settlement['net_amount']
        
        # Debit agent balance
        await self._update_agent_balance(agent_id, -amount)
        
        # Simulate bank transfer (in production, integrate with bank API)
        await asyncio.sleep(1)  # Simulate processing time
        
        # Generate transaction hash
        transaction_hash = f"ATB_{settlement['settlement_id']}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # Update settlement with transaction hash
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE float_settlements 
                SET transaction_hash = $1, processed_at = CURRENT_TIMESTAMP
                WHERE settlement_id = $2
            """, transaction_hash, settlement['settlement_id'])
    
    async def _process_bank_to_agent(self, settlement: Dict):
        """Process bank to agent settlement"""
        agent_id = settlement['destination_agent_id']
        amount = settlement['net_amount']
        
        # Simulate bank verification (in production, verify bank transfer)
        await asyncio.sleep(1)
        
        # Credit agent balance
        await self._update_agent_balance(agent_id, amount)
        
        # Generate transaction hash
        transaction_hash = f"BTA_{settlement['settlement_id']}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # Update settlement
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE float_settlements 
                SET transaction_hash = $1, processed_at = CURRENT_TIMESTAMP
                WHERE settlement_id = $2
            """, transaction_hash, settlement['settlement_id'])
    
    async def _process_agent_to_agent(self, settlement: Dict):
        """Process agent to agent settlement"""
        source_agent = settlement['source_agent_id']
        dest_agent = settlement['destination_agent_id']
        amount = settlement['net_amount']
        
        # Atomic transfer
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                # Debit source
                await self._update_agent_balance(source_agent, -amount)
                
                # Credit destination
                await self._update_agent_balance(dest_agent, amount)
        
        # Generate transaction hash
        transaction_hash = f"ATA_{settlement['settlement_id']}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # Update settlement
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE float_settlements 
                SET transaction_hash = $1, processed_at = CURRENT_TIMESTAMP
                WHERE settlement_id = $2
            """, transaction_hash, settlement['settlement_id'])
    
    async def _process_bulk_settlement(self, settlement: Dict):
        """Process bulk settlement"""
        # This would handle multiple settlements in a batch
        await asyncio.sleep(2)  # Simulate bulk processing
        
        transaction_hash = f"BULK_{settlement['settlement_id']}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE float_settlements 
                SET transaction_hash = $1, processed_at = CURRENT_TIMESTAMP
                WHERE settlement_id = $2
            """, transaction_hash, settlement['settlement_id'])
    
    async def _update_settlement_status(self, settlement_id: str, status: SettlementStatus):
        """Update settlement status"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE float_settlements 
                SET status = $1, updated_at = CURRENT_TIMESTAMP
                WHERE settlement_id = $2
            """, status.value, settlement_id)
        
        # Update Redis cache
        cached_data = await redis_client.get(f"settlement:{settlement_id}")
        if cached_data:
            data = json.loads(cached_data)
            data['status'] = status.value
            await redis_client.setex(f"settlement:{settlement_id}", 3600, json.dumps(data))
    
    async def _log_settlement_event(self, settlement_id: str, event_type: str, event_data: Dict):
        """Log settlement event"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO settlement_logs (settlement_id, event_type, event_data)
                VALUES ($1, $2, $3)
            """, settlement_id, event_type, json.dumps(event_data))
    
    async def _get_agent_balance(self, agent_id: str) -> Decimal:
        """Get agent available balance"""
        async with db_pool.acquire() as conn:
            balance = await conn.fetchval("""
                SELECT available_balance FROM agent_balances WHERE agent_id = $1
            """, agent_id)
            
            return Decimal(balance) if balance else Decimal('0')
    
    async def _update_agent_balance(self, agent_id: str, amount: Decimal):
        """Update agent balance"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO agent_balances (agent_id, available_balance)
                VALUES ($1, $2)
                ON CONFLICT (agent_id) DO UPDATE SET
                available_balance = agent_balances.available_balance + EXCLUDED.available_balance,
                last_updated = CURRENT_TIMESTAMP
            """, agent_id, amount)
    
    def _calculate_processing_fee(self, amount: Decimal, settlement_type: SettlementType) -> Decimal:
        """Calculate processing fee"""
        fee_rates = {
            SettlementType.AGENT_TO_BANK: Decimal('0.01'),  # 1%
            SettlementType.BANK_TO_AGENT: Decimal('0.005'), # 0.5%
            SettlementType.AGENT_TO_AGENT: Decimal('0.002'), # 0.2%
            SettlementType.BULK_SETTLEMENT: Decimal('0.001') # 0.1%
        }
        
        rate = fee_rates.get(settlement_type, Decimal('0.01'))
        fee = amount * rate
        
        # Minimum fee of 10 NGN
        return max(fee, Decimal('10'))
    
    async def process_bulk_settlements(self, request: BulkSettlementRequest) -> Dict:
        """Process bulk settlements"""
        try:
            # Create batch record
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO settlement_batches 
                    (batch_id, total_settlements, processing_mode, status)
                    VALUES ($1, $2, $3, 'PROCESSING')
                """, request.batch_id, len(request.settlements), request.processing_mode)
            
            results = []
            
            if request.processing_mode == "PARALLEL":
                # Process settlements in parallel
                tasks = [self.create_settlement(settlement) for settlement in request.settlements]
                results = await asyncio.gather(*tasks, return_exceptions=True)
            else:
                # Process settlements sequentially
                for settlement in request.settlements:
                    try:
                        result = await self.create_settlement(settlement)
                        results.append(result)
                    except Exception as e:
                        results.append(e)
            
            # Update batch status
            completed = sum(1 for r in results if not isinstance(r, Exception))
            failed = len(results) - completed
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE settlement_batches 
                    SET completed_settlements = $1, failed_settlements = $2, 
                        status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
                    WHERE batch_id = $3
                """, completed, failed, request.batch_id)
            
            return {
                "batch_id": request.batch_id,
                "total_settlements": len(request.settlements),
                "completed_settlements": completed,
                "failed_settlements": failed,
                "success_rate": completed / len(request.settlements) * 100,
                "results": [r.dict() if not isinstance(r, Exception) else str(r) for r in results]
            }
            
        except Exception as e:
            logger.error(f"Bulk settlement processing failed: {e}")
            raise HTTPException(status_code=500, detail=f"Bulk processing failed: {str(e)}")

# Initialize settlement engine
settlement_engine = FloatSettlementEngine()

# API endpoints
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    await init_database()
    await init_redis()
    await settlement_engine.start_processing()

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    await settlement_engine.stop_processing()
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check database
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        # Check Redis
        await redis_client.ping()
        
        return {
            "status": "healthy",
            "service": "float-settlement-engine",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "processing": settlement_engine.is_processing
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/settlements", response_model=SettlementResponse)
async def create_settlement(request: SettlementRequest):
    """Create a new settlement"""
    return await settlement_engine.create_settlement(request)

@app.post("/api/v1/bulk-settlements")
async def process_bulk_settlements(request: BulkSettlementRequest):
    """Process bulk settlements"""
    return await settlement_engine.process_bulk_settlements(request)

@app.get("/api/v1/settlements/{settlement_id}")
async def get_settlement(settlement_id: str):
    """Get settlement by ID"""
    try:
        # Check Redis cache first
        cached_data = await redis_client.get(f"settlement:{settlement_id}")
        if cached_data:
            return json.loads(cached_data)
        
        # Get from database
        async with db_pool.acquire() as conn:
            settlement = await conn.fetchrow("""
                SELECT * FROM float_settlements WHERE settlement_id = $1
            """, settlement_id)
            
            if not settlement:
                raise HTTPException(status_code=404, detail="Settlement not found")
            
            return {
                "settlement_id": settlement['settlement_id'],
                "status": settlement['status'],
                "amount": float(settlement['amount']),
                "currency": settlement['currency'],
                "processing_fee": float(settlement['processing_fee']),
                "net_amount": float(settlement['net_amount']),
                "created_at": settlement['created_at'].isoformat(),
                "processed_at": settlement['processed_at'].isoformat() if settlement['processed_at'] else None,
                "reference": settlement['reference'],
                "transaction_hash": settlement['transaction_hash']
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get settlement: {str(e)}")

@app.get("/api/v1/settlements")
async def list_settlements(
    status: Optional[SettlementStatus] = None,
    agent_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
    """List settlements with filters"""
    try:
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM float_settlements WHERE 1=1"
            params = []
            
            if status:
                query += f" AND status = ${len(params) + 1}"
                params.append(status.value)
            
            if agent_id:
                query += f" AND (source_agent_id = ${len(params) + 1} OR destination_agent_id = ${len(params) + 1})"
                params.extend([agent_id, agent_id])
            
            query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}"
            params.extend([limit, offset])
            
            settlements = await conn.fetch(query, *params)
            
            return [
                {
                    "settlement_id": row['settlement_id'],
                    "status": row['status'],
                    "amount": float(row['amount']),
                    "currency": row['currency'],
                    "processing_fee": float(row['processing_fee']),
                    "net_amount": float(row['net_amount']),
                    "created_at": row['created_at'].isoformat(),
                    "processed_at": row['processed_at'].isoformat() if row['processed_at'] else None
                }
                for row in settlements
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list settlements: {str(e)}")

@app.get("/api/v1/agent-balance/{agent_id}")
async def get_agent_balance(agent_id: str):
    """Get agent balance"""
    try:
        async with db_pool.acquire() as conn:
            balance = await conn.fetchrow("""
                SELECT * FROM agent_balances WHERE agent_id = $1
            """, agent_id)
            
            if not balance:
                return {
                    "agent_id": agent_id,
                    "available_balance": 0.0,
                    "pending_balance": 0.0,
                    "reserved_balance": 0.0,
                    "currency": "NGN"
                }
            
            return {
                "agent_id": balance['agent_id'],
                "available_balance": float(balance['available_balance']),
                "pending_balance": float(balance['pending_balance']),
                "reserved_balance": float(balance['reserved_balance']),
                "currency": balance['currency'],
                "last_updated": balance['last_updated'].isoformat()
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get balance: {str(e)}")

@app.get("/api/v1/summary")
async def get_settlement_summary():
    """Get settlement summary statistics"""
    try:
        async with db_pool.acquire() as conn:
            summary = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_settlements,
                    COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_settlements,
                    COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_settlements,
                    COALESCE(SUM(amount), 0) as total_amount,
                    COALESCE(SUM(processing_fee), 0) as total_fees
                FROM float_settlements
                WHERE created_at >= CURRENT_DATE
            """)
            
            success_rate = 0.0
            if summary['total_settlements'] > 0:
                success_rate = summary['completed_settlements'] / summary['total_settlements'] * 100
            
            return SettlementSummary(
                total_settlements=summary['total_settlements'],
                completed_settlements=summary['completed_settlements'],
                failed_settlements=summary['failed_settlements'],
                total_amount=Decimal(str(summary['total_amount'])),
                total_fees=Decimal(str(summary['total_fees'])),
                success_rate=success_rate
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get summary: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

