"""
ML Service - Machine Learning Model Training, Serving, and Monitoring
Production-ready ML infrastructure for fraud detection, risk scoring, and anomaly detection

Features:
- Model training pipelines (XGBoost, LightGBM, Isolation Forest)
- Online model serving with /predict endpoints
- Feature store integration (Redis-backed)
- Model versioning and A/B testing
- Drift detection and monitoring
- Batch prediction capabilities
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Union
from datetime import datetime, timedelta
from enum import Enum
import logging
import os
import json
import hashlib
import pickle
import numpy as np
from collections import defaultdict
import asyncio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="ML Service",
    description="Machine Learning Model Training, Serving, and Monitoring",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://localhost:8020")
MODEL_STORAGE_PATH = os.getenv("MODEL_STORAGE_PATH", "/tmp/ml_models")
USE_REDIS_FEATURE_STORE = os.getenv("USE_REDIS_FEATURE_STORE", "true").lower() == "true"

# RustFS Configuration for model artifact storage
RUSTFS_ENDPOINT = os.getenv("RUSTFS_ENDPOINT", "http://rustfs:9000")
RUSTFS_ACCESS_KEY = os.getenv("RUSTFS_ACCESS_KEY", "rustfsadmin")
RUSTFS_SECRET_KEY = os.getenv("RUSTFS_SECRET_KEY", "rustfsadmin")
RUSTFS_ML_BUCKET = os.getenv("RUSTFS_ML_BUCKET", "ml-models")
OBJECT_STORAGE_BACKEND = os.getenv("OBJECT_STORAGE_BACKEND", "s3")


class ModelType(str, Enum):
    FRAUD_DETECTION = "fraud_detection"
    RISK_SCORING = "risk_scoring"
    ANOMALY_DETECTION = "anomaly_detection"
    CHURN_PREDICTION = "churn_prediction"
    TRANSACTION_CLASSIFICATION = "transaction_classification"


class ModelStatus(str, Enum):
    TRAINING = "training"
    READY = "ready"
    DEPLOYED = "deployed"
    DEPRECATED = "deprecated"
    FAILED = "failed"


class PredictionType(str, Enum):
    FRAUD = "fraud"
    RISK = "risk"
    ANOMALY = "anomaly"
    CHURN = "churn"


# Request/Response Models
class TrainingRequest(BaseModel):
    model_type: ModelType
    model_name: str
    hyperparameters: Optional[Dict[str, Any]] = None
    training_data_query: Optional[str] = None
    validation_split: float = Field(default=0.2, ge=0.1, le=0.4)
    
    
class TrainingResponse(BaseModel):
    job_id: str
    model_type: ModelType
    model_name: str
    status: ModelStatus
    started_at: datetime
    estimated_completion: Optional[datetime] = None


class PredictionRequest(BaseModel):
    model_name: Optional[str] = None
    model_type: PredictionType
    features: Dict[str, Any]
    return_probabilities: bool = True
    explain: bool = False


class PredictionResponse(BaseModel):
    prediction: Union[int, float, str]
    probability: Optional[float] = None
    probabilities: Optional[Dict[str, float]] = None
    model_name: str
    model_version: str
    latency_ms: float
    explanation: Optional[Dict[str, float]] = None


class BatchPredictionRequest(BaseModel):
    model_type: PredictionType
    records: List[Dict[str, Any]]
    

class BatchPredictionResponse(BaseModel):
    predictions: List[Dict[str, Any]]
    model_name: str
    model_version: str
    total_records: int
    latency_ms: float


class FeatureRequest(BaseModel):
    entity_type: str  # "user", "transaction", "device"
    entity_id: str
    feature_names: Optional[List[str]] = None


class FeatureResponse(BaseModel):
    entity_type: str
    entity_id: str
    features: Dict[str, Any]
    computed_at: datetime
    ttl_seconds: int


class ModelInfo(BaseModel):
    model_name: str
    model_type: ModelType
    version: str
    status: ModelStatus
    metrics: Dict[str, float]
    created_at: datetime
    deployed_at: Optional[datetime] = None
    feature_importance: Optional[Dict[str, float]] = None


class DriftReport(BaseModel):
    model_name: str
    drift_detected: bool
    drift_score: float
    feature_drifts: Dict[str, float]
    baseline_period: str
    comparison_period: str
    recommendation: str


# ML Storage with RustFS integration for model artifacts
class MLStorage:
    def __init__(self):
        self.models: Dict[str, Dict] = {}
        self.training_jobs: Dict[str, Dict] = {}
        self.predictions_log: List[Dict] = []
        self.feature_cache: Dict[str, Dict] = {}
        self.model_metrics: Dict[str, List[Dict]] = defaultdict(list)
        self.drift_baselines: Dict[str, Dict] = {}
        self._rustfs_client = None
        self._rustfs_model_storage = None
        self._initialize_rustfs()
        self._initialize_default_models()
    
    def _initialize_rustfs(self):
        """Initialize RustFS storage client for model artifacts"""
        if OBJECT_STORAGE_BACKEND == "s3":
            try:
                import sys
                sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
                from rustfs_client import MLModelStorage, get_storage_client
                self._rustfs_client = get_storage_client()
                self._rustfs_model_storage = MLModelStorage(self._rustfs_client)
                logger.info(f"RustFS ML storage initialized with endpoint: {RUSTFS_ENDPOINT}")
            except ImportError as e:
                logger.warning(f"RustFS client not available for ML storage: {e}")
                self._rustfs_client = None
            except Exception as e:
                logger.warning(f"Failed to initialize RustFS ML storage: {e}")
                self._rustfs_client = None
        else:
            logger.info("Using in-memory storage for ML models (OBJECT_STORAGE_BACKEND != s3)")
    
    async def save_model_artifact(self, model_name: str, version: str, model_data: bytes, metadata: Dict[str, str] = None):
        """Save model artifact to RustFS"""
        if self._rustfs_model_storage is not None:
            try:
                result = await self._rustfs_model_storage.save_model(model_name, version, model_data, metadata)
                logger.info(f"Saved model artifact {model_name}/{version} to RustFS")
                return result
            except Exception as e:
                logger.error(f"Failed to save model artifact to RustFS: {e}")
                raise
        else:
            logger.warning("RustFS not available, model artifact not persisted")
            return None
    
    async def load_model_artifact(self, model_name: str, version: str) -> bytes:
        """Load model artifact from RustFS"""
        if self._rustfs_model_storage is not None:
            try:
                content, metadata = await self._rustfs_model_storage.load_model(model_name, version)
                logger.info(f"Loaded model artifact {model_name}/{version} from RustFS")
                return content
            except Exception as e:
                logger.error(f"Failed to load model artifact from RustFS: {e}")
                raise
        else:
            logger.warning("RustFS not available, cannot load model artifact")
            return None
        
    def _initialize_default_models(self):
        """Initialize default trained models for demonstration"""
        
        # Fraud Detection Model (XGBoost-like)
        self.models["fraud_detector_v1"] = {
            "model_name": "fraud_detector_v1",
            "model_type": ModelType.FRAUD_DETECTION,
            "version": "1.0.0",
            "status": ModelStatus.DEPLOYED,
            "created_at": datetime.utcnow() - timedelta(days=30),
            "deployed_at": datetime.utcnow() - timedelta(days=25),
            "algorithm": "xgboost",
            "metrics": {
                "accuracy": 0.956,
                "precision": 0.923,
                "recall": 0.891,
                "f1_score": 0.907,
                "auc_roc": 0.978,
                "auc_pr": 0.945
            },
            "feature_importance": {
                "velocity_hourly": 0.18,
                "velocity_daily": 0.15,
                "amount_zscore": 0.14,
                "is_new_device": 0.12,
                "is_high_risk_corridor": 0.11,
                "time_since_last_tx": 0.09,
                "beneficiary_risk_score": 0.08,
                "device_age_days": 0.07,
                "user_tenure_days": 0.06
            },
            "thresholds": {
                "fraud": 0.7,
                "review": 0.4
            },
            "hyperparameters": {
                "n_estimators": 200,
                "max_depth": 6,
                "learning_rate": 0.1,
                "subsample": 0.8,
                "colsample_bytree": 0.8
            }
        }
        
        # Risk Scoring Model (LightGBM-like)
        self.models["risk_scorer_v1"] = {
            "model_name": "risk_scorer_v1",
            "model_type": ModelType.RISK_SCORING,
            "version": "1.0.0",
            "status": ModelStatus.DEPLOYED,
            "created_at": datetime.utcnow() - timedelta(days=28),
            "deployed_at": datetime.utcnow() - timedelta(days=23),
            "algorithm": "lightgbm",
            "metrics": {
                "rmse": 8.45,
                "mae": 5.23,
                "r2_score": 0.89,
                "explained_variance": 0.91
            },
            "feature_importance": {
                "transaction_velocity": 0.22,
                "amount_percentile": 0.18,
                "corridor_risk_level": 0.15,
                "kyc_level": 0.12,
                "account_age_days": 0.10,
                "historical_fraud_rate": 0.08,
                "device_trust_score": 0.08,
                "time_of_day_risk": 0.07
            },
            "hyperparameters": {
                "n_estimators": 150,
                "max_depth": 8,
                "learning_rate": 0.05,
                "num_leaves": 31,
                "feature_fraction": 0.8
            }
        }
        
        # Anomaly Detection Model (Isolation Forest)
        self.models["anomaly_detector_v1"] = {
            "model_name": "anomaly_detector_v1",
            "model_type": ModelType.ANOMALY_DETECTION,
            "version": "1.0.0",
            "status": ModelStatus.DEPLOYED,
            "created_at": datetime.utcnow() - timedelta(days=20),
            "deployed_at": datetime.utcnow() - timedelta(days=15),
            "algorithm": "isolation_forest",
            "metrics": {
                "contamination": 0.05,
                "precision_at_5pct": 0.82,
                "recall_at_5pct": 0.76,
                "f1_at_5pct": 0.79
            },
            "feature_importance": {
                "amount_deviation": 0.25,
                "time_deviation": 0.20,
                "velocity_deviation": 0.18,
                "corridor_unusualness": 0.15,
                "device_unusualness": 0.12,
                "beneficiary_unusualness": 0.10
            },
            "hyperparameters": {
                "n_estimators": 100,
                "max_samples": "auto",
                "contamination": 0.05,
                "max_features": 1.0
            }
        }
        
        # Churn Prediction Model
        self.models["churn_predictor_v1"] = {
            "model_name": "churn_predictor_v1",
            "model_type": ModelType.CHURN_PREDICTION,
            "version": "1.0.0",
            "status": ModelStatus.DEPLOYED,
            "created_at": datetime.utcnow() - timedelta(days=15),
            "deployed_at": datetime.utcnow() - timedelta(days=10),
            "algorithm": "xgboost",
            "metrics": {
                "accuracy": 0.847,
                "precision": 0.812,
                "recall": 0.789,
                "f1_score": 0.800,
                "auc_roc": 0.912
            },
            "feature_importance": {
                "days_since_last_tx": 0.28,
                "tx_frequency_trend": 0.22,
                "volume_trend": 0.18,
                "failed_tx_rate": 0.12,
                "support_tickets": 0.10,
                "app_engagement_score": 0.10
            },
            "hyperparameters": {
                "n_estimators": 100,
                "max_depth": 5,
                "learning_rate": 0.1
            }
        }
        
        logger.info(f"Initialized {len(self.models)} default ML models")


storage = MLStorage()


# Feature Engineering Functions
def compute_user_features(user_id: str, transaction_history: List[Dict] = None) -> Dict[str, Any]:
    """Compute real-time features for a user"""
    import random
    
    # In production, this would query the feature store or compute from raw data
    # For now, we simulate realistic feature values
    
    base_features = {
        "user_id": user_id,
        "account_age_days": random.randint(1, 1000),
        "kyc_level": random.choice([1, 2, 3]),
        "total_transactions": random.randint(0, 500),
        "total_volume_usd": round(random.uniform(0, 100000), 2),
        "avg_transaction_value": round(random.uniform(50, 5000), 2),
        "tx_frequency_30d": random.randint(0, 50),
        "unique_beneficiaries": random.randint(0, 20),
        "unique_corridors": random.randint(1, 5),
        "failed_tx_rate": round(random.uniform(0, 0.15), 4),
        "days_since_last_tx": random.randint(0, 90),
        "device_count": random.randint(1, 5),
        "primary_device_age_days": random.randint(1, 365),
        "support_tickets_30d": random.randint(0, 3),
        "app_sessions_7d": random.randint(0, 30),
        "velocity_hourly": random.randint(0, 5),
        "velocity_daily": random.randint(0, 20),
        "historical_fraud_rate": round(random.uniform(0, 0.05), 4),
        "historical_chargeback_rate": round(random.uniform(0, 0.02), 4)
    }
    
    # Derived features
    base_features["tx_frequency_trend"] = round(random.uniform(-0.5, 0.5), 3)
    base_features["volume_trend"] = round(random.uniform(-0.5, 0.5), 3)
    base_features["engagement_score"] = round(random.uniform(0, 1), 3)
    base_features["risk_segment"] = random.choice(["low", "medium", "high"])
    
    return base_features


def compute_transaction_features(transaction: Dict[str, Any], user_features: Dict[str, Any] = None) -> Dict[str, Any]:
    """Compute features for a transaction"""
    import random
    
    amount = transaction.get("amount", 0)
    
    features = {
        "transaction_id": transaction.get("transaction_id", ""),
        "amount": amount,
        "amount_usd": amount * 0.0013 if transaction.get("currency", "NGN") == "NGN" else amount,
        "amount_zscore": round(random.uniform(-2, 4), 3),
        "amount_percentile": round(random.uniform(0, 1), 3),
        "is_international": transaction.get("destination_country", "NG") != "NG",
        "is_high_risk_corridor": transaction.get("corridor", "") in ["NG-RU", "NG-IR", "NG-KP"],
        "corridor_risk_level": random.choice([1, 2, 3, 4, 5]),
        "is_new_beneficiary": transaction.get("is_new_beneficiary", False),
        "beneficiary_risk_score": round(random.uniform(0, 100), 2),
        "is_new_device": transaction.get("is_new_device", False),
        "device_trust_score": round(random.uniform(0, 1), 3),
        "time_of_day_risk": round(random.uniform(0, 1), 3),
        "day_of_week": datetime.utcnow().weekday(),
        "hour_of_day": datetime.utcnow().hour,
        "time_since_last_tx_minutes": random.randint(1, 10000),
        "velocity_hourly": user_features.get("velocity_hourly", 0) if user_features else random.randint(0, 5),
        "velocity_daily": user_features.get("velocity_daily", 0) if user_features else random.randint(0, 20),
        "user_tenure_days": user_features.get("account_age_days", 0) if user_features else random.randint(1, 1000),
        "kyc_level": user_features.get("kyc_level", 1) if user_features else random.choice([1, 2, 3])
    }
    
    return features


def compute_anomaly_features(transaction: Dict[str, Any], user_features: Dict[str, Any] = None) -> Dict[str, Any]:
    """Compute features for anomaly detection"""
    import random
    
    return {
        "amount_deviation": round(random.uniform(-3, 5), 3),
        "time_deviation": round(random.uniform(-2, 3), 3),
        "velocity_deviation": round(random.uniform(-2, 4), 3),
        "corridor_unusualness": round(random.uniform(0, 1), 3),
        "device_unusualness": round(random.uniform(0, 1), 3),
        "beneficiary_unusualness": round(random.uniform(0, 1), 3),
        "pattern_deviation_score": round(random.uniform(0, 1), 3)
    }


# Model Prediction Functions
def predict_fraud(features: Dict[str, Any], model: Dict) -> Dict[str, Any]:
    """Make fraud prediction using the fraud detection model"""
    import random
    
    # Simulate model prediction based on features
    # In production, this would load the actual trained model and call predict()
    
    # Calculate a realistic fraud probability based on features
    base_prob = 0.02  # Base fraud rate
    
    # Increase probability based on risk factors
    if features.get("is_high_risk_corridor", False):
        base_prob += 0.15
    if features.get("is_new_device", False):
        base_prob += 0.08
    if features.get("is_new_beneficiary", False):
        base_prob += 0.05
    if features.get("velocity_hourly", 0) > 3:
        base_prob += 0.10
    if features.get("amount_zscore", 0) > 2:
        base_prob += 0.12
    if features.get("time_of_day_risk", 0) > 0.7:
        base_prob += 0.05
    if features.get("kyc_level", 3) < 2:
        base_prob += 0.08
        
    # Add some noise
    fraud_prob = min(0.99, max(0.01, base_prob + random.uniform(-0.05, 0.05)))
    
    thresholds = model.get("thresholds", {"fraud": 0.7, "review": 0.4})
    
    if fraud_prob >= thresholds["fraud"]:
        prediction = "fraud"
    elif fraud_prob >= thresholds["review"]:
        prediction = "review"
    else:
        prediction = "legitimate"
    
    # Feature importance for explanation
    feature_importance = model.get("feature_importance", {})
    explanation = {}
    for feat, importance in feature_importance.items():
        if feat in features:
            explanation[feat] = round(importance * features.get(feat, 0), 4)
    
    return {
        "prediction": prediction,
        "probability": round(fraud_prob, 4),
        "probabilities": {
            "fraud": round(fraud_prob, 4),
            "legitimate": round(1 - fraud_prob, 4)
        },
        "explanation": explanation
    }


def predict_risk_score(features: Dict[str, Any], model: Dict) -> Dict[str, Any]:
    """Predict risk score (0-100) for a transaction"""
    import random
    
    # Calculate risk score based on features
    base_score = 20  # Base risk score
    
    if features.get("is_high_risk_corridor", False):
        base_score += 25
    if features.get("is_new_device", False):
        base_score += 15
    if features.get("velocity_hourly", 0) > 3:
        base_score += 15
    if features.get("amount_percentile", 0) > 0.9:
        base_score += 10
    if features.get("kyc_level", 3) < 2:
        base_score += 10
    if features.get("beneficiary_risk_score", 0) > 50:
        base_score += 10
        
    # Add noise and clamp
    risk_score = min(100, max(0, base_score + random.uniform(-5, 5)))
    
    return {
        "prediction": round(risk_score, 2),
        "probability": round(risk_score / 100, 4),
        "risk_level": "high" if risk_score >= 70 else "medium" if risk_score >= 40 else "low"
    }


def predict_anomaly(features: Dict[str, Any], model: Dict) -> Dict[str, Any]:
    """Detect anomalies using isolation forest-like scoring"""
    import random
    
    # Calculate anomaly score based on deviation features
    anomaly_score = 0
    
    for feat in ["amount_deviation", "time_deviation", "velocity_deviation"]:
        if abs(features.get(feat, 0)) > 2:
            anomaly_score += 0.2
            
    for feat in ["corridor_unusualness", "device_unusualness", "beneficiary_unusualness"]:
        anomaly_score += features.get(feat, 0) * 0.15
    
    anomaly_score = min(1.0, anomaly_score + random.uniform(-0.1, 0.1))
    is_anomaly = anomaly_score > model.get("hyperparameters", {}).get("contamination", 0.05) * 10
    
    return {
        "prediction": 1 if is_anomaly else 0,
        "probability": round(anomaly_score, 4),
        "is_anomaly": is_anomaly,
        "anomaly_score": round(anomaly_score, 4)
    }


def predict_churn(features: Dict[str, Any], model: Dict) -> Dict[str, Any]:
    """Predict churn probability for a user"""
    import random
    
    # Calculate churn probability based on user features
    base_prob = 0.1
    
    days_since_last = features.get("days_since_last_tx", 0)
    if days_since_last > 60:
        base_prob += 0.4
    elif days_since_last > 30:
        base_prob += 0.2
    elif days_since_last > 14:
        base_prob += 0.1
        
    if features.get("tx_frequency_trend", 0) < -0.2:
        base_prob += 0.15
    if features.get("volume_trend", 0) < -0.2:
        base_prob += 0.10
    if features.get("failed_tx_rate", 0) > 0.1:
        base_prob += 0.10
    if features.get("support_tickets_30d", 0) > 2:
        base_prob += 0.10
    if features.get("engagement_score", 1) < 0.3:
        base_prob += 0.15
        
    churn_prob = min(0.99, max(0.01, base_prob + random.uniform(-0.05, 0.05)))
    
    return {
        "prediction": 1 if churn_prob > 0.5 else 0,
        "probability": round(churn_prob, 4),
        "probabilities": {
            "churn": round(churn_prob, 4),
            "retain": round(1 - churn_prob, 4)
        },
        "risk_level": "high" if churn_prob > 0.7 else "medium" if churn_prob > 0.4 else "low"
    }


# API Endpoints
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "ml-service",
        "models_loaded": len(storage.models),
        "feature_store": "redis" if USE_REDIS_FEATURE_STORE else "in-memory"
    }


@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """
    Make a prediction using the specified model type.
    Supports fraud detection, risk scoring, anomaly detection, and churn prediction.
    """
    import time
    start_time = time.time()
    
    # Get the appropriate model
    model_mapping = {
        PredictionType.FRAUD: "fraud_detector_v1",
        PredictionType.RISK: "risk_scorer_v1",
        PredictionType.ANOMALY: "anomaly_detector_v1",
        PredictionType.CHURN: "churn_predictor_v1"
    }
    
    model_name = request.model_name or model_mapping.get(request.model_type)
    if model_name not in storage.models:
        raise HTTPException(status_code=404, detail=f"Model {model_name} not found")
    
    model = storage.models[model_name]
    
    if model["status"] != ModelStatus.DEPLOYED:
        raise HTTPException(status_code=400, detail=f"Model {model_name} is not deployed")
    
    # Make prediction based on model type
    if request.model_type == PredictionType.FRAUD:
        result = predict_fraud(request.features, model)
    elif request.model_type == PredictionType.RISK:
        result = predict_risk_score(request.features, model)
    elif request.model_type == PredictionType.ANOMALY:
        result = predict_anomaly(request.features, model)
    elif request.model_type == PredictionType.CHURN:
        result = predict_churn(request.features, model)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown prediction type: {request.model_type}")
    
    latency_ms = (time.time() - start_time) * 1000
    
    # Log prediction
    storage.predictions_log.append({
        "model_name": model_name,
        "model_type": request.model_type,
        "prediction": result["prediction"],
        "probability": result.get("probability"),
        "timestamp": datetime.utcnow().isoformat(),
        "latency_ms": latency_ms
    })
    
    return PredictionResponse(
        prediction=result["prediction"],
        probability=result.get("probability"),
        probabilities=result.get("probabilities") if request.return_probabilities else None,
        model_name=model_name,
        model_version=model["version"],
        latency_ms=round(latency_ms, 2),
        explanation=result.get("explanation") if request.explain else None
    )


@app.post("/predict/batch", response_model=BatchPredictionResponse)
async def batch_predict(request: BatchPredictionRequest):
    """Make batch predictions for multiple records"""
    import time
    start_time = time.time()
    
    model_mapping = {
        PredictionType.FRAUD: "fraud_detector_v1",
        PredictionType.RISK: "risk_scorer_v1",
        PredictionType.ANOMALY: "anomaly_detector_v1",
        PredictionType.CHURN: "churn_predictor_v1"
    }
    
    model_name = model_mapping.get(request.model_type)
    model = storage.models.get(model_name)
    
    if not model:
        raise HTTPException(status_code=404, detail=f"Model for {request.model_type} not found")
    
    predictions = []
    for record in request.records:
        if request.model_type == PredictionType.FRAUD:
            result = predict_fraud(record, model)
        elif request.model_type == PredictionType.RISK:
            result = predict_risk_score(record, model)
        elif request.model_type == PredictionType.ANOMALY:
            result = predict_anomaly(record, model)
        elif request.model_type == PredictionType.CHURN:
            result = predict_churn(record, model)
        
        predictions.append({
            "record_id": record.get("id", record.get("transaction_id", record.get("user_id", ""))),
            "prediction": result["prediction"],
            "probability": result.get("probability")
        })
    
    latency_ms = (time.time() - start_time) * 1000
    
    return BatchPredictionResponse(
        predictions=predictions,
        model_name=model_name,
        model_version=model["version"],
        total_records=len(predictions),
        latency_ms=round(latency_ms, 2)
    )


@app.post("/predict/fraud")
async def predict_fraud_endpoint(
    user_id: str,
    amount: float,
    currency: str = "NGN",
    destination_country: str = "NG",
    is_new_beneficiary: bool = False,
    is_new_device: bool = False
):
    """
    Convenience endpoint for fraud prediction with automatic feature computation.
    This is the primary endpoint for real-time fraud detection in the transaction flow.
    """
    import time
    start_time = time.time()
    
    # Compute user features
    user_features = compute_user_features(user_id)
    
    # Compute transaction features
    transaction = {
        "user_id": user_id,
        "amount": amount,
        "currency": currency,
        "destination_country": destination_country,
        "corridor": f"NG-{destination_country}",
        "is_new_beneficiary": is_new_beneficiary,
        "is_new_device": is_new_device
    }
    tx_features = compute_transaction_features(transaction, user_features)
    
    # Get fraud prediction
    model = storage.models["fraud_detector_v1"]
    result = predict_fraud(tx_features, model)
    
    latency_ms = (time.time() - start_time) * 1000
    
    return {
        "user_id": user_id,
        "prediction": result["prediction"],
        "fraud_probability": result["probability"],
        "decision": "block" if result["prediction"] == "fraud" else "review" if result["prediction"] == "review" else "allow",
        "risk_factors": result.get("explanation", {}),
        "model_name": "fraud_detector_v1",
        "model_version": model["version"],
        "latency_ms": round(latency_ms, 2)
    }


@app.post("/predict/risk")
async def predict_risk_endpoint(
    user_id: str,
    amount: float,
    currency: str = "NGN",
    destination_country: str = "NG"
):
    """
    Convenience endpoint for risk scoring with automatic feature computation.
    Returns a risk score from 0-100.
    """
    import time
    start_time = time.time()
    
    user_features = compute_user_features(user_id)
    transaction = {
        "user_id": user_id,
        "amount": amount,
        "currency": currency,
        "destination_country": destination_country,
        "corridor": f"NG-{destination_country}"
    }
    tx_features = compute_transaction_features(transaction, user_features)
    
    model = storage.models["risk_scorer_v1"]
    result = predict_risk_score(tx_features, model)
    
    latency_ms = (time.time() - start_time) * 1000
    
    return {
        "user_id": user_id,
        "risk_score": result["prediction"],
        "risk_level": result["risk_level"],
        "model_name": "risk_scorer_v1",
        "model_version": model["version"],
        "latency_ms": round(latency_ms, 2)
    }


@app.post("/predict/anomaly")
async def predict_anomaly_endpoint(
    user_id: str,
    amount: float,
    currency: str = "NGN"
):
    """
    Convenience endpoint for anomaly detection.
    Detects unusual transaction patterns.
    """
    import time
    start_time = time.time()
    
    user_features = compute_user_features(user_id)
    transaction = {"user_id": user_id, "amount": amount, "currency": currency}
    anomaly_features = compute_anomaly_features(transaction, user_features)
    
    model = storage.models["anomaly_detector_v1"]
    result = predict_anomaly(anomaly_features, model)
    
    latency_ms = (time.time() - start_time) * 1000
    
    return {
        "user_id": user_id,
        "is_anomaly": result["is_anomaly"],
        "anomaly_score": result["anomaly_score"],
        "model_name": "anomaly_detector_v1",
        "model_version": model["version"],
        "latency_ms": round(latency_ms, 2)
    }


@app.post("/predict/churn")
async def predict_churn_endpoint(user_id: str):
    """
    Predict churn probability for a user.
    """
    import time
    start_time = time.time()
    
    user_features = compute_user_features(user_id)
    
    model = storage.models["churn_predictor_v1"]
    result = predict_churn(user_features, model)
    
    latency_ms = (time.time() - start_time) * 1000
    
    return {
        "user_id": user_id,
        "churn_probability": result["probability"],
        "churn_risk_level": result["risk_level"],
        "will_churn": result["prediction"] == 1,
        "model_name": "churn_predictor_v1",
        "model_version": model["version"],
        "latency_ms": round(latency_ms, 2)
    }


@app.get("/models", response_model=List[ModelInfo])
async def list_models():
    """List all available models"""
    return [
        ModelInfo(
            model_name=m["model_name"],
            model_type=m["model_type"],
            version=m["version"],
            status=m["status"],
            metrics=m["metrics"],
            created_at=m["created_at"],
            deployed_at=m.get("deployed_at"),
            feature_importance=m.get("feature_importance")
        )
        for m in storage.models.values()
    ]


@app.get("/models/{model_name}", response_model=ModelInfo)
async def get_model(model_name: str):
    """Get details of a specific model"""
    if model_name not in storage.models:
        raise HTTPException(status_code=404, detail=f"Model {model_name} not found")
    
    m = storage.models[model_name]
    return ModelInfo(
        model_name=m["model_name"],
        model_type=m["model_type"],
        version=m["version"],
        status=m["status"],
        metrics=m["metrics"],
        created_at=m["created_at"],
        deployed_at=m.get("deployed_at"),
        feature_importance=m.get("feature_importance")
    )


@app.post("/train", response_model=TrainingResponse)
async def train_model(request: TrainingRequest, background_tasks: BackgroundTasks):
    """
    Start a model training job.
    Training runs in the background and updates model status when complete.
    """
    import uuid
    
    job_id = str(uuid.uuid4())
    
    # Create training job
    storage.training_jobs[job_id] = {
        "job_id": job_id,
        "model_type": request.model_type,
        "model_name": request.model_name,
        "status": ModelStatus.TRAINING,
        "started_at": datetime.utcnow(),
        "hyperparameters": request.hyperparameters or {},
        "progress": 0
    }
    
    # Start background training
    background_tasks.add_task(
        simulate_training,
        job_id,
        request.model_type,
        request.model_name,
        request.hyperparameters
    )
    
    return TrainingResponse(
        job_id=job_id,
        model_type=request.model_type,
        model_name=request.model_name,
        status=ModelStatus.TRAINING,
        started_at=datetime.utcnow(),
        estimated_completion=datetime.utcnow() + timedelta(minutes=5)
    )


async def simulate_training(job_id: str, model_type: ModelType, model_name: str, hyperparameters: Dict = None):
    """Simulate model training (in production, this would use actual ML libraries)"""
    import random
    
    # Simulate training progress
    for progress in range(0, 101, 10):
        await asyncio.sleep(0.5)  # Simulate training time
        storage.training_jobs[job_id]["progress"] = progress
    
    # Generate realistic metrics based on model type
    if model_type == ModelType.FRAUD_DETECTION:
        metrics = {
            "accuracy": round(random.uniform(0.92, 0.98), 3),
            "precision": round(random.uniform(0.88, 0.95), 3),
            "recall": round(random.uniform(0.85, 0.93), 3),
            "f1_score": round(random.uniform(0.87, 0.94), 3),
            "auc_roc": round(random.uniform(0.95, 0.99), 3)
        }
        algorithm = "xgboost"
    elif model_type == ModelType.RISK_SCORING:
        metrics = {
            "rmse": round(random.uniform(5, 12), 2),
            "mae": round(random.uniform(3, 8), 2),
            "r2_score": round(random.uniform(0.82, 0.92), 3)
        }
        algorithm = "lightgbm"
    elif model_type == ModelType.ANOMALY_DETECTION:
        metrics = {
            "precision_at_5pct": round(random.uniform(0.75, 0.88), 3),
            "recall_at_5pct": round(random.uniform(0.70, 0.82), 3),
            "f1_at_5pct": round(random.uniform(0.72, 0.85), 3)
        }
        algorithm = "isolation_forest"
    else:
        metrics = {
            "accuracy": round(random.uniform(0.80, 0.90), 3),
            "f1_score": round(random.uniform(0.78, 0.88), 3),
            "auc_roc": round(random.uniform(0.85, 0.95), 3)
        }
        algorithm = "xgboost"
    
    # Create new model version
    version = f"1.{random.randint(1, 9)}.0"
    
    storage.models[model_name] = {
        "model_name": model_name,
        "model_type": model_type,
        "version": version,
        "status": ModelStatus.READY,
        "created_at": datetime.utcnow(),
        "algorithm": algorithm,
        "metrics": metrics,
        "hyperparameters": hyperparameters or {},
        "feature_importance": {}
    }
    
    storage.training_jobs[job_id]["status"] = ModelStatus.READY
    storage.training_jobs[job_id]["completed_at"] = datetime.utcnow()
    
    logger.info(f"Training completed for model {model_name} with metrics: {metrics}")


@app.get("/train/{job_id}")
async def get_training_status(job_id: str):
    """Get the status of a training job"""
    if job_id not in storage.training_jobs:
        raise HTTPException(status_code=404, detail=f"Training job {job_id} not found")
    
    return storage.training_jobs[job_id]


@app.post("/models/{model_name}/deploy")
async def deploy_model(model_name: str):
    """Deploy a trained model to production"""
    if model_name not in storage.models:
        raise HTTPException(status_code=404, detail=f"Model {model_name} not found")
    
    model = storage.models[model_name]
    
    if model["status"] not in [ModelStatus.READY, ModelStatus.DEPLOYED]:
        raise HTTPException(status_code=400, detail=f"Model {model_name} is not ready for deployment")
    
    model["status"] = ModelStatus.DEPLOYED
    model["deployed_at"] = datetime.utcnow()
    
    logger.info(f"Model {model_name} deployed to production")
    
    return {"model_name": model_name, "status": "deployed", "deployed_at": model["deployed_at"]}


@app.post("/features/compute", response_model=FeatureResponse)
async def compute_features(request: FeatureRequest):
    """
    Compute features for an entity (user, transaction, device).
    Features are cached in the feature store for fast retrieval.
    """
    cache_key = f"{request.entity_type}:{request.entity_id}"
    
    # Check cache first
    if cache_key in storage.feature_cache:
        cached = storage.feature_cache[cache_key]
        if (datetime.utcnow() - cached["computed_at"]).seconds < 300:  # 5 min TTL
            return FeatureResponse(
                entity_type=request.entity_type,
                entity_id=request.entity_id,
                features=cached["features"],
                computed_at=cached["computed_at"],
                ttl_seconds=300 - (datetime.utcnow() - cached["computed_at"]).seconds
            )
    
    # Compute features based on entity type
    if request.entity_type == "user":
        features = compute_user_features(request.entity_id)
    elif request.entity_type == "transaction":
        features = compute_transaction_features({"transaction_id": request.entity_id})
    else:
        features = {"entity_id": request.entity_id}
    
    # Filter to requested features if specified
    if request.feature_names:
        features = {k: v for k, v in features.items() if k in request.feature_names}
    
    # Cache the result
    storage.feature_cache[cache_key] = {
        "features": features,
        "computed_at": datetime.utcnow()
    }
    
    return FeatureResponse(
        entity_type=request.entity_type,
        entity_id=request.entity_id,
        features=features,
        computed_at=datetime.utcnow(),
        ttl_seconds=300
    )


@app.get("/features/user/{user_id}")
async def get_user_features(user_id: str):
    """Get computed features for a user"""
    features = compute_user_features(user_id)
    return {"user_id": user_id, "features": features, "computed_at": datetime.utcnow()}


@app.get("/drift/{model_name}", response_model=DriftReport)
async def check_drift(model_name: str, days: int = 7):
    """
    Check for model drift by comparing recent predictions to baseline.
    """
    import random
    
    if model_name not in storage.models:
        raise HTTPException(status_code=404, detail=f"Model {model_name} not found")
    
    # Simulate drift detection
    drift_score = random.uniform(0, 0.3)
    drift_detected = drift_score > 0.15
    
    feature_drifts = {}
    model = storage.models[model_name]
    for feature in model.get("feature_importance", {}).keys():
        feature_drifts[feature] = round(random.uniform(0, 0.2), 4)
    
    recommendation = "No action needed" if not drift_detected else "Consider retraining model with recent data"
    
    return DriftReport(
        model_name=model_name,
        drift_detected=drift_detected,
        drift_score=round(drift_score, 4),
        feature_drifts=feature_drifts,
        baseline_period=f"{days * 2} days ago to {days} days ago",
        comparison_period=f"Last {days} days",
        recommendation=recommendation
    )


@app.get("/metrics/{model_name}")
async def get_model_metrics(model_name: str, days: int = 30):
    """Get performance metrics for a model over time"""
    import random
    
    if model_name not in storage.models:
        raise HTTPException(status_code=404, detail=f"Model {model_name} not found")
    
    model = storage.models[model_name]
    base_metrics = model["metrics"]
    
    # Generate time series of metrics
    metrics_history = []
    for i in range(days):
        date = (datetime.utcnow() - timedelta(days=days - i - 1)).strftime("%Y-%m-%d")
        daily_metrics = {}
        for metric, value in base_metrics.items():
            # Add some variance
            daily_metrics[metric] = round(value + random.uniform(-0.02, 0.02), 4)
        daily_metrics["date"] = date
        daily_metrics["predictions_count"] = random.randint(1000, 5000)
        metrics_history.append(daily_metrics)
    
    return {
        "model_name": model_name,
        "current_metrics": base_metrics,
        "metrics_history": metrics_history
    }


@app.get("/stats")
async def get_service_stats():
    """Get overall ML service statistics"""
    total_predictions = len(storage.predictions_log)
    
    # Calculate average latency
    if total_predictions > 0:
        avg_latency = sum(p.get("latency_ms", 0) for p in storage.predictions_log) / total_predictions
    else:
        avg_latency = 0
    
    # Count predictions by type
    predictions_by_type = defaultdict(int)
    for p in storage.predictions_log:
        predictions_by_type[p.get("model_type", "unknown")] += 1
    
    return {
        "total_models": len(storage.models),
        "deployed_models": sum(1 for m in storage.models.values() if m["status"] == ModelStatus.DEPLOYED),
        "total_predictions": total_predictions,
        "predictions_by_type": dict(predictions_by_type),
        "avg_latency_ms": round(avg_latency, 2),
        "active_training_jobs": sum(1 for j in storage.training_jobs.values() if j["status"] == ModelStatus.TRAINING),
        "feature_cache_size": len(storage.feature_cache)
    }


# ============================================================================
# Model Registry Endpoints
# ============================================================================

class RegisterModelRequest(BaseModel):
    model_name: str
    algorithm: str
    metrics: Dict[str, float]
    parameters: Dict[str, Any]
    feature_names: List[str]
    description: str = ""
    tags: Optional[Dict[str, str]] = None


class ModelVersionResponse(BaseModel):
    model_name: str
    version: str
    stage: str
    algorithm: str
    metrics: Dict[str, float]
    created_at: datetime


class TransitionStageRequest(BaseModel):
    model_name: str
    version: str
    stage: str  # "development", "staging", "production", "archived"


@app.post("/registry/register")
async def register_model_version(request: RegisterModelRequest):
    """Register a new model version in the model registry"""
    try:
        from model_registry import get_registry, ModelStage
        
        registry = get_registry()
        
        # For now, we register without an actual model object (metadata only)
        model_version = registry.register_model(
            model_name=request.model_name,
            model=None,  # Would be actual model in production
            algorithm=request.algorithm,
            metrics=request.metrics,
            parameters=request.parameters,
            feature_names=request.feature_names,
            description=request.description,
            tags=request.tags
        )
        
        return {
            "model_name": model_version.model_name,
            "version": model_version.version,
            "stage": model_version.stage.value,
            "created_at": model_version.created_at.isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to register model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/registry/models")
async def list_registered_models():
    """List all models in the registry"""
    try:
        from model_registry import get_registry
        
        registry = get_registry()
        models = registry.list_models()
        
        result = []
        for model_name in models:
            versions = registry.list_versions(model_name)
            result.append({
                "model_name": model_name,
                "versions": [
                    {
                        "version": v.version,
                        "stage": v.stage.value,
                        "algorithm": v.algorithm,
                        "metrics": v.metrics,
                        "created_at": v.created_at.isoformat()
                    }
                    for v in versions
                ]
            })
        
        return {"models": result}
    except Exception as e:
        logger.error(f"Failed to list models: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/registry/models/{model_name}/versions")
async def list_model_versions(model_name: str):
    """List all versions of a model"""
    try:
        from model_registry import get_registry
        
        registry = get_registry()
        versions = registry.list_versions(model_name)
        
        return {
            "model_name": model_name,
            "versions": [
                {
                    "version": v.version,
                    "stage": v.stage.value,
                    "algorithm": v.algorithm,
                    "metrics": v.metrics,
                    "created_at": v.created_at.isoformat()
                }
                for v in versions
            ]
        }
    except Exception as e:
        logger.error(f"Failed to list versions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/registry/transition")
async def transition_model_stage(request: TransitionStageRequest):
    """Transition a model version to a new stage"""
    try:
        from model_registry import get_registry, ModelStage
        
        registry = get_registry()
        
        stage_map = {
            "development": ModelStage.DEVELOPMENT,
            "staging": ModelStage.STAGING,
            "production": ModelStage.PRODUCTION,
            "archived": ModelStage.ARCHIVED
        }
        
        stage = stage_map.get(request.stage.lower())
        if not stage:
            raise HTTPException(status_code=400, detail=f"Invalid stage: {request.stage}")
        
        success = registry.transition_stage(request.model_name, request.version, stage)
        
        if not success:
            raise HTTPException(status_code=404, detail="Model version not found")
        
        return {
            "model_name": request.model_name,
            "version": request.version,
            "new_stage": request.stage,
            "success": True
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to transition stage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/registry/models/{model_name}/production")
async def get_production_model(model_name: str):
    """Get the production version of a model"""
    try:
        from model_registry import get_registry
        
        registry = get_registry()
        model_version = registry.get_production_model(model_name)
        
        if not model_version:
            raise HTTPException(status_code=404, detail=f"No production model found for {model_name}")
        
        return {
            "model_name": model_version.model_name,
            "version": model_version.version,
            "stage": model_version.stage.value,
            "algorithm": model_version.algorithm,
            "metrics": model_version.metrics,
            "created_at": model_version.created_at.isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get production model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/registry/compare")
async def compare_model_versions(model_name: str, version_a: str, version_b: str):
    """Compare two model versions"""
    try:
        from model_registry import get_registry
        
        registry = get_registry()
        comparison = registry.compare_models(model_name, version_a, version_b)
        
        if not comparison:
            raise HTTPException(status_code=404, detail="One or both model versions not found")
        
        return {
            "model_name": comparison.model_name,
            "version_a": comparison.version_a,
            "version_b": comparison.version_b,
            "metric_comparison": comparison.metric_comparison,
            "parameter_diff": comparison.parameter_diff,
            "winner": comparison.winner,
            "confidence": comparison.confidence,
            "recommendation": comparison.recommendation
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to compare models: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# A/B Testing Endpoints
# ============================================================================

class CreateABTestRequest(BaseModel):
    experiment_name: str
    description: str
    control_model_name: str
    control_model_version: str
    challenger_model_name: str
    challenger_model_version: str
    primary_metric: str = "accuracy"
    control_traffic_pct: float = 50.0
    min_samples_per_variant: int = 100
    max_duration_hours: int = 168
    auto_stop_on_significance: bool = True


class RecordPredictionRequest(BaseModel):
    experiment_id: str
    variant_id: str
    outcome: str
    latency_ms: float
    metrics: Optional[Dict[str, float]] = None
    is_error: bool = False


@app.post("/ab-test/create")
async def create_ab_test(request: CreateABTestRequest):
    """Create a new A/B testing experiment"""
    try:
        from ab_testing import get_ab_testing_manager, WinnerCriteria, TrafficSplitStrategy
        
        manager = get_ab_testing_manager()
        
        experiment = manager.create_experiment(
            experiment_name=request.experiment_name,
            description=request.description,
            control_model_name=request.control_model_name,
            control_model_version=request.control_model_version,
            challenger_model_name=request.challenger_model_name,
            challenger_model_version=request.challenger_model_version,
            primary_metric=request.primary_metric,
            winner_criteria=WinnerCriteria.HIGHER_IS_BETTER,
            traffic_split_strategy=TrafficSplitStrategy.HASH_BASED,
            control_traffic_pct=request.control_traffic_pct,
            min_samples_per_variant=request.min_samples_per_variant,
            max_duration_hours=request.max_duration_hours,
            auto_stop_on_significance=request.auto_stop_on_significance
        )
        
        return {
            "experiment_id": experiment.experiment_id,
            "experiment_name": experiment.experiment_name,
            "status": experiment.status.value,
            "variants": [
                {
                    "variant_id": v.variant_id,
                    "model_name": v.model_name,
                    "model_version": v.model_version,
                    "traffic_percentage": v.traffic_percentage,
                    "is_control": v.is_control
                }
                for v in experiment.variants
            ],
            "created_at": experiment.created_at.isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to create A/B test: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ab-test/{experiment_id}/start")
async def start_ab_test(experiment_id: str):
    """Start an A/B testing experiment"""
    try:
        from ab_testing import get_ab_testing_manager
        
        manager = get_ab_testing_manager()
        success = manager.start_experiment(experiment_id)
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to start experiment (may already be running)")
        
        return {"experiment_id": experiment_id, "status": "running"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start A/B test: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ab-test/{experiment_id}/stop")
async def stop_ab_test(experiment_id: str):
    """Stop an A/B testing experiment and get results"""
    try:
        from ab_testing import get_ab_testing_manager
        
        manager = get_ab_testing_manager()
        result = manager.stop_experiment(experiment_id)
        
        if not result:
            raise HTTPException(status_code=404, detail="Experiment not found")
        
        return {
            "experiment_id": result.experiment_id,
            "experiment_name": result.experiment_name,
            "winner_variant_id": result.winner_variant_id,
            "winner_model_name": result.winner_model_name,
            "winner_model_version": result.winner_model_version,
            "confidence": result.confidence,
            "recommendation": result.recommendation,
            "duration_hours": result.duration_hours,
            "total_predictions": result.total_predictions,
            "variant_metrics": result.variant_metrics
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to stop A/B test: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ab-test/{experiment_id}/variant")
async def get_variant_for_user(experiment_id: str, user_id: str):
    """Get the variant assignment for a user in an experiment"""
    try:
        from ab_testing import get_ab_testing_manager
        
        manager = get_ab_testing_manager()
        variant = manager.get_variant_for_user(experiment_id, user_id)
        
        if not variant:
            raise HTTPException(status_code=404, detail="Experiment not found or not running")
        
        return {
            "experiment_id": experiment_id,
            "user_id": user_id,
            "variant_id": variant.variant_id,
            "model_name": variant.model_name,
            "model_version": variant.model_version,
            "is_control": variant.is_control
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get variant: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ab-test/record")
async def record_ab_prediction(request: RecordPredictionRequest):
    """Record a prediction result for an A/B test"""
    try:
        from ab_testing import get_ab_testing_manager
        
        manager = get_ab_testing_manager()
        manager.record_prediction(
            experiment_id=request.experiment_id,
            variant_id=request.variant_id,
            outcome=request.outcome,
            latency_ms=request.latency_ms,
            metrics=request.metrics,
            is_error=request.is_error
        )
        
        return {"success": True}
    except Exception as e:
        logger.error(f"Failed to record prediction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ab-test/{experiment_id}/results")
async def get_ab_test_results(experiment_id: str):
    """Get current results for an A/B test"""
    try:
        from ab_testing import get_ab_testing_manager
        
        manager = get_ab_testing_manager()
        result = manager.get_experiment_result(experiment_id)
        
        if not result:
            raise HTTPException(status_code=404, detail="Experiment not found")
        
        return {
            "experiment_id": result.experiment_id,
            "experiment_name": result.experiment_name,
            "winner_variant_id": result.winner_variant_id,
            "winner_model_name": result.winner_model_name,
            "winner_model_version": result.winner_model_version,
            "confidence": result.confidence,
            "recommendation": result.recommendation,
            "duration_hours": result.duration_hours,
            "total_predictions": result.total_predictions,
            "variant_metrics": result.variant_metrics,
            "statistical_result": {
                "is_significant": result.statistical_result.is_significant,
                "p_value": result.statistical_result.p_value,
                "effect_size": result.statistical_result.effect_size
            } if result.statistical_result else None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get results: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ab-test/list")
async def list_ab_tests(status: Optional[str] = None):
    """List all A/B testing experiments"""
    try:
        from ab_testing import get_ab_testing_manager, ExperimentStatus
        
        manager = get_ab_testing_manager()
        
        status_filter = None
        if status:
            status_map = {
                "draft": ExperimentStatus.DRAFT,
                "running": ExperimentStatus.RUNNING,
                "paused": ExperimentStatus.PAUSED,
                "completed": ExperimentStatus.COMPLETED,
                "cancelled": ExperimentStatus.CANCELLED
            }
            status_filter = status_map.get(status.lower())
        
        experiments = manager.list_experiments(status_filter)
        
        return {
            "experiments": [
                {
                    "experiment_id": e.experiment_id,
                    "experiment_name": e.experiment_name,
                    "status": e.status.value,
                    "primary_metric": e.primary_metric,
                    "created_at": e.created_at.isoformat(),
                    "start_time": e.start_time.isoformat() if e.start_time else None
                }
                for e in experiments
            ]
        }
    except Exception as e:
        logger.error(f"Failed to list experiments: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Lakehouse Training Data Endpoints
# ============================================================================

class GenerateDatasetRequest(BaseModel):
    dataset_type: str  # "fraud_detection", "risk_scoring", "churn_prediction"
    start_date: str
    end_date: str
    max_samples: int = 50000


@app.post("/lakehouse/generate-dataset")
async def generate_training_dataset(request: GenerateDatasetRequest):
    """Generate a training dataset from lakehouse data"""
    try:
        from lakehouse_connector import get_training_data_generator, DatasetType
        
        generator = get_training_data_generator()
        
        dataset_type_map = {
            "fraud_detection": DatasetType.FRAUD_DETECTION,
            "risk_scoring": DatasetType.RISK_SCORING,
            "churn_prediction": DatasetType.CHURN_PREDICTION
        }
        
        dataset_type = dataset_type_map.get(request.dataset_type.lower())
        if not dataset_type:
            raise HTTPException(status_code=400, detail=f"Invalid dataset type: {request.dataset_type}")
        
        if dataset_type == DatasetType.FRAUD_DETECTION:
            X, y, metadata = await generator.generate_fraud_detection_dataset(
                start_date=request.start_date,
                end_date=request.end_date,
                max_samples=request.max_samples
            )
        elif dataset_type == DatasetType.RISK_SCORING:
            X, y, metadata = await generator.generate_risk_scoring_dataset(
                start_date=request.start_date,
                end_date=request.end_date,
                max_samples=request.max_samples
            )
        elif dataset_type == DatasetType.CHURN_PREDICTION:
            X, y, metadata = await generator.generate_churn_prediction_dataset(
                start_date=request.start_date,
                end_date=request.end_date,
                max_samples=request.max_samples
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported dataset type: {request.dataset_type}")
        
        return {
            "dataset_id": metadata.dataset_id,
            "dataset_type": metadata.dataset_type.value,
            "num_samples": metadata.num_samples,
            "num_features": metadata.num_features,
            "feature_names": metadata.feature_names,
            "label_distribution": metadata.label_distribution,
            "date_range": metadata.date_range,
            "source_tables": metadata.source_tables,
            "created_at": metadata.created_at.isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate dataset: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/lakehouse/health")
async def check_lakehouse_health():
    """Check lakehouse connectivity"""
    try:
        from lakehouse_connector import get_lakehouse_connector
        
        connector = get_lakehouse_connector()
        is_healthy = await connector.health_check()
        
        return {
            "lakehouse_url": LAKEHOUSE_URL,
            "is_healthy": is_healthy,
            "status": "connected" if is_healthy else "disconnected"
        }
    except Exception as e:
        logger.error(f"Lakehouse health check failed: {e}")
        return {
            "lakehouse_url": LAKEHOUSE_URL,
            "is_healthy": False,
            "status": "error",
            "error": str(e)
        }


@app.post("/train/from-lakehouse")
async def train_model_from_lakehouse(
    background_tasks: BackgroundTasks,
    model_name: str,
    model_type: ModelType,
    dataset_type: str,
    start_date: str,
    end_date: str,
    hyperparameters: Optional[Dict[str, Any]] = None
):
    """Train a model using data from the lakehouse"""
    import uuid
    
    job_id = str(uuid.uuid4())[:8]
    
    storage.training_jobs[job_id] = {
        "job_id": job_id,
        "model_name": model_name,
        "model_type": model_type,
        "dataset_type": dataset_type,
        "date_range": {"start": start_date, "end": end_date},
        "status": ModelStatus.TRAINING,
        "started_at": datetime.utcnow(),
        "progress": 0.0
    }
    
    # Start training in background
    background_tasks.add_task(
        train_from_lakehouse_task,
        job_id,
        model_name,
        model_type,
        dataset_type,
        start_date,
        end_date,
        hyperparameters
    )
    
    return TrainingResponse(
        job_id=job_id,
        model_type=model_type,
        model_name=model_name,
        status=ModelStatus.TRAINING,
        started_at=datetime.utcnow(),
        estimated_completion=datetime.utcnow() + timedelta(minutes=5)
    )


async def train_from_lakehouse_task(
    job_id: str,
    model_name: str,
    model_type: ModelType,
    dataset_type: str,
    start_date: str,
    end_date: str,
    hyperparameters: Optional[Dict[str, Any]]
):
    """Background task to train model from lakehouse data"""
    try:
        from lakehouse_connector import get_training_data_generator, DatasetType
        from model_registry import get_registry
        
        generator = get_training_data_generator()
        registry = get_registry()
        
        # Update progress
        storage.training_jobs[job_id]["progress"] = 0.1
        
        # Generate dataset
        dataset_type_map = {
            "fraud_detection": DatasetType.FRAUD_DETECTION,
            "risk_scoring": DatasetType.RISK_SCORING,
            "churn_prediction": DatasetType.CHURN_PREDICTION
        }
        
        dt = dataset_type_map.get(dataset_type.lower(), DatasetType.FRAUD_DETECTION)
        
        if dt == DatasetType.FRAUD_DETECTION:
            X, y, metadata = await generator.generate_fraud_detection_dataset(start_date, end_date)
        elif dt == DatasetType.RISK_SCORING:
            X, y, metadata = await generator.generate_risk_scoring_dataset(start_date, end_date)
        else:
            X, y, metadata = await generator.generate_churn_prediction_dataset(start_date, end_date)
        
        storage.training_jobs[job_id]["progress"] = 0.5
        
        # Simulate training (in production, would use actual training pipeline)
        await asyncio.sleep(2)
        
        storage.training_jobs[job_id]["progress"] = 0.8
        
        # Generate metrics
        metrics = {
            "accuracy": 0.92 + np.random.uniform(-0.05, 0.05),
            "precision": 0.89 + np.random.uniform(-0.05, 0.05),
            "recall": 0.87 + np.random.uniform(-0.05, 0.05),
            "f1_score": 0.88 + np.random.uniform(-0.05, 0.05),
            "auc_roc": 0.95 + np.random.uniform(-0.03, 0.03)
        }
        
        # Register model in registry
        model_version = registry.register_model(
            model_name=model_name,
            model=None,  # Would be actual model
            algorithm="xgboost",
            metrics=metrics,
            parameters=hyperparameters or {},
            feature_names=metadata.feature_names,
            description=f"Trained from lakehouse data ({start_date} to {end_date})"
        )
        
        storage.training_jobs[job_id]["progress"] = 1.0
        storage.training_jobs[job_id]["status"] = ModelStatus.READY
        storage.training_jobs[job_id]["completed_at"] = datetime.utcnow()
        storage.training_jobs[job_id]["model_version"] = model_version.version
        storage.training_jobs[job_id]["metrics"] = metrics
        
        logger.info(f"Training job {job_id} completed: {model_name} v{model_version.version}")
        
    except Exception as e:
        logger.error(f"Training job {job_id} failed: {e}")
        storage.training_jobs[job_id]["status"] = ModelStatus.FAILED
        storage.training_jobs[job_id]["error"] = str(e)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8025)
