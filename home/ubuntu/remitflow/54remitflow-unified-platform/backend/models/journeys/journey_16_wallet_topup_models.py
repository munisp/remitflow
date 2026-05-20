"""
Wallet Top-up Database Models
Journey: journey_16_wallet_topup
SQLAlchemy ORM Models
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Float, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database import Base


class WalletTopup(Base):
    __tablename__ = "wallettopups"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    status = Column(String(50), default="pending")
    metadata = Column(JSON)
    
    # Relationships
    user = relationship("User", back_populates="wallettopups")
    
    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "status": self.status,
            "metadata": self.metadata
        }
