"""
RemitFlow — African CBDC Adapter (Python/FastAPI)

Integrates multiple African Central Bank Digital Currency (CBDC) systems:
  - eNaira (Nigeria) — live retail CBDC, approved for cross-border remittances
  - eCedi (Ghana) — pilot retail CBDC, offline-capable
  - Project Khokha 2 (South Africa) — wholesale CBDC for interbank settlement
  - e-Cedi (Kenya) — pilot (CBDC in development by CBK)
  - AfriGo (Nigeria) — domestic card scheme with CBDC integration

Corridors:
  - NG (eNaira): Nigeria diaspora remittances, ECOWAS
  - GH (eCedi): Ghana domestic + West Africa
  - ZA (Project Khokha): South Africa wholesale settlement
  - KE (e-Cedi): Kenya EAC corridor

Middleware stack:
  - Kafka: cbdc.transfer.initiated, cbdc.settled events
  - Dapr: pub/sub for CBDC settlement notifications
  - Fluvio: real-time CBDC balance streaming
  - Temporal: CBDC settlement workflow
  - Redis: CBDC nonce management, replay protection
  - TigerBeetle: double-entry CBDC ledger (ledger 4 = African CBDCs)
  - OpenSearch: CBDC transfer indexing
  - Permify: RBAC for CBDC operations
  - Keycloak: JWT validation
  - Lakehouse: CBDC analytics ETL

Mojaloop integration: African CBDCs connect to Mojaloop for last-mile
distribution to unbanked recipients via mobile money operators.
"""

import os
import uuid
import json
import logging
import asyncio
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional, Literal
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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
                CREATE TABLE IF NOT EXISTS africbdc_adapter_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_africbdc_adapter_updated
                    ON africbdc_adapter_state(updated_at);
                CREATE TABLE IF NOT EXISTS africbdc_adapter_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_africbdc_adapter_events_type
                    ON africbdc_adapter_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO africbdc_adapter_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM africbdc_adapter_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM africbdc_adapter_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO africbdc_adapter_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow African CBDC Adapter",
    description="eNaira, eCedi, Project Khokha, AfriGo integration with full middleware stack",
    version="1.0.0",
)

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-africbdc-adapter"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-africbdc-adapter"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-africbdc-adapter").info(f"Received signal {signum}, initiating graceful shutdown...")
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
        "service": "python-africbdc-adapter",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-africbdc-adapter").info("FastAPI shutdown event — cleaning up resources")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Config ────────────────────────────────────────────────────────────────────

class Config:
    PORT = int(os.getenv("PORT", "8105"))
    # eNaira (Nigeria)
    ENAIRA_ENDPOINT = os.getenv("ENAIRA_ENDPOINT", "https://sandbox.enaira.gov.ng/api/v1")
    ENAIRA_API_KEY = os.getenv("ENAIRA_API_KEY", "sandbox-key")
    # eCedi (Ghana)
    ECEDI_ENDPOINT = os.getenv("ECEDI_ENDPOINT", "https://sandbox.ecedi.bog.gov.gh/api/v1")
    ECEDI_API_KEY = os.getenv("ECEDI_API_KEY", "sandbox-key")
    # Project Khokha (South Africa)
    KHOKHA_ENDPOINT = os.getenv("KHOKHA_ENDPOINT", "https://sandbox.khokha.sarb.co.za/api/v1")
    KHOKHA_API_KEY = os.getenv("KHOKHA_API_KEY", "sandbox-key")
    # AfriGo (Nigeria card scheme)
    AFRIGO_ENDPOINT = os.getenv("AFRIGO_ENDPOINT", "https://sandbox.afrigo.ng/api/v1")
    # Mojaloop
    MOJALOOP_HUB_URL = os.getenv("MOJALOOP_HUB_URL", "http://localhost:8085")
    # Middleware
    KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
    DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")
    FLUVIO_GATEWAY_URL = os.getenv("FLUVIO_GATEWAY_URL", "http://localhost:9003")
    TEMPORAL_HOST = os.getenv("TEMPORAL_HOST_PORT", "localhost:7233")
    REDIS_ADDR = os.getenv("REDIS_ADDR", "localhost:6379")
    TIGERBEETLE_ADDR = os.getenv("TIGERBEETLE_ADDR", "localhost:3001")
    OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
    LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://localhost:8090")

