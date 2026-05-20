"""
Savings & Goals Service
Handles savings accounts, goal-based savings, locked savings, and interest calculations.

Production-ready version with:
- Structured logging with correlation IDs
- Rate limiting
- Environment-driven CORS configuration
"""

import os
import sys

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, date
from enum import Enum
import uuid
from decimal import Decimal, ROUND_HALF_UP

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Savings & Goals Service",
    description="Manages savings accounts, goal-based savings, and locked savings products",
    version="2.0.0"
)

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "savings-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)


class SavingsType(str, Enum):
    FLEXIBLE = "flexible"
    LOCKED = "locked"
    GOAL_BASED = "goal_based"
    RECURRING = "recurring"


class GoalCategory(str, Enum):
    EMERGENCY = "emergency"
    VACATION = "vacation"
    EDUCATION = "education"
    WEDDING = "wedding"
    HOME = "home"
    CAR = "car"
    BUSINESS = "business"
    RETIREMENT = "retirement"
    OTHER = "other"


class TransactionType(str, Enum):
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    INTEREST = "interest"
    PENALTY = "penalty"
    TRANSFER_IN = "transfer_in"
    TRANSFER_OUT = "transfer_out"


class SavingsStatus(str, Enum):
    ACTIVE = "active"
    MATURED = "matured"
    CLOSED = "closed"
    FROZEN = "frozen"


