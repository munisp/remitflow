"""
HashiCorp Vault Client for Secrets Management
Provides secure secret retrieval with caching and fallback to environment variables
"""

import os
import logging
from typing import Dict, Any, Optional
from functools import lru_cache
import json

logger = logging.getLogger(__name__)

# Configuration
VAULT_ADDR = os.getenv("VAULT_ADDR", "http://vault:8200")
VAULT_TOKEN = os.getenv("VAULT_TOKEN", "")
VAULT_ROLE = os.getenv("VAULT_ROLE", "")
VAULT_ENABLED = os.getenv("VAULT_ENABLED", "false").lower() == "true"
VAULT_MOUNT_POINT = os.getenv("VAULT_MOUNT_POINT", "secret")


class VaultClient:
    """
    Vault client with caching and environment variable fallback
    """
    
    def __init__(self, addr: str = None, token: str = None, role: str = None):
        self.addr = addr or VAULT_ADDR
        self.token = token or VAULT_TOKEN
        self.role = role or VAULT_ROLE
        self.client = None
        self._initialized = False
        self._fallback_mode = False
        self._cache: Dict[str, Any] = {}
    
    def initialize(self):
        """Initialize Vault client"""
        if not VAULT_ENABLED:
            logger.info("Vault disabled, using environment variable fallback")
            self._fallback_mode = True
            self._initialized = True
            return
        
        try:
            import hvac
            
            self.client = hvac.Client(url=self.addr, token=self.token)
            
            # If using Kubernetes auth
            if self.role and not self.token:
                jwt_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
                if os.path.exists(jwt_path):
                    with open(jwt_path, "r") as f:
                        jwt = f.read()
                    self.client.auth.kubernetes.login(role=self.role, jwt=jwt)
            
            if self.client.is_authenticated():
                self._initialized = True
                logger.info("Vault client initialized successfully")
            else:
                logger.warning("Vault authentication failed, using fallback mode")
                self._fallback_mode = True
                self._initialized = True
        except ImportError:
            logger.warning("hvac not installed, using environment variable fallback")
            self._fallback_mode = True
            self._initialized = True
        except Exception as e:
            logger.warning(f"Failed to initialize Vault client: {e}, using fallback mode")
            self._fallback_mode = True
            self._initialized = True
    
    def get_secret(self, path: str, key: str = None, default: Any = None) -> Any:
        """
        Get secret from Vault or environment variable
        
        Args:
            path: Secret path in Vault (e.g., "payment-service/database")
            key: Specific key within the secret (optional)
            default: Default value if secret not found
        
        Returns:
            Secret value or default
        """
        if not self._initialized:
            self.initialize()
        
        # Check cache first
        cache_key = f"{path}:{key}" if key else path
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        if self._fallback_mode:
            # Fall back to environment variables
            env_key = self._path_to_env_var(path, key)
            value = os.getenv(env_key, default)
            self._cache[cache_key] = value
            return value
        
        try:
            # Read from Vault
            secret = self.client.secrets.kv.v2.read_secret_version(
                path=path,
                mount_point=VAULT_MOUNT_POINT
            )
            
            data = secret.get("data", {}).get("data", {})
            
            if key:
                value = data.get(key, default)
            else:
                value = data
            
            self._cache[cache_key] = value
            return value
        except Exception as e:
            logger.warning(f"Failed to read secret {path}: {e}, using fallback")
            env_key = self._path_to_env_var(path, key)
            value = os.getenv(env_key, default)
            self._cache[cache_key] = value
            return value
    
    def get_database_url(self, service_name: str) -> str:
        """Get database URL for a service"""
        # Try Vault first
        secret = self.get_secret(f"{service_name}/database")
        if isinstance(secret, dict) and "url" in secret:
            return secret["url"]
        
        # Fall back to environment variable
        env_var = f"{service_name.upper().replace('-', '_')}_DATABASE_URL"
        return os.getenv(env_var, os.getenv("DATABASE_URL", ""))
    
    def get_api_key(self, service_name: str, key_name: str) -> str:
        """Get API key for a service"""
        secret = self.get_secret(f"{service_name}/api-keys", key_name)
        if secret:
            return secret
        
        # Fall back to environment variable
        env_var = f"{key_name.upper().replace('-', '_')}"
        return os.getenv(env_var, "")
    
    def get_payment_gateway_credentials(self, gateway: str) -> Dict[str, str]:
        """Get payment gateway credentials"""
        secret = self.get_secret(f"payment-gateways/{gateway}")
        if isinstance(secret, dict):
            return secret
        
        # Fall back to environment variables
        gateway_upper = gateway.upper()
        return {
            "api_key": os.getenv(f"{gateway_upper}_API_KEY", ""),
            "api_secret": os.getenv(f"{gateway_upper}_API_SECRET", ""),
            "webhook_secret": os.getenv(f"{gateway_upper}_WEBHOOK_SECRET", "")
        }
    
    def get_corridor_credentials(self, corridor: str) -> Dict[str, str]:
        """Get payment corridor credentials"""
        secret = self.get_secret(f"payment-corridors/{corridor}")
        if isinstance(secret, dict):
            return secret
        
        # Fall back to environment variables
        corridor_upper = corridor.upper()
        return {
            "api_key": os.getenv(f"{corridor_upper}_API_KEY", ""),
            "api_secret": os.getenv(f"{corridor_upper}_API_SECRET", ""),
            "client_id": os.getenv(f"{corridor_upper}_CLIENT_ID", ""),
            "client_secret": os.getenv(f"{corridor_upper}_CLIENT_SECRET", "")
        }
    
    def get_jwt_secret(self) -> str:
        """Get JWT signing secret"""
        secret = self.get_secret("auth/jwt", "secret")
        if secret:
            return secret
        return os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
    
    def get_encryption_key(self, key_name: str = "default") -> str:
        """Get encryption key"""
        secret = self.get_secret(f"encryption/{key_name}", "key")
        if secret:
            return secret
        return os.getenv(f"ENCRYPTION_KEY_{key_name.upper()}", "")
    
    def _path_to_env_var(self, path: str, key: str = None) -> str:
        """Convert Vault path to environment variable name"""
        # Convert path like "payment-service/database" to "PAYMENT_SERVICE_DATABASE"
        env_var = path.upper().replace("/", "_").replace("-", "_")
        if key:
            env_var = f"{env_var}_{key.upper().replace('-', '_')}"
        return env_var
    
    def clear_cache(self):
        """Clear the secret cache"""
        self._cache.clear()
    
    def refresh_secret(self, path: str, key: str = None):
        """Refresh a specific secret from Vault"""
        cache_key = f"{path}:{key}" if key else path
        if cache_key in self._cache:
            del self._cache[cache_key]
        return self.get_secret(path, key)


# Global client instance
_vault_client: Optional[VaultClient] = None


def get_vault_client() -> VaultClient:
    """Get or create Vault client instance"""
    global _vault_client
    if _vault_client is None:
        _vault_client = VaultClient()
    return _vault_client


def get_secret(path: str, key: str = None, default: Any = None) -> Any:
    """
    Convenience function to get secrets
    
    Usage:
        db_url = get_secret("payment-service/database", "url")
        api_key = get_secret("paystack", "api_key")
    """
    return get_vault_client().get_secret(path, key, default)


def get_database_url(service_name: str) -> str:
    """Get database URL for a service"""
    return get_vault_client().get_database_url(service_name)


def get_api_key(service_name: str, key_name: str) -> str:
    """Get API key for a service"""
    return get_vault_client().get_api_key(service_name, key_name)


def get_payment_gateway_credentials(gateway: str) -> Dict[str, str]:
    """Get payment gateway credentials"""
    return get_vault_client().get_payment_gateway_credentials(gateway)


def get_corridor_credentials(corridor: str) -> Dict[str, str]:
    """Get payment corridor credentials"""
    return get_vault_client().get_corridor_credentials(corridor)
