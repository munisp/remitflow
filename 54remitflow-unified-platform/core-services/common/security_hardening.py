"""
Security Hardening Implementation for PayGate

Implements:
1. Content Security Policy (CSP)
2. HTTP Strict Transport Security (HSTS)
3. Input Validation
4. Encryption at Rest/Transit
5. Secure Session Management
"""

import base64
import hashlib
import hmac
import os
import re
import secrets
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Optional, Union

from cryptography.fernet import Fernet
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from pydantic import BaseModel, Field, field_validator


class SecurityHeaderType(str, Enum):
    """Security header types"""
    CSP = "Content-Security-Policy"
    HSTS = "Strict-Transport-Security"
    X_CONTENT_TYPE = "X-Content-Type-Options"
    X_FRAME = "X-Frame-Options"
    X_XSS = "X-XSS-Protection"
    REFERRER = "Referrer-Policy"
    PERMISSIONS = "Permissions-Policy"
    CACHE_CONTROL = "Cache-Control"
    PRAGMA = "Pragma"
    CORS = "Access-Control-Allow-Origin"


class ValidationErrorType(str, Enum):
    """Input validation error types"""
    REQUIRED = "required"
    TYPE_MISMATCH = "type_mismatch"
    LENGTH_EXCEEDED = "length_exceeded"
    LENGTH_TOO_SHORT = "length_too_short"
    PATTERN_MISMATCH = "pattern_mismatch"
    RANGE_EXCEEDED = "range_exceeded"
    INVALID_FORMAT = "invalid_format"
    INJECTION_DETECTED = "injection_detected"
    XSS_DETECTED = "xss_detected"
    SQLI_DETECTED = "sqli_detected"


@dataclass
class ValidationError:
    """Validation error details"""
    field: str
    error_type: ValidationErrorType
    message: str
    value: Any = None


@dataclass
class ValidationResult:
    """Result of input validation"""
    is_valid: bool
    errors: list[ValidationError] = field(default_factory=list)
    sanitized_value: Any = None


class ContentSecurityPolicy:
    """Content Security Policy (CSP) configuration and generation"""
    
    def __init__(self):
        self.directives: dict[str, list[str]] = {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "img-src": ["'self'", "data:", "https:"],
            "font-src": ["'self'"],
            "connect-src": ["'self'"],
            "frame-src": ["'none'"],
            "object-src": ["'none'"],
            "base-uri": ["'self'"],
            "form-action": ["'self'"],
            "frame-ancestors": ["'none'"],
            "upgrade-insecure-requests": []
        }
        self.report_uri: Optional[str] = None
        self.report_only: bool = False
        
    def set_directive(self, directive: str, sources: list[str]) -> "ContentSecurityPolicy":
        """Set a CSP directive"""
        self.directives[directive] = sources
        return self
        
    def add_source(self, directive: str, source: str) -> "ContentSecurityPolicy":
        """Add a source to a directive"""
        if directive not in self.directives:
            self.directives[directive] = []
        if source not in self.directives[directive]:
            self.directives[directive].append(source)
        return self
        
    def remove_source(self, directive: str, source: str) -> "ContentSecurityPolicy":
        """Remove a source from a directive"""
        if directive in self.directives and source in self.directives[directive]:
            self.directives[directive].remove(source)
        return self
        
    def set_report_uri(self, uri: str) -> "ContentSecurityPolicy":
        """Set CSP report URI"""
        self.report_uri = uri
        return self
        
    def set_report_only(self, report_only: bool = True) -> "ContentSecurityPolicy":
        """Set CSP to report-only mode"""
        self.report_only = report_only
        return self
        
    def generate_nonce(self) -> str:
        """Generate a CSP nonce for inline scripts"""
        return base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        
    def add_nonce(self, directive: str, nonce: str) -> "ContentSecurityPolicy":
        """Add a nonce to a directive"""
        return self.add_source(directive, f"'nonce-{nonce}'")
        
    def generate_header(self) -> tuple[str, str]:
        """Generate CSP header name and value"""
        parts = []
        for directive, sources in self.directives.items():
            if sources:
                parts.append(f"{directive} {' '.join(sources)}")
            else:
                parts.append(directive)
                
        if self.report_uri:
            parts.append(f"report-uri {self.report_uri}")
            
        header_name = "Content-Security-Policy-Report-Only" if self.report_only else "Content-Security-Policy"
        header_value = "; ".join(parts)
        
        return header_name, header_value
        
    @classmethod
    def strict_policy(cls) -> "ContentSecurityPolicy":
        """Create a strict CSP policy"""
        policy = cls()
        policy.directives = {
            "default-src": ["'none'"],
            "script-src": ["'self'"],
            "style-src": ["'self'"],
            "img-src": ["'self'"],
            "font-src": ["'self'"],
            "connect-src": ["'self'"],
            "frame-src": ["'none'"],
            "object-src": ["'none'"],
            "base-uri": ["'self'"],
            "form-action": ["'self'"],
            "frame-ancestors": ["'none'"],
            "upgrade-insecure-requests": [],
            "block-all-mixed-content": []
        }
        return policy
        
    @classmethod
    def api_policy(cls) -> "ContentSecurityPolicy":
        """Create a CSP policy for API endpoints"""
        policy = cls()
        policy.directives = {
            "default-src": ["'none'"],
            "frame-ancestors": ["'none'"],
            "sandbox": []
        }
        return policy


