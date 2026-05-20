"""
Unified Event Bus - Consolidates Kafka, Fluvio, Redis Pub/Sub, and Dapr
Provides a single interface with explicit bridges and strong contracts
"""

import os
import json
import logging
import asyncio
import hashlib
from typing import Optional, Dict, Any, List, Callable, Union
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from abc import ABC, abstractmethod
from uuid import uuid4

logger = logging.getLogger(__name__)


class EventPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class DeliveryGuarantee(str, Enum):
    AT_MOST_ONCE = "at_most_once"
    AT_LEAST_ONCE = "at_least_once"
    EXACTLY_ONCE = "exactly_once"


@dataclass
class EventSchema:
    """Schema definition for event validation"""
    name: str
    version: str
    fields: Dict[str, str]  # field_name -> type
    required_fields: List[str]
    
    def validate(self, data: Dict[str, Any]) -> bool:
        """Validate data against schema"""
        for field in self.required_fields:
            if field not in data:
                return False
        return True


@dataclass
class Event:
    """Unified event structure"""
    event_id: str
    event_type: str
    source: str
    timestamp: str
    data: Dict[str, Any]
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    # Delivery settings
    priority: EventPriority = EventPriority.NORMAL
    delivery_guarantee: DeliveryGuarantee = DeliveryGuarantee.AT_LEAST_ONCE
    
    # Tracing
    correlation_id: Optional[str] = None
    causation_id: Optional[str] = None
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    
    # Schema
    schema_name: Optional[str] = None
    schema_version: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict())
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Event':
        return cls(**data)
    
    @classmethod
    def from_json(cls, json_str: str) -> 'Event':
        return cls.from_dict(json.loads(json_str))


@dataclass
class DeadLetterEvent:
    """Event that failed processing"""
    original_event: Event
    error_message: str
    error_type: str
    retry_count: int
    last_retry_at: str
    dead_lettered_at: str
    consumer_id: str


class EventBackend(ABC):
    """Abstract base class for event backends"""
    
    @abstractmethod
    async def publish(self, topic: str, event: Event) -> bool:
        pass
    
    @abstractmethod
    async def subscribe(self, topic: str, handler: Callable[[Event], None], group_id: str) -> None:
        pass
    
    @abstractmethod
    async def acknowledge(self, topic: str, event_id: str) -> bool:
        pass
    
    @abstractmethod
    async def close(self) -> None:
        pass


class KafkaBackend(EventBackend):
    """Kafka event backend"""
    
    def __init__(self):
        self.bootstrap_servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
        self._producer = None
        self._consumers: Dict[str, Any] = {}
    
    async def _get_producer(self):
        if self._producer is None:
            from aiokafka import AIOKafkaProducer
            self._producer = AIOKafkaProducer(
                bootstrap_servers=self.bootstrap_servers,
                value_serializer=lambda v: json.dumps(v).encode(),
                acks='all',
                enable_idempotence=True
            )
            await self._producer.start()
        return self._producer
    
    async def publish(self, topic: str, event: Event) -> bool:
        try:
            producer = await self._get_producer()
            await producer.send_and_wait(topic, event.to_dict())
            return True
        except Exception as e:
            logger.error(f"Kafka publish failed: {e}")
            return False
    
    async def subscribe(self, topic: str, handler: Callable[[Event], None], group_id: str) -> None:
        from aiokafka import AIOKafkaConsumer
        
        consumer = AIOKafkaConsumer(
            topic,
            bootstrap_servers=self.bootstrap_servers,
            group_id=group_id,
            value_deserializer=lambda v: json.loads(v.decode()),
            enable_auto_commit=False
        )
        await consumer.start()
        self._consumers[f"{topic}:{group_id}"] = consumer
        
        async def consume():
            try:
                async for msg in consumer:
                    try:
                        event = Event.from_dict(msg.value)
                        await handler(event)
                        await consumer.commit()
                    except Exception as e:
                        logger.error(f"Handler error: {e}")
            except asyncio.CancelledError:
                pass
        
        asyncio.create_task(consume())
    
    async def acknowledge(self, topic: str, event_id: str) -> bool:
        return True  # Kafka uses commit-based acknowledgment
    
    async def close(self) -> None:
        if self._producer:
            await self._producer.stop()
        for consumer in self._consumers.values():
            await consumer.stop()


