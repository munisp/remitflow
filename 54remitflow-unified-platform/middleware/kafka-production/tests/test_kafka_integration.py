"""
Kafka Integration Tests
Comprehensive tests for Kafka producers, consumers, and integrations
"""

import pytest
import uuid
import time
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock

import sys
sys.path.append('..')
from src.producers.transaction_producer import TransactionProducer
from src.consumers.transaction_consumer import TransactionConsumer
from src.integrations.platform_integration import PlatformIntegration


class TestTransactionProducer:
    """Test Kafka producer functionality"""
    
    @pytest.fixture
    def producer(self):
        """Create producer instance"""
        with patch('src.producers.transaction_producer.Producer'):
            with patch('src.producers.transaction_producer.SchemaRegistryClient'):
                producer = TransactionProducer()
                yield producer
                producer.close()
    
    def test_producer_initialization(self, producer):
        """Test producer initializes correctly"""
        assert producer is not None
        assert producer.messages_sent == 0
        assert producer.messages_failed == 0
    
    def test_publish_transaction_created(self, producer):
        """Test publishing transaction created event"""
        transaction = {
            'transaction_id': str(uuid.uuid4()),
            'sender_id': 'user_123',
            'receiver_id': 'user_456',
            'amount': 50000.0,
            'currency': 'NGN',
            'corridor': 'PAPSS',
            'status': 'PENDING',
            'created_at': int(datetime.now().timestamp() * 1000),
            'metadata': None
        }
        
        # Mock the producer
        producer.producer = Mock()
        producer.transaction_created_serializer = Mock(return_value=b'serialized_data')
        
        result = producer.publish_transaction_created(transaction)
        
        assert result == True
        producer.producer.produce.assert_called_once()
    
    def test_publish_fraud_alert(self, producer):
        """Test publishing fraud alert"""
        alert = {
            'alert_id': str(uuid.uuid4()),
            'transaction_id': str(uuid.uuid4()),
            'user_id': 'user_123',
            'fraud_score': 0.85,
            'risk_level': 'HIGH',
            'detected_at': int(datetime.now().timestamp() * 1000),
            'fraud_indicators': ['unusual_amount', 'new_device'],
            'action_taken': 'REVIEW_REQUIRED',
            'model_version': 'v2.1.0'
        }
        
        producer.producer = Mock()
        producer.fraud_alert_serializer = Mock(return_value=b'serialized_alert')
        
        result = producer.publish_fraud_alert(alert)
        
        assert result == True
        producer.producer.produce.assert_called_once()
    
    def test_get_metrics(self, producer):
        """Test metrics collection"""
        producer.messages_sent = 100
        producer.messages_failed = 5
        
        metrics = producer.get_metrics()
        
        assert metrics['messages_sent'] == 100
        assert metrics['messages_failed'] == 5
        assert 0 < metrics['success_rate'] <= 1.0
        assert metrics['uptime_seconds'] > 0


class TestTransactionConsumer:
    """Test Kafka consumer functionality"""
    
    @pytest.fixture
    def consumer(self):
        """Create consumer instance"""
        with patch('src.consumers.transaction_consumer.Consumer'):
            with patch('src.consumers.transaction_consumer.SchemaRegistryClient'):
                consumer = TransactionConsumer(group_id='test-group')
                yield consumer
    
    def test_consumer_initialization(self, consumer):
        """Test consumer initializes correctly"""
        assert consumer is not None
        assert consumer.messages_consumed == 0
        assert consumer.messages_processed == 0
        assert consumer.running == True
    
    def test_subscribe(self, consumer):
        """Test topic subscription"""
        topics = ['transactions.created', 'fraud.alerts']
        consumer.consumer = Mock()
        
        consumer.subscribe(topics)
        
        consumer.consumer.subscribe.assert_called_once_with(topics)
    
    def test_process_message_success(self, consumer):
        """Test successful message processing"""
        # Create mock message
        mock_msg = Mock()
        mock_msg.topic.return_value = 'transactions.created'
        mock_msg.partition.return_value = 0
        mock_msg.offset.return_value = 123
        mock_msg.key.return_value = b'txn_123'
        mock_msg.value.return_value = b'serialized_data'
        mock_msg.timestamp.return_value = (0, 1234567890000)
        
        # Mock deserializer
        consumer.avro_deserializer = Mock(return_value={
            'transaction_id': 'txn_123',
            'amount': 50000.0
        })
        
        # Mock handler
        handler = Mock(return_value=True)
        
        result = consumer._process_message(mock_msg, handler, max_retries=3)
        
        assert result == True
        handler.assert_called_once()
    
    def test_process_message_retry(self, consumer):
        """Test message processing with retries"""
        mock_msg = Mock()
        mock_msg.topic.return_value = 'transactions.created'
        mock_msg.partition.return_value = 0
        mock_msg.offset.return_value = 123
        mock_msg.key.return_value = b'txn_123'
        mock_msg.value.return_value = b'serialized_data'
        mock_msg.timestamp.return_value = (0, 1234567890000)
        
        consumer.avro_deserializer = Mock(return_value={'transaction_id': 'txn_123'})
        
        # Handler fails twice then succeeds
        handler = Mock(side_effect=[False, False, True])
        
        with patch('time.sleep'):  # Skip sleep in tests
            result = consumer._process_message(mock_msg, handler, max_retries=3)
        
        assert result == True
        assert handler.call_count == 3
    
    def test_get_metrics(self, consumer):
        """Test consumer metrics"""
        consumer.messages_consumed = 200
        consumer.messages_processed = 195
        consumer.messages_failed = 5
        
        metrics = consumer.get_metrics()
        
        assert metrics['messages_consumed'] == 200
        assert metrics['messages_processed'] == 195
        assert metrics['messages_failed'] == 5
        assert metrics['success_rate'] > 0.9


