"""
Admin Service Integration with Permify Authorization
Integrates authorization checks into admin operations
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

from service.authorization_service import AuthorizationService, get_authorization_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AdminServiceIntegration:
    """
    Admin service with integrated authorization
    """
    
    def __init__(self, auth_service: Optional[AuthorizationService] = None):
        """
        Initialize admin service integration
        
        Args:
            auth_service: Authorization service instance
        """
        self.auth_service = auth_service or get_authorization_service()
        logger.info("Admin service integration initialized")
    
    async def access_admin_panel(
        self,
        user_id: str,
        panel_id: str = "main"
    ) -> Dict[str, Any]:
        """
        Access admin panel with authorization check
        
        Args:
            user_id: User accessing the panel
            panel_id: Panel ID
        
        Returns:
            Panel access result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_access = await self.auth_service.can_access_admin_panel(user_id, panel_id)
        
        if not can_access:
            logger.warning(f"Admin panel access denied: user={user_id}, panel={panel_id}")
            raise PermissionError(f"User {user_id} cannot access admin panel {panel_id}")
        
        # Log authorized access
        logger.info(f"Admin panel accessed: user={user_id}, panel={panel_id}")
        
        return {
            "panel_id": panel_id,
            "user_id": user_id,
            "accessed_at": datetime.utcnow().isoformat(),
            "permissions": ["view_dashboard", "manage_users", "view_reports"]
        }
    
    async def manage_organization(
        self,
        user_id: str,
        org_id: str,
        action: str,
        data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Manage organization with authorization check
        
        Args:
            user_id: User managing the organization
            org_id: Organization ID
            action: Action to perform (edit, delete, etc.)
            data: Action data
        
        Returns:
            Management result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization based on action
        if action == "edit":
            can_manage = await self.auth_service.can_edit_organization(user_id, org_id)
        elif action == "members":
            can_manage = await self.auth_service.can_manage_organization_members(user_id, org_id)
        elif action == "analytics":
            can_manage = await self.auth_service.can_view_organization_analytics(user_id, org_id)
        else:
            can_manage = False
        
        if not can_manage:
            logger.warning(f"Organization management denied: user={user_id}, org={org_id}, action={action}")
            raise PermissionError(f"User {user_id} cannot {action} organization {org_id}")
        
        # Log authorized management
        logger.info(f"Organization managed: user={user_id}, org={org_id}, action={action}")
        
        return {
            "org_id": org_id,
            "action": action,
            "managed_by": user_id,
            "managed_at": datetime.utcnow().isoformat(),
            "data": data
        }
    
    async def create_organization(
        self,
        user_id: str,
        org_name: str,
        org_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Create organization and setup permissions
        
        Args:
            user_id: User creating the organization (becomes owner)
            org_name: Organization name
            org_data: Organization data
        
        Returns:
            Organization record
        """
        # Create organization
        org_id = f"org_{datetime.utcnow().timestamp()}"
        
        # Setup permissions (user is owner)
        await self.auth_service.client.create_relationship(
            entity_type="organization",
            entity_id=org_id,
            relation="owner",
            subject_type="user",
            subject_id=user_id
        )
        
        logger.info(f"Organization created: org={org_id}, owner={user_id}, name={org_name}")
        
        return {
            "org_id": org_id,
            "org_name": org_name,
            "owner_id": user_id,
            "created_at": datetime.utcnow().isoformat(),
            "data": org_data
        }
    
    async def add_organization_member(
        self,
        admin_user_id: str,
        org_id: str,
        member_user_id: str,
        role: str = "member"
    ) -> bool:
        """
        Add member to organization with authorization check
        
        Args:
            admin_user_id: Admin adding the member
            org_id: Organization ID
            member_user_id: User to add as member
            role: Role (admin, member, viewer)
        
        Returns:
            True if successful
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_manage = await self.auth_service.can_manage_organization_members(admin_user_id, org_id)
        
        if not can_manage:
            logger.warning(f"Add organization member denied: user={admin_user_id}, org={org_id}")
            raise PermissionError(f"User {admin_user_id} cannot manage members of organization {org_id}")
        
        # Assign role
        if role == "admin":
            await self.auth_service.assign_organization_admin(member_user_id, org_id)
        else:
            await self.auth_service.assign_organization_member(member_user_id, org_id)
        
        logger.info(f"Organization member added: org={org_id}, member={member_user_id}, role={role}")
        return True
    
    async def manage_system_settings(
        self,
        user_id: str,
        config_id: str,
        settings: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Manage system settings with authorization check
        
        Args:
            user_id: User managing settings
            config_id: Configuration ID
            settings: Settings data
        
        Returns:
            Settings update result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_manage = await self.auth_service.can_manage_system_settings(user_id, config_id)
        
        if not can_manage:
            logger.warning(f"System settings management denied: user={user_id}, config={config_id}")
            raise PermissionError(f"User {user_id} cannot manage system settings")
        
        # Log authorized settings change
        logger.info(f"System settings updated: user={user_id}, config={config_id}")
        
        return {
            "config_id": config_id,
            "settings": settings,
            "updated_by": user_id,
            "updated_at": datetime.utcnow().isoformat()
        }

