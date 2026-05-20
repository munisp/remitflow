"""
Production Secrets Management with HashiCorp Vault and KMS Integration
Implements secret rotation, encryption, and secure access patterns
"""

import os
import json
import time
import logging
import hashlib
import base64
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import lru_cache
import asyncio
from abc import ABC, abstractmethod

import httpx
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend

logger = logging.getLogger(__name__)


class SecretsError(Exception):
    """Base exception for secrets management errors"""
    pass


class SecretNotFoundError(SecretsError):
    """Secret not found"""
    pass


class SecretAccessDeniedError(SecretsError):
    """Access to secret denied"""
    pass


class SecretRotationError(SecretsError):
    """Secret rotation failed"""
    pass


@dataclass
class SecretMetadata:
    """Metadata for a secret"""
    name: str
    version: int
    created_at: datetime
    expires_at: Optional[datetime]
    rotation_policy: Optional[str]
    last_rotated: Optional[datetime]
    access_count: int = 0
    tags: Dict[str, str] = field(default_factory=dict)


@dataclass
class Secret:
    """A secret with its value and metadata"""
    name: str
    value: str
    metadata: SecretMetadata
    
    def __repr__(self):
        return f"Secret(name={self.name}, version={self.metadata.version})"


class SecretsBackend(ABC):
    """Abstract base class for secrets backends"""
    
    @abstractmethod
    async def get_secret(self, path: str, version: Optional[int] = None) -> Secret:
        """Get a secret by path"""
        pass
    
    @abstractmethod
    async def set_secret(self, path: str, value: str, metadata: Optional[Dict] = None) -> SecretMetadata:
        """Set a secret"""
        pass
    
    @abstractmethod
    async def delete_secret(self, path: str, version: Optional[int] = None) -> bool:
        """Delete a secret"""
        pass
    
    @abstractmethod
    async def list_secrets(self, path: str) -> List[str]:
        """List secrets at path"""
        pass
    
    @abstractmethod
    async def rotate_secret(self, path: str, new_value: str) -> SecretMetadata:
        """Rotate a secret"""
        pass


