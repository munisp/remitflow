from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
from .database import Base

# Base = declarative_base() # Already imported from .database

class WAFPolicy(Base):
    __tablename__ = "waf_policies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, nullable=True)
    
    # Core Policy Settings
    mode = Column(String, default="detect-learn", nullable=False) # e.g., "prevent-learn", "detect-learn"
    
    # Nested configurations stored as JSON for flexibility
    # In a real-world scenario, these would be separate tables with relationships
    default_practices = Column(JSON, nullable=False, default=[]) # List of practice names
    specific_rules = Column(JSON, nullable=False, default=[]) # List of specific rule objects
    
    # Metadata
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Example of a specific rule structure (for documentation purposes, not a model field)
    # specific_rules = [
    #     {
    #         "host": "web.server.com/example",
    #         "mode": "prevent-learn",
    #         "practices": ["webapp-best-practice"],
    #         "custom_response": "appsec-web-user-response-example"
    #     }
    # ]

    def __repr__(self):
        return f"<WAFPolicy(name='{self.name}', mode='{self.mode}')>"