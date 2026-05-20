#!/usr/bin/env python3
"""
Enhanced CocoIndex Service with Business Rules Integration
Provides image analysis and object detection with rule-based decision making
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import base64
import io

import cv2
import numpy as np
import torch
import torchvision.transforms as transforms
from PIL import Image
import aiohttp
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Enhanced CocoIndex Service",
    description="AI-powered image analysis with business rules integration",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
BUSINESS_RULES_URL = os.getenv("BUSINESS_RULES_URL", "http://localhost:8086")

# COCO class names (80 classes)
COCO_CLASSES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
    'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
    'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
    'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
    'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
    'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
    'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
    'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
    'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
    'toothbrush'
]

# Data Models
class ImageAnalysisRequest(BaseModel):
    image_data: Optional[str] = Field(None, description="Base64 encoded image")
    image_url: Optional[str] = Field(None, description="URL to image")
    analysis_type: str = Field("object_detection", description="Type of analysis")
    confidence_threshold: float = Field(0.5, description="Confidence threshold")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context")

class DetectedObject(BaseModel):
    class_name: str
    confidence: float
    bbox: List[float]  # [x1, y1, x2, y2]
    area: float

class ImageAnalysisResponse(BaseModel):
    objects: List[DetectedObject]
    total_objects: int
    analysis_time: float
    confidence_avg: float
    image_dimensions: Tuple[int, int]
    business_rules_applied: List[str]
    requires_human_review: bool
    timestamp: datetime

class ServiceStatus(BaseModel):
    status: str
    model_loaded: bool
    last_analysis: Optional[datetime] = None
    total_analyses: int = 0

# Global state
redis_client: Optional[redis.Redis] = None
model_loaded = False
analysis_count = 0
last_analysis_time: Optional[datetime] = None

@dataclass
class CocoIndexModel:
    """Mock COCO model for demonstration (replace with actual model)"""
    
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.confidence_threshold = 0.5
        self.loaded = False
    
    def load_model(self):
        """Load the COCO detection model"""
        try:
            # In production, load actual YOLO or other detection model
            # For now, simulate model loading
            time.sleep(2)  # Simulate loading time
            self.loaded = True
            logger.info("COCO detection model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise
    
    def detect_objects(self, image: np.ndarray, confidence_threshold: float = 0.5) -> List[DetectedObject]:
        """Detect objects in image"""
        if not self.loaded:
            raise RuntimeError("Model not loaded")
        
        # Mock detection results (replace with actual model inference)
        height, width = image.shape[:2]
        
        # Simulate detection results
        mock_detections = [
            {
                "class_id": 0,  # person
                "confidence": 0.85,
                "bbox": [0.1 * width, 0.1 * height, 0.4 * width, 0.8 * height]
            },
            {
                "class_id": 62,  # laptop
                "confidence": 0.72,
                "bbox": [0.5 * width, 0.3 * height, 0.9 * width, 0.7 * height]
            },
            {
                "class_id": 67,  # cell phone
                "confidence": 0.68,
                "bbox": [0.2 * width, 0.6 * height, 0.3 * width, 0.8 * height]
            }
        ]
        
        detected_objects = []
        for detection in mock_detections:
            if detection["confidence"] >= confidence_threshold:
                bbox = detection["bbox"]
                area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
                
                detected_objects.append(DetectedObject(
                    class_name=COCO_CLASSES[detection["class_id"]],
                    confidence=detection["confidence"],
                    bbox=bbox,
                    area=area
                ))
        
        return detected_objects

# Global model instance
coco_model = CocoIndexModel()

class BusinessRulesClient:
    """Client for business rules service integration"""
    
    async def evaluate_rules(self, service: str, facts: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate business rules for image analysis"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{BUSINESS_RULES_URL}/reason",
                    json={
                        "service": service,
                        "facts": facts,
                        "method": "deduction"
                    },
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        logger.warning(f"Business rules service error: {response.status}")
                        return {"conclusion": {}, "reasoning_trace": []}
        except Exception as e:
            logger.warning(f"Failed to connect to business rules service: {e}")
            return {"conclusion": {}, "reasoning_trace": []}

# Global business rules client
rules_client = BusinessRulesClient()

async def startup_event():
    """Initialize services on startup"""
    global redis_client, model_loaded
    
    try:
        redis_client = redis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Connected to Redis")
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}")
        redis_client = None
    
    # Load COCO model
    try:
        coco_model.load_model()
        model_loaded = True
        logger.info("COCO model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load COCO model: {e}")
        model_loaded = False
    
    logger.info("Enhanced CocoIndex service started")

async def shutdown_event():
    """Cleanup on shutdown"""
    global redis_client
    
    if redis_client:
        await redis_client.close()
    
    logger.info("Enhanced CocoIndex service stopped")

app.add_event_handler("startup", startup_event)
app.add_event_handler("shutdown", shutdown_event)

def decode_image(image_data: str) -> np.ndarray:
    """Decode base64 image data"""
    try:
        # Remove data URL prefix if present
        if image_data.startswith('data:image'):
            image_data = image_data.split(',')[1]
        
        # Decode base64
        image_bytes = base64.b64decode(image_data)
        
        # Convert to PIL Image
        pil_image = Image.open(io.BytesIO(image_bytes))
        
        # Convert to RGB if necessary
        if pil_image.mode != 'RGB':
            pil_image = pil_image.convert('RGB')
        
        # Convert to numpy array
        image_array = np.array(pil_image)
        
        return image_array
    except Exception as e:
        raise ValueError(f"Failed to decode image: {e}")

async def download_image(url: str) -> np.ndarray:
    """Download image from URL"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                if response.status == 200:
                    image_bytes = await response.read()
                    pil_image = Image.open(io.BytesIO(image_bytes))
                    
                    if pil_image.mode != 'RGB':
                        pil_image = pil_image.convert('RGB')
                    
                    return np.array(pil_image)
                else:
                    raise ValueError(f"Failed to download image: HTTP {response.status}")
    except Exception as e:
        raise ValueError(f"Failed to download image from URL: {e}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "model_loaded": model_loaded,
        "timestamp": datetime.utcnow(),
        "services": {
            "redis": "connected" if redis_client else "disconnected",
            "coco_model": "loaded" if model_loaded else "not_loaded",
            "business_rules": "available"
        }
    }

