"""
universal-fx/main.py — v170
Universal any-to-any FX conversion engine for RemitFlow.

Architecture: hub-and-spoke rate graph with USD as hub.
- 97 assets: 45 fiat currencies + 52 crypto/stablecoin assets
- Live feeds: CoinGecko (crypto) + ECB/Frankfurter (fiat)
- Rate lock: 15-minute TTL with 0.5% slippage protection
- Offline resilience: stale-while-revalidate with configurable TTL
- CoinGecko API key: COINGECKO_API_KEY env var (Pro endpoint if set)

Port: 8084
"""

import os
import time
import math
import hmac
import hashlib
import json
import heapq
import logging
import asyncio
from typing import Dict, Optional, Tuple
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

import psycopg2
import psycopg2.pool
import psycopg2.extras

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("universal-fx")

app = FastAPI(title="RemitFlow Universal FX Engine", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Configuration ─────────────────────────────────────────────────────────────
PORT = int(os.environ.get("PORT", "8084"))

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/remitflow")

_pg_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pg_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pg_pool
    if _pg_pool is None or _pg_pool.closed:
        _pg_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2, maxconn=10, dsn=DATABASE_URL,
        )
    return _pg_pool


def _db_exec(query: str, params: tuple = ()) -> list[dict]:
    pool = _get_pg_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params)
            rows = [dict(r) for r in cur.fetchall()] if cur.description else []
            conn.commit()
            return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def _db_one(query: str, params: tuple = ()) -> dict | None:
    rows = _db_exec(query, params)
    return rows[0] if rows else None


RATE_LOCK_TTL = int(os.environ.get("RATE_LOCK_TTL_SECONDS", "900"))  # 15 min
SLIPPAGE_BPS = float(os.environ.get("SLIPPAGE_BPS", "50"))  # 0.5%
RATE_CACHE_TTL = int(os.environ.get("RATE_CACHE_TTL_SECONDS", "300"))  # 5 min
def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known defaults."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"[universal-fx] {name} is not set. Refusing to start with a "
            "well-known default secret; configure it explicitly."
        )
    return value


# Fail-closed: a repo-public default HMAC secret would let anyone forge signed
# FX rate locks (PY-012). No default — startup fails when unset.
HMAC_SECRET = _require_env("RATE_LOCK_HMAC_SECRET")

# CoinGecko API key — if set, uses Pro endpoint (500 req/min vs 30 req/min)
COINGECKO_API_KEY = os.environ.get("COINGECKO_API_KEY", "")
COINGECKO_BASE = (
    "https://pro-api.coingecko.com/api/v3"
    if COINGECKO_API_KEY
    else "https://api.coingecko.com/api/v3"
)

# ─── Asset Registry ────────────────────────────────────────────────────────────
# Fiat currencies (ECB/Frankfurter feed)
FIAT_CURRENCIES = [
    "USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "RWF",
    "XOF", "XAF", "EGP", "MAD", "ETB", "DZD", "TND", "LYD", "SDG", "MWK",
    "ZMW", "MZN", "AOA", "NAD", "BWP", "SZL", "LSL", "MUR", "SCR", "GMD",
    "SLL", "GNF", "LRD", "SOS", "DJF", "ERN", "SAR", "AED", "INR", "CNY",
    "JPY", "CAD", "AUD", "CHF", "BRL",
]

