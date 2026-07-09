import uuid

from sqlalchemy import Column, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin
from utils.enums import FeedbackCategory, FeedbackStatus


class Feedback(Base, SoftDeleteMixin, TimestampMixin):
    __tablename__ = "feedback"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("user.id"), nullable=False)
    tenant_id = Column(String, nullable=False)
    category = Column(Enum(FeedbackCategory, name="feedback_category"), nullable=False, default=FeedbackCategory.GENERAL)
    subject = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    rating = Column(Integer, nullable=True)  # 1-5
    status = Column(Enum(FeedbackStatus, name="feedback_status"), nullable=False, default=FeedbackStatus.OPEN)
    response = Column(Text, nullable=True)
    responded_by = Column(String, nullable=True)
    responded_at = Column(String, nullable=True)

    user = relationship("User", backref="feedbacks")

    def to_dict(self):
        return {
            "id": str(self.id),
            "user_id": str(self.user_id),
            "tenant_id": self.tenant_id,
            "category": self.category.value if self.category else None,
            "subject": self.subject,
            "message": self.message,
            "rating": self.rating,
            "status": self.status.value if self.status else None,
            "response": self.response,
            "responded_by": self.responded_by,
            "responded_at": self.responded_at,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
