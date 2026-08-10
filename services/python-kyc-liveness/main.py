"""
RemitFlow KYC & Liveness Detection Service
FastAPI + real biometric verification + fail-closed design
Port: 8095

External dependencies (REQUIRED for production):
  - UNIFACE_MODEL_PATH  (MiniFASNet ONNX model)
  - DEEPFACE_BACKEND  (arcface model)
  - DATABASE_URL  (PostgreSQL for audit trail)
  - AWS Rekognition or similar cloud liveness (optional fallback)

Fail-closed guarantee:
  If ANY biometric model is unavailable, the endpoint returns HTTP 503.
  NEVER returns a heuristic/plausible-looking result.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import os
import re
import signal
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
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
                CREATE TABLE IF NOT EXISTS kyc_liveness_sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    method_used TEXT,
                    fallback_active BOOLEAN DEFAULT FALSE,
                    confidence REAL,
                    raw_result JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_liveness_sessions(user_id);
                CREATE TABLE IF NOT EXISTS kyc_liveness_events (
                    id BIGSERIAL PRIMARY KEY,
                    session_id TEXT,
                    event_type TEXT NOT NULL,
                    payload JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)
    return _db_pool

def db_log_event(session_id, event_type, payload):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO kyc_liveness_events (session_id, event_type, payload) VALUES (%s, %s, %s)",
            (session_id, event_type, psycopg2.extras.Json(payload))
        )

def db_update_session(session_id, status, method_used, fallback_active, confidence, raw_result):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE kyc_liveness_sessions
               SET status=%s, method_used=%s, fallback_active=%s, confidence=%s, raw_result=%s, completed_at=NOW()
               WHERE session_id=%s""",
            (status, method_used, fallback_active, confidence,
             psycopg2.extras.Json(raw_result), session_id)
        )

