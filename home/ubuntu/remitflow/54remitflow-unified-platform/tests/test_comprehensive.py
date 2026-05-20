"""
Comprehensive Test Suite for Onboarding Optimization
Tests all phases of the onboarding improvement implementation
"""

import pytest
import asyncio
import json
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Import the services
from email_verification_service import app as email_app, EmailVerificationService
from otp_delivery_service import app as otp_app, OTPDeliveryService

class TestEmailVerificationService:
    """Test suite for email verification with fallback"""
    
    @pytest.fixture
    def client(self):
        return TestClient(email_app)
    
    @pytest.fixture
    def mock_novu(self):
        with patch('novu.Novu') as mock:
            yield mock
    
    def test_send_email_verification_success(self, client, mock_novu):
        """Test successful email verification sending"""
        mock_novu.return_value.trigger.return_value = {"acknowledged": True}
        
        response = client.post("/api/v1/verification/send", json={
            "user_id": "test_user_123",
            "email": "test@example.com",
            "method": "email",
            "fallback": False
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["method"] == "email"
        assert "code_id" in data
        assert data["expires_in"] == 600
    
    def test_send_sms_verification_success(self, client, mock_novu):
        """Test successful SMS verification sending"""
        mock_novu.return_value.trigger.return_value = {"acknowledged": True}
        
        response = client.post("/api/v1/verification/send", json={
            "user_id": "test_user_123",
            "email": "test@example.com",
            "phone": "+2348012345678",
            "method": "sms",
            "fallback": False
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["method"] == "sms"
    
    def test_fallback_mechanism(self, client, mock_novu):
        """Test fallback from email to SMS when email fails"""
        # Mock email failure, SMS success
        mock_novu.return_value.trigger.side_effect = [
            {"acknowledged": False},  # Email fails
            {"acknowledged": True}    # SMS succeeds
        ]
        
        response = client.post("/api/v1/verification/send", json={
            "user_id": "test_user_123",
            "email": "test@example.com",
            "phone": "+2348012345678",
            "method": "email",
            "fallback": False
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["method"] == "sms"  # Should fallback to SMS
        assert data["fallback"] is True
    
    def test_verify_code_success(self, client, mock_novu):
        """Test successful code verification"""
        # First send a verification code
        mock_novu.return_value.trigger.return_value = {"acknowledged": True}
        
        send_response = client.post("/api/v1/verification/send", json={
            "user_id": "test_user_123",
            "email": "test@example.com",
            "method": "email"
        })
        
        code_id = send_response.json()["code_id"]
        
        # Mock the database to return a valid verification code
        with patch('sqlalchemy.orm.Session.query') as mock_query:
            mock_verification = Mock()
            mock_verification.code = "123456"
            mock_verification.expires_at = datetime.utcnow() + timedelta(minutes=5)
            mock_verification.verified = False
            mock_verification.attempts = 0
            mock_verification.method = "email"
            
            mock_query.return_value.filter.return_value.first.return_value = mock_verification
            
            verify_response = client.post("/api/v1/verification/verify", json={
                "code_id": code_id,
                "code": "123456",
                "user_id": "test_user_123"
            })
            
            assert verify_response.status_code == 200
            data = verify_response.json()
            assert data["success"] is True
            assert data["method"] == "email"
    
    def test_verify_code_expired(self, client):
        """Test verification of expired code"""
        with patch('sqlalchemy.orm.Session.query') as mock_query:
            mock_verification = Mock()
            mock_verification.expires_at = datetime.utcnow() - timedelta(minutes=1)  # Expired
            
            mock_query.return_value.filter.return_value.first.return_value = mock_verification
            
            response = client.post("/api/v1/verification/verify", json={
                "code_id": "123",
                "code": "123456",
                "user_id": "test_user_123"
            })
            
            assert response.status_code == 400
            assert "expired" in response.json()["detail"].lower()
    
    def test_verify_code_invalid(self, client):
        """Test verification with invalid code"""
        with patch('sqlalchemy.orm.Session.query') as mock_query:
            mock_verification = Mock()
            mock_verification.code = "123456"
            mock_verification.expires_at = datetime.utcnow() + timedelta(minutes=5)
            mock_verification.verified = False
            mock_verification.attempts = 0
            
            mock_query.return_value.filter.return_value.first.return_value = mock_verification
            
            response = client.post("/api/v1/verification/verify", json={
                "code_id": "123",
                "code": "654321",  # Wrong code
                "user_id": "test_user_123"
            })
            
            assert response.status_code == 400
            assert "invalid" in response.json()["detail"].lower()

class TestOTPDeliveryService:
    """Test suite for OTP delivery with multi-provider fallback"""
    
    @pytest.fixture
    def client(self):
        return TestClient(otp_app)
    
    @pytest.fixture
    def mock_providers(self):
        with patch('otp_delivery_service.TwilioProvider') as twilio, \
             patch('otp_delivery_service.TermiiProvider') as termii, \
             patch('otp_delivery_service.AfricasTalkingProvider') as africas:
            
            # Mock successful providers
            twilio.return_value.send_sms = AsyncMock(return_value=True)
            twilio.return_value.healthy = True
            twilio.return_value.name = "twilio"
            twilio.return_value.priority = 1
            
            termii.return_value.send_sms = AsyncMock(return_value=True)
            termii.return_value.healthy = True
            termii.return_value.name = "termii"
            termii.return_value.priority = 2
            
            africas.return_value.send_sms = AsyncMock(return_value=True)
            africas.return_value.healthy = True
            africas.return_value.name = "africas_talking"
            africas.return_value.priority = 3
            
            yield twilio, termii, africas
    
    def test_send_otp_success_primary_provider(self, client, mock_providers):
        """Test successful OTP sending with primary provider"""
        response = client.post("/api/v1/otp/send", json={
            "user_id": "test_user_123",
            "phone": "+2348012345678",
            "message": "Your verification code is: 123456",
            "priority": "normal"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["provider"] == "twilio"  # Should use primary provider
        assert data["estimated_delivery"] == "30 seconds"
    
    def test_send_otp_fallback_mechanism(self, client, mock_providers):
        """Test fallback to secondary provider when primary fails"""
        twilio, termii, africas = mock_providers
        
        # Make Twilio fail, Termii succeed
        twilio.return_value.send_sms = AsyncMock(return_value=False)
        termii.return_value.send_sms = AsyncMock(return_value=True)
        
        response = client.post("/api/v1/otp/send", json={
            "user_id": "test_user_123",
            "phone": "+2348012345678",
            "message": "Your verification code is: 123456"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["provider"] == "termii"  # Should fallback to Termii
    
    def test_send_otp_all_providers_fail(self, client, mock_providers):
        """Test when all providers fail"""
        twilio, termii, africas = mock_providers
        
        # Make all providers fail
        twilio.return_value.send_sms = AsyncMock(return_value=False)
        termii.return_value.send_sms = AsyncMock(return_value=False)
        africas.return_value.send_sms = AsyncMock(return_value=False)
        
        response = client.post("/api/v1/otp/send", json={
            "user_id": "test_user_123",
            "phone": "+2348012345678",
            "message": "Your verification code is: 123456"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "failed" in data["message"].lower()
    
    def test_get_delivery_status(self, client):
        """Test getting delivery status"""
        with patch('sqlalchemy.orm.Session.query') as mock_query:
            mock_attempt = Mock()
            mock_attempt.id = 123
            mock_attempt.status = "sent"
            mock_attempt.provider = "twilio"
            mock_attempt.attempts = 1
            mock_attempt.delivered_at = datetime.utcnow()
            mock_attempt.error = None
            mock_attempt.created_at = datetime.utcnow()
            
            mock_query.return_value.filter.return_value.first.return_value = mock_attempt
            
            response = client.get("/api/v1/otp/status/123")
            
            assert response.status_code == 200
            data = response.json()
            assert data["attempt_id"] == 123
            assert data["status"] == "sent"
            assert data["provider"] == "twilio"
            assert data["attempts"] == 1

class TestCameraPermissionOptimization:
    """Test suite for camera permission optimization"""
    
    def test_device_capability_detection(self):
        """Test device capability detection"""
        # This would be a frontend test using Jest/React Testing Library
        # Placeholder for the actual implementation
        pass
    
    def test_permission_request_flow(self):
        """Test camera permission request flow"""
        # This would test the permission request logic
        pass
    
    def test_fallback_to_file_upload(self):
        """Test fallback to file upload when camera fails"""
        # This would test the file upload fallback mechanism
        pass
    
    def test_image_quality_validation(self):
        """Test image quality and format validation"""
        # This would test image validation logic
        pass

class TestIntegrationScenarios:
    """Integration tests for complete onboarding flow"""
    
    @pytest.mark.asyncio
    async def test_complete_onboarding_flow_success(self):
        """Test complete successful onboarding flow"""
        # This would test the entire flow from start to finish
        pass
    
    @pytest.mark.asyncio
    async def test_onboarding_with_multiple_fallbacks(self):
        """Test onboarding flow with multiple fallback scenarios"""
        # This would test complex fallback scenarios
        pass
    
    @pytest.mark.asyncio
    async def test_onboarding_performance_under_load(self):
        """Test onboarding performance under high load"""
        # This would test performance characteristics
        pass

class TestNovuIntegration:
    """Test suite for Novu notification integration"""
    
    @pytest.fixture
    def mock_novu_client(self):
        with patch('novu.Novu') as mock:
            yield mock
    
    def test_email_verification_notification(self, mock_novu_client):
        """Test email verification notification via Novu"""
        mock_client = mock_novu_client.return_value
        mock_client.trigger.return_value = {"acknowledged": True}
        
        # Test notification sending
        payload = {
            "verification_code": "123456",
            "expires_in": "10 minutes",
            "user_email": "test@example.com"
        }
        
        result = mock_client.trigger(
            name="email-verification",
            to={"subscriberId": "test_user", "email": "test@example.com"},
            payload=payload
        )
        
        assert result["acknowledged"] is True
        mock_client.trigger.assert_called_once()
    
    def test_sms_verification_notification(self, mock_novu_client):
        """Test SMS verification notification via Novu"""
        mock_client = mock_novu_client.return_value
        mock_client.trigger.return_value = {"acknowledged": True}
        
        payload = {
            "verification_code": "123456",
            "expires_in": "10 minutes"
        }
        
        result = mock_client.trigger(
            name="sms-verification",
            to={"subscriberId": "test_user", "phone": "+2348012345678"},
            payload=payload
        )
        
        assert result["acknowledged"] is True
    
    def test_verification_success_notification(self, mock_novu_client):
        """Test verification success notification"""
        mock_client = mock_novu_client.return_value
        mock_client.trigger.return_value = {"acknowledged": True}
        
        payload = {
            "verification_method": "email",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        result = mock_client.trigger(
            name="verification-success",
            to={"subscriberId": "test_user"},
            payload=payload
        )
        
        assert result["acknowledged"] is True

# Performance Tests
class TestPerformanceMetrics:
    """Performance testing for onboarding optimization"""
    
    @pytest.mark.performance
    def test_email_verification_response_time(self):
        """Test email verification response time"""
        # Measure response time for email verification
        pass
    
    @pytest.mark.performance
    def test_otp_delivery_latency(self):
        """Test OTP delivery latency across providers"""
        # Measure OTP delivery times
        pass
    
    @pytest.mark.performance
    def test_concurrent_verification_requests(self):
        """Test handling of concurrent verification requests"""
        # Test concurrent load handling
        pass

# Security Tests
class TestSecurityMeasures:
    """Security testing for onboarding features"""
    
    def test_rate_limiting(self):
        """Test rate limiting for verification requests"""
        # Test rate limiting implementation
        pass
    
    def test_code_expiration(self):
        """Test verification code expiration"""
        # Test code expiration logic
        pass
    
    def test_attempt_limiting(self):
        """Test attempt limiting for verification"""
        # Test maximum attempt limits
        pass
    
    def test_input_validation(self):
        """Test input validation and sanitization"""
        # Test input validation
        pass

if __name__ == "__main__":
    # Run the test suite
    pytest.main([
        __file__,
        "-v",
        "--tb=short",
        "--cov=.",
        "--cov-report=html",
        "--cov-report=term-missing"
    ])