"""
WESTERN-UNION Payment Gateway Service
"""

from .client import WesternUnionClient
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
            "Refusing to start the western-union gateway without real credentials."
        )
    return value


class WesternUnionService:
    def __init__(self):
        self.client = WesternUnionClient(
            api_key=_require_env("WESTERN_UNION_API_KEY"),
            secret_key=_require_env("WESTERN_UNION_SECRET_KEY"),
            partner_id=_require_env("WESTERN_UNION_PARTNER_ID"),
            base_url=os.getenv("WESTERN_UNION_BASE_URL", "https://api.westernunion.com"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Create a Western Union transaction.

        transfer_data keys: sender (dict), receiver (dict), amount,
        currency, purpose (optional).
        """
        try:
            result = await self.client.create_transaction(
                sender=transfer_data["sender"],
                receiver=transfer_data["receiver"],
                amount=transfer_data["amount"],
                currency=transfer_data["currency"],
                purpose=transfer_data.get("purpose", "Remittance payout"),
            )
            return {
                "success": True,
                "gateway": "western-union",
                "transfer_id": result.get("mtcn"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "western-union",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transaction status by MTCN"""
        try:
            result = await self.client.get_transaction_status(transfer_id)
            return {
                "success": True,
                "gateway": "western-union",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "western-union",
                "error": str(e)
            }
