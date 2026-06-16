from __future__ import annotations
import os
import json
"""
RemitFlow — Python ML Anomaly Detection Service
================================================

Detects financial-platform-specific attacks using statistical and ML models:

  1. Account Takeover (ATO)
     - Detects impossible travel (login from two geographically distant IPs
       within a time window that makes physical travel impossible)
     - Detects velocity anomalies (sudden spike in login attempts)
     - Detects device fingerprint mismatch

  2. Credential Stuffing
     - Detects high-volume, low-success-rate login attempts across many accounts
     - Uses Isolation Forest for unsupervised anomaly scoring
     - Tracks per-IP success/failure ratios with sliding windows

  3. Business Email Compromise (BEC) / Beneficiary Swap Attack
     - Detects beneficiary account changes followed immediately by large transfers
     - Flags "last-minute" beneficiary edits (< 24h before transfer)
     - Detects unusual destination countries for the user's history

  4. Round-Tripping / Money Laundering Patterns
     - Detects funds sent out and returned within a short window (round-trip)
     - Detects structuring (multiple transactions just below reporting thresholds)
     - Detects layering (rapid multi-hop transfers)

  5. Ransomware Behavioural Indicators
     - Detects mass file-upload followed by immediate download (encrypt-and-exfil)
     - Detects unusual API access patterns (bulk export of customer data)

Language choice: Python is ideal here because:
  - scikit-learn provides production-grade Isolation Forest and statistical models
  - pandas enables fast time-series windowing for velocity checks
  - numpy enables vectorised feature computation
  - FastAPI gives async HTTP with Pydantic validation at near-Go speeds
  - Rich ecosystem for threat intelligence feed parsing

API:
  POST /detect/ato           — Account Takeover detection
  POST /detect/credential-stuffing — Credential stuffing detection
  POST /detect/bec           — BEC / beneficiary swap detection
  POST /detect/round-trip    — Round-trip / laundering detection
  POST /detect/ransomware    — Ransomware behavioural detection
  GET  /health               — Liveness probe
"""

import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS anomaly_detector_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_anomaly_detector_updated
                    ON anomaly_detector_state(updated_at);
                CREATE TABLE IF NOT EXISTS anomaly_detector_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_anomaly_detector_events_type
                    ON anomaly_detector_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO anomaly_detector_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM anomaly_detector_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM anomaly_detector_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO anomaly_detector_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


app = FastAPI(title="RemitFlow Anomaly Detector", version="1.0.0")

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-anomaly-detector"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-anomaly-detector"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-anomaly-detector").info(f"Received signal {signum}, initiating graceful shutdown...")
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
        "service": "python-anomaly-detector",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-anomaly-detector").info("FastAPI shutdown event — cleaning up resources")


# Initialize PostgreSQL tables (middleware-ready)
_db_ensure_tables("anomaly_detector")

# ─── Shared In-Memory State ───────────────────────────────────────────────────
# In production these would be backed by Redis with TTL-based expiry.

# Per-IP login event ring buffer (last 200 events per IP)
_ip_login_events: Dict[str, deque] = defaultdict(lambda: deque(maxlen=200))

# Per-user login location history (last 10 locations)
_user_locations: Dict[str, deque] = defaultdict(lambda: deque(maxlen=10))

# Per-user beneficiary change timestamps
_user_beneficiary_changes: Dict[str, deque] = defaultdict(lambda: deque(maxlen=50))

# Per-user transfer history for round-trip detection
_user_transfers: Dict[str, deque] = defaultdict(lambda: deque(maxlen=100))

# Per-IP API access patterns for ransomware detection
_ip_api_patterns: Dict[str, deque] = defaultdict(lambda: deque(maxlen=500))

# ─── Haversine Distance ───────────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance between two GPS coordinates in km."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

# ─── Isolation Forest (lazy-initialised) ─────────────────────────────────────

@dataclass
class IsolationForestModel:
    """Wraps an Isolation Forest with online feature collection."""
    model: Optional[IsolationForest] = None
    feature_buffer: List[List[float]] = field(default_factory=list)
    min_samples: int = 50

    def add_sample(self, features: List[float]) -> None:
        self.feature_buffer.append(features)
        if len(self.feature_buffer) >= self.min_samples and len(self.feature_buffer) % 10 == 0:
            self._retrain()

    def _retrain(self) -> None:
        X = np.array(self.feature_buffer[-500:])  # keep last 500 samples
        self.model = IsolationForest(contamination=0.05, random_state=42, n_jobs=-1)
        self.model.fit(X)

    def score(self, features: List[float]) -> float:
        """Return anomaly score in [0, 1]. Higher = more anomalous."""
        if self.model is None or len(self.feature_buffer) < self.min_samples:
            return 0.0
        X = np.array([features])
        # decision_function returns negative values for anomalies
        raw = self.model.decision_function(X)[0]
        # Normalise to [0, 1]: more negative → closer to 1
        return float(np.clip(1.0 - (raw + 0.5), 0.0, 1.0))


