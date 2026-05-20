"""
Western Union Payment Gateway Client - Production Implementation
"""

import httpx
import hashlib
import hmac
import json
import logging
from typing import Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class WesternUnionError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"Western Union Error {code}: {message}")

class WesternUnionClient:
    def __init__(self, api_key: str, secret_key: str, partner_id: str, base_url: str = "https://api.westernunion.com", timeout: int = 30):
        self.api_key = api_key
        self.secret_key = secret_key
        self.partner_id = partner_id
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.client = httpx.AsyncClient(
            timeout=timeout,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100)
        )
        logger.info(f"Western Union client initialized for partner: {partner_id}")
    
    def _generate_signature(self, payload: Dict) -> str:
        canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'))
        signature = hmac.new(
            self.secret_key.encode('utf-8'),
            canonical.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    def _get_headers(self, signature: str = None) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-Partner-ID": self.partner_id,
            "X-Request-Time": datetime.utcnow().isoformat()
        }
        if signature:
            headers["X-Signature"] = signature
        return headers
    
    async def _make_request(self, method: str, endpoint: str, payload: Optional[Dict] = None) -> Dict:
        url = f"{self.base_url}{endpoint}"
        
        if payload:
            signature = self._generate_signature(payload)
        else:
            signature = None
        
        headers = self._get_headers(signature)
        
        try:
            logger.info(f"Western Union API request: {method} {endpoint}")
            
            if method.upper() == "POST":
                response = await self.client.post(url, json=payload, headers=headers)
            elif method.upper() == "GET":
                response = await self.client.get(url, headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            logger.info(f"Western Union API response: {response.status_code}")
            data = response.json()
            
            if response.status_code != 200:
                raise WesternUnionError(
                    code=data.get("errorCode", str(response.status_code)),
                    message=data.get("message", "Request failed"),
                    details=data
                )
            
            return data
            
        except httpx.TimeoutException:
            logger.error(f"Western Union API timeout: {endpoint}")
            raise WesternUnionError(code="TIMEOUT", message="Request timed out")
        except httpx.NetworkError as e:
            logger.error(f"Western Union API network error: {str(e)}")
            raise WesternUnionError(code="NETWORK_ERROR", message=str(e))
        except WesternUnionError:
            raise
        except Exception as e:
            logger.error(f"Western Union API error: {str(e)}")
            raise WesternUnionError(code="UNKNOWN_ERROR", message=str(e))
    
    async def create_transaction(self, sender: Dict, receiver: Dict, amount: float, currency: str, purpose: str) -> Dict:
        payload = {
            "partnerId": self.partner_id,
            "sender": sender,
            "receiver": receiver,
            "amount": amount,
            "currency": currency,
            "purpose": purpose,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        logger.info(f"Creating Western Union transaction: {amount} {currency}")
        response = await self._make_request("POST", "/v1/transactions", payload)
        
        return {
            "transaction_id": response["transactionId"],
            "mtcn": response["mtcn"],
            "status": response["status"],
            "amount": response["amount"],
            "currency": response["currency"],
            "fees": response.get("fees", 0)
        }
    
    async def get_transaction_status(self, mtcn: str) -> Dict:
        logger.info(f"Querying Western Union transaction: {mtcn}")
        response = await self._make_request("GET", f"/v1/transactions/{mtcn}")
        
        return {
            "mtcn": mtcn,
            "status": response["status"],
            "amount": response.get("amount"),
            "currency": response.get("currency"),
            "updated_at": response.get("updatedAt")
        }
    
    async def get_exchange_rate(self, from_currency: str, to_currency: str, amount: float) -> Dict:
        payload = {
            "fromCurrency": from_currency,
            "toCurrency": to_currency,
            "amount": amount
        }
        
        logger.info(f"Fetching Western Union exchange rate: {from_currency}/{to_currency}")
        response = await self._make_request("POST", "/v1/rates", payload)
        
        return {
            "from_currency": from_currency,
            "to_currency": to_currency,
            "rate": response["rate"],
            "amount": amount,
            "converted_amount": response["convertedAmount"],
            "fees": response.get("fees", 0)
        }
    
    async def close(self):
        await self.client.aclose()
        logger.info("Western Union client closed")
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
