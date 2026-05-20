"""
RemitFlow Analytics Engine — Python microservice
Revenue analytics, cohort analysis, corridor performance, and reporting API
REST API: GET /revenue, GET /corridors, GET /cohorts, GET /kpis, GET /health
"""
import os
import time
import random
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

import numpy as np
from fastapi import FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("analytics-engine")

# ─── Models ──────────────────────────────────────────────────────────────────

class RevenueDataPoint(BaseModel):
    period: str
    revenue_usd: float
    transaction_count: int
    avg_transaction_usd: float
    fee_revenue_usd: float
    fx_spread_revenue_usd: float

class CorridorMetrics(BaseModel):
    corridor_id: str
    source_country: str
    dest_country: str
    transaction_count: int
    volume_usd: float
    revenue_usd: float
    avg_fee_percent: float
    avg_delivery_minutes: float
    success_rate: float

class CohortRow(BaseModel):
    cohort_month: str
    cohort_size: int
    retention_m1: float
    retention_m3: float
    retention_m6: float
    retention_m12: float
    ltv_usd: float

class KPISnapshot(BaseModel):
    period: str
    total_users: int
    active_users: int
    new_users: int
    total_volume_usd: float
    total_revenue_usd: float
    avg_transaction_usd: float
    transaction_count: int
    success_rate: float
    avg_delivery_minutes: float
    nps_score: float

# ─── Synthetic Data Generator ─────────────────────────────────────────────────

def generate_monthly_revenue(months: int = 12) -> List[Dict]:
    """Generate realistic monthly revenue data with growth trend"""
    random.seed(42)
    base_revenue = 15000
    data = []
    for i in range(months):
        date = datetime.now(timezone.utc) - timedelta(days=30 * (months - i))
        growth = 1.0 + (i * 0.08) + random.uniform(-0.05, 0.05)
        revenue = base_revenue * growth
        tx_count = int(500 * growth + random.randint(-50, 50))
        fee_rev = revenue * 0.6
        fx_rev = revenue * 0.4
        data.append({
            "period": date.strftime("%Y-%m"),
            "revenue_usd": round(revenue, 2),
            "transaction_count": tx_count,
            "avg_transaction_usd": round(revenue / max(tx_count, 1) * 15, 2),
            "fee_revenue_usd": round(fee_rev, 2),
            "fx_spread_revenue_usd": round(fx_rev, 2),
        })
    return data

def generate_corridor_metrics() -> List[Dict]:
    corridors = [
        ("US", "NG", "USD", "NGN", 0.5, 1.2, 15),
        ("GB", "NG", "GBP", "NGN", 0.4, 1.0, 15),
        ("CA", "NG", "CAD", "NGN", 0.6, 1.3, 30),
        ("US", "GH", "USD", "GHS", 0.5, 1.2, 15),
        ("US", "KE", "USD", "KES", 0.5, 1.1, 10),
        ("GB", "GH", "GBP", "GHS", 0.4, 1.0, 15),
        ("EU", "NG", "EUR", "NGN", 0.4, 1.1, 20),
        ("US", "ZA", "USD", "ZAR", 0.6, 1.4, 30),
    ]
    random.seed(42)
    result = []
    for src, dst, sc, dc, fee_pct, spread, delivery in corridors:
        tx_count = random.randint(200, 2000)
        avg_amount = random.uniform(150, 800)
        volume = tx_count * avg_amount
        revenue = volume * (fee_pct + spread) / 100
        result.append({
            "corridor_id": f"{src}-{dst}",
            "source_country": src,
            "dest_country": dst,
            "transaction_count": tx_count,
            "volume_usd": round(volume, 2),
            "revenue_usd": round(revenue, 2),
            "avg_fee_percent": fee_pct,
            "avg_delivery_minutes": delivery + random.uniform(-2, 5),
            "success_rate": round(random.uniform(0.97, 0.999), 3),
        })
    return sorted(result, key=lambda x: x["volume_usd"], reverse=True)

