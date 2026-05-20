from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging

from config import settings
from database import init_db
from router import router
from service import ServiceException, NotFoundException, AlreadyExistsException

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application startup and shutdown events.
    """
    # Startup: Initialize database
    logger.info("Application startup: Initializing database...")
    await init_db()
    logger.info("Database initialized successfully.")
    
    yield
    
    # Shutdown: Cleanup resources (none needed for this simple setup)
    logger.info("Application shutdown.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan,
    description="A production-ready FastAPI service for Permify-like authorization data management (Relational Tuples and Attributes)."
)

# --- Middleware ---

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Exception Handlers ---

@app.exception_handler(NotFoundException)
async def not_found_exception_handler(request: Request, exc: NotFoundException):
    logger.warning(f"Not Found Error: {exc.message}")
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"message": exc.message},
    )

@app.exception_handler(AlreadyExistsException)
async def already_exists_exception_handler(request: Request, exc: AlreadyExistsException):
    logger.warning(f"Conflict Error: {exc.message}")
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"message": exc.message},
    )

@app.exception_handler(ServiceException)
async def service_exception_handler(request: Request, exc: ServiceException):
    logger.error(f"Service Error: {exc.message}", exc_info=True)
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": exc.message},
    )

# --- Router Inclusion ---

app.include_router(router)

# --- Root Endpoint (Health Check) ---

@app.get("/", tags=["Health"])
async def root():
    return {"message": f"{settings.PROJECT_NAME} is running", "version": settings.VERSION}