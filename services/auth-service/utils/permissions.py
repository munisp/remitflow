import functools
from typing import Optional

from adapters import permify
from utils.helpers import create_logger
from utils.role_mapper import PLATFORM_ROLE_LABELS, TENANT_ROLE_LABELS

logger = create_logger(__name__)

VALID_PLATFORM_ROLES = list(PLATFORM_ROLE_LABELS.keys())
VALID_TENANT_ROLES = list(TENANT_ROLE_LABELS.keys())


class PermissionManager:
    """Static-method wrapper around adapters.permify for role
    assignment/checking against the v2.perm schema's `platform` and
    `tenants` entities."""

    VALID_PLATFORM_ROLES = VALID_PLATFORM_ROLES
    VALID_TENANT_ROLES = VALID_TENANT_ROLES

    @staticmethod
    def assign_platform_role(user_id: str, tenant_id: str, role: str, platform_id: str) -> bool:
        return permify.assign_role(
            user_id=user_id, tenant_id=tenant_id, role=role,
            entity_type="platform", entity_id=platform_id,
        )

    @staticmethod
    def assign_tenant_role(user_id: str, tenant_id: str, role: str, tenant_entity_id: str) -> bool:
        return permify.assign_role(
            user_id=user_id, tenant_id=tenant_id, role=role,
            entity_type="tenants", entity_id=tenant_entity_id,
        )

    @staticmethod
    def revoke_role(
        user_id: str, tenant_id: str, role: str, entity_type: str, entity_id: str
    ) -> bool:
        return permify.remove_role(
            user_id=user_id, tenant_id=tenant_id, role=role,
            entity_type=entity_type, entity_id=entity_id,
        )

    @staticmethod
    def check_permission(
        user_id: str, tenant_id: str, permission: str, entity_type: str, entity_id: str
    ) -> bool:
        return permify.check_permission(
            user_id=user_id, tenant_id=tenant_id, permission=permission,
            entity_type=entity_type, entity_id=entity_id,
        )


def require_permission(entity_type: str, permission: str, entity_id_param: str = "tenant_id"):
    """Decorator factory for protecting async route handlers. Expects
    `current_user` (dict with `keycloak_id`) and the entity-id kwarg (named
    by `entity_id_param`, default `tenant_id`) to be present in the wrapped
    function's kwargs."""

    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            from utils.errors import raise_http_exception_handler

            current_user = kwargs.get("current_user")
            entity_id = kwargs.get(entity_id_param)
            if not current_user or not entity_id:
                raise_http_exception_handler(
                    500,
                    "require_permission misconfigured: missing current_user/entity id.",
                    "AUTH-PERM-CFG-5000",
                )

            allowed = PermissionManager.check_permission(
                user_id=current_user["keycloak_id"],
                tenant_id=current_user["tenant_id"],
                permission=permission,
                entity_type=entity_type,
                entity_id=str(entity_id),
            )
            if not allowed:
                raise_http_exception_handler(
                    403,
                    f"Missing permission '{permission}' on {entity_type}:{entity_id}.",
                    "AUTH-PERM-DENY-4030",
                )
            return await func(*args, **kwargs)

        return wrapper

    return decorator
