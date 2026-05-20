from sqlalchemy import Column, Integer, String, DateTime, Boolean, func
from sqlalchemy.ext.declarative import declarative_base

# Import Base from database.py
from .database import Base

class Message(Base):
    """
    SQLAlchemy model for a message that is intended to be produced to Kafka.
    This table acts as a persistent queue or a log of production attempts.
    """
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    topic = Column(String, index=True, nullable=False, comment="The Kafka topic the message is intended for.")
    key = Column(String, index=True, nullable=True, comment="The message key for partitioning.")
    value = Column(String, nullable=False, comment="The message payload (e.g., JSON string).")
    
    # Status fields for tracking production
    status = Column(String, default="PENDING", index=True, nullable=False, comment="Status: PENDING, PRODUCED, FAILED.")
    
    # Metadata
    created_at = Column(DateTime, default=func.now(), nullable=False)
    produced_at = Column(DateTime, nullable=True, comment="Timestamp when the message was successfully produced to Kafka.")
    error_message = Column(String, nullable=True, comment="Details of the error if production failed.")

    def __repr__(self):
        return f"<Message(id={self.id}, topic='{self.topic}', status='{self.status}')>"