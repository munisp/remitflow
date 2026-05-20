"""
Property Transaction KYC Service
Production-ready service layer integrating all property KYC components:
- PostgreSQL persistence (property_models.py, property_repository.py)
- Compliance screening (property_compliance.py)
- Document storage (property_storage.py)
- Audit logging (property_audit.py)
- State machine enforcement

This creates a "closed loop ecosystem" where both buyer and seller identities
are verified before high-value property payments can proceed.
"""

import os
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

# Import new production modules
from property_models import (
    PropertyParty, PropertyTransaction, PropertySourceOfFunds,
    PropertyBankStatement, PropertyIncomeDocument, PropertyPurchaseAgreement,
    PropertyTransactionAuditLog, PartyRoleEnum, SourceOfFundsEnum,
    TransactionStatusEnum, PropertyVerificationStatusEnum,
    IncomeDocumentTypeEnum, VALID_STATUS_TRANSITIONS
)
from property_repository import (
    PropertyPartyRepository, PropertyTransactionRepository,
    PropertySourceOfFundsRepository, PropertyBankStatementRepository,
    PropertyIncomeDocumentRepository, PropertyPurchaseAgreementRepository,
    PropertyAuditLogRepository, StateTransitionError
)
from property_compliance import (
    PropertyComplianceClient, PartyScreeningRequest, ScreeningType,
    ScreeningResult, screen_property_transaction_parties,
    calculate_property_risk_score, ComplianceServiceError
)
from property_storage import (
    PropertyDocumentService, DocumentCategory, get_document_storage,
    generate_storage_key, compute_document_hash
)
from property_audit import (
    PropertyAuditLogger, AuditActionType, AuditActorType, AuditContext,
    get_audit_logger
)

# Import shared database module
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
from database import get_db

logger = logging.getLogger(__name__)

# Configuration
COMPLIANCE_ENABLED = os.getenv("COMPLIANCE_ENABLED", "true").lower() == "true"
STORAGE_ENABLED = os.getenv("STORAGE_ENABLED", "true").lower() == "true"
AUDIT_ENABLED = os.getenv("AUDIT_ENABLED", "true").lower() == "true"

router = APIRouter(prefix="/property-kyc/v2", tags=["Property Transaction KYC v2"])


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class CreatePartyRequest(BaseModel):
    role: str
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    date_of_birth: date
    nationality: str
    email: str
    phone: str
    address_line1: str
    address_line2: Optional[str] = None
    city: str
    state: str
    country: str = "NG"
    postal_code: Optional[str] = None
    id_type: str
    id_number: str
    id_issuing_country: str = "NG"
    id_issue_date: date
    id_expiry_date: date
    bvn: Optional[str] = None
    nin: Optional[str] = None
    user_id: Optional[str] = None
    kyc_profile_id: Optional[str] = None


class CreateTransactionRequest(BaseModel):
    buyer_id: str
    property_type: str
    property_address: str
    purchase_price: float
    currency: str = "NGN"


class SourceOfFundsRequest(BaseModel):
    primary_source: str
    primary_source_description: str
    primary_source_amount: float
    secondary_sources: Optional[List[Dict[str, Any]]] = None
    employer_name: Optional[str] = None
    employer_address: Optional[str] = None
    job_title: Optional[str] = None
    employment_start_date: Optional[date] = None
    monthly_salary: Optional[float] = None
    business_name: Optional[str] = None
    business_registration_number: Optional[str] = None
    business_type: Optional[str] = None
    annual_revenue: Optional[float] = None
    lender_name: Optional[str] = None
    loan_amount: Optional[float] = None
    loan_reference: Optional[str] = None
    donor_name: Optional[str] = None
    donor_relationship: Optional[str] = None


class BankStatementRequest(BaseModel):
    bank_name: str
    account_number: str
    account_holder_name: str
    statement_start_date: date
    statement_end_date: date
    document_url: str
    opening_balance: Optional[float] = None
    closing_balance: Optional[float] = None
    total_credits: Optional[float] = None
    total_debits: Optional[float] = None


