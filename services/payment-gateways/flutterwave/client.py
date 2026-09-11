"""
Flutterwave Payment Gateway Client - Production Implementation
"""

import httpx
import hashlib
import hmac
import logging
from typing import Dict, Optional, List
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)

class FlutterwaveError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"Flutterwave Error {code}: {message}")

class FlutterwaveClient:
    def __init__(self, api_key: str, secret_key: str, encryption_key: str, base_url: str = "https://api.flutterwave.com", callback_url: Optional[str] = None):
        self.api_key = api_key
        self.secret_key = secret_key
        self.encryption_key = encryption_key
        self.base_url = base_url.rstrip('/')
        # Webhook/callback ingress for transfer status notifications.
        # Must be OUR ingress (e.g. https://api.remitflow.example/...),
        # never the provider host. None => omit callback_url from payloads.
        self.callback_url = callback_url
        self.client = httpx.AsyncClient(timeout=30)
        logger.info("Flutterwave client initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    def _verify_signature(self, payload: str, signature: str) -> bool:
        """Constant-time comparison of a payload signature (HMAC-SHA256)."""
        expected = hmac.new(
            self.secret_key.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_webhook_hash(self, verif_hash: str) -> bool:
        """Verify a Flutterwave webhook's `verif-hash` header.

        Flutterwave signs webhooks by sending the configured secret hash
        verbatim in the `verif-hash` header; compare constant-time and
        fail closed.
        """
        if not verif_hash or not self.secret_key:
            return False
        return hmac.compare_digest(self.secret_key, verif_hash)
    
    async def initiate_transfer(self, account_bank: str, account_number: str, amount: float, currency: str, narration: str, reference: str, beneficiary_name: str = None) -> Dict:
        """Initiate transfer to bank account"""
        payload = {
            "account_bank": account_bank,
            "account_number": account_number,
            "amount": amount,
            "currency": currency,
            "narration": narration,
            "reference": reference,
            "debit_currency": currency
        }

        if self.callback_url:
            payload["callback_url"] = self.callback_url

        if beneficiary_name:
            payload["beneficiary_name"] = beneficiary_name
        
        try:
            response = await self.client.post(
                f"{self.base_url}/v3/transfers",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") != "success":
                raise FlutterwaveError(
                    code=data.get("code", "UNKNOWN"),
                    message=data.get("message", "Transfer failed"),
                    details=data
                )
            
            return {
                "transfer_id": data["data"]["id"],
                "status": data["data"]["status"],
                "reference": data["data"]["reference"],
                "amount": amount,
                "currency": currency,
                "fee": data["data"].get("fee", 0)
            }
        except httpx.HTTPStatusError as e:
            logger.error(f"Flutterwave HTTP error: {e}")
            raise FlutterwaveError(code=str(e.response.status_code), message=str(e))
        except Exception as e:
            logger.error(f"Flutterwave error: {e}")
            raise FlutterwaveError(code="INTERNAL_ERROR", message=str(e))
    
    async def get_transfer_status(self, transfer_id: str) -> Dict:
        """Get transfer status"""
        try:
            response = await self.client.get(
                f"{self.base_url}/v3/transfers/{transfer_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "transfer_id": transfer_id,
                "status": data["data"]["status"],
                "reference": data["data"].get("reference"),
                "amount": data["data"].get("amount"),
                "currency": data["data"].get("currency")
            }
        except Exception as e:
            logger.error(f"Get status error: {e}")
            raise FlutterwaveError(code="STATUS_ERROR", message=str(e))
    
    async def get_exchange_rate(self, from_currency: str, to_currency: str, amount: float) -> Dict:
        """Get exchange rate"""
        try:
            response = await self.client.get(
                f"{self.base_url}/v3/transfers/rates",
                params={"from": from_currency, "to": to_currency, "amount": amount},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "from_currency": from_currency,
                "to_currency": to_currency,
                "rate": data["data"]["rate"],
                "amount": amount
            }
        except Exception as e:
            logger.error(f"Exchange rate error: {e}")
            raise FlutterwaveError(code="RATE_ERROR", message=str(e))
    
    async def verify_account(self, account_number: str, account_bank: str) -> Dict:
        """Verify bank account"""
        try:
            response = await self.client.post(
                f"{self.base_url}/v3/accounts/resolve",
                json={"account_number": account_number, "account_bank": account_bank},
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "account_number": account_number,
                "account_name": data["data"]["account_name"],
                "account_bank": account_bank
            }
        except Exception as e:
            logger.error(f"Account verification error: {e}")
            raise FlutterwaveError(code="VERIFY_ERROR", message=str(e))
    
    async def get_banks(self, country: str = "NG") -> List[Dict]:
        """Get list of banks"""
        try:
            response = await self.client.get(
                f"{self.base_url}/v3/banks/{country}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            return data["data"]
        except Exception as e:
            logger.error(f"Get banks error: {e}")
            raise FlutterwaveError(code="BANKS_ERROR", message=str(e))
    
    async def close(self):
        await self.client.aclose()
