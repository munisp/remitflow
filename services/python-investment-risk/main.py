from __future__ import annotations
import os
import json
"""
RemitFlow — Python ML Investment & Credit Risk Service
=======================================================

ML-driven risk assessment for investment and credit features:

  1. Real Estate Investment Risk (developer default probability)
  2. BNPL Credit Scoring (borrower default risk)
  3. Bond Issuer Credit Risk (sovereign/corporate default)
  4. Mortgage Default Probability (borrower risk)
  5. Agent Fraud Detection (anomalous cash patterns)

Language: Python (scikit-learn + numpy for ML inference, FastAPI for async HTTP)
Port: 8099
"""


import time
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
                CREATE TABLE IF NOT EXISTS investment_risk_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_investment_risk_updated
                    ON investment_risk_state(updated_at);
                CREATE TABLE IF NOT EXISTS investment_risk_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_investment_risk_events_type
                    ON investment_risk_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO investment_risk_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM investment_risk_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM investment_risk_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO investment_risk_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


app = FastAPI(title="RemitFlow Investment & Credit Risk Service", version="1.0.0")

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-investment-risk"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-investment-risk"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-investment-risk").info(f"Received signal {signum}, initiating graceful shutdown...")
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
        "service": "python-investment-risk",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-investment-risk").info("FastAPI shutdown event — cleaning up resources")


# ─── Pre-trained Model Surrogates ─────────────────────────────────────────────

_bnpl_model = GradientBoostingClassifier(n_estimators=100, max_depth=5, random_state=42)
_mortgage_model = RandomForestRegressor(n_estimators=60, max_depth=6, random_state=42)
_agent_fraud_model = GradientBoostingClassifier(n_estimators=80, max_depth=4, random_state=42)


def _train_models():
    rng = np.random.RandomState(42)
    n = 600

    # BNPL default model: [monthly_income, debt_to_income, on_time_payments, account_age_months, amount_requested]
    X_bnpl = np.column_stack([
        rng.uniform(500, 20000, n),
        rng.uniform(0, 0.8, n),
        rng.uniform(0, 50, n),
        rng.uniform(1, 120, n),
        rng.uniform(50, 5000, n),
    ])
    y_bnpl = ((X_bnpl[:, 1] > 0.5) & (X_bnpl[:, 2] < 5) | (X_bnpl[:, 0] < 1000) & (X_bnpl[:, 4] > 2000)).astype(int)
    _bnpl_model.fit(X_bnpl, y_bnpl)

    # Mortgage default: [loan_to_value, employment_years, income_usd, credit_score, debt_ratio]
    X_mort = np.column_stack([
        rng.uniform(0.3, 1.2, n),
        rng.uniform(0, 30, n),
        rng.uniform(2000, 200000, n),
        rng.uniform(300, 850, n),
        rng.uniform(0, 0.8, n),
    ])
    y_mort = (100 - X_mort[:, 3] / 10 + X_mort[:, 0] * 30 - X_mort[:, 1] * 1.5 + X_mort[:, 4] * 40 + rng.normal(0, 5, n)).clip(0, 100)
    _mortgage_model.fit(X_mort, y_mort)

    # Agent fraud: [daily_volume_zscore, cash_out_ratio, weekend_ratio, tx_count_zscore, largest_tx_ratio]
    X_agent = np.column_stack([
        rng.uniform(-2, 5, n),
        rng.uniform(0, 1, n),
        rng.uniform(0, 3, n),
        rng.uniform(-2, 5, n),
        rng.uniform(1, 50, n),
    ])
    y_agent = ((X_agent[:, 0] > 3) & (X_agent[:, 1] > 0.8) | (X_agent[:, 4] > 20) & (X_agent[:, 2] > 2)).astype(int)
    _agent_fraud_model.fit(X_agent, y_agent)


_train_models()


# ─── Request/Response Models ─────────────────────────────────────────────────

