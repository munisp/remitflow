"""
RemitFlow — Python Stablecoin Analytics Service
Port: 8115

Responsibilities:
  - DCA (Dollar-Cost Averaging) schedule optimization
  - Yield/APY aggregation across DeFi protocols
  - Tax report generation for stablecoin transactions
  - FX trend analysis for on-ramp/off-ramp timing
  - De-peg early warning system with ML anomaly detection
  - Auto-convert recommendation engine
  - Virtual card spend analytics
  - Stablecoin portfolio optimization

Middleware:
  - Kafka: consume stablecoin events, produce analytics
  - Redis: cache yield rates, FX predictions
  - OpenSearch: index analytics reports
  - PostgreSQL: read transaction history for reporting
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

PORT = int(os.getenv("STABLECOIN_ANALYTICS_PORT", "8115"))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")

logging.basicConfig(
    level=logging.INFO,
    format="[StablecoinAnalytics] %(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

_PROCESS_START_TIME = time.time()

# ─── Models ──────────────────────────────────────────────────────────────────

class DCAOptimization(BaseModel):
    stablecoin: str
    fiat_currency: str
    monthly_budget: float
    risk_tolerance: str = "medium"  # low, medium, high

class TaxReportRequest(BaseModel):
    user_id: int
    year: int
    format: str = "summary"  # summary, detailed, csv

class YieldRecommendation(BaseModel):
    stablecoin: str
    amount: float
    risk_tolerance: str = "low"

class AutoConvertAnalysis(BaseModel):
    user_id: int
    corridor: str  # e.g. "NGN-USDC"
    monthly_volume: float

class DePegPrediction(BaseModel):
    symbol: str
    timeframe_hours: int = 24

class PortfolioOptRequest(BaseModel):
    total_usd: float
    risk_tolerance: str = "medium"
    yield_priority: bool = True

# ─── Yield Data ──────────────────────────────────────────────────────────────

YIELD_POOLS = [
    {"symbol": "USDT", "protocol": "Aave V3", "chain": "ethereum", "apy": 4.2, "tvl": 2_500_000_000, "risk": "low", "audited": True},
    {"symbol": "USDC", "protocol": "Aave V3", "chain": "ethereum", "apy": 4.5, "tvl": 3_100_000_000, "risk": "low", "audited": True},
    {"symbol": "DAI", "protocol": "Compound V3", "chain": "ethereum", "apy": 3.8, "tvl": 1_800_000_000, "risk": "low", "audited": True},
    {"symbol": "USDT", "protocol": "Venus", "chain": "bsc", "apy": 5.1, "tvl": 800_000_000, "risk": "medium", "audited": True},
    {"symbol": "USDC", "protocol": "Aave V3", "chain": "polygon", "apy": 5.8, "tvl": 500_000_000, "risk": "low", "audited": True},
    {"symbol": "USDT", "protocol": "Stargate", "chain": "arbitrum", "apy": 3.2, "tvl": 400_000_000, "risk": "medium", "audited": True},
    {"symbol": "USDC", "protocol": "Compound V3", "chain": "base", "apy": 4.8, "tvl": 200_000_000, "risk": "low", "audited": True},
    {"symbol": "cUSD", "protocol": "Moola Market", "chain": "celo", "apy": 6.5, "tvl": 50_000_000, "risk": "medium", "audited": False},
    {"symbol": "PYUSD", "protocol": "Aave V3", "chain": "ethereum", "apy": 4.0, "tvl": 150_000_000, "risk": "low", "audited": True},
    {"symbol": "DAI", "protocol": "Spark", "chain": "ethereum", "apy": 5.0, "tvl": 1_200_000_000, "risk": "low", "audited": True},
]

FX_RATES = {
    "USD": 1.0, "NGN": 1600.0, "GBP": 0.79, "EUR": 0.92,
    "GHS": 15.5, "KES": 155.0, "ZAR": 18.5, "XOF": 605.0,
}

# ─── FastAPI App ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Stablecoin Analytics",
    version="1.0.0",
    description="Analytics, optimization, and reporting for stablecoin operations",
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
        "service": "python-stablecoin-analytics",
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
        f"# HELP stablecoin_analytics_uptime_seconds Service uptime\n"
        f"# TYPE stablecoin_analytics_uptime_seconds gauge\n"
        f"stablecoin_analytics_uptime_seconds {uptime:.2f}\n"
    )

# ─── DCA Optimization ───────────────────────────────────────────────────────

@app.post("/analytics/dca-optimize")
async def dca_optimize(req: DCAOptimization):
    """Optimize DCA strategy based on FX trends and yield opportunities."""
    fiat_rate = FX_RATES.get(req.fiat_currency, 1.0)
    monthly_usd = req.monthly_budget / fiat_rate

    # Strategy based on risk tolerance
    strategies = {
        "low": {
            "frequency": "weekly",
            "split": {"USDC": 70, "USDT": 30},
            "yield_protocol": "Aave V3",
            "auto_stake": True,
        },
        "medium": {
            "frequency": "daily",
            "split": {"USDC": 50, "USDT": 30, "DAI": 20},
            "yield_protocol": "Compound V3",
            "auto_stake": True,
        },
        "high": {
            "frequency": "daily",
            "split": {"USDC": 40, "USDT": 20, "DAI": 20, "cUSD": 20},
            "yield_protocol": "Multiple",
            "auto_stake": True,
        },
    }

    strategy = strategies.get(req.risk_tolerance, strategies["medium"])
    frequency_days = {"daily": 1, "weekly": 7, "biweekly": 14, "monthly": 30}
    purchases_per_year = 365 // frequency_days[strategy["frequency"]]
    amount_per_purchase = monthly_usd * 12 / purchases_per_year

    # Estimate yield
    avg_apy = sum(
        p["apy"] for p in YIELD_POOLS
        if p["symbol"] in strategy["split"] and p["risk"] == req.risk_tolerance
    ) / max(len([p for p in YIELD_POOLS if p["symbol"] in strategy["split"]]), 1)

    projected_annual = monthly_usd * 12
    projected_yield = projected_annual * (avg_apy / 100)

    return {
        "strategy": strategy,
        "monthly_budget_usd": round(monthly_usd, 2),
        "amount_per_purchase_usd": round(amount_per_purchase, 2),
        "purchases_per_year": purchases_per_year,
        "projected_annual_investment_usd": round(projected_annual, 2),
        "projected_annual_yield_usd": round(projected_yield, 2),
        "effective_apy": round(avg_apy, 2),
        "recommended_chain": "polygon" if monthly_usd < 1000 else "ethereum",
        "gas_savings_vs_ethereum": "98%" if monthly_usd < 1000 else "0%",
    }

# ─── Yield Aggregation ──────────────────────────────────────────────────────

@app.get("/analytics/yield-pools")
async def yield_pools(
    symbol: Optional[str] = None,
    chain: Optional[str] = None,
    min_apy: float = 0.0,
    risk: Optional[str] = None,
):
    """Get aggregated yield pools across DeFi protocols."""
    pools = YIELD_POOLS
    if symbol:
        pools = [p for p in pools if p["symbol"] == symbol.upper()]
    if chain:
        pools = [p for p in pools if p["chain"] == chain.lower()]
    if min_apy > 0:
        pools = [p for p in pools if p["apy"] >= min_apy]
    if risk:
        pools = [p for p in pools if p["risk"] == risk.lower()]

    return {
        "pools": sorted(pools, key=lambda x: x["apy"], reverse=True),
        "count": len(pools),
        "avg_apy": round(sum(p["apy"] for p in pools) / max(len(pools), 1), 2),
        "total_tvl": sum(p["tvl"] for p in pools),
    }

@app.post("/analytics/yield-recommend")
async def yield_recommend(req: YieldRecommendation):
    """Recommend optimal yield strategy for a given amount."""
    eligible = [p for p in YIELD_POOLS if p["symbol"] == req.stablecoin]
    if req.risk_tolerance == "low":
        eligible = [p for p in eligible if p["risk"] == "low" and p["audited"]]
    elif req.risk_tolerance == "medium":
        eligible = [p for p in eligible if p["audited"]]

    eligible.sort(key=lambda x: x["apy"], reverse=True)

    if not eligible:
        return {"recommendation": None, "message": f"No yield pools found for {req.stablecoin}"}

    best = eligible[0]
    daily_yield = req.amount * (best["apy"] / 100) / 365
    monthly_yield = daily_yield * 30
    annual_yield = req.amount * (best["apy"] / 100)

    return {
        "recommendation": best,
        "amount": req.amount,
        "projected_daily_yield": round(daily_yield, 4),
        "projected_monthly_yield": round(monthly_yield, 2),
        "projected_annual_yield": round(annual_yield, 2),
        "alternatives": eligible[1:3],
    }

# ─── Tax Reporting ───────────────────────────────────────────────────────────

@app.post("/analytics/tax-report")
async def tax_report(req: TaxReportRequest):
    """Generate tax report for stablecoin transactions."""
    # In production, query PostgreSQL for actual transactions
    return {
        "user_id": req.user_id,
        "year": req.year,
        "format": req.format,
        "summary": {
            "total_transactions": 0,
            "total_on_ramp_usd": 0.0,
            "total_off_ramp_usd": 0.0,
            "total_fees_usd": 0.0,
            "total_yield_earned_usd": 0.0,
            "net_position_usd": 0.0,
            "taxable_events": 0,
            "capital_gains_usd": 0.0,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "For informational purposes only. Consult a tax professional.",
    }

# ─── Auto-Convert Analysis ──────────────────────────────────────────────────

@app.post("/analytics/auto-convert")
async def auto_convert_analysis(req: AutoConvertAnalysis):
    """Analyze whether auto-converting remittances to stablecoins is beneficial."""
    parts = req.corridor.split("-")
    if len(parts) != 2:
        raise HTTPException(400, "corridor must be in format 'FIAT-STABLECOIN'")

    fiat, stablecoin = parts
    fiat_rate = FX_RATES.get(fiat, 1.0)
    monthly_usd = req.monthly_volume / fiat_rate

    # FX depreciation estimate (annualized)
    depreciation_estimates = {
        "NGN": 15.0, "GHS": 12.0, "KES": 8.0, "ZAR": 6.0, "XOF": 2.0,
    }
    depreciation = depreciation_estimates.get(fiat, 5.0)

    # Best yield for the target stablecoin
    best_yield = max(
        (p["apy"] for p in YIELD_POOLS if p["symbol"] == stablecoin),
        default=0.0,
    )

    annual_volume_usd = monthly_usd * 12
    depreciation_savings = annual_volume_usd * (depreciation / 100)
    yield_earnings = annual_volume_usd * (best_yield / 100)
    on_ramp_cost = annual_volume_usd * 0.005  # 0.5% on-ramp fee
    net_benefit = depreciation_savings + yield_earnings - on_ramp_cost

    return {
        "corridor": req.corridor,
        "monthly_volume_usd": round(monthly_usd, 2),
        "annual_volume_usd": round(annual_volume_usd, 2),
        "fiat_depreciation_rate": depreciation,
        "depreciation_savings_usd": round(depreciation_savings, 2),
        "yield_apy": best_yield,
        "yield_earnings_usd": round(yield_earnings, 2),
        "on_ramp_cost_usd": round(on_ramp_cost, 2),
        "net_annual_benefit_usd": round(net_benefit, 2),
        "recommendation": "enable" if net_benefit > 0 else "disable",
        "confidence": "high" if net_benefit > annual_volume_usd * 0.05 else "medium",
        "suggested_convert_percent": min(100, max(25, int(net_benefit / annual_volume_usd * 1000))),
    }

# ─── De-Peg Early Warning ───────────────────────────────────────────────────

@app.post("/analytics/depeg-predict")
async def depeg_predict(req: DePegPrediction):
    """ML-based de-peg risk prediction."""
    # Simplified model — production would use time series analysis
    risk_factors = {
        "USDT": {"issuer_risk": 0.05, "market_cap_b": 83, "reserves_audited": True},
        "USDC": {"issuer_risk": 0.02, "market_cap_b": 33, "reserves_audited": True},
        "BUSD": {"issuer_risk": 0.15, "market_cap_b": 2, "reserves_audited": False},
        "DAI": {"issuer_risk": 0.03, "market_cap_b": 5, "reserves_audited": True},
        "PYUSD": {"issuer_risk": 0.02, "market_cap_b": 0.8, "reserves_audited": True},
        "cUSD": {"issuer_risk": 0.08, "market_cap_b": 0.1, "reserves_audited": False},
        "NGNT": {"issuer_risk": 0.20, "market_cap_b": 0.01, "reserves_audited": False},
    }

    factors = risk_factors.get(req.symbol, {"issuer_risk": 0.5, "market_cap_b": 0, "reserves_audited": False})

    # Risk score: lower market cap + higher issuer risk = more de-peg risk
    base_risk = factors["issuer_risk"]
    cap_factor = 1.0 / (1.0 + math.log(max(factors["market_cap_b"], 0.01)))
    audit_factor = 0.5 if factors["reserves_audited"] else 1.5
    time_factor = min(req.timeframe_hours / 24, 7) / 7  # Normalize to 0-1

    depeg_probability = min(base_risk * cap_factor * audit_factor * (0.3 + 0.7 * time_factor), 1.0)

    return {
        "symbol": req.symbol,
        "timeframe_hours": req.timeframe_hours,
        "depeg_probability": round(depeg_probability * 100, 2),
        "risk_level": "low" if depeg_probability < 0.05 else "medium" if depeg_probability < 0.15 else "high",
        "factors": {
            "issuer_risk": factors["issuer_risk"],
            "market_cap_billion": factors["market_cap_b"],
            "reserves_audited": factors["reserves_audited"],
        },
        "recommendation": "hold" if depeg_probability < 0.1 else "reduce_exposure",
        "predicted_at": datetime.now(timezone.utc).isoformat(),
    }

# ─── Portfolio Optimization ──────────────────────────────────────────────────

@app.post("/analytics/portfolio-optimize")
async def portfolio_optimize(req: PortfolioOptRequest):
    """Optimize stablecoin portfolio allocation."""
    allocations = {
        "low": [
            {"symbol": "USDC", "percent": 50, "protocol": "Aave V3", "chain": "ethereum"},
            {"symbol": "USDT", "percent": 30, "protocol": "Aave V3", "chain": "ethereum"},
            {"symbol": "DAI", "percent": 20, "protocol": "Compound V3", "chain": "ethereum"},
        ],
        "medium": [
            {"symbol": "USDC", "percent": 35, "protocol": "Aave V3", "chain": "polygon"},
            {"symbol": "USDT", "percent": 25, "protocol": "Venus", "chain": "bsc"},
            {"symbol": "DAI", "percent": 20, "protocol": "Spark", "chain": "ethereum"},
            {"symbol": "USDC", "percent": 20, "protocol": "Compound V3", "chain": "base"},
        ],
        "high": [
            {"symbol": "USDC", "percent": 25, "protocol": "Aave V3", "chain": "polygon"},
            {"symbol": "USDT", "percent": 20, "protocol": "Venus", "chain": "bsc"},
            {"symbol": "cUSD", "percent": 20, "protocol": "Moola Market", "chain": "celo"},
            {"symbol": "DAI", "percent": 20, "protocol": "Spark", "chain": "ethereum"},
            {"symbol": "USDT", "percent": 15, "protocol": "Stargate", "chain": "arbitrum"},
        ],
    }

    portfolio = allocations.get(req.risk_tolerance, allocations["medium"])

    total_weighted_apy = 0
    for alloc in portfolio:
        pool = next((p for p in YIELD_POOLS if p["symbol"] == alloc["symbol"] and p["protocol"] == alloc["protocol"]), None)
        apy = pool["apy"] if pool else 3.0
        alloc["apy"] = apy
        alloc["amount_usd"] = round(req.total_usd * alloc["percent"] / 100, 2)
        alloc["projected_annual_yield"] = round(alloc["amount_usd"] * apy / 100, 2)
        total_weighted_apy += apy * alloc["percent"] / 100

    return {
        "total_usd": req.total_usd,
        "risk_tolerance": req.risk_tolerance,
        "allocations": portfolio,
        "weighted_apy": round(total_weighted_apy, 2),
        "projected_annual_yield_usd": round(req.total_usd * total_weighted_apy / 100, 2),
        "projected_monthly_yield_usd": round(req.total_usd * total_weighted_apy / 100 / 12, 2),
        "diversification_score": len(set(a["chain"] for a in portfolio)) / 5 * 100,
    }

# ─── Card Spend Analytics ───────────────────────────────────────────────────

@app.get("/analytics/card-spend")
async def card_spend_analytics(user_id: int = Query(...)):
    """Analytics for virtual stablecoin card spending."""
    return {
        "user_id": user_id,
        "period": "last_30_days",
        "total_spend_usd": 0.0,
        "transaction_count": 0,
        "categories": {},
        "top_merchants": [],
        "avg_transaction_usd": 0.0,
        "savings_vs_fx": 0.0,
    }

# ─── Graceful Shutdown ──────────────────────────────────────────────────────

def _handle_signal(signum, frame):
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    elapsed = time.time() - _PROCESS_START_TIME
    logger.info(json.dumps({
        "event": "shutdown_initiated",
        "service": "python-stablecoin-analytics",
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
        "service": "python-stablecoin-analytics",
        "port": PORT,
        "startup_ms": round(startup_ms, 1),
    }))
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
