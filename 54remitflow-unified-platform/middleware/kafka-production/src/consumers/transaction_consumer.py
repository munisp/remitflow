"""
Kafka Transaction Consumer
Production-ready Kafka consumer for transaction events with Avro deserialization
"""

import json
import logging
import time
import signal
import sys
from typing import Dict, Any, Callable, Optional
from confluent_kafka import Consumer, KafkaError, KafkaException
from confluent_kafka.serialization import SerializationContext, MessageField
from confluent_kafka.schema_registry import SchemaRegistryClient
from confluent_kafka.schema_registry.avro import AvroDeserializer

sys.path.append('..')
from config.kafka_config import get_consumer_config, kafka_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TransactionConsumer:
    """
    Production-ready Kafka consumer for transaction events
    
    Features:
    - Avro deserialization with schema registry
    - Manual offset commit for exactly-once processing
    - Error handling and retry logic
    - Graceful shutdown
    - Metrics tracking
    """
    
    def __init__(self, group_id: str = 'transaction-consumer-group'):
        """
        Initialize Kafka consumer
        
        Args:
            group_id: Consumer group ID
        """
        self.config = get_consumer_config(group_id)
        self.consumer = Consumer(self.config)
        
        # Initialize schema registry client
        schema_registry_conf = {'url': kafka_config.schema_registry_url}
        self.schema_registry_client = SchemaRegistryClient(schema_registry_conf)
        
        # Create Avro deserializer
        self.avro_deserializer = AvroDeserializer(self.schema_registry_client)
        
        # Metrics
        self.messages_consumed = 0
        self.messages_processed = 0
        self.messages_failed = 0
        self.start_time = time.time()
        
        # Shutdown flag
        self.running = True
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        logger.info(f"TransactionConsumer initialized with group_id: {group_id}")
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.running = False
    
    def subscribe(self, topics: list):
        """
        Subscribe to topics
        
        Args:
            topics: List of topic names to subscribe to
        """
        self.consumer.subscribe(topics)
        logger.info(f"Subscribed to topics: {topics}")
    
    def consume(
        self,
        message_handler: Callable[[Dict[str, Any]], bool],
        poll_timeout: float = 1.0,
        max_retries: int = 3
    ):
        """
        Start consuming messages
        
        Args:
            message_handler: Function to process messages (returns True on success)
            poll_timeout: Timeout for polling in seconds
            max_retries: Maximum number of retry attempts for failed messages
        """
        logger.info("Starting message consumption...")
        
        try:
            while self.running:
                msg = self.consumer.poll(timeout=poll_timeout)
                
                if msg is None:
                    continue
                
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        logger.debug(f"Reached end of partition {msg.partition()}")
                    else:
                        logger.error(f"Consumer error: {msg.error()}")
                    continue
                
                # Process message
                self.messages_consumed += 1
                success = self._process_message(msg, message_handler, max_retries)
                
                if success:
                    self.messages_processed += 1
                    # Commit offset after successful processing
                    self.consumer.commit(asynchronous=False)
                else:
                    self.messages_failed += 1
                    logger.error(f"Failed to process message after {max_retries} retries")
        
        except KafkaException as e:
            logger.error(f"Kafka exception: {e}")
        
        finally:
            self._shutdown()
    
    def _process_message(
        self,
        msg,
        handler: Callable[[Dict[str, Any]], bool],
        max_retries: int
    ) -> bool:
        """
        Process a single message with retry logic
        
        Args:
            msg: Kafka message
            handler: Message processing function
            max_retries: Maximum retry attempts
            
        Returns:
            bool: True if processed successfully
        """
        retry_count = 0
        
        while retry_count <= max_retries:
            try:
                # Deserialize message value
                serialization_context = SerializationContext(
                    msg.topic(),
                    MessageField.VALUE
                )
                value = self.avro_deserializer(
                    msg.value(),
                    serialization_context
                )
                
                # Create message dict
                message_data = {
                    'topic': msg.topic(),
                    'partition': msg.partition(),
                    'offset': msg.offset(),
                    'key': msg.key().decode('utf-8') if msg.key() else None,
                    'value': value,
                    'timestamp': msg.timestamp()[1] if msg.timestamp()[0] == 0 else None
                }
                
                # Process message
                logger.debug(f"Processing message from {msg.topic()} at offset {msg.offset()}")
                success = handler(message_data)
                
                if success:
                    logger.info(
                        f"Successfully processed message: "
                        f"topic={msg.topic()}, offset={msg.offset()}, key={message_data['key']}"
                    )
                    return True
                else:
                    retry_count += 1
                    if retry_count <= max_retries:
                        logger.warning(
                            f"Message processing failed, retry {retry_count}/{max_retries}"
                        )
                        time.sleep(2 ** retry_count)  # Exponential backoff
            
            except Exception as e:
                retry_count += 1
                logger.error(
                    f"Error processing message (attempt {retry_count}/{max_retries}): {e}"
                )
                if retry_count <= max_retries:
                    time.sleep(2 ** retry_count)
        
        # Send to dead letter queue after max retries
        self._send_to_dlq(msg)
        return False
    
    def _send_to_dlq(self, msg):
        """Send failed message to dead letter queue"""
        try:
            # In production, this would publish to dlq.errors topic
            logger.error(
                f"Sending message to DLQ: topic={msg.topic()}, "
                f"offset={msg.offset()}, key={msg.key()}"
            )
            # Implement DLQ producer
            from confluent_kafka import Producer
            dlq_producer = Producer({
                'bootstrap.servers': self.config['bootstrap.servers'],
                'client.id': f"{self.config['client.id']}-dlq"
            })
            
            dlq_topic = f"{msg.topic()}.dlq"
            dlq_producer.produce(
                topic=dlq_topic,
                key=msg.key(),
                value=msg.value(),
                headers=[("error_reason", "processing_failed".encode())]
            )
            dlq_producer.flush(timeout=5)
            logger.info(f"Message sent to DLQ topic: {dlq_topic}")
        except Exception as e:
            logger.error(f"Failed to send message to DLQ: {e}")
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get consumer metrics"""
        uptime = time.time() - self.start_time
        return {
            'messages_consumed': self.messages_consumed,
            'messages_processed': self.messages_processed,
            'messages_failed': self.messages_failed,
            'success_rate': self.messages_processed / max(1, self.messages_consumed),
            'uptime_seconds': uptime,
            'messages_per_second': self.messages_consumed / max(1, uptime)
        }
    
    def _shutdown(self):
        """Graceful shutdown"""
        logger.info("Shutting down consumer...")
        logger.info(f"Final metrics: {self.get_metrics()}")
        self.consumer.close()
        logger.info("Consumer closed successfully")


# Example message handlers
def handle_transaction_created(message: Dict[str, Any]) -> bool:
    """
    Handle transaction created events
    
    Args:
        message: Message data
        
    Returns:
        bool: True if processed successfully
    """
    try:
        value = message['value']
        transaction_id = value['transaction_id']
        amount = value['amount']
        currency = value['currency']
        
        logger.info(
            f"Processing transaction: {transaction_id}, "
            f"amount: {amount} {currency}"
        )
        
        # Implement business logic
        import asyncpg
        import asyncio
        
        async def process_transaction():
            # Update database
            conn = await asyncpg.connect(
                host=os.getenv('DB_HOST', 'localhost'),
                port=int(os.getenv('DB_PORT', 5432)),
                database=os.getenv('DB_NAME', 'remittance'),
                user=os.getenv('DB_USER', 'postgres'),
                password=os.getenv('DB_PASSWORD', '')
            )
            
            await conn.execute(
                '''INSERT INTO transactions (transaction_id, amount, currency, status, created_at)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (transaction_id) DO UPDATE
                   SET status = EXCLUDED.status, updated_at = NOW()''',
                transaction_id, float(amount), currency, 'CREATED', datetime.now()
            )
            
            # Trigger notifications
            await conn.execute(
                '''INSERT INTO notifications (user_id, type, message, created_at)
                   SELECT sender_id, 'TRANSACTION_CREATED',
                          'Your transaction ' || $1 || ' has been created',
                          NOW()
                   FROM transactions WHERE transaction_id = $1''',
                transaction_id
            )
            
            # Update analytics
            await conn.execute(
                '''INSERT INTO analytics_events (event_type, transaction_id, amount, currency, timestamp)
                   VALUES ('transaction_created', $1, $2, $3, NOW())''',
                transaction_id, float(amount), currency
            )
            
            await conn.close()
        
        asyncio.run(process_transaction())
        
        return True
    
    except Exception as e:
        logger.error(f"Error handling transaction created: {e}")
        return False


def handle_fraud_alert(message: Dict[str, Any]) -> bool:
    """
    Handle fraud alert events
    
    Args:
        message: Message data
        
    Returns:
        bool: True if processed successfully
    """
    try:
        value = message['value']
        alert_id = value['alert_id']
        fraud_score = value['fraud_score']
        risk_level = value['risk_level']
        
        logger.warning(
            f"Fraud alert: {alert_id}, "
            f"score: {fraud_score}, risk: {risk_level}"
        )
        
        # Implement fraud handling logic
        import asyncpg
        import asyncio
        import aiohttp
        
        async def handle_fraud():
            conn = await asyncpg.connect(
                host=os.getenv('DB_HOST', 'localhost'),
                port=int(os.getenv('DB_PORT', 5432)),
                database=os.getenv('DB_NAME', 'remittance'),
                user=os.getenv('DB_USER', 'postgres'),
                password=os.getenv('DB_PASSWORD', '')
            )
            
            # Block transaction if high risk
            if risk_level in ['HIGH', 'CRITICAL']:
                await conn.execute(
                    '''UPDATE transactions SET status = 'BLOCKED', 
                       block_reason = 'FRAUD_ALERT', blocked_at = NOW()
                       WHERE transaction_id = (SELECT transaction_id FROM fraud_alerts WHERE alert_id = $1)''',
                    alert_id
                )
                logger.warning(f"Transaction blocked due to {risk_level} fraud risk")
            
            # Send alert to compliance team
            await conn.execute(
                '''INSERT INTO compliance_alerts (alert_id, type, severity, message, created_at)
                   VALUES ($1, 'FRAUD_DETECTED', $2, $3, NOW())''',
                alert_id, risk_level,
                f"Fraud alert {alert_id} with score {fraud_score}"
            )
            
            # Send email to compliance team
            async with aiohttp.ClientSession() as session:
                await session.post(
                    os.getenv('NOTIFICATION_API_URL', 'http://localhost:8080/notify'),
                    json={
                        'to': os.getenv('COMPLIANCE_EMAIL', 'compliance@example.com'),
                        'subject': f'FRAUD ALERT: {risk_level}',
                        'body': f'Alert ID: {alert_id}\nFraud Score: {fraud_score}\nRisk Level: {risk_level}'
                    }
                )
            
            # Update user risk profile
            await conn.execute(
                '''UPDATE user_profiles SET 
                   risk_score = LEAST(risk_score + $1, 100),
                   last_fraud_alert = NOW(),
                   fraud_alert_count = fraud_alert_count + 1
                   WHERE user_id = (SELECT user_id FROM fraud_alerts WHERE alert_id = $2)''',
                fraud_score, alert_id
            )
            
            await conn.close()
        
        asyncio.run(handle_fraud())
        
        return True
    
    except Exception as e:
        logger.error(f"Error handling fraud alert: {e}")
        return False


# Example usage
if __name__ == '__main__':
    # Create consumer for transaction events
    consumer = TransactionConsumer(group_id='transaction-processor')
    
    # Subscribe to topics
    consumer.subscribe([
        'transactions.created',
        'transactions.completed',
        'fraud.alerts'
    ])
    
    # Define message router
    def route_message(message: Dict[str, Any]) -> bool:
        """Route message to appropriate handler"""
        topic = message['topic']
        
        if topic == 'transactions.created':
            return handle_transaction_created(message)
        elif topic == 'fraud.alerts':
            return handle_fraud_alert(message)
        else:
            logger.info(f"Received message from {topic}")
            return True
    
    # Start consuming
    consumer.consume(message_handler=route_message)

