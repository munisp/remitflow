"""
Audit Log Model for PIX Integration Service
Stores all authentication and security events
"""

from sqlalchemy import Column, Integer, String, DateTime, JSON, Boolean, Text, Enum as SQLEnum
from sqlalchemy.sql import func
from database import Base
import enum


class AuditEventType(str, enum.Enum):
    """Enumeration of audit event types"""
    
    # Authentication events
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    LOGOUT_ALL = "logout_all"
    
    # Token events
    TOKEN_REFRESH = "token_refresh"
    TOKEN_REFRESH_FAILED = "token_refresh_failed"
    TOKEN_REUSE_DETECTED = "token_reuse_detected"
    TOKEN_REVOKED = "token_revoked"
    TOKEN_FAMILY_REVOKED = "token_family_revoked"
    
    # Account events
    ACCOUNT_LOCKED = "account_locked"
    ACCOUNT_UNLOCKED = "account_unlocked"
    PASSWORD_CHANGED = "password_changed"
    PASSWORD_RESET_REQUESTED = "password_reset_requested"
    PASSWORD_RESET_COMPLETED = "password_reset_completed"
    
    # Security events
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"
    INVALID_TOKEN = "invalid_token"
    EXPIRED_TOKEN = "expired_token"
    INSUFFICIENT_PERMISSIONS = "insufficient_permissions"
    SUSPICIOUS_ACTIVITY = "suspicious_activity"
    
    # User management
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_DELETED = "user_deleted"
    USER_ACTIVATED = "user_activated"
    USER_DEACTIVATED = "user_deactivated"


class AuditSeverity(str, enum.Enum):
    """Severity levels for audit events"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class AuditLog(Base):
    """
    Audit Log model for tracking authentication and security events
    
    Stores comprehensive information about all authentication-related
    activities for security monitoring and compliance
    """
    __tablename__ = "audit_logs"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Event information
    event_type = Column(SQLEnum(AuditEventType), nullable=False, index=True)
    severity = Column(SQLEnum(AuditSeverity), nullable=False, default=AuditSeverity.INFO, index=True)
    
    # User information
    user_id = Column(Integer, nullable=True, index=True)  # Nullable for failed login attempts
    username = Column(String(50), nullable=True, index=True)
    
    # Request information
    ip_address = Column(String(45), nullable=True, index=True)  # IPv4 or IPv6
    user_agent = Column(String(500), nullable=True)
    endpoint = Column(String(255), nullable=True)
    http_method = Column(String(10), nullable=True)
    
    # Event details
    message = Column(Text, nullable=False)
    details = Column(JSON, nullable=True)  # Additional structured data
    
    # Outcome
    success = Column(Boolean, nullable=False, default=True, index=True)
    error_message = Column(Text, nullable=True)
    
    # Security context
    token_family_id = Column(String(100), nullable=True, index=True)
    device_info = Column(String(500), nullable=True)
    
    # Geolocation (optional)
    country = Column(String(2), nullable=True)  # ISO country code
    city = Column(String(100), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    
    def __repr__(self):
        return f"<AuditLog(id={self.id}, event={self.event_type}, user={self.username}, ip={self.ip_address})>"
    
    def to_dict(self):
        """Convert audit log to dictionary"""
        return {
            "id": self.id,
            "event_type": self.event_type.value if self.event_type else None,
            "severity": self.severity.value if self.severity else None,
            "user_id": self.user_id,
            "username": self.username,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "endpoint": self.endpoint,
            "http_method": self.http_method,
            "message": self.message,
            "details": self.details,
            "success": self.success,
            "error_message": self.error_message,
            "token_family_id": self.token_family_id,
            "device_info": self.device_info,
            "country": self.country,
            "city": self.city,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
