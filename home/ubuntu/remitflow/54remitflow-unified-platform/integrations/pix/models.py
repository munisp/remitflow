from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from enum import Enum as PyEnum
from .database import Base

# --- Enums ---

class PixKeyType(PyEnum):
    CPF = "CPF"
    CNPJ = "CNPJ"
    EMAIL = "EMAIL"
    PHONE = "PHONE"
    RANDOM = "RANDOM"

class PixKeyStatus(PyEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    PENDING = "PENDING"

class PixChargeStatus(PyEnum):
    PENDING = "PENDING"
    PAID = "PAID"
    EXPIRED = "EXPIRED"
    CANCELED = "CANCELED"

class PixTransactionStatus(PyEnum):
    COMPLETED = "COMPLETED"
    PENDING = "PENDING"
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"

# --- Models ---

class PixKey(Base):
    __tablename__ = "pix_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, comment="Hypothetical ID of the user/account owner")
    key_type = Column(Enum(PixKeyType), nullable=False)
    key_value = Column(String, unique=True, index=True, nullable=False)
    status = Column(Enum(PixKeyStatus), default=PixKeyStatus.ACTIVE, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    charges = relationship("PixCharge", back_populates="recipient_key")
    transactions = relationship("PixTransaction", foreign_keys="[PixTransaction.recipient_key_id]", back_populates="recipient_key")

    def __repr__(self):
        return f"<PixKey(key_type='{self.key_type.value}', key_value='{self.key_value}')>"

class PixCharge(Base):
    __tablename__ = "pix_charges"

    id = Column(Integer, primary_key=True, index=True)
    recipient_key_id = Column(Integer, ForeignKey("pix_keys.id"), nullable=False)
    amount = Column(Float, nullable=False)
    description = Column(String, index=True)
    status = Column(Enum(PixChargeStatus), default=PixChargeStatus.PENDING, nullable=False)
    qr_code_payload = Column(String, comment="The BR Code payload for the QR code")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    recipient_key = relationship("PixKey", back_populates="charges")
    transaction = relationship("PixTransaction", back_populates="charge", uselist=False)

    def __repr__(self):
        return f"<PixCharge(id={self.id}, amount={self.amount}, status='{self.status.value}')>"

class PixTransaction(Base):
    __tablename__ = "pix_transactions"

    id = Column(Integer, primary_key=True, index=True)
    charge_id = Column(Integer, ForeignKey("pix_charges.id"), unique=True, nullable=True, comment="Optional: Link to a charge/payment request")
    sender_info = Column(String, nullable=False, comment="Sender's name/account info (mocked)")
    recipient_key_id = Column(Integer, ForeignKey("pix_keys.id"), nullable=False)
    amount = Column(Float, nullable=False)
    transaction_id = Column(String, unique=True, index=True, nullable=False, comment="External PIX transaction ID")
    status = Column(Enum(PixTransactionStatus), default=PixTransactionStatus.PENDING, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    charge = relationship("PixCharge", back_populates="transaction")
    recipient_key = relationship("PixKey", foreign_keys=[recipient_key_id], back_populates="transactions")

    def __repr__(self):
        return f"<PixTransaction(id={self.id}, amount={self.amount}, status='{self.status.value}')>"
