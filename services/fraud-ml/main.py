"""
RemitFlow Fraud Scoring ML Service
FastAPI + scikit-learn RandomForest
Port: 8082
"""

from __future__ import annotations

import os
import json
import math
import random
import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import shap
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="[FRAUD-ML] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RemitFlow Fraud Scoring Service",
    description="ML-powered fraud detection for cross-border remittances",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Country risk scores (0=low, 1=high) ──────────────────────────────────────
COUNTRY_RISK = {
    "US": 0.05, "GB": 0.05, "CA": 0.05, "AU": 0.05, "DE": 0.05,
    "NG": 0.35, "GH": 0.25, "KE": 0.20, "ZA": 0.20, "ET": 0.30,
    "RU": 0.60, "CN": 0.40, "IR": 0.95, "KP": 0.99, "SY": 0.90,
    "MX": 0.30, "BR": 0.25, "IN": 0.15, "PH": 0.20, "PK": 0.45,
}

FEATURE_NAMES = [
    "amount_usd",
    "amount_zscore",
    "hour_of_day",
    "day_of_week",
    "sender_country_risk",
    "receiver_country_risk",
    "velocity_1h",
    "velocity_24h",
    "velocity_7d",
    "is_round_number",
    "is_high_value",
    "is_new_beneficiary",
    "device_risk",
    "same_currency",
    "amount_log",
]

MODEL_PATH = Path(__file__).parent / "fraud_model.joblib"

# ─── Model training on synthetic data ─────────────────────────────────────────

def generate_synthetic_data(n: int = 5000):
    """Generate synthetic transaction data for training."""
    rng = np.random.default_rng(42)
    X, y = [], []
    for _ in range(n):
        is_fraud = rng.random() < 0.08  # 8% fraud rate
        amount = rng.lognormal(5.5, 1.2) if not is_fraud else rng.lognormal(7.0, 1.5)
        hour = rng.integers(0, 24)
        dow = rng.integers(0, 7)
        s_risk = rng.choice(list(COUNTRY_RISK.values()))
        r_risk = rng.choice(list(COUNTRY_RISK.values()))
        vel_1h = rng.integers(0, 3) if not is_fraud else rng.integers(2, 15)
        vel_24h = rng.integers(0, 8) if not is_fraud else rng.integers(5, 30)
        vel_7d = rng.integers(0, 20) if not is_fraud else rng.integers(10, 60)
        is_round = 1 if amount % 100 < 1 else 0
        is_high = 1 if amount > 5000 else 0
        is_new_bene = rng.integers(0, 2)
        device_risk = rng.uniform(0, 0.3) if not is_fraud else rng.uniform(0.4, 1.0)
        same_curr = rng.integers(0, 2)
        amount_log = math.log1p(amount)
        # amount_zscore relative to mean ~$500
        amount_zscore = (amount - 500) / 800

        # Fraud signals
        if is_fraud:
            if rng.random() < 0.6:
                r_risk = rng.uniform(0.5, 1.0)
            if rng.random() < 0.4:
                hour = rng.choice([0, 1, 2, 3, 4, 22, 23])
            if rng.random() < 0.5:
                vel_1h += rng.integers(3, 10)

        X.append([
            amount, amount_zscore, hour, dow,
            s_risk, r_risk,
            vel_1h, vel_24h, vel_7d,
            is_round, is_high, is_new_bene,
            device_risk, same_curr, amount_log,
        ])
        y.append(int(is_fraud))
    return np.array(X), np.array(y)


def train_model():
    logger.info("Training fraud detection model on synthetic data…")
    X, y = generate_synthetic_data(8000)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", RandomForestClassifier(
            n_estimators=200,
            max_depth=12,
            min_samples_leaf=5,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1,
        )),
    ])
    model.fit(X_train, y_train)
    proba = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, proba)
    logger.info(f"Model trained — AUC: {auc:.4f}")
    joblib.dump(model, MODEL_PATH)
    return model


def load_or_train():
    if MODEL_PATH.exists():
        logger.info("Loading existing model from disk…")
        return joblib.load(MODEL_PATH)
    return train_model()


