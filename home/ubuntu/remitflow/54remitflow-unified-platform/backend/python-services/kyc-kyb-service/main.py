import os
import logging
from datetime import datetime
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .router import router as kyc_kyb_router
from .middleware_integration import initialize_middleware, get_middleware_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment setup
SERVICE_NAME = "kyc-kyb-service"
SERVICE_VERSION = "1.0.0"
ALLOWED_ORIGINS = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000"
).split(",")

# FastAPI App Initialization
app = FastAPI(
    title=SERVICE_NAME,
    description="Comprehensive KYC & KYB service including DeepKYB, Continuous Monitoring, and Case Management.",
    version=SERVICE_VERSION
)

# Add Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State
stats = {
    "total_requests": 0,
    "start_time": datetime.now()
}

@app.middleware("http")
async def count_requests(request: Request, call_next):
    stats["total_requests"] += 1
    response = await call_next(request)
    return response

# Include Routers
app.include_router(kyc_kyb_router)

# Lifecycle Events
@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting {SERVICE_NAME} v{SERVICE_VERSION}")
    try:
        await initialize_middleware()
        logger.info("All middleware connections initialized successfully.")
    except Exception as e:
        logger.critical(f"FATAL: Middleware initialization failed: {e}", exc_info=True)
        # In a real-world scenario, you might want to exit the application
        # if middleware connections are critical for operation.
        # For now, we log a critical error and continue.

@app.on_event("shutdown")
async def shutdown_event():
    logger.info(f"Shutting down {SERVICE_NAME}")
    middleware_service = get_middleware_service()
    if middleware_service:
        await middleware_service.close_connections()
        logger.info("All middleware connections closed gracefully.")

# Root and Health Check
@app.get("/")
async def root():
    return {
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "status": "healthy",
        "uptime_seconds": (datetime.now() - stats["start_time"]).total_seconds(),
        "total_requests": stats["total_requests"]
    }

# Main entry point for running the service
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8122))
    uvicorn.run(app, host="0.0.0.0", port=port)
