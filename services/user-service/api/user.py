from fastapi import APIRouter, Depends, Header, HTTPException, Query, responses
from sqlalchemy.orm import Session

from database import get_session
from models import User
from schemas import AssignTierSchema, CreateUserSchema, SaveKycSchema, UserSchema
from utils.config import get_config
from utils.enums import KycVerificationStatus, UserRole, UserStatus
from utils.errors import raise_http_exception_handler, UserAlreadyExistException
from utils.external_api_client import ExternalAPIClient
from utils.helpers import create_logger
from utils.kafka_instance import KafkaClientInstance
from utils.kafka_client import UserEventTypes

config = get_config()
logger = create_logger(__name__)

user_router = APIRouter()


@user_router.post("")
def create_user(
    payload: CreateUserSchema,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    try:
        existing = (
            db.query(User)
            .filter(User.email == payload.email, User.tenant_id == tenant_id)
            .first()
        )
        if existing:
            raise UserAlreadyExistException(f"User with email {payload.email} already exists.")

        user = User(
            first_name=payload.first_name,
            last_name=payload.last_name,
            name=f"{payload.first_name} {payload.last_name}".strip(),
            uin=payload.uin,
            email=payload.email,
            phone_number=payload.phone_number,
            keycloak_id=payload.keycloak_id,
            tenant_id=tenant_id,
            user_role=UserRole.USER,
            kyc_verification_status=KycVerificationStatus.PENDING,
            address=payload.address,
            city=payload.city,
            state=payload.state,
            postal_code=payload.postal_code,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        KafkaClientInstance.publish_user_event(
            event_type=UserEventTypes.USER_CREATED,
            user_id=str(user.id),
            tenant_id=tenant_id,
            metadata={"email": user.email, "keycloak_id": user.keycloak_id},
        )

        return responses.JSONResponse(
            content={"message": "success", "user": user.to_dict()}, status_code=201
        )
    except HTTPException:
        raise
    except UserAlreadyExistException as e:
        raise_http_exception_handler(e.status_code, e.message, e.code)
    except Exception as e:
        logger.error(f"Unexpected error during create_user: {e}")
        raise_http_exception_handler(500, "Create user failed.", "USER-USER-INT-5000")


@user_router.get("/tenant")
def list_tenant_users(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
):
    query = db.query(User).filter(User.tenant_id == tenant_id)
    total = query.count()
    users = query.offset((page - 1) * limit).limit(limit).all()
    return {
        "message": "success",
        "users": [u.to_dict() for u in users],
        "total": total,
        "page": page,
        "limit": limit,
    }


@user_router.get("/metrics")
def user_metrics(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    total_count = db.query(User).filter(User.tenant_id == tenant_id).count()
    return {"total_count": total_count}


@user_router.post("/kyc/save")
def save_kyc(
    payload: SaveKycSchema,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
):
    user = (
        db.query(User)
        .filter(User.keycloak_id == keycloak_id, User.tenant_id == tenant_id)
        .first()
    )
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4041")

    user.kyc_verification_url = payload.kyc_verification_url
    db.commit()

    KafkaClientInstance.publish_kyc_event(
        event_type=UserEventTypes.KYC_SAVED,
        user_id=str(user.id),
        tenant_id=tenant_id,
    )
    return {"message": "success"}


@user_router.post("/kyc/complete")
def complete_kyc(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
):
    user = (
        db.query(User)
        .filter(User.keycloak_id == keycloak_id, User.tenant_id == tenant_id)
        .first()
    )
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4042")

    user.kyc_verification_status = KycVerificationStatus.VERIFIED
    user.is_verified = True
    user.status = UserStatus.ACTIVE
    db.commit()

    KafkaClientInstance.publish_kyc_event(
        event_type=UserEventTypes.KYC_COMPLETED,
        user_id=str(user.id),
        tenant_id=tenant_id,
        kyc_status=KycVerificationStatus.VERIFIED.value,
    )
    return {"message": "success"}


@user_router.post("/kyc/fail")
def fail_kyc(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
):
    user = (
        db.query(User)
        .filter(User.keycloak_id == keycloak_id, User.tenant_id == tenant_id)
        .first()
    )
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4043")

    user.kyc_verification_status = KycVerificationStatus.FAILED_VERIFICATION
    db.commit()

    KafkaClientInstance.publish_kyc_event(
        event_type=UserEventTypes.KYC_FAILED,
        user_id=str(user.id),
        tenant_id=tenant_id,
        kyc_status=KycVerificationStatus.FAILED_VERIFICATION.value,
    )
    return {"message": "success"}


@user_router.post("/kyc/liveness-check")
def kyc_liveness_check(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
):
    user = (
        db.query(User)
        .filter(User.keycloak_id == keycloak_id, User.tenant_id == tenant_id)
        .first()
    )
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4044")

    user.kyc_verification_status = KycVerificationStatus.NOT_VERIFIED
    db.commit()

    if not config.VERIFICATION_SERVICE_URL:
        raise_http_exception_handler(
            500, "Verification service is not configured.", "USER-KYC-CFG-5010"
        )

    client = ExternalAPIClient(
        base_url=config.VERIFICATION_SERVICE_URL,
        headers={
            "x-client-id": config.VERIFICATION_CLIENT_ID,
            "x-client-secret": config.VERIFICATION_CLIENT_SECRET,
            "Content-Type": "application/json",
        },
    )
    result = client._post(
        endpoint="/kyc/initialize-verification",
        data={"keycloak_id": keycloak_id, "redirect_url": config.KYC_REDIRECT_URL},
    )

    verification_url = result.get("url") if isinstance(result, dict) else None
    if verification_url:
        user.kyc_verification_url = verification_url
        db.commit()

    KafkaClientInstance.publish_kyc_event(
        event_type=UserEventTypes.KYC_SAVED,
        user_id=str(user.id),
        tenant_id=tenant_id,
        metadata={"liveness_check": True},
    )
    return {"message": "success", "url": verification_url}


@user_router.get("")
def get_user(
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
    keycloak_id_query: str | None = Query(None, alias="keycloak_id"),
):
    lookup_id = keycloak_id_query or keycloak_id
    user = (
        db.query(User)
        .filter(User.keycloak_id == lookup_id, User.tenant_id == tenant_id)
        .first()
    )
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4045")
    return {"message": "success", "user": user.to_dict()}


@user_router.post("/tier/assign")
def assign_tier(
    payload: AssignTierSchema,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_id: str = Header(..., alias="x-keycloak-id"),
):
    if payload.tier not in (1, 2, 3):
        raise_http_exception_handler(400, "tier must be 1, 2, or 3.", "USER-USER-VAL-4001")

    user = (
        db.query(User)
        .filter(User.keycloak_id == keycloak_id, User.tenant_id == tenant_id)
        .first()
    )
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4046")

    user.tier = payload.tier
    db.commit()
    return {"message": "success", "tier": user.tier}


@user_router.put("/{id}")
def update_user(
    id: str,
    payload: UserSchema,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    user = db.query(User).filter(User.id == id, User.tenant_id == tenant_id).first()
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4047")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)

    KafkaClientInstance.publish_user_event(
        event_type=UserEventTypes.USER_UPDATED,
        user_id=str(user.id),
        tenant_id=tenant_id,
    )
    return {"message": "success", "user": user.to_dict()}


@user_router.put("/{id}/activate")
def activate_user(
    id: str,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    user = db.query(User).filter(User.id == id, User.tenant_id == tenant_id).first()
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4048")

    user.status = UserStatus.ACTIVE
    db.commit()

    KafkaClientInstance.publish_user_event(
        event_type=UserEventTypes.USER_ACTIVATED,
        user_id=str(user.id),
        tenant_id=tenant_id,
    )
    return {"message": "success", "user": user.to_dict()}


@user_router.put("/{id}/suspend")
def suspend_user(
    id: str,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
):
    user = db.query(User).filter(User.id == id, User.tenant_id == tenant_id).first()
    if not user:
        raise_http_exception_handler(404, "User not found.", "USER-USER-404-4049")

    user.status = UserStatus.SUSPENDED
    db.commit()

    KafkaClientInstance.publish_user_event(
        event_type=UserEventTypes.USER_SUSPENDED,
        user_id=str(user.id),
        tenant_id=tenant_id,
    )
    return {"message": "success", "user": user.to_dict()}
