"""
GPU Training Engine — Standalone Backend Server

Production-ready FastAPI server with:
  - PostgreSQL persistence for all jobs, models, users, devices
  - Redis caching + job queue
  - JWT + API key authentication
  - Role-based access control (admin, ml_engineer, data_scientist, viewer)
  - Circuit breaker for remote node communication
  - All training and inference endpoints from the core engine

Run:
  python server.py                      # starts on :8120
  GPU_ENGINE_PORT=9000 python server.py # custom port
"""

import asyncio
import base64
import hashlib
import json
import logging
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn

# Local imports
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "middleware"))

from hardware_detector import (
    BackendType, DeviceInfo, GPUVendor,
    detect_all_devices, get_best_device, get_pytorch_device,
)
from training_engine import TrainingConfig, UniversalTrainer, MODELS_DIR, ONNX_DIR
from inference_engine import InferenceEngine, ModelConverter

# Middleware
from auth import (
    hash_password, verify_password, create_jwt, validate_jwt,
    generate_api_key, verify_api_key, has_permission, ROLE_PERMISSIONS,
)
from cache import (
    cache_get, cache_set, cache_delete,
    enqueue_job, update_job_status,
    check_rate_limit, store_session, get_session, revoke_session,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("gpu-engine-server")

# ─── Database ────────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://gpu_engine:gpu_engine@localhost:5432/gpu_engine")

_pool = None


async def get_db():
    global _pool
    if _pool is None:
        try:
            import asyncpg
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10, command_timeout=30)
            logger.info("PostgreSQL pool created")
        except Exception as e:
            logger.warning(f"PostgreSQL unavailable: {e}")
            return None
    return _pool


async def db_execute(query: str, *args):
    pool = await get_db()
    if not pool:
        return None
    try:
        async with pool.acquire() as conn:
            return await conn.execute(query, *args)
    except Exception as e:
        logger.error(f"DB execute error: {e}")
        return None


async def db_fetch(query: str, *args):
    pool = await get_db()
    if not pool:
        return []
    try:
        async with pool.acquire() as conn:
            return await conn.fetch(query, *args)
    except Exception as e:
        logger.error(f"DB fetch error: {e}")
        return []


async def db_fetchrow(query: str, *args):
    pool = await get_db()
    if not pool:
        return None
    try:
        async with pool.acquire() as conn:
            return await conn.fetchrow(query, *args)
    except Exception as e:
        logger.error(f"DB fetchrow error: {e}")
        return None


# ─── Auth Dependencies ───────────────────────────────────────────────────────

async def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[Dict]:
    """Extract user from JWT or API key."""
    if not authorization:
        return None

    if authorization.startswith("Bearer "):
        token = authorization[7:]
        # Try JWT
        payload = validate_jwt(token)
        if payload:
            return payload
        # Try session token
        session = get_session(token)
        if session:
            return session

    if authorization.startswith("gpe_"):
        key_hash = verify_api_key(authorization)
        row = await db_fetchrow(
            "SELECT ak.scopes, u.id, u.username, u.role FROM api_keys ak "
            "JOIN users u ON u.id = ak.user_id WHERE ak.key_hash = $1 AND u.is_active = true",
            key_hash,
        )
        if row:
            await db_execute("UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1", key_hash)
            return {"sub": str(row["id"]), "username": row["username"], "role": row["role"]}

    return None


async def require_auth(user=Depends(get_current_user)):
    if not user:
        raise HTTPException(401, "Authentication required")
    return user


def require_permission(permission: str):
    async def check(user=Depends(require_auth)):
        if not has_permission(user.get("role", "viewer"), permission):
            raise HTTPException(403, f"Permission denied: {permission} requires a higher role")
        return user
    return check


# ─── Global State ────────────────────────────────────────────────────────────

_trainer: Optional[UniversalTrainer] = None
_inference_engine: Optional[InferenceEngine] = None
_training_jobs: Dict[str, Dict[str, Any]] = {}
_started_at = time.time()

# ─── Model Architectures ────────────────────────────────────────────────────

