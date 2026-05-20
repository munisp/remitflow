"""
OAuth2/JWT Authentication Middleware for All Services
Provides token validation, role-based access control, and service-to-service auth
"""

from fastapi import HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordBearer
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import jwt
import os
import logging
import httpx
from functools import wraps

logger = logging.getLogger(__name__)

# Configuration
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "remittance")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "remittance-api")

# Security schemes
bearer_scheme = HTTPBearer(auto_error=False)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)


class UserRole(str, Enum):
    """User roles for RBAC"""
    USER = "user"
    ADMIN = "admin"
    SUPPORT = "support"
    COMPLIANCE = "compliance"
    SERVICE = "service"  # For service-to-service auth


class TokenType(str, Enum):
    """Token types"""
    ACCESS = "access"
    REFRESH = "refresh"
    SERVICE = "service"


class TokenPayload(BaseModel):
    """JWT token payload"""
    sub: str  # Subject (user_id or service_id)
    exp: datetime
    iat: datetime
    type: TokenType = TokenType.ACCESS
    roles: List[str] = []
    permissions: List[str] = []
    metadata: Dict[str, Any] = {}


class AuthenticatedUser(BaseModel):
    """Authenticated user context"""
    user_id: str
    roles: List[str]
    permissions: List[str]
    token_type: TokenType
    metadata: Dict[str, Any] = {}
    
    def has_role(self, role: str) -> bool:
        return role in self.roles or UserRole.ADMIN in self.roles
    
    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions or UserRole.ADMIN in self.roles
    
    def is_admin(self) -> bool:
        return UserRole.ADMIN in self.roles
    
    def is_service(self) -> bool:
        return self.token_type == TokenType.SERVICE


class AuthenticationError(HTTPException):
    """Authentication error"""
    def __init__(self, detail: str = "Authentication required"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"}
        )


class AuthorizationError(HTTPException):
    """Authorization error"""
    def __init__(self, detail: str = "Insufficient permissions"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail
        )


def create_access_token(
    user_id: str,
    roles: List[str] = None,
    permissions: List[str] = None,
    metadata: Dict[str, Any] = None,
    expires_delta: timedelta = None
) -> str:
    """Create JWT access token"""
    if expires_delta is None:
        expires_delta = timedelta(hours=JWT_EXPIRATION_HOURS)
    
    now = datetime.utcnow()
    payload = {
        "sub": user_id,
        "exp": now + expires_delta,
        "iat": now,
        "type": TokenType.ACCESS,
        "roles": roles or [],
        "permissions": permissions or [],
        "metadata": metadata or {}
    }
    
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_service_token(
    service_id: str,
    permissions: List[str] = None,
    expires_delta: timedelta = None
) -> str:
    """Create service-to-service token"""
    if expires_delta is None:
        expires_delta = timedelta(hours=1)  # Short-lived for services
    
    now = datetime.utcnow()
    payload = {
        "sub": service_id,
        "exp": now + expires_delta,
        "iat": now,
        "type": TokenType.SERVICE,
        "roles": [UserRole.SERVICE],
        "permissions": permissions or ["*"],
        "metadata": {"service": True}
    }
    
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> TokenPayload:
    """Decode and validate JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return TokenPayload(**payload)
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Token has expired")
    except jwt.InvalidTokenError as e:
        raise AuthenticationError(f"Invalid token: {str(e)}")


async def validate_keycloak_token(token: str) -> Dict[str, Any]:
    """Validate token against Keycloak (optional integration)"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/userinfo",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5.0
            )
            if response.status_code == 200:
                return response.json()
            else:
                raise AuthenticationError("Invalid Keycloak token")
    except httpx.RequestError:
        logger.warning("Keycloak unavailable, falling back to local JWT validation")
        return None


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
) -> AuthenticatedUser:
    """
    Get current authenticated user from JWT token
    Usage: user: AuthenticatedUser = Depends(get_current_user)
    """
    if credentials is None:
        raise AuthenticationError("No authentication credentials provided")
    
    token = credentials.credentials
    
    # Try Keycloak validation first if configured
    use_keycloak = os.getenv("USE_KEYCLOAK", "false").lower() == "true"
    if use_keycloak:
        keycloak_user = await validate_keycloak_token(token)
        if keycloak_user:
            return AuthenticatedUser(
                user_id=keycloak_user.get("sub"),
                roles=keycloak_user.get("roles", []),
                permissions=keycloak_user.get("permissions", []),
                token_type=TokenType.ACCESS,
                metadata=keycloak_user
            )
    
    # Fall back to local JWT validation
    payload = decode_token(token)
    
    return AuthenticatedUser(
        user_id=payload.sub,
        roles=payload.roles,
        permissions=payload.permissions,
        token_type=payload.type,
        metadata=payload.metadata
    )


