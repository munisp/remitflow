"""
Fluvio Consumer Implementation
Real-time data streaming consumer for Nigerian Remittance Platform
"""

import asyncio
import json
import logging
from typing import Dict, Any, Optional, Callable, List
from datetime import datetime
from dataclasses import dataclass
import os

# Fluvio client
try:
    from fluvio import Fluvio, Offset
except ImportError:
    logging.warning("Fluvio not installed. Install with: pip install fluvio")
    Fluvio = None
    Offset = None

logger = logging.getLogger(__name__)


@dataclass
class ConsumedMessage:
    """Consumed message structure"""
    topic: str
    partition: int
    offset: int
    key: Optional[str]
    value: Dict[str, Any]
    timestamp: str
    headers: Optional[Dict[str, str]] = None


class FluvioConsumer:
    """
    Fluvio Consumer for real-time data streaming
    
    Features:
    - Async message consumption
    - Multiple topic subscription
    - Message handlers
    - Offset management
    - Error handling
    - Metrics collection
    """
    
    def __init__(
        self,
        cluster_url: str = None,
        group_id: str = "default-group",
        auto_commit: bool = True,
        max_retries: int = 3
    ):
        """
        Initialize Fluvio Consumer
        
        Args:
            cluster_url: Fluvio cluster URL
            group_id: Consumer group ID
            auto_commit: Whether to auto-commit offsets
            max_retries: Maximum retry attempts
        """
        self.cluster_url = cluster_url or os.getenv("FLUVIO_CLUSTER_URL", "localhost:9003")
        self.group_id = group_id
        self.auto_commit = auto_commit
        self.max_retries = max_retries
        
        self.client: Optional[Fluvio] = None
        self.consumers: Dict[str, Any] = {}
        self.handlers: Dict[str, Callable] = {}
        self.consume_tasks: List[asyncio.Task] = []
        
        self.metrics = {
            "messages_consumed": 0,
            "messages_processed": 0,
            "messages_failed": 0,
            "bytes_consumed": 0
        }
        
        self._is_running = False
    
    async def connect(self) -> bool:
        """Connect to Fluvio cluster"""
        try:
            if Fluvio is None:
                logger.error("Fluvio library not installed")
                return False
            
            # Create Fluvio client
            self.client = await Fluvio.connect()
            
            logger.info(f"Connected to Fluvio cluster at {self.cluster_url}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to Fluvio: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from Fluvio cluster"""
        try:
            # Stop consuming
            await self.stop()
            
            # Close consumers
            self.consumers.clear()
            
            logger.info("Disconnected from Fluvio cluster")
            
        except Exception as e:
            logger.error(f"Error disconnecting from Fluvio: {e}")
    
    def register_handler(self, topic: str, handler: Callable):
        """
        Register message handler for topic
        
        Args:
            topic: Topic name
            handler: Async function to handle messages
        """
        self.handlers[topic] = handler
        logger.info(f"Registered handler for topic: {topic}")
    
    async def subscribe(
        self,
        topic: str,
        partition: int = 0,
        offset: str = "beginning"
    ):
        """
        Subscribe to topic
        
        Args:
            topic: Topic name
            partition: Partition number
            offset: Starting offset ("beginning", "end", or specific offset)
        """
        try:
            if not self.client:
                raise RuntimeError("Not connected to Fluvio cluster")
            
            # Determine offset
            if offset == "beginning":
                start_offset = Offset.beginning()
            elif offset == "end":
                start_offset = Offset.end()
            else:
                start_offset = Offset.absolute(int(offset))
            
            # Create consumer
            consumer = await self.client.partition_consumer(topic, partition)
            self.consumers[f"{topic}:{partition}"] = consumer
            
            logger.info(f"Subscribed to topic: {topic}, partition: {partition}")
            
        except Exception as e:
            logger.error(f"Failed to subscribe to {topic}: {e}")
            raise
    
    async def start(self):
        """Start consuming messages"""
        if self._is_running:
            logger.warning("Consumer already running")
            return
        
        self._is_running = True
        
        # Start consume task for each consumer
        for topic_partition, consumer in self.consumers.items():
            topic = topic_partition.split(":")[0]
            task = asyncio.create_task(
                self._consume_loop(topic, consumer)
            )
            self.consume_tasks.append(task)
        
        logger.info(f"Started consuming from {len(self.consumers)} topic partitions")
    
    async def stop(self):
        """Stop consuming messages"""
        if not self._is_running:
            return
        
        self._is_running = False
        
        # Cancel all consume tasks
        for task in self.consume_tasks:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        
        self.consume_tasks.clear()
        
        logger.info("Stopped consuming messages")
    
    async def _consume_loop(self, topic: str, consumer):
        """Consume messages from topic"""
        try:
            stream = await consumer.stream(Offset.beginning())
            
            async for record in stream:
                if not self._is_running:
                    break
                
                try:
                    # Parse message
                    payload = record.value().decode('utf-8')
                    data = json.loads(payload)
                    
                    message = ConsumedMessage(
                        topic=topic,
                        partition=record.partition(),
                        offset=record.offset(),
                        key=data.get("key"),
                        value=data.get("value", {}),
                        timestamp=data.get("timestamp"),
                        headers=data.get("headers")
                    )
                    
                    # Update metrics
                    self.metrics["messages_consumed"] += 1
                    self.metrics["bytes_consumed"] += len(payload)
                    
                    # Process message
                    await self._process_message(message)
                    
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse message: {e}")
                    self.metrics["messages_failed"] += 1
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    self.metrics["messages_failed"] += 1
        
        except asyncio.CancelledError:
            logger.info(f"Consume loop cancelled for topic: {topic}")
        except Exception as e:
            logger.error(f"Error in consume loop for {topic}: {e}")
    
    async def _process_message(self, message: ConsumedMessage):
        """Process consumed message"""
        try:
            # Get handler for topic
            handler = self.handlers.get(message.topic)
            
            if handler:
                # Call handler
                await handler(message)
                self.metrics["messages_processed"] += 1
            else:
                logger.warning(f"No handler registered for topic: {message.topic}")
            
        except Exception as e:
            logger.error(f"Error in message handler: {e}")
            self.metrics["messages_failed"] += 1
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get consumer metrics"""
        return {
            **self.metrics,
            "topics": list(set(k.split(":")[0] for k in self.consumers.keys())),
            "is_running": self._is_running
        }
    
    async def __aenter__(self):
        """Async context manager entry"""
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        await self.disconnect()


# Singleton instance
_consumer_instance: Optional[FluvioConsumer] = None


def get_consumer(group_id: str = "default-group") -> FluvioConsumer:
    """Get global Fluvio consumer instance"""
    global _consumer_instance
    if _consumer_instance is None:
        _consumer_instance = FluvioConsumer(group_id=group_id)
    return _consumer_instance