class VaultSecretsBackend(SecretsBackend):
    """HashiCorp Vault secrets backend"""
    
    def __init__(
        self,
        vault_addr: str = None,
        vault_token: str = None,
        vault_role: str = None,
        vault_namespace: str = None,
        kv_mount: str = "secret",
        kv_version: int = 2
    ):
        self.vault_addr = vault_addr or os.getenv("VAULT_ADDR", "http://vault:8200")
        self.vault_token = vault_token or os.getenv("VAULT_TOKEN")
        self.vault_role = vault_role or os.getenv("VAULT_ROLE")
        self.vault_namespace = vault_namespace or os.getenv("VAULT_NAMESPACE")
        self.kv_mount = kv_mount
        self.kv_version = kv_version
        self._client: Optional[httpx.AsyncClient] = None
        self._token_expiry: float = 0
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.vault_addr,
                timeout=30.0
            )
        return self._client
    
    async def _get_headers(self) -> Dict[str, str]:
        """Get request headers with authentication"""
        headers = {"Content-Type": "application/json"}
        
        # Check if token needs refresh
        if self.vault_token:
            headers["X-Vault-Token"] = self.vault_token
        elif self.vault_role:
            # Use Kubernetes auth
            await self._authenticate_kubernetes()
            headers["X-Vault-Token"] = self.vault_token
        
        if self.vault_namespace:
            headers["X-Vault-Namespace"] = self.vault_namespace
        
        return headers
    
    async def _authenticate_kubernetes(self):
        """Authenticate using Kubernetes service account"""
        if time.time() < self._token_expiry - 60:
            return  # Token still valid
        
        # Read service account token
        try:
            with open("/var/run/secrets/kubernetes.io/serviceaccount/token") as f:
                jwt = f.read()
        except FileNotFoundError:
            raise SecretsError("Kubernetes service account token not found")
        
        client = await self._get_client()
        response = await client.post(
            f"/v1/auth/kubernetes/login",
            json={"role": self.vault_role, "jwt": jwt}
        )
        
        if response.status_code != 200:
            raise SecretsError(f"Vault authentication failed: {response.text}")
        
        data = response.json()
        self.vault_token = data["auth"]["client_token"]
        self._token_expiry = time.time() + data["auth"]["lease_duration"]
        logger.info("Authenticated with Vault using Kubernetes auth")
    
    def _get_kv_path(self, path: str, data: bool = False) -> str:
        """Get the full KV path"""
        if self.kv_version == 2:
            prefix = "data" if data else "metadata"
            return f"/v1/{self.kv_mount}/{prefix}/{path}"
        return f"/v1/{self.kv_mount}/{path}"
    
    async def get_secret(self, path: str, version: Optional[int] = None) -> Secret:
        """Get a secret from Vault"""
        client = await self._get_client()
        headers = await self._get_headers()
        
        url = self._get_kv_path(path, data=True)
        if version and self.kv_version == 2:
            url += f"?version={version}"
        
        response = await client.get(url, headers=headers)
        
        if response.status_code == 404:
            raise SecretNotFoundError(f"Secret not found: {path}")
        elif response.status_code == 403:
            raise SecretAccessDeniedError(f"Access denied to secret: {path}")
        elif response.status_code != 200:
            raise SecretsError(f"Failed to get secret: {response.text}")
        
        data = response.json()
        
        if self.kv_version == 2:
            secret_data = data["data"]["data"]
            metadata = data["data"]["metadata"]
            value = secret_data.get("value", json.dumps(secret_data))
            
            return Secret(
                name=path,
                value=value,
                metadata=SecretMetadata(
                    name=path,
                    version=metadata["version"],
                    created_at=datetime.fromisoformat(metadata["created_time"].replace("Z", "+00:00")),
                    expires_at=None,
                    rotation_policy=None,
                    last_rotated=None
                )
            )
        else:
            return Secret(
                name=path,
                value=data["data"].get("value", json.dumps(data["data"])),
                metadata=SecretMetadata(
                    name=path,
                    version=1,
                    created_at=datetime.now(),
                    expires_at=None,
                    rotation_policy=None,
                    last_rotated=None
                )
            )
    
    async def set_secret(self, path: str, value: str, metadata: Optional[Dict] = None) -> SecretMetadata:
        """Set a secret in Vault"""
        client = await self._get_client()
        headers = await self._get_headers()
        
        url = self._get_kv_path(path, data=True)
        
        payload = {"data": {"value": value}}
        if metadata:
            payload["data"].update(metadata)
        
        response = await client.post(url, headers=headers, json=payload)
        
        if response.status_code == 403:
            raise SecretAccessDeniedError(f"Access denied to set secret: {path}")
        elif response.status_code not in (200, 204):
            raise SecretsError(f"Failed to set secret: {response.text}")
        
        data = response.json() if response.status_code == 200 else {}
        
        return SecretMetadata(
            name=path,
            version=data.get("data", {}).get("version", 1),
            created_at=datetime.now(),
            expires_at=None,
            rotation_policy=None,
            last_rotated=None
        )
    
    async def delete_secret(self, path: str, version: Optional[int] = None) -> bool:
        """Delete a secret from Vault"""
        client = await self._get_client()
        headers = await self._get_headers()
        
        if version and self.kv_version == 2:
            url = f"/v1/{self.kv_mount}/delete/{path}"
            response = await client.post(url, headers=headers, json={"versions": [version]})
        else:
            url = self._get_kv_path(path, data=False)
            response = await client.delete(url, headers=headers)
        
        return response.status_code in (200, 204)
    
    async def list_secrets(self, path: str) -> List[str]:
        """List secrets at path"""
        client = await self._get_client()
        headers = await self._get_headers()
        
        url = f"/v1/{self.kv_mount}/metadata/{path}" if self.kv_version == 2 else f"/v1/{self.kv_mount}/{path}"
        
        response = await client.request("LIST", url, headers=headers)
        
        if response.status_code == 404:
            return []
        elif response.status_code != 200:
            raise SecretsError(f"Failed to list secrets: {response.text}")
        
        return response.json().get("data", {}).get("keys", [])
    
    async def rotate_secret(self, path: str, new_value: str) -> SecretMetadata:
        """Rotate a secret (creates new version)"""
        return await self.set_secret(path, new_value)


