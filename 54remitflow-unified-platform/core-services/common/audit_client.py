"""
Audit Service Client
Provides audit logging for all critical operations across services
"""

import httpx
import os
import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum
from datetime import datetime

logger = logging.getLogger(__name__)

AUDIT_SERVICE_URL = os.getenv("AUDIT_SERVICE_URL", "http://audit-service:8016")
AUDIT_TIMEOUT = float(os.getenv("AUDIT_TIMEOUT", "3.0"))
AUDIT_ASYNC = os.getenv("AUDIT_ASYNC", "true").lower() == "true"


class AuditEventType(str, Enum):
    # Authentication events
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    PASSWORD_CHANGE = "password_change"
    MFA_ENABLED = "mfa_enabled"
    MFA_DISABLED = "mfa_disabled"
    
    # Transaction events
    TRANSACTION_CREATED = "transaction_created"
    TRANSACTION_APPROVED = "transaction_approved"
    TRANSACTION_REJECTED = "transaction_rejected"
    TRANSACTION_COMPLETED = "transaction_completed"
    TRANSACTION_FAILED = "transaction_failed"
    TRANSACTION_CANCELLED = "transaction_cancelled"
    
    # KYC events
    KYC_SUBMITTED = "kyc_submitted"
    KYC_APPROVED = "kyc_approved"
    KYC_REJECTED = "kyc_rejected"
    KYC_TIER_UPGRADED = "kyc_tier_upgraded"
    
    # Compliance events
    COMPLIANCE_CHECK_PASSED = "compliance_check_passed"
    COMPLIANCE_CHECK_FAILED = "compliance_check_failed"
    SANCTIONS_MATCH = "sanctions_match"
    PEP_MATCH = "pep_match"
    SAR_FILED = "sar_filed"
    
    # Risk events
    RISK_ASSESSMENT_COMPLETED = "risk_assessment_completed"
    RISK_BLOCKED = "risk_blocked"
    RISK_REVIEW_REQUIRED = "risk_review_required"
    
    # Limit events
    LIMIT_CHECK_PASSED = "limit_check_passed"
    LIMIT_CHECK_FAILED = "limit_check_failed"
    LIMIT_EXCEEDED = "limit_exceeded"
    
    # Wallet events
    WALLET_CREATED = "wallet_created"
    WALLET_CREDITED = "wallet_credited"
    WALLET_DEBITED = "wallet_debited"
    WALLET_FROZEN = "wallet_frozen"
    WALLET_UNFROZEN = "wallet_unfrozen"
    
    # Dispute events
    DISPUTE_CREATED = "dispute_created"
    DISPUTE_RESOLVED = "dispute_resolved"
    CHARGEBACK_INITIATED = "chargeback_initiated"
    CHARGEBACK_COMPLETED = "chargeback_completed"
    
    # Admin events
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_SUSPENDED = "user_suspended"
    USER_REACTIVATED = "user_reactivated"
    PERMISSION_CHANGED = "permission_changed"
    CONFIG_CHANGED = "config_changed"
    
    # System events
    SERVICE_STARTED = "service_started"
    SERVICE_STOPPED = "service_stopped"
    ERROR_OCCURRED = "error_occurred"
    
    # Authorization/PBAC events
    AUTHORIZATION_CHECK = "authorization_check"
    AUTHORIZATION_DENIED = "authorization_denied"
    POLICY_EVALUATED = "policy_evaluated"
    POLICY_UPDATED = "policy_updated"


class AuditSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


@dataclass
class AuditEvent:
    """Audit event to be logged"""
    event_type: AuditEventType
    service_name: str
    user_id: Optional[str]
    resource_type: str
    resource_id: str
    action: str
    severity: AuditSeverity
    details: Dict[str, Any]
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    correlation_id: Optional[str] = None
    timestamp: Optional[str] = None


class AuditServiceError(Exception):
    """Error from audit service"""
    pass


