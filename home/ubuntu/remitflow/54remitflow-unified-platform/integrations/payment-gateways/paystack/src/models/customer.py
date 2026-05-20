"""
Customer Models
Database models for Paystack customers
"""

from datetime import datetime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field


@dataclass
class Customer:
    """
    Customer model
    
    Represents a Paystack customer
    """
    email: str
    customer_code: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "email": self.email,
            "customer_code": self.customer_code,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "phone": self.phone,
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
    
    @property
    def full_name(self) -> str:
        """Get customer full name"""
        if self.first_name and self.last_name:
            return f"{self.first_name} {self.last_name}"
        return self.first_name or self.last_name or self.email


@dataclass
class Authorization:
    """
    Authorization model
    
    Represents a saved card authorization
    """
    authorization_code: str
    bin: str
    last4: str
    exp_month: str
    exp_year: str
    channel: str
    card_type: str
    bank: str
    country_code: str
    brand: str
    reusable: bool
    customer_email: str
    created_at: datetime = field(default_factory=datetime.utcnow)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "authorization_code": self.authorization_code,
            "bin": self.bin,
            "last4": self.last4,
            "exp_month": self.exp_month,
            "exp_year": self.exp_year,
            "channel": self.channel,
            "card_type": self.card_type,
            "bank": self.bank,
            "country_code": self.country_code,
            "brand": self.brand,
            "reusable": self.reusable,
            "customer_email": self.customer_email,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
    
    @property
    def masked_pan(self) -> str:
        """Get masked PAN"""
        return f"{self.bin}******{self.last4}"
    
    @property
    def expiry(self) -> str:
        """Get card expiry"""
        return f"{self.exp_month}/{self.exp_year}"
