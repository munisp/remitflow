"""
Paystack Payment Channels - Card, Bank Transfer, USSD, Mobile Money
"""

import httpx
import logging
from typing import Dict, Optional, List
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)


class PaymentChannel(str, Enum):
    """Supported payment channels"""
    CARD = "card"
    BANK = "bank"
    USSD = "ussd"
    MOBILE_MONEY = "mobile_money"
    QR = "qr"
    BANK_TRANSFER = "bank_transfer"


class PaymentStatus(str, Enum):
    """Payment status"""
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"
    ABANDONED = "abandoned"


class PaystackPaymentChannels:
    """Handles all Paystack payment channels"""
    
    def __init__(self, secret_key: str, base_url: str = "https://api.paystack.co"):
        self.secret_key = secret_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30)
        logger.info("Paystack payment channels initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get API headers"""
        return {
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json"
        }
    
    async def initialize_payment(
        self,
        email: str,
        amount: int,  # in kobo (1 NGN = 100 kobo)
        reference: str,
        channels: Optional[List[PaymentChannel]] = None,
        callback_url: Optional[str] = None,
        metadata: Optional[Dict] = None,
        currency: str = "NGN"
    ) -> Dict:
        """Initialize payment transaction"""
        
        payload = {
            "email": email,
            "amount": amount,
            "reference": reference,
            "currency": currency
        }
        
        if channels:
            payload["channels"] = [ch.value for ch in channels]
        
        if callback_url:
            payload["callback_url"] = callback_url
        
        if metadata:
            payload["metadata"] = metadata
        
        try:
            response = await self.client.post(
                f"{self.base_url}/transaction/initialize",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Initialization failed"))
            
            result = {
                "authorization_url": data["data"]["authorization_url"],
                "access_code": data["data"]["access_code"],
                "reference": data["data"]["reference"]
            }
            
            logger.info(f"Payment initialized: {reference}")
            return result
            
        except Exception as e:
            logger.error(f"Payment initialization error: {e}")
            raise
    
    async def verify_payment(self, reference: str) -> Dict:
        """Verify payment transaction"""
        
        try:
            response = await self.client.get(
                f"{self.base_url}/transaction/verify/{reference}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Verification failed"))
            
            transaction = data["data"]
            
            result = {
                "reference": transaction["reference"],
                "amount": transaction["amount"] / 100,
                "currency": transaction["currency"],
                "status": transaction["status"],
                "paid_at": transaction.get("paid_at"),
                "channel": transaction.get("channel"),
                "customer": {
                    "email": transaction["customer"]["email"],
                    "customer_code": transaction["customer"].get("customer_code")
                },
                "authorization": transaction.get("authorization", {})
            }
            
            logger.info(f"Payment verified: {reference} - {result['status']}")
            return result
            
        except Exception as e:
            logger.error(f"Payment verification error: {e}")
            raise
    
    async def charge_authorization(
        self,
        email: str,
        amount: int,
        authorization_code: str,
        reference: str,
        currency: str = "NGN"
    ) -> Dict:
        """Charge a saved authorization (recurring payment)"""
        
        payload = {
            "email": email,
            "amount": amount,
            "authorization_code": authorization_code,
            "reference": reference,
            "currency": currency
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/transaction/charge_authorization",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Charge failed"))
            
            result = {
                "reference": data["data"]["reference"],
                "amount": data["data"]["amount"] / 100,
                "status": data["data"]["status"],
                "currency": data["data"]["currency"]
            }
            
            logger.info(f"Authorization charged: {reference}")
            return result
            
        except Exception as e:
            logger.error(f"Charge authorization error: {e}")
            raise
    
    async def create_dedicated_virtual_account(
        self,
        customer: str,  # customer code or email
        preferred_bank: Optional[str] = None
    ) -> Dict:
        """Create dedicated virtual account for customer"""
        
        payload = {
            "customer": customer
        }
        
        if preferred_bank:
            payload["preferred_bank"] = preferred_bank
        
        try:
            response = await self.client.post(
                f"{self.base_url}/dedicated_account",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Virtual account creation failed"))
            
            account = data["data"]
            
            result = {
                "account_number": account["account_number"],
                "account_name": account["account_name"],
                "bank_name": account["bank"]["name"],
                "bank_code": account["bank"]["id"],
                "customer_code": account["customer"]["customer_code"]
            }
            
            logger.info(f"Virtual account created: {result['account_number']}")
            return result
            
        except Exception as e:
            logger.error(f"Virtual account creation error: {e}")
            raise
    
    async def initiate_ussd_payment(
        self,
        email: str,
        amount: int,
        reference: str,
        bank_code: str,  # e.g., "737" for GTBank
        currency: str = "NGN"
    ) -> Dict:
        """Initiate USSD payment"""
        
        # First initialize transaction
        init_result = await self.initialize_payment(
            email=email,
            amount=amount,
            reference=reference,
            channels=[PaymentChannel.USSD],
            currency=currency
        )
        
        # Then charge with USSD
        payload = {
            "email": email,
            "amount": amount,
            "reference": reference,
            "ussd": {
                "type": bank_code
            }
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/charge",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "USSD charge failed"))
            
            result = {
                "reference": reference,
                "ussd_code": data["data"].get("ussd_code"),
                "display_text": data["data"].get("display_text"),
                "status": data["data"]["status"]
            }
            
            logger.info(f"USSD payment initiated: {reference}")
            return result
            
        except Exception as e:
            logger.error(f"USSD payment error: {e}")
            raise
    
    async def initiate_mobile_money(
        self,
        email: str,
        amount: int,
        reference: str,
        phone: str,
        provider: str,  # "mtn", "vodafone", "airtel", "tigo"
        currency: str = "GHS"  # Mobile money typically in GHS
    ) -> Dict:
        """Initiate mobile money payment"""
        
        payload = {
            "email": email,
            "amount": amount,
            "reference": reference,
            "mobile_money": {
                "phone": phone,
                "provider": provider
            },
            "currency": currency
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/charge",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Mobile money charge failed"))
            
            result = {
                "reference": reference,
                "status": data["data"]["status"],
                "display_text": data["data"].get("display_text")
            }
            
            logger.info(f"Mobile money payment initiated: {reference}")
            return result
            
        except Exception as e:
            logger.error(f"Mobile money payment error: {e}")
            raise
    
    async def submit_otp(self, otp: str, reference: str) -> Dict:
        """Submit OTP for transaction"""
        
        payload = {
            "otp": otp,
            "reference": reference
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/charge/submit_otp",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "OTP submission failed"))
            
            result = {
                "reference": reference,
                "status": data["data"]["status"],
                "message": data.get("message")
            }
            
            logger.info(f"OTP submitted: {reference}")
            return result
            
        except Exception as e:
            logger.error(f"OTP submission error: {e}")
            raise
    
    async def submit_pin(self, pin: str, reference: str) -> Dict:
        """Submit PIN for transaction"""
        
        payload = {
            "pin": pin,
            "reference": reference
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/charge/submit_pin",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "PIN submission failed"))
            
            result = {
                "reference": reference,
                "status": data["data"]["status"],
                "message": data.get("message")
            }
            
            logger.info(f"PIN submitted: {reference}")
            return result
            
        except Exception as e:
            logger.error(f"PIN submission error: {e}")
            raise
    
    async def submit_phone(self, phone: str, reference: str) -> Dict:
        """Submit phone number for transaction"""
        
        payload = {
            "phone": phone,
            "reference": reference
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/charge/submit_phone",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Phone submission failed"))
            
            result = {
                "reference": reference,
                "status": data["data"]["status"],
                "message": data.get("message")
            }
            
            logger.info(f"Phone submitted: {reference}")
            return result
            
        except Exception as e:
            logger.error(f"Phone submission error: {e}")
            raise
    
    async def check_pending_charge(self, reference: str) -> Dict:
        """Check status of pending charge"""
        
        try:
            response = await self.client.get(
                f"{self.base_url}/charge/{reference}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Charge check failed"))
            
            result = {
                "reference": reference,
                "status": data["data"]["status"],
                "amount": data["data"]["amount"] / 100,
                "currency": data["data"]["currency"]
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Charge check error: {e}")
            raise
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
