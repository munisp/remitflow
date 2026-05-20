"""
Kafka Producer Module for Event-Driven Architecture
Provides reliable event publishing with idempotency and retries
"""

import json
import os
import logging
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, asdict
from uuid import uuid4
import hashlib

logger = logging.getLogger(__name__)

# Configuration
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka-1:9092,kafka-2:9092,kafka-3:9092").split(",")
KAFKA_ENABLED = os.getenv("KAFKA_ENABLED", "true").lower() == "true"


class EventType(str, Enum):
    """Standard event types for the platform"""
    # Transaction Events
    TRANSACTION_CREATED = "transaction.created"
    TRANSACTION_PENDING = "transaction.pending"
    TRANSACTION_COMPLETED = "transaction.completed"
    TRANSACTION_FAILED = "transaction.failed"
    TRANSACTION_REVERSED = "transaction.reversed"
    
    # Payment Events
    PAYMENT_INITIATED = "payment.initiated"
    PAYMENT_PROCESSING = "payment.processing"
    PAYMENT_COMPLETED = "payment.completed"
    PAYMENT_FAILED = "payment.failed"
    PAYMENT_REFUNDED = "payment.refunded"
    
    # Wallet Events
    WALLET_CREATED = "wallet.created"
    WALLET_CREDITED = "wallet.credited"
    WALLET_DEBITED = "wallet.debited"
    WALLET_FROZEN = "wallet.frozen"
    WALLET_UNFROZEN = "wallet.unfrozen"
    
    # KYC Events
    KYC_SUBMITTED = "kyc.submitted"
    KYC_VERIFIED = "kyc.verified"
    KYC_REJECTED = "kyc.rejected"
    KYC_UPGRADED = "kyc.upgraded"
    
    # Risk Events
    RISK_ASSESSED = "risk.assessed"
    RISK_FLAGGED = "risk.flagged"
    RISK_CLEARED = "risk.cleared"
    
    # Compliance Events
    COMPLIANCE_CHECK_PASSED = "compliance.check_passed"
    COMPLIANCE_CHECK_FAILED = "compliance.check_failed"
    SAR_FILED = "compliance.sar_filed"
    
    # Limit Events
    LIMIT_CHECKED = "limit.checked"
    LIMIT_EXCEEDED = "limit.exceeded"
    LIMIT_UPDATED = "limit.updated"
    
    # Dispute Events
    DISPUTE_OPENED = "dispute.opened"
    DISPUTE_INVESTIGATING = "dispute.investigating"
    DISPUTE_RESOLVED = "dispute.resolved"
    
    # Reconciliation Events
    RECONCILIATION_STARTED = "reconciliation.started"
    RECONCILIATION_COMPLETED = "reconciliation.completed"
    DISCREPANCY_FOUND = "reconciliation.discrepancy_found"


class Topic(str, Enum):
    """Kafka topics for the platform"""
    TRANSACTIONS = "remittance.transactions"
    PAYMENTS = "remittance.payments"
    WALLETS = "remittance.wallets"
    KYC = "remittance.kyc"
    RISK = "remittance.risk"
    COMPLIANCE = "remittance.compliance"
    LIMITS = "remittance.limits"
    DISPUTES = "remittance.disputes"
    RECONCILIATION = "remittance.reconciliation"
    ANALYTICS = "remittance.analytics"
    AUDIT = "remittance.audit"
    NOTIFICATIONS = "remittance.notifications"


@dataclass
class Event:
    """Standard event structure"""
    event_id: str
    event_type: str
    timestamp: str
    source_service: str
    correlation_id: str
    payload: Dict[str, Any]
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str)
    
    @classmethod
    def create(
        cls,
        event_type: EventType,
        source_service: str,
        payload: Dict[str, Any],
        correlation_id: str = None,
        metadata: Dict[str, Any] = None
    ) -> "Event":
        return cls(
            event_id=str(uuid4()),
            event_type=event_type.value if isinstance(event_type, EventType) else event_type,
            timestamp=datetime.utcnow().isoformat(),
            source_service=source_service,
            correlation_id=correlation_id or str(uuid4()),
            payload=payload,
            metadata=metadata or {}
        )


