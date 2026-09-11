"""
Shared OpenTelemetry helper for RemitFlow Python services (Wave 11).

Design contract (mirrors the guarded-optional pattern used for `geolib` in
services/python-geo-analytics):

  - The opentelemetry packages are OPTIONAL. When they are not installed,
    ``OTEL_AVAILABLE`` is False, ``init_telemetry()`` returns False, and every
    other public helper is a safe no-op. Importing this module NEVER raises.
  - When the SDK is present, ``init_telemetry(service_name, service_version)``
    configures:
      * TracerProvider  + BatchSpanProcessor(OTLP HTTP span exporter)
      * MeterProvider   + PeriodicExportingMetricReader(OTLP HTTP metric exporter)
      * W3C TraceContext propagator (global)
    Endpoint comes from OTEL_EXPORTER_OTLP_ENDPOINT (default
    http://localhost:4318); deployment.environment from DEPLOYMENT_ENVIRONMENT
    or ENVIRONMENT (default "development").
  - Telemetry is never faked: ``telemetry_status()`` honestly reports
    "enabled" only after a real SDK initialization, else "disabled-no-sdk".
  - Nothing in this module ever raises to the caller.

Usage:
    from _shared import otel_helper as otel

    OTEL_ON = otel.init_telemetry("my-service")
    with otel.span("GET /health", kind="server") as sp:
        otel.set_tenant(request.headers.get("X-Tenant-Id"))
        ...
    otel.record_request("GET", "/health", 200, duration_s)
"""

import contextlib
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger("remitflow.otel")

OTEL_AVAILABLE = False
_initialized = False

# Real OTel symbols (None when the SDK is absent).
_trace = None
_metrics = None
_trace_mod = None  # opentelemetry.trace (for SpanKind / get_current_span)

# Shared instruments, created once in init_telemetry().
_tracer = None
_meter = None
_request_counter = None
_request_duration = None

try:  # ── guarded optional import ────────────────────────────────────────────
    from opentelemetry import metrics as _otel_metrics
    from opentelemetry import trace as _otel_trace
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
        OTLPMetricExporter,
    )
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
        OTLPSpanExporter,
    )
    from opentelemetry.propagate import set_global_textmap
    from opentelemetry.propagators.composite import CompositePropagator
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.trace.propagation.tracecontext import (
        TraceContextTextMapPropagator,
    )

    _trace = _otel_trace
    _metrics = _otel_metrics
    OTEL_AVAILABLE = True
except ImportError:  # pragma: no cover — depends on deployment environment
    OTLPMetricExporter = None  # type: ignore
    OTLPSpanExporter = None  # type: ignore
    set_global_textmap = None  # type: ignore
    CompositePropagator = None  # type: ignore
    MeterProvider = None  # type: ignore
    PeriodicExportingMetricReader = None  # type: ignore
    Resource = None  # type: ignore
    TracerProvider = None  # type: ignore
    BatchSpanProcessor = None  # type: ignore
    TraceContextTextMapPropagator = None  # type: ignore


# ─── initialization ───────────────────────────────────────────────────────────

def init_telemetry(service_name: str, service_version: str = "1.0.0") -> bool:
    """
    Initialize OTel tracing + metrics for the service.

    Returns True only when the SDK is installed AND the providers were really
    configured. On any failure (missing SDK, exporter misconfiguration, ...)
    logs one warning and returns False — the service keeps running normally.
    Idempotent: a second successful call returns True without reconfiguring.
    """
    global _initialized, _tracer, _meter, _request_counter, _request_duration

    if _initialized:
        return True
    if not OTEL_AVAILABLE:
        logger.warning(
            "[otel] opentelemetry packages not installed; telemetry DISABLED "
            "(fail-soft: service runs normally, no spans/metrics are emitted)"
        )
        return False

    try:
        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318").rstrip("/")
        environment = os.getenv("DEPLOYMENT_ENVIRONMENT") or os.getenv("ENVIRONMENT") or "development"

        resource = Resource.create({
            "service.name": service_name,
            "service.version": service_version,
            "deployment.environment": environment,
        })

        tracer_provider = TracerProvider(resource=resource)
        tracer_provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
        )
        _trace.set_tracer_provider(tracer_provider)

        meter_provider = MeterProvider(
            resource=resource,
            metric_readers=[
                PeriodicExportingMetricReader(
                    OTLPMetricExporter(endpoint=f"{endpoint}/v1/metrics")
                )
            ],
        )
        _metrics.set_meter_provider(meter_provider)

        set_global_textmap(CompositePropagator([TraceContextTextMapPropagator()]))

        _tracer = _trace.get_tracer(service_name, service_version)
        _meter = _metrics.get_meter(service_name, service_version)
        _request_counter = _meter.create_counter(
            "http.server.requests",
            description="Total HTTP requests handled by the service",
            unit="{request}",
        )
        _request_duration = _meter.create_histogram(
            "http.server.request.duration",
            description="HTTP request handling duration",
            unit="s",
        )
        _initialized = True
        logger.info(
            f"[otel] telemetry ENABLED for {service_name} v{service_version} "
            f"(env={environment}, endpoint={endpoint})"
        )
        return True
    except Exception as exc:  # never let telemetry break the service
        logger.warning(f"[otel] initialization failed; telemetry DISABLED ({exc})")
        _tracer = _meter = _request_counter = _request_duration = None
        return False


