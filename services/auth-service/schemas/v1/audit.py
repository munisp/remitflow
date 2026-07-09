from typing import Any

from pydantic import BaseModel


class AuditEventSchema(BaseModel):
    actor_id: str
    tenant_id: str
    event_type: str
    event_data: dict[str, Any]
    timestamp: str
