"""
SLO-Based Alerting System
Defines SLOs per critical path and alerts on error budgets
"""

import os
import json
import logging
import asyncio
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
import httpx

logger = logging.getLogger(__name__)


class SLOType(str, Enum):
    AVAILABILITY = "availability"
    LATENCY = "latency"
    ERROR_RATE = "error_rate"
    THROUGHPUT = "throughput"


class AlertSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    PAGE = "page"


@dataclass
class SLO:
    """Service Level Objective definition"""
    name: str
    service: str
    slo_type: SLOType
    target: float  # Target percentage (e.g., 99.9 for 99.9%)
    window_days: int = 30  # Rolling window
    
    # Thresholds for error budget consumption
    warning_threshold: float = 50.0  # Alert when 50% of error budget consumed
    critical_threshold: float = 80.0  # Alert when 80% of error budget consumed
    page_threshold: float = 100.0  # Page when error budget exhausted
    
    # Burn rate thresholds (for fast burn detection)
    fast_burn_rate: float = 14.4  # 14.4x burn rate = budget exhausted in 2 days
    slow_burn_rate: float = 1.0  # 1x burn rate = budget exhausted in window
    
    description: str = ""
    owner: str = ""
    
    @property
    def error_budget(self) -> float:
        """Calculate error budget as percentage"""
        return 100.0 - self.target


@dataclass
class SLOStatus:
    """Current status of an SLO"""
    slo: SLO
    current_value: float
    error_budget_remaining: float
    error_budget_consumed: float
    burn_rate: float
    is_healthy: bool
    alert_severity: Optional[AlertSeverity]
    measured_at: datetime
    window_start: datetime
    window_end: datetime
    
    # Detailed metrics
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    p50_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0
    p99_latency_ms: float = 0.0


@dataclass
class Alert:
    """SLO alert"""
    alert_id: str
    slo_name: str
    service: str
    severity: AlertSeverity
    title: str
    description: str
    current_value: float
    target_value: float
    error_budget_remaining: float
    burn_rate: float
    fired_at: datetime
    resolved_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None


# Define SLOs for critical paths
PLATFORM_SLOS = [
    # Authentication
    SLO(
        name="auth_login_availability",
        service="auth-service",
        slo_type=SLOType.AVAILABILITY,
        target=99.9,
        description="Login endpoint availability",
        owner="platform-team"
    ),
    SLO(
        name="auth_login_latency",
        service="auth-service",
        slo_type=SLOType.LATENCY,
        target=95.0,  # 95% of requests under threshold
        description="Login latency p95 < 500ms",
        owner="platform-team"
    ),
    
    # Cash-in/Cash-out
    SLO(
        name="cash_in_availability",
        service="transaction-service",
        slo_type=SLOType.AVAILABILITY,
        target=99.95,
        description="Cash-in transaction availability",
        owner="payments-team"
    ),
    SLO(
        name="cash_out_availability",
        service="transaction-service",
        slo_type=SLOType.AVAILABILITY,
        target=99.95,
        description="Cash-out transaction availability",
        owner="payments-team"
    ),
    SLO(
        name="transaction_latency",
        service="transaction-service",
        slo_type=SLOType.LATENCY,
        target=99.0,  # 99% of transactions under threshold
        description="Transaction processing latency p99 < 2s",
        owner="payments-team"
    ),
    
    # Transfer
    SLO(
        name="transfer_availability",
        service="transfer-service",
        slo_type=SLOType.AVAILABILITY,
        target=99.9,
        description="P2P transfer availability",
        owner="payments-team"
    ),
    SLO(
        name="transfer_error_rate",
        service="transfer-service",
        slo_type=SLOType.ERROR_RATE,
        target=99.5,  # Less than 0.5% error rate
        description="Transfer error rate < 0.5%",
        owner="payments-team"
    ),
    
    # Settlement
    SLO(
        name="settlement_availability",
        service="settlement-service",
        slo_type=SLOType.AVAILABILITY,
        target=99.9,
        description="Settlement processing availability",
        owner="finance-team"
    ),
    SLO(
        name="settlement_latency",
        service="settlement-service",
        slo_type=SLOType.LATENCY,
        target=95.0,
        description="Settlement latency p95 < 30s",
        owner="finance-team"
    ),
    
    # KYC
    SLO(
        name="kyc_verification_availability",
        service="kyc-service",
        slo_type=SLOType.AVAILABILITY,
        target=99.5,
        description="KYC verification availability",
        owner="compliance-team"
    ),
    SLO(
        name="kyc_decision_latency",
        service="kyc-service",
        slo_type=SLOType.LATENCY,
        target=90.0,
        description="KYC decision latency p90 < 60s",
        owner="compliance-team"
    ),
    
    # TigerBeetle
    SLO(
        name="tigerbeetle_availability",
        service="tigerbeetle",
        slo_type=SLOType.AVAILABILITY,
        target=99.99,
        description="TigerBeetle ledger availability",
        owner="platform-team"
    ),
    SLO(
        name="tigerbeetle_latency",
        service="tigerbeetle",
        slo_type=SLOType.LATENCY,
        target=99.9,
        description="TigerBeetle operation latency p99 < 10ms",
        owner="platform-team"
    ),
    
    # Sync
    SLO(
        name="edge_sync_availability",
        service="sync-service",
        slo_type=SLOType.AVAILABILITY,
        target=99.5,
        description="Edge-to-primary sync availability",
        owner="platform-team"
    ),
    SLO(
        name="sync_lag",
        service="sync-service",
        slo_type=SLOType.LATENCY,
        target=95.0,
        description="Sync lag p95 < 5s",
        owner="platform-team"
    ),
]