class LocalSecretsBackend(SecretsBackend):
    """Local encrypted file-based secrets backend for development/testing"""
    
    def __init__(self, secrets_dir: str = None, encryption_key: str = None):
        self.secrets_dir = secrets_dir or os.getenv("SECRETS_DIR", "/var/secrets")
        self._encryption_key = encryption_key or os.getenv("SECRETS_ENCRYPTION_KEY")
        self._fernet: Optional[Fernet] = None
        self._secrets: Dict[str, Dict] = {}
        
        if self._encryption_key:
            self._init_encryption()
    
    def _init_encryption(self):
        """Initialize encryption"""
        # Derive key from password
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"remittance-secrets",
            iterations=100000,
            backend=default_backend()
        )
        key = base64.urlsafe_b64encode(kdf.derive(self._encryption_key.encode()))
        self._fernet = Fernet(key)
    
    def _encrypt(self, value: str) -> str:
        """Encrypt a value"""
        if self._fernet:
            return self._fernet.encrypt(value.encode()).decode()
        return value
    
    def _decrypt(self, value: str) -> str:
        """Decrypt a value"""
        if self._fernet:
            return self._fernet.decrypt(value.encode()).decode()
        return value
    
    async def get_secret(self, path: str, version: Optional[int] = None) -> Secret:
        """Get a secret from local storage"""
        # Check in-memory cache first
        if path in self._secrets:
            data = self._secrets[path]
            return Secret(
                name=path,
                value=self._decrypt(data["value"]),
                metadata=SecretMetadata(**data["metadata"])
            )
        
        # Check file system
        file_path = os.path.join(self.secrets_dir, f"{path.replace('/', '_')}.json")
        if os.path.exists(file_path):
            with open(file_path) as f:
                data = json.load(f)
            
            self._secrets[path] = data
            return Secret(
                name=path,
                value=self._decrypt(data["value"]),
                metadata=SecretMetadata(
                    name=path,
                    version=data.get("version", 1),
                    created_at=datetime.fromisoformat(data.get("created_at", datetime.now().isoformat())),
                    expires_at=None,
                    rotation_policy=None,
                    last_rotated=None
                )
            )
        
        # Check environment variable
        env_key = path.upper().replace("/", "_").replace("-", "_")
        env_value = os.getenv(env_key)
        if env_value:
            return Secret(
                name=path,
                value=env_value,
                metadata=SecretMetadata(
                    name=path,
                    version=1,
                    created_at=datetime.now(),
                    expires_at=None,
                    rotation_policy=None,
                    last_rotated=None
                )
            )
        
        raise SecretNotFoundError(f"Secret not found: {path}")
    
    async def set_secret(self, path: str, value: str, metadata: Optional[Dict] = None) -> SecretMetadata:
        """Set a secret in local storage"""
        os.makedirs(self.secrets_dir, exist_ok=True)
        
        existing_version = 0
        if path in self._secrets:
            existing_version = self._secrets[path].get("version", 0)
        
        data = {
            "value": self._encrypt(value),
            "version": existing_version + 1,
            "created_at": datetime.now().isoformat(),
            "metadata": metadata or {}
        }
        
        self._secrets[path] = data
        
        file_path = os.path.join(self.secrets_dir, f"{path.replace('/', '_')}.json")
        with open(file_path, "w") as f:
            json.dump(data, f)
        
        return SecretMetadata(
            name=path,
            version=data["version"],
            created_at=datetime.now(),
            expires_at=None,
            rotation_policy=None,
            last_rotated=None
        )
    
    async def delete_secret(self, path: str, version: Optional[int] = None) -> bool:
        """Delete a secret from local storage"""
        if path in self._secrets:
            del self._secrets[path]
        
        file_path = os.path.join(self.secrets_dir, f"{path.replace('/', '_')}.json")
        if os.path.exists(file_path):
            os.remove(file_path)
            return True
        return False
    
    async def list_secrets(self, path: str) -> List[str]:
        """List secrets at path"""
        secrets = []
        prefix = path.replace("/", "_")
        
        if os.path.exists(self.secrets_dir):
            for filename in os.listdir(self.secrets_dir):
                if filename.startswith(prefix) and filename.endswith(".json"):
                    secrets.append(filename[:-5].replace("_", "/"))
        
        return secrets
    
    async def rotate_secret(self, path: str, new_value: str) -> SecretMetadata:
        """Rotate a secret"""
        return await self.set_secret(path, new_value)


