"""
Unit tests for Permify client
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from client.permify_client import (
    PermifyClient,
    PermissionResult,
    PermissionCheckRequest,
    PermissionCheckResponse,
    RelationshipTuple,
    CircuitBreaker,
    CircuitBreakerState
)


class TestPermifyClient:
    """Test suite for Permify client"""
    
    @pytest.fixture
    def client(self):
        """Create test client"""
        return PermifyClient(
            base_url="http://localhost:3476",
            api_key="test_api_key",
            tenant_id="test_tenant"
        )
    
    @pytest.mark.asyncio
    async def test_check_permission_allowed(self, client):
        """Test permission check - allowed"""
        with patch.object(client.http_client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value.json.return_value = {"can": "RESULT_ALLOWED"}
            mock_post.return_value.raise_for_status = Mock()
            
            result = await client.check_permission(
                entity_type="account",
                entity_id="acc_123",
                permission="view",
                subject_type="user",
                subject_id="user_123"
            )
            
            assert result.can == PermissionResult.ALLOWED
            assert result.duration_ms > 0
    
    @pytest.mark.asyncio
    async def test_check_permission_denied(self, client):
        """Test permission check - denied"""
        with patch.object(client.http_client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value.json.return_value = {"can": "RESULT_DENIED"}
            mock_post.return_value.raise_for_status = Mock()
            
            result = await client.check_permission(
                entity_type="account",
                entity_id="acc_123",
                permission="transfer",
                subject_type="user",
                subject_id="user_123"
            )
            
            assert result.can == PermissionResult.DENIED
    
    @pytest.mark.asyncio
    async def test_create_relationship(self, client):
        """Test relationship creation"""
        with patch.object(client.http_client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value.raise_for_status = Mock()
            
            result = await client.create_relationship(
                entity_type="account",
                entity_id="acc_123",
                relation="owner",
                subject_type="user",
                subject_id="user_123"
            )
            
            assert result is True
            mock_post.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_delete_relationship(self, client):
        """Test relationship deletion"""
        with patch.object(client.http_client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value.raise_for_status = Mock()
            
            result = await client.delete_relationship(
                entity_type="account",
                entity_id="acc_123",
                relation="owner",
                subject_type="user",
                subject_id="user_123"
            )
            
            assert result is True
    
    @pytest.mark.asyncio
    async def test_list_relationships(self, client):
        """Test listing relationships"""
        with patch.object(client.http_client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value.json.return_value = {
                "tuples": [
                    {
                        "entity": {"type": "account", "id": "acc_123"},
                        "relation": "owner",
                        "subject": {"type": "user", "id": "user_123"}
                    }
                ]
            }
            mock_get.return_value.raise_for_status = Mock()
            
            result = await client.list_relationships(
                entity_type="account",
                entity_id="acc_123"
            )
            
            assert len(result) == 1
            assert result[0].entity_id == "acc_123"
            assert result[0].relation == "owner"
    
    @pytest.mark.asyncio
    async def test_cache_hit(self, client):
        """Test permission check cache hit"""
        with patch.object(client.http_client, 'post', new_callable=AsyncMock) as mock_post:
            mock_post.return_value.json.return_value = {"can": "RESULT_ALLOWED"}
            mock_post.return_value.raise_for_status = Mock()
            
            # First call - cache miss
            result1 = await client.check_permission(
                entity_type="account",
                entity_id="acc_123",
                permission="view",
                subject_type="user",
                subject_id="user_123"
            )
            
            # Second call - cache hit
            result2 = await client.check_permission(
                entity_type="account",
                entity_id="acc_123",
                permission="view",
                subject_type="user",
                subject_id="user_123"
            )
            
            # HTTP client should only be called once
            assert mock_post.call_count == 1
            assert result1.can == result2.can


class TestCircuitBreaker:
    """Test suite for circuit breaker"""
    
    def test_circuit_breaker_initial_state(self):
        """Test circuit breaker initial state"""
        cb = CircuitBreaker(failure_threshold=3, timeout=60)
        assert cb.state == CircuitBreakerState.CLOSED
        assert cb.failure_count == 0
    
    @pytest.mark.asyncio
    async def test_circuit_breaker_opens_on_failures(self):
        """Test circuit breaker opens after threshold failures"""
        cb = CircuitBreaker(failure_threshold=3, timeout=60)
        
        @cb.call
        async def failing_function():
            raise Exception("Test failure")
        
        # Trigger failures
        for i in range(3):
            with pytest.raises(Exception):
                await failing_function()
        
        assert cb.state == CircuitBreakerState.OPEN
        assert cb.failure_count >= 3
    
    @pytest.mark.asyncio
    async def test_circuit_breaker_rejects_when_open(self):
        """Test circuit breaker rejects calls when open"""
        cb = CircuitBreaker(failure_threshold=1, timeout=60)
        
        @cb.call
        async def failing_function():
            raise Exception("Test failure")
        
        # Trigger failure to open circuit
        with pytest.raises(Exception):
            await failing_function()
        
        assert cb.state == CircuitBreakerState.OPEN
        
        # Next call should be rejected
        with pytest.raises(Exception, match="Circuit breaker is OPEN"):
            await failing_function()


@pytest.mark.asyncio
async def test_permission_check_request():
    """Test PermissionCheckRequest dataclass"""
    request = PermissionCheckRequest(
        tenant_id="test_tenant",
        entity_type="account",
        entity_id="acc_123",
        permission="view",
        subject_type="user",
        subject_id="user_123"
    )
    
    assert request.tenant_id == "test_tenant"
    assert request.entity_type == "account"
    assert request.permission == "view"


@pytest.mark.asyncio
async def test_relationship_tuple():
    """Test RelationshipTuple dataclass"""
    tuple_data = RelationshipTuple(
        tenant_id="test_tenant",
        entity_type="account",
        entity_id="acc_123",
        relation="owner",
        subject_type="user",
        subject_id="user_123"
    )
    
    assert tuple_data.entity_type == "account"
    assert tuple_data.relation == "owner"
    assert tuple_data.subject_id == "user_123"

