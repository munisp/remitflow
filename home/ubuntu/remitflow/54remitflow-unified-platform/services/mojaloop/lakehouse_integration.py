"""
Mojaloop Lakehouse Integration
Publishes Mojaloop transfer, quote, and settlement events to the lakehouse.
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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MojaloopEventType(Enum):
    QUOTE_REQUEST = "mojaloop.quote.request"
    QUOTE_RESPONSE = "mojaloop.quote.response"
    TRANSFER_PREPARE = "mojaloop.transfer.prepare"
    TRANSFER_FULFIL = "mojaloop.transfer.fulfil"
    TRANSFER_ABORT = "mojaloop.transfer.abort"
    TRANSFER_TIMEOUT = "mojaloop.transfer.timeout"
    SETTLEMENT_WINDOW = "mojaloop.settlement.window"
    SETTLEMENT_TRANSFER = "mojaloop.settlement.transfer"
    PARTICIPANT_POSITION = "mojaloop.participant.position"


@dataclass
class QuoteEvent:
    """Mojaloop quote event"""
    quote_id: str
    transaction_id: str
    payer_fsp: str
    payee_fsp: str
    amount: float
    currency: str
    amount_type: str
    transaction_type: str
    fees: Optional[float]
    commission: Optional[float]
    expiration: Optional[str]
    ilp_packet: Optional[str]
    condition: Optional[str]
    status: str
    error_code: Optional[str]
    error_description: Optional[str]
    timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TransferEvent:
    """Mojaloop transfer event"""
    transfer_id: str
    quote_id: Optional[str]
    payer_fsp: str
    payee_fsp: str
    amount: float
    currency: str
    transfer_state: str
    ilp_packet: Optional[str]
    condition: Optional[str]
    fulfilment: Optional[str]
    expiration_date: Optional[str]
    completed_timestamp: Optional[str]
    error_code: Optional[str]
    error_description: Optional[str]
    extension_list: Optional[Dict[str, Any]]
    timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SettlementEvent:
    """Mojaloop settlement event"""
    settlement_id: str
    settlement_window_id: Optional[str]
    participant_id: str
    participant_currency: str
    state: str
    net_amount: float
    created_date: str
    changed_date: Optional[str]
    settlement_type: str
    timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ParticipantPositionEvent:
    """Mojaloop participant position event"""
    participant_id: str
    currency: str
    ledger_account_type: str
    value: float
    reserved_value: float
    changed_date: str
    timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class MojaloopLakehousePublisher:
    """
    Publishes Mojaloop events to the lakehouse via Kafka.
    """
    
    def __init__(
        self,
        kafka_brokers: str = None,
        redis_url: str = None
    ):
        self.kafka_brokers = kafka_brokers or os.getenv("KAFKA_BROKERS", "localhost:9092")
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379/0")
        
        # Connections
        self.producer: Optional[AIOKafkaProducer] = None
        self.redis_client: Optional[redis.Redis] = None
        
        # Buffering
        self.event_buffer: List[Dict] = []
        self.buffer_size = 50
        self.flush_interval = 3.0
        
        # Metrics
        self.metrics = {
            "quotes_published": 0,
            "transfers_published": 0,
            "settlements_published": 0,
            "positions_published": 0,
            "publish_errors": 0,
        }
        
        self._flush_task: Optional[asyncio.Task] = None
        self._running = False
    
    async def initialize(self):
        """Initialize connections"""
        try:
            self.producer = AIOKafkaProducer(
                bootstrap_servers=self.kafka_brokers,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                acks="all",
                enable_idempotence=True,
            )
            await self.producer.start()
            logger.info("Mojaloop Kafka producer started")
        except Exception as e:
            logger.error(f"Failed to start Kafka producer: {e}")
        
        try:
            self.redis_client = redis.from_url(self.redis_url)
            await self.redis_client.ping()
            logger.info("Redis connected")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
        
        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
    
    async def stop(self):
        """Stop the publisher"""
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        
        await self._flush_buffer()
        
        if self.producer:
            await self.producer.stop()
        if self.redis_client:
            await self.redis_client.close()
        
        logger.info("Mojaloop lakehouse publisher stopped")
    
    async def _flush_loop(self):
        """Background flush loop"""
        while self._running:
            await asyncio.sleep(self.flush_interval)
            await self._flush_buffer()
    
    async def _flush_buffer(self):
        """Flush buffered events"""
        if not self.event_buffer:
            return
        
        events = self.event_buffer
        self.event_buffer = []
        
        for event in events:
            try:
                if self.producer:
                    await self.producer.send_and_wait(event["topic"], event["data"])
            except Exception as e:
                logger.error(f"Failed to publish event: {e}")
                self.metrics["publish_errors"] += 1
    
    def _create_event_envelope(
        self,
        event_type: MojaloopEventType,
        payload: Dict,
        correlation_id: str
    ) -> Dict:
        """Create standardized event envelope"""
        import uuid
        event_id = str(uuid.uuid4())
        
        return {
            "event_id": event_id,
            "event_type": event_type.value,
            "event_version": "1.0",
            "timestamp": datetime.utcnow().isoformat(),
            "service_name": "mojaloop",
            "service_version": "1.0.0",
            "correlation_id": correlation_id,
            "data_layer": "bronze",
            "contains_pii": False,
            "idempotency_key": f"mojaloop-{correlation_id}-{event_type.value}",
            "payload": payload,
        }
    
    async def publish_quote_request(self, quote: QuoteEvent):
        """Publish quote request event"""
        event = self._create_event_envelope(
            MojaloopEventType.QUOTE_REQUEST,
            quote.to_dict(),
            quote.quote_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.mojaloop",
            "data": event
        })
        
        self.metrics["quotes_published"] += 1
        
        if len(self.event_buffer) >= self.buffer_size:
            await self._flush_buffer()
    
    async def publish_quote_response(self, quote: QuoteEvent):
        """Publish quote response event"""
        event = self._create_event_envelope(
            MojaloopEventType.QUOTE_RESPONSE,
            quote.to_dict(),
            quote.quote_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.mojaloop",
            "data": event
        })
        
        self.metrics["quotes_published"] += 1
    
    async def publish_transfer_prepare(self, transfer: TransferEvent):
        """Publish transfer prepare event"""
        event = self._create_event_envelope(
            MojaloopEventType.TRANSFER_PREPARE,
            transfer.to_dict(),
            transfer.transfer_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.mojaloop",
            "data": event
        })
        
        self.metrics["transfers_published"] += 1
        
        # Cache transfer for correlation
        if self.redis_client:
            await self.redis_client.setex(
                f"mojaloop:transfer:{transfer.transfer_id}",
                3600,
                json.dumps(transfer.to_dict())
            )
    
    async def publish_transfer_fulfil(self, transfer: TransferEvent):
        """Publish transfer fulfil event"""
        event = self._create_event_envelope(
            MojaloopEventType.TRANSFER_FULFIL,
            transfer.to_dict(),
            transfer.transfer_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.mojaloop",
            "data": event
        })
        
        self.metrics["transfers_published"] += 1
        
        # Flush immediately for completed transfers
        await self._flush_buffer()
        
        # Also publish to analytics for real-time dashboards
        analytics_event = self._create_event_envelope(
            MojaloopEventType.TRANSFER_FULFIL,
            {
                "transfer_id": transfer.transfer_id,
                "payer_fsp": transfer.payer_fsp,
                "payee_fsp": transfer.payee_fsp,
                "amount": transfer.amount,
                "currency": transfer.currency,
                "transfer_state": transfer.transfer_state,
                "completed_timestamp": transfer.completed_timestamp,
            },
            transfer.transfer_id
        )
        
        if self.producer:
            await self.producer.send_and_wait("lakehouse.analytics", analytics_event)
    
    async def publish_transfer_abort(self, transfer: TransferEvent):
        """Publish transfer abort event"""
        event = self._create_event_envelope(
            MojaloopEventType.TRANSFER_ABORT,
            transfer.to_dict(),
            transfer.transfer_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.mojaloop",
            "data": event
        })
        
        self.metrics["transfers_published"] += 1
        await self._flush_buffer()
    
    async def publish_settlement(self, settlement: SettlementEvent):
        """Publish settlement event"""
        event = self._create_event_envelope(
            MojaloopEventType.SETTLEMENT_TRANSFER,
            settlement.to_dict(),
            settlement.settlement_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.mojaloop",
            "data": event
        })
        
        self.metrics["settlements_published"] += 1
    
    async def publish_participant_position(self, position: ParticipantPositionEvent):
        """Publish participant position event"""
        event = self._create_event_envelope(
            MojaloopEventType.PARTICIPANT_POSITION,
            position.to_dict(),
            position.participant_id
        )
        
        self.event_buffer.append({
            "topic": "lakehouse.mojaloop",
            "data": event
        })
        
        self.metrics["positions_published"] += 1
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get publisher metrics"""
        return self.metrics.copy()