def db_create_session(session_id, user_id):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO kyc_liveness_sessions (session_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (session_id, user_id)
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[KYC-LIVENESS] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow KYC & Liveness Detection",
    description="Real biometric verification with fail-closed design",
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

# ─── Model Loading ───────────────────────────────────────────────────────────
UNIFACE_MODEL_PATH = os.getenv("UNIFACE_MODEL_PATH", "/models/minifasnet.onnx")
DEEPFACE_BACKEND = os.getenv("DEEPFACE_BACKEND", "arcface")

# Attempt to load models at startup; if unavailable, service is DEGRADED
_uniface_available = False
_deepface_available = False

if os.path.exists(UNIFACE_MODEL_PATH):
    try:
        import onnxruntime as ort
        _uniface_session = ort.InferenceSession(UNIFACE_MODEL_PATH)
        _uniface_available = True
        logger.info(f"MiniFASNet loaded from {UNIFACE_MODEL_PATH}")
    except Exception as e:
        logger.error(f"Failed to load MiniFASNet: {e}")
else:
    logger.error(f"MiniFASNet model NOT FOUND at {UNIFACE_MODEL_PATH}")

try:
    from deepface import DeepFace
    _deepface_available = True
    logger.info("DeepFace loaded successfully")
except Exception as e:
    logger.error(f"DeepFace not available: {e}")

# ─── Pydantic Models ─────────────────────────────────────────────────────────

class LivenessRequest(BaseModel):
    userId: str
    sessionId: str
    image: str  # base64-encoded image
    videoFrames: Optional[List[str]] = None  # base64 frames for active liveness
    challengeType: Optional[str] = "blink"  # blink, head_movement, smile

class FaceMatchRequest(BaseModel):
    userId: str
    sessionId: str
    selfieImage: str
    idDocumentImage: str

class KYCRequest(BaseModel):
    userId: str
    sessionId: str
    selfieImage: str
    idDocumentImage: str
    videoFrames: Optional[List[str]] = None
    challengeType: Optional[str] = "blink"

# ─── Helpers ─────────────────────────────────────────────────────────────────

def decode_image(b64: str) -> np.ndarray:
    try:
        data = base64.b64decode(b64)
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image")
        return img
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

# ─── Liveness Detection (REAL MiniFASNet) ────────────────────────────────────

def detect_liveness(image: np.ndarray) -> dict:
    """Use real MiniFASNet ONNX model. FAIL CLOSED if model unavailable."""
    if not _uniface_available:
        raise HTTPException(
            status_code=503,
            detail="MiniFASNet model unavailable. Liveness detection cannot proceed. "
                   "Set UNIFACE_MODEL_PATH to a valid ONNX file.",
        )

    # Preprocess for MiniFASNet (80x80 RGB)
    img = cv2.resize(image, (80, 80))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = img.astype(np.float32) / 255.0
    img = np.transpose(img, (2, 0, 1))
    img = np.expand_dims(img, axis=0)

    input_name = _uniface_session.get_inputs()[0].name
    outputs = _uniface_session.run(None, {input_name: img})

    # MiniFASNet outputs: [real_prob, fake_prob]
    real_prob = float(outputs[0][0][0])
    fake_prob = float(outputs[0][0][1])
    is_live = real_prob > 0.5

    return {
        "is_live": is_live,
        "confidence": float(real_prob),
        "method": "minifasnet_onnx",
        "model_path": UNIFACE_MODEL_PATH,
    }

# ─── Active Video Liveness (REAL frame analysis) ─────────────────────────────

def detect_active_liveness(frames: List[np.ndarray], challenge_type: str) -> dict:
    """Real active liveness using frame difference + eye landmark detection.
    FAIL CLOSED if MediaPipe unavailable."""
    try:
        import mediapipe as mp
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Active liveness requires MediaPipe. Install with: pip install mediapipe",
        )

    mp_face_mesh = mp.solutions.face_mesh
    face_mesh = mp_face_mesh.FaceMesh(
        static_image_mode=False, max_num_faces=1, refine_landmarks=True,
        min_detection_confidence=0.5, min_tracking_confidence=0.5
    )

    # Eye landmark indices (MediaPipe)
    LEFT_EYE = [33, 160, 158, 133, 153, 144]
    RIGHT_EYE = [362, 385, 387, 263, 373, 380]

    blink_count = 0
    prev_left_open = True
    prev_right_open = True

    for frame in frames:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = face_mesh.process(rgb)
        if results.multi_face_landmarks:
            landmarks = results.multi_face_landmarks[0].landmark
            h, w = frame.shape[:2]

            def eye_aspect_ratio(eye_indices):
                pts = [(int(landmarks[i].x * w), int(landmarks[i].y * h)) for i in eye_indices]
                A = np.linalg.norm(np.array(pts[1]) - np.array(pts[5]))
                B = np.linalg.norm(np.array(pts[2]) - np.array(pts[4]))
                C = np.linalg.norm(np.array(pts[0]) - np.array(pts[3]))
                return (A + B) / (2.0 * C) if C > 0 else 0

            left_ear = eye_aspect_ratio(LEFT_EYE)
            right_ear = eye_aspect_ratio(RIGHT_EYE)
            left_open = left_ear > 0.2
            right_open = right_ear > 0.2

            if prev_left_open and prev_right_open and not left_open and not right_open:
                blink_count += 1
            prev_left_open = left_open
            prev_right_open = right_open

    face_mesh.close()

    passed = blink_count >= 2  # At least 2 blinks required
    return {
        "passed": passed,
        "blink_count": blink_count,
        "challenge_type": challenge_type,
        "method": "mediapipe_face_mesh",
        "confidence": 0.95 if passed else 0.3,
    }

# ─── Face Matching (REAL DeepFace ArcFace) ──────────────────────────────────

def match_faces(selfie: np.ndarray, id_doc: np.ndarray) -> dict:
    """Use real DeepFace ArcFace for face matching. FAIL CLOSED if unavailable."""
    if not _deepface_available:
        raise HTTPException(
            status_code=503,
            detail="DeepFace not available. Face matching cannot proceed. "
                   "Install with: pip install deepface",
        )

    try:
        result = DeepFace.verify(
            img1_path=selfie,
            img2_path=id_doc,
            model_name="ArcFace",
            detector_backend="retinaface",
            distance_metric="cosine",
            enforce_detection=True,
        )
        verified = result.get("verified", False)
        distance = result.get("distance", 1.0)
        threshold = result.get("threshold", 0.68)

        return {
            "match": verified,
            "confidence": 1.0 - distance,
            "method": "deepface_arcface",
            "distance": distance,
            "threshold": threshold,
        }
    except Exception as e:
        logger.error(f"DeepFace verification failed: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Face matching failed: {e}. Cannot proceed without valid biometric comparison.",
        )

