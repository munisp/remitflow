"""
Data Classification and Encryption-at-Rest System
Implements data classification, encryption policies, and access controls
"""

import os
import json
import logging
import hashlib
import base64
from typing import Optional, Dict, Any, List, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
from abc import ABC, abstractmethod

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend

logger = logging.getLogger(__name__)


class DataClassification(str, Enum):
    """Data classification levels"""
    PUBLIC = "public"           # No restrictions
    INTERNAL = "internal"       # Internal use only
    CONFIDENTIAL = "confidential"  # Business sensitive
    RESTRICTED = "restricted"   # PII, financial data
    SECRET = "secret"          # Highly sensitive (keys, credentials)


class DataCategory(str, Enum):
    """Data categories for compliance"""
    PII = "pii"                    # Personally Identifiable Information
    PCI = "pci"                    # Payment Card Industry data
    PHI = "phi"                    # Protected Health Information
    FINANCIAL = "financial"        # Financial records
    CREDENTIALS = "credentials"    # Authentication credentials
    AUDIT = "audit"               # Audit logs
    OPERATIONAL = "operational"    # Operational data
    ANALYTICS = "analytics"        # Analytics/metrics


@dataclass
class DataField:
    """Definition of a data field with classification"""
    name: str
    classification: DataClassification
    categories: List[DataCategory]
    encryption_required: bool = False
    masking_required: bool = False
    retention_days: int = 365
    pii_type: Optional[str] = None  # name, email, phone, ssn, etc.
    
    def requires_encryption(self) -> bool:
        return self.encryption_required or self.classification in (
            DataClassification.RESTRICTED,
            DataClassification.SECRET
        )
    
    def requires_masking(self) -> bool:
        return self.masking_required or DataCategory.PII in self.categories


@dataclass
class DataSchema:
    """Schema definition with field classifications"""
    name: str
    version: str
    fields: Dict[str, DataField]
    default_classification: DataClassification = DataClassification.INTERNAL
    owner: str = ""
    description: str = ""


