"""
KYC Provider Interfaces
Pluggable providers for BVN verification, liveness checks, and document verification
"""

import os
import httpx
import logging
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from dataclasses import dataclass
from datetime import date
from enum import Enum

logger = logging.getLogger(__name__)

# Environment configuration
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
KYC_PROVIDER = os.getenv("KYC_PROVIDER", "nibss")  # nibss, smile_id, onfido, mock (dev only)


class ProviderType(str, Enum):
    MOCK = "mock"
    NIBSS = "nibss"
    SMILE_ID = "smile_id"
    ONFIDO = "onfido"
    PAYSTACK = "paystack"


@dataclass
class BVNVerificationResult:
    """Result from BVN verification"""
    bvn: str
    first_name: Optional[str]
    last_name: Optional[str]
    middle_name: Optional[str]
    date_of_birth: Optional[date]
    phone: Optional[str]
    is_valid: bool
    match_score: float
    provider: str
    provider_reference: Optional[str]
    raw_response: Optional[Dict[str, Any]]


@dataclass
class LivenessCheckResult:
    """Result from liveness check"""
    is_live: bool
    confidence_score: float
    face_match_score: float
    checks_passed: list
    checks_failed: list
    provider: str
    provider_reference: Optional[str]
    raw_response: Optional[Dict[str, Any]]


@dataclass
class DocumentVerificationResult:
    """Result from document verification"""
    is_valid: bool
    document_type: str
    extracted_data: Dict[str, Any]
    confidence_score: float
    issues: list
    provider: str
    provider_reference: Optional[str]
    raw_response: Optional[Dict[str, Any]]


class BVNProvider(ABC):
    """Abstract base class for BVN verification providers"""
    
    @abstractmethod
    async def verify_bvn(
        self,
        bvn: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        date_of_birth: Optional[date] = None
    ) -> BVNVerificationResult:
        """Verify a BVN and optionally match against provided details"""
        pass


class LivenessProvider(ABC):
    """Abstract base class for liveness check providers"""
    
    @abstractmethod
    async def check_liveness(
        self,
        selfie_url: str,
        video_url: Optional[str] = None,
        reference_image_url: Optional[str] = None
    ) -> LivenessCheckResult:
        """Perform liveness check on selfie/video"""
        pass


class DocumentVerificationProvider(ABC):
    """Abstract base class for document verification providers"""
    
    @abstractmethod
    async def verify_document(
        self,
        document_url: str,
        document_type: str,
        country: str = "NG"
    ) -> DocumentVerificationResult:
        """Verify a document and extract data"""
        pass


# Mock Providers (for development/testing)
class MockBVNProvider(BVNProvider):
    """Mock BVN provider for development"""
    
    async def verify_bvn(
        self,
        bvn: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        date_of_birth: Optional[date] = None
    ) -> BVNVerificationResult:
        logger.info(f"[MOCK] Verifying BVN: {bvn[:4]}****{bvn[-3:]}")
        
        # Simulate validation
        is_valid = len(bvn) == 11 and bvn.isdigit()
        match_score = 0.95 if is_valid else 0.0
        
        return BVNVerificationResult(
            bvn=bvn,
            first_name=first_name or "John",
            last_name=last_name or "Doe",
            middle_name=None,
            date_of_birth=date_of_birth,
            phone="+234800000000",
            is_valid=is_valid,
            match_score=match_score,
            provider="mock",
            provider_reference=f"MOCK-{bvn[:8]}",
            raw_response={"mock": True}
        )


class MockLivenessProvider(LivenessProvider):
    """Mock liveness provider for development"""
    
    async def check_liveness(
        self,
        selfie_url: str,
        video_url: Optional[str] = None,
        reference_image_url: Optional[str] = None
    ) -> LivenessCheckResult:
        logger.info(f"[MOCK] Checking liveness for selfie: {selfie_url[:50]}...")
        
        return LivenessCheckResult(
            is_live=True,
            confidence_score=0.92,
            face_match_score=0.88 if reference_image_url else 0.0,
            checks_passed=["blink_detection", "head_movement", "face_match"],
            checks_failed=[],
            provider="mock",
            provider_reference="MOCK-LIVENESS-001",
            raw_response={"mock": True}
        )


class MockDocumentVerificationProvider(DocumentVerificationProvider):
    """Mock document verification provider for development"""
    
    async def verify_document(
        self,
        document_url: str,
        document_type: str,
        country: str = "NG"
    ) -> DocumentVerificationResult:
        logger.info(f"[MOCK] Verifying document: {document_type} from {country}")
        
        extracted_data = {
            "document_number": "A12345678",
            "full_name": "John Doe",
            "date_of_birth": "1990-01-01",
            "expiry_date": "2030-01-01"
        }
        
        return DocumentVerificationResult(
            is_valid=True,
            document_type=document_type,
            extracted_data=extracted_data,
            confidence_score=0.95,
            issues=[],
            provider="mock",
            provider_reference="MOCK-DOC-001",
            raw_response={"mock": True}
        )


