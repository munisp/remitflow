"""
PostgreSQL HA Database Configuration for Mojaloop Services
Provides connection pooling, failover handling, and reconciliation support.

Features:
- Connection pooling with PgBouncer support
- Automatic failover handling
- Retry logic with exponential backoff
- Idempotency helpers
- TigerBeetle reconciliation support
"""
import os
import asyncio
import logging
import hashlib
from typing import Optional, Dict, Any, Callable, TypeVar, List
from datetime import datetime, timedelta
from decimal import Decimal
from functools import wraps
from contextlib import asynccontextmanager
from enum import Enum

import asyncpg
import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

T = TypeVar('T')


class DatabaseConfig:
    """HA Database configuration with environment-based settings"""
    
    # Primary connection (through PgBouncer)
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql://mojaloop:mojaloop@pgbouncer.remittance.svc.cluster.local:6432/mojaloop"
    )
    
    # Direct primary connection (for migrations and admin)
    DATABASE_URL_DIRECT = os.getenv(
        "DATABASE_URL_DIRECT",
        "postgresql://mojaloop:mojaloop@mojaloop-postgres-primary.remittance.svc.cluster.local:5432/mojaloop"
    )
    
    # Read replica connection (for read-heavy operations)
    DATABASE_URL_REPLICA = os.getenv(
        "DATABASE_URL_REPLICA",
        "postgresql://mojaloop:mojaloop@mojaloop-postgres-replica.remittance.svc.cluster.local:5432/mojaloop"
    )
    
    # Connection pool settings
    POOL_MIN_SIZE = int(os.getenv("DB_POOL_MIN_SIZE", "5"))
    POOL_MAX_SIZE = int(os.getenv("DB_POOL_MAX_SIZE", "20"))
    POOL_MAX_INACTIVE_CONNECTION_LIFETIME = int(os.getenv("DB_POOL_MAX_INACTIVE_LIFETIME", "300"))
    
    # Timeout settings
    COMMAND_TIMEOUT = int(os.getenv("DB_COMMAND_TIMEOUT", "60"))
    CONNECT_TIMEOUT = int(os.getenv("DB_CONNECT_TIMEOUT", "10"))
    
    # Retry settings
    MAX_RETRIES = int(os.getenv("DB_MAX_RETRIES", "3"))
    RETRY_DELAY_BASE = float(os.getenv("DB_RETRY_DELAY_BASE", "0.5"))
    RETRY_DELAY_MAX = float(os.getenv("DB_RETRY_DELAY_MAX", "10.0"))
    
    # TigerBeetle settings
    TIGERBEETLE_URL = os.getenv("TIGERBEETLE_URL", "http://localhost:8160")
    
    # Schema settings
    SCHEMA_PREFIX = os.getenv("DB_SCHEMA_PREFIX", "")


class ConnectionState(str, Enum):
    """Connection pool state"""
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    FAILED = "FAILED"


