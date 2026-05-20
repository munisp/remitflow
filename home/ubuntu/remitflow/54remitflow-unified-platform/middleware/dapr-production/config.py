from pydantic import BaseSettings, Field
from typing import List

class Settings(BaseSettings):
    # Application Settings
    PROJECT_NAME: str = "Dapr Production Service"
    VERSION: str = "1.0.0"
    DEBUG: bool = Field(False, env="DEBUG")
    SECRET_KEY: str = Field("super-secret-key", env="SECRET_KEY")

    # Database Settings
    DATABASE_URL: str = Field("sqlite:///./dapr_production.db", env="DATABASE_URL")

    # Logging Settings
    LOG_LEVEL: str = Field("INFO", env="LOG_LEVEL")

    # CORS Settings
    BACKEND_CORS_ORIGINS: List[str] = ["*"] # Allow all for simplicity, but should be restricted in production

    class Config:
        env_file = ".env"
        env_file_encoding = 'utf-8'

settings = Settings()