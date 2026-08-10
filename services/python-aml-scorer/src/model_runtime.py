"""
RemitFlow AML Scorer Service
FastAPI + real model loading + fail-closed design
Port: 8096

REQUIRED:
  - MODEL_PATH: path to a trained scikit-learn / XGBoost / LightGBM model artifact
  - MODEL_METADATA_PATH: path to model metadata (feature names, thresholds, training date)
  - DATABASE_URL: PostgreSQL for audit trail

FAIL-CLOSED:
  If model artifact is missing or stale (>30 days), returns HTTP 503.
  NEVER generates synthetic scores.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import pickle
import signal
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS aml_scores (
                    id BIGSERIAL PRIMARY KEY,
                    transaction_id TEXT,
                    user_id TEXT,
                    score REAL NOT NULL,
                    model_version TEXT,
                    model_age_days INT,
                    features JSONB,
                    flagged BOOLEAN,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_aml_tx ON aml_scores(transaction_id);
            """)
    return _db_pool
# ── End PostgreSQL persistence ──────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[AML-SCORER] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow AML Scorer",
    description="Real AML risk scoring with trained model artifact",
    version="2.0.0",
)

_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Model Loading ────────────────────────────────────────────────────────────
MODEL_PATH = os.getenv("MODEL_PATH", "/models/aml_model.joblib")
MODEL_METADATA_PATH = os.getenv("MODEL_METADATA_PATH", "/models/aml_model_metadata.json")
MAX_MODEL_AGE_DAYS = int(os.getenv("MAX_MODEL_AGE_DAYS", "30"))

_model = None
_model_metadata = None
_model_loaded = False

def _load_model():
    global _model, _model_metadata, _model_loaded

    if not os.path.exists(MODEL_PATH):
        logger.error(f"Model artifact NOT FOUND at {MODEL_PATH}")
        return

    if not os.path.exists(MODEL_METADATA_PATH):
        logger.error(f"Model metadata NOT FOUND at {MODEL_METADATA_PATH}")
        return

    try:
        with open(MODEL_METADATA_PATH, 'r') as f:
            _model_metadata = json.load(f)

        training_date = datetime.fromisoformat(_model_metadata.get("training_date", "1970-01-01"))
        model_age_days = (datetime.now(timezone.utc) - training_date).days

        if model_age_days > MAX_MODEL_AGE_DAYS:
            logger.error(f"Model is {model_age_days} days old (max allowed: {MAX_MODEL_AGE_DAYS}). Refusing to load stale model.")
            return

        _model = joblib.load(MODEL_PATH)
        _model_loaded = True
        logger.info(f"AML model loaded: version={_model_metadata.get('version', 'unknown')}, age={model_age_days}d, features={len(_model_metadata.get('feature_names', []))}")

    except Exception as e:
        logger.error(f"Failed to load model: {e}")

_load_model()

# ─── Pydantic Models ─────────────────────────────────────────────────────────

class AMLScoreRequest(BaseModel):
    transaction_id: Optional[str] = None
    user_id: Optional[str] = None
    amount_usd: float = Field(..., gt=0)
    sender_country: str = "GB"
    receiver_country: str = "NG"
    velocity_24h: int = 0
    is_round_number: bool = False
    is_structuring: bool = False
    cross_border: bool = True
    payment_method: str = "bank_transfer"
    days_since_registration: int = 0
    device_fingerprint_match: bool = True
    ip_reputation_score: float = Field(default=0.0, ge=0.0, le=1.0)
    previous_chargebacks: int = 0

class AMLScoreResponse(BaseModel):
    transaction_id: Optional[str]
    risk_score: float
    risk_level: str
    model_version: str
    model_age_days: int
    flagged: bool
    features_used: List[str]
    timestamp: str

# ─── Feature Engineering (deterministic, auditable) ──────────────────────────

