from typing import Any, Optional

from pydantic import BaseModel


class UserEvent(BaseModel):
    """Documents the Kafka event shape published by KafkaClient's helper
    methods (reference/contract, not what's used to build the event dict)."""

    type: str
    user_id: Optional[str] = None
    tenant_id: str
    status: Optional[str] = None
    timestamp: str
    metadata: dict[str, Any] = {}
