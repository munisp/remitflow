"""
TigerBeetle to Kafka Event Bridge

Bridges TigerBeetle ledger operations to Kafka events for:
- Real-time event streaming
- Analytics and reporting
- Audit logging
- Cross-service coordination
- Mojaloop integration

This ensures all TigerBeetle operations are published to Kafka
for downstream consumers.
"""

import os
import logging
import asyncio
from typing import Dict, Any, Optional, List, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from functools import wraps

logger = logging.getLogger(__name__)

# Configuration
KAFKA_BRIDGE_ENABLED = os.getenv("KAFKA_BRIDGE_ENABLED", "true").lower() == "true"
FLUVIO_BRIDGE_ENABLED = os.getenv("FLUVIO_BRIDGE_ENABLED", "true").lower() == "true"
DAPR_BRIDGE_ENABLED = os.getenv("DAPR_BRIDGE_ENABLED", "true").lower() == "true"


class TigerBeetleEventType(str, Enum):
    """TigerBeetle event types"""
    # Account events
    ACCOUNT_CREATED = "ACCOUNT_CREATED"
    ACCOUNT_UPDATED = "ACCOUNT_UPDATED"
    ACCOUNT_CLOSED = "ACCOUNT_CLOSED"
    ACCOUNT_FROZEN = "ACCOUNT_FROZEN"
    ACCOUNT_UNFROZEN = "ACCOUNT_UNFROZEN"
    
    # Transfer events
    TRANSFER_CREATED = "TRANSFER_CREATED"
    TRANSFER_COMPLETED = "TRANSFER_COMPLETED"
    TRANSFER_FAILED = "TRANSFER_FAILED"
    
    # Pending transfer events
    PENDING_TRANSFER_CREATED = "PENDING_TRANSFER_CREATED"
    PENDING_TRANSFER_POSTED = "PENDING_TRANSFER_POSTED"
    PENDING_TRANSFER_VOIDED = "PENDING_TRANSFER_VOIDED"
    PENDING_TRANSFER_EXPIRED = "PENDING_TRANSFER_EXPIRED"
    
    # Linked transfer events
    LINKED_BATCH_CREATED = "LINKED_BATCH_CREATED"
    LINKED_BATCH_COMPLETED = "LINKED_BATCH_COMPLETED"
    LINKED_BATCH_FAILED = "LINKED_BATCH_FAILED"
    
    # Balance events
    BALANCE_UPDATED = "BALANCE_UPDATED"
    OVERDRAFT_PREVENTED = "OVERDRAFT_PREVENTED"
    
    # Reconciliation events
    RECONCILIATION_STARTED = "RECONCILIATION_STARTED"
    RECONCILIATION_COMPLETED = "RECONCILIATION_COMPLETED"
    RECONCILIATION_DISCREPANCY = "RECONCILIATION_DISCREPANCY"


@dataclass
class TigerBeetleEvent:
    """TigerBeetle event for publishing"""
    event_type: TigerBeetleEventType
    account_id: Optional[str] = None
    transfer_id: Optional[str] = None
    amount: Optional[int] = None
    currency: Optional[str] = None
    ledger: Optional[int] = None
    debit_account_id: Optional[str] = None
    credit_account_id: Optional[str] = None
    balance_before: Optional[int] = None
    balance_after: Optional[int] = None
    pending_id: Optional[str] = None
    batch_id: Optional[str] = None
    external_reference: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_type": self.event_type.value,
            "account_id": self.account_id,
            "transfer_id": self.transfer_id,
            "amount": self.amount,
            "currency": self.currency,
            "ledger": self.ledger,
            "debit_account_id": self.debit_account_id,
            "credit_account_id": self.credit_account_id,
            "balance_before": self.balance_before,
            "balance_after": self.balance_after,
            "pending_id": self.pending_id,
            "batch_id": self.batch_id,
            "external_reference": self.external_reference,
            "metadata": self.metadata,
            "timestamp": self.timestamp
        }


