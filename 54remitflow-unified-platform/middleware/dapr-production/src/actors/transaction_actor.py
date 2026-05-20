"""
Dapr Actors Implementation
Stateful actors for transaction processing
"""

from dapr.actor import Actor, Remindable
from dapr.actor.runtime.context import ActorRuntimeContext
from dapr.actor.runtime.config import ActorRuntimeConfig, ActorReentrancyConfig
from datetime import timedelta
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class TransactionActor(Actor, Remindable):
    """
    Actor for managing individual transaction lifecycle
    Each transaction gets its own actor instance
    """
    
    def __init__(self, ctx: ActorRuntimeContext, actor_id: str):
        """
        Initialize transaction actor
        
        Args:
            ctx: Actor runtime context
            actor_id: Unique actor ID (transaction_id)
        """
        super().__init__(ctx, actor_id)
        self.transaction_id = actor_id
        logger.info(f"Initialized TransactionActor: {actor_id}")
    
    async def _on_activate(self) -> None:
        """Called when actor is activated"""
        logger.info(f"Activating TransactionActor: {self.transaction_id}")
        
        # Initialize state
        has_state = await self._state_manager.try_get_state('transaction')
        if not has_state.has_value:
            await self._state_manager.set_state('transaction', {
                'transaction_id': self.transaction_id,
                'status': 'INITIALIZED',
                'attempts': 0
            })
            await self._state_manager.save_state()
    
    async def _on_deactivate(self) -> None:
        """Called when actor is deactivated"""
        logger.info(f"Deactivating TransactionActor: {self.transaction_id}")
    
    async def initiate_transaction(
        self, 
        transaction_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Initiate transaction processing
        
        Args:
            transaction_data: Transaction details
        
        Returns:
            Transaction status
        """
        try:
            # Get current state
            state = await self._state_manager.get_state('transaction')
            
            # Update state
            state.update({
                'status': 'PENDING',
                'data': transaction_data,
                'attempts': state.get('attempts', 0) + 1
            })
            
            await self._state_manager.set_state('transaction', state)
            await self._state_manager.save_state()
            
            # Register reminder for timeout
            await self.register_reminder(
                'transaction_timeout',
                state=b'',
                due_time=timedelta(minutes=5),
                period=timedelta(0)  # One-time reminder
            )
            
            logger.info(f"Transaction initiated: {self.transaction_id}")
            return {'status': 'success', 'transaction_id': self.transaction_id}
            
        except Exception as e:
            logger.error(f"Error initiating transaction: {e}")
            return {'status': 'error', 'message': str(e)}
    
    async def process_payment(self) -> Dict[str, Any]:
        """Process the payment"""
        try:
            state = await self._state_manager.get_state('transaction')
            
            # Simulate payment processing
            # In production, this would call TigerBeetle, fraud detection, etc.
            
            state['status'] = 'PROCESSING'
            await self._state_manager.set_state('transaction', state)
            await self._state_manager.save_state()
            
            logger.info(f"Processing payment: {self.transaction_id}")
            return {'status': 'processing'}
            
        except Exception as e:
            logger.error(f"Error processing payment: {e}")
            return {'status': 'error', 'message': str(e)}
    
    async def complete_transaction(
        self, 
        result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Complete transaction
        
        Args:
            result: Transaction result
        
        Returns:
            Completion status
        """
        try:
            state = await self._state_manager.get_state('transaction')
            
            state.update({
                'status': 'COMPLETED',
                'result': result
            })
            
            await self._state_manager.set_state('transaction', state)
            await self._state_manager.save_state()
            
            # Unregister timeout reminder
            await self.unregister_reminder('transaction_timeout')
            
            logger.info(f"Transaction completed: {self.transaction_id}")
            return {'status': 'success'}
            
        except Exception as e:
            logger.error(f"Error completing transaction: {e}")
            return {'status': 'error', 'message': str(e)}
    
    async def fail_transaction(
        self, 
        reason: str
    ) -> Dict[str, Any]:
        """
        Fail transaction
        
        Args:
            reason: Failure reason
        
        Returns:
            Failure status
        """
        try:
            state = await self._state_manager.get_state('transaction')
            
            state.update({
                'status': 'FAILED',
                'reason': reason
            })
            
            await self._state_manager.set_state('transaction', state)
            await self._state_manager.save_state()
            
            logger.info(f"Transaction failed: {self.transaction_id} - {reason}")
            return {'status': 'failed', 'reason': reason}
            
        except Exception as e:
            logger.error(f"Error failing transaction: {e}")
            return {'status': 'error', 'message': str(e)}
    
    async def get_status(self) -> Dict[str, Any]:
        """Get transaction status"""
        try:
            state = await self._state_manager.get_state('transaction')
            return {
                'transaction_id': self.transaction_id,
                'status': state.get('status'),
                'attempts': state.get('attempts', 0)
            }
        except Exception as e:
            logger.error(f"Error getting status: {e}")
            return {'status': 'error', 'message': str(e)}
    
    async def receive_reminder(
        self, 
        name: str, 
        state: bytes, 
        due_time: timedelta, 
        period: timedelta
    ) -> None:
        """
        Handle reminder
        
        Args:
            name: Reminder name
            state: Reminder state
            due_time: Due time
            period: Period
        """
        if name == 'transaction_timeout':
            logger.warning(f"Transaction timeout: {self.transaction_id}")
            await self.fail_transaction('Transaction timeout')


class UserActor(Actor):
    """Actor for managing user state and operations"""
    
    def __init__(self, ctx: ActorRuntimeContext, actor_id: str):
        super().__init__(ctx, actor_id)
        self.user_id = actor_id
    
    async def _on_activate(self) -> None:
        """Initialize user state"""
        has_state = await self._state_manager.try_get_state('user')
        if not has_state.has_value:
            await self._state_manager.set_state('user', {
                'user_id': self.user_id,
                'balance': 0.0,
                'transaction_count': 0
            })
            await self._state_manager.save_state()
    
    async def update_balance(
        self, 
        amount: float, 
        operation: str
    ) -> Dict[str, Any]:
        """
        Update user balance
        
        Args:
            amount: Amount to add/subtract
            operation: 'credit' or 'debit'
        
        Returns:
            Updated balance
        """
        try:
            state = await self._state_manager.get_state('user')
            
            if operation == 'credit':
                state['balance'] += amount
            elif operation == 'debit':
                if state['balance'] < amount:
                    return {'status': 'error', 'message': 'Insufficient balance'}
                state['balance'] -= amount
            
            state['transaction_count'] += 1
            
            await self._state_manager.set_state('user', state)
            await self._state_manager.save_state()
            
            return {
                'status': 'success',
                'balance': state['balance']
            }
            
        except Exception as e:
            logger.error(f"Error updating balance: {e}")
            return {'status': 'error', 'message': str(e)}
    
    async def get_balance(self) -> Dict[str, Any]:
        """Get user balance"""
        try:
            state = await self._state_manager.get_state('user')
            return {
                'user_id': self.user_id,
                'balance': state.get('balance', 0.0),
                'transaction_count': state.get('transaction_count', 0)
            }
        except Exception as e:
            logger.error(f"Error getting balance: {e}")
            return {'status': 'error', 'message': str(e)}


# Actor runtime configuration
def configure_actor_runtime():
    """Configure Dapr actor runtime"""
    
    config = ActorRuntimeConfig()
    config.update_actor_type_configs([
        {
            'actor_type': 'TransactionActor',
            'actor_idle_timeout': timedelta(hours=1),
            'actor_scan_interval': timedelta(seconds=30),
            'drain_ongoing_call_timeout': timedelta(seconds=60),
            'drain_rebalanced_actors': True,
            'reentrancy': ActorReentrancyConfig(enabled=True)
        },
        {
            'actor_type': 'UserActor',
            'actor_idle_timeout': timedelta(hours=24),
            'actor_scan_interval': timedelta(minutes=1)
        }
    ])
    
    return config


if __name__ == '__main__':
    # This would be run by Dapr runtime
    print("Dapr Actors configured")

