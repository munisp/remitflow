"""
Interswitch Integration FastAPI Application
Complete REST API for Interswitch payment gateway
"""

from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
import logging

from .services.interswitch_service import InterswitchService
from .api.interswitch_client import InterswitchAPIError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Interswitch Integration API",
    description="Complete REST API for Interswitch payment gateway integration",
    version="1.0.0"
)

# Initialize service
service = InterswitchService()


# ==================== REQUEST MODELS ====================

class PaymentRequest(BaseModel):
    """Payment initialization request"""
    amount: float = Field(..., gt=0, description="Amount in Naira")
    customer_email: EmailStr = Field(..., description="Customer email")
    customer_name: str = Field(..., min_length=1, description="Customer name")
    redirect_url: str = Field(..., description="Redirect URL after payment")
    currency: str = Field(default="NGN", description="Currency code")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class BillPaymentRequest(BaseModel):
    """Bill payment request"""
    biller_id: str = Field(..., description="Biller ID")
    customer_id: str = Field(..., description="Customer ID (meter number, phone, etc.)")
    payment_code: str = Field(..., description="Payment code")
    amount: float = Field(..., gt=0, description="Amount in Naira")
    customer_email: Optional[EmailStr] = Field(default=None, description="Customer email")
    customer_phone: Optional[str] = Field(default=None, description="Customer phone")


class AirtimeRequest(BaseModel):
    """Airtime purchase request"""
    phone_number: str = Field(..., pattern=r"^0[0-9]{10}$", description="Phone number (11 digits)")
    amount: float = Field(..., gt=0, le=50000, description="Amount in Naira (max 50,000)")


class TransferRequest(BaseModel):
    """Bank transfer request"""
    account_number: str = Field(..., pattern=r"^[0-9]{10}$", description="Account number (10 digits)")
    bank_code: str = Field(..., description="Bank code")
    amount: float = Field(..., gt=0, description="Amount in Naira")
    narration: str = Field(..., min_length=1, max_length=100, description="Transfer narration")
    beneficiary_name: Optional[str] = Field(default=None, description="Beneficiary name")


class BVNValidationRequest(BaseModel):
    """BVN validation request"""
    bvn: str = Field(..., pattern=r"^[0-9]{11}$", description="BVN (11 digits)")
    first_name: str = Field(..., description="First name")
    last_name: str = Field(..., description="Last name")
    date_of_birth: str = Field(..., pattern=r"^\d{2}-\d{2}-\d{4}$", description="Date of birth (DD-MM-YYYY)")


class AccountValidationRequest(BaseModel):
    """Account validation request"""
    account_number: str = Field(..., pattern=r"^[0-9]{10}$", description="Account number (10 digits)")
    bank_code: str = Field(..., description="Bank code")


class VerveTokenizeRequest(BaseModel):
    """Verve card tokenization request"""
    pan: str = Field(..., pattern=r"^[0-9]{16}$", description="Card number (16 digits)")
    expiry_date: str = Field(..., pattern=r"^[0-9]{4}$", description="Expiry date (YYMM)")
    cvv: str = Field(..., pattern=r"^[0-9]{3}$", description="CVV (3 digits)")
    pin: str = Field(..., pattern=r"^[0-9]{4}$", description="PIN (4 digits)")


class VerveChargeRequest(BaseModel):
    """Verve token charge request"""
    token: str = Field(..., description="Card token")
    amount: float = Field(..., gt=0, description="Amount to charge")
    currency: str = Field(default="NGN", description="Currency code")


# ==================== WEBPAY ENDPOINTS ====================

