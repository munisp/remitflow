"""
RemitFlow AML Compliance Service — Python microservice
Watchlist screening, transaction monitoring, SAR generation, CTR reporting
REST API: POST /screen, POST /monitor, POST /sar, GET /alerts, GET /health
"""
import os
import time
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from collections import defaultdict

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aml-compliance")

# ─── Models ──────────────────────────────────────────────────────────────────

class ScreeningRequest(BaseModel):
    user_id: str
    full_name: str
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    id_number: Optional[str] = None
    address: Optional[str] = None

class ScreeningResult(BaseModel):
    screening_id: str
    user_id: str
    status: str  # clear, review, blocked
    risk_level: str  # low, medium, high, critical
    matches: List[Dict[str, Any]]
    pep_match: bool
    adverse_media: bool
    risk_score: int
    notes: List[str]
    screened_at: int

class MonitoringRequest(BaseModel):
    user_id: str
    transaction_id: str
    amount_usd: float
    source_currency: str
    dest_currency: str
    source_country: str
    dest_country: str
    transaction_type: str  # remittance, bill_payment, investment
    purpose: Optional[str] = None

class MonitoringResult(BaseModel):
    alert_id: str
    user_id: str
    transaction_id: str
    triggered_rules: List[str]
    alert_level: str  # none, low, medium, high
    action_required: str
    ctr_required: bool  # Currency Transaction Report (>$10k)
    sar_recommended: bool
    monitored_at: int

class SARRequest(BaseModel):
    user_id: str
    transaction_ids: List[str]
    suspicious_activity_type: str
    description: str
    amount_usd: float
    reporter_id: str

class SARReport(BaseModel):
    sar_id: str
    user_id: str
    filing_date: str
    suspicious_activity_type: str
    amount_usd: float
    status: str  # draft, filed, acknowledged
    report_number: str
    created_at: int

class AMLAlert(BaseModel):
    alert_id: str
    user_id: str
    alert_type: str
    severity: str
    description: str
    amount_usd: float
    status: str  # open, investigating, closed, escalated
    created_at: int

# ─── In-memory stores ─────────────────────────────────────────────────────────

alerts_store: List[Dict] = []
sar_store: List[Dict] = []
user_tx_history: Dict[str, List[Dict]] = defaultdict(list)

# AML Rules
AML_RULES = [
    {
        "id": "CTR-001",
        "name": "Currency Transaction Report",
        "description": "Single transaction >= $10,000 USD",
        "threshold_usd": 10000,
        "level": "high",
    },
    {
        "id": "STR-001",
        "name": "Structuring Detection",
        "description": "Multiple transactions just below $10,000 in 24h",
        "threshold_usd": 9000,
        "count_threshold": 3,
        "window_hours": 24,
        "level": "high",
    },
    {
        "id": "VEL-001",
        "name": "Velocity Alert",
        "description": "More than 10 transactions in 24 hours",
        "count_threshold": 10,
        "window_hours": 24,
        "level": "medium",
    },
    {
        "id": "HRC-001",
        "name": "High Risk Country",
        "description": "Transaction to/from FATF high-risk jurisdiction",
        "high_risk_countries": ["IR", "KP", "SY", "CU", "VE", "MM", "SD"],
        "level": "high",
    },
    {
        "id": "RND-001",
        "name": "Round Amount",
        "description": "Suspiciously round transaction amounts >= $1,000",
        "threshold_usd": 1000,
        "level": "low",
    },
]

WATCHLIST = [
    {"name": "JOHN DOE SANCTIONED", "list": "OFAC", "risk": 100},
    {"name": "ACME SHELL CORP", "list": "UN", "risk": 95},
    {"name": "POLITICALLY EXPOSED TEST", "list": "PEP", "risk": 70},
]

HIGH_RISK_COUNTRIES = {"IR", "KP", "SY", "CU", "VE", "MM", "SD", "LY"}

# ─── Screening Logic ──────────────────────────────────────────────────────────

def normalize_name(name: str) -> str:
    return " ".join(name.upper().split())

def check_watchlist(name: str) -> List[Dict]:
    normalized = normalize_name(name)
    matches = []
    for entry in WATCHLIST:
        entry_name = normalize_name(entry["name"])
        # Simple word overlap
        a_words = set(normalized.split())
        b_words = set(entry_name.split())
        overlap = len(a_words & b_words) / max(len(a_words | b_words), 1)
        if overlap >= 0.7:
            matches.append({
                "name": entry["name"],
                "list_type": entry["list"],
                "match_score": round(overlap, 2),
                "risk_score": entry["risk"],
            })
    return matches

# ─── Monitoring Logic ─────────────────────────────────────────────────────────

