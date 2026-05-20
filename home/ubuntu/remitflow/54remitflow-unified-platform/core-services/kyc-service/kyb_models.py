"""
KYB (Know Your Business) Database Models
SQLAlchemy ORM models for business entity verification
"""

from sqlalchemy import (
    Column, String, Boolean, Integer, DateTime, Text, Enum as SQLEnum,
    ForeignKey, JSON, Numeric, Date, Index, Table
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
class BusinessTypeEnum(str, enum.Enum):
    SOLE_PROPRIETORSHIP = "sole_proprietorship"
    PARTNERSHIP = "partnership"
    LIMITED_LIABILITY = "limited_liability"
    PUBLIC_LIMITED = "public_limited"
    COOPERATIVE = "cooperative"
    NGO = "ngo"
    GOVERNMENT = "government"
    OTHER = "other"


class BusinessStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    DISSOLVED = "dissolved"
    UNDER_REVIEW = "under_review"


class KYBVerificationStatusEnum(str, enum.Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    REQUIRES_UPDATE = "requires_update"


class KYBTierEnum(str, enum.Enum):
    TIER_0 = "tier_0"  # Unverified
    TIER_1 = "tier_1"  # Basic - Registration verified
    TIER_2 = "tier_2"  # Standard - Directors verified
    TIER_3 = "tier_3"  # Enhanced - UBOs verified + AML
    TIER_4 = "tier_4"  # Premium - Full due diligence


class DirectorRoleEnum(str, enum.Enum):
    DIRECTOR = "director"
    MANAGING_DIRECTOR = "managing_director"
    CHAIRMAN = "chairman"
    SECRETARY = "secretary"
    CEO = "ceo"
    CFO = "cfo"
    OTHER = "other"


class UBOTypeEnum(str, enum.Enum):
    DIRECT_OWNERSHIP = "direct_ownership"
    INDIRECT_OWNERSHIP = "indirect_ownership"
    CONTROL_THROUGH_VOTING = "control_through_voting"
    CONTROL_THROUGH_OTHER = "control_through_other"


class KYBDocumentTypeEnum(str, enum.Enum):
    # Registration Documents
    CAC_CERTIFICATE = "cac_certificate"  # Nigeria Corporate Affairs Commission
    CERTIFICATE_OF_INCORPORATION = "certificate_of_incorporation"
    MEMORANDUM_OF_ASSOCIATION = "memorandum_of_association"
    ARTICLES_OF_ASSOCIATION = "articles_of_association"
    FORM_CAC_2 = "form_cac_2"  # Particulars of Directors
    FORM_CAC_7 = "form_cac_7"  # Particulars of Shareholders
    
    # Tax Documents
    TIN_CERTIFICATE = "tin_certificate"  # Tax Identification Number
    VAT_CERTIFICATE = "vat_certificate"
    TAX_CLEARANCE = "tax_clearance"
    
    # Financial Documents
    AUDITED_ACCOUNTS = "audited_accounts"
    BANK_STATEMENT = "bank_statement"
    FINANCIAL_PROJECTIONS = "financial_projections"
    
    # Regulatory Documents
    BUSINESS_LICENSE = "business_license"
    SECTOR_LICENSE = "sector_license"  # CBN, SEC, etc.
    REGULATORY_APPROVAL = "regulatory_approval"
    
    # Address Verification
    UTILITY_BILL = "utility_bill"
    LEASE_AGREEMENT = "lease_agreement"
    
    # Other
    BOARD_RESOLUTION = "board_resolution"
    POWER_OF_ATTORNEY = "power_of_attorney"
    OTHER = "other"


def generate_uuid():
    return str(uuid.uuid4())


# Association table for business-director many-to-many
business_directors = Table(
    'kyb_business_directors',
    Base.metadata,
    Column('business_id', String(36), ForeignKey('kyb_businesses.id'), primary_key=True),
    Column('director_id', String(36), ForeignKey('kyb_directors.id'), primary_key=True),
    Column('role', SQLEnum(DirectorRoleEnum), default=DirectorRoleEnum.DIRECTOR),
    Column('appointed_date', Date, nullable=True),
    Column('resigned_date', Date, nullable=True),
    Column('is_active', Boolean, default=True),
    Column('created_at', DateTime, default=func.now())
)


class KYBBusiness(Base):
    """Business entity for KYB verification"""
    __tablename__ = "kyb_businesses"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Registration Details
    business_name = Column(String(255), nullable=False)
    trading_name = Column(String(255), nullable=True)
    registration_number = Column(String(50), unique=True, nullable=False, index=True)  # RC Number
    registration_date = Column(Date, nullable=True)
    registration_country = Column(String(2), default="NG")
    business_type = Column(SQLEnum(BusinessTypeEnum), nullable=False)
    business_status = Column(SQLEnum(BusinessStatusEnum), default=BusinessStatusEnum.ACTIVE)
    
    # Tax Information
    tin = Column(String(20), nullable=True, index=True)  # Tax Identification Number
    vat_number = Column(String(20), nullable=True)
    
    # Contact Information
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    website = Column(String(255), nullable=True)
    
    # Registered Address
    registered_address_line1 = Column(String(255), nullable=True)
    registered_address_line2 = Column(String(255), nullable=True)
    registered_city = Column(String(100), nullable=True)
    registered_state = Column(String(100), nullable=True)
    registered_country = Column(String(2), default="NG")
    registered_postal_code = Column(String(20), nullable=True)
    
    # Operating Address (if different)
    operating_address_line1 = Column(String(255), nullable=True)
    operating_address_line2 = Column(String(255), nullable=True)
    operating_city = Column(String(100), nullable=True)
    operating_state = Column(String(100), nullable=True)
    operating_country = Column(String(2), default="NG")
    operating_postal_code = Column(String(20), nullable=True)
    
    # Business Details
    industry_sector = Column(String(100), nullable=True)
    industry_code = Column(String(20), nullable=True)  # ISIC/NAICS code
    description = Column(Text, nullable=True)
    employee_count = Column(Integer, nullable=True)
    annual_revenue = Column(Numeric(20, 2), nullable=True)
    share_capital = Column(Numeric(20, 2), nullable=True)
    
    # KYB Verification Status
    kyb_tier = Column(SQLEnum(KYBTierEnum), default=KYBTierEnum.TIER_0)
    kyb_status = Column(SQLEnum(KYBVerificationStatusEnum), default=KYBVerificationStatusEnum.PENDING)
    
    # Compliance Flags
    sanctions_clear = Column(Boolean, default=False)
    pep_clear = Column(Boolean, default=False)
    aml_clear = Column(Boolean, default=False)
    adverse_media_clear = Column(Boolean, default=False)
    
    # Risk Assessment
    risk_score = Column(Integer, default=0)
    risk_flags = Column(JSON, default=list)
    risk_level = Column(String(20), default="unknown")  # low, medium, high, critical
    
    # Screening Results
    last_screening_id = Column(String(100), nullable=True)
    last_screening_date = Column(DateTime, nullable=True)
    screening_provider = Column(String(50), nullable=True)
    
    # Verification Metadata
    verified_by = Column(String(36), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    verification_notes = Column(Text, nullable=True)
    next_review_date = Column(Date, nullable=True)
    
    # Platform Integration
    platform_user_id = Column(String(36), nullable=True, index=True)  # Link to platform user
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    directors = relationship("KYBDirector", secondary=business_directors, back_populates="businesses")
    ubos = relationship("KYBUltimateBeneficialOwner", back_populates="business", cascade="all, delete-orphan")
    documents = relationship("KYBDocument", back_populates="business", cascade="all, delete-orphan")
    verification_requests = relationship("KYBVerificationRequest", back_populates="business", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index('idx_kyb_business_name', 'business_name'),
        Index('idx_kyb_business_status', 'kyb_status'),
        Index('idx_kyb_business_tier', 'kyb_tier'),
    )


class KYBDirector(Base):
    """Director/Officer of a business"""
    __tablename__ = "kyb_directors"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Personal Information
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    middle_name = Column(String(100), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    nationality = Column(String(50), nullable=True)
    
    # Contact
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    
    # Address
    address_line1 = Column(String(255), nullable=True)
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    country = Column(String(2), default="NG")
    postal_code = Column(String(20), nullable=True)
    
    # Identity Documents
    id_type = Column(String(50), nullable=True)
    id_number = Column(String(100), nullable=True)
    id_issuing_country = Column(String(2), default="NG")
    id_issue_date = Column(Date, nullable=True)
    id_expiry_date = Column(Date, nullable=True)
    
    # Nigeria-specific
    bvn = Column(String(11), nullable=True)
    nin = Column(String(11), nullable=True)
    
    # KYC Status (linked to individual KYC)
    kyc_profile_id = Column(String(36), nullable=True)  # Link to KYC profile
    kyc_verified = Column(Boolean, default=False)
    
    # Compliance Flags
    sanctions_clear = Column(Boolean, default=False)
    pep_status = Column(Boolean, default=False)  # True if PEP
    pep_details = Column(JSON, nullable=True)
    
    # Verification
    verification_status = Column(SQLEnum(KYBVerificationStatusEnum), default=KYBVerificationStatusEnum.PENDING)
    verified_by = Column(String(36), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    businesses = relationship("KYBBusiness", secondary=business_directors, back_populates="directors")
    
    __table_args__ = (
        Index('idx_kyb_director_name', 'first_name', 'last_name'),
        Index('idx_kyb_director_bvn', 'bvn'),
    )


class KYBUltimateBeneficialOwner(Base):
    """Ultimate Beneficial Owner (UBO) of a business"""
    __tablename__ = "kyb_ubos"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    business_id = Column(String(36), ForeignKey("kyb_businesses.id"), nullable=False)
    
    # Ownership Details
    ownership_type = Column(SQLEnum(UBOTypeEnum), nullable=False)
    ownership_percentage = Column(Numeric(5, 2), nullable=False)  # e.g., 25.50%
    voting_rights_percentage = Column(Numeric(5, 2), nullable=True)
    
    # Personal Information
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    middle_name = Column(String(100), nullable=True)
    date_of_birth = Column(Date, nullable=True)
    nationality = Column(String(50), nullable=True)
    
    # Contact
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    
    # Address
    address_line1 = Column(String(255), nullable=True)
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    country = Column(String(2), default="NG")
    postal_code = Column(String(20), nullable=True)
    
    # Identity Documents
    id_type = Column(String(50), nullable=True)
    id_number = Column(String(100), nullable=True)
    id_issuing_country = Column(String(2), default="NG")
    
    # Nigeria-specific
    bvn = Column(String(11), nullable=True)
    nin = Column(String(11), nullable=True)
    
    # KYC Status
    kyc_profile_id = Column(String(36), nullable=True)
    kyc_verified = Column(Boolean, default=False)
    
    # Compliance Flags
    sanctions_clear = Column(Boolean, default=False)
    pep_status = Column(Boolean, default=False)
    pep_details = Column(JSON, nullable=True)
    
    # Source of Wealth
    source_of_wealth = Column(String(255), nullable=True)
    source_of_wealth_verified = Column(Boolean, default=False)
    
    # Verification
    verification_status = Column(SQLEnum(KYBVerificationStatusEnum), default=KYBVerificationStatusEnum.PENDING)
    verified_by = Column(String(36), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    business = relationship("KYBBusiness", back_populates="ubos")
    
    __table_args__ = (
        Index('idx_kyb_ubo_business', 'business_id'),
        Index('idx_kyb_ubo_ownership', 'ownership_percentage'),
    )


class KYBDocument(Base):
    """Business document for KYB verification"""
    __tablename__ = "kyb_documents"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    business_id = Column(String(36), ForeignKey("kyb_businesses.id"), nullable=False)
    
    document_type = Column(SQLEnum(KYBDocumentTypeEnum), nullable=False)
    document_number = Column(String(100), nullable=True)
    issue_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    issuing_authority = Column(String(255), nullable=True)
    
    # Storage
    file_url = Column(String(500), nullable=False)
    file_hash = Column(String(64), nullable=True)
    storage_provider = Column(String(50), default="local")
    storage_key = Column(String(500), nullable=True)
    
    # Verification
    status = Column(SQLEnum(KYBVerificationStatusEnum), default=KYBVerificationStatusEnum.PENDING)
    rejection_reason = Column(Text, nullable=True)
    verified_by = Column(String(36), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    
    # OCR/Extraction
    extracted_data = Column(JSON, nullable=True)
    ocr_confidence = Column(Numeric(5, 4), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    business = relationship("KYBBusiness", back_populates="documents")
    
    __table_args__ = (
        Index('idx_kyb_document_business', 'business_id'),
        Index('idx_kyb_document_type', 'document_type'),
        Index('idx_kyb_document_status', 'status'),
    )


class KYBVerificationRequest(Base):
    """Request for KYB tier upgrade"""
    __tablename__ = "kyb_verification_requests"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    business_id = Column(String(36), ForeignKey("kyb_businesses.id"), nullable=False)
    
    requested_tier = Column(SQLEnum(KYBTierEnum), nullable=False)
    current_tier = Column(SQLEnum(KYBTierEnum), nullable=False)
    status = Column(SQLEnum(KYBVerificationStatusEnum), default=KYBVerificationStatusEnum.PENDING)
    
    # Review
    assigned_to = Column(String(36), nullable=True)
    review_notes = Column(JSON, default=list)
    rejection_reason = Column(Text, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    business = relationship("KYBBusiness", back_populates="verification_requests")
    
    __table_args__ = (
        Index('idx_kyb_request_status', 'status'),
        Index('idx_kyb_request_business', 'business_id'),
    )


class KYBAuditLog(Base):
    """Audit log for KYB operations"""
    __tablename__ = "kyb_audit_logs"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    business_id = Column(String(36), nullable=True, index=True)
    actor_id = Column(String(36), nullable=True)
    
    action = Column(String(100), nullable=False)
    resource_type = Column(String(50), nullable=False)
    resource_id = Column(String(36), nullable=True)
    
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    correlation_id = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    __table_args__ = (
        Index('idx_kyb_audit_action', 'action'),
        Index('idx_kyb_audit_resource', 'resource_type', 'resource_id'),
        Index('idx_kyb_audit_created', 'created_at'),
    )
