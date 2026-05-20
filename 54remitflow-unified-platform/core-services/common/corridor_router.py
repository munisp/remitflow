"""
Smart Multi-Corridor Routing Engine

Automatically selects the optimal payment corridor based on:
- Cost (FX spread, fees)
- Speed (estimated completion time)
- Reliability (success rate)
- Availability (corridor health)

Supported corridors:
- Mojaloop (Africa instant payments)
- PAPSS (Pan-African Payment Settlement System)
- UPI (India)
- PIX (Brazil)
- CIPS (China)
- Stablecoin (USDT/USDC via blockchain)
- SWIFT (fallback for unsupported corridors)
"""

from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from uuid import uuid4
from decimal import Decimal
from enum import Enum
from dataclasses import dataclass

from common.logging_config import get_logger
from common.metrics import MetricsCollector

logger = get_logger(__name__)
metrics = MetricsCollector("corridor_router")


class Corridor(Enum):
    MOJALOOP = "MOJALOOP"
    PAPSS = "PAPSS"
    UPI = "UPI"
    PIX = "PIX"
    CIPS = "CIPS"
    STABLECOIN = "STABLECOIN"
    SWIFT = "SWIFT"


class RoutingStrategy(Enum):
    CHEAPEST = "CHEAPEST"
    FASTEST = "FASTEST"
    MOST_RELIABLE = "MOST_RELIABLE"
    BALANCED = "BALANCED"


@dataclass
class CorridorMetrics:
    corridor: Corridor
    avg_completion_seconds: float
    success_rate: float
    avg_fee_percent: float
    avg_fx_spread_percent: float
    is_available: bool
    last_health_check: datetime
    daily_volume_limit: Decimal
    current_daily_volume: Decimal


@dataclass
class RouteOption:
    corridor: Corridor
    estimated_cost_percent: float
    estimated_seconds: int
    reliability_score: float
    total_score: float
    route_details: Dict[str, Any]


@dataclass
class RoutingDecision:
    transfer_id: str
    selected_corridor: Corridor
    route_options: List[RouteOption]
    routing_strategy: RoutingStrategy
    source_currency: str
    destination_currency: str
    amount: Decimal
    estimated_receive_amount: Decimal
    estimated_completion: datetime
    fee_breakdown: Dict[str, Decimal]
    fx_rate: Decimal
    decision_reason: str


