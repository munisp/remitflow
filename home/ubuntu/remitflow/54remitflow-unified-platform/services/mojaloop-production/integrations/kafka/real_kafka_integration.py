"""
Real Kafka Integration for Mojaloop
Production-ready Kafka producer and consumer with error handling
"""

import json
import logging
from typing import Dict, Any, Optional, Callable, List
from datetime import datetime
from kafka import KafkaProducer, KafkaConsumer, KafkaAdminClient
from kafka.admin import NewTopic
from kafka.errors import KafkaError
import uuid

logger = logging.getLogger(__name__)


class MojaloopKafkaProducer:
    """Production Kafka producer for Mojaloop events"""
    
    def __init__(self, bootstrap_servers: str = 'localhost:9092'):
        """Initialize Kafka producer"""
        self.bootstrap_servers = bootstrap_servers.split(',')
        self.topic_prefix = 'mojaloop'
        
        self.producer = KafkaProducer(
            bootstrap_servers=self.bootstrap_servers,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None,
            acks='all',  # Wait for all replicas
            retries=3,
            max_in_flight_requests_per_connection=5,
            compression_type='gzip',
            linger_ms=10,  # Batch messages for 10ms
            batch_size=16384  # 16KB batch size
        )
        
        logger.info(f"Kafka producer initialized: {self.bootstrap_servers}")
    
    def publish_event(
        self,
        event_type: str,
        payload: Dict[str, Any],
        key: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None
    ) -> bool:
        """
        Publish event to Kafka
        
        Args:
            event_type: Type of event (e.g., 'quote.created', 'transfer.committed')
            payload: Event payload
            key: Partition key
            headers: Event headers
        
        Returns:
            True if published successfully
        """
        try:
            # Build event
            event = {
                'event_id': str(uuid.uuid4()),
                'event_type': event_type,
                'timestamp': datetime.utcnow().isoformat(),
                'payload': payload,
                'metadata': {
                    'source': 'mojaloop-hub',
                    'version': '1.0'
                }
            }
            
            # Determine topic
            topic = self._get_topic_for_event(event_type)
            
            # Prepare headers
            kafka_headers = []
            if headers:
                kafka_headers = [(k, v.encode('utf-8')) for k, v in headers.items()]
            kafka_headers.append(('event_type', event_type.encode('utf-8')))
            
            # Send to Kafka
            future = self.producer.send(
                topic,
                value=event,
                key=key,
                headers=kafka_headers
            )
            
            # Wait for acknowledgment (with timeout)
            record_metadata = future.get(timeout=10)
            
            logger.info(
                f"Event published: {event_type} to {topic} "
                f"(partition={record_metadata.partition}, offset={record_metadata.offset})"
            )
            
            return True
            
        except KafkaError as e:
            logger.error(f"Failed to publish event {event_type}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error publishing event: {e}")
            return False
    
    def publish_quote_created(self, quote_data: Dict[str, Any]) -> bool:
        """Publish quote created event"""
        return self.publish_event(
            'quote.created',
            quote_data,
            key=quote_data.get('quote_id')
        )
    
    def publish_transfer_prepared(self, transfer_data: Dict[str, Any]) -> bool:
        """Publish transfer prepared event"""
        return self.publish_event(
            'transfer.prepared',
            transfer_data,
            key=transfer_data.get('transfer_id')
        )
    
    def publish_transfer_committed(self, transfer_data: Dict[str, Any]) -> bool:
        """Publish transfer committed event"""
        return self.publish_event(
            'transfer.committed',
            transfer_data,
            key=transfer_data.get('transfer_id')
        )
    
    def publish_payment_completed(self, payment_data: Dict[str, Any]) -> bool:
        """Publish payment completed event"""
        return self.publish_event(
            'payment.completed',
            payment_data,
            key=payment_data.get('payment_id')
        )
    
    def publish_cross_border_payment(self, payment_data: Dict[str, Any]) -> bool:
        """Publish cross-border payment event"""
        return self.publish_event(
            'payment.cross_border.completed',
            payment_data,
            key=payment_data.get('payment_id')
        )
    
    def _get_topic_for_event(self, event_type: str) -> str:
        """Get Kafka topic for event type"""
        if 'quote' in event_type:
            return f"{self.topic_prefix}.quotes"
        elif 'transfer' in event_type:
            return f"{self.topic_prefix}.transfers"
        elif 'settlement' in event_type:
            return f"{self.topic_prefix}.settlements"
        elif 'payment' in event_type:
            return f"{self.topic_prefix}.payments"
        elif 'participant' in event_type:
            return f"{self.topic_prefix}.participants"
        else:
            return f"{self.topic_prefix}.events"
    
    def flush(self):
        """Flush pending messages"""
        self.producer.flush()
    
    def close(self):
        """Close producer"""
        self.producer.close()
        logger.info("Kafka producer closed")