class KafkaProducer:
    """
    Kafka producer with idempotency and retry support
    Falls back to logging if Kafka is unavailable
    """
    
    def __init__(self, service_name: str, brokers: List[str] = None):
        self.service_name = service_name
        self.brokers = brokers or KAFKA_BROKERS
        self.producer = None
        self._initialized = False
        self._fallback_mode = False
    
    async def initialize(self):
        """Initialize Kafka producer"""
        if not KAFKA_ENABLED:
            logger.info("Kafka disabled, using fallback mode")
            self._fallback_mode = True
            self._initialized = True
            return
        
        try:
            # Try to import aiokafka
            from aiokafka import AIOKafkaProducer
            
            self.producer = AIOKafkaProducer(
                bootstrap_servers=self.brokers,
                value_serializer=lambda v: json.dumps(v, default=str).encode('utf-8'),
                key_serializer=lambda k: k.encode('utf-8') if k else None,
                acks='all',  # Wait for all replicas
                retries=3,
                retry_backoff_ms=100,
                enable_idempotence=True,  # Exactly-once semantics
                max_in_flight_requests_per_connection=5
            )
            await self.producer.start()
            self._initialized = True
            logger.info(f"Kafka producer initialized for {self.service_name}")
        except ImportError:
            logger.warning("aiokafka not installed, using fallback mode")
            self._fallback_mode = True
            self._initialized = True
        except Exception as e:
            logger.warning(f"Failed to initialize Kafka producer: {e}, using fallback mode")
            self._fallback_mode = True
            self._initialized = True
    
    async def close(self):
        """Close Kafka producer"""
        if self.producer:
            await self.producer.stop()
            logger.info(f"Kafka producer closed for {self.service_name}")
    
    def _generate_idempotency_key(self, event: Event) -> str:
        """Generate idempotency key for event"""
        key_data = f"{event.event_type}:{event.correlation_id}:{event.payload.get('id', '')}"
        return hashlib.sha256(key_data.encode()).hexdigest()[:16]
    
    async def publish(
        self,
        topic: Topic,
        event: Event,
        partition_key: str = None
    ) -> bool:
        """
        Publish event to Kafka topic
        
        Args:
            topic: Kafka topic
            event: Event to publish
            partition_key: Optional key for partitioning
        
        Returns:
            True if published successfully
        """
        if not self._initialized:
            await self.initialize()
        
        # Generate partition key if not provided
        key = partition_key or self._generate_idempotency_key(event)
        topic_name = topic.value if isinstance(topic, Topic) else topic
        
        if self._fallback_mode:
            # Log event instead of publishing to Kafka
            logger.info(f"[KAFKA-FALLBACK] Topic: {topic_name}, Key: {key}, Event: {event.to_json()}")
            return True
        
        try:
            await self.producer.send_and_wait(
                topic_name,
                value=event.to_dict(),
                key=key
            )
            logger.debug(f"Published event {event.event_id} to {topic_name}")
            
            # Track metrics if available
            try:
                from metrics import track_kafka_produce
                track_kafka_produce(topic_name)
            except ImportError:
                pass
            
            return True
        except Exception as e:
            logger.error(f"Failed to publish event to {topic_name}: {e}")
            # Fall back to logging
            logger.info(f"[KAFKA-FALLBACK] Topic: {topic_name}, Key: {key}, Event: {event.to_json()}")
            return False
    
    async def publish_transaction_event(
        self,
        event_type: EventType,
        transaction_id: str,
        user_id: str,
        amount: float,
        currency: str,
        corridor: str = None,
        status: str = None,
        metadata: Dict[str, Any] = None
    ) -> bool:
        """Publish transaction event"""
        event = Event.create(
            event_type=event_type,
            source_service=self.service_name,
            payload={
                "transaction_id": transaction_id,
                "user_id": user_id,
                "amount": amount,
                "currency": currency,
                "corridor": corridor,
                "status": status
            },
            correlation_id=transaction_id,
            metadata=metadata
        )
        return await self.publish(Topic.TRANSACTIONS, event, partition_key=user_id)
    
    async def publish_wallet_event(
        self,
        event_type: EventType,
        wallet_id: str,
        user_id: str,
        amount: float = None,
        currency: str = None,
        balance: float = None,
        metadata: Dict[str, Any] = None
    ) -> bool:
        """Publish wallet event"""
        event = Event.create(
            event_type=event_type,
            source_service=self.service_name,
            payload={
                "wallet_id": wallet_id,
                "user_id": user_id,
                "amount": amount,
                "currency": currency,
                "balance": balance
            },
            correlation_id=wallet_id,
            metadata=metadata
        )
        return await self.publish(Topic.WALLETS, event, partition_key=user_id)
    
    async def publish_risk_event(
        self,
        event_type: EventType,
        transaction_id: str,
        user_id: str,
        risk_score: float,
        decision: str,
        factors: List[str] = None,
        metadata: Dict[str, Any] = None
    ) -> bool:
        """Publish risk event"""
        event = Event.create(
            event_type=event_type,
            source_service=self.service_name,
            payload={
                "transaction_id": transaction_id,
                "user_id": user_id,
                "risk_score": risk_score,
                "decision": decision,
                "factors": factors or []
            },
            correlation_id=transaction_id,
            metadata=metadata
        )
        return await self.publish(Topic.RISK, event, partition_key=transaction_id)
    
    async def publish_compliance_event(
        self,
        event_type: EventType,
        entity_id: str,
        entity_type: str,
        check_type: str,
        result: str,
        details: Dict[str, Any] = None,
        metadata: Dict[str, Any] = None
    ) -> bool:
        """Publish compliance event"""
        event = Event.create(
            event_type=event_type,
            source_service=self.service_name,
            payload={
                "entity_id": entity_id,
                "entity_type": entity_type,
                "check_type": check_type,
                "result": result,
                "details": details or {}
            },
            correlation_id=entity_id,
            metadata=metadata
        )
        return await self.publish(Topic.COMPLIANCE, event, partition_key=entity_id)
    
    async def publish_audit_event(
        self,
        action: str,
        actor_id: str,
        resource_type: str,
        resource_id: str,
        changes: Dict[str, Any] = None,
        metadata: Dict[str, Any] = None
    ) -> bool:
        """Publish audit event"""
        event = Event.create(
            event_type="audit.action",
            source_service=self.service_name,
            payload={
                "action": action,
                "actor_id": actor_id,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "changes": changes or {}
            },
            correlation_id=resource_id,
            metadata=metadata
        )
        return await self.publish(Topic.AUDIT, event, partition_key=actor_id)


# Global producer instance (lazy initialization)
_producer_instance: Optional[KafkaProducer] = None


def get_producer(service_name: str = None) -> KafkaProducer:
    """Get or create Kafka producer instance"""
    global _producer_instance
    if _producer_instance is None:
        svc_name = service_name or os.getenv("SERVICE_NAME", "unknown")
        _producer_instance = KafkaProducer(svc_name)
    return _producer_instance


async def publish_event(
    topic: Topic,
    event_type: EventType,
    payload: Dict[str, Any],
    correlation_id: str = None,
    partition_key: str = None,
    service_name: str = None
) -> bool:
    """
    Convenience function to publish events
    
    Usage:
        await publish_event(
            Topic.TRANSACTIONS,
            EventType.TRANSACTION_CREATED,
            {"transaction_id": "123", "amount": 100},
            correlation_id="123"
        )
    """
    producer = get_producer(service_name)
    event = Event.create(
        event_type=event_type,
        source_service=producer.service_name,
        payload=payload,
        correlation_id=correlation_id
    )
    return await producer.publish(topic, event, partition_key)
