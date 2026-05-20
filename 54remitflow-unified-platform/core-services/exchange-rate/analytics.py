"""
Rate Analytics - Historical analysis, trending, and forecasting
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
from decimal import Decimal
from collections import defaultdict
from statistics import mean, stdev
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class RateDataPoint(BaseModel):
    """Single rate data point"""
    timestamp: datetime
    rate: Decimal
    source: str


class RateStatistics(BaseModel):
    """Statistical analysis of rates"""
    currency_pair: str
    period_hours: int
    data_points: int
    current_rate: Decimal
    average_rate: Decimal
    min_rate: Decimal
    max_rate: Decimal
    std_deviation: Optional[Decimal] = None
    volatility_percent: Optional[Decimal] = None
    trend: str  # "up", "down", "stable"
    change_percent: Decimal
    change_absolute: Decimal


class RateTrend(BaseModel):
    """Rate trend analysis"""
    currency_pair: str
    direction: str  # "bullish", "bearish", "neutral"
    strength: str  # "strong", "moderate", "weak"
    momentum: Decimal
    support_level: Optional[Decimal] = None
    resistance_level: Optional[Decimal] = None
    prediction_24h: Optional[Decimal] = None


class RateAnalytics:
    """Analytics engine for exchange rates"""
    
    def __init__(self):
        self.historical_data: Dict[str, List[RateDataPoint]] = defaultdict(list)
        self.max_history_points = 10000
    
    def add_data_point(
        self,
        from_currency: str,
        to_currency: str,
        rate: Decimal,
        source: str = "internal"
    ) -> None:
        """Add rate data point to history"""
        
        pair_key = f"{from_currency}/{to_currency}"
        
        data_point = RateDataPoint(
            timestamp=datetime.utcnow(),
            rate=rate,
            source=source
        )
        
        self.historical_data[pair_key].append(data_point)
        
        # Limit history size
        if len(self.historical_data[pair_key]) > self.max_history_points:
            self.historical_data[pair_key] = self.historical_data[pair_key][-self.max_history_points:]
    
    def get_statistics(
        self,
        from_currency: str,
        to_currency: str,
        period_hours: int = 24
    ) -> Optional[RateStatistics]:
        """Calculate statistical analysis for currency pair"""
        
        pair_key = f"{from_currency}/{to_currency}"
        
        if pair_key not in self.historical_data:
            return None
        
        # Filter data by period
        cutoff = datetime.utcnow() - timedelta(hours=period_hours)
        period_data = [
            dp for dp in self.historical_data[pair_key]
            if dp.timestamp >= cutoff
        ]
        
        if not period_data:
            return None
        
        rates = [float(dp.rate) for dp in period_data]
        
        current_rate = period_data[-1].rate
        avg_rate = Decimal(str(mean(rates)))
        min_rate = Decimal(str(min(rates)))
        max_rate = Decimal(str(max(rates)))
        
        # Calculate standard deviation and volatility
        std_dev = None
        volatility = None
        if len(rates) > 1:
            std_dev = Decimal(str(stdev(rates)))
            volatility = (std_dev / avg_rate * 100) if avg_rate > 0 else Decimal("0")
        
        # Determine trend
        first_rate = period_data[0].rate
        change_abs = current_rate - first_rate
        change_pct = (change_abs / first_rate * 100) if first_rate > 0 else Decimal("0")
        
        if abs(change_pct) < Decimal("0.5"):
            trend = "stable"
        elif change_pct > 0:
            trend = "up"
        else:
            trend = "down"
        
        return RateStatistics(
            currency_pair=pair_key,
            period_hours=period_hours,
            data_points=len(period_data),
            current_rate=current_rate,
            average_rate=avg_rate,
            min_rate=min_rate,
            max_rate=max_rate,
            std_deviation=std_dev,
            volatility_percent=volatility,
            trend=trend,
            change_percent=change_pct,
            change_absolute=change_abs
        )
    
    def get_trend_analysis(
        self,
        from_currency: str,
        to_currency: str,
        period_hours: int = 24
    ) -> Optional[RateTrend]:
        """Analyze rate trend and momentum"""
        
        stats = self.get_statistics(from_currency, to_currency, period_hours)
        
        if not stats:
            return None
        
        pair_key = f"{from_currency}/{to_currency}"
        
        # Determine direction
        if stats.change_percent > Decimal("1.0"):
            direction = "bullish"
        elif stats.change_percent < Decimal("-1.0"):
            direction = "bearish"
        else:
            direction = "neutral"
        
        # Determine strength based on volatility and change
        change_magnitude = abs(stats.change_percent)
        if change_magnitude > Decimal("3.0") and stats.volatility_percent and stats.volatility_percent > Decimal("2.0"):
            strength = "strong"
        elif change_magnitude > Decimal("1.0"):
            strength = "moderate"
        else:
            strength = "weak"
        
        # Calculate momentum (rate of change)
        momentum = stats.change_percent / Decimal(str(period_hours))
        
        # Calculate support and resistance levels
        support = stats.min_rate
        resistance = stats.max_rate
        
        # Simple prediction (linear extrapolation)
        prediction_24h = stats.current_rate + (momentum * Decimal("24"))
        
        return RateTrend(
            currency_pair=pair_key,
            direction=direction,
            strength=strength,
            momentum=momentum,
            support_level=support,
            resistance_level=resistance,
            prediction_24h=prediction_24h
        )
    
    def get_historical_data(
        self,
        from_currency: str,
        to_currency: str,
        period_hours: int = 24,
        interval_minutes: int = 60
    ) -> List[Dict[str, Any]]:
        """Get historical rate data with aggregation"""
        
        pair_key = f"{from_currency}/{to_currency}"
        
        if pair_key not in self.historical_data:
            return []
        
        # Filter by period
        cutoff = datetime.utcnow() - timedelta(hours=period_hours)
        period_data = [
            dp for dp in self.historical_data[pair_key]
            if dp.timestamp >= cutoff
        ]
        
        if not period_data:
            return []
        
        # Aggregate by interval
        interval_delta = timedelta(minutes=interval_minutes)
        aggregated = []
        
        current_bucket_start = period_data[0].timestamp
        current_bucket_rates = []
        
        for dp in period_data:
            if dp.timestamp >= current_bucket_start + interval_delta:
                # Finalize current bucket
                if current_bucket_rates:
                    aggregated.append({
                        "timestamp": current_bucket_start.isoformat(),
                        "rate": float(mean(current_bucket_rates)),
                        "min": float(min(current_bucket_rates)),
                        "max": float(max(current_bucket_rates)),
                        "count": len(current_bucket_rates)
                    })
                
                # Start new bucket
                current_bucket_start = dp.timestamp
                current_bucket_rates = [float(dp.rate)]
            else:
                current_bucket_rates.append(float(dp.rate))
        
        # Add last bucket
        if current_bucket_rates:
            aggregated.append({
                "timestamp": current_bucket_start.isoformat(),
                "rate": float(mean(current_bucket_rates)),
                "min": float(min(current_bucket_rates)),
                "max": float(max(current_bucket_rates)),
                "count": len(current_bucket_rates)
            })
        
        return aggregated
    
    def compare_corridors(
        self,
        corridors: List[Tuple[str, str]],
        period_hours: int = 24
    ) -> Dict[str, Any]:
        """Compare multiple currency corridors"""
        
        comparison = {}
        
        for from_curr, to_curr in corridors:
            stats = self.get_statistics(from_curr, to_curr, period_hours)
            if stats:
                comparison[f"{from_curr}/{to_curr}"] = {
                    "current_rate": float(stats.current_rate),
                    "change_percent": float(stats.change_percent),
                    "volatility": float(stats.volatility_percent) if stats.volatility_percent else 0,
                    "trend": stats.trend
                }
        
        return comparison
    
    def get_top_movers(
        self,
        period_hours: int = 24,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get currency pairs with largest movements"""
        
        movers = []
        
        for pair_key in self.historical_data.keys():
            parts = pair_key.split("/")
            if len(parts) != 2:
                continue
            
            stats = self.get_statistics(parts[0], parts[1], period_hours)
            if stats:
                movers.append({
                    "currency_pair": pair_key,
                    "change_percent": float(stats.change_percent),
                    "current_rate": float(stats.current_rate),
                    "trend": stats.trend
                })
        
        # Sort by absolute change
        movers.sort(key=lambda x: abs(x["change_percent"]), reverse=True)
        
        return movers[:limit]
    
    def get_analytics_summary(self) -> Dict[str, Any]:
        """Get overall analytics summary"""
        
        total_pairs = len(self.historical_data)
        total_data_points = sum(len(data) for data in self.historical_data.values())
        
        # Calculate average data points per pair
        avg_points = total_data_points / total_pairs if total_pairs > 0 else 0
        
        return {
            "total_currency_pairs": total_pairs,
            "total_data_points": total_data_points,
            "average_points_per_pair": round(avg_points, 2),
            "tracked_pairs": list(self.historical_data.keys())
        }
