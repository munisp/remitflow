#!/usr/bin/env python3
"""
Power Management Service
Edge computing power management and optimization service
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
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8145"))

app = FastAPI(title="Power Management Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

db_pool = None
redis_client = None

class PowerDevice(BaseModel):
    device_id: str
    device_type: str
    location: str
    power_consumption: float
    status: str

class PowerOptimization(BaseModel):
    optimization_id: str
    target_reduction: float
    strategy: str
    devices: List[str]

async def init_database():
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS power_devices (
                    id SERIAL PRIMARY KEY,
                    device_id VARCHAR(255) UNIQUE NOT NULL,
                    device_type VARCHAR(50) NOT NULL,
                    location VARCHAR(100) NOT NULL,
                    power_consumption DECIMAL(10,2) NOT NULL,
                    status VARCHAR(20) DEFAULT 'ACTIVE',
                    last_reading TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_device_id (device_id),
                    INDEX idx_location (location)
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS power_optimizations (
                    id SERIAL PRIMARY KEY,
                    optimization_id VARCHAR(255) UNIQUE NOT NULL,
                    target_reduction DECIMAL(5,2) NOT NULL,
                    strategy VARCHAR(50) NOT NULL,
                    devices JSONB NOT NULL,
                    status VARCHAR(20) DEFAULT 'PENDING',
                    actual_reduction DECIMAL(5,2),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    INDEX idx_optimization_id (optimization_id),
                    INDEX idx_status (status)
                )
            """)
        logger.info("Power Management database initialized")
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
        return {"status": "healthy", "service": "power-management", "timestamp": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/devices")
async def register_device(device: PowerDevice):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO power_devices (device_id, device_type, location, power_consumption, status)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (device_id) DO UPDATE SET
                device_type = EXCLUDED.device_type,
                location = EXCLUDED.location,
                power_consumption = EXCLUDED.power_consumption,
                status = EXCLUDED.status,
                last_reading = CURRENT_TIMESTAMP
            """, device.device_id, device.device_type, device.location, 
            device.power_consumption, device.status)
        
        # Cache device info
        await redis_client.setex(f"device:{device.device_id}", 3600, json.dumps(device.dict()))
        
        return {"status": "success", "message": "Device registered", "device_id": device.device_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to register device: {str(e)}")

@app.get("/api/v1/devices/{device_id}")
async def get_device(device_id: str):
    try:
        # Check cache first
        cached = await redis_client.get(f"device:{device_id}")
        if cached:
            return json.loads(cached)
        
        # Get from database
        async with db_pool.acquire() as conn:
            device = await conn.fetchrow("""
                SELECT * FROM power_devices WHERE device_id = $1
            """, device_id)
            
            if not device:
                raise HTTPException(status_code=404, detail="Device not found")
            
            result = {
                "device_id": device['device_id'],
                "device_type": device['device_type'],
                "location": device['location'],
                "power_consumption": float(device['power_consumption']),
                "status": device['status'],
                "last_reading": device['last_reading'].isoformat()
            }
            
            # Update cache
            await redis_client.setex(f"device:{device_id}", 3600, json.dumps(result))
            
            return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get device: {str(e)}")

@app.post("/api/v1/optimize")
async def optimize_power(optimization: PowerOptimization):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO power_optimizations (optimization_id, target_reduction, strategy, devices)
                VALUES ($1, $2, $3, $4)
            """, optimization.optimization_id, optimization.target_reduction, 
            optimization.strategy, json.dumps(optimization.devices))
        
        # Start background optimization
        asyncio.create_task(perform_optimization(optimization))
        
        return {"status": "success", "message": "Optimization started", "optimization_id": optimization.optimization_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start optimization: {str(e)}")

async def perform_optimization(optimization: PowerOptimization):
    try:
        # Simulate power optimization
        await asyncio.sleep(3)
        
        # Calculate actual reduction (simulate)
        actual_reduction = optimization.target_reduction * np.random.uniform(0.8, 1.2)
        
        # Update optimization status
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE power_optimizations 
                SET status = 'COMPLETED', actual_reduction = $1, completed_at = CURRENT_TIMESTAMP
                WHERE optimization_id = $2
            """, actual_reduction, optimization.optimization_id)
        
        logger.info(f"Power optimization {optimization.optimization_id} completed with {actual_reduction}% reduction")
    except Exception as e:
        logger.error(f"Power optimization failed: {e}")

@app.get("/api/v1/optimizations/{optimization_id}")
async def get_optimization(optimization_id: str):
    try:
        async with db_pool.acquire() as conn:
            opt = await conn.fetchrow("""
                SELECT * FROM power_optimizations WHERE optimization_id = $1
            """, optimization_id)
            
            if not opt:
                raise HTTPException(status_code=404, detail="Optimization not found")
            
            return {
                "optimization_id": opt['optimization_id'],
                "target_reduction": float(opt['target_reduction']),
                "strategy": opt['strategy'],
                "devices": json.loads(opt['devices']),
                "status": opt['status'],
                "actual_reduction": float(opt['actual_reduction']) if opt['actual_reduction'] else None,
                "created_at": opt['created_at'].isoformat(),
                "completed_at": opt['completed_at'].isoformat() if opt['completed_at'] else None
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get optimization: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False, log_level="info")

