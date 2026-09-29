"""
RemitFlow KYC — POST /document/verify handler (wave-15 fix)

Server contract (server/routers/kycCapture.ts `submitDocument`):
  Request:  {session_id: str, user_id?: int, doc_type: str,
             frames: [base64 jpeg, 1..6]}
  Response: {ocr: {success, extracted, fields?, model, error?, simulated},
             mrz: {present, valid, checksum_valid?, fields?, reason?, error?,
                   model, simulated},
             authenticity: {risk_score, verdict, signals?, model, simulated},
             portrait_base64: str|null, portrait_error: str|null,
             simulated, session_id, doc_type}

Composition (existing post-wave-15 pipeline pieces — nothing reimplemented):
  1. Best frame selection (sharpness) across the supplied frames.
  2. RapidOCR PP-OCRv5 VIZ OCR          — document_processor.stage2_rapidocr_extraction
  3. Clean-room ICAO 9303 MRZ extract+validate — document_processor.stage3_mrz_validation
  4. MRZ ↔ VIZ cross-validation         — document_processor._cross_validate_mrz_viz
  5. Multi-frame authenticity heuristics — authenticity.assess_authenticity
  6. Document portrait extraction (YuNet, reused from liveness_engine) →
     top-level `portrait_base64` so the server can persist
     verdict.documentPortrait and run biometric face match.

Fail-closed / honesty rules (identical to the rest of the service):
  - RapidOCR runtime/models missing → DocumentProcessingError → 503.
  - MRZ checksum failure is REPORTED (mrz.valid=false + reason); the SERVER
    decides hard-fail. MRZ↔VIZ mismatches are likewise reported as facts.
  - `simulated` is always False; no fallback ever fabricates output.
  - PG persistence of per-stage rows is mandatory; PG down → 503 (handled by
    the caller in main.py via db.PersistenceError).
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
import time
from typing import Optional

import numpy as np

from authenticity import assess_authenticity
from document_processor import (
    DocumentProcessingError,
    _cross_validate_mrz_viz,
    _format_mrz_date,
    stage2_rapidocr_extraction,
    stage3_mrz_validation,
)

logger = logging.getLogger("kyc.document_verify")

MAX_FRAMES = 6  # mirrors MAX_FRAMES in server/routers/kycCapture.ts

OCR_MODEL = "rapidocr-ppocrv5-onnxruntime"
MRZ_MODEL = "icao9303-cleanroom"
AUTH_MODEL = "heuristic-uncertified"


class FrameDecodeError(ValueError):
    """No usable frame in the request → caller maps to HTTP 400."""


# ── Frame decoding + best-frame selection ─────────────────────────────────────
def _decode_frame(b64: str) -> bytes:
    """Strict base64 decode; raises on garbage (never silently skips)."""
    return base64.b64decode(b64, validate=True)


def decode_frames(frames: list[str]) -> list[bytes]:
    """Decode 1..MAX_FRAMES base64 frames. Raises FrameDecodeError if none decode."""
    out: list[bytes] = []
    errors = 0
    for b64 in (frames or [])[:MAX_FRAMES]:
        try:
            out.append(_decode_frame(b64))
        except (binascii.Error, ValueError) as e:
            errors += 1
            logger.warning(f"[DocVerify] undecodable frame skipped: {e}")
    if not out:
        raise FrameDecodeError(f"no decodable frames ({errors} rejected)")
    return out


def _sharpness(image_bytes: bytes) -> float:
    """
    Gradient-variance sharpness proxy (numpy/PIL only). Used ONLY to pick the
    best frame for OCR — an undecodable frame scores -1 and is never picked.
    """
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("L")
        img.thumbnail((256, 256))  # cheap, sufficient for relative ranking
        g = np.asarray(img, dtype=float)
        gy = np.gradient(g, axis=0)
        gx = np.gradient(g, axis=1)
        return float(np.var(gx) + np.var(gy))
    except Exception:
        return -1.0


def pick_best_frame(frame_bytes: list[bytes]) -> bytes:
    """Return the sharpest decodable frame; falls back to the first frame."""
    best, best_score = frame_bytes[0], -1.0
    for fb in frame_bytes:
        s = _sharpness(fb)
        if s > best_score:
            best, best_score = fb, s
    return best


# ── Document portrait extraction (enables server-side face match) ─────────────
def extract_document_portrait(image_bytes: bytes) -> dict:
    """
    Detect the document portrait face on the best frame, crop it (with
    margin), JPEG-encode (quality 85) and base64 it. The server reads the
    top-level `portrait_base64` key and persists it as
    verdict.documentPortrait, which is what unlocks biometric face match.

    FAIL-SOFT / HONESTY (deliberate — unlike the OCR stage above):
      - No face detected  → {"portrait_base64": None, "portrait_error": None}.
        This is NOT an error: the document can still pass on MRZ/OCR/
        authenticity hard evidence; face match simply routes to
        manual_review downstream.
      - YuNet weights/runtime unavailable → portrait_base64=None +
        portrait_error note. We do NOT 503 the whole /document/verify just
        because portrait extraction failed — MRZ/OCR/authenticity are the
        hard evidence; the portrait only enables face match.

    YuNet loading is REUSED from liveness_engine (single lazy singleton,
    YUNET_MODEL_PATH env, fail-closed there) — never duplicated here.
    """
    out = {"portrait_base64": None, "portrait_error": None}
    try:
        # Lazy import consistent with existing patterns (cv2/ort are only
        # imported inside functions in this service).
        import liveness_engine
    except Exception as e:
        out["portrait_error"] = f"liveness_engine_import_failed: {e}"
        logger.warning(f"[DocVerify] portrait extraction unavailable: {e}")
        return out
    try:
        img_bgr = liveness_engine._to_bgr(image_bytes)
        bbox = liveness_engine._detect_primary_face(img_bgr)
    except liveness_engine.ModelUnavailableError as e:
        out["portrait_error"] = f"yunet_unavailable: {e}"
        logger.warning(f"[DocVerify] portrait extraction unavailable: {e}")
        return out
    except Exception as e:
        out["portrait_error"] = f"portrait_detection_failed: {e}"
        logger.warning(f"[DocVerify] portrait extraction error: {e}")
        return out

    if bbox is None:
        # Honest "no face" — not an error (see docstring).
        return out

    try:
        import cv2
        x, y, w, h = bbox
        H, W = img_bgr.shape[:2]
        # 30% margin around the YuNet bbox so the crop carries enough context
        # for the downstream AdaFace embedding.
        mx, my = 0.30 * w, 0.30 * h
        x1, y1 = max(0, int(x - mx)), max(0, int(y - my))
        x2, y2 = min(W, int(x + w + mx)), min(H, int(y + h + my))
        if x2 <= x1 or y2 <= y1:
            out["portrait_error"] = "empty_portrait_crop"
            return out
        crop = img_bgr[y1:y2, x1:x2]
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            out["portrait_error"] = "portrait_jpeg_encode_failed"
            return out
        out["portrait_base64"] = base64.b64encode(buf.tobytes()).decode("ascii")
    except Exception as e:
        out["portrait_error"] = f"portrait_encode_failed: {e}"
        logger.warning(f"[DocVerify] portrait encode error: {e}")
    return out


# ── Orchestrator ──────────────────────────────────────────────────────────────
def run_document_verify(session_id: str, doc_type: str, frames: list[str]) -> dict:
    """
    Synchronous orchestrator (run in the executor by the FastAPI handler).

    Returns {"response": {...}, "stage_records": [...]} where stage_records
    are kyc_pipeline_results row payloads for stages 'ocr', 'mrz' and
    'authenticity' (persisted by the caller; PG failure → 503).

    Raises:
        FrameDecodeError        — no decodable frame (→ 400)
        DocumentProcessingError — required OCR runtime unavailable (→ 503)
    """
    start_ms = int(time.time() * 1000)
    frame_bytes = decode_frames(frames)
    best = pick_best_frame(frame_bytes)
    stage_records: list[dict] = []

    # ── Stage 1: RapidOCR VIZ OCR on the best frame (REQUIRED, fail-closed) ──
    ocr = stage2_rapidocr_extraction(best)  # raises DocumentProcessingError → 503
    ocr_success = bool(ocr.get("success"))
    ocr_text = ocr.get("full_text", "") if ocr_success else ""
    ocr_block = {
        "success":   ocr_success,
        "extracted": ocr_success and bool(ocr_text.strip()),
        "model":     OCR_MODEL,
        "simulated": False,
        "fields": {
            "confidence_avg": ocr.get("confidence_avg"),
            "text_blocks":    len(ocr.get("text_blocks", [])),
            "full_text":      ocr_text[:4000],
        } if ocr_success else None,
    }
    if ocr.get("error"):
        ocr_block["error"] = ocr["error"]
    stage_records.append({
        "stage": "ocr", "model": OCR_MODEL, "success": ocr_success,
        "simulated": False, "score": ocr.get("confidence_avg") or None,
        "details": {"extracted": ocr_block["extracted"],
                    "blocks": len(ocr.get("text_blocks", [])),
                    "error": ocr.get("error"),
                    "processing_ms": ocr.get("processing_ms")},
    })

    # ── Stage 2: clean-room MRZ extraction + ICAO 9303 validation ────────────
    mrz_res = stage3_mrz_validation(ocr_text)
    mrz = mrz_res.get("mrz")
    present = bool(mrz_res.get("mrz_found"))
    checksum_valid: Optional[bool] = bool(mrz_res.get("mrz_valid")) if present else None

    # ── Stage 2b: MRZ ↔ VIZ cross-validation (only on a checksum-valid MRZ) ──
    mismatches: list[str] = []
    if mrz is not None and mrz.all_valid and ocr_text:
        mismatches = _cross_validate_mrz_viz(mrz, ocr_text, {"doc_type": doc_type})

    reasons: list[str] = []
    if not present:
        reasons.append("no_mrz_found_in_ocr_text")
    else:
        if not checksum_valid:
            reasons.append(
                "mrz_checksum_failed: " + ",".join(mrz_res.get("errors", [])))
        reasons.extend(mismatches)

    mrz_fields = None
    if mrz is not None and mrz.parsed:
        mrz_fields = {
            "format":           mrz.format,
            "doc_type":         mrz.doc_type,
            "surname":          mrz.surname,
            "given_names":      mrz.given_names,
            "doc_number":       mrz.doc_number,
            "nationality":      mrz.nationality,
            "issuing_country":  mrz.issuing_country,
            "date_of_birth":    _format_mrz_date(mrz.date_of_birth) or None,
            "expiry_date":      _format_mrz_date(mrz.expiry_date) or None,
            "sex":              mrz.sex or None,
            "field_checks":     [{"name": fc.name, "valid": fc.valid}
                                 for fc in mrz.field_checks],
            "errors":           mrz.errors,
            "cross_validation_mismatches": mismatches,
        }

    mrz_block = {
        "present":        present,
        # valid = a fully verified MRZ: present AND checksums pass AND
        # no MRZ↔VIZ mismatch. Reported as a fact; the SERVER hard-fails.
        "valid":          bool(present and checksum_valid and not mismatches),
        "checksum_valid": checksum_valid,
        "model":          MRZ_MODEL,
        "simulated":      False,
    }
    if mrz_fields is not None:
        mrz_block["fields"] = mrz_fields
    if reasons:
        mrz_block["reason"] = "; ".join(reasons)
        mrz_block["error"] = mrz_res.get("error") or reasons[0].split(":")[0]
    stage_records.append({
        "stage": "mrz", "model": MRZ_MODEL,
        "success": mrz_block["valid"] if present else False,
        "simulated": False,
        "score": (1.0 if mrz_block["valid"]
                  else (0.0 if present else None)),
        "details": {"present": present, "valid": mrz_block["valid"],
                    "checksum_valid": checksum_valid,
                    "format": mrz.format if mrz is not None else None,
                    "reasons": reasons,
                    "processing_ms": mrz_res.get("processing_ms")},
    })

    # ── Stage 3: multi-frame authenticity heuristics (UNCERTIFIED signal) ────
    auth = assess_authenticity(best, frame_bytes)
    auth_block = {
        "risk_score": auth.get("risk_score"),
        "verdict":    auth.get("verdict"),
        "signals":    auth.get("signals") or {},
        "model":      AUTH_MODEL,
        "simulated":  bool(auth.get("simulated", False)),
    }
    if auth.get("error"):
        auth_block["error"] = auth["error"]
    stage_records.append({
        "stage": "authenticity", "model": AUTH_MODEL,
        "success": bool(auth.get("success")),
        "simulated": bool(auth.get("simulated", False)),
        "score": auth.get("risk_score"),
        "details": {"verdict": auth.get("verdict"),
                    "signals": auth.get("signals"),
                    "uncertified": True,
                    "error": auth.get("error")},
    })

    # ── Stage 3b: document portrait extraction (FAIL-SOFT — never 503) ───
    # Runs on the same best frame after the hard-evidence stages. Result is
    # reported as top-level `portrait_base64` (server persists it as
    # verdict.documentPortrait → enables face match) + `portrait_error`.
    portrait = extract_document_portrait(best)

    response = {
        "session_id": session_id,
        "doc_type":   doc_type,
        "ocr":          ocr_block,
        "mrz":          mrz_block,
        "authenticity": auth_block,
        "portrait_base64": portrait["portrait_base64"],
        "portrait_error":  portrait["portrait_error"],
        "simulated":    False,
        "processing_ms": int(time.time() * 1000) - start_ms,
    }
    logger.info(
        f"[DocVerify] session={session_id} doc_type={doc_type} "
        f"frames={len(frame_bytes)} ocr_ok={ocr_success} "
        f"mrz_present={present} mrz_valid={mrz_block['valid']} "
        f"auth_verdict={auth_block['verdict']} "
        f"portrait={'ok' if portrait['portrait_base64'] else 'none'} "
        f"ms={response['processing_ms']}"
    )
    return {"response": response, "stage_records": stage_records}
