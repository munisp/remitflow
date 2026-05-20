"""
Comprehensive Load Tests for Remittance Platform
Tests critical paths: cash-in/out, transfers, KYC, balance inquiries
"""

import os
import json
import random
import string
from datetime import datetime
from locust import HttpUser, task, between, events
from locust.runners import MasterRunner


# Test data generators
def generate_phone_number():
    return f"+234{random.randint(7000000000, 9099999999)}"


def generate_account_id():
    return f"ACC-{random.randint(100000, 999999)}"


def generate_transaction_id():
    return f"TXN-{''.join(random.choices(string.ascii_uppercase + string.digits, k=12))}"


def generate_idempotency_key():
    return f"idem-{''.join(random.choices(string.ascii_lowercase + string.digits, k=16))}"


class AgentCashOperationsUser(HttpUser):
    """
    Simulates agent performing cash-in and cash-out operations.
    This is the most critical path for remittance.
    """
    
    wait_time = between(1, 3)
    weight = 3  # Higher weight = more users
    
    def on_start(self):
        """Login as agent"""
        self.agent_id = f"AGENT-{random.randint(1000, 9999)}"
        self.customer_phone = generate_phone_number()
        
        # Authenticate
        response = self.client.post("/api/v1/auth/login", json={
            "username": f"agent_{self.agent_id}",
            "password": "test_password",
            "grant_type": "password"
        })
        
        if response.status_code == 200:
            self.token = response.json().get("access_token")
            self.client.headers["Authorization"] = f"Bearer {self.token}"
    
    @task(5)
    def cash_in(self):
        """Agent deposits cash for customer"""
        amount = random.choice([1000, 2000, 5000, 10000, 20000, 50000])
        
        response = self.client.post(
            "/api/v1/transactions/cash-in",
            json={
                "customer_phone": self.customer_phone,
                "amount": amount,
                "currency": "NGN",
                "agent_id": self.agent_id,
                "idempotency_key": generate_idempotency_key()
            },
            name="/api/v1/transactions/cash-in"
        )
        
        if response.status_code != 200:
            response.failure(f"Cash-in failed: {response.text}")
    
    @task(4)
    def cash_out(self):
        """Agent withdraws cash for customer"""
        amount = random.choice([500, 1000, 2000, 5000, 10000])
        
        response = self.client.post(
            "/api/v1/transactions/cash-out",
            json={
                "customer_phone": self.customer_phone,
                "amount": amount,
                "currency": "NGN",
                "agent_id": self.agent_id,
                "pin": "1234",
                "idempotency_key": generate_idempotency_key()
            },
            name="/api/v1/transactions/cash-out"
        )
        
        if response.status_code != 200:
            response.failure(f"Cash-out failed: {response.text}")
    
    @task(3)
    def check_balance(self):
        """Check customer balance"""
        response = self.client.get(
            f"/api/v1/accounts/balance?phone={self.customer_phone}",
            name="/api/v1/accounts/balance"
        )
        
        if response.status_code != 200:
            response.failure(f"Balance check failed: {response.text}")
    
    @task(2)
    def transaction_history(self):
        """Get recent transactions"""
        response = self.client.get(
            f"/api/v1/transactions/history?phone={self.customer_phone}&limit=10",
            name="/api/v1/transactions/history"
        )
        
        if response.status_code != 200:
            response.failure(f"History fetch failed: {response.text}")
    
    @task(1)
    def check_float_balance(self):
        """Agent checks their float balance"""
        response = self.client.get(
            f"/api/v1/agents/{self.agent_id}/float",
            name="/api/v1/agents/{agent_id}/float"
        )
        
        if response.status_code != 200:
            response.failure(f"Float check failed: {response.text}")


class P2PTransferUser(HttpUser):
    """
    Simulates customers performing P2P transfers.
    """
    
    wait_time = between(2, 5)
    weight = 2
    
    def on_start(self):
        """Login as customer"""
        self.phone = generate_phone_number()
        self.account_id = generate_account_id()
        
        response = self.client.post("/api/v1/auth/login", json={
            "phone": self.phone,
            "pin": "1234",
            "grant_type": "pin"
        })
        
        if response.status_code == 200:
            self.token = response.json().get("access_token")
            self.client.headers["Authorization"] = f"Bearer {self.token}"
    
    @task(4)
    def transfer_to_phone(self):
        """Transfer to another phone number"""
        amount = random.choice([100, 500, 1000, 2000, 5000])
        recipient = generate_phone_number()
        
        response = self.client.post(
            "/api/v1/transfers/p2p",
            json={
                "sender_phone": self.phone,
                "recipient_phone": recipient,
                "amount": amount,
                "currency": "NGN",
                "narration": "Test transfer",
                "idempotency_key": generate_idempotency_key()
            },
            name="/api/v1/transfers/p2p"
        )
        
        if response.status_code != 200:
            response.failure(f"Transfer failed: {response.text}")
    
    @task(3)
    def transfer_to_bank(self):
        """Transfer to bank account"""
        amount = random.choice([1000, 5000, 10000, 50000])
        
        response = self.client.post(
            "/api/v1/transfers/bank",
            json={
                "sender_phone": self.phone,
                "bank_code": random.choice(["044", "058", "011", "033", "057"]),
                "account_number": f"{random.randint(1000000000, 9999999999)}",
                "amount": amount,
                "currency": "NGN",
                "narration": "Bank transfer",
                "idempotency_key": generate_idempotency_key()
            },
            name="/api/v1/transfers/bank"
        )
        
        if response.status_code != 200:
            response.failure(f"Bank transfer failed: {response.text}")
    
    @task(2)
    def check_transfer_status(self):
        """Check status of a transfer"""
        txn_id = generate_transaction_id()
        
        response = self.client.get(
            f"/api/v1/transfers/{txn_id}/status",
            name="/api/v1/transfers/{txn_id}/status"
        )
        
        # 404 is expected for random IDs
        if response.status_code not in [200, 404]:
            response.failure(f"Status check failed: {response.text}")
    
    @task(1)
    def get_bank_list(self):
        """Get list of supported banks"""
        response = self.client.get(
            "/api/v1/banks",
            name="/api/v1/banks"
        )
        
        if response.status_code != 200:
            response.failure(f"Bank list failed: {response.text}")


