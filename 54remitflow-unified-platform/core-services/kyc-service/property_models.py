"""
Property Transaction KYC Database Models
SQLAlchemy ORM models for PostgreSQL persistence of property transactions
"""

from sqlalchemy import (
    Column, String, Boolean, Integer, DateTime, Text, Enum as SQLEnum,
    ForeignKey, JSON, Numeric, Date, Index, CheckConstraint
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


def generate_uuid():
    return str(uuid.uuid4())


def generate_reference():
    return f"PTX-{uuid.uuid4().hex[:8].upper()}"


# Enums
class PartyRoleEnum(str, enum.Enum):
    BUYER = "buyer"
    SELLER = "seller"
    AGENT = "agent"
    LAWYER = "lawyer"
    ESCROW = "escrow"


class SourceOfFundsEnum(str, enum.Enum):
    EMPLOYMENT_INCOME = "employment_income"
    BUSINESS_INCOME = "business_income"
    SAVINGS = "savings"
    INVESTMENT_RETURNS = "investment_returns"
    SALE_OF_PROPERTY = "sale_of_property"
    INHERITANCE = "inheritance"
    GIFT = "gift"
    LOAN = "loan"
    PENSION = "pension"
    RENTAL_INCOME = "rental_income"
    OTHER = "other"


class IncomeDocumentTypeEnum(str, enum.Enum):
    W2_FORM = "w2_form"
    PAYE_RECORD = "paye_record"
    TAX_RETURN = "tax_return"
    PAYSLIP = "payslip"
    EMPLOYMENT_LETTER = "employment_letter"
    BUSINESS_REGISTRATION = "business_registration"
    AUDITED_ACCOUNTS = "audited_accounts"
    BANK_REFERENCE = "bank_reference"
    PENSION_STATEMENT = "pension_statement"


class PropertyDocumentTypeEnum(str, enum.Enum):
    PURCHASE_AGREEMENT = "purchase_agreement"
    DEED_OF_ASSIGNMENT = "deed_of_assignment"
    CERTIFICATE_OF_OCCUPANCY = "certificate_of_occupancy"
    SURVEY_PLAN = "survey_plan"
    GOVERNORS_CONSENT = "governors_consent"
    POWER_OF_ATTORNEY = "power_of_attorney"
    PROPERTY_VALUATION = "property_valuation"


class TransactionStatusEnum(str, enum.Enum):
    INITIATED = "initiated"
    BUYER_KYC_PENDING = "buyer_kyc_pending"
    SELLER_KYC_PENDING = "seller_kyc_pending"
    DOCUMENTS_PENDING = "documents_pending"
    UNDER_REVIEW = "under_review"
    COMPLIANCE_CHECK = "compliance_check"
    APPROVED = "approved"
    FUNDS_HELD = "funds_held"
    COMPLETED = "completed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class PropertyVerificationStatusEnum(str, enum.Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


# Valid state transitions for state machine enforcement
VALID_STATUS_TRANSITIONS = {
    TransactionStatusEnum.INITIATED: [TransactionStatusEnum.BUYER_KYC_PENDING, TransactionStatusEnum.CANCELLED],
    TransactionStatusEnum.BUYER_KYC_PENDING: [TransactionStatusEnum.SELLER_KYC_PENDING, TransactionStatusEnum.CANCELLED],
    TransactionStatusEnum.SELLER_KYC_PENDING: [TransactionStatusEnum.DOCUMENTS_PENDING, TransactionStatusEnum.CANCELLED],
    TransactionStatusEnum.DOCUMENTS_PENDING: [TransactionStatusEnum.UNDER_REVIEW, TransactionStatusEnum.CANCELLED],
    TransactionStatusEnum.UNDER_REVIEW: [TransactionStatusEnum.COMPLIANCE_CHECK, TransactionStatusEnum.REJECTED, TransactionStatusEnum.CANCELLED],
    TransactionStatusEnum.COMPLIANCE_CHECK: [TransactionStatusEnum.APPROVED, TransactionStatusEnum.REJECTED],
    TransactionStatusEnum.APPROVED: [TransactionStatusEnum.FUNDS_HELD, TransactionStatusEnum.COMPLETED],
    TransactionStatusEnum.FUNDS_HELD: [TransactionStatusEnum.COMPLETED, TransactionStatusEnum.CANCELLED],
    TransactionStatusEnum.COMPLETED: [],
    TransactionStatusEnum.REJECTED: [],
    TransactionStatusEnum.CANCELLED: [],
}


# Models
class PropertyParty(Base):
    """Party in a property transaction (buyer, seller, agent, etc.)"""
    __tablename__ = "property_parties"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Link to core KYC profile (if exists)
    kyc_profile_id = Column(String(36), ForeignKey("kyc_profiles.id"), nullable=True)
    user_id = Column(String(36), nullable=True, index=True)
    
    role = Column(SQLEnum(PartyRoleEnum), nullable=False)
    
    # Personal Information
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    middle_name = Column(String(100), nullable=True)
    date_of_birth = Column(Date, nullable=False)
    nationality = Column(String(50), nullable=False)
    
    # Contact
    email = Column(String(255), nullable=False)
    phone = Column(String(20), nullable=False)
    
    # Address
    address_line1 = Column(String(255), nullable=False)
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100), nullable=False)
    state = Column(String(100), nullable=False)
    country = Column(String(2), default="NG")
    postal_code = Column(String(20), nullable=True)
    
    # Identity Documents
    id_type = Column(String(50), nullable=False)
    id_number = Column(String(100), nullable=False)
    id_issuing_country = Column(String(2), default="NG")
    id_issue_date = Column(Date, nullable=False)
    id_expiry_date = Column(Date, nullable=False)
    id_document_url = Column(String(500), nullable=True)
    id_document_storage_key = Column(String(500), nullable=True)
    
    # Nigeria-specific
    bvn = Column(String(11), nullable=True)
    nin = Column(String(11), nullable=True)
    
    # Verification
    kyc_status = Column(SQLEnum(PropertyVerificationStatusEnum), default=PropertyVerificationStatusEnum.PENDING)
    kyc_verified_at = Column(DateTime, nullable=True)
    kyc_verified_by = Column(String(36), nullable=True)
    
    # Compliance screening results
    screening_result_id = Column(String(36), nullable=True)
    sanctions_clear = Column(Boolean, default=False)
    pep_clear = Column(Boolean, default=False)
    
    # Metadata
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    transactions_as_buyer = relationship("PropertyTransaction", back_populates="buyer", foreign_keys="PropertyTransaction.buyer_id")
    transactions_as_seller = relationship("PropertyTransaction", back_populates="seller", foreign_keys="PropertyTransaction.seller_id")
    
    __table_args__ = (
        Index('idx_property_party_role', 'role'),
        Index('idx_property_party_kyc_status', 'kyc_status'),
        Index('idx_property_party_bvn', 'bvn'),
        CheckConstraint("LENGTH(bvn) = 11 OR bvn IS NULL", name="check_bvn_length"),
    )