class MojaloopKafkaConsumer:
    """Production Kafka consumer for Mojaloop events"""
    
    def __init__(
        self,
        bootstrap_servers: str = 'localhost:9092',
        group_id: str = 'mojaloop-hub',
        topics: Optional[List[str]] = None
    ):
        """Initialize Kafka consumer"""
        self.bootstrap_servers = bootstrap_servers.split(',')
        self.group_id = group_id
        self.topic_prefix = 'mojaloop'
        
        # Default topics
        if topics is None:
            topics = [
                f"{self.topic_prefix}.quotes",
                f"{self.topic_prefix}.transfers",
                f"{self.topic_prefix}.payments",
                f"{self.topic_prefix}.settlements"
            ]
        
        self.consumer = KafkaConsumer(
            *topics,
            bootstrap_servers=self.bootstrap_servers,
            group_id=group_id,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            key_deserializer=lambda k: k.decode('utf-8') if k else None,
            auto_offset_reset='earliest',
            enable_auto_commit=False,  # Manual commit for reliability
            max_poll_records=100,
            session_timeout_ms=30000,
            heartbeat_interval_ms=10000
        )
        
        logger.info(f"Kafka consumer initialized: {self.bootstrap_servers}, topics: {topics}")
    
    def consume_events(self, handler: Callable[[Dict[str, Any]], None]):
        """
        Consume events and process with handler
        
        Args:
            handler: Function to handle each event
        """
        try:
            for message in self.consumer:
                try:
                    event = message.value
                    event_type = event.get('event_type')
                    
                    logger.debug(
                        f"Received event: {event_type} from {message.topic} "
                        f"(partition={message.partition}, offset={message.offset})"
                    )
                    
                    # Process event
                    handler(event)
                    
                    # Commit offset after successful processing
                    self.consumer.commit()
                    
                except Exception as e:
                    logger.error(f"Error processing event: {e}")
                    # Don't commit offset on error - will retry
                    
        except KeyboardInterrupt:
            logger.info("Consumer interrupted")
        finally:
            self.close()
    
    def close(self):
        """Close consumer"""
        self.consumer.close()
        logger.info("Kafka consumer closed")


