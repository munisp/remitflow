"""
Permify Client Wrapper
Provides a Python interface to the Permify authorization service
"""

import os
import logging
import asyncio
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from enum import Enum
import httpx
import grpc
from grpc import aio as grpc_aio
from functools import wraps
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PermissionResult(Enum):
    """Permission check results"""
    ALLOWED = "ALLOWED"
    DENIED = "DENIED"
    ERROR = "ERROR"


@dataclass
class PermissionCheckRequest:
    """Permission check request"""
    tenant_id: str
    entity_type: str
    entity_id: str
    permission: str
    subject_type: str
    subject_id: str
    context: Optional[Dict[str, Any]] = None


@dataclass
class RelationshipTuple:
    """Relationship tuple"""
    tenant_id: str
    entity_type: str
    entity_id: str
    relation: str
    subject_type: str
    subject_id: str


@dataclass
class PermissionCheckResponse:
    """Permission check response"""
    can: PermissionResult
    metadata: Dict[str, Any]
    duration_ms: int


class CircuitBreakerState(Enum):
    """Circuit breaker states"""
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class CircuitBreaker:
    """Circuit breaker for Permify client"""
    
    def __init__(self, failure_threshold: int = 5, timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failure_count = 0
        self.last_failure_time = None
        self.state = CircuitBreakerState.CLOSED
    
    def call(self, func):
        """Decorator for circuit breaker"""
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if self.state == CircuitBreakerState.OPEN:
                if time.time() - self.last_failure_time > self.timeout:
                    self.state = CircuitBreakerState.HALF_OPEN
                    logger.info("Circuit breaker transitioning to HALF_OPEN")
                else:
                    raise Exception("Circuit breaker is OPEN")
            
            try:
                result = await func(*args, **kwargs)
                if self.state == CircuitBreakerState.HALF_OPEN:
                    self.state = CircuitBreakerState.CLOSED
                    self.failure_count = 0
                    logger.info("Circuit breaker transitioning to CLOSED")
                return result
            except Exception as e:
                self.failure_count += 1
                self.last_failure_time = time.time()
                
                if self.failure_count >= self.failure_threshold:
                    self.state = CircuitBreakerState.OPEN
                    logger.error(f"Circuit breaker transitioning to OPEN: {e}")
                
                raise
        
        return wrapper


class PermifyClient:
    """
    Permify authorization client
    Supports both HTTP and gRPC protocols
    """
    
    def __init__(
        self,
        base_url: Optional[str] = None,
        grpc_address: Optional[str] = None,
        api_key: Optional[str] = None,
        tenant_id: str = "remittance-platform",
        use_grpc: bool = False,
        enable_circuit_breaker: bool = True,
        enable_cache: bool = True,
        cache_ttl: int = 300
    ):
        """
        Initialize Permify client
        
        Args:
            base_url: HTTP API base URL (default: from env PERMIFY_HTTP_URL)
            grpc_address: gRPC server address (default: from env PERMIFY_GRPC_ADDRESS)
            api_key: API key for authentication (default: from env PERMIFY_API_KEY)
            tenant_id: Tenant ID (default: remittance-platform)
            use_grpc: Use gRPC instead of HTTP (default: False)
            enable_circuit_breaker: Enable circuit breaker (default: True)
            enable_cache: Enable permission caching (default: True)
            cache_ttl: Cache TTL in seconds (default: 300)
        """
        self.base_url = base_url or os.getenv("PERMIFY_HTTP_URL", "http://localhost:3476")
        self.grpc_address = grpc_address or os.getenv("PERMIFY_GRPC_ADDRESS", "localhost:3478")
        self.api_key = api_key or os.getenv("PERMIFY_API_KEY", "")
        self.tenant_id = tenant_id
        self.use_grpc = use_grpc
        self.enable_cache = enable_cache
        self.cache_ttl = cache_ttl
        
        # Initialize HTTP client
        self.http_client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
            timeout=30.0
        )
        
        # Initialize gRPC channel (lazy)
        self._grpc_channel = None
        self._grpc_stub = None
        
        # Initialize circuit breaker
        self.circuit_breaker = CircuitBreaker() if enable_circuit_breaker else None
        
        # Initialize cache
        self.cache: Dict[str, tuple] = {}  # key -> (value, expiry_time)
        
        logger.info(f"Permify client initialized (tenant: {tenant_id}, protocol: {'gRPC' if use_grpc else 'HTTP'})")
    
    async def _get_grpc_channel(self):
        """Get or create gRPC channel"""
        if self._grpc_channel is None:
            self._grpc_channel = grpc_aio.insecure_channel(self.grpc_address)
            # Import and initialize stub here (requires permify protobuf definitions)
            # self._grpc_stub = permission_pb2_grpc.PermissionStub(self._grpc_channel)
        return self._grpc_channel
    
    def _get_cache_key(self, request: PermissionCheckRequest) -> str:
        """Generate cache key for permission check"""
        return f"{request.tenant_id}:{request.entity_type}:{request.entity_id}:{request.permission}:{request.subject_type}:{request.subject_id}"
    
    def _get_from_cache(self, key: str) -> Optional[PermissionCheckResponse]:
        """Get value from cache"""
        if not self.enable_cache:
            return None
        
        if key in self.cache:
            value, expiry = self.cache[key]
            if time.time() < expiry:
                logger.debug(f"Cache hit: {key}")
                return value
            else:
                del self.cache[key]
        
        return None
    
    def _set_in_cache(self, key: str, value: PermissionCheckResponse):
        """Set value in cache"""
        if self.enable_cache:
            self.cache[key] = (value, time.time() + self.cache_ttl)
            logger.debug(f"Cache set: {key}")
    
    async def check_permission(
        self,
        entity_type: str,
        entity_id: str,
        permission: str,
        subject_type: str,
        subject_id: str,
        context: Optional[Dict[str, Any]] = None
    ) -> PermissionCheckResponse:
        """
        Check if subject has permission on entity
        
        Args:
            entity_type: Type of entity (e.g., "account", "transaction")
            entity_id: ID of entity
            permission: Permission to check (e.g., "view", "transfer")
            subject_type: Type of subject (e.g., "user", "role")
            subject_id: ID of subject
            context: Additional context for permission check
        
        Returns:
            PermissionCheckResponse with result
        """
        request = PermissionCheckRequest(
            tenant_id=self.tenant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            permission=permission,
            subject_type=subject_type,
            subject_id=subject_id,
            context=context
        )
        
        # Check cache
        cache_key = self._get_cache_key(request)
        cached_result = self._get_from_cache(cache_key)
        if cached_result:
            return cached_result
        
        # Perform check
        if self.circuit_breaker:
            check_func = self.circuit_breaker.call(self._check_permission_impl)
        else:
            check_func = self._check_permission_impl
        
        result = await check_func(request)
        
        # Cache result
        self._set_in_cache(cache_key, result)
        
        return result
    
    async def _check_permission_impl(self, request: PermissionCheckRequest) -> PermissionCheckResponse:
        """Internal implementation of permission check"""
        start_time = time.time()
        
        try:
            if self.use_grpc:
                result = await self._check_permission_grpc(request)
            else:
                result = await self._check_permission_http(request)
            
            duration_ms = int((time.time() - start_time) * 1000)
            
            return PermissionCheckResponse(
                can=result,
                metadata={"tenant_id": request.tenant_id},
                duration_ms=duration_ms
            )
        except Exception as e:
            logger.error(f"Permission check failed: {e}")
            duration_ms = int((time.time() - start_time) * 1000)
            return PermissionCheckResponse(
                can=PermissionResult.ERROR,
                metadata={"error": str(e)},
                duration_ms=duration_ms
            )
    
    async def _check_permission_http(self, request: PermissionCheckRequest) -> PermissionResult:
        """Check permission via HTTP API"""
        payload = {
            "tenant_id": request.tenant_id,
            "entity": {
                "type": request.entity_type,
                "id": request.entity_id
            },
            "permission": request.permission,
            "subject": {
                "type": request.subject_type,
                "id": request.subject_id
            }
        }
        
        if request.context:
            payload["context"] = request.context
        
        response = await self.http_client.post("/v1/permissions/check", json=payload)
        response.raise_for_status()
        
        data = response.json()
        return PermissionResult.ALLOWED if data.get("can") == "RESULT_ALLOWED" else PermissionResult.DENIED
    
    async def _check_permission_grpc(self, request: PermissionCheckRequest) -> PermissionResult:
        """Check permission via gRPC API"""
        # Implementation requires permify protobuf definitions
        # This is a placeholder
        logger.warning("gRPC support for Permify is not fully implemented due to missing protobuf definitions. Falling back to HTTP.")
        return await self._check_permission_http(request)
    
    async def create_relationship(
        self,
        entity_type: str,
        entity_id: str,
        relation: str,
        subject_type: str,
        subject_id: str
    ) -> bool:
        """
        Create a relationship between subject and entity
        
        Args:
            entity_type: Type of entity
            entity_id: ID of entity
            relation: Relation name (e.g., "owner", "member")
            subject_type: Type of subject
            subject_id: ID of subject
        
        Returns:
            True if successful
        """
        tuple_data = RelationshipTuple(
            tenant_id=self.tenant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            relation=relation,
            subject_type=subject_type,
            subject_id=subject_id
        )
        
        return await self._create_relationship_impl(tuple_data)
    
    async def _create_relationship_impl(self, tuple_data: RelationshipTuple) -> bool:
        """Internal implementation of create relationship"""
        try:
            payload = {
                "tenant_id": tuple_data.tenant_id,
                "tuples": [
                    {
                        "entity": {
                            "type": tuple_data.entity_type,
                            "id": tuple_data.entity_id
                        },
                        "relation": tuple_data.relation,
                        "subject": {
                            "type": tuple_data.subject_type,
                            "id": tuple_data.subject_id
                        }
                    }
                ]
            }
            
            response = await self.http_client.post("/v1/relationships/write", json=payload)
            response.raise_for_status()
            
            logger.info(f"Relationship created: {tuple_data.subject_type}:{tuple_data.subject_id} -> {tuple_data.relation} -> {tuple_data.entity_type}:{tuple_data.entity_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to create relationship: {e}")
            return False
    
    async def delete_relationship(
        self,
        entity_type: str,
        entity_id: str,
        relation: str,
        subject_type: str,
        subject_id: str
    ) -> bool:
        """
        Delete a relationship between subject and entity
        
        Args:
            entity_type: Type of entity
            entity_id: ID of entity
            relation: Relation name
            subject_type: Type of subject
            subject_id: ID of subject
        
        Returns:
            True if successful
        """
        try:
            payload = {
                "tenant_id": self.tenant_id,
                "tuples": [
                    {
                        "entity": {
                            "type": entity_type,
                            "id": entity_id
                        },
                        "relation": relation,
                        "subject": {
                            "type": subject_type,
                            "id": subject_id
                        }
                    }
                ]
            }
            
            response = await self.http_client.post("/v1/relationships/delete", json=payload)
            response.raise_for_status()
            
            logger.info(f"Relationship deleted: {subject_type}:{subject_id} -> {relation} -> {entity_type}:{entity_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete relationship: {e}")
            return False
    
    async def list_relationships(
        self,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        relation: Optional[str] = None,
        subject_type: Optional[str] = None,
        subject_id: Optional[str] = None
    ) -> List[RelationshipTuple]:
        """
        List relationships matching the filter
        
        Args:
            entity_type: Filter by entity type
            entity_id: Filter by entity ID
            relation: Filter by relation
            subject_type: Filter by subject type
            subject_id: Filter by subject ID
        
        Returns:
            List of matching relationship tuples
        """
        try:
            params = {"tenant_id": self.tenant_id}
            
            if entity_type:
                params["entity.type"] = entity_type
            if entity_id:
                params["entity.id"] = entity_id
            if relation:
                params["relation"] = relation
            if subject_type:
                params["subject.type"] = subject_type
            if subject_id:
                params["subject.id"] = subject_id
            
            response = await self.http_client.get("/v1/relationships/read", params=params)
            response.raise_for_status()
            
            data = response.json()
            tuples = []
            
            for tuple_data in data.get("tuples", []):
                tuples.append(RelationshipTuple(
                    tenant_id=self.tenant_id,
                    entity_type=tuple_data["entity"]["type"],
                    entity_id=tuple_data["entity"]["id"],
                    relation=tuple_data["relation"],
                    subject_type=tuple_data["subject"]["type"],
                    subject_id=tuple_data["subject"]["id"]
                ))
            
            return tuples
        except Exception as e:
            logger.error(f"Failed to list relationships: {e}")
            return []
    
    async def close(self):
        """Close client connections"""
        await self.http_client.aclose()
        if self._grpc_channel:
            await self._grpc_channel.close()
        logger.info("Permify client closed")


# Singleton instance
_client_instance: Optional[PermifyClient] = None


def get_permify_client() -> PermifyClient:
    """Get singleton Permify client instance"""
    global _client_instance
    if _client_instance is None:
        _client_instance = PermifyClient()
    return _client_instance

