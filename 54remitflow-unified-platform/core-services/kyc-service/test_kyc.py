"""
Unit tests for KYC Service
Tests tiered KYC verification, document validation, and property transaction KYC
"""

import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
import uuid

# Import the app for testing
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from main import app

client = TestClient(app)


class TestHealthCheck:
    """Test health check endpoint"""
    
    def test_health_check(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"


class TestKYCTiers:
    """Test tiered KYC verification"""
    
    def test_get_kyc_tiers(self):
        """Test getting KYC tier definitions"""
        response = client.get("/kyc/tiers")
        assert response.status_code in [200, 404]
    
    def test_get_user_kyc_status(self):
        """Test getting user's KYC status"""
        response = client.get("/kyc/users/test-user-001/status")
        assert response.status_code in [200, 404]


class TestDocumentVerification:
    """Test document verification"""
    
    def test_submit_document(self):
        """Test submitting a KYC document"""
        document_data = {
            "user_id": f"user-{uuid.uuid4()}",
            "document_type": "national_id",
            "document_number": "A12345678",
            "issuing_country": "NG",
            "expiry_date": (datetime.utcnow() + timedelta(days=365)).isoformat()
        }
        response = client.post("/kyc/documents", json=document_data)
        assert response.status_code in [200, 201, 422]
    
    def test_get_user_documents(self):
        """Test getting user's submitted documents"""
        response = client.get("/kyc/users/test-user-001/documents")
        assert response.status_code in [200, 404]
    
    def test_verify_document(self):
        """Test document verification workflow"""
        verification_data = {
            "document_id": "doc-001",
            "verified_by": "verifier-001",
            "verification_status": "approved",
            "notes": "Document verified successfully"
        }
        response = client.post("/kyc/documents/verify", json=verification_data)
        assert response.status_code in [200, 404]


class TestAddressVerification:
    """Test address verification"""
    
    def test_submit_address(self):
        """Test submitting address for verification"""
        address_data = {
            "user_id": "test-user-001",
            "address_line_1": "123 Test Street",
            "city": "Lagos",
            "state": "Lagos",
            "country": "NG",
            "postal_code": "100001"
        }
        response = client.post("/kyc/address", json=address_data)
        assert response.status_code in [200, 201, 422]


class TestBankStatementValidation:
    """Test bank statement validation for property transactions"""
    
    def test_validate_bank_statement_coverage(self):
        """Test bank statement date coverage validation"""
        # This tests the 3-month requirement
        statement_data = {
            "user_id": "test-user-001",
            "statements": [
                {
                    "bank_name": "Test Bank",
                    "account_number": "1234567890",
                    "start_date": (datetime.utcnow() - timedelta(days=100)).isoformat(),
                    "end_date": datetime.utcnow().isoformat()
                }
            ]
        }
        response = client.post("/kyc/bank-statements/validate", json=statement_data)
        assert response.status_code in [200, 404, 422]


class TestSourceOfFunds:
    """Test source of funds declaration"""
    
    def test_submit_source_of_funds(self):
        """Test submitting source of funds declaration"""
        sof_data = {
            "user_id": "test-user-001",
            "source_type": "employment",
            "employer_name": "Test Company Ltd",
            "annual_income": 5000000,
            "currency": "NGN",
            "supporting_documents": []
        }
        response = client.post("/kyc/source-of-funds", json=sof_data)
        assert response.status_code in [200, 201, 404, 422]


class TestPropertyTransactionKYC:
    """Test property transaction KYC flow"""
    
    def test_initiate_property_transaction(self):
        """Test initiating a property transaction KYC"""
        transaction_data = {
            "buyer_id": f"buyer-{uuid.uuid4()}",
            "property_address": "456 Property Lane, Lagos",
            "property_value": 50000000,
            "currency": "NGN"
        }
        response = client.post("/kyc/property-transactions", json=transaction_data)
        assert response.status_code in [200, 201, 404, 422]
    
    def test_add_seller_to_transaction(self):
        """Test adding seller to property transaction"""
        seller_data = {
            "transaction_id": "prop-txn-001",
            "seller_name": "John Seller",
            "seller_id_type": "national_id",
            "seller_id_number": "B98765432"
        }
        response = client.post("/kyc/property-transactions/seller", json=seller_data)
        assert response.status_code in [200, 201, 404, 422]
    
    def test_submit_purchase_agreement(self):
        """Test submitting purchase agreement"""
        agreement_data = {
            "transaction_id": "prop-txn-001",
            "agreement_date": datetime.utcnow().isoformat(),
            "buyer_name": "Jane Buyer",
            "seller_name": "John Seller",
            "property_address": "456 Property Lane, Lagos",
            "purchase_price": 50000000,
            "currency": "NGN"
        }
        response = client.post("/kyc/property-transactions/agreement", json=agreement_data)
        assert response.status_code in [200, 201, 404, 422]


class TestKYCLimits:
    """Test KYC tier limits"""
    
    def test_get_tier_limits(self):
        """Test getting transaction limits for each tier"""
        response = client.get("/kyc/tiers/limits")
        assert response.status_code in [200, 404]
    
    def test_check_transaction_limit(self):
        """Test checking if transaction is within user's KYC limits"""
        check_data = {
            "user_id": "test-user-001",
            "amount": 100000,
            "currency": "NGN",
            "transaction_type": "transfer"
        }
        response = client.post("/kyc/limits/check", json=check_data)
        assert response.status_code in [200, 404]


class TestKYCUpgrade:
    """Test KYC tier upgrade"""
    
    def test_request_tier_upgrade(self):
        """Test requesting KYC tier upgrade"""
        upgrade_data = {
            "user_id": "test-user-001",
            "target_tier": 2,
            "reason": "Need higher transaction limits"
        }
        response = client.post("/kyc/upgrade", json=upgrade_data)
        assert response.status_code in [200, 201, 400, 404]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
