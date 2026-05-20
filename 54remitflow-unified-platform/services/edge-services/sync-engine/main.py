#!/usr/bin/env python3
"""
Sync Engine Service
Data synchronization service for edge computing environments
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional, Any
import asyncpg
import aioredis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8144"))

app = FastAPI(title="Sync Engine Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

db_pool = None
redis_client = None

class SyncRequest(BaseModel):
    sync_id: str
    source_location: str
    target_location: str
    data_type: str
    sync_mode: str

async def init_database():
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_operations (
                    id SERIAL PRIMARY KEY,
                    sync_id VARCHAR(255) UNIQUE NOT NULL,
                    source_location VARCHAR(100) NOT NULL,
                    target_location VARCHAR(100) NOT NULL,
                    data_type VARCHAR(50) NOT NULL,
                    sync_mode VARCHAR(20) NOT NULL,
                    status VARCHAR(20) DEFAULT 'PENDING',
                    records_synced INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    INDEX idx_sync_id (sync_id),
                    INDEX idx_status (status)
                )
            """)
        logger.info("Sync Engine database initialized")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise

async def init_redis():
    global redis_client
    try:
        redis_client = await aioredis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Redis connection established")
    except Exception as e:
        logger.error(f"Redis initialization failed: {e}")
        raise

@app.on_event("startup")
async def startup_event():
    await init_database()
    await init_redis()

@app.on_event("shutdown")
async def shutdown_event():
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

@app.get("/health")
async def health_check():
    try:
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        await redis_client.ping()
        return {"status": "healthy", "service": "sync-engine", "timestamp": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/sync")
async def start_sync(request: SyncRequest):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO sync_operations (sync_id, source_location, target_location, data_type, sync_mode)
                VALUES ($1, $2, $3, $4, $5)
            """, request.sync_id, request.source_location, request.target_location, 
            request.data_type, request.sync_mode)
        
        # Start background sync process
        asyncio.create_task(perform_sync(request))
        
        return {"status": "success", "message": "Sync operation started", "sync_id": request.sync_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start sync: {str(e)}")

async def perform_sync(request: SyncRequest):
    try:
        # Simulate sync operation
        await asyncio.sleep(2)
        
        # Update status
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE sync_operations 
                SET status = 'COMPLETED', records_synced = $1, completed_at = CURRENT_TIMESTAMP
                WHERE sync_id = $2
            """, 100, request.sync_id)
        
        logger.info(f"Sync operation {request.sync_id} completed")
    except Exception as e:
        logger.error(f"Sync operation failed: {e}")

@app.get("/api/v1/sync/{sync_id}")
async def get_sync_status(sync_id: str):
    try:
        async with db_pool.acquire() as conn:
            sync_op = await conn.fetchrow("""
                SELECT * FROM sync_operations WHERE sync_id = $1
            """, sync_id)
            
            if not sync_op:
                raise HTTPException(status_code=404, detail="Sync operation not found")
            
            return {
                "sync_id": sync_op['sync_id'],
                "source_location": sync_op['source_location'],
                "target_location": sync_op['target_location'],
                "data_type": sync_op['data_type'],
                "sync_mode": sync_op['sync_mode'],
                "status": sync_op['status'],
                "records_synced": sync_op['records_synced'],
                "created_at": sync_op['created_at'].isoformat(),
                "completed_at": sync_op['completed_at'].isoformat() if sync_op['completed_at'] else None
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get sync status: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False, log_level="info")

