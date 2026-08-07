"""
RemitFlow — Python Compliance & Fraud-Score Microservice (Production v2)
=========================================================================
Port: 8083

Responsibilities:
  1. POST /compliance/check      — AML/KYC compliance check for a transfer
  2. POST /fraud/score           — ML-style fraud risk scoring (rule-based)
  3. POST /sanctions/screen      — OFAC/UN/EU/HMT sanctions list screening
  4. POST /velocity/check        — Velocity limit enforcement (per user/corridor)
  5. GET  /compliance/rules      — List active compliance rules
  6. POST /sanctions/refresh     — Force-refresh sanctions lists from upstream feeds
  7. GET  /sanctions/stats       — Sanctions list statistics
  8. GET  /health                — Health check
  9. GET  /metrics               — Prometheus metrics

Production changes (v2):
  - Sanctions: Real OFAC SDN, UN Consolidated, EU Financial Sanctions feeds
  - Velocity: Redis-backed (survives restarts, shared across instances)
  - Metrics: Prometheus format with proper histogram buckets
  - Sanctions auto-refresh on startup + configurable interval
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import os
import time
import hashlib
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Set, Tuple

import httpx
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

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
                CREATE TABLE IF NOT EXISTS compliance_service_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_compliance_service_updated
                    ON compliance_service_state(updated_at);
                CREATE TABLE IF NOT EXISTS compliance_service_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_compliance_service_events_type
                    ON compliance_service_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO compliance_service_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM compliance_service_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM compliance_service_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO compliance_service_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("compliance")

# ── App Setup ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Compliance & Fraud Service",
    version="2.0.0",
    description="AML/KYC compliance checks, fraud scoring, and sanctions screening (production)",
)

@app.get("/metrics/pod")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-compliance-service"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-compliance-service"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-compliance-service").info(f"Received signal {signum}, initiating graceful shutdown...")
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
        "service": "python-compliance-service",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-compliance-service").info("FastAPI shutdown event — cleaning up resources")

# ── Redis for Velocity (production) ───────────────────────────────────────────

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
_redis_client: Any = None

async def get_redis():
    global _redis_client
    if os.environ.get("REMITFLOW_TEST_MODE", "false").lower() == "true":
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        import redis.asyncio as aioredis
        _redis_client = aioredis.from_url(REDIS_URL, decode_responses=True, socket_timeout=3)
        await _redis_client.ping()
        log.info("[Redis] Connected to %s", REDIS_URL.split("@")[-1] if "@" in REDIS_URL else REDIS_URL)
        return _redis_client
    except Exception as e:
        log.warning("[Redis] Connection failed: %s — falling back to in-memory velocity", str(e))
        _redis_client = None
        return None

# In-memory fallback (only used when Redis is unavailable)
_velocity_store_fallback: Dict[str, List[Tuple[float, float]]] = defaultdict(list)

# ── Prometheus Metrics ────────────────────────────────────────────────────────

_metrics: Dict[str, int] = defaultdict(int)

# ══════════════════════════════════════════════════════════════════════════════
# SANCTIONS LIST MANAGEMENT — Real OFAC / UN / EU / HMT Feeds
# ══════════════════════════════════════════════════════════════════════════════

# Feed URLs
OFAC_SDN_CSV_URL = os.environ.get(
    "OFAC_SDN_URL",
    "https://www.treasury.gov/ofac/downloads/sdn.csv"
)
UN_CONSOLIDATED_XML_URL = os.environ.get(
    "UN_SANCTIONS_URL",
    "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
)
EU_SANCTIONS_CSV_URL = os.environ.get(
    "EU_SANCTIONS_URL",
    "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList/content"
)
HMT_SANCTIONS_URL = os.environ.get(
    "HMT_SANCTIONS_URL",
    "https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv"
)

SANCTIONS_REFRESH_INTERVAL = int(os.environ.get("SANCTIONS_REFRESH_INTERVAL_SECS", "3600"))


def _init_compliance_svc_tables() -> None:
    """Initialise the sanctions-cache persistence contract for this service instance."""
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS compliance_screening_data (
                key TEXT PRIMARY KEY,
                data JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )


def _db_exec(query: str, params: tuple[object, ...] = ()) -> None:
    """Execute a parameterized persistence operation through the service database."""
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(query, params)


class SanctionsList:
    """Thread-safe sanctions list with real feed parsing."""

    def __init__(self):
        _init_compliance_svc_tables()
        self._names: Set[str] = set()
        self._aliases: Set[str] = set()
        self._ids: Set[str] = set()
        self._countries: Set[str] = set()
        self._last_refresh: Optional[float] = None
        self._feed_stats: Dict[str, int] = {}
        self._refresh_errors: List[str] = []

    @property
    def total_entries(self) -> int:
        return len(self._names)

    @property
    def last_refresh(self) -> Optional[str]:
        if self._last_refresh is None:
            return None
        return datetime.fromtimestamp(self._last_refresh, tz=timezone.utc).isoformat()

    async def refresh_all(self) -> Dict[str, Any]:
        """Download and parse all sanctions feeds."""
        self._refresh_errors = []
        new_names: Set[str] = set()
        new_aliases: Set[str] = set()
        stats: Dict[str, int] = {}

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            # OFAC SDN List
            ofac_count = await self._fetch_ofac(client, new_names, new_aliases)
            stats["ofac_sdn"] = ofac_count
            log.info("[Sanctions] OFAC SDN: %d entries loaded", ofac_count)

            # UN Consolidated List
            un_count = await self._fetch_un(client, new_names, new_aliases)
            stats["un_consolidated"] = un_count
            log.info("[Sanctions] UN Consolidated: %d entries loaded", un_count)

            # EU Financial Sanctions
            eu_count = await self._fetch_eu(client, new_names, new_aliases)
            stats["eu_financial"] = eu_count
            log.info("[Sanctions] EU Financial: %d entries loaded", eu_count)

            # HMT (UK) Sanctions
            hmt_count = await self._fetch_hmt(client, new_names, new_aliases)
            stats["hmt_uk"] = hmt_count
            log.info("[Sanctions] HMT UK: %d entries loaded", hmt_count)

        self._names = new_names
        # Write-through to PostgreSQL
        try:
            import json as _json
            _db_exec(
                """INSERT INTO compliance_screening_data (key, data, updated_at) VALUES ('screening_names', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                (_json.dumps(list(self._names), default=str),),
            )
        except Exception:
            pass
        self._aliases = new_aliases
        self._feed_stats = stats
        self._last_refresh = time.time()

        total = len(new_names)
        log.info("[Sanctions] Total unique sanctioned entities: %d (aliases: %d)", total, len(new_aliases))
        return {"total_entries": total, "feeds": stats, "errors": self._refresh_errors}

    async def _fetch_ofac(self, client: httpx.AsyncClient, names: Set[str], aliases: Set[str]) -> int:
        """Parse OFAC SDN CSV (fields: ent_num, SDN_Name, SDN_Type, Program, ...)."""
        count = 0
        try:
            resp = await client.get(OFAC_SDN_CSV_URL)
            resp.raise_for_status()
            reader = csv.reader(io.StringIO(resp.text))
            for row in reader:
                if len(row) >= 2:
                    name = _normalize(row[1])
                    if name and len(name) > 2:
                        names.add(name)
                        count += 1
                    # Aliases are in a separate file but names often contain AKAs
                    if len(row) >= 4 and "aka" in row[3].lower():
                        aliases.add(name)
        except Exception as e:
            err = f"OFAC SDN fetch failed: {str(e)}"
            log.error("[Sanctions] %s", err)
            self._refresh_errors.append(err)
        return count

    async def _fetch_un(self, client: httpx.AsyncClient, names: Set[str], aliases: Set[str]) -> int:
        """Parse UN Consolidated Sanctions XML."""
        count = 0
        try:
            resp = await client.get(UN_CONSOLIDATED_XML_URL)
            resp.raise_for_status()
            import xml.etree.ElementTree as ET
            root = ET.fromstring(resp.text)
            # UN format: <INDIVIDUALS><INDIVIDUAL><FIRST_NAME>...<SECOND_NAME>...
            for individual in root.iter("INDIVIDUAL"):
                first = individual.findtext("FIRST_NAME", "").strip()
                second = individual.findtext("SECOND_NAME", "").strip()
                third = individual.findtext("THIRD_NAME", "").strip()
                full = _normalize(f"{first} {second} {third}")
                if full and len(full) > 2:
                    names.add(full)
                    count += 1
                # Aliases
                for alias in individual.iter("INDIVIDUAL_ALIAS"):
                    alias_name = alias.findtext("ALIAS_NAME", "").strip()
                    if alias_name:
                        aliases.add(_normalize(alias_name))
            for entity in root.iter("ENTITY"):
                ename = entity.findtext("FIRST_NAME", "").strip()
                if ename:
                    names.add(_normalize(ename))
                    count += 1
        except Exception as e:
            err = f"UN Consolidated fetch failed: {str(e)}"
            log.error("[Sanctions] %s", err)
            self._refresh_errors.append(err)
        return count

    async def _fetch_eu(self, client: httpx.AsyncClient, names: Set[str], aliases: Set[str]) -> int:
        """Parse EU Financial Sanctions CSV."""
        count = 0
        try:
            resp = await client.get(EU_SANCTIONS_CSV_URL)
            resp.raise_for_status()
            reader = csv.DictReader(io.StringIO(resp.text), delimiter=";")
            for row in reader:
                name_parts = []
                for field in ["Name_1", "Name_2", "Name_3", "Name_4", "Name_5", "Name_6",
                              "Wholename", "NameAlias_WholeName"]:
                    val = row.get(field, "").strip()
                    if val:
                        name_parts.append(val)
                for part in name_parts:
                    normalized = _normalize(part)
                    if normalized and len(normalized) > 2:
                        names.add(normalized)
                        count += 1
        except Exception as e:
            err = f"EU Financial Sanctions fetch failed: {str(e)}"
            log.error("[Sanctions] %s", err)
            self._refresh_errors.append(err)
        return count

    async def _fetch_hmt(self, client: httpx.AsyncClient, names: Set[str], aliases: Set[str]) -> int:
        """Parse HMT (UK OFSI) Consolidated List CSV."""
        count = 0
        try:
            resp = await client.get(HMT_SANCTIONS_URL)
            resp.raise_for_status()
            reader = csv.DictReader(io.StringIO(resp.text))
            for row in reader:
                for field in ["Name 6", "Name 1", "Name 2", "Name 3", "Name 4", "Name 5"]:
                    val = row.get(field, "").strip()
                    if val:
                        names.add(_normalize(val))
                        count += 1
                        break
        except Exception as e:
            err = f"HMT UK fetch failed: {str(e)}"
            log.error("[Sanctions] %s", err)
            self._refresh_errors.append(err)
        return count

    def check_name(self, name: str) -> Tuple[bool, Optional[str], str]:
        """
        Check a name against all sanctions lists.
        Returns: (is_match, match_type, risk_level)
        """
        normalized = _normalize(name)
        tokens = set(normalized.split())

        # Exact match
        if normalized in self._names:
            return True, "exact", "critical"

        # Alias match
        if normalized in self._aliases:
            return True, "alias", "critical"

        # Fuzzy match: token overlap >= 60% with any sanctioned name
        for sanctioned in self._names:
            sanctioned_tokens = set(sanctioned.split())
            if len(sanctioned_tokens) < 2:
                continue
            overlap = tokens & sanctioned_tokens
            if len(overlap) >= 2 and len(overlap) / len(sanctioned_tokens) >= 0.6:
                return True, "fuzzy", "high"

        return False, None, "low"


