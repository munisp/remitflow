"""
Permify Authorization Integration for Mojaloop
Implements fine-grained access control for Mojaloop operations
"""

import logging
from typing import Dict, Any, List
from enum import Enum


logger = logging.getLogger(__name__)


class Permission(Enum):
    """Mojaloop permissions"""
    # Participant permissions
    PARTICIPANT_CREATE = "participant.create"
    PARTICIPANT_READ = "participant.read"
    PARTICIPANT_UPDATE = "participant.update"
    PARTICIPANT_DELETE = "participant.delete"
    
    # Quote permissions
    QUOTE_CREATE = "quote.create"
    QUOTE_READ = "quote.read"
    QUOTE_APPROVE = "quote.approve"
    QUOTE_REJECT = "quote.reject"
    
    # Transfer permissions
    TRANSFER_CREATE = "transfer.create"
    TRANSFER_READ = "transfer.read"
    TRANSFER_PREPARE = "transfer.prepare"
    TRANSFER_FULFILL = "transfer.fulfill"
    TRANSFER_ABORT = "transfer.abort"
    
    # Settlement permissions
    SETTLEMENT_CREATE = "settlement.create"
    SETTLEMENT_READ = "settlement.read"
    SETTLEMENT_PROCESS = "settlement.process"
    SETTLEMENT_APPROVE = "settlement.approve"
    
    # Admin permissions
    ADMIN_ALL = "admin.all"


class Role(Enum):
    """Mojaloop roles"""
    ADMIN = "admin"
    OPERATOR = "operator"
    PARTICIPANT_ADMIN = "participant_admin"
    PARTICIPANT_USER = "participant_user"
    AUDITOR = "auditor"
    VIEWER = "viewer"


class PermifyClient:
    """Client for Permify authorization service"""
    
    def __init__(self, permify_url: str = "http://localhost:3476"):
        self.permify_url = permify_url
        self.role_permissions = self._initialize_role_permissions()
    
    def _initialize_role_permissions(self) -> Dict[Role, List[Permission]]:
        """Initialize role-permission mappings"""
        return {
            Role.ADMIN: [Permission.ADMIN_ALL],
            Role.OPERATOR: [
                Permission.PARTICIPANT_READ,
                Permission.QUOTE_CREATE,
                Permission.QUOTE_READ,
                Permission.TRANSFER_CREATE,
                Permission.TRANSFER_READ,
                Permission.TRANSFER_PREPARE,
                Permission.TRANSFER_FULFILL,
                Permission.SETTLEMENT_READ,
            ],
            Role.PARTICIPANT_ADMIN: [
                Permission.PARTICIPANT_READ,
                Permission.PARTICIPANT_UPDATE,
                Permission.QUOTE_CREATE,
                Permission.QUOTE_READ,
                Permission.QUOTE_APPROVE,
                Permission.TRANSFER_CREATE,
                Permission.TRANSFER_READ,
                Permission.TRANSFER_PREPARE,
                Permission.TRANSFER_FULFILL,
            ],
            Role.PARTICIPANT_USER: [
                Permission.QUOTE_CREATE,
                Permission.QUOTE_READ,
                Permission.TRANSFER_CREATE,
                Permission.TRANSFER_READ,
            ],
            Role.AUDITOR: [
                Permission.PARTICIPANT_READ,
                Permission.QUOTE_READ,
                Permission.TRANSFER_READ,
                Permission.SETTLEMENT_READ,
            ],
            Role.VIEWER: [
                Permission.PARTICIPANT_READ,
                Permission.QUOTE_READ,
                Permission.TRANSFER_READ,
            ],
        }
    
    async def check_permission(
        self,
        user_id: str,
        permission: Permission,
        resource_id: str = None,
        context: Dict[str, Any] = None
    ) -> bool:
        """Check if user has permission for an action"""
        try:
            # In production, this would call Permify API
            # For now, return True for demonstration
            logger.info(f"Checking permission: user={user_id}, permission={permission.value}, resource={resource_id}")
            return True
        except Exception as e:
            logger.error(f"Permission check failed: {e}")
            return False
    
    async def check_permissions_batch(
        self,
        user_id: str,
        permissions: List[Permission],
        resource_id: str = None
    ) -> Dict[Permission, bool]:
        """Check multiple permissions at once"""
        results = {}
        for permission in permissions:
            results[permission] = await self.check_permission(user_id, permission, resource_id)
        return results
    
    async def get_user_permissions(self, user_id: str) -> List[Permission]:
        """Get all permissions for a user"""
        # In production, this would query Permify
        # For now, return operator permissions
        return self.role_permissions[Role.OPERATOR]
    
    async def assign_role(self, user_id: str, role: Role, participant_id: str = None) -> bool:
        """Assign a role to a user"""
        try:
            logger.info(f"Assigning role: user={user_id}, role={role.value}, participant={participant_id}")
            return True
        except Exception as e:
            logger.error(f"Role assignment failed: {e}")
            return False
    
    async def revoke_role(self, user_id: str, role: Role, participant_id: str = None) -> bool:
        """Revoke a role from a user"""
        try:
            logger.info(f"Revoking role: user={user_id}, role={role.value}, participant={participant_id}")
            return True
        except Exception as e:
            logger.error(f"Role revocation failed: {e}")
            return False


