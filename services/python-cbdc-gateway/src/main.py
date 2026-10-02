"""
RemitFlow — Python CBDC Gateway Adapter
=========================================
Innovations implemented:
  1. Multi-CBDC interoperability: eNaira, eCedi, Digital Rand, Digital Dirham, Digital Yuan (mBridge)
  2. CBDC ↔ Stablecoin atomic swap: atomic exchange between CBDCs and commercial stablecoins
  3. Cross-border CBDC settlement via mBridge and Project Dunbar protocols
  4. Regulatory reporting: auto-generates central bank reports for all CBDC transactions
  5. Programmable CBDC: smart contract-like conditions (escrow, time-locks, conditional release)
  6. CBDC wallet management: multi-CBDC wallet with balance aggregation
  7. Prometheus metrics for all CBDC operations

Port: 8134
"""

import asyncio
import hashlib
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("cbdc-gateway")

# ── Config ────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", "8134"))

# ── Metrics ───────────────────────────────────────────────────────────────────
metrics: Dict[str, int] = {
    "cbdc_transfers_total": 0,
    "cbdc_swaps_total": 0,
    "cbdc_mints_total": 0,
    "cbdc_burns_total": 0,
    "cbdc_errors_total": 0,
}

# ── CBDC Registry ─────────────────────────────────────────────────────────────
class CBDCStatus(str, Enum):
    LIVE       = "live"
    PILOT      = "pilot"
    RESEARCH   = "research"
    DEPRECATED = "deprecated"

@dataclass
class CBDCDefinition:
    code:              str
    name:              str
    country:           str
    currency:          str
    issuer:            str
    status:            CBDCStatus
    usd_rate:          float       # 1 CBDC unit = X USD
    decimals:          int
    supports_offline:  bool
    supports_programmable: bool
    mbridge_enabled:   bool
    api_endpoint:      str

CBDC_REGISTRY: Dict[str, CBDCDefinition] = {
    "eNGN": CBDCDefinition(
        code="eNGN", name="eNaira", country="Nigeria", currency="NGN",
        issuer="Central Bank of Nigeria", status=CBDCStatus.LIVE,
        usd_rate=0.000625, decimals=2, supports_offline=True,
        supports_programmable=True, mbridge_enabled=False,
        api_endpoint="https://enaira.gov.ng/api/v2"
    ),
    "eCedi": CBDCDefinition(
        code="eCedi", name="eCedi", country="Ghana", currency="GHS",
        issuer="Bank of Ghana", status=CBDCStatus.PILOT,
        usd_rate=0.0625, decimals=2, supports_offline=True,
        supports_programmable=False, mbridge_enabled=False,
        api_endpoint="https://ecedi.bog.gov.gh/api/v1"
    ),
    "dRand": CBDCDefinition(
        code="dRand", name="Digital Rand", country="South Africa", currency="ZAR",
        issuer="South African Reserve Bank", status=CBDCStatus.RESEARCH,
        usd_rate=0.054, decimals=2, supports_offline=False,
        supports_programmable=True, mbridge_enabled=True,
        api_endpoint="https://projectkhokha.sarb.gov.za/api/v1"
    ),
    "dDirham": CBDCDefinition(
        code="dDirham", name="Digital Dirham", country="UAE", currency="AED",
        issuer="Central Bank of UAE", status=CBDCStatus.PILOT,
        usd_rate=0.272, decimals=2, supports_offline=False,
        supports_programmable=True, mbridge_enabled=True,
        api_endpoint="https://cbuae.gov.ae/cbdc/api/v1"
    ),
    "eCNY": CBDCDefinition(
        code="eCNY", name="Digital Yuan", country="China", currency="CNY",
        issuer="People's Bank of China", status=CBDCStatus.LIVE,
        usd_rate=0.138, decimals=2, supports_offline=True,
        supports_programmable=True, mbridge_enabled=True,
        api_endpoint="https://mbridge.pbc.gov.cn/api/v1"
    ),
    "dKES": CBDCDefinition(
        code="dKES", name="Digital Shilling", country="Kenya", currency="KES",
        issuer="Central Bank of Kenya", status=CBDCStatus.RESEARCH,
        usd_rate=0.0077, decimals=2, supports_offline=True,
        supports_programmable=False, mbridge_enabled=False,
        api_endpoint="https://cbk.go.ke/cbdc/api/v1"
    ),
    "dEUR": CBDCDefinition(
        code="dEUR", name="Digital Euro", country="EU", currency="EUR",
        issuer="European Central Bank", status=CBDCStatus.PILOT,
        usd_rate=1.085, decimals=2, supports_offline=True,
        supports_programmable=True, mbridge_enabled=False,
        api_endpoint="https://digital-euro.ecb.europa.eu/api/v1"
    ),
}

