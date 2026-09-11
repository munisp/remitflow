"""
M-Pesa Payment Gateway Client - Production Implementation
Supports Safaricom M-Pesa mobile money transfers
"""

import httpx
import base64
import logging
import time
from typing import Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

# Refresh the OAuth token this many seconds before its stated expiry.
TOKEN_EXPIRY_SKEW_SECONDS = 60

class MPesaError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"M-Pesa Error {code}: {message}")

class MPesaClient:
    def __init__(
        self,
        consumer_key: str,
        consumer_secret: str,
        shortcode: str,
        passkey: str,
        base_url: str = "https://api.safaricom.co.ke",
        initiator_name: Optional[str] = None,
        security_credential: Optional[str] = None,
        result_url: Optional[str] = None,
        timeout_url: Optional[str] = None,
    ):
        self.consumer_key = consumer_key
        self.consumer_secret = consumer_secret
        self.shortcode = shortcode
        self.passkey = passkey
        self.base_url = base_url.rstrip('/')
        # B2C/balance config. security_credential must be the initiator
        # password encrypted with the M-Pesa public key (done offline).
        # result_url/timeout_url must point at OUR webhook ingress,
        # never at the provider host.
        self.initiator_name = initiator_name
        self.security_credential = security_credential
        self.result_url = result_url
        self.timeout_url = timeout_url
        self.client = httpx.AsyncClient(timeout=30)
        self.access_token = None
        self.token_expires_at = 0.0
        logger.info(f"M-Pesa client initialized for shortcode: {shortcode}")

    def _require_b2c_config(self):
        """Fail fast if B2C/balance prerequisites are not configured."""
        missing = [
            name for name, value in (
                ("initiator_name", self.initiator_name),
                ("security_credential", self.security_credential),
                ("result_url", self.result_url),
                ("timeout_url", self.timeout_url),
            ) if not value
        ]
        if missing:
            raise MPesaError(
                code="CONFIG_ERROR",
                message=f"B2C not configured; missing: {', '.join(missing)}. "
                        "Set MPESA_INITIATOR_NAME, MPESA_SECURITY_CREDENTIAL, "
                        "MPESA_RESULT_URL and MPESA_TIMEOUT_URL."
            )
    
    def _generate_password(self, timestamp: str) -> str:
        """Generate password for STK push"""
        data = f"{self.shortcode}{self.passkey}{timestamp}"
        return base64.b64encode(data.encode()).decode()
    
    async def _get_access_token(self, force_refresh: bool = False) -> str:
        """Get OAuth access token, refreshing at/before expiry"""
        if (
            not force_refresh
            and self.access_token
            and time.time() < self.token_expires_at
        ):
            return self.access_token

        auth = base64.b64encode(f"{self.consumer_key}:{self.consumer_secret}".encode()).decode()

        try:
            response = await self.client.get(
                f"{self.base_url}/oauth/v1/generate?grant_type=client_credentials",
                headers={"Authorization": f"Basic {auth}"}
            )
            response.raise_for_status()
            data = response.json()
            self.access_token = data["access_token"]
            # Safaricom tokens expire (~1h); honour expires_in with skew.
            expires_in = int(data.get("expires_in", 3599))
            self.token_expires_at = time.time() + expires_in - TOKEN_EXPIRY_SKEW_SECONDS
            return self.access_token
        except Exception as e:
            logger.error(f"Access token error: {e}")
            raise MPesaError(code="AUTH_ERROR", message=str(e))

    async def _authed_post(self, url: str, payload: Dict) -> httpx.Response:
        """POST with bearer token; on 401 refresh the token once and retry."""
        token = await self._get_access_token()
        headers = {"Authorization": f"Bearer {token}"}
        response = await self.client.post(url, json=payload, headers=headers)
        if response.status_code == 401:
            logger.warning("M-Pesa request returned 401; refreshing token once and retrying")
            token = await self._get_access_token(force_refresh=True)
            headers["Authorization"] = f"Bearer {token}"
            response = await self.client.post(url, json=payload, headers=headers)
        return response
    
    async def stk_push(self, phone_number: str, amount: int, account_reference: str, transaction_desc: str, callback_url: str) -> Dict:
        """Initiate STK Push (Lipa Na M-Pesa Online)"""
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        password = self._generate_password(timestamp)

        payload = {
            "BusinessShortCode": self.shortcode,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": amount,
            "PartyA": phone_number,
            "PartyB": self.shortcode,
            "PhoneNumber": phone_number,
            "CallBackURL": callback_url,
            "AccountReference": account_reference,
            "TransactionDesc": transaction_desc
        }
        
        try:
            response = await self._authed_post(
                f"{self.base_url}/mpesa/stkpush/v1/processrequest",
                payload
            )
            response.raise_for_status()
            data = response.json()

            if data.get("ResponseCode") != "0":
                raise MPesaError(
                    code=data.get("ResponseCode", "UNKNOWN"),
                    message=data.get("ResponseDescription", "STK push failed"),
                    details=data
                )
            
            return {
                "merchant_request_id": data["MerchantRequestID"],
                "checkout_request_id": data["CheckoutRequestID"],
                "response_code": data["ResponseCode"],
                "response_description": data["ResponseDescription"],
                "customer_message": data["CustomerMessage"]
            }
        except httpx.HTTPStatusError as e:
            logger.error(f"M-Pesa HTTP error: {e}")
            raise MPesaError(code=str(e.response.status_code), message=str(e))
        except Exception as e:
            logger.error(f"M-Pesa error: {e}")
            raise MPesaError(code="INTERNAL_ERROR", message=str(e))
    
    async def query_stk_status(self, checkout_request_id: str) -> Dict:
        """Query STK push transaction status"""
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        password = self._generate_password(timestamp)

        payload = {
            "BusinessShortCode": self.shortcode,
            "Password": password,
            "Timestamp": timestamp,
            "CheckoutRequestID": checkout_request_id
        }

        try:
            response = await self._authed_post(
                f"{self.base_url}/mpesa/stkpushquery/v1/query",
                payload
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "merchant_request_id": data.get("MerchantRequestID"),
                "checkout_request_id": data.get("CheckoutRequestID"),
                "response_code": data.get("ResponseCode"),
                "result_desc": data.get("ResultDesc"),
                "result_code": data.get("ResultCode")
            }
        except Exception as e:
            logger.error(f"Query status error: {e}")
            raise MPesaError(code="QUERY_ERROR", message=str(e))
    
    async def b2c_payment(self, phone_number: str, amount: int, occasion: str, remarks: str, command_id: str = "BusinessPayment") -> Dict:
        """Business to Customer payment"""
        self._require_b2c_config()

        payload = {
            "InitiatorName": self.initiator_name,
            "SecurityCredential": self.security_credential,
            "CommandID": command_id,
            "Amount": amount,
            "PartyA": self.shortcode,
            "PartyB": phone_number,
            "Remarks": remarks,
            "QueueTimeOutURL": self.timeout_url,
            "ResultURL": self.result_url,
            "Occasion": occasion
        }

        try:
            response = await self._authed_post(
                f"{self.base_url}/mpesa/b2c/v1/paymentrequest",
                payload
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "conversation_id": data.get("ConversationID"),
                "originator_conversation_id": data.get("OriginatorConversationID"),
                "response_code": data.get("ResponseCode"),
                "response_description": data.get("ResponseDescription")
            }
        except Exception as e:
            logger.error(f"B2C payment error: {e}")
            raise MPesaError(code="B2C_ERROR", message=str(e))
    
    async def account_balance(self, remarks: str = "Balance Query") -> Dict:
        """Query account balance"""
        self._require_b2c_config()

        payload = {
            "Initiator": self.initiator_name,
            "SecurityCredential": self.security_credential,
            "CommandID": "AccountBalance",
            "PartyA": self.shortcode,
            "IdentifierType": "4",
            "Remarks": remarks,
            "QueueTimeOutURL": self.timeout_url,
            "ResultURL": self.result_url
        }

        try:
            response = await self._authed_post(
                f"{self.base_url}/mpesa/accountbalance/v1/query",
                payload
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "conversation_id": data.get("ConversationID"),
                "originator_conversation_id": data.get("OriginatorConversationID"),
                "response_code": data.get("ResponseCode")
            }
        except Exception as e:
            logger.error(f"Balance query error: {e}")
            raise MPesaError(code="BALANCE_ERROR", message=str(e))
    
    async def close(self):
        await self.client.aclose()
