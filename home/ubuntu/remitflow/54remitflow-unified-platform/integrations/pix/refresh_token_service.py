"""
Refresh Token Service for PIX Integration
Handles refresh token rotation, revocation, and cleanup
"""

import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Tuple
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from models_refresh_token import RefreshToken
from models_auth import User
import logging

logger = logging.getLogger(__name__)


class RefreshTokenService:
    """Service for managing refresh tokens with rotation"""
    
    def __init__(self, db: Session):
        self.db = db
    
    @staticmethod
    def generate_token() -> str:
        """
        Generate a cryptographically secure random token
        
        Returns:
            str: Random token (64 characters)
        """
        return secrets.token_urlsafe(48)  # 64 characters
    
    @staticmethod
    def generate_family_id() -> str:
        """
        Generate a unique family ID for token rotation chain
        
        Returns:
            str: Family ID (32 characters)
        """
        return secrets.token_urlsafe(24)  # 32 characters
    
    @staticmethod
    def hash_token(token: str) -> str:
        """
        Hash token for secure storage
        
        Args:
            token: Plain token
            
        Returns:
            str: Hashed token (SHA-256)
        """
        return hashlib.sha256(token.encode()).hexdigest()
    
    def create_refresh_token(
        self,
        user_id: int,
        family_id: Optional[str] = None,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        expires_days: int = 7
    ) -> Tuple[str, RefreshToken]:
        """
        Create a new refresh token
        
        Args:
            user_id: User ID
            family_id: Token family ID (for rotation), creates new if None
            device_info: Device information
            ip_address: Client IP address
            user_agent: User agent string
            expires_days: Days until expiration
            
        Returns:
            Tuple[str, RefreshToken]: (plain_token, db_token)
        """
        # Generate plain token
        plain_token = self.generate_token()
        
        # Hash for storage
        hashed_token = self.hash_token(plain_token)
        
        # Generate family ID if not provided (new token family)
        if family_id is None:
            family_id = self.generate_family_id()
        
        # Create expiry time
        expires_at = RefreshToken.create_expiry_time(days=expires_days)
        
        # Create database record
        db_token = RefreshToken(
            token=hashed_token,
            user_id=user_id,
            family_id=family_id,
            expires_at=expires_at,
            device_info=device_info,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        self.db.add(db_token)
        self.db.commit()
        self.db.refresh(db_token)
        
        logger.info(f"Created refresh token for user {user_id}, family {family_id}")
        
        return plain_token, db_token
    
    def verify_and_rotate_token(
        self,
        plain_token: str,
        device_info: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> Tuple[str, User]:
        """
        Verify refresh token and rotate to new token
        
        This implements refresh token rotation:
        1. Verify old token is valid
        2. Mark old token as used
        3. Create new token in same family
        4. Return new token
        
        If token reuse is detected (token already used), revoke entire family
        
        Args:
            plain_token: Plain refresh token
            device_info: Device information
            ip_address: Client IP address
            user_agent: User agent string
            
        Returns:
            Tuple[str, User]: (new_plain_token, user)
            
        Raises:
            HTTPException: If token is invalid or reuse detected
        """
        # Hash token for lookup
        hashed_token = self.hash_token(plain_token)
        
        # Find token in database
        db_token = self.db.query(RefreshToken).filter(
            RefreshToken.token == hashed_token
        ).first()
        
        if not db_token:
            logger.warning(f"Refresh token not found")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token"
            )
        
        # Check for token reuse (security breach)
        if db_token.used_at is not None:
            logger.error(
                f"Token reuse detected! User {db_token.user_id}, "
                f"family {db_token.family_id}. Revoking entire family."
            )
            
            # Revoke entire token family (security measure)
            self.revoke_token_family(db_token.family_id, "Token reuse detected")
            
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token reuse detected. All tokens revoked for security."
            )
        
        # Check if token is valid
        if not db_token.is_valid():
            if db_token.is_revoked:
                reason = "Token has been revoked"
            elif db_token.expires_at < datetime.utcnow():
                reason = "Token has expired"
            else:
                reason = "Token is invalid"
            
            logger.warning(f"Invalid refresh token: {reason}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=reason
            )
        
        # Get user
        user = self.db.query(User).filter(User.id == db_token.user_id).first()
        if not user:
            logger.error(f"User {db_token.user_id} not found for valid token")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        # Create new token in same family (rotation)
        new_plain_token, new_db_token = self.create_refresh_token(
            user_id=user.id,
            family_id=db_token.family_id,  # Same family
            device_info=device_info,
            ip_address=ip_address,
            user_agent=user_agent,
            expires_days=7
        )
        
        # Mark old token as used
        db_token.mark_as_used(new_db_token.token)
        self.db.commit()
        
        logger.info(
            f"Rotated refresh token for user {user.id}, "
            f"family {db_token.family_id}"
        )
        
        return new_plain_token, user
    
    def revoke_token(self, plain_token: str, reason: str = "User logout"):
        """
        Revoke a specific refresh token
        
        Args:
            plain_token: Plain refresh token
            reason: Reason for revocation
        """
        hashed_token = self.hash_token(plain_token)
        
        db_token = self.db.query(RefreshToken).filter(
            RefreshToken.token == hashed_token
        ).first()
        
        if db_token:
            db_token.revoke(reason)
            self.db.commit()
            logger.info(f"Revoked token for user {db_token.user_id}: {reason}")
    
    def revoke_token_family(self, family_id: str, reason: str = "Security"):
        """
        Revoke all tokens in a family (security measure)
        
        Args:
            family_id: Token family ID
            reason: Reason for revocation
        """
        tokens = self.db.query(RefreshToken).filter(
            RefreshToken.family_id == family_id,
            RefreshToken.is_revoked == False
        ).all()
        
        for token in tokens:
            token.revoke(reason)
        
        self.db.commit()
        logger.warning(f"Revoked {len(tokens)} tokens in family {family_id}: {reason}")
    
    def revoke_user_tokens(self, user_id: int, reason: str = "User logout"):
        """
        Revoke all tokens for a user
        
        Args:
            user_id: User ID
            reason: Reason for revocation
        """
        tokens = self.db.query(RefreshToken).filter(
            RefreshToken.user_id == user_id,
            RefreshToken.is_revoked == False
        ).all()
        
        for token in tokens:
            token.revoke(reason)
        
        self.db.commit()
        logger.info(f"Revoked {len(tokens)} tokens for user {user_id}: {reason}")
    
    def cleanup_expired_tokens(self, days_old: int = 30):
        """
        Remove expired and old tokens from database
        
        Args:
            days_old: Remove tokens older than this many days
        """
        cutoff_date = datetime.utcnow() - timedelta(days=days_old)
        
        # Delete expired or old revoked tokens
        deleted_count = self.db.query(RefreshToken).filter(
            (RefreshToken.expires_at < datetime.utcnow()) |
            ((RefreshToken.is_revoked == True) & (RefreshToken.revoked_at < cutoff_date))
        ).delete()
        
        self.db.commit()
        
        if deleted_count > 0:
            logger.info(f"Cleaned up {deleted_count} expired/old refresh tokens")
        
        return deleted_count
    
    def get_user_active_tokens(self, user_id: int) -> list[RefreshToken]:
        """
        Get all active tokens for a user
        
        Args:
            user_id: User ID
            
        Returns:
            list[RefreshToken]: List of active tokens
        """
        return self.db.query(RefreshToken).filter(
            RefreshToken.user_id == user_id,
            RefreshToken.is_revoked == False,
            RefreshToken.expires_at > datetime.utcnow(),
            RefreshToken.used_at == None
        ).all()
    
    def get_token_info(self, plain_token: str) -> Optional[dict]:
        """
        Get information about a token
        
        Args:
            plain_token: Plain refresh token
            
        Returns:
            Optional[dict]: Token information or None
        """
        hashed_token = self.hash_token(plain_token)
        
        db_token = self.db.query(RefreshToken).filter(
            RefreshToken.token == hashed_token
        ).first()
        
        if not db_token:
            return None
        
        return {
            "user_id": db_token.user_id,
            "family_id": db_token.family_id,
            "created_at": db_token.created_at.isoformat(),
            "expires_at": db_token.expires_at.isoformat(),
            "is_valid": db_token.is_valid(),
            "is_revoked": db_token.is_revoked,
            "used_at": db_token.used_at.isoformat() if db_token.used_at else None,
            "device_info": db_token.device_info,
            "ip_address": db_token.ip_address
        }
