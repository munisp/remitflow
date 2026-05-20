"""
Repository layer for Compliance Service
Provides database operations for all compliance entities
"""

from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc
from typing import List, Optional, Dict, Any
from datetime import datetime
from decimal import Decimal
import uuid

from models import (
    ScreeningResult as ScreeningResultModel,
    ScreeningMatch as ScreeningMatchModel,
    MonitoringRule as MonitoringRuleModel,
    TransactionAlert as TransactionAlertModel,
    ComplianceCase as ComplianceCaseModel,
    SuspiciousActivityReport as SARModel,
    UserRiskProfile as UserRiskProfileModel
)


# ============== Screening Results ==============

def create_screening_result(
    db: Session,
    result_id: str,
    entity_id: str,
    entity_type: str,
    full_name: str,
    screening_types: List[str],
    overall_risk: str,
    is_clear: bool,
    lists_checked: List[str],
    date_of_birth: Optional[str] = None,
    nationality: Optional[str] = None,
    country: Optional[str] = None,
    id_number: Optional[str] = None,
    id_type: Optional[str] = None,
    address: Optional[str] = None
) -> ScreeningResultModel:
    """Create a new screening result"""
    db_result = ScreeningResultModel(
        id=result_id,
        entity_id=entity_id,
        entity_type=entity_type,
        full_name=full_name,
        date_of_birth=date_of_birth,
        nationality=nationality,
        country=country,
        id_number=id_number,
        id_type=id_type,
        address=address,
        screening_types=screening_types,
        overall_risk=overall_risk,
        is_clear=is_clear,
        lists_checked=lists_checked
    )
    db.add(db_result)
    db.commit()
    db.refresh(db_result)
    return db_result


def get_screening_result(db: Session, result_id: str) -> Optional[ScreeningResultModel]:
    """Get a screening result by ID"""
    return db.query(ScreeningResultModel).filter(ScreeningResultModel.id == result_id).first()


def get_screening_results_by_entity(db: Session, entity_id: str, limit: int = 50) -> List[ScreeningResultModel]:
    """Get screening results for an entity"""
    return db.query(ScreeningResultModel).filter(
        ScreeningResultModel.entity_id == entity_id
    ).order_by(desc(ScreeningResultModel.screened_at)).limit(limit).all()


def create_screening_match(
    db: Session,
    match_id: str,
    screening_result_id: str,
    list_name: str,
    list_type: str,
    matched_name: str,
    match_score: float,
    match_details: Dict[str, Any]
) -> ScreeningMatchModel:
    """Create a screening match"""
    db_match = ScreeningMatchModel(
        id=match_id,
        screening_result_id=screening_result_id,
        list_name=list_name,
        list_type=list_type,
        matched_name=matched_name,
        match_score=match_score,
        match_details=match_details
    )
    db.add(db_match)
    db.commit()
    db.refresh(db_match)
    return db_match


def update_screening_match(
    db: Session,
    match_id: str,
    is_confirmed: bool,
    reviewed_by: str
) -> Optional[ScreeningMatchModel]:
    """Update a screening match review status"""
    db_match = db.query(ScreeningMatchModel).filter(ScreeningMatchModel.id == match_id).first()
    if db_match:
        db_match.is_confirmed = is_confirmed
        db_match.reviewed_by = reviewed_by
        db_match.reviewed_at = datetime.utcnow()
        db.commit()
        db.refresh(db_match)
    return db_match


# ============== Monitoring Rules ==============

def create_monitoring_rule(
    db: Session,
    rule_id: str,
    name: str,
    description: str,
    rule_type: str,
    conditions: Dict[str, Any],
    risk_score: int,
    is_active: bool = True
) -> MonitoringRuleModel:
    """Create a new monitoring rule"""
    db_rule = MonitoringRuleModel(
        id=rule_id,
        name=name,
        description=description,
        rule_type=rule_type,
        conditions=conditions,
        risk_score=risk_score,
        is_active=is_active
    )
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)
    return db_rule


def get_monitoring_rule(db: Session, rule_id: str) -> Optional[MonitoringRuleModel]:
    """Get a monitoring rule by ID"""
    return db.query(MonitoringRuleModel).filter(MonitoringRuleModel.id == rule_id).first()


def get_monitoring_rules(db: Session, active_only: bool = True) -> List[MonitoringRuleModel]:
    """Get all monitoring rules"""
    query = db.query(MonitoringRuleModel)
    if active_only:
        query = query.filter(MonitoringRuleModel.is_active.is_(True))
    return query.all()