class IncomeDocumentRequest(BaseModel):
    document_type: str
    document_url: str
    tax_year: Optional[int] = None
    employer_name: Optional[str] = None
    gross_income: Optional[float] = None
    net_income: Optional[float] = None


class PurchaseAgreementRequest(BaseModel):
    document_url: str
    buyer_name: str
    buyer_address: str
    buyer_id_number: Optional[str] = None
    seller_name: str
    seller_address: str
    seller_id_number: Optional[str] = None
    property_address: str
    property_description: str
    property_type: str
    property_size: Optional[str] = None
    title_reference: Optional[str] = None
    purchase_price: float
    currency: str = "NGN"
    deposit_amount: Optional[float] = None
    deposit_paid: bool = False
    completion_date: Optional[date] = None
    buyer_signed: bool = False
    buyer_signature_date: Optional[date] = None
    seller_signed: bool = False
    seller_signature_date: Optional[date] = None
    witness_signed: bool = False


class VerifyRequest(BaseModel):
    verified_by: str
    notes: Optional[str] = None


class RejectRequest(BaseModel):
    rejected_by: str
    reason: str


# ============================================================================
# DEPENDENCIES
# ============================================================================

def get_compliance_client() -> PropertyComplianceClient:
    return PropertyComplianceClient()


def get_document_service() -> PropertyDocumentService:
    return PropertyDocumentService()


def get_audit_logger_dep() -> PropertyAuditLogger:
    return get_audit_logger()


def get_audit_context(request: Request) -> AuditContext:
    return AuditContext(
        correlation_id=request.headers.get("X-Correlation-ID", str(datetime.utcnow().timestamp())),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
        request_id=request.headers.get("X-Request-ID")
    )


# ============================================================================
# PARTY ENDPOINTS
# ============================================================================

