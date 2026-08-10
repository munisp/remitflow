"""
RemitFlow Travel Rule Service
FATF Recommendation 16 compliant VASP-to-VASP data transmission
Supports TRISA, Sygna Bridge, and OpenVASP protocols
Port: 8098

REQUIRED:
  - TRISA_ENDPOINT (optional)
  - SYGNA_API_KEY / SYGNA_API_SECRET (optional)
  - OPENVASP_NODE_ID (optional)
  - DATABASE_URL

FAIL-CLOSED:
  If no Travel Rule protocol is configured, returns HTTP 503.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import signal
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS travel_rule_messages (
                    id BIGSERIAL PRIMARY KEY,
                    message_id TEXT UNIQUE NOT NULL,
                    transaction_id TEXT NOT NULL,
                    protocol TEXT NOT NULL,  -- trisa | sygna | openvasp
                    direction TEXT NOT NULL,  -- outbound | inbound
                    status TEXT NOT NULL DEFAULT 'pending',
                    originator_vasp TEXT,
                    beneficiary_vasp TEXT,
                    originator_data JSONB,
                    beneficiary_data JSONB,
                    amount REAL NOT NULL,
                    currency TEXT NOT NULL,
                    raw_payload JSONB,
                    response_payload JSONB,
                    error_message TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS idx_tr_tx ON travel_rule_messages(transaction_id);
                CREATE INDEX IF NOT EXISTS idx_tr_status ON travel_rule_messages(status);
                CREATE TABLE IF NOT EXISTS travel_rule_vasps (
                    vasp_id TEXT PRIMARY KEY,
                    vasp_name TEXT NOT NULL,
                    vasp_did TEXT,
                    trisa_endpoint TEXT,
                    sygna_vasp_code TEXT,
                    openvasp_node_id TEXT,
                    supported_protocols TEXT[],
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)
    return _db_pool

def db_log_travel_rule(message_id, transaction_id, protocol, direction, status, originator_vasp, beneficiary_vasp,
                       originator_data, beneficiary_data, amount, currency, raw_payload=None, response_payload=None, error=None):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO travel_rule_messages
               (message_id, transaction_id, protocol, direction, status, originator_vasp, beneficiary_vasp,
                originator_data, beneficiary_data, amount, currency, raw_payload, response_payload, error_message)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (message_id) DO UPDATE SET
               status = EXCLUDED.status,
               response_payload = EXCLUDED.response_payload,
               error_message = EXCLUDED.error_message,
               updated_at = NOW(),
               completed_at = CASE WHEN EXCLUDED.status IN ('completed', 'rejected', 'failed') THEN NOW() ELSE travel_rule_messages.completed_at END""",
            (message_id, transaction_id, protocol, direction, status, originator_vasp, beneficiary_vasp,
             psycopg2.extras.Json(originator_data or {}), psycopg2.extras.Json(beneficiary_data or {}),
             amount, currency,
             psycopg2.extras.Json(raw_payload) if raw_payload else None,
             psycopg2.extras.Json(response_payload) if response_payload else None,
             error)
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[TRAVEL-RULE] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow Travel Rule Service",
    description="FATF Recommendation 16 compliant VASP data transmission",
    version="2.0.0",
)

_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Protocol Configuration ────────────────────────────────────────────────────
TRISA_ENDPOINT = os.getenv("TRISA_ENDPOINT", "").strip()
SYGNA_API_KEY = os.getenv("SYGNA_API_KEY", "").strip()
SYGNA_API_SECRET = os.getenv("SYGNA_API_SECRET", "").strip()
SYGNA_BASE_URL = os.getenv("SYGNA_BASE_URL", "https://api.sygna.io/v2").strip()
OPENVASP_NODE_ID = os.getenv("OPENVASP_NODE_ID", "").strip()

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class OriginatorInfo(BaseModel):
    name: str
    account_number: str
    address: Optional[str] = None
    country: str = Field(..., min_length=2, max_length=2)
    date_of_birth: Optional[str] = None
    national_id: Optional[str] = None

class BeneficiaryInfo(BaseModel):
    name: str
    account_number: str
    address: Optional[str] = None
    country: str = Field(..., min_length=2, max_length=2)
    institution_name: Optional[str] = None

class TravelRuleRequest(BaseModel):
    transaction_id: str
    amount: float = Field(..., gt=0)
    currency: str = Field(..., min_length=3, max_length=3)
    originator: OriginatorInfo
    beneficiary: BeneficiaryInfo
    originator_vasp: str  # Our VASP ID
    beneficiary_vasp: str  # Counterparty VASP ID
    protocol: str = Field(default="sygna", pattern=r"^(trisa|sygna|openvasp)$")
    beneficiary_vasp_did: Optional[str] = None

class TravelRuleResponse(BaseModel):
    message_id: str
    transaction_id: str
    status: str
    protocol: str
    originator_vasp: str
    beneficiary_vasp: str
    submitted_at: str
    note: str

class VASPRegistration(BaseModel):
    vasp_id: str
    vasp_name: str
    vasp_did: Optional[str] = None
    trisa_endpoint: Optional[str] = None
    sygna_vasp_code: Optional[str] = None
    openvasp_node_id: Optional[str] = None
    supported_protocols: List[str]