_credential_stuffing_model = IsolationForestModel()

# ─── Request / Response Models ────────────────────────────────────────────────

class ATORequest(BaseModel):
    user_id: str
    ip_address: str
    latitude: float
    longitude: float
    timestamp_ms: int
    device_fingerprint: str
    user_agent: str

class ATOResponse(BaseModel):
    risk_score: float          # 0.0 – 1.0
    flags: List[str]
    action: str                # "allow" | "challenge" | "block"

class CredentialStuffingRequest(BaseModel):
    ip_address: str
    timestamp_ms: int
    success: bool
    target_user_id: str

class CredentialStuffingResponse(BaseModel):
    risk_score: float
    flags: List[str]
    action: str

class BECRequest(BaseModel):
    user_id: str
    beneficiary_id: str
    beneficiary_changed_at_ms: int
    transfer_amount_usd: float
    transfer_initiated_at_ms: int
    destination_country: str
    user_typical_countries: List[str]

class BECResponse(BaseModel):
    risk_score: float
    flags: List[str]
    action: str

class TransferEvent(BaseModel):
    amount_usd: float
    currency: str
    destination_account: str
    timestamp_ms: int
    direction: str  # "out" | "in"

class RoundTripRequest(BaseModel):
    user_id: str
    recent_transfers: List[TransferEvent]
    reporting_threshold_usd: float = 10_000.0

class RoundTripResponse(BaseModel):
    risk_score: float
    flags: List[str]
    action: str

class APIAccessEvent(BaseModel):
    endpoint: str
    method: str
    response_size_bytes: int
    timestamp_ms: int

class RansomwareRequest(BaseModel):
    ip_address: str
    user_id: str
    recent_api_events: List[APIAccessEvent]

class RansomwareResponse(BaseModel):
    risk_score: float
    flags: List[str]
    action: str

# ─── Detection Logic ──────────────────────────────────────────────────────────

def _action_from_score(score: float) -> str:
    if score >= 0.8:
        return "block"
    if score >= 0.5:
        return "challenge"
    return "allow"


@app.post("/detect/ato", response_model=ATOResponse)
async def detect_ato(req: ATORequest) -> ATOResponse:
    """Account Takeover detection via impossible travel + velocity + device."""
    flags: List[str] = []
    score = 0.0

    now_ms = req.timestamp_ms
    locations = _user_locations[req.user_id]

    # ── Impossible Travel ────────────────────────────────────────────────────
    if locations:
        last = locations[-1]
        last_lat, last_lon, last_ts = last["lat"], last["lon"], last["ts"]
        dist_km = haversine_km(last_lat, last_lon, req.latitude, req.longitude)
        elapsed_h = max((now_ms - last_ts) / 3_600_000, 0.001)
        speed_kmh = dist_km / elapsed_h
        # Max commercial flight speed ~900 km/h; add buffer for GPS inaccuracy
        if speed_kmh > 1200:
            flags.append(f"impossible_travel: {dist_km:.0f}km in {elapsed_h:.2f}h ({speed_kmh:.0f}km/h)")
            score = max(score, 0.95)
        elif speed_kmh > 600:
            flags.append(f"suspicious_travel_speed: {speed_kmh:.0f}km/h")
            score = max(score, 0.6)

    # ── Login Velocity ───────────────────────────────────────────────────────
    ip_events = _ip_login_events[req.ip_address]
    recent_window_ms = 5 * 60 * 1000  # 5 minutes
    recent_logins = sum(1 for e in ip_events if now_ms - e["ts"] < recent_window_ms)
    if recent_logins > 20:
        flags.append(f"high_login_velocity: {recent_logins} logins in 5min from {req.ip_address}")
        score = max(score, 0.85)
    elif recent_logins > 10:
        flags.append(f"elevated_login_velocity: {recent_logins} logins in 5min")
        score = max(score, 0.5)

    # ── Device Fingerprint Mismatch ──────────────────────────────────────────
    known_fps = {e["fp"] for e in locations if "fp" in e}
    if known_fps and req.device_fingerprint not in known_fps and len(known_fps) >= 2:
        flags.append(f"new_device_fingerprint: {req.device_fingerprint[:16]}...")
        score = max(score, 0.4)

    # Record this event
    locations.append({"lat": req.latitude, "lon": req.longitude, "ts": now_ms, "fp": req.device_fingerprint})
    ip_events.append({"ts": now_ms, "user": req.user_id})

    # Persist result to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
    import time as _time
    try:
        _result_data = ATOResponse if isinstance(ATOResponse, dict) else {"result": str(ATOResponse)}
        _db_upsert("anomaly_detector", f"detect_ato:{int(_time.time()*1000)}", _result_data)
        _db_log_event("anomaly_detector", "detect_ato", _result_data)
    except Exception:
        pass
    return ATOResponse(risk_score=round(score, 3), flags=flags, action=_action_from_score(score))


