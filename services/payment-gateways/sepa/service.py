"""
SEPA Payment Gateway Service
"""

from .client import SEPAClient
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
            "Refusing to start the sepa gateway without real credentials."
        )
    return value


class SepaService:
    def __init__(self):
        self.client = SEPAClient(
            api_key=_require_env("SEPA_API_KEY"),
            creditor_id=_require_env("SEPA_CREDITOR_ID"),
            creditor_iban=_require_env("SEPA_CREDITOR_IBAN"),
            base_url=os.getenv("SEPA_BASE_URL", "https://api.sepa.eu"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Create a SEPA Credit Transfer.

        transfer_data keys: debtor_iban, debtor_name, amount, currency,
        reference, remittance_info (optional), debtor_bic (optional).
        """
        try:
            result = await self.client.create_credit_transfer(
                debtor_iban=transfer_data["debtor_iban"],
                debtor_name=transfer_data["debtor_name"],
                amount=transfer_data["amount"],
                currency=transfer_data.get("currency", "EUR"),
                reference=transfer_data["reference"],
                remittance_info=transfer_data.get("remittance_info", "Remittance payout"),
                debtor_bic=transfer_data.get("debtor_bic"),
            )
            return {
                "success": True,
                "gateway": "sepa",
                "transfer_id": result.get("transaction_id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "sepa",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check transaction status"""
        try:
            result = await self.client.get_transaction_status(transfer_id)
            return {
                "success": True,
                "gateway": "sepa",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "sepa",
                "error": str(e)
            }
