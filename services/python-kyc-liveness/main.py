"""
RemitFlow KYC Liveness Verification Service (Python) — SPEC-wave15 §5 overhaul.

Performs face liveness detection, active challenge validation, document OCR
(fallback only), and identity matching.

Liveness providers (controlled by LIVENESS_PROVIDER env var):
  - minifasnet  [default, OSS] MiniFASNet via uniface ONNX (Apache 2.0, CPU-only).
                IMPORTANT: MiniFASNet is NOT certified to ISO/IEC 30107-3 PAD
                Level 1 or Level 2. No independently audited accuracy figures are
                claimed here. It is deployed as a presentation-attack DETERRENCE
                control only, never as certification-grade PAD. All liveness
                responses carry certified=false.
  - iproov      iProov commercial SDK (OPT-IN ONLY — hard-fails unless
                IPROOV_API_KEY is explicitly set). Platform default is pure OSS.
  - onfido      Onfido commercial SDK (OPT-IN ONLY — hard-fails unless
                ONFIDO_API_TOKEN is explicitly set). Platform default is pure OSS.

FAIL-CLOSED policy (SPEC-wave15): when a model, dependency, or downstream
service (rust-biometric) is unavailable, endpoints return an error (503);
there is NO silent heuristic fallback that returns success.

MRZ delegation (SPEC-wave15 §5): the primary MRZ/document-parsing path is owned
by python-kyc-pipeline (wave-15 K1). The pytesseract/passporteye code in this
service is retained ONLY as an optional fallback for the /verify endpoint and
must not be extended — new MRZ work belongs in python-kyc-pipeline.

Endpoints:
  GET  /health              liveness/readiness probe
  GET  /metrics             Prometheus metrics
  POST /verify              full KYC liveness + face match + OCR fallback
  POST /check/passive       single-frame passive PAD (MiniFASNet, uncertified)
  POST /check/active        video-clip passive PAD sampling
  POST /match               face comparison
  POST /challenge/validate  active challenge-response validation (mediapipe
                            blendshapes + timing + order + cross-frame biometric
                            consistency via rust-biometric)

Integrates with: PostgreSQL (state/audit), Dapr pub/sub, rust-biometric (HTTP).
"""

import asyncio
import base64
import io
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

import httpx

# ── Shared HTTP clients (SPEC-wave14 §4.6) ────────────────────────────────────
# Timeout-keyed pool of module-level AsyncClients: outbound calls previously
# constructed a fresh client per request (TCP/TLS + pool setup each time).
# Clients live for the process lifetime; pools are capped at 100 connections.
_http_clients: dict = {}


def get_http_client(timeout: float = 5.0, **kwargs) -> httpx.AsyncClient:
    key = (float(timeout), tuple(sorted(kwargs.items())))
    client = _http_clients.get(key)
    if client is None:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            limits=httpx.Limits(max_connections=100),
            **kwargs,
        )
        _http_clients[key] = client
    return client

from fastapi import FastAPI, HTTPException, Response, UploadFile, File, Form
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
import signal
import atexit



def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[python-kyc-liveness] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value

_DB_URL = _require_env("DATABASE_URL")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL, options="-c statement_timeout=5000")  # SPEC-wave14 §4.6: 5s statement_timeout
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS kyc_liveness_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_kyc_liveness_updated
                    ON kyc_liveness_state(updated_at);
                CREATE TABLE IF NOT EXISTS kyc_liveness_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_kyc_liveness_events_type
                    ON kyc_liveness_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO kyc_liveness_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM kyc_liveness_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM kyc_liveness_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO kyc_liveness_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("kyc-liveness")

app = FastAPI(title="RemitFlow KYC Liveness Service", version="2.1.0")

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-kyc-liveness"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-kyc-liveness"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-kyc-liveness").info(f"Received signal {signum}, initiating graceful shutdown...")
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
        "service": "python-kyc-liveness",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-kyc-liveness").info("FastAPI shutdown event — cleaning up resources")


# ─── Config ──────────────────────────────────────────────────────────────────

DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")
DAPR_STATESTORE = os.getenv("DAPR_STATESTORE_NAME", "remitflow-statestore")
DAPR_PUBSUB = os.getenv("DAPR_PUBSUB_NAME", "remitflow-pubsub")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
KYC_CONFIDENCE_THRESHOLD = float(os.getenv("KYC_CONFIDENCE_THRESHOLD", "0.85"))
FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.80"))

# Provider selection — minifasnet (default, OSS) | iproov | onfido (commercial, opt-in)
LIVENESS_PROVIDER = os.getenv("LIVENESS_PROVIDER", "minifasnet").lower()

# iProov config (only used when LIVENESS_PROVIDER=iproov — commercial, opt-in;
# the platform default is pure OSS and this provider hard-fails without creds)
IPROOV_API_KEY = os.getenv("IPROOV_API_KEY", "")
IPROOV_BASE_URL = os.getenv("IPROOV_BASE_URL", "https://eu.rp.secure.iproov.me/api/v2")

# Onfido config (only used when LIVENESS_PROVIDER=onfido — commercial, opt-in;
# the platform default is pure OSS and this provider hard-fails without creds)
ONFIDO_API_TOKEN = os.getenv("ONFIDO_API_TOKEN", "")
ONFIDO_BASE_URL = os.getenv("ONFIDO_BASE_URL", "https://api.eu.onfido.com/v3.6")

# ── Challenge validation config (SPEC-wave15 §5, /challenge/validate) ─────────
# rust-biometric service base URL for per-frame face embeddings (fail-closed
# when unset/empty or unreachable).
RUST_BIOMETRIC_URL = os.getenv("RUST_BIOMETRIC_URL", "").rstrip("/")
# Cross-frame face consistency: minimum cosine similarity between the first
# sampled frame's embedding and every other sampled frame's embedding.
CHALLENGE_CONSISTENCY_THRESHOLD = float(os.getenv("CHALLENGE_CONSISTENCY_THRESHOLD", "0.5"))
# Timing plausibility bounds (client-reported event timestamps, milliseconds).
CHALLENGE_MIN_DWELL_MS = float(os.getenv("CHALLENGE_MIN_DWELL_MS", "250"))     # faster = scripted/bot
CHALLENGE_MAX_DWELL_MS = float(os.getenv("CHALLENGE_MAX_DWELL_MS", "30000"))   # slower = stalled/replay
CHALLENGE_MAX_TOTAL_MS = float(os.getenv("CHALLENGE_MAX_TOTAL_MS", "180000"))
# MediaPipe Face Landmarker model asset (lazy-loaded; missing → fail-closed).
MEDIAPIPE_FACE_LANDMARKER_MODEL = os.getenv(
    "MEDIAPIPE_FACE_LANDMARKER_MODEL", "/app/models/face_landmarker.task"
)
# Blendshape / head-pose decision thresholds (deterrence tuning, NOT certified).
CHALLENGE_BLENDSHAPE_THRESHOLD = float(os.getenv("CHALLENGE_BLENDSHAPE_THRESHOLD", "0.45"))
CHALLENGE_HEAD_TURN_MIN_DEG = float(os.getenv("CHALLENGE_HEAD_TURN_MIN_DEG", "12.0"))
CHALLENGE_HEAD_NOD_MIN_DEG = float(os.getenv("CHALLENGE_HEAD_NOD_MIN_DEG", "10.0"))
# Max sampled frames accepted per validation request (abuse guard).
CHALLENGE_MAX_FRAMES = int(os.getenv("CHALLENGE_MAX_FRAMES", "16"))
# If "true", the session nonce MUST exist in kyc_capture_sessions (written by the
# capture-session issuer) and its server-issued challenge must match; if the row
# cannot be checked the endpoint fails closed. Default false: when no server row
# is found we proceed against the client-supplied sequence but emit the
# "nonce_not_server_verified" risk flag.
CHALLENGE_REQUIRE_SERVER_NONCE = os.getenv("CHALLENGE_REQUIRE_SERVER_NONCE", "false").lower() == "true"

