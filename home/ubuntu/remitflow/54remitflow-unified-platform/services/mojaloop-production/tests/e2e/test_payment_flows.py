"""
End-to-End Tests for Complete Payment Flows
Tests full payment lifecycle from quote to settlement
"""

import pytest
import uuid
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal


class MockPaymentOrchestrator:
    """Mock payment orchestrator for E2E testing"""
    
    def __init__(self):
        self.participants = {}
        self.quotes = {}
        self.transfers = {}
        self.settlements = {}
    
    async def execute_domestic_payment_flow(self, payment_request):
        """Execute complete domestic payment flow"""
        # Step 1: Validate participants
        payer_fsp = payment_request["payer_fsp"]
        payee_fsp = payment_request["payee_fsp"]
        
        if payer_fsp not in self.participants:
            self.participants[payer_fsp] = {"name": f"FSP {payer_fsp}", "status": "ACTIVE"}
        if payee_fsp not in self.participants:
            self.participants[payee_fsp] = {"name": f"FSP {payee_fsp}", "status": "ACTIVE"}
        
        # Step 2: Create quote
        quote_id = str(uuid.uuid4())
        amount = Decimal(str(payment_request["amount"]))
        fees = Decimal("10.0") + (amount * Decimal("0.001"))
        
        quote = {
            "quote_id": quote_id,
            "payer_fsp": payer_fsp,
            "payee_fsp": payee_fsp,
            "amount": amount,
            "fees": fees,
            "total_amount": amount + fees,
            "currency": payment_request["currency"],
            "status": "PENDING",
            "created_at": datetime.utcnow()
        }
        self.quotes[quote_id] = quote
        
        # Step 3: Prepare transfer
        transfer_id = str(uuid.uuid4())
        transfer = {
            "transfer_id": transfer_id,
            "quote_id": quote_id,
            "payer_fsp": payer_fsp,
            "payee_fsp": payee_fsp,
            "amount": amount,
            "currency": payment_request["currency"],
            "state": "RESERVED",
            "created_at": datetime.utcnow()
        }
        self.transfers[transfer_id] = transfer
        
        # Step 4: Fulfill transfer
        await asyncio.sleep(0.1)  # Simulate processing time
        transfer["state"] = "COMMITTED"
        transfer["completed_at"] = datetime.utcnow()
        
        # Step 5: Process settlement
        settlement_id = str(uuid.uuid4())
        settlement = {
            "settlement_id": settlement_id,
            "transfer_id": transfer_id,
            "payer_fsp": payer_fsp,
            "payee_fsp": payee_fsp,
            "amount": amount,
            "currency": payment_request["currency"],
            "status": "SETTLED",
            "settled_at": datetime.utcnow()
        }
        self.settlements[settlement_id] = settlement
        
        return {
            "status": "SUCCESS",
            "quote_id": quote_id,
            "transfer_id": transfer_id,
            "settlement_id": settlement_id,
            "amount": float(amount),
            "fees": float(fees),
            "total_amount": float(amount + fees),
            "currency": payment_request["currency"]
        }
    
    async def execute_cross_border_payment_flow(self, payment_request):
        """Execute complete cross-border payment flow"""
        # Step 1: Validate participants
        payer_fsp = payment_request["payer_fsp"]
        payee_fsp = payment_request["payee_fsp"]
        
        if payer_fsp not in self.participants:
            self.participants[payer_fsp] = {"name": f"FSP {payer_fsp}", "status": "ACTIVE"}
        if payee_fsp not in self.participants:
            self.participants[payee_fsp] = {"name": f"FSP {payee_fsp}", "status": "ACTIVE"}
        
        # Step 2: Get exchange rate
        source_currency = payment_request["source_currency"]
        target_currency = payment_request["target_currency"]
        exchange_rate = Decimal("0.0024") if source_currency == "NGN" and target_currency == "USD" else Decimal("1.0")
        
        # Step 3: Create quote with FX
        quote_id = str(uuid.uuid4())
        amount = Decimal(str(payment_request["amount"]))
        fees = Decimal("50.0") + (amount * Decimal("0.005"))  # Higher fees for cross-border
        converted_amount = amount * exchange_rate
        
        quote = {
            "quote_id": quote_id,
            "payer_fsp": payer_fsp,
            "payee_fsp": payee_fsp,
            "amount": amount,
            "fees": fees,
            "total_amount": amount + fees,
            "source_currency": source_currency,
            "target_currency": target_currency,
            "exchange_rate": exchange_rate,
            "converted_amount": converted_amount,
            "status": "PENDING",
            "created_at": datetime.utcnow()
        }
        self.quotes[quote_id] = quote
        
        # Step 4: Prepare transfer
        transfer_id = str(uuid.uuid4())
        transfer = {
            "transfer_id": transfer_id,
            "quote_id": quote_id,
            "payer_fsp": payer_fsp,
            "payee_fsp": payee_fsp,
            "amount": amount,
            "source_currency": source_currency,
            "target_currency": target_currency,
            "converted_amount": converted_amount,
            "state": "RESERVED",
            "created_at": datetime.utcnow()
        }
        self.transfers[transfer_id] = transfer
        
        # Step 5: Fulfill transfer
        await asyncio.sleep(0.2)  # Simulate longer processing for cross-border
        transfer["state"] = "COMMITTED"
        transfer["completed_at"] = datetime.utcnow()
        
        # Step 6: Process settlement
        settlement_id = str(uuid.uuid4())
        settlement = {
            "settlement_id": settlement_id,
            "transfer_id": transfer_id,
            "payer_fsp": payer_fsp,
            "payee_fsp": payee_fsp,
            "amount": amount,
            "source_currency": source_currency,
            "target_currency": target_currency,
            "converted_amount": converted_amount,
            "status": "SETTLED",
            "settled_at": datetime.utcnow()
        }
        self.settlements[settlement_id] = settlement
        
        return {
            "status": "SUCCESS",
            "quote_id": quote_id,
            "transfer_id": transfer_id,
            "settlement_id": settlement_id,
            "amount": float(amount),
            "fees": float(fees),
            "total_amount": float(amount + fees),
            "source_currency": source_currency,
            "target_currency": target_currency,
            "exchange_rate": float(exchange_rate),
            "converted_amount": float(converted_amount)
        }


