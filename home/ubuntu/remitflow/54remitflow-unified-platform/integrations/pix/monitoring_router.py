"""
Monitoring API Router
Provides endpoints for querying failed login statistics and monitoring data
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Dict, Any, List

from .database import get_db
from .monitoring_service import MonitoringService, get_monitoring_service, metrics
from .auth import require_role

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


@router.get("/metrics", response_model=Dict[str, Any])
async def get_metrics(
    current_user: dict = Depends(require_role(["admin"]))
):
    """
    Get current monitoring metrics
    
    **Requires**: Admin role
    
    **Returns**:
    - failed_login_count: Total failed logins since last reset
    - successful_login_count: Total successful logins
    - locked_accounts_count: Total accounts locked
    - suspicious_ips_count: Number of flagged IPs
    - failed_attempts_by_ip: Failed attempts grouped by IP
    - failed_attempts_by_username: Failed attempts grouped by username
    - last_reset: Timestamp of last metrics reset
    """
    return metrics.get_metrics()


@router.get("/failed-logins/stats", response_model=Dict[str, Any])
async def get_failed_login_stats(
    hours: int = Query(24, ge=1, le=168, description="Number of hours to analyze (1-168)"),
    monitoring_service: MonitoringService = Depends(get_monitoring_service),
    current_user: dict = Depends(require_role(["admin", "pix_operator"]))
):
    """
    Get failed login statistics for the last N hours
    
    **Requires**: Admin or PIX Operator role
    
    **Parameters**:
    - hours: Number of hours to analyze (default: 24, max: 168/7 days)
    
    **Returns**:
    - period_hours: Analysis period
    - total_failed_logins: Total failed login attempts
    - locked_accounts: Number of accounts locked
    - top_ips: Top 10 IPs by failed attempts
    - top_usernames: Top 10 usernames by failed attempts
    - current_metrics: Real-time metrics
    """
    return monitoring_service.get_failed_login_stats(hours=hours)


@router.get("/suspicious-ips", response_model=List[Dict[str, Any]])
async def get_suspicious_ips(
    hours: int = Query(24, ge=1, le=168, description="Number of hours to analyze"),
    monitoring_service: MonitoringService = Depends(get_monitoring_service),
    current_user: dict = Depends(require_role(["admin", "pix_operator"]))
):
    """
    Get list of suspicious IP addresses
    
    **Requires**: Admin or PIX Operator role
    
    **Parameters**:
    - hours: Number of hours to analyze (default: 24)
    
    **Returns**: List of suspicious IPs with:
    - ip_address: IP address
    - failed_attempts: Number of failed login attempts
    - unique_usernames: Number of different usernames tried
    - last_attempt: Timestamp of last attempt
    - risk_level: "critical" or "high"
    
    **Criteria for suspicious IPs**:
    - 10+ failed logins in the period
    - OR 5+ different usernames tried
    """
    return monitoring_service.get_suspicious_ips(hours=hours)


@router.get("/targeted-accounts", response_model=List[Dict[str, Any]])
async def get_targeted_accounts(
    hours: int = Query(24, ge=1, le=168, description="Number of hours to analyze"),
    monitoring_service: MonitoringService = Depends(get_monitoring_service),
    current_user: dict = Depends(require_role(["admin", "pix_operator"]))
):
    """
    Get list of accounts under attack
    
    **Requires**: Admin or PIX Operator role
    
    **Parameters**:
    - hours: Number of hours to analyze (default: 24)
    
    **Returns**: List of targeted accounts with:
    - username: Account username
    - failed_attempts: Number of failed login attempts
    - unique_ips: Number of different IPs targeting this account
    - last_attempt: Timestamp of last attempt
    - attack_type: "distributed" (multiple IPs) or "brute_force" (single/few IPs)
    
    **Criteria for targeted accounts**:
    - 5+ failed logins in the period
    - OR 10+ different IPs targeting the account
    """
    return monitoring_service.get_targeted_accounts(hours=hours)


@router.get("/dashboard", response_model=Dict[str, Any])
async def get_monitoring_dashboard(
    hours: int = Query(24, ge=1, le=168, description="Number of hours to analyze"),
    monitoring_service: MonitoringService = Depends(get_monitoring_service),
    current_user: dict = Depends(require_role(["admin"]))
):
    """
    Get comprehensive monitoring dashboard data
    
    **Requires**: Admin role
    
    **Parameters**:
    - hours: Number of hours to analyze (default: 24)
    
    **Returns**: Complete monitoring overview including:
    - stats: Failed login statistics
    - suspicious_ips: List of suspicious IP addresses
    - targeted_accounts: List of accounts under attack
    - current_metrics: Real-time metrics
    - alert_thresholds: Current alert thresholds
    """
    from .monitoring_service import AlertThresholds
    
    stats = monitoring_service.get_failed_login_stats(hours=hours)
    suspicious_ips = monitoring_service.get_suspicious_ips(hours=hours)
    targeted_accounts = monitoring_service.get_targeted_accounts(hours=hours)
    
    return {
        "period_hours": hours,
        "stats": stats,
        "suspicious_ips": suspicious_ips,
        "targeted_accounts": targeted_accounts,
        "alert_thresholds": {
            "failed_logins_per_ip_hour": AlertThresholds.FAILED_LOGINS_PER_IP_HOUR,
            "failed_logins_per_username_hour": AlertThresholds.FAILED_LOGINS_PER_USERNAME_HOUR,
            "failed_logins_total_hour": AlertThresholds.FAILED_LOGINS_TOTAL_HOUR,
            "locked_accounts_hour": AlertThresholds.LOCKED_ACCOUNTS_HOUR,
            "unique_usernames_per_ip": AlertThresholds.UNIQUE_USERNAMES_PER_IP,
            "distributed_attack_ips": AlertThresholds.DISTRIBUTED_ATTACK_IPS
        }
    }


@router.post("/test-alert")
async def test_alert(
    monitoring_service: MonitoringService = Depends(get_monitoring_service),
    current_user: dict = Depends(require_role(["admin"]))
):
    """
    Send a test alert to verify email/webhook configuration
    
    **Requires**: Admin role
    
    **Returns**: Confirmation message
    """
    monitoring_service._send_alert(
        alert_type="test_alert",
        subject="Test Alert - PIX Integration Monitoring",
        message="This is a test alert to verify that your monitoring alerts are configured correctly.",
        severity="info",
        context={"test": True, "triggered_by": current_user.get("username")}
    )
    
    return {
        "message": "Test alert sent successfully",
        "note": "Check your email and webhook endpoints for the test alert"
    }
