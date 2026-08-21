"""
RemitFlow — MLflow Model Registry & Experiment Tracking
Port: 8115

Central model registry for all RemitFlow ML models.
Provides model versioning, A/B testing, experiment tracking,
and deployment management.

Integrations:
  - MLflow (when available): experiment tracking backend
  - Local file-based registry (always available)
  - Kafka: model deployment events
  - Redis: model metadata cache

Endpoints:
  POST /register           — register a new model version
  GET  /models             — list all registered models
  GET  /models/{name}      — get model versions and metrics
  POST /promote            — promote model to production/staging
  POST /ab-test/create     — create A/B test between two versions
  POST /ab-test/record     — record A/B test outcome
  GET  /ab-test/{test_id}  — get A/B test results
  POST /compare            — compare two model versions
  GET  /health             — liveness probe
"""

import hmac
import json
import logging
import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
import signal
import atexit

def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[python-mlflow-registry] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value


_DB_URL = _require_env("DATABASE_URL")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS mlflow_registry_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_mlflow_registry_updated
                    ON mlflow_registry_state(updated_at);
                CREATE TABLE IF NOT EXISTS mlflow_registry_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_mlflow_registry_events_type
                    ON mlflow_registry_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO mlflow_registry_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM mlflow_registry_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM mlflow_registry_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO mlflow_registry_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("mlflow-registry")

PORT = int(os.getenv("PORT", "8115"))
REGISTRY_DIR = Path(os.getenv("REGISTRY_DIR", str(Path(__file__).parent / "registry")))
REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
REGISTRY_DB = REGISTRY_DIR / "registry.json"
EXPERIMENTS_DIR = REGISTRY_DIR / "experiments"
EXPERIMENTS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR = REGISTRY_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ─── Registry State ─────────────────────────────────────────────────────────

def _load_registry() -> Dict:
    if REGISTRY_DB.exists():
        with open(REGISTRY_DB) as f:
            return json.load(f)
    return {"models": {}, "ab_tests": {}, "experiments": {}}


def _save_registry(reg: Dict):
    with open(REGISTRY_DB, "w") as f:
        json.dump(reg, f, indent=2)


# ─── Models ──────────────────────────────────────────────────────────────────

class RegisterModelRequest(BaseModel):
    model_name: str
    version: str
    algorithm: str
    metrics: Dict[str, float]
    parameters: Optional[Dict[str, Any]] = None
    training_samples: Optional[int] = None
    artifact_path: Optional[str] = None
    stage: str = Field(default="staging", pattern="^(staging|production|archived)$")


class PromoteRequest(BaseModel):
    model_name: str
    version: str
    stage: str = Field(..., pattern="^(staging|production|archived)$")


class ABTestCreateRequest(BaseModel):
    test_name: str
    model_name: str
    version_a: str
    version_b: str
    traffic_split: float = Field(default=0.5, ge=0.0, le=1.0)


class ABTestRecordRequest(BaseModel):
    test_id: str
    version: str
    outcome: float  # e.g., fraud correctly detected = 1.0, missed = 0.0
    metadata: Optional[Dict[str, Any]] = None


class CompareRequest(BaseModel):
    model_name: str
    version_a: str
    version_b: str


# ─── FastAPI ─────────────────────────────────────────────────────────────────

app = FastAPI(title="RemitFlow Model Registry", version="1.0.0")

# ── Internal auth (fail-closed) ─────────────────────────────────────────
# Model-registry writes (/register, /promote, /ab-test/*) are model
# supply-chain operations and require this token. No default: if
# INTERNAL_API_TOKEN is unset these endpoints return 503.
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")


def require_internal_auth(x_internal_token: Optional[str] = Header(default=None)) -> None:
    if not INTERNAL_API_TOKEN:
        raise HTTPException(status_code=503, detail="INTERNAL_API_TOKEN is not configured; endpoint disabled")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, INTERNAL_API_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal API token")

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-mlflow-registry"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-mlflow-registry"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-mlflow-registry").info(f"Received signal {signum}, initiating graceful shutdown...")
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
        "service": "python-mlflow-registry",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-mlflow-registry").info("FastAPI shutdown event — cleaning up resources")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    reg = _load_registry()
    return {
        "status": "ok",
        "service": "mlflow-registry",
        "total_models": len(reg["models"]),
        "total_versions": sum(len(v["versions"]) for v in reg["models"].values()),
        "active_ab_tests": sum(1 for t in reg["ab_tests"].values() if t["status"] == "active"),
    }


