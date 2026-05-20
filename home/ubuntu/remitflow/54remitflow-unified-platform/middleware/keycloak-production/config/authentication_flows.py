"""
Keycloak Authentication Flows Configuration
Configures custom authentication flows for the Nigerian Remittance Platform
"""

from keycloak import KeycloakAdmin
from keycloak.exceptions import KeycloakError
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AuthenticationFlowsConfigurator:
    """Configure Keycloak authentication flows"""
    
    def __init__(self, server_url: str, admin_username: str, admin_password: str, realm_name: str = "remittance"):
        """
        Initialize authentication flows configurator
        
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
    
    def configure_browser_flow(self):
        """Configure browser authentication flow with MFA"""
        try:
            # Create custom browser flow
            flow_alias = "remittance-browser"
            self.keycloak_admin.create_authentication_flow(
                payload={
                    "alias": flow_alias,
                    "description": "Browser flow with MFA for remittance platform",
                    "providerId": "basic-flow",
                    "topLevel": True,
                    "builtIn": False
                }
            )
            
            # Add cookie authenticator
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "auth-cookie"
                }
            )
            
            # Add identity provider redirector
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "identity-provider-redirector"
                }
            )
            
            # Add username password form
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "auth-username-password-form"
                }
            )
            
            # Add OTP form
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "auth-otp-form",
                    "requirement": "CONDITIONAL"
                }
            )
            
            logger.info(f"Browser authentication flow '{flow_alias}' configured successfully")
            
        except KeycloakError as e:
            logger.error(f"Error configuring browser flow: {e}")
            raise
    
    def configure_direct_grant_flow(self):
        """Configure direct grant flow for API authentication"""
        try:
            flow_alias = "remittance-direct-grant"
            self.keycloak_admin.create_authentication_flow(
                payload={
                    "alias": flow_alias,
                    "description": "Direct grant flow for API authentication",
                    "providerId": "basic-flow",
                    "topLevel": True,
                    "builtIn": False
                }
            )
            
            # Add username validation
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "direct-grant-validate-username"
                }
            )
            
            # Add password validation
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "direct-grant-validate-password"
                }
            )
            
            # Add OTP validation (conditional)
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "direct-grant-validate-otp",
                    "requirement": "CONDITIONAL"
                }
            )
            
            logger.info(f"Direct grant flow '{flow_alias}' configured successfully")
            
        except KeycloakError as e:
            logger.error(f"Error configuring direct grant flow: {e}")
            raise
    
    def configure_registration_flow(self):
        """Configure registration flow with email verification"""
        try:
            flow_alias = "remittance-registration"
            self.keycloak_admin.create_authentication_flow(
                payload={
                    "alias": flow_alias,
                    "description": "Registration flow with email verification",
                    "providerId": "basic-flow",
                    "topLevel": True,
                    "builtIn": False
                }
            )
            
            # Add registration page form
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "registration-page-form"
                }
            )
            
            # Add registration user creation
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "registration-user-creation"
                }
            )
            
            # Add registration profile action
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "registration-profile-action"
                }
            )
            
            # Add recaptcha
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "registration-recaptcha-action",
                    "requirement": "REQUIRED"
                }
            )
            
            logger.info(f"Registration flow '{flow_alias}' configured successfully")
            
        except KeycloakError as e:
            logger.error(f"Error configuring registration flow: {e}")
            raise
    
    def configure_reset_credentials_flow(self):
        """Configure reset credentials flow"""
        try:
            flow_alias = "remittance-reset-credentials"
            self.keycloak_admin.create_authentication_flow(
                payload={
                    "alias": flow_alias,
                    "description": "Reset credentials flow",
                    "providerId": "basic-flow",
                    "topLevel": True,
                    "builtIn": False
                }
            )
            
            # Add send reset email
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "reset-credentials-choose-user"
                }
            )
            
            # Add send email
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "reset-credential-email"
                }
            )
            
            # Add reset password
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "reset-password"
                }
            )
            
            # Add reset OTP (conditional)
            self.keycloak_admin.add_authenticator_execution(
                flow_alias=flow_alias,
                payload={
                    "provider": "reset-otp",
                    "requirement": "CONDITIONAL"
                }
            )
            
            logger.info(f"Reset credentials flow '{flow_alias}' configured successfully")
            
        except KeycloakError as e:
            logger.error(f"Error configuring reset credentials flow: {e}")
            raise
    
    def configure_all_flows(self):
        """Configure all authentication flows"""
        logger.info("Starting authentication flows configuration...")
        
        self.configure_browser_flow()
        self.configure_direct_grant_flow()
        self.configure_registration_flow()
        self.configure_reset_credentials_flow()
        
        logger.info("All authentication flows configured successfully")
    
    def set_default_flows(self):
        """Set default authentication flows for the realm"""
        try:
            self.keycloak_admin.update_realm(
                realm_name=self.realm_name,
                payload={
                    "browserFlow": "remittance-browser",
                    "directGrantFlow": "remittance-direct-grant",
                    "registrationFlow": "remittance-registration",
                    "resetCredentialsFlow": "remittance-reset-credentials"
                }
            )
            logger.info("Default authentication flows set successfully")
            
        except KeycloakError as e:
            logger.error(f"Error setting default flows: {e}")
            raise


def main():
    """Main function to configure authentication flows"""
    import os
    
    server_url = os.getenv("KEYCLOAK_URL", "http://localhost:8080")
    admin_username = os.getenv("KEYCLOAK_ADMIN", "admin")
    admin_password = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin")
    realm_name = os.getenv("KEYCLOAK_REALM", "remittance")
    
    configurator = AuthenticationFlowsConfigurator(
        server_url=server_url,
        admin_username=admin_username,
        admin_password=admin_password,
        realm_name=realm_name
    )
    
    configurator.configure_all_flows()
    configurator.set_default_flows()
    
    logger.info("Authentication flows configuration completed successfully")


if __name__ == "__main__":
    main()

