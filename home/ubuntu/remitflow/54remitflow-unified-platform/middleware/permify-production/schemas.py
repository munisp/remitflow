from pydantic import BaseModel, Field, validator
from typing import Optional, List, Union
from datetime import datetime

# --- Base Schemas ---

class Subject(BaseModel):
    """Represents the subject part of a relational tuple."""
    type: str = Field(..., description="The type of the subject (e.g., 'user', 'organization').")
    id: str = Field(..., description="The unique identifier of the subject.")
    relation: Optional[str] = Field(None, description="The relation of the subject, used for user sets (e.g., 'member').")

class Entity(BaseModel):
    """Represents the entity part of a relational tuple or attribute."""
    type: str = Field(..., description="The type of the entity (e.g., 'document', 'account').")
    id: str = Field(..., description="The unique identifier of the entity.")

# --- Relational Tuple Schemas (Relationships) ---

class RelationalTupleBase(BaseModel):
    """Base schema for a Relational Tuple (Relationship)."""
    entity: Entity = Field(..., description="The entity the relationship is about.")
    relation: str = Field(..., description="The relation between the entity and the subject (e.g., 'owner', 'admin').")
    subject: Subject = Field(..., description="The subject of the relationship.")

class RelationalTupleCreate(RelationalTupleBase):
    """Schema for creating a new Relational Tuple."""
    pass

class RelationalTupleUpdate(RelationalTupleBase):
    """Schema for updating a Relational Tuple (used for PUT/PATCH if needed, but typically relationships are created/deleted)."""
    pass

class RelationalTupleInDB(RelationalTupleBase):
    """Schema for a Relational Tuple as stored in the database (response model)."""
    id: int = Field(..., description="The unique database ID of the tuple.")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# --- Attribute Schemas ---

class AttributeBase(BaseModel):
    """Base schema for an Attribute."""
    entity: Entity = Field(..., description="The entity the attribute is attached to.")
    attribute_name: str = Field(..., description="The name of the attribute (e.g., 'balance', 'is_restricted').")
    attribute_value: Union[str, int, float, bool, List[str]] = Field(..., description="The value of the attribute.")
    attribute_type: str = Field(..., description="The data type of the attribute (e.g., 'double', 'boolean', 'string', 'string[]').")

    @validator('attribute_type')
    def validate_attribute_type(cls, v):
        valid_types = ['double', 'boolean', 'string', 'string[]', 'integer']
        if v not in valid_types:
            raise ValueError(f"Invalid attribute_type: {v}. Must be one of {valid_types}")
        return v

class AttributeCreate(AttributeBase):
    """Schema for creating a new Attribute."""
    pass

class AttributeUpdate(AttributeBase):
    """Schema for updating an existing Attribute."""
    pass

class AttributeInDB(AttributeBase):
    """Schema for an Attribute as stored in the database (response model)."""
    id: int = Field(..., description="The unique database ID of the attribute.")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# --- Query Schemas ---

class TupleFilter(BaseModel):
    """Schema for filtering relational tuples."""
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    relation: Optional[str] = None
    subject_type: Optional[str] = None
    subject_id: Optional[str] = None
    subject_relation: Optional[str] = None

class AttributeFilter(BaseModel):
    """Schema for filtering attributes."""
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    attribute_name: Optional[str] = None
    attribute_type: Optional[str] = None
    attribute_value: Optional[str] = None # Value is stored as string in DB, so filter on string