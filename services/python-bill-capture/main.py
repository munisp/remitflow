"""
RemitFlow Bill Capture Service (Python) — Wave 10 C3

OCR extraction for inbound vendor bills (email ingest + upload ingest):
  - GET  /health  → service status + whether an OCR engine is configured
  - POST /extract → auth via X-Service-Key (constant-time vs INTERNAL_SERVICE_KEY;
                    unset → 503). Body {storageKey, documentBase64?}.
                    OCR_ENGINE unset or engine unavailable → {"status":"unconfigured"}
                    — extraction output is NEVER fabricated.
                    Otherwise extracts vendor/amount/currency/dueDate/invoiceNumber/
                    lineItems with per-field confidence; overall confidence = min.

Fluvio: consumes `bill-capture-inbound`, produces `bill-capture-extracted`
via the thin HTTP-gateway wrapper in fluvio_client.py (repo pattern:
services/python-africbdc-adapter/main.py). FLUVIO_ENDPOINT unset → inline
/extract processing only + warning (no stream consumer).

Structure mirrors services/python-p2p-intelligence/main.py (stdlib HTTP).
Runs as HTTP service on port 8112.

Telemetry (Wave 11, fail-soft): OpenTelemetry via the shared guarded helper
(services/_shared/otel_helper.py). When the opentelemetry packages (or the
helper itself) are unavailable the service boots and serves normally, logs one
WARN, and /health honestly reports telemetry:"disabled-no-sdk" — telemetry is
never faked. Per-request server spans (method+path) on /health + /extract,
tenant.id from the X-Tenant-Id header, and a child span around the OCR
extraction carrying the honest extraction status/engine as attributes.
"""

import base64
import binascii
import contextlib
import hashlib
import hmac
import json
import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Optional

import ocr_engine
import bill_fields
import fluvio_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("bill-capture")

PORT = int(os.getenv("BILL_CAPTURE_PORT", os.getenv("PORT", "8112")))


# ─── Shared OpenTelemetry helper (guarded; inline no-op shim fallback) ────────
class _OtelShim:
    """No-op stand-in used only when services/_shared/otel_helper.py cannot be
    imported at all (e.g. a minimal container that copies just this directory).
    Keeps every call site identical to the real helper's disabled mode."""

    OTEL_AVAILABLE = False

    @staticmethod
    def init_telemetry(*_a: Any, **_k: Any) -> bool:
        return False

    @staticmethod
    def telemetry_status() -> str:
        return "disabled-no-sdk"

    @staticmethod
    @contextlib.contextmanager
    def span(*_a: Any, **_k: Any):
        yield None

    @staticmethod
    def set_span_attributes(*_a: Any, **_k: Any) -> None:
        return None

    @staticmethod
    def set_tenant(*_a: Any, **_k: Any) -> None:
        return None

    @staticmethod
    def record_request(*_a: Any, **_k: Any) -> None:
        return None


try:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from _shared import otel_helper as otel
except Exception:  # helper file absent → run without telemetry, honestly
    otel = _OtelShim()  # type: ignore

OTEL_ENABLED = otel.init_telemetry("python-bill-capture", service_version="1.0.0")
if not OTEL_ENABLED:
    logger.warning(
        "[BillCapture] OpenTelemetry SDK unavailable — telemetry disabled "
        "(fail-soft; service boots and serves normally)"
    )

# Fail closed: unset key → /extract answers 503 (mirrors the
# require_internal_auth discipline in services/python-realtime-compliance).
INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "")

MAX_DOCUMENT_BYTES = 20 * 1024 * 1024  # 20 MiB decoded cap


