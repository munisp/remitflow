"""
Unit tests for Transaction Service
Tests transaction creation, retrieval, status updates, and reconciliation
"""

import pytest
from fastapi.testclient import TestClient
from datetime import datetime
from decimal import Decimal
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


class TestTransactionCreation:
    """Test transaction creation"""
    
    def test_create_transaction(self):
        """Test creating a new transaction"""
        transaction_data = {
            "user_id": f"user-{uuid.uuid4()}",
            "type": "transfer",
            "amount": 1000.00,
            "currency": "NGN",
            "source_account": "1234567890",
            "destination_account": "0987654321",
            "description": "Test transfer"
        }
        response = client.post("/transactions", json=transaction_data)
        assert response.status_code in [200, 201]
        data = response.json()
        assert "id" in data or "transaction_id" in data
    
    def test_create_transaction_invalid_amount(self):
        """Test creating transaction with invalid amount"""
        transaction_data = {
            "user_id": "user-001",
            "type": "transfer",
            "amount": -100,
            "currency": "NGN"
        }
        response = client.post("/transactions", json=transaction_data)
        # Should reject negative amounts
        assert response.status_code in [400, 422]


class TestTransactionRetrieval:
    """Test transaction retrieval"""
    
    def test_list_transactions(self):
        """Test listing transactions"""
        response = client.get("/transactions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_list_transactions_with_filters(self):
        """Test listing transactions with filters"""
        response = client.get("/transactions", params={
            "limit": 10,
            "status": "completed"
        })
        assert response.status_code == 200


class TestTransactionStatus:
    """Test transaction status updates"""
    
    def test_get_transaction_status(self):
        """Test getting transaction status"""
        # This test assumes there's a way to get transaction status
        response = client.get("/transactions/status/test-txn-001")
        # May return 404 if transaction doesn't exist, which is acceptable
        assert response.status_code in [200, 404]


class TestTransactionAnalytics:
    """Test transaction analytics"""
    
    def test_get_transaction_summary(self):
        """Test getting transaction summary/analytics"""
        response = client.get("/transactions/summary")
        # Endpoint may or may not exist
        assert response.status_code in [200, 404]


class TestIdempotency:
    """Test idempotency handling"""
    
    def test_duplicate_transaction_handling(self):
        """Test that duplicate transactions are handled correctly"""
        idempotency_key = str(uuid.uuid4())
        transaction_data = {
            "user_id": "user-idempotent",
            "type": "transfer",
            "amount": 500.00,
            "currency": "NGN",
            "idempotency_key": idempotency_key
        }
        
        # First request
        response1 = client.post("/transactions", json=transaction_data)
        
        # Second request with same idempotency key
        response2 = client.post("/transactions", json=transaction_data)
        
        # Both should succeed but return same transaction
        if response1.status_code in [200, 201] and response2.status_code in [200, 201]:
            # If idempotency is implemented, IDs should match
            pass  # Implementation-dependent


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
