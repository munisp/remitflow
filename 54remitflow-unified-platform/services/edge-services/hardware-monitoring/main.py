#!/usr/bin/env python3
"""
Hardware Monitoring Service
Comprehensive hardware monitoring and health management for edge devices
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
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8148"))

app = FastAPI(title="Hardware Monitoring Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

db_pool = None
redis_client = None

class HardwareMetrics(BaseModel):
    device_id: str
    cpu_usage: float
    memory_usage: float
    disk_usage: float
    temperature: float
    network_io: Dict[str, float]
    disk_io: Dict[str, float]
    uptime: int

class HardwareAlert(BaseModel):
    alert_id: str
    device_id: str
    metric_type: str
    threshold_value: float
    current_value: float
    severity: str

async def init_database():
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS hardware_metrics (
                    id SERIAL PRIMARY KEY,
                    device_id VARCHAR(255) NOT NULL,
                    cpu_usage DECIMAL(5,2) NOT NULL,
                    memory_usage DECIMAL(5,2) NOT NULL,
                    disk_usage DECIMAL(5,2) NOT NULL,
                    temperature DECIMAL(5,2) NOT NULL,
                    network_io JSONB NOT NULL,
                    disk_io JSONB NOT NULL,
                    uptime INTEGER NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_device_id (device_id),
                    INDEX idx_timestamp (timestamp)
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS hardware_alerts (
                    id SERIAL PRIMARY KEY,
                    alert_id VARCHAR(255) UNIQUE NOT NULL,
                    device_id VARCHAR(255) NOT NULL,
                    metric_type VARCHAR(50) NOT NULL,
                    threshold_value DECIMAL(10,2) NOT NULL,
                    current_value DECIMAL(10,2) NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    status VARCHAR(20) DEFAULT 'ACTIVE',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    resolved_at TIMESTAMP,
                    INDEX idx_alert_id (alert_id),
                    INDEX idx_device_id (device_id)
                )
            """)
        logger.info("Hardware Monitoring database initialized")
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
        return {"status": "healthy", "service": "hardware-monitoring", "timestamp": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/metrics")
async def report_hardware_metrics(metrics: HardwareMetrics):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO hardware_metrics 
                (device_id, cpu_usage, memory_usage, disk_usage, temperature, network_io, disk_io, uptime)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, metrics.device_id, metrics.cpu_usage, metrics.memory_usage, metrics.disk_usage,
            metrics.temperature, json.dumps(metrics.network_io), json.dumps(metrics.disk_io), metrics.uptime)
        
        # Cache latest metrics
        await redis_client.setex(f"hw_metrics:{metrics.device_id}", 300, json.dumps(metrics.dict()))
        
        # Check for hardware alerts
        await check_hardware_alerts(metrics)
        
        return {"status": "success", "message": "Hardware metrics reported"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to report metrics: {str(e)}")

async def check_hardware_alerts(metrics: HardwareMetrics):
    try:
        alerts = []
        
        # CPU usage alert
        if metrics.cpu_usage > 90:
            alerts.append({
                "metric_type": "CPU_USAGE",
                "threshold_value": 90.0,
                "current_value": metrics.cpu_usage,
                "severity": "HIGH"
            })
        elif metrics.cpu_usage > 80:
            alerts.append({
                "metric_type": "CPU_USAGE",
                "threshold_value": 80.0,
                "current_value": metrics.cpu_usage,
                "severity": "MEDIUM"
            })
        
        # Memory usage alert
        if metrics.memory_usage > 95:
            alerts.append({
                "metric_type": "MEMORY_USAGE",
                "threshold_value": 95.0,
                "current_value": metrics.memory_usage,
                "severity": "CRITICAL"
            })
        elif metrics.memory_usage > 85:
            alerts.append({
                "metric_type": "MEMORY_USAGE",
                "threshold_value": 85.0,
                "current_value": metrics.memory_usage,
                "severity": "HIGH"
            })
        
        # Disk usage alert
        if metrics.disk_usage > 95:
            alerts.append({
                "metric_type": "DISK_USAGE",
                "threshold_value": 95.0,
                "current_value": metrics.disk_usage,
                "severity": "CRITICAL"
            })
        elif metrics.disk_usage > 85:
            alerts.append({
                "metric_type": "DISK_USAGE",
                "threshold_value": 85.0,
                "current_value": metrics.disk_usage,
                "severity": "HIGH"
            })
        
        # Temperature alert
        if metrics.temperature > 80:
            alerts.append({
                "metric_type": "TEMPERATURE",
                "threshold_value": 80.0,
                "current_value": metrics.temperature,
                "severity": "CRITICAL"
            })
        elif metrics.temperature > 70:
            alerts.append({
                "metric_type": "TEMPERATURE",
                "threshold_value": 70.0,
                "current_value": metrics.temperature,
                "severity": "HIGH"
            })
        
        # Create alerts
        for alert_data in alerts:
            alert_id = f"hw_alert_{metrics.device_id}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO hardware_alerts 
                    (alert_id, device_id, metric_type, threshold_value, current_value, severity)
                    VALUES ($1, $2, $3, $4, $5, $6)
                """, alert_id, metrics.device_id, alert_data["metric_type"],
                alert_data["threshold_value"], alert_data["current_value"], alert_data["severity"])
            
            logger.warning(f"Hardware alert created: {alert_id} - {alert_data['metric_type']} = {alert_data['current_value']}")
    
    except Exception as e:
        logger.error(f"Alert checking failed: {e}")

@app.get("/api/v1/metrics/{device_id}")
async def get_hardware_metrics(device_id: str, hours: int = 1):
    try:
        # Check cache for latest
        cached = await redis_client.get(f"hw_metrics:{device_id}")
        if cached and hours <= 1:
            return json.loads(cached)
        
        # Get historical data from database
        since = datetime.now() - timedelta(hours=hours)
        async with db_pool.acquire() as conn:
            metrics = await conn.fetch("""
                SELECT * FROM hardware_metrics 
                WHERE device_id = $1 AND timestamp >= $2 
                ORDER BY timestamp DESC
            """, device_id, since)
            
            if not metrics:
                raise HTTPException(status_code=404, detail="No metrics found for device")
            
            return [
                {
                    "device_id": m['device_id'],
                    "cpu_usage": float(m['cpu_usage']),
                    "memory_usage": float(m['memory_usage']),
                    "disk_usage": float(m['disk_usage']),
                    "temperature": float(m['temperature']),
                    "network_io": json.loads(m['network_io']),
                    "disk_io": json.loads(m['disk_io']),
                    "uptime": m['uptime'],
                    "timestamp": m['timestamp'].isoformat()
                }
                for m in metrics
            ]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {str(e)}")

@app.get("/api/v1/alerts")
async def get_hardware_alerts(device_id: Optional[str] = None, status: str = "ACTIVE"):
    try:
        async with db_pool.acquire() as conn:
            if device_id:
                alerts = await conn.fetch("""
                    SELECT * FROM hardware_alerts 
                    WHERE device_id = $1 AND status = $2 
                    ORDER BY created_at DESC
                """, device_id, status)
            else:
                alerts = await conn.fetch("""
                    SELECT * FROM hardware_alerts 
                    WHERE status = $1 
                    ORDER BY created_at DESC
                """, status)
            
            return [
                {
                    "alert_id": alert['alert_id'],
                    "device_id": alert['device_id'],
                    "metric_type": alert['metric_type'],
                    "threshold_value": float(alert['threshold_value']),
                    "current_value": float(alert['current_value']),
                    "severity": alert['severity'],
                    "status": alert['status'],
                    "created_at": alert['created_at'].isoformat(),
                    "resolved_at": alert['resolved_at'].isoformat() if alert['resolved_at'] else None
                }
                for alert in alerts
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get alerts: {str(e)}")

@app.get("/api/v1/health-summary/{device_id}")
async def get_device_health_summary(device_id: str):
    try:
        # Get latest metrics
        cached = await redis_client.get(f"hw_metrics:{device_id}")
        if not cached:
            raise HTTPException(status_code=404, detail="No recent metrics found")
        
        metrics = json.loads(cached)
        
        # Calculate health score
        health_score = calculate_health_score(metrics)
        
        # Get active alerts count
        async with db_pool.acquire() as conn:
            alert_count = await conn.fetchval("""
                SELECT COUNT(*) FROM hardware_alerts 
                WHERE device_id = $1 AND status = 'ACTIVE'
            """, device_id)
        
        return {
            "device_id": device_id,
            "health_score": health_score,
            "status": get_health_status(health_score),
            "active_alerts": alert_count,
            "last_update": metrics.get("timestamp", datetime.now().isoformat()),
            "metrics_summary": {
                "cpu_usage": metrics["cpu_usage"],
                "memory_usage": metrics["memory_usage"],
                "disk_usage": metrics["disk_usage"],
                "temperature": metrics["temperature"]
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get health summary: {str(e)}")

def calculate_health_score(metrics: Dict[str, Any]) -> float:
    """Calculate overall health score (0-100)"""
    cpu_score = max(0, 100 - metrics["cpu_usage"])
    memory_score = max(0, 100 - metrics["memory_usage"])
    disk_score = max(0, 100 - metrics["disk_usage"])
    temp_score = max(0, 100 - (metrics["temperature"] - 20) * 2)  # Optimal temp around 20-40°C
    
    return (cpu_score + memory_score + disk_score + temp_score) / 4

def get_health_status(health_score: float) -> str:
    """Get health status based on score"""
    if health_score >= 90:
        return "EXCELLENT"
    elif health_score >= 75:
        return "GOOD"
    elif health_score >= 60:
        return "FAIR"
    elif health_score >= 40:
        return "POOR"
    else:
        return "CRITICAL"

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False, log_level="info")

