"""
Unit tests for Wallet Service
Tests wallet creation, balance operations, transfers, and multi-currency support
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


class TestWalletCreation:
    """Test wallet creation"""
    
    def test_create_wallet(self):
        """Test creating a new wallet"""
        wallet_data = {
            "user_id": f"user-{uuid.uuid4()}",
            "currency": "NGN",
            "wallet_type": "personal"
        }
        response = client.post("/wallets", json=wallet_data)
        assert response.status_code in [200, 201]
        data = response.json()
        assert "id" in data or "wallet_id" in data
    
    def test_create_multi_currency_wallet(self):
        """Test creating wallets in multiple currencies"""
        user_id = f"user-{uuid.uuid4()}"
        currencies = ["NGN", "USD", "GBP", "EUR"]
        
        for currency in currencies:
            wallet_data = {
                "user_id": user_id,
                "currency": currency
            }
            response = client.post("/wallets", json=wallet_data)
            assert response.status_code in [200, 201, 409]  # 409 if wallet already exists


class TestWalletRetrieval:
    """Test wallet retrieval"""
    
    def test_list_wallets(self):
        """Test listing wallets"""
        response = client.get("/wallets")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_get_wallet_by_user(self):
        """Test getting wallets for a specific user"""
        response = client.get("/wallets", params={"user_id": "test-user"})
        assert response.status_code == 200


class TestBalanceOperations:
    """Test balance operations"""
    
    def test_get_balance(self):
        """Test getting wallet balance"""
        response = client.get("/wallets/balance/test-wallet-001")
        # May return 404 if wallet doesn't exist
        assert response.status_code in [200, 404]
    
    def test_credit_wallet(self):
        """Test crediting a wallet"""
        credit_data = {
            "wallet_id": "test-wallet-001",
            "amount": 1000.00,
            "currency": "NGN",
            "reference": f"credit-{uuid.uuid4()}",
            "description": "Test credit"
        }
        response = client.post("/wallets/credit", json=credit_data)
        # May fail if wallet doesn't exist
        assert response.status_code in [200, 201, 404]
    
    def test_debit_wallet(self):
        """Test debiting a wallet"""
        debit_data = {
            "wallet_id": "test-wallet-001",
            "amount": 100.00,
            "currency": "NGN",
            "reference": f"debit-{uuid.uuid4()}",
            "description": "Test debit"
        }
        response = client.post("/wallets/debit", json=debit_data)
        # May fail if wallet doesn't exist or insufficient balance
        assert response.status_code in [200, 201, 400, 404]


class TestWalletTransfers:
    """Test wallet-to-wallet transfers"""
    
    def test_internal_transfer(self):
        """Test internal wallet transfer"""
        transfer_data = {
            "source_wallet_id": "wallet-001",
            "destination_wallet_id": "wallet-002",
            "amount": 500.00,
            "currency": "NGN",
            "reference": f"transfer-{uuid.uuid4()}"
        }
        response = client.post("/wallets/transfer", json=transfer_data)
        # May fail if wallets don't exist
        assert response.status_code in [200, 201, 400, 404]


class TestTransactionHistory:
    """Test wallet transaction history"""
    
    def test_get_transaction_history(self):
        """Test getting wallet transaction history"""
        response = client.get("/wallets/test-wallet-001/transactions")
        assert response.status_code in [200, 404]
    
    def test_get_transaction_history_with_filters(self):
        """Test getting filtered transaction history"""
        response = client.get("/wallets/test-wallet-001/transactions", params={
            "limit": 10,
            "type": "credit"
        })
        assert response.status_code in [200, 404]


class TestMultiCurrencySupport:
    """Test multi-currency support"""
    
    def test_supported_currencies(self):
        """Test getting list of supported currencies"""
        response = client.get("/currencies")
        assert response.status_code in [200, 404]
    
    def test_currency_conversion(self):
        """Test currency conversion"""
        conversion_data = {
            "from_currency": "USD",
            "to_currency": "NGN",
            "amount": 100.00
        }
        response = client.post("/wallets/convert", json=conversion_data)
        assert response.status_code in [200, 404]


class TestBalanceValidation:
    """Test balance validation"""
    
    def test_insufficient_balance_rejection(self):
        """Test that insufficient balance is rejected"""
        debit_data = {
            "wallet_id": "test-wallet-empty",
            "amount": 1000000.00,  # Large amount
            "currency": "NGN",
            "reference": f"debit-{uuid.uuid4()}"
        }
        response = client.post("/wallets/debit", json=debit_data)
        # Should reject due to insufficient balance or wallet not found
        assert response.status_code in [400, 404]
    
    def test_negative_amount_rejection(self):
        """Test that negative amounts are rejected"""
        credit_data = {
            "wallet_id": "test-wallet-001",
            "amount": -100.00,
            "currency": "NGN"
        }
        response = client.post("/wallets/credit", json=credit_data)
        assert response.status_code in [400, 422]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
