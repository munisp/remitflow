"""
Sanctions Provider Abstraction Layer
Allows plugging in different sanctions screening providers (World-Check, Dow Jones, etc.)
"""

import os
import logging
import hashlib
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import asyncio
import aiohttp

logger = logging.getLogger(__name__)


class SanctionsListType(str, Enum):
    """Types of sanctions lists"""
    OFAC_SDN = "ofac_sdn"
    OFAC_CONSOLIDATED = "ofac_consolidated"
    UN_CONSOLIDATED = "un_consolidated"
    EU_CONSOLIDATED = "eu_consolidated"
    UK_HMT = "uk_hmt"
    CBN_WATCHLIST = "cbn_watchlist"
    INTERPOL = "interpol"
    PEP = "pep"
    ADVERSE_MEDIA = "adverse_media"


@dataclass
class SanctionsMatch:
    """A match from sanctions screening"""
    list_name: str
    list_type: str
    matched_name: str
    match_score: float
    match_details: Dict[str, Any]
    list_entry_id: Optional[str] = None
    program: Optional[str] = None
    country: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "list_name": self.list_name,
            "list_type": self.list_type,
            "matched_name": self.matched_name,
            "match_score": self.match_score,
            "match_details": self.match_details,
            "list_entry_id": self.list_entry_id,
            "program": self.program,
            "country": self.country
        }


@dataclass
class ScreeningRequest:
    """Request for sanctions screening"""
    entity_id: str
    full_name: str
    entity_type: str = "individual"
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    country: Optional[str] = None
    id_number: Optional[str] = None
    id_type: Optional[str] = None
    address: Optional[str] = None
    screening_types: List[str] = None
    
    def __post_init__(self):
        if self.screening_types is None:
            self.screening_types = ["sanctions", "pep"]


class SanctionsProvider(ABC):
    """Abstract base class for sanctions screening providers"""
    
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Name of the provider"""
        pass
    
    @abstractmethod
    async def screen_entity(self, request: ScreeningRequest) -> List[SanctionsMatch]:
        """
        Screen an entity against sanctions lists
        
        Args:
            request: Screening request with entity details
            
        Returns:
            List of matches found
        """
        pass
    
    @abstractmethod
    async def get_list_version(self, list_type: SanctionsListType) -> str:
        """Get the current version/date of a sanctions list"""
        pass
    
    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the provider is healthy and accessible"""
        pass


class StaticSanctionsProvider(SanctionsProvider):
    """
    Static/local sanctions provider using in-memory lists.
    Used for development, testing, and as a fallback.
    
    WARNING: This should NOT be used in production for real compliance.
    Real production deployments must use an external provider like World-Check or Dow Jones.
    """
    
    def __init__(self):
        self._sanctions_db = {
            SanctionsListType.OFAC_SDN: [
                {"name": "Test Sanctioned Person", "country": "IR", "program": "IRAN", "id": "OFAC-001"},
                {"name": "Another Sanctioned Entity", "country": "KP", "program": "DPRK", "id": "OFAC-002"},
            ],
            SanctionsListType.UN_CONSOLIDATED: [
                {"name": "UN Listed Individual", "country": "SY", "program": "SYRIA", "id": "UN-001"},
            ],
            SanctionsListType.CBN_WATCHLIST: [
                {"name": "CBN Watchlist Person", "country": "NG", "program": "FRAUD", "id": "CBN-001"},
            ],
        }
        
        self._pep_db = [
            {"name": "Sample PEP Person", "country": "NG", "position": "Former Minister", "id": "PEP-001"},
            {"name": "Another PEP", "country": "GH", "position": "Governor", "id": "PEP-002"},
        ]
        
        self._list_versions = {
            list_type: datetime.utcnow().strftime("%Y%m%d")
            for list_type in SanctionsListType
        }
        
        logger.warning("StaticSanctionsProvider initialized - NOT FOR PRODUCTION USE")
    
    @property
    def provider_name(self) -> str:
        return "static"
    
    def _calculate_name_similarity(self, name1: str, name2: str) -> float:
        """Calculate similarity score between two names"""
        name1 = name1.lower().strip()
        name2 = name2.lower().strip()
        
        if name1 == name2:
            return 1.0
        
        # Token-based similarity
        tokens1 = set(name1.split())
        tokens2 = set(name2.split())
        
        if not tokens1 or not tokens2:
            return 0.0
        
        intersection = len(tokens1 & tokens2)
        union = len(tokens1 | tokens2)
        jaccard = intersection / union if union > 0 else 0
        
        # Substring matching
        partial = 0.0
        if name1 in name2 or name2 in name1:
            partial = min(len(name1), len(name2)) / max(len(name1), len(name2))
        
        return max(jaccard, partial)
    
    async def screen_entity(self, request: ScreeningRequest) -> List[SanctionsMatch]:
        """Screen entity against static lists"""
        matches = []
        
        # Check sanctions lists
        if "sanctions" in request.screening_types:
            for list_type, entries in self._sanctions_db.items():
                for entry in entries:
                    score = self._calculate_name_similarity(request.full_name, entry["name"])
                    if score >= 0.7:
                        matches.append(SanctionsMatch(
                            list_name=list_type.value,
                            list_type="sanctions",
                            matched_name=entry["name"],
                            match_score=score,
                            match_details=entry,
                            list_entry_id=entry.get("id"),
                            program=entry.get("program"),
                            country=entry.get("country")
                        ))
        
        # Check PEP list
        if "pep" in request.screening_types:
            for entry in self._pep_db:
                score = self._calculate_name_similarity(request.full_name, entry["name"])
                if score >= 0.7:
                    matches.append(SanctionsMatch(
                        list_name="pep_database",
                        list_type="pep",
                        matched_name=entry["name"],
                        match_score=score,
                        match_details=entry,
                        list_entry_id=entry.get("id"),
                        country=entry.get("country")
                    ))
        
        return matches
    
    async def get_list_version(self, list_type: SanctionsListType) -> str:
        return self._list_versions.get(list_type, "unknown")
    
    async def health_check(self) -> bool:
        return True


