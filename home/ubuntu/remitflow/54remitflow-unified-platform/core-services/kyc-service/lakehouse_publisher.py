"""
Lakehouse Event Publisher for KYC Service
Publishes KYC verification events to the lakehouse for analytics and compliance
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
    """Publishes KYC events to the lakehouse service."""
    
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or LAKEHOUSE_URL
        self.enabled = LAKEHOUSE_ENABLED
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=10.0)
        return self._client
    
    async def publish_kyc_event(
        self,
        user_id: str,
        event_type: str,
        kyc_data: Dict[str, Any]
    ) -> bool:
        """Publish a KYC event to the lakehouse."""
        if not self.enabled:
            return True
        
        try:
            client = await self._get_client()
            
            event = {
                "event_type": "kyc",
                "event_id": f"kyc_{user_id}_{event_type}_{datetime.utcnow().timestamp()}",
                "timestamp": datetime.utcnow().isoformat(),
                "source_service": "kyc-service",
                "payload": {
                    "user_id": user_id,
                    "event_type": event_type,
                    "kyc_level": kyc_data.get("kyc_level"),
                    "verification_status": kyc_data.get("status"),
                    "document_type": kyc_data.get("document_type"),
                    "verification_method": kyc_data.get("verification_method"),
                    "rejection_reason": kyc_data.get("rejection_reason"),
                    "country": kyc_data.get("country"),
                    "risk_score": kyc_data.get("risk_score")
                },
                "metadata": {
                    "service_version": "1.0.0",
                    "environment": os.getenv("ENVIRONMENT", "development")
                }
            }
            
            response = await client.post("/api/v1/ingest", json=event)
            
            if response.status_code == 200:
                logger.info(f"Published KYC event to lakehouse: {user_id} ({event_type})")
                return True
            return False
                
        except Exception as e:
            logger.error(f"Error publishing to lakehouse: {e}")
            return False
    
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


async def publish_kyc_to_lakehouse(user_id: str, event_type: str, kyc_data: Dict[str, Any]) -> bool:
    """Convenience function to publish KYC events to lakehouse (fire-and-forget)."""
    publisher = get_lakehouse_publisher()
    try:
        return await asyncio.wait_for(
            publisher.publish_kyc_event(user_id, event_type, kyc_data),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        logger.warning(f"Lakehouse publish timed out for KYC event {user_id}")
        return False
    except Exception as e:
        logger.error(f"Lakehouse publish error for KYC event {user_id}: {e}")
        return False