@app.post("/detect/credential-stuffing", response_model=CredentialStuffingResponse)
async def detect_credential_stuffing(req: CredentialStuffingRequest) -> CredentialStuffingResponse:
    """Credential stuffing detection via Isolation Forest on per-IP metrics."""
    flags: List[str] = []
    score = 0.0
    now_ms = req.timestamp_ms

    ip_events = _ip_login_events[req.ip_address]
    ip_events.append({"ts": now_ms, "success": req.success, "user": req.target_user_id})

    window_ms = 10 * 60 * 1000  # 10 minutes
    recent = [e for e in ip_events if now_ms - e["ts"] < window_ms]
    total = len(recent)
    successes = sum(1 for e in recent if e.get("success"))
    failures = total - successes
    unique_users = len({e["user"] for e in recent})
    failure_rate = failures / max(total, 1)

    # Features: [total_attempts, failure_rate, unique_users_targeted, attempts_per_minute]
    elapsed_min = max(window_ms / 60_000, 1)
    features = [float(total), failure_rate, float(unique_users), total / elapsed_min]
    _credential_stuffing_model.add_sample(features)
    ml_score = _credential_stuffing_model.score(features)

    # Rule-based thresholds (belt-and-suspenders)
    if total > 50 and failure_rate > 0.9:
        flags.append(f"high_failure_rate: {failure_rate:.0%} over {total} attempts")
        score = max(score, 0.9)
    if unique_users > 20:
        flags.append(f"many_unique_targets: {unique_users} accounts targeted")
        score = max(score, 0.85)
    if total > 100:
        flags.append(f"high_volume: {total} attempts in 10min")
        score = max(score, 0.8)

    # Blend rule score with ML score
    final_score = max(score, ml_score * 0.7)

    # Persist result to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
    import time as _time
    try:
        _result_data = CredentialStuffingResponse if isinstance(CredentialStuffingResponse, dict) else {"result": str(CredentialStuffingResponse)}
        _db_upsert("anomaly_detector", f"detect_credential-stuffing:{int(_time.time()*1000)}", _result_data)
        _db_log_event("anomaly_detector", "detect_credential-stuffing", _result_data)
    except Exception:
        pass
    return CredentialStuffingResponse(
        risk_score=round(final_score, 3),
        flags=flags,
        action=_action_from_score(final_score)
    )


@app.post("/detect/bec", response_model=BECResponse)
async def detect_bec(req: BECRequest) -> BECResponse:
    """BEC / Beneficiary Swap Attack detection."""
    flags: List[str] = []
    score = 0.0

    change_age_h = (req.transfer_initiated_at_ms - req.beneficiary_changed_at_ms) / 3_600_000

    # ── Last-minute beneficiary change ──────────────────────────────────────
    if change_age_h < 1:
        flags.append(f"last_minute_beneficiary_change: changed {change_age_h:.1f}h before transfer")
        score = max(score, 0.9)
    elif change_age_h < 24:
        flags.append(f"recent_beneficiary_change: changed {change_age_h:.1f}h before transfer")
        score = max(score, 0.6)

    # ── High-value transfer to new beneficiary ───────────────────────────────
    if req.transfer_amount_usd > 5_000 and change_age_h < 48:
        flags.append(f"high_value_new_beneficiary: ${req.transfer_amount_usd:,.0f} to recently-added account")
        score = max(score, 0.75)

    # ── Unusual destination country ──────────────────────────────────────────
    if req.destination_country not in req.user_typical_countries:
        flags.append(f"unusual_destination_country: {req.destination_country} not in user history")
        score = max(score, 0.5)

    # ── Record for future pattern analysis ──────────────────────────────────
    _user_beneficiary_changes[req.user_id].append({
        "ts": req.transfer_initiated_at_ms,
        "beneficiary": req.beneficiary_id,
        "amount": req.transfer_amount_usd,
    })

    # Persist result to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
    import time as _time
    try:
        _result_data = BECResponse if isinstance(BECResponse, dict) else {"result": str(BECResponse)}
        _db_upsert("anomaly_detector", f"detect_bec:{int(_time.time()*1000)}", _result_data)
        _db_log_event("anomaly_detector", "detect_bec", _result_data)
    except Exception:
        pass
    return BECResponse(risk_score=round(score, 3), flags=flags, action=_action_from_score(score))


