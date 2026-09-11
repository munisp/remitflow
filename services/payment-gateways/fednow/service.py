"""
FEDNOW Payment Gateway Service
"""

from .client import FednowClient
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
            "Refusing to start the fednow gateway without real credentials."
        )
    return value


class FednowService:
    def __init__(self):
        self.client = FednowClient(
            api_key=_require_env("FEDNOW_API_KEY")
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a transfer through fednow.

        transfer_data keys: amount, currency, recipient (dict),
        reference (unique caller-supplied reference).
        """
        try:
            result = await self.client.initiate_transfer(transfer_data)
            return {
                "success": True,
                "gateway": "fednow",
                "transfer_id": str(result.get("id")),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "fednow",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "fednow",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "fednow",
                "error": str(e)
            }
