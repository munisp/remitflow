"""
Comprehensive tests for Fraud Detection Workflows
Tests fraud detection workflow and all fraud detection activities
"""

import pytest
from datetime import timedelta
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from workflows.fraud_workflow import FraudDetectionWorkflow
from activities import fraud_activities


class TestFraudDetectionWorkflow:
    """Test suite for FraudDetectionWorkflow"""
    
    @pytest.mark.asyncio
    async def test_legitimate_transaction(self):
        """Test fraud detection for legitimate transaction"""
        async with await WorkflowEnvironment.start_time_skipping() as env:
            async with Worker(
                env.client,
                task_queue="test-fraud-queue",
                workflows=[FraudDetectionWorkflow],
                activities=[
                    fraud_activities.extract_transaction_features,
                    fraud_activities.run_rule_based_detection,
                    fraud_activities.run_gnn_fraud_detection,
                    fraud_activities.run_ml_models,
                    fraud_activities.calculate_ensemble_score,
                ],
            ):
                transaction_data = {
                    "transaction_id": "TXN-001",
                    "sender_id": "USER-001",
                    "recipient_id": "USER-002",
                    "amount": 5000.0,
                    "currency": "NGN",
                    "timestamp": "2024-10-24T10:00:00Z",
                    "metadata": {
                        "sender_country": "NG",
                        "recipient_country": "NG"
                    }
                }
                
                result = await env.client.execute_workflow(
                    FraudDetectionWorkflow.run,
                    transaction_data,
                    id="test-fraud-001",
                    task_queue="test-fraud-queue",
                )
                
                assert result["transaction_id"] == "TXN-001"
                assert "feature_extraction" in result["steps_completed"]
                assert "rule_based_detection" in result["steps_completed"]
                assert "gnn_detection" in result["steps_completed"]
                assert "ml_detection" in result["steps_completed"]
                assert "ensemble_scoring" in result["steps_completed"]
                assert "fraud_score" in result
                assert result["fraud_score"] >= 0.0 and result["fraud_score"] <= 1.0
    
    @pytest.mark.asyncio
    async def test_high_risk_transaction_flagged(self):
        """Test fraud detection flags high-risk transaction"""
        async with await WorkflowEnvironment.start_time_skipping() as env:
            async with Worker(
                env.client,
                task_queue="test-fraud-queue",
                workflows=[FraudDetectionWorkflow],
                activities=[
                    fraud_activities.extract_transaction_features,
                    fraud_activities.run_rule_based_detection,
                    fraud_activities.run_gnn_fraud_detection,
                    fraud_activities.run_ml_models,
                    fraud_activities.calculate_ensemble_score,
                    fraud_activities.flag_suspicious_transaction,
                    fraud_activities.send_fraud_alert,
                ],
            ):
                transaction_data = {
                    "transaction_id": "TXN-002",
                    "sender_id": "USER-003",
                    "recipient_id": "USER-004",
                    "amount": 600000.0,  # High amount
                    "currency": "NGN",
                    "timestamp": "2024-10-24T02:00:00Z",  # Late night
                    "metadata": {
                        "sender_country": "NG",
                        "recipient_country": "US"
                    }
                }
                
                result = await env.client.execute_workflow(
                    FraudDetectionWorkflow.run,
                    transaction_data,
                    id="test-fraud-002",
                    task_queue="test-fraud-queue",
                )
                
                # High amount and late night should trigger some detection
                assert result["fraud_score"] > 0.3


