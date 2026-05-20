"""
End-to-End JWT Identity Enforcement
Validates JWT tokens at every service boundary, not just API gateway
"""

import os
import json
import time
import logging
import hashlib
from typing import Optional, Dict, Any, List, Set
from dataclasses import dataclass, field
from enum import Enum
from functools import wraps
import asyncio
from datetime import datetime, timedelta

import httpx
import jwt
from jwt import PyJWKClient
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend

logger = logging.getLogger(__name__)


class TokenValidationError(Exception):
    """Base exception for token validation errors"""
    pass


class TokenExpiredError(TokenValidationError):
    """Token has expired"""
    pass


class TokenInvalidError(TokenValidationError):
    """Token is invalid"""
    pass


class InsufficientScopesError(TokenValidationError):
    """Token lacks required scopes"""
    pass


class AudienceMismatchError(TokenValidationError):
    """Token audience doesn't match"""
    pass


class IssuerMismatchError(TokenValidationError):
    """Token issuer doesn't match"""
    pass


@dataclass
class TokenClaims:
    """Validated token claims"""
    sub: str  # Subject (user ID)
    iss: str  # Issuer
    aud: List[str]  # Audience
    exp: int  # Expiration
    iat: int  # Issued at
    nbf: Optional[int] = None  # Not before
    jti: Optional[str] = None  # JWT ID
    scopes: List[str] = field(default_factory=list)
    roles: List[str] = field(default_factory=list)
    permissions: List[str] = field(default_factory=list)
    agent_id: Optional[str] = None
    agent_tier: Optional[str] = None
    tenant_id: Optional[str] = None
    session_id: Optional[str] = None
    device_id: Optional[str] = None
    raw_claims: Dict[str, Any] = field(default_factory=dict)


