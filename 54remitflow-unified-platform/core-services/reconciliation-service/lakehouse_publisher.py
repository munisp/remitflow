"""
Lakehouse Event Publisher for Reconciliation Service
Publishes reconciliation events to the lakehouse for analytics
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
    """Publishes reconciliation events to the lakehouse service."""
    
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or LAKEHOUSE_URL
        self.enabled = LAKEHOUSE_ENABLED
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=10.0)
        return self._client
    
    async def publish_reconciliation_event(
        self,
        reconciliation_id: str,
        event_type: str,
        recon_data: Dict[str, Any]
    ) -> bool:
        """Publish a reconciliation event to the lakehouse."""
        if not self.enabled:
            return True
        
        try:
            client = await self._get_client()
            
            event = {
                "event_type": "reconciliation",
                "event_id": f"recon_{reconciliation_id}_{event_type}_{datetime.utcnow().timestamp()}",
                "timestamp": datetime.utcnow().isoformat(),
                "source_service": "reconciliation-service",
                "payload": {
                    "reconciliation_id": reconciliation_id,
                    "event_type": event_type,
                    "corridor": recon_data.get("corridor"),
                    "date": recon_data.get("date"),
                    "total_transactions": recon_data.get("total_transactions"),
                    "matched_count": recon_data.get("matched_count"),
                    "unmatched_count": recon_data.get("unmatched_count"),
                    "discrepancy_amount": recon_data.get("discrepancy_amount"),
                    "status": recon_data.get("status"),
                    "settlement_amount": recon_data.get("settlement_amount")
                },
                "metadata": {
                    "service_version": "1.0.0",
                    "environment": os.getenv("ENVIRONMENT", "development")
                }
            }
            
            response = await client.post("/api/v1/ingest", json=event)
            
            if response.status_code == 200:
                logger.info(f"Published reconciliation event to lakehouse: {reconciliation_id} ({event_type})")
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


async def publish_reconciliation_to_lakehouse(
    reconciliation_id: str, event_type: str, recon_data: Dict[str, Any]
) -> bool:
    """Convenience function to publish reconciliation events to lakehouse (fire-and-forget)."""
    publisher = get_lakehouse_publisher()
    try:
        return await asyncio.wait_for(
            publisher.publish_reconciliation_event(reconciliation_id, event_type, recon_data),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        logger.warning(f"Lakehouse publish timed out for reconciliation event {reconciliation_id}")
        return False
    except Exception as e:
        logger.error(f"Lakehouse publish error for reconciliation event {reconciliation_id}: {e}")
        return False
