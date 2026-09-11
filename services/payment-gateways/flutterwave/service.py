"""
FLUTTERWAVE Payment Gateway Service
"""

from .client import FlutterwaveClient
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
            "Refusing to start the flutterwave gateway without real credentials."
        )
    return value


class FlutterwaveService:
    def __init__(self):
        self.client = FlutterwaveClient(
            api_key=_require_env("FLUTTERWAVE_API_KEY"),
            secret_key=_require_env("FLUTTERWAVE_SECRET_KEY"),
            encryption_key=_require_env("FLUTTERWAVE_ENCRYPTION_KEY"),
            base_url=os.getenv("FLUTTERWAVE_BASE_URL", "https://api.flutterwave.com"),
            # Webhook ingress for transfer status callbacks — OUR host,
            # not api.flutterwave.com.
            callback_url=_require_env("FLUTTERWAVE_CALLBACK_URL"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a bank transfer through flutterwave.

        transfer_data keys: account_bank, account_number, amount,
        currency, reference, narration (optional), beneficiary_name
        (optional).
        """
        try:
            result = await self.client.initiate_transfer(
                account_bank=transfer_data["account_bank"],
                account_number=transfer_data["account_number"],
                amount=transfer_data["amount"],
                currency=transfer_data["currency"],
                narration=transfer_data.get("narration", "Remittance payout"),
                reference=transfer_data["reference"],
                beneficiary_name=transfer_data.get("beneficiary_name"),
            )
            return {
                "success": True,
                "gateway": "flutterwave",
                "transfer_id": str(result.get("transfer_id")),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "flutterwave",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "flutterwave",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "flutterwave",
                "error": str(e)
            }
