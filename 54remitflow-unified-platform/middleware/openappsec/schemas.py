from pydantic import BaseModel, Field, validator
from typing import List, Optional, Any
from datetime import datetime

# --- Nested Schemas for Specific Rules ---

class SpecificRuleBase(BaseModel):
    """Base schema for a specific rule within the WAF policy."""
    host: str = Field(..., description="The host or host/path combination the rule applies to, e.g., 'web.server.com/api/v1'.")
    mode: str = Field("detect-learn", description="Security engine operation mode for this specific rule: 'prevent-learn', 'detect-learn', 'prevent', 'detect', or 'inactive'.")
    practices: List[str] = Field(..., description="List of practice resource names to apply, e.g., ['webapp-best-practice'].")
    custom_response: Optional[str] = Field(None, description="Reference to a CustomResponse resource.")
    
    @validator('mode')
    def validate_mode(cls, v):
        valid_modes = {'prevent-learn', 'detect-learn', 'prevent', 'detect', 'inactive'}
        if v not in valid_modes:
            raise ValueError(f"Mode must be one of {valid_modes}")
        return v

class SpecificRule(SpecificRuleBase):
    """Schema for a specific rule with all fields."""
    class Config:
        from_attributes = True

# --- Main WAF Policy Schemas ---

class WAFPolicyBase(BaseModel):
    """Base schema for WAF Policy data (used for creation and update)."""
    name: str = Field(..., min_length=3, max_length=100, description="Unique name for the WAF policy.")
    description: Optional[str] = Field(None, description="A brief description of the policy's purpose.")
    mode: str = Field("detect-learn", description="Default security engine operation mode: 'prevent-learn', 'detect-learn', 'prevent', 'detect', or 'inactive'.")
    is_active: bool = Field(True, description="Whether the policy is currently active.")
    default_practices: List[str] = Field(..., description="List of default practice resource names to apply globally.")
    specific_rules: List[SpecificRuleBase] = Field(..., description="List of specific rules that override the default policy for certain hosts/paths.")

    @validator('mode')
    def validate_mode(cls, v):
        valid_modes = {'prevent-learn', 'detect-learn', 'prevent', 'detect', 'inactive'}
        if v not in valid_modes:
            raise ValueError(f"Mode must be one of {valid_modes}")
        return v

class WAFPolicyCreate(WAFPolicyBase):
    """Schema for creating a new WAF Policy."""
    pass

class WAFPolicyUpdate(WAFPolicyBase):
    """Schema for updating an existing WAF Policy (all fields are optional for PATCH)."""
    name: Optional[str] = Field(None, min_length=3, max_length=100, description="Unique name for the WAF policy.")
    mode: Optional[str] = Field(None, description="Default security engine operation mode.")
    default_practices: Optional[List[str]] = Field(None, description="List of default practice resource names to apply globally.")
    specific_rules: Optional[List[SpecificRuleBase]] = Field(None, description="List of specific rules that override the default policy.")
    
    @validator('mode')
    def validate_mode(cls, v):
        if v is not None:
            valid_modes = {'prevent-learn', 'detect-learn', 'prevent', 'detect', 'inactive'}
            if v not in valid_modes:
                raise ValueError(f"Mode must be one of {valid_modes}")
        return v

class WAFPolicy(WAFPolicyBase):
    """Schema for reading a WAF Policy (includes database-generated fields)."""
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        # This is required for Pydantic to read data from SQLAlchemy models
        from_attributes = True
        json_encoders = {
            datetime: lambda dt: dt.isoformat(),
        }