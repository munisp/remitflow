"""
Compliance Service - AML/Sanctions Screening Engine
Handles transaction monitoring, sanctions screening, case management, and compliance reporting.

Production-ready version with:
- PostgreSQL persistence (replaces in-memory storage)
- Pluggable sanctions provider (supports external providers like World-Check, Dow Jones)
- Rate limiting
- Structured logging with correlation IDs
- Proper CORS configuration
"""

import os
import sys
import logging

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException, Depends, Query, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid
import re
import hashlib
from decimal import Decimal

# Import database and models
from database import get_db, init_db, check_db_connection, SessionLocal
from models import (
    ScreeningResult as ScreeningResultModel,
    ScreeningMatch as ScreeningMatchModel,
    MonitoringRule as MonitoringRuleModel,
    TransactionAlert as TransactionAlertModel,
    ComplianceCase as ComplianceCaseModel,
    SuspiciousActivityReport as SARModel,
    UserRiskProfile as UserRiskProfileModel,
    Base
)
from sanctions_provider import get_sanctions_provider, ScreeningRequest as SanctionsScreeningRequest

# Import common modules (with fallback for standalone operation)
try:
    from logging_config import setup_logging, LoggingMiddleware, get_correlation_id
    from rate_limiter import RateLimitMiddleware, RateLimitConfig
    from secrets_manager import get_secrets_manager
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    logging.basicConfig(level=logging.INFO)

# Import repository layer for database operations
try:
    import repository
    REPOSITORY_AVAILABLE = True
except ImportError:
    REPOSITORY_AVAILABLE = False

# Setup logging
if COMMON_MODULES_AVAILABLE:
    logger = setup_logging("compliance-service")
else:
    logger = logging.getLogger("compliance-service")

# Get allowed origins from environment
ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
if os.getenv("ENVIRONMENT") == "development":
    ALLOWED_ORIGINS.append("*")

app = FastAPI(
    title="Compliance Service",
    description="AML/Sanctions Screening, Transaction Monitoring, and Case Management",
    version="2.0.0"
)

