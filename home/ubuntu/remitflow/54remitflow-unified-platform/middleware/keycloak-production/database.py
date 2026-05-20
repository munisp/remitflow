import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.exc import SQLAlchemyError
from typing import AsyncGenerator

from .config import settings
from .models import Base

# Configure logging
logger = logging.getLogger(__name__)

# Asynchronous database engine
try:
    # Assuming the DATABASE_URL is configured for async (e.g., postgresql+asyncpg://...)
    engine = create_async_engine(
        settings.DATABASE_URL, 
        echo=settings.DEBUG, 
        pool_size=20, 
        max_overflow=10
    )
except Exception as e:
    logger.error(f"Failed to create database engine: {e}")
    raise

# Asynchronous session maker
AsyncSessionLocal = async_sessionmaker(
    bind=engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

async def init_db():
    """Initializes the database by creating all tables."""
    async with engine.begin() as conn:
        # Import all modules here that might define models so that
        # they are registered properly on the metadata.
        # Base.metadata.create_all(bind=engine) - for sync
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialization complete.")

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency function to get an asynchronous database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except SQLAlchemyError as e:
            await session.rollback()
            logger.error(f"Database error in session: {e}")
            raise
        finally:
            await session.close()