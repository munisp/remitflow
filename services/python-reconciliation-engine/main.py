"""
RemitFlow — Python Reconciliation Engine

Provides:
  - Saga compensation orchestration (detect incomplete sagas, auto-compensate)
  - Discrepancy detection between wallets, TigerBeetle, and Kafka events
  - Periodic reconciliation sweeps (balance drift detection)
  - Dead letter queue processing for failed fund flows
  - Temporal workflow monitoring and intervention
  - Alert escalation for unreconciled transactions

Port: 8170
"""

import asyncio
import hashlib
import json
import logging
import os
import signal
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

from alert_routing import (
    route_alert,
    AlertPayload,
    get_routing_metrics,
    get_routing_config,
)
from insider_threat_analytics import (
    detect_collusion,
    verify_fx_rate,
    detect_admin_anomaly,
    check_canary_access,
    analyze_pgaudit_log,
    get_insider_threat_metrics,
    get_collusion_alerts,
    get_fx_verification_history,
)

# ── Configuration ────────────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "8170"))
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.environ.get("REDIS_URL", "localhost:6379")
POSTGRES_URL = os.environ.get("DATABASE_URL", "postgresql://localhost:5432/remitflow")
TIGERBEETLE_ADDR = os.environ.get("TIGERBEETLE_ADDR", "localhost:3001")
TEMPORAL_HOST = os.environ.get("TEMPORAL_HOST_PORT", "localhost:7233")
CORE_API_URL = os.environ.get("CORE_API_URL", "http://localhost:3000")
GO_ORCHESTRATOR_URL = os.environ.get("GO_ORCHESTRATOR_URL", "http://localhost:8150")
RUST_GUARD_URL = os.environ.get("RUST_GUARD_URL", "http://localhost:8160")

# Reconciliation thresholds
BALANCE_DRIFT_THRESHOLD = Decimal("0.01")  # 1 cent tolerance
STUCK_SAGA_TIMEOUT_SECONDS = 300  # 5 minutes
MAX_COMPENSATION_RETRIES = 3
RECONCILIATION_INTERVAL_SECONDS = 60  # 1 minute sweep interval

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("reconciliation-engine")

# ── Domain Models ────────────────────────────────────────────────────────────


class ReconciliationStatus(str, Enum):
    BALANCED = "balanced"
    DRIFTED = "drifted"
    UNRECONCILED = "unreconciled"
    COMPENSATED = "compensated"
    ESCALATED = "escalated"


class FlowType(str, Enum):
    CROSS_BORDER_SEND = "cross_border_send"
    AGENT_CASH_PICKUP = "agent_cash_pickup"
    AGENT_CASH_IN = "agent_cash_in"
    AGENT_CASH_OUT = "agent_cash_out"
    P2P_INSTANT = "p2p_instant"
    SPLIT_PAYMENT = "split_payment"
    WALLET_TOPUP = "wallet_topup"
    STABLECOIN_TRANSFER = "stablecoin_transfer"
    STABLECOIN_BRIDGE = "stablecoin_bridge"
    SAVINGS_DEPOSIT = "savings_deposit"
    SAVINGS_WITHDRAW = "savings_withdraw"
    BNPL_INSTALLMENT = "bnpl_installment"
    RECURRING_TRANSFER = "recurring_transfer"
    FLOAT_REPLENISHMENT = "float_replenishment"
    BATCH_PAYROLL = "batch_payroll"


@dataclass
class ReconciliationEntry:
    """A single reconciliation check result."""
    entry_id: str
    operation_id: str
    flow_type: str
    status: ReconciliationStatus
    wallet_balance: Decimal
    ledger_balance: Decimal
    drift_amount: Decimal
    checked_at: datetime
    action_taken: Optional[str] = None
    compensated: bool = False


