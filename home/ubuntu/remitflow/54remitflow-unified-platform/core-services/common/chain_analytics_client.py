"""
Chain Analytics Client - Integration with blockchain analytics providers.

Supports:
- Chainalysis (KYT, Reactor)
- TRM Labs
- Elliptic
- Custom/internal analytics

Features:
- Address risk scoring
- Mixer/tumbler detection
- Sanctions screening
- Transaction risk assessment
- Graceful degradation when not configured
"""

import os
import logging
import hashlib
from abc import ABC, abstractmethod
from datetime import datetime
from decimal import Decimal
from typing import Optional, Dict, Any, List
from enum import Enum

import httpx

logger = logging.getLogger(__name__)

# Environment configuration
CHAINALYSIS_API_KEY = os.getenv("CHAINALYSIS_API_KEY", "")
CHAINALYSIS_API_URL = os.getenv("CHAINALYSIS_API_URL", "https://api.chainalysis.com/api/kyt/v2")
TRM_API_KEY = os.getenv("TRM_API_KEY", "")
TRM_API_URL = os.getenv("TRM_API_URL", "https://api.trmlabs.com/public/v2")
ELLIPTIC_API_KEY = os.getenv("ELLIPTIC_API_KEY", "")
ELLIPTIC_API_URL = os.getenv("ELLIPTIC_API_URL", "https://aml-api.elliptic.co/v2")

# Risk thresholds
HIGH_RISK_THRESHOLD = float(os.getenv("CHAIN_ANALYTICS_HIGH_RISK_THRESHOLD", "0.7"))
MEDIUM_RISK_THRESHOLD = float(os.getenv("CHAIN_ANALYTICS_MEDIUM_RISK_THRESHOLD", "0.4"))


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    SEVERE = "severe"
    UNKNOWN = "unknown"
    NOT_CONFIGURED = "not_configured"


class RiskCategory(str, Enum):
    MIXER = "mixer"
    TUMBLER = "tumbler"
    DARKNET = "darknet"
    RANSOMWARE = "ransomware"
    SCAM = "scam"
    SANCTIONS = "sanctions"
    GAMBLING = "gambling"
    EXCHANGE = "exchange"
    DEFI = "defi"
    MINING = "mining"
    P2P = "p2p"
    UNKNOWN = "unknown"
    CLEAN = "clean"


class AddressRiskResult:
    """Result of address risk scoring."""
    
    def __init__(
        self,
        address: str,
        chain: str,
        risk_score: Optional[float] = None,
        risk_level: RiskLevel = RiskLevel.UNKNOWN,
        categories: Optional[List[RiskCategory]] = None,
        provider: str = "none",
        is_sanctioned: bool = False,
        is_mixer: bool = False,
        reason: Optional[str] = None,
        raw_response: Optional[Dict[str, Any]] = None,
    ):
        self.address = address
        self.chain = chain
        self.risk_score = risk_score
        self.risk_level = risk_level
        self.categories = categories or []
        self.provider = provider
        self.is_sanctioned = is_sanctioned
        self.is_mixer = is_mixer
        self.reason = reason
        self.raw_response = raw_response
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "address": self.address,
            "chain": self.chain,
            "risk_score": self.risk_score,
            "risk_level": self.risk_level.value,
            "categories": [c.value for c in self.categories],
            "provider": self.provider,
            "is_sanctioned": self.is_sanctioned,
            "is_mixer": self.is_mixer,
            "reason": self.reason,
        }
    
    def should_block(self) -> bool:
        """Determine if this address should be blocked."""
        return (
            self.is_sanctioned or
            self.risk_level in [RiskLevel.HIGH, RiskLevel.SEVERE] or
            RiskCategory.MIXER in self.categories or
            RiskCategory.RANSOMWARE in self.categories or
            RiskCategory.DARKNET in self.categories
        )
    
    def requires_review(self) -> bool:
        """Determine if this address requires manual review."""
        return (
            self.risk_level == RiskLevel.MEDIUM or
            RiskCategory.GAMBLING in self.categories or
            RiskCategory.P2P in self.categories
        )


