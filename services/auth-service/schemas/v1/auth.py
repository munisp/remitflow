from typing import Optional

from pydantic import BaseModel

from utils.enums import UserRole


class CreateAuth(BaseModel):
    email: str
    user_role: UserRole = UserRole.USER
    # Explicit Permify roles (preferred). If neither is given, a default is
    # derived from user_role (see RoleMapper.get_default_roles_for_user_role).
    platform_role: Optional[str] = None
    tenant_role: Optional[str] = None


class Login(BaseModel):
    email: str
    password: str
    type: Optional[UserRole] = None


class VerifyOTP(BaseModel):
    keycloak_id: str
    otp_code: str


class SetupPassword(BaseModel):
    keycloak_id: str
    password: str
    confirm_password: str


class ForgotPassword(BaseModel):
    email: str


class ResetPassword(BaseModel):
    keycloak_id: str
    otp_code: str
    new_password: str
    confirm_password: str


class ChangePassword(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str
