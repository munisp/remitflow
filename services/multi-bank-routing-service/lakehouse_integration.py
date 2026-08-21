"""
Multi-Bank Routing Lakehouse Integration
Publishes routing decisions and outcomes to the lakehouse for analytics and ML training.
"""

import os
import json
import logging
import asyncio
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from enum import Enum

from aiokafka import AIOKafkaProducer
import redis.asyncio as redis
import asyncpg

def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[multi-bank-routing-service] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RoutingEventType(Enum):
    DECISION = "routing.decision"
    OUTCOME = "routing.outcome"
    FALLBACK = "routing.fallback"
    ML_PREDICTION = "routing.ml_prediction"
    LIQUIDITY_CHECK = "routing.liquidity_check"
    RECONCILIATION = "routing.reconciliation"


@dataclass
class RoutingDecisionEvent:
    """Event published when a routing decision is made"""
    transfer_id: str
    source_bank_code: str
    dest_bank_code: str
    amount: float
    currency: str
    selected_rail: str
    fallback_rails: List[str]
    score: float
    predicted_success_rate: float
    predicted_latency_ms: int
    predicted_cost: float
    model_version: str
    features: Dict[str, Any]
    liquidity_available: float
    decision_timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class RoutingOutcomeEvent:
    """Event published when routing outcome is known"""
    transfer_id: str
    source_bank_code: str
    dest_bank_code: str
    amount: float
    selected_rail: str
    was_successful: bool
    actual_latency_ms: int
    actual_cost: float
    error_code: Optional[str]
    error_message: Optional[str]
    predicted_success_rate: float
    predicted_latency_ms: int
    predicted_cost: float
    model_version: str
    outcome_timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class LiquidityEvent:
    """Event published for liquidity changes"""
    bank_code: str
    account_number: str
    available_balance: float
    reserved_balance: float
    daily_limit: float
    daily_used: float
    operation_type: str
    amount: float
    transfer_id: Optional[str]
    timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ReconciliationEvent:
    """Event published for reconciliation results"""
    reconciliation_id: str
    bank_code: str
    account_number: str
    statement_date: str
    expected_balance: float
    actual_balance: float
    discrepancy: float
    matched_transactions: int
    unmatched_transactions: int
    status: str
    timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class RoutingLakehousePublisher:
    """
    Publishes routing events to the lakehouse via Kafka.
    Supports both real-time streaming and batch publishing.
    """
    
    def __init__(
        self,
        kafka_brokers: str = None,
        redis_url: str = None,
        db_url: str = None
    ):
        self.kafka_brokers = kafka_brokers or os.getenv("KAFKA_BROKERS", "localhost:9092")
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379/0")
        self.db_url = db_url or _require_env("DATABASE_URL")
        
        # Connections
        self.producer: Optional[AIOKafkaProducer] = None
        self.redis_client: Optional[redis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        
        # Buffering for batch publishing
        self.event_buffer: List[Dict] = []
        self.buffer_size = 100
        self.flush_interval = 5.0  # seconds
        
        # Metrics
        self.metrics = {
            "decisions_published": 0,
            "outcomes_published": 0,
            "liquidity_events_published": 0,
            "reconciliation_events_published": 0,
            "publish_errors": 0,
        }
        
        # Background task
        self._flush_task: Optional[asyncio.Task] = None
        self._running = False
    
    async def initialize(self):
        """Initialize connections"""
        # Initialize Kafka producer
        try:
            self.producer = AIOKafkaProducer(
                bootstrap_servers=self.kafka_brokers,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                acks="all",  # Wait for all replicas
                enable_idempotence=True,  # Exactly-once semantics
            )
            await self.producer.start()
            logger.info("Kafka producer started")
        except Exception as e:
            logger.error(f"Failed to start Kafka producer: {e}")
        
        # Initialize Redis for caching
        try:
            self.redis_client = redis.from_url(self.redis_url)
            await self.redis_client.ping()
            logger.info("Redis connected")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
        
        # Initialize database pool for outbox pattern
        try:
            self.db_pool = await asyncpg.create_pool(
                self.db_url,
                min_size=2,
                max_size=10
            )
            await self._init_outbox_table()
            logger.info("Database pool initialized")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
        
        # Start background flush task
        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
    
    async def _init_outbox_table(self):
        """Initialize outbox table for guaranteed delivery"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS routing_outbox (
                    id SERIAL PRIMARY KEY,
                    event_id VARCHAR(255) UNIQUE NOT NULL,
                    event_type VARCHAR(100) NOT NULL,
                    topic VARCHAR(100) NOT NULL,
                    payload JSONB NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    published_at TIMESTAMPTZ,
                    retry_count INTEGER DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_routing_outbox_status 
                ON routing_outbox(status) WHERE status = 'pending';
            """)
    
    async def stop(self):
        """Stop the publisher"""
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        
        # Flush remaining events
        await self._flush_buffer()
        
        if self.producer:
            await self.producer.stop()
        if self.redis_client:
            await self.redis_client.close()
        if self.db_pool:
            await self.db_pool.close()
        
        logger.info("Routing lakehouse publisher stopped")
    
    async def _flush_loop(self):
        """Background task to periodically flush the event buffer"""
        while self._running:
            await asyncio.sleep(self.flush_interval)
            await self._flush_buffer()
    
    async def _flush_buffer(self):
        """Flush buffered events to Kafka"""
        if not self.event_buffer:
            return
        
        events = self.event_buffer
        self.event_buffer = []
        
        for event in events:
            try:
                await self._publish_event(event["topic"], event["data"])
            except Exception as e:
                logger.error(f"Failed to publish event: {e}")
                self.metrics["publish_errors"] += 1
    
    async def _publish_event(self, topic: str, event_data: Dict):
        """Publish a single event to Kafka"""
        if not self.producer:
            # Fall back to outbox if Kafka not available
            await self._write_to_outbox(topic, event_data)
            return
        
        try:
            await self.producer.send_and_wait(topic, event_data)
        except Exception as e:
            logger.error(f"Kafka publish failed, writing to outbox: {e}")
            await self._write_to_outbox(topic, event_data)
    
    async def _write_to_outbox(self, topic: str, event_data: Dict):
        """Write event to outbox table for later publishing"""
        if not self.db_pool:
            return
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO routing_outbox (event_id, event_type, topic, payload)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (event_id) DO NOTHING
            """,
                event_data.get("event_id"),
                event_data.get("event_type"),
                topic,
                json.dumps(event_data)
            )
    
    def _create_event_envelope(
        self,
        event_type: RoutingEventType,
        payload: Dict,
        correlation_id: str
    ) -> Dict:
        """Create a standardized event envelope"""
        import uuid
        event_id = str(uuid.uuid4())
        
        return {
            "event_id": event_id,
            "event_type": event_type.value,
            "event_version": "1.0",
            "timestamp": datetime.utcnow().isoformat(),
            "service_name": "multi-bank-routing",
            "service_version": "1.0.0",
            "correlation_id": correlation_id,
            "data_layer": "bronze",
            "contains_pii": False,
            "idempotency_key": f"routing-{correlation_id}-{event_type.value}",
            "payload": payload,
        }
    
    async def publish_routing_decision(self, decision: RoutingDecisionEvent):
        """Publish a routing decision event"""
        event = self._create_event_envelope(
            RoutingEventType.DECISION,
            decision.to_dict(),
            decision.transfer_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.routing",
            "data": event
        })
        
        self.metrics["decisions_published"] += 1
        
        # Also cache for quick lookup
        if self.redis_client:
            await self.redis_client.setex(
                f"routing:decision:{decision.transfer_id}",
                3600,  # 1 hour TTL
                json.dumps(decision.to_dict())
            )
        
        # Flush immediately if buffer is full
        if len(self.event_buffer) >= self.buffer_size:
            await self._flush_buffer()
    
    async def publish_routing_outcome(self, outcome: RoutingOutcomeEvent):
        """Publish a routing outcome event"""
        event = self._create_event_envelope(
            RoutingEventType.OUTCOME,
            outcome.to_dict(),
            outcome.transfer_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.routing",
            "data": event
        })
        
        self.metrics["outcomes_published"] += 1
        
        # Flush immediately for outcomes (important for ML training)
        await self._flush_buffer()
        
        # Also publish to ML features topic for real-time feature updates
        ml_event = self._create_event_envelope(
            RoutingEventType.ML_PREDICTION,
            {
                "transfer_id": outcome.transfer_id,
                "bank_code": outcome.dest_bank_code,
                "rail": outcome.selected_rail,
                "was_successful": outcome.was_successful,
                "actual_latency_ms": outcome.actual_latency_ms,
                "predicted_success_rate": outcome.predicted_success_rate,
                "predicted_latency_ms": outcome.predicted_latency_ms,
                "model_version": outcome.model_version,
                "timestamp": outcome.outcome_timestamp,
            },
            outcome.transfer_id
        )
        
        await self._publish_event("lakehouse.ml-features", ml_event)
    
    async def publish_liquidity_event(self, liquidity: LiquidityEvent):
        """Publish a liquidity change event"""
        event = self._create_event_envelope(
            RoutingEventType.LIQUIDITY_CHECK,
            liquidity.to_dict(),
            liquidity.transfer_id or f"liquidity-{liquidity.bank_code}"
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.float",
            "data": event
        })
        
        self.metrics["liquidity_events_published"] += 1
    
    async def publish_reconciliation_event(self, reconciliation: ReconciliationEvent):
        """Publish a reconciliation event"""
        event = self._create_event_envelope(
            RoutingEventType.RECONCILIATION,
            reconciliation.to_dict(),
            reconciliation.reconciliation_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.analytics",
            "data": event
        })
        
        self.metrics["reconciliation_events_published"] += 1
    
    async def process_outbox(self, batch_size: int = 100):
        """Process pending events from outbox table"""
        if not self.db_pool or not self.producer:
            return
        
        async with self.db_pool.acquire() as conn:
            # Get pending events
            rows = await conn.fetch("""
                SELECT id, event_id, topic, payload
                FROM routing_outbox
                WHERE status = 'pending' AND retry_count < 5
                ORDER BY created_at ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            """, batch_size)
            
            for row in rows:
                try:
                    payload = json.loads(row["payload"])
                    await self.producer.send_and_wait(row["topic"], payload)
                    
                    # Mark as published
                    await conn.execute("""
                        UPDATE routing_outbox
                        SET status = 'published', published_at = NOW()
                        WHERE id = $1
                    """, row["id"])
                    
                except Exception as e:
                    logger.error(f"Failed to publish outbox event {row['event_id']}: {e}")
                    
                    # Increment retry count
                    await conn.execute("""
                        UPDATE routing_outbox
                        SET retry_count = retry_count + 1
                        WHERE id = $1
                    """, row["id"])
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get publisher metrics"""
        return self.metrics.copy()


