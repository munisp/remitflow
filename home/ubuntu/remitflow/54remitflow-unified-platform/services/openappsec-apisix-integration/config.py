from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # Database settings
    DATABASE_URL: str = "sqlite:///./openappsec_apisix.db"
    
    # Application settings
    SERVICE_NAME: str = "OpenAppSec APISIX Integration API"
    VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    # Security settings (placeholder for a real-world implementation)
    SECRET_KEY: str = "super-secret-key-for-testing-only"
    
    # Logging settings
    LOG_LEVEL: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()