def telemetry_status() -> str:
    """Honest status string for /health payloads."""
    return "enabled" if _initialized else "disabled-no-sdk"


def get_tracer(name: str):
    """Return a real tracer when initialized, else None (never raises)."""
    try:
        if OTEL_AVAILABLE and _initialized:
            return _trace.get_tracer(name)
    except Exception:
        pass
    return None


def get_meter(name: str):
    """Return a real meter when initialized, else None (never raises)."""
    try:
        if OTEL_AVAILABLE and _initialized:
            return _metrics.get_meter(name)
    except Exception:
        pass
    return None


# ─── spans ────────────────────────────────────────────────────────────────────

def _span_kind(kind: Optional[str]):
    """Map a friendly kind string to trace.SpanKind; default INTERNAL."""
    try:
        sk = _trace.SpanKind
        return {
            "server": sk.SERVER,
            "client": sk.CLIENT,
            "producer": sk.PRODUCER,
            "consumer": sk.CONSUMER,
            "internal": sk.INTERNAL,
        }.get(str(kind or "internal").lower(), sk.INTERNAL)
    except Exception:
        return None


@contextlib.contextmanager
def span(name: str, attributes: Optional[Dict[str, Any]] = None, kind: Optional[str] = None):
    """
    Context manager yielding the active span (or None when telemetry is off).

    Safe no-op without the SDK or before init_telemetry(). Exceptions raised by
    the wrapped block still propagate (and are recorded on the span when the
    SDK is active); only telemetry-internal failures are swallowed.
    """
    if not (OTEL_AVAILABLE and _initialized):
        yield None
        return
    try:
        tracer = _tracer or _trace.get_tracer("remitflow")
        ctx = tracer.start_as_current_span(
            name, attributes=_sanitize_attrs(attributes), kind=_span_kind(kind)
        )
    except Exception:
        yield None
        return
    with ctx as active_span:
        yield active_span


def set_span_attributes(active_span: Any, attributes: Optional[Dict[str, Any]]) -> None:
    """Set attributes on a span yielded by ``span()``; no-op on None/errors."""
    if active_span is None or not attributes:
        return
    try:
        for key, value in _sanitize_attrs(attributes).items():
            active_span.set_attribute(key, value)
    except Exception:
        pass


def set_tenant(tenant_id: Any) -> None:
    """Set ``tenant.id`` on the current active span; no-op when off/absent."""
    if not (OTEL_AVAILABLE and _initialized) or tenant_id is None or tenant_id == "":
        return
    try:
        current = _trace.get_current_span()
        if current is not None:
            current.set_attribute("tenant.id", str(tenant_id))
    except Exception:
        pass


# ─── metrics ──────────────────────────────────────────────────────────────────

def record_request(
    method: str,
    route: str,
    status_code: int,
    duration_seconds: float,
    attributes: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Record one handled HTTP request on the shared counter + duration histogram.
    No-op when telemetry is disabled; never raises.
    """
    if not (OTEL_AVAILABLE and _initialized):
        return
    try:
        attrs: Dict[str, Any] = {
            "http.request.method": str(method),
            "http.route": str(route),
            "http.response.status_code": int(status_code),
        }
        if attributes:
            attrs.update(_sanitize_attrs(attributes))
        if _request_counter is not None:
            _request_counter.add(1, attrs)
        if _request_duration is not None:
            _request_duration.record(max(0.0, float(duration_seconds)), attrs)
    except Exception:
        pass


def shutdown_telemetry() -> None:
    """Best-effort flush/shutdown of providers; safe to call anytime."""
    global _initialized
    if not (OTEL_AVAILABLE and _initialized):
        return
    try:
        provider = _trace.get_tracer_provider()
        if hasattr(provider, "shutdown"):
            provider.shutdown()
    except Exception:
        pass
    try:
        provider = _metrics.get_meter_provider()
        if hasattr(provider, "shutdown"):
            provider.shutdown()
    except Exception:
        pass
    _initialized = False


# ─── internals ────────────────────────────────────────────────────────────────

def _sanitize_attrs(attributes: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Drop None values and coerce to OTel-acceptable primitives."""
    out: Dict[str, Any] = {}
    if not attributes:
        return out
    for key, value in attributes.items():
        if value is None:
            continue
        if isinstance(value, (bool, int, float, str)):
            out[str(key)] = value
        else:
            out[str(key)] = str(value)
    return out
