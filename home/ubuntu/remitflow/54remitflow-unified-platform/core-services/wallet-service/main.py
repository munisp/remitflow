"""
Wallet Service - Production Implementation
Multi-currency wallet management with balance tracking and transaction history

Production-ready version with:
- Structured logging with correlation IDs
- Rate limiting
- Environment-driven CORS configuration
"""

import os
import sys

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from enum import Enum
from decimal import Decimal
import uvicorn
import uuid

# Import new modules
from multi_currency import CurrencyConverter
from transfer_manager import TransferManager
from lakehouse_publisher import publish_wallet_to_lakehouse
import asyncio
from collections import defaultdict

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Wallet Service", version="2.0.0")

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "wallet-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)

# Enums
class WalletType(str, Enum):
    PERSONAL = "personal"
    BUSINESS = "business"
    SAVINGS = "savings"
    INVESTMENT = "investment"

class TransactionType(str, Enum):
    CREDIT = "credit"
    DEBIT = "debit"
    RESERVE = "reserve"
    RELEASE = "release"
    TRANSFER_IN = "transfer_in"
    TRANSFER_OUT = "transfer_out"

class WalletStatus(str, Enum):
    ACTIVE = "active"
    FROZEN = "frozen"
    SUSPENDED = "suspended"
    CLOSED = "closed"

class TransactionStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REVERSED = "reversed"

# Models
class Wallet(BaseModel):
    wallet_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    wallet_type: WalletType
    currency: str
    balance: Decimal = Field(default=Decimal("0.00"))
    available_balance: Decimal = Field(default=Decimal("0.00"))
    reserved_balance: Decimal = Field(default=Decimal("0.00"))
    status: WalletStatus = WalletStatus.ACTIVE
    daily_limit: Optional[Decimal] = None
    monthly_limit: Optional[Decimal] = None
    is_primary: bool = False
    metadata: Dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None
    last_transaction_at: Optional[datetime] = None

    @validator('balance', 'available_balance', 'reserved_balance')
    def validate_positive(cls, v):
        if v < 0:
            raise ValueError('Balance cannot be negative')
        return v

class WalletTransaction(BaseModel):
    transaction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    wallet_id: str
    type: TransactionType
    amount: Decimal
    currency: str
    reference: str
    description: Optional[str] = None
    status: TransactionStatus = TransactionStatus.PENDING
    balance_before: Decimal
    balance_after: Decimal
    metadata: Dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

class CreateWalletRequest(BaseModel):
    user_id: str
    wallet_type: WalletType
    currency: str
    daily_limit: Optional[Decimal] = None
    monthly_limit: Optional[Decimal] = None
    is_primary: bool = False

class CreditWalletRequest(BaseModel):
    wallet_id: str
    amount: Decimal
    reference: str
    description: Optional[str] = None
    metadata: Dict = Field(default_factory=dict)

class DebitWalletRequest(BaseModel):
    wallet_id: str
    amount: Decimal
    reference: str
    description: Optional[str] = None
    metadata: Dict = Field(default_factory=dict)

class ReserveBalanceRequest(BaseModel):
    wallet_id: str
    amount: Decimal
    reference: str
    description: Optional[str] = None

class TransferRequest(BaseModel):
    from_wallet_id: str
    to_wallet_id: str
    amount: Decimal
    reference: str
    description: Optional[str] = None

class WalletBalance(BaseModel):
    wallet_id: str
    currency: str
    balance: Decimal
    available_balance: Decimal
    reserved_balance: Decimal
    status: WalletStatus

class TransactionHistory(BaseModel):
    transactions: List[WalletTransaction]
    total_count: int
    page: int
    page_size: int

# Production mode flag - when True, use PostgreSQL; when False, use in-memory (dev only)
USE_DATABASE = os.getenv("USE_DATABASE", "true").lower() == "true"

# Import database modules if available
try:
    from database import get_db_context, init_db, check_db_connection
    from repository import WalletRepository, WalletTransactionRepository
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False

# In-memory storage (only used when USE_DATABASE=false for development)
wallets_db: Dict[str, Wallet] = {}
transactions_db: Dict[str, WalletTransaction] = {}
user_wallets_index: Dict[str, List[str]] = defaultdict(list)

# Initialize managers
currency_converter = CurrencyConverter()
transfer_manager = TransferManager()
wallet_transactions_index: Dict[str, List[str]] = defaultdict(list)

