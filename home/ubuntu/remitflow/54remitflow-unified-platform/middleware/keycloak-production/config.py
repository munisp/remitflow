from pydantic_settings import BaseSettings, SettingsConfigConfigDict
from pydantic import Field
from typing import Optional

class Settings(BaseSettings):
    # Database Settings
    DATABASE_URL: str = Field(..., description="The connection URL for the PostgreSQL database.")
    
    # Application Settings
    SERVICE_NAME: str = "keycloak-production-service"
    DEBUG: bool = False
    
    # Keycloak/Security Settings (Used for securing the API itself)
    KEYCLOAK_REALM: str = Field(..., description="The Keycloak realm name for API authentication.")
    KEYCLOAK_AUDIENCE: str = Field(..., description="The Keycloak audience for API authentication.")
    KEYCLOAK_SERVER_URL: str = Field(..., description="The base URL of the Keycloak server.")
    
    # Logging Settings
    LOG_LEVEL: str = "INFO"
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()