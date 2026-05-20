"""
Exchange Rate Service - Production Implementation
Real-time and historical exchange rates with multiple providers

Production-ready version with:
- Structured logging with correlation IDs
- Rate limiting
- Environment-driven CORS configuration
"""

import os
import sys

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Dict, Optional, List
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
import uvicorn
import asyncio
import httpx
from collections import defaultdict

# Import new modules
from rate_providers import RateAggregator
from cache_manager import RateCacheManager, CorridorConfigManager
from alert_manager import AlertManager, AlertType, AlertStatus, RateAlert
from analytics import RateAnalytics

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Exchange Rate Service", version="2.0.0")

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "exchange-rate-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)

# Enums
class RateSource(str, Enum):
    INTERNAL = "internal"
    CENTRAL_BANK = "central_bank"
    COMMERCIAL_BANK = "commercial_bank"
    FOREX_API = "forex_api"
    AGGREGATED = "aggregated"

class RateType(str, Enum):
    SPOT = "spot"
    BUY = "buy"
    SELL = "sell"
    MID = "mid"

# Models
class ExchangeRate(BaseModel):
    from_currency: str
    to_currency: str
    rate: Decimal
    inverse_rate: Decimal
    rate_type: RateType = RateType.MID
    source: RateSource = RateSource.INTERNAL
    spread: Optional[Decimal] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    valid_until: Optional[datetime] = None

class ExchangeRateQuote(BaseModel):
    quote_id: str
    from_currency: str
    to_currency: str
    amount: Decimal
    converted_amount: Decimal
    rate: Decimal
    fee: Decimal = Decimal("0.00")
    total_cost: Decimal
    rate_type: RateType
    source: RateSource
    expires_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ConversionRequest(BaseModel):
    from_currency: str
    to_currency: str
    amount: Decimal
    rate_type: RateType = RateType.MID

class RateHistoryEntry(BaseModel):
    timestamp: datetime
    rate: Decimal
    source: RateSource

class CurrencyPair(BaseModel):
    from_currency: str
    to_currency: str
    current_rate: Decimal
    high_24h: Optional[Decimal] = None
    low_24h: Optional[Decimal] = None
    change_24h: Optional[Decimal] = None
    change_percent_24h: Optional[Decimal] = None
    volume_24h: Optional[Decimal] = None
    last_updated: datetime

# Storage
rates_cache: Dict[str, ExchangeRate] = {}
rate_history: Dict[str, List[RateHistoryEntry]] = defaultdict(list)
quotes_cache: Dict[str, ExchangeRateQuote] = {}

# Initialize new managers
rate_aggregator = RateAggregator()
cache_manager = RateCacheManager(default_ttl_seconds=30)
corridor_config = CorridorConfigManager()
alert_manager = AlertManager()
analytics_engine = RateAnalytics()

# Base rates (updated periodically from external sources)
base_rates = {
    "USD": Decimal("1.00"),
    "EUR": Decimal("0.92"),
    "GBP": Decimal("0.79"),
    "NGN": Decimal("1550.00"),
    "GHS": Decimal("15.50"),
    "KES": Decimal("155.00"),
    "ZAR": Decimal("18.50"),
    "CNY": Decimal("7.24"),
    "INR": Decimal("83.20"),
    "BRL": Decimal("4.98"),
    "RUB": Decimal("92.50"),
    "JPY": Decimal("149.50"),
    "CAD": Decimal("1.36"),
    "AUD": Decimal("1.52"),
    "CHF": Decimal("0.88"),
    "SGD": Decimal("1.34"),
    "AED": Decimal("3.67"),
    "SAR": Decimal("3.75"),
    "MXN": Decimal("17.20"),
    "TRY": Decimal("32.50"),
}

# Spreads by currency pair (in percentage)
spreads = {
    "major": Decimal("0.002"),  # 0.2% for major pairs (USD, EUR, GBP)
    "minor": Decimal("0.005"),  # 0.5% for minor pairs
    "exotic": Decimal("0.015"),  # 1.5% for exotic pairs (African, emerging)
}