class TestPlatformIntegration:
    """Test platform integration functionality"""
    
    @pytest.fixture
    def integration(self):
        """Create integration instance"""
        with patch('src.integrations.platform_integration.TransactionProducer'):
            integration = PlatformIntegration()
            yield integration
            integration.close()
    
    @pytest.mark.asyncio
    async def test_handle_tigerbeetle_transfer(self, integration):
        """Test TigerBeetle transfer handling"""
        transfer_data = {
            'id': 12345,
            'debit_account_id': 'account_123',
            'credit_account_id': 'account_456',
            'amount': 50000,
            'ledger': 710,
            'corridor': 'PAPSS'
        }
        
        integration.producer.publish_transaction_created = Mock(return_value=True)
        
        result = await integration.handle_tigerbeetle_transfer(transfer_data)
        
        assert result == True
        integration.producer.publish_transaction_created.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_handle_fraud_detection_high_risk(self, integration):
        """Test fraud detection for high-risk transaction"""
        integration.producer.publish_fraud_alert = Mock(return_value=True)
        
        result = await integration.handle_fraud_detection('txn_123', 0.85)
        
        assert result == True
        integration.producer.publish_fraud_alert.assert_called_once()
        
        # Check alert details
        call_args = integration.producer.publish_fraud_alert.call_args[0][0]
        assert call_args['fraud_score'] == 0.85
        assert call_args['risk_level'] == 'CRITICAL'
        assert call_args['action_taken'] == 'BLOCKED'
    
    @pytest.mark.asyncio
    async def test_handle_fraud_detection_low_risk(self, integration):
        """Test fraud detection for low-risk transaction"""
        integration.producer.publish_fraud_alert = Mock(return_value=True)
        
        result = await integration.handle_fraud_detection('txn_123', 0.2)
        
        assert result == True
        # Should not publish alert for low risk
        integration.producer.publish_fraud_alert.assert_not_called()


class TestEndToEnd:
    """End-to-end integration tests"""
    
    @pytest.mark.integration
    def test_full_transaction_flow(self):
        """Test complete transaction flow through Kafka"""
        # This would require a running Kafka cluster
        # Skip in unit tests, run in integration test environment
        pytest.skip("Requires running Kafka cluster")
    
    @pytest.mark.integration
    def test_fraud_alert_flow(self):
        """Test fraud alert flow through system"""
        pytest.skip("Requires running Kafka cluster")


# Performance tests
class TestPerformance:
    """Performance and load tests"""
    
    def test_producer_throughput(self):
        """Test producer can handle high throughput"""
        with patch('src.producers.transaction_producer.Producer'):
            with patch('src.producers.transaction_producer.SchemaRegistryClient'):
                producer = TransactionProducer()
                producer.producer = Mock()
                producer.transaction_created_serializer = Mock(return_value=b'data')
                
                # Publish 1000 messages
                start_time = time.time()
                for i in range(1000):
                    transaction = {
                        'transaction_id': str(uuid.uuid4()),
                        'sender_id': 'user_123',
                        'receiver_id': 'user_456',
                        'amount': 50000.0,
                        'currency': 'NGN',
                        'corridor': 'PAPSS',
                        'status': 'PENDING',
                        'created_at': int(datetime.now().timestamp() * 1000),
                        'metadata': None
                    }
                    producer.publish_transaction_created(transaction)
                
                elapsed = time.time() - start_time
                throughput = 1000 / elapsed
                
                # Should handle at least 100 messages/second
                assert throughput > 100
                
                producer.close()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

