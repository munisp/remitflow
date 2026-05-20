"""
Authentication Router for PIX Integration Service
Provides login and token management endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import (
    authenticate_user,
    generate_token_for_user,
    get_current_user,
    TokenResponse
)
from models_auth import User
from database import get_db
from rate_limiter import rate_limit_login

# Create router
auth_router = APIRouter(prefix="/auth", tags=["Authentication"])

# HTTP Basic Auth for login
security = HTTPBasic()


# --- Request/Response Models ---

class LoginRequest(BaseModel):
    """Login request model"""
    username: str = Field(..., description="Username", min_length=3, max_length=50)
    password: str = Field(..., description="Password", min_length=6)


class UserResponse(BaseModel):
    """User response model"""
    id: int
    username: str
    email: str
    roles: list[str]
    is_active: bool


# --- Authentication Endpoints ---

@auth_router.post(
    "/login",
    response_model=TokenResponse,
    summary="User Login",
    description="Authenticate with username and password to receive a JWT access token",
    dependencies=[Depends(rate_limit_login)]
)
async def login(
    request: Request,
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Authenticate user and return JWT access token.
    
    **Test Credentials**:
    - Admin: username=`admin`, password=`admin123`
    - User: username=`user1`, password=`user123`
    - PIX Operator: username=`pix_operator`, password=`operator123`
    
    Returns:
        TokenResponse with access_token and expiration info
        
    Raises:
        401 Unauthorized if credentials are invalid
    """
    user = authenticate_user(db, login_data.username, login_data.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token_response = generate_token_for_user(user)
    return token_response


@auth_router.post(
    "/login/basic",
    response_model=TokenResponse,
    summary="User Login (HTTP Basic Auth)",
    description="Authenticate using HTTP Basic Auth to receive a JWT access token"
)
def login_basic(credentials: HTTPBasicCredentials = Depends(security)):
    """
    Authenticate user using HTTP Basic Auth and return JWT access token.
    
    This endpoint accepts HTTP Basic Authentication (username:password in Authorization header).
    
    Returns:
        TokenResponse with access_token and expiration info
        
    Raises:
        401 Unauthorized if credentials are invalid
    """
    user = authenticate_user(credentials.username, credentials.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    
    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user account"
        )
    
    token_response = generate_token_for_user(user)
    return token_response


@auth_router.get(
    "/me",
    response_model=UserResponse,
    summary="Get Current User",
    description="Get information about the currently authenticated user"
)
async def get_me(current_user: User = Depends(get_current_user)):
    """
    Get current user information from JWT token.
    
    **Authentication Required**: Yes
    
    Returns:
        User information including id, username, email, roles
    """
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        roles=current_user.roles,
        is_active=current_user.is_active
    )


@auth_router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Refresh Access Token",
    description="Refresh JWT access token using current valid token"
)
async def refresh_token(current_user: User = Depends(get_current_user)):
    """
    Refresh the access token for the current user.
    
    **Authentication Required**: Yes
    
    Returns:
        New TokenResponse with refreshed access_token
    """
    # In a real application, you might want to use refresh tokens
    # For now, we'll just generate a new access token
    user_data = {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "hashed_password": "",  # Not needed for token generation
        "roles": current_user.roles,
        "is_active": current_user.is_active
    }
    
    token_response = generate_token_for_user(user_data)
    return token_response
