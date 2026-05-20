"""
Database schemas for Card Service
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Numeric, Text, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB

from app.database import Base


class Card(Base):
    """Card model for managing user cards."""
    
    __tablename__ = "cards"
    
    # Primary Key
    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign Keys
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    
    # Card Details
    card_number_encrypted = Column(Text, nullable=False)  # Encrypted card number
    card_holder_name = Column(String(255), nullable=False)
    card_type = Column(String(50), nullable=False)  # debit, credit, prepaid
    card_brand = Column(String(50), nullable=False)  # visa, mastercard, amex, etc.
    
    # Security Fields
    cvv_encrypted = Column(Text, nullable=False)  # Encrypted CVV
    expiry_month = Column(Integer, nullable=False)
    expiry_year = Column(Integer, nullable=False)
    
    # Card Issuer
    issuer_name = Column(String(255), nullable=True)
    issuer_country = Column(String(3), nullable=True)
    issuer_bank = Column(String(255), nullable=True)
    
    # Status
    status = Column(String(50), nullable=False, default="active", index=True)
    # Status values: active, inactive, blocked, expired, lost, stolen
    
    is_primary = Column(Boolean, default=False)
    is_verified = Column(Boolean, default=False)
    
    # Compliance
    kyc_verified = Column(Boolean, default=False)
    fraud_score = Column(Numeric(precision=5, scale=2), nullable=True)
    
    # Limits
    daily_limit = Column(Numeric(precision=20, scale=2), nullable=True)
    monthly_limit = Column(Numeric(precision=20, scale=2), nullable=True)
    
    # Usage Tracking
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    usage_count = Column(Integer, default=0)
    
    # Metadata
    metadata = Column(JSONB, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    verified_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="cards")
    transactions = relationship("CardTransaction", back_populates="card", cascade="all, delete-orphan")
    limits = relationship("CardLimit", back_populates="card", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_card_user_status', 'user_id', 'status'),
        Index('idx_card_created', 'created_at'),
    )
    
    def __repr__(self):
        return f"<Card(id={self.id}, user_id={self.user_id}, type={self.card_type}, status={self.status})>"


class CardTransaction(Base):
    """Card-specific transaction records."""
    
    __tablename__ = "card_transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=True, index=True)
    
    # Transaction Details
    amount = Column(Numeric(precision=20, scale=2), nullable=False)
    currency = Column(String(3), nullable=False)
    
    # Merchant Information
    merchant_name = Column(String(255), nullable=True)
    merchant_category = Column(String(100), nullable=True)
    merchant_country = Column(String(3), nullable=True)
    
    # Transaction Type
    transaction_type = Column(String(50), nullable=False)  # purchase, withdrawal, refund
    
    # Status
    status = Column(String(50), nullable=False, default="pending")
    
    # Authorization
    authorization_code = Column(String(100), nullable=True)
    is_authorized = Column(Boolean, default=False)
    
    # Metadata
    metadata = Column(JSONB, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    authorized_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    card = relationship("Card", back_populates="transactions")
    
    # Indexes
    __table_args__ = (
        Index('idx_card_transaction_card', 'card_id', 'created_at'),
        Index('idx_card_transaction_status', 'status'),
    )
    
    def __repr__(self):
        return f"<CardTransaction(id={self.id}, card_id={self.card_id}, amount={self.amount})>"


class CardLimit(Base):
    """Card spending limits and restrictions."""
    
    __tablename__ = "card_limits"
    
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("cards.id"), nullable=False, index=True)
    
    # Limit Type
    limit_type = Column(String(50), nullable=False)  # daily, weekly, monthly, per_transaction
    
    # Limit Amount
    limit_amount = Column(Numeric(precision=20, scale=2), nullable=False)
    currency = Column(String(3), nullable=False)
    
    # Current Usage
    current_usage = Column(Numeric(precision=20, scale=2), default=0.00)
    
    # Period
    period_start = Column(DateTime(timezone=True), nullable=True)
    period_end = Column(DateTime(timezone=True), nullable=True)
    
    # Status
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    card = relationship("Card", back_populates="limits")
    
    def __repr__(self):
        return f"<CardLimit(id={self.id}, card_id={self.card_id}, type={self.limit_type}, limit={self.limit_amount})>"