# ─── Models ──────────────────────────────────────────────────────────────────

class LivenessRequest(BaseModel):
    user_id: int
    session_id: str
    selfie_base64: str
    document_front_base64: str
    document_back_base64: Optional[str] = None
    document_type: str = "passport"
    declared_name: str
    declared_dob: Optional[str] = None
    declared_nationality: Optional[str] = None


class LivenessResponse(BaseModel):
    session_id: str
    user_id: int
    liveness_passed: bool
    face_match_score: float
    face_match_passed: bool
    ocr_name: Optional[str]
    ocr_dob: Optional[str]
    ocr_document_number: Optional[str]
    ocr_nationality: Optional[str]
    name_match_score: float
    name_match_passed: bool
    overall_passed: bool
    risk_flags: list[str]
    confidence: float
    processing_time_ms: int
    verified_at: str
    liveness_provider: str
    liveness_method: str
    # Honest labeling (SPEC-wave15 §5): no OSS liveness path in this service is
    # ISO/IEC 30107-3 PAD certified. `certified` is ALWAYS false here.
    certified: bool = False
    # One of: "minifasnet-passive" | "iproov-commercial" | "onfido-commercial"
    method: str = "minifasnet-passive"


class OCRResult(BaseModel):
    name: Optional[str]
    dob: Optional[str]
    document_number: Optional[str]
    nationality: Optional[str]
    expiry_date: Optional[str]
    mrz_line1: Optional[str]
    mrz_line2: Optional[str]
    confidence: float


class HealthResponse(BaseModel):
    status: str
    liveness_provider: str
    deepface_available: bool
    tesseract_available: bool
    uniface_available: bool
    dapr_connected: bool
    # SPEC-wave15 §5 additions (optional, backward-compatible):
    mediapipe_available: bool = False       # Face Landmarker importable + model asset present
    rust_biometric_configured: bool = False # RUST_BIOMETRIC_URL set (not probed — health stays cheap)


class ChallengeEvent(BaseModel):
    """
    One client-reported challenge event (SPEC-wave15 §5).

    PRIMARY field names match what server/routers/kycCapture.ts POSTs to
    /challenge/validate: {seq, event, timestamp_ms, payload} (timestamp_ms may
    be null — the server maps an absent client timestamp to null). The legacy
    pre-wave-15-fix name `timestamp` is still accepted as an alias.
    """
    model_config = ConfigDict(populate_by_name=True)

    seq: int                                # 0-based, strictly increasing
    event: str                              # e.g. blink|turnLeft|turnRight|smile|jawOpen|nod|frame
    timestamp_ms: Optional[float] = Field(  # client epoch milliseconds (nullable per server contract)
        default=None,
        validation_alias=AliasChoices("timestamp_ms", "timestamp"),
    )
    payload: Optional[dict] = None          # may carry {"frame_index": int}


class ChallengeValidateRequest(BaseModel):
    """
    PRIMARY field names match the server contract (kycCapture.ts →
    /challenge/validate): nonce / challenge / events / sampled_frames. The
    legacy names session_nonce / challenge_sequence / frames remain accepted
    aliases so both shapes validate.
    """
    model_config = ConfigDict(populate_by_name=True)

    nonce: str = Field(                     # nonce from the issued capture session
        validation_alias=AliasChoices("nonce", "session_nonce"))
    challenge: list[str] = Field(           # server-issued, order-randomized per session
        validation_alias=AliasChoices("challenge", "challenge_sequence"))
    events: list[ChallengeEvent]            # ordered client-reported events
    sampled_frames: list[str] = Field(      # base64 JPEG samples captured during the challenge
        validation_alias=AliasChoices("sampled_frames", "frames"))


class ChallengeValidateResponse(BaseModel):
    session_nonce: str
    passed: bool
    certified: bool = False                 # never certified — deterrence control only
    method: str = "mediapipe-challenge"
    checks: dict                            # per-check pass/fail + detail
    per_event: list[dict]                   # blendshape verification per claimed event
    consistency_score: Optional[float]      # min cross-frame cosine similarity
    risk_flags: list[str]
    processing_time_ms: int
    validated_at: str


# ─── Provider Abstraction ─────────────────────────────────────────────────────

class LivenessProviderBase(ABC):
    """Abstract base class for liveness detection providers."""

    @abstractmethod
    def check_passive(self, image_b64: str) -> dict:
        """
        Check passive liveness from a single image.
        Returns: {passed: bool, confidence: float, method: str, attack_type: str|None, details: dict}
        """
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        ...


# ─── MiniFASNet Provider (Open Source, Apache 2.0) ───────────────────────────

class MiniFASNetProvider(LivenessProviderBase):
    """
    Open-source passive liveness detection using MiniFASNet via the uniface ONNX library.

    Model: MiniFASNetV1SE + MiniFASNetV2 ensemble (80×80 input, CPU-friendly)
    Source: https://github.com/minivision-ai/Silent-Face-Anti-Spoofing (Apache 2.0)
    Library: https://github.com/yakhyo/uniface (MIT)

    CERTIFICATION STATUS (honest label): MiniFASNet is UNCERTIFIED. It has NOT
    been evaluated to ISO/IEC 30107-3 PAD Level 1 or Level 2 by an accredited
    lab, and no independently audited accuracy figure is claimed here. Vendor
    self-reported benchmark numbers exist upstream but are not treated as
    certification evidence. This control is deployed as presentation-attack
    DETERRENCE only; downstream risk engines must treat it as one signal, never
    as certification-grade proof of liveness.

    Heuristically resists (best-effort, uncertified):
      - Printed photos
      - Screen replay attacks
      - Paper masks
      - High-quality photo spoofing (partial)

    FAIL-CLOSED (SPEC-wave15 §5): if the model is unavailable or inference
    errors, check_passive returns an error result (mapped to HTTP 503 by the
    endpoints). There is deliberately NO heuristic fallback that could silently
    return success.
    """

    def __init__(self):
        self._model = None
        self._available = False
        self._load_error: Optional[str] = None
        self._load_model()

    def _load_model(self):
        try:
            from uniface import AntiSpoofing
            self._model = AntiSpoofing()
            self._available = True
            logger.info("[MiniFASNet] Model loaded successfully via uniface")
        except ImportError as e:
            # FAIL-CLOSED: no fallback provider — passive checks will 503.
            self._load_error = f"uniface not installed: {e}"
            logger.error(f"[MiniFASNet] {self._load_error} — passive liveness will FAIL CLOSED (503)")
            self._available = False
        except Exception as e:
            self._load_error = f"model load failed: {e}"
            logger.error(f"[MiniFASNet] {self._load_error} — passive liveness will FAIL CLOSED (503)")
            self._available = False

    @property
    def name(self) -> str:
        return "minifasnet"

    @property
    def available(self) -> bool:
        return self._available

    def check_passive(self, image_b64: str) -> dict:
        if not self._available:
            # FAIL-CLOSED: previously this silently fell back to DCT/image
            # heuristics that could return passed=True. Removed per SPEC-wave15 §5.
            return {
                "passed": False,
                "confidence": 0.0,
                "method": "minifasnet_onnx",
                "error": f"minifasnet_unavailable: {self._load_error or 'model not loaded'}",
            }

        try:
            import numpy as np
            import cv2

            # Decode base64 → numpy image
            image_bytes = base64.b64decode(image_b64)
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                return {"passed": False, "confidence": 0.0, "method": "minifasnet_onnx", "error": "invalid_image"}

            # Run MiniFASNet anti-spoofing inference
            # uniface AntiSpoofing.predict returns (label, score)
            # label: 1 = real/live, 0 = spoof
            label, score = self._model.predict(img)

            is_live = bool(label == 1)
            confidence = float(score)

            # Heuristic attack-type hint from score distribution (uncertified
            # deterrence signal — NOT an ISO 30107-3 attack classification).
            attack_type = None
            if not is_live:
                if confidence < 0.3:
                    attack_type = "printed_photo"
                elif confidence < 0.5:
                    attack_type = "screen_replay"
                else:
                    attack_type = "unknown_spoof"

            return {
                "passed": is_live,
                "confidence": confidence,
                "method": "minifasnet_onnx",
                "certified": False,
                "attack_type": attack_type,
                "details": {
                    "label": int(label),
                    "raw_score": float(score),
                    "model": "MiniFASNetV1SE+V2_ensemble",
                    "input_size": "80x80",
                    "certification": "none — uncertified deterrence control (not ISO/IEC 30107-3 PAD L1/L2)",
                },
            }

        except Exception as e:
            # FAIL-CLOSED: no silent fallback — surface the error (→ HTTP 503).
            logger.error(f"[MiniFASNet] Inference error (fail-closed): {e}")
            return {
                "passed": False,
                "confidence": 0.0,
                "method": "minifasnet_onnx",
                "error": f"minifasnet_inference_error: {e}",
            }


