"""
PAYSTACK Payment Gateway Service
"""

from .client import PaystackClient
from typing import Dict
import os

_PLACEHOLDER_VALUES = {"test_key", "sk_test_xxx", "pk_test_xxx", "changeme", "change_me", "placeholder"}


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
            "Refusing to start the paystack gateway without real credentials."
        )
    return value


class PaystackService:
    def __init__(self):
        self.client = PaystackClient(
            secret_key=_require_env("PAYSTACK_SECRET_KEY"),
            public_key=os.getenv("PAYSTACK_PUBLIC_KEY") or None,
            base_url=os.getenv("PAYSTACK_BASE_URL", "https://api.paystack.co"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a transfer through paystack.

        transfer_data keys: amount (int, kobo/pesewas minor units),
        recipient_code, reason, reference (optional), currency
        (optional, default NGN).
        """
        try:
            result = await self.client.initiate_transfer(
                amount=int(transfer_data["amount"]),
                recipient_code=transfer_data["recipient_code"],
                reason=transfer_data.get("reason", "Remittance payout"),
                reference=transfer_data.get("reference"),
                currency=transfer_data.get("currency", "NGN"),
            )
            return {
                "success": True,
                "gateway": "paystack",
                "transfer_id": result.get("transfer_code"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "paystack",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status by transfer_code"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "paystack",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "paystack",
                "error": str(e)
            }
