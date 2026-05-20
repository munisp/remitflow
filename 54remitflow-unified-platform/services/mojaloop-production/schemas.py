from pydantic import BaseModel, Field, HttpUrl
from typing import Optional
from datetime import datetime
import uuid

# Base Schema for common fields
class ParticipantBase(BaseModel):
    name: str = Field(..., description="The human-readable name of the Participant (DFSP).", min_length=3, max_length=100)
    fsp_id: str = Field(..., description="The unique Financial Service Provider Identifier (FSP-ID) used in Mojaloop.", min_length=3, max_length=50)
    endpoint_url: HttpUrl = Field(..., description="The base URL for the Participant's API endpoint.")
    is_active: bool = Field(True, description="Indicates if the Participant is currently active on the switch.")

# Schema for creating a new Participant (Request Body)
class ParticipantCreate(ParticipantBase):
    pass

# Schema for updating an existing Participant (Request Body)
class ParticipantUpdate(BaseModel):
    name: Optional[str] = Field(None, description="The human-readable name of the Participant (DFSP).", min_length=3, max_length=100)
    endpoint_url: Optional[HttpUrl] = Field(None, description="The base URL for the Participant's API endpoint.")
    is_active: Optional[bool] = Field(None, description="Indicates if the Participant is currently active on the switch.")

# Schema for reading a Participant (Response Model)
class Participant(ParticipantBase):
    id: uuid.UUID = Field(..., description="The unique internal ID of the Participant.")
    created_at: datetime = Field(..., description="Timestamp of creation.")
    updated_at: datetime = Field(..., description="Timestamp of last update.")

    class Config:
        from_attributes = True