async def log_audit_event(
    event_type: AuditEventType,
    service_name: str,
    resource_type: str,
    resource_id: str,
    action: str,
    user_id: Optional[str] = None,
    severity: AuditSeverity = AuditSeverity.INFO,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    correlation_id: Optional[str] = None
) -> Optional[str]:
    """
    Log an audit event to the audit service.
    
    Args:
        event_type: Type of audit event
        service_name: Name of the service logging the event
        resource_type: Type of resource (e.g., "transaction", "user", "wallet")
        resource_id: ID of the resource
        action: Action performed (e.g., "create", "update", "delete")
        user_id: Optional user ID who performed the action
        severity: Severity level of the event
        details: Additional details about the event
        ip_address: Optional IP address of the request
        user_agent: Optional user agent string
        correlation_id: Optional correlation ID for request tracing
    
    Returns:
        Event ID if successful, None if failed (non-blocking)
    """
    event_payload = {
        "event_type": event_type.value,
        "service_name": service_name,
        "user_id": user_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": action,
        "severity": severity.value,
        "details": details or {},
        "ip_address": ip_address,
        "user_agent": user_agent,
        "correlation_id": correlation_id,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    try:
        async with httpx.AsyncClient(timeout=AUDIT_TIMEOUT) as client:
            response = await client.post(
                f"{AUDIT_SERVICE_URL}/api/v1/audit/log",
                json=event_payload
            )
        
        if response.status_code == 200 or response.status_code == 201:
            data = response.json()
            return data.get("event_id")
        else:
            logger.warning(f"Audit service returned {response.status_code}: {response.text}")
            return None
    
    except httpx.RequestError as e:
        # Audit logging should never block the main flow
        logger.warning(f"Failed to log audit event: {e}")
        return None
    except Exception as e:
        logger.warning(f"Unexpected error logging audit event: {e}")
        return None


def log_audit_event_sync(
    event_type: AuditEventType,
    service_name: str,
    resource_type: str,
    resource_id: str,
    action: str,
    user_id: Optional[str] = None,
    severity: AuditSeverity = AuditSeverity.INFO,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    correlation_id: Optional[str] = None
) -> Optional[str]:
    """
    Synchronous version of log_audit_event for non-async contexts.
    """
    import httpx
    
    event_payload = {
        "event_type": event_type.value,
        "service_name": service_name,
        "user_id": user_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": action,
        "severity": severity.value,
        "details": details or {},
        "ip_address": ip_address,
        "user_agent": user_agent,
        "correlation_id": correlation_id,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    try:
        with httpx.Client(timeout=AUDIT_TIMEOUT) as client:
            response = client.post(
                f"{AUDIT_SERVICE_URL}/api/v1/audit/log",
                json=event_payload
            )
        
        if response.status_code == 200 or response.status_code == 201:
            data = response.json()
            return data.get("event_id")
        else:
            logger.warning(f"Audit service returned {response.status_code}")
            return None
    
    except Exception as e:
        logger.warning(f"Failed to log audit event: {e}")
        return None


# Convenience functions for common audit events

async def audit_transaction_created(
    service_name: str,
    transaction_id: str,
    user_id: str,
    amount: float,
    currency: str,
    transaction_type: str,
    details: Optional[Dict[str, Any]] = None
) -> Optional[str]:
    """Log a transaction creation event"""
    return await log_audit_event(
        event_type=AuditEventType.TRANSACTION_CREATED,
        service_name=service_name,
        resource_type="transaction",
        resource_id=transaction_id,
        action="create",
        user_id=user_id,
        severity=AuditSeverity.INFO,
        details={
            "amount": amount,
            "currency": currency,
            "transaction_type": transaction_type,
            **(details or {})
        }
    )


async def audit_compliance_check(
    service_name: str,
    user_id: str,
    transaction_id: str,
    passed: bool,
    risk_level: str,
    details: Optional[Dict[str, Any]] = None
) -> Optional[str]:
    """Log a compliance check event"""
    event_type = AuditEventType.COMPLIANCE_CHECK_PASSED if passed else AuditEventType.COMPLIANCE_CHECK_FAILED
    severity = AuditSeverity.INFO if passed else AuditSeverity.WARNING
    
    return await log_audit_event(
        event_type=event_type,
        service_name=service_name,
        resource_type="transaction",
        resource_id=transaction_id,
        action="compliance_check",
        user_id=user_id,
        severity=severity,
        details={
            "passed": passed,
            "risk_level": risk_level,
            **(details or {})
        }
    )


async def audit_risk_assessment(
    service_name: str,
    user_id: str,
    transaction_id: str,
    decision: str,
    risk_score: int,
    details: Optional[Dict[str, Any]] = None
) -> Optional[str]:
    """Log a risk assessment event"""
    if decision == "block":
        event_type = AuditEventType.RISK_BLOCKED
        severity = AuditSeverity.WARNING
    elif decision == "review":
        event_type = AuditEventType.RISK_REVIEW_REQUIRED
        severity = AuditSeverity.WARNING
    else:
        event_type = AuditEventType.RISK_ASSESSMENT_COMPLETED
        severity = AuditSeverity.INFO
    
    return await log_audit_event(
        event_type=event_type,
        service_name=service_name,
        resource_type="transaction",
        resource_id=transaction_id,
        action="risk_assessment",
        user_id=user_id,
        severity=severity,
        details={
            "decision": decision,
            "risk_score": risk_score,
            **(details or {})
        }
    )


async def audit_kyc_event(
    service_name: str,
    user_id: str,
    event_type: AuditEventType,
    tier: str,
    details: Optional[Dict[str, Any]] = None
) -> Optional[str]:
    """Log a KYC event"""
    return await log_audit_event(
        event_type=event_type,
        service_name=service_name,
        resource_type="kyc_profile",
        resource_id=user_id,
        action="kyc_update",
        user_id=user_id,
        severity=AuditSeverity.INFO,
        details={
            "tier": tier,
            **(details or {})
        }
    )


async def audit_wallet_event(
    service_name: str,
    user_id: str,
    wallet_id: str,
    event_type: AuditEventType,
    amount: Optional[float] = None,
    currency: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None
) -> Optional[str]:
    """Log a wallet event"""
    return await log_audit_event(
        event_type=event_type,
        service_name=service_name,
        resource_type="wallet",
        resource_id=wallet_id,
        action="wallet_update",
        user_id=user_id,
        severity=AuditSeverity.INFO,
        details={
            "amount": amount,
            "currency": currency,
            **(details or {})
        }
    )


async def audit_dispute_event(
    service_name: str,
    user_id: str,
    dispute_id: str,
    event_type: AuditEventType,
    transaction_id: str,
    details: Optional[Dict[str, Any]] = None
) -> Optional[str]:
    """Log a dispute event"""
    return await log_audit_event(
        event_type=event_type,
        service_name=service_name,
        resource_type="dispute",
        resource_id=dispute_id,
        action="dispute_update",
        user_id=user_id,
        severity=AuditSeverity.WARNING,
        details={
            "transaction_id": transaction_id,
            **(details or {})
        }
    )
