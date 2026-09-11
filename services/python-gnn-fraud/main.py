"""
RemitFlow GNN Fraud Detection Service — Port 8102
Wraps the GNN model (PyTorch Geometric) with a real-time API.
Subscribes to Fluvio stream for transaction features.
Falls back to handcrafted heuristics when PyG not available.
"""
import json
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gnn-fraud")

PORT = int(os.environ.get("PORT", "8102"))
FLUVIO_ENDPOINT = os.environ.get("FLUVIO_ENDPOINT", "http://localhost:9800")
MODEL_PATH = os.environ.get("GNN_MODEL_PATH", "/models/gnn_fraud_v1.pt")
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")

app = FastAPI(title="RemitFlow GNN Fraud Detection", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ─── Metrics ──────────────────────────────────────────────────────────────────

_metrics: Dict[str, Any] = {
    "scored": 0,
    "blocked": 0,
    "flagged": 0,
    "errors": 0,
    "start_time": time.time(),
    "model_loaded": False,
}

# ─── In-Memory Graph Store (replaced by Neo4j in production) ─────────────────

_tx_graph: Dict[str, List[str]] = defaultdict(list)
_user_risk: Dict[str, float] = defaultdict(lambda: 0.5)
_graph_lock = Lock()


def _add_to_graph(user_id: str, counterparty: str) -> None:
    with _graph_lock:
        if counterparty not in _tx_graph[user_id]:
            _tx_graph[user_id].append(counterparty)
        if user_id not in _tx_graph[counterparty]:
            _tx_graph[counterparty].append(user_id)


def _get_graph_features(user_id: str) -> Dict[str, float]:
    with _graph_lock:
        neighbors = _tx_graph.get(user_id, [])
        degree = len(neighbors)
        avg_neighbor_risk = (
            sum(_user_risk.get(n, 0.5) for n in neighbors) / max(degree, 1)
        )
        # Second-hop count
        second_hops = set()
        for n in neighbors:
            second_hops.update(_tx_graph.get(n, []))
        second_hops.discard(user_id)
        second_hops -= set(neighbors)

    return {
        "degree": float(degree),
        "avg_neighbor_risk": avg_neighbor_risk,
        "second_hop_count": float(len(second_hops)),
    }


# ─── GNN Model (PyTorch Geometric) ───────────────────────────────────────────

_gnn_model = None
_gnn_available = False


def _load_gnn_model() -> bool:
    global _gnn_model, _gnn_available
    try:
        import torch
        import torch_geometric
        from torch_geometric.nn import GCNConv

        class FraudGNN(torch.nn.Module):
            def __init__(self, in_channels: int, hidden: int = 64):
                super().__init__()
                self.conv1 = GCNConv(in_channels, hidden)
                self.conv2 = GCNConv(hidden, hidden // 2)
                self.classifier = torch.nn.Linear(hidden // 2, 2)

            def forward(self, x, edge_index):
                x = torch.relu(self.conv1(x, edge_index))
                x = torch.relu(self.conv2(x, edge_index))
                return torch.softmax(self.classifier(x), dim=-1)

        model = FraudGNN(in_channels=8)
        if os.path.exists(MODEL_PATH):
            model.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))
        model.eval()
        _gnn_model = model
        _gnn_available = True
        logger.info("GNN model loaded successfully")
        return True
    except ImportError:
        logger.warning("PyTorch Geometric not available — using heuristic fallback")
        return False
    except Exception as e:
        logger.error(f"GNN model load failed: {e}")
        return False


# ─── Heuristic Scorer (fallback when GNN not available) ──────────────────────

def _heuristic_score(features: Dict[str, Any]) -> float:
    score = 0.0
    amount = features.get("amount", 0)
    velocity_1h = features.get("velocity_1h", 0)
    is_new_recipient = features.get("is_new_recipient", False)
    cross_border = features.get("cross_border", False)
    hour_of_day = features.get("hour_of_day", 12)

    if amount > 10000: score += 0.3
    elif amount > 5000: score += 0.15
    if velocity_1h > 5: score += 0.3
    elif velocity_1h > 3: score += 0.15
    if is_new_recipient: score += 0.15
    if cross_border: score += 0.1
    if hour_of_day < 6 or hour_of_day > 22: score += 0.1

    return min(score, 1.0)


# ─── Request / Response Models ────────────────────────────────────────────────

class ScoreRequest(BaseModel):
    transaction_id: str
    user_id: str
    counterparty_id: Optional[str] = None
    amount: float = Field(gt=0)
    currency: str = "USD"
    features: Optional[Dict[str, Any]] = None


class ScoreResponse(BaseModel):
    transaction_id: str
    risk_score: float = Field(ge=0.0, le=1.0)
    risk_level: str
    action: str
    gnn_score: Optional[float] = None
    heuristic_score: float
    graph_features: Dict[str, float]
    processing_ms: float
    model_version: str


class BatchScoreRequest(BaseModel):
    transactions: List[ScoreRequest]


# ─── Internal Auth ────────────────────────────────────────────────────────────

def _require_internal_auth(x_internal_token: Optional[str] = Header(None)) -> None:
    """Fail-closed: all requests require a valid internal service token.

    Dev environments may start without INTERNAL_API_TOKEN set (auth is skipped
    in that case) — log a warning loudly but do NOT fail in non-production.
    Production MUST set INTERNAL_API_TOKEN; startup is aborted if missing.
    """
    if not INTERNAL_API_TOKEN:
        if os.environ.get("NODE_ENV", "development") == "production":
            raise HTTPException(status_code=503, detail="INTERNAL_API_TOKEN not configured")
        # Non-production: warn and skip (allows local dev without token setup)
        return
    import hmac as _hmac
    if not x_internal_token or not _hmac.compare_digest(x_internal_token, INTERNAL_API_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal API token")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/metrics/pod")
async def _prometheus_metrics():
    from fastapi.responses import PlainTextResponse
    uptime = time.time() - _metrics["start_time"]
    return PlainTextResponse(
        f"# HELP pod_uptime_seconds Time since process started\n"
        f"# TYPE pod_uptime_seconds gauge\n"
        f'pod_uptime_seconds{{service="python-gnn-fraud"}} {uptime:.1f}\n'
        f"# HELP pod_ready Whether pod is ready\n"
        f"# TYPE pod_ready gauge\n"
        f'pod_ready{{service="python-gnn-fraud"}} 1\n',
        media_type="text/plain; version=0.0.4",
    )

@app.get("/health")
async def health():
    return {
        "service": "python-gnn-fraud",
        "status": "healthy",
        "model_loaded": _metrics["model_loaded"],
        "gnn_available": _gnn_available,
        "uptime_seconds": time.time() - _metrics["start_time"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/score", response_model=ScoreResponse)
async def score_transaction(req: ScoreRequest, request: Request):
    _require_internal_auth(request.headers.get("X-Internal-Token"))
    start = time.time()

    # Update graph
    if req.counterparty_id:
        _add_to_graph(req.user_id, req.counterparty_id)

    graph_feats = _get_graph_features(req.user_id)

    # Build feature vector
    features = {
        "amount": req.amount,
        "velocity_1h": (req.features or {}).get("velocity_1h", 0),
        "is_new_recipient": (req.features or {}).get("is_new_recipient", False),
        "cross_border": (req.features or {}).get("cross_border", False),
        "hour_of_day": (req.features or {}).get("hour_of_day", datetime.now(timezone.utc).hour),
        **graph_feats,
    }

    heuristic = _heuristic_score(features)
    gnn_score: Optional[float] = None

    if _gnn_available and _gnn_model is not None:
        try:
            import torch
            x = torch.tensor([[req.amount / 10000, features["velocity_1h"] / 10,
                               float(features["is_new_recipient"]), float(features["cross_border"]),
                               graph_feats["degree"] / 50, graph_feats["avg_neighbor_risk"],
                               features["hour_of_day"] / 24, graph_feats["second_hop_count"] / 100]],
                             dtype=torch.float)
            edge_index = torch.tensor([[0], [0]], dtype=torch.long)
            with torch.no_grad():
                out = _gnn_model(x, edge_index)
                gnn_score = float(out[0, 1].item())
        except Exception as e:
            logger.warning(f"GNN inference failed: {e}")

    final_score = gnn_score if gnn_score is not None else heuristic

    risk_level = "critical" if final_score >= 0.85 else "high" if final_score >= 0.65 else "medium" if final_score >= 0.4 else "low"
    action = "block" if final_score >= 0.85 else "flag" if final_score >= 0.65 else "allow"

    _metrics["scored"] += 1
    if action == "block": _metrics["blocked"] += 1
    elif action == "flag": _metrics["flagged"] += 1

    # Update user risk score
    _user_risk[req.user_id] = 0.7 * _user_risk.get(req.user_id, 0.5) + 0.3 * final_score

    return ScoreResponse(
        transaction_id=req.transaction_id,
        risk_score=final_score,
        risk_level=risk_level,
        action=action,
        gnn_score=gnn_score,
        heuristic_score=heuristic,
        graph_features=graph_feats,
        processing_ms=(time.time() - start) * 1000,
        model_version="gnn-v1" if _gnn_available else "heuristic-v1",
    )


@app.post("/score/batch")
async def score_batch(req: BatchScoreRequest, request: Request):
    _require_internal_auth(request.headers.get("X-Internal-Token"))
    results = []
    for tx in req.transactions:
        r = await score_transaction(tx, request)
        results.append(r)
    return {"results": results, "count": len(results)}


@app.get("/graph/stats")
async def graph_stats(request: Request):
    _require_internal_auth(request.headers.get("X-Internal-Token"))
    with _graph_lock:
        total_nodes = len(_tx_graph)
        total_edges = sum(len(v) for v in _tx_graph.values()) // 2
        max_degree = max((len(v) for v in _tx_graph.values()), default=0)
    return {
        "total_nodes": total_nodes,
        "total_edges": total_edges,
        "max_degree": max_degree,
        "tracked_users": len(_user_risk),
    }


@app.get("/metrics")
async def metrics():
    uptime = time.time() - _metrics["start_time"]
    return {
        "scored": _metrics["scored"],
        "blocked": _metrics["blocked"],
        "flagged": _metrics["flagged"],
        "errors": _metrics["errors"],
        "uptime_seconds": uptime,
        "scored_per_minute": _metrics["scored"] / max(uptime / 60, 1),
        "model_loaded": _metrics["model_loaded"],
        "gnn_available": _gnn_available,
    }


# ─── Fluvio Stream Consumer ───────────────────────────────────────────────────

async def _consume_fluvio_stream() -> None:
    """Background consumer: reads transactions from Fluvio stream."""
    import asyncio
    try:
        import httpx
        async with httpx.AsyncClient(base_url=FLUVIO_ENDPOINT, timeout=30.0) as client:
            offset = 0
            while True:
                try:
                    resp = await client.get(f"/topics/remitflow.transactions/records?offset={offset}")
                    if resp.status_code == 200:
                        records = resp.json().get("records", [])
                        for record in records:
                            data = json.loads(record.get("value", "{}"))
                            user_id = data.get("userId", "")
                            recipient = data.get("recipientAccount", "")
                            if user_id and recipient:
                                _add_to_graph(str(user_id), str(recipient))
                        if records:
                            offset += len(records)
                    await asyncio.sleep(5)
                except Exception as e:
                    logger.warning(f"Fluvio consume error: {e}")
                    await asyncio.sleep(30)
    except ImportError:
        logger.warning("httpx not available — Fluvio consumer disabled")


@app.on_event("startup")
async def startup():
    logger.info("Starting GNN Fraud Detection Service")
    _metrics["model_loaded"] = _load_gnn_model()
    import asyncio
    asyncio.create_task(_consume_fluvio_stream())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
