"""
SQLAlchemy ORM models for Payment Service
Provides persistent storage for payments
"""

from sqlalchemy import Column, String, Numeric, DateTime, Boolean, JSON, Index, Integer
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()


class PaymentModel(Base):
    """Payment database model"""
    __tablename__ = "payments"
    
    payment_id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    amount = Column(Numeric(20, 2), nullable=False)
    currency = Column(String(3), nullable=False)
    method = Column(String(20), nullable=False)
    gateway = Column(String(20), nullable=False)
    
    # Payer details
    payer_name = Column(String(200), nullable=False)
    payer_email = Column(String(200), nullable=False)
    payer_phone = Column(String(50), nullable=True)
    
    # Payee details
    payee_name = Column(String(200), nullable=False)
    payee_account = Column(String(100), nullable=False)
    payee_bank = Column(String(100), nullable=True)
    
    # Payment details
    reference = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(String(500), nullable=True)
    metadata = Column(JSON, default={})
    
    # Status
    status = Column(String(20), nullable=False, default="pending")
    gateway_reference = Column(String(100), nullable=True)
    gateway_response = Column(JSON, nullable=True)
    
    # Fees
    fee_amount = Column(Numeric(20, 2), nullable=False, default=0)
    total_amount = Column(Numeric(20, 2), nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    processed_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Error handling
    error_code = Column(String(50), nullable=True)
    error_message = Column(String(500), nullable=True)
    retry_count = Column(Integer, default=0)
    
    # Indexes
    __table_args__ = (
        Index('ix_payments_user_status', 'user_id', 'status'),
        Index('ix_payments_gateway', 'gateway'),
    )
