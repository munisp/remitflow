from database import Base
from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint, Index
from datetime import datetime

class RelationalTuple(Base):
    __tablename__ = "relational_tuples"
    
    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String, index=True, nullable=False)
    entity_id = Column(String, index=True, nullable=False)
    relation = Column(String, index=True, nullable=False)
    subject_type = Column(String, index=True, nullable=False)
    subject_id = Column(String, index=True, nullable=False)
    subject_relation = Column(String, default="", index=True) # For user sets like organization#member
    
    # Audit fields
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        # Unique constraint for the core tuple structure: entity#relation@subject
        UniqueConstraint(
            'entity_type', 'entity_id', 'relation', 
            'subject_type', 'subject_id', 'subject_relation', 
            name='uq_relational_tuple'
        ),
        # Additional indexes for common lookups
        Index('ix_entity_lookup', 'entity_type', 'entity_id'),
        Index('ix_subject_lookup', 'subject_type', 'subject_id'),
    )

    def __repr__(self):
        return f"<RelationalTuple {self.entity_type}:{self.entity_id}#{self.relation}@{self.subject_type}:{self.subject_id}#{self.subject_relation}>"

class Attribute(Base):
    __tablename__ = "attributes"
    
    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String, index=True, nullable=False)
    entity_id = Column(String, index=True, nullable=False)
    attribute_name = Column(String, index=True, nullable=False)
    attribute_value = Column(String, nullable=False) # Storing as string, conversion handled in service
    attribute_type = Column(String, nullable=False) # e.g., 'double', 'boolean', 'string', 'string[]'
    
    # Audit fields
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        # Unique constraint for the core attribute structure: entity$attribute_name
        UniqueConstraint(
            'entity_type', 'entity_id', 'attribute_name', 
            name='uq_attribute'
        ),
    )

    def __repr__(self):
        return f"<Attribute {self.entity_type}:{self.entity_id}${self.attribute_name}|{self.attribute_type}:{self.attribute_value}>"