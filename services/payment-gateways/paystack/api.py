"""
Paystack API - Comprehensive wrapper for all Paystack operations
"""

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, Optional, List
from datetime import datetime
import os
import uvicorn
import logging

# Import all modules
from client import PaystackClient
from payment_channels import PaystackPaymentChannels, PaymentChannel
from refunds_splits import PaystackRefunds, PaystackSplitPayments
from webhook_handler import PaystackWebhookHandler, WebhookEvent, setup_webhook_handlers

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Paystack Integration Service", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()] or ["https://app.remitflow.example"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Internal-Token"],
)

# Configuration (in production, load from env)
PAYSTACK_SECRET_KEY = "sk_test_xxx"  # Replace with actual key
PAYSTACK_PUBLIC_KEY = "pk_test_xxx"  # Replace with actual key

# Initialize clients
paystack_client = PaystackClient(PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY)
payment_channels = PaystackPaymentChannels(PAYSTACK_SECRET_KEY)
refunds_client = PaystackRefunds(PAYSTACK_SECRET_KEY)
splits_client = PaystackSplitPayments(PAYSTACK_SECRET_KEY)
webhook_handler = PaystackWebhookHandler(PAYSTACK_SECRET_KEY)

# Setup webhook handlers
setup_webhook_handlers(webhook_handler)


# Request/Response Models

class PaymentInitRequest(BaseModel):
    email: str
    amount: int  # in kobo
    reference: str
    channels: Optional[List[str]] = None
    callback_url: Optional[str] = None
    metadata: Optional[Dict] = None
    currency: str = "NGN"


class TransferRequest(BaseModel):
    amount: int  # in kobo
    recipient_code: str
    reason: str
    reference: Optional[str] = None
    currency: str = "NGN"


class RefundRequest(BaseModel):
    transaction: str
    amount: Optional[int] = None
    currency: Optional[str] = None
    customer_note: Optional[str] = None
    merchant_note: Optional[str] = None


class SplitCreateRequest(BaseModel):
    name: str
    split_type: str  # "percentage" or "flat"
    currency: str
    subaccounts: List[Dict]
    bearer_type: str = "account"
    bearer_subaccount: Optional[str] = None


class USSDPaymentRequest(BaseModel):
    email: str
    amount: int
    reference: str
    bank_code: str
    currency: str = "NGN"


class MobileMoneyRequest(BaseModel):
    email: str
    amount: int
    reference: str
    phone: str
    provider: str
    currency: str = "GHS"


class VirtualAccountRequest(BaseModel):
    customer: str  # customer code or email
    preferred_bank: Optional[str] = None


# API Endpoints

@app.get("/health")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "service": "paystack-integration",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }


# Payment Initialization

@app.post("/api/v1/payments/initialize")
async def initialize_payment(request: PaymentInitRequest):
    """Initialize payment"""
    try:
        channels = [PaymentChannel(ch) for ch in request.channels] if request.channels else None
        
        result = await payment_channels.initialize_payment(
            email=request.email,
            amount=request.amount,
            reference=request.reference,
            channels=channels,
            callback_url=request.callback_url,
            metadata=request.metadata,
            currency=request.currency
        )
        return result
    except Exception as e:
        logger.error(f"Payment initialization error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/payments/verify/{reference}")
