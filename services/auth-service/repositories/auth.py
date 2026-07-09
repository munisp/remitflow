from typing import Optional

from sqlalchemy.orm import Session

from models import Auth
from utils.enums import UserRole


class AuthRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_auth_by_email(self, email: str, tenant_id: str) -> Optional[Auth]:
        return (
            self.db.query(Auth)
            .filter(Auth.email == email, Auth.tenant_id == tenant_id)
            .first()
        )

    def get_auth_by_keycloak_id(self, keycloak_id: str, tenant_id: str) -> Optional[Auth]:
        return (
            self.db.query(Auth)
            .filter(Auth.keycloak_id == keycloak_id, Auth.tenant_id == tenant_id)
            .first()
        )

    def get_auth_by_api_key(self, key: str, secret: str, tenant_id: str) -> Optional[Auth]:
        return (
            self.db.query(Auth)
            .filter(Auth.api_key == key, Auth.api_secret == secret, Auth.tenant_id == tenant_id)
            .first()
        )

    def create_auth(
        self,
        email: str,
        user_role: UserRole,
        tenant_id: str,
        keycloak_id: str,
        api_key: str,
        api_secret: str,
    ) -> Auth:
        auth = Auth(
            email=email,
            user_role=user_role,
            tenant_id=tenant_id,
            keycloak_id=keycloak_id,
            api_key=api_key,
            api_secret=api_secret,
        )
        self.db.add(auth)
        return auth
