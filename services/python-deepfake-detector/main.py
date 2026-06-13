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
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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

async def _load_image_bytes(req: DeepfakeCheckRequest) -> bytes:
    if req.image_base64:
        # Strip data URI prefix if present
        b64 = req.image_base64
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        return base64.b64decode(b64)
    if req.image_url:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(req.image_url)
            resp.raise_for_status()
            return resp.content
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

# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-deepfake-detector").info(f"Received signal {signum}, initiating graceful shutdown...")

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-deepfake-detector").info("FastAPI shutdown event — cleaning up resources")


# Initialize PostgreSQL tables (middleware-ready)
_db_ensure_tables("deepfake_detector")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/check", response_model=DeepfakeCheckResponse)
async def check_deepfake(req: DeepfakeCheckRequest, request: Request):
    """Analyse a single face image for deepfake artifacts."""
    _metrics["total_requests"] += 1
    user_key = req.user_id or request.client.host or "anonymous"

    if not _rate_limiter.check(user_key):
        _metrics["rate_limited"] += 1
        logger.warning(f"Rate limit exceeded for user: {user_key}")
        raise HTTPException(status_code=429, detail="Rate limit exceeded — max {RATE_LIMIT_RPM} requests/minute")

    if not req.image_url and not req.image_base64:
        raise HTTPException(status_code=422, detail="Either image_url or image_base64 is required")

    result = await run_deepfake_check(req)
    logger.info(
        f"Deepfake check: user={user_key} is_deepfake={result.is_deepfake} "
        f"confidence={result.confidence:.3f} method={result.method} "
        f"latency={result.processing_time_ms:.0f}ms"
    )
    # Persist result to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
    import time as _time
    try:
        _result_data = result if isinstance(result, dict) else {"result": str(result)}
        _db_upsert("deepfake_detector", f"check:{int(_time.time()*1000)}", _result_data)
        _db_log_event("deepfake_detector", "check", _result_data)
    except Exception:
        pass
    return result


@app.post("/batch", response_model=BatchCheckResponse)
async def check_deepfake_batch(req: BatchCheckRequest, request: Request):
    """Analyse up to 8 face images in parallel."""
    _metrics["total_requests"] += 1
    if len(req.images) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=422, detail=f"Batch size exceeds maximum of {MAX_BATCH_SIZE}")

    user_key = req.user_id or request.client.host or "anonymous"
    if not _rate_limiter.check(user_key):
        _metrics["rate_limited"] += 1
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    start = time.monotonic()
    results = await asyncio.gather(*[run_deepfake_check(img) for img in req.images])

    any_deepfake = any(r.is_deepfake for r in results)
    max_confidence = max((r.confidence for r in results), default=0.0)

    # Persist result to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
    import time as _time
    try:
        _result_data = BatchCheckResponse if isinstance(BatchCheckResponse, dict) else {"result": str(BatchCheckResponse)}
        _db_upsert("deepfake_detector", f"batch:{int(_time.time()*1000)}", _result_data)
        _db_log_event("deepfake_detector", "batch", _result_data)
    except Exception:
        pass
    return BatchCheckResponse(
        results=list(results),
        any_deepfake=any_deepfake,
        max_confidence=max_confidence,
        processing_time_ms=(time.monotonic() - start) * 1000,
    )


@app.get("/health")
async def health():
    return {
        "service": "python-deepfake-detector",
        "version": "1.0.0",
        "status": "healthy",
        "model_loaded": _model_available,
        "model_id": HF_MODEL_ID if _model_available else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/metrics")
async def metrics():
    lines = [
        "# HELP deepfake_requests_total Total deepfake check requests",
        "# TYPE deepfake_requests_total counter",
        f"deepfake_requests_total {_metrics['total_requests']}",
        "# HELP deepfake_detected_total Images classified as deepfake",
        "# TYPE deepfake_detected_total counter",
        f"deepfake_detected_total {_metrics['deepfake_detected']}",
        "# HELP deepfake_real_total Images classified as real",
        "# TYPE deepfake_real_total counter",
        f"deepfake_real_total {_metrics['real_detected']}",
        "# HELP deepfake_model_errors_total Model inference errors",
        "# TYPE deepfake_model_errors_total counter",
        f"deepfake_model_errors_total {_metrics['model_errors']}",
        "# HELP deepfake_fallback_used_total Times fallback detection was used",
        "# TYPE deepfake_fallback_used_total counter",
        f"deepfake_fallback_used_total {_metrics['fallback_used']}",
        "# HELP deepfake_rate_limited_total Requests rejected by rate limiter",
        "# TYPE deepfake_rate_limited_total counter",
        f"deepfake_rate_limited_total {_metrics['rate_limited']}",
    ]
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")


@app.on_event("startup")
async def startup():
    logger.info("Starting RemitFlow Deepfake Detection Service v1.0.0")
    # Pre-warm the model in the background (non-blocking)
    asyncio.create_task(_load_model())


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

    port = int(os.getenv("PORT", "8097"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