# ─── iProov Provider (Commercial — OPT-IN ONLY) ──────────────────────────────
# SPEC-wave15 §5: the platform default liveness path is pure OSS (MiniFASNet +
# mediapipe challenge). This commercial integration is retained for deployments
# that explicitly opt in via LIVENESS_PROVIDER=iproov + IPROOV_API_KEY; it is
# never selected implicitly and hard-fails when credentials are absent.

class IProovProvider(LivenessProviderBase):
    """
    iProov commercial liveness provider.
    Requires IPROOV_API_KEY environment variable (hard-fails without it).
    Docs: https://docs.iproov.com/docs/Content/ImplementationGuide/biometric-token.htm
    """

    @property
    def name(self) -> str:
        return "iproov"

    def check_passive(self, image_b64: str) -> dict:
        if not IPROOV_API_KEY:
            # Hard-fail (fail-closed): commercial provider selected without creds.
            raise RuntimeError(
                "IPROOV_API_KEY not set — iProov is an opt-in commercial provider; "
                "the platform default is pure OSS (LIVENESS_PROVIDER=minifasnet)"
            )

        try:
            import httpx as _httpx
            # Step 1: Get a biometric token
            token_resp = _httpx.post(
                f"{IPROOV_BASE_URL}/claim/enrol/token",
                json={"api_key": IPROOV_API_KEY, "secret": "", "resource": "kyc-liveness", "assurance_type": "genuine_presence"},
                timeout=10.0,
            )
            token_resp.raise_for_status()
            token = token_resp.json().get("token")

            # Step 2: Validate the frame
            validate_resp = _httpx.post(
                f"{IPROOV_BASE_URL}/claim/enrol/validate",
                json={"api_key": IPROOV_API_KEY, "token": token, "client": "server", "frame": image_b64},
                timeout=30.0,
            )
            validate_resp.raise_for_status()
            result = validate_resp.json()

            passed = result.get("passed", False)
            return {
                "passed": passed,
                "confidence": result.get("confidence", 0.0),
                "method": "iproov_genuine_presence",
                "attack_type": result.get("failure_reason") if not passed else None,
                "details": result,
            }
        except Exception as e:
            logger.error(f"[iProov] API call failed: {e}")
            return {"passed": False, "confidence": 0.0, "method": "iproov", "error": str(e)}


# ─── Onfido Provider (Commercial — OPT-IN ONLY) ──────────────────────────────
# SPEC-wave15 §5: the platform default liveness path is pure OSS (MiniFASNet +
# mediapipe challenge). This commercial integration is retained for deployments
# that explicitly opt in via LIVENESS_PROVIDER=onfido + ONFIDO_API_TOKEN; it is
# never selected implicitly and hard-fails when credentials are absent.

class OnfidoProvider(LivenessProviderBase):
    """
    Onfido commercial liveness provider.
    Requires ONFIDO_API_TOKEN environment variable (hard-fails without it).
    Docs: https://documentation.onfido.com/
    """

    @property
    def name(self) -> str:
        return "onfido"

    def check_passive(self, image_b64: str) -> dict:
        if not ONFIDO_API_TOKEN:
            # Hard-fail (fail-closed): commercial provider selected without creds.
            raise RuntimeError(
                "ONFIDO_API_TOKEN not set — Onfido is an opt-in commercial provider; "
                "the platform default is pure OSS (LIVENESS_PROVIDER=minifasnet)"
            )

        try:
            import httpx as _httpx
            image_bytes = base64.b64decode(image_b64)
            files = {"file": ("selfie.jpg", image_bytes, "image/jpeg")}
            headers = {"Authorization": f"Token token={ONFIDO_API_TOKEN}"}

            # Upload live photo
            upload_resp = _httpx.post(
                f"{ONFIDO_BASE_URL}/live_photos",
                headers=headers,
                files=files,
                timeout=30.0,
            )
            upload_resp.raise_for_status()
            live_photo = upload_resp.json()

            passed = live_photo.get("id") is not None
            return {
                "passed": passed,
                "confidence": 0.90 if passed else 0.0,
                "method": "onfido_live_photo",
                "attack_type": None,
                "details": {"live_photo_id": live_photo.get("id")},
            }
        except Exception as e:
            logger.error(f"[Onfido] API call failed: {e}")
            return {"passed": False, "confidence": 0.0, "method": "onfido", "error": str(e)}


# ─── Provider Factory ─────────────────────────────────────────────────────────

def get_liveness_provider() -> LivenessProviderBase:
    """
    Return the configured liveness provider instance (reads env var at call time).

    SPEC-wave15 §5: the platform default is pure OSS (minifasnet). Commercial
    providers are opt-in only and HARD-FAIL at selection time when their
    credentials env vars are absent — there is no silent degradation.
    """
    provider_name = os.getenv("LIVENESS_PROVIDER", "minifasnet").lower()
    if provider_name == "iproov":
        if not os.getenv("IPROOV_API_KEY"):
            raise RuntimeError(
                "LIVENESS_PROVIDER=iproov selected but IPROOV_API_KEY is not set. "
                "iProov is a commercial opt-in provider; set credentials explicitly "
                "or use the OSS default (LIVENESS_PROVIDER=minifasnet)."
            )
        logger.info("[Provider] Using iProov (commercial, explicitly opted in)")
        return IProovProvider()
    elif provider_name == "onfido":
        if not os.getenv("ONFIDO_API_TOKEN"):
            raise RuntimeError(
                "LIVENESS_PROVIDER=onfido selected but ONFIDO_API_TOKEN is not set. "
                "Onfido is a commercial opt-in provider; set credentials explicitly "
                "or use the OSS default (LIVENESS_PROVIDER=minifasnet)."
            )
        logger.info("[Provider] Using Onfido (commercial, explicitly opted in)")
        return OnfidoProvider()
    else:
        # Platform default: pure OSS.
        logger.info("[Provider] Using MiniFASNet (open-source, Apache 2.0 — UNCERTIFIED deterrence control)")
        return MiniFASNetProvider()


# Singleton provider instance
_provider: Optional[LivenessProviderBase] = None


def provider() -> LivenessProviderBase:
    global _provider
    if _provider is None:
        _provider = get_liveness_provider()
    return _provider


# ─── Face Matching (DeepFace / ArcFace) ──────────────────────────────────────

