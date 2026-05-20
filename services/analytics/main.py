"""
RemitFlow Analytics Pipeline Service
FastAPI + pandas + SQLAlchemy
Port: 8085

Endpoints:
  GET  /health
  GET  /metrics/overview          — KPIs: total volume, users, revenue
  GET  /metrics/transactions      — Daily/weekly/monthly transaction volumes
  GET  /metrics/corridors         — Corridor performance breakdown
  GET  /metrics/users             — User growth, retention, churn
  GET  /metrics/revenue           — Fee revenue by corridor and currency
  GET  /metrics/kyc-funnel        — KYC tier conversion rates
  GET  /metrics/fraud             — Fraud/AML metrics
  GET  /metrics/system            — System health metrics
  POST /reports/generate          — Generate CSV/PDF report
"""
from __future__ import annotations

import os
import io
import csv
import json
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("analytics")

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RemitFlow Analytics Pipeline",
    description="Business intelligence and reporting service for RemitFlow",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Simulated Data Generation ────────────────────────────────────────────────
# In production this would query the MySQL database directly via SQLAlchemy.
# For the sandbox environment we generate realistic synthetic data.

CORRIDORS = [
    {"from": "GB", "to": "NG", "name": "UK → Nigeria", "currency": "NGN"},
    {"from": "US", "to": "NG", "name": "US → Nigeria", "currency": "NGN"},
    {"from": "CA", "to": "GH", "name": "Canada → Ghana", "currency": "GHS"},
    {"from": "DE", "to": "SN", "name": "Germany → Senegal", "currency": "XOF"},
    {"from": "FR", "to": "CM", "name": "France → Cameroon", "currency": "XAF"},
    {"from": "GB", "to": "KE", "name": "UK → Kenya", "currency": "KES"},
    {"from": "US", "to": "ZA", "name": "US → South Africa", "currency": "ZAR"},
    {"from": "IT", "to": "UG", "name": "Italy → Uganda", "currency": "UGX"},
]

def _seed_random(day_offset: int = 0) -> random.Random:
    """Deterministic random for consistent demo data."""
    return random.Random(42 + day_offset)

def _generate_daily_stats(days: int = 90) -> List[Dict]:
    """Generate daily transaction statistics for the past N days."""
    stats = []
    base_volume = 45_000  # USD
    base_count = 120
    base_users = 8
    for i in range(days, 0, -1):
        rng = _seed_random(i)
        date = (datetime.now(timezone.utc) - timedelta(days=i)).date()
        # Add growth trend + weekend dip
        growth = 1 + (days - i) * 0.003
        weekday_factor = 0.7 if date.weekday() >= 5 else 1.0
        noise = rng.uniform(0.85, 1.15)
        volume = base_volume * growth * weekday_factor * noise
        count = int(base_count * growth * weekday_factor * noise)
        new_users = int(base_users * growth * noise * rng.uniform(0.8, 1.2))
        fee_revenue = volume * 0.018  # 1.8% average fee
        stats.append({
            "date": str(date),
            "volume_usd": round(volume, 2),
            "transaction_count": count,
            "new_users": new_users,
            "fee_revenue_usd": round(fee_revenue, 2),
            "avg_transaction_usd": round(volume / max(count, 1), 2),
            "success_rate": round(rng.uniform(0.96, 0.999), 4),
        })
    return stats

def _generate_corridor_stats() -> List[Dict]:
    """Generate corridor performance statistics."""
    result = []
    rng = _seed_random(0)
    weights = [0.35, 0.25, 0.12, 0.08, 0.07, 0.06, 0.04, 0.03]
    total_volume = 4_200_000  # USD last 30 days
    for corridor, weight in zip(CORRIDORS, weights):
        vol = total_volume * weight * rng.uniform(0.9, 1.1)
        count = int(vol / rng.uniform(280, 520))
        result.append({
            "corridor": corridor["name"],
            "from_country": corridor["from"],
            "to_country": corridor["to"],
            "to_currency": corridor["currency"],
            "volume_usd_30d": round(vol, 2),
            "transaction_count_30d": count,
            "avg_amount_usd": round(vol / max(count, 1), 2),
            "avg_fee_pct": round(rng.uniform(0.014, 0.022), 4),
            "success_rate": round(rng.uniform(0.965, 0.998), 4),
            "avg_delivery_minutes": round(rng.uniform(2.5, 18.0), 1),
        })
    return sorted(result, key=lambda x: x["volume_usd_30d"], reverse=True)

