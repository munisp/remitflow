from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid

# --- Base Schemas ---

class ProtectedResourceBase(BaseModel):
    resource_name: str = Field(..., description="The name of the protected resource (e.g., /api/v1/users)")
    resource_type: str = Field("API_ENDPOINT", description="Type of resource (e.g., API_ENDPOINT, DOCUMENT, SERVICE)")
    required_scope: str = Field(..., description="The Keycloak scope required to access this resource")
    is_enabled: bool = Field(True, description="Whether the resource protection is enabled")

class KeycloakClientConfigBase(BaseModel):
    client_id: str = Field(..., description="The Keycloak client_id this config relates to")
    realm_name: str = Field("master", description="The Keycloak realm name")
    is_active: bool = Field(True, description="Whether the client configuration is active")
    description: Optional[str] = Field(None, description="A description for the client configuration")

# --- ProtectedResource Schemas ---

class ProtectedResourceCreate(ProtectedResourceBase):
    pass

class ProtectedResourceUpdate(ProtectedResourceBase):
    resource_name: Optional[str] = None
    resource_type: Optional[str] = None
    required_scope: Optional[str] = None
    is_enabled: Optional[bool] = None

class ProtectedResource(ProtectedResourceBase):
    id: uuid.UUID
    client_config_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

# --- KeycloakClientConfig Schemas ---

class KeycloakClientConfigCreate(KeycloakClientConfigBase):
    protected_resources: Optional[List[ProtectedResourceCreate]] = Field(None, description="List of protected resources to create with the client config")

class KeycloakClientConfigUpdate(KeycloakClientConfigBase):
    client_id: Optional[str] = None
    realm_name: Optional[str] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None
    # Note: Protected resources are managed via their own endpoints, not here.

class KeycloakClientConfig(KeycloakClientConfigBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    protected_resources: List[ProtectedResource] = []

    model_config = {"from_attributes": True}

# --- Response Schemas ---

class SuccessResponse(BaseModel):
    message: str = "Operation successful"
    id: Optional[uuid.UUID] = None
    details: Optional[dict] = None

class ListResponse(BaseModel):
    total: int
    items: List[KeycloakClientConfig]

class ProtectedResourceListResponse(BaseModel):
    total: int
    items: List[ProtectedResource]