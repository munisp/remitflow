"""
Repository layer for Payment Service
Provides database operations for payments
"""

from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional, Dict, Any
from datetime import datetime
from decimal import Decimal

from models_db import PaymentModel


class PaymentRepository:
    """Repository for payment operations"""
    
    @staticmethod
    def create_payment(
        db: Session,
        payment_id: str,
        user_id: str,
        amount: Decimal,
        currency: str,
        method: str,
        gateway: str,
        payer_name: str,
        payer_email: str,
        payee_name: str,
        payee_account: str,
        reference: str,
        fee_amount: Decimal,
        total_amount: Decimal,
        payer_phone: Optional[str] = None,
        payee_bank: Optional[str] = None,
        description: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> PaymentModel:
        """Create a new payment"""
        db_payment = PaymentModel(
            payment_id=payment_id,
            user_id=user_id,
            amount=amount,
            currency=currency,
            method=method,
            gateway=gateway,
            payer_name=payer_name,
            payer_email=payer_email,
            payer_phone=payer_phone,
            payee_name=payee_name,
            payee_account=payee_account,
            payee_bank=payee_bank,
            reference=reference,
            description=description,
            metadata=metadata or {},
            status="pending",
            fee_amount=fee_amount,
            total_amount=total_amount
        )
        db.add(db_payment)
        db.commit()
        db.refresh(db_payment)
        return db_payment
    
    @staticmethod
    def get_payment(db: Session, payment_id: str) -> Optional[PaymentModel]:
        """Get payment by ID"""
        return db.query(PaymentModel).filter(PaymentModel.payment_id == payment_id).first()
    
    @staticmethod
    def get_payment_by_reference(db: Session, reference: str) -> Optional[PaymentModel]:
        """Get payment by reference"""
        return db.query(PaymentModel).filter(PaymentModel.reference == reference).first()
    
    @staticmethod
    def get_user_payments(
        db: Session,
        user_id: str,
        status: Optional[str] = None,
        limit: int = 50
    ) -> List[PaymentModel]:
        """Get payments for a user"""
        query = db.query(PaymentModel).filter(PaymentModel.user_id == user_id)
        if status:
            query = query.filter(PaymentModel.status == status)
        return query.order_by(desc(PaymentModel.created_at)).limit(limit).all()
    
    @staticmethod
    def update_payment_status(
        db: Session,
        payment_id: str,
        status: str,
        gateway_reference: Optional[str] = None,
        gateway_response: Optional[Dict] = None,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None
    ) -> Optional[PaymentModel]:
        """Update payment status"""
        db_payment = db.query(PaymentModel).filter(PaymentModel.payment_id == payment_id).first()
        if db_payment:
            db_payment.status = status
            if gateway_reference:
                db_payment.gateway_reference = gateway_reference
            if gateway_response:
                db_payment.gateway_response = gateway_response
            if error_code:
                db_payment.error_code = error_code
            if error_message:
                db_payment.error_message = error_message
            
            if status == "processing":
                db_payment.processed_at = datetime.utcnow()
            elif status == "completed":
                db_payment.completed_at = datetime.utcnow()
            
            db.commit()
            db.refresh(db_payment)
        return db_payment
    
    @staticmethod
    def increment_retry_count(db: Session, payment_id: str) -> Optional[PaymentModel]:
        """Increment retry count for a payment"""
        db_payment = db.query(PaymentModel).filter(PaymentModel.payment_id == payment_id).first()
        if db_payment:
            db_payment.retry_count += 1
            db.commit()
            db.refresh(db_payment)
        return db_payment