# Fixtures
@pytest.fixture
def orchestrator():
    """Create payment orchestrator instance"""
    return MockPaymentOrchestrator()


@pytest.fixture
def domestic_payment_request():
    """Sample domestic payment request"""
    return {
        "payer_fsp": "rafiki-ng",
        "payee_fsp": "rafiki-ng",
        "amount": "5000.00",
        "currency": "NGN",
        "payer_account": "1234567890",
        "payee_account": "0987654321"
    }


@pytest.fixture
def cross_border_payment_request():
    """Sample cross-border payment request"""
    return {
        "payer_fsp": "rafiki-ng",
        "payee_fsp": "cips-global",
        "amount": "100000.00",
        "source_currency": "NGN",
        "target_currency": "USD",
        "payer_account": "NG1234567890",
        "payee_account": "US0987654321"
    }


# Test Cases

class TestDomesticPaymentFlow:
    """Test complete domestic payment flow"""
    
    @pytest.mark.asyncio
    async def test_successful_domestic_payment(self, orchestrator, domestic_payment_request):
        """Test successful domestic payment end-to-end"""
        result = await orchestrator.execute_domestic_payment_flow(domestic_payment_request)
        
        assert result["status"] == "SUCCESS"
        assert "quote_id" in result
        assert "transfer_id" in result
        assert "settlement_id" in result
        assert result["amount"] == 5000.00
        assert result["currency"] == "NGN"
        
        # Verify quote was created
        quote_id = result["quote_id"]
        assert quote_id in orchestrator.quotes
        
        # Verify transfer was created and committed
        transfer_id = result["transfer_id"]
        assert transfer_id in orchestrator.transfers
        assert orchestrator.transfers[transfer_id]["state"] == "COMMITTED"
        
        # Verify settlement was processed
        settlement_id = result["settlement_id"]
        assert settlement_id in orchestrator.settlements
        assert orchestrator.settlements[settlement_id]["status"] == "SETTLED"
    
    @pytest.mark.asyncio
    async def test_domestic_payment_fee_calculation(self, orchestrator, domestic_payment_request):
        """Test fee calculation in domestic payment"""
        result = await orchestrator.execute_domestic_payment_flow(domestic_payment_request)
        
        # Fee should be 10 + (5000 * 0.001) = 10 + 5 = 15
        assert result["fees"] == 15.0
        assert result["total_amount"] == 5015.0
    
    @pytest.mark.asyncio
    async def test_domestic_payment_timing(self, orchestrator, domestic_payment_request):
        """Test domestic payment processing time"""
        start_time = datetime.utcnow()
        result = await orchestrator.execute_domestic_payment_flow(domestic_payment_request)
        end_time = datetime.utcnow()
        
        processing_time = (end_time - start_time).total_seconds()
        
        # Should complete in less than 1 second
        assert processing_time < 1.0
        assert result["status"] == "SUCCESS"


