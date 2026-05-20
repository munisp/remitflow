"""
KYC Verification Workflow for Nigerian Remittance Platform
Orchestrates identity verification process using open-source KYB and OCR technologies
"""

from datetime import timedelta
from typing import Dict, Any, List
from temporalio import workflow
from temporalio.common import RetryPolicy

# Import activities
with workflow.unsafe.imports_passed_through():
    from activities.kyc_activities import (
        collect_documents,
        verify_identity_ocr,
        check_sanctions,
        verify_business_opensource,
        approve_kyc,
        reject_kyc,
        send_kyc_notification
    )


@workflow.defn
class KYCVerificationWorkflow:
    """
    KYC Verification Workflow
    
    Orchestrates complete KYC process:
    - Document collection
    - OCR verification (OLMOCR/GOT-OCR2.0)
    - Sanctions screening
    - Open-source KYB verification
    - Approval/Rejection
    - Notifications
    """
    
    @workflow.run
    async def run(self, kyc_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute KYC verification workflow
        
        Args:
            kyc_data: KYC information including:
                - user_id: User identifier
                - kyc_type: Type of KYC (individual/business)
                - documents: List of document references
                - personal_info: Personal/business information
                - country: Country of residence
        
        Returns:
            Dict containing KYC verification results
        """
        workflow.logger.info(
            f"Starting KYC workflow for user_id: {kyc_data.get('user_id')}"
        )
        
        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=2),
            maximum_interval=timedelta(seconds=60),
            maximum_attempts=3,
            backoff_coefficient=2.0,
        )
        
        workflow_result = {
            "user_id": kyc_data.get("user_id"),
            "kyc_type": kyc_data.get("kyc_type"),
            "status": "processing",
            "steps_completed": [],
            "verification_details": {},
            "errors": []
        }
        
        try:
            # Step 1: Collect and validate documents
            workflow.logger.info("Step 1: Collecting and validating documents")
            document_result = await workflow.execute_activity(
                collect_documents,
                kyc_data,
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=retry_policy,
            )
            
            if not document_result["success"]:
                workflow_result["status"] = "documents_incomplete"
                workflow_result["errors"].append(document_result["error"])
                
                await workflow.execute_activity(
                    send_kyc_notification,
                    {
                        "user_id": kyc_data.get("user_id"),
                        "type": "documents_required",
                        "message": f"Additional documents required: {document_result['error']}"
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                )
                
                return workflow_result
            
            workflow_result["steps_completed"].append("document_collection")
            workflow_result["verification_details"]["documents"] = document_result.get("documents")
            workflow.logger.info(f"Documents collected: {len(document_result.get('documents', []))}")
            
            # Step 2: OCR Verification (OLMOCR/GOT-OCR2.0)
            workflow.logger.info("Step 2: Performing OCR verification")
            ocr_result = await workflow.execute_activity(
                verify_identity_ocr,
                {
                    "user_id": kyc_data.get("user_id"),
                    "documents": document_result.get("documents"),
                    "personal_info": kyc_data.get("personal_info")
                },
                start_to_close_timeout=timedelta(minutes=3),
                retry_policy=retry_policy,
            )
            
            if not ocr_result["verified"]:
                workflow.logger.warning(f"OCR verification failed: {ocr_result['reason']}")
                workflow_result["status"] = "ocr_failed"
                workflow_result["errors"].append(ocr_result["reason"])
                workflow_result["verification_details"]["ocr"] = ocr_result
                
                # Reject KYC
                await workflow.execute_activity(
                    reject_kyc,
                    {
                        "user_id": kyc_data.get("user_id"),
                        "reason": f"OCR verification failed: {ocr_result['reason']}"
                    },
                    start_to_close_timeout=timedelta(seconds=30),
                )
                
                await workflow.execute_activity(
                    send_kyc_notification,
                    {
                        "user_id": kyc_data.get("user_id"),
                        "type": "kyc_rejected",
                        "message": f"KYC verification failed: {ocr_result['reason']}"
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                )
                
                return workflow_result
            
            workflow_result["steps_completed"].append("ocr_verification")
            workflow_result["verification_details"]["ocr"] = {
                "verified": True,
                "confidence": ocr_result.get("confidence"),
                "extracted_data": ocr_result.get("extracted_data")
            }
            workflow.logger.info(f"OCR verification passed with confidence: {ocr_result.get('confidence')}")
            
            # Step 3: Sanctions Screening
            workflow.logger.info("Step 3: Performing sanctions screening")
            sanctions_result = await workflow.execute_activity(
                check_sanctions,
                {
                    "user_id": kyc_data.get("user_id"),
                    "personal_info": kyc_data.get("personal_info"),
                    "country": kyc_data.get("country")
                },
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry_policy,
            )
            
            if sanctions_result["is_sanctioned"]:
                workflow.logger.warning(f"User is on sanctions list: {sanctions_result['details']}")
                workflow_result["status"] = "sanctioned"
                workflow_result["errors"].append("User appears on sanctions list")
                workflow_result["verification_details"]["sanctions"] = sanctions_result
                
                # Reject KYC
                await workflow.execute_activity(
                    reject_kyc,
                    {
                        "user_id": kyc_data.get("user_id"),
                        "reason": "User appears on sanctions list"
                    },
                    start_to_close_timeout=timedelta(seconds=30),
                )
                
                await workflow.execute_activity(
                    send_kyc_notification,
                    {
                        "user_id": kyc_data.get("user_id"),
                        "type": "kyc_rejected",
                        "message": "KYC verification cannot be completed"
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                )
                
                return workflow_result
            
            workflow_result["steps_completed"].append("sanctions_check")
            workflow_result["verification_details"]["sanctions"] = {
                "is_sanctioned": False,
                "checked_lists": sanctions_result.get("checked_lists")
            }
            workflow.logger.info("Sanctions screening passed")
            
            # Step 4: Open-Source KYB Verification (for business accounts)
            if kyc_data.get("kyc_type") == "business":
                workflow.logger.info("Step 4: Performing open-source KYB verification")
                kyb_result = await workflow.execute_activity(
                    verify_business_opensource,
                    {
                        "user_id": kyc_data.get("user_id"),
                        "business_info": kyc_data.get("personal_info"),
                        "documents": document_result.get("documents")
                    },
                    start_to_close_timeout=timedelta(minutes=5),
                    retry_policy=retry_policy,
                )
                
                if not kyb_result["verified"]:
                    workflow.logger.warning(f"Open-source KYB failed: {kyb_result['reason']}")
                    workflow_result["status"] = "kyb_failed"
                    workflow_result["errors"].append(kyb_result["reason"])
                    workflow_result["verification_details"]["opensource_kyb"] = kyb_result
                    
                    # Reject KYC
                    await workflow.execute_activity(
                        reject_kyc,
                        {
                            "user_id": kyc_data.get("user_id"),
                            "reason": f"Business verification failed: {kyb_result['reason']}"
                        },
                        start_to_close_timeout=timedelta(seconds=30),
                    )
                    
                    await workflow.execute_activity(
                        send_kyc_notification,
                        {
                            "user_id": kyc_data.get("user_id"),
                            "type": "kyc_rejected",
                            "message": f"Business verification failed: {kyb_result['reason']}"
                        },
                        start_to_close_timeout=timedelta(seconds=15),
                    )
                    
                    return workflow_result
                
                workflow_result["steps_completed"].append("opensource_kyb")
                workflow_result["verification_details"]["opensource_kyb"] = {
                    "verified": True,
                    "risk_score": kyb_result.get("risk_score"),
                    "business_verified": True
                }
                workflow.logger.info(f"Open-source KYB passed with risk score: {kyb_result.get('risk_score')}")
            
            # Step 5: Approve KYC
            workflow.logger.info("Step 5: Approving KYC")
            approval_result = await workflow.execute_activity(
                approve_kyc,
                {
                    "user_id": kyc_data.get("user_id"),
                    "kyc_type": kyc_data.get("kyc_type"),
                    "verification_details": workflow_result["verification_details"]
                },
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy,
            )
            
            workflow_result["steps_completed"].append("approval")
            workflow_result["status"] = "approved"
            workflow_result["kyc_id"] = approval_result.get("kyc_id")
            workflow_result["approval_date"] = approval_result.get("approval_date")
            
            # Step 6: Send approval notification
            workflow.logger.info("Step 6: Sending approval notification")
            await workflow.execute_activity(
                send_kyc_notification,
                {
                    "user_id": kyc_data.get("user_id"),
                    "type": "kyc_approved",
                    "message": "Your KYC verification has been approved. You can now use all platform features."
                },
                start_to_close_timeout=timedelta(seconds=15),
            )
            
            workflow_result["steps_completed"].append("notification")
            
            workflow.logger.info(f"KYC workflow completed successfully for user_id: {kyc_data.get('user_id')}")
            
            return workflow_result
            
        except Exception as e:
            workflow.logger.error(f"KYC workflow failed with exception: {str(e)}")
            workflow_result["status"] = "error"
            workflow_result["errors"].append(str(e))
            
            # Attempt to send error notification
            try:
                await workflow.execute_activity(
                    send_kyc_notification,
                    {
                        "user_id": kyc_data.get("user_id"),
                        "type": "kyc_error",
                        "message": "KYC verification encountered an error. Please contact support."
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                )
            except Exception as e:
                workflow.logger.error(f"Failed to send notification: {e}")
            
            return workflow_result


@workflow.defn
class KYCUpdateWorkflow:
    """
    KYC Update Workflow
    
    Handles periodic KYC updates and re-verification
    """
    
    @workflow.run
    async def run(self, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute KYC update workflow
        
        Args:
            update_data: Update information including:
                - user_id: User identifier
                - update_type: Type of update (periodic/document_expiry/user_requested)
                - new_documents: New documents if applicable
        
        Returns:
            Dict containing update results
        """
        workflow.logger.info(
            f"Starting KYC update workflow for user_id: {update_data.get('user_id')}"
        )
        
        # Re-run verification with updated information
        kyc_result = await workflow.execute_child_workflow(
            KYCVerificationWorkflow.run,
            update_data,
            id=f"kyc-update-{update_data.get('user_id')}-{workflow.now().timestamp()}",
            task_queue="kyc-task-queue",
        )
        
        return {
            "user_id": update_data.get("user_id"),
            "update_type": update_data.get("update_type"),
            "status": kyc_result["status"],
            "kyc_result": kyc_result
        }

