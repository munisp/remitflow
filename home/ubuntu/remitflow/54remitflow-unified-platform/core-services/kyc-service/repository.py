"""
KYC Service Repository Layer
Database operations for KYC service using SQLAlchemy
"""

from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

from models import (
    KYCProfile, KYCDocument, KYCVerificationRequest, LivenessCheck,
    BVNVerification, AuditLog, KYCTierEnum, VerificationStatusEnum,
    DocumentTypeEnum, RejectionReasonEnum
)

logger = logging.getLogger(__name__)


class KYCProfileRepository:
    """Repository for KYC Profile operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, user_id: str, **kwargs) -> KYCProfile:
        """Create a new KYC profile"""
        profile = KYCProfile(user_id=user_id, **kwargs)
        self.db.add(profile)
        self.db.commit()
        self.db.refresh(profile)
        return profile
    
    def get_by_id(self, profile_id: str) -> Optional[KYCProfile]:
        """Get profile by ID"""
        return self.db.query(KYCProfile).filter(KYCProfile.id == profile_id).first()
    
    def get_by_user_id(self, user_id: str) -> Optional[KYCProfile]:
        """Get profile by user ID"""
        return self.db.query(KYCProfile).filter(KYCProfile.user_id == user_id).first()
    
    def update(self, profile: KYCProfile, **kwargs) -> KYCProfile:
        """Update profile fields"""
        for key, value in kwargs.items():
            if hasattr(profile, key):
                setattr(profile, key, value)
        profile.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(profile)
        return profile
    
    def upgrade_tier(self, profile: KYCProfile, new_tier: KYCTierEnum) -> KYCProfile:
        """Upgrade profile to a new tier"""
        profile.current_tier = new_tier
        profile.updated_at = datetime.utcnow()
        profile.last_verification_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(profile)
        return profile
    
    def list_by_tier(self, tier: KYCTierEnum, limit: int = 100, offset: int = 0) -> List[KYCProfile]:
        """List profiles by tier"""
        return self.db.query(KYCProfile).filter(
            KYCProfile.current_tier == tier
        ).offset(offset).limit(limit).all()
    
    def count_by_tier(self) -> Dict[str, int]:
        """Count profiles by tier"""
        result = {}
        for tier in KYCTierEnum:
            count = self.db.query(KYCProfile).filter(KYCProfile.current_tier == tier).count()
            result[tier.value] = count
        return result
    
    def get_pending_reviews(self, limit: int = 100) -> List[KYCProfile]:
        """Get profiles with pending document reviews"""
        return self.db.query(KYCProfile).filter(
            or_(
                KYCProfile.id_document_status == VerificationStatusEnum.PENDING,
                KYCProfile.selfie_status == VerificationStatusEnum.PENDING,
                KYCProfile.address_proof_status == VerificationStatusEnum.PENDING,
                KYCProfile.liveness_status == VerificationStatusEnum.PENDING,
                KYCProfile.income_proof_status == VerificationStatusEnum.PENDING
            )
        ).limit(limit).all()


class KYCDocumentRepository:
    """Repository for KYC Document operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, user_id: str, document_type: DocumentTypeEnum, file_url: str, **kwargs) -> KYCDocument:
        """Create a new document"""
        document = KYCDocument(
            user_id=user_id,
            document_type=document_type,
            file_url=file_url,
            **kwargs
        )
        self.db.add(document)
        self.db.commit()
        self.db.refresh(document)
        return document
    
    def get_by_id(self, document_id: str) -> Optional[KYCDocument]:
        """Get document by ID"""
        return self.db.query(KYCDocument).filter(KYCDocument.id == document_id).first()
    
    def get_by_user_id(self, user_id: str) -> List[KYCDocument]:
        """Get all documents for a user"""
        return self.db.query(KYCDocument).filter(KYCDocument.user_id == user_id).all()
    
    def get_by_type(self, user_id: str, document_type: DocumentTypeEnum) -> List[KYCDocument]:
        """Get documents of a specific type for a user"""
        return self.db.query(KYCDocument).filter(
            and_(
                KYCDocument.user_id == user_id,
                KYCDocument.document_type == document_type
            )
        ).all()
    
    def update_status(
        self,
        document: KYCDocument,
        status: VerificationStatusEnum,
        verified_by: Optional[str] = None,
        rejection_reason: Optional[RejectionReasonEnum] = None,
        rejection_notes: Optional[str] = None
    ) -> KYCDocument:
        """Update document verification status"""
        document.status = status
        document.verified_by = verified_by
        document.verified_at = datetime.utcnow() if status in [VerificationStatusEnum.APPROVED, VerificationStatusEnum.REJECTED] else None
        document.rejection_reason = rejection_reason
        document.rejection_notes = rejection_notes
        document.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(document)
        return document
    
    def get_pending_documents(self, limit: int = 100) -> List[KYCDocument]:
        """Get documents pending review"""
        return self.db.query(KYCDocument).filter(
            KYCDocument.status == VerificationStatusEnum.PENDING
        ).order_by(KYCDocument.created_at).limit(limit).all()
    
    def count_by_status(self) -> Dict[str, int]:
        """Count documents by status"""
        result = {}
        for status in VerificationStatusEnum:
            count = self.db.query(KYCDocument).filter(KYCDocument.status == status).count()
            result[status.value] = count
        return result