def _build_features(req: AMLScoreRequest) -> np.ndarray:
    """Build feature vector from request. Must match training schema exactly."""
    features = {
        "amount_usd_log": np.log1p(req.amount_usd),
        "sender_country_risk": 1.0 if req.sender_country in {"AF","MM","KP","IR","SY"} else 0.5 if req.sender_country in {"NG","GH","KE"} else 0.1,
        "receiver_country_risk": 1.0 if req.receiver_country in {"AF","MM","KP","IR","SY"} else 0.5 if req.receiver_country in {"NG","GH","KE"} else 0.1,
        "velocity_24h": req.velocity_24h,
        "is_round_number": 1.0 if req.is_round_number else 0.0,
        "is_structuring": 1.0 if req.is_structuring else 0.0,
        "cross_border": 1.0 if req.cross_border else 0.0,
        "payment_method_risk": 0.8 if req.payment_method in {"crypto","cash"} else 0.3 if req.payment_method in {"mobile_money"} else 0.1,
        "days_since_registration": req.days_since_registration,
        "device_fingerprint_match": 1.0 if req.device_fingerprint_match else 0.0,
        "ip_reputation_score": req.ip_reputation_score,
        "previous_chargebacks": req.previous_chargebacks,
    }

    if _model_metadata and "feature_names" in _model_metadata:
        ordered = _model_metadata["feature_names"]
        return np.array([[features.get(f, 0.0) for f in ordered]])

    return np.array([list(features.values())])

# ─── Handlers ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    if not _model_loaded:
        return {
            "status": "degraded",
            "service": "python-aml-scorer",
            "version": "2.0.0",
            "model_loaded": False,
            "model_path": MODEL_PATH,
            "error": "Model artifact not loaded. Scoring is unavailable.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    training_date = datetime.fromisoformat(_model_metadata.get("training_date", "1970-01-01"))
    age_days = (datetime.now(timezone.utc) - training_date).days

    return {
        "status": "ok" if age_days <= MAX_MODEL_AGE_DAYS else "stale_model",
        "service": "python-aml-scorer",
        "version": "2.0.0",
        "model_loaded": True,
        "model_version": _model_metadata.get("version", "unknown"),
        "model_age_days": age_days,
        "max_age_days": MAX_MODEL_AGE_DAYS,
        "feature_count": len(_model_metadata.get("feature_names", [])),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/aml/score", response_model=AMLScoreResponse)
def score_transaction(req: AMLScoreRequest):
    if not _model_loaded:
        raise HTTPException(
            status_code=503,
            detail="AML model not loaded. Cannot generate scores without a trained model artifact. "
                   "Set MODEL_PATH and MODEL_METADATA_PATH environment variables.",
        )

    X = _build_features(req)

    try:
        score = float(_model.predict_proba(X)[0][1])  # probability of class 1 (suspicious)
    except Exception as e:
        logger.error(f"Model inference failed: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Model inference failed: {e}. Cannot proceed without valid prediction.",
        )

    risk_level = (
        "critical" if score >= 0.85 else
        "high" if score >= 0.65 else
        "medium" if score >= 0.40 else
        "low"
    )
    flagged = score >= 0.65

    training_date = datetime.fromisoformat(_model_metadata.get("training_date", "1970-01-01"))
    age_days = (datetime.now(timezone.utc) - training_date).days

    # Persist to audit trail
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO aml_scores (transaction_id, user_id, score, model_version, model_age_days, features, flagged)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (req.transaction_id, req.user_id, score,
             _model_metadata.get("version", "unknown"), age_days,
             psycopg2.extras.Json(req.model_dump()), flagged)
        )

    return AMLScoreResponse(
        transaction_id=req.transaction_id,
        risk_score=round(score, 4),
        risk_level=risk_level,
        model_version=_model_metadata.get("version", "unknown"),
        model_age_days=age_days,
        flagged=flagged,
        features_used=_model_metadata.get("feature_names", []),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8096"))
    logger.info(f"Starting aml-scorer v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