class HSTSConfig:
    """HTTP Strict Transport Security configuration"""
    
    def __init__(
        self,
        max_age: int = 31536000,  # 1 year
        include_subdomains: bool = True,
        preload: bool = False
    ):
        self.max_age = max_age
        self.include_subdomains = include_subdomains
        self.preload = preload
        
    def generate_header(self) -> tuple[str, str]:
        """Generate HSTS header"""
        parts = [f"max-age={self.max_age}"]
        
        if self.include_subdomains:
            parts.append("includeSubDomains")
            
        if self.preload:
            parts.append("preload")
            
        return "Strict-Transport-Security", "; ".join(parts)


class SecurityHeaders:
    """Security headers manager"""
    
    def __init__(self):
        self.csp = ContentSecurityPolicy()
        self.hsts = HSTSConfig()
        self.custom_headers: dict[str, str] = {}
        
    def set_csp(self, csp: ContentSecurityPolicy) -> "SecurityHeaders":
        """Set CSP configuration"""
        self.csp = csp
        return self
        
    def set_hsts(self, hsts: HSTSConfig) -> "SecurityHeaders":
        """Set HSTS configuration"""
        self.hsts = hsts
        return self
        
    def add_custom_header(self, name: str, value: str) -> "SecurityHeaders":
        """Add a custom security header"""
        self.custom_headers[name] = value
        return self
        
    def generate_all_headers(self) -> dict[str, str]:
        """Generate all security headers"""
        headers = {}
        
        # CSP
        csp_name, csp_value = self.csp.generate_header()
        headers[csp_name] = csp_value
        
        # HSTS
        hsts_name, hsts_value = self.hsts.generate_header()
        headers[hsts_name] = hsts_value
        
        # Standard security headers
        headers["X-Content-Type-Options"] = "nosniff"
        headers["X-Frame-Options"] = "DENY"
        headers["X-XSS-Protection"] = "1; mode=block"
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate"
        headers["Pragma"] = "no-cache"
        
        # Custom headers
        headers.update(self.custom_headers)
        
        return headers


