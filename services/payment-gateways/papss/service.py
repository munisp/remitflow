"""
PAPSS Payment Gateway Service
"""

from .client import PAPSSClient
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
            "Refusing to start the papss gateway without real credentials."
        )
    return value


class PapssService:
    def __init__(self):
        self.client = PAPSSClient(
            api_key=_require_env("PAPSS_API_KEY"),
            secret_key=_require_env("PAPSS_SECRET_KEY"),
            institution_id=_require_env("PAPSS_INSTITUTION_ID"),
            base_url=os.getenv("PAPSS_BASE_URL", "https://api.papss.com"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a cross-border transfer through papss.

        transfer_data keys: source_account, destination_account, amount,
        currency, destination_currency, beneficiary_name, reference;
        optional narration.
        """
        try:
            result = await self.client.initiate_transfer(
                source_account=transfer_data["source_account"],
                destination_account=transfer_data["destination_account"],
                amount=transfer_data["amount"],
                currency=transfer_data["currency"],
                destination_currency=transfer_data["destination_currency"],
                beneficiary_name=transfer_data["beneficiary_name"],
                reference=transfer_data["reference"],
                narration=transfer_data.get("narration", "Remittance payout"),
            )
            return {
                "success": True,
                "gateway": "papss",
                "transfer_id": result.get("transfer_id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "papss",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "papss",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "papss",
                "error": str(e)
            }
