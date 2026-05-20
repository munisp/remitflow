"""
Property Transaction KYC Compliance Integration
Integrates with compliance-service for AML/PEP/Sanctions screening
"""

import os
import httpx
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

COMPLIANCE_SERVICE_URL = os.getenv("COMPLIANCE_SERVICE_URL", "http://compliance-service:8000")
COMPLIANCE_FAIL_OPEN = os.getenv("COMPLIANCE_FAIL_OPEN", "false").lower() == "true"


class ScreeningType(str, Enum):
    SANCTIONS = "sanctions"
    PEP = "pep"
    AML = "aml"
    ADVERSE_MEDIA = "adverse_media"


class ScreeningResult(str, Enum):
    CLEAR = "clear"
    MATCH = "match"
    POTENTIAL_MATCH = "potential_match"
    ERROR = "error"


@dataclass
class PartyScreeningRequest:
    """Request to screen a party for compliance"""
    party_id: str
    first_name: str
    last_name: str
    middle_name: Optional[str]
    date_of_birth: str
    nationality: str
    id_type: str
    id_number: str
    bvn: Optional[str]
    nin: Optional[str]
    address_country: str
    transaction_id: str
    transaction_amount: float
    transaction_currency: str
    screening_types: List[ScreeningType]


@dataclass
class ScreeningResponse:
    """Response from compliance screening"""
    screening_id: str
    party_id: str
    overall_result: ScreeningResult
    sanctions_result: ScreeningResult
    pep_result: ScreeningResult
    aml_result: ScreeningResult
    risk_score: int
    matches: List[Dict[str, Any]]
    requires_review: bool
    screened_at: str
    error_message: Optional[str] = None


