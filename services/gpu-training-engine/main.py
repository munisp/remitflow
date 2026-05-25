"""
RemitFlow — GPU-Agnostic Training Engine Service

HTTP + gRPC service for remote/local GPU training and cross-device inference.

Architecture:
  ┌─────────────────────────────────────────────┐
  │       GPU Training Engine (port 8120)        │
  │                                              │
  │  ┌────────────┐  ┌────────────┐             │
  │  │  Hardware   │  │  Universal  │             │
  │  │  Detector   │  │  Trainer    │             │
  │  │  (all GPUs) │  │  (PyTorch)  │             │
  │  └────────────┘  └─────┬──────┘             │
  │                         │ ONNX export        │
  │  ┌────────────┐  ┌─────▼──────┐             │
  │  │  Remote     │  │  Inference  │             │
  │  │  Node Mgr   │  │  Engine     │             │
  │  │  (gRPC)     │  │  (ORT)      │             │
  │  └────────────┘  └────────────┘             │
  │                                              │
  │  Endpoints:                                  │
  │  POST /train        — train on local GPU     │
  │  POST /inference    — run inference           │
  │  POST /remote/train — dispatch to remote GPU  │
  │  POST /remote/infer — remote inference        │
  │  GET  /devices      — list all GPUs           │
  │  GET  /models       — list loaded models      │
  │  GET  /benchmark    — benchmark device         │
  │  POST /export       — export to target format │
  │  GET  /health       — health check            │
  └─────────────────────────────────────────────┘

Train-on-one-GPU, infer-on-another workflow:
  1. Train on NVIDIA (local) → saves .onnx
  2. Transfer .onnx to remote AMD machine
  3. Load .onnx on AMD via ROCm EP → inference
"""

import asyncio
import base64
import io
import json
import logging
import os
import sys
import time
import uuid
from concurrent import futures
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import uvicorn

# Add parent for shared modules
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "shared"))

from hardware_detector import (
    BackendType, DeviceInfo, GPUVendor,
    detect_all_devices, get_best_device, get_pytorch_device,
)
from training_engine import TrainingConfig, UniversalTrainer, MODELS_DIR, ONNX_DIR
from inference_engine import InferenceEngine, ModelConverter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("gpu-training-engine")

app = FastAPI(
    title="RemitFlow GPU-Agnostic Training Engine",
    description="Train on any GPU, infer on any other GPU — NVIDIA, AMD, Intel, Huawei, Apple, CPU",
    version="1.0.0",
)

# ─────────────────────────── Global state ───────────────────────────

_trainer: Optional[UniversalTrainer] = None
_inference_engine: Optional[InferenceEngine] = None
_remote_nodes: Dict[str, Dict[str, Any]] = {}
_training_jobs: Dict[str, Dict[str, Any]] = {}
_started_at = time.time()


# ─────────────────────────── Models ───────────────────────────

class TrainRequest(BaseModel):
    model_type: str = Field(..., description="Model type: fraud_detection, nlu_intent, fx_forecasting, investment_scoring, gnn_fraud, custom")
    preferred_device: Optional[str] = Field(None, description="Preferred GPU vendor: nvidia, amd, intel, huawei, apple, cpu")
    epochs: int = Field(30, ge=1, le=1000)
    batch_size: int = Field(64, ge=1, le=4096)
    learning_rate: float = Field(1e-3, gt=0, lt=1)
    mixed_precision: bool = True
    export_onnx: bool = True
    data_source: str = Field("synthetic", description="Data source: synthetic, platform_db, custom")
    custom_data: Optional[str] = Field(None, description="Base64-encoded numpy arrays {X, y} for custom data")


class InferRequest(BaseModel):
    model_name: str
    inputs: List[List[float]]
    target_device: Optional[str] = Field(None, description="Run inference on specific vendor")
    return_probabilities: bool = True


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


class ExportRequest(BaseModel):
    model_name: str
    target_format: str = Field(..., description="Target: onnx, tensorrt, openvino, coreml, quantized")
    input_shape: Optional[List[int]] = None


