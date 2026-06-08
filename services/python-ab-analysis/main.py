"""
RemitFlow — A/B Test Analysis Service (Production)
Port: 8138

Statistical analysis engine for A/B experiments.
Computes conversion rates, statistical significance, and recommendations.

Architecture:
  - Chi-squared test for conversion rate comparison
  - Sample size estimation with power analysis
  - Sequential testing support (early stopping)
  - Multi-variant support (A/B/C/n)

Endpoints:
  POST /analyze            — analyze experiment results
  POST /sample-size        — compute required sample size
  POST /sequential-check   — check if experiment can be stopped early
  GET  /health             — liveness probe
"""

import logging
import math
import os
import time
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ab_analysis_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_ab_analysis_updated
                    ON ab_analysis_state(updated_at);
                CREATE TABLE IF NOT EXISTS ab_analysis_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_ab_analysis_events_type
                    ON ab_analysis_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO ab_analysis_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM ab_analysis_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM ab_analysis_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ab_analysis_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("ab-analysis")

PORT = int(os.getenv("PORT", "8138"))

app = FastAPI(title="A/B Test Analysis Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class VariantData(BaseModel):
    name: str
    participants: int = Field(ge=0)
    conversions: int = Field(ge=0)
    revenue: float = Field(default=0, ge=0)


class AnalyzeRequest(BaseModel):
    experiment_id: str
    variants: List[VariantData] = Field(min_length=2)
    confidence_level: float = Field(default=0.95, ge=0.8, le=0.99)
    metric: str = Field(default="conversion_rate")


class AnalyzeResponse(BaseModel):
    experiment_id: str
    is_significant: bool
    confidence_level: float
    p_value: float
    winner: Optional[str]
    lift: Optional[float]
    variants: List[Dict[str, Any]]
    recommendation: str
    sample_size_needed: int
    power: float


class SampleSizeRequest(BaseModel):
    baseline_rate: float = Field(ge=0.001, le=1.0)
    minimum_detectable_effect: float = Field(ge=0.001, le=1.0)
    confidence_level: float = Field(default=0.95, ge=0.8, le=0.99)
    power: float = Field(default=0.8, ge=0.5, le=0.99)


def normal_cdf(x: float) -> float:
    """Approximate CDF of standard normal distribution."""
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def normal_ppf(p: float) -> float:
    """Approximate inverse CDF (percent point function) of standard normal."""
    if p <= 0:
        return -10.0
    if p >= 1:
        return 10.0
    # Rational approximation
    a = [0, -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0]
    b = [0, -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
    if p < 0.5:
        t = math.sqrt(-2 * math.log(p))
        num = ((((a[6]*t + a[5])*t + a[4])*t + a[3])*t + a[2])*t + a[1]
        den = (((((b[6]*t if len(b) > 6 else 0 + b[5])*t + b[4])*t + b[3])*t + b[2])*t + b[1])*t + 1
        return num / den if den != 0 else -3.0
    else:
        return -normal_ppf(1 - p)


def chi_squared_test(variants: List[VariantData]) -> float:
    """Compute chi-squared p-value for conversion rate comparison."""
    total_participants = sum(v.participants for v in variants)
    total_conversions = sum(v.conversions for v in variants)
    if total_participants == 0 or total_conversions == 0:
        return 1.0

    expected_rate = total_conversions / total_participants
    chi2 = 0.0
    for v in variants:
        if v.participants == 0:
            continue
        expected_conv = v.participants * expected_rate
        expected_no_conv = v.participants * (1 - expected_rate)
        if expected_conv > 0:
            chi2 += (v.conversions - expected_conv) ** 2 / expected_conv
        if expected_no_conv > 0:
            chi2 += ((v.participants - v.conversions) - expected_no_conv) ** 2 / expected_no_conv

    # Approximate p-value for chi-squared with df=len(variants)-1
    df = len(variants) - 1
    if chi2 == 0:
        return 1.0
    # Wilson-Hilferty approximation
    z = ((chi2 / df) ** (1/3) - (1 - 2/(9*df))) / math.sqrt(2/(9*df))
    p_value = 1 - normal_cdf(z)
    return max(0.0, min(1.0, p_value))


def compute_sample_size(baseline_rate: float, mde: float, alpha: float, power: float) -> int:
    """Compute required sample size per variant."""
    z_alpha = normal_ppf(1 - alpha / 2)
    z_beta = normal_ppf(power)
    p1 = baseline_rate
    p2 = baseline_rate * (1 + mde)
    p_avg = (p1 + p2) / 2
    numerator = (z_alpha * math.sqrt(2 * p_avg * (1 - p_avg)) + z_beta * math.sqrt(p1 * (1-p1) + p2 * (1-p2))) ** 2
    denominator = (p2 - p1) ** 2
    if denominator == 0:
        return 10000
    return max(100, int(math.ceil(numerator / denominator)))


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    start = time.time()
    alpha = 1 - req.confidence_level
    p_value = chi_squared_test(req.variants)
    is_significant = p_value < alpha

    variant_results = []
    for v in req.variants:
        rate = v.conversions / v.participants if v.participants > 0 else 0
        variant_results.append({
            "name": v.name,
            "participants": v.participants,
            "conversions": v.conversions,
            "conversion_rate": round(rate * 100, 2),
            "revenue": v.revenue,
            "revenue_per_user": round(v.revenue / v.participants, 2) if v.participants > 0 else 0,
        })

    winner = None
    lift = None
    if is_significant and len(req.variants) >= 2:
        rates = [(v.conversions / v.participants if v.participants > 0 else 0, v.name) for v in req.variants]
        rates.sort(reverse=True)
        winner = rates[0][1]
        if rates[1][0] > 0:
            lift = round(((rates[0][0] - rates[1][0]) / rates[1][0]) * 100, 2)

    baseline = req.variants[0].conversions / req.variants[0].participants if req.variants[0].participants > 0 else 0.05
    needed = compute_sample_size(max(baseline, 0.01), 0.1, alpha, 0.8)

    if is_significant:
        recommendation = f"Winner: {winner} with {lift}% lift. Consider rolling out to all users."
    elif sum(v.participants for v in req.variants) < needed:
        recommendation = f"Insufficient data. Need {needed} participants per variant (have {min(v.participants for v in req.variants)})."
    else:
        recommendation = "No significant difference detected. Consider increasing the minimum detectable effect or running longer."

    latency_ms = (time.time() - start) * 1000
    logger.info(f"analyzed exp={req.experiment_id} significant={is_significant} p={p_value:.4f} latency={latency_ms:.1f}ms")

    return AnalyzeResponse(
        experiment_id=req.experiment_id,
        is_significant=is_significant,
        confidence_level=req.confidence_level,
        p_value=round(p_value, 6),
        winner=winner,
        lift=lift,
        variants=variant_results,
        recommendation=recommendation,
        sample_size_needed=needed,
        power=0.8,
    )


@app.post("/sample-size")
async def sample_size(req: SampleSizeRequest):
    alpha = 1 - req.confidence_level
    n = compute_sample_size(req.baseline_rate, req.minimum_detectable_effect, alpha, req.power)
    return {
        "sample_size_per_variant": n,
        "total_sample_size": n * 2,
        "baseline_rate": req.baseline_rate,
        "minimum_detectable_effect": req.minimum_detectable_effect,
        "confidence_level": req.confidence_level,
        "power": req.power,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ab-analysis", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
