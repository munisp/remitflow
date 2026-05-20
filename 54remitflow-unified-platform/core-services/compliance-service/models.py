"""
SQLAlchemy ORM models for Compliance Service
Replaces in-memory storage with persistent PostgreSQL storage
"""

from sqlalchemy import Column, String, DateTime, Boolean, Text, Integer, Numeric, Enum as SQLEnum, Index, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import enum

Base = declarative_base()


class RiskLevelEnum(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertStatusEnum(str, enum.Enum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    ESCALATED = "escalated"
    CLOSED_FALSE_POSITIVE = "closed_false_positive"
    CLOSED_SUSPICIOUS = "closed_suspicious"
    CLOSED_SAR_FILED = "closed_sar_filed"


class ScreeningTypeEnum(str, enum.Enum):
    SANCTIONS = "sanctions"
    PEP = "pep"
    ADVERSE_MEDIA = "adverse_media"
    WATCHLIST = "watchlist"


class CaseStatusEnum(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    PENDING_INFO = "pending_info"
    ESCALATED = "escalated"
    CLOSED = "closed"


class SARStatusEnum(str, enum.Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    FILED = "filed"
    REJECTED = "rejected"


class ScreeningResult(Base):
    """Screening results for sanctions/PEP checks"""
    __tablename__ = "screening_results"
    
    id = Column(String(36), primary_key=True)
    entity_id = Column(String(255), nullable=False, index=True)
    entity_type = Column(String(50), default="individual")
    full_name = Column(String(500), nullable=False)
    date_of_birth = Column(String(20))
    nationality = Column(String(100))
    country = Column(String(100))
    id_number = Column(String(100))
    id_type = Column(String(50))
    address = Column(Text)
    screening_types = Column(JSON, default=list)
    overall_risk = Column(String(20), default="low")
    is_clear = Column(Boolean, default=True)
    lists_checked = Column(JSON, default=list)
    screened_at = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    matches = relationship("ScreeningMatch", back_populates="screening_result", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index('ix_screening_entity_name', 'entity_id', 'full_name'),
    )


class ScreeningMatch(Base):
    """Individual matches from screening"""
    __tablename__ = "screening_matches"
    
    id = Column(String(36), primary_key=True)
    screening_result_id = Column(String(36), ForeignKey("screening_results.id"), nullable=False)
    list_name = Column(String(100), nullable=False)
    list_type = Column(String(50), nullable=False)
    matched_name = Column(String(500), nullable=False)
    match_score = Column(Numeric(5, 4), nullable=False)
    match_details = Column(JSON, default=dict)
    is_confirmed = Column(Boolean, default=False)
    reviewed_at = Column(DateTime)
    reviewed_by = Column(String(255))
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    screening_result = relationship("ScreeningResult", back_populates="matches")


class MonitoringRule(Base):
    """Transaction monitoring rules"""
    __tablename__ = "monitoring_rules"
    
    id = Column(String(36), primary_key=True)
    name = Column(String(255), nullable=False, unique=True)
    description = Column(Text)
    rule_type = Column(String(50), nullable=False)
    conditions = Column(JSON, nullable=False)
    risk_score = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_monitoring_rule_type', 'rule_type', 'is_active'),
    )


class TransactionAlert(Base):
    """Alerts generated from transaction monitoring"""
    __tablename__ = "transaction_alerts"
    
    id = Column(String(36), primary_key=True)
    transaction_id = Column(String(255), nullable=False, index=True)
    user_id = Column(String(255), nullable=False, index=True)
    rule_id = Column(String(36), ForeignKey("monitoring_rules.id"))
    rule_name = Column(String(255), nullable=False)
    alert_type = Column(String(100), nullable=False)
    risk_level = Column(String(20), nullable=False)
    status = Column(String(50), default="open")
    details = Column(JSON, default=dict)
    assigned_to = Column(String(255))
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    resolved_at = Column(DateTime)
    resolution_notes = Column(Text)
    
    __table_args__ = (
        Index('ix_alert_status_risk', 'status', 'risk_level'),
        Index('ix_alert_user_created', 'user_id', 'created_at'),
    )


class ComplianceCase(Base):
    """Compliance investigation cases"""
    __tablename__ = "compliance_cases"
    
    id = Column(String(36), primary_key=True)
    case_number = Column(String(50), unique=True, nullable=False)
    subject_id = Column(String(255), nullable=False, index=True)
    subject_type = Column(String(50), default="user")
    case_type = Column(String(100), nullable=False)
    status = Column(String(50), default="open")
    risk_level = Column(String(20), default="medium")
    assigned_to = Column(String(255))
    related_alerts = Column(JSON, default=list)
    related_transactions = Column(JSON, default=list)
    notes = Column(JSON, default=list)
    documents = Column(JSON, default=list)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    due_date = Column(DateTime)
    closed_at = Column(DateTime)
    closure_reason = Column(Text)
    
    __table_args__ = (
        Index('ix_case_status_risk', 'status', 'risk_level'),
        Index('ix_case_subject', 'subject_id', 'subject_type'),
    )


class SuspiciousActivityReport(Base):
    """Suspicious Activity Reports (SARs)"""
    __tablename__ = "suspicious_activity_reports"
    
    id = Column(String(36), primary_key=True)
    sar_number = Column(String(50), unique=True, nullable=False)
    case_id = Column(String(36), ForeignKey("compliance_cases.id"), nullable=False)
    subject_id = Column(String(255), nullable=False, index=True)
    subject_name = Column(String(500), nullable=False)
    status = Column(String(50), default="draft")
    filing_type = Column(String(50), default="initial")
    suspicious_activity_date = Column(DateTime, nullable=False)
    activity_description = Column(Text, nullable=False)
    amount_involved = Column(Numeric(20, 2), nullable=False)
    currency = Column(String(10), default="NGN")
    prepared_by = Column(String(255), nullable=False)
    reviewed_by = Column(String(255))
    approved_by = Column(String(255))
    filing_date = Column(DateTime)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_sar_status', 'status'),
        Index('ix_sar_subject', 'subject_id'),
    )


class UserRiskProfile(Base):
    """User risk profiles for ongoing monitoring"""
    __tablename__ = "user_risk_profiles"
    
    id = Column(String(36), primary_key=True)
    user_id = Column(String(255), unique=True, nullable=False)
    risk_score = Column(Integer, default=0)
    risk_level = Column(String(20), default="low")
    risk_factors = Column(JSON, default=list)
    last_screening_date = Column(DateTime)
    last_transaction_date = Column(DateTime)
    total_transaction_count = Column(Integer, default=0)
    total_transaction_volume = Column(Numeric(20, 2), default=0)
    alert_count = Column(Integer, default=0)
    case_count = Column(Integer, default=0)
    is_enhanced_monitoring = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_user_risk_level', 'risk_level'),
        Index('ix_user_enhanced_monitoring', 'is_enhanced_monitoring'),
    )