# ─── Load model at startup ────────────────────────────────────────────────────
model: Pipeline = load_or_train()
# SHAP explainer (uses tree explainer for RF)
_clf = model.named_steps["clf"]
_scaler = model.named_steps["scaler"]
explainer = shap.TreeExplainer(_clf)


# ─── Schemas ──────────────────────────────────────────────────────────────────

class TransactionInput(BaseModel):
    transaction_id: str = Field(..., description="Unique transaction ID")
    amount_usd: float = Field(..., gt=0)
    sender_country: str = Field(default="US")
    receiver_country: str = Field(default="NG")
    hour_of_day: Optional[int] = Field(default=None, ge=0, le=23)
    day_of_week: Optional[int] = Field(default=None, ge=0, le=6)
    velocity_1h: int = Field(default=0, ge=0)
    velocity_24h: int = Field(default=0, ge=0)
    velocity_7d: int = Field(default=0, ge=0)
    is_new_beneficiary: bool = False
    device_fingerprint: Optional[str] = None
    from_currency: str = "USD"
    to_currency: str = "NGN"


class ScoreResponse(BaseModel):
    transaction_id: str
    fraud_score: float
    risk_level: str
    recommendation: str
    top_features: list[dict]
    model_version: str = "rf-v1.0"
    latency_ms: float


class CorridorStat(BaseModel):
    corridor: str
    avg_amount_usd: float
    total_volume_usd: float
    transaction_count: int
    fraud_rate: float
    avg_fraud_score: float


# ─── Feature engineering ──────────────────────────────────────────────────────

def build_features(tx: TransactionInput) -> np.ndarray:
    now = datetime.now(timezone.utc)
    hour = tx.hour_of_day if tx.hour_of_day is not None else now.hour
    dow = tx.day_of_week if tx.day_of_week is not None else now.weekday()
    s_risk = COUNTRY_RISK.get(tx.sender_country.upper(), 0.3)
    r_risk = COUNTRY_RISK.get(tx.receiver_country.upper(), 0.3)
    is_round = 1 if tx.amount_usd % 100 < 1 else 0
    is_high = 1 if tx.amount_usd > 5000 else 0
    is_new_bene = 1 if tx.is_new_beneficiary else 0
    # Device risk: hash fingerprint to a deterministic float
    device_risk = 0.1
    if tx.device_fingerprint:
        h = int(hashlib.md5(tx.device_fingerprint.encode()).hexdigest(), 16)
        device_risk = (h % 100) / 100.0
    same_curr = 1 if tx.from_currency == tx.to_currency else 0
    amount_log = math.log1p(tx.amount_usd)
    amount_zscore = (tx.amount_usd - 500) / 800

    return np.array([[
        tx.amount_usd, amount_zscore, hour, dow,
        s_risk, r_risk,
        tx.velocity_1h, tx.velocity_24h, tx.velocity_7d,
        is_round, is_high, is_new_bene,
        device_risk, same_curr, amount_log,
    ]])


def risk_level(score: float) -> tuple[str, str]:
    if score >= 0.75:
        return "HIGH", "BLOCK"
    elif score >= 0.45:
        return "MEDIUM", "REVIEW"
    elif score >= 0.20:
        return "LOW", "MONITOR"
    return "MINIMAL", "PASS"


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "fraud-ml", "version": "1.0.0", "model": "rf-v1.0"}


@app.post("/score", response_model=ScoreResponse)
def score_transaction(tx: TransactionInput):
    import time
    t0 = time.perf_counter()

    features = build_features(tx)
    scaled = _scaler.transform(features)
    fraud_score = float(_clf.predict_proba(features)[0][1])
    level, recommendation = risk_level(fraud_score)

    # SHAP top features
    shap_vals = explainer.shap_values(scaled)
    if isinstance(shap_vals, list):
        shap_vals = shap_vals[1]  # class=1 (fraud)
    shap_row = shap_vals[0]
    top_idx = np.argsort(np.abs(shap_row))[::-1][:5]
    top_features = [
        {"feature": FEATURE_NAMES[i], "shap_value": round(float(shap_row[i]), 4)}
        for i in top_idx
    ]

    latency = (time.perf_counter() - t0) * 1000
    logger.info(f"[SCORE] txn={tx.transaction_id} score={fraud_score:.3f} level={level} latency={latency:.1f}ms")

    return ScoreResponse(
        transaction_id=tx.transaction_id,
        fraud_score=round(fraud_score, 4),
        risk_level=level,
        recommendation=recommendation,
        top_features=top_features,
        latency_ms=round(latency, 2),
    )


