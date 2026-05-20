"""
Bill Payment Service - Production Implementation
Utility bill payments for electricity, water, internet, TV, etc.

Production-ready version with:
- Structured logging with correlation IDs
- Rate limiting
- Environment-driven CORS configuration
"""

import os
import sys

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime
from enum import Enum
from decimal import Decimal
import uvicorn
import uuid

# Import new modules
from providers import BillPaymentManager

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Bill Payment Service", version="2.0.0")

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "bill-payment-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)

# Enums
class BillCategory(str, Enum):
    ELECTRICITY = "electricity"
    WATER = "water"
    INTERNET = "internet"
    CABLE_TV = "cable_tv"
    MOBILE_POSTPAID = "mobile_postpaid"
    INSURANCE = "insurance"
    EDUCATION = "education"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    REVERSED = "reversed"

# Models
class Biller(BaseModel):
    biller_id: str
    name: str
    category: BillCategory
    logo_url: Optional[str] = None
    min_amount: Decimal = Decimal("100.00")
    max_amount: Decimal = Decimal("1000000.00")
    fee_percentage: Decimal = Decimal("0.01")  # 1%
    is_active: bool = True

class BillPayment(BaseModel):
    payment_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    biller_id: str
    biller_name: str
    category: BillCategory
    
    # Customer details
    customer_id: str  # Account number, meter number, etc.
    customer_name: str
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    
    # Payment details
    amount: Decimal
    fee: Decimal = Decimal("0.00")
    total_amount: Decimal = Decimal("0.00")
    currency: str = "NGN"
    
    # Reference
    reference: str = Field(default_factory=lambda: f"BILL{uuid.uuid4().hex[:12].upper()}")
    biller_reference: Optional[str] = None
    
    # Status
    status: PaymentStatus = PaymentStatus.PENDING
    
    # Metadata
    metadata: Dict = Field(default_factory=dict)
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    # Error
    error_message: Optional[str] = None

class CreateBillPaymentRequest(BaseModel):
    user_id: str
    biller_id: str
    customer_id: str
    customer_name: str
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    amount: Decimal
    metadata: Dict = Field(default_factory=dict)

class BillPaymentResponse(BaseModel):
    payment_id: str
    reference: str
    status: PaymentStatus
    amount: Decimal
    fee: Decimal
    total_amount: Decimal
    biller_name: str
    created_at: datetime

# Storage
billers_db: Dict[str, Biller] = {
    "EKEDC001": Biller(biller_id="EKEDC001", name="Eko Electricity", category=BillCategory.ELECTRICITY, min_amount=Decimal("500"), max_amount=Decimal("500000")),
    "IKEDC001": Biller(biller_id="IKEDC001", name="Ikeja Electric", category=BillCategory.ELECTRICITY, min_amount=Decimal("500"), max_amount=Decimal("500000")),
    "DSTV001": Biller(biller_id="DSTV001", name="DSTV", category=BillCategory.CABLE_TV, min_amount=Decimal("1800"), max_amount=Decimal("50000")),
    "GOTV001": Biller(biller_id="GOTV001", name="GOTV", category=BillCategory.CABLE_TV, min_amount=Decimal("900"), max_amount=Decimal("10000")),
    "SPECTRANET001": Biller(biller_id="SPECTRANET001", name="Spectranet", category=BillCategory.INTERNET, min_amount=Decimal("3000"), max_amount=Decimal("100000")),
}

payments_db: Dict[str, BillPayment] = {}
reference_index: Dict[str, str] = {}

# Initialize manager
bill_manager = BillPaymentManager()