class MetricsClient:
    """Client for fetching metrics from Prometheus/Victoria Metrics"""
    
    def __init__(self, prometheus_url: str = None):
        self.prometheus_url = prometheus_url or os.getenv(
            "PROMETHEUS_URL",
            "http://prometheus:9090"
        )
    
    async def query(self, query: str) -> Dict[str, Any]:
        """Execute a PromQL query"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.prometheus_url}/api/v1/query",
                params={"query": query}
            )
            if response.status_code == 200:
                return response.json()
            return {"status": "error", "data": {"result": []}}
    
    async def query_range(
        self,
        query: str,
        start: datetime,
        end: datetime,
        step: str = "1m"
    ) -> Dict[str, Any]:
        """Execute a range query"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.prometheus_url}/api/v1/query_range",
                params={
                    "query": query,
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "step": step
                }
            )
            if response.status_code == 200:
                return response.json()
            return {"status": "error", "data": {"result": []}}


class AlertManager:
    """Manages alert notifications"""
    
    def __init__(self):
        self.slack_webhook = os.getenv("SLACK_WEBHOOK_URL")
        self.pagerduty_key = os.getenv("PAGERDUTY_ROUTING_KEY")
        self.opsgenie_key = os.getenv("OPSGENIE_API_KEY")
    
    async def send_alert(self, alert: Alert):
        """Send alert to configured channels"""
        if alert.severity == AlertSeverity.PAGE:
            await self._page(alert)
        elif alert.severity == AlertSeverity.CRITICAL:
            await self._notify_critical(alert)
        else:
            await self._notify_slack(alert)
    
    async def _notify_slack(self, alert: Alert):
        """Send alert to Slack"""
        if not self.slack_webhook:
            logger.warning("Slack webhook not configured")
            return
        
        color = {
            AlertSeverity.INFO: "#36a64f",
            AlertSeverity.WARNING: "#ffcc00",
            AlertSeverity.CRITICAL: "#ff0000",
            AlertSeverity.PAGE: "#ff0000"
        }.get(alert.severity, "#808080")
        
        payload = {
            "attachments": [{
                "color": color,
                "title": alert.title,
                "text": alert.description,
                "fields": [
                    {"title": "Service", "value": alert.service, "short": True},
                    {"title": "SLO", "value": alert.slo_name, "short": True},
                    {"title": "Current", "value": f"{alert.current_value:.2f}%", "short": True},
                    {"title": "Target", "value": f"{alert.target_value:.2f}%", "short": True},
                    {"title": "Error Budget", "value": f"{alert.error_budget_remaining:.2f}%", "short": True},
                    {"title": "Burn Rate", "value": f"{alert.burn_rate:.2f}x", "short": True},
                ],
                "footer": f"Alert ID: {alert.alert_id}",
                "ts": int(alert.fired_at.timestamp())
            }]
        }
        
        async with httpx.AsyncClient() as client:
            await client.post(self.slack_webhook, json=payload)
    
    async def _notify_critical(self, alert: Alert):
        """Send critical alert"""
        await self._notify_slack(alert)
        # Could also send to email, SMS, etc.
    
    async def _page(self, alert: Alert):
        """Page on-call via PagerDuty or OpsGenie"""
        await self._notify_slack(alert)
        
        if self.pagerduty_key:
            await self._page_pagerduty(alert)
        elif self.opsgenie_key:
            await self._page_opsgenie(alert)
    
    async def _page_pagerduty(self, alert: Alert):
        """Send page to PagerDuty"""
        payload = {
            "routing_key": self.pagerduty_key,
            "event_action": "trigger",
            "dedup_key": alert.alert_id,
            "payload": {
                "summary": alert.title,
                "severity": "critical",
                "source": alert.service,
                "custom_details": {
                    "slo_name": alert.slo_name,
                    "current_value": alert.current_value,
                    "target_value": alert.target_value,
                    "error_budget_remaining": alert.error_budget_remaining,
                    "burn_rate": alert.burn_rate
                }
            }
        }
        
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://events.pagerduty.com/v2/enqueue",
                json=payload
            )
    
    async def _page_opsgenie(self, alert: Alert):
        """Send page to OpsGenie"""
        payload = {
            "message": alert.title,
            "alias": alert.alert_id,
            "description": alert.description,
            "priority": "P1",
            "tags": [alert.service, alert.slo_name]
        }
        
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://api.opsgenie.com/v2/alerts",
                headers={"Authorization": f"GenieKey {self.opsgenie_key}"},
                json=payload
            )


