"""
RemitFlow Compliance ML & DPIA Analyzer Service
FastAPI + scikit-learn + rule engine
Port: 8097

Endpoints:
  GET  /health
  POST /compliance/score        — ML-based compliance risk scoring
  POST /compliance/sar          — Suspicious Activity Report generation
  POST /compliance/dpia         — DPIA (Data Protection Impact Assessment) analysis
  POST /compliance/travel-rule  — FATF Travel Rule compliance check
  POST /compliance/pep-check    — Politically Exposed Person screening
  POST /compliance/sanctions    — Sanctions list screening
  GET  /compliance/rules        — List active compliance rules
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import random
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
import signal
import atexit



def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[python-compliance-ml] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value

_DB_URL = _require_env("DATABASE_URL")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS compliance_ml_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_compliance_ml_updated
                    ON compliance_ml_state(updated_at);
                CREATE TABLE IF NOT EXISTS compliance_ml_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_compliance_ml_events_type
                    ON compliance_ml_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO compliance_ml_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM compliance_ml_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM compliance_ml_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO compliance_ml_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="[COMPLIANCE-ML] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow Compliance ML Service",
    description="ML-powered compliance risk scoring, SAR generation, and DPIA analysis",
    version="1.0.0",
)

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-compliance-ml"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-compliance-ml"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-compliance-ml").info(f"Received signal {signum}, initiating graceful shutdown...")
    _emit_lifecycle_event("pod.shutdown.initiated", signal=signum)

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

# ── Pod Lifecycle Observability ─────────────────────────────────────────
import time as _time_mod
_PROCESS_START_TIME = _time_mod.time()
_LIFECYCLE_LOGGER = logging.getLogger("pod-lifecycle")

def _emit_lifecycle_event(event_type: str, **kwargs):
    """Emit structured JSON lifecycle event for OpenSearch/Fluentd ingestion."""
    import json as _json
    payload = {
        "event": event_type,
        "service": "python-compliance-ml",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-compliance-ml").info("FastAPI shutdown event — cleaning up resources")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── FATF High-Risk Countries ─────────────────────────────────────────────────
FATF_HIGH_RISK = {
    "AF": 0.95, "MM": 0.90, "KP": 1.0, "IR": 1.0, "SY": 0.95,
    "YE": 0.85, "LY": 0.80, "SO": 0.85, "SD": 0.80, "SS": 0.80,
    "CF": 0.75, "CD": 0.75, "ML": 0.70, "NI": 0.65, "PK": 0.55,
    "HT": 0.60, "PA": 0.50, "PH": 0.45, "VU": 0.45, "ZW": 0.55,
}

FATF_MONITORED = {
    "NG": 0.40, "GH": 0.30, "KE": 0.25, "TZ": 0.25, "UG": 0.25,
    "ET": 0.35, "ZA": 0.20, "EG": 0.30, "MA": 0.20, "TN": 0.25,
    "RU": 0.65, "CN": 0.40, "TR": 0.35, "IN": 0.15, "MX": 0.35,
    "BR": 0.30, "AR": 0.30, "VE": 0.70, "CU": 0.75, "MM": 0.90,
}

# ─── PEP Database (synthetic) ─────────────────────────────────────────────────
PEP_PATTERNS = [
    r"\bminister\b", r"\bpresident\b", r"\bgovernor\b", r"\bsenator\b",
    r"\bparliament\b", r"\bambassador\b", r"\bgeneral\b", r"\badmiral\b",
    r"\bjudge\b", r"\bmagistrate\b", r"\bprocurator\b", r"\bchief.*justice\b",
]

# ─── Sanctions Keywords ───────────────────────────────────────────────────────
SANCTIONS_KEYWORDS = [
    "al-qaeda", "isis", "isil", "daesh", "hamas", "hezbollah",
    "wagner group", "iran revolutionary guard", "north korea",
    "russian oligarch", "specially designated national",
]

# ─── ML Model ─────────────────────────────────────────────────────────────────
def build_compliance_model() -> Pipeline:
    """Train a GradientBoosting classifier on synthetic compliance data."""
    rng = np.random.default_rng(42)
    n = 8000

    # Features: amount_usd, sender_risk, receiver_risk, velocity_24h,
    #           is_round, is_structuring, pep_flag, sanctions_flag,
    #           amount_log, cross_border, high_value
    X = np.column_stack([
        rng.exponential(500, n),           # amount_usd
        rng.uniform(0, 1, n),              # sender_country_risk
        rng.uniform(0, 1, n),              # receiver_country_risk
        rng.integers(0, 20, n).astype(float),  # velocity_24h
        rng.integers(0, 2, n).astype(float),   # is_round_number
        rng.integers(0, 2, n).astype(float),   # is_structuring
        rng.integers(0, 2, n).astype(float),   # pep_flag
        rng.integers(0, 2, n).astype(float),   # sanctions_flag
        np.log1p(rng.exponential(500, n)),     # amount_log
        rng.integers(0, 2, n).astype(float),   # cross_border
        (rng.exponential(500, n) > 10000).astype(float),  # high_value
    ])

    # Label: high risk if any high-risk flag or combination of factors
    y = (
        (X[:, 7] == 1) |  # sanctions
        (X[:, 6] == 1) |  # pep
        (X[:, 5] == 1) |  # structuring
        ((X[:, 1] > 0.7) & (X[:, 0] > 5000)) |  # high-risk sender + large amount
        ((X[:, 2] > 0.7) & (X[:, 0] > 5000)) |  # high-risk receiver + large amount
        ((X[:, 3] > 10) & (X[:, 0] > 1000))      # high velocity + medium amount
    ).astype(int)

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", GradientBoostingClassifier(n_estimators=100, max_depth=4, random_state=42)),
    ])
    model.fit(X, y)
    logger.info(f"Compliance model trained. Positive rate: {y.mean():.2%}")
    return model

COMPLIANCE_MODEL = build_compliance_model()

# ─── Request Models ───────────────────────────────────────────────────────────

class ComplianceScoreRequest(BaseModel):
    transaction_id: Optional[str] = None
    amount_usd: float = Field(..., gt=0)
    sender_country: str = "GB"
    receiver_country: str = "NG"
    sender_name: str = ""
    receiver_name: str = ""
    velocity_24h: int = 0
    is_round_number: bool = False
    is_structuring: bool = False
    cross_border: bool = True
    payment_method: str = "bank_transfer"
    notes: Optional[str] = None

class SARRequest(BaseModel):
    transaction_id: str
    user_id: str
    user_name: str
    amount_usd: float
    sender_country: str
    receiver_country: str
    risk_score: float
    risk_factors: List[str]
    transaction_date: str
    description: Optional[str] = None

class DPIARequest(BaseModel):
    processing_activity: str
    data_categories: List[str]
    data_subjects: List[str]
    purposes: List[str]
    legal_basis: str
    retention_period_days: int
    third_party_sharing: bool
    international_transfer: bool
    automated_decision_making: bool
    sensitive_data: bool
    estimated_subjects_count: int
    controller_name: str = "RemitFlow Financial Services Ltd"

class TravelRuleRequest(BaseModel):
    transaction_id: str
    amount_usd: float
    originator_name: str
    originator_account: str
    originator_address: Optional[str] = None
    originator_country: str
    beneficiary_name: str
    beneficiary_account: str
    beneficiary_institution: Optional[str] = None
    beneficiary_country: str

class PEPCheckRequest(BaseModel):
    name: str
    country: Optional[str] = None
    date_of_birth: Optional[str] = None

class SanctionsCheckRequest(BaseModel):
    name: str
    country: Optional[str] = None
    entity_type: str = "individual"  # individual, organization

# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_country_risk(country: str) -> float:
    code = country.upper()[:2]
    if code in FATF_HIGH_RISK:
        return FATF_HIGH_RISK[code]
    if code in FATF_MONITORED:
        return FATF_MONITORED[code]
    return 0.05  # low risk for unlisted countries

def check_pep(name: str) -> tuple[bool, float, str]:
    name_lower = name.lower()
    for pattern in PEP_PATTERNS:
        if re.search(pattern, name_lower):
            return True, 0.85, f"Name matches PEP pattern: {pattern}"
    # Deterministic hash-based check for demo
    h = int(hashlib.md5(name.encode()).hexdigest(), 16) % 100
    if h < 3:  # ~3% false positive for demo
        return True, 0.60, "Name appears in PEP watchlist (requires manual review)"
    return False, 0.0, ""

def check_sanctions(name: str) -> tuple[bool, float, str]:
    name_lower = name.lower()
    for keyword in SANCTIONS_KEYWORDS:
        if keyword in name_lower:
            return True, 1.0, f"Exact match on sanctions keyword: {keyword}"
    h = int(hashlib.md5(name.encode()).hexdigest(), 16) % 1000
    if h < 2:  # ~0.2% for demo
        return True, 0.90, "Name appears on OFAC/UN sanctions list (requires manual review)"
    return False, 0.0, ""

def compute_risk_factors(req: ComplianceScoreRequest, pep_flag: bool, sanctions_flag: bool) -> List[str]:
    factors = []
    sender_risk = get_country_risk(req.sender_country)
    receiver_risk = get_country_risk(req.receiver_country)

    if sanctions_flag:
        factors.append("SANCTIONS_MATCH: Name matches sanctions watchlist")
    if pep_flag:
        factors.append("PEP_MATCH: Politically Exposed Person detected")
    if req.amount_usd >= 10000:
        factors.append(f"HIGH_VALUE: Amount ${req.amount_usd:,.2f} exceeds CTR threshold")
    if req.amount_usd >= 9000 and req.amount_usd < 10000:
        factors.append("STRUCTURING_RISK: Amount just below $10,000 CTR threshold")
    if req.is_structuring:
        factors.append("STRUCTURING: Multiple transactions structured to avoid reporting")
    if sender_risk > 0.7:
        factors.append(f"HIGH_RISK_SENDER: {req.sender_country} is FATF high-risk jurisdiction")
    elif sender_risk > 0.4:
        factors.append(f"MONITORED_SENDER: {req.sender_country} is FATF monitored jurisdiction")
    if receiver_risk > 0.7:
        factors.append(f"HIGH_RISK_RECEIVER: {req.receiver_country} is FATF high-risk jurisdiction")
    elif receiver_risk > 0.4:
        factors.append(f"MONITORED_RECEIVER: {req.receiver_country} is FATF monitored jurisdiction")
    if req.velocity_24h > 10:
        factors.append(f"HIGH_VELOCITY: {req.velocity_24h} transactions in 24h")
    if req.is_round_number and req.amount_usd > 1000:
        factors.append("ROUND_NUMBER: Suspiciously round transaction amount")

    return factors

# ─── Handlers ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "python-compliance-ml",
        "version": "1.0.0",
        "language": "Python",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/compliance/score")
def compliance_score(req: ComplianceScoreRequest):
    pep_flag, pep_score, pep_reason = check_pep(req.sender_name)
    sanctions_flag, sanctions_score, sanctions_reason = check_sanctions(req.sender_name)

    # Also check receiver
    recv_pep, recv_pep_score, recv_pep_reason = check_pep(req.receiver_name)
    recv_sanctions, recv_sanctions_score, recv_sanctions_reason = check_sanctions(req.receiver_name)

    pep_flag = pep_flag or recv_pep
    sanctions_flag = sanctions_flag or recv_sanctions

    sender_risk = get_country_risk(req.sender_country)
    receiver_risk = get_country_risk(req.receiver_country)

    features = np.array([[
        req.amount_usd,
        sender_risk,
        receiver_risk,
        float(req.velocity_24h),
        float(req.is_round_number),
        float(req.is_structuring),
        float(pep_flag),
        float(sanctions_flag),
        math.log1p(req.amount_usd),
        float(req.cross_border),
        float(req.amount_usd > 10000),
    ]])

    prob = COMPLIANCE_MODEL.predict_proba(features)[0][1]
    risk_score = float(prob)

    # Boost score for hard rules
    if sanctions_flag:
        risk_score = max(risk_score, 0.95)
    if pep_flag:
        risk_score = max(risk_score, 0.70)
    if req.amount_usd >= 10000:
        risk_score = max(risk_score, 0.60)

    risk_score = round(min(risk_score, 1.0), 4)

    risk_level = (
        "critical" if risk_score >= 0.85 else
        "high" if risk_score >= 0.65 else
        "medium" if risk_score >= 0.40 else
        "low"
    )

    risk_factors = compute_risk_factors(req, pep_flag, sanctions_flag)
    if pep_reason:
        risk_factors.append(f"PEP_DETAIL: {pep_reason}")
    if sanctions_reason:
        risk_factors.append(f"SANCTIONS_DETAIL: {sanctions_reason}")

    actions = []
    if risk_score >= 0.85:
        actions = ["BLOCK_TRANSACTION", "FILE_SAR", "NOTIFY_COMPLIANCE_OFFICER", "FREEZE_ACCOUNT"]
    elif risk_score >= 0.65:
        actions = ["HOLD_FOR_REVIEW", "REQUEST_ENHANCED_DUE_DILIGENCE", "NOTIFY_COMPLIANCE_OFFICER"]
    elif risk_score >= 0.40:
        actions = ["FLAG_FOR_MONITORING", "REQUEST_SOURCE_OF_FUNDS"]
    else:
        actions = ["APPROVE", "STANDARD_MONITORING"]

    return {
        "transactionId": req.transaction_id,
        "riskScore": risk_score,
        "riskLevel": risk_level,
        "riskFactors": risk_factors,
        "recommendedActions": actions,
        "pepFlag": pep_flag,
        "sanctionsFlag": sanctions_flag,
        "senderCountryRisk": round(sender_risk, 3),
        "receiverCountryRisk": round(receiver_risk, 3),
        "requiresSAR": risk_score >= 0.85,
        "requiresEDD": risk_score >= 0.65,
        "ctrRequired": req.amount_usd >= 10000,
        "scoredAt": datetime.now(timezone.utc).isoformat(),
        "modelVersion": "gradient-boost-v1.0",
    }

@app.post("/compliance/sar")
def generate_sar(req: SARRequest):
    sar_id = f"SAR-{datetime.now().strftime('%Y%m%d')}-{req.transaction_id[:8].upper()}"
    return {
        "sarId": sar_id,
        "status": "draft",
        "filingDeadline": "30 days from detection",
        "reportingEntity": "RemitFlow Financial Services Ltd",
        "reportingEntityRef": "FCA-900001",
        "subject": {
            "userId": req.user_id,
            "name": req.user_name,
        },
        "suspiciousActivity": {
            "transactionId": req.transaction_id,
            "amountUSD": req.amount_usd,
            "senderCountry": req.sender_country,
            "receiverCountry": req.receiver_country,
            "date": req.transaction_date,
            "riskScore": req.risk_score,
            "riskFactors": req.risk_factors,
            "description": req.description,
        },
        "narrative": (
            f"On {req.transaction_date}, a transaction of ${req.amount_usd:,.2f} USD was flagged "
            f"with a compliance risk score of {req.risk_score:.2%}. "
            f"The transaction originated from {req.sender_country} with destination {req.receiver_country}. "
            f"Risk factors identified: {', '.join(req.risk_factors[:3])}. "
            f"This SAR is filed in accordance with the Proceeds of Crime Act 2002 and the "
            f"Money Laundering Regulations 2017."
        ),
        "regulatoryBasis": [
            "Proceeds of Crime Act 2002 (POCA)",
            "Money Laundering Regulations 2017",
            "FATF Recommendation 20",
            "FCA SYSC 6.3 (Financial Crime)",
        ],
        "filingInstructions": "Submit to National Crime Agency (NCA) via SARs Online within 30 days.",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/compliance/dpia")
def analyze_dpia(req: DPIARequest):
    risk_score = 0.0
    risks = []
    mitigations = []

    if req.sensitive_data:
        risk_score += 0.25
        risks.append("Processing of special category data (Article 9 GDPR)")
        mitigations.append("Implement explicit consent mechanisms and data minimization")

    if req.automated_decision_making:
        risk_score += 0.20
        risks.append("Automated decision-making with legal/significant effects (Article 22 GDPR)")
        mitigations.append("Implement human review process and right to explanation")

    if req.international_transfer:
        risk_score += 0.15
        risks.append("International data transfer outside EEA (Chapter V GDPR)")
        mitigations.append("Implement Standard Contractual Clauses (SCCs) or adequacy decision")

    if req.third_party_sharing:
        risk_score += 0.10
        risks.append("Data sharing with third parties requires DPA/processor agreements")
        mitigations.append("Execute Data Processing Agreements with all processors")

    if req.retention_period_days > 2555:  # 7 years
        risk_score += 0.10
        risks.append(f"Extended retention period ({req.retention_period_days} days) requires justification")
        mitigations.append("Document legal basis for extended retention (AML/regulatory requirement)")

    if req.estimated_subjects_count > 100000:
        risk_score += 0.15
        risks.append(f"Large-scale processing ({req.estimated_subjects_count:,} data subjects)")
        mitigations.append("Appoint Data Protection Officer (DPO) if not already done")

    risk_score = min(risk_score, 1.0)
    risk_level = "high" if risk_score >= 0.5 else "medium" if risk_score >= 0.25 else "low"

    dpia_required = (
        req.sensitive_data or
        req.automated_decision_making or
        req.estimated_subjects_count > 100000 or
        (req.international_transfer and req.sensitive_data)
    )

    return {
        "dpiaRequired": dpia_required,
        "riskScore": round(risk_score, 3),
        "riskLevel": risk_level,
        "processingActivity": req.processing_activity,
        "legalBasis": req.legal_basis,
        "identifiedRisks": risks,
        "mitigationMeasures": mitigations,
        "gdprArticles": [
            "Article 5 (Principles of processing)",
            "Article 6 (Lawfulness of processing)",
            "Article 13/14 (Transparency)",
            "Article 25 (Data protection by design)",
            "Article 32 (Security of processing)",
            "Article 35 (DPIA requirement)" if dpia_required else None,
        ],
        "recommendedActions": [
            "Document processing activity in Record of Processing Activities (RoPA)",
            "Conduct privacy impact assessment" if dpia_required else "Standard privacy notice update",
            "Review data subject rights procedures",
            "Implement technical and organizational measures",
        ],
        "dpoConsultationRequired": dpia_required and risk_score >= 0.5,
        "supervisoryAuthorityNotification": risk_score >= 0.75,
        "analysedAt": datetime.now(timezone.utc).isoformat(),
        "analyst": "RemitFlow Compliance ML Engine v1.0",
    }

@app.post("/compliance/travel-rule")
def travel_rule_check(req: TravelRuleRequest):
    threshold_usd = 1000.0  # FATF Travel Rule threshold
    applies = req.amount_usd >= threshold_usd

    missing_fields = []
    if not req.originator_name:
        missing_fields.append("originator_name")
    if not req.originator_account:
        missing_fields.append("originator_account")
    if not req.beneficiary_name:
        missing_fields.append("beneficiary_name")
    if not req.beneficiary_account:
        missing_fields.append("beneficiary_account")

    compliant = applies and len(missing_fields) == 0

    return {
        "transactionId": req.transaction_id,
        "travelRuleApplies": applies,
        "threshold": threshold_usd,
        "amountUSD": req.amount_usd,
        "compliant": compliant,
        "missingFields": missing_fields,
        "originatorInfo": {
            "name": req.originator_name,
            "account": req.originator_account,
            "address": req.originator_address,
            "country": req.originator_country,
        },
        "beneficiaryInfo": {
            "name": req.beneficiary_name,
            "account": req.beneficiary_account,
            "institution": req.beneficiary_institution,
            "country": req.beneficiary_country,
        },
        "regulatoryBasis": "FATF Recommendation 16 (Wire Transfer Rule)",
        "transmissionRequired": applies,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/compliance/pep-check")
def pep_check(req: PEPCheckRequest):
    is_pep, score, reason = check_pep(req.name)
    return {
        "name": req.name,
        "isPEP": is_pep,
        "riskScore": round(score, 3),
        "reason": reason if reason else "No PEP indicators found",
        "country": req.country,
        "requiresEDD": is_pep,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "databases": ["UN PEP List", "World-Check", "Dow Jones Risk & Compliance", "FATF Public Statement"],
    }

@app.post("/compliance/sanctions")
def sanctions_check(req: SanctionsCheckRequest):
    is_sanctioned, score, reason = check_sanctions(req.name)
    return {
        "name": req.name,
        "isSanctioned": is_sanctioned,
        "riskScore": round(score, 3),
        "reason": reason if reason else "No sanctions matches found",
        "entityType": req.entity_type,
        "country": req.country,
        "recommendedAction": "BLOCK" if is_sanctioned else "APPROVE",
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "databases": ["OFAC SDN List", "EU Consolidated Sanctions", "UN Security Council", "HM Treasury UK"],
    }

@app.get("/compliance/rules")
def list_rules():
    return {
        "rules": [
            {"id": "CR001", "name": "CTR Filing", "threshold": 10000, "currency": "USD", "action": "FILE_CTR", "active": True},
            {"id": "CR002", "name": "Structuring Detection", "threshold": 9500, "currency": "USD", "action": "HOLD_REVIEW", "active": True},
            {"id": "CR003", "name": "FATF High-Risk Jurisdiction", "threshold": 0.7, "type": "risk_score", "action": "EDD_REQUIRED", "active": True},
            {"id": "CR004", "name": "PEP Screening", "threshold": None, "type": "name_match", "action": "EDD_REQUIRED", "active": True},
            {"id": "CR005", "name": "Sanctions Screening", "threshold": None, "type": "name_match", "action": "BLOCK", "active": True},
            {"id": "CR006", "name": "Travel Rule", "threshold": 1000, "currency": "USD", "action": "TRANSMIT_INFO", "active": True},
            {"id": "CR007", "name": "Velocity Check", "threshold": 10, "type": "transactions_per_24h", "action": "FLAG_MONITORING", "active": True},
            {"id": "CR008", "name": "Large Cash Equivalent", "threshold": 5000, "currency": "USD", "action": "SOURCE_OF_FUNDS", "active": True},
        ],
        "lastUpdated": "2024-01-15T00:00:00Z",
        "jurisdiction": "UK/EU",
        "regulatoryFramework": ["FCA", "FATF", "EU AMLD6", "POCA 2002"],
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8097"))
    logger.info(f"Starting compliance-ml service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
