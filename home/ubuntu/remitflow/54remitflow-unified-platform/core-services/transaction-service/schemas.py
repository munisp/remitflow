"""
Database schemas for Transaction Service
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Numeric, Text, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB

from app.database import Base


class Transaction(Base):
    """Main transaction model."""
    
    __tablename__ = "transactions"
    
    # Primary Key
    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign Keys
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    sender_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    receiver_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    payment_gateway_id = Column(Integer, ForeignKey("payment_gateways.id"), nullable=True)
    
    # Transaction Details
    transaction_ref = Column(String(100), unique=True, nullable=False, index=True)
    external_ref = Column(String(100), nullable=True, index=True)
    transaction_type = Column(String(50), nullable=False, index=True)  # transfer, payment, withdrawal, deposit
    
    # Amount Fields
    amount = Column(Numeric(precision=20, scale=2), nullable=False)
    currency = Column(String(3), nullable=False, index=True)
    fee = Column(Numeric(precision=20, scale=2), default=0.00)
    total_amount = Column(Numeric(precision=20, scale=2), nullable=False)
    
    # Exchange Rate (for currency conversions)
    exchange_rate = Column(Numeric(precision=20, scale=6), nullable=True)
    destination_amount = Column(Numeric(precision=20, scale=2), nullable=True)
    destination_currency = Column(String(3), nullable=True)
    
    # Status
    status = Column(String(50), nullable=False, default="pending", index=True)
    # Status values: pending, processing, completed, failed, cancelled, refunded
    
    # Description
    description = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    
    # Metadata
    metadata = Column(JSONB, nullable=True)
    
    # Compliance
    compliance_status = Column(String(50), default="pending")
    risk_score = Column(Numeric(precision=5, scale=2), nullable=True)
    
    # Timestamps
    initiated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="transactions")
    history = relationship("TransactionHistory", back_populates="transaction", cascade="all, delete-orphan")
    metadata_records = relationship("TransactionMetadata", back_populates="transaction", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_transaction_user_status', 'user_id', 'status'),
        Index('idx_transaction_created', 'created_at'),
        Index('idx_transaction_type_status', 'transaction_type', 'status'),
        Index('idx_transaction_currency', 'currency'),
    )
    
    def __repr__(self):
        return f"<Transaction(id={self.id}, ref={self.transaction_ref}, amount={self.amount}, status={self.status})>"


class TransactionHistory(Base):
    """Transaction history and audit trail."""
    
    __tablename__ = "transaction_history"
    
    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, index=True)
    
    # Status Change
    previous_status = Column(String(50), nullable=True)
    new_status = Column(String(50), nullable=False)
    
    # Change Details
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    change_reason = Column(Text, nullable=True)
    
    # Additional Data
    metadata = Column(JSONB, nullable=True)
    
    # Timestamp
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    
    # Relationships
    transaction = relationship("Transaction", back_populates="history")
    
    def __repr__(self):
        return f"<TransactionHistory(id={self.id}, transaction_id={self.transaction_id}, status={self.new_status})>"


class TransactionMetadata(Base):
    """Extended metadata for transactions."""
    
    __tablename__ = "transaction_metadata"
    
    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, index=True)
    
    # Metadata Fields
    key = Column(String(100), nullable=False, index=True)
    value = Column(Text, nullable=True)
    value_type = Column(String(50), default="string")  # string, number, boolean, json
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    transaction = relationship("Transaction", back_populates="metadata_records")
    
    # Indexes
    __table_args__ = (
        Index('idx_transaction_metadata_key', 'transaction_id', 'key'),
    )
    
    def __repr__(self):
        return f"<TransactionMetadata(id={self.id}, key={self.key})>"