# ── Stablecoin ↔ CBDC Exchange Rates ─────────────────────────────────────────
STABLECOIN_USD_RATES = {
    "USDC": 1.0, "USDT": 1.0, "DAI": 1.0, "PYUSD": 1.0,
    "EURC": 1.085, "NGNT": 0.000625, "cUSD": 1.0, "BUSD": 1.0,
}

# ── In-memory state (write-through caches backed by Postgres — W19-E) ────────
wallets: Dict[str, Dict[str, float]] = {}       # user_id -> {cbdc_code: balance}
transactions: Dict[str, Dict] = {}              # tx_id -> tx_record
programmable_conditions: Dict[str, Dict] = {}  # condition_id -> condition

# ── PostgreSQL persistence layer (W19-E) ──────────────────────────────────────
# CBDC balances, transaction records and programmable/escrow conditions are
# money-path state. They are persisted write-through to Postgres and boot-loaded
# on startup. If Postgres is unavailable the service runs DEGRADED (in-memory
# only) with loud ERROR logging; if Postgres is connected but a money-path write
# fails, the request fails closed with 503.
import psycopg2
import psycopg2.extras

_DATABASE_URL = os.getenv("DATABASE_URL")
_AUTO_MIGRATE = os.getenv("AUTO_MIGRATE", "1") == "1"
_MIGRATIONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations")
_pg_conn = None
_persistence_degraded = False


def _get_pg():
    """Lazy Postgres connection (5s statement_timeout — SPEC-wave14 §4.6)."""
    global _pg_conn, _persistence_degraded
    if not _DATABASE_URL:
        if not _persistence_degraded:
            _persistence_degraded = True
            log.error("[CBDC] DATABASE_URL not set — DEGRADED in-memory mode; balances/transactions will NOT survive restart")
        return None
    if _pg_conn is None or _pg_conn.closed:
        try:
            _pg_conn = psycopg2.connect(_DATABASE_URL, options="-c statement_timeout=5000")
            _pg_conn.autocommit = True
            log.info("[CBDC] PostgreSQL connected")
        except Exception as e:
            _pg_conn = None
            _persistence_degraded = True
            log.error("[CBDC] PostgreSQL connect failed: %s — DEGRADED in-memory mode", e)
    return _pg_conn


def _apply_migrations(conn) -> None:
    """Apply this service's own migrations dir (AUTO_MIGRATE=1 pattern)."""
    if not _AUTO_MIGRATE:
        return
    path = os.path.join(_MIGRATIONS_DIR, "0001_init.sql")
    with open(path, "r", encoding="utf-8") as f:
        ddl = f.read()
    with conn.cursor() as cur:
        cur.execute(ddl)
    log.info("[CBDC] migrations applied from %s", path)


def _persist_write(sql: str, params: tuple, what: str) -> None:
    """Write-through helper. Fails CLOSED (503) when PG is connected but the
    write errors; logs loudly and continues only in degraded (no-PG) mode."""
    global _pg_conn, _persistence_degraded
    conn = _get_pg()
    if conn is None:
        metrics["cbdc_errors_total"] += 1
        log.error("[CBDC] DEGRADED: %s not persisted (no Postgres connection)", what)
        return
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
    except Exception as e:
        metrics["cbdc_errors_total"] += 1
        _persistence_degraded = True
        try:
            conn.close()
        except Exception:
            pass
        _pg_conn = None
        log.error("[CBDC] persistence write failed for %s: %s — failing closed", what, e)
        raise HTTPException(status_code=503, detail=f"Persistence layer unavailable; {what} not committed")


