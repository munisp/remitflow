"""
M-Pesa Payment Gateway Client - Production Implementation
Supports Safaricom M-Pesa mobile money transfers
"""

import httpx
import base64
import logging
from typing import Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class MPesaError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"M-Pesa Error {code}: {message}")

class MPesaClient:
    def __init__(self, consumer_key: str, consumer_secret: str, shortcode: str, passkey: str, base_url: str = "https://api.safaricom.co.ke"):
        self.consumer_key = consumer_key
        self.consumer_secret = consumer_secret
        self.shortcode = shortcode
        self.passkey = passkey
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30)
        self.access_token = None
        logger.info(f"M-Pesa client initialized for shortcode: {shortcode}")
    
    def _generate_password(self, timestamp: str) -> str:
        """Generate password for STK push"""
        data = f"{self.shortcode}{self.passkey}{timestamp}"
        return base64.b64encode(data.encode()).decode()
    
    async def _get_access_token(self) -> str:
        """Get OAuth access token"""
        if self.access_token:
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
            return self.access_token
        except Exception as e:
            logger.error(f"Access token error: {e}")
            raise MPesaError(code="AUTH_ERROR", message=str(e))
    
    async def stk_push(self, phone_number: str, amount: int, account_reference: str, transaction_desc: str, callback_url: str) -> Dict:
        """Initiate STK Push (Lipa Na M-Pesa Online)"""
        token = await self._get_access_token()
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
            response = await self.client.post(
                f"{self.base_url}/mpesa/stkpush/v1/processrequest",
                json=payload,
                headers={"Authorization": f"Bearer {token}"}
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
        token = await self._get_access_token()
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        password = self._generate_password(timestamp)
        
        payload = {
            "BusinessShortCode": self.shortcode,
            "Password": password,
            "Timestamp": timestamp,
            "CheckoutRequestID": checkout_request_id
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/mpesa/stkpushquery/v1/query",
                json=payload,
                headers={"Authorization": f"Bearer {token}"}
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
        token = await self._get_access_token()
        
        payload = {
            "InitiatorName": "testapi",
            "SecurityCredential": "encrypted_credential",
            "CommandID": command_id,
            "Amount": amount,
            "PartyA": self.shortcode,
            "PartyB": phone_number,
            "Remarks": remarks,
            "QueueTimeOutURL": f"{self.base_url}/timeout",
            "ResultURL": f"{self.base_url}/result",
            "Occasion": occasion
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/mpesa/b2c/v1/paymentrequest",
                json=payload,
                headers={"Authorization": f"Bearer {token}"}
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
        token = await self._get_access_token()
        
        payload = {
            "Initiator": "testapi",
            "SecurityCredential": "encrypted_credential",
            "CommandID": "AccountBalance",
            "PartyA": self.shortcode,
            "IdentifierType": "4",
            "Remarks": remarks,
            "QueueTimeOutURL": f"{self.base_url}/timeout",
            "ResultURL": f"{self.base_url}/result"
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/mpesa/accountbalance/v1/query",
                json=payload,
                headers={"Authorization": f"Bearer {token}"}
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
