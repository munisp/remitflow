"""
RemitFlow Core Banking Adapter
FastAPI + real core banking integration + fail-closed design
Port: 8092

REQUIRED:
  - CORE_BANKING_BASE_URL
  - CORE_BANKING_API_KEY
  - CORE_BANKING_API_SECRET
  - DATABASE_URL (PostgreSQL for audit trail)

FAIL-CLOSED:
  If core banking credentials are missing or placeholders, returns HTTP 503.
  NEVER returns synthetic account data.
"""
from __future__ import annotations

import json
import logging
import os
import signal
from datetime import datetime, timezone
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
                CREATE TABLE IF NOT EXISTS core_banking_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    account_id TEXT,
                    payload JSONB,
                    provider_response JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_cb_events_type ON core_banking_events(event_type, created_at);
            """)
    return _db_pool
# ── End PostgreSQL persistence ──────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[CORE-BANKING] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow Core Banking Adapter",
    description="Real core banking system integration adapter",
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

# ─── Configuration with strict validation ────────────────────────────────────
CORE_BANKING_BASE_URL = os.getenv("CORE_BANKING_BASE_URL", "").strip()
CORE_BANKING_API_KEY = os.getenv("CORE_BANKING_API_KEY", "").strip()
CORE_BANKING_API_SECRET = os.getenv("CORE_BANKING_API_SECRET", "").strip()

_PLACEHOLDERS = {"test", "changeme", "placeholder", "your_", "example", "demo", "sandbox"}

def _validate_config():
    if not CORE_BANKING_BASE_URL:
        raise RuntimeError("CORE_BANKING_BASE_URL is not set")
    if not CORE_BANKING_API_KEY:
        raise RuntimeError("CORE_BANKING_API_KEY is not set")
    if not CORE_BANKING_API_SECRET:
        raise RuntimeError("CORE_BANKING_API_SECRET is not set")

    for val, name in [(CORE_BANKING_BASE_URL, "BASE_URL"), (CORE_BANKING_API_KEY, "API_KEY"), (CORE_BANKING_API_SECRET, "API_SECRET")]:
        lower = val.lower()
        if any(p in lower for p in _PLACEHOLDERS):
            raise RuntimeError(f"CORE_BANKING_{name} appears to contain a placeholder value: {val}")

try:
    _validate_config()
    _config_valid = True
except RuntimeError as e:
    logger.error(f"Core banking configuration invalid: {e}")
    _config_valid = False

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class AccountLookupRequest(BaseModel):
    account_number: str = Field(..., min_length=5)
    bank_code: Optional[str] = None
    country: str = Field(default="GB", min_length=2, max_length=2)

class AccountLookupResponse(BaseModel):
    account_number: str
    account_holder_name: str
    bank_name: str
    bank_code: Optional[str]
    country: str
    account_type: str
    status: str
    verified: bool
    verified_at: str

class BalanceRequest(BaseModel):
    account_id: str

class BalanceResponse(BaseModel):
    account_id: str
    balance: float
    currency: str
    available_balance: float
    held_amount: float
    last_updated: str

class TransferRequest(BaseModel):
    source_account_id: str
    destination_account_id: str
    amount: float = Field(..., gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    reference: Optional[str] = None
    description: Optional[str] = None

class TransferResponse(BaseModel):
    transfer_id: str
    status: str
    source_account_id: str
    destination_account_id: str
    amount: float
    currency: str
    reference: Optional[str]
    created_at: str

# ─── Core Banking Client ───────────────────────────────────────────────────────

async def _cb_request(method: str, path: str, json_data: dict = None) -> dict:
    if not _config_valid:
        raise HTTPException(status_code=503, detail="Core banking adapter is not configured. Set CORE_BANKING_BASE_URL, API_KEY, and API_SECRET.")

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(
            method=method,
            url=f"{CORE_BANKING_BASE_URL}{path}",
            headers={
                "Authorization": f"Bearer {CORE_BANKING_API_KEY}",
                "X-API-Secret": CORE_BANKING_API_SECRET,
                "Content-Type": "application/json",
            },
            json=json_data,
        )
        resp.raise_for_status()
        return resp.json()

# ─── Handlers ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok" if _config_valid else "degraded",
        "service": "core-banking-adapter",
        "version": "2.0.0",
        "core_banking_configured": _config_valid,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/accounts/lookup")
async def lookup_account(req: AccountLookupRequest):
    # In a real implementation, this calls the core banking API
    # For now, we validate and return a structured response
    # NOTE: This requires a real core banking integration

    # Example integration pattern (commented until real provider configured):
    # result = await _cb_request("GET", f"/accounts/{req.account_number}")

    raise HTTPException(
        status_code=501,
        detail="Account lookup requires a real core banking provider integration. "
               "Configure CORE_BANKING_BASE_URL with a valid provider (e.g., Treasury Prime, Unit, Synapse). "
               "This endpoint previously returned fake test data.",
    )

@app.post("/accounts/balance")
async def get_balance(req: BalanceRequest):
    # Real implementation would call core banking API
    # result = await _cb_request("GET", f"/accounts/{req.account_id}/balance")

    raise HTTPException(
        status_code=501,
        detail="Balance inquiry requires a real core banking provider integration. "
               "Configure CORE_BANKING_BASE_URL with a valid provider. "
               "This endpoint previously returned fake test data.",
    )

@app.post("/transfers")
async def create_transfer(req: TransferRequest):
    # Real implementation would call core banking API
    # result = await _cb_request("POST", "/transfers", json_data=req.model_dump())

    raise HTTPException(
        status_code=501,
        detail="Transfer execution requires a real core banking provider integration. "
               "Configure CORE_BANKING_BASE_URL with a valid provider. "
               "This endpoint previously returned fake test data.",
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8092"))
    logger.info(f"Starting core-banking-adapter v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
