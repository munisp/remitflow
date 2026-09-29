"""
RemitFlow KYC Pipeline — Main FastAPI Application (wave-15)

Orchestrates the fail-closed KYC pipeline:
  1. Document processing: RapidOCR PP-OCRv5 (onnxruntime) VIZ OCR → ICAO 9303
     MRZ validation (hard gate) → MRZ↔VIZ cross-validation → optional Docling/VLM
  2. Document authenticity heuristics (UNCERTIFIED risk signal — never sole gate)
  3. Liveness detection: passive + server-verdict challenge + advisory depth +
     injection + deepfake + YuNet/AdaFace face match
  4. PG persistence: kyc_pipeline_results is the SOURCE OF TRUTH for every
     stage result (G5). PG down → 503. simulated=true never counts as success.

Port: 8148
"""

import asyncio
import logging
import os
import time
import uuid
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

import db
from authenticity import assess_authenticity
from document_processor import (
    DocumentProcessingError, process_document,
)
from document_verify import FrameDecodeError, run_document_verify
from liveness_engine import (
    ModelUnavailableError, run_liveness_pipeline, create_challenge_session,
    ChallengeType, LivenessResult,
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
kyc_submitted       = Counter("remitflow_kyc_submitted_total",    "Total KYC submissions")
kyc_approved        = Counter("remitflow_kyc_approved_total",     "Total KYC approvals")
kyc_rejected        = Counter("remitflow_kyc_rejected_total",     "Total KYC rejections")
kyc_manual_review   = Counter("remitflow_kyc_manual_review_total","Total KYC manual reviews")
kyc_pending         = Gauge("remitflow_kyc_pending_count",        "Current pending KYC reviews")
kyc_proc_time       = Histogram("remitflow_kyc_processing_seconds","KYC processing time",
                                buckets=[0.5, 1, 2, 5, 10, 30, 60])
liveness_total      = Counter("remitflow_liveness_checks_total",  "Total liveness checks", ["result"])
doc_ocr_total       = Counter("remitflow_doc_ocr_total",          "Document OCR runs", ["doc_type"])
vlm_calls_total     = Counter("remitflow_vlm_calls_total",        "VLM API calls", ["model"])
fraud_signals_total = Counter("remitflow_fraud_signals_total",    "Fraud signals detected", ["signal"])

# ── Optional in-memory cache ONLY (PG kyc_pipeline_results is source of truth) ─
_result_cache: dict[str, dict] = {}

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
class ChallengeVerdict(BaseModel):
    """Server-side challenge verdict, validated upstream by
    python-kyc-liveness (MediaPipe FaceMesh). This service never computes
    a local challenge verdict."""
    passed:     bool
    score:      float = Field(default=0.0, ge=0.0, le=1.0)
    challenges: list  = Field(default_factory=list)


class KYCSubmissionRequest(BaseModel):
    user_id:          int
    doc_type:         DocType
    doc_number:       Optional[str] = None
    doc_image_base64: Optional[str] = None
    doc_back_base64:  Optional[str] = None
    doc_frames_base64: Optional[list] = None   # extra frames for authenticity specular cues
    selfie_base64:    Optional[str] = None
    first_name:       str
    last_name:        str
    date_of_birth:    str
    nationality:      str
    address:          Optional[str] = None
    run_liveness:     bool = True
    run_vlm:          bool = True
    session_id:       Optional[str] = None
    challenge_verdict: Optional[ChallengeVerdict] = None


class LivenessCheckRequest(BaseModel):
    user_id:          int
    selfie_base64:    str
    doc_image_base64: Optional[str] = None
    challenge_frames: Optional[list] = None
    session_id:       Optional[str]  = None
    challenge_verdict: Optional[ChallengeVerdict] = None


class ChallengeSessionRequest(BaseModel):
    user_id:        int
    num_challenges: int = Field(default=2, ge=1, le=4)


class AuthenticityRequest(BaseModel):
    user_id:           int
    session_id:        Optional[str] = None
    doc_image_base64:  str
    frame_base64_list: Optional[list] = None


class DocumentVerifyRequest(BaseModel):
    """Contract with server/routers/kycCapture.ts `submitDocument`."""
    session_id: str
    doc_type:   str
    frames:     list[str] = Field(..., min_length=1, max_length=6)
    user_id:    Optional[int] = None

# ── Helpers ───────────────────────────────────────────────────────────────────
def _503(detail: str) -> HTTPException:
    return HTTPException(status_code=503, detail=detail)


def _decode_frames(b64_list: Optional[list]) -> list[bytes]:
    out = []
    for b64 in (b64_list or [])[:6]:
        try:
            import base64 as _b
            out.append(_b.b64decode(b64))
        except Exception:
            pass
    return out

# ── KYC Pipeline Orchestrator ─────────────────────────────────────────────────
def run_full_kyc(req: KYCSubmissionRequest) -> dict:
    """
    Synchronous orchestrator (runs in the executor). Builds the result plus
    the full list of kyc_pipeline_results stage rows in
    result["_stage_records"]; the async caller persists them (G5) and strips
    the private key before returning the payload.
    """
    import base64
    start_ms = int(time.time() * 1000)
    submission_id = str(uuid.uuid4())
    rejection_reasons = []
    fraud_signals = []
    stage_records: list[dict] = []

    # ── Stage A: Document Processing (fail-closed) ────────────────────────────
    doc_result = None
    if req.doc_image_base64:
        doc_ocr_total.labels(doc_type=req.doc_type.value).inc()
        doc_result = process_document(
            image_base64=req.doc_image_base64,
            doc_type=req.doc_type.value,
            submitted_data={
                "first_name":    req.first_name,
                "last_name":     req.last_name,
                "date_of_birth": req.date_of_birth,
                "doc_type":      req.doc_type.value,
                "doc_number":    req.doc_number,
            },
        )
        stage_records.extend(doc_result.pipeline_stages)

        if not doc_result.success:
            rejection_reasons.append("document_processing_failed")

        if doc_result.rejected:
            # Hard gates: MRZ checksum failure / MRZ↔VIZ mismatch
            rejection_reasons.extend(doc_result.rejection_reasons)

        if doc_result.fraud_signals:
            fraud_signals.extend(doc_result.fraud_signals)
            for sig in doc_result.fraud_signals:
                fraud_signals_total.labels(signal=str(sig)[:50]).inc()

        if doc_result.success and doc_result.confidence < 0.40:
            rejection_reasons.append(f"low_document_confidence: {doc_result.confidence:.3f}")

        # Cross-check submitted name vs extracted name
        if doc_result.last_name and req.last_name:
            submitted_last = req.last_name.upper().strip()
            extracted_last = doc_result.last_name.upper().strip()
            if (submitted_last and extracted_last
                    and submitted_last not in extracted_last
                    and extracted_last not in submitted_last):
                fraud_signals.append(
                    f"name_mismatch: submitted={submitted_last} extracted={extracted_last}")

        # ── Stage A2: Document authenticity (UNCERTIFIED risk signal) ────────
        try:
            doc_bytes = base64.b64decode(req.doc_image_base64)
            auth = assess_authenticity(doc_bytes, _decode_frames(req.doc_frames_base64))
        except Exception as e:
            auth = {"success": False, "error": str(e), "risk_score": 1.0,
                    "verdict": "high", "simulated": False}
        stage_records.append({
            "stage":     "authenticity",
            "model":     "heuristic-uncertified",
            "success":   bool(auth.get("success")),
            "simulated": bool(auth.get("simulated", False)),
            "score":     auth.get("risk_score"),
            "details":   {"verdict": auth.get("verdict"),
                          "signals": auth.get("signals"),
                          "uncertified": True,
                          "error": auth.get("error")},
        })
        # Advisory only: never a sole gate. High risk → manual review signal.
        if auth.get("success") and auth.get("verdict") == "high":
            fraud_signals.append("authenticity_high_risk_uncertified")

    # ── Stage B: Liveness Detection ───────────────────────────────────────────
    liveness_result = None
    if req.selfie_base64 and req.run_liveness:
        liveness_result = run_liveness_pipeline(
            user_id=req.user_id,
            selfie_base64=req.selfie_base64,
            doc_image_base64=req.doc_image_base64,
            session_id=req.session_id,
            challenge_verdict=(
                req.challenge_verdict.model_dump() if req.challenge_verdict else None),
        )
        liveness_total.labels(result="live" if liveness_result.is_live else "spoof").inc()

        stage_records.append({
            "stage":     "liveness",
            "model":     "internal-multilayer",
            "success":   bool(liveness_result.is_live),
            "simulated": bool(liveness_result.simulated),
            "score":     liveness_result.overall_confidence,
            "details":   {"spoof_type": liveness_result.spoof_type.value,
                          "passive": liveness_result.passive_score,
                          "active": liveness_result.active_score,
                          "injection": liveness_result.injection_score,
                          "deepfake": liveness_result.deepfake_score,
                          "depth_advisory": liveness_result.depth_score},
        })

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
            "mrz_found":       doc_result.mrz_found if doc_result else None,
            "mrz_valid":       doc_result.mrz_checksum_valid if doc_result else None,
            "rejected":        doc_result.rejected if doc_result else None,
            "pipeline_stages": [
                {"stage": s["stage"], "success": s["success"], "simulated": s["simulated"]}
                for s in (doc_result.pipeline_stages if doc_result else [])
            ],
        } if doc_result else None,
        "liveness": {
            "is_live":            liveness_result.is_live,
            "overall_confidence": liveness_result.overall_confidence,
            "spoof_type":         liveness_result.spoof_type.value,
            "passive_score":      liveness_result.passive_score,
            "active_score":       liveness_result.active_score,
            "depth_score_advisory": liveness_result.depth_score,
            "injection_score":    liveness_result.injection_score,
            "deepfake_score":     liveness_result.deepfake_score,
            "provider":           liveness_result.provider,
        } if liveness_result else None,
    }

    # Final row: full payload persisted as the source-of-truth record.
    stage_records.append({
        "stage":     "final",
        "model":     "kyc-pipeline-3.1",
        "success":   status == KYCStatus.APPROVED,
        "simulated": False,
        "score":     None,
        "details":   result,
    })
    result["_stage_records"] = stage_records
    result["_submission_id"] = submission_id

    logger.info(
        f"[KYC] Pipeline complete: user={req.user_id} status={status.value} "
        f"fraud_signals={len(fraud_signals)} ms={end_ms - start_ms}"
    )
    return result

# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="RemitFlow KYC Pipeline",
    description="Fail-closed KYC: RapidOCR PP-OCRv5 + ICAO 9303 MRZ hard gate + "
                "YuNet/AdaFace biometrics + PG-persisted stage results",
    version="3.1.0",
)


@app.on_event("startup")
async def _startup():
    # Best-effort pool warm-up; requests still fail closed per-call if PG is down.
    try:
        await db.init_pool()
    except Exception as e:
        logger.error(f"[KYC] PG pool init failed at startup (requests will 503): {e}")


@app.on_event("shutdown")
async def _shutdown():
    await db.close_pool()


@app.get("/health")
def health():
    return {
        "status":    "healthy",
        "service":   "python-kyc-pipeline",
        "version":   "3.1.0",
        "components": {
            "ocr":          "RapidOCR PP-OCRv5 (onnxruntime, Apache-2.0)",
            "mrz":          "ICAO 9303 clean-room validator (hard gate)",
            "vlm":          os.getenv("VLM_MODEL", "gpt-4o") + " (optional, fail-closed)",
            "liveness":     "multilayer (passive+server-challenge+injection+deepfake+yunet/adaface)",
            "authenticity": "UNCERTIFIED heuristic risk signal (never sole gate)",
            "persistence":  "postgresql kyc_pipeline_results (source of truth)",
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
async def submit_kyc(req: KYCSubmissionRequest):
    kyc_submitted.inc()
    kyc_pending.inc()
    loop = asyncio.get_event_loop()
    try:
        try:
            result = await loop.run_in_executor(None, run_full_kyc, req)
        except DocumentProcessingError as e:
            # Required OCR runtime unavailable → fail-closed 503
            raise _503(f"document_processing_unavailable: {e}")
        except ModelUnavailableError as e:
            raise _503(f"biometric_model_unavailable: {e}")

        stage_records = result.pop("_stage_records")
        submission_id = result.pop("_submission_id")

        # G5: PG is source of truth. Persistence failure → 503 (fail-closed).
        try:
            await db.persist_stage_results(req.user_id, submission_id, stage_records)
        except db.PersistenceError as e:
            raise _503(f"persistence_unavailable: {e}")

        _result_cache[submission_id] = result  # optional cache only
        return result
    finally:
        kyc_pending.dec()


@app.get("/kyc/{submission_id}")
async def get_kyc_result(submission_id: str):
    try:
        row = await db.get_submission(submission_id)
    except db.PersistenceError as e:
        raise _503(f"persistence_unavailable: {e}")
    if row is None:
        # Optional cache fallback for very recent submissions
        cached = _result_cache.get(submission_id)
        if cached is not None:
            return cached
        raise HTTPException(status_code=404, detail="Submission not found")
    return row["details"]


@app.get("/kyc/user/{user_id}")
async def get_user_kyc_history(user_id: int):
    try:
        rows = await db.list_user_submissions(user_id)
    except db.PersistenceError as e:
        raise _503(f"persistence_unavailable: {e}")
    return {"user_id": user_id,
            "submissions": [r["details"] for r in rows],
            "total": len(rows)}


@app.post("/liveness/check")
async def check_liveness(req: LivenessCheckRequest):
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: run_liveness_pipeline(
                user_id=req.user_id,
                selfie_base64=req.selfie_base64,
                doc_image_base64=req.doc_image_base64,
                challenge_frames=req.challenge_frames,
                session_id=req.session_id,
                challenge_verdict=(
                    req.challenge_verdict.model_dump() if req.challenge_verdict else None),
            ),
        )
    except ModelUnavailableError as e:
        raise _503(f"biometric_model_unavailable: {e}")

    liveness_total.labels(result="live" if result.is_live else "spoof").inc()

    # G5: persist the liveness stage result (fail-closed).
    sid = req.session_id or result.session_id
    try:
        # session_id column is uuid; only persist under a valid uuid session id
        import uuid as _uuid
        _uuid.UUID(str(sid))
        await db.persist_stage_result(
            user_id=req.user_id,
            session_id=str(sid),
            stage="liveness",
            model="internal-multilayer",
            success=result.is_live,
            simulated=result.simulated,
            score=result.overall_confidence,
            details={
                "spoof_type": result.spoof_type.value,
                "passive": result.passive_score,
                "active": result.active_score,
                "injection": result.injection_score,
                "deepfake": result.deepfake_score,
                "depth_advisory": result.depth_score,
                "challenge_results": result.challenge_results,
            },
        )
    except ValueError:
        logger.warning(f"[KYC] non-uuid session id {sid!r}; generating one for persistence")
        try:
            await db.persist_stage_result(
                user_id=req.user_id, session_id=str(uuid.uuid4()),
                stage="liveness", model="internal-multilayer",
                success=result.is_live, simulated=result.simulated,
                score=result.overall_confidence,
                details={"spoof_type": result.spoof_type.value,
                         "caller_session_id": str(sid)})
        except db.PersistenceError as e:
            raise _503(f"persistence_unavailable: {e}")
    except db.PersistenceError as e:
        raise _503(f"persistence_unavailable: {e}")

    return {
        "session_id":         result.session_id,
        "user_id":            result.user_id,
        "is_live":            result.is_live,
        "overall_confidence": result.overall_confidence,
        "spoof_type":         result.spoof_type.value,
        "passive_score":      result.passive_score,
        "active_score":       result.active_score,
        "depth_score_advisory": result.depth_score,
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
        "note": ("Challenge frames are validated upstream by python-kyc-liveness "
                 "(MediaPipe FaceMesh); submit the server verdict as "
                 "challenge_verdict to /liveness/check."),
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
        },
    }


