"""
Stripe Payment Gateway Client - Production Implementation
"""

import httpx
import logging
from typing import Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class StripeError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"Stripe Error {code}: {message}")

class StripeClient:
    def __init__(self, api_key: str, base_url: str = "https://api.stripe.com", timeout: int = 30):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.client = httpx.AsyncClient(
            timeout=timeout,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100)
        )
        logger.info("Stripe client initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Stripe-Version": "2023-10-16"
        }
    
    async def _make_request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict:
        url = f"{self.base_url}{endpoint}"
        headers = self._get_headers()
        
        try:
            logger.info(f"Stripe API request: {method} {endpoint}")
            
            if method.upper() == "POST":
                response = await self.client.post(url, data=data, headers=headers)
            elif method.upper() == "GET":
                response = await self.client.get(url, params=data, headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            logger.info(f"Stripe API response: {response.status_code}")
            result = response.json()
            
            if response.status_code != 200:
                raise StripeError(
                    code=result.get("error", {}).get("code", "unknown"),
                    message=result.get("error", {}).get("message", "Request failed"),
                    details=result
                )
            
            return result
            
        except httpx.TimeoutException:
            logger.error(f"Stripe API timeout: {endpoint}")
            raise StripeError(code="TIMEOUT", message="Request timed out", details={"endpoint": endpoint})
        except httpx.NetworkError as e:
            logger.error(f"Stripe API network error: {str(e)}")
            raise StripeError(code="NETWORK_ERROR", message=str(e))
        except StripeError:
            raise
        except Exception as e:
            logger.error(f"Stripe API error: {str(e)}")
            raise StripeError(code="UNKNOWN_ERROR", message=str(e))
    
    async def create_payment_intent(self, amount: int, currency: str, customer: str = None, metadata: Dict = None) -> Dict:
        data = {
            "amount": amount,
            "currency": currency.lower(),
            "automatic_payment_methods[enabled]": "true"
        }
        if customer:
            data["customer"] = customer
        if metadata:
            for key, value in metadata.items():
                data[f"metadata[{key}]"] = value
        
        logger.info(f"Creating Stripe payment intent: {amount} {currency}")
        response = await self._make_request("POST", "/v1/payment_intents", data)
        
        return {
            "payment_intent_id": response["id"],
            "client_secret": response["client_secret"],
            "status": response["status"],
            "amount": response["amount"],
            "currency": response["currency"]
        }
    
    async def confirm_payment_intent(self, payment_intent_id: str, payment_method: str) -> Dict:
        data = {"payment_method": payment_method}
        
        logger.info(f"Confirming Stripe payment intent: {payment_intent_id}")
        response = await self._make_request("POST", f"/v1/payment_intents/{payment_intent_id}/confirm", data)
        
        return {
            "payment_intent_id": response["id"],
            "status": response["status"],
            "amount": response["amount"],
            "currency": response["currency"]
        }
    
    async def create_customer(self, email: str, name: str = None, metadata: Dict = None) -> Dict:
        data = {"email": email}
        if name:
            data["name"] = name
        if metadata:
            for key, value in metadata.items():
                data[f"metadata[{key}]"] = value
        
        logger.info(f"Creating Stripe customer: {email}")
        response = await self._make_request("POST", "/v1/customers", data)
        
        return {
            "customer_id": response["id"],
            "email": response["email"],
            "name": response.get("name")
        }
    
    async def get_payment_intent(self, payment_intent_id: str) -> Dict:
        logger.info(f"Retrieving Stripe payment intent: {payment_intent_id}")
        response = await self._make_request("GET", f"/v1/payment_intents/{payment_intent_id}")
        
        return {
            "payment_intent_id": response["id"],
            "status": response["status"],
            "amount": response["amount"],
            "currency": response["currency"],
            "created": response["created"]
        }
    
    async def close(self):
        await self.client.aclose()
        logger.info("Stripe client closed")
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