class FluvioBackend(EventBackend):
    """Fluvio event backend"""
    
    def __init__(self):
        self.endpoint = os.getenv("FLUVIO_ENDPOINT", "localhost:9003")
        self._producer = None
        self._consumers: Dict[str, Any] = {}
    
    async def _get_producer(self):
        if self._producer is None:
            try:
                from fluvio import Fluvio
                fluvio = await Fluvio.connect()
                self._producer = fluvio
            except ImportError:
                logger.warning("Fluvio SDK not available, using HTTP fallback")
                self._producer = "http"
        return self._producer
    
    async def publish(self, topic: str, event: Event) -> bool:
        try:
            producer = await self._get_producer()
            if producer == "http":
                # HTTP fallback
                import httpx
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"http://{self.endpoint}/produce/{topic}",
                        json=event.to_dict()
                    )
                    return response.status_code == 200
            else:
                # Native Fluvio
                topic_producer = await producer.topic_producer(topic)
                await topic_producer.send_string(event.to_json())
                return True
        except Exception as e:
            logger.error(f"Fluvio publish failed: {e}")
            return False
    
    async def subscribe(self, topic: str, handler: Callable[[Event], None], group_id: str) -> None:
        try:
            from fluvio import Fluvio, Offset
            fluvio = await Fluvio.connect()
            consumer = await fluvio.partition_consumer(topic, 0)
            
            async def consume():
                async for record in await consumer.stream(Offset.end()):
                    try:
                        event = Event.from_json(record.value_string())
                        await handler(event)
                    except Exception as e:
                        logger.error(f"Handler error: {e}")
            
            asyncio.create_task(consume())
        except ImportError:
            logger.warning("Fluvio SDK not available for subscription")
    
    async def acknowledge(self, topic: str, event_id: str) -> bool:
        return True  # Fluvio uses offset-based consumption
    
    async def close(self) -> None:
        pass


class RedisBackend(EventBackend):
    """Redis Pub/Sub event backend"""
    
    def __init__(self):
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self._redis = None
        self._pubsub = None
    
    async def _get_redis(self):
        if self._redis is None:
            import aioredis
            self._redis = await aioredis.from_url(self.redis_url)
        return self._redis
    
    async def publish(self, topic: str, event: Event) -> bool:
        try:
            redis = await self._get_redis()
            await redis.publish(topic, event.to_json())
            return True
        except Exception as e:
            logger.error(f"Redis publish failed: {e}")
            return False
    
    async def subscribe(self, topic: str, handler: Callable[[Event], None], group_id: str) -> None:
        redis = await self._get_redis()
        pubsub = redis.pubsub()
        await pubsub.subscribe(topic)
        
        async def consume():
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        event = Event.from_json(message["data"])
                        await handler(event)
                    except Exception as e:
                        logger.error(f"Handler error: {e}")
        
        asyncio.create_task(consume())
    
    async def acknowledge(self, topic: str, event_id: str) -> bool:
        return True  # Redis pub/sub doesn't have acknowledgment
    
    async def close(self) -> None:
        if self._redis:
            await self._redis.close()


class DaprBackend(EventBackend):
    """Dapr event backend"""
    
    def __init__(self):
        self.dapr_port = os.getenv("DAPR_HTTP_PORT", "3500")
        self.pubsub_name = os.getenv("DAPR_PUBSUB_NAME", "pubsub")
    
    async def publish(self, topic: str, event: Event) -> bool:
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"http://localhost:{self.dapr_port}/v1.0/publish/{self.pubsub_name}/{topic}",
                    json=event.to_dict(),
                    headers={"Content-Type": "application/json"}
                )
                return response.status_code in (200, 204)
        except Exception as e:
            logger.error(f"Dapr publish failed: {e}")
            return False
    
    async def subscribe(self, topic: str, handler: Callable[[Event], None], group_id: str) -> None:
        # Dapr subscriptions are configured via subscription.yaml
        # Handler is called via HTTP endpoint
        logger.info(f"Dapr subscription for {topic} should be configured in subscription.yaml")
    
    async def acknowledge(self, topic: str, event_id: str) -> bool:
        return True
    
    async def close(self) -> None:
        pass