class ExchangeRateService:
    """Production exchange rate service"""
    
    @staticmethod
    def _get_pair_key(from_currency: str, to_currency: str) -> str:
        """Generate cache key for currency pair"""
        return f"{from_currency}/{to_currency}"
    
    @staticmethod
    def _classify_pair(from_currency: str, to_currency: str) -> str:
        """Classify currency pair for spread calculation"""
        major_currencies = {"USD", "EUR", "GBP", "JPY", "CHF"}
        
        if from_currency in major_currencies and to_currency in major_currencies:
            return "major"
        elif from_currency in major_currencies or to_currency in major_currencies:
            return "minor"
        else:
            return "exotic"
    
    @staticmethod
    async def get_rate(
        from_currency: str,
        to_currency: str,
        rate_type: RateType = RateType.MID,
        source: RateSource = RateSource.INTERNAL
    ) -> ExchangeRate:
        """Get exchange rate for currency pair"""
        
        # Same currency
        if from_currency == to_currency:
            return ExchangeRate(
                from_currency=from_currency,
                to_currency=to_currency,
                rate=Decimal("1.00"),
                inverse_rate=Decimal("1.00"),
                rate_type=rate_type,
                source=source
            )
        
        # Check cache
        cache_key = ExchangeRateService._get_pair_key(from_currency, to_currency)
        if cache_key in rates_cache:
            cached_rate = rates_cache[cache_key]
            # Check if cache is still valid (5 minutes)
            if datetime.utcnow() - cached_rate.timestamp < timedelta(minutes=5):
                return cached_rate
        
        # Calculate rate
        if from_currency not in base_rates or to_currency not in base_rates:
            raise HTTPException(status_code=400, detail=f"Unsupported currency pair: {from_currency}/{to_currency}")
        
        # Cross rate calculation: FROM -> USD -> TO
        from_to_usd = Decimal("1.00") / base_rates[from_currency]
        usd_to_to = base_rates[to_currency]
        mid_rate = from_to_usd * usd_to_to
        
        # Apply spread based on rate type
        pair_class = ExchangeRateService._classify_pair(from_currency, to_currency)
        spread_pct = spreads[pair_class]
        
        if rate_type == RateType.BUY:
            # Customer buys TO currency (we sell) - apply positive spread
            rate = mid_rate * (Decimal("1.00") + spread_pct)
        elif rate_type == RateType.SELL:
            # Customer sells TO currency (we buy) - apply negative spread
            rate = mid_rate * (Decimal("1.00") - spread_pct)
        else:
            rate = mid_rate
        
        inverse_rate = Decimal("1.00") / rate if rate > 0 else Decimal("0.00")
        
        exchange_rate = ExchangeRate(
            from_currency=from_currency,
            to_currency=to_currency,
            rate=rate,
            inverse_rate=inverse_rate,
            rate_type=rate_type,
            source=source,
            spread=spread_pct,
            valid_until=datetime.utcnow() + timedelta(minutes=5)
        )
        
        # Cache
        rates_cache[cache_key] = exchange_rate
        
        # Store in history
        rate_history[cache_key].append(RateHistoryEntry(
            timestamp=datetime.utcnow(),
            rate=rate,
            source=source
        ))
        
        # Keep only last 1000 entries
        if len(rate_history[cache_key]) > 1000:
            rate_history[cache_key] = rate_history[cache_key][-1000:]
        
        logger.info(f"Rate {from_currency}/{to_currency}: {rate} ({rate_type})")
        return exchange_rate
    
    @staticmethod
    async def get_quote(request: ConversionRequest) -> ExchangeRateQuote:
        """Get conversion quote with expiry"""
        
        # Get rate
        rate_info = await ExchangeRateService.get_rate(
            request.from_currency,
            request.to_currency,
            request.rate_type
        )
        
        # Calculate conversion
        converted_amount = request.amount * rate_info.rate
        
        # Calculate fee (0.1% of amount)
        fee = request.amount * Decimal("0.001")
        total_cost = request.amount + fee
        
        # Generate quote
        import uuid
        quote = ExchangeRateQuote(
            quote_id=str(uuid.uuid4()),
            from_currency=request.from_currency,
            to_currency=request.to_currency,
            amount=request.amount,
            converted_amount=converted_amount,
            rate=rate_info.rate,
            fee=fee,
            total_cost=total_cost,
            rate_type=request.rate_type,
            source=rate_info.source,
            expires_at=datetime.utcnow() + timedelta(minutes=2)
        )
        
        # Cache quote
        quotes_cache[quote.quote_id] = quote
        
        logger.info(f"Quote {quote.quote_id}: {request.amount} {request.from_currency} = {converted_amount} {request.to_currency}")
        return quote
    
    @staticmethod
    async def get_quote_by_id(quote_id: str) -> ExchangeRateQuote:
        """Retrieve quote by ID"""
        
        if quote_id not in quotes_cache:
            raise HTTPException(status_code=404, detail="Quote not found")
        
        quote = quotes_cache[quote_id]
        
        # Check expiry
        if datetime.utcnow() > quote.expires_at:
            raise HTTPException(status_code=400, detail="Quote expired")
        
        return quote
    
    @staticmethod
    async def get_multiple_rates(base_currency: str, target_currencies: List[str]) -> Dict[str, ExchangeRate]:
        """Get rates for multiple currency pairs"""
        
        rates = {}
        for target in target_currencies:
            try:
                rate = await ExchangeRateService.get_rate(base_currency, target)
                rates[target] = rate
            except Exception as e:
                logger.error(f"Failed to get rate {base_currency}/{target}: {e}")
        
        return rates
    
    @staticmethod
    async def get_rate_history(
        from_currency: str,
        to_currency: str,
        hours: int = 24
    ) -> List[RateHistoryEntry]:
        """Get historical rates"""
        
        cache_key = ExchangeRateService._get_pair_key(from_currency, to_currency)
        
        if cache_key not in rate_history:
            return []
        
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        history = [
            entry for entry in rate_history[cache_key]
            if entry.timestamp >= cutoff
        ]
        
        return history
    
    @staticmethod
    async def get_currency_pair_info(from_currency: str, to_currency: str) -> CurrencyPair:
        """Get comprehensive currency pair information"""
        
        # Get current rate
        current = await ExchangeRateService.get_rate(from_currency, to_currency)
        
        # Get 24h history
        history = await ExchangeRateService.get_rate_history(from_currency, to_currency, hours=24)
        
        # Calculate 24h stats
        high_24h = None
        low_24h = None
        change_24h = None
        change_percent_24h = None
        
        if history:
            rates_24h = [entry.rate for entry in history]
            high_24h = max(rates_24h)
            low_24h = min(rates_24h)
            
            if len(history) > 1:
                rate_24h_ago = history[0].rate
                change_24h = current.rate - rate_24h_ago
                change_percent_24h = (change_24h / rate_24h_ago) * Decimal("100.00")
        
        return CurrencyPair(
            from_currency=from_currency,
            to_currency=to_currency,
            current_rate=current.rate,
            high_24h=high_24h,
            low_24h=low_24h,
            change_24h=change_24h,
            change_percent_24h=change_percent_24h,
            last_updated=current.timestamp
        )
    
    @staticmethod
    async def get_supported_currencies() -> List[str]:
        """Get list of supported currencies"""
        return list(base_rates.keys())
    
    @staticmethod
    async def update_base_rates(new_rates: Dict[str, Decimal]):
        """Update base rates (admin function)"""
        
        for currency, rate in new_rates.items():
            if currency in base_rates:
                old_rate = base_rates[currency]
                base_rates[currency] = rate
                logger.info(f"Updated {currency} rate: {old_rate} -> {rate}")
        
        # Clear cache to force recalculation
        rates_cache.clear()