class PropertyComplianceClient:
    """Client for compliance service integration"""
    
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        self.base_url = base_url or COMPLIANCE_SERVICE_URL
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"}
            )
        return self._client
    
    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def screen_party(self, request: PartyScreeningRequest) -> ScreeningResponse:
        """Screen a party for sanctions, PEP, and AML"""
        try:
            client = await self._get_client()
            
            payload = {
                "party_id": request.party_id,
                "person": {
                    "first_name": request.first_name,
                    "last_name": request.last_name,
                    "middle_name": request.middle_name,
                    "date_of_birth": request.date_of_birth,
                    "nationality": request.nationality
                },
                "identity": {
                    "id_type": request.id_type,
                    "id_number": request.id_number,
                    "bvn": request.bvn,
                    "nin": request.nin
                },
                "address": {
                    "country": request.address_country
                },
                "transaction": {
                    "id": request.transaction_id,
                    "amount": request.transaction_amount,
                    "currency": request.transaction_currency
                },
                "screening_types": [st.value for st in request.screening_types],
                "context": "property_transaction"
            }
            
            response = await client.post("/api/v1/screening/person", json=payload)
            response.raise_for_status()
            
            data = response.json()
            
            return ScreeningResponse(
                screening_id=data.get("screening_id", ""),
                party_id=request.party_id,
                overall_result=ScreeningResult(data.get("overall_result", "clear")),
                sanctions_result=ScreeningResult(data.get("sanctions_result", "clear")),
                pep_result=ScreeningResult(data.get("pep_result", "clear")),
                aml_result=ScreeningResult(data.get("aml_result", "clear")),
                risk_score=data.get("risk_score", 0),
                matches=data.get("matches", []),
                requires_review=data.get("requires_review", False),
                screened_at=data.get("screened_at", datetime.utcnow().isoformat())
            )
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Compliance screening HTTP error: {e.response.status_code} - {e.response.text}")
            if COMPLIANCE_FAIL_OPEN:
                return self._fail_open_response(request.party_id, f"HTTP error: {e.response.status_code}")
            raise ComplianceServiceError(f"Screening failed: {e.response.status_code}")
            
        except httpx.RequestError as e:
            logger.error(f"Compliance screening request error: {str(e)}")
            if COMPLIANCE_FAIL_OPEN:
                return self._fail_open_response(request.party_id, f"Request error: {str(e)}")
            raise ComplianceServiceError(f"Screening request failed: {str(e)}")
    
    def _fail_open_response(self, party_id: str, error_message: str) -> ScreeningResponse:
        """Return a fail-open response when compliance service is unavailable"""
        logger.warning(f"Compliance fail-open for party {party_id}: {error_message}")
        return ScreeningResponse(
            screening_id=f"fail-open-{datetime.utcnow().timestamp()}",
            party_id=party_id,
            overall_result=ScreeningResult.ERROR,
            sanctions_result=ScreeningResult.ERROR,
            pep_result=ScreeningResult.ERROR,
            aml_result=ScreeningResult.ERROR,
            risk_score=0,
            matches=[],
            requires_review=True,  # Always require manual review on fail-open
            screened_at=datetime.utcnow().isoformat(),
            error_message=error_message
        )
    
    async def create_compliance_case(
        self,
        transaction_id: str,
        party_id: str,
        screening_id: str,
        case_type: str,
        reason: str,
        risk_score: int,
        matches: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Create a compliance case for manual review"""
        try:
            client = await self._get_client()
            
            payload = {
                "case_type": case_type,
                "entity_type": "property_transaction",
                "entity_id": transaction_id,
                "related_party_id": party_id,
                "screening_id": screening_id,
                "reason": reason,
                "risk_score": risk_score,
                "matches": matches,
                "priority": "high" if risk_score > 70 else "medium" if risk_score > 40 else "low",
                "status": "pending_review"
            }
            
            response = await client.post("/api/v1/cases", json=payload)
            response.raise_for_status()
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Failed to create compliance case: {str(e)}")
            if COMPLIANCE_FAIL_OPEN:
                return {
                    "case_id": f"local-case-{datetime.utcnow().timestamp()}",
                    "status": "pending_sync",
                    "error": str(e)
                }
            raise ComplianceServiceError(f"Failed to create case: {str(e)}")
    
    async def get_screening_status(self, screening_id: str) -> Dict[str, Any]:
        """Get the status of a screening"""
        try:
            client = await self._get_client()
            response = await client.get(f"/api/v1/screening/{screening_id}")
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Failed to get screening status: {str(e)}")
            raise ComplianceServiceError(f"Failed to get screening: {str(e)}")


class ComplianceServiceError(Exception):
    """Raised when compliance service operations fail"""
    pass


async def screen_property_transaction_parties(
    compliance_client: PropertyComplianceClient,
    transaction_id: str,
    transaction_amount: float,
    transaction_currency: str,
    buyer: Dict[str, Any],
    seller: Optional[Dict[str, Any]] = None
) -> Dict[str, ScreeningResponse]:
    """Screen all parties in a property transaction"""
    results = {}
    
    # Screen buyer
    buyer_request = PartyScreeningRequest(
        party_id=buyer["id"],
        first_name=buyer["first_name"],
        last_name=buyer["last_name"],
        middle_name=buyer.get("middle_name"),
        date_of_birth=buyer["date_of_birth"],
        nationality=buyer["nationality"],
        id_type=buyer["id_type"],
        id_number=buyer["id_number"],
        bvn=buyer.get("bvn"),
        nin=buyer.get("nin"),
        address_country=buyer.get("country", "NG"),
        transaction_id=transaction_id,
        transaction_amount=transaction_amount,
        transaction_currency=transaction_currency,
        screening_types=[ScreeningType.SANCTIONS, ScreeningType.PEP, ScreeningType.AML]
    )
    
    results["buyer"] = await compliance_client.screen_party(buyer_request)
    
    # Screen seller if provided
    if seller:
        seller_request = PartyScreeningRequest(
            party_id=seller["id"],
            first_name=seller["first_name"],
            last_name=seller["last_name"],
            middle_name=seller.get("middle_name"),
            date_of_birth=seller["date_of_birth"],
            nationality=seller["nationality"],
            id_type=seller["id_type"],
            id_number=seller["id_number"],
            bvn=seller.get("bvn"),
            nin=seller.get("nin"),
            address_country=seller.get("country", "NG"),
            transaction_id=transaction_id,
            transaction_amount=transaction_amount,
            transaction_currency=transaction_currency,
            screening_types=[ScreeningType.SANCTIONS, ScreeningType.PEP, ScreeningType.AML]
        )
        
        results["seller"] = await compliance_client.screen_party(seller_request)
    
    return results


def calculate_property_risk_score(
    transaction_amount: float,
    currency: str,
    source_of_funds: str,
    buyer_screening: Optional[ScreeningResponse],
    seller_screening: Optional[ScreeningResponse],
    bank_statements_verified: bool,
    income_verified: bool,
    purchase_agreement_verified: bool
) -> Dict[str, Any]:
    """Calculate comprehensive risk score for property transaction"""
    score = 0
    flags = []
    
    # High-value transaction risk
    ngn_amount = transaction_amount
    if currency == "USD":
        ngn_amount = transaction_amount * 1500  # Approximate rate
    elif currency == "GBP":
        ngn_amount = transaction_amount * 1900
    elif currency == "EUR":
        ngn_amount = transaction_amount * 1600
    
    if ngn_amount > 500_000_000:  # > 500M NGN
        score += 40
        flags.append("very_high_value_transaction")
    elif ngn_amount > 100_000_000:  # > 100M NGN
        score += 30
        flags.append("high_value_transaction")
    elif ngn_amount > 50_000_000:  # > 50M NGN
        score += 15
        flags.append("elevated_value_transaction")
    
    # Source of funds risk
    high_risk_sources = ["gift", "other", "inheritance"]
    medium_risk_sources = ["loan", "sale_of_property"]
    
    if source_of_funds in high_risk_sources:
        score += 25
        flags.append(f"high_risk_source_{source_of_funds}")
    elif source_of_funds in medium_risk_sources:
        score += 10
        flags.append(f"medium_risk_source_{source_of_funds}")
    
    # Screening results risk
    if buyer_screening:
        if buyer_screening.overall_result == ScreeningResult.MATCH:
            score += 50
            flags.append("buyer_screening_match")
        elif buyer_screening.overall_result == ScreeningResult.POTENTIAL_MATCH:
            score += 25
            flags.append("buyer_screening_potential_match")
        elif buyer_screening.overall_result == ScreeningResult.ERROR:
            score += 15
            flags.append("buyer_screening_error")
        
        if buyer_screening.pep_result == ScreeningResult.MATCH:
            score += 20
            flags.append("buyer_is_pep")
    
    if seller_screening:
        if seller_screening.overall_result == ScreeningResult.MATCH:
            score += 40
            flags.append("seller_screening_match")
        elif seller_screening.overall_result == ScreeningResult.POTENTIAL_MATCH:
            score += 20
            flags.append("seller_screening_potential_match")
    
    # Missing verification risk
    if not bank_statements_verified:
        score += 15
        flags.append("bank_statements_not_verified")
    
    if not income_verified:
        score += 10
        flags.append("income_not_verified")
    
    if not purchase_agreement_verified:
        score += 10
        flags.append("purchase_agreement_not_verified")
    
    # Cap at 100
    score = min(score, 100)
    
    # Determine risk level
    if score >= 70:
        risk_level = "high"
        requires_enhanced_due_diligence = True
    elif score >= 40:
        risk_level = "medium"
        requires_enhanced_due_diligence = False
    else:
        risk_level = "low"
        requires_enhanced_due_diligence = False
    
    return {
        "risk_score": score,
        "risk_level": risk_level,
        "risk_flags": flags,
        "requires_enhanced_due_diligence": requires_enhanced_due_diligence,
        "requires_manual_review": score >= 50 or "screening_match" in str(flags)
    }
