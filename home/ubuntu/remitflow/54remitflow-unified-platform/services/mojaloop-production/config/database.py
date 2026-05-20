"""
PostgreSQL Database Client for Mojaloop
Implements persistent storage with connection pooling and resilience
"""

import logging
import asyncio
from typing import Dict, Any, List, Optional
from contextlib import asynccontextmanager
import asyncpg


logger = logging.getLogger(__name__)


class DatabaseConfig:
    """Database configuration"""
    
    def __init__(
        self,
        host: str = "localhost",
        port: int = 5432,
        database: str = "mojaloop",
        user: str = "mojaloop",
        password: str = "mojaloop_password",
        min_pool_size: int = 10,
        max_pool_size: int = 50,
        command_timeout: int = 30
    ):
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self.min_pool_size = min_pool_size
        self.max_pool_size = max_pool_size
        self.command_timeout = command_timeout
    
    @property
    def dsn(self) -> str:
        """Get database DSN"""
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"


class DatabaseClient:
    """Async PostgreSQL client with connection pooling"""
    
    def __init__(self, config: DatabaseConfig):
        self.config = config
        self.pool: Optional[asyncpg.Pool] = None
    
    async def connect(self):
        """Create connection pool"""
        try:
            self.pool = await asyncpg.create_pool(
                host=self.config.host,
                port=self.config.port,
                database=self.config.database,
                user=self.config.user,
                password=self.config.password,
                min_size=self.config.min_pool_size,
                max_size=self.config.max_pool_size,
                command_timeout=self.config.command_timeout
            )
            logger.info(f"Database pool created: {self.config.host}:{self.config.port}/{self.config.database}")
        except Exception as e:
            logger.error(f"Failed to create database pool: {e}")
            raise
    
    async def disconnect(self):
        """Close connection pool"""
        if self.pool:
            await self.pool.close()
            logger.info("Database pool closed")
    
    @asynccontextmanager
    async def acquire(self):
        """Acquire connection from pool"""
        if not self.pool:
            raise RuntimeError("Database pool not initialized")
        
        async with self.pool.acquire() as connection:
            yield connection
    
    async def execute(self, query: str, *args) -> str:
        """Execute a query"""
        async with self.acquire() as conn:
            return await conn.execute(query, *args)
    
    async def fetch(self, query: str, *args) -> List[asyncpg.Record]:
        """Fetch multiple rows"""
        async with self.acquire() as conn:
            return await conn.fetch(query, *args)
    
    async def fetchrow(self, query: str, *args) -> Optional[asyncpg.Record]:
        """Fetch single row"""
        async with self.acquire() as conn:
            return await conn.fetchrow(query, *args)
    
    async def fetchval(self, query: str, *args):
        """Fetch single value"""
        async with self.acquire() as conn:
            return await conn.fetchval(query, *args)