class BenchmarkRequest(BaseModel):
    model_name: str
    input_shape: List[int]
    batch_size: int = 1
    iterations: int = 100


# ─────────────────────────── Model Architectures ───────────────────────────

class FraudDetectionNet(nn.Module):
    """4-layer MLP for fraud detection (11 features → 2 classes)."""
    def __init__(self, input_dim: int = 11, hidden: int = 128, n_classes: int = 2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.BatchNorm1d(hidden),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden, hidden),
            nn.BatchNorm1d(hidden),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden, hidden // 2),
            nn.ReLU(),
            nn.Linear(hidden // 2, n_classes),
        )

    def forward(self, x):
        return self.net(x)


class NLUIntentNet(nn.Module):
    """Transformer-based intent classifier."""
    def __init__(self, vocab_size: int = 8000, d_model: int = 128, n_heads: int = 4,
                 n_layers: int = 2, n_classes: int = 12, max_seq_len: int = 64):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, d_model)
        self.pos_encoding = nn.Embedding(max_seq_len, d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=d_model * 4,
            dropout=0.1, batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.classifier = nn.Linear(d_model, n_classes)

    def forward(self, x):
        # x: (batch, seq_len) — token IDs as float, convert to long
        x = x.long()
        seq_len = x.size(1)
        pos = torch.arange(seq_len, device=x.device).unsqueeze(0).expand_as(x)
        emb = self.embedding(x) + self.pos_encoding(pos)
        encoded = self.transformer(emb)
        pooled = encoded.mean(dim=1)  # mean pooling
        return self.classifier(pooled)


class FXForecastNet(nn.Module):
    """LSTM + attention for FX rate prediction."""
    def __init__(self, input_dim: int = 5, hidden: int = 128, n_layers: int = 2, output_dim: int = 1):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden, n_layers, batch_first=True, bidirectional=True, dropout=0.2)
        self.attention = nn.MultiheadAttention(hidden * 2, num_heads=4, batch_first=True)
        self.fc = nn.Sequential(
            nn.Linear(hidden * 2, hidden),
            nn.ReLU(),
            nn.Linear(hidden, output_dim),
        )

    def forward(self, x):
        # x: (batch, seq_len, features) or (batch, features)
        if x.dim() == 2:
            x = x.unsqueeze(1)  # add seq dim
        lstm_out, _ = self.lstm(x)
        attn_out, _ = self.attention(lstm_out, lstm_out, lstm_out)
        pooled = attn_out.mean(dim=1)
        return self.fc(pooled)


class InvestmentScoringNet(nn.Module):
    """MLP for investment risk/return scoring."""
    def __init__(self, input_dim: int = 15, hidden: int = 256, n_classes: int = 5):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(hidden, hidden),
            nn.LayerNorm(hidden),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(hidden, hidden // 2),
            nn.GELU(),
            nn.Linear(hidden // 2, n_classes),
        )

    def forward(self, x):
        return self.net(x)


class GNNFraudNet(nn.Module):
    """GAT-style fraud detection (operates on flattened node features)."""
    def __init__(self, input_dim: int = 32, hidden: int = 64, n_classes: int = 2):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.BatchNorm1d(hidden),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden, hidden),
            nn.BatchNorm1d(hidden),
            nn.ReLU(),
            nn.Linear(hidden, n_classes),
        )

    def forward(self, x):
        return self.net(x)


# Model registry
_MODEL_REGISTRY = {
    "fraud_detection": {"cls": FraudDetectionNet, "input_dim": 11, "n_classes": 2},
    "nlu_intent": {"cls": NLUIntentNet, "input_dim": 64, "n_classes": 12},
    "fx_forecasting": {"cls": FXForecastNet, "input_dim": 5, "n_classes": 1},
    "investment_scoring": {"cls": InvestmentScoringNet, "input_dim": 15, "n_classes": 5},
    "gnn_fraud": {"cls": GNNFraudNet, "input_dim": 32, "n_classes": 2},
}