class TransactionRiskResult:
    """Result of transaction risk assessment."""
    
    def __init__(
        self,
        tx_hash: Optional[str] = None,
        from_address: str = "",
        to_address: str = "",
        chain: str = "",
        amount: Decimal = Decimal("0"),
        risk_score: Optional[float] = None,
        risk_level: RiskLevel = RiskLevel.UNKNOWN,
        from_risk: Optional[AddressRiskResult] = None,
        to_risk: Optional[AddressRiskResult] = None,
        provider: str = "none",
        alerts: Optional[List[str]] = None,
    ):
        self.tx_hash = tx_hash
        self.from_address = from_address
        self.to_address = to_address
        self.chain = chain
        self.amount = amount
        self.risk_score = risk_score
        self.risk_level = risk_level
        self.from_risk = from_risk
        self.to_risk = to_risk
        self.provider = provider
        self.alerts = alerts or []
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "tx_hash": self.tx_hash,
            "from_address": self.from_address,
            "to_address": self.to_address,
            "chain": self.chain,
            "amount": str(self.amount),
            "risk_score": self.risk_score,
            "risk_level": self.risk_level.value,
            "from_risk": self.from_risk.to_dict() if self.from_risk else None,
            "to_risk": self.to_risk.to_dict() if self.to_risk else None,
            "provider": self.provider,
            "alerts": self.alerts,
        }
    
    def should_block(self) -> bool:
        """Determine if this transaction should be blocked."""
        if self.from_risk and self.from_risk.should_block():
            return True
        if self.to_risk and self.to_risk.should_block():
            return True
        return self.risk_level in [RiskLevel.HIGH, RiskLevel.SEVERE]
    
    def requires_review(self) -> bool:
        """Determine if this transaction requires manual review."""
        if self.from_risk and self.from_risk.requires_review():
            return True
        if self.to_risk and self.to_risk.requires_review():
            return True
        return self.risk_level == RiskLevel.MEDIUM


class ChainAnalyticsProvider(ABC):
    """Abstract base class for chain analytics providers."""
    
    @abstractmethod
    def is_configured(self) -> bool:
        """Check if the provider is properly configured."""
        pass
    
    @abstractmethod
    async def score_address(self, address: str, chain: str) -> AddressRiskResult:
        """Score an address for risk."""
        pass
    
    @abstractmethod
    async def screen_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: Decimal,
        chain: str,
        tx_hash: Optional[str] = None,
    ) -> TransactionRiskResult:
        """Screen a transaction for risk."""
        pass


class NoopAnalyticsProvider(ChainAnalyticsProvider):
    """No-op provider that returns NOT_CONFIGURED status."""
    
    def is_configured(self) -> bool:
        return False
    
    async def score_address(self, address: str, chain: str) -> AddressRiskResult:
        return AddressRiskResult(
            address=address,
            chain=chain,
            risk_level=RiskLevel.NOT_CONFIGURED,
            provider="none",
            reason="No chain analytics provider configured"
        )
    
    async def screen_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: Decimal,
        chain: str,
        tx_hash: Optional[str] = None,
    ) -> TransactionRiskResult:
        return TransactionRiskResult(
            tx_hash=tx_hash,
            from_address=from_address,
            to_address=to_address,
            chain=chain,
            amount=amount,
            risk_level=RiskLevel.NOT_CONFIGURED,
            provider="none",
            alerts=["No chain analytics provider configured - manual review required"]
        )