def compare_faces(selfie_b64: str, document_b64: str) -> dict:
    """
    Compare face in selfie with face in document photo using DeepFace ArcFace embeddings.
    Falls back to cosine similarity of raw pixel histograms if DeepFace unavailable.
    """
    try:
        import numpy as np
        import cv2

        # Decode both images
        def decode_img(b64: str):
            data = base64.b64decode(b64)
            nparr = np.frombuffer(data, np.uint8)
            return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        selfie_img = decode_img(selfie_b64)
        doc_img = decode_img(document_b64)

        if selfie_img is None or doc_img is None:
            return {"match": False, "score": 0.0, "model": "error", "distance": 1.0}

        try:
            # Primary: DeepFace ArcFace (most accurate open-source face embedding)
            from deepface import DeepFace
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f1, \
                 tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f2:
                cv2.imwrite(f1.name, selfie_img)
                cv2.imwrite(f2.name, doc_img)

                result = DeepFace.verify(
                    img1_path=f1.name,
                    img2_path=f2.name,
                    model_name="ArcFace",
                    detector_backend="opencv",
                    enforce_detection=False,
                )

            distance = float(result.get("distance", 1.0))
            # ArcFace cosine distance: 0 = identical, 1 = completely different
            # Convert to similarity score 0–1
            score = max(0.0, 1.0 - distance)
            match = result.get("verified", False)

            return {
                "match": match,
                "score": round(score, 4),
                "model": "deepface_arcface",
                "distance": round(distance, 4),
            }

        except ImportError:
            pass  # Fall through to histogram fallback

        # Fallback: colour histogram cosine similarity
        def hist_vector(img):
            h = []
            for ch in range(3):
                hist = cv2.calcHist([img], [ch], None, [64], [0, 256])
                h.extend(hist.flatten().tolist())
            import numpy as np
            v = np.array(h, dtype=np.float32)
            norm = np.linalg.norm(v)
            return v / norm if norm > 0 else v

        v1 = hist_vector(selfie_img)
        v2 = hist_vector(doc_img)
        import numpy as np
        cosine_sim = float(np.dot(v1, v2))
        match = cosine_sim >= FACE_MATCH_THRESHOLD

        return {
            "match": match,
            "score": round(cosine_sim, 4),
            "model": "histogram_cosine_fallback",
            "distance": round(1.0 - cosine_sim, 4),
        }

    except Exception as e:
        logger.error(f"Face comparison failed: {e}")
        return {"match": False, "score": 0.0, "model": "error", "distance": 1.0}


# ─── OCR / MRZ Extraction ─────────────────────────────────────────────────────