class SecretsManager:
    """
    Production secrets manager with caching, rotation, and multi-backend support.
    """
    
    def __init__(self, backend: Optional[SecretsBackend] = None):
        self._backend = backend or self._create_default_backend()
        self._cache: Dict[str, tuple] = {}  # path -> (secret, timestamp)
        self._cache_ttl = int(os.getenv("SECRETS_CACHE_TTL", "300"))
        self._rotation_callbacks: Dict[str, List[callable]] = {}
    
    def _create_default_backend(self) -> SecretsBackend:
        """Create default backend based on environment"""
        if os.getenv("VAULT_ADDR"):
            return VaultSecretsBackend()
        return LocalSecretsBackend()
    
    async def get_secret(
        self,
        path: str,
        version: Optional[int] = None,
        use_cache: bool = True
    ) -> str:
        """
        Get a secret value.
        
        Args:
            path: Secret path
            version: Specific version (optional)
            use_cache: Whether to use cache
        
        Returns:
            Secret value as string
        """
        cache_key = f"{path}:{version or 'latest'}"
        
        # Check cache
        if use_cache and cache_key in self._cache:
            secret, timestamp = self._cache[cache_key]
            if time.time() - timestamp < self._cache_ttl:
                return secret.value
        
        # Fetch from backend
        secret = await self._backend.get_secret(path, version)
        
        # Update cache
        self._cache[cache_key] = (secret, time.time())
        
        return secret.value
    
    async def get_secret_with_metadata(
        self,
        path: str,
        version: Optional[int] = None
    ) -> Secret:
        """Get a secret with its metadata"""
        return await self._backend.get_secret(path, version)
    
    async def set_secret(
        self,
        path: str,
        value: str,
        metadata: Optional[Dict] = None
    ) -> SecretMetadata:
        """Set a secret"""
        result = await self._backend.set_secret(path, value, metadata)
        
        # Invalidate cache
        for key in list(self._cache.keys()):
            if key.startswith(f"{path}:"):
                del self._cache[key]
        
        return result
    
    async def rotate_secret(
        self,
        path: str,
        new_value: str,
        notify_callbacks: bool = True
    ) -> SecretMetadata:
        """
        Rotate a secret and optionally notify callbacks.
        
        Args:
            path: Secret path
            new_value: New secret value
            notify_callbacks: Whether to notify rotation callbacks
        
        Returns:
            Updated secret metadata
        """
        result = await self._backend.rotate_secret(path, new_value)
        
        # Invalidate cache
        for key in list(self._cache.keys()):
            if key.startswith(f"{path}:"):
                del self._cache[key]
        
        # Notify callbacks
        if notify_callbacks and path in self._rotation_callbacks:
            for callback in self._rotation_callbacks[path]:
                try:
                    if asyncio.iscoroutinefunction(callback):
                        await callback(path, new_value)
                    else:
                        callback(path, new_value)
                except Exception as e:
                    logger.error(f"Rotation callback failed for {path}: {e}")
        
        logger.info(f"Secret rotated: {path} (version {result.version})")
        return result
    
    def on_rotation(self, path: str, callback: callable):
        """Register a callback for secret rotation events"""
        if path not in self._rotation_callbacks:
            self._rotation_callbacks[path] = []
        self._rotation_callbacks[path].append(callback)
    
    async def delete_secret(self, path: str, version: Optional[int] = None) -> bool:
        """Delete a secret"""
        result = await self._backend.delete_secret(path, version)
        
        # Invalidate cache
        for key in list(self._cache.keys()):
            if key.startswith(f"{path}:"):
                del self._cache[key]
        
        return result
    
    async def list_secrets(self, path: str = "") -> List[str]:
        """List secrets at path"""
        return await self._backend.list_secrets(path)
    
    def clear_cache(self):
        """Clear the secrets cache"""
        self._cache.clear()
    
    # Convenience methods for common secrets
    async def get_database_credentials(self, database: str = "postgres") -> Dict[str, str]:
        """Get database credentials"""
        try:
            secret = await self.get_secret(f"databases/{database}")
            return json.loads(secret)
        except json.JSONDecodeError:
            # Assume it's a connection string
            return {"connection_string": secret}
    
    async def get_api_key(self, service: str) -> str:
        """Get an API key"""
        return await self.get_secret(f"api-keys/{service}")
    
    async def get_encryption_key(self, purpose: str = "default") -> bytes:
        """Get an encryption key"""
        key_str = await self.get_secret(f"encryption-keys/{purpose}")
        return base64.b64decode(key_str)