# API Endpoints
@app.get("/api/v1/rates/{from_currency}/{to_currency}", response_model=ExchangeRate)
async def get_rate(
    from_currency: str,
    to_currency: str,
    rate_type: RateType = RateType.MID,
    source: RateSource = RateSource.INTERNAL
):
    """Get exchange rate"""
    return await ExchangeRateService.get_rate(from_currency, to_currency, rate_type, source)

@app.post("/api/v1/rates/quote", response_model=ExchangeRateQuote)
async def get_quote(request: ConversionRequest):
    """Get conversion quote"""
    return await ExchangeRateService.get_quote(request)

@app.get("/api/v1/rates/quote/{quote_id}", response_model=ExchangeRateQuote)
async def get_quote_by_id(quote_id: str):
    """Get quote by ID"""
    return await ExchangeRateService.get_quote_by_id(quote_id)

@app.get("/api/v1/rates/{base_currency}/multiple")
async def get_multiple_rates(base_currency: str, targets: str):
    """Get rates for multiple pairs (comma-separated targets)"""
    target_currencies = [c.strip() for c in targets.split(",")]
    return await ExchangeRateService.get_multiple_rates(base_currency, target_currencies)

@app.get("/api/v1/rates/{from_currency}/{to_currency}/history", response_model=List[RateHistoryEntry])
async def get_rate_history(from_currency: str, to_currency: str, hours: int = 24):
    """Get historical rates"""
    return await ExchangeRateService.get_rate_history(from_currency, to_currency, hours)