# ─── Protocol Implementations ──────────────────────────────────────────────────

async def _send_sygna(request: TravelRuleRequest) -> dict:
    """Send Travel Rule data via Sygna Bridge API."""
    if not SYGNA_API_KEY or not SYGNA_API_SECRET:
        raise HTTPException(status_code=503, detail="Sygna Bridge API credentials not configured")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1: Get access token
        token_resp = await client.post(
            f"{SYGNA_BASE_URL}/auth",
            json={"api_key": SYGNA_API_KEY, "api_secret": SYGNA_API_SECRET},
        )
        token_resp.raise_for_status()
        token = token_resp.json().get("access_token")

        # Step 2: Send permission request
        payload = {
            "vasp_code": request.beneficiary_vasp,
            "transaction": {
                "txid": request.transaction_id,
                "originator_vasp": request.originator_vasp,
                "beneficiary_vasp": request.beneficiary_vasp,
                "currency_id": request.currency,
                "amount": str(request.amount),
            },
            "originator": {
                "name": request.originator.name,
                "account_number": request.originator.account_number,
                "address": request.originator.address,
                "country": request.originator.country,
                "date_of_birth": request.originator.date_of_birth,
                "national_id": request.originator.national_id,
            },
            "beneficiary": {
                "name": request.beneficiary.name,
                "account_number": request.beneficiary.account_number,
                "address": request.beneficiary.address,
                "country": request.beneficiary.country,
                "institution_name": request.beneficiary.institution_name,
            },
        }

        resp = await client.post(
            f"{SYGNA_BASE_URL}/permission",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()

async def _send_trisa(request: TravelRuleRequest) -> dict:
    """Send Travel Rule data via TRISA protocol."""
    if not TRISA_ENDPOINT:
        raise HTTPException(status_code=503, detail="TRISA endpoint not configured")

    # TRISA uses gRPC; this is a simplified REST bridge implementation
    async with httpx.AsyncClient(timeout=30.0) as client:
        payload = {
            "transaction_id": request.transaction_id,
            "originator": request.originator.model_dump(),
            "beneficiary": request.beneficiary.model_dump(),
            "amount": request.amount,
            "currency": request.currency,
            "originator_vasp": request.originator_vasp,
            "beneficiary_vasp": request.beneficiary_vasp,
        }

        resp = await client.post(
            f"{TRISA_ENDPOINT}/v1/transaction",
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()

async def _send_openvasp(request: TravelRuleRequest) -> dict:
    """Send Travel Rule data via OpenVASP protocol."""
    if not OPENVASP_NODE_ID:
        raise HTTPException(status_code=503, detail="OpenVASP node ID not configured")

    # OpenVASP uses whisper protocol; simplified REST implementation
    async with httpx.AsyncClient(timeout=30.0) as client:
        payload = {
            "vasp_id": request.originator_vasp,
            "counterparty_vasp_id": request.beneficiary_vasp,
            "counterparty_vasp_did": request.beneficiary_vasp_did,
            "transaction": {
                "txid": request.transaction_id,
                "amount": request.amount,
                "currency": request.currency,
            },
            "originator": request.originator.model_dump(),
            "beneficiary": request.beneficiary.model_dump(),
        }

        resp = await client.post(
            f"https://api.openvasp.org/v1/transfer",
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()

# ─── Handlers ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    protocols = {
        "sygna": "configured" if (SYGNA_API_KEY and SYGNA_API_SECRET) else "missing",
        "trisa": "configured" if TRISA_ENDPOINT else "missing",
        "openvasp": "configured" if OPENVASP_NODE_ID else "missing",
    }
    any_configured = any(v == "configured" for v in protocols.values())

    return {
        "status": "ok" if any_configured else "degraded",
        "service": "travel-rule",
        "version": "2.0.0",
        "protocols": protocols,
        "fatf_compliant": any_configured,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/travel-rule/send", response_model=TravelRuleResponse)
async def send_travel_rule(req: TravelRuleRequest):
    message_id = f"TR-{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.urandom(4).hex().upper()}"

    try:
        if req.protocol == "sygna":
            result = await _send_sygna(req)
        elif req.protocol == "trisa":
            result = await _send_trisa(req)
        elif req.protocol == "openvasp":
            result = await _send_openvasp(req)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported protocol: {req.protocol}")

        status = result.get("status", "pending")

        db_log_travel_rule(
            message_id=message_id,
            transaction_id=req.transaction_id,
            protocol=req.protocol,
            direction="outbound",
            status=status,
            originator_vasp=req.originator_vasp,
            beneficiary_vasp=req.beneficiary_vasp,
            originator_data=req.originator.model_dump(),
            beneficiary_data=req.beneficiary.model_dump(),
            amount=req.amount,
            currency=req.currency,
            raw_payload=req.model_dump(),
            response_payload=result,
        )

        return TravelRuleResponse(
            message_id=message_id,
            transaction_id=req.transaction_id,
            status=status,
            protocol=req.protocol,
            originator_vasp=req.originator_vasp,
            beneficiary_vasp=req.beneficiary_vasp,
            submitted_at=datetime.now(timezone.utc).isoformat(),
            note=f"Travel Rule data transmitted via {req.protocol.upper()}. Counterparty VASP: {req.beneficiary_vasp}",
        )

    except httpx.HTTPStatusError as e:
        db_log_travel_rule(
            message_id=message_id,
            transaction_id=req.transaction_id,
            protocol=req.protocol,
            direction="outbound",
            status="failed",
            originator_vasp=req.originator_vasp,
            beneficiary_vasp=req.beneficiary_vasp,
            originator_data=req.originator.model_dump(),
            beneficiary_data=req.beneficiary.model_dump(),
            amount=req.amount,
            currency=req.currency,
            raw_payload=req.model_dump(),
            error=str(e),
        )
        raise HTTPException(
            status_code=502,
            detail=f"Travel Rule transmission failed via {req.protocol}: {str(e)}",
        )

@app.post("/travel-rule/receive")
async def receive_travel_rule(data: dict):
    """Inbound Travel Rule message handler."""
    message_id = data.get("message_id") or f"TR-IN-{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.urandom(4).hex().upper()}"
    protocol = data.get("protocol", "unknown")

    db_log_travel_rule(
        message_id=message_id,
        transaction_id=data.get("transaction_id", "unknown"),
        protocol=protocol,
        direction="inbound",
        status="received",
        originator_vasp=data.get("originator_vasp"),
        beneficiary_vasp=data.get("beneficiary_vasp"),
        originator_data=data.get("originator"),
        beneficiary_data=data.get("beneficiary"),
        amount=float(data.get("amount", 0)),
        currency=data.get("currency", "USD"),
        raw_payload=data,
    )

    return {
        "message_id": message_id,
        "status": "received",
        "protocol": protocol,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "next_steps": [
            "Validate originator and beneficiary data",
            "Perform sanctions screening on both parties",
            "Check transaction against internal risk thresholds",
            "Approve or reject via /travel-rule/respond",
        ],
    }

@app.post("/travel-rule/respond/{message_id}")
async def respond_travel_rule(message_id: str, response: dict):
    """Respond to an inbound Travel Rule request."""
    action = response.get("action", "reject")  # approve | reject
    reason = response.get("reason", "")

    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE travel_rule_messages
               SET status = %s, response_payload = %s, updated_at = NOW(),
               completed_at = CASE WHEN %s IN ('approved', 'rejected') THEN NOW() ELSE completed_at END
               WHERE message_id = %s""",
            (action, psycopg2.extras.Json(response), action, message_id)
        )

    return {
        "message_id": message_id,
        "action": action,
        "reason": reason,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/travel-rule/status/{message_id}")
async def get_travel_rule_status(message_id: str):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT message_id, transaction_id, protocol, direction, status,
               originator_vasp, beneficiary_vasp, amount, currency, created_at, updated_at
               FROM travel_rule_messages WHERE message_id = %s""",
            (message_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Travel Rule message not found")

        return {
            "message_id": row[0],
            "transaction_id": row[1],
            "protocol": row[2],
            "direction": row[3],
            "status": row[4],
            "originator_vasp": row[5],
            "beneficiary_vasp": row[6],
            "amount": row[7],
            "currency": row[8],
            "created_at": row[9].isoformat() if row[9] else None,
            "updated_at": row[10].isoformat() if row[10] else None,
        }

@app.post("/vasps/register")
async def register_vasp(req: VASPRegistration):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO travel_rule_vasps
               (vasp_id, vasp_name, vasp_did, trisa_endpoint, sygna_vasp_code, openvasp_node_id, supported_protocols)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (vasp_id) DO UPDATE SET
               vasp_name = EXCLUDED.vasp_name,
               vasp_did = EXCLUDED.vasp_did,
               trisa_endpoint = EXCLUDED.trisa_endpoint,
               sygna_vasp_code = EXCLUDED.sygna_vasp_code,
               openvasp_node_id = EXCLUDED.openvasp_node_id,
               supported_protocols = EXCLUDED.supported_protocols""",
            (req.vasp_id, req.vasp_name, req.vasp_did, req.trisa_endpoint,
             req.sygna_vasp_code, req.openvasp_node_id, req.supported_protocols)
        )

    return {
        "vasp_id": req.vasp_id,
        "status": "registered",
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/vasps/{vasp_id}")
async def get_vasp(vasp_id: str):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT vasp_id, vasp_name, vasp_did, trisa_endpoint, sygna_vasp_code, openvasp_node_id, supported_protocols, is_active FROM travel_rule_vasps WHERE vasp_id = %s",
            (vasp_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="VASP not found")

        return {
            "vasp_id": row[0],
            "vasp_name": row[1],
            "vasp_did": row[2],
            "trisa_endpoint": row[3],
            "sygna_vasp_code": row[4],
            "openvasp_node_id": row[5],
            "supported_protocols": row[6],
            "is_active": row[7],
        }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8098"))
    logger.info(f"Starting travel-rule v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
