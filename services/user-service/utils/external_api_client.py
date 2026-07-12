from typing import Any, Optional

import requests

from utils.errors import ApiError
from utils.helpers import create_logger

logger = create_logger(__name__)


class ExternalAPIClient:
    """Thin wrapper over `requests` for calling other internal services.
    `get_response=False` returns `{"status_code": ..., "body": ...}` instead
    of the parsed JSON body — useful when the caller only needs the status
    (e.g. Keycloak's 201/409/204-style responses)."""

    def __init__(self, base_url: str, headers: Optional[dict] = None, timeout: int = 15):
        self.base_url = base_url.rstrip("/")
        self.headers = headers or {}
        self.timeout = timeout

    def _request(
        self,
        method: str,
        endpoint: str,
        data: Any = None,
        params: Optional[dict] = None,
        headers: Optional[dict] = None,
        get_response: bool = True,
    ):
        url = f"{self.base_url}{endpoint}"
        req_headers = {**self.headers, **(headers or {})}

        try:
            if isinstance(data, str):
                response = requests.request(
                    method, url, data=data, params=params, headers=req_headers, timeout=self.timeout
                )
            else:
                response = requests.request(
                    method, url, json=data, params=params, headers=req_headers, timeout=self.timeout
                )
        except requests.RequestException as exc:
            logger.error(f"{method} {url} failed: {exc}")
            raise ApiError(
                message=f"Request to {url} failed: {exc}",
                status_code=502,
                code="EXT-API-CONN-5020",
            )

        if not get_response:
            try:
                body = response.json()
            except ValueError:
                body = response.text
            return {"status_code": response.status_code, "body": body}

        if response.status_code >= 400:
            try:
                body = response.json()
            except ValueError:
                body = {"detail": response.text}
            raise ApiError(
                message=body.get("message", f"{method} {url} returned {response.status_code}")
                if isinstance(body, dict) else str(body),
                status_code=response.status_code,
                code="EXT-API-ERR-4000",
                payload=body if isinstance(body, dict) else {"detail": body},
            )

        try:
            return response.json()
        except ValueError:
            return {}

    def _get(self, endpoint: str, params: Optional[dict] = None, headers: Optional[dict] = None, get_response: bool = True):
        return self._request("GET", endpoint, params=params, headers=headers, get_response=get_response)

    def _post(self, endpoint: str, data: Any = None, headers: Optional[dict] = None, get_response: bool = True):
        return self._request("POST", endpoint, data=data, headers=headers, get_response=get_response)

    def _put(self, endpoint: str, data: Any = None, headers: Optional[dict] = None, get_response: bool = True):
        return self._request("PUT", endpoint, data=data, headers=headers, get_response=get_response)

    def _patch(self, endpoint: str, data: Any = None, headers: Optional[dict] = None, get_response: bool = True):
        return self._request("PATCH", endpoint, data=data, headers=headers, get_response=get_response)

    def _delete(self, endpoint: str, headers: Optional[dict] = None, get_response: bool = True):
        return self._request("DELETE", endpoint, headers=headers, get_response=get_response)
