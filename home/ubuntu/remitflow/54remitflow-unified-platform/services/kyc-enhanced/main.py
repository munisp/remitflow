import logging
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from config import settings
from database import init_db
from router import router as kyc_router # Assuming router.py will define 'router'

# Setup logging
logging.basicConfig(level=logging.getLevelName(settings.LOG_LEVEL),
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Custom Exception for the service
class KYCServiceException(Exception):
    def __init__(self, name: str, status_code: int = status.HTTP_400_BAD_REQUEST, detail: str = "Service error"):
        self.name = name
        self.status_code = status_code
        self.detail = detail
        # Add a method to convert to FastAPI HTTPException-like structure
        self.to_http_exception = lambda: JSONResponse(
            status_code=self.status_code,
            content={"message": self.detail, "exception": self.name},
        )

# Exception Handler
async def kyc_exception_handler(request: Request, exc: KYCServiceException):
    logger.error(f"KYCServiceException caught: {exc.name} - {exc.detail}", exc_info=True)
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": exc.detail, "exception": exc.name},
    )

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    logger.info(f"Starting up {settings.PROJECT_NAME} v{settings.VERSION}")
    # Initialize database tables
    try:
        init_db()
        logger.info("Database initialization complete.")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}", exc_info=True)
        # In a real app, you might want to raise an exception here to prevent startup
    
    yield
    
    # Shutdown logic
    logger.info(f"Shutting down {settings.PROJECT_NAME}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan,
    description="API for Enhanced Know Your Customer (KYC) and Due Diligence (EDD) processes."
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Should be restricted in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register custom exception handler
app.add_exception_handler(KYCServiceException, kyc_exception_handler)

# Include routers
app.include_router(kyc_router, prefix="/api/v1/kyc-enhanced", tags=["KYC Enhanced"])

@app.get("/", include_in_schema=False)
async def root():
    return {"message": f"{settings.PROJECT_NAME} is running", "version": settings.VERSION}

# NOTE: The router import will fail until router.py is created, but the structure is correct.
# The `KYCServiceException` is defined here for use in the router and service layers.
# The `init_db()` call is synchronous and placed in the lifespan function for simplicity.
# For a production async app, the database setup would be fully async.