class InputValidator:
    """Input validation and sanitization"""
    
    # SQL injection patterns
    SQL_INJECTION_PATTERNS = [
        r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)",
        r"(--|#|/\*|\*/)",
        r"(\bOR\b\s+\d+\s*=\s*\d+)",
        r"(\bAND\b\s+\d+\s*=\s*\d+)",
        r"(;.*--)",
        r"(\'\s*OR\s*\')",
        r"(\"\s*OR\s*\")",
    ]
    
    # XSS patterns
    XSS_PATTERNS = [
        r"<script[^>]*>.*?</script>",
        r"javascript:",
        r"on\w+\s*=",
        r"<iframe[^>]*>",
        r"<object[^>]*>",
        r"<embed[^>]*>",
        r"<link[^>]*>",
        r"<meta[^>]*>",
        r"expression\s*\(",
        r"url\s*\(",
    ]
    
    # Common validation patterns
    PATTERNS = {
        "email": r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
        "phone": r"^\+?[1-9]\d{1,14}$",
        "uuid": r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        "alphanumeric": r"^[a-zA-Z0-9]+$",
        "alpha": r"^[a-zA-Z]+$",
        "numeric": r"^[0-9]+$",
        "url": r"^https?://[^\s/$.?#].[^\s]*$",
        "ipv4": r"^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
        "date": r"^\d{4}-\d{2}-\d{2}$",
        "datetime": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}",
        "currency_code": r"^[A-Z]{3}$",
        "bvn": r"^\d{11}$",  # Nigerian Bank Verification Number
        "nin": r"^\d{11}$",  # Nigerian National ID Number
        "account_number": r"^\d{10}$",  # Nigerian bank account
    }
    
    def __init__(self):
        self.sql_patterns = [re.compile(p, re.IGNORECASE) for p in self.SQL_INJECTION_PATTERNS]
        self.xss_patterns = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in self.XSS_PATTERNS]
        
    def validate_string(
        self,
        value: Any,
        field_name: str,
        required: bool = True,
        min_length: int = 0,
        max_length: int = 10000,
        pattern: Optional[str] = None,
        pattern_name: Optional[str] = None,
        check_injection: bool = True,
        check_xss: bool = True
    ) -> ValidationResult:
        """Validate a string input"""
        errors = []
        
        # Check required
        if value is None or value == "":
            if required:
                errors.append(ValidationError(
                    field=field_name,
                    error_type=ValidationErrorType.REQUIRED,
                    message=f"{field_name} is required"
                ))
            return ValidationResult(is_valid=not required, errors=errors, sanitized_value=value)
            
        # Type check
        if not isinstance(value, str):
            errors.append(ValidationError(
                field=field_name,
                error_type=ValidationErrorType.TYPE_MISMATCH,
                message=f"{field_name} must be a string",
                value=value
            ))
            return ValidationResult(is_valid=False, errors=errors)
            
        # Length checks
        if len(value) < min_length:
            errors.append(ValidationError(
                field=field_name,
                error_type=ValidationErrorType.LENGTH_TOO_SHORT,
                message=f"{field_name} must be at least {min_length} characters",
                value=value
            ))
            
        if len(value) > max_length:
            errors.append(ValidationError(
                field=field_name,
                error_type=ValidationErrorType.LENGTH_EXCEEDED,
                message=f"{field_name} must not exceed {max_length} characters",
                value=value
            ))
            
        # Pattern check
        if pattern:
            if not re.match(pattern, value):
                errors.append(ValidationError(
                    field=field_name,
                    error_type=ValidationErrorType.PATTERN_MISMATCH,
                    message=f"{field_name} does not match required pattern",
                    value=value
                ))
        elif pattern_name and pattern_name in self.PATTERNS:
            if not re.match(self.PATTERNS[pattern_name], value):
                errors.append(ValidationError(
                    field=field_name,
                    error_type=ValidationErrorType.INVALID_FORMAT,
                    message=f"{field_name} is not a valid {pattern_name}",
                    value=value
                ))
                
        # SQL injection check
        if check_injection:
            for pattern in self.sql_patterns:
                if pattern.search(value):
                    errors.append(ValidationError(
                        field=field_name,
                        error_type=ValidationErrorType.SQLI_DETECTED,
                        message=f"Potential SQL injection detected in {field_name}",
                        value=value
                    ))
                    break
                    
        # XSS check
        if check_xss:
            for pattern in self.xss_patterns:
                if pattern.search(value):
                    errors.append(ValidationError(
                        field=field_name,
                        error_type=ValidationErrorType.XSS_DETECTED,
                        message=f"Potential XSS attack detected in {field_name}",
                        value=value
                    ))
                    break
                    
        # Sanitize value
        sanitized = self.sanitize_string(value)
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            sanitized_value=sanitized
        )
        
    def validate_number(
        self,
        value: Any,
        field_name: str,
        required: bool = True,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
        allow_float: bool = True
    ) -> ValidationResult:
        """Validate a numeric input"""
        errors = []
        
        # Check required
        if value is None:
            if required:
                errors.append(ValidationError(
                    field=field_name,
                    error_type=ValidationErrorType.REQUIRED,
                    message=f"{field_name} is required"
                ))
            return ValidationResult(is_valid=not required, errors=errors, sanitized_value=value)
            
        # Type check
        if not isinstance(value, (int, float)):
            try:
                value = float(value) if allow_float else int(value)
            except (ValueError, TypeError):
                errors.append(ValidationError(
                    field=field_name,
                    error_type=ValidationErrorType.TYPE_MISMATCH,
                    message=f"{field_name} must be a number",
                    value=value
                ))
                return ValidationResult(is_valid=False, errors=errors)
                
        # Range checks
        if min_value is not None and value < min_value:
            errors.append(ValidationError(
                field=field_name,
                error_type=ValidationErrorType.RANGE_EXCEEDED,
                message=f"{field_name} must be at least {min_value}",
                value=value
            ))
            
        if max_value is not None and value > max_value:
            errors.append(ValidationError(
                field=field_name,
                error_type=ValidationErrorType.RANGE_EXCEEDED,
                message=f"{field_name} must not exceed {max_value}",
                value=value
            ))
            
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            sanitized_value=value
        )
        
    def validate_email(self, value: str, field_name: str = "email", required: bool = True) -> ValidationResult:
        """Validate email address"""
        return self.validate_string(
            value=value,
            field_name=field_name,
            required=required,
            max_length=254,
            pattern_name="email"
        )
        
    def validate_phone(self, value: str, field_name: str = "phone", required: bool = True) -> ValidationResult:
        """Validate phone number (E.164 format)"""
        return self.validate_string(
            value=value,
            field_name=field_name,
            required=required,
            max_length=15,
            pattern_name="phone"
        )
        
    def validate_uuid(self, value: str, field_name: str = "id", required: bool = True) -> ValidationResult:
        """Validate UUID"""
        return self.validate_string(
            value=value,
            field_name=field_name,
            required=required,
            pattern_name="uuid",
            check_injection=False,
            check_xss=False
        )
        
    def validate_currency_amount(
        self,
        value: Any,
        field_name: str = "amount",
        required: bool = True,
        min_amount: float = 0.01,
        max_amount: float = 1000000000
    ) -> ValidationResult:
        """Validate currency amount"""
        return self.validate_number(
            value=value,
            field_name=field_name,
            required=required,
            min_value=min_amount,
            max_value=max_amount,
            allow_float=True
        )
        
    def sanitize_string(self, value: str) -> str:
        """Sanitize a string by escaping HTML entities"""
        if not isinstance(value, str):
            return value
            
        replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#x27;",
            "/": "&#x2F;",
            "\\": "&#x5C;",
        }
        
        for char, replacement in replacements.items():
            value = value.replace(char, replacement)
            
        return value
        
    def sanitize_for_sql(self, value: str) -> str:
        """Sanitize a string for SQL (use parameterized queries instead!)"""
        if not isinstance(value, str):
            return value
            
        # Escape single quotes
        return value.replace("'", "''")


