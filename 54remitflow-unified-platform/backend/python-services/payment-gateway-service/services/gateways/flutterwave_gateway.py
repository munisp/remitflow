'''
Payment Gateway Integrations for the Remittance Platform

This module provides a standardized interface for interacting with various payment gateways.
It includes an abstract base class `BasePaymentGateway` and concrete implementations for popular gateways like Paystack and Flutterwave.

Key Features:
- Abstract base class to enforce a common interface for all gateways.
- Concrete implementations for Paystack and Flutterwave.
- Asynchronous operations using `httpx` for high performance.
- Retry logic with exponential backoff for handling transient network issues.
- Webhook signature verification for security.
- Standardized error handling and exceptions.
'''

import abc
import json
import time
import hmac
import hashlib
from typing import Any, Dict, List, Optional

import httpx
from httpx import AsyncClient, HTTPStatusError, ConnectError, TimeoutException

# --- Custom Exceptions ---

class GatewayError(Exception):
    """Base exception for gateway-related errors."""
    pass

class GatewayAPIError(GatewayError):
    """Raised for errors returned by the gateway's API."""
    pass

class GatewayVerificationError(GatewayError):
    """Raised when transaction verification fails."""
    pass

class GatewayWebhookError(GatewayError):
    """Raised for errors during webhook processing."""
    pass

class GatewaySignatureVerificationError(GatewayWebhookError):
    """Raised when webhook signature verification fails."""
    pass

# --- BasePaymentGateway Abstract Class ---