@dataclass
class JWTValidatorConfig:
    """Configuration for JWT validator"""
    # Keycloak/OIDC settings
    issuer: str = os.getenv("JWT_ISSUER", "https://auth.remittance-platform.com/realms/remittance")
    jwks_uri: str = os.getenv("JWT_JWKS_URI", "https://auth.remittance-platform.com/realms/remittance/protocol/openid-connect/certs")
    
    # Audience validation
    expected_audiences: List[str] = field(default_factory=lambda: os.getenv("JWT_AUDIENCES", "remittance-api,remittance-web").split(","))
    
    # Token settings
    clock_skew_seconds: int = int(os.getenv("JWT_CLOCK_SKEW", "30"))
    require_exp: bool = True
    require_iat: bool = True
    require_nbf: bool = False
    
    # Caching
    jwks_cache_ttl: int = int(os.getenv("JWT_JWKS_CACHE_TTL", "3600"))
    
    # Security settings
    allowed_algorithms: List[str] = field(default_factory=lambda: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"])
    revocation_check_enabled: bool = True
    revocation_endpoint: str = os.getenv("JWT_REVOCATION_ENDPOINT", "https://auth.remittance-platform.com/realms/remittance/protocol/openid-connect/token/introspect")
    
    # Service identity
    service_name: str = os.getenv("SERVICE_NAME", "unknown-service")


class JWKSCache:
    """Caches JWKS keys with automatic refresh"""
    
    def __init__(self, jwks_uri: str, cache_ttl: int = 3600):
        self.jwks_uri = jwks_uri
        self.cache_ttl = cache_ttl
        self._jwks_client: Optional[PyJWKClient] = None
        self._last_refresh: float = 0
        self._lock = asyncio.Lock()
    
    async def get_signing_key(self, kid: str) -> Any:
        """Get signing key by key ID"""
        async with self._lock:
            now = time.time()
            if self._jwks_client is None or (now - self._last_refresh) > self.cache_ttl:
                await self._refresh_jwks()
            
            try:
                return self._jwks_client.get_signing_key(kid)
            except jwt.exceptions.PyJWKClientError:
                # Key not found, try refreshing
                await self._refresh_jwks()
                return self._jwks_client.get_signing_key(kid)
    
    async def _refresh_jwks(self):
        """Refresh JWKS from endpoint"""
        try:
            self._jwks_client = PyJWKClient(self.jwks_uri)
            self._last_refresh = time.time()
            logger.info(f"Refreshed JWKS from {self.jwks_uri}")
        except Exception as e:
            logger.error(f"Failed to refresh JWKS: {e}")
            raise TokenValidationError(f"Failed to fetch JWKS: {e}")


class TokenRevocationChecker:
    """Checks if tokens have been revoked"""
    
    def __init__(self, introspection_endpoint: str, client_id: str, client_secret: str):
        self.introspection_endpoint = introspection_endpoint
        self.client_id = client_id
        self.client_secret = client_secret
        self._revoked_tokens: Set[str] = set()
        self._cache_ttl = 300  # 5 minutes
        self._cache: Dict[str, tuple] = {}  # jti -> (is_active, timestamp)
    
    async def is_revoked(self, token: str, jti: Optional[str] = None) -> bool:
        """Check if token is revoked"""
        # Check local cache first
        if jti and jti in self._revoked_tokens:
            return True
        
        if jti and jti in self._cache:
            is_active, timestamp = self._cache[jti]
            if time.time() - timestamp < self._cache_ttl:
                return not is_active
        
        # Introspect token
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.introspection_endpoint,
                    data={"token": token},
                    auth=(self.client_id, self.client_secret),
                    timeout=5.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    is_active = result.get("active", False)
                    
                    if jti:
                        self._cache[jti] = (is_active, time.time())
                        if not is_active:
                            self._revoked_tokens.add(jti)
                    
                    return not is_active
                else:
                    logger.warning(f"Token introspection failed: {response.status_code}")
                    return False  # Fail open for availability
        except Exception as e:
            logger.error(f"Token introspection error: {e}")
            return False  # Fail open for availability
    
    def mark_revoked(self, jti: str):
        """Mark a token as revoked locally"""
        self._revoked_tokens.add(jti)
        if jti in self._cache:
            del self._cache[jti]


class JWTValidator:
    """
    Production-grade JWT validator for end-to-end identity enforcement.
    Validates tokens at every service boundary.
    """
    
    def __init__(self, config: Optional[JWTValidatorConfig] = None):
        self.config = config or JWTValidatorConfig()
        self._jwks_cache = JWKSCache(self.config.jwks_uri, self.config.jwks_cache_ttl)
        self._revocation_checker: Optional[TokenRevocationChecker] = None
        
        if self.config.revocation_check_enabled:
            client_id = os.getenv("OIDC_CLIENT_ID", "remittance-service")
            client_secret = os.getenv("OIDC_CLIENT_SECRET", "")
            if client_secret:
                self._revocation_checker = TokenRevocationChecker(
                    self.config.revocation_endpoint,
                    client_id,
                    client_secret
                )
    
    async def validate_token(
        self,
        token: str,
        required_scopes: Optional[List[str]] = None,
        required_roles: Optional[List[str]] = None,
        required_permissions: Optional[List[str]] = None,
        required_audience: Optional[str] = None
    ) -> TokenClaims:
        """
        Validate JWT token and return claims.
        
        Args:
            token: JWT token string
            required_scopes: List of required scopes (all must be present)
            required_roles: List of required roles (at least one must be present)
            required_permissions: List of required permissions (all must be present)
            required_audience: Specific audience to require
        
        Returns:
            TokenClaims object with validated claims
        
        Raises:
            TokenValidationError: If validation fails
        """
        try:
            # Decode header to get key ID
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
            alg = unverified_header.get("alg")
            
            # Validate algorithm
            if alg not in self.config.allowed_algorithms:
                raise TokenInvalidError(f"Algorithm {alg} not allowed")
            
            # Get signing key
            signing_key = await self._jwks_cache.get_signing_key(kid)
            
            # Decode and validate token
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=self.config.allowed_algorithms,
                audience=self.config.expected_audiences,
                issuer=self.config.issuer,
                options={
                    "require": ["exp", "iat", "sub", "iss", "aud"],
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_aud": True,
                    "verify_iss": True,
                },
                leeway=self.config.clock_skew_seconds
            )
            
            # Check revocation
            jti = payload.get("jti")
            if self._revocation_checker and jti:
                if await self._revocation_checker.is_revoked(token, jti):
                    raise TokenInvalidError("Token has been revoked")
            
            # Extract claims
            claims = self._extract_claims(payload)
            
            # Validate required scopes
            if required_scopes:
                missing_scopes = set(required_scopes) - set(claims.scopes)
                if missing_scopes:
                    raise InsufficientScopesError(f"Missing required scopes: {missing_scopes}")
            
            # Validate required roles (at least one)
            if required_roles:
                if not any(role in claims.roles for role in required_roles):
                    raise InsufficientScopesError(f"Missing required roles: {required_roles}")
            
            # Validate required permissions
            if required_permissions:
                missing_perms = set(required_permissions) - set(claims.permissions)
                if missing_perms:
                    raise InsufficientScopesError(f"Missing required permissions: {missing_perms}")
            
            # Validate specific audience
            if required_audience and required_audience not in claims.aud:
                raise AudienceMismatchError(f"Token not intended for audience: {required_audience}")
            
            logger.info(
                f"Token validated for subject={claims.sub} "
                f"agent_id={claims.agent_id} service={self.config.service_name}"
            )
            
            return claims
            
        except jwt.ExpiredSignatureError:
            raise TokenExpiredError("Token has expired")
        except jwt.InvalidAudienceError:
            raise AudienceMismatchError("Invalid token audience")
        except jwt.InvalidIssuerError:
            raise IssuerMismatchError("Invalid token issuer")
        except jwt.InvalidTokenError as e:
            raise TokenInvalidError(f"Invalid token: {e}")
        except TokenValidationError:
            raise
        except Exception as e:
            logger.error(f"Token validation error: {e}")
            raise TokenValidationError(f"Token validation failed: {e}")
    
    def _extract_claims(self, payload: Dict[str, Any]) -> TokenClaims:
        """Extract and normalize claims from JWT payload"""
        # Handle audience as string or list
        aud = payload.get("aud", [])
        if isinstance(aud, str):
            aud = [aud]
        
        # Extract scopes from various claim names
        scopes = []
        if "scope" in payload:
            scopes = payload["scope"].split() if isinstance(payload["scope"], str) else payload["scope"]
        elif "scopes" in payload:
            scopes = payload["scopes"]
        
        # Extract roles from Keycloak realm_access or resource_access
        roles = []
        if "realm_access" in payload:
            roles.extend(payload["realm_access"].get("roles", []))
        if "resource_access" in payload:
            for resource, access in payload["resource_access"].items():
                roles.extend(access.get("roles", []))
        if "roles" in payload:
            roles.extend(payload["roles"])
        
        # Extract permissions from Permify or custom claims
        permissions = payload.get("permissions", [])
        if "authorization" in payload:
            permissions.extend(payload["authorization"].get("permissions", []))
        
        return TokenClaims(
            sub=payload["sub"],
            iss=payload["iss"],
            aud=aud,
            exp=payload["exp"],
            iat=payload["iat"],
            nbf=payload.get("nbf"),
            jti=payload.get("jti"),
            scopes=scopes,
            roles=list(set(roles)),  # Deduplicate
            permissions=list(set(permissions)),
            agent_id=payload.get("agent_id") or payload.get("agentId"),
            agent_tier=payload.get("agent_tier") or payload.get("agentTier"),
            tenant_id=payload.get("tenant_id") or payload.get("tenantId"),
            session_id=payload.get("session_id") or payload.get("sid"),
            device_id=payload.get("device_id") or payload.get("deviceId"),
            raw_claims=payload
        )
    
    def validate_token_sync(
        self,
        token: str,
        required_scopes: Optional[List[str]] = None,
        required_roles: Optional[List[str]] = None,
        required_permissions: Optional[List[str]] = None,
        required_audience: Optional[str] = None
    ) -> TokenClaims:
        """Synchronous wrapper for validate_token"""
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(
            self.validate_token(token, required_scopes, required_roles, required_permissions, required_audience)
        )


