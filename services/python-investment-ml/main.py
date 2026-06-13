"""
RemitFlow — Python Investment ML Recommendation Engine (port 8089)
FastAPI service providing AI-driven investment recommendations,
risk scoring, sentiment analysis, and diaspora-specific investment insights.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
import signal
import atexit

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS investment_ml_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_investment_ml_updated
                    ON investment_ml_state(updated_at);
                CREATE TABLE IF NOT EXISTS investment_ml_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_investment_ml_events_type
                    ON investment_ml_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO investment_ml_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM investment_ml_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM investment_ml_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO investment_ml_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


app = FastAPI(
    title="RemitFlow Investment ML Engine",
    version="1.0.0",
    description="AI-driven investment recommendations for diaspora investors",
)

# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-investment-ml").info(f"Received signal {signum}, initiating graceful shutdown...")

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-investment-ml").info("FastAPI shutdown event — cleaning up resources")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Models ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    timestamp: str


class HoldingInput(BaseModel):
    symbol: str
    asset_type: str
    quantity: float
    purchase_price: float
    current_price: float
    currency: str = "USD"
    sector: Optional[str] = None
    country: Optional[str] = None


class RecommendRequest(BaseModel):
    user_id: int
    risk_tolerance: str = Field(default="moderate", description="conservative|moderate|aggressive")
    investment_horizon: str = Field(default="medium", description="short|medium|long")
    home_country: Optional[str] = None
    diaspora_country: Optional[str] = None
    monthly_budget_usd: float = 100.0
    existing_holdings: list[HoldingInput] = []
    preferred_sectors: list[str] = []
    exclude_sectors: list[str] = []


class AssetRecommendation(BaseModel):
    symbol: str
    name: str
    asset_type: str
    reason: str
    confidence_score: float
    expected_return_1y: float
    risk_level: str
    diaspora_relevance: str
    suggested_allocation_pct: float
    min_investment_usd: float


class RecommendResponse(BaseModel):
    user_id: int
    recommendations: list[AssetRecommendation]
    portfolio_strategy: str
    diaspora_insight: str
    generated_at: str


class RiskScoreRequest(BaseModel):
    age: Optional[int] = None
    monthly_income_usd: float = 1000.0
    monthly_expenses_usd: float = 700.0
    existing_savings_usd: float = 0.0
    investment_experience: str = "beginner"  # beginner|intermediate|advanced
    risk_preference: str = "moderate"  # conservative|moderate|aggressive
    dependents: int = 0
    employment_status: str = "employed"  # employed|self_employed|unemployed|retired
    home_country: Optional[str] = None


class RiskScoreResponse(BaseModel):
    risk_score: float  # 0-100
    risk_label: str
    recommended_allocation: dict[str, float]
    max_investment_pct_income: float
    emergency_fund_months: int
    key_factors: list[str]
    scored_at: str


class SentimentRequest(BaseModel):
    symbols: list[str]
    include_news: bool = True


class AssetSentiment(BaseModel):
    symbol: str
    sentiment_score: float  # -1 to 1
    sentiment_label: str
    confidence: float
    bullish_signals: list[str]
    bearish_signals: list[str]
    diaspora_demand_index: float  # 0-100


class SentimentResponse(BaseModel):
    sentiments: list[AssetSentiment]
    market_mood: str
    analyzed_at: str


# ─── Asset Knowledge Base ─────────────────────────────────────────────────────

ASSET_CATALOG: list[dict[str, Any]] = [
    # African stocks
    {"symbol": "MTN", "name": "MTN Group", "type": "stock", "sector": "Telecom",
     "country": "ZA", "diaspora_relevance": "Africa's largest telecom — connects diaspora to home",
     "risk": "moderate", "expected_return": 12.5},
    {"symbol": "SAFCOM", "name": "Safaricom", "type": "stock", "sector": "Telecom",
     "country": "KE", "diaspora_relevance": "M-Pesa operator — core remittance infrastructure",
     "risk": "moderate", "expected_return": 14.0},
    {"symbol": "EQBNK", "name": "Equity Bank Kenya", "type": "stock", "sector": "Finance",
     "country": "KE", "diaspora_relevance": "Pan-African bank serving diaspora accounts",
     "risk": "moderate", "expected_return": 11.0},
    {"symbol": "DANGCEM", "name": "Dangote Cement", "type": "stock", "sector": "Materials",
     "country": "NG", "diaspora_relevance": "Africa infrastructure growth play",
     "risk": "moderate", "expected_return": 10.5},
    # Global stocks
    {"symbol": "AAPL", "name": "Apple Inc.", "type": "stock", "sector": "Technology",
     "country": "US", "diaspora_relevance": "Tech savings in diaspora currency",
     "risk": "low", "expected_return": 11.0},
    {"symbol": "MSFT", "name": "Microsoft Corp.", "type": "stock", "sector": "Technology",
     "country": "US", "diaspora_relevance": "Stable tech growth for long-term savings",
     "risk": "low", "expected_return": 12.0},
    {"symbol": "GOOGL", "name": "Alphabet Inc.", "type": "stock", "sector": "Technology",
     "country": "US", "diaspora_relevance": "Digital economy exposure",
     "risk": "low", "expected_return": 11.5},
    # ETFs
    {"symbol": "VTI", "name": "Vanguard Total Market ETF", "type": "etf", "sector": "Diversified",
     "country": "US", "diaspora_relevance": "Broad US market exposure for diaspora savings",
     "risk": "low", "expected_return": 10.0},
    {"symbol": "EEM", "name": "iShares MSCI Emerging Markets ETF", "type": "etf", "sector": "Diversified",
     "country": "Global", "diaspora_relevance": "Emerging market exposure including Africa",
     "risk": "moderate", "expected_return": 9.5},
    {"symbol": "AFK", "name": "VanEck Africa ETF", "type": "etf", "sector": "Africa",
     "country": "Global", "diaspora_relevance": "Direct Africa exposure for diaspora investors",
     "risk": "moderate", "expected_return": 13.0},
    # Commodities
    {"symbol": "GOLD", "name": "Gold (Spot)", "type": "commodity", "sector": "Precious Metals",
     "country": "Global", "diaspora_relevance": "Inflation hedge — protects remittance value",
     "risk": "low", "expected_return": 7.0},
    {"symbol": "OIL", "name": "Crude Oil (WTI)", "type": "commodity", "sector": "Energy",
     "country": "Global", "diaspora_relevance": "Exposure to African oil economies",
     "risk": "high", "expected_return": 8.0},
    {"symbol": "COCOA", "name": "Cocoa Futures", "type": "commodity", "sector": "Agriculture",
     "country": "Global", "diaspora_relevance": "West Africa agricultural commodity",
     "risk": "high", "expected_return": 9.0},
    # Crypto
    {"symbol": "BTC", "name": "Bitcoin", "type": "crypto", "sector": "Crypto",
     "country": "Global", "diaspora_relevance": "Borderless store of value for remittance corridors",
     "risk": "very_high", "expected_return": 25.0},
    {"symbol": "ETH", "name": "Ethereum", "type": "crypto", "sector": "Crypto",
     "country": "Global", "diaspora_relevance": "DeFi platform for cross-border finance",
     "risk": "very_high", "expected_return": 22.0},
    {"symbol": "USDC", "name": "USD Coin (Staking)", "type": "crypto", "sector": "Stablecoin",
     "country": "Global", "diaspora_relevance": "Stable yield on USD savings — 4-6% APY",
     "risk": "low", "expected_return": 5.0},
    # Mining
    {"symbol": "VALE", "name": "Vale S.A.", "type": "mining_share", "sector": "Mining",
     "country": "BR", "diaspora_relevance": "Iron ore & nickel — African minerals play",
     "risk": "moderate", "expected_return": 13.0},
    {"symbol": "FCX", "name": "Freeport-McMoRan", "type": "mining_share", "sector": "Mining",
     "country": "US", "diaspora_relevance": "Copper mining — African infrastructure demand",
     "risk": "moderate", "expected_return": 14.0},
    {"symbol": "ANG", "name": "AngloGold Ashanti", "type": "mining_share", "sector": "Mining",
     "country": "ZA", "diaspora_relevance": "African gold miner — direct home country exposure",
     "risk": "moderate", "expected_return": 11.5},
]

RISK_ALLOCATION: dict[str, dict[str, float]] = {
    "conservative": {"stock": 20, "etf": 40, "commodity": 20, "crypto": 5, "mining_share": 10, "bond": 5},
    "moderate":     {"stock": 35, "etf": 30, "commodity": 15, "crypto": 10, "mining_share": 10, "bond": 0},
    "aggressive":   {"stock": 40, "etf": 20, "commodity": 10, "crypto": 25, "mining_share": 5, "bond": 0},
}

DIASPORA_INSIGHTS: dict[str, str] = {
    "NG": "Nigerian diaspora remit $25B/year — MTN, Dangote, and BTC are high-relevance picks.",
    "KE": "Kenyan diaspora: Safaricom (M-Pesa) and Equity Bank align with home-country growth.",
    "GH": "Ghanaian diaspora: Gold (GOLD) and Cocoa (COCOA) track home economy directly.",
    "ZA": "South African diaspora: MTN and AngloGold provide direct SA market exposure.",
    "ET": "Ethiopian diaspora: EEM and AFK provide broad African exposure.",
    "default": "Diaspora investors benefit from diversifying across African stocks, global ETFs, and stablecoins.",
}

# ─── ML Logic ─────────────────────────────────────────────────────────────────

def score_asset(
    asset: dict[str, Any],
    risk_tolerance: str,
    horizon: str,
    home_country: Optional[str],
    preferred_sectors: list[str],
    exclude_sectors: list[str],
    existing_symbols: set[str],
) -> float:
    """Score an asset 0-100 for recommendation fitness."""
    if asset["symbol"] in existing_symbols:
        return 0.0
    if asset["sector"] in exclude_sectors:
        return 0.0

    score = 50.0

    # Risk alignment
    risk_map = {"low": 0, "moderate": 1, "high": 2, "very_high": 3}
    tolerance_map = {"conservative": 0, "moderate": 1, "aggressive": 2}
    asset_risk = risk_map.get(asset["risk"], 1)
    user_risk = tolerance_map.get(risk_tolerance, 1)
    risk_diff = abs(asset_risk - user_risk)
    score -= risk_diff * 15

    # Horizon alignment
    if horizon == "long" and asset["type"] in ("stock", "etf", "mining_share"):
        score += 10
    elif horizon == "short" and asset["type"] in ("crypto", "commodity"):
        score += 5
    elif horizon == "medium":
        score += 5

    # Sector preference
    if preferred_sectors and asset["sector"] in preferred_sectors:
        score += 20
    elif preferred_sectors:
        score -= 5

    # Diaspora relevance boost
    if home_country and asset["country"] in (home_country, "Global"):
        score += 15
    elif asset["country"] == "Global":
        score += 5

    # Expected return bonus
    score += min(asset["expected_return"] / 2, 10)

    return max(0.0, min(100.0, score))


def calculate_risk_score(req: RiskScoreRequest) -> RiskScoreResponse:
    score = 50.0
    factors: list[str] = []

    # Disposable income ratio
    disposable = req.monthly_income_usd - req.monthly_expenses_usd
    income_ratio = disposable / max(req.monthly_income_usd, 1)
    if income_ratio > 0.4:
        score += 10
        factors.append("Strong disposable income ratio (>40%)")
    elif income_ratio < 0.1:
        score -= 15
        factors.append("Low disposable income ratio (<10%)")

    # Experience
    exp_map = {"beginner": -10, "intermediate": 0, "advanced": 15}
    score += exp_map.get(req.investment_experience, 0)
    factors.append(f"Investment experience: {req.investment_experience}")

    # Age factor
    if req.age:
        if req.age < 30:
            score += 15
            factors.append("Young investor — longer time horizon")
        elif req.age > 55:
            score -= 20
            factors.append("Near retirement — capital preservation priority")

    # Dependents
    if req.dependents > 2:
        score -= 10
        factors.append(f"{req.dependents} dependents — higher financial obligations")

    # Employment
    if req.employment_status == "unemployed":
        score -= 20
        factors.append("Unemployed — reduced risk capacity")
    elif req.employment_status == "self_employed":
        score -= 5
        factors.append("Self-employed — variable income")

    # Savings buffer
    emergency_months = int(req.existing_savings_usd / max(req.monthly_expenses_usd, 1))
    if emergency_months >= 6:
        score += 10
        factors.append("Adequate emergency fund (6+ months)")
    elif emergency_months < 3:
        score -= 10
        factors.append("Insufficient emergency fund (<3 months)")

    # User preference
    pref_map = {"conservative": -15, "moderate": 0, "aggressive": 15}
    score += pref_map.get(req.risk_preference, 0)

    score = max(0.0, min(100.0, score))

    if score < 30:
        label = "Conservative"
        allocation = {"stock": 15, "etf": 35, "commodity": 25, "crypto": 5, "bond": 20}
        max_pct = 5.0
    elif score < 55:
        label = "Moderate"
        allocation = {"stock": 30, "etf": 30, "commodity": 15, "crypto": 10, "bond": 15}
        max_pct = 15.0
    elif score < 75:
        label = "Aggressive"
        allocation = {"stock": 40, "etf": 25, "commodity": 10, "crypto": 20, "bond": 5}
        max_pct = 25.0
    else:
        label = "Very Aggressive"
        allocation = {"stock": 35, "etf": 15, "commodity": 10, "crypto": 35, "bond": 5}
        max_pct = 35.0

    return RiskScoreResponse(
        risk_score=round(score, 2),
        risk_label=label,
        recommended_allocation=allocation,
        max_investment_pct_income=max_pct,
        emergency_fund_months=max(3, 6 - emergency_months),
        key_factors=factors,
        scored_at=datetime.now(timezone.utc).isoformat(),
    )


def generate_sentiment(symbol: str) -> AssetSentiment:
    """Generate deterministic-ish sentiment based on symbol hash."""
    seed = sum(ord(c) for c in symbol)
    rng = random.Random(seed + 42)
    score = rng.uniform(-0.3, 0.8)
    confidence = rng.uniform(0.6, 0.95)

    bullish = [
        "Strong institutional buying",
        "Positive earnings revision",
        "Diaspora demand increasing",
        "Technical breakout pattern",
        "Analyst upgrade",
        "African market expansion",
    ]
    bearish = [
        "Currency headwinds",
        "Regulatory uncertainty",
        "Profit-taking pressure",
        "Macro slowdown risk",
    ]

    n_bull = rng.randint(1, 3) if score > 0 else rng.randint(0, 1)
    n_bear = rng.randint(0, 1) if score > 0 else rng.randint(1, 3)

    rng.shuffle(bullish)
    rng.shuffle(bearish)

    label = "Bullish" if score > 0.2 else ("Bearish" if score < -0.1 else "Neutral")
    diaspora_idx = min(100, max(0, 50 + score * 40 + rng.uniform(-10, 10)))

    return AssetSentiment(
        symbol=symbol,
        sentiment_score=round(score, 4),
        sentiment_label=label,
        confidence=round(confidence, 4),
        bullish_signals=bullish[:n_bull],
        bearish_signals=bearish[:n_bear],
        diaspora_demand_index=round(diaspora_idx, 2),
    )


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        service="python-investment-ml",
        version="1.0.0",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/recommend", response_model=RecommendResponse)
async def recommend(req: RecommendRequest):
    existing_symbols = {h.symbol for h in req.existing_holdings}
    target_alloc = RISK_ALLOCATION.get(req.risk_tolerance, RISK_ALLOCATION["moderate"])

    scored: list[tuple[float, dict[str, Any]]] = []
    for asset in ASSET_CATALOG:
        s = score_asset(
            asset,
            req.risk_tolerance,
            req.investment_horizon,
            req.home_country,
            req.preferred_sectors,
            req.exclude_sectors,
            existing_symbols,
        )
        if s > 20:
            scored.append((s, asset))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:8]

    total_score = sum(s for s, _ in top) or 1.0
    recs: list[AssetRecommendation] = []
    for score, asset in top:
        alloc_pct = (score / total_score) * 100
        target_type_pct = target_alloc.get(asset["type"], 10)
        alloc_pct = min(alloc_pct, target_type_pct * 1.5)

        recs.append(AssetRecommendation(
            symbol=asset["symbol"],
            name=asset["name"],
            asset_type=asset["type"],
            reason=asset["diaspora_relevance"],
            confidence_score=round(score / 100, 4),
            expected_return_1y=asset["expected_return"],
            risk_level=asset["risk"],
            diaspora_relevance=asset["diaspora_relevance"],
            suggested_allocation_pct=round(alloc_pct, 2),
            min_investment_usd=10.0 if asset["type"] in ("etf", "crypto") else 50.0,
        ))

    strategy_map = {
        "conservative": "Capital preservation with steady income. Focus on ETFs, bonds, and gold.",
        "moderate": "Balanced growth and income. Mix of African stocks, global ETFs, and stablecoins.",
        "aggressive": "High-growth focus. Overweight crypto, mining shares, and emerging market stocks.",
    }

    insight = DIASPORA_INSIGHTS.get(
        req.home_country or "", DIASPORA_INSIGHTS["default"]
    )

    return RecommendResponse(
        user_id=req.user_id,
        recommendations=recs,
        portfolio_strategy=strategy_map.get(req.risk_tolerance, strategy_map["moderate"]),
        diaspora_insight=insight,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/score-risk", response_model=RiskScoreResponse)
async def score_risk(req: RiskScoreRequest):
    return calculate_risk_score(req)


@app.post("/sentiment", response_model=SentimentResponse)
async def sentiment(req: SentimentRequest):
    if not req.symbols:
        raise HTTPException(status_code=400, detail="At least one symbol required")
    if len(req.symbols) > 20:
        raise HTTPException(status_code=400, detail="Max 20 symbols per request")

    sentiments = [generate_sentiment(sym) for sym in req.symbols]
    avg_score = sum(s.sentiment_score for s in sentiments) / len(sentiments)
    mood = "Bullish" if avg_score > 0.2 else ("Bearish" if avg_score < -0.1 else "Neutral")

    return SentimentResponse(
        sentiments=sentiments,
        market_mood=mood,
        analyzed_at=datetime.now(timezone.utc).isoformat(),
    )


if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.getenv("PORT", "8089"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
