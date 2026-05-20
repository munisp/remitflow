#!/usr/bin/env python3
"""
Resilience Orchestrator Service
Orchestrates resilience strategies across edge computing infrastructure
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
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8149"))

app = FastAPI(title="Resilience Orchestrator Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

db_pool = None
redis_client = None

class ResilienceStrategy(BaseModel):
    strategy_id: str
    strategy_type: str
    target_devices: List[str]
    parameters: Dict[str, Any]
    priority: int

class ResilienceExecution(BaseModel):
    execution_id: str
    strategy_id: str
    trigger_event: str
    affected_devices: List[str]
    status: str

async def init_database():
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS resilience_strategies (
                    id SERIAL PRIMARY KEY,
                    strategy_id VARCHAR(255) UNIQUE NOT NULL,
                    strategy_type VARCHAR(50) NOT NULL,
                    target_devices JSONB NOT NULL,
                    parameters JSONB NOT NULL,
                    priority INTEGER DEFAULT 1,
                    active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_strategy_id (strategy_id),
                    INDEX idx_strategy_type (strategy_type)
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS resilience_executions (
                    id SERIAL PRIMARY KEY,
                    execution_id VARCHAR(255) UNIQUE NOT NULL,
                    strategy_id VARCHAR(255) NOT NULL,
                    trigger_event VARCHAR(100) NOT NULL,
                    affected_devices JSONB NOT NULL,
                    status VARCHAR(20) DEFAULT 'PENDING',
                    result JSONB,
                    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    INDEX idx_execution_id (execution_id),
                    INDEX idx_strategy_id (strategy_id)
                )
            """)
        logger.info("Resilience Orchestrator database initialized")
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
        return {"status": "healthy", "service": "resilience-orchestrator", "timestamp": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/strategies")
async def create_resilience_strategy(strategy: ResilienceStrategy):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO resilience_strategies 
                (strategy_id, strategy_type, target_devices, parameters, priority)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (strategy_id) DO UPDATE SET
                strategy_type = EXCLUDED.strategy_type,
                target_devices = EXCLUDED.target_devices,
                parameters = EXCLUDED.parameters,
                priority = EXCLUDED.priority
            """, strategy.strategy_id, strategy.strategy_type, json.dumps(strategy.target_devices),
            json.dumps(strategy.parameters), strategy.priority)
        
        return {"status": "success", "message": "Resilience strategy created", "strategy_id": strategy.strategy_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create strategy: {str(e)}")

@app.post("/api/v1/execute")
async def execute_resilience_strategy(execution: ResilienceExecution):
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO resilience_executions 
                (execution_id, strategy_id, trigger_event, affected_devices, status)
                VALUES ($1, $2, $3, $4, $5)
            """, execution.execution_id, execution.strategy_id, execution.trigger_event,
            json.dumps(execution.affected_devices), execution.status)
        
        # Start background execution
        asyncio.create_task(perform_resilience_execution(execution))
        
        return {"status": "success", "message": "Resilience execution started", "execution_id": execution.execution_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute strategy: {str(e)}")

async def perform_resilience_execution(execution: ResilienceExecution):
    try:
        # Get strategy details
        async with db_pool.acquire() as conn:
            strategy = await conn.fetchrow("""
                SELECT * FROM resilience_strategies WHERE strategy_id = $1
            """, execution.strategy_id)
            
            if not strategy:
                logger.error(f"Strategy not found: {execution.strategy_id}")
                return
        
        # Execute based on strategy type
        result = await execute_strategy_type(
            strategy['strategy_type'], 
            json.loads(strategy['parameters']), 
            execution.affected_devices
        )
        
        # Update execution status
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE resilience_executions 
                SET status = 'COMPLETED', result = $1, completed_at = CURRENT_TIMESTAMP
                WHERE execution_id = $2
            """, json.dumps(result), execution.execution_id)
        
        logger.info(f"Resilience execution {execution.execution_id} completed successfully")
    
    except Exception as e:
        logger.error(f"Resilience execution failed: {e}")
        
        # Update execution status to failed
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE resilience_executions 
                SET status = 'FAILED', result = $1, completed_at = CURRENT_TIMESTAMP
                WHERE execution_id = $2
            """, json.dumps({"error": str(e)}), execution.execution_id)

async def execute_strategy_type(strategy_type: str, parameters: Dict[str, Any], affected_devices: List[str]) -> Dict[str, Any]:
    """Execute specific resilience strategy"""
    
    if strategy_type == "LOAD_BALANCING":
        return await execute_load_balancing(parameters, affected_devices)
    elif strategy_type == "FAILOVER":
        return await execute_failover(parameters, affected_devices)
    elif strategy_type == "CIRCUIT_BREAKER":
        return await execute_circuit_breaker(parameters, affected_devices)
    elif strategy_type == "RETRY_MECHANISM":
        return await execute_retry_mechanism(parameters, affected_devices)
    elif strategy_type == "GRACEFUL_DEGRADATION":
        return await execute_graceful_degradation(parameters, affected_devices)
    else:
        return await execute_generic_strategy(strategy_type, parameters, affected_devices)

async def execute_load_balancing(parameters: Dict[str, Any], devices: List[str]) -> Dict[str, Any]:
    """Execute load balancing strategy"""
    await asyncio.sleep(1)  # Simulate execution time
    
    algorithm = parameters.get("algorithm", "round_robin")
    threshold = parameters.get("threshold", 80)
    
    result = {
        "strategy": "LOAD_BALANCING",
        "algorithm": algorithm,
        "threshold": threshold,
        "devices_balanced": len(devices),
        "new_distribution": {device: f"{100/len(devices):.1f}%" for device in devices},
        "execution_time": "1000ms"
    }
    
    return result

