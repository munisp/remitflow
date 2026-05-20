"""
KYB (Know Your Business) Service
Production-ready business verification service with:
- PostgreSQL persistence
- Sanctions/PEP screening integration
- Director and UBO verification
- Audit logging
- Tier-based limits
"""

import os
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, date, timedelta
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from database import get_db

from kyb_models import (
    KYBBusiness, KYBDirector, KYBUltimateBeneficialOwner, KYBDocument,
    KYBVerificationRequest, BusinessTypeEnum, BusinessStatusEnum,
    KYBVerificationStatusEnum, KYBTierEnum, DirectorRoleEnum, UBOTypeEnum,
    KYBDocumentTypeEnum
)
from kyb_repository import (
    KYBBusinessRepository, KYBDirectorRepository, KYBUBORepository,
    KYBDocumentRepository, KYBVerificationRequestRepository, KYBAuditLogRepository
)
from sanctions_screening import (
    screen_individual, screen_business, resolve_screening_match,
    ScreeningResult, MatchStatus, RiskLevel, EntityType
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kyb", tags=["Know Your Business (KYB)"])


# Tier Configuration
KYB_TIER_CONFIG = {
    KYBTierEnum.TIER_0: {
        "name": "Unverified",
        "requirements": [],
        "limits": {
            "daily_transaction": Decimal("0"),
            "monthly_transaction": Decimal("0"),
            "single_transaction": Decimal("0")
        },
        "features": []
    },
    KYBTierEnum.TIER_1: {
        "name": "Basic",
        "requirements": ["registration_verified", "tin_verified"],
        "limits": {
            "daily_transaction": Decimal("1000000"),
            "monthly_transaction": Decimal("5000000"),
            "single_transaction": Decimal("500000")
        },
        "features": ["domestic_payments", "receive_payments"]
    },
    KYBTierEnum.TIER_2: {
        "name": "Standard",
        "requirements": ["registration_verified", "tin_verified", "directors_verified", "address_verified"],
        "limits": {
            "daily_transaction": Decimal("10000000"),
            "monthly_transaction": Decimal("50000000"),
            "single_transaction": Decimal("5000000")
        },
        "features": ["domestic_payments", "receive_payments", "bulk_payments", "api_access"]
    },
    KYBTierEnum.TIER_3: {
        "name": "Enhanced",
        "requirements": ["registration_verified", "tin_verified", "directors_verified", "address_verified", 
                        "ubos_verified", "sanctions_clear", "pep_clear"],
        "limits": {
            "daily_transaction": Decimal("50000000"),
            "monthly_transaction": Decimal("200000000"),
            "single_transaction": Decimal("20000000")
        },
        "features": ["domestic_payments", "receive_payments", "bulk_payments", "api_access", 
                    "international_payments", "fx_trading"]
    },
    KYBTierEnum.TIER_4: {
        "name": "Premium",
        "requirements": ["registration_verified", "tin_verified", "directors_verified", "address_verified",
                        "ubos_verified", "sanctions_clear", "pep_clear", "financial_statements_verified",
                        "enhanced_due_diligence"],
        "limits": {
            "daily_transaction": Decimal("200000000"),
            "monthly_transaction": Decimal("1000000000"),
            "single_transaction": Decimal("100000000")
        },
        "features": ["domestic_payments", "receive_payments", "bulk_payments", "api_access",
                    "international_payments", "fx_trading", "credit_facilities", "white_label"]
    }
}


# Request/Response Models
class CreateBusinessRequest(BaseModel):
    business_name: str
    trading_name: Optional[str] = None
    registration_number: str
    registration_date: Optional[date] = None
    business_type: str
    tin: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    registered_address_line1: Optional[str] = None
    registered_address_line2: Optional[str] = None
    registered_city: Optional[str] = None
    registered_state: Optional[str] = None
    registered_country: str = "NG"
    industry_sector: Optional[str] = None
    description: Optional[str] = None
    platform_user_id: Optional[str] = None


class CreateDirectorRequest(BaseModel):
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: str = "NG"
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    bvn: Optional[str] = None
    nin: Optional[str] = None
    kyc_profile_id: Optional[str] = None


class AddDirectorRequest(BaseModel):
    director_id: str
    role: str = "director"
    appointed_date: Optional[date] = None


class CreateUBORequest(BaseModel):
    ownership_type: str
    ownership_percentage: float
    voting_rights_percentage: Optional[float] = None
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: str = "NG"
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    bvn: Optional[str] = None
    nin: Optional[str] = None
    source_of_wealth: Optional[str] = None
    kyc_profile_id: Optional[str] = None


class UploadDocumentRequest(BaseModel):
    document_type: str
    file_url: str
    document_number: Optional[str] = None
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    issuing_authority: Optional[str] = None


class VerifyRequest(BaseModel):
    verified_by: str
    notes: Optional[str] = None


class RejectRequest(BaseModel):
    rejected_by: str
    reason: str


class ResolveMatchRequest(BaseModel):
    status: str  # confirmed_match, false_positive
    reviewed_by: str
    notes: Optional[str] = None


# Helper Functions
def get_audit_context(request: Request) -> Dict[str, Any]:
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("User-Agent"),
        "correlation_id": request.headers.get("X-Correlation-ID")
    }


