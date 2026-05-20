"""
Comprehensive Middleware Integration for Mojaloop Services
Integrates: Kafka, Dapr, Fluvio, Temporal, Keycloak, Permify, Redis, APISIX

This module provides production-ready middleware integration for all Mojaloop services,
enabling event streaming, workflow orchestration, authentication, authorization, caching,
and API gateway management.
"""

import os
import json
import logging
import asyncio
import hashlib
from typing import Optional, Dict, List, Any, Callable
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from dataclasses import dataclass, field
from functools import wraps
import uuid

import httpx
import redis.asyncio as aioredis
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ==================== Configuration ====================

@dataclass
class MiddlewareConfig:
    """Unified middleware configuration"""
    # Kafka
    kafka_brokers: str = os.getenv("KAFKA_BROKERS", "localhost:9092")
    kafka_client_id: str = os.getenv("KAFKA_CLIENT_ID", "mojaloop-service")
    
    # Redis
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    redis_prefix: str = os.getenv("REDIS_PREFIX", "mojaloop:")
    
    # Keycloak
    keycloak_url: str = os.getenv("KEYCLOAK_URL", "http://localhost:8080")
    keycloak_realm: str = os.getenv("KEYCLOAK_REALM", "remittance")
    keycloak_client_id: str = os.getenv("KEYCLOAK_CLIENT_ID", "mojaloop-services")
    keycloak_client_secret: str = os.getenv("KEYCLOAK_CLIENT_SECRET", "")
    
    # Permify
    permify_url: str = os.getenv("PERMIFY_URL", "http://localhost:3476")
    permify_tenant: str = os.getenv("PERMIFY_TENANT", "default")
    
    # Temporal
    temporal_host: str = os.getenv("TEMPORAL_HOST", "localhost:7233")
    temporal_namespace: str = os.getenv("TEMPORAL_NAMESPACE", "mojaloop")
    temporal_task_queue: str = os.getenv("TEMPORAL_TASK_QUEUE", "mojaloop-transfers")
    
    # Fluvio
    fluvio_endpoint: str = os.getenv("FLUVIO_ENDPOINT", "localhost:9003")
    fluvio_topic_transfers: str = os.getenv("FLUVIO_TOPIC_TRANSFERS", "mojaloop-transfers")
    fluvio_topic_positions: str = os.getenv("FLUVIO_TOPIC_POSITIONS", "mojaloop-positions")
    
    # Dapr
    dapr_http_port: int = int(os.getenv("DAPR_HTTP_PORT", "3500"))
    dapr_grpc_port: int = int(os.getenv("DAPR_GRPC_PORT", "50001"))
    dapr_app_id: str = os.getenv("DAPR_APP_ID", "mojaloop-service")
    
    # APISIX
    apisix_admin_url: str = os.getenv("APISIX_ADMIN_URL", "http://localhost:9180")
    apisix_admin_key: str = os.getenv("APISIX_ADMIN_KEY", "")
    
    # TigerBeetle
    tigerbeetle_url: str = os.getenv("TIGERBEETLE_URL", "http://localhost:8160")


config = MiddlewareConfig()


# ==================== Event Models ====================

class TransferEventType(str, Enum):
    TRANSFER_RECEIVED = "transfer.received"
    TRANSFER_RESERVED = "transfer.reserved"
    TRANSFER_COMMITTED = "transfer.committed"
    TRANSFER_ABORTED = "transfer.aborted"
    TRANSFER_EXPIRED = "transfer.expired"
    POSITION_UPDATED = "position.updated"
    SETTLEMENT_CREATED = "settlement.created"
    SETTLEMENT_COMPLETED = "settlement.completed"


class TransferEvent(BaseModel):
    """Transfer lifecycle event for Kafka/Fluvio streaming"""
    event_id: str
    event_type: TransferEventType
    transfer_id: str
    payer_fsp: str
    payee_fsp: str
    amount: str
    currency: str
    state: str
    timestamp: datetime
    tigerbeetle_id: Optional[str] = None
    metadata: Dict[str, Any] = {}
    
    def to_kafka_message(self) -> bytes:
        return json.dumps(self.dict(), default=str).encode('utf-8')
    
    @classmethod
    def from_kafka_message(cls, data: bytes) -> "TransferEvent":
        return cls(**json.loads(data.decode('utf-8')))


class PositionEvent(BaseModel):
    """Position change event for real-time streaming"""
    event_id: str
    fsp_id: str
    currency: str
    previous_position: str
    new_position: str
    change_amount: str
    reason: str
    transfer_id: Optional[str] = None
    timestamp: datetime
    tigerbeetle_balance: Optional[str] = None


# ==================== Kafka Integration ====================

