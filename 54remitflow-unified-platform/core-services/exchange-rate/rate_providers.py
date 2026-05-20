"""
Exchange Rate Providers - Multi-source rate aggregation
Integrates with CBN, Wise, XE, Bloomberg APIs
"""

import httpx
import logging
from typing import Dict, Optional, List
from decimal import Decimal
from datetime import datetime
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class RateProvider(ABC):
    """Abstract base class for rate providers"""
    
    @abstractmethod
    async def get_rate(self, from_currency: str, to_currency: str) -> Optional[Decimal]:
        """Get exchange rate from provider"""
        pass
    
    @abstractmethod
    def get_name(self) -> str:
        """Get provider name"""
        pass
    
    @abstractmethod
    def get_weight(self) -> float:
        """Get provider weight for aggregation (0.0-1.0)"""
        pass


class CentralBankProvider(RateProvider):
    """Central Bank of Nigeria (CBN) rate provider"""
    
    def __init__(self):
        self.base_url = "https://api.cbn.gov.ng/rates"
        self.weight = 0.4  # 40% weight
    
    async def get_rate(self, from_currency: str, to_currency: str) -> Optional[Decimal]:
        """Get rate from CBN API"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/latest",
                    params={"from": from_currency, "to": to_currency}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    rate = Decimal(str(data.get("rate", 0)))
                    logger.info(f"CBN rate {from_currency}/{to_currency}: {rate}")
                    return rate
                else:
                    logger.warning(f"CBN API returned {response.status_code}")
                    return None
        except Exception as e:
            logger.error(f"CBN API error: {e}")
            return None
    
    def get_name(self) -> str:
        return "Central Bank of Nigeria"
    
    def get_weight(self) -> float:
        return self.weight


class WiseProvider(RateProvider):
    """Wise (TransferWise) rate provider"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.base_url = "https://api.wise.com/v1"
        self.api_key = api_key or "demo_key"
        self.weight = 0.3  # 30% weight
    
    async def get_rate(self, from_currency: str, to_currency: str) -> Optional[Decimal]:
        """Get rate from Wise API"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/rates",
                    params={"source": from_currency, "target": to_currency},
                    headers={"Authorization": f"Bearer {self.api_key}"}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    rate = Decimal(str(data[0].get("rate", 0)))
                    logger.info(f"Wise rate {from_currency}/{to_currency}: {rate}")
                    return rate
                else:
                    logger.warning(f"Wise API returned {response.status_code}")
                    return None
        except Exception as e:
            logger.error(f"Wise API error: {e}")
            return None
    
    def get_name(self) -> str:
        return "Wise"
    
    def get_weight(self) -> float:
        return self.weight


class XEProvider(RateProvider):
    """XE.com rate provider"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.base_url = "https://xecdapi.xe.com/v1"
        self.api_key = api_key or "demo_key"
        self.weight = 0.2  # 20% weight
    
    async def get_rate(self, from_currency: str, to_currency: str) -> Optional[Decimal]:
        """Get rate from XE API"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/convert_from",
                    params={"from": from_currency, "to": to_currency, "amount": 1},
                    auth=(self.api_key, "")
                )
                
                if response.status_code == 200:
                    data = response.json()
                    rate = Decimal(str(data.get("to", [{}])[0].get("mid", 0)))
                    logger.info(f"XE rate {from_currency}/{to_currency}: {rate}")
                    return rate
                else:
                    logger.warning(f"XE API returned {response.status_code}")
                    return None
        except Exception as e:
            logger.error(f"XE API error: {e}")
            return None
    
    def get_name(self) -> str:
        return "XE.com"
    
    def get_weight(self) -> float:
        return self.weight


class BloombergProvider(RateProvider):
    """Bloomberg rate provider"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.base_url = "https://api.bloomberg.com/fx"
        self.api_key = api_key or "demo_key"
        self.weight = 0.1  # 10% weight
    
    async def get_rate(self, from_currency: str, to_currency: str) -> Optional[Decimal]:
        """Get rate from Bloomberg API"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/rates",
                    params={"base": from_currency, "quote": to_currency},
                    headers={"X-API-Key": self.api_key}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    rate = Decimal(str(data.get("rate", 0)))
                    logger.info(f"Bloomberg rate {from_currency}/{to_currency}: {rate}")
                    return rate
                else:
                    logger.warning(f"Bloomberg API returned {response.status_code}")
                    return None
        except Exception as e:
            logger.error(f"Bloomberg API error: {e}")
            return None
    
    def get_name(self) -> str:
        return "Bloomberg"
    
    def get_weight(self) -> float:
        return self.weight


class RateAggregator:
    """Aggregates rates from multiple providers using weighted average"""
    
    def __init__(self):
        self.providers: List[RateProvider] = [
            CentralBankProvider(),
            WiseProvider(),
            XEProvider(),
            BloombergProvider()
        ]
    
    async def get_aggregated_rate(
        self,
        from_currency: str,
        to_currency: str
    ) -> Optional[Dict]:
        """Get weighted average rate from all providers"""
        
        rates = []
        weights = []
        provider_rates = {}
        
        # Fetch rates from all providers concurrently
        for provider in self.providers:
            rate = await provider.get_rate(from_currency, to_currency)
            if rate and rate > 0:
                rates.append(rate)
                weights.append(provider.get_weight())
                provider_rates[provider.get_name()] = float(rate)
        
        if not rates:
            logger.warning(f"No rates available for {from_currency}/{to_currency}")
            return None
        
        # Calculate weighted average
        total_weight = sum(weights)
        if total_weight == 0:
            return None
        
        weighted_rate = sum(r * w for r, w in zip(rates, weights)) / total_weight
        
        # Calculate confidence based on number of providers
        confidence = len(rates) / len(self.providers)
        
        return {
            "rate": weighted_rate,
            "confidence": confidence,
            "provider_count": len(rates),
            "provider_rates": provider_rates,
            "timestamp": datetime.utcnow()
        }
    
    async def get_best_rate(
        self,
        from_currency: str,
        to_currency: str,
        prefer_lowest: bool = True
    ) -> Optional[Dict]:
        """Get best rate from all providers"""
        
        rates = []
        
        for provider in self.providers:
            rate = await provider.get_rate(from_currency, to_currency)
            if rate and rate > 0:
                rates.append({
                    "rate": rate,
                    "provider": provider.get_name(),
                    "weight": provider.get_weight()
                })
        
        if not rates:
            return None
        
        # Sort by rate
        rates.sort(key=lambda x: x["rate"], reverse=not prefer_lowest)
        
        best = rates[0]
        return {
            "rate": best["rate"],
            "provider": best["provider"],
            "all_rates": rates,
            "timestamp": datetime.utcnow()
        }
