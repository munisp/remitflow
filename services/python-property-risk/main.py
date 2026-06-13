from __future__ import annotations
import os
import json
"""
RemitFlow — Python ML Property Risk Scoring Service
====================================================

Provides ML-driven risk assessment for property escrow transactions:

  1. Builder Reliability Score
     - Historical project completion rate
     - Average delay (days) from milestone deadlines
     - Dispute resolution history
     - Financial health indicators
     - Years in operation vs. project complexity

  2. Project Completion Probability
     - Milestone progress vs. timeline
     - Builder's track record with similar property types
     - Market conditions (construction material price index)
     - Geographic risk factors (location-specific delays)

  3. Fraud Detection Signals
     - Builder registration age vs. project size anomaly
     - Multiple escrow plans with same builder in short window
     - Unusual milestone evidence patterns (recycled photos, GPS mismatch)
     - Price outlier detection (suspiciously low/high vs. comparable properties)

  4. Escrow Risk Classification
     - Overall risk score (0-100, lower = safer)
     - Risk category: "low", "medium", "high", "critical"
     - Recommended actions (additional inspection, hold release, flag for review)

Language: Python (scikit-learn for Gradient Boosted Trees, numpy for
  feature vectorization, FastAPI for async HTTP with Pydantic validation)

API:
  POST /score/builder         — Builder reliability score
  POST /score/project         — Project completion probability
  POST /score/fraud           — Fraud signal detection
  POST /score/escrow          — Overall escrow risk classification
  GET  /health                — Liveness probe
  GET  /model/info            — Model metadata
"""


import math
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sklearn.ensemble import GradientBoostingClassifier, RandomForestRegressor

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
                CREATE TABLE IF NOT EXISTS property_risk_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_property_risk_updated
                    ON property_risk_state(updated_at);
                CREATE TABLE IF NOT EXISTS property_risk_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_property_risk_events_type
                    ON property_risk_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO property_risk_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM property_risk_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM property_risk_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO property_risk_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


app = FastAPI(title="RemitFlow Property Risk Scoring", version="1.0.0")

# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-property-risk").info(f"Received signal {signum}, initiating graceful shutdown...")

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-property-risk").info("FastAPI shutdown event — cleaning up resources")


# ─── Pre-trained Model Surrogates ─────────────────────────────────────────────
# In production, these would be loaded from MLflow model registry.
# Here we use calibrated heuristic models trained on synthetic escrow data.

# Builder reliability model: predict P(on-time completion) from features
_builder_model = RandomForestRegressor(n_estimators=50, max_depth=6, random_state=42)
_fraud_model = GradientBoostingClassifier(n_estimators=80, max_depth=4, random_state=42)

# Train on synthetic calibration data at startup
def _train_models():
    rng = np.random.RandomState(42)
    n = 500

    # Builder reliability features: [years_in_op, projects_completed, avg_rating, financial_health, dispute_rate]
    X_builder = np.column_stack([
        rng.uniform(0, 30, n),      # years
        rng.uniform(0, 100, n),     # projects
        rng.uniform(1, 5, n),       # rating
        rng.uniform(20, 100, n),    # financial health
        rng.uniform(0, 0.5, n),     # dispute rate
    ])
    # Target: reliability score 0-100
    y_builder = (
        X_builder[:, 0] * 1.5 +    # years contribute
        X_builder[:, 1] * 0.5 +    # projects contribute
        X_builder[:, 2] * 10 +     # rating contributes most
        X_builder[:, 3] * 0.3 -    # financial health
        X_builder[:, 4] * 50 +     # disputes hurt
        rng.normal(0, 5, n)
    ).clip(0, 100)
    _builder_model.fit(X_builder, y_builder)

    # Fraud model features: [reg_age_days, project_size_usd, plans_last_30d, price_vs_comparable, evidence_diversity]
    X_fraud = np.column_stack([
        rng.uniform(1, 3650, n),       # registration age
        rng.uniform(10000, 5000000, n), # project size
        rng.uniform(0, 10, n),         # plans in last 30d
        rng.uniform(0.3, 3.0, n),      # price ratio vs comparable
        rng.uniform(0, 1, n),          # evidence diversity score
    ])
    # Labels: 0=legit, 1=fraud (10% fraud rate)
    y_fraud = ((X_fraud[:, 0] < 180) & (X_fraud[:, 1] > 500000) & (X_fraud[:, 2] > 3)).astype(int)
    y_fraud |= ((X_fraud[:, 3] < 0.5) | (X_fraud[:, 3] > 2.0)).astype(int) & (rng.random(n) > 0.7).astype(int)
    _fraud_model.fit(X_fraud, y_fraud)