@app.post("/register")
def register_model(req: RegisterModelRequest, _auth: None = Depends(require_internal_auth)):
    reg = _load_registry()

    if req.model_name not in reg["models"]:
        reg["models"][req.model_name] = {
            "name": req.model_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "versions": {},
            "production_version": None,
        }

    model_entry = reg["models"][req.model_name]
    version_key = req.version

    if version_key in model_entry["versions"]:
        raise HTTPException(409, f"Version {version_key} already exists for {req.model_name}")

    model_entry["versions"][version_key] = {
        "version": version_key,
        "algorithm": req.algorithm,
        "metrics": req.metrics,
        "parameters": req.parameters or {},
        "training_samples": req.training_samples,
        "artifact_path": req.artifact_path,
        "stage": req.stage,
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }

    if req.stage == "production":
        model_entry["production_version"] = version_key

    _save_registry(reg)
    logger.info(f"Registered {req.model_name} v{version_key} (stage={req.stage})")
    return {"status": "registered", "model_name": req.model_name, "version": version_key}


@app.get("/models")
def list_models():
    reg = _load_registry()
    return [
        {
            "name": name,
            "num_versions": len(m["versions"]),
            "production_version": m["production_version"],
            "created_at": m["created_at"],
        }
        for name, m in reg["models"].items()
    ]


@app.get("/models/{model_name}")
def get_model(model_name: str):
    reg = _load_registry()
    if model_name not in reg["models"]:
        raise HTTPException(404, f"Model {model_name} not found")
    return reg["models"][model_name]


@app.post("/promote")
def promote_model(req: PromoteRequest, _auth: None = Depends(require_internal_auth)):
    reg = _load_registry()
    if req.model_name not in reg["models"]:
        raise HTTPException(404, f"Model {req.model_name} not found")

    model = reg["models"][req.model_name]
    if req.version not in model["versions"]:
        raise HTTPException(404, f"Version {req.version} not found")

    # Archive old production version
    if req.stage == "production" and model["production_version"]:
        old = model["production_version"]
        if old in model["versions"]:
            model["versions"][old]["stage"] = "archived"

    model["versions"][req.version]["stage"] = req.stage
    if req.stage == "production":
        model["production_version"] = req.version

    _save_registry(reg)
    logger.info(f"Promoted {req.model_name} v{req.version} to {req.stage}")
    return {"status": "promoted", "model_name": req.model_name, "version": req.version, "stage": req.stage}


@app.post("/ab-test/create")
def create_ab_test(req: ABTestCreateRequest, _auth: None = Depends(require_internal_auth)):
    reg = _load_registry()

    if req.model_name not in reg["models"]:
        raise HTTPException(404, f"Model {req.model_name} not found")

    model = reg["models"][req.model_name]
    if req.version_a not in model["versions"] or req.version_b not in model["versions"]:
        raise HTTPException(404, "One or both versions not found")

    test_id = f"ab-{str(uuid.uuid4())[:8]}"
    reg["ab_tests"][test_id] = {
        "test_id": test_id,
        "test_name": req.test_name,
        "model_name": req.model_name,
        "version_a": req.version_a,
        "version_b": req.version_b,
        "traffic_split": req.traffic_split,
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "outcomes_a": [],
        "outcomes_b": [],
    }

    _save_registry(reg)
    logger.info(f"Created A/B test {test_id}: {req.version_a} vs {req.version_b}")
    return {"test_id": test_id, "status": "active"}


@app.post("/ab-test/record")
def record_ab_outcome(req: ABTestRecordRequest, _auth: None = Depends(require_internal_auth)):
    reg = _load_registry()

    if req.test_id not in reg["ab_tests"]:
        raise HTTPException(404, f"A/B test {req.test_id} not found")

    test = reg["ab_tests"][req.test_id]
    if test["status"] != "active":
        raise HTTPException(400, "Test is not active")

    if req.version == test["version_a"]:
        test["outcomes_a"].append({"outcome": req.outcome, "timestamp": datetime.now(timezone.utc).isoformat(), **(req.metadata or {})})
    elif req.version == test["version_b"]:
        test["outcomes_b"].append({"outcome": req.outcome, "timestamp": datetime.now(timezone.utc).isoformat(), **(req.metadata or {})})
    else:
        raise HTTPException(400, f"Version {req.version} not part of this test")

    _save_registry(reg)
    return {"status": "recorded", "test_id": req.test_id}