# ─────────────────────────── Synthetic Data ───────────────────────────

def generate_synthetic_data(model_type: str, n_samples: int = 5000):
    """Generate synthetic training data for each model type."""
    rng = np.random.default_rng(42)

    if model_type == "fraud_detection":
        X = rng.standard_normal((n_samples, 11)).astype(np.float32)
        # Realistic fraud signal: high amounts + off hours + international = fraud
        fraud_signal = X[:, 0] + X[:, 2] + X[:, 3] + rng.standard_normal(n_samples) * 0.5
        y = (fraud_signal > 1.5).astype(np.int64)
        # ~15% fraud rate
        return X, y

    elif model_type == "nlu_intent":
        # Token sequences (vocab 8000, seq_len 64)
        X = rng.integers(1, 8000, (n_samples, 64)).astype(np.float32)
        y = rng.integers(0, 12, n_samples).astype(np.int64)
        return X, y

    elif model_type == "fx_forecasting":
        # 5 features: open, high, low, close, volume
        X = np.cumsum(rng.standard_normal((n_samples, 5)) * 0.01 + 0.0001, axis=0).astype(np.float32)
        # Next-period return (regression)
        y = (rng.standard_normal(n_samples) * 0.01).astype(np.float32)
        return X, y

    elif model_type == "investment_scoring":
        X = rng.standard_normal((n_samples, 15)).astype(np.float32)
        # Risk quintiles
        risk_signal = X[:, 0] * 0.3 + X[:, 3] * 0.2 + X[:, 7] * 0.2 + rng.standard_normal(n_samples) * 0.3
        y = np.clip(np.digitize(risk_signal, np.percentile(risk_signal, [20, 40, 60, 80])), 0, 4).astype(np.int64)
        return X, y

    elif model_type == "gnn_fraud":
        X = rng.standard_normal((n_samples, 32)).astype(np.float32)
        y = (rng.random(n_samples) > 0.85).astype(np.int64)
        return X, y

    else:
        raise ValueError(f"Unknown model type: {model_type}")


def load_platform_data(model_type: str):
    """Try loading data from platform DB, fall back to synthetic."""
    try:
        from platform_data_loader import PlatformDataLoader
        loader = PlatformDataLoader()

        if model_type == "fraud_detection":
            X, y, meta = loader.load_fraud_training_data(min_samples=1000)
            if X is not None:
                return X, y, "platform_db"

        elif model_type == "fx_forecasting":
            data, meta = loader.load_fx_training_data(min_days=50)
            if data is not None:
                return data[:, :5], data[:, -1], "platform_db"

        elif model_type == "nlu_intent":
            samples, meta = loader.load_nlu_training_data(min_samples=200)
            if samples:
                # Tokenize text samples
                from collections import Counter
                vocab = {}
                for s in samples:
                    for w in s["text"].lower().split():
                        if w not in vocab:
                            vocab[w] = len(vocab) + 1
                X = np.zeros((len(samples), 64), dtype=np.float32)
                y = np.zeros(len(samples), dtype=np.int64)
                intent_map = {}
                for i, s in enumerate(samples):
                    tokens = [vocab.get(w, 0) for w in s["text"].lower().split()[:64]]
                    X[i, :len(tokens)] = tokens
                    if s["intent"] not in intent_map:
                        intent_map[s["intent"]] = len(intent_map)
                    y[i] = intent_map[s["intent"]]
                return X, y, "platform_db"

        elif model_type == "investment_scoring":
            X, y, meta = loader.load_investment_training_data(min_samples=100)
            if X is not None:
                return X, y, "platform_db"

        elif model_type == "gnn_fraud":
            graph, meta = loader.load_gnn_graph_data(min_transactions=500)
            if graph is not None:
                return graph["node_features"], graph["labels"], "platform_db"

        loader.close()
    except Exception as e:
        logger.info(f"Platform data unavailable for {model_type}: {e}")

    X, y = generate_synthetic_data(model_type)
    return X, y, "synthetic"


# ─────────────────────────── Remote Node Manager ───────────────────────────

