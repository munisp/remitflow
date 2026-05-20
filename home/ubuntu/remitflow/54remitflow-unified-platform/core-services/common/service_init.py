"""
Shared Service Initialization Helper

Provides a consistent way to configure all services with:
- Structured logging with correlation IDs
- Rate limiting middleware
- CORS configuration (environment-driven)
- Secrets management

Usage:
    from fastapi import FastAPI
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
    from service_init import configure_service

    app = FastAPI(title="My Service", version="1.0.0")
    logger = configure_service(app, "my-service")
"""

import os
import logging
from typing import Optional, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Try to import common modules
try:
    from logging_config import setup_logging, LoggingMiddleware
    from rate_limiter import RateLimitMiddleware, RateLimitConfig
    from secrets_manager import get_secrets_manager
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False


def get_cors_origins() -> List[str]:
    """
    Get CORS allowed origins from environment.
    In development mode, allows all origins for easier local testing.
    """
    origins = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,http://localhost:8080").split(",")
    origins = [o.strip() for o in origins if o.strip()]
    
    # In development, add wildcard for easier testing
    if os.getenv("ENVIRONMENT", "development") == "development":
        if "*" not in origins:
            origins.append("*")
    
    return origins


def configure_service(
    app: FastAPI,
    service_name: str,
    enable_rate_limiting: bool = True,
    enable_logging_middleware: bool = True,
    custom_cors_origins: Optional[List[str]] = None
) -> logging.Logger:
    """
    Configure a FastAPI service with production-ready middleware.
    
    Args:
        app: FastAPI application instance
        service_name: Name of the service (used for logging)
        enable_rate_limiting: Whether to enable rate limiting middleware
        enable_logging_middleware: Whether to enable request/response logging
        custom_cors_origins: Custom CORS origins (overrides environment config)
        
    Returns:
        Configured logger for the service
    """
    # Setup logging
    if COMMON_MODULES_AVAILABLE:
        logger = setup_logging(service_name)
    else:
        logging.basicConfig(
            level=logging.INFO,
            format=f"%(asctime)s | %(levelname)s | {service_name} | %(name)s | %(message)s"
        )
        logger = logging.getLogger(service_name)
    
    # Add logging middleware (must be added before other middleware)
    if COMMON_MODULES_AVAILABLE and enable_logging_middleware:
        app.add_middleware(LoggingMiddleware, service_name=service_name)
    
    # Add rate limiting middleware
    if COMMON_MODULES_AVAILABLE and enable_rate_limiting:
        try:
            config = RateLimitConfig.from_env()
            app.add_middleware(RateLimitMiddleware, config=config)
        except Exception as e:
            logger.warning(f"Failed to configure rate limiting: {e}")
    
    # Configure CORS
    cors_origins = custom_cors_origins or get_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    logger.info(f"Service {service_name} configured with CORS origins: {cors_origins}")
    
    return logger


def get_database_url(service_name: str, default_db: str = None) -> str:
    """
    Get database URL from secrets or environment.
    
    Args:
        service_name: Name of the service
        default_db: Default database name if not specified
        
    Returns:
        Database URL string
    """
    if default_db is None:
        default_db = service_name.replace("-", "_")
    
    # Try secrets manager first
    if COMMON_MODULES_AVAILABLE:
        try:
            secrets = get_secrets_manager()
            db_url = secrets.get(f"{service_name.upper().replace('-', '_')}_DATABASE_URL")
            if db_url:
                return db_url
        except Exception:
            pass
    
    # Fall back to environment variable
    env_key = f"{service_name.upper().replace('-', '_')}_DATABASE_URL"
    db_url = os.getenv(env_key)
    if db_url:
        return db_url
    
    # Fall back to generic DATABASE_URL
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        return db_url
    
    # Default to local PostgreSQL
    return f"postgresql://postgres:postgres@localhost:5432/{default_db}"


def get_secret(key: str, default: str = None) -> Optional[str]:
    """
    Get a secret value from secrets manager or environment.
    
    Args:
        key: Secret key name
        default: Default value if not found
        
    Returns:
        Secret value or default
    """
    # Try secrets manager first
    if COMMON_MODULES_AVAILABLE:
        try:
            secrets = get_secrets_manager()
            value = secrets.get(key)
            if value:
                return value
        except Exception:
            pass
    
    # Fall back to environment variable
    return os.getenv(key, default)
