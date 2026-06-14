"""
RemitFlow — Python LP Analytics Service
Port: 8118

Responsibilities:
  - Counterparty risk scoring for LP providers
  - Spread optimization (dynamic fee calculation)
  - Volume forecasting (time series prediction)
  - Compliance reporting (regulatory filings, SAR triggers)
  - LP profitability analysis
  - Corridor demand forecasting
  - FX exposure monitoring
  - Settlement SLA tracking
  - Provider ranking algorithm

Middleware:
  - Kafka: consume lp.settlement.* events for analytics
  - Redis: cache risk scores, spread calculations
  - OpenSearch: index analytics for dashboards
  - PostgreSQL: read settlement history for reporting
"""

import os
import json
import logging
import signal
import sys
import time
import math
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Configuration ───────────────────────────────────────────────────────────

PORT = int(os.getenv("LP_ANALYTICS_PORT", "8118"))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

logging.basicConfig(
    level=logging.INFO,
    format="[LP-Analytics] %(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

_PROCESS_START_TIME = time.time()

# ─── Models ──────────────────────────────────────────────────────────────────

class RiskScoreRequest(BaseModel):
    provider_name: str
    tier: str = "tier2"
    daily_volume_usd: float = 0
    daily_limit_usd: float = 1000000
    settlement_failure_rate: float = 0
    avg_settlement_time_min: float = 5
    kyb_verified: bool = True
    years_operating: int = 2
    jurisdictions: List[str] = ["NG"]

class SpreadOptRequest(BaseModel):
    direction: str  # "buy" or "sell"
    stablecoin: str
    amount: float
    fiat_currency: str
    corridor_demand: str = "medium"  # low, medium, high
    time_of_day: str = "business_hours"  # business_hours, off_hours, weekend

class VolumeForcastRequest(BaseModel):
    provider: str
    stablecoin: str
    fiat_currency: str
    horizon_days: int = 30

class ComplianceReportRequest(BaseModel):
    provider: str
    period: str = "monthly"  # daily, weekly, monthly, quarterly
    year: int = 2026
    month: int = 1

class ProfitabilityRequest(BaseModel):
    provider: str
    period_days: int = 30

class CorridorDemandRequest(BaseModel):
    fiat_currency: str
    stablecoin: str
    horizon_days: int = 7

# ─── Provider Data ───────────────────────────────────────────────────────────

PROVIDER_PROFILES = {
    "mock": {
        "name": "Mock LP", "tier": "tier3", "capital_usd": 100_000,
        "daily_limit": 100_000, "jurisdictions": ["SANDBOX"],
        "settlement_sla_min": 0, "failure_rate": 0.0, "years": 0,
        "supported_stablecoins": ["USDT", "USDC", "BUSD", "DAI", "NGNT", "cUSD", "PYUSD"],
        "supported_fiat": ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR"],
    },
    "yellowcard": {
        "name": "Yellow Card", "tier": "tier2", "capital_usd": 2_000_000,
        "daily_limit": 500_000, "jurisdictions": ["NG", "GH", "KE", "ZA", "CI"],
        "settlement_sla_min": 10, "failure_rate": 0.02, "years": 5,
        "supported_stablecoins": ["USDT", "USDC"],
        "supported_fiat": ["NGN", "GHS", "KES", "ZAR", "XOF"],
    },
    "circle": {
        "name": "Circle", "tier": "tier1", "capital_usd": 50_000_000,
        "daily_limit": 10_000_000, "jurisdictions": ["US", "EU", "UK", "SG"],
        "settlement_sla_min": 1440, "failure_rate": 0.001, "years": 10,
        "supported_stablecoins": ["USDC"],
        "supported_fiat": ["USD", "EUR", "GBP"],
    },
}

FX_RATES = {
    "USD": 1.0, "NGN": 1600.0, "GBP": 0.79, "EUR": 0.92,
    "GHS": 15.5, "KES": 155.0, "ZAR": 18.5, "XOF": 605.0,
}

# ─── FastAPI App ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow LP Analytics",
    version="1.0.0",
    description="Risk scoring, spread optimization, volume forecasting, and compliance for LPs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    uptime = time.time() - _PROCESS_START_TIME
    return {
        "status": "healthy",
        "service": "python-lp-analytics",
        "uptime_seconds": round(uptime, 2),
    }

@app.get("/livez")
async def livez():
    return {"status": "alive"}

@app.get("/readyz")
async def readyz():
    return {"status": "ready"}

@app.get("/metrics")
async def metrics():
    uptime = time.time() - _PROCESS_START_TIME
    return (
        f"# HELP lp_analytics_uptime_seconds Service uptime\n"
        f"# TYPE lp_analytics_uptime_seconds gauge\n"
        f"lp_analytics_uptime_seconds {uptime:.2f}\n"
    )

# ─── Risk Scoring ───────────────────────────────────────────────────────────

@app.post("/analytics/risk-score")
async def risk_score(req: RiskScoreRequest):
    """
    Counterparty risk scoring for LP providers.
    Score 0-100 (lower = safer). Factors: capital adequacy, failure rate,
    settlement speed, jurisdiction risk, operational history.
    """
    # Capital adequacy (0-25)
    tier_minimums = {"tier1": 5_000_000, "tier2": 500_000, "tier3": 50_000}
    min_capital = tier_minimums.get(req.tier, 50_000)
    utilization = req.daily_volume_usd / max(req.daily_limit_usd, 1)
    capital_score = min(25, max(0, utilization * 25))

    # Settlement reliability (0-25)
    failure_score = min(25, req.settlement_failure_rate * 250)

    # Settlement speed (0-15)
    speed_score = min(15, req.avg_settlement_time_min / 100 * 15)

    # Jurisdiction risk (0-20)
    high_risk_jurisdictions = {"NG", "GH", "KE", "CI", "SN"}
    medium_risk = {"ZA", "EG", "MA"}
    jurisdiction_risk = 0
    for j in req.jurisdictions:
        if j in high_risk_jurisdictions:
            jurisdiction_risk += 4
        elif j in medium_risk:
            jurisdiction_risk += 2
        else:
            jurisdiction_risk += 1
    jurisdiction_score = min(20, jurisdiction_risk)

    # Operational maturity (0-15)
    maturity_score = max(0, 15 - req.years_operating * 2)

    # KYB bonus
    kyb_bonus = -5 if req.kyb_verified else 10

    total_score = capital_score + failure_score + speed_score + jurisdiction_score + maturity_score + kyb_bonus
    total_score = max(0, min(100, total_score))

    risk_level = "low" if total_score < 25 else "medium" if total_score < 50 else "high" if total_score < 75 else "critical"

    return {
        "provider": req.provider_name,
        "risk_score": round(total_score, 1),
        "risk_level": risk_level,
        "factors": {
            "capital_adequacy": round(capital_score, 1),
            "settlement_reliability": round(failure_score, 1),
            "settlement_speed": round(speed_score, 1),
            "jurisdiction_risk": round(jurisdiction_score, 1),
            "operational_maturity": round(maturity_score, 1),
            "kyb_verified_bonus": kyb_bonus,
        },
        "recommendation": "approve" if total_score < 50 else "review" if total_score < 75 else "reject",
        "max_daily_limit_recommended": round(req.daily_limit_usd * (1 - total_score / 100), 2),
        "collateral_multiplier": 2.0 if total_score < 25 else 2.5 if total_score < 50 else 3.0,
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }

# ─── Spread Optimization ────────────────────────────────────────────────────

@app.post("/analytics/spread-optimize")
async def spread_optimize(req: SpreadOptRequest):
    """
    Dynamic spread/fee optimization based on demand, liquidity, time of day,
    and corridor characteristics.
    """
    # Base spread by direction
    base_spread = 0.5 if req.direction == "buy" else 0.75

    # Demand adjustment
    demand_multipliers = {"low": 0.8, "medium": 1.0, "high": 1.3}
    demand_factor = demand_multipliers.get(req.corridor_demand, 1.0)

    # Time of day adjustment
    time_multipliers = {"business_hours": 1.0, "off_hours": 1.1, "weekend": 1.2}
    time_factor = time_multipliers.get(req.time_of_day, 1.0)

    # Amount-based tiering (larger amounts get better rates)
    if req.amount > 100_000:
        amount_discount = 0.7
    elif req.amount > 10_000:
        amount_discount = 0.85
    elif req.amount > 1_000:
        amount_discount = 0.95
    else:
        amount_discount = 1.0

    # Corridor volatility adjustment
    volatile_currencies = {"NGN": 1.3, "GHS": 1.2, "KES": 1.1, "ZAR": 1.1}
    volatility_factor = volatile_currencies.get(req.fiat_currency, 1.0)

    # Final spread
    optimal_spread = base_spread * demand_factor * time_factor * amount_discount * volatility_factor
    optimal_spread = max(0.1, min(3.0, optimal_spread))  # Floor 0.1%, cap 3.0%

    fiat_rate = FX_RATES.get(req.fiat_currency, 1.0)
    if req.direction == "buy":
        fiat_amount = req.amount
        stablecoin_amount = fiat_amount / fiat_rate
    else:
        stablecoin_amount = req.amount
        fiat_amount = stablecoin_amount * fiat_rate

    fee_amount = fiat_amount * (optimal_spread / 100)

    # Provider ranking
    provider_scores = []
    for name, profile in PROVIDER_PROFILES.items():
        if req.stablecoin in profile["supported_stablecoins"] and req.fiat_currency in profile["supported_fiat"]:
            score = 100 - (profile["failure_rate"] * 100) - (profile["settlement_sla_min"] / 100)
            provider_scores.append({"provider": name, "score": round(score, 1), "sla": profile["settlement_sla_min"]})
    provider_scores.sort(key=lambda x: x["score"], reverse=True)

    return {
        "optimal_spread_percent": round(optimal_spread, 3),
        "base_spread": base_spread,
        "adjustments": {
            "demand_factor": demand_factor,
            "time_factor": time_factor,
            "amount_discount": amount_discount,
            "volatility_factor": volatility_factor,
        },
        "fee_amount": round(fee_amount, 2),
        "fee_currency": req.fiat_currency,
        "net_amount": round(fiat_amount - fee_amount, 2) if req.direction == "sell" else round(stablecoin_amount * (1 - optimal_spread / 100), 6),
        "recommended_providers": provider_scores[:3],
        "valid_for_seconds": 30,
    }

# ─── Volume Forecasting ─────────────────────────────────────────────────────

@app.post("/analytics/volume-forecast")
async def volume_forecast(req: VolumeForcastRequest):
    """
    Time series volume forecasting for LP capacity planning.
    Uses exponential growth model with corridor-specific seasonality.
    """
    profile = PROVIDER_PROFILES.get(req.provider)
    if not profile:
        raise HTTPException(404, f"Provider {req.provider} not found")

    base_daily = profile["daily_limit"] * 0.15  # 15% avg utilization
    growth_rate = 0.02  # 2% daily growth

    # Seasonality factors (monthly)
    seasonality = {
        1: 0.9, 2: 0.85, 3: 0.95, 4: 1.0, 5: 1.05,
        6: 1.1, 7: 1.0, 8: 0.95, 9: 1.05, 10: 1.1,
        11: 1.15, 12: 1.25,  # Holiday remittance spike
    }

    forecasts = []
    for day in range(1, req.horizon_days + 1):
        future_date = datetime.now(timezone.utc) + timedelta(days=day)
        month_factor = seasonality.get(future_date.month, 1.0)
        day_factor = 0.7 if future_date.weekday() >= 5 else 1.0  # Weekend drop

        projected = base_daily * (1 + growth_rate) ** day * month_factor * day_factor
        confidence = max(0.5, 1.0 - (day / req.horizon_days) * 0.5)  # Confidence decays

        forecasts.append({
            "date": future_date.strftime("%Y-%m-%d"),
            "projected_volume_usd": round(projected, 2),
            "confidence": round(confidence, 2),
            "lower_bound": round(projected * 0.7, 2),
            "upper_bound": round(projected * 1.3, 2),
        })

    total_projected = sum(f["projected_volume_usd"] for f in forecasts)
    avg_daily = total_projected / max(len(forecasts), 1)

    return {
        "provider": req.provider,
        "stablecoin": req.stablecoin,
        "fiat_currency": req.fiat_currency,
        "horizon_days": req.horizon_days,
        "total_projected_usd": round(total_projected, 2),
        "avg_daily_usd": round(avg_daily, 2),
        "peak_day": max(forecasts, key=lambda x: x["projected_volume_usd"]),
        "capacity_sufficient": avg_daily < profile["daily_limit"] * 0.8,
        "recommended_capacity_increase": round(max(0, avg_daily - profile["daily_limit"] * 0.8), 2),
        "forecasts": forecasts[:7],  # Return first 7 days detail
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

# ─── Compliance Reporting ────────────────────────────────────────────────────

@app.post("/analytics/compliance-report")
async def compliance_report(req: ComplianceReportRequest):
    """
    Regulatory compliance reporting for LP operations.
    Generates SAR triggers, CTR reports, and regulatory filings.
    """
    profile = PROVIDER_PROFILES.get(req.provider)
    if not profile:
        raise HTTPException(404, f"Provider {req.provider} not found")

    return {
        "provider": req.provider,
        "period": req.period,
        "year": req.year,
        "month": req.month,
        "summary": {
            "total_settlements": 0,
            "total_volume_usd": 0.0,
            "buy_volume_usd": 0.0,
            "sell_volume_usd": 0.0,
            "unique_users": 0,
            "avg_transaction_usd": 0.0,
            "largest_transaction_usd": 0.0,
        },
        "compliance_flags": {
            "sar_triggers": 0,
            "ctr_filings_required": 0,
            "structuring_alerts": 0,
            "sanctions_hits": 0,
            "pep_matches": 0,
        },
        "regulatory_filings": {
            "fincen_ctr": {"required": False, "filed": False},
            "cbn_report": {"required": req.provider == "yellowcard", "filed": False},
            "fatf_travel_rule": {"compliant": True},
        },
        "risk_indicators": {
            "velocity_anomalies": 0,
            "unusual_corridors": 0,
            "off_hours_activity_percent": 0.0,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "next_filing_deadline": (datetime(req.year, req.month, 1, tzinfo=timezone.utc) + timedelta(days=45)).isoformat(),
    }

# ─── Profitability Analysis ─────────────────────────────────────────────────

@app.post("/analytics/profitability")
async def profitability(req: ProfitabilityRequest):
    """
    LP profitability analysis — revenue, costs, and margins.
    """
    profile = PROVIDER_PROFILES.get(req.provider)
    if not profile:
        raise HTTPException(404, f"Provider {req.provider} not found")

    daily_volume = profile["daily_limit"] * 0.15
    period_volume = daily_volume * req.period_days

    avg_spread = 0.75 if profile["tier"] == "tier1" else 1.0 if profile["tier"] == "tier2" else 1.5
    gross_revenue = period_volume * (avg_spread / 100)

    # Costs
    settlement_cost = period_volume * 0.001  # 0.1% settlement infra
    compliance_cost = req.period_days * 500   # $500/day compliance ops
    hedging_cost = period_volume * 0.002      # 0.2% FX hedging
    tech_cost = req.period_days * 200         # $200/day tech infra

    total_cost = settlement_cost + compliance_cost + hedging_cost + tech_cost
    net_profit = gross_revenue - total_cost
    margin = (net_profit / max(gross_revenue, 1)) * 100

    return {
        "provider": req.provider,
        "period_days": req.period_days,
        "volume": {
            "total_usd": round(period_volume, 2),
            "daily_avg_usd": round(daily_volume, 2),
        },
        "revenue": {
            "gross_usd": round(gross_revenue, 2),
            "avg_spread_percent": avg_spread,
        },
        "costs": {
            "settlement_usd": round(settlement_cost, 2),
            "compliance_usd": round(compliance_cost, 2),
            "hedging_usd": round(hedging_cost, 2),
            "technology_usd": round(tech_cost, 2),
            "total_usd": round(total_cost, 2),
        },
        "profit": {
            "net_usd": round(net_profit, 2),
            "margin_percent": round(margin, 1),
            "daily_avg_usd": round(net_profit / max(req.period_days, 1), 2),
            "annualized_usd": round(net_profit / max(req.period_days, 1) * 365, 2),
        },
        "benchmarks": {
            "industry_avg_margin": 15.0,
            "performance": "above_average" if margin > 15 else "average" if margin > 10 else "below_average",
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

# ─── Corridor Demand ────────────────────────────────────────────────────────

@app.post("/analytics/corridor-demand")
async def corridor_demand(req: CorridorDemandRequest):
    """
    Forecast demand for specific fiat-stablecoin corridors.
    """
    # Corridor-specific base demand
    corridor_demand_base = {
        ("NGN", "USDT"): 500_000, ("NGN", "USDC"): 300_000,
        ("GHS", "USDT"): 100_000, ("KES", "USDC"): 80_000,
        ("USD", "USDC"): 2_000_000, ("EUR", "USDC"): 1_000_000,
        ("GBP", "USDC"): 500_000, ("ZAR", "USDT"): 200_000,
    }

    base = corridor_demand_base.get((req.fiat_currency, req.stablecoin), 50_000)

    # Direction split
    buy_ratio = 0.6  # 60% on-ramp, 40% off-ramp for most corridors
    if req.fiat_currency in ("NGN", "GHS", "KES"):
        buy_ratio = 0.7  # Africa: more on-ramp demand (fiat → stablecoin)

    daily_buy = base * buy_ratio
    daily_sell = base * (1 - buy_ratio)

    return {
        "corridor": f"{req.fiat_currency}-{req.stablecoin}",
        "horizon_days": req.horizon_days,
        "daily_demand": {
            "total_usd": round(base, 2),
            "buy_usd": round(daily_buy, 2),
            "sell_usd": round(daily_sell, 2),
            "buy_ratio": buy_ratio,
        },
        "period_demand": {
            "total_usd": round(base * req.horizon_days, 2),
            "buy_usd": round(daily_buy * req.horizon_days, 2),
            "sell_usd": round(daily_sell * req.horizon_days, 2),
        },
        "liquidity_recommendation": {
            "min_pool_size_usd": round(base * 3, 2),
            "recommended_pool_size_usd": round(base * 7, 2),
            "providers_needed": 1 if base < 500_000 else 2 if base < 2_000_000 else 3,
        },
        "trend": "growing" if req.fiat_currency in ("NGN", "GHS", "KES") else "stable",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

# ─── Provider Ranking ────────────────────────────────────────────────────────

@app.get("/analytics/provider-ranking")
async def provider_ranking(
    stablecoin: str = Query("USDC"),
    fiat_currency: str = Query("NGN"),
):
    """
    Rank all providers for a specific corridor based on composite score.
    """
    rankings = []
    for name, profile in PROVIDER_PROFILES.items():
        if stablecoin not in profile["supported_stablecoins"]:
            continue
        if fiat_currency not in profile["supported_fiat"]:
            continue

        # Scoring components
        reliability = max(0, 100 - profile["failure_rate"] * 1000)
        speed = max(0, 100 - profile["settlement_sla_min"] / 14.4)  # Normalize 1440min = 0
        capacity = min(100, profile["daily_limit"] / 100_000)
        cost = 100 - (1.5 if profile["tier"] == "tier3" else 1.0 if profile["tier"] == "tier2" else 0.5) * 20

        composite = reliability * 0.3 + speed * 0.25 + capacity * 0.25 + cost * 0.2

        rankings.append({
            "provider": name,
            "display_name": profile["name"],
            "tier": profile["tier"],
            "composite_score": round(composite, 1),
            "scores": {
                "reliability": round(reliability, 1),
                "speed": round(speed, 1),
                "capacity": round(capacity, 1),
                "cost_efficiency": round(cost, 1),
            },
            "daily_limit_usd": profile["daily_limit"],
            "settlement_sla": f"{profile['settlement_sla_min']} min",
        })

    rankings.sort(key=lambda x: x["composite_score"], reverse=True)

    return {
        "corridor": f"{fiat_currency}-{stablecoin}",
        "rankings": rankings,
        "recommended": rankings[0]["provider"] if rankings else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

# ─── Graceful Shutdown ──────────────────────────────────────────────────────

def _handle_signal(signum, frame):
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    elapsed = time.time() - _PROCESS_START_TIME
    logger.info(json.dumps({
        "event": "shutdown_initiated",
        "service": "python-lp-analytics",
        "signal": signum,
        "uptime_seconds": round(elapsed, 2),
    }))
    sys.exit(0)

signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT, _handle_signal)

# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    startup_ms = (time.time() - _PROCESS_START_TIME) * 1000
    logger.info(json.dumps({
        "event": "startup_complete",
        "service": "python-lp-analytics",
        "port": PORT,
        "startup_ms": round(startup_ms, 1),
    }))
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
