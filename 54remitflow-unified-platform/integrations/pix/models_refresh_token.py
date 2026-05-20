"""
Refresh Token Model for PIX Integration Service
Stores refresh tokens in database for rotation and revocation
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timedelta
from database import Base


class RefreshToken(Base):
    """
    Refresh Token model for token rotation
    
    Stores refresh tokens in database to enable:
    - Token rotation (new token on each use)
    - Token revocation (logout, security)
    - Token family tracking (detect token reuse)
    - Automatic cleanup of expired tokens
    """
    __tablename__ = "refresh_tokens"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Token data
    token = Column(String(500), unique=True, nullable=False, index=True)
    """Hashed refresh token value"""
    
    # User relationship
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    """User who owns this token"""
    
    # Token family (for rotation tracking)
    family_id = Column(String(100), nullable=False, index=True)
    """Token family ID - all rotated tokens share same family"""
    
    # Token metadata
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    """When this token was created"""
    
    expires_at = Column(DateTime(timezone=True), nullable=False)
    """When this token expires"""
    
    used_at = Column(DateTime(timezone=True), nullable=True)
    """When this token was used (for rotation)"""
    
    replaced_by_token = Column(String(500), nullable=True)
    """Token that replaced this one (for rotation chain)"""
    
    # Status flags
    is_revoked = Column(Boolean, default=False, nullable=False)
    """Whether this token has been revoked"""
    
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    """When this token was revoked"""
    
    revoked_reason = Column(String(255), nullable=True)
    """Reason for revocation (logout, security, etc.)"""
    
    # Device/client information
    device_info = Column(String(500), nullable=True)
    """Device/browser information"""
    
    ip_address = Column(String(45), nullable=True)
    """IP address when token was created"""
    
    user_agent = Column(String(500), nullable=True)
    """User agent when token was created"""
    
    # Relationships
    user = relationship("User", back_populates="refresh_tokens")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_refresh_token_user_family', 'user_id', 'family_id'),
        Index('idx_refresh_token_expires', 'expires_at'),
        Index('idx_refresh_token_revoked', 'is_revoked'),
    )
    
    def __repr__(self):
        return f"<RefreshToken(id={self.id}, user_id={self.user_id}, family={self.family_id}, expires={self.expires_at})>"
    
    def is_valid(self) -> bool:
        """
        Check if token is valid (not expired, not revoked, not used)
        
        Returns:
            bool: True if token is valid
        """
        now = datetime.utcnow()
        
        # Check if expired
        if self.expires_at < now:
            return False
        
        # Check if revoked
        if self.is_revoked:
            return False
        
        # Check if already used (rotated)
        if self.used_at is not None:
            return False
        
        return True
    
    def mark_as_used(self, new_token: str):
        """
        Mark this token as used and record replacement
        
        Args:
            new_token: The new token that replaces this one
        """
        self.used_at = datetime.utcnow()
        self.replaced_by_token = new_token
    
    def revoke(self, reason: str = "User logout"):
        """
        Revoke this token
        
        Args:
            reason: Reason for revocation
        """
        self.is_revoked = True
        self.revoked_at = datetime.utcnow()
        self.revoked_reason = reason
    
    @classmethod
    def create_expiry_time(cls, days: int = 7) -> datetime:
        """
        Create expiry time for refresh token
        
        Args:
            days: Number of days until expiration
            
        Returns:
            datetime: Expiry timestamp
        """
        return datetime.utcnow() + timedelta(days=days)
