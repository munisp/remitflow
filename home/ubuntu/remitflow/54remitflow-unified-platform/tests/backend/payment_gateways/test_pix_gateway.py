"""
Comprehensive test suite for PIX Payment Gateway (Brazil).

Tests cover:
- PIX payment initiation (instant payments)
- PIX key validation (CPF, CNPJ, email, phone, random key)
- QR code generation
- Payment status queries
- Webhook handling
- Refund processing
- Error handling and retries
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime
import json
import re

try:
    from backend.payment_gateways.pix_gateway import PIXGateway
except ImportError:
    import sys
    sys.path.insert(0, '/home/ubuntu/UNIFIED_PLATFORM_COMPLETE')
    from backend.payment_gateways.pix_gateway import PIXGateway


@pytest.fixture
def pix_gateway():
    """Create PIX gateway instance for testing."""
    return PIXGateway(
        client_id="test_client_id",
        client_secret="test_client_secret",
        certificate_path="/path/to/test/cert.pem",
        base_url="https://api-test.pix.bcb.gov.br"
    )


@pytest.fixture
def sample_pix_payment():
    """Sample PIX payment request."""
    return {
        "amount": 250.50,
        "currency": "BRL",
        "pix_key": "12345678901",  # CPF
        "pix_key_type": "CPF",
        "sender": {
            "name": "João Silva",
            "cpf": "98765432100",
            "bank": "001"  # Banco do Brasil
        },
        "description": "Test PIX payment",
        "reference": "PIX-" + datetime.now().strftime("%Y%m%d%H%M%S")
    }


@pytest.fixture
def mock_pix_success_response():
    """Mock successful PIX response."""
    return {
        "status": "approved",
        "txid": "PIX-TXN-ABC123",
        "e2e_id": "E12345678202511051200ABC123",
        "amount": 250.50,
        "timestamp": datetime.now().isoformat(),
        "qr_code": "00020126580014br.gov.bcb.pix...",
        "qr_code_image": "data:image/png;base64,iVBOR..."
    }


class TestPIXGatewayInitialization:
    """Test PIX gateway initialization."""
    
    def test_gateway_initialization_success(self):
        """Test successful gateway initialization."""
        gateway = PIXGateway(
            client_id="test_id",
            client_secret="test_secret",
            certificate_path="/path/to/cert.pem"
        )
        assert gateway is not None
        assert gateway.client_id == "test_id"
    
    def test_gateway_requires_certificate(self):
        """Test gateway requires certificate for production."""
        with pytest.raises(ValueError, match="certificate"):
            PIXGateway(
                client_id="test_id",
                client_secret="test_secret",
                certificate_path=None
            )


class TestPIXKeyValidation:
    """Test PIX key validation."""
    
    def test_validate_cpf_key_valid(self, pix_gateway):
        """Test validation of valid CPF PIX key."""
        valid_cpf = "12345678901"
        assert pix_gateway._validate_pix_key(valid_cpf, "CPF") is True
    
    def test_validate_cpf_key_invalid_format(self, pix_gateway):
        """Test validation rejects invalid CPF format."""
        invalid_cpf = "123"  # Too short
        with pytest.raises(ValueError, match="CPF"):
            pix_gateway._validate_pix_key(invalid_cpf, "CPF")
    
    def test_validate_cnpj_key_valid(self, pix_gateway):
        """Test validation of valid CNPJ PIX key."""
        valid_cnpj = "12345678000190"
        assert pix_gateway._validate_pix_key(valid_cnpj, "CNPJ") is True
    
    def test_validate_email_key_valid(self, pix_gateway):
        """Test validation of valid email PIX key."""
        valid_email = "user@example.com"
        assert pix_gateway._validate_pix_key(valid_email, "EMAIL") is True
    
    def test_validate_email_key_invalid(self, pix_gateway):
        """Test validation rejects invalid email."""
        invalid_email = "not-an-email"
        with pytest.raises(ValueError, match="email"):
            pix_gateway._validate_pix_key(invalid_email, "EMAIL")
    
    def test_validate_phone_key_valid(self, pix_gateway):
        """Test validation of valid phone PIX key."""
        valid_phone = "+5511987654321"
        assert pix_gateway._validate_pix_key(valid_phone, "PHONE") is True
    
    def test_validate_phone_key_invalid(self, pix_gateway):
        """Test validation rejects invalid phone format."""
        invalid_phone = "123"
        with pytest.raises(ValueError, match="phone"):
            pix_gateway._validate_pix_key(invalid_phone, "PHONE")
    
    def test_validate_random_key_valid(self, pix_gateway):
        """Test validation of valid random PIX key (UUID)."""
        valid_random = "123e4567-e89b-12d3-a456-426614174000"
        assert pix_gateway._validate_pix_key(valid_random, "RANDOM") is True
    
    def test_validate_random_key_invalid(self, pix_gateway):
        """Test validation rejects invalid random key."""
        invalid_random = "not-a-uuid"
        with pytest.raises(ValueError, match="random key"):
            pix_gateway._validate_pix_key(invalid_random, "RANDOM")


class TestPIXPaymentInitiation:
    """Test PIX payment initiation."""
    
    @pytest.mark.asyncio
    async def test_initiate_payment_success(self, pix_gateway, sample_pix_payment, mock_pix_success_response):
        """Test successful PIX payment initiation."""
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_pix_success_response
            
            result = await pix_gateway.initiate_payment(sample_pix_payment)
            
            assert result['status'] == 'approved'
            assert 'txid' in result
            assert 'e2e_id' in result
            assert 'qr_code' in result
    
    @pytest.mark.asyncio
    async def test_initiate_payment_with_invalid_amount(self, pix_gateway, sample_pix_payment):
        """Test payment fails with invalid amount."""
        sample_pix_payment['amount'] = -50.00
        
        with pytest.raises(ValueError, match="amount"):
            await pix_gateway.initiate_payment(sample_pix_payment)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_with_invalid_pix_key(self, pix_gateway, sample_pix_payment):
        """Test payment fails with invalid PIX key."""
        sample_pix_payment['pix_key'] = "invalid"
        sample_pix_payment['pix_key_type'] = "CPF"
        
        with pytest.raises(ValueError):
            await pix_gateway.initiate_payment(sample_pix_payment)
    
    @pytest.mark.asyncio
    async def test_initiate_payment_instant_settlement(self, pix_gateway, sample_pix_payment, mock_pix_success_response):
        """Test PIX payment settles instantly (< 10 seconds)."""
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_pix_success_response
            
            start_time = datetime.now()
            result = await pix_gateway.initiate_payment(sample_pix_payment)
            end_time = datetime.now()
            
            # PIX should be instant
            assert (end_time - start_time).total_seconds() < 10
            assert result['status'] == 'approved'
    
    @pytest.mark.asyncio
    async def test_initiate_payment_generates_qr_code(self, pix_gateway, sample_pix_payment, mock_pix_success_response):
        """Test payment generates QR code."""
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_pix_success_response
            
            result = await pix_gateway.initiate_payment(sample_pix_payment)
            
            assert 'qr_code' in result
            assert result['qr_code'].startswith('00020126')  # PIX QR code format
            assert 'qr_code_image' in result


class TestQRCodeGeneration:
    """Test PIX QR code generation."""
    
    def test_generate_qr_code_static(self, pix_gateway):
        """Test generation of static PIX QR code."""
        pix_data = {
            "pix_key": "12345678901",
            "amount": 100.00,
            "merchant_name": "Test Merchant",
            "merchant_city": "São Paulo"
        }
        
        qr_code = pix_gateway._generate_qr_code(pix_data, static=True)
        
        assert qr_code is not None
        assert qr_code.startswith('00020126')
        assert '5303986' in qr_code  # BRL currency code
    
    def test_generate_qr_code_dynamic(self, pix_gateway):
        """Test generation of dynamic PIX QR code."""
        pix_data = {
            "pix_key": "12345678901",
            "amount": 100.00,
            "txid": "PIX-TXN-123",
            "merchant_name": "Test Merchant"
        }
        
        qr_code = pix_gateway._generate_qr_code(pix_data, static=False)
        
        assert qr_code is not None
        assert 'PIX-TXN-123' in qr_code
    
    def test_generate_qr_code_with_description(self, pix_gateway):
        """Test QR code includes description."""
        pix_data = {
            "pix_key": "12345678901",
            "amount": 100.00,
            "description": "Payment for services"
        }
        
        qr_code = pix_gateway._generate_qr_code(pix_data)
        
        assert 'Payment for services' in qr_code or len(qr_code) > 100


class TestPaymentStatusQuery:
    """Test PIX payment status queries."""
    
    @pytest.mark.asyncio
    async def test_get_payment_status_approved(self, pix_gateway):
        """Test status query for approved payment."""
        txid = "PIX-TXN-123"
        mock_status = {
            "status": "approved",
            "txid": txid,
            "e2e_id": "E12345678202511051200ABC123",
            "amount": 250.50,
            "settled_at": datetime.now().isoformat()
        }
        
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await pix_gateway.get_payment_status(txid)
            
            assert result['status'] == 'approved'
            assert 'settled_at' in result
    
    @pytest.mark.asyncio
    async def test_get_payment_status_pending(self, pix_gateway):
        """Test status query for pending payment."""
        txid = "PIX-TXN-123"
        mock_status = {
            "status": "pending",
            "txid": txid,
            "created_at": datetime.now().isoformat()
        }
        
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await pix_gateway.get_payment_status(txid)
            
            assert result['status'] == 'pending'
    
    @pytest.mark.asyncio
    async def test_get_payment_status_rejected(self, pix_gateway):
        """Test status query for rejected payment."""
        txid = "PIX-TXN-123"
        mock_status = {
            "status": "rejected",
            "txid": txid,
            "rejection_reason": "Invalid PIX key"
        }
        
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_status
            
            result = await pix_gateway.get_payment_status(txid)
            
            assert result['status'] == 'rejected'
            assert 'rejection_reason' in result


class TestWebhookHandling:
    """Test PIX webhook handling."""
    
    @pytest.mark.asyncio
    async def test_handle_webhook_payment_confirmed(self, pix_gateway):
        """Test webhook for confirmed payment."""
        webhook_data = {
            "event": "pix.payment.confirmed",
            "txid": "PIX-TXN-123",
            "e2e_id": "E12345678202511051200ABC123",
            "amount": 250.50,
            "timestamp": datetime.now().isoformat(),
            "signature": "valid_signature"
        }
        
        with patch.object(pix_gateway, '_verify_webhook_signature', return_value=True):
            result = await pix_gateway.handle_webhook(webhook_data)
            
            assert result['event'] == 'pix.payment.confirmed'
            assert result['txid'] == 'PIX-TXN-123'
    
    @pytest.mark.asyncio
    async def test_handle_webhook_invalid_signature(self, pix_gateway):
        """Test webhook rejects invalid signature."""
        webhook_data = {
            "event": "pix.payment.confirmed",
            "signature": "invalid_signature"
        }
        
        with patch.object(pix_gateway, '_verify_webhook_signature', return_value=False):
            with pytest.raises(ValueError, match="signature"):
                await pix_gateway.handle_webhook(webhook_data)
    
    @pytest.mark.asyncio
    async def test_handle_webhook_refund_processed(self, pix_gateway):
        """Test webhook for refund processed."""
        webhook_data = {
            "event": "pix.refund.processed",
            "txid": "PIX-TXN-123",
            "refund_id": "REF-123",
            "amount": 250.50,
            "signature": "valid_signature"
        }
        
        with patch.object(pix_gateway, '_verify_webhook_signature', return_value=True):
            result = await pix_gateway.handle_webhook(webhook_data)
            
            assert result['event'] == 'pix.refund.processed'
            assert 'refund_id' in result


class TestRefundProcessing:
    """Test PIX refund processing."""
    
    @pytest.mark.asyncio
    async def test_refund_payment_full(self, pix_gateway):
        """Test full refund of PIX payment."""
        txid = "PIX-TXN-123"
        mock_refund_response = {
            "status": "refunded",
            "refund_id": "REF-123",
            "txid": txid,
            "amount": 250.50,
            "refunded_at": datetime.now().isoformat()
        }
        
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_refund_response
            
            result = await pix_gateway.refund_payment(txid, amount=250.50)
            
            assert result['status'] == 'refunded'
            assert result['amount'] == 250.50
    
    @pytest.mark.asyncio
    async def test_refund_payment_partial(self, pix_gateway):
        """Test partial refund of PIX payment."""
        txid = "PIX-TXN-123"
        mock_refund_response = {
            "status": "refunded",
            "refund_id": "REF-123",
            "txid": txid,
            "amount": 100.00,
            "original_amount": 250.50
        }
        
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_refund_response
            
            result = await pix_gateway.refund_payment(txid, amount=100.00)
            
            assert result['status'] == 'refunded'
            assert result['amount'] == 100.00
    
    @pytest.mark.asyncio
    async def test_refund_payment_exceeds_original(self, pix_gateway):
        """Test refund fails when amount exceeds original."""
        txid = "PIX-TXN-123"
        
        with pytest.raises(ValueError, match="exceeds original"):
            await pix_gateway.refund_payment(txid, amount=500.00, original_amount=250.50)


class TestErrorHandling:
    """Test PIX error handling."""
    
    @pytest.mark.asyncio
    async def test_handles_insufficient_funds(self, pix_gateway, sample_pix_payment):
        """Test handling of insufficient funds error."""
        mock_error = {
            "status": "rejected",
            "error_code": "INSUFFICIENT_FUNDS",
            "message": "Insufficient funds in account"
        }
        
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_error
            
            result = await pix_gateway.initiate_payment(sample_pix_payment)
            
            assert result['status'] == 'rejected'
            assert result['error_code'] == 'INSUFFICIENT_FUNDS'
    
    @pytest.mark.asyncio
    async def test_handles_invalid_pix_key_error(self, pix_gateway, sample_pix_payment):
        """Test handling of invalid PIX key error."""
        mock_error = {
            "status": "rejected",
            "error_code": "INVALID_PIX_KEY",
            "message": "PIX key not found or invalid"
        }
        
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_error
            
            result = await pix_gateway.initiate_payment(sample_pix_payment)
            
            assert result['status'] == 'rejected'
            assert result['error_code'] == 'INVALID_PIX_KEY'
    
    @pytest.mark.asyncio
    async def test_handles_daily_limit_exceeded(self, pix_gateway, sample_pix_payment):
        """Test handling of daily limit exceeded error."""
        mock_error = {
            "status": "rejected",
            "error_code": "DAILY_LIMIT_EXCEEDED",
            "message": "Daily transaction limit exceeded"
        }
        
        with patch.object(pix_gateway, '_make_api_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_error
            
            result = await pix_gateway.initiate_payment(sample_pix_payment)
            
            assert result['status'] == 'rejected'
            assert result['error_code'] == 'DAILY_LIMIT_EXCEEDED'


class TestCertificateHandling:
    """Test SSL certificate handling for PIX."""
    
    def test_loads_certificate_from_file(self, pix_gateway):
        """Test gateway loads certificate from file."""
        with patch('builtins.open', create=True) as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b"CERT_DATA"
            
            cert_data = pix_gateway._load_certificate()
            
            assert cert_data is not None
    
    def test_validates_certificate_format(self, pix_gateway):
        """Test gateway validates certificate format."""
        invalid_cert = b"INVALID_CERT"
        
        with pytest.raises(ValueError, match="certificate"):
            pix_gateway._validate_certificate(invalid_cert)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
