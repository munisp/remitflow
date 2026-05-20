"""
Unit tests for authorization service
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from service.authorization_service import AuthorizationService
from client.permify_client import PermissionResult, PermissionCheckResponse


class TestAuthorizationService:
    """Test suite for authorization service"""
    
    @pytest.fixture
    def mock_client(self):
        """Create mock Permify client"""
        client = Mock()
        client.check_permission = AsyncMock()
        client.create_relationship = AsyncMock()
        return client
    
    @pytest.fixture
    def service(self, mock_client):
        """Create authorization service with mock client"""
        return AuthorizationService(client=mock_client)
    
    @pytest.mark.asyncio
    async def test_can_view_account_balance_allowed(self, service, mock_client):
        """Test can view account balance - allowed"""
        mock_client.check_permission.return_value = PermissionCheckResponse(
            can=PermissionResult.ALLOWED,
            metadata={},
            duration_ms=10
        )
        
        result = await service.can_view_account_balance("user_123", "acc_123")
        
        assert result is True
        mock_client.check_permission.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_can_view_account_balance_denied(self, service, mock_client):
        """Test can view account balance - denied"""
        mock_client.check_permission.return_value = PermissionCheckResponse(
            can=PermissionResult.DENIED,
            metadata={},
            duration_ms=10
        )
        
        result = await service.can_view_account_balance("user_123", "acc_123")
        
        assert result is False
    
    @pytest.mark.asyncio
    async def test_can_transfer_from_account(self, service, mock_client):
        """Test can transfer from account"""
        mock_client.check_permission.return_value = PermissionCheckResponse(
            can=PermissionResult.ALLOWED,
            metadata={},
            duration_ms=10
        )
        
        result = await service.can_transfer_from_account("user_123", "acc_123")
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_can_approve_transaction(self, service, mock_client):
        """Test can approve transaction"""
        mock_client.check_permission.return_value = PermissionCheckResponse(
            can=PermissionResult.ALLOWED,
            metadata={},
            duration_ms=10
        )
        
        result = await service.can_approve_transaction("user_123", "txn_123")
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_can_verify_kyc_document(self, service, mock_client):
        """Test can verify KYC document"""
        mock_client.check_permission.return_value = PermissionCheckResponse(
            can=PermissionResult.ALLOWED,
            metadata={},
            duration_ms=10
        )
        
        result = await service.can_verify_kyc_document("user_123", "doc_123")
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_assign_account_owner(self, service, mock_client):
        """Test assign account owner"""
        mock_client.create_relationship.return_value = True
        
        result = await service.assign_account_owner("user_123", "acc_123")
        
        assert result is True
        mock_client.create_relationship.assert_called_once_with(
            entity_type="account",
            entity_id="acc_123",
            relation="owner",
            subject_type="user",
            subject_id="user_123"
        )
    
    @pytest.mark.asyncio
    async def test_assign_organization_admin(self, service, mock_client):
        """Test assign organization admin"""
        mock_client.create_relationship.return_value = True
        
        result = await service.assign_organization_admin("user_123", "org_123")
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_check_multiple_permissions(self, service, mock_client):
        """Test check multiple permissions in parallel"""
        mock_client.check_permission.return_value = PermissionCheckResponse(
            can=PermissionResult.ALLOWED,
            metadata={},
            duration_ms=10
        )
        
        checks = [
            {"entity_type": "account", "entity_id": "acc_1", "permission": "view"},
            {"entity_type": "account", "entity_id": "acc_2", "permission": "transfer"},
            {"entity_type": "transaction", "entity_id": "txn_1", "permission": "approve"}
        ]
        
        results = await service.check_multiple_permissions("user_123", checks)
        
        assert len(results) == 3
        assert all(results.values())
    
    @pytest.mark.asyncio
    async def test_get_user_permissions(self, service, mock_client):
        """Test get all user permissions on entity"""
        # Mock some permissions as allowed, others as denied
        def mock_check(entity_type, entity_id, permission, subject_type, subject_id):
            allowed_perms = ["view_balance", "view_transactions", "transfer"]
            can = PermissionResult.ALLOWED if permission in allowed_perms else PermissionResult.DENIED
            return PermissionCheckResponse(can=can, metadata={}, duration_ms=10)
        
        mock_client.check_permission.side_effect = mock_check
        
        permissions = await service.get_user_permissions("user_123", "account", "acc_123")
        
        assert "view_balance" in permissions
        assert "view_transactions" in permissions
        assert "transfer" in permissions
        assert "withdraw" not in permissions

