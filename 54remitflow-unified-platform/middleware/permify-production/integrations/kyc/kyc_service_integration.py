"""
KYC Service Integration with Permify Authorization
Integrates authorization checks into KYC operations
"""

import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum

from service.authorization_service import AuthorizationService, get_authorization_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class KYCStatus(Enum):
    """KYC verification status"""
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    REQUIRES_UPDATE = "requires_update"


class KYCServiceIntegration:
    """
    KYC service with integrated authorization
    """
    
    def __init__(self, auth_service: Optional[AuthorizationService] = None):
        """
        Initialize KYC service integration
        
        Args:
            auth_service: Authorization service instance
        """
        self.auth_service = auth_service or get_authorization_service()
        logger.info("KYC service integration initialized")
    
    async def upload_kyc_document(
        self,
        user_id: str,
        document_type: str,
        document_data: bytes,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Upload KYC document
        
        Args:
            user_id: User uploading the document
            document_type: Document type (passport, id_card, etc.)
            document_data: Document binary data
            metadata: Additional metadata
        
        Returns:
            Upload result
        """
        # Create document record
        document_id = f"doc_{datetime.utcnow().timestamp()}"
        
        # Setup permissions (user is owner)
        await self.auth_service.client.create_relationship(
            entity_type="kyc_document",
            entity_id=document_id,
            relation="owner",
            subject_type="user",
            subject_id=user_id
        )
        
        logger.info(f"KYC document uploaded: user={user_id}, document={document_id}, type={document_type}")
        
        return {
            "document_id": document_id,
            "document_type": document_type,
            "status": "uploaded",
            "uploaded_by": user_id,
            "uploaded_at": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }
    
    async def verify_kyc_document(
        self,
        user_id: str,
        document_id: str,
        verification_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Verify KYC document with authorization check
        
        Args:
            user_id: User verifying the document (compliance officer)
            document_id: Document ID
            verification_result: Verification result data
        
        Returns:
            Verification result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_verify = await self.auth_service.can_verify_kyc_document(user_id, document_id)
        
        if not can_verify:
            logger.warning(f"Document verification denied: user={user_id}, document={document_id}")
            raise PermissionError(f"User {user_id} cannot verify document {document_id}")
        
        # Log authorized verification
        logger.info(f"KYC document verified: user={user_id}, document={document_id}")
        
        return {
            "document_id": document_id,
            "status": "verified",
            "verified_by": user_id,
            "verified_at": datetime.utcnow().isoformat(),
            "verification_result": verification_result
        }
    
    async def initiate_kyc_verification(
        self,
        user_id: str,
        subject_user_id: str,
        verification_type: str = "individual"
    ) -> Dict[str, Any]:
        """
        Initiate KYC verification process
        
        Args:
            user_id: User initiating the verification
            subject_user_id: User being verified
            verification_type: Type of verification (individual, business)
        
        Returns:
            Verification record
        """
        # Create verification record
        verification_id = f"kyc_{datetime.utcnow().timestamp()}"
        
        # Setup permissions
        await self.auth_service.client.create_relationship(
            entity_type="kyc_verification",
            entity_id=verification_id,
            relation="subject",
            subject_type="user",
            subject_id=subject_user_id
        )
        
        logger.info(f"KYC verification initiated: verification={verification_id}, subject={subject_user_id}, type={verification_type}")
        
        return {
            "verification_id": verification_id,
            "subject_user_id": subject_user_id,
            "verification_type": verification_type,
            "status": KYCStatus.PENDING.value,
            "initiated_by": user_id,
            "initiated_at": datetime.utcnow().isoformat()
        }
    
    async def approve_kyc_verification(
        self,
        user_id: str,
        verification_id: str,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Approve KYC verification with authorization check
        
        Args:
            user_id: User approving the verification (compliance officer)
            verification_id: Verification ID
            notes: Approval notes
        
        Returns:
            Approval result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_approve = await self.auth_service.can_approve_kyc(user_id, verification_id)
        
        if not can_approve:
            logger.warning(f"KYC approval denied: user={user_id}, verification={verification_id}")
            raise PermissionError(f"User {user_id} cannot approve verification {verification_id}")
        
        # Log authorized approval
        logger.info(f"KYC verification approved: user={user_id}, verification={verification_id}")
        
        return {
            "verification_id": verification_id,
            "status": KYCStatus.APPROVED.value,
            "approved_by": user_id,
            "approved_at": datetime.utcnow().isoformat(),
            "notes": notes
        }
    
    async def reject_kyc_verification(
        self,
        user_id: str,
        verification_id: str,
        reason: str
    ) -> Dict[str, Any]:
        """
        Reject KYC verification with authorization check
        
        Args:
            user_id: User rejecting the verification
            verification_id: Verification ID
            reason: Rejection reason
        
        Returns:
            Rejection result
        
        Raises:
            PermissionError: If user lacks permission
        """
        # Check authorization
        can_approve = await self.auth_service.can_approve_kyc(user_id, verification_id)
        
        if not can_approve:
            logger.warning(f"KYC rejection denied: user={user_id}, verification={verification_id}")
            raise PermissionError(f"User {user_id} cannot reject verification {verification_id}")
        
        # Log authorized rejection
        logger.info(f"KYC verification rejected: user={user_id}, verification={verification_id}, reason={reason}")
        
        return {
            "verification_id": verification_id,
            "status": KYCStatus.REJECTED.value,
            "rejected_by": user_id,
            "rejected_at": datetime.utcnow().isoformat(),
            "reason": reason
        }
    
    async def assign_kyc_reviewer(
        self,
        admin_user_id: str,
        verification_id: str,
        reviewer_user_id: str
    ) -> bool:
        """
        Assign reviewer to KYC verification
        
        Args:
            admin_user_id: Admin assigning the reviewer
            verification_id: Verification ID
            reviewer_user_id: Reviewer user ID
        
        Returns:
            True if successful
        """
        # Assign reviewer relationship
        await self.auth_service.client.create_relationship(
            entity_type="kyc_verification",
            entity_id=verification_id,
            relation="reviewer",
            subject_type="user",
            subject_id=reviewer_user_id
        )
        
        logger.info(f"KYC reviewer assigned: verification={verification_id}, reviewer={reviewer_user_id}")
        return True
    
    async def assign_compliance_officer(
        self,
        admin_user_id: str,
        verification_id: str,
        officer_user_id: str
    ) -> bool:
        """
        Assign compliance officer to KYC verification
        
        Args:
            admin_user_id: Admin assigning the officer
            verification_id: Verification ID
            officer_user_id: Compliance officer user ID
        
        Returns:
            True if successful
        """
        # Assign compliance officer relationship
        await self.auth_service.client.create_relationship(
            entity_type="kyc_verification",
            entity_id=verification_id,
            relation="compliance_officer",
            subject_type="user",
            subject_id=officer_user_id
        )
        
        logger.info(f"Compliance officer assigned: verification={verification_id}, officer={officer_user_id}")
        return True

