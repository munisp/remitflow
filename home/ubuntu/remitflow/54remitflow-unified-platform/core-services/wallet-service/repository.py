"""
Repository layer for Wallet Service
Provides database operations for wallets and transactions
"""

from sqlalchemy.orm import Session
from sqlalchemy import and_, desc
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from decimal import Decimal
import uuid

from models_db import WalletModel, WalletTransactionModel


class WalletRepository:
    """Repository for wallet operations"""
    
    @staticmethod
    def create_wallet(
        db: Session,
        wallet_id: str,
        user_id: str,
        wallet_type: str,
        currency: str,
        balance: Decimal = Decimal("0.00"),
        daily_limit: Optional[Decimal] = None,
        monthly_limit: Optional[Decimal] = None,
        is_primary: bool = False
    ) -> WalletModel:
        """Create a new wallet"""
        db_wallet = WalletModel(
            wallet_id=wallet_id,
            user_id=user_id,
            wallet_type=wallet_type,
            currency=currency,
            balance=balance,
            available_balance=balance,
            reserved_balance=Decimal("0.00"),
            status="active",
            daily_limit=daily_limit,
            monthly_limit=monthly_limit,
            is_primary=is_primary,
            metadata={}
        )
        db.add(db_wallet)
        db.commit()
        db.refresh(db_wallet)
        return db_wallet
    
    @staticmethod
    def get_wallet(db: Session, wallet_id: str) -> Optional[WalletModel]:
        """Get wallet by ID"""
        return db.query(WalletModel).filter(WalletModel.wallet_id == wallet_id).first()
    
    @staticmethod
    def get_user_wallets(db: Session, user_id: str) -> List[WalletModel]:
        """Get all wallets for a user"""
        return db.query(WalletModel).filter(WalletModel.user_id == user_id).all()
    
    @staticmethod
    def get_wallet_by_user_and_currency(
        db: Session, 
        user_id: str, 
        currency: str, 
        wallet_type: str
    ) -> Optional[WalletModel]:
        """Get wallet by user, currency, and type"""
        return db.query(WalletModel).filter(
            and_(
                WalletModel.user_id == user_id,
                WalletModel.currency == currency,
                WalletModel.wallet_type == wallet_type
            )
        ).first()
    
    @staticmethod
    def update_wallet_balance(
        db: Session,
        wallet_id: str,
        balance: Decimal,
        available_balance: Decimal,
        reserved_balance: Decimal
    ) -> Optional[WalletModel]:
        """Update wallet balances"""
        db_wallet = db.query(WalletModel).filter(WalletModel.wallet_id == wallet_id).first()
        if db_wallet:
            db_wallet.balance = balance
            db_wallet.available_balance = available_balance
            db_wallet.reserved_balance = reserved_balance
            db_wallet.updated_at = datetime.utcnow()
            db_wallet.last_transaction_at = datetime.utcnow()
            db.commit()
            db.refresh(db_wallet)
        return db_wallet
    
    @staticmethod
    def update_wallet_status(
        db: Session,
        wallet_id: str,
        status: str,
        metadata: Optional[Dict] = None
    ) -> Optional[WalletModel]:
        """Update wallet status"""
        db_wallet = db.query(WalletModel).filter(WalletModel.wallet_id == wallet_id).first()
        if db_wallet:
            db_wallet.status = status
            db_wallet.updated_at = datetime.utcnow()
            if metadata:
                current_metadata = db_wallet.metadata or {}
                current_metadata.update(metadata)
                db_wallet.metadata = current_metadata
            db.commit()
            db.refresh(db_wallet)
        return db_wallet


class WalletTransactionRepository:
    """Repository for wallet transaction operations"""
    
    @staticmethod
    def create_transaction(
        db: Session,
        transaction_id: str,
        wallet_id: str,
        transaction_type: str,
        amount: Decimal,
        currency: str,
        reference: str,
        balance_before: Decimal,
        balance_after: Decimal,
        description: Optional[str] = None,
        status: str = "completed",
        metadata: Optional[Dict] = None
    ) -> WalletTransactionModel:
        """Create a new wallet transaction"""
        db_tx = WalletTransactionModel(
            transaction_id=transaction_id,
            wallet_id=wallet_id,
            type=transaction_type,
            amount=amount,
            currency=currency,
            reference=reference,
            description=description,
            status=status,
            balance_before=balance_before,
            balance_after=balance_after,
            metadata=metadata or {},
            completed_at=datetime.utcnow() if status == "completed" else None
        )
        db.add(db_tx)
        db.commit()
        db.refresh(db_tx)
        return db_tx
    
    @staticmethod
    def get_transaction(db: Session, transaction_id: str) -> Optional[WalletTransactionModel]:
        """Get transaction by ID"""
        return db.query(WalletTransactionModel).filter(
            WalletTransactionModel.transaction_id == transaction_id
        ).first()
    
    @staticmethod
    def get_transaction_by_reference(db: Session, reference: str) -> Optional[WalletTransactionModel]:
        """Get transaction by reference"""
        return db.query(WalletTransactionModel).filter(
            WalletTransactionModel.reference == reference
        ).first()
    
    @staticmethod
    def get_wallet_transactions(
        db: Session,
        wallet_id: str,
        transaction_type: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[WalletTransactionModel]:
        """Get transactions for a wallet"""
        query = db.query(WalletTransactionModel).filter(
            WalletTransactionModel.wallet_id == wallet_id
        )
        if transaction_type:
            query = query.filter(WalletTransactionModel.type == transaction_type)
        return query.order_by(desc(WalletTransactionModel.created_at)).offset(offset).limit(limit).all()
    
    @staticmethod
    def get_daily_debit_total(db: Session, wallet_id: str) -> Decimal:
        """Get total debits for today"""
        today = datetime.utcnow().date()
        start_of_day = datetime.combine(today, datetime.min.time())
        
        transactions = db.query(WalletTransactionModel).filter(
            and_(
                WalletTransactionModel.wallet_id == wallet_id,
                WalletTransactionModel.type == "debit",
                WalletTransactionModel.created_at >= start_of_day
            )
        ).all()
        
        return sum(tx.amount for tx in transactions) if transactions else Decimal("0.00")
    
    @staticmethod
    def get_monthly_debit_total(db: Session, wallet_id: str) -> Decimal:
        """Get total debits for this month"""
        now = datetime.utcnow()
        start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        transactions = db.query(WalletTransactionModel).filter(
            and_(
                WalletTransactionModel.wallet_id == wallet_id,
                WalletTransactionModel.type == "debit",
                WalletTransactionModel.created_at >= start_of_month
            )
        ).all()
        
        return sum(tx.amount for tx in transactions) if transactions else Decimal("0.00")
    
    @staticmethod
    def count_wallet_transactions(db: Session, wallet_id: str, transaction_type: Optional[str] = None) -> int:
        """Count transactions for a wallet"""
        query = db.query(WalletTransactionModel).filter(
            WalletTransactionModel.wallet_id == wallet_id
        )
        if transaction_type:
            query = query.filter(WalletTransactionModel.type == transaction_type)
        return query.count()
