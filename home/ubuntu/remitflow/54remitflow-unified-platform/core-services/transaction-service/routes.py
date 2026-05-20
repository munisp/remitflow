"""
API routes for transaction-service with idempotency support

All money-moving endpoints use idempotency keys to prevent duplicate transactions
when clients retry failed requests (critical for offline-first architecture).
"""

from fastapi import APIRouter, HTTPException, Depends, Header, Request
from typing import List, Optional
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import uuid
import logging

from .models import TransactionServiceModel
from .service import TransactionServiceService
from .database import get_db
from .idempotency import IdempotencyService
from .lakehouse_publisher import publish_transaction_to_lakehouse
from .risk_client import (
    assess_transaction_risk,
    is_transaction_blocked,
    requires_manual_review,
    RiskServiceUnavailable
)
from .limits_client import (
    check_transaction_limits,
    determine_corridor,
    determine_user_tier,
    LimitsServiceUnavailable
)
from .kyc_client import (
    verify_user_kyc,
    is_kyc_blocked,
    requires_kyc_upgrade,
    KYCServiceUnavailable
)
from .compliance_client import (
    check_transaction_compliance,
    is_compliance_blocked,
    requires_compliance_review,
    ComplianceServiceUnavailable
)
from .property_kyc_client import (
    verify_property_transaction_kyc,
    is_property_kyc_approved,
    get_property_kyc_blocking_reason,
    PropertyKYCServiceUnavailable
)

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
try:
    from audit_client import (
        audit_transaction_created,
        audit_compliance_check
    )
    AUDIT_AVAILABLE = True
except ImportError:
    AUDIT_AVAILABLE = False

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/transactions", tags=["transactions"])


# ==================== Request/Response Schemas ====================

class TransferRequest(BaseModel):
    """Request schema for money transfer"""
    recipient_name: str = Field(..., min_length=1, max_length=200)
    recipient_phone: str = Field(..., min_length=10, max_length=20)
    recipient_bank: Optional[str] = None
    recipient_account: Optional[str] = None
    amount: float = Field(..., gt=0)
    source_currency: str = Field(..., min_length=3, max_length=3)
    destination_currency: str = Field(..., min_length=3, max_length=3)
    exchange_rate: Optional[float] = None
    fee: Optional[float] = 0.0
    delivery_method: str = Field(default="bank_transfer")
    note: Optional[str] = None


class TransferResponse(BaseModel):
    """Response schema for money transfer"""
    transaction_id: str
    status: str
    amount: float
    currency: str
    fee: float
    total_amount: float
    recipient_name: str
    reference_number: str
    created_at: str
    is_duplicate: bool = False
    message: str = "Transfer initiated successfully"


class TransactionStatusResponse(BaseModel):
    """Response schema for transaction status"""
    transaction_id: str
    status: str
    amount: float
    currency: str
    fee: float
    recipient_name: Optional[str] = None
    reference_number: str
    created_at: str
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None


# ==================== Helper Functions ====================

def get_user_id_from_request(request: Request) -> str:
    """Extract user ID from request (from auth token in production)."""
    user_id = request.headers.get("X-User-ID", "anonymous")
    return user_id


# ==================== Money-Moving Endpoints (with Idempotency) ====================

