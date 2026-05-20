"""
KYC Service Database Models
SQLAlchemy ORM models for PostgreSQL persistence
"""

from sqlalchemy import (
    Column, String, Boolean, Integer, DateTime, Text, Enum as SQLEnum,
    ForeignKey, JSON, Numeric, Date, Index
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from database import Base


# Enums
class KYCTierEnum(str, enum.Enum):
    TIER_0 = "tier_0"
    TIER_1 = "tier_1"
    TIER_2 = "tier_2"
    TIER_3 = "tier_3"
    TIER_4 = "tier_4"


class VerificationStatusEnum(str, enum.Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


class DocumentTypeEnum(str, enum.Enum):
    NATIONAL_ID = "national_id"
    PASSPORT = "passport"
    DRIVERS_LICENSE = "drivers_license"
    VOTERS_CARD = "voters_card"
    NIN_SLIP = "nin_slip"
    BVN = "bvn"
    UTILITY_BILL = "utility_bill"
    BANK_STATEMENT = "bank_statement"
    BANK_STATEMENT_3_MONTHS = "bank_statement_3_months"
    EMPLOYMENT_LETTER = "employment_letter"
    TAX_CERTIFICATE = "tax_certificate"
    W2_FORM = "w2_form"
    PAYE_RECORD = "paye_record"
    PAYSLIP = "payslip"
    TAX_RETURN = "tax_return"
    BUSINESS_REGISTRATION = "business_registration"
    AUDITED_ACCOUNTS = "audited_accounts"
    PURCHASE_AGREEMENT = "purchase_agreement"
    DEED_OF_ASSIGNMENT = "deed_of_assignment"
    CERTIFICATE_OF_OCCUPANCY = "certificate_of_occupancy"
    SURVEY_PLAN = "survey_plan"
    GOVERNORS_CONSENT = "governors_consent"
    PROPERTY_VALUATION = "property_valuation"
    SOURCE_OF_FUNDS_DECLARATION = "source_of_funds_declaration"
    GIFT_DECLARATION = "gift_declaration"
    LOAN_AGREEMENT = "loan_agreement"
    SELFIE = "selfie"
    LIVENESS_CHECK = "liveness_check"


class RejectionReasonEnum(str, enum.Enum):
    BLURRY_IMAGE = "blurry_image"
    EXPIRED_DOCUMENT = "expired_document"
    MISMATCH_INFO = "mismatch_info"
    FRAUDULENT_DOCUMENT = "fraudulent_document"
    INCOMPLETE_INFO = "incomplete_info"
    FAILED_LIVENESS = "failed_liveness"
    SANCTIONS_MATCH = "sanctions_match"
    OTHER = "other"


def generate_uuid():
    return str(uuid.uuid4())


# Models
class KYCProfile(Base):
    """KYC Profile for a user"""
    __tablename__ = "kyc_profiles"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), unique=True, nullable=False, index=True)
    current_tier = Column(SQLEnum(KYCTierEnum), default=KYCTierEnum.TIER_0)
    target_tier = Column(SQLEnum(KYCTierEnum), nullable=True)
    
    # Personal Info
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    middle_name = Column(String(100), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(20), nullable=True)
    nationality = Column(String(50), nullable=True)
    
    # Contact Info
    phone = Column(String(20), nullable=True)
    phone_verified = Column(Boolean, default=False)
    email = Column(String(255), nullable=True)
    email_verified = Column(Boolean, default=False)
    
    # Address
    address_line1 = Column(String(255), nullable=True)
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    country = Column(String(2), default="NG")
    postal_code = Column(String(20), nullable=True)
    
    # Identity
    bvn = Column(String(11), nullable=True)
    bvn_verified = Column(Boolean, default=False)
    nin = Column(String(11), nullable=True)
    nin_verified = Column(Boolean, default=False)
    
    # Verification Status
    id_document_status = Column(SQLEnum(VerificationStatusEnum), default=VerificationStatusEnum.PENDING)
    selfie_status = Column(SQLEnum(VerificationStatusEnum), default=VerificationStatusEnum.PENDING)
    address_proof_status = Column(SQLEnum(VerificationStatusEnum), default=VerificationStatusEnum.PENDING)
    liveness_status = Column(SQLEnum(VerificationStatusEnum), default=VerificationStatusEnum.PENDING)
    income_proof_status = Column(SQLEnum(VerificationStatusEnum), default=VerificationStatusEnum.PENDING)
    
    # Metadata
    risk_score = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    last_verification_at = Column(DateTime, nullable=True)
    next_review_at = Column(DateTime, nullable=True)
    
    # Relationships
    documents = relationship("KYCDocument", back_populates="profile", cascade="all, delete-orphan")
    verification_requests = relationship("KYCVerificationRequest", back_populates="profile", cascade="all, delete-orphan")
    liveness_checks = relationship("LivenessCheck", back_populates="profile", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index('idx_kyc_profile_tier', 'current_tier'),
        Index('idx_kyc_profile_bvn', 'bvn'),
    )