class SLOMonitor:
    """
    SLO Monitor that tracks SLOs and alerts on error budget consumption.
    """
    
    def __init__(self, slos: List[SLO] = None):
        self.slos = slos or PLATFORM_SLOS
        self.metrics_client = MetricsClient()
        self.alert_manager = AlertManager()
        self._active_alerts: Dict[str, Alert] = {}
        self._slo_status: Dict[str, SLOStatus] = {}
    
    async def check_all_slos(self) -> List[SLOStatus]:
        """Check all SLOs and return their status"""
        statuses = []
        for slo in self.slos:
            status = await self.check_slo(slo)
            statuses.append(status)
            self._slo_status[slo.name] = status
            
            # Handle alerting
            await self._handle_alerting(status)
        
        return statuses
    
    async def check_slo(self, slo: SLO) -> SLOStatus:
        """Check a single SLO"""
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(days=slo.window_days)
        
        # Build query based on SLO type
        if slo.slo_type == SLOType.AVAILABILITY:
            query = self._build_availability_query(slo)
        elif slo.slo_type == SLOType.LATENCY:
            query = self._build_latency_query(slo)
        elif slo.slo_type == SLOType.ERROR_RATE:
            query = self._build_error_rate_query(slo)
        else:
            query = self._build_throughput_query(slo)
        
        # Execute query
        result = await self.metrics_client.query(query)
        
        # Parse result
        current_value = self._parse_metric_value(result)
        
        # Calculate error budget
        error_budget = slo.error_budget
        error_consumed = max(0, slo.target - current_value)
        error_budget_remaining = max(0, error_budget - error_consumed)
        error_budget_consumed_pct = (error_consumed / error_budget * 100) if error_budget > 0 else 0
        
        # Calculate burn rate
        burn_rate = self._calculate_burn_rate(slo, current_value)
        
        # Determine health and alert severity
        is_healthy = current_value >= slo.target
        alert_severity = None
        
        if error_budget_consumed_pct >= slo.page_threshold:
            alert_severity = AlertSeverity.PAGE
        elif error_budget_consumed_pct >= slo.critical_threshold:
            alert_severity = AlertSeverity.CRITICAL
        elif error_budget_consumed_pct >= slo.warning_threshold:
            alert_severity = AlertSeverity.WARNING
        elif burn_rate >= slo.fast_burn_rate:
            alert_severity = AlertSeverity.CRITICAL
        
        return SLOStatus(
            slo=slo,
            current_value=current_value,
            error_budget_remaining=error_budget_remaining,
            error_budget_consumed=error_budget_consumed_pct,
            burn_rate=burn_rate,
            is_healthy=is_healthy,
            alert_severity=alert_severity,
            measured_at=now,
            window_start=window_start,
            window_end=now
        )
    
    def _build_availability_query(self, slo: SLO) -> str:
        """Build availability query"""
        return f"""
            sum(rate(http_requests_total{{service="{slo.service}",status!~"5.."}}[{slo.window_days}d]))
            /
            sum(rate(http_requests_total{{service="{slo.service}"}}[{slo.window_days}d]))
            * 100
        """
    
    def _build_latency_query(self, slo: SLO) -> str:
        """Build latency query"""
        return f"""
            histogram_quantile(0.{int(slo.target)},
                sum(rate(http_request_duration_seconds_bucket{{service="{slo.service}"}}[{slo.window_days}d])) by (le)
            )
        """
    
    def _build_error_rate_query(self, slo: SLO) -> str:
        """Build error rate query"""
        return f"""
            (1 - sum(rate(http_requests_total{{service="{slo.service}",status=~"5.."}}[{slo.window_days}d]))
            /
            sum(rate(http_requests_total{{service="{slo.service}"}}[{slo.window_days}d])))
            * 100
        """
    
    def _build_throughput_query(self, slo: SLO) -> str:
        """Build throughput query"""
        return f"""
            sum(rate(http_requests_total{{service="{slo.service}"}}[{slo.window_days}d]))
        """
    
    def _parse_metric_value(self, result: Dict[str, Any]) -> float:
        """Parse metric value from Prometheus response"""
        try:
            data = result.get("data", {}).get("result", [])
            if data and len(data) > 0:
                value = data[0].get("value", [0, "0"])
                return float(value[1])
        except (IndexError, ValueError, TypeError):
            pass
        return 100.0  # Default to 100% if no data
    
    def _calculate_burn_rate(self, slo: SLO, current_value: float) -> float:
        """Calculate burn rate"""
        if current_value >= slo.target:
            return 0.0
        
        error_budget = slo.error_budget
        error_consumed = slo.target - current_value
        
        # Burn rate = (error consumed / error budget) * window_days
        # A burn rate of 1.0 means budget will be exhausted exactly at window end
        if error_budget > 0:
            return (error_consumed / error_budget) * slo.window_days
        return 0.0
    
    async def _handle_alerting(self, status: SLOStatus):
        """Handle alerting based on SLO status"""
        slo = status.slo
        alert_key = f"{slo.service}:{slo.name}"
        
        if status.alert_severity:
            # Create or update alert
            if alert_key not in self._active_alerts:
                alert = Alert(
                    alert_id=f"{alert_key}:{int(status.measured_at.timestamp())}",
                    slo_name=slo.name,
                    service=slo.service,
                    severity=status.alert_severity,
                    title=f"SLO Violation: {slo.name}",
                    description=f"{slo.description}. Current: {status.current_value:.2f}%, Target: {slo.target:.2f}%",
                    current_value=status.current_value,
                    target_value=slo.target,
                    error_budget_remaining=status.error_budget_remaining,
                    burn_rate=status.burn_rate,
                    fired_at=status.measured_at
                )
                self._active_alerts[alert_key] = alert
                await self.alert_manager.send_alert(alert)
                logger.warning(f"Alert fired: {alert.title}")
        else:
            # Resolve alert if exists
            if alert_key in self._active_alerts:
                alert = self._active_alerts[alert_key]
                alert.resolved_at = status.measured_at
                del self._active_alerts[alert_key]
                logger.info(f"Alert resolved: {alert.title}")
    
    def get_dashboard_data(self) -> Dict[str, Any]:
        """Get data for SLO dashboard"""
        return {
            "slos": [
                {
                    "name": status.slo.name,
                    "service": status.slo.service,
                    "type": status.slo.slo_type.value,
                    "target": status.slo.target,
                    "current": status.current_value,
                    "error_budget_remaining": status.error_budget_remaining,
                    "error_budget_consumed": status.error_budget_consumed,
                    "burn_rate": status.burn_rate,
                    "is_healthy": status.is_healthy,
                    "alert_severity": status.alert_severity.value if status.alert_severity else None,
                    "measured_at": status.measured_at.isoformat()
                }
                for status in self._slo_status.values()
            ],
            "active_alerts": [
                {
                    "alert_id": alert.alert_id,
                    "slo_name": alert.slo_name,
                    "service": alert.service,
                    "severity": alert.severity.value,
                    "title": alert.title,
                    "fired_at": alert.fired_at.isoformat()
                }
                for alert in self._active_alerts.values()
            ],
            "summary": {
                "total_slos": len(self._slo_status),
                "healthy_slos": sum(1 for s in self._slo_status.values() if s.is_healthy),
                "active_alerts": len(self._active_alerts)
            }
        }


