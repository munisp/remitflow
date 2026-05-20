"""
FSPIOP Security Module - Bank-Grade Implementation

Production-ready FSPIOP security for Mojaloop integration with:
- Asymmetric signature verification (RSA/ECDSA per-FSP keys)
- Strict header validation (Source, Destination, Date skew)
- Key management with rotation support
- Audit logging for security events

Reference: https://docs.mojaloop.io/api/fspiop/
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


# Configuration
FSPIOP_STRICT_VALIDATION = os.getenv("FSPIOP_STRICT_VALIDATION", "true").lower() == "true"
FSPIOP_DATE_SKEW_SECONDS = int(os.getenv("FSPIOP_DATE_SKEW_SECONDS", "300"))  # 5 minutes
FSPIOP_ALLOWED_SOURCES = os.getenv("FSPIOP_ALLOWED_SOURCES", "").split(",") if os.getenv("FSPIOP_ALLOWED_SOURCES") else []
FSPIOP_AUDIT_FAILURES = os.getenv("FSPIOP_AUDIT_FAILURES", "true").lower() == "true"
DFSP_ID = os.getenv("DFSP_ID", "remittance-platform")


class SignatureAlgorithm(str, Enum):
    """Supported signature algorithms"""
    HMAC_SHA256 = "hmac-sha256"
    RSA_SHA256 = "rsa-sha256"
    ECDSA_SHA256 = "ecdsa-sha256"


class ValidationResult(str, Enum):
    """Validation result status"""
    VALID = "valid"
    INVALID_SIGNATURE = "invalid_signature"
    MISSING_SIGNATURE = "missing_signature"
    INVALID_SOURCE = "invalid_source"
    INVALID_DESTINATION = "invalid_destination"
    DATE_SKEW_EXCEEDED = "date_skew_exceeded"
    MISSING_HEADERS = "missing_headers"
    KEY_NOT_FOUND = "key_not_found"
    ALGORITHM_NOT_SUPPORTED = "algorithm_not_supported"


@dataclass
class FspKey:
    """FSP public key for signature verification"""
    fsp_id: str
    key_id: str
    algorithm: SignatureAlgorithm
    public_key: str  # Base64-encoded public key or HMAC secret
    valid_from: datetime
    valid_to: Optional[datetime] = None
    is_active: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)

    def is_valid(self) -> bool:
        """Check if key is currently valid"""
        now = datetime.now(timezone.utc)
        if not self.is_active:
            return False
        if now < self.valid_from:
            return False
        if self.valid_to and now > self.valid_to:
            return False
        return True


@dataclass
class ValidationError:
    """Detailed validation error"""
    result: ValidationResult
    message: str
    fsp_source: Optional[str] = None
    fsp_destination: Optional[str] = None
    header_name: Optional[str] = None
    expected_value: Optional[str] = None
    actual_value: Optional[str] = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "result": self.result.value,
            "message": self.message,
            "fsp_source": self.fsp_source,
            "fsp_destination": self.fsp_destination,
            "header_name": self.header_name,
            "expected_value": self.expected_value,
            "actual_value": self.actual_value,
            "timestamp": self.timestamp.isoformat()
        }

    def to_fspiop_error(self) -> Dict[str, Any]:
        """Convert to FSPIOP error response format"""
        error_codes = {
            ValidationResult.INVALID_SIGNATURE: ("3100", "Invalid signature"),
            ValidationResult.MISSING_SIGNATURE: ("3101", "Missing signature"),
            ValidationResult.INVALID_SOURCE: ("3102", "Invalid source FSP"),
            ValidationResult.INVALID_DESTINATION: ("3103", "Invalid destination FSP"),
            ValidationResult.DATE_SKEW_EXCEEDED: ("3104", "Date header out of range"),
            ValidationResult.MISSING_HEADERS: ("3105", "Missing required headers"),
            ValidationResult.KEY_NOT_FOUND: ("3106", "Signing key not found"),
            ValidationResult.ALGORITHM_NOT_SUPPORTED: ("3107", "Algorithm not supported"),
        }
        
        code, description = error_codes.get(
            self.result, 
            ("3000", "Generic validation error")
        )
        
        return {
            "errorInformation": {
                "errorCode": code,
                "errorDescription": f"{description}: {self.message}"
            }
        }


class FspKeyStore(ABC):
    """Abstract base class for FSP key storage"""
    
    @abstractmethod
    async def get_key(self, fsp_id: str, key_id: Optional[str] = None) -> Optional[FspKey]:
        """Get the active key for an FSP"""
        pass
    
    @abstractmethod
    async def add_key(self, key: FspKey) -> bool:
        """Add a new key for an FSP"""
        pass
    
    @abstractmethod
    async def revoke_key(self, fsp_id: str, key_id: str) -> bool:
        """Revoke a key"""
        pass
    
    @abstractmethod
    async def list_keys(self, fsp_id: Optional[str] = None) -> List[FspKey]:
        """List all keys, optionally filtered by FSP"""
        pass


class InMemoryKeyStore(FspKeyStore):
    """In-memory key store for development/testing"""
    
    def __init__(self):
        self._keys: Dict[str, List[FspKey]] = {}
        self._load_from_env()
    
    def _load_from_env(self):
        """Load keys from environment variable"""
        keys_json = os.getenv("FSPIOP_PUBLIC_KEYS", "{}")
        try:
            keys_data = json.loads(keys_json)
            for fsp_id, key_data in keys_data.items():
                if isinstance(key_data, str):
                    # Simple format: {"fsp_id": "base64_key"}
                    key = FspKey(
                        fsp_id=fsp_id,
                        key_id="default",
                        algorithm=SignatureAlgorithm.HMAC_SHA256,
                        public_key=key_data,
                        valid_from=datetime.now(timezone.utc)
                    )
                else:
                    # Full format with algorithm
                    key = FspKey(
                        fsp_id=fsp_id,
                        key_id=key_data.get("key_id", "default"),
                        algorithm=SignatureAlgorithm(key_data.get("algorithm", "hmac-sha256")),
                        public_key=key_data.get("public_key", ""),
                        valid_from=datetime.now(timezone.utc)
                    )
                
                if fsp_id not in self._keys:
                    self._keys[fsp_id] = []
                self._keys[fsp_id].append(key)
                
        except json.JSONDecodeError:
            logger.warning("Failed to parse FSPIOP_PUBLIC_KEYS environment variable")
    
    async def get_key(self, fsp_id: str, key_id: Optional[str] = None) -> Optional[FspKey]:
        keys = self._keys.get(fsp_id, [])
        for key in keys:
            if key.is_valid():
                if key_id is None or key.key_id == key_id:
                    return key
        return None
    
    async def add_key(self, key: FspKey) -> bool:
        if key.fsp_id not in self._keys:
            self._keys[key.fsp_id] = []
        self._keys[key.fsp_id].append(key)
        return True
    
    async def revoke_key(self, fsp_id: str, key_id: str) -> bool:
        keys = self._keys.get(fsp_id, [])
        for key in keys:
            if key.key_id == key_id:
                key.is_active = False
                return True
        return False
    
    async def list_keys(self, fsp_id: Optional[str] = None) -> List[FspKey]:
        if fsp_id:
            return self._keys.get(fsp_id, [])
        return [key for keys in self._keys.values() for key in keys]


class PostgresKeyStore(FspKeyStore):
    """PostgreSQL-backed key store for production"""
    
    def __init__(self, pool):
        self.pool = pool
    
    async def initialize(self):
        """Create key store tables"""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS fspiop_participant_keys (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    fsp_id VARCHAR(128) NOT NULL,
                    key_id VARCHAR(128) NOT NULL,
                    algorithm VARCHAR(32) NOT NULL DEFAULT 'hmac-sha256',
                    public_key TEXT NOT NULL,
                    valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    valid_to TIMESTAMP WITH TIME ZONE,
                    is_active BOOLEAN DEFAULT TRUE,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    UNIQUE(fsp_id, key_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_fsp_keys_fsp_id 
                ON fspiop_participant_keys(fsp_id, is_active);
            """)
            logger.info("FSPIOP key store tables initialized")
    
    async def get_key(self, fsp_id: str, key_id: Optional[str] = None) -> Optional[FspKey]:
        async with self.pool.acquire() as conn:
            if key_id:
                row = await conn.fetchrow("""
                    SELECT * FROM fspiop_participant_keys
                    WHERE fsp_id = $1 AND key_id = $2 AND is_active = TRUE
                    AND valid_from <= NOW()
                    AND (valid_to IS NULL OR valid_to > NOW())
                """, fsp_id, key_id)
            else:
                row = await conn.fetchrow("""
                    SELECT * FROM fspiop_participant_keys
                    WHERE fsp_id = $1 AND is_active = TRUE
                    AND valid_from <= NOW()
                    AND (valid_to IS NULL OR valid_to > NOW())
                    ORDER BY valid_from DESC
                    LIMIT 1
                """, fsp_id)
            
            if row:
                return FspKey(
                    fsp_id=row['fsp_id'],
                    key_id=row['key_id'],
                    algorithm=SignatureAlgorithm(row['algorithm']),
                    public_key=row['public_key'],
                    valid_from=row['valid_from'],
                    valid_to=row['valid_to'],
                    is_active=row['is_active'],
                    metadata=row['metadata'] or {}
                )
            return None
    
    async def add_key(self, key: FspKey) -> bool:
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO fspiop_participant_keys 
                (fsp_id, key_id, algorithm, public_key, valid_from, valid_to, is_active, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (fsp_id, key_id) DO UPDATE SET
                    algorithm = EXCLUDED.algorithm,
                    public_key = EXCLUDED.public_key,
                    valid_from = EXCLUDED.valid_from,
                    valid_to = EXCLUDED.valid_to,
                    is_active = EXCLUDED.is_active,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
            """, key.fsp_id, key.key_id, key.algorithm.value, key.public_key,
                key.valid_from, key.valid_to, key.is_active, json.dumps(key.metadata))
            return True
    
    async def revoke_key(self, fsp_id: str, key_id: str) -> bool:
        async with self.pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE fspiop_participant_keys
                SET is_active = FALSE, updated_at = NOW()
                WHERE fsp_id = $1 AND key_id = $2
            """, fsp_id, key_id)
            return result == "UPDATE 1"
    
    async def list_keys(self, fsp_id: Optional[str] = None) -> List[FspKey]:
        async with self.pool.acquire() as conn:
            if fsp_id:
                rows = await conn.fetch("""
                    SELECT * FROM fspiop_participant_keys
                    WHERE fsp_id = $1
                    ORDER BY valid_from DESC
                """, fsp_id)
            else:
                rows = await conn.fetch("""
                    SELECT * FROM fspiop_participant_keys
                    ORDER BY fsp_id, valid_from DESC
                """)
            
            return [
                FspKey(
                    fsp_id=row['fsp_id'],
                    key_id=row['key_id'],
                    algorithm=SignatureAlgorithm(row['algorithm']),
                    public_key=row['public_key'],
                    valid_from=row['valid_from'],
                    valid_to=row['valid_to'],
                    is_active=row['is_active'],
                    metadata=row['metadata'] or {}
                )
                for row in rows
            ]