# ═══════════════════════════════════════════════════════════════════════════════
# Extraction pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def run_extraction(storage_key: str, document_b64: Optional[str]) -> dict:
    """
    OCR + field extraction for one document. Honest status vocabulary:
      unconfigured — no engine selected or engine unavailable
      error        — bad input or engine failure (message included)
      extracted    — real OCR output, fields + per-field confidence
    """
    if not ocr_engine.engine_configured():
        return {"status": "unconfigured", "reason": "OCR_ENGINE is not set"}
    if not ocr_engine.engine_available():
        return {"status": "unconfigured", "reason": f"OCR engine '{ocr_engine.OCR_ENGINE}' is unavailable"}

    if not document_b64:
        # The TS ingestion layer passes the document inline; this service does
        # not hold object-storage credentials, so a bare storageKey cannot be
        # fetched here. Honest error, never a fabricated extraction.
        return {"status": "error", "error": "documentBase64 is required (storage fetch is not available in this service)"}

    try:
        document_bytes = base64.b64decode(document_b64, validate=True)
    except (binascii.Error, ValueError):
        return {"status": "error", "error": "documentBase64 is not valid base64"}
    if not document_bytes:
        return {"status": "error", "error": "empty document"}
    if len(document_bytes) > MAX_DOCUMENT_BYTES:
        return {"status": "error", "error": "document exceeds 20 MiB limit"}

    mime_hint = "application/pdf" if document_bytes[:4] == b"%PDF" else "image/*"
    ocr_result = ocr_engine.extract_text_blocks(document_bytes, mime_hint)
    if ocr_result is None:
        # Engine was configured+probed but failed on this document.
        return {"status": "error", "error": "OCR engine failed to process the document"}
    if not ocr_result.get("text_blocks"):
        return {"status": "error", "error": "OCR produced no text — document may be blank or unreadable"}

    extraction = bill_fields.extract_bill_fields(
        ocr_result["text_blocks"], ocr_result["full_text"]
    )
    extraction.update({
        "engine": ocr_result["engine"],
        "ocrConfidenceAvg": ocr_result["confidence_avg"],
        "processingMs": ocr_result["processing_ms"],
        "documentSha256": hashlib.sha256(document_bytes).hexdigest(),
        "storageKey": storage_key,
    })
    return extraction


# ═══════════════════════════════════════════════════════════════════════════════
# Fluvio consumer loop (thin HTTP gateway wrapper; disabled without endpoint)
# ═══════════════════════════════════════════════════════════════════════════════

_consumer_stop = threading.Event()


def _fluvio_consumer_loop() -> None:
    """
    Consume bill-capture-inbound → run extraction → produce bill-capture-extracted.
    Only runs when FLUVIO_ENDPOINT is configured; otherwise the service serves
    inline /extract calls only (warned once at startup).
    """
    if not fluvio_client.fluvio_enabled():
        return
    logger.info(f"[BillCapture] Fluvio consumer starting on '{fluvio_client.TOPIC_INBOUND}'")
    offset = 0
    while not _consumer_stop.is_set():
        records = fluvio_client.consume(fluvio_client.TOPIC_INBOUND, offset=offset)
        if not records:
            _consumer_stop.wait(2.0)
            continue
        for rec in records:
            if rec.get("offset") is not None:
                offset = int(rec["offset"]) + 1
            value = rec.get("value") or {}
            storage_key = str(value.get("storageKey", ""))
            job_id = value.get("jobId")
            try:
                with otel.span(
                    f"fluvio.consume {fluvio_client.TOPIC_INBOUND}",
                    kind="consumer",
                ) as child:
                    otel.set_tenant(value.get("tenantId"))
                    result = run_extraction(storage_key, value.get("documentBase64"))
                    otel.set_span_attributes(child, {
                        "bill.extraction.status": result.get("status"),
                        "bill.ocr.engine": result.get("engine"),
                        "messaging.destination": fluvio_client.TOPIC_INBOUND,
                    })
            except Exception as e:  # never let one record kill the loop
                logger.error(f"[BillCapture] Extraction crashed for job {job_id}: {e}")
                result = {"status": "error", "error": "extraction crashed"}
            fluvio_client.produce(
                fluvio_client.TOPIC_EXTRACTED,
                str(job_id if job_id is not None else storage_key),
                {
                    "jobId": job_id,
                    "storageKey": storage_key,
                    "result": result,
                    "extractedAt": datetime.now(timezone.utc).isoformat(),
                },
            )


# ═══════════════════════════════════════════════════════════════════════════════
# HTTP Server
# ═══════════════════════════════════════════════════════════════════════════════

class BillCaptureHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass  # Suppress default logging

    def _send_json(self, data: dict, status: int = 200) -> None:
        self._last_status = status  # observed by the per-request span/metrics
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _start_request_span(self, method: str):
        """Per-request server span (method+path) + tenant.id propagation."""
        self._last_status = 200
        self._req_start = time.monotonic()
        ctx = otel.span(
            f"{method} {self.path}",
            kind="server",
            attributes={"http.request.method": method, "url.path": self.path},
        )
        ctx.__enter__()
        otel.set_tenant(self.headers.get("X-Tenant-Id"))
        return ctx

    def _finish_request_span(self, method: str, ctx) -> None:
        try:
            ctx.__exit__(*sys.exc_info())
        finally:
            otel.record_request(
                method,
                self.path,
                getattr(self, "_last_status", 200),
                time.monotonic() - getattr(self, "_req_start", time.monotonic()),
            )

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        if length > MAX_DOCUMENT_BYTES * 2:
            raise ValueError("request body too large")
        return json.loads(self.rfile.read(length))

    def _authorized(self) -> bool:
        """X-Service-Key, constant-time vs INTERNAL_SERVICE_KEY. Unset → 503."""
        if not INTERNAL_SERVICE_KEY:
            self._send_json({"error": "INTERNAL_SERVICE_KEY is not configured; endpoint disabled"}, 503)
            return False
        presented = self.headers.get("X-Service-Key", "")
        if not presented or not hmac.compare_digest(presented, INTERNAL_SERVICE_KEY):
            self._send_json({"error": "Invalid or missing service key"}, 401)
            return False
        return True

    def do_POST(self) -> None:
        ctx = self._start_request_span("POST")
        try:
            if self.path != "/extract":
                self._send_json({"error": "Not found"}, 404)
                return
            if not self._authorized():
                return
            try:
                body = self._read_body()
            except (json.JSONDecodeError, ValueError) as e:
                self._send_json({"error": f"Invalid request body: {e}"}, 400)
                return

            storage_key = str(body.get("storageKey", "")).strip()
            document_b64 = body.get("documentBase64")
            if not storage_key:
                self._send_json({"error": "storageKey is required"}, 400)
                return
            if document_b64 is not None and not isinstance(document_b64, str):
                self._send_json({"error": "documentBase64 must be a string"}, 400)
                return

            try:
                with otel.span("bill.extract", kind="internal") as child:
                    result = run_extraction(storage_key, document_b64)
                    otel.set_span_attributes(child, {
                        "bill.extraction.status": result.get("status"),
                        "bill.ocr.engine": result.get("engine"),
                        "bill.document.provided": bool(document_b64),
                    })
            except Exception as e:
                logger.error(f"[BillCapture] /extract failed for {storage_key}: {e}")
                self._send_json({"status": "error", "error": "extraction failed"}, 500)
                return

            # Also emit to the extracted topic when Fluvio is configured so
            # stream consumers (lakehouse bronze) see inline extractions too.
            if result.get("status") == "extracted":
                fluvio_client.produce(
                    fluvio_client.TOPIC_EXTRACTED,
                    storage_key,
                    {"storageKey": storage_key, "result": result,
                     "extractedAt": datetime.now(timezone.utc).isoformat()},
                )
            status_code = 200 if result.get("status") != "error" else 422
            self._send_json(result, status_code)
        finally:
            self._finish_request_span("POST", ctx)

    def do_GET(self) -> None:
        ctx = self._start_request_span("GET")
        try:
            if self.path == "/health":
                self._send_json({
                    "status": "ok",
                    "service": "bill-capture",
                    "endpoints": ["/extract", "/health"],
                    "ocr_engine": ocr_engine.engine_configured(),
                    "fluvio": fluvio_client.FLUVIO_ENDPOINT != "",
                    "telemetry": otel.telemetry_status(),
                    "version": "1.0.0",
                })
            else:
                self._send_json({"error": "Not found"}, 404)
        finally:
            self._finish_request_span("GET", ctx)


# ── Graceful shutdown ─────────────────────────────────────────────────────────
def _handle_shutdown(signum, frame):
    _consumer_stop.set()
    print(f"[python-bill-capture] Received signal {signum}, shutting down...")
    raise SystemExit(0)


signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

# ── Pod Lifecycle Observability ───────────────────────────────────────────────
_PROCESS_START_TIME = time.time()
_LIFECYCLE_LOGGER = logging.getLogger("pod-lifecycle")


def _emit_lifecycle_event(event_type: str, **kwargs):
    payload = {
        "event": event_type,
        "service": "python-bill-capture",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs,
    }
    _LIFECYCLE_LOGGER.info(json.dumps(payload))


if __name__ == "__main__":
    consumer = threading.Thread(target=_fluvio_consumer_loop, daemon=True)
    consumer.start()
    _emit_lifecycle_event("service_start", port=PORT, ocr_engine=ocr_engine.OCR_ENGINE or None)
    server = HTTPServer(("0.0.0.0", PORT), BillCaptureHandler)
    print(f"[Bill Capture Python] Running on port {PORT}")
    print(f"[Bill Capture Python] Endpoints: /extract, /health | OCR_ENGINE={ocr_engine.OCR_ENGINE or 'unset'}")
    print(f"[Bill Capture Python] telemetry: {otel.telemetry_status()}")
    server.serve_forever()
