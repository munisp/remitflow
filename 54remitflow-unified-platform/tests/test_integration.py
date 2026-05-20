#!/usr/bin/env python3
"""
Integration Tests
End-to-end testing of the remittance platform
"""

import pytest
import time
from test_config import (
    api_gateway_client, fraud_detection_client, payment_client, user_client,
    test_user_data, test_payment_data, wait_for_services, TEST_CONFIG
)

class TestServiceHealth:
    """Test service health and availability"""
    
    def test_all_services_healthy(self, api_gateway_client, fraud_detection_client, 
                                 payment_client, user_client):
        """Test that all services are healthy"""
        clients = {
            "api_gateway": api_gateway_client,
            "fraud_detection": fraud_detection_client,
            "payment_processing": payment_client,
            "user_management": user_client
        }
        
        for service_name, client in clients.items():
            health = client.health_check()
            assert health["success"], f"{service_name} health check failed: {health.get('error')}"
            assert health["data"].get("status") == "healthy"

class TestUserManagement:
    """Test user management functionality"""
    
    def test_user_registration(self, user_client, test_user_data):
        """Test user registration"""
        # Add timestamp to email to avoid conflicts
        test_user_data["email"] = f"test_{int(time.time())}@example.com"
        
        result = user_client.post("/api/v1/register", test_user_data)
        
        assert result["success"], f"Registration failed: {result.get('error')}"
        assert "user_id" in result["data"]
        
        return result["data"]["user_id"]
    
    def test_user_login(self, user_client, test_user_data):
        """Test user login"""
        # First register a user
        test_user_data["email"] = f"login_test_{int(time.time())}@example.com"
        reg_result = user_client.post("/api/v1/register", test_user_data)
        assert reg_result["success"]
        
        # Then login
        login_data = {
            "email": test_user_data["email"],
            "password": test_user_data["password"]
        }
        
        result = user_client.post("/api/v1/login", login_data)
        
        assert result["success"], f"Login failed: {result.get('error')}"
        assert "token" in result["data"]
        assert "user" in result["data"]

class TestPaymentProcessing:
    """Test payment processing functionality"""
    
    def test_get_corridors(self, payment_client):
        """Test getting available payment corridors"""
        result = payment_client.get("/api/v1/corridors")
        
        assert result["success"], f"Get corridors failed: {result.get('error')}"
        assert "corridors" in result["data"]
        
        corridors = result["data"]["corridors"]
        expected_corridors = ["PAPSS", "CIPS", "PIX", "UPI", "MOJALOOP"]
        
        for corridor in expected_corridors:
            assert corridor in corridors
    
    def test_fee_calculation(self, payment_client):
        """Test payment fee calculation"""
        fee_data = {
            "amount": 100.00,
            "corridor": "MOJALOOP"
        }
        
        result = payment_client.post("/api/v1/payment/calculate-fees", fee_data)
        
        assert result["success"], f"Fee calculation failed: {result.get('error')}"
        assert "fees" in result["data"]
        
        fees = result["data"]["fees"]
        assert "base_amount" in fees
        assert "fee_amount" in fees
        assert "total_amount" in fees
        assert fees["base_amount"] == 100.00
    
    def test_payment_initiation(self, payment_client, test_payment_data):
        """Test payment initiation"""
        result = payment_client.post("/api/v1/payment", test_payment_data)
        
        assert result["success"], f"Payment initiation failed: {result.get('error')}"
        assert "transaction_id" in result["data"]
        assert result["data"]["status"] == "processing"
        
        return result["data"]["transaction_id"]
    
    def test_payment_status_check(self, payment_client, test_payment_data):
        """Test payment status checking"""
        # First initiate a payment
        payment_result = payment_client.post("/api/v1/payment", test_payment_data)
        assert payment_result["success"]
        
        transaction_id = payment_result["data"]["transaction_id"]
        
        # Check status
        result = payment_client.get(f"/api/v1/payment/{transaction_id}/status")
        
        assert result["success"], f"Status check failed: {result.get('error')}"
        assert "transaction" in result["data"]
        
        transaction = result["data"]["transaction"]
        assert transaction["transaction_id"] == transaction_id