class RemoteNodeManager:
    """
    Manages connections to remote GPU machines.
    Uses HTTP for training dispatch and model transfer.
    """

    def __init__(self):
        self.nodes: Dict[str, Dict[str, Any]] = {}

    def register_node(self, node_id: str, host: str, port: int = 8120,
                      gpu_vendor: Optional[str] = None, api_key: Optional[str] = None) -> Dict:
        """Register a remote training/inference node."""
        self.nodes[node_id] = {
            "host": host,
            "port": port,
            "gpu_vendor": gpu_vendor,
            "api_key": api_key,
            "base_url": f"http://{host}:{port}",
            "registered_at": datetime.now(timezone.utc).isoformat(),
            "status": "registered",
            "last_health": None,
        }
        logger.info(f"Registered remote node: {node_id} ({host}:{port}, GPU: {gpu_vendor})")
        return {"node_id": node_id, "status": "registered"}

    def unregister_node(self, node_id: str) -> bool:
        if node_id in self.nodes:
            del self.nodes[node_id]
            return True
        return False

    async def check_health(self, node_id: str) -> Dict:
        """Check health of a remote node."""
        if node_id not in self.nodes:
            raise ValueError(f"Unknown node: {node_id}")

        node = self.nodes[node_id]
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                url = f"{node['base_url']}/health"
                headers = {"Authorization": f"Bearer {node['api_key']}"} if node.get("api_key") else {}
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    data = await resp.json()
                    node["status"] = "healthy"
                    node["last_health"] = datetime.now(timezone.utc).isoformat()
                    return data
        except Exception as e:
            node["status"] = "unreachable"
            return {"status": "error", "error": str(e)}

    async def remote_train(self, node_id: str, train_request: dict) -> Dict:
        """Dispatch training to a remote GPU node."""
        if node_id not in self.nodes:
            raise ValueError(f"Unknown node: {node_id}")

        node = self.nodes[node_id]
        import aiohttp
        async with aiohttp.ClientSession() as session:
            url = f"{node['base_url']}/train"
            headers = {"Authorization": f"Bearer {node['api_key']}"} if node.get("api_key") else {}
            headers["Content-Type"] = "application/json"
            async with session.post(url, json=train_request, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=3600)) as resp:
                return await resp.json()

    async def remote_infer(self, node_id: str, model_name: str,
                           inputs: List[List[float]], return_probs: bool = True) -> Dict:
        """Run inference on a remote GPU node."""
        if node_id not in self.nodes:
            raise ValueError(f"Unknown node: {node_id}")

        node = self.nodes[node_id]
        import aiohttp
        async with aiohttp.ClientSession() as session:
            url = f"{node['base_url']}/inference"
            headers = {"Authorization": f"Bearer {node['api_key']}"} if node.get("api_key") else {}
            headers["Content-Type"] = "application/json"
            payload = {
                "model_name": model_name,
                "inputs": inputs,
                "return_probabilities": return_probs,
            }
            async with session.post(url, json=payload, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=30)) as resp:
                return await resp.json()

    async def transfer_model(self, model_name: str, onnx_path: str, target_node_id: str) -> Dict:
        """Transfer an ONNX model to a remote node."""
        if target_node_id not in self.nodes:
            raise ValueError(f"Unknown node: {target_node_id}")

        node = self.nodes[target_node_id]

        # Read model file and base64 encode
        with open(onnx_path, "rb") as f:
            model_bytes = f.read()
        model_b64 = base64.b64encode(model_bytes).decode()

        import aiohttp
        async with aiohttp.ClientSession() as session:
            url = f"{node['base_url']}/models/upload"
            headers = {"Authorization": f"Bearer {node['api_key']}"} if node.get("api_key") else {}
            headers["Content-Type"] = "application/json"
            payload = {
                "model_name": model_name,
                "model_data": model_b64,
                "format": "onnx",
            }
            async with session.post(url, json=payload, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=120)) as resp:
                return await resp.json()

    def list_nodes(self) -> List[Dict]:
        return [
            {"node_id": nid, **{k: v for k, v in info.items() if k != "api_key"}}
            for nid, info in self.nodes.items()
        ]


