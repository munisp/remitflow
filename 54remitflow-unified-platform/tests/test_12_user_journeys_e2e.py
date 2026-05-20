"""
End-to-End Tests for 12 Critical User Journeys
Tests complete user flows from start to finish
"""

import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient
import asyncio
from datetime import datetime
from typing import Dict, Any

# Test data
TEST_USER = {
    "email": "test@example.com",
    "phone": "+2348012345678",
    "password": "SecurePassword123!",
    "first_name": "Amina",
    "last_name": "Hassan"
}

TEST_BENEFICIARY = {
    "name": "Chidi Okafor",
    "account_number": "0123456789",
    "bank_code": "058",  # GTBank
    "bank_name": "Guaranty Trust Bank"
}

@pytest.mark.asyncio
class TestJourney1RegistrationKYC:
    """Test Journey 1: New User Registration & KYC Verification"""
    
    async def test_complete_registration_journey(self, client: AsyncClient):
        """Test complete registration and KYC flow."""
        
        # Step 1: Register user
        response = await client.post("/api/auth/register", json=TEST_USER)
        assert response.status_code == 201
        user_data = response.json()
        assert "id" in user_data
        user_id = user_data["id"]
        
        # Step 2: Verify email
        response = await client.post(f"/api/auth/verify-email", json={
            "email": TEST_USER["email"],
            "code": "123456"  # Mock OTP
        })
        assert response.status_code == 200
        
        # Step 3: Verify phone
        response = await client.post(f"/api/auth/verify-phone", json={
            "phone": TEST_USER["phone"],
            "code": "123456"  # Mock OTP
        })
        assert response.status_code == 200
        
        # Step 4: Upload KYC documents
        response = await client.post(f"/api/kyc/upload-document", json={
            "user_id": user_id,
            "document_type": "national_id",
            "document_url": "https://example.com/id.jpg"
        })
        assert response.status_code == 200
        
        # Step 5: Biometric verification
        response = await client.post(f"/api/kyc/verify-biometric", json={
            "user_id": user_id,
            "selfie_url": "https://example.com/selfie.jpg"
        })
        assert response.status_code == 200
        
        # Step 6: Check KYC status
        response = await client.get(f"/api/kyc/status/{user_id}")
        assert response.status_code == 200
        kyc_status = response.json()
        assert kyc_status["status"] in ["pending", "approved"]