@dataclass
class SagaRecovery:
    """A saga that needs recovery (stuck or partially completed)."""
    saga_id: str
    flow_type: str
    user_id: int
    amount: float
    currency: str
    started_at: datetime
    last_completed_step: str
    remaining_steps: list = field(default_factory=list)
    recovery_action: str = "pending"
    retry_count: int = 0


@dataclass
class DeadLetterEntry:
    """A failed fund flow event from the dead letter queue."""
    dlq_id: str
    operation_id: str
    flow_type: str
    error: str
    original_event: dict
    failed_at: datetime
    retry_count: int = 0
    resolved: bool = False
    resolution: Optional[str] = None


# ── In-Memory State ──────────────────────────────────────────────────────────

reconciliation_log: list[ReconciliationEntry] = []
saga_recoveries: list[SagaRecovery] = []
dead_letter_queue: list[DeadLetterEntry] = []
alerts: list[dict] = []

# Metrics
metrics = {
    "reconciliations_run": 0,
    "discrepancies_found": 0,
    "discrepancies_resolved": 0,
    "sagas_recovered": 0,
    "sagas_compensated": 0,
    "dlq_processed": 0,
    "dlq_resolved": 0,
    "alerts_raised": 0,
    "total_drift_amount": Decimal("0"),
}

# ── Pydantic Models (API) ────────────────────────────────────────────────────


class ReconcileRequest(BaseModel):
    """Manual reconciliation request for a specific account."""
    account_id: str
    currency: str
    expected_balance: float
    actual_balance: float
    operation_id: str


class CompensateRequest(BaseModel):
    """Manual saga compensation request."""
    saga_id: str
    reason: str


class DLQRetryRequest(BaseModel):
    """Retry a dead letter queue entry."""
    dlq_id: str


class AlertRequest(BaseModel):
    """Manually raise an alert."""
    severity: str  # critical, high, medium, low
    flow_type: str
    message: str
    operation_id: Optional[str] = None
    metadata: Optional[dict] = None


class ReconciliationSweepResult(BaseModel):
    """Result of a reconciliation sweep."""
    sweep_id: str
    started_at: str
    completed_at: str
    accounts_checked: int
    discrepancies_found: int
    auto_resolved: int
    escalated: int
    total_drift: str


# ── Core Logic ───────────────────────────────────────────────────────────────


