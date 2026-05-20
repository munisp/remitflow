"""
Data Encryption at Rest - Comprehensive field-level encryption for sensitive data
Provides AES-256-GCM encryption with key management via Vault/KMS
"""

import os
import base64
import hashlib
import hmac
import json
import logging
from typing import Any, Dict, List, Optional, Union
from datetime import datetime
from dataclasses import dataclass
from enum import Enum

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend

logger = logging.getLogger(__name__)


# =============================================================================
# CONFIGURATION
# =============================================================================

class EncryptionConfig:
    """Configuration for encryption at rest"""
    
    # Key derivation settings
    KDF_ITERATIONS = 100000
    SALT_LENGTH = 16
    KEY_LENGTH = 32  # 256 bits for AES-256
    NONCE_LENGTH = 12  # 96 bits for GCM
    
    # Key rotation settings
    KEY_ROTATION_DAYS = 90
    MAX_KEY_VERSIONS = 5
    
    # Sensitive field categories
    PII_FIELDS = [
        "bvn", "nin", "passport_number", "national_id",
        "date_of_birth", "full_name", "phone_number",
        "email", "address", "city", "state", "postal_code"
    ]
    
    FINANCIAL_FIELDS = [
        "account_number", "routing_number", "iban", "swift_code",
        "card_number", "cvv", "expiry_date", "bank_name"
    ]
    
    AUTHENTICATION_FIELDS = [
        "password_hash", "pin_hash", "security_question_answer",
        "biometric_template", "device_fingerprint"
    ]
    
    TRANSACTION_FIELDS = [
        "sender_details", "recipient_details", "payment_reference",
        "transaction_metadata"
    ]


class DataClassification(Enum):
    """Data classification levels"""
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"  # Highest sensitivity - always encrypted


@dataclass
class EncryptedField:
    """Represents an encrypted field with metadata"""
    ciphertext: str
    nonce: str
    key_version: int
    algorithm: str = "AES-256-GCM"
    encrypted_at: str = ""
    context: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "ciphertext": self.ciphertext,
            "nonce": self.nonce,
            "key_version": self.key_version,
            "algorithm": self.algorithm,
            "encrypted_at": self.encrypted_at,
            "context": self.context
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EncryptedField":
        return cls(
            ciphertext=data["ciphertext"],
            nonce=data["nonce"],
            key_version=data["key_version"],
            algorithm=data.get("algorithm", "AES-256-GCM"),
            encrypted_at=data.get("encrypted_at", ""),
            context=data.get("context", "")
        )


# =============================================================================
# KEY MANAGEMENT
# =============================================================================