_node_manager = RemoteNodeManager()


# ─────────────────────────── HTTP Endpoints ───────────────────────────

@app.on_event("startup")
async def startup():
    global _trainer, _inference_engine
    _trainer = UniversalTrainer(TrainingConfig())
    _inference_engine = InferenceEngine()
    logger.info("GPU Training Engine started")


@app.get("/health")
async def health():
    devices = detect_all_devices()
    gpu_devices = [d for d in devices if d.vendor != GPUVendor.CPU]
    return {
        "status": "healthy",
        "service": "gpu-training-engine",
        "version": "1.0.0",
        "uptime_s": round(time.time() - _started_at, 1),
        "devices": {
            "total": len(devices),
            "gpus": len(gpu_devices),
            "best": devices[0].to_dict() if devices else None,
        },
        "models_loaded": len(_inference_engine.get_loaded_models()) if _inference_engine else 0,
        "active_jobs": sum(1 for j in _training_jobs.values() if j.get("status") == "training"),
    }


@app.get("/devices")
async def list_devices():
    """List all detected GPU/NPU/CPU devices."""
    devices = detect_all_devices()
    return {
        "devices": [d.to_dict() for d in devices],
        "total": len(devices),
        "gpu_count": sum(1 for d in devices if d.vendor != GPUVendor.CPU),
        "best_device": devices[0].to_dict() if devices else None,
        "supported_vendors": ["nvidia", "amd", "intel", "huawei", "apple", "qualcomm", "cpu"],
    }


@app.post("/train")
async def train_model(req: TrainRequest):
    """
    Train a model on the best available GPU.
    Exports to ONNX for cross-device inference after training.
    """
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    _training_jobs[job_id] = {"status": "loading_data", "model_type": req.model_type, "started_at": time.time()}

    try:
        # Load data
        if req.custom_data:
            data = json.loads(base64.b64decode(req.custom_data))
            X = np.array(data["X"], dtype=np.float32)
            y = np.array(data["y"])
            data_source = "custom"
        elif req.data_source == "platform_db":
            X, y, data_source = load_platform_data(req.model_type)
        else:
            X, y = generate_synthetic_data(req.model_type)
            data_source = "synthetic"

        _training_jobs[job_id]["status"] = "training"
        _training_jobs[job_id]["data_source"] = data_source
        _training_jobs[job_id]["samples"] = len(X)

        # Split into train/val
        split_idx = int(len(X) * 0.8)
        indices = np.random.permutation(len(X))
        X, y = X[indices], y[indices]
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]

        # Create model
        model_info = _MODEL_REGISTRY.get(req.model_type)
        if model_info:
            model = model_info["cls"]()
        else:
            raise HTTPException(400, f"Unknown model type: {req.model_type}")

        # Configure trainer
        config = TrainingConfig(
            epochs=req.epochs,
            batch_size=req.batch_size,
            learning_rate=req.learning_rate,
            mixed_precision=req.mixed_precision,
            export_onnx=req.export_onnx,
            preferred_device=req.preferred_device,
        )
        trainer = UniversalTrainer(config)

        # Determine loss function
        if req.model_type == "fx_forecasting":
            loss_fn = nn.MSELoss()
        else:
            loss_fn = nn.CrossEntropyLoss()

        # Train
        result = trainer.train(
            model=model,
            train_data=(X_train, y_train),
            val_data=(X_val, y_val),
            model_name=req.model_type,
            loss_fn=loss_fn,
        )

        # Load ONNX model into inference engine
        if result.onnx_path and _inference_engine:
            try:
                _inference_engine.load_model(req.model_type, result.onnx_path)
            except Exception as e:
                logger.warning(f"Failed to auto-load ONNX model: {e}")

        _training_jobs[job_id]["status"] = "completed"
        _training_jobs[job_id]["completed_at"] = time.time()

        return {
            "job_id": job_id,
            "status": "completed",
            "model_type": req.model_type,
            "data_source": data_source,
            "training_samples": result.training_samples,
            "device": result.device_used,
            "metrics": result.metrics,
            "training_time_s": result.training_time_s,
            "epochs_trained": result.epochs_trained,
            "best_epoch": result.best_epoch,
            "model_path": result.model_path,
            "onnx_path": result.onnx_path,
            "history": result.history[-5:],  # Last 5 epochs
        }

    except Exception as e:
        _training_jobs[job_id]["status"] = "failed"
        _training_jobs[job_id]["error"] = str(e)
        logger.error(f"Training failed: {e}", exc_info=True)
        raise HTTPException(500, f"Training failed: {str(e)}")


