"""
End-to-End Observability - Correlation ID Middleware
Propagates correlation IDs through APISIX -> services -> Kafka/Dapr/Temporal
"""

import os
import uuid
import logging
import contextvars
from typing import Optional, Dict, Any, Callable
from functools import wraps
from datetime import datetime, timezone

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# Context variable for correlation ID
correlation_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("correlation_id", default="")
trace_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("trace_id", default="")
span_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("span_id", default="")
parent_span_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("parent_span_id", default="")

# Header names
CORRELATION_ID_HEADER = "X-Correlation-ID"
TRACE_ID_HEADER = "X-Trace-ID"
SPAN_ID_HEADER = "X-Span-ID"
PARENT_SPAN_ID_HEADER = "X-Parent-Span-ID"
REQUEST_ID_HEADER = "X-Request-ID"

# OpenTelemetry compatible headers
TRACEPARENT_HEADER = "traceparent"
TRACESTATE_HEADER = "tracestate"


def generate_id() -> str:
    """Generate a unique ID"""
    return uuid.uuid4().hex


def get_correlation_id() -> str:
    """Get current correlation ID"""
    return correlation_id_var.get() or generate_id()


def get_trace_id() -> str:
    """Get current trace ID"""
    return trace_id_var.get() or generate_id()


def get_span_id() -> str:
    """Get current span ID"""
    return span_id_var.get() or generate_id()


def set_correlation_context(
    correlation_id: str,
    trace_id: str = None,
    span_id: str = None,
    parent_span_id: str = None
):
    """Set correlation context"""
    correlation_id_var.set(correlation_id)
    if trace_id:
        trace_id_var.set(trace_id)
    if span_id:
        span_id_var.set(span_id)
    if parent_span_id:
        parent_span_id_var.set(parent_span_id)


def get_correlation_headers() -> Dict[str, str]:
    """Get headers for propagating correlation context"""
    headers = {
        CORRELATION_ID_HEADER: get_correlation_id(),
        TRACE_ID_HEADER: get_trace_id(),
        SPAN_ID_HEADER: get_span_id(),
    }
    
    parent_span = parent_span_id_var.get()
    if parent_span:
        headers[PARENT_SPAN_ID_HEADER] = parent_span
    
    # Add OpenTelemetry traceparent header
    trace_id = get_trace_id()
    span_id = get_span_id()
    headers[TRACEPARENT_HEADER] = f"00-{trace_id}-{span_id[:16]}-01"
    
    return headers


class CorrelationMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware for correlation ID propagation.
    Extracts correlation ID from incoming requests or generates new one.
    """
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Extract or generate correlation ID
        correlation_id = (
            request.headers.get(CORRELATION_ID_HEADER) or
            request.headers.get(REQUEST_ID_HEADER) or
            generate_id()
        )
        
        # Extract trace context
        trace_id = request.headers.get(TRACE_ID_HEADER)
        span_id = request.headers.get(SPAN_ID_HEADER)
        parent_span_id = request.headers.get(PARENT_SPAN_ID_HEADER)
        
        # Parse traceparent if present
        traceparent = request.headers.get(TRACEPARENT_HEADER)
        if traceparent and not trace_id:
            parts = traceparent.split("-")
            if len(parts) >= 3:
                trace_id = parts[1]
                parent_span_id = parts[2]
        
        # Generate new span ID for this request
        new_span_id = generate_id()[:16]
        
        # Set context
        set_correlation_context(
            correlation_id=correlation_id,
            trace_id=trace_id or generate_id(),
            span_id=new_span_id,
            parent_span_id=span_id or parent_span_id
        )
        
        # Add to request state for access in handlers
        request.state.correlation_id = correlation_id
        request.state.trace_id = trace_id_var.get()
        request.state.span_id = new_span_id
        
        # Log request with correlation
        logger.info(
            f"Request started",
            extra={
                "correlation_id": correlation_id,
                "trace_id": trace_id_var.get(),
                "span_id": new_span_id,
                "method": request.method,
                "path": request.url.path
            }
        )
        
        # Process request
        start_time = datetime.now(timezone.utc)
        response = await call_next(request)
        duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
        
        # Add correlation headers to response
        response.headers[CORRELATION_ID_HEADER] = correlation_id
        response.headers[TRACE_ID_HEADER] = trace_id_var.get()
        response.headers[SPAN_ID_HEADER] = new_span_id
        
        # Log response
        logger.info(
            f"Request completed",
            extra={
                "correlation_id": correlation_id,
                "trace_id": trace_id_var.get(),
                "span_id": new_span_id,
                "status_code": response.status_code,
                "duration_ms": duration_ms
            }
        )
        
        return response


class CorrelatedLogger(logging.LoggerAdapter):
    """Logger adapter that automatically includes correlation context"""
    
    def process(self, msg, kwargs):
        extra = kwargs.get("extra", {})
        extra["correlation_id"] = get_correlation_id()
        extra["trace_id"] = get_trace_id()
        extra["span_id"] = get_span_id()
        kwargs["extra"] = extra
        return msg, kwargs


def get_correlated_logger(name: str) -> CorrelatedLogger:
    """Get a logger that includes correlation context"""
    return CorrelatedLogger(logging.getLogger(name), {})


def with_correlation(func: Callable) -> Callable:
    """Decorator to propagate correlation context in async functions"""
    @wraps(func)
    async def wrapper(*args, **kwargs):
        # Preserve current context
        correlation_id = get_correlation_id()
        trace_id = get_trace_id()
        span_id = get_span_id()
        
        # Create new span for this function
        new_span_id = generate_id()[:16]
        set_correlation_context(
            correlation_id=correlation_id,
            trace_id=trace_id,
            span_id=new_span_id,
            parent_span_id=span_id
        )
        
        return await func(*args, **kwargs)
    
    return wrapper


class KafkaCorrelationMixin:
    """Mixin for Kafka producers/consumers to propagate correlation"""
    
    def add_correlation_headers(self, headers: list = None) -> list:
        """Add correlation headers to Kafka message"""
        headers = headers or []
        correlation_headers = get_correlation_headers()
        
        for key, value in correlation_headers.items():
            headers.append((key, value.encode() if isinstance(value, str) else value))
        
        return headers
    
    def extract_correlation_from_headers(self, headers: list):
        """Extract correlation context from Kafka message headers"""
        header_dict = {k: v.decode() if isinstance(v, bytes) else v for k, v in (headers or [])}
        
        correlation_id = header_dict.get(CORRELATION_ID_HEADER, generate_id())
        trace_id = header_dict.get(TRACE_ID_HEADER)
        span_id = header_dict.get(SPAN_ID_HEADER)
        
        set_correlation_context(
            correlation_id=correlation_id,
            trace_id=trace_id or generate_id(),
            span_id=generate_id()[:16],
            parent_span_id=span_id
        )


class DaprCorrelationMixin:
    """Mixin for Dapr clients to propagate correlation"""
    
    def get_dapr_metadata(self) -> Dict[str, str]:
        """Get metadata for Dapr invocation"""
        return {
            "correlation-id": get_correlation_id(),
            "trace-id": get_trace_id(),
            "span-id": get_span_id(),
        }
    
    def extract_correlation_from_metadata(self, metadata: Dict[str, str]):
        """Extract correlation context from Dapr metadata"""
        correlation_id = metadata.get("correlation-id", generate_id())
        trace_id = metadata.get("trace-id")
        span_id = metadata.get("span-id")
        
        set_correlation_context(
            correlation_id=correlation_id,
            trace_id=trace_id or generate_id(),
            span_id=generate_id()[:16],
            parent_span_id=span_id
        )


class TemporalCorrelationMixin:
    """Mixin for Temporal workflows to propagate correlation"""
    
    def get_workflow_headers(self) -> Dict[str, str]:
        """Get headers for Temporal workflow"""
        return get_correlation_headers()
    
    def set_workflow_context(self, headers: Dict[str, str]):
        """Set correlation context from workflow headers"""
        correlation_id = headers.get(CORRELATION_ID_HEADER, generate_id())
        trace_id = headers.get(TRACE_ID_HEADER)
        span_id = headers.get(SPAN_ID_HEADER)
        
        set_correlation_context(
            correlation_id=correlation_id,
            trace_id=trace_id or generate_id(),
            span_id=generate_id()[:16],
            parent_span_id=span_id
        )


# APISIX plugin configuration for correlation ID injection
APISIX_CORRELATION_PLUGIN = """
-- APISIX Lua plugin for correlation ID injection
local core = require("apisix.core")
local uuid = require("resty.jit-uuid")

local plugin_name = "correlation-id"

local schema = {
    type = "object",
    properties = {
        header_name = {type = "string", default = "X-Correlation-ID"},
        include_in_response = {type = "boolean", default = true},
        echo_downstream = {type = "boolean", default = true},
    },
}

local _M = {
    version = 0.1,
    priority = 12000,
    name = plugin_name,
    schema = schema,
}

function _M.rewrite(conf, ctx)
    local correlation_id = core.request.header(ctx, conf.header_name)
    
    if not correlation_id or correlation_id == "" then
        correlation_id = uuid.generate_v4()
    end
    
    -- Set for downstream services
    core.request.set_header(ctx, conf.header_name, correlation_id)
    core.request.set_header(ctx, "X-Trace-ID", uuid.generate_v4())
    core.request.set_header(ctx, "X-Span-ID", string.sub(uuid.generate_v4(), 1, 16))
    
    -- Store for response
    ctx.correlation_id = correlation_id
end

function _M.header_filter(conf, ctx)
    if conf.include_in_response and ctx.correlation_id then
        core.response.set_header(conf.header_name, ctx.correlation_id)
    end
end

return _M
"""


def setup_logging_with_correlation():
    """Setup logging to include correlation context"""
    
    class CorrelationFilter(logging.Filter):
        def filter(self, record):
            record.correlation_id = get_correlation_id()
            record.trace_id = get_trace_id()
            record.span_id = get_span_id()
            return True
    
    # Add filter to root logger
    root_logger = logging.getLogger()
    root_logger.addFilter(CorrelationFilter())
    
    # Set format to include correlation
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - '
        '[correlation_id=%(correlation_id)s trace_id=%(trace_id)s span_id=%(span_id)s] - '
        '%(message)s'
    )
    
    for handler in root_logger.handlers:
        handler.setFormatter(formatter)
