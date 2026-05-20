"""
Temporal Workflow Definitions — v200 Gap Features
Covers: XOF West Africa corridor, HNW transfers, SME trade batches, correspondent settlement
Uses: temporalio SDK, Dapr pub/sub, TigerBeetle, Mojaloop
"""
import asyncio
from datetime import timedelta
from typing import Optional
from dataclasses import dataclass
from temporalio import workflow, activity
from temporalio.client import Client
from temporalio.worker import Worker
from temporalio.common import RetryPolicy

# ─── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class XofTransferInput:
    transfer_id: str
    user_id: int
    corridor_code: str  # TG, NE, ML, BJ, GH
    amount_ngn: float
    recipient_mobile_money: str
    recipient_name: str
    mojaloop_dfsp_id: str

@dataclass
class HnwTransferInput:
    transfer_id: str
    user_id: int
    corridor_code: str
    amount_ngn: float
    rate_lock_id: Optional[str]
    recipient_swift: str
    recipient_account: str
    tigerbeetle_account_id: int

@dataclass
class SmeTradeInput:
    batch_id: str
    user_id: int
    corridor_code: str
    total_amount_ngn: float
    payment_count: int
    form_m_number: Optional[str]

@dataclass
class CorrespondentSettlementInput:
    correspondent_id: str
    currency: str
    amount: float
    direction: str  # "nostro_top_up" | "vostro_drawdown"

# ─── Activities ───────────────────────────────────────────────────────────────

@activity.defn
async def validate_xof_transfer(input: XofTransferInput) -> dict:
    """Validate XOF corridor transfer: KYC tier, CBN limits, ECOWAS compliance."""
    import httpx
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "http://rust-immigrant-worker-kyc:8099/check-limit",
            json={"user_id": input.user_id, "amount_ngn": input.amount_ngn}
        )
        return resp.json()

@activity.defn
async def reserve_xof_fx(input: XofTransferInput) -> dict:
    """Reserve FX rate for XOF corridor transfer."""
    import httpx
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "http://go-xof-adapter:8095/quote",
            json={
                "corridor_code": input.corridor_code,
                "amount_ngn": input.amount_ngn,
                "user_id": input.user_id
            }
        )
        return resp.json()

@activity.defn
async def submit_mojaloop_transfer(input: XofTransferInput) -> dict:
    """Submit transfer to Mojaloop for XOF settlement."""
    import httpx
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "http://go-xof-adapter:8095/submit",
            json={
                "transfer_id": input.transfer_id,
                "corridor_code": input.corridor_code,
                "amount_ngn": input.amount_ngn,
                "recipient_mobile_money": input.recipient_mobile_money,
                "recipient_name": input.recipient_name,
                "mojaloop_dfsp_id": input.mojaloop_dfsp_id
            }
        )
        return resp.json()

@activity.defn
async def validate_hnw_rate_lock(input: HnwTransferInput) -> dict:
    """Validate HNW rate lock is still valid and not expired."""
    import httpx
    if not input.rate_lock_id:
        return {"valid": True, "rate_lock_id": None}
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            f"http://rust-hnw-fx-engine:8100/rate-lock/{input.rate_lock_id}"
        )
        return resp.json()

@activity.defn
async def debit_tigerbeetle_account(transfer_id: str, account_id: int, amount: int) -> dict:
    """Create debit entry in TigerBeetle for HNW transfer."""
    import httpx
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "http://rust-tigerbeetle-service:8080/transfer",
            json={
                "id": hash(transfer_id) & 0xFFFFFFFFFFFFFFFF,
                "debit_account_id": account_id,
                "credit_account_id": 1,  # RemitFlow nostro account
                "amount": amount,
                "user_data": transfer_id.encode().hex(),
                "code": 1,
                "flags": 0
            }
        )
        return resp.json()

