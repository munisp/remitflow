"""
Pure lookup/validation helper over the v2.perm role names
(schemas/permify/v2.perm). Keep these lists in sync with that file.
"""

from typing import Optional, Tuple

from utils.enums import UserRole

PLATFORM_ROLE_LABELS = {
    "super_admin": "Super Admin",
    "tenant_manager": "Tenant Manager",
    "operations_manager": "Operations Manager",
    "risk_manager": "Risk Manager",
    "internal_auditor": "Internal Auditor",
    "it_admin": "IT Admin",
    "relationship_manager": "Relationship Manager",
    "compliance_officer": "Compliance Officer",
    "support_agent": "Support Agent",
}

TENANT_ROLE_LABELS = {
    "super_admin": "Super Admin",
    "branch_manager": "Branch Manager",
    "operations_manager": "Operations Manager",
    "risk_manager": "Risk Manager",
    "internal_auditor": "Internal Auditor",
    "it_admin": "IT Admin",
    "relationship_manager": "Relationship Manager",
    "trade_finance_admin": "Trade Finance Admin",
    "vault_manager": "Vault Manager",
    "treasury_manager": "Treasury Manager",
    "loan_officer": "Loan Officer",
    "compliance_officer": "Compliance Officer",
    "support_agent": "Support Agent",
    "teller": "Teller",
    "fraud_analyst": "Fraud Analyst",
}


class RoleMapper:
    @staticmethod
    def validate_platform_role(role: str) -> bool:
        return role in PLATFORM_ROLE_LABELS

    @staticmethod
    def validate_tenant_role(role: str) -> bool:
        return role in TENANT_ROLE_LABELS

    @staticmethod
    def get_platform_role_label(role: str) -> str:
        return PLATFORM_ROLE_LABELS.get(role, role)

    @staticmethod
    def get_tenant_role_label(role: str) -> str:
        return TENANT_ROLE_LABELS.get(role, role)

    @staticmethod
    def get_default_roles_for_user_role(
        user_role: UserRole,
    ) -> Tuple[Optional[str], Optional[str]]:
        """Derive sensible (platform_role, tenant_role) defaults from the
        legacy UserRole when neither is given explicitly at auth creation."""
        if user_role == UserRole.SUPERADMIN:
            return "super_admin", "super_admin"
        if user_role == UserRole.ADMIN:
            return "operations_manager", "operations_manager"
        return None, None
