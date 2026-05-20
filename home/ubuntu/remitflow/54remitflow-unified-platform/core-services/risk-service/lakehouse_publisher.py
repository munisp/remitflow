"""
Lakehouse Event Publisher for Risk Service
Publishes risk assessment events to the lakehouse for analytics and ML model training
"""

import httpx
import logging
import os
from typing import Dict, Any, Optional
from datetime import datetime
import asyncio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://lakehouse-service:8020")
LAKEHOUSE_ENABLED = os.getenv("LAKEHOUSE_ENABLED", "true").lower() == "true"


class LakehousePublisher:
    """Publishes risk events to the lakehouse service."""
    
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or LAKEHOUSE_URL
        self.enabled = LAKEHOUSE_ENABLED
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=10.0)
        return self._client
    
    async def publish_risk_event(
        self,
        request_id: str,
        user_id: str,
        event_type: str,
        risk_data: Dict[str, Any]
    ) -> bool:
        """Publish a risk assessment event to the lakehouse."""
        if not self.enabled:
            logger.debug("Lakehouse publishing disabled")
            return True
        
        try:
            client = await self._get_client()
            
            event = {
                "event_type": "risk",
                "event_id": f"risk_{request_id}_{event_type}_{datetime.utcnow().timestamp()}",
                "timestamp": datetime.utcnow().isoformat(),
                "source_service": "risk-service",
                "payload": {
                    "request_id": request_id,
                    "user_id": user_id,
                    "event_type": event_type,
                    "decision": risk_data.get("decision"),
                    "risk_score": risk_data.get("risk_score"),
                    "factors": risk_data.get("factors", []),
                    "corridor": risk_data.get("corridor"),
                    "amount": risk_data.get("amount"),
                    "currency": risk_data.get("currency"),
                    "requires_review": risk_data.get("requires_review", False),
                    "recommended_actions": risk_data.get("recommended_actions", [])
                },
                "metadata": {
                    "service_version": "1.0.0",
                    "environment": os.getenv("ENVIRONMENT", "development")
                }
            }
            
            response = await client.post("/api/v1/ingest", json=event)
            
            if response.status_code == 200:
                logger.info(f"Published risk event to lakehouse: {request_id} ({event_type})")
                return True
            else:
                logger.warning(f"Failed to publish to lakehouse: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Error publishing to lakehouse: {e}")
            return False
    
    async def publish_assessment(self, request_id: str, user_id: str, assessment_data: Dict) -> bool:
        """Publish risk assessment event"""
        return await self.publish_risk_event(request_id, user_id, "assessment", assessment_data)
    
    async def publish_velocity_check(self, user_id: str, velocity_data: Dict) -> bool:
        """Publish velocity check event"""
        return await self.publish_risk_event(f"velocity_{user_id}", user_id, "velocity_check", velocity_data)
    
    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None


_publisher: Optional[LakehousePublisher] = None


def get_lakehouse_publisher() -> LakehousePublisher:
    global _publisher
    if _publisher is None:
        _publisher = LakehousePublisher()
    return _publisher


async def publish_risk_to_lakehouse(
    request_id: str,
    user_id: str,
    event_type: str,
    risk_data: Dict[str, Any]
) -> bool:
    """Convenience function to publish risk events to lakehouse (fire-and-forget)."""
    publisher = get_lakehouse_publisher()
    try:
        return await asyncio.wait_for(
            publisher.publish_risk_event(request_id, user_id, event_type, risk_data),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        logger.warning(f"Lakehouse publish timed out for risk event {request_id}")
        return False
    except Exception as e:
        logger.error(f"Lakehouse publish error for risk event {request_id}: {e}")
        return False
