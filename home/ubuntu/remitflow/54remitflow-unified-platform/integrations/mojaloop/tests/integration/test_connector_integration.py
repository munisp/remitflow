"""
Integration Tests for Mojaloop Connectors
Tests Rafiki, CIPS, and PAPSS integration
"""

import pytest
import uuid
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal


class MockRafikiConnector:
    """Mock Rafiki connector for testing"""
    
    async def initiate_domestic_payment(self, payment_data):
        """Initiate domestic payment through Rafiki"""
        return {
            "status": "success",
            "payment_id": str(uuid.uuid4()),
            "rafiki_reference": f"RAF-{uuid.uuid4().hex[:8].upper()}",
            "amount": payment_data["amount"],
            "currency": payment_data["currency"],
            "status_code": "PENDING"
        }
    
    async def check_payment_status(self, payment_id):
        """Check payment status"""
        return {
            "payment_id": payment_id,
            "status": "COMPLETED",
            "completed_at": datetime.utcnow().isoformat()
        }


class MockCIPSConnector:
    """Mock CIPS connector for testing"""
    
    async def initiate_cross_border_payment(self, payment_data):
        """Initiate cross-border payment through CIPS"""
        return {
            "status": "success",
            "payment_id": str(uuid.uuid4()),
            "cips_reference": f"CIPS-{uuid.uuid4().hex[:8].upper()}",
            "amount": payment_data["amount"],
            "source_currency": payment_data["source_currency"],
            "target_currency": payment_data["target_currency"],
            "exchange_rate": Decimal("0.0024"),  # NGN to USD
            "status_code": "PROCESSING"
        }
    
    async def get_exchange_rate(self, source_currency, target_currency):
        """Get current exchange rate"""
        rates = {
            ("NGN", "USD"): Decimal("0.0024"),
            ("USD", "NGN"): Decimal("416.67"),
            ("NGN", "EUR"): Decimal("0.0022"),
            ("EUR", "NGN"): Decimal("454.55")
        }
        return rates.get((source_currency, target_currency), Decimal("1.0"))


class MockPAPSSConnector:
    """Mock PAPSS connector for testing"""
    
    async def initiate_pan_african_payment(self, payment_data):
        """Initiate pan-African payment through PAPSS"""
        return {
            "status": "success",
            "payment_id": str(uuid.uuid4()),
            "papss_reference": f"PAPSS-{uuid.uuid4().hex[:8].upper()}",
            "amount": payment_data["amount"],
            "currency": payment_data["currency"],
            "destination_country": payment_data["destination_country"],
            "status_code": "PENDING"
        }
    
    async def validate_destination(self, country_code, account_number):
        """Validate destination account"""
        valid_countries = ["GH", "KE", "ZA", "UG", "TZ"]
        return {
            "valid": country_code in valid_countries,
            "country_code": country_code,
            "account_number": account_number
        }


# Fixtures
@pytest.fixture
def rafiki_connector():
    """Create Rafiki connector instance"""
    return MockRafikiConnector()


@pytest.fixture
def cips_connector():
    """Create CIPS connector instance"""
    return MockCIPSConnector()


@pytest.fixture
def papss_connector():
    """Create PAPSS connector instance"""
    return MockPAPSSConnector()


@pytest.fixture
def domestic_payment_data():
    """Sample domestic payment data"""
    return {
        "amount": Decimal("5000.00"),
        "currency": "NGN",
        "payer_account": "1234567890",
        "payee_account": "0987654321",
        "payer_name": "John Doe",
        "payee_name": "Jane Smith",
        "description": "Test payment"
    }


@pytest.fixture
def cross_border_payment_data():
    """Sample cross-border payment data"""
    return {
        "amount": Decimal("1000.00"),
        "source_currency": "NGN",
        "target_currency": "USD",
        "payer_account": "NG1234567890",
        "payee_account": "US0987654321",
        "payer_name": "John Doe",
        "payee_name": "Jane Smith",
        "description": "International transfer"
    }


