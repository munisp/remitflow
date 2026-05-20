"""
Virtual Account Providers - Integration with banks and fintech providers
"""

import httpx
import logging
from typing import Dict, Optional, List
from datetime import datetime
from decimal import Decimal
from enum import Enum
import asyncio

logger = logging.getLogger(__name__)


class ProviderType(str, Enum):
    """Provider types"""
    WEMA = "wema"
    PROVIDUS = "providus"
    STERLING = "sterling"
    PAYSTACK = "paystack"
    FLUTTERWAVE = "flutterwave"


class AccountProvider:
    """Base virtual account provider class"""
    
    def __init__(self, api_key: str, api_secret: Optional[str] = None):
        self.api_key = api_key
        self.api_secret = api_secret
        self.client = httpx.AsyncClient(timeout=30)
        self.accounts_created = 0
        self.accounts_failed = 0
    
    async def create_account(
        self,
        user_id: str,
        account_name: str,
        bvn: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None
    ) -> Dict:
        """Create virtual account - to be implemented by subclasses"""
        raise NotImplementedError
    
    async def get_account_balance(self, account_number: str) -> Decimal:
        """Get account balance"""
        raise NotImplementedError
    
    async def get_account_transactions(
        self,
        account_number: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[Dict]:
        """Get account transactions"""
        raise NotImplementedError
    
    async def freeze_account(self, account_number: str) -> bool:
        """Freeze/suspend account"""
        raise NotImplementedError
    
    async def unfreeze_account(self, account_number: str) -> bool:
        """Unfreeze/reactivate account"""
        raise NotImplementedError
    
    def record_success(self):
        """Record successful account creation"""
        self.accounts_created += 1
    
    def record_failure(self):
        """Record failed account creation"""
        self.accounts_failed += 1
    
    def get_success_rate(self) -> float:
        """Calculate success rate"""
        total = self.accounts_created + self.accounts_failed
        if total == 0:
            return 100.0
        return (self.accounts_created / total) * 100
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


class WemaProvider(AccountProvider):
    """Wema Bank virtual account provider"""
    
    def __init__(self, api_key: str, api_secret: str):
        super().__init__(api_key, api_secret)
        self.base_url = "https://api.wemabank.com"
        logger.info("Wema provider initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get API headers"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    async def create_account(
        self,
        user_id: str,
        account_name: str,
        bvn: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None
    ) -> Dict:
        """Create Wema virtual account"""
        
        payload = {
            "customerId": user_id,
            "accountName": account_name,
            "bvn": bvn,
            "email": email,
            "phoneNumber": phone
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/v1/accounts/virtual",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") == "success":
                self.record_success()
                return {
                    "success": True,
                    "account_number": data["data"]["accountNumber"],
                    "account_name": data["data"]["accountName"],
                    "bank_name": "Wema Bank",
                    "bank_code": "035"
                }
            else:
                self.record_failure()
                return {
                    "success": False,
                    "error": data.get("message", "Account creation failed")
                }
        
        except Exception as e:
            self.record_failure()
            logger.error(f"Wema account creation error: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_account_balance(self, account_number: str) -> Decimal:
        """Get Wema account balance"""
        
        try:
            response = await self.client.get(
                f"{self.base_url}/v1/accounts/{account_number}/balance",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            balance = Decimal(str(data.get("data", {}).get("balance", "0")))
            return balance
        
        except Exception as e:
            logger.error(f"Wema balance error: {e}")
            return Decimal("0")
    
    async def get_account_transactions(
        self,
        account_number: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[Dict]:
        """Get Wema account transactions"""
        
        params = {"accountNumber": account_number}
        if start_date:
            params["startDate"] = start_date.isoformat()
        if end_date:
            params["endDate"] = end_date.isoformat()
        
        try:
            response = await self.client.get(
                f"{self.base_url}/v1/accounts/transactions",
                params=params,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            transactions = []
            for txn in data.get("data", []):
                transactions.append({
                    "reference": txn.get("reference"),
                    "amount": Decimal(str(txn.get("amount", "0"))),
                    "type": txn.get("type"),
                    "narration": txn.get("narration"),
                    "date": txn.get("transactionDate")
                })
            
            return transactions
        
        except Exception as e:
            logger.error(f"Wema transactions error: {e}")
            return []
    
    async def freeze_account(self, account_number: str) -> bool:
        """Freeze Wema account"""
        
        try:
            response = await self.client.post(
                f"{self.base_url}/v1/accounts/{account_number}/freeze",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return data.get("status") == "success"
        
        except Exception as e:
            logger.error(f"Wema freeze error: {e}")
            return False
    
    async def unfreeze_account(self, account_number: str) -> bool:
        """Unfreeze Wema account"""
        
        try:
            response = await self.client.post(
                f"{self.base_url}/v1/accounts/{account_number}/unfreeze",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return data.get("status") == "success"
        
        except Exception as e:
            logger.error(f"Wema unfreeze error: {e}")
            return False


class ProvidusProvider(AccountProvider):
    """Providus Bank virtual account provider"""
    
    def __init__(self, api_key: str, api_secret: str):
        super().__init__(api_key, api_secret)
        self.base_url = "https://api.providusbank.com"
        logger.info("Providus provider initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get API headers"""
        return {
            "Client-Id": self.api_key,
            "X-Auth-Signature": self.api_secret,
            "Content-Type": "application/json"
        }
    
    async def create_account(
        self,
        user_id: str,
        account_name: str,
        bvn: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None
    ) -> Dict:
        """Create Providus virtual account"""
        
        payload = {
            "account_name": account_name,
            "bvn": bvn
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/PiPCreateDynamicAccountNumber",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get("responseCode") == "00":
                self.record_success()
                return {
                    "success": True,
                    "account_number": data["account_number"],
                    "account_name": data["account_name"],
                    "bank_name": "Providus Bank",
                    "bank_code": "101"
                }
            else:
                self.record_failure()
                return {
                    "success": False,
                    "error": data.get("responseMessage", "Account creation failed")
                }
        
        except Exception as e:
            self.record_failure()
            logger.error(f"Providus account creation error: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_account_balance(self, account_number: str) -> Decimal:
        """Get Providus account balance"""
        
        try:
            response = await self.client.post(
                f"{self.base_url}/PiPBalanceEnquiry",
                json={"account_number": account_number},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            balance = Decimal(str(data.get("available_balance", "0")))
            return balance
        
        except Exception as e:
            logger.error(f"Providus balance error: {e}")
            return Decimal("0")
    
    async def get_account_transactions(
        self,
        account_number: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[Dict]:
        """Get Providus account transactions"""
        
        payload = {"account_number": account_number}
        
        try:
            response = await self.client.post(
                f"{self.base_url}/PiPTransactionHistory",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            transactions = []
            for txn in data.get("transactions", []):
                transactions.append({
                    "reference": txn.get("sessionId"),
                    "amount": Decimal(str(txn.get("tranAmount", "0"))),
                    "type": "credit" if txn.get("tranType") == "C" else "debit",
                    "narration": txn.get("remarks"),
                    "date": txn.get("tranDate")
                })
            
            return transactions
        
        except Exception as e:
            logger.error(f"Providus transactions error: {e}")
            return []
    
    async def freeze_account(self, account_number: str) -> bool:
        """Freeze Providus account"""
        
        try:
            response = await self.client.post(
                f"{self.base_url}/PiPAccountFreeze",
                json={"account_number": account_number},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return data.get("responseCode") == "00"
        
        except Exception as e:
            logger.error(f"Providus freeze error: {e}")
            return False
    
    async def unfreeze_account(self, account_number: str) -> bool:
        """Unfreeze Providus account"""
        
        try:
            response = await self.client.post(
                f"{self.base_url}/PiPAccountUnfreeze",
                json={"account_number": account_number},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return data.get("responseCode") == "00"
        
        except Exception as e:
            logger.error(f"Providus unfreeze error: {e}")
            return False


class AccountProviderManager:
    """Manages multiple virtual account providers"""
    
    def __init__(self):
        self.providers: Dict[ProviderType, AccountProvider] = {}
        self.primary_provider: Optional[ProviderType] = None
        logger.info("Account provider manager initialized")
    
    def add_provider(
        self,
        provider_type: ProviderType,
        provider: AccountProvider,
        is_primary: bool = False
    ):
        """Add provider"""
        self.providers[provider_type] = provider
        if is_primary or not self.primary_provider:
            self.primary_provider = provider_type
        logger.info(f"Provider added: {provider_type}")
    
    async def create_account(
        self,
        user_id: str,
        account_name: str,
        preferred_provider: Optional[ProviderType] = None,
        bvn: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None
    ) -> Dict:
        """Create virtual account with provider selection"""
        
        # Try preferred provider first
        if preferred_provider and preferred_provider in self.providers:
            provider = self.providers[preferred_provider]
            result = await provider.create_account(user_id, account_name, bvn, email, phone)
            if result.get("success"):
                result["provider"] = preferred_provider.value
                return result
        
        # Try primary provider
        if self.primary_provider and self.primary_provider in self.providers:
            provider = self.providers[self.primary_provider]
            result = await provider.create_account(user_id, account_name, bvn, email, phone)
            if result.get("success"):
                result["provider"] = self.primary_provider.value
                return result
        
        # Try other providers
        for provider_type, provider in self.providers.items():
            if provider_type in [preferred_provider, self.primary_provider]:
                continue
            
            result = await provider.create_account(user_id, account_name, bvn, email, phone)
            if result.get("success"):
                result["provider"] = provider_type.value
                logger.info(f"Fallback provider succeeded: {provider_type}")
                return result
        
        return {"success": False, "error": "All providers failed"}
    
    async def get_provider_stats(self) -> Dict:
        """Get statistics for all providers"""
        
        stats = {}
        for provider_type, provider in self.providers.items():
            stats[provider_type.value] = {
                "accounts_created": provider.accounts_created,
                "accounts_failed": provider.accounts_failed,
                "success_rate": provider.get_success_rate()
            }
        
        return stats
