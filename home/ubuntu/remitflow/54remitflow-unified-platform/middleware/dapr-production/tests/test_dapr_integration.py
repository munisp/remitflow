"""
Comprehensive Dapr Integration Tests
Tests all Dapr components and integrations
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
import json


class TestDaprStateManagement:
    """Test Dapr state management"""
    
    @pytest.mark.asyncio
    async def test_save_state(self):
        """Test saving state"""
        from src.state.state_manager import DaprStateManager
        
        with patch('dapr.clients.DaprClient') as mock_client:
            manager = DaprStateManager()
            
            result = await manager.save_state(
                key='test_key',
                value={'data': 'test_value'}
            )
            
            assert result == True
    
    @pytest.mark.asyncio
    async def test_get_state(self):
        """Test getting state"""
        from src.state.state_manager import DaprStateManager
        
        with patch('dapr.clients.DaprClient') as mock_client:
            mock_state = Mock()
            mock_state.data = json.dumps({'data': 'test_value'}).encode()
            mock_client.return_value.__enter__.return_value.get_state.return_value = mock_state
            
            manager = DaprStateManager()
            result = await manager.get_state('test_key')
            
            assert result == {'data': 'test_value'}
    
    @pytest.mark.asyncio
    async def test_delete_state(self):
        """Test deleting state"""
        from src.state.state_manager import DaprStateManager
        
        with patch('dapr.clients.DaprClient') as mock_client:
            manager = DaprStateManager()
            result = await manager.delete_state('test_key')
            
            assert result == True
    
    @pytest.mark.asyncio
    async def test_bulk_save_state(self):
        """Test bulk save"""
        from src.state.state_manager import DaprStateManager
        
        with patch('dapr.clients.DaprClient') as mock_client:
            manager = DaprStateManager()
            
            states = [
                {'key': 'key1', 'value': {'data': 'value1'}},
                {'key': 'key2', 'value': {'data': 'value2'}}
            ]
            
            result = await manager.save_bulk_state(states)
            assert result == True


class TestDaprPubSub:
    """Test Dapr pub/sub"""
    
    @pytest.mark.asyncio
    async def test_publish_event(self):
        """Test publishing event"""
        from src.pubsub.pubsub_manager import DaprPubSubManager
        
        with patch('dapr.clients.DaprClient') as mock_client:
            manager = DaprPubSubManager()
            
            result = await manager.publish_event(
                topic='test_topic',
                data={'event': 'test_event'}
            )
            
            assert result == True
    
    @pytest.mark.asyncio
    async def test_transaction_created_event(self):
        """Test transaction created event"""
        from src.pubsub.pubsub_manager import RemittancePubSubService
        
        with patch('dapr.clients.DaprClient') as mock_client:
            service = RemittancePubSubService()
            
            result = await service.publish_transaction_created(
                transaction_id='txn_123',
                transaction_data={'amount': 50000}
            )
            
            assert result == True
    
    @pytest.mark.asyncio
    async def test_fraud_alert_event(self):
        """Test fraud alert event"""
        from src.pubsub.pubsub_manager import RemittancePubSubService
        
        with patch('dapr.clients.DaprClient') as mock_client:
            service = RemittancePubSubService()
            
            result = await service.publish_fraud_alert(
                transaction_id='txn_123',
                fraud_score=0.85,
                indicators=['unusual_amount']
            )
            
            assert result == True


class TestDaprServiceInvocation:
    """Test Dapr service invocation"""
    
    @pytest.mark.asyncio
    async def test_invoke_payment_service(self):
        """Test invoking payment service"""
        from src.invocation.service_invocation import PaymentServiceClient
        
        with patch('dapr.clients.DaprClient') as mock_client:
            mock_response = Mock()
            mock_response.data = json.dumps({'status': 'success'}).encode()
            mock_client.return_value.__enter__.return_value.invoke_method.return_value = mock_response
            
            client = PaymentServiceClient()
            result = await client.initiate_transfer(
                sender_id='user_1',
                receiver_id='user_2',
                amount=50000.0,
                currency='NGN',
                corridor='PAPSS'
            )
            
            assert result['status'] == 'success'
    
    @pytest.mark.asyncio
    async def test_invoke_fraud_detection(self):
        """Test invoking fraud detection"""
        from src.invocation.service_invocation import FraudDetectionClient
        
        with patch('dapr.clients.DaprClient') as mock_client:
            mock_response = Mock()
            mock_response.data = json.dumps({'fraud_score': 0.1}).encode()
            mock_client.return_value.__enter__.return_value.invoke_method.return_value = mock_response
            
            client = FraudDetectionClient()
            result = await client.analyze_transaction({
                'transaction_id': 'txn_123',
                'amount': 50000
            })
            
            assert 'fraud_score' in result
    
    @pytest.mark.asyncio
    async def test_invoke_user_service(self):
        """Test invoking user service"""
        from src.invocation.service_invocation import UserServiceClient
        
        with patch('dapr.clients.DaprClient') as mock_client:
            mock_response = Mock()
            mock_response.data = json.dumps({'user_id': 'user_123', 'name': 'John'}).encode()
            mock_client.return_value.__enter__.return_value.invoke_method.return_value = mock_response
            
            client = UserServiceClient()
            result = await client.get_user('user_123')
            
            assert result['user_id'] == 'user_123'


class TestDaprActors:
    """Test Dapr actors"""
    
    @pytest.mark.asyncio
    async def test_transaction_actor_initialization(self):
        """Test transaction actor initialization"""
        from src.actors.transaction_actor import TransactionActor
        from dapr.actor.runtime.context import ActorRuntimeContext
        
        ctx = Mock(spec=ActorRuntimeContext)
        actor = TransactionActor(ctx, 'txn_123')
        
        assert actor.transaction_id == 'txn_123'
    
    @pytest.mark.asyncio
    async def test_transaction_actor_initiate(self):
        """Test transaction initiation"""
        from src.actors.transaction_actor import TransactionActor
        from dapr.actor.runtime.context import ActorRuntimeContext
        
        ctx = Mock(spec=ActorRuntimeContext)
        actor = TransactionActor(ctx, 'txn_123')
        
        # Mock state manager
        actor._state_manager = AsyncMock()
        actor._state_manager.get_state = AsyncMock(return_value={'status': 'INITIALIZED', 'attempts': 0})
        actor._state_manager.set_state = AsyncMock()
        actor._state_manager.save_state = AsyncMock()
        actor.register_reminder = AsyncMock()
        
        result = await actor.initiate_transaction({
            'amount': 50000,
            'currency': 'NGN'
        })
        
        assert result['status'] == 'success'
    
    @pytest.mark.asyncio
    async def test_user_actor_balance_update(self):
        """Test user actor balance update"""
        from src.actors.transaction_actor import UserActor
        from dapr.actor.runtime.context import ActorRuntimeContext
        
        ctx = Mock(spec=ActorRuntimeContext)
        actor = UserActor(ctx, 'user_123')
        
        # Mock state manager
        actor._state_manager = AsyncMock()
        actor._state_manager.get_state = AsyncMock(return_value={
            'user_id': 'user_123',
            'balance': 100000.0,
            'transaction_count': 0
        })
        actor._state_manager.set_state = AsyncMock()
        actor._state_manager.save_state = AsyncMock()
        
        result = await actor.update_balance(50000.0, 'debit')
        
        assert result['status'] == 'success'
        assert result['balance'] == 50000.0


class TestDaprIntegration:
    """Test Dapr integration with platform services"""
    
    @pytest.mark.asyncio
    async def test_end_to_end_transaction_flow(self):
        """Test complete transaction flow through Dapr"""
        from src.state.state_manager import DaprStateManager
        from src.pubsub.pubsub_manager import RemittancePubSubService
        from src.invocation.service_invocation import PaymentServiceClient
        
        with patch('dapr.clients.DaprClient') as mock_client:
            # Mock responses
            mock_response = Mock()
            mock_response.data = json.dumps({'status': 'success', 'transaction_id': 'txn_123'}).encode()
            mock_client.return_value.__enter__.return_value.invoke_method.return_value = mock_response
            
            # 1. Initiate transfer
            payment_client = PaymentServiceClient()
            transfer_result = await payment_client.initiate_transfer(
                sender_id='user_1',
                receiver_id='user_2',
                amount=50000.0,
                currency='NGN',
                corridor='PAPSS'
            )
            
            assert transfer_result['status'] == 'success'
            
            # 2. Publish event
            pubsub_service = RemittancePubSubService()
            event_result = await pubsub_service.publish_transaction_created(
                transaction_id=transfer_result['transaction_id'],
                transaction_data={'amount': 50000.0}
            )
            
            assert event_result == True
            
            # 3. Save state
            state_manager = DaprStateManager()
            state_result = await state_manager.save_state(
                key=f"transaction:{transfer_result['transaction_id']}",
                value={'status': 'COMPLETED'}
            )
            
            assert state_result == True


@pytest.fixture
def event_loop():
    """Create event loop for async tests"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

