"""
python-kyc-trigger-scorer — RemitFlow ML-Driven KYC Trigger Scorer

Responsibilities:
  - ML-based risk scoring for KYC trigger decisions
  - PEP/sanctions risk escalation with confidence scoring
  - Periodic re-KYC scheduler (annual, risk-based, country-change)
  - Behavioral anomaly detection for KYC re-review triggers
  - Integration with Dapr pub/sub and Temporal workflows
  - Prometheus metrics and structured logging
"""

import asyncio
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
import numpy as np
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import BackgroundTasks, FastAPI, HTTPException
from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
from pydantic import BaseModel, Field
from starlette.responses import Response

def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[src] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value


# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "python-kyc-trigger-scorer", "message": "%(message)s"}',
)
logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

class Config:
    PORT: int = int(os.getenv("PORT", "8162"))
    TRIGGER_ENGINE_URL: str = os.getenv("TRIGGER_ENGINE_URL", "http://go-kyc-trigger-engine:8160")
    DAPR_HTTP_PORT: int = int(os.getenv("DAPR_HTTP_PORT", "3500"))
    DB_URL: str = _require_env("DATABASE_URL")
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379")
    REKYC_INTERVAL_DAYS: int = int(os.getenv("REKYC_INTERVAL_DAYS", "365"))
    HIGH_RISK_REKYC_DAYS: int = int(os.getenv("HIGH_RISK_REKYC_DAYS", "90"))
    PEP_REKYC_DAYS: int = int(os.getenv("PEP_REKYC_DAYS", "180"))

config = Config()

# ── Prometheus Metrics ────────────────────────────────────────────────────────