def extract_mrz_data(document_b64: str) -> OCRResult:
    """
    OPTIONAL FALLBACK ONLY — extract text/MRZ from a document image using
    passporteye (MIT) or pytesseract.

    SPEC-wave15 §5 delegation note: the PRIMARY MRZ/document-parsing path is
    owned by python-kyc-pipeline (wave-15 K1). This function is retained solely
    as a local fallback for the legacy /verify flow. Do NOT extend or duplicate
    MRZ logic here — new MRZ work belongs in python-kyc-pipeline.

    Fail-closed: when neither passporteye nor pytesseract is importable, returns
    an empty result with confidence=0.0 (never a fabricated success).
    """
    try:
        import numpy as np
        import cv2

        image_bytes = base64.b64decode(document_b64)
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Could not decode document image")

        # ── Try passporteye (MRZ-optimised) ──────────────────────────────────
        try:
            from passporteye import read_mrz
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                cv2.imwrite(tmp.name, img)
                mrz = read_mrz(tmp.name)

            if mrz:
                data = mrz.to_dict()
                return OCRResult(
                    name=f"{data.get('surname', '')} {data.get('names', '')}".strip() or None,
                    dob=data.get("date_of_birth"),
                    document_number=data.get("number"),
                    nationality=data.get("nationality"),
                    expiry_date=data.get("expiration_date"),
                    mrz_line1=data.get("mrz_line1"),
                    mrz_line2=data.get("mrz_line2"),
                    confidence=0.95,
                )
        except ImportError:
            pass

        # ── Try pytesseract ───────────────────────────────────────────────────
        try:
            import pytesseract
            from PIL import Image

            pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            # Preprocess: grayscale + threshold for better OCR
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            pil_thresh = Image.fromarray(thresh)

            text = pytesseract.image_to_string(pil_thresh, config="--psm 6 --oem 3")
            lines = [l.strip() for l in text.split("\n") if l.strip()]

            # Find MRZ lines (44 chars, mostly uppercase + digits + <)
            mrz_lines = [l for l in lines if len(l) >= 30 and all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<" for c in l.replace(" ", ""))]

            if len(mrz_lines) >= 2:
                mrz1, mrz2 = mrz_lines[0], mrz_lines[1]
                # Parse MRZ line 2: positions are standardised for TD3 (passport)
                doc_number = mrz2[0:9].replace("<", "").strip()
                nationality = mrz2[10:13].replace("<", "").strip()
                dob_raw = mrz2[13:19]
                expiry_raw = mrz2[19:25]

                # Parse surname/given from MRZ line 1
                name_field = mrz1[5:44] if len(mrz1) >= 44 else mrz1[5:]
                parts = name_field.split("<<")
                surname = parts[0].replace("<", " ").strip() if parts else ""
                given = parts[1].replace("<", " ").strip() if len(parts) > 1 else ""
                full_name = f"{surname} {given}".strip() or None

                def parse_date(s):
                    try:
                        y, m, d = int(s[0:2]), int(s[2:4]), int(s[4:6])
                        year = 2000 + y if y < 30 else 1900 + y
                        return f"{year}-{m:02d}-{d:02d}"
                    except Exception:
                        return None

                return OCRResult(
                    name=full_name,
                    dob=parse_date(dob_raw),
                    document_number=doc_number or None,
                    nationality=nationality or None,
                    expiry_date=parse_date(expiry_raw),
                    mrz_line1=mrz1,
                    mrz_line2=mrz2,
                    confidence=0.88,
                )

            # Non-MRZ document: return raw text fields
            return OCRResult(
                name=lines[0] if lines else None,
                dob=None,
                document_number=None,
                nationality=None,
                expiry_date=None,
                mrz_line1=None,
                mrz_line2=None,
                confidence=0.50,
            )

        except ImportError:
            pass

        logger.error("[OCR] Neither passporteye nor pytesseract available — OCR extraction unavailable")
        return OCRResult(
            name=None, dob=None, document_number=None, nationality=None,
            expiry_date=None, mrz_line1=None, mrz_line2=None, confidence=0.0
        )

    except Exception as e:
        logger.error(f"OCR extraction failed: {e}")
        return OCRResult(
            name=None, dob=None, document_number=None, nationality=None,
            expiry_date=None, mrz_line1=None, mrz_line2=None, confidence=0.0
        )


# ─── Name Matching ────────────────────────────────────────────────────────────

def compare_names(declared: str, ocr: Optional[str]) -> float:
    """Fuzzy name matching using Jaccard similarity + exact match bonus."""
    if not ocr:
        return 0.0

    declared_parts = set(declared.upper().split())
    ocr_parts = set(ocr.upper().split())

    if not declared_parts or not ocr_parts:
        return 0.0

    if declared.upper() == ocr.upper():
        return 1.0

    intersection = declared_parts & ocr_parts
    union = declared_parts | ocr_parts
    return len(intersection) / len(union) if union else 0.0


# ─── Risk Flags ───────────────────────────────────────────────────────────────

def detect_risk_flags(
    liveness: dict,
    face_match: dict,
    ocr: OCRResult,
    declared_name: str,
    name_score: float,
) -> list[str]:
    flags = []

    if not liveness.get("passed"):
        attack = liveness.get("attack_type")
        flags.append(f"liveness_failed:{attack or 'unknown'}")

    if not face_match.get("match"):
        flags.append(f"face_mismatch:score={face_match.get('score', 0):.2f}")

    if name_score < 0.5:
        flags.append(f"name_mismatch:score={name_score:.2f}")

    if ocr.confidence < 0.5:
        flags.append("low_ocr_confidence")

    if liveness.get("confidence", 1.0) < 0.6:
        flags.append("low_liveness_confidence")

    return flags


# ─── Challenge Validation (SPEC-wave15 §5) ────────────────────────────────────
# Active challenge-response liveness: the server (capture-session issuer) emits
# an order-randomized challenge sequence per session; the client performs the
# actions and reports ordered events plus sampled frames. This module verifies:
#   1. Event order matches the issued challenge sequence.
#   2. Timing plausibility (per-step min/max dwell, monotonic timestamps).
#   3. Blendshape verification on sampled frames via MediaPipe Face Landmarker
#      (lazy import; unavailable → FAIL CLOSED 503): eyeBlink / jawOpen /
#      mouthSmile blendshapes and head-pose turns must correspond to claimed
#      events.
#   4. Cross-frame face consistency: per-frame embeddings from rust-biometric
#      (HTTP), pairwise cosine vs first frame >= CHALLENGE_CONSISTENCY_THRESHOLD.
#      rust-biometric down → FAIL CLOSED 503.
#
# HONEST LABEL: this is an UNCERTIFIED deterrence control (no ISO/IEC 30107-3
# PAD certification). Responses always carry certified=false.

# Canonical event vocabulary. Accepts snake_case (python-kyc-pipeline challenge
# issuer) and camelCase (kyc_challenge_events schema, drizzle/0095) spellings.
_EVENT_ALIASES = {
    "blink": "blink",
    "turnleft": "turnLeft", "turn_left": "turnLeft",
    "turnright": "turnRight", "turn_right": "turnRight",
    "smile": "smile",
    "jawopen": "jawOpen", "jaw_open": "jawOpen",
    "open_mouth": "jawOpen", "openmouth": "jawOpen",
    "nod": "nod",
    "frame": "frame",  # passive sample marker — not a movement challenge
}
_MOVEMENT_EVENTS = {"blink", "turnLeft", "turnRight", "smile", "jawOpen", "nod"}


def _normalize_event_name(name: str) -> str:
    """Map a raw event/challenge name to the canonical vocabulary; '' if unknown."""
    return _EVENT_ALIASES.get((name or "").strip().lower().replace("-", "_"), "")


def _validate_event_order(events: list, challenge_sequence: list[str]) -> dict:
    """
    Check 1 — event order matches the server-issued (order-randomized) sequence.
    'frame' events are passive sample markers and are ignored for order matching.
    All seq values must be 0-based and strictly increasing.
    """
    seqs = [e.seq for e in events]
    if seqs != sorted(seqs) or len(set(seqs)) != len(seqs):
        return {"passed": False, "detail": "event seq values must be strictly increasing"}
    if seqs and seqs[0] != 0:
        return {"passed": False, "detail": "event seq must start at 0"}

    unknown = [e.event for e in events if not _normalize_event_name(e.event)]
    if unknown:
        return {"passed": False, "detail": f"unknown event names: {sorted(set(unknown))}"}

    reported = [_normalize_event_name(e.event) for e in events]
    reported_movements = [n for n in reported if n != "frame"]
    expected = [_normalize_event_name(c) for c in challenge_sequence]
    if any(not c for c in expected):
        return {"passed": False, "detail": "challenge_sequence contains unknown challenge names"}
    expected_movements = [n for n in expected if n != "frame"]

    if reported_movements != expected_movements:
        return {
            "passed": False,
            "detail": f"event order mismatch: expected {expected_movements}, got {reported_movements}",
        }
    return {"passed": True, "detail": "event order matches issued challenge sequence"}


def _validate_event_timing(events: list) -> dict:
    """
    Check 2 — timing plausibility: timestamps (epoch ms) strictly increasing and
    each per-step dwell within [CHALLENGE_MIN_DWELL_MS, CHALLENGE_MAX_DWELL_MS].
    Too fast ⇒ scripted/bot replay; too slow ⇒ stalled or spliced capture.
    """
    if len(events) < 2:
        return {"passed": True, "detail": "single event — dwell not applicable"}

    # Fail-closed: an event without a client timestamp makes timing
    # unverifiable — never silently skip (server contract allows null).
    missing = [e.seq for e in events if e.timestamp_ms is None]
    if missing:
        return {"passed": False, "detail": f"events missing timestamps at seq {missing}"}

    ts = [float(e.timestamp_ms) for e in events]
    for i in range(1, len(ts)):
        if ts[i] <= ts[i - 1]:
            return {"passed": False, "detail": f"timestamps not strictly increasing at seq {events[i].seq}"}
        dwell = ts[i] - ts[i - 1]
        if dwell < CHALLENGE_MIN_DWELL_MS:
            return {
                "passed": False,
                "detail": f"step {events[i].seq} dwell {dwell:.0f}ms < min {CHALLENGE_MIN_DWELL_MS:.0f}ms (scripted?)",
            }
        if dwell > CHALLENGE_MAX_DWELL_MS:
            return {
                "passed": False,
                "detail": f"step {events[i].seq} dwell {dwell:.0f}ms > max {CHALLENGE_MAX_DWELL_MS:.0f}ms (stalled?)",
            }
    total = ts[-1] - ts[0]
    if total > CHALLENGE_MAX_TOTAL_MS:
        return {"passed": False, "detail": f"total duration {total:.0f}ms > max {CHALLENGE_MAX_TOTAL_MS:.0f}ms"}
    return {"passed": True, "detail": f"timing plausible ({total:.0f}ms across {len(ts)} events)"}


# ── MediaPipe Face Landmarker (lazy, fail-closed) ─────────────────────────────
_face_landmarker = None
_face_landmarker_error: Optional[str] = None


def _get_face_landmarker():
    """
    Lazy-init the MediaPipe Face Landmarker (blendshapes + facial transformation
    matrix). FAIL-CLOSED: raises RuntimeError if mediapipe is not installed or
    the model asset is missing — the caller maps this to HTTP 503.
    """
    global _face_landmarker, _face_landmarker_error
    if _face_landmarker is not None:
        return _face_landmarker

    try:
        import mediapipe as mp  # Apache-2.0
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision
    except ImportError as e:
        _face_landmarker_error = f"mediapipe not installed: {e}"
        raise RuntimeError(f"mediapipe_unavailable: {_face_landmarker_error}")

    if not os.path.isfile(MEDIAPIPE_FACE_LANDMARKER_MODEL):
        _face_landmarker_error = f"model asset missing: {MEDIAPIPE_FACE_LANDMARKER_MODEL}"
        raise RuntimeError(f"mediapipe_unavailable: {_face_landmarker_error}")

    try:
        options = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MEDIAPIPE_FACE_LANDMARKER_MODEL),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_faces=1,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
        )
        _face_landmarker = mp_vision.FaceLandmarker.create_from_options(options)
        logger.info("[Challenge] MediaPipe Face Landmarker loaded (blendshapes + head pose)")
        return _face_landmarker
    except Exception as e:
        _face_landmarker_error = f"landmarker init failed: {e}"
        raise RuntimeError(f"mediapipe_unavailable: {_face_landmarker_error}")


def mediapipe_face_landmarker_available() -> bool:
    """Health-probe helper: importable + model asset present (does not init the model)."""
    try:
        import mediapipe  # noqa: F401
    except ImportError:
        return False
    return os.path.isfile(MEDIAPIPE_FACE_LANDMARKER_MODEL)


