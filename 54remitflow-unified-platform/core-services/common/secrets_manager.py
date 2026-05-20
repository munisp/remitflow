"""
Secrets Management Abstraction Layer

Provides a unified interface for accessing secrets across all services.
Supports multiple backends:
- Environment variables (default, for development)
- AWS Secrets Manager (for production)
- HashiCorp Vault (for production)
- Azure Key Vault (for production)

For production deployments, configure the appropriate backend via SECRETS_BACKEND env var.
"""

import os
import logging
import json
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from functools import lru_cache

logger = logging.getLogger(__name__)


class SecretsBackend(ABC):
    """Abstract base class for secrets backends"""
    
    @abstractmethod
    def get_secret(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Get a secret value by key"""
        pass
    
    @abstractmethod
    def get_secret_json(self, key: str) -> Optional[Dict[str, Any]]:
        """Get a JSON secret and parse it"""
        pass
    
    @abstractmethod
    def health_check(self) -> bool:
        """Check if the backend is healthy"""
        pass


class EnvironmentSecretsBackend(SecretsBackend):
    """
    Environment variable-based secrets backend.
    Used for development and testing.
    
    WARNING: Not recommended for production with sensitive secrets.
    """
    
    def get_secret(self, key: str, default: Optional[str] = None) -> Optional[str]:
        return os.getenv(key, default)
    
    def get_secret_json(self, key: str) -> Optional[Dict[str, Any]]:
        value = os.getenv(key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                logger.error(f"Failed to parse JSON secret: {key}")
        return None
    
    def health_check(self) -> bool:
        return True


class AWSSecretsManagerBackend(SecretsBackend):
    """
    AWS Secrets Manager backend for production use.
    
    Configuration:
    - AWS_REGION: AWS region (default: us-east-1)
    - AWS_ACCESS_KEY_ID: AWS access key (or use IAM role)
    - AWS_SECRET_ACCESS_KEY: AWS secret key (or use IAM role)
    - SECRETS_PREFIX: Prefix for secret names (e.g., "remittance/prod/")
    """
    
    def __init__(self):
        self.region = os.getenv("AWS_REGION", "us-east-1")
        self.prefix = os.getenv("SECRETS_PREFIX", "")
        self._client = None
        
        try:
            import boto3
            self._client = boto3.client("secretsmanager", region_name=self.region)
            logger.info(f"AWS Secrets Manager backend initialized (region: {self.region})")
        except ImportError:
            logger.error("boto3 not installed - AWS Secrets Manager backend unavailable")
        except Exception as e:
            logger.error(f"Failed to initialize AWS Secrets Manager: {e}")
    
    def get_secret(self, key: str, default: Optional[str] = None) -> Optional[str]:
        if not self._client:
            return os.getenv(key, default)
        
        secret_name = f"{self.prefix}{key}"
        
        try:
            response = self._client.get_secret_value(SecretId=secret_name)
            return response.get("SecretString", default)
        except self._client.exceptions.ResourceNotFoundException:
            logger.warning(f"Secret not found: {secret_name}")
            return os.getenv(key, default)
        except Exception as e:
            logger.error(f"Failed to get secret {secret_name}: {e}")
            return os.getenv(key, default)
    
    def get_secret_json(self, key: str) -> Optional[Dict[str, Any]]:
        value = self.get_secret(key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                logger.error(f"Failed to parse JSON secret: {key}")
        return None
    
    def health_check(self) -> bool:
        if not self._client:
            return False
        try:
            self._client.list_secrets(MaxResults=1)
            return True
        except Exception:
            return False


class VaultSecretsBackend(SecretsBackend):
    """
    HashiCorp Vault backend for production use.
    
    Configuration:
    - VAULT_ADDR: Vault server address
    - VAULT_TOKEN: Vault token (or use other auth methods)
    - VAULT_NAMESPACE: Vault namespace (optional)
    - SECRETS_PATH: Base path for secrets (e.g., "secret/data/remittance/")
    """
    
    def __init__(self):
        self.vault_addr = os.getenv("VAULT_ADDR", "http://localhost:8200")
        self.vault_token = os.getenv("VAULT_TOKEN", "")
        self.namespace = os.getenv("VAULT_NAMESPACE", "")
        self.secrets_path = os.getenv("SECRETS_PATH", "secret/data/")
        self._client = None
        
        try:
            import hvac
            self._client = hvac.Client(
                url=self.vault_addr,
                token=self.vault_token,
                namespace=self.namespace if self.namespace else None
            )
            if self._client.is_authenticated():
                logger.info(f"Vault backend initialized (addr: {self.vault_addr})")
            else:
                logger.error("Vault authentication failed")
                self._client = None
        except ImportError:
            logger.error("hvac not installed - Vault backend unavailable")
        except Exception as e:
            logger.error(f"Failed to initialize Vault: {e}")
    
    def get_secret(self, key: str, default: Optional[str] = None) -> Optional[str]:
        if not self._client:
            return os.getenv(key, default)
        
        secret_path = f"{self.secrets_path}{key}"
        
        try:
            response = self._client.secrets.kv.v2.read_secret_version(path=key)
            data = response.get("data", {}).get("data", {})
            return data.get("value", default)
        except Exception as e:
            logger.warning(f"Failed to get secret {secret_path}: {e}")
            return os.getenv(key, default)
    
    def get_secret_json(self, key: str) -> Optional[Dict[str, Any]]:
        if not self._client:
            return None
        
        try:
            response = self._client.secrets.kv.v2.read_secret_version(path=key)
            return response.get("data", {}).get("data", {})
        except Exception as e:
            logger.warning(f"Failed to get JSON secret {key}: {e}")
            return None
    
    def health_check(self) -> bool:
        if not self._client:
            return False
        try:
            return self._client.is_authenticated()
        except Exception:
            return False


class SecretsManager:
    """
    Unified secrets manager that wraps the configured backend.
    
    Usage:
        secrets = get_secrets_manager()
        db_password = secrets.get_database_password()
        api_key = secrets.get_secret("SOME_API_KEY")
    """
    
    def __init__(self, backend: SecretsBackend):
        self._backend = backend
    
    def get_secret(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Get a secret by key"""
        return self._backend.get_secret(key, default)
    
    def get_secret_json(self, key: str) -> Optional[Dict[str, Any]]:
        """Get a JSON secret"""
        return self._backend.get_secret_json(key)
    
    # Convenience methods for common secrets
    
    def get_database_url(self, service_name: str = "default") -> str:
        """Get database URL for a service"""
        key = f"{service_name.upper()}_DATABASE_URL"
        return self.get_secret(key) or self.get_secret("DATABASE_URL") or \
            f"postgresql://remittance:remittance123@localhost:5432/remittance_{service_name}"
    
    def get_redis_url(self) -> str:
        """Get Redis URL"""
        return self.get_secret("REDIS_URL") or "redis://localhost:6379/0"
    
    def get_jwt_secret(self) -> str:
        """Get JWT signing secret"""
        secret = self.get_secret("JWT_SECRET")
        if not secret:
            logger.warning("JWT_SECRET not configured - using insecure default")
            return "insecure-default-jwt-secret-change-in-production"
        return secret
    
    def get_api_key(self, service: str) -> Optional[str]:
        """Get API key for an external service"""
        return self.get_secret(f"{service.upper()}_API_KEY")
    
    def get_api_secret(self, service: str) -> Optional[str]:
        """Get API secret for an external service"""
        return self.get_secret(f"{service.upper()}_API_SECRET")
    
    def get_encryption_key(self) -> str:
        """Get encryption key for sensitive data"""
        key = self.get_secret("ENCRYPTION_KEY")
        if not key:
            logger.warning("ENCRYPTION_KEY not configured - using insecure default")
            return "insecure-default-encryption-key-32b"
        return key
    
    def health_check(self) -> bool:
        """Check if secrets backend is healthy"""
        return self._backend.health_check()


@lru_cache(maxsize=1)
def get_secrets_manager() -> SecretsManager:
    """
    Get the configured secrets manager instance.
    
    Configure via SECRETS_BACKEND environment variable:
    - "env" (default): Environment variables
    - "aws": AWS Secrets Manager
    - "vault": HashiCorp Vault
    
    For production, use "aws" or "vault" with proper configuration.
    """
    backend_type = os.getenv("SECRETS_BACKEND", "env").lower()
    
    if backend_type == "aws":
        backend = AWSSecretsManagerBackend()
    elif backend_type == "vault":
        backend = VaultSecretsBackend()
    else:
        if os.getenv("ENVIRONMENT", "development") == "production":
            logger.warning("Using environment variables for secrets in production - NOT RECOMMENDED")
        backend = EnvironmentSecretsBackend()
    
    return SecretsManager(backend)


# Convenience function for direct access
def get_secret(key: str, default: Optional[str] = None) -> Optional[str]:
    """Get a secret value by key"""
    return get_secrets_manager().get_secret(key, default)


# Documentation for bank integration
INTEGRATION_DOCUMENTATION = """
# Secrets Management Integration Guide

## Overview
The platform uses a pluggable secrets management system.
For bank-grade deployments, you MUST use a proper secrets backend.

## Recommended Backends for Production

### AWS Secrets Manager
```
SECRETS_BACKEND=aws
AWS_REGION=us-east-1
SECRETS_PREFIX=remittance/prod/
# Use IAM roles for authentication (recommended)
# Or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
```

### HashiCorp Vault
```
SECRETS_BACKEND=vault
VAULT_ADDR=https://vault.example.com
VAULT_TOKEN=s.xxxxx (or use other auth methods)
VAULT_NAMESPACE=remittance
SECRETS_PATH=secret/data/remittance/
```

## Required Secrets

The following secrets must be configured:
- DATABASE_URL: PostgreSQL connection string
- REDIS_URL: Redis connection string
- JWT_SECRET: JWT signing key (min 32 chars)
- ENCRYPTION_KEY: Data encryption key (32 bytes)
- SANCTIONS_PROVIDER_API_KEY: Sanctions screening API key
- PAYSTACK_SECRET_KEY: Paystack API key
- FLUTTERWAVE_SECRET_KEY: Flutterwave API key
- NIBSS_API_KEY: NIBSS API key

## Security Requirements

1. Secrets must be rotated regularly (90 days max)
2. Access to secrets must be audited
3. Secrets must never be logged or exposed in error messages
4. Use separate secrets for each environment (dev/staging/prod)
5. Enable encryption at rest for the secrets backend
"""