def _generate_user_growth(days: int = 90) -> List[Dict]:
    """Generate user growth metrics."""
    stats = []
    cumulative = 12_400
    for i in range(days, 0, -1):
        rng = _seed_random(i + 1000)
        date = (datetime.now(timezone.utc) - timedelta(days=i)).date()
        new_users = int(rng.uniform(6, 22))
        churned = int(rng.uniform(0, 3))
        cumulative += new_users - churned
        stats.append({
            "date": str(date),
            "new_users": new_users,
            "churned_users": churned,
            "active_users": int(cumulative * rng.uniform(0.18, 0.26)),
            "total_users": cumulative,
            "kyc_tier0": int(cumulative * 0.12),
            "kyc_tier1": int(cumulative * 0.48),
            "kyc_tier2": int(cumulative * 0.32),
            "kyc_tier3": int(cumulative * 0.08),
        })
    return stats

def _generate_kyc_funnel() -> Dict:
    """Generate KYC funnel conversion rates."""
    total = 15_847
    return {
        "total_registered": total,
        "tier0_count": int(total * 0.12),
        "tier1_count": int(total * 0.48),
        "tier2_count": int(total * 0.32),
        "tier3_count": int(total * 0.08),
        "tier0_to_tier1_rate": 0.80,
        "tier1_to_tier2_rate": 0.40,
        "tier2_to_tier3_rate": 0.20,
        "avg_days_to_tier1": 1.2,
        "avg_days_to_tier2": 3.8,
        "avg_days_to_tier3": 12.5,
        "pending_reviews": 47,
        "rejected_30d": 23,
        "rejection_rate_30d": 0.031,
    }

def _generate_fraud_metrics() -> Dict:
    """Generate fraud and AML metrics."""
    rng = _seed_random(999)
    return {
        "total_screened_30d": 14_230,
        "passed_30d": 13_891,
        "review_30d": 298,
        "blocked_30d": 41,
        "block_rate": 0.0029,
        "review_rate": 0.0209,
        "false_positive_rate": 0.0015,
        "aml_hits_30d": 12,
        "sanctions_hits_30d": 3,
        "pep_hits_30d": 7,
        "velocity_blocks_30d": 19,
        "avg_risk_score": 0.087,
        "high_risk_corridors": ["US → Nigeria", "UK → Nigeria"],
        "fraud_loss_prevented_usd": round(rng.uniform(45_000, 120_000), 2),
    }