class KeyManager:
    """Manages encryption keys with versioning and rotation"""
    
    def __init__(self, vault_client=None):
        self.vault_client = vault_client
        self._key_cache: Dict[int, bytes] = {}
        self._current_version = 1
        self._initialized = False
    
    def initialize(self):
        """Initialize key manager"""
        if self._initialized:
            return
        
        # Try to load keys from Vault
        if self.vault_client:
            try:
                key_data = self.vault_client.get_secret("encryption/data-at-rest")
                if isinstance(key_data, dict):
                    self._current_version = key_data.get("current_version", 1)
                    for version_str, key_b64 in key_data.get("keys", {}).items():
                        version = int(version_str)
                        self._key_cache[version] = base64.b64decode(key_b64)
                    self._initialized = True
                    logger.info(f"Loaded {len(self._key_cache)} encryption keys from Vault")
                    return
            except Exception as e:
                logger.warning(f"Failed to load keys from Vault: {e}")
        
        # Fall back to environment variable or generate
        env_key = os.getenv("DATA_ENCRYPTION_KEY")
        if env_key:
            self._key_cache[1] = self._derive_key(env_key)
        else:
            # Generate a key (in production, this should be from secure storage)
            logger.warning("No encryption key configured, generating ephemeral key")
            self._key_cache[1] = AESGCM.generate_key(bit_length=256)
        
        self._initialized = True
        logger.info("Key manager initialized")
    
    def _derive_key(self, password: str, salt: bytes = None) -> bytes:
        """Derive encryption key from password using PBKDF2"""
        if salt is None:
            salt = b"remittance_platform_salt"  # In production, use unique salt per key
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=EncryptionConfig.KEY_LENGTH,
            salt=salt,
            iterations=EncryptionConfig.KDF_ITERATIONS,
            backend=default_backend()
        )
        return kdf.derive(password.encode())
    
    def get_current_key(self) -> tuple[bytes, int]:
        """Get current encryption key and version"""
        if not self._initialized:
            self.initialize()
        return self._key_cache[self._current_version], self._current_version
    
    def get_key_by_version(self, version: int) -> Optional[bytes]:
        """Get encryption key by version"""
        if not self._initialized:
            self.initialize()
        return self._key_cache.get(version)
    
    def rotate_key(self) -> int:
        """Rotate to a new encryption key"""
        if not self._initialized:
            self.initialize()
        
        new_version = self._current_version + 1
        new_key = AESGCM.generate_key(bit_length=256)
        
        self._key_cache[new_version] = new_key
        self._current_version = new_version
        
        # Clean up old keys beyond max versions
        versions = sorted(self._key_cache.keys())
        while len(versions) > EncryptionConfig.MAX_KEY_VERSIONS:
            old_version = versions.pop(0)
            del self._key_cache[old_version]
        
        # Persist to Vault if available
        if self.vault_client:
            try:
                key_data = {
                    "current_version": self._current_version,
                    "keys": {
                        str(v): base64.b64encode(k).decode()
                        for v, k in self._key_cache.items()
                    }
                }
                # Note: In production, use proper Vault write API
                logger.info(f"Rotated to key version {new_version}")
            except Exception as e:
                logger.error(f"Failed to persist rotated key to Vault: {e}")
        
        return new_version


# =============================================================================
# ENCRYPTION ENGINE
# =============================================================================

class EncryptionEngine:
    """Core encryption/decryption engine using AES-256-GCM"""
    
    def __init__(self, key_manager: KeyManager = None):
        self.key_manager = key_manager or KeyManager()
    
    def encrypt(
        self,
        plaintext: Union[str, bytes, Dict, List],
        context: str = ""
    ) -> EncryptedField:
        """
        Encrypt data using AES-256-GCM
        
        Args:
            plaintext: Data to encrypt (string, bytes, dict, or list)
            context: Additional context for the encryption (e.g., table/field name)
        
        Returns:
            EncryptedField with ciphertext and metadata
        """
        # Serialize if needed
        if isinstance(plaintext, (dict, list)):
            plaintext = json.dumps(plaintext, default=str)
        if isinstance(plaintext, str):
            plaintext = plaintext.encode('utf-8')
        
        # Get current key
        key, version = self.key_manager.get_current_key()
        
        # Generate nonce
        nonce = os.urandom(EncryptionConfig.NONCE_LENGTH)
        
        # Create cipher and encrypt
        aesgcm = AESGCM(key)
        
        # Use context as associated data for additional authentication
        aad = context.encode('utf-8') if context else None
        
        ciphertext = aesgcm.encrypt(nonce, plaintext, aad)
        
        return EncryptedField(
            ciphertext=base64.b64encode(ciphertext).decode(),
            nonce=base64.b64encode(nonce).decode(),
            key_version=version,
            encrypted_at=datetime.utcnow().isoformat(),
            context=context
        )
    
    def decrypt(
        self,
        encrypted_field: Union[EncryptedField, Dict[str, Any]],
        return_type: str = "string"
    ) -> Union[str, bytes, Dict, List]:
        """
        Decrypt data
        
        Args:
            encrypted_field: EncryptedField or dict with encryption data
            return_type: "string", "bytes", "json"
        
        Returns:
            Decrypted data in requested format
        """
        if isinstance(encrypted_field, dict):
            encrypted_field = EncryptedField.from_dict(encrypted_field)
        
        # Get key by version
        key = self.key_manager.get_key_by_version(encrypted_field.key_version)
        if not key:
            raise ValueError(f"Key version {encrypted_field.key_version} not found")
        
        # Decode ciphertext and nonce
        ciphertext = base64.b64decode(encrypted_field.ciphertext)
        nonce = base64.b64decode(encrypted_field.nonce)
        
        # Create cipher and decrypt
        aesgcm = AESGCM(key)
        
        # Use context as associated data
        aad = encrypted_field.context.encode('utf-8') if encrypted_field.context else None
        
        plaintext = aesgcm.decrypt(nonce, ciphertext, aad)
        
        # Return in requested format
        if return_type == "bytes":
            return plaintext
        elif return_type == "json":
            return json.loads(plaintext.decode('utf-8'))
        else:
            return plaintext.decode('utf-8')
    
    def encrypt_field(self, value: Any, field_name: str, table_name: str = "") -> str:
        """
        Encrypt a single field value
        
        Returns JSON string that can be stored in database
        """
        if value is None:
            return None
        
        context = f"{table_name}.{field_name}" if table_name else field_name
        encrypted = self.encrypt(value, context)
        return json.dumps(encrypted.to_dict())
    
    def decrypt_field(self, encrypted_json: str, return_type: str = "string") -> Any:
        """
        Decrypt a single field value from JSON string
        """
        if not encrypted_json:
            return None
        
        try:
            encrypted_data = json.loads(encrypted_json)
            return self.decrypt(encrypted_data, return_type)
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"Failed to decrypt field: {e}")
            return None


