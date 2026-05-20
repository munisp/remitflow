"""
Dapr Distributed Application Runtime Client

Production-grade integration with Dapr for:
- Service-to-service invocation
- Pub/Sub messaging
- State management
- Bindings (input/output)
- Secrets management
- Distributed tracing

Reference: https://docs.dapr.io/
"""

import os
import logging
import asyncio
import json
import httpx
from typing import Dict, Any, Optional, List, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

logger = logging.getLogger(__name__)

# Configuration
DAPR_HTTP_PORT = int(os.getenv("DAPR_HTTP_PORT", "3500"))
DAPR_GRPC_PORT = int(os.getenv("DAPR_GRPC_PORT", "50001"))
DAPR_APP_ID = os.getenv("DAPR_APP_ID", "remittance-service")
DAPR_ENABLED = os.getenv("DAPR_ENABLED", "true").lower() == "true"
DAPR_PUBSUB_NAME = os.getenv("DAPR_PUBSUB_NAME", "kafka-pubsub")
DAPR_STATE_STORE = os.getenv("DAPR_STATE_STORE", "redis-statestore")
DAPR_SECRET_STORE = os.getenv("DAPR_SECRET_STORE", "aws-secrets")


class DaprContentType(str, Enum):
    """Content types for Dapr requests"""
    JSON = "application/json"
    CLOUDEVENTS = "application/cloudevents+json"
    TEXT = "text/plain"


@dataclass
class DaprMetadata:
    """Metadata for Dapr operations"""
    ttl_in_seconds: Optional[int] = None
    raw_payload: bool = False
    content_type: str = "application/json"
    custom: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, str]:
        result = {}
        if self.ttl_in_seconds:
            result["ttlInSeconds"] = str(self.ttl_in_seconds)
        if self.raw_payload:
            result["rawPayload"] = "true"
        result["contentType"] = self.content_type
        result.update(self.custom)
        return result


@dataclass
class StateItem:
    """State item for Dapr state store"""
    key: str
    value: Any
    etag: Optional[str] = None
    metadata: Dict[str, str] = field(default_factory=dict)
    options: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PubSubMessage:
    """Pub/Sub message for Dapr"""
    topic: str
    data: Dict[str, Any]
    pubsub_name: str = DAPR_PUBSUB_NAME
    metadata: Dict[str, str] = field(default_factory=dict)
    content_type: str = "application/json"