def require_auth(
    scopes: Optional[List[str]] = None,
    roles: Optional[List[str]] = None,
    permissions: Optional[List[str]] = None,
    audience: Optional[str] = None
):
    """
    Decorator for requiring authentication on endpoints.
    Works with FastAPI, Flask, and other frameworks.
    """
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            # Get token from request context
            request = kwargs.get("request") or (args[0] if args else None)
            token = _extract_token_from_request(request)
            
            if not token:
                raise TokenValidationError("No authentication token provided")
            
            validator = JWTValidator()
            claims = await validator.validate_token(
                token,
                required_scopes=scopes,
                required_roles=roles,
                required_permissions=permissions,
                required_audience=audience
            )
            
            # Inject claims into request or kwargs
            kwargs["token_claims"] = claims
            return await func(*args, **kwargs)
        
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            request = kwargs.get("request") or (args[0] if args else None)
            token = _extract_token_from_request(request)
            
            if not token:
                raise TokenValidationError("No authentication token provided")
            
            validator = JWTValidator()
            claims = validator.validate_token_sync(
                token,
                required_scopes=scopes,
                required_roles=roles,
                required_permissions=permissions,
                required_audience=audience
            )
            
            kwargs["token_claims"] = claims
            return func(*args, **kwargs)
        
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    
    return decorator


