import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .router import router
from .service import ServiceException

# --- Logging Configuration ---

def configure_logging():
    """Configures application-wide logging."""
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    logging.basicConfig(
        level=settings.LOG_LEVEL,
        format=log_format,
        stream=sys.stdout
    )
    # Set a higher logging level for uvicorn to avoid excessive output
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

configure_logging()
logger = logging.getLogger(__name__)

# --- Application Lifespan ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles startup and shutdown events."""
    logger.info(f"Starting up {settings.SERVICE_NAME}...")
    
    # Initialize database tables
    try:
        await init_db()
        logger.info("Database tables initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        # Depending on production requirements, you might want to exit here
        # sys.exit(1)
    
    yield
    
    logger.info(f"Shutting down {settings.SERVICE_NAME}...")

# --- FastAPI Application Initialization ---

app = FastAPI(
    title=settings.SERVICE_NAME.replace('-', ' ').title(),
    description="A dedicated service for managing application-specific Keycloak client configurations and protected resources.",
    version="1.0.0",
    debug=settings.DEBUG,
    lifespan=lifespan
)

# --- Middleware ---

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Should be restricted in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Exception Handlers ---

@app.exception_handler(ServiceException)
async def service_exception_handler(request: Request, exc: ServiceException):
    """Handles custom ServiceException raised from the business logic layer."""
    logger.error(f"Service Exception: {exc.message} - Status: {exc.status_code}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handles all unhandled exceptions."""
    logger.exception(f"Unhandled Exception: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred."},
    )

# --- Include Routers ---

app.include_router(router)

# --- Root Endpoint ---

@app.get("/", tags=["Health Check"])
async def root():
    return {"service": settings.SERVICE_NAME, "status": "running", "version": app.version}

# To run the application:
# uvicorn main:app --reload --host 0.0.0.0 --port 8000