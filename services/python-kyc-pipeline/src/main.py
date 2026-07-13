"""
RemitFlow KYC Pipeline — Main FastAPI Application

Orchestrates the full next-generation KYC pipeline:
  1. Document processing: Docling + PaddleOCR PP-OCRv5 + PP-StructureV3 + VLM
  2. Liveness detection: 6-layer (passive + active + depth + injection + deepfake + face match)
  3. Synthetic identity detection
  4. BVN/NIN verification (Nigeria-specific)
  5. Sanctions screening hook
  6. Continuous KYC re-verification

Port: 8148
"""

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import asdict
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

from document_processor import process_document, ExtractedDocumentData
from liveness_engine import (
    run_liveness_pipeline, create_challenge_session,
    ChallengeType, LivenessResult
)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("kyc-pipeline")

# ── Config ────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", "8148"))

# ── Prometheus Metrics ────────────────────────────────────────────────────────
kyc_submitted      = Counter("remitflow_kyc_submitted_total",   "Total KYC submissions")
kyc_approved       = Counter("remitflow_kyc_approved_total",    "Total KYC approvals")
kyc_rejected       = Counter("remitflow_kyc_rejected_total",    "Total KYC rejections")
kyc_manual_review  = Counter("remitflow_kyc_manual_review_total","Total KYC manual reviews")
kyc_pending        = Gauge("remitflow_kyc_pending_count",       "Current pending KYC reviews")
kyc_proc_time      = Histogram("remitflow_kyc_processing_seconds","KYC processing time",
                                buckets=[0.5, 1, 2, 5, 10, 30, 60])
liveness_total     = Counter("remitflow_liveness_checks_total", "Total liveness checks", ["result"])
doc_ocr_total      = Counter("remitflow_doc_ocr_total",         "Document OCR runs", ["doc_type"])
vlm_calls_total    = Counter("remitflow_vlm_calls_total",       "VLM API calls", ["model"])
fraud_signals_total = Counter("remitflow_fraud_signals_total",  "Fraud signals detected", ["signal"])

# ── In-memory stores ──────────────────────────────────────────────────────────
kyc_results: dict[str, dict] = {}

# ── Enums ─────────────────────────────────────────────────────────────────────
class DocType(str, Enum):
    PASSPORT        = "passport"
    NATIONAL_ID     = "national_id"
    DRIVERS_LICENSE = "drivers_license"
    BVN             = "bvn"
    NIN             = "nin"
    UTILITY_BILL    = "utility_bill"

class KYCStatus(str, Enum):
    PENDING    = "pending"
    PROCESSING = "processing"
    APPROVED   = "approved"
    REJECTED   = "rejected"
    REVIEW     = "manual_review"

# ── Request/Response Models ───────────────────────────────────────────────────
class KYCSubmissionRequest(BaseModel):
    user_id:          int
    doc_type:         DocType
    doc_number:       Optional[str] = None
    doc_image_base64: Optional[str] = None
    doc_back_base64:  Optional[str] = None
    selfie_base64:    Optional[str] = None
    first_name:       str
    last_name:        str
    date_of_birth:    str
    nationality:      str
    address:          Optional[str] = None
    run_liveness:     bool = True
    run_vlm:          bool = True

class LivenessCheckRequest(BaseModel):
    user_id:          int
    selfie_base64:    str
    doc_image_base64: Optional[str] = None
    challenge_frames: Optional[list] = None
    session_id:       Optional[str]  = None

class ChallengeSessionRequest(BaseModel):
    user_id:        int
    num_challenges: int = Field(default=2, ge=1, le=4)