@app.post("/detect/round-trip", response_model=RoundTripResponse)
async def detect_round_trip(req: RoundTripRequest) -> RoundTripResponse:
    """Round-trip / money laundering pattern detection."""
    flags: List[str] = []
    score = 0.0

    transfers = req.recent_transfers
    threshold = req.reporting_threshold_usd

    # ── Structuring (Smurfing) ────────────────────────────────────────────────
    # Multiple transactions just below the reporting threshold
    just_below = [t for t in transfers if threshold * 0.85 <= t.amount_usd < threshold]
    if len(just_below) >= 3:
        flags.append(f"structuring: {len(just_below)} transactions between ${threshold*0.85:,.0f}–${threshold:,.0f}")
        score = max(score, 0.85)

    # ── Round-Trip Detection ─────────────────────────────────────────────────
    # Find outgoing transfers that are matched by similar incoming transfers within 72h
    outgoing = [t for t in transfers if t.direction == "out"]
    incoming = [t for t in transfers if t.direction == "in"]
    for out_t in outgoing:
        for in_t in incoming:
            time_diff_h = abs(in_t.timestamp_ms - out_t.timestamp_ms) / 3_600_000
            amount_diff_pct = abs(in_t.amount_usd - out_t.amount_usd) / max(out_t.amount_usd, 1)
            if time_diff_h < 72 and amount_diff_pct < 0.05 and out_t.amount_usd > 500:
                flags.append(
                    f"round_trip: ${out_t.amount_usd:,.0f} out → ${in_t.amount_usd:,.0f} in within {time_diff_h:.1f}h"
                )
                score = max(score, 0.8)

    # ── Layering (Rapid Multi-Hop) ────────────────────────────────────────────
    # Many outgoing transfers to different accounts within 1 hour
    if len(outgoing) >= 3:
        timestamps = sorted(t.timestamp_ms for t in outgoing)
        if timestamps[-1] - timestamps[0] < 3_600_000:
            unique_destinations = len({t.destination_account for t in outgoing})
            if unique_destinations >= 3:
                flags.append(f"layering: {len(outgoing)} transfers to {unique_destinations} accounts in <1h")
                score = max(score, 0.75)

    # ── High Velocity ─────────────────────────────────────────────────────────
    total_out_usd = sum(t.amount_usd for t in outgoing)
    if total_out_usd > 50_000 and len(outgoing) > 5:
        flags.append(f"high_velocity_outflow: ${total_out_usd:,.0f} across {len(outgoing)} transfers")
        score = max(score, 0.65)

    # Persist result to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
    import time as _time
    try:
        _result_data = RoundTripResponse if isinstance(RoundTripResponse, dict) else {"result": str(RoundTripResponse)}
        _db_upsert("anomaly_detector", f"detect_round-trip:{int(_time.time()*1000)}", _result_data)
        _db_log_event("anomaly_detector", "detect_round-trip", _result_data)
    except Exception:
        pass
    return RoundTripResponse(risk_score=round(score, 3), flags=flags, action=_action_from_score(score))


