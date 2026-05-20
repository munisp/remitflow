from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field

# --- Base Schemas ---

class MessageBase(BaseModel):
    """Base schema for a Kafka message payload."""
    topic: str = Field(..., description="The Kafka topic to produce the message to.")
    key: Optional[str] = Field(None, description="The optional message key for partitioning.")
    value: Any = Field(..., description="The message payload. Can be any JSON-serializable object.")

# --- Input Schemas ---

class MessageCreate(MessageBase):
    """Schema for creating a new message entry in the database."""
    pass

class MessageUpdate(BaseModel):
    """Schema for updating an existing message entry (e.g., status update)."""
    status: Optional[str] = Field(None, description="The production status (e.g., PRODUCED, FAILED).")
    error_message: Optional[str] = Field(None, description="Details of the error if production failed.")

# --- Output Schemas ---

class MessageResponse(MessageBase):
    """Schema for returning a full message entry from the database."""
    id: int
    status: str = Field(..., description="Current status of the message: PENDING, PRODUCED, FAILED.")
    created_at: datetime
    produced_at: Optional[datetime] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda dt: dt.isoformat(),
        }