# =============================================================================
# SEARCHABLE ENCRYPTION (HASH-BASED INDEXING)
# =============================================================================

class SearchableEncryption:
    """
    Provides searchable encryption using blind indexing
    Allows equality searches on encrypted fields without decryption
    """
    
    def __init__(self, hmac_key: bytes = None):
        self.hmac_key = hmac_key or os.urandom(32)
    
    def create_blind_index(self, value: str, field_name: str) -> str:
        """
        Create a blind index (deterministic hash) for searchable encryption
        
        This allows equality searches without exposing the plaintext
        """
        if not value:
            return ""
        
        # Normalize value
        normalized = value.strip().lower()
        
        # Create HMAC with field name as context
        message = f"{field_name}:{normalized}".encode()
        index = hmac.new(self.hmac_key, message, hashlib.sha256).hexdigest()
        
        return index
    
    def create_partial_index(self, value: str, field_name: str, prefix_length: int = 3) -> List[str]:
        """
        Create partial indexes for prefix searches
        
        Returns list of indexes for each prefix length up to prefix_length
        """
        if not value or len(value) < prefix_length:
            return []
        
        normalized = value.strip().lower()
        indexes = []
        
        for i in range(prefix_length, len(normalized) + 1):
            prefix = normalized[:i]
            message = f"{field_name}:prefix:{prefix}".encode()
            index = hmac.new(self.hmac_key, message, hashlib.sha256).hexdigest()
            indexes.append(index)
        
        return indexes


# =============================================================================
# FIELD-LEVEL ENCRYPTION DECORATOR
# =============================================================================