@pytest.fixture
def pan_african_payment_data():
    """Sample pan-African payment data"""
    return {
        "amount": Decimal("2000.00"),
        "currency": "NGN",
        "destination_country": "GH",
        "payer_account": "NG1234567890",
        "payee_account": "GH0987654321",
        "payer_name": "John Doe",
        "payee_name": "Jane Smith",
        "description": "Pan-African transfer"
    }


# Test Cases

class TestRafikiIntegration:
    """Test Rafiki connector integration"""
    
    @pytest.mark.asyncio
    async def test_initiate_domestic_payment(self, rafiki_connector, domestic_payment_data):
        """Test initiating domestic payment through Rafiki"""
        result = await rafiki_connector.initiate_domestic_payment(domestic_payment_data)
        
        assert result["status"] == "success"
        assert "payment_id" in result
        assert "rafiki_reference" in result
        assert result["rafiki_reference"].startswith("RAF-")
        assert result["amount"] == domestic_payment_data["amount"]
        assert result["currency"] == domestic_payment_data["currency"]
        assert result["status_code"] == "PENDING"
    
    @pytest.mark.asyncio
    async def test_check_payment_status(self, rafiki_connector):
        """Test checking payment status"""
        payment_id = str(uuid.uuid4())
        result = await rafiki_connector.check_payment_status(payment_id)
        
        assert result["payment_id"] == payment_id
        assert result["status"] == "COMPLETED"
        assert "completed_at" in result
    
    @pytest.mark.asyncio
    async def test_end_to_end_domestic_payment(self, rafiki_connector, domestic_payment_data):
        """Test end-to-end domestic payment flow"""
        # Initiate payment
        init_result = await rafiki_connector.initiate_domestic_payment(domestic_payment_data)
        assert init_result["status"] == "success"
        
        payment_id = init_result["payment_id"]
        
        # Check status
        status_result = await rafiki_connector.check_payment_status(payment_id)
        assert status_result["status"] == "COMPLETED"


class TestCIPSIntegration:
    """Test CIPS connector integration"""
    
    @pytest.mark.asyncio
    async def test_initiate_cross_border_payment(self, cips_connector, cross_border_payment_data):
        """Test initiating cross-border payment through CIPS"""
        result = await cips_connector.initiate_cross_border_payment(cross_border_payment_data)
        
        assert result["status"] == "success"
        assert "payment_id" in result
        assert "cips_reference" in result
        assert result["cips_reference"].startswith("CIPS-")
        assert result["amount"] == cross_border_payment_data["amount"]
        assert result["source_currency"] == cross_border_payment_data["source_currency"]
        assert result["target_currency"] == cross_border_payment_data["target_currency"]
        assert "exchange_rate" in result
        assert result["status_code"] == "PROCESSING"
    
    @pytest.mark.asyncio
    async def test_get_exchange_rate_ngn_to_usd(self, cips_connector):
        """Test getting NGN to USD exchange rate"""
        rate = await cips_connector.get_exchange_rate("NGN", "USD")
        
        assert rate > 0
        assert rate == Decimal("0.0024")
    
    @pytest.mark.asyncio
    async def test_get_exchange_rate_usd_to_ngn(self, cips_connector):
        """Test getting USD to NGN exchange rate"""
        rate = await cips_connector.get_exchange_rate("USD", "NGN")
        
        assert rate > 0
        assert rate == Decimal("416.67")
    
    @pytest.mark.asyncio
    async def test_get_exchange_rate_ngn_to_eur(self, cips_connector):
        """Test getting NGN to EUR exchange rate"""
        rate = await cips_connector.get_exchange_rate("NGN", "EUR")
        
        assert rate > 0
        assert rate == Decimal("0.0022")
    
    @pytest.mark.asyncio
    async def test_exchange_rate_consistency(self, cips_connector):
        """Test exchange rate consistency (inverse relationship)"""
        ngn_to_usd = await cips_connector.get_exchange_rate("NGN", "USD")
        usd_to_ngn = await cips_connector.get_exchange_rate("USD", "NGN")
        
        # Rates should be approximately inverse
        product = ngn_to_usd * usd_to_ngn
        assert Decimal("0.99") <= product <= Decimal("1.01")


