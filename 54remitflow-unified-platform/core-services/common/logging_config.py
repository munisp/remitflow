"""
Structured Logging Configuration for All Services

Provides:
- JSON-formatted logs for production
- Correlation ID tracking across requests
- Consistent log format across all services
- Request/response logging middleware
"""

import os
import sys
import json
import uuid
import logging
import time
from datetime import datetime
from typing import Optional, Dict, Any
from contextvars import ContextVar
from functools import wraps
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# Context variable for correlation ID
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")
request_context_var: ContextVar[Dict[str, Any]] = ContextVar("request_context", default={})


class StructuredLogFormatter(logging.Formatter):
    """
    JSON log formatter for structured logging.
    Includes correlation ID, service name, and other context.
    """
    
    def __init__(self, service_name: str = "unknown"):
        super().__init__()
        self.service_name = service_name
        self.environment = os.getenv("ENVIRONMENT", "development")
        self.hostname = os.getenv("HOSTNAME", "localhost")
    
    def format(self, record: logging.LogRecord) -> str:
        correlation_id = correlation_id_var.get()
        request_context = request_context_var.get()
        
        log_entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "service": self.service_name,
            "environment": self.environment,
            "hostname": self.hostname,
            "logger": record.name,
            "message": record.getMessage(),
            "correlation_id": correlation_id or None,
        }
        
        # Add request context if available
        if request_context:
            log_entry["request"] = {
                "method": request_context.get("method"),
                "path": request_context.get("path"),
                "user_id": request_context.get("user_id"),
                "client_ip": request_context.get("client_ip"),
            }
        
        # Add exception info if present
        if record.exc_info:
            log_entry["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
                "traceback": self.formatException(record.exc_info)
            }
        
        # Add extra fields
        if hasattr(record, "extra_fields"):
            log_entry["extra"] = record.extra_fields
        
        return json.dumps(log_entry)


class HumanReadableFormatter(logging.Formatter):
    """
    Human-readable log formatter for development.
    """
    
    def __init__(self, service_name: str = "unknown"):
        super().__init__()
        self.service_name = service_name
    
    def format(self, record: logging.LogRecord) -> str:
        correlation_id = correlation_id_var.get()
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        
        correlation_str = f"[{correlation_id[:8]}]" if correlation_id else ""
        
        message = f"{timestamp} | {record.levelname:8} | {self.service_name} | {record.name} {correlation_str} | {record.getMessage()}"
        
        if record.exc_info:
            message += f"\n{self.formatException(record.exc_info)}"
        
        return message


class ContextLogger(logging.LoggerAdapter):
    """
    Logger adapter that automatically includes context in log messages.
    """
    
    def process(self, msg, kwargs):
        # Add extra fields to the record
        extra = kwargs.get("extra", {})
        extra["extra_fields"] = self.extra
        kwargs["extra"] = extra
        return msg, kwargs


def setup_logging(
    service_name: str,
    log_level: str = None,
    json_format: bool = None
) -> logging.Logger:
    """
    Set up logging for a service.
    
    Args:
        service_name: Name of the service
        log_level: Log level (default: from LOG_LEVEL env var or INFO)
        json_format: Use JSON format (default: from LOG_FORMAT env var or based on environment)
        
    Returns:
        Configured logger
    """
    # Determine log level
    if log_level is None:
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    
    # Determine format
    if json_format is None:
        log_format = os.getenv("LOG_FORMAT", "auto").lower()
        if log_format == "auto":
            json_format = os.getenv("ENVIRONMENT", "development") == "production"
        else:
            json_format = log_format == "json"
    
    # Create formatter
    if json_format:
        formatter = StructuredLogFormatter(service_name)
    else:
        formatter = HumanReadableFormatter(service_name)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level, logging.INFO))
    
    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Add console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Reduce noise from third-party libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("aiohttp").setLevel(logging.WARNING)
    
    # Return service logger
    return logging.getLogger(service_name)


def get_correlation_id() -> str:
    """Get the current correlation ID"""
    return correlation_id_var.get()


def set_correlation_id(correlation_id: str) -> None:
    """Set the correlation ID for the current context"""
    correlation_id_var.set(correlation_id)


def generate_correlation_id() -> str:
    """Generate a new correlation ID"""
    return str(uuid.uuid4())