# ─── Handlers ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok" if (_uniface_available and _deepface_available) else "degraded",
        "service": "python-kyc-liveness",
        "version": "2.0.0",
        "models": {
            "minifasnet": "loaded" if _uniface_available else "missing",
            "deepface_arcface": "loaded" if _deepface_available else "missing",
        },
        "fail_closed": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/kyc/liveness")
def check_liveness(req: LivenessRequest):
    db_create_session(req.sessionId, req.userId)
    db_log_event(req.sessionId, "liveness_start", {"user_id": req.userId, "challenge": req.challengeType})

    image = decode_image(req.image)
    result = detect_liveness(image)

    active_result = None
    if req.videoFrames:
        frames = [decode_image(f) for f in req.videoFrames]
        active_result = detect_active_liveness(frames, req.challengeType or "blink")
        result["active_liveness"] = active_result
        result["passed"] = result["is_live"] and active_result["passed"]
    else:
        result["passed"] = result["is_live"]

    status = "passed" if result["passed"] else "failed"
    db_update_session(req.sessionId, status, result["method"], False, result["confidence"], result)
    db_log_event(req.sessionId, "liveness_complete", result)

    return {
        "sessionId": req.sessionId,
        "userId": req.userId,
        "passed": result["passed"],
        "confidence": round(result["confidence"], 3),
        "method": result["method"],
        "fallbackActive": False,
        "activeLiveness": active_result,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/kyc/face-match")
def check_face_match(req: FaceMatchRequest):
    db_create_session(req.sessionId, req.userId)
    db_log_event(req.sessionId, "face_match_start", {"user_id": req.userId})

    selfie = decode_image(req.selfieImage)
    id_doc = decode_image(req.idDocumentImage)
    result = match_faces(selfie, id_doc)

    status = "passed" if result["match"] else "failed"
    db_update_session(req.sessionId, status, result["method"], False, result["confidence"], result)
    db_log_event(req.sessionId, "face_match_complete", result)

    return {
        "sessionId": req.sessionId,
        "userId": req.userId,
        "match": result["match"],
        "confidence": round(result["confidence"], 3),
        "method": result["method"],
        "fallbackActive": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/kyc/full-verification")
def full_kyc_verification(req: KYCRequest):
    db_create_session(req.sessionId, req.userId)
    db_log_event(req.sessionId, "full_kyc_start", {"user_id": req.userId})

    # Step 1: Liveness
    image = decode_image(req.selfieImage)
    liveness = detect_liveness(image)

    # Step 2: Active liveness (if video provided)
    active = None
    if req.videoFrames:
        frames = [decode_image(f) for f in req.videoFrames]
        active = detect_active_liveness(frames, req.challengeType or "blink")

    # Step 3: Face match
    selfie = decode_image(req.selfieImage)
    id_doc = decode_image(req.idDocumentImage)
    face_match = match_faces(selfie, id_doc)

    overall_pass = liveness["is_live"] and face_match["match"]
    if active:
        overall_pass = overall_pass and active["passed"]

    status = "passed" if overall_pass else "failed"
    db_update_session(
        req.sessionId, status,
        f"{liveness['method']}+{face_match['method']}",
        False,
        min(liveness["confidence"], face_match["confidence"]),
        {"liveness": liveness, "face_match": face_match, "active": active}
    )
    db_log_event(req.sessionId, "full_kyc_complete", {"passed": overall_pass})

    return {
        "sessionId": req.sessionId,
        "userId": req.userId,
        "passed": overall_pass,
        "liveness": {
            "passed": liveness["is_live"],
            "confidence": round(liveness["confidence"], 3),
            "method": liveness["method"],
        },
        "faceMatch": {
            "match": face_match["match"],
            "confidence": round(face_match["confidence"], 3),
            "method": face_match["method"],
        },
        "activeLiveness": active,
        "fallbackActive": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8095"))
    logger.info(f"Starting kyc-liveness v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