class FspiopSignatureVerifier:
    """
    FSPIOP Signature Verification
    
    Supports:
    - HMAC-SHA256 (symmetric, for development/simple setups)
    - RSA-SHA256 (asymmetric, for production)
    - ECDSA-SHA256 (asymmetric, for production)
    
    Per-FSP key management with rotation support.
    """
    
    def __init__(self, key_store: FspKeyStore):
        self.key_store = key_store
        self._failure_reason: Optional[str] = None
    
    def get_failure_reason(self) -> Optional[str]:
        """Get the reason for the last verification failure"""
        return self._failure_reason
    
    def _build_signature_string(
        self,
        headers: Dict[str, str],
        body: Optional[str] = None,
        signed_headers: Optional[List[str]] = None
    ) -> str:
        """
        Build the signature string per FSPIOP spec.
        
        Default signed headers: FSPIOP-Source, Date, Content-Length (if body present)
        """
        if signed_headers is None:
            signed_headers = ["fspiop-source", "date"]
            if body:
                signed_headers.append("content-length")
        
        # Normalize header names to lowercase for lookup
        normalized_headers = {k.lower(): v for k, v in headers.items()}
        
        parts = []
        for header in signed_headers:
            header_lower = header.lower()
            if header_lower == "content-length" and body:
                parts.append(f"content-length: {len(body)}")
            elif header_lower in normalized_headers:
                parts.append(f"{header_lower}: {normalized_headers[header_lower]}")
        
        return "\n".join(parts)
    
    async def verify(
        self,
        source_fsp: str,
        headers: Dict[str, str],
        body: Optional[str] = None
    ) -> Tuple[bool, Optional[ValidationError]]:
        """
        Verify FSPIOP signature from headers.
        
        Args:
            source_fsp: The FSP ID from FSPIOP-Source header
            headers: Request headers
            body: Request body (optional)
            
        Returns:
            Tuple of (is_valid, error)
        """
        self._failure_reason = None
        
        # Get signature from headers
        signature_header = headers.get("FSPIOP-Signature") or headers.get("fspiop-signature")
        
        if not signature_header:
            if FSPIOP_STRICT_VALIDATION:
                error = ValidationError(
                    result=ValidationResult.MISSING_SIGNATURE,
                    message="FSPIOP-Signature header is required",
                    fsp_source=source_fsp
                )
                self._failure_reason = error.message
                return False, error
            else:
                logger.warning(f"Missing FSPIOP-Signature from {source_fsp}, skipping verification (strict mode disabled)")
                return True, None
        
        # Get key for source FSP
        key = await self.key_store.get_key(source_fsp)
        
        if not key:
            if FSPIOP_STRICT_VALIDATION:
                error = ValidationError(
                    result=ValidationResult.KEY_NOT_FOUND,
                    message=f"No valid signing key found for FSP: {source_fsp}",
                    fsp_source=source_fsp
                )
                self._failure_reason = error.message
                return False, error
            else:
                logger.warning(f"No key found for {source_fsp}, skipping verification (strict mode disabled)")
                return True, None
        
        # Build signature string
        signature_string = self._build_signature_string(headers, body)
        
        # Verify based on algorithm
        try:
            if key.algorithm == SignatureAlgorithm.HMAC_SHA256:
                is_valid = self._verify_hmac(signature_header, signature_string, key.public_key)
            elif key.algorithm == SignatureAlgorithm.RSA_SHA256:
                is_valid = self._verify_rsa(signature_header, signature_string, key.public_key)
            elif key.algorithm == SignatureAlgorithm.ECDSA_SHA256:
                is_valid = self._verify_ecdsa(signature_header, signature_string, key.public_key)
            else:
                error = ValidationError(
                    result=ValidationResult.ALGORITHM_NOT_SUPPORTED,
                    message=f"Unsupported algorithm: {key.algorithm}",
                    fsp_source=source_fsp
                )
                self._failure_reason = error.message
                return False, error
            
            if not is_valid:
                error = ValidationError(
                    result=ValidationResult.INVALID_SIGNATURE,
                    message="Signature verification failed",
                    fsp_source=source_fsp
                )
                self._failure_reason = error.message
                return False, error
            
            return True, None
            
        except Exception as e:
            logger.error(f"Signature verification error for {source_fsp}: {e}")
            error = ValidationError(
                result=ValidationResult.INVALID_SIGNATURE,
                message=f"Signature verification error: {str(e)}",
                fsp_source=source_fsp
            )
            self._failure_reason = error.message
            return False, error
    
    def _verify_hmac(self, signature: str, message: str, secret: str) -> bool:
        """Verify HMAC-SHA256 signature"""
        try:
            expected = hmac.new(
                secret.encode('utf-8'),
                message.encode('utf-8'),
                hashlib.sha256
            ).digest()
            
            provided = base64.b64decode(signature)
            return hmac.compare_digest(expected, provided)
        except Exception as e:
            logger.error(f"HMAC verification error: {e}")
            return False
    
    def _verify_rsa(self, signature: str, message: str, public_key_pem: str) -> bool:
        """Verify RSA-SHA256 signature"""
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import padding
            from cryptography.hazmat.backends import default_backend
            
            # Load public key
            public_key = serialization.load_pem_public_key(
                public_key_pem.encode('utf-8'),
                backend=default_backend()
            )
            
            # Verify signature
            signature_bytes = base64.b64decode(signature)
            public_key.verify(
                signature_bytes,
                message.encode('utf-8'),
                padding.PKCS1v15(),
                hashes.SHA256()
            )
            return True
            
        except ImportError:
            logger.error("cryptography library not installed, RSA verification unavailable")
            return False
        except Exception as e:
            logger.error(f"RSA verification error: {e}")
            return False
    
    def _verify_ecdsa(self, signature: str, message: str, public_key_pem: str) -> bool:
        """Verify ECDSA-SHA256 signature"""
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.backends import default_backend
            
            # Load public key
            public_key = serialization.load_pem_public_key(
                public_key_pem.encode('utf-8'),
                backend=default_backend()
            )
            
            # Verify signature
            signature_bytes = base64.b64decode(signature)
            public_key.verify(
                signature_bytes,
                message.encode('utf-8'),
                ec.ECDSA(hashes.SHA256())
            )
            return True
            
        except ImportError:
            logger.error("cryptography library not installed, ECDSA verification unavailable")
            return False
        except Exception as e:
            logger.error(f"ECDSA verification error: {e}")
            return False


