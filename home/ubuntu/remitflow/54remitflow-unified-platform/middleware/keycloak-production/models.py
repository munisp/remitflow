from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import uuid

Base = declarative_base()

class KeycloakClientConfig(Base):
    __tablename__ = "keycloak_client_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    client_id = Column(String, unique=True, nullable=False, index=True, comment="The Keycloak client_id this config relates to")
    realm_name = Column(String, nullable=False, default="master", comment="The Keycloak realm name")
    is_active = Column(Boolean, default=True, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationship to ProtectedResource
    protected_resources = relationship("ProtectedResource", back_populates="client_config", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<KeycloakClientConfig(client_id='{self.client_id}', realm='{self.realm_name}')>"

class ProtectedResource(Base):
    __tablename__ = "protected_resources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    client_config_id = Column(UUID(as_uuid=True), ForeignKey("keycloak_client_configs.id"), nullable=False)
    resource_name = Column(String, nullable=False, index=True, comment="The name of the protected resource (e.g., /api/v1/users)")
    resource_type = Column(String, nullable=False, default="API_ENDPOINT", comment="Type of resource (e.g., API_ENDPOINT, DOCUMENT, SERVICE)")
    required_scope = Column(String, nullable=False, comment="The Keycloak scope required to access this resource")
    is_enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationship to KeycloakClientConfig
    client_config = relationship("KeycloakClientConfig", back_populates="protected_resources")

    __table_args__ = (
        # Ensure a client cannot have two resources with the same name
        {"unique_constraint": ("client_config_id", "resource_name")},
    )

    def __repr__(self):
        return f"<ProtectedResource(name='{self.resource_name}', scope='{self.required_scope}')>"