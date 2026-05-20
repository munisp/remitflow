from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # Database Settings
    DATABASE_URL: str = "sqlite:///./apisix_production.db"
    
    # Application Settings
    PROJECT_NAME: str = "APISIX Production Management API"
    API_V1_STR: str = "/api/v1"
    
    # CORS Settings
    BACKEND_CORS_ORIGINS: list[str] = ["*"] # Allow all for simplicity in this example
    
    # Logging Settings
    LOG_LEVEL: str = "INFO"
    
    # Security Settings (Placeholder for a real application)
    SECRET_KEY: str = "super-secret-key-for-testing"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()