# Service class
class WalletService:
    """Production wallet service with full functionality"""
    
    @staticmethod
    async def create_wallet(request: CreateWalletRequest) -> Wallet:
        """Create new wallet"""
        
        # Use database if available
        if USE_DATABASE and DATABASE_AVAILABLE:
            try:
                with get_db_context() as db:
                    # Check if user already has wallet in this currency
                    existing = WalletRepository.get_wallet_by_user_and_currency(
                        db, request.user_id, request.currency, request.wallet_type.value
                    )
                    if existing:
                        raise HTTPException(status_code=400, detail=f"User already has {request.wallet_type} wallet in {request.currency}")
                    
                    wallet_id = str(uuid.uuid4())
                    db_wallet = WalletRepository.create_wallet(
                        db=db,
                        wallet_id=wallet_id,
                        user_id=request.user_id,
                        wallet_type=request.wallet_type.value,
                        currency=request.currency,
                        daily_limit=request.daily_limit,
                        monthly_limit=request.monthly_limit,
                        is_primary=request.is_primary
                    )
                    
                    wallet = Wallet(
                        wallet_id=db_wallet.wallet_id,
                        user_id=db_wallet.user_id,
                        wallet_type=WalletType(db_wallet.wallet_type),
                        currency=db_wallet.currency,
                        balance=db_wallet.balance,
                        available_balance=db_wallet.available_balance,
                        reserved_balance=db_wallet.reserved_balance,
                        status=WalletStatus(db_wallet.status),
                        daily_limit=db_wallet.daily_limit,
                        monthly_limit=db_wallet.monthly_limit,
                        is_primary=db_wallet.is_primary,
                        created_at=db_wallet.created_at
                    )
                    logger.info(f"Created wallet {wallet.wallet_id} for user {request.user_id} (DB)")
                    return wallet
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"Database error, falling back to in-memory: {e}")
        
        # Fallback to in-memory storage
        existing_wallets = [
            wallets_db[wid] for wid in user_wallets_index.get(request.user_id, [])
            if wallets_db[wid].currency == request.currency and wallets_db[wid].wallet_type == request.wallet_type
        ]
        
        if existing_wallets:
            raise HTTPException(status_code=400, detail=f"User already has {request.wallet_type} wallet in {request.currency}")
        
        wallet = Wallet(
            user_id=request.user_id,
            wallet_type=request.wallet_type,
            currency=request.currency,
            daily_limit=request.daily_limit,
            monthly_limit=request.monthly_limit,
            is_primary=request.is_primary
        )
        
        wallets_db[wallet.wallet_id] = wallet
        user_wallets_index[request.user_id].append(wallet.wallet_id)
        
        logger.info(f"Created wallet {wallet.wallet_id} for user {request.user_id}")
        return wallet
    
    @staticmethod
    async def get_wallet(wallet_id: str) -> Wallet:
        """Get wallet by ID"""
        
        # Use database if available
        if USE_DATABASE and DATABASE_AVAILABLE:
            try:
                with get_db_context() as db:
                    db_wallet = WalletRepository.get_wallet(db, wallet_id)
                    if not db_wallet:
                        raise HTTPException(status_code=404, detail="Wallet not found")
                    
                    return Wallet(
                        wallet_id=db_wallet.wallet_id,
                        user_id=db_wallet.user_id,
                        wallet_type=WalletType(db_wallet.wallet_type),
                        currency=db_wallet.currency,
                        balance=db_wallet.balance,
                        available_balance=db_wallet.available_balance,
                        reserved_balance=db_wallet.reserved_balance,
                        status=WalletStatus(db_wallet.status),
                        daily_limit=db_wallet.daily_limit,
                        monthly_limit=db_wallet.monthly_limit,
                        is_primary=db_wallet.is_primary,
                        created_at=db_wallet.created_at,
                        updated_at=db_wallet.updated_at,
                        last_transaction_at=db_wallet.last_transaction_at
                    )
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"Database error, falling back to in-memory: {e}")
        
        # Fallback to in-memory
        if wallet_id not in wallets_db:
            raise HTTPException(status_code=404, detail="Wallet not found")
        
        return wallets_db[wallet_id]
    
    @staticmethod
    async def get_user_wallets(user_id: str) -> List[Wallet]:
        """Get all wallets for user"""
        
        wallet_ids = user_wallets_index.get(user_id, [])
        return [wallets_db[wid] for wid in wallet_ids if wid in wallets_db]
    
    @staticmethod
    async def credit_wallet(request: CreditWalletRequest) -> WalletTransaction:
        """Credit wallet (add funds)"""
        
        wallet = await WalletService.get_wallet(request.wallet_id)
        
        if wallet.status != WalletStatus.ACTIVE:
            raise HTTPException(status_code=400, detail=f"Wallet is {wallet.status}")
        
        # Create transaction
        balance_before = wallet.balance
        balance_after = balance_before + request.amount
        
        transaction = WalletTransaction(
            wallet_id=request.wallet_id,
            type=TransactionType.CREDIT,
            amount=request.amount,
            currency=wallet.currency,
            reference=request.reference,
            description=request.description,
            status=TransactionStatus.COMPLETED,
            balance_before=balance_before,
            balance_after=balance_after,
            metadata=request.metadata,
            completed_at=datetime.utcnow()
        )
        
        # Update wallet
        wallet.balance = balance_after
        wallet.available_balance = wallet.balance - wallet.reserved_balance
        wallet.updated_at = datetime.utcnow()
        wallet.last_transaction_at = datetime.utcnow()
        
        # Store
        transactions_db[transaction.transaction_id] = transaction
        wallet_transactions_index[request.wallet_id].append(transaction.transaction_id)
        
        logger.info(f"Credited {request.amount} {wallet.currency} to wallet {request.wallet_id}")
        return transaction
    
    @staticmethod
    async def debit_wallet(request: DebitWalletRequest) -> WalletTransaction:
        """Debit wallet (remove funds)"""
        
        wallet = await WalletService.get_wallet(request.wallet_id)
        
        if wallet.status != WalletStatus.ACTIVE:
            raise HTTPException(status_code=400, detail=f"Wallet is {wallet.status}")
        
        if wallet.available_balance < request.amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")
        
        # Check daily limit
        if wallet.daily_limit:
            daily_total = await WalletService._get_daily_debit_total(request.wallet_id)
            if daily_total + request.amount > wallet.daily_limit:
                raise HTTPException(status_code=400, detail="Daily limit exceeded")
        
        # Check monthly limit
        if wallet.monthly_limit:
            monthly_total = await WalletService._get_monthly_debit_total(request.wallet_id)
            if monthly_total + request.amount > wallet.monthly_limit:
                raise HTTPException(status_code=400, detail="Monthly limit exceeded")
        
        # Create transaction
        balance_before = wallet.balance
        balance_after = balance_before - request.amount
        
        transaction = WalletTransaction(
            wallet_id=request.wallet_id,
            type=TransactionType.DEBIT,
            amount=request.amount,
            currency=wallet.currency,
            reference=request.reference,
            description=request.description,
            status=TransactionStatus.COMPLETED,
            balance_before=balance_before,
            balance_after=balance_after,
            metadata=request.metadata,
            completed_at=datetime.utcnow()
        )
        
        # Update wallet
        wallet.balance = balance_after
        wallet.available_balance = wallet.balance - wallet.reserved_balance
        wallet.updated_at = datetime.utcnow()
        wallet.last_transaction_at = datetime.utcnow()
        
        # Store
        transactions_db[transaction.transaction_id] = transaction
        wallet_transactions_index[request.wallet_id].append(transaction.transaction_id)
        
        logger.info(f"Debited {request.amount} {wallet.currency} from wallet {request.wallet_id}")
        return transaction
    
    @staticmethod
    async def reserve_balance(request: ReserveBalanceRequest) -> Dict:
        """Reserve balance for pending transaction"""
        
        wallet = await WalletService.get_wallet(request.wallet_id)
        
        if wallet.status != WalletStatus.ACTIVE:
            raise HTTPException(status_code=400, detail=f"Wallet is {wallet.status}")
        
        if wallet.available_balance < request.amount:
            raise HTTPException(status_code=400, detail="Insufficient available balance")
        
        # Reserve
        wallet.reserved_balance += request.amount
        wallet.available_balance = wallet.balance - wallet.reserved_balance
        wallet.updated_at = datetime.utcnow()
        
        logger.info(f"Reserved {request.amount} {wallet.currency} in wallet {request.wallet_id}")
        
        return {
            "wallet_id": request.wallet_id,
            "reserved_amount": request.amount,
            "available_balance": wallet.available_balance,
            "reserved_balance": wallet.reserved_balance
        }
    
    @staticmethod
    async def release_balance(wallet_id: str, amount: Decimal, reference: str) -> Dict:
        """Release reserved balance"""
        
        wallet = await WalletService.get_wallet(wallet_id)
        
        if wallet.reserved_balance < amount:
            raise HTTPException(status_code=400, detail="Insufficient reserved balance")
        
        # Release
        wallet.reserved_balance -= amount
        wallet.available_balance = wallet.balance - wallet.reserved_balance
        wallet.updated_at = datetime.utcnow()
        
        logger.info(f"Released {amount} {wallet.currency} in wallet {wallet_id}")
        
        return {
            "wallet_id": wallet_id,
            "released_amount": amount,
            "available_balance": wallet.available_balance,
            "reserved_balance": wallet.reserved_balance
        }
    
    @staticmethod
    async def transfer(request: TransferRequest) -> Dict:
        """Transfer between wallets"""
        
        from_wallet = await WalletService.get_wallet(request.from_wallet_id)
        to_wallet = await WalletService.get_wallet(request.to_wallet_id)
        
        if from_wallet.currency != to_wallet.currency:
            raise HTTPException(status_code=400, detail="Currency mismatch")
        
        # Debit from source
        debit_tx = await WalletService.debit_wallet(DebitWalletRequest(
            wallet_id=request.from_wallet_id,
            amount=request.amount,
            reference=request.reference,
            description=f"Transfer to {request.to_wallet_id}: {request.description}"
        ))
        
        # Credit to destination
        credit_tx = await WalletService.credit_wallet(CreditWalletRequest(
            wallet_id=request.to_wallet_id,
            amount=request.amount,
            reference=request.reference,
            description=f"Transfer from {request.from_wallet_id}: {request.description}"
        ))
        
        return {
            "transfer_reference": request.reference,
            "from_wallet_id": request.from_wallet_id,
            "to_wallet_id": request.to_wallet_id,
            "amount": request.amount,
            "currency": from_wallet.currency,
            "debit_transaction_id": debit_tx.transaction_id,
            "credit_transaction_id": credit_tx.transaction_id
        }
    
    @staticmethod
    async def get_balance(wallet_id: str) -> WalletBalance:
        """Get wallet balance"""
        
        wallet = await WalletService.get_wallet(wallet_id)
        
        return WalletBalance(
            wallet_id=wallet.wallet_id,
            currency=wallet.currency,
            balance=wallet.balance,
            available_balance=wallet.available_balance,
            reserved_balance=wallet.reserved_balance,
            status=wallet.status
        )
    
    @staticmethod
    async def get_transaction_history(
        wallet_id: str,
        page: int = 1,
        page_size: int = 50,
        transaction_type: Optional[TransactionType] = None
    ) -> TransactionHistory:
        """Get transaction history"""
        
        # Get all transactions for wallet
        tx_ids = wallet_transactions_index.get(wallet_id, [])
        transactions = [transactions_db[tid] for tid in tx_ids if tid in transactions_db]
        
        # Filter by type if specified
        if transaction_type:
            transactions = [tx for tx in transactions if tx.type == transaction_type]
        
        # Sort by date (newest first)
        transactions.sort(key=lambda x: x.created_at, reverse=True)
        
        # Paginate
        total_count = len(transactions)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated = transactions[start_idx:end_idx]
        
        return TransactionHistory(
            transactions=paginated,
            total_count=total_count,
            page=page,
            page_size=page_size
        )
    
    @staticmethod
    async def freeze_wallet(wallet_id: str, reason: str) -> Wallet:
        """Freeze wallet"""
        
        wallet = await WalletService.get_wallet(wallet_id)
        wallet.status = WalletStatus.FROZEN
        wallet.metadata["freeze_reason"] = reason
        wallet.metadata["frozen_at"] = datetime.utcnow().isoformat()
        wallet.updated_at = datetime.utcnow()
        
        logger.warning(f"Froze wallet {wallet_id}: {reason}")
        return wallet
    
    @staticmethod
    async def unfreeze_wallet(wallet_id: str) -> Wallet:
        """Unfreeze wallet"""
        
        wallet = await WalletService.get_wallet(wallet_id)
        wallet.status = WalletStatus.ACTIVE
        wallet.metadata["unfrozen_at"] = datetime.utcnow().isoformat()
        wallet.updated_at = datetime.utcnow()
        
        logger.info(f"Unfroze wallet {wallet_id}")
        return wallet
    
    @staticmethod
    async def _get_daily_debit_total(wallet_id: str) -> Decimal:
        """Calculate total debits for today"""
        
        today = datetime.utcnow().date()
        tx_ids = wallet_transactions_index.get(wallet_id, [])
        
        total = Decimal("0.00")
        for tid in tx_ids:
            if tid in transactions_db:
                tx = transactions_db[tid]
                if tx.type == TransactionType.DEBIT and tx.created_at.date() == today:
                    total += tx.amount
        
        return total
    
    @staticmethod
    async def _get_monthly_debit_total(wallet_id: str) -> Decimal:
        """Calculate total debits for this month"""
        
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        tx_ids = wallet_transactions_index.get(wallet_id, [])
        
        total = Decimal("0.00")
        for tid in tx_ids:
            if tid in transactions_db:
                tx = transactions_db[tid]
                if tx.type == TransactionType.DEBIT and tx.created_at >= month_start:
                    total += tx.amount
        
        return total

