"""
Comprehensive Prometheus Metrics Exporter for Mojaloop
Production-grade metrics for monitoring and observability
"""

from prometheus_client import Counter, Gauge, Histogram, Summary, Info, Enum
from prometheus_client import generate_latest, REGISTRY
from prometheus_client.core import CollectorRegistry
import time
import logging
from typing import Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class MojaloopMetricsExporter:
    """Comprehensive metrics exporter for Mojaloop operations"""
    
    def __init__(self, registry=REGISTRY):
        """Initialize all Mojaloop metrics"""
        self.registry = registry
        
        # ============ Participant Metrics ============
        self.participants_total = Gauge(
            'mojaloop_participants_total',
            'Total number of registered participants',
            ['currency', 'status'],
            registry=registry
        )
        
        self.participants_registered = Counter(
            'mojaloop_participants_registered_total',
            'Total number of participants registered',
            ['currency', 'type'],
            registry=registry
        )
        
        # ============ Quote Metrics ============
        self.quotes_created = Counter(
            'mojaloop_quotes_created_total',
            'Total number of quotes created',
            ['payer_fsp', 'payee_fsp', 'currency'],
            registry=registry
        )
        
        self.quotes_by_status = Gauge(
            'mojaloop_quotes_by_status',
            'Number of quotes by status',
            ['status'],
            registry=registry
        )
        
        self.quote_amount = Histogram(
            'mojaloop_quote_amount',
            'Quote amount distribution',
            ['currency'],
            buckets=[10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000],
            registry=registry
        )
        
        self.quote_fees = Histogram(
            'mojaloop_quote_fees',
            'Quote fees distribution',
            ['currency'],
            buckets=[0, 1, 5, 10, 25, 50, 100, 250, 500],
            registry=registry
        )
        
        self.quote_creation_duration = Histogram(
            'mojaloop_quote_creation_duration_seconds',
            'Time taken to create a quote',
            ['payer_fsp', 'payee_fsp'],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
            registry=registry
        )
        
        # ============ Transfer Metrics ============
        self.transfers_total = Counter(
            'mojaloop_transfers_total',
            'Total number of transfers',
            ['payer_fsp', 'payee_fsp', 'currency', 'state'],
            registry=registry
        )
        
        self.transfers_by_state = Gauge(
            'mojaloop_transfers_by_state',
            'Number of transfers by state',
            ['state'],
            registry=registry
        )
        
        self.transfer_amount = Histogram(
            'mojaloop_transfer_amount',
            'Transfer amount distribution',
            ['currency'],
            buckets=[10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
            registry=registry
        )
        
        self.transfer_prepare_duration = Histogram(
            'mojaloop_transfer_prepare_duration_seconds',
            'Time taken to prepare a transfer',
            ['payer_fsp', 'payee_fsp'],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
            registry=registry
        )
        
        self.transfer_fulfill_duration = Histogram(
            'mojaloop_transfer_fulfill_duration_seconds',
            'Time taken to fulfill a transfer',
            ['payer_fsp', 'payee_fsp'],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
            registry=registry
        )
        
        self.transfer_end_to_end_duration = Histogram(
            'mojaloop_transfer_end_to_end_duration_seconds',
            'End-to-end transfer duration (quote to settlement)',
            ['payer_fsp', 'payee_fsp'],
            buckets=[1, 5, 10, 30, 60, 120, 300, 600, 1800],
            registry=registry
        )
        
        # ============ Settlement Metrics ============
        self.settlement_windows_total = Counter(
            'mojaloop_settlement_windows_total',
            'Total number of settlement windows',
            ['state'],
            registry=registry
        )
        
        self.settlement_windows_active = Gauge(
            'mojaloop_settlement_windows_active',
            'Number of active settlement windows',
            registry=registry
        )
        
        self.settlements_processed = Counter(
            'mojaloop_settlements_processed_total',
            'Total number of settlements processed',
            ['participant_id', 'currency'],
            registry=registry
        )
        
        self.settlement_amount = Histogram(
            'mojaloop_settlement_amount',
            'Settlement amount distribution',
            ['currency'],
            buckets=[100, 1000, 10000, 100000, 1000000, 10000000],
            registry=registry
        )
        
        self.settlement_processing_duration = Histogram(
            'mojaloop_settlement_processing_duration_seconds',
            'Time taken to process settlement',
            buckets=[1, 5, 10, 30, 60, 120, 300, 600],
            registry=registry
        )
        
        # ============ Cross-Border Payment Metrics ============
        self.cross_border_payments = Counter(
            'mojaloop_cross_border_payments_total',
            'Total cross-border payments',
            ['source_currency', 'target_currency', 'corridor', 'status'],
            registry=registry
        )
        
        self.cross_border_amount = Histogram(
            'mojaloop_cross_border_amount',
            'Cross-border payment amount',
            ['source_currency', 'target_currency'],
            buckets=[100, 500, 1000, 5000, 10000, 50000, 100000, 500000],
            registry=registry
        )
        
        self.cross_border_exchange_rate = Gauge(
            'mojaloop_cross_border_exchange_rate',
            'Current exchange rate',
            ['source_currency', 'target_currency'],
            registry=registry
        )
        
        self.cross_border_duration = Histogram(
            'mojaloop_cross_border_duration_seconds',
            'Cross-border payment duration',
            ['corridor'],
            buckets=[5, 10, 30, 60, 120, 300, 600, 1800, 3600],
            registry=registry
        )
        
        # ============ Payment System Integration Metrics ============
        self.payment_system_requests = Counter(
            'mojaloop_payment_system_requests_total',
            'Requests to payment systems',
            ['system', 'operation', 'status'],
            registry=registry
        )
        
        self.payment_system_latency = Histogram(
            'mojaloop_payment_system_latency_seconds',
            'Payment system API latency',
            ['system', 'operation'],
            buckets=[0.1, 0.5, 1, 2.5, 5, 10, 30],
            registry=registry
        )
        
        self.payment_system_health = Gauge(
            'mojaloop_payment_system_health',
            'Payment system health status (1=healthy, 0=unhealthy)',
            ['system'],
            registry=registry
        )
        
        # UPI specific metrics
        self.upi_transactions = Counter(
            'mojaloop_upi_transactions_total',
            'Total UPI transactions',
            ['transaction_type', 'status'],
            registry=registry
        )
        
        self.upi_vpa_validations = Counter(
            'mojaloop_upi_vpa_validations_total',
            'UPI VPA validation attempts',
            ['result'],
            registry=registry
        )
        
        # PAPSS specific metrics
        self.papss_corridor_payments = Counter(
            'mojaloop_papss_corridor_payments_total',
            'PAPSS corridor payments',
            ['corridor', 'status'],
            registry=registry
        )
        
        # PIX specific metrics
        self.pix_qr_payments = Counter(
            'mojaloop_pix_qr_payments_total',
            'PIX QR code payments',
            ['status'],
            registry=registry
        )
        
        # CIPS specific metrics
        self.cips_cross_border = Counter(
            'mojaloop_cips_cross_border_total',
            'CIPS cross-border payments',
            ['status'],
            registry=registry
        )
        
        # ============ TigerBeetle Integration Metrics ============
        self.tigerbeetle_accounts_created = Counter(
            'mojaloop_tigerbeetle_accounts_created_total',
            'TigerBeetle accounts created',
            ['ledger'],
            registry=registry
        )
        
        self.tigerbeetle_transfers = Counter(
            'mojaloop_tigerbeetle_transfers_total',
            'TigerBeetle transfers',
            ['status'],
            registry=registry
        )
        
        self.tigerbeetle_balance = Gauge(
            'mojaloop_tigerbeetle_balance',
            'TigerBeetle account balance',
            ['participant_id', 'currency'],
            registry=registry
        )
        
        self.tigerbeetle_operation_duration = Histogram(
            'mojaloop_tigerbeetle_operation_duration_seconds',
            'TigerBeetle operation duration',
            ['operation'],
            buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
            registry=registry
        )
        
        # ============ Database Metrics ============
        self.database_queries = Counter(
            'mojaloop_database_queries_total',
            'Database queries executed',
            ['operation', 'table'],
            registry=registry
        )
        
        self.database_query_duration = Histogram(
            'mojaloop_database_query_duration_seconds',
            'Database query duration',
            ['operation', 'table'],
            buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
            registry=registry
        )
        
        self.database_connection_pool_size = Gauge(
            'mojaloop_database_connection_pool_size',
            'Database connection pool size',
            ['state'],
            registry=registry
        )
        
        # ============ Error Metrics ============
        self.errors_total = Counter(
            'mojaloop_errors_total',
            'Total errors',
            ['component', 'error_type'],
            registry=registry
        )
        
        self.validation_errors = Counter(
            'mojaloop_validation_errors_total',
            'Validation errors',
            ['field', 'error_type'],
            registry=registry
        )
        
        self.timeout_errors = Counter(
            'mojaloop_timeout_errors_total',
            'Timeout errors',
            ['operation'],
            registry=registry
        )
        
        # ============ Performance Metrics ============
        self.api_requests = Counter(
            'mojaloop_api_requests_total',
            'Total API requests',
            ['method', 'endpoint', 'status'],
            registry=registry
        )
        
        self.api_request_duration = Histogram(
            'mojaloop_api_request_duration_seconds',
            'API request duration',
            ['method', 'endpoint'],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
            registry=registry
        )
        
        self.api_request_size = Histogram(
            'mojaloop_api_request_size_bytes',
            'API request size',
            ['endpoint'],
            buckets=[100, 500, 1000, 5000, 10000, 50000, 100000],
            registry=registry
        )
        
        self.api_response_size = Histogram(
            'mojaloop_api_response_size_bytes',
            'API response size',
            ['endpoint'],
            buckets=[100, 500, 1000, 5000, 10000, 50000, 100000],
            registry=registry
        )
        
        # ============ Business Metrics ============
        self.daily_transaction_volume = Gauge(
            'mojaloop_daily_transaction_volume',
            'Daily transaction volume',
            ['currency'],
            registry=registry
        )
        
        self.daily_transaction_count = Gauge(
            'mojaloop_daily_transaction_count',
            'Daily transaction count',
            ['currency'],
            registry=registry
        )
        
        self.total_fees_collected = Counter(
            'mojaloop_total_fees_collected',
            'Total fees collected',
            ['currency'],
            registry=registry
        )
        
        self.average_transaction_value = Gauge(
            'mojaloop_average_transaction_value',
            'Average transaction value',
            ['currency'],
            registry=registry
        )
        
        # ============ SLA Metrics ============
        self.sla_compliance = Gauge(
            'mojaloop_sla_compliance_percentage',
            'SLA compliance percentage',
            ['metric'],
            registry=registry
        )
        
        self.availability = Gauge(
            'mojaloop_availability_percentage',
            'System availability percentage',
            registry=registry
        )
        
        self.success_rate = Gauge(
            'mojaloop_success_rate_percentage',
            'Transaction success rate',
            ['operation'],
            registry=registry
        )
        
        # ============ System Health Metrics ============
        self.system_info = Info(
            'mojaloop_system',
            'Mojaloop system information',
            registry=registry
        )
        
        self.uptime_seconds = Gauge(
            'mojaloop_uptime_seconds',
            'System uptime in seconds',
            registry=registry
        )
        
        self.active_connections = Gauge(
            'mojaloop_active_connections',
            'Number of active connections',
            ['type'],
            registry=registry
        )
        
        logger.info("Mojaloop metrics exporter initialized with 50+ metrics")
    
    # Helper methods for recording metrics
    
    def record_quote_created(self, payer_fsp: str, payee_fsp: str, currency: str, amount: float, fees: float, duration: float):
        """Record quote creation"""
        self.quotes_created.labels(payer_fsp=payer_fsp, payee_fsp=payee_fsp, currency=currency).inc()
        self.quote_amount.labels(currency=currency).observe(amount)
        self.quote_fees.labels(currency=currency).observe(fees)
        self.quote_creation_duration.labels(payer_fsp=payer_fsp, payee_fsp=payee_fsp).observe(duration)
    
    def record_transfer_prepared(self, payer_fsp: str, payee_fsp: str, currency: str, amount: float, duration: float):
        """Record transfer preparation"""
        self.transfers_total.labels(payer_fsp=payer_fsp, payee_fsp=payee_fsp, currency=currency, state='PREPARED').inc()
        self.transfer_amount.labels(currency=currency).observe(amount)
        self.transfer_prepare_duration.labels(payer_fsp=payer_fsp, payee_fsp=payee_fsp).observe(duration)
    
    def record_transfer_fulfilled(self, payer_fsp: str, payee_fsp: str, duration: float):
        """Record transfer fulfillment"""
        self.transfers_total.labels(payer_fsp=payer_fsp, payee_fsp=payee_fsp, currency='', state='COMMITTED').inc()
        self.transfer_fulfill_duration.labels(payer_fsp=payer_fsp, payee_fsp=payee_fsp).observe(duration)
    
    def record_cross_border_payment(self, source_currency: str, target_currency: str, corridor: str, 
                                   amount: float, exchange_rate: float, duration: float, status: str):
        """Record cross-border payment"""
        self.cross_border_payments.labels(
            source_currency=source_currency,
            target_currency=target_currency,
            corridor=corridor,
            status=status
        ).inc()
        self.cross_border_amount.labels(source_currency=source_currency, target_currency=target_currency).observe(amount)
        self.cross_border_exchange_rate.labels(source_currency=source_currency, target_currency=target_currency).set(exchange_rate)
        self.cross_border_duration.labels(corridor=corridor).observe(duration)
    
    def record_payment_system_request(self, system: str, operation: str, status: str, latency: float):
        """Record payment system integration request"""
        self.payment_system_requests.labels(system=system, operation=operation, status=status).inc()
        self.payment_system_latency.labels(system=system, operation=operation).observe(latency)
    
    def record_upi_transaction(self, transaction_type: str, status: str):
        """Record UPI transaction"""
        self.upi_transactions.labels(transaction_type=transaction_type, status=status).inc()
    
    def record_tigerbeetle_operation(self, operation: str, status: str, duration: float):
        """Record TigerBeetle operation"""
        self.tigerbeetle_transfers.labels(status=status).inc()
        self.tigerbeetle_operation_duration.labels(operation=operation).observe(duration)
    
    def record_database_query(self, operation: str, table: str, duration: float):
        """Record database query"""
        self.database_queries.labels(operation=operation, table=table).inc()
        self.database_query_duration.labels(operation=operation, table=table).observe(duration)
    
    def record_api_request(self, method: str, endpoint: str, status: int, duration: float, 
                          request_size: int, response_size: int):
        """Record API request"""
        self.api_requests.labels(method=method, endpoint=endpoint, status=str(status)).inc()
        self.api_request_duration.labels(method=method, endpoint=endpoint).observe(duration)
        self.api_request_size.labels(endpoint=endpoint).observe(request_size)
        self.api_response_size.labels(endpoint=endpoint).observe(response_size)
    
    def record_error(self, component: str, error_type: str):
        """Record error"""
        self.errors_total.labels(component=component, error_type=error_type).inc()
    
    def update_system_health(self, payment_system: str, is_healthy: bool):
        """Update payment system health"""
        self.payment_system_health.labels(system=payment_system).set(1 if is_healthy else 0)
    
    def update_sla_compliance(self, metric: str, percentage: float):
        """Update SLA compliance"""
        self.sla_compliance.labels(metric=metric).set(percentage)
    
    def get_metrics(self) -> bytes:
        """Get all metrics in Prometheus format"""
        return generate_latest(self.registry)


# Singleton instance
_metrics_exporter = None

def get_metrics_exporter() -> MojaloopMetricsExporter:
    """Get singleton metrics exporter instance"""
    global _metrics_exporter
    if _metrics_exporter is None:
        _metrics_exporter = MojaloopMetricsExporter()
    return _metrics_exporter


# Example usage
if __name__ == '__main__':
    exporter = get_metrics_exporter()
    
    # Record some sample metrics
    exporter.record_quote_created('upi-india', 'papss-nigeria', 'INR', 10000, 0, 0.15)
    exporter.record_transfer_prepared('upi-india', 'papss-nigeria', 'NGN', 51200, 0.25)
    exporter.record_cross_border_payment('INR', 'NGN', 'India-Nigeria', 10000, 5.12, 4.5, 'SUCCESS')
    exporter.record_upi_transaction('P2P', 'SUCCESS')
    exporter.update_system_health('UPI', True)
    exporter.update_system_health('PAPSS', True)
    exporter.update_sla_compliance('transfer_latency', 99.5)
    
    # Get metrics
    metrics = exporter.get_metrics()
    print(f"Metrics exported: {len(metrics)} bytes")

