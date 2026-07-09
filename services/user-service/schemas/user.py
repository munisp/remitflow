from typing import Optional

from pydantic import BaseModel

from utils.enums import UserRole


class CreateUserSchema(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone_number: Optional[str] = None
    uin: Optional[str] = None
    keycloak_id: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None


class UserSchema(BaseModel):
    """Partial-update shape — every field optional, applied via
    `exclude_unset=True` + setattr in PUT /user/{id}."""

    name: Optional[str] = None
    email: Optional[str] = None
    user_role: Optional[UserRole] = None
    phone_number: Optional[str] = None


class AssignTierSchema(BaseModel):
    tier: int


class SaveKycSchema(BaseModel):
    kyc_verification_url: str