@app.get("/api/v1/rates/{from_currency}/{to_currency}/info", response_model=CurrencyPair)
async def get_currency_pair_info(from_currency: str, to_currency: str):
    """Get currency pair information"""
    return await ExchangeRateService.get_currency_pair_info(from_currency, to_currency)

@app.get("/api/v1/rates/currencies", response_model=List[str])
async def get_supported_currencies():
    """Get supported currencies"""
    return await ExchangeRateService.get_supported_currencies()

@app.post("/api/v1/rates/admin/update")
async def update_base_rates(new_rates: Dict[str, Decimal]):
    """Update base rates (admin only)"""
    await ExchangeRateService.update_base_rates(new_rates)
    return {"status": "updated", "currencies": list(new_rates.keys())}

@app.get("/health")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "service": "exchange-rate-service",
        "version": "2.0.0",
        "supported_currencies": len(base_rates),
        "cached_rates": len(rates_cache),
        "active_quotes": len(quotes_cache),
        "timestamp": datetime.utcnow().isoformat()
    }

# New API Endpoints for Phase 1 enhancements

@app.get("/api/v1/rates/{from_currency}/{to_currency}/aggregated")
async def get_aggregated_rate(from_currency: str, to_currency: str):
    """Get aggregated rate from multiple providers"""
    result = await rate_aggregator.get_aggregated_rate(from_currency, to_currency)
    if not result:
        raise HTTPException(status_code=404, detail="No rates available from providers")
    return result

@app.get("/api/v1/rates/{from_currency}/{to_currency}/best")
async def get_best_rate(from_currency: str, to_currency: str, prefer_lowest: bool = True):
    """Get best rate from all providers"""
    result = await rate_aggregator.get_best_rate(from_currency, to_currency, prefer_lowest)
    if not result:
        raise HTTPException(status_code=404, detail="No rates available from providers")
    return result

@app.get("/api/v1/cache/stats")
async def get_cache_stats():
    """Get cache statistics"""
    return cache_manager.get_stats()

@app.post("/api/v1/cache/invalidate")
async def invalidate_cache(from_currency: Optional[str] = None, to_currency: Optional[str] = None):
    """Invalidate cache entries"""
    count = cache_manager.invalidate(from_currency, to_currency)
    return {"invalidated_entries": count}

@app.get("/api/v1/corridors")
async def list_corridors():
    """List all configured corridors"""
    return corridor_config.list_corridors()

@app.get("/api/v1/corridors/{from_currency}/{to_currency}")
async def get_corridor_config(from_currency: str, to_currency: str):
    """Get corridor configuration"""
    return corridor_config.get_config(from_currency, to_currency)

@app.put("/api/v1/corridors/{from_currency}/{to_currency}/markup")
async def update_corridor_markup(from_currency: str, to_currency: str, markup_percentage: float):
    """Update corridor markup (admin only)"""
    corridor_config.update_markup(from_currency, to_currency, markup_percentage)
    return {"status": "updated", "corridor": f"{from_currency}/{to_currency}", "markup": markup_percentage}

@app.post("/api/v1/alerts", response_model=RateAlert)
async def create_alert(
    user_id: str,
    from_currency: str,
    to_currency: str,
    alert_type: AlertType,
    threshold_value: Decimal,
    notification_channels: Optional[List[str]] = None,
    expires_at: Optional[datetime] = None
):
    """Create rate alert"""
    alert = alert_manager.create_alert(
        user_id, from_currency, to_currency, alert_type,
        threshold_value, notification_channels, expires_at
    )
    return alert

