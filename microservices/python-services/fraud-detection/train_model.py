"""
RemitFlow Fraud Detection — Live ML Training Pipeline
======================================================
Replaces synthetic training data with real transaction history from the DB.
Supports on-demand retraining via CLI or HTTP /retrain endpoint.

Usage:
  python train_model.py                        # train from DB, save model
  python train_model.py --dry-run              # validate features without saving
  python train_model.py --source synthetic     # fall back to synthetic data
"""
import argparse
import json
import logging
import os
import pickle
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    classification_report,
    roc_auc_score,
    precision_score,
    recall_score,
    f1_score,
)
from sklearn.pipeline import Pipeline

# ─── Config ──────────────────────────────────────────────────────────────────
MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/app/models"))
MODEL_PATH = MODEL_DIR / "fraud_model.pkl"
SCALER_PATH = MODEL_DIR / "scaler.pkl"
METADATA_PATH = MODEL_DIR / "model_metadata.json"
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("fraud-training")

# ─── Feature Engineering ─────────────────────────────────────────────────────
FEATURE_COLUMNS = [
    "log_amount",
    "amount_vs_avg",
    "hour_of_day",
    "day_of_week",
    "is_weekend",
    "is_new_recipient",
    "velocity_1h",
    "velocity_24h",
    "velocity_7d",
    "is_round_number",
    "high_risk_dest",
    "cross_border",
    "amount_usd",
    "recipient_count_30d",
    "failed_tx_ratio_30d",
]