class TigerBeetleKafkaBridge:
    """
    Bridge between TigerBeetle operations and Kafka events
    
    Publishes all TigerBeetle operations to:
    - Kafka (primary event bus)
    - Fluvio (low-latency streaming)
    - Dapr pub/sub (service mesh)
    """
    
    def __init__(self):
        self._kafka_producer = None
        self._fluvio_producer = None
        self._dapr_client = None
        self._initialized = False
        self._event_handlers: List[Callable[[TigerBeetleEvent], Awaitable[None]]] = []
    
    async def initialize(self):
        """Initialize all event publishers"""
        if self._initialized:
            return
        
        # Initialize Kafka producer
        if KAFKA_BRIDGE_ENABLED:
            try:
                from .kafka_producer import get_kafka_producer
                self._kafka_producer = get_kafka_producer("tigerbeetle-bridge")
                await self._kafka_producer.initialize()
                logger.info("Kafka bridge initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize Kafka bridge: {e}")
        
        # Initialize Fluvio producer
        if FLUVIO_BRIDGE_ENABLED:
            try:
                from .fluvio_client import get_fluvio_producer
                self._fluvio_producer = get_fluvio_producer()
                logger.info("Fluvio bridge initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize Fluvio bridge: {e}")
        
        # Initialize Dapr client
        if DAPR_BRIDGE_ENABLED:
            try:
                from .dapr_client import get_dapr_client
                self._dapr_client = get_dapr_client()
                logger.info("Dapr bridge initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize Dapr bridge: {e}")
        
        self._initialized = True
    
    def add_event_handler(self, handler: Callable[[TigerBeetleEvent], Awaitable[None]]):
        """Add a custom event handler"""
        self._event_handlers.append(handler)
    
    async def publish_event(self, event: TigerBeetleEvent):
        """
        Publish a TigerBeetle event to all configured channels
        
        Args:
            event: The event to publish
        """
        if not self._initialized:
            await self.initialize()
        
        event_dict = event.to_dict()
        key = event.transfer_id or event.account_id or event.batch_id
        
        # Publish to Kafka
        if self._kafka_producer and KAFKA_BRIDGE_ENABLED:
            try:
                await self._kafka_producer.publish(
                    topic="TIGERBEETLE_EVENTS",
                    event_type=event.event_type.value,
                    data=event_dict,
                    key=key
                )
            except Exception as e:
                logger.error(f"Failed to publish to Kafka: {e}")
        
        # Publish to Fluvio
        if self._fluvio_producer and FLUVIO_BRIDGE_ENABLED:
            try:
                await self._fluvio_producer.send_tigerbeetle_event(
                    event_type=event.event_type.value,
                    account_id=event.account_id or "",
                    transfer_id=event.transfer_id,
                    data=event_dict
                )
            except Exception as e:
                logger.error(f"Failed to publish to Fluvio: {e}")
        
        # Publish to Dapr
        if self._dapr_client and DAPR_BRIDGE_ENABLED:
            try:
                await self._dapr_client.publish_tigerbeetle_event(
                    event_type=event.event_type.value,
                    account_id=event.account_id or "",
                    transfer_id=event.transfer_id,
                    data=event_dict
                )
            except Exception as e:
                logger.error(f"Failed to publish to Dapr: {e}")
        
        # Call custom handlers
        for handler in self._event_handlers:
            try:
                await handler(event)
            except Exception as e:
                logger.error(f"Event handler error: {e}")
    
    # ==================== Account Events ====================
    
    async def on_account_created(
        self,
        account_id: str,
        ledger: int,
        currency: str,
        flags: int,
        user_data: Optional[str] = None
    ):
        """Publish account created event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.ACCOUNT_CREATED,
            account_id=account_id,
            ledger=ledger,
            currency=currency,
            metadata={
                "flags": flags,
                "user_data": user_data
            }
        ))
    
    async def on_account_closed(self, account_id: str, final_balance: int):
        """Publish account closed event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.ACCOUNT_CLOSED,
            account_id=account_id,
            balance_after=final_balance
        ))
    
    async def on_balance_updated(
        self,
        account_id: str,
        balance_before: int,
        balance_after: int,
        transfer_id: Optional[str] = None
    ):
        """Publish balance updated event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.BALANCE_UPDATED,
            account_id=account_id,
            transfer_id=transfer_id,
            balance_before=balance_before,
            balance_after=balance_after,
            amount=abs(balance_after - balance_before)
        ))
    
    # ==================== Transfer Events ====================
    
    async def on_transfer_created(
        self,
        transfer_id: str,
        debit_account_id: str,
        credit_account_id: str,
        amount: int,
        ledger: int,
        currency: str,
        external_reference: Optional[str] = None
    ):
        """Publish transfer created event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.TRANSFER_CREATED,
            transfer_id=transfer_id,
            debit_account_id=debit_account_id,
            credit_account_id=credit_account_id,
            amount=amount,
            ledger=ledger,
            currency=currency,
            external_reference=external_reference
        ))
    
    async def on_transfer_completed(
        self,
        transfer_id: str,
        debit_account_id: str,
        credit_account_id: str,
        amount: int
    ):
        """Publish transfer completed event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.TRANSFER_COMPLETED,
            transfer_id=transfer_id,
            debit_account_id=debit_account_id,
            credit_account_id=credit_account_id,
            amount=amount
        ))
    
    async def on_transfer_failed(
        self,
        transfer_id: str,
        debit_account_id: str,
        credit_account_id: str,
        amount: int,
        error: str
    ):
        """Publish transfer failed event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.TRANSFER_FAILED,
            transfer_id=transfer_id,
            debit_account_id=debit_account_id,
            credit_account_id=credit_account_id,
            amount=amount,
            metadata={"error": error}
        ))
    
    # ==================== Pending Transfer Events ====================
    
    async def on_pending_transfer_created(
        self,
        transfer_id: str,
        debit_account_id: str,
        credit_account_id: str,
        amount: int,
        timeout: int,
        external_reference: Optional[str] = None
    ):
        """Publish pending transfer created event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.PENDING_TRANSFER_CREATED,
            transfer_id=transfer_id,
            pending_id=transfer_id,
            debit_account_id=debit_account_id,
            credit_account_id=credit_account_id,
            amount=amount,
            external_reference=external_reference,
            metadata={"timeout": timeout}
        ))
    
    async def on_pending_transfer_posted(
        self,
        pending_id: str,
        post_transfer_id: str,
        amount: int
    ):
        """Publish pending transfer posted event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.PENDING_TRANSFER_POSTED,
            transfer_id=post_transfer_id,
            pending_id=pending_id,
            amount=amount
        ))
    
    async def on_pending_transfer_voided(
        self,
        pending_id: str,
        void_transfer_id: str,
        amount: int,
        reason: Optional[str] = None
    ):
        """Publish pending transfer voided event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.PENDING_TRANSFER_VOIDED,
            transfer_id=void_transfer_id,
            pending_id=pending_id,
            amount=amount,
            metadata={"reason": reason} if reason else {}
        ))
    
    async def on_pending_transfer_expired(
        self,
        pending_id: str,
        amount: int
    ):
        """Publish pending transfer expired event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.PENDING_TRANSFER_EXPIRED,
            pending_id=pending_id,
            amount=amount
        ))
    
    # ==================== Linked Batch Events ====================
    
    async def on_linked_batch_created(
        self,
        batch_id: str,
        transfer_count: int,
        total_amount: int
    ):
        """Publish linked batch created event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.LINKED_BATCH_CREATED,
            batch_id=batch_id,
            amount=total_amount,
            metadata={"transfer_count": transfer_count}
        ))
    
    async def on_linked_batch_completed(
        self,
        batch_id: str,
        transfer_ids: List[str]
    ):
        """Publish linked batch completed event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.LINKED_BATCH_COMPLETED,
            batch_id=batch_id,
            metadata={"transfer_ids": transfer_ids}
        ))
    
    async def on_linked_batch_failed(
        self,
        batch_id: str,
        error: str
    ):
        """Publish linked batch failed event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.LINKED_BATCH_FAILED,
            batch_id=batch_id,
            metadata={"error": error}
        ))
    
    # ==================== Overdraft Events ====================
    
    async def on_overdraft_prevented(
        self,
        account_id: str,
        attempted_amount: int,
        available_balance: int
    ):
        """Publish overdraft prevented event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.OVERDRAFT_PREVENTED,
            account_id=account_id,
            amount=attempted_amount,
            balance_after=available_balance,
            metadata={
                "attempted_amount": attempted_amount,
                "available_balance": available_balance,
                "shortfall": attempted_amount - available_balance
            }
        ))
    
    # ==================== Reconciliation Events ====================
    
    async def on_reconciliation_started(
        self,
        reconciliation_id: str,
        account_count: int
    ):
        """Publish reconciliation started event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.RECONCILIATION_STARTED,
            metadata={
                "reconciliation_id": reconciliation_id,
                "account_count": account_count
            }
        ))
    
    async def on_reconciliation_completed(
        self,
        reconciliation_id: str,
        accounts_checked: int,
        discrepancies_found: int
    ):
        """Publish reconciliation completed event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.RECONCILIATION_COMPLETED,
            metadata={
                "reconciliation_id": reconciliation_id,
                "accounts_checked": accounts_checked,
                "discrepancies_found": discrepancies_found
            }
        ))
    
    async def on_reconciliation_discrepancy(
        self,
        reconciliation_id: str,
        account_id: str,
        expected_balance: int,
        actual_balance: int
    ):
        """Publish reconciliation discrepancy event"""
        await self.publish_event(TigerBeetleEvent(
            event_type=TigerBeetleEventType.RECONCILIATION_DISCREPANCY,
            account_id=account_id,
            metadata={
                "reconciliation_id": reconciliation_id,
                "expected_balance": expected_balance,
                "actual_balance": actual_balance,
                "discrepancy": actual_balance - expected_balance
            }
        ))