class ParticipantRepository:
    """Repository for participant operations"""
    
    def __init__(self, db_client: DatabaseClient):
        self.db = db_client
    
    async def create(self, participant_data: Dict[str, Any]) -> str:
        """Create a new participant"""
        query = """
            INSERT INTO mojaloop.participants 
            (participant_id, name, type, currency, status, endpoints, capabilities, settlement_model)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING participant_id
        """
        return await self.db.fetchval(
            query,
            participant_data["participant_id"],
            participant_data["name"],
            participant_data.get("type", "DFSP"),
            participant_data.get("currency", "NGN"),
            participant_data.get("status", "ACTIVE"),
            participant_data.get("endpoints"),
            participant_data.get("capabilities"),
            participant_data.get("settlement_model", "DEFERRED_NET")
        )
    
    async def get(self, participant_id: str) -> Optional[Dict[str, Any]]:
        """Get participant by ID"""
        query = "SELECT * FROM mojaloop.participants WHERE participant_id = $1"
        row = await self.db.fetchrow(query, participant_id)
        return dict(row) if row else None
    
    async def update(self, participant_id: str, updates: Dict[str, Any]) -> bool:
        """Update participant"""
        set_clauses = [f"{key} = ${i+2}" for i, key in enumerate(updates.keys())]
        query = f"""
            UPDATE mojaloop.participants 
            SET {', '.join(set_clauses)}
            WHERE participant_id = $1
        """
        result = await self.db.execute(query, participant_id, *updates.values())
        return "UPDATE 1" in result
    
    async def list_all(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all participants"""
        if status:
            query = "SELECT * FROM mojaloop.participants WHERE status = $1 ORDER BY created_at DESC"
            rows = await self.db.fetch(query, status)
        else:
            query = "SELECT * FROM mojaloop.participants ORDER BY created_at DESC"
            rows = await self.db.fetch(query)
        
        return [dict(row) for row in rows]


class QuoteRepository:
    """Repository for quote operations"""
    
    def __init__(self, db_client: DatabaseClient):
        self.db = db_client
    
    async def create(self, quote_data: Dict[str, Any]) -> str:
        """Create a new quote"""
        query = """
            INSERT INTO mojaloop.quotes 
            (quote_id, transaction_id, payer_fsp, payee_fsp, amount, currency, fees, 
             transfer_amount, exchange_rate, expiration, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING quote_id
        """
        return await self.db.fetchval(
            query,
            quote_data["quote_id"],
            quote_data["transaction_id"],
            quote_data["payer_fsp"],
            quote_data["payee_fsp"],
            quote_data["amount"],
            quote_data["currency"],
            quote_data.get("fees", 0),
            quote_data["transfer_amount"],
            quote_data.get("exchange_rate"),
            quote_data["expiration"],
            quote_data.get("status", "PENDING")
        )
    
    async def get(self, quote_id: str) -> Optional[Dict[str, Any]]:
        """Get quote by ID"""
        query = "SELECT * FROM mojaloop.quotes WHERE quote_id = $1"
        row = await self.db.fetchrow(query, quote_id)
        return dict(row) if row else None
    
    async def update_status(self, quote_id: str, status: str) -> bool:
        """Update quote status"""
        query = "UPDATE mojaloop.quotes SET status = $2 WHERE quote_id = $1"
        result = await self.db.execute(query, quote_id, status)
        return "UPDATE 1" in result


class TransferRepository:
    """Repository for transfer operations"""
    
    def __init__(self, db_client: DatabaseClient):
        self.db = db_client
    
    async def create(self, transfer_data: Dict[str, Any]) -> str:
        """Create a new transfer"""
        query = """
            INSERT INTO mojaloop.transfers 
            (transfer_id, quote_id, payer_fsp, payee_fsp, amount, currency, 
             condition, expiration, transfer_state)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING transfer_id
        """
        return await self.db.fetchval(
            query,
            transfer_data["transfer_id"],
            transfer_data.get("quote_id"),
            transfer_data["payer_fsp"],
            transfer_data["payee_fsp"],
            transfer_data["amount"],
            transfer_data["currency"],
            transfer_data["condition"],
            transfer_data["expiration"],
            transfer_data.get("transfer_state", "RESERVED")
        )
    
    async def get(self, transfer_id: str) -> Optional[Dict[str, Any]]:
        """Get transfer by ID"""
        query = "SELECT * FROM mojaloop.transfers WHERE transfer_id = $1"
        row = await self.db.fetchrow(query, transfer_id)
        return dict(row) if row else None
    
    async def update_state(self, transfer_id: str, state: str, fulfillment: Optional[str] = None) -> bool:
        """Update transfer state"""
        if fulfillment:
            query = """
                UPDATE mojaloop.transfers 
                SET transfer_state = $2, fulfillment = $3, completed_timestamp = NOW()
                WHERE transfer_id = $1
            """
            result = await self.db.execute(query, transfer_id, state, fulfillment)
        else:
            query = "UPDATE mojaloop.transfers SET transfer_state = $2 WHERE transfer_id = $1"
            result = await self.db.execute(query, transfer_id, state)
        
        return "UPDATE 1" in result


class SettlementRepository:
    """Repository for settlement operations"""
    
    def __init__(self, db_client: DatabaseClient):
        self.db = db_client
    
    async def create_window(self, reason: str = "Scheduled settlement window") -> int:
        """Create a new settlement window"""
        query = """
            INSERT INTO mojaloop.settlement_windows (state, reason)
            VALUES ('OPEN', $1)
            RETURNING settlement_window_id
        """
        return await self.db.fetchval(query, reason)
    
    async def close_window(self, window_id: int) -> bool:
        """Close a settlement window"""
        query = """
            UPDATE mojaloop.settlement_windows 
            SET state = 'CLOSED', changed_at = NOW()
            WHERE settlement_window_id = $1
        """
        result = await self.db.execute(query, window_id)
        return "UPDATE 1" in result
    
    async def get_current_window(self) -> Optional[int]:
        """Get current open settlement window"""
        query = """
            SELECT settlement_window_id 
            FROM mojaloop.settlement_windows 
            WHERE state = 'OPEN'
            ORDER BY created_at DESC
            LIMIT 1
        """
        return await self.db.fetchval(query)


# Resilience patterns

class CircuitBreaker:
    """Circuit breaker for database operations"""
    
    def __init__(self, failure_threshold: int = 5, timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failure_count = 0
        self.last_failure_time = None
        self.state = "CLOSED"
    
    async def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker"""
        if self.state == "OPEN":
            if self.should_attempt_reset():
                self.state = "HALF_OPEN"
            else:
                raise Exception("Circuit breaker is OPEN")
        
        try:
            result = await func(*args, **kwargs)
            self.on_success()
            return result
        except Exception as e:
            self.on_failure()
            raise
    
    def on_success(self):
        """Handle successful call"""
        self.failure_count = 0
        if self.state == "HALF_OPEN":
            self.state = "CLOSED"
    
    def on_failure(self):
        """Handle failed call"""
        import time
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.failure_count >= self.failure_threshold:
            self.state = "OPEN"
            logger.warning("Database circuit breaker opened")
    
    def should_attempt_reset(self) -> bool:
        """Check if should attempt reset"""
        import time
        if self.last_failure_time:
            return (time.time() - self.last_failure_time) >= self.timeout
        return False

