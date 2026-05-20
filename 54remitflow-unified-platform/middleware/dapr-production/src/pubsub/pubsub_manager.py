"""
Dapr Pub/Sub Service
Production-ready pub/sub messaging using Dapr Pub/Sub API
"""

from dapr.clients import DaprClient
from dapr.ext.grpc import App
from cloudevents.sdk.event import v1
from typing import Dict, Any, Callable, Optional
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class DaprPubSubManager:
    """Manages pub/sub messaging using Dapr Pub/Sub API"""
    
    def __init__(self, pubsub_name: str = "pubsub", app_id: str = "remittance-app"):
        """
        Initialize Dapr pub/sub manager
        
        Args:
            pubsub_name: Name of the Dapr pub/sub component
            app_id: Application ID
        """
        self.pubsub_name = pubsub_name
        self.app_id = app_id
        self.app = App()
        logger.info(f"Initialized DaprPubSubManager: {pubsub_name}")
    
    async def publish_event(
        self, 
        topic: str, 
        data: Any,
        metadata: Optional[Dict[str, str]] = None
    ) -> bool:
        """
        Publish event to topic
        
        Args:
            topic: Topic name
            data: Event data (will be JSON serialized)
            metadata: Optional metadata
        
        Returns:
            True if successful
        """
        try:
            # Serialize data
            if not isinstance(data, (str, bytes)):
                data = json.dumps(data)
            
            with DaprClient() as client:
                client.publish_event(
                    pubsub_name=self.pubsub_name,
                    topic_name=topic,
                    data=data,
                    data_content_type='application/json',
                    metadata=metadata or {}
                )
            
            logger.info(f"Published event to topic: {topic}")
            return True
            
        except Exception as e:
            logger.error(f"Error publishing to {topic}: {e}")
            return False
    
    def subscribe(
        self, 
        topic: str, 
        route: Optional[str] = None
    ):
        """
        Decorator to subscribe to topic
        
        Args:
            topic: Topic name
            route: Optional custom route (default: /topic_name)
        
        Returns:
            Decorator function
        """
        if route is None:
            route = f"/{topic}"
        
        def decorator(func: Callable):
            @self.app.subscribe(
                pubsub_name=self.pubsub_name,
                topic=topic,
                route=route
            )
            async def wrapper(event: v1.Event):
                try:
                    # Parse event data
                    data = json.loads(event.Data())
                    logger.info(f"Received event on topic {topic}: {data}")
                    
                    # Call handler
                    result = await func(data)
                    return result
                    
                except Exception as e:
                    logger.error(f"Error handling event on {topic}: {e}")
                    raise
            
            return wrapper
        
        return decorator
    
    def run(self, port: int = 5000):
        """
        Run the Dapr app
        
        Args:
            port: Port to run on
        """
        logger.info(f"Starting Dapr app on port {port}")
        self.app.run(port)


# Integration with platform services
class RemittancePubSubService:
    """Pub/Sub service for remittance platform"""
    
    def __init__(self):
        self.manager = DaprPubSubManager(
            pubsub_name="pubsub",
            app_id="remittance-platform"
        )
    
    async def publish_transaction_created(
        self, 
        transaction_id: str,
        transaction_data: Dict[str, Any]
    ) -> bool:
        """Publish transaction created event"""
        event = {
            'event_type': 'TRANSACTION_CREATED',
            'transaction_id': transaction_id,
            'data': transaction_data,
            'timestamp': datetime.now().isoformat()
        }
        return await self.manager.publish_event(
            topic='transactions.created',
            data=event
        )
    
    async def publish_transaction_completed(
        self, 
        transaction_id: str,
        result: Dict[str, Any]
    ) -> bool:
        """Publish transaction completed event"""
        event = {
            'event_type': 'TRANSACTION_COMPLETED',
            'transaction_id': transaction_id,
            'result': result,
            'timestamp': datetime.now().isoformat()
        }
        return await self.manager.publish_event(
            topic='transactions.completed',
            data=event
        )
    
    async def publish_fraud_alert(
        self, 
        transaction_id: str,
        fraud_score: float,
        indicators: list
    ) -> bool:
        """Publish fraud alert event"""
        event = {
            'event_type': 'FRAUD_ALERT',
            'transaction_id': transaction_id,
            'fraud_score': fraud_score,
            'indicators': indicators,
            'timestamp': datetime.now().isoformat()
        }
        return await self.manager.publish_event(
            topic='fraud.alerts',
            data=event
        )
    
    async def publish_user_created(
        self, 
        user_id: str,
        user_data: Dict[str, Any]
    ) -> bool:
        """Publish user created event"""
        event = {
            'event_type': 'USER_CREATED',
            'user_id': user_id,
            'data': user_data,
            'timestamp': datetime.now().isoformat()
        }
        return await self.manager.publish_event(
            topic='users.created',
            data=event
        )


# Example subscriber service
class TransactionEventSubscriber:
    """Example subscriber for transaction events"""
    
    def __init__(self):
        self.manager = DaprPubSubManager()
    
    @DaprPubSubManager(pubsub_name="pubsub", app_id="transaction-subscriber").subscribe(topic='transactions.created')
    async def handle_transaction_created(self, data: Dict[str, Any]):
        """Handle transaction created event"""
        logger.info(f"Processing transaction created: {data['transaction_id']}")
        
        # Process transaction
        # - Update analytics
        # - Send notifications
        # - Trigger fraud detection
        
        return {'status': 'success'}
    
    @DaprPubSubManager(pubsub_name="pubsub", app_id="transaction-subscriber").subscribe(topic='fraud.alerts')
    async def handle_fraud_alert(self, data: Dict[str, Any]):
        """Handle fraud alert event"""
        logger.info(f"Processing fraud alert: {data['transaction_id']}")
        
        # Handle fraud alert
        # - Block transaction
        # - Notify compliance team
        # - Update user risk score
        
        return {'status': 'success'}
    
    def run(self, port: int = 5001):
        """Run subscriber service"""
        self.manager.run(port)


# Example usage
async def example_usage():
    """Example of using DaprPubSubManager"""
    
    pubsub_service = RemittancePubSubService()
    
    # Publish transaction created
    await pubsub_service.publish_transaction_created(
        transaction_id='txn_123',
        transaction_data={
            'amount': 50000.0,
            'currency': 'NGN',
            'sender_id': 'user_123',
            'receiver_id': 'user_456'
        }
    )
    
    # Publish fraud alert
    await pubsub_service.publish_fraud_alert(
        transaction_id='txn_123',
        fraud_score=0.85,
        indicators=['unusual_amount', 'new_device']
    )
    
    print("Events published successfully")


if __name__ == '__main__':
    import asyncio
    asyncio.run(example_usage())

