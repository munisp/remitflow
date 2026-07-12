from typing import Optional

from pydantic import BaseModel, ConfigDict


class CreateKeycloakUser(BaseModel):
    email: str
    user_name: str
    password: Optional[str] = None


class GetKeycloakUserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    username: Optional[str] = None
    email: Optional[str] = None
    enabled: Optional[bool] = None