@app.post("/inference")
async def run_inference(req: InferRequest):
    """
    Run inference on loaded ONNX model.
    Works on any GPU vendor — the ONNX model is portable.
    """
    if not _inference_engine:
        raise HTTPException(503, "Inference engine not initialized")

    # Auto-load if model not loaded
    loaded = _inference_engine.get_loaded_models()
    if req.model_name not in loaded:
        onnx_path = str(ONNX_DIR / f"{req.model_name}.onnx")
        if not Path(onnx_path).exists():
            raise HTTPException(404, f"Model '{req.model_name}' not found. Train it first via POST /train")
        _inference_engine.load_model(req.model_name, onnx_path, target_vendor=req.target_device)

    inputs = np.array(req.inputs, dtype=np.float32)
    result = _inference_engine.predict(req.model_name, inputs, req.return_probabilities)

    return {
        "model_name": result.model_name,
        "predictions": result.predictions.tolist(),
        "probabilities": result.probabilities.tolist() if result.probabilities is not None else None,
        "latency_ms": result.latency_ms,
        "device_used": result.device_used,
        "provider_used": result.provider_used,
        "batch_size": result.batch_size,
    }


@app.post("/inference/batch")
async def batch_inference(model_name: str, inputs: List[List[List[float]]],
                          target_device: Optional[str] = None):
    """Batched inference for high throughput."""
    results = []
    for batch in inputs:
        inp = np.array(batch, dtype=np.float32)
        res = _inference_engine.predict(model_name, inp)
        results.append({
            "predictions": res.predictions.tolist(),
            "latency_ms": res.latency_ms,
        })
    return {"batches": len(results), "results": results}


@app.get("/models")
async def list_models():
    """List all loaded ONNX models."""
    loaded = _inference_engine.get_loaded_models() if _inference_engine else {}
    available_onnx = [f.stem for f in ONNX_DIR.glob("*.onnx")]
    available_pt = [f.stem.replace("_best", "") for f in MODELS_DIR.glob("*_best.pt")]

    return {
        "loaded": loaded,
        "available_onnx": available_onnx,
        "available_pytorch": available_pt,
        "model_types": list(_MODEL_REGISTRY.keys()),
    }


@app.post("/models/load")
async def load_model(model_name: str, target_device: Optional[str] = None):
    """Load an ONNX model into the inference engine."""
    onnx_path = str(ONNX_DIR / f"{model_name}.onnx")
    if not Path(onnx_path).exists():
        raise HTTPException(404, f"ONNX model not found: {onnx_path}")

    result = _inference_engine.load_model(model_name, onnx_path, target_vendor=target_device)
    return result


@app.post("/models/unload")
async def unload_model(model_name: str):
    """Unload a model to free memory."""
    success = _inference_engine.unload_model(model_name)
    if not success:
        raise HTTPException(404, f"Model '{model_name}' not loaded")
    return {"status": "unloaded", "model_name": model_name}


@app.post("/models/upload")
async def upload_model(model_name: str, model_data: str, format: str = "onnx"):
    """Receive an ONNX model from a remote node."""
    data = base64.b64decode(model_data)
    if format == "onnx":
        path = str(ONNX_DIR / f"{model_name}.onnx")
    else:
        path = str(MODELS_DIR / f"{model_name}.{format}")

    with open(path, "wb") as f:
        f.write(data)

    size_mb = len(data) / (1024 * 1024)
    logger.info(f"Received model '{model_name}' ({size_mb:.1f} MB)")
    return {"status": "uploaded", "model_name": model_name, "size_mb": round(size_mb, 1), "path": path}


