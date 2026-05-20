"""
Fraud Detection Workflow for Nigerian Remittance Platform
Orchestrates hybrid fraud detection using GNN models and rule-based systems
"""

from datetime import timedelta
from typing import Dict, Any, List
from temporalio import workflow
from temporalio.common import RetryPolicy

# Import activities
with workflow.unsafe.imports_passed_through():
    from activities.fraud_activities import (
        extract_transaction_features,
        run_rule_based_detection,
        run_gnn_fraud_detection,
        run_ml_models,
        calculate_ensemble_score,
        flag_suspicious_transaction,
        block_transaction,
        send_fraud_alert
    )


@workflow.defn
class FraudDetectionWorkflow:
    """
    Fraud Detection Workflow
    
    Implements hybrid fraud detection:
    - Feature extraction
    - Rule-based detection (PyKnow)
    - GNN-based detection (PyTorch Geometric)
    - Traditional ML models
    - Ensemble scoring
    - Alert generation
    """
    
    @workflow.run
    async def run(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute fraud detection workflow
        
        Args:
            transaction_data: Transaction information including:
                - transaction_id: Unique transaction identifier
                - sender_id: Sender user ID
                - recipient_id: Recipient user ID
                - amount: Transaction amount
                - currency: Currency code
                - timestamp: Transaction timestamp
                - metadata: Additional transaction metadata
        
        Returns:
            Dict containing fraud detection results
        """
        workflow.logger.info(
            f"Starting fraud detection for transaction_id: {transaction_data.get('transaction_id')}"
        )
        
        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=1),
            maximum_interval=timedelta(seconds=20),
            maximum_attempts=3,
            backoff_coefficient=2.0,
        )
        
        workflow_result = {
            "transaction_id": transaction_data.get("transaction_id"),
            "is_fraudulent": False,
            "fraud_score": 0.0,
            "detection_methods": {},
            "steps_completed": [],
            "actions_taken": []
        }
        
        try:
            # Step 1: Extract Transaction Features
            workflow.logger.info("Step 1: Extracting transaction features")
            features_result = await workflow.execute_activity(
                extract_transaction_features,
                transaction_data,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy,
            )
            
            workflow_result["steps_completed"].append("feature_extraction")
            workflow_result["features"] = features_result.get("features")
            workflow.logger.info(f"Extracted {len(features_result.get('features', {}))} features")
            
            # Step 2: Rule-Based Detection (Parallel with ML)
            workflow.logger.info("Step 2: Running rule-based detection")
            
            # Execute rule-based and ML detections in parallel
            rule_task = workflow.execute_activity(
                run_rule_based_detection,
                {
                    "transaction_data": transaction_data,
                    "features": features_result.get("features")
                },
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=retry_policy,
            )
            
            # Step 3: GNN-Based Detection (Parallel)
            workflow.logger.info("Step 3: Running GNN fraud detection")
            gnn_task = workflow.execute_activity(
                run_gnn_fraud_detection,
                {
                    "transaction_data": transaction_data,
                    "features": features_result.get("features")
                },
                start_to_close_timeout=timedelta(seconds=45),
                retry_policy=retry_policy,
            )
            
            # Step 4: Traditional ML Models (Parallel)
            workflow.logger.info("Step 4: Running traditional ML models")
            ml_task = workflow.execute_activity(
                run_ml_models,
                {
                    "transaction_data": transaction_data,
                    "features": features_result.get("features")
                },
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry_policy,
            )
            
            # Wait for all parallel detections to complete
            rule_result, gnn_result, ml_result = await workflow.wait_all(
                [rule_task, gnn_task, ml_task]
            )
            
            workflow_result["steps_completed"].extend([
                "rule_based_detection",
                "gnn_detection",
                "ml_detection"
            ])
            
            workflow_result["detection_methods"] = {
                "rule_based": {
                    "is_fraudulent": rule_result.get("is_fraudulent"),
                    "score": rule_result.get("score"),
                    "triggered_rules": rule_result.get("triggered_rules", [])
                },
                "gnn": {
                    "is_fraudulent": gnn_result.get("is_fraudulent"),
                    "score": gnn_result.get("score"),
                    "confidence": gnn_result.get("confidence")
                },
                "ml": {
                    "is_fraudulent": ml_result.get("is_fraudulent"),
                    "score": ml_result.get("score"),
                    "models_used": ml_result.get("models_used", [])
                }
            }
            
            workflow.logger.info(
                f"Detection scores - Rules: {rule_result.get('score')}, "
                f"GNN: {gnn_result.get('score')}, ML: {ml_result.get('score')}"
            )
            
            # Step 5: Calculate Ensemble Score
            workflow.logger.info("Step 5: Calculating ensemble fraud score")
            ensemble_result = await workflow.execute_activity(
                calculate_ensemble_score,
                {
                    "rule_result": rule_result,
                    "gnn_result": gnn_result,
                    "ml_result": ml_result,
                    "transaction_data": transaction_data
                },
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=retry_policy,
            )
            
            workflow_result["steps_completed"].append("ensemble_scoring")
            workflow_result["fraud_score"] = ensemble_result.get("ensemble_score")
            workflow_result["is_fraudulent"] = ensemble_result.get("is_fraudulent")
            workflow_result["confidence"] = ensemble_result.get("confidence")
            workflow_result["reasoning"] = ensemble_result.get("reasoning")
            
            workflow.logger.info(
                f"Ensemble fraud score: {ensemble_result.get('ensemble_score')} "
                f"(Fraudulent: {ensemble_result.get('is_fraudulent')})"
            )
            
            # Step 6: Take Action Based on Results
            if ensemble_result.get("is_fraudulent"):
                fraud_score = ensemble_result.get("ensemble_score")
                
                # High confidence fraud (score > 0.8) - Block transaction
                if fraud_score > 0.8:
                    workflow.logger.warning(
                        f"High fraud score ({fraud_score}), blocking transaction"
                    )
                    
                    block_result = await workflow.execute_activity(
                        block_transaction,
                        {
                            "transaction_id": transaction_data.get("transaction_id"),
                            "reason": f"Fraud detected with score {fraud_score}",
                            "detection_details": workflow_result["detection_methods"]
                        },
                        start_to_close_timeout=timedelta(seconds=20),
                        retry_policy=retry_policy,
                    )
                    
                    workflow_result["actions_taken"].append("transaction_blocked")
                    workflow_result["block_id"] = block_result.get("block_id")
                    
                    # Send high-priority fraud alert
                    await workflow.execute_activity(
                        send_fraud_alert,
                        {
                            "transaction_id": transaction_data.get("transaction_id"),
                            "user_id": transaction_data.get("sender_id"),
                            "fraud_score": fraud_score,
                            "priority": "high",
                            "message": f"Transaction blocked due to fraud detection (score: {fraud_score})"
                        },
                        start_to_close_timeout=timedelta(seconds=15),
                    )
                    
                    workflow_result["actions_taken"].append("high_priority_alert_sent")
                
                # Medium confidence fraud (0.5 < score <= 0.8) - Flag for review
                elif fraud_score > 0.5:
                    workflow.logger.warning(
                        f"Medium fraud score ({fraud_score}), flagging for review"
                    )
                    
                    flag_result = await workflow.execute_activity(
                        flag_suspicious_transaction,
                        {
                            "transaction_id": transaction_data.get("transaction_id"),
                            "fraud_score": fraud_score,
                            "detection_details": workflow_result["detection_methods"],
                            "review_priority": "medium"
                        },
                        start_to_close_timeout=timedelta(seconds=20),
                        retry_policy=retry_policy,
                    )
                    
                    workflow_result["actions_taken"].append("flagged_for_review")
                    workflow_result["flag_id"] = flag_result.get("flag_id")
                    
                    # Send medium-priority fraud alert
                    await workflow.execute_activity(
                        send_fraud_alert,
                        {
                            "transaction_id": transaction_data.get("transaction_id"),
                            "user_id": transaction_data.get("sender_id"),
                            "fraud_score": fraud_score,
                            "priority": "medium",
                            "message": f"Transaction flagged for review (score: {fraud_score})"
                        },
                        start_to_close_timeout=timedelta(seconds=15),
                    )
                    
                    workflow_result["actions_taken"].append("medium_priority_alert_sent")
                
                # Low confidence fraud (score <= 0.5) - Monitor only
                else:
                    workflow.logger.info(
                        f"Low fraud score ({fraud_score}), monitoring only"
                    )
                    workflow_result["actions_taken"].append("monitoring_only")
            
            else:
                workflow.logger.info("Transaction appears legitimate")
                workflow_result["actions_taken"].append("approved")
            
            workflow_result["steps_completed"].append("action_taken")
            
            workflow.logger.info(
                f"Fraud detection completed for transaction_id: {transaction_data.get('transaction_id')}"
            )
            
            return workflow_result
            
        except Exception as e:
            workflow.logger.error(f"Fraud detection workflow failed: {str(e)}")
            workflow_result["error"] = str(e)
            workflow_result["is_fraudulent"] = False  # Fail open to avoid blocking legitimate transactions
            workflow_result["fraud_score"] = 0.0
            return workflow_result


@workflow.defn
class FraudInvestigationWorkflow:
    """
    Fraud Investigation Workflow
    
    Handles detailed investigation of flagged transactions
    """
    
    @workflow.run
    async def run(self, investigation_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute fraud investigation workflow
        
        Args:
            investigation_data: Investigation information including:
                - transaction_id: Transaction to investigate
                - flag_id: Flag identifier
                - investigator_id: Assigned investigator
        
        Returns:
            Dict containing investigation results
        """
        workflow.logger.info(
            f"Starting fraud investigation for transaction_id: {investigation_data.get('transaction_id')}"
        )
        
        # Wait for human review (can be signaled)
        investigation_result = await workflow.wait_condition(
            lambda: self.investigation_complete,
            timeout=timedelta(hours=48)  # 48-hour investigation window
        )
        
        return {
            "transaction_id": investigation_data.get("transaction_id"),
            "investigation_complete": True,
            "result": investigation_result
        }
    
    @workflow.signal
    def complete_investigation(self, result: Dict[str, Any]) -> None:
        """Signal to complete investigation"""
        self.investigation_complete = True
        self.investigation_result = result