# Kubernetes ExternalSecrets integration
class ExternalSecretsSync:
    """Syncs secrets from ExternalSecrets operator"""
    
    def __init__(self, secrets_manager: SecretsManager):
        self.secrets_manager = secrets_manager
        self._watch_paths: List[str] = []
    
    async def sync_from_kubernetes(self, namespace: str = "default"):
        """Sync secrets from Kubernetes ExternalSecrets"""
        # This would integrate with the ExternalSecrets operator
        # For now, read from mounted secret volumes
        secrets_mount = os.getenv("SECRETS_MOUNT_PATH", "/var/run/secrets/external-secrets")
        
        if not os.path.exists(secrets_mount):
            logger.warning(f"External secrets mount not found: {secrets_mount}")
            return
        
        for filename in os.listdir(secrets_mount):
            file_path = os.path.join(secrets_mount, filename)
            if os.path.isfile(file_path):
                with open(file_path) as f:
                    value = f.read().strip()
                
                secret_path = f"external/{filename}"
                await self.secrets_manager.set_secret(secret_path, value)
                logger.info(f"Synced external secret: {secret_path}")


# Global instance
_secrets_manager: Optional[SecretsManager] = None


def get_secrets_manager() -> SecretsManager:
    """Get the global secrets manager instance"""
    global _secrets_manager
    if _secrets_manager is None:
        _secrets_manager = SecretsManager()
    return _secrets_manager


async def get_secret(path: str) -> str:
    """Convenience function to get a secret"""
    return await get_secrets_manager().get_secret(path)


# Example usage
if __name__ == "__main__":
    async def main():
        manager = SecretsManager()
        
        # Set a secret
        await manager.set_secret("test/api-key", "sk-test-12345")
        
        # Get a secret
        value = await manager.get_secret("test/api-key")
        print(f"Secret value: {value}")
        
        # Rotate a secret
        def on_rotate(path, new_value):
            print(f"Secret rotated: {path}")
        
        manager.on_rotation("test/api-key", on_rotate)
        await manager.rotate_secret("test/api-key", "sk-test-67890")
        
        # List secrets
        secrets = await manager.list_secrets("test")
        print(f"Secrets: {secrets}")
    
    asyncio.run(main())
