"""
Authentication Router with Refresh Token Rotation
Provides login, logout, token refresh with rotation
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from database import get_db
from auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    update_last_login
)
from refresh_token_service import RefreshTokenService
from models_auth import User
from rate_limiter import rate_limit_login
import logging

logger = logging.getLogger(__name__)

auth_router = APIRouter(prefix="/auth", tags=["Authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


# Pydantic schemas
class TokenResponse(BaseModel):
    """Response model for login/refresh"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 1800  # 30 minutes


class RefreshTokenRequest(BaseModel):
    """Request model for token refresh"""
    refresh_token: str


class LogoutRequest(BaseModel):
    """Request model for logout"""
    refresh_token: str


class UserResponse(BaseModel):
    """Response model for user info"""
    id: int
    username: str
    email: str
    full_name: Optional[str]
    roles: list[str]
    is_active: bool
    created_at: str
    last_login: Optional[str]


class ActiveTokensResponse(BaseModel):
    """Response model for active tokens"""
    count: int
    tokens: list[dict]


def get_client_info(request: Request) -> dict:
    """Extract client information from request"""
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
        "device_info": f"{request.headers.get('user-agent', 'Unknown')[:100]}"
    }


@auth_router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(rate_limit_login)],
    summary="Login and get access + refresh tokens",
    description="Authenticate with username/password and receive both access and refresh tokens"
)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """
    Login endpoint with refresh token rotation
    
    Returns:
    - access_token: Short-lived JWT for API access (30 minutes)
    - refresh_token: Long-lived token for getting new access tokens (7 days)
    """
    # Authenticate user
    user = authenticate_user(db, form_data.username, form_data.password)
    
    if not user:
        logger.warning(f"Failed login attempt for username: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Update last login
    update_last_login(db, user.id)
    
    # Create access token
    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "username": user.username,
            "roles": user.roles
        }
    )
    
    # Create refresh token
    client_info = get_client_info(request)
    refresh_service = RefreshTokenService(db)
    refresh_token, _ = refresh_service.create_refresh_token(
        user_id=user.id,
        device_info=client_info["device_info"],
        ip_address=client_info["ip_address"],
        user_agent=client_info["user_agent"],
        expires_days=7
    )
    
    logger.info(f"User {user.username} logged in successfully")
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=1800
    )


@auth_router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Refresh access token",
    description="Use refresh token to get new access token. Implements token rotation."
)
async def refresh_token(
    request: Request,
    refresh_request: RefreshTokenRequest,
    db: Session = Depends(get_db)
):
    """
    Refresh token endpoint with automatic rotation
    
    This implements refresh token rotation:
    1. Validates old refresh token
    2. Creates new access token
    3. Creates new refresh token (rotates)
    4. Marks old refresh token as used
    5. Returns both new tokens
    
    Security: If token reuse is detected, entire token family is revoked
    """
    try:
        # Get client info
        client_info = get_client_info(request)
        
        # Verify and rotate refresh token
        refresh_service = RefreshTokenService(db)
        new_refresh_token, user = refresh_service.verify_and_rotate_token(
            plain_token=refresh_request.refresh_token,
            device_info=client_info["device_info"],
            ip_address=client_info["ip_address"],
            user_agent=client_info["user_agent"]
        )
        
        # Create new access token
        access_token = create_access_token(
            data={
                "sub": str(user.id),
                "username": user.username,
                "roles": user.roles
            }
        )
        
        logger.info(f"Refreshed tokens for user {user.username}")
        
        return TokenResponse(
            access_token=access_token,
            refresh_token=new_refresh_token,
            token_type="bearer",
            expires_in=1800
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error refreshing token: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )


@auth_router.post(
    "/logout",
    summary="Logout and revoke refresh token",
    description="Revoke refresh token to logout from specific device"
)
async def logout(
    logout_request: LogoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Logout endpoint - revokes refresh token
    
    This only revokes the specific refresh token (device).
    For logout from all devices, use /logout/all
    """
    refresh_service = RefreshTokenService(db)
    refresh_service.revoke_token(
        plain_token=logout_request.refresh_token,
        reason="User logout"
    )
    
    logger.info(f"User {current_user.username} logged out")
    
    return {"message": "Successfully logged out"}


@auth_router.post(
    "/logout/all",
    summary="Logout from all devices",
    description="Revoke all refresh tokens for current user"
)
async def logout_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Logout from all devices - revokes all user's refresh tokens
    """
    refresh_service = RefreshTokenService(db)
    refresh_service.revoke_user_tokens(
        user_id=current_user.id,
        reason="User logout from all devices"
    )
    
    logger.info(f"User {current_user.username} logged out from all devices")
    
    return {"message": "Successfully logged out from all devices"}


@auth_router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current user info",
    description="Get information about currently authenticated user"
)
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """Get current user information"""
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        full_name=current_user.full_name,
        roles=current_user.roles,
        is_active=current_user.is_active,
        created_at=current_user.created_at.isoformat(),
        last_login=current_user.last_login.isoformat() if current_user.last_login else None
    )


@auth_router.get(
    "/tokens/active",
    response_model=ActiveTokensResponse,
    summary="Get active refresh tokens",
    description="List all active refresh tokens for current user"
)
async def get_active_tokens(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all active refresh tokens for current user
    
    Useful for showing user which devices are logged in
    """
    refresh_service = RefreshTokenService(db)
    tokens = refresh_service.get_user_active_tokens(current_user.id)
    
    token_list = [
        {
            "family_id": token.family_id,
            "created_at": token.created_at.isoformat(),
            "expires_at": token.expires_at.isoformat(),
            "device_info": token.device_info,
            "ip_address": token.ip_address,
            "last_used": token.used_at.isoformat() if token.used_at else token.created_at.isoformat()
        }
        for token in tokens
    ]
    
    return ActiveTokensResponse(
        count=len(token_list),
        tokens=token_list
    )


@auth_router.delete(
    "/tokens/{family_id}",
    summary="Revoke specific device token",
    description="Revoke refresh token family (logout specific device)"
)
async def revoke_device_token(
    family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Revoke specific refresh token family
    
    Useful for "logout from other device" functionality
    """
    refresh_service = RefreshTokenService(db)
    
    # Verify token family belongs to current user
    tokens = refresh_service.get_user_active_tokens(current_user.id)
    family_ids = [token.family_id for token in tokens]
    
    if family_id not in family_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token family not found or doesn't belong to you"
        )
    
    refresh_service.revoke_token_family(
        family_id=family_id,
        reason="User revoked device"
    )
    
    logger.info(f"User {current_user.username} revoked token family {family_id}")
    
    return {"message": f"Successfully revoked device token"}