class ExternalSanctionsProvider(SanctionsProvider):
    """
    External sanctions provider for production use.
    Connects to real sanctions screening services like World-Check, Dow Jones, etc.
    
    Configuration via environment variables:
    - SANCTIONS_PROVIDER_URL: Base URL of the sanctions API
    - SANCTIONS_PROVIDER_API_KEY: API key for authentication
    - SANCTIONS_PROVIDER_API_SECRET: API secret (if required)
    - SANCTIONS_PROVIDER_TIMEOUT: Request timeout in seconds (default: 30)
    - SANCTIONS_PROVIDER_MAX_RETRIES: Max retry attempts (default: 3)
    """
    
    def __init__(self):
        self.base_url = os.getenv("SANCTIONS_PROVIDER_URL", "https://api.sanctions-provider.example.com")
        self.api_key = os.getenv("SANCTIONS_PROVIDER_API_KEY", "")
        self.api_secret = os.getenv("SANCTIONS_PROVIDER_API_SECRET", "")
        self.timeout = int(os.getenv("SANCTIONS_PROVIDER_TIMEOUT", "30"))
        self.max_retries = int(os.getenv("SANCTIONS_PROVIDER_MAX_RETRIES", "3"))
        
        self._session: Optional[aiohttp.ClientSession] = None
        
        if not self.api_key:
            logger.warning("SANCTIONS_PROVIDER_API_KEY not set - external provider will not work")
    
    @property
    def provider_name(self) -> str:
        return "external"
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create HTTP session"""
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session
    
    def _generate_auth_headers(self) -> Dict[str, str]:
        """Generate authentication headers"""
        timestamp = datetime.utcnow().isoformat()
        
        # Create signature (implementation depends on provider)
        signature_string = f"{self.api_key}:{timestamp}"
        if self.api_secret:
            signature = hashlib.sha256(
                f"{signature_string}:{self.api_secret}".encode()
            ).hexdigest()
        else:
            signature = ""
        
        return {
            "Authorization": f"Bearer {self.api_key}",
            "X-API-Key": self.api_key,
            "X-Timestamp": timestamp,
            "X-Signature": signature,
            "Content-Type": "application/json"
        }
    
    async def screen_entity(self, request: ScreeningRequest) -> List[SanctionsMatch]:
        """Screen entity against external provider"""
        if not self.api_key:
            logger.error("Cannot screen entity: SANCTIONS_PROVIDER_API_KEY not configured")
            return []
        
        session = await self._get_session()
        headers = self._generate_auth_headers()
        
        payload = {
            "entity_id": request.entity_id,
            "full_name": request.full_name,
            "entity_type": request.entity_type,
            "date_of_birth": request.date_of_birth,
            "nationality": request.nationality,
            "country": request.country,
            "id_number": request.id_number,
            "id_type": request.id_type,
            "address": request.address,
            "screening_types": request.screening_types
        }
        
        matches = []
        last_error = None
        
        for attempt in range(self.max_retries):
            try:
                async with session.post(
                    f"{self.base_url}/v1/screen",
                    headers=headers,
                    json=payload
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        for match_data in data.get("matches", []):
                            matches.append(SanctionsMatch(
                                list_name=match_data.get("list_name", "unknown"),
                                list_type=match_data.get("list_type", "unknown"),
                                matched_name=match_data.get("matched_name", ""),
                                match_score=float(match_data.get("match_score", 0)),
                                match_details=match_data.get("details", {}),
                                list_entry_id=match_data.get("entry_id"),
                                program=match_data.get("program"),
                                country=match_data.get("country")
                            ))
                        
                        return matches
                    
                    elif response.status == 401:
                        logger.error("Authentication failed with sanctions provider")
                        return []
                    
                    elif response.status >= 500:
                        last_error = f"Server error: {response.status}"
                    
                    else:
                        error_text = await response.text()
                        logger.error(f"Screening failed: {response.status} - {error_text}")
                        return []
                        
            except aiohttp.ClientError as e:
                last_error = str(e)
            except asyncio.TimeoutError:
                last_error = "Request timeout"
            
            if attempt < self.max_retries - 1:
                wait_time = 2 ** attempt
                logger.warning(f"Retry {attempt + 1}/{self.max_retries} after {wait_time}s: {last_error}")
                await asyncio.sleep(wait_time)
        
        logger.error(f"All retries failed: {last_error}")
        return []
    
    async def get_list_version(self, list_type: SanctionsListType) -> str:
        """Get list version from external provider"""
        if not self.api_key:
            return "unknown"
        
        session = await self._get_session()
        headers = self._generate_auth_headers()
        
        try:
            async with session.get(
                f"{self.base_url}/v1/lists/{list_type.value}/version",
                headers=headers
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    return data.get("version", "unknown")
        except Exception as e:
            logger.error(f"Failed to get list version: {e}")
        
        return "unknown"
    
    async def health_check(self) -> bool:
        """Check if external provider is accessible"""
        if not self.api_key:
            return False
        
        session = await self._get_session()
        headers = self._generate_auth_headers()
        
        try:
            async with session.get(
                f"{self.base_url}/v1/health",
                headers=headers
            ) as response:
                return response.status == 200
        except Exception:
            return False
    
    async def close(self):
        """Close HTTP session"""
        if self._session and not self._session.closed:
            await self._session.close()


def get_sanctions_provider() -> SanctionsProvider:
    """
    Factory function to get the configured sanctions provider.
    
    Set SANCTIONS_PROVIDER environment variable to:
    - "static" (default): Use static/local lists (for development/testing only)
    - "external": Use external provider (for production)
    
    For production deployments, you MUST:
    1. Set SANCTIONS_PROVIDER=external
    2. Configure SANCTIONS_PROVIDER_URL, SANCTIONS_PROVIDER_API_KEY, etc.
    3. Ensure the external provider is a recognized sanctions screening service
    """
    provider_type = os.getenv("SANCTIONS_PROVIDER", "static").lower()
    
    if provider_type == "external":
        logger.info("Using external sanctions provider")
        return ExternalSanctionsProvider()
    else:
        logger.warning("Using static sanctions provider - NOT FOR PRODUCTION")
        return StaticSanctionsProvider()


# Documentation for bank integration
INTEGRATION_DOCUMENTATION = """
# Sanctions Provider Integration Guide

