"""
Payment Processing Workflow for Nigerian Remittance Platform
Orchestrates the complete payment lifecycle from validation to settlement
"""

from datetime import timedelta
from typing import Dict, Any
from temporalio import workflow
from temporalio.common import RetryPolicy

# Import activities
with workflow.unsafe.imports_passed_through():
    from activities.payment_activities import (
        validate_payment,
        check_fraud,
        process_payment,
        settle_payment,
        refund_payment,
        send_notification
    )


@workflow.defn
class PaymentProcessingWorkflow:
    """
    Payment Processing Workflow
    
    Orchestrates multi-step payment processing with:
    - Payment validation
    - Fraud detection
    - TigerBeetle processing
    - Settlement
    - Notifications
    - Compensation on failure
    """
    
    @workflow.run
    async def run(self, payment_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute payment processing workflow
        
        Args:
            payment_data: Payment information including:
                - payment_id: Unique payment identifier
                - sender_id: Sender user ID
                - recipient_id: Recipient user ID
                - amount: Payment amount
                - currency: Currency code
                - corridor: Payment corridor (PAPSS, CIPS, PIX, etc.)
                - metadata: Additional payment metadata
        
        Returns:
            Dict containing workflow execution results
        """
        workflow.logger.info(
            f"Starting payment workflow for payment_id: {payment_data.get('payment_id')}"
        )
        
        # Define retry policy for activities
        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3,
            backoff_coefficient=2.0,
        )
        
        workflow_result = {
            "payment_id": payment_data.get("payment_id"),
            "status": "processing",
            "steps_completed": [],
            "errors": []
        }
        
        try:
            # Step 1: Validate Payment
            workflow.logger.info("Step 1: Validating payment")
            validation_result = await workflow.execute_activity(
                validate_payment,
                payment_data,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy,
            )
            
            if not validation_result["valid"]:
                workflow_result["status"] = "failed"
                workflow_result["errors"].append(validation_result["error"])
                return workflow_result
            
            workflow_result["steps_completed"].append("validation")
            workflow.logger.info("Payment validation successful")
            
            # Step 2: Fraud Detection
            workflow.logger.info("Step 2: Running fraud detection")
            fraud_result = await workflow.execute_activity(
                check_fraud,
                payment_data,
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy=retry_policy,
            )
            
            if fraud_result["is_fraudulent"]:
                workflow.logger.warning(f"Fraud detected: {fraud_result['reason']}")
                workflow_result["status"] = "blocked_fraud"
                workflow_result["errors"].append(f"Fraud detected: {fraud_result['reason']}")
                
                # Send fraud alert notification
                await workflow.execute_activity(
                    send_notification,
                    {
                        "user_id": payment_data.get("sender_id"),
                        "type": "fraud_alert",
                        "message": f"Payment blocked due to fraud detection: {fraud_result['reason']}"
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                    retry_policy=retry_policy,
                )
                
                return workflow_result
            
            workflow_result["steps_completed"].append("fraud_check")
            workflow_result["fraud_score"] = fraud_result.get("fraud_score", 0)
            workflow.logger.info(f"Fraud check passed with score: {fraud_result.get('fraud_score')}")
            
            # Step 3: Process Payment (TigerBeetle)
            workflow.logger.info("Step 3: Processing payment via TigerBeetle")
            processing_result = await workflow.execute_activity(
                process_payment,
                payment_data,
                start_to_close_timeout=timedelta(seconds=45),
                retry_policy=retry_policy,
            )
            
            if not processing_result["success"]:
                workflow.logger.error(f"Payment processing failed: {processing_result['error']}")
                workflow_result["status"] = "failed"
                workflow_result["errors"].append(processing_result["error"])
                
                # Send failure notification
                await workflow.execute_activity(
                    send_notification,
                    {
                        "user_id": payment_data.get("sender_id"),
                        "type": "payment_failed",
                        "message": f"Payment failed: {processing_result['error']}"
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                    retry_policy=retry_policy,
                )
                
                return workflow_result
            
            workflow_result["steps_completed"].append("processing")
            workflow_result["transaction_id"] = processing_result.get("transaction_id")
            workflow.logger.info(f"Payment processed successfully: {processing_result.get('transaction_id')}")
            
            # Step 4: Settlement
            workflow.logger.info("Step 4: Settling payment")
            settlement_result = await workflow.execute_activity(
                settle_payment,
                {
                    "payment_id": payment_data.get("payment_id"),
                    "transaction_id": processing_result.get("transaction_id"),
                    "corridor": payment_data.get("corridor")
                },
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy=retry_policy,
            )
            
            if not settlement_result["success"]:
                workflow.logger.error(f"Settlement failed: {settlement_result['error']}")
                
                # Compensate: Refund the payment
                workflow.logger.info("Initiating refund due to settlement failure")
                refund_result = await workflow.execute_activity(
                    refund_payment,
                    {
                        "payment_id": payment_data.get("payment_id"),
                        "transaction_id": processing_result.get("transaction_id"),
                        "reason": "settlement_failed"
                    },
                    start_to_close_timeout=timedelta(seconds=45),
                    retry_policy=retry_policy,
                )
                
                workflow_result["status"] = "refunded"
                workflow_result["errors"].append(settlement_result["error"])
                workflow_result["refund_id"] = refund_result.get("refund_id")
                
                # Send refund notification
                await workflow.execute_activity(
                    send_notification,
                    {
                        "user_id": payment_data.get("sender_id"),
                        "type": "payment_refunded",
                        "message": f"Payment refunded due to settlement failure"
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                    retry_policy=retry_policy,
                )
                
                return workflow_result
            
            workflow_result["steps_completed"].append("settlement")
            workflow_result["settlement_id"] = settlement_result.get("settlement_id")
            workflow.logger.info(f"Payment settled successfully: {settlement_result.get('settlement_id')}")
            
            # Step 5: Send Success Notifications
            workflow.logger.info("Step 5: Sending success notifications")
            
            # Notify sender
            await workflow.execute_activity(
                send_notification,
                {
                    "user_id": payment_data.get("sender_id"),
                    "type": "payment_success",
                    "message": f"Payment of {payment_data.get('amount')} {payment_data.get('currency')} sent successfully"
                },
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=retry_policy,
            )
            
            # Notify recipient
            await workflow.execute_activity(
                send_notification,
                {
                    "user_id": payment_data.get("recipient_id"),
                    "type": "payment_received",
                    "message": f"You received {payment_data.get('amount')} {payment_data.get('currency')}"
                },
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=retry_policy,
            )
            
            workflow_result["steps_completed"].append("notifications")
            workflow_result["status"] = "completed"
            
            workflow.logger.info(f"Payment workflow completed successfully for payment_id: {payment_data.get('payment_id')}")
            
            return workflow_result
            
        except Exception as e:
            workflow.logger.error(f"Workflow failed with exception: {str(e)}")
            workflow_result["status"] = "error"
            workflow_result["errors"].append(str(e))
            
            # Attempt to send error notification
            try:
                await workflow.execute_activity(
                    send_notification,
                    {
                        "user_id": payment_data.get("sender_id"),
                        "type": "payment_error",
                        "message": f"Payment processing encountered an error"
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                    retry_policy=retry_policy,
                )
            except:
                pass  # Best effort notification
            
            return workflow_result


@workflow.defn
class PaymentRefundWorkflow:
    """
    Payment Refund Workflow
    
    Handles payment refunds with proper validation and notifications
    """
    
    @workflow.run
    async def run(self, refund_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute payment refund workflow
        
        Args:
            refund_data: Refund information including:
                - payment_id: Original payment ID
                - transaction_id: Original transaction ID
                - reason: Refund reason
                - requester_id: User requesting refund
        
        Returns:
            Dict containing refund execution results
        """
        workflow.logger.info(
            f"Starting refund workflow for payment_id: {refund_data.get('payment_id')}"
        )
        
        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3,
            backoff_coefficient=2.0,
        )
        
        workflow_result = {
            "payment_id": refund_data.get("payment_id"),
            "status": "processing",
            "steps_completed": []
        }
        
        try:
            # Execute refund
            refund_result = await workflow.execute_activity(
                refund_payment,
                refund_data,
                start_to_close_timeout=timedelta(seconds=45),
                retry_policy=retry_policy,
            )
            
            if refund_result["success"]:
                workflow_result["status"] = "completed"
                workflow_result["refund_id"] = refund_result.get("refund_id")
                
                # Send refund confirmation
                await workflow.execute_activity(
                    send_notification,
                    {
                        "user_id": refund_data.get("requester_id"),
                        "type": "refund_success",
                        "message": f"Refund processed successfully"
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                    retry_policy=retry_policy,
                )
            else:
                workflow_result["status"] = "failed"
                workflow_result["error"] = refund_result.get("error")
            
            return workflow_result
            
        except Exception as e:
            workflow.logger.error(f"Refund workflow failed: {str(e)}")
            workflow_result["status"] = "error"
            workflow_result["error"] = str(e)
            return workflow_result

