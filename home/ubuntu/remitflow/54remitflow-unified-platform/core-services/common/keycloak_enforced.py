"""
Keycloak Enforced Authentication

Production-grade Keycloak integration with NO fallback to local JWT.
This module enforces Keycloak authentication for all protected endpoints.

Features:
- Mandatory Keycloak token validation
- OIDC/OAuth2 compliance
- Role-based access control
- Token refresh handling
- Service-to-service authentication
- Realm and client management

Reference: https://www.keycloak.org/docs/latest/
"""

import os
import logging
import asyncio
import httpx
from typing import Dict, Any, Optional, List, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
from functools import wraps
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

# Configuration - REQUIRED in production
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "remittance-platform")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "remittance-api")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")
KEYCLOAK_ADMIN_CLIENT_ID = os.getenv("KEYCLOAK_ADMIN_CLIENT_ID", "admin-cli")
KEYCLOAK_ADMIN_CLIENT_SECRET = os.getenv("KEYCLOAK_ADMIN_CLIENT_SECRET")

# Enforce Keycloak - NO FALLBACK
KEYCLOAK_ENFORCED = os.getenv("KEYCLOAK_ENFORCED", "true").lower() == "true"

# Token validation settings
TOKEN_VERIFY_AUDIENCE = os.getenv("TOKEN_VERIFY_AUDIENCE", "true").lower() == "true"
TOKEN_VERIFY_ISSUER = os.getenv("TOKEN_VERIFY_ISSUER", "true").lower() == "true"
TOKEN_LEEWAY_SECONDS = int(os.getenv("TOKEN_LEEWAY_SECONDS", "30"))


class AuthenticationError(Exception):
    """Authentication error"""
    pass


class AuthorizationError(Exception):
    """Authorization error"""
    pass


class KeycloakRole(str, Enum):
    """Keycloak roles for the platform"""
    USER = "user"
    ADMIN = "admin"
    SUPPORT = "support"
    COMPLIANCE = "compliance"
    SERVICE = "service"
    OPERATOR = "operator"
    AUDITOR = "auditor"


@dataclass
class TokenInfo:
    """Parsed token information"""
    sub: str  # Subject (user ID)
    email: Optional[str] = None
    name: Optional[str] = None
    preferred_username: Optional[str] = None
    realm_roles: List[str] = field(default_factory=list)
    client_roles: Dict[str, List[str]] = field(default_factory=dict)
    scope: str = ""
    exp: int = 0
    iat: int = 0
    iss: str = ""
    aud: List[str] = field(default_factory=list)
    azp: str = ""  # Authorized party (client ID)
    session_state: Optional[str] = None
    acr: str = ""  # Authentication context class reference
    custom_claims: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def user_id(self) -> str:
        return self.sub
    
    @property
    def roles(self) -> Set[str]:
        """Get all roles (realm + client)"""
        all_roles = set(self.realm_roles)
        for client_roles in self.client_roles.values():
            all_roles.update(client_roles)
        return all_roles
    
    def has_role(self, role: str) -> bool:
        """Check if user has a specific role"""
        return role in self.roles
    
    def has_any_role(self, roles: List[str]) -> bool:
        """Check if user has any of the specified roles"""
        return bool(self.roles.intersection(roles))
    
    def has_all_roles(self, roles: List[str]) -> bool:
        """Check if user has all of the specified roles"""
        return set(roles).issubset(self.roles)
    
    @property
    def is_admin(self) -> bool:
        return self.has_role(KeycloakRole.ADMIN.value)
    
    @property
    def is_service(self) -> bool:
        return self.has_role(KeycloakRole.SERVICE.value)
    
    @property
    def is_expired(self) -> bool:
        return datetime.now(timezone.utc).timestamp() > self.exp