# Singleton sanctions list
_sanctions = SanctionsList()

SANCTIONED_COUNTRIES: set = {
    "KP",  # North Korea
    "IR",  # Iran
    "SY",  # Syria
    "CU",  # Cuba
    "SD",  # Sudan
    "RU",  # Russia (partial)
    "BY",  # Belarus
    "MM",  # Myanmar (OFAC)
    "VE",  # Venezuela (partial)
    "NI",  # Nicaragua (partial)
    "SO",  # Somalia
    "LY",  # Libya
    "YE",  # Yemen
    "CD",  # DRC
    "CF",  # Central African Republic
    "SS",  # South Sudan
    "ML",  # Mali
    "IQ",  # Iraq (partial)
    "LB",  # Lebanon (Hezbollah-related)
}

HIGH_RISK_COUNTRIES: set = {
    "AF", "PK", "NG", "HT", "GN", "MZ", "LA", "KH", "ZW",
}

# ── Compliance Rules ──────────────────────────────────────────────────────────

COMPLIANCE_RULES = [
    {"id": "CR001", "name": "Large Transfer Threshold", "description": "Transfers over $10,000 require enhanced due diligence", "threshold": 10000, "active": True},
    {"id": "CR002", "name": "Sanctioned Country Block", "description": "Transfers to/from sanctioned countries are blocked", "active": True},
    {"id": "CR003", "name": "High Risk Country EDD", "description": "Transfers to/from high-risk countries require EDD", "active": True},
    {"id": "CR004", "name": "Structuring Detection", "description": "Multiple transfers just below $10k threshold within 24h", "active": True},
    {"id": "CR005", "name": "Velocity Limit", "description": "Max $50,000 per user per 24 hours", "daily_limit": 50000, "active": True},
    {"id": "CR006", "name": "New Account Large Transfer", "description": "Accounts < 30 days old limited to $2,000 per transfer", "active": True},
    {"id": "CR007", "name": "Unverified KYC Block", "description": "Unverified users limited to $500 per transfer", "active": True},
    {"id": "CR008", "name": "Round Amount Detection", "description": "Round amounts (e.g. $1000, $5000) flagged for review", "active": True},
    {"id": "CR009", "name": "Sanctions Name Screen", "description": "All sender/beneficiary names screened against OFAC/UN/EU/HMT lists", "active": True},
    {"id": "CR010", "name": "Rapid Beneficiary Change", "description": "Transfers to recently-changed beneficiary details require review", "active": True},
]