# Standard field definitions for the platform
STANDARD_FIELDS = {
    # PII fields
    "customer_name": DataField(
        name="customer_name",
        classification=DataClassification.RESTRICTED,
        categories=[DataCategory.PII],
        encryption_required=True,
        masking_required=True,
        pii_type="name"
    ),
    "customer_email": DataField(
        name="customer_email",
        classification=DataClassification.RESTRICTED,
        categories=[DataCategory.PII],
        encryption_required=True,
        masking_required=True,
        pii_type="email"
    ),
    "customer_phone": DataField(
        name="customer_phone",
        classification=DataClassification.RESTRICTED,
        categories=[DataCategory.PII],
        encryption_required=True,
        masking_required=True,
        pii_type="phone"
    ),
    "national_id": DataField(
        name="national_id",
        classification=DataClassification.SECRET,
        categories=[DataCategory.PII],
        encryption_required=True,
        masking_required=True,
        pii_type="national_id",
        retention_days=2555  # 7 years for KYC
    ),
    "date_of_birth": DataField(
        name="date_of_birth",
        classification=DataClassification.RESTRICTED,
        categories=[DataCategory.PII],
        encryption_required=True,
        pii_type="dob"
    ),
    "address": DataField(
        name="address",
        classification=DataClassification.RESTRICTED,
        categories=[DataCategory.PII],
        encryption_required=True,
        masking_required=True,
        pii_type="address"
    ),
    
    # PCI fields
    "card_number": DataField(
        name="card_number",
        classification=DataClassification.SECRET,
        categories=[DataCategory.PCI, DataCategory.FINANCIAL],
        encryption_required=True,
        masking_required=True,
        retention_days=90  # Minimize PCI scope
    ),
    "card_cvv": DataField(
        name="card_cvv",
        classification=DataClassification.SECRET,
        categories=[DataCategory.PCI],
        encryption_required=True,
        retention_days=0  # Never store
    ),
    "card_expiry": DataField(
        name="card_expiry",
        classification=DataClassification.SECRET,
        categories=[DataCategory.PCI],
        encryption_required=True,
        retention_days=90
    ),
    
    # Financial fields
    "account_number": DataField(
        name="account_number",
        classification=DataClassification.RESTRICTED,
        categories=[DataCategory.FINANCIAL],
        encryption_required=True,
        masking_required=True
    ),
    "transaction_amount": DataField(
        name="transaction_amount",
        classification=DataClassification.CONFIDENTIAL,
        categories=[DataCategory.FINANCIAL],
        encryption_required=False
    ),
    "balance": DataField(
        name="balance",
        classification=DataClassification.CONFIDENTIAL,
        categories=[DataCategory.FINANCIAL],
        encryption_required=False
    ),
    
    # Credentials
    "password_hash": DataField(
        name="password_hash",
        classification=DataClassification.SECRET,
        categories=[DataCategory.CREDENTIALS],
        encryption_required=True,
        retention_days=0  # Rotate regularly
    ),
    "api_key": DataField(
        name="api_key",
        classification=DataClassification.SECRET,
        categories=[DataCategory.CREDENTIALS],
        encryption_required=True,
        retention_days=90
    ),
    "encryption_key": DataField(
        name="encryption_key",
        classification=DataClassification.SECRET,
        categories=[DataCategory.CREDENTIALS],
        encryption_required=True,
        retention_days=365
    ),
    
    # Operational fields
    "agent_id": DataField(
        name="agent_id",
        classification=DataClassification.INTERNAL,
        categories=[DataCategory.OPERATIONAL],
        encryption_required=False
    ),
    "transaction_id": DataField(
        name="transaction_id",
        classification=DataClassification.INTERNAL,
        categories=[DataCategory.OPERATIONAL],
        encryption_required=False
    ),
    "timestamp": DataField(
        name="timestamp",
        classification=DataClassification.INTERNAL,
        categories=[DataCategory.OPERATIONAL],
        encryption_required=False
    ),
}


class FieldEncryptor:
    """Encrypts and decrypts field values"""
    
    def __init__(self, master_key: Optional[str] = None):
        self.master_key = master_key or os.getenv("DATA_ENCRYPTION_KEY")
        if not self.master_key:
            # Generate a key for development (should be from Vault in production)
            self.master_key = Fernet.generate_key().decode()
            logger.warning("Using generated encryption key - configure DATA_ENCRYPTION_KEY in production")
        
        self._fernet = Fernet(self.master_key.encode() if isinstance(self.master_key, str) else self.master_key)
        self._field_keys: Dict[str, Fernet] = {}
    
    def _get_field_key(self, field_name: str) -> Fernet:
        """Get or derive a field-specific encryption key"""
        if field_name not in self._field_keys:
            # Derive field-specific key from master key
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=field_name.encode(),
                iterations=100000,
                backend=default_backend()
            )
            key = base64.urlsafe_b64encode(kdf.derive(self.master_key.encode()))
            self._field_keys[field_name] = Fernet(key)
        return self._field_keys[field_name]
    
    def encrypt(self, field_name: str, value: str) -> str:
        """Encrypt a field value"""
        if not value:
            return value
        
        fernet = self._get_field_key(field_name)
        encrypted = fernet.encrypt(value.encode())
        return f"ENC:{base64.urlsafe_b64encode(encrypted).decode()}"
    
    def decrypt(self, field_name: str, encrypted_value: str) -> str:
        """Decrypt a field value"""
        if not encrypted_value or not encrypted_value.startswith("ENC:"):
            return encrypted_value
        
        fernet = self._get_field_key(field_name)
        encrypted_data = base64.urlsafe_b64decode(encrypted_value[4:])
        return fernet.decrypt(encrypted_data).decode()
    
    def is_encrypted(self, value: str) -> bool:
        """Check if a value is encrypted"""
        return value and value.startswith("ENC:")