def update_monitoring_rule(
    db: Session,
    rule_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    conditions: Optional[Dict[str, Any]] = None,
    risk_score: Optional[int] = None,
    is_active: Optional[bool] = None
) -> Optional[MonitoringRuleModel]:
    """Update a monitoring rule"""
    db_rule = db.query(MonitoringRuleModel).filter(MonitoringRuleModel.id == rule_id).first()
    if db_rule:
        if name is not None:
            db_rule.name = name
        if description is not None:
            db_rule.description = description
        if conditions is not None:
            db_rule.conditions = conditions
        if risk_score is not None:
            db_rule.risk_score = risk_score
        if is_active is not None:
            db_rule.is_active = is_active
        db.commit()
        db.refresh(db_rule)
    return db_rule


# ============== Transaction Alerts ==============

def create_transaction_alert(
    db: Session,
    alert_id: str,
    transaction_id: str,
    user_id: str,
    rule_id: str,
    rule_name: str,
    alert_type: str,
    risk_level: str,
    details: Dict[str, Any],
    status: str = "open"
) -> TransactionAlertModel:
    """Create a new transaction alert"""
    db_alert = TransactionAlertModel(
        id=alert_id,
        transaction_id=transaction_id,
        user_id=user_id,
        rule_id=rule_id,
        rule_name=rule_name,
        alert_type=alert_type,
        risk_level=risk_level,
        status=status,
        details=details
    )
    db.add(db_alert)
    db.commit()
    db.refresh(db_alert)
    return db_alert


def get_transaction_alert(db: Session, alert_id: str) -> Optional[TransactionAlertModel]:
    """Get a transaction alert by ID"""
    return db.query(TransactionAlertModel).filter(TransactionAlertModel.id == alert_id).first()


def get_transaction_alerts(
    db: Session,
    status: Optional[str] = None,
    risk_level: Optional[str] = None,
    user_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    limit: int = 50
) -> List[TransactionAlertModel]:
    """Get transaction alerts with filters"""
    query = db.query(TransactionAlertModel)
    if status:
        query = query.filter(TransactionAlertModel.status == status)
    if risk_level:
        query = query.filter(TransactionAlertModel.risk_level == risk_level)
    if user_id:
        query = query.filter(TransactionAlertModel.user_id == user_id)
    if assigned_to:
        query = query.filter(TransactionAlertModel.assigned_to == assigned_to)
    return query.order_by(desc(TransactionAlertModel.created_at)).limit(limit).all()


def update_transaction_alert(
    db: Session,
    alert_id: str,
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    resolution_notes: Optional[str] = None,
    resolved_at: Optional[datetime] = None
) -> Optional[TransactionAlertModel]:
    """Update a transaction alert"""
    db_alert = db.query(TransactionAlertModel).filter(TransactionAlertModel.id == alert_id).first()
    if db_alert:
        if status is not None:
            db_alert.status = status
        if assigned_to is not None:
            db_alert.assigned_to = assigned_to
        if resolution_notes is not None:
            db_alert.resolution_notes = resolution_notes
        if resolved_at is not None:
            db_alert.resolved_at = resolved_at
        db_alert.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_alert)
    return db_alert


# ============== Compliance Cases ==============

def create_compliance_case(
    db: Session,
    case_id: str,
    case_number: str,
    subject_id: str,
    case_type: str,
    subject_type: str = "user",
    status: str = "open",
    risk_level: str = "medium",
    assigned_to: Optional[str] = None,
    related_alerts: List[str] = None,
    related_transactions: List[str] = None,
    notes: List[Dict[str, Any]] = None,
    due_date: Optional[datetime] = None
) -> ComplianceCaseModel:
    """Create a new compliance case"""
    db_case = ComplianceCaseModel(
        id=case_id,
        case_number=case_number,
        subject_id=subject_id,
        subject_type=subject_type,
        case_type=case_type,
        status=status,
        risk_level=risk_level,
        assigned_to=assigned_to,
        related_alerts=related_alerts or [],
        related_transactions=related_transactions or [],
        notes=notes or [],
        due_date=due_date
    )
    db.add(db_case)
    db.commit()
    db.refresh(db_case)
    return db_case