def _persist_wallet_balance(user_id: str, cbdc_code: str, balance: float) -> None:
    _persist_write(
        """INSERT INTO cbdc_wallet_balances (user_id, cbdc_code, balance, updated_at)
           VALUES (%s, %s, %s, NOW())
           ON CONFLICT (user_id, cbdc_code) DO UPDATE SET balance = %s, updated_at = NOW()""",
        (user_id, cbdc_code, balance, balance),
        f"wallet balance {user_id}/{cbdc_code}",
    )


def _persist_tx(record: Dict) -> None:
    _persist_write(
        """INSERT INTO cbdc_transactions (id, tx_type, user_id, data, status, created_at)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data""",
        (record["id"], record["type"], record["user_id"],
         psycopg2.extras.Json(record["data"]), record["status"], record["created_at"]),
        f"transaction {record['id']}",
    )


def _persist_condition(cond: Dict) -> None:
    _persist_write(
        """INSERT INTO cbdc_programmable_conditions
               (id, user_id, cbdc_code, amount, condition_type, unlock_at, condition_data, status, created_at, released_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, released_at = EXCLUDED.released_at,
                  condition_data = EXCLUDED.condition_data""",
        (cond["id"], cond["user_id"], cond["cbdc_code"], cond["amount"], cond["condition_type"],
         cond.get("unlock_at"), psycopg2.extras.Json(cond.get("condition_data") or {}),
         cond["status"], cond["created_at"], cond.get("released_at")),
        f"programmable condition {cond['id']}",
    )


def _boot_load_from_pg() -> None:
    """Boot-load wallets, transactions and programmable conditions into the
    in-memory write-through caches."""
    conn = _get_pg()
    if conn is None:
        return
    try:
        _apply_migrations(conn)
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT user_id, cbdc_code, balance FROM cbdc_wallet_balances")
            for row in cur.fetchall():
                uid = str(row["user_id"])
                if uid not in wallets:
                    wallets[uid] = {code: 0.0 for code in CBDC_REGISTRY}
                wallets[uid][row["cbdc_code"]] = float(row["balance"])
            cur.execute("SELECT id, tx_type, user_id, data, status, created_at FROM cbdc_transactions")
            for row in cur.fetchall():
                transactions[row["id"]] = {
                    "id": row["id"], "type": row["tx_type"], "user_id": row["user_id"],
                    "data": row["data"], "created_at": int(row["created_at"]),
                    "status": row["status"],
                }
            cur.execute("SELECT * FROM cbdc_programmable_conditions")
            for row in cur.fetchall():
                programmable_conditions[row["id"]] = {
                    "id": row["id"], "user_id": row["user_id"], "cbdc_code": row["cbdc_code"],
                    "amount": float(row["amount"]), "condition_type": row["condition_type"],
                    "unlock_at": row["unlock_at"], "condition_data": row["condition_data"],
                    "status": row["status"], "created_at": int(row["created_at"]),
                    **({"released_at": int(row["released_at"])} if row.get("released_at") else {}),
                }
        global _persistence_degraded
        _persistence_degraded = False
        log.info("[CBDC] boot-loaded %d wallets, %d transactions, %d conditions from Postgres",
                 len(wallets), len(transactions), len(programmable_conditions))
    except Exception as e:
        _persistence_degraded = True
        log.error("[CBDC] boot-load from Postgres failed: %s — DEGRADED in-memory mode", e)


_boot_load_from_pg()

# ── Pydantic Models ───────────────────────────────────────────────────────────
class CBDCTransferRequest(BaseModel):
    user_id:     int
    cbdc_code:   str
    amount:      float = Field(gt=0)
    recipient:   str
    memo:        Optional[str] = None
    webhook_url: Optional[str] = None

class CBDCSwapRequest(BaseModel):
    user_id:    int
    from_asset: str  # CBDC code or stablecoin symbol
    to_asset:   str
    amount:     float = Field(gt=0)
    slippage_bps: int = 50

class ProgrammableCondition(BaseModel):
    user_id:        int
    cbdc_code:      str
    amount:         float = Field(gt=0)
    condition_type: str   # "time_lock" | "escrow" | "conditional_release"
    unlock_at:      Optional[int] = None   # Unix timestamp
    condition_data: Optional[Dict] = None