async def execute_failover(parameters: Dict[str, Any], devices: List[str]) -> Dict[str, Any]:
    """Execute failover strategy"""
    await asyncio.sleep(1.5)  # Simulate execution time
    
    primary_device = parameters.get("primary_device")
    backup_devices = parameters.get("backup_devices", [])
    
    result = {
        "strategy": "FAILOVER",
        "primary_device": primary_device,
        "backup_devices": backup_devices,
        "failover_completed": True,
        "new_primary": backup_devices[0] if backup_devices else None,
        "execution_time": "1500ms"
    }
    
    return result

async def execute_circuit_breaker(parameters: Dict[str, Any], devices: List[str]) -> Dict[str, Any]:
    """Execute circuit breaker strategy"""
    await asyncio.sleep(0.5)  # Simulate execution time
    
    failure_threshold = parameters.get("failure_threshold", 5)
    timeout = parameters.get("timeout", 60)
    
    result = {
        "strategy": "CIRCUIT_BREAKER",
        "failure_threshold": failure_threshold,
        "timeout": timeout,
        "circuits_opened": len(devices),
        "affected_devices": devices,
        "execution_time": "500ms"
    }
    
    return result

async def execute_retry_mechanism(parameters: Dict[str, Any], devices: List[str]) -> Dict[str, Any]:
    """Execute retry mechanism strategy"""
    await asyncio.sleep(0.8)  # Simulate execution time
    
    max_retries = parameters.get("max_retries", 3)
    backoff_strategy = parameters.get("backoff_strategy", "exponential")
    
    result = {
        "strategy": "RETRY_MECHANISM",
        "max_retries": max_retries,
        "backoff_strategy": backoff_strategy,
        "retry_policies_updated": len(devices),
        "affected_devices": devices,
        "execution_time": "800ms"
    }
    
    return result

async def execute_graceful_degradation(parameters: Dict[str, Any], devices: List[str]) -> Dict[str, Any]:
    """Execute graceful degradation strategy"""
    await asyncio.sleep(1.2)  # Simulate execution time
    
    degradation_level = parameters.get("degradation_level", "partial")
    essential_services = parameters.get("essential_services", [])
    
    result = {
        "strategy": "GRACEFUL_DEGRADATION",
        "degradation_level": degradation_level,
        "essential_services": essential_services,
        "services_degraded": len(devices) * 2,  # Assume 2 services per device
        "affected_devices": devices,
        "execution_time": "1200ms"
    }
    
    return result

async def execute_generic_strategy(strategy_type: str, parameters: Dict[str, Any], devices: List[str]) -> Dict[str, Any]:
    """Execute generic resilience strategy"""
    await asyncio.sleep(1)  # Simulate execution time
    
    result = {
        "strategy": strategy_type,
        "parameters": parameters,
        "devices_processed": len(devices),
        "affected_devices": devices,
        "execution_time": "1000ms"
    }
    
    return result

@app.get("/api/v1/strategies")
async def list_resilience_strategies(active_only: bool = True):
    try:
        async with db_pool.acquire() as conn:
            if active_only:
                strategies = await conn.fetch("""
                    SELECT * FROM resilience_strategies 
                    WHERE active = true 
                    ORDER BY priority DESC, created_at DESC
                """)
            else:
                strategies = await conn.fetch("""
                    SELECT * FROM resilience_strategies 
                    ORDER BY priority DESC, created_at DESC
                """)
            
            return [
                {
                    "strategy_id": s['strategy_id'],
                    "strategy_type": s['strategy_type'],
                    "target_devices": json.loads(s['target_devices']),
                    "parameters": json.loads(s['parameters']),
                    "priority": s['priority'],
                    "active": s['active'],
                    "created_at": s['created_at'].isoformat()
                }
                for s in strategies
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list strategies: {str(e)}")

@app.get("/api/v1/executions/{execution_id}")
async def get_resilience_execution(execution_id: str):
    try:
        async with db_pool.acquire() as conn:
            execution = await conn.fetchrow("""
                SELECT * FROM resilience_executions WHERE execution_id = $1
            """, execution_id)
            
            if not execution:
                raise HTTPException(status_code=404, detail="Execution not found")
            
            return {
                "execution_id": execution['execution_id'],
                "strategy_id": execution['strategy_id'],
                "trigger_event": execution['trigger_event'],
                "affected_devices": json.loads(execution['affected_devices']),
                "status": execution['status'],
                "result": json.loads(execution['result'] or '{}'),
                "started_at": execution['started_at'].isoformat(),
                "completed_at": execution['completed_at'].isoformat() if execution['completed_at'] else None
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get execution: {str(e)}")

@app.get("/api/v1/executions")
async def list_resilience_executions(strategy_id: Optional[str] = None, status: Optional[str] = None):
    try:
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM resilience_executions WHERE 1=1"
            params = []
            
            if strategy_id:
                query += " AND strategy_id = $" + str(len(params) + 1)
                params.append(strategy_id)
            
            if status:
                query += " AND status = $" + str(len(params) + 1)
                params.append(status)
            
            query += " ORDER BY started_at DESC"
            
            executions = await conn.fetch(query, *params)
            
            return [
                {
                    "execution_id": e['execution_id'],
                    "strategy_id": e['strategy_id'],
                    "trigger_event": e['trigger_event'],
                    "affected_devices": json.loads(e['affected_devices']),
                    "status": e['status'],
                    "started_at": e['started_at'].isoformat(),
                    "completed_at": e['completed_at'].isoformat() if e['completed_at'] else None
                }
                for e in executions
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list executions: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False, log_level="info")

