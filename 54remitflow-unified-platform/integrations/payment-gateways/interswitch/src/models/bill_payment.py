"""
Bill Payment Data Models
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, Any, Optional
from datetime import datetime


class BillPaymentStatus(str, Enum):
    """Bill payment status enumeration"""
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"


@dataclass
class BillPayment:
    """Bill payment model"""
    
    reference: str
    biller_id: str
    customer_id: str
    amount: float
    status: BillPaymentStatus
    created_at: datetime
    
    payment_code: Optional[str] = None
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None
    
    gateway_response: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "reference": self.reference,
            "biller_id": self.biller_id,
            "customer_id": self.customer_id,
            "amount": self.amount,
            "status": self.status.value,
            "payment_code": self.payment_code,
            "customer_email": self.customer_email,
            "customer_phone": self.customer_phone,
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error_message": self.error_message
        }
