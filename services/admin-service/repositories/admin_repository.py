from typing import Optional

from sqlalchemy.orm import Session

from models import Admin
from schemas import CreateAdminSchema


class AdminRepository:
    """Pure SQLAlchemy query-builder access to the `admin` table. Never
    commits — the caller (service layer) is responsible for
    commit/refresh/rollback."""

    def __init__(self, db: Session):
        self.db = db

    def create_admin(self, payload: CreateAdminSchema, tenant_id: str) -> Admin:
        admin = Admin(
            first_name=payload.first_name,
            last_name=payload.last_name,
            email=payload.email,
            phone=payload.phone,
            uin=payload.uin,
            tenant_id=tenant_id,
            keycloak_id=payload.keycloak_id,
            branch_id=payload.branch_id,
            access_level=payload.resolved_role(),
        )
        self.db.add(admin)
        return admin

    def get_admin_by_id(self, admin_id: int, tenant_id: str) -> Optional[Admin]:
        return (
            self.db.query(Admin)
            .filter(Admin.id == admin_id, Admin.tenant_id == tenant_id)
            .first()
        )

    def get_admin_by_keycloak_id(self, keycloak_id: str, tenant_id: str) -> Optional[Admin]:
        return (
            self.db.query(Admin)
            .filter(Admin.keycloak_id == keycloak_id, Admin.tenant_id == tenant_id)
            .first()
        )

    def get_admins(self, tenant_id: str, page: int = 1, limit: int = 10):
        query = self.db.query(Admin).filter(Admin.tenant_id == tenant_id)
        total = query.count()
        admins = query.offset((page - 1) * limit).limit(limit).all()
        return admins, total

    def set_suspended(self, admin_id: int, tenant_id: str, suspended: bool) -> Optional[Admin]:
        admin = self.get_admin_by_id(admin_id, tenant_id)
        if admin:
            admin.is_suspended = suspended
        return admin

    def save_kyc_state(self, keycloak_id: str, tenant_id: str, kyc_url: str) -> int:
        return (
            self.db.query(Admin)
            .filter(Admin.keycloak_id == keycloak_id, Admin.tenant_id == tenant_id)
            .update({"kyc_url": kyc_url})
        )

    def complete_kyc(self, keycloak_id: str, tenant_id: str) -> int:
        return (
            self.db.query(Admin)
            .filter(Admin.keycloak_id == keycloak_id, Admin.tenant_id == tenant_id)
            .update({"is_verified": True})
        )
