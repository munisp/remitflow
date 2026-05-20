"""
Unit Tests for Mojaloop Core Functionality
Tests participant registration, quote creation, transfer processing
"""

import pytest
import uuid
from datetime import datetime, timedelta
from decimal import Decimal


class MockMojaLoopCore:
    """Mock implementation for testing"""
    
    def __init__(self):
        self.participants = {}
        self.quotes = {}
        self.transfers = {}
        self.settlements = {}
    
    def register_participant(self, participant_id, participant_info):
        """Register a new participant"""
        if participant_id in self.participants:
            raise ValueError(f"Participant {participant_id} already exists")
        
        participant_data = {
            "participant_id": participant_id,
            "name": participant_info.get("name"),
            "type": participant_info.get("type", "DFSP"),
            "currency": participant_info.get("currency", "NGN"),
            "status": "ACTIVE",
            "created_at": datetime.utcnow().isoformat(),
            "capabilities": participant_info.get("capabilities", []),
            "settlement_model": participant_info.get("settlement_model", "DEFERRED_NET")
        }
        
        self.participants[participant_id] = participant_data
        return {"status": "success", "participant_id": participant_id}
    
    def create_quote(self, quote_request):
        """Create a quote for a transfer"""
        quote_id = str(uuid.uuid4())
        
        payer_fsp = quote_request.get("payerFsp")
        payee_fsp = quote_request.get("payeeFsp")
        
        if payer_fsp not in self.participants:
            raise ValueError(f"Payer FSP {payer_fsp} not found")
        if payee_fsp not in self.participants:
            raise ValueError(f"Payee FSP {payee_fsp} not found")
        
        amount = quote_request.get("amount", {})
        transfer_amount = Decimal(str(amount.get("amount", 0)))
        currency = amount.get("currency", "NGN")
        
        # Calculate fees
        fees = self.calculate_fees(transfer_amount, currency)
        
        quote_data = {
            "quoteId": quote_id,
            "transactionId": quote_request.get("transactionId"),
            "payerFsp": payer_fsp,
            "payeeFsp": payee_fsp,
            "amount": amount,
            "fees": {"amount": str(fees), "currency": currency},
            "transferAmount": {
                "amount": str(transfer_amount + fees),
                "currency": currency
            },
            "expiration": (datetime.utcnow() + timedelta(minutes=5)).isoformat(),
            "status": "PENDING"
        }
        
        self.quotes[quote_id] = quote_data
        return quote_data
    
    def prepare_transfer(self, transfer_request):
        """Prepare a transfer"""
        transfer_id = transfer_request.get("transferId") or str(uuid.uuid4())
        
        payer_fsp = transfer_request.get("payerFsp")
        payee_fsp = transfer_request.get("payeeFsp")
        
        if payer_fsp not in self.participants:
            raise ValueError(f"Payer FSP {payer_fsp} not found")
        if payee_fsp not in self.participants:
            raise ValueError(f"Payee FSP {payee_fsp} not found")
        
        transfer_data = {
            "transferId": transfer_id,
            "payerFsp": payer_fsp,
            "payeeFsp": payee_fsp,
            "amount": transfer_request.get("amount"),
            "condition": transfer_request.get("condition"),
            "expiration": transfer_request.get("expiration"),
            "transferState": "RESERVED",
            "created_at": datetime.utcnow().isoformat()
        }
        
        self.transfers[transfer_id] = transfer_data
        return transfer_data
    
    def fulfill_transfer(self, transfer_id, fulfillment):
        """Fulfill a transfer"""
        if transfer_id not in self.transfers:
            raise ValueError(f"Transfer {transfer_id} not found")
        
        transfer = self.transfers[transfer_id]
        
        if transfer["transferState"] != "RESERVED":
            raise ValueError(f"Transfer {transfer_id} is not in RESERVED state")
        
        transfer["transferState"] = "COMMITTED"
        transfer["fulfillment"] = fulfillment
        transfer["completedTimestamp"] = datetime.utcnow().isoformat()
        
        return transfer
    
    def calculate_fees(self, amount, currency):
        """Calculate fees"""
        base_fee = Decimal("10.0")
        percentage_fee = amount * Decimal("0.001")
        return base_fee + percentage_fee


# Fixtures
@pytest.fixture
def mojaloop_core():
    """Create a fresh Mojaloop core instance for each test"""
    return MockMojaLoopCore()


@pytest.fixture
def sample_participant():
    """Sample participant data"""
    return {
        "name": "Test DFSP",
        "type": "DFSP",
        "currency": "NGN",
        "capabilities": ["transfer", "quote"],
        "settlement_model": "DEFERRED_NET"
    }


