"""
STRIPE Payment Gateway Service
"""

from .client import StripeClient
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
            "Refusing to start the stripe gateway without real credentials."
        )
    return value


class StripeService:
    def __init__(self):
        self.client = StripeClient(
            api_key=_require_env("STRIPE_API_KEY"),
            base_url=os.getenv("STRIPE_BASE_URL", "https://api.stripe.com"),
        )

    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Create (and optionally confirm) a Stripe PaymentIntent.

        transfer_data keys: amount (int, minor units), currency;
        optional: customer, metadata, payment_method (when supplied the
        intent is confirmed immediately), reference (used as the Stripe
        Idempotency-Key so retries never duplicate a charge).
        """
        try:
            result = await self.client.create_payment_intent(
                amount=int(transfer_data["amount"]),
                currency=transfer_data["currency"],
                customer=transfer_data.get("customer"),
                metadata=transfer_data.get("metadata"),
                idempotency_key=transfer_data.get("reference"),
            )
            payment_method = transfer_data.get("payment_method")
            if payment_method:
                result = await self.client.confirm_payment_intent(
                    payment_intent_id=result["payment_intent_id"],
                    payment_method=payment_method,
                )
            return {
                "success": True,
                "gateway": "stripe",
                "transfer_id": result.get("payment_intent_id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "stripe",
                "error": str(e)
            }

    async def check_status(self, transfer_id: str) -> Dict:
        """Check payment status by PaymentIntent ID"""
        try:
            result = await self.client.get_payment_intent(transfer_id)
            return {
                "success": True,
                "gateway": "stripe",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "stripe",
                "error": str(e)
            }