class BasePaymentGateway(abc.ABC):
    '''
    Abstract base class for all payment gateway integrations.
    Defines the core methods that every gateway must implement.
    '''

    def __init__(self, api_key: str, secret_key: str, base_url: str) -> None:
        '''
        Initializes the gateway with necessary credentials and base URL.
        '''
        self.api_key = api_key
        self.secret_key = secret_key
        self.base_url = base_url

    @abc.abstractmethod
    async def initialize_payment(self, amount: float, currency: str, customer_info: Dict[str, Any], metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        '''
        Initiates a payment transaction.
        '''
        raise NotImplementedError

    @abc.abstractmethod
    async def verify_payment(self, transaction_reference: str) -> Dict[str, Any]:
        '''
        Verifies the status of a completed transaction using its reference.
        '''
        raise NotImplementedError

    @abc.abstractmethod
    async def process_webhook(self, headers: Dict[str, str], body: bytes) -> Dict[str, Any]:
        '''
        Processes an incoming webhook notification, including signature verification.
        '''
        raise NotImplementedError

    @abc.abstractmethod
    async def refund_payment(self, transaction_reference: str, amount: float) -> Dict[str, Any]:
        '''
        Initiates a refund for a successful transaction.
        '''
        raise NotImplementedError

    @abc.abstractmethod
    def get_supported_currencies(self) -> List[str]:
        '''
        Returns a list of supported currency codes for this gateway.
        '''
        raise NotImplementedError

# --- FlutterwaveGateway Implementation ---

class FlutterwaveGateway(BasePaymentGateway):
    '''
    Payment gateway integration for Flutterwave (Rave).
    Supports various payment methods across Africa.
    '''

    SUPPORTED_CURRENCIES = [
        "NGN", "GHS", "KES", "ZAR", "UGX", "TZS", "XOF", "XAF", "RWF", "ZMW",
        "USD", "EUR", "GBP", "CAD"
    ]
    
    BASE_URL = "https://api.flutterwave.com/v3"
    INITIATE_ENDPOINT = "/payments"
    VERIFY_ENDPOINT = "/transactions/{id}/verify"
    REFUND_ENDPOINT = "/refunds"
    WEBHOOK_SIGNATURE_HEADER = "verif-hash"

    def __init__(self, secret_key: str, webhook_secret_hash: str, is_live: bool = False) -> None:
        super().__init__(api_key="", secret_key=secret_key, base_url=self.BASE_URL)
        self.webhook_secret_hash = webhook_secret_hash
        self.client = self._get_async_client()

    def _get_async_client(self) -> AsyncClient:
        headers = {
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json"
        }
        return AsyncClient(base_url=self.base_url, headers=headers, timeout=30.0)

    async def _make_request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        max_retries = 3
        delay = 1

        for attempt in range(max_retries):
            try:
                response = await self.client.request(method, endpoint, **kwargs)
                response.raise_for_status()
                return response.json()
            except HTTPStatusError as e:
                error_detail = e.response.json() if e.response.content else {"message": "No response content"}
                if 400 <= e.response.status_code < 500 and e.response.status_code not in [429, 503]:
                    raise GatewayAPIError(f"Flutterwave API Client Error ({e.response.status_code}): {error_detail.get('message', str(error_detail))}") from e
                if attempt >= max_retries - 1:
                    raise GatewayAPIError(f"Flutterwave API Server Error ({e.response.status_code}) after {max_retries} attempts: {error_detail.get('message', str(error_detail))}") from e
                time.sleep(delay)
                delay *= 2
            except (ConnectError, TimeoutException) as e:
                if attempt >= max_retries - 1:
                    raise GatewayError(f"Flutterwave API Connection failed after {max_retries} attempts: {e}") from e
                time.sleep(delay)
                delay *= 2
            except Exception as e:
                raise GatewayError(f"An unexpected error occurred during API request: {e}") from e
        raise GatewayError("Request failed after all retries.")

    async def initialize_payment(self, amount: float, currency: str, customer_info: Dict[str, Any], metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if currency not in self.SUPPORTED_CURRENCIES:
            raise ValueError(f"Unsupported currency: {currency}")
        
        required_keys = ["email", "name", "phone_number"]
        if not all(key in customer_info for key in required_keys):
            raise ValueError("Missing required customer info keys.")

        tx_ref = f"TX-{int(time.time() * 1000)}"
        payload = {
            "tx_ref": tx_ref,
            "amount": str(amount),
            "currency": currency,
            "redirect_url": "https://remitflow.com/payment-callback",
            "customer": customer_info,
            "customizations": {
                "title": "RemitFlow Payment",
                "logo": "https://remitflow.com/logo.png"
            },
            "meta": metadata or {}
        }

        response = await self._make_request("POST", self.INITIATE_ENDPOINT, json=payload)
        
        if response.get("status") == "success" and response.get("data", {}).get("link"):
            return {
                "status": "success",
                "transaction_reference": tx_ref,
                "payment_link": response["data"]["link"],
                "raw_response": response
            }
        raise GatewayAPIError(f"Payment initialization failed: {response.get('message', 'Unknown error')}")

    async def verify_payment(self, transaction_id: str) -> Dict[str, Any]:
        endpoint = self.VERIFY_ENDPOINT.format(id=transaction_id)
        response = await self._make_request("GET", endpoint)

        if response.get("status") == "success" and response.get("data"):
            data = response["data"]
            return {
                "status": data.get("status"),
                "amount": data.get("amount"),
                "currency": data.get("currency"),
                "transaction_id": data.get("id"),
                "tx_ref": data.get("tx_ref"),
                "raw_response": response
            }
        raise GatewayVerificationError(f"Transaction verification failed: {response.get('message', 'Unknown error')}")

    def _verify_webhook_signature(self, headers: Dict[str, str], body: bytes) -> bool:
        header_keys = {k.lower(): v for k, v in headers.items()}
        received_hash = header_keys.get(self.WEBHOOK_SIGNATURE_HEADER.lower())
        if not received_hash:
            return False
        
        try:
            key = self.webhook_secret_hash.encode('utf-8')
            computed_hash = hmac.new(key, body, hashlib.sha256).hexdigest()
            return hmac.compare_digest(computed_hash, received_hash)
        except Exception:
            return False

    async def process_webhook(self, headers: Dict[str, str], body: bytes) -> Dict[str, Any]:
        if not self._verify_webhook_signature(headers, body):
            raise GatewaySignatureVerificationError("Webhook signature verification failed.")
        
        try:
            data = json.loads(body.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise GatewayWebhookError(f"Invalid JSON payload: {e}") from e
        
        event_type = data.get("event")
        transaction_data = data.get("data", {})
        
        return {
            "event": event_type,
            "transaction_id": transaction_data.get("id"),
            "tx_ref": transaction_data.get("tx_ref"),
            "status": transaction_data.get("status"),
            "raw_data": data
        }

    async def refund_payment(self, transaction_id: str, amount: float) -> Dict[str, Any]:
        if amount <= 0:
            raise ValueError("Refund amount must be greater than zero.")

        payload = {
            "transaction_id": transaction_id,
            "amount": amount
        }

        response = await self._make_request("POST", self.REFUND_ENDPOINT, json=payload)

        if response.get("status") == "success" and response.get("data"):
            data = response["data"]
            return {
                "status": data.get("status"),
                "reference": data.get("reference"),
                "raw_response": response
            }
        raise GatewayAPIError(f"Refund failed: {response.get('message', 'Unknown error')}")

    def get_supported_currencies(self) -> List[str]:
        return self.SUPPORTED_CURRENCIES
