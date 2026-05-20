from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, SecretStr
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    # Database Settings
    DATABASE_URL: SecretStr = Field(
        default="sqlite+aiosqlite:///./permify_production.db",
        description="The connection URL for the PostgreSQL database."
    )
    
    # Application Settings
    PROJECT_NAME: str = "Permify Production Service"
    VERSION: str = "1.0.0"
    DEBUG: bool = Field(default=False, description="Enable debug mode.")
    
    # Security Settings
    SECRET_KEY: SecretStr = Field(
        default="a-very-secret-key-that-should-be-changed-in-production",
        description="Secret key for security purposes."
    )
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # CORS Settings
    BACKEND_CORS_ORIGINS: list[str] = ["*"] # Allow all for simplicity, should be restricted in production

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()

# Log a confirmation that settings are loaded
logger.info(f"Settings loaded for project: {settings.PROJECT_NAME} (Debug: {settings.DEBUG})")