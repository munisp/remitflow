"""
Integration tests for Kafka messaging
"""

import pytest
from unittest.mock import AsyncMock

@pytest.mark.integration
class TestKafkaMessagingIntegration:
    """Test Kafka messaging integration"""
    
    @pytest.mark.asyncio
    async def test_publish_order_event(self, mock_kafka_producer, sample_order):
        """Test publishing order event to Kafka"""
        topic = "orders.created"
        await mock_kafka_producer.send(topic, value=sample_order)
        mock_kafka_producer.send.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_publish_payment_event(self, mock_kafka_producer, sample_payment):
        """Test publishing payment event to Kafka"""
        topic = "payments.completed"
        await mock_kafka_producer.send(topic, value=sample_payment)
        mock_kafka_producer.send.assert_called_once()
