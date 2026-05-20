"""
Shared Database Module for All Services
Provides PostgreSQL connection, session management, and base models
"""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session, declarative_base
from sqlalchemy.pool import QueuePool
from sqlalchemy.exc import SQLAlchemyError
import os
from contextlib import contextmanager
from typing import Generator
import logging

logger = logging.getLogger(__name__)

# Database configuration - each service can override with its own env var
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://remittance:remittance123@localhost:5432/remittance"
)

# Create engine with connection pooling
engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=20,
    max_overflow=40,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=os.getenv("SQL_ECHO", "false").lower() == "true"
)

# Create session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base class for ORM models
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    Dependency for FastAPI to get database session
    Usage: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_context():
    """
    Context manager for database session
    Usage: 
        with get_db_context() as db:
            # use db
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        db.close()


def init_db(base=None):
    """Initialize database tables"""
    target_base = base or Base
    target_base.metadata.create_all(bind=engine)
    logger.info("Database tables initialized")


def drop_db(base=None):
    """Drop all database tables (use with caution!)"""
    target_base = base or Base
    target_base.metadata.drop_all(bind=engine)
    logger.warning("Database tables dropped")


def check_db_connection() -> bool:
    """Check if database connection is healthy"""
    try:
        with engine.connect() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception as e:
        logger.error(f"Database connection check failed: {e}")
        return False


def get_service_db_url(service_name: str) -> str:
    """Get database URL for a specific service"""
    env_var = f"{service_name.upper().replace('-', '_')}_DATABASE_URL"
    return os.getenv(env_var, DATABASE_URL)


def create_service_engine(service_name: str):
    """Create a database engine for a specific service"""
    db_url = get_service_db_url(service_name)
    return create_engine(
        db_url,
        poolclass=QueuePool,
        pool_size=20,
        max_overflow=40,
        pool_pre_ping=True,
        pool_recycle=3600,
        echo=os.getenv("SQL_ECHO", "false").lower() == "true"
    )


def create_service_session(service_name: str):
    """Create a session factory for a specific service"""
    service_engine = create_service_engine(service_name)
    return sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=service_engine
    )