class DaprClient:
    """
    Dapr client for distributed application runtime
    
    Provides a unified interface for:
    - Service invocation
    - Pub/Sub messaging
    - State management
    - Secrets management
    - Input/Output bindings
    """
    
    def __init__(self, app_id: str = None):
        self.app_id = app_id or DAPR_APP_ID
        self.http_port = DAPR_HTTP_PORT
        self.grpc_port = DAPR_GRPC_PORT
        self.enabled = DAPR_ENABLED
        self.base_url = f"http://localhost:{self.http_port}"
        self._client: Optional[httpx.AsyncClient] = None
        self._subscriptions: Dict[str, Callable] = {}
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=30.0
            )
        return self._client
    
    async def close(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    # ==================== Service Invocation ====================
    
    async def invoke_service(
        self,
        app_id: str,
        method: str,
        data: Optional[Dict[str, Any]] = None,
        http_method: str = "POST",
        headers: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Invoke a method on another service via Dapr
        
        Args:
            app_id: Target service app ID
            method: Method/endpoint to invoke
            data: Request body data
            http_method: HTTP method (GET, POST, PUT, DELETE)
            headers: Additional headers
            
        Returns:
            Response from the target service
        """
        if not self.enabled:
            logger.warning("Dapr disabled, cannot invoke service")
            return {"success": False, "error": "Dapr disabled"}
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/invoke/{app_id}/method/{method}"
            
            request_headers = {"Content-Type": "application/json"}
            if headers:
                request_headers.update(headers)
            
            response = await client.request(
                method=http_method,
                url=url,
                json=data,
                headers=request_headers
            )
            
            if response.status_code in [200, 201, 202]:
                try:
                    return {"success": True, "data": response.json()}
                except Exception:
                    return {"success": True, "data": response.text}
            else:
                logger.error(f"Service invocation failed: {response.status_code} - {response.text}")
                return {"success": False, "error": response.text, "status_code": response.status_code}
                
        except Exception as e:
            logger.error(f"Error invoking service: {e}")
            return {"success": False, "error": str(e)}
    
    async def invoke_transaction_service(
        self,
        method: str,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Invoke transaction service"""
        return await self.invoke_service("transaction-service", method, data)
    
    async def invoke_wallet_service(
        self,
        method: str,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Invoke wallet service"""
        return await self.invoke_service("wallet-service", method, data)
    
    async def invoke_payment_service(
        self,
        method: str,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Invoke payment service"""
        return await self.invoke_service("payment-service", method, data)
    
    async def invoke_kyc_service(
        self,
        method: str,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Invoke KYC service"""
        return await self.invoke_service("kyc-service", method, data)
    
    async def invoke_mojaloop_connector(
        self,
        method: str,
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Invoke Mojaloop connector service"""
        return await self.invoke_service("mojaloop-connector", method, data)
    
    # ==================== Pub/Sub ====================
    
    async def publish_event(
        self,
        topic: str,
        data: Dict[str, Any],
        pubsub_name: str = None,
        metadata: Optional[Dict[str, str]] = None,
        content_type: str = "application/json"
    ) -> Dict[str, Any]:
        """
        Publish an event to a topic via Dapr pub/sub
        
        Args:
            topic: Topic name
            data: Event data
            pubsub_name: Pub/sub component name
            metadata: Additional metadata
            content_type: Content type
            
        Returns:
            Publish result
        """
        if not self.enabled:
            logger.warning("Dapr disabled, cannot publish event")
            return {"success": False, "error": "Dapr disabled"}
        
        pubsub = pubsub_name or DAPR_PUBSUB_NAME
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/publish/{pubsub}/{topic}"
            
            headers = {"Content-Type": content_type}
            if metadata:
                for key, value in metadata.items():
                    headers[f"metadata.{key}"] = value
            
            response = await client.post(url, json=data, headers=headers)
            
            if response.status_code in [200, 201, 204]:
                logger.info(f"Published event to {pubsub}/{topic}")
                return {"success": True}
            else:
                logger.error(f"Failed to publish event: {response.status_code} - {response.text}")
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error publishing event: {e}")
            return {"success": False, "error": str(e)}
    
    async def publish_transaction_event(
        self,
        event_type: str,
        transaction_id: str,
        data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Publish a transaction event"""
        return await self.publish_event(
            topic="transactions",
            data={
                "event_type": event_type,
                "transaction_id": transaction_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **data
            }
        )
    
    async def publish_wallet_event(
        self,
        event_type: str,
        wallet_id: str,
        data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Publish a wallet event"""
        return await self.publish_event(
            topic="wallets",
            data={
                "event_type": event_type,
                "wallet_id": wallet_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **data
            }
        )
    
    async def publish_tigerbeetle_event(
        self,
        event_type: str,
        account_id: str,
        transfer_id: Optional[str],
        data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Publish a TigerBeetle ledger event"""
        return await self.publish_event(
            topic="tigerbeetle-events",
            data={
                "event_type": event_type,
                "account_id": account_id,
                "transfer_id": transfer_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **data
            }
        )
    
    async def publish_mojaloop_event(
        self,
        event_type: str,
        transfer_id: str,
        data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Publish a Mojaloop event"""
        return await self.publish_event(
            topic="mojaloop-events",
            data={
                "event_type": event_type,
                "transfer_id": transfer_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **data
            }
        )
    
    def subscribe(
        self,
        topic: str,
        handler: Callable[[Dict[str, Any]], Awaitable[None]],
        pubsub_name: str = None
    ):
        """
        Register a subscription handler for a topic
        
        Note: In production, subscriptions are configured via Dapr components
        and the handler is called by the Dapr sidecar.
        """
        pubsub = pubsub_name or DAPR_PUBSUB_NAME
        key = f"{pubsub}/{topic}"
        self._subscriptions[key] = handler
        logger.info(f"Registered subscription handler for {key}")
    
    def get_subscriptions(self) -> List[Dict[str, Any]]:
        """
        Get subscription configuration for Dapr
        
        This is called by Dapr to discover subscriptions.
        """
        subscriptions = []
        for key in self._subscriptions:
            pubsub, topic = key.split("/", 1)
            subscriptions.append({
                "pubsubname": pubsub,
                "topic": topic,
                "route": f"/dapr/subscribe/{topic}"
            })
        return subscriptions
    
    # ==================== State Management ====================
    
    async def save_state(
        self,
        key: str,
        value: Any,
        store_name: str = None,
        etag: Optional[str] = None,
        metadata: Optional[Dict[str, str]] = None,
        consistency: str = "strong"
    ) -> Dict[str, Any]:
        """
        Save state to Dapr state store
        
        Args:
            key: State key
            value: State value
            store_name: State store component name
            etag: ETag for optimistic concurrency
            metadata: Additional metadata
            consistency: Consistency level (strong, eventual)
            
        Returns:
            Save result
        """
        if not self.enabled:
            logger.warning("Dapr disabled, cannot save state")
            return {"success": False, "error": "Dapr disabled"}
        
        store = store_name or DAPR_STATE_STORE
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/state/{store}"
            
            state_item = {
                "key": key,
                "value": value
            }
            
            if etag:
                state_item["etag"] = etag
            
            if metadata:
                state_item["metadata"] = metadata
            
            state_item["options"] = {
                "consistency": consistency
            }
            
            response = await client.post(url, json=[state_item])
            
            if response.status_code in [200, 201, 204]:
                logger.debug(f"Saved state: {key}")
                return {"success": True}
            else:
                logger.error(f"Failed to save state: {response.status_code} - {response.text}")
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error saving state: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_state(
        self,
        key: str,
        store_name: str = None,
        consistency: str = "strong"
    ) -> Dict[str, Any]:
        """
        Get state from Dapr state store
        
        Args:
            key: State key
            store_name: State store component name
            consistency: Consistency level
            
        Returns:
            State value and metadata
        """
        if not self.enabled:
            return {"success": False, "error": "Dapr disabled"}
        
        store = store_name or DAPR_STATE_STORE
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/state/{store}/{key}"
            params = {"consistency": consistency}
            
            response = await client.get(url, params=params)
            
            if response.status_code == 200:
                etag = response.headers.get("ETag")
                try:
                    value = response.json()
                except Exception:
                    value = response.text
                
                return {"success": True, "value": value, "etag": etag}
            elif response.status_code == 204:
                return {"success": True, "value": None}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error getting state: {e}")
            return {"success": False, "error": str(e)}
    
    async def delete_state(
        self,
        key: str,
        store_name: str = None,
        etag: Optional[str] = None
    ) -> Dict[str, Any]:
        """Delete state from Dapr state store"""
        if not self.enabled:
            return {"success": False, "error": "Dapr disabled"}
        
        store = store_name or DAPR_STATE_STORE
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/state/{store}/{key}"
            headers = {}
            if etag:
                headers["If-Match"] = etag
            
            response = await client.delete(url, headers=headers)
            
            if response.status_code in [200, 204]:
                return {"success": True}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error deleting state: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_bulk_state(
        self,
        keys: List[str],
        store_name: str = None
    ) -> Dict[str, Any]:
        """Get multiple state items at once"""
        if not self.enabled:
            return {"success": False, "error": "Dapr disabled"}
        
        store = store_name or DAPR_STATE_STORE
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/state/{store}/bulk"
            
            response = await client.post(url, json={"keys": keys})
            
            if response.status_code == 200:
                items = response.json()
                result = {}
                for item in items:
                    result[item["key"]] = {
                        "value": item.get("data"),
                        "etag": item.get("etag")
                    }
                return {"success": True, "items": result}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error getting bulk state: {e}")
            return {"success": False, "error": str(e)}
    
    # ==================== Secrets Management ====================
    
    async def get_secret(
        self,
        key: str,
        store_name: str = None
    ) -> Dict[str, Any]:
        """
        Get a secret from Dapr secret store
        
        Args:
            key: Secret key
            store_name: Secret store component name
            
        Returns:
            Secret value
        """
        if not self.enabled:
            # Fall back to environment variable
            value = os.getenv(key)
            if value:
                return {"success": True, "value": {key: value}}
            return {"success": False, "error": "Secret not found"}
        
        store = store_name or DAPR_SECRET_STORE
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/secrets/{store}/{key}"
            
            response = await client.get(url)
            
            if response.status_code == 200:
                return {"success": True, "value": response.json()}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error getting secret: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_bulk_secrets(
        self,
        store_name: str = None
    ) -> Dict[str, Any]:
        """Get all secrets from a secret store"""
        if not self.enabled:
            return {"success": False, "error": "Dapr disabled"}
        
        store = store_name or DAPR_SECRET_STORE
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/secrets/{store}/bulk"
            
            response = await client.get(url)
            
            if response.status_code == 200:
                return {"success": True, "secrets": response.json()}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error getting bulk secrets: {e}")
            return {"success": False, "error": str(e)}
    
    # ==================== Bindings ====================
    
    async def invoke_binding(
        self,
        binding_name: str,
        operation: str,
        data: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Invoke an output binding
        
        Args:
            binding_name: Binding component name
            operation: Operation to perform
            data: Data to send
            metadata: Additional metadata
            
        Returns:
            Binding response
        """
        if not self.enabled:
            return {"success": False, "error": "Dapr disabled"}
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0/bindings/{binding_name}"
            
            request_body = {
                "operation": operation,
                "data": data or {},
                "metadata": metadata or {}
            }
            
            response = await client.post(url, json=request_body)
            
            if response.status_code in [200, 201, 204]:
                try:
                    return {"success": True, "data": response.json()}
                except Exception:
                    return {"success": True, "data": response.text}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error invoking binding: {e}")
            return {"success": False, "error": str(e)}
    
    async def send_email(
        self,
        to: str,
        subject: str,
        body: str
    ) -> Dict[str, Any]:
        """Send email via SMTP binding"""
        return await self.invoke_binding(
            binding_name="smtp",
            operation="create",
            data={
                "to": to,
                "subject": subject,
                "body": body
            }
        )
    
    async def send_sms(
        self,
        to: str,
        message: str
    ) -> Dict[str, Any]:
        """Send SMS via Twilio binding"""
        return await self.invoke_binding(
            binding_name="twilio",
            operation="create",
            data={
                "toNumber": to,
                "message": message
            }
        )
    
    async def store_to_s3(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream"
    ) -> Dict[str, Any]:
        """Store data to S3 via binding"""
        import base64
        return await self.invoke_binding(
            binding_name="s3",
            operation="create",
            data=base64.b64encode(data).decode(),
            metadata={
                "key": key,
                "contentType": content_type
            }
        )
    
    # ==================== Distributed Lock ====================
    
    async def try_lock(
        self,
        lock_name: str,
        lock_owner: str,
        expiry_in_seconds: int = 60,
        store_name: str = None
    ) -> Dict[str, Any]:
        """
        Try to acquire a distributed lock
        
        Args:
            lock_name: Name of the lock
            lock_owner: Owner identifier
            expiry_in_seconds: Lock expiry time
            store_name: Lock store component name
            
        Returns:
            Lock acquisition result
        """
        if not self.enabled:
            return {"success": True, "acquired": True, "mode": "local"}
        
        store = store_name or DAPR_STATE_STORE
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0-alpha1/lock/{store}"
            
            request_body = {
                "resourceId": lock_name,
                "lockOwner": lock_owner,
                "expiryInSeconds": expiry_in_seconds
            }
            
            response = await client.post(url, json=request_body)
            
            if response.status_code == 200:
                result = response.json()
                return {"success": True, "acquired": result.get("success", False)}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error acquiring lock: {e}")
            return {"success": False, "error": str(e)}
    
    async def unlock(
        self,
        lock_name: str,
        lock_owner: str,
        store_name: str = None
    ) -> Dict[str, Any]:
        """Release a distributed lock"""
        if not self.enabled:
            return {"success": True, "mode": "local"}
        
        store = store_name or DAPR_STATE_STORE
        
        try:
            client = await self._get_client()
            
            url = f"/v1.0-alpha1/unlock/{store}"
            
            request_body = {
                "resourceId": lock_name,
                "lockOwner": lock_owner
            }
            
            response = await client.post(url, json=request_body)
            
            if response.status_code == 200:
                return {"success": True}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error releasing lock: {e}")
            return {"success": False, "error": str(e)}


# ==================== Singleton Instance ====================

_dapr_client: Optional[DaprClient] = None


def get_dapr_client() -> DaprClient:
    """Get the global Dapr client instance"""
    global _dapr_client
    if _dapr_client is None:
        _dapr_client = DaprClient()
    return _dapr_client


# ==================== Dapr Component Configurations ====================

DAPR_COMPONENTS = {
    "kafka-pubsub": {
        "apiVersion": "dapr.io/v1alpha1",
        "kind": "Component",
        "metadata": {
            "name": "kafka-pubsub",
            "namespace": "remittance"
        },
        "spec": {
            "type": "pubsub.kafka",
            "version": "v1",
            "metadata": [
                {"name": "brokers", "value": "${KAFKA_BROKERS}"},
                {"name": "consumerGroup", "value": "remittance-platform"},
                {"name": "authType", "value": "none"},
                {"name": "maxMessageBytes", "value": "1048576"},
                {"name": "consumeRetryInterval", "value": "100ms"}
            ]
        }
    },
    "redis-statestore": {
        "apiVersion": "dapr.io/v1alpha1",
        "kind": "Component",
        "metadata": {
            "name": "redis-statestore",
            "namespace": "remittance"
        },
        "spec": {
            "type": "state.redis",
            "version": "v1",
            "metadata": [
                {"name": "redisHost", "value": "${REDIS_HOST}:6379"},
                {"name": "redisPassword", "secretKeyRef": {"name": "redis-secret", "key": "password"}},
                {"name": "actorStateStore", "value": "true"}
            ]
        }
    },
    "aws-secrets": {
        "apiVersion": "dapr.io/v1alpha1",
        "kind": "Component",
        "metadata": {
            "name": "aws-secrets",
            "namespace": "remittance"
        },
        "spec": {
            "type": "secretstores.aws.secretmanager",
            "version": "v1",
            "metadata": [
                {"name": "region", "value": "${AWS_REGION}"},
                {"name": "accessKey", "value": "${AWS_ACCESS_KEY_ID}"},
                {"name": "secretKey", "secretKeyRef": {"name": "aws-secret", "key": "secretAccessKey"}}
            ]
        }
    }
}
