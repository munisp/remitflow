"""
Paystack Integration Service
FastAPI application for Paystack payment integration
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
import logging

from .services.paystack_service import PaystackService, PaystackAPIError
from .webhooks.webhook_handler import router as webhook_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Paystack Integration Service",
    description="Production-ready Paystack payment gateway integration",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include webhook router
app.include_router(webhook_router)

# Initialize service
paystack_service = PaystackService()


# ==================== REQUEST MODELS ====================

class InitiatePaymentRequest(BaseModel):
    """Request model for initiating payment"""
    email: EmailStr
    amount_ngn: float = Field(..., gt=0, description="Amount in Naira")
    callback_url: str
    metadata: Optional[Dict[str, Any]] = None
    channels: Optional[List[str]] = None


class VerifyPaymentRequest(BaseModel):
    """Request model for verifying payment"""
    reference: str


class ChargeCustomerRequest(BaseModel):
    """Request model for charging customer"""
    email: EmailStr
    amount_ngn: float = Field(..., gt=0)
    authorization_code: str
    metadata: Optional[Dict[str, Any]] = None


class CreateCustomerRequest(BaseModel):
    """Request model for creating customer"""
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class RefundRequest(BaseModel):
    """Request model for refund"""
    transaction_reference: str
    amount_ngn: Optional[float] = None
    customer_note: Optional[str] = None
    merchant_note: Optional[str] = None


class TransferRequest(BaseModel):
    """Request model for transfer"""
    recipient_code: str
    amount_ngn: float = Field(..., gt=0)
    reason: str


class VerifyBankAccountRequest(BaseModel):
    """Request model for bank account verification"""
    account_number: str = Field(..., min_length=10, max_length=10)
    bank_code: str


# ==================== ENDPOINTS ====================

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Paystack Integration",
        "version": "1.0.0",
        "status": "operational"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "paystack-integration"
    }


# ==================== PAYMENT ENDPOINTS ====================

@app.post("/payments/initiate")
async def initiate_payment(request: InitiatePaymentRequest):
    """
    Initiate a payment transaction
    
    Returns authorization URL for customer to complete payment
    """
    try:
        result = paystack_service.initiate_payment(
            email=request.email,
            amount_ngn=request.amount_ngn,
            callback_url=request.callback_url,
            metadata=request.metadata,
            channels=request.channels
        )
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Payment initiation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Payment initiation failed")


@app.post("/payments/verify")
async def verify_payment(request: VerifyPaymentRequest):
    """
    Verify a payment transaction
    
    Returns transaction status and details
    """
    try:
        result = paystack_service.verify_payment(request.reference)
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Payment verification failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Payment verification failed")


@app.post("/payments/charge")
async def charge_customer(request: ChargeCustomerRequest):
    """
    Charge a customer using saved authorization
    
    Requires authorization code from previous successful transaction
    """
    try:
        result = paystack_service.charge_customer(
            email=request.email,
            amount_ngn=request.amount_ngn,
            authorization_code=request.authorization_code,
            metadata=request.metadata
        )
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Customer charge failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Customer charge failed")


# ==================== CUSTOMER ENDPOINTS ====================

@app.post("/customers")
async def create_customer(request: CreateCustomerRequest):
    """
    Create or get existing customer
    
    Returns customer details
    """
    try:
        result = paystack_service.create_or_get_customer(
            email=request.email,
            first_name=request.first_name,
            last_name=request.last_name,
            phone=request.phone,
            metadata=request.metadata
        )
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Customer creation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Customer creation failed")


@app.get("/customers/{email_or_code}")
async def get_customer(email_or_code: str):
    """
    Get customer details
    
    Args:
        email_or_code: Customer email or customer code
    """
    try:
        from .api.paystack_client import PaystackClient
        client = PaystackClient()
        result = client.get_customer(email_or_code)
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Failed to get customer: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get customer")


# ==================== REFUND ENDPOINTS ====================

@app.post("/refunds")
async def create_refund(request: RefundRequest):
    """
    Process a refund
    
    Refunds can be full or partial
    """
    try:
        result = paystack_service.process_refund(
            transaction_reference=request.transaction_reference,
            amount_ngn=request.amount_ngn,
            customer_note=request.customer_note,
            merchant_note=request.merchant_note
        )
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Refund processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Refund processing failed")


# ==================== TRANSFER ENDPOINTS ====================

@app.post("/transfers")
async def initiate_transfer(request: TransferRequest):
    """
    Initiate a transfer to customer
    
    Requires recipient code from Paystack
    """
    try:
        result = paystack_service.transfer_to_customer(
            recipient_code=request.recipient_code,
            amount_ngn=request.amount_ngn,
            reason=request.reason
        )
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Transfer failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Transfer failed")


# ==================== BANK ENDPOINTS ====================

@app.get("/banks")
async def list_banks(country: str = "nigeria"):
    """
    Get list of supported banks
    
    Args:
        country: Country code (nigeria, ghana, south africa)
    """
    try:
        result = paystack_service.get_banks(country=country)
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Failed to get banks: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get banks")


@app.post("/banks/verify-account")
async def verify_bank_account(request: VerifyBankAccountRequest):
    """
    Verify bank account and get account name
    
    Useful for confirming beneficiary details before transfer
    """
    try:
        result = paystack_service.verify_bank_account(
            account_number=request.account_number,
            bank_code=request.bank_code
        )
        
        return {
            "status": "success",
            "data": result
        }
        
    except PaystackAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Bank account verification failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Bank account verification failed")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