@pytest.fixture
def sample_quote_request(mojaloop_core):
    """Sample quote request"""
    # Register participants first
    mojaloop_core.register_participant("payer-fsp", {"name": "Payer FSP", "currency": "NGN"})
    mojaloop_core.register_participant("payee-fsp", {"name": "Payee FSP", "currency": "NGN"})
    
    return {
        "transactionId": str(uuid.uuid4()),
        "payerFsp": "payer-fsp",
        "payeeFsp": "payee-fsp",
        "amount": {"amount": "1000.00", "currency": "NGN"},
        "transactionType": {"scenario": "TRANSFER", "subScenario": "DOMESTIC"}
    }


# Test Cases

class TestParticipantRegistration:
    """Test participant registration functionality"""
    
    def test_register_participant_success(self, mojaloop_core, sample_participant):
        """Test successful participant registration"""
        result = mojaloop_core.register_participant("test-dfsp-1", sample_participant)
        
        assert result["status"] == "success"
        assert result["participant_id"] == "test-dfsp-1"
        assert "test-dfsp-1" in mojaloop_core.participants
        assert mojaloop_core.participants["test-dfsp-1"]["name"] == "Test DFSP"
        assert mojaloop_core.participants["test-dfsp-1"]["status"] == "ACTIVE"
    
    def test_register_duplicate_participant(self, mojaloop_core, sample_participant):
        """Test registering duplicate participant fails"""
        mojaloop_core.register_participant("test-dfsp-1", sample_participant)
        
        with pytest.raises(ValueError, match="already exists"):
            mojaloop_core.register_participant("test-dfsp-1", sample_participant)
    
    def test_participant_default_values(self, mojaloop_core):
        """Test participant default values"""
        result = mojaloop_core.register_participant("test-dfsp-2", {"name": "Test DFSP 2"})
        
        participant = mojaloop_core.participants["test-dfsp-2"]
        assert participant["type"] == "DFSP"
        assert participant["currency"] == "NGN"
        assert participant["settlement_model"] == "DEFERRED_NET"
        assert participant["capabilities"] == []


class TestQuoteCreation:
    """Test quote creation functionality"""
    
    def test_create_quote_success(self, mojaloop_core, sample_quote_request):
        """Test successful quote creation"""
        quote = mojaloop_core.create_quote(sample_quote_request)
        
        assert "quoteId" in quote
        assert quote["payerFsp"] == "payer-fsp"
        assert quote["payeeFsp"] == "payee-fsp"
        assert quote["status"] == "PENDING"
        assert "fees" in quote
        assert "transferAmount" in quote
    
    def test_create_quote_invalid_payer(self, mojaloop_core):
        """Test quote creation with invalid payer FSP"""
        quote_request = {
            "payerFsp": "invalid-fsp",
            "payeeFsp": "payee-fsp",
            "amount": {"amount": "1000.00", "currency": "NGN"}
        }
        
        with pytest.raises(ValueError, match="Payer FSP .* not found"):
            mojaloop_core.create_quote(quote_request)
    
    def test_create_quote_invalid_payee(self, mojaloop_core):
        """Test quote creation with invalid payee FSP"""
        mojaloop_core.register_participant("payer-fsp", {"name": "Payer FSP"})
        
        quote_request = {
            "payerFsp": "payer-fsp",
            "payeeFsp": "invalid-fsp",
            "amount": {"amount": "1000.00", "currency": "NGN"}
        }
        
        with pytest.raises(ValueError, match="Payee FSP .* not found"):
            mojaloop_core.create_quote(quote_request)
    
    def test_quote_fee_calculation(self, mojaloop_core, sample_quote_request):
        """Test quote fee calculation"""
        quote = mojaloop_core.create_quote(sample_quote_request)
        
        # Fee should be base_fee (10) + percentage (1000 * 0.001 = 1) = 11
        assert Decimal(quote["fees"]["amount"]) == Decimal("11.0")
        
        # Transfer amount should be amount + fees = 1000 + 11 = 1011
        assert Decimal(quote["transferAmount"]["amount"]) == Decimal("1011.0")
    
    def test_quote_expiration(self, mojaloop_core, sample_quote_request):
        """Test quote expiration is set correctly"""
        quote = mojaloop_core.create_quote(sample_quote_request)
        
        expiration = datetime.fromisoformat(quote["expiration"])
        now = datetime.utcnow()
        
        # Expiration should be approximately 5 minutes from now
        time_diff = (expiration - now).total_seconds()
        assert 290 <= time_diff <= 310  # Allow 10 second tolerance


