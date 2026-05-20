"""
CORS Configuration for PIX Integration Service
Handles Cross-Origin Resource Sharing for frontend domains
"""

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from typing import List
import logging

from config import settings

logger = logging.getLogger(__name__)


class CORSConfig:
    """
    CORS configuration manager
    
    Handles CORS middleware setup with environment-based configuration
    for development and production environments
    """
    
    @staticmethod
    def get_allowed_origins() -> List[str]:
        """
        Get list of allowed origins from environment configuration
        
        Returns:
            List of allowed origin URLs
        """
        # Get origins from environment (comma-separated)
        origins_str = settings.CORS_ALLOWED_ORIGINS
        
        if origins_str == "*":
            # Allow all origins (DEVELOPMENT ONLY)
            if settings.ENVIRONMENT == "production":
                logger.critical(
                    "SECURITY WARNING: CORS_ALLOWED_ORIGINS='*' in production! "
                    "This is a security risk. Please configure specific domains."
                )
            return ["*"]
        
        # Parse comma-separated origins
        origins = [origin.strip() for origin in origins_str.split(",") if origin.strip()]
        
        # Validate origins
        for origin in origins:
            if not origin.startswith(("http://", "https://")):
                logger.warning(f"Invalid origin format: {origin} (must start with http:// or https://)")
        
        logger.info(f"Configured CORS allowed origins: {origins}")
        
        return origins
    
    @staticmethod
    def get_allowed_methods() -> List[str]:
        """
        Get list of allowed HTTP methods
        
        Returns:
            List of allowed HTTP methods
        """
        methods_str = settings.CORS_ALLOWED_METHODS
        
        if methods_str == "*":
            return ["*"]
        
        methods = [method.strip().upper() for method in methods_str.split(",") if method.strip()]
        
        logger.info(f"Configured CORS allowed methods: {methods}")
        
        return methods
    
    @staticmethod
    def get_allowed_headers() -> List[str]:
        """
        Get list of allowed headers
        
        Returns:
            List of allowed headers
        """
        headers_str = settings.CORS_ALLOWED_HEADERS
        
        if headers_str == "*":
            return ["*"]
        
        headers = [header.strip().lower() for header in headers_str.split(",") if header.strip()]
        
        logger.info(f"Configured CORS allowed headers: {headers}")
        
        return headers
    
    @staticmethod
    def configure_cors(app: FastAPI) -> None:
        """
        Configure CORS middleware for FastAPI application
        
        Args:
            app: FastAPI application instance
        """
        allowed_origins = CORSConfig.get_allowed_origins()
        allowed_methods = CORSConfig.get_allowed_methods()
        allowed_headers = CORSConfig.get_allowed_headers()
        
        # Add CORS middleware
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
            allow_methods=allowed_methods,
            allow_headers=allowed_headers,
            expose_headers=settings.CORS_EXPOSE_HEADERS.split(",") if settings.CORS_EXPOSE_HEADERS else [],
            max_age=settings.CORS_MAX_AGE,
        )
        
        logger.info("CORS middleware configured successfully")
        
        # Log security warnings
        if settings.ENVIRONMENT == "production":
            if "*" in allowed_origins:
                logger.critical("SECURITY RISK: Wildcard (*) CORS origins in production!")
            if "*" in allowed_methods:
                logger.warning("SECURITY WARNING: Wildcard (*) CORS methods in production")
            if "*" in allowed_headers:
                logger.warning("SECURITY WARNING: Wildcard (*) CORS headers in production")
        
        # Log configuration summary
        logger.info(f"""
CORS Configuration Summary:
- Environment: {settings.ENVIRONMENT}
- Allowed Origins: {allowed_origins}
- Allow Credentials: {settings.CORS_ALLOW_CREDENTIALS}
- Allowed Methods: {allowed_methods}
- Allowed Headers: {allowed_headers}
- Max Age: {settings.CORS_MAX_AGE} seconds
        """)
    
    @staticmethod
    def validate_configuration() -> bool:
        """
        Validate CORS configuration for security issues
        
        Returns:
            True if configuration is valid, False otherwise
        """
        issues = []
        
        # Check production configuration
        if settings.ENVIRONMENT == "production":
            if settings.CORS_ALLOWED_ORIGINS == "*":
                issues.append("CRITICAL: Wildcard (*) origins in production")
            
            if not settings.CORS_ALLOWED_ORIGINS:
                issues.append("ERROR: No CORS origins configured")
            
            # Check for localhost in production
            if "localhost" in settings.CORS_ALLOWED_ORIGINS.lower():
                issues.append("WARNING: localhost in production CORS origins")
            
            if "127.0.0.1" in settings.CORS_ALLOWED_ORIGINS:
                issues.append("WARNING: 127.0.0.1 in production CORS origins")
        
        # Check credentials with wildcard origins
        if settings.CORS_ALLOWED_ORIGINS == "*" and settings.CORS_ALLOW_CREDENTIALS:
            issues.append("ERROR: Cannot use credentials with wildcard (*) origins")
        
        # Log issues
        if issues:
            logger.error("CORS Configuration Issues:")
            for issue in issues:
                logger.error(f"  - {issue}")
            return False
        
        logger.info("CORS configuration validation passed")
        return True


# Predefined CORS configurations for common scenarios

class CORSPresets:
    """Predefined CORS configurations for common use cases"""
    
    @staticmethod
    def development() -> dict:
        """CORS configuration for local development"""
        return {
            "allow_origins": ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"],
            "allow_credentials": True,
            "allow_methods": ["*"],
            "allow_headers": ["*"],
            "max_age": 600,
        }
    
    @staticmethod
    def production_strict() -> dict:
        """Strict CORS configuration for production"""
        return {
            "allow_origins": [],  # Must be configured via environment
            "allow_credentials": True,
            "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            "allow_headers": [
                "accept",
                "accept-encoding",
                "authorization",
                "content-type",
                "dnt",
                "origin",
                "user-agent",
                "x-csrftoken",
                "x-requested-with",
            ],
            "expose_headers": ["content-length", "content-type"],
            "max_age": 3600,
        }
    
    @staticmethod
    def production_relaxed() -> dict:
        """Relaxed CORS configuration for production (not recommended)"""
        return {
            "allow_origins": [],  # Must be configured via environment
            "allow_credentials": True,
            "allow_methods": ["*"],
            "allow_headers": ["*"],
            "max_age": 3600,
        }
    
    @staticmethod
    def api_only() -> dict:
        """CORS configuration for API-only access (no credentials)"""
        return {
            "allow_origins": ["*"],
            "allow_credentials": False,
            "allow_methods": ["GET", "POST"],
            "allow_headers": ["accept", "content-type"],
            "max_age": 3600,
        }
