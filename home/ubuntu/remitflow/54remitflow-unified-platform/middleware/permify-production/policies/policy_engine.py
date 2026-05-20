"""
Policy Engine
Implements RBAC, ABAC, and ReBAC policy evaluation
"""

import logging
from typing import Optional, List, Dict, Any, Set
from enum import Enum
from dataclasses import dataclass
import json

from client.permify_client import PermifyClient, get_permify_client, PermissionResult

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PolicyType(Enum):
    """Policy types"""
    RBAC = "RBAC"  # Role-Based Access Control
    ABAC = "ABAC"  # Attribute-Based Access Control
    REBAC = "REBAC"  # Relationship-Based Access Control


@dataclass
class Role:
    """Role definition"""
    id: str
    name: str
    permissions: List[str]
    organization_id: Optional[str] = None


@dataclass
class Attribute:
    """Attribute definition"""
    key: str
    value: Any
    type: str  # string, number, boolean, list


@dataclass
class PolicyRule:
    """Policy rule"""
    id: str
    name: str
    policy_type: PolicyType
    conditions: Dict[str, Any]
    effect: str  # allow or deny
    priority: int = 0


class PolicyEngine:
    """
    Policy engine for evaluating authorization policies
    Supports RBAC, ABAC, and ReBAC
    """
    
    def __init__(self, client: Optional[PermifyClient] = None):
        """
        Initialize policy engine
        
        Args:
            client: Permify client instance
        """
        self.client = client or get_permify_client()
        self.roles: Dict[str, Role] = {}
        self.rules: List[PolicyRule] = []
        logger.info("Policy engine initialized")
    
    # ========================================================================
    # RBAC (Role-Based Access Control)
    # ========================================================================
    
    def register_role(self, role: Role):
        """Register a role"""
        self.roles[role.id] = role
        logger.info(f"Role registered: {role.name} ({role.id})")
    
    def get_role(self, role_id: str) -> Optional[Role]:
        """Get role by ID"""
        return self.roles.get(role_id)
    
    async def assign_role_to_user(
        self,
        user_id: str,
        role_id: str,
        organization_id: Optional[str] = None
    ) -> bool:
        """
        Assign role to user
        
        Args:
            user_id: User ID
            role_id: Role ID
            organization_id: Organization ID (for org-scoped roles)
        
        Returns:
            True if successful
        """
        role = self.get_role(role_id)
        if not role:
            logger.error(f"Role not found: {role_id}")
            return False
        
        # Create relationship in Permify
        entity_type = "organization" if organization_id else "role"
        entity_id = organization_id or role_id
        
        return await self.client.create_relationship(
            entity_type=entity_type,
            entity_id=entity_id,
            relation=role.name.lower().replace(" ", "_"),
            subject_type="user",
            subject_id=user_id
        )
    
    async def check_role_permission(
        self,
        user_id: str,
        role_id: str,
        permission: str
    ) -> bool:
        """
        Check if user has permission through role
        
        Args:
            user_id: User ID
            role_id: Role ID
            permission: Permission to check
        
        Returns:
            True if user has permission through role
        """
        role = self.get_role(role_id)
        if not role:
            return False
        
        # Check if role has permission
        if permission not in role.permissions:
            return False
        
        # Check if user has role
        result = await self.client.check_permission(
            entity_type="role",
            entity_id=role_id,
            permission="member",
            subject_type="user",
            subject_id=user_id
        )
        
        return result.can == PermissionResult.ALLOWED
    
    async def get_user_roles(
        self,
        user_id: str,
        organization_id: Optional[str] = None
    ) -> List[Role]:
        """
        Get all roles assigned to user
        
        Args:
            user_id: User ID
            organization_id: Filter by organization
        
        Returns:
            List of roles
        """
        user_roles = []
        
        for role in self.roles.values():
            if organization_id and role.organization_id != organization_id:
                continue
            
            has_role = await self.check_role_permission(user_id, role.id, "member")
            if has_role:
                user_roles.append(role)
        
        return user_roles
    
    # ========================================================================
    # ABAC (Attribute-Based Access Control)
    # ========================================================================
    
    def add_policy_rule(self, rule: PolicyRule):
        """Add policy rule"""
        self.rules.append(rule)
        self.rules.sort(key=lambda r: r.priority, reverse=True)
        logger.info(f"Policy rule added: {rule.name} ({rule.policy_type.value})")
    
    def remove_policy_rule(self, rule_id: str):
        """Remove policy rule"""
        self.rules = [r for r in self.rules if r.id != rule_id]
        logger.info(f"Policy rule removed: {rule_id}")
    
    async def evaluate_abac_policy(
        self,
        user_attributes: Dict[str, Any],
        resource_attributes: Dict[str, Any],
        action: str,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Evaluate ABAC policy
        
        Args:
            user_attributes: User attributes (e.g., department, level, location)
            resource_attributes: Resource attributes (e.g., classification, owner)
            action: Action to perform
            context: Additional context (e.g., time, location)
        
        Returns:
            True if access is allowed
        """
        # Evaluate all ABAC rules
        for rule in self.rules:
            if rule.policy_type != PolicyType.ABAC:
                continue
            
            if self._evaluate_rule_conditions(
                rule.conditions,
                user_attributes,
                resource_attributes,
                action,
                context
            ):
                return rule.effect == "allow"
        
        # Default deny
        return False
    
    def _evaluate_rule_conditions(
        self,
        conditions: Dict[str, Any],
        user_attributes: Dict[str, Any],
        resource_attributes: Dict[str, Any],
        action: str,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Evaluate rule conditions"""
        context = context or {}
        
        # Check user attribute conditions
        if "user" in conditions:
            for key, expected_value in conditions["user"].items():
                actual_value = user_attributes.get(key)
                if not self._compare_values(actual_value, expected_value):
                    return False
        
        # Check resource attribute conditions
        if "resource" in conditions:
            for key, expected_value in conditions["resource"].items():
                actual_value = resource_attributes.get(key)
                if not self._compare_values(actual_value, expected_value):
                    return False
        
        # Check action
        if "action" in conditions:
            if action not in conditions["action"]:
                return False
        
        # Check context conditions
        if "context" in conditions:
            for key, expected_value in conditions["context"].items():
                actual_value = context.get(key)
                if not self._compare_values(actual_value, expected_value):
                    return False
        
        return True
    
    def _compare_values(self, actual: Any, expected: Any) -> bool:
        """Compare actual and expected values"""
        if isinstance(expected, dict):
            # Handle operators
            if "eq" in expected:
                return actual == expected["eq"]
            elif "ne" in expected:
                return actual != expected["ne"]
            elif "in" in expected:
                return actual in expected["in"]
            elif "not_in" in expected:
                return actual not in expected["not_in"]
            elif "gt" in expected:
                return actual > expected["gt"]
            elif "gte" in expected:
                return actual >= expected["gte"]
            elif "lt" in expected:
                return actual < expected["lt"]
            elif "lte" in expected:
                return actual <= expected["lte"]
            elif "contains" in expected:
                return expected["contains"] in actual
            elif "starts_with" in expected:
                return str(actual).startswith(expected["starts_with"])
            elif "ends_with" in expected:
                return str(actual).endswith(expected["ends_with"])
        
        # Direct comparison
        return actual == expected
    
    # ========================================================================
    # REBAC (Relationship-Based Access Control)
    # ========================================================================
    
    async def evaluate_rebac_policy(
        self,
        subject_type: str,
        subject_id: str,
        relation: str,
        object_type: str,
        object_id: str
    ) -> bool:
        """
        Evaluate ReBAC policy
        
        Args:
            subject_type: Subject type (e.g., "user")
            subject_id: Subject ID
            relation: Relation to check (e.g., "owner", "member")
            object_type: Object type (e.g., "account", "organization")
            object_id: Object ID
        
        Returns:
            True if relationship exists
        """
        # Check direct relationship
        relationships = await self.client.list_relationships(
            entity_type=object_type,
            entity_id=object_id,
            relation=relation,
            subject_type=subject_type,
            subject_id=subject_id
        )
        
        return len(relationships) > 0
    
    async def get_related_entities(
        self,
        subject_type: str,
        subject_id: str,
        relation: str,
        object_type: str
    ) -> List[str]:
        """
        Get all entities related to subject through relation
        
        Args:
            subject_type: Subject type
            subject_id: Subject ID
            relation: Relation
            object_type: Object type
        
        Returns:
            List of entity IDs
        """
        relationships = await self.client.list_relationships(
            entity_type=object_type,
            relation=relation,
            subject_type=subject_type,
            subject_id=subject_id
        )
        
        return [rel.entity_id for rel in relationships]
    
    # ========================================================================
    # COMBINED POLICY EVALUATION
    # ========================================================================
    
    async def evaluate_policy(
        self,
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        user_attributes: Optional[Dict[str, Any]] = None,
        resource_attributes: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Evaluate combined policy (RBAC + ABAC + ReBAC)
        
        Args:
            user_id: User ID
            action: Action to perform
            resource_type: Resource type
            resource_id: Resource ID
            user_attributes: User attributes for ABAC
            resource_attributes: Resource attributes for ABAC
            context: Additional context
        
        Returns:
            True if access is allowed
        """
        # 1. Check ReBAC (relationship-based)
        result = await self.client.check_permission(
            entity_type=resource_type,
            entity_id=resource_id,
            permission=action,
            subject_type="user",
            subject_id=user_id
        )
        
        if result.can == PermissionResult.ALLOWED:
            logger.info(f"Access allowed via ReBAC: user={user_id}, action={action}, resource={resource_type}:{resource_id}")
            return True
        
        # 2. Check RBAC (role-based)
        user_roles = await self.get_user_roles(user_id)
        for role in user_roles:
            if action in role.permissions:
                logger.info(f"Access allowed via RBAC: user={user_id}, role={role.name}, action={action}")
                return True
        
        # 3. Check ABAC (attribute-based)
        if user_attributes and resource_attributes:
            abac_result = await self.evaluate_abac_policy(
                user_attributes=user_attributes,
                resource_attributes=resource_attributes,
                action=action,
                context=context
            )
            
            if abac_result:
                logger.info(f"Access allowed via ABAC: user={user_id}, action={action}, resource={resource_type}:{resource_id}")
                return True
        
        logger.warning(f"Access denied: user={user_id}, action={action}, resource={resource_type}:{resource_id}")
        return False


# ============================================================================
# PREDEFINED ROLES
# ============================================================================

# System admin roles
SUPER_ADMIN_ROLE = Role(
    id="super_admin",
    name="Super Admin",
    permissions=[
        "manage_all", "manage_organizations", "manage_users",
        "view_system_logs", "manage_system_settings", "view_analytics",
        "manage_support_tickets"
    ]
)

SYSTEM_ADMIN_ROLE = Role(
    id="system_admin",
    name="System Admin",
    permissions=[
        "manage_organizations", "manage_users", "view_system_logs",
        "view_analytics", "manage_support_tickets"
    ]
)

# Organization roles
ORG_OWNER_ROLE = Role(
    id="org_owner",
    name="Organization Owner",
    permissions=[
        "view", "edit", "delete", "manage_members", "invite_members",
        "view_analytics", "manage_settings"
    ]
)

ORG_ADMIN_ROLE = Role(
    id="org_admin",
    name="Organization Admin",
    permissions=[
        "view", "edit", "manage_members", "invite_members",
        "view_analytics", "manage_settings"
    ]
)

ORG_MEMBER_ROLE = Role(
    id="org_member",
    name="Organization Member",
    permissions=["view", "invite_members"]
)

# Compliance roles
CHIEF_COMPLIANCE_OFFICER_ROLE = Role(
    id="chief_compliance_officer",
    name="Chief Compliance Officer",
    permissions=[
        "manage_all", "manage_cases", "review_cases", "investigate",
        "approve_kyc", "reject_kyc", "file_sar"
    ]
)

COMPLIANCE_OFFICER_ROLE = Role(
    id="compliance_officer",
    name="Compliance Officer",
    permissions=[
        "review_cases", "investigate", "approve_kyc", "reject_kyc"
    ]
)

COMPLIANCE_ANALYST_ROLE = Role(
    id="compliance_analyst",
    name="Compliance Analyst",
    permissions=["investigate", "review_cases"]
)


def initialize_default_roles(engine: PolicyEngine):
    """Initialize default roles in policy engine"""
    roles = [
        SUPER_ADMIN_ROLE,
        SYSTEM_ADMIN_ROLE,
        ORG_OWNER_ROLE,
        ORG_ADMIN_ROLE,
        ORG_MEMBER_ROLE,
        CHIEF_COMPLIANCE_OFFICER_ROLE,
        COMPLIANCE_OFFICER_ROLE,
        COMPLIANCE_ANALYST_ROLE
    ]
    
    for role in roles:
        engine.register_role(role)
    
    logger.info(f"Initialized {len(roles)} default roles")


# ============================================================================
# PREDEFINED ABAC RULES
# ============================================================================

def initialize_default_abac_rules(engine: PolicyEngine):
    """Initialize default ABAC rules"""
    
    # Rule: Allow high-value transactions only for senior users
    engine.add_policy_rule(PolicyRule(
        id="high_value_transaction_rule",
        name="High Value Transaction Rule",
        policy_type=PolicyType.ABAC,
        conditions={
            "user": {"level": {"in": ["senior", "executive"]}},
            "resource": {"amount": {"gt": 100000}},
            "action": ["approve", "transfer"]
        },
        effect="allow",
        priority=100
    ))
    
    # Rule: Allow access to sensitive data only from secure locations
    engine.add_policy_rule(PolicyRule(
        id="sensitive_data_location_rule",
        name="Sensitive Data Location Rule",
        policy_type=PolicyType.ABAC,
        conditions={
            "resource": {"classification": "sensitive"},
            "context": {"location": {"in": ["office", "vpn"]}},
            "action": ["view", "export"]
        },
        effect="allow",
        priority=90
    ))
    
    # Rule: Allow document verification only during business hours
    engine.add_policy_rule(PolicyRule(
        id="business_hours_verification_rule",
        name="Business Hours Verification Rule",
        policy_type=PolicyType.ABAC,
        conditions={
            "context": {
                "hour": {"gte": 9, "lte": 17},
                "day_of_week": {"in": [1, 2, 3, 4, 5]}  # Monday-Friday
            },
            "action": ["verify", "approve"]
        },
        effect="allow",
        priority=80
    ))
    
    logger.info("Initialized default ABAC rules")