class TestTransferProcessing:
    """Test transfer processing functionality"""
    
    def test_prepare_transfer_success(self, mojaloop_core):
        """Test successful transfer preparation"""
        mojaloop_core.register_participant("payer-fsp", {"name": "Payer FSP"})
        mojaloop_core.register_participant("payee-fsp", {"name": "Payee FSP"})
        
        transfer_request = {
            "payerFsp": "payer-fsp",
            "payeeFsp": "payee-fsp",
            "amount": {"amount": "1000.00", "currency": "NGN"},
            "condition": "test-condition",
            "expiration": (datetime.utcnow() + timedelta(minutes=5)).isoformat()
        }
        
        transfer = mojaloop_core.prepare_transfer(transfer_request)
        
        assert "transferId" in transfer
        assert transfer["transferState"] == "RESERVED"
        assert transfer["payerFsp"] == "payer-fsp"
        assert transfer["payeeFsp"] == "payee-fsp"
    
    def test_prepare_transfer_invalid_payer(self, mojaloop_core):
        """Test transfer preparation with invalid payer"""
        transfer_request = {
            "payerFsp": "invalid-fsp",
            "payeeFsp": "payee-fsp",
            "amount": {"amount": "1000.00", "currency": "NGN"},
            "condition": "test-condition"
        }
        
        with pytest.raises(ValueError, match="Payer FSP .* not found"):
            mojaloop_core.prepare_transfer(transfer_request)
    
    def test_fulfill_transfer_success(self, mojaloop_core):
        """Test successful transfer fulfillment"""
        mojaloop_core.register_participant("payer-fsp", {"name": "Payer FSP"})
        mojaloop_core.register_participant("payee-fsp", {"name": "Payee FSP"})
        
        transfer_request = {
            "payerFsp": "payer-fsp",
            "payeeFsp": "payee-fsp",
            "amount": {"amount": "1000.00", "currency": "NGN"},
            "condition": "test-condition",
            "expiration": (datetime.utcnow() + timedelta(minutes=5)).isoformat()
        }
        
        transfer = mojaloop_core.prepare_transfer(transfer_request)
        transfer_id = transfer["transferId"]
        
        fulfilled_transfer = mojaloop_core.fulfill_transfer(transfer_id, "test-fulfillment")
        
        assert fulfilled_transfer["transferState"] == "COMMITTED"
        assert fulfilled_transfer["fulfillment"] == "test-fulfillment"
        assert "completedTimestamp" in fulfilled_transfer
    
    def test_fulfill_transfer_not_found(self, mojaloop_core):
        """Test fulfilling non-existent transfer"""
        with pytest.raises(ValueError, match="Transfer .* not found"):
            mojaloop_core.fulfill_transfer("invalid-transfer-id", "test-fulfillment")
    
    def test_fulfill_transfer_wrong_state(self, mojaloop_core):
        """Test fulfilling transfer in wrong state"""
        mojaloop_core.register_participant("payer-fsp", {"name": "Payer FSP"})
        mojaloop_core.register_participant("payee-fsp", {"name": "Payee FSP"})
        
        transfer_request = {
            "payerFsp": "payer-fsp",
            "payeeFsp": "payee-fsp",
            "amount": {"amount": "1000.00", "currency": "NGN"},
            "condition": "test-condition",
            "expiration": (datetime.utcnow() + timedelta(minutes=5)).isoformat()
        }
        
        transfer = mojaloop_core.prepare_transfer(transfer_request)
        transfer_id = transfer["transferId"]
        
        # Fulfill once
        mojaloop_core.fulfill_transfer(transfer_id, "test-fulfillment")
        
        # Try to fulfill again
        with pytest.raises(ValueError, match="not in RESERVED state"):
            mojaloop_core.fulfill_transfer(transfer_id, "test-fulfillment-2")


class TestFeeCalculation:
    """Test fee calculation functionality"""
    
    def test_calculate_fees_small_amount(self, mojaloop_core):
        """Test fee calculation for small amount"""
        fees = mojaloop_core.calculate_fees(Decimal("100.00"), "NGN")
        # Base fee (10) + percentage (100 * 0.001 = 0.1) = 10.1
        assert fees == Decimal("10.1")
    
    def test_calculate_fees_large_amount(self, mojaloop_core):
        """Test fee calculation for large amount"""
        fees = mojaloop_core.calculate_fees(Decimal("100000.00"), "NGN")
        # Base fee (10) + percentage (100000 * 0.001 = 100) = 110
        assert fees == Decimal("110.0")
    
    def test_calculate_fees_zero_amount(self, mojaloop_core):
        """Test fee calculation for zero amount"""
        fees = mojaloop_core.calculate_fees(Decimal("0.00"), "NGN")
        # Base fee only = 10
        assert fees == Decimal("10.0")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

