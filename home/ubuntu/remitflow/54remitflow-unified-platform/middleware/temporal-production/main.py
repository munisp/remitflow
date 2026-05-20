import logging
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import settings
from router import router
from service import NotFoundError, DuplicateError

# --- Configuration and Logging ---
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

# --- Application Setup ---
app = FastAPI(
    title=settings.APP_NAME,
    description="API service for tracking Temporal Workflow Executions in a production environment.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for simplicity, should be restricted in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Middleware to log incoming requests."""
    logger.info(f"Incoming request: {request.method} {request.url}")
    response = await call_next(request)
    logger.info(f"Outgoing response: {response.status_code}")
    return response

# --- Custom Exception Handlers ---

@app.exception_handler(NotFoundError)
async def not_found_exception_handler(request: Request, exc: NotFoundError):
    """Handles custom NotFoundError from the service layer."""
    logger.warning(f"NotFoundError: {exc}")
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"message": str(exc)},
    )

@app.exception_handler(DuplicateError)
async def duplicate_exception_handler(request: Request, exc: DuplicateError):
    """Handles custom DuplicateError from the service layer."""
    logger.warning(f"DuplicateError: {exc}")
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"message": str(exc)},
    )

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handles standard FastAPI/Starlette HTTP exceptions."""
    logger.error(f"HTTPException: {exc.detail} (Status: {exc.status_code})")
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": exc.detail},
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handles all other unhandled exceptions."""
    logger.critical(f"Unhandled Exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"message": "An unexpected server error occurred."},
    )

# --- Include Router ---
app.include_router(router)

# --- Root Endpoint ---
@app.get("/", tags=["Health Check"])
def read_root():
    return {"message": f"{settings.APP_NAME} is running", "version": app.version}

# --- Startup/Shutdown Events (Optional but good practice) ---
@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting up {settings.APP_NAME}...")
    # Database initialization is handled in database.py import, but could be done here too.

@app.on_event("shutdown")
async def shutdown_event():
    logger.info(f"Shutting down {settings.APP_NAME}...")

# To run the application:
# uvicorn main:app --reload --host 0.0.0.0 --port 8000