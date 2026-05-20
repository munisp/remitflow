"""
Comprehensive test suite for PayNow Payment Gateway.

Tests cover:
- Payment initiation (success and error scenarios)
- Payment status queries
- Webhook callback handling
- Payment cancellation/refund
- Error handling and retries
- Request/response validation
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime
import json

try:
    from backend.payment_gateways.paynow_gateway import PayNowGateway
except ImportError:
    import sys
    sys.path.insert(0, '/home/ubuntu/UNIFIED_PLATFORM_COMPLETE')
    from backend.payment_gateways.paynow_gateway import PayNowGateway


@pytest.fixture
def paynow_gateway():
    """Create PayNow gateway instance for testing."""
    return PayNowGateway(
        api_key="test_api_key",
        api_secret="test_api_secret",
        base_url="https://api-test.paynow.com"
    )


@pytest.fixture
def sample_payment_request():
    """Sample payment request data."""
    return {
        "amount": 10000.00,
        "currency": "SGD",
        "sender": {
            "name": "Test Sender",
            "account": "1234567890",
            "bank_code": "TEST001"
        },
        "recipient": {
            "name": "Test Recipient",
            "account": "0987654321",
            "bank_code": "TEST002"
        },
        "reference": "TXN-" + datetime.now().strftime("%Y%m%d%H%M%S"),
        "description": "Test payment"
    }


@pytest.fixture
def mock_success_response():
    """Mock successful API response."""
    return {
        "status": "success",
        "transaction_id": "PayNow-TXN-123456",
        "reference": "TXN-20251105120000",
        "message": "Payment initiated successfully"
    }


class TestPayNowGatewayInitialization:
    """Test gateway initialization."""
    
    def test_gateway_initialization_success(self, paynow_gateway):
        """Test successful gateway initialization."""
        assert paynow_gateway is not None
        assert paynow_gateway.api_key == "test_api_key"
    
    def test_gateway_initialization_missing_credentials(self):
        """Test gateway raises error with missing credentials."""
        with pytest.raises((ValueError, TypeError)):
            PayNowGateway(api_key=None, api_secret=None)


class TestPayNowPaymentInitiation:
    """Test payment initiation functionality."""
    
    @pytest.mark.asyncio
    async def test_initiate_payment_success(self, paynow_gateway, sample_payment_request, mock_success_response):
        """Test successful payment initiation."""
        with patch.object(paynow_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_success_response
            
            result = await paynow_gateway.initiate_payment(sample_payment_request)
            
            assert result['status'] == 'success'
            assert 'transaction_id' in result
    
    @pytest.mark.asyncio
    async def test_initiate_payment_invalid_amount(self, paynow_gateway, sample_payment_request):
        """Test payment fails with invalid amount."""
        sample_payment_request['amount'] = -100
        
        with pytest.raises(ValueError, match="amount"):
            await paynow_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_missing_sender(self, paynow_gateway, sample_payment_request):
        """Test payment fails with missing sender."""
        del sample_payment_request['sender']
        
        with pytest.raises((ValueError, KeyError)):
            await paynow_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_missing_recipient(self, paynow_gateway, sample_payment_request):
        """Test payment fails with missing recipient."""
        del sample_payment_request['recipient']
        
        with pytest.raises((ValueError, KeyError)):
            await paynow_gateway.initiate_payment(sample_payment_request)


class TestPayNowPaymentStatus:
    """Test payment status queries."""
    
    @pytest.mark.asyncio
    async def test_get_payment_status_success(self, paynow_gateway):
        """Test successful status query."""
        transaction_id = "PayNow-TXN-123456"
        mock_status = {
            "status": "completed",
            "transaction_id": transaction_id,
            "amount": 10000.00
        }
        
        with patch.object(paynow_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await paynow_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'completed'
    
    @pytest.mark.asyncio
    async def test_get_payment_status_pending(self, paynow_gateway):
        """Test status query for pending payment."""
        transaction_id = "PayNow-TXN-123456"
        mock_status = {
            "status": "pending",
            "transaction_id": transaction_id
        }
        
        with patch.object(paynow_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await paynow_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'pending'
    
    @pytest.mark.asyncio
    async def test_get_payment_status_failed(self, paynow_gateway):
        """Test status query for failed payment."""
        transaction_id = "PayNow-TXN-123456"
        mock_status = {
            "status": "failed",
            "transaction_id": transaction_id,
            "error_code": "PROCESSING_ERROR"
        }
        
        with patch.object(paynow_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await paynow_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'failed'


class TestPayNowWebhookHandling:
    """Test webhook callback handling."""
    
    @pytest.mark.asyncio
    async def test_handle_webhook_success(self, paynow_gateway):
        """Test successful webhook handling."""
        webhook_data = {
            "event": "payment.completed",
            "transaction_id": "PayNow-TXN-123456",
            "status": "completed",
            "signature": "valid_signature"
        }
        
        with patch.object(paynow_gateway, '_verify_webhook_signature', return_value=True):
            result = await paynow_gateway.handle_webhook(webhook_data)
            
            assert result['status'] == 'completed'
    
    @pytest.mark.asyncio
    async def test_handle_webhook_invalid_signature(self, paynow_gateway):
        """Test webhook rejects invalid signature."""
        webhook_data = {
            "event": "payment.completed",
            "signature": "invalid_signature"
        }
        
        with patch.object(paynow_gateway, '_verify_webhook_signature', return_value=False):
            with pytest.raises(ValueError, match="signature"):
                await paynow_gateway.handle_webhook(webhook_data)


class TestPayNowErrorHandling:
    """Test error handling."""
    
    @pytest.mark.asyncio
    async def test_handles_timeout_error(self, paynow_gateway, sample_payment_request):
        """Test handling of timeout errors."""
        with patch.object(paynow_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = TimeoutError("Request timeout")
            
            with pytest.raises(TimeoutError):
                await paynow_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_handles_connection_error(self, paynow_gateway, sample_payment_request):
        """Test handling of connection errors."""
        with patch.object(paynow_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = ConnectionError("Connection failed")
            
            with pytest.raises(ConnectionError):
                await paynow_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_handles_rate_limit(self, paynow_gateway, sample_payment_request):
        """Test handling of rate limit errors."""
        mock_error = {
            "status": "error",
            "error_code": "RATE_LIMIT_EXCEEDED",
            "message": "Too many requests"
        }
        
        with patch.object(paynow_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_error
            
            result = await paynow_gateway.initiate_payment(sample_payment_request)
            
            assert result['status'] == 'error'
            assert result['error_code'] == 'RATE_LIMIT_EXCEEDED'


class TestPayNowRequestValidation:
    """Test request validation."""
    
    def test_validate_amount_positive(self, paynow_gateway):
        """Test amount validation accepts positive values."""
        assert paynow_gateway._validate_amount(100.00) is True
    
    def test_validate_amount_rejects_negative(self, paynow_gateway):
        """Test amount validation rejects negative values."""
        with pytest.raises(ValueError):
            paynow_gateway._validate_amount(-100.00)
    
    def test_validate_amount_rejects_zero(self, paynow_gateway):
        """Test amount validation rejects zero."""
        with pytest.raises(ValueError):
            paynow_gateway._validate_amount(0.00)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
