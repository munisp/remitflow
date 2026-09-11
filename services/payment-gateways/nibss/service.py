"""
NIBSS Payment Gateway Service
"""

from .client import NIBSSClient, NIBSSTransferType
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
            "Refusing to start the nibss gateway without real credentials."
        )
    return value


class NibssService:
    def __init__(self):
        self.client = NIBSSClient(
            api_key=_require_env("NIBSS_API_KEY"),
            secret_key=_require_env("NIBSS_SECRET_KEY"),
            institution_code=_require_env("NIBSS_INSTITUTION_CODE"),
            base_url=os.getenv("NIBSS_BASE_URL", "https://api.nibss-plc.com.ng"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a NIP transfer through nibss.

        transfer_data keys: source_account, destination_account,
        destination_bank_code, amount, narration, beneficiary_name,
        reference (unique transaction reference); optional transfer_type
        ("NIP" default, "RTGS", "NEFT").
        """
        try:
            transfer_type = NIBSSTransferType(
                transfer_data.get("transfer_type", "NIP")
            )
            result = await self.client.initiate_transfer(
                source_account=transfer_data["source_account"],
                destination_account=transfer_data["destination_account"],
                destination_bank_code=transfer_data["destination_bank_code"],
                amount=transfer_data["amount"],
                narration=transfer_data.get("narration", "Remittance payout"),
                beneficiary_name=transfer_data["beneficiary_name"],
                reference=transfer_data["reference"],
                transfer_type=transfer_type,
            )
            return {
                "success": True,
                "gateway": "nibss",
                "transfer_id": result.get("transaction_id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "nibss",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status by NIBSS session ID"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "nibss",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "nibss",
                "error": str(e)
            }