# Crypto/stablecoin assets (CoinGecko IDs → ticker mapping)
CRYPTO_ASSETS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "USDT": "tether",
    "USDC": "usd-coin",
    "BNB": "binancecoin",
    "SOL": "solana",
    "MATIC": "matic-network",
    "AVAX": "avalanche-2",
    "XRP": "ripple",
    "LTC": "litecoin",
    "DOGE": "dogecoin",
    "ADA": "cardano",
    "DOT": "polkadot",
    "LINK": "chainlink",
    "UNI": "uniswap",
    "AAVE": "aave",
    "DAI": "dai",
    "BUSD": "binance-usd",
    "TUSD": "true-usd",
    "FRAX": "frax",
    "NGNT": "naira-token",  # Nigerian Naira Token
    "AFRO": "afro",         # Stellar AFRO
    "cUSD": "celo-dollar",  # Celo Dollar
    "CELO": "celo",
    "ALGO": "algorand",
    "XLM": "stellar",
    "TRX": "tron",
    "NEAR": "near",
    "FTM": "fantom",
    "OP": "optimism",
    "ARB": "arbitrum",
    "ATOM": "cosmos",
    "ICP": "internet-computer",
    "FLOW": "flow",
    "MANA": "decentraland",
    "SAND": "the-sandbox",
    "AXS": "axie-infinity",
    "CRV": "curve-dao-token",
    "COMP": "compound-governance-token",
    "MKR": "maker",
    "SNX": "havven",
    "YFI": "yearn-finance",
    "1INCH": "1inch",
    "SUSHI": "sushi",
    "BAL": "balancer",
    "GRT": "the-graph",
    "ENS": "ethereum-name-service",
    "LDO": "lido-dao",
    "RPL": "rocket-pool",
    "STETH": "staked-ether",
    "WBTC": "wrapped-bitcoin",
    "WETH": "weth",
}

# ─── In-memory rate cache ──────────────────────────────────────────────────────
# _rate_cache — persisted to PostgreSQL table "fx_rate_cache" (see _db__rate_cache_* helpers)