@router.post("/parties")
async def create_party(
    request: CreatePartyRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Create a new party (buyer, seller, agent, etc.)"""
    repo = PropertyPartyRepository(db)
    
    try:
        role = PartyRoleEnum(request.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {request.role}")
    
    party = repo.create(
        role=role,
        first_name=request.first_name,
        last_name=request.last_name,
        middle_name=request.middle_name,
        date_of_birth=request.date_of_birth,
        nationality=request.nationality,
        email=request.email,
        phone=request.phone,
        address_line1=request.address_line1,
        address_line2=request.address_line2,
        city=request.city,
        state=request.state,
        country=request.country,
        postal_code=request.postal_code,
        id_type=request.id_type,
        id_number=request.id_number,
        id_issuing_country=request.id_issuing_country,
        id_issue_date=request.id_issue_date,
        id_expiry_date=request.id_expiry_date,
        bvn=request.bvn,
        nin=request.nin,
        user_id=request.user_id,
        kyc_profile_id=request.kyc_profile_id
    )
    
    if AUDIT_ENABLED:
        await audit.log(
            action=AuditActionType.PARTY_CREATED,
            transaction_id="",
            actor_id=request.user_id,
            actor_type=AuditActorType.USER if request.user_id else AuditActorType.SYSTEM,
            resource_type="party",
            resource_id=party.id,
            new_value={"role": role.value, "name": f"{request.first_name} {request.last_name}"},
            context=get_audit_context(req)
        )
    
    return {"id": party.id, "role": party.role.value, "kyc_status": party.kyc_status.value}


@router.get("/parties/{party_id}")
async def get_party(party_id: str, db: Session = Depends(get_db)):
    """Get party by ID"""
    repo = PropertyPartyRepository(db)
    party = repo.get_by_id(party_id)
    
    if not party:
        raise HTTPException(status_code=404, detail="Party not found")
    
    return {
        "id": party.id,
        "role": party.role.value,
        "first_name": party.first_name,
        "last_name": party.last_name,
        "email": party.email,
        "kyc_status": party.kyc_status.value,
        "sanctions_clear": party.sanctions_clear,
        "pep_clear": party.pep_clear,
        "created_at": party.created_at.isoformat()
    }


@router.post("/parties/{party_id}/verify")
async def verify_party(
    party_id: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Verify party KYC"""
    repo = PropertyPartyRepository(db)
    party = repo.get_by_id(party_id)
    
    if not party:
        raise HTTPException(status_code=404, detail="Party not found")
    
    party = repo.update_kyc_status(
        party,
        PropertyVerificationStatusEnum.APPROVED,
        request.verified_by
    )
    
    if AUDIT_ENABLED:
        await audit.log_party_verified(
            transaction_id="",
            party_id=party_id,
            party_role=party.role.value,
            verified_by=request.verified_by,
            context=get_audit_context(req)
        )
    
    return {"id": party.id, "kyc_status": party.kyc_status.value}


@router.post("/parties/{party_id}/screen")
async def screen_party(
    party_id: str,
    transaction_id: str,
    req: Request,
    db: Session = Depends(get_db),
    compliance: PropertyComplianceClient = Depends(get_compliance_client),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Screen party for sanctions, PEP, and AML"""
    if not COMPLIANCE_ENABLED:
        return {"message": "Compliance screening disabled", "result": "skipped"}
    
    repo = PropertyPartyRepository(db)
    tx_repo = PropertyTransactionRepository(db)
    
    party = repo.get_by_id(party_id)
    if not party:
        raise HTTPException(status_code=404, detail="Party not found")
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    try:
        screening_request = PartyScreeningRequest(
            party_id=party_id,
            first_name=party.first_name,
            last_name=party.last_name,
            middle_name=party.middle_name,
            date_of_birth=party.date_of_birth.isoformat(),
            nationality=party.nationality,
            id_type=party.id_type,
            id_number=party.id_number,
            bvn=party.bvn,
            nin=party.nin,
            address_country=party.country,
            transaction_id=transaction_id,
            transaction_amount=float(transaction.purchase_price),
            transaction_currency=transaction.currency,
            screening_types=[ScreeningType.SANCTIONS, ScreeningType.PEP, ScreeningType.AML]
        )
        
        result = await compliance.screen_party(screening_request)
        
        # Update party with screening results
        repo.update_screening_results(
            party,
            screening_result_id=result.screening_id,
            sanctions_clear=result.sanctions_result == ScreeningResult.CLEAR,
            pep_clear=result.pep_result == ScreeningResult.CLEAR
        )
        
        if AUDIT_ENABLED:
            await audit.log_compliance_screening(
                transaction_id=transaction_id,
                party_id=party_id,
                screening_id=result.screening_id,
                result=result.overall_result.value,
                risk_score=result.risk_score,
                matches_found=len(result.matches),
                context=get_audit_context(req)
            )
        
        return {
            "screening_id": result.screening_id,
            "overall_result": result.overall_result.value,
            "sanctions_result": result.sanctions_result.value,
            "pep_result": result.pep_result.value,
            "risk_score": result.risk_score,
            "requires_review": result.requires_review
        }
        
    except ComplianceServiceError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ============================================================================
# TRANSACTION ENDPOINTS
# ============================================================================

@router.post("/transactions")
async def create_transaction(
    request: CreateTransactionRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Create a new property transaction"""
    party_repo = PropertyPartyRepository(db)
    tx_repo = PropertyTransactionRepository(db)
    
    # Verify buyer exists
    buyer = party_repo.get_by_id(request.buyer_id)
    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    
    if buyer.role != PartyRoleEnum.BUYER:
        raise HTTPException(status_code=400, detail="Party is not a buyer")
    
    transaction = tx_repo.create(
        buyer_id=request.buyer_id,
        property_type=request.property_type,
        property_address=request.property_address,
        purchase_price=Decimal(str(request.purchase_price)),
        currency=request.currency
    )
    
    if AUDIT_ENABLED:
        await audit.log_transaction_created(
            transaction_id=transaction.id,
            buyer_id=request.buyer_id,
            property_address=request.property_address,
            purchase_price=request.purchase_price,
            context=get_audit_context(req)
        )
    
    return {
        "id": transaction.id,
        "reference_number": transaction.reference_number,
        "status": transaction.status.value
    }


@router.get("/transactions/{transaction_id}")
async def get_transaction(transaction_id: str, db: Session = Depends(get_db)):
    """Get transaction by ID"""
    repo = PropertyTransactionRepository(db)
    transaction = repo.get_by_id(transaction_id)
    
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    return {
        "id": transaction.id,
        "reference_number": transaction.reference_number,
        "property_type": transaction.property_type,
        "property_address": transaction.property_address,
        "purchase_price": float(transaction.purchase_price),
        "currency": transaction.currency,
        "buyer_id": transaction.buyer_id,
        "seller_id": transaction.seller_id,
        "status": transaction.status.value,
        "risk_score": transaction.risk_score,
        "risk_flags": transaction.risk_flags,
        "created_at": transaction.created_at.isoformat()
    }


@router.post("/transactions/{transaction_id}/seller")
async def add_seller(
    transaction_id: str,
    seller_id: str,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Add seller to transaction"""
    party_repo = PropertyPartyRepository(db)
    tx_repo = PropertyTransactionRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    seller = party_repo.get_by_id(seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Seller not found")
    
    if seller.role != PartyRoleEnum.SELLER:
        raise HTTPException(status_code=400, detail="Party is not a seller")
    
    transaction = tx_repo.add_seller(transaction, seller_id)
    
    # Transition to seller KYC pending
    try:
        transaction = tx_repo.transition_status(
            transaction,
            TransactionStatusEnum.SELLER_KYC_PENDING,
            "Seller added to transaction",
            actor_id=None
        )
    except StateTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    if AUDIT_ENABLED:
        await audit.log_status_change(
            transaction_id=transaction_id,
            old_status=TransactionStatusEnum.BUYER_KYC_PENDING.value,
            new_status=transaction.status.value,
            reason="Seller added",
            context=get_audit_context(req)
        )
    
    return {"id": transaction.id, "seller_id": seller_id, "status": transaction.status.value}


@router.get("/transactions/{transaction_id}/checklist")
async def get_checklist(
    transaction_id: str,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Get KYC checklist for transaction"""
    repo = PropertyTransactionRepository(db)
    transaction = repo.get_by_id(transaction_id)
    
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    checklist = repo.get_checklist(transaction)
    
    if AUDIT_ENABLED:
        await audit.log_checklist_viewed(
            transaction_id=transaction_id,
            viewer_id=req.headers.get("X-User-ID", "anonymous"),
            context=get_audit_context(req)
        )
    
    return checklist


# ============================================================================
# SOURCE OF FUNDS ENDPOINTS
# ============================================================================

@router.post("/transactions/{transaction_id}/source-of-funds")
async def declare_source_of_funds(
    transaction_id: str,
    request: SourceOfFundsRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Declare source of funds for transaction"""
    tx_repo = PropertyTransactionRepository(db)
    sof_repo = PropertySourceOfFundsRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    try:
        source = SourceOfFundsEnum(request.primary_source)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid source: {request.primary_source}")
    
    sof = sof_repo.create(
        transaction_id=transaction_id,
        primary_source=source,
        primary_source_description=request.primary_source_description,
        primary_source_amount=Decimal(str(request.primary_source_amount)),
        secondary_sources=request.secondary_sources or [],
        employer_name=request.employer_name,
        employer_address=request.employer_address,
        job_title=request.job_title,
        employment_start_date=request.employment_start_date,
        monthly_salary=Decimal(str(request.monthly_salary)) if request.monthly_salary else None,
        business_name=request.business_name,
        business_registration_number=request.business_registration_number,
        business_type=request.business_type,
        annual_revenue=Decimal(str(request.annual_revenue)) if request.annual_revenue else None,
        lender_name=request.lender_name,
        loan_amount=Decimal(str(request.loan_amount)) if request.loan_amount else None,
        loan_reference=request.loan_reference,
        donor_name=request.donor_name,
        donor_relationship=request.donor_relationship
    )
    
    # Update transaction
    transaction.source_of_funds_id = sof.id
    db.commit()
    
    if AUDIT_ENABLED:
        await audit.log(
            action=AuditActionType.SOURCE_OF_FUNDS_DECLARED,
            transaction_id=transaction_id,
            resource_type="source_of_funds",
            resource_id=sof.id,
            new_value={"primary_source": source.value, "amount": request.primary_source_amount},
            context=get_audit_context(req)
        )
    
    return {"id": sof.id, "primary_source": sof.primary_source.value, "risk_flags": sof.risk_flags}


@router.post("/transactions/{transaction_id}/source-of-funds/verify")
async def verify_source_of_funds(
    transaction_id: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Verify source of funds"""
    tx_repo = PropertyTransactionRepository(db)
    sof_repo = PropertySourceOfFundsRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    sof = sof_repo.get_by_transaction(transaction_id)
    if not sof:
        raise HTTPException(status_code=404, detail="Source of funds not declared")
    
    sof = sof_repo.verify(
        sof,
        PropertyVerificationStatusEnum.APPROVED,
        request.verified_by,
        request.notes
    )
    
    transaction.source_of_funds_verified = True
    db.commit()
    
    if AUDIT_ENABLED:
        await audit.log(
            action=AuditActionType.SOURCE_OF_FUNDS_VERIFIED,
            transaction_id=transaction_id,
            actor_id=request.verified_by,
            actor_type=AuditActorType.REVIEWER,
            resource_type="source_of_funds",
            resource_id=sof.id,
            context=get_audit_context(req)
        )
    
    return {"id": sof.id, "status": sof.status.value}


# ============================================================================
# BANK STATEMENT ENDPOINTS
# ============================================================================

@router.post("/transactions/{transaction_id}/bank-statements")
async def upload_bank_statement(
    transaction_id: str,
    party_id: str,
    request: BankStatementRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Upload bank statement"""
    tx_repo = PropertyTransactionRepository(db)
    bs_repo = PropertyBankStatementRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    statement = bs_repo.create(
        transaction_id=transaction_id,
        party_id=party_id,
        bank_name=request.bank_name,
        account_number=request.account_number,
        account_holder_name=request.account_holder_name,
        statement_start_date=request.statement_start_date,
        statement_end_date=request.statement_end_date,
        document_url=request.document_url,
        opening_balance=Decimal(str(request.opening_balance)) if request.opening_balance else None,
        closing_balance=Decimal(str(request.closing_balance)) if request.closing_balance else None,
        total_credits=Decimal(str(request.total_credits)) if request.total_credits else None,
        total_debits=Decimal(str(request.total_debits)) if request.total_debits else None
    )
    
    if AUDIT_ENABLED:
        await audit.log(
            action=AuditActionType.BANK_STATEMENT_UPLOADED,
            transaction_id=transaction_id,
            resource_type="bank_statement",
            resource_id=statement.id,
            new_value={
                "bank_name": request.bank_name,
                "date_range": f"{request.statement_start_date} to {request.statement_end_date}"
            },
            context=get_audit_context(req)
        )
    
    return {"id": statement.id, "status": statement.status.value}


@router.get("/transactions/{transaction_id}/bank-statements/validate")
async def validate_bank_statements(
    transaction_id: str,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Validate bank statement coverage (3 months minimum)"""
    tx_repo = PropertyTransactionRepository(db)
    bs_repo = PropertyBankStatementRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    validation = bs_repo.validate_coverage(transaction_id)
    
    if validation["valid"]:
        transaction.bank_statements_cover_3_months = True
        db.commit()
    
    if AUDIT_ENABLED:
        await audit.log(
            action=AuditActionType.BANK_STATEMENT_COVERAGE_VALIDATED,
            transaction_id=transaction_id,
            resource_type="bank_statements",
            details=validation,
            context=get_audit_context(req)
        )
    
    return validation


# ============================================================================
# INCOME DOCUMENT ENDPOINTS
# ============================================================================

@router.post("/transactions/{transaction_id}/income-documents")
async def upload_income_document(
    transaction_id: str,
    party_id: str,
    request: IncomeDocumentRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Upload income document"""
    tx_repo = PropertyTransactionRepository(db)
    doc_repo = PropertyIncomeDocumentRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    try:
        doc_type = IncomeDocumentTypeEnum(request.document_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid document type: {request.document_type}")
    
    doc = doc_repo.create(
        transaction_id=transaction_id,
        party_id=party_id,
        document_type=doc_type,
        document_url=request.document_url,
        tax_year=request.tax_year,
        employer_name=request.employer_name,
        gross_income=Decimal(str(request.gross_income)) if request.gross_income else None,
        net_income=Decimal(str(request.net_income)) if request.net_income else None
    )
    
    if AUDIT_ENABLED:
        await audit.log(
            action=AuditActionType.INCOME_DOCUMENT_UPLOADED,
            transaction_id=transaction_id,
            resource_type="income_document",
            resource_id=doc.id,
            new_value={"document_type": doc_type.value},
            context=get_audit_context(req)
        )
    
    return {"id": doc.id, "document_type": doc.document_type.value, "status": doc.status.value}


@router.post("/transactions/{transaction_id}/income-documents/{document_id}/verify")
async def verify_income_document(
    transaction_id: str,
    document_id: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Verify income document"""
    tx_repo = PropertyTransactionRepository(db)
    doc_repo = PropertyIncomeDocumentRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    doc = doc_repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    doc = doc_repo.verify(doc, PropertyVerificationStatusEnum.APPROVED, request.verified_by)
    
    # Check if all income documents are verified
    if doc_repo.all_verified(transaction_id):
        transaction.income_verified = True
        db.commit()
    
    if AUDIT_ENABLED:
        await audit.log_document_verified(
            transaction_id=transaction_id,
            document_id=document_id,
            document_type=doc.document_type.value,
            verified_by=request.verified_by,
            context=get_audit_context(req)
        )
    
    return {"id": doc.id, "status": doc.status.value}


# ============================================================================
# PURCHASE AGREEMENT ENDPOINTS
# ============================================================================

@router.post("/transactions/{transaction_id}/purchase-agreement")
async def upload_purchase_agreement(
    transaction_id: str,
    request: PurchaseAgreementRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Upload purchase agreement"""
    tx_repo = PropertyTransactionRepository(db)
    pa_repo = PropertyPurchaseAgreementRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    agreement = pa_repo.create(
        transaction_id=transaction_id,
        document_url=request.document_url,
        buyer_name=request.buyer_name,
        buyer_address=request.buyer_address,
        buyer_id_number=request.buyer_id_number,
        seller_name=request.seller_name,
        seller_address=request.seller_address,
        seller_id_number=request.seller_id_number,
        property_address=request.property_address,
        property_description=request.property_description,
        property_type=request.property_type,
        property_size=request.property_size,
        title_reference=request.title_reference,
        purchase_price=Decimal(str(request.purchase_price)),
        currency=request.currency,
        deposit_amount=Decimal(str(request.deposit_amount)) if request.deposit_amount else None,
        deposit_paid=request.deposit_paid,
        completion_date=request.completion_date,
        buyer_signed=request.buyer_signed,
        buyer_signature_date=request.buyer_signature_date,
        seller_signed=request.seller_signed,
        seller_signature_date=request.seller_signature_date,
        witness_signed=request.witness_signed
    )
    
    # Update transaction
    transaction.purchase_agreement_id = agreement.id
    db.commit()
    
    if AUDIT_ENABLED:
        await audit.log(
            action=AuditActionType.PURCHASE_AGREEMENT_UPLOADED,
            transaction_id=transaction_id,
            resource_type="purchase_agreement",
            resource_id=agreement.id,
            new_value={"purchase_price": request.purchase_price},
            context=get_audit_context(req)
        )
    
    return {"id": agreement.id, "status": agreement.status.value}


@router.get("/transactions/{transaction_id}/purchase-agreement/validate")
async def validate_purchase_agreement(
    transaction_id: str,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Validate purchase agreement parties match KYC"""
    tx_repo = PropertyTransactionRepository(db)
    pa_repo = PropertyPurchaseAgreementRepository(db)
    party_repo = PropertyPartyRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    agreement = pa_repo.get_by_transaction(transaction_id)
    if not agreement:
        raise HTTPException(status_code=404, detail="Purchase agreement not found")
    
    buyer = party_repo.get_by_id(transaction.buyer_id)
    seller = party_repo.get_by_id(transaction.seller_id) if transaction.seller_id else None
    
    if not buyer:
        raise HTTPException(status_code=400, detail="Buyer not found")
    if not seller:
        raise HTTPException(status_code=400, detail="Seller not added to transaction")
    
    validation = pa_repo.validate_parties(agreement, buyer, seller)
    
    if AUDIT_ENABLED:
        await audit.log(
            action=AuditActionType.PURCHASE_AGREEMENT_PARTIES_VALIDATED,
            transaction_id=transaction_id,
            resource_type="purchase_agreement",
            resource_id=agreement.id,
            details=validation,
            context=get_audit_context(req)
        )
    
    return validation


# ============================================================================
# TRANSACTION WORKFLOW ENDPOINTS
# ============================================================================

@router.post("/transactions/{transaction_id}/submit")
async def submit_for_review(
    transaction_id: str,
    req: Request,
    db: Session = Depends(get_db),
    compliance: PropertyComplianceClient = Depends(get_compliance_client),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Submit transaction for compliance review"""
    tx_repo = PropertyTransactionRepository(db)
    party_repo = PropertyPartyRepository(db)
    sof_repo = PropertySourceOfFundsRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    # Get parties
    buyer = party_repo.get_by_id(transaction.buyer_id)
    seller = party_repo.get_by_id(transaction.seller_id) if transaction.seller_id else None
    sof = sof_repo.get_by_transaction(transaction_id)
    
    # Screen parties if compliance is enabled
    buyer_screening = None
    seller_screening = None
    
    if COMPLIANCE_ENABLED and buyer:
        try:
            results = await screen_property_transaction_parties(
                compliance,
                transaction_id,
                float(transaction.purchase_price),
                transaction.currency,
                {
                    "id": buyer.id,
                    "first_name": buyer.first_name,
                    "last_name": buyer.last_name,
                    "middle_name": buyer.middle_name,
                    "date_of_birth": buyer.date_of_birth.isoformat(),
                    "nationality": buyer.nationality,
                    "id_type": buyer.id_type,
                    "id_number": buyer.id_number,
                    "bvn": buyer.bvn,
                    "nin": buyer.nin,
                    "country": buyer.country
                },
                {
                    "id": seller.id,
                    "first_name": seller.first_name,
                    "last_name": seller.last_name,
                    "middle_name": seller.middle_name,
                    "date_of_birth": seller.date_of_birth.isoformat(),
                    "nationality": seller.nationality,
                    "id_type": seller.id_type,
                    "id_number": seller.id_number,
                    "bvn": seller.bvn,
                    "nin": seller.nin,
                    "country": seller.country
                } if seller else None
            )
            buyer_screening = results.get("buyer")
            seller_screening = results.get("seller")
            
            # Update compliance results
            tx_repo.update_compliance_results(
                transaction,
                aml_passed=buyer_screening.aml_result == ScreeningResult.CLEAR if buyer_screening else False,
                sanctions_passed=buyer_screening.sanctions_result == ScreeningResult.CLEAR if buyer_screening else False,
                pep_passed=buyer_screening.pep_result == ScreeningResult.CLEAR if buyer_screening else False
            )
        except ComplianceServiceError as e:
            logger.warning(f"Compliance screening failed: {e}")
    
    # Calculate risk score
    risk_result = calculate_property_risk_score(
        transaction_amount=float(transaction.purchase_price),
        currency=transaction.currency,
        source_of_funds=sof.primary_source.value if sof else "other",
        buyer_screening=buyer_screening,
        seller_screening=seller_screening,
        bank_statements_verified=transaction.bank_statements_verified,
        income_verified=transaction.income_verified,
        purchase_agreement_verified=transaction.purchase_agreement_verified
    )
    
    tx_repo.update_risk_score(
        transaction,
        risk_result["risk_score"],
        risk_result["risk_flags"]
    )
    
    # Transition to under review
    try:
        old_status = transaction.status.value
        transaction = tx_repo.transition_status(
            transaction,
            TransactionStatusEnum.UNDER_REVIEW,
            "Submitted for compliance review"
        )
    except StateTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    if AUDIT_ENABLED:
        await audit.log_status_change(
            transaction_id=transaction_id,
            old_status=old_status,
            new_status=transaction.status.value,
            reason="Submitted for review",
            context=get_audit_context(req)
        )
        await audit.log_risk_score_calculated(
            transaction_id=transaction_id,
            risk_score=risk_result["risk_score"],
            risk_level=risk_result["risk_level"],
            risk_flags=risk_result["risk_flags"],
            context=get_audit_context(req)
        )
    
    return {
        "id": transaction.id,
        "status": transaction.status.value,
        "risk_score": transaction.risk_score,
        "risk_level": risk_result["risk_level"],
        "requires_enhanced_due_diligence": risk_result["requires_enhanced_due_diligence"]
    }


@router.post("/transactions/{transaction_id}/approve")
async def approve_transaction(
    transaction_id: str,
    request: VerifyRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Approve transaction"""
    tx_repo = PropertyTransactionRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    # Verify checklist is complete
    checklist = tx_repo.get_checklist(transaction)
    if not checklist["ready_for_approval"]:
        incomplete = [k for k, v in checklist["requirements"].items() if v["status"] != "complete"]
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve: incomplete requirements: {incomplete}"
        )
    
    try:
        old_status = transaction.status.value
        transaction = tx_repo.transition_status(
            transaction,
            TransactionStatusEnum.APPROVED,
            f"Approved by {request.verified_by}",
            actor_id=request.verified_by
        )
    except StateTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    if AUDIT_ENABLED:
        await audit.log_transaction_approved(
            transaction_id=transaction_id,
            approved_by=request.verified_by,
            notes=request.notes,
            context=get_audit_context(req)
        )
    
    return {"id": transaction.id, "status": transaction.status.value, "approved_at": transaction.approved_at.isoformat()}


@router.post("/transactions/{transaction_id}/reject")
async def reject_transaction(
    transaction_id: str,
    request: RejectRequest,
    req: Request,
    db: Session = Depends(get_db),
    audit: PropertyAuditLogger = Depends(get_audit_logger_dep)
):
    """Reject transaction"""
    tx_repo = PropertyTransactionRepository(db)
    
    transaction = tx_repo.get_by_id(transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    try:
        old_status = transaction.status.value
        transaction = tx_repo.transition_status(
            transaction,
            TransactionStatusEnum.REJECTED,
            f"Rejected: {request.reason}",
            actor_id=request.rejected_by
        )
    except StateTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    if AUDIT_ENABLED:
        await audit.log_transaction_rejected(
            transaction_id=transaction_id,
            rejected_by=request.rejected_by,
            reason=request.reason,
            context=get_audit_context(req)
        )
    
    return {"id": transaction.id, "status": transaction.status.value}


# ============================================================================
# AUDIT LOG ENDPOINTS
# ============================================================================

@router.get("/transactions/{transaction_id}/audit-logs")
async def get_audit_logs(
    transaction_id: str,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get audit logs for a transaction"""
    repo = PropertyAuditLogRepository(db)
    logs = repo.get_by_transaction(transaction_id, limit)
    
    return {
        "transaction_id": transaction_id,
        "logs": [
            {
                "id": log.id,
                "action": log.action,
                "action_type": log.action_type,
                "actor_id": log.actor_id,
                "actor_type": log.actor_type,
                "old_status": log.old_status,
                "new_status": log.new_status,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "details": log.details,
                "created_at": log.created_at.isoformat()
            }
            for log in logs
        ]
    }
