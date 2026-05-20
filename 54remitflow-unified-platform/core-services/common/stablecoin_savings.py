"""
Stablecoin Savings Goals Service

Allows users to create savings goals denominated in stablecoins (USDT/USDC).
Supports auto-convert from incoming remittances.

Features:
- Goals denominated in USD/stablecoin
- Auto-convert percentage of incoming remittances
- Progress tracking and notifications
- Multiple stablecoin support (USDT, USDC, DAI)
- Goal categories (education, emergency, travel, etc.)
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from uuid import uuid4
from decimal import Decimal
from enum import Enum
from dataclasses import dataclass, field

from common.logging_config import get_logger
from common.metrics import MetricsCollector

logger = get_logger(__name__)
metrics = MetricsCollector("stablecoin_savings")


class GoalCategory(Enum):
    EDUCATION = "EDUCATION"
    EMERGENCY = "EMERGENCY"
    TRAVEL = "TRAVEL"
    HOUSING = "HOUSING"
    BUSINESS = "BUSINESS"
    RETIREMENT = "RETIREMENT"
    WEDDING = "WEDDING"
    HEALTHCARE = "HEALTHCARE"
    VEHICLE = "VEHICLE"
    OTHER = "OTHER"


class GoalStatus(Enum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    PAUSED = "PAUSED"
    CANCELLED = "CANCELLED"


class Stablecoin(Enum):
    USDT = "USDT"
    USDC = "USDC"
    DAI = "DAI"
    BUSD = "BUSD"


@dataclass
class AutoConvertRule:
    rule_id: str
    goal_id: str
    source_type: str
    percentage: Decimal
    is_active: bool
    created_at: datetime
    min_amount: Optional[Decimal] = None
    max_amount: Optional[Decimal] = None


@dataclass
class SavingsContribution:
    contribution_id: str
    goal_id: str
    amount: Decimal
    stablecoin: Stablecoin
    source_type: str
    source_reference: Optional[str]
    fx_rate: Decimal
    original_amount: Optional[Decimal]
    original_currency: Optional[str]
    created_at: datetime


@dataclass
class SavingsGoal:
    goal_id: str
    user_id: str
    name: str
    category: GoalCategory
    target_amount: Decimal
    current_amount: Decimal
    stablecoin: Stablecoin
    status: GoalStatus
    target_date: Optional[datetime]
    created_at: datetime
    completed_at: Optional[datetime]
    contributions: List[SavingsContribution] = field(default_factory=list)
    auto_convert_rules: List[AutoConvertRule] = field(default_factory=list)
    description: Optional[str] = None
    icon: Optional[str] = None


class StablecoinSavingsService:
    """
    Stablecoin savings goals with auto-convert from remittances.
    
    Allows users to save in stable USD-denominated assets with
    automatic conversion from incoming transfers.
    """
    
    FX_RATES = {
        ("NGN", "USD"): Decimal("0.00065"),
        ("GHS", "USD"): Decimal("0.083"),
        ("KES", "USD"): Decimal("0.0065"),
        ("ZAR", "USD"): Decimal("0.055"),
        ("INR", "USD"): Decimal("0.012"),
        ("BRL", "USD"): Decimal("0.202"),
        ("CNY", "USD"): Decimal("0.138"),
        ("GBP", "USD"): Decimal("1.27"),
        ("EUR", "USD"): Decimal("1.09"),
    }
    
    CATEGORY_ICONS = {
        GoalCategory.EDUCATION: "🎓",
        GoalCategory.EMERGENCY: "🚨",
        GoalCategory.TRAVEL: "✈️",
        GoalCategory.HOUSING: "🏠",
        GoalCategory.BUSINESS: "💼",
        GoalCategory.RETIREMENT: "🏖️",
        GoalCategory.WEDDING: "💒",
        GoalCategory.HEALTHCARE: "🏥",
        GoalCategory.VEHICLE: "🚗",
        GoalCategory.OTHER: "💰",
    }
    
    def __init__(self):
        self.goals: Dict[str, SavingsGoal] = {}
        self.user_goals: Dict[str, List[str]] = {}
        
    async def create_goal(
        self,
        user_id: str,
        name: str,
        target_amount: Decimal,
        category: GoalCategory = GoalCategory.OTHER,
        stablecoin: Stablecoin = Stablecoin.USDT,
        target_date: Optional[datetime] = None,
        description: Optional[str] = None,
        auto_convert_percentage: Optional[Decimal] = None
    ) -> SavingsGoal:
        """Create a new savings goal."""
        
        goal_id = str(uuid4())
        
        goal = SavingsGoal(
            goal_id=goal_id,
            user_id=user_id,
            name=name,
            category=category,
            target_amount=target_amount,
            current_amount=Decimal("0"),
            stablecoin=stablecoin,
            status=GoalStatus.ACTIVE,
            target_date=target_date,
            created_at=datetime.utcnow(),
            completed_at=None,
            description=description,
            icon=self.CATEGORY_ICONS.get(category, "💰")
        )
        
        if auto_convert_percentage and auto_convert_percentage > 0:
            rule = AutoConvertRule(
                rule_id=str(uuid4()),
                goal_id=goal_id,
                source_type="REMITTANCE_INCOMING",
                percentage=auto_convert_percentage,
                is_active=True,
                created_at=datetime.utcnow()
            )
            goal.auto_convert_rules.append(rule)
        
        self.goals[goal_id] = goal
        
        if user_id not in self.user_goals:
            self.user_goals[user_id] = []
        self.user_goals[user_id].append(goal_id)
        
        metrics.increment("savings_goals_created")
        logger.info(f"Created savings goal {goal_id} for user {user_id}")
        
        return goal
    
    async def add_contribution(
        self,
        goal_id: str,
        amount: Decimal,
        source_currency: str,
        source_type: str = "MANUAL",
        source_reference: Optional[str] = None
    ) -> SavingsContribution:
        """Add a contribution to a savings goal."""
        
        goal = self.goals.get(goal_id)
        if not goal:
            raise ValueError(f"Goal {goal_id} not found")
        
        if goal.status != GoalStatus.ACTIVE:
            raise ValueError(f"Goal {goal_id} is not active")
        
        fx_rate = await self._get_fx_rate(source_currency, "USD")
        usd_amount = amount * fx_rate
        
        contribution = SavingsContribution(
            contribution_id=str(uuid4()),
            goal_id=goal_id,
            amount=usd_amount,
            stablecoin=goal.stablecoin,
            source_type=source_type,
            source_reference=source_reference,
            fx_rate=fx_rate,
            original_amount=amount,
            original_currency=source_currency,
            created_at=datetime.utcnow()
        )
        
        goal.contributions.append(contribution)
        goal.current_amount += usd_amount
        
        if goal.current_amount >= goal.target_amount:
            goal.status = GoalStatus.COMPLETED
            goal.completed_at = datetime.utcnow()
            metrics.increment("savings_goals_completed")
        
        metrics.increment("savings_contributions")
        metrics.increment("savings_amount_usd", float(usd_amount))
        
        return contribution
    
    async def process_incoming_remittance(
        self,
        user_id: str,
        amount: Decimal,
        currency: str,
        transfer_id: str
    ) -> List[SavingsContribution]:
        """Process incoming remittance and apply auto-convert rules."""
        
        contributions = []
        
        goal_ids = self.user_goals.get(user_id, [])
        
        for goal_id in goal_ids:
            goal = self.goals.get(goal_id)
            if not goal or goal.status != GoalStatus.ACTIVE:
                continue
            
            for rule in goal.auto_convert_rules:
                if not rule.is_active:
                    continue
                
                if rule.source_type != "REMITTANCE_INCOMING":
                    continue
                
                if rule.min_amount and amount < rule.min_amount:
                    continue
                
                if rule.max_amount and amount > rule.max_amount:
                    continue
                
                convert_amount = amount * (rule.percentage / 100)
                
                contribution = await self.add_contribution(
                    goal_id=goal_id,
                    amount=convert_amount,
                    source_currency=currency,
                    source_type="AUTO_CONVERT",
                    source_reference=transfer_id
                )
                
                contributions.append(contribution)
                
                logger.info(
                    f"Auto-converted {convert_amount} {currency} to goal {goal_id} "
                    f"({rule.percentage}% of {amount} {currency})"
                )
        
        return contributions
    
    async def get_goal(self, goal_id: str) -> Optional[SavingsGoal]:
        """Get a savings goal by ID."""
        return self.goals.get(goal_id)
    
    async def get_user_goals(
        self,
        user_id: str,
        status: Optional[GoalStatus] = None
    ) -> List[SavingsGoal]:
        """Get all savings goals for a user."""
        goal_ids = self.user_goals.get(user_id, [])
        goals = []
        
        for goal_id in goal_ids:
            goal = self.goals.get(goal_id)
            if goal:
                if status and goal.status != status:
                    continue
                goals.append(goal)
        
        return goals
    
    async def get_goal_summary(self, goal_id: str) -> Dict[str, Any]:
        """Get a summary of a savings goal."""
        goal = self.goals.get(goal_id)
        if not goal:
            return {"error": "Goal not found"}
        
        progress_percent = float((goal.current_amount / goal.target_amount) * 100) if goal.target_amount > 0 else 0
        
        days_to_target = None
        if goal.target_date and goal.status == GoalStatus.ACTIVE:
            days_to_target = (goal.target_date - datetime.utcnow()).days
        
        avg_contribution = Decimal("0")
        if goal.contributions:
            avg_contribution = sum(c.amount for c in goal.contributions) / len(goal.contributions)
        
        monthly_needed = Decimal("0")
        if goal.target_date and goal.status == GoalStatus.ACTIVE:
            remaining = goal.target_amount - goal.current_amount
            months_left = max(1, (goal.target_date - datetime.utcnow()).days / 30)
            monthly_needed = remaining / Decimal(str(months_left))
        
        return {
            "goal_id": goal.goal_id,
            "name": goal.name,
            "category": goal.category.value,
            "icon": goal.icon,
            "status": goal.status.value,
            "target_amount": float(goal.target_amount),
            "current_amount": float(goal.current_amount),
            "remaining_amount": float(goal.target_amount - goal.current_amount),
            "progress_percent": min(100, progress_percent),
            "stablecoin": goal.stablecoin.value,
            "target_date": goal.target_date.isoformat() if goal.target_date else None,
            "days_to_target": days_to_target,
            "contribution_count": len(goal.contributions),
            "avg_contribution": float(avg_contribution),
            "monthly_needed": float(monthly_needed),
            "auto_convert_rules": [
                {
                    "rule_id": r.rule_id,
                    "source_type": r.source_type,
                    "percentage": float(r.percentage),
                    "is_active": r.is_active
                }
                for r in goal.auto_convert_rules
            ],
            "created_at": goal.created_at.isoformat(),
            "completed_at": goal.completed_at.isoformat() if goal.completed_at else None
        }
    
    async def add_auto_convert_rule(
        self,
        goal_id: str,
        percentage: Decimal,
        source_type: str = "REMITTANCE_INCOMING",
        min_amount: Optional[Decimal] = None,
        max_amount: Optional[Decimal] = None
    ) -> AutoConvertRule:
        """Add an auto-convert rule to a goal."""
        
        goal = self.goals.get(goal_id)
        if not goal:
            raise ValueError(f"Goal {goal_id} not found")
        
        if percentage <= 0 or percentage > 100:
            raise ValueError("Percentage must be between 0 and 100")
        
        rule = AutoConvertRule(
            rule_id=str(uuid4()),
            goal_id=goal_id,
            source_type=source_type,
            percentage=percentage,
            is_active=True,
            created_at=datetime.utcnow(),
            min_amount=min_amount,
            max_amount=max_amount
        )
        
        goal.auto_convert_rules.append(rule)
        
        return rule
    
    async def update_auto_convert_rule(
        self,
        goal_id: str,
        rule_id: str,
        percentage: Optional[Decimal] = None,
        is_active: Optional[bool] = None
    ) -> AutoConvertRule:
        """Update an auto-convert rule."""
        
        goal = self.goals.get(goal_id)
        if not goal:
            raise ValueError(f"Goal {goal_id} not found")
        
        rule = next((r for r in goal.auto_convert_rules if r.rule_id == rule_id), None)
        if not rule:
            raise ValueError(f"Rule {rule_id} not found")
        
        if percentage is not None:
            if percentage <= 0 or percentage > 100:
                raise ValueError("Percentage must be between 0 and 100")
            rule.percentage = percentage
        
        if is_active is not None:
            rule.is_active = is_active
        
        return rule
    
    async def pause_goal(self, goal_id: str) -> SavingsGoal:
        """Pause a savings goal."""
        goal = self.goals.get(goal_id)
        if not goal:
            raise ValueError(f"Goal {goal_id} not found")
        
        goal.status = GoalStatus.PAUSED
        
        for rule in goal.auto_convert_rules:
            rule.is_active = False
        
        return goal
    
    async def resume_goal(self, goal_id: str) -> SavingsGoal:
        """Resume a paused savings goal."""
        goal = self.goals.get(goal_id)
        if not goal:
            raise ValueError(f"Goal {goal_id} not found")
        
        if goal.status != GoalStatus.PAUSED:
            raise ValueError(f"Goal {goal_id} is not paused")
        
        goal.status = GoalStatus.ACTIVE
        
        for rule in goal.auto_convert_rules:
            rule.is_active = True
        
        return goal
    
    async def cancel_goal(self, goal_id: str) -> SavingsGoal:
        """Cancel a savings goal."""
        goal = self.goals.get(goal_id)
        if not goal:
            raise ValueError(f"Goal {goal_id} not found")
        
        goal.status = GoalStatus.CANCELLED
        
        for rule in goal.auto_convert_rules:
            rule.is_active = False
        
        return goal
    
    async def withdraw_from_goal(
        self,
        goal_id: str,
        amount: Decimal,
        destination_currency: str
    ) -> Dict[str, Any]:
        """Withdraw funds from a savings goal."""
        
        goal = self.goals.get(goal_id)
        if not goal:
            raise ValueError(f"Goal {goal_id} not found")
        
        if amount > goal.current_amount:
            raise ValueError("Insufficient balance in goal")
        
        fx_rate = await self._get_fx_rate("USD", destination_currency)
        destination_amount = amount * fx_rate
        
        goal.current_amount -= amount
        
        if goal.current_amount < goal.target_amount and goal.status == GoalStatus.COMPLETED:
            goal.status = GoalStatus.ACTIVE
            goal.completed_at = None
        
        return {
            "goal_id": goal_id,
            "withdrawn_amount": float(amount),
            "withdrawn_stablecoin": goal.stablecoin.value,
            "destination_amount": float(destination_amount),
            "destination_currency": destination_currency,
            "fx_rate": float(fx_rate),
            "remaining_balance": float(goal.current_amount)
        }
    
    async def _get_fx_rate(self, from_currency: str, to_currency: str) -> Decimal:
        """Get FX rate for currency pair."""
        if from_currency == to_currency:
            return Decimal("1.0")
        
        if from_currency == "USD" and to_currency != "USD":
            inverse_rate = self.FX_RATES.get((to_currency, "USD"))
            if inverse_rate:
                return Decimal("1") / inverse_rate
        
        rate = self.FX_RATES.get((from_currency, to_currency))
        if rate:
            return rate
        
        return Decimal("1.0")


def get_stablecoin_savings_service() -> StablecoinSavingsService:
    """Factory function to get stablecoin savings service instance."""
    return StablecoinSavingsService()
