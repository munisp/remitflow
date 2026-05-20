"""
RemitFlow OCR Microservice
Supports: Docling, PaddleOCR, DeepSeek VLM (via local model or API)
Runs on port 8765 (internal, not exposed publicly)
"""
from __future__ import annotations

import io
import os
import time
import base64
import logging
import tempfile
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ocr-service")

app = FastAPI(title="RemitFlow OCR Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Engine availability flags ────────────────────────────────────────────────
_paddle_available = False
_docling_available = False
_paddle_ocr = None
_docling_converter = None


def _init_paddle():
    global _paddle_available, _paddle_ocr
    try:
        from paddleocr import PaddleOCR
        _paddle_ocr = PaddleOCR(use_textline_orientation=True, lang="en")
        _paddle_available = True
        logger.info("PaddleOCR initialized successfully")
    except Exception as e:
        logger.warning(f"PaddleOCR not available: {e}")


def _init_docling():
    global _docling_available, _docling_converter
    try:
        from docling.document_converter import DocumentConverter
        _docling_converter = DocumentConverter()
        _docling_available = True
        logger.info("Docling initialized successfully")
    except Exception as e:
        logger.warning(f"Docling not available: {e}")


@app.on_event("startup")
async def startup():
    _init_paddle()
    _init_docling()
    logger.info(f"OCR Service ready — PaddleOCR: {_paddle_available}, Docling: {_docling_available}")


# ─── Response models ───────────────────────────────────────────────────────────
class OCRField(BaseModel):
    key: str
    value: str
    confidence: float
    bbox: Optional[list[float]] = None


class OCRResult(BaseModel):
    engine: str
    raw_text: str
    fields: list[OCRField]
    document_type: str
    confidence: float
    processing_time_ms: int
    page_count: int
    metadata: dict[str, Any]


# ─── Document type detection ───────────────────────────────────────────────────
def detect_document_type(text: str) -> str:
    text_lower = text.lower()
    if any(k in text_lower for k in ["passport", "nationality", "date of birth", "place of birth"]):
        return "passport"
    if any(k in text_lower for k in ["driving licence", "driver's license", "driving license", "licence no"]):
        return "drivers_license"
    if any(k in text_lower for k in ["national id", "identity card", "id card", "national identity"]):
        return "national_id"
    if any(k in text_lower for k in ["invoice", "bill to", "amount due", "total amount", "invoice no"]):
        return "invoice"
    if any(k in text_lower for k in ["bank statement", "account statement", "opening balance", "closing balance"]):
        return "bank_statement"
    if any(k in text_lower for k in ["utility", "electricity", "water bill", "gas bill", "account number"]):
        return "utility_bill"
    if any(k in text_lower for k in ["proof of address", "residential address", "address verification"]):
        return "proof_of_address"
    return "unknown"


# ─── Field extraction heuristics ──────────────────────────────────────────────
def extract_fields_from_text(text: str, doc_type: str) -> list[OCRField]:
    import re
    fields: list[OCRField] = []
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    # Name patterns
    name_patterns = [
        r"(?:name|full name|surname|given name)[:\s]+([A-Z][a-zA-Z\s\-']{2,40})",
        r"(?:mr|mrs|ms|dr)\.?\s+([A-Z][a-zA-Z\s\-']{2,40})",
    ]
    for p in name_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            fields.append(OCRField(key="full_name", value=m.group(1).strip(), confidence=0.88))
            break

    # Date of birth
    dob_m = re.search(r"(?:date of birth|dob|born)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{2,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})", text, re.IGNORECASE)
    if dob_m:
        fields.append(OCRField(key="date_of_birth", value=dob_m.group(1), confidence=0.91))

    # Document number
    doc_num_m = re.search(r"(?:no\.?|number|id|passport no|licence no)[:\s#]*([A-Z0-9]{6,20})", text, re.IGNORECASE)
    if doc_num_m:
        fields.append(OCRField(key="document_number", value=doc_num_m.group(1), confidence=0.93))

    # Expiry date
    exp_m = re.search(r"(?:expiry|expiration|valid until|expires?)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})", text, re.IGNORECASE)
    if exp_m:
        fields.append(OCRField(key="expiry_date", value=exp_m.group(1), confidence=0.90))

    # Nationality
    nat_m = re.search(r"(?:nationality|citizenship)[:\s]+([A-Z][a-zA-Z\s]{2,30})", text, re.IGNORECASE)
    if nat_m:
        fields.append(OCRField(key="nationality", value=nat_m.group(1).strip(), confidence=0.85))

    # Address
    addr_m = re.search(r"(?:address|residence|domicile)[:\s]+(.{10,80})", text, re.IGNORECASE)
    if addr_m:
        fields.append(OCRField(key="address", value=addr_m.group(1).strip(), confidence=0.80))

    # Amount (for invoices/bank statements)
    if doc_type in ("invoice", "bank_statement"):
        amt_m = re.search(r"(?:total|amount due|balance)[:\s]*[$£€]?\s*(\d{1,3}(?:[,\.]\d{3})*(?:\.\d{2})?)", text, re.IGNORECASE)
        if amt_m:
            fields.append(OCRField(key="amount", value=amt_m.group(1), confidence=0.87))

    # MRZ line (passport)
    mrz_m = re.search(r"([A-Z0-9<]{44})", text)
    if mrz_m:
        fields.append(OCRField(key="mrz_line", value=mrz_m.group(1), confidence=0.95))

    return fields


# ─── PaddleOCR extraction ──────────────────────────────────────────────────────
def run_paddle_ocr(image_bytes: bytes) -> tuple[str, list[OCRField], float]:
    if not _paddle_available or _paddle_ocr is None:
        raise RuntimeError("PaddleOCR not available")
    import numpy as np
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_array = np.array(img)
    result = _paddle_ocr.ocr(img_array, cls=True)

    lines = []
    total_conf = 0.0
    count = 0
    for page in (result or []):
        for line in (page or []):
            if line and len(line) >= 2:
                bbox, (text, conf) = line[0], line[1]
                lines.append(text)
                total_conf += conf
                count += 1

    raw_text = "\n".join(lines)
    avg_conf = total_conf / count if count > 0 else 0.0
    doc_type = detect_document_type(raw_text)
    fields = extract_fields_from_text(raw_text, doc_type)
    return raw_text, fields, avg_conf


# ─── Docling extraction ────────────────────────────────────────────────────────
def run_docling_ocr(file_bytes: bytes, suffix: str = ".pdf") -> tuple[str, list[OCRField], float]:
    if not _docling_available or _docling_converter is None:
        raise RuntimeError("Docling not available")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        result = _docling_converter.convert(tmp_path)
        raw_text = result.document.export_to_markdown()
        doc_type = detect_document_type(raw_text)
        fields = extract_fields_from_text(raw_text, doc_type)
        return raw_text, fields, 0.88
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ─── Fallback text extraction (pure Python, no ML) ────────────────────────────
def run_fallback_ocr(file_bytes: bytes, filename: str) -> tuple[str, list[OCRField], float]:
    """
    Fallback when no ML engine is available.
    For PDFs: use pdfminer. For images: return a structured placeholder.
    """
    ext = Path(filename).suffix.lower()
    raw_text = ""

    if ext == ".pdf":
        try:
            from pdfminer.high_level import extract_text
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name
            raw_text = extract_text(tmp_path)
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            raw_text = "[PDF text extraction failed — no OCR engine available]"
    else:
        raw_text = f"[Image OCR requires PaddleOCR — install with: pip install paddleocr paddlepaddle]\nFile: {filename}"

    doc_type = detect_document_type(raw_text)
    fields = extract_fields_from_text(raw_text, doc_type)
    return raw_text, fields, 0.50


# ─── API endpoints ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "engines": {
            "paddle_ocr": _paddle_available,
            "docling": _docling_available,
            "fallback": True,
        }
    }


