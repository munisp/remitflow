"""
Corridor Routing Policy Engine

Automatic corridor selection based on:
- Country/currency pair
- Cost optimization
- SLA requirements
- KYC tier restrictions
- Corridor health status
- User preferences
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class Corridor(str, Enum):
    MOJALOOP = "mojaloop"
    PAPSS = "papss"
    UPI = "upi"
    PIX = "pix"
    NIBSS = "nibss"
    SWIFT = "swift"
    INTERNAL = "internal"


class KYCTier(str, Enum):
    TIER_0 = "tier_0"  # Unverified
    TIER_1 = "tier_1"  # Basic KYC
    TIER_2 = "tier_2"  # Enhanced KYC
    TIER_3 = "tier_3"  # Full KYC


class RoutingPriority(str, Enum):
    COST = "cost"
    SPEED = "speed"
    RELIABILITY = "reliability"


class CorridorConfig(BaseModel):
    """Configuration for a payment corridor"""
    corridor: Corridor
    enabled: bool = True
    
    # Supported routes
    source_countries: List[str]
    destination_countries: List[str]
    source_currencies: List[str]
    destination_currencies: List[str]
    
    # Limits
    min_amount: float = 0.0
    max_amount: float = float('inf')
    min_kyc_tier: KYCTier = KYCTier.TIER_1
    
    # Cost
    fixed_fee: float = 0.0
    percentage_fee: float = 0.0
    fx_markup: float = 0.0  # Percentage markup on FX rate
    
    # Performance
    avg_settlement_hours: float = 24.0
    success_rate: float = 99.0
    
    # Priority score (higher = preferred)
    priority: int = 50


class RoutingRequest(BaseModel):
    """Request for corridor routing decision"""
    source_country: str
    destination_country: str
    source_currency: str
    destination_currency: str
    amount: float
    user_kyc_tier: KYCTier = KYCTier.TIER_1
    priority: RoutingPriority = RoutingPriority.COST
    preferred_corridor: Optional[Corridor] = None


class RoutingDecision(BaseModel):
    """Corridor routing decision"""
    selected_corridor: Corridor
    reason: str
    estimated_fee: float
    estimated_settlement_hours: float
    alternatives: List[Dict[str, Any]] = []
    routing_metadata: Dict[str, Any] = {}


# Default corridor configurations
CORRIDOR_CONFIGS: Dict[Corridor, CorridorConfig] = {
    Corridor.NIBSS: CorridorConfig(
        corridor=Corridor.NIBSS,
        source_countries=["NG"],
        destination_countries=["NG"],
        source_currencies=["NGN"],
        destination_currencies=["NGN"],
        min_amount=100,
        max_amount=10000000,
        min_kyc_tier=KYCTier.TIER_1,
        fixed_fee=10.0,
        percentage_fee=0.0,
        avg_settlement_hours=0.5,
        success_rate=99.5,
        priority=100  # Highest priority for domestic
    ),
    Corridor.PAPSS: CorridorConfig(
        corridor=Corridor.PAPSS,
        source_countries=["NG", "GH", "KE", "ZA", "EG", "MA", "TZ", "UG", "RW", "SN"],
        destination_countries=["NG", "GH", "KE", "ZA", "EG", "MA", "TZ", "UG", "RW", "SN"],
        source_currencies=["NGN", "GHS", "KES", "ZAR", "EGP", "MAD", "TZS", "UGX", "RWF", "XOF"],
        destination_currencies=["NGN", "GHS", "KES", "ZAR", "EGP", "MAD", "TZS", "UGX", "RWF", "XOF"],
        min_amount=1000,
        max_amount=5000000,
        min_kyc_tier=KYCTier.TIER_1,
        fixed_fee=500.0,
        percentage_fee=0.5,
        fx_markup=0.5,
        avg_settlement_hours=4.0,
        success_rate=97.0,
        priority=90  # High priority for intra-Africa
    ),
    Corridor.MOJALOOP: CorridorConfig(
        corridor=Corridor.MOJALOOP,
        source_countries=["NG", "GH", "KE", "TZ", "UG", "RW"],
        destination_countries=["NG", "GH", "KE", "TZ", "UG", "RW"],
        source_currencies=["NGN", "GHS", "KES", "TZS", "UGX", "RWF"],
        destination_currencies=["NGN", "GHS", "KES", "TZS", "UGX", "RWF"],
        min_amount=500,
        max_amount=2000000,
        min_kyc_tier=KYCTier.TIER_1,
        fixed_fee=200.0,
        percentage_fee=0.3,
        fx_markup=0.3,
        avg_settlement_hours=2.0,
        success_rate=98.5,
        priority=85
    ),
    Corridor.UPI: CorridorConfig(
        corridor=Corridor.UPI,
        source_countries=["NG", "GH", "KE", "ZA", "GB", "US", "AE"],
        destination_countries=["IN"],
        source_currencies=["NGN", "GHS", "KES", "ZAR", "GBP", "USD", "AED"],
        destination_currencies=["INR"],
        min_amount=1000,
        max_amount=10000000,
        min_kyc_tier=KYCTier.TIER_2,
        fixed_fee=1000.0,
        percentage_fee=0.8,
        fx_markup=1.0,
        avg_settlement_hours=24.0,
        success_rate=94.0,
        priority=70
    ),
    Corridor.PIX: CorridorConfig(
        corridor=Corridor.PIX,
        source_countries=["NG", "GH", "KE", "ZA", "GB", "US", "PT"],
        destination_countries=["BR"],
        source_currencies=["NGN", "GHS", "KES", "ZAR", "GBP", "USD", "EUR"],
        destination_currencies=["BRL"],
        min_amount=1000,
        max_amount=50000000,
        min_kyc_tier=KYCTier.TIER_2,
        fixed_fee=500.0,
        percentage_fee=0.5,
        fx_markup=0.8,
        avg_settlement_hours=1.0,
        success_rate=99.0,
        priority=80
    ),
    Corridor.SWIFT: CorridorConfig(
        corridor=Corridor.SWIFT,
        source_countries=["NG", "GH", "KE", "ZA", "GB", "US", "AE", "CN"],
        destination_countries=["*"],  # Global
        source_currencies=["NGN", "GHS", "KES", "ZAR", "GBP", "USD", "AED", "CNY", "EUR"],
        destination_currencies=["*"],  # All currencies
        min_amount=50000,
        max_amount=float('inf'),
        min_kyc_tier=KYCTier.TIER_3,
        fixed_fee=5000.0,
        percentage_fee=1.5,
        fx_markup=2.0,
        avg_settlement_hours=72.0,
        success_rate=99.9,
        priority=50  # Lower priority due to cost/speed
    ),
    Corridor.INTERNAL: CorridorConfig(
        corridor=Corridor.INTERNAL,
        source_countries=["*"],
        destination_countries=["*"],
        source_currencies=["*"],
        destination_currencies=["*"],
        min_amount=0,
        max_amount=float('inf'),
        min_kyc_tier=KYCTier.TIER_0,
        fixed_fee=0.0,
        percentage_fee=0.0,
        avg_settlement_hours=0.0,
        success_rate=100.0,
        priority=100  # Highest for internal transfers
    )
}

# Corridor health status (would be updated by monitoring service)
CORRIDOR_HEALTH: Dict[Corridor, Dict[str, Any]] = {
    Corridor.NIBSS: {"status": "healthy", "current_success_rate": 99.5},
    Corridor.PAPSS: {"status": "healthy", "current_success_rate": 97.2},
    Corridor.MOJALOOP: {"status": "healthy", "current_success_rate": 98.5},
    Corridor.UPI: {"status": "degraded", "current_success_rate": 94.1},
    Corridor.PIX: {"status": "healthy", "current_success_rate": 99.1},
    Corridor.SWIFT: {"status": "healthy", "current_success_rate": 99.9},
    Corridor.INTERNAL: {"status": "healthy", "current_success_rate": 100.0}
}


class CorridorRouter:
    """
    Intelligent corridor routing engine.
    
    Selects the optimal payment corridor based on:
    1. Route availability (country/currency support)
    2. Amount limits
    3. KYC tier requirements
    4. Cost optimization
    5. Speed requirements
    6. Corridor health status
    """
    
    def __init__(self, configs: Dict[Corridor, CorridorConfig] = None):
        self.configs = configs or CORRIDOR_CONFIGS
        self.health = CORRIDOR_HEALTH
    
    def get_eligible_corridors(self, request: RoutingRequest) -> List[CorridorConfig]:
        """Get all corridors eligible for this transfer"""
        eligible = []
        
        for corridor, config in self.configs.items():
            if not config.enabled:
                continue
            
            # Check health status
            health = self.health.get(corridor, {})
            if health.get("status") == "down":
                continue
            
            # Check country support
            if config.source_countries != ["*"]:
                if request.source_country not in config.source_countries:
                    continue
            
            if config.destination_countries != ["*"]:
                if request.destination_country not in config.destination_countries:
                    continue
            
            # Check currency support
            if config.source_currencies != ["*"]:
                if request.source_currency not in config.source_currencies:
                    continue
            
            if config.destination_currencies != ["*"]:
                if request.destination_currency not in config.destination_currencies:
                    continue
            
            # Check amount limits
            if request.amount < config.min_amount or request.amount > config.max_amount:
                continue
            
            # Check KYC tier
            kyc_order = [KYCTier.TIER_0, KYCTier.TIER_1, KYCTier.TIER_2, KYCTier.TIER_3]
            if kyc_order.index(request.user_kyc_tier) < kyc_order.index(config.min_kyc_tier):
                continue
            
            eligible.append(config)
        
        return eligible
    
    def calculate_fee(self, config: CorridorConfig, amount: float) -> float:
        """Calculate total fee for a corridor"""
        return config.fixed_fee + (amount * config.percentage_fee / 100)
    
    def score_corridor(
        self, 
        config: CorridorConfig, 
        request: RoutingRequest
    ) -> float:
        """
        Score a corridor based on routing priority.
        Higher score = better choice.
        """
        base_score = config.priority
        
        # Adjust for health status
        health = self.health.get(config.corridor, {})
        if health.get("status") == "degraded":
            base_score -= 20
        
        # Adjust based on priority preference
        if request.priority == RoutingPriority.COST:
            # Penalize high fees
            fee = self.calculate_fee(config, request.amount)
            fee_penalty = min(fee / request.amount * 100, 30)  # Max 30 point penalty
            base_score -= fee_penalty
            
        elif request.priority == RoutingPriority.SPEED:
            # Penalize slow settlement
            speed_penalty = min(config.avg_settlement_hours, 30)  # Max 30 point penalty
            base_score -= speed_penalty
            
        elif request.priority == RoutingPriority.RELIABILITY:
            # Reward high success rate
            reliability_bonus = (config.success_rate - 95) * 2  # Up to 10 points
            base_score += reliability_bonus
        
        # Bonus for preferred corridor
        if request.preferred_corridor == config.corridor:
            base_score += 20
        
        return base_score
    
    def route(self, request: RoutingRequest) -> RoutingDecision:
        """
        Select the optimal corridor for a transfer.
        
        Returns the best corridor along with alternatives.
        """
        eligible = self.get_eligible_corridors(request)
        
        if not eligible:
            raise ValueError(
                f"No eligible corridors for {request.source_country} -> {request.destination_country}, "
                f"{request.source_currency} -> {request.destination_currency}, "
                f"amount={request.amount}, kyc_tier={request.user_kyc_tier}"
            )
        
        # Score all eligible corridors
        scored = []
        for config in eligible:
            score = self.score_corridor(config, request)
            fee = self.calculate_fee(config, request.amount)
            scored.append({
                "config": config,
                "score": score,
                "fee": fee
            })
        
        # Sort by score (highest first)
        scored.sort(key=lambda x: x["score"], reverse=True)
        
        # Select best corridor
        best = scored[0]
        alternatives = scored[1:4]  # Top 3 alternatives
        
        logger.info(
            f"Routed transfer: {request.source_country}->{request.destination_country}, "
            f"amount={request.amount}, selected={best['config'].corridor}, "
            f"score={best['score']:.1f}, fee={best['fee']:.2f}"
        )
        
        return RoutingDecision(
            selected_corridor=best["config"].corridor,
            reason=self._generate_reason(best["config"], request),
            estimated_fee=best["fee"],
            estimated_settlement_hours=best["config"].avg_settlement_hours,
            alternatives=[
                {
                    "corridor": alt["config"].corridor.value,
                    "fee": alt["fee"],
                    "settlement_hours": alt["config"].avg_settlement_hours,
                    "score": alt["score"]
                }
                for alt in alternatives
            ],
            routing_metadata={
                "source_route": f"{request.source_country}/{request.source_currency}",
                "destination_route": f"{request.destination_country}/{request.destination_currency}",
                "priority": request.priority.value,
                "eligible_corridors": len(eligible),
                "selected_score": best["score"]
            }
        )
    
    def _generate_reason(self, config: CorridorConfig, request: RoutingRequest) -> str:
        """Generate human-readable reason for corridor selection"""
        reasons = []
        
        if request.priority == RoutingPriority.COST:
            reasons.append("lowest cost option")
        elif request.priority == RoutingPriority.SPEED:
            reasons.append(f"fastest settlement ({config.avg_settlement_hours}h)")
        elif request.priority == RoutingPriority.RELIABILITY:
            reasons.append(f"highest reliability ({config.success_rate}%)")
        
        if request.preferred_corridor == config.corridor:
            reasons.append("user preferred")
        
        if config.corridor == Corridor.NIBSS and request.source_country == "NG" and request.destination_country == "NG":
            reasons.append("domestic transfer")
        
        if config.corridor == Corridor.PAPSS:
            reasons.append("intra-Africa corridor")
        
        return f"Selected {config.corridor.value}: " + ", ".join(reasons) if reasons else "Best available option"


# Singleton router instance
router = CorridorRouter()


def route_transfer(request: RoutingRequest) -> RoutingDecision:
    """Route a transfer to the optimal corridor"""
    return router.route(request)


def get_eligible_corridors(request: RoutingRequest) -> List[str]:
    """Get list of eligible corridor names for a transfer"""
    eligible = router.get_eligible_corridors(request)
    return [c.corridor.value for c in eligible]
