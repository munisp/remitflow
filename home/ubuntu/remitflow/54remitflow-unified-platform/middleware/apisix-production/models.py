from sqlalchemy import Column, String, DateTime, Boolean, JSON, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.dialects.postgresql import UUID
import uuid

Base = declarative_base()

class ApisixRoute(Base):
    __tablename__ = "apisix_routes"

    # Core fields
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    description = Column(String, nullable=True)
    
    # APISIX specific fields (simplified representation)
    uri = Column(String, nullable=False, index=True)
    methods = Column(JSON, nullable=False, default=[]) # List of HTTP methods (e.g., ["GET", "POST"])
    upstream_id = Column(String, nullable=True) # ID of the associated Upstream
    plugins = Column(JSON, nullable=False, default={}) # Plugin configuration (e.g., {"limit-req": {"rate": 1, "burst": 2}})
    
    # Status and Metadata
    status = Column(Boolean, default=True) # Whether the route is enabled
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    def __repr__(self):
        return f"<ApisixRoute(id='{self.id}', name='{self.name}', uri='{self.uri}')>"