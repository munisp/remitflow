"""
RemitFlow Bill Capture — OCR engine adapter.

REUSE NOTE: the lazy engine-initialization and OCR text-block extraction
approach below is adapted from the existing KYC OCR service at
  services/python-kyc-pipeline/src/document_processor.py
(PaddleOCR PP-OCRv5 / Docling pipeline used by server/routers/kycOrchestration.ts).

CRITICAL DIFFERENCE from the KYC service: the KYC document processor falls
back to SIMULATED OCR output when the engine is not installed. Bill capture
is a financial-data pipeline and must NEVER fabricate extraction output —
when the configured engine is unavailable this module reports the engine as
unavailable and the caller returns {"status": "unconfigured"}.
"""

import io
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger("bill-capture.ocr")

# ── Config ────────────────────────────────────────────────────────────────────
# OCR_ENGINE selects the extraction engine: "paddleocr" | "docling".
# Unset → the service reports {"status": "unconfigured"} on /extract.
OCR_ENGINE = os.getenv("OCR_ENGINE", "").strip().lower()
USE_GPU = os.getenv("PADDLE_USE_GPU", "false").lower() == "true"

_paddle_ocr = None
_paddle_failed = False
_docling_conv = None
_docling_failed = False


def engine_configured() -> bool:
    """True only when an engine is explicitly selected via OCR_ENGINE."""
    return OCR_ENGINE in ("paddleocr", "docling")


def _get_paddle_ocr():
    """Lazy-init PaddleOCR PP-OCRv5 (adapted from kyc document_processor)."""
    global _paddle_ocr, _paddle_failed
    if _paddle_ocr is not None:
        return _paddle_ocr
    if _paddle_failed:
        return None
    try:
        from paddleocr import PaddleOCR  # noqa: WPS433 (lazy heavy import)
        _paddle_ocr = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            use_gpu=USE_GPU,
            show_log=False,
        )
        logger.info("[BillCapture] PaddleOCR PP-OCRv5 initialized")
    except Exception as e:  # ImportError or engine init failure
        logger.warning(f"[BillCapture] PaddleOCR unavailable: {e}")
        _paddle_failed = True
        _paddle_ocr = None
    return _paddle_ocr


def _get_docling_converter():
    """Lazy-init Docling document converter (adapted from kyc document_processor)."""
    global _docling_conv, _docling_failed
    if _docling_conv is not None:
        return _docling_conv
    if _docling_failed:
        return None
    try:
        from docling.document_converter import DocumentConverter  # noqa: WPS433
        _docling_conv = DocumentConverter()
        logger.info("[BillCapture] Docling converter initialized")
    except Exception as e:
        logger.warning(f"[BillCapture] Docling unavailable: {e}")
        _docling_failed = True
        _docling_conv = None
    return _docling_conv


def engine_available() -> bool:
    """Probe the configured engine without fabricating anything."""
    if not engine_configured():
        return False
    if OCR_ENGINE == "paddleocr":
        return _get_paddle_ocr() is not None
    if OCR_ENGINE == "docling":
        return _get_docling_converter() is not None
    return False


def extract_text_blocks(document_bytes: bytes, mime_hint: str = "") -> Optional[dict]:
    """
    Run the configured OCR engine over a document and return text blocks with
    per-block confidence. Returns None when the engine is unavailable or fails
    — the caller maps this to {"status": "unconfigured"} / an honest error and
    NEVER to fabricated text.

    Result shape (mirrors the kyc pipeline's stage2 paddleocr result):
      { "engine": str, "text_blocks": [{"text", "confidence", "bbox"?}],
        "full_text": str, "confidence_avg": float, "processing_ms": int }
    """
    start = time.time()

    if OCR_ENGINE == "paddleocr":
        ocr = _get_paddle_ocr()
        if ocr is None:
            return None
        try:
            import numpy as np  # noqa: WPS433
            from PIL import Image  # noqa: WPS433

            img = Image.open(io.BytesIO(document_bytes)).convert("RGB")
            img_array = np.array(img)
            ocr_result = ocr.ocr(img_array, cls=True)

            text_blocks: list[dict[str, Any]] = []
            confidences: list[float] = []
            if ocr_result and ocr_result[0]:
                for line in ocr_result[0]:
                    bbox, (text, conf) = line[0], line[1]
                    text_blocks.append({
                        "bbox": bbox,
                        "text": text,
                        "confidence": round(float(conf), 4),
                    })
                    confidences.append(float(conf))

            return {
                "engine": "paddleocr",
                "text_blocks": text_blocks,
                "full_text": "\n".join(b["text"] for b in text_blocks),
                "confidence_avg": round(sum(confidences) / len(confidences), 4) if confidences else 0.0,
                "processing_ms": int((time.time() - start) * 1000),
            }
        except Exception as e:
            logger.error(f"[BillCapture] PaddleOCR extraction failed: {e}")
            return None

    if OCR_ENGINE == "docling":
        converter = _get_docling_converter()
        if converter is None:
            return None
        tmp_path = None
        try:
            import tempfile  # noqa: WPS433

            suffix = ".pdf" if "pdf" in mime_hint.lower() else ".img"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(document_bytes)
                tmp_path = tmp.name

            doc_result = converter.convert(tmp_path)
            doc = doc_result.document

            text_blocks = []
            for item in doc.texts:
                # Docling does not emit per-block OCR confidences on the text
                # items — report a neutral block confidence of 1.0 and let the
                # field-level heuristics carry the real confidence signal.
                text_blocks.append({"text": item.text, "confidence": 1.0})

            return {
                "engine": "docling",
                "text_blocks": text_blocks,
                "full_text": "\n".join(b["text"] for b in text_blocks),
                "confidence_avg": 1.0 if text_blocks else 0.0,
                "processing_ms": int((time.time() - start) * 1000),
            }
        except Exception as e:
            logger.error(f"[BillCapture] Docling extraction failed: {e}")
            return None
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    # OCR_ENGINE set to an unknown value — treat as unconfigured, never guess.
    logger.warning(f"[BillCapture] Unknown OCR_ENGINE={OCR_ENGINE!r} — treating as unconfigured")
    return None
