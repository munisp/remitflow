import httpx
from typing import Optional, Dict, Any

class RemitlyClient:
    def __init__(self, api_key: str, base_url: str = "https://api.remitly.com"):
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

    async def get_quote(self, source_currency: str, target_currency: str, amount: float) -> Dict[str, Any]:
        params = {
            "sourceCurrency": source_currency,
            "targetCurrency": target_currency,
            "amount": amount,
        }
        return await self._request("GET", "/v1/quotes", params=params)

    async def create_transfer(self, quote_id: str, recipient_id: str, customer_transaction_id: str) -> Dict[str, Any]:
        data = {
            "quoteId": quote_id,
            "recipientId": recipient_id,
            "customerTransactionId": customer_transaction_id,
        }
        return await self._request("POST", "/v1/transfers", json=data)

    async def get_transfer(self, transfer_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/v1/transfers/{transfer_id}")
