import logging
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from .config import settings
from .router import pix_router
from .auth_router import auth_router
from .database import Base, engine
from .service import PixIntegrationError
from .cors_config import CORSConfig

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    debug=settings.DEBUG,
    version="1.0.0",
    description="FastAPI service for PIX Integration (Brazil's Instant Payment System)",
)

# Configure CORS middleware with environment-based settings
CORSConfig.configure_cors(app)
CORSConfig.validate_configuration()

# Custom Exception Handler for PixIntegrationError
@app.exception_handler(PixIntegrationError)
async def pix_integration_exception_handler(request: Request, exc: PixIntegrationError):
    logger.error(f"PIX Integration Error: {exc.name} - {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "error_code": exc.name},
    )

# Global logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Incoming Request: {request.method} {request.url}")
    response = await call_next(request)
    logger.info(f"Outgoing Response: {response.status_code}")
    return response

# Include routers
app.include_router(auth_router, prefix="/api/v1")
app.include_router(pix_router, prefix="/api/v1/pix", tags=["pix"])

@app.get("/", status_code=status.HTTP_200_OK, include_in_schema=False)
async def root():
    return {"message": f"Welcome to the {settings.PROJECT_NAME} API"}