def check_tier_eligibility(business: KYBBusiness, target_tier: KYBTierEnum, db: Session) -> Dict[str, Any]:
    """Check if a business meets requirements for a tier"""
    requirements = KYB_TIER_CONFIG[target_tier]["requirements"]
    met = []
    missing = []
    
    director_repo = KYBDirectorRepository(db)
    ubo_repo = KYBUBORepository(db)
    doc_repo = KYBDocumentRepository(db)
    
    for req in requirements:
        if req == "registration_verified":
            # Check for CAC certificate
            cac_docs = doc_repo.get_by_type(business.id, KYBDocumentTypeEnum.CAC_CERTIFICATE)
            if any(d.status == KYBVerificationStatusEnum.APPROVED for d in cac_docs):
                met.append(req)
            else:
                missing.append(req)
        
        elif req == "tin_verified":
            # Check for TIN certificate
            tin_docs = doc_repo.get_by_type(business.id, KYBDocumentTypeEnum.TIN_CERTIFICATE)
            if business.tin and any(d.status == KYBVerificationStatusEnum.APPROVED for d in tin_docs):
                met.append(req)
            else:
                missing.append(req)
        
        elif req == "directors_verified":
            # Check all directors are verified
            directors = director_repo.get_business_directors(business.id)
            if directors and all(d.verification_status == KYBVerificationStatusEnum.APPROVED for d in directors):
                met.append(req)
            else:
                missing.append(req)
        
        elif req == "address_verified":
            # Check for address verification document
            utility_docs = doc_repo.get_by_type(business.id, KYBDocumentTypeEnum.UTILITY_BILL)
            lease_docs = doc_repo.get_by_type(business.id, KYBDocumentTypeEnum.LEASE_AGREEMENT)
            if any(d.status == KYBVerificationStatusEnum.APPROVED for d in utility_docs + lease_docs):
                met.append(req)
            else:
                missing.append(req)
        
        elif req == "ubos_verified":
            # Check all significant UBOs (>=25%) are verified
            ubos = ubo_repo.get_significant_ubos(business.id)
            if ubos and all(u.verification_status == KYBVerificationStatusEnum.APPROVED for u in ubos):
                met.append(req)
            else:
                missing.append(req)
        
        elif req == "sanctions_clear":
            if business.sanctions_clear:
                met.append(req)
            else:
                missing.append(req)
        
        elif req == "pep_clear":
            if business.pep_clear:
                met.append(req)
            else:
                missing.append(req)
        
        elif req == "financial_statements_verified":
            # Check for audited accounts
            audit_docs = doc_repo.get_by_type(business.id, KYBDocumentTypeEnum.AUDITED_ACCOUNTS)
            if any(d.status == KYBVerificationStatusEnum.APPROVED for d in audit_docs):
                met.append(req)
            else:
                missing.append(req)
        
        elif req == "enhanced_due_diligence":
            # EDD is manual review - check risk score
            if business.risk_score < 30:
                met.append(req)
            else:
                missing.append(req)
        
        else:
            missing.append(req)
    
    return {
        "eligible": len(missing) == 0,
        "requirements_met": met,
        "requirements_missing": missing,
        "progress": len(met) / len(requirements) * 100 if requirements else 100
    }


