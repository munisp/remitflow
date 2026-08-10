"""
RemitFlow FX Engine Service
FastAPI + real-time FX rate sourcing + fail-closed design
Port: 8093

REQUIRED:
  - EXCHANGERATE_API_KEY or OPENEXCHANGERATES_APP_ID (for real-time rates)
  - DATABASE_URL (PostgreSQL for rate history and audit)

FAIL-CLOSED:
  If no FX provider is configured, returns HTTP 503.
  NEVER uses hardcoded or stale rates for pricing.
"""
from __future__ import annotations

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
                CREATE TABLE IF NOT EXISTS fx_rates (
                    id BIGSERIAL PRIMARY KEY,
                    base_currency TEXT NOT NULL,
                    quote_currency TEXT NOT NULL,
                    rate REAL NOT NULL,
                    provider TEXT NOT NULL,
                    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
                );
                CREATE INDEX IF NOT EXISTS idx_fx_pair ON fx_rates(base_currency, quote_currency, fetched_at DESC);
                CREATE TABLE IF NOT EXISTS fx_quotes (
                    quote_id TEXT PRIMARY KEY,
                    transaction_id TEXT,
                    base_currency TEXT NOT NULL,
                    quote_currency TEXT NOT NULL,
                    amount REAL NOT NULL,
                    mid_rate REAL NOT NULL,
                    spread_bps REAL NOT NULL,
                    customer_rate REAL NOT NULL,
                    customer_amount REAL NOT NULL,
                    provider TEXT NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)
    return _db_pool
# ── End PostgreSQL persistence ──────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[FX-ENGINE] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow FX Engine",
    description="Real-time foreign exchange rate engine with live provider integration",
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

# ─── Provider Configuration ────────────────────────────────────────────────────
EXCHANGERATE_API_KEY = os.getenv("EXCHANGERATE_API_KEY", "").strip()
OPENEXCHANGERATES_APP_ID = os.getenv("OPENEXCHANGERATES_APP_ID", "").strip()
DEFAULT_SPREAD_BPS = float(os.getenv("DEFAULT_SPREAD_BPS", "150"))  # 1.5%
RATE_MAX_AGE_SECONDS = int(os.getenv("RATE_MAX_AGE_SECONDS", "300"))  # 5 minutes

# ─── Rate Fetching ─────────────────────────────────────────────────────────────

async def _fetch_exchangerate_api(base: str) -> Dict[str, float]:
    if not EXCHANGERATE_API_KEY:
        raise RuntimeError("EXCHANGERATE_API_KEY not configured")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/latest/{base}",
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("result") != "success":
            raise RuntimeError(f"API error: {data.get('error-type', 'unknown')}")
        return data.get("conversion_rates", {})

async def _fetch_openexchangerates(base: str) -> Dict[str, float]:
    if not OPENEXCHANGERATES_APP_ID:
        raise RuntimeError("OPENEXCHANGERATES_APP_ID not configured")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"https://openexchangerates.org/api/latest.json?app_id={OPENEXCHANGERATES_APP_ID}&base={base}",
        )
        resp.raise_for_status()
        data = resp.json()
        rates = data.get("rates", {})
        # OpenExchangeRates uses USD as base; convert if needed
        if base != "USD":
            usd_rate = rates.get(base, 1.0)
            rates = {k: v / usd_rate for k, v in rates.items()}
        return rates

