"""
Prometheus Metrics Exporter for Mojaloop
Exposes custom metrics for monitoring
"""

import time
import logging
from prometheus_client import Counter, Histogram, Gauge, Summary, start_http_server
from prometheus_client import CollectorRegistry, generate_latest


logger = logging.getLogger(__name__)


class MojaloopMetrics:
    """Prometheus metrics for Mojaloop operations"""
    
    def __init__(self, registry=None):
        self.registry = registry or CollectorRegistry()
        
        # Participant metrics
        self.participants_total = Gauge(
            'mojaloop_participants_total',
            'Total number of registered participants',
            ['status'],
            registry=self.registry
        )
        
        # Quote metrics
        self.quotes_created_total = Counter(
            'mojaloop_quotes_created_total',
            'Total number of quotes created',
            ['payer_fsp', 'payee_fsp'],
            registry=self.registry
        )
        
        self.quotes_approved_total = Counter(
            'mojaloop_quotes_approved_total',
            'Total number of quotes approved',
            registry=self.registry
        )
        
        self.quotes_rejected_total = Counter(
            'mojaloop_quotes_rejected_total',
            'Total number of quotes rejected',
            ['reason'],
            registry=self.registry
        )
        
        self.quote_creation_duration = Histogram(
            'mojaloop_quote_creation_duration_seconds',
            'Time taken to create a quote',
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
            registry=self.registry
        )
        
        # Transfer metrics
        self.transfers_created_total = Counter(
            'mojaloop_transfers_created_total',
            'Total number of transfers created',
            ['payer_fsp', 'payee_fsp'],
            registry=self.registry
        )
        
        self.transfers_committed_total = Counter(
            'mojaloop_transfers_committed_total',
            'Total number of transfers committed',
            registry=self.registry
        )
        
        self.transfers_aborted_total = Counter(
            'mojaloop_transfers_aborted_total',
            'Total number of transfers aborted',
            ['reason'],
            registry=self.registry
        )
        
        self.transfer_processing_duration = Histogram(
            'mojaloop_transfer_processing_duration_seconds',
            'Time taken to process a transfer',
            buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0],
            registry=self.registry
        )
        
        self.transfer_amount = Summary(
            'mojaloop_transfer_amount',
            'Transfer amount distribution',
            ['currency'],
            registry=self.registry
        )
        
        # Settlement metrics
        self.settlements_processed_total = Counter(
            'mojaloop_settlements_processed_total',
            'Total number of settlements processed',
            registry=self.registry
        )
        
        self.settlement_windows_total = Gauge(
            'mojaloop_settlement_windows_total',
            'Total number of settlement windows',
            ['state'],
            registry=self.registry
        )
        
        self.settlement_processing_duration = Histogram(
            'mojaloop_settlement_processing_duration_seconds',
            'Time taken to process a settlement',
            buckets=[1.0, 5.0, 10.0, 30.0, 60.0, 120.0],
            registry=self.registry
        )
        
        # Payment metrics
        self.payments_total = Counter(
            'mojaloop_payments_total',
            'Total number of payments',
            ['type', 'status'],
            registry=self.registry
        )
        
        self.payment_success_rate = Gauge(
            'mojaloop_payment_success_rate',
            'Payment success rate',
            registry=self.registry
        )
        
        self.payment_fees_total = Summary(
            'mojaloop_payment_fees_total',
            'Total fees collected',
            ['currency'],
            registry=self.registry
        )
        
        # System metrics
        self.active_connections = Gauge(
            'mojaloop_active_connections',
            'Number of active connections',
            registry=self.registry
        )
        
        self.request_duration = Histogram(
            'mojaloop_request_duration_seconds',
            'HTTP request duration',
            ['method', 'endpoint', 'status'],
            buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0],
            registry=self.registry
        )
        
        self.errors_total = Counter(
            'mojaloop_errors_total',
            'Total number of errors',
            ['type', 'severity'],
            registry=self.registry
        )
    
    # Helper methods
    
    def record_quote_created(self, payer_fsp: str, payee_fsp: str, duration: float):
        """Record quote creation"""
        self.quotes_created_total.labels(payer_fsp=payer_fsp, payee_fsp=payee_fsp).inc()
        self.quote_creation_duration.observe(duration)
    
    def record_transfer_created(self, payer_fsp: str, payee_fsp: str, amount: float, currency: str):
        """Record transfer creation"""
        self.transfers_created_total.labels(payer_fsp=payer_fsp, payee_fsp=payee_fsp).inc()
        self.transfer_amount.labels(currency=currency).observe(amount)
    
    def record_transfer_committed(self, duration: float):
        """Record transfer commitment"""
        self.transfers_committed_total.inc()
        self.transfer_processing_duration.observe(duration)
    
    def record_transfer_aborted(self, reason: str):
        """Record transfer abortion"""
        self.transfers_aborted_total.labels(reason=reason).inc()
    
    def record_payment(self, payment_type: str, status: str, fees: float, currency: str):
        """Record payment"""
        self.payments_total.labels(type=payment_type, status=status).inc()
        if fees > 0:
            self.payment_fees_total.labels(currency=currency).observe(fees)
    
    def record_error(self, error_type: str, severity: str):
        """Record error"""
        self.errors_total.labels(type=error_type, severity=severity).inc()
    
    def update_participants_count(self, active: int, inactive: int):
        """Update participants count"""
        self.participants_total.labels(status='active').set(active)
        self.participants_total.labels(status='inactive').set(inactive)
    
    def update_settlement_windows(self, open_count: int, closed_count: int):
        """Update settlement windows count"""
        self.settlement_windows_total.labels(state='open').set(open_count)
        self.settlement_windows_total.labels(state='closed').set(closed_count)


# Metrics middleware for FastAPI/Flask

class MetricsMiddleware:
    """Middleware to collect HTTP request metrics"""
    
    def __init__(self, metrics: MojaloopMetrics):
        self.metrics = metrics
    
    async def __call__(self, request, call_next):
        """Process request and collect metrics"""
        start_time = time.time()
        
        try:
            response = await call_next(request)
            duration = time.time() - start_time
            
            self.metrics.request_duration.labels(
                method=request.method,
                endpoint=request.url.path,
                status=response.status_code
            ).observe(duration)
            
            return response
        except Exception as e:
            duration = time.time() - start_time
            
            self.metrics.request_duration.labels(
                method=request.method,
                endpoint=request.url.path,
                status=500
            ).observe(duration)
            
            self.metrics.record_error(
                error_type=type(e).__name__,
                severity='error'
            )
            
            raise


# Example usage

def start_metrics_server(port: int = 9090):
    """Start Prometheus metrics HTTP server"""
    start_http_server(port)
    logger.info(f"Metrics server started on port {port}")


if __name__ == "__main__":
    # Initialize metrics
    metrics = MojaloopMetrics()
    
    # Start metrics server
    start_metrics_server(9090)
    
    # Simulate some metrics
    while True:
        metrics.record_quote_created("rafiki-ng", "cips-global", 0.5)
        metrics.record_transfer_created("rafiki-ng", "cips-global", 1000.0, "NGN")
        metrics.record_transfer_committed(2.0)
        metrics.record_payment("domestic", "success", 15.0, "NGN")
        metrics.update_participants_count(10, 2)
        
        time.sleep(10)

