"""
MTN-MOMO Payment Gateway Client
"""

import httpx
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Explicit per-rail timeouts (seconds). Payout POSTs get a longer read
# window than status/rate reads.
TRANSFER_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)
READ_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)


class MtnMomoError(Exception):
    """Provider error for the mtn-momo rail."""
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"mtn-momo Error {code}: {message}")


class MtnMomoClient:
    def __init__(self, api_key: str, base_url: str = "https://api.mtn-momo.com"):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=TRANSFER_TIMEOUT)

    def _headers(self) -> Dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    async def _request(self, method: str, path: str, body: Optional[Dict] = None,
                       expected_field: Optional[str] = None,
                       timeout: httpx.Timeout = TRANSFER_TIMEOUT) -> Dict:
        """Fail-closed request helper: raises on HTTP errors and on
        responses missing the expected success field."""
        try:
            response = await self.client.request(
                method, f"{self.base_url}{path}",
                json=body, headers=self._headers(), timeout=timeout
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            body_text = e.response.text[:500] if e.response is not None else ""
            logger.error(f"mtn-momo HTTP {e.response.status_code} on {path}: {body_text}")
            raise MtnMomoError(
                code=str(e.response.status_code),
                message=f"mtn-momo provider rejected the request",
                details={"path": path, "body": body_text}
            )
        except httpx.TimeoutException:
            logger.error(f"mtn-momo timeout on {path}")
            raise MtnMomoError(code="TIMEOUT", message=f"Request to mtn-momo timed out", details={"path": path})
        except httpx.HTTPError as e:
            logger.error(f"mtn-momo network error on {path}: {e}")
            raise MtnMomoError(code="NETWORK_ERROR", message=str(e), details={"path": path})

        try:
            data = response.json()
        except ValueError:
            raise MtnMomoError(code="INVALID_RESPONSE", message="Non-JSON response from provider")

        if expected_field is not None and expected_field not in data:
            raise MtnMomoError(
                code="INVALID_RESPONSE",
                message=f"Provider response missing expected field '{expected_field}'",
                details={"path": path, "body": data}
            )
        return data

    async def initiate_transfer(self, data: Dict) -> Dict:
        """Initiate a transfer"""
        return await self._request("POST", "/v1/transfers", body=data, expected_field="id")

    async def get_transfer_status(self, transfer_id: str) -> Dict:
        """Get transfer status"""
        return await self._request("GET", f"/v1/transfers/{transfer_id}",
                                   expected_field="status", timeout=READ_TIMEOUT)

    async def get_exchange_rate(self, from_currency: str, to_currency: str) -> Dict:
        """Get exchange rate"""
        return await self._request("GET", f"/v1/rates/{from_currency}/{to_currency}",
                                   timeout=READ_TIMEOUT)

    async def close(self):
        await self.client.aclose()