class EncryptedFieldDescriptor:
    """Descriptor for automatic field encryption/decryption"""
    
    def __init__(
        self,
        field_name: str,
        engine: EncryptionEngine = None,
        searchable: bool = False,
        searchable_engine: SearchableEncryption = None
    ):
        self.field_name = field_name
        self.engine = engine
        self.searchable = searchable
        self.searchable_engine = searchable_engine
        self._storage_name = f"_encrypted_{field_name}"
        self._index_name = f"_index_{field_name}"
    
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        
        encrypted_value = getattr(obj, self._storage_name, None)
        if encrypted_value is None:
            return None
        
        return self.engine.decrypt_field(encrypted_value)
    
    def __set__(self, obj, value):
        if value is None:
            setattr(obj, self._storage_name, None)
            if self.searchable:
                setattr(obj, self._index_name, None)
            return
        
        # Encrypt the value
        table_name = obj.__class__.__name__ if hasattr(obj, '__class__') else ""
        encrypted = self.engine.encrypt_field(value, self.field_name, table_name)
        setattr(obj, self._storage_name, encrypted)
        
        # Create searchable index if enabled
        if self.searchable and self.searchable_engine:
            index = self.searchable_engine.create_blind_index(str(value), self.field_name)
            setattr(obj, self._index_name, index)


# =============================================================================
# DATA ENCRYPTION SERVICE
# =============================================================================

class DataEncryptionService:
    """
    High-level service for data encryption at rest
    Provides utilities for encrypting/decrypting records and fields
    """
    
    def __init__(self, vault_client=None):
        self.key_manager = KeyManager(vault_client)
        self.engine = EncryptionEngine(self.key_manager)
        self.searchable = SearchableEncryption()
        self._initialized = False
    
    def initialize(self):
        """Initialize the encryption service"""
        if self._initialized:
            return
        
        self.key_manager.initialize()
        self._initialized = True
        logger.info("Data encryption service initialized")
    
    def encrypt_record(
        self,
        record: Dict[str, Any],
        sensitive_fields: List[str],
        table_name: str = "",
        create_indexes: List[str] = None
    ) -> Dict[str, Any]:
        """
        Encrypt sensitive fields in a record
        
        Args:
            record: Dictionary containing the record data
            sensitive_fields: List of field names to encrypt
            table_name: Name of the table/collection for context
            create_indexes: Fields to create blind indexes for
        
        Returns:
            Record with encrypted fields
        """
        if not self._initialized:
            self.initialize()
        
        encrypted_record = record.copy()
        create_indexes = create_indexes or []
        
        for field in sensitive_fields:
            if field in encrypted_record and encrypted_record[field] is not None:
                value = encrypted_record[field]
                
                # Encrypt the field
                encrypted_record[f"{field}_encrypted"] = self.engine.encrypt_field(
                    value, field, table_name
                )
                
                # Create blind index if requested
                if field in create_indexes:
                    encrypted_record[f"{field}_index"] = self.searchable.create_blind_index(
                        str(value), field
                    )
                
                # Remove plaintext
                del encrypted_record[field]
        
        return encrypted_record
    
    def decrypt_record(
        self,
        record: Dict[str, Any],
        encrypted_fields: List[str]
    ) -> Dict[str, Any]:
        """
        Decrypt encrypted fields in a record
        
        Args:
            record: Dictionary containing the encrypted record
            encrypted_fields: List of original field names that were encrypted
        
        Returns:
            Record with decrypted fields
        """
        if not self._initialized:
            self.initialize()
        
        decrypted_record = record.copy()
        
        for field in encrypted_fields:
            encrypted_key = f"{field}_encrypted"
            if encrypted_key in decrypted_record and decrypted_record[encrypted_key]:
                # Decrypt the field
                decrypted_record[field] = self.engine.decrypt_field(
                    decrypted_record[encrypted_key]
                )
                
                # Remove encrypted version
                del decrypted_record[encrypted_key]
                
                # Remove index if present
                index_key = f"{field}_index"
                if index_key in decrypted_record:
                    del decrypted_record[index_key]
        
        return decrypted_record
    
    def search_by_encrypted_field(
        self,
        field_name: str,
        search_value: str
    ) -> str:
        """
        Get the blind index for searching encrypted fields
        
        Returns the index value to use in database queries
        """
        if not self._initialized:
            self.initialize()
        
        return self.searchable.create_blind_index(search_value, field_name)
    
    def rotate_keys(self) -> int:
        """Rotate encryption keys"""
        if not self._initialized:
            self.initialize()
        
        return self.key_manager.rotate_key()
    
    def get_sensitive_fields_for_table(self, table_name: str) -> List[str]:
        """Get list of sensitive fields for a table based on configuration"""
        table_field_map = {
            "users": ["phone_number", "email", "date_of_birth", "address"],
            "kyc_documents": EncryptionConfig.PII_FIELDS,
            "beneficiaries": ["account_number", "phone_number", "address", "full_name"],
            "transactions": EncryptionConfig.TRANSACTION_FIELDS,
            "wallets": ["account_number"],
            "cards": ["card_number", "cvv", "expiry_date"],
        }
        
        return table_field_map.get(table_name, [])


