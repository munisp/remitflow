"""
Paystack Payment Gateway Client - Production Implementation
"""

import httpx
import hashlib
import hmac
import logging
from typing import Dict, Optional, List

logger = logging.getLogger(__name__)

class PaystackError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"Paystack Error {code}: {message}")

class PaystackClient:
    def __init__(self, secret_key: str, public_key: str = None, base_url: str = "https://api.paystack.co"):
        self.secret_key = secret_key
        self.public_key = public_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30)
        logger.info("Paystack client initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json"
        }
    
    def _verify_webhook_signature(self, payload: str, signature: str) -> bool:
        expected = hmac.new(
            self.secret_key.encode(),
            payload.encode(),
            hashlib.sha512
        ).hexdigest()
        return expected == signature
    
    async def initiate_transfer(self, amount: int, recipient_code: str, reason: str, reference: str = None, currency: str = "NGN") -> Dict:
        """Initiate transfer (amount in kobo/pesewas)"""
        payload = {
            "source": "balance",
            "amount": amount,
            "recipient": recipient_code,
            "reason": reason,
            "currency": currency
        }
        
        if reference:
            payload["reference"] = reference
        
        try:
            response = await self.client.post(
                f"{self.base_url}/transfer",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise PaystackError(
                    code="TRANSFER_FAILED",
                    message=data.get("message", "Transfer failed"),
                    details=data
                )
            
            return {
                "transfer_id": data["data"]["id"],
                "transfer_code": data["data"]["transfer_code"],
                "status": data["data"]["status"],
                "reference": data["data"]["reference"],
                "amount": amount / 100,
                "currency": currency
            }
        except httpx.HTTPStatusError as e:
            logger.error(f"Paystack HTTP error: {e}")
            raise PaystackError(code=str(e.response.status_code), message=str(e))
        except Exception as e:
            logger.error(f"Paystack error: {e}")
            raise PaystackError(code="INTERNAL_ERROR", message=str(e))
    
    async def get_transfer_status(self, transfer_code: str) -> Dict:
        """Get transfer status"""
        try:
            response = await self.client.get(
                f"{self.base_url}/transfer/{transfer_code}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "transfer_code": transfer_code,
                "status": data["data"]["status"],
                "reference": data["data"].get("reference"),
                "amount": data["data"]["amount"] / 100,
                "currency": data["data"]["currency"]
            }
        except Exception as e:
            logger.error(f"Get status error: {e}")
            raise PaystackError(code="STATUS_ERROR", message=str(e))
    
    async def create_transfer_recipient(self, type: str, name: str, account_number: str, bank_code: str, currency: str = "NGN") -> Dict:
        """Create transfer recipient"""
        payload = {
            "type": type,
            "name": name,
            "account_number": account_number,
            "bank_code": bank_code,
            "currency": currency
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/transferrecipient",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "recipient_code": data["data"]["recipient_code"],
                "type": data["data"]["type"],
                "name": data["data"]["name"],
                "account_number": data["data"]["details"]["account_number"],
                "bank_code": data["data"]["details"]["bank_code"]
            }
        except Exception as e:
            logger.error(f"Create recipient error: {e}")
            raise PaystackError(code="RECIPIENT_ERROR", message=str(e))
    
    async def verify_account(self, account_number: str, bank_code: str) -> Dict:
        """Verify bank account"""
        try:
            response = await self.client.get(
                f"{self.base_url}/bank/resolve",
                params={"account_number": account_number, "bank_code": bank_code},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "account_number": account_number,
                "account_name": data["data"]["account_name"],
                "bank_code": bank_code
            }
        except Exception as e:
            logger.error(f"Account verification error: {e}")
            raise PaystackError(code="VERIFY_ERROR", message=str(e))
    
    async def get_banks(self, country: str = "nigeria") -> List[Dict]:
        """Get list of banks"""
        try:
            response = await self.client.get(
                f"{self.base_url}/bank",
                params={"country": country},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return data["data"]
        except Exception as e:
            logger.error(f"Get banks error: {e}")
            raise PaystackError(code="BANKS_ERROR", message=str(e))
    
    async def get_balance(self) -> Dict:
        """Get account balance"""
        try:
            response = await self.client.get(
                f"{self.base_url}/balance",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "balance": data["data"][0]["balance"] / 100,
                "currency": data["data"][0]["currency"]
            }
        except Exception as e:
            logger.error(f"Get balance error: {e}")
            raise PaystackError(code="BALANCE_ERROR", message=str(e))
    
    async def close(self):
        await self.client.aclose()
