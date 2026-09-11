"""
M-PESA Payment Gateway Service
"""

from .client import MPesaClient
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
            "Refusing to start the m-pesa gateway without real credentials."
        )
    return value


class MPesaService:
    """M-Pesa payout rail (B2C disbursements) and STK collections.

    Required environment variables:
        MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
        MPESA_PASSKEY  -- Daraja app credentials
        MPESA_INITIATOR_NAME, MPESA_SECURITY_CREDENTIAL  -- B2C initiator
            (SecurityCredential is the initiator password encrypted with
            the M-Pesa public key)
        MPESA_RESULT_URL, MPESA_TIMEOUT_URL  -- B2C callbacks pointing at
            OUR webhook ingress (never api.safaricom.co.ke)
        MPESA_CALLBACK_URL  -- STK push callback on our ingress
    """

    def __init__(self):
        self.client = MPesaClient(
            consumer_key=_require_env("MPESA_CONSUMER_KEY"),
            consumer_secret=_require_env("MPESA_CONSUMER_SECRET"),
            shortcode=_require_env("MPESA_SHORTCODE"),
            passkey=_require_env("MPESA_PASSKEY"),
            base_url=os.getenv("MPESA_BASE_URL", "https://api.safaricom.co.ke"),
            initiator_name=_require_env("MPESA_INITIATOR_NAME"),
            security_credential=_require_env("MPESA_SECURITY_CREDENTIAL"),
            result_url=_require_env("MPESA_RESULT_URL"),
            timeout_url=_require_env("MPESA_TIMEOUT_URL"),
        )
        self.callback_url = _require_env("MPESA_CALLBACK_URL")

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a B2C payout through m-pesa.

        transfer_data keys: phone_number (recipient MSISDN), amount (int
        KES), remarks (optional), occasion (optional), command_id
        (optional, default BusinessPayment). Disbursement confirmation
        arrives asynchronously on MPESA_RESULT_URL.
        """
        try:
            result = await self.client.b2c_payment(
                phone_number=transfer_data["phone_number"],
                amount=int(transfer_data["amount"]),
                remarks=transfer_data.get("remarks", "Remittance payout"),
                occasion=transfer_data.get("occasion", "Payout"),
                command_id=transfer_data.get("command_id", "BusinessPayment"),
            )
            return {
                "success": True,
                "gateway": "m-pesa",
                "transfer_id": result.get("conversation_id"),
                "status": "pending",
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "m-pesa",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check status of an STK push by CheckoutRequestID.

        B2C payouts are confirmed via the ResultURL callback; this query
        covers STK collection requests.
        """
        try:
            result = await self.client.query_stk_status(checkout_request_id=transfer_id)
            return {
                "success": True,
                "gateway": "m-pesa",
                "status": result.get("result_code"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "m-pesa",
                "error": str(e)
            }
