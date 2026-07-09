import threading

from schemas.v1 import AuditEventSchema, Context
from utils.config import get_config
from utils.external_api_client import ExternalAPIClient
from utils.helpers import create_logger

logger = create_logger(__name__)
config = get_config()


class AuditServiceAdapter:
    """Explicit business-event audit logging (distinct from the automatic
    per-request AuditMiddleware) — used for specific, richly-labeled events
    like LOGIN / OTP_VERIFIED. Fire-and-forget: never blocks or fails the
    calling request."""

    def create_audit(self, payload: AuditEventSchema, context: Context) -> None:
        def _send():
            try:
                client = ExternalAPIClient(
                    base_url=config.AUDIT_SVC_URL,
                    headers={
                        "x-tenant-id": context.tenant_id,
                        "x-keycloak-id": "system",
                        "Content-Type": "application/json",
                    },
                )
                client._post(endpoint="/audits", data=payload.model_dump(), get_response=False)
            except Exception as e:
                logger.debug(f"Audit event delivery failed (non-fatal): {e}")

        threading.Thread(target=_send, daemon=True).start()