# Global instance
_slo_monitor: Optional[SLOMonitor] = None


def get_slo_monitor() -> SLOMonitor:
    """Get the global SLO monitor instance"""
    global _slo_monitor
    if _slo_monitor is None:
        _slo_monitor = SLOMonitor()
    return _slo_monitor


async def start_slo_monitoring(interval_seconds: int = 60):
    """Start continuous SLO monitoring"""
    monitor = get_slo_monitor()
    
    while True:
        try:
            await monitor.check_all_slos()
            logger.debug("SLO check completed")
        except Exception as e:
            logger.error(f"SLO check failed: {e}")
        
        await asyncio.sleep(interval_seconds)


# Example usage
if __name__ == "__main__":
    async def main():
        monitor = SLOMonitor()
        
        # Check all SLOs
        statuses = await monitor.check_all_slos()
        
        for status in statuses:
            print(f"{status.slo.name}: {status.current_value:.2f}% (target: {status.slo.target}%)")
            print(f"  Error budget remaining: {status.error_budget_remaining:.2f}%")
            print(f"  Burn rate: {status.burn_rate:.2f}x")
            print(f"  Healthy: {status.is_healthy}")
            print()
        
        # Get dashboard data
        dashboard = monitor.get_dashboard_data()
        print(json.dumps(dashboard, indent=2))
    
    asyncio.run(main())
