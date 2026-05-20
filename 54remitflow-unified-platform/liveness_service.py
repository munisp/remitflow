import os
import logging
import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

# Correctly import the provider from the absolute path
from core-services.kyc-service.liveness_detection import get_opensource_liveness_provider, LivenessResult

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment setup
SERVICE_NAME = "liveness-service"
SERVICE_VERSION = "1.0.0"
ALLOWED_ORIGINS = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000"
).split(",")

# FastAPI App Initialization
app = FastAPI(
    title=SERVICE_NAME,
    description="A production-grade service providing access to the core open-source liveness detection engine.",
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

# Get the liveness provider on startup
liveness_provider = get_opensource_liveness_provider()

@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting {SERVICE_NAME} v{SERVICE_VERSION}")
    logger.info("Liveness provider initialized.")

@app.post("/v1/check-liveness", response_model=LivenessResult)
async def check_liveness(
    selfie_image: UploadFile = File(..., description="The selfie image of the user."),
    reference_image_url: Optional[str] = Form(None, description="URL to a reference image for face matching."),
    video_url: Optional[str] = Form(None, description="URL to a video for active liveness checks.")
):
    """
    Performs a comprehensive liveness check on a user's selfie.

    This endpoint orchestrates a multi-modal analysis to prevent spoofing attacks.
    It can optionally perform face matching against a reference image and/or active
    liveness checks if a video is provided.
    """
    try:
        selfie_data = await selfie_image.read()

        # The core provider's check_liveness method handles all the complexity
        result = await liveness_provider.check_liveness(
            selfie_image_url=None,  # We are providing bytes directly
            reference_image_url=reference_image_url,
            video_url=video_url,
            selfie_data=selfie_data
        )

        return result

    except Exception as e:
        logger.error(f"Liveness check failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An internal error occurred during liveness detection: {e}")

@app.get("/")
async def root():
    return {
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "status": "healthy"
    }

# Main entry point for running the service
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8090))
    uvicorn.run(app, host="0.0.0.0", port=port)