@app.post("/payments/initialize", tags=["Payments"])
async def initialize_payment(request: PaymentRequest):
    """
    Initialize a Webpay payment
    
    Returns payment URL for customer to complete payment
    """
    try:
        result = service.initiate_payment(
            amount_ngn=request.amount,
            customer_email=request.customer_email,
            customer_name=request.customer_name,
            redirect_url=request.redirect_url,
            currency=request.currency,
            metadata=request.metadata
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Payment initialization error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/payments/verify/{reference}", tags=["Payments"])
async def verify_payment(reference: str, amount: float):
    """
    Verify a payment transaction
    
    Args:
        reference: Transaction reference
        amount: Transaction amount
    """
    try:
        result = service.verify_payment(reference=reference, amount=amount)
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Payment verification error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ==================== BILL PAYMENT ENDPOINTS ====================

@app.get("/bills/categories", tags=["Bill Payments"])
async def get_bill_categories():
    """Get bill payment categories"""
    try:
        categories = service.get_bill_categories()
        return JSONResponse(content={"categories": categories}, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Get categories error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/bills/billers", tags=["Bill Payments"])
async def get_billers(category_id: Optional[str] = None):
    """
    Get billers
    
    Args:
        category_id: Filter by category ID
    """
    try:
        billers = service.get_billers(category_id=category_id)
        return JSONResponse(content={"billers": billers}, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Get billers error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/bills/validate", tags=["Bill Payments"])
async def validate_bill_customer(
    biller_id: str,
    customer_id: str,
    payment_code: str
):
    """
    Validate customer for bill payment
    
    Args:
        biller_id: Biller ID
        customer_id: Customer ID
        payment_code: Payment code
    """
    try:
        result = service.validate_bill_customer(
            biller_id=biller_id,
            customer_id=customer_id,
            payment_code=payment_code
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Customer validation error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/bills/pay", tags=["Bill Payments"])
async def pay_bill(request: BillPaymentRequest):
    """Pay a bill via Quickteller"""
    try:
        result = service.pay_bill(
            biller_id=request.biller_id,
            customer_id=request.customer_id,
            payment_code=request.payment_code,
            amount=request.amount,
            customer_email=request.customer_email,
            customer_phone=request.customer_phone
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Bill payment error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/bills/airtime", tags=["Bill Payments"])
async def buy_airtime(request: AirtimeRequest):
    """Buy airtime"""
    try:
        result = service.buy_airtime(
            phone_number=request.phone_number,
            amount=request.amount
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Airtime purchase error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ==================== TRANSFER ENDPOINTS ====================

@app.post("/transfers", tags=["Transfers"])
async def transfer_funds(request: TransferRequest):
    """Transfer funds to bank account"""
    try:
        result = service.transfer_funds(
            account_number=request.account_number,
            bank_code=request.bank_code,
            amount=request.amount,
            narration=request.narration,
            beneficiary_name=request.beneficiary_name
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Transfer error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/transfers/{reference}", tags=["Transfers"])
async def query_transfer(reference: str):
    """Query transfer status"""
    try:
        result = service.query_transfer(reference=reference)
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Transfer query error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ==================== VALIDATION ENDPOINTS ====================

@app.post("/validation/bvn", tags=["Validation"])
async def validate_bvn(request: BVNValidationRequest):
    """Validate BVN (Bank Verification Number)"""
    try:
        result = service.validate_bvn(
            bvn=request.bvn,
            first_name=request.first_name,
            last_name=request.last_name,
            date_of_birth=request.date_of_birth
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"BVN validation error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/validation/account", tags=["Validation"])
async def validate_account(request: AccountValidationRequest):
    """Validate bank account number"""
    try:
        result = service.validate_account(
            account_number=request.account_number,
            bank_code=request.bank_code
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Account validation error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ==================== VERVE ENDPOINTS ====================

@app.post("/verve/tokenize", tags=["Verve"])
async def tokenize_verve_card(request: VerveTokenizeRequest):
    """Tokenize Verve card for future transactions"""
    try:
        result = service.tokenize_verve_card(
            pan=request.pan,
            expiry_date=request.expiry_date,
            cvv=request.cvv,
            pin=request.pin
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Card tokenization error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/verve/charge", tags=["Verve"])
async def charge_verve_token(request: VerveChargeRequest):
    """Charge Verve card using token"""
    try:
        result = service.charge_verve_token(
            token=request.token,
            amount=request.amount,
            currency=request.currency
        )
        return JSONResponse(content=result, status_code=200)
    except InterswitchAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"Verve charge error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ==================== WEBHOOK ENDPOINT ====================

@app.post("/webhooks/interswitch", tags=["Webhooks"])
async def handle_webhook(
    request: Request,
    x_interswitch_signature: str = Header(None, alias="X-Interswitch-Signature")
):
    """
    Handle Interswitch webhook events
    
    Verifies signature and processes payment/transfer events
    """
    try:
        # Get raw body
        body = await request.body()
        
        if not x_interswitch_signature:
            raise HTTPException(status_code=400, detail="Missing signature header")
        
        # Handle webhook
        event_data = service.handle_webhook_event(
            payload=body,
            signature=x_interswitch_signature
        )
        
        return JSONResponse(content={"status": "success", "event": event_data}, status_code=200)
        
    except ValueError as e:
        logger.error(f"Webhook verification failed: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid signature")
    except Exception as e:
        logger.error(f"Webhook processing error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ==================== HEALTH CHECK ====================

@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return JSONResponse(content={
        "status": "healthy",
        "service": "Interswitch Integration",
        "version": "1.0.0"
    }, status_code=200)


# ==================== ERROR HANDLERS ====================

@app.exception_handler(InterswitchAPIError)
async def interswitch_error_handler(request: Request, exc: InterswitchAPIError):
    """Handle Interswitch API errors"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.message,
            "status_code": exc.status_code,
            "response": exc.response
        }
    )


@app.exception_handler(Exception)
async def general_error_handler(request: Request, exc: Exception):
    """Handle general errors"""
    logger.error(f"Unhandled error: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
