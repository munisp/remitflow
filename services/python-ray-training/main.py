"""
RemitFlow — Ray Distributed Training Pipeline
Port: 8114

Orchestrates distributed model training with Ray + Lakehouse integration.
Manages the complete ML lifecycle: data loading → feature engineering →
distributed training → evaluation → model registry → deployment.

Integrations:
  - Ray: distributed compute for parallel training / hyperparameter tuning
  - Lakehouse (DeltaLake/Iceberg): data source and feature store
  - MLflow: experiment tracking and model registry
  - PostgreSQL: metadata store
  - Kafka: training event publishing

Endpoints:
  POST /submit-job         — submit a training job
  POST /hyperparameter-search — distributed HPO via Ray Tune
  GET  /jobs               — list all training jobs
  GET  /jobs/{job_id}      — get job status + metrics
  POST /lakehouse/ingest   — load data from lakehouse tables
  GET  /health             — liveness probe
"""

import asyncio
import hashlib
import json
import logging
import os
import pickle
import time
import uuid
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    IsolationForest,
    RandomForestClassifier,
)
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_squared_error,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

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
                CREATE TABLE IF NOT EXISTS ray_training_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_ray_training_updated
                    ON ray_training_state(updated_at);
                CREATE TABLE IF NOT EXISTS ray_training_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_ray_training_events_type
                    ON ray_training_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO ray_training_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM ray_training_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM ray_training_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ray_training_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("ray-training")

PORT = int(os.getenv("PORT", "8114"))
MODEL_DIR = Path(os.getenv("MODEL_DIR", str(Path(__file__).parent / "models")))
MODEL_DIR.mkdir(parents=True, exist_ok=True)
METADATA_PATH = MODEL_DIR / "pipeline_metadata.json"
LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://localhost:8020")
MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/remitflow")

# ─── Ray Initialization ─────────────────────────────────────────────────────

_ray_initialized = False

def ensure_ray():
    """Initialize Ray if available, otherwise fall back to local execution."""
    global _ray_initialized
    if _ray_initialized:
        return True
    try:
        import ray
        if not ray.is_initialized():
            ray.init(
                num_cpus=os.cpu_count() or 4,
                ignore_reinit_error=True,
                logging_level=logging.WARNING,
                _temp_dir=str(MODEL_DIR / "ray_tmp"),
            )
        _ray_initialized = True
        logger.info(f"Ray initialized: {ray.cluster_resources()}")
        return True
    except ImportError:
        logger.warning("Ray not available — using local ProcessPoolExecutor")
        return False
    except Exception as e:
        logger.warning(f"Ray init failed: {e} — using local fallback")
        return False


# ─── Job Management ──────────────────────────────────────────────────────────

class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TrainingJob:
    job_id: str
    model_name: str
    algorithm: str
    status: JobStatus
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    metrics: Optional[Dict[str, float]] = None
    config: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    model_path: Optional[str] = None


# _jobs — persisted to PostgreSQL table "ray_training_jobs" (see _db__jobs_* helpers)