@app.post("/export")
async def export_model(req: ExportRequest):
    """
    Export a trained model to a different format:
      - onnx (already done during training)
      - tensorrt (NVIDIA optimized)
      - openvino (Intel optimized)
      - coreml (Apple optimized)
      - quantized (INT8 for fast CPU inference)
    """
    # Find the ONNX source
    onnx_path = str(ONNX_DIR / f"{req.model_name}.onnx")
    if not Path(onnx_path).exists():
        raise HTTPException(404, f"ONNX model not found: {onnx_path}. Train the model first.")

    converter = ModelConverter()
    output_path = None

    if req.target_format == "tensorrt":
        out = str(ONNX_DIR / f"{req.model_name}.trt")
        output_path = converter.onnx_to_tensorrt(onnx_path, out)
    elif req.target_format == "openvino":
        output_path = converter.onnx_to_openvino(onnx_path, str(ONNX_DIR))
    elif req.target_format == "coreml":
        out = str(ONNX_DIR / f"{req.model_name}.mlmodel")
        output_path = converter.onnx_to_coreml(onnx_path, out)
    elif req.target_format == "quantized":
        output_path = _inference_engine.quantize_model(req.model_name, onnx_path)
    elif req.target_format == "onnx":
        output_path = onnx_path
    else:
        raise HTTPException(400, f"Unsupported format: {req.target_format}")

    if output_path is None:
        raise HTTPException(500, f"Export to {req.target_format} failed — required library not installed")

    return {
        "model_name": req.model_name,
        "target_format": req.target_format,
        "output_path": output_path,
        "size_mb": round(os.path.getsize(output_path) / (1024 * 1024), 1),
    }


@app.post("/benchmark")
async def benchmark(req: BenchmarkRequest):
    """Benchmark inference latency for a model."""
    loaded = _inference_engine.get_loaded_models()
    if req.model_name not in loaded:
        onnx_path = str(ONNX_DIR / f"{req.model_name}.onnx")
        if not Path(onnx_path).exists():
            raise HTTPException(404, "Model not found")
        _inference_engine.load_model(req.model_name, onnx_path)

    result = _inference_engine.benchmark(
        req.model_name,
        input_shape=tuple(req.input_shape),
        n_iterations=req.iterations,
        batch_size=req.batch_size,
    )
    return result


# ─────────────────────────── Remote Node Endpoints ───────────────────────────

@app.post("/remote/nodes/register")
async def register_node(req: RemoteNodeRequest):
    """Register a remote GPU training/inference node."""
    result = _node_manager.register_node(
        req.node_id, req.host, req.port, req.gpu_vendor, req.api_key,
    )
    return result


@app.delete("/remote/nodes/{node_id}")
async def unregister_node(node_id: str):
    if not _node_manager.unregister_node(node_id):
        raise HTTPException(404, f"Node '{node_id}' not found")
    return {"status": "removed", "node_id": node_id}


@app.get("/remote/nodes")
async def list_nodes():
    """List all registered remote nodes."""
    return {"nodes": _node_manager.list_nodes()}