class FspiopHeaderValidator:
    """
    FSPIOP Header Validation
    
    Validates:
    - FSPIOP-Source (must be in allowed list)
    - FSPIOP-Destination (must match our DFSP ID)
    - Date (must be within skew window)
    - Content-Type (must be valid FSPIOP content type)
    """
    
    def __init__(
        self,
        dfsp_id: str = DFSP_ID,
        allowed_sources: Optional[List[str]] = None,
        date_skew_seconds: int = FSPIOP_DATE_SKEW_SECONDS
    ):
        self.dfsp_id = dfsp_id
        self.allowed_sources: Set[str] = set(allowed_sources or FSPIOP_ALLOWED_SOURCES)
        self.date_skew_seconds = date_skew_seconds
    
    def validate_source(
        self,
        headers: Dict[str, str],
        expected_source: Optional[str] = None
    ) -> Tuple[bool, Optional[ValidationError]]:
        """Validate FSPIOP-Source header"""
        source = headers.get("FSPIOP-Source") or headers.get("fspiop-source")
        
        if not source:
            return False, ValidationError(
                result=ValidationResult.MISSING_HEADERS,
                message="FSPIOP-Source header is required",
                header_name="FSPIOP-Source"
            )
        
        # Check against expected source if provided
        if expected_source and source != expected_source:
            return False, ValidationError(
                result=ValidationResult.INVALID_SOURCE,
                message="FSPIOP-Source mismatch",
                fsp_source=source,
                expected_value=expected_source,
                actual_value=source
            )
        
        # Check against allowed sources if configured
        if self.allowed_sources and source not in self.allowed_sources:
            return False, ValidationError(
                result=ValidationResult.INVALID_SOURCE,
                message=f"FSPIOP-Source '{source}' is not in allowed sources list",
                fsp_source=source
            )
        
        return True, None
    
    def validate_destination(
        self,
        headers: Dict[str, str],
        expected_destination: Optional[str] = None
    ) -> Tuple[bool, Optional[ValidationError]]:
        """Validate FSPIOP-Destination header"""
        destination = headers.get("FSPIOP-Destination") or headers.get("fspiop-destination")
        
        expected = expected_destination or self.dfsp_id
        
        if destination and destination != expected:
            return False, ValidationError(
                result=ValidationResult.INVALID_DESTINATION,
                message="FSPIOP-Destination mismatch",
                fsp_destination=destination,
                expected_value=expected,
                actual_value=destination
            )
        
        return True, None
    
    def validate_date(
        self,
        headers: Dict[str, str]
    ) -> Tuple[bool, Optional[ValidationError]]:
        """Validate Date header is within acceptable skew"""
        date_str = headers.get("Date") or headers.get("date")
        
        if not date_str:
            if FSPIOP_STRICT_VALIDATION:
                return False, ValidationError(
                    result=ValidationResult.MISSING_HEADERS,
                    message="Date header is required",
                    header_name="Date"
                )
            return True, None
        
        try:
            # Parse HTTP date format: "Wed, 21 Oct 2015 07:28:00 GMT"
            request_time = datetime.strptime(date_str, "%a, %d %b %Y %H:%M:%S %Z")
            request_time = request_time.replace(tzinfo=timezone.utc)
            
            now = datetime.now(timezone.utc)
            skew = abs((now - request_time).total_seconds())
            
            if skew > self.date_skew_seconds:
                return False, ValidationError(
                    result=ValidationResult.DATE_SKEW_EXCEEDED,
                    message=f"Date header skew ({skew:.0f}s) exceeds maximum ({self.date_skew_seconds}s)",
                    header_name="Date",
                    expected_value=f"within {self.date_skew_seconds}s of current time",
                    actual_value=f"{skew:.0f}s skew"
                )
            
            return True, None
            
        except ValueError as e:
            return False, ValidationError(
                result=ValidationResult.MISSING_HEADERS,
                message=f"Invalid Date header format: {e}",
                header_name="Date",
                actual_value=date_str
            )
    
    def validate_content_type(
        self,
        headers: Dict[str, str],
        expected_type: str = "application/vnd.interoperability"
    ) -> Tuple[bool, Optional[ValidationError]]:
        """Validate Content-Type header"""
        content_type = headers.get("Content-Type") or headers.get("content-type")
        
        if content_type and expected_type not in content_type:
            return False, ValidationError(
                result=ValidationResult.MISSING_HEADERS,
                message="Invalid Content-Type for FSPIOP",
                header_name="Content-Type",
                expected_value=f"contains '{expected_type}'",
                actual_value=content_type
            )
        
        return True, None
    
    def validate_all(
        self,
        headers: Dict[str, str],
        expected_source: Optional[str] = None,
        expected_destination: Optional[str] = None,
        validate_date: bool = True,
        validate_content_type: bool = False
    ) -> Tuple[bool, List[ValidationError]]:
        """
        Validate all FSPIOP headers.
        
        Returns:
            Tuple of (all_valid, list_of_errors)
        """
        errors = []
        
        # Validate source
        valid, error = self.validate_source(headers, expected_source)
        if not valid and error:
            errors.append(error)
        
        # Validate destination
        valid, error = self.validate_destination(headers, expected_destination)
        if not valid and error:
            errors.append(error)
        
        # Validate date
        if validate_date:
            valid, error = self.validate_date(headers)
            if not valid and error:
                errors.append(error)
        
        # Validate content type
        if validate_content_type:
            valid, error = self.validate_content_type(headers)
            if not valid and error:
                errors.append(error)
        
        return len(errors) == 0, errors


