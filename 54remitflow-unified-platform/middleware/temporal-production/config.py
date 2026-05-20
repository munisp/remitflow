from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    """
    Application settings loaded from environment variables or .env file.
    """
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Application Settings ---
    APP_NAME: str = Field("Temporal Production API", description="Name of the application.")
    LOG_LEVEL: str = Field("INFO", description="Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL).")
    SECRET_KEY: str = Field("a-very-secret-key-that-should-be-changed-in-production", description="Secret key for security.")
    
    # --- Database Settings ---
    DATABASE_URL: str = Field(
        "sqlite:///./temporal_production.db", 
        description="Database connection URL (e.g., postgresql://user:pass@host/db or sqlite:///./test.db)"
    )

settings = Settings()