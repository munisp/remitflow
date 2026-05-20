"""
Dapr Service Invocation
Production-ready service-to-service calls using Dapr Service Invocation API
"""

from dapr.clients import DaprClient
from typing import Dict, Any, Optional
import json
import logging

logger = logging.getLogger(__name__)


class DaprServiceInvocation:
    """Manages service-to-service invocation using Dapr"""
    
    def __init__(self, app_id: str):
        """
        Initialize Dapr service invocation
        
        Args:
            app_id: Current application ID
        """
        self.app_id = app_id
        logger.info(f"Initialized DaprServiceInvocation for: {app_id}")
    
    async def invoke_method(
        self, 
        target_app_id: str,
        method_name: str,
        data: Optional[Any] = None,
        http_verb: str = "POST",
        metadata: Optional[Dict[str, str]] = None
    ) -> Optional[Any]:
        """
        Invoke method on another service
        
        Args:
            target_app_id: Target service app ID
            method_name: Method name to invoke
            data: Request data
            http_verb: HTTP verb (GET, POST, PUT, DELETE)
            metadata: Optional metadata
        
        Returns:
            Response data or None
        """
        try:
            # Serialize data
            if data and not isinstance(data, (str, bytes)):
                data = json.dumps(data)
            
            with DaprClient() as client:
                response = client.invoke_method(
                    app_id=target_app_id,
                    method_name=method_name,
                    data=data,
                    http_verb=http_verb,
                    metadata=metadata or {}
                )
            
            # Parse response
            if response.data:
                try:
                    return json.loads(response.data)
                except json.JSONDecodeError:
                    return response.data.decode('utf-8')
            
            logger.info(f"Invoked {target_app_id}.{method_name}")
            return None
            
        except Exception as e:
            logger.error(f"Error invoking {target_app_id}.{method_name}: {e}")
            return None


# Platform service clients
class PaymentServiceClient:
    """Client for payment service"""
    
    def __init__(self):
        self.invoker = DaprServiceInvocation(app_id="api-gateway")
        self.target_app = "payment-service"
    
    async def initiate_transfer(
        self, 
        sender_id: str,
        receiver_id: str,
        amount: float,
        currency: str,
        corridor: str
    ) -> Optional[Dict[str, Any]]:
        """Initiate a transfer"""
        data = {
            'sender_id': sender_id,
            'receiver_id': receiver_id,
            'amount': amount,
            'currency': currency,
            'corridor': corridor
        }
        return await self.invoker.invoke_method(
            target_app_id=self.target_app,
            method_name="transfer",
            data=data,
            http_verb="POST"
        )
    
    async def get_balance(
        self, 
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get user balance"""
        return await self.invoker.invoke_method(
            target_app_id=self.target_app,
            method_name=f"balance/{user_id}",
            http_verb="GET"
        )
    
    async def get_transaction_status(
        self, 
        transaction_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get transaction status"""
        return await self.invoker.invoke_method(
            target_app_id=self.target_app,
            method_name=f"transaction/{transaction_id}/status",
            http_verb="GET"
        )


class FraudDetectionClient:
    """Client for fraud detection service"""
    
    def __init__(self):
        self.invoker = DaprServiceInvocation(app_id="payment-service")
        self.target_app = "fraud-detection"
    
    async def analyze_transaction(
        self, 
        transaction_data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Analyze transaction for fraud"""
        return await self.invoker.invoke_method(
            target_app_id=self.target_app,
            method_name="analyze",
            data=transaction_data,
            http_verb="POST"
        )
    
    async def get_user_risk_score(
        self, 
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get user risk score"""
        return await self.invoker.invoke_method(
            target_app_id=self.target_app,
            method_name=f"risk-score/{user_id}",
            http_verb="GET"
        )


class UserServiceClient:
    """Client for user service"""
    
    def __init__(self):
        self.invoker = DaprServiceInvocation(app_id="api-gateway")
        self.target_app = "user-service"
    
    async def get_user(
        self, 
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get user details"""
        return await self.invoker.invoke_method(
            target_app_id=self.target_app,
            method_name=f"users/{user_id}",
            http_verb="GET"
        )
    
    async def update_user(
        self, 
        user_id: str,
        user_data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Update user details"""
        return await self.invoker.invoke_method(
            target_app_id=self.target_app,
            method_name=f"users/{user_id}",
            data=user_data,
            http_verb="PUT"
        )
    
    async def submit_kyc(
        self, 
        user_id: str,
        kyc_data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Submit KYC data"""
        return await self.invoker.invoke_method(
            target_app_id=self.target_app,
            method_name=f"users/{user_id}/kyc",
            data=kyc_data,
            http_verb="POST"
        )


# Example usage
async def example_usage():
    """Example of using service invocation"""
    
    # Payment service client
    payment_client = PaymentServiceClient()
    
    # Initiate transfer
    transfer_result = await payment_client.initiate_transfer(
        sender_id='user_123',
        receiver_id='user_456',
        amount=50000.0,
        currency='NGN',
        corridor='PAPSS'
    )
    print(f"Transfer result: {transfer_result}")
    
    # Fraud detection client
    fraud_client = FraudDetectionClient()
    
    # Analyze transaction
    fraud_result = await fraud_client.analyze_transaction({
        'transaction_id': 'txn_123',
        'amount': 50000.0,
        'user_id': 'user_123'
    })
    print(f"Fraud analysis: {fraud_result}")
    
    # User service client
    user_client = UserServiceClient()
    
    # Get user
    user = await user_client.get_user('user_123')
    print(f"User: {user}")


if __name__ == '__main__':
    import asyncio
    asyncio.run(example_usage())

