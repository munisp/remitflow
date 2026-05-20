"""
Repository layer for Savings Service
Provides database operations for savings products, accounts, goals, and transactions
"""

from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional, Dict
from datetime import datetime
from decimal import Decimal

from models_db import (
    SavingsProductModel, SavingsAccountModel, 
    SavingsGoalModel, SavingsTransactionModel, AutoSaveRuleModel
)


class SavingsProductRepository:
    """Repository for savings product operations"""
    
    @staticmethod
    def create_product(
        db: Session,
        product_id: str,
        name: str,
        product_type: str,
        currency: str,
        interest_rate: Decimal,
        interest_frequency: str,
        description: Optional[str] = None,
        min_balance: Decimal = Decimal("0"),
        max_balance: Optional[Decimal] = None,
        lock_period_days: Optional[int] = None,
        early_withdrawal_penalty: Optional[Decimal] = None
    ) -> SavingsProductModel:
        """Create a new savings product"""
        db_product = SavingsProductModel(
            product_id=product_id,
            name=name,
            description=description,
            product_type=product_type,
            currency=currency,
            min_balance=min_balance,
            max_balance=max_balance,
            interest_rate=interest_rate,
            interest_frequency=interest_frequency,
            lock_period_days=lock_period_days,
            early_withdrawal_penalty=early_withdrawal_penalty
        )
        db.add(db_product)
        db.commit()
        db.refresh(db_product)
        return db_product
    
    @staticmethod
    def get_product(db: Session, product_id: str) -> Optional[SavingsProductModel]:
        """Get product by ID"""
        return db.query(SavingsProductModel).filter(SavingsProductModel.product_id == product_id).first()
    
    @staticmethod
    def get_active_products(db: Session) -> List[SavingsProductModel]:
        """Get all active products"""
        return db.query(SavingsProductModel).filter(SavingsProductModel.is_active.is_(True)).all()


class SavingsAccountRepository:
    """Repository for savings account operations"""
    
    @staticmethod
    def create_account(
        db: Session,
        account_id: str,
        user_id: str,
        product_id: str,
        account_number: str,
        maturity_date: Optional[datetime] = None
    ) -> SavingsAccountModel:
        """Create a new savings account"""
        db_account = SavingsAccountModel(
            account_id=account_id,
            user_id=user_id,
            product_id=product_id,
            account_number=account_number,
            balance=Decimal("0"),
            accrued_interest=Decimal("0"),
            total_interest_earned=Decimal("0"),
            status="active",
            maturity_date=maturity_date
        )
        db.add(db_account)
        db.commit()
        db.refresh(db_account)
        return db_account
    
    @staticmethod
    def get_account(db: Session, account_id: str) -> Optional[SavingsAccountModel]:
        """Get account by ID"""
        return db.query(SavingsAccountModel).filter(SavingsAccountModel.account_id == account_id).first()
    
    @staticmethod
    def get_user_accounts(db: Session, user_id: str) -> List[SavingsAccountModel]:
        """Get all accounts for a user"""
        return db.query(SavingsAccountModel).filter(SavingsAccountModel.user_id == user_id).all()
    
    @staticmethod
    def update_balance(
        db: Session,
        account_id: str,
        balance: Decimal,
        accrued_interest: Optional[Decimal] = None
    ) -> Optional[SavingsAccountModel]:
        """Update account balance"""
        db_account = db.query(SavingsAccountModel).filter(SavingsAccountModel.account_id == account_id).first()
        if db_account:
            db_account.balance = balance
            if accrued_interest is not None:
                db_account.accrued_interest = accrued_interest
            db_account.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(db_account)
        return db_account


class SavingsGoalRepository:
    """Repository for savings goal operations"""
    
    @staticmethod
    def create_goal(
        db: Session,
        goal_id: str,
        user_id: str,
        account_id: str,
        name: str,
        target_amount: Decimal,
        target_date: Optional[datetime] = None,
        auto_save_enabled: bool = False,
        auto_save_amount: Optional[Decimal] = None,
        auto_save_frequency: Optional[str] = None
    ) -> SavingsGoalModel:
        """Create a new savings goal"""
        db_goal = SavingsGoalModel(
            goal_id=goal_id,
            user_id=user_id,
            account_id=account_id,
            name=name,
            target_amount=target_amount,
            current_amount=Decimal("0"),
            target_date=target_date,
            status="active",
            auto_save_enabled=auto_save_enabled,
            auto_save_amount=auto_save_amount,
            auto_save_frequency=auto_save_frequency
        )
        db.add(db_goal)
        db.commit()
        db.refresh(db_goal)
        return db_goal
    
    @staticmethod
    def get_goal(db: Session, goal_id: str) -> Optional[SavingsGoalModel]:
        """Get goal by ID"""
        return db.query(SavingsGoalModel).filter(SavingsGoalModel.goal_id == goal_id).first()
    
    @staticmethod
    def get_user_goals(db: Session, user_id: str) -> List[SavingsGoalModel]:
        """Get all goals for a user"""
        return db.query(SavingsGoalModel).filter(SavingsGoalModel.user_id == user_id).all()
    
    @staticmethod
    def update_goal_progress(
        db: Session,
        goal_id: str,
        current_amount: Decimal
    ) -> Optional[SavingsGoalModel]:
        """Update goal progress"""
        db_goal = db.query(SavingsGoalModel).filter(SavingsGoalModel.goal_id == goal_id).first()
        if db_goal:
            db_goal.current_amount = current_amount
            if current_amount >= db_goal.target_amount:
                db_goal.status = "completed"
            db_goal.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(db_goal)
        return db_goal


class SavingsTransactionRepository:
    """Repository for savings transaction operations"""
    
    @staticmethod
    def create_transaction(
        db: Session,
        transaction_id: str,
        account_id: str,
        transaction_type: str,
        amount: Decimal,
        balance_before: Decimal,
        balance_after: Decimal,
        reference: str,
        description: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> SavingsTransactionModel:
        """Create a new savings transaction"""
        db_tx = SavingsTransactionModel(
            transaction_id=transaction_id,
            account_id=account_id,
            type=transaction_type,
            amount=amount,
            balance_before=balance_before,
            balance_after=balance_after,
            reference=reference,
            description=description,
            status="completed",
            metadata=metadata or {}
        )
        db.add(db_tx)
        db.commit()
        db.refresh(db_tx)
        return db_tx
    
    @staticmethod
    def get_account_transactions(
        db: Session,
        account_id: str,
        limit: int = 50
    ) -> List[SavingsTransactionModel]:
        """Get transactions for an account"""
        return db.query(SavingsTransactionModel).filter(
            SavingsTransactionModel.account_id == account_id
        ).order_by(desc(SavingsTransactionModel.created_at)).limit(limit).all()