def get_compliance_case(db: Session, case_id: str) -> Optional[ComplianceCaseModel]:
    """Get a compliance case by ID"""
    return db.query(ComplianceCaseModel).filter(ComplianceCaseModel.id == case_id).first()


def get_compliance_cases(
    db: Session,
    status: Optional[str] = None,
    risk_level: Optional[str] = None,
    assigned_to: Optional[str] = None,
    limit: int = 50
) -> List[ComplianceCaseModel]:
    """Get compliance cases with filters"""
    query = db.query(ComplianceCaseModel)
    if status:
        query = query.filter(ComplianceCaseModel.status == status)
    if risk_level:
        query = query.filter(ComplianceCaseModel.risk_level == risk_level)
    if assigned_to:
        query = query.filter(ComplianceCaseModel.assigned_to == assigned_to)
    return query.order_by(desc(ComplianceCaseModel.created_at)).limit(limit).all()


def update_compliance_case(
    db: Session,
    case_id: str,
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    notes: Optional[List[Dict[str, Any]]] = None,
    documents: Optional[List[Dict[str, Any]]] = None,
    closed_at: Optional[datetime] = None,
    closure_reason: Optional[str] = None
) -> Optional[ComplianceCaseModel]:
    """Update a compliance case"""
    db_case = db.query(ComplianceCaseModel).filter(ComplianceCaseModel.id == case_id).first()
    if db_case:
        if status is not None:
            db_case.status = status
        if assigned_to is not None:
            db_case.assigned_to = assigned_to
        if notes is not None:
            db_case.notes = notes
        if documents is not None:
            db_case.documents = documents
        if closed_at is not None:
            db_case.closed_at = closed_at
        if closure_reason is not None:
            db_case.closure_reason = closure_reason
        db_case.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_case)
    return db_case


# ============== Suspicious Activity Reports ==============

def create_sar(
    db: Session,
    sar_id: str,
    sar_number: str,
    case_id: str,
    subject_id: str,
    subject_name: str,
    suspicious_activity_date: datetime,
    activity_description: str,
    amount_involved: Decimal,
    prepared_by: str,
    currency: str = "NGN",
    filing_type: str = "initial",
    status: str = "draft"
) -> SARModel:
    """Create a new SAR"""
    db_sar = SARModel(
        id=sar_id,
        sar_number=sar_number,
        case_id=case_id,
        subject_id=subject_id,
        subject_name=subject_name,
        status=status,
        filing_type=filing_type,
        suspicious_activity_date=suspicious_activity_date,
        activity_description=activity_description,
        amount_involved=amount_involved,
        currency=currency,
        prepared_by=prepared_by
    )
    db.add(db_sar)
    db.commit()
    db.refresh(db_sar)
    return db_sar


def get_sar(db: Session, sar_id: str) -> Optional[SARModel]:
    """Get a SAR by ID"""
    return db.query(SARModel).filter(SARModel.id == sar_id).first()


def get_sars(
    db: Session,
    status: Optional[str] = None,
    case_id: Optional[str] = None,
    limit: int = 50
) -> List[SARModel]:
    """Get SARs with filters"""
    query = db.query(SARModel)
    if status:
        query = query.filter(SARModel.status == status)
    if case_id:
        query = query.filter(SARModel.case_id == case_id)
    return query.order_by(desc(SARModel.created_at)).limit(limit).all()


def update_sar(
    db: Session,
    sar_id: str,
    status: Optional[str] = None,
    reviewed_by: Optional[str] = None,
    approved_by: Optional[str] = None,
    filing_date: Optional[datetime] = None
) -> Optional[SARModel]:
    """Update a SAR"""
    db_sar = db.query(SARModel).filter(SARModel.id == sar_id).first()
    if db_sar:
        if status is not None:
            db_sar.status = status
        if reviewed_by is not None:
            db_sar.reviewed_by = reviewed_by
        if approved_by is not None:
            db_sar.approved_by = approved_by
        if filing_date is not None:
            db_sar.filing_date = filing_date
        db_sar.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_sar)
    return db_sar


# ============== User Risk Profiles ==============

def get_or_create_user_risk_profile(
    db: Session,
    user_id: str
) -> UserRiskProfileModel:
    """Get or create a user risk profile"""
    db_profile = db.query(UserRiskProfileModel).filter(UserRiskProfileModel.user_id == user_id).first()
    if not db_profile:
        db_profile = UserRiskProfileModel(
            id=str(uuid.uuid4()),
            user_id=user_id,
            risk_score=0,
            risk_level="low",
            risk_factors=[],
            total_transaction_count=0,
            total_transaction_volume=Decimal("0"),
            alert_count=0,
            case_count=0
        )
        db.add(db_profile)
        db.commit()
        db.refresh(db_profile)
    return db_profile


