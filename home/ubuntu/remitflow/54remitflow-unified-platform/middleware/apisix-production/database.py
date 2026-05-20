from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

from config import settings
from models import Base

# Use a synchronous engine for simplicity with FastAPI's dependency injection
# For production, consider an async engine (e.g., asyncpg with SQLAlchemy 2.0)
engine = create_engine(
    settings.DATABASE_URL, 
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
    pool_pre_ping=True
)

# Create tables if they don't exist
def init_db():
    """Initializes the database and creates all tables."""
    Base.metadata.create_all(bind=engine)

# SessionLocal is the factory for new Session objects
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db() -> Generator[Session, None, None]:
    """Dependency to get a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Initialize the database on import
init_db()