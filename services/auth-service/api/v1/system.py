import os

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from adapters import KeycloakAdapter
from database import get_session
from definitions import CreateKeycloakUser
from repositories import AuthRepository
from utils import create_logger, generate_api_key, get_config
from utils.enums import UserRole
from utils.errors import raise_http_exception_handler
from utils.permissions import PermissionManager

config = get_config()
logger = create_logger(__name__)

system_router = APIRouter()

# Bootstrap-only guard: the original corebanking version of this endpoint had
# no auth at all, which the audit flagged as a real risk (anyone who can
# reach the service could seed a new superadmin). Require a one-time secret
# instead — set SYSTEM_SEED_TOKEN only while bootstrapping a fresh
# environment, then unset/rotate it.
SYSTEM_SEED_TOKEN = os.getenv("SYSTEM_SEED_TOKEN", "")


@system_router.post("/seed/admin")
def seed_superadmin(
    db: Session = Depends(get_session),
    x_seed_token: str = Header(..., alias="x-seed-token"),
):
    if not SYSTEM_SEED_TOKEN or x_seed_token != SYSTEM_SEED_TOKEN:
        raise_http_exception_handler(403, "Invalid or unconfigured seed token.", "AUTH-SYS-SEED-4030")

    if not (config.DEFAULT_SUPER_ADMIN_EMAIL and config.DEFAULT_SUPER_ADMIN_PASSWORD):
        raise_http_exception_handler(
            500, "DEFAULT_SUPER_ADMIN_EMAIL/PASSWORD are not configured.", "AUTH-SYS-SEED-5000"
        )

    try:
        auth_repository = AuthRepository(db)
        existing = auth_repository.get_auth_by_email(config.DEFAULT_SUPER_ADMIN_EMAIL, config.DEFAULT_TENANT_ID)
        if existing:
            raise_http_exception_handler(409, "Superadmin already exists.", "AUTH-SYS-SEED-4090")

        keycloak_adapter = KeycloakAdapter(realm=config.DEFAULT_KEYCLOAK_REALM)
        keycloak_adapter.create_user(
            payload=CreateKeycloakUser(
                email=config.DEFAULT_SUPER_ADMIN_EMAIL,
                user_name=config.DEFAULT_SUPER_ADMIN_EMAIL,
            )
        )
        keycloak_user = keycloak_adapter.get_user(config.DEFAULT_SUPER_ADMIN_EMAIL)
        if keycloak_user is None:
            raise_http_exception_handler(500, "Failed to provision superadmin in Keycloak.", "AUTH-SYS-SEED-5001")

        keycloak_adapter.set_user_password(keycloak_user.id, config.DEFAULT_SUPER_ADMIN_PASSWORD)

        auth = auth_repository.create_auth(
            email=config.DEFAULT_SUPER_ADMIN_EMAIL,
            user_role=UserRole.SUPERADMIN,
            tenant_id=config.DEFAULT_TENANT_ID,
            keycloak_id=keycloak_user.id,
            api_key=generate_api_key(24),
            api_secret=generate_api_key(32) + "123#",
        )
        db.commit()
        db.refresh(auth)

        PermissionManager.assign_platform_role(
            user_id=keycloak_user.id, tenant_id=config.DEFAULT_TENANT_ID,
            role="super_admin", platform_id=config.DEFAULT_TENANT_ID,
        )
        PermissionManager.assign_tenant_role(
            user_id=keycloak_user.id, tenant_id=config.DEFAULT_TENANT_ID,
            role="super_admin", tenant_entity_id=config.DEFAULT_TENANT_ID,
        )

        logger.info(f"Seeded superadmin: {config.DEFAULT_SUPER_ADMIN_EMAIL}")
        return {"message": "success", "auth": auth.to_dict()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error seeding superadmin: {e}")
        raise_http_exception_handler(500, "Failed to seed superadmin.", "AUTH-SYS-SEED-5002")
