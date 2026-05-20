"""
SQLAlchemy ORM models for Savings Service
Provides persistent storage for savings products, accounts, goals, and transactions
"""

from sqlalchemy import Column, String, Numeric, DateTime, Boolean, JSON, Index, Integer, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()


class SavingsProductModel(Base):
    """Savings product database model"""
    __tablename__ = "savings_products"
    
    product_id = Column(String(36), primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(String(1000), nullable=True)
    product_type = Column(String(50), nullable=False)  # fixed, flexible, target
    currency = Column(String(3), nullable=False)
    min_balance = Column(Numeric(20, 2), nullable=False, default=0)
    max_balance = Column(Numeric(20, 2), nullable=True)
    interest_rate = Column(Numeric(10, 4), nullable=False)
    interest_frequency = Column(String(20), nullable=False)  # daily, monthly, yearly
    lock_period_days = Column(Integer, nullable=True)
    early_withdrawal_penalty = Column(Numeric(10, 4), nullable=True)
    is_active = Column(Boolean, default=True)
    metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True, onupdate=datetime.utcnow)


class SavingsAccountModel(Base):
    """Savings account database model"""
    __tablename__ = "savings_accounts"
    
    account_id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    product_id = Column(String(36), ForeignKey("savings_products.product_id"), nullable=False)
    account_number = Column(String(20), nullable=False, unique=True, index=True)
    balance = Column(Numeric(20, 2), nullable=False, default=0)
    accrued_interest = Column(Numeric(20, 2), nullable=False, default=0)
    total_interest_earned = Column(Numeric(20, 2), nullable=False, default=0)
    status = Column(String(20), nullable=False, default="active")
    maturity_date = Column(DateTime, nullable=True)
    last_interest_date = Column(DateTime, nullable=True)
    metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index('ix_savings_accounts_user_product', 'user_id', 'product_id'),
    )


class SavingsGoalModel(Base):
    """Savings goal database model"""
    __tablename__ = "savings_goals"
    
    goal_id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    account_id = Column(String(36), ForeignKey("savings_accounts.account_id"), nullable=False)
    name = Column(String(200), nullable=False)
    target_amount = Column(Numeric(20, 2), nullable=False)
    current_amount = Column(Numeric(20, 2), nullable=False, default=0)
    target_date = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default="active")
    auto_save_enabled = Column(Boolean, default=False)
    auto_save_amount = Column(Numeric(20, 2), nullable=True)
    auto_save_frequency = Column(String(20), nullable=True)
    metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True, onupdate=datetime.utcnow)


class SavingsTransactionModel(Base):
    """Savings transaction database model"""
    __tablename__ = "savings_transactions"
    
    transaction_id = Column(String(36), primary_key=True)
    account_id = Column(String(36), ForeignKey("savings_accounts.account_id"), nullable=False, index=True)
    type = Column(String(20), nullable=False)  # deposit, withdrawal, interest, penalty
    amount = Column(Numeric(20, 2), nullable=False)
    balance_before = Column(Numeric(20, 2), nullable=False)
    balance_after = Column(Numeric(20, 2), nullable=False)
    reference = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, default="completed")
    metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    __table_args__ = (
        Index('ix_savings_transactions_account_created', 'account_id', 'created_at'),
    )


class AutoSaveRuleModel(Base):
    """Auto-save rule database model"""
    __tablename__ = "auto_save_rules"
    
    rule_id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False, index=True)
    account_id = Column(String(36), ForeignKey("savings_accounts.account_id"), nullable=False)
    goal_id = Column(String(36), ForeignKey("savings_goals.goal_id"), nullable=True)
    source_wallet_id = Column(String(36), nullable=False)
    amount = Column(Numeric(20, 2), nullable=False)
    frequency = Column(String(20), nullable=False)  # daily, weekly, monthly
    next_execution = Column(DateTime, nullable=False)
    is_active = Column(Boolean, default=True)
    metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=True, onupdate=datetime.utcnow)
