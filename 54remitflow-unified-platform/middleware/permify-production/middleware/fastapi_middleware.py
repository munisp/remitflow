"""
FastAPI Authorization Middleware
Provides decorators and middleware for FastAPI applications
"""

import logging
from typing import Optional, Callable, List
from functools import wraps
import asyncio

from fastapi import Request, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from service.authorization_service import AuthorizationService, get_authorization_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security scheme
security = HTTPBearer()


class AuthorizationMiddleware:
    """
    FastAPI middleware for authorization
    """
    
    def __init__(self, auth_service: Optional[AuthorizationService] = None):
        """
        Initialize authorization middleware
        
        Args:
            auth_service: Authorization service instance
        """
        self.auth_service = auth_service or get_authorization_service()
        logger.info("Authorization middleware initialized")
    
    async def __call__(self, request: Request, call_next):
        """Process request"""
        # Add authorization service to request state
        request.state.auth_service = self.auth_service
        
        # Process request
        response = await call_next(request)
        
        return response


# ============================================================================
# DEPENDENCY INJECTION
# ============================================================================

async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> str:
    """
    Get current user ID from JWT token
    
    Args:
        credentials: HTTP authorization credentials
    
    Returns:
        User ID
    
    Raises:
        HTTPException: If token is invalid
    """
    # Implement JWT token validation
    import jwt
    from jwt import PyJWTError
    import os
    
    token = credentials.credentials
    
    # Get JWT secret from environment
    JWT_SECRET = os.getenv('JWT_SECRET', 'your-secret-key-change-in-production')
    JWT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')
    
    try:
        # Decode and validate JWT
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={
                'verify_signature': True,
                'verify_exp': True,
                'verify_iat': True,
                'require': ['sub', 'exp']
            }
        )
        
        # Extract user_id from 'sub' claim
        user_id = payload.get('sub')
        
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Invalid token: missing user ID"
            )
        
        logger.debug(f"JWT validated for user: {user_id}")
        return user_id
    except Exception as e:
        logger.error(f"Token validation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_auth_service(request: Request) -> AuthorizationService:
    """
    Get authorization service from request state
    
    Args:
        request: FastAPI request
    
    Returns:
        Authorization service instance
    """
    if hasattr(request.state, "auth_service"):
        return request.state.auth_service
    return get_authorization_service()


# ============================================================================
# DECORATORS
# ============================================================================

def require_permission(
    entity_type: str,
    permission: str,
    entity_id_param: str = "id"
):
    """
    Decorator to require permission for endpoint
    
    Args:
        entity_type: Entity type (e.g., "account", "transaction")
        permission: Permission to check (e.g., "view", "transfer")
        entity_id_param: Parameter name for entity ID (default: "id")
    
    Example:
        @app.get("/accounts/{id}")
        @require_permission("account", "view", "id")
        async def get_account(id: str, user_id: str = Depends(get_current_user_id)):
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get user_id from kwargs
            user_id = kwargs.get("user_id")
            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not authenticated"
                )
            
            # Get entity_id from kwargs
            entity_id = kwargs.get(entity_id_param)
            if not entity_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing parameter: {entity_id_param}"
                )
            
            # Get authorization service
            auth_service = kwargs.get("auth_service") or get_authorization_service()
            
            # Check permission
            result = await auth_service.client.check_permission(
                entity_type=entity_type,
                entity_id=entity_id,
                permission=permission,
                subject_type="user",
                subject_id=user_id
            )
            
            if not result.can.value == "ALLOWED":
                logger.warning(f"Permission denied: user={user_id}, entity={entity_type}:{entity_id}, permission={permission}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: {permission} on {entity_type}"
                )
            
            # Call original function
            return await func(*args, **kwargs)
        
        return wrapper
    return decorator


def require_role(role_name: str):
    """
    Decorator to require role for endpoint
    
    Args:
        role_name: Role name (e.g., "admin", "compliance_officer")
    
    Example:
        @app.get("/admin/users")
        @require_role("admin")
        async def list_users(user_id: str = Depends(get_current_user_id)):
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get user_id from kwargs
            user_id = kwargs.get("user_id")
            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not authenticated"
                )
            
            # Get authorization service
            auth_service = kwargs.get("auth_service") or get_authorization_service()
            
            # Check role via Permify
            try:
                # Check if user has the required role
                has_role = await auth_service.check_permission(
                    user_id=user_id,
                    resource="system",
                    resource_id="global",
                    action=f"role:{role_name}",
                    context={"role_check": True}
                )
                
                logger.debug(
                    f"Role check: user={user_id}, role={role_name}, "
                    f"result={has_role}"
                )
            except Exception as e:
                logger.error(f"Error checking role via Permify: {e}")
                # Fail closed - deny access on error
                has_role = False
            
            if not has_role:
                logger.warning(f"Role required: user={user_id}, role={role_name}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Role required: {role_name}"
                )
            
            # Call original function
            return await func(*args, **kwargs)
        
        return wrapper
    return decorator


