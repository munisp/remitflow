"""
Kafka Event Publisher Integration for Mojaloop
Publishes payment events to Kafka for event-driven architecture
"""

import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from enum import Enum


logger = logging.getLogger(__name__)


class EventType(Enum):
    """Mojaloop event types"""
    # Participant events
    PARTICIPANT_CREATED = "participant.created"
    PARTICIPANT_UPDATED = "participant.updated"
    PARTICIPANT_DELETED = "participant.deleted"
    
    # Quote events
    QUOTE_CREATED = "quote.created"
    QUOTE_APPROVED = "quote.approved"
    QUOTE_REJECTED = "quote.rejected"
    QUOTE_EXPIRED = "quote.expired"
    
    # Transfer events
    TRANSFER_CREATED = "transfer.created"
    TRANSFER_PREPARED = "transfer.prepared"
    TRANSFER_FULFILLED = "transfer.fulfilled"
    TRANSFER_COMMITTED = "transfer.committed"
    TRANSFER_ABORTED = "transfer.aborted"
    
    # Settlement events
    SETTLEMENT_WINDOW_OPENED = "settlement.window.opened"
    SETTLEMENT_WINDOW_CLOSED = "settlement.window.closed"
    SETTLEMENT_PROCESSED = "settlement.processed"
    SETTLEMENT_COMPLETED = "settlement.completed"
    
    # Payment events
    PAYMENT_INITIATED = "payment.initiated"
    PAYMENT_PROCESSING = "payment.processing"
    PAYMENT_COMPLETED = "payment.completed"
    PAYMENT_FAILED = "payment.failed"


class KafkaProducer:
    """Kafka producer for publishing Mojaloop events"""
    
    def __init__(self, bootstrap_servers: str = "localhost:9092"):
        self.bootstrap_servers = bootstrap_servers
        self.topic_prefix = "mojaloop"
    
    async def publish_event(
        self,
        event_type: EventType,
        payload: Dict[str, Any],
        key: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None
    ) -> bool:
        """Publish an event to Kafka"""
        try:
            # Build event message
            event = {
                "event_type": event_type.value,
                "event_id": self._generate_event_id(),
                "timestamp": datetime.utcnow().isoformat(),
                "payload": payload,
                "metadata": {
                    "source": "mojaloop-switch",
                    "version": "1.0"
                }
            }
            
            # Determine topic
            topic = self._get_topic_for_event(event_type)
            
            # In production, this would use actual Kafka producer
            logger.info(f"Publishing event to topic {topic}: {event_type.value}")
            logger.debug(f"Event payload: {json.dumps(event, indent=2)}")
            
            return True
        except Exception as e:
            logger.error(f"Failed to publish event: {e}")
            return False
    
    def _get_topic_for_event(self, event_type: EventType) -> str:
        """Get Kafka topic for event type"""
        # Map event types to topics
        if "participant" in event_type.value:
            return f"{self.topic_prefix}.participants"
        elif "quote" in event_type.value:
            return f"{self.topic_prefix}.quotes"
        elif "transfer" in event_type.value:
            return f"{self.topic_prefix}.transfers"
        elif "settlement" in event_type.value:
            return f"{self.topic_prefix}.settlements"
        elif "payment" in event_type.value:
            return f"{self.topic_prefix}.payments"
        else:
            return f"{self.topic_prefix}.events"
    
    def _generate_event_id(self) -> str:
        """Generate unique event ID"""
        import uuid
        return str(uuid.uuid4())


