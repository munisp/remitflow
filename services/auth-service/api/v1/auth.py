from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, responses
from sqlalchemy.orm import Session
from typing import List

from adapters import AuditServiceAdapter
from database import get_session
from repositories import DeviceRepository
from schemas.v1 import (
    AuditEventSchema,
    ChangePassword,
    Context,
    CreateAuth,
    DeleteDeviceResponse,
    DeviceResponse,
    ForgotPassword,
    Login,
    ResetPassword,
    SetupPassword,
    VerifyOTP,
)
from services import AuthService
from utils import UserRole, create_logger, detect_vpn, get_config, get_failed_login_tracker, get_otp_service
from utils.auth_middleware import get_current_user
from utils.errors import raise_http_exception_handler
from utils.kafka_client import AuthEventTypes
from utils.kafka_instance import KafkaClientInstance

config = get_config()
logger = create_logger(__name__)

auth_router = APIRouter()

DEFAULT_TENANT_ID = config.DEFAULT_TENANT_ID
DEFAULT_KEYCLOAK_REALM = config.DEFAULT_KEYCLOAK_REALM
DEFAULT_KEYCLOAK_PUBLIC_KEY = config.DEFAULT_KEYCLOAK_PUBLIC_KEY


@auth_router.post("")
def create_auth(
    payload: CreateAuth,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
):
    try:
        auth_service = AuthService(db)
        context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)
        auth = auth_service.create_auth(payload, context)

        KafkaClientInstance.publish_auth_event(
            event_type=AuthEventTypes.AUTH_CREATED,
            user_id=str(auth.id),
            tenant_id=tenant_id,
            metadata={"email": auth.email, "keycloak_id": auth.keycloak_id},
        )
        return responses.JSONResponse(
            content={"message": "success", "auth": auth.to_dict()}, status_code=201
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during create_auth: {e}")
        raise_http_exception_handler(500, "Create auth failed.", "AUTH-AUTH-INT-5000")


@auth_router.post("/login")
def login(
    payload: Login,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
    user_agent: str = Header("Unknown", alias="user-agent"),
    x_forwarded_for: str = Header(None, alias="x-forwarded-for"),
):
    try:
        auth_service = AuthService(db)
        device_repository = DeviceRepository(db)
        failed_login_tracker = get_failed_login_tracker(db)

        client_ip = x_forwarded_for.split(",")[0].strip() if x_forwarded_for else "unknown"
        logger.info(f"Login attempt from IP: {client_ip}, User-Agent: {user_agent}")

        vpn_detection = detect_vpn(client_ip)
        if config.BLOCK_TOR and vpn_detection.get("is_tor"):
            raise_http_exception_handler(
                403, "Login from Tor network is not allowed for security reasons.", "AUTH-AUTH-TOR-4030"
            )
        if config.BLOCK_VPN and vpn_detection.get("is_vpn"):
            raise_http_exception_handler(
                403, "Login from VPN is not allowed. Please disable your VPN and try again.", "AUTH-AUTH-VPN-4031"
            )
        if config.BLOCK_DATACENTER and vpn_detection.get("is_datacenter"):
            raise_http_exception_handler(
                403, "Login from datacenter IPs is not allowed for security reasons.", "AUTH-AUTH-DC-4032"
            )

        if payload.type and payload.type is UserRole.SUPERADMIN:
            context = Context(
                tenant_id=DEFAULT_TENANT_ID,
                keycloak_realm=DEFAULT_KEYCLOAK_REALM,
                keycloak_pub_key=DEFAULT_KEYCLOAK_PUBLIC_KEY,
            )
        else:
            context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)

        device_fingerprint = device_repository.generate_device_id(user_agent, client_ip)

        auth_user = auth_service._auth_repository.get_auth_by_email(payload.email, context.tenant_id)
        is_device_trusted = False
        if auth_user:
            existing_device = device_repository.get_trusted_device_by_keycloak(
                device_id=device_fingerprint, keycloak_id=auth_user.keycloak_id, tenant_id=context.tenant_id
            )
            is_device_trusted = existing_device is not None

        try:
            token_response = auth_service.login(payload, context)
        except HTTPException as login_error:
            error_detail = login_error.detail if isinstance(login_error.detail, dict) else {}
            error_code = error_detail.get("code")

            if error_code == "AUTH-AUTH-SETUP-4004":
                raise login_error

            attempt_result = failed_login_tracker.record_failed_attempt(
                email=payload.email,
                tenant_id=context.tenant_id,
                keycloak_id=auth_user.keycloak_id if auth_user else None,
            )

            if attempt_result["suspended"]:
                raise_http_exception_handler(
                    403,
                    f"Account suspended due to multiple failed login attempts "
                    f"({failed_login_tracker.MAX_ATTEMPTS}). Please contact support.",
                    "AUTH-AUTH-SUSPENDED-4033",
                )

            remaining = attempt_result["remaining"]
            if remaining > 0:
                raise_http_exception_handler(
                    401,
                    f"Invalid credentials. {remaining} attempt(s) remaining before account suspension.",
                    "AUTH-AUTH-INVALID-4002",
                )
            raise_http_exception_handler(
                403, "Maximum login attempts exceeded. Account will be suspended.", "AUTH-AUTH-MAX-ATTEMPTS-4034"
            )

        if auth_user:
            failed_login_tracker.reset_attempts(email=payload.email, tenant_id=context.tenant_id)

        if token_response is not None:
            AuditServiceAdapter().create_audit(
                payload=AuditEventSchema(
                    actor_id=token_response.get("keycloak_id", payload.email),
                    tenant_id=context.tenant_id,
                    event_type="LOGIN",
                    event_data={"email": payload.email, "type": payload.type.value if payload.type else "N/A"},
                    timestamp=datetime.utcnow().isoformat(),
                ),
                context=context,
            )

        device_repository.create_or_update_trusted_device(
            device_id=device_fingerprint,
            device_ip=client_ip,
            user_agent=user_agent,
            user_email=payload.email,
            tenant_id=context.tenant_id,
            keycloak_id=auth_user.keycloak_id if auth_user else "",
        )
        db.commit()

        if not is_device_trusted:
            otp_data = get_otp_service().generate_otp(
                keycloak_id=auth_user.keycloak_id, tenant_id=context.tenant_id, email=payload.email
            )
            return {
                "message": "OTP required for verification",
                "auth_stepup": True,
                "otp_required": True,
                "keycloak_id": auth_user.keycloak_id,
                "otp_expires_at": otp_data["expires_at"],
            }

        return {"message": "success", **token_response, "auth_stepup": False, "otp_required": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during login: {e}")
        raise_http_exception_handler(
            401, "Login failed. Please check your credentials and try again.", "AUTH-AUTH-INT-5001"
        )


@auth_router.post("/verify-otp")
def verify_otp(
    payload: VerifyOTP,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
):
    """Verify OTP for authentication step-up. Called after login when
    auth_stepup is true. Note: does not itself mint tokens — the client
    should use the tokens already obtained via a subsequent /auth/login
    retry, or POST /token/generate with the account's API key/secret."""
    try:
        auth_service = AuthService(db)
        context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)

        verification_result = get_otp_service().verify_otp(
            keycloak_id=payload.keycloak_id, tenant_id=tenant_id, otp_code=payload.otp_code
        )
        if not verification_result["valid"]:
            raise_http_exception_handler(401, verification_result["message"], "AUTH-OTP-INVALID-4010")

        auth_user = auth_service._auth_repository.get_auth_by_keycloak_id(payload.keycloak_id, tenant_id)
        if not auth_user:
            raise_http_exception_handler(404, "User not found.", "AUTH-USER-NOT-FOUND-4040")

        AuditServiceAdapter().create_audit(
            payload=AuditEventSchema(
                actor_id=payload.keycloak_id,
                tenant_id=tenant_id,
                event_type="OTP_VERIFIED",
                event_data={"keycloak_id": payload.keycloak_id, "email": auth_user.email},
                timestamp=datetime.utcnow().isoformat(),
            ),
            context=context,
        )

        return {
            "message": "OTP verified successfully. Authentication complete.",
            "verified": True,
            "keycloak_id": payload.keycloak_id,
            "email": auth_user.email,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during OTP verification: {e}")
        raise_http_exception_handler(500, "OTP verification failed.", "AUTH-OTP-INT-5010")


@auth_router.post("/setup-password")
def setup_password(
    payload: SetupPassword,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
):
    try:
        context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)
        AuthService(db).setup_password(payload, context)
        return {"message": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during password setup: {e}")
        raise_http_exception_handler(500, "Failed to set up password.", "AUTH-AUTH-INT-5002")


@auth_router.post("/forgot-password")
def forgot_password(
    payload: ForgotPassword,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
):
    try:
        context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)
        return AuthService(db).forgot_password(payload, context)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during forgot password: {e}")
        raise_http_exception_handler(500, "Failed to process forgot password request.", "AUTH-AUTH-INT-5003")


