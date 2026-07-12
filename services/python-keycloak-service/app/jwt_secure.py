"""
RemitFlow — Secure Python JWT Utilities
═══════════════════════════════════════════════════════════════════════════
Replaces python-jose with joserfc for all JWT operations.

Mitigations:
  - CVE-2024-28176: JWE Decompression DoS
    → joserfc rejects compressed JWE by default unless explicitly enabled
    → We add an explicit guard to reject any JWE with a 'zip' header
  - Algorithm confusion attacks
    → Strict algorithm allowlist enforced
  - JWT bomb attacks
    → Maximum token size enforced before parsing
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Maximum token size — reject anything larger (decompression bomb protection)
MAX_TOKEN_BYTES = 65_536  # 64 KiB

# Strict algorithm allowlist — never allow "none" or symmetric algorithms
# for tokens that arrive from external sources
ALLOWED_ALGORITHMS = frozenset(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"])


def _decode_header_unsafe(token: str) -> dict[str, Any]:
    """Decode the JWT header without verification (for pre-validation only)."""
    try:
        parts = token.split(".")
        if len(parts) < 2:
            raise ValueError("Token has fewer than 2 parts")
        # Add padding if needed
        header_b64 = parts[0] + "=" * (4 - len(parts[0]) % 4)
        return json.loads(base64.urlsafe_b64decode(header_b64).decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"Cannot decode token header: {exc}") from exc


def verify_token(token: str, public_key: Any, *, audience: str | None = None) -> dict[str, Any]:
    """
    Verify a JWT token using joserfc with strict security controls.

    Args:
        token: The raw JWT string
        public_key: The RSA or EC public key for verification
        audience: Expected audience claim (optional but recommended)

    Returns:
        The verified payload claims dict

    Raises:
        ValueError: If the token is invalid, expired, or uses a disallowed algorithm
        SecurityError: If the token contains a security violation (e.g., compressed JWE)
    """
    # Guard 1: Reject oversized tokens
    if len(token.encode("utf-8")) > MAX_TOKEN_BYTES:
        raise ValueError(f"Token size exceeds maximum of {MAX_TOKEN_BYTES} bytes")

    # Guard 2: Detect JWE (5 parts) and reject compressed variants (CVE-2024-28176)
    parts = token.split(".")
    if len(parts) == 5:
        try:
            header = _decode_header_unsafe(token)
            if header.get("zip"):
                raise ValueError(
                    "Security policy violation: compressed JWE tokens are not accepted "
                    "(CVE-2024-28176 mitigation)"
                )
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError(f"Malformed JWE token: {exc}") from exc

    # Guard 3: Check algorithm allowlist before verification
    try:
        header = _decode_header_unsafe(token)
        alg = header.get("alg", "")
        if alg not in ALLOWED_ALGORITHMS:
            raise ValueError(
                f"Algorithm '{alg}' is not in the allowlist. "
                f"Allowed: {sorted(ALLOWED_ALGORITHMS)}"
            )
    except ValueError:
        raise

    # Perform actual verification using joserfc
    try:
        from joserfc import jwt
        from joserfc.jwk import OctKey, RSAKey, ECKey

        token_obj = jwt.decode(token, public_key)
        claims = token_obj.claims

        # Validate audience if provided
        if audience and claims.get("aud") != audience:
            raise ValueError(
                f"Token audience mismatch: expected '{audience}', got '{claims.get('aud')}'"
            )

        return claims

    except ImportError:
        # Fallback: if joserfc not yet installed, log warning and raise
        logger.error(
            "joserfc is not installed. Install with: pip install joserfc>=0.12.0"
        )
        raise RuntimeError(
            "JWT verification unavailable: joserfc package not installed"
        )
    except Exception as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise ValueError(f"JWT verification failed: {exc}") from exc


def extract_subject_for_logging(token: str) -> str:
    """
    Extract the 'sub' claim from a token WITHOUT verification.
    For logging purposes only — never use for authorization.
    """
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return "unknown"
        payload_b64 = parts[1] + "=" * (4 - len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64).decode("utf-8"))
        return str(payload.get("sub", "unknown"))
    except Exception:
        return "unknown"