def require_any_permission(
    entity_type: str,
    permissions: List[str],
    entity_id_param: str = "id"
):
    """
    Decorator to require any of the specified permissions
    
    Args:
        entity_type: Entity type
        permissions: List of permissions (user needs at least one)
        entity_id_param: Parameter name for entity ID
    
    Example:
        @app.put("/transactions/{id}")
        @require_any_permission("transaction", ["approve", "reject"], "id")
        async def update_transaction(id: str, user_id: str = Depends(get_current_user_id)):
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get user_id from kwargs
            user_id = kwargs.get("user_id")
            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not authenticated"
                )
            
            # Get entity_id from kwargs
            entity_id = kwargs.get(entity_id_param)
            if not entity_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing parameter: {entity_id_param}"
                )
            
            # Get authorization service
            auth_service = kwargs.get("auth_service") or get_authorization_service()
            
            # Check permissions in parallel
            tasks = [
                auth_service.client.check_permission(
                    entity_type=entity_type,
                    entity_id=entity_id,
                    permission=perm,
                    subject_type="user",
                    subject_id=user_id
                )
                for perm in permissions
            ]
            
            results = await asyncio.gather(*tasks)
            
            # Check if any permission is allowed
            has_permission = any(r.can.value == "ALLOWED" for r in results)
            
            if not has_permission:
                logger.warning(f"Permission denied: user={user_id}, entity={entity_type}:{entity_id}, permissions={permissions}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: requires one of {permissions}"
                )
            
            # Call original function
            return await func(*args, **kwargs)
        
        return wrapper
    return decorator


def require_all_permissions(
    entity_type: str,
    permissions: List[str],
    entity_id_param: str = "id"
):
    """
    Decorator to require all of the specified permissions
    
    Args:
        entity_type: Entity type
        permissions: List of permissions (user needs all)
        entity_id_param: Parameter name for entity ID
    
    Example:
        @app.delete("/accounts/{id}")
        @require_all_permissions("account", ["close", "delete"], "id")
        async def delete_account(id: str, user_id: str = Depends(get_current_user_id)):
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get user_id from kwargs
            user_id = kwargs.get("user_id")
            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not authenticated"
                )
            
            # Get entity_id from kwargs
            entity_id = kwargs.get(entity_id_param)
            if not entity_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing parameter: {entity_id_param}"
                )
            
            # Get authorization service
            auth_service = kwargs.get("auth_service") or get_authorization_service()
            
            # Check permissions in parallel
            tasks = [
                auth_service.client.check_permission(
                    entity_type=entity_type,
                    entity_id=entity_id,
                    permission=perm,
                    subject_type="user",
                    subject_id=user_id
                )
                for perm in permissions
            ]
            
            results = await asyncio.gather(*tasks)
            
            # Check if all permissions are allowed
            has_all_permissions = all(r.can.value == "ALLOWED" for r in results)
            
            if not has_all_permissions:
                logger.warning(f"Permission denied: user={user_id}, entity={entity_type}:{entity_id}, permissions={permissions}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: requires all of {permissions}"
                )
            
            # Call original function
            return await func(*args, **kwargs)
        
        return wrapper
    return decorator


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

"""
from fastapi import FastAPI, Depends
from middleware.fastapi_middleware import (
    AuthorizationMiddleware,
    get_current_user_id,
    get_auth_service,
    require_permission,
    require_role
)

app = FastAPI()

# Add authorization middleware
app.add_middleware(AuthorizationMiddleware)

# Example endpoints

@app.get("/accounts/{id}")
@require_permission("account", "view", "id")
async def get_account(
    id: str,
    user_id: str = Depends(get_current_user_id),
    auth_service: AuthorizationService = Depends(get_auth_service)
):
    # Implementation
    return {"account_id": id, "user_id": user_id}

@app.post("/accounts/{id}/transfer")
@require_permission("account", "transfer", "id")
async def transfer_funds(
    id: str,
    amount: float,
    user_id: str = Depends(get_current_user_id),
    auth_service: AuthorizationService = Depends(get_auth_service)
):
    # Implementation
    return {"account_id": id, "amount": amount, "user_id": user_id}

@app.get("/admin/users")
@require_role("admin")
async def list_users(
    user_id: str = Depends(get_current_user_id),
    auth_service: AuthorizationService = Depends(get_auth_service)
):
    # Implementation
    return {"users": []}
"""

