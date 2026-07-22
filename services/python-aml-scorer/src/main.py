"""
RemitFlow AML/Fraud ML Scorer

This service combines deterministic compliance controls with a persisted,
CPU-only supervised classifier. Model artifacts are trained from labeled
transaction history through an authenticated administrative endpoint and are
never substituted with synthetic metrics or hand-written "ML" behavior.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from prometheus_client import Counter, Gauge, Histogram, CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field
from starlette.responses import Response

from model_runtime import CPUModelRuntime, FEATURE_NAMES


logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "aml-scorer", "msg": "%(message)s"}',
)
logger = logging.getLogger(__name__)


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required AML scorer configuration: {name}")
    return value


DATABASE_URL = required_env("DATABASE_URL")
MODEL_ARTIFACT_PATH = required_env("AML_MODEL_ARTIFACT_PATH")
MODEL_MIN_TRAINING_ROWS = int(required_env("AML_MODEL_MIN_TRAINING_ROWS"))
MODEL_TRAINING_TOKEN = required_env("AML_MODEL_TRAINING_TOKEN")
SCORE_THRESHOLD_MEDIUM = int(required_env("AML_THRESHOLD_MEDIUM"))
SCORE_THRESHOLD_HIGH = int(required_env("AML_THRESHOLD_HIGH"))
SCORE_THRESHOLD_CRITICAL = int(required_env("AML_THRESHOLD_CRITICAL"))
AML_SCORER_PORT = int(required_env("AML_SCORER_PORT"))

scores_total = Counter("aml_scores_total", "Total AML scores computed", ["risk_tier"])
score_latency = Histogram(
    "aml_score_duration_seconds", "Scoring latency", buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5]
)
blocks_total = Counter("aml_blocks_total", "Total transactions blocked")
model_loaded_gauge = Gauge("aml_model_loaded", "Whether a validated AML model artifact is loaded")
model_training_rows_gauge = Gauge("aml_model_training_rows", "Rows used by the active AML model")


class TransactionScoreRequest(BaseModel):
    transaction_id: Optional[int] = None
    user_id: int
    amount: float = Field(gt=0)
    from_currency: str = Field(min_length=3, max_length=8)
    to_currency: str = Field(min_length=3, max_length=8)
    recipient_country: str = Field(min_length=2, max_length=64)
    payment_rail: str = Field(min_length=1, max_length=64)
    device_fingerprint: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class ScoreResponse(BaseModel):
    transaction_id: Optional[int]
    user_id: int
    risk_score: int = Field(ge=0, le=100)
    risk_tier: str
    action: str
    reasons: list[str]
    model_version: str
    scored_at: str
    should_file_sar: bool


class ModelTrainingRequest(BaseModel):
    lookback_days: int = Field(default=365, ge=1, le=3650)


class ModelTrainingResponse(BaseModel):
    version: str
    trained_at: str
    training_rows: int
    positive_rows: int
    auc_roc: Optional[float]
    feature_count: int


HIGH_RISK_COUNTRIES = {
    "AF", "BY", "CF", "CD", "CU", "ER", "ET", "IR", "IQ", "LY", "ML", "MM", "NI", "KP", "RU",
    "SO", "SS", "SD", "SY", "VE", "YE", "ZW", "HT", "PK", "UA",
}
HIGH_RISK_RAILS = {"crypto", "hawala"}
STRUCTURING_AMOUNTS = [9900, 9950, 9990, 4900, 4950, 4990]


class RuleEngine:
    """Interpretable regulatory controls that remain independently auditable."""

    def evaluate(self, req: TransactionScoreRequest, user_history: dict[str, Any]) -> tuple[int, list[str]]:
        score = 0
        reasons: list[str] = []
        if req.recipient_country.upper() in HIGH_RISK_COUNTRIES:
            score += 25
            reasons.append(f"High-risk recipient country: {req.recipient_country}")
        if req.amount > 10000:
            score += 15
            reasons.append(f"Large transaction: {req.amount:,.2f}")
        for threshold in STRUCTURING_AMOUNTS:
            if abs(req.amount - threshold) < 50:
                score += 30
                reasons.append(f"Possible structuring near reporting threshold {threshold}")
                break
        if req.payment_rail.lower() in HIGH_RISK_RAILS:
            score += 20
            reasons.append(f"High-risk payment rail: {req.payment_rail}")
        tx_24h = int(user_history.get("tx_count_24h", 0) or 0)
        if tx_24h > 10:
            score += 20
            reasons.append(f"High velocity: {tx_24h} transactions in 24 hours")
        elif tx_24h > 5:
            score += 10
            reasons.append(f"Elevated velocity: {tx_24h} transactions in 24 hours")
        amount_24h = float(user_history.get("amount_24h", 0) or 0)
        if amount_24h > 50000:
            score += 25
            reasons.append(f"High cumulative 24-hour volume: {amount_24h:,.2f}")
        elif amount_24h > 20000:
            score += 10
            reasons.append(f"Elevated 24-hour volume: {amount_24h:,.2f}")
        account_age_days = int(user_history.get("account_age_days", 0) or 0)
        if account_age_days < 30 and req.amount > 1000:
            score += 20
            reasons.append(f"New account ({account_age_days} days) making a significant transfer")
        kyc_tier = str(user_history.get("kyc_tier", "tier0") or "tier0").lower()
        if kyc_tier in {"tier0", "none"} and req.amount > 500:
            score += 30
            reasons.append("KYC not verified for transfer amount")
        elif kyc_tier == "tier1" and req.amount > 5000:
            score += 15
            reasons.append("KYC tier limit exceeded")
        if (req.from_currency.upper(), req.to_currency.upper()) in {("USD", "KPW"), ("EUR", "IRR"), ("GBP", "SYP")}:
            score += 40
            reasons.append("Sanctioned currency pair")
        if req.amount > 1000 and req.amount % 1000 == 0:
            score += 5
            reasons.append("Round-number amount")
        return min(score, 100), reasons


class FeatureEngineer:
    """Stable feature extraction shared by live inference and historical training."""

    def extract(
        self,
        req: TransactionScoreRequest,
        user_history: dict[str, Any],
        occurred_at: Optional[datetime] = None,
    ) -> np.ndarray:
        timestamp = occurred_at or datetime.now(timezone.utc)
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        amount = float(req.amount)
        payment_rail = req.payment_rail.lower()
        features = [
            amount,
            float(np.log1p(amount)),
            amount / max(float(user_history.get("avg_amount_30d", 0) or 0), 1.0),
            float(user_history.get("tx_count_24h", 0) or 0),
            float(user_history.get("tx_count_7d", 0) or 0),
            float(user_history.get("tx_count_30d", 0) or 0),
            float(user_history.get("amount_24h", 0) or 0),
            float(user_history.get("amount_7d", 0) or 0),
            float(user_history.get("account_age_days", 0) or 0),
            float(1 if str(user_history.get("kyc_tier", "tier0")).lower() in {"tier2", "tier3"} else 0),
            float(user_history.get("failed_tx_count_30d", 0) or 0),
            float(1 if req.recipient_country.upper() in HIGH_RISK_COUNTRIES else 0),
            float({"swift": 0.3, "sepa": 0.1, "ach": 0.1, "instant": 0.2, "crypto": 0.8}.get(payment_rail, 0.5)),
            float(timestamp.hour),
            float(timestamp.weekday()),
            float(1 if timestamp.weekday() >= 5 else 0),
            float(1 if req.from_currency.upper() != req.to_currency.upper() else 0),
        ]
        return np.array(features, dtype=np.float64)


rule_engine = RuleEngine()
feature_engineer = FeatureEngineer()
model_runtime = CPUModelRuntime(MODEL_ARTIFACT_PATH, MODEL_MIN_TRAINING_ROWS)
training_lock = asyncio.Lock()
_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


async def get_user_history(pool: asyncpg.Pool, user_id: int) -> dict[str, Any]:
    row = await pool.fetchrow(
        '''
        SELECT
          COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '24 hours') AS tx_count_24h,
          COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '7 days') AS tx_count_7d,
          COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '30 days') AS tx_count_30d,
          COALESCE(SUM("fromAmount") FILTER (WHERE "createdAt" > NOW() - INTERVAL '24 hours'), 0) AS amount_24h,
          COALESCE(SUM("fromAmount") FILTER (WHERE "createdAt" > NOW() - INTERVAL '7 days'), 0) AS amount_7d,
          COALESCE(AVG("fromAmount") FILTER (WHERE "createdAt" > NOW() - INTERVAL '30 days'), 0) AS avg_amount_30d,
          COUNT(*) FILTER (WHERE status = 'failed' AND "createdAt" > NOW() - INTERVAL '30 days') AS failed_tx_count_30d
        FROM transactions
        WHERE "userId" = $1
        ''',
        user_id,
    )
    user_row = await pool.fetchrow('SELECT "kycTier", "createdAt" FROM users WHERE id = $1', user_id)
    history = dict(row) if row else {}
    if user_row:
        history["kyc_tier"] = user_row["kycTier"] or "tier0"
        created_at = user_row["createdAt"]
        if created_at:
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            history["account_age_days"] = max(0, (datetime.now(timezone.utc) - created_at).days)
    return history


async def get_labeled_training_data(pool: asyncpg.Pool, lookback_days: int) -> tuple[np.ndarray, np.ndarray]:
    """Build training features only from settled platform history and reviewed alerts."""
    rows = await pool.fetch(
        '''
        SELECT
          t.id,
          t."userId" AS user_id,
          t."fromAmount" AS amount,
          t."fromCurrency" AS from_currency,
          COALESCE(t."toCurrency", t."fromCurrency") AS to_currency,
          COALESCE(t."recipientCountry", '') AS recipient_country,
          COALESCE(t.channel, '') AS payment_rail,
          t."createdAt" AS created_at,
          u."kycTier" AS kyc_tier,
          u."createdAt" AS user_created_at,
          (SELECT COUNT(*) FROM transactions h WHERE h."userId" = t."userId" AND h."createdAt" BETWEEN t."createdAt" - INTERVAL '24 hours' AND t."createdAt") AS tx_count_24h,
          (SELECT COUNT(*) FROM transactions h WHERE h."userId" = t."userId" AND h."createdAt" BETWEEN t."createdAt" - INTERVAL '7 days' AND t."createdAt") AS tx_count_7d,
          (SELECT COUNT(*) FROM transactions h WHERE h."userId" = t."userId" AND h."createdAt" BETWEEN t."createdAt" - INTERVAL '30 days' AND t."createdAt") AS tx_count_30d,
          (SELECT COALESCE(SUM(h."fromAmount"), 0) FROM transactions h WHERE h."userId" = t."userId" AND h."createdAt" BETWEEN t."createdAt" - INTERVAL '24 hours' AND t."createdAt") AS amount_24h,
          (SELECT COALESCE(SUM(h."fromAmount"), 0) FROM transactions h WHERE h."userId" = t."userId" AND h."createdAt" BETWEEN t."createdAt" - INTERVAL '7 days' AND t."createdAt") AS amount_7d,
          (SELECT COALESCE(AVG(h."fromAmount"), 0) FROM transactions h WHERE h."userId" = t."userId" AND h."createdAt" BETWEEN t."createdAt" - INTERVAL '30 days' AND t."createdAt") AS avg_amount_30d,
          (SELECT COUNT(*) FROM transactions h WHERE h."userId" = t."userId" AND h.status = 'failed' AND h."createdAt" BETWEEN t."createdAt" - INTERVAL '30 days' AND t."createdAt") AS failed_tx_count_30d,
          CASE WHEN EXISTS (
            SELECT 1 FROM fraud_alerts fa
            WHERE fa.transaction_id = t.id
              AND (fa.risk_level IN ('high', 'critical') OR fa.status = 'blocked')
          ) THEN 1 ELSE 0 END AS label
        FROM transactions t
        JOIN users u ON u.id = t."userId"
        WHERE t."createdAt" >= NOW() - ($1::text || ' days')::interval
          AND t.status IN ('completed', 'failed', 'reversed')
        ORDER BY t."createdAt" ASC
        ''',
        lookback_days,
    )
    if not rows:
        raise ValueError("No settled transaction history is available for model training")

    feature_rows: list[np.ndarray] = []
    labels: list[int] = []
    for row in rows:
        occurred_at = row["created_at"]
        user_created_at = row["user_created_at"]
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=timezone.utc)
        if user_created_at.tzinfo is None:
            user_created_at = user_created_at.replace(tzinfo=timezone.utc)
        request = TransactionScoreRequest(
            transaction_id=row["id"],
            user_id=row["user_id"],
            amount=float(row["amount"]),
            from_currency=row["from_currency"],
            to_currency=row["to_currency"],
            recipient_country=row["recipient_country"] or "ZZ",
            payment_rail=row["payment_rail"] or "unknown",
        )
        history = {
            "tx_count_24h": row["tx_count_24h"],
            "tx_count_7d": row["tx_count_7d"],
            "tx_count_30d": row["tx_count_30d"],
            "amount_24h": row["amount_24h"],
            "amount_7d": row["amount_7d"],
            "avg_amount_30d": row["avg_amount_30d"],
            "failed_tx_count_30d": row["failed_tx_count_30d"],
            "kyc_tier": row["kyc_tier"],
            "account_age_days": max(0, (occurred_at - user_created_at).days),
        }
        feature_rows.append(feature_engineer.extract(request, history, occurred_at))
        labels.append(int(row["label"]))
    return np.vstack(feature_rows), np.asarray(labels, dtype=np.int64)


def compute_final_score(rule_score: int, ml_probability: float) -> int:
    return min(int(rule_score * 0.6 + (ml_probability * 100) * 0.4), 100)


def get_risk_tier(score: int) -> tuple[str, str]:
    if score >= SCORE_THRESHOLD_CRITICAL:
        return "CRITICAL", "block"
    if score >= SCORE_THRESHOLD_HIGH:
        return "HIGH", "review"
    if score >= SCORE_THRESHOLD_MEDIUM:
        return "MEDIUM", "monitor"
    return "LOW", "approve"


def require_training_authorization(x_model_training_token: Optional[str] = Header(default=None)) -> None:
    if not MODEL_TRAINING_TOKEN:
        raise HTTPException(status_code=503, detail="AML model training is disabled until AML_MODEL_TRAINING_TOKEN is configured")
    if not x_model_training_token or not hmac.compare_digest(x_model_training_token, MODEL_TRAINING_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid AML model training token")


app = FastAPI(
    title="RemitFlow AML/Fraud Scorer",
    description="Real-time AML controls plus a persisted CPU-only supervised classifier",
    version="2.0.0",
)


@app.on_event("startup")
async def startup() -> None:
    await get_pool()
    try:
        metadata = model_runtime.load()
        model_loaded_gauge.set(1)
        model_training_rows_gauge.set(metadata.training_rows)
        logger.info("Loaded AML CPU model %s trained with %s rows", metadata.version, metadata.training_rows)
    except FileNotFoundError:
        model_loaded_gauge.set(0)
        logger.warning("No AML model artifact is loaded; scoring remains unavailable until an authorized training run completes")
    except Exception as exc:
        model_loaded_gauge.set(0)
        logger.error("AML model artifact validation failed: %s", exc)


@app.on_event("shutdown")
async def shutdown() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


@app.post("/model/train", response_model=ModelTrainingResponse, dependencies=[Depends(require_training_authorization)])
async def train_model(request: ModelTrainingRequest) -> ModelTrainingResponse:
    if training_lock.locked():
        raise HTTPException(status_code=409, detail="AML model training is already in progress")
    async with training_lock:
        pool = await get_pool()
        try:
            features, labels = await get_labeled_training_data(pool, request.lookback_days)
            loop = asyncio.get_running_loop()
            metadata = await loop.run_in_executor(None, model_runtime.train, features, labels)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        model_loaded_gauge.set(1)
        model_training_rows_gauge.set(metadata.training_rows)
        logger.info("Trained AML CPU model %s using %s rows", metadata.version, metadata.training_rows)
        return ModelTrainingResponse(
            version=metadata.version,
            trained_at=metadata.trained_at,
            training_rows=metadata.training_rows,
            positive_rows=metadata.positive_rows,
            auc_roc=metadata.auc_roc,
            feature_count=len(FEATURE_NAMES),
        )


@app.post("/score", response_model=ScoreResponse)
async def score_transaction(req: TransactionScoreRequest) -> ScoreResponse:
    if not model_runtime.loaded:
        raise HTTPException(status_code=503, detail="AML model artifact is not loaded; run authorized model training first")
    started = time.time()
    pool = await get_pool()
    user_history = await get_user_history(pool, req.user_id)
    rule_score, reasons = rule_engine.evaluate(req, user_history)
    probability = model_runtime.predict_probability(feature_engineer.extract(req, user_history))
    final_score = compute_final_score(rule_score, probability)
    risk_tier, action = get_risk_tier(final_score)
    metadata = model_runtime.metadata
    assert metadata is not None
    score_latency.observe(time.time() - started)
    scores_total.labels(risk_tier=risk_tier).inc()
    if action == "block":
        blocks_total.inc()

    if final_score >= SCORE_THRESHOLD_HIGH:
        await pool.execute(
            '''
            INSERT INTO fraud_alerts
              (user_id, transaction_id, risk_score, risk_level, status, flagged_reasons, transaction_amount, model_version, created_at, updated_at)
            VALUES ($1, $2, $3, $4::fraud_risk_level, $5::fraud_alert_status, $6::json, $7, $8, NOW(), NOW())
            ''',
            req.user_id,
            req.transaction_id,
            final_score,
            risk_tier.lower(),
            "blocked" if action == "block" else "pending",
            json.dumps(reasons),
            int(round(req.amount)),
            metadata.version,
        )

    return ScoreResponse(
        transaction_id=req.transaction_id,
        user_id=req.user_id,
        risk_score=final_score,
        risk_tier=risk_tier,
        action=action,
        reasons=reasons,
        model_version=metadata.version,
        scored_at=datetime.now(timezone.utc).isoformat(),
        should_file_sar=final_score >= SCORE_THRESHOLD_CRITICAL,
    )


@app.post("/score/batch")
async def score_batch(requests: list[TransactionScoreRequest]) -> dict[str, Any]:
    if len(requests) > 100:
        raise HTTPException(status_code=400, detail="Batch size is limited to 100")
    results = await asyncio.gather(*(score_transaction(request) for request in requests))
    return {
        "results": results,
        "total": len(results),
        "blocked": sum(1 for result in results if result.action == "block"),
        "flagged": sum(1 for result in results if result.action == "review"),
    }


@app.get("/model/info")
async def model_info() -> dict[str, Any]:
    return {
        "feature_names": FEATURE_NAMES,
        "thresholds": {"medium": SCORE_THRESHOLD_MEDIUM, "high": SCORE_THRESHOLD_HIGH, "critical": SCORE_THRESHOLD_CRITICAL},
        **model_runtime.info(),
    }


@app.get("/health")
async def health() -> JSONResponse:
    try:
        pool = await get_pool()
        await pool.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    model_ok = model_runtime.loaded
    return JSONResponse(
        status_code=200 if db_ok and model_ok else 503,
        content={
            "status": "ok" if db_ok and model_ok else "degraded",
            "service": "aml-scorer",
            "database": db_ok,
            "model": model_runtime.info(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=AML_SCORER_PORT, log_level="info")