HIGH_RISK_COUNTRIES = {
    "IR", "KP", "SY", "CU", "VE", "MM", "BY", "RU", "AF", "YE", "LY", "SO",
}


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Transform raw transaction rows into ML feature vectors."""
    features = pd.DataFrame()

    # Amount features
    features["amount_usd"] = df["amount_usd"].fillna(0).clip(0, 1_000_000)
    features["log_amount"] = np.log1p(features["amount_usd"])
    user_avg = df.groupby("user_id")["amount_usd"].transform("mean").fillna(500)
    features["amount_vs_avg"] = (features["amount_usd"] / user_avg.clip(1)).clip(0, 100)

    # Time features
    created_at = pd.to_datetime(df.get("created_at", pd.Timestamp.now()), utc=True, errors="coerce")
    features["hour_of_day"] = created_at.dt.hour.fillna(12)
    features["day_of_week"] = created_at.dt.dayofweek.fillna(0)
    features["is_weekend"] = (features["day_of_week"] >= 5).astype(int)

    # Recipient features
    features["is_new_recipient"] = df.get("is_new_recipient", pd.Series(0, index=df.index)).fillna(0).astype(int)
    features["recipient_count_30d"] = df.get("recipient_count_30d", pd.Series(1, index=df.index)).fillna(1).clip(0, 50)

    # Velocity features
    features["velocity_1h"] = df.get("velocity_1h", pd.Series(1, index=df.index)).fillna(1).clip(0, 100)
    features["velocity_24h"] = df.get("velocity_24h", pd.Series(1, index=df.index)).fillna(1).clip(0, 500)
    features["velocity_7d"] = df.get("velocity_7d", pd.Series(3, index=df.index)).fillna(3).clip(0, 2000)

    # Risk indicators
    features["is_round_number"] = (features["amount_usd"] % 100 == 0).astype(int)
    dest_country = df.get("dest_country", pd.Series("US", index=df.index)).fillna("US")
    features["high_risk_dest"] = dest_country.isin(HIGH_RISK_COUNTRIES).astype(int)
    src_country = df.get("source_country", pd.Series("US", index=df.index)).fillna("US")
    features["cross_border"] = (src_country != dest_country).astype(int)

    # Historical failure rate
    features["failed_tx_ratio_30d"] = df.get("failed_tx_ratio_30d", pd.Series(0.02, index=df.index)).fillna(0.02).clip(0, 1)

    return features[FEATURE_COLUMNS].astype(float)


# ─── Data Sources ─────────────────────────────────────────────────────────────
def load_from_db() -> Optional[pd.DataFrame]:
    """Load transaction history from MySQL/TiDB."""
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("LOCAL_DATABASE_URL")
    if not db_url:
        logger.warning("DATABASE_URL not set — cannot load from DB")
        return None

    try:
        import pymysql
        from urllib.parse import urlparse

        u = urlparse(db_url)
        conn = pymysql.connect(
            host=u.hostname,
            port=u.port or 3306,
            user=u.username,
            password=u.password,
            database=u.path.lstrip("/"),
            ssl={"ssl": {}},
            connect_timeout=10,
        )
        query = """
            SELECT
                t.id,
                t.user_id,
                t.amount_usd,
                t.status,
                t.created_at,
                t.source_currency,
                t.dest_currency,
                t.source_country,
                t.dest_country,
                COALESCE(t.is_new_recipient, 0) AS is_new_recipient,
                -- Velocity: count of transactions by same user in last 1h
                (SELECT COUNT(*) FROM transactions t2
                 WHERE t2.user_id = t.user_id
                   AND t2.created_at >= DATE_SUB(t.created_at, INTERVAL 1 HOUR)
                   AND t2.id != t.id) AS velocity_1h,
                -- Velocity: last 24h
                (SELECT COUNT(*) FROM transactions t2
                 WHERE t2.user_id = t.user_id
                   AND t2.created_at >= DATE_SUB(t.created_at, INTERVAL 24 HOUR)
                   AND t2.id != t.id) AS velocity_24h,
                -- Velocity: last 7d
                (SELECT COUNT(*) FROM transactions t2
                 WHERE t2.user_id = t.user_id
                   AND t2.created_at >= DATE_SUB(t.created_at, INTERVAL 7 DAY)
                   AND t2.id != t.id) AS velocity_7d,
                -- Failed tx ratio in last 30d
                (SELECT COALESCE(SUM(t2.status = 'failed') / NULLIF(COUNT(*), 0), 0)
                 FROM transactions t2
                 WHERE t2.user_id = t.user_id
                   AND t2.created_at >= DATE_SUB(t.created_at, INTERVAL 30 DAY)) AS failed_tx_ratio_30d,
                -- Distinct recipient count in last 30d
                (SELECT COUNT(DISTINCT t2.recipient_id)
                 FROM transactions t2
                 WHERE t2.user_id = t.user_id
                   AND t2.created_at >= DATE_SUB(t.created_at, INTERVAL 30 DAY)) AS recipient_count_30d,
                -- Fraud label: flagged or manually reviewed as fraud
                COALESCE(t.is_fraud, 0) AS is_fraud
            FROM transactions t
            WHERE t.created_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)
            ORDER BY t.created_at DESC
            LIMIT 100000
        """
        df = pd.read_sql(query, conn)
        conn.close()
        logger.info(f"Loaded {len(df)} transactions from DB")
        return df
    except Exception as e:
        logger.warning(f"DB load failed: {e}")
        return None


def generate_synthetic_data(n_samples: int = 10_000) -> pd.DataFrame:
    """Generate realistic synthetic training data as fallback."""
    rng = np.random.default_rng(42)
    n_fraud = int(n_samples * 0.03)  # 3% fraud rate
    n_legit = n_samples - n_fraud

    def make_legit(n):
        return pd.DataFrame({
            "user_id": rng.integers(1, 5000, n),
            "amount_usd": rng.lognormal(5.5, 1.2, n).clip(10, 50_000),
            "created_at": pd.date_range("2025-01-01", periods=n, freq="1min"),
            "source_country": rng.choice(["US", "GB", "CA", "DE", "AU"], n),
            "dest_country": rng.choice(["NG", "GH", "KE", "ZA", "PH"], n),
            "is_new_recipient": rng.integers(0, 2, n),
            "velocity_1h": rng.integers(1, 5, n),
            "velocity_24h": rng.integers(1, 20, n),
            "velocity_7d": rng.integers(1, 80, n),
            "failed_tx_ratio_30d": rng.uniform(0, 0.1, n),
            "recipient_count_30d": rng.integers(1, 10, n),
            "is_fraud": np.zeros(n, dtype=int),
        })

    def make_fraud(n):
        return pd.DataFrame({
            "user_id": rng.integers(1, 5000, n),
            "amount_usd": rng.choice([
                rng.uniform(9000, 9999, n // 3),   # structuring
                rng.uniform(50000, 200000, n // 3), # large
                rng.uniform(100, 500, n - 2 * (n // 3)),  # small mule
            ], replace=False).flatten()[:n],
            "created_at": pd.date_range("2025-01-01", periods=n, freq="3min"),
            "source_country": rng.choice(["US", "GB"], n),
            "dest_country": rng.choice(["IR", "KP", "SY", "VE", "RU"], n),
            "is_new_recipient": np.ones(n, dtype=int),
            "velocity_1h": rng.integers(5, 30, n),
            "velocity_24h": rng.integers(20, 100, n),
            "velocity_7d": rng.integers(50, 300, n),
            "failed_tx_ratio_30d": rng.uniform(0.2, 0.8, n),
            "recipient_count_30d": rng.integers(5, 30, n),
            "is_fraud": np.ones(n, dtype=int),
        })

    df = pd.concat([make_legit(n_legit), make_fraud(n_fraud)], ignore_index=True)
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)
    logger.info(f"Generated {len(df)} synthetic samples ({n_fraud} fraud, {n_legit} legit)")
    return df


# ─── Training ─────────────────────────────────────────────────────────────────
def train(df: pd.DataFrame, dry_run: bool = False) -> dict:
    """Train the fraud detection ensemble and return evaluation metrics."""
    logger.info(f"Training on {len(df)} samples")

    X = engineer_features(df)
    y = df.get("is_fraud", pd.Series(0, index=df.index)).fillna(0).astype(int)

    fraud_count = y.sum()
    logger.info(f"Class distribution: {len(y) - fraud_count} legit, {fraud_count} fraud ({fraud_count/len(y)*100:.1f}%)")

    if dry_run:
        logger.info("Dry run — skipping model fit")
        return {"dry_run": True, "samples": len(df), "fraud_count": int(fraud_count)}

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # ── Anomaly detector (unsupervised) ──────────────────────────────────────
    iso = IsolationForest(
        n_estimators=200,
        contamination=max(0.01, fraud_count / len(y)),
        random_state=42,
        n_jobs=-1,
    )
    iso.fit(X_train)

    # ── Classifier (supervised) ───────────────────────────────────────────────
    # Compute class weights to handle imbalance
    class_weight = {0: 1, 1: max(10, (len(y) - fraud_count) / max(fraud_count, 1))}
    rf = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        min_samples_leaf=5,
        class_weight=class_weight,
        random_state=42,
        n_jobs=-1,
    )
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    rf.fit(X_train_scaled, y_train)

    # ── Evaluation ────────────────────────────────────────────────────────────
    y_pred = rf.predict(X_test_scaled)
    y_prob = rf.predict_proba(X_test_scaled)[:, 1]

    metrics = {
        "accuracy": float(rf.score(X_test_scaled, y_test)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, y_prob)) if fraud_count > 0 else 0.0,
        "training_samples": len(X_train),
        "test_samples": len(X_test),
        "fraud_rate": float(fraud_count / len(y)),
        "class_weight": class_weight,
    }
    logger.info(f"Metrics: accuracy={metrics['accuracy']:.3f}, AUC={metrics['roc_auc']:.3f}, recall={metrics['recall']:.3f}")

    # ── Save artifacts ────────────────────────────────────────────────────────
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump({"iso": iso, "rf": rf}, f)
    with open(SCALER_PATH, "wb") as f:
        pickle.dump(scaler, f)

    metadata = {
        "model_version": f"2.0.{int(time.time())}",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "algorithm": "IsolationForest + RandomForestClassifier (ensemble)",
        "features": FEATURE_COLUMNS,
        "metrics": metrics,
        "data_source": "live_db" if "created_at" in df.columns and len(df) > 1000 else "synthetic",
        "n_estimators_iso": 200,
        "n_estimators_rf": 300,
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f, indent=2)

    logger.info(f"Model saved to {MODEL_PATH}")
    return metadata


# ─── CLI ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RemitFlow Fraud Detection Training Pipeline")
    parser.add_argument("--source", choices=["db", "synthetic", "auto"], default="auto",
                        help="Data source: db (live DB), synthetic (generated), auto (DB with synthetic fallback)")
    parser.add_argument("--dry-run", action="store_true", help="Validate features without saving model")
    parser.add_argument("--min-samples", type=int, default=500,
                        help="Minimum DB samples required; fall back to synthetic if fewer")
    args = parser.parse_args()

    df = None
    if args.source in ("db", "auto"):
        df = load_from_db()
        if df is not None and len(df) < args.min_samples:
            logger.warning(f"Only {len(df)} DB samples — augmenting with synthetic data")
            synthetic = generate_synthetic_data(max(0, args.min_samples - len(df)))
            df = pd.concat([df, synthetic], ignore_index=True)

    if df is None or args.source == "synthetic":
        df = generate_synthetic_data()

    result = train(df, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))