class ChainalysisProvider(ChainAnalyticsProvider):
    """Chainalysis KYT integration."""
    
    def __init__(self, api_key: str, api_url: str):
        self.api_key = api_key
        self.api_url = api_url
        self._configured = bool(api_key)
    
    def is_configured(self) -> bool:
        return self._configured
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "Token": self.api_key,
            "Content-Type": "application/json",
        }
    
    def _map_chain(self, chain: str) -> str:
        """Map internal chain names to Chainalysis asset names."""
        mapping = {
            "ethereum": "ETH",
            "tron": "TRX",
            "solana": "SOL",
            "polygon": "MATIC",
            "bsc": "BNB",
        }
        return mapping.get(chain.lower(), chain.upper())
    
    def _parse_risk_level(self, score: float) -> RiskLevel:
        if score >= HIGH_RISK_THRESHOLD:
            return RiskLevel.HIGH
        elif score >= MEDIUM_RISK_THRESHOLD:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW
    
    def _parse_categories(self, exposure: Dict[str, Any]) -> List[RiskCategory]:
        """Parse Chainalysis exposure data into risk categories."""
        categories = []
        category_mapping = {
            "mixing": RiskCategory.MIXER,
            "darknet market": RiskCategory.DARKNET,
            "ransomware": RiskCategory.RANSOMWARE,
            "scam": RiskCategory.SCAM,
            "sanctions": RiskCategory.SANCTIONS,
            "gambling": RiskCategory.GAMBLING,
            "exchange": RiskCategory.EXCHANGE,
            "defi": RiskCategory.DEFI,
            "mining": RiskCategory.MINING,
            "p2p exchange": RiskCategory.P2P,
        }
        
        for category_name, risk_category in category_mapping.items():
            if exposure.get(category_name, 0) > 0:
                categories.append(risk_category)
        
        return categories if categories else [RiskCategory.CLEAN]
    
    async def score_address(self, address: str, chain: str) -> AddressRiskResult:
        if not self._configured:
            return AddressRiskResult(
                address=address,
                chain=chain,
                risk_level=RiskLevel.NOT_CONFIGURED,
                provider="chainalysis",
                reason="Chainalysis API key not configured"
            )
        
        try:
            async with httpx.AsyncClient() as client:
                # Register the address first
                register_response = await client.post(
                    f"{self.api_url}/users/{address}/transfers",
                    headers=self._get_headers(),
                    json={
                        "asset": self._map_chain(chain),
                        "transferReference": f"check_{datetime.utcnow().isoformat()}",
                        "direction": "received",
                    },
                    timeout=30.0
                )
                
                # Get risk assessment
                risk_response = await client.get(
                    f"{self.api_url}/users/{address}/summary",
                    headers=self._get_headers(),
                    timeout=30.0
                )
                
                if risk_response.status_code != 200:
                    return AddressRiskResult(
                        address=address,
                        chain=chain,
                        risk_level=RiskLevel.UNKNOWN,
                        provider="chainalysis",
                        reason=f"API error: {risk_response.status_code}"
                    )
                
                data = risk_response.json()
                risk_score = data.get("riskScore", 0) / 10  # Normalize to 0-1
                exposure = data.get("exposure", {})
                
                categories = self._parse_categories(exposure)
                is_sanctioned = "sanctions" in str(exposure).lower()
                is_mixer = RiskCategory.MIXER in categories
                
                return AddressRiskResult(
                    address=address,
                    chain=chain,
                    risk_score=risk_score,
                    risk_level=self._parse_risk_level(risk_score),
                    categories=categories,
                    provider="chainalysis",
                    is_sanctioned=is_sanctioned,
                    is_mixer=is_mixer,
                    raw_response=data
                )
        except Exception as e:
            logger.error(f"Chainalysis API error: {e}")
            return AddressRiskResult(
                address=address,
                chain=chain,
                risk_level=RiskLevel.UNKNOWN,
                provider="chainalysis",
                reason=f"API error: {str(e)}"
            )
    
    async def screen_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: Decimal,
        chain: str,
        tx_hash: Optional[str] = None,
    ) -> TransactionRiskResult:
        # Score both addresses
        from_risk = await self.score_address(from_address, chain)
        to_risk = await self.score_address(to_address, chain)
        
        # Calculate combined risk
        scores = [r.risk_score for r in [from_risk, to_risk] if r.risk_score is not None]
        combined_score = max(scores) if scores else None
        
        alerts = []
        if from_risk.should_block():
            alerts.append(f"Source address flagged: {from_risk.reason or 'high risk'}")
        if to_risk.should_block():
            alerts.append(f"Destination address flagged: {to_risk.reason or 'high risk'}")
        
        risk_level = RiskLevel.UNKNOWN
        if combined_score is not None:
            risk_level = self._parse_risk_level(combined_score)
        
        return TransactionRiskResult(
            tx_hash=tx_hash,
            from_address=from_address,
            to_address=to_address,
            chain=chain,
            amount=amount,
            risk_score=combined_score,
            risk_level=risk_level,
            from_risk=from_risk,
            to_risk=to_risk,
            provider="chainalysis",
            alerts=alerts
        )