class AutoSaveFrequency(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"


# Models
class SavingsProduct(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    savings_type: SavingsType
    min_amount: Decimal = Decimal("100.00")
    max_amount: Optional[Decimal] = None
    interest_rate: Decimal = Decimal("5.0")
    lock_period_days: Optional[int] = None
    early_withdrawal_penalty: Decimal = Decimal("0.0")
    is_active: bool = True
    currency: str = "NGN"
    description: str = ""


class SavingsAccount(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    product_id: str
    account_number: str
    savings_type: SavingsType
    balance: Decimal = Decimal("0.00")
    interest_earned: Decimal = Decimal("0.00")
    interest_rate: Decimal
    currency: str = "NGN"
    status: SavingsStatus = SavingsStatus.ACTIVE
    created_at: datetime = Field(default_factory=datetime.utcnow)
    maturity_date: Optional[datetime] = None
    last_interest_date: Optional[datetime] = None


class SavingsGoal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    savings_account_id: str
    name: str
    category: GoalCategory
    target_amount: Decimal
    current_amount: Decimal = Decimal("0.00")
    target_date: datetime
    currency: str = "NGN"
    is_achieved: bool = False
    achieved_at: Optional[datetime] = None
    auto_save_enabled: bool = False
    auto_save_amount: Optional[Decimal] = None
    auto_save_frequency: Optional[AutoSaveFrequency] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    image_url: Optional[str] = None


class SavingsTransaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    account_id: str
    goal_id: Optional[str] = None
    transaction_type: TransactionType
    amount: Decimal
    balance_after: Decimal
    description: str
    reference: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AutoSaveRule(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    savings_account_id: str
    goal_id: Optional[str] = None
    amount: Decimal
    frequency: AutoSaveFrequency
    source_wallet_id: str
    is_active: bool = True
    next_execution: datetime
    last_execution: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# In-memory storage
products_db: Dict[str, SavingsProduct] = {}
accounts_db: Dict[str, SavingsAccount] = {}
goals_db: Dict[str, SavingsGoal] = {}
transactions_db: Dict[str, SavingsTransaction] = {}
auto_save_rules_db: Dict[str, AutoSaveRule] = {}

# Default products
DEFAULT_PRODUCTS = [
    {
        "name": "Flex Savings",
        "savings_type": SavingsType.FLEXIBLE,
        "min_amount": Decimal("100.00"),
        "interest_rate": Decimal("4.0"),
        "description": "Flexible savings with no lock period. Withdraw anytime."
    },
    {
        "name": "30-Day Lock",
        "savings_type": SavingsType.LOCKED,
        "min_amount": Decimal("5000.00"),
        "interest_rate": Decimal("8.0"),
        "lock_period_days": 30,
        "early_withdrawal_penalty": Decimal("2.0"),
        "description": "Lock your savings for 30 days and earn higher interest."
    },
    {
        "name": "90-Day Lock",
        "savings_type": SavingsType.LOCKED,
        "min_amount": Decimal("10000.00"),
        "interest_rate": Decimal("12.0"),
        "lock_period_days": 90,
        "early_withdrawal_penalty": Decimal("3.0"),
        "description": "Lock your savings for 90 days for maximum returns."
    },
    {
        "name": "Goal Saver",
        "savings_type": SavingsType.GOAL_BASED,
        "min_amount": Decimal("500.00"),
        "interest_rate": Decimal("6.0"),
        "description": "Save towards specific goals with automatic contributions."
    },
    {
        "name": "Daily Saver",
        "savings_type": SavingsType.RECURRING,
        "min_amount": Decimal("50.00"),
        "interest_rate": Decimal("5.5"),
        "description": "Automatic daily savings from your wallet."
    },
]


def initialize_products():
    """Initialize default savings products."""
    for product_data in DEFAULT_PRODUCTS:
        product = SavingsProduct(**product_data)
        products_db[product.id] = product


def generate_account_number() -> str:
    """Generate unique savings account number."""
    timestamp = datetime.utcnow().strftime("%y%m%d")
    random_part = uuid.uuid4().hex[:6].upper()
    return f"SAV{timestamp}{random_part}"


def calculate_interest(principal: Decimal, rate: Decimal, days: int) -> Decimal:
    """Calculate simple interest for given period."""
    annual_rate = rate / Decimal("100")
    daily_rate = annual_rate / Decimal("365")
    interest = principal * daily_rate * Decimal(days)
    return interest.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


initialize_products()


# Product Endpoints
@app.get("/products", response_model=List[SavingsProduct])
async def list_products(savings_type: Optional[SavingsType] = None):
    """List all savings products."""
    products = list(products_db.values())
    if savings_type:
        products = [p for p in products if p.savings_type == savings_type]
    return [p for p in products if p.is_active]


@app.get("/products/{product_id}", response_model=SavingsProduct)
async def get_product(product_id: str):
    """Get product details."""
    if product_id not in products_db:
        raise HTTPException(status_code=404, detail="Product not found")
    return products_db[product_id]


# Account Endpoints
@app.post("/accounts", response_model=SavingsAccount)
async def create_savings_account(
    user_id: str,
    product_id: str,
    initial_deposit: Decimal = Decimal("0.00")
):
    """Create a new savings account."""
    if product_id not in products_db:
        raise HTTPException(status_code=404, detail="Product not found")
    
    product = products_db[product_id]
    
    if initial_deposit > 0 and initial_deposit < product.min_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Minimum deposit is {product.min_amount} {product.currency}"
        )
    
    maturity_date = None
    if product.lock_period_days:
        maturity_date = datetime.utcnow() + timedelta(days=product.lock_period_days)
    
    account = SavingsAccount(
        user_id=user_id,
        product_id=product_id,
        account_number=generate_account_number(),
        savings_type=product.savings_type,
        balance=initial_deposit,
        interest_rate=product.interest_rate,
        currency=product.currency,
        maturity_date=maturity_date
    )
    
    accounts_db[account.id] = account
    
    if initial_deposit > 0:
        transaction = SavingsTransaction(
            account_id=account.id,
            transaction_type=TransactionType.DEPOSIT,
            amount=initial_deposit,
            balance_after=initial_deposit,
            description="Initial deposit"
        )
        transactions_db[transaction.id] = transaction
    
    return account


@app.get("/accounts/{account_id}", response_model=SavingsAccount)
async def get_account(account_id: str):
    """Get savings account details."""
    if account_id not in accounts_db:
        raise HTTPException(status_code=404, detail="Account not found")
    return accounts_db[account_id]


@app.get("/users/{user_id}/accounts", response_model=List[SavingsAccount])
async def get_user_accounts(user_id: str, status: Optional[SavingsStatus] = None):
    """Get all savings accounts for a user."""
    accounts = [a for a in accounts_db.values() if a.user_id == user_id]
    if status:
        accounts = [a for a in accounts if a.status == status]
    return accounts


@app.post("/accounts/{account_id}/deposit")
async def deposit(
    account_id: str,
    amount: Decimal,
    source: str = "wallet",
    reference: Optional[str] = None
):
    """Deposit funds into savings account."""
    if account_id not in accounts_db:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account = accounts_db[account_id]
    
    if account.status != SavingsStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Account is not active")
    
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    product = products_db.get(account.product_id)
    if product and product.max_amount:
        if account.balance + amount > product.max_amount:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum balance is {product.max_amount} {account.currency}"
            )
    
    account.balance += amount
    
    transaction = SavingsTransaction(
        account_id=account_id,
        transaction_type=TransactionType.DEPOSIT,
        amount=amount,
        balance_after=account.balance,
        description=f"Deposit from {source}",
        reference=reference
    )
    transactions_db[transaction.id] = transaction
    
    # Update goal progress if linked
    for goal in goals_db.values():
        if goal.savings_account_id == account_id and not goal.is_achieved:
            goal.current_amount = account.balance
            if goal.current_amount >= goal.target_amount:
                goal.is_achieved = True
                goal.achieved_at = datetime.utcnow()
    
    return {
        "account": account,
        "transaction": transaction
    }


@app.post("/accounts/{account_id}/withdraw")
async def withdraw(
    account_id: str,
    amount: Decimal,
    destination: str = "wallet",
    reference: Optional[str] = None
):
    """Withdraw funds from savings account."""
    if account_id not in accounts_db:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account = accounts_db[account_id]
    
    if account.status != SavingsStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Account is not active")
    
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    if amount > account.balance:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    product = products_db.get(account.product_id)
    penalty = Decimal("0.00")
    
    # Check for early withdrawal penalty on locked savings
    if product and product.lock_period_days and account.maturity_date:
        if datetime.utcnow() < account.maturity_date:
            penalty_rate = product.early_withdrawal_penalty / Decimal("100")
            penalty = (amount * penalty_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    
    net_amount = amount - penalty
    account.balance -= amount
    
    transactions = []
    
    # Withdrawal transaction
    withdrawal_tx = SavingsTransaction(
        account_id=account_id,
        transaction_type=TransactionType.WITHDRAWAL,
        amount=amount,
        balance_after=account.balance,
        description=f"Withdrawal to {destination}",
        reference=reference
    )
    transactions_db[withdrawal_tx.id] = withdrawal_tx
    transactions.append(withdrawal_tx)
    
    # Penalty transaction if applicable
    if penalty > 0:
        penalty_tx = SavingsTransaction(
            account_id=account_id,
            transaction_type=TransactionType.PENALTY,
            amount=penalty,
            balance_after=account.balance,
            description="Early withdrawal penalty"
        )
        transactions_db[penalty_tx.id] = penalty_tx
        transactions.append(penalty_tx)
    
    return {
        "account": account,
        "amount_withdrawn": amount,
        "penalty": penalty,
        "net_amount": net_amount,
        "transactions": transactions
    }


@app.post("/accounts/{account_id}/calculate-interest")
async def calculate_account_interest(account_id: str):
    """Calculate and credit interest for an account."""
    if account_id not in accounts_db:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account = accounts_db[account_id]
    
    if account.status != SavingsStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Account is not active")
    
    if account.balance <= 0:
        return {"interest": Decimal("0.00"), "message": "No balance to earn interest"}
    
    # Calculate days since last interest
    last_date = account.last_interest_date or account.created_at
    days = (datetime.utcnow() - last_date).days
    
    if days < 1:
        return {"interest": Decimal("0.00"), "message": "Interest already calculated today"}
    
    interest = calculate_interest(account.balance, account.interest_rate, days)
    
    if interest > 0:
        account.balance += interest
        account.interest_earned += interest
        account.last_interest_date = datetime.utcnow()
        
        transaction = SavingsTransaction(
            account_id=account_id,
            transaction_type=TransactionType.INTEREST,
            amount=interest,
            balance_after=account.balance,
            description=f"Interest for {days} days at {account.interest_rate}% p.a."
        )
        transactions_db[transaction.id] = transaction
        
        return {
            "interest": interest,
            "days": days,
            "new_balance": account.balance,
            "transaction": transaction
        }
    
    return {"interest": Decimal("0.00"), "message": "No interest earned"}


# Goal Endpoints
@app.post("/goals", response_model=SavingsGoal)
async def create_goal(
    user_id: str,
    name: str,
    category: GoalCategory,
    target_amount: Decimal,
    target_date: datetime,
    currency: str = "NGN",
    auto_save_enabled: bool = False,
    auto_save_amount: Optional[Decimal] = None,
    auto_save_frequency: Optional[AutoSaveFrequency] = None,
    image_url: Optional[str] = None
):
    """Create a new savings goal."""
    # Find or create goal-based savings account
    goal_product = None
    for product in products_db.values():
        if product.savings_type == SavingsType.GOAL_BASED:
            goal_product = product
            break
    
    if not goal_product:
        raise HTTPException(status_code=500, detail="Goal savings product not configured")
    
    # Create savings account for this goal
    account = await create_savings_account(user_id, goal_product.id)
    
    goal = SavingsGoal(
        user_id=user_id,
        savings_account_id=account.id,
        name=name,
        category=category,
        target_amount=target_amount,
        target_date=target_date,
        currency=currency,
        auto_save_enabled=auto_save_enabled,
        auto_save_amount=auto_save_amount,
        auto_save_frequency=auto_save_frequency,
        image_url=image_url
    )
    
    goals_db[goal.id] = goal
    
    # Create auto-save rule if enabled
    if auto_save_enabled and auto_save_amount and auto_save_frequency:
        next_execution = calculate_next_execution(auto_save_frequency)
        rule = AutoSaveRule(
            user_id=user_id,
            savings_account_id=account.id,
            goal_id=goal.id,
            amount=auto_save_amount,
            frequency=auto_save_frequency,
            source_wallet_id="default",
            next_execution=next_execution
        )
        auto_save_rules_db[rule.id] = rule
    
    return goal


def calculate_next_execution(frequency: AutoSaveFrequency) -> datetime:
    """Calculate next auto-save execution time."""
    now = datetime.utcnow()
    if frequency == AutoSaveFrequency.DAILY:
        return now + timedelta(days=1)
    elif frequency == AutoSaveFrequency.WEEKLY:
        return now + timedelta(weeks=1)
    elif frequency == AutoSaveFrequency.BIWEEKLY:
        return now + timedelta(weeks=2)
    elif frequency == AutoSaveFrequency.MONTHLY:
        return now + timedelta(days=30)
    return now + timedelta(days=1)


@app.get("/goals/{goal_id}", response_model=SavingsGoal)
async def get_goal(goal_id: str):
    """Get goal details."""
    if goal_id not in goals_db:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goals_db[goal_id]


@app.get("/users/{user_id}/goals", response_model=List[SavingsGoal])
async def get_user_goals(
    user_id: str,
    category: Optional[GoalCategory] = None,
    achieved: Optional[bool] = None
):
    """Get all goals for a user."""
    goals = [g for g in goals_db.values() if g.user_id == user_id]
    
    if category:
        goals = [g for g in goals if g.category == category]
    if achieved is not None:
        goals = [g for g in goals if g.is_achieved == achieved]
    
    return goals


@app.post("/goals/{goal_id}/contribute")
async def contribute_to_goal(
    goal_id: str,
    amount: Decimal,
    source: str = "wallet"
):
    """Contribute to a savings goal."""
    if goal_id not in goals_db:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    goal = goals_db[goal_id]
    
    if goal.is_achieved:
        raise HTTPException(status_code=400, detail="Goal already achieved")
    
    result = await deposit(goal.savings_account_id, amount, source)
    
    goal.current_amount = result["account"].balance
    
    if goal.current_amount >= goal.target_amount:
        goal.is_achieved = True
        goal.achieved_at = datetime.utcnow()
    
    return {
        "goal": goal,
        "progress_percentage": float(goal.current_amount / goal.target_amount * 100),
        "remaining": goal.target_amount - goal.current_amount,
        "transaction": result["transaction"]
    }


@app.get("/goals/{goal_id}/progress")
async def get_goal_progress(goal_id: str):
    """Get detailed progress for a goal."""
    if goal_id not in goals_db:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    goal = goals_db[goal_id]
    account = accounts_db.get(goal.savings_account_id)
    
    if not account:
        raise HTTPException(status_code=404, detail="Savings account not found")
    
    days_remaining = (goal.target_date - datetime.utcnow()).days
    progress_percentage = float(goal.current_amount / goal.target_amount * 100)
    remaining_amount = goal.target_amount - goal.current_amount
    
    # Calculate required daily/weekly/monthly savings to reach goal
    daily_required = remaining_amount / Decimal(max(1, days_remaining)) if days_remaining > 0 else Decimal("0")
    weekly_required = daily_required * 7
    monthly_required = daily_required * 30
    
    return {
        "goal": goal,
        "account": account,
        "progress_percentage": progress_percentage,
        "remaining_amount": remaining_amount,
        "days_remaining": days_remaining,
        "is_on_track": progress_percentage >= (100 - (days_remaining / max(1, (goal.target_date - goal.created_at).days) * 100)),
        "required_savings": {
            "daily": daily_required.quantize(Decimal("0.01")),
            "weekly": weekly_required.quantize(Decimal("0.01")),
            "monthly": monthly_required.quantize(Decimal("0.01"))
        }
    }


# Auto-Save Endpoints
@app.get("/users/{user_id}/auto-save-rules", response_model=List[AutoSaveRule])
async def get_user_auto_save_rules(user_id: str):
    """Get all auto-save rules for a user."""
    return [r for r in auto_save_rules_db.values() if r.user_id == user_id]


@app.post("/auto-save-rules", response_model=AutoSaveRule)
async def create_auto_save_rule(
    user_id: str,
    savings_account_id: str,
    amount: Decimal,
    frequency: AutoSaveFrequency,
    source_wallet_id: str,
    goal_id: Optional[str] = None
):
    """Create a new auto-save rule."""
    if savings_account_id not in accounts_db:
        raise HTTPException(status_code=404, detail="Savings account not found")
    
    rule = AutoSaveRule(
        user_id=user_id,
        savings_account_id=savings_account_id,
        goal_id=goal_id,
        amount=amount,
        frequency=frequency,
        source_wallet_id=source_wallet_id,
        next_execution=calculate_next_execution(frequency)
    )
    
    auto_save_rules_db[rule.id] = rule
    return rule


@app.put("/auto-save-rules/{rule_id}/toggle")
async def toggle_auto_save_rule(rule_id: str):
    """Toggle auto-save rule on/off."""
    if rule_id not in auto_save_rules_db:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    rule = auto_save_rules_db[rule_id]
    rule.is_active = not rule.is_active
    
    if rule.is_active:
        rule.next_execution = calculate_next_execution(rule.frequency)
    
    return rule


@app.post("/auto-save-rules/execute")
async def execute_auto_save_rules():
    """Execute due auto-save rules (called by scheduler)."""
    now = datetime.utcnow()
    executed = []
    
    for rule in auto_save_rules_db.values():
        if rule.is_active and rule.next_execution <= now:
            try:
                result = await deposit(
                    rule.savings_account_id,
                    rule.amount,
                    "auto_save",
                    f"auto_save_{rule.id}"
                )
                
                rule.last_execution = now
                rule.next_execution = calculate_next_execution(rule.frequency)
                
                executed.append({
                    "rule_id": rule.id,
                    "amount": rule.amount,
                    "status": "success"
                })
            except Exception as e:
                executed.append({
                    "rule_id": rule.id,
                    "amount": rule.amount,
                    "status": "failed",
                    "error": str(e)
                })
    
    return {"executed_count": len(executed), "results": executed}


# Transaction History
@app.get("/accounts/{account_id}/transactions", response_model=List[SavingsTransaction])
async def get_account_transactions(
    account_id: str,
    transaction_type: Optional[TransactionType] = None,
    limit: int = Query(default=50, le=200)
):
    """Get transaction history for an account."""
    transactions = [t for t in transactions_db.values() if t.account_id == account_id]
    
    if transaction_type:
        transactions = [t for t in transactions if t.transaction_type == transaction_type]
    
    transactions.sort(key=lambda x: x.created_at, reverse=True)
    return transactions[:limit]


# Summary Endpoints
@app.get("/users/{user_id}/savings-summary")
async def get_user_savings_summary(user_id: str):
    """Get savings summary for a user."""
    accounts = [a for a in accounts_db.values() if a.user_id == user_id]
    goals = [g for g in goals_db.values() if g.user_id == user_id]
    
    total_balance = sum(a.balance for a in accounts)
    total_interest = sum(a.interest_earned for a in accounts)
    
    return {
        "total_accounts": len(accounts),
        "total_balance": total_balance,
        "total_interest_earned": total_interest,
        "by_type": {
            savings_type.value: sum(a.balance for a in accounts if a.savings_type == savings_type)
            for savings_type in SavingsType
        },
        "goals": {
            "total": len(goals),
            "achieved": len([g for g in goals if g.is_achieved]),
            "in_progress": len([g for g in goals if not g.is_achieved]),
            "total_target": sum(g.target_amount for g in goals),
            "total_saved": sum(g.current_amount for g in goals)
        }
    }


# Health check
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "savings",
        "timestamp": datetime.utcnow().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8012)
