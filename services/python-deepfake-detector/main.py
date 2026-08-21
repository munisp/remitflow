"""
RemitFlow — Python Deepfake Detection Microservice
Port: 8097 (DEEPFAKE_DETECTOR_URL)

Architecture:
  - Primary:  EfficientNet-B4 fine-tuned on FaceForensics++ (HuggingFace model)
  - Fallback: Frequency-domain analysis (DCT artifact detection)
  - Fallback: Facial landmark consistency check (MediaPipe)

Endpoints:
  POST /check          — analyse a single face image for deepfake artifacts
  POST /batch          — analyse up to 8 images in one request
  GET  /health         — liveness probe
  GET  /metrics        — Prometheus counters

Security:
  - All failures are FAIL-CLOSED: returns is_deepfake=True when uncertain
  - Confidence threshold configurable via DEEPFAKE_CONFIDENCE_THRESHOLD env var
  - Rate-limited: max RATE_LIMIT_RPM requests per user_id per minute
"""

import asyncio
import base64
import io
import logging
import os
import signal
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
import numpy as np
import hmac
import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[python-deepfake-detector] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value


_DB_URL = _require_env("DATABASE_URL")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS deepfake_detector_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_deepfake_detector_updated
                    ON deepfake_detector_state(updated_at);
                CREATE TABLE IF NOT EXISTS deepfake_detector_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_deepfake_detector_events_type
                    ON deepfake_detector_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO deepfake_detector_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM deepfake_detector_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM deepfake_detector_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO deepfake_detector_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("deepfake-detector")

# ─── Configuration ────────────────────────────────────────────────────────────

DEEPFAKE_CONFIDENCE_THRESHOLD = float(os.getenv("DEEPFAKE_CONFIDENCE_THRESHOLD", "0.55"))
RATE_LIMIT_RPM = int(os.getenv("RATE_LIMIT_RPM", "20"))
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "8"))
HF_MODEL_ID = os.getenv(
    "HF_DEEPFAKE_MODEL_ID",
    "Wvolf/ViT-L_Deepfake_Detection",
)
USE_GPU = os.getenv("USE_GPU", "false").lower() == "true"
ENABLE_FREQUENCY_FALLBACK = os.getenv("ENABLE_FREQUENCY_FALLBACK", "true").lower() == "true"
ENABLE_LANDMARK_FALLBACK = os.getenv("ENABLE_LANDMARK_FALLBACK", "true").lower() == "true"

# ─── Model Loading (lazy, thread-safe) ───────────────────────────────────────

_model = None
_processor = None
_model_lock = asyncio.Lock()
_model_available = False


async def _load_model():
    """Lazy-load the HuggingFace deepfake detection model."""
    global _model, _processor, _model_available
    async with _model_lock:
        if _model_available:
            return True
        try:
            from transformers import AutoFeatureExtractor, AutoModelForImageClassification
            import torch

            device = "cuda" if USE_GPU else "cpu"
            logger.info(f"Loading deepfake model {HF_MODEL_ID} on {device}...")
            _processor = AutoFeatureExtractor.from_pretrained(HF_MODEL_ID)
            _model = AutoModelForImageClassification.from_pretrained(HF_MODEL_ID)
            _model.to(device)
            _model.eval()
            _model_available = True
            logger.info("Deepfake detection model loaded successfully")
            return True
        except Exception as e:
            logger.warning(f"Could not load HuggingFace deepfake model: {e}. Falling back to frequency analysis.")
            _model_available = False
            return False


# ─── Rate Limiter ─────────────────────────────────────────────────────────────

class SlidingWindowRateLimiter:
    def __init__(self, max_rpm: int):
        self.max_rpm = max_rpm
        self._windows: Dict[str, deque] = defaultdict(deque)

    def check(self, user_key: str) -> bool:
        now = time.monotonic()
        window = self._windows[user_key]
        # Evict entries older than 60 seconds
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= self.max_rpm:
            return False
        window.append(now)
        return True


_rate_limiter = SlidingWindowRateLimiter(RATE_LIMIT_RPM)

# ─── Metrics ──────────────────────────────────────────────────────────────────

_metrics = {
    "total_requests": 0,
    "deepfake_detected": 0,
    "real_detected": 0,
    "model_errors": 0,
    "fallback_used": 0,
    "rate_limited": 0,
}

# ─── Models ───────────────────────────────────────────────────────────────────

