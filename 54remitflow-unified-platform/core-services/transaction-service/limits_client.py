"""
Limits Service Client for Transaction Service
Provides limit checking before transaction creation with circuit breaker protection
"""

import httpx
import os
import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum
from decimal import Decimal

logger = logging.getLogger(__name__)

LIMITS_SERVICE_URL = os.getenv("LIMITS_SERVICE_URL", "http://limits-service:8013")
LIMITS_TIMEOUT = float(os.getenv("LIMITS_TIMEOUT", "5.0"))
LIMITS_FAIL_OPEN = os.getenv("LIMITS_FAIL_OPEN", "false").lower() == "true"


class UserTier(str, Enum):
    TIER_0 = "tier_0"
    TIER_1 = "tier_1"
    TIER_2 = "tier_2"
    TIER_3 = "tier_3"
    TIER_4 = "tier_4"
    BUSINESS = "business"


class Corridor(str, Enum):
    DOMESTIC = "domestic"
    MOJALOOP = "mojaloop"
    PAPSS = "papss"
    UPI = "upi"
    PIX = "pix"
    NIBSS = "nibss"
    SWIFT = "swift"


@dataclass
class LimitCheckResult:
    """Result from limit check"""
    allowed: bool
    limit_type: Optional[str]
    limit_scope: Optional[str]
    limit_name: Optional[str]
    current_usage: Decimal
    limit_amount: Decimal
    remaining: Decimal
    message: str
    raw_response: Dict[str, Any]


class LimitsServiceError(Exception):
    """Error from limits service"""
    pass


class LimitsServiceUnavailable(LimitsServiceError):
    """Limits service is unavailable"""
    pass


async def check_transaction_limits(
    user_id: str,
    user_tier: UserTier,
    corridor: Corridor,
    amount: float,
    currency: str = "NGN"
) -> LimitCheckResult:
    """
    Check if transaction is within limits.
    
    Args:
        user_id: User initiating the transaction
        user_tier: User's KYC tier level
        corridor: Payment corridor being used
        amount: Transaction amount
        currency: Currency code (default: NGN)
    
    Returns:
        LimitCheckResult with allowed status and details
    
    Raises:
        LimitsServiceUnavailable: If limits service is down and LIMITS_FAIL_OPEN is False
        LimitsServiceError: For other limits service errors
    """
    request_payload = {
        "user_id": user_id,
        "user_tier": user_tier.value if isinstance(user_tier, UserTier) else user_tier,
        "corridor": corridor.value if isinstance(corridor, Corridor) else corridor,
        "amount": str(amount),
        "currency": currency
    }
    
    try:
        async with httpx.AsyncClient(timeout=LIMITS_TIMEOUT) as client:
            response = await client.post(
                f"{LIMITS_SERVICE_URL}/check",
                json=request_payload
            )
        
        if response.status_code == 200:
            data = response.json()
            return LimitCheckResult(
                allowed=data.get("allowed", False),
                limit_type=data.get("limit_type"),
                limit_scope=data.get("limit_scope"),
                limit_name=data.get("limit_name"),
                current_usage=Decimal(str(data.get("current_usage", 0))),
                limit_amount=Decimal(str(data.get("limit_amount", 0))),
                remaining=Decimal(str(data.get("remaining", 0))),
                message=data.get("message", ""),
                raw_response=data
            )
        elif response.status_code == 400:
            raise LimitsServiceError(f"Invalid limits request: {response.text}")
        else:
            logger.error(f"Limits service error: {response.status_code} - {response.text}")
            if LIMITS_FAIL_OPEN:
                logger.warning("Limits service error, failing open (allowing transaction)")
                return _create_fail_open_result()
            raise LimitsServiceUnavailable(f"Limits service returned {response.status_code}")
    
    except httpx.RequestError as e:
        logger.error(f"Limits service connection error: {e}")
        if LIMITS_FAIL_OPEN:
            logger.warning("Limits service unavailable, failing open (allowing transaction)")
            return _create_fail_open_result()
        raise LimitsServiceUnavailable(f"Limits service unavailable: {e}")


async def record_transaction_usage(
    user_id: str,
    amount: float
) -> bool:
    """
    Record transaction usage after successful transaction.
    
    Args:
        user_id: User who made the transaction
        amount: Transaction amount
    
    Returns:
        True if recorded successfully, False otherwise
    """
    try:
        async with httpx.AsyncClient(timeout=LIMITS_TIMEOUT) as client:
            response = await client.post(
                f"{LIMITS_SERVICE_URL}/record-usage",
                params={"user_id": user_id, "amount": str(amount)}
            )
        
        if response.status_code == 200:
            return True
        else:
            logger.warning(f"Failed to record usage: {response.status_code}")
            return False
    
    except httpx.RequestError as e:
        logger.warning(f"Failed to record usage: {e}")
        return False


def _create_fail_open_result() -> LimitCheckResult:
    """Create a fail-open result when limits service is unavailable"""
    return LimitCheckResult(
        allowed=True,
        limit_type=None,
        limit_scope=None,
        limit_name=None,
        current_usage=Decimal("0"),
        limit_amount=Decimal("0"),
        remaining=Decimal("0"),
        message="Limits service unavailable - manual review recommended",
        raw_response={"fail_open": True}
    )


def determine_corridor(source_currency: str, destination_currency: str) -> Corridor:
    """
    Determine the payment corridor based on currencies.
    
    This is a simplified mapping - in production this would be more sophisticated.
    """
    if source_currency == destination_currency == "NGN":
        return Corridor.DOMESTIC
    elif destination_currency == "INR":
        return Corridor.UPI
    elif destination_currency == "BRL":
        return Corridor.PIX
    elif source_currency == "NGN" and destination_currency in ["GHS", "KES", "ZAR", "XOF"]:
        return Corridor.PAPSS
    elif source_currency == "NGN":
        return Corridor.MOJALOOP
    else:
        return Corridor.SWIFT


def determine_user_tier(kyc_level: Optional[str]) -> UserTier:
    """
    Map KYC level to user tier.
    """
    tier_mapping = {
        "basic": UserTier.TIER_1,
        "standard": UserTier.TIER_2,
        "enhanced": UserTier.TIER_3,
        "premium": UserTier.TIER_4,
        "business": UserTier.BUSINESS
    }
    return tier_mapping.get(kyc_level, UserTier.TIER_1)