TRIGGERS_FIRED = Counter("kyc_scorer_triggers_fired_total", "Total KYC triggers fired by scorer", ["trigger_type"])
RISK_SCORES = Histogram("kyc_scorer_risk_scores", "Distribution of computed risk scores", buckets=[10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
REKYC_SCHEDULED = Counter("kyc_scorer_rekyc_scheduled_total", "Total re-KYC events scheduled")
SCORING_DURATION = Histogram("kyc_scorer_scoring_duration_seconds", "Time to compute risk score")
USERS_DUE_REKYC = Gauge("kyc_scorer_users_due_rekyc", "Number of users currently due for re-KYC")

# ── Pydantic Models ───────────────────────────────────────────────────────────

class UserRiskProfile(BaseModel):
    user_id: str
    kyc_tier: int = 0
    country_code: str = "US"
    account_age_days: int = 0
    total_transactions: int = 0
    total_volume_usd: float = 0.0
    failed_transactions: int = 0
    countries_transacted: List[str] = []
    pep_match: bool = False
    pep_level: Optional[str] = None
    sanctions_hit: bool = False
    last_kyc_date: Optional[datetime] = None
    last_risk_score: float = 0.0
    velocity_score: float = 0.0  # 0-100 based on transaction velocity
    behavioral_anomaly_score: float = 0.0  # 0-100 from ML model

class KYCTriggerRequest(BaseModel):
    trigger_type: str
    entity_type: str = "user"
    entity_id: str
    user_id: str
    business_id: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    risk_score: Optional[float] = None
    country: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    correlation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class RiskScoreRequest(BaseModel):
    user_id: str
    profile: UserRiskProfile
    transaction_amount: Optional[float] = None
    transaction_currency: Optional[str] = None
    destination_country: Optional[str] = None

class RiskScoreResponse(BaseModel):
    user_id: str
    risk_score: float
    risk_level: str  # low, medium, high, critical
    triggers_fired: List[str]
    recommended_kyc_tier: int
    requires_edd: bool
    requires_freeze: bool
    explanation: List[str]
    computed_at: datetime

# ── Risk Scoring Engine ───────────────────────────────────────────────────────

# High-risk country codes (FATF grey/black list + conflict zones)
HIGH_RISK_COUNTRIES = {
    "AF", "BY", "CF", "CD", "CU", "ER", "ET", "GN", "GW", "HT", "IR", "IQ",
    "KP", "LB", "LY", "ML", "MM", "NI", "PK", "RU", "SO", "SS", "SD", "SY",
    "TN", "UA", "VE", "YE", "ZW", "BF", "MZ"
}

# PEP risk multipliers by level
PEP_RISK_MULTIPLIERS = {
    "tier_1": 2.5,  # Head of state, minister
    "tier_2": 2.0,  # Senior official, judge
    "tier_3": 1.5,  # Local official, military officer
    "family": 1.3,  # Family member of PEP
    "associate": 1.2,  # Close associate of PEP
}

class MLRiskScorer:
    """
    ML-based risk scorer using a gradient-boosted feature vector.
    In production: load a trained XGBoost/LightGBM model from MLflow.
    """

    def compute_risk_score(self, profile: UserRiskProfile, context: Dict[str, Any]) -> tuple[float, List[str]]:
        with SCORING_DURATION.time():
            features = self._extract_features(profile, context)
            score = self._score_features(features)
            explanations = self._explain_score(features, score)
            RISK_SCORES.observe(score)
            return score, explanations

    def _extract_features(self, profile: UserRiskProfile, context: Dict[str, Any]) -> Dict[str, float]:
        features = {}

        # Geographic risk
        features["country_risk"] = 80.0 if profile.country_code in HIGH_RISK_COUNTRIES else 10.0
        dest_country = context.get("destination_country", "")
        features["dest_country_risk"] = 80.0 if dest_country in HIGH_RISK_COUNTRIES else 10.0

        # Transaction behavior
        if profile.total_transactions > 0:
            features["failure_rate"] = (profile.failed_transactions / profile.total_transactions) * 100
        else:
            features["failure_rate"] = 0.0

        features["velocity_score"] = profile.velocity_score
        features["behavioral_anomaly"] = profile.behavioral_anomaly_score

        # Volume risk
        if profile.total_volume_usd > 1_000_000:
            features["volume_risk"] = 70.0
        elif profile.total_volume_usd > 100_000:
            features["volume_risk"] = 40.0
        elif profile.total_volume_usd > 10_000:
            features["volume_risk"] = 20.0
        else:
            features["volume_risk"] = 5.0

        # PEP risk
        if profile.pep_match:
            multiplier = PEP_RISK_MULTIPLIERS.get(profile.pep_level or "tier_3", 1.5)
            features["pep_risk"] = min(100.0, 50.0 * multiplier)
        else:
            features["pep_risk"] = 0.0

        # Sanctions
        features["sanctions_risk"] = 100.0 if profile.sanctions_hit else 0.0

        # Account age (newer accounts = higher risk)
        if profile.account_age_days < 30:
            features["account_age_risk"] = 60.0
        elif profile.account_age_days < 90:
            features["account_age_risk"] = 30.0
        elif profile.account_age_days < 365:
            features["account_age_risk"] = 15.0
        else:
            features["account_age_risk"] = 5.0

        # Multi-country exposure
        n_countries = len(profile.countries_transacted)
        features["multi_country_risk"] = min(80.0, n_countries * 8.0)

        # Transaction amount risk
        amount = context.get("transaction_amount", 0)
        if amount >= 10000:
            features["amount_risk"] = 80.0
        elif amount >= 1000:
            features["amount_risk"] = 40.0
        elif amount >= 500:
            features["amount_risk"] = 20.0
        else:
            features["amount_risk"] = 5.0

        return features

    def _score_features(self, features: Dict[str, float]) -> float:
        """Weighted ensemble scoring — in production this is a trained ML model."""
        weights = {
            "sanctions_risk": 0.30,
            "pep_risk": 0.20,
            "country_risk": 0.10,
            "dest_country_risk": 0.08,
            "behavioral_anomaly": 0.10,
            "velocity_score": 0.07,
            "amount_risk": 0.06,
            "failure_rate": 0.04,
            "volume_risk": 0.03,
            "multi_country_risk": 0.01,
            "account_age_risk": 0.01,
        }
        score = sum(features.get(k, 0) * w for k, w in weights.items())
        return min(100.0, max(0.0, score))

    def _explain_score(self, features: Dict[str, float], score: float) -> List[str]:
        explanations = []
        if features.get("sanctions_risk", 0) > 0:
            explanations.append("SANCTIONS: User matched on sanctions watchlist")
        if features.get("pep_risk", 0) > 40:
            explanations.append(f"PEP: User is a Politically Exposed Person (risk: {features['pep_risk']:.0f})")
        if features.get("country_risk", 0) > 50:
            explanations.append("GEO: User resides in high-risk jurisdiction")
        if features.get("dest_country_risk", 0) > 50:
            explanations.append("GEO: Transaction destination is high-risk jurisdiction")
        if features.get("behavioral_anomaly", 0) > 50:
            explanations.append(f"BEHAVIOR: Anomalous transaction pattern detected (score: {features['behavioral_anomaly']:.0f})")
        if features.get("velocity_score", 0) > 60:
            explanations.append(f"VELOCITY: Unusually high transaction velocity (score: {features['velocity_score']:.0f})")
        if features.get("amount_risk", 0) >= 80:
            explanations.append("AMOUNT: Transaction exceeds $10,000 CTR threshold")
        if features.get("amount_risk", 0) >= 40:
            explanations.append("AMOUNT: Transaction exceeds $1,000 Travel Rule threshold")
        if features.get("account_age_risk", 0) >= 60:
            explanations.append("ACCOUNT: New account (< 30 days) — elevated risk")
        return explanations if explanations else ["No specific risk factors identified"]

# ── Trigger Decision Engine ───────────────────────────────────────────────────

class TriggerDecisionEngine:
    def __init__(self, scorer: MLRiskScorer):
        self.scorer = scorer

    def decide_triggers(self, profile: UserRiskProfile, context: Dict[str, Any]) -> List[KYCTriggerRequest]:
        risk_score, explanations = self.scorer.compute_risk_score(profile, context)
        triggers = []

        # Sanctions freeze — immediate, highest priority
        if profile.sanctions_hit:
            triggers.append(KYCTriggerRequest(
                trigger_type="sanctions_hit",
                entity_id=profile.user_id,
                user_id=profile.user_id,
                risk_score=100.0,
                metadata={"reason": "Sanctions watchlist match", "explanations": explanations},
            ))

        # PEP match → EDD
        if profile.pep_match:
            triggers.append(KYCTriggerRequest(
                trigger_type="pep_match_detected",
                entity_id=profile.user_id,
                user_id=profile.user_id,
                risk_score=risk_score,
                metadata={"pep_level": profile.pep_level, "explanations": explanations},
            ))

        # High risk score → KYC escalation
        if risk_score >= 75 and not profile.sanctions_hit:
            triggers.append(KYCTriggerRequest(
                trigger_type="high_risk_score",
                entity_id=profile.user_id,
                user_id=profile.user_id,
                risk_score=risk_score,
                metadata={"explanations": explanations, "score_breakdown": context},
            ))

        # Transaction amount thresholds
        amount = context.get("transaction_amount", 0)
        if amount >= 10000:
            triggers.append(KYCTriggerRequest(
                trigger_type="transaction_over_10000",
                entity_id=profile.user_id,
                user_id=profile.user_id,
                amount=amount,
                currency=context.get("currency", "USD"),
                metadata={"explanations": explanations},
            ))
        elif amount >= 1000:
            triggers.append(KYCTriggerRequest(
                trigger_type="transaction_over_1000",
                entity_id=profile.user_id,
                user_id=profile.user_id,
                amount=amount,
                currency=context.get("currency", "USD"),
                metadata={"explanations": explanations},
            ))

        # Periodic re-KYC
        if profile.last_kyc_date:
            days_since_kyc = (datetime.now(timezone.utc) - profile.last_kyc_date.replace(tzinfo=timezone.utc)).days
            rekyc_threshold = (
                config.PEP_REKYC_DAYS if profile.pep_match
                else config.HIGH_RISK_REKYC_DAYS if risk_score >= 60
                else config.REKYC_INTERVAL_DAYS
            )
            if days_since_kyc >= rekyc_threshold:
                REKYC_SCHEDULED.inc()
                triggers.append(KYCTriggerRequest(
                    trigger_type="periodic_rekyc_due",
                    entity_id=profile.user_id,
                    user_id=profile.user_id,
                    risk_score=risk_score,
                    metadata={
                        "days_since_kyc": days_since_kyc,
                        "rekyc_threshold_days": rekyc_threshold,
                        "reason": "pep" if profile.pep_match else "high_risk" if risk_score >= 60 else "annual",
                    },
                ))

        return triggers

# ── FastAPI Application ───────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow KYC Trigger Scorer",
    description="ML-driven KYC/KYB trigger decision engine",
    version="1.0.0",
)

scorer = MLRiskScorer()
decision_engine = TriggerDecisionEngine(scorer)
http_client: Optional[httpx.AsyncClient] = None
scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def startup():
    global http_client
    http_client = httpx.AsyncClient(timeout=10.0)
    scheduler.start()
    # Schedule periodic re-KYC check every 6 hours
    scheduler.add_job(run_periodic_rekyc_check, "interval", hours=6, id="periodic_rekyc")
    logger.info("python-kyc-trigger-scorer started")

@app.on_event("shutdown")
async def shutdown():
    if http_client:
        await http_client.aclose()
    scheduler.shutdown()

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "python-kyc-trigger-scorer", "version": "1.0.0", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.post("/score", response_model=RiskScoreResponse)
async def score_user(request: RiskScoreRequest, background_tasks: BackgroundTasks):
    """Compute ML risk score and determine KYC triggers for a user."""
    context = {
        "transaction_amount": request.transaction_amount or 0,
        "currency": request.transaction_currency or "USD",
        "destination_country": request.destination_country or "",
    }
    risk_score, explanations = scorer.compute_risk_score(request.profile, context)
    triggers = decision_engine.decide_triggers(request.profile, context)

    # Fire triggers in background
    for trigger in triggers:
        background_tasks.add_task(fire_trigger, trigger)
        TRIGGERS_FIRED.labels(trigger_type=trigger.trigger_type).inc()

    risk_level = (
        "critical" if risk_score >= 90 else
        "high" if risk_score >= 70 else
        "medium" if risk_score >= 40 else
        "low"
    )

    recommended_tier = (
        4 if risk_score >= 90 else
        3 if risk_score >= 70 else
        2 if risk_score >= 40 else
        1
    )

    return RiskScoreResponse(
        user_id=request.user_id,
        risk_score=risk_score,
        risk_level=risk_level,
        triggers_fired=[t.trigger_type for t in triggers],
        recommended_kyc_tier=recommended_tier,
        requires_edd=risk_score >= 70 or request.profile.pep_match,
        requires_freeze=request.profile.sanctions_hit,
        explanation=explanations,
        computed_at=datetime.now(timezone.utc),
    )

@app.post("/triggers/batch")
async def fire_triggers_batch(profiles: List[UserRiskProfile], background_tasks: BackgroundTasks):
    """Batch-score multiple users and fire triggers for all of them."""
    total_triggers = 0
    for profile in profiles:
        context = {}
        triggers = decision_engine.decide_triggers(profile, context)
        for trigger in triggers:
            background_tasks.add_task(fire_trigger, trigger)
            TRIGGERS_FIRED.labels(trigger_type=trigger.trigger_type).inc()
            total_triggers += 1
    return {"profiles_scored": len(profiles), "triggers_fired": total_triggers}

@app.post("/schedule/rekyc")
async def schedule_rekyc(user_id: str, reason: str = "manual"):
    """Manually schedule a re-KYC for a specific user."""
    trigger = KYCTriggerRequest(
        trigger_type="periodic_rekyc_due",
        entity_id=user_id,
        user_id=user_id,
        metadata={"reason": reason, "scheduled_by": "manual"},
    )
    await fire_trigger(trigger)
    REKYC_SCHEDULED.inc()
    return {"status": "scheduled", "user_id": user_id, "trigger_type": "periodic_rekyc_due"}

# ── Periodic Re-KYC Scheduler ─────────────────────────────────────────────────

async def run_periodic_rekyc_check():
    """
    Runs every 6 hours. Queries the database for users whose KYC has expired
    and fires re-KYC triggers for them.
    In production: queries PostgreSQL directly via asyncpg.
    """
    logger.info("Running periodic re-KYC check")
    # Simulated expired users — in production: query DB
    # SELECT user_id, kyc_tier, last_kyc_date, risk_score
    # FROM users WHERE kyc_expires_at < NOW() AND kyc_status = 'verified'
    expired_users: List[Dict[str, Any]] = []  # Would be populated from DB

    USERS_DUE_REKYC.set(len(expired_users))

    for user in expired_users:
        trigger = KYCTriggerRequest(
            trigger_type="periodic_rekyc_due",
            entity_id=user["user_id"],
            user_id=user["user_id"],
            risk_score=user.get("risk_score"),
            metadata={"reason": "scheduled_expiry", "kyc_tier": user.get("kyc_tier")},
        )
        await fire_trigger(trigger)
        REKYC_SCHEDULED.inc()

    logger.info(f"Periodic re-KYC check complete: {len(expired_users)} users queued")

# ── Trigger Dispatcher ────────────────────────────────────────────────────────

async def fire_trigger(trigger: KYCTriggerRequest):
    """Send trigger to the Go KYC trigger engine."""
    if not http_client:
        return
    try:
        url = f"{config.TRIGGER_ENGINE_URL}/trigger"
        resp = await http_client.post(url, json=trigger.model_dump(mode="json"))
        if resp.status_code == 200:
            logger.info(f"Trigger fired: {trigger.trigger_type} for user {trigger.user_id}")
        else:
            logger.error(f"Trigger engine error: {resp.status_code} for {trigger.trigger_type}")
    except Exception as e:
        logger.error(f"Failed to fire trigger {trigger.trigger_type}: {e}")

# ── Dapr Pub/Sub Subscriber ───────────────────────────────────────────────────

@app.get("/dapr/subscribe")
async def dapr_subscribe():
    """Dapr subscription configuration."""
    return [
        {"pubsubname": "remitflow-pubsub", "topic": "risk-score-updated", "route": "/events/risk-score"},
        {"pubsubname": "remitflow-pubsub", "topic": "transaction-completed", "route": "/events/transaction"},
        {"pubsubname": "remitflow-pubsub", "topic": "kyc-status-changed", "route": "/events/kyc-status"},
    ]

@app.post("/events/risk-score")
async def handle_risk_score_event(event: Dict[str, Any], background_tasks: BackgroundTasks):
    data = event.get("data", {})
    profile = UserRiskProfile(
        user_id=data.get("user_id", ""),
        risk_score=data.get("risk_score", 0),
        last_risk_score=data.get("previous_risk_score", 0),
    )
    context = {"transaction_amount": 0}
    triggers = decision_engine.decide_triggers(profile, context)
    for trigger in triggers:
        background_tasks.add_task(fire_trigger, trigger)
    return {"status": "SUCCESS"}

@app.post("/events/transaction")
async def handle_transaction_event(event: Dict[str, Any], background_tasks: BackgroundTasks):
    data = event.get("data", {})
    profile = UserRiskProfile(user_id=data.get("user_id", ""))
    context = {
        "transaction_amount": data.get("amount", 0),
        "currency": data.get("currency", "USD"),
        "destination_country": data.get("destination_country", ""),
    }
    triggers = decision_engine.decide_triggers(profile, context)
    for trigger in triggers:
        background_tasks.add_task(fire_trigger, trigger)
    return {"status": "SUCCESS"}

# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, log_level="info")
