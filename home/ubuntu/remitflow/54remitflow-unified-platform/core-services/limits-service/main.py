"""
Limits Service - Centralized transaction limits management

Features:
- Corridor-based limits (per payment rail)
- User tier-based limits (KYC levels)
- Regulatory caps (CBN, NDPR compliance)
- Dynamic limit adjustments
- Limit check API for transaction-service
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, date
from enum import Enum
from decimal import Decimal
import logging
import uuid
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Limits Service",
    description="Centralized transaction limits management",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LimitType(str, Enum):
    SINGLE_TRANSACTION = "single_transaction"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    ANNUAL = "annual"


class LimitScope(str, Enum):
    GLOBAL = "global"
    CORRIDOR = "corridor"
    USER_TIER = "user_tier"
    USER = "user"
    REGULATORY = "regulatory"


class UserTier(str, Enum):
    TIER_0 = "tier_0"
    TIER_1 = "tier_1"
    TIER_2 = "tier_2"
    TIER_3 = "tier_3"
    TIER_4 = "tier_4"
    BUSINESS = "business"


class Corridor(str, Enum):
    DOMESTIC = "domestic"
    MOJALOOP = "mojaloop"
    PAPSS = "papss"
    UPI = "upi"
    PIX = "pix"
    NIBSS = "nibss"
    SWIFT = "swift"


class LimitConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str
    scope: LimitScope
    limit_type: LimitType
    
    corridor: Optional[Corridor] = None
    user_tier: Optional[UserTier] = None
    
    max_amount: Decimal
    currency: str = "NGN"
    max_count: Optional[int] = None
    
    is_active: bool = True
    effective_from: datetime = Field(default_factory=datetime.utcnow)
    effective_until: Optional[datetime] = None
    
    regulatory_reference: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LimitCheckRequest(BaseModel):
    user_id: str
    user_tier: UserTier
    corridor: Corridor
    amount: Decimal
    currency: str = "NGN"


class LimitCheckResult(BaseModel):
    allowed: bool
    limit_type: Optional[LimitType] = None
    limit_scope: Optional[LimitScope] = None
    limit_name: Optional[str] = None
    current_usage: Decimal = Decimal("0")
    limit_amount: Decimal = Decimal("0")
    remaining: Decimal = Decimal("0")
    message: str


class UserLimitUsage(BaseModel):
    user_id: str
    date: date
    daily_amount: Decimal = Decimal("0")
    daily_count: int = 0
    weekly_amount: Decimal = Decimal("0")
    weekly_count: int = 0
    monthly_amount: Decimal = Decimal("0")
    monthly_count: int = 0


class SetUserLimitRequest(BaseModel):
    user_id: str
    limit_type: LimitType
    max_amount: Decimal
    max_count: Optional[int] = None
    reason: str
    set_by: str


limits_db: Dict[str, LimitConfig] = {}
user_usage_db: Dict[str, UserLimitUsage] = {}
user_custom_limits_db: Dict[str, Dict[str, LimitConfig]] = {}


def initialize_default_limits():
    """Initialize default limits based on CBN regulations and business rules"""
    default_limits = [
        LimitConfig(
            name="CBN Daily Limit - Tier 1",
            description="CBN mandated daily limit for Tier 1 (basic) accounts",
            scope=LimitScope.REGULATORY,
            limit_type=LimitType.DAILY,
            user_tier=UserTier.TIER_1,
            max_amount=Decimal("50000"),
            max_count=10,
            regulatory_reference="CBN/DIR/GEN/CIR/04/010"
        ),
        LimitConfig(
            name="CBN Daily Limit - Tier 2",
            description="CBN mandated daily limit for Tier 2 accounts",
            scope=LimitScope.REGULATORY,
            limit_type=LimitType.DAILY,
            user_tier=UserTier.TIER_2,
            max_amount=Decimal("500000"),
            max_count=50,
            regulatory_reference="CBN/DIR/GEN/CIR/04/010"
        ),
        LimitConfig(
            name="CBN Daily Limit - Tier 3",
            description="CBN mandated daily limit for Tier 3 accounts",
            scope=LimitScope.REGULATORY,
            limit_type=LimitType.DAILY,
            user_tier=UserTier.TIER_3,
            max_amount=Decimal("2000000"),
            max_count=100,
            regulatory_reference="CBN/DIR/GEN/CIR/04/010"
        ),
        LimitConfig(
            name="Single Transaction Limit - Domestic",
            description="Maximum single transaction for domestic transfers",
            scope=LimitScope.CORRIDOR,
            limit_type=LimitType.SINGLE_TRANSACTION,
            corridor=Corridor.DOMESTIC,
            max_amount=Decimal("5000000")
        ),
        LimitConfig(
            name="Single Transaction Limit - International",
            description="Maximum single transaction for international transfers",
            scope=LimitScope.CORRIDOR,
            limit_type=LimitType.SINGLE_TRANSACTION,
            corridor=Corridor.MOJALOOP,
            max_amount=Decimal("1000000")
        ),
        LimitConfig(
            name="PAPSS Daily Limit",
            description="PAPSS corridor daily limit",
            scope=LimitScope.CORRIDOR,
            limit_type=LimitType.DAILY,
            corridor=Corridor.PAPSS,
            max_amount=Decimal("10000000")
        ),
        LimitConfig(
            name="UPI Single Transaction",
            description="UPI corridor single transaction limit",
            scope=LimitScope.CORRIDOR,
            limit_type=LimitType.SINGLE_TRANSACTION,
            corridor=Corridor.UPI,
            max_amount=Decimal("500000")
        ),
        LimitConfig(
            name="Monthly Limit - Tier 1",
            description="Monthly transaction limit for Tier 1",
            scope=LimitScope.USER_TIER,
            limit_type=LimitType.MONTHLY,
            user_tier=UserTier.TIER_1,
            max_amount=Decimal("200000")
        ),
        LimitConfig(
            name="Monthly Limit - Tier 2",
            description="Monthly transaction limit for Tier 2",
            scope=LimitScope.USER_TIER,
            limit_type=LimitType.MONTHLY,
            user_tier=UserTier.TIER_2,
            max_amount=Decimal("3000000")
        ),
        LimitConfig(
            name="Monthly Limit - Tier 3",
            description="Monthly transaction limit for Tier 3",
            scope=LimitScope.USER_TIER,
            limit_type=LimitType.MONTHLY,
            user_tier=UserTier.TIER_3,
            max_amount=Decimal("10000000")
        ),
        LimitConfig(
            name="Business Daily Limit",
            description="Daily limit for business accounts",
            scope=LimitScope.USER_TIER,
            limit_type=LimitType.DAILY,
            user_tier=UserTier.BUSINESS,
            max_amount=Decimal("50000000"),
            max_count=500
        )
    ]
    
    for limit in default_limits:
        limits_db[limit.id] = limit


initialize_default_limits()


def get_user_usage(user_id: str) -> UserLimitUsage:
    """Get or create user usage tracking"""
    today = date.today()
    key = f"{user_id}_{today.isoformat()}"
    
    if key not in user_usage_db:
        user_usage_db[key] = UserLimitUsage(user_id=user_id, date=today)
    
    return user_usage_db[key]


def get_applicable_limits(user_tier: UserTier, corridor: Corridor) -> List[LimitConfig]:
    """Get all applicable limits for a user tier and corridor"""
    applicable = []
    
    for limit in limits_db.values():
        if not limit.is_active:
            continue
        
        if limit.effective_until and limit.effective_until < datetime.utcnow():
            continue
        
        if limit.scope == LimitScope.GLOBAL:
            applicable.append(limit)
        elif limit.scope == LimitScope.REGULATORY and limit.user_tier == user_tier:
            applicable.append(limit)
        elif limit.scope == LimitScope.USER_TIER and limit.user_tier == user_tier:
            applicable.append(limit)
        elif limit.scope == LimitScope.CORRIDOR and limit.corridor == corridor:
            applicable.append(limit)
    
    return applicable


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "limits-service"}


@app.post("/check", response_model=LimitCheckResult)
async def check_limit(request: LimitCheckRequest):
    """Check if a transaction is within limits"""
    usage = get_user_usage(request.user_id)
    applicable_limits = get_applicable_limits(request.user_tier, request.corridor)
    
    user_limits = user_custom_limits_db.get(request.user_id, {})
    
    for limit in applicable_limits:
        current_usage = Decimal("0")
        
        if limit.limit_type == LimitType.SINGLE_TRANSACTION:
            if request.amount > limit.max_amount:
                return LimitCheckResult(
                    allowed=False,
                    limit_type=limit.limit_type,
                    limit_scope=limit.scope,
                    limit_name=limit.name,
                    current_usage=request.amount,
                    limit_amount=limit.max_amount,
                    remaining=Decimal("0"),
                    message=f"Transaction amount {request.amount} exceeds single transaction limit of {limit.max_amount}"
                )
        
        elif limit.limit_type == LimitType.DAILY:
            current_usage = usage.daily_amount
            if current_usage + request.amount > limit.max_amount:
                return LimitCheckResult(
                    allowed=False,
                    limit_type=limit.limit_type,
                    limit_scope=limit.scope,
                    limit_name=limit.name,
                    current_usage=current_usage,
                    limit_amount=limit.max_amount,
                    remaining=limit.max_amount - current_usage,
                    message=f"Daily limit would be exceeded. Current: {current_usage}, Limit: {limit.max_amount}"
                )
            
            if limit.max_count and usage.daily_count >= limit.max_count:
                return LimitCheckResult(
                    allowed=False,
                    limit_type=limit.limit_type,
                    limit_scope=limit.scope,
                    limit_name=limit.name,
                    current_usage=Decimal(usage.daily_count),
                    limit_amount=Decimal(limit.max_count),
                    remaining=Decimal("0"),
                    message=f"Daily transaction count limit reached: {limit.max_count}"
                )
        
        elif limit.limit_type == LimitType.MONTHLY:
            current_usage = usage.monthly_amount
            if current_usage + request.amount > limit.max_amount:
                return LimitCheckResult(
                    allowed=False,
                    limit_type=limit.limit_type,
                    limit_scope=limit.scope,
                    limit_name=limit.name,
                    current_usage=current_usage,
                    limit_amount=limit.max_amount,
                    remaining=limit.max_amount - current_usage,
                    message=f"Monthly limit would be exceeded. Current: {current_usage}, Limit: {limit.max_amount}"
                )
    
    return LimitCheckResult(
        allowed=True,
        message="Transaction within all limits"
    )


@app.post("/record-usage")
async def record_usage(user_id: str, amount: Decimal):
    """Record a transaction for limit tracking"""
    usage = get_user_usage(user_id)
    usage.daily_amount += amount
    usage.daily_count += 1
    usage.weekly_amount += amount
    usage.weekly_count += 1
    usage.monthly_amount += amount
    usage.monthly_count += 1
    
    return {"recorded": True, "usage": usage}


@app.get("/limits", response_model=List[LimitConfig])
async def list_limits(
    scope: Optional[LimitScope] = None,
    corridor: Optional[Corridor] = None,
    user_tier: Optional[UserTier] = None,
    active_only: bool = True
):
    """List all configured limits"""
    limits = list(limits_db.values())
    
    if active_only:
        limits = [lim for lim in limits if lim.is_active]
    if scope:
        limits = [lim for lim in limits if lim.scope == scope]
    if corridor:
        limits = [lim for lim in limits if lim.corridor == corridor]
    if user_tier:
        limits = [lim for lim in limits if lim.user_tier == user_tier]
    
    return limits


@app.get("/limits/{limit_id}", response_model=LimitConfig)
async def get_limit(limit_id: str):
    """Get a specific limit configuration"""
    if limit_id not in limits_db:
        raise HTTPException(status_code=404, detail="Limit not found")
    return limits_db[limit_id]


@app.post("/limits", response_model=LimitConfig)
async def create_limit(limit: LimitConfig):
    """Create a new limit configuration"""
    limits_db[limit.id] = limit
    logger.info(f"Created limit: {limit.name}")
    return limit


@app.put("/limits/{limit_id}", response_model=LimitConfig)
async def update_limit(limit_id: str, updates: Dict[str, Any]):
    """Update a limit configuration"""
    if limit_id not in limits_db:
        raise HTTPException(status_code=404, detail="Limit not found")
    
    limit = limits_db[limit_id]
    
    for key, value in updates.items():
        if hasattr(limit, key):
            setattr(limit, key, value)
    
    limit.updated_at = datetime.utcnow()
    
    logger.info(f"Updated limit: {limit.name}")
    return limit


@app.delete("/limits/{limit_id}")
async def delete_limit(limit_id: str):
    """Deactivate a limit (soft delete)"""
    if limit_id not in limits_db:
        raise HTTPException(status_code=404, detail="Limit not found")
    
    limits_db[limit_id].is_active = False
    limits_db[limit_id].updated_at = datetime.utcnow()
    
    return {"deleted": True}


@app.post("/users/{user_id}/limits", response_model=LimitConfig)
async def set_user_custom_limit(user_id: str, request: SetUserLimitRequest):
    """Set a custom limit for a specific user"""
    limit = LimitConfig(
        name=f"Custom limit for {user_id}",
        description=request.reason,
        scope=LimitScope.USER,
        limit_type=request.limit_type,
        max_amount=request.max_amount,
        max_count=request.max_count
    )
    
    if user_id not in user_custom_limits_db:
        user_custom_limits_db[user_id] = {}
    
    user_custom_limits_db[user_id][request.limit_type.value] = limit
    
    logger.info(f"Set custom limit for user {user_id}: {request.limit_type} = {request.max_amount}")
    
    return limit


@app.get("/users/{user_id}/limits")
async def get_user_limits(user_id: str, user_tier: UserTier):
    """Get all applicable limits for a user"""
    custom_limits = user_custom_limits_db.get(user_id, {})
    tier_limits = [lim for lim in limits_db.values() if lim.user_tier == user_tier and lim.is_active]
    
    return {
        "user_id": user_id,
        "user_tier": user_tier,
        "custom_limits": list(custom_limits.values()),
        "tier_limits": tier_limits
    }


@app.get("/users/{user_id}/usage")
async def get_user_usage_stats(user_id: str):
    """Get current usage statistics for a user"""
    usage = get_user_usage(user_id)
    return usage


@app.get("/corridors/{corridor}/limits")
async def get_corridor_limits(corridor: Corridor):
    """Get all limits for a specific corridor"""
    corridor_limits = [lim for lim in limits_db.values() if lim.corridor == corridor and lim.is_active]
    return {"corridor": corridor, "limits": corridor_limits}


@app.get("/regulatory")
async def get_regulatory_limits():
    """Get all regulatory limits"""
    regulatory = [lim for lim in limits_db.values() if lim.scope == LimitScope.REGULATORY and lim.is_active]
    return {"regulatory_limits": regulatory}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8013)
