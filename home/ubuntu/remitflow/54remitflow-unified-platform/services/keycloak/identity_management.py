#!/usr/bin/env python3
"""
Keycloak Identity and Access Management Integration
Comprehensive authentication and authorization for Remittance Platform
"""

import json
import os
import requests
import jwt
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import logging
from datetime import datetime, timedelta
import base64
import hashlib
import secrets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class UserProfile:
    """User profile data structure"""
    user_id: str
    username: str
    email: str
    first_name: str
    last_name: str
    roles: List[str]
    attributes: Dict[str, Any]
    enabled: bool = True

@dataclass
class ClientConfig:
    """Keycloak client configuration"""
    client_id: str
    client_secret: str
    redirect_uris: List[str]
    web_origins: List[str]
    protocol: str = "openid-connect"

class KeycloakManager:
    """Comprehensive Keycloak Identity Management for Remittance Platform"""
    
    def __init__(self, server_url: str = "http://localhost:8080", realm: str = "remittance"):
        self.server_url = server_url.rstrip('/')
        self.realm = realm
        self.admin_username = os.getenv("KEYCLOAK_ADMIN_USER", "admin")
        self.admin_password = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "")
        self.admin_token = None
        self.admin_token_expires = None
        
    def get_admin_token(self) -> Optional[str]:
        """Get admin access token for Keycloak API operations"""
        if self.admin_token and self.admin_token_expires and datetime.now() < self.admin_token_expires:
            return self.admin_token
            
        token_url = f"{self.server_url}/realms/master/protocol/openid-connect/token"
        
        data = {
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": self.admin_username,
            "password": self.admin_password
        }
        
        try:
            response = requests.post(token_url, data=data)
            
            if response.status_code == 200:
                token_data = response.json()
                self.admin_token = token_data["access_token"]
                expires_in = token_data.get("expires_in", 3600)
                self.admin_token_expires = datetime.now() + timedelta(seconds=expires_in - 60)
                
                logger.info("✅ Admin token obtained successfully")
                return self.admin_token
            else:
                logger.error(f"❌ Failed to get admin token: {response.text}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error getting admin token: {str(e)}")
            return None
    
    def create_realm(self) -> bool:
        """Create Remittance Platform realm"""
        token = self.get_admin_token()
        if not token:
            return False
            
        realm_config = {
            "realm": self.realm,
            "displayName": "Remittance Platform",
            "displayNameHtml": "<div class=\"kc-logo-text\"><span>Remittance Platform</span></div>",
            "enabled": True,
            "sslRequired": "external",
            "registrationAllowed": True,
            "registrationEmailAsUsername": True,
            "rememberMe": True,
            "verifyEmail": True,
            "loginWithEmailAllowed": True,
            "duplicateEmailsAllowed": False,
            "resetPasswordAllowed": True,
            "editUsernameAllowed": False,
            "bruteForceProtected": True,
            "permanentLockout": False,
            "maxFailureWaitSeconds": 900,
            "minimumQuickLoginWaitSeconds": 60,
            "waitIncrementSeconds": 60,
            "quickLoginCheckMilliSeconds": 1000,
            "maxDeltaTimeSeconds": 43200,
            "failureFactor": 30,
            "defaultRoles": ["default-roles-remittance", "offline_access", "uma_authorization"],
            "requiredCredentials": ["password"],
            "passwordPolicy": "length(8) and digits(1) and lowerCase(1) and upperCase(1) and specialChars(1) and notUsername",
            "otpPolicyType": "totp",
            "otpPolicyAlgorithm": "HmacSHA1",
            "otpPolicyInitialCounter": 0,
            "otpPolicyDigits": 6,
            "otpPolicyLookAheadWindow": 1,
            "otpPolicyPeriod": 30,
            "otpSupportedApplications": ["FreeOTP", "Google Authenticator"],
            "webAuthnPolicyRpEntityName": "Remittance Platform",
            "webAuthnPolicySignatureAlgorithms": ["ES256"],
            "webAuthnPolicyRpId": "",
            "webAuthnPolicyAttestationConveyancePreference": "not specified",
            "webAuthnPolicyAuthenticatorAttachment": "not specified",
            "webAuthnPolicyRequireResidentKey": "not specified",
            "webAuthnPolicyUserVerificationRequirement": "not specified",
            "webAuthnPolicyCreateTimeout": 0,
            "webAuthnPolicyAvoidSameAuthenticatorRegister": False,
            "webAuthnPolicyAcceptableAaguids": [],
            "internationalizationEnabled": True,
            "supportedLocales": ["en", "ha", "yo", "ig"],
            "defaultLocale": "en",
            "smtpServer": {
                "password": "",
                "starttls": "false",
                "port": "587",
                "auth": "false",
                "host": "localhost",
                "replyToDisplayName": "Remittance Platform",
                "replyTo": "noreply@remittance-platform.ng",
                "fromDisplayName": "Remittance Platform",
                "from": "noreply@remittance-platform.ng",
                "envelopeFrom": "",
                "ssl": "false",
                "user": ""
            },
            "eventsEnabled": True,
            "eventsListeners": ["jboss-logging"],
            "enabledEventTypes": [
                "SEND_IDENTITY_PROVIDER_LINK", "SEND_VERIFY_EMAIL", "SEND_RESET_PASSWORD",
                "REMOVE_TOTP", "REVOKE_GRANT", "UPDATE_TOTP", "LOGIN_ERROR", "CLIENT_LOGIN",
                "RESET_PASSWORD_ERROR", "IMPERSONATE_ERROR", "CODE_TO_TOKEN_ERROR", "CUSTOM_REQUIRED_ACTION",
                "RESTART_AUTHENTICATION", "IMPERSONATE", "UPDATE_PROFILE_ERROR", "LOGIN", "UPDATE_PASSWORD_ERROR",
                "CLIENT_INITIATED_ACCOUNT_LINKING", "TOKEN_EXCHANGE", "LOGOUT", "REGISTER",
                "CLIENT_REGISTER", "IDENTITY_PROVIDER_LINK_ACCOUNT", "UPDATE_PASSWORD", "CLIENT_DELETE",
                "FEDERATED_IDENTITY_LINK", "IDENTITY_PROVIDER_FIRST_LOGIN", "CLIENT_DELETE_ERROR",
                "VERIFY_EMAIL", "CLIENT_LOGIN_ERROR", "RESTART_AUTHENTICATION_ERROR", "EXECUTE_ACTIONS",
                "REMOVE_FEDERATED_IDENTITY_ERROR", "TOKEN_EXCHANGE_ERROR", "PERMISSION_TOKEN",
                "SEND_IDENTITY_PROVIDER_LINK_ERROR", "EXECUTE_ACTION_TOKEN_ERROR", "SEND_VERIFY_EMAIL_ERROR",
                "EXECUTE_ACTIONS_ERROR", "REMOVE_FEDERATED_IDENTITY", "IDENTITY_PROVIDER_POST_LOGIN",
                "IDENTITY_PROVIDER_LINK_ACCOUNT_ERROR", "UPDATE_EMAIL", "REGISTER_ERROR", "REVOKE_GRANT_ERROR",
                "LOGOUT_ERROR", "UPDATE_EMAIL_ERROR", "CLIENT_UPDATE_ERROR", "UPDATE_PROFILE",
                "FEDERATED_IDENTITY_LINK_ERROR", "CLIENT_REGISTER_ERROR", "SEND_RESET_PASSWORD_ERROR",
                "CLIENT_UPDATE", "CUSTOM_REQUIRED_ACTION_ERROR", "IDENTITY_PROVIDER_POST_LOGIN_ERROR",
                "UPDATE_TOTP_ERROR", "CODE_TO_TOKEN", "VERIFY_EMAIL_ERROR", "CLIENT_INITIATED_ACCOUNT_LINKING_ERROR",
                "IDENTITY_PROVIDER_FIRST_LOGIN_ERROR", "REMOVE_TOTP_ERROR"
            ],
            "adminEventsEnabled": True,
            "adminEventsDetailsEnabled": True,
            "identityProviders": [],
            "identityProviderMappers": [],
            "components": {},
            "userManagedAccessAllowed": False,
            "clientProfiles": {
                "profiles": []
            },
            "clientPolicies": {
                "policies": []
            }
        }
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(
                f"{self.server_url}/admin/realms",
                headers=headers,
                json=realm_config
            )
            
            if response.status_code in [201, 409]:  # 409 if realm already exists
                logger.info(f"✅ Realm '{self.realm}' created successfully")
                return True
            else:
                logger.error(f"❌ Failed to create realm: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error creating realm: {str(e)}")
            return False
    
    def create_client(self, client_config: ClientConfig) -> bool:
        """Create Keycloak client for banking services"""
        token = self.get_admin_token()
        if not token:
            return False
            
        client_data = {
            "clientId": client_config.client_id,
            "name": client_config.client_id,
            "description": f"Remittance Platform - {client_config.client_id}",
            "enabled": True,
            "clientAuthenticatorType": "client-secret",
            "secret": client_config.client_secret,
            "redirectUris": client_config.redirect_uris,
            "webOrigins": client_config.web_origins,
            "notBefore": 0,
            "bearerOnly": False,
            "consentRequired": False,
            "standardFlowEnabled": True,
            "implicitFlowEnabled": False,
            "directAccessGrantsEnabled": True,
            "serviceAccountsEnabled": True,
            "publicClient": False,
            "frontchannelLogout": False,
            "protocol": client_config.protocol,
            "attributes": {
                "saml.assertion.signature": "false",
                "saml.force.post.binding": "false",
                "saml.multivalued.roles": "false",
                "saml.encrypt": "false",
                "saml.server.signature": "false",
                "saml.server.signature.keyinfo.ext": "false",
                "exclude.session.state.from.auth.response": "false",
                "saml_force_name_id_format": "false",
                "saml.client.signature": "false",
                "tls.client.certificate.bound.access.tokens": "false",
                "saml.authnstatement": "false",
                "display.on.consent.screen": "false",
                "saml.onetimeuse.condition": "false",
                "access.token.lifespan": "1800",
                "client_credentials.use_refresh_token": "false"
            },
            "authenticationFlowBindingOverrides": {},
            "fullScopeAllowed": True,
            "nodeReRegistrationTimeout": -1,
            "protocolMappers": [
                {
                    "name": "username",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-usermodel-property-mapper",
                    "consentRequired": False,
                    "config": {
                        "userinfo.token.claim": "true",
                        "user.attribute": "username",
                        "id.token.claim": "true",
                        "access.token.claim": "true",
                        "claim.name": "preferred_username",
                        "jsonType.label": "String"
                    }
                },
                {
                    "name": "email",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-usermodel-property-mapper",
                    "consentRequired": False,
                    "config": {
                        "userinfo.token.claim": "true",
                        "user.attribute": "email",
                        "id.token.claim": "true",
                        "access.token.claim": "true",
                        "claim.name": "email",
                        "jsonType.label": "String"
                    }
                },
                {
                    "name": "roles",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-usermodel-realm-role-mapper",
                    "consentRequired": False,
                    "config": {
                        "userinfo.token.claim": "true",
                        "id.token.claim": "true",
                        "access.token.claim": "true",
                        "claim.name": "roles",
                        "jsonType.label": "String",
                        "multivalued": "true"
                    }
                }
            ],
            "defaultClientScopes": [
                "web-origins", "role_list", "profile", "roles", "email"
            ],
            "optionalClientScopes": [
                "address", "phone", "offline_access", "microprofile-jwt"
            ]
        }
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(
                f"{self.server_url}/admin/realms/{self.realm}/clients",
                headers=headers,
                json=client_data
            )
            
            if response.status_code in [201, 409]:
                logger.info(f"✅ Client '{client_config.client_id}' created successfully")
                return True
            else:
                logger.error(f"❌ Failed to create client: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error creating client: {str(e)}")
            return False
    
    def create_roles(self) -> bool:
        """Create banking-specific roles"""
        token = self.get_admin_token()
        if not token:
            return False
            
        banking_roles = [
            {
                "name": "super-admin",
                "description": "Super Administrator with full system access",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "bank-admin",
                "description": "Bank Administrator with administrative privileges",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "agent-manager",
                "description": "Agent Manager with agent oversight capabilities",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "banking-agent",
                "description": "Banking Agent with transaction processing rights",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "customer",
                "description": "Customer with basic banking access",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "kyb-officer",
                "description": "KYB Officer with business verification rights",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "compliance-officer",
                "description": "Compliance Officer with regulatory oversight",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "fraud-analyst",
                "description": "Fraud Analyst with security monitoring access",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "insurance-agent",
                "description": "Insurance Agent with policy management rights",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            },
            {
                "name": "auditor",
                "description": "Auditor with read-only access to all systems",
                "composite": False,
                "clientRole": False,
                "containerId": self.realm
            }
        ]
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        success_count = 0
        for role in banking_roles:
            try:
                response = requests.post(
                    f"{self.server_url}/admin/realms/{self.realm}/roles",
                    headers=headers,
                    json=role
                )
                
                if response.status_code in [201, 409]:
                    logger.info(f"✅ Role '{role['name']}' created successfully")
                    success_count += 1
                else:
                    logger.error(f"❌ Failed to create role '{role['name']}': {response.text}")
                    
            except Exception as e:
                logger.error(f"❌ Error creating role '{role['name']}': {str(e)}")
        
        logger.info(f"✅ Successfully created {success_count}/{len(banking_roles)} roles")
        return success_count == len(banking_roles)
    
    def create_user(self, user_profile: UserProfile) -> bool:
        """Create user in Keycloak"""
        token = self.get_admin_token()
        if not token:
            return False
            
        user_data = {
            "username": user_profile.username,
            "email": user_profile.email,
            "firstName": user_profile.first_name,
            "lastName": user_profile.last_name,
            "enabled": user_profile.enabled,
            "emailVerified": True,
            "attributes": user_profile.attributes,
            "credentials": [
                {
                    "type": "password",
                    "value": "TempPassword123!",
                    "temporary": True
                }
            ],
            "realmRoles": user_profile.roles,
            "groups": []
        }
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(
                f"{self.server_url}/admin/realms/{self.realm}/users",
                headers=headers,
                json=user_data
            )
            
            if response.status_code in [201, 409]:
                logger.info(f"✅ User '{user_profile.username}' created successfully")
                return True
            else:
                logger.error(f"❌ Failed to create user: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error creating user: {str(e)}")
            return False
    
    def setup_banking_clients(self) -> bool:
        """Setup all banking service clients"""
        banking_clients = [
            ClientConfig(
                client_id="agent-portal",
                client_secret=secrets.token_urlsafe(32),
                redirect_uris=["http://localhost:3000/*", "http://localhost:9080/*"],
                web_origins=["http://localhost:3000", "http://localhost:9080"]
            ),
            ClientConfig(
                client_id="admin-dashboard",
                client_secret=secrets.token_urlsafe(32),
                redirect_uris=["http://localhost:3001/*", "http://localhost:9080/*"],
                web_origins=["http://localhost:3001", "http://localhost:9080"]
            ),
            ClientConfig(
                client_id="customer-portal",
                client_secret=secrets.token_urlsafe(32),
                redirect_uris=["http://localhost:3002/*", "http://localhost:9080/*"],
                web_origins=["http://localhost:3002", "http://localhost:9080"]
            ),
            ClientConfig(
                client_id="mobile-app",
                client_secret=secrets.token_urlsafe(32),
                redirect_uris=["http://localhost:3003/*", "remittance://callback"],
                web_origins=["http://localhost:3003"]
            ),
            ClientConfig(
                client_id="api-gateway",
                client_secret=secrets.token_urlsafe(32),
                redirect_uris=["http://localhost:9080/*"],
                web_origins=["http://localhost:9080"]
            ),
            ClientConfig(
                client_id="kyb-service",
                client_secret=secrets.token_urlsafe(32),
                redirect_uris=["http://localhost:8100/*"],
                web_origins=["http://localhost:8100"]
            ),
            ClientConfig(
                client_id="payment-orchestrator",
                client_secret=secrets.token_urlsafe(32),
                redirect_uris=["http://localhost:8090/*"],
                web_origins=["http://localhost:8090"]
            )
        ]
        
        success_count = 0
        for client in banking_clients:
            if self.create_client(client):
                success_count += 1
        
        logger.info(f"✅ Successfully created {success_count}/{len(banking_clients)} clients")
        return success_count == len(banking_clients)
    
    def create_sample_users(self) -> bool:
        """Create sample users for testing"""
        sample_users = [
            UserProfile(
                user_id="admin001",
                username="admin",
                email="admin@remittance-platform.ng",
                first_name="System",
                last_name="Administrator",
                roles=["super-admin", "bank-admin"],
                attributes={"department": ["IT"], "location": ["Lagos"]}
            ),
            UserProfile(
                user_id="agent001",
                username="agent.lagos.001",
                email="agent001@remittance-platform.ng",
                first_name="Adebayo",
                last_name="Johnson",
                roles=["banking-agent"],
                attributes={"agent_id": ["AGT001"], "location": ["Lagos"], "language": ["en", "yo"]}
            ),
            UserProfile(
                user_id="manager001",
                username="manager.southwest",
                email="manager001@remittance-platform.ng",
                first_name="Folake",
                last_name="Adeyemi",
                roles=["agent-manager"],
                attributes={"region": ["Southwest"], "location": ["Lagos"], "language": ["en", "yo"]}
            ),
            UserProfile(
                user_id="customer001",
                username="customer001",
                email="customer001@example.com",
                first_name="Chidi",
                last_name="Okafor",
                roles=["customer"],
                attributes={"customer_id": ["CUST001"], "location": ["Lagos"], "language": ["en", "ig"]}
            ),
            UserProfile(
                user_id="kyb001",
                username="kyb.officer.001",
                email="kyb001@remittance-platform.ng",
                first_name="Amina",
                last_name="Hassan",
                roles=["kyb-officer", "compliance-officer"],
                attributes={"department": ["Compliance"], "location": ["Abuja"], "language": ["en", "ha"]}
            )
        ]
        
        success_count = 0
        for user in sample_users:
            if self.create_user(user):
                success_count += 1
        
        logger.info(f"✅ Successfully created {success_count}/{len(sample_users)} sample users")
        return success_count == len(sample_users)
    
    def generate_docker_compose(self) -> str:
        """Generate Docker Compose configuration for Keycloak"""
        docker_compose = {
            "version": "3.8",
            "services": {
                "keycloak": {
                    "image": "quay.io/keycloak/keycloak:22.0.5",
                    "command": ["start-dev"],
                    "environment": [
                        "KEYCLOAK_ADMIN=admin",
                        "KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD}",
                        "KC_DB=postgres",
                        "KC_DB_URL=jdbc:postgresql://postgres:5432/keycloak",
                        "KC_DB_USERNAME=keycloak",
                        "KC_DB_PASSWORD=${KEYCLOAK_DB_PASSWORD}",
                        "KC_HOSTNAME=localhost",
                        "KC_HOSTNAME_PORT=8080",
                        "KC_HTTP_ENABLED=true",
                        "KC_HOSTNAME_STRICT_HTTPS=false",
                        "KC_HOSTNAME_STRICT=false",
                        "KC_LOG_LEVEL=INFO",
                        "KC_METRICS_ENABLED=true",
                        "KC_HEALTH_ENABLED=true"
                    ],
                    "ports": ["8080:8080"],
                    "depends_on": ["postgres"],
                    "networks": ["keycloak"],
                    "volumes": [
                        "keycloak_data:/opt/keycloak/data"
                    ]
                },
                "postgres": {
                    "image": "postgres:15-alpine",
                    "environment": [
                        "POSTGRES_DB=keycloak",
                        "POSTGRES_USER=keycloak",
                        "POSTGRES_PASSWORD=${KEYCLOAK_DB_PASSWORD}"
                    ],
                    "ports": ["5433:5432"],
                    "networks": ["keycloak"],
                    "volumes": [
                        "postgres_data:/var/lib/postgresql/data"
                    ]
                }
            },
            "networks": {
                "keycloak": {
                    "driver": "bridge"
                }
            },
            "volumes": {
                "keycloak_data": {"driver": "local"},
                "postgres_data": {"driver": "local"}
            }
        }
        
        return yaml.dump(docker_compose, default_flow_style=False)
    
    def deploy_complete_setup(self) -> bool:
        """Deploy complete Keycloak setup for Remittance Platform"""
        logger.info("🚀 Deploying Keycloak Identity Management Setup...")
        
        try:
            # Create realm
            if not self.create_realm():
                return False
            
            # Create roles
            if not self.create_roles():
                return False
            
            # Setup clients
            if not self.setup_banking_clients():
                return False
            
            # Create sample users
            if not self.create_sample_users():
                return False
            
            # Generate Docker Compose
            docker_compose_content = self.generate_docker_compose()
            with open("/tmp/docker-compose-keycloak.yaml", "w") as f:
                f.write(docker_compose_content)
            
            logger.info("✅ Keycloak setup completed successfully!")
            logger.info("📁 Configuration files saved to /tmp/")
            logger.info("🔐 Keycloak Admin Console: http://localhost:8080")
            logger.info("👤 Admin credentials: admin / <set KEYCLOAK_ADMIN_PASSWORD>")
            logger.info(f"🏦 Banking Realm: {self.realm}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error deploying Keycloak setup: {str(e)}")
            return False

def main():
    """Main function to setup Keycloak Identity Management"""
    print("🔐 Remittance Platform - Keycloak Identity Management Setup")
    print("=" * 65)
    
    keycloak = KeycloakManager()
    
    if keycloak.deploy_complete_setup():
        print("\n✅ Keycloak Identity Management configured successfully!")
        print("\n📋 Next Steps:")
        print("1. Start Keycloak: docker-compose -f /tmp/docker-compose-keycloak.yaml up -d")
        print("2. Access Admin Console: http://localhost:8080")
        print("3. Login with: admin / <set KEYCLOAK_ADMIN_PASSWORD>")
        print("4. Switch to 'remittance' realm")
        print("5. Configure additional settings as needed")
    else:
        print("\n❌ Failed to configure Keycloak Identity Management")
        return 1
    
    return 0

if __name__ == "__main__":
    import yaml
    exit(main())

