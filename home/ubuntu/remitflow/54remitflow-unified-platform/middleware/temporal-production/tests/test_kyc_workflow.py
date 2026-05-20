"""
Comprehensive tests for KYC Verification Workflows
Tests KYC workflow, update workflow, and all KYC activities
"""

import pytest
from datetime import timedelta
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from workflows.kyc_workflow import KYCVerificationWorkflow, KYCUpdateWorkflow
from activities import kyc_activities


class TestKYCVerificationWorkflow:
    """Test suite for KYCVerificationWorkflow"""
    
    @pytest.mark.asyncio
    async def test_successful_individual_kyc(self):
        """Test successful individual KYC verification"""
        async with await WorkflowEnvironment.start_time_skipping() as env:
            async with Worker(
                env.client,
                task_queue="test-kyc-queue",
                workflows=[KYCVerificationWorkflow],
                activities=[
                    kyc_activities.collect_documents,
                    kyc_activities.verify_identity_ocr,
                    kyc_activities.check_sanctions,
                    kyc_activities.approve_kyc,
                    kyc_activities.send_kyc_notification,
                ],
            ):
                kyc_data = {
                    "user_id": "USER-001",
                    "kyc_type": "individual",
                    "documents": [
                        {"type": "national_id", "format": "pdf", "url": "https://example.com/id.pdf"},
                        {"type": "proof_of_address", "format": "pdf", "url": "https://example.com/address.pdf"}
                    ],
                    "personal_info": {
                        "name": "John Doe",
                        "date_of_birth": "1990-01-01",
                        "id_number": "12345678",
                        "address": "123 Main St"
                    },
                    "country": "NG"
                }
                
                result = await env.client.execute_workflow(
                    KYCVerificationWorkflow.run,
                    kyc_data,
                    id="test-kyc-001",
                    task_queue="test-kyc-queue",
                )
                
                assert result["status"] == "approved"
                assert result["user_id"] == "USER-001"
                assert "document_collection" in result["steps_completed"]
                assert "ocr_verification" in result["steps_completed"]
                assert "sanctions_check" in result["steps_completed"]
                assert "approval" in result["steps_completed"]
                assert "notification" in result["steps_completed"]
                assert "kyc_id" in result
    
    @pytest.mark.asyncio
    async def test_successful_business_kyc(self):
        """Test successful business KYC verification with open-source KYB"""
        async with await WorkflowEnvironment.start_time_skipping() as env:
            async with Worker(
                env.client,
                task_queue="test-kyc-queue",
                workflows=[KYCVerificationWorkflow],
                activities=[
                    kyc_activities.collect_documents,
                    kyc_activities.verify_identity_ocr,
                    kyc_activities.check_sanctions,
                    kyc_activities.verify_business_opensource,
                    kyc_activities.approve_kyc,
                    kyc_activities.send_kyc_notification,
                ],
            ):
                kyc_data = {
                    "user_id": "BUSINESS-001",
                    "kyc_type": "business",
                    "documents": [
                        {"type": "business_registration", "format": "pdf"},
                        {"type": "tax_certificate", "format": "pdf"},
                        {"type": "director_id", "format": "pdf"}
                    ],
                    "personal_info": {
                        "name": "Acme Corp",
                        "registration_number": "RC123456",
                        "tax_id": "TAX789"
                    },
                    "country": "NG"
                }
                
                result = await env.client.execute_workflow(
                    KYCVerificationWorkflow.run,
                    kyc_data,
                    id="test-kyc-002",
                    task_queue="test-kyc-queue",
                )
                
                assert result["status"] == "approved"
                assert "opensource_kyb" in result["steps_completed"]
    
    @pytest.mark.asyncio
    async def test_kyc_missing_documents(self):
        """Test KYC with missing documents"""
        async with await WorkflowEnvironment.start_time_skipping() as env:
            async with Worker(
                env.client,
                task_queue="test-kyc-queue",
                workflows=[KYCVerificationWorkflow],
                activities=[
                    kyc_activities.collect_documents,
                    kyc_activities.send_kyc_notification,
                ],
            ):
                kyc_data = {
                    "user_id": "USER-002",
                    "kyc_type": "individual",
                    "documents": [
                        {"type": "national_id", "format": "pdf"}
                        # Missing proof_of_address
                    ],
                    "personal_info": {"name": "Jane Doe"},
                    "country": "NG"
                }
                
                result = await env.client.execute_workflow(
                    KYCVerificationWorkflow.run,
                    kyc_data,
                    id="test-kyc-003",
                    task_queue="test-kyc-queue",
                )
                
                assert result["status"] == "documents_incomplete"
                assert len(result["errors"]) > 0


