"""
Kafka Event Streaming for Multi-Bank Smart Routing
Handles payment events, routing decisions, reconciliation events, and liquidity alerts
"""

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.errors import KafkaError

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    # Payment Events
    PAYMENT_INITIATED = "payment.initiated"
    PAYMENT_ROUTED = "payment.routed"
    PAYMENT_RESERVED = "payment.reserved"
    PAYMENT_PROCESSING = "payment.processing"
    PAYMENT_COMPLETED = "payment.completed"
    PAYMENT_FAILED = "payment.failed"
    PAYMENT_REVERSED = "payment.reversed"
    
    # Routing Events
    ROUTING_DECISION = "routing.decision"
    ROUTING_FALLBACK = "routing.fallback"
    ROUTING_NO_ROUTE = "routing.no_route"
    
    # Liquidity Events
    LIQUIDITY_ALERT = "liquidity.alert"
    LIQUIDITY_LOW = "liquidity.low"
    LIQUIDITY_CRITICAL = "liquidity.critical"
    LIQUIDITY_SWEEP_INITIATED = "liquidity.sweep.initiated"
    LIQUIDITY_SWEEP_COMPLETED = "liquidity.sweep.completed"
    
    # Reconciliation Events
    RECONCILIATION_STARTED = "reconciliation.started"
    RECONCILIATION_COMPLETED = "reconciliation.completed"
    RECONCILIATION_EXCEPTION = "reconciliation.exception"
    RECONCILIATION_RESOLVED = "reconciliation.resolved"
    
    # Bank Connector Events
    CONNECTOR_HEALTHY = "connector.healthy"
    CONNECTOR_UNHEALTHY = "connector.unhealthy"
    CONNECTOR_CIRCUIT_OPEN = "connector.circuit.open"
    CONNECTOR_CIRCUIT_CLOSED = "connector.circuit.closed"
    
    # Settlement Events
    SETTLEMENT_INITIATED = "settlement.initiated"
    SETTLEMENT_COMPLETED = "settlement.completed"
    SETTLEMENT_FAILED = "settlement.failed"


class KafkaTopic(str, Enum):
    PAYMENTS = "multibank.payments"
    ROUTING = "multibank.routing"
    LIQUIDITY = "multibank.liquidity"
    RECONCILIATION = "multibank.reconciliation"
    CONNECTORS = "multibank.connectors"
    SETTLEMENTS = "multibank.settlements"
    DEAD_LETTER = "multibank.dead_letter"


@dataclass
class PaymentEvent:
    event_id: str
    event_type: str
    transfer_id: str
    amount: float
    currency: str
    source_bank: str
    source_account: str
    dest_bank: str
    dest_account: str
    dest_account_name: str
    rail: str
    status: str
    reference: str
    narration: str
    fee: float
    processing_time_ms: int
    error_code: Optional[str]
    error_message: Optional[str]
    metadata: Dict[str, Any]
    timestamp: str
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class RoutingEvent:
    event_id: str
    event_type: str
    transfer_id: str
    selected_rail: str
    source_bank: str
    source_account: str
    dest_bank: str
    estimated_latency_ms: int
    estimated_cost: float
    success_probability: float
    score: float
    reason: str
    fallback_rails: List[str]
    timestamp: str
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class LiquidityEvent:
    event_id: str
    event_type: str
    bank_code: str
    bank_name: str
    account_number: str
    current_balance: float
    threshold: float
    alert_type: str
    message: str
    recommended_action: str
    timestamp: str
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class ReconciliationEvent:
    event_id: str
    event_type: str
    reconciliation_id: str
    bank_code: str
    account_number: str
    period_start: str
    period_end: str
    matched_count: int
    unmatched_bank_count: int
    unmatched_internal_count: int
    discrepancy_amount: float
    status: str
    timestamp: str
    
    def to_dict(self) -> Dict:
        return asdict(self)