@app.post("/detect/ransomware", response_model=RansomwareResponse)
async def detect_ransomware(req: RansomwareRequest) -> RansomwareResponse:
    """Ransomware behavioural indicator detection."""
    flags: List[str] = []
    score = 0.0

    events = req.recent_api_events
    now_ms = int(time.time() * 1000)
    window_ms = 60 * 60 * 1000  # 1 hour

    # ── Bulk Data Export ──────────────────────────────────────────────────────
    export_endpoints = [e for e in events if "export" in e.endpoint.lower() or "download" in e.endpoint.lower()]
    if len(export_endpoints) > 5:
        total_bytes = sum(e.response_size_bytes for e in export_endpoints)
        flags.append(f"bulk_data_export: {len(export_endpoints)} export calls, {total_bytes/1024/1024:.1f}MB")
        score = max(score, 0.85)

    # ── Mass Upload Followed by Download (Encrypt-and-Exfil) ─────────────────
    uploads = [e for e in events if e.method in ("POST", "PUT") and "upload" in e.endpoint.lower()]
    downloads = [e for e in events if e.method == "GET" and e.response_size_bytes > 100_000]
    if len(uploads) > 10 and len(downloads) > 10:
        # Check if downloads follow uploads within 30 minutes
        if uploads and downloads:
            last_upload_ts = max(e.timestamp_ms for e in uploads)
            first_download_ts = min(e.timestamp_ms for e in downloads)
            if 0 < first_download_ts - last_upload_ts < 1_800_000:
                flags.append(f"encrypt_exfil_pattern: {len(uploads)} uploads → {len(downloads)} downloads within 30min")
                score = max(score, 0.9)

    # ── Unusual API Enumeration ───────────────────────────────────────────────
    unique_endpoints = len({e.endpoint for e in events})
    if unique_endpoints > 20 and len(events) > 50:
        flags.append(f"api_enumeration: {unique_endpoints} unique endpoints in {len(events)} requests")
        score = max(score, 0.6)

    # ── High-Frequency Requests ───────────────────────────────────────────────
    recent = [e for e in events if now_ms - e.timestamp_ms < window_ms]
    if len(recent) > 200:
        flags.append(f"high_request_frequency: {len(recent)} requests in 1h")
        score = max(score, 0.5)

    # Persist result to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
    import time as _time
    try:
        _result_data = RansomwareResponse if isinstance(RansomwareResponse, dict) else {"result": str(RansomwareResponse)}
        _db_upsert("anomaly_detector", f"detect_ransomware:{int(_time.time()*1000)}", _result_data)
        _db_log_event("anomaly_detector", "detect_ransomware", _result_data)
    except Exception:
        pass
    return RansomwareResponse(risk_score=round(score, 3), flags=flags, action=_action_from_score(score))


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "python-anomaly-detector",
        "models": {
            "credential_stuffing_if": "trained" if _credential_stuffing_model.model else "warming_up",
            "samples_collected": len(_credential_stuffing_model.feature_buffer),
        }
    }


if __name__ == "__main__":
    import uvicorn

# ─── PostgreSQL Persistence (middleware-ready: swap to TigerBeetle/Kafka in production) ───
import psycopg2
import json as _json
import signal
import atexit

def _get_db_conn():
    """Get PostgreSQL connection (middleware-ready: swap to TigerBeetle in production)."""
    try:
        db_url = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        return conn
    except Exception:
        return None

def _db_ensure_tables(table_prefix):
    """Create state and events tables if they don't exist."""
    conn = _get_db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_prefix}_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{{}}',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_prefix}_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB DEFAULT '{{}}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.close()
            conn.close()
        except Exception:
            pass

def _db_upsert(table_prefix, record_id, data):
    """Upsert a record to PostgreSQL state table."""
    conn = _get_db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                f"INSERT INTO {table_prefix}_state (id, data, updated_at) VALUES (%s, %s, NOW()) "
                f"ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()",
                (record_id, _json.dumps(data), _json.dumps(data))
            )
            cur.close()
            conn.close()
        except Exception:
            pass

def _db_get(table_prefix, record_id):
    """Get a record from PostgreSQL state table."""
    conn = _get_db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(f"SELECT data FROM {table_prefix}_state WHERE id = %s", (record_id,))
            row = cur.fetchone()
            cur.close()
            conn.close()
            if row:
                return row[0]
        except Exception:
            pass
    return None

def _db_list(table_prefix, limit=200):
    """List records from PostgreSQL state table."""
    conn = _get_db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(f"SELECT data FROM {table_prefix}_state ORDER BY updated_at DESC LIMIT %s", (limit,))
            rows = cur.fetchall()
            cur.close()
            conn.close()
            return [r[0] for r in rows]
        except Exception:
            pass
    return []

def _db_log_event(table_prefix, event_type, payload):
    """Log an event to PostgreSQL events table."""
    conn = _get_db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                f"INSERT INTO {table_prefix}_events (event_type, payload) VALUES (%s, %s)",
                (event_type, _json.dumps(payload))
            )
            cur.close()
            conn.close()
        except Exception:
            pass

    port = int(__import__("os").environ.get("PORT", "8082"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