class HADatabasePool:
    """High-Availability Database Pool with failover support"""
    
    def __init__(self, config: DatabaseConfig = None):
        self.config = config or DatabaseConfig()
        self._primary_pool: Optional[asyncpg.Pool] = None
        self._replica_pool: Optional[asyncpg.Pool] = None
        self._state = ConnectionState.HEALTHY
        self._last_health_check: Optional[datetime] = None
        self._health_check_interval = timedelta(seconds=30)
    
    async def initialize(self) -> None:
        """Initialize connection pools"""
        try:
            self._primary_pool = await asyncpg.create_pool(
                self.config.DATABASE_URL,
                min_size=self.config.POOL_MIN_SIZE,
                max_size=self.config.POOL_MAX_SIZE,
                max_inactive_connection_lifetime=self.config.POOL_MAX_INACTIVE_CONNECTION_LIFETIME,
                command_timeout=self.config.COMMAND_TIMEOUT,
                timeout=self.config.CONNECT_TIMEOUT,
            )
            logger.info("Primary database pool initialized")
        except Exception as e:
            logger.error(f"Failed to initialize primary pool: {e}")
            self._state = ConnectionState.FAILED
            raise
        
        try:
            self._replica_pool = await asyncpg.create_pool(
                self.config.DATABASE_URL_REPLICA,
                min_size=self.config.POOL_MIN_SIZE,
                max_size=self.config.POOL_MAX_SIZE,
                max_inactive_connection_lifetime=self.config.POOL_MAX_INACTIVE_CONNECTION_LIFETIME,
                command_timeout=self.config.COMMAND_TIMEOUT,
                timeout=self.config.CONNECT_TIMEOUT,
            )
            logger.info("Replica database pool initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize replica pool (non-fatal): {e}")
            self._state = ConnectionState.DEGRADED
    
    async def close(self) -> None:
        """Close all connection pools"""
        if self._primary_pool:
            await self._primary_pool.close()
        if self._replica_pool:
            await self._replica_pool.close()
    
    @property
    def primary(self) -> asyncpg.Pool:
        """Get primary pool for read-write operations"""
        if not self._primary_pool:
            raise RuntimeError("Database pool not initialized")
        return self._primary_pool
    
    @property
    def replica(self) -> asyncpg.Pool:
        """Get replica pool for read-only operations (falls back to primary)"""
        return self._replica_pool or self._primary_pool
    
    async def health_check(self) -> Dict[str, Any]:
        """Perform health check on database connections"""
        result = {
            "state": self._state.value,
            "primary": False,
            "replica": False,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        try:
            async with self._primary_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
                result["primary"] = True
        except Exception as e:
            logger.error(f"Primary health check failed: {e}")
        
        if self._replica_pool:
            try:
                async with self._replica_pool.acquire() as conn:
                    await conn.fetchval("SELECT 1")
                    result["replica"] = True
            except Exception as e:
                logger.warning(f"Replica health check failed: {e}")
        
        # Update state based on health check
        if result["primary"]:
            self._state = ConnectionState.HEALTHY if result["replica"] else ConnectionState.DEGRADED
        else:
            self._state = ConnectionState.FAILED
        
        result["state"] = self._state.value
        self._last_health_check = datetime.utcnow()
        
        return result
    
    @asynccontextmanager
    async def acquire_with_retry(self, use_replica: bool = False):
        """Acquire connection with retry logic"""
        pool = self.replica if use_replica else self.primary
        last_error = None
        
        for attempt in range(self.config.MAX_RETRIES):
            try:
                async with pool.acquire() as conn:
                    yield conn
                    return
            except asyncpg.PostgresConnectionError as e:
                last_error = e
                delay = min(
                    self.config.RETRY_DELAY_BASE * (2 ** attempt),
                    self.config.RETRY_DELAY_MAX
                )
                logger.warning(f"Connection attempt {attempt + 1} failed, retrying in {delay}s: {e}")
                await asyncio.sleep(delay)
        
        raise last_error or RuntimeError("Failed to acquire connection")


# Global pool instance
_db_pool: Optional[HADatabasePool] = None


async def get_db_pool() -> HADatabasePool:
    """Get or create the global database pool"""
    global _db_pool
    if _db_pool is None:
        _db_pool = HADatabasePool()
        await _db_pool.initialize()
    return _db_pool


async def close_db_pool() -> None:
    """Close the global database pool"""
    global _db_pool
    if _db_pool:
        await _db_pool.close()
        _db_pool = None


# ==================== Idempotency Helpers ====================

def generate_deterministic_id(components: List[str]) -> str:
    """Generate deterministic ID from components for idempotency"""
    combined = ":".join(str(c) for c in components)
    return hashlib.sha256(combined.encode()).hexdigest()[:32]


def generate_idempotency_key(operation: str, *args) -> str:
    """Generate idempotency key for an operation"""
    components = [operation] + list(args)
    return generate_deterministic_id(components)


async def check_idempotency(
    conn: asyncpg.Connection,
    table: str,
    idempotency_key: str,
    schema: str = None
) -> Optional[Dict[str, Any]]:
    """Check if operation was already performed (idempotent check)"""
    schema_prefix = f"{schema}." if schema else ""
    
    result = await conn.fetchrow(f"""
        SELECT * FROM {schema_prefix}{table}
        WHERE idempotency_key = $1
    """, idempotency_key)
    
    return dict(result) if result else None


async def execute_idempotent(
    conn: asyncpg.Connection,
    table: str,
    idempotency_key: str,
    insert_query: str,
    insert_params: tuple,
    schema: str = None
) -> Dict[str, Any]:
    """Execute an idempotent insert operation"""
    # Check if already exists
    existing = await check_idempotency(conn, table, idempotency_key, schema)
    if existing:
        logger.info(f"Idempotent operation already completed: {idempotency_key}")
        return existing
    
    # Execute insert
    try:
        result = await conn.fetchrow(insert_query, *insert_params)
        return dict(result) if result else {}
    except asyncpg.UniqueViolationError:
        # Race condition - another process inserted first
        existing = await check_idempotency(conn, table, idempotency_key, schema)
        if existing:
            return existing
        raise


# ==================== State Transition Helpers ====================

async def transition_state(
    conn: asyncpg.Connection,
    table: str,
    id_column: str,
    id_value: Any,
    from_state: str,
    to_state: str,
    schema: str = None
) -> bool:
    """
    Perform compare-and-swap state transition.
    Returns True if transition succeeded, False if state was different.
    """
    schema_prefix = f"{schema}." if schema else ""
    
    result = await conn.execute(f"""
        UPDATE {schema_prefix}{table}
        SET state = $3, updated_at = NOW()
        WHERE {id_column} = $1 AND state = $2
    """, id_value, from_state, to_state)
    
    # Check if update affected any rows
    rows_affected = int(result.split()[-1])
    
    if rows_affected == 0:
        # Check current state
        current = await conn.fetchval(f"""
            SELECT state FROM {schema_prefix}{table}
            WHERE {id_column} = $1
        """, id_value)
        
        if current == to_state:
            # Already in target state (idempotent)
            logger.info(f"State already at {to_state} for {id_value}")
            return True
        else:
            logger.warning(f"State transition failed: expected {from_state}, found {current}")
            return False
    
    return True


# ==================== TigerBeetle Reconciliation ====================

class TigerBeetleReconciler:
    """Reconciles Postgres state with TigerBeetle truth"""
    
    def __init__(self, tigerbeetle_url: str = None):
        self.tigerbeetle_url = tigerbeetle_url or DatabaseConfig.TIGERBEETLE_URL
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def get_pending_transfer_status(self, pending_id: str) -> Optional[str]:
        """Get status of pending transfer from TigerBeetle"""
        try:
            response = await self.client.get(
                f"{self.tigerbeetle_url}/transfers/pending/{pending_id}"
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("status")
            elif response.status_code == 404:
                return "NOT_FOUND"
            return None
        except Exception as e:
            logger.error(f"Failed to get pending transfer status: {e}")
            return None
    
    async def reconcile_transfer(
        self,
        conn: asyncpg.Connection,
        transfer_id: str,
        tigerbeetle_pending_id: str,
        schema: str = "transfers"
    ) -> Dict[str, Any]:
        """
        Reconcile transfer state with TigerBeetle.
        TigerBeetle is the source of truth for monetary state.
        """
        result = {
            "transfer_id": transfer_id,
            "action": "none",
            "success": True,
            "message": ""
        }
        
        # Get TigerBeetle status
        tb_status = await self.get_pending_transfer_status(tigerbeetle_pending_id)
        
        if tb_status is None:
            result["success"] = False
            result["message"] = "Failed to get TigerBeetle status"
            return result
        
        # Get Postgres state
        pg_state = await conn.fetchval(f"""
            SELECT state FROM {schema}.transfers
            WHERE transfer_id = $1
        """, transfer_id)
        
        # Reconcile based on TigerBeetle truth
        if tb_status == "POSTED":
            # TigerBeetle shows committed - ensure Postgres matches
            if pg_state != "COMMITTED":
                await conn.execute(f"""
                    UPDATE {schema}.transfers
                    SET state = 'COMMITTED', updated_at = NOW(), completed_at = NOW()
                    WHERE transfer_id = $1
                """, transfer_id)
                result["action"] = "updated_to_committed"
                result["message"] = f"Reconciled state from {pg_state} to COMMITTED"
        
        elif tb_status == "VOIDED":
            # TigerBeetle shows aborted - ensure Postgres matches
            if pg_state not in ("ABORTED", "EXPIRED"):
                await conn.execute(f"""
                    UPDATE {schema}.transfers
                    SET state = 'ABORTED', updated_at = NOW(), completed_at = NOW()
                    WHERE transfer_id = $1
                """, transfer_id)
                result["action"] = "updated_to_aborted"
                result["message"] = f"Reconciled state from {pg_state} to ABORTED"
        
        elif tb_status == "PENDING":
            # Still pending - check for timeout
            expiration = await conn.fetchval(f"""
                SELECT expiration FROM {schema}.transfers
                WHERE transfer_id = $1
            """, transfer_id)
            
            if expiration and datetime.utcnow() > expiration:
                result["action"] = "timeout_detected"
                result["message"] = "Transfer expired but still pending in TigerBeetle"
        
        elif tb_status == "NOT_FOUND":
            # Pending transfer not found - may have been cleaned up
            if pg_state == "RESERVED":
                result["action"] = "orphan_detected"
                result["message"] = "Pending transfer not found in TigerBeetle"
        
        return result
    
    async def process_reconciliation_queue(
        self,
        conn: asyncpg.Connection,
        schema: str = "transfers",
        batch_size: int = 100
    ) -> List[Dict[str, Any]]:
        """Process pending reconciliation items"""
        results = []
        
        # Get pending items
        items = await conn.fetch(f"""
            SELECT transfer_id, tigerbeetle_pending_id, expected_action
            FROM {schema}.pending_reconciliation
            WHERE status = 'PENDING'
            ORDER BY created_at
            LIMIT $1
        """, batch_size)
        
        for item in items:
            try:
                result = await self.reconcile_transfer(
                    conn,
                    str(item['transfer_id']),
                    item['tigerbeetle_pending_id'],
                    schema
                )
                
                # Update reconciliation status
                await conn.execute(f"""
                    UPDATE {schema}.pending_reconciliation
                    SET status = 'COMPLETED', processed_at = NOW()
                    WHERE transfer_id = $1
                """, item['transfer_id'])
                
                results.append(result)
                
            except Exception as e:
                logger.error(f"Reconciliation failed for {item['transfer_id']}: {e}")
                
                # Update retry count
                await conn.execute(f"""
                    UPDATE {schema}.pending_reconciliation
                    SET retry_count = retry_count + 1, last_error = $2
                    WHERE transfer_id = $1
                """, item['transfer_id'], str(e))
                
                results.append({
                    "transfer_id": str(item['transfer_id']),
                    "success": False,
                    "message": str(e)
                })
        
        return results
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


# ==================== Migration Runner ====================

async def run_migrations(service_name: str, migrations_path: str) -> bool:
    """
    Run Alembic migrations for a service.
    Uses direct connection (not through PgBouncer) for DDL operations.
    """
    import subprocess
    
    env = os.environ.copy()
    env["DATABASE_URL"] = DatabaseConfig.DATABASE_URL_DIRECT
    
    try:
        result = subprocess.run(
            ["alembic", "-c", f"{migrations_path}/alembic.ini", 
             "-x", f"script_location={migrations_path}/{service_name}",
             "upgrade", "head"],
            env=env,
            capture_output=True,
            text=True,
            cwd=migrations_path
        )
        
        if result.returncode != 0:
            logger.error(f"Migration failed: {result.stderr}")
            return False
        
        logger.info(f"Migrations completed for {service_name}")
        return True
        
    except Exception as e:
        logger.error(f"Migration error: {e}")
        return False


# ==================== Decorators ====================

def with_retry(max_retries: int = 3, delay_base: float = 0.5):
    """Decorator for retrying database operations"""
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            last_error = None
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                    last_error = e
                    delay = min(delay_base * (2 ** attempt), 10.0)
                    logger.warning(f"Retry {attempt + 1}/{max_retries} after {delay}s: {e}")
                    await asyncio.sleep(delay)
            raise last_error
        return wrapper
    return decorator


def idempotent(table: str, key_generator: Callable[..., str], schema: str = None):
    """Decorator for idempotent database operations"""
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(conn: asyncpg.Connection, *args, **kwargs) -> T:
            idempotency_key = key_generator(*args, **kwargs)
            
            # Check if already executed
            existing = await check_idempotency(conn, table, idempotency_key, schema)
            if existing:
                logger.info(f"Returning cached result for {idempotency_key}")
                return existing
            
            # Execute function
            return await func(conn, *args, idempotency_key=idempotency_key, **kwargs)
        return wrapper
    return decorator