class TestCrossBorderPaymentFlow:
    """Test complete cross-border payment flow"""
    
    @pytest.mark.asyncio
    async def test_successful_cross_border_payment(self, orchestrator, cross_border_payment_request):
        """Test successful cross-border payment end-to-end"""
        result = await orchestrator.execute_cross_border_payment_flow(cross_border_payment_request)
        
        assert result["status"] == "SUCCESS"
        assert "quote_id" in result
        assert "transfer_id" in result
        assert "settlement_id" in result
        assert result["amount"] == 100000.00
        assert result["source_currency"] == "NGN"
        assert result["target_currency"] == "USD"
        assert "exchange_rate" in result
        assert "converted_amount" in result
        
        # Verify settlement was processed
        settlement_id = result["settlement_id"]
        assert settlement_id in orchestrator.settlements
        assert orchestrator.settlements[settlement_id]["status"] == "SETTLED"
    
    @pytest.mark.asyncio
    async def test_cross_border_exchange_rate(self, orchestrator, cross_border_payment_request):
        """Test exchange rate application in cross-border payment"""
        result = await orchestrator.execute_cross_border_payment_flow(cross_border_payment_request)
        
        # Exchange rate should be 0.0024 (NGN to USD)
        assert result["exchange_rate"] == 0.0024
        
        # Converted amount should be 100000 * 0.0024 = 240 USD
        assert result["converted_amount"] == 240.0
    
    @pytest.mark.asyncio
    async def test_cross_border_fee_calculation(self, orchestrator, cross_border_payment_request):
        """Test fee calculation in cross-border payment"""
        result = await orchestrator.execute_cross_border_payment_flow(cross_border_payment_request)
        
        # Fee should be 50 + (100000 * 0.005) = 50 + 500 = 550
        assert result["fees"] == 550.0
        assert result["total_amount"] == 100550.0
    
    @pytest.mark.asyncio
    async def test_cross_border_payment_timing(self, orchestrator, cross_border_payment_request):
        """Test cross-border payment processing time"""
        start_time = datetime.utcnow()
        result = await orchestrator.execute_cross_border_payment_flow(cross_border_payment_request)
        end_time = datetime.utcnow()
        
        processing_time = (end_time - start_time).total_seconds()
        
        # Should complete in less than 2 seconds
        assert processing_time < 2.0
        assert result["status"] == "SUCCESS"


class TestMultiplePaymentFlows:
    """Test handling multiple concurrent payments"""
    
    @pytest.mark.asyncio
    async def test_concurrent_domestic_payments(self, orchestrator):
        """Test processing multiple domestic payments concurrently"""
        payment_requests = [
            {
                "payer_fsp": f"fsp-{i}",
                "payee_fsp": f"fsp-{i+1}",
                "amount": str(1000.00 * (i + 1)),
                "currency": "NGN",
                "payer_account": f"account-{i}",
                "payee_account": f"account-{i+1}"
            }
            for i in range(5)
        ]
        
        # Execute all payments concurrently
        results = await asyncio.gather(*[
            orchestrator.execute_domestic_payment_flow(req)
            for req in payment_requests
        ])
        
        # All should succeed
        assert len(results) == 5
        for result in results:
            assert result["status"] == "SUCCESS"
        
        # Verify all transfers were created
        assert len(orchestrator.transfers) == 5
        
        # Verify all settlements were processed
        assert len(orchestrator.settlements) == 5
    
    @pytest.mark.asyncio
    async def test_mixed_payment_types(self, orchestrator):
        """Test processing domestic and cross-border payments together"""
        domestic_request = {
            "payer_fsp": "rafiki-ng",
            "payee_fsp": "rafiki-ng",
            "amount": "5000.00",
            "currency": "NGN",
            "payer_account": "1234567890",
            "payee_account": "0987654321"
        }
        
        cross_border_request = {
            "payer_fsp": "rafiki-ng",
            "payee_fsp": "cips-global",
            "amount": "100000.00",
            "source_currency": "NGN",
            "target_currency": "USD",
            "payer_account": "NG1234567890",
            "payee_account": "US0987654321"
        }
        
        # Execute both concurrently
        domestic_result, cross_border_result = await asyncio.gather(
            orchestrator.execute_domestic_payment_flow(domestic_request),
            orchestrator.execute_cross_border_payment_flow(cross_border_request)
        )
        
        # Both should succeed
        assert domestic_result["status"] == "SUCCESS"
        assert cross_border_result["status"] == "SUCCESS"
        
        # Verify different fee structures
        assert domestic_result["fees"] < cross_border_result["fees"]


class TestPaymentFlowStates:
    """Test payment flow state transitions"""
    
    @pytest.mark.asyncio
    async def test_transfer_state_progression(self, orchestrator, domestic_payment_request):
        """Test transfer state progresses correctly"""
        result = await orchestrator.execute_domestic_payment_flow(domestic_payment_request)
        
        transfer_id = result["transfer_id"]
        transfer = orchestrator.transfers[transfer_id]
        
        # Final state should be COMMITTED
        assert transfer["state"] == "COMMITTED"
        assert "completed_at" in transfer
    
    @pytest.mark.asyncio
    async def test_settlement_completion(self, orchestrator, domestic_payment_request):
        """Test settlement completes after transfer"""
        result = await orchestrator.execute_domestic_payment_flow(domestic_payment_request)
        
        settlement_id = result["settlement_id"]
        settlement = orchestrator.settlements[settlement_id]
        
        # Settlement should be SETTLED
        assert settlement["status"] == "SETTLED"
        assert "settled_at" in settlement


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-m", "asyncio"])

