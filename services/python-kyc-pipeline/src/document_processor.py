"""
RemitFlow KYC — Document Processing Engine (wave-15, fail-closed)

Primary VIZ OCR: PP-OCRv5 via rapidocr-onnxruntime (Apache-2.0), lazy-loaded.
Optional enrichers: Docling layout analysis and a VLM semantic check. Every
optional stage that is unavailable returns success=False — there is NO
simulation fallback anywhere in this module. A missing OCR runtime or model
raises DocumentProcessingError (fail-closed → 503 upstream).

Pipeline:
  Stage 1: Docling layout analysis        (optional, fail-closed)
  Stage 2: RapidOCR PP-OCRv5 VIZ OCR      (REQUIRED — hard error if missing)
  Stage 3: MRZ detection + ICAO 9303 validation (HARD GATE on checksum failure)
  Stage 4: VLM semantic validation         (optional, fail-closed)
  Stage 5: MRZ ↔ VIZ cross-validation + field normalization

MRZ policy (SPEC-wave15 §4):
  - Any MRZ checksum failure (per-field or composite) → document REJECTED.
  - MRZ↔VIZ mismatch on name / DOB / doc-number / expiry → document REJECTED.
  - `simulated` is always False here; if a future stage ever produces a
    simulated result it MUST be persisted with simulated=true and treated as
    failure downstream.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from mrz_validator import MRZValidation, validate_mrz

logger = logging.getLogger("kyc.document_processor")

# ── Config ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
OPENAI_API_BASE  = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
DOCLING_ENABLED  = os.getenv("DOCLING_ENABLED", "true").lower() == "true"
VLM_ENABLED      = os.getenv("VLM_ENABLED", "true").lower() == "true"
VLM_MODEL        = os.getenv("VLM_MODEL", "gpt-4o")

# ── Errors ────────────────────────────────────────────────────────────────────
class DocumentProcessingError(RuntimeError):
    """Raised when a REQUIRED stage cannot run (fail-closed; maps to 503)."""


class DocumentRejectedError(RuntimeError):
    """Raised internally when a hard gate (MRZ checksum / cross-validation) fails."""

# ── Lazy-loaded heavy runtimes ────────────────────────────────────────────────
_rapidocr_engine = None
_rapidocr_failed: Optional[str] = None
_docling_conv    = None
_vlm_client      = None


def _get_rapidocr():
    """
    Lazy-load RapidOCR (PP-OCRv5 ONNX models via onnxruntime).
    FAIL-CLOSED: any import/model-load failure raises DocumentProcessingError.
    No simulation fallback exists.
    """
    global _rapidocr_engine, _rapidocr_failed
    if _rapidocr_engine is not None:
        return _rapidocr_engine
    if _rapidocr_failed is not None:
        raise DocumentProcessingError(_rapidocr_failed)
    try:
        from rapidocr_onnxruntime import RapidOCR
        _rapidocr_engine = RapidOCR()  # loads bundled PP-OCRv5 det/rec/cls ONNX models
        logger.info("[DocProcessor] RapidOCR PP-OCRv5 (onnxruntime) initialized")
        return _rapidocr_engine
    except Exception as e:  # ImportError OR model-load failure — both fatal
        _rapidocr_failed = (
            f"rapidocr_unavailable: {type(e).__name__}: {e}. "
            "Refusing to fabricate OCR output (fail-closed)."
        )
        logger.error(f"[DocProcessor] {_rapidocr_failed}")
        raise DocumentProcessingError(_rapidocr_failed)


def _get_docling_converter():
    global _docling_conv
    if _docling_conv is None:
        try:
            from docling.document_converter import DocumentConverter
            _docling_conv = DocumentConverter()
            logger.info("[DocProcessor] Docling layout model initialized")
        except Exception as e:
            logger.warning(f"[DocProcessor] Docling unavailable (optional stage): {e}")
            _docling_conv = None
    return _docling_conv


def _get_vlm_client():
    global _vlm_client
    if _vlm_client is None and OPENAI_API_KEY:
        try:
            from openai import OpenAI
            _vlm_client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_API_BASE)
            logger.info(f"[DocProcessor] VLM client initialized: {VLM_MODEL}")
        except Exception as e:
            logger.warning(f"[DocProcessor] VLM client unavailable (optional stage): {e}")
            _vlm_client = None
    return _vlm_client

# ── Data Models ───────────────────────────────────────────────────────────────
@dataclass
class ExtractedDocumentData:
    """Fully extracted and normalized document data."""
    doc_type:        str
    success:         bool = False
    simulated:       bool = False          # MUST stay False; honest marker if ever used
    rejected:        bool = False          # hard-gate rejection (MRZ checksum / mismatch)
    rejection_reasons: list = field(default_factory=list)
    doc_number:      str = ""
    first_name:      str = ""
    last_name:       str = ""
    date_of_birth:   str = ""              # YYYY-MM-DD
    expiry_date:     str = ""              # YYYY-MM-DD
    issuing_country: str = ""
    nationality:     str = ""
    sex:             str = ""
    address:         str = ""
    mrz:             Optional[MRZValidation] = None
    mrz_found:       bool = False
    mrz_checksum_valid: bool = False
    zones:           list = field(default_factory=list)
    raw_text:        str = ""
    confidence:      float = 0.0
    processing_ms:   int = 0
    pipeline_stages: list = field(default_factory=list)  # stage records for PG persistence
    vlm_validation:  dict = field(default_factory=dict)
    fraud_signals:   list = field(default_factory=list)


def _stage_record(stage: str, model: str, success: bool, score: Optional[float],
                  details: dict, simulated: bool = False) -> dict:
    """Build one kyc_pipeline_results row payload (persisted by caller)."""
    return {
        "stage":     stage,
        "model":     model,
        "success":   bool(success),
        "simulated": bool(simulated),
        "score":     score,
        "details":   details,
    }

# ── Stage 1: Docling layout analysis (OPTIONAL, fail-closed) ──────────────────
def stage1_docling_layout(image_bytes: bytes) -> dict:
    start = time.time()
    result = {"stage": "docling_layout", "success": False, "zones": [],
              "reading_order": [], "doc_classification": "unknown", "processing_ms": 0}

    if not DOCLING_ENABLED:
        result["error"] = "docling_disabled"
        result["processing_ms"] = int((time.time() - start) * 1000)
        return result

    converter = _get_docling_converter()
    if converter is None:
        # FAIL-CLOSED: optional stage reports failure; nothing is fabricated.
        result["error"] = "docling_unavailable"
        result["processing_ms"] = int((time.time() - start) * 1000)
        return result

    tmp_path = None
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name

        doc = converter.convert(tmp_path).document

        zones, reading_order = [], []
        for item in doc.texts:
            zones.append({"type": "text_block", "text": item.text, "confidence": 0.95})
            reading_order.append(item.text)

        full_text = " ".join(reading_order).upper()
        if any(k in full_text for k in ["PASSPORT", "PASSEPORT"]):
            doc_class = "passport"
        elif any(k in full_text for k in ["NATIONAL", "IDENTITY", "CARTE"]):
            doc_class = "national_id"
        elif any(k in full_text for k in ["DRIVER", "DRIVING", "LICENCE"]):
            doc_class = "drivers_license"
        else:
            doc_class = "identity_document"

        result.update({
            "success": True,
            "zones": zones,
            "reading_order": reading_order,
            "doc_classification": doc_class,
            "full_text": "\n".join(reading_order),
        })
    except Exception as e:
        logger.error(f"[DocProcessor] Docling error: {e}")
        result["error"] = str(e)
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    result["processing_ms"] = int((time.time() - start) * 1000)
    return result

# ── Stage 2: RapidOCR PP-OCRv5 VIZ extraction (REQUIRED, fail-closed) ─────────
def stage2_rapidocr_extraction(image_bytes: bytes) -> dict:
    """
    Primary VIZ OCR. Raises DocumentProcessingError if the OCR runtime or its
    models are unavailable — no fabricated output, ever.
    """
    start = time.time()
    result = {"stage": "rapidocr_ppocrv5", "success": False, "text_blocks": [],
              "full_text": "", "confidence_avg": 0.0, "processing_ms": 0}

    engine = _get_rapidocr()  # raises DocumentProcessingError when unavailable

    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)

        ocr_result, _elapse = engine(img_array)

        text_blocks, all_text, confidences = [], [], []
        if ocr_result:
            for line in ocr_result:
                bbox, text, conf = line[0], line[1], line[2]
                text_blocks.append({
                    "bbox":       bbox,
                    "text":       text,
                    "confidence": round(float(conf), 4),
                })
                all_text.append(text)
                confidences.append(float(conf))

        result.update({
            "success":        True,
            "text_blocks":    text_blocks,
            "full_text":      "\n".join(all_text),
            "confidence_avg": round(sum(confidences) / len(confidences), 4) if confidences else 0.0,
        })
    except DocumentProcessingError:
        raise
    except Exception as e:
        logger.error(f"[DocProcessor] RapidOCR error: {e}")
        result["error"] = str(e)

    result["processing_ms"] = int((time.time() - start) * 1000)
    return result

# ── Stage 3: MRZ detection + ICAO 9303 validation (HARD GATE) ─────────────────
_MRZ_CANDIDATE_RE = re.compile(r"[A-Z0-9<]{28,}")


def _extract_mrz_candidates(text: str) -> list[str]:
    """Pull MRZ-shaped lines out of raw OCR text."""
    candidates = []
    for raw in text.splitlines():
        line = re.sub(r"[^A-Z0-9<]", "", raw.upper())
        if _MRZ_CANDIDATE_RE.fullmatch(line):
            candidates.append(line)
    return candidates


def stage3_mrz_validation(ocr_text: str) -> dict:
    """
    Locate MRZ lines in the OCR output and validate per ICAO 9303.

    HARD GATE: if an MRZ is found and ANY check digit (per-field or
    composite) fails, the document must be rejected downstream.
    If no MRZ-shaped lines are found at all, that is reported honestly
    (`mrz_found=False`) — it is NOT fabricated and NOT itself a rejection
    (some document types have no MRZ).
    """
    start = time.time()
    result = {"stage": "mrz_validation", "success": True, "mrz_found": False,
              "mrz_valid": False, "mrz": None, "processing_ms": 0}

    candidates = _extract_mrz_candidates(ocr_text)

    # Try sliding windows of consecutive lines as TD1 (3x30) / TD2 (2x36) / TD3 (2x44)
    best: Optional[MRZValidation] = None
    for width, nlines in ((44, 2), (36, 2), (30, 3)):
        window = [c for c in candidates if len(c) == width]
        for i in range(0, len(window) - nlines + 1):
            v = validate_mrz("\n".join(window[i:i + nlines]))
            if v.parsed and (best is None or v.all_valid):
                best = v
                if v.all_valid:
                    break
        if best and best.all_valid:
            break

    if best is not None:
        result.update({
            "mrz_found": True,
            "mrz_valid": best.all_valid,
            "mrz": best,
            "mrz_format": best.format,
            "field_checks": [
                {"name": fc.name, "valid": fc.valid} for fc in best.field_checks
            ],
            "errors": best.errors,
        })
        if not best.all_valid:
            result["success"] = False  # hard gate: checksum failure = stage failure
            result["error"] = "mrz_checksum_failed"

    result["processing_ms"] = int((time.time() - start) * 1000)
    return result

# ── Stage 4: VLM semantic validation (OPTIONAL, fail-closed) ──────────────────
def stage4_vlm_validation(image_bytes: bytes, doc_type: str, extracted_data: dict) -> dict:
    start = time.time()
    result = {"stage": "vlm_validation", "success": False, "is_genuine": False,
              "doc_type_confirmed": False, "tampering_detected": False,
              "fraud_signals": [], "additional_fields": {}, "confidence": 0.0,
              "processing_ms": 0}

    client = _get_vlm_client()
    if client is None or not VLM_ENABLED:
        # FAIL-CLOSED: no fabricated "is_genuine=True" — stage simply fails.
        result["error"] = "vlm_unavailable_or_disabled"
        result["processing_ms"] = int((time.time() - start) * 1000)
        return result

    try:
        image_b64 = base64.b64encode(image_bytes).decode()
        prompt = f"""You are a document verification expert for a financial remittance platform.