# Global publisher instance
_publisher: Optional[RoutingLakehousePublisher] = None


async def get_publisher() -> RoutingLakehousePublisher:
    """Get or create the global publisher instance"""
    global _publisher
    if _publisher is None:
        _publisher = RoutingLakehousePublisher()
        await _publisher.initialize()
    return _publisher


async def publish_decision(
    transfer_id: str,
    source_bank_code: str,
    dest_bank_code: str,
    amount: float,
    currency: str,
    selected_rail: str,
    fallback_rails: List[str],
    score: float,
    predicted_success_rate: float,
    predicted_latency_ms: int,
    predicted_cost: float,
    model_version: str,
    features: Dict[str, Any],
    liquidity_available: float
):
    """Convenience function to publish a routing decision"""
    publisher = await get_publisher()
    
    decision = RoutingDecisionEvent(
        transfer_id=transfer_id,
        source_bank_code=source_bank_code,
        dest_bank_code=dest_bank_code,
        amount=amount,
        currency=currency,
        selected_rail=selected_rail,
        fallback_rails=fallback_rails,
        score=score,
        predicted_success_rate=predicted_success_rate,
        predicted_latency_ms=predicted_latency_ms,
        predicted_cost=predicted_cost,
        model_version=model_version,
        features=features,
        liquidity_available=liquidity_available,
        decision_timestamp=datetime.utcnow().isoformat()
    )
    
    await publisher.publish_routing_decision(decision)


async def publish_outcome(
    transfer_id: str,
    source_bank_code: str,
    dest_bank_code: str,
    amount: float,
    selected_rail: str,
    was_successful: bool,
    actual_latency_ms: int,
    actual_cost: float,
    error_code: Optional[str],
    error_message: Optional[str],
    predicted_success_rate: float,
    predicted_latency_ms: int,
    predicted_cost: float,
    model_version: str
):
    """Convenience function to publish a routing outcome"""
    publisher = await get_publisher()
    
    outcome = RoutingOutcomeEvent(
        transfer_id=transfer_id,
        source_bank_code=source_bank_code,
        dest_bank_code=dest_bank_code,
        amount=amount,
        selected_rail=selected_rail,
        was_successful=was_successful,
        actual_latency_ms=actual_latency_ms,
        actual_cost=actual_cost,
        error_code=error_code,
        error_message=error_message,
        predicted_success_rate=predicted_success_rate,
        predicted_latency_ms=predicted_latency_ms,
        predicted_cost=predicted_cost,
        model_version=model_version,
        outcome_timestamp=datetime.utcnow().isoformat()
    )
    
    await publisher.publish_routing_outcome(outcome)
