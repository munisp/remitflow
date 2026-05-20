"""
Remitly Integration
Port: 8077
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
from remitly_client import RemitlyClient

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remittance:remittance@localhost:5432/remittance")
REMITLY_API_KEY = os.getenv("REMITLY_API_KEY")

_db_pool = None
remitly_client = RemitlyClient(api_key=REMITLY_API_KEY) if REMITLY_API_KEY else None

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

app = FastAPI(title="Remitly Integration", description="Remitly Integration for Remittance Platform", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS remitly_transfers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id VARCHAR(255) NOT NULL,
                amount DECIMAL(18,2) NOT NULL,
                source_currency VARCHAR(3) NOT NULL,
                dest_currency VARCHAR(3) NOT NULL,
                recipient_name VARCHAR(255),
                recipient_account VARCHAR(100),
                recipient_country VARCHAR(3),
                status VARCHAR(20) DEFAULT 'pending',
                remitly_reference VARCHAR(255),
                exchange_rate DECIMAL(18,8),
                fee DECIMAL(18,2) DEFAULT 0,
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
        return {"status": "healthy", "service": "remitly-integration", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "service": "remitly-integration", "error": str(e)}

class QuoteCreate(BaseModel):
    source_currency: str
    target_currency: str
    amount: float

class TransferCreate(BaseModel):
    quote_id: str
    recipient_id: str
    customer_transaction_id: str

@app.post("/api/v1/remitly/quotes")
async def get_quote(item: QuoteCreate, token: str = Depends(verify_token)):
    if not remitly_client:
        raise HTTPException(status_code=503, detail="Remitly client is not configured.")
    try:
        quote = await remitly_client.get_quote(
            source_currency=item.source_currency,
            target_currency=item.target_currency,
            amount=item.amount,
        )
        return quote
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/remitly/transfers")
async def create_transfer(item: TransferCreate, token: str = Depends(verify_token)):
    if not remitly_client:
        raise HTTPException(status_code=503, detail="Remitly client is not configured.")
    try:
        transfer = await remitly_client.create_transfer(
            quote_id=item.quote_id,
            recipient_id=item.recipient_id,
            customer_transaction_id=item.customer_transaction_id,
        )
        return transfer
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/remitly/transfers/{transfer_id}")
async def get_transfer(transfer_id: str, token: str = Depends(verify_token)):
    if not remitly_client:
        raise HTTPException(status_code=503, detail="Remitly client is not configured.")
    try:
        transfer = await remitly_client.get_transfer(transfer_id)
        return transfer
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8077)