class KeycloakClient:
    """
    Keycloak client for authentication and authorization
    
    This client ENFORCES Keycloak authentication with no fallback.
    If Keycloak is unavailable, requests will fail.
    """
    
    def __init__(self):
        self.base_url = KEYCLOAK_URL
        self.realm = KEYCLOAK_REALM
        self.client_id = KEYCLOAK_CLIENT_ID
        self.client_secret = KEYCLOAK_CLIENT_SECRET
        self.enforced = KEYCLOAK_ENFORCED
        
        self._jwks_client: Optional[PyJWKClient] = None
        self._http_client: Optional[httpx.AsyncClient] = None
        self._realm_public_key: Optional[str] = None
        self._issuer: Optional[str] = None
        self._initialized = False
        
        # Validate configuration
        if self.enforced and not self.base_url:
            raise ValueError("KEYCLOAK_URL is required when KEYCLOAK_ENFORCED=true")
    
    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client
    
    async def close(self):
        """Close the HTTP client"""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
    
    async def initialize(self):
        """Initialize the Keycloak client"""
        if self._initialized:
            return
        
        if not self.enforced:
            logger.warning("Keycloak enforcement disabled - this is NOT recommended for production")
            self._initialized = True
            return
        
        try:
            # Fetch OIDC configuration
            client = await self._get_http_client()
            
            oidc_url = f"{self.base_url}/realms/{self.realm}/.well-known/openid-configuration"
            response = await client.get(oidc_url)
            
            if response.status_code != 200:
                raise AuthenticationError(f"Failed to fetch OIDC configuration: {response.status_code}")
            
            oidc_config = response.json()
            self._issuer = oidc_config.get("issuer")
            jwks_uri = oidc_config.get("jwks_uri")
            
            # Initialize JWKS client for token verification
            self._jwks_client = PyJWKClient(jwks_uri)
            
            logger.info(f"Keycloak client initialized for realm: {self.realm}")
            self._initialized = True
            
        except Exception as e:
            logger.error(f"Failed to initialize Keycloak client: {e}")
            raise AuthenticationError(f"Keycloak initialization failed: {e}")
    
    async def validate_token(self, token: str) -> TokenInfo:
        """
        Validate a Keycloak access token
        
        Args:
            token: The JWT access token
            
        Returns:
            TokenInfo with parsed claims
            
        Raises:
            AuthenticationError: If token is invalid
        """
        if not self._initialized:
            await self.initialize()
        
        if not self.enforced:
            # Parse token without verification (NOT for production)
            try:
                claims = jwt.decode(token, options={"verify_signature": False})
                return self._parse_claims(claims)
            except Exception as e:
                raise AuthenticationError(f"Invalid token: {e}")
        
        try:
            # Get signing key from JWKS
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            
            # Verify and decode token
            options = {
                "verify_signature": True,
                "verify_exp": True,
                "verify_iat": True,
                "require": ["exp", "iat", "sub"]
            }
            
            if TOKEN_VERIFY_AUDIENCE:
                options["verify_aud"] = True
            if TOKEN_VERIFY_ISSUER:
                options["verify_iss"] = True
            
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=self.client_id if TOKEN_VERIFY_AUDIENCE else None,
                issuer=self._issuer if TOKEN_VERIFY_ISSUER else None,
                leeway=TOKEN_LEEWAY_SECONDS,
                options=options
            )
            
            return self._parse_claims(claims)
            
        except jwt.ExpiredSignatureError:
            raise AuthenticationError("Token has expired")
        except jwt.InvalidAudienceError:
            raise AuthenticationError("Invalid token audience")
        except jwt.InvalidIssuerError:
            raise AuthenticationError("Invalid token issuer")
        except jwt.InvalidTokenError as e:
            raise AuthenticationError(f"Invalid token: {e}")
        except Exception as e:
            logger.error(f"Token validation error: {e}")
            raise AuthenticationError(f"Token validation failed: {e}")
    
    def _parse_claims(self, claims: Dict[str, Any]) -> TokenInfo:
        """Parse JWT claims into TokenInfo"""
        # Extract realm roles
        realm_access = claims.get("realm_access", {})
        realm_roles = realm_access.get("roles", [])
        
        # Extract client roles
        resource_access = claims.get("resource_access", {})
        client_roles = {}
        for client, access in resource_access.items():
            client_roles[client] = access.get("roles", [])
        
        # Extract audience
        aud = claims.get("aud", [])
        if isinstance(aud, str):
            aud = [aud]
        
        return TokenInfo(
            sub=claims.get("sub", ""),
            email=claims.get("email"),
            name=claims.get("name"),
            preferred_username=claims.get("preferred_username"),
            realm_roles=realm_roles,
            client_roles=client_roles,
            scope=claims.get("scope", ""),
            exp=claims.get("exp", 0),
            iat=claims.get("iat", 0),
            iss=claims.get("iss", ""),
            aud=aud,
            azp=claims.get("azp", ""),
            session_state=claims.get("session_state"),
            acr=claims.get("acr", ""),
            custom_claims={k: v for k, v in claims.items() if k not in [
                "sub", "email", "name", "preferred_username", "realm_access",
                "resource_access", "scope", "exp", "iat", "iss", "aud", "azp",
                "session_state", "acr"
            ]}
        )
    
    async def get_service_token(self) -> str:
        """
        Get a service account token for service-to-service authentication
        
        Returns:
            Access token for service account
        """
        if not self.enforced:
            # Return a mock token for development
            return "mock-service-token"
        
        if not self.client_secret:
            raise AuthenticationError("KEYCLOAK_CLIENT_SECRET is required for service tokens")
        
        try:
            client = await self._get_http_client()
            
            token_url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/token"
            
            response = await client.post(
                token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret
                }
            )
            
            if response.status_code != 200:
                raise AuthenticationError(f"Failed to get service token: {response.status_code}")
            
            data = response.json()
            return data.get("access_token")
            
        except Exception as e:
            logger.error(f"Failed to get service token: {e}")
            raise AuthenticationError(f"Service token request failed: {e}")
    
    async def refresh_token(self, refresh_token: str) -> Dict[str, str]:
        """
        Refresh an access token
        
        Args:
            refresh_token: The refresh token
            
        Returns:
            New access_token and refresh_token
        """
        if not self.enforced:
            raise AuthenticationError("Token refresh not available in non-enforced mode")
        
        try:
            client = await self._get_http_client()
            
            token_url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/token"
            
            response = await client.post(
                token_url,
                data={
                    "grant_type": "refresh_token",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": refresh_token
                }
            )
            
            if response.status_code != 200:
                raise AuthenticationError(f"Token refresh failed: {response.status_code}")
            
            data = response.json()
            return {
                "access_token": data.get("access_token"),
                "refresh_token": data.get("refresh_token"),
                "expires_in": data.get("expires_in")
            }
            
        except Exception as e:
            logger.error(f"Token refresh error: {e}")
            raise AuthenticationError(f"Token refresh failed: {e}")
    
    async def logout(self, refresh_token: str):
        """
        Logout a user (invalidate tokens)
        
        Args:
            refresh_token: The refresh token to invalidate
        """
        if not self.enforced:
            return
        
        try:
            client = await self._get_http_client()
            
            logout_url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/logout"
            
            await client.post(
                logout_url,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": refresh_token
                }
            )
            
        except Exception as e:
            logger.warning(f"Logout error: {e}")
    
    async def introspect_token(self, token: str) -> Dict[str, Any]:
        """
        Introspect a token (check if active)
        
        Args:
            token: The token to introspect
            
        Returns:
            Token introspection response
        """
        if not self.enforced:
            return {"active": True}
        
        try:
            client = await self._get_http_client()
            
            introspect_url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/token/introspect"
            
            response = await client.post(
                introspect_url,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "token": token
                }
            )
            
            if response.status_code != 200:
                return {"active": False}
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Token introspection error: {e}")
            return {"active": False}


