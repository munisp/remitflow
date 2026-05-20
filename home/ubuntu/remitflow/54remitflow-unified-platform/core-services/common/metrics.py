"""
Prometheus Metrics Module for All Services
Provides HTTP request metrics, business metrics, and custom counters
"""

from prometheus_client import Counter, Histogram, Gauge, Info, generate_latest, CONTENT_TYPE_LATEST
from prometheus_client import CollectorRegistry, multiprocess, REGISTRY
from fastapi import FastAPI, Request, Response
from fastapi.routing import APIRoute
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse
import time
import os
import logging
from typing import Callable, Optional
from functools import wraps

logger = logging.getLogger(__name__)

# Default labels for all metrics
DEFAULT_LABELS = ["service", "environment"]

# Get service info from environment
SERVICE_NAME = os.getenv("SERVICE_NAME", "unknown")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")


# HTTP Request Metrics
http_requests_total = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["service", "method", "endpoint", "status_code"]
)

http_request_duration_seconds = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["service", "method", "endpoint"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)

http_requests_in_progress = Gauge(
    "http_requests_in_progress",
    "Number of HTTP requests in progress",
    ["service", "method", "endpoint"]
)

# Business Metrics
transactions_total = Counter(
    "transactions_total",
    "Total transactions processed",
    ["service", "type", "corridor", "status"]
)

transaction_amount_total = Counter(
    "transaction_amount_total",
    "Total transaction amount",
    ["service", "currency", "corridor"]
)

transaction_duration_seconds = Histogram(
    "transaction_duration_seconds",
    "Transaction processing duration",
    ["service", "type", "corridor"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0]
)

# Wallet Metrics
wallet_balance_total = Gauge(
    "wallet_balance_total",
    "Total wallet balance",
    ["service", "currency", "wallet_type"]
)

wallet_operations_total = Counter(
    "wallet_operations_total",
    "Total wallet operations",
    ["service", "operation", "status"]
)

# Risk/Compliance Metrics
risk_assessments_total = Counter(
    "risk_assessments_total",
    "Total risk assessments",
    ["service", "decision", "risk_level"]
)

compliance_checks_total = Counter(
    "compliance_checks_total",
    "Total compliance checks",
    ["service", "check_type", "result"]
)

# External Service Metrics
external_requests_total = Counter(
    "external_requests_total",
    "Total external service requests",
    ["service", "target_service", "status"]
)

external_request_duration_seconds = Histogram(
    "external_request_duration_seconds",
    "External service request duration",
    ["service", "target_service"],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
)

# Circuit Breaker Metrics
circuit_breaker_state = Gauge(
    "circuit_breaker_state",
    "Circuit breaker state (0=closed, 1=open, 2=half_open)",
    ["service", "target_service"]
)

circuit_breaker_failures_total = Counter(
    "circuit_breaker_failures_total",
    "Total circuit breaker failures",
    ["service", "target_service"]
)

# Database Metrics
db_connections_active = Gauge(
    "db_connections_active",
    "Active database connections",
    ["service", "database"]
)

db_query_duration_seconds = Histogram(
    "db_query_duration_seconds",
    "Database query duration",
    ["service", "operation"],
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0]
)

# Kafka Metrics
kafka_messages_produced_total = Counter(
    "kafka_messages_produced_total",
    "Total Kafka messages produced",
    ["service", "topic"]
)

kafka_messages_consumed_total = Counter(
    "kafka_messages_consumed_total",
    "Total Kafka messages consumed",
    ["service", "topic", "consumer_group"]
)

kafka_consumer_lag = Gauge(
    "kafka_consumer_lag",
    "Kafka consumer lag",
    ["service", "topic", "partition"]
)

