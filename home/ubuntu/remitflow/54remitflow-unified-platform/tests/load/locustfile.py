"""
Load testing configuration using Locust
Run with: locust -f locustfile.py --host=http://localhost:8000
"""
from locust import HttpUser, task, between, events
import random
import json

class RemittancePlatformUser(HttpUser):
    """Simulate user behavior on remittance platform."""
    
    wait_time = between(1, 5)
    
    def on_start(self):
        """Login when user starts."""
        self.login()
    
    def login(self):
        """Authenticate user."""
        response = self.client.post("/api/v1/auth/login", json={
            "email": f"test{random.randint(1, 1000)}@example.com",
            "password": "Test123!@#"
        })
        if response.status_code == 200:
            self.token = response.json()["access_token"]
    
    @task(5)
    def get_quote(self):
        """Get transfer quote (most common action)."""
        self.client.post(
            "/api/v1/payments/quote",
            json={
                "amount": random.uniform(100, 10000),
                "from_currency": "USD",
                "to_currency": random.choice(["NGN", "GHS", "KES", "ZAR"])
            },
            headers={"Authorization": f"Bearer {self.token}"}
        )
    
    @task(3)
    def view_beneficiaries(self):
        """View beneficiary list."""
        self.client.get(
            "/api/v1/beneficiaries",
            headers={"Authorization": f"Bearer {self.token}"}
        )
    
    @task(2)
    def create_transfer(self):
        """Create money transfer."""
        self.client.post(
            "/api/v1/payments/transfer",
            json={
                "quote_id": f"quote_{random.randint(1000, 9999)}",
                "sender": {"name": "Test User"},
                "recipient": {"name": "Test Recipient"},
                "purpose": "family_support"
            },
            headers={"Authorization": f"Bearer {self.token}"}
        )
    
    @task(2)
    def check_wallet_balance(self):
        """Check wallet balance."""
        self.client.get(
            "/api/v1/wallets/balance",
            headers={"Authorization": f"Bearer {self.token}"}
        )
    
    @task(1)
    def view_transaction_history(self):
        """View transaction history."""
        self.client.get(
            "/api/v1/transactions?limit=20",
            headers={"Authorization": f"Bearer {self.token}"}
        )
    
    @task(1)
    def add_beneficiary(self):
        """Add new beneficiary."""
        self.client.post(
            "/api/v1/beneficiaries",
            json={
                "name": f"Beneficiary {random.randint(1, 1000)}",
                "account": f"{random.randint(1000000000, 9999999999)}",
                "bank_code": random.choice(["058", "044", "033"])
            },
            headers={"Authorization": f"Bearer {self.token}"}
        )

@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Initialize test environment."""
    print("Load test starting...")

@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Cleanup after test."""
    print("Load test completed!")
