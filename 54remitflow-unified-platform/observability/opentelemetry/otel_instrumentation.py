"""
OpenTelemetry Standardization for Remittance Platform
Unified traces, metrics, and log correlation across all Go/Python services
"""

import os
import logging
import functools
import time
from typing import Optional, Dict, Any, Callable
from contextlib import contextmanager
from dataclasses import dataclass

from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource, SERVICE_NAME, SERVICE_VERSION, DEPLOYMENT_ENVIRONMENT
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.aiohttp_client import AioHttpClientInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.b3 import B3MultiFormat
from opentelemetry.trace import Status, StatusCode, SpanKind
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.propagators.composite import CompositePropagator

logger = logging.getLogger(__name__)


@dataclass
class OTelConfig:
    """OpenTelemetry configuration"""
    service_name: str = os.getenv("SERVICE_NAME", "remittance-service")
    service_version: str = os.getenv("SERVICE_VERSION", "1.0.0")
    environment: str = os.getenv("DEPLOYMENT_ENVIRONMENT", "development")
    
    # OTLP endpoints
    otlp_endpoint: str = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4317")
    otlp_traces_endpoint: str = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "")
    otlp_metrics_endpoint: str = os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "")
    
    # Sampling
    trace_sample_rate: float = float(os.getenv("OTEL_TRACE_SAMPLE_RATE", "1.0"))
    
    # Export intervals
    metrics_export_interval_ms: int = int(os.getenv("OTEL_METRICS_EXPORT_INTERVAL_MS", "60000"))
    
    # Headers for authentication
    otlp_headers: Dict[str, str] = None
    
    def __post_init__(self):
        if self.otlp_headers is None:
            headers_str = os.getenv("OTEL_EXPORTER_OTLP_HEADERS", "")
            self.otlp_headers = {}
            if headers_str:
                for pair in headers_str.split(","):
                    if "=" in pair:
                        key, value = pair.split("=", 1)
                        self.otlp_headers[key.strip()] = value.strip()


