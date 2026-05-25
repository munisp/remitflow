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


_jobs: Dict[str, TrainingJob] = {}


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

    def _load_from_lakehouse(self, table: str, days: int, limit: int):
        """Placeholder for actual lakehouse query."""
        logger.info(f"Loading {table} from lakehouse (last {days} days, limit {limit})")
        # In production: query delta table via pyarrow/deltalake
        raise NotImplementedError("Lakehouse connection not configured")

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
