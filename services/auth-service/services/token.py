import base64

import jwt
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend
from sqlalchemy.orm import Session

from adapters import KeycloakAdapter
from schemas.v1 import Context, GenerateToken
from services.auth import AuthService
from utils import ApiError, get_config
from utils.errors import raise_http_exception_handler

config = get_config()


class TokenService:
    """Token issuance/validation/refresh."""

    def generate_token(self, payload: GenerateToken, db: Session, context: Context):
        auth_service = AuthService(db)
        auth = auth_service.get_auth_by_api_key(payload.key, payload.secret, context)
        if not auth:
            raise_http_exception_handler(401, "Invalid credentials.", "AUTH-AUTH-INT-4002")

        keycloak_adapter = KeycloakAdapter(realm=context.keycloak_realm)
        keycloak_user = keycloak_adapter.get_user(payload.key)
        if keycloak_user is None:
            raise ApiError(message="Invalid user.", status_code=500, code="AUTH-AUTH-INT-5001")

        return keycloak_adapter.request_user_token(payload.key, payload.secret)

    def jwk_to_pem(self, jwk):
        n = int.from_bytes(base64.urlsafe_b64decode(jwk["n"] + "=="), "big")
        e = int.from_bytes(base64.urlsafe_b64decode(jwk["e"] + "=="), "big")
        pub_key = rsa.RSAPublicNumbers(e, n).public_key(default_backend())
        return pub_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )

    def validate_token(self, token: str, context: Context):
        jwks_url = f"{config.KEYCLOAK_BASE_URL}/realms/{context.keycloak_realm}/protocol/openid-connect/certs"
        jwks = requests.get(jwks_url, timeout=10).json()

        headers = jwt.get_unverified_header(token)
        kid = headers["kid"]

        key_data = next(k for k in jwks["keys"] if k["kid"] == kid)
        pem_key = self.jwk_to_pem(key_data)

        return jwt.decode(
            token, key=pem_key, algorithms=["RS256"], options={"verify_exp": True}
        )

    def refresh_token(self, token: str, context: Context) -> dict:
        return KeycloakAdapter(realm=context.keycloak_realm).refresh_user_token(refresh_token=token)


token_service = TokenService()
