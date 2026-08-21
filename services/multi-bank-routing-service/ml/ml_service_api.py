"""
ML Service API
FastAPI service for ML-based routing predictions.
"""

import os
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from contextlib import asynccontextmanager

import hmac

from fastapi import Depends, FastAPI, Header, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

import asyncpg
import redis.asyncio as redis

from routing_ml_models import (
    MLRoutingEngine,
    RoutingFeatures,
    RouteSuccessPredictor,
    LatencyPredictor,
    MultiArmedBandit,
    FeatureStore
)
from liquidity_forecasting import LiquidityForecaster, ForecastPeriod
from online_learning import OnlineLearningPipeline

def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[ml] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value


logger = logging.getLogger(__name__)

# Configuration - Production defaults for K8s deployment
DB_URL = _require_env("DATABASE_URL")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis.remittance.svc.cluster.local:6379/0")
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka.remittance.svc.cluster.local:9092")
MODEL_DIR = os.getenv("MODEL_DIR", "/var/lib/ml-models")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://rustfs.remittance.svc.cluster.local:9000")
S3_MODEL_BUCKET = os.getenv("S3_MODEL_BUCKET", "ml-routing-models")


# Pydantic models
class PredictionRequest(BaseModel):
    bank_code: str
    bank_category: str = "commercial"
    has_direct_api: bool = False
    has_on_us: bool = False
    rail: str
    amount: float
    amount_bucket: str = "medium"
    hour_of_day: int = Field(ge=0, le=23)
    day_of_week: int = Field(ge=0, le=6)
    is_weekend: bool = False
    is_business_hours: bool = True
    is_month_end: bool = False
    bank_success_rate_1h: float = 0.95
    bank_success_rate_24h: float = 0.95
    bank_success_rate_7d: float = 0.95
    bank_avg_latency_1h: float = 1000
    bank_avg_latency_24h: float = 1000
    rail_success_rate_1h: float = 0.95
    rail_success_rate_24h: float = 0.95
    account_balance_ratio: float = 2.0
    daily_utilization: float = 0.3


class PredictionResponse(BaseModel):
    success_probability: float
    predicted_latency_ms: int
    success_score: float
    latency_score: float
    cost_score: float
    bandit_score: float
    final_score: float
    model_version: str


class BatchPredictionRequest(BaseModel):
    candidates: List[PredictionRequest]


class BatchPredictionResponse(BaseModel):
    predictions: List[PredictionResponse]


class OutcomeRequest(BaseModel):
    transfer_id: str
    bank_code: str
    rail: str
    amount: float
    was_successful: bool
    actual_latency_ms: int
    actual_cost: float
    error_code: Optional[str] = None
    error_message: Optional[str] = None


class ForecastRequest(BaseModel):
    bank_code: str
    bank_name: str
    account_number: str
    current_balance: float
    period: str = "24h"


class TrainRequest(BaseModel):
    model_type: str = "all"  # success, latency, liquidity, all
    min_samples: int = 1000


class MetricsResponse(BaseModel):
    success_model: Optional[Dict[str, Any]]
    latency_model: Optional[Dict[str, Any]]
    bandit_probabilities: Dict[str, float]
    online_learning: Optional[Dict[str, Any]]


# Global state
db_pool: Optional[asyncpg.Pool] = None
redis_client: Optional[redis.Redis] = None
ml_engine: Optional[MLRoutingEngine] = None
liquidity_forecaster: Optional[LiquidityForecaster] = None
online_pipeline: Optional[OnlineLearningPipeline] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global db_pool, redis_client, ml_engine, liquidity_forecaster, online_pipeline
    
    # Startup
    logger.info("Starting ML Service...")
    
    # Initialize database pool
    try:
        db_pool = await asyncpg.create_pool(
            DB_URL,
            min_size=5,
            max_size=20
        )
        logger.info("Database pool created")
    except Exception as e:
        logger.error(f"Failed to create database pool: {e}")
        db_pool = None
    
    # Initialize Redis
    try:
        redis_client = redis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        redis_client = None
    
    # Initialize ML engine
    if db_pool and redis_client:
        try:
            ml_engine = MLRoutingEngine(db_pool, redis_client, MODEL_DIR)
            await ml_engine.initialize()
            logger.info("ML engine initialized")
        except Exception as e:
            logger.error(f"Failed to initialize ML engine: {e}")
            ml_engine = None
        
        # Initialize liquidity forecaster
        try:
            liquidity_forecaster = LiquidityForecaster(db_pool, redis_client, MODEL_DIR)
            logger.info("Liquidity forecaster initialized")
        except Exception as e:
            logger.error(f"Failed to initialize liquidity forecaster: {e}")
            liquidity_forecaster = None
        
        # Initialize online learning pipeline
        try:
            online_pipeline = OnlineLearningPipeline(
                db_pool, redis_client, KAFKA_BOOTSTRAP, MODEL_DIR
            )
            await online_pipeline.initialize(ml_engine)
            await online_pipeline.start_consumer()
            logger.info("Online learning pipeline initialized")
        except Exception as e:
            logger.error(f"Failed to initialize online learning pipeline: {e}")
            online_pipeline = None
    
    yield
    
    # Shutdown
    logger.info("Shutting down ML Service...")
    
    if online_pipeline:
        await online_pipeline.stop()
    
    if redis_client:
        await redis_client.close()
    
    if db_pool:
        await db_pool.close()


