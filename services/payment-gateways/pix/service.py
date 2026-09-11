"""
PIX Payment Gateway Service
"""

from .client import PIXClient
from typing import Dict
import os

_PLACEHOLDER_VALUES = {"test_key", "changeme", "change_me", "placeholder", "your_api_key_here"}


def _require_env(name: str) -> str:
    """Read a required credential from the environment.

    Fails fast at startup if the variable is unset, empty, or still a
    known placeholder value -- never fall back to a fake credential on a
    money path.
    """
    value = os.getenv(name)
    if not value or value.strip().lower() in _PLACEHOLDER_VALUES:
        raise RuntimeError(
            f"Missing required configuration: {name} is unset or a placeholder. "
            "Refusing to start the pix gateway without real credentials."
        )
    return value


class PixService:
    def __init__(self):
        self.client = PIXClient(
            client_id=_require_env("PIX_CLIENT_ID"),
            client_secret=_require_env("PIX_CLIENT_SECRET"),
            certificate_path=_require_env("PIX_CERTIFICATE_PATH"),
            pix_key=_require_env("PIX_KEY"),
            base_url=os.getenv("PIX_BASE_URL", "https://api.pix.bcb.gov.br"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Send a PIX payout.

        transfer_data keys: pix_key (recipient DICT key), amount,
        description (optional).
        """
        try:
            result = await self.client.send_pix(
                pix_key=transfer_data["pix_key"],
                amount=transfer_data["amount"],
                description=transfer_data.get("description", "Remittance payout"),
            )
            return {
                "success": True,
                "gateway": "pix",
                "transfer_id": result.get("end_to_end_id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "pix",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check PIX payment status by txid"""
        try:
            result = await self.client.get_payment_status(txid=transfer_id)
            return {
                "success": True,
                "gateway": "pix",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "pix",
                "error": str(e)
            }
