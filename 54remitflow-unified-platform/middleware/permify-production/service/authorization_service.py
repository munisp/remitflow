"""
Authorization Service
High-level authorization service for the remittance platform
"""

import logging
from typing import Optional, List, Dict, Any
from enum import Enum
import asyncio

from client.permify_client import (
    PermifyClient,
    get_permify_client,
    PermissionResult,
    PermissionCheckResponse
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AuthorizationService:
    """
    Authorization service for the remittance platform
    Provides high-level authorization methods for all platform entities
    """
    
    def __init__(self, client: Optional[PermifyClient] = None):
        """
        Initialize authorization service
        
        Args:
            client: Permify client instance (default: singleton)
        """
        self.client = client or get_permify_client()
        logger.info("Authorization service initialized")
    
    # ========================================================================
    # ACCOUNT PERMISSIONS
    # ========================================================================
    
    async def can_view_account_balance(self, user_id: str, account_id: str) -> bool:
        """Check if user can view account balance"""
        result = await self.client.check_permission(
            entity_type="account",
            entity_id=account_id,
            permission="view_balance",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_transfer_from_account(self, user_id: str, account_id: str) -> bool:
        """Check if user can transfer from account"""
        result = await self.client.check_permission(
            entity_type="account",
            entity_id=account_id,
            permission="transfer",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_withdraw_from_account(self, user_id: str, account_id: str) -> bool:
        """Check if user can withdraw from account"""
        result = await self.client.check_permission(
            entity_type="account",
            entity_id=account_id,
            permission="withdraw",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_freeze_account(self, user_id: str, account_id: str) -> bool:
        """Check if user can freeze account"""
        result = await self.client.check_permission(
            entity_type="account",
            entity_id=account_id,
            permission="freeze",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    # ========================================================================
    # TRANSACTION PERMISSIONS
    # ========================================================================
    
    async def can_view_transaction(self, user_id: str, transaction_id: str) -> bool:
        """Check if user can view transaction"""
        result = await self.client.check_permission(
            entity_type="transaction",
            entity_id=transaction_id,
            permission="view",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_approve_transaction(self, user_id: str, transaction_id: str) -> bool:
        """Check if user can approve transaction"""
        result = await self.client.check_permission(
            entity_type="transaction",
            entity_id=transaction_id,
            permission="approve",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_reject_transaction(self, user_id: str, transaction_id: str) -> bool:
        """Check if user can reject transaction"""
        result = await self.client.check_permission(
            entity_type="transaction",
            entity_id=transaction_id,
            permission="reject",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_refund_transaction(self, user_id: str, transaction_id: str) -> bool:
        """Check if user can refund transaction"""
        result = await self.client.check_permission(
            entity_type="transaction",
            entity_id=transaction_id,
            permission="refund",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_flag_transaction_suspicious(self, user_id: str, transaction_id: str) -> bool:
        """Check if user can flag transaction as suspicious"""
        result = await self.client.check_permission(
            entity_type="transaction",
            entity_id=transaction_id,
            permission="flag_suspicious",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    # ========================================================================
    # KYC PERMISSIONS
    # ========================================================================
    
    async def can_view_kyc_document(self, user_id: str, document_id: str) -> bool:
        """Check if user can view KYC document"""
        result = await self.client.check_permission(
            entity_type="kyc_document",
            entity_id=document_id,
            permission="view",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_verify_kyc_document(self, user_id: str, document_id: str) -> bool:
        """Check if user can verify KYC document"""
        result = await self.client.check_permission(
            entity_type="kyc_document",
            entity_id=document_id,
            permission="verify",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_approve_kyc(self, user_id: str, verification_id: str) -> bool:
        """Check if user can approve KYC verification"""
        result = await self.client.check_permission(
            entity_type="kyc_verification",
            entity_id=verification_id,
            permission="approve",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    # ========================================================================
    # ORGANIZATION PERMISSIONS
    # ========================================================================
    
    async def can_manage_organization_members(self, user_id: str, org_id: str) -> bool:
        """Check if user can manage organization members"""
        result = await self.client.check_permission(
            entity_type="organization",
            entity_id=org_id,
            permission="manage_members",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_view_organization_analytics(self, user_id: str, org_id: str) -> bool:
        """Check if user can view organization analytics"""
        result = await self.client.check_permission(
            entity_type="organization",
            entity_id=org_id,
            permission="view_analytics",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_edit_organization(self, user_id: str, org_id: str) -> bool:
        """Check if user can edit organization"""
        result = await self.client.check_permission(
            entity_type="organization",
            entity_id=org_id,
            permission="edit",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    # ========================================================================
    # FRAUD CASE PERMISSIONS
    # ========================================================================
    
    async def can_investigate_fraud_case(self, user_id: str, case_id: str) -> bool:
        """Check if user can investigate fraud case"""
        result = await self.client.check_permission(
            entity_type="fraud_case",
            entity_id=case_id,
            permission="investigate",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_approve_fraud_case(self, user_id: str, case_id: str) -> bool:
        """Check if user can approve fraud case resolution"""
        result = await self.client.check_permission(
            entity_type="fraud_case",
            entity_id=case_id,
            permission="approve",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    # ========================================================================
    # COMPLIANCE PERMISSIONS
    # ========================================================================
    
    async def can_view_aml_case(self, user_id: str, case_id: str) -> bool:
        """Check if user can view AML case"""
        result = await self.client.check_permission(
            entity_type="aml_case",
            entity_id=case_id,
            permission="view",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_file_sar(self, user_id: str, case_id: str) -> bool:
        """Check if user can file Suspicious Activity Report"""
        result = await self.client.check_permission(
            entity_type="aml_case",
            entity_id=case_id,
            permission="file_sar",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    # ========================================================================
    # ADMIN PERMISSIONS
    # ========================================================================
    
    async def can_access_admin_panel(self, user_id: str, panel_id: str = "main") -> bool:
        """Check if user can access admin panel"""
        result = await self.client.check_permission(
            entity_type="admin_panel",
            entity_id=panel_id,
            permission="access",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    async def can_manage_system_settings(self, user_id: str, config_id: str = "main") -> bool:
        """Check if user can manage system settings"""
        result = await self.client.check_permission(
            entity_type="system_configuration",
            entity_id=config_id,
            permission="edit",
            subject_type="user",
            subject_id=user_id
        )
        return result.can == PermissionResult.ALLOWED
    
    # ========================================================================
    # RELATIONSHIP MANAGEMENT
    # ========================================================================
    
    async def assign_account_owner(self, user_id: str, account_id: str) -> bool:
        """Assign user as account owner"""
        return await self.client.create_relationship(
            entity_type="account",
            entity_id=account_id,
            relation="owner",
            subject_type="user",
            subject_id=user_id
        )
    
    async def assign_organization_admin(self, user_id: str, org_id: str) -> bool:
        """Assign user as organization admin"""
        return await self.client.create_relationship(
            entity_type="organization",
            entity_id=org_id,
            relation="admin",
            subject_type="user",
            subject_id=user_id
        )
    
    async def assign_organization_member(self, user_id: str, org_id: str) -> bool:
        """Assign user as organization member"""
        return await self.client.create_relationship(
            entity_type="organization",
            entity_id=org_id,
            relation="member",
            subject_type="user",
            subject_id=user_id
        )
    
    async def assign_compliance_officer(self, user_id: str, case_id: str, case_type: str = "aml_case") -> bool:
        """Assign user as compliance officer for a case"""
        return await self.client.create_relationship(
            entity_type=case_type,
            entity_id=case_id,
            relation="compliance_officer",
            subject_type="user",
            subject_id=user_id
        )
    
    async def link_account_to_organization(self, account_id: str, org_id: str) -> bool:
        """Link account to organization"""
        return await self.client.create_relationship(
            entity_type="account",
            entity_id=account_id,
            relation="organization",
            subject_type="organization",
            subject_id=org_id
        )
    
    async def link_transaction_to_organization(self, transaction_id: str, org_id: str) -> bool:
        """Link transaction to organization"""
        return await self.client.create_relationship(
            entity_type="transaction",
            entity_id=transaction_id,
            relation="organization",
            subject_type="organization",
            subject_id=org_id
        )
    
    # ========================================================================
    # BULK OPERATIONS
    # ========================================================================
    
    async def check_multiple_permissions(
        self,
        user_id: str,
        checks: List[Dict[str, str]]
    ) -> Dict[str, bool]:
        """
        Check multiple permissions in parallel
        
        Args:
            user_id: User ID
            checks: List of permission checks, each with entity_type, entity_id, permission
        
        Returns:
            Dictionary mapping check identifier to result
        """
        tasks = []
        check_ids = []
        
        for check in checks:
            entity_type = check["entity_type"]
            entity_id = check["entity_id"]
            permission = check["permission"]
            check_id = f"{entity_type}:{entity_id}:{permission}"
            
            task = self.client.check_permission(
                entity_type=entity_type,
                entity_id=entity_id,
                permission=permission,
                subject_type="user",
                subject_id=user_id
            )
            
            tasks.append(task)
            check_ids.append(check_id)
        
        results = await asyncio.gather(*tasks)
        
        return {
            check_id: result.can == PermissionResult.ALLOWED
            for check_id, result in zip(check_ids, results)
        }
    
    # ========================================================================
    # UTILITY METHODS
    # ========================================================================
    
    async def get_user_permissions(
        self,
        user_id: str,
        entity_type: str,
        entity_id: str
    ) -> List[str]:
        """
        Get all permissions a user has on an entity
        
        Args:
            user_id: User ID
            entity_type: Entity type
            entity_id: Entity ID
        
        Returns:
            List of permission names
        """
        # Define all possible permissions for each entity type
        permission_map = {
            "account": ["view_balance", "view_transactions", "transfer", "withdraw", "deposit", "freeze", "close", "view_details"],
            "transaction": ["view", "view_details", "approve", "reject", "flag_suspicious", "refund", "cancel", "audit"],
            "organization": ["view", "edit", "delete", "manage_members", "invite_members", "view_analytics", "manage_settings"],
            "kyc_document": ["view", "upload", "verify", "approve", "reject", "delete", "request_update"],
            "kyc_verification": ["view", "initiate", "review", "approve", "reject", "request_documents", "complete"],
            "fraud_case": ["view", "investigate", "update", "escalate", "approve", "reject", "close", "reopen"],
            "aml_case": ["view", "investigate", "update", "escalate", "approve", "reject", "close", "file_sar"],
        }
        
        permissions_to_check = permission_map.get(entity_type, [])
        
        checks = [
            {"entity_type": entity_type, "entity_id": entity_id, "permission": perm}
            for perm in permissions_to_check
        ]
        
        results = await self.check_multiple_permissions(user_id, checks)
        
        return [
            perm for check_id, allowed in results.items()
            if allowed and (perm := check_id.split(":")[-1])
        ]
    
    async def close(self):
        """Close authorization service"""
        await self.client.close()
        logger.info("Authorization service closed")


# Singleton instance
_service_instance: Optional[AuthorizationService] = None


def get_authorization_service() -> AuthorizationService:
    """Get singleton authorization service instance"""
    global _service_instance
    if _service_instance is None:
        _service_instance = AuthorizationService()
    return _service_instance

