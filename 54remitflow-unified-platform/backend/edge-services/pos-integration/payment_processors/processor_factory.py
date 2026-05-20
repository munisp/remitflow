"""
Payment Processor Factory
Manages multiple payment processors and routing logic
"""

import os
import logging
from typing import Dict, Any, Optional
from enum import Enum

from .stripe_processor import StripeProcessor, StripeConfig
from .square_processor import SquareProcessor, SquareConfig

logger = logging.getLogger(__name__)

class ProcessorType(str, Enum):
    STRIPE = "stripe"
    SQUARE = "square"
    MOCK = "mock"

class PaymentProcessorFactory:
    """Factory for creating and managing payment processors"""
    
    def __init__(self):
        self._processors: Dict[ProcessorType, Any] = {}
        self._default_processor: Optional[ProcessorType] = None
        self._processor_priorities = [ProcessorType.STRIPE, ProcessorType.SQUARE, ProcessorType.MOCK]
    
    def initialize_processors(self, config: Dict[str, Any]):
        """Initialize all configured payment processors"""
        
        # Initialize Stripe if configured
        if self._is_stripe_configured():
            try:
                stripe_config = StripeConfig(
                    secret_key=os.getenv("STRIPE_SECRET_KEY"),
                    webhook_secret=os.getenv("STRIPE_WEBHOOK_SECRET", ""),
                    api_version=config.get("stripe", {}).get("api_version", "2023-10-16")
                )
                self._processors[ProcessorType.STRIPE] = StripeProcessor(stripe_config)
                logger.info("Stripe processor initialized")
                
                if not self._default_processor:
                    self._default_processor = ProcessorType.STRIPE
                    
            except Exception as e:
                logger.error(f"Failed to initialize Stripe processor: {e}")
        
        # Initialize Square if configured
        if self._is_square_configured():
            try:
                square_config = SquareConfig(
                    access_token=os.getenv("SQUARE_ACCESS_TOKEN"),
                    application_id=os.getenv("SQUARE_APPLICATION_ID"),
                    environment=os.getenv("SQUARE_ENVIRONMENT", "sandbox"),
                    webhook_signature_key=os.getenv("SQUARE_WEBHOOK_SIGNATURE_KEY", ""),
                    location_id=os.getenv("SQUARE_LOCATION_ID", "")
                )
                self._processors[ProcessorType.SQUARE] = SquareProcessor(square_config)
                logger.info("Square processor initialized")
                
                if not self._default_processor:
                    self._default_processor = ProcessorType.SQUARE
                    
            except Exception as e:
                logger.error(f"Failed to initialize Square processor: {e}")
        
        # Initialize mock processor as fallback
        if not self._processors:
            self._processors[ProcessorType.MOCK] = MockProcessor()
            self._default_processor = ProcessorType.MOCK
            logger.warning("No real payment processors configured, using mock processor")
    
    def get_processor(self, processor_type: Optional[ProcessorType] = None) -> Any:
        """Get payment processor by type or default"""
        if processor_type and processor_type in self._processors:
            return self._processors[processor_type]
        
        if self._default_processor and self._default_processor in self._processors:
            return self._processors[self._default_processor]
        
        # Fallback to first available processor
        for proc_type in self._processor_priorities:
            if proc_type in self._processors:
                return self._processors[proc_type]
        
        raise ValueError("No payment processors available")
    
    def get_best_processor_for_payment(self, payment_request) -> Any:
        """Get the best processor for a specific payment request"""
        
        # Route based on payment method
        if payment_request.payment_method in ['card_chip', 'card_swipe', 'card_contactless']:
            # Prefer Square for card present transactions
            if ProcessorType.SQUARE in self._processors:
                return self._processors[ProcessorType.SQUARE]
            elif ProcessorType.STRIPE in self._processors:
                return self._processors[ProcessorType.STRIPE]
        
        elif payment_request.payment_method in ['digital_wallet', 'mobile_nfc']:
            # Prefer Stripe for digital wallets
            if ProcessorType.STRIPE in self._processors:
                return self._processors[ProcessorType.STRIPE]
            elif ProcessorType.SQUARE in self._processors:
                return self._processors[ProcessorType.SQUARE]
        
        # Route based on amount (example: high-value transactions to Stripe)
        if payment_request.amount > 1000:
            if ProcessorType.STRIPE in self._processors:
                return self._processors[ProcessorType.STRIPE]
        
        # Route based on merchant preferences
        merchant_processor = getattr(payment_request, 'preferred_processor', None)
        if merchant_processor and ProcessorType(merchant_processor) in self._processors:
            return self._processors[ProcessorType(merchant_processor)]
        
        # Default routing
        return self.get_processor()
    
    def get_available_processors(self) -> list[ProcessorType]:
        """Get list of available processors"""
        return list(self._processors.keys())
    
    def is_processor_available(self, processor_type: ProcessorType) -> bool:
        """Check if a processor is available"""
        return processor_type in self._processors
    
    def get_processor_health(self) -> Dict[ProcessorType, Dict[str, Any]]:
        """Get health status of all processors"""
        health_status = {}
        
        for proc_type, processor in self._processors.items():
            try:
                # Basic health check - could be expanded
                health_status[proc_type] = {
                    'status': 'healthy',
                    'type': proc_type.value,
                    'available': True
                }
            except Exception as e:
                health_status[proc_type] = {
                    'status': 'unhealthy',
                    'type': proc_type.value,
                    'available': False,
                    'error': str(e)
                }
        
        return health_status
    
    def _is_stripe_configured(self) -> bool:
        """Check if Stripe is properly configured"""
        return bool(os.getenv("STRIPE_SECRET_KEY"))
    
    def _is_square_configured(self) -> bool:
        """Check if Square is properly configured"""
        return bool(os.getenv("SQUARE_ACCESS_TOKEN") and os.getenv("SQUARE_APPLICATION_ID"))

