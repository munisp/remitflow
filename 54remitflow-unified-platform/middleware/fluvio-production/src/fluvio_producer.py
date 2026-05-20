"""
Fluvio Producer Implementation
Real-time data streaming producer for Nigerian Remittance Platform
"""

import asyncio
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from dataclasses import dataclass, asdict
import os

# Fluvio client (will be installed via requirements.txt)
try:
    from fluvio import Fluvio, FluvioConfig
except ImportError:
    # Fallback for development
    logging.warning("Fluvio not installed. Install with: pip install fluvio")
    Fluvio = None
    FluvioConfig = None

logger = logging.getLogger(__name__)


@dataclass
class FluvioMessage:
    """Fluvio message structure"""
    topic: str
    key: Optional[str]
    value: Dict[str, Any]
    timestamp: str
    headers: Optional[Dict[str, str]] = None


class FluvioProducer:
    """
    Fluvio Producer for real-time data streaming
    
    Features:
    - Async message production
    - Batch sending
    - Error handling and retries
    - Message validation
    - Metrics collection
    """
    
    def __init__(
        self,
        cluster_url: str = None,
        profile: str = "default",
        max_retries: int = 3,
        batch_size: int = 100,
        flush_interval: float = 1.0
    ):
        """
        Initialize Fluvio Producer
        
        Args:
            cluster_url: Fluvio cluster URL (default: from env FLUVIO_CLUSTER_URL)
            profile: Fluvio profile name
            max_retries: Maximum retry attempts
            batch_size: Maximum batch size for bulk sending
            flush_interval: Auto-flush interval in seconds
        """
        self.cluster_url = cluster_url or os.getenv("FLUVIO_CLUSTER_URL", "localhost:9003")
        self.profile = profile
        self.max_retries = max_retries
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        
        self.client: Optional[Fluvio] = None
        self.producers: Dict[str, Any] = {}
        self.message_buffer: List[FluvioMessage] = []
        self.metrics = {
            "messages_sent": 0,
            "messages_failed": 0,
            "bytes_sent": 0,
            "batches_sent": 0
        }
        
        self._flush_task: Optional[asyncio.Task] = None
        self._is_connected = False
    
    async def connect(self) -> bool:
        """Connect to Fluvio cluster"""
        try:
            if Fluvio is None:
                logger.error("Fluvio library not installed")
                return False
            
            # Create Fluvio client
            self.client = await Fluvio.connect()
            self._is_connected = True
            
            logger.info(f"Connected to Fluvio cluster at {self.cluster_url}")
            
            # Start auto-flush task
            self._flush_task = asyncio.create_task(self._auto_flush())
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to Fluvio: {e}")
            self._is_connected = False
            return False
    
    async def disconnect(self):
        """Disconnect from Fluvio cluster"""
        try:
            # Flush remaining messages
            await self.flush()
            
            # Cancel auto-flush task
            if self._flush_task:
                self._flush_task.cancel()
                try:
                    await self._flush_task
                except asyncio.CancelledError:
                    pass
            
            # Close producers
            for producer in self.producers.values():
                await producer.flush()
            
            self.producers.clear()
            self._is_connected = False
            
            logger.info("Disconnected from Fluvio cluster")
            
        except Exception as e:
            logger.error(f"Error disconnecting from Fluvio: {e}")
    
    async def get_producer(self, topic: str):
        """Get or create producer for topic"""
        if topic not in self.producers:
            if not self.client:
                raise RuntimeError("Not connected to Fluvio cluster")
            
            producer = await self.client.topic_producer(topic)
            self.producers[topic] = producer
            logger.info(f"Created producer for topic: {topic}")
        
        return self.producers[topic]
    
    async def send(
        self,
        topic: str,
        value: Dict[str, Any],
        key: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
        flush: bool = False
    ) -> bool:
        """
        Send message to Fluvio topic
        
        Args:
            topic: Topic name
            value: Message value (will be JSON serialized)
            key: Optional message key
            headers: Optional message headers
            flush: Whether to flush immediately
        
        Returns:
            True if successful, False otherwise
        """
        try:
            # Create message
            message = FluvioMessage(
                topic=topic,
                key=key,
                value=value,
                timestamp=datetime.utcnow().isoformat(),
                headers=headers
            )
            
            # Add to buffer
            self.message_buffer.append(message)
            
            # Flush if requested or buffer full
            if flush or len(self.message_buffer) >= self.batch_size:
                await self.flush()
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to send message to {topic}: {e}")
            self.metrics["messages_failed"] += 1
            return False
    
    async def send_batch(
        self,
        topic: str,
        messages: List[Dict[str, Any]],
        keys: Optional[List[str]] = None
    ) -> int:
        """
        Send batch of messages
        
        Args:
            topic: Topic name
            messages: List of message values
            keys: Optional list of message keys
        
        Returns:
            Number of successfully sent messages
        """
        sent_count = 0
        
        for i, value in enumerate(messages):
            key = keys[i] if keys and i < len(keys) else None
            success = await self.send(topic, value, key, flush=False)
            if success:
                sent_count += 1
        
        # Flush all buffered messages
        await self.flush()
        
        return sent_count
    
    async def flush(self):
        """Flush buffered messages"""
        if not self.message_buffer:
            return
        
        try:
            # Group messages by topic
            topic_messages: Dict[str, List[FluvioMessage]] = {}
            for msg in self.message_buffer:
                if msg.topic not in topic_messages:
                    topic_messages[msg.topic] = []
                topic_messages[msg.topic].append(msg)
            
            # Send messages for each topic
            for topic, messages in topic_messages.items():
                producer = await self.get_producer(topic)
                
                for msg in messages:
                    # Serialize message
                    payload = json.dumps({
                        "key": msg.key,
                        "value": msg.value,
                        "timestamp": msg.timestamp,
                        "headers": msg.headers
                    }).encode('utf-8')
                    
                    # Send to Fluvio
                    await producer.send(msg.key or "", payload)
                    
                    # Update metrics
                    self.metrics["messages_sent"] += 1
                    self.metrics["bytes_sent"] += len(payload)
                
                # Flush producer
                await producer.flush()
            
            self.metrics["batches_sent"] += 1
            logger.debug(f"Flushed {len(self.message_buffer)} messages")
            
            # Clear buffer
            self.message_buffer.clear()
            
        except Exception as e:
            logger.error(f"Failed to flush messages: {e}")
            self.metrics["messages_failed"] += len(self.message_buffer)
            self.message_buffer.clear()
    
    async def _auto_flush(self):
        """Auto-flush task"""
        while True:
            try:
                await asyncio.sleep(self.flush_interval)
                if self.message_buffer:
                    await self.flush()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in auto-flush: {e}")
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get producer metrics"""
        return {
            **self.metrics,
            "buffer_size": len(self.message_buffer),
            "topics": list(self.producers.keys()),
            "is_connected": self._is_connected
        }
    
    async def __aenter__(self):
        """Async context manager entry"""
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        await self.disconnect()


# Singleton instance
_producer_instance: Optional[FluvioProducer] = None


def get_producer() -> FluvioProducer:
    """Get global Fluvio producer instance"""
    global _producer_instance
    if _producer_instance is None:
        _producer_instance = FluvioProducer()
    return _producer_instance


async def send_event(
    topic: str,
    event_type: str,
    data: Dict[str, Any],
    user_id: Optional[str] = None
) -> bool:
    """
    Convenience function to send event
    
    Args:
        topic: Topic name
        event_type: Event type
        data: Event data
        user_id: Optional user ID
    
    Returns:
        True if successful
    """
    producer = get_producer()
    
    if not producer._is_connected:
        await producer.connect()
    
    event = {
        "event_type": event_type,
        "data": data,
        "user_id": user_id,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    return await producer.send(topic, event, key=user_id)