def check_aml_rules(req: MonitoringRequest) -> tuple[List[str], str, bool, bool]:
    triggered = []
    ctr_required = False
    sar_recommended = False
    now = time.time()

    # Record this transaction
    user_tx_history[req.user_id].append({
        "id": req.transaction_id,
        "amount_usd": req.amount_usd,
        "timestamp": now,
        "dest_country": req.dest_country,
        "source_country": req.source_country,
    })

    # CTR check
    if req.amount_usd >= 10000:
        triggered.append("CTR-001")
        ctr_required = True

    # Structuring check (multiple txns just below $10k in 24h)
    day_ago = now - 86400
    recent_txns = [t for t in user_tx_history[req.user_id]
                   if t["timestamp"] > day_ago and t["amount_usd"] >= 9000]
    if len(recent_txns) >= 3:
        triggered.append("STR-001")
        sar_recommended = True

    # Velocity check
    all_recent = [t for t in user_tx_history[req.user_id] if t["timestamp"] > day_ago]
    if len(all_recent) > 10:
        triggered.append("VEL-001")

    # High risk country
    if req.dest_country.upper() in HIGH_RISK_COUNTRIES or req.source_country.upper() in HIGH_RISK_COUNTRIES:
        triggered.append("HRC-001")
        sar_recommended = True

    # Round amount
    if req.amount_usd >= 1000 and req.amount_usd % 1000 == 0:
        triggered.append("RND-001")

    # Determine alert level
    if "CTR-001" in triggered or "STR-001" in triggered or "HRC-001" in triggered:
        level = "high"
    elif "VEL-001" in triggered:
        level = "medium"
    elif triggered:
        level = "low"
    else:
        level = "none"

    return triggered, level, ctr_required, sar_recommended

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow AML Compliance",
    description="AML compliance automation for cross-border remittances",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Prometheus Metrics ───────────────────────────────────────────────────────

aml_screens_total = Counter("aml_screens_total", "Total AML screening requests", ["status"])
aml_sars_filed_total = Counter("aml_sars_filed_total", "Total SARs filed")
aml_ctrs_filed_total = Counter("aml_ctrs_filed_total", "Total CTRs filed")
aml_screen_duration = Histogram("aml_screen_duration_seconds", "AML screening latency")
aml_active_alerts = Gauge("aml_active_alerts", "Number of active AML alerts")

@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "aml-compliance",
        "version": "1.0.0",
        "alerts_count": len(alerts_store),
        "sar_count": len(sar_store),
        "rules_count": len(AML_RULES),
        "timestamp": int(time.time() * 1000),
    }

@app.post("/screen", response_model=ScreeningResult)
async def screen_user(req: ScreeningRequest):
    matches = check_watchlist(req.full_name)
    pep_match = any(m["list_type"] == "PEP" for m in matches)
    risk_score = max((m["risk_score"] for m in matches), default=0)

    notes = []
    if pep_match:
        notes.append("Politically Exposed Person detected — enhanced due diligence required")
    if any(m["list_type"] == "OFAC" for m in matches):
        notes.append("OFAC sanctions list match — transaction must be blocked")
    if any(m["list_type"] == "UN" for m in matches):
        notes.append("UN sanctions list match — transaction must be blocked")

    if risk_score >= 90:
        status, risk_level = "blocked", "critical"
    elif risk_score >= 60 or matches:
        status, risk_level = "review", "high"
    elif risk_score >= 30:
        status, risk_level = "review", "medium"
    else:
        status, risk_level = "clear", "low"

    return ScreeningResult(
        screening_id=f"AML-SCR-{uuid.uuid4()}",
        user_id=req.user_id,
        status=status,
        risk_level=risk_level,
        matches=matches,
        pep_match=pep_match,
        adverse_media=False,
        risk_score=risk_score,
        notes=notes,
        screened_at=int(time.time() * 1000),
    )

@app.post("/monitor", response_model=MonitoringResult)
async def monitor_transaction(req: MonitoringRequest):
    triggered, level, ctr_required, sar_recommended = check_aml_rules(req)

    action = "No action required"
    if level == "high":
        action = "Escalate to compliance officer. File CTR/SAR if applicable."
    elif level == "medium":
        action = "Flag for enhanced monitoring. Review within 24 hours."
    elif level == "low":
        action = "Log for audit trail. No immediate action required."

    alert_id = f"AML-ALERT-{uuid.uuid4()}"

    if level != "none":
        alerts_store.append({
            "alert_id": alert_id,
            "user_id": req.user_id,
            "alert_type": "transaction_monitoring",
            "severity": level,
            "description": f"Rules triggered: {', '.join(triggered)}",
            "amount_usd": req.amount_usd,
            "status": "open",
            "created_at": int(time.time() * 1000),
        })

    return MonitoringResult(
        alert_id=alert_id,
        user_id=req.user_id,
        transaction_id=req.transaction_id,
        triggered_rules=triggered,
        alert_level=level,
        action_required=action,
        ctr_required=ctr_required,
        sar_recommended=sar_recommended,
        monitored_at=int(time.time() * 1000),
    )

@app.post("/sar", response_model=SARReport)
async def file_sar(req: SARRequest):
    sar_id = f"SAR-{uuid.uuid4()}"
    report_number = f"RF-SAR-{int(time.time())}"
    report = {
        "sar_id": sar_id,
        "user_id": req.user_id,
        "filing_date": datetime.now(timezone.utc).date().isoformat(),
        "suspicious_activity_type": req.suspicious_activity_type,
        "amount_usd": req.amount_usd,
        "status": "filed",
        "report_number": report_number,
        "created_at": int(time.time() * 1000),
    }
    sar_store.append(report)
    logger.info(f"SAR filed: {sar_id} for user {req.user_id}")
    return SARReport(**report)

@app.get("/alerts")
async def get_alerts(status: Optional[str] = None, limit: int = 50):
    filtered = alerts_store
    if status:
        filtered = [a for a in filtered if a["status"] == status]
    return {
        "data": filtered[-limit:],
        "count": len(filtered),
        "timestamp": int(time.time() * 1000),
    }

@app.get("/rules")
async def get_rules():
    return {"rules": AML_RULES, "count": len(AML_RULES)}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8088"))
    logger.info(f"Starting AML Compliance Service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