@app.get("/remote/nodes/{node_id}/health")
async def check_node_health(node_id: str):
    """Check health of a remote node."""
    try:
        return await _node_manager.check_health(node_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/remote/train")
async def remote_train(req: RemoteTrainRequest):
    """
    Dispatch training to a remote GPU node.
    Train-on-one-GPU, infer-on-another workflow:
      1. POST /remote/train → trains on remote NVIDIA/AMD/etc
      2. Model auto-exported to ONNX on remote
      3. POST /remote/transfer → pull ONNX to local
      4. POST /inference → local inference on different GPU
    """
    try:
        result = await _node_manager.remote_train(req.node_id, {
            "model_type": req.model_type,
            "epochs": req.epochs,
            "batch_size": req.batch_size,
            "learning_rate": req.learning_rate,
            "mixed_precision": req.mixed_precision,
            "export_onnx": True,
        })
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Remote training failed: {str(e)}")


@app.post("/remote/infer")
async def remote_infer(req: RemoteInferRequest):
    """Run inference on a remote GPU node."""
    try:
        result = await _node_manager.remote_infer(
            req.node_id, req.model_name, req.inputs, req.return_probabilities,
        )
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Remote inference failed: {str(e)}")


@app.post("/remote/transfer")
async def transfer_model(model_name: str, target_node_id: str):
    """Transfer a trained ONNX model to a remote node."""
    onnx_path = str(ONNX_DIR / f"{model_name}.onnx")
    if not Path(onnx_path).exists():
        raise HTTPException(404, f"ONNX model not found: {model_name}")

    try:
        result = await _node_manager.transfer_model(model_name, onnx_path, target_node_id)
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Model transfer failed: {str(e)}")


@app.get("/jobs")
async def list_jobs():
    """List all training jobs."""
    return {"jobs": _training_jobs}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    if job_id not in _training_jobs:
        raise HTTPException(404, f"Job not found: {job_id}")
    return _training_jobs[job_id]


@app.get("/providers")
async def list_providers():
    """List available ONNX Runtime execution providers (inference backends)."""
    if _inference_engine:
        return {"providers": _inference_engine.get_providers()}
    return {"providers": []}


# ─────────────────────────── Cross-Device Workflow ───────────────────────────

@app.post("/workflow/train-and-deploy")
async def train_and_deploy(
    model_type: str,
    train_device: Optional[str] = None,
    infer_device: Optional[str] = None,
    epochs: int = 30,
    batch_size: int = 64,
):
    """
    Complete workflow: train on one device, deploy for inference on another.
    Example: train on NVIDIA, infer on Intel.
    """
    # Step 1: Train
    train_config = TrainingConfig(
        epochs=epochs,
        batch_size=batch_size,
        export_onnx=True,
        preferred_device=train_device,
    )
    trainer = UniversalTrainer(train_config)

    model_info = _MODEL_REGISTRY.get(model_type)
    if not model_info:
        raise HTTPException(400, f"Unknown model type: {model_type}")

    X, y, data_source = load_platform_data(model_type)
    split = int(len(X) * 0.8)
    idx = np.random.permutation(len(X))
    X, y = X[idx], y[idx]

    model = model_info["cls"]()
    loss_fn = nn.MSELoss() if model_type == "fx_forecasting" else nn.CrossEntropyLoss()

    result = trainer.train(
        model=model,
        train_data=(X[:split], y[:split]),
        val_data=(X[split:], y[split:]),
        model_name=model_type,
        loss_fn=loss_fn,
    )

    # Step 2: Load ONNX for inference on target device
    inference_info = None
    if result.onnx_path:
        inference_info = _inference_engine.load_model(
            model_type, result.onnx_path, target_vendor=infer_device,
        )

    # Step 3: Verify with a test prediction
    test_pred = None
    if inference_info:
        test_input = X[:1]
        pred = _inference_engine.predict(model_type, test_input)
        test_pred = {
            "input_shape": list(test_input.shape),
            "prediction": pred.predictions.tolist(),
            "latency_ms": pred.latency_ms,
            "inference_device": pred.device_used,
        }

    return {
        "status": "deployed",
        "model_type": model_type,
        "data_source": data_source,
        "training": {
            "device": result.device_used,
            "epochs_trained": result.epochs_trained,
            "best_val_accuracy": result.metrics.get("best_val_accuracy", 0),
            "training_time_s": result.training_time_s,
        },
        "inference": inference_info,
        "test_prediction": test_pred,
        "onnx_path": result.onnx_path,
        "pytorch_path": result.model_path,
    }


# ─────────────────────────── Main ───────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("GPU_ENGINE_PORT", "8120"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
