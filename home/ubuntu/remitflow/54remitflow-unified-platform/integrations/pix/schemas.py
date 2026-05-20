from pydantic import BaseModel, Field, EmailStr, validator
from typing import Optional
from datetime import datetime
from .models import PixKeyType, PixKeyStatus, PixChargeStatus, PixTransactionStatus

# --- Base Schemas ---

class PixKeyBase(BaseModel):
    key_type: PixKeyType = Field(..., description="Type of the PIX key (CPF, CNPJ, EMAIL, PHONE, RANDOM)")
    key_value: str = Field(..., description="The actual value of the PIX key")

class PixChargeBase(BaseModel):
    amount: float = Field(..., gt=0, description="Amount of the charge in BRL")
    description: Optional[str] = Field(None, max_length=140, description="Description for the charge")
    expires_in_seconds: int = Field(3600, gt=0, description="Time in seconds until the charge expires (default 1 hour)")

class PixTransactionBase(BaseModel):
    sender_info: str = Field(..., description="Sender's identification information (e.g., name, account)")
    amount: float = Field(..., gt=0, description="Amount of the transaction in BRL")
    transaction_id: str = Field(..., description="External PIX transaction ID from the central system")

# --- Request Schemas ---

class PixKeyCreate(PixKeyBase):
    user_id: int = Field(..., description="ID of the user/account owner")

class PixChargeCreate(PixChargeBase):
    recipient_key_value: str = Field(..., description="The PIX key of the recipient")

class PixTransactionReceive(PixTransactionBase):
    recipient_key_value: str = Field(..., description="The PIX key that received the transaction")
    charge_id: Optional[int] = Field(None, description="Optional ID of the charge this transaction fulfills")

# --- Response Schemas ---

class PixKeyResponse(PixKeyBase):
    id: int
    user_id: int
    status: PixKeyStatus
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True

class PixChargeResponse(PixChargeBase):
    id: int
    recipient_key_id: int
    status: PixChargeStatus
    qr_code_payload: str
    expires_at: datetime
    created_at: datetime
    updated_at: Optional[datetime]

    # Override amount field for response to not include expires_in_seconds
    amount: float = Field(..., description="Amount of the charge in BRL")
    description: Optional[str] = Field(None, max_length=140, description="Description for the charge")

    class Config:
        from_attributes = True
        # Exclude expires_in_seconds from the response model
        fields = {'expires_in_seconds': {'exclude': True}}

class PixTransactionResponse(PixTransactionBase):
    id: int
    recipient_key_id: int
    status: PixTransactionStatus
    completed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True

# --- Utility Schemas ---

class MessageResponse(BaseModel):
    message: str