def _generate_system_health() -> Dict:
    """Generate system health metrics."""
    return {
        "api_uptime_pct": 99.97,
        "avg_response_ms": 142,
        "p95_response_ms": 380,
        "p99_response_ms": 820,
        "error_rate_pct": 0.03,
        "db_latency_ms": 8,
        "fx_api_latency_ms": 45,
        "aml_engine_latency_ms": 12,
        "fraud_ml_latency_ms": 28,
        "transfer_engine_latency_ms": 35,
        "active_sse_connections": 234,
        "queue_depth": 0,
        "last_fx_update": (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat(),
        "services": {
            "api": "healthy",
            "database": "healthy",
            "fx_engine": "healthy",
            "aml_engine": "healthy",
            "fraud_ml": "healthy",
            "transfer_engine": "healthy",
        }
    }

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "analytics-pipeline",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/metrics/overview")
async def metrics_overview():
    daily = _generate_daily_stats(30)
    df = pd.DataFrame(daily)
    return {
        "period": "last_30_days",
        "total_volume_usd": round(df["volume_usd"].sum(), 2),
        "total_transactions": int(df["transaction_count"].sum()),
        "total_new_users": int(df["new_users"].sum()),
        "total_fee_revenue_usd": round(df["fee_revenue_usd"].sum(), 2),
        "avg_daily_volume_usd": round(df["volume_usd"].mean(), 2),
        "avg_success_rate": round(df["success_rate"].mean(), 4),
        "total_users": 15_847,
        "active_users_30d": 4_230,
        "corridors_active": len(CORRIDORS),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/metrics/transactions")
async def metrics_transactions(
    days: int = Query(default=30, ge=1, le=365),
    granularity: str = Query(default="daily", regex="^(daily|weekly|monthly)$"),
):
    daily = _generate_daily_stats(days)
    df = pd.DataFrame(daily)
    df["date"] = pd.to_datetime(df["date"])

    if granularity == "weekly":
        df = df.resample("W", on="date").agg({
            "volume_usd": "sum",
            "transaction_count": "sum",
            "new_users": "sum",
            "fee_revenue_usd": "sum",
            "success_rate": "mean",
        }).reset_index()
        df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    elif granularity == "monthly":
        df = df.resample("ME", on="date").agg({
            "volume_usd": "sum",
            "transaction_count": "sum",
            "new_users": "sum",
            "fee_revenue_usd": "sum",
            "success_rate": "mean",
        }).reset_index()
        df["date"] = df["date"].dt.strftime("%Y-%m")
    else:
        df["date"] = df["date"].dt.strftime("%Y-%m-%d")

    return {
        "granularity": granularity,
        "days": days,
        "data": df.round(2).to_dict(orient="records"),
    }

@app.get("/metrics/corridors")
async def metrics_corridors():
    return {
        "period": "last_30_days",
        "corridors": _generate_corridor_stats(),
    }

@app.get("/metrics/users")
async def metrics_users(days: int = Query(default=30, ge=1, le=365)):
    growth = _generate_user_growth(days)
    df = pd.DataFrame(growth)
    return {
        "days": days,
        "total_users": 15_847,
        "active_users_30d": 4_230,
        "retention_rate_30d": 0.73,
        "churn_rate_30d": 0.027,
        "data": growth,
        "kyc_distribution": {
            "tier0": 1_902,
            "tier1": 7_607,
            "tier2": 5_071,
            "tier3": 1_267,
        },
    }

@app.get("/metrics/revenue")
async def metrics_revenue(days: int = Query(default=30, ge=1, le=365)):
    daily = _generate_daily_stats(days)
    df = pd.DataFrame(daily)
    corridors = _generate_corridor_stats()
    return {
        "period_days": days,
        "total_fee_revenue_usd": round(df["fee_revenue_usd"].sum(), 2),
        "avg_fee_rate": 0.018,
        "revenue_by_corridor": [
            {
                "corridor": c["corridor"],
                "revenue_usd": round(c["volume_usd_30d"] * c["avg_fee_pct"], 2),
                "volume_usd": c["volume_usd_30d"],
                "fee_rate": c["avg_fee_pct"],
            }
            for c in corridors
        ],
        "revenue_by_currency": {
            "USD": round(df["fee_revenue_usd"].sum() * 0.42, 2),
            "GBP": round(df["fee_revenue_usd"].sum() * 0.31, 2),
            "EUR": round(df["fee_revenue_usd"].sum() * 0.18, 2),
            "CAD": round(df["fee_revenue_usd"].sum() * 0.09, 2),
        },
    }

@app.get("/metrics/kyc-funnel")
async def metrics_kyc_funnel():
    return _generate_kyc_funnel()

@app.get("/metrics/fraud")
async def metrics_fraud():
    return _generate_fraud_metrics()

@app.get("/metrics/system")
async def metrics_system():
    return _generate_system_health()

@app.post("/reports/generate")
async def generate_report(
    report_type: str = Query(default="transactions", regex="^(transactions|corridors|users|revenue|fraud)$"),
    format: str = Query(default="csv", regex="^(csv|json)$"),
    days: int = Query(default=30, ge=1, le=365),
):
    """Generate a downloadable CSV or JSON report."""
    if report_type == "transactions":
        data = _generate_daily_stats(days)
    elif report_type == "corridors":
        data = _generate_corridor_stats()
    elif report_type == "users":
        data = _generate_user_growth(days)
    elif report_type == "revenue":
        daily = _generate_daily_stats(days)
        data = [{"date": d["date"], "fee_revenue_usd": d["fee_revenue_usd"], "volume_usd": d["volume_usd"]} for d in daily]
    elif report_type == "fraud":
        data = [_generate_fraud_metrics()]
    else:
        raise HTTPException(status_code=400, detail="Unknown report type")

    if format == "json":
        content = json.dumps(data, indent=2)
        return StreamingResponse(
            io.BytesIO(content.encode()),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=remitflow_{report_type}_{days}d.json"},
        )
    else:
        if not data:
            raise HTTPException(status_code=404, detail="No data available")
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=remitflow_{report_type}_{days}d.csv"},
        )

# ─── Main ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8085))
    logger.info(f"RemitFlow Analytics Pipeline starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
