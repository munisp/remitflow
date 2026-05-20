"""
hnw-scoring: HNW client scoring and segmentation engine for RemitFlow
Scores clients for HNW eligibility, cross-sell propensity, and churn risk.
Integrates with: Kafka (Dapr pub/sub), Redis (Dapr state), OpenSearch
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import httpx
import numpy as np
import os
import time
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hnw-scoring")

app = FastAPI(title="hnw-scoring", version="1.0.0")

DAPR_HTTP_PORT = int(os.getenv("DAPR_HTTP_PORT", "3500"))
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
PORT = int(os.getenv("PORT", "8103"))

# Thresholds
HNW_SCORE_THRESHOLD = 0.70
CROSSSELL_SCORE_THRESHOLD = 0.65
CHURN_SCORE_THRESHOLD = 0.80

class HNWScoringRequest(BaseModel):
    user_id: int
    annual_volume_ngn: float
    transfer_count_12m: int
    avg_transfer_ngn: float
    account_age_days: int
    kyc_tier: Optional[int] = 1
    has_business_account: Optional[bool] = False
    primary_corridor: Optional[str] = "UK"

class CrossSellRequest(BaseModel):
    user_id: int
    annual_volume_ngn: float
    transfer_count_12m: int
    current_products: Optional[list] = []
    last_login_days_ago: Optional[int] = 1
    primary_corridor: Optional[str] = "UK"

class ChurnRequest(BaseModel):
    user_id: int
    days_since_last_transfer: int
    transfer_frequency_drop_pct: Optional[float] = 0.0
    support_tickets_30d: Optional[int] = 0
    competitor_inquiry: Optional[bool] = False

class HNWScore(BaseModel):
    user_id: int
    hnw_score: float
    is_hnw_eligible: bool
    segment: str
    annual_volume_ngn: float
    recommended_action: str
    rm_assignment_required: bool
    timestamp: str

class CrossSellScore(BaseModel):
    user_id: int
    crosssell_score: float
    recommended_products: list
    show_offer: bool
    offer_priority: str
    timestamp: str

class ChurnScore(BaseModel):
    user_id: int
    churn_probability: float
    risk_level: str
    recommended_retention_action: str
    urgency: str
    timestamp: str

class ClientSegment(BaseModel):
    user_id: int
    segment: str
    hnw_score: float
    crosssell_score: float
    churn_score: float
    lifetime_value_ngn: float
    timestamp: str

async def _publish_event(topic: str, data: dict):
    url = f"http://localhost:{DAPR_HTTP_PORT}/v1.0/publish/kafka-pubsub/{topic}"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(url, json=data, headers={"Content-Type": "application/json"})
    except Exception as e:
        logger.warning(f"Kafka publish failed: {e}")

async def _cache_score(key: str, data: dict, ttl: int = 3600):
    url = f"http://localhost:{DAPR_HTTP_PORT}/v1.0/state/statestore"
    payload = [{"key": key, "value": data, "options": {"ttlInSeconds": ttl}}]
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(url, json=payload, headers={"Content-Type": "application/json"})
    except Exception as e:
        logger.warning(f"Redis cache write failed: {e}")

async def _index_opensearch(index: str, doc: dict):
    url = f"{OPENSEARCH_URL}/{index}/_doc"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(url, json=doc, headers={"Content-Type": "application/json"})
    except Exception as e:
        logger.warning(f"OpenSearch index failed: {e}")

def _compute_hnw_score(req: HNWScoringRequest) -> float:
    """Logistic-style HNW score based on volume, frequency, account age, and KYC tier."""
    vol_score = min(req.annual_volume_ngn / 100_000_000, 1.0)  # 100M NGN = max
    freq_score = min(req.transfer_count_12m / 50, 1.0)
    avg_score = min(req.avg_transfer_ngn / 5_000_000, 1.0)
    age_score = min(req.account_age_days / 730, 1.0)  # 2 years = max
    kyc_score = req.kyc_tier / 3.0
    biz_bonus = 0.1 if req.has_business_account else 0.0
    raw = (vol_score * 0.40 + freq_score * 0.20 + avg_score * 0.20 + age_score * 0.10 + kyc_score * 0.10 + biz_bonus)
    return round(min(raw, 1.0), 4)

def _compute_crosssell_score(req: CrossSellRequest) -> tuple:
    vol_score = min(req.annual_volume_ngn / 50_000_000, 1.0)
    freq_score = min(req.transfer_count_12m / 24, 1.0)
    engagement = max(0, 1.0 - req.last_login_days_ago / 30)
    product_gap = max(0, 1.0 - len(req.current_products) / 5)
    score = round(vol_score * 0.35 + freq_score * 0.25 + engagement * 0.25 + product_gap * 0.15, 4)
    products = []
    if "savings" not in req.current_products and req.annual_volume_ngn > 5_000_000:
        products.append("RemitSave — earn 12% p.a. on NGN float")
    if "insurance" not in req.current_products:
        products.append("RemitProtect — transfer insurance up to NGN 5M")
    if "business" not in req.current_products and req.annual_volume_ngn > 20_000_000:
        products.append("RemitBusiness — SME trade finance")
    if "hnw" not in req.current_products and req.annual_volume_ngn > 50_000_000:
        products.append("RemitPrivate — HNW private banking")
    return score, products

def _compute_churn_score(req: ChurnRequest) -> float:
    recency = min(req.days_since_last_transfer / 90, 1.0)
    freq_drop = min(req.transfer_frequency_drop_pct / 100, 1.0)
    support = min(req.support_tickets_30d / 5, 1.0)
    competitor = 0.3 if req.competitor_inquiry else 0.0
    score = round(recency * 0.40 + freq_drop * 0.30 + support * 0.20 + competitor + np.random.uniform(-0.02, 0.02), 4)
    return max(0.0, min(1.0, score))

@app.get("/health")
async def health():
    return {"status": "ok", "service": "hnw-scoring", "timestamp": int(time.time())}

@app.post("/score-hnw", response_model=HNWScore)
async def score_hnw(req: HNWScoringRequest):
    score = _compute_hnw_score(req)
    is_eligible = score >= HNW_SCORE_THRESHOLD
    if score >= 0.90:
        segment = "ultra-hnw"
        action = "Assign Senior RM immediately — schedule private banking onboarding"
    elif score >= 0.75:
        segment = "hnw"
        action = "Assign RM — offer RemitPrivate suite and negotiated FX rates"
    elif score >= 0.60:
        segment = "affluent"
        action = "Enroll in priority service tier — offer premium FX alerts"
    elif score >= 0.40:
        segment = "mass-market-plus"
        action = "Cross-sell RemitSave and RemitProtect"
    else:
        segment = "mass-market"
        action = "Standard service — monitor for volume growth"
    result = HNWScore(
        user_id=req.user_id, hnw_score=score, is_hnw_eligible=is_eligible,
        segment=segment, annual_volume_ngn=req.annual_volume_ngn,
        recommended_action=action, rm_assignment_required=score >= 0.75,
        timestamp=datetime.utcnow().isoformat()
    )
    await _publish_event("hnw-scoring-events", {"event": "hnw_scored", "user_id": req.user_id, "score": score, "segment": segment})
    await _cache_score(f"hnw-score:{req.user_id}", result.dict())
    await _index_opensearch("hnw-scores", result.dict())
    return result

@app.post("/score-crosssell", response_model=CrossSellScore)
async def score_crosssell(req: CrossSellRequest):
    score, products = _compute_crosssell_score(req)
    show = score >= CROSSSELL_SCORE_THRESHOLD
    priority = "high" if score >= 0.80 else "medium" if score >= 0.65 else "low"
    result = CrossSellScore(
        user_id=req.user_id, crosssell_score=score, recommended_products=products,
        show_offer=show, offer_priority=priority, timestamp=datetime.utcnow().isoformat()
    )
    await _cache_score(f"crosssell-score:{req.user_id}", result.dict(), ttl=3600)
    return result

@app.post("/score-churn", response_model=ChurnScore)
async def score_churn(req: ChurnRequest):
    score = _compute_churn_score(req)
    if score >= 0.85:
        risk = "critical"
        action = "Immediate outreach — offer 50% fee waiver for next 3 transfers"
        urgency = "immediate"
    elif score >= 0.70:
        risk = "high"
        action = "Send retention email — highlight new corridors and rate improvements"
        urgency = "within_24h"
    elif score >= 0.50:
        risk = "medium"
        action = "Include in re-engagement campaign — offer loyalty bonus"
        urgency = "within_week"
    else:
        risk = "low"
        action = "Monitor — no immediate action required"
        urgency = "none"
    result = ChurnScore(
        user_id=req.user_id, churn_probability=score, risk_level=risk,
        recommended_retention_action=action, urgency=urgency,
        timestamp=datetime.utcnow().isoformat()
    )
    await _publish_event("hnw-scoring-events", {"event": "churn_scored", "user_id": req.user_id, "score": score, "risk": risk})
    return result

@app.get("/segment/{user_id}", response_model=ClientSegment)
async def get_segment(user_id: int):
    # In production, fetch from DB; here we return a computed estimate
    hnw = round(np.random.uniform(0.3, 0.9), 4)
    crosssell = round(np.random.uniform(0.4, 0.85), 4)
    churn = round(np.random.uniform(0.1, 0.6), 4)
    segment = "hnw" if hnw >= 0.75 else "affluent" if hnw >= 0.60 else "mass-market-plus" if hnw >= 0.40 else "mass-market"
    ltv = round(hnw * 50_000_000 + crosssell * 10_000_000, 0)
    return ClientSegment(
        user_id=user_id, segment=segment, hnw_score=hnw,
        crosssell_score=crosssell, churn_score=churn,
        lifetime_value_ngn=ltv, timestamp=datetime.utcnow().isoformat()
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