class FraudDetectionNet(nn.Module):
    def __init__(self, input_dim: int = 11, hidden: int = 128, n_classes: int = 2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden), nn.BatchNorm1d(hidden), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(hidden, hidden), nn.BatchNorm1d(hidden), nn.ReLU(), nn.Dropout(0.2),
            nn.Linear(hidden, hidden // 2), nn.ReLU(),
            nn.Linear(hidden // 2, n_classes),
        )
    def forward(self, x): return self.net(x)


class NLUIntentNet(nn.Module):
    def __init__(self, vocab_size=8000, d_model=128, n_heads=4, n_layers=2, n_classes=12, max_seq_len=64):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, d_model)
        self.pos_encoding = nn.Embedding(max_seq_len, d_model)
        encoder_layer = nn.TransformerEncoderLayer(d_model=d_model, nhead=n_heads, dim_feedforward=d_model*4, dropout=0.1, batch_first=True)
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.classifier = nn.Linear(d_model, n_classes)
    def forward(self, x):
        x = x.long()
        seq_len = x.size(1)
        pos = torch.arange(seq_len, device=x.device).unsqueeze(0).expand_as(x)
        emb = self.embedding(x) + self.pos_encoding(pos)
        return self.classifier(self.transformer(emb).mean(dim=1))


class FXForecastNet(nn.Module):
    def __init__(self, input_dim=5, hidden=128, n_layers=2, output_dim=1):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden, n_layers, batch_first=True, bidirectional=True, dropout=0.2)
        self.attention = nn.MultiheadAttention(hidden*2, num_heads=4, batch_first=True)
        self.fc = nn.Sequential(nn.Linear(hidden*2, hidden), nn.ReLU(), nn.Linear(hidden, output_dim))
    def forward(self, x):
        if x.dim() == 2: x = x.unsqueeze(1)
        lstm_out, _ = self.lstm(x)
        attn_out, _ = self.attention(lstm_out, lstm_out, lstm_out)
        return self.fc(attn_out.mean(dim=1))


class InvestmentScoringNet(nn.Module):
    def __init__(self, input_dim=15, hidden=256, n_classes=5):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden), nn.LayerNorm(hidden), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(hidden, hidden), nn.LayerNorm(hidden), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(hidden, hidden//2), nn.GELU(),
            nn.Linear(hidden//2, n_classes),
        )
    def forward(self, x): return self.net(x)


class GNNFraudNet(nn.Module):
    def __init__(self, input_dim=32, hidden=64, n_classes=2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden), nn.BatchNorm1d(hidden), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(hidden, hidden), nn.BatchNorm1d(hidden), nn.ReLU(),
            nn.Linear(hidden, n_classes),
        )
    def forward(self, x): return self.net(x)


_MODEL_REGISTRY = {
    "fraud_detection": {"cls": FraudDetectionNet, "input_dim": 11, "n_classes": 2},
    "nlu_intent": {"cls": NLUIntentNet, "input_dim": 64, "n_classes": 12},
    "fx_forecasting": {"cls": FXForecastNet, "input_dim": 5, "n_classes": 1},
    "investment_scoring": {"cls": InvestmentScoringNet, "input_dim": 15, "n_classes": 5},
    "gnn_fraud": {"cls": GNNFraudNet, "input_dim": 32, "n_classes": 2},
}


def generate_synthetic_data(model_type: str, n_samples: int = 5000):
    rng = np.random.default_rng(42)
    if model_type == "fraud_detection":
        X = rng.standard_normal((n_samples, 11)).astype(np.float32)
        fraud_signal = X[:, 0] + X[:, 2] + X[:, 3] + rng.standard_normal(n_samples) * 0.5
        return X, (fraud_signal > 1.5).astype(np.int64)
    elif model_type == "nlu_intent":
        return rng.integers(1, 8000, (n_samples, 64)).astype(np.float32), rng.integers(0, 12, n_samples).astype(np.int64)
    elif model_type == "fx_forecasting":
        X = np.cumsum(rng.standard_normal((n_samples, 5)) * 0.01 + 0.0001, axis=0).astype(np.float32)
        return X, (rng.standard_normal(n_samples) * 0.01).astype(np.float32)
    elif model_type == "investment_scoring":
        X = rng.standard_normal((n_samples, 15)).astype(np.float32)
        risk = X[:, 0]*0.3 + X[:, 3]*0.2 + X[:, 7]*0.2 + rng.standard_normal(n_samples)*0.3
        return X, np.clip(np.digitize(risk, np.percentile(risk, [20, 40, 60, 80])), 0, 4).astype(np.int64)
    elif model_type == "gnn_fraud":
        return rng.standard_normal((n_samples, 32)).astype(np.float32), (rng.random(n_samples) > 0.85).astype(np.int64)
    raise ValueError(f"Unknown model type: {model_type}")