class TRMLabsProvider(ChainAnalyticsProvider):
    """TRM Labs integration."""
    
    def __init__(self, api_key: str, api_url: str):
        self.api_key = api_key
        self.api_url = api_url
        self._configured = bool(api_key)
    
    def is_configured(self) -> bool:
        return self._configured
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Basic {self.api_key}",
            "Content-Type": "application/json",
        }
    
    def _map_chain(self, chain: str) -> str:
        """Map internal chain names to TRM chain identifiers."""
        mapping = {
            "ethereum": "ethereum",
            "tron": "tron",
            "solana": "solana",
            "polygon": "polygon",
            "bsc": "binance_smart_chain",
        }
        return mapping.get(chain.lower(), chain.lower())
    
    async def score_address(self, address: str, chain: str) -> AddressRiskResult:
        if not self._configured:
            return AddressRiskResult(
                address=address,
                chain=chain,
                risk_level=RiskLevel.NOT_CONFIGURED,
                provider="trm",
                reason="TRM Labs API key not configured"
            )
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_url}/screening/addresses",
                    headers=self._get_headers(),
                    json=[{
                        "address": address,
                        "chain": self._map_chain(chain),
                    }],
                    timeout=30.0
                )
                
                if response.status_code != 200:
                    return AddressRiskResult(
                        address=address,
                        chain=chain,
                        risk_level=RiskLevel.UNKNOWN,
                        provider="trm",
                        reason=f"API error: {response.status_code}"
                    )
                
                data = response.json()
                if not data or len(data) == 0:
                    return AddressRiskResult(
                        address=address,
                        chain=chain,
                        risk_level=RiskLevel.LOW,
                        categories=[RiskCategory.CLEAN],
                        provider="trm"
                    )
                
                result = data[0]
                risk_indicators = result.get("riskIndicators", [])
                
                # Parse risk indicators
                categories = []
                is_sanctioned = False
                is_mixer = False
                
                for indicator in risk_indicators:
                    category = indicator.get("category", "").lower()
                    if "sanction" in category:
                        is_sanctioned = True
                        categories.append(RiskCategory.SANCTIONS)
                    elif "mixer" in category or "tumbler" in category:
                        is_mixer = True
                        categories.append(RiskCategory.MIXER)
                    elif "darknet" in category:
                        categories.append(RiskCategory.DARKNET)
                    elif "ransomware" in category:
                        categories.append(RiskCategory.RANSOMWARE)
                    elif "scam" in category:
                        categories.append(RiskCategory.SCAM)
                
                risk_score = len(risk_indicators) / 10  # Simple scoring
                risk_level = RiskLevel.HIGH if is_sanctioned or is_mixer else (
                    RiskLevel.MEDIUM if risk_indicators else RiskLevel.LOW
                )
                
                return AddressRiskResult(
                    address=address,
                    chain=chain,
                    risk_score=risk_score,
                    risk_level=risk_level,
                    categories=categories or [RiskCategory.CLEAN],
                    provider="trm",
                    is_sanctioned=is_sanctioned,
                    is_mixer=is_mixer,
                    raw_response=result
                )
        except Exception as e:
            logger.error(f"TRM Labs API error: {e}")
            return AddressRiskResult(
                address=address,
                chain=chain,
                risk_level=RiskLevel.UNKNOWN,
                provider="trm",
                reason=f"API error: {str(e)}"
            )
    
    async def screen_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: Decimal,
        chain: str,
        tx_hash: Optional[str] = None,
    ) -> TransactionRiskResult:
        from_risk = await self.score_address(from_address, chain)
        to_risk = await self.score_address(to_address, chain)
        
        scores = [r.risk_score for r in [from_risk, to_risk] if r.risk_score is not None]
        combined_score = max(scores) if scores else None
        
        alerts = []
        if from_risk.should_block():
            alerts.append("Source address flagged by TRM")
        if to_risk.should_block():
            alerts.append("Destination address flagged by TRM")
        
        risk_level = RiskLevel.UNKNOWN
        if from_risk.is_sanctioned or to_risk.is_sanctioned:
            risk_level = RiskLevel.SEVERE
        elif from_risk.is_mixer or to_risk.is_mixer:
            risk_level = RiskLevel.HIGH
        elif combined_score is not None:
            if combined_score >= HIGH_RISK_THRESHOLD:
                risk_level = RiskLevel.HIGH
            elif combined_score >= MEDIUM_RISK_THRESHOLD:
                risk_level = RiskLevel.MEDIUM
            else:
                risk_level = RiskLevel.LOW
        
        return TransactionRiskResult(
            tx_hash=tx_hash,
            from_address=from_address,
            to_address=to_address,
            chain=chain,
            amount=amount,
            risk_score=combined_score,
            risk_level=risk_level,
            from_risk=from_risk,
            to_risk=to_risk,
            provider="trm",
            alerts=alerts
        )