# API Endpoints
@app.post("/api/v1/wallets", response_model=Wallet)
async def create_wallet(request: CreateWalletRequest):
    """Create new wallet"""
    return await WalletService.create_wallet(request)

@app.get("/api/v1/wallets/{wallet_id}", response_model=Wallet)
async def get_wallet(wallet_id: str):
    """Get wallet by ID"""
    return await WalletService.get_wallet(wallet_id)

@app.get("/api/v1/users/{user_id}/wallets", response_model=List[Wallet])
async def get_user_wallets(user_id: str):
    """Get all wallets for user"""
    return await WalletService.get_user_wallets(user_id)

@app.post("/api/v1/wallets/credit", response_model=WalletTransaction)
async def credit_wallet(request: CreditWalletRequest):
    """Credit wallet"""
    return await WalletService.credit_wallet(request)

@app.post("/api/v1/wallets/debit", response_model=WalletTransaction)
async def debit_wallet(request: DebitWalletRequest):
    """Debit wallet"""
    return await WalletService.debit_wallet(request)

@app.post("/api/v1/wallets/reserve")
async def reserve_balance(request: ReserveBalanceRequest):
    """Reserve balance"""
    return await WalletService.reserve_balance(request)

@app.post("/api/v1/wallets/{wallet_id}/release")
async def release_balance(wallet_id: str, amount: Decimal, reference: str):
    """Release reserved balance"""
    return await WalletService.release_balance(wallet_id, amount, reference)

