#!/usr/bin/env python3
"""
Test Configuration
Comprehensive testing setup for the remittance platform
"""

import pytest
import requests
import json
import time
from typing import Dict, Any

# Test configuration
TEST_CONFIG = {
    "base_urls": {
        "api_gateway": "http://localhost:5000",
        "fraud_detection": "http://localhost:5001", 
        "payment_processing": "http://localhost:5002",
        "user_management": "http://localhost:5003"
    },
    "test_data": {
        "valid_user": {
            "email": "test@example.com",
            "password": "testpassword123",
            "name": "Test User",
            "phone": "+1234567890"
        },
        "valid_payment": {
            "sender_id": "test_user_123",
            "recipient_id": "recipient_456",
            "amount": 100.00,
            "currency": "USD",
            "corridor": "MOJALOOP"
        },
        "high_risk_transaction": {
            "sender_id": "test_user_123",
            "recipient_id": "recipient_456", 
            "amount": 15000.00,
            "currency": "USD",
            "corridor": "CIPS",
            "sender_country": "US",
            "recipient_country": "CN"
        }
    }
}

class TestClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session = requests.Session()
        self.auth_token = None
    
    def health_check(self) -> Dict[str, Any]:
        """Check service health"""
        try:
            response = self.session.get(f"{self.base_url}/health", timeout=10)
            return {
                "success": response.status_code == 200,
                "data": response.json() if response.content else {},
                "status_code": response.status_code
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "status_code": 0
            }
    
    def post(self, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Make POST request"""
        headers = {}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        
        try:
            response = self.session.post(
                f"{self.base_url}{endpoint}",
                json=data,
                headers=headers,
                timeout=30
            )
            return {
                "success": response.status_code < 400,
                "data": response.json() if response.content else {},
                "status_code": response.status_code
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "status_code": 0
            }
    
    def get(self, endpoint: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Make GET request"""
        headers = {}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        
        try:
            response = self.session.get(
                f"{self.base_url}{endpoint}",
                params=params,
                headers=headers,
                timeout=30
            )
            return {
                "success": response.status_code < 400,
                "data": response.json() if response.content else {},
                "status_code": response.status_code
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "status_code": 0
            }

@pytest.fixture
def api_gateway_client():
    """API Gateway test client"""
    return TestClient(TEST_CONFIG["base_urls"]["api_gateway"])

@pytest.fixture
def fraud_detection_client():
    """Fraud Detection test client"""
    return TestClient(TEST_CONFIG["base_urls"]["fraud_detection"])

@pytest.fixture
def payment_client():
    """Payment Processing test client"""
    return TestClient(TEST_CONFIG["base_urls"]["payment_processing"])

@pytest.fixture
def user_client():
    """User Management test client"""
    return TestClient(TEST_CONFIG["base_urls"]["user_management"])

@pytest.fixture
def test_user_data():
    """Test user data"""
    return TEST_CONFIG["test_data"]["valid_user"].copy()

@pytest.fixture
def test_payment_data():
    """Test payment data"""
    return TEST_CONFIG["test_data"]["valid_payment"].copy()

def wait_for_services(timeout: int = 60) -> bool:
    """Wait for all services to be ready"""
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        all_healthy = True
        
        for service_name, base_url in TEST_CONFIG["base_urls"].items():
            client = TestClient(base_url)
            health = client.health_check()
            
            if not health["success"]:
                all_healthy = False
                print(f"Waiting for {service_name}...")
                break
        
        if all_healthy:
            print("All services are ready!")
            return True
        
        time.sleep(2)
    
    print("Timeout waiting for services")
    return False