@router.post("/transfer", response_model=TransferResponse)
async def create_transfer(
    transfer: TransferRequest,
    request: Request,
    db: Session = Depends(get_db),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")
):
    """
    Create a money transfer with idempotency support.
    
    If Idempotency-Key header is provided:
    - First request: Process transfer and store result
    - Duplicate request: Return stored result without reprocessing
    """
    user_id = get_user_id_from_request(request)
    
    if not idempotency_key:
        idempotency_key = str(uuid.uuid4())
    
    # Check for duplicate request
    idempotency_service = IdempotencyService(db)
    existing = await idempotency_service.check_idempotency(idempotency_key, user_id)
    
    if existing:
        logger.info(f"Duplicate transfer request: {idempotency_key}")
        response_data = existing.get("response", {})
        return TransferResponse(
            transaction_id=existing["transaction_id"],
            status=response_data.get("status", "completed"),
            amount=response_data.get("amount", transfer.amount),
            currency=response_data.get("currency", transfer.source_currency),
            fee=response_data.get("fee", transfer.fee or 0),
            total_amount=response_data.get("total_amount", transfer.amount + (transfer.fee or 0)),
            recipient_name=response_data.get("recipient_name", transfer.recipient_name),
            reference_number=response_data.get("reference_number", ""),
            created_at=existing["created_at"],
            is_duplicate=True,
            message="Duplicate request - returning original result"
        )
    
    # Process new transfer
    try:
        service = TransactionServiceService()
        fee = transfer.fee or 0.0
        total_amount = transfer.amount + fee
        
        # Determine corridor and user tier for limit checks
        corridor = determine_corridor(transfer.source_currency, transfer.destination_currency)
        user_tier = request.headers.get("X-User-Tier", "tier_1")
        user_tier_enum = determine_user_tier(user_tier)
        user_name = request.headers.get("X-User-Name", "Unknown User")
        destination_country = request.headers.get("X-Destination-Country", "NG")
        
        # 1. KYC Verification - MUST pass before creating transaction (bank-grade requirement)
        try:
            kyc_result = await verify_user_kyc(
                user_id=user_id,
                amount=transfer.amount,
                transaction_type="international_transfer" if destination_country != "NG" else "transfer",
                destination_country=destination_country
            )
            
            if is_kyc_blocked(kyc_result):
                logger.warning(f"Transaction blocked by KYC: user={user_id}, tier={kyc_result.current_tier}")
                raise HTTPException(
                    status_code=403,
                    detail=f"KYC verification required: {kyc_result.missing_requirements}"
                )
            
            if requires_kyc_upgrade(kyc_result):
                logger.info(f"KYC upgrade required: user={user_id}, current={kyc_result.current_tier}, required={kyc_result.required_tier}")
                raise HTTPException(
                    status_code=403,
                    detail=f"KYC tier upgrade required. Current: {kyc_result.current_tier.value}, Required: {kyc_result.required_tier.value if kyc_result.required_tier else 'higher'}"
                )
        except KYCServiceUnavailable as e:
            logger.error(f"KYC service unavailable: {e}")
            raise HTTPException(status_code=503, detail="KYC verification service unavailable. Please try again later.")
        
        # 2. Compliance Check (AML/Sanctions) - MUST pass before creating transaction (bank-grade requirement)
        try:
            compliance_result = await check_transaction_compliance(
                user_id=user_id,
                user_name=user_name,
                amount=transfer.amount,
                source_currency=transfer.source_currency,
                destination_currency=transfer.destination_currency,
                destination_country=destination_country,
                beneficiary_name=transfer.recipient_name,
                beneficiary_country=destination_country
            )
            
            if is_compliance_blocked(compliance_result):
                logger.warning(f"Transaction blocked by compliance: user={user_id}, risk={compliance_result.risk_level}")
                # Log audit event for compliance block
                if AUDIT_AVAILABLE:
                    await audit_compliance_check(
                        service_name="transaction-service",
                        user_id=user_id,
                        transaction_id="blocked",
                        passed=False,
                        risk_level=compliance_result.risk_level.value,
                        details={"matches": len(compliance_result.matches)}
                    )
                raise HTTPException(
                    status_code=403,
                    detail="Transaction blocked by compliance screening. Please contact support."
                )
            
            if requires_compliance_review(compliance_result):
                logger.info(f"Compliance review required: user={user_id}, risk={compliance_result.risk_level}")
        except ComplianceServiceUnavailable as e:
            logger.error(f"Compliance service unavailable: {e}")
            raise HTTPException(status_code=503, detail="Compliance screening service unavailable. Please try again later.")
        
        # 3. Risk Assessment - MUST pass before creating transaction
        try:
            risk_result = await assess_transaction_risk(
                user_id=user_id,
                amount=transfer.amount,
                source_currency=transfer.source_currency,
                destination_currency=transfer.destination_currency,
                is_new_beneficiary=transfer.recipient_account is not None
            )
            
            if is_transaction_blocked(risk_result):
                logger.warning(f"Transaction blocked by risk: user={user_id}, score={risk_result.risk_score}")
                raise HTTPException(
                    status_code=403,
                    detail=f"Transaction blocked by risk assessment: {risk_result.recommended_actions[0] if risk_result.recommended_actions else 'High risk score'}"
                )
            
            if requires_manual_review(risk_result):
                logger.info(f"Transaction requires review: user={user_id}, score={risk_result.risk_score}")
        except RiskServiceUnavailable as e:
            logger.error(f"Risk service unavailable: {e}")
            raise HTTPException(status_code=503, detail="Risk assessment service unavailable. Please try again later.")
        
        # 2. Limits Check - MUST pass before creating transaction
        try:
            limits_result = await check_transaction_limits(
                user_id=user_id,
                user_tier=user_tier_enum,
                corridor=corridor,
                amount=transfer.amount,
                currency=transfer.source_currency
            )
            
            if not limits_result.allowed:
                logger.warning(f"Transaction exceeds limits: user={user_id}, reason={limits_result.message}")
                raise HTTPException(
                    status_code=403,
                    detail=f"Transaction limit exceeded: {limits_result.message}"
                )
        except LimitsServiceUnavailable as e:
            logger.error(f"Limits service unavailable: {e}")
            raise HTTPException(status_code=503, detail="Limits service unavailable. Please try again later.")
        
        # 3. Create transaction (only if risk and limits passed)
        transaction_data = {
            "user_id": user_id,
            "transaction_type": "transfer",
            "amount": transfer.amount,
            "currency": transfer.source_currency,
            "destination_currency": transfer.destination_currency,
            "exchange_rate": transfer.exchange_rate,
            "fee": fee,
            "total_amount": total_amount,
            "recipient_name": transfer.recipient_name,
            "recipient_phone": transfer.recipient_phone,
            "recipient_bank": transfer.recipient_bank,
            "recipient_account": transfer.recipient_account,
            "delivery_method": transfer.delivery_method,
            "note": transfer.note,
            "status": "pending" if not requires_manual_review(risk_result) else "review",
            "idempotency_key": idempotency_key,
            "risk_score": risk_result.risk_score,
            "corridor": corridor.value
        }
        
        result = await service.create(transaction_data)
        transaction_id = result.get("id", str(uuid.uuid4()))
        reference_number = result.get("reference_number", f"TXN{transaction_id[:8].upper()}")
        created_at = result.get("created_at", "")
        
        response_data = {
            "transaction_id": transaction_id,
            "status": "pending",
            "amount": transfer.amount,
            "currency": transfer.source_currency,
            "fee": fee,
            "total_amount": total_amount,
            "recipient_name": transfer.recipient_name,
            "reference_number": reference_number,
            "created_at": created_at
        }
        
        await idempotency_service.store_idempotency(
            idempotency_key=idempotency_key,
            user_id=user_id,
            transaction_id=transaction_id,
            response_data=response_data
        )
        
        # Publish transaction event to lakehouse for analytics (fire-and-forget)
        await publish_transaction_to_lakehouse(
            transaction_id=transaction_id,
            user_id=user_id,
            event_type="created",
            transaction_data=transaction_data
        )
        
        # Log audit event for transaction creation (fire-and-forget)
        if AUDIT_AVAILABLE:
            await audit_transaction_created(
                service_name="transaction-service",
                transaction_id=transaction_id,
                user_id=user_id,
                amount=transfer.amount,
                currency=transfer.source_currency,
                transaction_type="transfer",
                details={
                    "recipient_name": transfer.recipient_name,
                    "corridor": corridor.value,
                    "risk_score": risk_result.risk_score,
                    "compliance_risk": compliance_result.risk_level.value
                }
            )
        
        return TransferResponse(**response_data, is_duplicate=False)
        
    except Exception as e:
        logger.error(f"Transfer failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transfer failed: {str(e)}")