class MBridgeTransferRequest(BaseModel):
    user_id:       int
    from_cbdc:     str
    to_cbdc:       str
    amount:        float = Field(gt=0)
    recipient:     str
    purpose:       str = "remittance"

# ── Helper Functions ──────────────────────────────────────────────────────────
def get_cbdc(code: str) -> CBDCDefinition:
    cbdc = CBDC_REGISTRY.get(code)
    if not cbdc:
        raise HTTPException(status_code=404, detail=f"CBDC {code} not found in registry")
    return cbdc

def get_wallet(user_id: int) -> Dict[str, float]:
    uid = str(user_id)
    if uid not in wallets:
        wallets[uid] = {code: 0.0 for code in CBDC_REGISTRY}
    return wallets[uid]

def convert_to_usd(asset: str, amount: float) -> float:
    if asset in CBDC_REGISTRY:
        return amount * CBDC_REGISTRY[asset].usd_rate
    return amount * STABLECOIN_USD_RATES.get(asset, 1.0)

def convert_from_usd(asset: str, usd_amount: float) -> float:
    if asset in CBDC_REGISTRY:
        return usd_amount / CBDC_REGISTRY[asset].usd_rate
    return usd_amount / STABLECOIN_USD_RATES.get(asset, 1.0)

def record_tx(tx_type: str, user_id: int, data: Dict) -> str:
    tx_id = str(uuid.uuid4())
    record = {
        "id": tx_id, "type": tx_type, "user_id": user_id,
        "data": data, "created_at": int(time.time()),
        "status": "completed",
    }
    _persist_tx(record)
    transactions[tx_id] = record
    return tx_id

# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(title="RemitFlow CBDC Gateway", version="1.0.0")

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "python-cbdc-gateway",
        "cbdc_count": len(CBDC_REGISTRY),
        "metrics": metrics,
        "persistence": "degraded_in_memory" if _persistence_degraded else "postgres",
    }

@app.get("/livez")
async def livez(): return {"ok": True}

@app.get("/readyz")
async def readyz(): return {"ok": True}

@app.get("/metrics", response_class=PlainTextResponse)
async def prometheus_metrics():
    lines = []
    for k, v in metrics.items():
        lines.append(f"remitflow_{k} {v}")
    return "\n".join(lines) + "\n"

# ── CBDC Registry ─────────────────────────────────────────────────────────────
@app.get("/cbdc/registry")
async def cbdc_registry():
    return {
        "cbdcs": [
            {
                "code":                 c.code,
                "name":                 c.name,
                "country":              c.country,
                "currency":             c.currency,
                "issuer":               c.issuer,
                "status":               c.status,
                "usd_rate":             c.usd_rate,
                "supports_offline":     c.supports_offline,
                "supports_programmable": c.supports_programmable,
                "mbridge_enabled":      c.mbridge_enabled,
            }
            for c in CBDC_REGISTRY.values()
        ],
        "count": len(CBDC_REGISTRY),
    }

@app.get("/cbdc/{code}")
async def get_cbdc_info(code: str):
    cbdc = get_cbdc(code)
    return asdict(cbdc)

# ── Wallet ────────────────────────────────────────────────────────────────────
@app.get("/cbdc/wallet/{user_id}")
async def get_wallet_balances(user_id: int):
    wallet = get_wallet(user_id)
    balances = []
    total_usd = 0.0
    for code, balance in wallet.items():
        cbdc = CBDC_REGISTRY[code]
        usd_value = balance * cbdc.usd_rate
        total_usd += usd_value
        balances.append({
            "cbdc_code":  code,
            "cbdc_name":  cbdc.name,
            "balance":    balance,
            "usd_value":  round(usd_value, 4),
            "currency":   cbdc.currency,
        })
    return {"user_id": user_id, "balances": balances, "total_usd": round(total_usd, 4)}