class BillPaymentService:
    """Production bill payment service"""
    
    @staticmethod
    async def get_billers(category: Optional[BillCategory] = None) -> List[Biller]:
        """Get list of billers"""
        
        billers = list(billers_db.values())
        
        if category:
            billers = [b for b in billers if b.category == category]
        
        return [b for b in billers if b.is_active]
    
    @staticmethod
    async def get_biller(biller_id: str) -> Biller:
        """Get biller by ID"""
        
        if biller_id not in billers_db:
            raise HTTPException(status_code=404, detail="Biller not found")
        
        return billers_db[biller_id]
    
    @staticmethod
    async def validate_customer(biller_id: str, customer_id: str) -> Dict:
        """Validate customer account"""
        
        biller = await BillPaymentService.get_biller(biller_id)
        
        # Simulate validation
        return {
            "valid": True,
            "customer_name": "John Doe",
            "customer_id": customer_id,
            "biller_name": biller.name,
            "outstanding_balance": Decimal("5000.00")
        }
    
    @staticmethod
    async def create_payment(request: CreateBillPaymentRequest) -> BillPayment:
        """Create bill payment"""
        
        # Get biller
        biller = await BillPaymentService.get_biller(request.biller_id)
        
        # Validate amount
        if request.amount < biller.min_amount:
            raise HTTPException(status_code=400, detail=f"Amount below minimum ({biller.min_amount})")
        if request.amount > biller.max_amount:
            raise HTTPException(status_code=400, detail=f"Amount above maximum ({biller.max_amount})")
        
        # Calculate fee
        fee = request.amount * biller.fee_percentage
        if fee < Decimal("50.00"):
            fee = Decimal("50.00")
        total_amount = request.amount + fee
        
        # Create payment
        payment = BillPayment(
            user_id=request.user_id,
            biller_id=request.biller_id,
            biller_name=biller.name,
            category=biller.category,
            customer_id=request.customer_id,
            customer_name=request.customer_name,
            customer_phone=request.customer_phone,
            customer_email=request.customer_email,
            amount=request.amount,
            fee=fee,
            total_amount=total_amount,
            metadata=request.metadata
        )
        
        # Store
        payments_db[payment.payment_id] = payment
        reference_index[payment.reference] = payment.payment_id
        
        logger.info(f"Created bill payment {payment.payment_id}: {biller.name} - {request.amount}")
        return payment
    
    @staticmethod
    async def process_payment(payment_id: str) -> BillPayment:
        """Process bill payment"""
        
        if payment_id not in payments_db:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        payment = payments_db[payment_id]
        
        if payment.status != PaymentStatus.PENDING:
            raise HTTPException(status_code=400, detail=f"Payment already {payment.status}")
        
        # Process
        payment.status = PaymentStatus.PROCESSING
        payment.processed_at = datetime.utcnow()
        payment.biller_reference = f"BREF{uuid.uuid4().hex[:16].upper()}"
        
        logger.info(f"Processing bill payment {payment_id}")
        return payment
    
    @staticmethod
    async def complete_payment(payment_id: str) -> BillPayment:
        """Complete bill payment"""
        
        if payment_id not in payments_db:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        payment = payments_db[payment_id]
        
        if payment.status != PaymentStatus.PROCESSING:
            raise HTTPException(status_code=400, detail="Payment not processing")
        
        payment.status = PaymentStatus.COMPLETED
        payment.completed_at = datetime.utcnow()
        
        logger.info(f"Completed bill payment {payment_id}")
        return payment
    
    @staticmethod
    async def get_payment(payment_id: str) -> BillPayment:
        """Get payment by ID"""
        
        if payment_id not in payments_db:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        return payments_db[payment_id]
    
    @staticmethod
    async def list_payments(user_id: Optional[str] = None, category: Optional[BillCategory] = None, limit: int = 50) -> List[BillPayment]:
        """List payments"""
        
        payments = list(payments_db.values())
        
        if user_id:
            payments = [p for p in payments if p.user_id == user_id]
        
        if category:
            payments = [p for p in payments if p.category == category]
        
        payments.sort(key=lambda x: x.created_at, reverse=True)
        return payments[:limit]

# API Endpoints
@app.get("/api/v1/billers", response_model=List[Biller])
async def get_billers(category: Optional[BillCategory] = None):
    """Get billers"""
    return await BillPaymentService.get_billers(category)

@app.get("/api/v1/billers/{biller_id}", response_model=Biller)
async def get_biller(biller_id: str):
    """Get biller"""
    return await BillPaymentService.get_biller(biller_id)

@app.post("/api/v1/billers/{biller_id}/validate")
async def validate_customer(biller_id: str, customer_id: str):
    """Validate customer"""
    return await BillPaymentService.validate_customer(biller_id, customer_id)

@app.post("/api/v1/bill-payments", response_model=BillPaymentResponse)
async def create_payment(request: CreateBillPaymentRequest):
    """Create bill payment"""
    payment = await BillPaymentService.create_payment(request)
    return BillPaymentResponse(
        payment_id=payment.payment_id,
        reference=payment.reference,
        status=payment.status,
        amount=payment.amount,
        fee=payment.fee,
        total_amount=payment.total_amount,
        biller_name=payment.biller_name,
        created_at=payment.created_at
    )

@app.post("/api/v1/bill-payments/{payment_id}/process", response_model=BillPayment)
async def process_payment(payment_id: str):
    """Process payment"""
    return await BillPaymentService.process_payment(payment_id)

@app.post("/api/v1/bill-payments/{payment_id}/complete", response_model=BillPayment)
async def complete_payment(payment_id: str):
    """Complete payment"""
    return await BillPaymentService.complete_payment(payment_id)

@app.get("/api/v1/bill-payments/{payment_id}", response_model=BillPayment)
async def get_payment(payment_id: str):
    """Get payment"""
    return await BillPaymentService.get_payment(payment_id)

@app.get("/api/v1/bill-payments", response_model=List[BillPayment])
async def list_payments(user_id: Optional[str] = None, category: Optional[BillCategory] = None, limit: int = 50):
    """List payments"""
    return await BillPaymentService.list_payments(user_id, category, limit)

@app.get("/health")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "service": "bill-payment-service",
        "version": "2.0.0",
        "total_billers": len(billers_db),
        "total_payments": len(payments_db),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/v1/bills/pay")
async def pay_bill(
    bill_type: str,
    account_number: str,
    amount: Decimal,
    metadata: Dict = None
):
    """Pay bill via provider"""
    return await bill_manager.process_payment(bill_type, account_number, amount, metadata)

@app.post("/api/v1/bills/verify")
async def verify_bill_account(bill_type: str, account_number: str):
    """Verify bill account"""
    return await bill_manager.verify_account(bill_type, account_number)

@app.get("/api/v1/bills/history")
async def get_bill_history(limit: int = 50):
    """Get bill payment history"""
    return bill_manager.get_payment_history(limit)

@app.get("/api/v1/bills/stats")
async def get_bill_stats():
    """Get bill payment statistics"""
    return bill_manager.get_statistics()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8073)
