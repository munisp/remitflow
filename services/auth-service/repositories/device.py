import hashlib
from typing import List, Optional

from sqlalchemy.orm import Session

from models import TrustedDevice


class DeviceRepository:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def generate_device_id(user_agent: str, ip: str) -> str:
        return hashlib.sha256(f"{user_agent}_{ip}".encode()).hexdigest()

    def get_trusted_device(
        self, device_id: str, email: str, tenant_id: str
    ) -> Optional[TrustedDevice]:
        return (
            self.db.query(TrustedDevice)
            .filter(
                TrustedDevice.device_id == device_id,
                TrustedDevice.user_email == email,
                TrustedDevice.tenant_id == tenant_id,
            )
            .first()
        )

    def get_trusted_device_by_keycloak(
        self, device_id: str, keycloak_id: str, tenant_id: str
    ) -> Optional[TrustedDevice]:
        return (
            self.db.query(TrustedDevice)
            .filter(
                TrustedDevice.device_id == device_id,
                TrustedDevice.keycloak_id == keycloak_id,
                TrustedDevice.tenant_id == tenant_id,
            )
            .first()
        )

    def get_user_devices(self, email: str, tenant_id: str) -> List[TrustedDevice]:
        return (
            self.db.query(TrustedDevice)
            .filter(TrustedDevice.user_email == email, TrustedDevice.tenant_id == tenant_id)
            .all()
        )

    def get_user_devices_by_keycloak_id(
        self, keycloak_id: str, tenant_id: str
    ) -> List[TrustedDevice]:
        return (
            self.db.query(TrustedDevice)
            .filter(TrustedDevice.keycloak_id == keycloak_id, TrustedDevice.tenant_id == tenant_id)
            .all()
        )

    def create_or_update_trusted_device(
        self,
        device_id: str,
        device_ip: str,
        user_agent: str,
        user_email: str,
        tenant_id: str,
        keycloak_id: str,
    ) -> TrustedDevice:
        existing = self.get_trusted_device_by_keycloak(device_id, keycloak_id, tenant_id)
        if existing:
            existing.device_ip = device_ip
            existing.user_agent = user_agent
            return existing

        device = TrustedDevice(
            device_id=device_id,
            device_ip=device_ip,
            user_agent=user_agent,
            user_email=user_email,
            tenant_id=tenant_id,
            keycloak_id=keycloak_id,
        )
        self.db.add(device)
        return device