def _extract_token_from_request(request) -> Optional[str]:
    """Extract JWT token from various request types"""
    if request is None:
        return None
    
    # Try Authorization header
    auth_header = None
    if hasattr(request, "headers"):
        auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    elif hasattr(request, "META"):  # Django
        auth_header = request.META.get("HTTP_AUTHORIZATION")
    
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:]
    
    # Try cookie
    if hasattr(request, "cookies"):
        token = request.cookies.get("access_token")
        if token:
            return token
    
    # Try query parameter (not recommended for production)
    if hasattr(request, "query_params"):
        token = request.query_params.get("access_token")
        if token:
            logger.warning("Token passed via query parameter - not recommended for production")
            return token
    
    return None


# FastAPI middleware
class JWTAuthMiddleware:
    """FastAPI middleware for JWT authentication"""
    
    def __init__(
        self,
        app,
        exclude_paths: Optional[List[str]] = None,
        config: Optional[JWTValidatorConfig] = None
    ):
        self.app = app
        self.exclude_paths = exclude_paths or ["/health", "/metrics", "/docs", "/openapi.json"]
        self.validator = JWTValidator(config)
    
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        
        path = scope.get("path", "")
        
        # Skip excluded paths
        if any(path.startswith(excluded) for excluded in self.exclude_paths):
            await self.app(scope, receive, send)
            return
        
        # Extract token from headers
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode()
        
        if not auth_header.startswith("Bearer "):
            await self._send_error(send, 401, "Missing authentication token")
            return
        
        token = auth_header[7:]
        
        try:
            claims = await self.validator.validate_token(token)
            # Add claims to scope for downstream handlers
            scope["token_claims"] = claims
            await self.app(scope, receive, send)
        except TokenExpiredError:
            await self._send_error(send, 401, "Token expired")
        except TokenInvalidError as e:
            await self._send_error(send, 401, str(e))
        except InsufficientScopesError as e:
            await self._send_error(send, 403, str(e))
        except TokenValidationError as e:
            await self._send_error(send, 401, str(e))
    
    async def _send_error(self, send, status_code: int, message: str):
        """Send error response"""
        body = json.dumps({"error": message}).encode()
        await send({
            "type": "http.response.start",
            "status": status_code,
            "headers": [[b"content-type", b"application/json"]],
        })
        await send({
            "type": "http.response.body",
            "body": body,
        })


# Service-to-service authentication
class ServiceTokenManager:
    """Manages service-to-service authentication tokens"""
    
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        token_endpoint: str
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_endpoint = token_endpoint
        self._token: Optional[str] = None
        self._token_expiry: float = 0
        self._lock = asyncio.Lock()
    
    async def get_token(self) -> str:
        """Get a valid service token, refreshing if needed"""
        async with self._lock:
            now = time.time()
            
            # Refresh if expired or about to expire (30 second buffer)
            if self._token is None or now >= (self._token_expiry - 30):
                await self._refresh_token()
            
            return self._token
    
    async def _refresh_token(self):
        """Refresh the service token"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_endpoint,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
                timeout=10.0
            )
            
            if response.status_code != 200:
                raise TokenValidationError(f"Failed to get service token: {response.status_code}")
            
            data = response.json()
            self._token = data["access_token"]
            self._token_expiry = time.time() + data.get("expires_in", 300)
            
            logger.info(f"Refreshed service token for {self.client_id}")


# Example usage
if __name__ == "__main__":
    import asyncio
    
    async def main():
        config = JWTValidatorConfig(
            issuer="https://auth.remittance-platform.com/realms/remittance",
            expected_audiences=["remittance-api"]
        )
        
        validator = JWTValidator(config)
        
        # Example token validation
        test_token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
        
        try:
            claims = await validator.validate_token(
                test_token,
                required_scopes=["read:transactions"],
                required_roles=["agent"]
            )
            print(f"Token valid for user: {claims.sub}")
            print(f"Agent ID: {claims.agent_id}")
            print(f"Roles: {claims.roles}")
        except TokenValidationError as e:
            print(f"Token validation failed: {e}")
    
    asyncio.run(main())
