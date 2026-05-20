"""
Dapr State Management Service
Production-ready state management using Dapr State API
"""

from dapr.clients import DaprClient
from dapr.clients.grpc._state import StateItem, StateOptions, Consistency, Concurrency
from typing import Dict, List, Optional, Any
import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class DaprStateManager:
    """Manages application state using Dapr State API"""
    
    def __init__(self, store_name: str = "statestore", dapr_http_port: int = 3500):
        """
        Initialize Dapr state manager
        
        Args:
            store_name: Name of the Dapr state store component
            dapr_http_port: Dapr HTTP port (default: 3500)
        """
        self.store_name = store_name
        self.dapr_http_port = dapr_http_port
        self.client = None
        logger.info(f"Initialized DaprStateManager with store: {store_name}")
    
    def __enter__(self):
        """Context manager entry"""
        self.client = DaprClient()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        if self.client:
            self.client.close()
    
    async def save_state(
        self, 
        key: str, 
        value: Any, 
        metadata: Optional[Dict[str, str]] = None,
        etag: Optional[str] = None,
        consistency: str = "strong"
    ) -> bool:
        """
        Save state with Dapr
        
        Args:
            key: State key
            value: State value (will be JSON serialized)
            metadata: Optional metadata
            etag: Optional ETag for concurrency control
            consistency: Consistency level ("strong" or "eventual")
        
        Returns:
            True if successful
        """
        try:
            # Serialize value
            if not isinstance(value, (str, bytes)):
                value = json.dumps(value)
            
            # Set consistency
            consistency_level = Consistency.strong if consistency == "strong" else Consistency.eventual
            
            # Create state options
            options = StateOptions(
                consistency=consistency_level,
                concurrency=Concurrency.first_write
            )
            
            # Save state
            with DaprClient() as client:
                client.save_state(
                    store_name=self.store_name,
                    key=key,
                    value=value,
                    state_metadata=metadata or {},
                    options=options,
                    etag=etag
                )
            
            logger.info(f"Saved state: {key}")
            return True
            
        except Exception as e:
            logger.error(f"Error saving state {key}: {e}")
            return False
    
    async def get_state(
        self, 
        key: str, 
        consistency: str = "strong"
    ) -> Optional[Any]:
        """
        Get state from Dapr
        
        Args:
            key: State key
            consistency: Consistency level
        
        Returns:
            State value or None
        """
        try:
            consistency_level = Consistency.strong if consistency == "strong" else Consistency.eventual
            
            with DaprClient() as client:
                state = client.get_state(
                    store_name=self.store_name,
                    key=key,
                    state_metadata={"consistency": consistency}
                )
            
            if state.data:
                # Try to deserialize JSON
                try:
                    return json.loads(state.data)
                except json.JSONDecodeError:
                    return state.data.decode('utf-8')
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting state {key}: {e}")
            return None
    
    async def delete_state(
        self, 
        key: str, 
        etag: Optional[str] = None
    ) -> bool:
        """
        Delete state from Dapr
        
        Args:
            key: State key
            etag: Optional ETag for concurrency control
        
        Returns:
            True if successful
        """
        try:
            with DaprClient() as client:
                client.delete_state(
                    store_name=self.store_name,
                    key=key,
                    etag=etag
                )
            
            logger.info(f"Deleted state: {key}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting state {key}: {e}")
            return False
    
    async def save_bulk_state(
        self, 
        states: List[Dict[str, Any]]
    ) -> bool:
        """
        Save multiple states in bulk
        
        Args:
            states: List of state dictionaries with 'key' and 'value'
        
        Returns:
            True if successful
        """
        try:
            state_items = []
            for state in states:
                value = state['value']
                if not isinstance(value, (str, bytes)):
                    value = json.dumps(value)
                
                state_items.append(
                    StateItem(
                        key=state['key'],
                        value=value,
                        etag=state.get('etag'),
                        metadata=state.get('metadata', {})
                    )
                )
            
            with DaprClient() as client:
                client.save_bulk_state(
                    store_name=self.store_name,
                    states=state_items
                )
            
            logger.info(f"Saved {len(states)} states in bulk")
            return True
            
        except Exception as e:
            logger.error(f"Error saving bulk state: {e}")
            return False
    
    async def get_bulk_state(
        self, 
        keys: List[str]
    ) -> Dict[str, Any]:
        """
        Get multiple states in bulk
        
        Args:
            keys: List of state keys
        
        Returns:
            Dictionary of key-value pairs
        """
        try:
            with DaprClient() as client:
                items = client.get_bulk_state(
                    store_name=self.store_name,
                    keys=keys
                )
            
            result = {}
            for item in items.items:
                if item.data:
                    try:
                        result[item.key] = json.loads(item.data)
                    except json.JSONDecodeError:
                        result[item.key] = item.data.decode('utf-8')
            
            logger.info(f"Retrieved {len(result)} states in bulk")
            return result
            
        except Exception as e:
            logger.error(f"Error getting bulk state: {e}")
            return {}
    
    async def query_state(
        self, 
        query: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Query state store with filters
        
        Args:
            query: Query specification
        
        Returns:
            List of matching states
        """
        try:
            with DaprClient() as client:
                results = client.query_state(
                    store_name=self.store_name,
                    query=json.dumps(query)
                )
            
            items = []
            for result in results.results:
                items.append({
                    'key': result.key,
                    'value': json.loads(result.data) if result.data else None,
                    'etag': result.etag
                })
            
            logger.info(f"Query returned {len(items)} results")
            return items
            
        except Exception as e:
            logger.error(f"Error querying state: {e}")
            return []


# Example usage
async def example_usage():
    """Example of using DaprStateManager"""
    
    state_manager = DaprStateManager()
    
    # Save transaction state
    transaction = {
        'transaction_id': 'txn_123',
        'amount': 50000.0,
        'currency': 'NGN',
        'status': 'PENDING',
        'created_at': datetime.now().isoformat()
    }
    
    await state_manager.save_state(
        key='transaction:txn_123',
        value=transaction,
        metadata={'user_id': 'user_456'}
    )
    
    # Get transaction state
    retrieved = await state_manager.get_state('transaction:txn_123')
    print(f"Retrieved: {retrieved}")
    
    # Save multiple states
    states = [
        {'key': 'user:user_1', 'value': {'name': 'John', 'balance': 10000}},
        {'key': 'user:user_2', 'value': {'name': 'Jane', 'balance': 20000}}
    ]
    await state_manager.save_bulk_state(states)
    
    # Query states
    query = {
        "filter": {
            "EQ": {"user_id": "user_456"}
        }
    }
    results = await state_manager.query_state(query)
    print(f"Query results: {results}")


if __name__ == '__main__':
    import asyncio
    asyncio.run(example_usage())

