"""
Compliance Service Client for Transaction Service
Provides AML/sanctions screening before transaction creation with circuit breaker protection
"""

import httpx
import os
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

COMPLIANCE_SERVICE_URL = os.getenv("COMPLIANCE_SERVICE_URL", "http://compliance-service:8004")
COMPLIANCE_TIMEOUT = float(os.getenv("COMPLIANCE_TIMEOUT", "5.0"))
COMPLIANCE_FAIL_OPEN = os.getenv("COMPLIANCE_FAIL_OPEN", "false").lower() == "true"


class ComplianceRiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ComplianceDecision(str, Enum):
    ALLOW = "allow"
    REVIEW = "review"
    BLOCK = "block"


@dataclass
class ScreeningMatch:
    """A match from sanctions/PEP screening"""
    list_name: str
    list_type: str
    matched_name: str
    match_score: float
    match_details: Dict[str, Any]


@dataclass
class ComplianceCheckResult:
    """Result from compliance check"""
    screening_id: str
    decision: ComplianceDecision
    risk_level: ComplianceRiskLevel
    is_clear: bool
    matches: List[ScreeningMatch]
    lists_checked: List[str]
    alerts_generated: List[str]
    raw_response: Dict[str, Any]


class ComplianceServiceError(Exception):
    """Error from compliance service"""
    pass


class ComplianceServiceUnavailable(ComplianceServiceError):
    """Compliance service is unavailable"""
    pass


async def check_transaction_compliance(
    user_id: str,
    user_name: str,
    amount: float,
    source_currency: str,
    destination_currency: str,
    source_country: str = "NG",
    destination_country: str = "NG",
    beneficiary_name: Optional[str] = None,
    beneficiary_country: Optional[str] = None,
    transaction_id: Optional[str] = None
) -> ComplianceCheckResult:
    """
    Check transaction compliance before creation.
    
    Args:
        user_id: User initiating the transaction
        user_name: Full name of the user for screening
        amount: Transaction amount
        source_currency: Source currency code
        destination_currency: Destination currency code
        source_country: Source country code (default: NG)
        destination_country: Destination country code (default: NG)
        beneficiary_name: Optional beneficiary name for screening
        beneficiary_country: Optional beneficiary country
        transaction_id: Optional transaction ID for monitoring
    
    Returns:
        ComplianceCheckResult with decision and details
    
    Raises:
        ComplianceServiceUnavailable: If compliance service is down and COMPLIANCE_FAIL_OPEN is False
        ComplianceServiceError: For other compliance service errors
    """
    try:
        # Step 1: Screen the sender
        sender_screening = await _screen_entity(
            entity_id=user_id,
            full_name=user_name,
            country=source_country,
            entity_type="individual"
        )
        
        # Step 2: Screen the beneficiary if provided
        beneficiary_screening = None
        if beneficiary_name:
            beneficiary_screening = await _screen_entity(
                entity_id=f"beneficiary_{user_id}",
                full_name=beneficiary_name,
                country=beneficiary_country or destination_country,
                entity_type="individual"
            )
        
        # Step 3: Analyze transaction for monitoring rules
        alerts = []
        if transaction_id:
            alerts = await _analyze_transaction(
                transaction_id=transaction_id,
                user_id=user_id,
                amount=amount,
                currency=source_currency,
                source_country=source_country,
                destination_country=destination_country
            )
        
        # Combine results
        all_matches = []
        lists_checked = []
        overall_risk = ComplianceRiskLevel.LOW
        is_clear = True
        
        if sender_screening:
            all_matches.extend(sender_screening.get("matches", []))
            lists_checked.extend(sender_screening.get("lists_checked", []))
            if not sender_screening.get("is_clear", True):
                is_clear = False
            sender_risk = sender_screening.get("overall_risk", "low")
            if _risk_level_value(sender_risk) > _risk_level_value(overall_risk.value):
                overall_risk = ComplianceRiskLevel(sender_risk)
        
        if beneficiary_screening:
            all_matches.extend(beneficiary_screening.get("matches", []))
            lists_checked.extend(beneficiary_screening.get("lists_checked", []))
            if not beneficiary_screening.get("is_clear", True):
                is_clear = False
            beneficiary_risk = beneficiary_screening.get("overall_risk", "low")
            if _risk_level_value(beneficiary_risk) > _risk_level_value(overall_risk.value):
                overall_risk = ComplianceRiskLevel(beneficiary_risk)
        
        # Determine decision
        decision = ComplianceDecision.ALLOW
        if overall_risk == ComplianceRiskLevel.CRITICAL:
            decision = ComplianceDecision.BLOCK
        elif overall_risk == ComplianceRiskLevel.HIGH:
            decision = ComplianceDecision.REVIEW
        elif overall_risk == ComplianceRiskLevel.MEDIUM:
            decision = ComplianceDecision.REVIEW
        elif alerts:
            decision = ComplianceDecision.REVIEW
        
        # Convert matches to dataclass
        screening_matches = [
            ScreeningMatch(
                list_name=m.get("list_name", ""),
                list_type=m.get("list_type", ""),
                matched_name=m.get("matched_name", ""),
                match_score=m.get("match_score", 0.0),
                match_details=m.get("match_details", {})
            )
            for m in all_matches
        ]
        
        return ComplianceCheckResult(
            screening_id=sender_screening.get("id", "") if sender_screening else "",
            decision=decision,
            risk_level=overall_risk,
            is_clear=is_clear,
            matches=screening_matches,
            lists_checked=list(set(lists_checked)),
            alerts_generated=[a.get("id", "") for a in alerts] if alerts else [],
            raw_response={
                "sender_screening": sender_screening,
                "beneficiary_screening": beneficiary_screening,
                "alerts": alerts
            }
        )
    
    except httpx.RequestError as e:
        logger.error(f"Compliance service connection error: {e}")
        if COMPLIANCE_FAIL_OPEN:
            logger.warning("Compliance service unavailable, failing open")
            return _create_fail_open_result(user_id)
        raise ComplianceServiceUnavailable(f"Compliance service unavailable: {e}")