class KYCVerificationRequestRepository:
    """Repository for KYC Verification Request operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, user_id: str, requested_tier: KYCTierEnum, **kwargs) -> KYCVerificationRequest:
        """Create a new verification request"""
        request = KYCVerificationRequest(
            user_id=user_id,
            requested_tier=requested_tier,
            **kwargs
        )
        self.db.add(request)
        self.db.commit()
        self.db.refresh(request)
        return request
    
    def get_by_id(self, request_id: str) -> Optional[KYCVerificationRequest]:
        """Get request by ID"""
        return self.db.query(KYCVerificationRequest).filter(KYCVerificationRequest.id == request_id).first()
    
    def get_by_user_id(self, user_id: str) -> List[KYCVerificationRequest]:
        """Get all requests for a user"""
        return self.db.query(KYCVerificationRequest).filter(KYCVerificationRequest.user_id == user_id).all()
    
    def get_pending(self, limit: int = 100) -> List[KYCVerificationRequest]:
        """Get pending verification requests"""
        return self.db.query(KYCVerificationRequest).filter(
            KYCVerificationRequest.status == VerificationStatusEnum.PENDING
        ).order_by(KYCVerificationRequest.created_at).limit(limit).all()
    
    def update_status(
        self,
        request: KYCVerificationRequest,
        status: VerificationStatusEnum,
        assigned_to: Optional[str] = None
    ) -> KYCVerificationRequest:
        """Update request status"""
        request.status = status
        request.assigned_to = assigned_to
        request.updated_at = datetime.utcnow()
        if status in [VerificationStatusEnum.APPROVED, VerificationStatusEnum.REJECTED]:
            request.completed_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(request)
        return request


class LivenessCheckRepository:
    """Repository for Liveness Check operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, user_id: str, **kwargs) -> LivenessCheck:
        """Create a new liveness check"""
        check = LivenessCheck(user_id=user_id, **kwargs)
        self.db.add(check)
        self.db.commit()
        self.db.refresh(check)
        return check
    
    def get_by_id(self, check_id: str) -> Optional[LivenessCheck]:
        """Get check by ID"""
        return self.db.query(LivenessCheck).filter(LivenessCheck.id == check_id).first()
    
    def get_latest_by_user(self, user_id: str) -> Optional[LivenessCheck]:
        """Get latest liveness check for a user"""
        return self.db.query(LivenessCheck).filter(
            LivenessCheck.user_id == user_id
        ).order_by(LivenessCheck.created_at.desc()).first()


class BVNVerificationRepository:
    """Repository for BVN Verification operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, user_id: str, bvn: str, **kwargs) -> BVNVerification:
        """Create a new BVN verification"""
        verification = BVNVerification(user_id=user_id, bvn=bvn, **kwargs)
        self.db.add(verification)
        self.db.commit()
        self.db.refresh(verification)
        return verification
    
    def get_by_bvn(self, bvn: str) -> Optional[BVNVerification]:
        """Get verification by BVN"""
        return self.db.query(BVNVerification).filter(BVNVerification.bvn == bvn).first()
    
    def get_by_user_id(self, user_id: str) -> List[BVNVerification]:
        """Get all verifications for a user"""
        return self.db.query(BVNVerification).filter(BVNVerification.user_id == user_id).all()


class AuditLogRepository:
    """Repository for Audit Log operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(
        self,
        action: str,
        resource_type: str,
        user_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        resource_id: Optional[str] = None,
        old_value: Optional[Dict] = None,
        new_value: Optional[Dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        correlation_id: Optional[str] = None
    ) -> AuditLog:
        """Create a new audit log entry"""
        log = AuditLog(
            action=action,
            resource_type=resource_type,
            user_id=user_id,
            actor_id=actor_id,
            resource_id=resource_id,
            old_value=old_value,
            new_value=new_value,
            ip_address=ip_address,
            user_agent=user_agent,
            correlation_id=correlation_id
        )
        self.db.add(log)
        self.db.commit()
        self.db.refresh(log)
        return log
    
    def get_by_user_id(self, user_id: str, limit: int = 100) -> List[AuditLog]:
        """Get audit logs for a user"""
        return self.db.query(AuditLog).filter(
            AuditLog.user_id == user_id
        ).order_by(AuditLog.created_at.desc()).limit(limit).all()
    
    def get_by_resource(self, resource_type: str, resource_id: str, limit: int = 100) -> List[AuditLog]:
        """Get audit logs for a resource"""
        return self.db.query(AuditLog).filter(
            and_(
                AuditLog.resource_type == resource_type,
                AuditLog.resource_id == resource_id
            )
        ).order_by(AuditLog.created_at.desc()).limit(limit).all()