@router.get("/transfer/{transaction_id}", response_model=TransactionStatusResponse)
async def get_transfer_status(transaction_id: str, request: Request):
    """Get the status of a transfer by transaction ID."""
    service = TransactionServiceService()
    result = await service.get(transaction_id)
    
    if not result:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    return TransactionStatusResponse(
        transaction_id=result.get("id", transaction_id),
        status=result.get("status", "unknown"),
        amount=result.get("amount", 0),
        currency=result.get("currency", "NGN"),
        fee=result.get("fee", 0),
        recipient_name=result.get("recipient_name"),
        reference_number=result.get("reference_number", ""),
        created_at=result.get("created_at", ""),
        updated_at=result.get("updated_at"),
        completed_at=result.get("completed_at")
    )


@router.get("/history")
async def get_transaction_history(
    request: Request,
    skip: int = 0,
    limit: int = 50
):
    """Get transaction history for the authenticated user."""
    user_id = get_user_id_from_request(request)
    service = TransactionServiceService()
    return await service.list_by_user(user_id, skip, limit)


# ==================== Property Transaction Endpoints (with Property KYC Enforcement) ====================

class PropertyTransferRequest(BaseModel):
    """Request schema for property transaction disbursement"""
    property_transaction_id: str = Field(..., description="Property transaction ID from property KYC service")
    recipient_name: str = Field(..., min_length=1, max_length=200)
    recipient_bank: str = Field(..., min_length=1, max_length=100)
    recipient_account: str = Field(..., min_length=1, max_length=50)
    amount: float = Field(..., gt=0)
    currency: str = Field(default="NGN", min_length=3, max_length=3)
    disbursement_type: str = Field(default="full", description="full, partial, or escrow_release")
    note: Optional[str] = None


