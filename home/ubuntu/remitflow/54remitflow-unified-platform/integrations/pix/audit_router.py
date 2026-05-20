"""
Audit Log API Router
Provides endpoints for querying and monitoring audit logs
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta

from database import get_db
from auth import get_current_user, require_role
from models_auth import User
from models_audit_log import AuditLog, AuditEventType, AuditSeverity
from audit_logger import AuditLogger
import logging

logger = logging.getLogger(__name__)

audit_router = APIRouter(prefix="/audit", tags=["Audit Logs"])


# Pydantic schemas
class AuditLogResponse(BaseModel):
    """Response model for audit log"""
    id: int
    event_type: str
    severity: str
    user_id: Optional[int]
    username: Optional[str]
    ip_address: Optional[str]
    user_agent: Optional[str]
    endpoint: Optional[str]
    http_method: Optional[str]
    message: str
    details: Optional[dict]
    success: bool
    error_message: Optional[str]
    token_family_id: Optional[str]
    device_info: Optional[str]
    created_at: str


class AuditLogsListResponse(BaseModel):
    """Response model for list of audit logs"""
    total: int
    logs: List[AuditLogResponse]


class SecuritySummaryResponse(BaseModel):
    """Response model for security summary"""
    total_events: int
    failed_logins: int
    token_reuse_attempts: int
    rate_limit_violations: int
    account_lockouts: int
    suspicious_activities: int
    period_hours: int


class UserActivitySummaryResponse(BaseModel):
    """Response model for user activity summary"""
    user_id: int
    username: str
    total_logins: int
    failed_logins: int
    token_refreshes: int
    last_login: Optional[str]
    last_ip: Optional[str]
    active_devices: int


# Helper functions
def audit_log_to_response(log: AuditLog) -> AuditLogResponse:
    """Convert AuditLog model to response schema"""
    return AuditLogResponse(
        id=log.id,
        event_type=log.event_type.value if log.event_type else None,
        severity=log.severity.value if log.severity else None,
        user_id=log.user_id,
        username=log.username,
        ip_address=log.ip_address,
        user_agent=log.user_agent,
        endpoint=log.endpoint,
        http_method=log.http_method,
        message=log.message,
        details=log.details,
        success=log.success,
        error_message=log.error_message,
        token_family_id=log.token_family_id,
        device_info=log.device_info,
        created_at=log.created_at.isoformat() if log.created_at else None
    )


# Endpoints
@audit_router.get(
    "/logs",
    response_model=AuditLogsListResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Get audit logs",
    description="Get audit logs with optional filtering (admin only)"
)
async def get_audit_logs(
    event_type: Optional[AuditEventType] = Query(None, description="Filter by event type"),
    severity: Optional[AuditSeverity] = Query(None, description="Filter by severity"),
    username: Optional[str] = Query(None, description="Filter by username"),
    ip_address: Optional[str] = Query(None, description="Filter by IP address"),
    success: Optional[bool] = Query(None, description="Filter by success status"),
    hours: int = Query(24, ge=1, le=720, description="Look back period in hours"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of logs to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get audit logs with filtering options
    
    Requires admin role
    """
    # Build query
    query = db.query(AuditLog)
    
    # Apply filters
    if event_type:
        query = query.filter(AuditLog.event_type == event_type)
    
    if severity:
        query = query.filter(AuditLog.severity == severity)
    
    if username:
        query = query.filter(AuditLog.username == username)
    
    if ip_address:
        query = query.filter(AuditLog.ip_address == ip_address)
    
    if success is not None:
        query = query.filter(AuditLog.success == success)
    
    # Time filter
    since = datetime.utcnow() - timedelta(hours=hours)
    query = query.filter(AuditLog.created_at >= since)
    
    # Get total count
    total = query.count()
    
    # Get logs
    logs = query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    
    return AuditLogsListResponse(
        total=total,
        logs=[audit_log_to_response(log) for log in logs]
    )


