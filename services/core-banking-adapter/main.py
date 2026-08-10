"""
RemitFlow Core Banking Adapter v2.1
Production integration with Treasury Prime BaaS API
Port: 8092

REQUIRED:
  - TREASURY_PRIME_API_KEY
  - TREASURY_PRIME_API_SECRET
  - TREASURY_PRIME_BASE_URL (default: https://api.treasuryprime.com)
  - DATABASE_URL

FAIL-CLOSED:
  If Treasury Prime credentials are missing or placeholders, returns HTTP 503.
"""
from __future__ import annotations

import base64
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
                    error TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_cb_events_type ON core_banking_events(event_type, created_at);
                CREATE TABLE IF NOT EXISTS core_banking_accounts (
                    account_id TEXT PRIMARY KEY,
                    tp_account_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    account_type TEXT NOT NULL DEFAULT 'checking',
                    currency TEXT NOT NULL DEFAULT 'USD',
                    status TEXT NOT NULL DEFAULT 'active',
                    balance_cents BIGINT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_cb_accounts_user ON core_banking_accounts(user_id);
                CREATE TABLE IF NOT EXISTS core_banking_transfers (
                    transfer_id TEXT PRIMARY KEY,
                    tp_transfer_id TEXT,
                    source_account_id TEXT NOT NULL,
                    destination_account_id TEXT NOT NULL,
                    amount_cents BIGINT NOT NULL,
                    currency TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    reference TEXT,
                    provider_response JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)
    return _db_pool

def db_log_event(event_type, account_id, payload, provider_response=None, error=None):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO core_banking_events (event_type, account_id, payload, provider_response, error)
               VALUES (%s, %s, %s, %s, %s)""",
            (event_type, account_id, psycopg2.extras.Json(payload or {}),
             psycopg2.extras.Json(provider_response) if provider_response else None, error)
        )

def db_create_account(account_id, tp_account_id, user_id, account_type, currency):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO core_banking_accounts (account_id, tp_account_id, user_id, account_type, currency)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (account_id) DO UPDATE SET
               tp_account_id = EXCLUDED.tp_account_id,
               updated_at = NOW()""",
            (account_id, tp_account_id, user_id, account_type, currency)
        )

def db_create_transfer(transfer_id, tp_transfer_id, source_id, dest_id, amount_cents, currency, status, reference, provider_response):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO core_banking_transfers
               (transfer_id, tp_transfer_id, source_account_id, destination_account_id, amount_cents, currency, status, reference, provider_response)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (transfer_id, tp_transfer_id, source_id, dest_id, amount_cents, currency, status, reference,
             psycopg2.extras.Json(provider_response) if provider_response else None)
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[CORE-BANKING] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow Core Banking Adapter",
    description="Treasury Prime BaaS integration for virtual accounts, cards, and transfers",
    version="2.1.0",
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

# ─── Treasury Prime Configuration ────────────────────────────────────────────
TP_API_KEY = os.getenv("TREASURY_PRIME_API_KEY", "").strip()
TP_API_SECRET = os.getenv("TREASURY_PRIME_API_SECRET", "").strip()
TP_BASE_URL = os.getenv("TREASURY_PRIME_BASE_URL", "https://api.treasuryprime.com").strip()

_PLACEHOLDERS = {"test", "changeme", "placeholder", "your_", "example", "demo", "sandbox", "fake"}

def _validate_config():
    if not TP_API_KEY:
        raise RuntimeError("TREASURY_PRIME_API_KEY is not set")
    if not TP_API_SECRET:
        raise RuntimeError("TREASURY_PRIME_API_SECRET is not set")
    for val, name in [(TP_API_KEY, "API_KEY"), (TP_API_SECRET, "API_SECRET")]:
        lower = val.lower()
        if any(p in lower for p in _PLACEHOLDERS):
            raise RuntimeError(f"TREASURY_PRIME_{name} appears to contain a placeholder: {val}")

try:
    _validate_config()
    _config_valid = True
    logger.info("Treasury Prime configuration validated")
except RuntimeError as e:
    logger.error(f"Treasury Prime configuration invalid: {e}")
    _config_valid = False

# ─── Treasury Prime Client ─────────────────────────────────────────────────────