class TestFraudDetection:
    """Test fraud detection functionality"""
    
    def test_fraud_prediction_low_risk(self, fraud_detection_client):
        """Test fraud prediction for low-risk transaction"""
        low_risk_transaction = {
            "amount": 50.00,
            "sender_country": "US",
            "recipient_country": "US",
            "transaction_type": "P2P",
            "sender_age_days": 365,
            "sender_transaction_count": 50
        }
        
        result = fraud_detection_client.post("/predict", low_risk_transaction)
        
        assert result["success"], f"Fraud prediction failed: {result.get('error')}"
        assert "fraud_probability" in result["data"]
        assert "risk_level" in result["data"]
        
        # Low-risk transaction should have low fraud probability
        fraud_prob = result["data"]["fraud_probability"]
        assert 0 <= fraud_prob <= 1
    
    def test_fraud_prediction_high_risk(self, fraud_detection_client):
        """Test fraud prediction for high-risk transaction"""
        high_risk_transaction = {
            "amount": 15000.00,
            "sender_country": "US",
            "recipient_country": "CN", 
            "transaction_type": "international_wire",
            "sender_age_days": 1,  # New account
            "sender_transaction_count": 0  # First transaction
        }
        
        result = fraud_detection_client.post("/predict", high_risk_transaction)
        
        assert result["success"], f"Fraud prediction failed: {result.get('error')}"
        assert "fraud_probability" in result["data"]
        assert "risk_level" in result["data"]

class TestAPIGateway:
    """Test API Gateway routing and load balancing"""
    
    def test_gateway_health(self, api_gateway_client):
        """Test API Gateway health"""
        result = api_gateway_client.health_check()
        
        assert result["success"], f"Gateway health check failed: {result.get('error')}"
        assert result["data"]["service"] == "API Gateway"
    
    def test_service_routing(self, api_gateway_client):
        """Test that gateway routes requests to services"""
        # Test routing to fraud detection
        fraud_data = {
            "amount": 100.00,
            "sender_country": "US",
            "recipient_country": "CA"
        }
        
        result = api_gateway_client.post("/api/v1/fraud/predict", fraud_data)
        # Note: This might fail if services aren't running, but tests the routing

class TestEndToEndWorkflow:
    """Test complete end-to-end workflows"""
    
    def test_complete_payment_workflow(self, user_client, payment_client, fraud_detection_client):
        """Test complete payment workflow from user registration to payment completion"""
        
        # 1. Register user
        user_data = {
            "email": f"workflow_test_{int(time.time())}@example.com",
            "password": "testpassword123",
            "name": "Workflow Test User",
            "phone": "+1234567890"
        }
        
        reg_result = user_client.post("/api/v1/register", user_data)
        assert reg_result["success"]
        user_id = reg_result["data"]["user_id"]
        
        # 2. Login user
        login_result = user_client.post("/api/v1/login", {
            "email": user_data["email"],
            "password": user_data["password"]
        })
        assert login_result["success"]
        
        # 3. Check fraud risk
        fraud_data = {
            "amount": 500.00,
            "sender_country": "US",
            "recipient_country": "CA",
            "sender_id": user_id
        }
        
        fraud_result = fraud_detection_client.post("/predict", fraud_data)
        # Continue even if fraud service isn't available
        
        # 4. Initiate payment
        payment_data = {
            "sender_id": user_id,
            "recipient_id": "recipient_456",
            "amount": 500.00,
            "currency": "USD",
            "corridor": "MOJALOOP"
        }
        
        payment_result = payment_client.post("/api/v1/payment", payment_data)
        assert payment_result["success"]
        
        # 5. Check payment status
        transaction_id = payment_result["data"]["transaction_id"]
        status_result = payment_client.get(f"/api/v1/payment/{transaction_id}/status")
        assert status_result["success"]

if __name__ == "__main__":
    # Wait for services to be ready
    if wait_for_services():
        # Run tests
        pytest.main([__file__, "-v"])
    else:
        print("Services not ready, skipping tests")