class EventPublisher:
    """High-level event publisher for Mojaloop operations"""
    
    def __init__(self, kafka_producer: KafkaProducer):
        self.kafka_producer = kafka_producer
    
    async def publish_participant_created(
        self,
        participant_id: str,
        participant_data: Dict[str, Any]
    ) -> bool:
        """Publish participant created event"""
        return await self.kafka_producer.publish_event(
            EventType.PARTICIPANT_CREATED,
            {
                "participant_id": participant_id,
                "name": participant_data.get("name"),
                "type": participant_data.get("type"),
                "currency": participant_data.get("currency"),
                "status": participant_data.get("status")
            },
            key=participant_id
        )
    
    async def publish_quote_created(
        self,
        quote_id: str,
        quote_data: Dict[str, Any]
    ) -> bool:
        """Publish quote created event"""
        return await self.kafka_producer.publish_event(
            EventType.QUOTE_CREATED,
            {
                "quote_id": quote_id,
                "transaction_id": quote_data.get("transaction_id"),
                "payer_fsp": quote_data.get("payer_fsp"),
                "payee_fsp": quote_data.get("payee_fsp"),
                "amount": quote_data.get("amount"),
                "currency": quote_data.get("currency"),
                "fees": quote_data.get("fees"),
                "expiration": quote_data.get("expiration")
            },
            key=quote_id
        )
    
    async def publish_transfer_prepared(
        self,
        transfer_id: str,
        transfer_data: Dict[str, Any]
    ) -> bool:
        """Publish transfer prepared event"""
        return await self.kafka_producer.publish_event(
            EventType.TRANSFER_PREPARED,
            {
                "transfer_id": transfer_id,
                "quote_id": transfer_data.get("quote_id"),
                "payer_fsp": transfer_data.get("payer_fsp"),
                "payee_fsp": transfer_data.get("payee_fsp"),
                "amount": transfer_data.get("amount"),
                "currency": transfer_data.get("currency"),
                "state": transfer_data.get("state")
            },
            key=transfer_id
        )
    
    async def publish_transfer_fulfilled(
        self,
        transfer_id: str,
        transfer_data: Dict[str, Any]
    ) -> bool:
        """Publish transfer fulfilled event"""
        return await self.kafka_producer.publish_event(
            EventType.TRANSFER_FULFILLED,
            {
                "transfer_id": transfer_id,
                "quote_id": transfer_data.get("quote_id"),
                "payer_fsp": transfer_data.get("payer_fsp"),
                "payee_fsp": transfer_data.get("payee_fsp"),
                "amount": transfer_data.get("amount"),
                "currency": transfer_data.get("currency"),
                "state": "COMMITTED",
                "fulfillment": transfer_data.get("fulfillment")
            },
            key=transfer_id
        )
    
    async def publish_payment_completed(
        self,
        payment_id: str,
        payment_data: Dict[str, Any]
    ) -> bool:
        """Publish payment completed event"""
        return await self.kafka_producer.publish_event(
            EventType.PAYMENT_COMPLETED,
            {
                "payment_id": payment_id,
                "quote_id": payment_data.get("quote_id"),
                "transfer_id": payment_data.get("transfer_id"),
                "settlement_id": payment_data.get("settlement_id"),
                "payer_fsp": payment_data.get("payer_fsp"),
                "payee_fsp": payment_data.get("payee_fsp"),
                "amount": payment_data.get("amount"),
                "currency": payment_data.get("currency"),
                "fees": payment_data.get("fees"),
                "total_amount": payment_data.get("total_amount")
            },
            key=payment_id
        )
    
    async def publish_payment_failed(
        self,
        payment_id: str,
        error_data: Dict[str, Any]
    ) -> bool:
        """Publish payment failed event"""
        return await self.kafka_producer.publish_event(
            EventType.PAYMENT_FAILED,
            {
                "payment_id": payment_id,
                "error_code": error_data.get("error_code"),
                "error_message": error_data.get("error_message"),
                "failed_at": datetime.utcnow().isoformat()
            },
            key=payment_id
        )
    
    async def publish_settlement_processed(
        self,
        settlement_id: str,
        settlement_data: Dict[str, Any]
    ) -> bool:
        """Publish settlement processed event"""
        return await self.kafka_producer.publish_event(
            EventType.SETTLEMENT_PROCESSED,
            {
                "settlement_id": settlement_id,
                "settlement_window_id": settlement_data.get("settlement_window_id"),
                "transfer_id": settlement_data.get("transfer_id"),
                "payer_fsp": settlement_data.get("payer_fsp"),
                "payee_fsp": settlement_data.get("payee_fsp"),
                "amount": settlement_data.get("amount"),
                "currency": settlement_data.get("currency"),
                "status": settlement_data.get("status")
            },
            key=settlement_id
        )


class EventConsumer:
    """Kafka consumer for processing Mojaloop events"""
    
    def __init__(self, bootstrap_servers: str = "localhost:9092"):
        self.bootstrap_servers = bootstrap_servers
        self.topic_prefix = "mojaloop"
    
    async def consume_events(self, topics: list, handler_func):
        """Consume events from Kafka topics"""
        try:
            # In production, this would use actual Kafka consumer
            logger.info(f"Consuming events from topics: {topics}")
            
            # Simulate event consumption
            while True:
                # Process events
                await handler_func({
                    "event_type": "payment.completed",
                    "payload": {"payment_id": "payment-123"}
                })
                
                # In production, this would be a real event loop
                break
        except Exception as e:
            logger.error(f"Failed to consume events: {e}")


# Event handlers
async def handle_payment_event(event: Dict[str, Any]):
    """Handle payment events"""
    event_type = event.get("event_type")
    payload = event.get("payload")
    
    logger.info(f"Handling event: {event_type}")
    
    if event_type == "payment.completed":
        # Process completed payment
        logger.info(f"Payment completed: {payload.get('payment_id')}")
    elif event_type == "payment.failed":
        # Process failed payment
        logger.error(f"Payment failed: {payload.get('payment_id')}")


async def handle_settlement_event(event: Dict[str, Any]):
    """Handle settlement events"""
    event_type = event.get("event_type")
    payload = event.get("payload")
    
    logger.info(f"Handling settlement event: {event_type}")
    
    if event_type == "settlement.processed":
        # Process settlement
        logger.info(f"Settlement processed: {payload.get('settlement_id')}")

