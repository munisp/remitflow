"""
GPU Training Engine — Authentication & Authorization Middleware

Provides:
  - JWT token generation and validation
  - Role-based access control (admin, ml_engineer, data_scientist, viewer)
  - API key authentication
  - Password hashing with bcrypt
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

logger = logging.getLogger("middleware.auth")

JWT_SECRET = os.getenv("JWT_SECRET", "gpu-engine-dev-secret-change-in-production")
JWT_EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", "24"))
API_KEY_PREFIX_LEN = 8

ROLE_HIERARCHY = {"admin": 4, "ml_engineer": 3, "data_scientist": 2, "viewer": 1}

ROLE_PERMISSIONS = {
    "admin": {
        "train": True, "infer": True, "export": True, "benchmark": True,
        "manage_nodes": True, "manage_users": True, "delete_models": True,
        "view_audit": True, "manage_api_keys": True,
    },
    "ml_engineer": {
        "train": True, "infer": True, "export": True, "benchmark": True,
        "manage_nodes": True, "manage_users": False, "delete_models": True,
        "view_audit": False, "manage_api_keys": True,
    },
    "data_scientist": {
        "train": True, "infer": True, "export": False, "benchmark": True,
        "manage_nodes": False, "manage_users": False, "delete_models": False,
        "view_audit": False, "manage_api_keys": False,
    },
    "viewer": {
        "train": False, "infer": False, "export": False, "benchmark": False,
        "manage_nodes": False, "manage_users": False, "delete_models": False,
        "view_audit": False, "manage_api_keys": False,
    },
}


def hash_password(password: str) -> str:
    """Hash a password using PBKDF2-HMAC-SHA256."""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}:{h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Verify a password against a stored hash."""
    parts = stored.split(":", 1)
    if len(parts) != 2:
        return False
    salt, expected = parts
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return hmac.compare_digest(h.hex(), expected)


def create_jwt(user_id: str, username: str, role: str) -> str:
    """Create a simple JWT (HMAC-SHA256)."""
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}))
    payload = _b64url(json.dumps({
        "sub": user_id,
        "username": username,
        "role": role,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_EXPIRY_HOURS * 3600,
    }))
    signature = _sign(f"{header}.{payload}")
    return f"{header}.{payload}.{signature}"


def validate_jwt(token: str) -> Optional[Dict]:
    """Validate and decode a JWT. Returns payload or None."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, payload, signature = parts
        expected_sig = _sign(f"{header}.{payload}")
        if not hmac.compare_digest(signature, expected_sig):
            return None
        data = json.loads(_b64url_decode(payload))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


def generate_api_key() -> Tuple[str, str, str]:
    """Generate an API key. Returns (full_key, prefix, key_hash)."""
    key = f"gpe_{secrets.token_hex(32)}"
    prefix = key[:API_KEY_PREFIX_LEN]
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    return key, prefix, key_hash


def verify_api_key(key: str) -> str:
    """Hash an API key for lookup."""
    return hashlib.sha256(key.encode()).hexdigest()


def has_permission(role: str, permission: str) -> bool:
    """Check if a role has a specific permission."""
    return ROLE_PERMISSIONS.get(role, {}).get(permission, False)


def require_role(minimum_role: str):
    """Decorator factory — FastAPI dependency for role-based access."""
    min_level = ROLE_HIERARCHY.get(minimum_role, 0)

    def check(user_role: str) -> bool:
        return ROLE_HIERARCHY.get(user_role, 0) >= min_level

    return check


def _b64url(data: str) -> str:
    import base64
    return base64.urlsafe_b64encode(data.encode()).rstrip(b"=").decode()


def _b64url_decode(data: str) -> str:
    import base64
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data).decode()


def _sign(data: str) -> str:
    import base64
    sig = hmac.new(JWT_SECRET.encode(), data.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
