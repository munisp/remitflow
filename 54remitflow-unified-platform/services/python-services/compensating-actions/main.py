#!/usr/bin/env python3
"""
Compensating Actions Framework for Remittance Platform
Handles rollback and compensation for failed distributed transactions
No mocks, no placeholders - production ready
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, asdict
from contextlib import asynccontextmanager
import uuid
from enum import Enum

import asyncpg
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import uvicorn
import httpx
from prometheus_client import Counter, Histogram, Gauge, generate_latest

# =====================================================
# CONFIGURATION
# =====================================================

@dataclass
class Config:
    """Application configuration"""
    # Database
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: int = int(os.getenv("DB_PORT", "5432"))
    db_name: str = os.getenv("DB_NAME", "remittance_network")
    db_user: str = os.getenv("DB_USER", "postgres")
    db_password: str = os.getenv("DB_PASSWORD", "password")
    
    # Redis
    redis_host: str = os.getenv("REDIS_HOST", "localhost")
    redis_port: int = int(os.getenv("REDIS_PORT", "6379"))
    redis_db: int = int(os.getenv("REDIS_DB", "0"))
    
    # Compensation settings
    max_retry_attempts: int = int(os.getenv("MAX_RETRY_ATTEMPTS", "3"))
    retry_delay_seconds: int = int(os.getenv("RETRY_DELAY_SECONDS", "5"))
    compensation_timeout: int = int(os.getenv("COMPENSATION_TIMEOUT", "300"))

config = Config()

# =====================================================
# ENUMS AND TYPES
# =====================================================

class CompensationStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"

class ActionType(str, Enum):
    HTTP_REQUEST = "http_request"
    DATABASE_OPERATION = "database_operation"
    MESSAGE_QUEUE = "message_queue"
    FILE_OPERATION = "file_operation"
    EXTERNAL_API = "external_api"
    CUSTOM_FUNCTION = "custom_function"

class CompensationPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

# =====================================================
# DATA MODELS
# =====================================================

@dataclass
class CompensationAction:
    """Represents a single compensation action"""
    id: str
    transaction_id: str
    saga_id: Optional[str]
    action_type: ActionType
    priority: CompensationPriority
    status: CompensationStatus
    original_operation: Dict[str, Any]
    compensation_operation: Dict[str, Any]
    retry_count: int
    max_retries: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    failed_at: Optional[datetime]
    error_message: Optional[str]
    metadata: Dict[str, Any]

@dataclass
class CompensationTransaction:
    """Represents a group of related compensation actions"""
    id: str
    name: str
    status: CompensationStatus
    actions: List[CompensationAction]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    total_actions: int
    completed_actions: int
    failed_actions: int
    metadata: Dict[str, Any]

# =====================================================
# METRICS
# =====================================================

compensation_actions_total = Counter('compensation_actions_total', 'Total compensation actions', ['status'])
compensation_duration = Histogram('compensation_duration_seconds', 'Compensation action duration')
compensation_retries = Counter('compensation_retries_total', 'Total compensation retries')
active_compensations = Gauge('active_compensations', 'Currently active compensations')

# =====================================================
# DATABASE MANAGER
# =====================================================

class DatabaseManager:
    """Manages database connections"""
    
    def __init__(self):
        self.postgres_pool = None
        self.redis_client = None
        self.http_client = httpx.AsyncClient(timeout=30.0)
    
    async def initialize(self):
        """Initialize database connections"""
        # PostgreSQL connection
        dsn = f"postgresql://{config.db_user}:{config.db_password}@{config.db_host}:{config.db_port}/{config.db_name}"
        self.postgres_pool = await asyncpg.create_pool(dsn, min_size=5, max_size=20)
        
        # Redis connection
        self.redis_client = redis.Redis(
            host=config.redis_host,
            port=config.redis_port,
            db=config.redis_db,
            decode_responses=True
        )
        
        # Test connections
        async with self.postgres_pool.acquire() as conn:
            await conn.execute("SELECT 1")
        
        await self.redis_client.ping()
        
        logging.info("Database connections initialized")
    
    async def close(self):
        """Close database connections"""
        if self.postgres_pool:
            await self.postgres_pool.close()
        if self.redis_client:
            await self.redis_client.close()
        await self.http_client.aclose()

db_manager = DatabaseManager()

# =====================================================
# COMPENSATION HANDLERS
# =====================================================

class CompensationHandler:
    """Base class for compensation handlers"""
    
    async def execute(self, action: CompensationAction) -> bool:
        """Execute compensation action"""
                # This is an abstract method. Subclasses should implement this.
        pass
    
    async def validate(self, action: CompensationAction) -> bool:
        """Validate compensation action"""
        return True

class HTTPCompensationHandler(CompensationHandler):
    """Handles HTTP-based compensation actions"""
    
    async def execute(self, action: CompensationAction) -> bool:
        """Execute HTTP compensation"""
        try:
            operation = action.compensation_operation
            
            method = operation.get('method', 'POST').upper()
            url = operation.get('url')
            headers = operation.get('headers', {})
            data = operation.get('data', {})
            timeout = operation.get('timeout', 30)
            
            if not url:
                raise ValueError("URL is required for HTTP compensation")
            
            # Add compensation metadata
            headers['X-Compensation-ID'] = action.id
            headers['X-Transaction-ID'] = action.transaction_id
            headers['Content-Type'] = 'application/json'
            
            # Make HTTP request
            response = await db_manager.http_client.request(
                method=method,
                url=url,
                headers=headers,
                json=data,
                timeout=timeout
            )
            
            # Check response
            if 200 <= response.status_code < 300:
                logging.info(f"HTTP compensation successful: {action.id}")
                return True
            else:
                logging.error(f"HTTP compensation failed: {action.id}, status: {response.status_code}")
                return False
                
        except Exception as e:
            logging.error(f"HTTP compensation error: {action.id}, error: {e}")
            return False

class DatabaseCompensationHandler(CompensationHandler):
    """Handles database-based compensation actions"""
    
    async def execute(self, action: CompensationAction) -> bool:
        """Execute database compensation"""
        try:
            operation = action.compensation_operation
            
            query = operation.get('query')
            params = operation.get('params', [])
            
            if not query:
                raise ValueError("Query is required for database compensation")
            
            async with db_manager.postgres_pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(query, *params)
            
            logging.info(f"Database compensation successful: {action.id}")
            return True
            
        except Exception as e:
            logging.error(f"Database compensation error: {action.id}, error: {e}")
            return False

class MessageQueueCompensationHandler(CompensationHandler):
    """Handles message queue-based compensation actions"""
    
    async def execute(self, action: CompensationAction) -> bool:
        """Execute message queue compensation"""
        try:
            operation = action.compensation_operation
            
            queue_name = operation.get('queue_name')
            message = operation.get('message', {})
            
            if not queue_name:
                raise ValueError("Queue name is required for message queue compensation")
            
            # Add compensation metadata
            message['compensation_id'] = action.id
            message['transaction_id'] = action.transaction_id
            message['timestamp'] = datetime.now(timezone.utc).isoformat()
            
            # Publish to Redis queue
            await db_manager.redis_client.lpush(queue_name, json.dumps(message))
            
            logging.info(f"Message queue compensation successful: {action.id}")
            return True
            
        except Exception as e:
            logging.error(f"Message queue compensation error: {action.id}, error: {e}")
            return False

class CustomFunctionCompensationHandler(CompensationHandler):
    """Handles custom function-based compensation actions"""
    
    def __init__(self):
        self.functions = {}
    
    def register_function(self, name: str, func: Callable):
        """Register a custom compensation function"""
        self.functions[name] = func
    
    async def execute(self, action: CompensationAction) -> bool:
        """Execute custom function compensation"""
        try:
            operation = action.compensation_operation
            
            function_name = operation.get('function_name')
            args = operation.get('args', [])
            kwargs = operation.get('kwargs', {})
            
            if not function_name:
                raise ValueError("Function name is required for custom function compensation")
            
            if function_name not in self.functions:
                raise ValueError(f"Function not registered: {function_name}")
            
            func = self.functions[function_name]
            
            # Execute function
            if asyncio.iscoroutinefunction(func):
                result = await func(action, *args, **kwargs)
            else:
                result = func(action, *args, **kwargs)
            
            logging.info(f"Custom function compensation successful: {action.id}")
            return bool(result)
            
        except Exception as e:
            logging.error(f"Custom function compensation error: {action.id}, error: {e}")
            return False

# =====================================================
# COMPENSATION ENGINE
# =====================================================

class CompensationEngine:
    """Core compensation engine"""
    
    def __init__(self):
        self.handlers = {
            ActionType.HTTP_REQUEST: HTTPCompensationHandler(),
            ActionType.DATABASE_OPERATION: DatabaseCompensationHandler(),
            ActionType.MESSAGE_QUEUE: MessageQueueCompensationHandler(),
            ActionType.CUSTOM_FUNCTION: CustomFunctionCompensationHandler(),
        }
        self.active_compensations = {}
        self.logger = logging.getLogger(__name__)
    
    async def create_compensation_action(
        self,
        transaction_id: str,
        action_type: ActionType,
        original_operation: Dict[str, Any],
        compensation_operation: Dict[str, Any],
        priority: CompensationPriority = CompensationPriority.MEDIUM,
        saga_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> CompensationAction:
        """Create a new compensation action"""
        
        action = CompensationAction(
            id=str(uuid.uuid4()),
            transaction_id=transaction_id,
            saga_id=saga_id,
            action_type=action_type,
            priority=priority,
            status=CompensationStatus.PENDING,
            original_operation=original_operation,
            compensation_operation=compensation_operation,
            retry_count=0,
            max_retries=config.max_retry_attempts,
            created_at=datetime.now(timezone.utc),
            started_at=None,
            completed_at=None,
            failed_at=None,
            error_message=None,
            metadata=metadata or {}
        )
        
        # Save to database
        await self._save_compensation_action(action)
        
        # Cache in Redis
        await self._cache_compensation_action(action)
        
        self.logger.info(f"Created compensation action: {action.id}")
        return action
    
    async def execute_compensation_action(self, action_id: str) -> bool:
        """Execute a single compensation action"""
        action = await self._get_compensation_action(action_id)
        if not action:
            raise ValueError(f"Compensation action not found: {action_id}")
        
        if action.status != CompensationStatus.PENDING:
            raise ValueError(f"Compensation action not in pending status: {action_id}")
        
        # Update status
        action.status = CompensationStatus.IN_PROGRESS
        action.started_at = datetime.now(timezone.utc)
        await self._save_compensation_action(action)
        
        active_compensations.inc()
        compensation_actions_total.labels(status='started').inc()
        
        try:
            with compensation_duration.time():
                # Get handler
                handler = self.handlers.get(action.action_type)
                if not handler:
                    raise ValueError(f"No handler for action type: {action.action_type}")
                
                # Validate action
                if not await handler.validate(action):
                    raise ValueError("Compensation action validation failed")
                
                # Execute compensation
                success = await handler.execute(action)
                
                if success:
                    action.status = CompensationStatus.COMPLETED
                    action.completed_at = datetime.now(timezone.utc)
                    compensation_actions_total.labels(status='completed').inc()
                    self.logger.info(f"Compensation action completed: {action_id}")
                else:
                    raise Exception("Compensation execution failed")
                    
        except Exception as e:
            action.retry_count += 1
            action.error_message = str(e)
            
            if action.retry_count >= action.max_retries:
                action.status = CompensationStatus.FAILED
                action.failed_at = datetime.now(timezone.utc)
                compensation_actions_total.labels(status='failed').inc()
                self.logger.error(f"Compensation action failed permanently: {action_id}")
            else:
                action.status = CompensationStatus.PENDING
                compensation_retries.inc()
                self.logger.warning(f"Compensation action retry {action.retry_count}: {action_id}")
                
                # Schedule retry
                asyncio.create_task(self._schedule_retry(action))
        
        finally:
            active_compensations.dec()
            await self._save_compensation_action(action)
            await self._cache_compensation_action(action)
        
        return action.status == CompensationStatus.COMPLETED
    
    async def execute_compensation_transaction(self, transaction_id: str) -> bool:
        """Execute all compensation actions for a transaction"""
        actions = await self._get_compensation_actions_by_transaction(transaction_id)
        if not actions:
            self.logger.warning(f"No compensation actions found for transaction: {transaction_id}")
            return True
        
        # Sort by priority (critical first)
        priority_order = {
            CompensationPriority.CRITICAL: 0,
            CompensationPriority.HIGH: 1,
            CompensationPriority.MEDIUM: 2,
            CompensationPriority.LOW: 3
        }
        actions.sort(key=lambda a: priority_order.get(a.priority, 999))
        
        success_count = 0
        
        for action in actions:
            if action.status == CompensationStatus.PENDING:
                try:
                    success = await self.execute_compensation_action(action.id)
                    if success:
                        success_count += 1
                except Exception as e:
                    self.logger.error(f"Failed to execute compensation action {action.id}: {e}")
        
        total_actions = len(actions)
        self.logger.info(f"Compensation transaction completed: {success_count}/{total_actions} actions successful")
        
        return success_count == total_actions
    
    async def cancel_compensation_action(self, action_id: str) -> bool:
        """Cancel a pending compensation action"""
        action = await self._get_compensation_action(action_id)
        if not action:
            return False
        
        if action.status == CompensationStatus.PENDING:
            action.status = CompensationStatus.CANCELLED
            await self._save_compensation_action(action)
            await self._cache_compensation_action(action)
            self.logger.info(f"Compensation action cancelled: {action_id}")
            return True
        
        return False
    
    async def get_compensation_status(self, transaction_id: str) -> Dict[str, Any]:
        """Get compensation status for a transaction"""
        actions = await self._get_compensation_actions_by_transaction(transaction_id)
        
        status_counts = {}
        for action in actions:
            status_counts[action.status] = status_counts.get(action.status, 0) + 1
        
        return {
            'transaction_id': transaction_id,
            'total_actions': len(actions),
            'status_counts': status_counts,
            'actions': [asdict(action) for action in actions]
        }
    
    async def _schedule_retry(self, action: CompensationAction):
        """Schedule a retry for a failed compensation action"""
        delay = config.retry_delay_seconds * (2 ** (action.retry_count - 1))  # Exponential backoff
        await asyncio.sleep(delay)
        
        try:
            await self.execute_compensation_action(action.id)
        except Exception as e:
            self.logger.error(f"Retry failed for compensation action {action.id}: {e}")
    
    async def _save_compensation_action(self, action: CompensationAction):
        """Save compensation action to database"""
        async with db_manager.postgres_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO compensation_actions 
                (id, transaction_id, saga_id, action_type, priority, status,
                 original_operation, compensation_operation, retry_count, max_retries,
                 created_at, started_at, completed_at, failed_at, error_message, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    retry_count = EXCLUDED.retry_count,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    failed_at = EXCLUDED.failed_at,
                    error_message = EXCLUDED.error_message
            """, action.id, action.transaction_id, action.saga_id, action.action_type,
                action.priority, action.status, json.dumps(action.original_operation),
                json.dumps(action.compensation_operation), action.retry_count,
                action.max_retries, action.created_at, action.started_at,
                action.completed_at, action.failed_at, action.error_message,
                json.dumps(action.metadata))
    
    async def _cache_compensation_action(self, action: CompensationAction):
        """Cache compensation action in Redis"""
        key = f"compensation_action:{action.id}"
        data = json.dumps(asdict(action), default=str)
        await db_manager.redis_client.setex(key, 3600, data)  # 1 hour TTL
    
    async def _get_compensation_action(self, action_id: str) -> Optional[CompensationAction]:
        """Get compensation action by ID"""
        # Try cache first
        key = f"compensation_action:{action_id}"
        cached_data = await db_manager.redis_client.get(key)
        
        if cached_data:
            data = json.loads(cached_data)
            return CompensationAction(**data)
        
        # Query database
        async with db_manager.postgres_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM compensation_actions WHERE id = $1
            """, action_id)
            
            if row:
                action = CompensationAction(
                    id=row['id'],
                    transaction_id=row['transaction_id'],
                    saga_id=row['saga_id'],
                    action_type=ActionType(row['action_type']),
                    priority=CompensationPriority(row['priority']),
                    status=CompensationStatus(row['status']),
                    original_operation=json.loads(row['original_operation']),
                    compensation_operation=json.loads(row['compensation_operation']),
                    retry_count=row['retry_count'],
                    max_retries=row['max_retries'],
                    created_at=row['created_at'],
                    started_at=row['started_at'],
                    completed_at=row['completed_at'],
                    failed_at=row['failed_at'],
                    error_message=row['error_message'],
                    metadata=json.loads(row['metadata']) if row['metadata'] else {}
                )
                
                # Cache result
                await self._cache_compensation_action(action)
                return action
        
        return None
    
    async def _get_compensation_actions_by_transaction(self, transaction_id: str) -> List[CompensationAction]:
        """Get all compensation actions for a transaction"""
        actions = []
        
        async with db_manager.postgres_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM compensation_actions 
                WHERE transaction_id = $1 
                ORDER BY created_at ASC
            """, transaction_id)
            
            for row in rows:
                action = CompensationAction(
                    id=row['id'],
                    transaction_id=row['transaction_id'],
                    saga_id=row['saga_id'],
                    action_type=ActionType(row['action_type']),
                    priority=CompensationPriority(row['priority']),
                    status=CompensationStatus(row['status']),
                    original_operation=json.loads(row['original_operation']),
                    compensation_operation=json.loads(row['compensation_operation']),
                    retry_count=row['retry_count'],
                    max_retries=row['max_retries'],
                    created_at=row['created_at'],
                    started_at=row['started_at'],
                    completed_at=row['completed_at'],
                    failed_at=row['failed_at'],
                    error_message=row['error_message'],
                    metadata=json.loads(row['metadata']) if row['metadata'] else {}
                )
                actions.append(action)
        
        return actions

