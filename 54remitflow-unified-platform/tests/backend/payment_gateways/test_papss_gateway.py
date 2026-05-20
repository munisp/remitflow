"""
Comprehensive test suite for PAPSS Payment Gateway.

Tests cover:
- Payment initiation (success and error scenarios)
- Payment status queries
- Webhook callback handling
- Payment cancellation
- Error handling and retries
- Request/response validation
- Timeout handling
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime, timedelta
import json

# Assuming the gateway is in backend/payment_gateways/papss_gateway.py
# Adjust import path as needed
try:
    from backend.payment_gateways.papss_gateway import PAPSSGateway
except ImportError:
    # Fallback for different directory structures
    import sys
    sys.path.insert(0, '/home/ubuntu/UNIFIED_PLATFORM_COMPLETE')
    from backend.payment_gateways.papss_gateway import PAPSSGateway


@pytest.fixture
def papss_gateway():
    """Create PAPSS gateway instance for testing."""
    return PAPSSGateway(
        api_key="test_api_key_123",
        api_secret="test_api_secret_456",
        base_url="https://api-test.papss.com"
    )


@pytest.fixture
def sample_payment_request():
    """Sample payment request data."""
    return {
        "amount": 10000.00,
        "currency": "NGN",
        "sender": {
            "name": "John Doe",
            "account": "1234567890",
            "bank_code": "058",
            "country": "NG"
        },
        "recipient": {
            "name": "Jane Smith",
            "account": "0987654321",
            "bank_code": "044",
            "country": "KE"
        },
        "reference": "TXN-" + datetime.now().strftime("%Y%m%d%H%M%S"),
        "description": "Test payment"
    }


@pytest.fixture
def mock_successful_response():
    """Mock successful API response."""
    return {
        "status": "success",
        "transaction_id": "PAPSS-TXN-123456",
        "reference": "TXN-20251105120000",
        "status_code": "00",
        "message": "Payment initiated successfully",
        "estimated_settlement": "60 seconds"
    }


@pytest.fixture
def mock_error_response():
    """Mock error API response."""
    return {
        "status": "error",
        "error_code": "INSUFFICIENT_FUNDS",
        "message": "Insufficient funds in sender account",
        "status_code": "51"
    }


class TestPAPSSGatewayInitialization:
    """Test gateway initialization and configuration."""
    
    def test_gateway_initialization_with_valid_credentials(self):
        """Test gateway initializes correctly with valid credentials."""
        gateway = PAPSSGateway(
            api_key="test_key",
            api_secret="test_secret",
            base_url="https://api-test.papss.com"
        )
        assert gateway is not None
        assert gateway.api_key == "test_key"
        assert gateway.base_url == "https://api-test.papss.com"
    
    def test_gateway_initialization_with_missing_credentials(self):
        """Test gateway raises error with missing credentials."""
        with pytest.raises((ValueError, TypeError)):
            PAPSSGateway(api_key=None, api_secret=None)
    
    def test_gateway_uses_default_base_url_if_not_provided(self):
        """Test gateway uses default base URL if not provided."""
        gateway = PAPSSGateway(api_key="test_key", api_secret="test_secret")
        assert gateway.base_url is not None
        assert "papss.com" in gateway.base_url.lower()


class TestPaymentInitiation:
    """Test payment initiation functionality."""
    
    @pytest.mark.asyncio
    async def test_initiate_payment_success(self, papss_gateway, sample_payment_request, mock_successful_response):
        """Test successful payment initiation."""
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_successful_response
            
            result = await papss_gateway.initiate_payment(sample_payment_request)
            
            assert result['status'] == 'success'
            assert 'transaction_id' in result
            assert result['transaction_id'] == 'PAPSS-TXN-123456'
            mock_request.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_initiate_payment_with_invalid_amount(self, papss_gateway, sample_payment_request):
        """Test payment initiation fails with invalid amount."""
        sample_payment_request['amount'] = -100  # Negative amount
        
        with pytest.raises(ValueError, match="amount"):
            await papss_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_with_invalid_currency(self, papss_gateway, sample_payment_request):
        """Test payment initiation fails with invalid currency."""
        sample_payment_request['currency'] = "INVALID"
        
        with pytest.raises(ValueError, match="currency"):
            await papss_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_with_missing_sender_info(self, papss_gateway, sample_payment_request):
        """Test payment initiation fails with missing sender information."""
        del sample_payment_request['sender']
        
        with pytest.raises((ValueError, KeyError)):
            await papss_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_with_missing_recipient_info(self, papss_gateway, sample_payment_request):
        """Test payment initiation fails with missing recipient information."""
        del sample_payment_request['recipient']
        
        with pytest.raises((ValueError, KeyError)):
            await papss_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_handles_api_error(self, papss_gateway, sample_payment_request, mock_error_response):
        """Test payment initiation handles API errors gracefully."""
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_error_response
            
            result = await papss_gateway.initiate_payment(sample_payment_request)
            
            assert result['status'] == 'error'
            assert 'error_code' in result
            assert result['error_code'] == 'INSUFFICIENT_FUNDS'
    
    @pytest.mark.asyncio
    async def test_initiate_payment_retries_on_network_error(self, papss_gateway, sample_payment_request):
        """Test payment initiation retries on network errors."""
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = [
                Exception("Network timeout"),
                Exception("Network timeout"),
                {"status": "success", "transaction_id": "PAPSS-TXN-123456"}
            ]
            
            result = await papss_gateway.initiate_payment(sample_payment_request)
            
            assert result['status'] == 'success'
            assert mock_request.call_count == 3  # Initial + 2 retries


class TestPaymentStatusQuery:
    """Test payment status query functionality."""
    
    @pytest.mark.asyncio
    async def test_get_payment_status_success(self, papss_gateway):
        """Test successful payment status query."""
        transaction_id = "PAPSS-TXN-123456"
        mock_status_response = {
            "status": "completed",
            "transaction_id": transaction_id,
            "amount": 10000.00,
            "currency": "NGN",
            "completed_at": datetime.now().isoformat()
        }
        
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status_response
            
            result = await papss_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'completed'
            assert result['transaction_id'] == transaction_id
    
    @pytest.mark.asyncio
    async def test_get_payment_status_pending(self, papss_gateway):
        """Test payment status query for pending payment."""
        transaction_id = "PAPSS-TXN-123456"
        mock_status_response = {
            "status": "pending",
            "transaction_id": transaction_id,
            "estimated_completion": "30 seconds"
        }
        
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status_response
            
            result = await papss_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'pending'
    
    @pytest.mark.asyncio
    async def test_get_payment_status_failed(self, papss_gateway):
        """Test payment status query for failed payment."""
        transaction_id = "PAPSS-TXN-123456"
        mock_status_response = {
            "status": "failed",
            "transaction_id": transaction_id,
            "error_code": "BENEFICIARY_ACCOUNT_INVALID",
            "error_message": "Beneficiary account not found"
        }
        
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status_response
            
            result = await papss_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'failed'
            assert 'error_code' in result
    
    @pytest.mark.asyncio
    async def test_get_payment_status_with_invalid_transaction_id(self, papss_gateway):
        """Test payment status query with invalid transaction ID."""
        with pytest.raises(ValueError, match="transaction_id"):
            await papss_gateway.get_payment_status("")
    
    @pytest.mark.asyncio
    async def test_get_payment_status_not_found(self, papss_gateway):
        """Test payment status query for non-existent transaction."""
        transaction_id = "INVALID-TXN-999999"
        
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = {
                "status": "error",
                "error_code": "TRANSACTION_NOT_FOUND",
                "message": "Transaction not found"
            }
            
            result = await papss_gateway.get_payment_status(transaction_id)
            
            assert result['status'] == 'error'
            assert result['error_code'] == 'TRANSACTION_NOT_FOUND'


class TestWebhookCallbacks:
    """Test webhook callback handling."""
    
    @pytest.mark.asyncio
    async def test_handle_callback_payment_completed(self, papss_gateway):
        """Test handling callback for completed payment."""
        callback_data = {
            "event": "payment.completed",
            "transaction_id": "PAPSS-TXN-123456",
            "status": "completed",
            "amount": 10000.00,
            "currency": "NGN",
            "completed_at": datetime.now().isoformat(),
            "signature": "valid_signature_hash"
        }
        
        with patch.object(papss_gateway, '_verify_webhook_signature', return_value=True):
            result = await papss_gateway.handle_callback(callback_data)
            
            assert result['status'] == 'completed'
            assert result['transaction_id'] == 'PAPSS-TXN-123456'
    
    @pytest.mark.asyncio
    async def test_handle_callback_payment_failed(self, papss_gateway):
        """Test handling callback for failed payment."""
        callback_data = {
            "event": "payment.failed",
            "transaction_id": "PAPSS-TXN-123456",
            "status": "failed",
            "error_code": "TIMEOUT",
            "error_message": "Payment processing timeout",
            "signature": "valid_signature_hash"
        }
        
        with patch.object(papss_gateway, '_verify_webhook_signature', return_value=True):
            result = await papss_gateway.handle_callback(callback_data)
            
            assert result['status'] == 'failed'
            assert result['error_code'] == 'TIMEOUT'
    
    @pytest.mark.asyncio
    async def test_handle_callback_invalid_signature(self, papss_gateway):
        """Test handling callback with invalid signature."""
        callback_data = {
            "event": "payment.completed",
            "transaction_id": "PAPSS-TXN-123456",
            "signature": "invalid_signature"
        }
        
        with patch.object(papss_gateway, '_verify_webhook_signature', return_value=False):
            with pytest.raises(ValueError, match="signature"):
                await papss_gateway.handle_callback(callback_data)
    
    @pytest.mark.asyncio
    async def test_handle_callback_missing_signature(self, papss_gateway):
        """Test handling callback with missing signature."""
        callback_data = {
            "event": "payment.completed",
            "transaction_id": "PAPSS-TXN-123456"
            # Missing signature
        }
        
        with pytest.raises((ValueError, KeyError)):
            await papss_gateway.handle_callback(callback_data)


class TestPaymentCancellation:
    """Test payment cancellation functionality."""
    
    @pytest.mark.asyncio
    async def test_cancel_payment_success(self, papss_gateway):
        """Test successful payment cancellation."""
        transaction_id = "PAPSS-TXN-123456"
        mock_cancel_response = {
            "status": "cancelled",
            "transaction_id": transaction_id,
            "message": "Payment cancelled successfully"
        }
        
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_cancel_response
            
            result = await papss_gateway.cancel_payment(transaction_id)
            
            assert result['status'] == 'cancelled'
            assert result['transaction_id'] == transaction_id
    
    @pytest.mark.asyncio
    async def test_cancel_payment_already_completed(self, papss_gateway):
        """Test cancellation of already completed payment."""
        transaction_id = "PAPSS-TXN-123456"
        mock_error_response = {
            "status": "error",
            "error_code": "PAYMENT_ALREADY_COMPLETED",
            "message": "Cannot cancel completed payment"
        }
        
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_error_response
            
            result = await papss_gateway.cancel_payment(transaction_id)
            
            assert result['status'] == 'error'
            assert result['error_code'] == 'PAYMENT_ALREADY_COMPLETED'
    
    @pytest.mark.asyncio
    async def test_cancel_payment_with_invalid_transaction_id(self, papss_gateway):
        """Test payment cancellation with invalid transaction ID."""
        with pytest.raises(ValueError, match="transaction_id"):
            await papss_gateway.cancel_payment("")


class TestErrorHandling:
    """Test error handling and edge cases."""
    
    @pytest.mark.asyncio
    async def test_handles_timeout_error(self, papss_gateway, sample_payment_request):
        """Test handling of timeout errors."""
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = TimeoutError("Request timeout")
            
            with pytest.raises(TimeoutError):
                await papss_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_handles_connection_error(self, papss_gateway, sample_payment_request):
        """Test handling of connection errors."""
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.side_effect = ConnectionError("Connection failed")
            
            with pytest.raises(ConnectionError):
                await papss_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_handles_invalid_json_response(self, papss_gateway, sample_payment_request):
        """Test handling of invalid JSON responses."""
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = "Invalid JSON"
            
            with pytest.raises((json.JSONDecodeError, ValueError, TypeError)):
                await papss_gateway.initiate_payment(sample_payment_request)
    
    @pytest.mark.asyncio
    async def test_handles_rate_limit_error(self, papss_gateway, sample_payment_request):
        """Test handling of rate limit errors."""
        with patch.object(papss_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = {
                "status": "error",
                "error_code": "RATE_LIMIT_EXCEEDED",
                "message": "Too many requests",
                "retry_after": 60
            }
            
            result = await papss_gateway.initiate_payment(sample_payment_request)
            
            assert result['status'] == 'error'
            assert result['error_code'] == 'RATE_LIMIT_EXCEEDED'


class TestRequestValidation:
    """Test request validation functionality."""
    
    def test_validate_amount_positive(self, papss_gateway):
        """Test amount validation accepts positive values."""
        assert papss_gateway._validate_amount(100.00) is True
        assert papss_gateway._validate_amount(0.01) is True
    
    def test_validate_amount_rejects_negative(self, papss_gateway):
        """Test amount validation rejects negative values."""
        with pytest.raises(ValueError):
            papss_gateway._validate_amount(-100.00)
    
    def test_validate_amount_rejects_zero(self, papss_gateway):
        """Test amount validation rejects zero."""
        with pytest.raises(ValueError):
            papss_gateway._validate_amount(0.00)
    
    def test_validate_currency_accepts_valid_codes(self, papss_gateway):
        """Test currency validation accepts valid ISO codes."""
        valid_currencies = ["NGN", "KES", "GHS", "ZAR", "USD", "EUR"]
        for currency in valid_currencies:
            assert papss_gateway._validate_currency(currency) is True
    
    def test_validate_currency_rejects_invalid_codes(self, papss_gateway):
        """Test currency validation rejects invalid codes."""
        with pytest.raises(ValueError):
            papss_gateway._validate_currency("INVALID")
    
    def test_validate_account_number_format(self, papss_gateway):
        """Test account number validation."""
        assert papss_gateway._validate_account_number("1234567890") is True
        
        with pytest.raises(ValueError):
            papss_gateway._validate_account_number("")  # Empty
        
        with pytest.raises(ValueError):
            papss_gateway._validate_account_number("ABC")  # Too short


class TestResponseParsing:
    """Test response parsing functionality."""
    
    def test_parse_successful_response(self, papss_gateway, mock_successful_response):
        """Test parsing of successful API response."""
        parsed = papss_gateway._parse_response(mock_successful_response)
        
        assert parsed['status'] == 'success'
        assert 'transaction_id' in parsed
    
    def test_parse_error_response(self, papss_gateway, mock_error_response):
        """Test parsing of error API response."""
        parsed = papss_gateway._parse_response(mock_error_response)
        
        assert parsed['status'] == 'error'
        assert 'error_code' in parsed
    
    def test_parse_response_handles_missing_fields(self, papss_gateway):
        """Test response parsing handles missing fields gracefully."""
        incomplete_response = {"status": "success"}
        
        parsed = papss_gateway._parse_response(incomplete_response)
        
        assert parsed['status'] == 'success'
        # Should not raise error for missing optional fields


# Integration test (requires actual API credentials - skip in CI)
@pytest.mark.integration
@pytest.mark.skipif(True, reason="Requires actual PAPSS API credentials")
class TestPAPSSIntegration:
    """Integration tests with actual PAPSS API (requires credentials)."""
    
    @pytest.mark.asyncio
    async def test_real_payment_initiation(self):
        """Test actual payment initiation with real API."""
        # This test should only run with real credentials in a test environment
        pass
    
    @pytest.mark.asyncio
    async def test_real_status_query(self):
        """Test actual status query with real API."""
        pass


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
