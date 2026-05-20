"""
RemitFlow — Python Compliance & Fraud-Score Microservice
=========================================================
Port: 8083

Responsibilities:
  1. POST /compliance/check      — AML/KYC compliance check for a transfer
  2. POST /fraud/score           — ML-style fraud risk scoring (rule-based)
  3. POST /sanctions/screen      — OFAC/UN sanctions list screening
  4. POST /velocity/check        — Velocity limit enforcement (per user/corridor)
  5. GET  /compliance/rules      — List active compliance rules
  6. GET  /health                — Health check
  7. GET  /metrics               — Prometheus metrics

All decisions are deterministic rule-based (no external ML dependency required).
In production, replace rule weights with a trained model endpoint.
"""

from __future__ import annotations

import os
import time
import hashlib
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# ── App Setup ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Compliance & Fraud Service",
    version="1.0.0",
    description="AML/KYC compliance checks, fraud scoring, and sanctions screening",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-Memory State (replace with Redis in production) ────────────────────────

_metrics: Dict[str, int] = defaultdict(int)
_velocity_store: Dict[str, List[float]] = defaultdict(list)  # key -> list of timestamps

# ── Sanctioned Entities (sample — replace with OFAC/UN feed) ─────────────────

SANCTIONED_NAMES: set = {
    "john doe terrorist", "jane doe sanctions", "acme shell corp",
    "offshore laundry ltd", "darknet transfers inc",
}

SANCTIONED_COUNTRIES: set = {
    "KP",  # North Korea
    "IR",  # Iran
    "SY",  # Syria
    "CU",  # Cuba
    "SD",  # Sudan
}

HIGH_RISK_COUNTRIES: set = {
    "AF", "MM", "LA", "KH", "PK", "NG", "SO", "YE", "LY", "VE",
}

# ── Compliance Rules ──────────────────────────────────────────────────────────

COMPLIANCE_RULES = [
    {"id": "CR001", "name": "Large Transfer Threshold", "description": "Transfers over $10,000 require enhanced due diligence", "threshold": 10000, "active": True},
    {"id": "CR002", "name": "Sanctioned Country Block", "description": "Transfers to/from sanctioned countries are blocked", "active": True},
    {"id": "CR003", "name": "High Risk Country EDD", "description": "Transfers to/from high-risk countries require EDD", "active": True},
    {"id": "CR004", "name": "Structuring Detection", "description": "Multiple transfers just below $10k threshold within 24h", "active": True},
    {"id": "CR005", "name": "Velocity Limit", "description": "Max $50,000 per user per 24 hours", "daily_limit": 50000, "active": True},
    {"id": "CR006", "name": "New Account Large Transfer", "description": "Accounts < 30 days old limited to $2,000 per transfer", "active": True},
    {"id": "CR007", "name": "Unverified KYC Block", "description": "Unverified users limited to $500 per transfer", "active": True},
    {"id": "CR008", "name": "Round Amount Detection", "description": "Round amounts (e.g. $1000, $5000) flagged for review", "active": True},
]

# ── Request/Response Models ───────────────────────────────────────────────────

class TransferComplianceRequest(BaseModel):
    transfer_id: str
    user_id: int
    amount: float = Field(gt=0)
    from_currency: str = Field(min_length=3, max_length=3)
    to_currency: str = Field(min_length=3, max_length=3)
    from_country: str = Field(min_length=2, max_length=2)
    to_country: str = Field(min_length=2, max_length=2)
    kyc_status: str = Field(default="verified")  # verified | pending | rejected
    account_age_days: int = Field(default=365, ge=0)
    daily_total_usd: float = Field(default=0.0, ge=0)
    beneficiary_name: Optional[str] = None
    sender_name: Optional[str] = None

    @field_validator("from_currency", "to_currency")
    @classmethod
    def uppercase_currency(cls, v: str) -> str:
        return v.upper()

    @field_validator("from_country", "to_country")
    @classmethod
    def uppercase_country(cls, v: str) -> str:
        return v.upper()