class MockProcessor:
    """Mock payment processor for development/testing"""
    
    async def process_card_payment(self, payment_request) -> 'PaymentResponse':
        """Mock card payment processing"""
        from .stripe_processor import PaymentResponse, TransactionStatus
        import uuid
        
        # Simulate processing delay
        import asyncio
        await asyncio.sleep(0.1)
        
        # Mock approval logic (90% approval rate)
        import random
        if random.random() < 0.9:
            return PaymentResponse(
                transaction_id=f"mock_{uuid.uuid4().hex[:8]}",
                status=TransactionStatus.APPROVED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                authorization_code=f"AUTH_{uuid.uuid4().hex[:6].upper()}",
                processor_response={'processor': 'mock', 'test_mode': True},
                receipt_data={
                    'transaction_id': f"mock_{uuid.uuid4().hex[:8]}",
                    'amount': payment_request.amount,
                    'currency': payment_request.currency.upper(),
                    'payment_method': payment_request.payment_method,
                    'status': 'approved',
                    'timestamp': int(datetime.now().timestamp()),
                    'merchant_id': payment_request.merchant_id,
                    'terminal_id': payment_request.terminal_id,
                    'test_mode': True
                }
            )
        else:
            return PaymentResponse(
                transaction_id=None,
                status=TransactionStatus.DECLINED,
                amount=payment_request.amount,
                currency=payment_request.currency,
                error_message="Insufficient funds (mock decline)"
            )
    
    async def refund_payment(self, transaction_id: str, amount: Optional[float] = None) -> Dict[str, Any]:
        """Mock refund processing"""
        import uuid
        await asyncio.sleep(0.1)
        
        return {
            'success': True,
            'refund_id': f"refund_{uuid.uuid4().hex[:8]}",
            'amount': amount or 0,
            'status': 'completed'
        }
    
    async def get_payment_status(self, transaction_id: str) -> Dict[str, Any]:
        """Mock payment status check"""
        return {
            'transaction_id': transaction_id,
            'status': 'completed',
            'amount': 100.00,
            'currency': 'USD',
            'created': int(datetime.now().timestamp())
        }
    
    async def handle_webhook(self, payload: str, signature: str) -> Dict[str, Any]:
        """Mock webhook handling"""
        return {'handled': True, 'processor': 'mock'}

# Import datetime for MockProcessor
from datetime import datetime