def update_user_risk_profile(
    db: Session,
    user_id: str,
    risk_score: Optional[int] = None,
    risk_level: Optional[str] = None,
    risk_factors: Optional[List[str]] = None,
    alert_count_increment: int = 0,
    case_count_increment: int = 0,
    transaction_count_increment: int = 0,
    transaction_volume_increment: Decimal = Decimal("0"),
    is_enhanced_monitoring: Optional[bool] = None
) -> Optional[UserRiskProfileModel]:
    """Update a user risk profile"""
    db_profile = db.query(UserRiskProfileModel).filter(UserRiskProfileModel.user_id == user_id).first()
    if db_profile:
        if risk_score is not None:
            db_profile.risk_score = risk_score
        if risk_level is not None:
            db_profile.risk_level = risk_level
        if risk_factors is not None:
            db_profile.risk_factors = risk_factors
        if alert_count_increment:
            db_profile.alert_count += alert_count_increment
        if case_count_increment:
            db_profile.case_count += case_count_increment
        if transaction_count_increment:
            db_profile.total_transaction_count += transaction_count_increment
        if transaction_volume_increment:
            db_profile.total_transaction_volume += transaction_volume_increment
        if is_enhanced_monitoring is not None:
            db_profile.is_enhanced_monitoring = is_enhanced_monitoring
        db_profile.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_profile)
    return db_profile


# ============== Statistics ==============

def get_compliance_stats(db: Session) -> Dict[str, Any]:
    """Get compliance statistics"""
    total_screenings = db.query(ScreeningResultModel).count()
    screenings_with_matches = db.query(ScreeningResultModel).filter(
        ScreeningResultModel.is_clear.is_(False)
    ).count()
    
    open_alerts = db.query(TransactionAlertModel).filter(
        TransactionAlertModel.status == "open"
    ).count()
    total_alerts = db.query(TransactionAlertModel).count()
    
    open_cases = db.query(ComplianceCaseModel).filter(
        ComplianceCaseModel.status.in_(["open", "in_progress", "pending_info"])
    ).count()
    total_cases = db.query(ComplianceCaseModel).count()
    
    pending_sars = db.query(SARModel).filter(
        SARModel.status.in_(["draft", "pending_review", "approved"])
    ).count()
    filed_sars = db.query(SARModel).filter(SARModel.status == "filed").count()
    
    high_risk_users = db.query(UserRiskProfileModel).filter(
        UserRiskProfileModel.risk_level.in_(["high", "critical"])
    ).count()
    enhanced_monitoring_users = db.query(UserRiskProfileModel).filter(
        UserRiskProfileModel.is_enhanced_monitoring.is_(True)
    ).count()
    
    return {
        "screenings": {
            "total": total_screenings,
            "with_matches": screenings_with_matches,
            "clear_rate": round((total_screenings - screenings_with_matches) / max(total_screenings, 1) * 100, 2)
        },
        "alerts": {
            "total": total_alerts,
            "open": open_alerts,
            "resolution_rate": round((total_alerts - open_alerts) / max(total_alerts, 1) * 100, 2)
        },
        "cases": {
            "total": total_cases,
            "open": open_cases
        },
        "sars": {
            "pending": pending_sars,
            "filed": filed_sars
        },
        "risk_profiles": {
            "high_risk_users": high_risk_users,
            "enhanced_monitoring": enhanced_monitoring_users
        }
    }


def initialize_default_rules_in_db(db: Session, default_rules: List[Dict[str, Any]]) -> int:
    """Initialize default monitoring rules in database if they don't exist"""
    count = 0
    for rule_data in default_rules:
        existing = db.query(MonitoringRuleModel).filter(
            MonitoringRuleModel.name == rule_data["name"]
        ).first()
        if not existing:
            db_rule = MonitoringRuleModel(
                id=str(uuid.uuid4()),
                name=rule_data["name"],
                description=rule_data["description"],
                rule_type=rule_data["rule_type"],
                conditions=rule_data["conditions"],
                risk_score=rule_data["risk_score"],
                is_active=True
            )
            db.add(db_rule)
            count += 1
    db.commit()
    return count