class EncryptionManager:
    """Encryption at rest and in transit"""
    
    def __init__(self, master_key: Optional[bytes] = None):
        self.master_key = master_key or Fernet.generate_key()
        self.fernet = Fernet(self.master_key)
        self.key_rotation_interval = timedelta(days=90)
        self.key_created_at = datetime.utcnow()
        
    def encrypt(self, data: Union[str, bytes]) -> bytes:
        """Encrypt data using Fernet (AES-128-CBC)"""
        if isinstance(data, str):
            data = data.encode('utf-8')
        return self.fernet.encrypt(data)
        
    def decrypt(self, encrypted_data: bytes) -> bytes:
        """Decrypt data"""
        return self.fernet.decrypt(encrypted_data)
        
    def encrypt_field(self, value: str) -> str:
        """Encrypt a field and return base64 encoded string"""
        encrypted = self.encrypt(value)
        return base64.b64encode(encrypted).decode('utf-8')
        
    def decrypt_field(self, encrypted_value: str) -> str:
        """Decrypt a base64 encoded encrypted field"""
        encrypted = base64.b64decode(encrypted_value.encode('utf-8'))
        return self.decrypt(encrypted).decode('utf-8')
        
    def hash_password(self, password: str, salt: Optional[bytes] = None) -> tuple[bytes, bytes]:
        """Hash a password using PBKDF2"""
        if salt is None:
            salt = os.urandom(16)
            
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        
        key = kdf.derive(password.encode('utf-8'))
        return key, salt
        
    def verify_password(self, password: str, stored_hash: bytes, salt: bytes) -> bool:
        """Verify a password against stored hash"""
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        
        try:
            kdf.verify(password.encode('utf-8'), stored_hash)
            return True
        except Exception:
            return False
            
    def generate_hmac(self, data: Union[str, bytes], key: Optional[bytes] = None) -> str:
        """Generate HMAC for data integrity"""
        if isinstance(data, str):
            data = data.encode('utf-8')
        if key is None:
            key = self.master_key
            
        h = hmac.new(key, data, hashlib.sha256)
        return h.hexdigest()
        
    def verify_hmac(self, data: Union[str, bytes], signature: str, key: Optional[bytes] = None) -> bool:
        """Verify HMAC signature"""
        expected = self.generate_hmac(data, key)
        return hmac.compare_digest(expected, signature)
        
    def should_rotate_key(self) -> bool:
        """Check if key should be rotated"""
        return datetime.utcnow() - self.key_created_at > self.key_rotation_interval
        
    def rotate_key(self) -> bytes:
        """Rotate encryption key"""
        new_key = Fernet.generate_key()
        self.master_key = new_key
        self.fernet = Fernet(new_key)
        self.key_created_at = datetime.utcnow()
        return new_key


