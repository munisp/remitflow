from sqlalchemy import Column, Enum, Integer, String

from database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin
from utils.enums import UserRole


class Auth(Base, SoftDeleteMixin, TimestampMixin):
    """Ties email <-> keycloak_id <-> tenant_id <-> API credentials.
    Fine-grained authorization is entirely externalized to Permify (see
    schemas/permify/v2.perm) — this table has no role/access-level column."""

    __tablename__ = "auth"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String, unique=True, nullable=False)
    user_role = Column(Enum(UserRole, name="auth_user_role"), nullable=False, default=UserRole.USER)
    keycloak_id = Column(String, unique=True, nullable=False)
    tenant_id = Column(String, nullable=False)
    api_key = Column(String, unique=True, nullable=False)
    api_secret = Column(String, unique=True, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "user_role": self.user_role.value if self.user_role else None,
            "keycloak_id": self.keycloak_id,
            "tenant_id": self.tenant_id,
            "api_key": self.api_key,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