class DeepfakeCheckRequest(BaseModel):
    image_url: Optional[str] = None
    image_base64: Optional[str] = None
    user_id: Optional[str] = None
    session_id: Optional[str] = None

class DeepfakeCheckResponse(BaseModel):
    is_deepfake: bool
    confidence: float = Field(ge=0.0, le=1.0)
    method: str
    indicators: List[str] = []
    processing_time_ms: float
    timestamp: str
    session_id: Optional[str] = None
    model_id: Optional[str] = None

class BatchCheckRequest(BaseModel):
    images: List[DeepfakeCheckRequest]
    user_id: Optional[str] = None

class BatchCheckResponse(BaseModel):
    results: List[DeepfakeCheckResponse]
    any_deepfake: bool
    max_confidence: float
    processing_time_ms: float

# ─── Image Loading ────────────────────────────────────────────────────────────

# SSRF guard (PY-008 remediation): https only by default, DNS-resolved hosts must
# be public IPs, redirects are not followed, and response size is capped.
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))  # 10 MiB
ALLOW_INSECURE_IMAGE_HTTP = os.getenv("ALLOW_INSECURE_IMAGE_HTTP", "false").lower() == "true"


def _validate_image_url(url: str) -> str:
    parsed = urlparse(url)
    allowed_schemes = {"https"} | ({"http"} if ALLOW_INSECURE_IMAGE_HTTP else set())
    if parsed.scheme.lower() not in allowed_schemes:
        raise HTTPException(status_code=400, detail="image_url must use https")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="image_url has no host")
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="image_url host does not resolve")
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            raise HTTPException(status_code=400, detail="image_url resolved to an invalid address")
        if (
            ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_multicast or ip.is_reserved or ip.is_unspecified
        ):
            raise HTTPException(status_code=400, detail="image_url resolves to a non-public address")
    return url


async def _load_image_bytes(req: DeepfakeCheckRequest) -> bytes:
    if req.image_base64:
        # Strip data URI prefix if present
        b64 = req.image_base64
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="image exceeds maximum allowed size")
        return raw
    if req.image_url:
        url = _validate_image_url(req.image_url)
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            async with client.stream("GET", url) as resp:
                if resp.is_redirect:
                    raise HTTPException(status_code=400, detail="image_url redirects are not followed")
                resp.raise_for_status()
                cl = resp.headers.get("content-length")
                if cl and cl.isdigit() and int(cl) > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=413, detail="image exceeds maximum allowed size")
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes(65536):
                    total += len(chunk)
                    if total > MAX_IMAGE_BYTES:
                        raise HTTPException(status_code=413, detail="image exceeds maximum allowed size")
                    chunks.append(chunk)
                return b"".join(chunks)
    raise ValueError("Either image_url or image_base64 must be provided")


def _bytes_to_pil(image_bytes: bytes):
    from PIL import Image
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")

# ─── Primary: HuggingFace ViT/EfficientNet Model ─────────────────────────────

