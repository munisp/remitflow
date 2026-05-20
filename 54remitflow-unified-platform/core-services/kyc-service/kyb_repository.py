"""
KYB Service Repository Layer
Database operations for KYB service using SQLAlchemy
"""

from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import Optional, List, Dict, Any
from datetime import datetime, date
from decimal import Decimal
import logging

from kyb_models import (
    KYBBusiness, KYBDirector, KYBUltimateBeneficialOwner, KYBDocument,
    KYBVerificationRequest, KYBAuditLog, BusinessTypeEnum, BusinessStatusEnum,
    KYBVerificationStatusEnum, KYBTierEnum, DirectorRoleEnum, UBOTypeEnum,
    KYBDocumentTypeEnum, business_directors
)

logger = logging.getLogger(__name__)


class KYBBusinessRepository:
    """Repository for KYB Business operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(
        self,
        business_name: str,
        registration_number: str,
        business_type: BusinessTypeEnum,
        **kwargs
    ) -> KYBBusiness:
        """Create a new business"""
        business = KYBBusiness(
            business_name=business_name,
            registration_number=registration_number,
            business_type=business_type,
            **kwargs
        )
        self.db.add(business)
        self.db.commit()
        self.db.refresh(business)
        return business
    
    def get_by_id(self, business_id: str) -> Optional[KYBBusiness]:
        """Get business by ID"""
        return self.db.query(KYBBusiness).filter(KYBBusiness.id == business_id).first()
    
    def get_by_registration_number(self, registration_number: str) -> Optional[KYBBusiness]:
        """Get business by registration number"""
        return self.db.query(KYBBusiness).filter(
            KYBBusiness.registration_number == registration_number
        ).first()
    
    def get_by_tin(self, tin: str) -> Optional[KYBBusiness]:
        """Get business by TIN"""
        return self.db.query(KYBBusiness).filter(KYBBusiness.tin == tin).first()
    
    def get_by_platform_user(self, platform_user_id: str) -> Optional[KYBBusiness]:
        """Get business by platform user ID"""
        return self.db.query(KYBBusiness).filter(
            KYBBusiness.platform_user_id == platform_user_id
        ).first()
    
    def update(self, business: KYBBusiness, **kwargs) -> KYBBusiness:
        """Update business fields"""
        for key, value in kwargs.items():
            if hasattr(business, key):
                setattr(business, key, value)
        business.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(business)
        return business
    
    def update_kyb_status(
        self,
        business: KYBBusiness,
        status: KYBVerificationStatusEnum,
        verified_by: Optional[str] = None,
        notes: Optional[str] = None
    ) -> KYBBusiness:
        """Update KYB verification status"""
        business.kyb_status = status
        if status == KYBVerificationStatusEnum.APPROVED:
            business.verified_by = verified_by
            business.verified_at = datetime.utcnow()
        business.verification_notes = notes
        business.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(business)
        return business
    
    def upgrade_tier(
        self,
        business: KYBBusiness,
        new_tier: KYBTierEnum,
        verified_by: str
    ) -> KYBBusiness:
        """Upgrade business to a new KYB tier"""
        business.kyb_tier = new_tier
        business.verified_by = verified_by
        business.verified_at = datetime.utcnow()
        business.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(business)
        return business
    
    def update_screening_results(
        self,
        business: KYBBusiness,
        screening_id: str,
        sanctions_clear: bool,
        pep_clear: bool,
        aml_clear: bool,
        adverse_media_clear: bool,
        risk_score: int,
        risk_level: str,
        risk_flags: List[str]
    ) -> KYBBusiness:
        """Update compliance screening results"""
        business.last_screening_id = screening_id
        business.last_screening_date = datetime.utcnow()
        business.sanctions_clear = sanctions_clear
        business.pep_clear = pep_clear
        business.aml_clear = aml_clear
        business.adverse_media_clear = adverse_media_clear
        business.risk_score = risk_score
        business.risk_level = risk_level
        business.risk_flags = risk_flags
        business.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(business)
        return business
    
    def list_by_tier(self, tier: KYBTierEnum, limit: int = 100, offset: int = 0) -> List[KYBBusiness]:
        """List businesses by tier"""
        return self.db.query(KYBBusiness).filter(
            KYBBusiness.kyb_tier == tier
        ).offset(offset).limit(limit).all()
    
    def list_by_status(self, status: KYBVerificationStatusEnum, limit: int = 100) -> List[KYBBusiness]:
        """List businesses by verification status"""
        return self.db.query(KYBBusiness).filter(
            KYBBusiness.kyb_status == status
        ).order_by(KYBBusiness.created_at).limit(limit).all()
    
    def count_by_tier(self) -> Dict[str, int]:
        """Count businesses by tier"""
        result = {}
        for tier in KYBTierEnum:
            count = self.db.query(KYBBusiness).filter(KYBBusiness.kyb_tier == tier).count()
            result[tier.value] = count
        return result
    
    def search(
        self,
        query: str,
        limit: int = 50
    ) -> List[KYBBusiness]:
        """Search businesses by name or registration number"""
        search_term = f"%{query}%"
        return self.db.query(KYBBusiness).filter(
            or_(
                KYBBusiness.business_name.ilike(search_term),
                KYBBusiness.trading_name.ilike(search_term),
                KYBBusiness.registration_number.ilike(search_term)
            )
        ).limit(limit).all()


class KYBDirectorRepository:
    """Repository for KYB Director operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(
        self,
        first_name: str,
        last_name: str,
        **kwargs
    ) -> KYBDirector:
        """Create a new director"""
        director = KYBDirector(
            first_name=first_name,
            last_name=last_name,
            **kwargs
        )
        self.db.add(director)
        self.db.commit()
        self.db.refresh(director)
        return director
    
    def get_by_id(self, director_id: str) -> Optional[KYBDirector]:
        """Get director by ID"""
        return self.db.query(KYBDirector).filter(KYBDirector.id == director_id).first()
    
    def get_by_bvn(self, bvn: str) -> Optional[KYBDirector]:
        """Get director by BVN"""
        return self.db.query(KYBDirector).filter(KYBDirector.bvn == bvn).first()
    
    def add_to_business(
        self,
        director: KYBDirector,
        business: KYBBusiness,
        role: DirectorRoleEnum = DirectorRoleEnum.DIRECTOR,
        appointed_date: Optional[date] = None
    ):
        """Add director to a business"""
        stmt = business_directors.insert().values(
            business_id=business.id,
            director_id=director.id,
            role=role,
            appointed_date=appointed_date,
            is_active=True
        )
        self.db.execute(stmt)
        self.db.commit()
    
    def remove_from_business(
        self,
        director: KYBDirector,
        business: KYBBusiness,
        resigned_date: Optional[date] = None
    ):
        """Remove director from a business (mark as inactive)"""
        stmt = business_directors.update().where(
            and_(
                business_directors.c.business_id == business.id,
                business_directors.c.director_id == director.id
            )
        ).values(
            is_active=False,
            resigned_date=resigned_date or date.today()
        )
        self.db.execute(stmt)
        self.db.commit()
    
    def get_business_directors(self, business_id: str) -> List[KYBDirector]:
        """Get all active directors for a business"""
        return self.db.query(KYBDirector).join(
            business_directors,
            KYBDirector.id == business_directors.c.director_id
        ).filter(
            and_(
                business_directors.c.business_id == business_id,
                business_directors.c.is_active.is_(True)
            )
        ).all()
    
    def update_verification_status(
        self,
        director: KYBDirector,
        status: KYBVerificationStatusEnum,
        verified_by: Optional[str] = None
    ) -> KYBDirector:
        """Update director verification status"""
        director.verification_status = status
        if status == KYBVerificationStatusEnum.APPROVED:
            director.verified_by = verified_by
            director.verified_at = datetime.utcnow()
            director.kyc_verified = True
        director.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(director)
        return director
    
    def update_screening_results(
        self,
        director: KYBDirector,
        sanctions_clear: bool,
        pep_status: bool,
        pep_details: Optional[Dict] = None
    ) -> KYBDirector:
        """Update director screening results"""
        director.sanctions_clear = sanctions_clear
        director.pep_status = pep_status
        director.pep_details = pep_details
        director.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(director)
        return director