class KafkaEventProducer:
    """Kafka producer for multi-bank routing events"""
    
    def __init__(
        self,
        bootstrap_servers: str = None,
        client_id: str = "multibank-routing-producer"
    ):
        self.bootstrap_servers = bootstrap_servers or os.getenv(
            "KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"
        )
        self.client_id = client_id
        self.producer: Optional[AIOKafkaProducer] = None
        self._started = False
    
    async def start(self):
        """Start the Kafka producer"""
        if self._started:
            return
        
        self.producer = AIOKafkaProducer(
            bootstrap_servers=self.bootstrap_servers,
            client_id=self.client_id,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None,
            acks='all',
            retries=3,
            retry_backoff_ms=100,
            max_in_flight_requests_per_connection=5,
            enable_idempotence=True
        )
        
        await self.producer.start()
        self._started = True
        logger.info(f"Kafka producer started: {self.bootstrap_servers}")
    
    async def stop(self):
        """Stop the Kafka producer"""
        if self.producer and self._started:
            await self.producer.stop()
            self._started = False
            logger.info("Kafka producer stopped")
    
    async def _send(self, topic: str, key: str, value: Dict, headers: List = None):
        """Send a message to Kafka"""
        if not self._started:
            await self.start()
        
        try:
            await self.producer.send_and_wait(
                topic=topic,
                key=key,
                value=value,
                headers=headers or []
            )
        except KafkaError as e:
            logger.error(f"Failed to send message to {topic}: {e}")
            raise
    
    async def publish_payment_event(self, event: PaymentEvent):
        """Publish a payment event"""
        await self._send(
            topic=KafkaTopic.PAYMENTS.value,
            key=event.transfer_id,
            value=event.to_dict(),
            headers=[
                ("event_type", event.event_type.encode()),
                ("timestamp", event.timestamp.encode())
            ]
        )
        logger.debug(f"Published payment event: {event.event_type} - {event.transfer_id}")
    
    async def publish_routing_event(self, event: RoutingEvent):
        """Publish a routing event"""
        await self._send(
            topic=KafkaTopic.ROUTING.value,
            key=event.transfer_id,
            value=event.to_dict(),
            headers=[
                ("event_type", event.event_type.encode()),
                ("timestamp", event.timestamp.encode())
            ]
        )
        logger.debug(f"Published routing event: {event.event_type} - {event.transfer_id}")
    
    async def publish_liquidity_event(self, event: LiquidityEvent):
        """Publish a liquidity event"""
        await self._send(
            topic=KafkaTopic.LIQUIDITY.value,
            key=event.bank_code,
            value=event.to_dict(),
            headers=[
                ("event_type", event.event_type.encode()),
                ("alert_type", event.alert_type.encode()),
                ("timestamp", event.timestamp.encode())
            ]
        )
        logger.debug(f"Published liquidity event: {event.event_type} - {event.bank_code}")
    
    async def publish_reconciliation_event(self, event: ReconciliationEvent):
        """Publish a reconciliation event"""
        await self._send(
            topic=KafkaTopic.RECONCILIATION.value,
            key=event.reconciliation_id,
            value=event.to_dict(),
            headers=[
                ("event_type", event.event_type.encode()),
                ("timestamp", event.timestamp.encode())
            ]
        )
        logger.debug(f"Published reconciliation event: {event.event_type} - {event.reconciliation_id}")
    
    async def publish_connector_event(
        self,
        event_type: EventType,
        connector_name: str,
        bank_code: str,
        is_healthy: bool,
        error_message: str = None
    ):
        """Publish a connector health event"""
        event = {
            "event_id": str(uuid.uuid4()),
            "event_type": event_type.value,
            "connector_name": connector_name,
            "bank_code": bank_code,
            "is_healthy": is_healthy,
            "error_message": error_message,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        await self._send(
            topic=KafkaTopic.CONNECTORS.value,
            key=connector_name,
            value=event,
            headers=[
                ("event_type", event_type.value.encode())
            ]
        )
    
    # Convenience methods for common events
    
    async def payment_initiated(
        self,
        transfer_id: str,
        amount: float,
        currency: str,
        source_bank: str,
        source_account: str,
        dest_bank: str,
        dest_account: str,
        dest_account_name: str,
        reference: str,
        narration: str = None,
        metadata: Dict = None
    ):
        """Publish payment initiated event"""
        event = PaymentEvent(
            event_id=str(uuid.uuid4()),
            event_type=EventType.PAYMENT_INITIATED.value,
            transfer_id=transfer_id,
            amount=amount,
            currency=currency,
            source_bank=source_bank,
            source_account=source_account,
            dest_bank=dest_bank,
            dest_account=dest_account,
            dest_account_name=dest_account_name,
            rail="",
            status="initiated",
            reference=reference,
            narration=narration or "",
            fee=0,
            processing_time_ms=0,
            error_code=None,
            error_message=None,
            metadata=metadata or {},
            timestamp=datetime.utcnow().isoformat()
        )
        await self.publish_payment_event(event)
    
    async def payment_completed(
        self,
        transfer_id: str,
        amount: float,
        currency: str,
        source_bank: str,
        source_account: str,
        dest_bank: str,
        dest_account: str,
        dest_account_name: str,
        rail: str,
        reference: str,
        fee: float,
        processing_time_ms: int,
        narration: str = None,
        metadata: Dict = None
    ):
        """Publish payment completed event"""
        event = PaymentEvent(
            event_id=str(uuid.uuid4()),
            event_type=EventType.PAYMENT_COMPLETED.value,
            transfer_id=transfer_id,
            amount=amount,
            currency=currency,
            source_bank=source_bank,
            source_account=source_account,
            dest_bank=dest_bank,
            dest_account=dest_account,
            dest_account_name=dest_account_name,
            rail=rail,
            status="completed",
            reference=reference,
            narration=narration or "",
            fee=fee,
            processing_time_ms=processing_time_ms,
            error_code=None,
            error_message=None,
            metadata=metadata or {},
            timestamp=datetime.utcnow().isoformat()
        )
        await self.publish_payment_event(event)
    
    async def payment_failed(
        self,
        transfer_id: str,
        amount: float,
        currency: str,
        source_bank: str,
        source_account: str,
        dest_bank: str,
        dest_account: str,
        dest_account_name: str,
        rail: str,
        reference: str,
        error_code: str,
        error_message: str,
        processing_time_ms: int,
        metadata: Dict = None
    ):
        """Publish payment failed event"""
        event = PaymentEvent(
            event_id=str(uuid.uuid4()),
            event_type=EventType.PAYMENT_FAILED.value,
            transfer_id=transfer_id,
            amount=amount,
            currency=currency,
            source_bank=source_bank,
            source_account=source_account,
            dest_bank=dest_bank,
            dest_account=dest_account,
            dest_account_name=dest_account_name,
            rail=rail,
            status="failed",
            reference=reference,
            narration="",
            fee=0,
            processing_time_ms=processing_time_ms,
            error_code=error_code,
            error_message=error_message,
            metadata=metadata or {},
            timestamp=datetime.utcnow().isoformat()
        )
        await self.publish_payment_event(event)
    
    async def routing_decision_made(
        self,
        transfer_id: str,
        selected_rail: str,
        source_bank: str,
        source_account: str,
        dest_bank: str,
        estimated_latency_ms: int,
        estimated_cost: float,
        success_probability: float,
        score: float,
        reason: str,
        fallback_rails: List[str] = None
    ):
        """Publish routing decision event"""
        event = RoutingEvent(
            event_id=str(uuid.uuid4()),
            event_type=EventType.ROUTING_DECISION.value,
            transfer_id=transfer_id,
            selected_rail=selected_rail,
            source_bank=source_bank,
            source_account=source_account,
            dest_bank=dest_bank,
            estimated_latency_ms=estimated_latency_ms,
            estimated_cost=estimated_cost,
            success_probability=success_probability,
            score=score,
            reason=reason,
            fallback_rails=fallback_rails or [],
            timestamp=datetime.utcnow().isoformat()
        )
        await self.publish_routing_event(event)
    
    async def liquidity_alert(
        self,
        bank_code: str,
        bank_name: str,
        account_number: str,
        current_balance: float,
        threshold: float,
        alert_type: str,
        message: str,
        recommended_action: str = ""
    ):
        """Publish liquidity alert event"""
        event_type = EventType.LIQUIDITY_CRITICAL if "critical" in alert_type.lower() else EventType.LIQUIDITY_LOW
        
        event = LiquidityEvent(
            event_id=str(uuid.uuid4()),
            event_type=event_type.value,
            bank_code=bank_code,
            bank_name=bank_name,
            account_number=account_number,
            current_balance=current_balance,
            threshold=threshold,
            alert_type=alert_type,
            message=message,
            recommended_action=recommended_action,
            timestamp=datetime.utcnow().isoformat()
        )
        await self.publish_liquidity_event(event)


class KafkaEventConsumer:
    """Kafka consumer for multi-bank routing events"""
    
    def __init__(
        self,
        bootstrap_servers: str = None,
        group_id: str = "multibank-routing-consumer",
        topics: List[str] = None
    ):
        self.bootstrap_servers = bootstrap_servers or os.getenv(
            "KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"
        )
        self.group_id = group_id
        self.topics = topics or [t.value for t in KafkaTopic if t != KafkaTopic.DEAD_LETTER]
        self.consumer: Optional[AIOKafkaConsumer] = None
        self._handlers: Dict[str, List[Callable]] = {}
        self._running = False
    
    async def start(self):
        """Start the Kafka consumer"""
        self.consumer = AIOKafkaConsumer(
            *self.topics,
            bootstrap_servers=self.bootstrap_servers,
            group_id=self.group_id,
            value_deserializer=lambda v: json.loads(v.decode('utf-8')),
            key_deserializer=lambda k: k.decode('utf-8') if k else None,
            auto_offset_reset='latest',
            enable_auto_commit=True,
            auto_commit_interval_ms=5000
        )
        
        await self.consumer.start()
        self._running = True
        logger.info(f"Kafka consumer started: {self.bootstrap_servers}, topics: {self.topics}")
    
    async def stop(self):
        """Stop the Kafka consumer"""
        self._running = False
        if self.consumer:
            await self.consumer.stop()
            logger.info("Kafka consumer stopped")
    
    def register_handler(self, event_type: str, handler: Callable):
        """Register a handler for an event type"""
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)
    
    def on_event(self, event_type: EventType):
        """Decorator to register an event handler"""
        def decorator(func: Callable):
            self.register_handler(event_type.value, func)
            return func
        return decorator
    
    async def _process_message(self, message):
        """Process a single message"""
        try:
            event_data = message.value
            event_type = event_data.get("event_type", "")
            
            handlers = self._handlers.get(event_type, [])
            handlers.extend(self._handlers.get("*", []))  # Wildcard handlers
            
            for handler in handlers:
                try:
                    if asyncio.iscoroutinefunction(handler):
                        await handler(event_data)
                    else:
                        handler(event_data)
                except Exception as e:
                    logger.error(f"Handler error for {event_type}: {e}")
        
        except Exception as e:
            logger.error(f"Message processing error: {e}")
    
    async def consume(self):
        """Start consuming messages"""
        if not self.consumer:
            await self.start()
        
        try:
            async for message in self.consumer:
                if not self._running:
                    break
                await self._process_message(message)
        except Exception as e:
            logger.error(f"Consumer error: {e}")
            raise