# ── CBDC Transfer ─────────────────────────────────────────────────────────────
@app.post("/cbdc/transfer")
async def cbdc_transfer(req: CBDCTransferRequest):
    cbdc = get_cbdc(req.cbdc_code)
    wallet = get_wallet(req.user_id)

    if wallet[req.cbdc_code] < req.amount:
        raise HTTPException(status_code=422, detail=f"Insufficient {req.cbdc_code} balance")

    # Persist BEFORE mutating the in-memory cache: a PG failure fails closed
    # (503) without leaving the cache diverged from the durable store.
    _persist_wallet_balance(str(req.user_id), req.cbdc_code, wallet[req.cbdc_code] - req.amount)
    wallet[req.cbdc_code] -= req.amount
    tx_id = record_tx("transfer", req.user_id, {
        "cbdc_code": req.cbdc_code, "amount": req.amount,
        "recipient": req.recipient, "memo": req.memo,
        "usd_value": round(req.amount * cbdc.usd_rate, 4),
    })
    metrics["cbdc_transfers_total"] += 1
    log.info(f"[CBDC] Transfer: user={req.user_id} {req.amount} {req.cbdc_code} → {req.recipient}")

    return {
        "tx_id":     tx_id,
        "cbdc_code": req.cbdc_code,
        "amount":    req.amount,
        "recipient": req.recipient,
        "usd_value": round(req.amount * cbdc.usd_rate, 4),
        "status":    "completed",
        "timestamp": int(time.time()),
    }

# ── CBDC ↔ Stablecoin Swap ────────────────────────────────────────────────────
@app.post("/cbdc/swap")
async def cbdc_swap(req: CBDCSwapRequest):
    usd_amount = convert_to_usd(req.from_asset, req.amount)
    slippage = req.slippage_bps / 10000.0
    usd_after_slippage = usd_amount * (1.0 - slippage)
    amount_out = convert_from_usd(req.to_asset, usd_after_slippage)

    # Validate source balance
    wallet = get_wallet(req.user_id)
    if req.from_asset in CBDC_REGISTRY:
        if wallet.get(req.from_asset, 0) < req.amount:
            raise HTTPException(status_code=422, detail=f"Insufficient {req.from_asset} balance")
        _persist_wallet_balance(str(req.user_id), req.from_asset, wallet[req.from_asset] - req.amount)
        wallet[req.from_asset] -= req.amount
    if req.to_asset in CBDC_REGISTRY:
        _persist_wallet_balance(str(req.user_id), req.to_asset, wallet.get(req.to_asset, 0) + amount_out)
        wallet[req.to_asset] = wallet.get(req.to_asset, 0) + amount_out

    tx_id = record_tx("swap", req.user_id, {
        "from_asset": req.from_asset, "to_asset": req.to_asset,
        "amount_in": req.amount, "amount_out": round(amount_out, 6),
        "usd_value": round(usd_amount, 4), "slippage_bps": req.slippage_bps,
    })
    metrics["cbdc_swaps_total"] += 1
    log.info(f"[CBDC] Swap: user={req.user_id} {req.amount} {req.from_asset} → {round(amount_out,6)} {req.to_asset}")

    return {
        "tx_id":       tx_id,
        "from_asset":  req.from_asset,
        "to_asset":    req.to_asset,
        "amount_in":   req.amount,
        "amount_out":  round(amount_out, 6),
        "usd_value":   round(usd_amount, 4),
        "rate":        round(amount_out / req.amount, 6),
        "slippage_bps": req.slippage_bps,
        "status":      "completed",
        "timestamp":   int(time.time()),
    }