class PropertyTransaction(Base):
    """Property transaction with all KYC requirements"""
    __tablename__ = "property_transactions"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    reference_number = Column(String(20), unique=True, nullable=False, default=generate_reference)
    
    # Transaction Details
    transaction_type = Column(String(50), default="property_purchase")
    property_type = Column(String(50), nullable=False)
    property_address = Column(Text, nullable=False)
    purchase_price = Column(Numeric(20, 2), nullable=False)
    currency = Column(String(3), default="NGN")
    
    # Parties
    buyer_id = Column(String(36), ForeignKey("property_parties.id"), nullable=False)
    seller_id = Column(String(36), ForeignKey("property_parties.id"), nullable=True)
    escrow_id = Column(String(36), ForeignKey("property_parties.id"), nullable=True)
    
    # KYC Status
    buyer_kyc_complete = Column(Boolean, default=False)
    seller_kyc_complete = Column(Boolean, default=False)
    
    # Source of Funds
    source_of_funds_id = Column(String(36), ForeignKey("property_source_of_funds.id"), nullable=True)
    source_of_funds_verified = Column(Boolean, default=False)
    
    # Bank Statements
    bank_statements_verified = Column(Boolean, default=False)
    bank_statements_cover_3_months = Column(Boolean, default=False)
    
    # Income
    income_verified = Column(Boolean, default=False)
    
    # Purchase Agreement
    purchase_agreement_id = Column(String(36), ForeignKey("property_purchase_agreements.id"), nullable=True)
    purchase_agreement_verified = Column(Boolean, default=False)
    
    # Compliance
    aml_check_passed = Column(Boolean, default=False)
    sanctions_check_passed = Column(Boolean, default=False)
    pep_check_passed = Column(Boolean, default=False)
    compliance_case_id = Column(String(36), nullable=True)
    risk_score = Column(Integer, default=0)
    risk_flags = Column(JSON, default=list)
    
    # Status
    status = Column(SQLEnum(TransactionStatusEnum), default=TransactionStatusEnum.INITIATED)
    status_history = Column(JSON, default=list)
    
    # Review
    assigned_reviewer = Column(String(36), nullable=True)
    reviewer_notes = Column(JSON, default=list)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    approved_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    buyer = relationship("PropertyParty", back_populates="transactions_as_buyer", foreign_keys=[buyer_id])
    seller = relationship("PropertyParty", back_populates="transactions_as_seller", foreign_keys=[seller_id])
    source_of_funds = relationship("PropertySourceOfFunds", back_populates="transaction")
    bank_statements = relationship("PropertyBankStatement", back_populates="transaction", cascade="all, delete-orphan")
    income_documents = relationship("PropertyIncomeDocument", back_populates="transaction", cascade="all, delete-orphan")
    purchase_agreement = relationship("PropertyPurchaseAgreement", back_populates="transaction", uselist=False)
    audit_logs = relationship("PropertyTransactionAuditLog", back_populates="transaction", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index('idx_property_tx_status', 'status'),
        Index('idx_property_tx_reference', 'reference_number'),
        Index('idx_property_tx_buyer', 'buyer_id'),
        Index('idx_property_tx_seller', 'seller_id'),
        Index('idx_property_tx_created', 'created_at'),
    )