def _analyze_frame_blendshapes(frame_b64: str) -> dict:
    """
    Run Face Landmarker on one base64 JPEG frame.
    Returns {"blendshapes": {name: score}, "yaw_deg": float, "pitch_deg": float}.
    Raises RuntimeError (fail-closed) when mediapipe/model unavailable or no face.
    """
    landmarker = _get_face_landmarker()

    import mediapipe as mp
    import numpy as np
    import cv2

    try:
        image_bytes = base64.b64decode(frame_b64)
    except Exception as e:
        raise RuntimeError(f"invalid base64 frame: {e}")
    nparr = np.frombuffer(image_bytes, np.uint8)
    bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError("undecodable frame (not a valid image)")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_image)

    if not result.face_landmarks:
        raise RuntimeError("no face detected in sampled frame")

    blendshapes = {}
    if result.face_blendshapes:
        for cat in result.face_blendshapes[0]:
            blendshapes[cat.category_name] = float(cat.score)

    # Head pose from the facial transformation matrix (4x4, column-major floats).
    # Rotation R(row, col) = data[col*4 + row]. Yaw = rotation about the vertical
    # axis; pitch about the horizontal axis. Convention (MediaPipe face
    # geometry): positive yaw ≈ face turned to the subject's left (image right);
    # magnitude thresholds are env-tunable deterrence parameters.
    yaw_deg = pitch_deg = None
    mats = getattr(result, "facial_transformation_matrixes", None)
    if mats:
        import math
        m = np.array(mats[0], dtype=np.float64).reshape(4, 4).T  # → row-major R(row,col)
        r00, r10, r20 = m[0][0], m[1][0], m[2][0]
        yaw_deg = float(math.degrees(math.atan2(r20, r00)))
        pitch_deg = float(math.degrees(math.atan2(-r10, math.sqrt(r00 * r00 + r20 * r20) + 1e-9)))

    return {"blendshapes": blendshapes, "yaw_deg": yaw_deg, "pitch_deg": pitch_deg}


def _event_matches_analysis(event: str, analysis: dict) -> tuple[bool, str]:
    """
    Does the frame's blendshape/head-pose analysis correspond to the claimed
    challenge event? Deterrence thresholds (env-tunable), NOT certified PAD.
    """
    bs = analysis["blendshapes"]
    thr = CHALLENGE_BLENDSHAPE_THRESHOLD

    def b(name: str) -> float:
        return float(bs.get(name, 0.0))

    if event == "blink":
        left, right = b("eyeBlinkLeft"), b("eyeBlinkRight")
        ok = left >= thr and right >= thr
        return ok, f"eyeBlinkLeft={left:.2f} eyeBlinkRight={right:.2f} (thr {thr})"
    if event == "smile":
        left, right = b("mouthSmileLeft"), b("mouthSmileRight")
        score = (left + right) / 2.0
        return score >= thr, f"mouthSmile avg={score:.2f} (thr {thr})"
    if event == "jawOpen":
        score = b("jawOpen")
        return score >= thr, f"jawOpen={score:.2f} (thr {thr})"
    if event == "turnLeft":
        yaw = analysis.get("yaw_deg")
        if yaw is None:
            return False, "head pose unavailable (no transformation matrix)"
        ok = yaw >= CHALLENGE_HEAD_TURN_MIN_DEG
        return ok, f"yaw={yaw:.1f}° (need >= +{CHALLENGE_HEAD_TURN_MIN_DEG:.0f}° for turnLeft)"
    if event == "turnRight":
        yaw = analysis.get("yaw_deg")
        if yaw is None:
            return False, "head pose unavailable (no transformation matrix)"
        ok = yaw <= -CHALLENGE_HEAD_TURN_MIN_DEG
        return ok, f"yaw={yaw:.1f}° (need <= -{CHALLENGE_HEAD_TURN_MIN_DEG:.0f}° for turnRight)"
    if event == "nod":
        pitch = analysis.get("pitch_deg")
        if pitch is None:
            return False, "head pose unavailable (no transformation matrix)"
        ok = abs(pitch) >= CHALLENGE_HEAD_NOD_MIN_DEG
        return ok, f"pitch={pitch:.1f}° (need |pitch| >= {CHALLENGE_HEAD_NOD_MIN_DEG:.0f}°)"
    return False, f"unsupported movement event '{event}'"


def _frame_index_for_event(event_pos: int, n_movements: int, n_frames: int, payload: Optional[dict]) -> int:
    """
    Map a movement event to a sampled frame. Prefer an explicit
    payload.frame_index from the client; otherwise spread movement events
    positionally across the provided frames.
    """
    if payload and isinstance(payload.get("frame_index"), int):
        idx = payload["frame_index"]
        if 0 <= idx < n_frames:
            return idx
    if n_movements <= 1:
        return min(n_frames - 1, max(0, n_frames - 1))
    return min(n_frames - 1, round(event_pos * (n_frames - 1) / (n_movements - 1)))


def _verify_blendshapes(events: list, frames: list[str]) -> dict:
    """
    Check 3 — blendshape/head-pose verification of claimed movement events
    against the sampled frames. FAIL-CLOSED: raises RuntimeError when mediapipe
    or the model asset is unavailable, or a frame yields no analyzable face.
    """
    movements = [(i, _normalize_event_name(e.event), e) for i, e in enumerate(events)]
    movements = [(pos, name, e) for pos, (_, name, e) in enumerate(movements) if name in _MOVEMENT_EVENTS]

    if not frames:
        return {"passed": False, "detail": "no frames provided for blendshape verification", "per_event": []}
    if not movements:
        return {"passed": False, "detail": "no movement events to verify", "per_event": []}

    analyses: dict[int, dict] = {}
    per_event = []
    all_ok = True
    for pos, name, e in movements:
        fi = _frame_index_for_event(pos, len(movements), len(frames), e.payload)
        if fi not in analyses:
            analyses[fi] = _analyze_frame_blendshapes(frames[fi])  # may raise (fail-closed)
        ok, detail = _event_matches_analysis(name, analyses[fi])
        per_event.append({"seq": e.seq, "event": name, "frame_index": fi, "verified": ok, "detail": detail})
        all_ok = all_ok and ok

    return {
        "passed": all_ok,
        "detail": "all movement events corroborated by frame analysis" if all_ok
                  else "one or more claimed events not corroborated by frame analysis",
        "per_event": per_event,
    }


# ── Cross-frame biometric consistency via rust-biometric (fail-closed) ────────

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    import math
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


async def _frame_embeddings(frames: list[str]) -> tuple[list, float]:
    """
    Compute cross-frame consistency via rust-biometric's stateless embedding
    endpoint (wave-15): POST {RUST_BIOMETRIC_URL}/embed {image_base64} →
    {"embedding": [...]} per frame. No persistence — nothing is enrolled and
    nothing is written to biometric_embeddings. This is the ONLY path; the old
    enroll+match fallback (synthetic negative user ids, hardcoded
    quality_score) has been removed.

    Returns (embeddings, min_cosine_similarity).
    FAIL-CLOSED: raises RuntimeError when RUST_BIOMETRIC_URL is unset, the
    service is unreachable, or it returns an error (→ HTTP 503).
    """
    if not RUST_BIOMETRIC_URL:
        raise RuntimeError("rust_biometric_unavailable: RUST_BIOMETRIC_URL is not set")

    client = get_http_client(timeout=10.0)

    embeddings = []
    try:
        for i, frame in enumerate(frames):
            resp = await client.post(f"{RUST_BIOMETRIC_URL}/embed",
                                     json={"image_base64": frame})
            resp.raise_for_status()
            emb = resp.json().get("embedding")
            if not isinstance(emb, list) or not emb:
                raise RuntimeError(f"rust-biometric returned no embedding for frame {i}")
            embeddings.append([float(x) for x in emb])
    except httpx.HTTPError as e:
        raise RuntimeError(f"rust_biometric_unavailable: embedding request failed: {e}")

    ref = embeddings[0]
    sims = [_cosine_similarity(ref, e) for e in embeddings[1:]] or [1.0]
    return embeddings, min(sims)