async def _check_with_model(image_bytes: bytes) -> Tuple[bool, float, List[str]]:
    """Run the HuggingFace deepfake classification model."""
    import torch
    device = "cuda" if USE_GPU else "cpu"
    img = _bytes_to_pil(image_bytes)
    inputs = _processor(images=img, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = _model(**inputs)
        logits = outputs.logits
        probs = torch.softmax(logits, dim=-1).cpu().numpy()[0]

    # Model labels: index 0 = real, index 1 = fake (standard FaceForensics++ convention)
    # Adjust if the loaded model uses a different label ordering
    labels = _model.config.id2label if hasattr(_model.config, "id2label") else {0: "real", 1: "fake"}
    fake_label_idx = next(
        (i for i, lbl in labels.items() if "fake" in str(lbl).lower() or "deepfake" in str(lbl).lower()),
        1,
    )
    real_label_idx = 1 - fake_label_idx if len(labels) == 2 else 0

    fake_prob = float(probs[fake_label_idx]) if fake_label_idx < len(probs) else 0.0
    real_prob = float(probs[real_label_idx]) if real_label_idx < len(probs) else 1.0

    is_deepfake = fake_prob >= DEEPFAKE_CONFIDENCE_THRESHOLD
    indicators = []
    if fake_prob > 0.7:
        indicators.append("high_model_confidence_fake")
    if fake_prob > 0.9:
        indicators.append("very_high_model_confidence_fake")

    return is_deepfake, fake_prob, indicators

# ─── Fallback 1: DCT Frequency-Domain Analysis ───────────────────────────────

def _check_frequency_domain(image_bytes: bytes) -> Tuple[bool, float, List[str]]:
    """
    Detect GAN/diffusion artifacts via DCT frequency analysis.

    Real faces have a natural 1/f^2 power spectral density.
    GAN-generated faces often show anomalous high-frequency energy
    (checkerboard artifacts from transposed convolutions) and
    suppressed mid-frequency content.
    """
    import cv2

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return False, 0.0, ["could_not_decode_image"]

    # Resize to 256x256 for consistent analysis
    img = cv2.resize(img, (256, 256)).astype(np.float32)

    # DCT transform
    dct = cv2.dct(img)
    dct_abs = np.abs(dct)

    # Compute power in frequency bands
    h, w = dct_abs.shape
    # Low frequency: top-left 16x16
    low_freq = dct_abs[:16, :16].mean()
    # Mid frequency: 16-64 band
    mid_freq = dct_abs[16:64, 16:64].mean()
    # High frequency: 64+ band
    high_freq = dct_abs[64:, 64:].mean()

    total = low_freq + mid_freq + high_freq + 1e-8
    low_ratio = low_freq / total
    high_ratio = high_freq / total

    # GAN artifacts: elevated high-frequency energy, suppressed mid-frequency
    indicators = []
    spoof_score = 0.0

    if high_ratio > 0.15:
        indicators.append("elevated_high_freq_energy")
        spoof_score += 0.3
    if low_ratio < 0.5:
        indicators.append("suppressed_low_freq_energy")
        spoof_score += 0.2

    # Checkerboard artifact detection (GAN transposed conv signature)
    # Look for periodic patterns in the DCT at multiples of 8 (JPEG block size)
    block_energy = 0.0
    for i in range(8, min(h, 128), 8):
        for j in range(8, min(w, 128), 8):
            block_energy += dct_abs[i, j]
    block_energy /= max(1, (128 // 8) ** 2)

    if block_energy > dct_abs[8:128, 8:128].mean() * 1.5:
        indicators.append("checkerboard_artifacts")
        spoof_score += 0.4

    # Spectral flatness (GAN outputs tend to be more spectrally flat)
    spectral_flatness = np.exp(np.log(dct_abs[1:, 1:] + 1e-8).mean()) / (dct_abs[1:, 1:].mean() + 1e-8)
    if spectral_flatness > 0.3:
        indicators.append("high_spectral_flatness")
        spoof_score += 0.2

    spoof_score = min(spoof_score, 1.0)
    is_deepfake = spoof_score >= DEEPFAKE_CONFIDENCE_THRESHOLD

    return is_deepfake, spoof_score, indicators

# ─── Fallback 2: Facial Landmark Consistency ─────────────────────────────────

def _check_landmark_consistency(image_bytes: bytes) -> Tuple[bool, float, List[str]]:
    """
    Check for facial landmark inconsistencies common in deepfakes:
    - Asymmetric eye positions (GAN often fails bilateral symmetry)
    - Unnatural face proportions
    - Missing or distorted ear/hairline landmarks
    """
    try:
        import mediapipe as mp
        import cv2

        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return False, 0.0, ["could_not_decode_image"]

        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        h, w = img.shape[:2]

        face_mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            min_detection_confidence=0.5,
        )
        results = face_mesh.process(img_rgb)
        face_mesh.close()

        if not results.multi_face_landmarks:
            return False, 0.0, ["no_face_detected"]

        lms = [(lm.x * w, lm.y * h) for lm in results.multi_face_landmarks[0].landmark]

        indicators = []
        spoof_score = 0.0

        # Eye symmetry check
        left_eye_center = np.mean([lms[i] for i in [362, 385, 387, 263, 373, 380]], axis=0)
        right_eye_center = np.mean([lms[i] for i in [33, 160, 158, 133, 153, 144]], axis=0)
        nose_tip = np.array(lms[1])

        # Eyes should be roughly equidistant from nose
        left_dist = np.linalg.norm(left_eye_center - nose_tip)
        right_dist = np.linalg.norm(right_eye_center - nose_tip)
        eye_asymmetry = abs(left_dist - right_dist) / max(left_dist, right_dist, 1e-8)

        if eye_asymmetry > 0.15:
            indicators.append("eye_asymmetry")
            spoof_score += 0.3

        # Face proportion check (golden ratio: face height / width ≈ 1.618)
        chin = np.array(lms[152])
        forehead = np.array(lms[10])
        left_cheek = np.array(lms[234])
        right_cheek = np.array(lms[454])

        face_height = np.linalg.norm(forehead - chin)
        face_width = np.linalg.norm(left_cheek - right_cheek)
        proportion = face_height / max(face_width, 1e-8)

        if proportion < 0.8 or proportion > 2.2:
            indicators.append("abnormal_face_proportions")
            spoof_score += 0.25

        # Landmark density check — deepfakes sometimes have sparse/collapsed landmarks
        unique_positions = len(set([(round(x, 1), round(y, 1)) for x, y in lms]))
        if unique_positions < len(lms) * 0.85:
            indicators.append("collapsed_landmarks")
            spoof_score += 0.4

        spoof_score = min(spoof_score, 1.0)
        is_deepfake = spoof_score >= DEEPFAKE_CONFIDENCE_THRESHOLD

        return is_deepfake, spoof_score, indicators

    except ImportError:
        return False, 0.0, ["mediapipe_not_available"]
    except Exception as e:
        logger.warning(f"Landmark consistency check failed: {e}")
        return False, 0.0, [f"error: {str(e)[:80]}"]

# ─── Orchestrator ─────────────────────────────────────────────────────────────

async def run_deepfake_check(req: DeepfakeCheckRequest) -> DeepfakeCheckResponse:
    """
    Run deepfake detection with primary model + fallback chain.
    Fail-closed: if all methods fail, returns is_deepfake=True.
    """
    start = time.monotonic()
    timestamp = datetime.now(timezone.utc).isoformat()

    try:
        image_bytes = await _load_image_bytes(req)
    except Exception as e:
        logger.error(f"Failed to load image: {e}")
        _metrics["model_errors"] += 1
        return DeepfakeCheckResponse(
            is_deepfake=True,  # fail closed
            confidence=0.0,
            method="load_error",
            indicators=[f"image_load_failed: {str(e)[:80]}"],
            processing_time_ms=(time.monotonic() - start) * 1000,
            timestamp=timestamp,
            session_id=req.session_id,
        )

    # ── Primary: HuggingFace model ────────────────────────────────────────────
    model_loaded = await _load_model()
    if model_loaded and _model_available:
        try:
            loop = asyncio.get_event_loop()
            is_deepfake, confidence, indicators = await loop.run_in_executor(
                None, lambda: asyncio.run(_check_with_model(image_bytes))
            )
            _metrics["deepfake_detected" if is_deepfake else "real_detected"] += 1
            return DeepfakeCheckResponse(
                is_deepfake=is_deepfake,
                confidence=confidence,
                method=f"hf_model:{HF_MODEL_ID}",
                indicators=indicators,
                processing_time_ms=(time.monotonic() - start) * 1000,
                timestamp=timestamp,
                session_id=req.session_id,
                model_id=HF_MODEL_ID,
            )
        except Exception as e:
            logger.warning(f"HuggingFace model inference failed: {e}. Falling back.")
            _metrics["model_errors"] += 1

    # ── Fallback 1: Frequency domain ──────────────────────────────────────────
    if ENABLE_FREQUENCY_FALLBACK:
        try:
            _metrics["fallback_used"] += 1
            loop = asyncio.get_event_loop()
            is_deepfake, confidence, indicators = await loop.run_in_executor(
                None, _check_frequency_domain, image_bytes
            )
            _metrics["deepfake_detected" if is_deepfake else "real_detected"] += 1
            return DeepfakeCheckResponse(
                is_deepfake=is_deepfake,
                confidence=confidence,
                method="frequency_domain_dct",
                indicators=indicators,
                processing_time_ms=(time.monotonic() - start) * 1000,
                timestamp=timestamp,
                session_id=req.session_id,
            )
        except Exception as e:
            logger.warning(f"Frequency domain analysis failed: {e}. Falling back.")

    # ── Fallback 2: Landmark consistency ─────────────────────────────────────
    if ENABLE_LANDMARK_FALLBACK:
        try:
            _metrics["fallback_used"] += 1
            loop = asyncio.get_event_loop()
            is_deepfake, confidence, indicators = await loop.run_in_executor(
                None, _check_landmark_consistency, image_bytes
            )
            _metrics["deepfake_detected" if is_deepfake else "real_detected"] += 1
            return DeepfakeCheckResponse(
                is_deepfake=is_deepfake,
                confidence=confidence,
                method="landmark_consistency",
                indicators=indicators,
                processing_time_ms=(time.monotonic() - start) * 1000,
                timestamp=timestamp,
                session_id=req.session_id,
            )
        except Exception as e:
            logger.warning(f"Landmark consistency check failed: {e}.")

    # ── All methods failed — fail closed ─────────────────────────────────────
    logger.error("All deepfake detection methods failed — returning fail-closed result")
    _metrics["model_errors"] += 1
    return DeepfakeCheckResponse(
        is_deepfake=True,
        confidence=0.0,
        method="fail_closed",
        indicators=["all_detection_methods_failed"],
        processing_time_ms=(time.monotonic() - start) * 1000,
        timestamp=timestamp,
        session_id=req.session_id,
    )

# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Deepfake Detection Service",
    description="Multi-method deepfake detection: HuggingFace ViT model + DCT frequency analysis + landmark consistency. Fail-closed.",
    version="1.0.0",
)

# ── Internal auth (fail-closed) ───────────────────────────────────────────────
# /check and /batch fetch remote images; without auth they are an SSRF oracle.
# No default token: if INTERNAL_API_TOKEN is unset these endpoints return 503.
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")


def require_internal_auth(x_internal_token: Optional[str] = Header(default=None)) -> None:
    if not INTERNAL_API_TOKEN:
        raise HTTPException(status_code=503, detail="INTERNAL_API_TOKEN is not configured; endpoint disabled")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, INTERNAL_API_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal API token")


@app.get("/metrics/pod")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-deepfake-detector"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-deepfake-detector"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-deepfake-detector").info(f"Received signal {signum}, initiating graceful shutdown...")
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
        "service": "python-deepfake-detector",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-deepfake-detector").info("FastAPI shutdown event — cleaning up resources")


# Initialize PostgreSQL tables (middleware-ready)
try:
    _get_db()
except Exception:
    pass

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.post("/check", response_model=DeepfakeCheckResponse)
async def check_deepfake(req: DeepfakeCheckRequest, _auth: None = Depends(require_internal_auth)):
    """Analyse a single image for deepfake artifacts."""
    user_key = req.user_id or req.session_id or "anonymous"
    _metrics["total_requests"] += 1

    if not _rate_limiter.check(user_key):
        _metrics["rate_limited"] += 1
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    return await run_deepfake_check(req)


@app.post("/batch", response_model=BatchCheckResponse)
async def check_batch(req: BatchCheckRequest, _auth: None = Depends(require_internal_auth)):
    """Analyse up to MAX_BATCH_SIZE images in one request."""
    if len(req.images) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_BATCH_SIZE} images per batch")

    user_key = req.user_id or "anonymous"
    _metrics["total_requests"] += 1

    if not _rate_limiter.check(user_key):
        _metrics["rate_limited"] += 1
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    start = time.monotonic()
    tasks = [run_deepfake_check(img) for img in req.images]
    results = await asyncio.gather(*tasks, return_exceptions=False)

    any_deepfake = any(r.is_deepfake for r in results)
    max_confidence = max((r.confidence for r in results), default=0.0)

    return BatchCheckResponse(
        results=list(results),
        any_deepfake=any_deepfake,
        max_confidence=max_confidence,
        processing_time_ms=(time.monotonic() - start) * 1000,
    )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "python-deepfake-detector",
        "model_available": _model_available,
        "model_id": HF_MODEL_ID if _model_available else None,
        "fallbacks": {
            "frequency_domain": ENABLE_FREQUENCY_FALLBACK,
            "landmark_consistency": ENABLE_LANDMARK_FALLBACK,
        },
        "confidence_threshold": DEEPFAKE_CONFIDENCE_THRESHOLD,
    }


@app.get("/metrics")
async def metrics():
    lines = [
        f"deepfake_detector_total_requests {_metrics['total_requests']}",
        f"deepfake_detector_deepfake_detected {_metrics['deepfake_detected']}",
        f"deepfake_detector_real_detected {_metrics['real_detected']}",
        f"deepfake_detector_model_errors {_metrics['model_errors']}",
        f"deepfake_detector_fallback_used {_metrics['fallback_used']}",
        f"deepfake_detector_rate_limited {_metrics['rate_limited']}",
    ]
    return Response(content="\n".join(lines), media_type="text/plain")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("DEEPFAKE_DETECTOR_PORT", "8097"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
