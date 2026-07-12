from adapters import KeycloakAdapter
from definitions import CreateKeycloakUser
from repositories import AuthRepository, DeviceRepository
from schemas.v1 import (
    ChangePassword,
    Context,
    CreateAuth,
    ForgotPassword,
    Login,
    ResetPassword,
    SetupPassword,
)
from sqlalchemy.orm import Session
from utils import ApiError, create_logger, generate_api_key, get_otp_service
from utils.errors import raise_http_exception_handler
from utils.enums import UserRole
from utils.permissions import PermissionManager
from utils.role_mapper import RoleMapper

logger = create_logger(__name__)


class AuthService:
    """Auth Service — Keycloak identity + Permify authorization
    orchestration. See docs/AUTH_FLOW.md for the login/OTP step-up sequence
    diagram."""

    def __init__(self, db: Session):
        self._db = db
        self._auth_repository = AuthRepository(db)
        self._device_repository = DeviceRepository(db)

    def create_auth(self, payload: CreateAuth, context: Context):
        auth = self._auth_repository.get_auth_by_email(payload.email, context.tenant_id)
        if auth:
            raise_http_exception_handler(409, "User already exists.", "AUTH-AUTH-INT-4001")

        api_key = generate_api_key(24)
        api_secret = generate_api_key(32) + "123#"  # meet Keycloak password requirements

        keycloak_adapter = KeycloakAdapter(realm=context.keycloak_realm)

        logger.info(f"Creating Keycloak user for {payload.email} in realm {context.keycloak_realm}")
        keycloak_adapter.create_user(
            payload=CreateKeycloakUser(email=payload.email, user_name=payload.email)
        )

        keycloak_user = keycloak_adapter.get_user(payload.email)
        if keycloak_user is None:
            logger.error(f"Failed to retrieve Keycloak user {payload.email} after creation")
            raise ApiError(
                message="Failed to create user.", status_code=500, code="AUTH-AUTH-INT-5001"
            )

        # Service account — used for API-key-based token generation (POST /token/generate)
        keycloak_adapter.create_user(
            payload=CreateKeycloakUser(
                email=f"{api_key}_{payload.email}", user_name=api_key, password=api_secret
            )
        )

        auth = self._auth_repository.create_auth(
            email=payload.email,
            user_role=payload.user_role,
            tenant_id=context.tenant_id,
            keycloak_id=keycloak_user.id,
            api_key=api_key,
            api_secret=api_secret,
        )
        self._db.commit()
        self._db.refresh(auth)

        self._assign_initial_permissions(
            keycloak_user_id=keycloak_user.id,
            user_role=payload.user_role,
            tenant_id=context.tenant_id,
            platform_role=payload.platform_role,
            tenant_role=payload.tenant_role,
        )

        return auth

    def login(self, payload: Login, context: Context) -> dict:
        auth = self._auth_repository.get_auth_by_email(payload.email, context.tenant_id)
        if not auth:
            raise_http_exception_handler(401, "Invalid credentials.", "AUTH-AUTH-INT-4002")

        keycloak = KeycloakAdapter(realm=context.keycloak_realm)

        try:
            token_response = keycloak.request_user_token(auth.email, payload.password)
        except ApiError as e:
            error_description = ""
            if isinstance(e.payload, dict):
                error_description = str(e.payload.get("error_description", "")).lower()

            if "account is not fully set up" in error_description:
                raise_http_exception_handler(
                    403,
                    "Account setup is incomplete. Please complete required account actions "
                    "(for example password update or email verification) and try again.",
                    "AUTH-AUTH-SETUP-4004",
                )
            raise_http_exception_handler(401, "Invalid credentials.", "AUTH-AUTH-INT-4003")

        return {**token_response, "keycloak_id": auth.keycloak_id}

    def setup_password(self, payload: SetupPassword, context: Context) -> None:
        if payload.password != payload.confirm_password:
            raise ApiError(message="Passwords don't match.", status_code=400, code="AUTH-AUTH-INT-5001")

        auth = self._auth_repository.get_auth_by_keycloak_id(payload.keycloak_id, context.tenant_id)
        if not auth:
            raise_http_exception_handler(400, "Invalid user.", "AUTH-AUTH-INT-4003")

        KeycloakAdapter(realm=context.keycloak_realm).set_user_password(
            payload.keycloak_id, payload.password
        )

    def forgot_password(self, payload: ForgotPassword, context: Context) -> dict:
        auth = self._auth_repository.get_auth_by_email(payload.email, context.tenant_id)
        if not auth:
            raise_http_exception_handler(404, "User not found.", "AUTH-AUTH-USER-4041")

        otp_data = get_otp_service().generate_otp(
            keycloak_id=auth.keycloak_id, tenant_id=context.tenant_id, email=auth.email
        )
        return {
            "message": "Password reset OTP generated.",
            "keycloak_id": auth.keycloak_id,
            "otp_expires_at": otp_data["expires_at"],
        }

    def reset_password(self, payload: ResetPassword, context: Context) -> None:
        if payload.new_password != payload.confirm_password:
            raise_http_exception_handler(400, "Passwords do not match.", "AUTH-AUTH-RESET-4005")
        if len(payload.new_password) < 8:
            raise_http_exception_handler(400, "New password must be at least 8 characters.", "AUTH-AUTH-RESET-4006")

        auth = self._auth_repository.get_auth_by_keycloak_id(payload.keycloak_id, context.tenant_id)
        if not auth:
            raise_http_exception_handler(400, "Invalid user.", "AUTH-AUTH-RESET-4007")

        otp_result = get_otp_service().verify_otp(
            keycloak_id=payload.keycloak_id, tenant_id=context.tenant_id, otp_code=payload.otp_code
        )
        if not otp_result.get("valid"):
            raise_http_exception_handler(401, otp_result.get("message", "Invalid OTP code."), "AUTH-AUTH-RESET-4011")

        KeycloakAdapter(realm=context.keycloak_realm).set_user_password(
            payload.keycloak_id, payload.new_password
        )

    def change_password(self, payload: ChangePassword, context: Context, keycloak_id: str) -> None:
        if payload.new_password != payload.confirm_password:
            raise_http_exception_handler(400, "Passwords do not match.", "AUTH-AUTH-CHANGE-4008")
        if len(payload.new_password) < 8:
            raise_http_exception_handler(400, "New password must be at least 8 characters.", "AUTH-AUTH-CHANGE-4009")
        if payload.current_password == payload.new_password:
            raise_http_exception_handler(400, "New password must be different from current password.", "AUTH-AUTH-CHANGE-4010")

        auth = self._auth_repository.get_auth_by_keycloak_id(keycloak_id, context.tenant_id)
        if not auth:
            raise_http_exception_handler(404, "User not found.", "AUTH-AUTH-USER-4042")

        keycloak = KeycloakAdapter(realm=context.keycloak_realm)
        try:
            keycloak.request_user_token(auth.email, payload.current_password)
        except ApiError:
            raise_http_exception_handler(401, "Current password is incorrect.", "AUTH-AUTH-CHANGE-4012")

        keycloak.set_user_password(auth.keycloak_id, payload.new_password)

    def get_auth_by_api_key(self, key: str, secret: str, context: Context):
        return self._auth_repository.get_auth_by_api_key(key, secret, context.tenant_id)

    def _assign_initial_permissions(
        self,
        keycloak_user_id: str,
        user_role: UserRole,
        tenant_id: str,
        platform_role: str = None,
        tenant_role: str = None,
    ) -> None:
        """Assign v2.perm Permify roles on user creation.

        - platform_role → written to the `platform` entity (platform-level admins)
        - tenant_role   → written to the `tenants`  entity (bank/tenant staff)
        - If neither is given, fall back to a default derived from user_role.

        Errors here never fail user creation — they're logged and swallowed,
        matching the "assign explicitly via /permissions API" recovery path.
        """
        try:
            permission_manager = PermissionManager()

            if platform_role:
                if RoleMapper.validate_platform_role(platform_role):
                    ok = permission_manager.assign_platform_role(
                        user_id=keycloak_user_id, tenant_id=tenant_id,
                        role=platform_role, platform_id=tenant_id,
                    )
                    logger.info(f"{'✓' if ok else '✗'} platform:{platform_role} -> {keycloak_user_id}")
                else:
                    logger.warning(f"Invalid platform_role '{platform_role}' — skipped.")

            if tenant_role:
                if RoleMapper.validate_tenant_role(tenant_role):
                    ok = permission_manager.assign_tenant_role(
                        user_id=keycloak_user_id, tenant_id=tenant_id,
                        role=tenant_role, tenant_entity_id=tenant_id,
                    )
                    logger.info(f"{'✓' if ok else '✗'} tenants:{tenant_role} -> {keycloak_user_id}")
                else:
                    logger.warning(f"Invalid tenant_role '{tenant_role}' — skipped.")

            if not platform_role and not tenant_role and user_role:
                default_platform, default_tenant = RoleMapper.get_default_roles_for_user_role(user_role)

                if default_platform:
                    ok = permission_manager.assign_platform_role(
                        user_id=keycloak_user_id, tenant_id=tenant_id,
                        role=default_platform, platform_id=tenant_id,
                    )
                    logger.info(f"{'✓' if ok else '✗'} platform:{default_platform} (default) -> {keycloak_user_id}")

                if default_tenant:
                    ok = permission_manager.assign_tenant_role(
                        user_id=keycloak_user_id, tenant_id=tenant_id,
                        role=default_tenant, tenant_entity_id=tenant_id,
                    )
                    logger.info(f"{'✓' if ok else '✗'} tenants:{default_tenant} (default) -> {keycloak_user_id}")

                if not default_platform and not default_tenant:
                    logger.info(
                        f"No automatic Permify role for {keycloak_user_id} (UserRole={user_role}). "
                        "Assign explicitly via /permissions API."
                    )
        except Exception as e:
            logger.error(f"Error assigning initial Permify permissions: {e}")