def with_correlation_id(func):
    """
    Decorator to ensure a correlation ID exists for the function execution.
    """
    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        if not correlation_id_var.get():
            correlation_id_var.set(generate_correlation_id())
        return await func(*args, **kwargs)
    
    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        if not correlation_id_var.get():
            correlation_id_var.set(generate_correlation_id())
        return func(*args, **kwargs)
    
    import asyncio
    if asyncio.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware for request/response logging with correlation IDs.
    
    Usage:
        app = FastAPI()
        app.add_middleware(LoggingMiddleware, service_name="my-service")
    """
    
    def __init__(self, app, service_name: str = "unknown"):
        super().__init__(app)
        self.service_name = service_name
        self.logger = logging.getLogger(f"{service_name}.http")
    
    async def dispatch(self, request: Request, call_next):
        # Get or generate correlation ID
        correlation_id = request.headers.get("X-Correlation-ID")
        if not correlation_id:
            correlation_id = request.headers.get("X-Request-ID")
        if not correlation_id:
            correlation_id = generate_correlation_id()
        
        # Set correlation ID in context
        correlation_id_var.set(correlation_id)
        
        # Set request context
        request_context = {
            "method": request.method,
            "path": request.url.path,
            "client_ip": self._get_client_ip(request),
            "user_id": None,  # Will be set by auth middleware if available
        }
        request_context_var.set(request_context)
        
        # Log request
        start_time = time.time()
        self.logger.info(
            f"Request started: {request.method} {request.url.path}",
            extra={"extra_fields": {
                "query_params": str(request.query_params),
                "user_agent": request.headers.get("User-Agent"),
            }}
        )
        
        try:
            # Process request
            response = await call_next(request)
            
            # Calculate duration
            duration_ms = (time.time() - start_time) * 1000
            
            # Log response
            log_level = logging.INFO if response.status_code < 400 else logging.WARNING
            if response.status_code >= 500:
                log_level = logging.ERROR
            
            self.logger.log(
                log_level,
                f"Request completed: {request.method} {request.url.path} - {response.status_code}",
                extra={"extra_fields": {
                    "status_code": response.status_code,
                    "duration_ms": round(duration_ms, 2),
                }}
            )
            
            # Add correlation ID to response headers
            response.headers["X-Correlation-ID"] = correlation_id
            response.headers["X-Request-Duration-Ms"] = str(round(duration_ms, 2))
            
            return response
            
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            self.logger.exception(
                f"Request failed: {request.method} {request.url.path}",
                extra={"extra_fields": {
                    "duration_ms": round(duration_ms, 2),
                    "error": str(e),
                }}
            )
            raise
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request"""
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip
        
        return request.client.host if request.client else "unknown"


def log_with_context(
    logger: logging.Logger,
    level: int,
    message: str,
    **extra_fields
) -> None:
    """
    Log a message with additional context fields.
    
    Usage:
        log_with_context(logger, logging.INFO, "User created", user_id="123", email="user@example.com")
    """
    logger.log(level, message, extra={"extra_fields": extra_fields})


# Convenience functions for common log patterns
def log_transaction(
    logger: logging.Logger,
    transaction_id: str,
    action: str,
    status: str,
    **extra_fields
) -> None:
    """Log a transaction event"""
    log_with_context(
        logger,
        logging.INFO,
        f"Transaction {action}: {transaction_id} - {status}",
        transaction_id=transaction_id,
        action=action,
        status=status,
        **extra_fields
    )


def log_compliance_event(
    logger: logging.Logger,
    event_type: str,
    entity_id: str,
    result: str,
    **extra_fields
) -> None:
    """Log a compliance event"""
    log_with_context(
        logger,
        logging.INFO,
        f"Compliance {event_type}: {entity_id} - {result}",
        event_type=event_type,
        entity_id=entity_id,
        result=result,
        **extra_fields
    )


def log_external_call(
    logger: logging.Logger,
    service: str,
    endpoint: str,
    status_code: int,
    duration_ms: float,
    **extra_fields
) -> None:
    """Log an external service call"""
    level = logging.INFO if status_code < 400 else logging.WARNING
    if status_code >= 500:
        level = logging.ERROR
    
    log_with_context(
        logger,
        level,
        f"External call to {service}: {endpoint} - {status_code} ({duration_ms:.2f}ms)",
        external_service=service,
        endpoint=endpoint,
        status_code=status_code,
        duration_ms=duration_ms,
        **extra_fields
    )
