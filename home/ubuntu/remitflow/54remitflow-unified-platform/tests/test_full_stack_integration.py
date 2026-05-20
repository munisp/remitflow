"""
Comprehensive Integration Test Suite
Tests full-stack integration between frontend, backend, and all services
"""

import pytest
import asyncio
import aiohttp
import json
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import time

# Test configuration
BASE_URL = "http://localhost:8000"
FRONTEND_URL = "http://localhost:3000"
TEST_USER_EMAIL = "test@remittance.com"
TEST_USER_PASSWORD = "TestPassword123!"

class IntegrationTestSuite:
    """Full-stack integration test suite"""
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.auth_token: Optional[str] = None
        self.test_user_id: Optional[str] = None
        self.test_beneficiary_id: Optional[str] = None
        self.test_transaction_id: Optional[str] = None
        
    async def setup(self):
        """Setup test environment"""
        self.session = aiohttp.ClientSession()
        
    async def teardown(self):
        """Cleanup test environment"""
        if self.session:
            await self.session.close()
    
    # ========== Authentication Tests ==========
    
    async def test_user_registration(self):
        """Test user registration flow"""
        print("\n[TEST] User Registration")
        
        payload = {
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD,
            "first_name": "Test",
            "last_name": "User",
            "phone": "+2348012345678",
            "country": "NG"
        }
        
        async with self.session.post(
            f"{BASE_URL}/api/auth/register",
            json=payload
        ) as response:
            assert response.status == 201, f"Registration failed: {await response.text()}"
            data = await response.json()
            assert "user_id" in data
            self.test_user_id = data["user_id"]
            print(f"✅ User registered: {self.test_user_id}")
            return data
    
    async def test_user_login(self):
        """Test user login flow"""
        print("\n[TEST] User Login")
        
        payload = {
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        }
        
        async with self.session.post(
            f"{BASE_URL}/api/auth/login",
            json=payload
        ) as response:
            assert response.status == 200, f"Login failed: {await response.text()}"
            data = await response.json()
            assert "access_token" in data
            self.auth_token = data["access_token"]
            print(f"✅ User logged in successfully")
            return data
    
    async def test_token_refresh(self):
        """Test token refresh"""
        print("\n[TEST] Token Refresh")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.post(
            f"{BASE_URL}/api/auth/refresh",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert "access_token" in data
            print(f"✅ Token refreshed successfully")
            return data
    
    # ========== KYC Tests ==========
    
    async def test_kyc_submission(self):
        """Test KYC document submission"""
        print("\n[TEST] KYC Submission")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        payload = {
            "document_type": "passport",
            "document_number": "A12345678",
            "document_front": "base64_encoded_image",
            "document_back": "base64_encoded_image",
            "selfie": "base64_encoded_image"
        }
        
        async with self.session.post(
            f"{BASE_URL}/api/kyc/submit",
            json=payload,
            headers=headers
        ) as response:
            assert response.status == 201
            data = await response.json()
            assert data["status"] == "pending"
            print(f"✅ KYC submitted successfully")
            return data
    
    async def test_kyc_status_check(self):
        """Test KYC status retrieval"""
        print("\n[TEST] KYC Status Check")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.get(
            f"{BASE_URL}/api/kyc/status",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert "status" in data
            print(f"✅ KYC status: {data['status']}")
            return data
    
    # ========== Beneficiary Tests ==========
    
    async def test_add_beneficiary(self):
        """Test adding a beneficiary"""
        print("\n[TEST] Add Beneficiary")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        payload = {
            "first_name": "John",
            "last_name": "Doe",
            "email": "john.doe@example.com",
            "phone": "+2348098765432",
            "bank_name": "Access Bank",
            "account_number": "0123456789",
            "country": "NG"
        }
        
        async with self.session.post(
            f"{BASE_URL}/api/beneficiaries",
            json=payload,
            headers=headers
        ) as response:
            assert response.status == 201
            data = await response.json()
            assert "beneficiary_id" in data
            self.test_beneficiary_id = data["beneficiary_id"]
            print(f"✅ Beneficiary added: {self.test_beneficiary_id}")
            return data
    
    async def test_list_beneficiaries(self):
        """Test listing beneficiaries"""
        print("\n[TEST] List Beneficiaries")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.get(
            f"{BASE_URL}/api/beneficiaries",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert isinstance(data, list)
            assert len(data) > 0
            print(f"✅ Found {len(data)} beneficiaries")
            return data
    
    async def test_update_beneficiary(self):
        """Test updating a beneficiary"""
        print("\n[TEST] Update Beneficiary")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        payload = {
            "phone": "+2348011111111"
        }
        
        async with self.session.patch(
            f"{BASE_URL}/api/beneficiaries/{self.test_beneficiary_id}",
            json=payload,
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert data["phone"] == "+2348011111111"
            print(f"✅ Beneficiary updated successfully")
            return data
    
    # ========== Exchange Rate Tests ==========
    
    async def test_get_exchange_rates(self):
        """Test getting exchange rates"""
        print("\n[TEST] Get Exchange Rates")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.get(
            f"{BASE_URL}/api/rates?from=USD&to=NGN",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert "rate" in data
            assert data["rate"] > 0
            print(f"✅ Exchange rate USD/NGN: {data['rate']}")
            return data
    
    # ========== Transaction Tests ==========
    
    async def test_create_transaction(self):
        """Test creating a transaction"""
        print("\n[TEST] Create Transaction")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        payload = {
            "beneficiary_id": self.test_beneficiary_id,
            "amount": 100.00,
            "currency": "USD",
            "destination_currency": "NGN",
            "speed": "standard",
            "purpose": "family_support"
        }
        
        async with self.session.post(
            f"{BASE_URL}/api/transactions",
            json=payload,
            headers=headers
        ) as response:
            assert response.status == 201
            data = await response.json()
            assert "transaction_id" in data
            self.test_transaction_id = data["transaction_id"]
            print(f"✅ Transaction created: {self.test_transaction_id}")
            return data
    
    async def test_get_transaction_details(self):
        """Test getting transaction details"""
        print("\n[TEST] Get Transaction Details")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.get(
            f"{BASE_URL}/api/transactions/{self.test_transaction_id}",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert data["transaction_id"] == self.test_transaction_id
            print(f"✅ Transaction status: {data['status']}")
            return data
    
    async def test_list_transactions(self):
        """Test listing transactions"""
        print("\n[TEST] List Transactions")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.get(
            f"{BASE_URL}/api/transactions",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert isinstance(data, list)
            print(f"✅ Found {len(data)} transactions")
            return data
    
    async def test_transaction_status_tracking(self):
        """Test transaction status tracking"""
        print("\n[TEST] Transaction Status Tracking")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        # Poll for status updates
        for i in range(5):
            async with self.session.get(
                f"{BASE_URL}/api/transactions/{self.test_transaction_id}/status",
                headers=headers
            ) as response:
                assert response.status == 200
                data = await response.json()
                print(f"  Status update {i+1}: {data['status']}")
                
                if data['status'] in ['completed', 'failed']:
                    break
                    
                await asyncio.sleep(2)
        
        print(f"✅ Transaction tracking complete")
        return data
    
    # ========== Payment Method Tests ==========
    
    async def test_add_payment_method(self):
        """Test adding a payment method"""
        print("\n[TEST] Add Payment Method")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        payload = {
            "type": "bank_account",
            "bank_name": "Chase Bank",
            "account_number": "1234567890",
            "routing_number": "021000021",
            "account_holder_name": "Test User"
        }
        
        async with self.session.post(
            f"{BASE_URL}/api/payment-methods",
            json=payload,
            headers=headers
        ) as response:
            assert response.status == 201
            data = await response.json()
            assert "payment_method_id" in data
            print(f"✅ Payment method added")
            return data
    
    # ========== Notification Tests ==========
    
    async def test_get_notifications(self):
        """Test getting notifications"""
        print("\n[TEST] Get Notifications")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.get(
            f"{BASE_URL}/api/notifications",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert isinstance(data, list)
            print(f"✅ Found {len(data)} notifications")
            return data
    
    async def test_mark_notification_read(self):
        """Test marking notification as read"""
        print("\n[TEST] Mark Notification Read")
        
        # Get first notification
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        async with self.session.get(
            f"{BASE_URL}/api/notifications",
            headers=headers
        ) as response:
            notifications = await response.json()
            
        if notifications:
            notification_id = notifications[0]["id"]
            async with self.session.patch(
                f"{BASE_URL}/api/notifications/{notification_id}/read",
                headers=headers
            ) as response:
                assert response.status == 200
                print(f"✅ Notification marked as read")
    
    # ========== Profile Tests ==========
    
    async def test_get_profile(self):
        """Test getting user profile"""
        print("\n[TEST] Get Profile")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.get(
            f"{BASE_URL}/api/profile",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert data["email"] == TEST_USER_EMAIL
            print(f"✅ Profile retrieved successfully")
            return data
    
    async def test_update_profile(self):
        """Test updating user profile"""
        print("\n[TEST] Update Profile")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        payload = {
            "phone": "+2348099999999"
        }
        
        async with self.session.patch(
            f"{BASE_URL}/api/profile",
            json=payload,
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert data["phone"] == "+2348099999999"
            print(f"✅ Profile updated successfully")
            return data
    
    # ========== Dashboard Tests ==========
    
    async def test_get_dashboard_stats(self):
        """Test getting dashboard statistics"""
        print("\n[TEST] Get Dashboard Stats")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        async with self.session.get(
            f"{BASE_URL}/api/dashboard/stats",
            headers=headers
        ) as response:
            assert response.status == 200
            data = await response.json()
            assert "total_sent" in data
            assert "transaction_count" in data
            print(f"✅ Dashboard stats retrieved")
            return data
    
    # ========== End-to-End Flow Tests ==========
    
    async def test_complete_remittance_flow(self):
        """Test complete remittance flow from start to finish"""
        print("\n[TEST] Complete Remittance Flow")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        # Step 1: Get exchange rate
        async with self.session.get(
            f"{BASE_URL}/api/rates?from=USD&to=NGN&amount=100",
            headers=headers
        ) as response:
            rate_data = await response.json()
            print(f"  1. Exchange rate: {rate_data['rate']}")
        
        # Step 2: Calculate fees
        async with self.session.post(
            f"{BASE_URL}/api/fees/calculate",
            json={"amount": 100, "currency": "USD", "speed": "express"},
            headers=headers
        ) as response:
            fee_data = await response.json()
            print(f"  2. Fees calculated: ${fee_data['total_fee']}")
        
        # Step 3: Create transaction
        async with self.session.post(
            f"{BASE_URL}/api/transactions",
            json={
                "beneficiary_id": self.test_beneficiary_id,
                "amount": 100.00,
                "currency": "USD",
                "destination_currency": "NGN",
                "speed": "express"
            },
            headers=headers
        ) as response:
            transaction_data = await response.json()
            transaction_id = transaction_data["transaction_id"]
            print(f"  3. Transaction created: {transaction_id}")
        
        # Step 4: Confirm transaction
        async with self.session.post(
            f"{BASE_URL}/api/transactions/{transaction_id}/confirm",
            headers=headers
        ) as response:
            confirm_data = await response.json()
            print(f"  4. Transaction confirmed")
        
        # Step 5: Track status
        for i in range(3):
            async with self.session.get(
                f"{BASE_URL}/api/transactions/{transaction_id}/status",
                headers=headers
            ) as response:
                status_data = await response.json()
                print(f"  5.{i+1}. Status: {status_data['status']}")
                await asyncio.sleep(1)
        
        print(f"✅ Complete remittance flow successful")
    
    # ========== Performance Tests ==========
    
    async def test_concurrent_requests(self):
        """Test handling concurrent requests"""
        print("\n[TEST] Concurrent Requests")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        
        # Make 10 concurrent requests
        tasks = []
        for i in range(10):
            task = self.session.get(
                f"{BASE_URL}/api/dashboard/stats",
                headers=headers
            )
            tasks.append(task)
        
        start_time = time.time()
        responses = await asyncio.gather(*tasks)
        end_time = time.time()
        
        # Check all responses
        for response in responses:
            assert response.status == 200
        
        elapsed = end_time - start_time
        print(f"✅ 10 concurrent requests completed in {elapsed:.2f}s")
    
    async def test_api_response_time(self):
        """Test API response times"""
        print("\n[TEST] API Response Times")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"}
        endpoints = [
            "/api/profile",
            "/api/beneficiaries",
            "/api/transactions",
            "/api/dashboard/stats",
            "/api/notifications"
        ]
        
        for endpoint in endpoints:
            start_time = time.time()
            async with self.session.get(
                f"{BASE_URL}{endpoint}",
                headers=headers
            ) as response:
                end_time = time.time()
                elapsed = (end_time - start_time) * 1000
                assert response.status == 200
                assert elapsed < 500, f"{endpoint} took {elapsed:.0f}ms (should be <500ms)"
                print(f"  {endpoint}: {elapsed:.0f}ms ✅")
        
        print(f"✅ All API response times acceptable")


# ========== Test Runner ==========

async def run_integration_tests():
    """Run all integration tests"""
    print("=" * 60)
    print("NIGERIAN REMITTANCE PLATFORM - INTEGRATION TEST SUITE")
    print("=" * 60)
    
    suite = IntegrationTestSuite()
    await suite.setup()
    
    try:
        # Authentication flow
        await suite.test_user_registration()
        await suite.test_user_login()
        await suite.test_token_refresh()
        
        # KYC flow
        await suite.test_kyc_submission()
        await suite.test_kyc_status_check()
        
        # Beneficiary management
        await suite.test_add_beneficiary()
        await suite.test_list_beneficiaries()
        await suite.test_update_beneficiary()
        
        # Exchange rates
        await suite.test_get_exchange_rates()
        
        # Transaction flow
        await suite.test_create_transaction()
        await suite.test_get_transaction_details()
        await suite.test_list_transactions()
        await suite.test_transaction_status_tracking()
        
        # Payment methods
        await suite.test_add_payment_method()
        
        # Notifications
        await suite.test_get_notifications()
        await suite.test_mark_notification_read()
        
        # Profile management
        await suite.test_get_profile()
        await suite.test_update_profile()
        
        # Dashboard
        await suite.test_get_dashboard_stats()
        
        # End-to-end flows
        await suite.test_complete_remittance_flow()
        
        # Performance tests
        await suite.test_concurrent_requests()
        await suite.test_api_response_time()
        
        print("\n" + "=" * 60)
        print("✅ ALL INTEGRATION TESTS PASSED")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ TEST FAILED: {str(e)}")
        raise
    finally:
        await suite.teardown()


if __name__ == "__main__":
    asyncio.run(run_integration_tests())

