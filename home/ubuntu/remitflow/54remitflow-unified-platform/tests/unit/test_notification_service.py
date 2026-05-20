"""
Unit tests for Notification Service
"""

import pytest
from unittest.mock import AsyncMock

class TestNotificationService:
    """Test suite for notification service"""
    
    @pytest.mark.asyncio
    async def test_send_sms(self, mock_notification_service):
        """Test SMS sending"""
        result = await mock_notification_service.send_sms("+254712345678", "Test message")
        assert result == True
    
    @pytest.mark.asyncio
    async def test_send_email(self, mock_notification_service):
        """Test email sending"""
        result = await mock_notification_service.send_email("test@example.com", "Test", "Body")
        assert result == True
    
    @pytest.mark.asyncio
    async def test_send_push(self, mock_notification_service):
        """Test push notification"""
        result = await mock_notification_service.send_push("user_123", "Test notification")
        assert result == True