class TestFraudActivities:
    """Test suite for fraud detection activities"""
    
    @pytest.mark.asyncio
    async def test_extract_transaction_features(self):
        """Test transaction feature extraction"""
        transaction_data = {
            "transaction_id": "TXN-001",
            "sender_id": "USER-001",
            "recipient_id": "USER-002",
            "amount": 10000.0,
            "currency": "NGN",
            "metadata": {
                "sender_country": "NG",
                "recipient_country": "NG"
            }
        }
        
        result = await fraud_activities.extract_transaction_features(transaction_data)
        assert result["success"] is True
        assert "features" in result
        features = result["features"]
        assert features["amount"] == 10000.0
        assert features["currency"] == "NGN"
        assert "sender_transaction_count_24h" in features
        assert "sender_degree" in features
    
    @pytest.mark.asyncio
    async def test_rule_based_detection_low_risk(self):
        """Test rule-based detection for low-risk transaction"""
        detection_data = {
            "features": {
                "amount": 5000.0,
                "sender_transaction_count_24h": 2,
                "sender_total_amount_24h": 10000.0,
                "hour_of_day": 14,
                "common_neighbors": 3
            }
        }
        
        result = await fraud_activities.run_rule_based_detection(detection_data)
        assert result["is_fraudulent"] is False
        assert result["score"] < 0.7
        assert result["detection_method"] == "rule_based"
    
    @pytest.mark.asyncio
    async def test_rule_based_detection_high_risk(self):
        """Test rule-based detection for high-risk transaction"""
        detection_data = {
            "features": {
                "amount": 600000.0,  # High amount
                "sender_transaction_count_24h": 15,  # High frequency
                "sender_total_amount_24h": 1500000.0,  # High velocity
                "hour_of_day": 2,  # Late night
                "common_neighbors": 0  # New recipient
            }
        }
        
        result = await fraud_activities.run_rule_based_detection(detection_data)
        assert result["score"] > 0.5
        assert len(result["triggered_rules"]) > 0
    
    @pytest.mark.asyncio
    async def test_gnn_fraud_detection(self):
        """Test GNN-based fraud detection"""
        detection_data = {
            "features": {
                "sender_degree": 10,
                "recipient_degree": 5,
                "common_neighbors": 2,
                "cross_border": False
            }
        }
        
        result = await fraud_activities.run_gnn_fraud_detection(detection_data)
        assert "score" in result
        assert "confidence" in result
        assert result["detection_method"] == "gnn"
        assert result["framework"] == "PyTorch Geometric (PyG)"
    
    @pytest.mark.asyncio
    async def test_ml_models_detection(self):
        """Test traditional ML models detection"""
        detection_data = {
            "features": {
                "amount": 50000.0,
                "sender_transaction_count_24h": 5,
                "sender_total_amount_24h": 200000.0
            }
        }
        
        result = await fraud_activities.run_ml_models(detection_data)
        assert "score" in result
        assert result["detection_method"] == "ml"
        assert len(result["models_used"]) > 0
    
    @pytest.mark.asyncio
    async def test_calculate_ensemble_score(self):
        """Test ensemble score calculation"""
        ensemble_data = {
            "rule_result": {
                "is_fraudulent": False,
                "score": 0.3,
                "triggered_rules": []
            },
            "gnn_result": {
                "is_fraudulent": False,
                "score": 0.4
            },
            "ml_result": {
                "is_fraudulent": False,
                "score": 0.35
            }
        }
        
        result = await fraud_activities.calculate_ensemble_score(ensemble_data)
        assert "ensemble_score" in result
        assert "is_fraudulent" in result
        assert "confidence" in result
        assert result["ensemble_score"] >= 0.0 and result["ensemble_score"] <= 1.0
    
    @pytest.mark.asyncio
    async def test_flag_suspicious_transaction(self):
        """Test flagging suspicious transaction"""
        flag_data = {
            "transaction_id": "TXN-001",
            "fraud_score": 0.65,
            "detection_details": {},
            "review_priority": "medium"
        }
        
        result = await fraud_activities.flag_suspicious_transaction(flag_data)
        assert result["success"] is True
        assert "flag_id" in result
        assert result["flag_id"].startswith("FLAG-")
    
    @pytest.mark.asyncio
    async def test_block_transaction(self):
        """Test blocking fraudulent transaction"""
        block_data = {
            "transaction_id": "TXN-002",
            "reason": "High fraud score",
            "detection_details": {}
        }
        
        result = await fraud_activities.block_transaction(block_data)
        assert result["success"] is True
        assert "block_id" in result
        assert result["block_id"].startswith("BLOCK-")
    
    @pytest.mark.asyncio
    async def test_send_fraud_alert(self):
        """Test sending fraud alert"""
        alert_data = {
            "transaction_id": "TXN-003",
            "user_id": "USER-001",
            "fraud_score": 0.85,
            "priority": "high",
            "message": "Transaction blocked"
        }
        
        result = await fraud_activities.send_fraud_alert(alert_data)
        assert result["success"] is True
        assert "alert_id" in result
        assert result["alert_id"].startswith("ALERT-")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