class MojaloopKafkaAdmin:
    """Kafka admin for topic management"""
    
    def __init__(self, bootstrap_servers: str = 'localhost:9092'):
        """Initialize Kafka admin client"""
        self.bootstrap_servers = bootstrap_servers.split(',')
        self.admin_client = KafkaAdminClient(
            bootstrap_servers=self.bootstrap_servers
        )
        self.topic_prefix = 'mojaloop'
    
    def create_topics(self):
        """Create all Mojaloop topics"""
        topics = [
            NewTopic(
                name=f"{self.topic_prefix}.quotes",
                num_partitions=10,
                replication_factor=3,
                topic_configs={
                    'retention.ms': '604800000',  # 7 days
                    'compression.type': 'gzip'
                }
            ),
            NewTopic(
                name=f"{self.topic_prefix}.transfers",
                num_partitions=10,
                replication_factor=3,
                topic_configs={
                    'retention.ms': '604800000',
                    'compression.type': 'gzip'
                }
            ),
            NewTopic(
                name=f"{self.topic_prefix}.payments",
                num_partitions=10,
                replication_factor=3,
                topic_configs={
                    'retention.ms': '2592000000',  # 30 days
                    'compression.type': 'gzip'
                }
            ),
            NewTopic(
                name=f"{self.topic_prefix}.settlements",
                num_partitions=5,
                replication_factor=3,
                topic_configs={
                    'retention.ms': '2592000000',
                    'compression.type': 'gzip'
                }
            ),
            NewTopic(
                name=f"{self.topic_prefix}.participants",
                num_partitions=3,
                replication_factor=3,
                topic_configs={
                    'retention.ms': '7776000000',  # 90 days
                    'compression.type': 'gzip'
                }
            ),
            NewTopic(
                name=f"{self.topic_prefix}.events",
                num_partitions=10,
                replication_factor=3,
                topic_configs={
                    'retention.ms': '604800000',
                    'compression.type': 'gzip'
                }
            )
        ]
        
        try:
            result = self.admin_client.create_topics(topics, validate_only=False)
            logger.info(f"Topics created: {[t.topic for t in topics]}")
            return result
        except Exception as e:
            logger.error(f"Failed to create topics: {e}")
            raise
    
    def close(self):
        """Close admin client"""
        self.admin_client.close()


# Event handlers
class PaymentEventHandler:
    """Handler for payment events"""
    
    def __init__(self, db_integration, metrics_exporter):
        """Initialize handler"""
        self.db = db_integration
        self.metrics = metrics_exporter
    
    def handle_event(self, event: Dict[str, Any]):
        """Handle payment event"""
        event_type = event.get('event_type')
        payload = event.get('payload')
        
        logger.info(f"Handling event: {event_type}")
        
        if event_type == 'quote.created':
            self._handle_quote_created(payload)
        elif event_type == 'transfer.prepared':
            self._handle_transfer_prepared(payload)
        elif event_type == 'transfer.committed':
            self._handle_transfer_committed(payload)
        elif event_type == 'payment.completed':
            self._handle_payment_completed(payload)
    
    def _handle_quote_created(self, payload: Dict[str, Any]):
        """Handle quote created event"""
        # Update metrics
        self.metrics.record_quote_created(
            payload.get('payer_fsp'),
            payload.get('payee_fsp'),
            payload.get('currency'),
            float(payload.get('amount', 0)),
            float(payload.get('fees', 0)),
            0.0
        )
    
    def _handle_transfer_prepared(self, payload: Dict[str, Any]):
        """Handle transfer prepared event"""
        # Update metrics
        self.metrics.record_transfer_prepared(
            payload.get('payer_fsp'),
            payload.get('payee_fsp'),
            payload.get('currency'),
            float(payload.get('amount', 0)),
            0.0
        )
    
    def _handle_transfer_committed(self, payload: Dict[str, Any]):
        """Handle transfer committed event"""
        # Update metrics
        self.metrics.record_transfer_fulfilled(
            payload.get('payer_fsp'),
            payload.get('payee_fsp'),
            0.0
        )
    
    def _handle_payment_completed(self, payload: Dict[str, Any]):
        """Handle payment completed event"""
        logger.info(f"Payment completed: {payload.get('payment_id')}")


# Example usage
if __name__ == '__main__':
    # Initialize producer
    producer = MojaloopKafkaProducer('localhost:9092')
    
    # Publish events
    producer.publish_quote_created({
        'quote_id': str(uuid.uuid4()),
        'payer_fsp': 'upi-india',
        'payee_fsp': 'papss-nigeria',
        'amount': 10000.00,
        'currency': 'INR'
    })
    
    producer.publish_payment_completed({
        'payment_id': str(uuid.uuid4()),
        'amount': 51200.00,
        'currency': 'NGN',
        'status': 'SUCCESS'
    })
    
    producer.flush()
    producer.close()
    
    print("Events published successfully")

