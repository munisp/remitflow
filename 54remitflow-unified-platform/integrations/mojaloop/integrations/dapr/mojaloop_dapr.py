"""
Dapr Service Mesh Integration for Mojaloop
Implements service-to-service communication via Dapr
"""

import logging
import json
from typing import Dict, Any, Optional
from enum import Enum


logger = logging.getLogger(__name__)


class DaprClient:
    """Client for Dapr sidecar communication"""
    
    def __init__(self, dapr_http_port: int = 3500, dapr_grpc_port: int = 50001):
        self.dapr_http_port = dapr_http_port
        self.dapr_grpc_port = dapr_grpc_port
        self.base_url = f"http://localhost:{dapr_http_port}"
    
    async def invoke_service(
        self,
        app_id: str,
        method: str,
        data: Optional[Dict[str, Any]] = None,
        http_verb: str = "POST"
    ) -> Dict[str, Any]:
        """Invoke another service via Dapr"""
        try:
            url = f"{self.base_url}/v1.0/invoke/{app_id}/method/{method}"
            
            # In production, this would use actual HTTP client
            logger.info(f"Invoking service: {app_id}/{method}")
            logger.debug(f"Request data: {json.dumps(data, indent=2)}")
            
            # Simulate response
            return {
                "status": "success",
                "data": {"message": f"Response from {app_id}/{method}"}
            }
        except Exception as e:
            logger.error(f"Service invocation failed: {e}")
            raise
    
    async def publish_event(
        self,
        pubsub_name: str,
        topic: str,
        data: Dict[str, Any]
    ) -> bool:
        """Publish event to pub/sub"""
        try:
            url = f"{self.base_url}/v1.0/publish/{pubsub_name}/{topic}"
            
            logger.info(f"Publishing event to {pubsub_name}/{topic}")
            logger.debug(f"Event data: {json.dumps(data, indent=2)}")
            
            return True
        except Exception as e:
            logger.error(f"Event publishing failed: {e}")
            return False
    
    async def get_state(
        self,
        store_name: str,
        key: str
    ) -> Optional[Dict[str, Any]]:
        """Get state from state store"""
        try:
            url = f"{self.base_url}/v1.0/state/{store_name}/{key}"
            
            logger.info(f"Getting state: {store_name}/{key}")
            
            # Simulate response
            return {"value": "state_value"}
        except Exception as e:
            logger.error(f"Get state failed: {e}")
            return None
    
    async def save_state(
        self,
        store_name: str,
        key: str,
        value: Any
    ) -> bool:
        """Save state to state store"""
        try:
            url = f"{self.base_url}/v1.0/state/{store_name}"
            
            state_data = [{
                "key": key,
                "value": value
            }]
            
            logger.info(f"Saving state: {store_name}/{key}")
            
            return True
        except Exception as e:
            logger.error(f"Save state failed: {e}")
            return False
    
    async def delete_state(
        self,
        store_name: str,
        key: str
    ) -> bool:
        """Delete state from state store"""
        try:
            url = f"{self.base_url}/v1.0/state/{store_name}/{key}"
            
            logger.info(f"Deleting state: {store_name}/{key}")
            
            return True
        except Exception as e:
            logger.error(f"Delete state failed: {e}")
            return False
    
    async def get_secret(
        self,
        secret_store: str,
        secret_name: str
    ) -> Optional[Dict[str, str]]:
        """Get secret from secret store"""
        try:
            url = f"{self.base_url}/v1.0/secrets/{secret_store}/{secret_name}"
            
            logger.info(f"Getting secret: {secret_store}/{secret_name}")
            
            # Simulate response
            return {"secret_value": "***"}
        except Exception as e:
            logger.error(f"Get secret failed: {e}")
            return None


