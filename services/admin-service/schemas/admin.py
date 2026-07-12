from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CreateAdminSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    first_name: str = Field(..., alias="firstName")
    last_name: str = Field(..., alias="lastName")
    email: str
    phone: Optional[str] = None
    uin: Optional[str] = None
    keycloak_id: str = Field(..., alias="keycloakId")
    branch_id: Optional[str] = Field(None, alias="branchId")
    access_level: Optional[str] = Field(None, alias="accessLevel")
    platform_role: Optional[str] = Field(None, alias="platformRole")
    tenant_role: Optional[str] = Field(None, alias="tenantRole")

    def resolved_role(self) -> str:
        return self.platform_role or self.tenant_role or self.access_level or "support_agent"


class UpdateAdminKycSchema(BaseModel):
    kyc_url: str = Field(..., alias="kycUrl")

    model_config = ConfigDict(populate_by_name=True)


class AdminResponseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: Optional[str]
    last_name: Optional[str]
    email: str
    phone: Optional[str]
    uin: Optional[str]
    tenant_id: str
    keycloak_id: str
    kyc_url: Optional[str]
    branch_id: Optional[str]
    access_level: str
    is_verified: bool
    is_suspended: bool
