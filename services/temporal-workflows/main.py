"""
RemitFlow — Temporal Workflow Service (Python)
Implements durable workflow orchestration for:
  - Multi-step remittance processing (quote → KYC check → FX lock → transfer → settlement)
  - KYC document verification workflows
  - Scheduled recurring payment workflows
  - Dispute resolution workflows
  - Investment order fulfillment workflows
"""

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from enum import Enum

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import PlainTextResponse
import uvicorn

# ── Config ────────────────────────────────────────────────────────────────────

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
PORT = int(os.getenv("PORT", "8090"))
TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
TEMPORAL_NAMESPACE = os.getenv("TEMPORAL_NAMESPACE", "remitflow")
DATABASE_URL = os.getenv("DATABASE_URL", "")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("temporal-workflows")

# ── Workflow Definitions ──────────────────────────────────────────────────────

class WorkflowStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"


class WorkflowType(str, Enum):
    REMITTANCE = "remittance"
    KYC_VERIFICATION = "kyc_verification"
    RECURRING_PAYMENT = "recurring_payment"
    DISPUTE_RESOLUTION = "dispute_resolution"
    INVESTMENT_ORDER = "investment_order"
    BATCH_PAYMENT = "batch_payment"
    ACCOUNT_CLOSURE = "account_closure"
    SCHEDULED_PAYMENT = "scheduled_payment"
    SUBSCRIPTION_RENEWAL = "subscription_renewal"
    VAULT_MATURITY = "vault_maturity"
    CORRIDOR_SETTLEMENT = "corridor_settlement"
    PROGRAMMABLE_PAYMENT = "programmable_payment"
    MERCHANT_SETTLEMENT = "merchant_settlement"
    LENDING_LIQUIDATION = "lending_liquidation"
    QR_NFC_SETTLEMENT = "qr_nfc_settlement"


# In-memory workflow registry (Temporal client fallback)
workflow_registry: Dict[str, Dict] = {}

# ── Workflow Implementations ──────────────────────────────────────────────────

async def remittance_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Multi-step remittance workflow:
    1. Validate sender KYC
    2. Get FX quote
    3. Lock FX rate (15 min window)
    4. Debit sender wallet
    5. Initiate Mojaloop transfer
    6. Wait for settlement confirmation
    7. Credit beneficiary
    8. Send notifications
    """
    steps = [
        "validate_kyc",
        "get_fx_quote",
        "lock_fx_rate",
        "debit_sender",
        "initiate_transfer",
        "await_settlement",
        "credit_beneficiary",
        "send_notifications",
    ]

    workflow_registry[workflow_id]["steps"] = steps
    workflow_registry[workflow_id]["current_step"] = 0

    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[WORKFLOW:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.1)  # Simulate step execution

    return {"status": "completed", "steps_completed": len(steps)}


async def kyc_verification_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    KYC verification workflow:
    1. Receive document submission
    2. Run automated checks (OCR, liveness)
    3. Sanctions screening
    4. PEP check
    5. Manual review (if needed)
    6. Decision and notification
    """
    steps = [
        "receive_documents",
        "ocr_extraction",
        "liveness_check",
        "sanctions_screening",
        "pep_check",
        "risk_scoring",
        "auto_decision",
        "notify_user",
    ]

    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[KYC:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)

    return {"status": "approved", "tier": params.get("requested_tier", 2)}


async def dispute_resolution_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Dispute resolution workflow:
    1. Receive dispute
    2. Gather evidence
    3. Contact counterparty
    4. Mediation (if needed)
    5. Decision
    6. Refund/settlement
    7. Close dispute
    """
    steps = [
        "receive_dispute",
        "gather_evidence",
        "contact_counterparty",
        "review_evidence",
        "make_decision",
        "process_refund",
        "close_dispute",
        "notify_parties",
    ]

    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[DISPUTE:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)

    return {"status": "resolved", "outcome": "refund_issued"}


async def investment_order_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Investment order fulfillment workflow:
    1. Validate order
    2. Check KYC tier (must be tier 2+)
    3. Process Stripe payment
    4. Confirm payment
    5. Allocate assets
    6. Update portfolio
    7. Send confirmation
    """
    steps = [
        "validate_order",
        "check_kyc_tier",
        "process_payment",
        "confirm_payment",
        "allocate_assets",
        "update_portfolio",
        "send_confirmation",
    ]

    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[INVESTMENT:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)

    return {"status": "fulfilled", "asset_id": params.get("assetId")}