async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
) -> Optional[AuthenticatedUser]:
    """
    Get current user if authenticated, None otherwise
    Usage: user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    """
    if credentials is None:
        return None
    
    try:
        return await get_current_user(request, credentials)
    except AuthenticationError:
        return None


def require_roles(*required_roles: str):
    """
    Decorator to require specific roles
    Usage: @require_roles("admin", "compliance")
    """
    async def role_checker(
        user: AuthenticatedUser = Depends(get_current_user)
    ) -> AuthenticatedUser:
        if not any(user.has_role(role) for role in required_roles):
            raise AuthorizationError(f"Required roles: {', '.join(required_roles)}")
        return user
    
    return role_checker


def require_permissions(*required_permissions: str):
    """
    Decorator to require specific permissions
    Usage: @require_permissions("transactions:read", "transactions:write")
    """
    async def permission_checker(
        user: AuthenticatedUser = Depends(get_current_user)
    ) -> AuthenticatedUser:
        if not any(user.has_permission(perm) for perm in required_permissions):
            raise AuthorizationError(f"Required permissions: {', '.join(required_permissions)}")
        return user
    
    return permission_checker


def require_admin():
    """Require admin role"""
    return require_roles(UserRole.ADMIN)


def require_service():
    """Require service token (for internal service-to-service calls)"""
    async def service_checker(
        user: AuthenticatedUser = Depends(get_current_user)
    ) -> AuthenticatedUser:
        if not user.is_service():
            raise AuthorizationError("Service token required")
        return user
    
    return service_checker


class ServiceClient:
    """HTTP client for authenticated service-to-service calls"""
    
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.token = create_service_token(service_name)
        self.client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=30.0
        )
    
    async def get(self, url: str, **kwargs) -> httpx.Response:
        return await self.client.get(url, **kwargs)
    
    async def post(self, url: str, **kwargs) -> httpx.Response:
        return await self.client.post(url, **kwargs)
    
    async def put(self, url: str, **kwargs) -> httpx.Response:
        return await self.client.put(url, **kwargs)
    
    async def delete(self, url: str, **kwargs) -> httpx.Response:
        return await self.client.delete(url, **kwargs)
    
    async def close(self):
        await self.client.aclose()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()


# Middleware for automatic token refresh
async def auth_middleware(request: Request, call_next):
    """
    Middleware to handle authentication and add user context to request
    """
    # Skip auth for health checks and public endpoints
    public_paths = ["/health", "/healthz", "/ready", "/metrics", "/docs", "/openapi.json"]
    if any(request.url.path.startswith(path) for path in public_paths):
        return await call_next(request)
    
    # Extract token
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            payload = decode_token(token)
            request.state.user = AuthenticatedUser(
                user_id=payload.sub,
                roles=payload.roles,
                permissions=payload.permissions,
                token_type=payload.type,
                metadata=payload.metadata
            )
        except AuthenticationError:
            request.state.user = None
    else:
        request.state.user = None
    
    return await call_next(request)
