"""
WISE Payment Gateway Service
"""

from .client import WiseClient
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
            "Refusing to start the wise gateway without real credentials."
        )
    return value


class WiseService:
    def __init__(self):
        self.client = WiseClient(
            api_key=_require_env("WISE_API_KEY"),
            profile_id=_require_env("WISE_PROFILE_ID"),
            base_url=os.getenv("WISE_BASE_URL", "https://api.wise.com"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a transfer through wise (quote -> recipient -> transfer).

        transfer_data keys: source_currency, target_currency, amount
        (source amount), reference (unique customerTransactionId — this
        is Wise's idempotency key), recipient: {account_holder_name,
        currency, type, details}. If pre-created quote_id/recipient_id
        are supplied they are used directly.
        """
        try:
            quote_id = transfer_data.get("quote_id")
            recipient_id = transfer_data.get("recipient_id")

            if not quote_id:
                quote = await self.client.create_quote(
                    source_currency=transfer_data["source_currency"],
                    target_currency=transfer_data["target_currency"],
                    source_amount=transfer_data["amount"],
                )
                quote_id = quote["quote_id"]

            if not recipient_id:
                recipient_data = transfer_data["recipient"]
                recipient = await self.client.create_recipient(
                    currency=recipient_data["currency"],
                    type=recipient_data["type"],
                    account_holder_name=recipient_data["account_holder_name"],
                    details=recipient_data["details"],
                )
                recipient_id = recipient["recipient_id"]

            result = await self.client.create_transfer(
                quote_id=quote_id,
                recipient_id=recipient_id,
                reference=transfer_data["reference"],
            )
            return {
                "success": True,
                "gateway": "wise",
                "transfer_id": str(result.get("transfer_id")),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "wise",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "wise",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "wise",
                "error": str(e)
            }
