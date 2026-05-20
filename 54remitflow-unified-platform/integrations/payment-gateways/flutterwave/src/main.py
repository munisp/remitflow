"""
Flutterwave Integration API
FastAPI application for Flutterwave payment gateway integration
"""

from fastapi import FastAPI, HTTPException, Header, Request, status
from fastapi.responses import JSONResponse
from typing import Optional, List
import logging
import os

from .services.flutterwave_service import FlutterwaveService
from .models.transaction import (
    PaymentInitRequest,
    PaymentInitResponse,
    PaymentVerifyResponse,
    TransferRequest,
    TransferResponse,
    VirtualAccountRequest,
    VirtualAccountResponse,
    BankInfo,
    AccountResolveRequest,
    AccountResolveResponse
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Flutterwave Integration API",
    description="Complete Flutterwave payment gateway integration",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Initialize Flutterwave service
service = FlutterwaveService(
    secret_key=os.getenv("FLUTTERWAVE_SECRET_KEY"),
    public_key=os.getenv("FLUTTERWAVE_PUBLIC_KEY"),
    encryption_key=os.getenv("FLUTTERWAVE_ENCRYPTION_KEY"),
    environment=os.getenv("FLUTTERWAVE_ENVIRONMENT", "sandbox")
)


# ==================== HEALTH CHECK ====================

@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Flutterwave Integration",
        "version": "1.0.0"
    }


# ==================== PAYMENTS ====================

@app.post(
    "/payments/initialize",
    response_model=PaymentInitResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Payments"]
)
async def initialize_payment(request: PaymentInitRequest):
    """
    Initialize a payment
    
    Creates a payment link for the customer to complete payment
    """
    try:
        result = service.initialize_payment(
            amount=request.amount,
            customer_email=request.customer_email,
            customer_name=request.customer_name,
            customer_phone=request.customer_phone,
            currency=request.currency,
            redirect_url=request.redirect_url,
            payment_options=request.payment_options,
            metadata=request.metadata
        )
        
        return PaymentInitResponse(**result)
        
    except Exception as e:
        logger.error(f"Payment initialization failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@app.get(
    "/payments/verify/{transaction_id}",
    response_model=PaymentVerifyResponse,
    tags=["Payments"]
)
async def verify_payment(transaction_id: int):
    """
    Verify a payment
    
    Verifies the status of a payment using transaction ID
    """
    try:
        result = service.verify_payment(transaction_id)
        return PaymentVerifyResponse(**result)
        
    except Exception as e:
        logger.error(f"Payment verification failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@app.get(
    "/payments/verify-by-reference",
    response_model=PaymentVerifyResponse,
    tags=["Payments"]
)
async def verify_payment_by_reference(tx_ref: str):
    """
    Verify payment by reference
    
    Verifies the status of a payment using transaction reference
    """
    try:
        result = service.verify_payment_by_reference(tx_ref)
        return PaymentVerifyResponse(**result)
        
    except Exception as e:
        logger.error(f"Payment verification failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ==================== TRANSFERS ====================

@app.post(
    "/transfers",
    response_model=TransferResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Transfers"]
)
async def create_transfer(request: TransferRequest):
    """
    Create a transfer
    
    Initiates a bank transfer to a beneficiary account
    """
    try:
        result = service.create_transfer(
            account_number=request.account_number,
            account_bank=request.account_bank,
            amount=request.amount,
            narration=request.narration,
            currency=request.currency,
            beneficiary_name=request.beneficiary_name,
            metadata=request.metadata
        )
        
        return TransferResponse(**result)
        
    except Exception as e:
        logger.error(f"Transfer creation failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@app.get(
    "/transfers/{transfer_id}",
    response_model=TransferResponse,
    tags=["Transfers"]
)
async def get_transfer(transfer_id: int):
    """
    Get transfer details
    
    Retrieves the details and status of a transfer
    """
    try:
        result = service.get_transfer(transfer_id)
        return TransferResponse(**result)
        
    except Exception as e:
        logger.error(f"Get transfer failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ==================== VIRTUAL ACCOUNTS ====================

@app.post(
    "/virtual-accounts",
    response_model=VirtualAccountResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Virtual Accounts"]
)
async def create_virtual_account(request: VirtualAccountRequest):
    """
    Create a virtual account
    
    Creates a virtual bank account for receiving payments
    """
    try:
        result = service.create_virtual_account(
            email=request.email,
            bvn=request.bvn,
            tx_ref=request.tx_ref,
            firstname=request.firstname,
            lastname=request.lastname,
            phonenumber=request.phonenumber,
            narration=request.narration
        )
        
        return VirtualAccountResponse(**result)
        
    except Exception as e:
        logger.error(f"Virtual account creation failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ==================== BANKS ====================

@app.get(
    "/banks",
    response_model=List[BankInfo],
    tags=["Banks"]
)
async def list_banks(country: str = "NG"):
    """
    List banks
    
    Retrieves list of supported banks for a country
    
    Supported countries: NG (Nigeria), GH (Ghana), KE (Kenya), UG (Uganda), TZ (Tanzania), ZA (South Africa)
    """
    try:
        result = service.list_banks(country)
        return [BankInfo(**bank) for bank in result]
        
    except Exception as e:
        logger.error(f"List banks failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@app.post(
    "/banks/resolve",
    response_model=AccountResolveResponse,
    tags=["Banks"]
)
async def resolve_account(request: AccountResolveRequest):
    """
    Resolve bank account
    
    Validates and retrieves account name for a bank account number
    """
    try:
        result = service.resolve_account(
            account_number=request.account_number,
            account_bank=request.account_bank
        )
        
        return AccountResolveResponse(**result)
        
    except Exception as e:
        logger.error(f"Account resolution failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ==================== WEBHOOKS ====================

@app.post(
    "/webhooks/flutterwave",
    status_code=status.HTTP_200_OK,
    tags=["Webhooks"]
)
async def handle_webhook(
    request: Request,
    verif_hash: Optional[str] = Header(None)
):
    """
    Handle Flutterwave webhook
    
    Receives and processes webhook events from Flutterwave
    
    Events:
    - charge.completed: Payment completed
    - transfer.completed: Transfer completed
    """
    try:
        # Get raw body
        body = await request.body()
        
        # Verify and process webhook
        result = service.handle_webhook_event(body, verif_hash)
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "success", "data": result}
        )
        
    except ValueError as e:
        logger.error(f"Webhook verification failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature"
        )
    except Exception as e:
        logger.error(f"Webhook processing failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ==================== ERROR HANDLERS ====================

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "status_code": exc.status_code
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle general exceptions"""
    logger.error(f"Unhandled exception: {str(exc)}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal server error",
            "status_code": 500
        }
    )


# ==================== STARTUP/SHUTDOWN ====================

@app.on_event("startup")
async def startup_event():
    """Startup event"""
    logger.info("Flutterwave Integration API started")


@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown event"""
    logger.info("Flutterwave Integration API stopped")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
