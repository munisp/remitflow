"""
PIX Payment Gateway Client - Production Implementation
Brazilian instant payment system
"""

import httpx
import logging
import time
import uuid
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Provider status values that mean the PIX payment is actually settled.
# Anything else reported by the PSP is treated as pending for
# reconciliation purposes -- never assume "completed".
PIX_CONFIRMED_STATUSES = {"completed", "concluida", "settled", "liquidated"}

# Refresh the OAuth token this many seconds before its stated expiry.
TOKEN_EXPIRY_SKEW_SECONDS = 60

class PIXError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"PIX Error {code}: {message}")

class PIXClient:
    def __init__(self, client_id: str, client_secret: str, certificate_path: str, pix_key: str, base_url: str = "https://api.pix.bcb.gov.br"):
        self.client_id = client_id
        self.client_secret = client_secret
        self.certificate_path = certificate_path
        # Receiving DICT key (phone/CPF/CNPJ/email/EVP) for collection
        # charges. NEVER reuse the OAuth client_id as the chave.
        if not pix_key:
            raise PIXError(code="CONFIG_ERROR", message="pix_key (receiving DICT key) is required")
        self.pix_key = pix_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30, cert=certificate_path)
        self.access_token = None
        self.token_expires_at = 0.0
        logger.info("PIX client initialized")

    async def _get_access_token(self, force_refresh: bool = False) -> str:
        """Get OAuth2 access token, refreshing at/before expiry"""
        if (
            not force_refresh
            and self.access_token
            and time.time() < self.token_expires_at
        ):
            return self.access_token

        try:
            response = await self.client.post(
                f"{self.base_url}/oauth/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret
                }
            )
            response.raise_for_status()
            data = response.json()
            self.access_token = data["access_token"]
            expires_in = int(data.get("expires_in", 3600))
            self.token_expires_at = time.time() + expires_in - TOKEN_EXPIRY_SKEW_SECONDS
            return self.access_token
        except Exception as e:
            logger.error(f"Access token error: {e}")
            raise PIXError(code="AUTH_ERROR", message=str(e))

    async def _authed_request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Authenticated request with one token-refresh retry on 401."""
        token = await self._get_access_token()
        headers = dict(kwargs.pop("headers", {}) or {})
        headers["Authorization"] = f"Bearer {token}"
        response = await self.client.request(method, url, headers=headers, **kwargs)
        if response.status_code == 401:
            logger.warning("PIX request returned 401; refreshing token once and retrying")
            token = await self._get_access_token(force_refresh=True)
            headers["Authorization"] = f"Bearer {token}"
            response = await self.client.request(method, url, headers=headers, **kwargs)
        return response
    
    async def create_qr_code(self, amount: float, description: str, payer_name: str = None, expiration_seconds: int = 3600) -> Dict:
        """Create PIX QR code for payment"""
        txid = str(uuid.uuid4()).replace("-", "")

        payload = {
            "calendario": {
                "expiracao": expiration_seconds
            },
            "valor": {
                "original": f"{amount:.2f}"
            },
            "chave": self.pix_key,
            "solicitacaoPagador": description
        }

        if payer_name:
            payload["devedor"] = {"nome": payer_name}

        try:
            response = await self._authed_request(
                "PUT",
                f"{self.base_url}/v2/cob/{txid}",
                json=payload
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "txid": data["txid"],
                "qr_code": data["pixCopiaECola"],
                "location": data["location"],
                "status": data["status"],
                "expiration": expiration_seconds
            }
        except httpx.HTTPStatusError as e:
            logger.error(f"PIX HTTP error: {e}")
            raise PIXError(code=str(e.response.status_code), message=str(e))
        except Exception as e:
            logger.error(f"PIX error: {e}")
            raise PIXError(code="INTERNAL_ERROR", message=str(e))
    
    async def get_payment_status(self, txid: str) -> Dict:
        """Get PIX payment status"""
        try:
            response = await self._authed_request(
                "GET",
                f"{self.base_url}/v2/cob/{txid}"
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "txid": data["txid"],
                "status": data["status"],
                "amount": float(data["valor"]["original"]),
                "payer": data.get("devedor", {}).get("nome"),
                "payment_time": data.get("pix", [{}])[0].get("horario") if data.get("pix") else None
            }
        except Exception as e:
            logger.error(f"Get status error: {e}")
            raise PIXError(code="STATUS_ERROR", message=str(e))
    
    async def send_pix(self, pix_key: str, amount: float, description: str) -> Dict:
        """Send PIX payment to key"""
        payload = {
            "chave": pix_key,
            "valor": f"{amount:.2f}",
            "descricao": description
        }

        try:
            response = await self._authed_request(
                "POST",
                f"{self.base_url}/v2/pix",
                json=payload
            )
            response.raise_for_status()
            data = response.json()

            # Map the provider's actual status. Only an explicitly
            # confirmed status is reported as completed; anything else
            # (queued/processing/unknown/absent) is pending and must be
            # reconciled asynchronously via get_payment_status.
            provider_status = data.get("status")
            if provider_status and str(provider_status).lower() in PIX_CONFIRMED_STATUSES:
                status = "completed"
            else:
                status = "pending"

            return {
                "end_to_end_id": data["endToEndId"],
                "txid": data.get("txid"),
                "amount": amount,
                "status": status,
                "provider_status": provider_status
            }
        except Exception as e:
            logger.error(f"Send PIX error: {e}")
            raise PIXError(code="SEND_ERROR", message=str(e))
    
    async def validate_pix_key(self, pix_key: str) -> Dict:
        """Validate PIX key"""
        try:
            response = await self._authed_request(
                "GET",
                f"{self.base_url}/v2/dict/key/{pix_key}"
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                "pix_key": pix_key,
                "key_type": data["tipo"],
                "account_holder": data["nome"],
                "is_valid": True
            }
        except Exception as e:
            logger.error(f"Validate key error: {e}")
            return {"pix_key": pix_key, "is_valid": False}
    
    async def close(self):
        await self.client.aclose()