# Create FastAPI app
app = FastAPI(
    title="Multi-Bank Routing ML Service",
    description="ML-powered routing predictions for multi-bank payment routing",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware. Never combine "*" with credentials (PY-017): the origin
# allowlist is env-driven and credentials are disabled by default.
_CORS_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS or ["https://app.remitflow.example"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Internal-Token"],
)

# ── Internal auth (fail-closed) ───────────────────────────────────────────────
# Training / outcome-recording endpoints mutate production models; they must
# require authentication. No default token: if INTERNAL_API_TOKEN is unset
# these endpoints return 503.
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")


def require_internal_auth(x_internal_token: Optional[str] = Header(default=None)) -> None:
    if not INTERNAL_API_TOKEN:
        raise HTTPException(status_code=503, detail="INTERNAL_API_TOKEN is not configured; endpoint disabled")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, INTERNAL_API_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal API token")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "components": {
            "database": "connected" if db_pool else "disconnected",
            "redis": "connected" if redis_client else "disconnected",
            "ml_engine": "ready" if ml_engine else "not_ready",
            "liquidity_forecaster": "ready" if liquidity_forecaster else "not_ready",
            "online_learning": "ready" if online_pipeline else "not_ready"
        }
    }


@app.post("/api/v1/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """Single prediction endpoint"""
    if not ml_engine:
        raise HTTPException(status_code=503, detail="ML engine not available")
    
    # Build features
    features = RoutingFeatures(
        bank_code=request.bank_code,
        bank_category=request.bank_category,
        has_direct_api=request.has_direct_api,
        has_on_us=request.has_on_us,
        rail=request.rail,
        amount=request.amount,
        amount_bucket=request.amount_bucket,
        hour_of_day=request.hour_of_day,
        day_of_week=request.day_of_week,
        is_weekend=request.is_weekend,
        is_business_hours=request.is_business_hours,
        is_month_end=request.is_month_end,
        bank_success_rate_1h=request.bank_success_rate_1h,
        bank_success_rate_24h=request.bank_success_rate_24h,
        bank_success_rate_7d=request.bank_success_rate_7d,
        bank_avg_latency_1h=request.bank_avg_latency_1h,
        bank_avg_latency_24h=request.bank_avg_latency_24h,
        rail_success_rate_1h=request.rail_success_rate_1h,
        rail_success_rate_24h=request.rail_success_rate_24h,
        account_balance_ratio=request.account_balance_ratio,
        daily_utilization=request.daily_utilization
    )
    
    # Get estimated cost based on rail
    cost_map = {'on_us': 0, 'nip': 52.50, 'direct': 10, 'neft': 25}
    estimated_cost = cost_map.get(request.rail, 50)
    
    # Score route
    result = await ml_engine.score_route(features, estimated_cost)
    
    return PredictionResponse(
        success_probability=result['success_probability'],
        predicted_latency_ms=result['predicted_latency_ms'],
        success_score=result['success_score'],
        latency_score=result['latency_score'],
        cost_score=result['cost_score'],
        bandit_score=result['bandit_score'],
        final_score=result['final_score'],
        model_version=ml_engine.success_predictor.model_version
    )


@app.post("/api/v1/predict/batch", response_model=BatchPredictionResponse)
async def predict_batch(request: BatchPredictionRequest):
    """Batch prediction endpoint"""
    if not ml_engine:
        raise HTTPException(status_code=503, detail="ML engine not available")
    
    predictions = []
    
    for candidate in request.candidates:
        features = RoutingFeatures(
            bank_code=candidate.bank_code,
            bank_category=candidate.bank_category,
            has_direct_api=candidate.has_direct_api,
            has_on_us=candidate.has_on_us,
            rail=candidate.rail,
            amount=candidate.amount,
            amount_bucket=candidate.amount_bucket,
            hour_of_day=candidate.hour_of_day,
            day_of_week=candidate.day_of_week,
            is_weekend=candidate.is_weekend,
            is_business_hours=candidate.is_business_hours,
            is_month_end=candidate.is_month_end,
            bank_success_rate_1h=candidate.bank_success_rate_1h,
            bank_success_rate_24h=candidate.bank_success_rate_24h,
            bank_success_rate_7d=candidate.bank_success_rate_7d,
            bank_avg_latency_1h=candidate.bank_avg_latency_1h,
            bank_avg_latency_24h=candidate.bank_avg_latency_24h,
            rail_success_rate_1h=candidate.rail_success_rate_1h,
            rail_success_rate_24h=candidate.rail_success_rate_24h,
            account_balance_ratio=candidate.account_balance_ratio,
            daily_utilization=candidate.daily_utilization
        )
        
        cost_map = {'on_us': 0, 'nip': 52.50, 'direct': 10, 'neft': 25}
        estimated_cost = cost_map.get(candidate.rail, 50)
        
        result = await ml_engine.score_route(features, estimated_cost)
        
        predictions.append(PredictionResponse(
            success_probability=result['success_probability'],
            predicted_latency_ms=result['predicted_latency_ms'],
            success_score=result['success_score'],
            latency_score=result['latency_score'],
            cost_score=result['cost_score'],
            bandit_score=result['bandit_score'],
            final_score=result['final_score'],
            model_version=ml_engine.success_predictor.model_version
        ))
    
    return BatchPredictionResponse(predictions=predictions)


@app.post("/api/v1/outcome")
async def record_outcome(request: OutcomeRequest, background_tasks: BackgroundTasks, _auth: None = Depends(require_internal_auth)):
    """Record routing outcome for online learning"""
    if not online_pipeline:
        raise HTTPException(status_code=503, detail="Online learning not available")
    
    # Record outcome in background
    background_tasks.add_task(
        online_pipeline.record_outcome,
        request.transfer_id,
        request.bank_code,
        request.rail,
        request.amount,
        request.was_successful,
        request.actual_latency_ms,
        request.actual_cost,
        request.error_code,
        request.error_message
    )
    
    return {"status": "accepted", "transfer_id": request.transfer_id}


@app.post("/api/v1/forecast")
async def forecast_liquidity(request: ForecastRequest):
    """Forecast liquidity for a bank account"""
    if not liquidity_forecaster:
        raise HTTPException(status_code=503, detail="Liquidity forecaster not available")
    
    period_map = {
        '1h': ForecastPeriod.HOURLY,
        '4h': ForecastPeriod.FOUR_HOURS,
        '24h': ForecastPeriod.DAILY,
        '7d': ForecastPeriod.WEEKLY
    }
    
    period = period_map.get(request.period, ForecastPeriod.DAILY)
    
    forecast = await liquidity_forecaster.forecast(
        bank_code=request.bank_code,
        bank_name=request.bank_name,
        account_number=request.account_number,
        current_balance=request.current_balance,
        period=period
    )
    
    return forecast.to_dict()


@app.post("/api/v1/train")
async def train_models(request: TrainRequest, background_tasks: BackgroundTasks, _auth: None = Depends(require_internal_auth)):
    """Trigger model training"""
    if not ml_engine:
        raise HTTPException(status_code=503, detail="ML engine not available")
    
    async def train_task():
        try:
            if request.model_type in ['success', 'all']:
                await ml_engine.success_predictor.train(db_pool, request.min_samples)
            
            if request.model_type in ['latency', 'all']:
                await ml_engine.latency_predictor.train(db_pool, request.min_samples)
            
            logger.info(f"Model training completed: {request.model_type}")
        except Exception as e:
            logger.error(f"Model training failed: {e}")
    
    background_tasks.add_task(train_task)
    
    return {
        "status": "training_started",
        "model_type": request.model_type,
        "min_samples": request.min_samples
    }


@app.get("/api/v1/metrics", response_model=MetricsResponse)
async def get_metrics():
    """Get ML model metrics"""
    if not ml_engine:
        raise HTTPException(status_code=503, detail="ML engine not available")
    
    metrics = ml_engine.get_model_metrics()
    
    online_metrics = None
    if online_pipeline:
        online_metrics = online_pipeline.get_metrics_summary()
    
    return MetricsResponse(
        success_model=metrics.get('success_model'),
        latency_model=metrics.get('latency_model'),
        bandit_probabilities=metrics.get('bandit_probabilities', {}),
        online_learning=online_metrics
    )


@app.get("/api/v1/features/bank/{bank_code}")
async def get_bank_features(bank_code: str):
    """Get real-time bank features"""
    if not ml_engine:
        raise HTTPException(status_code=503, detail="ML engine not available")
    
    features = await ml_engine.feature_store.get_bank_features(bank_code)
    return features


@app.get("/api/v1/features/rail/{rail}")
async def get_rail_features(rail: str):
    """Get real-time rail features"""
    if not ml_engine:
        raise HTTPException(status_code=503, detail="ML engine not available")
    
    features = await ml_engine.feature_store.get_rail_features(rail)
    return features


@app.get("/api/v1/bandit/probabilities")
async def get_bandit_probabilities():
    """Get bandit arm probabilities"""
    if not ml_engine:
        raise HTTPException(status_code=503, detail="ML engine not available")
    
    return ml_engine.bandit.get_arm_probabilities()


@app.post("/api/v1/bandit/select")
async def select_bandit_arm(available_arms: List[str] = None):
    """Select arm using Thompson Sampling"""
    if not ml_engine:
        raise HTTPException(status_code=503, detail="ML engine not available")
    
    selected = ml_engine.bandit.select_arm(available_arms)
    probs = ml_engine.bandit.get_arm_probabilities(available_arms)
    
    return {
        "selected_arm": selected,
        "probabilities": probs
    }


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    uvicorn.run(
        "ml_service_api:app",
        host="0.0.0.0",
        port=8080,
        reload=True
    )
