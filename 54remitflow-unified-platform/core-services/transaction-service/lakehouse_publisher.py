"""
Lakehouse Event Publisher for Transaction Service
Publishes transaction events to the lakehouse for analytics and AI/ML
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
    """
    Publishes transaction events to the lakehouse service.
    Events are sent asynchronously to avoid blocking transaction processing.
    """
    
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or LAKEHOUSE_URL
        self.enabled = LAKEHOUSE_ENABLED
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=10.0)
        return self._client
    
    async def publish_transaction_event(
        self,
        transaction_id: str,
        user_id: str,
        event_type: str,
        transaction_data: Dict[str, Any]
    ) -> bool:
        """
        Publish a transaction event to the lakehouse.
        
        Args:
            transaction_id: Unique transaction identifier
            user_id: User who initiated the transaction
            event_type: Type of event (created, updated, completed, failed)
            transaction_data: Full transaction data
        
        Returns:
            True if event was published successfully, False otherwise
        """
        if not self.enabled:
            logger.debug("Lakehouse publishing disabled")
            return True
        
        try:
            client = await self._get_client()
            
            # Determine corridor from currencies
            source_currency = transaction_data.get("currency", "NGN")
            dest_currency = transaction_data.get("destination_currency", source_currency)
            corridor = f"{source_currency[:2]}-{dest_currency[:2]}"
            
            event = {
                "event_type": "transaction",
                "event_id": f"txn_{transaction_id}_{event_type}_{datetime.utcnow().timestamp()}",
                "timestamp": datetime.utcnow().isoformat(),
                "source_service": "transaction-service",
                "payload": {
                    "transaction_id": transaction_id,
                    "user_id": user_id,
                    "event_type": event_type,
                    "amount": transaction_data.get("amount", 0),
                    "currency_from": source_currency,
                    "currency_to": dest_currency,
                    "corridor": corridor,
                    "status": transaction_data.get("status", "unknown"),
                    "gateway": transaction_data.get("gateway", transaction_data.get("delivery_method", "bank_transfer")),
                    "fee": transaction_data.get("fee", 0),
                    "exchange_rate": transaction_data.get("exchange_rate"),
                    "recipient_name": transaction_data.get("recipient_name"),
                    "recipient_bank": transaction_data.get("recipient_bank"),
                    "delivery_method": transaction_data.get("delivery_method"),
                    "idempotency_key": transaction_data.get("idempotency_key"),
                    "created_at": transaction_data.get("created_at"),
                    "updated_at": transaction_data.get("updated_at"),
                    "completed_at": transaction_data.get("completed_at")
                },
                "metadata": {
                    "service_version": "1.0.0",
                    "environment": os.getenv("ENVIRONMENT", "development")
                }
            }
            
            response = await client.post("/api/v1/ingest", json=event)
            
            if response.status_code == 200:
                logger.info(f"Published transaction event to lakehouse: {transaction_id} ({event_type})")
                return True
            else:
                logger.warning(f"Failed to publish to lakehouse: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"Error publishing to lakehouse: {e}")
            return False
    
    async def publish_transaction_created(self, transaction_id: str, user_id: str, data: Dict) -> bool:
        """Publish transaction created event"""
        return await self.publish_transaction_event(transaction_id, user_id, "created", data)
    
    async def publish_transaction_updated(self, transaction_id: str, user_id: str, data: Dict) -> bool:
        """Publish transaction updated event"""
        return await self.publish_transaction_event(transaction_id, user_id, "updated", data)
    
    async def publish_transaction_completed(self, transaction_id: str, user_id: str, data: Dict) -> bool:
        """Publish transaction completed event"""
        data["completed_at"] = datetime.utcnow().isoformat()
        return await self.publish_transaction_event(transaction_id, user_id, "completed", data)
    
    async def publish_transaction_failed(self, transaction_id: str, user_id: str, data: Dict, reason: str) -> bool:
        """Publish transaction failed event"""
        data["failure_reason"] = reason
        return await self.publish_transaction_event(transaction_id, user_id, "failed", data)
    
    async def close(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None


# Global publisher instance
_publisher: Optional[LakehousePublisher] = None


def get_lakehouse_publisher() -> LakehousePublisher:
    """Get or create the global lakehouse publisher instance"""
    global _publisher
    if _publisher is None:
        _publisher = LakehousePublisher()
    return _publisher


async def publish_transaction_to_lakehouse(
    transaction_id: str,
    user_id: str,
    event_type: str,
    transaction_data: Dict[str, Any]
) -> bool:
    """
    Convenience function to publish transaction events to lakehouse.
    This function is fire-and-forget - it won't block if lakehouse is unavailable.
    """
    publisher = get_lakehouse_publisher()
    
    # Run in background to avoid blocking
    try:
        return await asyncio.wait_for(
            publisher.publish_transaction_event(transaction_id, user_id, event_type, transaction_data),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        logger.warning(f"Lakehouse publish timed out for transaction {transaction_id}")
        return False
    except Exception as e:
        logger.error(f"Lakehouse publish error for transaction {transaction_id}: {e}")
        return False
