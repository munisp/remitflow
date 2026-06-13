"""
RemitFlow — Churn Prediction Service (Production)
Port: 8137

ML-powered churn risk scoring based on user behavior patterns.
Predicts probability of user becoming inactive within 30 days.

Architecture:
  - Feature engineering from transaction history
  - Gradient Boosted Trees model (simulated, production would use XGBoost)
  - Real-time scoring via REST API
  - Batch scoring for proactive campaigns

Endpoints:
  POST /score              — score a single user for churn risk
  POST /score-batch        — score multiple users
  GET  /feature-importance — feature importance for model interpretability
  GET  /health             — liveness probe
"""

import logging
import math
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
import signal
import atexit

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS churn_prediction_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_churn_prediction_updated
                    ON churn_prediction_state(updated_at);
                CREATE TABLE IF NOT EXISTS churn_prediction_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_churn_prediction_events_type
                    ON churn_prediction_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO churn_prediction_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM churn_prediction_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM churn_prediction_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO churn_prediction_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("churn-prediction")

PORT = int(os.getenv("PORT", "8137"))

app = FastAPI(title="Churn Prediction Service", version="1.0.0")

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-churn-prediction"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-churn-prediction"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-churn-prediction").info(f"Received signal {signum}, initiating graceful shutdown...")
    _emit_lifecycle_event("pod.shutdown.initiated", signal=signum)

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

# ── Pod Lifecycle Observability ─────────────────────────────────────────
import time as _time_mod
_PROCESS_START_TIME = _time_mod.time()
_LIFECYCLE_LOGGER = logging.getLogger("pod-lifecycle")

def _emit_lifecycle_event(event_type: str, **kwargs):
    """Emit structured JSON lifecycle event for OpenSearch/Fluentd ingestion."""
    import json as _json
    payload = {
        "event": event_type,
        "service": "python-churn-prediction",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-churn-prediction").info("FastAPI shutdown event — cleaning up resources")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

FEATURE_IMPORTANCE = [
    {"feature": "days_since_last_transfer", "importance": 0.28, "description": "Days since most recent transfer"},
    {"feature": "transfer_frequency_trend", "importance": 0.18, "description": "Change in transfer frequency over time"},
    {"feature": "amount_trend", "importance": 0.14, "description": "Change in average transfer amount"},
    {"feature": "support_tickets_30d", "importance": 0.12, "description": "Support tickets filed in last 30 days"},
    {"feature": "failed_transfers_30d", "importance": 0.10, "description": "Failed transfers in last 30 days"},
    {"feature": "corridor_diversity", "importance": 0.08, "description": "Number of unique corridors used"},
    {"feature": "kyc_tier", "importance": 0.05, "description": "KYC verification level"},
    {"feature": "product_usage_depth", "importance": 0.05, "description": "Number of distinct products used"},
]


class UserFeatures(BaseModel):
    user_id: str
    days_since_last_transfer: int = Field(default=0, ge=0)
    total_transfers_30d: int = Field(default=0, ge=0)
    total_transfers_90d: int = Field(default=0, ge=0)
    avg_transfer_amount: float = Field(default=0, ge=0)
    failed_transfers_30d: int = Field(default=0, ge=0)
    support_tickets_30d: int = Field(default=0, ge=0)
    unique_corridors: int = Field(default=0, ge=0)
    kyc_tier: int = Field(default=0, ge=0, le=3)
    products_used: int = Field(default=0, ge=0)
    account_age_days: int = Field(default=0, ge=0)


class ChurnScore(BaseModel):
    user_id: str
    churn_probability: float
    risk_level: str  # low, medium, high, critical
    top_risk_factors: List[Dict[str, Any]]
    recommended_actions: List[str]
    scored_at: str


class BatchRequest(BaseModel):
    users: List[UserFeatures]


def compute_churn_score(features: UserFeatures) -> ChurnScore:
    """Compute churn probability from user features using weighted scoring."""
    score = 0.0

    # Days since last transfer (strongest signal)
    if features.days_since_last_transfer > 60:
        score += 0.35
    elif features.days_since_last_transfer > 30:
        score += 0.20
    elif features.days_since_last_transfer > 14:
        score += 0.08

    # Transfer frequency decline
    if features.total_transfers_90d > 0:
        recent_rate = features.total_transfers_30d / 30
        historical_rate = features.total_transfers_90d / 90
        if historical_rate > 0 and recent_rate / historical_rate < 0.5:
            score += 0.18

    # Failed transfers frustration
    if features.failed_transfers_30d > 2:
        score += 0.15
    elif features.failed_transfers_30d > 0:
        score += 0.05

    # Support tickets (frustration signal)
    if features.support_tickets_30d > 3:
        score += 0.12
    elif features.support_tickets_30d > 0:
        score += 0.04

    # Low engagement
    if features.unique_corridors <= 1:
        score += 0.05
    if features.products_used <= 1:
        score += 0.05

    # KYC tier (higher tier = more invested)
    if features.kyc_tier >= 2:
        score -= 0.10
    elif features.kyc_tier == 0:
        score += 0.05

    # Account age (new accounts churn more)
    if features.account_age_days < 30:
        score += 0.08

    probability = max(0.0, min(1.0, score))

    risk_level = "low"
    if probability > 0.7:
        risk_level = "critical"
    elif probability > 0.5:
        risk_level = "high"
    elif probability > 0.3:
        risk_level = "medium"

    risk_factors = []
    if features.days_since_last_transfer > 30:
        risk_factors.append({"factor": "Inactivity", "detail": f"{features.days_since_last_transfer} days since last transfer"})
    if features.failed_transfers_30d > 0:
        risk_factors.append({"factor": "Failed transfers", "detail": f"{features.failed_transfers_30d} failures in 30 days"})
    if features.support_tickets_30d > 0:
        risk_factors.append({"factor": "Support issues", "detail": f"{features.support_tickets_30d} tickets in 30 days"})

    actions = []
    if features.days_since_last_transfer > 30:
        actions.append("Send re-engagement notification with incentive")
    if features.failed_transfers_30d > 0:
        actions.append("Proactive support outreach about failed transfers")
    if features.kyc_tier < 2:
        actions.append("Offer KYC upgrade with fee discount")
    if features.unique_corridors <= 1:
        actions.append("Suggest new corridors with promotional rates")

    return ChurnScore(
        user_id=features.user_id,
        churn_probability=round(probability, 4),
        risk_level=risk_level,
        top_risk_factors=risk_factors[:3],
        recommended_actions=actions[:3],
        scored_at=datetime.utcnow().isoformat(),
    )


@app.post("/score", response_model=ChurnScore)
async def score_user(features: UserFeatures):
    start = time.time()
    result = compute_churn_score(features)
    latency_ms = (time.time() - start) * 1000
    logger.info(f"scored user={features.user_id} churn={result.churn_probability:.2f} risk={result.risk_level} latency={latency_ms:.1f}ms")
    return result


@app.post("/score-batch")
async def score_batch(req: BatchRequest):
    results = [compute_churn_score(u) for u in req.users]
    return {"scores": [r.dict() for r in results], "total": len(results)}


@app.get("/feature-importance")
async def feature_importance():
    return {"features": FEATURE_IMPORTANCE, "model_version": "1.0.0", "last_trained": "2024-12-01"}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "churn-prediction", "version": "1.0.0", "model_loaded": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
