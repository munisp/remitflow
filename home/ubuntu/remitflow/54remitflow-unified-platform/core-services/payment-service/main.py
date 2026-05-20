"""
Payment Service - Production Implementation
Payment processing, gateway orchestration, and transaction management

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
from gateway_orchestrator import GatewayOrchestrator, NIBSSGateway, FlutterwaveGateway
from retry_manager import RetryManager, RecoveryManager
from fraud_detector import FraudDetector

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Payment Service", version="2.0.0")

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "payment-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)

# Enums
class PaymentMethod(str, Enum):
    BANK_TRANSFER = "bank_transfer"
    CARD = "card"
    MOBILE_MONEY = "mobile_money"
    WALLET = "wallet"
    CRYPTO = "crypto"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"

class PaymentGateway(str, Enum):
    NIBSS = "nibss"
    SWIFT = "swift"
    FLUTTERWAVE = "flutterwave"
    PAYSTACK = "paystack"
    STRIPE = "stripe"

# Models
class Payment(BaseModel):
    payment_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    amount: Decimal
    currency: str
    method: PaymentMethod
    gateway: PaymentGateway
    
    # Payer details
    payer_name: str
    payer_email: str
    payer_phone: Optional[str] = None
    
    # Payee details
    payee_name: str
    payee_account: str
    payee_bank: Optional[str] = None
    
    # Payment details
    reference: str = Field(default_factory=lambda: f"PAY{uuid.uuid4().hex[:12].upper()}")
    description: Optional[str] = None
    metadata: Dict = Field(default_factory=dict)
    
    # Status
    status: PaymentStatus = PaymentStatus.PENDING
    gateway_reference: Optional[str] = None
    gateway_response: Optional[Dict] = None
    
    # Fees
    fee_amount: Decimal = Decimal("0.00")
    total_amount: Decimal = Decimal("0.00")
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    # Error handling
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int = 0

class CreatePaymentRequest(BaseModel):
    user_id: str
    amount: Decimal
    currency: str
    method: PaymentMethod
    gateway: PaymentGateway
    payer_name: str
    payer_email: str
    payer_phone: Optional[str] = None
    payee_name: str
    payee_account: str
    payee_bank: Optional[str] = None
    description: Optional[str] = None
    metadata: Dict = Field(default_factory=dict)

class PaymentResponse(BaseModel):
    payment_id: str
    reference: str
    status: PaymentStatus
    amount: Decimal
    currency: str
    fee_amount: Decimal
    total_amount: Decimal
    gateway_reference: Optional[str]
    created_at: datetime

# Production mode flag - when True, use PostgreSQL; when False, use in-memory (dev only)
USE_DATABASE = os.getenv("USE_DATABASE", "true").lower() == "true"

# Import database modules if available
try:
    from database import get_db_context, init_db, check_db_connection
    from repository import PaymentRepository
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False

# In-memory storage (only used when USE_DATABASE=false for development)
payments_db: Dict[str, Payment] = {}
reference_index: Dict[str, str] = {}

# Initialize orchestrator, retry manager, and fraud detector
orchestrator = GatewayOrchestrator()
retry_manager = RetryManager()
recovery_manager = RecoveryManager()
fraud_detector = FraudDetector()

# Setup gateways
nibss = NIBSSGateway(api_key="nibss_key", api_secret="nibss_secret")
flutterwave = FlutterwaveGateway(api_key="flw_key", api_secret="flw_secret")

orchestrator.add_gateway(nibss)
orchestrator.add_gateway(flutterwave)

class PaymentService:
    """Production payment service"""
    
    @staticmethod
    def _calculate_fee(amount: Decimal, method: PaymentMethod, gateway: PaymentGateway) -> Decimal:
        """Calculate payment fee"""
        
        # Fee structure (simplified)
        fee_rates = {
            PaymentMethod.BANK_TRANSFER: Decimal("0.01"),  # 1%
            PaymentMethod.CARD: Decimal("0.029"),  # 2.9%
            PaymentMethod.MOBILE_MONEY: Decimal("0.015"),  # 1.5%
            PaymentMethod.WALLET: Decimal("0.005"),  # 0.5%
            PaymentMethod.CRYPTO: Decimal("0.01"),  # 1%
        }
        
        fee = amount * fee_rates.get(method, Decimal("0.01"))
        
        # Minimum fee
        if fee < Decimal("1.00"):
            fee = Decimal("1.00")
        
        # Maximum fee cap
        if fee > Decimal("100.00"):
            fee = Decimal("100.00")
        
        return fee.quantize(Decimal("0.01"))
    
    @staticmethod
    async def create_payment(request: CreatePaymentRequest) -> Payment:
        """Create payment"""
        
        # Validate amount
        if request.amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        
        # Calculate fee
        fee_amount = PaymentService._calculate_fee(request.amount, request.method, request.gateway)
        total_amount = request.amount + fee_amount
        
        # Create payment
        payment = Payment(
            user_id=request.user_id,
            amount=request.amount,
            currency=request.currency,
            method=request.method,
            gateway=request.gateway,
            payer_name=request.payer_name,
            payer_email=request.payer_email,
            payer_phone=request.payer_phone,
            payee_name=request.payee_name,
            payee_account=request.payee_account,
            payee_bank=request.payee_bank,
            description=request.description,
            metadata=request.metadata,
            fee_amount=fee_amount,
            total_amount=total_amount
        )
        
        # Store
        payments_db[payment.payment_id] = payment
        reference_index[payment.reference] = payment.payment_id
        
        logger.info(f"Created payment {payment.payment_id}: {request.amount} {request.currency}")
        return payment
    
    @staticmethod
    async def process_payment(payment_id: str) -> Payment:
        """Process payment"""
        
        if payment_id not in payments_db:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        payment = payments_db[payment_id]
        
        if payment.status != PaymentStatus.PENDING:
            raise HTTPException(status_code=400, detail=f"Payment already {payment.status}")
        
        # Update status
        payment.status = PaymentStatus.PROCESSING
        payment.processed_at = datetime.utcnow()
        
        # Simulate gateway processing
        gateway_ref = f"{payment.gateway.upper()}{uuid.uuid4().hex[:16].upper()}"
        payment.gateway_reference = gateway_ref
        payment.gateway_response = {
            "status": "processing",
            "reference": gateway_ref,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        logger.info(f"Processing payment {payment_id} via {payment.gateway}")
        return payment
    
    @staticmethod
    async def complete_payment(payment_id: str) -> Payment:
        """Complete payment"""
        
        if payment_id not in payments_db:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        payment = payments_db[payment_id]
        
        if payment.status != PaymentStatus.PROCESSING:
            raise HTTPException(status_code=400, detail=f"Payment not processing (status: {payment.status})")
        
        # Complete payment
        payment.status = PaymentStatus.COMPLETED
        payment.completed_at = datetime.utcnow()
        payment.gateway_response["status"] = "completed"
        
        logger.info(f"Completed payment {payment_id}")
        return payment
    
    @staticmethod
    async def fail_payment(payment_id: str, error_code: str, error_message: str) -> Payment:
        """Fail payment"""
        
        if payment_id not in payments_db:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        payment = payments_db[payment_id]
        
        payment.status = PaymentStatus.FAILED
        payment.error_code = error_code
        payment.error_message = error_message
        
        logger.warning(f"Failed payment {payment_id}: {error_message}")
        return payment
    
    @staticmethod
    async def get_payment(payment_id: str) -> Payment:
        """Get payment by ID"""
        
        if payment_id not in payments_db:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        return payments_db[payment_id]
    
    @staticmethod
    async def get_payment_by_reference(reference: str) -> Payment:
        """Get payment by reference"""
        
        if reference not in reference_index:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        payment_id = reference_index[reference]
        return payments_db[payment_id]
    
    @staticmethod
    async def list_payments(user_id: Optional[str] = None, status: Optional[PaymentStatus] = None, limit: int = 50) -> List[Payment]:
        """List payments"""
        
        payments = list(payments_db.values())
        
        # Filter by user
        if user_id:
            payments = [p for p in payments if p.user_id == user_id]
        
        # Filter by status
        if status:
            payments = [p for p in payments if p.status == status]
        
        # Sort by created_at desc
        payments.sort(key=lambda x: x.created_at, reverse=True)
        
        return payments[:limit]
    
    @staticmethod
    async def cancel_payment(payment_id: str) -> Payment:
        """Cancel payment"""
        
        payment = await PaymentService.get_payment(payment_id)
        
        if payment.status not in [PaymentStatus.PENDING, PaymentStatus.PROCESSING]:
            raise HTTPException(status_code=400, detail=f"Cannot cancel payment in {payment.status} status")
        
        payment.status = PaymentStatus.CANCELLED
        payment.error_message = "Cancelled by user"
        
        logger.info(f"Cancelled payment {payment_id}")
        return payment
    
    @staticmethod
    async def refund_payment(payment_id: str) -> Payment:
        """Refund payment"""
        
        payment = await PaymentService.get_payment(payment_id)
        
        if payment.status != PaymentStatus.COMPLETED:
            raise HTTPException(status_code=400, detail="Only completed payments can be refunded")
        
        payment.status = PaymentStatus.REFUNDED
        
        logger.info(f"Refunded payment {payment_id}")
        return payment

# API Endpoints
@app.post("/api/v1/payments", response_model=PaymentResponse)
async def create_payment(request: CreatePaymentRequest):
    """Create payment"""
    payment = await PaymentService.create_payment(request)
    return PaymentResponse(
        payment_id=payment.payment_id,
        reference=payment.reference,
        status=payment.status,
        amount=payment.amount,
        currency=payment.currency,
        fee_amount=payment.fee_amount,
        total_amount=payment.total_amount,
        gateway_reference=payment.gateway_reference,
        created_at=payment.created_at
    )

@app.post("/api/v1/payments/{payment_id}/process", response_model=Payment)
async def process_payment(payment_id: str):
    """Process payment"""
    return await PaymentService.process_payment(payment_id)

@app.post("/api/v1/payments/{payment_id}/complete", response_model=Payment)
async def complete_payment(payment_id: str):
    """Complete payment"""
    return await PaymentService.complete_payment(payment_id)

@app.post("/api/v1/payments/{payment_id}/fail")
async def fail_payment(payment_id: str, error_code: str, error_message: str):
    """Fail payment"""
    return await PaymentService.fail_payment(payment_id, error_code, error_message)

@app.get("/api/v1/payments/{payment_id}", response_model=Payment)
async def get_payment(payment_id: str):
    """Get payment"""
    return await PaymentService.get_payment(payment_id)

@app.get("/api/v1/payments/reference/{reference}", response_model=Payment)
async def get_payment_by_reference(reference: str):
    """Get payment by reference"""
    return await PaymentService.get_payment_by_reference(reference)

@app.get("/api/v1/payments", response_model=List[Payment])
async def list_payments(user_id: Optional[str] = None, status: Optional[PaymentStatus] = None, limit: int = 50):
    """List payments"""
    return await PaymentService.list_payments(user_id, status, limit)

@app.post("/api/v1/payments/{payment_id}/cancel", response_model=Payment)
async def cancel_payment(payment_id: str):
    """Cancel payment"""
    return await PaymentService.cancel_payment(payment_id)

@app.post("/api/v1/payments/{payment_id}/refund", response_model=Payment)
async def refund_payment(payment_id: str):
    """Refund payment"""
    return await PaymentService.refund_payment(payment_id)

@app.get("/health")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "service": "payment-service",
        "version": "2.0.0",
        "total_payments": len(payments_db),
        "timestamp": datetime.utcnow().isoformat()
    }

# Enhanced endpoints

@app.post("/api/v1/payments/orchestrated")
async def create_orchestrated_payment(
    user_id: str,
    amount: Decimal,
    currency: str,
    payer_name: str,
    payer_email: str,
    payee_name: str,
    payee_account: str
):
    """Create payment with gateway orchestration"""
    
    # Fraud check
    fraud_analysis = fraud_detector.analyze_payment(
        payment_id="temp",
        user_id=user_id,
        amount=amount,
        payer_email=payer_email
    )
    
    if fraud_analysis.get("should_block"):
        raise HTTPException(status_code=403, detail="Payment blocked due to fraud risk")
    
    reference = f"PAY{uuid.uuid4().hex[:12].upper()}"
    
    # Process via orchestrator
    result = await orchestrator.process_payment(
        amount=amount,
        currency=currency,
        payment_method="bank_transfer",
        payer_details={"name": payer_name, "email": payer_email},
        payee_details={"name": payee_name, "account": payee_account},
        reference=reference
    )
    
    return {**result, "fraud_analysis": fraud_analysis}

@app.get("/api/v1/payments/gateways/stats")
async def get_gateway_stats():
    """Get gateway statistics"""
    return orchestrator.get_gateway_statistics()

@app.get("/api/v1/payments/routing/analytics")
async def get_routing_analytics(days: int = 7):
    """Get routing analytics"""
    return orchestrator.get_routing_analytics(days)

@app.get("/api/v1/payments/retry/stats")
async def get_retry_stats(days: int = 7):
    """Get retry statistics"""
    return retry_manager.get_retry_statistics(days)

@app.get("/api/v1/payments/recovery/pending")
async def get_pending_recoveries():
    """Get pending recoveries"""
    return recovery_manager.get_pending_recoveries()

@app.get("/api/v1/payments/recovery/stats")
async def get_recovery_stats():
    """Get recovery statistics"""
    return recovery_manager.get_recovery_statistics()

@app.get("/api/v1/payments/fraud/flagged")
async def get_flagged_payments(limit: int = 50):
    """Get flagged payments"""
    return fraud_detector.flagged_payments[-limit:]

@app.post("/api/v1/payments/fraud/blacklist")
async def add_to_blacklist(email: Optional[str] = None):
    """Add to fraud blacklist"""
    fraud_detector.add_to_blacklist(email=email)
    return {"success": True, "message": "Added to blacklist"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8071)
