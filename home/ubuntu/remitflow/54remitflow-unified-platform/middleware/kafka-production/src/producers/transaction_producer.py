"""
Kafka Transaction Producer
Production-ready Kafka producer for transaction events with Avro serialization
"""

import json
import logging
import time
from typing import Dict, Any, Optional
from confluent_kafka import Producer
from confluent_kafka.serialization import SerializationContext, MessageField
from confluent_kafka.schema_registry import SchemaRegistryClient
from confluent_kafka.schema_registry.avro import AvroSerializer

import sys
sys.path.append('..')
from config.kafka_config import get_producer_config, kafka_config
from schemas.transaction_schema import (
    TRANSACTION_CREATED_SCHEMA,
    TRANSACTION_COMPLETED_SCHEMA,
    TRANSACTION_FAILED_SCHEMA,
    FRAUD_ALERT_SCHEMA
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TransactionProducer:
    """
    Production-ready Kafka producer for transaction events
    
    Features:
    - Avro serialization with schema registry
    - Exactly-once semantics
    - Automatic retries
    - Error handling
    - Metrics tracking
    """
    
    def __init__(self):
        """Initialize Kafka producer with Avro serialization"""
        self.config = get_producer_config()
        self.producer = Producer(self.config)
        
        # Initialize schema registry client
        schema_registry_conf = {'url': kafka_config.schema_registry_url}
        self.schema_registry_client = SchemaRegistryClient(schema_registry_conf)
        
        # Create Avro serializers for each event type
        self.transaction_created_serializer = AvroSerializer(
            self.schema_registry_client,
            json.dumps(TRANSACTION_CREATED_SCHEMA)
        )
        self.transaction_completed_serializer = AvroSerializer(
            self.schema_registry_client,
            json.dumps(TRANSACTION_COMPLETED_SCHEMA)
        )
        self.transaction_failed_serializer = AvroSerializer(
            self.schema_registry_client,
            json.dumps(TRANSACTION_FAILED_SCHEMA)
        )
        self.fraud_alert_serializer = AvroSerializer(
            self.schema_registry_client,
            json.dumps(FRAUD_ALERT_SCHEMA)
        )
        
        # Metrics
        self.messages_sent = 0
        self.messages_failed = 0
        self.start_time = time.time()
        
        logger.info("TransactionProducer initialized successfully")
    
    def _delivery_callback(self, err, msg):
        """Callback for message delivery confirmation"""
        if err:
            self.messages_failed += 1
            logger.error(f"Message delivery failed: {err}")
        else:
            self.messages_sent += 1
            logger.debug(
                f"Message delivered to {msg.topic()} "
                f"[partition {msg.partition()}] at offset {msg.offset()}"
            )
    
    def publish_transaction_created(self, transaction: Dict[str, Any]) -> bool:
        """
        Publish transaction created event
        
        Args:
            transaction: Transaction data matching TransactionCreated schema
            
        Returns:
            bool: True if published successfully
        """
        try:
            topic = 'transactions.created'
            key = transaction['transaction_id']
            
            # Serialize value using Avro
            serialization_context = SerializationContext(topic, MessageField.VALUE)
            value = self.transaction_created_serializer(
                transaction,
                serialization_context
            )
            
            # Produce message
            self.producer.produce(
                topic=topic,
                key=key.encode('utf-8'),
                value=value,
                on_delivery=self._delivery_callback
            )
            
            # Flush to ensure delivery
            self.producer.poll(0)
            
            logger.info(f"Published transaction created event: {key}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to publish transaction created event: {e}")
            return False
    
    def publish_transaction_completed(self, transaction: Dict[str, Any]) -> bool:
        """
        Publish transaction completed event
        
        Args:
            transaction: Transaction data matching TransactionCompleted schema
            
        Returns:
            bool: True if published successfully
        """
        try:
            topic = 'transactions.completed'
            key = transaction['transaction_id']
            
            serialization_context = SerializationContext(topic, MessageField.VALUE)
            value = self.transaction_completed_serializer(
                transaction,
                serialization_context
            )
            
            self.producer.produce(
                topic=topic,
                key=key.encode('utf-8'),
                value=value,
                on_delivery=self._delivery_callback
            )
            
            self.producer.poll(0)
            
            logger.info(f"Published transaction completed event: {key}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to publish transaction completed event: {e}")
            return False
    
    def publish_transaction_failed(self, transaction: Dict[str, Any]) -> bool:
        """
        Publish transaction failed event
        
        Args:
            transaction: Transaction data matching TransactionFailed schema
            
        Returns:
            bool: True if published successfully
        """
        try:
            topic = 'transactions.failed'
            key = transaction['transaction_id']
            
            serialization_context = SerializationContext(topic, MessageField.VALUE)
            value = self.transaction_failed_serializer(
                transaction,
                serialization_context
            )
            
            self.producer.produce(
                topic=topic,
                key=key.encode('utf-8'),
                value=value,
                on_delivery=self._delivery_callback
            )
            
            self.producer.poll(0)
            
            logger.info(f"Published transaction failed event: {key}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to publish transaction failed event: {e}")
            return False
    
    def publish_fraud_alert(self, alert: Dict[str, Any]) -> bool:
        """
        Publish fraud alert event
        
        Args:
            alert: Fraud alert data matching FraudAlert schema
            
        Returns:
            bool: True if published successfully
        """
        try:
            topic = 'fraud.alerts'
            key = alert['alert_id']
            
            serialization_context = SerializationContext(topic, MessageField.VALUE)
            value = self.fraud_alert_serializer(
                alert,
                serialization_context
            )
            
            self.producer.produce(
                topic=topic,
                key=key.encode('utf-8'),
                value=value,
                on_delivery=self._delivery_callback
            )
            
            self.producer.poll(0)
            
            logger.warning(f"Published fraud alert: {key} (score: {alert['fraud_score']})")
            return True
            
        except Exception as e:
            logger.error(f"Failed to publish fraud alert: {e}")
            return False
    
    def flush(self, timeout: float = 10.0):
        """
        Flush all pending messages
        
        Args:
            timeout: Maximum time to wait for flush (seconds)
        """
        remaining = self.producer.flush(timeout)
        if remaining > 0:
            logger.warning(f"{remaining} messages were not delivered")
        else:
            logger.info("All messages flushed successfully")
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get producer metrics"""
        uptime = time.time() - self.start_time
        return {
            'messages_sent': self.messages_sent,
            'messages_failed': self.messages_failed,
            'success_rate': self.messages_sent / max(1, self.messages_sent + self.messages_failed),
            'uptime_seconds': uptime,
            'messages_per_second': self.messages_sent / max(1, uptime)
        }
    
    def close(self):
        """Close producer and flush remaining messages"""
        logger.info("Closing producer...")
        self.flush()
        logger.info(f"Producer closed. Metrics: {self.get_metrics()}")


# Example usage
if __name__ == '__main__':
    import uuid
    from datetime import datetime
    
    producer = TransactionProducer()
    
    # Example: Publish transaction created event
    transaction_created = {
        'transaction_id': str(uuid.uuid4()),
        'sender_id': 'user_123',
        'receiver_id': 'user_456',
        'amount': 50000.0,
        'currency': 'NGN',
        'corridor': 'PAPSS',
        'status': 'PENDING',
        'created_at': int(datetime.now().timestamp() * 1000),
        'metadata': {'source': 'mobile_app', 'version': '2.0'}
    }
    
    producer.publish_transaction_created(transaction_created)
    
    # Example: Publish fraud alert
    fraud_alert = {
        'alert_id': str(uuid.uuid4()),
        'transaction_id': transaction_created['transaction_id'],
        'user_id': 'user_123',
        'fraud_score': 0.85,
        'risk_level': 'HIGH',
        'detected_at': int(datetime.now().timestamp() * 1000),
        'fraud_indicators': ['unusual_amount', 'new_device', 'velocity_check'],
        'action_taken': 'REVIEW_REQUIRED',
        'model_version': 'v2.1.0'
    }
    
    producer.publish_fraud_alert(fraud_alert)
    
    # Flush and close
    producer.close()