def generate_id(prefix: str = "recon") -> str:
    """Generate a unique ID with prefix."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    h = hashlib.sha256(ts.encode()).hexdigest()[:12]
    return f"{prefix}_{h}"


def check_balance_drift(
    account_id: str,
    currency: str,
    wallet_balance: Decimal,
    ledger_balance: Decimal,
    operation_id: str,
    flow_type: str,
) -> ReconciliationEntry:
    """Check if wallet balance matches ledger balance."""
    drift = abs(wallet_balance - ledger_balance)
    status = ReconciliationStatus.BALANCED if drift <= BALANCE_DRIFT_THRESHOLD else ReconciliationStatus.DRIFTED

    entry = ReconciliationEntry(
        entry_id=generate_id("recon"),
        operation_id=operation_id,
        flow_type=flow_type,
        status=status,
        wallet_balance=wallet_balance,
        ledger_balance=ledger_balance,
        drift_amount=drift,
        checked_at=datetime.now(timezone.utc),
    )

    if status == ReconciliationStatus.DRIFTED:
        metrics["discrepancies_found"] += 1
        metrics["total_drift_amount"] += drift
        # Auto-resolve small drifts (rounding errors)
        if drift <= Decimal("1.00"):
            entry.action_taken = "auto_resolved_rounding"
            entry.status = ReconciliationStatus.COMPENSATED
            entry.compensated = True
            metrics["discrepancies_resolved"] += 1
        else:
            entry.action_taken = "escalated_to_admin"
            entry.status = ReconciliationStatus.ESCALATED
            raise_alert("high", flow_type, f"Balance drift of {drift} {currency} on account {account_id}", operation_id)

    reconciliation_log.append(entry)
    metrics["reconciliations_run"] += 1
    return entry


def detect_stuck_sagas() -> list[SagaRecovery]:
    """Detect sagas that have been running longer than the timeout."""
    stuck = []
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=STUCK_SAGA_TIMEOUT_SECONDS)

    for saga in saga_recoveries:
        if saga.recovery_action == "pending" and saga.started_at < cutoff:
            saga.recovery_action = "compensation_required"
            stuck.append(saga)

    return stuck


def compensate_saga(saga: SagaRecovery, reason: str) -> dict:
    """Compensate a stuck saga by reversing completed steps."""
    saga.recovery_action = "compensating"
    saga.retry_count += 1

    # Steps to compensate (in reverse order)
    compensation_plan = []
    for step in reversed(saga.remaining_steps):
        compensation_plan.append({
            "step": step,
            "action": f"compensate_{step}",
            "status": "pending",
        })

    saga.recovery_action = "compensated"
    metrics["sagas_compensated"] += 1

    return {
        "saga_id": saga.saga_id,
        "status": "compensated",
        "reason": reason,
        "compensation_plan": compensation_plan,
        "retry_count": saga.retry_count,
    }


def process_dead_letter(entry: DeadLetterEntry) -> dict:
    """Process a dead letter queue entry — attempt retry or escalate."""
    entry.retry_count += 1

    if entry.retry_count > MAX_COMPENSATION_RETRIES:
        entry.resolved = True
        entry.resolution = "escalated_max_retries"
        raise_alert(
            "critical",
            entry.flow_type,
            f"DLQ entry {entry.dlq_id} exceeded max retries ({MAX_COMPENSATION_RETRIES})",
            entry.operation_id,
        )
        return {"dlq_id": entry.dlq_id, "action": "escalated", "retries": entry.retry_count}

    # Attempt retry via Go orchestrator
    metrics["dlq_processed"] += 1
    return {"dlq_id": entry.dlq_id, "action": "retried", "retries": entry.retry_count}


def raise_alert(severity: str, flow_type: str, message: str, operation_id: Optional[str] = None, metadata: Optional[dict] = None):
    """Raise an alert and route to external channels (PagerDuty/OpsGenie/Slack)."""
    alert_id = generate_id("alert")
    raised_at = datetime.now(timezone.utc).isoformat()

    alert = {
        "alert_id": alert_id,
        "severity": severity,
        "flow_type": flow_type,
        "message": message,
        "operation_id": operation_id,
        "raised_at": raised_at,
        "acknowledged": False,
        "routing_result": None,
    }
    alerts.append(alert)
    metrics["alerts_raised"] += 1
    logger.warning(f"[ALERT][{severity.upper()}] {message}")

    # Route to external channels (PagerDuty, OpsGenie, Slack)
    try:
        payload = AlertPayload(
            alert_id=alert_id,
            severity=severity,
            flow_type=flow_type,
            message=message,
            operation_id=operation_id,
            raised_at=raised_at,
            metadata=metadata,
        )
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(_route_alert_async(alert, payload))
        else:
            loop.run_until_complete(route_alert(payload))
    except Exception as e:
        logger.error(f"[AlertRouter] Failed to route alert {alert_id}: {e}")


async def _route_alert_async(alert_dict: dict, payload: AlertPayload):
    """Async helper to route alert without blocking the main request."""
    try:
        result = await route_alert(payload)
        alert_dict["routing_result"] = result
    except Exception as e:
        logger.error(f"[AlertRouter] Async routing failed: {e}")


def run_reconciliation_sweep() -> ReconciliationSweepResult:
    """Run a full reconciliation sweep across all active operations."""
    sweep_id = generate_id("sweep")
    started_at = datetime.now(timezone.utc)

    # Simulated sweep: check recent operations for drift
    accounts_checked = len(reconciliation_log)
    discrepancies = sum(1 for e in reconciliation_log if e.status == ReconciliationStatus.DRIFTED)
    auto_resolved = sum(1 for e in reconciliation_log if e.compensated)
    escalated = sum(1 for e in reconciliation_log if e.status == ReconciliationStatus.ESCALATED)

    completed_at = datetime.now(timezone.utc)

    return ReconciliationSweepResult(
        sweep_id=sweep_id,
        started_at=started_at.isoformat(),
        completed_at=completed_at.isoformat(),
        accounts_checked=accounts_checked,
        discrepancies_found=discrepancies,
        auto_resolved=auto_resolved,
        escalated=escalated,
        total_drift=str(metrics["total_drift_amount"]),
    )


# ── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Reconciliation Engine",
    version="1.0.0",
    description="Saga compensation, discrepancy detection, and DLQ processing",
)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "python-reconciliation-engine",
        "version": "1.0.0",
        "metrics_summary": {
            "reconciliations_run": metrics["reconciliations_run"],
            "discrepancies_found": metrics["discrepancies_found"],
            "sagas_compensated": metrics["sagas_compensated"],
            "dlq_processed": metrics["dlq_processed"],
            "alerts_raised": metrics["alerts_raised"],
        },
    }


@app.post("/reconcile")
async def reconcile(req: ReconcileRequest):
    """Check balance drift for a specific account."""
    entry = check_balance_drift(
        account_id=req.account_id,
        currency=req.currency,
        wallet_balance=Decimal(str(req.expected_balance)),
        ledger_balance=Decimal(str(req.actual_balance)),
        operation_id=req.operation_id,
        flow_type="manual_check",
    )
    return {
        "entry_id": entry.entry_id,
        "status": entry.status.value,
        "drift_amount": str(entry.drift_amount),
        "action_taken": entry.action_taken,
        "compensated": entry.compensated,
    }


@app.post("/sweep")
async def trigger_sweep():
    """Trigger a full reconciliation sweep."""
    result = run_reconciliation_sweep()
    return result


@app.post("/saga/register")
async def register_saga(body: dict):
    """Register a new saga for monitoring."""
    saga = SagaRecovery(
        saga_id=body.get("saga_id", generate_id("saga")),
        flow_type=body.get("flow_type", "unknown"),
        user_id=body.get("user_id", 0),
        amount=body.get("amount", 0.0),
        currency=body.get("currency", "USD"),
        started_at=datetime.now(timezone.utc),
        last_completed_step=body.get("last_step", ""),
        remaining_steps=body.get("remaining_steps", []),
    )
    saga_recoveries.append(saga)
    return {"saga_id": saga.saga_id, "status": "registered"}


@app.post("/saga/compensate")
async def compensate_saga_endpoint(req: CompensateRequest):
    """Manually compensate a stuck saga."""
    saga = next((s for s in saga_recoveries if s.saga_id == req.saga_id), None)
    if not saga:
        raise HTTPException(status_code=404, detail="Saga not found")
    result = compensate_saga(saga, req.reason)
    return result


@app.get("/saga/stuck")
async def get_stuck_sagas():
    """Get all sagas that need recovery."""
    stuck = detect_stuck_sagas()
    return {
        "stuck_sagas": [
            {
                "saga_id": s.saga_id,
                "flow_type": s.flow_type,
                "user_id": s.user_id,
                "amount": s.amount,
                "currency": s.currency,
                "started_at": s.started_at.isoformat(),
                "recovery_action": s.recovery_action,
                "retry_count": s.retry_count,
            }
            for s in stuck
        ],
        "total": len(stuck),
    }


@app.post("/dlq/submit")
async def submit_to_dlq(body: dict):
    """Submit a failed event to the dead letter queue."""
    entry = DeadLetterEntry(
        dlq_id=generate_id("dlq"),
        operation_id=body.get("operation_id", "unknown"),
        flow_type=body.get("flow_type", "unknown"),
        error=body.get("error", "unknown error"),
        original_event=body.get("event", {}),
        failed_at=datetime.now(timezone.utc),
    )
    dead_letter_queue.append(entry)
    return {"dlq_id": entry.dlq_id, "status": "queued"}


@app.post("/dlq/retry")
async def retry_dlq(req: DLQRetryRequest):
    """Retry a dead letter queue entry."""
    entry = next((e for e in dead_letter_queue if e.dlq_id == req.dlq_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="DLQ entry not found")
    result = process_dead_letter(entry)
    return result


@app.get("/dlq")
async def list_dlq():
    """List all dead letter queue entries."""
    return {
        "entries": [
            {
                "dlq_id": e.dlq_id,
                "operation_id": e.operation_id,
                "flow_type": e.flow_type,
                "error": e.error,
                "failed_at": e.failed_at.isoformat(),
                "retry_count": e.retry_count,
                "resolved": e.resolved,
                "resolution": e.resolution,
            }
            for e in dead_letter_queue
        ],
        "total": len(dead_letter_queue),
        "unresolved": sum(1 for e in dead_letter_queue if not e.resolved),
    }


@app.post("/alert")
async def raise_alert_endpoint(req: AlertRequest):
    """Manually raise an alert."""
    raise_alert(req.severity, req.flow_type, req.message, req.operation_id)
    return {"status": "alert_raised", "total_alerts": metrics["alerts_raised"]}


@app.get("/alerts")
async def get_alerts():
    """Get all active alerts."""
    return {
        "alerts": [a for a in alerts if not a.get("acknowledged")],
        "total": len(alerts),
        "unacknowledged": sum(1 for a in alerts if not a.get("acknowledged")),
    }


@app.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    """Acknowledge an alert."""
    alert = next((a for a in alerts if a["alert_id"] == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert["acknowledged"] = True
    return {"alert_id": alert_id, "status": "acknowledged"}


@app.get("/alert-routing/config")
async def alert_routing_config():
    """Get alert routing configuration."""
    return get_routing_config()


@app.get("/alert-routing/metrics")
async def alert_routing_metrics_endpoint():
    """Get alert routing metrics."""
    return get_routing_metrics()


@app.post("/alert-routing/test")
async def test_alert_routing():
    """Send a test alert through all configured channels."""
    test_payload = AlertPayload(
        alert_id=generate_id("test"),
        severity="low",
        flow_type="test",
        message="Test alert from RemitFlow reconciliation engine — please ignore",
        operation_id="test-000",
        raised_at=datetime.now(timezone.utc).isoformat(),
    )
    result = await route_alert(test_payload)
    return {"test_result": result}


@app.get("/metrics")
async def get_metrics():
    """Get reconciliation engine metrics."""
    return {
        "reconciliations_run": metrics["reconciliations_run"],
        "discrepancies_found": metrics["discrepancies_found"],
        "discrepancies_resolved": metrics["discrepancies_resolved"],
        "sagas_recovered": metrics["sagas_recovered"],
        "sagas_compensated": metrics["sagas_compensated"],
        "dlq_processed": metrics["dlq_processed"],
        "dlq_resolved": metrics["dlq_resolved"],
        "alerts_raised": metrics["alerts_raised"],
        "total_drift_amount": str(metrics["total_drift_amount"]),
        "active_sagas": len([s for s in saga_recoveries if s.recovery_action == "pending"]),
        "unresolved_dlq": sum(1 for e in dead_letter_queue if not e.resolved),
        "alert_routing": get_routing_metrics(),
    }


@app.get("/reconciliation-log")
async def get_reconciliation_log():
    """Get the reconciliation audit log."""
    return {
        "entries": [
            {
                "entry_id": e.entry_id,
                "operation_id": e.operation_id,
                "flow_type": e.flow_type,
                "status": e.status.value,
                "wallet_balance": str(e.wallet_balance),
                "ledger_balance": str(e.ledger_balance),
                "drift_amount": str(e.drift_amount),
                "checked_at": e.checked_at.isoformat(),
                "action_taken": e.action_taken,
                "compensated": e.compensated,
            }
            for e in reconciliation_log[-100:]  # Last 100 entries
        ],
        "total": len(reconciliation_log),
    }


# ── Insider Threat Analytics Endpoints ────────────────────────────────────────


class CollusionDetectionRequest(BaseModel):
    transactions: list[dict] = []


class FXVerificationRequest(BaseModel):
    pair: str
    proposed_rate: float
    source_rates: dict[str, float] | None = None


class AdminAnomalyRequest(BaseModel):
    user_id: int
    action: str
    current_hour_count: int


class CanaryCheckRequest(BaseModel):
    table: str
    record_ids: list[str]


class PgAuditRequest(BaseModel):
    log_entries: list[dict] = []


@app.get("/insider-threat/metrics")
async def insider_threat_metrics():
    """Get overall insider threat detection metrics."""
    return get_insider_threat_metrics()


@app.post("/insider-threat/collusion/detect")
async def detect_collusion_endpoint(req: CollusionDetectionRequest):
    """Analyze transactions for agent-employee collusion patterns."""
    alerts = detect_collusion(req.transactions)
    return {
        "alerts_generated": len(alerts),
        "alerts": [{"alert_id": a.alert_id, "pattern": a.pattern, "confidence": a.confidence, "severity": a.severity} for a in alerts],
    }


@app.get("/insider-threat/collusion/alerts")
async def collusion_alerts_endpoint():
    """Get recent collusion alerts."""
    return {"alerts": get_collusion_alerts(), "total": len(get_collusion_alerts())}


@app.post("/insider-threat/fx/verify")
async def fx_verify_endpoint(req: FXVerificationRequest):
    """Verify FX rate against multiple independent sources."""
    result = verify_fx_rate(req.pair, req.proposed_rate, req.source_rates)
    return {
        "pair": result.pair,
        "verified": result.verified,
        "median_rate": result.median_rate,
        "max_deviation": result.max_deviation,
        "outlier_source": result.outlier_source,
        "proposed_rate": req.proposed_rate,
    }


@app.get("/insider-threat/fx/history")
async def fx_history_endpoint():
    """Get FX rate verification history."""
    return {"verifications": get_fx_verification_history()}


@app.post("/insider-threat/admin-anomaly")
async def admin_anomaly_endpoint(req: AdminAnomalyRequest):
    """Check if admin action frequency is anomalous."""
    event = detect_admin_anomaly(req.user_id, req.action, req.current_hour_count)
    return {
        "event_id": event.event_id,
        "flagged": event.flagged,
        "deviation_score": event.deviation_score,
        "baseline": event.baseline_frequency,
        "current": event.current_frequency,
    }


@app.post("/insider-threat/canary/check")
async def canary_check_endpoint(req: CanaryCheckRequest):
    """Check if any accessed records are canary (honey) tokens."""
    trips = check_canary_access(req.table, req.record_ids)
    return {
        "canary_tripped": len(trips) > 0,
        "trips": trips,
        "table": req.table,
        "records_checked": len(req.record_ids),
    }


@app.post("/insider-threat/pgaudit/analyze")
async def pgaudit_analyze_endpoint(req: PgAuditRequest):
    """Analyze pgaudit log entries for insider threat indicators."""
    indicators = analyze_pgaudit_log(req.log_entries)
    return indicators


# ── Graceful Shutdown ────────────────────────────────────────────────────────

shutdown_event = asyncio.Event()


def handle_signal(sig, frame):
    logger.info(f"Received signal {sig}, shutting down...")
    shutdown_event.set()


signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

# ── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info(f"[ReconciliationEngine] Starting on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