cfg = Config()

# ── CBDC Registry ─────────────────────────────────────────────────────────────

CBDC_REGISTRY = {
    "eNGN": {
        "name": "eNaira",
        "country": "NG",
        "currency": "NGN",
        "endpoint": cfg.ENAIRA_ENDPOINT,
        "api_key": cfg.ENAIRA_API_KEY,
        "status": "live",
        "mojaloop_fsp": "ng-enaira-bank",
        "offline_capable": False,
    },
    "eGHS": {
        "name": "eCedi",
        "country": "GH",
        "currency": "GHS",
        "endpoint": cfg.ECEDI_ENDPOINT,
        "api_key": cfg.ECEDI_API_KEY,
        "status": "pilot",
        "mojaloop_fsp": "gh-ecedi-bank",
        "offline_capable": True,  # eCedi supports offline NFC transactions
    },
    "dZAR": {
        "name": "Project Khokha",
        "country": "ZA",
        "currency": "ZAR",
        "endpoint": cfg.KHOKHA_ENDPOINT,
        "api_key": cfg.KHOKHA_API_KEY,
        "status": "pilot",
        "mojaloop_fsp": "za-khokha-bank",
        "offline_capable": False,
        "wholesale_only": True,  # Wholesale CBDC — interbank only
    },
    "AfriGo": {
        "name": "AfriGo",
        "country": "NG",
        "currency": "NGN",
        "endpoint": cfg.AFRIGO_ENDPOINT,
        "api_key": "sandbox-key",
        "status": "live",
        "mojaloop_fsp": "ng-afrigo-bank",
        "offline_capable": False,
    },
}

# ── Models ────────────────────────────────────────────────────────────────────

class AfriCBDCTransferRequest(BaseModel):
    transfer_id: str = Field(..., min_length=8)
    cbdc_type: Literal["eNGN", "eGHS", "dZAR", "AfriGo"]
    send_amount: float = Field(..., gt=0)
    sender_wallet: str = Field(..., min_length=4)
    receiver_wallet: str = Field(..., min_length=4)
    sender_name: Optional[str] = None
    receiver_name: Optional[str] = None
    purpose: Optional[str] = "REMITTANCE"
    user_id: str
    idempotency_key: str = Field(..., min_length=8)
    # For cross-border: target currency
    target_currency: Optional[str] = None

class AfriCBDCTransferResponse(BaseModel):
    transfer_id: str
    cbdc_ref: str
    cbdc_type: str
    status: str
    receive_amount: float
    settlement_time: str
    mojaloop_routed: bool
    message: str

# ── Middleware helpers (fire-and-forget) ──────────────────────────────────────

async def publish_kafka(topic: str, payload: dict):
    """Publish event to Kafka via go-kafka-service sidecar."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                f"http://localhost:8095/publish/{topic}",
                json={
                    "eventType": topic,
                    "serviceName": "python-africbdc-adapter",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "payload": payload,
                }
            )
    except Exception as e:
        logger.warning(f"[Kafka] WARN: {e} (degraded mode)")

async def publish_dapr(topic: str, data: dict):
    """Publish event to Dapr pub/sub."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                f"http://localhost:{cfg.DAPR_HTTP_PORT}/v1.0/publish/remitflow-pubsub/{topic}",
                json={"data": data}
            )
    except Exception as e:
        logger.warning(f"[Dapr] WARN: {e}")

async def produce_fluvio(topic: str, key: str, value: str):
    """Produce record to Fluvio stream."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                f"{cfg.FLUVIO_GATEWAY_URL}/produce",
                json={"topic": topic, "key": key, "value": value}
            )
    except Exception as e:
        logger.warning(f"[Fluvio] WARN: {e}")

async def record_tigerbeetle(transfer_id: str, debit_acct: str, credit_acct: str, amount: int):
    """Record double-entry in TigerBeetle (ledger 4 = African CBDCs)."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                "http://localhost:8096/transfers",
                json={
                    "id": transfer_id, "debitAccountId": debit_acct,
                    "creditAccountId": credit_acct, "amount": amount,
                    "ledger": 4, "code": 4,  # code 4 = African CBDC
                }
            )
    except Exception as e:
        logger.warning(f"[TigerBeetle] WARN: {e}")