@app.get("/status", response_model=ServiceStatus)
async def get_status():
    """Get service status"""
    return ServiceStatus(
        status="active" if model_loaded else "inactive",
        model_loaded=model_loaded,
        last_analysis=last_analysis_time,
        total_analyses=analysis_count
    )

@app.post("/analyze", response_model=ImageAnalysisResponse)
async def analyze_image(request: ImageAnalysisRequest):
    """Analyze image with object detection"""
    global analysis_count, last_analysis_time
    
    if not model_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    start_time = time.time()
    
    try:
        # Get image data
        if request.image_data:
            image = decode_image(request.image_data)
        elif request.image_url:
            image = await download_image(request.image_url)
        else:
            raise HTTPException(status_code=400, detail="No image data provided")
        
        # Prepare facts for business rules evaluation
        image_facts = {
            "image_width": image.shape[1],
            "image_height": image.shape[0],
            "image_channels": image.shape[2] if len(image.shape) > 2 else 1,
            "confidence_threshold": request.confidence_threshold,
            "analysis_type": request.analysis_type,
            "image_size_mb": image.nbytes / (1024 * 1024)
        }
        
        # Evaluate business rules
        rules_result = await rules_client.evaluate_rules("coco_index", image_facts)
        
        # Apply business rules conclusions
        requires_human_review = rules_result.get("conclusion", {}).get("requires_human_review", False)
        adjusted_threshold = request.confidence_threshold
        
        # Adjust confidence threshold based on rules
        if "confidence" in rules_result.get("conclusion", {}):
            adjusted_threshold = rules_result["conclusion"]["confidence"]
        
        # Perform object detection
        detected_objects = coco_model.detect_objects(image, adjusted_threshold)
        
        # Calculate metrics
        analysis_time = time.time() - start_time
        confidence_avg = sum(obj.confidence for obj in detected_objects) / len(detected_objects) if detected_objects else 0.0
        
        # Update global counters
        analysis_count += 1
        last_analysis_time = datetime.utcnow()
        
        # Cache result if Redis is available
        if redis_client:
            cache_key = f"coco_analysis:{hash(str(request.dict()))}"
            cache_data = {
                "objects": [obj.dict() for obj in detected_objects],
                "analysis_time": analysis_time,
                "timestamp": last_analysis_time.isoformat()
            }
            await redis_client.setex(cache_key, 300, json.dumps(cache_data))
        
        return ImageAnalysisResponse(
            objects=detected_objects,
            total_objects=len(detected_objects),
            analysis_time=analysis_time,
            confidence_avg=confidence_avg,
            image_dimensions=(image.shape[1], image.shape[0]),
            business_rules_applied=rules_result.get("reasoning_trace", []),
            requires_human_review=requires_human_review,
            timestamp=last_analysis_time
        )
        
    except Exception as e:
        logger.error(f"Image analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze/file")
async def analyze_uploaded_file(file: UploadFile = File(...)):
    """Analyze uploaded image file"""
    if not model_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    try:
        # Read file content
        file_content = await file.read()
        
        # Convert to base64
        image_b64 = base64.b64encode(file_content).decode('utf-8')
        
        # Create analysis request
        request = ImageAnalysisRequest(
            image_data=image_b64,
            analysis_type="object_detection",
            confidence_threshold=0.5
        )
        
        # Analyze image
        return await analyze_image(request)
        
    except Exception as e:
        logger.error(f"File analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/classes")
async def get_coco_classes():
    """Get list of COCO classes"""
    return {
        "classes": COCO_CLASSES,
        "total_classes": len(COCO_CLASSES)
    }

@app.get("/metrics")
async def get_metrics():
    """Get service metrics"""
    return {
        "total_analyses": analysis_count,
        "last_analysis": last_analysis_time,
        "model_loaded": model_loaded,
        "supported_classes": len(COCO_CLASSES),
        "version": "2.0.0"
    }

@app.post("/test")
async def test_service():
    """Test service with sample data"""
    if not model_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    # Create a test image (solid color)
    test_image = np.ones((480, 640, 3), dtype=np.uint8) * 128
    
    # Convert to base64
    pil_image = Image.fromarray(test_image)
    buffer = io.BytesIO()
    pil_image.save(buffer, format='JPEG')
    image_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    
    # Create test request
    request = ImageAnalysisRequest(
        image_data=image_b64,
        analysis_type="object_detection",
        confidence_threshold=0.5
    )
    
    # Analyze test image
    result = await analyze_image(request)
    
    return {
        "test_status": "success",
        "result": result
    }

if __name__ == "__main__":
    uvicorn.run(
        "enhanced_coco_index:app",
        host="0.0.0.0",
        port=8087,
        reload=True,
        log_level="info"
    )