# Global publisher instance
_mojaloop_publisher: Optional[MojaloopLakehousePublisher] = None


async def get_mojaloop_publisher() -> MojaloopLakehousePublisher:
    """Get or create the global Mojaloop publisher"""
    global _mojaloop_publisher
    if _mojaloop_publisher is None:
        _mojaloop_publisher = MojaloopLakehousePublisher()
        await _mojaloop_publisher.initialize()
    return _mojaloop_publisher


# Convenience functions for publishing events
async def publish_quote(
    quote_id: str,
    transaction_id: str,
    payer_fsp: str,
    payee_fsp: str,
    amount: float,
    currency: str,
    status: str,
    is_response: bool = False,
    **kwargs
):
    """Publish a quote event"""
    publisher = await get_mojaloop_publisher()
    
    quote = QuoteEvent(
        quote_id=quote_id,
        transaction_id=transaction_id,
        payer_fsp=payer_fsp,
        payee_fsp=payee_fsp,
        amount=amount,
        currency=currency,
        amount_type=kwargs.get("amount_type", "SEND"),
        transaction_type=kwargs.get("transaction_type", "TRANSFER"),
        fees=kwargs.get("fees"),
        commission=kwargs.get("commission"),
        expiration=kwargs.get("expiration"),
        ilp_packet=kwargs.get("ilp_packet"),
        condition=kwargs.get("condition"),
        status=status,
        error_code=kwargs.get("error_code"),
        error_description=kwargs.get("error_description"),
        timestamp=datetime.utcnow().isoformat()
    )
    
    if is_response:
        await publisher.publish_quote_response(quote)
    else:
        await publisher.publish_quote_request(quote)