async def verify_payment(reference: str):
    """Verify payment"""
    try:
        result = await payment_channels.verify_payment(reference)
        return result
    except Exception as e:
        logger.error(f"Payment verification error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# USSD Payments

@app.post("/api/v1/payments/ussd")
async def initiate_ussd_payment(request: USSDPaymentRequest):
    """Initiate USSD payment"""
    try:
        result = await payment_channels.initiate_ussd_payment(
            email=request.email,
            amount=request.amount,
            reference=request.reference,
            bank_code=request.bank_code,
            currency=request.currency
        )
        return result
    except Exception as e:
        logger.error(f"USSD payment error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Mobile Money

@app.post("/api/v1/payments/mobile-money")
async def initiate_mobile_money(request: MobileMoneyRequest):
    """Initiate mobile money payment"""
    try:
        result = await payment_channels.initiate_mobile_money(
            email=request.email,
            amount=request.amount,
            reference=request.reference,
            phone=request.phone,
            provider=request.provider,
            currency=request.currency
        )
        return result
    except Exception as e:
        logger.error(f"Mobile money error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Virtual Accounts

@app.post("/api/v1/virtual-accounts/create")
async def create_virtual_account(request: VirtualAccountRequest):
    """Create dedicated virtual account"""
    try:
        result = await payment_channels.create_dedicated_virtual_account(
            customer=request.customer,
            preferred_bank=request.preferred_bank
        )
        return result
    except Exception as e:
        logger.error(f"Virtual account creation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Transfers

@app.post("/api/v1/transfers/initiate")
async def initiate_transfer(request: TransferRequest):
    """Initiate transfer"""
    try:
        result = await paystack_client.initiate_transfer(
            amount=request.amount,
            recipient_code=request.recipient_code,
            reason=request.reason,
            reference=request.reference,
            currency=request.currency
        )
        return result
    except Exception as e:
        logger.error(f"Transfer error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/transfers/status/{transfer_code}")
async def get_transfer_status(transfer_code: str):
    """Get transfer status"""
    try:
        result = await paystack_client.get_transfer_status(transfer_code)
        return result
    except Exception as e:
        logger.error(f"Transfer status error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Refunds

@app.post("/api/v1/refunds/create")
async def create_refund(request: RefundRequest):
    """Create refund"""
    try:
        result = await refunds_client.create_refund(
            transaction=request.transaction,
            amount=request.amount,
            currency=request.currency,
            customer_note=request.customer_note,
            merchant_note=request.merchant_note
        )
        return result
    except Exception as e:
        logger.error(f"Refund creation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/refunds/list")
async def list_refunds(
    reference: Optional[str] = None,
    currency: Optional[str] = None,
    page: int = 1,
    per_page: int = 50
):
    """List refunds"""
    try:
        result = await refunds_client.list_refunds(
            reference=reference,
            currency=currency,
            page=page,
            per_page=per_page
        )
        return result
    except Exception as e:
        logger.error(f"Refund list error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/refunds/{refund_id}")
async def get_refund(refund_id: str):
    """Get refund details"""
    try:
        result = await refunds_client.get_refund(refund_id)
        return result
    except Exception as e:
        logger.error(f"Refund fetch error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Split Payments

@app.post("/api/v1/splits/create")
async def create_split(request: SplitCreateRequest):
    """Create split payment configuration"""
    try:
        result = await splits_client.create_split(
            name=request.name,
            split_type=request.split_type,
            currency=request.currency,
            subaccounts=request.subaccounts,
            bearer_type=request.bearer_type,
            bearer_subaccount=request.bearer_subaccount
        )
        return result
    except Exception as e:
        logger.error(f"Split creation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/splits/list")
async def list_splits(
    name: Optional[str] = None,
    active: Optional[bool] = None,
    page: int = 1,
    per_page: int = 50
):
    """List split configurations"""
    try:
        result = await splits_client.list_splits(
            name=name,
            active=active,
            page=page,
            per_page=per_page
        )
        return result
    except Exception as e:
        logger.error(f"Split list error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/splits/{split_id}")
async def get_split(split_id: str):
    """Get split configuration"""
    try:
        result = await splits_client.get_split(split_id)
        return result
    except Exception as e:
        logger.error(f"Split fetch error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Webhooks

@app.post("/api/v1/webhooks/paystack")
async def handle_webhook(request: Request, background_tasks: BackgroundTasks):
    """Handle Paystack webhook"""
    try:
        # Get signature from header
        signature = request.headers.get("x-paystack-signature")
        if not signature:
            raise HTTPException(status_code=400, detail="Missing signature")
        
        # Get raw body
        body = await request.body()
        payload = body.decode()
        
        # Process webhook
        result = await webhook_handler.process_webhook(payload, signature)
        
        return {"status": "processed", "result": result}
        
    except ValueError as e:
        logger.error(f"Webhook validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Webhook processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/webhooks/events")
async def get_webhook_events(event_type: Optional[str] = None, limit: int = 100):
    """Get processed webhook events"""
    events = webhook_handler.get_processed_events(event_type, limit)
    return {"events": events, "count": len(events)}


@app.get("/api/v1/webhooks/stats")
async def get_webhook_stats():
    """Get webhook statistics"""
    return webhook_handler.get_statistics()


# OTP/PIN Submission

@app.post("/api/v1/payments/submit-otp")
async def submit_otp(otp: str, reference: str):
    """Submit OTP"""
    try:
        result = await payment_channels.submit_otp(otp, reference)
        return result
    except Exception as e:
        logger.error(f"OTP submission error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/payments/submit-pin")
async def submit_pin(pin: str, reference: str):
    """Submit PIN"""
    try:
        result = await payment_channels.submit_pin(pin, reference)
        return result
    except Exception as e:
        logger.error(f"PIN submission error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/payments/submit-phone")
async def submit_phone(phone: str, reference: str):
    """Submit phone number"""
    try:
        result = await payment_channels.submit_phone(phone, reference)
        return result
    except Exception as e:
        logger.error(f"Phone submission error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Charge Status

@app.get("/api/v1/payments/charge/{reference}")
async def check_charge(reference: str):
    """Check pending charge status"""
    try:
        result = await payment_channels.check_pending_charge(reference)
        return result
    except Exception as e:
        logger.error(f"Charge check error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8020)
