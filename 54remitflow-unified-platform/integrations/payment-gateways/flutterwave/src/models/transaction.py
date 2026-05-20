"""
Transaction Data Models
"""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Dict, Any
from datetime import datetime


class PaymentInitRequest(BaseModel):
    """Payment initialization request"""
    amount: float = Field(..., gt=0, description="Amount to charge")
    customer_email: EmailStr = Field(..., description="Customer email")
    customer_name: str = Field(..., min_length=1, description="Customer name")
    customer_phone: Optional[str] = Field(None, description="Customer phone number")
    currency: str = Field(default="NGN", description="Currency code")
    redirect_url: Optional[str] = Field(None, description="Redirect URL after payment")
    payment_options: Optional[str] = Field(None, description="Payment methods")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional metadata")


class PaymentInitResponse(BaseModel):
    """Payment initialization response"""
    reference: str
    payment_url: str
    amount: float
    currency: str
    status: str


class PaymentVerifyResponse(BaseModel):
    """Payment verification response"""
    transaction_id: int
    reference: str
    amount: float
    currency: str
    status: str
    customer_email: str
    payment_type: Optional[str] = None
    charged_amount: Optional[float] = None
    app_fee: Optional[float] = None
    merchant_fee: Optional[float] = None
    processor_response: Optional[str] = None
    created_at: Optional[str] = None


class TransferRequest(BaseModel):
    """Transfer request"""
    account_number: str = Field(..., min_length=10, max_length=10, description="Account number")
    account_bank: str = Field(..., description="Bank code")
    amount: float = Field(..., gt=0, description="Amount to transfer")
    narration: str = Field(..., min_length=1, max_length=100, description="Transfer narration")
    currency: str = Field(default="NGN", description="Currency code")
    beneficiary_name: Optional[str] = Field(None, description="Beneficiary name")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional metadata")


class TransferResponse(BaseModel):
    """Transfer response"""
    reference: str
    transfer_id: int
    account_number: str
    bank_name: str
    amount: float
    currency: str
    status: str
    fee: Optional[float] = None
    created_at: Optional[str] = None


class VirtualAccountRequest(BaseModel):
    """Virtual account creation request"""
    email: EmailStr = Field(..., description="Customer email")
    bvn: str = Field(..., min_length=11, max_length=11, description="Bank Verification Number")
    tx_ref: Optional[str] = Field(None, description="Transaction reference")
    firstname: Optional[str] = Field(None, description="First name")
    lastname: Optional[str] = Field(None, description="Last name")
    phonenumber: Optional[str] = Field(None, description="Phone number")
    narration: Optional[str] = Field(None, description="Account narration")


class VirtualAccountResponse(BaseModel):
    """Virtual account response"""
    reference: str
    account_number: str
    bank_name: str
    account_reference: str
    amount: Optional[float] = None
    status: str
    created_at: Optional[str] = None


class BankInfo(BaseModel):
    """Bank information"""
    id: int
    code: str
    name: str


class AccountResolveRequest(BaseModel):
    """Account resolution request"""
    account_number: str = Field(..., min_length=10, max_length=10, description="Account number")
    account_bank: str = Field(..., description="Bank code")


class AccountResolveResponse(BaseModel):
    """Account resolution response"""
    account_number: str
    account_name: str
    bank_code: str