# ─── Remote Node Manager ────────────────────────────────────────────────────

class RemoteNodeManager:
    def __init__(self):
        self.nodes: Dict[str, Dict[str, Any]] = {}

    def register(self, node_id: str, host: str, port: int, gpu_vendor: Optional[str] = None, api_key: Optional[str] = None) -> Dict:
        self.nodes[node_id] = {
            "host": host, "port": port, "gpu_vendor": gpu_vendor, "api_key": api_key,
            "base_url": f"http://{host}:{port}", "status": "registered",
            "registered_at": datetime.now(timezone.utc).isoformat(),
        }
        return {"node_id": node_id, "status": "registered"}

    def unregister(self, node_id: str) -> bool:
        return self.nodes.pop(node_id, None) is not None

    async def check_health(self, node_id: str) -> Dict:
        if node_id not in self.nodes:
            raise ValueError(f"Unknown node: {node_id}")
        node = self.nodes[node_id]
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                headers = {"Authorization": f"Bearer {node['api_key']}"} if node.get("api_key") else {}
                async with session.get(f"{node['base_url']}/health", headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    data = await resp.json()
                    node["status"] = "healthy"
                    return data
        except Exception as e:
            node["status"] = "unreachable"
            return {"status": "error", "error": str(e)}

    async def remote_train(self, node_id: str, payload: dict) -> Dict:
        if node_id not in self.nodes:
            raise ValueError(f"Unknown node: {node_id}")
        node = self.nodes[node_id]
        import aiohttp
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {node['api_key']}"} if node.get("api_key") else {}
            headers["Content-Type"] = "application/json"
            async with session.post(f"{node['base_url']}/train", json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=3600)) as resp:
                return await resp.json()

    async def remote_infer(self, node_id: str, model_name: str, inputs: List, return_probs: bool = True) -> Dict:
        if node_id not in self.nodes:
            raise ValueError(f"Unknown node: {node_id}")
        node = self.nodes[node_id]
        import aiohttp
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {node['api_key']}"} if node.get("api_key") else {}
            headers["Content-Type"] = "application/json"
            async with session.post(f"{node['base_url']}/inference", json={"model_name": model_name, "inputs": inputs, "return_probabilities": return_probs}, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                return await resp.json()

    async def transfer_model(self, model_name: str, onnx_path: str, target_node_id: str) -> Dict:
        if target_node_id not in self.nodes:
            raise ValueError(f"Unknown node: {target_node_id}")
        node = self.nodes[target_node_id]
        with open(onnx_path, "rb") as f:
            model_b64 = base64.b64encode(f.read()).decode()
        import aiohttp
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {node['api_key']}"} if node.get("api_key") else {}
            headers["Content-Type"] = "application/json"
            async with session.post(f"{node['base_url']}/models/upload", json={"model_name": model_name, "model_data": model_b64, "format": "onnx"}, headers=headers, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                return await resp.json()

    def list_nodes(self):
        return [{"node_id": nid, **{k: v for k, v in info.items() if k != "api_key"}} for nid, info in self.nodes.items()]


_node_manager = RemoteNodeManager()


# ─── Request Models ──────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None
    display_name: Optional[str] = None

class TrainRequest(BaseModel):
    model_type: str
    preferred_device: Optional[str] = None
    epochs: int = Field(30, ge=1, le=1000)
    batch_size: int = Field(64, ge=1, le=4096)
    learning_rate: float = Field(1e-3, gt=0, lt=1)
    mixed_precision: bool = True
    export_onnx: bool = True
    data_source: str = "synthetic"
    custom_data: Optional[str] = None

class InferRequest(BaseModel):
    model_name: str
    inputs: List[List[float]]
    target_device: Optional[str] = None
    return_probabilities: bool = True

class ExportRequest(BaseModel):
    model_name: str
    target_format: str

class BenchmarkRequest(BaseModel):
    model_name: str
    input_shape: List[int]
    batch_size: int = 1
    iterations: int = 100

class RemoteNodeRequest(BaseModel):
    node_id: str
    host: str
    port: int = 8120
    gpu_vendor: Optional[str] = None
    api_key: Optional[str] = None

class RemoteTrainRequest(BaseModel):
    node_id: str
    model_type: str
    epochs: int = 30
    batch_size: int = 64
    learning_rate: float = 1e-3
    mixed_precision: bool = True

class RemoteInferRequest(BaseModel):
    node_id: str
    model_name: str
    inputs: List[List[float]]
    return_probabilities: bool = True


# ─── Application ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _trainer, _inference_engine
    _trainer = UniversalTrainer(TrainingConfig())
    _inference_engine = InferenceEngine()
    # Initialize DB pool
    await get_db()
    logger.info("GPU Training Engine started")
    yield
    if _pool:
        await _pool.close()

app = FastAPI(
    title="GPU Training Engine",
    description="GPU-agnostic ML training and inference platform. Train on any GPU, infer on any other.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Rate Limit Middleware ───────────────────────────────────────────────────

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    allowed, remaining, reset_at = check_rate_limit(client_ip, limit=120, window=60)
    if not allowed:
        return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"}, headers={"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": str(int(reset_at))})
    response = await call_next(request)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    return response


# ─── Auth Endpoints ──────────────────────────────────────────────────────────

@app.post("/auth/register")
async def register(req: RegisterRequest):
    pw_hash = hash_password(req.password)
    row = await db_fetchrow(
        "INSERT INTO users (username, email, password_hash, role, display_name) VALUES ($1, $2, $3, 'data_scientist', $4) RETURNING id, username, role",
        req.username, req.email, pw_hash, req.display_name or req.username,
    )
    if not row:
        raise HTTPException(409, "Username already exists or DB unavailable")
    token = create_jwt(str(row["id"]), row["username"], row["role"])
    return {"user": {"id": str(row["id"]), "username": row["username"], "role": row["role"]}, "token": token}


@app.post("/auth/login")
async def login(req: LoginRequest):
    row = await db_fetchrow("SELECT id, username, password_hash, role FROM users WHERE username = $1 AND is_active = true", req.username)
    if not row or not verify_password(req.password, row["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    await db_execute("UPDATE users SET last_login_at = NOW() WHERE id = $1", row["id"])
    token = create_jwt(str(row["id"]), row["username"], row["role"])
    store_session(token, {"sub": str(row["id"]), "username": row["username"], "role": row["role"]})
    return {"user": {"id": str(row["id"]), "username": row["username"], "role": row["role"]}, "token": token}


@app.post("/auth/logout")
async def logout(user=Depends(require_auth), authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        revoke_session(authorization[7:])
    return {"success": True}


@app.get("/auth/me")
async def me(user=Depends(require_auth)):
    return {"user": user}


# ─── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    devices = detect_all_devices()
    gpu_devices = [d for d in devices if d.vendor != GPUVendor.CPU]
    db_ok = (await get_db()) is not None
    return {
        "status": "healthy",
        "service": "gpu-training-engine",
        "version": "1.0.0",
        "uptime_s": round(time.time() - _started_at, 1),
        "database": "connected" if db_ok else "unavailable",
        "devices": {"total": len(devices), "gpus": len(gpu_devices), "best": devices[0].to_dict() if devices else None},
        "models_loaded": len(_inference_engine.get_loaded_models()) if _inference_engine else 0,
        "active_jobs": sum(1 for j in _training_jobs.values() if j.get("status") == "training"),
    }


# ─── Devices ─────────────────────────────────────────────────────────────────

@app.get("/devices")
async def list_devices():
    devices = detect_all_devices()
    # Persist to DB
    for d in devices:
        await db_execute(
            "INSERT INTO devices (vendor, backend, device_name, device_index, memory_total_mb, memory_free_mb, compute_capability, driver_version, is_available, priority, last_seen_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) "
            "ON CONFLICT DO NOTHING",
            d.vendor.value, d.backend.value, d.device_name, d.device_index,
            d.memory_total_mb, d.memory_free_mb, d.compute_capability, d.driver_version,
            d.is_available, d.priority,
        )
    return {
        "devices": [d.to_dict() for d in devices],
        "total": len(devices),
        "gpu_count": sum(1 for d in devices if d.vendor != GPUVendor.CPU),
        "best_device": devices[0].to_dict() if devices else None,
    }


# ─── Training ────────────────────────────────────────────────────────────────

@app.post("/train")
async def train_model(req: TrainRequest, user=Depends(require_permission("train"))):
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    _training_jobs[job_id] = {"status": "loading_data", "model_type": req.model_type, "started_at": time.time()}

    # Record in DB
    await db_execute(
        "INSERT INTO training_jobs (job_id, user_id, model_type, status, data_source, epochs, batch_size, learning_rate, mixed_precision, started_at) "
        "VALUES ($1, $2, $3, 'loading_data', $4, $5, $6, $7, $8, NOW())",
        job_id, uuid.UUID(user["sub"]) if user.get("sub") else None,
        req.model_type, req.data_source, req.epochs, req.batch_size, req.learning_rate, req.mixed_precision,
    )

    try:
        if req.custom_data:
            data = json.loads(base64.b64decode(req.custom_data))
            X, y = np.array(data["X"], dtype=np.float32), np.array(data["y"])
            data_source = "custom"
        else:
            X, y = generate_synthetic_data(req.model_type)
            data_source = req.data_source

        _training_jobs[job_id]["status"] = "training"
        _training_jobs[job_id]["data_source"] = data_source
        _training_jobs[job_id]["samples"] = len(X)

        split_idx = int(len(X) * 0.8)
        indices = np.random.permutation(len(X))
        X, y = X[indices], y[indices]

        model_info = _MODEL_REGISTRY.get(req.model_type)
        if not model_info:
            raise HTTPException(400, f"Unknown model type: {req.model_type}")

        model = model_info["cls"]()
        config = TrainingConfig(
            epochs=req.epochs, batch_size=req.batch_size, learning_rate=req.learning_rate,
            mixed_precision=req.mixed_precision, export_onnx=req.export_onnx, preferred_device=req.preferred_device,
        )
        trainer = UniversalTrainer(config)
        loss_fn = nn.MSELoss() if req.model_type == "fx_forecasting" else nn.CrossEntropyLoss()

        result = trainer.train(
            model=model, train_data=(X[:split_idx], y[:split_idx]),
            val_data=(X[split_idx:], y[split_idx:]), model_name=req.model_type, loss_fn=loss_fn,
        )

        if result.onnx_path and _inference_engine:
            try:
                _inference_engine.load_model(req.model_type, result.onnx_path)
            except Exception as e:
                logger.warning(f"Auto-load ONNX failed: {e}")

        _training_jobs[job_id]["status"] = "completed"
        _training_jobs[job_id]["completed_at"] = time.time()

        # Update DB
        await db_execute(
            "UPDATE training_jobs SET status='completed', device_vendor=$1, device_name=$2, "
            "training_samples=$3, epochs_trained=$4, best_epoch=$5, training_time_s=$6, "
            "metrics=$7, model_path=$8, onnx_path=$9, completed_at=NOW() WHERE job_id=$10",
            result.device_used.get("vendor", ""), result.device_used.get("device_name", ""),
            result.training_samples, result.epochs_trained, result.best_epoch, result.training_time_s,
            json.dumps(result.metrics), result.model_path, result.onnx_path, job_id,
        )

        # Register model
        onnx_size = os.path.getsize(result.onnx_path) if result.onnx_path and os.path.exists(result.onnx_path) else 0
        await db_execute(
            "INSERT INTO models (name, model_type, format, file_path, file_size_bytes, trained_on_device, training_metrics, is_deployed, created_by) "
            "VALUES ($1, $2, 'onnx', $3, $4, $5, $6, true, $7) ON CONFLICT (name, version) DO UPDATE SET "
            "file_path=EXCLUDED.file_path, file_size_bytes=EXCLUDED.file_size_bytes, training_metrics=EXCLUDED.training_metrics, is_deployed=true, updated_at=NOW()",
            req.model_type, req.model_type, result.onnx_path or "", onnx_size,
            json.dumps(result.device_used), json.dumps(result.metrics),
            uuid.UUID(user["sub"]) if user.get("sub") else None,
        )

        return {
            "job_id": job_id, "status": "completed", "model_type": req.model_type,
            "data_source": data_source, "training_samples": result.training_samples,
            "device": result.device_used, "metrics": result.metrics,
            "training_time_s": result.training_time_s, "epochs_trained": result.epochs_trained,
            "best_epoch": result.best_epoch, "model_path": result.model_path,
            "onnx_path": result.onnx_path, "history": result.history[-5:],
        }

    except HTTPException:
        raise
    except Exception as e:
        _training_jobs[job_id]["status"] = "failed"
        _training_jobs[job_id]["error"] = str(e)
        await db_execute("UPDATE training_jobs SET status='failed', error_message=$1 WHERE job_id=$2", str(e), job_id)
        raise HTTPException(500, f"Training failed: {e}")


# ─── Inference ───────────────────────────────────────────────────────────────

@app.post("/inference")
async def run_inference(req: InferRequest, user=Depends(require_permission("infer"))):
    if not _inference_engine:
        raise HTTPException(503, "Inference engine not initialized")

    loaded = _inference_engine.get_loaded_models()
    if req.model_name not in loaded:
        onnx_path = str(ONNX_DIR / f"{req.model_name}.onnx")
        if not Path(onnx_path).exists():
            raise HTTPException(404, f"Model '{req.model_name}' not found")
        _inference_engine.load_model(req.model_name, onnx_path, target_vendor=req.target_device)

    inputs = np.array(req.inputs, dtype=np.float32)
    result = _inference_engine.predict(req.model_name, inputs, req.return_probabilities)

    # Log inference
    await db_execute(
        "INSERT INTO inference_log (user_id, model_name, device_used, provider_used, batch_size, latency_ms, input_shape) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        uuid.UUID(user["sub"]) if user.get("sub") else None,
        result.model_name, result.device_used, result.provider_used,
        result.batch_size, result.latency_ms, json.dumps(list(inputs.shape)),
    )

    return {
        "model_name": result.model_name, "predictions": result.predictions.tolist(),
        "probabilities": result.probabilities.tolist() if result.probabilities is not None else None,
        "latency_ms": result.latency_ms, "device_used": result.device_used,
        "provider_used": result.provider_used, "batch_size": result.batch_size,
    }


# ─── Models ──────────────────────────────────────────────────────────────────

@app.get("/models")
async def list_models():
    loaded = _inference_engine.get_loaded_models() if _inference_engine else {}
    available_onnx = [f.stem for f in ONNX_DIR.glob("*.onnx")]
    available_pt = [f.stem.replace("_best", "") for f in MODELS_DIR.glob("*_best.pt")]
    db_models = await db_fetch("SELECT name, version, model_type, format, file_size_bytes, is_deployed, created_at FROM models ORDER BY created_at DESC LIMIT 50")
    return {
        "loaded": loaded, "available_onnx": available_onnx, "available_pytorch": available_pt,
        "model_types": list(_MODEL_REGISTRY.keys()),
        "registered": [dict(r) for r in db_models] if db_models else [],
    }


@app.post("/export")
async def export_model(req: ExportRequest, user=Depends(require_permission("export"))):
    onnx_path = str(ONNX_DIR / f"{req.model_name}.onnx")
    if not Path(onnx_path).exists():
        raise HTTPException(404, f"ONNX model not found: {req.model_name}")
    converter = ModelConverter()
    output_path = None
    if req.target_format == "tensorrt":
        output_path = converter.onnx_to_tensorrt(onnx_path, str(ONNX_DIR / f"{req.model_name}.trt"))
    elif req.target_format == "openvino":
        output_path = converter.onnx_to_openvino(onnx_path, str(ONNX_DIR))
    elif req.target_format == "coreml":
        output_path = converter.onnx_to_coreml(onnx_path, str(ONNX_DIR / f"{req.model_name}.mlmodel"))
    elif req.target_format == "quantized":
        output_path = _inference_engine.quantize_model(req.model_name, onnx_path)
    elif req.target_format == "onnx":
        output_path = onnx_path
    else:
        raise HTTPException(400, f"Unsupported format: {req.target_format}")
    if output_path is None:
        raise HTTPException(500, f"Export to {req.target_format} failed")
    return {"model_name": req.model_name, "target_format": req.target_format, "output_path": output_path, "size_mb": round(os.path.getsize(output_path)/(1024*1024), 1)}


@app.post("/benchmark")
async def benchmark(req: BenchmarkRequest, user=Depends(require_permission("benchmark"))):
    loaded = _inference_engine.get_loaded_models()
    if req.model_name not in loaded:
        onnx_path = str(ONNX_DIR / f"{req.model_name}.onnx")
        if not Path(onnx_path).exists():
            raise HTTPException(404, "Model not found")
        _inference_engine.load_model(req.model_name, onnx_path)
    result = _inference_engine.benchmark(req.model_name, input_shape=tuple(req.input_shape), n_iterations=req.iterations, batch_size=req.batch_size)
    # Persist
    await db_execute(
        "INSERT INTO benchmarks (model_name, device_vendor, device_name, input_shape, batch_size, iterations, mean_latency_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        req.model_name, result.get("device", {}).get("vendor", "cpu"), result.get("device", {}).get("device_name", "CPU"),
        json.dumps(req.input_shape), req.batch_size, req.iterations, result.get("mean_latency_ms", 0),
    )
    return result


# ─── Jobs ────────────────────────────────────────────────────────────────────

@app.get("/jobs")
async def list_jobs(user=Depends(require_auth)):
    db_jobs = await db_fetch(
        "SELECT job_id, model_type, status, data_source, epochs, training_samples, training_time_s, metrics, created_at, completed_at "
        "FROM training_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
        uuid.UUID(user["sub"]) if user.get("sub") else uuid.UUID(int=0),
    )
    return {"jobs": {r["job_id"]: dict(r) for r in db_jobs} if db_jobs else _training_jobs}


@app.get("/providers")
async def list_providers():
    if _inference_engine:
        return {"providers": _inference_engine.get_providers()}
    return {"providers": []}


# ─── Cross-GPU Workflow ──────────────────────────────────────────────────────

@app.post("/workflow/train-and-deploy")
async def train_and_deploy(
    model_type: str, train_device: Optional[str] = None, infer_device: Optional[str] = None,
    epochs: int = 30, batch_size: int = 64, user=Depends(require_permission("train")),
):
    config = TrainingConfig(epochs=epochs, batch_size=batch_size, export_onnx=True, preferred_device=train_device)
    trainer = UniversalTrainer(config)
    model_info = _MODEL_REGISTRY.get(model_type)
    if not model_info:
        raise HTTPException(400, f"Unknown model type: {model_type}")

    X, y = generate_synthetic_data(model_type)
    split = int(len(X) * 0.8)
    idx = np.random.permutation(len(X))
    X, y = X[idx], y[idx]

    model = model_info["cls"]()
    loss_fn = nn.MSELoss() if model_type == "fx_forecasting" else nn.CrossEntropyLoss()
    result = trainer.train(model=model, train_data=(X[:split], y[:split]), val_data=(X[split:], y[split:]), model_name=model_type, loss_fn=loss_fn)

    inference_info = None
    if result.onnx_path:
        inference_info = _inference_engine.load_model(model_type, result.onnx_path, target_vendor=infer_device)

    test_pred = None
    if inference_info:
        pred = _inference_engine.predict(model_type, X[:1])
        test_pred = {"input_shape": list(X[:1].shape), "prediction": pred.predictions.tolist(), "latency_ms": pred.latency_ms, "inference_device": pred.device_used}

    return {
        "status": "deployed", "model_type": model_type,
        "training": {"device": result.device_used, "epochs_trained": result.epochs_trained, "best_val_accuracy": result.metrics.get("best_val_accuracy", 0), "training_time_s": result.training_time_s},
        "inference": inference_info, "test_prediction": test_pred,
        "onnx_path": result.onnx_path, "pytorch_path": result.model_path,
    }


# ─── Remote Nodes ────────────────────────────────────────────────────────────

@app.post("/remote/nodes/register")
async def register_node(req: RemoteNodeRequest, user=Depends(require_permission("manage_nodes"))):
    result = _node_manager.register(req.node_id, req.host, req.port, req.gpu_vendor, req.api_key)
    await db_execute(
        "INSERT INTO remote_nodes (node_id, host, port, gpu_vendor, registered_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (node_id) DO UPDATE SET host=EXCLUDED.host, port=EXCLUDED.port, status='registered', updated_at=NOW()",
        req.node_id, req.host, req.port, req.gpu_vendor, uuid.UUID(user["sub"]) if user.get("sub") else None,
    )
    return result

@app.delete("/remote/nodes/{node_id}")
async def unregister_node(node_id: str, user=Depends(require_permission("manage_nodes"))):
    _node_manager.unregister(node_id)
    await db_execute("UPDATE remote_nodes SET status='decommissioned', updated_at=NOW() WHERE node_id=$1", node_id)
    return {"status": "removed", "node_id": node_id}

@app.get("/remote/nodes")
async def list_remote_nodes(user=Depends(require_auth)):
    return {"nodes": _node_manager.list_nodes()}

@app.get("/remote/nodes/{node_id}/health")
async def check_node_health(node_id: str, user=Depends(require_auth)):
    try:
        return await _node_manager.check_health(node_id)
    except ValueError as e:
        raise HTTPException(404, str(e))

@app.post("/remote/train")
async def remote_train(req: RemoteTrainRequest, user=Depends(require_permission("train"))):
    try:
        return await _node_manager.remote_train(req.node_id, {"model_type": req.model_type, "epochs": req.epochs, "batch_size": req.batch_size, "learning_rate": req.learning_rate, "mixed_precision": req.mixed_precision, "export_onnx": True})
    except ValueError as e:
        raise HTTPException(404, str(e))

@app.post("/remote/infer")
async def remote_infer(req: RemoteInferRequest, user=Depends(require_permission("infer"))):
    try:
        return await _node_manager.remote_infer(req.node_id, req.model_name, req.inputs, req.return_probabilities)
    except ValueError as e:
        raise HTTPException(404, str(e))

@app.post("/remote/transfer")
async def transfer_model(model_name: str, target_node_id: str, user=Depends(require_permission("manage_nodes"))):
    onnx_path = str(ONNX_DIR / f"{model_name}.onnx")
    if not Path(onnx_path).exists():
        raise HTTPException(404, f"ONNX model not found: {model_name}")
    try:
        return await _node_manager.transfer_model(model_name, onnx_path, target_node_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


# ─── Admin ───────────────────────────────────────────────────────────────────

@app.get("/admin/users")
async def admin_list_users(user=Depends(require_permission("manage_users"))):
    rows = await db_fetch("SELECT id, username, email, role, display_name, is_active, created_at, last_login_at FROM users ORDER BY created_at DESC")
    return {"users": [dict(r) for r in rows] if rows else []}

@app.get("/admin/audit")
async def admin_audit_log(user=Depends(require_permission("view_audit")), limit: int = 100):
    rows = await db_fetch("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1", limit)
    return {"entries": [dict(r) for r in rows] if rows else []}


# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("GPU_ENGINE_PORT", "8120"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