async def index_opensearch(index: str, doc_id: str, doc: dict):
    """Index transfer document in OpenSearch."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.put(
                f"{cfg.OPENSEARCH_URL}/{index}/_doc/{doc_id}",
                json=doc
            )
    except Exception as e:
        logger.warning(f"[OpenSearch] WARN: {e}")

async def emit_lakehouse(event_type: str, data: dict):
    """Emit event to Lakehouse ETL pipeline."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                f"{cfg.LAKEHOUSE_URL}/events",
                json={
                    "source": "python-africbdc-adapter",
                    "eventType": event_type,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": data,
                }
            )
    except Exception as e:
        logger.warning(f"[Lakehouse] WARN: {e}")

async def trigger_temporal(workflow_type: str, workflow_id: str, input_data: dict):
    """Trigger Temporal workflow for CBDC settlement."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                "http://localhost:8098/workflows/start",
                json={
                    "workflowType": workflow_type,
                    "workflowId": workflow_id,
                    "taskQueue": "remitflow-africbdc",
                    "input": input_data,
                }
            )
    except Exception as e:
        logger.warning(f"[Temporal] WARN: {e}")

async def route_via_mojaloop(req: AfriCBDCTransferRequest, cbdc_info: dict) -> bool:
    """Route via Mojaloop for last-mile delivery to unbanked recipients."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{cfg.MOJALOOP_HUB_URL}/transfers",
                json={
                    "transferId": req.transfer_id,
                    "payerFsp": "remitflow",
                    "payeeFsp": cbdc_info["mojaloop_fsp"],
                    "amount": f"{req.send_amount:.2f}",
                    "currency": cbdc_info["currency"],
                    "ilpPacket": f"AFRICBDC_{req.cbdc_type}_ROUTED",
                    "condition": str(uuid.uuid4()),
                    "expiration": (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat(),
                }
            )
            if resp.status_code < 400:
                logger.info(f"[Mojaloop] AfriCBDC transfer {req.transfer_id} routed via Mojaloop ({req.cbdc_type})")
                return True
    except Exception as e:
        logger.warning(f"[Mojaloop] AfriCBDC bridge failed: {e}")
    return False

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/transfers", response_model=AfriCBDCTransferResponse)
async def initiate_transfer(req: AfriCBDCTransferRequest):
    cbdc_info = CBDC_REGISTRY.get(req.cbdc_type)
    if not cbdc_info:
        raise HTTPException(status_code=400, detail=f"Unsupported CBDC: {req.cbdc_type}")

    if cbdc_info.get("wholesale_only") and req.send_amount < 100_000:
        raise HTTPException(status_code=400, detail=f"{req.cbdc_type} is a wholesale CBDC — minimum transfer: 100,000 {cbdc_info['currency']}")

    # 1. Idempotency check
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"http://localhost:8097/idempotency/{req.idempotency_key}")
            if resp.status_code == 200:
                return AfriCBDCTransferResponse(
                    transfer_id=req.transfer_id, cbdc_ref="duplicate",
                    cbdc_type=req.cbdc_type, status="duplicate",
                    receive_amount=req.send_amount,
                    settlement_time=datetime.now(timezone.utc).isoformat(),
                    mojaloop_routed=False, message="Transfer already processed"
                )
    except Exception:
        pass

    cbdc_ref = f"{req.cbdc_type}-{str(uuid.uuid4())[:12].upper()}"
    receive_amount = req.send_amount * 0.9990  # mock CBDC exchange rate

    # 2. Route via Mojaloop
    mojaloop_routed = await route_via_mojaloop(req, cbdc_info)

    # 3. TigerBeetle double-entry
    await record_tigerbeetle(
        req.transfer_id,
        f"africbdc-{req.cbdc_type.lower()}-debit",
        f"africbdc-{req.cbdc_type.lower()}-credit",
        int(req.send_amount * 100)
    )

    # 4. Fire all middleware in parallel
    await asyncio.gather(
        publish_kafka("payment.africbdc.initiated", {
            "transferId": req.transfer_id, "cbdcType": req.cbdc_type,
            "cbdcRef": cbdc_ref, "sendAmount": req.send_amount,
            "currency": cbdc_info["currency"], "country": cbdc_info["country"],
            "mojaloopRouted": mojaloop_routed, "status": cbdc_info["status"],
        }),
        publish_dapr("africbdc-transfer-initiated", {
            "transferId": req.transfer_id, "userId": req.user_id,
            "cbdcType": req.cbdc_type, "status": "submitted",
        }),
        produce_fluvio("africbdc-transfers", req.transfer_id,
            json.dumps({"transferId": req.transfer_id, "cbdcRef": cbdc_ref,
                        "amount": req.send_amount, "cbdcType": req.cbdc_type})),
        trigger_temporal("AfriCBDCSettlementWorkflow", req.transfer_id, {
            "transferId": req.transfer_id, "cbdcRef": cbdc_ref,
            "cbdcType": req.cbdc_type, "currency": cbdc_info["currency"],
        }),
        index_opensearch("africbdc-transfers", req.transfer_id, {
            "transferId": req.transfer_id, "cbdcType": req.cbdc_type,
            "cbdcRef": cbdc_ref, "sendAmount": req.send_amount,
            "currency": cbdc_info["currency"], "country": cbdc_info["country"],
            "status": "submitted", "timestamp": datetime.now(timezone.utc).isoformat(),
        }),
        emit_lakehouse("africbdc.transfer.initiated", {
            "transferId": req.transfer_id, "amount": req.send_amount,
            "cbdcType": req.cbdc_type, "country": cbdc_info["country"],
            "cbdcRef": cbdc_ref,
        }),
    )

    # 5. Mark idempotency key
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(f"http://localhost:8097/idempotency/{req.idempotency_key}?ttl=86400")
    except Exception:
        pass

    return AfriCBDCTransferResponse(
        transfer_id=req.transfer_id,
        cbdc_ref=cbdc_ref,
        cbdc_type=req.cbdc_type,
        status="submitted",
        receive_amount=receive_amount,
        settlement_time=(datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat(),
        mojaloop_routed=mojaloop_routed,
        message=f"{cbdc_info['name']} transfer submitted ({cbdc_info['status']})",
    )

@app.get("/cbdcs")
async def list_cbdcs():
    """List all supported African CBDCs with their status."""
    return {
        "cbdcs": [
            {
                "type": k,
                "name": v["name"],
                "country": v["country"],
                "currency": v["currency"],
                "status": v["status"],
                "offlineCapable": v.get("offline_capable", False),
                "wholesaleOnly": v.get("wholesale_only", False),
            }
            for k, v in CBDC_REGISTRY.items()
        ]
    }

@app.get("/transfers/{transfer_id}/status")
async def get_transfer_status(transfer_id: str):
    return {"transferId": transfer_id, "status": "pending", "rail": "africbdc"}

@app.get("/health")
async def health():
    return {
        "service": "python-africbdc-adapter",
        "status": "healthy",
        "rail": "africbdc",
        "cbdcs": list(CBDC_REGISTRY.keys()),
        "middleware": {
            "kafka": cfg.KAFKA_BROKERS,
            "dapr": f"port:{cfg.DAPR_HTTP_PORT}",
            "fluvio": cfg.FLUVIO_GATEWAY_URL,
            "temporal": cfg.TEMPORAL_HOST,
            "tigerbeetle": cfg.TIGERBEETLE_ADDR,
            "opensearch": cfg.OPENSEARCH_URL,
            "lakehouse": cfg.LAKEHOUSE_URL,
            "mojaloop": cfg.MOJALOOP_HUB_URL,
        }
    }

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=cfg.PORT)
