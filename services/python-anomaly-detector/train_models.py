"""
Train anomaly detection models on sample transaction data.

Usage:
    python train_models.py

Generates trained model files in ./models/ directory:
    - isolation_forest.pkl (account takeover / velocity anomaly)
    - login_velocity.pkl (credential stuffing)
    - beneficiary_change.pkl (BEC detection)

Middleware-ready: in production, model training runs via Airflow DAG
(see airflow/dags/remitflow_fraud_model_retrain_v2.py) and stores
models in S3/GCS. This script generates local models for dev/testing.
"""
import json
import os
import pickle
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

try:
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler
except ImportError:
    print("Installing scikit-learn...")
    os.system(f"{sys.executable} -m pip install scikit-learn numpy")
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


def generate_sample_transactions(n_normal: int = 5000, n_anomalous: int = 200):
    """Generate synthetic transaction data for training."""
    rng = np.random.default_rng(42)

    # Normal transactions: regular amounts, consistent locations, business hours
    normal = {
        "amount": rng.lognormal(mean=4.0, sigma=1.2, size=n_normal),
        "hour_of_day": rng.normal(14, 4, size=n_normal).clip(0, 23),
        "velocity_1h": rng.poisson(2, size=n_normal),
        "velocity_24h": rng.poisson(8, size=n_normal),
        "distance_km": rng.exponential(50, size=n_normal),
        "device_change": rng.binomial(1, 0.05, size=n_normal),
        "new_beneficiary": rng.binomial(1, 0.1, size=n_normal),
        "amount_vs_avg": rng.normal(1.0, 0.3, size=n_normal).clip(0.1, 5),
    }

    # Anomalous: high amounts, unusual hours, rapid velocity, impossible travel
    anomalous = {
        "amount": rng.lognormal(mean=7.0, sigma=1.5, size=n_anomalous),
        "hour_of_day": rng.uniform(0, 6, size=n_anomalous),
        "velocity_1h": rng.poisson(15, size=n_anomalous),
        "velocity_24h": rng.poisson(50, size=n_anomalous),
        "distance_km": rng.uniform(5000, 15000, size=n_anomalous),
        "device_change": rng.binomial(1, 0.7, size=n_anomalous),
        "new_beneficiary": rng.binomial(1, 0.8, size=n_anomalous),
        "amount_vs_avg": rng.uniform(3, 20, size=n_anomalous),
    }

    features = list(normal.keys())
    X_normal = np.column_stack([normal[f] for f in features])
    X_anomalous = np.column_stack([anomalous[f] for f in features])

    return X_normal, X_anomalous, features


def train_isolation_forest():
    """Train the primary anomaly detection model."""
    print("Training Isolation Forest for account takeover detection...")
    X_normal, X_anomalous, features = generate_sample_transactions()

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_normal)

    model = IsolationForest(
        n_estimators=200,
        contamination=0.03,
        max_samples="auto",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_scaled)

    # Validate on anomalous data
    X_anom_scaled = scaler.transform(X_anomalous)
    normal_scores = model.decision_function(X_scaled)
    anomaly_scores = model.decision_function(X_anom_scaled)

    # Detection rate
    normal_detected = (model.predict(X_scaled) == -1).sum()
    anomaly_detected = (model.predict(X_anom_scaled) == -1).sum()
    detection_rate = anomaly_detected / len(X_anomalous)
    false_positive_rate = normal_detected / len(X_scaled)

    print(f"  Detection rate: {detection_rate:.1%}")
    print(f"  False positive rate: {false_positive_rate:.1%}")
    print(f"  Normal score range: [{normal_scores.min():.3f}, {normal_scores.max():.3f}]")
    print(f"  Anomaly score range: [{anomaly_scores.min():.3f}, {anomaly_scores.max():.3f}]")

    # Save model + scaler + metadata
    model_path = MODELS_DIR / "isolation_forest.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({
            "model": model,
            "scaler": scaler,
            "features": features,
            "trained_at": datetime.utcnow().isoformat(),
            "n_samples": len(X_scaled),
            "detection_rate": float(detection_rate),
            "false_positive_rate": float(false_positive_rate),
            "version": "1.0.0",
        }, f)
    print(f"  Saved to {model_path} ({model_path.stat().st_size / 1024:.1f} KB)")
    return detection_rate


def train_login_velocity_model():
    """Train model for credential stuffing detection."""
    print("Training login velocity model for credential stuffing detection...")
    rng = np.random.default_rng(123)

    # Normal login patterns
    n_normal = 3000
    normal_features = np.column_stack([
        rng.poisson(2, size=n_normal),        # logins_per_hour
        rng.binomial(1, 0.85, size=n_normal), # success_rate
        rng.poisson(1, size=n_normal),         # unique_accounts_per_ip
        rng.exponential(300, size=n_normal),   # seconds_between_logins
        rng.binomial(1, 0.02, size=n_normal),  # user_agent_changes
    ])

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(normal_features)

    model = IsolationForest(
        n_estimators=150,
        contamination=0.02,
        random_state=123,
    )
    model.fit(X_scaled)

    model_path = MODELS_DIR / "login_velocity.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({
            "model": model,
            "scaler": scaler,
            "features": ["logins_per_hour", "success_rate", "unique_accounts_per_ip",
                        "seconds_between_logins", "user_agent_changes"],
            "trained_at": datetime.utcnow().isoformat(),
            "version": "1.0.0",
        }, f)
    print(f"  Saved to {model_path} ({model_path.stat().st_size / 1024:.1f} KB)")


def train_beneficiary_change_model():
    """Train model for BEC (Business Email Compromise) detection."""
    print("Training beneficiary change model for BEC detection...")
    rng = np.random.default_rng(456)

    n_normal = 2000
    normal_features = np.column_stack([
        rng.poisson(0.5, size=n_normal),       # beneficiary_changes_7d
        rng.exponential(30, size=n_normal),     # days_since_last_change
        rng.lognormal(4, 1, size=n_normal),     # transfer_amount_after_change
        rng.binomial(1, 0.1, size=n_normal),    # is_new_country
        rng.exponential(365, size=n_normal),    # account_age_days
    ])

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(normal_features)

    model = IsolationForest(
        n_estimators=100,
        contamination=0.05,
        random_state=456,
    )
    model.fit(X_scaled)

    model_path = MODELS_DIR / "beneficiary_change.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({
            "model": model,
            "scaler": scaler,
            "features": ["beneficiary_changes_7d", "days_since_last_change",
                        "transfer_amount_after_change", "is_new_country", "account_age_days"],
            "trained_at": datetime.utcnow().isoformat(),
            "version": "1.0.0",
        }, f)
    print(f"  Saved to {model_path} ({model_path.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    print(f"RemitFlow ML Model Training — {datetime.utcnow().isoformat()}")
    print("=" * 60)

    detection_rate = train_isolation_forest()
    train_login_velocity_model()
    train_beneficiary_change_model()

    print("=" * 60)
    print(f"All models saved to {MODELS_DIR.absolute()}")
    print(f"Primary detection rate: {detection_rate:.1%}")
    print("Models are ready for use by the anomaly detector service.")