class RiskResponse(BaseModel):
    score: float = Field(description="Risk score 0-100 (lower = safer)")
    category: str = Field(description="low / medium / high / critical")
    confidence: float = 0.85
    factors: List[Dict[str, Any]] = []
    recommendations: List[str] = []
    computed_at: str = ""


class BnplCreditRequest(BaseModel):
    user_id: int
    monthly_income_usd: float = 2000
    debt_to_income_ratio: float = 0.3
    on_time_payments: int = 10
    account_age_months: int = 12
    amount_requested_usd: float = 500
    existing_bnpl_plans: int = 0
    overdue_count: int = 0


class RealEstateRiskRequest(BaseModel):
    listing_id: int
    developer_years: int = 5
    developer_projects_completed: int = 10
    developer_rating: float = 4.0
    project_size_usd: float = 1000000
    sold_percentage: float = 50
    construction_progress_pct: float = 30
    city: str = "Lagos"
    property_type: str = "apartment"


class MortgageRiskRequest(BaseModel):
    user_id: int
    loan_amount_usd: float
    property_value_usd: float
    annual_income_usd: float = 50000
    employment_years: int = 5
    credit_score: int = 650
    existing_debt_ratio: float = 0.3
    dependents: int = 0


class BondIssuerRiskRequest(BaseModel):
    bond_id: int
    issuer_type: str = "sovereign"
    country_credit_rating: str = "BB"
    gdp_growth_pct: float = 2.5
    inflation_pct: float = 15
    debt_to_gdp_pct: float = 40
    fx_reserves_months: int = 6
    coupon_rate_pct: float = 10
    maturity_years: int = 5


class AgentFraudRequest(BaseModel):
    agent_id: int
    daily_volume_zscore: float = 0.0
    cash_out_ratio: float = 0.5
    weekend_volume_ratio: float = 0.8
    tx_count_zscore: float = 0.0
    largest_tx_ratio: float = 5.0
    account_age_days: int = 365
    previous_flags: int = 0


# ─── Scoring Endpoints ───────────────────────────────────────────────────────