class KYCDocument(Base):
    """KYC Document uploaded by user"""
    __tablename__ = "kyc_documents"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), nullable=False, index=True)
    profile_id = Column(String(36), ForeignKey("kyc_profiles.id"), nullable=True)
    
    document_type = Column(SQLEnum(DocumentTypeEnum), nullable=False)
    document_number = Column(String(100), nullable=True)
    issuing_country = Column(String(2), default="NG")
    issue_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    
    # Storage
    file_url = Column(String(500), nullable=False)
    file_hash = Column(String(64), nullable=True)  # SHA-256 hash
    storage_provider = Column(String(50), default="local")  # local, s3, gcs
    storage_key = Column(String(500), nullable=True)  # S3 key or GCS path
    
    # Verification
    status = Column(SQLEnum(VerificationStatusEnum), default=VerificationStatusEnum.PENDING)
    rejection_reason = Column(SQLEnum(RejectionReasonEnum), nullable=True)
    rejection_notes = Column(Text, nullable=True)
    verified_by = Column(String(36), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    
    # OCR/Extraction
    extracted_data = Column(JSON, nullable=True)  # Data extracted from document
    ocr_confidence = Column(Numeric(5, 4), nullable=True)  # OCR confidence score
    
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    profile = relationship("KYCProfile", back_populates="documents")
    
    __table_args__ = (
        Index('idx_kyc_document_user', 'user_id'),
        Index('idx_kyc_document_type', 'document_type'),
        Index('idx_kyc_document_status', 'status'),
    )


class KYCVerificationRequest(Base):
    """Request for KYC tier upgrade"""
    __tablename__ = "kyc_verification_requests"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), nullable=False, index=True)
    profile_id = Column(String(36), ForeignKey("kyc_profiles.id"), nullable=True)
    
    requested_tier = Column(SQLEnum(KYCTierEnum), nullable=False)
    status = Column(SQLEnum(VerificationStatusEnum), default=VerificationStatusEnum.PENDING)
    
    documents = Column(JSON, default=list)  # List of document IDs
    notes = Column(JSON, default=list)  # Review notes
    
    assigned_to = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    profile = relationship("KYCProfile", back_populates="verification_requests")
    
    __table_args__ = (
        Index('idx_kyc_request_status', 'status'),
    )


class LivenessCheck(Base):
    """Liveness check result"""
    __tablename__ = "kyc_liveness_checks"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), nullable=False, index=True)
    profile_id = Column(String(36), ForeignKey("kyc_profiles.id"), nullable=True)
    
    is_live = Column(Boolean, default=False)
    confidence_score = Column(Numeric(5, 4), nullable=True)
    face_match_score = Column(Numeric(5, 4), nullable=True)
    
    checks_passed = Column(JSON, default=list)
    checks_failed = Column(JSON, default=list)
    
    # Provider info
    provider = Column(String(50), default="internal")  # smile_id, onfido, internal
    provider_reference = Column(String(100), nullable=True)
    provider_response = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    profile = relationship("KYCProfile", back_populates="liveness_checks")


class BVNVerification(Base):
    """BVN verification result from NIBSS"""
    __tablename__ = "kyc_bvn_verifications"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), nullable=False, index=True)
    
    bvn = Column(String(11), nullable=False)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    middle_name = Column(String(100), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    phone = Column(String(20), nullable=True)
    
    is_valid = Column(Boolean, default=False)
    match_score = Column(Numeric(5, 4), nullable=True)
    
    # Provider info
    provider = Column(String(50), default="nibss")  # nibss, paystack, flutterwave
    provider_reference = Column(String(100), nullable=True)
    provider_response = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    __table_args__ = (
        Index('idx_bvn_verification_bvn', 'bvn'),
    )


class AuditLog(Base):
    """Audit log for KYC operations"""
    __tablename__ = "kyc_audit_logs"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), nullable=True, index=True)
    actor_id = Column(String(36), nullable=True)  # Who performed the action
    
    action = Column(String(100), nullable=False)  # e.g., "document_uploaded", "tier_upgraded"
    resource_type = Column(String(50), nullable=False)  # e.g., "profile", "document"
    resource_id = Column(String(36), nullable=True)
    
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    correlation_id = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    __table_args__ = (
        Index('idx_audit_log_action', 'action'),
        Index('idx_audit_log_resource', 'resource_type', 'resource_id'),
        Index('idx_audit_log_created', 'created_at'),
    )
