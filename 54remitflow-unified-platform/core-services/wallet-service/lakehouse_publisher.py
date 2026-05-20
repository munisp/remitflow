"""
Lakehouse Event Publisher for Wallet Service
Publishes wallet events to the lakehouse for analytics
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
    """Publishes wallet events to the lakehouse service."""
    
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or LAKEHOUSE_URL
        self.enabled = LAKEHOUSE_ENABLED
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=10.0)
        return self._client
    
    async def publish_wallet_event(
        self,
        user_id: str,
        wallet_id: str,
        event_type: str,
        wallet_data: Dict[str, Any]
    ) -> bool:
        """Publish a wallet event to the lakehouse."""
        if not self.enabled:
            return True
        
        try:
            client = await self._get_client()
            
            event = {
                "event_type": "wallet",
                "event_id": f"wallet_{wallet_id}_{event_type}_{datetime.utcnow().timestamp()}",
                "timestamp": datetime.utcnow().isoformat(),
                "source_service": "wallet-service",
                "payload": {
                    "user_id": user_id,
                    "wallet_id": wallet_id,
                    "event_type": event_type,
                    "amount": wallet_data.get("amount"),
                    "currency": wallet_data.get("currency"),
                    "balance_before": wallet_data.get("balance_before"),
                    "balance_after": wallet_data.get("balance_after"),
                    "transaction_type": wallet_data.get("transaction_type"),
                    "reference": wallet_data.get("reference")
                },
                "metadata": {
                    "service_version": "1.0.0",
                    "environment": os.getenv("ENVIRONMENT", "development")
                }
            }
            
            response = await client.post("/api/v1/ingest", json=event)
            
            if response.status_code == 200:
                logger.info(f"Published wallet event to lakehouse: {wallet_id} ({event_type})")
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


async def publish_wallet_to_lakehouse(
    user_id: str, wallet_id: str, event_type: str, wallet_data: Dict[str, Any]
) -> bool:
    """Convenience function to publish wallet events to lakehouse (fire-and-forget)."""
    publisher = get_lakehouse_publisher()
    try:
        return await asyncio.wait_for(
            publisher.publish_wallet_event(user_id, wallet_id, event_type, wallet_data),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        logger.warning(f"Lakehouse publish timed out for wallet event {wallet_id}")
        return False
    except Exception as e:
        logger.error(f"Lakehouse publish error for wallet event {wallet_id}: {e}")
        return False