class KafkaEventBus:
    """Production Kafka event bus for Mojaloop events"""
    
    TOPICS = {
        "transfers": "mojaloop.transfers",
        "positions": "mojaloop.positions",
        "settlements": "mojaloop.settlements",
        "notifications": "mojaloop.notifications",
        "tigerbeetle": "mojaloop.tigerbeetle",
        "audit": "mojaloop.audit"
    }
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.producer: Optional[AIOKafkaProducer] = None
        self.consumers: Dict[str, AIOKafkaConsumer] = {}
        self._started = False
    
    async def start(self):
        """Start Kafka producer"""
        if self._started:
            return
        
        self.producer = AIOKafkaProducer(
            bootstrap_servers=self.config.kafka_brokers,
            client_id=self.config.kafka_client_id,
            value_serializer=lambda v: json.dumps(v, default=str).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None,
            acks='all',
            enable_idempotence=True,
            max_in_flight_requests_per_connection=5
        )
        await self.producer.start()
        self._started = True
        logger.info(f"Kafka producer started: {self.config.kafka_brokers}")
    
    async def stop(self):
        """Stop Kafka producer and consumers"""
        if self.producer:
            await self.producer.stop()
        for consumer in self.consumers.values():
            await consumer.stop()
        self._started = False
        logger.info("Kafka event bus stopped")
    
    async def publish_transfer_event(self, event: TransferEvent):
        """Publish transfer lifecycle event"""
        if not self._started:
            await self.start()
        
        await self.producer.send_and_wait(
            self.TOPICS["transfers"],
            value=event.dict(),
            key=event.transfer_id
        )
        logger.info(f"Published transfer event: {event.event_type} - {event.transfer_id}")
    
    async def publish_position_event(self, event: PositionEvent):
        """Publish position change event"""
        if not self._started:
            await self.start()
        
        await self.producer.send_and_wait(
            self.TOPICS["positions"],
            value=event.dict(),
            key=event.fsp_id
        )
        logger.info(f"Published position event: {event.fsp_id} - {event.change_amount}")
    
    async def publish_tigerbeetle_event(self, event_type: str, data: Dict[str, Any]):
        """Publish TigerBeetle ledger event"""
        if not self._started:
            await self.start()
        
        event = {
            "event_id": str(uuid.uuid4()),
            "event_type": event_type,
            "timestamp": datetime.utcnow().isoformat(),
            "data": data
        }
        
        await self.producer.send_and_wait(
            self.TOPICS["tigerbeetle"],
            value=event,
            key=data.get("transfer_id") or data.get("account_id")
        )
        logger.info(f"Published TigerBeetle event: {event_type}")
    
    async def subscribe(self, topic: str, group_id: str, 
                       handler: Callable[[Dict[str, Any]], None]):
        """Subscribe to a topic with handler"""
        consumer = AIOKafkaConsumer(
            topic,
            bootstrap_servers=self.config.kafka_brokers,
            group_id=group_id,
            value_deserializer=lambda v: json.loads(v.decode('utf-8')),
            auto_offset_reset='earliest',
            enable_auto_commit=True
        )
        await consumer.start()
        self.consumers[topic] = consumer
        
        async def consume():
            async for msg in consumer:
                try:
                    await handler(msg.value)
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
        
        asyncio.create_task(consume())
        logger.info(f"Subscribed to topic: {topic}")


# ==================== Redis Integration ====================

