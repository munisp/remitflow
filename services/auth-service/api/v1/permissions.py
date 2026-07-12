from concurrent.futures import ThreadPoolExecutor
from typing import List

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from utils.auth_middleware import get_current_user
from utils.errors import raise_http_exception_handler
from utils.helpers import create_logger
from utils.permissions import PermissionManager
from utils.role_mapper import PLATFORM_ROLE_LABELS, TENANT_ROLE_LABELS, RoleMapper

logger = create_logger(__name__)

permissions_router = APIRouter()


class AssignPlatformRoleRequest(BaseModel):
    user_id: str
    role: str


class AssignTenantRoleRequest(BaseModel):
    user_id: str
    role: str
    tenant_entity_id: str | None = None


class CheckPermissionRequest(BaseModel):
    permission: str
    entity_type: str
    entity_id: str
    user_id: str | None = None  # defaults to caller


class CheckPermissionsBatchRequest(BaseModel):
    checks: List[CheckPermissionRequest]


class RevokeRoleRequest(BaseModel):
    user_id: str
    role: str
    entity_type: str
    entity_id: str


@permissions_router.post("/assign-platform-role")
def assign_platform_role(
    payload: AssignPlatformRoleRequest,
    tenant_id: str = Header(..., alias="x-tenant-id"),
    current_user: dict = Depends(get_current_user),
):
    allowed = PermissionManager.check_permission(
        user_id=current_user["keycloak_id"], tenant_id=tenant_id,
        permission="manage_tenants", entity_type="platform", entity_id=tenant_id,
    )
    if not allowed:
        raise_http_exception_handler(403, "Missing manage_tenants on platform.", "AUTH-PERM-DENY-4030")

    if not RoleMapper.validate_platform_role(payload.role):
        raise_http_exception_handler(
            400, f"Invalid platform role. Valid: {list(PLATFORM_ROLE_LABELS)}", "AUTH-PERM-VAL-4001"
        )

    ok = PermissionManager.assign_platform_role(
        user_id=payload.user_id, tenant_id=tenant_id, role=payload.role, platform_id=tenant_id
    )
    if not ok:
        raise_http_exception_handler(500, "Failed to assign platform role.", "AUTH-PERM-INT-5001")
    return {"message": "success", "role": payload.role}


@permissions_router.post("/assign-tenant-role")
def assign_tenant_role(
    payload: AssignTenantRoleRequest,
    tenant_id: str = Header(..., alias="x-tenant-id"),
    current_user: dict = Depends(get_current_user),
):
    tenant_entity_id = payload.tenant_entity_id or tenant_id
    allowed = PermissionManager.check_permission(
        user_id=current_user["keycloak_id"], tenant_id=tenant_id,
        permission="manage_employees", entity_type="tenants", entity_id=tenant_entity_id,
    )
    if not allowed:
        raise_http_exception_handler(403, "Missing manage_employees on tenants.", "AUTH-PERM-DENY-4031")

    if not RoleMapper.validate_tenant_role(payload.role):
        raise_http_exception_handler(
            400, f"Invalid tenant role. Valid: {list(TENANT_ROLE_LABELS)}", "AUTH-PERM-VAL-4002"
        )

    ok = PermissionManager.assign_tenant_role(
        user_id=payload.user_id, tenant_id=tenant_id, role=payload.role, tenant_entity_id=tenant_entity_id
    )
    if not ok:
        raise_http_exception_handler(500, "Failed to assign tenant role.", "AUTH-PERM-INT-5002")
    return {"message": "success", "role": payload.role}


@permissions_router.post("/check-permission")
def check_permission(
    payload: CheckPermissionRequest,
    tenant_id: str = Header(..., alias="x-tenant-id"),
    current_user: dict = Depends(get_current_user),
):
    user_id = payload.user_id or current_user["keycloak_id"]
    allowed = PermissionManager.check_permission(
        user_id=user_id, tenant_id=tenant_id, permission=payload.permission,
        entity_type=payload.entity_type, entity_id=payload.entity_id,
    )
    return {"allowed": allowed}


@permissions_router.post("/check-permissions-batch")
def check_permissions_batch(
    payload: CheckPermissionsBatchRequest,
    tenant_id: str = Header(..., alias="x-tenant-id"),
    current_user: dict = Depends(get_current_user),
):
    def _check(item: CheckPermissionRequest) -> bool:
        return PermissionManager.check_permission(
            user_id=item.user_id or current_user["keycloak_id"],
            tenant_id=tenant_id, permission=item.permission,
            entity_type=item.entity_type, entity_id=item.entity_id,
        )

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(_check, payload.checks))

    return {
        "results": [
            {
                "permission": item.permission,
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "allowed": allowed,
            }
            for item, allowed in zip(payload.checks, results)
        ]
    }


@permissions_router.delete("/revoke-role")
def revoke_role(
    payload: RevokeRoleRequest,
    tenant_id: str = Header(..., alias="x-tenant-id"),
    current_user: dict = Depends(get_current_user),
):
    required_permission = "manage_tenants" if payload.entity_type == "platform" else "manage_employees"
    allowed = PermissionManager.check_permission(
        user_id=current_user["keycloak_id"], tenant_id=tenant_id,
        permission=required_permission, entity_type=payload.entity_type, entity_id=payload.entity_id,
    )
    if not allowed:
        raise_http_exception_handler(403, f"Missing {required_permission}.", "AUTH-PERM-DENY-4032")

    ok = PermissionManager.revoke_role(
        user_id=payload.user_id, tenant_id=tenant_id, role=payload.role,
        entity_type=payload.entity_type, entity_id=payload.entity_id,
    )
    if not ok:
        raise_http_exception_handler(500, "Failed to revoke role.", "AUTH-PERM-INT-5003")
    return {"message": "success"}


@permissions_router.get("/role-catalog")
def role_catalog():
    return {
        "platform_roles": [{"value": k, "label": v} for k, v in PLATFORM_ROLE_LABELS.items()],
        "tenant_roles": [{"value": k, "label": v} for k, v in TENANT_ROLE_LABELS.items()],
    }
