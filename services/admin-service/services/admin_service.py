from sqlalchemy.orm import Session

from repositories import AdminRepository
from schemas import CreateAdminSchema
from utils.errors import raise_http_exception_handler
from utils.helpers import create_logger

logger = create_logger(__name__)


class AdminService:
    """Thin orchestration layer: delegates all DB work to AdminRepository,
    adds 404 existence-guards, and commits/refreshes. Assumes the Keycloak
    identity referenced by `keycloak_id` already exists — this service does
    not provision it (that's auth-service's job via POST /auth)."""

    def __init__(self, db: Session):
        self._db = db
        self._admin_repository = AdminRepository(db)

    def create_admin(self, payload: CreateAdminSchema, tenant_id: str):
        admin = self._admin_repository.create_admin(payload, tenant_id)
        self._db.commit()
        self._db.refresh(admin)
        logger.info(f"Admin created: {admin.email} (tenant={tenant_id})")
        return admin

    def get_admin(self, admin_id: int, tenant_id: str):
        admin = self._admin_repository.get_admin_by_id(admin_id, tenant_id)
        if not admin:
            raise_http_exception_handler(404, "Admin not found.", "ADMIN-ADMIN-404-4041")
        return admin

    def get_admin_by_keycloak_id(self, keycloak_id: str, tenant_id: str):
        admin = self._admin_repository.get_admin_by_keycloak_id(keycloak_id, tenant_id)
        if not admin:
            raise_http_exception_handler(404, "Admin not found.", "ADMIN-ADMIN-404-4042")
        return admin

    def list_admins(self, tenant_id: str, page: int, limit: int):
        return self._admin_repository.get_admins(tenant_id, page, limit)

    def suspend(self, admin_id: int, tenant_id: str):
        admin = self._admin_repository.set_suspended(admin_id, tenant_id, True)
        if not admin:
            raise_http_exception_handler(404, "Admin not found.", "ADMIN-ADMIN-404-4043")
        self._db.commit()
        self._db.refresh(admin)
        return admin

    def unsuspend(self, admin_id: int, tenant_id: str):
        admin = self._admin_repository.set_suspended(admin_id, tenant_id, False)
        if not admin:
            raise_http_exception_handler(404, "Admin not found.", "ADMIN-ADMIN-404-4044")
        self._db.commit()
        self._db.refresh(admin)
        return admin

    def save_kyc(self, keycloak_id: str, tenant_id: str, kyc_url: str):
        updated = self._admin_repository.save_kyc_state(keycloak_id, tenant_id, kyc_url)
        if not updated:
            raise_http_exception_handler(404, "Admin not found.", "ADMIN-ADMIN-404-4045")
        self._db.commit()

    def complete_kyc(self, keycloak_id: str, tenant_id: str):
        updated = self._admin_repository.complete_kyc(keycloak_id, tenant_id)
        if not updated:
            raise_http_exception_handler(404, "Admin not found.", "ADMIN-ADMIN-404-4046")
        self._db.commit()