class OTelInstrumentation:
    """
    OpenTelemetry instrumentation manager for the Remittance Platform.
    Provides unified tracing, metrics, and logging across all services.
    """
    
    _instance: Optional['OTelInstrumentation'] = None
    _initialized: bool = False
    
    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self, config: Optional[OTelConfig] = None):
        if self._initialized:
            return
        
        self.config = config or OTelConfig()
        self._tracer: Optional[trace.Tracer] = None
        self._meter: Optional[metrics.Meter] = None
        self._metrics: Dict[str, Any] = {}
        
        self._setup_resource()
        self._setup_tracing()
        self._setup_metrics()
        self._setup_propagation()
        self._instrument_libraries()
        self._setup_logging()
        
        self._initialized = True
        logger.info(f"OpenTelemetry initialized for {self.config.service_name}")
    
    def _setup_resource(self):
        """Setup OpenTelemetry resource with service information"""
        self.resource = Resource.create({
            SERVICE_NAME: self.config.service_name,
            SERVICE_VERSION: self.config.service_version,
            DEPLOYMENT_ENVIRONMENT: self.config.environment,
            "service.namespace": "remittance",
            "host.name": os.getenv("HOSTNAME", "unknown"),
        })
    
    def _setup_tracing(self):
        """Setup distributed tracing"""
        # Create tracer provider
        tracer_provider = TracerProvider(resource=self.resource)
        
        # Configure OTLP exporter
        endpoint = self.config.otlp_traces_endpoint or self.config.otlp_endpoint
        otlp_exporter = OTLPSpanExporter(
            endpoint=endpoint,
            headers=self.config.otlp_headers or {}
        )
        
        # Add batch processor
        tracer_provider.add_span_processor(
            BatchSpanProcessor(otlp_exporter)
        )
        
        # Set global tracer provider
        trace.set_tracer_provider(tracer_provider)
        
        # Get tracer
        self._tracer = trace.get_tracer(
            self.config.service_name,
            self.config.service_version
        )
    
    def _setup_metrics(self):
        """Setup metrics collection"""
        # Configure OTLP metric exporter
        endpoint = self.config.otlp_metrics_endpoint or self.config.otlp_endpoint
        otlp_exporter = OTLPMetricExporter(
            endpoint=endpoint,
            headers=self.config.otlp_headers or {}
        )
        
        # Create metric reader
        metric_reader = PeriodicExportingMetricReader(
            otlp_exporter,
            export_interval_millis=self.config.metrics_export_interval_ms
        )
        
        # Create meter provider
        meter_provider = MeterProvider(
            resource=self.resource,
            metric_readers=[metric_reader]
        )
        
        # Set global meter provider
        metrics.set_meter_provider(meter_provider)
        
        # Get meter
        self._meter = metrics.get_meter(
            self.config.service_name,
            self.config.service_version
        )
        
        # Create standard metrics
        self._create_standard_metrics()
    
    def _create_standard_metrics(self):
        """Create standard metrics for the platform"""
        # Request metrics
        self._metrics["request_counter"] = self._meter.create_counter(
            "http_requests_total",
            description="Total HTTP requests",
            unit="1"
        )
        
        self._metrics["request_duration"] = self._meter.create_histogram(
            "http_request_duration_seconds",
            description="HTTP request duration in seconds",
            unit="s"
        )
        
        # Transaction metrics
        self._metrics["transaction_counter"] = self._meter.create_counter(
            "transactions_total",
            description="Total transactions processed",
            unit="1"
        )
        
        self._metrics["transaction_amount"] = self._meter.create_histogram(
            "transaction_amount",
            description="Transaction amounts",
            unit="currency"
        )
        
        self._metrics["transaction_duration"] = self._meter.create_histogram(
            "transaction_duration_seconds",
            description="Transaction processing duration",
            unit="s"
        )
        
        # Agent metrics
        self._metrics["active_agents"] = self._meter.create_up_down_counter(
            "active_agents",
            description="Number of active agents",
            unit="1"
        )
        
        # Error metrics
        self._metrics["error_counter"] = self._meter.create_counter(
            "errors_total",
            description="Total errors",
            unit="1"
        )
        
        # TigerBeetle metrics
        self._metrics["tigerbeetle_operations"] = self._meter.create_counter(
            "tigerbeetle_operations_total",
            description="TigerBeetle operations",
            unit="1"
        )
        
        self._metrics["tigerbeetle_latency"] = self._meter.create_histogram(
            "tigerbeetle_operation_duration_seconds",
            description="TigerBeetle operation latency",
            unit="s"
        )
        
        # Sync metrics
        self._metrics["sync_events"] = self._meter.create_counter(
            "sync_events_total",
            description="Sync events processed",
            unit="1"
        )
        
        self._metrics["sync_lag"] = self._meter.create_histogram(
            "sync_lag_seconds",
            description="Sync lag in seconds",
            unit="s"
        )
    
    def _setup_propagation(self):
        """Setup context propagation"""
        # Use composite propagator for compatibility
        propagator = CompositePropagator([
            TraceContextTextMapPropagator(),
            W3CBaggagePropagator(),
            B3MultiFormat()
        ])
        set_global_textmap(propagator)
    
    def _instrument_libraries(self):
        """Instrument common libraries"""
        try:
            RequestsInstrumentor().instrument()
        except Exception as e:
            logger.debug(f"Could not instrument requests: {e}")
        
        try:
            AioHttpClientInstrumentor().instrument()
        except Exception as e:
            logger.debug(f"Could not instrument aiohttp: {e}")
        
        try:
            AsyncPGInstrumentor().instrument()
        except Exception as e:
            logger.debug(f"Could not instrument asyncpg: {e}")
        
        try:
            RedisInstrumentor().instrument()
        except Exception as e:
            logger.debug(f"Could not instrument redis: {e}")
    
    def _setup_logging(self):
        """Setup log correlation with traces"""
        try:
            LoggingInstrumentor().instrument(set_logging_format=True)
        except Exception as e:
            logger.debug(f"Could not instrument logging: {e}")
        
        # Add trace context to log records
        old_factory = logging.getLogRecordFactory()
        
        def record_factory(*args, **kwargs):
            record = old_factory(*args, **kwargs)
            span = trace.get_current_span()
            if span:
                ctx = span.get_span_context()
                record.trace_id = format(ctx.trace_id, '032x')
                record.span_id = format(ctx.span_id, '016x')
            else:
                record.trace_id = "0" * 32
                record.span_id = "0" * 16
            return record
        
        logging.setLogRecordFactory(record_factory)
    
    @property
    def tracer(self) -> trace.Tracer:
        """Get the tracer"""
        return self._tracer
    
    @property
    def meter(self) -> metrics.Meter:
        """Get the meter"""
        return self._meter
    
    def get_metric(self, name: str) -> Any:
        """Get a metric by name"""
        return self._metrics.get(name)
    
    @contextmanager
    def span(
        self,
        name: str,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Optional[Dict[str, Any]] = None
    ):
        """Create a span context manager"""
        with self._tracer.start_as_current_span(
            name,
            kind=kind,
            attributes=attributes or {}
        ) as span:
            try:
                yield span
            except Exception as e:
                span.set_status(Status(StatusCode.ERROR, str(e)))
                span.record_exception(e)
                raise
    
    def trace(
        self,
        name: Optional[str] = None,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Optional[Dict[str, Any]] = None
    ):
        """Decorator to trace a function"""
        def decorator(func: Callable):
            span_name = name or f"{func.__module__}.{func.__name__}"
            
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                with self.span(span_name, kind, attributes):
                    return await func(*args, **kwargs)
            
            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs):
                with self.span(span_name, kind, attributes):
                    return func(*args, **kwargs)
            
            if asyncio.iscoroutinefunction(func):
                return async_wrapper
            return sync_wrapper
        
        return decorator
    
    def record_transaction(
        self,
        transaction_type: str,
        amount: float,
        currency: str,
        status: str,
        duration_seconds: float,
        agent_id: Optional[str] = None,
        customer_id: Optional[str] = None
    ):
        """Record transaction metrics"""
        attributes = {
            "transaction.type": transaction_type,
            "transaction.currency": currency,
            "transaction.status": status
        }
        if agent_id:
            attributes["agent.id"] = agent_id
        if customer_id:
            attributes["customer.id"] = customer_id
        
        self._metrics["transaction_counter"].add(1, attributes)
        self._metrics["transaction_amount"].record(amount, attributes)
        self._metrics["transaction_duration"].record(duration_seconds, attributes)
    
    def record_error(
        self,
        error_type: str,
        error_message: str,
        service: Optional[str] = None
    ):
        """Record error metrics"""
        attributes = {
            "error.type": error_type,
            "error.message": error_message[:100],  # Truncate long messages
            "service.name": service or self.config.service_name
        }
        self._metrics["error_counter"].add(1, attributes)
    
    def record_tigerbeetle_operation(
        self,
        operation: str,
        duration_seconds: float,
        success: bool
    ):
        """Record TigerBeetle operation metrics"""
        attributes = {
            "operation": operation,
            "success": str(success)
        }
        self._metrics["tigerbeetle_operations"].add(1, attributes)
        self._metrics["tigerbeetle_latency"].record(duration_seconds, attributes)
    
    def record_sync_event(
        self,
        source: str,
        destination: str,
        event_type: str,
        lag_seconds: float
    ):
        """Record sync event metrics"""
        attributes = {
            "sync.source": source,
            "sync.destination": destination,
            "sync.event_type": event_type
        }
        self._metrics["sync_events"].add(1, attributes)
        self._metrics["sync_lag"].record(lag_seconds, attributes)


