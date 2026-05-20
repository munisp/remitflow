"""
Temporal Workflow Integration for Mojaloop
Orchestrates payment flows using Temporal workflows
"""

import asyncio
from datetime import timedelta
from typing import Dict, Any
from temporalio import workflow, activity
from temporalio.common import RetryPolicy


# Activities

@activity.defn
async def validate_participant(participant_id: str) -> Dict[str, Any]:
    """Validate participant exists and is active"""
    # In production, this would query the database
    return {
        "participant_id": participant_id,
        "valid": True,
        "status": "ACTIVE"
    }


@activity.defn
async def create_quote(quote_request: Dict[str, Any]) -> Dict[str, Any]:
    """Create a quote for the transfer"""
    # In production, this would call Mojaloop quote service
    return {
        "quote_id": "quote-123",
        "amount": quote_request["amount"],
        "fees": "15.00",
        "total_amount": str(float(quote_request["amount"]) + 15.0),
        "status": "PENDING"
    }


@activity.defn
async def prepare_transfer(transfer_request: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare the transfer"""
    # In production, this would call Mojaloop transfer service
    return {
        "transfer_id": "transfer-123",
        "quote_id": transfer_request["quote_id"],
        "state": "RESERVED",
        "amount": transfer_request["amount"]
    }


@activity.defn
async def fulfill_transfer(transfer_id: str, fulfillment: str) -> Dict[str, Any]:
    """Fulfill the transfer"""
    # In production, this would call Mojaloop transfer service
    return {
        "transfer_id": transfer_id,
        "state": "COMMITTED",
        "fulfillment": fulfillment
    }


@activity.defn
async def process_settlement(settlement_request: Dict[str, Any]) -> Dict[str, Any]:
    """Process settlement for the transfer"""
    # In production, this would call settlement service
    return {
        "settlement_id": "settlement-123",
        "transfer_id": settlement_request["transfer_id"],
        "status": "SETTLED"
    }


@activity.defn
async def send_notification(notification_data: Dict[str, Any]) -> None:
    """Send notification about payment status"""
    # In production, this would send actual notifications
    print(f"Notification sent: {notification_data}")


@activity.defn
async def publish_payment_event(event_data: Dict[str, Any]) -> None:
    """Publish payment event to Kafka"""
    # In production, this would publish to Kafka
    print(f"Event published: {event_data}")


# Workflows

@workflow.defn
class DomesticPaymentWorkflow:
    """Workflow for processing domestic payments"""
    
    @workflow.run
    async def run(self, payment_request: Dict[str, Any]) -> Dict[str, Any]:
        """Execute domestic payment workflow"""
        
        # Step 1: Validate participants
        payer_validation = await workflow.execute_activity(
            validate_participant,
            payment_request["payer_fsp"],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(
                maximum_attempts=3,
                initial_interval=timedelta(seconds=1),
                maximum_interval=timedelta(seconds=10)
            )
        )
        
        if not payer_validation["valid"]:
            return {"status": "FAILED", "reason": "Invalid payer FSP"}
        
        payee_validation = await workflow.execute_activity(
            validate_participant,
            payment_request["payee_fsp"],
            start_to_close_timeout=timedelta(seconds=10)
        )
        
        if not payee_validation["valid"]:
            return {"status": "FAILED", "reason": "Invalid payee FSP"}
        
        # Step 2: Create quote
        quote = await workflow.execute_activity(
            create_quote,
            {
                "payer_fsp": payment_request["payer_fsp"],
                "payee_fsp": payment_request["payee_fsp"],
                "amount": payment_request["amount"],
                "currency": payment_request["currency"]
            },
            start_to_close_timeout=timedelta(seconds=30)
        )
        
        # Step 3: Prepare transfer
        transfer = await workflow.execute_activity(
            prepare_transfer,
            {
                "quote_id": quote["quote_id"],
                "payer_fsp": payment_request["payer_fsp"],
                "payee_fsp": payment_request["payee_fsp"],
                "amount": payment_request["amount"],
                "currency": payment_request["currency"]
            },
            start_to_close_timeout=timedelta(seconds=30)
        )
        
        # Step 4: Fulfill transfer
        fulfilled_transfer = await workflow.execute_activity(
            fulfill_transfer,
            transfer["transfer_id"],
            "fulfillment-data",
            start_to_close_timeout=timedelta(seconds=30)
        )
        
        # Step 5: Process settlement
        settlement = await workflow.execute_activity(
            process_settlement,
            {
                "transfer_id": fulfilled_transfer["transfer_id"],
                "payer_fsp": payment_request["payer_fsp"],
                "payee_fsp": payment_request["payee_fsp"],
                "amount": payment_request["amount"]
            },
            start_to_close_timeout=timedelta(seconds=60)
        )
        
        # Step 6: Send notifications
        await workflow.execute_activity(
            send_notification,
            {
                "type": "payment_completed",
                "transfer_id": fulfilled_transfer["transfer_id"],
                "amount": payment_request["amount"]
            },
            start_to_close_timeout=timedelta(seconds=10)
        )
        
        # Step 7: Publish event
        await workflow.execute_activity(
            publish_payment_event,
            {
                "event_type": "payment.completed",
                "transfer_id": fulfilled_transfer["transfer_id"],
                "quote_id": quote["quote_id"],
                "settlement_id": settlement["settlement_id"]
            },
            start_to_close_timeout=timedelta(seconds=10)
        )
        
        return {
            "status": "SUCCESS",
            "quote_id": quote["quote_id"],
            "transfer_id": fulfilled_transfer["transfer_id"],
            "settlement_id": settlement["settlement_id"],
            "amount": payment_request["amount"],
            "fees": quote["fees"],
            "total_amount": quote["total_amount"]
        }


@workflow.defn
class CrossBorderPaymentWorkflow:
    """Workflow for processing cross-border payments"""
    
    @workflow.run
    async def run(self, payment_request: Dict[str, Any]) -> Dict[str, Any]:
        """Execute cross-border payment workflow"""
        
        # Step 1: Validate participants
        payer_validation = await workflow.execute_activity(
            validate_participant,
            payment_request["payer_fsp"],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=3)
        )
        
        if not payer_validation["valid"]:
            return {"status": "FAILED", "reason": "Invalid payer FSP"}
        
        payee_validation = await workflow.execute_activity(
            validate_participant,
            payment_request["payee_fsp"],
            start_to_close_timeout=timedelta(seconds=10)
        )
        
        if not payee_validation["valid"]:
            return {"status": "FAILED", "reason": "Invalid payee FSP"}
        
        # Step 2: Create quote with FX
        quote = await workflow.execute_activity(
            create_quote,
            {
                "payer_fsp": payment_request["payer_fsp"],
                "payee_fsp": payment_request["payee_fsp"],
                "amount": payment_request["amount"],
                "source_currency": payment_request["source_currency"],
                "target_currency": payment_request["target_currency"]
            },
            start_to_close_timeout=timedelta(seconds=60)  # Longer timeout for FX
        )
        
        # Step 3: Prepare transfer
        transfer = await workflow.execute_activity(
            prepare_transfer,
            {
                "quote_id": quote["quote_id"],
                "payer_fsp": payment_request["payer_fsp"],
                "payee_fsp": payment_request["payee_fsp"],
                "amount": payment_request["amount"],
                "source_currency": payment_request["source_currency"],
                "target_currency": payment_request["target_currency"]
            },
            start_to_close_timeout=timedelta(seconds=60)
        )
        
        # Step 4: Fulfill transfer
        fulfilled_transfer = await workflow.execute_activity(
            fulfill_transfer,
            transfer["transfer_id"],
            "fulfillment-data",
            start_to_close_timeout=timedelta(seconds=60)
        )
        
        # Step 5: Process settlement
        settlement = await workflow.execute_activity(
            process_settlement,
            {
                "transfer_id": fulfilled_transfer["transfer_id"],
                "payer_fsp": payment_request["payer_fsp"],
                "payee_fsp": payment_request["payee_fsp"],
                "amount": payment_request["amount"]
            },
            start_to_close_timeout=timedelta(seconds=120)  # Longer for cross-border
        )
        
        # Step 6: Send notifications
        await workflow.execute_activity(
            send_notification,
            {
                "type": "cross_border_payment_completed",
                "transfer_id": fulfilled_transfer["transfer_id"],
                "amount": payment_request["amount"]
            },
            start_to_close_timeout=timedelta(seconds=10)
        )
        
        # Step 7: Publish event
        await workflow.execute_activity(
            publish_payment_event,
            {
                "event_type": "payment.cross_border.completed",
                "transfer_id": fulfilled_transfer["transfer_id"],
                "quote_id": quote["quote_id"],
                "settlement_id": settlement["settlement_id"]
            },
            start_to_close_timeout=timedelta(seconds=10)
        )
        
        return {
            "status": "SUCCESS",
            "quote_id": quote["quote_id"],
            "transfer_id": fulfilled_transfer["transfer_id"],
            "settlement_id": settlement["settlement_id"],
            "amount": payment_request["amount"],
            "fees": quote["fees"],
            "total_amount": quote["total_amount"]
        }


@workflow.defn
class SettlementWorkflow:
    """Workflow for processing settlement batches"""
    
    @workflow.run
    async def run(self, settlement_window_id: str) -> Dict[str, Any]:
        """Execute settlement workflow for a settlement window"""
        
        # Step 1: Close settlement window
        # Step 2: Calculate net positions
        # Step 3: Process settlements
        # Step 4: Update ledger
        # Step 5: Send notifications
        
        return {
            "status": "SUCCESS",
            "settlement_window_id": settlement_window_id,
            "settlements_processed": 100
        }

