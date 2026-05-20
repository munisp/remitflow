"""
Airtime Providers - Integration with multiple airtime/data providers
"""

import httpx
import logging
from typing import Dict, Optional, List
from datetime import datetime
from decimal import Decimal
from enum import Enum
import asyncio

logger = logging.getLogger(__name__)


class ProviderStatus(str, Enum):
    """Provider status"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    MAINTENANCE = "maintenance"


class ProviderType(str, Enum):
    """Provider types"""
    VTPASS = "vtpass"
    BAXI = "baxi"
    SHAGO = "shago"
    CLUBKONNECT = "clubkonnect"
    INTERNAL = "internal"


class AirtimeProvider:
    """Base airtime provider class"""
    
    def __init__(self, api_key: str, api_secret: Optional[str] = None):
        self.api_key = api_key
        self.api_secret = api_secret
        self.client = httpx.AsyncClient(timeout=30)
        self.status = ProviderStatus.ACTIVE
        self.success_count = 0
        self.failure_count = 0
    
    async def purchase_airtime(
        self,
        phone_number: str,
        network: str,
        amount: Decimal,
        reference: str
    ) -> Dict:
        """Purchase airtime - to be implemented by subclasses"""
        raise NotImplementedError
    
    async def purchase_data(
        self,
        phone_number: str,
        network: str,
        bundle_id: str,
        reference: str
    ) -> Dict:
        """Purchase data bundle - to be implemented by subclasses"""
        raise NotImplementedError
    
    async def verify_transaction(self, reference: str) -> Dict:
        """Verify transaction status"""
        raise NotImplementedError
    
    async def get_balance(self) -> Decimal:
        """Get provider balance"""
        raise NotImplementedError
    
    def record_success(self):
        """Record successful transaction"""
        self.success_count += 1
    
    def record_failure(self):
        """Record failed transaction"""
        self.failure_count += 1
    
    def get_success_rate(self) -> float:
        """Calculate success rate"""
        total = self.success_count + self.failure_count
        if total == 0:
            return 100.0
        return (self.success_count / total) * 100
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


class VTPassProvider(AirtimeProvider):
    """VTPass provider integration"""
    
    def __init__(self, api_key: str, api_secret: str):
        super().__init__(api_key, api_secret)
        self.base_url = "https://api.vtpass.com/api"
        logger.info("VTPass provider initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get API headers"""
        return {
            "api-key": self.api_key,
            "secret-key": self.api_secret,
            "Content-Type": "application/json"
        }
    
    async def purchase_airtime(
        self,
        phone_number: str,
        network: str,
        amount: Decimal,
        reference: str
    ) -> Dict:
        """Purchase airtime via VTPass"""
        
        # Map network codes
        network_map = {
            "mtn": "mtn",
            "airtel": "airtel",
            "glo": "glo",
            "9mobile": "etisalat"
        }
        
        service_id = network_map.get(network.lower())
        if not service_id:
            raise ValueError(f"Unsupported network: {network}")
        
        payload = {
            "request_id": reference,
            "serviceID": service_id,
            "amount": int(amount),
            "phone": phone_number
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/pay",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get("code") == "000":
                self.record_success()
                return {
                    "success": True,
                    "provider_reference": data.get("requestId"),
                    "transaction_id": data.get("transactionId"),
                    "message": "Airtime purchase successful"
                }
            else:
                self.record_failure()
                return {
                    "success": False,
                    "error": data.get("response_description", "Purchase failed")
                }
        
        except Exception as e:
            self.record_failure()
            logger.error(f"VTPass airtime error: {e}")
            return {"success": False, "error": str(e)}
    
    async def purchase_data(
        self,
        phone_number: str,
        network: str,
        bundle_id: str,
        reference: str
    ) -> Dict:
        """Purchase data bundle via VTPass"""
        
        payload = {
            "request_id": reference,
            "serviceID": bundle_id,
            "billersCode": phone_number,
            "variation_code": bundle_id,
            "phone": phone_number
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/pay",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get("code") == "000":
                self.record_success()
                return {
                    "success": True,
                    "provider_reference": data.get("requestId"),
                    "transaction_id": data.get("transactionId"),
                    "message": "Data purchase successful"
                }
            else:
                self.record_failure()
                return {
                    "success": False,
                    "error": data.get("response_description", "Purchase failed")
                }
        
        except Exception as e:
            self.record_failure()
            logger.error(f"VTPass data error: {e}")
            return {"success": False, "error": str(e)}
    
    async def verify_transaction(self, reference: str) -> Dict:
        """Verify transaction status"""
        
        try:
            response = await self.client.post(
                f"{self.base_url}/requery",
                json={"request_id": reference},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "reference": reference,
                "status": data.get("content", {}).get("transactions", {}).get("status"),
                "amount": data.get("content", {}).get("transactions", {}).get("amount")
            }
        
        except Exception as e:
            logger.error(f"VTPass verify error: {e}")
            return {"reference": reference, "status": "unknown", "error": str(e)}
    
    async def get_balance(self) -> Decimal:
        """Get VTPass wallet balance"""
        
        try:
            response = await self.client.get(
                f"{self.base_url}/balance",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            balance = Decimal(str(data.get("contents", {}).get("balance", "0")))
            return balance
        
        except Exception as e:
            logger.error(f"VTPass balance error: {e}")
            return Decimal("0")


class BaxiProvider(AirtimeProvider):
    """Baxi provider integration"""
    
    def __init__(self, api_key: str, api_secret: str):
        super().__init__(api_key, api_secret)
        self.base_url = "https://api.baxipay.com.ng"
        logger.info("Baxi provider initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get API headers"""
        return {
            "x-api-key": self.api_key,
            "Content-Type": "application/json"
        }
    
    async def purchase_airtime(
        self,
        phone_number: str,
        network: str,
        amount: Decimal,
        reference: str
    ) -> Dict:
        """Purchase airtime via Baxi"""
        
        service_type_map = {
            "mtn": "mtn_airtime",
            "airtel": "airtel_airtime",
            "glo": "glo_airtime",
            "9mobile": "etisalat_airtime"
        }
        
        service_type = service_type_map.get(network.lower())
        if not service_type:
            raise ValueError(f"Unsupported network: {network}")
        
        payload = {
            "service_type": service_type,
            "agentId": self.api_key,
            "agentReference": reference,
            "phone": phone_number,
            "amount": int(amount)
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/services/airtime/request",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") == "success":
                self.record_success()
                return {
                    "success": True,
                    "provider_reference": data.get("data", {}).get("baxiReference"),
                    "transaction_id": data.get("data", {}).get("transactionReference"),
                    "message": "Airtime purchase successful"
                }
            else:
                self.record_failure()
                return {
                    "success": False,
                    "error": data.get("message", "Purchase failed")
                }
        
        except Exception as e:
            self.record_failure()
            logger.error(f"Baxi airtime error: {e}")
            return {"success": False, "error": str(e)}
    
    async def purchase_data(
        self,
        phone_number: str,
        network: str,
        bundle_id: str,
        reference: str
    ) -> Dict:
        """Purchase data bundle via Baxi"""
        
        payload = {
            "service_type": bundle_id,
            "agentId": self.api_key,
            "agentReference": reference,
            "phone": phone_number,
            "datacode": bundle_id
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/services/databundle/request",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") == "success":
                self.record_success()
                return {
                    "success": True,
                    "provider_reference": data.get("data", {}).get("baxiReference"),
                    "transaction_id": data.get("data", {}).get("transactionReference"),
                    "message": "Data purchase successful"
                }
            else:
                self.record_failure()
                return {
                    "success": False,
                    "error": data.get("message", "Purchase failed")
                }
        
        except Exception as e:
            self.record_failure()
            logger.error(f"Baxi data error: {e}")
            return {"success": False, "error": str(e)}
    
    async def verify_transaction(self, reference: str) -> Dict:
        """Verify transaction status"""
        
        try:
            response = await self.client.get(
                f"{self.base_url}/services/transaction/verify/{reference}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "reference": reference,
                "status": data.get("data", {}).get("transactionStatus"),
                "amount": data.get("data", {}).get("amount")
            }
        
        except Exception as e:
            logger.error(f"Baxi verify error: {e}")
            return {"reference": reference, "status": "unknown", "error": str(e)}
    
    async def get_balance(self) -> Decimal:
        """Get Baxi wallet balance"""
        
        try:
            response = await self.client.get(
                f"{self.base_url}/services/balance",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            balance = Decimal(str(data.get("data", {}).get("balance", "0")))
            return balance
        
        except Exception as e:
            logger.error(f"Baxi balance error: {e}")
            return Decimal("0")


class ProviderManager:
    """Manages multiple airtime providers with failover"""
    
    def __init__(self):
        self.providers: Dict[ProviderType, AirtimeProvider] = {}
        self.primary_provider: Optional[ProviderType] = None
        logger.info("Provider manager initialized")
    
    def add_provider(
        self,
        provider_type: ProviderType,
        provider: AirtimeProvider,
        is_primary: bool = False
    ):
        """Add provider"""
        self.providers[provider_type] = provider
        if is_primary or not self.primary_provider:
            self.primary_provider = provider_type
        logger.info(f"Provider added: {provider_type}")
    
    async def purchase_airtime(
        self,
        phone_number: str,
        network: str,
        amount: Decimal,
        reference: str
    ) -> Dict:
        """Purchase airtime with failover"""
        
        # Try primary provider first
        if self.primary_provider and self.primary_provider in self.providers:
            provider = self.providers[self.primary_provider]
            result = await provider.purchase_airtime(phone_number, network, amount, reference)
            if result.get("success"):
                return result
            logger.warning("Primary provider failed, trying fallback")
        
        # Try other providers
        for provider_type, provider in self.providers.items():
            if provider_type == self.primary_provider:
                continue
            
            result = await provider.purchase_airtime(phone_number, network, amount, reference)
            if result.get("success"):
                logger.info(f"Fallback provider succeeded: {provider_type}")
                return result
        
        return {"success": False, "error": "All providers failed"}
    
    async def purchase_data(
        self,
        phone_number: str,
        network: str,
        bundle_id: str,
        reference: str
    ) -> Dict:
        """Purchase data with failover"""
        
        # Try primary provider first
        if self.primary_provider and self.primary_provider in self.providers:
            provider = self.providers[self.primary_provider]
            result = await provider.purchase_data(phone_number, network, bundle_id, reference)
            if result.get("success"):
                return result
            logger.warning("Primary provider failed, trying fallback")
        
        # Try other providers
        for provider_type, provider in self.providers.items():
            if provider_type == self.primary_provider:
                continue
            
            result = await provider.purchase_data(phone_number, network, bundle_id, reference)
            if result.get("success"):
                logger.info(f"Fallback provider succeeded: {provider_type}")
                return result
        
        return {"success": False, "error": "All providers failed"}
    
    async def get_provider_stats(self) -> Dict:
        """Get statistics for all providers"""
        
        stats = {}
        for provider_type, provider in self.providers.items():
            stats[provider_type.value] = {
                "status": provider.status.value,
                "success_count": provider.success_count,
                "failure_count": provider.failure_count,
                "success_rate": provider.get_success_rate()
            }
        
        return stats
    
    async def get_all_balances(self) -> Dict:
        """Get balances from all providers"""
        
        balances = {}
        for provider_type, provider in self.providers.items():
            try:
                balance = await provider.get_balance()
                balances[provider_type.value] = float(balance)
            except Exception as e:
                logger.error(f"Balance fetch error for {provider_type}: {e}")
                balances[provider_type.value] = 0.0
        
        return balances