Analyze this identity document image and provide a JSON response with fields:
is_genuine (bool), doc_type_confirmed (bool), doc_type_detected (string),
tampering_detected (bool), tampering_details (string|null), fraud_signals (list),
quality_score (0-1), extracted_fields (first_name, last_name, date_of_birth YYYY-MM-DD,
doc_number, expiry_date YYYY-MM-DD, nationality ISO-3, issuing_country ISO-3, sex M/F),
confidence (0-1), notes.
Claimed document type: {doc_type}
Previously extracted data: {json.dumps(extracted_data)[:800]}
Respond ONLY with valid JSON."""

        response = client.chat.completions.create(
            model=VLM_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
            max_tokens=1000,
            temperature=0.1,
        )

        raw = response.choices[0].message.content.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        vlm_data = json.loads(raw)

        result.update({
            "success":             True,
            "is_genuine":          bool(vlm_data.get("is_genuine", False)),
            "doc_type_confirmed":  bool(vlm_data.get("doc_type_confirmed", False)),
            "tampering_detected":  bool(vlm_data.get("tampering_detected", False)),
            "tampering_details":   vlm_data.get("tampering_details"),
            "fraud_signals":       vlm_data.get("fraud_signals", []),
            "additional_fields":   vlm_data.get("extracted_fields", {}),
            "confidence":          float(vlm_data.get("confidence", 0.0)),
            "quality_score":       float(vlm_data.get("quality_score", 0.0)),
            "notes":               vlm_data.get("notes", ""),
            "model":               VLM_MODEL,
        })
    except Exception as e:
        logger.error(f"[DocProcessor] VLM error: {e}")
        result["error"] = str(e)

    result["processing_ms"] = int((time.time() - start) * 1000)
    return result

# ── Stage 5: MRZ ↔ VIZ cross-validation + normalization ──────────────────────
def _format_mrz_date(yymmdd: str) -> str:
    if len(yymmdd) != 6 or not yymmdd.isdigit():
        return ""
    yy, mm, dd = yymmdd[:2], yymmdd[2:4], yymmdd[4:6]
    year = f"20{yy}" if int(yy) < 30 else f"19{yy}"
    return f"{year}-{mm}-{dd}"


def _norm_name(s: str) -> str:
    return re.sub(r"[^A-Z ]", "", (s or "").upper()).strip()


def _norm_digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _cross_validate_mrz_viz(mrz: MRZValidation, viz_text: str,
                            submitted: dict) -> list[str]:
    """
    Cross-validate MRZ fields against the VIZ OCR text and submitted data.
    Returns a list of mismatch reasons; ANY entry → document REJECTED
    (SPEC-wave15 §4.3).
    """
    mismatches: list[str] = []
    viz_norm = _norm_name(viz_text)

    # Name: MRZ surname must appear in the VIZ zone text.
    if mrz.surname:
        surname = _norm_name(mrz.surname)
        if surname and surname not in viz_norm:
            mismatches.append(f"mrz_viz_name_mismatch: mrz_surname={surname} not in VIZ")

    # Document number: must appear in VIZ text (VIZ prints it without fillers).
    if mrz.doc_number:
        doc_no = mrz.doc_number.strip("<")
        viz_compact = re.sub(r"[^A-Z0-9]", "", (viz_text or "").upper())
        if doc_no and doc_no not in viz_compact:
            mismatches.append(f"mrz_viz_doc_number_mismatch: {doc_no} not in VIZ")

    # DOB / expiry: MRZ YYMMDD must match VIZ or submitted representation.
    mrz_dob = _format_mrz_date(mrz.date_of_birth)
    if mrz_dob:
        dob_digits = _norm_digits(mrz_dob)
        viz_digits = _norm_digits(viz_text)
        submitted_dob = _norm_digits(submitted.get("date_of_birth", ""))
        if (dob_digits not in viz_digits) and (not submitted_dob or dob_digits != submitted_dob):
            mismatches.append(f"mrz_viz_dob_mismatch: mrz={mrz_dob}")

    mrz_expiry = _format_mrz_date(mrz.expiry_date)
    if mrz_expiry:
        exp_digits = _norm_digits(mrz_expiry)
        viz_digits = _norm_digits(viz_text)
        if exp_digits not in viz_digits:
            mismatches.append(f"mrz_viz_expiry_mismatch: mrz={mrz_expiry}")

    return mismatches


def stage5_normalize_fields(
    ocr_result:       dict,
    mrz_result:       dict,
    vlm_result:       dict,
    docling_result:   dict,
    submitted_data:   dict,
) -> ExtractedDocumentData:
    """
    Merge extracted fields. Priority for identity fields: valid MRZ > VLM >
    submitted data. Hard gates applied here:
      - MRZ found + checksum invalid → REJECTED.
      - MRZ ↔ VIZ mismatch (name/DOB/doc-number/expiry) → REJECTED.
    """
    doc_type = submitted_data.get("doc_type", "unknown")
    extracted = ExtractedDocumentData(doc_type=doc_type)

    ocr_text = ocr_result.get("full_text", "")
    mrz: Optional[MRZValidation] = mrz_result.get("mrz")

    # ── Hard gate 1: MRZ checksum ─────────────────────────────────────────────
    if mrz_result.get("mrz_found"):
        extracted.mrz_found = True
        extracted.mrz = mrz
        extracted.mrz_checksum_valid = bool(mrz_result.get("mrz_valid"))
        if not extracted.mrz_checksum_valid:
            extracted.rejected = True
            extracted.rejection_reasons.append(
                f"mrz_checksum_failed: {','.join(mrz_result.get('errors', []))}"
            )
            extracted.fraud_signals.append("mrz_checksum_failed")

    # ── Field merge: valid MRZ wins ───────────────────────────────────────────
    if mrz is not None and mrz.all_valid:
        extracted.last_name       = mrz.surname
        extracted.first_name      = mrz.given_names
        extracted.doc_number      = mrz.doc_number
        extracted.nationality     = mrz.nationality
        extracted.issuing_country = mrz.issuing_country
        extracted.sex             = mrz.sex
        extracted.date_of_birth   = _format_mrz_date(mrz.date_of_birth)
        extracted.expiry_date     = _format_mrz_date(mrz.expiry_date)
    else:
        extracted.first_name    = submitted_data.get("first_name", "")
        extracted.last_name     = submitted_data.get("last_name", "")
        extracted.date_of_birth = submitted_data.get("date_of_birth", "")
        extracted.doc_number    = submitted_data.get("doc_number", "") or ""

    # VLM additional fields fill gaps only (never override a valid MRZ).
    vlm_fields = vlm_result.get("additional_fields", {}) if vlm_result.get("success") else {}
    for key, attr in (("first_name", "first_name"), ("last_name", "last_name"),
                      ("date_of_birth", "date_of_birth"), ("doc_number", "doc_number"),
                      ("expiry_date", "expiry_date"), ("nationality", "nationality"),
                      ("issuing_country", "issuing_country"), ("sex", "sex")):
        if vlm_fields.get(key) and not getattr(extracted, attr):
            setattr(extracted, attr, vlm_fields[key])

    # ── Hard gate 2: MRZ ↔ VIZ cross-validation ──────────────────────────────
    if mrz is not None and mrz.all_valid and ocr_text:
        mismatches = _cross_validate_mrz_viz(mrz, ocr_text, submitted_data)
        if mismatches:
            extracted.rejected = True
            extracted.rejection_reasons.extend(mismatches)
            extracted.fraud_signals.extend(m.split(":")[0] for m in mismatches)

    # VLM fraud signals are advisory (never fabricated as passing).
    if vlm_result.get("success"):
        extracted.fraud_signals.extend(vlm_result.get("fraud_signals", []))
        if vlm_result.get("tampering_detected"):
            extracted.fraud_signals.append(
                f"tampering_detected: {vlm_result.get('tampering_details', 'unknown')}"
            )
        extracted.vlm_validation = {
            "is_genuine": vlm_result.get("is_genuine"),
            "confidence": vlm_result.get("confidence"),
            "model":      vlm_result.get("model"),
        }

    extracted.raw_text = ocr_text
    extracted.zones    = docling_result.get("zones", [])

    confidences = [c for c in (ocr_result.get("confidence_avg", 0.0),
                               vlm_result.get("confidence", 0.0)) if c > 0]
    extracted.confidence = round(sum(confidences) / len(confidences), 4) if confidences else 0.0
    extracted.success = True
    return extracted

# ── Main entry point ──────────────────────────────────────────────────────────
def process_document(
    image_base64: str,
    doc_type:     str,
    submitted_data: dict,
) -> ExtractedDocumentData:
    """
    Full document processing pipeline. FAIL-CLOSED:
      - invalid image encoding → success=False result
      - OCR runtime unavailable → DocumentProcessingError (→ 503 upstream)
      - MRZ checksum failure or MRZ↔VIZ mismatch → rejected=True
    """
    overall_start = time.time()
    stages: list[dict] = []

    try:
        image_bytes = base64.b64decode(image_base64)
    except Exception as e:
        logger.error(f"[DocProcessor] Invalid base64: {e}")
        res = ExtractedDocumentData(doc_type=doc_type, fraud_signals=["invalid_image_encoding"])
        res.pipeline_stages.append(_stage_record(
            "decode", "base64", False, None, {"error": "invalid_image_encoding"}))
        return res

    logger.info(f"[DocProcessor] Starting pipeline for {doc_type}, image={len(image_bytes)} bytes")

    # Stage 1 (optional)
    docling_result = stage1_docling_layout(image_bytes)
    stages.append(_stage_record(
        "docling_layout", "docling", docling_result["success"], None,
        {"classification": docling_result.get("doc_classification"),
         "error": docling_result.get("error")}))

    # Stage 2 (REQUIRED — raises DocumentProcessingError when unavailable)
    ocr_result = stage2_rapidocr_extraction(image_bytes)
    stages.append(_stage_record(
        "ocr", "rapidocr-ppocrv5-onnxruntime", ocr_result["success"],
        ocr_result.get("confidence_avg"),
        {"blocks": len(ocr_result.get("text_blocks", [])),
         "error": ocr_result.get("error")}))

    if not ocr_result["success"]:
        # Required stage failed at runtime → fail-closed, no fabrication.
        res = ExtractedDocumentData(doc_type=doc_type, fraud_signals=["ocr_failed"])
        res.pipeline_stages = stages
        return res

    # Stage 3 (hard gate)
    mrz_result = stage3_mrz_validation(ocr_result.get("full_text", ""))
    stages.append(_stage_record(
        "mrz", "icao9303-cleanroom", mrz_result["success"],
        1.0 if mrz_result.get("mrz_valid") else (0.0 if mrz_result.get("mrz_found") else None),
        {"mrz_found": mrz_result.get("mrz_found"),
         "mrz_valid": mrz_result.get("mrz_valid"),
         "format": mrz_result.get("mrz_format"),
         "errors": mrz_result.get("errors")}))

    # Stage 4 (optional)
    vlm_result = stage4_vlm_validation(image_bytes, doc_type, {
        "ocr_text": ocr_result.get("full_text", "")[:500],
        "mrz_found": mrz_result.get("mrz_found"),
        "doc_class": docling_result.get("doc_classification", ""),
    })
    stages.append(_stage_record(
        "vlm", vlm_result.get("model", VLM_MODEL), vlm_result["success"],
        vlm_result.get("confidence") or None,
        {"is_genuine": vlm_result.get("is_genuine"),
         "tampering_detected": vlm_result.get("tampering_detected"),
         "error": vlm_result.get("error")}))

    # Stage 5
    extracted = stage5_normalize_fields(
        ocr_result, mrz_result, vlm_result, docling_result, submitted_data
    )
    extracted.pipeline_stages = stages
    extracted.processing_ms = int((time.time() - overall_start) * 1000)
    logger.info(
        f"[DocProcessor] Pipeline complete: doc_type={doc_type} "
        f"rejected={extracted.rejected} confidence={extracted.confidence:.3f} "
        f"fraud_signals={len(extracted.fraud_signals)} total_ms={extracted.processing_ms}"
    )
    return extracted
