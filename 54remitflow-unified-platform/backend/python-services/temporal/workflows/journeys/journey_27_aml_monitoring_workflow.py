"""""
AML Monitoring Temporal Workflow - Production Implementation
Journey: journey_27_aml
Orchestrates the real-time AML monitoring of a transaction.
""""

from temporalio import workflow
from temporalio.common import RetryPolicy
from datetime import timedelta
from typing import Dict, Any

# Import activities
with workflow.unsafe.imports_passed_through():
    from ...activities.journeys.journey_27_aml_activities import (
        validate_input,
        screen_customer_activity,
        process_transaction_activity,
        create_case_for_review_activity,
        send_notification_activity
    )

@workflow.defn(name="AMLMonitoringWorkflow")
class AMLMonitoringWorkflow:
    """Orchestrates the AML check for a single transaction."""

    def __init__(self):
        self.status: str = "pending"
        self.transaction_id: str = ""
        self.customer_id: str = ""
        self.is_blocked: bool = False
        self.requires_review: bool = False
        self.error_message: str = ""

    @workflow.run
    async def run(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Main workflow execution for AML transaction monitoring."""
        self.transaction_id = input_data.get("transaction_id")
        self.customer_id = input_data.get("customer_id")
        workflow.logger.info(f"Starting AML workflow for transaction {self.transaction_id} from customer {self.customer_id}")

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=2),
            backoff_coefficient=2.0,
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3
        )

        try:
            # 1. Validate Input
            self.status = "validating_input"
            await workflow.execute_activity(
                validate_input, input_data, start_to_close_timeout=timedelta(seconds=10)
            )

            # 2. Process Transaction through AML Engine
            self.status = "processing_transaction"
            aml_result = await workflow.execute_activity(
                process_transaction_activity, args=[input_data],
                start_to_close_timeout=timedelta(seconds=45), retry_policy=retry_policy
            )

            self.is_blocked = aml_result.get("blocked", False)
            self.requires_review = aml_result.get("requires_review", False)

            # 3. Handle Outcome
            if self.is_blocked:
                self.status = "blocked"
                workflow.logger.critical(f"Transaction {self.transaction_id} BLOCKED by AML engine.")
                # Notify compliance immediately
                await workflow.execute_activity(
                    send_notification_activity, args=["compliance_team", "transaction_blocked", {"transaction_id": self.transaction_id, "reason": "High-risk score or direct sanctions match"}],
                    start_to_close_timeout=timedelta(seconds=20)
                )
                # A compensation activity to hold/reverse the transaction would be called here
                return {"status": "blocked", "reason": "AML policy violation"}

            elif self.requires_review:
                self.status = "pending_review"
                workflow.logger.warning(f"Transaction {self.transaction_id} requires manual compliance review.")
                # Create a case for the compliance team
                await workflow.execute_activity(
                    create_case_for_review_activity, 
                    args=[self.customer_id, self.transaction_id, "High AML risk score", aml_result.get("risk_level", "HIGH")],
                    start_to_close_timeout=timedelta(seconds=30), retry_policy=retry_policy
                )
                # The transaction might be held pending review. This would involve another activity call.
                return {"status": "pending_review", "details": aml_result}

            else:
                self.status = "completed"
                workflow.logger.info(f"Transaction {self.transaction_id} cleared AML checks.")
                return {"status": "cleared", "risk_level": aml_result.get("risk_level", "LOW")}

        except Exception as e:
            self.status = "error"
            self.error_message = str(e)
            workflow.logger.error(f"AML workflow for transaction {self.transaction_id} failed with error: {e}")
            # Create a case for review on technical failure
            await workflow.execute_activity(
                create_case_for_review_activity, 
                args=[self.customer_id, self.transaction_id, "Workflow technical error", "CRITICAL"],
                start_to_close_timeout=timedelta(seconds=30)
            )
            return {"status": "error", "message": self.error_message}

    @workflow.query
    def get_status(self) -> Dict[str, Any]:
        """Query current workflow status."""
        return {
            "status": self.status,
            "transaction_id": self.transaction_id,
            "is_blocked": self.is_blocked,
            "requires_review": self.requires_review,
            "error": self.error_message
        }