class EllipticProvider(ChainAnalyticsProvider):
    """Elliptic integration."""
    
    def __init__(self, api_key: str, api_url: str):
        self.api_key = api_key
        self.api_url = api_url
        self._configured = bool(api_key)
    
    def is_configured(self) -> bool:
        return self._configured
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "x-access-token": self.api_key,
            "Content-Type": "application/json",
        }
    
    async def score_address(self, address: str, chain: str) -> AddressRiskResult:
        if not self._configured:
            return AddressRiskResult(
                address=address,
                chain=chain,
                risk_level=RiskLevel.NOT_CONFIGURED,
                provider="elliptic",
                reason="Elliptic API key not configured"
            )
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_url}/wallet/synchronous",
                    headers=self._get_headers(),
                    json={
                        "subject": {
                            "asset": chain.upper(),
                            "type": "address",
                            "hash": address,
                        },
                        "type": "wallet_exposure",
                    },
                    timeout=30.0
                )
                
                if response.status_code != 200:
                    return AddressRiskResult(
                        address=address,
                        chain=chain,
                        risk_level=RiskLevel.UNKNOWN,
                        provider="elliptic",
                        reason=f"API error: {response.status_code}"
                    )
                
                data = response.json()
                risk_score = data.get("risk_score", 0)
                
                # Parse Elliptic risk categories
                categories = []
                contributions = data.get("risk_score_detail", {}).get("contributions", [])
                for contrib in contributions:
                    entity_type = contrib.get("entity_type", "").lower()
                    if "mixer" in entity_type:
                        categories.append(RiskCategory.MIXER)
                    elif "darknet" in entity_type:
                        categories.append(RiskCategory.DARKNET)
                    elif "sanction" in entity_type:
                        categories.append(RiskCategory.SANCTIONS)
                
                is_sanctioned = RiskCategory.SANCTIONS in categories
                is_mixer = RiskCategory.MIXER in categories
                
                if risk_score >= HIGH_RISK_THRESHOLD:
                    risk_level = RiskLevel.HIGH
                elif risk_score >= MEDIUM_RISK_THRESHOLD:
                    risk_level = RiskLevel.MEDIUM
                else:
                    risk_level = RiskLevel.LOW
                
                return AddressRiskResult(
                    address=address,
                    chain=chain,
                    risk_score=risk_score,
                    risk_level=risk_level,
                    categories=categories or [RiskCategory.CLEAN],
                    provider="elliptic",
                    is_sanctioned=is_sanctioned,
                    is_mixer=is_mixer,
                    raw_response=data
                )
        except Exception as e:
            logger.error(f"Elliptic API error: {e}")
            return AddressRiskResult(
                address=address,
                chain=chain,
                risk_level=RiskLevel.UNKNOWN,
                provider="elliptic",
                reason=f"API error: {str(e)}"
            )
    
    async def screen_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: Decimal,
        chain: str,
        tx_hash: Optional[str] = None,
    ) -> TransactionRiskResult:
        from_risk = await self.score_address(from_address, chain)
        to_risk = await self.score_address(to_address, chain)
        
        scores = [r.risk_score for r in [from_risk, to_risk] if r.risk_score is not None]
        combined_score = max(scores) if scores else None
        
        alerts = []
        if from_risk.should_block():
            alerts.append("Source address flagged by Elliptic")
        if to_risk.should_block():
            alerts.append("Destination address flagged by Elliptic")
        
        risk_level = RiskLevel.UNKNOWN
        if combined_score is not None:
            if combined_score >= HIGH_RISK_THRESHOLD:
                risk_level = RiskLevel.HIGH
            elif combined_score >= MEDIUM_RISK_THRESHOLD:
                risk_level = RiskLevel.MEDIUM
            else:
                risk_level = RiskLevel.LOW
        
        return TransactionRiskResult(
            tx_hash=tx_hash,
            from_address=from_address,
            to_address=to_address,
            chain=chain,
            amount=amount,
            risk_score=combined_score,
            risk_level=risk_level,
            from_risk=from_risk,
            to_risk=to_risk,
            provider="elliptic",
            alerts=alerts
        )


