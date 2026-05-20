#!/usr/bin/env python3
"""
Production Environment Validation Guard
Runs at startup to ensure all required secrets are set and no insecure defaults are in use.
Exits with code 1 if any validation fails — preventing the application from starting.
"""
import os
import sys
import re
import hashlib

# ─────────────────────────────────────────────────────────────────────────────
# INSECURE DEFAULT VALUES — the application must refuse to start with these
# ─────────────────────────────────────────────────────────────────────────────
FORBIDDEN_VALUES = {
    "changeme",
    "your-secret-key-change-in-production",
    "your-encryption-key-change-in-production",
    "your-secret-key",
    "secret",
    "password",
    "12345678",
    "admin",
    "test",
    "development",
    "",
}

# ─────────────────────────────────────────────────────────────────────────────
# REQUIRED SECRETS — must be set in all environments
# ─────────────────────────────────────────────────────────────────────────────
REQUIRED_ALWAYS = [
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "REDIS_PASSWORD",
    "JWT_SECRET_KEY",
    "ENCRYPTION_KEY",
]

# ─────────────────────────────────────────────────────────────────────────────
# REQUIRED IN PRODUCTION — must be set when ENVIRONMENT=production
# ─────────────────────────────────────────────────────────────────────────────
REQUIRED_IN_PRODUCTION = [
    "CORS_ORIGINS",
    "SENTRY_DSN",
    "WISE_API_KEY",
    "TWILIO_AUTH_TOKEN",
    "FIREBASE_SERVER_KEY",
    "SENDGRID_API_KEY",
    "AFRICAS_TALKING_API_KEY",
    "CIRCLE_API_KEY",
    "INFURA_PROJECT_ID",
]

# ─────────────────────────────────────────────────────────────────────────────
# MINIMUM ENTROPY REQUIREMENTS (bits)
# ─────────────────────────────────────────────────────────────────────────────
MIN_ENTROPY_SECRETS = {
    "JWT_SECRET_KEY": 256,
    "ENCRYPTION_KEY": 256,
    "POSTGRES_PASSWORD": 64,
    "REDIS_PASSWORD": 64,
}

# ─────────────────────────────────────────────────────────────────────────────
# CORS VALIDATION
# ─────────────────────────────────────────────────────────────────────────────
FORBIDDEN_CORS_IN_PRODUCTION = [
    "http://localhost",
    "http://127.0.0.1",
    "*",
]


def calculate_entropy_bits(value: str) -> float:
    """Estimate Shannon entropy in bits for the given string."""
    if not value:
        return 0.0
    freq = {}
    for ch in value:
        freq[ch] = freq.get(ch, 0) + 1
    import math
    entropy = 0.0
    length = len(value)
    for count in freq.values():
        p = count / length
        entropy -= p * math.log2(p)
    return entropy * length


def validate_environment() -> list[str]:
    errors = []
    warnings = []
    environment = os.environ.get("ENVIRONMENT", "development").lower()
    is_production = environment == "production"

    print(f"[validate_env] Environment: {environment}")
    print(f"[validate_env] Production mode: {is_production}")

    # ── 1. Check required vars are set ──────────────────────────────────────
    for key in REQUIRED_ALWAYS:
        value = os.environ.get(key, "")
        if not value:
            errors.append(f"MISSING REQUIRED: {key} is not set")
        elif value.lower() in FORBIDDEN_VALUES:
            errors.append(
                f"INSECURE DEFAULT: {key} is set to a known-insecure value '{value}'. "
                f"Generate a secure random value before deploying."
            )

    # ── 2. Check production-only required vars ───────────────────────────────
    if is_production:
        for key in REQUIRED_IN_PRODUCTION:
            value = os.environ.get(key, "")
            if not value:
                errors.append(f"MISSING PRODUCTION REQUIRED: {key} must be set in production")

    # ── 3. Check minimum entropy for critical secrets ────────────────────────
    for key, min_bits in MIN_ENTROPY_SECRETS.items():
        value = os.environ.get(key, "")
        if value and value.lower() not in FORBIDDEN_VALUES:
            entropy = calculate_entropy_bits(value)
            if entropy < min_bits:
                errors.append(
                    f"LOW ENTROPY: {key} has only {entropy:.0f} bits of entropy "
                    f"(minimum required: {min_bits} bits). "
                    f"Use: python3 -c \"import secrets; print(secrets.token_hex(32))\""
                )

    # ── 4. Check DEBUG is not true in production ─────────────────────────────
    debug = os.environ.get("DEBUG", "false").lower()
    if is_production and debug in ("true", "1", "yes"):
        errors.append("SECURITY: DEBUG=true is not allowed in production")

    # ── 5. Check CORS is not localhost in production ─────────────────────────
    if is_production:
        cors = os.environ.get("CORS_ORIGINS", "")
        for forbidden in FORBIDDEN_CORS_IN_PRODUCTION:
            if forbidden in cors:
                errors.append(
                    f"SECURITY: CORS_ORIGINS contains '{forbidden}' which is not allowed in production. "
                    f"Set CORS_ORIGINS to your actual production domain(s)."
                )

    # ── 6. Check JWT_SECRET_KEY is not the same as ENCRYPTION_KEY ────────────
    jwt_key = os.environ.get("JWT_SECRET_KEY", "")
    enc_key = os.environ.get("ENCRYPTION_KEY", "")
    if jwt_key and enc_key and jwt_key == enc_key:
        errors.append(
            "SECURITY: JWT_SECRET_KEY and ENCRYPTION_KEY must be different values. "
            "Using the same key for both purposes weakens security."
        )

    # ── 7. Warn if Vault is not enabled in production ────────────────────────
    vault_enabled = os.environ.get("VAULT_ENABLED", "false").lower()
    if is_production and vault_enabled not in ("true", "1", "yes"):
        warnings.append(
            "WARNING: VAULT_ENABLED is not set to true in production. "
            "It is strongly recommended to use HashiCorp Vault for secret management."
        )

    # ── 8. Check blockchain private key is not in env in production ──────────
    blockchain_key = os.environ.get("BLOCKCHAIN_PRIVATE_KEY", "")
    if is_production and blockchain_key:
        errors.append(
            "SECURITY: BLOCKCHAIN_PRIVATE_KEY must not be stored in environment variables in production. "
            "Use HashiCorp Vault Transit engine for blockchain key management."
        )

    return errors, warnings


def main():
    print("=" * 60)
    print("  RemitFlow Environment Validation Guard")
    print("=" * 60)

    errors, warnings = validate_environment()

    if warnings:
        print("\n[WARNINGS]")
        for w in warnings:
            print(f"  ⚠  {w}")

    if errors:
        print("\n[ERRORS — STARTUP BLOCKED]")
        for e in errors:
            print(f"  ✗  {e}")
        print("\n" + "=" * 60)
        print("  STARTUP REFUSED: Fix the above errors before deploying.")
        print("  Run: python3 scripts/generate_secrets.py to generate secure values.")
        print("=" * 60)
        sys.exit(1)
    else:
        print("\n[OK] All environment validations passed.")
        print("[OK] Application is cleared to start.")
        sys.exit(0)


if __name__ == "__main__":
    main()
