"""
Keycloak User Management Script
Provides utilities for managing users in Keycloak
"""

from keycloak import KeycloakAdmin
from keycloak.exceptions import KeycloakError
import logging
import argparse
from typing import List, Dict, Any, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class UserManager:
    """Manage Keycloak users"""
    
    def __init__(self, server_url: str, admin_username: str, admin_password: str, realm_name: str = "remittance"):
        """
        Initialize user manager
        
        Args:
            server_url: Keycloak server URL
            admin_username: Admin username
            admin_password: Admin password
            realm_name: Realm name
        """
        self.keycloak_admin = KeycloakAdmin(
            server_url=server_url,
            username=admin_username,
            password=admin_password,
            realm_name=realm_name,
            verify=True
        )
        self.realm_name = realm_name
    
    def create_user(
        self,
        username: str,
        email: str,
        first_name: str,
        last_name: str,
        password: str,
        enabled: bool = True,
        email_verified: bool = False,
        roles: Optional[List[str]] = None
    ) -> str:
        """
        Create a new user
        
        Args:
            username: Username
            email: Email address
            first_name: First name
            last_name: Last name
            password: Password
            enabled: Whether user is enabled
            email_verified: Whether email is verified
            roles: List of roles to assign
            
        Returns:
            User ID
        """
        try:
            user_payload = {
                "username": username,
                "email": email,
                "firstName": first_name,
                "lastName": last_name,
                "enabled": enabled,
                "emailVerified": email_verified,
                "credentials": [{
                    "type": "password",
                    "value": password,
                    "temporary": False
                }]
            }
            
            user_id = self.keycloak_admin.create_user(payload=user_payload)
            logger.info(f"User '{username}' created successfully with ID: {user_id}")
            
            # Assign roles if provided
            if roles:
                self.assign_roles(user_id, roles)
            
            return user_id
            
        except KeycloakError as e:
            logger.error(f"Error creating user: {e}")
            raise
    
    def get_user(self, user_id: str) -> Dict[str, Any]:
        """
        Get user by ID
        
        Args:
            user_id: User ID
            
        Returns:
            User data
        """
        try:
            user = self.keycloak_admin.get_user(user_id)
            return user
        except KeycloakError as e:
            logger.error(f"Error getting user: {e}")
            raise
    
    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """
        Get user by username
        
        Args:
            username: Username
            
        Returns:
            User data or None
        """
        try:
            users = self.keycloak_admin.get_users({"username": username})
            if users:
                return users[0]
            return None
        except KeycloakError as e:
            logger.error(f"Error getting user by username: {e}")
            raise
    
    def update_user(self, user_id: str, user_data: Dict[str, Any]):
        """
        Update user
        
        Args:
            user_id: User ID
            user_data: User data to update
        """
        try:
            self.keycloak_admin.update_user(user_id, user_data)
            logger.info(f"User {user_id} updated successfully")
        except KeycloakError as e:
            logger.error(f"Error updating user: {e}")
            raise
    
    def delete_user(self, user_id: str):
        """
        Delete user
        
        Args:
            user_id: User ID
        """
        try:
            self.keycloak_admin.delete_user(user_id)
            logger.info(f"User {user_id} deleted successfully")
        except KeycloakError as e:
            logger.error(f"Error deleting user: {e}")
            raise
    
    def reset_password(self, user_id: str, new_password: str, temporary: bool = False):
        """
        Reset user password
        
        Args:
            user_id: User ID
            new_password: New password
            temporary: Whether password is temporary
        """
        try:
            self.keycloak_admin.set_user_password(
                user_id,
                new_password,
                temporary=temporary
            )
            logger.info(f"Password reset for user {user_id}")
        except KeycloakError as e:
            logger.error(f"Error resetting password: {e}")
            raise
    
    def assign_roles(self, user_id: str, roles: List[str]):
        """
        Assign roles to user
        
        Args:
            user_id: User ID
            roles: List of role names
        """
        try:
            # Get realm roles
            realm_roles = self.keycloak_admin.get_realm_roles()
            
            # Filter roles to assign
            roles_to_assign = [
                role for role in realm_roles
                if role["name"] in roles
            ]
            
            # Assign roles
            self.keycloak_admin.assign_realm_roles(user_id, roles_to_assign)
            logger.info(f"Roles {roles} assigned to user {user_id}")
            
        except KeycloakError as e:
            logger.error(f"Error assigning roles: {e}")
            raise
    
    def remove_roles(self, user_id: str, roles: List[str]):
        """
        Remove roles from user
        
        Args:
            user_id: User ID
            roles: List of role names
        """
        try:
            # Get realm roles
            realm_roles = self.keycloak_admin.get_realm_roles()
            
            # Filter roles to remove
            roles_to_remove = [
                role for role in realm_roles
                if role["name"] in roles
            ]
            
            # Remove roles
            self.keycloak_admin.delete_realm_roles_of_user(user_id, roles_to_remove)
            logger.info(f"Roles {roles} removed from user {user_id}")
            
        except KeycloakError as e:
            logger.error(f"Error removing roles: {e}")
            raise
    
    def get_user_roles(self, user_id: str) -> List[str]:
        """
        Get user roles
        
        Args:
            user_id: User ID
            
        Returns:
            List of role names
        """
        try:
            roles = self.keycloak_admin.get_realm_roles_of_user(user_id)
            return [role["name"] for role in roles]
        except KeycloakError as e:
            logger.error(f"Error getting user roles: {e}")
            raise
    
    def add_user_to_group(self, user_id: str, group_id: str):
        """
        Add user to group
        
        Args:
            user_id: User ID
            group_id: Group ID
        """
        try:
            self.keycloak_admin.group_user_add(user_id, group_id)
            logger.info(f"User {user_id} added to group {group_id}")
        except KeycloakError as e:
            logger.error(f"Error adding user to group: {e}")
            raise
    
    def remove_user_from_group(self, user_id: str, group_id: str):
        """
        Remove user from group
        
        Args:
            user_id: User ID
            group_id: Group ID
        """
        try:
            self.keycloak_admin.group_user_remove(user_id, group_id)
            logger.info(f"User {user_id} removed from group {group_id}")
        except KeycloakError as e:
            logger.error(f"Error removing user from group: {e}")
            raise
    
    def list_users(self, query: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        List users
        
        Args:
            query: Query parameters
            
        Returns:
            List of users
        """
        try:
            users = self.keycloak_admin.get_users(query or {})
            return users
        except KeycloakError as e:
            logger.error(f"Error listing users: {e}")
            raise
    
    def enable_user(self, user_id: str):
        """Enable user"""
        self.update_user(user_id, {"enabled": True})
    
    def disable_user(self, user_id: str):
        """Disable user"""
        self.update_user(user_id, {"enabled": False})
    
    def verify_email(self, user_id: str):
        """Verify user email"""
        self.update_user(user_id, {"emailVerified": True})
    
    def send_verify_email(self, user_id: str):
        """Send email verification"""
        try:
            self.keycloak_admin.send_verify_email(user_id)
            logger.info(f"Verification email sent to user {user_id}")
        except KeycloakError as e:
            logger.error(f"Error sending verification email: {e}")
            raise


def main():
    """Main CLI function"""
    parser = argparse.ArgumentParser(description="Keycloak User Management")
    parser.add_argument("--server-url", required=True, help="Keycloak server URL")
    parser.add_argument("--admin-username", required=True, help="Admin username")
    parser.add_argument("--admin-password", required=True, help="Admin password")
    parser.add_argument("--realm", default="remittance", help="Realm name")
    
    subparsers = parser.add_subparsers(dest="command", help="Command")
    
    # Create user
    create_parser = subparsers.add_parser("create", help="Create user")
    create_parser.add_argument("--username", required=True)
    create_parser.add_argument("--email", required=True)
    create_parser.add_argument("--first-name", required=True)
    create_parser.add_argument("--last-name", required=True)
    create_parser.add_argument("--password", required=True)
    create_parser.add_argument("--roles", nargs="+", help="Roles to assign")
    
    # List users
    list_parser = subparsers.add_parser("list", help="List users")
    
    # Get user
    get_parser = subparsers.add_parser("get", help="Get user")
    get_parser.add_argument("--username", required=True)
    
    # Reset password
    reset_parser = subparsers.add_parser("reset-password", help="Reset password")
    reset_parser.add_argument("--user-id", required=True)
    reset_parser.add_argument("--password", required=True)
    
    args = parser.parse_args()
    
    manager = UserManager(
        server_url=args.server_url,
        admin_username=args.admin_username,
        admin_password=args.admin_password,
        realm_name=args.realm
    )
    
    if args.command == "create":
        user_id = manager.create_user(
            username=args.username,
            email=args.email,
            first_name=args.first_name,
            last_name=args.last_name,
            password=args.password,
            roles=args.roles
        )
        print(f"User created with ID: {user_id}")
    
    elif args.command == "list":
        users = manager.list_users()
        for user in users:
            print(f"{user['id']}: {user['username']} ({user['email']})")
    
    elif args.command == "get":
        user = manager.get_user_by_username(args.username)
        if user:
            print(f"User: {user}")
        else:
            print("User not found")
    
    elif args.command == "reset-password":
        manager.reset_password(args.user_id, args.password)
        print("Password reset successfully")


if __name__ == "__main__":
    main()