async def _screen_entity(
    entity_id: str,
    full_name: str,
    country: str,
    entity_type: str = "individual"
) -> Dict[str, Any]:
    """Screen an entity against sanctions and PEP lists"""
    request_payload = {
        "entity_id": entity_id,
        "entity_type": entity_type,
        "full_name": full_name,
        "country": country,
        "screening_types": ["sanctions", "pep"]
    }
    
    try:
        async with httpx.AsyncClient(timeout=COMPLIANCE_TIMEOUT) as client:
            response = await client.post(
                f"{COMPLIANCE_SERVICE_URL}/screening/check",
                json=request_payload
            )
        
        if response.status_code == 200:
            return response.json()
        else:
            logger.error(f"Screening error: {response.status_code} - {response.text}")
            if COMPLIANCE_FAIL_OPEN:
                return {"is_clear": True, "matches": [], "lists_checked": [], "overall_risk": "low"}
            raise ComplianceServiceError(f"Screening failed: {response.status_code}")
    
    except httpx.RequestError as e:
        logger.error(f"Screening connection error: {e}")
        if COMPLIANCE_FAIL_OPEN:
            return {"is_clear": True, "matches": [], "lists_checked": [], "overall_risk": "low"}
        raise


async def _analyze_transaction(
    transaction_id: str,
    user_id: str,
    amount: float,
    currency: str,
    source_country: str,
    destination_country: str
) -> List[Dict[str, Any]]:
    """Analyze transaction against monitoring rules"""
    request_payload = {
        "transaction_id": transaction_id,
        "user_id": user_id,
        "amount": amount,
        "currency": currency,
        "source_country": source_country,
        "destination_country": destination_country,
        "transaction_type": "transfer"
    }
    
    try:
        async with httpx.AsyncClient(timeout=COMPLIANCE_TIMEOUT) as client:
            response = await client.post(
                f"{COMPLIANCE_SERVICE_URL}/monitoring/analyze",
                json=request_payload
            )
        
        if response.status_code == 200:
            data = response.json()
            return data.get("alerts", [])
        else:
            logger.warning(f"Transaction analysis error: {response.status_code}")
            return []
    
    except httpx.RequestError as e:
        logger.warning(f"Transaction analysis connection error: {e}")
        return []


def _risk_level_value(risk: str) -> int:
    """Convert risk level to numeric value for comparison"""
    levels = {"low": 0, "medium": 1, "high": 2, "critical": 3}
    return levels.get(risk.lower(), 0)


def _create_fail_open_result(user_id: str) -> ComplianceCheckResult:
    """Create a fail-open result when compliance service is unavailable"""
    return ComplianceCheckResult(
        screening_id="fail-open",
        decision=ComplianceDecision.ALLOW,
        risk_level=ComplianceRiskLevel.LOW,
        is_clear=True,
        matches=[],
        lists_checked=[],
        alerts_generated=[],
        raw_response={"fail_open": True, "user_id": user_id}
    )


def is_compliance_blocked(result: ComplianceCheckResult) -> bool:
    """Check if transaction should be blocked based on compliance check"""
    return result.decision == ComplianceDecision.BLOCK


def requires_compliance_review(result: ComplianceCheckResult) -> bool:
    """Check if transaction requires compliance review"""
    return result.decision == ComplianceDecision.REVIEW
