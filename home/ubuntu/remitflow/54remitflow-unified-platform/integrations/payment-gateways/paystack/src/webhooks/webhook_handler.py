"""
Paystack Webhook Handler
FastAPI endpoint for handling Paystack webhooks
"""

from fastapi import APIRouter, Request, HTTPException, Header
from typing import Optional
import logging

from ..services.paystack_service import PaystackService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/paystack", tags=["webhooks"])


@router.post("/")
async def handle_paystack_webhook(
    request: Request,
    x_paystack_signature: Optional[str] = Header(None)
):
    """
    Handle Paystack webhook events
    
    Paystack sends webhooks for various events:
    - charge.success
    - transfer.success
    - transfer.failed
    - refund.processed
    
    Args:
        request: FastAPI request object
        x_paystack_signature: Webhook signature header
        
    Returns:
        Success response
        
    Raises:
        HTTPException: If signature is invalid
    """
    if not x_paystack_signature:
        logger.error("Missing Paystack signature header")
        raise HTTPException(status_code=400, detail="Missing signature header")
    
    # Get raw body
    body = await request.body()
    
    try:
        # Initialize service
        service = PaystackService()
        
        # Handle webhook event
        event_data = service.handle_webhook_event(
            payload=body,
            signature=x_paystack_signature
        )
        
        event_type = event_data.get("event")
        logger.info(f"Webhook processed successfully: {event_type}")
        
        return {
            "status": "success",
            "message": f"Webhook event '{event_type}' processed successfully"
        }
        
    except ValueError as e:
        logger.error(f"Invalid webhook signature: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid signature")
    except Exception as e:
        logger.error(f"Webhook processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Webhook processing failed")