class FspiopSecurityAuditor:
    """
    Security Audit Logger for FSPIOP Events
    
    Logs all security-relevant events for compliance and forensics.
    """
    
    def __init__(self, pool=None):
        self.pool = pool
    
    async def initialize(self):
        """Create audit tables"""
        if not self.pool:
            return
        
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS fspiop_security_audit (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    event_type VARCHAR(64) NOT NULL,
                    fsp_source VARCHAR(128),
                    fsp_destination VARCHAR(128),
                    resource_type VARCHAR(64),
                    resource_id VARCHAR(255),
                    result VARCHAR(32) NOT NULL,
                    error_code VARCHAR(16),
                    error_message TEXT,
                    ip_address VARCHAR(45),
                    user_agent TEXT,
                    headers JSONB,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_security_audit_time 
                ON fspiop_security_audit(created_at);
                
                CREATE INDEX IF NOT EXISTS idx_security_audit_fsp 
                ON fspiop_security_audit(fsp_source, result);
            """)
            logger.info("FSPIOP security audit tables initialized")
    
    async def log_validation_result(
        self,
        event_type: str,
        fsp_source: Optional[str],
        fsp_destination: Optional[str],
        resource_type: str,
        resource_id: str,
        result: str,
        error: Optional[ValidationError] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None
    ):
        """Log a validation result"""
        if not FSPIOP_AUDIT_FAILURES and result == "valid":
            return
        
        # Always log to standard logger
        if result != "valid":
            logger.warning(
                f"FSPIOP security event: {event_type} from {fsp_source} - {result}"
                f"{f': {error.message}' if error else ''}"
            )
        
        # Log to database if available
        if self.pool:
            try:
                # Sanitize headers (remove sensitive data)
                safe_headers = None
                if headers:
                    safe_headers = {
                        k: v for k, v in headers.items()
                        if k.lower() not in ['authorization', 'fspiop-signature']
                    }
                
                async with self.pool.acquire() as conn:
                    await conn.execute("""
                        INSERT INTO fspiop_security_audit (
                            event_type, fsp_source, fsp_destination, resource_type,
                            resource_id, result, error_code, error_message,
                            ip_address, user_agent, headers
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    """, event_type, fsp_source, fsp_destination, resource_type,
                        resource_id, result,
                        error.result.value if error else None,
                        error.message if error else None,
                        ip_address, user_agent,
                        json.dumps(safe_headers) if safe_headers else None)
            except Exception as e:
                logger.error(f"Failed to log security audit: {e}")


# Singleton instances
_key_store: Optional[FspKeyStore] = None
_signature_verifier: Optional[FspiopSignatureVerifier] = None
_header_validator: Optional[FspiopHeaderValidator] = None
_security_auditor: Optional[FspiopSecurityAuditor] = None


def get_key_store() -> FspKeyStore:
    """Get the global key store instance"""
    global _key_store
    if _key_store is None:
        _key_store = InMemoryKeyStore()
    return _key_store


def get_signature_verifier() -> FspiopSignatureVerifier:
    """Get the global signature verifier instance"""
    global _signature_verifier
    if _signature_verifier is None:
        _signature_verifier = FspiopSignatureVerifier(get_key_store())
    return _signature_verifier


def get_header_validator() -> FspiopHeaderValidator:
    """Get the global header validator instance"""
    global _header_validator
    if _header_validator is None:
        _header_validator = FspiopHeaderValidator()
    return _header_validator


def get_security_auditor() -> FspiopSecurityAuditor:
    """Get the global security auditor instance"""
    global _security_auditor
    if _security_auditor is None:
        _security_auditor = FspiopSecurityAuditor()
    return _security_auditor


async def initialize_fspiop_security(pool=None):
    """Initialize all FSPIOP security components with database pool"""
    global _key_store, _signature_verifier, _security_auditor
    
    if pool:
        _key_store = PostgresKeyStore(pool)
        await _key_store.initialize()
        
        _signature_verifier = FspiopSignatureVerifier(_key_store)
        
        _security_auditor = FspiopSecurityAuditor(pool)
        await _security_auditor.initialize()
    
    logger.info("FSPIOP security components initialized")
