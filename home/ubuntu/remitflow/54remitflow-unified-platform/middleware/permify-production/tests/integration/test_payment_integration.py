"""
Integration tests for payment service with authorization
"""

import pytest
from decimal import Decimal
from unittest.mock import Mock, AsyncMock
from integrations.payment.payment_service_integration import PaymentServiceIntegration
from service.authorization_service import AuthorizationService


class TestPaymentServiceIntegration:
    """Test suite for payment service integration"""
    
    @pytest.fixture
    def mock_auth_service(self):
        """Create mock authorization service"""
        service = Mock(spec=AuthorizationService)
        service.can_transfer_from_account = AsyncMock()
        service.can_approve_transaction = AsyncMock()
        service.can_reject_transaction = AsyncMock()
        service.can_refund_transaction = AsyncMock()
        service.can_view_account_balance = AsyncMock()
        service.assign_account_owner = AsyncMock()
        service.link_account_to_organization = AsyncMock()
        service.client = Mock()
        service.client.create_relationship = AsyncMock()
        return service
    
    @pytest.fixture
    def payment_service(self, mock_auth_service):
        """Create payment service with mock authorization"""
        return PaymentServiceIntegration(auth_service=mock_auth_service)
    
    @pytest.mark.asyncio
    async def test_initiate_transfer_allowed(self, payment_service, mock_auth_service):
        """Test initiating transfer - allowed"""
        mock_auth_service.can_transfer_from_account.return_value = True
        mock_auth_service.client.create_relationship.return_value = True
        
        result = await payment_service.initiate_transfer(
            user_id="user_123",
            from_account_id="acc_1",
            to_account_id="acc_2",
            amount=Decimal("100.00"),
            currency="NGN"
        )
        
        assert result["from_account_id"] == "acc_1"
        assert result["to_account_id"] == "acc_2"
        assert result["amount"] == "100.00"
        assert result["status"] == "pending"
    
    @pytest.mark.asyncio
    async def test_initiate_transfer_denied(self, payment_service, mock_auth_service):
        """Test initiating transfer - denied"""
        mock_auth_service.can_transfer_from_account.return_value = False
        
        with pytest.raises(PermissionError, match="cannot transfer"):
            await payment_service.initiate_transfer(
                user_id="user_123",
                from_account_id="acc_1",
                to_account_id="acc_2",
                amount=Decimal("100.00"),
                currency="NGN"
            )
    
    @pytest.mark.asyncio
    async def test_approve_transaction_allowed(self, payment_service, mock_auth_service):
        """Test approving transaction - allowed"""
        mock_auth_service.can_approve_transaction.return_value = True
        
        result = await payment_service.approve_transaction(
            user_id="user_123",
            transaction_id="txn_123",
            notes="Approved"
        )
        
        assert result["transaction_id"] == "txn_123"
        assert result["status"] == "approved"
        assert result["approved_by"] == "user_123"
    
    @pytest.mark.asyncio
    async def test_approve_transaction_denied(self, payment_service, mock_auth_service):
        """Test approving transaction - denied"""
        mock_auth_service.can_approve_transaction.return_value = False
        
        with pytest.raises(PermissionError, match="cannot approve"):
            await payment_service.approve_transaction(
                user_id="user_123",
                transaction_id="txn_123"
            )
    
    @pytest.mark.asyncio
    async def test_reject_transaction(self, payment_service, mock_auth_service):
        """Test rejecting transaction"""
        mock_auth_service.can_reject_transaction.return_value = True
        
        result = await payment_service.reject_transaction(
            user_id="user_123",
            transaction_id="txn_123",
            reason="Suspicious activity"
        )
        
        assert result["status"] == "rejected"
        assert result["reason"] == "Suspicious activity"
    
    @pytest.mark.asyncio
    async def test_refund_transaction(self, payment_service, mock_auth_service):
        """Test refunding transaction"""
        mock_auth_service.can_refund_transaction.return_value = True
        
        result = await payment_service.refund_transaction(
            user_id="user_123",
            transaction_id="txn_123",
            amount=Decimal("50.00"),
            reason="Customer request"
        )
        
        assert result["transaction_id"] == "txn_123"
        assert result["amount"] == "50.00"
        assert result["status"] == "processing"
    
    @pytest.mark.asyncio
    async def test_view_account_balance_allowed(self, payment_service, mock_auth_service):
        """Test viewing account balance - allowed"""
        mock_auth_service.can_view_account_balance.return_value = True
        
        result = await payment_service.view_account_balance(
            user_id="user_123",
            account_id="acc_123"
        )
        
        assert result["account_id"] == "acc_123"
        assert "balance" in result
        assert "currency" in result
    
    @pytest.mark.asyncio
    async def test_view_account_balance_denied(self, payment_service, mock_auth_service):
        """Test viewing account balance - denied"""
        mock_auth_service.can_view_account_balance.return_value = False
        
        with pytest.raises(PermissionError, match="cannot view balance"):
            await payment_service.view_account_balance(
                user_id="user_123",
                account_id="acc_123"
            )
    
    @pytest.mark.asyncio
    async def test_setup_account_permissions(self, payment_service, mock_auth_service):
        """Test setting up account permissions"""
        mock_auth_service.assign_account_owner.return_value = True
        mock_auth_service.link_account_to_organization.return_value = True
        mock_auth_service.client.create_relationship.return_value = True
        
        result = await payment_service.setup_account_permissions(
            account_id="acc_123",
            owner_id="user_123",
            organization_id="org_123",
            authorized_users=["user_456", "user_789"]
        )
        
        assert result is True
        mock_auth_service.assign_account_owner.assert_called_once()
        mock_auth_service.link_account_to_organization.assert_called_once()
        assert mock_auth_service.client.create_relationship.call_count == 2

