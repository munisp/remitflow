import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.schema import UniqueConstraint

Base = declarative_base()

class DaprComponent(Base):
    __tablename__ = "dapr_components"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    component_type = Column(String, index=True, nullable=False) # e.g., state.redis, pubsub.kafka
    version = Column(String, default="v1", nullable=False)
    scope = Column(Text, nullable=True) # JSON string for application scoping
    is_production = Column(Boolean, default=False, index=True, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    metadata_items = relationship("DaprComponentMetadata", back_populates="component", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<DaprComponent(name='{self.name}', type='{self.component_type}')>"

class DaprComponentMetadata(Base):
    __tablename__ = "dapr_component_metadata"

    id = Column(Integer, primary_key=True, index=True)
    component_id = Column(Integer, ForeignKey("dapr_components.id"), nullable=False)
    key = Column(String, nullable=False)
    value = Column(Text, nullable=False)
    secret_ref = Column(String, nullable=True) # Optional reference to a secret store

    component = relationship("DaprComponent", back_populates="metadata_items")

    __table_args__ = (
        UniqueConstraint('component_id', 'key', name='_component_key_uc'),
    )

    def __repr__(self):
        return f"<DaprComponentMetadata(key='{self.key}', component_id='{self.component_id}')>"