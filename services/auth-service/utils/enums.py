import enum


class UserRole(str, enum.Enum):
    """Legacy Keycloak-authentication-level routing role. Kept solely for
    login/superadmin-tenant-resolution purposes — never written to Permify
    directly (fine-grained authorization uses platform_role/tenant_role
    against the v2.perm schema instead)."""

    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"