class KYBUBORepository:
    """Repository for Ultimate Beneficial Owner operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(
        self,
        business_id: str,
        ownership_type: UBOTypeEnum,
        ownership_percentage: Decimal,
        first_name: str,
        last_name: str,
        **kwargs
    ) -> KYBUltimateBeneficialOwner:
        """Create a new UBO"""
        ubo = KYBUltimateBeneficialOwner(
            business_id=business_id,
            ownership_type=ownership_type,
            ownership_percentage=ownership_percentage,
            first_name=first_name,
            last_name=last_name,
            **kwargs
        )
        self.db.add(ubo)
        self.db.commit()
        self.db.refresh(ubo)
        return ubo
    
    def get_by_id(self, ubo_id: str) -> Optional[KYBUltimateBeneficialOwner]:
        """Get UBO by ID"""
        return self.db.query(KYBUltimateBeneficialOwner).filter(
            KYBUltimateBeneficialOwner.id == ubo_id
        ).first()
    
    def get_by_business(self, business_id: str) -> List[KYBUltimateBeneficialOwner]:
        """Get all UBOs for a business"""
        return self.db.query(KYBUltimateBeneficialOwner).filter(
            KYBUltimateBeneficialOwner.business_id == business_id
        ).all()
    
    def get_significant_ubos(self, business_id: str, threshold: Decimal = Decimal("25.0")) -> List[KYBUltimateBeneficialOwner]:
        """Get UBOs with ownership >= threshold (typically 25%)"""
        return self.db.query(KYBUltimateBeneficialOwner).filter(
            and_(
                KYBUltimateBeneficialOwner.business_id == business_id,
                KYBUltimateBeneficialOwner.ownership_percentage >= threshold
            )
        ).all()
    
    def update(self, ubo: KYBUltimateBeneficialOwner, **kwargs) -> KYBUltimateBeneficialOwner:
        """Update UBO fields"""
        for key, value in kwargs.items():
            if hasattr(ubo, key):
                setattr(ubo, key, value)
        ubo.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(ubo)
        return ubo
    
    def update_verification_status(
        self,
        ubo: KYBUltimateBeneficialOwner,
        status: KYBVerificationStatusEnum,
        verified_by: Optional[str] = None
    ) -> KYBUltimateBeneficialOwner:
        """Update UBO verification status"""
        ubo.verification_status = status
        if status == KYBVerificationStatusEnum.APPROVED:
            ubo.verified_by = verified_by
            ubo.verified_at = datetime.utcnow()
            ubo.kyc_verified = True
        ubo.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(ubo)
        return ubo
    
    def delete(self, ubo: KYBUltimateBeneficialOwner):
        """Delete a UBO"""
        self.db.delete(ubo)
        self.db.commit()


class KYBDocumentRepository:
    """Repository for KYB Document operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(
        self,
        business_id: str,
        document_type: KYBDocumentTypeEnum,
        file_url: str,
        **kwargs
    ) -> KYBDocument:
        """Create a new document"""
        document = KYBDocument(
            business_id=business_id,
            document_type=document_type,
            file_url=file_url,
            **kwargs
        )
        self.db.add(document)
        self.db.commit()
        self.db.refresh(document)
        return document
    
    def get_by_id(self, document_id: str) -> Optional[KYBDocument]:
        """Get document by ID"""
        return self.db.query(KYBDocument).filter(KYBDocument.id == document_id).first()
    
    def get_by_business(self, business_id: str) -> List[KYBDocument]:
        """Get all documents for a business"""
        return self.db.query(KYBDocument).filter(
            KYBDocument.business_id == business_id
        ).all()
    
    def get_by_type(self, business_id: str, document_type: KYBDocumentTypeEnum) -> List[KYBDocument]:
        """Get documents of a specific type for a business"""
        return self.db.query(KYBDocument).filter(
            and_(
                KYBDocument.business_id == business_id,
                KYBDocument.document_type == document_type
            )
        ).all()
    
    def update_status(
        self,
        document: KYBDocument,
        status: KYBVerificationStatusEnum,
        verified_by: Optional[str] = None,
        rejection_reason: Optional[str] = None
    ) -> KYBDocument:
        """Update document verification status"""
        document.status = status
        document.verified_by = verified_by
        document.verified_at = datetime.utcnow() if status in [
            KYBVerificationStatusEnum.APPROVED, KYBVerificationStatusEnum.REJECTED
        ] else None
        document.rejection_reason = rejection_reason
        document.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(document)
        return document
    
    def get_pending_documents(self, limit: int = 100) -> List[KYBDocument]:
        """Get documents pending review"""
        return self.db.query(KYBDocument).filter(
            KYBDocument.status == KYBVerificationStatusEnum.PENDING
        ).order_by(KYBDocument.created_at).limit(limit).all()