class ComplianceResult(BaseModel):
    transfer_id: str
    decision: str  # approved | review | blocked
    rules_triggered: List[str]
    risk_level: str  # low | medium | high | critical
    requires_edd: bool
    block_reason: Optional[str] = None
    review_reason: Optional[str] = None
    timestamp: str
    checksum: str


class FraudScoreRequest(BaseModel):
    transfer_id: str
    user_id: int
    amount: float = Field(gt=0)
    from_country: str
    to_country: str
    hour_of_day: int = Field(default=12, ge=0, le=23)
    is_new_beneficiary: bool = False
    is_new_device: bool = False
    failed_attempts_24h: int = Field(default=0, ge=0)
    kyc_status: str = Field(default="verified")
    account_age_days: int = Field(default=365, ge=0)
    ip_country: Optional[str] = None
    velocity_score: float = Field(default=0.0, ge=0.0, le=1.0)


class FraudScoreResult(BaseModel):
    transfer_id: str
    fraud_score: float  # 0.0 - 1.0
    risk_level: str  # low | medium | high | critical
    decision: str  # approve | review | block
    factors: List[Dict[str, Any]]
    timestamp: str


class SanctionsScreenRequest(BaseModel):
    name: str
    country: Optional[str] = None
    entity_type: str = Field(default="individual")  # individual | business


class SanctionsScreenResult(BaseModel):
    name: str
    is_sanctioned: bool
    match_type: Optional[str] = None  # exact | fuzzy | country
    risk_level: str
    action: str  # allow | block | review


class VelocityCheckRequest(BaseModel):
    user_id: int
    amount_usd: float = Field(gt=0)
    window_seconds: int = Field(default=86400, gt=0)
    limit_usd: float = Field(default=50000.0, gt=0)


class VelocityCheckResult(BaseModel):
    user_id: int
    allowed: bool
    current_total: float
    limit: float
    remaining: float
    window_seconds: int


# ── Helper Functions ──────────────────────────────────────────────────────────

def compute_checksum(data: str) -> str:
    """Compute a deterministic checksum for audit trail integrity."""
    return hashlib.sha256(data.encode()).hexdigest()[:16]


def is_round_amount(amount: float) -> bool:
    """Detect structuring via round amounts."""
    return amount % 1000 == 0 or amount % 500 == 0


def is_near_threshold(amount: float, threshold: float = 10000.0, margin: float = 500.0) -> bool:
    """Detect structuring — amounts just below reporting threshold."""
    return threshold - margin <= amount < threshold


def normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", name.lower().strip())


def fuzzy_sanctions_match(name: str) -> bool:
    """Simple token-overlap fuzzy match for sanctions screening."""
    normalized = normalize_name(name)
    tokens = set(normalized.split())
    for sanctioned in SANCTIONED_NAMES:
        sanctioned_tokens = set(sanctioned.split())
        overlap = tokens & sanctioned_tokens
        if len(overlap) >= 2 and len(overlap) / len(sanctioned_tokens) >= 0.6:
            return True
    return False


