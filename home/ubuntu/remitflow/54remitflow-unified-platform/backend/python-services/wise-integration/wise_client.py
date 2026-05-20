
import httpx
from typing import Optional, Dict, Any

class WiseClient:
    def __init__(self, api_key: str, base_url: str = "https://api.wise.com"):
        self.api_key = api_key
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                f"{self.base_url}{endpoint}",
                headers=self.headers,
                **kwargs,
            )
            response.raise_for_status()
            return response.json()

    async def create_quote(self, profile_id: str, source_currency: str, target_currency: str, source_amount: Optional[float] = None, target_amount: Optional[float] = None) -> Dict[str, Any]:
        data = {
            "profile": profile_id,
            "source": source_currency,
            "target": target_currency,
            "rateType": "FIXED",
        }
        if source_amount:
            data["sourceAmount"] = source_amount
        elif target_amount:
            data["targetAmount"] = target_amount
        else:
            raise ValueError("Either source_amount or target_amount must be provided.")
        
        return await self._request("POST", "/v1/quotes", json=data)

    async def create_recipient(self, profile_id: str, currency: str, details: Dict[str, Any]) -> Dict[str, Any]:
        data = {
            "profile": profile_id,
            "currency": currency,
            "type": details.get("type", "iban"),
            "details": details,
        }
        return await self._request("POST", "/v1/accounts", json=data)

    async def create_transfer(self, quote_id: str, recipient_id: str, customer_transaction_id: str) -> Dict[str, Any]:
        data = {
            "targetAccount": recipient_id,
            "quote": quote_id,
            "customerTransactionId": customer_transaction_id,
        }
        return await self._request("POST", "/v1/transfers", json=data)

    async def get_transfer(self, transfer_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/v1/transfers/{transfer_id}")
