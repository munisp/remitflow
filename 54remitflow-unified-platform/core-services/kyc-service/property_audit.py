"""
Property Transaction KYC Audit Logging
Comprehensive audit trail for all property transaction actions
"""

import os
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from dataclasses import dataclass, asdict
from enum import Enum
import json
import uuid

logger = logging.getLogger(__name__)

# Audit configuration
AUDIT_SERVICE_URL = os.getenv("AUDIT_SERVICE_URL", "http://audit-service:8000")
AUDIT_ENABLED = os.getenv("AUDIT_ENABLED", "true").lower() == "true"
AUDIT_LOG_TO_FILE = os.getenv("AUDIT_LOG_TO_FILE", "false").lower() == "true"
AUDIT_LOG_FILE = os.getenv("AUDIT_LOG_FILE", "/var/log/property-kyc-audit.jsonl")


class AuditActionType(str, Enum):
    # Transaction lifecycle
    TRANSACTION_CREATED = "transaction_created"
    TRANSACTION_UPDATED = "transaction_updated"
    TRANSACTION_STATUS_CHANGED = "transaction_status_changed"
    TRANSACTION_SUBMITTED = "transaction_submitted"
    TRANSACTION_APPROVED = "transaction_approved"
    TRANSACTION_REJECTED = "transaction_rejected"
    TRANSACTION_CANCELLED = "transaction_cancelled"
    
    # Party actions
    PARTY_CREATED = "party_created"
    PARTY_UPDATED = "party_updated"
    PARTY_KYC_VERIFIED = "party_kyc_verified"
    PARTY_KYC_REJECTED = "party_kyc_rejected"
    PARTY_SCREENING_COMPLETED = "party_screening_completed"
    
    # Document actions
    DOCUMENT_UPLOADED = "document_uploaded"
    DOCUMENT_VERIFIED = "document_verified"
    DOCUMENT_REJECTED = "document_rejected"
    DOCUMENT_DOWNLOADED = "document_downloaded"
    DOCUMENT_DELETED = "document_deleted"
    
    # Source of funds
    SOURCE_OF_FUNDS_DECLARED = "source_of_funds_declared"
    SOURCE_OF_FUNDS_VERIFIED = "source_of_funds_verified"
    SOURCE_OF_FUNDS_REJECTED = "source_of_funds_rejected"
    
    # Bank statements
    BANK_STATEMENT_UPLOADED = "bank_statement_uploaded"
    BANK_STATEMENT_VERIFIED = "bank_statement_verified"
    BANK_STATEMENT_COVERAGE_VALIDATED = "bank_statement_coverage_validated"
    
    # Income documents
    INCOME_DOCUMENT_UPLOADED = "income_document_uploaded"
    INCOME_DOCUMENT_VERIFIED = "income_document_verified"
    
    # Purchase agreement
    PURCHASE_AGREEMENT_UPLOADED = "purchase_agreement_uploaded"
    PURCHASE_AGREEMENT_VERIFIED = "purchase_agreement_verified"
    PURCHASE_AGREEMENT_PARTIES_VALIDATED = "purchase_agreement_parties_validated"
    
    # Compliance
    COMPLIANCE_SCREENING_INITIATED = "compliance_screening_initiated"
    COMPLIANCE_SCREENING_COMPLETED = "compliance_screening_completed"
    COMPLIANCE_CASE_CREATED = "compliance_case_created"
    RISK_SCORE_CALCULATED = "risk_score_calculated"
    
    # Review actions
    REVIEWER_ASSIGNED = "reviewer_assigned"
    REVIEWER_NOTE_ADDED = "reviewer_note_added"
    CHECKLIST_VIEWED = "checklist_viewed"
    
    # Access
    TRANSACTION_VIEWED = "transaction_viewed"
    DOCUMENT_ACCESS_REQUESTED = "document_access_requested"


class AuditActorType(str, Enum):
    USER = "user"
    SYSTEM = "system"
    REVIEWER = "reviewer"
    ADMIN = "admin"
    SERVICE = "service"


@dataclass
class AuditContext:
    """Context information for audit logging"""
    correlation_id: str
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    session_id: Optional[str] = None
    request_id: Optional[str] = None