@dataclass
class SecureSession:
    """Secure session data"""
    session_id: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    user_id: str = ""
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_activity: datetime = field(default_factory=datetime.utcnow)
    expires_at: datetime = field(default_factory=lambda: datetime.utcnow() + timedelta(hours=1))
    ip_address: str = ""
    user_agent: str = ""
    is_authenticated: bool = False
    csrf_token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    fingerprint: str = ""
    data: dict = field(default_factory=dict)


class SecureSessionManager:
    """Secure session management"""
    
    def __init__(
        self,
        encryption_manager: EncryptionManager,
        session_timeout_minutes: int = 60,
        max_sessions_per_user: int = 5,
        require_csrf: bool = True
    ):
        self.encryption = encryption_manager
        self.session_timeout = timedelta(minutes=session_timeout_minutes)
        self.max_sessions_per_user = max_sessions_per_user
        self.require_csrf = require_csrf
        self.sessions: dict[str, SecureSession] = {}
        self.user_sessions: dict[str, list[str]] = {}
        
    def create_session(
        self,
        user_id: str,
        ip_address: str,
        user_agent: str,
        fingerprint: str = ""
    ) -> SecureSession:
        """Create a new secure session"""
        # Check max sessions per user
        if user_id in self.user_sessions:
            user_session_ids = self.user_sessions[user_id]
            if len(user_session_ids) >= self.max_sessions_per_user:
                # Remove oldest session
                oldest_id = user_session_ids[0]
                self.destroy_session(oldest_id)
                
        session = SecureSession(
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            fingerprint=fingerprint,
            is_authenticated=True,
            expires_at=datetime.utcnow() + self.session_timeout
        )
        
        self.sessions[session.session_id] = session
        
        if user_id not in self.user_sessions:
            self.user_sessions[user_id] = []
        self.user_sessions[user_id].append(session.session_id)
        
        return session
        
    def get_session(self, session_id: str) -> Optional[SecureSession]:
        """Get a session by ID"""
        session = self.sessions.get(session_id)
        if not session:
            return None
            
        # Check expiration
        if datetime.utcnow() > session.expires_at:
            self.destroy_session(session_id)
            return None
            
        return session
        
    def validate_session(
        self,
        session_id: str,
        ip_address: str,
        user_agent: str,
        csrf_token: Optional[str] = None
    ) -> tuple[bool, Optional[str]]:
        """Validate a session"""
        session = self.get_session(session_id)
        if not session:
            return False, "Session not found or expired"
            
        # Check IP address (optional - can be disabled for mobile)
        # if session.ip_address != ip_address:
        #     return False, "IP address mismatch"
            
        # Check user agent
        if session.user_agent != user_agent:
            return False, "User agent mismatch"
            
        # Check CSRF token
        if self.require_csrf and csrf_token:
            if not secrets.compare_digest(session.csrf_token, csrf_token):
                return False, "Invalid CSRF token"
                
        return True, None
        
    def refresh_session(self, session_id: str) -> Optional[SecureSession]:
        """Refresh session expiration"""
        session = self.get_session(session_id)
        if not session:
            return None
            
        session.last_activity = datetime.utcnow()
        session.expires_at = datetime.utcnow() + self.session_timeout
        
        return session
        
    def rotate_csrf_token(self, session_id: str) -> Optional[str]:
        """Rotate CSRF token for a session"""
        session = self.get_session(session_id)
        if not session:
            return None
            
        session.csrf_token = secrets.token_urlsafe(32)
        return session.csrf_token
        
    def destroy_session(self, session_id: str) -> bool:
        """Destroy a session"""
        session = self.sessions.get(session_id)
        if not session:
            return False
            
        # Remove from user sessions
        if session.user_id in self.user_sessions:
            if session_id in self.user_sessions[session.user_id]:
                self.user_sessions[session.user_id].remove(session_id)
                
        # Remove session
        del self.sessions[session_id]
        return True
        
    def destroy_all_user_sessions(self, user_id: str) -> int:
        """Destroy all sessions for a user"""
        session_ids = self.user_sessions.get(user_id, []).copy()
        count = 0
        for session_id in session_ids:
            if self.destroy_session(session_id):
                count += 1
        return count
        
    def cleanup_expired_sessions(self) -> int:
        """Clean up expired sessions"""
        now = datetime.utcnow()
        expired = [
            session_id for session_id, session in self.sessions.items()
            if session.expires_at < now
        ]
        
        for session_id in expired:
            self.destroy_session(session_id)
            
        return len(expired)
        
    def get_session_token(self, session: SecureSession) -> str:
        """Generate encrypted session token"""
        token_data = f"{session.session_id}:{session.user_id}:{session.created_at.isoformat()}"
        return self.encryption.encrypt_field(token_data)
        
    def verify_session_token(self, token: str) -> Optional[SecureSession]:
        """Verify and decode session token"""
        try:
            token_data = self.encryption.decrypt_field(token)
            session_id, user_id, created_at = token_data.split(":")
            
            session = self.get_session(session_id)
            if session and session.user_id == user_id:
                return session
        except Exception:
            pass
            
        return None


