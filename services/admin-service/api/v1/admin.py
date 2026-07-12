from fastapi import APIRouter, Depends, Header, HTTPException, Query, responses
from sqlalchemy.orm import Session

from database import get_session
from schemas import CreateAdminSchema, UpdateAdminKycSchema
from services import AdminService
from utils.errors import raise_http_exception_handler
from utils.helpers import create_logger
from utils.kafka_instance import KafkaClientInstance
from utils.kafka_client import AdminEventTypes

logger = create_logger(__name__)

admin_router = APIRouter()


@admin_router.post("")
def create_admin(
    payload: CreateAdminSchema,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    try:
        admin = AdminService(db).create_admin(payload, tenant_id)
        KafkaClientInstance.publish_auth_event(
            event_type=AdminEventTypes.ADMIN_CREATED,
            user_id=str(admin.id),
            tenant_id=tenant_id,
            metadata={"email": admin.email, "keycloak_id": admin.keycloak_id},
        )
        return responses.JSONResponse(
            content={"message": "success", "admin": admin.to_dict()}, status_code=201
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during create_admin: {e}")
        raise_http_exception_handler(500, "Create admin failed.", "ADMIN-ADMIN-INT-5000")


@admin_router.get("/{admin_id}")
def get_admin(
    admin_id: int,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    admin = AdminService(db).get_admin(admin_id, tenant_id)
    return {"message": "success", "admin": admin.to_dict()}


@admin_router.get("/keycloak/{keycloak_id}")
def get_admin_by_keycloak_id(
    keycloak_id: str,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    admin = AdminService(db).get_admin_by_keycloak_id(keycloak_id, tenant_id)
    return {"message": "success", "admin": admin.to_dict()}


@admin_router.get("")
def list_admins(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
):
    admins, total = AdminService(db).list_admins(tenant_id, page, limit)
    return {
        "message": "success",
        "admins": [a.to_dict() for a in admins],
        "total": total,
        "page": page,
        "limit": limit,
    }


@admin_router.patch("/{admin_id}/suspend")
def suspend_admin(
    admin_id: int,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    admin = AdminService(db).suspend(admin_id, tenant_id)
    KafkaClientInstance.publish_auth_event(
        event_type=AdminEventTypes.ADMIN_SUSPENDED,
        user_id=str(admin.id),
        tenant_id=tenant_id,
    )
    return {"message": "success", "admin": admin.to_dict()}


@admin_router.patch("/{admin_id}/unsuspend")
def unsuspend_admin(
    admin_id: int,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    admin = AdminService(db).unsuspend(admin_id, tenant_id)
    KafkaClientInstance.publish_auth_event(
        event_type=AdminEventTypes.ADMIN_ACTIVATED,
        user_id=str(admin.id),
        tenant_id=tenant_id,
    )
    return {"message": "success", "admin": admin.to_dict()}


@admin_router.post("/kyc/save")
def save_kyc(
    payload: UpdateAdminKycSchema,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
):
    AdminService(db).save_kyc(keycloak_id, tenant_id, payload.kyc_url)
    KafkaClientInstance.publish_kyc_event(
        event_type=AdminEventTypes.KYC_SAVED,
        user_id=keycloak_id,
        tenant_id=tenant_id,
    )
    return {"message": "success"}


@admin_router.post("/kyc/complete")
def complete_kyc(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
):
    AdminService(db).complete_kyc(keycloak_id, tenant_id)
    KafkaClientInstance.publish_kyc_event(
        event_type=AdminEventTypes.KYC_COMPLETED,
        user_id=keycloak_id,
        tenant_id=tenant_id,
    )
    return {"message": "success"}