class PropertySourceOfFunds(Base):
    """Source of funds declaration for property purchase"""
    __tablename__ = "property_source_of_funds"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    transaction_id = Column(String(36), nullable=False, index=True)
    
    # Primary source
    primary_source = Column(SQLEnum(SourceOfFundsEnum), nullable=False)
    primary_source_description = Column(Text, nullable=False)
    primary_source_amount = Column(Numeric(20, 2), nullable=False)
    
    # Secondary sources
    secondary_sources = Column(JSON, default=list)
    
    # Employment details
    employer_name = Column(String(255), nullable=True)
    employer_address = Column(Text, nullable=True)
    job_title = Column(String(100), nullable=True)
    employment_start_date = Column(Date, nullable=True)
    monthly_salary = Column(Numeric(20, 2), nullable=True)
    
    # Business details
    business_name = Column(String(255), nullable=True)
    business_registration_number = Column(String(100), nullable=True)
    business_type = Column(String(100), nullable=True)
    annual_revenue = Column(Numeric(20, 2), nullable=True)
    
    # Loan details
    lender_name = Column(String(255), nullable=True)
    loan_amount = Column(Numeric(20, 2), nullable=True)
    loan_reference = Column(String(100), nullable=True)
    
    # Gift details
    donor_name = Column(String(255), nullable=True)
    donor_relationship = Column(String(100), nullable=True)
    gift_declaration_url = Column(String(500), nullable=True)
    gift_declaration_storage_key = Column(String(500), nullable=True)
    
    # Verification
    status = Column(SQLEnum(PropertyVerificationStatusEnum), default=PropertyVerificationStatusEnum.PENDING)
    risk_flags = Column(JSON, default=list)
    reviewer_notes = Column(Text, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    transaction = relationship("PropertyTransaction", back_populates="source_of_funds")
    
    __table_args__ = (
        Index('idx_property_sof_status', 'status'),
    )


class PropertyBankStatement(Base):
    """Bank statement for property transaction"""
    __tablename__ = "property_bank_statements"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    transaction_id = Column(String(36), ForeignKey("property_transactions.id"), nullable=False)
    party_id = Column(String(36), ForeignKey("property_parties.id"), nullable=False)
    
    bank_name = Column(String(255), nullable=False)
    account_number = Column(String(20), nullable=False)  # Masked (last 4 digits)
    account_holder_name = Column(String(255), nullable=False)
    
    statement_start_date = Column(Date, nullable=False)
    statement_end_date = Column(Date, nullable=False)
    
    # Storage
    document_url = Column(String(500), nullable=False)
    document_hash = Column(String(64), nullable=True)
    storage_key = Column(String(500), nullable=True)
    
    # Extracted data (from OCR)
    opening_balance = Column(Numeric(20, 2), nullable=True)
    closing_balance = Column(Numeric(20, 2), nullable=True)
    total_credits = Column(Numeric(20, 2), nullable=True)
    total_debits = Column(Numeric(20, 2), nullable=True)
    
    # Verification
    status = Column(SQLEnum(PropertyVerificationStatusEnum), default=PropertyVerificationStatusEnum.PENDING)
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    transaction = relationship("PropertyTransaction", back_populates="bank_statements")
    
    __table_args__ = (
        Index('idx_property_bs_transaction', 'transaction_id'),
        Index('idx_property_bs_dates', 'statement_start_date', 'statement_end_date'),
        CheckConstraint("statement_end_date >= statement_start_date", name="check_date_range"),
    )


class PropertyIncomeDocument(Base):
    """Income verification document for property transaction"""
    __tablename__ = "property_income_documents"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    transaction_id = Column(String(36), ForeignKey("property_transactions.id"), nullable=False)
    party_id = Column(String(36), ForeignKey("property_parties.id"), nullable=False)
    
    document_type = Column(SQLEnum(IncomeDocumentTypeEnum), nullable=False)
    
    # Storage
    document_url = Column(String(500), nullable=False)
    document_hash = Column(String(64), nullable=True)
    storage_key = Column(String(500), nullable=True)
    
    # Document details
    tax_year = Column(Integer, nullable=True)
    employer_name = Column(String(255), nullable=True)
    gross_income = Column(Numeric(20, 2), nullable=True)
    net_income = Column(Numeric(20, 2), nullable=True)
    
    # Verification
    status = Column(SQLEnum(PropertyVerificationStatusEnum), default=PropertyVerificationStatusEnum.PENDING)
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    transaction = relationship("PropertyTransaction", back_populates="income_documents")
    
    __table_args__ = (
        Index('idx_property_income_transaction', 'transaction_id'),
        Index('idx_property_income_type', 'document_type'),
    )


class PropertyPurchaseAgreement(Base):
    """Purchase agreement for property transaction"""
    __tablename__ = "property_purchase_agreements"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    transaction_id = Column(String(36), ForeignKey("property_transactions.id"), nullable=False, unique=True)
    
    # Storage
    document_url = Column(String(500), nullable=False)
    document_hash = Column(String(64), nullable=True)
    storage_key = Column(String(500), nullable=True)
    
    # Buyer Information (must match buyer KYC)
    buyer_name = Column(String(255), nullable=False)
    buyer_address = Column(Text, nullable=False)
    buyer_id_number = Column(String(100), nullable=True)
    
    # Seller Information (must match seller KYC)
    seller_name = Column(String(255), nullable=False)
    seller_address = Column(Text, nullable=False)
    seller_id_number = Column(String(100), nullable=True)
    
    # Property Details
    property_address = Column(Text, nullable=False)
    property_description = Column(Text, nullable=False)
    property_type = Column(String(50), nullable=False)
    property_size = Column(String(100), nullable=True)
    title_reference = Column(String(100), nullable=True)
    
    # Transaction Terms
    purchase_price = Column(Numeric(20, 2), nullable=False)
    currency = Column(String(3), default="NGN")
    deposit_amount = Column(Numeric(20, 2), nullable=True)
    deposit_paid = Column(Boolean, default=False)
    completion_date = Column(Date, nullable=True)
    
    # Signatures
    buyer_signed = Column(Boolean, default=False)
    buyer_signature_date = Column(Date, nullable=True)
    seller_signed = Column(Boolean, default=False)
    seller_signature_date = Column(Date, nullable=True)
    witness_signed = Column(Boolean, default=False)
    
    # Validation
    buyer_info_matches_kyc = Column(Boolean, default=False)
    seller_info_matches_kyc = Column(Boolean, default=False)
    price_matches_transaction = Column(Boolean, default=False)
    
    # Verification
    status = Column(SQLEnum(PropertyVerificationStatusEnum), default=PropertyVerificationStatusEnum.PENDING)
    rejection_reason = Column(Text, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    transaction = relationship("PropertyTransaction", back_populates="purchase_agreement")
    
    __table_args__ = (
        Index('idx_property_agreement_status', 'status'),
    )


class PropertyTransactionAuditLog(Base):
    """Audit log for property transaction actions"""
    __tablename__ = "property_transaction_audit_logs"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    transaction_id = Column(String(36), ForeignKey("property_transactions.id"), nullable=False)
    
    # Action details
    action = Column(String(100), nullable=False)
    action_type = Column(String(50), nullable=False)  # create, update, verify, approve, reject
    
    # Actor
    actor_id = Column(String(36), nullable=True)
    actor_type = Column(String(50), nullable=True)  # user, system, reviewer
    
    # State change
    old_status = Column(String(50), nullable=True)
    new_status = Column(String(50), nullable=True)
    
    # Details
    resource_type = Column(String(50), nullable=True)  # party, document, agreement, etc.
    resource_id = Column(String(36), nullable=True)
    details = Column(JSON, nullable=True)
    
    # Request context
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(500), nullable=True)
    correlation_id = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    transaction = relationship("PropertyTransaction", back_populates="audit_logs")
    
    __table_args__ = (
        Index('idx_property_audit_transaction', 'transaction_id'),
        Index('idx_property_audit_action', 'action'),
        Index('idx_property_audit_created', 'created_at'),
    )
