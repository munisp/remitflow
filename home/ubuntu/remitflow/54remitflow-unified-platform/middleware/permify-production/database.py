from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from config import settings
import logging

logger = logging.getLogger(__name__)

# The engine is the starting point for any SQLAlchemy application.
# It's a factory for connections to the database.
# We use create_async_engine for asynchronous operations.
engine = create_async_engine(
    str(settings.DATABASE_URL.get_secret_value()),
    echo=settings.DEBUG, # Echo SQL statements if debug is enabled
)

# Session factory for creating new AsyncSession objects.
# expire_on_commit=False is important for async sessions to prevent
# objects from being detached after a commit.
AsyncSessionLocal = async_sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

class Base(DeclarativeBase):
    """Base class which provides automated table name
    and a primary key column.
    """
    pass

# Dependency to get a database session
async def get_db_session() -> AsyncSession:
    """
    Dependency function that yields a new database session.
    The session is automatically closed after the request is finished.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception as e:
            logger.error(f"Database session error: {e}")
            await session.rollback()
            raise
        finally:
            await session.close()

# Function to create all tables (for initial setup or testing)
async def init_db():
    """
    Initializes the database by creating all tables defined in Base.
    """
    async with engine.begin() as conn:
        # Import all modules that define models so that Base.metadata.create_all
        # knows about them.
        from . import models # This assumes models.py will be in the same directory
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialization complete.")