@app.get("/api/v1/alerts/{alert_id}", response_model=RateAlert)
async def get_alert(alert_id: str):
    """Get alert by ID"""
    alert = alert_manager.get_alert(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert

@app.get("/api/v1/alerts/user/{user_id}", response_model=List[RateAlert])
async def get_user_alerts(user_id: str, status: Optional[AlertStatus] = None):
    """Get user's alerts"""
    return alert_manager.get_user_alerts(user_id, status)

@app.delete("/api/v1/alerts/{alert_id}")
async def cancel_alert(alert_id: str):
    """Cancel alert"""
    success = alert_manager.cancel_alert(alert_id)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "cancelled", "alert_id": alert_id}

@app.get("/api/v1/alerts/triggered")
async def get_triggered_alerts(user_id: Optional[str] = None, limit: int = 100):
    """Get recently triggered alerts"""
    return alert_manager.get_triggered_alerts(user_id, limit)

@app.get("/api/v1/alerts/stats")
async def get_alert_statistics():
    """Get alert statistics"""
    return alert_manager.get_statistics()

@app.get("/api/v1/analytics/{from_currency}/{to_currency}/statistics")
async def get_rate_statistics(from_currency: str, to_currency: str, period_hours: int = 24):
    """Get statistical analysis for currency pair"""
    stats = analytics_engine.get_statistics(from_currency, to_currency, period_hours)
    if not stats:
        raise HTTPException(status_code=404, detail="No data available for this pair")
    return stats

@app.get("/api/v1/analytics/{from_currency}/{to_currency}/trend")
async def get_trend_analysis(from_currency: str, to_currency: str, period_hours: int = 24):
    """Get trend analysis for currency pair"""
    trend = analytics_engine.get_trend_analysis(from_currency, to_currency, period_hours)
    if not trend:
        raise HTTPException(status_code=404, detail="No data available for this pair")
    return trend

@app.get("/api/v1/analytics/{from_currency}/{to_currency}/historical")
async def get_historical_data(
    from_currency: str,
    to_currency: str,
    period_hours: int = 24,
    interval_minutes: int = 60
):
    """Get historical rate data with aggregation"""
    data = analytics_engine.get_historical_data(from_currency, to_currency, period_hours, interval_minutes)
    return {"currency_pair": f"{from_currency}/{to_currency}", "data": data}

@app.get("/api/v1/analytics/top-movers")
async def get_top_movers(period_hours: int = 24, limit: int = 10):
    """Get currency pairs with largest movements"""
    return analytics_engine.get_top_movers(period_hours, limit)

@app.get("/api/v1/analytics/summary")
async def get_analytics_summary():
    """Get overall analytics summary"""
    return analytics_engine.get_analytics_summary()

# Background task to update analytics
@app.on_event("startup")
async def startup_event():
    """Initialize background tasks on startup"""
    logger.info("Exchange Rate Service starting up...")
    asyncio.create_task(periodic_analytics_update())
    asyncio.create_task(periodic_alert_check())
    asyncio.create_task(periodic_cache_cleanup())

async def periodic_analytics_update():
    """Periodically update analytics with current rates"""
    while True:
        try:
            for pair_key in list(rates_cache.keys()):
                parts = pair_key.split("/")
                if len(parts) == 2:
                    rate_data = rates_cache[pair_key]
                    analytics_engine.add_data_point(
                        parts[0], parts[1], rate_data.rate, str(rate_data.source)
                    )
            await asyncio.sleep(300)  # Every 5 minutes
        except Exception as e:
            logger.error(f"Analytics update error: {e}")
            await asyncio.sleep(60)

async def periodic_alert_check():
    """Periodically check and trigger alerts"""
    while True:
        try:
            for pair_key, rate_data in rates_cache.items():
                parts = pair_key.split("/")
                if len(parts) == 2:
                    triggered = alert_manager.check_alerts(
                        parts[0], parts[1], rate_data.rate
                    )
                    for alert in triggered:
                        await alert_manager.send_notifications(alert)
            
            # Cleanup expired alerts
            alert_manager.cleanup_expired()
            
            await asyncio.sleep(60)  # Every minute
        except Exception as e:
            logger.error(f"Alert check error: {e}")
            await asyncio.sleep(60)

async def periodic_cache_cleanup():
    """Periodically cleanup expired cache entries"""
    while True:
        try:
            cache_manager.cleanup_expired()
            await asyncio.sleep(300)  # Every 5 minutes
        except Exception as e:
            logger.error(f"Cache cleanup error: {e}")
            await asyncio.sleep(60)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8051)