@pytest.mark.asyncio
class TestJourney2DomesticTransfer:
    """Test Journey 2: Send Money Domestically"""
    
    async def test_domestic_transfer_journey(self, client: AsyncClient, auth_token: str):
        """Test complete domestic transfer flow."""
        
        # Step 1: Add beneficiary
        response = await client.post(
            "/api/beneficiaries",
            json=TEST_BENEFICIARY,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 201
        beneficiary_id = response.json()["id"]
        
        # Step 2: Verify account via NIBSS
        response = await client.post(
            "/api/nibss/verify-account",
            json={
                "account_number": TEST_BENEFICIARY["account_number"],
                "bank_code": TEST_BENEFICIARY["bank_code"]
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 3: Initiate transfer
        response = await client.post(
            "/api/transfers/domestic",
            json={
                "beneficiary_id": beneficiary_id,
                "amount": 50000,
                "currency": "NGN",
                "narration": "Family support"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 201
        transaction_id = response.json()["transaction_id"]
        
        # Step 4: Check transaction status
        response = await client.get(
            f"/api/transactions/status/{transaction_id}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        status = response.json()
        assert status["status"] in ["pending", "processing", "completed"]

@pytest.mark.asyncio
class TestJourney3InternationalTransfer:
    """Test Journey 3: Send Money Internationally"""
    
    async def test_international_transfer_journey(self, client: AsyncClient, auth_token: str):
        """Test complete international transfer flow."""
        
        # Step 1: Get exchange rates
        response = await client.get(
            "/api/exchange-rates?from=NGN&to=USD",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        rate = response.json()["rate"]
        
        # Step 2: Select payment corridor
        response = await client.get(
            "/api/corridors?destination=USA",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        corridors = response.json()
        assert len(corridors) > 0
        
        # Step 3: Compliance check
        response = await client.post(
            "/api/compliance/check",
            json={
                "amount": 5000,
                "currency": "USD",
                "destination_country": "USA",
                "purpose": "education"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 4: Initiate transfer
        response = await client.post(
            "/api/transfers/international",
            json={
                "amount": 5000,
                "currency": "USD",
                "destination_country": "USA",
                "recipient_name": "Jane Doe",
                "recipient_account": "1234567890",
                "routing_number": "021000021",
                "purpose": "education",
                "corridor": "SWIFT"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 201

@pytest.mark.asyncio
class TestJourney4ReceiveMoney:
    """Test Journey 4: Receive Money from Abroad"""
    
    async def test_receive_money_journey(self, client: AsyncClient, auth_token: str):
        """Test complete receive money flow."""
        
        # Step 1: Check for incoming transfers
        response = await client.get(
            "/api/transfers/receive",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 2: Accept transfer
        response = await client.post(
            "/api/transfers/receive/accept",
            json={
                "transfer_id": "test-transfer-123",
                "currency": "NGN"  # Convert to NGN
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 3: Check wallet balance
        response = await client.get(
            "/api/wallet/balance",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200

@pytest.mark.asyncio
class TestJourney5BeneficiaryManagement:
    """Test Journey 5: Add & Manage Beneficiaries"""
    
    async def test_beneficiary_management_journey(self, client: AsyncClient, auth_token: str):
        """Test complete beneficiary management flow."""
        
        # Step 1: List beneficiaries
        response = await client.get(
            "/api/beneficiaries",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 2: Add beneficiary
        response = await client.post(
            "/api/beneficiaries",
            json=TEST_BENEFICIARY,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 201
        beneficiary_id = response.json()["id"]
        
        # Step 3: Update beneficiary
        response = await client.put(
            f"/api/beneficiaries/{beneficiary_id}",
            json={"nickname": "Brother Chidi"},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 4: Get beneficiary history
        response = await client.get(
            f"/api/beneficiaries/{beneficiary_id}/history",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200

@pytest.mark.asyncio
class TestJourney6WalletManagement:
    """Test Journey 6: Wallet Top-up & Management"""
    
    async def test_wallet_management_journey(self, client: AsyncClient, auth_token: str):
        """Test complete wallet management flow."""
        
        # Step 1: Get wallet balance
        response = await client.get(
            "/api/wallet/balance",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 2: Top up wallet
        response = await client.post(
            "/api/wallet/topup",
            json={
                "amount": 100000,
                "method": "card",
                "card_details": {
                    "number": "4111111111111111",
                    "expiry": "12/25",
                    "cvv": "123"
                }
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 3: Get transaction history
        response = await client.get(
            "/api/wallet/history",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 4: Download statement
        response = await client.get(
            "/api/wallet/statement?format=pdf",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200

@pytest.mark.asyncio
class TestJourney7CurrencyExchange:
    """Test Journey 7: Currency Exchange & Multi-Currency Wallet"""
    
    async def test_currency_exchange_journey(self, client: AsyncClient, auth_token: str):
        """Test complete currency exchange flow."""
        
        # Step 1: Get exchange rates
        response = await client.get(
            "/api/exchange/rates",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 2: Exchange currency
        response = await client.post(
            "/api/exchange/convert",
            json={
                "from_currency": "NGN",
                "to_currency": "USD",
                "amount": 500000
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 3: View multi-currency wallet
        response = await client.get(
            "/api/wallet/multi-currency",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200

@pytest.mark.asyncio
class TestJourney8BillPayment:
    """Test Journey 8: Bill Payment & Airtime Purchase"""
    
    async def test_bill_payment_journey(self, client: AsyncClient, auth_token: str):
        """Test complete bill payment flow."""
        
        # Step 1: Get bill providers
        response = await client.get(
            "/api/bills/providers",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 2: Pay bill
        response = await client.post(
            "/api/bills/pay",
            json={
                "provider": "EKEDC",
                "meter_number": "12345678901",
                "amount": 5000
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 3: Purchase airtime
        response = await client.post(
            "/api/airtime/purchase",
            json={
                "network": "MTN",
                "phone": "+2348012345678",
                "amount": 1000
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200

@pytest.mark.asyncio
class TestJourney9SavingsInvestment:
    """Test Journey 9: Savings & Investment"""
    
    async def test_savings_investment_journey(self, client: AsyncClient, auth_token: str):
        """Test complete savings and investment flow."""
        
        # Step 1: View savings products
        response = await client.get(
            "/api/savings/products",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 2: Create savings
        response = await client.post(
            "/api/savings/create",
            json={
                "product_type": "fixed_deposit",
                "amount": 500000,
                "duration_months": 6
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 201
        
        # Step 3: View investments
        response = await client.get(
            "/api/investments",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 4: View portfolio
        response = await client.get(
            "/api/portfolio",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200

@pytest.mark.asyncio
class TestJourney10DisputeResolution:
    """Test Journey 10: Dispute Resolution & Refunds"""
    
    async def test_dispute_resolution_journey(self, client: AsyncClient, auth_token: str):
        """Test complete dispute resolution flow."""
        
        # Step 1: Create dispute
        response = await client.post(
            "/api/disputes/create",
            json={
                "transaction_id": "test-txn-123",
                "dispute_type": "failed_transaction",
                "description": "Transaction failed but amount was debited"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 201
        dispute_id = response.json()["id"]
        
        # Step 2: Check dispute status
        response = await client.get(
            f"/api/disputes/{dispute_id}/status",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 3: Check refund status
        response = await client.get(
            f"/api/refunds?dispute_id={dispute_id}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200

@pytest.mark.asyncio
class TestJourney11ReferralProgram:
    """Test Journey 11: Referral Program & Rewards"""
    
    async def test_referral_program_journey(self, client: AsyncClient, auth_token: str):
        """Test complete referral program flow."""
        
        # Step 1: Get referral code
        response = await client.get(
            "/api/referrals/code",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        referral_code = response.json()["code"]
        
        # Step 2: Track referrals
        response = await client.get(
            "/api/referrals/track",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 3: View rewards
        response = await client.get(
            "/api/rewards",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200

@pytest.mark.asyncio
class TestJourney12CustomerSupport:
    """Test Journey 12: Customer Support & Help"""
    
    async def test_customer_support_journey(self, client: AsyncClient, auth_token: str):
        """Test complete customer support flow."""
        
        # Step 1: Search FAQ
        response = await client.get(
            "/api/faq?q=transfer",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 2: Start chat with bot
        response = await client.post(
            "/api/support/chat",
            json={
                "message": "I need help with my transfer"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        
        # Step 3: Create support ticket
        response = await client.post(
            "/api/support/tickets",
            json={
                "subject": "Failed transfer",
                "description": "My transfer failed but money was deducted",
                "priority": "high"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 201

# Fixtures
@pytest.fixture
async def client():
    """Create test client."""
    from fastapi import FastAPI
    app = FastAPI()
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

@pytest.fixture
async def auth_token(client: AsyncClient):
    """Get authentication token."""
    # Login and get token
    response = await client.post("/api/auth/login", json={
        "email": TEST_USER["email"],
        "password": TEST_USER["password"]
    })
    return response.json()["access_token"]
