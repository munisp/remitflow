import logging
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

from . import models, router
from .database import engine
from .config import settings
from .service import PolicyException, PolicyNotFound, PolicyAlreadyExists

# --- Configuration and Logging ---
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

# --- Database Initialization ---
# Create database tables if they don't exist
models.Base.metadata.create_all(bind=engine)

# --- FastAPI Application Setup ---
app = FastAPI(
    title=settings.SERVICE_NAME,
    version=settings.VERSION,
    debug=settings.DEBUG,
    description="API for managing open-appsec WAF policies for APISIX integration.",
)

# --- Middleware ---
# CORS Middleware for development/production
origins = [
    "*", # Allow all for development, restrict in production
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Custom Exception Handlers ---

@app.exception_handler(PolicyNotFound)
async def policy_not_found_exception_handler(request: Request, exc: PolicyNotFound):
    logger.warning(f"Policy Not Found: {exc.identifier}")
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"message": str(exc)},
    )

@app.exception_handler(PolicyAlreadyExists)
async def policy_already_exists_exception_handler(request: Request, exc: PolicyAlreadyExists):
    logger.warning(f"Policy Already Exists: {exc.name}")
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"message": str(exc)},
    )

@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    logger.error(f"Database Error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"message": "An internal database error occurred."},
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled Exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"message": "An unexpected error occurred."},
    )

# --- Include Routers ---
app.include_router(router.router)

# --- Root Endpoint ---
@app.get("/", tags=["Health Check"])
def read_root():
    return {
        "message": "Welcome to the OpenAppSec APISIX Integration API",
        "version": settings.VERSION,
        "docs": "/docs"
    }

# --- Security Best Practices Placeholder ---
# In a production environment, you would add:
# 1. Authentication/Authorization dependencies to the router endpoints.
# 2. Helmet-like security headers (e.g., using a custom middleware).
# 3. Rate limiting.
# 4. Detailed logging of requests/responses.
# For this implementation, we focus on the core business logic and structure.