# Service Info
service_info = Info(
    "service",
    "Service information"
)


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Middleware to collect HTTP request metrics"""
    
    def __init__(self, app: FastAPI, service_name: str = None):
        super().__init__(app)
        self.service_name = service_name or SERVICE_NAME
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip metrics endpoint to avoid recursion
        if request.url.path == "/metrics":
            return await call_next(request)
        
        method = request.method
        endpoint = self._get_endpoint(request)
        
        # Track in-progress requests
        http_requests_in_progress.labels(
            service=self.service_name,
            method=method,
            endpoint=endpoint
        ).inc()
        
        start_time = time.time()
        
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception:
            status_code = 500
            raise
        finally:
            duration = time.time() - start_time
            
            # Record metrics
            http_requests_total.labels(
                service=self.service_name,
                method=method,
                endpoint=endpoint,
                status_code=status_code
            ).inc()
            
            http_request_duration_seconds.labels(
                service=self.service_name,
                method=method,
                endpoint=endpoint
            ).observe(duration)
            
            http_requests_in_progress.labels(
                service=self.service_name,
                method=method,
                endpoint=endpoint
            ).dec()
        
        return response
    
    def _get_endpoint(self, request: Request) -> str:
        """Get normalized endpoint path"""
        # Try to get the route path pattern instead of actual path
        # This prevents high cardinality from path parameters
        if request.scope.get("route"):
            return request.scope["route"].path
        return request.url.path


def setup_metrics(app: FastAPI, service_name: str = None):
    """
    Setup Prometheus metrics for a FastAPI application
    
    Usage:
        app = FastAPI()
        setup_metrics(app, "my-service")
    """
    svc_name = service_name or SERVICE_NAME
    
    # Add middleware
    app.add_middleware(PrometheusMiddleware, service_name=svc_name)
    
    # Set service info
    service_info.info({
        "name": svc_name,
        "environment": ENVIRONMENT,
        "version": os.getenv("SERVICE_VERSION", "1.0.0")
    })
    
    # Add metrics endpoint
    @app.get("/metrics", include_in_schema=False)
    async def metrics():
        return Response(
            content=generate_latest(REGISTRY),
            media_type=CONTENT_TYPE_LATEST
        )
    
    logger.info(f"Prometheus metrics enabled for {svc_name}")


def track_transaction(
    transaction_type: str,
    corridor: str,
    status: str,
    amount: float = None,
    currency: str = None,
    duration: float = None
):
    """Track transaction metrics"""
    transactions_total.labels(
        service=SERVICE_NAME,
        type=transaction_type,
        corridor=corridor,
        status=status
    ).inc()
    
    if amount and currency:
        transaction_amount_total.labels(
            service=SERVICE_NAME,
            currency=currency,
            corridor=corridor
        ).inc(amount)
    
    if duration:
        transaction_duration_seconds.labels(
            service=SERVICE_NAME,
            type=transaction_type,
            corridor=corridor
        ).observe(duration)


def track_wallet_operation(operation: str, status: str):
    """Track wallet operation metrics"""
    wallet_operations_total.labels(
        service=SERVICE_NAME,
        operation=operation,
        status=status
    ).inc()


def track_risk_assessment(decision: str, risk_level: str):
    """Track risk assessment metrics"""
    risk_assessments_total.labels(
        service=SERVICE_NAME,
        decision=decision,
        risk_level=risk_level
    ).inc()


def track_compliance_check(check_type: str, result: str):
    """Track compliance check metrics"""
    compliance_checks_total.labels(
        service=SERVICE_NAME,
        check_type=check_type,
        result=result
    ).inc()


def track_external_request(target_service: str, status: str, duration: float):
    """Track external service request metrics"""
    external_requests_total.labels(
        service=SERVICE_NAME,
        target_service=target_service,
        status=status
    ).inc()
    
    external_request_duration_seconds.labels(
        service=SERVICE_NAME,
        target_service=target_service
    ).observe(duration)


def track_circuit_breaker(target_service: str, state: str, failure: bool = False):
    """Track circuit breaker metrics"""
    state_value = {"closed": 0, "open": 1, "half_open": 2}.get(state, 0)
    circuit_breaker_state.labels(
        service=SERVICE_NAME,
        target_service=target_service
    ).set(state_value)
    
    if failure:
        circuit_breaker_failures_total.labels(
            service=SERVICE_NAME,
            target_service=target_service
        ).inc()


def track_kafka_produce(topic: str):
    """Track Kafka message production"""
    kafka_messages_produced_total.labels(
        service=SERVICE_NAME,
        topic=topic
    ).inc()


def track_kafka_consume(topic: str, consumer_group: str):
    """Track Kafka message consumption"""
    kafka_messages_consumed_total.labels(
        service=SERVICE_NAME,
        topic=topic,
        consumer_group=consumer_group
    ).inc()


def timed(metric_name: str = None):
    """
    Decorator to time function execution
    
    Usage:
        @timed("my_operation")
        async def my_function():
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            start_time = time.time()
            try:
                return await func(*args, **kwargs)
            finally:
                duration = time.time() - start_time
                db_query_duration_seconds.labels(
                    service=SERVICE_NAME,
                    operation=metric_name or func.__name__
                ).observe(duration)
        
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            start_time = time.time()
            try:
                return func(*args, **kwargs)
            finally:
                duration = time.time() - start_time
                db_query_duration_seconds.labels(
                    service=SERVICE_NAME,
                    operation=metric_name or func.__name__
                ).observe(duration)
        
        if asyncio_iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    
    return decorator


def asyncio_iscoroutinefunction(func):
    """Check if function is async"""
    import asyncio
    return asyncio.iscoroutinefunction(func)