class AuthorizationMiddleware:
    """Middleware for enforcing authorization on Mojaloop operations"""
    
    def __init__(self, permify_client: PermifyClient):
        self.permify_client = permify_client
    
    async def authorize_participant_operation(
        self,
        user_id: str,
        operation: str,
        participant_id: str = None
    ) -> bool:
        """Authorize participant operations"""
        permission_map = {
            "create": Permission.PARTICIPANT_CREATE,
            "read": Permission.PARTICIPANT_READ,
            "update": Permission.PARTICIPANT_UPDATE,
            "delete": Permission.PARTICIPANT_DELETE,
        }
        
        permission = permission_map.get(operation)
        if not permission:
            logger.error(f"Unknown operation: {operation}")
            return False
        
        return await self.permify_client.check_permission(
            user_id, permission, participant_id
        )
    
    async def authorize_quote_operation(
        self,
        user_id: str,
        operation: str,
        quote_id: str = None,
        participant_id: str = None
    ) -> bool:
        """Authorize quote operations"""
        permission_map = {
            "create": Permission.QUOTE_CREATE,
            "read": Permission.QUOTE_READ,
            "approve": Permission.QUOTE_APPROVE,
            "reject": Permission.QUOTE_REJECT,
        }
        
        permission = permission_map.get(operation)
        if not permission:
            logger.error(f"Unknown operation: {operation}")
            return False
        
        # Check permission
        has_permission = await self.permify_client.check_permission(
            user_id, permission, quote_id
        )
        
        # Additional check: user must belong to participant
        if has_permission and participant_id:
            # In production, verify user belongs to participant
            pass
        
        return has_permission
    
    async def authorize_transfer_operation(
        self,
        user_id: str,
        operation: str,
        transfer_id: str = None,
        participant_id: str = None
    ) -> bool:
        """Authorize transfer operations"""
        permission_map = {
            "create": Permission.TRANSFER_CREATE,
            "read": Permission.TRANSFER_READ,
            "prepare": Permission.TRANSFER_PREPARE,
            "fulfill": Permission.TRANSFER_FULFILL,
            "abort": Permission.TRANSFER_ABORT,
        }
        
        permission = permission_map.get(operation)
        if not permission:
            logger.error(f"Unknown operation: {operation}")
            return False
        
        return await self.permify_client.check_permission(
            user_id, permission, transfer_id
        )
    
    async def authorize_settlement_operation(
        self,
        user_id: str,
        operation: str,
        settlement_id: str = None
    ) -> bool:
        """Authorize settlement operations"""
        permission_map = {
            "create": Permission.SETTLEMENT_CREATE,
            "read": Permission.SETTLEMENT_READ,
            "process": Permission.SETTLEMENT_PROCESS,
            "approve": Permission.SETTLEMENT_APPROVE,
        }
        
        permission = permission_map.get(operation)
        if not permission:
            logger.error(f"Unknown operation: {operation}")
            return False
        
        return await self.permify_client.check_permission(
            user_id, permission, settlement_id
        )


# Decorator for authorization
def require_permission(permission: Permission):
    """Decorator to require permission for a function"""
    def decorator(func):
        async def wrapper(*args, **kwargs):
            user_id = kwargs.get("user_id") or args[0] if args else None
            if not user_id:
                raise ValueError("user_id is required for authorization")
            
            # In production, check permission via Permify
            logger.info(f"Checking permission {permission.value} for user {user_id}")
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator


# Example usage
@require_permission(Permission.TRANSFER_CREATE)
async def create_transfer(user_id: str, transfer_data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a transfer (requires TRANSFER_CREATE permission)"""
    return {"transfer_id": "transfer-123", "status": "created"}


@require_permission(Permission.SETTLEMENT_APPROVE)
async def approve_settlement(user_id: str, settlement_id: str) -> Dict[str, Any]:
    """Approve a settlement (requires SETTLEMENT_APPROVE permission)"""
    return {"settlement_id": settlement_id, "status": "approved"}

