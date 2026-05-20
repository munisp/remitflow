
"""
Wise Integration
Port: 8076
"""
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid
import os
import json
import asyncpg
import uvicorn
from wise_client import WiseClient

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remittance:remittance@localhost:5432/remittance")
WISE_API_KEY = os.getenv("WISE_API_KEY")

_db_pool = None
wise_client = WiseClient(api_key=WISE_API_KEY) if WISE_API_KEY else None

async def get_db_pool():
    global _db_pool
    if _db_pool is None:
        _db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _db_pool

async def verify_token(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    if not token or len(token) < 10:
        raise HTTPException(status_code=401, detail="Invalid token")
    return token

app = FastAPI(title="Wise Integration", description="Wise Integration for Remittance Platform", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS wise_transfers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id VARCHAR(255) NOT NULL,
                profile_id VARCHAR(100),
                source_currency VARCHAR(3) NOT NULL,
                target_currency VARCHAR(3) NOT NULL,
                source_amount DECIMAL(18,2),
                target_amount DECIMAL(18,2),
                rate DECIMAL(18,8),
                fee DECIMAL(18,2),
                status VARCHAR(20) DEFAULT 'pending',
                wise_transfer_id VARCHAR(100),
                recipient_id VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)

@app.get("/health")
async def health_check():
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "healthy", "service": "wise-integration", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "service": "wise-integration", "error": str(e)}

class QuoteCreate(BaseModel):
    profile_id: str
    source_currency: str
    target_currency: str
    source_amount: Optional[float] = None
    target_amount: Optional[float] = None

class RecipientCreate(BaseModel):
    profile_id: str
    currency: str
    details: Dict[str, Any]

class TransferCreate(BaseModel):
    quote_id: str
    recipient_id: str
    customer_transaction_id: str

@app.post("/api/v1/wise/quotes")
async def create_quote(item: QuoteCreate, token: str = Depends(verify_token)):
    if not wise_client:
        raise HTTPException(status_code=503, detail="Wise client is not configured.")
    try:
        quote = await wise_client.create_quote(
            profile_id=item.profile_id,
            source_currency=item.source_currency,
            target_currency=item.target_currency,
            source_amount=item.source_amount,
            target_amount=item.target_amount,
        )
        return quote
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/wise/recipients")
async def create_recipient(item: RecipientCreate, token: str = Depends(verify_token)):
    if not wise_client:
        raise HTTPException(status_code=503, detail="Wise client is not configured.")
    try:
        recipient = await wise_client.create_recipient(
            profile_id=item.profile_id,
            currency=item.currency,
            details=item.details,
        )
        return recipient
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/wise/transfers")
async def create_transfer(item: TransferCreate, token: str = Depends(verify_token)):
    if not wise_client:
        raise HTTPException(status_code=503, detail="Wise client is not configured.")
    try:
        transfer = await wise_client.create_transfer(
            quote_id=item.quote_id,
            recipient_id=item.recipient_id,
            customer_transaction_id=item.customer_transaction_id,
        )
        return transfer
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/wise/transfers/{transfer_id}")
async def get_transfer(transfer_id: str, token: str = Depends(verify_token)):
    if not wise_client:
        raise HTTPException(status_code=503, detail="Wise client is not configured.")
    try:
        transfer = await wise_client.get_transfer(transfer_id)
        return transfer
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8076)
