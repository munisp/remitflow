"""
Keycloak FastAPI Integration
Provides JWT authentication middleware for FastAPI backend
"""

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from typing import Optional, List, Dict, Any
import httpx
import logging
from functools import wraps
from datetime import datetime, timedelta
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Keycloak configuration
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://localhost:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "remittance")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "remittance-backend-api")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET", "")

# JWT configuration
ALGORITHM = "RS256"
PUBLIC_KEY_CACHE = {}
PUBLIC_KEY_CACHE_TTL = 3600  # 1 hour

# Security scheme
security = HTTPBearer()


class KeycloakAuth:
    """Keycloak authentication handler"""
    
    def __init__(self):
        self.keycloak_url = KEYCLOAK_URL
        self.realm = KEYCLOAK_REALM
        self.client_id = KEYCLOAK_CLIENT_ID
        self.client_secret = KEYCLOAK_CLIENT_SECRET
        self.public_key = None
        self.public_key_last_fetched = None
    
    async def get_public_key(self) -> str:
        """
        Get Keycloak public key for JWT verification
        
        Returns:
            Public key string
        """
        # Check cache
        if self.public_key and self.public_key_last_fetched:
            if datetime.now() - self.public_key_last_fetched < timedelta(seconds=PUBLIC_KEY_CACHE_TTL):
                return self.public_key
        
        # Fetch public key from Keycloak
        try:
            url = f"{self.keycloak_url}/realms/{self.realm}"
            async with httpx.AsyncClient() as client:
                response = await client.get(url)
                response.raise_for_status()
                realm_info = response.json()
                
                public_key = realm_info.get("public_key")
                if not public_key:
                    raise ValueError("Public key not found in realm info")
                
                # Format public key
                self.public_key = f"-----BEGIN PUBLIC KEY-----\n{public_key}\n-----END PUBLIC KEY-----"
                self.public_key_last_fetched = datetime.now()
                
                logger.info("Public key fetched successfully")
                return self.public_key
                
        except Exception as e:
            logger.error(f"Failed to fetch public key: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch authentication configuration"
            )
    
    async def verify_token(self, token: str) -> Dict[str, Any]:
        """
        Verify JWT token
        
        Args:
            token: JWT token string
            
        Returns:
            Decoded token payload
        """
        try:
            # Get public key
            public_key = await self.get_public_key()
            
            # Decode and verify token
            payload = jwt.decode(
                token,
                public_key,
                algorithms=[ALGORITHM],
                audience=self.client_id,
                options={
                    "verify_signature": True,
                    "verify_aud": True,
                    "verify_exp": True
                }
            )
            
            return payload
            
        except JWTError as e:
            logger.error(f"JWT verification failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
    
    async def get_user_info(self, token: str) -> Dict[str, Any]:
        """
        Get user info from Keycloak
        
        Args:
            token: JWT token string
            
        Returns:
            User information
        """
        try:
            url = f"{self.keycloak_url}/realms/{self.realm}/protocol/openid-connect/userinfo"
            headers = {"Authorization": f"Bearer {token}"}
            
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
                
        except Exception as e:
            logger.error(f"Failed to get user info: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Failed to get user information"
            )
    
    async def introspect_token(self, token: str) -> Dict[str, Any]:
        """
        Introspect token with Keycloak
        
        Args:
            token: JWT token string
            
        Returns:
            Token introspection result
        """
        try:
            url = f"{self.keycloak_url}/realms/{self.realm}/protocol/openid-connect/token/introspect"
            data = {
                "token": token,
                "client_id": self.client_id,
                "client_secret": self.client_secret
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(url, data=data)
                response.raise_for_status()
                return response.json()
                
        except Exception as e:
            logger.error(f"Token introspection failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token introspection failed"
            )


# Global Keycloak auth instance
keycloak_auth = KeycloakAuth()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> Dict[str, Any]:
    """
    Dependency to get current authenticated user
    
    Args:
        credentials: HTTP bearer credentials
        
    Returns:
        User payload from JWT token
    """
    token = credentials.credentials
    payload = await keycloak_auth.verify_token(token)
    return payload


async def get_current_active_user(
    current_user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Dependency to get current active user
    
    Args:
        current_user: Current user from token
        
    Returns:
        Active user payload
    """
    if not current_user.get("active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user"
        )
    return current_user


def require_roles(required_roles: List[str]):
    """
    Decorator to require specific roles
    
    Args:
        required_roles: List of required role names
        
    Returns:
        Dependency function
    """
    async def role_checker(
        current_user: Dict[str, Any] = Depends(get_current_user)
    ) -> Dict[str, Any]:
        user_roles = current_user.get("realm_access", {}).get("roles", [])
        
        if not any(role in user_roles for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {required_roles}"
            )
        
        return current_user
    
    return role_checker


def require_any_role(required_roles: List[str]):
    """
    Decorator to require any of the specified roles
    
    Args:
        required_roles: List of role names (user needs at least one)
        
    Returns:
        Dependency function
    """
    async def role_checker(
        current_user: Dict[str, Any] = Depends(get_current_user)
    ) -> Dict[str, Any]:
        user_roles = current_user.get("realm_access", {}).get("roles", [])
        
        if not any(role in user_roles for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required one of: {required_roles}"
            )
        
        return current_user
    
    return role_checker


def require_all_roles(required_roles: List[str]):
    """
    Decorator to require all specified roles
    
    Args:
        required_roles: List of role names (user needs all)
        
    Returns:
        Dependency function
    """
    async def role_checker(
        current_user: Dict[str, Any] = Depends(get_current_user)
    ) -> Dict[str, Any]:
        user_roles = current_user.get("realm_access", {}).get("roles", [])
        
        if not all(role in user_roles for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required all roles: {required_roles}"
            )
        
        return current_user
    
    return role_checker


class RoleChecker:
    """Role checker class for dependency injection"""
    
    def __init__(self, required_roles: List[str], require_all: bool = False):
        self.required_roles = required_roles
        self.require_all = require_all
    
    async def __call__(
        self,
        current_user: Dict[str, Any] = Depends(get_current_user)
    ) -> Dict[str, Any]:
        user_roles = current_user.get("realm_access", {}).get("roles", [])
        
        if self.require_all:
            has_permission = all(role in user_roles for role in self.required_roles)
        else:
            has_permission = any(role in user_roles for role in self.required_roles)
        
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {self.required_roles}"
            )
        
        return current_user


# Example usage in FastAPI routes:
"""
from fastapi import APIRouter, Depends
from keycloak_middleware import get_current_user, require_roles, RoleChecker

router = APIRouter()

@router.get("/protected")
async def protected_route(current_user: dict = Depends(get_current_user)):
    return {"message": "This is a protected route", "user": current_user}

@router.get("/admin")
async def admin_route(current_user: dict = Depends(require_roles(["admin"]))):
    return {"message": "Admin only route"}

@router.get("/operator")
async def operator_route(
    current_user: dict = Depends(RoleChecker(["operator", "admin"]))
):
    return {"message": "Operator or admin route"}
"""

