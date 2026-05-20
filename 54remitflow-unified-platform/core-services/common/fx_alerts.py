"""
FX Alerts and Loyalty Rewards Service

Provides:
- FX rate alerts when rates hit user-defined thresholds
- Fee alerts when corridor fees drop below thresholds
- Loyalty rewards for platform usage
- Tiered benefits based on volume/tenure

Features:
- Real-time rate monitoring
- Multi-channel notifications (SMS, WhatsApp, Push, Email)
- Reward points for transfers, referrals, stablecoin usage
- Tiered membership levels with benefits
"""

from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from uuid import uuid4
from decimal import Decimal
from enum import Enum
from dataclasses import dataclass, field

from common.logging_config import get_logger
from common.metrics import MetricsCollector

logger = get_logger(__name__)
metrics = MetricsCollector("fx_alerts")


class AlertType(Enum):
    RATE_ABOVE = "RATE_ABOVE"
    RATE_BELOW = "RATE_BELOW"
    FEE_BELOW = "FEE_BELOW"
    RATE_CHANGE = "RATE_CHANGE"


class AlertStatus(Enum):
    ACTIVE = "ACTIVE"
    TRIGGERED = "TRIGGERED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class MembershipTier(Enum):
    BRONZE = "BRONZE"
    SILVER = "SILVER"
    GOLD = "GOLD"
    PLATINUM = "PLATINUM"
    DIAMOND = "DIAMOND"


class RewardType(Enum):
    TRANSFER_COMPLETED = "TRANSFER_COMPLETED"
    REFERRAL_SIGNUP = "REFERRAL_SIGNUP"
    REFERRAL_FIRST_TRANSFER = "REFERRAL_FIRST_TRANSFER"
    STABLECOIN_USAGE = "STABLECOIN_USAGE"
    OFF_PEAK_TRANSFER = "OFF_PEAK_TRANSFER"
    CHEAPEST_CORRIDOR = "CHEAPEST_CORRIDOR"
    SAVINGS_GOAL_COMPLETED = "SAVINGS_GOAL_COMPLETED"
    MILESTONE_REACHED = "MILESTONE_REACHED"


@dataclass
class FXAlert:
    alert_id: str
    user_id: str
    alert_type: AlertType
    source_currency: str
    destination_currency: str
    threshold_value: Decimal
    current_value: Optional[Decimal]
    corridor: Optional[str]
    status: AlertStatus
    created_at: datetime
    expires_at: Optional[datetime]
    triggered_at: Optional[datetime]
    notification_channels: List[str]


@dataclass
class RewardTransaction:
    transaction_id: str
    user_id: str
    reward_type: RewardType
    points: int
    description: str
    reference_id: Optional[str]
    created_at: datetime


@dataclass
class UserLoyalty:
    user_id: str
    tier: MembershipTier
    total_points: int
    available_points: int
    lifetime_volume: Decimal
    transfer_count: int
    referral_count: int
    member_since: datetime
    tier_expires_at: Optional[datetime]
    rewards: List[RewardTransaction] = field(default_factory=list)


