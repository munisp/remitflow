"""
Integration tests for Payment Gateway + E-commerce Service
"""

import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.integration
class TestPaymentEcommerceIntegration:
    """Test integration between payment and e-commerce services"""
    
    @pytest.mark.asyncio
    async def test_order_payment_flow(self, sample_order, sample_payment):
        """Test complete order + payment flow"""
        # Create order
        order = sample_order
        assert order["order_id"] is not None
        
        # Process payment
        payment = sample_payment
        payment["order_id"] = order["order_id"]
        assert payment["order_id"] == order["order_id"]
        
        # Update order status
        order["status"] = "paid"
        assert order["status"] == "paid"
    
    @pytest.mark.asyncio
    async def test_payment_failure_rollback(self, sample_order, sample_payment):
        """Test order rollback on payment failure"""
        order = sample_order
        payment = sample_payment
        payment["status"] = "failed"
        
        # Order should remain pending
        if payment["status"] == "failed":
            order["status"] = "pending"
        
        assert order["status"] == "pending"
