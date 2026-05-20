"""
Fraud Detection Service Integration with Permify Authorization
Integrates authorization checks into fraud detection operations
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum

from service.authorization_service import AuthorizationService, get_authorization_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class FraudCaseStatus(Enum):
    """Fraud case status"""
    OPEN = "open"
    INVESTIGATING = "investigating"
    ESCALATED = "escalated"
    RESOLVED = "resolved"
    CLOSED = "closed"


class FraudServiceIntegration:
    """
    Fraud detection service with integrated authorization
    """
    
    def __init__(self, auth_service: Optional[AuthorizationService] = None):
        """
        Initialize fraud service integration
        
        Args:
            auth_service: Authorization service instance
        """
        self.auth_service = auth_service or get_authorization_service()
        logger.info("Fraud service integration initialized")
    
    async def flag_suspicious_transaction(
        self,
        user_id: str,
        transaction_id: str,
        reason: str,
        risk_score: float,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Flag transaction as suspicious with authorization check
        
        Args:
            user_id: User flagging the transaction
            transaction_id: Transaction ID
            reason: Reason for flagging
            risk_score: Risk score (0-100)
            metadata: Additional metadata
        
        Returns:
            Fraud case record
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_flag = await self.auth_service.can_flag_transaction_suspicious(user_id, transaction_id)
        
        if not can_flag:
            logger.warning(f"Transaction flagging denied: user={user_id}, transaction={transaction_id}")
            raise PermissionError(f"User {user_id} cannot flag transaction {transaction_id}")
        
        # Create fraud case
        case_id = f"fraud_{datetime.utcnow().timestamp()}"
        
        # Setup permissions
        await self.auth_service.client.create_relationship(
            entity_type="fraud_case",
            entity_id=case_id,
            relation="investigator",
            subject_type="user",
            subject_id=user_id
        )
        
        logger.info(f"Transaction flagged as suspicious: case={case_id}, transaction={transaction_id}, risk={risk_score}")
        
        return {
            "case_id": case_id,
            "transaction_id": transaction_id,
            "status": FraudCaseStatus.OPEN.value,
            "reason": reason,
            "risk_score": risk_score,
            "flagged_by": user_id,
            "flagged_at": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }
    
    async def investigate_fraud_case(
        self,
        user_id: str,
        case_id: str,
        investigation_notes: str,
        findings: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Investigate fraud case with authorization check
        
        Args:
            user_id: User investigating the case
            case_id: Fraud case ID
            investigation_notes: Investigation notes
            findings: Investigation findings
        
        Returns:
            Investigation result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_investigate = await self.auth_service.can_investigate_fraud_case(user_id, case_id)
        
        if not can_investigate:
            logger.warning(f"Fraud investigation denied: user={user_id}, case={case_id}")
            raise PermissionError(f"User {user_id} cannot investigate case {case_id}")
        
        # Log authorized investigation
        logger.info(f"Fraud case investigation updated: user={user_id}, case={case_id}")
        
        return {
            "case_id": case_id,
            "status": FraudCaseStatus.INVESTIGATING.value,
            "investigated_by": user_id,
            "investigated_at": datetime.utcnow().isoformat(),
            "investigation_notes": investigation_notes,
            "findings": findings
        }
    
    async def approve_fraud_case_resolution(
        self,
        user_id: str,
        case_id: str,
        resolution: str,
        action_taken: str
    ) -> Dict[str, Any]:
        """
        Approve fraud case resolution with authorization check
        
        Args:
            user_id: User approving the resolution
            case_id: Fraud case ID
            resolution: Resolution description
            action_taken: Action taken
        
        Returns:
            Approval result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_approve = await self.auth_service.can_approve_fraud_case(user_id, case_id)
        
        if not can_approve:
            logger.warning(f"Fraud case approval denied: user={user_id}, case={case_id}")
            raise PermissionError(f"User {user_id} cannot approve case {case_id}")
        
        # Log authorized approval
        logger.info(f"Fraud case resolution approved: user={user_id}, case={case_id}")
        
        return {
            "case_id": case_id,
            "status": FraudCaseStatus.RESOLVED.value,
            "resolution": resolution,
            "action_taken": action_taken,
            "approved_by": user_id,
            "approved_at": datetime.utcnow().isoformat()
        }
    
    async def assign_fraud_investigator(
        self,
        admin_user_id: str,
        case_id: str,
        investigator_user_id: str
    ) -> bool:
        """
        Assign investigator to fraud case
        
        Args:
            admin_user_id: Admin assigning the investigator
            case_id: Fraud case ID
            investigator_user_id: Investigator user ID
        
        Returns:
            True if successful
        """
        # Assign investigator relationship
        await self.auth_service.client.create_relationship(
            entity_type="fraud_case",
            entity_id=case_id,
            relation="investigator",
            subject_type="user",
            subject_id=investigator_user_id
        )
        
        logger.info(f"Fraud investigator assigned: case={case_id}, investigator={investigator_user_id}")
        return True

