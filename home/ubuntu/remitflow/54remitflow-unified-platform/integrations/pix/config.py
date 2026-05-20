"""
Configuration for PIX Integration Service
Uses environment variables for sensitive data
"""

import os
import secrets
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables
    
    For production deployment:
    - Set JWT_SECRET_KEY to a secure random value
    - Set DATABASE_URL to your PostgreSQL connection string
    - Configure ALLOWED_ORIGINS for CORS
    """
    
    # Project Settings
    PROJECT_NAME: str = "PIX Integration Service"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    
    # Database Settings
    # Production: postgresql://user:password@host:port/database
    # Development: sqlite:///./pix_integration.db
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://pix_user:pix_password@localhost:5432/pix_integration_db"
    )
    
    # JWT Settings - CRITICAL: Must be set via environment in production
    SECRET_KEY: str = os.getenv(
        "JWT_SECRET_KEY",
        # WARNING: This default is for development only!
        # In production, MUST set JWT_SECRET_KEY environment variable
        secrets.token_urlsafe(32) if os.getenv("ENVIRONMENT") == "production" 
        else "dev-secret-key-change-in-production"
    )
    ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
    
    # Security Settings
    PASSWORD_MIN_LENGTH: int = int(os.getenv("PASSWORD_MIN_LENGTH", "8"))
    MAX_LOGIN_ATTEMPTS: int = int(os.getenv("MAX_LOGIN_ATTEMPTS", "5"))
    ACCOUNT_LOCKOUT_MINUTES: int = int(os.getenv("ACCOUNT_LOCKOUT_MINUTES", "30"))
    
    # CORS Settings
    # Comma-separated list of allowed origins, or "*" for all (development only)
    # Example: "https://app.example.com,https://admin.example.com"
    CORS_ALLOWED_ORIGINS: str = os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000" if ENVIRONMENT == "development"
        else ""  # Must be configured in production
    )
    
    # Allow credentials (cookies, authorization headers)
    CORS_ALLOW_CREDENTIALS: bool = os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() == "true"
    
    # Allowed HTTP methods (comma-separated or "*")
    CORS_ALLOWED_METHODS: str = os.getenv(
        "CORS_ALLOWED_METHODS",
        "*" if ENVIRONMENT == "development" else "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    )
    
    # Allowed headers (comma-separated or "*")
    CORS_ALLOWED_HEADERS: str = os.getenv(
        "CORS_ALLOWED_HEADERS",
        "*" if ENVIRONMENT == "development" 
        else "accept,accept-encoding,authorization,content-type,dnt,origin,user-agent,x-csrftoken,x-requested-with"
    )
    
    # Headers to expose to the browser
    CORS_EXPOSE_HEADERS: str = os.getenv(
        "CORS_EXPOSE_HEADERS",
        "content-length,content-type"
    )
    
    # Max age for preflight requests (in seconds)
    CORS_MAX_AGE: int = int(os.getenv(
        "CORS_MAX_AGE",
        "600" if ENVIRONMENT == "development" else "3600"
    ))
    REQUIRE_EMAIL_VERIFICATION: bool = os.getenv("REQUIRE_EMAIL_VERIFICATION", "False").lower() == "true"
    
    # Monitoring and Alerting Settings
    # Email Alerts
    ALERT_EMAIL_ENABLED: bool = os.getenv("ALERT_EMAIL_ENABLED", "False").lower() == "true"
    ALERT_EMAIL_TO: str = os.getenv("ALERT_EMAIL_TO", "security@example.com")
    
    # SMTP Configuration (for email alerts)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM_EMAIL: str = os.getenv("SMTP_FROM_EMAIL", "noreply@example.com")
    SMTP_USE_TLS: bool = os.getenv("SMTP_USE_TLS", "True").lower() == "true"
    
    # Webhook Alerts (Slack, Discord, PagerDuty, etc.)
    ALERT_WEBHOOK_URL: str = os.getenv("ALERT_WEBHOOK_URL", "")
    
    # PIX External Service Settings (for future BACEN integration)
    PIX_API_BASE_URL: str = os.getenv("PIX_API_BASE_URL", "https://mock-pix-api.com/v1")
    PIX_API_KEY: str = os.getenv("PIX_API_KEY", "mock-api-key-12345")
    PIX_WEBHOOK_SECRET: str = os.getenv("PIX_WEBHOOK_SECRET", "webhook-secret-key")
    
    # Application Settings
    API_V1_PREFIX: str = "/api/v1"
    DOCS_URL: Optional[str] = "/docs" if DEBUG else None
    REDOC_URL: Optional[str] = "/redoc" if DEBUG else None
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )
    
    def get_database_url(self) -> str:
        """Get database URL with proper formatting"""
        # Handle both postgresql:// and postgres:// schemes
        db_url = self.DATABASE_URL
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        return db_url
    
    def is_production(self) -> bool:
        """Check if running in production environment"""
        return self.ENVIRONMENT.lower() == "production"
    
    def validate_production_config(self) -> List[str]:
        """
        Validate that production configuration is secure
        Returns list of configuration warnings/errors
        """
        warnings = []
        
        if self.is_production():
            if self.SECRET_KEY == "dev-secret-key-change-in-production":
                warnings.append("CRITICAL: JWT_SECRET_KEY not set in production!")
            
            if self.DEBUG:
                warnings.append("WARNING: DEBUG mode enabled in production")
            
            if "localhost" in self.DATABASE_URL:
                warnings.append("WARNING: Using localhost database in production")
            
            if self.PIX_API_KEY == "mock-api-key-12345":
                warnings.append("WARNING: Using mock PIX API key in production")
        
        return warnings


# Global settings instance
settings = Settings()

# Validate production configuration on import
if settings.is_production():
    config_warnings = settings.validate_production_config()
    if config_warnings:
        import warnings as py_warnings
        for warning in config_warnings:
            py_warnings.warn(warning, UserWarning)
