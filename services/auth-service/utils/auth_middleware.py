from fastapi import Depends, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from schemas.v1 import Context
from utils.errors import raise_http_exception_handler
from utils.helpers import create_logger

logger = create_logger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
) -> dict:
    """Validates the Bearer access token against Keycloak's JWKS and returns
    the caller's identity + request context. Used by routes that require an
    authenticated session rather than just the tenant/realm headers (e.g.
    change-password, device management, permission assignment)."""
    if credentials is None or not credentials.credentials:
        raise_http_exception_handler(401, "Missing bearer token.", "AUTH-MW-4010")

    # Imported lazily to avoid a circular import (services.token -> services
    # -> ... -> utils.auth_middleware).
    from services.token import token_service

    context = Context(
        tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key
    )

    try:
        decoded = token_service.validate_token(credentials.credentials, context)
    except Exception as e:
        logger.warning(f"Bearer token validation failed: {e}")
        raise_http_exception_handler(401, "Invalid or expired token.", "AUTH-MW-4011")

    return {
        "keycloak_id": decoded.get("sub"),
        "email": decoded.get("email"),
        "tenant_id": tenant_id,
        "context": context,
        "claims": decoded,
    }