## Overview
The compliance service supports pluggable sanctions screening providers.
For production use with banks, you MUST configure an external provider.

## Supported External Providers
- World-Check (Refinitiv)
- Dow Jones Risk & Compliance
- LexisNexis WorldCompliance
- Accuity (SWIFT)
- ComplyAdvantage

## Configuration

### Environment Variables
```
SANCTIONS_PROVIDER=external
SANCTIONS_PROVIDER_URL=https://api.your-provider.com
SANCTIONS_PROVIDER_API_KEY=your-api-key
SANCTIONS_PROVIDER_API_SECRET=your-api-secret (if required)
SANCTIONS_PROVIDER_TIMEOUT=30
SANCTIONS_PROVIDER_MAX_RETRIES=3
```

### Expected API Contract

The external provider must implement:

1. POST /v1/screen
   Request:
   {
     "entity_id": "string",
     "full_name": "string",
     "entity_type": "individual|organization",
     "date_of_birth": "YYYY-MM-DD",
     "nationality": "string",
     "country": "string",
     "id_number": "string",
     "id_type": "string",
     "address": "string",
     "screening_types": ["sanctions", "pep", "adverse_media"]
   }
   
   Response:
   {
     "matches": [
       {
         "list_name": "ofac_sdn",
         "list_type": "sanctions",
         "matched_name": "string",
         "match_score": 0.95,
         "entry_id": "string",
         "program": "string",
         "country": "string",
         "details": {}
       }
     ]
   }

2. GET /v1/lists/{list_type}/version
   Response:
   {
     "version": "20251211",
     "last_updated": "2025-12-11T00:00:00Z"
   }

3. GET /v1/health
   Response: 200 OK

## Compliance Requirements

For bank-grade compliance:
1. Sanctions lists must be updated at least daily
2. All screening results must be persisted with audit trail
3. Match reviews must be documented with reviewer ID and timestamp
4. SAR filing workflow must be integrated with regulatory reporting
5. Regular reconciliation of list versions with provider
"""