class MultiBankEventBus:
    """Unified event bus for multi-bank routing"""
    
    def __init__(
        self,
        bootstrap_servers: str = None,
        producer_client_id: str = "multibank-producer",
        consumer_group_id: str = "multibank-consumer"
    ):
        self.producer = KafkaEventProducer(
            bootstrap_servers=bootstrap_servers,
            client_id=producer_client_id
        )
        self.consumer = KafkaEventConsumer(
            bootstrap_servers=bootstrap_servers,
            group_id=consumer_group_id
        )
        self._consumer_task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Start the event bus"""
        await self.producer.start()
        await self.consumer.start()
        self._consumer_task = asyncio.create_task(self.consumer.consume())
        logger.info("MultiBankEventBus started")
    
    async def stop(self):
        """Stop the event bus"""
        if self._consumer_task:
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass
        
        await self.consumer.stop()
        await self.producer.stop()
        logger.info("MultiBankEventBus stopped")
    
    def on_event(self, event_type: EventType):
        """Decorator to register an event handler"""
        return self.consumer.on_event(event_type)
    
    # Delegate publishing methods to producer
    async def payment_initiated(self, **kwargs):
        await self.producer.payment_initiated(**kwargs)
    
    async def payment_completed(self, **kwargs):
        await self.producer.payment_completed(**kwargs)
    
    async def payment_failed(self, **kwargs):
        await self.producer.payment_failed(**kwargs)
    
    async def routing_decision_made(self, **kwargs):
        await self.producer.routing_decision_made(**kwargs)
    
    async def liquidity_alert(self, **kwargs):
        await self.producer.liquidity_alert(**kwargs)
    
    async def publish_payment_event(self, event: PaymentEvent):
        await self.producer.publish_payment_event(event)
    
    async def publish_routing_event(self, event: RoutingEvent):
        await self.producer.publish_routing_event(event)
    
    async def publish_liquidity_event(self, event: LiquidityEvent):
        await self.producer.publish_liquidity_event(event)
    
    async def publish_reconciliation_event(self, event: ReconciliationEvent):
        await self.producer.publish_reconciliation_event(event)


# Singleton instance
_event_bus: Optional[MultiBankEventBus] = None


async def get_event_bus() -> MultiBankEventBus:
    """Get or create the event bus instance"""
    global _event_bus
    if _event_bus is None:
        _event_bus = MultiBankEventBus()
        await _event_bus.start()
    return _event_bus


# Example usage and event handlers
async def setup_default_handlers(event_bus: MultiBankEventBus):
    """Setup default event handlers"""
    
    @event_bus.on_event(EventType.PAYMENT_COMPLETED)
    async def handle_payment_completed(event: Dict):
        logger.info(f"Payment completed: {event['transfer_id']} - {event['amount']} {event['currency']}")
    
    @event_bus.on_event(EventType.PAYMENT_FAILED)
    async def handle_payment_failed(event: Dict):
        logger.warning(f"Payment failed: {event['transfer_id']} - {event['error_message']}")
    
    @event_bus.on_event(EventType.LIQUIDITY_CRITICAL)
    async def handle_liquidity_critical(event: Dict):
        logger.critical(f"CRITICAL LIQUIDITY: {event['bank_name']} - {event['message']}")
    
    @event_bus.on_event(EventType.RECONCILIATION_EXCEPTION)
    async def handle_reconciliation_exception(event: Dict):
        logger.warning(f"Reconciliation exception: {event['reconciliation_id']} - {event.get('description', '')}")