class DataMasker:
    """Masks sensitive data for display/logging"""
    
    MASKING_PATTERNS = {
        "email": lambda v: v[:2] + "***@" + v.split("@")[-1] if "@" in v else "***",
        "phone": lambda v: v[:3] + "****" + v[-3:] if len(v) >= 6 else "***",
        "name": lambda v: v[0] + "***" + v[-1] if len(v) >= 2 else "***",
        "national_id": lambda v: "***" + v[-4:] if len(v) >= 4 else "***",
        "card_number": lambda v: "****" + v[-4:] if len(v) >= 4 else "****",
        "account_number": lambda v: "***" + v[-4:] if len(v) >= 4 else "***",
        "address": lambda v: v.split(",")[0][:10] + "***" if "," in v else v[:10] + "***",
        "dob": lambda v: "****-**-" + v[-2:] if len(v) >= 2 else "****",
        "default": lambda v: "***" + v[-4:] if len(v) >= 4 else "***",
    }
    
    @classmethod
    def mask(cls, value: str, pii_type: Optional[str] = None) -> str:
        """Mask a value based on its PII type"""
        if not value:
            return value
        
        masker = cls.MASKING_PATTERNS.get(pii_type, cls.MASKING_PATTERNS["default"])
        try:
            return masker(value)
        except Exception:
            return "***"
    
    @classmethod
    def mask_dict(cls, data: Dict[str, Any], fields: Dict[str, DataField]) -> Dict[str, Any]:
        """Mask all sensitive fields in a dictionary"""
        masked = {}
        for key, value in data.items():
            if key in fields and fields[key].requires_masking():
                masked[key] = cls.mask(str(value), fields[key].pii_type)
            elif isinstance(value, dict):
                masked[key] = cls.mask_dict(value, fields)
            else:
                masked[key] = value
        return masked