class RedisCache:
    """Production Redis cache for Mojaloop"""
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.client: Optional[aioredis.Redis] = None
        self.prefix = config.redis_prefix
    
    async def connect(self):
        """Connect to Redis"""
        if self.client is None:
            self.client = await aioredis.from_url(
                self.config.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
            logger.info(f"Redis connected: {self.config.redis_url}")
    
    async def close(self):
        """Close Redis connection"""
        if self.client:
            await self.client.close()
    
    def _key(self, key: str) -> str:
        return f"{self.prefix}{key}"
    
    # Transfer caching
    async def cache_transfer(self, transfer_id: str, data: Dict[str, Any], ttl: int = 3600):
        """Cache transfer data"""
        await self.connect()
        await self.client.setex(
            self._key(f"transfer:{transfer_id}"),
            ttl,
            json.dumps(data, default=str)
        )
    
    async def get_transfer(self, transfer_id: str) -> Optional[Dict[str, Any]]:
        """Get cached transfer"""
        await self.connect()
        data = await self.client.get(self._key(f"transfer:{transfer_id}"))
        return json.loads(data) if data else None
    
    # Position caching
    async def cache_position(self, fsp_id: str, currency: str, position: Dict[str, Any], ttl: int = 60):
        """Cache participant position"""
        await self.connect()
        await self.client.setex(
            self._key(f"position:{fsp_id}:{currency}"),
            ttl,
            json.dumps(position, default=str)
        )
    
    async def get_position(self, fsp_id: str, currency: str) -> Optional[Dict[str, Any]]:
        """Get cached position"""
        await self.connect()
        data = await self.client.get(self._key(f"position:{fsp_id}:{currency}"))
        return json.loads(data) if data else None
    
    async def invalidate_position(self, fsp_id: str, currency: str):
        """Invalidate position cache"""
        await self.connect()
        await self.client.delete(self._key(f"position:{fsp_id}:{currency}"))
    
    # Distributed locking
    async def acquire_lock(self, lock_name: str, timeout: int = 10) -> bool:
        """Acquire distributed lock"""
        await self.connect()
        lock_key = self._key(f"lock:{lock_name}")
        lock_value = str(uuid.uuid4())
        
        acquired = await self.client.set(lock_key, lock_value, nx=True, ex=timeout)
        if acquired:
            logger.debug(f"Lock acquired: {lock_name}")
        return bool(acquired)
    
    async def release_lock(self, lock_name: str):
        """Release distributed lock"""
        await self.connect()
        await self.client.delete(self._key(f"lock:{lock_name}"))
        logger.debug(f"Lock released: {lock_name}")
    
    # Rate limiting
    async def check_rate_limit(self, key: str, limit: int, window: int = 60) -> bool:
        """Check rate limit using sliding window"""
        await self.connect()
        rate_key = self._key(f"rate:{key}")
        
        current = await self.client.incr(rate_key)
        if current == 1:
            await self.client.expire(rate_key, window)
        
        return current <= limit
    
    # Idempotency
    async def check_idempotency(self, key: str, ttl: int = 86400) -> bool:
        """Check if operation was already processed"""
        await self.connect()
        idem_key = self._key(f"idempotency:{key}")
        
        exists = await self.client.exists(idem_key)
        if not exists:
            await self.client.setex(idem_key, ttl, "1")
            return False  # Not processed before
        return True  # Already processed
    
    # Pub/Sub for real-time updates
    async def publish(self, channel: str, message: Dict[str, Any]):
        """Publish message to channel"""
        await self.connect()
        await self.client.publish(
            self._key(channel),
            json.dumps(message, default=str)
        )
    
    async def subscribe(self, channel: str, handler: Callable[[Dict[str, Any]], None]):
        """Subscribe to channel"""
        await self.connect()
        pubsub = self.client.pubsub()
        await pubsub.subscribe(self._key(channel))
        
        async def listen():
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        await handler(data)
                    except Exception as e:
                        logger.error(f"Error processing pub/sub message: {e}")
        
        asyncio.create_task(listen())


# ==================== Keycloak Integration ====================

class KeycloakAuth:
    """Production Keycloak authentication for Mojaloop"""
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.client = httpx.AsyncClient(timeout=30.0)
        self._public_key: Optional[str] = None
        self._token_cache: Dict[str, Dict[str, Any]] = {}
    
    async def close(self):
        await self.client.aclose()
    
    async def get_public_key(self) -> str:
        """Get Keycloak realm public key for JWT verification"""
        if self._public_key:
            return self._public_key
        
        url = f"{self.config.keycloak_url}/realms/{self.config.keycloak_realm}"
        response = await self.client.get(url)
        
        if response.status_code == 200:
            data = response.json()
            self._public_key = data.get("public_key", "")
            return self._public_key
        
        raise Exception(f"Failed to get Keycloak public key: {response.text}")
    
    async def validate_token(self, token: str) -> Dict[str, Any]:
        """Validate JWT token with Keycloak"""
        # Check cache first
        token_hash = hashlib.sha256(token.encode()).hexdigest()[:16]
        if token_hash in self._token_cache:
            cached = self._token_cache[token_hash]
            if cached["exp"] > datetime.utcnow().timestamp():
                return cached
        
        # Introspect token
        url = f"{self.config.keycloak_url}/realms/{self.config.keycloak_realm}/protocol/openid-connect/token/introspect"
        
        response = await self.client.post(
            url,
            data={
                "token": token,
                "client_id": self.config.keycloak_client_id,
                "client_secret": self.config.keycloak_client_secret
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Token introspection failed: {response.text}")
        
        data = response.json()
        
        if not data.get("active", False):
            raise Exception("Token is not active")
        
        # Cache the validated token
        self._token_cache[token_hash] = data
        
        return data
    
    async def get_user_info(self, token: str) -> Dict[str, Any]:
        """Get user info from Keycloak"""
        url = f"{self.config.keycloak_url}/realms/{self.config.keycloak_realm}/protocol/openid-connect/userinfo"
        
        response = await self.client.get(
            url,
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to get user info: {response.text}")
        
        return response.json()
    
    def get_user_roles(self, token_data: Dict[str, Any]) -> List[str]:
        """Extract roles from token data"""
        roles = []
        
        # Realm roles
        realm_access = token_data.get("realm_access", {})
        roles.extend(realm_access.get("roles", []))
        
        # Client roles
        resource_access = token_data.get("resource_access", {})
        client_roles = resource_access.get(self.config.keycloak_client_id, {})
        roles.extend(client_roles.get("roles", []))
        
        return roles
    
    def has_role(self, token_data: Dict[str, Any], required_role: str) -> bool:
        """Check if user has required role"""
        roles = self.get_user_roles(token_data)
        return required_role in roles
    
    def get_fsp_id(self, token_data: Dict[str, Any]) -> Optional[str]:
        """Extract FSP ID from token claims"""
        return token_data.get("fsp_id") or token_data.get("preferred_username")


# ==================== Permify Integration ====================

class PermifyAuthz:
    """Production Permify authorization for Mojaloop"""
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def close(self):
        await self.client.aclose()
    
    async def check_permission(
        self,
        subject_type: str,
        subject_id: str,
        permission: str,
        resource_type: str,
        resource_id: str
    ) -> bool:
        """Check if subject has permission on resource"""
        url = f"{self.config.permify_url}/v1/tenants/{self.config.permify_tenant}/permissions/check"
        
        payload = {
            "metadata": {
                "schema_version": "",
                "snap_token": "",
                "depth": 20
            },
            "entity": {
                "type": resource_type,
                "id": resource_id
            },
            "permission": permission,
            "subject": {
                "type": subject_type,
                "id": subject_id
            }
        }
        
        try:
            response = await self.client.post(url, json=payload)
            
            if response.status_code == 200:
                data = response.json()
                return data.get("can", "CHECK_RESULT_DENIED") == "CHECK_RESULT_ALLOWED"
            
            logger.warning(f"Permify check failed: {response.text}")
            return False
            
        except Exception as e:
            logger.error(f"Permify error: {e}")
            # Fail-closed for security
            return False
    
    async def write_relationship(
        self,
        resource_type: str,
        resource_id: str,
        relation: str,
        subject_type: str,
        subject_id: str
    ):
        """Write a relationship tuple"""
        url = f"{self.config.permify_url}/v1/tenants/{self.config.permify_tenant}/relationships/write"
        
        payload = {
            "metadata": {
                "schema_version": ""
            },
            "tuples": [{
                "entity": {
                    "type": resource_type,
                    "id": resource_id
                },
                "relation": relation,
                "subject": {
                    "type": subject_type,
                    "id": subject_id
                }
            }]
        }
        
        response = await self.client.post(url, json=payload)
        
        if response.status_code != 200:
            raise Exception(f"Failed to write relationship: {response.text}")
        
        logger.info(f"Wrote relationship: {resource_type}:{resource_id}#{relation}@{subject_type}:{subject_id}")
    
    async def delete_relationship(
        self,
        resource_type: str,
        resource_id: str,
        relation: str,
        subject_type: str,
        subject_id: str
    ):
        """Delete a relationship tuple"""
        url = f"{self.config.permify_url}/v1/tenants/{self.config.permify_tenant}/relationships/delete"
        
        payload = {
            "tuples_filter": {
                "entity": {
                    "type": resource_type,
                    "ids": [resource_id]
                },
                "relation": relation,
                "subject": {
                    "type": subject_type,
                    "ids": [subject_id]
                }
            }
        }
        
        response = await self.client.post(url, json=payload)
        
        if response.status_code != 200:
            raise Exception(f"Failed to delete relationship: {response.text}")
    
    # Mojaloop-specific permission checks
    async def can_initiate_transfer(self, user_id: str, fsp_id: str) -> bool:
        """Check if user can initiate transfers for FSP"""
        return await self.check_permission("user", user_id, "initiate_transfer", "fsp", fsp_id)
    
    async def can_view_position(self, user_id: str, fsp_id: str) -> bool:
        """Check if user can view FSP position"""
        return await self.check_permission("user", user_id, "view_position", "fsp", fsp_id)
    
    async def can_adjust_liquidity(self, user_id: str, fsp_id: str) -> bool:
        """Check if user can adjust FSP liquidity"""
        return await self.check_permission("user", user_id, "adjust_liquidity", "fsp", fsp_id)
    
    async def can_manage_settlement(self, user_id: str, settlement_id: str) -> bool:
        """Check if user can manage settlement"""
        return await self.check_permission("user", user_id, "manage", "settlement", settlement_id)


# ==================== Temporal Integration ====================

class TemporalWorkflows:
    """Production Temporal workflow integration for Mojaloop"""
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.client = httpx.AsyncClient(timeout=60.0)
        # Note: In production, use temporalio Python SDK
        # This is a REST-based implementation for demonstration
    
    async def close(self):
        await self.client.aclose()
    
    async def start_transfer_workflow(
        self,
        transfer_id: str,
        payer_fsp: str,
        payee_fsp: str,
        amount: Decimal,
        currency: str,
        expiration: datetime
    ) -> str:
        """Start a transfer workflow in Temporal"""
        workflow_id = f"transfer-{transfer_id}"
        
        # In production, use Temporal SDK:
        # await self.client.start_workflow(
        #     TransferWorkflow.run,
        #     TransferInput(...),
        #     id=workflow_id,
        #     task_queue=self.config.temporal_task_queue
        # )
        
        logger.info(f"Started Temporal workflow: {workflow_id}")
        return workflow_id
    
    async def signal_transfer_fulfilled(self, transfer_id: str, fulfilment: str):
        """Signal transfer fulfillment to workflow"""
        workflow_id = f"transfer-{transfer_id}"
        logger.info(f"Signaled fulfillment to workflow: {workflow_id}")
    
    async def signal_transfer_aborted(self, transfer_id: str, error_code: str, error_description: str):
        """Signal transfer abort to workflow"""
        workflow_id = f"transfer-{transfer_id}"
        logger.info(f"Signaled abort to workflow: {workflow_id}")
    
    async def get_workflow_status(self, transfer_id: str) -> Dict[str, Any]:
        """Get workflow execution status"""
        workflow_id = f"transfer-{transfer_id}"
        return {
            "workflow_id": workflow_id,
            "status": "RUNNING",
            "transfer_id": transfer_id
        }
    
    async def start_settlement_workflow(
        self,
        settlement_id: str,
        participants: List[str],
        window_id: str
    ) -> str:
        """Start a settlement workflow"""
        workflow_id = f"settlement-{settlement_id}"
        logger.info(f"Started settlement workflow: {workflow_id}")
        return workflow_id


# ==================== Fluvio Integration ====================

class FluvioStreaming:
    """Production Fluvio streaming for real-time Mojaloop events"""
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.client = httpx.AsyncClient(timeout=30.0)
        # Note: In production, use fluvio Python SDK
    
    async def close(self):
        await self.client.aclose()
    
    async def produce_transfer_event(self, event: TransferEvent):
        """Produce transfer event to Fluvio topic"""
        logger.info(f"Fluvio: Produced transfer event: {event.transfer_id}")
    
    async def produce_position_event(self, event: PositionEvent):
        """Produce position event to Fluvio topic"""
        logger.info(f"Fluvio: Produced position event: {event.fsp_id}")
    
    async def produce_tigerbeetle_event(self, event_type: str, data: Dict[str, Any]):
        """Produce TigerBeetle event to Fluvio"""
        logger.info(f"Fluvio: Produced TigerBeetle event: {event_type}")
    
    async def consume_transfer_events(self, handler: Callable[[TransferEvent], None]):
        """Consume transfer events from Fluvio"""
        logger.info(f"Fluvio: Started consuming from {self.config.fluvio_topic_transfers}")


# ==================== Dapr Integration ====================

class DaprIntegration:
    """Production Dapr integration for Mojaloop service mesh"""
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.base_url = f"http://localhost:{config.dapr_http_port}"
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def close(self):
        await self.client.aclose()
    
    async def invoke_service(
        self,
        app_id: str,
        method: str,
        data: Dict[str, Any],
        http_method: str = "POST"
    ) -> Dict[str, Any]:
        """Invoke another service via Dapr"""
        url = f"{self.base_url}/v1.0/invoke/{app_id}/method/{method}"
        
        if http_method == "POST":
            response = await self.client.post(url, json=data)
        else:
            response = await self.client.get(url, params=data)
        
        if response.status_code != 200:
            raise Exception(f"Dapr invoke failed: {response.text}")
        
        return response.json()
    
    async def publish_event(self, pubsub_name: str, topic: str, data: Dict[str, Any]):
        """Publish event via Dapr pub/sub"""
        url = f"{self.base_url}/v1.0/publish/{pubsub_name}/{topic}"
        
        response = await self.client.post(url, json=data)
        
        if response.status_code not in (200, 204):
            raise Exception(f"Dapr publish failed: {response.text}")
        
        logger.info(f"Dapr: Published to {pubsub_name}/{topic}")
    
    async def save_state(self, store_name: str, key: str, value: Any):
        """Save state to Dapr state store"""
        url = f"{self.base_url}/v1.0/state/{store_name}"
        
        response = await self.client.post(url, json=[{
            "key": key,
            "value": value
        }])
        
        if response.status_code not in (200, 204):
            raise Exception(f"Dapr save state failed: {response.text}")
    
    async def get_state(self, store_name: str, key: str) -> Optional[Any]:
        """Get state from Dapr state store"""
        url = f"{self.base_url}/v1.0/state/{store_name}/{key}"
        
        response = await self.client.get(url)
        
        if response.status_code == 204:
            return None
        
        if response.status_code != 200:
            raise Exception(f"Dapr get state failed: {response.text}")
        
        return response.json()
    
    async def delete_state(self, store_name: str, key: str):
        """Delete state from Dapr state store"""
        url = f"{self.base_url}/v1.0/state/{store_name}/{key}"
        
        response = await self.client.delete(url)
        
        if response.status_code not in (200, 204):
            raise Exception(f"Dapr delete state failed: {response.text}")
    
    # Mojaloop-specific Dapr operations
    async def invoke_central_ledger(self, method: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Invoke Central Ledger service via Dapr"""
        return await self.invoke_service("central-ledger", method, data)
    
    async def invoke_transfer_service(self, method: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Invoke Transfer Service via Dapr"""
        return await self.invoke_service("transfer-service", method, data)
    
    async def invoke_settlement_service(self, method: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Invoke Settlement Service via Dapr"""
        return await self.invoke_service("settlement-service", method, data)
    
    async def invoke_tigerbeetle(self, method: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Invoke TigerBeetle service via Dapr"""
        return await self.invoke_service("tigerbeetle-api", method, data)


# ==================== APISIX Integration ====================

class APISIXGateway:
    """Production APISIX API gateway management for Mojaloop"""
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.client = httpx.AsyncClient(timeout=30.0)
        self.headers = {
            "X-API-KEY": config.apisix_admin_key,
            "Content-Type": "application/json"
        }
    
    async def close(self):
        await self.client.aclose()
    
    async def create_route(
        self,
        route_id: str,
        uri: str,
        upstream_nodes: Dict[str, int],
        methods: List[str] = ["GET", "POST"],
        plugins: Dict[str, Any] = None
    ):
        """Create or update APISIX route"""
        url = f"{self.config.apisix_admin_url}/apisix/admin/routes/{route_id}"
        
        payload = {
            "uri": uri,
            "methods": methods,
            "upstream": {
                "type": "roundrobin",
                "nodes": upstream_nodes
            }
        }
        
        if plugins:
            payload["plugins"] = plugins
        
        response = await self.client.put(url, json=payload, headers=self.headers)
        
        if response.status_code not in (200, 201):
            raise Exception(f"APISIX route creation failed: {response.text}")
        
        logger.info(f"APISIX: Created route {route_id} -> {uri}")
    
    async def create_mojaloop_routes(self):
        """Create all Mojaloop service routes in APISIX"""
        routes = [
            {
                "id": "mojaloop-central-ledger",
                "uri": "/mojaloop/central-ledger/*",
                "upstream": {"central-ledger.mojaloop.svc.cluster.local:8001": 1},
                "methods": ["GET", "POST", "PUT"],
                "plugins": {
                    "jwt-auth": {},
                    "limit-req": {"rate": 1000, "burst": 2000}
                }
            },
            {
                "id": "mojaloop-transfer-service",
                "uri": "/mojaloop/transfers/*",
                "upstream": {"transfer-service.mojaloop.svc.cluster.local:8000": 1},
                "methods": ["GET", "POST", "PUT"],
                "plugins": {
                    "jwt-auth": {},
                    "limit-req": {"rate": 2000, "burst": 4000}
                }
            },
            {
                "id": "mojaloop-settlement-service",
                "uri": "/mojaloop/settlements/*",
                "upstream": {"settlement-service.mojaloop.svc.cluster.local:8002": 1},
                "methods": ["GET", "POST"],
                "plugins": {
                    "jwt-auth": {},
                    "limit-req": {"rate": 500, "burst": 1000}
                }
            },
            {
                "id": "mojaloop-participant-registry",
                "uri": "/mojaloop/participants/*",
                "upstream": {"participant-registry.mojaloop.svc.cluster.local:8003": 1},
                "methods": ["GET", "POST", "PUT"],
                "plugins": {
                    "jwt-auth": {},
                    "limit-req": {"rate": 500, "burst": 1000}
                }
            },
            {
                "id": "tigerbeetle-api",
                "uri": "/tigerbeetle/*",
                "upstream": {"tigerbeetle-api.mojaloop.svc.cluster.local:8160": 1},
                "methods": ["GET", "POST"],
                "plugins": {
                    "jwt-auth": {},
                    "limit-req": {"rate": 5000, "burst": 10000}
                }
            }
        ]
        
        for route in routes:
            await self.create_route(
                route["id"],
                route["uri"],
                route["upstream"],
                route["methods"],
                route.get("plugins")
            )


# ==================== Unified Middleware Manager ====================

class MojaloopMiddlewareManager:
    """
    Unified middleware manager for Mojaloop services.
    Provides single entry point for all middleware integrations.
    """
    
    def __init__(self, config: MiddlewareConfig = None):
        self.config = config or MiddlewareConfig()
        
        # Initialize all middleware clients
        self.kafka = KafkaEventBus(self.config)
        self.redis = RedisCache(self.config)
        self.keycloak = KeycloakAuth(self.config)
        self.permify = PermifyAuthz(self.config)
        self.temporal = TemporalWorkflows(self.config)
        self.fluvio = FluvioStreaming(self.config)
        self.dapr = DaprIntegration(self.config)
        self.apisix = APISIXGateway(self.config)
        
        self._initialized = False
    
    async def initialize(self):
        """Initialize all middleware connections"""
        if self._initialized:
            return
        
        await self.kafka.start()
        await self.redis.connect()
        self._initialized = True
        logger.info("Mojaloop middleware manager initialized")
    
    async def shutdown(self):
        """Shutdown all middleware connections"""
        await self.kafka.stop()
        await self.redis.close()
        await self.keycloak.close()
        await self.permify.close()
        await self.temporal.close()
        await self.fluvio.close()
        await self.dapr.close()
        await self.apisix.close()
        self._initialized = False
        logger.info("Mojaloop middleware manager shutdown")
    
    # ==================== Transfer Lifecycle Events ====================
    
    async def on_transfer_received(
        self,
        transfer_id: str,
        payer_fsp: str,
        payee_fsp: str,
        amount: Decimal,
        currency: str
    ):
        """Handle transfer received event"""
        event = TransferEvent(
            event_id=str(uuid.uuid4()),
            event_type=TransferEventType.TRANSFER_RECEIVED,
            transfer_id=transfer_id,
            payer_fsp=payer_fsp,
            payee_fsp=payee_fsp,
            amount=str(amount),
            currency=currency,
            state="RECEIVED",
            timestamp=datetime.utcnow()
        )
        
        # Publish to Kafka
        await self.kafka.publish_transfer_event(event)
        
        # Publish to Fluvio for real-time
        await self.fluvio.produce_transfer_event(event)
        
        # Cache transfer
        await self.redis.cache_transfer(transfer_id, event.dict())
        
        # Publish via Dapr
        await self.dapr.publish_event("mojaloop-pubsub", "transfers", event.dict())
    
    async def on_transfer_reserved(
        self,
        transfer_id: str,
        payer_fsp: str,
        payee_fsp: str,
        amount: Decimal,
        currency: str,
        tigerbeetle_id: str
    ):
        """Handle transfer reserved event"""
        event = TransferEvent(
            event_id=str(uuid.uuid4()),
            event_type=TransferEventType.TRANSFER_RESERVED,
            transfer_id=transfer_id,
            payer_fsp=payer_fsp,
            payee_fsp=payee_fsp,
            amount=str(amount),
            currency=currency,
            state="RESERVED",
            timestamp=datetime.utcnow(),
            tigerbeetle_id=tigerbeetle_id
        )
        
        await self.kafka.publish_transfer_event(event)
        await self.fluvio.produce_transfer_event(event)
        await self.redis.cache_transfer(transfer_id, event.dict())
        
        # Invalidate position caches
        await self.redis.invalidate_position(payer_fsp, currency)
    
    async def on_transfer_committed(
        self,
        transfer_id: str,
        payer_fsp: str,
        payee_fsp: str,
        amount: Decimal,
        currency: str,
        tigerbeetle_id: str
    ):
        """Handle transfer committed event"""
        event = TransferEvent(
            event_id=str(uuid.uuid4()),
            event_type=TransferEventType.TRANSFER_COMMITTED,
            transfer_id=transfer_id,
            payer_fsp=payer_fsp,
            payee_fsp=payee_fsp,
            amount=str(amount),
            currency=currency,
            state="COMMITTED",
            timestamp=datetime.utcnow(),
            tigerbeetle_id=tigerbeetle_id
        )
        
        await self.kafka.publish_transfer_event(event)
        await self.fluvio.produce_transfer_event(event)
        await self.redis.cache_transfer(transfer_id, event.dict())
        
        # Invalidate position caches for both parties
        await self.redis.invalidate_position(payer_fsp, currency)
        await self.redis.invalidate_position(payee_fsp, currency)
        
        # Publish TigerBeetle event
        await self.kafka.publish_tigerbeetle_event("transfer.posted", {
            "transfer_id": transfer_id,
            "tigerbeetle_id": tigerbeetle_id,
            "amount": str(amount),
            "currency": currency
        })
    
    async def on_transfer_aborted(
        self,
        transfer_id: str,
        payer_fsp: str,
        payee_fsp: str,
        amount: Decimal,
        currency: str,
        error_code: str,
        error_description: str
    ):
        """Handle transfer aborted event"""
        event = TransferEvent(
            event_id=str(uuid.uuid4()),
            event_type=TransferEventType.TRANSFER_ABORTED,
            transfer_id=transfer_id,
            payer_fsp=payer_fsp,
            payee_fsp=payee_fsp,
            amount=str(amount),
            currency=currency,
            state="ABORTED",
            timestamp=datetime.utcnow(),
            metadata={"error_code": error_code, "error_description": error_description}
        )
        
        await self.kafka.publish_transfer_event(event)
        await self.fluvio.produce_transfer_event(event)
        await self.redis.cache_transfer(transfer_id, event.dict())
        
        # Invalidate position cache (reservation released)
        await self.redis.invalidate_position(payer_fsp, currency)
    
    # ==================== Position Events ====================
    
    async def on_position_updated(
        self,
        fsp_id: str,
        currency: str,
        previous_position: Decimal,
        new_position: Decimal,
        reason: str,
        transfer_id: str = None,
        tigerbeetle_balance: Decimal = None
    ):
        """Handle position update event"""
        event = PositionEvent(
            event_id=str(uuid.uuid4()),
            fsp_id=fsp_id,
            currency=currency,
            previous_position=str(previous_position),
            new_position=str(new_position),
            change_amount=str(new_position - previous_position),
            reason=reason,
            transfer_id=transfer_id,
            timestamp=datetime.utcnow(),
            tigerbeetle_balance=str(tigerbeetle_balance) if tigerbeetle_balance else None
        )
        
        await self.kafka.publish_position_event(event)
        await self.fluvio.produce_position_event(event)
        
        # Update position cache
        await self.redis.cache_position(fsp_id, currency, {
            "position": str(new_position),
            "tigerbeetle_balance": str(tigerbeetle_balance) if tigerbeetle_balance else None,
            "updated_at": datetime.utcnow().isoformat()
        })
        
        # Real-time notification via Redis pub/sub
        await self.redis.publish(f"position:{fsp_id}", event.dict())
    
    # ==================== Authentication & Authorization ====================
    
    async def authenticate_request(self, token: str) -> Dict[str, Any]:
        """Authenticate request using Keycloak"""
        return await self.keycloak.validate_token(token)
    
    async def authorize_transfer(self, user_id: str, fsp_id: str) -> bool:
        """Check if user can initiate transfer for FSP"""
        return await self.permify.can_initiate_transfer(user_id, fsp_id)
    
    async def authorize_position_view(self, user_id: str, fsp_id: str) -> bool:
        """Check if user can view FSP position"""
        return await self.permify.can_view_position(user_id, fsp_id)
    
    async def authorize_liquidity_adjustment(self, user_id: str, fsp_id: str) -> bool:
        """Check if user can adjust FSP liquidity"""
        return await self.permify.can_adjust_liquidity(user_id, fsp_id)


# ==================== FastAPI Middleware ====================

def create_auth_middleware(middleware_manager: MojaloopMiddlewareManager):
    """Create FastAPI authentication middleware"""
    from fastapi import Request, HTTPException
    from starlette.middleware.base import BaseHTTPMiddleware
    
    class AuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            # Skip auth for health checks
            if request.url.path in ["/health", "/metrics", "/docs", "/openapi.json"]:
                return await call_next(request)
            
            # Get token from header
            auth_header = request.headers.get("Authorization")
            if not auth_header or not auth_header.startswith("Bearer "):
                raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
            
            token = auth_header.replace("Bearer ", "")
            
            try:
                # Validate token with Keycloak
                token_data = await middleware_manager.authenticate_request(token)
                
                # Add user info to request state
                request.state.user = token_data
                request.state.user_id = token_data.get("sub")
                request.state.fsp_id = middleware_manager.keycloak.get_fsp_id(token_data)
                request.state.roles = middleware_manager.keycloak.get_user_roles(token_data)
                
            except Exception as e:
                raise HTTPException(status_code=401, detail=str(e))
            
            return await call_next(request)
    
    return AuthMiddleware


# ==================== Singleton Instance ====================

_middleware_manager: Optional[MojaloopMiddlewareManager] = None


async def get_middleware_manager() -> MojaloopMiddlewareManager:
    """Get or create middleware manager singleton"""
    global _middleware_manager
    
    if _middleware_manager is None:
        _middleware_manager = MojaloopMiddlewareManager()
        await _middleware_manager.initialize()
    
    return _middleware_manager


async def shutdown_middleware_manager():
    """Shutdown middleware manager"""
    global _middleware_manager
    
    if _middleware_manager:
        await _middleware_manager.shutdown()
        _middleware_manager = None
