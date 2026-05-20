import logging
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from database import init_db
from models import Base
from router import router
from service import ComponentServiceError

# Configure logging
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

# Initialize the database (create tables)
init_db(Base)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    debug=settings.DEBUG,
    description="API service for managing Dapr component configurations in a production environment."
)

# --- Middleware ---

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Custom Exception Handlers ---

@app.exception_handler(ComponentServiceError)
async def component_service_exception_handler(request: Request, exc: ComponentServiceError):
    """Handles custom business logic exceptions."""
    logger.error(f"ComponentServiceError: {exc}")
    # ComponentNotFoundError is a subclass of ComponentServiceError,
    # but FastAPI's HTTPException in the router handles 404/409 specifically.
    # This handler catches other general service errors, which we'll map to 500.
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": str(exc)},
    )

# --- Routers ---

app.include_router(router)

# --- Root Endpoint ---

@app.get("/", tags=["Health Check"])
def read_root():
    """Health check endpoint."""
    return {"message": f"{settings.PROJECT_NAME} is running", "version": settings.VERSION}

# --- Security (Placeholder for future implementation) ---
# In a real production app, you would add security dependencies here,
# e.g., a dependency function to check for a valid API key or JWT token.
# Example:
# @app.get("/secure", dependencies=[Depends(get_current_user)])
# def secure_endpoint():
#     return {"message": "Access granted"}

# --- Startup/Shutdown Events (Optional but good practice) ---
@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting up {settings.PROJECT_NAME} v{settings.VERSION}")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info(f"Shutting down {settings.PROJECT_NAME}")

# To run the application, you would typically use:
# uvicorn main:app --reload