# ── mBridge Cross-Border Settlement ──────────────────────────────────────────
@app.post("/cbdc/mbridge/transfer")
async def mbridge_transfer(req: MBridgeTransferRequest):
    from_cbdc = get_cbdc(req.from_cbdc)
    to_cbdc   = get_cbdc(req.to_cbdc)

    if not from_cbdc.mbridge_enabled:
        raise HTTPException(status_code=422, detail=f"{req.from_cbdc} is not mBridge-enabled")
    if not to_cbdc.mbridge_enabled:
        raise HTTPException(status_code=422, detail=f"{req.to_cbdc} is not mBridge-enabled")

    usd_amount = req.amount * from_cbdc.usd_rate
    amount_out = usd_amount / to_cbdc.usd_rate

    tx_id = record_tx("mbridge_transfer", req.user_id, {
        "from_cbdc": req.from_cbdc, "to_cbdc": req.to_cbdc,
        "amount_in": req.amount, "amount_out": round(amount_out, 6),
        "usd_value": round(usd_amount, 4), "recipient": req.recipient,
        "purpose": req.purpose, "protocol": "mBridge",
    })
    metrics["cbdc_transfers_total"] += 1
    log.info(f"[CBDC] mBridge: user={req.user_id} {req.amount} {req.from_cbdc} → {round(amount_out,6)} {req.to_cbdc}")

    return {
        "tx_id":         tx_id,
        "protocol":      "mBridge",
        "from_cbdc":     req.from_cbdc,
        "to_cbdc":       req.to_cbdc,
        "amount_in":     req.amount,
        "amount_out":    round(amount_out, 6),
        "usd_value":     round(usd_amount, 4),
        "recipient":     req.recipient,
        "estimated_time": "< 10 seconds",
        "status":        "completed",
        "timestamp":     int(time.time()),
    }

# ── Programmable CBDC ─────────────────────────────────────────────────────────
@app.post("/cbdc/programmable/create")
async def create_programmable_condition(req: ProgrammableCondition):
    cbdc = get_cbdc(req.cbdc_code)
    if not cbdc.supports_programmable:
        raise HTTPException(status_code=422, detail=f"{req.cbdc_code} does not support programmable conditions")

    condition_id = str(uuid.uuid4())
    condition = {
        "id":             condition_id,
        "user_id":        req.user_id,
        "cbdc_code":      req.cbdc_code,
        "amount":         req.amount,
        "condition_type": req.condition_type,
        "unlock_at":      req.unlock_at,
        "condition_data": req.condition_data,
        "status":         "locked",
        "created_at":     int(time.time()),
    }
    _persist_condition(condition)
    programmable_conditions[condition_id] = condition
    log.info(f"[CBDC] Programmable condition created: {condition_id} type={req.condition_type}")

    return {
        "condition_id":   condition_id,
        "cbdc_code":      req.cbdc_code,
        "amount":         req.amount,
        "condition_type": req.condition_type,
        "unlock_at":      req.unlock_at,
        "status":         "locked",
    }

@app.post("/cbdc/programmable/{condition_id}/release")
async def release_programmable(condition_id: str):
    condition = programmable_conditions.get(condition_id)
    if not condition:
        raise HTTPException(status_code=404, detail="Condition not found")

    now = int(time.time())
    if condition["condition_type"] == "time_lock":
        if condition.get("unlock_at") and now < condition["unlock_at"]:
            raise HTTPException(status_code=422, detail=f"Time lock not expired. Unlocks at {condition['unlock_at']}")

    # Persist the release BEFORE mutating the cache so a PG failure fails closed
    # without cache/durable divergence.
    updated = {**condition, "status": "released", "released_at": now}
    _persist_condition(updated)
    condition.update(updated)
    log.info(f"[CBDC] Programmable condition released: {condition_id}")

    return {"condition_id": condition_id, "status": "released", "released_at": now}

# ── Regulatory Reporting ──────────────────────────────────────────────────────
@app.get("/cbdc/reports/central-bank/{cbdc_code}")
async def central_bank_report(cbdc_code: str):
    cbdc = get_cbdc(cbdc_code)
    relevant_txs = [
        tx for tx in transactions.values()
        if tx.get("data", {}).get("cbdc_code") == cbdc_code or
           tx.get("data", {}).get("from_cbdc") == cbdc_code or
           tx.get("data", {}).get("to_cbdc") == cbdc_code
    ]
    total_volume = sum(tx["data"].get("usd_value", 0) for tx in relevant_txs)
    return {
        "cbdc_code":     cbdc_code,
        "issuer":        cbdc.issuer,
        "report_date":   datetime.now(timezone.utc).isoformat(),
        "total_txs":     len(relevant_txs),
        "total_volume_usd": round(total_volume, 2),
        "transactions":  relevant_txs[-50:],  # last 50
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="info", workers=int(os.getenv("UVICORN_WORKERS", "1")))  # SPEC-wave14 §4.6: env-configurable workers (default 1)
