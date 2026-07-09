from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from database import get_session
from schemas.v1 import Context, GenerateToken
from services.token import token_service
from utils.errors import raise_http_exception_handler
from utils.helpers import create_logger

logger = create_logger(__name__)

token_router = APIRouter()


@token_router.post("/generate")
def generate_token(
    payload: GenerateToken,
    db: Session = Depends(get_session),
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
):
    try:
        context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)
        return token_service.generate_token(payload, db, context)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error generating token: {e}")
        raise_http_exception_handler(500, "Failed to generate token.", "AUTH-TOKEN-INT-5001")


@token_router.get("/validate/{token}")
def validate_token(
    token: str,
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
):
    try:
        context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)
        decoded = token_service.validate_token(token, context)
        return {**decoded, "keycloak_id": decoded.get("sub")}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Token validation failed: {e}")
        raise_http_exception_handler(401, "Invalid or expired token.", "AUTH-TOKEN-INV-4010")


@token_router.post("/refresh/{token}")
def refresh_token(
    token: str,
    tenant_id: str = Header(..., alias="x-tenant-id"),
    keycloak_realm: str = Header(..., alias="x-keycloak-realm"),
    keycloak_pub_key: str = Header(..., alias="x-keycloak-pub-key"),
):
    try:
        context = Context(tenant_id=tenant_id, keycloak_realm=keycloak_realm, keycloak_pub_key=keycloak_pub_key)
        return token_service.refresh_token(token, context)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error refreshing token: {e}")
        raise_http_exception_handler(401, "Failed to refresh token.", "AUTH-TOKEN-INT-5002")
