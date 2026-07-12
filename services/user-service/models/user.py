import uuid

from sqlalchemy import CheckConstraint, Boolean, Column, Enum, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from database import Base
from models.mixins import SoftDeleteMixin, TimestampMixin
from utils.enums import KycVerificationStatus, UserRole, UserStatus


class User(Base, SoftDeleteMixin, TimestampMixin):
    __tablename__ = "user"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    name = Column(String, nullable=False)  # denormalized "first + last" set at creation time
    uin = Column(String, nullable=True)
    email = Column(String, unique=True, nullable=False)
    phone_number = Column(String, unique=True, nullable=True)
    keycloak_id = Column(String, nullable=False)
    tenant_id = Column(String, nullable=False)
    user_role = Column(Enum(UserRole, name="user_role"), nullable=False, default=UserRole.USER)
    status = Column(Enum(UserStatus, name="user_status"), nullable=False, default=UserStatus.ACTIVE)
    kyc_verification_status = Column(
        Enum(KycVerificationStatus, name="kyc_verification_status"),
        nullable=True,
        default=KycVerificationStatus.NOT_VERIFIED,
    )
    kyc_verification_url = Column(String, nullable=True)
    is_verified = Column(Boolean, nullable=False, default=False)
    tier = Column(Integer, nullable=False, default=1)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    state = Column(String, nullable=True)
    postal_code = Column(String, nullable=True)

    __table_args__ = (CheckConstraint("tier IN (1, 2, 3)", name="ck_user_tier"),)

    def to_dict(self):
        return {
            "id": str(self.id),
            "first_name": self.first_name,
            "last_name": self.last_name,
            "name": self.name,
            "uin": self.uin,
            "email": self.email,
            "phone_number": self.phone_number,
            "keycloak_id": self.keycloak_id,
            "tenant_id": self.tenant_id,
            "user_role": self.user_role.value if self.user_role else None,
            "status": self.status.value if self.status else None,
            "kyc_verification_status": self.kyc_verification_status.value if self.kyc_verification_status else None,
            "kyc_verification_url": self.kyc_verification_url,
            "is_verified": self.is_verified,
            "tier": self.tier,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "postal_code": self.postal_code,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "deleted_at": self.deleted_at.isoformat() if self.deleted_at else None,
        }