class TestKYCActivities:
    """Test suite for KYC activities"""
    
    @pytest.mark.asyncio
    async def test_collect_documents_success(self):
        """Test successful document collection"""
        kyc_data = {
            "user_id": "USER-001",
            "kyc_type": "individual",
            "documents": [
                {"type": "national_id", "format": "pdf"},
                {"type": "proof_of_address", "format": "pdf"}
            ]
        }
        
        result = await kyc_activities.collect_documents(kyc_data)
        assert result["success"] is True
        assert len(result["documents"]) == 2
    
    @pytest.mark.asyncio
    async def test_collect_documents_missing(self):
        """Test document collection with missing documents"""
        kyc_data = {
            "user_id": "USER-001",
            "kyc_type": "individual",
            "documents": [
                {"type": "national_id", "format": "pdf"}
                # Missing proof_of_address
            ]
        }
        
        result = await kyc_activities.collect_documents(kyc_data)
        assert result["success"] is False
        assert "Missing required documents" in result["error"]
    
    @pytest.mark.asyncio
    async def test_verify_identity_ocr_success(self):
        """Test successful OCR identity verification"""
        verification_data = {
            "user_id": "USER-001",
            "documents": [{"type": "national_id", "format": "pdf"}],
            "personal_info": {
                "name": "John Doe",
                "date_of_birth": "1990-01-01",
                "id_number": "12345678"
            }
        }
        
        result = await kyc_activities.verify_identity_ocr(verification_data)
        assert result["verified"] is True
        assert result["confidence"] > 0.8
        assert "extracted_data" in result
    
    @pytest.mark.asyncio
    async def test_check_sanctions_clean(self):
        """Test sanctions check for clean user"""
        sanctions_data = {
            "user_id": "USER-001",
            "personal_info": {"name": "John Doe"},
            "country": "NG"
        }
        
        result = await kyc_activities.check_sanctions(sanctions_data)
        assert result["is_sanctioned"] is False
        assert len(result["checked_lists"]) > 0
    
    @pytest.mark.asyncio
    async def test_verify_business_opensource_success(self):
        """Test successful open-source KYB verification"""
        kyb_data = {
            "user_id": "BUSINESS-001",
            "business_info": {
                "name": "Acme Corp",
                "registration_number": "RC123456"
            },
            "documents": [{"type": "business_registration", "format": "pdf"}]
        }
        
        result = await kyc_activities.verify_business_opensource(kyb_data)
        assert result["verified"] is True
        assert result["risk_score"] < 0.5
        assert result["platform"] == "opensource_kyb"
    
    @pytest.mark.asyncio
    async def test_approve_kyc_success(self):
        """Test successful KYC approval"""
        approval_data = {
            "user_id": "USER-001",
            "kyc_type": "individual",
            "verification_details": {}
        }
        
        result = await kyc_activities.approve_kyc(approval_data)
        assert result["success"] is True
        assert "kyc_id" in result
        assert result["kyc_id"].startswith("KYC-")
    
    @pytest.mark.asyncio
    async def test_reject_kyc_success(self):
        """Test successful KYC rejection"""
        rejection_data = {
            "user_id": "USER-002",
            "reason": "OCR verification failed"
        }
        
        result = await kyc_activities.reject_kyc(rejection_data)
        assert result["success"] is True
        assert "rejected_at" in result
    
    @pytest.mark.asyncio
    async def test_send_kyc_notification_success(self):
        """Test successful KYC notification"""
        notification_data = {
            "user_id": "USER-001",
            "type": "kyc_approved",
            "message": "KYC approved"
        }
        
        result = await kyc_activities.send_kyc_notification(notification_data)
        assert result["success"] is True
        assert "notification_id" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