class SecurityHardeningMiddleware:
    """FastAPI middleware for security hardening"""
    
    def __init__(
        self,
        security_headers: Optional[SecurityHeaders] = None,
        input_validator: Optional[InputValidator] = None,
        session_manager: Optional[SecureSessionManager] = None
    ):
        self.security_headers = security_headers or SecurityHeaders()
        self.input_validator = input_validator or InputValidator()
        self.session_manager = session_manager
        
    def get_security_headers(self) -> dict[str, str]:
        """Get all security headers"""
        return self.security_headers.generate_all_headers()
        
    def validate_request_body(self, body: dict, schema: dict) -> ValidationResult:
        """Validate request body against schema"""
        errors = []
        sanitized = {}
        
        for field_name, field_config in schema.items():
            value = body.get(field_name)
            field_type = field_config.get("type", "string")
            required = field_config.get("required", False)
            
            if field_type == "string":
                result = self.input_validator.validate_string(
                    value=value,
                    field_name=field_name,
                    required=required,
                    min_length=field_config.get("min_length", 0),
                    max_length=field_config.get("max_length", 10000),
                    pattern=field_config.get("pattern"),
                    pattern_name=field_config.get("pattern_name")
                )
            elif field_type == "number":
                result = self.input_validator.validate_number(
                    value=value,
                    field_name=field_name,
                    required=required,
                    min_value=field_config.get("min_value"),
                    max_value=field_config.get("max_value")
                )
            elif field_type == "email":
                result = self.input_validator.validate_email(value, field_name, required)
            elif field_type == "phone":
                result = self.input_validator.validate_phone(value, field_name, required)
            elif field_type == "uuid":
                result = self.input_validator.validate_uuid(value, field_name, required)
            else:
                result = ValidationResult(is_valid=True, sanitized_value=value)
                
            errors.extend(result.errors)
            if result.sanitized_value is not None:
                sanitized[field_name] = result.sanitized_value
                
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            sanitized_value=sanitized
        )


# Default instances for PayGate
paygate_csp = ContentSecurityPolicy.strict_policy()
paygate_csp.add_source("script-src", "'self'")
paygate_csp.add_source("connect-src", "https://api.paygate.ng")
paygate_csp.add_source("connect-src", "wss://api.paygate.ng")

paygate_hsts = HSTSConfig(
    max_age=31536000,  # 1 year
    include_subdomains=True,
    preload=True
)

paygate_security_headers = SecurityHeaders()
paygate_security_headers.set_csp(paygate_csp)
paygate_security_headers.set_hsts(paygate_hsts)

paygate_encryption = EncryptionManager()
paygate_validator = InputValidator()
paygate_session_manager = SecureSessionManager(
    encryption_manager=paygate_encryption,
    session_timeout_minutes=30,
    max_sessions_per_user=5,
    require_csrf=True
)

paygate_hardening = SecurityHardeningMiddleware(
    security_headers=paygate_security_headers,
    input_validator=paygate_validator,
    session_manager=paygate_session_manager
)