@audit_router.get(
    "/logs/me",
    response_model=AuditLogsListResponse,
    summary="Get my audit logs",
    description="Get audit logs for current user"
)
async def get_my_audit_logs(
    event_type: Optional[AuditEventType] = Query(None, description="Filter by event type"),
    hours: int = Query(24, ge=1, le=720, description="Look back period in hours"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of logs to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get audit logs for current authenticated user
    
    Users can only see their own logs
    """
    audit_logger = AuditLogger(db)
    
    # Get user's logs
    event_types = [event_type] if event_type else None
    logs = audit_logger.get_user_activity(
        user_id=current_user.id,
        limit=limit,
        event_types=event_types
    )
    
    # Filter by time
    since = datetime.utcnow() - timedelta(hours=hours)
    logs = [log for log in logs if log.created_at >= since]
    
    return AuditLogsListResponse(
        total=len(logs),
        logs=[audit_log_to_response(log) for log in logs]
    )


@audit_router.get(
    "/security/summary",
    response_model=SecuritySummaryResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Get security summary",
    description="Get summary of security events (admin only)"
)
async def get_security_summary(
    hours: int = Query(24, ge=1, le=720, description="Look back period in hours"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get security event summary
    
    Provides counts of various security events in the specified time period
    Requires admin role
    """
    since = datetime.utcnow() - timedelta(hours=hours)
    
    # Count different event types
    failed_logins = db.query(AuditLog).filter(
        AuditLog.event_type == AuditEventType.LOGIN_FAILED,
        AuditLog.created_at >= since
    ).count()
    
    token_reuse = db.query(AuditLog).filter(
        AuditLog.event_type == AuditEventType.TOKEN_REUSE_DETECTED,
        AuditLog.created_at >= since
    ).count()
    
    rate_limits = db.query(AuditLog).filter(
        AuditLog.event_type == AuditEventType.RATE_LIMIT_EXCEEDED,
        AuditLog.created_at >= since
    ).count()
    
    lockouts = db.query(AuditLog).filter(
        AuditLog.event_type == AuditEventType.ACCOUNT_LOCKED,
        AuditLog.created_at >= since
    ).count()
    
    suspicious = db.query(AuditLog).filter(
        AuditLog.event_type == AuditEventType.SUSPICIOUS_ACTIVITY,
        AuditLog.created_at >= since
    ).count()
    
    total = db.query(AuditLog).filter(
        AuditLog.severity.in_([AuditSeverity.WARNING, AuditSeverity.ERROR, AuditSeverity.CRITICAL]),
        AuditLog.created_at >= since
    ).count()
    
    return SecuritySummaryResponse(
        total_events=total,
        failed_logins=failed_logins,
        token_reuse_attempts=token_reuse,
        rate_limit_violations=rate_limits,
        account_lockouts=lockouts,
        suspicious_activities=suspicious,
        period_hours=hours
    )


@audit_router.get(
    "/security/failed-logins",
    response_model=AuditLogsListResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Get failed login attempts",
    description="Get failed login attempts (admin only)"
)
async def get_failed_logins(
    username: Optional[str] = Query(None, description="Filter by username"),
    ip_address: Optional[str] = Query(None, description="Filter by IP address"),
    hours: int = Query(24, ge=1, le=720, description="Look back period in hours"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of logs to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get failed login attempts
    
    Useful for detecting brute force attacks
    Requires admin role
    """
    audit_logger = AuditLogger(db)
    since = datetime.utcnow() - timedelta(hours=hours)
    
    logs = audit_logger.get_failed_login_attempts(
        username=username,
        ip_address=ip_address,
        since=since,
        limit=limit
    )
    
    return AuditLogsListResponse(
        total=len(logs),
        logs=[audit_log_to_response(log) for log in logs]
    )


@audit_router.get(
    "/security/token-reuse",
    response_model=AuditLogsListResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Get token reuse attempts",
    description="Get token reuse detection events (admin only)"
)
async def get_token_reuse_attempts(
    hours: int = Query(24, ge=1, le=720, description="Look back period in hours"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of logs to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get token reuse attempts (critical security events)
    
    Token reuse indicates possible token theft
    Requires admin role
    """
    audit_logger = AuditLogger(db)
    since = datetime.utcnow() - timedelta(hours=hours)
    
    logs = audit_logger.get_token_reuse_attempts(
        since=since,
        limit=limit
    )
    
    return AuditLogsListResponse(
        total=len(logs),
        logs=[audit_log_to_response(log) for log in logs]
    )


@audit_router.get(
    "/activity/ip/{ip_address}",
    response_model=AuditLogsListResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Get activity by IP address",
    description="Get all activity from specific IP address (admin only)"
)
async def get_activity_by_ip(
    ip_address: str,
    hours: int = Query(24, ge=1, le=720, description="Look back period in hours"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of logs to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all activity from specific IP address
    
    Useful for investigating suspicious IP addresses
    Requires admin role
    """
    audit_logger = AuditLogger(db)
    since = datetime.utcnow() - timedelta(hours=hours)
    
    logs = audit_logger.get_activity_by_ip(
        ip_address=ip_address,
        since=since,
        limit=limit
    )
    
    return AuditLogsListResponse(
        total=len(logs),
        logs=[audit_log_to_response(log) for log in logs]
    )


@audit_router.get(
    "/activity/user/{user_id}",
    response_model=AuditLogsListResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Get activity by user ID",
    description="Get all activity for specific user (admin only)"
)
async def get_activity_by_user(
    user_id: int,
    hours: int = Query(24, ge=1, le=720, description="Look back period in hours"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of logs to return"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all activity for specific user
    
    Requires admin role
    """
    audit_logger = AuditLogger(db)
    
    logs = audit_logger.get_user_activity(
        user_id=user_id,
        limit=limit
    )
    
    # Filter by time
    since = datetime.utcnow() - timedelta(hours=hours)
    logs = [log for log in logs if log.created_at >= since]
    
    return AuditLogsListResponse(
        total=len(logs),
        logs=[audit_log_to_response(log) for log in logs]
    )