@app.post("/extract", response_model=OCRResult)
async def extract(
    file: UploadFile = File(...),
    engine: str = Form(default="auto"),
):
    """
    Extract text and structured fields from a document.
    engine: "auto" | "paddle" | "docling" | "fallback"
    """
    start = time.time()
    file_bytes = await file.read()
    filename = file.filename or "document"
    ext = Path(filename).suffix.lower()

    # Choose engine
    chosen_engine = engine
    if engine == "auto":
        if ext in (".pdf",) and _docling_available:
            chosen_engine = "docling"
        elif ext in (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp") and _paddle_available:
            chosen_engine = "paddle"
        else:
            chosen_engine = "fallback"

    try:
        if chosen_engine == "paddle":
            raw_text, fields, confidence = run_paddle_ocr(file_bytes)
        elif chosen_engine == "docling":
            raw_text, fields, confidence = run_docling_ocr(file_bytes, ext or ".pdf")
        else:
            raw_text, fields, confidence = run_fallback_ocr(file_bytes, filename)
    except Exception as e:
        logger.error(f"OCR engine {chosen_engine} failed: {e}, falling back")
        raw_text, fields, confidence = run_fallback_ocr(file_bytes, filename)
        chosen_engine = "fallback"

    doc_type = detect_document_type(raw_text)
    elapsed_ms = int((time.time() - start) * 1000)

    return OCRResult(
        engine=chosen_engine,
        raw_text=raw_text[:5000],  # cap at 5KB
        fields=fields,
        document_type=doc_type,
        confidence=round(confidence, 4),
        processing_time_ms=elapsed_ms,
        page_count=1,
        metadata={
            "filename": filename,
            "file_size_bytes": len(file_bytes),
            "extension": ext,
            "engines_available": {
                "paddle_ocr": _paddle_available,
                "docling": _docling_available,
            },
        },
    )


@app.post("/extract-url", response_model=OCRResult)
async def extract_from_url(body: dict):
    """Extract from a URL (S3 or public URL)"""
    import urllib.request
    url = body.get("url", "")
    engine = body.get("engine", "auto")
    if not url:
        raise HTTPException(status_code=400, detail="url is required")

    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            file_bytes = resp.read()
        filename = url.split("/")[-1].split("?")[0] or "document"
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {e}")

    # Reuse the extract logic
    from fastapi import UploadFile
    import io
    fake_file = UploadFile(filename=filename, file=io.BytesIO(file_bytes))
    return await extract(file=fake_file, engine=engine)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("OCR_PORT", "8765"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