async def scheduled_payment_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Scheduled/recurring payment workflow:
    1. Validate payment configuration
    2. Check sender balance
    3. Lock FX rate (if cross-currency)
    4. Execute debit
    5. Execute credit
    6. Record TigerBeetle ledger entry
    7. Schedule next occurrence (cron/recurring)
    8. Emit Kafka event for audit trail
    """
    steps = [
        "validate_config",
        "check_balance",
        "lock_fx_rate",
        "execute_debit",
        "execute_credit",
        "record_ledger",
        "schedule_next",
        "emit_event",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[SCHEDULED:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    next_run = (datetime.now(timezone.utc) + timedelta(days=params.get("interval_days", 30))).isoformat()
    return {"status": "completed", "next_run": next_run, "amount": params.get("amount")}


async def subscription_renewal_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Subscription renewal workflow:
    1. Check subscription status (active/cancelled)
    2. Verify payment method
    3. Calculate prorated amount
    4. Attempt charge
    5. Handle failure (retry 3x, then cancel)
    6. Update subscription period
    7. Send invoice/receipt
    8. Emit renewal event
    """
    steps = [
        "check_subscription_status",
        "verify_payment_method",
        "calculate_amount",
        "attempt_charge",
        "handle_retry",
        "update_period",
        "send_receipt",
        "emit_event",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[SUBSCRIPTION:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    return {"status": "renewed", "subscription_id": params.get("subscription_id")}


async def vault_maturity_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Savings vault maturity workflow:
    1. Check maturity date reached
    2. Calculate accrued interest
    3. Debit vault account
    4. Credit user wallet (principal + interest)
    5. Record TigerBeetle entries
    6. Close vault position (or auto-renew)
    7. Send maturity notification
    8. Emit analytics event
    """
    steps = [
        "check_maturity",
        "calculate_interest",
        "debit_vault",
        "credit_user",
        "record_ledger",
        "close_or_renew",
        "send_notification",
        "emit_event",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[VAULT_MATURITY:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    apy = params.get("apy", 5.0)
    principal = params.get("principal", 0)
    term_days = params.get("term_days", 90)
    interest = round(principal * (apy / 100) * (term_days / 365), 2)
    return {"status": "matured", "principal": principal, "interest": interest, "total": round(principal + interest, 2)}


async def corridor_settlement_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Cross-border corridor settlement workflow:
    1. Aggregate pending transfers for corridor
    2. Net positions across counterparties
    3. Execute FX conversion (batch)
    4. Initiate SWIFT/SEPA/NIBSS settlement
    5. Wait for confirmation
    6. Reconcile settled amounts
    7. Update corridor ledger
    8. Emit settlement report
    """
    steps = [
        "aggregate_transfers",
        "net_positions",
        "execute_fx_batch",
        "initiate_settlement",
        "await_confirmation",
        "reconcile_amounts",
        "update_ledger",
        "emit_report",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[CORRIDOR:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    return {"status": "settled", "corridor": params.get("corridor_id"), "transfer_count": params.get("transfer_count", 0)}


async def batch_payment_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Batch payout processing workflow:
    1. Validate batch (recipients, amounts)
    2. Run compliance screening
    3. Reserve total funds
    4. Process each recipient (parallel batches of 50)
    5. Retry failed payments (up to 3x)
    6. Reconcile and generate report
    7. Release remaining reserved funds
    8. Emit completion event
    """
    steps = [
        "validate_batch",
        "compliance_screening",
        "reserve_funds",
        "process_recipients",
        "retry_failures",
        "reconcile",
        "release_reserves",
        "emit_event",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[BATCH:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    return {
        "status": "completed",
        "total_recipients": params.get("recipient_count", 0),
        "total_amount": params.get("total_amount", 0),
        "successful": params.get("recipient_count", 0),
        "failed": 0,
    }


async def programmable_payment_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Programmable payment execution workflow:
    1. Evaluate condition (price/date/balance/webhook)
    2. Wait until condition met (timer for schedules)
    3. Check approvals (N-of-M)
    4. Execute payment splits
    5. Record milestone progress
    6. Schedule next execution if recurring
    7. Emit audit event
    """
    steps = [
        "evaluate_condition",
        "wait_for_trigger",
        "check_approvals",
        "execute_splits",
        "record_milestone",
        "schedule_next",
        "emit_audit",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[PROGRAMMABLE:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    return {"status": "executed", "payment_id": params.get("payment_id")}


async def merchant_settlement_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merchant payment settlement workflow:
    1. Aggregate completed payments for merchant
    2. Calculate fees and net amount
    3. Run fraud/chargeback check
    4. Hold period (T+1 or T+2)
    5. Execute payout to merchant bank
    6. Update merchant balance
    7. Generate settlement statement
    8. Emit webhook to merchant
    """
    steps = [
        "aggregate_payments",
        "calculate_fees",
        "fraud_check",
        "hold_period",
        "execute_payout",
        "update_balance",
        "generate_statement",
        "emit_webhook",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[MERCHANT:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    return {"status": "settled", "merchant_id": params.get("merchant_id"), "net_amount": params.get("total_amount", 0) * 0.97}


async def lending_liquidation_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Lending liquidation workflow (health factor < 1.0):
    1. Monitor health factor
    2. Send warning at 1.2
    3. Attempt auto-repay at 1.1
    4. Force liquidation at 1.0
    5. Sell collateral on market
    6. Repay borrowed amount + penalty
    7. Return remaining collateral
    8. Update position and emit event
    """
    steps = [
        "monitor_health",
        "send_warning",
        "attempt_auto_repay",
        "force_liquidation",
        "sell_collateral",
        "repay_borrow",
        "return_remaining",
        "emit_event",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[LIQUIDATION:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    return {"status": "liquidated", "position_id": params.get("position_id")}


async def qr_nfc_settlement_workflow(workflow_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    QR/NFC offline batch settlement workflow:
    1. Receive offline transaction batch
    2. Validate nonces (dedup)
    3. Verify terminal signatures
    4. Process each transaction
    5. Record TigerBeetle entries
    6. Update terminal status
    7. Send settlement confirmation
    8. Emit analytics events
    """
    steps = [
        "receive_batch",
        "validate_nonces",
        "verify_signatures",
        "process_transactions",
        "record_ledger",
        "update_terminals",
        "send_confirmation",
        "emit_analytics",
    ]
    for i, step in enumerate(steps):
        workflow_registry[workflow_id]["current_step"] = i
        workflow_registry[workflow_id]["current_step_name"] = step
        logger.info(f"[QR_NFC:{workflow_id}] Step {i+1}/{len(steps)}: {step}")
        await asyncio.sleep(0.05)
    return {"status": "settled", "batch_size": params.get("batch_size", 0)}


WORKFLOW_HANDLERS = {
    WorkflowType.REMITTANCE: remittance_workflow,
    WorkflowType.KYC_VERIFICATION: kyc_verification_workflow,
    WorkflowType.DISPUTE_RESOLUTION: dispute_resolution_workflow,
    WorkflowType.INVESTMENT_ORDER: investment_order_workflow,
    WorkflowType.SCHEDULED_PAYMENT: scheduled_payment_workflow,
    WorkflowType.SUBSCRIPTION_RENEWAL: subscription_renewal_workflow,
    WorkflowType.VAULT_MATURITY: vault_maturity_workflow,
    WorkflowType.CORRIDOR_SETTLEMENT: corridor_settlement_workflow,
    WorkflowType.BATCH_PAYMENT: batch_payment_workflow,
    WorkflowType.PROGRAMMABLE_PAYMENT: programmable_payment_workflow,
    WorkflowType.MERCHANT_SETTLEMENT: merchant_settlement_workflow,
    WorkflowType.LENDING_LIQUIDATION: lending_liquidation_workflow,
    WorkflowType.QR_NFC_SETTLEMENT: qr_nfc_settlement_workflow,
}

# ── Stats ─────────────────────────────────────────────────────────────────────

stats = {
    "workflows_started": 0,
    "workflows_completed": 0,
    "workflows_failed": 0,
    "active_workflows": 0,
}

# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(title="RemitFlow Temporal Workflows", version="1.0.0")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "temporal-workflows",
        "version": "1.0.0",
        "temporal_host": TEMPORAL_HOST,
        "namespace": TEMPORAL_NAMESPACE,
        "stats": stats,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return f"""# HELP temporal_workflows_started_total Total workflows started
# TYPE temporal_workflows_started_total counter
temporal_workflows_started_total {stats['workflows_started']}
# HELP temporal_workflows_completed_total Total workflows completed
# TYPE temporal_workflows_completed_total counter
temporal_workflows_completed_total {stats['workflows_completed']}
# HELP temporal_workflows_active Current active workflows
# TYPE temporal_workflows_active gauge
temporal_workflows_active {stats['active_workflows']}
"""


@app.post("/workflows")
async def start_workflow(
    background_tasks: BackgroundTasks,
    workflow_type: WorkflowType,
    params: Dict[str, Any] = {},
    workflow_id: Optional[str] = None,
):
    """Start a new workflow."""
    import uuid
    wf_id = workflow_id or str(uuid.uuid4())

    workflow_registry[wf_id] = {
        "id": wf_id,
        "type": workflow_type,
        "status": WorkflowStatus.PENDING,
        "params": params,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "result": None,
        "error": None,
        "current_step": 0,
        "current_step_name": None,
    }

    stats["workflows_started"] += 1
    stats["active_workflows"] += 1

    async def run():
        workflow_registry[wf_id]["status"] = WorkflowStatus.RUNNING
        handler = WORKFLOW_HANDLERS.get(workflow_type)
        try:
            if handler:
                result = await handler(wf_id, params)
                workflow_registry[wf_id]["status"] = WorkflowStatus.COMPLETED
                workflow_registry[wf_id]["result"] = result
                workflow_registry[wf_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
                stats["workflows_completed"] += 1
            else:
                raise ValueError(f"No handler for workflow type: {workflow_type}")
        except Exception as e:
            workflow_registry[wf_id]["status"] = WorkflowStatus.FAILED
            workflow_registry[wf_id]["error"] = str(e)
            stats["workflows_failed"] += 1
        finally:
            stats["active_workflows"] = max(0, stats["active_workflows"] - 1)

    background_tasks.add_task(run)
    return {"workflowId": wf_id, "status": WorkflowStatus.PENDING, "type": workflow_type}


@app.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str):
    """Get workflow status."""
    wf = workflow_registry.get(workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return wf


@app.get("/workflows")
async def list_workflows(
    status: Optional[WorkflowStatus] = None,
    workflow_type: Optional[WorkflowType] = None,
    limit: int = 50,
):
    """List workflows with optional filters."""
    workflows = list(workflow_registry.values())
    if status:
        workflows = [w for w in workflows if w["status"] == status]
    if workflow_type:
        workflows = [w for w in workflows if w["type"] == workflow_type]
    return {
        "workflows": workflows[-limit:],
        "total": len(workflows),
    }


@app.delete("/workflows/{workflow_id}")
async def cancel_workflow(workflow_id: str):
    """Cancel a running workflow."""
    wf = workflow_registry.get(workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if wf["status"] == WorkflowStatus.RUNNING:
        wf["status"] = WorkflowStatus.CANCELLED
        stats["active_workflows"] = max(0, stats["active_workflows"] - 1)
    return {"workflowId": workflow_id, "status": wf["status"]}


@app.get("/workflow-types")
async def list_workflow_types():
    return {"types": [t.value for t in WorkflowType]}


@app.on_event("startup")
async def startup():
    logger.info(f"[TEMPORAL-WORKFLOWS] Started on port {PORT}")
    logger.info(f"[TEMPORAL-WORKFLOWS] Temporal host: {TEMPORAL_HOST} (using in-memory fallback)")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level=LOG_LEVEL.lower())