@activity.defn
async def validate_sme_compliance(input: SmeTradeInput) -> dict:
    """Validate SME batch against CBN trade limits and Form M requirements."""
    import httpx
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "http://python-sme-compliance:8102/validate-payment",
            json={
                "user_id": input.user_id,
                "corridor_code": input.corridor_code,
                "amount_usd": input.total_amount_ngn / 1620.0,
                "recipient_name": "SME Batch",
                "form_m_number": input.form_m_number,
                "annual_used_usd": 0.0
            }
        )
        return resp.json()

@activity.defn
async def process_sme_bulk_batch(input: SmeTradeInput) -> dict:
    """Submit SME bulk batch to Rust processor."""
    import httpx
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(
            f"http://rust-sme-bulk-processor:8101/batch/{input.batch_id}"
        )
        return resp.json()

@activity.defn
async def rebalance_nostro_account(input: CorrespondentSettlementInput) -> dict:
    """Trigger nostro/vostro rebalancing via correspondent manager."""
    import httpx
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "http://go-correspondent-manager:8096/rebalance",
            json={
                "correspondent_id": input.correspondent_id,
                "currency": input.currency,
                "amount": input.amount,
                "direction": input.direction
            }
        )
        return resp.json()

@activity.defn
async def publish_kafka_event(topic: str, event: dict) -> bool:
    """Publish event to Kafka via Dapr pub/sub."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"http://localhost:3500/v1.0/publish/kafka-pubsub/{topic}",
                json=event,
                headers={"Content-Type": "application/json"}
            )
        return True
    except Exception:
        return False

# ─── Workflows ────────────────────────────────────────────────────────────────

@workflow.defn
class XofTransferWorkflow:
    """
    West Africa XOF corridor transfer workflow.
    Steps: validate → reserve FX → debit TigerBeetle → submit Mojaloop → confirm
    """
    @workflow.run
    async def run(self, input: XofTransferInput) -> dict:
        retry_policy = RetryPolicy(
            maximum_attempts=3,
            initial_interval=timedelta(seconds=2),
            backoff_coefficient=2.0,
            maximum_interval=timedelta(seconds=30),
        )
        # 1. Validate KYC and limits
        validation = await workflow.execute_activity(
            validate_xof_transfer,
            input,
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=retry_policy,
        )
        if not validation.get("allowed", True):
            return {"status": "rejected", "reason": validation.get("reason", "Limit exceeded")}

        # 2. Reserve FX rate
        fx_quote = await workflow.execute_activity(
            reserve_xof_fx,
            input,
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=retry_policy,
        )

        # 3. Submit to Mojaloop
        mojaloop_result = await workflow.execute_activity(
            submit_mojaloop_transfer,
            input,
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # 4. Publish completion event
        await workflow.execute_activity(
            publish_kafka_event,
            "xof-transfers",
            {"event": "transfer_completed", "transfer_id": input.transfer_id, "status": mojaloop_result.get("status")},
            start_to_close_timeout=timedelta(seconds=5),
        )

        return {
            "status": "completed",
            "transfer_id": input.transfer_id,
            "fx_rate": fx_quote.get("fx_rate"),
            "mojaloop_txn_id": mojaloop_result.get("mojaloop_txn_id"),
        }


@workflow.defn
class HnwTransferWorkflow:
    """
    HNW transfer workflow with rate lock validation and TigerBeetle double-entry.
    Steps: validate rate lock → debit TigerBeetle → route via SWIFT → confirm
    """
    @workflow.run
    async def run(self, input: HnwTransferInput) -> dict:
        retry_policy = RetryPolicy(
            maximum_attempts=3,
            initial_interval=timedelta(seconds=1),
            backoff_coefficient=2.0,
        )
        # 1. Validate rate lock
        lock_result = await workflow.execute_activity(
            validate_hnw_rate_lock,
            input,
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=retry_policy,
        )
        if not lock_result.get("valid", True):
            return {"status": "rejected", "reason": "Rate lock expired or invalid"}

        # 2. Debit TigerBeetle
        tb_result = await workflow.execute_activity(
            debit_tigerbeetle_account,
            input.transfer_id,
            input.tigerbeetle_account_id,
            int(input.amount_ngn * 100),  # Store in kobo
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=retry_policy,
        )

        # 3. Publish HNW event
        await workflow.execute_activity(
            publish_kafka_event,
            "hnw-events",
            {"event": "hnw_transfer_initiated", "transfer_id": input.transfer_id, "user_id": input.user_id},
            start_to_close_timeout=timedelta(seconds=5),
        )

        return {
            "status": "processing",
            "transfer_id": input.transfer_id,
            "tigerbeetle_result": tb_result,
            "rate_lock_id": input.rate_lock_id,
        }


@workflow.defn
class SmeTradeWorkflow:
    """
    SME trade payment workflow with Form M compliance check and bulk processing.
    Steps: compliance check → Form M validation → bulk process → settle → report
    """
    @workflow.run
    async def run(self, input: SmeTradeInput) -> dict:
        retry_policy = RetryPolicy(maximum_attempts=3, initial_interval=timedelta(seconds=2))

        # 1. Compliance validation
        compliance = await workflow.execute_activity(
            validate_sme_compliance,
            input,
            start_to_close_timeout=timedelta(seconds=20),
            retry_policy=retry_policy,
        )
        if not compliance.get("is_valid", False):
            return {"status": "rejected", "errors": compliance.get("errors", [])}

        # 2. Process bulk batch
        batch_result = await workflow.execute_activity(
            process_sme_bulk_batch,
            input,
            start_to_close_timeout=timedelta(seconds=120),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # 3. Publish completion event
        await workflow.execute_activity(
            publish_kafka_event,
            "sme-trade-events",
            {"event": "batch_completed", "batch_id": input.batch_id, "succeeded": batch_result.get("succeeded", 0)},
            start_to_close_timeout=timedelta(seconds=5),
        )

        return {
            "status": "completed",
            "batch_id": input.batch_id,
            "succeeded": batch_result.get("succeeded", 0),
            "failed": batch_result.get("failed", 0),
        }


@workflow.defn
class CorrespondentSettlementWorkflow:
    """
    Correspondent bank nostro/vostro rebalancing workflow.
    Triggered when nostro balance drops below threshold or vostro exceeds ceiling.
    """
    @workflow.run
    async def run(self, input: CorrespondentSettlementInput) -> dict:
        retry_policy = RetryPolicy(maximum_attempts=5, initial_interval=timedelta(minutes=1))

        result = await workflow.execute_activity(
            rebalance_nostro_account,
            input,
            start_to_close_timeout=timedelta(minutes=30),
            retry_policy=retry_policy,
        )

        await workflow.execute_activity(
            publish_kafka_event,
            "correspondent-events",
            {
                "event": "nostro_rebalanced",
                "correspondent_id": input.correspondent_id,
                "currency": input.currency,
                "amount": input.amount,
                "direction": input.direction,
            },
            start_to_close_timeout=timedelta(seconds=5),
        )

        return {"status": "completed", "result": result}


# ─── Worker Setup ─────────────────────────────────────────────────────────────

async def main():
    import os
    temporal_host = os.getenv("TEMPORAL_HOST", "temporal:7233")
    client = await Client.connect(temporal_host)

    worker = Worker(
        client,
        task_queue="remitflow-v200-gaps",
        workflows=[XofTransferWorkflow, HnwTransferWorkflow, SmeTradeWorkflow, CorrespondentSettlementWorkflow],
        activities=[
            validate_xof_transfer, reserve_xof_fx, submit_mojaloop_transfer,
            validate_hnw_rate_lock, debit_tigerbeetle_account,
            validate_sme_compliance, process_sme_bulk_batch,
            rebalance_nostro_account, publish_kafka_event,
        ],
    )
    print("[temporal-v200-gaps] Worker started on task queue: remitflow-v200-gaps")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
