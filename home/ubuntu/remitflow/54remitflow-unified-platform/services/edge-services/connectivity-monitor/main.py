#!/usr/bin/env python3
"""
Connectivity Monitor Service
Network connectivity monitoring and management for edge devices
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
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8146"))

app = FastAPI(title="Connectivity Monitor Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

db_pool = None
redis_client = None

class ConnectivityStatus(BaseModel):
    device_id: str
    location: str
    connection_type: str
    signal_strength: float
    latency: float
    bandwidth: float
    status: str

class NetworkAlert(BaseModel):
    alert_id: str
    device_id: str
    alert_type: str
    severity: str
    message: str

async def init_database():
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS connectivity_status (
                    id SERIAL PRIMARY KEY,
                    device_id VARCHAR(255) NOT NULL,
                    location VARCHAR(100) NOT NULL,
                    connection_type VARCHAR(50) NOT NULL,
                    signal_strength DECIMAL(5,2) NOT NULL,
                    latency DECIMAL(8,2) NOT NULL,
                    bandwidth DECIMAL(10,2) NOT NULL,
                    status VARCHAR(20) NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_device_id (device_id),
                    INDEX idx_timestamp (timestamp)
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS network_alerts (
                    id SERIAL PRIMARY KEY,
                    alert_id VARCHAR(255) UNIQUE NOT NULL,
                    device_id VARCHAR(255) NOT NULL,
                    alert_type VARCHAR(50) NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    message TEXT NOT NULL,
                    status VARCHAR(20) DEFAULT 'ACTIVE',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    resolved_at TIMESTAMP,
                    INDEX idx_alert_id (alert_id),
                    INDEX idx_device_id (device_id)
                )
            """)
        logger.info("Connectivity Monitor database initialized")
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
        return {"status": "healthy", "service": "connectivity-monitor", "timestamp": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/status")
async def report_connectivity(status: ConnectivityStatus):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO connectivity_status 
                (device_id, location, connection_type, signal_strength, latency, bandwidth, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, status.device_id, status.location, status.connection_type,
            status.signal_strength, status.latency, status.bandwidth, status.status)
        
        # Cache latest status
        await redis_client.setex(f"connectivity:{status.device_id}", 300, json.dumps(status.dict()))
        
        # Check for alerts
        await check_connectivity_alerts(status)
        
        return {"status": "success", "message": "Connectivity status reported"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to report status: {str(e)}")

async def check_connectivity_alerts(status: ConnectivityStatus):
    try:
        alerts = []
        
        # Check signal strength
        if status.signal_strength < 20:
            alerts.append({
                "alert_type": "LOW_SIGNAL",
                "severity": "HIGH",
                "message": f"Low signal strength: {status.signal_strength}%"
            })
        
        # Check latency
        if status.latency > 1000:
            alerts.append({
                "alert_type": "HIGH_LATENCY",
                "severity": "MEDIUM",
                "message": f"High latency detected: {status.latency}ms"
            })
        
        # Check bandwidth
        if status.bandwidth < 1:
            alerts.append({
                "alert_type": "LOW_BANDWIDTH",
                "severity": "MEDIUM",
                "message": f"Low bandwidth: {status.bandwidth} Mbps"
            })
        
        # Create alerts
        for alert_data in alerts:
            alert_id = f"alert_{status.device_id}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO network_alerts (alert_id, device_id, alert_type, severity, message)
                    VALUES ($1, $2, $3, $4, $5)
                """, alert_id, status.device_id, alert_data["alert_type"], 
                alert_data["severity"], alert_data["message"])
            
            logger.warning(f"Network alert created: {alert_id} - {alert_data['message']}")
    
    except Exception as e:
        logger.error(f"Alert checking failed: {e}")

@app.get("/api/v1/status/{device_id}")
async def get_connectivity_status(device_id: str):
    try:
        # Check cache first
        cached = await redis_client.get(f"connectivity:{device_id}")
        if cached:
            return json.loads(cached)
        
        # Get latest from database
        async with db_pool.acquire() as conn:
            status = await conn.fetchrow("""
                SELECT * FROM connectivity_status 
                WHERE device_id = $1 
                ORDER BY timestamp DESC 
                LIMIT 1
            """, device_id)
            
            if not status:
                raise HTTPException(status_code=404, detail="Device status not found")
            
            result = {
                "device_id": status['device_id'],
                "location": status['location'],
                "connection_type": status['connection_type'],
                "signal_strength": float(status['signal_strength']),
                "latency": float(status['latency']),
                "bandwidth": float(status['bandwidth']),
                "status": status['status'],
                "timestamp": status['timestamp'].isoformat()
            }
            
            return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get status: {str(e)}")

@app.get("/api/v1/alerts")
async def get_network_alerts(device_id: Optional[str] = None, status: str = "ACTIVE"):
    try:
        async with db_pool.acquire() as conn:
            if device_id:
                alerts = await conn.fetch("""
                    SELECT * FROM network_alerts 
                    WHERE device_id = $1 AND status = $2 
                    ORDER BY created_at DESC
                """, device_id, status)
            else:
                alerts = await conn.fetch("""
                    SELECT * FROM network_alerts 
                    WHERE status = $1 
                    ORDER BY created_at DESC
                """, status)
            
            return [
                {
                    "alert_id": alert['alert_id'],
                    "device_id": alert['device_id'],
                    "alert_type": alert['alert_type'],
                    "severity": alert['severity'],
                    "message": alert['message'],
                    "status": alert['status'],
                    "created_at": alert['created_at'].isoformat(),
                    "resolved_at": alert['resolved_at'].isoformat() if alert['resolved_at'] else None
                }
                for alert in alerts
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get alerts: {str(e)}")

@app.put("/api/v1/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str):
    try:
        async with db_pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE network_alerts 
                SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
                WHERE alert_id = $1
            """, alert_id)
            
            if result == "UPDATE 0":
                raise HTTPException(status_code=404, detail="Alert not found")
            
            return {"status": "success", "message": "Alert resolved"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve alert: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False, log_level="info")

