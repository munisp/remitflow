from typing import Any, Optional

from pydantic import BaseModel


class AdminEvent(BaseModel):
    """Documents the Kafka event shape published by KafkaClient's helper
    methods. The actual event dict is built ad-hoc in kafka_client.py — this
    model exists as a reference/contract for consumers."""

    type: str
    user_id: Optional[str] = None
    tenant_id: str
    status: Optional[str] = None
    timestamp: str
    metadata: dict[str, Any] = {}