@app.post("/explain")
def explain_transaction(tx: TransactionInput):
    """Return full SHAP explanation for a transaction."""
    features = build_features(tx)
    scaled = _scaler.transform(features)
    shap_vals = explainer.shap_values(scaled)
    if isinstance(shap_vals, list):
        shap_vals = shap_vals[1]
    shap_row = shap_vals[0]
    explanation = [
        {"feature": FEATURE_NAMES[i], "value": round(float(features[0][i]), 4), "shap": round(float(shap_row[i]), 4)}
        for i in range(len(FEATURE_NAMES))
    ]
    explanation.sort(key=lambda x: abs(x["shap"]), reverse=True)
    return {
        "transaction_id": tx.transaction_id,
        "fraud_score": round(float(_clf.predict_proba(features)[0][1]), 4),
        "base_value": round(float(explainer.expected_value[1] if isinstance(explainer.expected_value, np.ndarray) else explainer.expected_value), 4),
        "features": explanation,
    }


@app.get("/analytics/corridor-stats")
def corridor_stats():
    """Return synthetic corridor-level fraud analytics."""
    corridors = [
        ("GBP/NGN", 850, 2_400_000, 2823, 0.042, 0.18),
        ("USD/NGN", 620, 1_850_000, 2984, 0.038, 0.16),
        ("USD/KES", 430, 980_000, 2279, 0.028, 0.12),
        ("GBP/GHS", 510, 720_000, 1412, 0.031, 0.14),
        ("EUR/XOF", 390, 540_000, 1385, 0.022, 0.10),
        ("USD/TZS", 280, 310_000, 1107, 0.019, 0.09),
        ("CAD/NGN", 470, 420_000, 894, 0.045, 0.20),
        ("AUD/KES", 320, 280_000, 875, 0.024, 0.11),
    ]
    return {
        "corridors": [
            CorridorStat(
                corridor=c[0],
                avg_amount_usd=c[1],
                total_volume_usd=c[2],
                transaction_count=c[3],
                fraud_rate=c[4],
                avg_fraud_score=c[5],
            ).model_dump()
            for c in corridors
        ],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/analytics/user-risk-profile/{user_id}")
def user_risk_profile(user_id: str):
    """Return a rolling 30-day risk profile for a user (deterministic synthetic)."""
    seed = int(hashlib.md5(user_id.encode()).hexdigest(), 16) % 10000
    rng = random.Random(seed)
    tx_count = rng.randint(3, 45)
    avg_amount = rng.uniform(200, 2000)
    fraud_score_avg = rng.uniform(0.05, 0.35)
    velocity_peak = rng.randint(1, 8)
    countries = rng.sample(["US", "GB", "NG", "KE", "GH", "CA", "AU"], k=rng.randint(1, 3))
    return {
        "user_id": user_id,
        "period_days": 30,
        "transaction_count": tx_count,
        "avg_amount_usd": round(avg_amount, 2),
        "total_volume_usd": round(avg_amount * tx_count, 2),
        "avg_fraud_score": round(fraud_score_avg, 4),
        "risk_tier": "HIGH" if fraud_score_avg > 0.25 else "MEDIUM" if fraud_score_avg > 0.12 else "LOW",
        "peak_velocity_1h": velocity_peak,
        "countries_used": countries,
        "flagged_transactions": rng.randint(0, max(1, int(tx_count * 0.05))),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/retrain")
def retrain_model():
    """Trigger model retraining (admin endpoint)."""
    global model, explainer, _clf, _scaler
    model = train_model()
    _clf = model.named_steps["clf"]
    _scaler = model.named_steps["scaler"]
    explainer = shap.TreeExplainer(_clf)
    return {"status": "retrained", "model": "rf-v1.0", "timestamp": datetime.now(timezone.utc).isoformat()}


# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8082"))
    logger.info(f"RemitFlow Fraud ML Service starting on :{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
