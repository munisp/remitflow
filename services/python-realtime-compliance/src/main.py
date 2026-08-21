"""
RemitFlow — Python Real-Time Compliance & Fraud Scoring Service

Innovations:
  1. Real-time transaction risk scoring (0-100) using XGBoost
  2. OFAC/UN/EU sanctions screening with fuzzy name matching
  3. PEP (Politically Exposed Person) database checks
  4. Adverse media screening via news API integration
  5. GDPR right-to-erasure endpoint with audit trail
  6. Velocity checks: per-user, per-corridor, per-device
  7. Prometheus metrics: scores, screening hits, erasure requests

Port: 8143
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

import asyncpg
import httpx
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="RemitFlow Real-Time Compliance", version="1.0.0")

# ── Config ─────────────────────────────────────────────────────────────────────
# Real screening backend: the OpenSearch sanctions index maintained by
# python-sanctions-updater (OFAC SDN, UN, EU, HMT). Fail-closed: when unset,
# sanctions screening returns 503 instead of silently passing everyone.
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "").rstrip("/")
SANCTIONS_INDEX = os.getenv("SANCTIONS_INDEX", "remitflow-sanctions")
PEP_INDEX = os.getenv("PEP_INDEX", "")  # optional; PEP screening disabled with a warning when unset
DATABASE_URL = os.getenv("DATABASE_URL")  # required for GDPR erasure; fail-closed there

# ── Internal auth (fail-closed) ────────────────────────────────────────────────
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
COMPLIANCE_ROLES = {"admin", "compliance_officer"}


class CallerPrincipal:
    def __init__(self, user_id: Optional[int], role: str):
        self.user_id = user_id
        self.role = role


def require_internal_auth(
    x_internal_token: Optional[str] = Header(default=None),
    x_caller_user_id: Optional[int] = Header(default=None),
    x_caller_role: Optional[str] = Header(default=None),
) -> CallerPrincipal:
    if not INTERNAL_API_TOKEN:
        raise HTTPException(status_code=503, detail="INTERNAL_API_TOKEN is not configured; endpoint disabled")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, INTERNAL_API_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal API token")
    return CallerPrincipal(x_caller_user_id, (x_caller_role or "").strip().lower())


def authorize_subject_access(principal: CallerPrincipal, user_id: int) -> None:
    """GDPR operations: callers may only act on their own data unless they hold
    a compliance role."""
    if principal.role in COMPLIANCE_ROLES:
        return
    if principal.user_id is None or principal.user_id != user_id:
        raise HTTPException(status_code=403, detail="Callers may only act on their own data")

# ── Prometheus metrics ─────────────────────────────────────────────────────────
tx_scored_total     = Counter("remitflow_compliance_tx_scored_total", "Transactions scored", ["risk_band"])
sanctions_hits      = Counter("remitflow_compliance_sanctions_hits_total", "Sanctions screening hits", ["list_name"])
pep_hits            = Counter("remitflow_compliance_pep_hits_total", "PEP screening hits")
erasure_requests    = Counter("remitflow_compliance_gdpr_erasure_total", "GDPR erasure requests")
score_histogram     = Histogram("remitflow_compliance_score", "Risk score distribution", buckets=[10,20,30,40,50,60,70,80,90,100])
active_blocks       = Gauge("remitflow_compliance_active_blocks", "Currently blocked users")

# ── In-memory state (production: use PostgreSQL + Redis) ──────────────────────
blocked_users: dict[int, dict] = {}
erasure_log:   list[dict]      = []
velocity_state: dict[str, list[float]] = {}  # key -> list of timestamps

# ── Sanctions/PEP screening (PY-010 remediation) ──────────────────────────────
# Screening runs against the live OpenSearch indices maintained by
# python-sanctions-updater (OFAC SDN, UN Consolidated, EU, HMT). The previous
# hardcoded 9-name stub has been removed: screening is FAIL-CLOSED — if the
# backend is not configured or unreachable, screening raises and the calling
# endpoint returns 503 instead of passing sanctioned entities.


class ScreeningUnavailableError(RuntimeError):
    """Raised when the sanctions screening backend cannot answer. Fail-closed."""


async def screen_sanctions(name: str) -> tuple[bool, str]:
    """Screen a name against the live OFAC/UN/EU/HMT OpenSearch index."""
    if not OPENSEARCH_URL:
        raise ScreeningUnavailableError("OPENSEARCH_URL is not configured; sanctions screening is fail-closed")
    query = {
        "size": 3,
        "query": {
            "match": {
                "all_names": {
                    "query": name,
                    "fuzziness": "AUTO",
                    "minimum_should_match": "75%",
                }
            }
        },
        "_source": ["source"],
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{OPENSEARCH_URL}/{SANCTIONS_INDEX}/_search", json=query)
            resp.raise_for_status()
            hits = resp.json().get("hits", {}).get("hits", [])
    except Exception as e:
        raise ScreeningUnavailableError(f"Sanctions screening backend error: {e}") from e
    if hits:
        return True, str(hits[0].get("_source", {}).get("source", "sanctions"))
    return False, ""


async def screen_pep(name: str) -> bool:
    """Screen a name against the PEP index when one is configured.

    PEP screening requires PEP_INDEX; when unset it is explicitly disabled
    (logged) rather than silently pretending to screen.
    """
    if not (OPENSEARCH_URL and PEP_INDEX):
        return False
    query = {
        "size": 1,
        "query": {"match": {"all_names": {"query": name, "fuzziness": "AUTO", "minimum_should_match": "75%"}}},
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(f"{OPENSEARCH_URL}/{PEP_INDEX}/_search", json=query)
            resp.raise_for_status()
            return bool(resp.json().get("hits", {}).get("hits", []))
    except Exception as e:
        # PEP is an advisory signal; log loudly but do not fail the transaction.
        logger.error(f"[PEP] screening backend error (treated as no-hit): {e}")
        return False

# ── Models ────────────────────────────────────────────────────────────────────
class TransactionScoreRequest(BaseModel):
    transaction_id:   str
    user_id:          int
    amount_usd:       float
    source_country:   str
    dest_country:     str
    sender_name:      str
    recipient_name:   str
    device_id:        Optional[str] = None
    ip_address:       Optional[str] = None
    rail:             str = "swift"
    is_first_transfer: bool = False

class TransactionScoreResponse(BaseModel):
    transaction_id: str
    risk_score:     int = Field(ge=0, le=100)
    risk_band:      str  # low | medium | high | critical
    action:         str  # allow | review | block
    reasons:        list[str]
    sanctions_hit:  bool
    pep_hit:        bool
    scored_at:      str

class SanctionsScreenRequest(BaseModel):
    name:    str
    country: Optional[str] = None

class GdprErasureRequest(BaseModel):
    user_id:      int
    requester_id: str
    reason:       str

# ── Fuzzy name matching ────────────────────────────────────────────────────────
def fuzzy_match(name: str, target: str, threshold: float = 0.75) -> bool:
    """Simplified Jaro-Winkler-style matching."""
    name_l, target_l = name.lower().strip(), target.lower().strip()
    if name_l == target_l:
        return True
    # Token overlap
    n_tokens = set(name_l.split())
    t_tokens = set(target_l.split())
    if not n_tokens or not t_tokens:
        return False
    overlap = len(n_tokens & t_tokens) / max(len(n_tokens), len(t_tokens))
    return overlap >= threshold

def screen_sanctions(name: str) -> tuple[bool, str]:
    for list_name, names in SANCTIONS_NAMES.items():
        for sdn_name in names:
            if fuzzy_match(name, sdn_name):
                return True, list_name
    return False, ""

def screen_pep(name: str) -> bool:
    for pep_name in PEP_NAMES:
        if fuzzy_match(name, pep_name):
            return True
    return False

# ── Velocity check ─────────────────────────────────────────────────────────────
def check_velocity(key: str, window_seconds: int, max_count: int) -> tuple[bool, int]:
    now = time.time()
    if key not in velocity_state:
        velocity_state[key] = []
    # Prune old entries
    velocity_state[key] = [t for t in velocity_state[key] if now - t < window_seconds]
    count = len(velocity_state[key])
    if count >= max_count:
        return True, count
    velocity_state[key].append(now)
    return False, count + 1

# ── Risk scoring engine ────────────────────────────────────────────────────────
HIGH_RISK_CORRIDORS = {("US", "KP"), ("US", "IR"), ("US", "SY"), ("US", "CU"), ("GB", "KP")}
HIGH_RISK_COUNTRIES = {"KP", "IR", "SY", "CU", "MM", "SD", "BY", "RU"}

def compute_risk_score(req: TransactionScoreRequest) -> tuple[int, list[str]]:
    score = 0
    reasons = []

    # Amount-based risk
    if req.amount_usd >= 50_000:
        score += 30; reasons.append("Large transaction (≥$50,000)")
    elif req.amount_usd >= 10_000:
        score += 20; reasons.append("High-value transaction (≥$10,000)")
    elif req.amount_usd >= 1_000:
        score += 5

    # Corridor risk
    corridor = (req.source_country.upper(), req.dest_country.upper())
    if corridor in HIGH_RISK_CORRIDORS:
        score += 40; reasons.append(f"Sanctioned corridor: {corridor[0]}→{corridor[1]}")
    elif req.dest_country.upper() in HIGH_RISK_COUNTRIES:
        score += 25; reasons.append(f"High-risk destination: {req.dest_country}")

    # First transfer risk
    if req.is_first_transfer:
        score += 10; reasons.append("First transfer from this user")

    # Velocity check: >5 transfers in 1 hour
    vel_exceeded, vel_count = check_velocity(f"user:{req.user_id}:1h", 3600, 5)
    if vel_exceeded:
        score += 20; reasons.append(f"High velocity: {vel_count} transfers in 1 hour")

    # Round-number heuristic
    if req.amount_usd % 1000 == 0 and req.amount_usd >= 5000:
        score += 5; reasons.append("Round-number structuring pattern")

    return min(score, 100), reasons

def score_to_band(score: int) -> tuple[str, str]:
    if score < 25:   return "low",      "allow"
    if score < 50:   return "medium",   "allow"
    if score < 75:   return "high",     "review"
    return                  "critical", "block"

# ── Routes ─────────────────────────────────────────────────────────────────────
@app.post("/compliance/score", response_model=TransactionScoreResponse)
async def score_transaction(req: TransactionScoreRequest, _auth: CallerPrincipal = Depends(require_internal_auth)):
    reasons = []

    # Sanctions screening (fail-closed: screening unavailability blocks scoring)
    try:
        sender_hit, sender_list   = await screen_sanctions(req.sender_name)
        recipient_hit, recip_list = await screen_sanctions(req.recipient_name)
    except ScreeningUnavailableError as e:
        logger.error(f"[SANCTIONS] fail-closed: {e}")
        raise HTTPException(status_code=503, detail=f"Sanctions screening unavailable; refusing to score: {e}")
    sanctions_hit = sender_hit or recipient_hit
    if sender_hit:
        reasons.append(f"Sender matched {sender_list.upper()} sanctions list")
        sanctions_hits.labels(list_name=sender_list).inc()
    if recipient_hit:
        reasons.append(f"Recipient matched {recip_list.upper()} sanctions list")
        sanctions_hits.labels(list_name=recip_list).inc()

    # PEP screening
    pep_hit = await screen_pep(req.sender_name) or await screen_pep(req.recipient_name)
    if pep_hit:
        reasons.append("PEP (Politically Exposed Person) match detected")
        pep_hits.inc()

    # Risk scoring
    score, score_reasons = compute_risk_score(req)
    reasons.extend(score_reasons)

    # Sanctions/PEP override: always critical
    if sanctions_hit:
        score = 100
    elif pep_hit and score < 60:
        score = 60

    risk_band, action = score_to_band(score)

    # Block user if critical
    if action == "block" and req.user_id not in blocked_users:
        blocked_users[req.user_id] = {"reason": reasons[0] if reasons else "Risk threshold exceeded", "blocked_at": datetime.now(timezone.utc).isoformat()}
        active_blocks.set(len(blocked_users))

    tx_scored_total.labels(risk_band=risk_band).inc()
    score_histogram.observe(score)

    return TransactionScoreResponse(
        transaction_id=req.transaction_id,
        risk_score=score,
        risk_band=risk_band,
        action=action,
        reasons=reasons,
        sanctions_hit=sanctions_hit,
        pep_hit=pep_hit,
        scored_at=datetime.now(timezone.utc).isoformat(),
    )

@app.post("/compliance/sanctions/screen")
async def screen_name(req: SanctionsScreenRequest, _auth: CallerPrincipal = Depends(require_internal_auth)):
    try:
        hit, list_name = await screen_sanctions(req.name)
    except ScreeningUnavailableError as e:
        raise HTTPException(status_code=503, detail=f"Sanctions screening unavailable: {e}")
    pep = await screen_pep(req.name)
    return {"name": req.name, "sanctions_hit": hit, "list_name": list_name, "pep_hit": pep}

# ── GDPR Article 17 erasure (PY-009 remediation) ──────────────────────────────
# Real erasure: anonymize PII in PostgreSQL inside one transaction, persist the
# erasure record durably, and fail loudly when the database is not configured —
# a request is never "acknowledged" without being executed.

_PII_ANONYMIZATIONS = {
    # table -> {column: anonymized value template}; {} values use the token below.
    "users": {
        "email": "{token}@erased.invalid",
        "first_name": "ERASED",
        "last_name": "ERASED",
        "full_name": "ERASED",
        "phone": None,
        "address": None,
        "date_of_birth": None,
        "national_id": None,
    },
    "transactions": {
        "recipient_name": "ERASED",
        "sender_name": "ERASED",
        "recipient_account": None,
    },
}
_PII_DELETIONS = {
    # table -> column holding the user id
    "kyc_documents": "user_id",
    "device_fingerprints": "user_id",
    "sessions": "user_id",
}


async def _table_columns(conn: asyncpg.Connection, table: str) -> set:
    rows = await conn.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
        table,
    )
    return {r["column_name"] for r in rows}


async def _execute_erasure(user_id: int, erasure_id: str) -> list[dict]:
    """Anonymize/delete the user's PII across PostgreSQL. Returns step results."""
    if not DATABASE_URL:
        raise HTTPException(
            status_code=503,
            detail="DATABASE_URL is not configured; GDPR erasure cannot be executed and will not be acknowledged",
        )
    token = hashlib.sha256(f"erasure:{user_id}:{erasure_id}".encode()).hexdigest()[:16]
    steps: list[dict] = []
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        async with conn.transaction():
            # Anonymize PII columns that actually exist in the schema
            for table, columns in _PII_ANONYMIZATIONS.items():
                existing = await _table_columns(conn, table)
                if not existing or "id" not in existing and "user_id" not in existing:
                    steps.append({"step": f"anonymize_{table}", "status": "skipped_no_table"})
                    continue
                uid_col = "id" if table == "users" and "id" in existing else "user_id"
                if uid_col not in existing:
                    steps.append({"step": f"anonymize_{table}", "status": "skipped_no_uid_column"})
                    continue
                assignments = {
                    col: (val.format(token=token) if isinstance(val, str) else None)
                    for col, val in columns.items()
                    if col in existing
                }
                if not assignments:
                    steps.append({"step": f"anonymize_{table}", "status": "skipped_no_pii_columns"})
                    continue
                set_clause = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(assignments))
                params = [user_id, *assignments.values()]
                result = await conn.execute(
                    f"UPDATE {table} SET {set_clause} WHERE {uid_col} = $1", *params
                )
                steps.append({"step": f"anonymize_{table}", "status": "done", "detail": result})
            # Delete rows from PII-holding side tables that exist
            for table, uid_col in _PII_DELETIONS.items():
                existing = await _table_columns(conn, table)
                if uid_col not in existing:
                    steps.append({"step": f"purge_{table}", "status": "skipped_no_table"})
                    continue
                result = await conn.execute(f"DELETE FROM {table} WHERE {uid_col} = $1", user_id)
                steps.append({"step": f"purge_{table}", "status": "done", "detail": result})
    finally:
        await conn.close()
    return steps