@auth_router.post("/reset-password")
def reset_password(
    payload: ResetPassword,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
):
    try:
        context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)
        AuthService(db).reset_password(payload, context)
        return {"message": "Password reset successfully."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during reset password: {e}")
        raise_http_exception_handler(500, "Failed to reset password.", "AUTH-AUTH-INT-5004")


@auth_router.post("/change-password")
def change_password(
    payload: ChangePassword,
    db: Session = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    try:
        AuthService(db).change_password(payload, current_user["context"], current_user["keycloak_id"])
        return {"message": "Password changed successfully."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during change password: {e}")
        raise_http_exception_handler(500, "Failed to change password.", "AUTH-AUTH-INT-5005")


@auth_router.get("/devices", response_model=List[DeviceResponse])
def get_user_devices(
    db: Session = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    try:
        device_repository = DeviceRepository(db)
        return device_repository.get_user_devices_by_keycloak_id(
            keycloak_id=current_user["keycloak_id"], tenant_id=current_user["tenant_id"]
        )
    except Exception as e:
        logger.error(f"Error retrieving devices: {e}")
        raise_http_exception_handler(500, "Failed to retrieve devices.", "AUTH-DEVICE-INT-5001")


@auth_router.delete("/devices/{device_id}", response_model=DeleteDeviceResponse)
def delete_trusted_device(
    device_id: str,
    db: Session = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    try:
        device_repository = DeviceRepository(db)
        device = device_repository.get_trusted_device_by_keycloak(
            device_id=device_id, keycloak_id=current_user["keycloak_id"], tenant_id=current_user["tenant_id"]
        )
        if not device:
            raise_http_exception_handler(
                404, "Device not found or you don't have permission to delete it.", "AUTH-DEVICE-INT-4001"
            )

        db.delete(device)
        db.commit()
        return DeleteDeviceResponse(message="Device deleted successfully", device_id=device_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting device: {e}")
        db.rollback()
        raise_http_exception_handler(500, "Failed to delete device.", "AUTH-DEVICE-INT-5002")
