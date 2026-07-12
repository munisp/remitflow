from sqlalchemy import Boolean, Column, Integer, String
from sqlalchemy.orm import Mapped

from database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin

# Mirrors of the Permify v2.perm role names (schemas/permify/v2.perm). Not a
# DB constraint — access_level stores a free-form VARCHAR — just a reference
# list for validation/documentation. Authoritative validation lives in
# auth-service's RoleMapper.
PLATFORM_ROLES = [
    "super_admin",
    "tenant_manager",
    "operations_manager",
    "risk_manager",
    "internal_auditor",
    "it_admin",
    "relationship_manager",
    "compliance_officer",
    "support_agent",
]

TENANT_ROLES = [
    "super_admin",
    "branch_manager",
    "operations_manager",
    "risk_manager",
    "internal_auditor",
    "it_admin",
    "relationship_manager",
    "trade_finance_admin",
    "vault_manager",
    "treasury_manager",
    "loan_officer",
    "compliance_officer",
    "support_agent",
    "teller",
    "fraud_analyst",
]


class Admin(Base, SoftDeleteMixin, TimestampMixin):
    __tablename__ = "admin"

    id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    email = Column(String, unique=True, nullable=False)
    phone = Column(String, nullable=True)
    uin = Column(String, nullable=True)
    tenant_id = Column(String, nullable=False)
    keycloak_id = Column(String, nullable=False)
    kyc_url = Column(String, nullable=True)
    branch_id = Column(String, nullable=True)
    access_level = Column(String(100), nullable=False, default="support_agent")
    is_verified = Column(Boolean, nullable=False, default=False)
    is_suspended = Column(Boolean, nullable=False, default=False)

    def to_dict(self):
        return {
            "id": self.id,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "email": self.email,
            "phone": self.phone,
            "uin": self.uin,
            "tenant_id": self.tenant_id,
            "keycloak_id": self.keycloak_id,
            "kyc_url": self.kyc_url,
            "branch_id": self.branch_id,
            "access_level": self.access_level,
            "is_verified": self.is_verified,
            "is_suspended": self.is_suspended,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "deleted_at": self.deleted_at.isoformat() if self.deleted_at else None,
        }
