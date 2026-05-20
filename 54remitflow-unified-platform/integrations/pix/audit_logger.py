"""
Audit Logger Service for PIX Integration
Centralized service for logging authentication and security events
"""

from sqlalchemy.orm import Session
from fastapi import Request
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import logging

from models_audit_log import AuditLog, AuditEventType, AuditSeverity
from models_auth import User

logger = logging.getLogger(__name__)


class AuditLogger:
    """
    Centralized audit logging service
    
    Provides methods to log all authentication and security events
    with comprehensive context information
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def _create_log(
        self,
        event_type: AuditEventType,
        message: str,
        severity: AuditSeverity = AuditSeverity.INFO,
        user_id: Optional[int] = None,
        username: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        endpoint: Optional[str] = None,
        http_method: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        success: bool = True,
        error_message: Optional[str] = None,
        token_family_id: Optional[str] = None,
        device_info: Optional[str] = None,
    ) -> AuditLog:
        """Create and save audit log entry"""
        
        audit_log = AuditLog(
            event_type=event_type,
            severity=severity,
            user_id=user_id,
            username=username,
            ip_address=ip_address,
            user_agent=user_agent,
            endpoint=endpoint,
            http_method=http_method,
            message=message,
            details=details or {},
            success=success,
            error_message=error_message,
            token_family_id=token_family_id,
            device_info=device_info,
        )
        
        try:
            self.db.add(audit_log)
            self.db.commit()
            self.db.refresh(audit_log)
            
            # Also log to application logger
            log_level = {
                AuditSeverity.INFO: logging.INFO,
                AuditSeverity.WARNING: logging.WARNING,
                AuditSeverity.ERROR: logging.ERROR,
                AuditSeverity.CRITICAL: logging.CRITICAL,
            }.get(severity, logging.INFO)
            
            logger.log(
                log_level,
                f"AUDIT: {event_type.value} - {message} (user={username}, ip={ip_address})"
            )
            
            return audit_log
            
        except Exception as e:
            logger.error(f"Failed to create audit log: {str(e)}")
            self.db.rollback()
            raise
    
    def extract_request_info(self, request: Request) -> Dict[str, str]:
        """Extract common information from FastAPI request"""
        return {
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
            "endpoint": str(request.url.path),
            "http_method": request.method,
        }
    
    # ===== Authentication Events =====
    
    def log_login_success(
        self,
        user: User,
        request: Request,
        token_family_id: str,
        device_info: Optional[str] = None
    ):
        """Log successful login"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.LOGIN_SUCCESS,
            severity=AuditSeverity.INFO,
            message=f"User {user.username} logged in successfully",
            user_id=user.id,
            username=user.username,
            token_family_id=token_family_id,
            device_info=device_info,
            details={
                "roles": user.roles,
                "login_method": "password"
            },
            success=True,
            **request_info
        )
    
    def log_login_failed(
        self,
        username: str,
        request: Request,
        reason: str = "Invalid credentials"
    ):
        """Log failed login attempt"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.LOGIN_FAILED,
            severity=AuditSeverity.WARNING,
            message=f"Failed login attempt for user {username}",
            username=username,
            error_message=reason,
            details={"reason": reason},
            success=False,
            **request_info
        )
    
    def log_logout(
        self,
        user: User,
        request: Request,
        token_family_id: Optional[str] = None,
        logout_all: bool = False
    ):
        """Log logout event"""
        request_info = self.extract_request_info(request)
        
        event_type = AuditEventType.LOGOUT_ALL if logout_all else AuditEventType.LOGOUT
        message = f"User {user.username} logged out" + (" from all devices" if logout_all else "")
        
        return self._create_log(
            event_type=event_type,
            severity=AuditSeverity.INFO,
            message=message,
            user_id=user.id,
            username=user.username,
            token_family_id=token_family_id,
            details={"logout_all": logout_all},
            success=True,
            **request_info
        )
    
    # ===== Token Events =====
    
    def log_token_refresh(
        self,
        user: User,
        request: Request,
        old_family_id: str,
        new_family_id: str
    ):
        """Log successful token refresh"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.TOKEN_REFRESH,
            severity=AuditSeverity.INFO,
            message=f"User {user.username} refreshed access token",
            user_id=user.id,
            username=user.username,
            token_family_id=new_family_id,
            details={
                "old_family_id": old_family_id,
                "new_family_id": new_family_id
            },
            success=True,
            **request_info
        )
    
    def log_token_refresh_failed(
        self,
        request: Request,
        reason: str,
        username: Optional[str] = None,
        user_id: Optional[int] = None
    ):
        """Log failed token refresh attempt"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.TOKEN_REFRESH_FAILED,
            severity=AuditSeverity.WARNING,
            message=f"Token refresh failed: {reason}",
            user_id=user_id,
            username=username,
            error_message=reason,
            details={"reason": reason},
            success=False,
            **request_info
        )
    
    def log_token_reuse_detected(
        self,
        user: User,
        request: Request,
        token_family_id: str
    ):
        """Log token reuse detection (CRITICAL security event)"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.TOKEN_REUSE_DETECTED,
            severity=AuditSeverity.CRITICAL,
            message=f"TOKEN REUSE DETECTED for user {user.username} - Revoking token family",
            user_id=user.id,
            username=user.username,
            token_family_id=token_family_id,
            details={
                "action_taken": "Revoked entire token family",
                "security_breach": True
            },
            success=False,
            error_message="Refresh token was already used - possible token theft",
            **request_info
        )
    
    def log_token_revoked(
        self,
        user: User,
        request: Request,
        token_family_id: str,
        reason: str
    ):
        """Log token revocation"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.TOKEN_REVOKED,
            severity=AuditSeverity.INFO,
            message=f"Token revoked for user {user.username}: {reason}",
            user_id=user.id,
            username=user.username,
            token_family_id=token_family_id,
            details={"reason": reason},
            success=True,
            **request_info
        )
    
    def log_token_family_revoked(
        self,
        user_id: int,
        username: str,
        token_family_id: str,
        reason: str,
        ip_address: Optional[str] = None
    ):
        """Log token family revocation"""
        return self._create_log(
            event_type=AuditEventType.TOKEN_FAMILY_REVOKED,
            severity=AuditSeverity.WARNING,
            message=f"Token family revoked for user {username}: {reason}",
            user_id=user_id,
            username=username,
            token_family_id=token_family_id,
            ip_address=ip_address,
            details={"reason": reason},
            success=True
        )
    
    # ===== Account Events =====
    
    def log_account_locked(
        self,
        username: str,
        request: Request,
        reason: str = "Too many failed login attempts"
    ):
        """Log account lockout"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.ACCOUNT_LOCKED,
            severity=AuditSeverity.WARNING,
            message=f"Account locked for user {username}: {reason}",
            username=username,
            details={"reason": reason},
            success=True,
            **request_info
        )
    
    def log_password_changed(
        self,
        user: User,
        request: Request,
        changed_by_admin: bool = False
    ):
        """Log password change"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.PASSWORD_CHANGED,
            severity=AuditSeverity.INFO,
            message=f"Password changed for user {user.username}",
            user_id=user.id,
            username=user.username,
            details={"changed_by_admin": changed_by_admin},
            success=True,
            **request_info
        )
    
    # ===== Security Events =====
    
    def log_rate_limit_exceeded(
        self,
        request: Request,
        endpoint: str,
        username: Optional[str] = None
    ):
        """Log rate limit violation"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.RATE_LIMIT_EXCEEDED,
            severity=AuditSeverity.WARNING,
            message=f"Rate limit exceeded for endpoint {endpoint}",
            username=username,
            endpoint=endpoint,
            details={"endpoint": endpoint},
            success=False,
            error_message="Too many requests",
            **request_info
        )
    
    def log_invalid_token(
        self,
        request: Request,
        reason: str,
        username: Optional[str] = None
    ):
        """Log invalid token attempt"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.INVALID_TOKEN,
            severity=AuditSeverity.WARNING,
            message=f"Invalid token presented: {reason}",
            username=username,
            error_message=reason,
            details={"reason": reason},
            success=False,
            **request_info
        )
    
    def log_insufficient_permissions(
        self,
        user: User,
        request: Request,
        required_role: str
    ):
        """Log authorization failure"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.INSUFFICIENT_PERMISSIONS,
            severity=AuditSeverity.WARNING,
            message=f"User {user.username} attempted to access resource without required role: {required_role}",
            user_id=user.id,
            username=user.username,
            details={
                "required_role": required_role,
                "user_roles": user.roles
            },
            success=False,
            error_message=f"Missing required role: {required_role}",
            **request_info
        )
    
    def log_suspicious_activity(
        self,
        request: Request,
        description: str,
        username: Optional[str] = None,
        user_id: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        """Log suspicious activity"""
        request_info = self.extract_request_info(request)
        
        return self._create_log(
            event_type=AuditEventType.SUSPICIOUS_ACTIVITY,
            severity=AuditSeverity.CRITICAL,
            message=f"Suspicious activity detected: {description}",
            user_id=user_id,
            username=username,
            details=details or {},
            success=False,
            error_message=description,
            **request_info
        )
    
    # ===== Query Methods =====
    
    def get_user_activity(
        self,
        user_id: int,
        limit: int = 100,
        event_types: Optional[list[AuditEventType]] = None
    ) -> list[AuditLog]:
        """Get audit logs for specific user"""
        query = self.db.query(AuditLog).filter(AuditLog.user_id == user_id)
        
        if event_types:
            query = query.filter(AuditLog.event_type.in_(event_types))
        
        return query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    
    def get_failed_login_attempts(
        self,
        username: Optional[str] = None,
        ip_address: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 100
    ) -> list[AuditLog]:
        """Get failed login attempts"""
        query = self.db.query(AuditLog).filter(
            AuditLog.event_type == AuditEventType.LOGIN_FAILED
        )
        
        if username:
            query = query.filter(AuditLog.username == username)
        
        if ip_address:
            query = query.filter(AuditLog.ip_address == ip_address)
        
        if since:
            query = query.filter(AuditLog.created_at >= since)
        
        return query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    
    def get_security_events(
        self,
        severity: Optional[AuditSeverity] = None,
        since: Optional[datetime] = None,
        limit: int = 100
    ) -> list[AuditLog]:
        """Get security events (warnings and above)"""
        query = self.db.query(AuditLog)
        
        if severity:
            query = query.filter(AuditLog.severity == severity)
        else:
            query = query.filter(
                AuditLog.severity.in_([
                    AuditSeverity.WARNING,
                    AuditSeverity.ERROR,
                    AuditSeverity.CRITICAL
                ])
            )
        
        if since:
            query = query.filter(AuditLog.created_at >= since)
        
        return query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    
    def get_token_reuse_attempts(
        self,
        since: Optional[datetime] = None,
        limit: int = 100
    ) -> list[AuditLog]:
        """Get token reuse attempts (critical security events)"""
        query = self.db.query(AuditLog).filter(
            AuditLog.event_type == AuditEventType.TOKEN_REUSE_DETECTED
        )
        
        if since:
            query = query.filter(AuditLog.created_at >= since)
        
        return query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    
    def get_activity_by_ip(
        self,
        ip_address: str,
        since: Optional[datetime] = None,
        limit: int = 100
    ) -> list[AuditLog]:
        """Get all activity from specific IP address"""
        query = self.db.query(AuditLog).filter(AuditLog.ip_address == ip_address)
        
        if since:
            query = query.filter(AuditLog.created_at >= since)
        
        return query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    
    def cleanup_old_logs(self, days_old: int = 90) -> int:
        """Delete audit logs older than specified days"""
        cutoff_date = datetime.utcnow() - timedelta(days=days_old)
        
        deleted = self.db.query(AuditLog).filter(
            AuditLog.created_at < cutoff_date,
            AuditLog.severity == AuditSeverity.INFO  # Keep warnings and above
        ).delete()
        
        self.db.commit()
        
        logger.info(f"Cleaned up {deleted} audit logs older than {days_old} days")
        
        return deleted