class _DbJobs:
    """PostgreSQL-backed store replacing in-memory dict '_jobs'."""
    TABLE = "ray_training_jobs"

    def get(self, key: str) -> dict | None:
        row = _db_one(f"SELECT data FROM {self.TABLE} WHERE key = %s", (str(key),))
        return dict(row["data"]) if row else None

    def __getitem__(self, key: str) -> dict:
        val = self.get(str(key))
        if val is None:
            raise KeyError(key)
        return val

    def __setitem__(self, key: str, value) -> None:
        import json as _json
        _db_exec(
            f"""INSERT INTO {self.TABLE} (key, data, updated_at) VALUES (%s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
            (str(key), _json.dumps(value, default=str)),
        )

    def __contains__(self, key: str) -> bool:
        return self.get(str(key)) is not None

    def __delitem__(self, key: str) -> None:
        _db_exec(f"DELETE FROM {self.TABLE} WHERE key = %s", (str(key),))

    def keys(self):
        rows = _db_exec(f"SELECT key FROM {self.TABLE}")
        return [r["key"] for r in rows]

    def values(self):
        rows = _db_exec(f"SELECT data FROM {self.TABLE}")
        return [dict(r["data"]) for r in rows]

    def items(self):
        rows = _db_exec(f"SELECT key, data FROM {self.TABLE}")
        return [(r["key"], dict(r["data"])) for r in rows]

    def __len__(self) -> int:
        row = _db_one(f"SELECT COUNT(*) AS cnt FROM {self.TABLE}")
        return row["cnt"] if row else 0

    def pop(self, key: str, default=None):
        val = self.get(str(key))
        if val is not None:
            self.__delitem__(str(key))
            return val
        return default

    def update(self, d: dict) -> None:
        for k, v in d.items():
            self[k] = v

_jobs = _DbJobs()


# ─── Lakehouse Data Loader ───────────────────────────────────────────────────

class LakehouseLoader:
    """
    Load data from Lakehouse (DeltaLake/Iceberg tables).
    In production, this connects to the actual lakehouse via REST API or PyArrow.
    Falls back to synthetic data generation for training.
    """

    def __init__(self, lakehouse_url: str = LAKEHOUSE_URL):
        self.url = lakehouse_url
        self._connected = False

    async def connect(self):
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.url}/health", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                    if resp.status == 200:
                        self._connected = True
                        logger.info("Connected to Lakehouse")
        except Exception:
            logger.info("Lakehouse not available — using synthetic data")

    def load_transactions(self, days: int = 180, limit: int = 100000) -> Tuple[np.ndarray, np.ndarray]:
        """Load transaction data. Falls back to synthetic."""
        if self._connected:
            return self._load_from_lakehouse("transactions", days, limit)
        return self._generate_synthetic_transactions(min(limit, 20000))

    def load_investor_profiles(self, limit: int = 10000) -> Tuple[np.ndarray, np.ndarray]:
        """Load investor profiles. Falls back to synthetic."""
        if self._connected:
            return self._load_from_lakehouse("investor_profiles", 365, limit)
        return self._generate_synthetic_investors(min(limit, 5000))

    def load_fx_rates(self, corridors: List[str], days: int = 1000) -> Dict[str, np.ndarray]:
        """Load FX rate history."""
        if self._connected:
            return self._load_fx_from_lakehouse(corridors, days)
        return self._generate_synthetic_fx(corridors, days)

    def _load_from_lakehouse(self, table: str, days: int, limit: int) -> Tuple[np.ndarray, np.ndarray]:
        """Load training data from the lakehouse-etl or python-lakehouse-service via REST API."""
        import requests

        # Try lakehouse-etl service first (has Parquet + DuckDB)
        try:
            sql = f"""
                SELECT amount, currency, to_currency, status, risk_score,
                       destination_country, fee, exchange_rate, type, created_at
                FROM transactions
                ORDER BY created_at DESC
                LIMIT {limit}
            """
            resp = requests.post(
                f"{self.url}/query",
                json={"sql": sql, "limit": limit},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                rows = data.get("rows", [])
                if rows:
                    return self._rows_to_features(rows, table)
        except Exception as e:
            logger.warning(f"Lakehouse-etl query failed: {e}")

        # Fallback: try python-lakehouse-service (DuckDB)
        lakehouse_service = os.getenv("LAKEHOUSE_SERVICE_URL", "http://localhost:8101")
        try:
            resp = requests.post(
                f"{lakehouse_service}/api/v1/query",
                json={"sql": f"SELECT * FROM transactions LIMIT {limit}", "limit": limit},
                headers={"X-API-KEY": os.getenv("LAKEHOUSE_INTERNAL_API_KEY", "lakehouse-key-001")},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                rows = data.get("rows", [])
                if rows:
                    return self._rows_to_features(rows, table)
        except Exception as e:
            logger.warning(f"Lakehouse-service query failed: {e}")

        # If both fail, fall back to synthetic
        logger.info(f"Lakehouse unavailable for {table} — using synthetic data")
        if table == "investor_profiles":
            return self._generate_synthetic_investors(min(limit, 5000))
        return self._generate_synthetic_transactions(min(limit, 20000))

    def _rows_to_features(self, rows: List[Dict], table: str) -> Tuple[np.ndarray, np.ndarray]:
        """Convert lakehouse rows to numpy feature arrays for ML training."""
        if table == "investor_profiles":
            return self._generate_synthetic_investors(min(len(rows), 5000))

        rng = np.random.default_rng(42)
        n = len(rows)
        features = np.zeros((n, 15), dtype=np.float32)
        labels = np.zeros(n, dtype=np.int64)

        for i, row in enumerate(rows):
            amount = float(row.get("amount", 0) or 0)
            risk = float(row.get("risk_score", 0) or 0)
            fee = float(row.get("fee", 0) or 0)
            rate = float(row.get("exchange_rate", 1.0) or 1.0)
            status = str(row.get("status", "")).lower()

            # Label: 1 if high-risk or flagged
            labels[i] = 1 if (risk > 0.7 or status in ("flagged", "failed", "suspicious")) else 0

            created = row.get("created_at")
            hour = 12
            dow = 0
            if isinstance(created, str) and len(created) >= 13:
                try:
                    from datetime import datetime as dt
                    parsed = dt.fromisoformat(created.replace("Z", "+00:00"))
                    hour = parsed.hour
                    dow = parsed.weekday()
                except Exception:
                    pass

            country_risk = 0.5 if row.get("destination_country") in ("NG", "KE", "GH", "ZA") else 0.2
            is_new_beneficiary = 1 if rng.random() < 0.3 else 0
            velocity_1h = rng.uniform(0, 5)
            velocity_24h = rng.uniform(0, 10)

            features[i] = [
                np.log1p(amount),
                amount / 1000,
                np.sin(2 * np.pi * hour / 24),
                np.cos(2 * np.pi * hour / 24),
                dow,
                is_new_beneficiary,
                velocity_1h,
                velocity_1h / max(velocity_24h, 0.1),
                velocity_24h,
                1 if amount > 0 and amount % 1000 < 10 else 0,
                country_risk,
                1 if row.get("to_currency") and row.get("to_currency") != row.get("currency", "USD") else 0,
                risk,
                fee / max(amount, 1) if amount > 0 else 0,
                rate,
            ]

        logger.info(f"Loaded {n} rows from lakehouse: {int(labels.sum())} positive, {n - int(labels.sum())} negative")
        return features, labels

    def _load_fx_from_lakehouse(self, corridors: List[str], days: int) -> Dict[str, np.ndarray]:
        """Load FX rate history from lakehouse."""
        import requests
        data = {}
        for corridor in corridors:
            parts = corridor.split("/")
            if len(parts) != 2:
                continue
            from_c, to_c = parts
            try:
                resp = requests.post(
                    f"{self.url}/query",
                    json={"sql": f"SELECT rate FROM fx_rates_ts WHERE from_currency='{from_c}' AND to_currency='{to_c}' ORDER BY recorded_at DESC LIMIT {days}", "limit": days},
                    timeout=10,
                )
                if resp.status_code == 200:
                    rows = resp.json().get("rows", [])
                    if rows:
                        data[corridor] = np.array([float(r.get("rate", 1.0)) for r in rows], dtype=np.float32)
                        continue
            except Exception:
                pass
            # Synthetic fallback per corridor
            base = {"USD/NGN": 1620, "GBP/NGN": 2050, "EUR/NGN": 1780, "USD/KES": 129}.get(corridor, 100)
            rng = np.random.default_rng(hash(corridor) % (2**31))
            rates = [base]
            for _ in range(days - 1):
                rates.append(rates[-1] * (1 + rng.normal(0, 0.005)))
            data[corridor] = np.array(rates, dtype=np.float32)
        return data

    def _generate_synthetic_transactions(self, n: int) -> Tuple[np.ndarray, np.ndarray]:
        """Generate synthetic transaction data for fraud detection training."""
        rng = np.random.default_rng(42)
        fraud_rate = 0.03

        features = np.zeros((n, 15), dtype=np.float32)
        labels = np.zeros(n, dtype=np.int64)

        for i in range(n):
            is_fraud = rng.random() < fraud_rate
            labels[i] = 1 if is_fraud else 0

            if is_fraud:
                amount = rng.choice([
                    rng.uniform(900000, 999999),
                    rng.lognormal(10, 2),
                    rng.uniform(5000, 50000),
                ])
                hour = rng.choice([0, 1, 2, 3, 4, 22, 23])
                velocity = rng.uniform(5, 20)
                country_risk = rng.uniform(0.5, 1.0)
            else:
                amount = rng.lognormal(9, 1.5)
                hour = rng.integers(7, 21)
                velocity = rng.uniform(0, 3)
                country_risk = rng.uniform(0, 0.3)

            features[i] = [
                np.log1p(amount),
                amount / 1000,
                np.sin(2 * np.pi * hour / 24),
                np.cos(2 * np.pi * hour / 24),
                rng.integers(0, 7),  # day of week
                1 if rng.random() < (0.7 if is_fraud else 0.2) else 0,  # is_new_beneficiary
                velocity,
                velocity / max(rng.uniform(0.5, 3), 0.1),
                rng.uniform(0, 10),  # velocity_7d
                1 if amount % 1000 < 10 else 0,  # is_round_number
                country_risk,
                rng.integers(0, 2),  # cross_border
                rng.uniform(0, 1),  # device_trust_score
                rng.integers(0, 30),  # recipient_count_30d
                rng.uniform(0, 0.5),  # failed_tx_ratio
            ]

        return features, labels

    def _generate_synthetic_investors(self, n: int) -> Tuple[np.ndarray, np.ndarray]:
        """Generate investor profiles."""
        rng = np.random.default_rng(42)
        X = np.zeros((n, 25), dtype=np.float32)
        y = np.zeros(n, dtype=np.int64)
        for i in range(n):
            risk_pref = rng.beta(2, 3)
            X[i] = [
                rng.integers(22, 65), rng.lognormal(7.5, 0.8), rng.lognormal(7, 0.6),
                rng.lognormal(8, 1.5), rng.uniform(0, 20), risk_pref,
                rng.integers(0, 6), rng.uniform(0, 0.6), rng.uniform(0, 12),
                rng.integers(0, 2), rng.integers(0, 6), rng.lognormal(5, 1),
                rng.beta(2, 3), rng.beta(2, 2), rng.beta(3, 2), rng.uniform(1, 30),
                rng.normal(3.5, 2), rng.uniform(0.5, 8), rng.uniform(2, 25), rng.uniform(0.01, 0.15),
                rng.integers(0, 2), rng.integers(0, 2), rng.uniform(0.1, 0.4), rng.beta(5, 2), rng.uniform(1, 30),
            ]
            y[i] = 0 if risk_pref < 0.3 else (1 if risk_pref < 0.5 else (2 if risk_pref < 0.7 else 3))
        return X, y

    def _generate_synthetic_fx(self, corridors: List[str], days: int) -> Dict[str, np.ndarray]:
        """Generate synthetic FX rate series."""
        rng = np.random.default_rng(42)
        data = {}
        bases = {"USD/NGN": 1620, "GBP/NGN": 2050, "EUR/NGN": 1780, "USD/KES": 129}
        for c in corridors:
            base = bases.get(c, 100)
            rates = [base]
            for _ in range(days - 1):
                rates.append(rates[-1] * (1 + rng.normal(0, 0.005)))
            data[c] = np.array(rates, dtype=np.float32)
        return data


# ─── Training Workers ────────────────────────────────────────────────────────

def _train_fraud_model(config: Dict) -> Dict[str, Any]:
    """Train fraud detection model (runs in Ray worker or local process)."""
    loader = LakehouseLoader()
    X, y = loader.load_transactions(limit=config.get("samples", 20000))

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    algorithm = config.get("algorithm", "gradient_boosting")
    if algorithm == "random_forest":
        clf = RandomForestClassifier(
            n_estimators=config.get("n_estimators", 200),
            max_depth=config.get("max_depth", 12),
            min_samples_leaf=config.get("min_samples_leaf", 5),
            class_weight="balanced",
            random_state=42, n_jobs=-1,
        )
    elif algorithm == "gradient_boosting":
        clf = GradientBoostingClassifier(
            n_estimators=config.get("n_estimators", 200),
            max_depth=config.get("max_depth", 6),
            learning_rate=config.get("learning_rate", 0.1),
            subsample=config.get("subsample", 0.8),
            random_state=42,
        )
    else:
        clf = IsolationForest(contamination=0.03, random_state=42, n_jobs=-1)

    pipeline = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    y_proba = pipeline.predict_proba(X_test)[:, 1] if hasattr(clf, "predict_proba") else np.zeros(len(y_test))

    metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
    }
    try:
        metrics["auc"] = float(roc_auc_score(y_test, y_proba))
    except Exception:
        metrics["auc"] = 0.0

    # Cross-validation
    cv_scores = cross_val_score(pipeline, X, y, cv=5, scoring="f1")
    metrics["cv_f1_mean"] = float(cv_scores.mean())
    metrics["cv_f1_std"] = float(cv_scores.std())

    model_path = str(MODEL_DIR / f"fraud_model_{int(time.time())}.pkl")
    with open(model_path, "wb") as f:
        pickle.dump(pipeline, f)

    return {"metrics": metrics, "model_path": model_path, "algorithm": algorithm, "samples": len(X)}


def _hyperparameter_search(base_config: Dict) -> Dict[str, Any]:
    """Grid search over hyperparameters (Ray Tune style)."""
    param_grid = [
        {"n_estimators": 100, "max_depth": 4, "learning_rate": 0.05},
        {"n_estimators": 200, "max_depth": 6, "learning_rate": 0.1},
        {"n_estimators": 300, "max_depth": 8, "learning_rate": 0.05},
        {"n_estimators": 200, "max_depth": 10, "learning_rate": 0.01},
        {"n_estimators": 150, "max_depth": 6, "learning_rate": 0.15},
        {"n_estimators": 250, "max_depth": 5, "learning_rate": 0.08},
    ]

    best_result = None
    best_score = -1
    results = []

    for params in param_grid:
        config = {**base_config, **params}
        result = _train_fraud_model(config)
        score = result["metrics"]["f1"]
        results.append({"params": params, "f1": score, "auc": result["metrics"].get("auc", 0)})
        if score > best_score:
            best_score = score
            best_result = {**result, "best_params": params}

    best_result["all_trials"] = results
    return best_result


# ─── Background Training ────────────────────────────────────────────────────

_executor = ThreadPoolExecutor(max_workers=4)


async def _run_training_job(job_id: str, config: Dict):
    """Execute training job (Ray or local)."""
    job = _jobs[job_id]
    job.status = JobStatus.RUNNING
    job.started_at = datetime.now(timezone.utc).isoformat()

    try:
        use_ray = ensure_ray()
        task = config.get("task", "fraud_detection")

        if use_ray:
            import ray
            if task == "hyperparameter_search":
                remote_fn = ray.remote(_hyperparameter_search)
                result_ref = remote_fn.remote(config)
                result = await asyncio.get_event_loop().run_in_executor(None, lambda: ray.get(result_ref))
            else:
                remote_fn = ray.remote(_train_fraud_model)
                result_ref = remote_fn.remote(config)
                result = await asyncio.get_event_loop().run_in_executor(None, lambda: ray.get(result_ref))
        else:
            loop = asyncio.get_event_loop()
            if task == "hyperparameter_search":
                result = await loop.run_in_executor(_executor, _hyperparameter_search, config)
            else:
                result = await loop.run_in_executor(_executor, _train_fraud_model, config)

        job.status = JobStatus.COMPLETED
        job.metrics = result.get("metrics", {})
        job.model_path = result.get("model_path")
        job.completed_at = datetime.now(timezone.utc).isoformat()
        logger.info(f"Job {job_id} completed: {job.metrics}")

    except Exception as e:
        job.status = JobStatus.FAILED
        job.error = str(e)
        job.completed_at = datetime.now(timezone.utc).isoformat()
        logger.error(f"Job {job_id} failed: {e}")


# ─── FastAPI ─────────────────────────────────────────────────────────────────

app = FastAPI(title="RemitFlow Ray Training Pipeline", version="1.0.0")

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-ray-training"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-ray-training"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-ray-training").info(f"Received signal {signum}, initiating graceful shutdown...")
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
        "service": "python-ray-training",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-ray-training").info("FastAPI shutdown event — cleaning up resources")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_lakehouse = LakehouseLoader()


class SubmitJobRequest(BaseModel):
    model_name: str = "fraud_detection"
    algorithm: str = "gradient_boosting"
    task: str = "fraud_detection"
    samples: int = Field(default=20000, ge=1000)
    n_estimators: int = Field(default=200, ge=50)
    max_depth: int = Field(default=6, ge=2)
    learning_rate: float = Field(default=0.1, gt=0)


class HPORequest(BaseModel):
    model_name: str = "fraud_detection"
    base_samples: int = Field(default=20000, ge=1000)


@app.on_event("startup")
async def startup():
    await _lakehouse.connect()
    ensure_ray()
    logger.info("Ray Training Pipeline ready")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ray-training",
        "ray_initialized": _ray_initialized,
        "lakehouse_connected": _lakehouse._connected,
        "active_jobs": sum(1 for j in _jobs.values() if j.status == JobStatus.RUNNING),
    }


@app.post("/submit-job")
async def submit_job(req: SubmitJobRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())[:8]
    job = TrainingJob(
        job_id=job_id, model_name=req.model_name, algorithm=req.algorithm,
        status=JobStatus.PENDING, created_at=datetime.now(timezone.utc).isoformat(),
        config=req.dict(),
    )
    _jobs[job_id] = job
    background_tasks.add_task(_run_training_job, job_id, req.dict())
    return {"job_id": job_id, "status": "submitted"}


@app.post("/hyperparameter-search")
async def hpo_search(req: HPORequest, background_tasks: BackgroundTasks):
    job_id = f"hpo-{str(uuid.uuid4())[:6]}"
    config = {"task": "hyperparameter_search", "model_name": req.model_name, "samples": req.base_samples}
    job = TrainingJob(
        job_id=job_id, model_name=req.model_name, algorithm="hpo_search",
        status=JobStatus.PENDING, created_at=datetime.now(timezone.utc).isoformat(),
        config=config,
    )
    _jobs[job_id] = job
    background_tasks.add_task(_run_training_job, job_id, config)
    return {"job_id": job_id, "status": "submitted", "trials": 6}


@app.get("/jobs")
def list_jobs():
    return [asdict(j) for j in _jobs.values()]


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(404, "Job not found")
    return asdict(_jobs[job_id])


@app.post("/lakehouse/ingest")
async def lakehouse_ingest():
    """Test lakehouse connectivity and data loading."""
    try:
        X, y = _lakehouse.load_transactions(limit=1000)
        return {
            "status": "ok",
            "source": "lakehouse" if _lakehouse._connected else "synthetic",
            "samples": len(X),
            "features": X.shape[1],
            "fraud_rate": float(y.mean()),
        }
    except Exception as e:
        raise HTTPException(500, str(e))



def init_pg_tables():
    """Create PostgreSQL tables for persistent state."""
    try:
        _db_exec("""
            CREATE TABLE IF NOT EXISTS ray_training_jobs (
            key TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
    except Exception as e:
        print(f"[DB] Table init error: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
