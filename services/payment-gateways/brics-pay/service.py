"""
BRICS-PAY Payment Gateway Service
"""

from .client import BRICSPayClient
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
            "Refusing to start the brics-pay gateway without real credentials."
        )
    return value


class BricsPayService:
    def __init__(self):
        self.client = BRICSPayClient(
            api_key=_require_env("BRICS_PAY_API_KEY"),
            secret_key=_require_env("BRICS_PAY_SECRET_KEY"),
            merchant_id=_require_env("BRICS_PAY_MERCHANT_ID"),
            base_url=os.getenv("BRICS_PAY_BASE_URL", "https://api.brics-pay.com"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a cross-border transfer through brics-pay.

        transfer_data keys: source_currency, destination_currency,
        amount, source_account, destination_account, beneficiary_name,
        beneficiary_country, reference, purpose (optional).
        """
        try:
            result = await self.client.initiate_transfer(
                source_currency=transfer_data["source_currency"],
                destination_currency=transfer_data["destination_currency"],
                amount=transfer_data["amount"],
                source_account=transfer_data["source_account"],
                destination_account=transfer_data["destination_account"],
                beneficiary_name=transfer_data["beneficiary_name"],
                beneficiary_country=transfer_data["beneficiary_country"],
                reference=transfer_data["reference"],
                purpose=transfer_data.get("purpose", "Remittance payout"),
            )
            return {
                "success": True,
                "gateway": "brics-pay",
                "transfer_id": result.get("transfer_id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "brics-pay",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "brics-pay",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "brics-pay",
                "error": str(e)
            }