# ==================== FastAPI Integration ====================

security = HTTPBearer()

_keycloak_client: Optional[KeycloakClient] = None


def get_keycloak_client() -> KeycloakClient:
    """Get the global Keycloak client instance"""
    global _keycloak_client
    if _keycloak_client is None:
        _keycloak_client = KeycloakClient()
    return _keycloak_client


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> TokenInfo:
    """
    FastAPI dependency to get the current authenticated user
    
    Raises:
        HTTPException: If authentication fails
    """
    client = get_keycloak_client()
    
    try:
        token_info = await client.validate_token(credentials.credentials)
        return token_info
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=str(e))


async def get_current_user_optional(
    request: Request
) -> Optional[TokenInfo]:
    """
    FastAPI dependency to optionally get the current user
    
    Returns None if no valid token is present
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    
    token = auth_header.split(" ", 1)[1]
    client = get_keycloak_client()
    
    try:
        return await client.validate_token(token)
    except AuthenticationError:
        return None


def require_roles(*roles: str):
    """
    FastAPI dependency factory to require specific roles
    
    Usage:
        @app.get("/admin")
        async def admin_endpoint(user: TokenInfo = Depends(require_roles("admin"))):
            ...
    """
    async def dependency(
        credentials: HTTPAuthorizationCredentials = Depends(security)
    ) -> TokenInfo:
        client = get_keycloak_client()
        
        try:
            token_info = await client.validate_token(credentials.credentials)
        except AuthenticationError as e:
            raise HTTPException(status_code=401, detail=str(e))
        
        if not token_info.has_any_role(list(roles)):
            raise HTTPException(
                status_code=403,
                detail=f"Required roles: {', '.join(roles)}"
            )
        
        return token_info
    
    return dependency


def require_all_roles(*roles: str):
    """
    FastAPI dependency factory to require ALL specified roles
    """
    async def dependency(
        credentials: HTTPAuthorizationCredentials = Depends(security)
    ) -> TokenInfo:
        client = get_keycloak_client()
        
        try:
            token_info = await client.validate_token(credentials.credentials)
        except AuthenticationError as e:
            raise HTTPException(status_code=401, detail=str(e))
        
        if not token_info.has_all_roles(list(roles)):
            raise HTTPException(
                status_code=403,
                detail=f"Required all roles: {', '.join(roles)}"
            )
        
        return token_info
    
    return dependency


# ==================== Service Client ====================

class KeycloakServiceClient:
    """
    HTTP client with automatic Keycloak service authentication
    
    Use this for service-to-service communication
    """
    
    def __init__(self, base_url: str):
        self.base_url = base_url
        self._keycloak = get_keycloak_client()
        self._token: Optional[str] = None
        self._token_expires: Optional[datetime] = None
        self._http_client: Optional[httpx.AsyncClient] = None
    
    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=30.0
            )
        return self._http_client
    
    async def _ensure_token(self):
        """Ensure we have a valid service token"""
        now = datetime.now(timezone.utc)
        
        if self._token and self._token_expires and now < self._token_expires:
            return
        
        self._token = await self._keycloak.get_service_token()
        # Assume token expires in 5 minutes, refresh 1 minute early
        self._token_expires = now + timedelta(minutes=4)
    
    async def request(
        self,
        method: str,
        path: str,
        **kwargs
    ) -> httpx.Response:
        """Make an authenticated request"""
        await self._ensure_token()
        
        client = await self._get_http_client()
        
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {self._token}"
        
        return await client.request(method, path, headers=headers, **kwargs)
    
    async def get(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("GET", path, **kwargs)
    
    async def post(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("POST", path, **kwargs)
    
    async def put(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("PUT", path, **kwargs)
    
    async def delete(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("DELETE", path, **kwargs)
    
    async def close(self):
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None


# ==================== Keycloak Admin Client ====================

class KeycloakAdminClient:
    """
    Keycloak Admin client for user and role management
    """
    
    def __init__(self):
        self.base_url = KEYCLOAK_URL
        self.realm = KEYCLOAK_REALM
        self.admin_client_id = KEYCLOAK_ADMIN_CLIENT_ID
        self.admin_client_secret = KEYCLOAK_ADMIN_CLIENT_SECRET
        self._token: Optional[str] = None
        self._token_expires: Optional[datetime] = None
        self._http_client: Optional[httpx.AsyncClient] = None
    
    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client
    
    async def _ensure_admin_token(self):
        """Get admin access token"""
        now = datetime.now(timezone.utc)
        
        if self._token and self._token_expires and now < self._token_expires:
            return
        
        client = await self._get_http_client()
        
        response = await client.post(
            f"{self.base_url}/realms/master/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.admin_client_id,
                "client_secret": self.admin_client_secret
            }
        )
        
        if response.status_code != 200:
            raise AuthenticationError("Failed to get admin token")
        
        data = response.json()
        self._token = data.get("access_token")
        self._token_expires = now + timedelta(seconds=data.get("expires_in", 300) - 60)
    
    async def create_user(
        self,
        username: str,
        email: str,
        password: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        roles: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new user in Keycloak"""
        await self._ensure_admin_token()
        
        client = await self._get_http_client()
        
        user_data = {
            "username": username,
            "email": email,
            "enabled": True,
            "emailVerified": False,
            "credentials": [{
                "type": "password",
                "value": password,
                "temporary": False
            }]
        }
        
        if first_name:
            user_data["firstName"] = first_name
        if last_name:
            user_data["lastName"] = last_name
        
        response = await client.post(
            f"{self.base_url}/admin/realms/{self.realm}/users",
            json=user_data,
            headers={"Authorization": f"Bearer {self._token}"}
        )
        
        if response.status_code == 201:
            # Get user ID from location header
            location = response.headers.get("Location", "")
            user_id = location.split("/")[-1]
            
            # Assign roles if specified
            if roles:
                await self.assign_roles(user_id, roles)
            
            return {"success": True, "user_id": user_id}
        else:
            return {"success": False, "error": response.text}
    
    async def assign_roles(self, user_id: str, roles: List[str]) -> Dict[str, Any]:
        """Assign realm roles to a user"""
        await self._ensure_admin_token()
        
        client = await self._get_http_client()
        
        # Get available realm roles
        roles_response = await client.get(
            f"{self.base_url}/admin/realms/{self.realm}/roles",
            headers={"Authorization": f"Bearer {self._token}"}
        )
        
        if roles_response.status_code != 200:
            return {"success": False, "error": "Failed to get roles"}
        
        available_roles = roles_response.json()
        roles_to_assign = [r for r in available_roles if r["name"] in roles]
        
        if not roles_to_assign:
            return {"success": False, "error": "No matching roles found"}
        
        # Assign roles
        response = await client.post(
            f"{self.base_url}/admin/realms/{self.realm}/users/{user_id}/role-mappings/realm",
            json=roles_to_assign,
            headers={"Authorization": f"Bearer {self._token}"}
        )
        
        if response.status_code == 204:
            return {"success": True}
        else:
            return {"success": False, "error": response.text}
    
    async def close(self):
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None


# ==================== Convenience Functions ====================

async def validate_token(token: str) -> TokenInfo:
    """Validate a token and return user info"""
    client = get_keycloak_client()
    return await client.validate_token(token)


async def get_service_token() -> str:
    """Get a service account token"""
    client = get_keycloak_client()
    return await client.get_service_token()


def create_service_client(base_url: str) -> KeycloakServiceClient:
    """Create a service client for authenticated requests"""
    return KeycloakServiceClient(base_url)