class ChainAnalyticsClient:
    """
    Main chain analytics client that manages multiple providers.
    
    Supports fallback between providers and graceful degradation.
    """
    
    def __init__(self):
        self._providers: List[ChainAnalyticsProvider] = []
        self._init_providers()
        
        configured = [p.__class__.__name__ for p in self._providers if p.is_configured()]
        if configured:
            logger.info(f"Chain analytics configured with providers: {configured}")
        else:
            logger.warning("No chain analytics providers configured - using noop provider")
    
    def _init_providers(self):
        """Initialize all available providers."""
        # Add providers in order of preference
        if CHAINALYSIS_API_KEY:
            self._providers.append(
                ChainalysisProvider(CHAINALYSIS_API_KEY, CHAINALYSIS_API_URL)
            )
        
        if TRM_API_KEY:
            self._providers.append(
                TRMLabsProvider(TRM_API_KEY, TRM_API_URL)
            )
        
        if ELLIPTIC_API_KEY:
            self._providers.append(
                EllipticProvider(ELLIPTIC_API_KEY, ELLIPTIC_API_URL)
            )
        
        # Always add noop as fallback
        self._providers.append(NoopAnalyticsProvider())
    
    def _get_active_provider(self) -> ChainAnalyticsProvider:
        """Get the first configured provider."""
        for provider in self._providers:
            if provider.is_configured():
                return provider
        return self._providers[-1]  # Return noop provider
    
    def is_configured(self) -> bool:
        """Check if any real provider is configured."""
        return any(p.is_configured() for p in self._providers[:-1])  # Exclude noop
    
    def get_status(self) -> Dict[str, Any]:
        """Get status of all providers."""
        return {
            "configured": self.is_configured(),
            "active_provider": self._get_active_provider().__class__.__name__,
            "providers": {
                p.__class__.__name__: p.is_configured()
                for p in self._providers
            }
        }
    
    async def score_address(self, address: str, chain: str) -> AddressRiskResult:
        """
        Score an address for risk.
        
        Uses the first configured provider. If no provider is configured,
        returns NOT_CONFIGURED status.
        """
        provider = self._get_active_provider()
        result = await provider.score_address(address, chain)
        
        # Log for audit
        logger.info(
            f"Address risk scored: {address} on {chain} - "
            f"level={result.risk_level.value}, provider={result.provider}"
        )
        
        return result
    
    async def screen_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: Decimal,
        chain: str,
        tx_hash: Optional[str] = None,
    ) -> TransactionRiskResult:
        """
        Screen a transaction for risk.
        
        Checks both source and destination addresses.
        """
        provider = self._get_active_provider()
        result = await provider.screen_transaction(
            from_address, to_address, amount, chain, tx_hash
        )
        
        # Log for audit
        logger.info(
            f"Transaction screened: {from_address} -> {to_address} ({amount} on {chain}) - "
            f"level={result.risk_level.value}, provider={result.provider}, "
            f"alerts={len(result.alerts)}"
        )
        
        return result
    
    async def batch_score_addresses(
        self, addresses: List[Dict[str, str]]
    ) -> List[AddressRiskResult]:
        """
        Score multiple addresses in batch.
        
        Args:
            addresses: List of {"address": str, "chain": str} dicts
        """
        results = []
        for addr_info in addresses:
            result = await self.score_address(
                addr_info["address"],
                addr_info["chain"]
            )
            results.append(result)
        return results
    
    async def check_sanctions(self, address: str, chain: str) -> bool:
        """
        Quick check if an address is sanctioned.
        
        Returns True if sanctioned, False otherwise.
        """
        result = await self.score_address(address, chain)
        return result.is_sanctioned
    
    async def check_mixer(self, address: str, chain: str) -> bool:
        """
        Quick check if an address is associated with a mixer.
        
        Returns True if mixer-associated, False otherwise.
        """
        result = await self.score_address(address, chain)
        return result.is_mixer


# Global instance
chain_analytics_client = ChainAnalyticsClient()