@dataclass
class AuditEntry:
    """Audit log entry"""
    id: str
    timestamp: str
    action: AuditActionType
    actor_id: Optional[str]
    actor_type: AuditActorType
    transaction_id: str
    resource_type: Optional[str]
    resource_id: Optional[str]
    old_value: Optional[Dict[str, Any]]
    new_value: Optional[Dict[str, Any]]
    details: Optional[Dict[str, Any]]
    context: AuditContext
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "action": self.action.value,
            "actor_id": self.actor_id,
            "actor_type": self.actor_type.value,
            "transaction_id": self.transaction_id,
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "details": self.details,
            "context": asdict(self.context)
        }


class PropertyAuditLogger:
    """Audit logger for property transactions"""
    
    def __init__(self):
        self._file_handle = None
        if AUDIT_LOG_TO_FILE:
            try:
                os.makedirs(os.path.dirname(AUDIT_LOG_FILE), exist_ok=True)
                self._file_handle = open(AUDIT_LOG_FILE, "a")
            except Exception as e:
                logger.warning(f"Could not open audit log file: {e}")
    
    def _generate_id(self) -> str:
        return str(uuid.uuid4())
    
    def _get_timestamp(self) -> str:
        return datetime.utcnow().isoformat() + "Z"
    
    def _write_to_file(self, entry: AuditEntry):
        if self._file_handle:
            try:
                self._file_handle.write(json.dumps(entry.to_dict()) + "\n")
                self._file_handle.flush()
            except Exception as e:
                logger.error(f"Failed to write audit log to file: {e}")
    
    async def _send_to_service(self, entry: AuditEntry):
        """Send audit entry to central audit service"""
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{AUDIT_SERVICE_URL}/api/v1/audit",
                    json=entry.to_dict(),
                    timeout=5.0
                )
                if response.status_code != 200:
                    logger.warning(f"Audit service returned {response.status_code}")
        except Exception as e:
            logger.warning(f"Failed to send audit to service: {e}")
            # Fall back to file logging
            self._write_to_file(entry)
    
    async def log(
        self,
        action: AuditActionType,
        transaction_id: str,
        actor_id: Optional[str] = None,
        actor_type: AuditActorType = AuditActorType.SYSTEM,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        old_value: Optional[Dict[str, Any]] = None,
        new_value: Optional[Dict[str, Any]] = None,
        details: Optional[Dict[str, Any]] = None,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        """Log an audit entry"""
        if not AUDIT_ENABLED:
            return None
        
        if context is None:
            context = AuditContext(correlation_id=self._generate_id())
        
        entry = AuditEntry(
            id=self._generate_id(),
            timestamp=self._get_timestamp(),
            action=action,
            actor_id=actor_id,
            actor_type=actor_type,
            transaction_id=transaction_id,
            resource_type=resource_type,
            resource_id=resource_id,
            old_value=old_value,
            new_value=new_value,
            details=details,
            context=context
        )
        
        # Log locally
        logger.info(f"AUDIT: {action.value} on transaction {transaction_id} by {actor_type.value}:{actor_id}")
        
        # Write to file if enabled
        if AUDIT_LOG_TO_FILE:
            self._write_to_file(entry)
        
        # Send to audit service
        await self._send_to_service(entry)
        
        return entry
    
    # Convenience methods for common actions
    
    async def log_transaction_created(
        self,
        transaction_id: str,
        buyer_id: str,
        property_address: str,
        purchase_price: float,
        actor_id: Optional[str] = None,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.TRANSACTION_CREATED,
            transaction_id=transaction_id,
            actor_id=actor_id,
            actor_type=AuditActorType.USER if actor_id else AuditActorType.SYSTEM,
            resource_type="transaction",
            resource_id=transaction_id,
            new_value={
                "buyer_id": buyer_id,
                "property_address": property_address,
                "purchase_price": purchase_price
            },
            context=context
        )
    
    async def log_status_change(
        self,
        transaction_id: str,
        old_status: str,
        new_status: str,
        reason: str,
        actor_id: Optional[str] = None,
        actor_type: AuditActorType = AuditActorType.SYSTEM,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.TRANSACTION_STATUS_CHANGED,
            transaction_id=transaction_id,
            actor_id=actor_id,
            actor_type=actor_type,
            resource_type="transaction",
            resource_id=transaction_id,
            old_value={"status": old_status},
            new_value={"status": new_status},
            details={"reason": reason},
            context=context
        )
    
    async def log_party_verified(
        self,
        transaction_id: str,
        party_id: str,
        party_role: str,
        verified_by: str,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.PARTY_KYC_VERIFIED,
            transaction_id=transaction_id,
            actor_id=verified_by,
            actor_type=AuditActorType.REVIEWER,
            resource_type="party",
            resource_id=party_id,
            details={"party_role": party_role},
            context=context
        )
    
    async def log_document_uploaded(
        self,
        transaction_id: str,
        document_id: str,
        document_type: str,
        storage_key: str,
        document_hash: str,
        actor_id: Optional[str] = None,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.DOCUMENT_UPLOADED,
            transaction_id=transaction_id,
            actor_id=actor_id,
            actor_type=AuditActorType.USER if actor_id else AuditActorType.SYSTEM,
            resource_type="document",
            resource_id=document_id,
            new_value={
                "document_type": document_type,
                "storage_key": storage_key,
                "document_hash": document_hash
            },
            context=context
        )
    
    async def log_document_verified(
        self,
        transaction_id: str,
        document_id: str,
        document_type: str,
        verified_by: str,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.DOCUMENT_VERIFIED,
            transaction_id=transaction_id,
            actor_id=verified_by,
            actor_type=AuditActorType.REVIEWER,
            resource_type="document",
            resource_id=document_id,
            details={"document_type": document_type},
            context=context
        )
    
    async def log_compliance_screening(
        self,
        transaction_id: str,
        party_id: str,
        screening_id: str,
        result: str,
        risk_score: int,
        matches_found: int,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.COMPLIANCE_SCREENING_COMPLETED,
            transaction_id=transaction_id,
            actor_type=AuditActorType.SERVICE,
            resource_type="screening",
            resource_id=screening_id,
            new_value={
                "party_id": party_id,
                "result": result,
                "risk_score": risk_score,
                "matches_found": matches_found
            },
            context=context
        )
    
    async def log_risk_score_calculated(
        self,
        transaction_id: str,
        risk_score: int,
        risk_level: str,
        risk_flags: List[str],
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.RISK_SCORE_CALCULATED,
            transaction_id=transaction_id,
            actor_type=AuditActorType.SYSTEM,
            resource_type="transaction",
            resource_id=transaction_id,
            new_value={
                "risk_score": risk_score,
                "risk_level": risk_level,
                "risk_flags": risk_flags
            },
            context=context
        )
    
    async def log_transaction_approved(
        self,
        transaction_id: str,
        approved_by: str,
        notes: Optional[str] = None,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.TRANSACTION_APPROVED,
            transaction_id=transaction_id,
            actor_id=approved_by,
            actor_type=AuditActorType.REVIEWER,
            resource_type="transaction",
            resource_id=transaction_id,
            details={"notes": notes} if notes else None,
            context=context
        )
    
    async def log_transaction_rejected(
        self,
        transaction_id: str,
        rejected_by: str,
        reason: str,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.TRANSACTION_REJECTED,
            transaction_id=transaction_id,
            actor_id=rejected_by,
            actor_type=AuditActorType.REVIEWER,
            resource_type="transaction",
            resource_id=transaction_id,
            details={"reason": reason},
            context=context
        )
    
    async def log_checklist_viewed(
        self,
        transaction_id: str,
        viewer_id: str,
        context: Optional[AuditContext] = None
    ) -> AuditEntry:
        return await self.log(
            action=AuditActionType.CHECKLIST_VIEWED,
            transaction_id=transaction_id,
            actor_id=viewer_id,
            actor_type=AuditActorType.USER,
            resource_type="checklist",
            resource_id=transaction_id,
            context=context
        )


# Global audit logger instance
_audit_logger: Optional[PropertyAuditLogger] = None


def get_audit_logger() -> PropertyAuditLogger:
    """Get the global audit logger instance"""
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = PropertyAuditLogger()
    return _audit_logger