# Import asyncio for decorator
import asyncio


# FastAPI middleware
class OTelMiddleware:
    """FastAPI middleware for OpenTelemetry"""
    
    def __init__(self, app, otel: OTelInstrumentation):
        self.app = app
        self.otel = otel
    
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        
        path = scope.get("path", "")
        method = scope.get("method", "")
        
        # Skip health checks
        if path in ("/health", "/metrics", "/ready"):
            await self.app(scope, receive, send)
            return
        
        start_time = time.time()
        status_code = 500
        
        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)
        
        with self.otel.span(
            f"{method} {path}",
            kind=SpanKind.SERVER,
            attributes={
                "http.method": method,
                "http.url": path,
                "http.scheme": scope.get("scheme", "http"),
            }
        ) as span:
            try:
                await self.app(scope, receive, send_wrapper)
                span.set_attribute("http.status_code", status_code)
            except Exception as e:
                span.set_status(Status(StatusCode.ERROR, str(e)))
                raise
            finally:
                duration = time.time() - start_time
                self.otel.get_metric("request_counter").add(1, {
                    "http.method": method,
                    "http.route": path,
                    "http.status_code": str(status_code)
                })
                self.otel.get_metric("request_duration").record(duration, {
                    "http.method": method,
                    "http.route": path
                })


# Global instance
_otel: Optional[OTelInstrumentation] = None


def init_otel(config: Optional[OTelConfig] = None) -> OTelInstrumentation:
    """Initialize OpenTelemetry instrumentation"""
    global _otel
    if _otel is None:
        _otel = OTelInstrumentation(config)
    return _otel


def get_otel() -> OTelInstrumentation:
    """Get the OpenTelemetry instrumentation instance"""
    global _otel
    if _otel is None:
        _otel = OTelInstrumentation()
    return _otel


def get_tracer() -> trace.Tracer:
    """Get the tracer"""
    return get_otel().tracer


def get_meter() -> metrics.Meter:
    """Get the meter"""
    return get_otel().meter


# Convenience decorators
def traced(name: Optional[str] = None, kind: SpanKind = SpanKind.INTERNAL):
    """Decorator to trace a function"""
    return get_otel().trace(name, kind)


# Example usage
if __name__ == "__main__":
    # Initialize OpenTelemetry
    otel = init_otel(OTelConfig(
        service_name="example-service",
        environment="development"
    ))
    
    # Use tracing
    @traced("example_operation")
    def example_function():
        with otel.span("sub_operation"):
            time.sleep(0.1)
        return "done"
    
    result = example_function()
    print(f"Result: {result}")
    
    # Record metrics
    otel.record_transaction(
        transaction_type="cash_in",
        amount=1000.0,
        currency="KES",
        status="completed",
        duration_seconds=0.5,
        agent_id="AGT-001"
    )