def get_velocity_total(user_id: int, window_seconds: int) -> float:
    """Get the sum of amounts in the velocity window (in-memory)."""
    key = str(user_id)
    now = time.time()
    cutoff = now - window_seconds
    _velocity_store[key] = [ts for ts in _velocity_store[key] if ts > cutoff]
    return float(len(_velocity_store[key]))  # count-based; replace with amount sum in production


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/compliance/check", response_model=ComplianceResult)
async def compliance_check(req: TransferComplianceRequest) -> ComplianceResult:
    """
    Run AML/KYC compliance checks on a transfer.
    Returns a decision: approved | review | blocked.
    """
    _metrics["compliance_checks_total"] += 1

    rules_triggered: List[str] = []
    block_reason: Optional[str] = None
    review_reason: Optional[str] = None
    requires_edd = False
    decision = "approved"

    # CR001 — Large Transfer
    if req.amount >= 10000:
        rules_triggered.append("CR001")
        requires_edd = True
        if decision != "blocked":
            decision = "review"
            review_reason = f"Transfer amount ${req.amount:,.2f} exceeds $10,000 threshold"

    # CR002 — Sanctioned Country
    if req.from_country in SANCTIONED_COUNTRIES or req.to_country in SANCTIONED_COUNTRIES:
        rules_triggered.append("CR002")
        decision = "blocked"
        block_reason = f"Transfer involves sanctioned country: {req.from_country if req.from_country in SANCTIONED_COUNTRIES else req.to_country}"

    # CR003 — High Risk Country EDD
    if req.from_country in HIGH_RISK_COUNTRIES or req.to_country in HIGH_RISK_COUNTRIES:
        rules_triggered.append("CR003")
        requires_edd = True
        if decision not in ("blocked",):
            decision = "review"
            review_reason = review_reason or f"Transfer involves high-risk country"

    # CR004 — Near-threshold structuring
    if is_near_threshold(req.amount):
        rules_triggered.append("CR004")
        if decision not in ("blocked",):
            decision = "review"
            review_reason = review_reason or f"Amount ${req.amount:,.2f} is near reporting threshold (possible structuring)"

    # CR005 — Daily velocity limit
    if req.daily_total_usd + req.amount > 50000:
        rules_triggered.append("CR005")
        decision = "blocked"
        block_reason = block_reason or f"Daily limit exceeded: ${req.daily_total_usd + req.amount:,.2f} > $50,000"

    # CR006 — New account large transfer
    if req.account_age_days < 30 and req.amount > 2000:
        rules_triggered.append("CR006")
        decision = "blocked"
        block_reason = block_reason or f"Account too new ({req.account_age_days} days) for transfer of ${req.amount:,.2f}"

    # CR007 — Unverified KYC
    if req.kyc_status != "verified" and req.amount > 500:
        rules_triggered.append("CR007")
        decision = "blocked"
        block_reason = block_reason or f"KYC not verified — transfer of ${req.amount:,.2f} exceeds $500 limit"

    # CR008 — Round amount
    if is_round_amount(req.amount) and req.amount >= 1000:
        rules_triggered.append("CR008")
        if decision not in ("blocked", "review"):
            decision = "review"
            review_reason = review_reason or f"Round amount ${req.amount:,.2f} flagged for review"

    # Determine risk level
    if decision == "blocked":
        risk_level = "critical"
    elif len(rules_triggered) >= 3:
        risk_level = "high"
    elif len(rules_triggered) >= 1:
        risk_level = "medium"
    else:
        risk_level = "low"

    if decision == "blocked":
        _metrics["compliance_blocks_total"] += 1
    elif decision == "review":
        _metrics["compliance_reviews_total"] += 1

    now = datetime.now(timezone.utc).isoformat()
    checksum_data = f"{req.transfer_id}:{decision}:{':'.join(rules_triggered)}:{now}"

    return ComplianceResult(
        transfer_id=req.transfer_id,
        decision=decision,
        rules_triggered=rules_triggered,
        risk_level=risk_level,
        requires_edd=requires_edd,
        block_reason=block_reason,
        review_reason=review_reason,
        timestamp=now,
        checksum=compute_checksum(checksum_data),
    )


