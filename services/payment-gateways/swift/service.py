"""
SWIFT Payment Gateway Service
"""

from .client import SWIFTClient
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
            "Refusing to start the swift gateway without real credentials."
        )
    return value


class SwiftService:
    def __init__(self):
        self.client = SWIFTClient(
            api_key=_require_env("SWIFT_API_KEY"),
            bic_code=_require_env("SWIFT_BIC_CODE"),
            base_url=os.getenv("SWIFT_BASE_URL", "https://api.swift.com"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Initiate a SWIFT MT103 wire transfer.

        transfer_data keys: sender_account, receiver_account,
        receiver_bic, amount, currency, purpose, reference; optional:
        receiver_name, sender_name, intermediary_bic, charge_bearer.
        """
        try:
            result = await self.client.initiate_wire_transfer(
                sender_account=transfer_data["sender_account"],
                receiver_account=transfer_data["receiver_account"],
                receiver_bic=transfer_data["receiver_bic"],
                amount=transfer_data["amount"],
                currency=transfer_data["currency"],
                purpose=transfer_data.get("purpose", "Remittance"),
                reference=transfer_data["reference"],
                receiver_name=transfer_data.get("receiver_name"),
                sender_name=transfer_data.get("sender_name"),
                intermediary_bic=transfer_data.get("intermediary_bic"),
                charge_bearer=transfer_data.get("charge_bearer", "SHA"),
            )
            return {
                "success": True,
                "gateway": "swift",
                "transfer_id": result.get("transaction_id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "swift",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status by transaction ID (or UETR)"""
        try:
            result = await self.client.get_transfer_status(transaction_id=transfer_id)
            return {
                "success": True,
                "gateway": "swift",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "swift",
                "error": str(e)
            }