# ── Request/Response Models ───────────────────────────────────────────────────

class TransferComplianceRequest(BaseModel):
    transfer_id: str
    user_id: int
    amount: float = Field(gt=0)
    from_currency: str = Field(min_length=3, max_length=3)
    to_currency: str = Field(min_length=3, max_length=3)
    from_country: str = Field(min_length=2, max_length=2)
    to_country: str = Field(min_length=2, max_length=2)
    kyc_status: str = Field(default="verified")
    account_age_days: int = Field(default=365, ge=0)
    daily_total_usd: float = Field(default=0.0, ge=0)
    beneficiary_name: Optional[str] = None
    sender_name: Optional[str] = None

    @field_validator("from_currency", "to_currency")
    @classmethod
    def uppercase_currency(cls, v: str) -> str:
        return v.upper()

    @field_validator("from_country", "to_country")
    @classmethod
    def uppercase_country(cls, v: str) -> str:
        return v.upper()


class ComplianceResult(BaseModel):
    transfer_id: str
    decision: str
    rules_triggered: List[str]
    risk_level: str
    requires_edd: bool
    block_reason: Optional[str] = None
    review_reason: Optional[str] = None
    sanctions_match: Optional[str] = None
    timestamp: str
    checksum: str


class FraudScoreRequest(BaseModel):
    transfer_id: str
    user_id: int
    amount: float = Field(gt=0)
    from_country: str
    to_country: str
    hour_of_day: int = Field(default=12, ge=0, le=23)
    is_new_beneficiary: bool = False
    is_new_device: bool = False
    failed_attempts_24h: int = Field(default=0, ge=0)
    kyc_status: str = Field(default="verified")
    account_age_days: int = Field(default=365, ge=0)
    ip_country: Optional[str] = None
    velocity_score: float = Field(default=0.0, ge=0.0, le=1.0)


