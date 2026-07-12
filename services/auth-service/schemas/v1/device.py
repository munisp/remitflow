from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: str
    device_ip: str
    user_agent: str
    tenant_id: str
    user_email: str
    keycloak_id: str
    created_at: datetime
    updated_at: datetime


class DeleteDeviceResponse(BaseModel):
    message: str
    device_id: str
