import logging
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from . import router
from .config import settings
from .database import init_db
from .service import ServiceException

# Setup logging
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(settings.SERVICE_NAME)

# --- Application Initialization ---

app = FastAPI(
    title=settings.SERVICE_NAME,
    description="A production-ready FastAPI service for managing and producing messages to Apache Kafka.",
    version="1.0.0",
    debug=settings.DEBUG
)

# --- Middleware ---

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this in a real production environment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Event Handlers (Lifespan) ---

@app.on_event("startup")
def on_startup():
    """
    Handles application startup events.
    Initializes the database tables.
    """
    logger.info(f"Starting up {settings.SERVICE_NAME}...")
    init_db()
    logger.info("Database initialized.")

@app.on_event("shutdown")
def on_shutdown():
    """
    Handles application shutdown events.
    (No specific shutdown logic needed for the synchronous KafkaProducer in this example,
    but this is where you would close connections/pools).
    """
    logger.info(f"Shutting down {settings.SERVICE_NAME}...")

# --- Custom Exception Handler ---

@app.exception_handler(ServiceException)
async def service_exception_handler(request: Request, exc: ServiceException):
    """
    Custom exception handler for all ServiceException types.
    """
    logger.error(f"Service Exception: {exc.message} - Status: {exc.status_code}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )

# --- Router Inclusion ---

app.include_router(router.router)

# --- Root Endpoint ---

@app.get("/", tags=["health"])
def read_root():
    """
    Health check endpoint.
    """
    return {"service": settings.SERVICE_NAME, "status": "running", "version": app.version}

# Example of how to run the application:
# uvicorn main:app --reload --host 0.0.0.0 --port 8000