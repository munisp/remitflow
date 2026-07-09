from typing import Optional

from utils.config import get_config
from utils.helpers import create_logger

logger = create_logger(__name__)
config = get_config()

NEW_SUBSCRIBER_TOPIC = "core-54remit-new-subscriber"

_dapr_client = None


def _get_dapr_client():
    global _dapr_client
    if _dapr_client is None:
        from dapr.clients import DaprClient

        _dapr_client = DaprClient()
    return _dapr_client


class NotificationServiceAdapter:
    """Publishes new-subscriber events to the customer-engagement platform
    via the Dapr pub/sub sidecar. Not currently called from the auth-creation
    flow — available for a future integration (e.g. welcome-email/CRM sync)."""

    def create_subscriber(
        self,
        keycloak_id: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None,
    ) -> None:
        try:
            client = _get_dapr_client()
            client.publish_event(
                pubsub_name=config.DAPR_PUBSUB_NAME,
                topic_name=NEW_SUBSCRIBER_TOPIC,
                data={
                    "subscriberId": f"54remit_{keycloak_id}",
                    "traits": {
                        "firstName": first_name,
                        "lastName": last_name,
                        "email": email,
                        "phone": phone,
                    },
                },
                data_content_type="application/json",
            )
        except Exception as e:
            logger.warning(f"Failed to publish new-subscriber event (non-fatal): {e}")
