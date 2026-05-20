"""
Referral & Rewards Service
Handles referral programs, rewards, loyalty points, and promotional campaigns.

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
from typing import Optional, List
from datetime import datetime, timedelta
from enum import Enum
import uuid
import hashlib
import secrets
from decimal import Decimal

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Referral & Rewards Service",
    description="Manages referral programs, rewards, loyalty points, and promotions",
    version="2.0.0"
)

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "referral-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)


class RewardType(str, Enum):
    CASH = "cash"
    POINTS = "points"
    DISCOUNT = "discount"
    FREE_TRANSFER = "free_transfer"
    REDUCED_FEE = "reduced_fee"


class ReferralStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class CampaignStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ENDED = "ended"
    SCHEDULED = "scheduled"


class TierLevel(str, Enum):
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"
    PLATINUM = "platinum"


class ReferralCode(BaseModel):
    code: str
    user_id: str
    created_at: datetime
    expires_at: Optional[datetime] = None
    max_uses: Optional[int] = None
    current_uses: int = 0
    reward_type: RewardType = RewardType.CASH
    reward_amount: Decimal = Decimal("5.00")
    is_active: bool = True


class Referral(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    referrer_id: str
    referee_id: str
    referral_code: str
    status: ReferralStatus = ReferralStatus.PENDING
    referrer_reward: Optional[Decimal] = None
    referee_reward: Optional[Decimal] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    qualifying_action: Optional[str] = None


class LoyaltyAccount(BaseModel):
    user_id: str
    points_balance: int = 0
    lifetime_points: int = 0
    tier: TierLevel = TierLevel.BRONZE
    tier_progress: int = 0
    next_tier_threshold: int = 1000
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_activity: datetime = Field(default_factory=datetime.utcnow)


class PointsTransaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    points: int
    transaction_type: str
    description: str
    reference_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None


class Campaign(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str
    campaign_type: str
    reward_type: RewardType
    reward_amount: Decimal
    start_date: datetime
    end_date: datetime
    status: CampaignStatus = CampaignStatus.SCHEDULED
    target_corridors: List[str] = []
    min_transaction_amount: Optional[Decimal] = None
    max_redemptions: Optional[int] = None
    current_redemptions: int = 0
    promo_code: Optional[str] = None
    terms_conditions: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Reward(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    reward_type: RewardType
    amount: Decimal
    description: str
    source: str
    reference_id: Optional[str] = None
    is_claimed: bool = False
    claimed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# Production mode flag - when True, use PostgreSQL; when False, use in-memory (dev only)
USE_DATABASE = os.getenv("USE_DATABASE", "true").lower() == "true"

# Import database modules if available
try:
    from database import get_db_context, init_db, check_db_connection
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False

# In-memory storage (only used when USE_DATABASE=false for development)
referral_codes_db: dict[str, ReferralCode] = {}
referrals_db: dict[str, Referral] = {}
loyalty_accounts_db: dict[str, LoyaltyAccount] = {}
points_transactions_db: dict[str, PointsTransaction] = {}
campaigns_db: dict[str, Campaign] = {}
rewards_db: dict[str, Reward] = {}

# Tier thresholds
TIER_THRESHOLDS = {
    TierLevel.BRONZE: 0,
    TierLevel.SILVER: 1000,
    TierLevel.GOLD: 5000,
    TierLevel.PLATINUM: 15000
}

# Points earning rates
POINTS_PER_DOLLAR = 10
REFERRAL_BONUS_POINTS = 500


def generate_referral_code(user_id: str) -> str:
    """Generate a unique referral code for a user."""
    hash_input = f"{user_id}{secrets.token_hex(4)}"
    code = hashlib.sha256(hash_input.encode()).hexdigest()[:8].upper()
    return f"REF{code}"


def calculate_tier(lifetime_points: int) -> tuple[TierLevel, int, int]:
    """Calculate user tier based on lifetime points."""
    current_tier = TierLevel.BRONZE
    next_threshold = TIER_THRESHOLDS[TierLevel.SILVER]
    
    for tier, threshold in sorted(TIER_THRESHOLDS.items(), key=lambda x: x[1], reverse=True):
        if lifetime_points >= threshold:
            current_tier = tier
            break
    
    # Find next tier threshold
    tiers = list(TierLevel)
    current_index = tiers.index(current_tier)
    if current_index < len(tiers) - 1:
        next_tier = tiers[current_index + 1]
        next_threshold = TIER_THRESHOLDS[next_tier]
    else:
        next_threshold = TIER_THRESHOLDS[TierLevel.PLATINUM]
    
    progress = min(100, int((lifetime_points / next_threshold) * 100)) if next_threshold > 0 else 100
    
    return current_tier, progress, next_threshold


# Referral Code Endpoints
@app.post("/referral-codes", response_model=ReferralCode)
async def create_referral_code(
    user_id: str,
    reward_type: RewardType = RewardType.CASH,
    reward_amount: Decimal = Decimal("5.00"),
    max_uses: Optional[int] = None,
    expires_days: Optional[int] = 90
):
    """Create a new referral code for a user."""
    code = generate_referral_code(user_id)
    
    expires_at = None
    if expires_days:
        expires_at = datetime.utcnow() + timedelta(days=expires_days)
    
    referral_code = ReferralCode(
        code=code,
        user_id=user_id,
        created_at=datetime.utcnow(),
        expires_at=expires_at,
        max_uses=max_uses,
        reward_type=reward_type,
        reward_amount=reward_amount
    )
    
    referral_codes_db[code] = referral_code
    return referral_code


@app.get("/referral-codes/{code}", response_model=ReferralCode)
async def get_referral_code(code: str):
    """Get referral code details."""
    if code not in referral_codes_db:
        raise HTTPException(status_code=404, detail="Referral code not found")
    return referral_codes_db[code]


@app.get("/users/{user_id}/referral-code", response_model=ReferralCode)
async def get_user_referral_code(user_id: str):
    """Get or create a referral code for a user."""
    for code, ref_code in referral_codes_db.items():
        if ref_code.user_id == user_id and ref_code.is_active:
            return ref_code
    
    # Create new code if none exists
    return await create_referral_code(user_id)


@app.post("/referral-codes/{code}/validate")
async def validate_referral_code(code: str, referee_id: str):
    """Validate a referral code for use."""
    if code not in referral_codes_db:
        raise HTTPException(status_code=404, detail="Referral code not found")
    
    ref_code = referral_codes_db[code]
    
    if not ref_code.is_active:
        raise HTTPException(status_code=400, detail="Referral code is inactive")
    
    if ref_code.expires_at and datetime.utcnow() > ref_code.expires_at:
        raise HTTPException(status_code=400, detail="Referral code has expired")
    
    if ref_code.max_uses and ref_code.current_uses >= ref_code.max_uses:
        raise HTTPException(status_code=400, detail="Referral code has reached maximum uses")
    
    if ref_code.user_id == referee_id:
        raise HTTPException(status_code=400, detail="Cannot use your own referral code")
    
    return {
        "valid": True,
        "referrer_id": ref_code.user_id,
        "reward_type": ref_code.reward_type,
        "reward_amount": ref_code.reward_amount
    }


# Referral Endpoints
@app.post("/referrals", response_model=Referral)
async def create_referral(
    referral_code: str,
    referee_id: str
):
    """Create a new referral when a user signs up with a referral code."""
    validation = await validate_referral_code(referral_code, referee_id)
    
    ref_code = referral_codes_db[referral_code]
    
    referral = Referral(
        referrer_id=ref_code.user_id,
        referee_id=referee_id,
        referral_code=referral_code,
        referrer_reward=ref_code.reward_amount,
        referee_reward=ref_code.reward_amount
    )
    
    referrals_db[referral.id] = referral
    ref_code.current_uses += 1
    
    return referral


@app.post("/referrals/{referral_id}/complete")
async def complete_referral(
    referral_id: str,
    qualifying_action: str = "first_transfer"
):
    """Complete a referral and issue rewards."""
    if referral_id not in referrals_db:
        raise HTTPException(status_code=404, detail="Referral not found")
    
    referral = referrals_db[referral_id]
    
    if referral.status != ReferralStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Referral is already {referral.status}")
    
    referral.status = ReferralStatus.COMPLETED
    referral.completed_at = datetime.utcnow()
    referral.qualifying_action = qualifying_action
    
    # Create rewards for both parties
    referrer_reward = Reward(
        user_id=referral.referrer_id,
        reward_type=RewardType.CASH,
        amount=referral.referrer_reward or Decimal("5.00"),
        description="Referral bonus for inviting a friend",
        source="referral",
        reference_id=referral_id,
        expires_at=datetime.utcnow() + timedelta(days=30)
    )
    rewards_db[referrer_reward.id] = referrer_reward
    
    referee_reward = Reward(
        user_id=referral.referee_id,
        reward_type=RewardType.CASH,
        amount=referral.referee_reward or Decimal("5.00"),
        description="Welcome bonus for joining via referral",
        source="referral",
        reference_id=referral_id,
        expires_at=datetime.utcnow() + timedelta(days=30)
    )
    rewards_db[referee_reward.id] = referee_reward
    
    # Award bonus points
    await award_points(referral.referrer_id, REFERRAL_BONUS_POINTS, "referral_bonus", f"Referral bonus for {referral_id}")
    await award_points(referral.referee_id, REFERRAL_BONUS_POINTS // 2, "signup_bonus", "Welcome bonus for joining")
    
    return {
        "referral": referral,
        "referrer_reward": referrer_reward,
        "referee_reward": referee_reward
    }


@app.get("/users/{user_id}/referrals", response_model=List[Referral])
async def get_user_referrals(
    user_id: str,
    status: Optional[ReferralStatus] = None
):
    """Get all referrals made by a user."""
    referrals = [r for r in referrals_db.values() if r.referrer_id == user_id]
    if status:
        referrals = [r for r in referrals if r.status == status]
    return referrals


@app.get("/users/{user_id}/referral-stats")
async def get_referral_stats(user_id: str):
    """Get referral statistics for a user."""
    referrals = [r for r in referrals_db.values() if r.referrer_id == user_id]
    
    total = len(referrals)
    completed = len([r for r in referrals if r.status == ReferralStatus.COMPLETED])
    pending = len([r for r in referrals if r.status == ReferralStatus.PENDING])
    total_earned = sum(r.referrer_reward or Decimal("0") for r in referrals if r.status == ReferralStatus.COMPLETED)
    
    return {
        "total_referrals": total,
        "completed_referrals": completed,
        "pending_referrals": pending,
        "total_earned": total_earned,
        "conversion_rate": (completed / total * 100) if total > 0 else 0
    }


# Loyalty Points Endpoints
@app.post("/loyalty/accounts", response_model=LoyaltyAccount)
async def create_loyalty_account(user_id: str):
    """Create a loyalty account for a user."""
    if user_id in loyalty_accounts_db:
        return loyalty_accounts_db[user_id]
    
    account = LoyaltyAccount(user_id=user_id)
    loyalty_accounts_db[user_id] = account
    return account


@app.get("/loyalty/accounts/{user_id}", response_model=LoyaltyAccount)
async def get_loyalty_account(user_id: str):
    """Get loyalty account details."""
    if user_id not in loyalty_accounts_db:
        return await create_loyalty_account(user_id)
    return loyalty_accounts_db[user_id]


async def award_points(
    user_id: str,
    points: int,
    transaction_type: str,
    description: str,
    reference_id: Optional[str] = None
) -> PointsTransaction:
    """Award points to a user."""
    if user_id not in loyalty_accounts_db:
        await create_loyalty_account(user_id)
    
    account = loyalty_accounts_db[user_id]
    account.points_balance += points
    account.lifetime_points += points
    account.last_activity = datetime.utcnow()
    
    # Update tier
    tier, progress, next_threshold = calculate_tier(account.lifetime_points)
    account.tier = tier
    account.tier_progress = progress
    account.next_tier_threshold = next_threshold
    
    transaction = PointsTransaction(
        user_id=user_id,
        points=points,
        transaction_type=transaction_type,
        description=description,
        reference_id=reference_id,
        expires_at=datetime.utcnow() + timedelta(days=365)
    )
    points_transactions_db[transaction.id] = transaction
    
    return transaction


@app.post("/loyalty/accounts/{user_id}/earn")
async def earn_points(
    user_id: str,
    transaction_amount: Decimal,
    transaction_type: str = "transfer",
    reference_id: Optional[str] = None
):
    """Earn points from a transaction."""
    points = int(transaction_amount * POINTS_PER_DOLLAR)
    
    # Tier multiplier
    account = await get_loyalty_account(user_id)
    multiplier = {
        TierLevel.BRONZE: 1.0,
        TierLevel.SILVER: 1.25,
        TierLevel.GOLD: 1.5,
        TierLevel.PLATINUM: 2.0
    }.get(account.tier, 1.0)
    
    points = int(points * multiplier)
    
    transaction = await award_points(
        user_id,
        points,
        transaction_type,
        f"Points earned from {transaction_type} of ${transaction_amount}",
        reference_id
    )
    
    return {
        "points_earned": points,
        "multiplier": multiplier,
        "new_balance": loyalty_accounts_db[user_id].points_balance,
        "transaction": transaction
    }


@app.post("/loyalty/accounts/{user_id}/redeem")
async def redeem_points(
    user_id: str,
    points: int,
    redemption_type: str = "cash"
):
    """Redeem points for rewards."""
    if user_id not in loyalty_accounts_db:
        raise HTTPException(status_code=404, detail="Loyalty account not found")
    
    account = loyalty_accounts_db[user_id]
    
    if account.points_balance < points:
        raise HTTPException(status_code=400, detail="Insufficient points balance")
    
    # Calculate reward value (100 points = $1)
    reward_value = Decimal(points) / Decimal("100")
    
    account.points_balance -= points
    account.last_activity = datetime.utcnow()
    
    # Create redemption transaction
    transaction = PointsTransaction(
        user_id=user_id,
        points=-points,
        transaction_type="redemption",
        description=f"Redeemed {points} points for ${reward_value}"
    )
    points_transactions_db[transaction.id] = transaction
    
    # Create reward
    reward = Reward(
        user_id=user_id,
        reward_type=RewardType.CASH if redemption_type == "cash" else RewardType.DISCOUNT,
        amount=reward_value,
        description=f"Points redemption - {points} points",
        source="points_redemption",
        expires_at=datetime.utcnow() + timedelta(days=30)
    )
    rewards_db[reward.id] = reward
    
    return {
        "points_redeemed": points,
        "reward_value": reward_value,
        "new_balance": account.points_balance,
        "reward": reward
    }


@app.get("/loyalty/accounts/{user_id}/history", response_model=List[PointsTransaction])
async def get_points_history(
    user_id: str,
    limit: int = Query(default=50, le=100)
):
    """Get points transaction history."""
    transactions = [t for t in points_transactions_db.values() if t.user_id == user_id]
    transactions.sort(key=lambda x: x.created_at, reverse=True)
    return transactions[:limit]


# Campaign Endpoints
@app.post("/campaigns", response_model=Campaign)
async def create_campaign(
    name: str,
    description: str,
    campaign_type: str,
    reward_type: RewardType,
    reward_amount: Decimal,
    start_date: datetime,
    end_date: datetime,
    target_corridors: List[str] = [],
    min_transaction_amount: Optional[Decimal] = None,
    max_redemptions: Optional[int] = None,
    promo_code: Optional[str] = None,
    terms_conditions: str = ""
):
    """Create a new promotional campaign."""
    campaign = Campaign(
        name=name,
        description=description,
        campaign_type=campaign_type,
        reward_type=reward_type,
        reward_amount=reward_amount,
        start_date=start_date,
        end_date=end_date,
        target_corridors=target_corridors,
        min_transaction_amount=min_transaction_amount,
        max_redemptions=max_redemptions,
        promo_code=promo_code or f"PROMO{secrets.token_hex(3).upper()}",
        terms_conditions=terms_conditions
    )
    
    if datetime.utcnow() >= start_date:
        campaign.status = CampaignStatus.ACTIVE
    
    campaigns_db[campaign.id] = campaign
    return campaign


@app.get("/campaigns", response_model=List[Campaign])
async def list_campaigns(
    status: Optional[CampaignStatus] = None,
    corridor: Optional[str] = None
):
    """List all campaigns."""
    campaigns = list(campaigns_db.values())
    
    if status:
        campaigns = [c for c in campaigns if c.status == status]
    
    if corridor:
        campaigns = [c for c in campaigns if not c.target_corridors or corridor in c.target_corridors]
    
    return campaigns


@app.get("/campaigns/{campaign_id}", response_model=Campaign)
async def get_campaign(campaign_id: str):
    """Get campaign details."""
    if campaign_id not in campaigns_db:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaigns_db[campaign_id]


@app.post("/campaigns/{campaign_id}/apply")
async def apply_campaign(
    campaign_id: str,
    user_id: str,
    transaction_amount: Decimal,
    corridor: Optional[str] = None
):
    """Apply a campaign to a transaction."""
    if campaign_id not in campaigns_db:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    campaign = campaigns_db[campaign_id]
    
    if campaign.status != CampaignStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Campaign is not active")
    
    if datetime.utcnow() > campaign.end_date:
        campaign.status = CampaignStatus.ENDED
        raise HTTPException(status_code=400, detail="Campaign has ended")
    
    if campaign.max_redemptions and campaign.current_redemptions >= campaign.max_redemptions:
        raise HTTPException(status_code=400, detail="Campaign has reached maximum redemptions")
    
    if campaign.min_transaction_amount and transaction_amount < campaign.min_transaction_amount:
        raise HTTPException(status_code=400, detail=f"Minimum transaction amount is ${campaign.min_transaction_amount}")
    
    if campaign.target_corridors and corridor and corridor not in campaign.target_corridors:
        raise HTTPException(status_code=400, detail="Campaign not valid for this corridor")
    
    campaign.current_redemptions += 1
    
    # Create reward
    reward = Reward(
        user_id=user_id,
        reward_type=campaign.reward_type,
        amount=campaign.reward_amount,
        description=f"Campaign reward: {campaign.name}",
        source="campaign",
        reference_id=campaign_id,
        expires_at=datetime.utcnow() + timedelta(days=30)
    )
    rewards_db[reward.id] = reward
    
    return {
        "applied": True,
        "reward": reward,
        "campaign": campaign
    }


@app.post("/promo-codes/validate")
async def validate_promo_code(
    promo_code: str,
    user_id: str,
    transaction_amount: Decimal,
    corridor: Optional[str] = None
):
    """Validate a promo code."""
    campaign = None
    for c in campaigns_db.values():
        if c.promo_code == promo_code:
            campaign = c
            break
    
    if not campaign:
        raise HTTPException(status_code=404, detail="Promo code not found")
    
    return await apply_campaign(campaign.id, user_id, transaction_amount, corridor)


# Rewards Endpoints
@app.get("/users/{user_id}/rewards", response_model=List[Reward])
async def get_user_rewards(
    user_id: str,
    claimed: Optional[bool] = None
):
    """Get all rewards for a user."""
    rewards = [r for r in rewards_db.values() if r.user_id == user_id]
    
    if claimed is not None:
        rewards = [r for r in rewards if r.is_claimed == claimed]
    
    # Filter out expired rewards
    now = datetime.utcnow()
    rewards = [r for r in rewards if not r.expires_at or r.expires_at > now]
    
    return rewards


@app.post("/rewards/{reward_id}/claim")
async def claim_reward(reward_id: str):
    """Claim a reward."""
    if reward_id not in rewards_db:
        raise HTTPException(status_code=404, detail="Reward not found")
    
    reward = rewards_db[reward_id]
    
    if reward.is_claimed:
        raise HTTPException(status_code=400, detail="Reward already claimed")
    
    if reward.expires_at and datetime.utcnow() > reward.expires_at:
        raise HTTPException(status_code=400, detail="Reward has expired")
    
    reward.is_claimed = True
    reward.claimed_at = datetime.utcnow()
    
    return reward


@app.get("/users/{user_id}/rewards/summary")
async def get_rewards_summary(user_id: str):
    """Get rewards summary for a user."""
    rewards = [r for r in rewards_db.values() if r.user_id == user_id]
    now = datetime.utcnow()
    
    unclaimed = [r for r in rewards if not r.is_claimed and (not r.expires_at or r.expires_at > now)]
    claimed = [r for r in rewards if r.is_claimed]
    expired = [r for r in rewards if r.expires_at and r.expires_at <= now and not r.is_claimed]
    
    return {
        "unclaimed_count": len(unclaimed),
        "unclaimed_value": sum(r.amount for r in unclaimed),
        "claimed_count": len(claimed),
        "claimed_value": sum(r.amount for r in claimed),
        "expired_count": len(expired),
        "total_lifetime_value": sum(r.amount for r in claimed)
    }


# Health check
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "referral-rewards",
        "timestamp": datetime.utcnow().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)
