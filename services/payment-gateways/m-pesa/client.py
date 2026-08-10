"""
M-Pesa Daraja API Client v2.0 — Production Hardened
RemitFlow Payment Gateway Integration

REQUIRED environment variables (loaded from AWS Secrets Manager or Dapr):
  - MPESA_CONSUMER_KEY
  - MPESA_CONSUMER_SECRET
  - MPESA_BUSINESS_SHORTCODE
  - MPESA_PASSKEY
  - MPESA_INITIATOR_NAME
  - MPESA_INITIATOR_PASSWORD
  - MPESA_SECURITY_CREDENTIAL (base64-encoded encrypted credential)
  - MPESA_CALLBACK_BASE_URL (publicly routable HTTPS domain)
  - MPESA_ENVIRONMENT (sandbox | production)

Startup guarantee:
  If any required credential is missing or equals a known placeholder,
  the service panics on boot with explicit error message.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime
from typing import Any, Dict, Optional

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ─── Known dangerous placeholder values ──────────────────────────────────────
_PLACEHOLDERS = {
    "testapi", "test_api", "encrypted_credential", "placeholder", "changeme",
    "your_consumer_key", "your_consumer_secret", "your_passkey", "your_password",
    "admin", "password", "123456", "mpesa_test", "sandbox_default",
}

# ─── Configuration with strict validation ────────────────────────────────────

class MPesaConfig:
    """M-Pesa configuration loaded from environment with startup validation."""

    def __init__(self):
        self.environment = os.getenv("MPESA_ENVIRONMENT", "sandbox").lower()
        if self.environment not in ("sandbox", "production"):
            raise RuntimeError(f"MPESA_ENVIRONMENT must be 'sandbox' or 'production', got: {self.environment}")

        self.base_url = (
            "https://sandbox.safaricom.co.ke"
            if self.environment == "sandbox"
            else "https://api.safaricom.co.ke"
        )

        self.consumer_key = self._require_env("MPESA_CONSUMER_KEY")
        self.consumer_secret = self._require_env("MPESA_CONSUMER_SECRET")
        self.business_shortcode = self._require_env("MPESA_BUSINESS_SHORTCODE")
        self.passkey = self._require_env("MPESA_PASSKEY")
        self.initiator_name = self._require_env("MPESA_INITIATOR_NAME")
        self.initiator_password = self._require_env("MPESA_INITIATOR_PASSWORD")
        self.security_credential = self._require_env("MPESA_SECURITY_CREDENTIAL")
        self.callback_base_url = self._require_env("MPESA_CALLBACK_BASE_URL")

        # Validate no placeholders
        self._validate_no_placeholders()

        # Validate callback URL is HTTPS in production
        if self.environment == "production" and not self.callback_base_url.startswith("https://"):
            raise RuntimeError("MPESA_CALLBACK_BASE_URL must use HTTPS in production")

        logger.info(f"M-Pesa client configured for {self.environment.upper()}")

    def _require_env(self, name: str) -> str:
        value = os.getenv(name, "").strip()
        if not value:
            raise RuntimeError(
                f"CRITICAL: {name} is not set. M-Pesa client cannot start. "
                f"Please configure via AWS Secrets Manager, Dapr secret store, or environment variable."
            )
        return value

    def _validate_no_placeholders(self):
        fields = {
            "consumer_key": self.consumer_key,
            "consumer_secret": self.consumer_secret,
            "passkey": self.passkey,
            "initiator_name": self.initiator_name,
            "initiator_password": self.initiator_password,
            "security_credential": self.security_credential,
        }
        for field_name, value in fields.items():
            lower_val = value.lower()
            if lower_val in _PLACEHOLDERS or "placeholder" in lower_val or "test" in lower_val:
                raise RuntimeError(
                    f"CRITICAL: {field_name} appears to contain a placeholder/test value: '{value}'. "
                    f"M-Pesa client refuses to start with insecure credentials. "
                    f"Replace with production values from Safaricom Daraja portal."
                )

# ─── OAuth2 Token Cache ──────────────────────────────────────────────────────

class TokenCache:
    def __init__(self):
        self._token: Optional[str] = None
        self._expires_at: float = 0.0

    async def get_token(self, config: MPesaConfig) -> str:
        if self._token and time.time() < self._expires_at - 60:
            return self._token

        credentials = base64.b64encode(
            f"{config.consumer_key}:{config.consumer_secret}".encode()
        ).decode()

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{config.base_url}/oauth/v1/generate?grant_type=client_credentials",
                headers={"Authorization": f"Basic {credentials}"},
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data["access_token"]
            self._expires_at = time.time() + data.get("expires_in", 3599)
            logger.info("M-Pesa OAuth token refreshed")
            return self._token

_token_cache = TokenCache()

# ─── Timestamp & Password Helpers ────────────────────────────────────────────

def _get_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S")

def _generate_password(shortcode: str, passkey: str, timestamp: str) -> str:
    raw = f"{shortcode}{passkey}{timestamp}"
    return base64.b64encode(raw.encode()).decode()

# ─── Pydantic Models ─────────────────────────────────────────────────────────

class STKPushRequest(BaseModel):
    phone_number: str = Field(..., pattern=r"^254[0-9]{9}$", description="E.164 format, e.g. 254712345678")
    amount: float = Field(..., gt=0)
    account_reference: str = Field(..., max_length=12)
    transaction_desc: str = Field(default="RemitFlow Transfer", max_length=13)
    callback_url: Optional[str] = None
    callback_metadata: Optional[Dict[str, Any]] = None

class STKPushResponse(BaseModel):
    merchant_request_id: str
    checkout_request_id: str
    response_code: str
    response_description: str
    customer_message: str
    status: str = "pending"
    timestamp: str

class B2CRequest(BaseModel):
    phone_number: str = Field(..., pattern=r"^254[0-9]{9}$")
    amount: float = Field(..., gt=0)
    occasion: str = Field(default="RemitFlow Payout", max_length=100)
    remarks: str = Field(default="Payment", max_length=100)
    queue_timeout_url: Optional[str] = None
    result_url: Optional[str] = None

class TransactionStatusRequest(BaseModel):
    transaction_id: str
    originator_conversation_id: Optional[str] = None

class ReversalRequest(BaseModel):
    transaction_id: str
    amount: float = Field(..., gt=0)
    receiver_party: str
    remarks: str = Field(default="Reversal", max_length=100)
    occasion: str = Field(default="Transaction Reversal", max_length=100)
    queue_timeout_url: Optional[str] = None
    result_url: Optional[str] = None

class CallbackData(BaseModel):
    body: Dict[str, Any]

# ─── M-Pesa Client ──────────────────────────────────────────────────────────

class MPesaClient:
    """Production-hardened M-Pesa Daraja API client."""

    def __init__(self):
        self.config = MPesaConfig()

    async def _get_headers(self) -> Dict[str, str]:
        token = await _token_cache.get_token(self.config)
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    async def stk_push(self, req: STKPushRequest) -> STKPushResponse:
        timestamp = _get_timestamp()
        password = _generate_password(self.config.business_shortcode, self.config.passkey, timestamp)

        callback_url = req.callback_url or f"{self.config.callback_base_url}/api/v1/payments/mpesa/callback"

        payload = {
            "BusinessShortCode": self.config.business_shortcode,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": int(req.amount),
            "PartyA": req.phone_number,
            "PartyB": self.config.business_shortcode,
            "PhoneNumber": req.phone_number,
            "CallBackURL": callback_url,
            "AccountReference": req.account_reference,
            "TransactionDesc": req.transaction_desc,
        }

        if req.callback_metadata:
            payload["CallBackMetadata"] = req.callback_metadata

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.config.base_url}/mpesa/stkpush/v1/processrequest",
                headers=await self._get_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            logger.info(f"STK Push initiated: {data.get('CheckoutRequestID')} for {req.phone_number}")

            return STKPushResponse(
                merchant_request_id=data.get("MerchantRequestID", ""),
                checkout_request_id=data.get("CheckoutRequestID", ""),
                response_code=data.get("ResponseCode", ""),
                response_description=data.get("ResponseDescription", ""),
                customer_message=data.get("CustomerMessage", ""),
                timestamp=timestamp,
            )

    async def b2c_payment(self, req: B2CRequest) -> Dict[str, Any]:
        result_url = req.result_url or f"{self.config.callback_base_url}/api/v1/payments/mpesa/b2c/result"
        queue_timeout_url = req.queue_timeout_url or f"{self.config.callback_base_url}/api/v1/payments/mpesa/b2c/timeout"

        payload = {
            "InitiatorName": self.config.initiator_name,
            "SecurityCredential": self.config.security_credential,
            "CommandID": "BusinessPayment",
            "Amount": int(req.amount),
            "PartyA": self.config.business_shortcode,
            "PartyB": req.phone_number,
            "Remarks": req.remarks,
            "QueueTimeOutURL": queue_timeout_url,
            "ResultURL": result_url,
            "Occasion": req.occasion,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.config.base_url}/mpesa/b2c/v1/paymentrequest",
                headers=await self._get_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info(f"B2C payment initiated: {data.get('OriginatorConversationID')} to {req.phone_number}")
            return data

    async def transaction_status(self, req: TransactionStatusRequest) -> Dict[str, Any]:
        result_url = f"{self.config.callback_base_url}/api/v1/payments/mpesa/transaction-status/result"
        queue_timeout_url = f"{self.config.callback_base_url}/api/v1/payments/mpesa/transaction-status/timeout"

        payload = {
            "Initiator": self.config.initiator_name,
            "SecurityCredential": self.config.security_credential,
            "CommandID": "TransactionStatusQuery",
            "TransactionID": req.transaction_id,
            "PartyA": self.config.business_shortcode,
            "IdentifierType": "4",
            "ResultURL": result_url,
            "QueueTimeOutURL": queue_timeout_url,
            "Remarks": "Status query",
            "Occasion": "Transaction status check",
        }

        if req.originator_conversation_id:
            payload["OriginatorConversationID"] = req.originator_conversation_id

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.config.base_url}/mpesa/transactionstatus/v1/query",
                headers=await self._get_headers(),
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()

    async def reversal(self, req: ReversalRequest) -> Dict[str, Any]:
        result_url = req.result_url or f"{self.config.callback_base_url}/api/v1/payments/mpesa/reversal/result"
        queue_timeout_url = req.queue_timeout_url or f"{self.config.callback_base_url}/api/v1/payments/mpesa/reversal/timeout"

        payload = {
            "Initiator": self.config.initiator_name,
            "SecurityCredential": self.config.security_credential,
            "CommandID": "TransactionReversal",
            "TransactionID": req.transaction_id,
            "Amount": int(req.amount),
            "ReceiverParty": req.receiver_party,
            "RecieverIdentifierType": "4",
            "ResultURL": result_url,
            "QueueTimeOutURL": queue_timeout_url,
            "Remarks": req.remarks,
            "Occasion": req.occasion,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.config.base_url}/mpesa/reversal/v1/request",
                headers=await self._get_headers(),
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()

    async def handle_callback(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Process M-Pesa callback and return structured result."""
        stk_callback = data.get("Body", {}).get("stkCallback", {})
        result_code = stk_callback.get("ResultCode", -1)
        result_desc = stk_callback.get("ResultDesc", "Unknown")
        merchant_request_id = stk_callback.get("MerchantRequestID", "")
        checkout_request_id = stk_callback.get("CheckoutRequestID", "")

        status = "success" if result_code == 0 else "failed"

        callback_item = stk_callback.get("CallbackMetadata", {}).get("Item", [])
        metadata = {item.get("Name", ""): item.get("Value") for item in callback_item}

        logger.info(f"Callback received: {checkout_request_id} -> {status} (code={result_code})")

        return {
            "status": status,
            "resultCode": result_code,
            "resultDescription": result_desc,
            "merchantRequestId": merchant_request_id,
            "checkoutRequestId": checkout_request_id,
            "metadata": metadata,
            "processedAt": datetime.utcnow().isoformat(),
        }

# ─── Singleton instance ──────────────────────────────────────────────────────
_mpesa_client: Optional[MPesaClient] = None

def get_mpesa_client() -> MPesaClient:
    global _mpesa_client
    if _mpesa_client is None:
        _mpesa_client = MPesaClient()
    return _mpesa_client
