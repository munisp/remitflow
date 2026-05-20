"""
Transaction Models
Database models for Paystack transactions
"""

from enum import Enum
from datetime import datetime
from typing import Dict, Any, Optional
from dataclasses import dataclass, field


class TransactionStatus(str, Enum):
    """Transaction status enum"""
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"
    ABANDONED = "abandoned"
    REFUNDED = "refunded"


@dataclass
class Transaction:
    """
    Transaction model
    
    Represents a Paystack payment transaction
    """
    reference: str
    email: str
    amount_kobo: int
    amount_ngn: float
    status: TransactionStatus
    authorization_url: str
    access_code: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)
    verified_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    paystack_response: Optional[Dict[str, Any]] = None
    customer_code: Optional[str] = None
    authorization_code: Optional[str] = None
    channel: Optional[str] = None
    currency: str = "NGN"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "reference": self.reference,
            "email": self.email,
            "amount_kobo": self.amount_kobo,
            "amount_ngn": self.amount_ngn,
            "status": self.status.value,
            "authorization_url": self.authorization_url,
            "access_code": self.access_code,
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "paid_at": self.paid_at.isoformat() if self.paid_at else None,
            "customer_code": self.customer_code,
            "authorization_code": self.authorization_code,
            "channel": self.channel,
            "currency": self.currency
        }
    
    @property
    def is_successful(self) -> bool:
        """Check if transaction is successful"""
        return self.status == TransactionStatus.SUCCESS
    
    @property
    def is_pending(self) -> bool:
        """Check if transaction is pending"""
        return self.status == TransactionStatus.PENDING
    
    @property
    def is_failed(self) -> bool:
        """Check if transaction is failed"""
        return self.status == TransactionStatus.FAILED


@dataclass
class Refund:
    """
    Refund model
    
    Represents a Paystack refund
    """
    transaction_reference: str
    amount_kobo: int
    amount_ngn: float
    status: str
    refund_id: Optional[int] = None
    customer_note: Optional[str] = None
    merchant_note: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
    currency: str = "NGN"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "transaction_reference": self.transaction_reference,
            "amount_kobo": self.amount_kobo,
            "amount_ngn": self.amount_ngn,
            "status": self.status,
            "refund_id": self.refund_id,
            "customer_note": self.customer_note,
            "merchant_note": self.merchant_note,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "processed_at": self.processed_at.isoformat() if self.processed_at else None,
            "currency": self.currency
        }


@dataclass
class Transfer:
    """
    Transfer model
    
    Represents a Paystack transfer
    """
    reference: str
    recipient_code: str
    amount_kobo: int
    amount_ngn: float
    reason: str
    status: str
    transfer_code: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    currency: str = "NGN"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "reference": self.reference,
            "recipient_code": self.recipient_code,
            "amount_kobo": self.amount_kobo,
            "amount_ngn": self.amount_ngn,
            "reason": self.reason,
            "status": self.status,
            "transfer_code": self.transfer_code,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "currency": self.currency
        }
