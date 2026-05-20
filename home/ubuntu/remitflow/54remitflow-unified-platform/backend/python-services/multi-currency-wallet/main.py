"""
Multi-Currency Wallet
Port: 8085
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

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remittance:remittance@localhost:5432/remittance")

_db_pool = None

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

app = FastAPI(title="Multi-Currency Wallet", description="Multi-Currency Wallet for Remittance Platform", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS currency_wallets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id VARCHAR(255) NOT NULL,
                currency VARCHAR(3) NOT NULL,
                balance DECIMAL(18,2) DEFAULT 0,
                available_balance DECIMAL(18,2) DEFAULT 0,
                frozen_amount DECIMAL(18,2) DEFAULT 0,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(user_id, currency)
            )
        """)

@app.get("/health")
async def health_check():
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "healthy", "service": "multi-currency-wallet", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "service": "multi-currency-wallet", "error": str(e)}

class WalletCreate(BaseModel):
    user_id: str
    currency: str

class WalletTransaction(BaseModel):
    amount: float

@app.post("/api/v1/wallets", status_code=201)
async def create_wallet(item: WalletCreate, token: str = Depends(verify_token), pool: asyncpg.Pool = Depends(get_db_pool)):
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                "INSERT INTO currency_wallets (user_id, currency) VALUES ($1, $2) RETURNING *",
                item.user_id, item.currency
            )
            return dict(row)
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail="Wallet for this currency already exists.")

@app.get("/api/v1/wallets/{user_id}")
async def get_user_wallets(user_id: str, token: str = Depends(verify_token), pool: asyncpg.Pool = Depends(get_db_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM currency_wallets WHERE user_id = $1", user_id)
        return [dict(row) for row in rows]

@app.post("/api/v1/wallets/{wallet_id}/deposit")
async def deposit(wallet_id: str, transaction: WalletTransaction, token: str = Depends(verify_token), pool: asyncpg.Pool = Depends(get_db_pool)):
    async with pool.acquire() as conn:
        async with conn.transaction():
            wallet = await conn.fetchrow("SELECT * FROM currency_wallets WHERE id = $1 FOR UPDATE", uuid.UUID(wallet_id))
            if not wallet:
                raise HTTPException(status_code=404, detail="Wallet not found")
            new_balance = wallet['balance'] + transaction.amount
            new_available_balance = wallet['available_balance'] + transaction.amount
            updated_wallet = await conn.fetchrow(
                "UPDATE currency_wallets SET balance = $1, available_balance = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
                new_balance, new_available_balance, uuid.UUID(wallet_id)
            )
            return dict(updated_wallet)

@app.post("/api/v1/wallets/{wallet_id}/withdraw")
async def withdraw(wallet_id: str, transaction: WalletTransaction, token: str = Depends(verify_token), pool: asyncpg.Pool = Depends(get_db_pool)):
    async with pool.acquire() as conn:
        async with conn.transaction():
            wallet = await conn.fetchrow("SELECT * FROM currency_wallets WHERE id = $1 FOR UPDATE", uuid.UUID(wallet_id))
            if not wallet:
                raise HTTPException(status_code=404, detail="Wallet not found")
            if wallet['available_balance'] < transaction.amount:
                raise HTTPException(status_code=400, detail="Insufficient funds")
            new_balance = wallet['balance'] - transaction.amount
            new_available_balance = wallet['available_balance'] - transaction.amount
            updated_wallet = await conn.fetchrow(
                "UPDATE currency_wallets SET balance = $1, available_balance = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
                new_balance, new_available_balance, uuid.UUID(wallet_id)
            )
            return dict(updated_wallet)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8085)