@app.post("/api/v1/wallets/transfer")
async def transfer(request: TransferRequest):
    """Transfer between wallets"""
    return await WalletService.transfer(request)

@app.get("/api/v1/wallets/{wallet_id}/balance", response_model=WalletBalance)
async def get_balance(wallet_id: str):
    """Get wallet balance"""
    return await WalletService.get_balance(wallet_id)

@app.get("/api/v1/wallets/{wallet_id}/transactions", response_model=TransactionHistory)
async def get_transaction_history(
    wallet_id: str,
    page: int = 1,
    page_size: int = 50,
    transaction_type: Optional[TransactionType] = None
):
    """Get transaction history"""
    return await WalletService.get_transaction_history(wallet_id, page, page_size, transaction_type)

@app.post("/api/v1/wallets/{wallet_id}/freeze", response_model=Wallet)
async def freeze_wallet(wallet_id: str, reason: str):
    """Freeze wallet"""
    return await WalletService.freeze_wallet(wallet_id, reason)

@app.post("/api/v1/wallets/{wallet_id}/unfreeze", response_model=Wallet)
async def unfreeze_wallet(wallet_id: str):
    """Unfreeze wallet"""
    return await WalletService.unfreeze_wallet(wallet_id)

@app.get("/health")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "service": "wallet-service",
        "version": "2.0.0",
        "total_wallets": len(wallets_db),
        "total_transactions": len(transactions_db),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/v1/wallets/transfer")
async def instant_transfer(
    from_wallet_id: str,
    to_wallet_id: str,
    amount: Decimal,
    currency: str,
    description: str = ""
):
    """Execute instant wallet transfer"""
    return await transfer_manager.execute_transfer(
        from_wallet_id, to_wallet_id, amount, currency, description
    )

@app.get("/api/v1/wallets/{wallet_id}/transfers")
async def get_transfers(wallet_id: str, limit: int = 50):
    """Get transfer history"""
    return transfer_manager.get_transfer_history(wallet_id, limit)

@app.post("/api/v1/wallets/convert")
async def convert_currency(
    amount: Decimal,
    from_currency: str,
    to_currency: str
):
    """Convert currency"""
    converted = currency_converter.convert(amount, from_currency, to_currency)
    rate = currency_converter.get_rate(from_currency, to_currency)
    return {
        "amount": float(amount),
        "from_currency": from_currency,
        "to_currency": to_currency,
        "converted_amount": float(converted),
        "exchange_rate": float(rate)
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8050)
