"""
Xoom Payment Gateway Client - Production Implementation
"""

import httpx
import json
import logging
from typing import Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

class XoomError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"Xoom Error {code}: {message}")

class XoomClient:
    def __init__(self, api_key: str, base_url: str = "https://api.xoom.com", timeout: int = 30):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.client = httpx.AsyncClient(
            timeout=timeout,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100)
        )
        logger.info("Xoom client initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    async def _make_request(self, method: str, endpoint: str, payload: Optional[Dict] = None) -> Dict:
        url = f"{self.base_url}{endpoint}"
        headers = self._get_headers()
        
        try:
            logger.info(f"Xoom API request: {method} {endpoint}")
            
            if method.upper() == "POST":
                response = await self.client.post(url, json=payload, headers=headers)
            elif method.upper() == "GET":
                response = await self.client.get(url, headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            logger.info(f"Xoom API response: {response.status_code}")
            data = response.json()
            
            if response.status_code != 200:
                raise XoomError(
                    code=data.get("errorCode", str(response.status_code)),
                    message=data.get("message", "Request failed"),
                    details=data
                )
            
            return data
            
        except httpx.TimeoutException:
            raise XoomError(code="TIMEOUT", message="Request timed out")
        except httpx.NetworkError as e:
            raise XoomError(code="NETWORK_ERROR", message=str(e))
        except XoomError:
            raise
        except Exception as e:
            raise XoomError(code="UNKNOWN_ERROR", message=str(e))
    
    async def create_transfer(self, amount: float, currency: str, recipient: Dict, reference: str) -> Dict:
        payload = {
            "amount": amount,
            "currency": currency,
            "recipient": recipient,
            "reference": reference,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        logger.info(f"Creating Xoom transfer: {amount} {currency}")
        response = await self._make_request("POST", "/v1/transfers", payload)
        
        return {
            "transfer_id": response["id"],
            "status": response["status"],
            "amount": response["amount"],
            "currency": response["currency"]
        }
    
    async def get_transfer_status(self, transfer_id: str) -> Dict:
        logger.info(f"Querying Xoom transfer: {transfer_id}")
        response = await self._make_request("GET", f"/v1/transfers/{transfer_id}")
        
        return {
            "transfer_id": transfer_id,
            "status": response["status"],
            "amount": response.get("amount"),
            "currency": response.get("currency")
        }
    
    async def close(self):
        await self.client.aclose()
        logger.info("Xoom client closed")
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
