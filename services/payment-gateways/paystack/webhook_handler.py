"""
Paystack Webhook Handler - Process payment events
"""

import hmac
import hashlib
import json
import logging
from typing import Dict, Optional, Callable, List
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)


class WebhookEvent(str, Enum):
    """Paystack webhook events"""
    CHARGE_SUCCESS = "charge.success"
    CHARGE_FAILED = "charge.failed"
    TRANSFER_SUCCESS = "transfer.success"
    TRANSFER_FAILED = "transfer.failed"
    TRANSFER_REVERSED = "transfer.reversed"
    CUSTOMER_IDENTIFICATION_SUCCESS = "customeridentification.success"
    CUSTOMER_IDENTIFICATION_FAILED = "customeridentification.failed"
    DEDICATED_ACCOUNT_ASSIGN_SUCCESS = "dedicatedaccount.assign.success"
    DEDICATED_ACCOUNT_ASSIGN_FAILED = "dedicatedaccount.assign.failed"
    SUBSCRIPTION_CREATE = "subscription.create"
    SUBSCRIPTION_DISABLE = "subscription.disable"
    SUBSCRIPTION_NOT_RENEW = "subscription.not_renew"
    INVOICE_CREATE = "invoice.create"
    INVOICE_UPDATE = "invoice.update"
    INVOICE_PAYMENT_FAILED = "invoice.payment_failed"
    REFUND_PENDING = "refund.pending"
    REFUND_PROCESSED = "refund.processed"
    REFUND_FAILED = "refund.failed"


class PaystackWebhookHandler:
    """Handles Paystack webhook events"""
    
    def __init__(self, secret_key: str):
        self.secret_key = secret_key
        self.event_handlers: Dict[str, List[Callable]] = {}
        self.processed_events: List[Dict] = []
        logger.info("Paystack webhook handler initialized")
    
    def verify_signature(self, payload: str, signature: str) -> bool:
        """Verify webhook signature"""
        
        expected = hmac.new(
            self.secret_key.encode(),
            payload.encode(),
            hashlib.sha512
        ).hexdigest()
        
        is_valid = hmac.compare_digest(expected, signature)
        
        if not is_valid:
            logger.warning("Invalid webhook signature")
        
        return is_valid
    
    def register_handler(self, event_type: WebhookEvent, handler: Callable):
        """Register event handler"""
        
        if event_type not in self.event_handlers:
            self.event_handlers[event_type] = []
        
        self.event_handlers[event_type].append(handler)
        logger.info(f"Handler registered for {event_type}")
    
    async def process_webhook(
        self,
        payload: str,
        signature: str,
        verify: bool = True
    ) -> Dict:
        """Process webhook payload"""
        
        # Verify signature
        if verify and not self.verify_signature(payload, signature):
            raise ValueError("Invalid webhook signature")
        
        # Parse payload
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON payload: {e}")
            raise ValueError("Invalid JSON payload")
        
        event_type = data.get("event")
        event_data = data.get("data")
        
        if not event_type:
            raise ValueError("Missing event type")
        
        logger.info(f"Processing webhook: {event_type}")
        
        # Store event
        self.processed_events.append({
            "event_type": event_type,
            "data": event_data,
            "processed_at": datetime.utcnow().isoformat()
        })
        
        # Execute handlers
        results = []
        if event_type in self.event_handlers:
            for handler in self.event_handlers[event_type]:
                try:
                    result = await handler(event_data)
                    results.append({
                        "handler": handler.__name__,
                        "result": result,
                        "status": "success"
                    })
                except Exception as e:
                    logger.error(f"Handler error for {event_type}: {e}")
                    results.append({
                        "handler": handler.__name__,
                        "error": str(e),
                        "status": "failed"
                    })
        
        return {
            "event_type": event_type,
            "handlers_executed": len(results),
            "results": results
        }
    
    def get_processed_events(
        self,
        event_type: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict]:
        """Get processed events"""
        
        events = self.processed_events[-limit:]
        
        if event_type:
            events = [e for e in events if e["event_type"] == event_type]
        
        return events
    
    def get_statistics(self) -> Dict:
        """Get webhook statistics"""
        
        total_events = len(self.processed_events)
        
        events_by_type = {}
        for event in self.processed_events:
            event_type = event["event_type"]
            events_by_type[event_type] = events_by_type.get(event_type, 0) + 1
        
        return {
            "total_events_processed": total_events,
            "registered_handlers": len(self.event_handlers),
            "events_by_type": events_by_type
        }


# Example handlers

async def handle_charge_success(data: Dict):
    """Handle successful charge"""
    logger.info(f"Charge successful: {data.get('reference')}")
    
    # Update transaction status in database
    # Send confirmation email
    # Update user balance
    
    return {
        "reference": data.get("reference"),
        "amount": data.get("amount"),
        "status": "processed"
    }


async def handle_charge_failed(data: Dict):
    """Handle failed charge"""
    logger.warning(f"Charge failed: {data.get('reference')}")
    
    # Update transaction status
    # Send failure notification
    # Trigger retry logic if applicable
    
    return {
        "reference": data.get("reference"),
        "status": "failed",
        "message": data.get("gateway_response")
    }


async def handle_transfer_success(data: Dict):
    """Handle successful transfer"""
    logger.info(f"Transfer successful: {data.get('reference')}")
    
    # Update transfer status
    # Update recipient balance
    # Send confirmation
    
    return {
        "reference": data.get("reference"),
        "status": "completed"
    }


async def handle_transfer_failed(data: Dict):
    """Handle failed transfer"""
    logger.warning(f"Transfer failed: {data.get('reference')}")
    
    # Update transfer status
    # Refund sender if applicable
    # Send failure notification
    
    return {
        "reference": data.get("reference"),
        "status": "failed",
        "reason": data.get("reason")
    }


async def handle_refund_processed(data: Dict):
    """Handle processed refund"""
    logger.info(f"Refund processed: {data.get('transaction')}")
    
    # Update refund status
    # Update user balance
    # Send confirmation
    
    return {
        "transaction": data.get("transaction"),
        "amount": data.get("amount"),
        "status": "refunded"
    }


async def handle_dedicated_account_assign(data: Dict):
    """Handle dedicated account assignment"""
    logger.info(f"Dedicated account assigned: {data.get('account_number')}")
    
    # Store account details
    # Link to customer
    # Send notification
    
    return {
        "account_number": data.get("account_number"),
        "customer": data.get("customer", {}).get("customer_code"),
        "status": "assigned"
    }


# Webhook setup helper

def setup_webhook_handlers(handler: PaystackWebhookHandler):
    """Setup default webhook handlers"""
    
    handler.register_handler(WebhookEvent.CHARGE_SUCCESS, handle_charge_success)
    handler.register_handler(WebhookEvent.CHARGE_FAILED, handle_charge_failed)
    handler.register_handler(WebhookEvent.TRANSFER_SUCCESS, handle_transfer_success)
    handler.register_handler(WebhookEvent.TRANSFER_FAILED, handle_transfer_failed)
    handler.register_handler(WebhookEvent.REFUND_PROCESSED, handle_refund_processed)
    handler.register_handler(
        WebhookEvent.DEDICATED_ACCOUNT_ASSIGN_SUCCESS,
        handle_dedicated_account_assign
    )
    
    logger.info("Default webhook handlers registered")
