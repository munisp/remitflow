from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field

# --- Base Schemas ---

class ApisixRouteBase(BaseModel):
    """Base schema for APISIX Route, containing common fields for creation and update."""
    name: str = Field(..., description="Unique name for the APISIX Route.")
    description: Optional[str] = Field(None, description="Optional description for the Route.")
    uri: str = Field(..., description="The URI path to match (e.g., '/api/v1/users').")
    methods: List[str] = Field(..., description="List of HTTP methods to match (e.g., ['GET', 'POST']).")
    upstream_id: Optional[str] = Field(None, description="ID of the associated Upstream service.")
    plugins: Dict[str, Any] = Field({}, description="JSON object for plugin configuration.")
    status: bool = Field(True, description="Status of the Route (True for enabled, False for disabled).")

    class Config:
        from_attributes = True

# --- Request Schemas ---

class ApisixRouteCreate(ApisixRouteBase):
    """Schema for creating a new APISIX Route."""
    pass

class ApisixRouteUpdate(ApisixRouteBase):
    """Schema for updating an existing APISIX Route."""
    # All fields are optional for update, but we'll keep them as they are in the base for simplicity
    # and rely on the service layer to handle partial updates if needed.
    pass

# --- Response Schemas ---

class ApisixRoute(ApisixRouteBase):
    """Schema for returning an APISIX Route, including read-only fields."""
    id: UUID = Field(..., description="Unique identifier for the Route.")
    created_at: datetime = Field(..., description="Timestamp of creation.")
    updated_at: datetime = Field(..., description="Timestamp of last update.")

    class Config:
        from_attributes = True
        json_encoders = {
            UUID: str,
            datetime: lambda dt: dt.isoformat(),
        }