# Business Endpoints
@router.post("/businesses")
async def create_business(
    request: CreateBusinessRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Create a new business for KYB verification"""
    repo = KYBBusinessRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    # Check if registration number already exists
    existing = repo.get_by_registration_number(request.registration_number)
    if existing:
        raise HTTPException(status_code=400, detail="Business with this registration number already exists")
    
    try:
        business_type = BusinessTypeEnum(request.business_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid business type: {request.business_type}")
    
    business = repo.create(
        business_name=request.business_name,
        trading_name=request.trading_name,
        registration_number=request.registration_number,
        registration_date=request.registration_date,
        business_type=business_type,
        tin=request.tin,
        email=request.email,
        phone=request.phone,
        website=request.website,
        registered_address_line1=request.registered_address_line1,
        registered_address_line2=request.registered_address_line2,
        registered_city=request.registered_city,
        registered_state=request.registered_state,
        registered_country=request.registered_country,
        industry_sector=request.industry_sector,
        description=request.description,
        platform_user_id=request.platform_user_id
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="business_created",
        resource_type="business",
        business_id=business.id,
        resource_id=business.id,
        new_value={"business_name": business.business_name, "registration_number": business.registration_number},
        **ctx
    )
    
    return {
        "id": business.id,
        "business_name": business.business_name,
        "registration_number": business.registration_number,
        "kyb_tier": business.kyb_tier.value,
        "kyb_status": business.kyb_status.value
    }


@router.get("/businesses/{business_id}")
async def get_business(business_id: str, db: Session = Depends(get_db)):
    """Get business details"""
    repo = KYBBusinessRepository(db)
    business = repo.get_by_id(business_id)
    
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    return {
        "id": business.id,
        "business_name": business.business_name,
        "trading_name": business.trading_name,
        "registration_number": business.registration_number,
        "business_type": business.business_type.value,
        "business_status": business.business_status.value,
        "tin": business.tin,
        "email": business.email,
        "phone": business.phone,
        "kyb_tier": business.kyb_tier.value,
        "kyb_status": business.kyb_status.value,
        "sanctions_clear": business.sanctions_clear,
        "pep_clear": business.pep_clear,
        "risk_score": business.risk_score,
        "risk_level": business.risk_level,
        "created_at": business.created_at.isoformat()
    }


@router.get("/businesses/{business_id}/limits")
async def get_business_limits(business_id: str, db: Session = Depends(get_db)):
    """Get transaction limits for a business based on KYB tier"""
    repo = KYBBusinessRepository(db)
    business = repo.get_by_id(business_id)
    
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    tier_config = KYB_TIER_CONFIG[business.kyb_tier]
    
    return {
        "tier": business.kyb_tier.value,
        "tier_name": tier_config["name"],
        "limits": {k: str(v) for k, v in tier_config["limits"].items()},
        "features": tier_config["features"]
    }


@router.get("/businesses/{business_id}/eligibility/{target_tier}")
async def check_business_eligibility(
    business_id: str,
    target_tier: str,
    db: Session = Depends(get_db)
):
    """Check eligibility for a specific KYB tier"""
    repo = KYBBusinessRepository(db)
    business = repo.get_by_id(business_id)
    
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    try:
        tier = KYBTierEnum(target_tier)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid tier: {target_tier}")
    
    return check_tier_eligibility(business, tier, db)


@router.post("/businesses/{business_id}/screen")
async def screen_business_endpoint(
    business_id: str,
    req: Request,
    db: Session = Depends(get_db)
):
    """Screen business for sanctions, PEP, and adverse media"""
    repo = KYBBusinessRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    business = repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    # Screen the business
    result = await screen_business(
        entity_id=business.id,
        business_name=business.business_name,
        registration_number=business.registration_number,
        registration_country=business.registered_country
    )
    
    # Update business with screening results
    repo.update_screening_results(
        business,
        screening_id=result.screening_id,
        sanctions_clear=result.sanctions_clear,
        pep_clear=result.pep_clear,
        aml_clear=result.aml_clear,
        adverse_media_clear=result.adverse_media_clear,
        risk_score=result.risk_score,
        risk_level=result.risk_level.value,
        risk_flags=[m.list_name for m in result.matches]
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="business_screened",
        resource_type="business",
        business_id=business.id,
        resource_id=business.id,
        new_value={
            "screening_id": result.screening_id,
            "overall_clear": result.overall_clear,
            "risk_score": result.risk_score,
            "matches_found": result.total_matches
        },
        **ctx
    )
    
    return {
        "screening_id": result.screening_id,
        "overall_clear": result.overall_clear,
        "sanctions_clear": result.sanctions_clear,
        "pep_clear": result.pep_clear,
        "adverse_media_clear": result.adverse_media_clear,
        "risk_level": result.risk_level.value,
        "risk_score": result.risk_score,
        "matches_found": result.total_matches,
        "requires_review": result.requires_review,
        "matches": [
            {
                "match_id": m.match_id,
                "list_name": m.list_name,
                "list_type": m.list_type.value,
                "matched_name": m.matched_name,
                "match_score": m.match_score,
                "status": m.status.value
            }
            for m in result.matches
        ]
    }


@router.post("/businesses/{business_id}/verify")
async def verify_business(
    business_id: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Verify business KYB status"""
    repo = KYBBusinessRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    business = repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    old_status = business.kyb_status.value
    
    business = repo.update_kyb_status(
        business,
        KYBVerificationStatusEnum.APPROVED,
        request.verified_by,
        request.notes
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="business_verified",
        resource_type="business",
        business_id=business.id,
        actor_id=request.verified_by,
        resource_id=business.id,
        old_value={"kyb_status": old_status},
        new_value={"kyb_status": business.kyb_status.value},
        **ctx
    )
    
    return {"id": business.id, "kyb_status": business.kyb_status.value}


@router.post("/businesses/{business_id}/upgrade-tier")
async def upgrade_business_tier(
    business_id: str,
    target_tier: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Upgrade business to a higher KYB tier"""
    repo = KYBBusinessRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    business = repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    try:
        tier = KYBTierEnum(target_tier)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid tier: {target_tier}")
    
    # Check eligibility
    eligibility = check_tier_eligibility(business, tier, db)
    if not eligibility["eligible"]:
        raise HTTPException(
            status_code=400,
            detail=f"Business not eligible for {tier.value}. Missing: {eligibility['requirements_missing']}"
        )
    
    old_tier = business.kyb_tier.value
    
    business = repo.upgrade_tier(business, tier, request.verified_by)
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="tier_upgraded",
        resource_type="business",
        business_id=business.id,
        actor_id=request.verified_by,
        resource_id=business.id,
        old_value={"kyb_tier": old_tier},
        new_value={"kyb_tier": business.kyb_tier.value},
        **ctx
    )
    
    tier_config = KYB_TIER_CONFIG[business.kyb_tier]
    
    return {
        "id": business.id,
        "kyb_tier": business.kyb_tier.value,
        "tier_name": tier_config["name"],
        "limits": {k: str(v) for k, v in tier_config["limits"].items()},
        "features": tier_config["features"]
    }


# Director Endpoints
@router.post("/directors")
async def create_director(
    request: CreateDirectorRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Create a new director"""
    repo = KYBDirectorRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    director = repo.create(
        first_name=request.first_name,
        last_name=request.last_name,
        middle_name=request.middle_name,
        date_of_birth=request.date_of_birth,
        nationality=request.nationality,
        email=request.email,
        phone=request.phone,
        address_line1=request.address_line1,
        city=request.city,
        state=request.state,
        country=request.country,
        id_type=request.id_type,
        id_number=request.id_number,
        bvn=request.bvn,
        nin=request.nin,
        kyc_profile_id=request.kyc_profile_id
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="director_created",
        resource_type="director",
        resource_id=director.id,
        new_value={"name": f"{director.first_name} {director.last_name}"},
        **ctx
    )
    
    return {
        "id": director.id,
        "name": f"{director.first_name} {director.last_name}",
        "verification_status": director.verification_status.value
    }


@router.post("/businesses/{business_id}/directors")
async def add_director_to_business(
    business_id: str,
    request: AddDirectorRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Add a director to a business"""
    business_repo = KYBBusinessRepository(db)
    director_repo = KYBDirectorRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    business = business_repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    director = director_repo.get_by_id(request.director_id)
    if not director:
        raise HTTPException(status_code=404, detail="Director not found")
    
    try:
        role = DirectorRoleEnum(request.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {request.role}")
    
    director_repo.add_to_business(director, business, role, request.appointed_date)
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="director_added",
        resource_type="business",
        business_id=business.id,
        resource_id=director.id,
        new_value={"director_name": f"{director.first_name} {director.last_name}", "role": role.value},
        **ctx
    )
    
    return {"message": "Director added to business", "director_id": director.id, "role": role.value}


@router.get("/businesses/{business_id}/directors")
async def get_business_directors(business_id: str, db: Session = Depends(get_db)):
    """Get all directors for a business"""
    business_repo = KYBBusinessRepository(db)
    director_repo = KYBDirectorRepository(db)
    
    business = business_repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    directors = director_repo.get_business_directors(business_id)
    
    return [
        {
            "id": d.id,
            "name": f"{d.first_name} {d.last_name}",
            "email": d.email,
            "verification_status": d.verification_status.value,
            "kyc_verified": d.kyc_verified,
            "sanctions_clear": d.sanctions_clear,
            "pep_status": d.pep_status
        }
        for d in directors
    ]


@router.post("/directors/{director_id}/screen")
async def screen_director(
    director_id: str,
    req: Request,
    db: Session = Depends(get_db)
):
    """Screen director for sanctions and PEP"""
    repo = KYBDirectorRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    director = repo.get_by_id(director_id)
    if not director:
        raise HTTPException(status_code=404, detail="Director not found")
    
    # Screen the director
    result = await screen_individual(
        entity_id=director.id,
        first_name=director.first_name,
        last_name=director.last_name,
        date_of_birth=director.date_of_birth.isoformat() if director.date_of_birth else None,
        nationality=director.nationality,
        country=director.country
    )
    
    # Update director with screening results
    pep_details = None
    if not result.pep_clear:
        pep_matches = [m for m in result.matches if m.list_type.value == "pep"]
        if pep_matches:
            pep_details = {
                "pep_type": pep_matches[0].pep_type,
                "pep_level": pep_matches[0].pep_level
            }
    
    repo.update_screening_results(
        director,
        sanctions_clear=result.sanctions_clear,
        pep_status=not result.pep_clear,  # True if PEP
        pep_details=pep_details
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="director_screened",
        resource_type="director",
        resource_id=director.id,
        new_value={
            "screening_id": result.screening_id,
            "sanctions_clear": result.sanctions_clear,
            "pep_status": not result.pep_clear,
            "matches_found": result.total_matches
        },
        **ctx
    )
    
    return {
        "screening_id": result.screening_id,
        "sanctions_clear": result.sanctions_clear,
        "pep_status": not result.pep_clear,
        "risk_score": result.risk_score,
        "matches_found": result.total_matches
    }


@router.post("/directors/{director_id}/verify")
async def verify_director(
    director_id: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Verify director"""
    repo = KYBDirectorRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    director = repo.get_by_id(director_id)
    if not director:
        raise HTTPException(status_code=404, detail="Director not found")
    
    director = repo.update_verification_status(
        director,
        KYBVerificationStatusEnum.APPROVED,
        request.verified_by
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="director_verified",
        resource_type="director",
        actor_id=request.verified_by,
        resource_id=director.id,
        new_value={"verification_status": director.verification_status.value},
        **ctx
    )
    
    return {"id": director.id, "verification_status": director.verification_status.value}


# UBO Endpoints
@router.post("/businesses/{business_id}/ubos")
async def create_ubo(
    business_id: str,
    request: CreateUBORequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Create a new Ultimate Beneficial Owner for a business"""
    business_repo = KYBBusinessRepository(db)
    ubo_repo = KYBUBORepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    business = business_repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    try:
        ownership_type = UBOTypeEnum(request.ownership_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid ownership type: {request.ownership_type}")
    
    ubo = ubo_repo.create(
        business_id=business_id,
        ownership_type=ownership_type,
        ownership_percentage=Decimal(str(request.ownership_percentage)),
        voting_rights_percentage=Decimal(str(request.voting_rights_percentage)) if request.voting_rights_percentage else None,
        first_name=request.first_name,
        last_name=request.last_name,
        middle_name=request.middle_name,
        date_of_birth=request.date_of_birth,
        nationality=request.nationality,
        email=request.email,
        phone=request.phone,
        address_line1=request.address_line1,
        city=request.city,
        state=request.state,
        country=request.country,
        id_type=request.id_type,
        id_number=request.id_number,
        bvn=request.bvn,
        nin=request.nin,
        source_of_wealth=request.source_of_wealth,
        kyc_profile_id=request.kyc_profile_id
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="ubo_created",
        resource_type="ubo",
        business_id=business_id,
        resource_id=ubo.id,
        new_value={
            "name": f"{ubo.first_name} {ubo.last_name}",
            "ownership_percentage": float(ubo.ownership_percentage)
        },
        **ctx
    )
    
    return {
        "id": ubo.id,
        "name": f"{ubo.first_name} {ubo.last_name}",
        "ownership_percentage": float(ubo.ownership_percentage),
        "verification_status": ubo.verification_status.value
    }


@router.get("/businesses/{business_id}/ubos")
async def get_business_ubos(business_id: str, db: Session = Depends(get_db)):
    """Get all UBOs for a business"""
    business_repo = KYBBusinessRepository(db)
    ubo_repo = KYBUBORepository(db)
    
    business = business_repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    ubos = ubo_repo.get_by_business(business_id)
    
    return [
        {
            "id": u.id,
            "name": f"{u.first_name} {u.last_name}",
            "ownership_type": u.ownership_type.value,
            "ownership_percentage": float(u.ownership_percentage),
            "verification_status": u.verification_status.value,
            "kyc_verified": u.kyc_verified,
            "sanctions_clear": u.sanctions_clear,
            "pep_status": u.pep_status
        }
        for u in ubos
    ]


@router.post("/ubos/{ubo_id}/screen")
async def screen_ubo(
    ubo_id: str,
    req: Request,
    db: Session = Depends(get_db)
):
    """Screen UBO for sanctions and PEP"""
    repo = KYBUBORepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    ubo = repo.get_by_id(ubo_id)
    if not ubo:
        raise HTTPException(status_code=404, detail="UBO not found")
    
    # Screen the UBO
    result = await screen_individual(
        entity_id=ubo.id,
        first_name=ubo.first_name,
        last_name=ubo.last_name,
        date_of_birth=ubo.date_of_birth.isoformat() if ubo.date_of_birth else None,
        nationality=ubo.nationality,
        country=ubo.country
    )
    
    # Update UBO with screening results
    repo.update(
        ubo,
        sanctions_clear=result.sanctions_clear,
        pep_status=not result.pep_clear
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="ubo_screened",
        resource_type="ubo",
        business_id=ubo.business_id,
        resource_id=ubo.id,
        new_value={
            "screening_id": result.screening_id,
            "sanctions_clear": result.sanctions_clear,
            "pep_status": not result.pep_clear
        },
        **ctx
    )
    
    return {
        "screening_id": result.screening_id,
        "sanctions_clear": result.sanctions_clear,
        "pep_status": not result.pep_clear,
        "risk_score": result.risk_score
    }


@router.post("/ubos/{ubo_id}/verify")
async def verify_ubo(
    ubo_id: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Verify UBO"""
    repo = KYBUBORepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    ubo = repo.get_by_id(ubo_id)
    if not ubo:
        raise HTTPException(status_code=404, detail="UBO not found")
    
    ubo = repo.update_verification_status(
        ubo,
        KYBVerificationStatusEnum.APPROVED,
        request.verified_by
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="ubo_verified",
        resource_type="ubo",
        business_id=ubo.business_id,
        actor_id=request.verified_by,
        resource_id=ubo.id,
        new_value={"verification_status": ubo.verification_status.value},
        **ctx
    )
    
    return {"id": ubo.id, "verification_status": ubo.verification_status.value}


# Document Endpoints
@router.post("/businesses/{business_id}/documents")
async def upload_business_document(
    business_id: str,
    request: UploadDocumentRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Upload a document for business KYB"""
    business_repo = KYBBusinessRepository(db)
    doc_repo = KYBDocumentRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    business = business_repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    try:
        doc_type = KYBDocumentTypeEnum(request.document_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid document type: {request.document_type}")
    
    document = doc_repo.create(
        business_id=business_id,
        document_type=doc_type,
        file_url=request.file_url,
        document_number=request.document_number,
        issue_date=request.issue_date,
        expiry_date=request.expiry_date,
        issuing_authority=request.issuing_authority
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="document_uploaded",
        resource_type="document",
        business_id=business_id,
        resource_id=document.id,
        new_value={"document_type": doc_type.value},
        **ctx
    )
    
    return {
        "id": document.id,
        "document_type": document.document_type.value,
        "status": document.status.value
    }


@router.get("/businesses/{business_id}/documents")
async def get_business_documents(business_id: str, db: Session = Depends(get_db)):
    """Get all documents for a business"""
    business_repo = KYBBusinessRepository(db)
    doc_repo = KYBDocumentRepository(db)
    
    business = business_repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    documents = doc_repo.get_by_business(business_id)
    
    return [
        {
            "id": d.id,
            "document_type": d.document_type.value,
            "document_number": d.document_number,
            "status": d.status.value,
            "created_at": d.created_at.isoformat()
        }
        for d in documents
    ]


@router.post("/documents/{document_id}/verify")
async def verify_document(
    document_id: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Verify a document"""
    doc_repo = KYBDocumentRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    document = doc_repo.get_by_id(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    document = doc_repo.update_status(
        document,
        KYBVerificationStatusEnum.APPROVED,
        request.verified_by
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="document_verified",
        resource_type="document",
        business_id=document.business_id,
        actor_id=request.verified_by,
        resource_id=document.id,
        new_value={"status": document.status.value},
        **ctx
    )
    
    return {"id": document.id, "status": document.status.value}


@router.post("/documents/{document_id}/reject")
async def reject_document(
    document_id: str,
    request: RejectRequest,
    req: Request,
    db: Session = Depends(get_db)
):
    """Reject a document"""
    doc_repo = KYBDocumentRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    document = doc_repo.get_by_id(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    document = doc_repo.update_status(
        document,
        KYBVerificationStatusEnum.REJECTED,
        request.rejected_by,
        request.reason
    )
    
    # Audit log
    ctx = get_audit_context(req)
    audit_repo.create(
        action="document_rejected",
        resource_type="document",
        business_id=document.business_id,
        actor_id=request.rejected_by,
        resource_id=document.id,
        new_value={"status": document.status.value, "reason": request.reason},
        **ctx
    )
    
    return {"id": document.id, "status": document.status.value, "rejection_reason": document.rejection_reason}


# Stats and Admin Endpoints
@router.get("/stats")
async def get_kyb_stats(db: Session = Depends(get_db)):
    """Get KYB statistics"""
    repo = KYBBusinessRepository(db)
    
    tier_counts = repo.count_by_tier()
    pending = repo.list_by_status(KYBVerificationStatusEnum.PENDING, limit=1000)
    
    return {
        "total_businesses": sum(tier_counts.values()),
        "by_tier": tier_counts,
        "pending_verification": len(pending)
    }


@router.get("/tiers")
async def list_kyb_tiers():
    """List all KYB tiers and their requirements"""
    return {
        tier.value: {
            "name": config["name"],
            "requirements": config["requirements"],
            "limits": {k: str(v) for k, v in config["limits"].items()},
            "features": config["features"]
        }
        for tier, config in KYB_TIER_CONFIG.items()
    }


@router.get("/businesses/{business_id}/audit-logs")
async def get_business_audit_logs(
    business_id: str,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db)
):
    """Get audit logs for a business"""
    business_repo = KYBBusinessRepository(db)
    audit_repo = KYBAuditLogRepository(db)
    
    business = business_repo.get_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    
    logs = audit_repo.get_by_business(business_id, limit)
    
    return [
        {
            "id": log.id,
            "action": log.action,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "actor_id": log.actor_id,
            "created_at": log.created_at.isoformat()
        }
        for log in logs
    ]


# Health check
@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "kyb",
        "timestamp": datetime.utcnow().isoformat()
    }