@app.post("/score/bnpl-credit", response_model=RiskResponse)
async def score_bnpl_credit(req: BnplCreditRequest) -> RiskResponse:
    features = np.array([[
        req.monthly_income_usd,
        req.debt_to_income_ratio,
        req.on_time_payments,
        req.account_age_months,
        req.amount_requested_usd,
    ]])
    default_prob = float(_bnpl_model.predict_proba(features)[0][1])
    risk_score = default_prob * 100

    # Adjustments
    if req.overdue_count > 0:
        risk_score = min(100, risk_score + req.overdue_count * 15)
    if req.existing_bnpl_plans > 2:
        risk_score = min(100, risk_score + (req.existing_bnpl_plans - 2) * 10)

    factors = []
    if req.debt_to_income_ratio > 0.5:
        factors.append({"factor": "high_debt_ratio", "impact": "high", "detail": f"DTI ratio: {req.debt_to_income_ratio:.0%}"})
    if req.on_time_payments < 3:
        factors.append({"factor": "limited_history", "impact": "medium", "detail": f"Only {req.on_time_payments} on-time payments"})
    if req.overdue_count > 0:
        factors.append({"factor": "existing_overdue", "impact": "critical", "detail": f"{req.overdue_count} overdue installments"})

    max_amount = req.monthly_income_usd * 3 * (1 - req.debt_to_income_ratio) if risk_score < 50 else req.monthly_income_usd
    recs = []
    if risk_score > 60:
        recs.append(f"DENY — high default risk. Max recommended: ${max_amount:.0f}")
        recs.append("Require additional income verification")
    elif risk_score > 30:
        recs.append(f"APPROVE with caution — limit to ${max_amount:.0f}")
    else:
        recs.append(f"APPROVE — low risk. Max credit: ${max_amount:.0f}")

    return RiskResponse(
        score=round(risk_score, 1), category=_cat(risk_score), confidence=0.82,
        factors=factors, recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


@app.post("/score/real-estate-risk", response_model=RiskResponse)
async def score_real_estate(req: RealEstateRiskRequest) -> RiskResponse:
    risk_score = 30.0  # Base

    # Developer track record
    if req.developer_years < 3:
        risk_score += 20
    if req.developer_projects_completed < 5:
        risk_score += 15
    if req.developer_rating < 3.0:
        risk_score += 20
    elif req.developer_rating >= 4.5:
        risk_score -= 10

    # Project viability
    if req.sold_percentage < 30:
        risk_score += 15  # Low presales = higher risk
    if req.construction_progress_pct < 20 and req.project_size_usd > 2000000:
        risk_score += 10  # Early stage + large project

    # City risk
    city_risk = {"Lagos": 5, "Abuja": 3, "Port Harcourt": 10, "Ibadan": 8}.get(req.city, 7)
    risk_score += city_risk
    risk_score = max(0, min(100, risk_score))

    factors = []
    if req.developer_years < 3:
        factors.append({"factor": "new_developer", "impact": "high", "detail": f"Only {req.developer_years} years in operation"})
    if req.sold_percentage < 30:
        factors.append({"factor": "low_presales", "impact": "medium", "detail": f"Only {req.sold_percentage:.0f}% units sold"})

    recs = []
    if risk_score > 60:
        recs.append("HIGH RISK — recommend escrow with monthly milestone verification")
        recs.append("Require performance bond from developer")
    elif risk_score > 30:
        recs.append("Standard escrow terms — quarterly milestone checks")
    else:
        recs.append("Low risk — standard investment terms adequate")

    return RiskResponse(
        score=round(risk_score, 1), category=_cat(risk_score), confidence=0.78,
        factors=factors, recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


@app.post("/score/mortgage-risk", response_model=RiskResponse)
async def score_mortgage(req: MortgageRiskRequest) -> RiskResponse:
    ltv = req.loan_amount_usd / max(req.property_value_usd, 1)
    features = np.array([[
        ltv, req.employment_years, req.annual_income_usd,
        req.credit_score, req.existing_debt_ratio,
    ]])
    risk_score = float(_mortgage_model.predict(features)[0])
    risk_score = max(0, min(100, risk_score))

    if req.dependents > 3:
        risk_score = min(100, risk_score + 5)

    factors = []
    if ltv > 0.9:
        factors.append({"factor": "high_ltv", "impact": "critical", "detail": f"LTV ratio: {ltv:.0%} (>90%)"})
    if req.credit_score < 600:
        factors.append({"factor": "low_credit_score", "impact": "high", "detail": f"Credit score: {req.credit_score}"})
    if req.employment_years < 2:
        factors.append({"factor": "short_employment", "impact": "medium", "detail": f"Only {req.employment_years} years employed"})

    max_loan = req.annual_income_usd * 4 * (1 - req.existing_debt_ratio) if risk_score < 50 else req.annual_income_usd * 2
    recs = []
    if risk_score > 60:
        recs.append(f"DENY or require mortgage insurance. Max recommended: ${max_loan:.0f}")
    elif risk_score > 30:
        recs.append(f"APPROVE with conditions — require insurance if LTV > 80%. Max: ${max_loan:.0f}")
    else:
        recs.append(f"APPROVE — strong application. Max: ${max_loan:.0f}")

    return RiskResponse(
        score=round(risk_score, 1), category=_cat(risk_score), confidence=0.80,
        factors=factors, recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


@app.post("/score/bond-issuer", response_model=RiskResponse)
async def score_bond_issuer(req: BondIssuerRiskRequest) -> RiskResponse:
    # Country credit rating mapping
    rating_scores = {
        "AAA": 5, "AA+": 10, "AA": 12, "AA-": 15, "A+": 18, "A": 20, "A-": 25,
        "BBB+": 30, "BBB": 35, "BBB-": 40, "BB+": 45, "BB": 50, "BB-": 55,
        "B+": 60, "B": 65, "B-": 70, "CCC": 80, "CC": 90, "C": 95, "D": 100,
    }
    base = rating_scores.get(req.country_credit_rating, 50)

    # Macro adjustments
    risk_score = float(base)
    if req.inflation_pct > 20:
        risk_score = min(100, risk_score + 10)
    if req.debt_to_gdp_pct > 60:
        risk_score = min(100, risk_score + 10)
    if req.fx_reserves_months < 3:
        risk_score = min(100, risk_score + 15)
    if req.gdp_growth_pct < 0:
        risk_score = min(100, risk_score + 10)
    if req.coupon_rate_pct > 15:
        risk_score = min(100, risk_score + 5)  # Very high coupon = desperation

    factors = []
    if req.inflation_pct > 20:
        factors.append({"factor": "high_inflation", "impact": "high", "detail": f"Inflation at {req.inflation_pct}%"})
    if req.fx_reserves_months < 3:
        factors.append({"factor": "low_reserves", "impact": "critical", "detail": f"Only {req.fx_reserves_months} months FX reserves"})

    recs = []
    if risk_score > 60:
        recs.append("HIGH RISK — limit exposure, diversify across issuers")
        recs.append("Consider credit default swap hedging")
    elif risk_score > 30:
        recs.append("Moderate risk — standard diversification recommended")
    else:
        recs.append("Investment grade — standard allocation appropriate")

    return RiskResponse(
        score=round(risk_score, 1), category=_cat(risk_score), confidence=0.75,
        factors=factors, recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


@app.post("/score/agent-fraud", response_model=RiskResponse)
async def score_agent_fraud(req: AgentFraudRequest) -> RiskResponse:
    features = np.array([[
        req.daily_volume_zscore, req.cash_out_ratio,
        req.weekend_volume_ratio, req.tx_count_zscore,
        req.largest_tx_ratio,
    ]])
    fraud_prob = float(_agent_fraud_model.predict_proba(features)[0][1])
    risk_score = fraud_prob * 100

    if req.previous_flags > 0:
        risk_score = min(100, risk_score + req.previous_flags * 10)
    if req.account_age_days < 90:
        risk_score = min(100, risk_score + 15)

    factors = []
    if req.daily_volume_zscore > 3:
        factors.append({"factor": "volume_anomaly", "impact": "critical", "detail": f"Volume {req.daily_volume_zscore:.1f} std devs above mean"})
    if req.cash_out_ratio > 0.8:
        factors.append({"factor": "high_cash_out", "impact": "high", "detail": f"Cash-out ratio: {req.cash_out_ratio:.0%}"})
    if req.previous_flags > 0:
        factors.append({"factor": "prior_flags", "impact": "high", "detail": f"{req.previous_flags} previous flags"})

    recs = []
    if risk_score > 70:
        recs.append("FREEZE agent immediately — conduct on-site audit")
    elif risk_score > 40:
        recs.append("Schedule audit within 48 hours")
    else:
        recs.append("Normal activity — include in regular audit cycle")

    return RiskResponse(
        score=round(risk_score, 1), category=_cat(risk_score),
        confidence=round(0.6 + 0.35 * (1 - abs(fraud_prob - 0.5) * 2), 2),
        factors=factors, recommendations=recs,
        computed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


def _cat(score: float) -> str:
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
        "service": "python-investment-risk",
        "version": "1.1.0",
        "models_loaded": _bnpl_model is not None and _mortgage_model is not None and _agent_fraud_model is not None,
    }


@app.get("/readiness")
async def readiness():
    try:
        import numpy as np
        test_input = np.zeros((1, 5))
        _bnpl_model.predict(test_input)
        _mortgage_model.predict(test_input)
        _agent_fraud_model.predict(test_input)
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
        "models": [
            {"name": "bnpl_credit", "type": "GradientBoostingClassifier", "features": 5},
            {"name": "mortgage_default", "type": "RandomForestRegressor", "features": 5},
            {"name": "agent_fraud", "type": "GradientBoostingClassifier", "features": 5},
        ],
        "note": "Production models should be retrained on real data via MLflow",
    }
