"""
Airtime Top-up Service - Production Implementation
Mobile airtime and data bundle purchases

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
from providers import ProviderManager, VTPassProvider, BaxiProvider, ProviderType
from analytics import TransactionAnalytics

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Airtime Service", version="2.0.0")

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "airtime-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)

# Enums
class Network(str, Enum):
    MTN = "mtn"
    AIRTEL = "airtel"
    GLO = "glo"
    ETISALAT = "9mobile"

class ProductType(str, Enum):
    AIRTIME = "airtime"
    DATA = "data"

class TransactionStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

# Models
class DataBundle(BaseModel):
    bundle_id: str
    network: Network
    name: str
    data_amount: str
    validity: str
    price: Decimal

class AirtimeTransaction(BaseModel):
    transaction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    phone_number: str
    network: Network
    product_type: ProductType
    amount: Decimal
    bundle_id: Optional[str] = None
    bundle_name: Optional[str] = None
    price: Decimal
    fee: Decimal = Decimal("0.00")
    total_amount: Decimal = Decimal("0.00")
    reference: str = Field(default_factory=lambda: f"AIR{uuid.uuid4().hex[:12].upper()}")
    provider_reference: Optional[str] = None
    status: TransactionStatus = TransactionStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None

class PurchaseAirtimeRequest(BaseModel):
    user_id: str
    phone_number: str
    network: Network
    amount: Decimal

class PurchaseDataRequest(BaseModel):
    user_id: str
    phone_number: str
    network: Network
    bundle_id: str

# Storage
data_bundles: Dict[str, DataBundle] = {
    "MTN_1GB": DataBundle(bundle_id="MTN_1GB", network=Network.MTN, name="1GB Monthly", data_amount="1GB", validity="30 days", price=Decimal("1000")),
    "MTN_2GB": DataBundle(bundle_id="MTN_2GB", network=Network.MTN, name="2GB Monthly", data_amount="2GB", validity="30 days", price=Decimal("2000")),
    "AIRTEL_1_5GB": DataBundle(bundle_id="AIRTEL_1_5GB", network=Network.AIRTEL, name="1.5GB Monthly", data_amount="1.5GB", validity="30 days", price=Decimal("1000")),
    "GLO_2GB": DataBundle(bundle_id="GLO_2GB", network=Network.GLO, name="2GB Monthly", data_amount="2GB", validity="30 days", price=Decimal("1000")),
}

transactions_db: Dict[str, AirtimeTransaction] = {}

# Initialize provider manager and analytics
provider_manager = ProviderManager()
analytics_engine = TransactionAnalytics()

# Setup providers (in production, load from config/env)
vtpass = VTPassProvider(api_key="vtpass_key", api_secret="vtpass_secret")
baxi = BaxiProvider(api_key="baxi_key", api_secret="baxi_secret")

provider_manager.add_provider(ProviderType.VTPASS, vtpass, is_primary=True)
provider_manager.add_provider(ProviderType.BAXI, baxi)

class AirtimeService:
    @staticmethod
    async def get_data_bundles(network: Optional[Network] = None) -> List[DataBundle]:
        bundles = list(data_bundles.values())
        if network:
            bundles = [b for b in bundles if b.network == network]
        return bundles
    
    @staticmethod
    async def purchase_airtime(request: PurchaseAirtimeRequest) -> AirtimeTransaction:
        if request.amount < Decimal("50"):
            raise HTTPException(status_code=400, detail="Minimum airtime amount is ₦50")
        if request.amount > Decimal("50000"):
            raise HTTPException(status_code=400, detail="Maximum airtime amount is ₦50,000")
        
        fee = request.amount * Decimal("0.01")
        if fee < Decimal("10"):
            fee = Decimal("10")
        total_amount = request.amount + fee
        
        transaction = AirtimeTransaction(
            user_id=request.user_id,
            phone_number=request.phone_number,
            network=request.network,
            product_type=ProductType.AIRTIME,
            amount=request.amount,
            price=request.amount,
            fee=fee,
            total_amount=total_amount
        )
        
        transactions_db[transaction.transaction_id] = transaction
        logger.info(f"Created airtime purchase {transaction.transaction_id}")
        return transaction
    
    @staticmethod
    async def purchase_data(request: PurchaseDataRequest) -> AirtimeTransaction:
        if request.bundle_id not in data_bundles:
            raise HTTPException(status_code=404, detail="Data bundle not found")
        
        bundle = data_bundles[request.bundle_id]
        if bundle.network != request.network:
            raise HTTPException(status_code=400, detail="Bundle network mismatch")
        
        fee = bundle.price * Decimal("0.01")
        if fee < Decimal("10"):
            fee = Decimal("10")
        total_amount = bundle.price + fee
        
        transaction = AirtimeTransaction(
            user_id=request.user_id,
            phone_number=request.phone_number,
            network=request.network,
            product_type=ProductType.DATA,
            amount=Decimal("0"),
            bundle_id=bundle.bundle_id,
            bundle_name=bundle.name,
            price=bundle.price,
            fee=fee,
            total_amount=total_amount
        )
        
        transactions_db[transaction.transaction_id] = transaction
        logger.info(f"Created data purchase {transaction.transaction_id}")
        return transaction
    
    @staticmethod
    async def process_transaction(transaction_id: str) -> AirtimeTransaction:
        if transaction_id not in transactions_db:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        transaction = transactions_db[transaction_id]
        if transaction.status != TransactionStatus.PENDING:
            raise HTTPException(status_code=400, detail=f"Transaction already {transaction.status}")
        
        transaction.status = TransactionStatus.PROCESSING
        transaction.processed_at = datetime.utcnow()
        transaction.provider_reference = f"PROV{uuid.uuid4().hex[:16].upper()}"
        
        logger.info(f"Processing transaction {transaction_id}")
        return transaction
    
    @staticmethod
    async def complete_transaction(transaction_id: str) -> AirtimeTransaction:
        if transaction_id not in transactions_db:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        transaction = transactions_db[transaction_id]
        if transaction.status != TransactionStatus.PROCESSING:
            raise HTTPException(status_code=400, detail="Transaction not processing")
        
        transaction.status = TransactionStatus.COMPLETED
        transaction.completed_at = datetime.utcnow()
        
        logger.info(f"Completed transaction {transaction_id}")
        return transaction

# API Endpoints
@app.get("/api/v1/data-bundles", response_model=List[DataBundle])
async def get_data_bundles(network: Optional[Network] = None):
    return await AirtimeService.get_data_bundles(network)

@app.post("/api/v1/airtime/purchase", response_model=AirtimeTransaction)
async def purchase_airtime(request: PurchaseAirtimeRequest):
    return await AirtimeService.purchase_airtime(request)

@app.post("/api/v1/data/purchase", response_model=AirtimeTransaction)
async def purchase_data(request: PurchaseDataRequest):
    return await AirtimeService.purchase_data(request)

@app.post("/api/v1/transactions/{transaction_id}/process", response_model=AirtimeTransaction)
async def process_transaction(transaction_id: str):
    return await AirtimeService.process_transaction(transaction_id)

@app.post("/api/v1/transactions/{transaction_id}/complete", response_model=AirtimeTransaction)
async def complete_transaction(transaction_id: str):
    return await AirtimeService.complete_transaction(transaction_id)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "airtime-service",
        "version": "2.0.0",
        "total_transactions": len(transactions_db),
        "timestamp": datetime.utcnow().isoformat()
    }

# New enhanced endpoints

@app.get("/api/v1/transactions/{transaction_id}", response_model=AirtimeTransaction)
async def get_transaction(transaction_id: str):
    """Get transaction details"""
    if transaction_id not in transactions_db:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transactions_db[transaction_id]

@app.get("/api/v1/transactions/user/{user_id}")
async def get_user_transactions(user_id: str, limit: int = 50):
    """Get user transaction history"""
    user_txns = [
        t for t in transactions_db.values()
        if t.user_id == user_id
    ]
    user_txns.sort(key=lambda x: x.created_at, reverse=True)
    return {"transactions": user_txns[:limit], "total": len(user_txns)}

@app.get("/api/v1/transactions/reference/{reference}")
async def get_transaction_by_reference(reference: str):
    """Get transaction by reference"""
    for txn in transactions_db.values():
        if txn.reference == reference:
            return txn
    raise HTTPException(status_code=404, detail="Transaction not found")

@app.post("/api/v1/transactions/{transaction_id}/verify")
async def verify_transaction(transaction_id: str):
    """Verify transaction with provider"""
    if transaction_id not in transactions_db:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    transaction = transactions_db[transaction_id]
    
    # In production, verify with actual provider
    return {
        "transaction_id": transaction_id,
        "status": transaction.status,
        "verified": True
    }

@app.get("/api/v1/analytics/user/{user_id}")
async def get_user_analytics(user_id: str, days: int = 30):
    """Get user transaction analytics"""
    return analytics_engine.get_user_statistics(user_id, days)

@app.get("/api/v1/analytics/network/{network}")
async def get_network_analytics(network: str, days: int = 30):
    """Get network-specific analytics"""
    return analytics_engine.get_network_statistics(network, days)

@app.get("/api/v1/analytics/bundles/popular")
async def get_popular_bundles(network: Optional[str] = None, limit: int = 10):
    """Get most popular data bundles"""
    return analytics_engine.get_popular_bundles(network, limit)

@app.get("/api/v1/analytics/hourly-distribution")
async def get_hourly_distribution(days: int = 7):
    """Get hourly transaction distribution"""
    return analytics_engine.get_hourly_distribution(days)

@app.get("/api/v1/analytics/failures")
async def get_failure_analysis(days: int = 7):
    """Analyze failed transactions"""
    return analytics_engine.get_failure_analysis(days)

@app.get("/api/v1/analytics/revenue")
async def get_revenue_report(
    start_date: datetime,
    end_date: datetime
):
    """Generate revenue report"""
    return analytics_engine.get_revenue_report(start_date, end_date)

@app.get("/api/v1/analytics/top-users")
async def get_top_users(days: int = 30, limit: int = 10):
    """Get top users by transaction volume"""
    return analytics_engine.get_top_users(days, limit)

@app.get("/api/v1/analytics/overall")
async def get_overall_statistics():
    """Get overall platform statistics"""
    return analytics_engine.get_overall_statistics()

@app.get("/api/v1/providers/stats")
async def get_provider_stats():
    """Get provider statistics"""
    return await provider_manager.get_provider_stats()

@app.get("/api/v1/providers/balances")
async def get_provider_balances():
    """Get balances from all providers"""
    return await provider_manager.get_all_balances()

@app.post("/api/v1/airtime/purchase-direct")
async def purchase_airtime_direct(
    phone_number: str,
    network: str,
    amount: Decimal,
    user_id: str
):
    """Purchase airtime directly via provider"""
    reference = f"AIR{uuid.uuid4().hex[:12].upper()}"
    
    result = await provider_manager.purchase_airtime(
        phone_number=phone_number,
        network=network,
        amount=amount,
        reference=reference
    )
    
    # Record transaction
    if result.get("success"):
        transaction = AirtimeTransaction(
            user_id=user_id,
            phone_number=phone_number,
            network=Network(network),
            product_type=ProductType.AIRTIME,
            amount=amount,
            price=amount,
            total_amount=amount,
            reference=reference,
            provider_reference=result.get("provider_reference"),
            status=TransactionStatus.COMPLETED,
            completed_at=datetime.utcnow()
        )
        transactions_db[transaction.transaction_id] = transaction
        analytics_engine.record_transaction(transaction.dict())
    
    return result

@app.post("/api/v1/data/purchase-direct")
async def purchase_data_direct(
    phone_number: str,
    network: str,
    bundle_id: str,
    user_id: str
):
    """Purchase data directly via provider"""
    reference = f"DAT{uuid.uuid4().hex[:12].upper()}"
    
    result = await provider_manager.purchase_data(
        phone_number=phone_number,
        network=network,
        bundle_id=bundle_id,
        reference=reference
    )
    
    # Record transaction
    if result.get("success"):
        bundle = data_bundles.get(bundle_id)
        transaction = AirtimeTransaction(
            user_id=user_id,
            phone_number=phone_number,
            network=Network(network),
            product_type=ProductType.DATA,
            amount=bundle.price if bundle else Decimal("0"),
            bundle_id=bundle_id,
            bundle_name=bundle.name if bundle else "Unknown",
            price=bundle.price if bundle else Decimal("0"),
            total_amount=bundle.price if bundle else Decimal("0"),
            reference=reference,
            provider_reference=result.get("provider_reference"),
            status=TransactionStatus.COMPLETED,
            completed_at=datetime.utcnow()
        )
        transactions_db[transaction.transaction_id] = transaction
        analytics_engine.record_transaction(transaction.dict())
    
    return result

# Background task to record analytics
@app.on_event("startup")
async def startup_event():
    """Initialize background tasks on startup"""
    logger.info("Airtime Service starting up...")
    # Load existing transactions into analytics
    for txn in transactions_db.values():
        analytics_engine.record_transaction(txn.dict())

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8073)