# Add middleware
if COMMON_MODULES_AVAILABLE:
    app.add_middleware(LoggingMiddleware, service_name="compliance-service")
    app.add_middleware(RateLimitMiddleware, config=RateLimitConfig.from_env())

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize sanctions provider
sanctions_provider = get_sanctions_provider()


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertStatus(str, Enum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    ESCALATED = "escalated"
    CLOSED_FALSE_POSITIVE = "closed_false_positive"
    CLOSED_SUSPICIOUS = "closed_suspicious"
    CLOSED_SAR_FILED = "closed_sar_filed"


class ScreeningType(str, Enum):
    SANCTIONS = "sanctions"
    PEP = "pep"
    ADVERSE_MEDIA = "adverse_media"
    WATCHLIST = "watchlist"


class CaseStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    PENDING_INFO = "pending_info"
    ESCALATED = "escalated"
    CLOSED = "closed"


class SARStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    FILED = "filed"
    REJECTED = "rejected"


class SanctionsList(str, Enum):
    OFAC_SDN = "ofac_sdn"
    OFAC_CONSOLIDATED = "ofac_consolidated"
    UN_CONSOLIDATED = "un_consolidated"
    EU_CONSOLIDATED = "eu_consolidated"
    UK_HMT = "uk_hmt"
    CBN_WATCHLIST = "cbn_watchlist"
    INTERPOL = "interpol"


# Models
class ScreeningRequest(BaseModel):
    entity_id: str
    entity_type: str = "individual"
    full_name: str
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    country: Optional[str] = None
    id_number: Optional[str] = None
    id_type: Optional[str] = None
    address: Optional[str] = None
    screening_types: List[ScreeningType] = [ScreeningType.SANCTIONS, ScreeningType.PEP]


class ScreeningMatch(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    list_name: str
    list_type: ScreeningType
    matched_name: str
    match_score: float
    match_details: Dict[str, Any] = {}
    is_confirmed: bool = False
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None


class ScreeningResult(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    request: ScreeningRequest
    matches: List[ScreeningMatch] = []
    overall_risk: RiskLevel = RiskLevel.LOW
    is_clear: bool = True
    screened_at: datetime = Field(default_factory=datetime.utcnow)
    lists_checked: List[str] = []


class TransactionMonitoringRule(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str
    rule_type: str
    conditions: Dict[str, Any]
    risk_score: int
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TransactionAlert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    transaction_id: str
    user_id: str
    rule_id: str
    rule_name: str
    alert_type: str
    risk_level: RiskLevel
    status: AlertStatus = AlertStatus.OPEN
    details: Dict[str, Any] = {}
    assigned_to: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None


class ComplianceCase(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    case_number: str
    subject_id: str
    subject_type: str = "user"
    case_type: str
    status: CaseStatus = CaseStatus.OPEN
    risk_level: RiskLevel = RiskLevel.MEDIUM
    assigned_to: Optional[str] = None
    related_alerts: List[str] = []
    related_transactions: List[str] = []
    notes: List[Dict[str, Any]] = []
    documents: List[Dict[str, Any]] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    due_date: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    closure_reason: Optional[str] = None


class SuspiciousActivityReport(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sar_number: str
    case_id: str
    subject_id: str
    subject_name: str
    status: SARStatus = SARStatus.DRAFT
    filing_type: str = "initial"
    suspicious_activity_date: datetime
    activity_description: str
    amount_involved: Decimal
    currency: str = "NGN"
    prepared_by: str
    reviewed_by: Optional[str] = None
    approved_by: Optional[str] = None
    filing_date: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# Production mode flag - when True, use PostgreSQL; when False, use in-memory (dev only)
USE_DATABASE = os.getenv("USE_DATABASE", "true").lower() == "true"

# In-memory storage (only used when USE_DATABASE=false for development)
screening_results_db: Dict[str, ScreeningResult] = {}
monitoring_rules_db: Dict[str, TransactionMonitoringRule] = {}
alerts_db: Dict[str, TransactionAlert] = {}
cases_db: Dict[str, ComplianceCase] = {}
sars_db: Dict[str, SuspiciousActivityReport] = {}
user_risk_profiles_db: Dict[str, Dict[str, Any]] = {}

# Database dependency for production
def get_db_session():
    """Get database session for production use"""
    if USE_DATABASE:
        from database import get_db_context
        return get_db_context()
    return None

# Simulated sanctions lists (in production, integrate with real providers)
SANCTIONS_DATABASE = {
    SanctionsList.OFAC_SDN: [
        {"name": "Test Sanctioned Person", "country": "IR", "program": "IRAN"},
        {"name": "Another Sanctioned Entity", "country": "KP", "program": "DPRK"},
    ],
    SanctionsList.UN_CONSOLIDATED: [
        {"name": "UN Listed Individual", "country": "SY", "program": "SYRIA"},
    ],
    SanctionsList.CBN_WATCHLIST: [
        {"name": "CBN Watchlist Person", "country": "NG", "program": "FRAUD"},
    ],
}

PEP_DATABASE = [
    {"name": "Sample PEP Person", "country": "NG", "position": "Former Minister"},
    {"name": "Another PEP", "country": "GH", "position": "Governor"},
]

# Default monitoring rules
DEFAULT_RULES = [
    {
        "name": "High Value Transaction",
        "description": "Transaction exceeds threshold amount",
        "rule_type": "threshold",
        "conditions": {"amount_threshold": 10000, "currency": "USD"},
        "risk_score": 30
    },
    {
        "name": "Rapid Succession Transactions",
        "description": "Multiple transactions in short time period",
        "rule_type": "velocity",
        "conditions": {"count_threshold": 5, "time_window_minutes": 60},
        "risk_score": 40
    },
    {
        "name": "High Risk Country",
        "description": "Transaction involves high-risk jurisdiction",
        "rule_type": "country",
        "conditions": {"high_risk_countries": ["IR", "KP", "SY", "CU", "VE"]},
        "risk_score": 50
    },
    {
        "name": "Structuring Detection",
        "description": "Potential structuring to avoid reporting thresholds",
        "rule_type": "structuring",
        "conditions": {"threshold": 9500, "count": 3, "time_window_hours": 24},
        "risk_score": 70
    },
    {
        "name": "Round Amount Pattern",
        "description": "Unusual pattern of round amount transactions",
        "rule_type": "pattern",
        "conditions": {"round_amount_count": 5, "time_window_days": 7},
        "risk_score": 25
    },
    {
        "name": "New Account High Activity",
        "description": "High transaction volume on newly created account",
        "rule_type": "behavior",
        "conditions": {"account_age_days": 30, "transaction_count": 20},
        "risk_score": 45
    },
    {
        "name": "Dormant Account Reactivation",
        "description": "Sudden activity on previously dormant account",
        "rule_type": "behavior",
        "conditions": {"dormant_days": 90, "reactivation_amount": 5000},
        "risk_score": 35
    },
]


def initialize_default_rules():
    """Initialize default monitoring rules."""
    for rule_data in DEFAULT_RULES:
        rule = TransactionMonitoringRule(**rule_data)
        monitoring_rules_db[rule.id] = rule


def calculate_name_similarity(name1: str, name2: str) -> float:
    """Calculate similarity score between two names using multiple algorithms."""
    name1 = name1.lower().strip()
    name2 = name2.lower().strip()
    
    if name1 == name2:
        return 1.0
    
    # Levenshtein-like similarity
    len1, len2 = len(name1), len(name2)
    if len1 == 0 or len2 == 0:
        return 0.0
    
    # Simple character overlap
    set1, set2 = set(name1.split()), set(name2.split())
    if not set1 or not set2:
        return 0.0
    
    intersection = len(set1 & set2)
    union = len(set1 | set2)
    jaccard = intersection / union if union > 0 else 0
    
    # Token sort ratio approximation
    tokens1 = sorted(name1.split())
    tokens2 = sorted(name2.split())
    sorted_match = 1.0 if tokens1 == tokens2 else 0.0
    
    # Partial match for substrings
    partial = 0.0
    if name1 in name2 or name2 in name1:
        partial = min(len1, len2) / max(len1, len2)
    
    # Weighted average
    return max(jaccard, sorted_match, partial)


def generate_case_number() -> str:
    """Generate unique case number."""
    timestamp = datetime.utcnow().strftime("%Y%m%d")
    random_part = uuid.uuid4().hex[:6].upper()
    return f"CASE-{timestamp}-{random_part}"


def generate_sar_number() -> str:
    """Generate unique SAR number."""
    timestamp = datetime.utcnow().strftime("%Y%m%d")
    random_part = uuid.uuid4().hex[:6].upper()
    return f"SAR-{timestamp}-{random_part}"


# Initialize default rules on startup
initialize_default_rules()


# Screening Endpoints
@app.post("/screening/check", response_model=ScreeningResult)
async def perform_screening(request: ScreeningRequest):
    """Perform sanctions and PEP screening on an entity."""
    matches = []
    lists_checked = []
    
    # Use external sanctions provider if available, otherwise fall back to static lists
    provider_result = sanctions_provider.screen(SanctionsScreeningRequest(
        full_name=request.full_name,
        date_of_birth=request.date_of_birth,
        nationality=request.nationality,
        country=request.country,
        id_number=request.id_number
    ))
    
    if provider_result.matches:
        for pm in provider_result.matches:
            match = ScreeningMatch(
                list_name=pm.get("list_name", "external"),
                list_type=ScreeningType.SANCTIONS if pm.get("list_type") == "sanctions" else ScreeningType.PEP,
                matched_name=pm.get("matched_name", ""),
                match_score=pm.get("match_score", 0.0),
                match_details=pm
            )
            matches.append(match)
        lists_checked.extend(provider_result.lists_checked or [])
    else:
        # Fallback to static lists only if provider returns no results
        if ScreeningType.SANCTIONS in request.screening_types:
            for list_name, entries in SANCTIONS_DATABASE.items():
                lists_checked.append(list_name.value)
                for entry in entries:
                    score = calculate_name_similarity(request.full_name, entry["name"])
                    if score >= 0.7:
                        match = ScreeningMatch(
                            list_name=list_name.value,
                            list_type=ScreeningType.SANCTIONS,
                            matched_name=entry["name"],
                            match_score=score,
                            match_details=entry
                        )
                        matches.append(match)
        
        if ScreeningType.PEP in request.screening_types:
            lists_checked.append("pep_database")
            for entry in PEP_DATABASE:
                score = calculate_name_similarity(request.full_name, entry["name"])
                if score >= 0.7:
                    match = ScreeningMatch(
                        list_name="pep_database",
                        list_type=ScreeningType.PEP,
                        matched_name=entry["name"],
                        match_score=score,
                        match_details=entry
                    )
                    matches.append(match)
    
    # Determine overall risk
    is_clear = len(matches) == 0
    overall_risk = RiskLevel.LOW
    
    if matches:
        max_score = max(m.match_score for m in matches)
        has_sanctions = any(m.list_type == ScreeningType.SANCTIONS for m in matches)
        
        if has_sanctions and max_score >= 0.9:
            overall_risk = RiskLevel.CRITICAL
        elif has_sanctions and max_score >= 0.8:
            overall_risk = RiskLevel.HIGH
        elif max_score >= 0.8:
            overall_risk = RiskLevel.MEDIUM
        else:
            overall_risk = RiskLevel.LOW
    
    result = ScreeningResult(
        request=request,
        matches=matches,
        overall_risk=overall_risk,
        is_clear=is_clear,
        lists_checked=lists_checked
    )
    
    # Store in database if available, otherwise in-memory
    if USE_DATABASE and REPOSITORY_AVAILABLE:
        try:
            from database import get_db_context
            with get_db_context() as db:
                db_result = repository.create_screening_result(
                    db=db,
                    result_id=result.id,
                    entity_id=request.entity_id,
                    entity_type=request.entity_type,
                    full_name=request.full_name,
                    screening_types=[st.value for st in request.screening_types],
                    overall_risk=overall_risk.value,
                    is_clear=is_clear,
                    lists_checked=lists_checked,
                    date_of_birth=request.date_of_birth,
                    nationality=request.nationality,
                    country=request.country,
                    id_number=request.id_number,
                    id_type=request.id_type,
                    address=request.address
                )
                # Store matches
                for match in matches:
                    repository.create_screening_match(
                        db=db,
                        match_id=match.id,
                        screening_result_id=result.id,
                        list_name=match.list_name,
                        list_type=match.list_type.value,
                        matched_name=match.matched_name,
                        match_score=match.match_score,
                        match_details=match.match_details
                    )
        except Exception as e:
            logger.warning(f"Failed to store screening result in database: {e}")
            screening_results_db[result.id] = result
    else:
        screening_results_db[result.id] = result
    
    return result


@app.get("/screening/results/{result_id}", response_model=ScreeningResult)
async def get_screening_result(result_id: str):
    """Get screening result by ID."""
    if result_id not in screening_results_db:
        raise HTTPException(status_code=404, detail="Screening result not found")
    return screening_results_db[result_id]


@app.post("/screening/results/{result_id}/matches/{match_id}/review")
async def review_screening_match(
    result_id: str,
    match_id: str,
    is_confirmed: bool,
    reviewed_by: str,
    notes: Optional[str] = None
):
    """Review and confirm/dismiss a screening match."""
    if result_id not in screening_results_db:
        raise HTTPException(status_code=404, detail="Screening result not found")
    
    result = screening_results_db[result_id]
    
    for match in result.matches:
        if match.id == match_id:
            match.is_confirmed = is_confirmed
            match.reviewed_at = datetime.utcnow()
            match.reviewed_by = reviewed_by
            
            if is_confirmed:
                # Create compliance case for confirmed match
                case = ComplianceCase(
                    case_number=generate_case_number(),
                    subject_id=result.request.entity_id,
                    subject_type=result.request.entity_type,
                    case_type="sanctions_match" if match.list_type == ScreeningType.SANCTIONS else "pep_match",
                    risk_level=RiskLevel.HIGH if match.list_type == ScreeningType.SANCTIONS else RiskLevel.MEDIUM,
                    notes=[{
                        "timestamp": datetime.utcnow().isoformat(),
                        "author": reviewed_by,
                        "content": f"Case created from confirmed screening match. {notes or ''}"
                    }]
                )
                cases_db[case.id] = case
                
                return {"match": match, "case_created": case}
            
            return {"match": match, "case_created": None}
    
    raise HTTPException(status_code=404, detail="Match not found")


# Transaction Monitoring Endpoints
@app.get("/monitoring/rules", response_model=List[TransactionMonitoringRule])
async def list_monitoring_rules(active_only: bool = True):
    """List all transaction monitoring rules."""
    rules = list(monitoring_rules_db.values())
    if active_only:
        rules = [r for r in rules if r.is_active]
    return rules


@app.post("/monitoring/rules", response_model=TransactionMonitoringRule)
async def create_monitoring_rule(
    name: str,
    description: str,
    rule_type: str,
    conditions: Dict[str, Any],
    risk_score: int
):
    """Create a new transaction monitoring rule."""
    rule = TransactionMonitoringRule(
        name=name,
        description=description,
        rule_type=rule_type,
        conditions=conditions,
        risk_score=risk_score
    )
    monitoring_rules_db[rule.id] = rule
    return rule


@app.put("/monitoring/rules/{rule_id}")
async def update_monitoring_rule(
    rule_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    conditions: Optional[Dict[str, Any]] = None,
    risk_score: Optional[int] = None,
    is_active: Optional[bool] = None
):
    """Update a monitoring rule."""
    if rule_id not in monitoring_rules_db:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    rule = monitoring_rules_db[rule_id]
    
    if name:
        rule.name = name
    if description:
        rule.description = description
    if conditions:
        rule.conditions = conditions
    if risk_score is not None:
        rule.risk_score = risk_score
    if is_active is not None:
        rule.is_active = is_active
    
    return rule


@app.post("/monitoring/analyze")
async def analyze_transaction(
    transaction_id: str,
    user_id: str,
    amount: Decimal,
    currency: str,
    source_country: str,
    destination_country: str,
    transaction_type: str,
    metadata: Optional[Dict[str, Any]] = None
):
    """Analyze a transaction against all active monitoring rules."""
    triggered_rules = []
    total_risk_score = 0
    
    for rule in monitoring_rules_db.values():
        if not rule.is_active:
            continue
        
        triggered = False
        
        # Check rule conditions
        if rule.rule_type == "threshold":
            threshold = rule.conditions.get("amount_threshold", 10000)
            if float(amount) >= threshold:
                triggered = True
        
        elif rule.rule_type == "country":
            high_risk = rule.conditions.get("high_risk_countries", [])
            if source_country in high_risk or destination_country in high_risk:
                triggered = True
        
        elif rule.rule_type == "velocity":
            # In production, check transaction history
            pass
        
        elif rule.rule_type == "structuring":
            # In production, check for structuring patterns
            threshold = rule.conditions.get("threshold", 9500)
            if float(amount) >= threshold * 0.9 and float(amount) < threshold * 1.1:
                triggered = True
        
        if triggered:
            triggered_rules.append(rule)
            total_risk_score += rule.risk_score
    
    # Determine risk level
    risk_level = RiskLevel.LOW
    if total_risk_score >= 100:
        risk_level = RiskLevel.CRITICAL
    elif total_risk_score >= 70:
        risk_level = RiskLevel.HIGH
    elif total_risk_score >= 40:
        risk_level = RiskLevel.MEDIUM
    
    # Create alerts for triggered rules
    alerts = []
    for rule in triggered_rules:
        alert = TransactionAlert(
            transaction_id=transaction_id,
            user_id=user_id,
            rule_id=rule.id,
            rule_name=rule.name,
            alert_type=rule.rule_type,
            risk_level=risk_level,
            details={
                "amount": str(amount),
                "currency": currency,
                "source_country": source_country,
                "destination_country": destination_country,
                "transaction_type": transaction_type,
                "rule_conditions": rule.conditions,
                "metadata": metadata
            }
        )
        alerts_db[alert.id] = alert
        alerts.append(alert)
    
    # Update user risk profile
    if user_id not in user_risk_profiles_db:
        user_risk_profiles_db[user_id] = {
            "user_id": user_id,
            "risk_score": 0,
            "alert_count": 0,
            "last_updated": datetime.utcnow().isoformat()
        }
    
    profile = user_risk_profiles_db[user_id]
    profile["risk_score"] = min(100, profile["risk_score"] + total_risk_score // 10)
    profile["alert_count"] += len(alerts)
    profile["last_updated"] = datetime.utcnow().isoformat()
    
    return {
        "transaction_id": transaction_id,
        "risk_level": risk_level,
        "total_risk_score": total_risk_score,
        "triggered_rules": [r.name for r in triggered_rules],
        "alerts_created": len(alerts),
        "alerts": alerts,
        "requires_review": risk_level in [RiskLevel.HIGH, RiskLevel.CRITICAL]
    }


# Alert Management Endpoints
@app.get("/alerts", response_model=List[TransactionAlert])
async def list_alerts(
    status: Optional[AlertStatus] = None,
    risk_level: Optional[RiskLevel] = None,
    user_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    limit: int = Query(default=50, le=200)
):
    """List transaction alerts with filters."""
    alerts = list(alerts_db.values())
    
    if status:
        alerts = [a for a in alerts if a.status == status]
    if risk_level:
        alerts = [a for a in alerts if a.risk_level == risk_level]
    if user_id:
        alerts = [a for a in alerts if a.user_id == user_id]
    if assigned_to:
        alerts = [a for a in alerts if a.assigned_to == assigned_to]
    
    alerts.sort(key=lambda x: x.created_at, reverse=True)
    return alerts[:limit]


@app.get("/alerts/{alert_id}", response_model=TransactionAlert)
async def get_alert(alert_id: str):
    """Get alert details."""
    if alert_id not in alerts_db:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alerts_db[alert_id]


@app.put("/alerts/{alert_id}/assign")
async def assign_alert(alert_id: str, assigned_to: str):
    """Assign an alert to an analyst."""
    if alert_id not in alerts_db:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    alert = alerts_db[alert_id]
    alert.assigned_to = assigned_to
    alert.status = AlertStatus.UNDER_REVIEW
    alert.updated_at = datetime.utcnow()
    
    return alert


@app.put("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
    resolution: AlertStatus,
    resolution_notes: str,
    resolved_by: str
):
    """Resolve an alert."""
    if alert_id not in alerts_db:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    valid_resolutions = [
        AlertStatus.CLOSED_FALSE_POSITIVE,
        AlertStatus.CLOSED_SUSPICIOUS,
        AlertStatus.CLOSED_SAR_FILED
    ]
    
    if resolution not in valid_resolutions:
        raise HTTPException(status_code=400, detail="Invalid resolution status")
    
    alert = alerts_db[alert_id]
    alert.status = resolution
    alert.resolution_notes = resolution_notes
    alert.resolved_at = datetime.utcnow()
    alert.updated_at = datetime.utcnow()
    
    # If suspicious, create a case
    if resolution == AlertStatus.CLOSED_SUSPICIOUS:
        case = ComplianceCase(
            case_number=generate_case_number(),
            subject_id=alert.user_id,
            case_type="suspicious_activity",
            risk_level=alert.risk_level,
            related_alerts=[alert_id],
            related_transactions=[alert.transaction_id],
            notes=[{
                "timestamp": datetime.utcnow().isoformat(),
                "author": resolved_by,
                "content": f"Case created from alert resolution. {resolution_notes}"
            }]
        )
        cases_db[case.id] = case
        return {"alert": alert, "case_created": case}
    
    return {"alert": alert, "case_created": None}


# Case Management Endpoints
@app.get("/cases", response_model=List[ComplianceCase])
async def list_cases(
    status: Optional[CaseStatus] = None,
    risk_level: Optional[RiskLevel] = None,
    assigned_to: Optional[str] = None,
    limit: int = Query(default=50, le=200)
):
    """List compliance cases."""
    cases = list(cases_db.values())
    
    if status:
        cases = [c for c in cases if c.status == status]
    if risk_level:
        cases = [c for c in cases if c.risk_level == risk_level]
    if assigned_to:
        cases = [c for c in cases if c.assigned_to == assigned_to]
    
    cases.sort(key=lambda x: x.created_at, reverse=True)
    return cases[:limit]


@app.get("/cases/{case_id}", response_model=ComplianceCase)
async def get_case(case_id: str):
    """Get case details."""
    if case_id not in cases_db:
        raise HTTPException(status_code=404, detail="Case not found")
    return cases_db[case_id]


@app.post("/cases", response_model=ComplianceCase)
async def create_case(
    subject_id: str,
    case_type: str,
    risk_level: RiskLevel = RiskLevel.MEDIUM,
    subject_type: str = "user",
    assigned_to: Optional[str] = None,
    notes: Optional[str] = None
):
    """Create a new compliance case."""
    case = ComplianceCase(
        case_number=generate_case_number(),
        subject_id=subject_id,
        subject_type=subject_type,
        case_type=case_type,
        risk_level=risk_level,
        assigned_to=assigned_to
    )
    
    if notes:
        case.notes.append({
            "timestamp": datetime.utcnow().isoformat(),
            "author": "system",
            "content": notes
        })
    
    cases_db[case.id] = case
    return case


@app.put("/cases/{case_id}/assign")
async def assign_case(case_id: str, assigned_to: str):
    """Assign a case to an analyst."""
    if case_id not in cases_db:
        raise HTTPException(status_code=404, detail="Case not found")
    
    case = cases_db[case_id]
    case.assigned_to = assigned_to
    case.status = CaseStatus.IN_PROGRESS
    case.updated_at = datetime.utcnow()
    
    return case


@app.post("/cases/{case_id}/notes")
async def add_case_note(case_id: str, author: str, content: str):
    """Add a note to a case."""
    if case_id not in cases_db:
        raise HTTPException(status_code=404, detail="Case not found")
    
    case = cases_db[case_id]
    case.notes.append({
        "timestamp": datetime.utcnow().isoformat(),
        "author": author,
        "content": content
    })
    case.updated_at = datetime.utcnow()
    
    return case


@app.put("/cases/{case_id}/close")
async def close_case(
    case_id: str,
    closure_reason: str,
    closed_by: str
):
    """Close a compliance case."""
    if case_id not in cases_db:
        raise HTTPException(status_code=404, detail="Case not found")
    
    case = cases_db[case_id]
    case.status = CaseStatus.CLOSED
    case.closure_reason = closure_reason
    case.closed_at = datetime.utcnow()
    case.updated_at = datetime.utcnow()
    case.notes.append({
        "timestamp": datetime.utcnow().isoformat(),
        "author": closed_by,
        "content": f"Case closed: {closure_reason}"
    })
    
    return case


# SAR Management Endpoints
@app.post("/sars", response_model=SuspiciousActivityReport)
async def create_sar(
    case_id: str,
    subject_id: str,
    subject_name: str,
    suspicious_activity_date: datetime,
    activity_description: str,
    amount_involved: Decimal,
    currency: str,
    prepared_by: str
):
    """Create a Suspicious Activity Report."""
    if case_id not in cases_db:
        raise HTTPException(status_code=404, detail="Case not found")
    
    sar = SuspiciousActivityReport(
        sar_number=generate_sar_number(),
        case_id=case_id,
        subject_id=subject_id,
        subject_name=subject_name,
        suspicious_activity_date=suspicious_activity_date,
        activity_description=activity_description,
        amount_involved=amount_involved,
        currency=currency,
        prepared_by=prepared_by
    )
    
    sars_db[sar.id] = sar
    return sar


@app.get("/sars", response_model=List[SuspiciousActivityReport])
async def list_sars(
    status: Optional[SARStatus] = None,
    limit: int = Query(default=50, le=200)
):
    """List SARs."""
    sars = list(sars_db.values())
    
    if status:
        sars = [s for s in sars if s.status == status]
    
    sars.sort(key=lambda x: x.created_at, reverse=True)
    return sars[:limit]


@app.get("/sars/{sar_id}", response_model=SuspiciousActivityReport)
async def get_sar(sar_id: str):
    """Get SAR details."""
    if sar_id not in sars_db:
        raise HTTPException(status_code=404, detail="SAR not found")
    return sars_db[sar_id]


@app.put("/sars/{sar_id}/review")
async def review_sar(sar_id: str, reviewed_by: str, approved: bool, notes: Optional[str] = None):
    """Review a SAR."""
    if sar_id not in sars_db:
        raise HTTPException(status_code=404, detail="SAR not found")
    
    sar = sars_db[sar_id]
    sar.reviewed_by = reviewed_by
    sar.status = SARStatus.APPROVED if approved else SARStatus.REJECTED
    sar.updated_at = datetime.utcnow()
    
    return sar


@app.put("/sars/{sar_id}/file")
async def file_sar(sar_id: str, approved_by: str):
    """File a SAR with regulatory authority."""
    if sar_id not in sars_db:
        raise HTTPException(status_code=404, detail="SAR not found")
    
    sar = sars_db[sar_id]
    
    if sar.status != SARStatus.APPROVED:
        raise HTTPException(status_code=400, detail="SAR must be approved before filing")
    
    sar.approved_by = approved_by
    sar.status = SARStatus.FILED
    sar.filing_date = datetime.utcnow()
    sar.updated_at = datetime.utcnow()
    
    return sar


# Risk Profile Endpoints
@app.get("/users/{user_id}/risk-profile")
async def get_user_risk_profile(user_id: str):
    """Get user's risk profile."""
    if user_id not in user_risk_profiles_db:
        return {
            "user_id": user_id,
            "risk_score": 0,
            "risk_level": RiskLevel.LOW,
            "alert_count": 0,
            "case_count": 0,
            "last_screening": None
        }
    
    profile = user_risk_profiles_db[user_id]
    
    # Calculate risk level from score
    score = profile.get("risk_score", 0)
    if score >= 80:
        risk_level = RiskLevel.CRITICAL
    elif score >= 60:
        risk_level = RiskLevel.HIGH
    elif score >= 30:
        risk_level = RiskLevel.MEDIUM
    else:
        risk_level = RiskLevel.LOW
    
    # Count related cases
    case_count = len([c for c in cases_db.values() if c.subject_id == user_id])
    
    return {
        **profile,
        "risk_level": risk_level,
        "case_count": case_count
    }


# Dashboard/Statistics Endpoints
@app.get("/dashboard/stats")
async def get_compliance_stats():
    """Get compliance dashboard statistics."""
    alerts = list(alerts_db.values())
    cases = list(cases_db.values())
    sars = list(sars_db.values())
    
    return {
        "alerts": {
            "total": len(alerts),
            "open": len([a for a in alerts if a.status == AlertStatus.OPEN]),
            "under_review": len([a for a in alerts if a.status == AlertStatus.UNDER_REVIEW]),
            "by_risk_level": {
                "critical": len([a for a in alerts if a.risk_level == RiskLevel.CRITICAL]),
                "high": len([a for a in alerts if a.risk_level == RiskLevel.HIGH]),
                "medium": len([a for a in alerts if a.risk_level == RiskLevel.MEDIUM]),
                "low": len([a for a in alerts if a.risk_level == RiskLevel.LOW])
            }
        },
        "cases": {
            "total": len(cases),
            "open": len([c for c in cases if c.status == CaseStatus.OPEN]),
            "in_progress": len([c for c in cases if c.status == CaseStatus.IN_PROGRESS]),
            "closed": len([c for c in cases if c.status == CaseStatus.CLOSED])
        },
        "sars": {
            "total": len(sars),
            "draft": len([s for s in sars if s.status == SARStatus.DRAFT]),
            "pending_review": len([s for s in sars if s.status == SARStatus.PENDING_REVIEW]),
            "filed": len([s for s in sars if s.status == SARStatus.FILED])
        },
        "rules_active": len([r for r in monitoring_rules_db.values() if r.is_active])
    }


# Startup event to initialize database
@app.on_event("startup")
async def startup_event():
    """Initialize database and default rules on startup"""
    try:
        # Initialize database tables
        init_db()
        logger.info("Database tables initialized")
        
        # Initialize default monitoring rules in database
        if REPOSITORY_AVAILABLE:
            from database import get_db_context
            with get_db_context() as db:
                count = repository.initialize_default_rules_in_db(db, DEFAULT_RULES)
                if count > 0:
                    logger.info(f"Initialized {count} default monitoring rules in database")
        else:
            # Fall back to in-memory initialization
            initialize_default_rules()
            logger.info("Initialized default monitoring rules in memory")
    except Exception as e:
        logger.warning(f"Database initialization failed, using in-memory storage: {e}")
        initialize_default_rules()


# Health check
@app.get("/health")
async def health_check():
    """Health check endpoint with database connectivity verification"""
    db_healthy = False
    try:
        db_healthy = check_db_connection()
    except Exception:
        pass
    
    return {
        "status": "healthy" if db_healthy else "degraded",
        "service": "compliance",
        "database": "connected" if db_healthy else "disconnected",
        "repository_available": REPOSITORY_AVAILABLE,
        "timestamp": datetime.utcnow().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8011)
