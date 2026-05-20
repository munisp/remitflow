"""
Mojaloop Shared Components

This package provides shared utilities for Mojaloop services:
- database_ha: PostgreSQL HA connection pooling and failover
- reconciliation_service: TigerBeetle reconciliation
"""

from .database_ha import (
    HADatabasePool,
    get_db_pool,
    close_db_pool,
    DatabaseConfig,
    TigerBeetleReconciler,
    generate_deterministic_id,
    generate_idempotency_key,
    check_idempotency,
    execute_idempotent,
    transition_state,
    with_retry,
    idempotent,
    run_migrations,
)

__all__ = [
    "HADatabasePool",
    "get_db_pool",
    "close_db_pool",
    "DatabaseConfig",
    "TigerBeetleReconciler",
    "generate_deterministic_id",
    "generate_idempotency_key",
    "check_idempotency",
    "execute_idempotent",
    "transition_state",
    "with_retry",
    "idempotent",
    "run_migrations",
]