_train_models()


# ─── Request / Response Models ────────────────────────────────────────────────

class BuilderScoreRequest(BaseModel):
    builder_id: int
    years_in_operation: int = 0
    projects_completed: int = 0
    projects_in_progress: int = 0
    average_rating: float = 0.0
    total_reviews: int = 0
    financial_health_score: float = 50.0
    dispute_count: int = 0
    total_escrow_plans: int = 1
    cac_verified: bool = False
    insurance_verified: bool = False

class ProjectScoreRequest(BaseModel):
    plan_id: str
    total_price_usd: float
    milestones_total: int = 5
    milestones_completed: int = 0
    milestones_overdue: int = 0
    days_since_start: int = 0
    expected_duration_days: int = 365
    builder_reliability_score: float = 50.0
    property_type: str = "apartment"
    city: str = "Lagos"

class FraudScoreRequest(BaseModel):
    builder_id: int
    registration_age_days: int = 365
    project_size_usd: float = 100000
    plans_last_30_days: int = 0
    price_vs_comparable_ratio: float = 1.0
    evidence_diversity_score: float = 0.5
    gps_mismatch: bool = False
    recycled_evidence_detected: bool = False

class EscrowRiskRequest(BaseModel):
    plan_id: str
    builder_score: Optional[float] = None
    project_score: Optional[float] = None
    fraud_score: Optional[float] = None
    total_price_usd: float = 100000
    deposit_paid: bool = False
    total_paid_pct: float = 0.0
    milestones_overdue: int = 0
    active_disputes: int = 0

class RiskResponse(BaseModel):
    score: float = Field(description="Risk score 0-100 (lower = safer)")
    category: str = Field(description="low / medium / high / critical")
    confidence: float = Field(description="Model confidence 0-1")
    factors: List[Dict[str, Any]] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    computed_at: str = ""


# ─── Scoring Endpoints ───────────────────────────────────────────────────────

