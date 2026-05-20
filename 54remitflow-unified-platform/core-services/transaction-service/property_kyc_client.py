"""
Property KYC Client for Transaction Service
Verifies property transaction KYC status before disbursing property payments
"""

import os
import httpx
import logging
from typing import Optional
from enum import Enum
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Property KYC service URL
PROPERTY_KYC_SERVICE_URL = os.getenv(
    "PROPERTY_KYC_SERVICE_URL",
    "http://localhost:8090"
)

# Timeout for property KYC service calls
PROPERTY_KYC_TIMEOUT = float(os.getenv("PROPERTY_KYC_TIMEOUT", "10.0"))


class PropertyTransactionStatus(str, Enum):
    """Property transaction status enum"""
    PENDING = "pending"
    DOCUMENTS_SUBMITTED = "documents_submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PropertyKYCResult(BaseModel):
    """Result of property KYC verification"""
    property_transaction_id: str
    status: PropertyTransactionStatus
    is_approved: bool
    buyer_kyc_verified: bool
    seller_kyc_verified: bool
    property_verified: bool
    compliance_cleared: bool
    escrow_funded: bool
    can_disburse: bool
    rejection_reason: Optional[str] = None
    missing_requirements: list = []


class PropertyKYCServiceUnavailable(Exception):
    """Raised when property KYC service is unavailable"""
    pass


async def verify_property_transaction_kyc(
    property_transaction_id: str,
    amount: float,
    disbursement_type: str = "full"
) -> PropertyKYCResult:
    """
    Verify property transaction KYC status before disbursement.
    
    Args:
        property_transaction_id: The property transaction ID to verify
        amount: The disbursement amount
        disbursement_type: Type of disbursement (full, partial, escrow_release)
    
    Returns:
        PropertyKYCResult with verification status
    
    Raises:
        PropertyKYCServiceUnavailable: If service is unavailable
    """
    try:
        async with httpx.AsyncClient(timeout=PROPERTY_KYC_TIMEOUT) as client:
            response = await client.get(
                f"{PROPERTY_KYC_SERVICE_URL}/api/v2/property-transactions/{property_transaction_id}/verification-status",
                params={
                    "amount": amount,
                    "disbursement_type": disbursement_type
                }
            )
            
            if response.status_code == 404:
                logger.warning(f"Property transaction not found: {property_transaction_id}")
                return PropertyKYCResult(
                    property_transaction_id=property_transaction_id,
                    status=PropertyTransactionStatus.PENDING,
                    is_approved=False,
                    buyer_kyc_verified=False,
                    seller_kyc_verified=False,
                    property_verified=False,
                    compliance_cleared=False,
                    escrow_funded=False,
                    can_disburse=False,
                    missing_requirements=["Property transaction not found"]
                )
            
            response.raise_for_status()
            data = response.json()
            
            status = PropertyTransactionStatus(data.get("status", "pending"))
            is_approved = status == PropertyTransactionStatus.APPROVED
            
            return PropertyKYCResult(
                property_transaction_id=property_transaction_id,
                status=status,
                is_approved=is_approved,
                buyer_kyc_verified=data.get("buyer_kyc_verified", False),
                seller_kyc_verified=data.get("seller_kyc_verified", False),
                property_verified=data.get("property_verified", False),
                compliance_cleared=data.get("compliance_cleared", False),
                escrow_funded=data.get("escrow_funded", False),
                can_disburse=data.get("can_disburse", False),
                rejection_reason=data.get("rejection_reason"),
                missing_requirements=data.get("missing_requirements", [])
            )
            
    except httpx.TimeoutException:
        logger.error(f"Property KYC service timeout for transaction: {property_transaction_id}")
        raise PropertyKYCServiceUnavailable("Property KYC service timeout")
    except httpx.HTTPStatusError as e:
        logger.error(f"Property KYC service error: {e}")
        raise PropertyKYCServiceUnavailable(f"Property KYC service error: {e.response.status_code}")
    except Exception as e:
        logger.error(f"Property KYC service unavailable: {e}")
        raise PropertyKYCServiceUnavailable(str(e))


def is_property_kyc_approved(result: PropertyKYCResult) -> bool:
    """Check if property KYC is approved for disbursement"""
    return result.is_approved and result.can_disburse


def get_property_kyc_blocking_reason(result: PropertyKYCResult) -> str:
    """Get the reason why property KYC is blocking disbursement"""
    if result.rejection_reason:
        return result.rejection_reason
    
    if result.missing_requirements:
        return f"Missing requirements: {', '.join(result.missing_requirements)}"
    
    if not result.buyer_kyc_verified:
        return "Buyer KYC not verified"
    
    if not result.seller_kyc_verified:
        return "Seller KYC not verified"
    
    if not result.property_verified:
        return "Property not verified"
    
    if not result.compliance_cleared:
        return "Compliance not cleared"
    
    if not result.escrow_funded:
        return "Escrow not funded"
    
    if result.status != PropertyTransactionStatus.APPROVED:
        return f"Property transaction status is {result.status.value}, not approved"
    
    return "Unknown blocking reason"