class KYCOnboardingUser(HttpUser):
    """
    Simulates KYC verification and agent onboarding.
    """
    
    wait_time = between(5, 10)
    weight = 1
    
    @task(3)
    def submit_kyc(self):
        """Submit KYC documents"""
        response = self.client.post(
            "/api/v1/kyc/submit",
            json={
                "phone": generate_phone_number(),
                "bvn": f"{random.randint(10000000000, 99999999999)}",
                "nin": f"{random.randint(10000000000, 99999999999)}",
                "first_name": "Test",
                "last_name": "User",
                "date_of_birth": "1990-01-01",
                "address": "123 Test Street, Lagos"
            },
            name="/api/v1/kyc/submit"
        )
        
        if response.status_code != 200:
            response.failure(f"KYC submit failed: {response.text}")
    
    @task(2)
    def check_kyc_status(self):
        """Check KYC verification status"""
        phone = generate_phone_number()
        
        response = self.client.get(
            f"/api/v1/kyc/status?phone={phone}",
            name="/api/v1/kyc/status"
        )
        
        if response.status_code not in [200, 404]:
            response.failure(f"KYC status check failed: {response.text}")
    
    @task(1)
    def agent_registration(self):
        """Register new agent"""
        response = self.client.post(
            "/api/v1/agents/register",
            json={
                "phone": generate_phone_number(),
                "business_name": f"Test Agent {random.randint(1000, 9999)}",
                "business_type": random.choice(["individual", "business"]),
                "tier": random.choice(["tier1", "tier2", "tier3"]),
                "parent_agent_id": f"AGENT-{random.randint(100, 999)}",
                "location": {
                    "state": "Lagos",
                    "lga": "Ikeja",
                    "address": "123 Test Street"
                }
            },
            name="/api/v1/agents/register"
        )
        
        if response.status_code != 200:
            response.failure(f"Agent registration failed: {response.text}")


class HighVolumeBalanceUser(HttpUser):
    """
    Simulates high-volume balance inquiries (common on payday).
    """
    
    wait_time = between(0.5, 1)
    weight = 2
    
    @task
    def rapid_balance_check(self):
        """Rapid balance checks"""
        phone = generate_phone_number()
        
        response = self.client.get(
            f"/api/v1/accounts/balance?phone={phone}",
            name="/api/v1/accounts/balance [high-volume]"
        )
        
        if response.status_code not in [200, 404]:
            response.failure(f"Balance check failed: {response.text}")


class USSDSimulationUser(HttpUser):
    """
    Simulates USSD session interactions.
    """
    
    wait_time = between(2, 4)
    weight = 1
    
    def on_start(self):
        self.session_id = f"USSD-{random.randint(100000, 999999)}"
        self.phone = generate_phone_number()
    
    @task(3)
    def ussd_balance(self):
        """USSD balance check flow"""
        # Initial request
        response = self.client.post(
            "/api/v1/ussd",
            json={
                "sessionId": self.session_id,
                "phoneNumber": self.phone,
                "serviceCode": "*347#",
                "text": ""
            },
            name="/api/v1/ussd [menu]"
        )
        
        if response.status_code == 200:
            # Select balance option
            self.client.post(
                "/api/v1/ussd",
                json={
                    "sessionId": self.session_id,
                    "phoneNumber": self.phone,
                    "serviceCode": "*347#",
                    "text": "1"
                },
                name="/api/v1/ussd [balance]"
            )
    
    @task(2)
    def ussd_transfer(self):
        """USSD transfer flow"""
        response = self.client.post(
            "/api/v1/ussd",
            json={
                "sessionId": f"USSD-{random.randint(100000, 999999)}",
                "phoneNumber": self.phone,
                "serviceCode": "*347#",
                "text": "2*08012345678*1000*1234"
            },
            name="/api/v1/ussd [transfer]"
        )


# Custom event handlers for metrics
@events.request.add_listener
def on_request(request_type, name, response_time, response_length, response, context, exception, **kwargs):
    """Log request metrics"""
    if exception:
        print(f"Request failed: {name} - {exception}")


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Setup before test starts"""
    print("Load test starting...")
    print(f"Target host: {environment.host}")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Cleanup after test stops"""
    print("Load test completed")
    
    # Print summary statistics
    if environment.stats.total.num_requests > 0:
        print(f"\nTotal requests: {environment.stats.total.num_requests}")
        print(f"Total failures: {environment.stats.total.num_failures}")
        print(f"Average response time: {environment.stats.total.avg_response_time:.2f}ms")
        print(f"p95 response time: {environment.stats.total.get_response_time_percentile(0.95):.2f}ms")
        print(f"p99 response time: {environment.stats.total.get_response_time_percentile(0.99):.2f}ms")


# Locust configuration
class WebsiteUser(HttpUser):
    """Combined user for general load testing"""
    tasks = {
        AgentCashOperationsUser: 3,
        P2PTransferUser: 2,
        KYCOnboardingUser: 1,
        HighVolumeBalanceUser: 2,
        USSDSimulationUser: 1
    }
    wait_time = between(1, 5)