# NIBSS BVN Provider (Nigeria)
class NIBSSBVNProvider(BVNProvider):
    """NIBSS BVN verification provider for Nigeria"""
    
    def __init__(self):
        self.base_url = os.getenv("NIBSS_API_URL", "https://api.nibss-plc.com.ng")
        self.api_key = os.getenv("NIBSS_API_KEY")
        self.secret_key = os.getenv("NIBSS_SECRET_KEY")
        self.sandbox = os.getenv("NIBSS_SANDBOX", "true").lower() == "true"
        
        if not self.api_key or not self.secret_key:
            logger.warning("NIBSS credentials not configured. Set NIBSS_API_KEY and NIBSS_SECRET_KEY")
    
    async def verify_bvn(
        self,
        bvn: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        date_of_birth: Optional[date] = None
    ) -> BVNVerificationResult:
        if not self.api_key or not self.secret_key:
            raise ValueError("NIBSS credentials not configured")
        
        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "bvn": bvn,
                "firstName": first_name,
                "lastName": last_name,
                "dateOfBirth": date_of_birth.isoformat() if date_of_birth else None
            }
            
            try:
                response = await client.post(
                    f"{self.base_url}/bvn/verify",
                    json=payload,
                    headers=headers,
                    timeout=30.0
                )
                response.raise_for_status()
                data = response.json()
                
                return BVNVerificationResult(
                    bvn=bvn,
                    first_name=data.get("firstName"),
                    last_name=data.get("lastName"),
                    middle_name=data.get("middleName"),
                    date_of_birth=date.fromisoformat(data["dateOfBirth"]) if data.get("dateOfBirth") else None,
                    phone=data.get("phoneNumber"),
                    is_valid=data.get("isValid", False),
                    match_score=data.get("matchScore", 0.0),
                    provider="nibss",
                    provider_reference=data.get("referenceId"),
                    raw_response=data
                )
            except httpx.HTTPError as e:
                logger.error(f"NIBSS BVN verification failed: {e}")
                raise


# Smile ID Provider (Africa-wide)
class SmileIDProvider(LivenessProvider, DocumentVerificationProvider):
    """Smile ID provider for liveness and document verification"""
    
    def __init__(self):
        self.base_url = os.getenv("SMILE_ID_API_URL", "https://api.smileidentity.com/v1")
        self.partner_id = os.getenv("SMILE_ID_PARTNER_ID")
        self.api_key = os.getenv("SMILE_ID_API_KEY")
        self.sandbox = os.getenv("SMILE_ID_SANDBOX", "true").lower() == "true"
        
        if not self.partner_id or not self.api_key:
            logger.warning("Smile ID credentials not configured. Set SMILE_ID_PARTNER_ID and SMILE_ID_API_KEY")
    
    async def check_liveness(
        self,
        selfie_url: str,
        video_url: Optional[str] = None,
        reference_image_url: Optional[str] = None
    ) -> LivenessCheckResult:
        if not self.partner_id or not self.api_key:
            raise ValueError("Smile ID credentials not configured")
        
        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "partner_id": self.partner_id,
                "selfie_image": selfie_url,
                "liveness_video": video_url,
                "id_image": reference_image_url,
                "job_type": 6  # Biometric KYC
            }
            
            try:
                response = await client.post(
                    f"{self.base_url}/id_verification",
                    json=payload,
                    headers=headers,
                    timeout=60.0
                )
                response.raise_for_status()
                data = response.json()
                
                actions = data.get("Actions", {})
                return LivenessCheckResult(
                    is_live=actions.get("Liveness_Check") == "Passed",
                    confidence_score=data.get("ConfidenceValue", 0.0) / 100,
                    face_match_score=actions.get("Selfie_To_ID_Card_Compare", 0.0) / 100 if reference_image_url else 0.0,
                    checks_passed=[k for k, v in actions.items() if v == "Passed"],
                    checks_failed=[k for k, v in actions.items() if v == "Failed"],
                    provider="smile_id",
                    provider_reference=data.get("SmileJobID"),
                    raw_response=data
                )
            except httpx.HTTPError as e:
                logger.error(f"Smile ID liveness check failed: {e}")
                raise
    
    async def verify_document(
        self,
        document_url: str,
        document_type: str,
        country: str = "NG"
    ) -> DocumentVerificationResult:
        if not self.partner_id or not self.api_key:
            raise ValueError("Smile ID credentials not configured")
        
        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            # Map document types to Smile ID types
            smile_doc_types = {
                "national_id": "NATIONAL_ID",
                "passport": "PASSPORT",
                "drivers_license": "DRIVERS_LICENSE",
                "voters_card": "VOTER_ID"
            }
            
            payload = {
                "partner_id": self.partner_id,
                "id_type": smile_doc_types.get(document_type, "NATIONAL_ID"),
                "country": country,
                "id_image": document_url,
                "job_type": 1  # Document Verification
            }
            
            try:
                response = await client.post(
                    f"{self.base_url}/id_verification",
                    json=payload,
                    headers=headers,
                    timeout=60.0
                )
                response.raise_for_status()
                data = response.json()
                
                return DocumentVerificationResult(
                    is_valid=data.get("ResultCode") == "1012",
                    document_type=document_type,
                    extracted_data=data.get("FullData", {}),
                    confidence_score=data.get("ConfidenceValue", 0.0) / 100,
                    issues=data.get("Issues", []),
                    provider="smile_id",
                    provider_reference=data.get("SmileJobID"),
                    raw_response=data
                )
            except httpx.HTTPError as e:
                logger.error(f"Smile ID document verification failed: {e}")
                raise


