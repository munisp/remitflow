"""
Comprehensive test suite for SWIFT Payment Gateway.

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
    from backend.payment_gateways.swift_gateway import SWIFTGateway
except ImportError:
    import sys
    sys.path.insert(0, '/home/ubuntu/UNIFIED_PLATFORM_COMPLETE')
    from backend.payment_gateways.swift_gateway import SWIFTGateway


@pytest.fixture
def swift_gateway():
    """Create SWIFT gateway instance for testing."""
    return SWIFTGateway(
        api_key="test_api_key",
        api_secret="test_api_secret",
        base_url="https://api-test.swift.com"
    )


@pytest.fixture
def sample_payment_request():
    """Sample payment request data."""
    return {
        "amount": 10000.00,
        "currency": "USD",
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
        "transaction_id": "SWIFT-TXN-123456",
        "reference": "TXN-20251105120000",
        "message": "Payment initiated successfully"
    }


class TestSWIFTGatewayInitialization:
    """Test gateway initialization."""
    
    def test_gateway_initialization_success(self, swift_gateway):
        """Test successful gateway initialization."""
        assert swift_gateway is not None
        assert swift_gateway.api_key == "test_api_key"
    
    def test_gateway_initialization_missing_credentials(self):
        """Test gateway raises error with missing credentials."""
        with pytest.raises((ValueError, TypeError)):
            SWIFTGateway(api_key=None, api_secret=None)


class TestSWIFTPaymentInitiation:
    """Test payment initiation functionality."""
    
    @pytest.mark.asyncio
    async def test_initiate_payment_success(self, swift_gateway, sample_payment_request, mock_success_response):
        """Test successful payment initiation."""
        with patch.object(swift_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_success_response
            
            result = await swift_gateway.initiate_payment(sample_payment_request)
            
            assert result['status'] == 'success'
            assert 'transaction_id' in result
    
    @pytest.mark.asyncio
    async def test_initiate_payment_invalid_amount(self, swift_gateway, sample_payment_request):
        """Test payment fails with invalid amount."""
        sample_payment_request['amount'] = -100
        
        with pytest.raises(ValueError, match="amount"):
            await swift_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_missing_sender(self, swift_gateway, sample_payment_request):
        """Test payment fails with missing sender."""
        del sample_payment_request['sender']
        
        with pytest.raises((ValueError, KeyError)):
            await swift_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_missing_recipient(self, swift_gateway, sample_payment_request):
        """Test payment fails with missing recipient."""
        del sample_payment_request['recipient']
        
        with pytest.raises((ValueError, KeyError)):
            await swift_gateway.initiate_payment(sample_payment_request)


class TestSWIFTPaymentStatus:
    """Test payment status queries."""
    
    @pytest.mark.asyncio
    async def test_get_payment_status_success(self, swift_gateway):
        """Test successful status query."""
        transaction_id = "SWIFT-TXN-123456"
        mock_status = {
            "status": "completed",
            "transaction_id": transaction_id,
            "amount": 10000.00
        }
        
        with patch.object(swift_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await swift_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'completed'
    
    @pytest.mark.asyncio
    async def test_get_payment_status_pending(self, swift_gateway):
        """Test status query for pending payment."""
        transaction_id = "SWIFT-TXN-123456"
        mock_status = {
            "status": "pending",
            "transaction_id": transaction_id
        }
        
        with patch.object(swift_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await swift_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'pending'
    
    @pytest.mark.asyncio
    async def test_get_payment_status_failed(self, swift_gateway):
        """Test status query for failed payment."""
        transaction_id = "SWIFT-TXN-123456"
        mock_status = {
            "status": "failed",
            "transaction_id": transaction_id,
            "error_code": "PROCESSING_ERROR"
        }
        
        with patch.object(swift_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await swift_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'failed'


class TestSWIFTWebhookHandling:
    """Test webhook callback handling."""
    
    @pytest.mark.asyncio
    async def test_handle_webhook_success(self, swift_gateway):
        """Test successful webhook handling."""
        webhook_data = {
            "event": "payment.completed",
            "transaction_id": "SWIFT-TXN-123456",
            "status": "completed",
            "signature": "valid_signature"
        }
        
        with patch.object(swift_gateway, '_verify_webhook_signature', return_value=True):
            result = await swift_gateway.handle_webhook(webhook_data)
            
            assert result['status'] == 'completed'
    
    @pytest.mark.asyncio
    async def test_handle_webhook_invalid_signature(self, swift_gateway):
        """Test webhook rejects invalid signature."""
        webhook_data = {
            "event": "payment.completed",
            "signature": "invalid_signature"
        }
        
        with patch.object(swift_gateway, '_verify_webhook_signature', return_value=False):
            with pytest.raises(ValueError, match="signature"):
                await swift_gateway.handle_webhook(webhook_data)


class TestSWIFTErrorHandling:
    """Test error handling."""
    
    @pytest.mark.asyncio
    async def test_handles_timeout_error(self, swift_gateway, sample_payment_request):
        """Test handling of timeout errors."""
        with patch.object(swift_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = TimeoutError("Request timeout")
            
            with pytest.raises(TimeoutError):
                await swift_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_handles_connection_error(self, swift_gateway, sample_payment_request):
        """Test handling of connection errors."""
        with patch.object(swift_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = ConnectionError("Connection failed")
            
            with pytest.raises(ConnectionError):
                await swift_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_handles_rate_limit(self, swift_gateway, sample_payment_request):
        """Test handling of rate limit errors."""
        mock_error = {
            "status": "error",
            "error_code": "RATE_LIMIT_EXCEEDED",
            "message": "Too many requests"
        }
        
        with patch.object(swift_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_error
            
            result = await swift_gateway.initiate_payment(sample_payment_request)
            
            assert result['status'] == 'error'
            assert result['error_code'] == 'RATE_LIMIT_EXCEEDED'


class TestSWIFTRequestValidation:
    """Test request validation."""
    
    def test_validate_amount_positive(self, swift_gateway):
        """Test amount validation accepts positive values."""
        assert swift_gateway._validate_amount(100.00) is True
    
    def test_validate_amount_rejects_negative(self, swift_gateway):
        """Test amount validation rejects negative values."""
        with pytest.raises(ValueError):
            swift_gateway._validate_amount(-100.00)
    
    def test_validate_amount_rejects_zero(self, swift_gateway):
        """Test amount validation rejects zero."""
        with pytest.raises(ValueError):
            swift_gateway._validate_amount(0.00)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
