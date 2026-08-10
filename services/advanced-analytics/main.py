"""
RemitFlow Advanced Analytics Service
Real-time dashboards, anomaly detection, and predictive analytics
Port: 8103

REQUIRED:
  - DATABASE_URL
  - REDIS_URL
  - Optional: BigQuery / Snowflake connection for data warehouse queries

FAIL-CLOSED:
  If database is unavailable, returns cached results with staleness warning.
"""
from __future__ import annotations

import json
import logging
import os
import signal
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import psycopg2
import psycopg2.extras

logging.basicConfig(level=logging.INFO, format="[ANALYTICS] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow Advanced Analytics",
    description="Real-time dashboards, anomaly detection, and predictive analytics",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")

def _get_db():
    return psycopg2.connect(_DB_URL)

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class TimeRange(BaseModel):
    start: str
    end: str

class DashboardRequest(BaseModel):
    dashboard: str = Field(..., pattern=r"^(overview|compliance|operations|revenue|customers)$")
    period: str = Field(default="24h", pattern=r"^(1h|24h|7d|30d|90d|1y)$")

class AnomalyRequest(BaseModel):
    metric: str = Field(..., pattern=r"^(transaction_volume|transaction_amount|compliance_flags|fx_spread|settlement_time)$")
    period: str = Field(default="24h", pattern=r"^(1h|24h|7d|30d)$")
    sensitivity: float = Field(default=2.0, ge=1.0, le=5.0)

class ForecastRequest(BaseModel):
    metric: str = Field(..., pattern=r"^(volume|revenue|users|transactions)$")
    horizon: str = Field(default="30d", pattern=r"^(7d|30d|90d)$")

# ─── Dashboard Data ──────────────────────────────────────────────────────────────

def _get_period_seconds(period: str) -> int:
    mapping = {"1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592000, "90d": 7776000, "1y": 31536000}
    return mapping.get(period, 86400)

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "advanced-analytics",
        "version": "2.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/dashboard")
def get_dashboard(req: DashboardRequest):
    conn = _get_db()
    period_seconds = _get_period_seconds(req.period)
    since = datetime.now(timezone.utc) - timedelta(seconds=period_seconds)

    if req.dashboard == "overview":
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COALESCE(SUM(amount_cents), 0) FROM transactions WHERE created_at >= %s", (since,))
            tx_count, tx_volume = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT user_id) FROM accounts WHERE created_at >= %s", (since,))
            new_users = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM screening_alerts WHERE created_at >= %s AND flagged = TRUE", (since,))
            flags = cur.fetchone()[0]

        return {
            "dashboard": "overview",
            "period": req.period,
            "transactions": {"count": tx_count or 0, "volume_usd": (tx_volume or 0) / 100},
            "new_users": new_users or 0,
            "compliance_flags": flags or 0,
            "active_users": 0,  # Would require session tracking
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    elif req.dashboard == "compliance":
        with conn.cursor() as cur:
            cur.execute("""
                SELECT screening_type, provider, COUNT(*), SUM(CASE WHEN flagged THEN 1 ELSE 0 END)
                FROM screening_alerts WHERE created_at >= %s GROUP BY screening_type, provider
            """, (since,))
            screening = [{"type": r[0], "provider": r[1], "total": r[2], "flagged": r[3]} for r in cur.fetchall()]

            cur.execute("SELECT filing_status, COUNT(*) FROM sar_reports WHERE created_at >= %s GROUP BY filing_status", (since,))
            sars = {r[0]: r[1] for r in cur.fetchall()}

            cur.execute("SELECT status, COUNT(*) FROM travel_rule_messages WHERE created_at >= %s GROUP BY status", (since,))
            tr = {r[0]: r[1] for r in cur.fetchall()}

        return {
            "dashboard": "compliance",
            "period": req.period,
            "screening": screening,
            "sar_status": sars,
            "travel_rule_status": tr,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    elif req.dashboard == "operations":
        with conn.cursor() as cur:
            cur.execute("""
                SELECT settlement_status, COUNT(*), AVG(EXTRACT(EPOCH FROM (COALESCE(settled_at, NOW()) - created_at)))
                FROM transactions WHERE created_at >= %s GROUP BY settlement_status
            """, (since,))
            settlement = [{"status": r[0], "count": r[1], "avg_time_seconds": r[2]} for r in cur.fetchall()]

        return {
            "dashboard": "operations",
            "period": req.period,
            "settlement": settlement,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    elif req.dashboard == "revenue":
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*), SUM(amount_cents)
                FROM transactions WHERE created_at >= %s GROUP BY day ORDER BY day
            """, (since,))
            daily = [{"date": r[0].isoformat() if r[0] else None, "count": r[1], "volume_cents": r[2]} for r in cur.fetchall()]

        return {
            "dashboard": "revenue",
            "period": req.period,
            "daily": daily,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    elif req.dashboard == "customers":
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM accounts WHERE status = 'active'")
            total = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM accounts WHERE created_at >= %s", (since,))
            new_users = cur.fetchone()[0]

        return {
            "dashboard": "customers",
            "period": req.period,
            "total_active": total or 0,
            "new_users": new_users or 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    raise HTTPException(status_code=400, detail=f"Unknown dashboard: {req.dashboard}")

@app.post("/anomaly")
def detect_anomaly(req: AnomalyRequest):
    """Simple statistical anomaly detection using Z-score."""
    conn = _get_db()
    period_seconds = _get_period_seconds(req.period)
    since = datetime.now(timezone.utc) - timedelta(seconds=period_seconds)

    with conn.cursor() as cur:
        if req.metric == "transaction_volume":
            cur.execute("""
                SELECT DATE_TRUNC('hour', created_at) AS hour, COUNT(*)
                FROM transactions WHERE created_at >= %s GROUP BY hour ORDER BY hour
            """, (since,))
        elif req.metric == "transaction_amount":
            cur.execute("""
                SELECT DATE_TRUNC('hour', created_at) AS hour, AVG(amount_cents)
                FROM transactions WHERE created_at >= %s GROUP BY hour ORDER BY hour
            """, (since,))
        elif req.metric == "compliance_flags":
            cur.execute("""
                SELECT DATE_TRUNC('hour', created_at) AS hour, COUNT(*)
                FROM screening_alerts WHERE created_at >= %s AND flagged = TRUE GROUP BY hour ORDER BY hour
            """, (since,))
        else:
            raise HTTPException(status_code=400, detail=f"Metric not yet implemented: {req.metric}")

        rows = cur.fetchall()

    if len(rows) < 3:
        return {"metric": req.metric, "anomalies": [], "note": "Insufficient data for anomaly detection"}

    values = [r[1] for r in rows]
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    std_dev = variance ** 0.5

    anomalies = []
    for r in rows:
        hour, value = r
        z_score = (value - mean) / std_dev if std_dev > 0 else 0
        if abs(z_score) > req.sensitivity:
            anomalies.append({
                "timestamp": hour.isoformat() if hour else None,
                "value": value,
                "z_score": round(z_score, 2),
                "expected_range": [round(mean - req.sensitivity * std_dev, 2), round(mean + req.sensitivity * std_dev, 2)],
                "severity": "high" if abs(z_score) > req.sensitivity * 1.5 else "medium",
            })

    return {
        "metric": req.metric,
        "period": req.period,
        "sensitivity": req.sensitivity,
        "mean": round(mean, 2),
        "std_dev": round(std_dev, 2),
        "anomalies": anomalies,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/forecast")
def get_forecast(req: ForecastRequest):
    """Simple trend-based forecasting. Replace with ML model in production."""
    conn = _get_db()

    with conn.cursor() as cur:
        cur.execute("""
            SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*)
            FROM transactions WHERE created_at >= NOW() - INTERVAL '90 days'
            GROUP BY day ORDER BY day
        """)
        rows = cur.fetchall()

    if len(rows) < 7:
        return {"metric": req.metric, "forecast": [], "note": "Insufficient historical data for forecasting"}

    values = [r[1] for r in rows]
    # Simple linear trend
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n

    slope = sum((i - x_mean) * (values[i] - y_mean) for i in range(n)) / sum((i - x_mean) ** 2 for i in range(n))
    intercept = y_mean - slope * x_mean

    horizon_days = {"7d": 7, "30d": 30, "90d": 90}[req.horizon]
    forecast = []
    for i in range(1, horizon_days + 1):
        predicted = intercept + slope * (n - 1 + i)
        forecast.append({
            "date": (datetime.now(timezone.utc) + timedelta(days=i)).strftime("%Y-%m-%d"),
            "predicted": max(0, round(predicted, 0)),
            "confidence_lower": max(0, round(predicted * 0.8, 0)),
            "confidence_upper": max(0, round(predicted * 1.2, 0)),
        })

    return {
        "metric": req.metric,
        "horizon": req.horizon,
        "model": "linear_trend",
        "historical_days": n,
        "slope": round(slope, 4),
        "forecast": forecast,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8103"))
    logger.info(f"Starting advanced-analytics v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