class TreasuryPrimeClient:
    def __init__(self):
        self.base_url = TP_BASE_URL.rstrip("/")
        self.auth = base64.b64encode(f"{TP_API_KEY}:{TP_API_SECRET}".encode()).decode()

    async def _request(self, method: str, path: str, json_data: dict = None) -> dict:
        if not _config_valid:
            raise HTTPException(status_code=503, detail="Treasury Prime not configured")

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(
                method=method,
                url=f"{self.base_url}{path}",
                headers={
                    "Authorization": f"Basic {self.auth}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=json_data,
            )
            resp.raise_for_status()
            return resp.json()

    async def create_account(self, person_id: str, account_type: str = "checking") -> dict:
        return await self._request("POST", "/account", {
            "person_id": person_id,
            "account_type": account_type,
        })

    async def get_account(self, account_id: str) -> dict:
        return await self._request("GET", f"/account/{account_id}")

    async def get_balance(self, account_id: str) -> dict:
        return await self._request("GET", f"/account/{account_id}/balance")

    async def create_transfer(self, from_account: str, to_account: str, amount: str, description: str = "") -> dict:
        return await self._request("POST", "/transfer", {
            "from_account_id": from_account,
            "to_account_id": to_account,
            "amount": amount,
            "description": description,
        })

    async def get_transfer(self, transfer_id: str) -> dict:
        return await self._request("GET", f"/transfer/{transfer_id}")

    async def create_person(self, first_name: str, last_name: str, email: str, phone: str, address: dict) -> dict:
        return await self._request("POST", "/person", {
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
            "phone": phone,
            "address": address,
        })

_tp_client: Optional[TreasuryPrimeClient] = None

def get_tp_client() -> TreasuryPrimeClient:
    global _tp_client
    if _tp_client is None:
        _tp_client = TreasuryPrimeClient()
    return _tp_client

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class CreatePersonRequest(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., pattern=r"^[^@]+@[^@]+\.[^@]+$")
    phone: str = Field(..., pattern=r"^\+?[1-9]\d{1,14}$")
    street: str
    city: str
    state: str
    postal_code: str
    country: str = Field(default="US", min_length=2, max_length=2)

class CreateAccountRequest(BaseModel):
    person_id: str
    user_id: str
    account_type: str = Field(default="checking", pattern=r"^(checking|savings)$")
    currency: str = Field(default="USD", min_length=3, max_length=3)

class TransferRequest(BaseModel):
    source_account_id: str
    destination_account_id: str
    amount: float = Field(..., gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    reference: Optional[str] = None
    description: Optional[str] = None

class AccountLookupRequest(BaseModel):
    account_id: str

class BalanceRequest(BaseModel):
    account_id: str

# ─── Handlers ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok" if _config_valid else "degraded",
        "service": "core-banking-adapter",
        "version": "2.1.0",
        "provider": "treasury_prime",
        "provider_configured": _config_valid,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/persons")
async def create_person(req: CreatePersonRequest):
    tp = get_tp_client()
    try:
        result = await tp.create_person(
            first_name=req.first_name,
            last_name=req.last_name,
            email=req.email,
            phone=req.phone,
            address={
                "street": req.street,
                "city": req.city,
                "state": req.state,
                "postal_code": req.postal_code,
                "country": req.country,
            },
        )
        db_log_event("person_created", None, req.model_dump(), result)
        return {"success": True, "person": result}
    except httpx.HTTPStatusError as e:
        db_log_event("person_create_failed", None, req.model_dump(), error=str(e))
        raise HTTPException(status_code=e.response.status_code, detail=f"Treasury Prime error: {e.response.text}")

@app.post("/accounts")
async def create_account(req: CreateAccountRequest):
    tp = get_tp_client()
    try:
        result = await tp.create_account(person_id=req.person_id, account_type=req.account_type)
        tp_account_id = result.get("id")

        # Generate internal account ID
        internal_id = f"RF-{req.user_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        db_create_account(internal_id, tp_account_id, req.user_id, req.account_type, req.currency)
        db_log_event("account_created", internal_id, req.model_dump(), result)

        return {
            "success": True,
            "account_id": internal_id,
            "tp_account_id": tp_account_id,
            "account_type": req.account_type,
            "currency": req.currency,
            "status": "active",
        }
    except httpx.HTTPStatusError as e:
        db_log_event("account_create_failed", None, req.model_dump(), error=str(e))
        raise HTTPException(status_code=e.response.status_code, detail=f"Treasury Prime error: {e.response.text}")

@app.post("/accounts/lookup")
async def lookup_account(req: AccountLookupRequest):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT account_id, tp_account_id, user_id, account_type, currency, status, balance_cents FROM core_banking_accounts WHERE account_id = %s",
            (req.account_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Account not found")

        account_id, tp_account_id, user_id, account_type, currency, status, balance_cents = row

        # Fetch live balance from Treasury Prime
        tp = get_tp_client()
        try:
            tp_account = await tp.get_account(tp_account_id)
            live_balance = tp_account.get("balance", "0")
            live_balance_cents = int(float(live_balance) * 100)

            # Update cached balance
            cur.execute(
                "UPDATE core_banking_accounts SET balance_cents = %s, updated_at = NOW() WHERE account_id = %s",
                (live_balance_cents, req.account_id)
            )
        except Exception as e:
            logger.warning(f"Could not fetch live balance from TP: {e}")
            live_balance_cents = balance_cents

        return {
            "account_id": account_id,
            "tp_account_id": tp_account_id,
            "user_id": user_id,
            "account_type": account_type,
            "currency": currency,
            "status": status,
            "balance": live_balance_cents / 100.0,
            "balance_cents": live_balance_cents,
        }

@app.post("/accounts/balance")
async def get_balance(req: BalanceRequest):
    return await lookup_account(AccountLookupRequest(account_id=req.account_id))

@app.post("/transfers")
async def create_transfer(req: TransferRequest):
    conn = _get_db()
    with conn.cursor() as cur:
        # Resolve internal IDs to Treasury Prime IDs
        cur.execute("SELECT tp_account_id FROM core_banking_accounts WHERE account_id = %s", (req.source_account_id,))
        src_row = cur.fetchone()
        if not src_row:
            raise HTTPException(status_code=404, detail="Source account not found")

        cur.execute("SELECT tp_account_id FROM core_banking_accounts WHERE account_id = %s", (req.destination_account_id,))
        dst_row = cur.fetchone()
        if not dst_row:
            raise HTTPException(status_code=404, detail="Destination account not found")

        src_tp_id = src_row[0]
        dst_tp_id = dst_row[0]

    tp = get_tp_client()
    amount_str = f"{req.amount:.2f}"

    try:
        result = await tp.create_transfer(
            from_account=src_tp_id,
            to_account=dst_tp_id,
            amount=amount_str,
            description=req.description or req.reference or "RemitFlow transfer",
        )

        transfer_id = f"RFTX-{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.urandom(4).hex().upper()}"
        tp_transfer_id = result.get("id")

        db_create_transfer(
            transfer_id=transfer_id,
            tp_transfer_id=tp_transfer_id,
            source_id=req.source_account_id,
            dest_id=req.destination_account_id,
            amount_cents=int(req.amount * 100),
            currency=req.currency,
            status="pending",
            reference=req.reference,
            provider_response=result,
        )
        db_log_event("transfer_created", transfer_id, req.model_dump(), result)

        return {
            "success": True,
            "transfer_id": transfer_id,
            "tp_transfer_id": tp_transfer_id,
            "status": "pending",
            "amount": req.amount,
            "currency": req.currency,
            "source_account_id": req.source_account_id,
            "destination_account_id": req.destination_account_id,
            "reference": req.reference,
        }
    except httpx.HTTPStatusError as e:
        db_log_event("transfer_create_failed", None, req.model_dump(), error=str(e))
        raise HTTPException(status_code=e.response.status_code, detail=f"Treasury Prime transfer error: {e.response.text}")

@app.get("/transfers/{transfer_id}")
async def get_transfer(transfer_id: str):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT transfer_id, tp_transfer_id, source_account_id, destination_account_id,
               amount_cents, currency, status, reference, provider_response, created_at
               FROM core_banking_transfers WHERE transfer_id = %s""",
            (transfer_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Transfer not found")

        return {
            "transfer_id": row[0],
            "tp_transfer_id": row[1],
            "source_account_id": row[2],
            "destination_account_id": row[3],
            "amount": row[4] / 100.0,
            "currency": row[5],
            "status": row[6],
            "reference": row[7],
            "provider_response": row[8],
            "created_at": row[9].isoformat() if row[9] else None,
        }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8092"))
    logger.info(f"Starting core-banking-adapter v2.1 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
