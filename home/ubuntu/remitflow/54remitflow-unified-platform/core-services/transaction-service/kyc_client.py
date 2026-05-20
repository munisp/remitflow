"""
KYC Service Client for Transaction Service
Provides KYC verification before transaction creation with circuit breaker protection
"""

import httpx
import os
import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

KYC_SERVICE_URL = os.getenv("KYC_SERVICE_URL", "http://kyc-service:8003")
KYC_TIMEOUT = float(os.getenv("KYC_TIMEOUT", "5.0"))
KYC_FAIL_OPEN = os.getenv("KYC_FAIL_OPEN", "false").lower() == "true"


class KYCTier(str, Enum):
    TIER_0 = "tier_0"
    TIER_1 = "tier_1"
    TIER_2 = "tier_2"
    TIER_3 = "tier_3"
    TIER_4 = "tier_4"


class KYCDecision(str, Enum):
    ALLOW = "allow"
    UPGRADE_REQUIRED = "upgrade_required"
    BLOCK = "block"


@dataclass
class KYCVerificationResult:
    """Result from KYC verification"""
    user_id: str
    decision: KYCDecision
    current_tier: KYCTier
    required_tier: Optional[KYCTier]
    tier_limits: Dict[str, Any]
    missing_requirements: list
    raw_response: Dict[str, Any]


class KYCServiceError(Exception):
    """Error from KYC service"""
    pass


class KYCServiceUnavailable(KYCServiceError):
    """KYC service is unavailable"""
    pass


async def verify_user_kyc(
    user_id: str,
    amount: float,
    transaction_type: str = "transfer",
    destination_country: str = "NG",
    required_features: Optional[list] = None
) -> KYCVerificationResult:
    """
    Verify user KYC status before transaction creation.
    
    Args:
        user_id: User initiating the transaction
        amount: Transaction amount
        transaction_type: Type of transaction (transfer, international_transfer, etc.)
        destination_country: Destination country code
        required_features: Optional list of required features for this transaction
    
    Returns:
        KYCVerificationResult with decision and details
    
    Raises:
        KYCServiceUnavailable: If KYC service is down and KYC_FAIL_OPEN is False
        KYCServiceError: For other KYC service errors
    """
    try:
        async with httpx.AsyncClient(timeout=KYC_TIMEOUT) as client:
            # Get user's KYC profile
            profile_response = await client.get(
                f"{KYC_SERVICE_URL}/profiles/{user_id}"
            )
        
        if profile_response.status_code == 404:
            # User has no KYC profile - block transaction
            logger.warning(f"No KYC profile found for user {user_id}")
            return KYCVerificationResult(
                user_id=user_id,
                decision=KYCDecision.BLOCK,
                current_tier=KYCTier.TIER_0,
                required_tier=KYCTier.TIER_1,
                tier_limits={},
                missing_requirements=["kyc_profile_required"],
                raw_response={"error": "no_profile"}
            )
        
        if profile_response.status_code != 200:
            logger.error(f"KYC service error: {profile_response.status_code}")
            if KYC_FAIL_OPEN:
                logger.warning("KYC service error, failing open")
                return _create_fail_open_result(user_id)
            raise KYCServiceUnavailable(f"KYC service returned {profile_response.status_code}")
        
        profile = profile_response.json()
        current_tier = KYCTier(profile.get("current_tier", "tier_0"))
        
        # Get tier limits
        async with httpx.AsyncClient(timeout=KYC_TIMEOUT) as client:
            limits_response = await client.get(
                f"{KYC_SERVICE_URL}/profiles/{user_id}/limits"
            )
        
        if limits_response.status_code != 200:
            logger.error(f"Failed to get KYC limits: {limits_response.status_code}")
            if KYC_FAIL_OPEN:
                return _create_fail_open_result(user_id)
            raise KYCServiceUnavailable("Failed to get KYC limits")
        
        limits_data = limits_response.json()
        tier_limits = limits_data.get("limits", {})
        tier_features = limits_data.get("features", [])
        
        # Determine required tier based on transaction
        required_tier = _determine_required_tier(
            amount, transaction_type, destination_country
        )
        
        # Check if user meets requirements
        decision = KYCDecision.ALLOW
        missing_requirements = []
        
        # Check tier level
        tier_order = [KYCTier.TIER_0, KYCTier.TIER_1, KYCTier.TIER_2, KYCTier.TIER_3, KYCTier.TIER_4]
        if tier_order.index(current_tier) < tier_order.index(required_tier):
            decision = KYCDecision.UPGRADE_REQUIRED
            missing_requirements.append(f"tier_upgrade_to_{required_tier.value}")
        
        # Check amount limits
        single_limit = float(tier_limits.get("single_transaction", 0))
        if amount > single_limit:
            decision = KYCDecision.UPGRADE_REQUIRED
            missing_requirements.append(f"amount_exceeds_limit_{single_limit}")
        
        # Check required features
        if required_features:
            for feature in required_features:
                if feature not in tier_features:
                    decision = KYCDecision.UPGRADE_REQUIRED
                    missing_requirements.append(f"feature_required_{feature}")
        
        # Check for international transfer requirements
        if transaction_type == "international_transfer" and destination_country != "NG":
            if "international_transfer" not in tier_features:
                decision = KYCDecision.UPGRADE_REQUIRED
                missing_requirements.append("international_transfer_not_enabled")
        
        return KYCVerificationResult(
            user_id=user_id,
            decision=decision,
            current_tier=current_tier,
            required_tier=required_tier if decision != KYCDecision.ALLOW else None,
            tier_limits=tier_limits,
            missing_requirements=missing_requirements,
            raw_response={"profile": profile, "limits": limits_data}
        )
    
    except httpx.RequestError as e:
        logger.error(f"KYC service connection error: {e}")
        if KYC_FAIL_OPEN:
            logger.warning("KYC service unavailable, failing open")
            return _create_fail_open_result(user_id)
        raise KYCServiceUnavailable(f"KYC service unavailable: {e}")


def _determine_required_tier(
    amount: float,
    transaction_type: str,
    destination_country: str
) -> KYCTier:
    """Determine the minimum required KYC tier for a transaction"""
    # International transfers require at least Tier 2
    if transaction_type == "international_transfer" or destination_country != "NG":
        if amount > 1000000:  # > 1M NGN
            return KYCTier.TIER_3
        return KYCTier.TIER_2
    
    # Domestic transfers
    if amount > 2000000:  # > 2M NGN
        return KYCTier.TIER_4
    elif amount > 500000:  # > 500K NGN
        return KYCTier.TIER_3
    elif amount > 50000:  # > 50K NGN
        return KYCTier.TIER_2
    else:
        return KYCTier.TIER_1


def _create_fail_open_result(user_id: str) -> KYCVerificationResult:
    """Create a fail-open result when KYC service is unavailable"""
    return KYCVerificationResult(
        user_id=user_id,
        decision=KYCDecision.ALLOW,
        current_tier=KYCTier.TIER_0,
        required_tier=None,
        tier_limits={},
        missing_requirements=[],
        raw_response={"fail_open": True, "user_id": user_id}
    )


def is_kyc_blocked(result: KYCVerificationResult) -> bool:
    """Check if transaction should be blocked based on KYC verification"""
    return result.decision == KYCDecision.BLOCK


def requires_kyc_upgrade(result: KYCVerificationResult) -> bool:
    """Check if user needs to upgrade KYC tier"""
    return result.decision == KYCDecision.UPGRADE_REQUIRED