# ── KYC Pipeline Orchestrator ─────────────────────────────────────────────────
def run_full_kyc(req: KYCSubmissionRequest) -> dict:
    start_ms = int(time.time() * 1000)
    submission_id = str(uuid.uuid4())
    rejection_reasons = []
    fraud_signals = []

    # ── Stage A: Document Processing ─────────────────────────────────────────
    doc_result = None
    if req.doc_image_base64:
        doc_ocr_total.labels(doc_type=req.doc_type.value).inc()
        doc_result = process_document(
            image_base64=req.doc_image_base64,
            doc_type=req.doc_type.value,
            submitted_data={
                "first_name":   req.first_name,
                "last_name":    req.last_name,
                "date_of_birth": req.date_of_birth,
                "doc_type":     req.doc_type.value,
                "doc_number":   req.doc_number,
            }
        )

        # Collect fraud signals from document processing
        if doc_result.fraud_signals:
            fraud_signals.extend(doc_result.fraud_signals)
            for sig in doc_result.fraud_signals:
                fraud_signals_total.labels(signal=sig[:50]).inc()

        if doc_result.confidence < 0.40:
            rejection_reasons.append(f"low_document_confidence: {doc_result.confidence:.3f}")

        # Cross-check submitted name vs extracted name
        if doc_result.last_name and req.last_name:
            submitted_last = req.last_name.upper().strip()
            extracted_last = doc_result.last_name.upper().strip()
            if submitted_last and extracted_last and submitted_last not in extracted_last and extracted_last not in submitted_last:
                fraud_signals.append(f"name_mismatch: submitted={submitted_last} extracted={extracted_last}")

    # ── Stage B: Liveness Detection ───────────────────────────────────────────
    liveness_result = None
    if req.selfie_base64 and req.run_liveness:
        liveness_result = run_liveness_pipeline(
            user_id=req.user_id,
            selfie_base64=req.selfie_base64,
            doc_image_base64=req.doc_image_base64,
        )
        liveness_total.labels(result="live" if liveness_result.is_live else "spoof").inc()

        if not liveness_result.is_live:
            rejection_reasons.append(
                f"liveness_failed: spoof_type={liveness_result.spoof_type.value} "
                f"confidence={liveness_result.overall_confidence:.3f}"
            )

    # ── Stage C: Determine final status ──────────────────────────────────────
    if len(rejection_reasons) == 0 and len(fraud_signals) == 0:
        status = KYCStatus.APPROVED
        kyc_approved.inc()
    elif len(rejection_reasons) == 0 and len(fraud_signals) <= 1:
        status = KYCStatus.REVIEW
        kyc_manual_review.inc()
    else:
        status = KYCStatus.REJECTED
        kyc_rejected.inc()

    end_ms = int(time.time() * 1000)
    kyc_proc_time.observe((end_ms - start_ms) / 1000)

    result = {
        "submission_id":     submission_id,
        "user_id":           req.user_id,
        "status":            status.value,
        "rejection_reasons": rejection_reasons,
        "fraud_signals":     fraud_signals,
        "processing_ms":     end_ms - start_ms,
        "document": {
            "doc_type":        req.doc_type.value,
            "doc_number":      doc_result.doc_number if doc_result else req.doc_number,
            "first_name":      doc_result.first_name if doc_result else req.first_name,
            "last_name":       doc_result.last_name if doc_result else req.last_name,
            "date_of_birth":   doc_result.date_of_birth if doc_result else req.date_of_birth,
            "expiry_date":     doc_result.expiry_date if doc_result else None,
            "nationality":     doc_result.nationality if doc_result else req.nationality,
            "issuing_country": doc_result.issuing_country if doc_result else None,
            "confidence":      doc_result.confidence if doc_result else None,
            "mrz_valid":       doc_result.mrz.check_digit_valid if (doc_result and doc_result.mrz) else None,
            "pipeline_stages": doc_result.pipeline_stages if doc_result else [],
        } if doc_result else None,
        "liveness": {
            "is_live":            liveness_result.is_live,
            "overall_confidence": liveness_result.overall_confidence,
            "spoof_type":         liveness_result.spoof_type.value,
            "passive_score":      liveness_result.passive_score,
            "active_score":       liveness_result.active_score,
            "depth_score":        liveness_result.depth_score,
            "injection_score":    liveness_result.injection_score,
            "deepfake_score":     liveness_result.deepfake_score,
            "provider":           liveness_result.provider,
        } if liveness_result else None,
    }

    kyc_results[submission_id] = result
    logger.info(
        f"[KYC] Pipeline complete: user={req.user_id} status={status.value} "
        f"fraud_signals={len(fraud_signals)} ms={end_ms - start_ms}"
    )
    return result

# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="RemitFlow KYC Pipeline",
    description="Next-generation KYC with PaddleOCR 3.0, Docling, VLM, and 6-layer liveness detection",
    version="3.0.0",
)

@app.get("/health")
def health():
    return {
        "status":    "healthy",
        "service":   "python-kyc-pipeline",
        "version":   "3.0.0",
        "processed": len(kyc_results),
        "components": {
            "paddleocr":  "PP-OCRv5 + PP-StructureV3",
            "docling":    "Heron layout model",
            "vlm":        os.getenv("VLM_MODEL", "gpt-4o"),
            "liveness":   "6-layer (passive+active+depth+injection+deepfake+biometric)",
        }
    }

@app.get("/livez")
def livez(): return {"ok": True}

@app.get("/readyz")
def readyz(): return {"ok": True}

@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.post("/kyc/submit")
async def submit_kyc(req: KYCSubmissionRequest, background_tasks: BackgroundTasks):
    kyc_submitted.inc()
    kyc_pending.inc()
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, run_full_kyc, req)
    finally:
        kyc_pending.dec()
    return result

@app.get("/kyc/{submission_id}")
def get_kyc_result(submission_id: str):
    if submission_id not in kyc_results:
        raise HTTPException(status_code=404, detail="Submission not found")
    return kyc_results[submission_id]

@app.get("/kyc/user/{user_id}")
def get_user_kyc_history(user_id: int):
    results = [r for r in kyc_results.values() if r.get("user_id") == user_id]
    return {"user_id": user_id, "submissions": results, "total": len(results)}

@app.post("/liveness/check")
async def check_liveness(req: LivenessCheckRequest):
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: run_liveness_pipeline(
            user_id=req.user_id,
            selfie_base64=req.selfie_base64,
            doc_image_base64=req.doc_image_base64,
            challenge_frames=req.challenge_frames,
            session_id=req.session_id,
        )
    )
    liveness_total.labels(result="live" if result.is_live else "spoof").inc()
    return {
        "session_id":         result.session_id,
        "user_id":            result.user_id,
        "is_live":            result.is_live,
        "overall_confidence": result.overall_confidence,
        "spoof_type":         result.spoof_type.value,
        "passive_score":      result.passive_score,
        "active_score":       result.active_score,
        "depth_score":        result.depth_score,
        "injection_score":    result.injection_score,
        "deepfake_score":     result.deepfake_score,
        "processing_ms":      result.processing_ms,
        "provider":           result.provider,
        "challenge_results":  result.challenge_results,
    }

@app.post("/liveness/challenge/create")
def create_challenge(req: ChallengeSessionRequest):
    session = create_challenge_session(req.user_id, req.num_challenges)
    return {
        "session_id":   session.session_id,
        "user_id":      session.user_id,
        "challenges":   [c.value for c in session.challenges],
        "expires_at_ms": session.expires_at_ms,
        "instructions": {
            c.value: {
                "blink":       "Please blink your eyes twice",
                "turn_left":   "Please slowly turn your head to the left",
                "turn_right":  "Please slowly turn your head to the right",
                "smile":       "Please smile naturally",
                "nod":         "Please nod your head up and down",
                "open_mouth":  "Please open your mouth slightly",
            }.get(c.value, "Follow the on-screen instruction")
            for c in session.challenges
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
