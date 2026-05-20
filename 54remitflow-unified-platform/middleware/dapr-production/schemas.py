from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field, validator

# --- Metadata Schemas ---

class DaprComponentMetadataBase(BaseModel):
    key: str = Field(..., description="The key of the component metadata item.")
    value: str = Field(..., description="The value of the component metadata item.")
    secret_ref: Optional[str] = Field(None, description="Optional reference to a secret store for the value.")

class DaprComponentMetadataCreate(DaprComponentMetadataBase):
    pass

class DaprComponentMetadata(DaprComponentMetadataBase):
    id: int
    component_id: int

    class Config:
        orm_mode = True

# --- Component Schemas ---

class DaprComponentBase(BaseModel):
    name: str = Field(..., min_length=3, max_length=100, description="Unique name of the Dapr component.")
    component_type: str = Field(..., description="The type of the component (e.g., state.redis, pubsub.kafka).")
    version: str = Field("v1", description="The version of the component API.")
    scope: Optional[str] = Field(None, description="JSON string for application scoping.")
    is_production: bool = Field(False, description="Flag indicating if the component is for production use.")

    @validator('component_type')
    def validate_component_type_format(cls, v):
        if '.' not in v:
            raise ValueError('component_type must be in the format "type.name" (e.g., state.redis)')
        return v

class DaprComponentCreate(DaprComponentBase):
    metadata_items: List[DaprComponentMetadataCreate] = Field([], description="List of metadata key-value pairs for the component.")

class DaprComponentUpdate(DaprComponentBase):
    name: Optional[str] = Field(None, min_length=3, max_length=100, description="Unique name of the Dapr component.")
    component_type: Optional[str] = Field(None, description="The type of the component (e.g., state.redis, pubsub.kafka).")
    version: Optional[str] = Field(None, description="The version of the component API.")
    is_production: Optional[bool] = Field(None, description="Flag indicating if the component is for production use.")
    # Note: Metadata updates will be handled separately or through a dedicated endpoint if needed,
    # but for simplicity in this CRUD, we'll allow full replacement on update.
    metadata_items: Optional[List[DaprComponentMetadataCreate]] = Field(None, description="List of metadata key-value pairs for the component.")


class DaprComponent(DaprComponentBase):
    id: int
    created_at: datetime
    updated_at: datetime
    metadata_items: List[DaprComponentMetadata] = Field([], description="List of metadata key-value pairs for the component.")

    class Config:
        orm_mode = True