#!/usr/bin/env python3
"""
Monitoring and Observability Service
Comprehensive monitoring, metrics collection, alerting, and observability platform
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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8141"))

app = FastAPI(title="Monitoring and Observability Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

db_pool = None
redis_client = None

class MetricData(BaseModel):
    metric_name: str
    value: float
    timestamp: datetime
    labels: Dict[str, str] = {}

class AlertRule(BaseModel):
    rule_name: str
    metric_name: str
    threshold: float
    operator: str
    severity: str

async def init_database():
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS metrics (
                    id SERIAL PRIMARY KEY,
                    metric_name VARCHAR(255) NOT NULL,
                    value DECIMAL(15,4) NOT NULL,
                    labels JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_metric_name (metric_name),
                    INDEX idx_timestamp (timestamp)
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id SERIAL PRIMARY KEY,
                    alert_id VARCHAR(255) UNIQUE NOT NULL,
                    rule_name VARCHAR(255) NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    message TEXT,
                    status VARCHAR(20) DEFAULT 'ACTIVE',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    resolved_at TIMESTAMP,
                    INDEX idx_alert_id (alert_id),
                    INDEX idx_status (status)
                )
            """)
        logger.info("Monitoring database initialized")
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
        return {"status": "healthy", "service": "monitoring-observability", "timestamp": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/metrics")
async def collect_metric(metric: MetricData):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO metrics (metric_name, value, labels, timestamp)
                VALUES ($1, $2, $3, $4)
            """, metric.metric_name, metric.value, json.dumps(metric.labels), metric.timestamp)
        
        # Store in Redis for real-time access
        await redis_client.zadd(f"metrics:{metric.metric_name}", {str(metric.value): metric.timestamp.timestamp()})
        
        return {"status": "success", "message": "Metric collected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to collect metric: {str(e)}")

@app.get("/api/v1/metrics/{metric_name}")
async def get_metrics(metric_name: str, hours: int = 24):
    try:
        since = datetime.now() - timedelta(hours=hours)
        async with db_pool.acquire() as conn:
            metrics = await conn.fetch("""
                SELECT value, labels, timestamp FROM metrics 
                WHERE metric_name = $1 AND timestamp >= $2 
                ORDER BY timestamp DESC
            """, metric_name, since)
        
        return [{"value": float(m['value']), "labels": json.loads(m['labels'] or '{}'), 
                "timestamp": m['timestamp'].isoformat()} for m in metrics]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {str(e)}")

@app.post("/api/v1/alerts/rules")
async def create_alert_rule(rule: AlertRule):
    try:
        # Store alert rule in Redis
        await redis_client.hset(f"alert_rules:{rule.rule_name}", mapping={
            "metric_name": rule.metric_name,
            "threshold": str(rule.threshold),
            "operator": rule.operator,
            "severity": rule.severity
        })
        return {"status": "success", "message": "Alert rule created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create alert rule: {str(e)}")

@app.get("/api/v1/alerts")
async def get_alerts(status: str = "ACTIVE"):
    try:
        async with db_pool.acquire() as conn:
            alerts = await conn.fetch("""
                SELECT * FROM alerts WHERE status = $1 ORDER BY created_at DESC
            """, status)
        
        return [{"alert_id": a['alert_id'], "rule_name": a['rule_name'], "severity": a['severity'],
                "message": a['message'], "status": a['status'], "created_at": a['created_at'].isoformat()}
                for a in alerts]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get alerts: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False, log_level="info")