# =====================================================
# FASTAPI APPLICATION
# =====================================================

compensation_engine = CompensationEngine()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    await db_manager.initialize()
    logging.info("Compensating Actions Service started")
    
    yield
    
    # Shutdown
    await db_manager.close()
    logging.info("Compensating Actions Service stopped")

app = FastAPI(
    title="Compensating Actions Service",
    description="Handles rollback and compensation for failed distributed transactions",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================================
# API ENDPOINTS
# =====================================================

class CreateCompensationActionRequest(BaseModel):
    transaction_id: str
    action_type: ActionType
    original_operation: Dict[str, Any]
    compensation_operation: Dict[str, Any]
    priority: CompensationPriority = CompensationPriority.MEDIUM
    saga_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

@app.post("/api/v1/compensation-actions")
async def create_compensation_action(request: CreateCompensationActionRequest):
    """Create a new compensation action"""
    action = await compensation_engine.create_compensation_action(
        transaction_id=request.transaction_id,
        action_type=request.action_type,
        original_operation=request.original_operation,
        compensation_operation=request.compensation_operation,
        priority=request.priority,
        saga_id=request.saga_id,
        metadata=request.metadata
    )
    
    return asdict(action)

@app.post("/api/v1/compensation-actions/{action_id}/execute")
async def execute_compensation_action(action_id: str):
    """Execute a compensation action"""
    success = await compensation_engine.execute_compensation_action(action_id)
    return {"success": success, "action_id": action_id}

@app.post("/api/v1/transactions/{transaction_id}/compensate")
async def compensate_transaction(transaction_id: str):
    """Execute all compensation actions for a transaction"""
    success = await compensation_engine.execute_compensation_transaction(transaction_id)
    return {"success": success, "transaction_id": transaction_id}

@app.delete("/api/v1/compensation-actions/{action_id}")
async def cancel_compensation_action(action_id: str):
    """Cancel a pending compensation action"""
    success = await compensation_engine.cancel_compensation_action(action_id)
    if not success:
        raise HTTPException(status_code=404, detail="Compensation action not found or cannot be cancelled")
    return {"success": True, "action_id": action_id}

@app.get("/api/v1/transactions/{transaction_id}/compensation-status")
async def get_compensation_status(transaction_id: str):
    """Get compensation status for a transaction"""
    status = await compensation_engine.get_compensation_status(transaction_id)
    return status

@app.get("/api/v1/compensation-actions/{action_id}")
async def get_compensation_action(action_id: str):
    """Get compensation action details"""
    action = await compensation_engine._get_compensation_action(action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Compensation action not found")
    return asdict(action)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "compensating-actions",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@app.get("/metrics")
async def get_metrics():
    """Prometheus metrics endpoint"""
    return generate_latest()

# =====================================================
# MAIN FUNCTION
# =====================================================

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    port = int(os.getenv("PORT", "8112"))
    uvicorn.run(app, host="0.0.0.0", port=port)