class KYBVerificationRequestRepository:
    """Repository for KYB Verification Request operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(
        self,
        business_id: str,
        requested_tier: KYBTierEnum,
        current_tier: KYBTierEnum
    ) -> KYBVerificationRequest:
        """Create a new verification request"""
        request = KYBVerificationRequest(
            business_id=business_id,
            requested_tier=requested_tier,
            current_tier=current_tier
        )
        self.db.add(request)
        self.db.commit()
        self.db.refresh(request)
        return request
    
    def get_by_id(self, request_id: str) -> Optional[KYBVerificationRequest]:
        """Get request by ID"""
        return self.db.query(KYBVerificationRequest).filter(
            KYBVerificationRequest.id == request_id
        ).first()
    
    def get_pending(self, limit: int = 100) -> List[KYBVerificationRequest]:
        """Get pending verification requests"""
        return self.db.query(KYBVerificationRequest).filter(
            KYBVerificationRequest.status == KYBVerificationStatusEnum.PENDING
        ).order_by(KYBVerificationRequest.created_at).limit(limit).all()
    
    def update_status(
        self,
        request: KYBVerificationRequest,
        status: KYBVerificationStatusEnum,
        assigned_to: Optional[str] = None,
        rejection_reason: Optional[str] = None
    ) -> KYBVerificationRequest:
        """Update request status"""
        request.status = status
        request.assigned_to = assigned_to
        request.rejection_reason = rejection_reason
        request.updated_at = datetime.utcnow()
        if status in [KYBVerificationStatusEnum.APPROVED, KYBVerificationStatusEnum.REJECTED]:
            request.completed_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(request)
        return request


class KYBAuditLogRepository:
    """Repository for KYB Audit Log operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(
        self,
        action: str,
        resource_type: str,
        business_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        resource_id: Optional[str] = None,
        old_value: Optional[Dict] = None,
        new_value: Optional[Dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        correlation_id: Optional[str] = None
    ) -> KYBAuditLog:
        """Create a new audit log entry"""
        log = KYBAuditLog(
            action=action,
            resource_type=resource_type,
            business_id=business_id,
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
    
    def get_by_business(self, business_id: str, limit: int = 100) -> List[KYBAuditLog]:
        """Get audit logs for a business"""
        return self.db.query(KYBAuditLog).filter(
            KYBAuditLog.business_id == business_id
        ).order_by(KYBAuditLog.created_at.desc()).limit(limit).all()
    
    def get_by_resource(self, resource_type: str, resource_id: str, limit: int = 100) -> List[KYBAuditLog]:
        """Get audit logs for a resource"""
        return self.db.query(KYBAuditLog).filter(
            and_(
                KYBAuditLog.resource_type == resource_type,
                KYBAuditLog.resource_id == resource_id
            )
        ).order_by(KYBAuditLog.created_at.desc()).limit(limit).all()