class DataClassifier:
    """Classifies and processes data according to policies"""
    
    def __init__(self):
        self.encryptor = FieldEncryptor()
        self.masker = DataMasker()
        self.schemas: Dict[str, DataSchema] = {}
        self._load_standard_schemas()
    
    def _load_standard_schemas(self):
        """Load standard schemas for the platform"""
        # Customer schema
        self.register_schema(DataSchema(
            name="customer",
            version="1.0",
            fields={
                "customer_id": STANDARD_FIELDS["agent_id"],
                "name": STANDARD_FIELDS["customer_name"],
                "email": STANDARD_FIELDS["customer_email"],
                "phone": STANDARD_FIELDS["customer_phone"],
                "national_id": STANDARD_FIELDS["national_id"],
                "date_of_birth": STANDARD_FIELDS["date_of_birth"],
                "address": STANDARD_FIELDS["address"],
            },
            owner="customer-service",
            description="Customer profile data"
        ))
        
        # Transaction schema
        self.register_schema(DataSchema(
            name="transaction",
            version="1.0",
            fields={
                "transaction_id": STANDARD_FIELDS["transaction_id"],
                "agent_id": STANDARD_FIELDS["agent_id"],
                "customer_phone": STANDARD_FIELDS["customer_phone"],
                "amount": STANDARD_FIELDS["transaction_amount"],
                "timestamp": STANDARD_FIELDS["timestamp"],
            },
            owner="transaction-service",
            description="Transaction records"
        ))
        
        # Agent schema
        self.register_schema(DataSchema(
            name="agent",
            version="1.0",
            fields={
                "agent_id": STANDARD_FIELDS["agent_id"],
                "name": STANDARD_FIELDS["customer_name"],
                "email": STANDARD_FIELDS["customer_email"],
                "phone": STANDARD_FIELDS["customer_phone"],
                "national_id": STANDARD_FIELDS["national_id"],
            },
            owner="agent-service",
            description="Agent profile data"
        ))
        
        # Payment card schema
        self.register_schema(DataSchema(
            name="payment_card",
            version="1.0",
            fields={
                "card_number": STANDARD_FIELDS["card_number"],
                "card_expiry": STANDARD_FIELDS["card_expiry"],
                "card_cvv": STANDARD_FIELDS["card_cvv"],
            },
            default_classification=DataClassification.SECRET,
            owner="payment-service",
            description="Payment card data (PCI scope)"
        ))
    
    def register_schema(self, schema: DataSchema):
        """Register a data schema"""
        key = f"{schema.name}:{schema.version}"
        self.schemas[key] = schema
        logger.info(f"Registered schema: {key}")
    
    def get_schema(self, name: str, version: str = "1.0") -> Optional[DataSchema]:
        """Get a schema by name and version"""
        return self.schemas.get(f"{name}:{version}")
    
    def classify_field(self, field_name: str, value: Any) -> DataClassification:
        """Classify a field based on its name and value"""
        # Check standard fields
        if field_name in STANDARD_FIELDS:
            return STANDARD_FIELDS[field_name].classification
        
        # Heuristic classification based on field name
        field_lower = field_name.lower()
        
        if any(x in field_lower for x in ["password", "secret", "key", "token", "credential"]):
            return DataClassification.SECRET
        
        if any(x in field_lower for x in ["card", "cvv", "pin"]):
            return DataClassification.SECRET
        
        if any(x in field_lower for x in ["ssn", "national_id", "passport", "license"]):
            return DataClassification.SECRET
        
        if any(x in field_lower for x in ["email", "phone", "address", "name", "dob", "birth"]):
            return DataClassification.RESTRICTED
        
        if any(x in field_lower for x in ["account", "balance", "amount", "salary"]):
            return DataClassification.CONFIDENTIAL
        
        return DataClassification.INTERNAL
    
    def process_for_storage(
        self,
        data: Dict[str, Any],
        schema_name: str,
        schema_version: str = "1.0"
    ) -> Dict[str, Any]:
        """Process data for storage (encrypt sensitive fields)"""
        schema = self.get_schema(schema_name, schema_version)
        if not schema:
            logger.warning(f"Schema not found: {schema_name}:{schema_version}")
            return data
        
        processed = {}
        for key, value in data.items():
            if key in schema.fields:
                field = schema.fields[key]
                if field.requires_encryption() and value:
                    processed[key] = self.encryptor.encrypt(key, str(value))
                else:
                    processed[key] = value
            else:
                processed[key] = value
        
        return processed
    
    def process_for_retrieval(
        self,
        data: Dict[str, Any],
        schema_name: str,
        schema_version: str = "1.0"
    ) -> Dict[str, Any]:
        """Process data for retrieval (decrypt sensitive fields)"""
        schema = self.get_schema(schema_name, schema_version)
        if not schema:
            return data
        
        processed = {}
        for key, value in data.items():
            if key in schema.fields and self.encryptor.is_encrypted(str(value)):
                processed[key] = self.encryptor.decrypt(key, str(value))
            else:
                processed[key] = value
        
        return processed
    
    def process_for_display(
        self,
        data: Dict[str, Any],
        schema_name: str,
        schema_version: str = "1.0",
        user_clearance: DataClassification = DataClassification.INTERNAL
    ) -> Dict[str, Any]:
        """Process data for display (mask based on user clearance)"""
        schema = self.get_schema(schema_name, schema_version)
        if not schema:
            return data
        
        # First decrypt
        decrypted = self.process_for_retrieval(data, schema_name, schema_version)
        
        # Then mask based on clearance
        processed = {}
        clearance_level = list(DataClassification).index(user_clearance)
        
        for key, value in decrypted.items():
            if key in schema.fields:
                field = schema.fields[key]
                field_level = list(DataClassification).index(field.classification)
                
                if field_level > clearance_level:
                    # User doesn't have clearance - mask the field
                    processed[key] = self.masker.mask(str(value), field.pii_type)
                else:
                    processed[key] = value
            else:
                processed[key] = value
        
        return processed
    
    def process_for_logging(
        self,
        data: Dict[str, Any],
        schema_name: str,
        schema_version: str = "1.0"
    ) -> Dict[str, Any]:
        """Process data for logging (mask all PII)"""
        schema = self.get_schema(schema_name, schema_version)
        if not schema:
            # Apply heuristic masking
            return self._heuristic_mask(data)
        
        return self.masker.mask_dict(data, schema.fields)
    
    def _heuristic_mask(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply heuristic masking when no schema is available"""
        masked = {}
        sensitive_patterns = ["password", "secret", "key", "token", "card", "cvv", "pin",
                            "ssn", "email", "phone", "address", "name", "dob"]
        
        for key, value in data.items():
            key_lower = key.lower()
            if any(pattern in key_lower for pattern in sensitive_patterns):
                masked[key] = "***MASKED***"
            elif isinstance(value, dict):
                masked[key] = self._heuristic_mask(value)
            else:
                masked[key] = value
        
        return masked
    
    def get_retention_policy(
        self,
        schema_name: str,
        schema_version: str = "1.0"
    ) -> Dict[str, int]:
        """Get retention policy for a schema"""
        schema = self.get_schema(schema_name, schema_version)
        if not schema:
            return {}
        
        return {
            field_name: field.retention_days
            for field_name, field in schema.fields.items()
        }
    
    def get_pci_fields(
        self,
        schema_name: str,
        schema_version: str = "1.0"
    ) -> List[str]:
        """Get list of PCI-scoped fields in a schema"""
        schema = self.get_schema(schema_name, schema_version)
        if not schema:
            return []
        
        return [
            field_name
            for field_name, field in schema.fields.items()
            if DataCategory.PCI in field.categories
        ]
    
    def get_pii_fields(
        self,
        schema_name: str,
        schema_version: str = "1.0"
    ) -> List[str]:
        """Get list of PII fields in a schema"""
        schema = self.get_schema(schema_name, schema_version)
        if not schema:
            return []
        
        return [
            field_name
            for field_name, field in schema.fields.items()
            if DataCategory.PII in field.categories
        ]


# Global instance
_classifier: Optional[DataClassifier] = None


def get_data_classifier() -> DataClassifier:
    """Get the global data classifier instance"""
    global _classifier
    if _classifier is None:
        _classifier = DataClassifier()
    return _classifier


# Example usage
if __name__ == "__main__":
    classifier = DataClassifier()
    
    # Sample customer data
    customer_data = {
        "customer_id": "CUST-001",
        "name": "John Doe",
        "email": "john.doe@example.com",
        "phone": "+254700123456",
        "national_id": "12345678",
        "date_of_birth": "1990-01-15",
        "address": "123 Main St, Nairobi, Kenya"
    }
    
    print("Original data:")
    print(json.dumps(customer_data, indent=2))
    
    # Process for storage (encrypt)
    stored = classifier.process_for_storage(customer_data, "customer")
    print("\nStored (encrypted):")
    print(json.dumps(stored, indent=2))
    
    # Process for retrieval (decrypt)
    retrieved = classifier.process_for_retrieval(stored, "customer")
    print("\nRetrieved (decrypted):")
    print(json.dumps(retrieved, indent=2))
    
    # Process for display (mask based on clearance)
    displayed = classifier.process_for_display(stored, "customer", user_clearance=DataClassification.INTERNAL)
    print("\nDisplayed (masked for INTERNAL clearance):")
    print(json.dumps(displayed, indent=2))
    
    # Process for logging
    logged = classifier.process_for_logging(customer_data, "customer")
    print("\nLogged (masked for logs):")
    print(json.dumps(logged, indent=2))