@router.post("/property-transfer", response_model=TransferResponse)
async def create_property_transfer(
    transfer: PropertyTransferRequest,
    request: Request,
    db: Session = Depends(get_db),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")
):
    """
    Create a property transaction disbursement with Property KYC enforcement.
    
    This endpoint REQUIRES the property transaction to be APPROVED in the Property KYC
    service before any funds can be disbursed. This is a bank-grade requirement for
    high-value property transactions.
    """
    user_id = get_user_id_from_request(request)
    
    if not idempotency_key:
        idempotency_key = str(uuid.uuid4())
    
    # Check for duplicate request
    idempotency_service = IdempotencyService(db)
    existing = await idempotency_service.check_idempotency(idempotency_key, user_id)
    
    if existing:
        logger.info(f"Duplicate property transfer request: {idempotency_key}")
        response_data = existing.get("response", {})
        return TransferResponse(
            transaction_id=existing["transaction_id"],
            status=response_data.get("status", "completed"),
            amount=response_data.get("amount", transfer.amount),
            currency=response_data.get("currency", transfer.currency),
            fee=response_data.get("fee", 0),
            total_amount=response_data.get("total_amount", transfer.amount),
            recipient_name=response_data.get("recipient_name", transfer.recipient_name),
            reference_number=response_data.get("reference_number", ""),
            created_at=existing["created_at"],
            is_duplicate=True,
            message="Duplicate request - returning original result"
        )
    
    try:
        # CRITICAL: Property KYC Verification - MUST pass before disbursing property payments
        try:
            property_kyc_result = await verify_property_transaction_kyc(
                property_transaction_id=transfer.property_transaction_id,
                amount=transfer.amount,
                disbursement_type=transfer.disbursement_type
            )
            
            if not is_property_kyc_approved(property_kyc_result):
                blocking_reason = get_property_kyc_blocking_reason(property_kyc_result)
                logger.warning(
                    f"Property transfer blocked by KYC: property_tx={transfer.property_transaction_id}, "
                    f"status={property_kyc_result.status}, reason={blocking_reason}"
                )
                raise HTTPException(
                    status_code=403,
                    detail=f"Property transaction not approved for disbursement: {blocking_reason}"
                )
            
            logger.info(
                f"Property KYC verified for disbursement: property_tx={transfer.property_transaction_id}, "
                f"buyer_verified={property_kyc_result.buyer_kyc_verified}, "
                f"seller_verified={property_kyc_result.seller_kyc_verified}"
            )
            
        except PropertyKYCServiceUnavailable as e:
            logger.error(f"Property KYC service unavailable: {e}")
            # FAIL CLOSED - do not allow property disbursements if KYC service is unavailable
            raise HTTPException(
                status_code=503,
                detail="Property KYC verification service unavailable. Cannot process property disbursement."
            )
        
        # Standard KYC verification for the user
        user_name = request.headers.get("X-User-Name", "Unknown User")
        try:
            kyc_result = await verify_user_kyc(
                user_id=user_id,
                amount=transfer.amount,
                transaction_type="property_disbursement",
                destination_country="NG"
            )
            
            if is_kyc_blocked(kyc_result):
                raise HTTPException(
                    status_code=403,
                    detail=f"User KYC verification required: {kyc_result.missing_requirements}"
                )
        except KYCServiceUnavailable as e:
            logger.error(f"KYC service unavailable: {e}")
            raise HTTPException(status_code=503, detail="KYC verification service unavailable.")
        
        # Compliance check
        try:
            compliance_result = await check_transaction_compliance(
                user_id=user_id,
                user_name=user_name,
                amount=transfer.amount,
                source_currency=transfer.currency,
                destination_currency=transfer.currency,
                destination_country="NG",
                beneficiary_name=transfer.recipient_name,
                beneficiary_country="NG"
            )
            
            if is_compliance_blocked(compliance_result):
                raise HTTPException(
                    status_code=403,
                    detail="Property transfer blocked by compliance screening."
                )
        except ComplianceServiceUnavailable as e:
            logger.error(f"Compliance service unavailable: {e}")
            raise HTTPException(status_code=503, detail="Compliance service unavailable.")
        
        # Create the property transfer transaction
        service = TransactionServiceService()
        transaction_data = {
            "user_id": user_id,
            "transaction_type": "property_disbursement",
            "amount": transfer.amount,
            "currency": transfer.currency,
            "destination_currency": transfer.currency,
            "fee": 0,
            "total_amount": transfer.amount,
            "recipient_name": transfer.recipient_name,
            "recipient_bank": transfer.recipient_bank,
            "recipient_account": transfer.recipient_account,
            "delivery_method": "bank_transfer",
            "note": transfer.note,
            "status": "pending",
            "idempotency_key": idempotency_key,
            "property_transaction_id": transfer.property_transaction_id,
            "disbursement_type": transfer.disbursement_type
        }
        
        result = await service.create(transaction_data)
        transaction_id = result.get("id", str(uuid.uuid4()))
        reference_number = result.get("reference_number", f"PROP{transaction_id[:8].upper()}")
        created_at = result.get("created_at", "")
        
        response_data = {
            "transaction_id": transaction_id,
            "status": "pending",
            "amount": transfer.amount,
            "currency": transfer.currency,
            "fee": 0,
            "total_amount": transfer.amount,
            "recipient_name": transfer.recipient_name,
            "reference_number": reference_number,
            "created_at": created_at
        }
        
        await idempotency_service.store_idempotency(
            idempotency_key=idempotency_key,
            user_id=user_id,
            transaction_id=transaction_id,
            response_data=response_data
        )
        
        # Publish to lakehouse
        await publish_transaction_to_lakehouse(
            transaction_id=transaction_id,
            user_id=user_id,
            event_type="property_disbursement_created",
            transaction_data=transaction_data
        )
        
        logger.info(
            f"Property disbursement created: tx={transaction_id}, "
            f"property_tx={transfer.property_transaction_id}, amount={transfer.amount}"
        )
        
        return TransferResponse(**response_data, is_duplicate=False, message="Property disbursement initiated")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Property transfer failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Property transfer failed: {str(e)}")


# ==================== Legacy Endpoints ====================

@router.post("/", response_model=TransactionServiceModel)
async def create(data: dict):
    service = TransactionServiceService()
    return await service.create(data)


@router.get("/{id}", response_model=TransactionServiceModel)
async def get(id: str):
    service = TransactionServiceService()
    result = await service.get(id)
    if not result:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return result


@router.get("/", response_model=List[TransactionServiceModel])
async def list_all(skip: int = 0, limit: int = 100):
    service = TransactionServiceService()
    return await service.list(skip, limit)


@router.put("/{id}", response_model=TransactionServiceModel)
async def update(id: str, data: dict):
    service = TransactionServiceService()
    return await service.update(id, data)


@router.delete("/{id}")
async def delete(id: str):
    service = TransactionServiceService()
    await service.delete(id)
    return {"message": "Deleted successfully"}


# ==================== Idempotency Management ====================

@router.post("/idempotency/cleanup")
async def cleanup_expired_idempotency(db: Session = Depends(get_db)):
    """Clean up expired idempotency records (call via cron job)."""
    idempotency_service = IdempotencyService(db)
    count = await idempotency_service.cleanup_expired()
    return {"message": f"Cleaned up {count} expired idempotency records"}
