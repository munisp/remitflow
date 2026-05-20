"""
SQLAlchemy ORM models for Wallet Service
Provides persistent storage for wallets and transactions
"""

from sqlalchemy import Column, String, Numeric, DateTime, Boolean, Enum, JSON, ForeignKey, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

Base = declarative_base()


class WalletTypeEnum(str, enum.Enum):
    PERSONAL = "personal"
    BUSINESS = "business"
    SAVINGS = "savings"
    INVESTMENT = "investment"


class WalletStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    FROZEN = "frozen"
    SUSPENDED = "suspended"
    CLOSED = "closed"


class TransactionTypeEnum(str, enum.Enum):
    CREDIT = "credit"
    DEBIT = "debit"
    RESERVE = "reserve"
    RELEASE = "release"
    TRANSFER_IN = "transfer_in"
    TRANSFER_OUT = "transfer_out"


class TransactionStatusEnum(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REVERSED = "reversed"


class WalletModel(Base):
    """Wallet database model"""
    __tablename__ = "wallets"
    
    wallet_id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    wallet_type = Column(String(20), nullable=False)
    currency = Column(String(3), nullable=False)
    balance = Column(Numeric(20, 2), nullable=False, default=0)
    available_balance = Column(Numeric(20, 2), nullable=False, default=0)
    reserved_balance = Column(Numeric(20, 2), nullable=False, default=0)
    status = Column(String(20), nullable=False, default="active")
    daily_limit = Column(Numeric(20, 2), nullable=True)
    monthly_limit = Column(Numeric(20, 2), nullable=True)
    is_primary = Column(Boolean, default=False)
    metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True, onupdate=datetime.utcnow)
    last_transaction_at = Column(DateTime, nullable=True)
    
    # Relationships
    transactions = relationship("WalletTransactionModel", back_populates="wallet")
    
    # Indexes
    __table_args__ = (
        Index('ix_wallets_user_currency', 'user_id', 'currency'),
        Index('ix_wallets_status', 'status'),
    )


class WalletTransactionModel(Base):
    """Wallet transaction database model"""
    __tablename__ = "wallet_transactions"
    
    transaction_id = Column(String(36), primary_key=True)
    wallet_id = Column(String(36), ForeignKey("wallets.wallet_id"), nullable=False, index=True)
    type = Column(String(20), nullable=False)
    amount = Column(Numeric(20, 2), nullable=False)
    currency = Column(String(3), nullable=False)
    reference = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    balance_before = Column(Numeric(20, 2), nullable=False)
    balance_after = Column(Numeric(20, 2), nullable=False)
    metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    wallet = relationship("WalletModel", back_populates="transactions")
    
    # Indexes
    __table_args__ = (
        Index('ix_wallet_transactions_wallet_created', 'wallet_id', 'created_at'),
        Index('ix_wallet_transactions_type', 'type'),
    )