class FXAlertService:
    """
    FX alerts and loyalty rewards service.
    
    Monitors FX rates and notifies users when thresholds are hit.
    Manages loyalty points and tiered membership benefits.
    """
    
    FX_RATES = {
        ("NGN", "USD"): Decimal("0.00065"),
        ("USD", "NGN"): Decimal("1538.46"),
        ("NGN", "GHS"): Decimal("0.0078"),
        ("GHS", "NGN"): Decimal("128.21"),
        ("NGN", "KES"): Decimal("0.084"),
        ("USD", "INR"): Decimal("83.50"),
        ("USD", "BRL"): Decimal("4.95"),
        ("USD", "CNY"): Decimal("7.25"),
        ("GBP", "NGN"): Decimal("1950.00"),
        ("EUR", "NGN"): Decimal("1680.00"),
    }
    
    TIER_THRESHOLDS = {
        MembershipTier.BRONZE: {"volume": Decimal("0"), "points": 0},
        MembershipTier.SILVER: {"volume": Decimal("1000"), "points": 1000},
        MembershipTier.GOLD: {"volume": Decimal("5000"), "points": 5000},
        MembershipTier.PLATINUM: {"volume": Decimal("25000"), "points": 25000},
        MembershipTier.DIAMOND: {"volume": Decimal("100000"), "points": 100000},
    }
    
    TIER_BENEFITS = {
        MembershipTier.BRONZE: {
            "fee_discount_percent": Decimal("0"),
            "priority_support": False,
            "free_transfers_per_month": 0,
            "cashback_percent": Decimal("0"),
        },
        MembershipTier.SILVER: {
            "fee_discount_percent": Decimal("5"),
            "priority_support": False,
            "free_transfers_per_month": 1,
            "cashback_percent": Decimal("0.1"),
        },
        MembershipTier.GOLD: {
            "fee_discount_percent": Decimal("10"),
            "priority_support": True,
            "free_transfers_per_month": 3,
            "cashback_percent": Decimal("0.25"),
        },
        MembershipTier.PLATINUM: {
            "fee_discount_percent": Decimal("15"),
            "priority_support": True,
            "free_transfers_per_month": 5,
            "cashback_percent": Decimal("0.5"),
        },
        MembershipTier.DIAMOND: {
            "fee_discount_percent": Decimal("25"),
            "priority_support": True,
            "free_transfers_per_month": 10,
            "cashback_percent": Decimal("1.0"),
        },
    }
    
    REWARD_POINTS = {
        RewardType.TRANSFER_COMPLETED: 10,
        RewardType.REFERRAL_SIGNUP: 50,
        RewardType.REFERRAL_FIRST_TRANSFER: 100,
        RewardType.STABLECOIN_USAGE: 15,
        RewardType.OFF_PEAK_TRANSFER: 5,
        RewardType.CHEAPEST_CORRIDOR: 5,
        RewardType.SAVINGS_GOAL_COMPLETED: 200,
        RewardType.MILESTONE_REACHED: 500,
    }
    
    def __init__(self):
        self.alerts: Dict[str, FXAlert] = {}
        self.user_alerts: Dict[str, List[str]] = {}
        self.user_loyalty: Dict[str, UserLoyalty] = {}
        
    async def create_rate_alert(
        self,
        user_id: str,
        source_currency: str,
        destination_currency: str,
        alert_type: AlertType,
        threshold_value: Decimal,
        corridor: Optional[str] = None,
        expires_in_days: int = 30,
        notification_channels: Optional[List[str]] = None
    ) -> FXAlert:
        """Create an FX rate alert."""
        
        alert_id = str(uuid4())
        
        current_rate = await self._get_current_rate(source_currency, destination_currency)
        
        alert = FXAlert(
            alert_id=alert_id,
            user_id=user_id,
            alert_type=alert_type,
            source_currency=source_currency,
            destination_currency=destination_currency,
            threshold_value=threshold_value,
            current_value=current_rate,
            corridor=corridor,
            status=AlertStatus.ACTIVE,
            created_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=expires_in_days),
            triggered_at=None,
            notification_channels=notification_channels or ["PUSH", "EMAIL"]
        )
        
        self.alerts[alert_id] = alert
        
        if user_id not in self.user_alerts:
            self.user_alerts[user_id] = []
        self.user_alerts[user_id].append(alert_id)
        
        metrics.increment("fx_alerts_created")
        
        return alert
    
    async def check_alerts(self) -> List[FXAlert]:
        """Check all active alerts and trigger those that hit thresholds."""
        
        triggered = []
        now = datetime.utcnow()
        
        for alert in self.alerts.values():
            if alert.status != AlertStatus.ACTIVE:
                continue
            
            if alert.expires_at and now > alert.expires_at:
                alert.status = AlertStatus.EXPIRED
                continue
            
            current_rate = await self._get_current_rate(
                alert.source_currency,
                alert.destination_currency
            )
            alert.current_value = current_rate
            
            should_trigger = False
            
            if alert.alert_type == AlertType.RATE_ABOVE:
                should_trigger = current_rate >= alert.threshold_value
            elif alert.alert_type == AlertType.RATE_BELOW:
                should_trigger = current_rate <= alert.threshold_value
            elif alert.alert_type == AlertType.RATE_CHANGE:
                change_percent = abs((current_rate - alert.threshold_value) / alert.threshold_value * 100)
                should_trigger = change_percent >= 1
            
            if should_trigger:
                alert.status = AlertStatus.TRIGGERED
                alert.triggered_at = now
                triggered.append(alert)
                metrics.increment("fx_alerts_triggered")
        
        return triggered
    
    async def get_user_alerts(
        self,
        user_id: str,
        active_only: bool = True
    ) -> List[FXAlert]:
        """Get all alerts for a user."""
        
        alert_ids = self.user_alerts.get(user_id, [])
        alerts = []
        
        for alert_id in alert_ids:
            alert = self.alerts.get(alert_id)
            if alert:
                if active_only and alert.status != AlertStatus.ACTIVE:
                    continue
                alerts.append(alert)
        
        return alerts
    
    async def cancel_alert(self, alert_id: str) -> FXAlert:
        """Cancel an alert."""
        
        alert = self.alerts.get(alert_id)
        if not alert:
            raise ValueError(f"Alert {alert_id} not found")
        
        alert.status = AlertStatus.CANCELLED
        return alert
    
    async def get_or_create_loyalty(self, user_id: str) -> UserLoyalty:
        """Get or create loyalty profile for a user."""
        
        if user_id not in self.user_loyalty:
            self.user_loyalty[user_id] = UserLoyalty(
                user_id=user_id,
                tier=MembershipTier.BRONZE,
                total_points=0,
                available_points=0,
                lifetime_volume=Decimal("0"),
                transfer_count=0,
                referral_count=0,
                member_since=datetime.utcnow(),
                tier_expires_at=None
            )
        
        return self.user_loyalty[user_id]
    
    async def award_points(
        self,
        user_id: str,
        reward_type: RewardType,
        reference_id: Optional[str] = None,
        bonus_multiplier: Decimal = Decimal("1.0")
    ) -> RewardTransaction:
        """Award loyalty points to a user."""
        
        loyalty = await self.get_or_create_loyalty(user_id)
        
        base_points = self.REWARD_POINTS.get(reward_type, 0)
        points = int(base_points * bonus_multiplier)
        
        transaction = RewardTransaction(
            transaction_id=str(uuid4()),
            user_id=user_id,
            reward_type=reward_type,
            points=points,
            description=f"Earned {points} points for {reward_type.value}",
            reference_id=reference_id,
            created_at=datetime.utcnow()
        )
        
        loyalty.rewards.append(transaction)
        loyalty.total_points += points
        loyalty.available_points += points
        
        await self._check_tier_upgrade(loyalty)
        
        metrics.increment("loyalty_points_awarded", points)
        
        return transaction
    
    async def record_transfer(
        self,
        user_id: str,
        amount_usd: Decimal,
        corridor: str,
        used_stablecoin: bool = False,
        used_cheapest_corridor: bool = False,
        is_off_peak: bool = False
    ) -> List[RewardTransaction]:
        """Record a transfer and award applicable rewards."""
        
        loyalty = await self.get_or_create_loyalty(user_id)
        
        loyalty.lifetime_volume += amount_usd
        loyalty.transfer_count += 1
        
        rewards = []
        
        transfer_reward = await self.award_points(
            user_id=user_id,
            reward_type=RewardType.TRANSFER_COMPLETED
        )
        rewards.append(transfer_reward)
        
        if used_stablecoin:
            stablecoin_reward = await self.award_points(
                user_id=user_id,
                reward_type=RewardType.STABLECOIN_USAGE
            )
            rewards.append(stablecoin_reward)
        
        if used_cheapest_corridor:
            corridor_reward = await self.award_points(
                user_id=user_id,
                reward_type=RewardType.CHEAPEST_CORRIDOR
            )
            rewards.append(corridor_reward)
        
        if is_off_peak:
            off_peak_reward = await self.award_points(
                user_id=user_id,
                reward_type=RewardType.OFF_PEAK_TRANSFER
            )
            rewards.append(off_peak_reward)
        
        milestones = [10, 25, 50, 100, 250, 500, 1000]
        if loyalty.transfer_count in milestones:
            milestone_reward = await self.award_points(
                user_id=user_id,
                reward_type=RewardType.MILESTONE_REACHED,
                bonus_multiplier=Decimal(str(loyalty.transfer_count / 10))
            )
            rewards.append(milestone_reward)
        
        await self._check_tier_upgrade(loyalty)
        
        return rewards
    
    async def record_referral(
        self,
        referrer_user_id: str,
        referred_user_id: str,
        is_first_transfer: bool = False
    ) -> RewardTransaction:
        """Record a referral and award points."""
        
        loyalty = await self.get_or_create_loyalty(referrer_user_id)
        loyalty.referral_count += 1
        
        if is_first_transfer:
            reward = await self.award_points(
                user_id=referrer_user_id,
                reward_type=RewardType.REFERRAL_FIRST_TRANSFER,
                reference_id=referred_user_id
            )
        else:
            reward = await self.award_points(
                user_id=referrer_user_id,
                reward_type=RewardType.REFERRAL_SIGNUP,
                reference_id=referred_user_id
            )
        
        return reward
    
    async def redeem_points(
        self,
        user_id: str,
        points: int,
        redemption_type: str
    ) -> Dict[str, Any]:
        """Redeem loyalty points."""
        
        loyalty = await self.get_or_create_loyalty(user_id)
        
        if points > loyalty.available_points:
            raise ValueError("Insufficient points")
        
        loyalty.available_points -= points
        
        value = Decimal("0")
        if redemption_type == "CASHBACK":
            value = Decimal(str(points)) * Decimal("0.01")
        elif redemption_type == "FEE_CREDIT":
            value = Decimal(str(points)) * Decimal("0.02")
        
        metrics.increment("loyalty_points_redeemed", points)
        
        return {
            "user_id": user_id,
            "points_redeemed": points,
            "redemption_type": redemption_type,
            "value": float(value),
            "remaining_points": loyalty.available_points
        }
    
    async def get_loyalty_summary(self, user_id: str) -> Dict[str, Any]:
        """Get loyalty summary for a user."""
        
        loyalty = await self.get_or_create_loyalty(user_id)
        benefits = self.TIER_BENEFITS.get(loyalty.tier, {})
        
        next_tier = None
        points_to_next_tier = 0
        
        tier_order = list(MembershipTier)
        current_idx = tier_order.index(loyalty.tier)
        if current_idx < len(tier_order) - 1:
            next_tier = tier_order[current_idx + 1]
            next_threshold = self.TIER_THRESHOLDS[next_tier]["points"]
            points_to_next_tier = max(0, next_threshold - loyalty.total_points)
        
        return {
            "user_id": user_id,
            "tier": loyalty.tier.value,
            "total_points": loyalty.total_points,
            "available_points": loyalty.available_points,
            "lifetime_volume_usd": float(loyalty.lifetime_volume),
            "transfer_count": loyalty.transfer_count,
            "referral_count": loyalty.referral_count,
            "member_since": loyalty.member_since.isoformat(),
            "benefits": {
                "fee_discount_percent": float(benefits.get("fee_discount_percent", 0)),
                "priority_support": benefits.get("priority_support", False),
                "free_transfers_per_month": benefits.get("free_transfers_per_month", 0),
                "cashback_percent": float(benefits.get("cashback_percent", 0)),
            },
            "next_tier": next_tier.value if next_tier else None,
            "points_to_next_tier": points_to_next_tier,
            "recent_rewards": [
                {
                    "type": r.reward_type.value,
                    "points": r.points,
                    "description": r.description,
                    "created_at": r.created_at.isoformat()
                }
                for r in loyalty.rewards[-10:]
            ]
        }
    
    async def get_rate_history(
        self,
        source_currency: str,
        destination_currency: str,
        days: int = 30
    ) -> Dict[str, Any]:
        """Get historical rate data for a currency pair."""
        
        current_rate = await self._get_current_rate(source_currency, destination_currency)
        
        history = []
        for i in range(days):
            date = datetime.utcnow() - timedelta(days=i)
            variation = Decimal("1") + (Decimal(str(i % 5 - 2)) * Decimal("0.001"))
            rate = current_rate * variation
            history.append({
                "date": date.strftime("%Y-%m-%d"),
                "rate": float(rate)
            })
        
        history.reverse()
        
        rates = [h["rate"] for h in history]
        
        return {
            "source_currency": source_currency,
            "destination_currency": destination_currency,
            "current_rate": float(current_rate),
            "history": history,
            "min_rate": min(rates),
            "max_rate": max(rates),
            "avg_rate": sum(rates) / len(rates),
            "trend": "UP" if rates[-1] > rates[0] else "DOWN" if rates[-1] < rates[0] else "STABLE"
        }
    
    async def _get_current_rate(
        self,
        source_currency: str,
        destination_currency: str
    ) -> Decimal:
        """Get current FX rate."""
        
        if source_currency == destination_currency:
            return Decimal("1.0")
        
        rate = self.FX_RATES.get((source_currency, destination_currency))
        if rate:
            return rate
        
        if source_currency != "USD" and destination_currency != "USD":
            source_to_usd = self.FX_RATES.get((source_currency, "USD"), Decimal("1.0"))
            usd_to_dest = self.FX_RATES.get(("USD", destination_currency), Decimal("1.0"))
            return source_to_usd * usd_to_dest
        
        return Decimal("1.0")
    
    async def _check_tier_upgrade(self, loyalty: UserLoyalty):
        """Check if user qualifies for tier upgrade."""
        
        for tier in reversed(list(MembershipTier)):
            threshold = self.TIER_THRESHOLDS[tier]
            if (loyalty.total_points >= threshold["points"] or 
                loyalty.lifetime_volume >= threshold["volume"]):
                if tier.value > loyalty.tier.value:
                    loyalty.tier = tier
                    loyalty.tier_expires_at = datetime.utcnow() + timedelta(days=365)
                    metrics.increment(f"tier_upgrades_{tier.value.lower()}")
                break


def get_fx_alert_service() -> FXAlertService:
    """Factory function to get FX alert service instance."""
    return FXAlertService()