# Provider Factory
def get_bvn_provider() -> BVNProvider:
    """Get configured BVN provider"""
    provider = os.getenv("BVN_PROVIDER", KYC_PROVIDER)
    
    if provider == "nibss":
        return NIBSSBVNProvider()
    elif provider == "mock" and ENVIRONMENT in ("development", "test"):
        return MockBVNProvider()
    elif provider == "mock":
        logger.error("Mock BVN provider not allowed outside development/test")
        raise RuntimeError("Mock BVN provider not allowed in production. Set BVN_PROVIDER to nibss.")
    else:
        logger.warning(f"Unknown BVN provider: {provider}, falling back to nibss")
        return NIBSSBVNProvider()


class OpenSourceLivenessAdapter(LivenessProvider):
    """Adapter wrapping OpenSourceLivenessProvider to match LivenessProvider interface"""

    async def check_liveness(
        self,
        selfie_url: str,
        video_url: Optional[str] = None,
        reference_image_url: Optional[str] = None
    ) -> LivenessCheckResult:
        from liveness_detection import get_opensource_liveness_provider
        provider = get_opensource_liveness_provider()
        result = await provider.check_liveness(selfie_url, video_url, reference_image_url)
        return LivenessCheckResult(
            is_live=result.is_live,
            confidence_score=result.confidence_score,
            face_match_score=result.face_match_score,
            checks_passed=result.checks_passed,
            checks_failed=result.checks_failed,
            provider=result.provider,
            provider_reference=result.provider_reference,
            raw_response=result.raw_response,
        )


def get_liveness_provider() -> LivenessProvider:
    """Get configured liveness provider"""
    provider = os.getenv("LIVENESS_PROVIDER", "opensource")

    if provider == "opensource":
        return OpenSourceLivenessAdapter()
    elif provider == "smile_id":
        return SmileIDProvider()
    elif provider == "mock" and ENVIRONMENT in ("development", "test"):
        return MockLivenessProvider()
    elif provider == "mock":
        logger.error("Mock liveness provider not allowed outside development/test")
        raise RuntimeError("Mock liveness provider not allowed in production. Set LIVENESS_PROVIDER to opensource or smile_id.")
    else:
        logger.warning(f"Unknown liveness provider: {provider}, falling back to opensource")
        return OpenSourceLivenessAdapter()


class OpenSourceDocumentAdapter(DocumentVerificationProvider):
    """Adapter wrapping OpenSourceDocumentProvider to match DocumentVerificationProvider interface"""

    async def verify_document(
        self,
        document_url: str,
        document_type: str,
        country: str = "NG"
    ) -> DocumentVerificationResult:
        from document_verification import get_opensource_document_provider
        provider = get_opensource_document_provider()
        result = await provider.verify_document(document_url, document_type, country)
        return DocumentVerificationResult(
            is_valid=result.is_valid,
            document_type=result.document_type,
            extracted_data=result.extracted_data,
            confidence_score=result.confidence_score,
            issues=result.issues,
            provider=result.provider,
            provider_reference=result.provider_reference,
            raw_response=result.raw_response,
        )


def get_document_provider() -> DocumentVerificationProvider:
    """Get configured document verification provider"""
    provider = os.getenv("DOCUMENT_PROVIDER", "opensource")

    if provider == "opensource":
        return OpenSourceDocumentAdapter()
    elif provider == "smile_id":
        return SmileIDProvider()
    elif provider == "mock" and ENVIRONMENT in ("development", "test"):
        return MockDocumentVerificationProvider()
    elif provider == "mock":
        logger.error("Mock document provider not allowed outside development/test")
        raise RuntimeError("Mock document provider not allowed in production. Set DOCUMENT_PROVIDER to opensource or smile_id.")
    else:
        logger.warning(f"Unknown document provider: {provider}, falling back to opensource")
        return OpenSourceDocumentAdapter()