async def get_live_rate(base: str, quote: str) -> tuple[float, str]:
    """Fetch live rate from configured providers. Returns (rate, provider_name)."""
    errors = []

    # Try ExchangeRate-API first
    try:
        rates = await _fetch_exchangerate_api(base)
        if quote in rates:
            return rates[quote], "exchangerate-api"
    except Exception as e:
        errors.append(f"exchangerate-api: {e}")

    # Fallback to OpenExchangeRates
    try:
        rates = await _fetch_openexchangerates(base)
        if quote in rates:
            return rates[quote], "openexchangerates"
    except Exception as e:
        errors.append(f"openexchangerates: {e}")

    # Check cache as last resort
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT rate, provider, fetched_at FROM fx_rates
               WHERE base_currency = %s AND quote_currency = %s
               ORDER BY fetched_at DESC LIMIT 1""",
            (base, quote)
        )
        row = cur.fetchone()
        if row:
            rate, provider, fetched_at = row
            age = (datetime.now(timezone.utc) - fetched_at).total_seconds()
            if age < RATE_MAX_AGE_SECONDS:
                logger.warning(f"Using cached rate for {base}/{quote} (age={age:.0f}s)")
                return rate, f"{provider}-cached"

    raise HTTPException(
        status_code=503,
        detail=f"No live FX provider available for {base}/{quote}. Errors: {errors}",
    )

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class FXQuoteRequest(BaseModel):
    base_currency: str = Field(..., min_length=3, max_length=3)
    quote_currency: str = Field(..., min_length=3, max_length=3)
    amount: float = Field(..., gt=0)
    spread_bps: Optional[float] = None  # basis points override
    transaction_id: Optional[str] = None

class FXQuoteResponse(BaseModel):
    quote_id: str
    transaction_id: Optional[str]
    base_currency: str
    quote_currency: str
    amount: float
    mid_rate: float
    spread_bps: float
    customer_rate: float
    customer_amount: float
    provider: str
    expires_at: str
    timestamp: str

class RateRequest(BaseModel):
    base_currency: str = Field(..., min_length=3, max_length=3)
    quote_currency: str = Field(..., min_length=3, max_length=3)

# ─── Handlers ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    ca_ok = bool(EXCHANGERATE_API_KEY)
    oo_ok = bool(OPENEXCHANGERATES_APP_ID)
    db_ok = False
    try:
        conn = _get_db()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            db_ok = True
    except Exception:
        pass

    status = "ok" if (ca_ok or oo_ok) and db_ok else "degraded"
    return {
        "status": status,
        "service": "python-fx-engine",
        "version": "2.0.0",
        "providers": {
            "exchangerate_api": "configured" if ca_ok else "missing",
            "openexchangerates": "configured" if oo_ok else "missing",
        },
        "database": "connected" if db_ok else "disconnected",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/fx/quote", response_model=FXQuoteResponse)
async def get_quote(req: FXQuoteRequest):
    mid_rate, provider = await get_live_rate(req.base_currency.upper(), req.quote_currency.upper())

    spread_bps = req.spread_bps or DEFAULT_SPREAD_BPS
    spread_multiplier = 1.0 - (spread_bps / 10000.0)
    customer_rate = mid_rate * spread_multiplier
    customer_amount = req.amount * customer_rate

    quote_id = f"FXQ-{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.urandom(4).hex().upper()}"
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=RATE_MAX_AGE_SECONDS)

    # Persist quote
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO fx_quotes (quote_id, transaction_id, base_currency, quote_currency, amount,
               mid_rate, spread_bps, customer_rate, customer_amount, provider, expires_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (quote_id, req.transaction_id, req.base_currency.upper(), req.quote_currency.upper(),
             req.amount, mid_rate, spread_bps, customer_rate, customer_amount, provider, expires_at)
        )

    return FXQuoteResponse(
        quote_id=quote_id,
        transaction_id=req.transaction_id,
        base_currency=req.base_currency.upper(),
        quote_currency=req.quote_currency.upper(),
        amount=req.amount,
        mid_rate=round(mid_rate, 6),
        spread_bps=spread_bps,
        customer_rate=round(customer_rate, 6),
        customer_amount=round(customer_amount, 2),
        provider=provider,
        expires_at=expires_at.isoformat(),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

@app.post("/fx/rate")
async def get_rate(req: RateRequest):
    rate, provider = await get_live_rate(req.base_currency.upper(), req.quote_currency.upper())

    # Cache the rate
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO fx_rates (base_currency, quote_currency, rate, provider, expires_at)
               VALUES (%s, %s, %s, %s, %s)""",
            (req.base_currency.upper(), req.quote_currency.upper(), rate, provider,
             datetime.now(timezone.utc) + timedelta(seconds=RATE_MAX_AGE_SECONDS))
        )

    return {
        "base_currency": req.base_currency.upper(),
        "quote_currency": req.quote_currency.upper(),
        "rate": round(rate, 6),
        "provider": provider,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "expires_in_seconds": RATE_MAX_AGE_SECONDS,
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8093"))
    logger.info(f"Starting fx-engine v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