async def publish_transfer(
    transfer_id: str,
    payer_fsp: str,
    payee_fsp: str,
    amount: float,
    currency: str,
    transfer_state: str,
    **kwargs
):
    """Publish a transfer event"""
    publisher = await get_mojaloop_publisher()
    
    transfer = TransferEvent(
        transfer_id=transfer_id,
        quote_id=kwargs.get("quote_id"),
        payer_fsp=payer_fsp,
        payee_fsp=payee_fsp,
        amount=amount,
        currency=currency,
        transfer_state=transfer_state,
        ilp_packet=kwargs.get("ilp_packet"),
        condition=kwargs.get("condition"),
        fulfilment=kwargs.get("fulfilment"),
        expiration_date=kwargs.get("expiration_date"),
        completed_timestamp=kwargs.get("completed_timestamp"),
        error_code=kwargs.get("error_code"),
        error_description=kwargs.get("error_description"),
        extension_list=kwargs.get("extension_list"),
        timestamp=datetime.utcnow().isoformat()
    )
    
    if transfer_state == "RESERVED":
        await publisher.publish_transfer_prepare(transfer)
    elif transfer_state == "COMMITTED":
        await publisher.publish_transfer_fulfil(transfer)
    elif transfer_state in ["ABORTED", "REJECTED"]:
        await publisher.publish_transfer_abort(transfer)


async def publish_settlement(
    settlement_id: str,
    participant_id: str,
    participant_currency: str,
    state: str,
    net_amount: float,
    **kwargs
):
    """Publish a settlement event"""
    publisher = await get_mojaloop_publisher()
    
    settlement = SettlementEvent(
        settlement_id=settlement_id,
        settlement_window_id=kwargs.get("settlement_window_id"),
        participant_id=participant_id,
        participant_currency=participant_currency,
        state=state,
        net_amount=net_amount,
        created_date=kwargs.get("created_date", datetime.utcnow().isoformat()),
        changed_date=kwargs.get("changed_date"),
        settlement_type=kwargs.get("settlement_type", "NET_DEBIT_CAP"),
        timestamp=datetime.utcnow().isoformat()
    )
    
    await publisher.publish_settlement(settlement)