def generate_cohort_data(months: int = 12) -> List[Dict]:
    random.seed(42)
    result = []
    for i in range(months):
        date = datetime.now(timezone.utc) - timedelta(days=30 * (months - i))
        cohort_size = random.randint(80, 300)
        r1 = random.uniform(0.55, 0.75)
        r3 = r1 * random.uniform(0.6, 0.8)
        r6 = r3 * random.uniform(0.65, 0.85)
        r12 = r6 * random.uniform(0.7, 0.9)
        ltv = cohort_size * random.uniform(45, 120)
        result.append({
            "cohort_month": date.strftime("%Y-%m"),
            "cohort_size": cohort_size,
            "retention_m1": round(r1, 3),
            "retention_m3": round(r3, 3),
            "retention_m6": round(r6, 3),
            "retention_m12": round(r12, 3),
            "ltv_usd": round(ltv, 2),
        })
    return result

def generate_kpis() -> Dict:
    random.seed(int(time.time() / 3600))  # Changes hourly
    base = {
        "period": datetime.now(timezone.utc).strftime("%Y-%m"),
        "total_users": 12847 + random.randint(0, 200),
        "active_users": 4231 + random.randint(-50, 100),
        "new_users": 387 + random.randint(-30, 60),
        "total_volume_usd": 2847293.50 + random.uniform(-50000, 100000),
        "total_revenue_usd": 48293.20 + random.uniform(-2000, 5000),
        "avg_transaction_usd": 287.40 + random.uniform(-20, 30),
        "transaction_count": 9912 + random.randint(-100, 200),
        "success_rate": round(random.uniform(0.975, 0.995), 4),
        "avg_delivery_minutes": round(random.uniform(12, 25), 1),
        "nps_score": round(random.uniform(42, 58), 1),
    }
    return base

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Analytics Engine",
    description="Revenue analytics, cohort analysis, and reporting for RemitFlow",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Prometheus Metrics ───────────────────────────────────────────────────────

analytics_requests_total = Counter("analytics_requests_total", "Total analytics API requests", ["endpoint"])
analytics_request_duration = Histogram("analytics_request_duration_seconds", "Analytics request latency")
analytics_corridors_tracked = Gauge("analytics_corridors_tracked", "Number of corridors being tracked")
analytics_revenue_usd = Gauge("analytics_total_revenue_usd", "Total tracked revenue in USD")

@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "analytics-engine",
        "version": "1.0.0",
        "timestamp": int(time.time() * 1000),
    }

@app.get("/revenue")
async def get_revenue(months: int = Query(default=12, ge=1, le=36)):
    data = generate_monthly_revenue(months)
    total_revenue = sum(d["revenue_usd"] for d in data)
    total_volume = sum(d["avg_transaction_usd"] * d["transaction_count"] for d in data)
    return {
        "data": data,
        "summary": {
            "total_revenue_usd": round(total_revenue, 2),
            "total_volume_usd": round(total_volume, 2),
            "avg_monthly_revenue_usd": round(total_revenue / len(data), 2),
            "periods": len(data),
        },
        "timestamp": int(time.time() * 1000),
    }

@app.get("/corridors")
async def get_corridors():
    data = generate_corridor_metrics()
    return {
        "data": data,
        "count": len(data),
        "total_volume_usd": round(sum(c["volume_usd"] for c in data), 2),
        "total_revenue_usd": round(sum(c["revenue_usd"] for c in data), 2),
        "timestamp": int(time.time() * 1000),
    }

@app.get("/cohorts")
async def get_cohorts(months: int = Query(default=12, ge=3, le=24)):
    data = generate_cohort_data(months)
    return {
        "data": data,
        "avg_retention_m1": round(sum(c["retention_m1"] for c in data) / len(data), 3),
        "avg_retention_m6": round(sum(c["retention_m6"] for c in data) / len(data), 3),
        "avg_ltv_usd": round(sum(c["ltv_usd"] for c in data) / len(data), 2),
        "timestamp": int(time.time() * 1000),
    }

@app.get("/kpis")
async def get_kpis():
    return {
        "data": generate_kpis(),
        "timestamp": int(time.time() * 1000),
    }

@app.get("/top-corridors")
async def get_top_corridors(limit: int = Query(default=5, ge=1, le=20)):
    data = generate_corridor_metrics()
    return {
        "data": data[:limit],
        "timestamp": int(time.time() * 1000),
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8089"))
    logger.info(f"Starting Analytics Engine on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
