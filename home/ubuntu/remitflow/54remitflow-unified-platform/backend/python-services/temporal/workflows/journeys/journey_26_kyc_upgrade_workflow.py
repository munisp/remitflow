"""""
KYC Upgrade Temporal Workflow - Production Implementation
Journey: journey_26_kyc_upgrade
Orchestrates the multi-step process of upgrading a user's KYC tier.
"""

from temporalio import workflow
from temporalio.common import RetryPolicy
from datetime import timedelta
from typing import Dict, Any, List

# Import activities
with workflow.unsafe.imports_passed_through():
    from ...activities.journeys.journey_26_kyc_upgrade_activities import (
        validate_input,
        check_eligibility_activity,
        request_document_upload_activity,
        initiate_video_kyc_activity,
        create_enhanced_diligence_case_activity,
        finalize_tier_upgrade_activity,
        send_notification_activity
    )

@workflow.defn(name="KYCUpgradeWorkflow")
class KYCUpgradeWorkflow:
    """Orchestrates the KYC tier upgrade process."""

    def __init__(self):
        self.status: str = "pending"
        self.user_id: str = ""
        self.target_tier: str = ""
        self.required_steps: List[str] = []
        self.completed_steps: List[str] = []
        self.error_message: str = ""

    @workflow.run
    async def run(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Main workflow execution for KYC upgrade."""
        self.user_id = input_data.get("user_id")
        self.target_tier = input_data.get("target_tier")
        workflow.logger.info(f"Starting KYC upgrade workflow for user {self.user_id} to tier {self.target_tier}")

        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=5),
            backoff_coefficient=2.0,
            maximum_interval=timedelta(seconds=60),
            maximum_attempts=3
        )

        try:
            # 1. Validate Input
            self.status = "validating_input"
            await workflow.execute_activity(
                validate_input, input_data, start_to_close_timeout=timedelta(seconds=10)
            )
            self.completed_steps.append("input_validated")

            # 2. Check Eligibility
            self.status = "checking_eligibility"
            eligibility = await workflow.execute_activity(
                check_eligibility_activity, args=[self.user_id, self.target_tier], 
                start_to_close_timeout=timedelta(seconds=30), retry_policy=retry_policy
            )

            if not eligibility.get("eligible"):
                self.status = "failed"
                self.error_message = f"Not eligible for upgrade. Missing: {eligibility.get('requirements_missing')}"
                workflow.logger.warning(f"Workflow failed for {self.user_id}: {self.error_message}")
                await workflow.execute_activity(
                    send_notification_activity, args=[self.user_id, "kyc_upgrade_ineligible", {"reason": self.error_message}],
                    start_to_close_timeout=timedelta(seconds=20)
                )
                return {"status": "failed", "reason": self.error_message}

            self.required_steps = eligibility.get("requirements_pending", [])
            self.completed_steps.append("eligibility_checked")

            # 3. Execute Required Steps (e.g., document upload, video kyc)
            if "document_upload" in self.required_steps:
                self.status = "awaiting_documents"
                await workflow.execute_activity(
                    request_document_upload_activity, args=[self.user_id, eligibility.get("documents_needed", [])],
                    start_to_close_timeout=timedelta(seconds=20)
                )
                # In a real workflow, we would wait for a signal that documents are uploaded.
                await workflow.wait_for(lambda: "documents_uploaded" in self.completed_steps, timeout=timedelta(days=1))

            if "liveness_check" in self.required_steps or "video_kyc" in self.required_steps:
                self.status = "awaiting_video_kyc"
                # This might involve creating a case first
                case_result = await workflow.execute_activity(
                    create_enhanced_diligence_case_activity, args=[self.user_id, self.target_tier],
                    start_to_close_timeout=timedelta(seconds=30), retry_policy=retry_policy
                )
                await workflow.execute_activity(
                    initiate_video_kyc_activity, args=[self.user_id, case_result.get("id")],
                    start_to_close_timeout=timedelta(seconds=30), retry_policy=retry_policy
                )
                # Wait for signal of video KYC completion
                await workflow.wait_for(lambda: "video_kyc_completed" in self.completed_steps, timeout=timedelta(hours=2))

            # 4. Finalize Upgrade
            self.status = "finalizing_upgrade"
            result = await workflow.execute_activity(
                finalize_tier_upgrade_activity, args=[self.user_id, self.target_tier],
                start_to_close_timeout=timedelta(seconds=45), retry_policy=retry_policy
            )
            self.completed_steps.append("upgrade_finalized")

            self.status = "completed"
            workflow.logger.info(f"KYC upgrade workflow completed successfully for user {self.user_id}.")
            return {"status": "completed", "result": result}

        except Exception as e:
            self.status = "error"
            self.error_message = str(e)
            workflow.logger.error(f"KYC upgrade workflow failed for user {self.user_id} with error: {e}")
            await workflow.execute_activity(
                send_notification_activity, args=[self.user_id, "kyc_upgrade_error", {"error": self.error_message}],
                start_to_close_timeout=timedelta(seconds=20)
            )
            return {"status": "error", "message": self.error_message}

    @workflow.query
    def get_status(self) -> Dict[str, Any]:
        """Query current workflow status."""
        return {
            "status": self.status,
            "user_id": self.user_id,
            "target_tier": self.target_tier,
            "completed_steps": self.completed_steps,
            "pending_steps": self.required_steps,
            "error": self.error_message
        }

    @workflow.signal
    def document_upload_completed(self, documents: List[Dict[str, Any]]):
        """Signal that the user has completed document upload."""
        workflow.logger.info(f"Received signal: document_upload_completed for user {self.user_id}")
        self.completed_steps.append("documents_uploaded")

    @workflow.signal
    def video_kyc_completed(self, result: Dict[str, Any]):
        """Signal that the video kyc process is complete."""
        workflow.logger.info(f"Received signal: video_kyc_completed for user {self.user_id}")
        self.completed_steps.append("video_kyc_completed")
