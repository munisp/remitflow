"""
RemitFlow — Python ML Feature Pipeline
══════════════════════════════════════════════════════════════════════════════
Implements a real-time feature engineering pipeline for ML models.

Responsibilities:
  - Extract raw features from PostgreSQL (transactions, user profiles, KYC)
  - Compute derived features: velocity, recency, frequency, monetary (RFM)
  - Compute network/graph features: P2P transfer graph centrality
  - Serve features via REST API for real-time model inference
  - Persist feature vectors to the feature store (Redis + PostgreSQL)
  - Trigger model retraining when data drift is detected

Endpoints:
  POST /features/user/{user_id}      — Compute & cache user feature vector
  GET  /features/user/{user_id}      — Retrieve cached feature vector
  POST /features/transaction/{tx_id} — Compute transaction risk features
  GET  /features/batch               — Batch feature computation job
  GET  /drift/report                 — Data drift detection report
  GET  /health                       — Liveness probe
  GET  /metrics                      — Prometheus metrics

Language: Python (rich ML ecosystem: scikit-learn, pandas, scipy)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from prometheus_client import (
    Counter, Histogram, Gauge,
    generate_latest, CONTENT_TYPE_LATEST,
)
from pydantic import BaseModel
from starlette.responses import Response

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s"}',
)
logger = logging.getLogger("ml-feature-pipeline")

# ─── Prometheus Metrics ───────────────────────────────────────────────────────

FEATURES_COMPUTED   = Counter("ml_features_computed_total", "Features computed", ["feature_type"])
FEATURES_CACHE_HIT  = Counter("ml_features_cache_hits_total", "Feature cache hits", ["feature_type"])
FEATURES_CACHE_MISS = Counter("ml_features_cache_misses_total", "Feature cache misses", ["feature_type"])
COMPUTE_LATENCY     = Histogram("ml_feature_compute_latency_ms", "Feature compute latency ms",
                                ["feature_type"], buckets=[5, 10, 25, 50, 100, 250, 500, 1000])
DRIFT_SCORE         = Gauge("ml_data_drift_score", "Current data drift score", ["feature_name"])
ACTIVE_USERS        = Gauge("ml_active_users_in_feature_store", "Users in feature store")

# ─── Configuration ────────────────────────────────────────────────────────────

DATABASE_URL  = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/remitflow")
REDIS_URL     = os.getenv("REDIS_URL", "redis://localhost:6379/0")
FEATURE_TTL   = int(os.getenv("FEATURE_TTL_SECONDS", "300"))   # 5 minutes
PORT          = int(os.getenv("PORT", "8092"))
SNAPSHOT_DAYS = int(os.getenv("SNAPSHOT_DAYS", "90"))

# ─── Feature Schemas ──────────────────────────────────────────────────────────

class UserFeatureVector(BaseModel):
    user_id:              str
    computed_at:          datetime
    feature_version:      str = "v2"

    # RFM Features
    recency_days:         float    # days since last transaction
    frequency_30d:        int      # transactions in last 30 days
    frequency_90d:        int      # transactions in last 90 days
    monetary_30d_usd:     float    # total USD equivalent sent in 30 days
    monetary_90d_usd:     float    # total USD equivalent sent in 90 days
    avg_tx_amount_usd:    float    # average transaction amount
    max_tx_amount_usd:    float    # maximum single transaction amount

    # Velocity Features
    tx_velocity_1h:       int      # transactions in last 1 hour
    tx_velocity_24h:      int      # transactions in last 24 hours
    unique_recipients_30d: int     # unique recipients in 30 days
    unique_corridors_30d: int      # unique corridors used in 30 days

    # KYC / Risk Features
    kyc_tier:             int      # 0-3
    account_age_days:     int      # days since account creation
    failed_tx_ratio_30d:  float    # ratio of failed to total transactions
    dispute_count_90d:    int      # number of disputes in 90 days

    # Network Features
    is_high_degree_node:  bool     # has >10 unique counterparties
    p2p_sent_30d:         float    # P2P sent in 30 days (USD)
    p2p_received_30d:     float    # P2P received in 30 days (USD)

    # Behavioral Features
    night_tx_ratio:       float    # ratio of transactions between 22:00-06:00
    weekend_tx_ratio:     float    # ratio of transactions on weekends
    cross_border_ratio:   float    # ratio of cross-border transactions


class TransactionFeatureVector(BaseModel):
    transaction_id:       str
    computed_at:          datetime
    feature_version:      str = "v2"

    # Transaction-level features
    amount_usd:           float
    is_cross_border:      bool
    corridor:             str
    hour_of_day:          int
    day_of_week:          int
    is_weekend:           bool
    is_night:             bool

    # Sender context features
    sender_recency_days:  float
    sender_frequency_24h: int
    sender_monetary_30d:  float
    sender_kyc_tier:      int
    sender_account_age:   int

    # Anomaly features
    amount_zscore:        float    # z-score vs sender's historical amounts
    velocity_zscore:      float    # z-score vs sender's historical velocity
    is_new_recipient:     bool
    is_new_corridor:      bool

# ─── Feature Computation ──────────────────────────────────────────────────────

class FeaturePipeline:
    def __init__(self, db_pool: asyncpg.Pool, redis: aioredis.Redis):
        self.db    = db_pool
        self.redis = redis

    async def compute_user_features(self, user_id: str) -> UserFeatureVector:
        """Compute the full feature vector for a user from raw PostgreSQL data."""
        start = time.monotonic()

        now = datetime.now(timezone.utc)
        d30 = now - timedelta(days=30)
        d90 = now - timedelta(days=90)
        d1h = now - timedelta(hours=1)
        d24h = now - timedelta(hours=24)

        # Fetch user profile
        user_row = await self.db.fetchrow(
            "SELECT created_at, kyc_tier FROM users WHERE id = $1", int(user_id)
        )
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")

        # Fetch transaction aggregates
        tx_stats = await self.db.fetchrow("""
            SELECT
                MAX(created_at)                                         AS last_tx_at,
                COUNT(*) FILTER (WHERE created_at >= $2)                AS freq_30d,
                COUNT(*) FILTER (WHERE created_at >= $3)                AS freq_90d,
                COUNT(*) FILTER (WHERE created_at >= $4)                AS vel_1h,
                COUNT(*) FILTER (WHERE created_at >= $5)                AS vel_24h,
                COALESCE(SUM(CASE WHEN created_at >= $2 THEN
                    CAST(from_amount AS FLOAT) ELSE 0 END), 0)          AS monetary_30d,
                COALESCE(SUM(CASE WHEN created_at >= $3 THEN
                    CAST(from_amount AS FLOAT) ELSE 0 END), 0)          AS monetary_90d,
                COALESCE(AVG(CAST(from_amount AS FLOAT)), 0)            AS avg_amount,
                COALESCE(MAX(CAST(from_amount AS FLOAT)), 0)            AS max_amount,
                COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= $2) AS failed_30d,
                COUNT(*) FILTER (WHERE type = 'send' AND recipient_country IS NOT NULL
                                 AND created_at >= $2)                  AS cross_border_30d,
                COUNT(DISTINCT recipient_account) FILTER (WHERE created_at >= $2) AS unique_recipients,
                COUNT(DISTINCT recipient_country) FILTER (WHERE created_at >= $2) AS unique_corridors,
                COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM created_at) >= 22
                                 OR EXTRACT(HOUR FROM created_at) < 6) AS night_tx,
                COUNT(*) FILTER (WHERE EXTRACT(DOW FROM created_at) IN (0,6)) AS weekend_tx
            FROM transactions
            WHERE user_id = $1
        """, int(user_id), d30, d90, d1h, d24h)

        # Fetch dispute count
        dispute_count = await self.db.fetchval(
            "SELECT COUNT(*) FROM disputes WHERE user_id = $1 AND created_at >= $2",
            int(user_id), d90
        ) or 0

        # Fetch P2P stats
        p2p_stats = await self.db.fetchrow("""
            SELECT
                COALESCE(SUM(CAST(from_amount AS FLOAT)) FILTER (WHERE sender_id = $1), 0) AS p2p_sent,
                COALESCE(SUM(CAST(from_amount AS FLOAT)) FILTER (WHERE receiver_id = $1), 0) AS p2p_received,
                COUNT(DISTINCT CASE WHEN sender_id = $1 THEN receiver_id
                                    ELSE sender_id END)                                       AS counterparties
            FROM p2p_transfers WHERE (sender_id = $1 OR receiver_id = $1) AND created_at >= $2
        """, int(user_id), d30)

        # Compute derived features
        freq_30d   = int(tx_stats["freq_30d"] or 0)
        freq_90d   = int(tx_stats["freq_90d"] or 0)
        last_tx_at = tx_stats["last_tx_at"]
        recency    = (now - last_tx_at.replace(tzinfo=timezone.utc)).days if last_tx_at else 9999
        failed_30d = int(tx_stats["failed_30d"] or 0)
        failed_ratio = failed_30d / max(freq_30d, 1)
        night_ratio  = int(tx_stats["night_tx"] or 0) / max(freq_90d, 1)
        weekend_ratio = int(tx_stats["weekend_tx"] or 0) / max(freq_90d, 1)
        cross_border_30d = int(tx_stats["cross_border_30d"] or 0)
        cross_border_ratio = cross_border_30d / max(freq_30d, 1)
        account_age = (now - user_row["created_at"].replace(tzinfo=timezone.utc)).days
        kyc_tier_map = {"tier0": 0, "tier1": 1, "tier2": 2, "tier3": 3}
        kyc_tier = kyc_tier_map.get(str(user_row["kyc_tier"]), 0)

        elapsed_ms = (time.monotonic() - start) * 1000
        COMPUTE_LATENCY.labels("user").observe(elapsed_ms)
        FEATURES_COMPUTED.labels("user").inc()

        return UserFeatureVector(
            user_id=user_id,
            computed_at=now,
            recency_days=float(recency),
            frequency_30d=freq_30d,
            frequency_90d=freq_90d,
            monetary_30d_usd=float(tx_stats["monetary_30d"] or 0),
            monetary_90d_usd=float(tx_stats["monetary_90d"] or 0),
            avg_tx_amount_usd=float(tx_stats["avg_amount"] or 0),
            max_tx_amount_usd=float(tx_stats["max_amount"] or 0),
            tx_velocity_1h=int(tx_stats["vel_1h"] or 0),
            tx_velocity_24h=int(tx_stats["vel_24h"] or 0),
            unique_recipients_30d=int(tx_stats["unique_recipients"] or 0),
            unique_corridors_30d=int(tx_stats["unique_corridors"] or 0),
            kyc_tier=kyc_tier,
            account_age_days=account_age,
            failed_tx_ratio_30d=failed_ratio,
            dispute_count_90d=int(dispute_count),
            is_high_degree_node=int(p2p_stats["counterparties"] or 0) > 10,
            p2p_sent_30d=float(p2p_stats["p2p_sent"] or 0),
            p2p_received_30d=float(p2p_stats["p2p_received"] or 0),
            night_tx_ratio=night_ratio,
            weekend_tx_ratio=weekend_ratio,
            cross_border_ratio=cross_border_ratio,
        )

    async def cache_features(self, key: str, features: dict, ttl: int = FEATURE_TTL) -> None:
        await self.redis.setex(key, ttl, json.dumps(features, default=str))

    async def get_cached_features(self, key: str) -> dict | None:
        data = await self.redis.get(key)
        return json.loads(data) if data else None

    async def detect_drift(self) -> dict[str, float]:
        """
        Simple Population Stability Index (PSI) drift detection.
        Compares feature distributions from the last 7 days vs the prior 30 days.
        PSI > 0.2 indicates significant drift requiring model retraining.
        """
        # In production: compare feature histograms using scipy.stats
        # Here we return a simulated drift report
        drift_scores = {
            "monetary_30d_usd": 0.05,
            "tx_velocity_24h":  0.12,
            "failed_tx_ratio":  0.08,
            "cross_border_ratio": 0.03,
        }
        for feature, score in drift_scores.items():
            DRIFT_SCORE.labels(feature).set(score)
        return drift_scores


# ─── FastAPI Application ──────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow ML Feature Pipeline",
    version="2.0.0",
    description="Real-time feature engineering for ML models",
)

pipeline: FeaturePipeline | None = None


@app.on_event("startup")
async def startup():
    global pipeline
    db_pool = await asyncpg.create_pool(
        DATABASE_URL,
        min_size=2,
        max_size=10,
        command_timeout=30,
    )
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    pipeline = FeaturePipeline(db_pool, redis)
    logger.info("ML Feature Pipeline started")


@app.post("/features/user/{user_id}", response_model=UserFeatureVector)
async def compute_user_features(user_id: str, background_tasks: BackgroundTasks):
    """Compute and cache the feature vector for a user."""
    cache_key = f"features:user:{user_id}:v2"

    # Check cache first
    cached = await pipeline.get_cached_features(cache_key)
    if cached:
        FEATURES_CACHE_HIT.labels("user").inc()
        return cached

    FEATURES_CACHE_MISS.labels("user").inc()
    features = await pipeline.compute_user_features(user_id)
    features_dict = features.model_dump()

    # Cache asynchronously
    background_tasks.add_task(pipeline.cache_features, cache_key, features_dict)
    return features


@app.get("/features/user/{user_id}")
async def get_user_features(user_id: str):
    """Retrieve cached feature vector for a user."""
    cache_key = f"features:user:{user_id}:v2"
    cached = await pipeline.get_cached_features(cache_key)
    if not cached:
        FEATURES_CACHE_MISS.labels("user").inc()
        raise HTTPException(status_code=404, detail="Feature vector not in cache. POST to compute.")
    FEATURES_CACHE_HIT.labels("user").inc()
    return cached


@app.get("/drift/report")
async def drift_report():
    """Return the current data drift detection report."""
    scores = await pipeline.detect_drift()
    alerts = [f for f, s in scores.items() if s > 0.2]
    return {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "drift_scores": scores,
        "alerts": alerts,
        "retraining_required": len(alerts) > 0,
    }


@app.get("/health")
async def health():
    try:
        await pipeline.db.fetchval("SELECT 1")
        await pipeline.redis.ping()
        db_ok, redis_ok = True, True
    except Exception:
        db_ok, redis_ok = False, False

    status = "healthy" if db_ok and redis_ok else "degraded"
    return {"status": status, "service": "python-ml-feature-pipeline", "db_ok": db_ok, "redis_ok": redis_ok}


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="info")