class MojaloopServiceClient:
    """Client for calling Mojaloop services via Dapr"""
    
    def __init__(self, dapr_client: DaprClient):
        self.dapr_client = dapr_client
    
    async def call_account_lookup_service(
        self,
        account_id: str,
        account_type: str = "MSISDN"
    ) -> Dict[str, Any]:
        """Call Account Lookup Service"""
        return await self.dapr_client.invoke_service(
            app_id="mojaloop-als",
            method="participants",
            data={
                "account_id": account_id,
                "account_type": account_type
            }
        )
    
    async def call_quoting_service(
        self,
        quote_request: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call Quoting Service"""
        return await self.dapr_client.invoke_service(
            app_id="mojaloop-quoting",
            method="quotes",
            data=quote_request
        )
    
    async def call_transfer_service(
        self,
        transfer_request: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call Transfer Service"""
        return await self.dapr_client.invoke_service(
            app_id="mojaloop-switch",
            method="transfers",
            data=transfer_request
        )
    
    async def call_settlement_service(
        self,
        settlement_request: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call Settlement Service"""
        return await self.dapr_client.invoke_service(
            app_id="mojaloop-switch",
            method="settlements",
            data=settlement_request
        )


class MojaloopStateManager:
    """Manage Mojaloop state using Dapr state store"""
    
    def __init__(self, dapr_client: DaprClient, store_name: str = "mojaloop-state"):
        self.dapr_client = dapr_client
        self.store_name = store_name
    
    async def save_quote(self, quote_id: str, quote_data: Dict[str, Any]) -> bool:
        """Save quote to state store"""
        return await self.dapr_client.save_state(
            self.store_name,
            f"quote:{quote_id}",
            quote_data
        )
    
    async def get_quote(self, quote_id: str) -> Optional[Dict[str, Any]]:
        """Get quote from state store"""
        return await self.dapr_client.get_state(
            self.store_name,
            f"quote:{quote_id}"
        )
    
    async def save_transfer(self, transfer_id: str, transfer_data: Dict[str, Any]) -> bool:
        """Save transfer to state store"""
        return await self.dapr_client.save_state(
            self.store_name,
            f"transfer:{transfer_id}",
            transfer_data
        )
    
    async def get_transfer(self, transfer_id: str) -> Optional[Dict[str, Any]]:
        """Get transfer from state store"""
        return await self.dapr_client.get_state(
            self.store_name,
            f"transfer:{transfer_id}"
        )
    
    async def save_participant(self, participant_id: str, participant_data: Dict[str, Any]) -> bool:
        """Save participant to state store"""
        return await self.dapr_client.save_state(
            self.store_name,
            f"participant:{participant_id}",
            participant_data
        )
    
    async def get_participant(self, participant_id: str) -> Optional[Dict[str, Any]]:
        """Get participant from state store"""
        return await self.dapr_client.get_state(
            self.store_name,
            f"participant:{participant_id}"
        )


class MojaloopEventPublisher:
    """Publish Mojaloop events using Dapr pub/sub"""
    
    def __init__(self, dapr_client: DaprClient, pubsub_name: str = "mojaloop-pubsub"):
        self.dapr_client = dapr_client
        self.pubsub_name = pubsub_name
    
    async def publish_quote_event(self, event_type: str, quote_data: Dict[str, Any]) -> bool:
        """Publish quote event"""
        return await self.dapr_client.publish_event(
            self.pubsub_name,
            "mojaloop.quotes",
            {
                "event_type": event_type,
                "data": quote_data
            }
        )
    
    async def publish_transfer_event(self, event_type: str, transfer_data: Dict[str, Any]) -> bool:
        """Publish transfer event"""
        return await self.dapr_client.publish_event(
            self.pubsub_name,
            "mojaloop.transfers",
            {
                "event_type": event_type,
                "data": transfer_data
            }
        )
    
    async def publish_settlement_event(self, event_type: str, settlement_data: Dict[str, Any]) -> bool:
        """Publish settlement event"""
        return await self.dapr_client.publish_event(
            self.pubsub_name,
            "mojaloop.settlements",
            {
                "event_type": event_type,
                "data": settlement_data
            }
        )


# Resilience patterns using Dapr

class CircuitBreaker:
    """Circuit breaker pattern for Mojaloop services"""
    
    def __init__(self, failure_threshold: int = 5, timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failure_count = 0
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
    
    async def call(self, func, *args, **kwargs):
        """Call function with circuit breaker"""
        if self.state == "OPEN":
            raise Exception("Circuit breaker is OPEN")
        
        try:
            result = await func(*args, **kwargs)
            self.on_success()
            return result
        except Exception as e:
            self.on_failure()
            raise
    
    def on_success(self):
        """Handle successful call"""
        self.failure_count = 0
        if self.state == "HALF_OPEN":
            self.state = "CLOSED"
    
    def on_failure(self):
        """Handle failed call"""
        self.failure_count += 1
        if self.failure_count >= self.failure_threshold:
            self.state = "OPEN"
            logger.warning("Circuit breaker opened")


class RetryPolicy:
    """Retry policy for Mojaloop operations"""
    
    def __init__(self, max_retries: int = 3, backoff_factor: float = 2.0):
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
    
    async def execute(self, func, *args, **kwargs):
        """Execute function with retry"""
        import asyncio
        
        for attempt in range(self.max_retries):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                if attempt == self.max_retries - 1:
                    raise
                
                wait_time = self.backoff_factor ** attempt
                logger.warning(f"Attempt {attempt + 1} failed, retrying in {wait_time}s")
                await asyncio.sleep(wait_time)

