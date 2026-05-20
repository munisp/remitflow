from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import settings

# SQLAlchemy setup
# The engine is the starting point for any SQLAlchemy application.
# It's an object that manages a connection pool and a dialect.
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
    pool_pre_ping=True
)

# SessionLocal is a factory for new Session objects.
# We will use it to create a new session for each request.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for our models to inherit from
Base = declarative_base()

# Dependency to get the database session
def get_db():
    """
    Dependency function that yields a new SQLAlchemy session for each request.
    It ensures the session is closed after the request is finished.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Function to create all tables in the database
def init_db():
    """
    Creates all defined tables in the database.
    This should be called at application startup (e.g., in main.py).
    """
    # Import all models here so that they are registered with Base.metadata
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)