@app.get("/ab-test/{test_id}")
def get_ab_test(test_id: str):
    reg = _load_registry()
    if test_id not in reg["ab_tests"]:
        raise HTTPException(404, f"A/B test {test_id} not found")

    test = reg["ab_tests"][test_id]
    outcomes_a = [o["outcome"] for o in test["outcomes_a"]]
    outcomes_b = [o["outcome"] for o in test["outcomes_b"]]

    result = {
        **test,
        "summary": {
            "version_a": {
                "samples": len(outcomes_a),
                "mean": float(np.mean(outcomes_a)) if outcomes_a else 0,
                "std": float(np.std(outcomes_a)) if outcomes_a else 0,
            },
            "version_b": {
                "samples": len(outcomes_b),
                "mean": float(np.mean(outcomes_b)) if outcomes_b else 0,
                "std": float(np.std(outcomes_b)) if outcomes_b else 0,
            },
        },
    }

    # Statistical significance (two-sample z-test)
    if len(outcomes_a) >= 30 and len(outcomes_b) >= 30:
        mean_a, mean_b = np.mean(outcomes_a), np.mean(outcomes_b)
        var_a, var_b = np.var(outcomes_a), np.var(outcomes_b)
        se = np.sqrt(var_a / len(outcomes_a) + var_b / len(outcomes_b))
        z_score = (mean_b - mean_a) / max(se, 1e-8)
        # Approximate p-value from z-score
        p_value = 2 * (1 - 0.5 * (1 + np.sign(abs(z_score)) * (1 - np.exp(-2 * z_score**2 / np.pi))))
        p_value = max(0, min(1, p_value))
        result["summary"]["z_score"] = round(float(z_score), 4)
        result["summary"]["p_value"] = round(float(p_value), 4)
        result["summary"]["significant"] = p_value < 0.05
        result["summary"]["winner"] = test["version_b"] if z_score > 1.96 else (test["version_a"] if z_score < -1.96 else "inconclusive")

    return result


@app.post("/compare")
def compare_versions(req: CompareRequest):
    reg = _load_registry()
    if req.model_name not in reg["models"]:
        raise HTTPException(404, f"Model {req.model_name} not found")

    model = reg["models"][req.model_name]
    if req.version_a not in model["versions"] or req.version_b not in model["versions"]:
        raise HTTPException(404, "One or both versions not found")

    va = model["versions"][req.version_a]
    vb = model["versions"][req.version_b]

    comparison = {
        "model_name": req.model_name,
        "version_a": {"version": req.version_a, "metrics": va["metrics"], "algorithm": va["algorithm"]},
        "version_b": {"version": req.version_b, "metrics": vb["metrics"], "algorithm": vb["algorithm"]},
        "metric_deltas": {},
        "recommendation": "",
    }

    for metric in set(list(va["metrics"].keys()) + list(vb["metrics"].keys())):
        a_val = va["metrics"].get(metric, 0)
        b_val = vb["metrics"].get(metric, 0)
        comparison["metric_deltas"][metric] = {
            "a": a_val, "b": b_val, "delta": round(b_val - a_val, 6),
            "pct_change": round((b_val - a_val) / max(abs(a_val), 1e-8) * 100, 2),
        }

    # Recommend based on key metrics
    key_metrics = ["f1", "auc", "accuracy"]
    wins_b = 0
    for m in key_metrics:
        if m in comparison["metric_deltas"]:
            if comparison["metric_deltas"][m]["delta"] > 0:
                wins_b += 1

    if wins_b >= 2:
        comparison["recommendation"] = f"Promote {req.version_b} — better on {wins_b}/3 key metrics"
    elif wins_b == 0:
        comparison["recommendation"] = f"Keep {req.version_a} — better on all key metrics"
    else:
        comparison["recommendation"] = "Inconclusive — consider A/B test for definitive answer"

    return comparison


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