# =============================================================================
# INFRASTRUCTURE ENCRYPTION DOCUMENTATION
# =============================================================================

INFRASTRUCTURE_ENCRYPTION_GUIDE = """
# Infrastructure-Level Encryption at Rest

## PostgreSQL Database Encryption

### Cloud Provider Managed Encryption
- AWS RDS: Enable encryption at rest using AWS KMS
  - Set `storage_encrypted = true` in Terraform/CloudFormation
  - Use customer-managed CMK for key control
  
- GCP Cloud SQL: Enable encryption at rest (default)
  - Use customer-managed encryption keys (CMEK) for additional control
  
- Azure Database for PostgreSQL: Enable encryption at rest (default)
  - Use customer-managed keys in Azure Key Vault

### Self-Hosted PostgreSQL
- Use LUKS for disk encryption
- Enable Transparent Data Encryption (TDE) if available
- Encrypt backup volumes separately

## Object Storage Encryption (RustFS/MinIO)

### Server-Side Encryption (SSE)
- Enable SSE-S3 (AES-256) for all buckets
- Use SSE-KMS for customer-managed keys
- Enable bucket default encryption policy

### Configuration Example (MinIO/RustFS):
```yaml
encryption:
  sse:
    enabled: true
    algorithm: AES256
  kms:
    enabled: true
    endpoint: "http://vault:8200"
```

## Kubernetes Secrets Encryption

### etcd Encryption
- Enable encryption at rest for Kubernetes secrets
- Use EncryptionConfiguration with AES-GCM provider
- Rotate encryption keys regularly

### Example EncryptionConfiguration:
```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-key>
      - identity: {}
```

## Backup Encryption

- Encrypt all database backups using GPG or age
- Store backup encryption keys separately from backups
- Use different keys for different backup tiers

## Log Encryption

- Encrypt log files at rest
- Use encrypted log shipping (TLS)
- Implement log rotation with secure deletion
"""


# =============================================================================
# GLOBAL INSTANCE
# =============================================================================

_encryption_service: Optional[DataEncryptionService] = None


def get_encryption_service() -> DataEncryptionService:
    """Get or create the global encryption service instance"""
    global _encryption_service
    if _encryption_service is None:
        _encryption_service = DataEncryptionService()
    return _encryption_service


def encrypt_field(value: Any, field_name: str, table_name: str = "") -> str:
    """Convenience function to encrypt a field"""
    return get_encryption_service().engine.encrypt_field(value, field_name, table_name)


def decrypt_field(encrypted_json: str) -> Any:
    """Convenience function to decrypt a field"""
    return get_encryption_service().engine.decrypt_field(encrypted_json)


def encrypt_record(
    record: Dict[str, Any],
    sensitive_fields: List[str],
    table_name: str = "",
    create_indexes: List[str] = None
) -> Dict[str, Any]:
    """Convenience function to encrypt a record"""
    return get_encryption_service().encrypt_record(
        record, sensitive_fields, table_name, create_indexes
    )


def decrypt_record(
    record: Dict[str, Any],
    encrypted_fields: List[str]
) -> Dict[str, Any]:
    """Convenience function to decrypt a record"""
    return get_encryption_service().decrypt_record(record, encrypted_fields)