@app.post("/fraud/score", response_model=FraudScoreResult)
async def fraud_score(req: FraudScoreRequest) -> FraudScoreResult:
    """
    Compute a fraud risk score (0.0 = no risk, 1.0 = certain fraud).
    Uses a weighted rule-based model. Replace weights with ML model in production.
    """
    _metrics["fraud_scores_total"] += 1

    score = 0.0
    factors: List[Dict[str, Any]] = []

    # Factor 1: KYC status
    if req.kyc_status == "rejected":
        score += 0.40
        factors.append({"factor": "kyc_rejected", "weight": 0.40, "description": "KYC rejected"})
    elif req.kyc_status == "pending":
        score += 0.15
        factors.append({"factor": "kyc_pending", "weight": 0.15, "description": "KYC not yet verified"})

    # Factor 2: New account
    if req.account_age_days < 7:
        score += 0.25
        factors.append({"factor": "very_new_account", "weight": 0.25, "description": "Account less than 7 days old"})
    elif req.account_age_days < 30:
        score += 0.10
        factors.append({"factor": "new_account", "weight": 0.10, "description": "Account less than 30 days old"})

    # Factor 3: New beneficiary
    if req.is_new_beneficiary:
        score += 0.10
        factors.append({"factor": "new_beneficiary", "weight": 0.10, "description": "First transfer to this beneficiary"})

    # Factor 4: New device
    if req.is_new_device:
        score += 0.10
        factors.append({"factor": "new_device", "weight": 0.10, "description": "Transfer from unrecognized device"})

    # Factor 5: Failed attempts
    if req.failed_attempts_24h >= 5:
        score += 0.20
        factors.append({"factor": "many_failed_attempts", "weight": 0.20, "description": f"{req.failed_attempts_24h} failed attempts in 24h"})
    elif req.failed_attempts_24h >= 2:
        score += 0.08
        factors.append({"factor": "some_failed_attempts", "weight": 0.08, "description": f"{req.failed_attempts_24h} failed attempts in 24h"})

    # Factor 6: Unusual hour (2am-5am local)
    if 2 <= req.hour_of_day <= 5:
        score += 0.08
        factors.append({"factor": "unusual_hour", "weight": 0.08, "description": f"Transfer at {req.hour_of_day}:00 (unusual hour)"})

    # Factor 7: High-risk destination
    if req.to_country in HIGH_RISK_COUNTRIES:
        score += 0.12
        factors.append({"factor": "high_risk_country", "weight": 0.12, "description": f"Destination {req.to_country} is high-risk"})

    # Factor 8: IP country mismatch
    if req.ip_country and req.ip_country != req.from_country:
        score += 0.10
        factors.append({"factor": "ip_country_mismatch", "weight": 0.10, "description": f"IP country {req.ip_country} != sender country {req.from_country}"})

    # Factor 9: Large amount
    if req.amount >= 50000:
        score += 0.15
        factors.append({"factor": "very_large_amount", "weight": 0.15, "description": f"Very large transfer: ${req.amount:,.2f}"})
    elif req.amount >= 10000:
        score += 0.07
        factors.append({"factor": "large_amount", "weight": 0.07, "description": f"Large transfer: ${req.amount:,.2f}"})

    # Factor 10: Velocity score passthrough
    if req.velocity_score > 0.7:
        score += 0.15
        factors.append({"factor": "high_velocity", "weight": 0.15, "description": "High transaction velocity detected"})
    elif req.velocity_score > 0.4:
        score += 0.07
        factors.append({"factor": "moderate_velocity", "weight": 0.07, "description": "Moderate transaction velocity"})

    # Clamp to [0, 1]
    score = min(1.0, round(score, 4))

    # Decision thresholds
    if score >= 0.70:
        risk_level = "critical"
        decision = "block"
        _metrics["fraud_blocks_total"] += 1
    elif score >= 0.45:
        risk_level = "high"
        decision = "review"
        _metrics["fraud_reviews_total"] += 1
    elif score >= 0.25:
        risk_level = "medium"
        decision = "review"
    else:
        risk_level = "low"
        decision = "approve"

    return FraudScoreResult(
        transfer_id=req.transfer_id,
        fraud_score=score,
        risk_level=risk_level,
        decision=decision,
        factors=factors,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/sanctions/screen", response_model=SanctionsScreenResult)
async def sanctions_screen(req: SanctionsScreenRequest) -> SanctionsScreenResult:
    """Screen a name/entity against OFAC/UN sanctions lists."""
    _metrics["sanctions_screens_total"] += 1

    normalized = normalize_name(req.name)

    # Exact match
    if normalized in SANCTIONED_NAMES:
        return SanctionsScreenResult(
            name=req.name,
            is_sanctioned=True,
            match_type="exact",
            risk_level="critical",
            action="block",
        )

    # Country-based sanction
    if req.country and req.country.upper() in SANCTIONED_COUNTRIES:
        return SanctionsScreenResult(
            name=req.name,
            is_sanctioned=True,
            match_type="country",
            risk_level="critical",
            action="block",
        )

    # Fuzzy match
    if fuzzy_sanctions_match(req.name):
        return SanctionsScreenResult(
            name=req.name,
            is_sanctioned=True,
            match_type="fuzzy",
            risk_level="high",
            action="review",
        )

    # High-risk country
    if req.country and req.country.upper() in HIGH_RISK_COUNTRIES:
        return SanctionsScreenResult(
            name=req.name,
            is_sanctioned=False,
            match_type=None,
            risk_level="medium",
            action="review",
        )

    return SanctionsScreenResult(
        name=req.name,
        is_sanctioned=False,
        match_type=None,
        risk_level="low",
        action="allow",
    )


@app.post("/velocity/check", response_model=VelocityCheckResult)
async def velocity_check(req: VelocityCheckRequest) -> VelocityCheckResult:
    """Check if a user has exceeded their velocity limit."""
    _metrics["velocity_checks_total"] += 1

    key = str(req.user_id)
    now = time.time()
    cutoff = now - req.window_seconds

    # Clean up old entries
    _velocity_store[key] = [ts for ts in _velocity_store[key] if ts > cutoff]
    current_count = len(_velocity_store[key])

    # Use count as proxy for amount (replace with actual amount tracking in production)
    # Here we treat each entry as $1 for simplicity; in production store (timestamp, amount) tuples
    current_total = current_count * (req.amount_usd / max(current_count + 1, 1))
    remaining = max(0.0, req.limit_usd - current_total - req.amount_usd)
    allowed = (current_total + req.amount_usd) <= req.limit_usd

    if allowed:
        _velocity_store[key].append(now)

    return VelocityCheckResult(
        user_id=req.user_id,
        allowed=allowed,
        current_total=round(current_total, 2),
        limit=req.limit_usd,
        remaining=round(remaining, 2),
        window_seconds=req.window_seconds,
    )


@app.get("/compliance/rules")
async def get_compliance_rules() -> Dict[str, Any]:
    """Return the list of active compliance rules."""
    return {
        "rules": COMPLIANCE_RULES,
        "total": len(COMPLIANCE_RULES),
        "active": sum(1 for r in COMPLIANCE_RULES if r.get("active")),
    }


@app.get("/health")
async def health() -> Dict[str, str]:
    return {
        "status": "ok",
        "service": "remitflow-python-compliance-service",
        "version": "1.0.0",
    }


@app.get("/metrics")
async def metrics_endpoint() -> str:
    lines = ["# HELP remitflow_compliance_checks_total Total compliance checks",
             "# TYPE remitflow_compliance_checks_total counter",
             f"remitflow_compliance_checks_total {_metrics['compliance_checks_total']}",
             "",
             "# HELP remitflow_compliance_blocks_total Total compliance blocks",
             "# TYPE remitflow_compliance_blocks_total counter",
             f"remitflow_compliance_blocks_total {_metrics['compliance_blocks_total']}",
             "",
             "# HELP remitflow_fraud_scores_total Total fraud scores computed",
             "# TYPE remitflow_fraud_scores_total counter",
             f"remitflow_fraud_scores_total {_metrics['fraud_scores_total']}",
             "",
             "# HELP remitflow_fraud_blocks_total Total fraud blocks",
             "# TYPE remitflow_fraud_blocks_total counter",
             f"remitflow_fraud_blocks_total {_metrics['fraud_blocks_total']}",
             "",
             "# HELP remitflow_sanctions_screens_total Total sanctions screens",
             "# TYPE remitflow_sanctions_screens_total counter",
             f"remitflow_sanctions_screens_total {_metrics['sanctions_screens_total']}",
             "",
             "# HELP remitflow_velocity_checks_total Total velocity checks",
             "# TYPE remitflow_velocity_checks_total counter",
             f"remitflow_velocity_checks_total {_metrics['velocity_checks_total']}",
             ]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8083))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