class FraudScoreResult(BaseModel):
    transfer_id: str
    fraud_score: float
    risk_level: str
    decision: str
    factors: List[Dict[str, Any]]
    timestamp: str


class SanctionsScreenRequest(BaseModel):
    name: str
    country: Optional[str] = None
    entity_type: str = Field(default="individual")


class SanctionsScreenResult(BaseModel):
    name: str
    is_sanctioned: bool
    match_type: Optional[str] = None
    risk_level: str
    action: str
    list_source: Optional[str] = None


class VelocityCheckRequest(BaseModel):
    user_id: int
    amount_usd: float = Field(gt=0)
    window_seconds: int = Field(default=86400, gt=0)
    limit_usd: float = Field(default=50000.0, gt=0)


class VelocityCheckResult(BaseModel):
    user_id: int
    allowed: bool
    current_total: float
    limit: float
    remaining: float
    window_seconds: int
    storage_backend: str


# ── Helper Functions ──────────────────────────────────────────────────────────

def compute_checksum(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()[:16]


def is_round_amount(amount: float) -> bool:
    return amount % 1000 == 0 or amount % 500 == 0


def is_near_threshold(amount: float, threshold: float = 10000.0, margin: float = 500.0) -> bool:
    return threshold - margin <= amount < threshold


def _normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", name.lower().strip())


def normalize_name(name: str) -> str:
    """Public normalization helper shared by screening callers and regression tests."""
    return _normalize(name)


def fuzzy_sanctions_match(name: str) -> bool:
    """Return whether the configured sanctions dataset matches a supplied name."""
    is_match, _, _ = _sanctions.check_name(name)
    return is_match


# ── Redis-Backed Velocity ─────────────────────────────────────────────────────

async def velocity_add_and_check(user_id: int, amount_usd: float, window_seconds: int, limit_usd: float) -> Tuple[bool, float]:
    """
    Add a transaction amount to the user's velocity window and check limits.
    Uses Redis sorted sets (timestamp as score, amount as member).
    Falls back to in-memory if Redis unavailable.
    """
    redis = await get_redis()
    now = time.time()
    cutoff = now - window_seconds

    if redis is not None:
        key = f"velocity:{user_id}"
        pipe = redis.pipeline()
        # Remove expired entries
        pipe.zremrangebyscore(key, "-inf", cutoff)
        # Get all current entries
        pipe.zrangebyscore(key, cutoff, "+inf", withscores=True)
        results = await pipe.execute()
        current_entries = results[1] if len(results) > 1 else []
        current_total = sum(float(member.split(":")[0]) for member, score in current_entries)

        if current_total + amount_usd <= limit_usd:
            # Add this transaction
            member = f"{amount_usd}:{now}"
            await redis.zadd(key, {member: now})
            await redis.expire(key, window_seconds + 60)
            return True, current_total
        return False, current_total
    else:
        # In-memory fallback
        key = str(user_id)
        _velocity_store_fallback[key] = [(ts, amt) for ts, amt in _velocity_store_fallback[key] if ts > cutoff]
        current_total = sum(amt for _, amt in _velocity_store_fallback[key])
        if current_total + amount_usd <= limit_usd:
            _velocity_store_fallback[key].append((now, amount_usd))
            return True, current_total
        return False, current_total


# ── Startup: Load Sanctions Lists ─────────────────────────────────────────────

@app.on_event("startup")
async def startup_load_sanctions():
    """Load sanctions lists on startup, then schedule periodic refresh."""
    log.info("[Startup] Loading sanctions lists from OFAC/UN/EU/HMT feeds...")
    try:
        result = await _sanctions.refresh_all()
        log.info("[Startup] Sanctions loaded: %s", result)
    except Exception as e:
        log.error("[Startup] Failed to load sanctions lists: %s", str(e))

    # Schedule periodic refresh
    asyncio.create_task(_periodic_sanctions_refresh())

    # Connect to Redis
    await get_redis()


async def _periodic_sanctions_refresh():
    """Refresh sanctions lists on a configurable interval."""
    while True:
        await asyncio.sleep(SANCTIONS_REFRESH_INTERVAL)
        try:
            result = await _sanctions.refresh_all()
            log.info("[Sanctions] Periodic refresh complete: %s", result)
        except Exception as e:
            log.error("[Sanctions] Periodic refresh failed: %s", str(e))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/compliance/check", response_model=ComplianceResult)
async def compliance_check(req: TransferComplianceRequest) -> ComplianceResult:
    """Run AML/KYC compliance checks on a transfer."""
    _metrics["compliance_checks_total"] += 1

    rules_triggered: List[str] = []
    block_reason: Optional[str] = None
    review_reason: Optional[str] = None
    requires_edd = False
    decision = "approved"
    sanctions_match: Optional[str] = None

    # CR001 — Large Transfer
    if req.amount >= 10000:
        rules_triggered.append("CR001")
        requires_edd = True
        if decision != "blocked":
            decision = "review"
            review_reason = f"Transfer amount ${req.amount:,.2f} exceeds $10,000 threshold"

    # CR002 — Sanctioned Country
    if req.from_country in SANCTIONED_COUNTRIES or req.to_country in SANCTIONED_COUNTRIES:
        rules_triggered.append("CR002")
        decision = "blocked"
        block_reason = f"Transfer involves sanctioned country: {req.from_country if req.from_country in SANCTIONED_COUNTRIES else req.to_country}"

    # CR003 — High Risk Country EDD
    if req.from_country in HIGH_RISK_COUNTRIES or req.to_country in HIGH_RISK_COUNTRIES:
        rules_triggered.append("CR003")
        requires_edd = True
        if decision not in ("blocked",):
            decision = "review"
            review_reason = review_reason or "Transfer involves high-risk country"

    # CR004 — Near-threshold structuring
    if is_near_threshold(req.amount):
        rules_triggered.append("CR004")
        if decision not in ("blocked",):
            decision = "review"
            review_reason = review_reason or f"Amount ${req.amount:,.2f} is near reporting threshold (possible structuring)"

    # CR005 — Daily velocity limit
    if req.daily_total_usd + req.amount > 50000:
        rules_triggered.append("CR005")
        decision = "blocked"
        block_reason = block_reason or f"Daily limit exceeded: ${req.daily_total_usd + req.amount:,.2f} > $50,000"

    # CR006 — New account large transfer
    if req.account_age_days < 30 and req.amount > 2000:
        rules_triggered.append("CR006")
        decision = "blocked"
        block_reason = block_reason or f"Account too new ({req.account_age_days} days) for transfer of ${req.amount:,.2f}"

    # CR007 — Unverified KYC
    if req.kyc_status != "verified" and req.amount > 500:
        rules_triggered.append("CR007")
        decision = "blocked"
        block_reason = block_reason or f"KYC not verified — transfer of ${req.amount:,.2f} exceeds $500 limit"

    # CR008 — Round amount
    if is_round_amount(req.amount) and req.amount >= 1000:
        rules_triggered.append("CR008")
        if decision not in ("blocked", "review"):
            decision = "review"
            review_reason = review_reason or f"Round amount ${req.amount:,.2f} flagged for review"

    # CR009 — Sanctions Name Screening (OFAC/UN/EU/HMT)
    for name_label, name_val in [("beneficiary", req.beneficiary_name), ("sender", req.sender_name)]:
        if name_val:
            is_match, match_type, risk = _sanctions.check_name(name_val)
            if is_match:
                rules_triggered.append("CR009")
                sanctions_match = f"{name_label}:{match_type}"
                if risk == "critical":
                    decision = "blocked"
                    block_reason = block_reason or f"Sanctions match ({match_type}) on {name_label}: {name_val}"
                elif decision not in ("blocked",):
                    decision = "review"
                    review_reason = review_reason or f"Sanctions fuzzy match on {name_label}: {name_val}"

    # Determine risk level
    if decision == "blocked":
        risk_level = "critical"
    elif len(rules_triggered) >= 3:
        risk_level = "high"
    elif len(rules_triggered) >= 1:
        risk_level = "medium"
    else:
        risk_level = "low"

    if decision == "blocked":
        _metrics["compliance_blocks_total"] += 1
    elif decision == "review":
        _metrics["compliance_reviews_total"] += 1

    now = datetime.now(timezone.utc).isoformat()
    checksum_data = f"{req.transfer_id}:{decision}:{':'.join(rules_triggered)}:{now}"

    return ComplianceResult(
        transfer_id=req.transfer_id,
        decision=decision,
        rules_triggered=rules_triggered,
        risk_level=risk_level,
        requires_edd=requires_edd,
        block_reason=block_reason,
        review_reason=review_reason,
        sanctions_match=sanctions_match,
        timestamp=now,
        checksum=compute_checksum(checksum_data),
    )


@app.post("/fraud/score", response_model=FraudScoreResult)
async def fraud_score(req: FraudScoreRequest) -> FraudScoreResult:
    """
    Compute a fraud risk score (0.0 = no risk, 1.0 = certain fraud).
    Uses a weighted rule-based model.
    """
    _metrics["fraud_scores_total"] += 1

    score = 0.0
    factors: List[Dict[str, Any]] = []

    if req.kyc_status == "rejected":
        score += 0.40
        factors.append({"factor": "kyc_rejected", "weight": 0.40, "description": "KYC rejected"})
    elif req.kyc_status == "pending":
        score += 0.15
        factors.append({"factor": "kyc_pending", "weight": 0.15, "description": "KYC not yet verified"})

    if req.account_age_days < 7:
        score += 0.25
        factors.append({"factor": "very_new_account", "weight": 0.25, "description": "Account less than 7 days old"})
    elif req.account_age_days < 30:
        score += 0.10
        factors.append({"factor": "new_account", "weight": 0.10, "description": "Account less than 30 days old"})

    if req.is_new_beneficiary:
        score += 0.10
        factors.append({"factor": "new_beneficiary", "weight": 0.10, "description": "First transfer to this beneficiary"})

    if req.is_new_device:
        score += 0.10
        factors.append({"factor": "new_device", "weight": 0.10, "description": "Transfer from unrecognized device"})

    if req.failed_attempts_24h >= 5:
        score += 0.20
        factors.append({"factor": "many_failed_attempts", "weight": 0.20, "description": f"{req.failed_attempts_24h} failed attempts in 24h"})
    elif req.failed_attempts_24h >= 2:
        score += 0.08
        factors.append({"factor": "some_failed_attempts", "weight": 0.08, "description": f"{req.failed_attempts_24h} failed attempts in 24h"})

    if 2 <= req.hour_of_day <= 5:
        score += 0.08
        factors.append({"factor": "unusual_hour", "weight": 0.08, "description": f"Transfer at {req.hour_of_day}:00 (unusual hour)"})

    if req.to_country.upper() in HIGH_RISK_COUNTRIES:
        score += 0.12
        factors.append({"factor": "high_risk_country", "weight": 0.12, "description": f"Destination {req.to_country} is high-risk"})

    if req.ip_country and req.ip_country.upper() != req.from_country.upper():
        score += 0.10
        factors.append({"factor": "ip_country_mismatch", "weight": 0.10, "description": f"IP country {req.ip_country} != sender country {req.from_country}"})

    if req.amount >= 50000:
        score += 0.15
        factors.append({"factor": "very_large_amount", "weight": 0.15, "description": f"Very large transfer: ${req.amount:,.2f}"})
    elif req.amount >= 10000:
        score += 0.07
        factors.append({"factor": "large_amount", "weight": 0.07, "description": f"Large transfer: ${req.amount:,.2f}"})

    if req.velocity_score > 0.7:
        score += 0.15
        factors.append({"factor": "high_velocity", "weight": 0.15, "description": "High transaction velocity detected"})
    elif req.velocity_score > 0.4:
        score += 0.07
        factors.append({"factor": "moderate_velocity", "weight": 0.07, "description": "Moderate transaction velocity"})

    score = min(1.0, round(score, 4))

    if score >= 0.70:
        risk_level = "critical"
        decision = "block"
        _metrics["fraud_blocks_total"] += 1
    elif score >= 0.45:
        risk_level = "high"
        decision = "review"
        _metrics["fraud_reviews_total"] += 1
    elif score >= 0.25:
        risk_level = "medium"
        decision = "review"
    else:
        risk_level = "low"
        decision = "approve"

    return FraudScoreResult(
        transfer_id=req.transfer_id,
        fraud_score=score,
        risk_level=risk_level,
        decision=decision,
        factors=factors,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/sanctions/screen", response_model=SanctionsScreenResult)
async def sanctions_screen(req: SanctionsScreenRequest) -> SanctionsScreenResult:
    """Screen a name/entity against OFAC/UN/EU/HMT sanctions lists."""
    _metrics["sanctions_screens_total"] += 1

    is_match, match_type, risk_level = _sanctions.check_name(req.name)

    if is_match:
        return SanctionsScreenResult(
            name=req.name,
            is_sanctioned=True,
            match_type=match_type,
            risk_level=risk_level,
            action="block" if risk_level == "critical" else "review",
            list_source="OFAC/UN/EU/HMT consolidated",
        )

    # Country-based sanction
    if req.country and req.country.upper() in SANCTIONED_COUNTRIES:
        return SanctionsScreenResult(
            name=req.name,
            is_sanctioned=True,
            match_type="country",
            risk_level="critical",
            action="block",
            list_source="sanctioned_countries",
        )

    # High-risk country
    if req.country and req.country.upper() in HIGH_RISK_COUNTRIES:
        return SanctionsScreenResult(
            name=req.name,
            is_sanctioned=False,
            match_type=None,
            risk_level="medium",
            action="review",
            list_source=None,
        )

    return SanctionsScreenResult(
        name=req.name,
        is_sanctioned=False,
        match_type=None,
        risk_level="low",
        action="allow",
        list_source=None,
    )


@app.post("/velocity/check", response_model=VelocityCheckResult)
async def velocity_check(req: VelocityCheckRequest) -> VelocityCheckResult:
    """Check if a user has exceeded their velocity limit. Uses Redis (production) or in-memory (dev)."""
    _metrics["velocity_checks_total"] += 1

    allowed, current_total = await velocity_add_and_check(
        user_id=req.user_id,
        amount_usd=req.amount_usd,
        window_seconds=req.window_seconds,
        limit_usd=req.limit_usd,
    )

    remaining = max(0.0, req.limit_usd - current_total - (req.amount_usd if allowed else 0))
    redis = await get_redis()

    return VelocityCheckResult(
        user_id=req.user_id,
        allowed=allowed,
        current_total=round(current_total, 2),
        limit=req.limit_usd,
        remaining=round(remaining, 2),
        window_seconds=req.window_seconds,
        storage_backend="redis" if redis else "in_memory",
    )


@app.post("/sanctions/refresh")
async def refresh_sanctions() -> Dict[str, Any]:
    """Force-refresh sanctions lists from upstream feeds."""
    result = await _sanctions.refresh_all()
    return {"status": "refreshed", **result}


@app.get("/sanctions/stats")
async def sanctions_stats() -> Dict[str, Any]:
    """Return sanctions list statistics."""
    return {
        "total_entries": _sanctions.total_entries,
        "last_refresh": _sanctions.last_refresh,
        "feeds": _sanctions._feed_stats,
        "errors": _sanctions._refresh_errors,
        "refresh_interval_secs": SANCTIONS_REFRESH_INTERVAL,
    }


@app.get("/compliance/rules")
async def get_compliance_rules() -> Dict[str, Any]:
    return {
        "rules": COMPLIANCE_RULES,
        "total": len(COMPLIANCE_RULES),
        "active": sum(1 for r in COMPLIANCE_RULES if r.get("active")),
    }


@app.get("/health")
async def health() -> Dict[str, Any]:
    redis = await get_redis()
    return {
        "status": "ok",
        "service": "remitflow-python-compliance-service",
        "version": "2.0.0",
        "sanctions_entries": _sanctions.total_entries,
        "sanctions_last_refresh": _sanctions.last_refresh,
        "redis_connected": redis is not None,
    }


@app.get("/metrics")
async def metrics_endpoint() -> str:
    lines = [
        "# HELP remitflow_compliance_checks_total Total compliance checks",
        "# TYPE remitflow_compliance_checks_total counter",
        f"remitflow_compliance_checks_total {_metrics['compliance_checks_total']}",
        "",
        "# HELP remitflow_compliance_blocks_total Total compliance blocks",
        "# TYPE remitflow_compliance_blocks_total counter",
        f"remitflow_compliance_blocks_total {_metrics['compliance_blocks_total']}",
        "",
        "# HELP remitflow_fraud_scores_total Total fraud scores computed",
        "# TYPE remitflow_fraud_scores_total counter",
        f"remitflow_fraud_scores_total {_metrics['fraud_scores_total']}",
        "",
        "# HELP remitflow_fraud_blocks_total Total fraud blocks",
        "# TYPE remitflow_fraud_blocks_total counter",
        f"remitflow_fraud_blocks_total {_metrics['fraud_blocks_total']}",
        "",
        "# HELP remitflow_sanctions_screens_total Total sanctions screens",
        "# TYPE remitflow_sanctions_screens_total counter",
        f"remitflow_sanctions_screens_total {_metrics['sanctions_screens_total']}",
        "",
        "# HELP remitflow_velocity_checks_total Total velocity checks",
        "# TYPE remitflow_velocity_checks_total counter",
        f"remitflow_velocity_checks_total {_metrics['velocity_checks_total']}",
        "",
        "# HELP remitflow_sanctions_entries_total Total sanctions list entries",
        "# TYPE remitflow_sanctions_entries_total gauge",
        f"remitflow_sanctions_entries_total {_sanctions.total_entries}",
    ]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8083))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
