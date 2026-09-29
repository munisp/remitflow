"""
RemitFlow KYC — Liveness Detection Engine (wave-15, OSS-first, fail-closed)

Architecture:
  Layer 1: Passive liveness — texture/frequency heuristics (UNCERTIFIED
           risk signal; see function docstring — never a sole gate)
  Layer 2: Active challenge-response — CONSUMES a `challenge_verdict`
           computed upstream by python-kyc-liveness (MediaPipe FaceMesh).
           This engine does NOT score challenge frames itself; there is no
           local hash-mock. No server verdict → layer fails closed.
  Layer 3: MiDaS depth — OPTIONAL advisory signal only. NEVER a gate.
  Layer 4: Injection attack detection — sensor-noise heuristics (uncertified)
  Layer 5: Deepfake detection — frequency-domain heuristics (uncertified)
  Layer 6: Biometric face match — YuNet ONNX face detection + AdaFace IR-50
           ONNX embeddings, cosine similarity.

LICENSING (G10): InsightFace / buffalo_l have been REMOVED entirely
(non-commercial weights). Face detection uses YuNet (OpenCV Zoo, MIT) and
embeddings use AdaFace IR-50 ONNX (AdaFace code MIT; deploy weights via
MODEL_DIR / ADAFACE_MODEL_PATH — never vendored into git). If the required
ONNX weights are absent, this module raises ModelUnavailableError
(fail-closed → 503); it never fabricates embeddings or matches.

COMMERCIAL HOOKS (G1): iProov and FaceTec integrations have been deleted
per the OSS-first mandate.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import numpy as np

logger = logging.getLogger("kyc.liveness")

# ── Config ────────────────────────────────────────────────────────────────────
LIVENESS_THRESHOLD   = float(os.getenv("LIVENESS_THRESHOLD", "0.75"))
FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.35"))
MODEL_DIR            = os.getenv("MODEL_DIR", "/models")
ADAFACE_MODEL_PATH   = os.getenv("ADAFACE_MODEL_PATH",
                                 os.path.join(MODEL_DIR, "adaface_ir50.onnx"))
YUNET_MODEL_PATH     = os.getenv("YUNET_MODEL_PATH",
                                 os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx"))

UNCERTIFIED_NOTICE = (
    "uncertified heuristic risk signal; never the sole gate for a KYC decision"
)


class ModelUnavailableError(RuntimeError):
    """Required ONNX weights/runtime missing → fail-closed (maps to 503)."""

# ── Enums ─────────────────────────────────────────────────────────────────────
class SpoofType(str, Enum):
    NONE           = "none"
    PRINT_2D       = "print_2d"
    REPLAY_2D      = "replay_2d"
    MASK_3D        = "mask_3d"
    DIGITAL_INJECT = "digital_injection"
    DEEPFAKE       = "deepfake"
    PARTIAL_SPOOF  = "partial_spoof"
    UNKNOWN        = "unknown"


class ChallengeType(str, Enum):
    BLINK       = "blink"
    TURN_LEFT   = "turn_left"
    TURN_RIGHT  = "turn_right"
    SMILE       = "smile"
    NOD         = "nod"
    OPEN_MOUTH  = "open_mouth"

# ── Data Models ───────────────────────────────────────────────────────────────
@dataclass
class LivenessResult:
    """Full liveness detection result."""
    session_id:          str
    user_id:             int
    is_live:             bool
    overall_confidence:  float
    spoof_type:          SpoofType
    passive_score:       float
    active_score:        float    # from server-supplied challenge_verdict only
    depth_score:         float    # ADVISORY ONLY — never a gate
    injection_score:     float
    deepfake_score:      float
    face_detected:       bool
    face_bbox:           list
    quality_score:       float
    processing_ms:       int
    provider:            str      # always "internal" — commercial hooks removed
    simulated:           bool = False   # honest marker; always False here
    challenge_results:   list = field(default_factory=list)
    audit_trail:         list = field(default_factory=list)


@dataclass
class ChallengeSession:
    """Active liveness challenge session (challenges issued by this service;
    verification itself happens upstream in python-kyc-liveness)."""
    session_id:     str
    user_id:        int
    challenges:     list
    created_at_ms:  int
    expires_at_ms:  int
    completed:      bool = False

# ── In-memory session store (challenge issuance only; verdicts come from PG /
#    the upstream python-kyc-liveness validator) ──────────────────────────────
_challenge_sessions: dict[str, ChallengeSession] = {}

# ── Layer 1: Passive Anti-Spoofing ────────────────────────────────────────────
def passive_liveness_check(image_bytes: bytes) -> dict:
    """
    Passive liveness via texture/frequency heuristics.

    UNCERTIFIED RISK SIGNAL: these are hand-tuned heuristics (skin-ratio,
    FFT screen-moiré ratio, sharpness, specular ratio), not a trained or
    certified PAD model. No accuracy is claimed. Output feeds the aggregate
    score but must never be the sole basis for approval.
    """
    result = {"is_live": False, "confidence": 0.0, "signals": [],
              "uncertified": True}

    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)

        h, w = img_array.shape[:2]
        if h < 50 or w < 50:
            result["signals"].append("image_too_small")
            return result

        # Signal 1: frequency-domain screen-moiré ratio
        gray = np.mean(img_array, axis=2)
        fft_shift = np.fft.fftshift(np.fft.fft2(gray))
        magnitude = np.log(np.abs(fft_shift) + 1)
        center_h, center_w = h // 2, w // 2
        radius = min(h, w) // 4
        y, x = np.ogrid[:h, :w]
        mask = (x - center_w) ** 2 + (y - center_h) ** 2 <= radius ** 2
        low_freq_energy = np.sum(magnitude[mask])
        high_freq_energy = np.sum(magnitude[~mask])
        freq_ratio = high_freq_energy / (low_freq_energy + 1e-8)
        screen_artifact_score = min(freq_ratio / 10.0, 1.0)
        result["signals"].append(f"freq_ratio={freq_ratio:.3f}")

        # Signal 2: skin-tone ratio in approximate YCbCr
        r, g, b = img_array[:, :, 0], img_array[:, :, 1], img_array[:, :, 2]
        cb_chan = -0.169 * r - 0.331 * g + 0.500 * b + 128
        cr_chan = 0.500 * r - 0.419 * g - 0.081 * b + 128
        skin_mask = ((cb_chan >= 77) & (cb_chan <= 127) &
                     (cr_chan >= 133) & (cr_chan <= 173))
        skin_ratio = np.sum(skin_mask) / (h * w)
        result["signals"].append(f"skin_ratio={skin_ratio:.3f}")

        # Signal 3: sharpness
        laplacian_var = float(np.var(np.gradient(gray)[0]))
        result["signals"].append(f"sharpness={laplacian_var:.1f}")

        # Signal 4: specular/bright-pixel ratio
        bright_pixels = np.sum(gray > 240) / (h * w)
        result["signals"].append(f"bright_ratio={bright_pixels:.4f}")

        liveness_score = 0.5
        liveness_score += 0.15 if 0.05 < skin_ratio < 0.60 else -0.10
        if screen_artifact_score < 0.3:
            liveness_score += 0.20
        elif screen_artifact_score > 0.7:
            liveness_score -= 0.25
        if laplacian_var > 100:
            liveness_score += 0.10
        elif laplacian_var < 20:
            liveness_score -= 0.10
        if bright_pixels < 0.01:
            liveness_score += 0.05

        liveness_score = max(0.0, min(1.0, liveness_score))
        result.update({
            "is_live":    liveness_score >= LIVENESS_THRESHOLD,
            "confidence": round(liveness_score, 4),
            "skin_ratio": round(float(skin_ratio), 4),
            "freq_ratio": round(float(freq_ratio), 4),
            "sharpness":  round(laplacian_var, 2),
        })
    except Exception as e:
        logger.error(f"[Liveness] Passive check error: {e}")
        result["error"] = str(e)

    return result

# ── Layer 2: Active Challenge-Response (server-verdict driven) ────────────────
def create_challenge_session(user_id: int, num_challenges: int = 2) -> ChallengeSession:
    """Issue a randomized challenge sequence (prevents replay of a fixed script)."""
    import random
    all_challenges = list(ChallengeType)
    selected = random.sample(all_challenges, min(num_challenges, len(all_challenges)))
    session = ChallengeSession(
        session_id    = str(uuid.uuid4()),
        user_id       = user_id,
        challenges    = selected,
        created_at_ms = int(time.time() * 1000),
        expires_at_ms = int(time.time() * 1000) + 120_000,
    )
    _challenge_sessions[session.session_id] = session
    logger.info(f"[Liveness] Challenge session created: {session.session_id} "
                f"challenges={[c.value for c in selected]}")
    return session


def verify_challenge_response(
    session_id: str,
    frames: Optional[list] = None,
    challenge_verdict: Optional[dict] = None,
) -> dict:
    """
    Apply the SERVER-SUPPLIED challenge verdict.

    The actual frame analysis is performed upstream by python-kyc-liveness
    (MediaPipe FaceMesh landmark tracking); this engine intentionally does
    NOT score frames locally. FAIL-CLOSED: without a valid upstream verdict
    this layer reports failure — there is no hash-mock or local simulation.

    challenge_verdict shape (produced upstream, audited server-side):
      {"passed": bool, "score": float 0..1,
       "challenges": [{"challenge": str, "completed": bool, "confidence": float}]}
    """
    session = _challenge_sessions.get(session_id)
    if not session:
        return {"success": False, "error": "session_not_found"}

    if int(time.time() * 1000) > session.expires_at_ms:
        return {"success": False, "error": "session_expired"}

    if not challenge_verdict or "passed" not in challenge_verdict:
        return {
            "success": False,
            "error":   "server_challenge_verdict_required",
            "detail":  "challenge frames must be validated upstream by "
                       "python-kyc-liveness (MediaPipe); no local verdict computed",
        }

    passed = bool(challenge_verdict.get("passed"))
    score = float(challenge_verdict.get("score", 0.0))
    score = max(0.0, min(1.0, score))
    session.completed = passed

    return {
        "success":           passed,
        "overall_score":     round(score, 4),
        "challenge_results": challenge_verdict.get("challenges", []),
        "verdict_source":    "python-kyc-liveness:mediapipe_facemesh",
    }

# ── Layer 3: Monocular Depth Estimation (ADVISORY ONLY — never a gate) ────────
def estimate_depth_score(image_bytes: bytes) -> dict:
    """
    Optional MiDaS monocular-depth signal.

    ADVISORY ONLY: the returned score is informational and is EXCLUDED from
    every gate/aggregation decision. If torch/MiDaS is unavailable the
    result is reported as unavailable — no proxy is substituted and nothing
    is fabricated.
    """
    result = {"available": False, "depth_score": None, "is_3d": None,
              "advisory_only": True, "processing_ms": 0}
    start = time.time()

    try:
        import torch
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)

        model_type = "MiDaS_small"
        midas = torch.hub.load("intel-isl/MiDaS", model_type, pretrained=True)
        midas.eval()
        transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
        input_batch = transforms.small_transform(img_array).unsqueeze(0)
        with torch.no_grad():
            prediction = midas(input_batch)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1), size=img_array.shape[:2],
                mode="bicubic", align_corners=False).squeeze()

        depth_map = prediction.numpy()
        depth_var = float(np.var(depth_map))
        result.update({
            "available":      True,
            "depth_score":    round(min(depth_var / 5000.0, 1.0), 4),
            "depth_variance": round(depth_var, 2),
            "is_3d":          depth_var > 1000.0,
            "model":          model_type,
        })
    except Exception as e:
        # Optional signal: honest unavailability, no fallback proxy.
        logger.info(f"[Liveness] MiDaS depth unavailable (advisory, skipped): {e}")
        result["error"] = f"midas_unavailable: {type(e).__name__}"

    result["processing_ms"] = int((time.time() - start) * 1000)
    return result

# ── Layer 4: Digital Injection Attack Detection ───────────────────────────────
def detect_injection_attack(frames: list[bytes]) -> dict:
    """
    UNCERTIFIED heuristic: real camera frames carry sensor noise with
    frame-to-frame variation; injected synthetic frames are often too clean
    or too consistent. Never a sole gate.
    """
    if not frames:
        return {"is_injection": False, "injection_score": 0.0,
                "signals": ["no_frames"], "uncertified": True}

    signals, injection_score = [], 0.0

    try:
        from PIL import Image
        from scipy.ndimage import uniform_filter

        noise_levels = []
        for frame_bytes in frames[:5]:
            img = Image.open(io.BytesIO(frame_bytes)).convert("L")
            gray = np.array(img, dtype=float)
            smoothed = uniform_filter(gray, size=3)
            noise_levels.append(float(np.std(gray - smoothed)))

        if noise_levels:
            avg_noise = sum(noise_levels) / len(noise_levels)
            noise_var = float(np.var(noise_levels))
            if avg_noise < 1.5:
                signals.append(f"low_sensor_noise={avg_noise:.3f}")
                injection_score += 0.4
            if noise_var < 0.1 and len(noise_levels) > 1:
                signals.append(f"suspiciously_consistent_noise_var={noise_var:.4f}")
                injection_score += 0.3
    except ImportError:
        signals.append("scipy_unavailable_limited_analysis")
        injection_score = 0.2
    except Exception as e:
        logger.error(f"[Liveness] Injection detection error: {e}")
        signals.append(f"error: {e}")

    return {
        "is_injection":    injection_score >= 0.5,
        "injection_score": round(injection_score, 4),
        "confidence":      round(1.0 - injection_score, 4),
        "signals":         signals,
        "uncertified":     True,
    }

# ── Layer 5: Deepfake Detection ───────────────────────────────────────────────
def detect_deepfake(image_bytes: bytes) -> dict:
    """
    UNCERTIFIED heuristic: frequency-domain and symmetry cues associated
    with GAN/diffusion faces. No certified accuracy. Never a sole gate.
    """
    result = {"is_deepfake": False, "deepfake_score": 0.0, "signals": [],
              "uncertified": True, "processing_ms": 0}
    start = time.time()

    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)
        gray = np.mean(img_array, axis=2)
        h, w = gray.shape

        # FFT radial profile peaks (GAN fingerprint heuristic)
        magnitude = np.abs(np.fft.fftshift(np.fft.fft2(gray)))
        center_h, center_w = h // 2, w // 2
        y, x = np.ogrid[:h, :w]
        radial_profile = []
        max_r = min(center_h, center_w)
        step = max(max_r // 20, 1)
        for r in range(0, max_r, step):
            ring = (((x - center_w) ** 2 + (y - center_h) ** 2 >= r ** 2) &
                    ((x - center_w) ** 2 + (y - center_h) ** 2 < (r + step) ** 2))
            if np.sum(ring) > 0:
                radial_profile.append(float(np.mean(magnitude[ring])))
        if len(radial_profile) > 3:
            peak_ratio = max(radial_profile) / (float(np.mean(radial_profile)) + 1e-8)
            if peak_ratio > 5.0:
                result["signals"].append(f"fft_peak_ratio={peak_ratio:.2f}")
                result["deepfake_score"] += 0.3

        # Suspicious symmetry
        left_half = gray[:, :w // 2]
        right_half = np.fliplr(gray[:, w // 2:])
        min_w = min(left_half.shape[1], right_half.shape[1])
        symmetry_score = float(np.mean(
            np.abs(left_half[:, :min_w] - right_half[:, :min_w]))) / 255.0
        if symmetry_score < 0.02:
            result["signals"].append(f"high_symmetry={symmetry_score:.4f}")
            result["deepfake_score"] += 0.2

        # Cross-channel correlation
        r_ch = img_array[:, :, 0].flatten().astype(float)
        g_ch = img_array[:, :, 1].flatten().astype(float)
        b_ch = img_array[:, :, 2].flatten().astype(float)
        rg_corr = float(np.corrcoef(r_ch[:1000], g_ch[:1000])[0, 1])
        rb_corr = float(np.corrcoef(r_ch[:1000], b_ch[:1000])[0, 1])
        if rg_corr > 0.98 or rb_corr > 0.98:
            result["signals"].append(
                f"high_channel_correlation rg={rg_corr:.3f} rb={rb_corr:.3f}")
            result["deepfake_score"] += 0.15

        result["deepfake_score"] = round(min(result["deepfake_score"], 1.0), 4)
        result["is_deepfake"] = result["deepfake_score"] >= 0.5
    except Exception as e:
        logger.error(f"[Liveness] Deepfake detection error: {e}")
        result["error"] = str(e)

    result["processing_ms"] = int((time.time() - start) * 1000)
    return result

# ── Layer 6: Biometric Face Match (YuNet + AdaFace, ONNX) ────────────────────
_yunet_detector = None
_adaface_session = None


def _get_yunet():
    """Lazy-load YuNet ONNX face detector. FAIL-CLOSED if weights missing."""
    global _yunet_detector
    if _yunet_detector is not None:
        return _yunet_detector
    if not os.path.isfile(YUNET_MODEL_PATH):
        raise ModelUnavailableError(
            f"yunet_weights_missing: {YUNET_MODEL_PATH}. Set MODEL_DIR or "
            "YUNET_MODEL_PATH. Weights are never vendored in git (fail-closed)."
        )
    try:
        import cv2
        _yunet_detector = cv2.FaceDetectorYN.create(
            YUNET_MODEL_PATH, "", (320, 320), 0.9, 0.3, 5000)
        logger.info(f"[Liveness] YuNet loaded from {YUNET_MODEL_PATH}")
        return _yunet_detector
    except Exception as e:
        raise ModelUnavailableError(f"yunet_init_failed: {e}") from e


def _get_adaface():
    """Lazy-load AdaFace IR-50 ONNX embedding model. FAIL-CLOSED if missing."""
    global _adaface_session
    if _adaface_session is not None:
        return _adaface_session
    if not os.path.isfile(ADAFACE_MODEL_PATH):
        raise ModelUnavailableError(
            f"adaface_weights_missing: {ADAFACE_MODEL_PATH}. Set MODEL_DIR or "
            "ADAFACE_MODEL_PATH. Weights are never vendored in git (fail-closed)."
        )
    try:
        import onnxruntime as ort
        _adaface_session = ort.InferenceSession(
            ADAFACE_MODEL_PATH, providers=["CPUExecutionProvider"])
        logger.info(f"[Liveness] AdaFace IR-50 loaded from {ADAFACE_MODEL_PATH}")
        return _adaface_session
    except Exception as e:
        raise ModelUnavailableError(f"adaface_init_failed: {e}") from e


def _detect_primary_face(img_bgr: np.ndarray) -> Optional[list]:
    """Return [x, y, w, h] of the highest-confidence face, or None."""
    detector = _get_yunet()
    h, w = img_bgr.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img_bgr)
    if faces is None or len(faces) == 0:
        return None
    best = max(faces, key=lambda f: float(f[-1]))
    return [float(best[0]), float(best[1]), float(best[2]), float(best[3])]


def _embed_face(img_bgr: np.ndarray, bbox: list) -> np.ndarray:
    """Crop per YuNet bbox, resize to 112x112, run AdaFace IR-50, L2-normalize."""
    x, y, w, h = bbox
    H, W = img_bgr.shape[:2]
    x1, y1 = max(0, int(x)), max(0, int(y))
    x2, y2 = min(W, int(x + w)), min(H, int(y + h))
    if x2 <= x1 or y2 <= y1:
        raise ValueError("empty_face_crop")
    crop = img_bgr[y1:y2, x1:x2]

    import cv2
    crop = cv2.resize(crop, (112, 112))
    blob = crop[:, :, ::-1].astype(np.float32)          # BGR → RGB
    blob = (blob - 127.5) / 127.5                        # AdaFace IR-50 norm
    blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...]

    session = _get_adaface()
    input_name = session.get_inputs()[0].name
    emb = session.run(None, {input_name: blob})[0][0]
    norm = np.linalg.norm(emb)
    if norm < 1e-8:
        raise ValueError("degenerate_embedding")
    return emb / norm


def _to_bgr(image_bytes: bytes) -> np.ndarray:
    import cv2
    from PIL import Image
    rgb = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    return rgb[:, :, ::-1].copy()


def biometric_face_match(doc_image_bytes: bytes, selfie_bytes: bytes) -> dict:
    """
    Compare document portrait vs selfie via AdaFace IR-50 embeddings.

    FAIL-CLOSED: missing ONNX weights or runtime raises
    ModelUnavailableError (→ 503). No histogram fallback, no fabricated
    similarity. Threshold: cosine similarity >= FACE_MATCH_THRESHOLD
    (env, default 0.35).
    """
    result = {
        "success":    False,
        "match":      False,
        "similarity": None,
        "threshold":  FACE_MATCH_THRESHOLD,
        "method":     "yunet_adaface_ir50_onnx",
    }

    doc_bgr = _to_bgr(doc_image_bytes)
    self_bgr = _to_bgr(selfie_bytes)

    doc_face = _detect_primary_face(doc_bgr)
    if doc_face is None:
        result["error"] = "no_face_detected_in_document"
        return result
    self_face = _detect_primary_face(self_bgr)
    if self_face is None:
        result["error"] = "no_face_detected_in_selfie"
        return result

    doc_emb = _embed_face(doc_bgr, doc_face)
    self_emb = _embed_face(self_bgr, self_face)

    similarity = float(np.dot(doc_emb, self_emb))  # cosine (both L2-normed)
    result.update({
        "success":    True,
        "match":      similarity >= FACE_MATCH_THRESHOLD,
        "similarity": round(similarity, 4),
        "doc_face_bbox":    doc_face,
        "selfie_face_bbox": self_face,
    })
    return result

# ── Full Liveness Pipeline ────────────────────────────────────────────────────
def run_liveness_pipeline(
    user_id:           int,
    selfie_base64:     str,
    doc_image_base64:  Optional[str] = None,
    challenge_frames:  Optional[list] = None,
    session_id:        Optional[str] = None,
    challenge_verdict: Optional[dict] = None,
) -> LivenessResult:
    """
    Full liveness pipeline. FAIL-CLOSED semantics:
      - un-decodable selfie → is_live=False
      - doc photo supplied but YuNet/AdaFace unavailable → ModelUnavailableError (503)
      - challenge frames without a server-supplied challenge_verdict →
        active layer fails closed (score 0)
      - MiDaS depth is recorded as advisory only and never gates anything.
    """
    start_ms = int(time.time() * 1000)
    result_id = str(uuid.uuid4())
    audit_trail = []

    try:
        selfie_bytes = base64.b64decode(selfie_base64)
    except Exception:
        return LivenessResult(
            session_id=result_id, user_id=user_id, is_live=False,
            overall_confidence=0.0, spoof_type=SpoofType.UNKNOWN,
            passive_score=0.0, active_score=0.0, depth_score=0.0,
            injection_score=1.0, deepfake_score=1.0,
            face_detected=False, face_bbox=[], quality_score=0.0,
            processing_ms=0, provider="internal",
        )

    # Layer 1: passive (uncertified heuristic)
    passive = passive_liveness_check(selfie_bytes)
    audit_trail.append({"layer": "passive", "result": passive})

    # Layer 2: active challenge — server verdict only, fail-closed
    active_score = 0.0
    active_layer_ran = False
    challenge_results = []
    if challenge_frames and session_id:
        active_layer_ran = True
        challenge_resp = verify_challenge_response(
            session_id, challenge_frames, challenge_verdict)
        if challenge_resp.get("success"):
            active_score = challenge_resp.get("overall_score", 0.0)
        else:
            active_score = 0.0  # fail-closed: missing/failed verdict = 0
        challenge_results = challenge_resp.get("challenge_results", [])
        audit_trail.append({"layer": "active_challenge", "result": challenge_resp})

    # Layer 3: depth — ADVISORY ONLY, excluded from aggregation and gates
    depth = estimate_depth_score(selfie_bytes)
    audit_trail.append({"layer": "depth_estimation_advisory", "result": depth})
    depth_score = depth.get("depth_score") or 0.0

    # Layer 4: injection detection (uncertified heuristic)
    injection_result = {"is_injection": False, "injection_score": 0.0, "signals": []}
    if challenge_frames:
        frame_bytes_list = []
        for f in challenge_frames[:5]:
            try:
                frame_bytes_list.append(base64.b64decode(f.get("image_base64", "")))
            except Exception:
                pass
        if frame_bytes_list:
            injection_result = detect_injection_attack(frame_bytes_list)
    audit_trail.append({"layer": "injection_detection", "result": injection_result})

    # Layer 5: deepfake detection (uncertified heuristic)
    deepfake = detect_deepfake(selfie_bytes)
    audit_trail.append({"layer": "deepfake_detection", "result": deepfake})

    # Layer 6: face match (fail-closed; raises ModelUnavailableError if the
    # doc photo was supplied but YuNet/AdaFace weights are missing)
    face_match_result = None
    face_detected, face_bbox = False, []
    if doc_image_base64:
        doc_bytes = base64.b64decode(doc_image_base64)
        face_match_result = biometric_face_match(doc_bytes, selfie_bytes)
        if face_match_result.get("selfie_face_bbox"):
            face_detected = True
            face_bbox = face_match_result["selfie_face_bbox"]
        audit_trail.append({"layer": "face_match", "result": face_match_result})

    # ── Aggregate (depth EXCLUDED — advisory only) ────────────────────────────
    passive_score  = passive.get("confidence", 0.0)
    inject_score   = injection_result.get("injection_score", 0.0)
    deepfake_score = deepfake.get("deepfake_score", 0.0)

    if active_layer_ran:
        overall = (passive_score * 0.45 + active_score * 0.25 +
                   (1 - inject_score) * 0.15 + (1 - deepfake_score) * 0.15)
    else:
        overall = (passive_score * 0.60 +
                   (1 - inject_score) * 0.20 + (1 - deepfake_score) * 0.20)

    spoof_type = SpoofType.NONE
    if not passive.get("is_live", False):
        if inject_score > 0.5:
            spoof_type = SpoofType.DIGITAL_INJECT
        elif deepfake_score > 0.5:
            spoof_type = SpoofType.DEEPFAKE
        elif depth.get("available") and depth_score < 0.3:
            spoof_type = SpoofType.PRINT_2D
        else:
            spoof_type = SpoofType.REPLAY_2D

    is_live = (
        overall >= LIVENESS_THRESHOLD
        and not injection_result.get("is_injection", False)
        and (not active_layer_ran or active_score > 0.0)  # fail-closed challenge layer
        and (face_match_result is None or (
            face_match_result.get("success") and face_match_result.get("match")))
    )

    end_ms = int(time.time() * 1000)
    return LivenessResult(
        session_id         = result_id,
        user_id            = user_id,
        is_live            = is_live,
        overall_confidence = round(overall, 4),
        spoof_type         = spoof_type,
        passive_score      = round(passive_score, 4),
        active_score       = round(active_score, 4),
        depth_score        = round(depth_score, 4),  # advisory, not gated
        injection_score    = round(inject_score, 4),
        deepfake_score     = round(deepfake_score, 4),
        face_detected      = face_detected,
        face_bbox          = face_bbox,
        quality_score      = round(passive.get("sharpness", 0.0) / 200.0, 4),
        processing_ms      = end_ms - start_ms,
        provider           = "internal",
        challenge_results  = challenge_results,
        audit_trail        = audit_trail,
    )