@app.post("/score/builder", response_model=RiskResponse)
async def score_builder(req: BuilderScoreRequest) -> RiskResponse:
    dispute_rate = req.dispute_count / max(req.total_escrow_plans, 1)
    features = np.array([[
        req.years_in_operation,
        req.projects_completed,
        req.average_rating,
        req.financial_health_score,
        dispute_rate,
    ]])
    reliability = float(_builder_model.predict(features)[0])
    reliability = max(0, min(100, reliability))

    # Bonus for verified credentials
    if req.cac_verified:
        reliability = min(100, reliability + 5)
    if req.insurance_verified:
        reliability = min(100, reliability + 5)

    # Invert: high reliability = low risk
    risk_score = 100 - reliability

    factors = []
    if req.years_in_operation < 2:
        factors.append({"factor": "new_builder", "impact": "high", "detail": f"Only {req.years_in_operation} years in operation"})
    if req.average_rating < 3.0:
        factors.append({"factor": "low_rating", "impact": "high", "detail": f"Rating {req.average_rating}/5.0"})
    if dispute_rate > 0.2:
        factors.append({"factor": "high_dispute_rate", "impact": "high", "detail": f"{dispute_rate:.0%} dispute rate"})
    if not req.cac_verified:
        factors.append({"factor": "unverified_cac", "impact": "medium", "detail": "CAC registration not verified"})
    if req.projects_completed > 10 and req.average_rating >= 4.0:
        factors.append({"factor": "experienced_builder", "impact": "positive", "detail": f"{req.projects_completed} completed projects"})

    recs = []
    if risk_score > 70:
        recs.append("Request additional financial statements before proceeding")
        recs.append("Consider requiring performance bond from builder")
    elif risk_score > 40:
        recs.append("Standard verification sufficient — monitor milestone deadlines closely")
    else:
        recs.append("Low-risk builder — standard escrow terms recommended")

    return RiskResponse(
        score=round(risk_score, 1),
        category=_categorize(risk_score),
        confidence=0.85,
        factors=factors,
        recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


@app.post("/score/project", response_model=RiskResponse)
async def score_project(req: ProjectScoreRequest) -> RiskResponse:
    # Progress ratio: how far along vs. expected timeline
    progress_ratio = req.milestones_completed / max(req.milestones_total, 1)
    time_ratio = req.days_since_start / max(req.expected_duration_days, 1)

    # Schedule performance index (SPI): >1 = ahead, <1 = behind
    spi = progress_ratio / max(time_ratio, 0.01)

    # Base risk from schedule
    if spi >= 1.0:
        schedule_risk = max(0, 20 - (spi - 1) * 30)
    else:
        schedule_risk = min(100, 20 + (1 - spi) * 80)

    # Overdue penalty
    overdue_penalty = req.milestones_overdue * 15
    risk_score = min(100, schedule_risk + overdue_penalty)

    # Builder reliability adjustment
    builder_adj = (100 - req.builder_reliability_score) * 0.2
    risk_score = min(100, risk_score + builder_adj)

    # City risk factor
    city_risk = {"Lagos": 5, "Abuja": 3, "Port Harcourt": 8, "Ibadan": 6, "Accra": 4}.get(req.city, 5)
    risk_score = min(100, risk_score + city_risk)

    factors = []
    if spi < 0.8:
        factors.append({"factor": "behind_schedule", "impact": "high", "detail": f"SPI={spi:.2f} (behind by {(1-spi)*100:.0f}%)"})
    if req.milestones_overdue > 0:
        factors.append({"factor": "overdue_milestones", "impact": "high", "detail": f"{req.milestones_overdue} milestones overdue"})
    if progress_ratio > 0.8:
        factors.append({"factor": "near_completion", "impact": "positive", "detail": f"{progress_ratio*100:.0f}% milestones completed"})

    recs = []
    if risk_score > 60:
        recs.append("Schedule independent site inspection immediately")
        recs.append("Pause next milestone release until overdue items resolved")
    elif risk_score > 30:
        recs.append("Increase inspection frequency to bi-weekly")
    else:
        recs.append("Project on track — maintain standard inspection schedule")

    return RiskResponse(
        score=round(risk_score, 1),
        category=_categorize(risk_score),
        confidence=0.78,
        factors=factors,
        recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


@app.post("/score/fraud", response_model=RiskResponse)
async def score_fraud(req: FraudScoreRequest) -> RiskResponse:
    features = np.array([[
        req.registration_age_days,
        req.project_size_usd,
        req.plans_last_30_days,
        req.price_vs_comparable_ratio,
        req.evidence_diversity_score,
    ]])
    fraud_prob = float(_fraud_model.predict_proba(features)[0][1])
    risk_score = fraud_prob * 100

    # Hard signals override ML
    if req.gps_mismatch:
        risk_score = min(100, risk_score + 30)
    if req.recycled_evidence_detected:
        risk_score = min(100, risk_score + 40)

    factors = []
    if req.registration_age_days < 180:
        factors.append({"factor": "new_registration", "impact": "high", "detail": f"Builder registered {req.registration_age_days} days ago"})
    if req.plans_last_30_days > 3:
        factors.append({"factor": "high_plan_velocity", "impact": "high", "detail": f"{req.plans_last_30_days} plans in last 30 days"})
    if req.price_vs_comparable_ratio < 0.5:
        factors.append({"factor": "price_too_low", "impact": "critical", "detail": f"Price is {req.price_vs_comparable_ratio:.0%} of comparable properties"})
    if req.price_vs_comparable_ratio > 2.0:
        factors.append({"factor": "price_too_high", "impact": "high", "detail": f"Price is {req.price_vs_comparable_ratio:.0%} of comparable properties"})
    if req.gps_mismatch:
        factors.append({"factor": "gps_mismatch", "impact": "critical", "detail": "Evidence GPS coordinates don't match property location"})
    if req.recycled_evidence_detected:
        factors.append({"factor": "recycled_evidence", "impact": "critical", "detail": "Previously submitted evidence detected (possible re-use from another project)"})

    recs = []
    if risk_score > 70:
        recs.append("HOLD all milestone releases — manual investigation required")
        recs.append("Request in-person site verification by platform agent")
        recs.append("Cross-reference builder with CAC and EFCC databases")
    elif risk_score > 40:
        recs.append("Flag for enhanced due diligence")
        recs.append("Require video call site walkthrough before next release")
    else:
        recs.append("No significant fraud indicators — proceed normally")

    return RiskResponse(
        score=round(risk_score, 1),
        category=_categorize(risk_score),
        confidence=round(0.6 + 0.35 * (1 - abs(fraud_prob - 0.5) * 2), 2),
        factors=factors,
        recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


@app.post("/score/escrow", response_model=RiskResponse)
async def score_escrow(req: EscrowRiskRequest) -> RiskResponse:
    # Weighted composite of all sub-scores
    builder_risk = req.builder_score if req.builder_score is not None else 50
    project_risk = req.project_score if req.project_score is not None else 50
    fraud_risk = req.fraud_score if req.fraud_score is not None else 20

    # Weights: fraud signals matter most, then project schedule, then builder history
    composite = (fraud_risk * 0.40) + (project_risk * 0.35) + (builder_risk * 0.25)

    # Dispute amplifier
    if req.active_disputes > 0:
        composite = min(100, composite + req.active_disputes * 10)

    # Overdue amplifier
    if req.milestones_overdue > 1:
        composite = min(100, composite + (req.milestones_overdue - 1) * 8)

    # Payment progress stabilizer (more paid = more at stake, slightly increases urgency)
    if req.total_paid_pct > 50:
        composite = min(100, composite + 5)

    factors = [
        {"factor": "builder_risk", "weight": 0.25, "score": round(builder_risk, 1)},
        {"factor": "project_risk", "weight": 0.35, "score": round(project_risk, 1)},
        {"factor": "fraud_risk", "weight": 0.40, "score": round(fraud_risk, 1)},
    ]
    if req.active_disputes > 0:
        factors.append({"factor": "active_disputes", "impact": "high", "count": req.active_disputes})

    category = _categorize(composite)
    recs = []
    if category == "critical":
        recs.append("Freeze all escrow releases immediately")
        recs.append("Initiate buyer protection review")
        recs.append("Consider automatic refund procedure")
    elif category == "high":
        recs.append("Require additional milestone verification before release")
        recs.append("Assign dedicated case manager")
    elif category == "medium":
        recs.append("Monitor closely — increase inspection frequency")
    else:
        recs.append("Standard escrow terms — no additional action needed")

    return RiskResponse(
        score=round(composite, 1),
        category=category,
        confidence=0.82,
        factors=factors,
        recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


def _categorize(score: float) -> str:
    if score >= 75:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 25:
        return "medium"
    return "low"


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "python-property-risk",
        "version": "1.1.0",
        "models_loaded": _builder_model is not None and _fraud_model is not None,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@app.get("/readiness")
async def readiness():
    try:
        # Verify models can perform inference
        import numpy as np
        test_input = np.zeros((1, 5))
        _builder_model.predict(test_input)
        _fraud_model.predict(test_input)
        return {"status": "ready", "models": "operational"}
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "error": str(e)},
        )


@app.get("/model/info")
async def model_info():
    return {
        "builder_model": {
            "type": "RandomForestRegressor",
            "n_estimators": 50,
            "features": ["years_in_operation", "projects_completed", "average_rating", "financial_health_score", "dispute_rate"],
            "trained_on": "500 synthetic calibration samples",
        },
        "fraud_model": {
            "type": "GradientBoostingClassifier",
            "n_estimators": 80,
            "features": ["registration_age_days", "project_size_usd", "plans_last_30_days", "price_vs_comparable_ratio", "evidence_diversity_score"],
            "trained_on": "500 synthetic calibration samples",
        },
        "note": "Production models should be retrained on real escrow data via MLflow registry",
    }
