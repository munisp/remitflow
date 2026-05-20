"""
Risk Service Client for Transaction Service
Provides risk assessment before transaction creation with circuit breaker protection
"""

import httpx
import os
import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

RISK_SERVICE_URL = os.getenv("RISK_SERVICE_URL", "http://risk-service:8010")
RISK_TIMEOUT = float(os.getenv("RISK_TIMEOUT", "5.0"))
RISK_FAIL_OPEN = os.getenv("RISK_FAIL_OPEN", "false").lower() == "true"


class RiskDecision(str, Enum):
    ALLOW = "allow"
    REVIEW = "review"
    BLOCK = "block"


@dataclass
class RiskAssessmentResult:
    """Result from risk assessment"""
    request_id: str
    decision: RiskDecision
    risk_score: int
    factors: list
    requires_verification: bool
    recommended_actions: list
    raw_response: Dict[str, Any]


class RiskServiceError(Exception):
    """Error from risk service"""
    pass


class RiskServiceUnavailable(RiskServiceError):
    """Risk service is unavailable"""
    pass


async def assess_transaction_risk(
    user_id: str,
    amount: float,
    source_currency: str,
    destination_currency: str,
    source_country: str = "NG",
    destination_country: str = "NG",
    beneficiary_id: Optional[str] = None,
    is_new_beneficiary: bool = False,
    device_info: Optional[Dict[str, Any]] = None
) -> RiskAssessmentResult:
    """
    Assess transaction risk before creation.
    
    Args:
        user_id: User initiating the transaction
        amount: Transaction amount
        source_currency: Source currency code
        destination_currency: Destination currency code
        source_country: Source country code (default: NG)
        destination_country: Destination country code (default: NG)
        beneficiary_id: Optional beneficiary ID
        is_new_beneficiary: Whether this is a new beneficiary
        device_info: Optional device fingerprint info
    
    Returns:
        RiskAssessmentResult with decision and details
    
    Raises:
        RiskServiceUnavailable: If risk service is down and RISK_FAIL_OPEN is False
        RiskServiceError: For other risk service errors
    """
    request_payload = {
        "user_id": user_id,
        "transaction_type": "transfer",
        "amount": amount,
        "source_currency": source_currency,
        "destination_currency": destination_currency,
        "source_country": source_country,
        "destination_country": destination_country,
        "beneficiary_id": beneficiary_id,
        "is_new_beneficiary": is_new_beneficiary,
    }
    
    if device_info:
        request_payload["device_info"] = device_info
    
    try:
        async with httpx.AsyncClient(timeout=RISK_TIMEOUT) as client:
            response = await client.post(
                f"{RISK_SERVICE_URL}/assess",
                json=request_payload
            )
        
        if response.status_code == 200:
            data = response.json()
            return RiskAssessmentResult(
                request_id=data.get("request_id", ""),
                decision=RiskDecision(data.get("decision", "allow")),
                risk_score=data.get("risk_score", 0),
                factors=data.get("factors", []),
                requires_verification=data.get("requires_additional_verification", False),
                recommended_actions=data.get("recommended_actions", []),
                raw_response=data
            )
        elif response.status_code == 400:
            raise RiskServiceError(f"Invalid risk request: {response.text}")
        else:
            logger.error(f"Risk service error: {response.status_code} - {response.text}")
            if RISK_FAIL_OPEN:
                logger.warning("Risk service error, failing open (allowing transaction)")
                return _create_fail_open_result(user_id)
            raise RiskServiceUnavailable(f"Risk service returned {response.status_code}")
    
    except httpx.RequestError as e:
        logger.error(f"Risk service connection error: {e}")
        if RISK_FAIL_OPEN:
            logger.warning("Risk service unavailable, failing open (allowing transaction)")
            return _create_fail_open_result(user_id)
        raise RiskServiceUnavailable(f"Risk service unavailable: {e}")


def _create_fail_open_result(user_id: str) -> RiskAssessmentResult:
    """Create a fail-open result when risk service is unavailable"""
    return RiskAssessmentResult(
        request_id="fail-open",
        decision=RiskDecision.ALLOW,
        risk_score=0,
        factors=[],
        requires_verification=False,
        recommended_actions=["Risk service was unavailable - manual review recommended"],
        raw_response={"fail_open": True, "user_id": user_id}
    )


def is_transaction_blocked(result: RiskAssessmentResult) -> bool:
    """Check if transaction should be blocked based on risk assessment"""
    return result.decision == RiskDecision.BLOCK


def requires_manual_review(result: RiskAssessmentResult) -> bool:
    """Check if transaction requires manual review"""
    return result.decision == RiskDecision.REVIEW