class CorridorRouter:
    """
    Smart multi-corridor routing engine.
    
    Analyzes available corridors and selects the optimal route
    based on cost, speed, reliability, and user preferences.
    """
    
    CORRIDOR_COUNTRY_MAP = {
        "NG": [Corridor.MOJALOOP, Corridor.PAPSS, Corridor.STABLECOIN, Corridor.SWIFT],
        "GH": [Corridor.MOJALOOP, Corridor.PAPSS, Corridor.STABLECOIN, Corridor.SWIFT],
        "KE": [Corridor.MOJALOOP, Corridor.PAPSS, Corridor.STABLECOIN, Corridor.SWIFT],
        "ZA": [Corridor.MOJALOOP, Corridor.PAPSS, Corridor.STABLECOIN, Corridor.SWIFT],
        "EG": [Corridor.PAPSS, Corridor.STABLECOIN, Corridor.SWIFT],
        "IN": [Corridor.UPI, Corridor.STABLECOIN, Corridor.SWIFT],
        "BR": [Corridor.PIX, Corridor.STABLECOIN, Corridor.SWIFT],
        "CN": [Corridor.CIPS, Corridor.STABLECOIN, Corridor.SWIFT],
        "US": [Corridor.STABLECOIN, Corridor.SWIFT],
        "GB": [Corridor.STABLECOIN, Corridor.SWIFT],
        "EU": [Corridor.STABLECOIN, Corridor.SWIFT],
    }
    
    CORRIDOR_CURRENCIES = {
        Corridor.MOJALOOP: ["NGN", "GHS", "KES", "ZAR", "USD"],
        Corridor.PAPSS: ["NGN", "GHS", "KES", "ZAR", "XOF", "XAF", "EGP"],
        Corridor.UPI: ["INR"],
        Corridor.PIX: ["BRL"],
        Corridor.CIPS: ["CNY", "USD"],
        Corridor.STABLECOIN: ["USDT", "USDC", "USD"],
        Corridor.SWIFT: ["USD", "EUR", "GBP", "NGN", "CNY", "INR", "BRL"],
    }
    
    BASE_METRICS = {
        Corridor.MOJALOOP: CorridorMetrics(
            corridor=Corridor.MOJALOOP,
            avg_completion_seconds=30,
            success_rate=0.98,
            avg_fee_percent=0.5,
            avg_fx_spread_percent=0.3,
            is_available=True,
            last_health_check=datetime.utcnow(),
            daily_volume_limit=Decimal("10000000"),
            current_daily_volume=Decimal("0")
        ),
        Corridor.PAPSS: CorridorMetrics(
            corridor=Corridor.PAPSS,
            avg_completion_seconds=60,
            success_rate=0.96,
            avg_fee_percent=0.8,
            avg_fx_spread_percent=0.5,
            is_available=True,
            last_health_check=datetime.utcnow(),
            daily_volume_limit=Decimal("50000000"),
            current_daily_volume=Decimal("0")
        ),
        Corridor.UPI: CorridorMetrics(
            corridor=Corridor.UPI,
            avg_completion_seconds=15,
            success_rate=0.99,
            avg_fee_percent=0.2,
            avg_fx_spread_percent=0.4,
            is_available=True,
            last_health_check=datetime.utcnow(),
            daily_volume_limit=Decimal("100000000"),
            current_daily_volume=Decimal("0")
        ),
        Corridor.PIX: CorridorMetrics(
            corridor=Corridor.PIX,
            avg_completion_seconds=10,
            success_rate=0.995,
            avg_fee_percent=0.1,
            avg_fx_spread_percent=0.3,
            is_available=True,
            last_health_check=datetime.utcnow(),
            daily_volume_limit=Decimal("100000000"),
            current_daily_volume=Decimal("0")
        ),
        Corridor.CIPS: CorridorMetrics(
            corridor=Corridor.CIPS,
            avg_completion_seconds=7200,
            success_rate=0.97,
            avg_fee_percent=0.3,
            avg_fx_spread_percent=0.2,
            is_available=True,
            last_health_check=datetime.utcnow(),
            daily_volume_limit=Decimal("500000000"),
            current_daily_volume=Decimal("0")
        ),
        Corridor.STABLECOIN: CorridorMetrics(
            corridor=Corridor.STABLECOIN,
            avg_completion_seconds=300,
            success_rate=0.99,
            avg_fee_percent=1.0,
            avg_fx_spread_percent=0.1,
            is_available=True,
            last_health_check=datetime.utcnow(),
            daily_volume_limit=Decimal("1000000000"),
            current_daily_volume=Decimal("0")
        ),
        Corridor.SWIFT: CorridorMetrics(
            corridor=Corridor.SWIFT,
            avg_completion_seconds=172800,
            success_rate=0.95,
            avg_fee_percent=2.5,
            avg_fx_spread_percent=1.0,
            is_available=True,
            last_health_check=datetime.utcnow(),
            daily_volume_limit=Decimal("1000000000"),
            current_daily_volume=Decimal("0")
        ),
    }
    
    FX_RATES = {
        ("NGN", "USD"): Decimal("0.00065"),
        ("USD", "NGN"): Decimal("1538.46"),
        ("NGN", "GHS"): Decimal("0.0078"),
        ("GHS", "NGN"): Decimal("128.21"),
        ("NGN", "KES"): Decimal("0.084"),
        ("KES", "NGN"): Decimal("11.90"),
        ("USD", "INR"): Decimal("83.50"),
        ("INR", "USD"): Decimal("0.012"),
        ("USD", "BRL"): Decimal("4.95"),
        ("BRL", "USD"): Decimal("0.202"),
        ("USD", "CNY"): Decimal("7.25"),
        ("CNY", "USD"): Decimal("0.138"),
        ("NGN", "CNY"): Decimal("0.0047"),
        ("CNY", "NGN"): Decimal("212.77"),
        ("GBP", "NGN"): Decimal("1950.00"),
        ("NGN", "GBP"): Decimal("0.000513"),
        ("EUR", "NGN"): Decimal("1680.00"),
        ("NGN", "EUR"): Decimal("0.000595"),
    }
    
    def __init__(self):
        self.corridor_metrics = dict(self.BASE_METRICS)
        self.routing_history: List[RoutingDecision] = []
        
    async def get_available_corridors(
        self,
        source_country: str,
        destination_country: str,
        source_currency: str,
        destination_currency: str,
        amount: Decimal
    ) -> List[Corridor]:
        """Get list of available corridors for a transfer."""
        available = []
        
        dest_corridors = self.CORRIDOR_COUNTRY_MAP.get(destination_country, [Corridor.SWIFT])
        
        for corridor in dest_corridors:
            metrics = self.corridor_metrics.get(corridor)
            if not metrics or not metrics.is_available:
                continue
                
            if metrics.current_daily_volume + amount > metrics.daily_volume_limit:
                continue
                
            supported_currencies = self.CORRIDOR_CURRENCIES.get(corridor, [])
            if destination_currency in supported_currencies or "USD" in supported_currencies:
                available.append(corridor)
        
        if not available:
            available.append(Corridor.SWIFT)
            
        return available
    
    async def calculate_route_options(
        self,
        corridors: List[Corridor],
        source_currency: str,
        destination_currency: str,
        amount: Decimal,
        strategy: RoutingStrategy = RoutingStrategy.BALANCED
    ) -> List[RouteOption]:
        """Calculate route options for each available corridor."""
        options = []
        
        for corridor in corridors:
            metrics = self.corridor_metrics.get(corridor)
            if not metrics:
                continue
            
            fx_rate = await self._get_fx_rate(source_currency, destination_currency, corridor)
            
            total_fee_percent = metrics.avg_fee_percent + metrics.avg_fx_spread_percent
            
            if strategy == RoutingStrategy.CHEAPEST:
                score = 100 - (total_fee_percent * 20)
            elif strategy == RoutingStrategy.FASTEST:
                score = 100 - (metrics.avg_completion_seconds / 3600)
            elif strategy == RoutingStrategy.MOST_RELIABLE:
                score = metrics.success_rate * 100
            else:
                cost_score = 100 - (total_fee_percent * 10)
                speed_score = 100 - min(metrics.avg_completion_seconds / 3600, 48)
                reliability_score = metrics.success_rate * 100
                score = (cost_score * 0.4) + (speed_score * 0.3) + (reliability_score * 0.3)
            
            receive_amount = amount * fx_rate * (1 - Decimal(str(total_fee_percent / 100)))
            
            options.append(RouteOption(
                corridor=corridor,
                estimated_cost_percent=total_fee_percent,
                estimated_seconds=int(metrics.avg_completion_seconds),
                reliability_score=metrics.success_rate,
                total_score=score,
                route_details={
                    "fx_rate": float(fx_rate),
                    "fee_percent": metrics.avg_fee_percent,
                    "fx_spread_percent": metrics.avg_fx_spread_percent,
                    "receive_amount": float(receive_amount),
                    "receive_currency": destination_currency
                }
            ))
        
        options.sort(key=lambda x: x.total_score, reverse=True)
        return options
    
    async def route_transfer(
        self,
        source_country: str,
        destination_country: str,
        source_currency: str,
        destination_currency: str,
        amount: Decimal,
        strategy: RoutingStrategy = RoutingStrategy.BALANCED,
        preferred_corridor: Optional[Corridor] = None
    ) -> RoutingDecision:
        """
        Route a transfer through the optimal corridor.
        
        Returns a RoutingDecision with the selected corridor and alternatives.
        """
        transfer_id = str(uuid4())
        
        available_corridors = await self.get_available_corridors(
            source_country=source_country,
            destination_country=destination_country,
            source_currency=source_currency,
            destination_currency=destination_currency,
            amount=amount
        )
        
        if preferred_corridor and preferred_corridor in available_corridors:
            available_corridors.remove(preferred_corridor)
            available_corridors.insert(0, preferred_corridor)
        
        route_options = await self.calculate_route_options(
            corridors=available_corridors,
            source_currency=source_currency,
            destination_currency=destination_currency,
            amount=amount,
            strategy=strategy
        )
        
        if not route_options:
            raise ValueError("No available corridors for this transfer")
        
        selected = route_options[0]
        selected_metrics = self.corridor_metrics.get(selected.corridor)
        
        fx_rate = Decimal(str(selected.route_details["fx_rate"]))
        receive_amount = Decimal(str(selected.route_details["receive_amount"]))
        
        fee_amount = amount * Decimal(str(selected_metrics.avg_fee_percent / 100))
        fx_spread_amount = amount * Decimal(str(selected_metrics.avg_fx_spread_percent / 100))
        
        decision = RoutingDecision(
            transfer_id=transfer_id,
            selected_corridor=selected.corridor,
            route_options=route_options,
            routing_strategy=strategy,
            source_currency=source_currency,
            destination_currency=destination_currency,
            amount=amount,
            estimated_receive_amount=receive_amount,
            estimated_completion=datetime.utcnow() + timedelta(seconds=selected.estimated_seconds),
            fee_breakdown={
                "platform_fee": fee_amount,
                "fx_spread": fx_spread_amount,
                "network_fee": Decimal("0"),
                "total_fee": fee_amount + fx_spread_amount
            },
            fx_rate=fx_rate,
            decision_reason=self._generate_decision_reason(selected, strategy)
        )
        
        self.routing_history.append(decision)
        metrics.increment(f"routes_selected_{selected.corridor.value.lower()}")
        
        return decision
    
    async def route_via_stablecoin(
        self,
        source_country: str,
        destination_country: str,
        source_currency: str,
        destination_currency: str,
        amount: Decimal
    ) -> RoutingDecision:
        """
        Route transfer via stablecoin as intermediate currency.
        
        Flow: source_currency -> USDT -> destination_currency
        Useful when direct corridors are expensive or slow.
        """
        transfer_id = str(uuid4())
        
        source_to_usdt_rate = await self._get_fx_rate(source_currency, "USD", Corridor.STABLECOIN)
        usdt_to_dest_rate = await self._get_fx_rate("USD", destination_currency, Corridor.STABLECOIN)
        
        stablecoin_metrics = self.corridor_metrics[Corridor.STABLECOIN]
        
        usdt_amount = amount * source_to_usdt_rate * Decimal("0.99")
        receive_amount = usdt_amount * usdt_to_dest_rate * Decimal("0.99")
        
        total_fee_percent = 2.0
        
        route_option = RouteOption(
            corridor=Corridor.STABLECOIN,
            estimated_cost_percent=total_fee_percent,
            estimated_seconds=int(stablecoin_metrics.avg_completion_seconds),
            reliability_score=stablecoin_metrics.success_rate,
            total_score=85.0,
            route_details={
                "fx_rate": float(source_to_usdt_rate * usdt_to_dest_rate),
                "intermediate_currency": "USDT",
                "source_to_usdt_rate": float(source_to_usdt_rate),
                "usdt_to_dest_rate": float(usdt_to_dest_rate),
                "receive_amount": float(receive_amount),
                "receive_currency": destination_currency
            }
        )
        
        decision = RoutingDecision(
            transfer_id=transfer_id,
            selected_corridor=Corridor.STABLECOIN,
            route_options=[route_option],
            routing_strategy=RoutingStrategy.BALANCED,
            source_currency=source_currency,
            destination_currency=destination_currency,
            amount=amount,
            estimated_receive_amount=receive_amount,
            estimated_completion=datetime.utcnow() + timedelta(seconds=stablecoin_metrics.avg_completion_seconds),
            fee_breakdown={
                "on_ramp_fee": amount * Decimal("0.01"),
                "off_ramp_fee": usdt_amount * Decimal("0.01"),
                "network_fee": Decimal("1.00"),
                "total_fee": amount * Decimal(str(total_fee_percent / 100))
            },
            fx_rate=source_to_usdt_rate * usdt_to_dest_rate,
            decision_reason="Routed via USDT stablecoin for optimal cost/speed balance"
        )
        
        metrics.increment("routes_via_stablecoin")
        return decision
    
    async def compare_corridors(
        self,
        source_country: str,
        destination_country: str,
        source_currency: str,
        destination_currency: str,
        amount: Decimal
    ) -> Dict[str, Any]:
        """
        Compare all available corridors for a transfer.
        
        Returns detailed comparison for user to choose.
        """
        available = await self.get_available_corridors(
            source_country=source_country,
            destination_country=destination_country,
            source_currency=source_currency,
            destination_currency=destination_currency,
            amount=amount
        )
        
        comparisons = []
        for corridor in available:
            metrics_data = self.corridor_metrics.get(corridor)
            if not metrics_data:
                continue
                
            fx_rate = await self._get_fx_rate(source_currency, destination_currency, corridor)
            total_fee = metrics_data.avg_fee_percent + metrics_data.avg_fx_spread_percent
            receive_amount = amount * fx_rate * (1 - Decimal(str(total_fee / 100)))
            
            comparisons.append({
                "corridor": corridor.value,
                "receive_amount": float(receive_amount),
                "receive_currency": destination_currency,
                "fx_rate": float(fx_rate),
                "total_fee_percent": total_fee,
                "estimated_time_seconds": metrics_data.avg_completion_seconds,
                "estimated_time_display": self._format_time(metrics_data.avg_completion_seconds),
                "success_rate": metrics_data.success_rate,
                "recommendation": self._get_recommendation(corridor, metrics_data)
            })
        
        comparisons.sort(key=lambda x: x["receive_amount"], reverse=True)
        
        return {
            "source_amount": float(amount),
            "source_currency": source_currency,
            "destination_currency": destination_currency,
            "corridors": comparisons,
            "best_value": comparisons[0]["corridor"] if comparisons else None,
            "fastest": min(comparisons, key=lambda x: x["estimated_time_seconds"])["corridor"] if comparisons else None
        }
    
    async def update_corridor_metrics(
        self,
        corridor: Corridor,
        completion_seconds: Optional[float] = None,
        success: Optional[bool] = None,
        volume: Optional[Decimal] = None
    ):
        """Update corridor metrics based on actual transfer results."""
        if corridor not in self.corridor_metrics:
            return
            
        current = self.corridor_metrics[corridor]
        
        if completion_seconds is not None:
            alpha = 0.1
            current.avg_completion_seconds = (
                alpha * completion_seconds + (1 - alpha) * current.avg_completion_seconds
            )
        
        if success is not None:
            alpha = 0.01
            success_val = 1.0 if success else 0.0
            current.success_rate = alpha * success_val + (1 - alpha) * current.success_rate
        
        if volume is not None:
            current.current_daily_volume += volume
        
        current.last_health_check = datetime.utcnow()
    
    async def _get_fx_rate(
        self,
        source_currency: str,
        destination_currency: str,
        corridor: Corridor
    ) -> Decimal:
        """Get FX rate for currency pair."""
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
    
    def _generate_decision_reason(self, selected: RouteOption, strategy: RoutingStrategy) -> str:
        """Generate human-readable reason for routing decision."""
        if strategy == RoutingStrategy.CHEAPEST:
            return f"Selected {selected.corridor.value} for lowest cost ({selected.estimated_cost_percent:.1f}% total fees)"
        elif strategy == RoutingStrategy.FASTEST:
            return f"Selected {selected.corridor.value} for fastest delivery ({self._format_time(selected.estimated_seconds)})"
        elif strategy == RoutingStrategy.MOST_RELIABLE:
            return f"Selected {selected.corridor.value} for highest reliability ({selected.reliability_score*100:.1f}% success rate)"
        else:
            return f"Selected {selected.corridor.value} for best balance of cost, speed, and reliability (score: {selected.total_score:.1f})"
    
    def _format_time(self, seconds: float) -> str:
        """Format seconds into human-readable time."""
        if seconds < 60:
            return f"{int(seconds)} seconds"
        elif seconds < 3600:
            return f"{int(seconds / 60)} minutes"
        elif seconds < 86400:
            return f"{int(seconds / 3600)} hours"
        else:
            return f"{int(seconds / 86400)} days"
    
    def _get_recommendation(self, corridor: Corridor, metrics: CorridorMetrics) -> str:
        """Get recommendation label for corridor."""
        if corridor == Corridor.PIX:
            return "Fastest"
        elif corridor == Corridor.UPI:
            return "Best for India"
        elif corridor == Corridor.MOJALOOP:
            return "Best for Africa"
        elif corridor == Corridor.STABLECOIN:
            return "Best for large amounts"
        elif corridor == Corridor.CIPS:
            return "Best for China"
        elif corridor == Corridor.SWIFT:
            return "Most widely supported"
        else:
            return ""


def get_corridor_router() -> CorridorRouter:
    """Factory function to get corridor router instance."""
    return CorridorRouter()
