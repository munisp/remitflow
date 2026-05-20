"""
Virtual Account Service - Production Implementation
Generate and manage virtual bank accounts for users

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
import random

# Import new modules
from account_providers import AccountProviderManager, WemaProvider, ProvidusProvider, ProviderType
from transaction_monitor import TransactionMonitor, TransactionType

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Virtual Account Service", version="2.0.0")

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "virtual-account-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)

# Enums
class AccountStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    CLOSED = "closed"

class Bank(str, Enum):
    WEMA = "wema"
    PROVIDUS = "providus"
    STERLING = "sterling"

# Models
class VirtualAccount(BaseModel):
    account_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    account_number: str
    account_name: str
    bank: Bank
    bank_name: str
    bvn: Optional[str] = None
    status: AccountStatus = AccountStatus.ACTIVE
    balance: Decimal = Decimal("0.00")
    currency: str = "NGN"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None

class CreateVirtualAccountRequest(BaseModel):
    user_id: str
    account_name: str
    bvn: Optional[str] = None
    preferred_bank: Optional[Bank] = None

class Transaction(BaseModel):
    transaction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    account_id: str
    type: str  # credit, debit
    amount: Decimal
    balance_before: Decimal
    balance_after: Decimal
    reference: str
    narration: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

# Storage
accounts_db: Dict[str, VirtualAccount] = {}
user_accounts_index: Dict[str, List[str]] = {}
account_number_index: Dict[str, str] = {}
transactions_db: Dict[str, List[Transaction]] = {}

# Initialize provider manager and transaction monitor
provider_manager = AccountProviderManager()
transaction_monitor = TransactionMonitor()

# Setup providers (in production, load from config/env)
wema = WemaProvider(api_key="wema_key", api_secret="wema_secret")
providus = ProvidusProvider(api_key="providus_key", api_secret="providus_secret")

provider_manager.add_provider(ProviderType.WEMA, wema, is_primary=True)
provider_manager.add_provider(ProviderType.PROVIDUS, providus)

class VirtualAccountService:
    
    @staticmethod
    def _generate_account_number(bank: Bank) -> str:
        """Generate unique account number"""
        
        # Bank-specific prefixes
        prefixes = {
            Bank.WEMA: "50",
            Bank.PROVIDUS: "51",
            Bank.STERLING: "52"
        }
        
        prefix = prefixes[bank]
        suffix = ''.join([str(random.randint(0, 9)) for _ in range(8)])
        return prefix + suffix
    
    @staticmethod
    def _get_bank_name(bank: Bank) -> str:
        """Get full bank name"""
        
        names = {
            Bank.WEMA: "Wema Bank",
            Bank.PROVIDUS: "Providus Bank",
            Bank.STERLING: "Sterling Bank"
        }
        
        return names[bank]
    
    @staticmethod
    async def create_account(request: CreateVirtualAccountRequest) -> VirtualAccount:
        """Create virtual account"""
        
        # Select bank
        bank = request.preferred_bank or Bank.WEMA
        
        # Generate account number
        account_number = VirtualAccountService._generate_account_number(bank)
        
        # Ensure uniqueness
        while account_number in account_number_index:
            account_number = VirtualAccountService._generate_account_number(bank)
        
        # Create account
        account = VirtualAccount(
            user_id=request.user_id,
            account_number=account_number,
            account_name=request.account_name,
            bank=bank,
            bank_name=VirtualAccountService._get_bank_name(bank),
            bvn=request.bvn
        )
        
        # Store
        accounts_db[account.account_id] = account
        account_number_index[account_number] = account.account_id
        
        if request.user_id not in user_accounts_index:
            user_accounts_index[request.user_id] = []
        user_accounts_index[request.user_id].append(account.account_id)
        
        transactions_db[account.account_id] = []
        
        logger.info(f"Created virtual account {account.account_id}: {account_number}")
        return account
    
    @staticmethod
    async def get_account(account_id: str) -> VirtualAccount:
        """Get account by ID"""
        
        if account_id not in accounts_db:
            raise HTTPException(status_code=404, detail="Account not found")
        
        return accounts_db[account_id]
    
    @staticmethod
    async def get_account_by_number(account_number: str) -> VirtualAccount:
        """Get account by account number"""
        
        if account_number not in account_number_index:
            raise HTTPException(status_code=404, detail="Account not found")
        
        account_id = account_number_index[account_number]
        return accounts_db[account_id]
    
    @staticmethod
    async def list_user_accounts(user_id: str) -> List[VirtualAccount]:
        """List user accounts"""
        
        if user_id not in user_accounts_index:
            return []
        
        account_ids = user_accounts_index[user_id]
        return [accounts_db[aid] for aid in account_ids]
    
    @staticmethod
    async def credit_account(account_id: str, amount: Decimal, reference: str, narration: str) -> Transaction:
        """Credit account"""
        
        if account_id not in accounts_db:
            raise HTTPException(status_code=404, detail="Account not found")
        
        account = accounts_db[account_id]
        
        if account.status != AccountStatus.ACTIVE:
            raise HTTPException(status_code=400, detail=f"Account is {account.status}")
        
        # Create transaction
        transaction = Transaction(
            account_id=account_id,
            type="credit",
            amount=amount,
            balance_before=account.balance,
            balance_after=account.balance + amount,
            reference=reference,
            narration=narration
        )
        
        # Update balance
        account.balance += amount
        account.updated_at = datetime.utcnow()
        
        # Store transaction
        transactions_db[account_id].append(transaction)
        
        logger.info(f"Credited account {account_id}: {amount}")
        return transaction
    
    @staticmethod
    async def get_transactions(account_id: str, limit: int = 50) -> List[Transaction]:
        """Get account transactions"""
        
        if account_id not in accounts_db:
            raise HTTPException(status_code=404, detail="Account not found")
        
        transactions = transactions_db.get(account_id, [])
        transactions.sort(key=lambda x: x.created_at, reverse=True)
        return transactions[:limit]
    
    @staticmethod
    async def suspend_account(account_id: str) -> VirtualAccount:
        """Suspend account"""
        
        if account_id not in accounts_db:
            raise HTTPException(status_code=404, detail="Account not found")
        
        account = accounts_db[account_id]
        account.status = AccountStatus.SUSPENDED
        account.updated_at = datetime.utcnow()
        
        logger.info(f"Suspended account {account_id}")
        return account
    
    @staticmethod
    async def activate_account(account_id: str) -> VirtualAccount:
        """Activate account"""
        
        if account_id not in accounts_db:
            raise HTTPException(status_code=404, detail="Account not found")
        
        account = accounts_db[account_id]
        account.status = AccountStatus.ACTIVE
        account.updated_at = datetime.utcnow()
        
        logger.info(f"Activated account {account_id}")
        return account

# API Endpoints
@app.post("/api/v1/virtual-accounts", response_model=VirtualAccount)
async def create_account(request: CreateVirtualAccountRequest):
    return await VirtualAccountService.create_account(request)

@app.get("/api/v1/virtual-accounts/{account_id}", response_model=VirtualAccount)
async def get_account(account_id: str):
    return await VirtualAccountService.get_account(account_id)

@app.get("/api/v1/virtual-accounts/number/{account_number}", response_model=VirtualAccount)
async def get_account_by_number(account_number: str):
    return await VirtualAccountService.get_account_by_number(account_number)

@app.get("/api/v1/users/{user_id}/virtual-accounts", response_model=List[VirtualAccount])
async def list_user_accounts(user_id: str):
    return await VirtualAccountService.list_user_accounts(user_id)

@app.post("/api/v1/virtual-accounts/{account_id}/credit", response_model=Transaction)
async def credit_account(account_id: str, amount: Decimal, reference: str, narration: str):
    return await VirtualAccountService.credit_account(account_id, amount, reference, narration)

@app.get("/api/v1/virtual-accounts/{account_id}/transactions", response_model=List[Transaction])
async def get_transactions(account_id: str, limit: int = 50):
    return await VirtualAccountService.get_transactions(account_id, limit)

@app.post("/api/v1/virtual-accounts/{account_id}/suspend", response_model=VirtualAccount)
async def suspend_account(account_id: str):
    return await VirtualAccountService.suspend_account(account_id)

@app.post("/api/v1/virtual-accounts/{account_id}/activate", response_model=VirtualAccount)
async def activate_account(account_id: str):
    return await VirtualAccountService.activate_account(account_id)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "virtual-account-service",
        "version": "2.0.0",
        "total_accounts": len(accounts_db),
        "timestamp": datetime.utcnow().isoformat()
    }

# New enhanced endpoints

@app.post("/api/v1/virtual-accounts/create-with-provider")
async def create_account_with_provider(
    user_id: str,
    account_name: str,
    preferred_provider: Optional[str] = None,
    bvn: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None
):
    """Create virtual account via provider"""
    
    provider_type = ProviderType(preferred_provider) if preferred_provider else None
    
    result = await provider_manager.create_account(
        user_id=user_id,
        account_name=account_name,
        preferred_provider=provider_type,
        bvn=bvn,
        email=email,
        phone=phone
    )
    
    # Store account if successful
    if result.get("success"):
        account = VirtualAccount(
            user_id=user_id,
            account_number=result["account_number"],
            account_name=result["account_name"],
            bank=Bank.WEMA if result.get("provider") == "wema" else Bank.PROVIDUS,
            bank_name=result["bank_name"],
            bvn=bvn
        )
        accounts_db[account.account_id] = account
        
        if user_id not in user_accounts_index:
            user_accounts_index[user_id] = []
        user_accounts_index[user_id].append(account.account_id)
        account_number_index[account.account_number] = account.account_id
        transactions_db[account.account_id] = []
    
    return result

@app.get("/api/v1/virtual-accounts/{account_id}/balance")
async def get_account_balance(account_id: str):
    """Get account balance from transaction monitor"""
    balance = transaction_monitor.get_account_balance(account_id)
    return {"account_id": account_id, "balance": float(balance)}

@app.get("/api/v1/virtual-accounts/{account_id}/statistics")
async def get_account_statistics(account_id: str, days: int = 30):
    """Get account transaction statistics"""
    return transaction_monitor.get_transaction_statistics(account_id, days)

@app.get("/api/v1/virtual-accounts/{account_id}/top-senders")
async def get_top_senders(account_id: str, days: int = 30, limit: int = 10):
    """Get top senders to account"""
    return transaction_monitor.get_top_senders(account_id, days, limit)

@app.get("/api/v1/virtual-accounts/{account_id}/suspicious")
async def detect_suspicious_transactions(
    account_id: str,
    threshold: Decimal = Decimal("1000000"),
    days: int = 7
):
    """Detect suspicious transactions"""
    suspicious = transaction_monitor.detect_suspicious_transactions(account_id, threshold, days)
    return {"account_id": account_id, "suspicious_transactions": suspicious, "count": len(suspicious)}

@app.post("/api/v1/virtual-accounts/{account_id}/reconcile")
async def reconcile_account(
    account_id: str,
    expected_balance: Decimal,
    provider_transactions: List[Dict]
):
    """Reconcile account transactions"""
    return transaction_monitor.reconcile_transactions(account_id, expected_balance, provider_transactions)

@app.get("/api/v1/virtual-accounts/{account_id}/daily-summary")
async def get_daily_summary(account_id: str, date: datetime):
    """Get daily transaction summary"""
    return transaction_monitor.get_daily_summary(account_id, date)

@app.get("/api/v1/reconciliation/issues")
async def get_reconciliation_issues(limit: int = 50):
    """Get reconciliation issues"""
    issues = transaction_monitor.get_reconciliation_issues(limit)
    return {"issues": issues, "count": len(issues)}

@app.get("/api/v1/analytics/overall")
async def get_overall_statistics():
    """Get overall transaction statistics"""
    return transaction_monitor.get_overall_statistics()

@app.get("/api/v1/providers/stats")
async def get_provider_stats():
    """Get provider statistics"""
    return await provider_manager.get_provider_stats()

@app.post("/api/v1/virtual-accounts/{account_id}/credit-monitored")
async def credit_account_monitored(
    account_id: str,
    amount: Decimal,
    reference: str,
    narration: str,
    sender_name: Optional[str] = None,
    sender_account: Optional[str] = None,
    sender_bank: Optional[str] = None
):
    """Credit account with transaction monitoring"""
    
    if account_id not in accounts_db:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account = accounts_db[account_id]
    
    # Record in transaction monitor
    txn = transaction_monitor.record_transaction(
        account_id=account_id,
        account_number=account.account_number,
        transaction_type=TransactionType.CREDIT,
        amount=amount,
        reference=reference,
        narration=narration,
        sender_name=sender_name,
        sender_account=sender_account,
        sender_bank=sender_bank
    )
    
    # Update account balance
    account.balance += amount
    account.updated_at = datetime.utcnow()
    
    # Create transaction record
    transaction = Transaction(
        account_id=account_id,
        type="credit",
        amount=amount,
        balance_before=account.balance - amount,
        balance_after=account.balance,
        reference=reference,
        narration=narration
    )
    
    if account_id not in transactions_db:
        transactions_db[account_id] = []
    transactions_db[account_id].append(transaction)
    
    logger.info(f"Credited {amount} to account {account_id}")
    
    return txn

@app.post("/api/v1/virtual-accounts/{account_id}/debit-monitored")
async def debit_account_monitored(
    account_id: str,
    amount: Decimal,
    reference: str,
    narration: str
):
    """Debit account with transaction monitoring"""
    
    if account_id not in accounts_db:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account = accounts_db[account_id]
    
    if account.balance < amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    # Record in transaction monitor
    txn = transaction_monitor.record_transaction(
        account_id=account_id,
        account_number=account.account_number,
        transaction_type=TransactionType.DEBIT,
        amount=amount,
        reference=reference,
        narration=narration
    )
    
    # Update account balance
    account.balance -= amount
    account.updated_at = datetime.utcnow()
    
    # Create transaction record
    transaction = Transaction(
        account_id=account_id,
        type="debit",
        amount=amount,
        balance_before=account.balance + amount,
        balance_after=account.balance,
        reference=reference,
        narration=narration
    )
    
    if account_id not in transactions_db:
        transactions_db[account_id] = []
    transactions_db[account_id].append(transaction)
    
    logger.info(f"Debited {amount} from account {account_id}")
    
    return txn

@app.get("/api/v1/virtual-accounts/{account_id}/transactions-monitored")
async def get_monitored_transactions(
    account_id: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    transaction_type: Optional[str] = None
):
    """Get monitored transactions for account"""
    
    txn_type = TransactionType(transaction_type) if transaction_type else None
    
    transactions = transaction_monitor.get_account_transactions(
        account_id=account_id,
        start_date=start_date,
        end_date=end_date,
        transaction_type=txn_type
    )
    
    return {"account_id": account_id, "transactions": transactions, "count": len(transactions)}

# Background task to sync with providers
@app.on_event("startup")
async def startup_event():
    """Initialize background tasks on startup"""
    logger.info("Virtual Account Service starting up...")
    # Load existing transactions into monitor
    for account_id, txns in transactions_db.items():
        for txn in txns:
            if account_id in accounts_db:
                account = accounts_db[account_id]
                transaction_monitor.record_transaction(
                    account_id=account_id,
                    account_number=account.account_number,
                    transaction_type=TransactionType(txn.type),
                    amount=txn.amount,
                    reference=txn.reference,
                    narration=txn.narration
                )

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8074)
