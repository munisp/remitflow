"""
Transaction Data Models
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, Any, Optional
from datetime import datetime


class TransactionStatus(str, Enum):
    """Transaction status enumeration"""
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TransactionType(str, Enum):
    """Transaction type enumeration"""
    PAYMENT = "payment"
    TRANSFER = "transfer"
    REFUND = "refund"
    BILL_PAYMENT = "bill_payment"


@dataclass
class Transaction:
    """Transaction model"""
    
    reference: str
    type: TransactionType
    amount: float
    currency: str
    status: TransactionStatus
    created_at: datetime
    
    customer_email: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    
    gateway_reference: Optional[str] = None
    gateway_response: Optional[Dict[str, Any]] = None
    
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    paid_at: Optional[datetime] = None
    verified_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    
    error_message: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "reference": self.reference,
            "type": self.type.value,
            "amount": self.amount,
            "currency": self.currency,
            "status": self.status.value,
            "customer_email": self.customer_email,
            "customer_name": self.customer_name,
            "customer_phone": self.customer_phone,
            "gateway_reference": self.gateway_reference,
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "paid_at": self.paid_at.isoformat() if self.paid_at else None,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "error_message": self.error_message
        }