class _DbRateCache:
    """PostgreSQL-backed store replacing in-memory dict '_rate_cache'."""
    TABLE = "fx_rate_cache"

    def get(self, key: str) -> dict | None:
        row = _db_one(f"SELECT data FROM {self.TABLE} WHERE key = %s", (str(key),))
        return dict(row["data"]) if row else None

    def __getitem__(self, key: str) -> dict:
        val = self.get(str(key))
        if val is None:
            raise KeyError(key)
        return val

    def __setitem__(self, key: str, value) -> None:
        import json as _json
        _db_exec(
            f"""INSERT INTO {self.TABLE} (key, data, updated_at) VALUES (%s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
            (str(key), _json.dumps(value, default=str)),
        )

    def __contains__(self, key: str) -> bool:
        return self.get(str(key)) is not None

    def __delitem__(self, key: str) -> None:
        _db_exec(f"DELETE FROM {self.TABLE} WHERE key = %s", (str(key),))

    def keys(self):
        rows = _db_exec(f"SELECT key FROM {self.TABLE}")
        return [r["key"] for r in rows]

    def values(self):
        rows = _db_exec(f"SELECT data FROM {self.TABLE}")
        return [dict(r["data"]) for r in rows]

    def items(self):
        rows = _db_exec(f"SELECT key, data FROM {self.TABLE}")
        return [(r["key"], dict(r["data"])) for r in rows]

    def __len__(self) -> int:
        row = _db_one(f"SELECT COUNT(*) AS cnt FROM {self.TABLE}")
        return row["cnt"] if row else 0

    def pop(self, key: str, default=None):
        val = self.get(str(key))
        if val is not None:
            self.__delitem__(str(key))
            return val
        return default

    def update(self, d: dict) -> None:
        for k, v in d.items():
            self[k] = v

_rate_cache = _DbRateCache()
_cache_updated_at: float = 0.0
# _rate_locks — persisted to PostgreSQL table "fx_rate_locks" (see _db__rate_locks_* helpers)

class _DbRateLocks:
    """PostgreSQL-backed store replacing in-memory dict '_rate_locks'."""
    TABLE = "fx_rate_locks"

    def get(self, key: str) -> dict | None:
        row = _db_one(f"SELECT data FROM {self.TABLE} WHERE key = %s", (str(key),))
        return dict(row["data"]) if row else None

    def __getitem__(self, key: str) -> dict:
        val = self.get(str(key))
        if val is None:
            raise KeyError(key)
        return val

    def __setitem__(self, key: str, value) -> None:
        import json as _json
        _db_exec(
            f"""INSERT INTO {self.TABLE} (key, data, updated_at) VALUES (%s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
            (str(key), _json.dumps(value, default=str)),
        )

    def __contains__(self, key: str) -> bool:
        return self.get(str(key)) is not None

    def __delitem__(self, key: str) -> None:
        _db_exec(f"DELETE FROM {self.TABLE} WHERE key = %s", (str(key),))

    def keys(self):
        rows = _db_exec(f"SELECT key FROM {self.TABLE}")
        return [r["key"] for r in rows]

    def values(self):
        rows = _db_exec(f"SELECT data FROM {self.TABLE}")
        return [dict(r["data"]) for r in rows]

    def items(self):
        rows = _db_exec(f"SELECT key, data FROM {self.TABLE}")
        return [(r["key"], dict(r["data"])) for r in rows]

    def __len__(self) -> int:
        row = _db_one(f"SELECT COUNT(*) AS cnt FROM {self.TABLE}")
        return row["cnt"] if row else 0

    def pop(self, key: str, default=None):
        val = self.get(str(key))
        if val is not None:
            self.__delitem__(str(key))
            return val
        return default

    def update(self, d: dict) -> None:
        for k, v in d.items():
            self[k] = v

_rate_locks = _DbRateLocks()

# Fallback rates (used when all feeds fail — offline resilience)
FALLBACK_RATES: Dict[str, float] = {
    "USD": 1.0, "EUR": 0.9215, "GBP": 0.7925, "NGN": 1538.46, "KES": 130.5,
    "GHS": 12.4, "ZAR": 18.7, "TZS": 2580.0, "UGX": 3750.0, "RWF": 1285.0,
    "XOF": 605.0, "XAF": 605.0, "EGP": 30.9, "MAD": 10.1, "ETB": 56.8,
    "SAR": 3.75, "AED": 3.67, "INR": 83.1, "CNY": 7.24, "JPY": 149.5,
    "CAD": 1.36, "AUD": 1.53, "CHF": 0.895, "BRL": 4.97,
    "BTC": 0.0000154, "ETH": 0.000286, "USDT": 1.0, "USDC": 1.0,
    "BNB": 0.00308, "SOL": 0.00714, "XRP": 1.72, "LTC": 0.0123,
    "NGNT": 1538.46, "cUSD": 1.0, "AFRO": 0.1,
}


# ─── Rate fetching ─────────────────────────────────────────────────────────────
async def fetch_fiat_rates() -> Dict[str, float]:
    """Fetch fiat rates from Frankfurter (ECB data, free, no key required)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.frankfurter.app/latest",
                params={"from": "USD", "to": ",".join(f for f in FIAT_CURRENCIES if f != "USD")},
            )
            resp.raise_for_status()
            data = resp.json()
            rates = {"USD": 1.0}
            rates.update(data.get("rates", {}))
            return rates
    except Exception as e:
        logger.warning(f"Fiat rate fetch failed: {e}, using fallback")
        return {k: v for k, v in FALLBACK_RATES.items() if k in FIAT_CURRENCIES}


async def fetch_crypto_rates() -> Dict[str, float]:
    """
    Fetch crypto rates from CoinGecko.
    Uses Pro API if COINGECKO_API_KEY is set (500 req/min),
    otherwise uses free public API (30 req/min).
    """
    ids = ",".join(CRYPTO_ASSETS.values())
    headers = {}
    if COINGECKO_API_KEY:
        headers["x-cg-pro-api-key"] = COINGECKO_API_KEY
        logger.debug("Using CoinGecko Pro API")
    else:
        logger.debug("Using CoinGecko free API (rate-limited to 30 req/min)")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{COINGECKO_BASE}/simple/price",
                params={"ids": ids, "vs_currencies": "usd"},
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        # Build ticker → USD rate map
        id_to_ticker = {v: k for k, v in CRYPTO_ASSETS.items()}
        rates: Dict[str, float] = {}
        for cg_id, prices in data.items():
            ticker = id_to_ticker.get(cg_id)
            if ticker and "usd" in prices:
                usd_price = prices["usd"]
                # Store as asset/USD (how many USD per 1 asset)
                rates[ticker] = usd_price
        return rates
    except Exception as e:
        logger.warning(f"Crypto rate fetch failed: {e}, using fallback")
        return {k: v for k, v in FALLBACK_RATES.items() if k in CRYPTO_ASSETS}


async def refresh_rates() -> Dict[str, float]:
    """Refresh all rates from live feeds. Returns merged rate map."""
    global _rate_cache, _cache_updated_at

    fiat, crypto = await asyncio.gather(
        fetch_fiat_rates(),
        fetch_crypto_rates(),
        return_exceptions=True,
    )

    merged: Dict[str, float] = {}

    if isinstance(fiat, dict):
        merged.update(fiat)
    else:
        logger.error(f"Fiat fetch exception: {fiat}")
        merged.update({k: v for k, v in FALLBACK_RATES.items() if k in FIAT_CURRENCIES})

    if isinstance(crypto, dict):
        # For crypto: CoinGecko returns USD price per coin
        # We need asset/USD rate (same as fiat: how many USD per 1 asset)
        # But for the hub-and-spoke graph, we need USD/asset (how many asset per 1 USD)
        # Convention: store as "how many USD per 1 asset" for consistency
        merged.update(crypto)
    else:
        logger.error(f"Crypto fetch exception: {crypto}")
        merged.update({k: v for k, v in FALLBACK_RATES.items() if k in CRYPTO_ASSETS})

    _rate_cache = merged
    _cache_updated_at = time.time()
    logger.info(f"Rates refreshed: {len(merged)} assets, CoinGecko={'Pro' if COINGECKO_API_KEY else 'Free'}")
    return merged


async def get_rates() -> Tuple[Dict[str, float], bool]:
    """
    Get current rates. Returns (rates, is_stale).
    Stale-while-revalidate: serves cached rates while refreshing in background.
    """
    global _rate_cache, _cache_updated_at

    age = time.time() - _cache_updated_at
    is_stale = age > RATE_CACHE_TTL

    if not _rate_cache:
        # First call — must fetch synchronously
        await refresh_rates()
        return _rate_cache, False

    if is_stale:
        # Trigger background refresh, return stale cache immediately
        asyncio.create_task(refresh_rates())

    return _rate_cache, is_stale


# ─── Dijkstra hub-and-spoke routing ───────────────────────────────────────────
def compute_cross_rate(
    rates: Dict[str, float],
    from_asset: str,
    to_asset: str,
) -> Optional[float]:
    """
    Compute cross-rate using USD as hub currency.
    from_asset → USD → to_asset
    
    rates[asset] = USD price per 1 asset
    cross_rate = rates[to_asset] / rates[from_asset]
    """
    from_usd = rates.get(from_asset.upper())
    to_usd = rates.get(to_asset.upper())

    if from_usd is None or to_usd is None:
        return None
    if from_usd <= 0:
        return None

    return to_usd / from_usd


def apply_slippage(rate: float, direction: str = "buy") -> float:
    """Apply slippage protection (0.5% by default)."""
    slippage = SLIPPAGE_BPS / 10000.0
    if direction == "buy":
        return rate * (1 - slippage)
    else:
        return rate * (1 + slippage)


# ─── Rate lock ─────────────────────────────────────────────────────────────────
def create_rate_lock(
    from_asset: str,
    to_asset: str,
    rate: float,
    amount: float,
) -> dict:
    """Create a signed rate lock token."""
    lock_id = hashlib.sha256(
        f"{from_asset}{to_asset}{rate}{amount}{time.time()}".encode()
    ).hexdigest()[:16]

    expires_at = int(time.time()) + RATE_LOCK_TTL
    payload = f"{lock_id}:{from_asset}:{to_asset}:{rate:.8f}:{amount:.8f}:{expires_at}"
    signature = hmac.new(
        HMAC_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()

    lock = {
        "lockId": lock_id,
        "fromAsset": from_asset,
        "toAsset": to_asset,
        "rate": rate,
        "amount": amount,
        "expiresAt": expires_at,
        "signature": signature,
    }
    _rate_locks[lock_id] = lock
    return lock


def verify_rate_lock(lock_id: str) -> Optional[dict]:
    """Verify and return a rate lock if valid."""
    lock = _rate_locks.get(lock_id)
    if not lock:
        return None
    if int(time.time()) > lock["expiresAt"]:
        del _rate_locks[lock_id]
        return None
    return lock


# ─── Background rate refresh loop ─────────────────────────────────────────────
async def rate_refresh_loop():
    """Periodically refresh rates in the background."""
    while True:
        try:
            await refresh_rates()
        except Exception as e:
            logger.error(f"Rate refresh loop error: {e}")
        await asyncio.sleep(RATE_CACHE_TTL)


@app.on_event("startup")
async def startup():
    await refresh_rates()
    asyncio.create_task(rate_refresh_loop())
    logger.info(
        f"Universal FX Engine started on port {PORT}. "
        f"CoinGecko: {'Pro (API key set)' if COINGECKO_API_KEY else 'Free (no API key)'}"
    )


# ─── API Endpoints ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    rates, is_stale = await get_rates()
    return {
        "status": "ok",
        "assets": len(rates),
        "cacheAge": int(time.time() - _cache_updated_at),
        "isStale": is_stale,
        "coingeckoTier": "pro" if COINGECKO_API_KEY else "free",
        "activeLocks": len(_rate_locks),
    }


@app.get("/rates")
async def get_all_rates():
    """Get all current rates (asset → USD)."""
    rates, is_stale = await get_rates()
    return {
        "rates": rates,
        "fetchedAt": int(_cache_updated_at * 1000),
        "isStale": is_stale,
        "assetCount": len(rates),
    }


class QuoteRequest(BaseModel):
    fromAsset: str
    toAsset: str
    amount: float
    lockRate: bool = False


@app.post("/quote")
async def get_quote(req: QuoteRequest):
    """Get a conversion quote with optional rate lock."""
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    rates, is_stale = await get_rates()
    cross_rate = compute_cross_rate(rates, req.fromAsset, req.toAsset)

    if cross_rate is None:
        raise HTTPException(
            status_code=404,
            detail=f"No rate available for {req.fromAsset}/{req.toAsset}",
        )

    protected_rate = apply_slippage(cross_rate, "buy")
    converted_amount = req.amount * protected_rate

    result = {
        "fromAsset": req.fromAsset.upper(),
        "toAsset": req.toAsset.upper(),
        "amount": req.amount,
        "rate": protected_rate,
        "midMarketRate": cross_rate,
        "convertedAmount": round(converted_amount, 8),
        "slippageBps": SLIPPAGE_BPS,
        "isStale": is_stale,
        "quotedAt": int(time.time() * 1000),
    }

    if req.lockRate:
        lock = create_rate_lock(
            req.fromAsset.upper(),
            req.toAsset.upper(),
            protected_rate,
            req.amount,
        )
        result["rateLock"] = lock

    return result


@app.get("/lock/{lock_id}")
async def check_lock(lock_id: str):
    """Check if a rate lock is still valid."""
    lock = verify_rate_lock(lock_id)
    if not lock:
        raise HTTPException(status_code=404, detail="Rate lock expired or not found")
    return {"valid": True, "lock": lock, "remainingSeconds": lock["expiresAt"] - int(time.time())}


@app.get("/assets")
async def list_assets():
    """List all supported assets."""
    return {
        "fiat": FIAT_CURRENCIES,
        "crypto": list(CRYPTO_ASSETS.keys()),
        "total": len(FIAT_CURRENCIES) + len(CRYPTO_ASSETS),
    }


@app.get("/corridor/{from_asset}/{to_asset}")
async def corridor_info(from_asset: str, to_asset: str):
    """Get corridor health and rate info."""
    rates, is_stale = await get_rates()
    cross_rate = compute_cross_rate(rates, from_asset, to_asset)

    if cross_rate is None:
        return {"available": False, "from": from_asset, "to": to_asset}

    return {
        "available": True,
        "from": from_asset.upper(),
        "to": to_asset.upper(),
        "rate": cross_rate,
        "protectedRate": apply_slippage(cross_rate),
        "isStale": is_stale,
        "ttlSeconds": RATE_LOCK_TTL,
    }



def init_pg_tables():
    """Create PostgreSQL tables for persistent state."""
    try:
        _db_exec("""
            CREATE TABLE IF NOT EXISTS fx_rate_cache (
            key TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        _db_exec("""
            CREATE TABLE IF NOT EXISTS fx_rate_locks (
            key TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
    except Exception as e:
        print(f"[DB] Table init error: {e}")
        raise


# Ensure the PostgreSQL-backed cache and lock tables exist before endpoint access.
init_pg_tables()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