# ==================== Singleton Instance ====================

_bridge: Optional[TigerBeetleKafkaBridge] = None


def get_tigerbeetle_kafka_bridge() -> TigerBeetleKafkaBridge:
    """Get the global TigerBeetle Kafka bridge instance"""
    global _bridge
    if _bridge is None:
        _bridge = TigerBeetleKafkaBridge()
    return _bridge


# ==================== Decorator for Auto-Publishing ====================

def publish_tigerbeetle_event(event_type: TigerBeetleEventType):
    """
    Decorator to automatically publish TigerBeetle events
    
    Usage:
        @publish_tigerbeetle_event(TigerBeetleEventType.TRANSFER_CREATED)
        async def create_transfer(self, ...):
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            result = await func(*args, **kwargs)
            
            # Extract event data from result
            if isinstance(result, dict) and result.get("success"):
                bridge = get_tigerbeetle_kafka_bridge()
                
                event = TigerBeetleEvent(
                    event_type=event_type,
                    transfer_id=result.get("transfer_id"),
                    account_id=result.get("account_id"),
                    amount=result.get("amount"),
                    ledger=result.get("ledger"),
                    currency=result.get("currency"),
                    debit_account_id=result.get("debit_account_id"),
                    credit_account_id=result.get("credit_account_id"),
                    external_reference=result.get("external_reference"),
                    metadata=result
                )
                
                # Fire and forget - don't block on event publishing
                asyncio.create_task(bridge.publish_event(event))
            
            return result
        
        return wrapper
    return decorator
