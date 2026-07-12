"""
Wise (formerly TransferWise) Payment Gateway Client - Production Implementation
"""

import httpx
import logging
from typing import Dict, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)

class WiseError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"Wise Error {code}: {message}")

class WiseClient:
    def __init__(self, api_key: str, profile_id: str, base_url: str = "https://api.wise.com"):
        self.api_key = api_key
        self.profile_id = profile_id
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30)
        logger.info(f"Wise client initialized for profile: {profile_id}")
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    async def create_quote(self, source_currency: str, target_currency: str, source_amount: float = None, target_amount: float = None) -> Dict:
        """Create transfer quote"""
        payload = {
            "profile": self.profile_id,
            "sourceCurrency": source_currency,
            "targetCurrency": target_currency
        }
        
        if source_amount:
            payload["sourceAmount"] = source_amount
        elif target_amount:
            payload["targetAmount"] = target_amount
        else:
            raise WiseError("INVALID_REQUEST", "Either source_amount or target_amount must be provided")
        
        try:
            response = await self.client.post(
                f"{self.base_url}/v3/quotes",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "quote_id": data["id"],
                "source_currency": data["sourceCurrency"],
                "target_currency": data["targetCurrency"],
                "source_amount": data["sourceAmount"],
                "target_amount": data["targetAmount"],
                "rate": data["rate"],
                "fee": data["fee"],
                "expires_at": data["expirationTime"]
            }
        except httpx.HTTPStatusError as e:
            logger.error(f"Wise HTTP error: {e}")
            raise WiseError(code=str(e.response.status_code), message=str(e))
        except Exception as e:
            logger.error(f"Wise error: {e}")
            raise WiseError(code="INTERNAL_ERROR", message=str(e))
    
    async def create_recipient(self, currency: str, type: str, account_holder_name: str, details: Dict) -> Dict:
        """Create transfer recipient"""
        payload = {
            "currency": currency,
            "type": type,
            "profile": self.profile_id,
            "accountHolderName": account_holder_name,
            "details": details
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/v1/accounts",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "recipient_id": data["id"],
                "currency": data["currency"],
                "type": data["type"],
                "account_holder_name": data["accountHolderName"]
            }
        except Exception as e:
            logger.error(f"Create recipient error: {e}")
            raise WiseError(code="RECIPIENT_ERROR", message=str(e))
    
    async def create_transfer(self, quote_id: str, recipient_id: str, reference: str) -> Dict:
        """Create transfer"""
        payload = {
            "targetAccount": recipient_id,
            "quoteUuid": quote_id,
            "customerTransactionId": reference
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/v1/transfers",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "transfer_id": data["id"],
                "status": data["status"],
                "reference": data["customerTransactionId"],
                "created_at": data["created"]
            }
        except Exception as e:
            logger.error(f"Create transfer error: {e}")
            raise WiseError(code="TRANSFER_ERROR", message=str(e))
    
    async def fund_transfer(self, transfer_id: str) -> Dict:
        """Fund transfer from balance"""
        payload = {"type": "BALANCE"}
        
        try:
            response = await self.client.post(
                f"{self.base_url}/v3/profiles/{self.profile_id}/transfers/{transfer_id}/payments",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "transfer_id": transfer_id,
                "status": data["status"],
                "balance_transaction_id": data.get("balanceTransactionId")
            }
        except Exception as e:
            logger.error(f"Fund transfer error: {e}")
            raise WiseError(code="FUND_ERROR", message=str(e))
    
    async def get_transfer_status(self, transfer_id: str) -> Dict:
        """Get transfer status"""
        try:
            response = await self.client.get(
                f"{self.base_url}/v1/transfers/{transfer_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "transfer_id": transfer_id,
                "status": data["status"],
                "source_amount": data.get("sourceValue"),
                "target_amount": data.get("targetValue"),
                "reference": data.get("customerTransactionId")
            }
        except Exception as e:
            logger.error(f"Get status error: {e}")
            raise WiseError(code="STATUS_ERROR", message=str(e))
    
    async def get_exchange_rate(self, source_currency: str, target_currency: str) -> Dict:
        """Get current exchange rate"""
        try:
            response = await self.client.get(
                f"{self.base_url}/v1/rates",
                params={"source": source_currency, "target": target_currency},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "source_currency": source_currency,
                "target_currency": target_currency,
                "rate": data[0]["rate"],
                "timestamp": data[0]["time"]
            }
        except Exception as e:
            logger.error(f"Exchange rate error: {e}")
            raise WiseError(code="RATE_ERROR", message=str(e))
    
    async def get_balance(self) -> List[Dict]:
        """Get account balances"""
        try:
            response = await self.client.get(
                f"{self.base_url}/v4/profiles/{self.profile_id}/balances",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return [
                {
                    "currency": balance["currency"],
                    "amount": balance["amount"]["value"],
                    "reserved": balance.get("reservedAmount", {}).get("value", 0)
                }
                for balance in data
            ]
        except Exception as e:
            logger.error(f"Get balance error: {e}")
            raise WiseError(code="BALANCE_ERROR", message=str(e))
    
    async def close(self):
        await self.client.aclose()
