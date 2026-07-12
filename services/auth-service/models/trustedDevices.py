from sqlalchemy import Column, Integer, String, UniqueConstraint

from database import Base
from models.mixins import TimestampMixin


class TrustedDevice(Base, TimestampMixin):
    """Implements device-based step-up authentication: a login from a
    device+user+tenant combination not already recorded here forces an OTP
    challenge; once trusted, subsequent logins from that device skip OTP."""

    __tablename__ = "trusted_devices"
    __table_args__ = (
        UniqueConstraint("device_id", "keycloak_id", "tenant_id", name="uq_trusted_device"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, index=True, nullable=False)  # sha256(user_agent + ip)
    device_ip = Column(String, nullable=False)
    user_agent = Column(String, nullable=False)
    tenant_id = Column(String, nullable=False)
    user_email = Column(String, nullable=False)
    keycloak_id = Column(String, index=True, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "device_id": self.device_id,
            "device_ip": self.device_ip,
            "user_agent": self.user_agent,
            "tenant_id": self.tenant_id,
            "user_email": self.user_email,
            "keycloak_id": self.keycloak_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