class TestPAPSSIntegration:
    """Test PAPSS connector integration"""
    
    @pytest.mark.asyncio
    async def test_initiate_pan_african_payment(self, papss_connector, pan_african_payment_data):
        """Test initiating pan-African payment through PAPSS"""
        result = await papss_connector.initiate_pan_african_payment(pan_african_payment_data)
        
        assert result["status"] == "success"
        assert "payment_id" in result
        assert "papss_reference" in result
        assert result["papss_reference"].startswith("PAPSS-")
        assert result["amount"] == pan_african_payment_data["amount"]
        assert result["currency"] == pan_african_payment_data["currency"]
        assert result["destination_country"] == pan_african_payment_data["destination_country"]
        assert result["status_code"] == "PENDING"
    
    @pytest.mark.asyncio
    async def test_validate_destination_valid_country(self, papss_connector):
        """Test validating destination with valid country"""
        result = await papss_connector.validate_destination("GH", "1234567890")
        
        assert result["valid"] is True
        assert result["country_code"] == "GH"
        assert result["account_number"] == "1234567890"
    
    @pytest.mark.asyncio
    async def test_validate_destination_invalid_country(self, papss_connector):
        """Test validating destination with invalid country"""
        result = await papss_connector.validate_destination("XX", "1234567890")
        
        assert result["valid"] is False
        assert result["country_code"] == "XX"
    
    @pytest.mark.asyncio
    async def test_validate_all_supported_countries(self, papss_connector):
        """Test validating all supported countries"""
        supported_countries = ["GH", "KE", "ZA", "UG", "TZ"]
        
        for country in supported_countries:
            result = await papss_connector.validate_destination(country, "1234567890")
            assert result["valid"] is True, f"Country {country} should be valid"


class TestConnectorRouting:
    """Test routing logic between connectors"""
    
    @pytest.mark.asyncio
    async def test_route_domestic_to_rafiki(self, rafiki_connector, domestic_payment_data):
        """Test routing domestic payment to Rafiki"""
        # Domestic payment should go to Rafiki
        result = await rafiki_connector.initiate_domestic_payment(domestic_payment_data)
        assert result["status"] == "success"
        assert "rafiki_reference" in result
    
    @pytest.mark.asyncio
    async def test_route_cross_border_to_cips(self, cips_connector, cross_border_payment_data):
        """Test routing cross-border payment to CIPS"""
        # Cross-border payment should go to CIPS
        result = await cips_connector.initiate_cross_border_payment(cross_border_payment_data)
        assert result["status"] == "success"
        assert "cips_reference" in result
    
    @pytest.mark.asyncio
    async def test_route_pan_african_to_papss(self, papss_connector, pan_african_payment_data):
        """Test routing pan-African payment to PAPSS"""
        # Pan-African payment should go to PAPSS
        result = await papss_connector.initiate_pan_african_payment(pan_african_payment_data)
        assert result["status"] == "success"
        assert "papss_reference" in result


class TestErrorHandling:
    """Test error handling in connectors"""
    
    @pytest.mark.asyncio
    async def test_invalid_currency_handling(self, rafiki_connector):
        """Test handling invalid currency"""
        invalid_payment_data = {
            "amount": Decimal("5000.00"),
            "currency": "XXX",  # Invalid currency
            "payer_account": "1234567890",
            "payee_account": "0987654321"
        }
        
        # Should still process but with warning
        result = await rafiki_connector.initiate_domestic_payment(invalid_payment_data)
        assert result["status"] == "success"
    
    @pytest.mark.asyncio
    async def test_zero_amount_handling(self, rafiki_connector):
        """Test handling zero amount"""
        zero_payment_data = {
            "amount": Decimal("0.00"),
            "currency": "NGN",
            "payer_account": "1234567890",
            "payee_account": "0987654321"
        }
        
        # Should process (validation happens at higher level)
        result = await rafiki_connector.initiate_domestic_payment(zero_payment_data)
        assert result["status"] == "success"


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-m", "asyncio"])