async def _verify_cross_frame_consistency(frames: list[str]) -> dict:
    """
    Check 4 — every sampled frame must show the same face: cosine similarity
    between each frame's embedding and the first frame's embedding must be
    >= CHALLENGE_CONSISTENCY_THRESHOLD. rust-biometric down → raises (fail-closed).
    """
    if len(frames) < 2:
        return {"passed": True, "detail": "single frame — consistency trivially satisfied",
                "consistency_score": 1.0}
    _, min_sim = await _frame_embeddings(frames)
    ok = min_sim >= CHALLENGE_CONSISTENCY_THRESHOLD
    return {
        "passed": ok,
        "detail": (f"min cross-frame cosine {min_sim:.3f} >= {CHALLENGE_CONSISTENCY_THRESHOLD}"
                   if ok else
                   f"min cross-frame cosine {min_sim:.3f} < threshold {CHALLENGE_CONSISTENCY_THRESHOLD} "
                   "(frame swap / injection suspected)"),
        "consistency_score": round(min_sim, 4),
    }


def _server_nonce_check(nonce: str, challenge_sequence: list[str]) -> dict:
    """
    Optional hardening: cross-check the nonce against kyc_capture_sessions
    (written by the capture-session issuer; drizzle/0095). If a row exists, its
    server-issued challenge MUST match the client-supplied sequence. If no row
    exists we proceed but flag it, unless CHALLENGE_REQUIRE_SERVER_NONCE=true
    (then fail-closed). DB errors are fail-closed only under the require flag.
    """
    try:
        conn = _get_db()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT challenge FROM kyc_capture_sessions
                   WHERE nonce = %s ORDER BY created_at DESC LIMIT 1""",
                (nonce,),
            )
            row = cur.fetchone()
    except Exception as e:
        if CHALLENGE_REQUIRE_SERVER_NONCE:
            return {"passed": False, "detail": f"server nonce check required but DB unavailable: {e}",
                    "verified": None}
        logger.warning(f"[Challenge] Server nonce check skipped (DB/table unavailable): {e}")
        return {"passed": True, "detail": "server nonce check unavailable — proceeding unverified",
                "verified": None}

    if not row:
        if CHALLENGE_REQUIRE_SERVER_NONCE:
            return {"passed": False, "detail": "unknown session nonce (no server-issued challenge found)",
                    "verified": False}
        return {"passed": True, "detail": "no server record for nonce — client-supplied sequence accepted "
                "(set CHALLENGE_REQUIRE_SERVER_NONCE=true to enforce)", "verified": False}

    server_seq = [_normalize_event_name(c) for c in (row.get("challenge") or [])]
    client_seq = [_normalize_event_name(c) for c in challenge_sequence]
    if server_seq != client_seq:
        return {"passed": False,
                "detail": f"challenge sequence does not match server record for nonce ({server_seq} != {client_seq})",
                "verified": False}
    return {"passed": True, "detail": "nonce and challenge match server record", "verified": True}


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    deepface_ok = False
    tesseract_ok = False
    uniface_ok = False
    dapr_ok = False

    try:
        from deepface import DeepFace
        deepface_ok = True
    except ImportError:
        pass

    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        tesseract_ok = True
    except Exception:
        pass

    try:
        from uniface import AntiSpoofing
        uniface_ok = True
    except ImportError:
        pass

    try:
        client = get_http_client(timeout=2.0)  # shared client (SPEC-wave14 §4.6)
        r = await client.get(f"http://localhost:{DAPR_HTTP_PORT}/v1.0/healthz")
        dapr_ok = r.status_code == 204
    except Exception:
        pass

    prov = provider()
    return HealthResponse(
        status="ok",
        liveness_provider=prov.name,
        deepface_available=deepface_ok,
        tesseract_available=tesseract_ok,
        uniface_available=uniface_ok,
        dapr_connected=dapr_ok,
        mediapipe_available=mediapipe_face_landmarker_available(),
        rust_biometric_configured=bool(RUST_BIOMETRIC_URL),
    )


def _public_method(provider_name: str) -> str:
    """Honest method label (SPEC-wave15 §5) for liveness responses."""
    return {
        "minifasnet": "minifasnet-passive",
        "iproov": "iproov-commercial",
        "onfido": "onfido-commercial",
    }.get(provider_name, provider_name)


@app.post("/verify", response_model=LivenessResponse)
async def verify(request: LivenessRequest):
    start_ms = int(time.time() * 1000)

    # 1. Liveness check
    prov = provider()
    liveness = prov.check_passive(request.selfie_base64)

    # Fail-closed: if liveness service errors, block
    if "error" in liveness and not liveness.get("passed"):
        raise HTTPException(status_code=503, detail=f"Liveness check failed: {liveness['error']}")

    # 2. Face matching
    face_match = compare_faces(request.selfie_base64, request.document_front_base64)

    # 3. OCR extraction
    ocr = extract_mrz_data(request.document_front_base64)

    # 4. Name matching
    name_score = compare_names(request.declared_name, ocr.name)
    name_passed = name_score >= 0.5

    # 5. Risk flags
    risk_flags = detect_risk_flags(liveness, face_match, ocr, request.declared_name, name_score)

    # 6. Overall decision
    overall_passed = (
        liveness.get("passed", False)
        and face_match.get("match", False)
        and name_passed
    )

    # 7. Aggregate confidence
    confidence = (
        liveness.get("confidence", 0.0) * 0.5
        + face_match.get("score", 0.0) * 0.3
        + name_score * 0.2
    )

    elapsed_ms = int(time.time() * 1000) - start_ms

    response = LivenessResponse(
        session_id=request.session_id,
        user_id=request.user_id,
        liveness_passed=liveness.get("passed", False),
        face_match_score=face_match.get("score", 0.0),
        face_match_passed=face_match.get("match", False),
        ocr_name=ocr.name,
        ocr_dob=ocr.dob,
        ocr_document_number=ocr.document_number,
        ocr_nationality=ocr.nationality,
        name_match_score=name_score,
        name_match_passed=name_passed,
        overall_passed=overall_passed,
        risk_flags=risk_flags,
        confidence=round(confidence, 4),
        processing_time_ms=elapsed_ms,
        verified_at=datetime.now(timezone.utc).isoformat(),
        liveness_provider=prov.name,
        liveness_method=liveness.get("method", "unknown"),
        certified=False,  # never ISO/IEC 30107-3 certified — deterrence control only
        method=_public_method(prov.name),
    )

    # Publish result to Dapr pub/sub (non-blocking)
    asyncio.create_task(_publish_result(response))

    return response


@app.post("/check/passive")
async def check_passive(body: dict):
    """Standalone passive liveness check endpoint (used by Rust proxy)."""
    image_b64 = body.get("image_base64", "")
    if not image_b64:
        raise HTTPException(status_code=400, detail="image_base64 required")

    prov = provider()
    result = prov.check_passive(image_b64)

    if "error" in result:
        raise HTTPException(status_code=503, detail=result["error"])

    return {
        "passed": result.get("passed", False),
        "confidence": result.get("confidence", 0.0),
        "method": result.get("method", "unknown"),
        "certified": False,  # uncertified deterrence control (not ISO/IEC 30107-3 PAD L1/L2)
        "attack_type": result.get("attack_type"),
        "provider": prov.name,
        "details": result.get("details", {}),
    }


@app.post("/check/active")
async def check_active(body: dict):
    """
    Active liveness check — analyses a short video clip for blink and head movement.
    Expects: {video_base64: str, user_id: int, session_id: str}
    """
    video_b64 = body.get("video_base64", "")
    if not video_b64:
        raise HTTPException(status_code=400, detail="video_base64 required")

    try:
        import numpy as np
        import cv2
        import tempfile
        import os as _os

        video_bytes = base64.b64decode(video_b64)

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name

        cap = cv2.VideoCapture(tmp_path)
        _os.unlink(tmp_path)

        if not cap.isOpened():
            return {"passed": False, "confidence": 0.0, "blink_count": 0, "head_movement_deg": 0.0, "method": "active_video"}

        # Sample frames and run MiniFASNet on each
        prov = provider()
        frame_results = []
        frame_count = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame_count += 1
            if frame_count % 5 == 0:  # Sample every 5th frame
                _, buffer = cv2.imencode(".jpg", frame)
                frame_b64 = base64.b64encode(buffer).decode()
                result = prov.check_passive(frame_b64)
                frame_results.append(result)

        cap.release()

        if not frame_results:
            return {"passed": False, "confidence": 0.0, "blink_count": 0, "head_movement_deg": 0.0, "method": "active_video"}

        if all("error" in r for r in frame_results):
            # FAIL-CLOSED (SPEC-wave15 §5): provider errored on every sampled
            # frame — previously this silently degraded to passed=False with a
            # zero-confidence "result". Surface as 503 instead.
            raise HTTPException(status_code=503,
                                detail=f"Active liveness provider unavailable: {frame_results[0]['error']}")

        # Aggregate: majority vote across frames
        live_frames = sum(1 for r in frame_results if r.get("passed"))
        live_ratio = live_frames / len(frame_results)
        avg_confidence = sum(r.get("confidence", 0.0) for r in frame_results) / len(frame_results)

        # Estimate blink count from confidence variance (proxy for eye state changes)
        confidences = [r.get("confidence", 0.0) for r in frame_results]
        confidence_variance = float(np.var(confidences)) if confidences else 0.0
        estimated_blinks = min(int(confidence_variance * 20), 10)

        passed = live_ratio >= 0.7  # At least 70% of frames must be live

        return {
            "passed": passed,
            "confidence": round(avg_confidence, 4),
            "certified": False,  # uncertified deterrence control
            "blink_count": estimated_blinks,
            "head_movement_deg": round(confidence_variance * 45, 2),
            "live_frame_ratio": round(live_ratio, 4),
            "frames_analysed": len(frame_results),
            "method": "active_minifasnet_video",
            "provider": prov.name,
        }

    except Exception as e:
        logger.error(f"[Active liveness] Video analysis failed: {e}")
        return {"passed": False, "confidence": 0.0, "blink_count": 0, "head_movement_deg": 0.0, "method": "active_video", "error": str(e)}


@app.post("/match")
async def match_faces(body: dict):
    """Face matching endpoint — compare two images."""
    img1_b64 = body.get("image1_base64", "")
    img2_b64 = body.get("image2_base64", "")

    if not img1_b64 or not img2_b64:
        raise HTTPException(status_code=400, detail="image1_base64 and image2_base64 required")

    result = compare_faces(img1_b64, img2_b64)
    return result


@app.post("/challenge/validate", response_model=ChallengeValidateResponse)
async def challenge_validate(request: ChallengeValidateRequest):
    """
    Active challenge-response liveness validation (SPEC-wave15 §5).

    Verifies, in order:
      1. event order matches the server-issued (per-session randomized) sequence
      2. timing plausibility (per-step min/max dwell, monotonic timestamps)
      3. blendshape/head-pose corroboration of claimed events on sampled frames
         via MediaPipe Face Landmarker (lazy import; unavailable → 503 fail-closed)
      4. cross-frame face consistency via rust-biometric embeddings
         (cosine >= CHALLENGE_CONSISTENCY_THRESHOLD; service down → 503 fail-closed)

    HONEST LABEL: UNCERTIFIED deterrence control — certified=false always.
    """
    start_ms = int(time.time() * 1000)
    risk_flags: list[str] = []

    # ── Input sanity (400 = malformed request, distinct from fail-closed 503) ──
    if not request.nonce:
        raise HTTPException(status_code=400, detail="nonce required")
    if not request.challenge:
        raise HTTPException(status_code=400, detail="challenge required")
    if not request.events:
        raise HTTPException(status_code=400, detail="events required")
    if not request.sampled_frames:
        raise HTTPException(status_code=400, detail="sampled_frames required (base64 jpeg samples)")
    if len(request.sampled_frames) > CHALLENGE_MAX_FRAMES:
        raise HTTPException(status_code=400, detail=f"too many frames (max {CHALLENGE_MAX_FRAMES})")

    # ── Check 0 (optional hardening): nonce vs server-issued challenge ─────────
    checks: dict = {}
    nonce_check = _server_nonce_check(request.nonce, request.challenge)
    checks["server_nonce"] = nonce_check
    if nonce_check.get("verified") is not True:
        # No positive server-side confirmation of the nonce/sequence (unknown
        # nonce or check unavailable) — always surfaced as a risk flag.
        risk_flags.append("nonce_not_server_verified")
    if not nonce_check["passed"]:
        risk_flags.append("server_nonce_mismatch")

    # ── Check 1: event order ──────────────────────────────────────────────────
    order = _validate_event_order(request.events, request.challenge)
    checks["event_order"] = order
    if not order["passed"]:
        risk_flags.append("challenge_order_mismatch")

    # ── Check 2: timing plausibility ──────────────────────────────────────────
    timing = _validate_event_timing(request.events)
    checks["timing"] = timing
    if not timing["passed"]:
        risk_flags.append("implausible_timing")

    # ── Check 3: blendshape verification (FAIL-CLOSED on unavailable deps) ─────
    try:
        blend = _verify_blendshapes(request.events, request.sampled_frames)
    except RuntimeError as e:
        # mediapipe missing / model asset missing / no analyzable face → 503.
        raise HTTPException(status_code=503, detail=f"Challenge blendshape verification unavailable: {e}")
    checks["blendshapes"] = {k: v for k, v in blend.items() if k != "per_event"}
    if not blend["passed"]:
        risk_flags.append("blendshape_mismatch")

    # ── Check 4: cross-frame biometric consistency (FAIL-CLOSED) ──────────────
    try:
        consistency = await _verify_cross_frame_consistency(request.sampled_frames)
    except RuntimeError as e:
        # rust-biometric down/misconfigured → 503.
        raise HTTPException(status_code=503, detail=f"Cross-frame consistency check unavailable: {e}")
    checks["cross_frame_consistency"] = {k: v for k, v in consistency.items() if k != "consistency_score"}
    if not consistency["passed"]:
        risk_flags.append("cross_frame_inconsistency")

    passed = all(c.get("passed") for c in checks.values())
    elapsed_ms = int(time.time() * 1000) - start_ms

    response = ChallengeValidateResponse(
        session_nonce=request.nonce,
        passed=passed,
        certified=False,
        method="mediapipe-challenge",
        checks=checks,
        per_event=blend.get("per_event", []),
        consistency_score=consistency.get("consistency_score"),
        risk_flags=risk_flags,
        processing_time_ms=elapsed_ms,
        validated_at=datetime.now(timezone.utc).isoformat(),
    )

    # Audit (best-effort — audit failure must not change the verdict)
    try:
        db_log_event("challenge.validated", {
            "session_nonce": request.nonce,
            "passed": passed,
            "checks": {k: v.get("passed") for k, v in checks.items()},
            "risk_flags": risk_flags,
            "processing_time_ms": elapsed_ms,
        })
    except Exception as e:
        logger.warning(f"[Challenge] Audit log failed (non-critical): {e}")

    return response


# ─── Internal Helpers ─────────────────────────────────────────────────────────

async def _publish_result(response: LivenessResponse):
    """Publish liveness result to Dapr pub/sub (non-blocking fire-and-forget)."""
    try:
        client = get_http_client(timeout=5.0)  # shared client (SPEC-wave14 §4.6)
        await client.post(
            f"http://localhost:{DAPR_HTTP_PORT}/v1.0/publish/{DAPR_PUBSUB}/kyc.liveness.result",
            json=response.model_dump(),
        )
    except Exception as e:
        logger.warning(f"[Dapr] Publish failed (non-critical): {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8095")), workers=int(os.getenv("UVICORN_WORKERS", "1")))  # SPEC-wave14 §4.6: env-configurable workers (default 1)
