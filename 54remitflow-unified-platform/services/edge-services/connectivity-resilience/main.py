#!/usr/bin/env python3
"""
Connectivity Resilience Service
Network resilience and failover management for edge computing
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
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
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8147"))

app = FastAPI(title="Connectivity Resilience Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

db_pool = None
redis_client = None

class FailoverConfig(BaseModel):
    config_id: str
    primary_connection: str
    backup_connections: List[str]
    failover_threshold: float
    auto_recovery: bool

class FailoverEvent(BaseModel):
    event_id: str
    device_id: str
    from_connection: str
    to_connection: str
    reason: str

async def init_database():
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS failover_configs (
                    id SERIAL PRIMARY KEY,
                    config_id VARCHAR(255) UNIQUE NOT NULL,
                    device_id VARCHAR(255) NOT NULL,
                    primary_connection VARCHAR(100) NOT NULL,
                    backup_connections JSONB NOT NULL,
                    failover_threshold DECIMAL(5,2) NOT NULL,
                    auto_recovery BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_config_id (config_id),
                    INDEX idx_device_id (device_id)
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS failover_events (
                    id SERIAL PRIMARY KEY,
                    event_id VARCHAR(255) UNIQUE NOT NULL,
                    device_id VARCHAR(255) NOT NULL,
                    from_connection VARCHAR(100) NOT NULL,
                    to_connection VARCHAR(100) NOT NULL,
                    reason TEXT NOT NULL,
                    status VARCHAR(20) DEFAULT 'COMPLETED',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_event_id (event_id),
                    INDEX idx_device_id (device_id)
                )
            """)
        logger.info("Connectivity Resilience database initialized")
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
        return {"status": "healthy", "service": "connectivity-resilience", "timestamp": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/failover/config")
async def create_failover_config(config: FailoverConfig, device_id: str):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO failover_configs 
                (config_id, device_id, primary_connection, backup_connections, failover_threshold, auto_recovery)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (config_id) DO UPDATE SET
                primary_connection = EXCLUDED.primary_connection,
                backup_connections = EXCLUDED.backup_connections,
                failover_threshold = EXCLUDED.failover_threshold,
                auto_recovery = EXCLUDED.auto_recovery
            """, config.config_id, device_id, config.primary_connection,
            json.dumps(config.backup_connections), config.failover_threshold, config.auto_recovery)
        
        return {"status": "success", "message": "Failover configuration created", "config_id": config.config_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create config: {str(e)}")

@app.post("/api/v1/failover/trigger")
async def trigger_failover(event: FailoverEvent):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO failover_events (event_id, device_id, from_connection, to_connection, reason)
                VALUES ($1, $2, $3, $4, $5)
            """, event.event_id, event.device_id, event.from_connection, event.to_connection, event.reason)
        
        # Simulate failover process
        await perform_failover(event)
        
        return {"status": "success", "message": "Failover triggered", "event_id": event.event_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger failover: {str(e)}")

async def perform_failover(event: FailoverEvent):
    try:
        # Simulate failover operations
        await asyncio.sleep(1)
        
        # Update device connection status in Redis
        await redis_client.setex(f"active_connection:{event.device_id}", 3600, event.to_connection)
        
        logger.info(f"Failover completed: {event.device_id} switched from {event.from_connection} to {event.to_connection}")
    except Exception as e:
        logger.error(f"Failover operation failed: {e}")

@app.get("/api/v1/failover/events/{device_id}")
async def get_failover_events(device_id: str):
    try:
        async with db_pool.acquire() as conn:
            events = await conn.fetch("""
                SELECT * FROM failover_events 
                WHERE device_id = $1 
                ORDER BY created_at DESC
            """, device_id)
            
            return [
                {
                    "event_id": event['event_id'],
                    "device_id": event['device_id'],
                    "from_connection": event['from_connection'],
                    "to_connection": event['to_connection'],
                    "reason": event['reason'],
                    "status": event['status'],
                    "created_at": event['created_at'].isoformat()
                }
                for event in events
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get events: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False, log_level="info")