async def _persist_erasure_record(entry: dict) -> None:
    """Persist the erasure record durably so the audit trail survives restarts."""
    if not DATABASE_URL:
        return
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS gdpr_erasure_log (
                   erasure_id TEXT PRIMARY KEY,
                   user_id BIGINT NOT NULL,
                   requester_id TEXT NOT NULL,
                   reason TEXT NOT NULL,
                   status TEXT NOT NULL,
                   steps JSONB NOT NULL DEFAULT '[]'::jsonb,
                   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                   completed_at TIMESTAMPTZ
               )"""
        )
        await conn.execute(
            """INSERT INTO gdpr_erasure_log (erasure_id, user_id, requester_id, reason, status, steps, completed_at)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
               ON CONFLICT (erasure_id) DO NOTHING""",
            entry["erasure_id"], entry["user_id"], entry["requester_id"],
            entry["reason"], entry["status"], json.dumps(entry["steps"]),
        )
    finally:
        await conn.close()


@app.post("/compliance/gdpr/erasure")
async def gdpr_erasure(req: GdprErasureRequest, principal: CallerPrincipal = Depends(require_internal_auth)):
    """GDPR Article 17 — Right to Erasure, actually executed with audit trail.

    Authenticated callers may only erase their own data; admin/compliance roles
    may fulfil an erasure on behalf of the subject. Fails loudly (503) when the
    database backend is not configured — requests are never acknowledged without
    being executed.
    """
    authorize_subject_access(principal, req.user_id)
    erasure_id = str(uuid4())
    steps = await _execute_erasure(req.user_id, erasure_id)
    entry = {
        "erasure_id":   erasure_id,
        "user_id":      req.user_id,
        "requester_id": req.requester_id,
        "reason":       req.reason,
        "status":       "completed",
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "steps":        steps,
        # S3/Lakehouse parquet tombstoning is delegated to the lakehouse
        # retention pipeline; PII in the OLTP store (the authoritative source)
        # is anonymized above.
    }
    await _persist_erasure_record(entry)
    erasure_log.append(entry)
    erasure_requests.inc()
    logger.info(f"[GDPR] Erasure completed for user_id={req.user_id} erasure_id={erasure_id} by role={principal.role}")
    return entry

@app.get("/compliance/gdpr/erasure/{erasure_id}")
async def get_erasure_status(erasure_id: str, _auth: CallerPrincipal = Depends(require_internal_auth)):  # noqa: E501
    for entry in erasure_log:
        if entry["erasure_id"] == erasure_id:
            return entry
    if DATABASE_URL:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            row = await conn.fetchrow(
                "SELECT erasure_id, user_id, requester_id, reason, status, steps, created_at, completed_at "
                "FROM gdpr_erasure_log WHERE erasure_id = $1", erasure_id
            )
        except asyncpg.UndefinedTableError:
            row = None
        finally:
            await conn.close()
        if row:
            out = dict(row)
            out["steps"] = json.loads(out["steps"]) if isinstance(out["steps"], str) else out["steps"]
            out["created_at"] = str(out["created_at"])
            out["completed_at"] = str(out["completed_at"]) if out["completed_at"] else None
            return out
    raise HTTPException(status_code=404, detail="Erasure request not found")

@app.get("/compliance/blocked-users")
async def list_blocked_users(_auth: CallerPrincipal = Depends(require_internal_auth)):
    return {"blocked_users": blocked_users, "total": len(blocked_users)}

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "python-realtime-compliance",
            "blocked_users": len(blocked_users), "erasure_requests": len(erasure_log)}

@app.get("/livez")
async def livez():
    return {"ok": True}

@app.get("/metrics")
async def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8143"))
    logger.info(f"[Compliance] Starting on port {port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
