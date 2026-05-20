"""
Keycloak OAuth2/OIDC Clients Configuration
Configures clients for the Nigerian Remittance Platform
"""

from keycloak import KeycloakAdmin
from keycloak.exceptions import KeycloakError
import logging
import uuid

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ClientsConfigurator:
    """Configure Keycloak OAuth2/OIDC clients"""
    
    def __init__(self, server_url: str, admin_username: str, admin_password: str, realm_name: str = "remittance"):
        """
        Initialize clients configurator
        
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
    
    def create_frontend_client(self):
        """Create frontend React application client"""
        try:
            client_id = "remittance-frontend"
            client_payload = {
                "clientId": client_id,
                "name": "Remittance Frontend Application",
                "description": "React frontend application for remittance platform",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "redirectUris": [
                    "http://localhost:3000/*",
                    "https://app.remittance-platform.ng/*",
                    "https://remittance-platform.ng/*"
                ],
                "webOrigins": [
                    "http://localhost:3000",
                    "https://app.remittance-platform.ng",
                    "https://remittance-platform.ng"
                ],
                "publicClient": True,
                "protocol": "openid-connect",
                "standardFlowEnabled": True,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "serviceAccountsEnabled": False,
                "authorizationServicesEnabled": False,
                "fullScopeAllowed": True,
                "frontchannelLogout": True,
                "attributes": {
                    "pkce.code.challenge.method": "S256",
                    "post.logout.redirect.uris": "+"
                },
                "defaultClientScopes": [
                    "web-origins",
                    "acr",
                    "profile",
                    "roles",
                    "email"
                ],
                "optionalClientScopes": [
                    "address",
                    "phone",
                    "offline_access",
                    "microprofile-jwt"
                ]
            }
            
            self.keycloak_admin.create_client(payload=client_payload)
            logger.info(f"Frontend client '{client_id}' created successfully")
            
        except KeycloakError as e:
            logger.error(f"Error creating frontend client: {e}")
            raise
    
    def create_backend_api_client(self):
        """Create backend API service client"""
        try:
            client_id = "remittance-backend-api"
            client_secret = str(uuid.uuid4())
            
            client_payload = {
                "clientId": client_id,
                "name": "Remittance Backend API",
                "description": "Backend API service for remittance platform",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "secret": client_secret,
                "redirectUris": [],
                "webOrigins": [],
                "publicClient": False,
                "protocol": "openid-connect",
                "standardFlowEnabled": False,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": True,
                "serviceAccountsEnabled": True,
                "authorizationServicesEnabled": True,
                "fullScopeAllowed": True,
                "attributes": {
                    "access.token.lifespan": "1800"
                },
                "defaultClientScopes": [
                    "web-origins",
                    "acr",
                    "profile",
                    "roles",
                    "email"
                ]
            }
            
            self.keycloak_admin.create_client(payload=client_payload)
            logger.info(f"Backend API client '{client_id}' created successfully")
            logger.info(f"Client secret: {client_secret}")
            
            return client_secret
            
        except KeycloakError as e:
            logger.error(f"Error creating backend API client: {e}")
            raise
    
    def create_mobile_app_client(self):
        """Create mobile application client"""
        try:
            client_id = "remittance-mobile-app"
            
            client_payload = {
                "clientId": client_id,
                "name": "Remittance Mobile Application",
                "description": "Mobile application for remittance platform",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "redirectUris": [
                    "remittanceapp://oauth/callback",
                    "com.remittance.app://oauth/callback"
                ],
                "webOrigins": [],
                "publicClient": True,
                "protocol": "openid-connect",
                "standardFlowEnabled": True,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": True,
                "serviceAccountsEnabled": False,
                "authorizationServicesEnabled": False,
                "fullScopeAllowed": True,
                "attributes": {
                    "pkce.code.challenge.method": "S256",
                    "post.logout.redirect.uris": "+"
                },
                "defaultClientScopes": [
                    "web-origins",
                    "acr",
                    "profile",
                    "roles",
                    "email"
                ],
                "optionalClientScopes": [
                    "address",
                    "phone",
                    "offline_access"
                ]
            }
            
            self.keycloak_admin.create_client(payload=client_payload)
            logger.info(f"Mobile app client '{client_id}' created successfully")
            
        except KeycloakError as e:
            logger.error(f"Error creating mobile app client: {e}")
            raise
    
    def create_admin_console_client(self):
        """Create admin console client"""
        try:
            client_id = "remittance-admin-console"
            
            client_payload = {
                "clientId": client_id,
                "name": "Remittance Admin Console",
                "description": "Admin console for remittance platform",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "redirectUris": [
                    "http://localhost:3001/*",
                    "https://admin.remittance-platform.ng/*"
                ],
                "webOrigins": [
                    "http://localhost:3001",
                    "https://admin.remittance-platform.ng"
                ],
                "publicClient": True,
                "protocol": "openid-connect",
                "standardFlowEnabled": True,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "serviceAccountsEnabled": False,
                "authorizationServicesEnabled": False,
                "fullScopeAllowed": True,
                "frontchannelLogout": True,
                "attributes": {
                    "pkce.code.challenge.method": "S256",
                    "post.logout.redirect.uris": "+"
                },
                "defaultClientScopes": [
                    "web-origins",
                    "acr",
                    "profile",
                    "roles",
                    "email"
                ]
            }
            
            self.keycloak_admin.create_client(payload=client_payload)
            logger.info(f"Admin console client '{client_id}' created successfully")
            
        except KeycloakError as e:
            logger.error(f"Error creating admin console client: {e}")
            raise
    
    def create_mojaloop_service_client(self):
        """Create Mojaloop service client"""
        try:
            client_id = "mojaloop-service"
            client_secret = str(uuid.uuid4())
            
            client_payload = {
                "clientId": client_id,
                "name": "Mojaloop Service",
                "description": "Mojaloop payment switch service",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "secret": client_secret,
                "redirectUris": [],
                "webOrigins": [],
                "publicClient": False,
                "protocol": "openid-connect",
                "standardFlowEnabled": False,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": True,
                "serviceAccountsEnabled": True,
                "authorizationServicesEnabled": True,
                "fullScopeAllowed": True,
                "attributes": {
                    "access.token.lifespan": "3600"
                }
            }
            
            self.keycloak_admin.create_client(payload=client_payload)
            logger.info(f"Mojaloop service client '{client_id}' created successfully")
            logger.info(f"Client secret: {client_secret}")
            
            return client_secret
            
        except KeycloakError as e:
            logger.error(f"Error creating Mojaloop service client: {e}")
            raise
    
    def create_temporal_service_client(self):
        """Create Temporal service client"""
        try:
            client_id = "temporal-service"
            client_secret = str(uuid.uuid4())
            
            client_payload = {
                "clientId": client_id,
                "name": "Temporal Workflow Service",
                "description": "Temporal workflow orchestration service",
                "enabled": True,
                "clientAuthenticatorType": "client-secret",
                "secret": client_secret,
                "redirectUris": [],
                "webOrigins": [],
                "publicClient": False,
                "protocol": "openid-connect",
                "standardFlowEnabled": False,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": True,
                "serviceAccountsEnabled": True,
                "authorizationServicesEnabled": True,
                "fullScopeAllowed": True
            }
            
            self.keycloak_admin.create_client(payload=client_payload)
            logger.info(f"Temporal service client '{client_id}' created successfully")
            logger.info(f"Client secret: {client_secret}")
            
            return client_secret
            
        except KeycloakError as e:
            logger.error(f"Error creating Temporal service client: {e}")
            raise
    
    def create_all_clients(self):
        """Create all OAuth2/OIDC clients"""
        logger.info("Starting clients configuration...")
        
        self.create_frontend_client()
        backend_secret = self.create_backend_api_client()
        self.create_mobile_app_client()
        self.create_admin_console_client()
        mojaloop_secret = self.create_mojaloop_service_client()
        temporal_secret = self.create_temporal_service_client()
        
        logger.info("All clients configured successfully")
        
        # Return secrets for secure storage
        return {
            "backend_api": backend_secret,
            "mojaloop_service": mojaloop_secret,
            "temporal_service": temporal_secret
        }


def main():
    """Main function to configure clients"""
    import os
    import json
    
    server_url = os.getenv("KEYCLOAK_URL", "http://localhost:8080")
    admin_username = os.getenv("KEYCLOAK_ADMIN", "admin")
    admin_password = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin")
    realm_name = os.getenv("KEYCLOAK_REALM", "remittance")
    
    configurator = ClientsConfigurator(
        server_url=server_url,
        admin_username=admin_username,
        admin_password=admin_password,
        realm_name=realm_name
    )
    
    secrets = configurator.create_all_clients()
    
    # Save secrets to file (should be stored securely in production)
    with open("/tmp/keycloak_client_secrets.json", "w") as f:
        json.dump(secrets, f, indent=2)
    
    logger.info("Clients configuration completed successfully")
    logger.info("Client secrets saved to /tmp/keycloak_client_secrets.json")


if __name__ == "__main__":
    main()