class UnifiedEventBus:
    """
    Unified Event Bus that consolidates multiple backends.
    Provides a single interface with explicit bridges and strong contracts.
    """
    
    def __init__(self, primary_backend: str = "kafka"):
        self.primary_backend_name = primary_backend
        self._backends: Dict[str, EventBackend] = {}
        self._schemas: Dict[str, EventSchema] = {}
        self._bridges: Dict[str, List[str]] = {}  # source_topic -> [dest_topics]
        self._dlq_handler: Optional[Callable[[DeadLetterEvent], None]] = None
        self._retry_config = {
            "max_retries": 3,
            "retry_delay_ms": 1000,
            "retry_multiplier": 2.0
        }
        
        # Initialize primary backend
        self._init_backends()
    
    def _init_backends(self):
        """Initialize event backends"""
        backend_map = {
            "kafka": KafkaBackend,
            "fluvio": FluvioBackend,
            "redis": RedisBackend,
            "dapr": DaprBackend
        }
        
        # Initialize primary backend
        if self.primary_backend_name in backend_map:
            self._backends[self.primary_backend_name] = backend_map[self.primary_backend_name]()
        
        # Initialize secondary backends based on environment
        if os.getenv("FLUVIO_ENABLED", "false").lower() == "true":
            self._backends["fluvio"] = FluvioBackend()
        
        if os.getenv("REDIS_PUBSUB_ENABLED", "false").lower() == "true":
            self._backends["redis"] = RedisBackend()
        
        if os.getenv("DAPR_ENABLED", "false").lower() == "true":
            self._backends["dapr"] = DaprBackend()
    
    def register_schema(self, schema: EventSchema):
        """Register an event schema"""
        key = f"{schema.name}:{schema.version}"
        self._schemas[key] = schema
        logger.info(f"Registered schema: {key}")
    
    def register_bridge(self, source_topic: str, dest_topic: str, dest_backend: str):
        """Register a bridge between topics/backends"""
        if source_topic not in self._bridges:
            self._bridges[source_topic] = []
        self._bridges[source_topic].append(f"{dest_backend}:{dest_topic}")
        logger.info(f"Registered bridge: {source_topic} -> {dest_backend}:{dest_topic}")
    
    def set_dlq_handler(self, handler: Callable[[DeadLetterEvent], None]):
        """Set dead letter queue handler"""
        self._dlq_handler = handler
    
    async def publish(
        self,
        topic: str,
        event_type: str,
        data: Dict[str, Any],
        priority: EventPriority = EventPriority.NORMAL,
        delivery_guarantee: DeliveryGuarantee = DeliveryGuarantee.AT_LEAST_ONCE,
        correlation_id: Optional[str] = None,
        schema_name: Optional[str] = None,
        schema_version: Optional[str] = None,
        backend: Optional[str] = None
    ) -> str:
        """
        Publish an event to the event bus.
        
        Args:
            topic: Target topic
            event_type: Type of event
            data: Event payload
            priority: Event priority
            delivery_guarantee: Delivery guarantee level
            correlation_id: Correlation ID for tracing
            schema_name: Schema name for validation
            schema_version: Schema version
            backend: Specific backend to use (default: primary)
        
        Returns:
            Event ID
        """
        # Create event
        event = Event(
            event_id=str(uuid4()),
            event_type=event_type,
            source=os.getenv("SERVICE_NAME", "unknown"),
            timestamp=datetime.now(timezone.utc).isoformat(),
            data=data,
            priority=priority,
            delivery_guarantee=delivery_guarantee,
            correlation_id=correlation_id or str(uuid4()),
            schema_name=schema_name,
            schema_version=schema_version
        )
        
        # Validate against schema if specified
        if schema_name and schema_version:
            schema_key = f"{schema_name}:{schema_version}"
            if schema_key in self._schemas:
                if not self._schemas[schema_key].validate(data):
                    raise ValueError(f"Event data does not match schema {schema_key}")
        
        # Publish to primary or specified backend
        target_backend = backend or self.primary_backend_name
        if target_backend not in self._backends:
            raise ValueError(f"Backend not available: {target_backend}")
        
        success = await self._backends[target_backend].publish(topic, event)
        
        if not success:
            logger.error(f"Failed to publish event {event.event_id} to {topic}")
            raise RuntimeError(f"Failed to publish event to {topic}")
        
        # Handle bridges
        if topic in self._bridges:
            for bridge in self._bridges[topic]:
                bridge_backend, bridge_topic = bridge.split(":", 1)
                if bridge_backend in self._backends:
                    await self._backends[bridge_backend].publish(bridge_topic, event)
        
        logger.debug(f"Published event {event.event_id} to {topic}")
        return event.event_id
    
    async def subscribe(
        self,
        topic: str,
        handler: Callable[[Event], None],
        group_id: str,
        backend: Optional[str] = None
    ):
        """
        Subscribe to events on a topic.
        
        Args:
            topic: Topic to subscribe to
            handler: Event handler function
            group_id: Consumer group ID
            backend: Specific backend to use (default: primary)
        """
        target_backend = backend or self.primary_backend_name
        if target_backend not in self._backends:
            raise ValueError(f"Backend not available: {target_backend}")
        
        # Wrap handler with retry logic
        async def wrapped_handler(event: Event):
            retry_count = 0
            delay = self._retry_config["retry_delay_ms"] / 1000
            
            while retry_count <= self._retry_config["max_retries"]:
                try:
                    await handler(event)
                    return
                except Exception as e:
                    retry_count += 1
                    if retry_count > self._retry_config["max_retries"]:
                        # Send to DLQ
                        if self._dlq_handler:
                            dlq_event = DeadLetterEvent(
                                original_event=event,
                                error_message=str(e),
                                error_type=type(e).__name__,
                                retry_count=retry_count,
                                last_retry_at=datetime.now(timezone.utc).isoformat(),
                                dead_lettered_at=datetime.now(timezone.utc).isoformat(),
                                consumer_id=group_id
                            )
                            await self._dlq_handler(dlq_event)
                        logger.error(f"Event {event.event_id} sent to DLQ after {retry_count} retries")
                        return
                    
                    logger.warning(f"Retry {retry_count} for event {event.event_id}: {e}")
                    await asyncio.sleep(delay)
                    delay *= self._retry_config["retry_multiplier"]
        
        await self._backends[target_backend].subscribe(topic, wrapped_handler, group_id)
        logger.info(f"Subscribed to {topic} on {target_backend} with group {group_id}")
    
    async def close(self):
        """Close all backends"""
        for backend in self._backends.values():
            await backend.close()