@app.post("/authenticity/assess")
async def assess_authenticity_endpoint(req: AuthenticityRequest):
    """
    Document-authenticity heuristic assessment. UNCERTIFIED risk signal —
    returned for risk aggregation only; never a sole gate.
    """
    import base64
    try:
        doc_bytes = base64.b64decode(req.doc_image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_doc_image_base64")

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, lambda: assess_authenticity(doc_bytes, _decode_frames(req.frame_base64_list))
    )

    session_id = req.session_id or str(uuid.uuid4())
    try:
        import uuid as _uuid
        _uuid.UUID(str(session_id))
    except ValueError:
        session_id = str(uuid.uuid4())

    # G5: persist the authenticity stage result (fail-closed).
    try:
        await db.persist_stage_result(
            user_id=req.user_id,
            session_id=session_id,
            stage="authenticity",
            model="heuristic-uncertified",
            success=bool(result.get("success")),
            simulated=bool(result.get("simulated", False)),
            score=result.get("risk_score"),
            details={"verdict": result.get("verdict"),
                     "signals": result.get("signals"),
                     "uncertified": True,
                     "error": result.get("error")},
        )
    except db.PersistenceError as e:
        raise _503(f"persistence_unavailable: {e}")

    result["session_id"] = session_id
    return result


@app.post("/document/verify")
async def verify_document(req: DocumentVerifyRequest):
    """
    Capture-flow document verification (server/routers/kycCapture.ts).

    Runs RapidOCR VIZ OCR on the best frame, clean-room ICAO 9303 MRZ
    extraction+validation, MRZ↔VIZ cross-validation and multi-frame
    authenticity heuristics, then persists one kyc_pipeline_results row per
    stage ('ocr' | 'mrz' | 'authenticity'). MRZ checksum/cross-validation
    failures are REPORTED (mrz.valid=false + reason) — the server decides
    hard-fail. Fail-closed: missing OCR runtime → 503, PG down → 503.
    """
    loop = asyncio.get_event_loop()
    try:
        out = await loop.run_in_executor(
            None, run_document_verify, req.session_id, req.doc_type, req.frames)
    except FrameDecodeError as e:
        raise HTTPException(status_code=400, detail=f"invalid_frames: {e}")
    except DocumentProcessingError as e:
        # Required OCR runtime/models unavailable → fail-closed 503
        raise _503(f"document_processing_unavailable: {e}")

    # G5: persist per-stage rows. PG down → 503 (fail-closed).
    session_id = req.session_id
    details_extra = None
    try:
        import uuid as _uuid
        _uuid.UUID(str(session_id))
    except ValueError:
        # session_id column is uuid; keep the caller's id inside details.
        logger.warning(f"[KYC] non-uuid session id {session_id!r}; generating one for persistence")
        details_extra = {"caller_session_id": str(session_id)}
        session_id = str(uuid.uuid4())
    stage_records = out["stage_records"]
    if details_extra:
        for rec in stage_records:
            rec["details"] = {**(rec.get("details") or {}), **details_extra}
    try:
        await db.persist_stage_results(req.user_id, session_id, stage_records)
    except db.PersistenceError as e:
        raise _503(f"persistence_unavailable: {e}")

    return out["response"]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT,
                workers=int(os.getenv("UVICORN_WORKERS", "1")))  # SPEC-wave14 §4.6
