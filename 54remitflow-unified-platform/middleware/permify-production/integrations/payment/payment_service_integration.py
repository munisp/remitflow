"""
Payment Service Integration with Permify Authorization
Integrates authorization checks into payment operations
"""

import logging
from typing import Optional, Dict, Any
from decimal import Decimal
from datetime import datetime

from service.authorization_service import AuthorizationService, get_authorization_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PaymentServiceIntegration:
    """
    Payment service with integrated authorization
    """
    
    def __init__(self, auth_service: Optional[AuthorizationService] = None):
        """
        Initialize payment service integration
        
        Args:
            auth_service: Authorization service instance
        """
        self.auth_service = auth_service or get_authorization_service()
        logger.info("Payment service integration initialized")
    
    async def initiate_transfer(
        self,
        user_id: str,
        from_account_id: str,
        to_account_id: str,
        amount: Decimal,
        currency: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Initiate a transfer with authorization check
        
        Args:
            user_id: User initiating the transfer
            from_account_id: Source account ID
            to_account_id: Destination account ID
            amount: Transfer amount
            currency: Currency code
            metadata: Additional metadata
        
        Returns:
            Transfer result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_transfer = await self.auth_service.can_transfer_from_account(user_id, from_account_id)
        
        if not can_transfer:
            logger.warning(f"Transfer denied: user={user_id}, account={from_account_id}")
            raise PermissionError(f"User {user_id} cannot transfer from account {from_account_id}")
        
        # Create transaction record
        transaction_id = f"txn_{datetime.utcnow().timestamp()}"
        
        # Assign relationships in Permify
        await self.auth_service.client.create_relationship(
            entity_type="transaction",
            entity_id=transaction_id,
            relation="sender",
            subject_type="user",
            subject_id=user_id
        )
        
        # Log authorized transfer
        logger.info(f"Transfer initiated: user={user_id}, from={from_account_id}, to={to_account_id}, amount={amount} {currency}")
        
        return {
            "transaction_id": transaction_id,
            "from_account_id": from_account_id,
            "to_account_id": to_account_id,
            "amount": str(amount),
            "currency": currency,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }
    
    async def approve_transaction(
        self,
        user_id: str,
        transaction_id: str,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Approve a transaction with authorization check
        
        Args:
            user_id: User approving the transaction
            transaction_id: Transaction ID
            notes: Approval notes
        
        Returns:
            Approval result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_approve = await self.auth_service.can_approve_transaction(user_id, transaction_id)
        
        if not can_approve:
            logger.warning(f"Transaction approval denied: user={user_id}, transaction={transaction_id}")
            raise PermissionError(f"User {user_id} cannot approve transaction {transaction_id}")
        
        # Log authorized approval
        logger.info(f"Transaction approved: user={user_id}, transaction={transaction_id}")
        
        return {
            "transaction_id": transaction_id,
            "status": "approved",
            "approved_by": user_id,
            "approved_at": datetime.utcnow().isoformat(),
            "notes": notes
        }
    
    async def reject_transaction(
        self,
        user_id: str,
        transaction_id: str,
        reason: str
    ) -> Dict[str, Any]:
        """
        Reject a transaction with authorization check
        
        Args:
            user_id: User rejecting the transaction
            transaction_id: Transaction ID
            reason: Rejection reason
        
        Returns:
            Rejection result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_reject = await self.auth_service.can_reject_transaction(user_id, transaction_id)
        
        if not can_reject:
            logger.warning(f"Transaction rejection denied: user={user_id}, transaction={transaction_id}")
            raise PermissionError(f"User {user_id} cannot reject transaction {transaction_id}")
        
        # Log authorized rejection
        logger.info(f"Transaction rejected: user={user_id}, transaction={transaction_id}, reason={reason}")
        
        return {
            "transaction_id": transaction_id,
            "status": "rejected",
            "rejected_by": user_id,
            "rejected_at": datetime.utcnow().isoformat(),
            "reason": reason
        }
    
    async def refund_transaction(
        self,
        user_id: str,
        transaction_id: str,
        amount: Optional[Decimal] = None,
        reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Refund a transaction with authorization check
        
        Args:
            user_id: User initiating the refund
            transaction_id: Transaction ID
            amount: Refund amount (None for full refund)
            reason: Refund reason
        
        Returns:
            Refund result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_refund = await self.auth_service.can_refund_transaction(user_id, transaction_id)
        
        if not can_refund:
            logger.warning(f"Transaction refund denied: user={user_id}, transaction={transaction_id}")
            raise PermissionError(f"User {user_id} cannot refund transaction {transaction_id}")
        
        # Create refund record
        refund_id = f"refund_{datetime.utcnow().timestamp()}"
        
        # Log authorized refund
        logger.info(f"Transaction refund initiated: user={user_id}, transaction={transaction_id}, refund={refund_id}")
        
        return {
            "refund_id": refund_id,
            "transaction_id": transaction_id,
            "amount": str(amount) if amount else "full",
            "status": "processing",
            "initiated_by": user_id,
            "initiated_at": datetime.utcnow().isoformat(),
            "reason": reason
        }
    
    async def view_account_balance(
        self,
        user_id: str,
        account_id: str
    ) -> Dict[str, Any]:
        """
        View account balance with authorization check
        
        Args:
            user_id: User viewing the balance
            account_id: Account ID
        
        Returns:
            Account balance
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_view = await self.auth_service.can_view_account_balance(user_id, account_id)
        
        if not can_view:
            logger.warning(f"Balance view denied: user={user_id}, account={account_id}")
            raise PermissionError(f"User {user_id} cannot view balance of account {account_id}")
        
        # Log authorized view
        logger.info(f"Balance viewed: user={user_id}, account={account_id}")
        
        # Fetch real balance from TigerBeetle
        import requests
        import os
        
        tigerbeetle_url = os.getenv('TIGERBEETLE_ADDRESS', 'http://localhost:3000')
        
        try:
            response = requests.get(
                f"{tigerbeetle_url}/accounts/{account_id}",
                timeout=5
            )
            
            if response.status_code == 200:
                data = response.json()
                # TigerBeetle stores amounts in smallest units (kobo for NGN)
                balance = float(data.get('balance', 0)) / 100
                debits_pending = float(data.get('debits_pending', 0)) / 100
                credits_pending = float(data.get('credits_pending', 0)) / 100
                
                return {
                    "account_id": account_id,
                    "balance": f"{balance:.2f}",
                    "currency": "NGN",
                    "available_balance": f"{balance - debits_pending:.2f}",
                    "pending_balance": f"{credits_pending:.2f}",
                    "last_updated": datetime.utcnow().isoformat(),
                    "ledger": data.get('ledger'),
                    "code": data.get('code')
                }
            else:
                logger.warning(f"TigerBeetle returned {response.status_code}")
        except Exception as e:
            logger.error(f"Failed to fetch balance from TigerBeetle: {e}")
        
        # Fallback response if TigerBeetle unavailable
        return {
            "account_id": account_id,
            "balance": "0.00",
            "currency": "NGN",
            "available_balance": "0.00",
            "pending_balance": "0.00",
            "last_updated": datetime.utcnow().isoformat(),
            "note": "Balance unavailable - TigerBeetle connection failed"
        }
    
    async def setup_account_permissions(
        self,
        account_id: str,
        owner_id: str,
        organization_id: Optional[str] = None,
        authorized_users: Optional[list] = None
    ) -> bool:
        """
        Setup permissions for a new account
        
        Args:
            account_id: Account ID
            owner_id: Account owner user ID
            organization_id: Organization ID (if applicable)
            authorized_users: List of authorized user IDs
        
        Returns:
            True if successful
        """
        # Assign owner
        await self.auth_service.assign_account_owner(owner_id, account_id)
        
        # Link to organization
        if organization_id:
            await self.auth_service.link_account_to_organization(account_id, organization_id)
        
        # Assign authorized users
        if authorized_users:
            for user_id in authorized_users:
                await self.auth_service.client.create_relationship(
                    entity_type="account",
                    entity_id=account_id,
                    relation="authorized_user",
                    subject_type="user",
                    subject_id=user_id
                )
        
        logger.info(f"Account permissions setup: account={account_id}, owner={owner_id}, org={organization_id}")
        return True