# Standard event schemas for the platform
TRANSACTION_SCHEMA = EventSchema(
    name="transaction",
    version="1.0",
    fields={
        "transaction_id": "string",
        "type": "string",
        "amount": "number",
        "currency": "string",
        "status": "string",
        "agent_id": "string",
        "customer_id": "string"
    },
    required_fields=["transaction_id", "type", "amount", "currency", "status"]
)

AGENT_SCHEMA = EventSchema(
    name="agent",
    version="1.0",
    fields={
        "agent_id": "string",
        "action": "string",
        "tier": "string",
        "status": "string"
    },
    required_fields=["agent_id", "action"]
)

SYNC_SCHEMA = EventSchema(
    name="sync",
    version="1.0",
    fields={
        "source": "string",
        "destination": "string",
        "sequence_number": "number",
        "event_type": "string",
        "payload": "object"
    },
    required_fields=["source", "destination", "sequence_number", "event_type"]
)


# Global instance
_event_bus: Optional[UnifiedEventBus] = None


def get_event_bus() -> UnifiedEventBus:
    """Get the global event bus instance"""
    global _event_bus
    if _event_bus is None:
        primary = os.getenv("EVENT_BUS_PRIMARY", "kafka")
        _event_bus = UnifiedEventBus(primary_backend=primary)
        
        # Register standard schemas
        _event_bus.register_schema(TRANSACTION_SCHEMA)
        _event_bus.register_schema(AGENT_SCHEMA)
        _event_bus.register_schema(SYNC_SCHEMA)
    
    return _event_bus


# Example usage
if __name__ == "__main__":
    async def main():
        bus = get_event_bus()
        
        # Register a bridge from Kafka to Fluvio for POS events
        bus.register_bridge("pos-events", "pos-events-fluvio", "fluvio")
        
        # Publish an event
        event_id = await bus.publish(
            topic="transactions",
            event_type="transaction.completed",
            data={
                "transaction_id": "TXN-001",
                "type": "cash_in",
                "amount": 1000.0,
                "currency": "KES",
                "status": "completed",
                "agent_id": "AGT-001",
                "customer_id": "CUST-001"
            },
            schema_name="transaction",
            schema_version="1.0"
        )
        print(f"Published event: {event_id}")
        
        # Subscribe to events
        async def handler(event: Event):
            print(f"Received event: {event.event_id}")
        
        await bus.subscribe("transactions", handler, "my-consumer-group")
        
        # Keep running
        await asyncio.sleep(60)
        await bus.close()
    
    asyncio.run(main())
