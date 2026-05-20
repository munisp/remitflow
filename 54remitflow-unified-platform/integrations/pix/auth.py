"""
Authentication and Authorization Module for PIX Integration Service
Implements JWT-based authentication with PostgreSQL database and role-based access control
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, List
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from config import settings
from models_auth import User

# Configure logging
logger = logging.getLogger(__name__)

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTP Bearer token scheme
security = HTTPBearer()

# --- Pydantic Models ---

class TokenData(BaseModel):
    """Token payload data"""
    user_id: int
    username: str
    roles: List[str]
    exp: datetime
    iat: Optional[datetime] = None


class UserCreate(BaseModel):
    """User creation schema"""
    username: str
    email: str
    password: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    roles: List[str] = ["user"]


class UserResponse(BaseModel):
    """User response schema (without password)"""
    id: int
    username: str
    email: str
    full_name: Optional[str]
    phone_number: Optional[str]
    roles: List[str]
    is_active: bool
    is_verified: bool
    created_at: datetime
    last_login: Optional[datetime]


class TokenResponse(BaseModel):
    """Token response model"""
    access_token: str
    token_type: str = "bearer"
    expires_in: int


# --- Password Utilities ---

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generate password hash"""
    return pwd_context.hash(password)


# --- JWT Token Utilities ---

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token
    
    Args:
        data: Dictionary containing user data (user_id, username, roles)
        expires_delta: Optional expiration time delta
        
    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
        "type": "access"
    })
    
    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )
    
    logger.info(f"Created access token for user: {data.get('username')}")
    return encoded_jwt


def decode_access_token(token: str) -> TokenData:
    """
    Decode and validate a JWT access token
    
    Args:
        token: JWT token string
        
    Returns:
        TokenData object with user information
        
    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        
        user_id: int = payload.get("user_id")
        username: str = payload.get("username")
        roles: List[str] = payload.get("roles", [])
        exp: datetime = datetime.fromtimestamp(payload.get("exp"))
        iat: datetime = datetime.fromtimestamp(payload.get("iat")) if payload.get("iat") else None
        
        if username is None or user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing user information",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        token_data = TokenData(
            user_id=user_id,
            username=username,
            roles=roles,
            exp=exp,
            iat=iat
        )
        
        return token_data
        
    except JWTError as e:
        logger.error(f"JWT decode error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


# --- Database User Functions ---

def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """Get user by username from database"""
    return db.query(User).filter(User.username == username).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """Get user by email from database"""
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    """Get user by ID from database"""
    return db.query(User).filter(User.id == user_id).first()


def create_user(db: Session, user_data: UserCreate) -> User:
    """
    Create a new user in the database
    
    Args:
        db: Database session
        user_data: User creation data
        
    Returns:
        Created User object
        
    Raises:
        HTTPException: If username or email already exists
    """
    # Check if username exists
    if get_user_by_username(db, user_data.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Check if email exists
    if get_user_by_email(db, user_data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Validate password length
    if len(user_data.password) < settings.PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters"
        )
    
    # Create user
    hashed_password = get_password_hash(user_data.password)
    
    db_user = User(
        username=user_data.username,
        email=user_data.email,
        hashed_password=hashed_password,
        full_name=user_data.full_name,
        phone_number=user_data.phone_number,
        roles=user_data.roles,
        is_active=True,
        is_verified=not settings.REQUIRE_EMAIL_VERIFICATION
    )
    
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    logger.info(f"Created new user: {db_user.username} (ID: {db_user.id})")
    
    return db_user


def update_last_login(db: Session, user_id: int):
    """Update user's last login timestamp"""
    user = get_user_by_id(db, user_id)
    if user:
        user.last_login = datetime.utcnow()
        user.failed_login_attempts = 0
        db.commit()


def increment_failed_login(db: Session, user_id: int):
    """Increment failed login attempts and lock account if necessary"""
    user = get_user_by_id(db, user_id)
    if user:
        user.failed_login_attempts += 1
        
        if user.failed_login_attempts >= settings.MAX_LOGIN_ATTEMPTS:
            user.locked_until = datetime.utcnow() + timedelta(minutes=settings.ACCOUNT_LOCKOUT_MINUTES)
            logger.warning(f"Account locked for user {user.username} until {user.locked_until}")
        
        db.commit()


def is_account_locked(user: User) -> bool:
    """Check if user account is locked"""
    if user.locked_until and user.locked_until > datetime.utcnow():
        return True
    return False


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    """
    Authenticate a user with username and password
    
    Args:
        db: Database session
        username: Username
        password: Plain text password
        
    Returns:
        User object if authentication successful, None otherwise
    """
    user = get_user_by_username(db, username)
    
    if not user:
        logger.warning(f"Authentication failed: User '{username}' not found")
        return None
    
    # Check if account is locked
    if is_account_locked(user):
        logger.warning(f"Authentication failed: Account '{username}' is locked until {user.locked_until}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is locked until {user.locked_until}. Too many failed login attempts."
        )
    
    # Check if account is active
    if not user.is_active:
        logger.warning(f"Authentication failed: Account '{username}' is inactive")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive"
        )
    
    # Verify password
    if not verify_password(password, user.hashed_password):
        logger.warning(f"Authentication failed: Invalid password for user '{username}'")
        increment_failed_login(db, user.id)
        return None
    
    # Update last login
    update_last_login(db, user.id)
    
    logger.info(f"User '{username}' authenticated successfully")
    return user


def generate_token_for_user(user: User) -> TokenResponse:
    """
    Generate JWT token for authenticated user
    
    Args:
        user: Authenticated User object
        
    Returns:
        TokenResponse with access token
    """
    access_token = create_access_token({
        "user_id": user.id,
        "username": user.username,
        "roles": user.roles
    })
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )


# --- Authentication Dependencies ---

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Dependency to get the current authenticated user from JWT token
    
    Args:
        credentials: HTTP Authorization credentials with Bearer token
        db: Database session
        
    Returns:
        User object from database
        
    Raises:
        HTTPException: If authentication fails
    """
    token = credentials.credentials
    token_data = decode_access_token(token)
    
    user = get_user_by_id(db, token_data.user_id)
    
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user"
        )
    
    logger.info(f"Authenticated user: {user.username} (ID: {user.id})")
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    Dependency to ensure user is active
    
    Args:
        current_user: Current authenticated user
        
    Returns:
        Active user object
        
    Raises:
        HTTPException: If user is inactive
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user"
        )
    return current_user


# --- Role-Based Access Control (RBAC) ---

class RoleChecker:
    """
    Dependency class for role-based access control
    
    Usage:
        @router.get("/admin", dependencies=[Depends(RoleChecker(["admin"]))])
    """
    
    def __init__(self, allowed_roles: List[str]):
        self.allowed_roles = allowed_roles
    
    def __call__(self, user: User = Depends(get_current_user)) -> User:
        """
        Check if user has required roles
        
        Args:
            user: Current authenticated user
            
        Returns:
            User object if authorized
            
        Raises:
            HTTPException: If user doesn't have required roles
        """
        if not any(role in user.roles for role in self.allowed_roles):
            logger.warning(
                f"User {user.username} attempted to access resource requiring roles {self.allowed_roles}. "
                f"User roles: {user.roles}"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {self.allowed_roles}"
            )
        
        logger.info(f"User {user.username} authorized with roles: {user.roles}")
        return user


# --- Predefined Role Checkers ---

require_admin = RoleChecker(["admin"])
require_user = RoleChecker(["user", "admin"])
require_pix_operator = RoleChecker(["pix_operator", "admin"])
