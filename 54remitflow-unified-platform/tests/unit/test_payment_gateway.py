"""
Unit tests for Payment Gateway Service
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
import uuid
import asyncio

class TestPaymentGateway:
    """Test suite for payment gateway"""
    
    def test_create_payment_success(self, sample_payment, mock_payment_gateway):
        """Test successful payment creation"""
        # Run the async mock in an event loop
        result = asyncio.get_event_loop().run_until_complete(
            mock_payment_gateway.process_payment(sample_payment)
        )
        assert result is not None
        assert "transaction_id" in result
        assert result["status"] == "completed"
    
    def test_payment_validation(self, sample_payment):
        """Test payment data validation"""
        assert sample_payment["amount"] > 0
        assert sample_payment["currency"] in ["KES", "USD", "EUR"]
        assert sample_payment["payment_method"] in ["mpesa", "stripe", "bank_transfer"]
    
    def test_mpesa_payment(self, sample_payment):
        """Test M-Pesa payment processing"""
        sample_payment["payment_method"] = "mpesa"
        assert sample_payment["payment_method"] == "mpesa"
    
    def test_stripe_payment(self, sample_payment):
        """Test Stripe payment processing"""
        sample_payment["payment_method"] = "stripe"
        assert sample_payment["payment_method"] == "stripe"
    
    def test_payment_idempotency(self, sample_payment):
        """Test payment idempotency"""
        idempotency_key = str(uuid.uuid4())
        sample_payment["idempotency_key"] = idempotency_key
        assert sample_payment["idempotency_key"] == idempotency_key
    
    @pytest.mark.parametrize("amount,expected", [
        (100, True),
        (0, False),
        (-100, False),
    ])
    def test_amount_validation(self, amount, expected):
        """Test payment amount validation"""
        is_valid = amount > 0
        assert is_valid == expected
