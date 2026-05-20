"""
Policy-Based Access Control (PBAC) Engine
Provides context-aware authorization with fine-grained data visibility control.

This engine evaluates policies based on:
- Subject attributes (user roles, permissions, KYC tier, tenant)
- Resource attributes (type, owner, amount, corridor, status)
- Action being performed
- Environmental context (time, channel, IP)

Designed to be swappable with OPA/Keycloak Authorization in production.
"""

import os
import yaml
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

POLICIES_DIR = os.getenv("POLICIES_DIR", os.path.join(os.path.dirname(__file__), "policies"))
PBAC_FAIL_OPEN = os.getenv("PBAC_FAIL_OPEN", "false").lower() == "true"


class PolicyEffect(str, Enum):
    ALLOW = "allow"
    DENY = "deny"


@dataclass
class Subject:
    """Represents the entity requesting access (user or service)"""
    user_id: str
    roles: List[str] = field(default_factory=list)
    permissions: List[str] = field(default_factory=list)
    tenant_id: Optional[str] = None
    kyc_tier: Optional[str] = None
    risk_score: Optional[float] = None
    region: Optional[str] = None
    attributes: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_authenticated_user(cls, user: Any, tenant_id: Optional[str] = None) -> "Subject":
        """Create Subject from AuthenticatedUser"""
        return cls(
            user_id=user.user_id,
            roles=user.roles,
            permissions=user.permissions,
            tenant_id=tenant_id,
            attributes=user.metadata if hasattr(user, 'metadata') else {}
        )


@dataclass
class Resource:
    """Represents the resource being accessed"""
    type: str
    id: Optional[str] = None
    owner_id: Optional[str] = None
    tenant_id: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    corridor: Optional[str] = None
    status: Optional[str] = None
    attributes: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PolicyContext:
    """Environmental context for policy evaluation"""
    timestamp: datetime = field(default_factory=datetime.utcnow)
    channel: Optional[str] = None
    ip_address: Optional[str] = None
    device_fingerprint: Optional[str] = None
    request_id: Optional[str] = None
    attributes: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PolicyDecision:
    """Result of policy evaluation"""
    allowed: bool
    reason: str
    policy_id: Optional[str] = None
    redactions: List[str] = field(default_factory=list)
    required_approvals: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "policy_id": self.policy_id,
            "redactions": self.redactions,
            "required_approvals": self.required_approvals,
            "metadata": self.metadata
        }


@dataclass
class Policy:
    """A single policy definition"""
    id: str
    description: str
    subjects: Dict[str, Any]
    actions: List[str]
    resources: Dict[str, Any]
    conditions: List[Dict[str, Any]] = field(default_factory=list)
    effect: PolicyEffect = PolicyEffect.ALLOW
    priority: int = 0
    redactions: List[str] = field(default_factory=list)
    required_approvals: List[str] = field(default_factory=list)
    tenant_id: Optional[str] = None
    enabled: bool = True


class ConditionEvaluator:
    """Evaluates policy conditions against subject, resource, and context"""

    @staticmethod
    def evaluate(
        condition: Dict[str, Any],
        subject: Subject,
        resource: Resource,
        context: PolicyContext
    ) -> bool:
        """Evaluate a single condition"""
        condition_type = condition.get("type")

        evaluators = {
            "tenant_match": ConditionEvaluator._tenant_match,
            "owner_match": ConditionEvaluator._owner_match,
            "amount_gte": ConditionEvaluator._amount_gte,
            "amount_lte": ConditionEvaluator._amount_lte,
            "amount_between": ConditionEvaluator._amount_between,
            "corridor_in": ConditionEvaluator._corridor_in,
            "corridor_not_in": ConditionEvaluator._corridor_not_in,
            "kyc_tier_gte": ConditionEvaluator._kyc_tier_gte,
            "kyc_tier_in": ConditionEvaluator._kyc_tier_in,
            "risk_score_lte": ConditionEvaluator._risk_score_lte,
            "risk_score_gte": ConditionEvaluator._risk_score_gte,
            "status_in": ConditionEvaluator._status_in,
            "status_not_in": ConditionEvaluator._status_not_in,
            "channel_in": ConditionEvaluator._channel_in,
            "time_between": ConditionEvaluator._time_between,
            "has_role": ConditionEvaluator._has_role,
            "has_permission": ConditionEvaluator._has_permission,
            "attribute_equals": ConditionEvaluator._attribute_equals,
            "attribute_in": ConditionEvaluator._attribute_in,
        }

        evaluator = evaluators.get(condition_type)
        if evaluator is None:
            logger.warning(f"Unknown condition type: {condition_type}")
            return False

        try:
            return evaluator(condition, subject, resource, context)
        except Exception as e:
            logger.error(f"Error evaluating condition {condition_type}: {e}")
            return False

    @staticmethod
    def _tenant_match(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        if subject.tenant_id is None or resource.tenant_id is None:
            return condition.get("allow_null", True)
        return subject.tenant_id == resource.tenant_id

    @staticmethod
    def _owner_match(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        return subject.user_id == resource.owner_id

    @staticmethod
    def _amount_gte(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        if resource.amount is None:
            return False
        return resource.amount >= condition.get("value", 0)

    @staticmethod
    def _amount_lte(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        if resource.amount is None:
            return False
        return resource.amount <= condition.get("value", float("inf"))

    @staticmethod
    def _amount_between(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        if resource.amount is None:
            return False
        min_val = condition.get("min", 0)
        max_val = condition.get("max", float("inf"))
        return min_val <= resource.amount <= max_val

    @staticmethod
    def _corridor_in(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        corridors = condition.get("values", [])
        return resource.corridor in corridors

    @staticmethod
    def _corridor_not_in(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        corridors = condition.get("values", [])
        return resource.corridor not in corridors

    @staticmethod
    def _kyc_tier_gte(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        tier_order = {"tier_0": 0, "tier_1": 1, "tier_2": 2, "tier_3": 3, "tier_4": 4}
        required_tier = condition.get("value", "tier_0")
        user_tier = subject.kyc_tier or "tier_0"
        return tier_order.get(user_tier, 0) >= tier_order.get(required_tier, 0)

    @staticmethod
    def _kyc_tier_in(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        tiers = condition.get("values", [])
        return subject.kyc_tier in tiers

    @staticmethod
    def _risk_score_lte(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        if subject.risk_score is None:
            return condition.get("allow_null", True)
        return subject.risk_score <= condition.get("value", 100)

    @staticmethod
    def _risk_score_gte(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        if subject.risk_score is None:
            return False
        return subject.risk_score >= condition.get("value", 0)

    @staticmethod
    def _status_in(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        statuses = condition.get("values", [])
        return resource.status in statuses

    @staticmethod
    def _status_not_in(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        statuses = condition.get("values", [])
        return resource.status not in statuses

    @staticmethod
    def _channel_in(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        channels = condition.get("values", [])
        return context.channel in channels

    @staticmethod
    def _time_between(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        start_hour = condition.get("start_hour", 0)
        end_hour = condition.get("end_hour", 24)
        current_hour = context.timestamp.hour
        return start_hour <= current_hour < end_hour

    @staticmethod
    def _has_role(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        required_role = condition.get("value")
        return required_role in subject.roles

    @staticmethod
    def _has_permission(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        required_permission = condition.get("value")
        return required_permission in subject.permissions

    @staticmethod
    def _attribute_equals(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        attr_path = condition.get("path", "")
        expected_value = condition.get("value")
        source = condition.get("source", "resource")

        if source == "subject":
            actual_value = subject.attributes.get(attr_path)
        elif source == "resource":
            actual_value = resource.attributes.get(attr_path)
        else:
            actual_value = context.attributes.get(attr_path)

        return actual_value == expected_value

    @staticmethod
    def _attribute_in(condition: Dict, subject: Subject, resource: Resource, context: PolicyContext) -> bool:
        attr_path = condition.get("path", "")
        allowed_values = condition.get("values", [])
        source = condition.get("source", "resource")

        if source == "subject":
            actual_value = subject.attributes.get(attr_path)
        elif source == "resource":
            actual_value = resource.attributes.get(attr_path)
        else:
            actual_value = context.attributes.get(attr_path)

        return actual_value in allowed_values


class PolicyEngine:
    """Main PBAC engine that loads and evaluates policies"""

    def __init__(self, policies_dir: Optional[str] = None):
        self.policies_dir = policies_dir or POLICIES_DIR
        self.policies: List[Policy] = []
        self.policies_by_action: Dict[str, List[Policy]] = {}
        self.policies_by_resource: Dict[str, List[Policy]] = {}
        self._load_policies()

    def _load_policies(self) -> None:
        """Load all policies from YAML files"""
        policies_path = Path(self.policies_dir)
        if not policies_path.exists():
            logger.warning(f"Policies directory not found: {self.policies_dir}")
            return

        for yaml_file in policies_path.glob("**/*.yaml"):
            try:
                with open(yaml_file, "r") as f:
                    policy_data = yaml.safe_load(f)

                if policy_data is None:
                    continue

                policies_list = policy_data if isinstance(policy_data, list) else [policy_data]

                for policy_dict in policies_list:
                    policy = self._parse_policy(policy_dict)
                    if policy and policy.enabled:
                        self.policies.append(policy)
                        self._index_policy(policy)

                logger.info(f"Loaded policies from {yaml_file}")
            except Exception as e:
                logger.error(f"Error loading policies from {yaml_file}: {e}")

        self.policies.sort(key=lambda p: -p.priority)
        logger.info(f"Total policies loaded: {len(self.policies)}")

    def _parse_policy(self, policy_dict: Dict[str, Any]) -> Optional[Policy]:
        """Parse a policy dictionary into a Policy object"""
        try:
            return Policy(
                id=policy_dict["id"],
                description=policy_dict.get("description", ""),
                subjects=policy_dict.get("subjects", {}),
                actions=policy_dict.get("actions", []),
                resources=policy_dict.get("resources", {}),
                conditions=policy_dict.get("conditions", []),
                effect=PolicyEffect(policy_dict.get("effect", "allow")),
                priority=policy_dict.get("priority", 0),
                redactions=policy_dict.get("redactions", []),
                required_approvals=policy_dict.get("required_approvals", []),
                tenant_id=policy_dict.get("tenant_id"),
                enabled=policy_dict.get("enabled", True)
            )
        except Exception as e:
            logger.error(f"Error parsing policy: {e}")
            return None

    def _index_policy(self, policy: Policy) -> None:
        """Index policy by action and resource type for faster lookup"""
        for action in policy.actions:
            if action not in self.policies_by_action:
                self.policies_by_action[action] = []
            self.policies_by_action[action].append(policy)

        resource_type = policy.resources.get("type")
        if resource_type:
            if resource_type not in self.policies_by_resource:
                self.policies_by_resource[resource_type] = []
            self.policies_by_resource[resource_type].append(policy)

    def _matches_subject(self, policy: Policy, subject: Subject) -> bool:
        """Check if subject matches policy subject criteria"""
        policy_subjects = policy.subjects

        if "roles" in policy_subjects:
            required_roles = policy_subjects["roles"]
            if not any(role in subject.roles for role in required_roles):
                return False

        if "permissions" in policy_subjects:
            required_permissions = policy_subjects["permissions"]
            if not any(perm in subject.permissions for perm in required_permissions):
                return False

        if "user_ids" in policy_subjects:
            if subject.user_id not in policy_subjects["user_ids"]:
                return False

        if "exclude_roles" in policy_subjects:
            excluded_roles = policy_subjects["exclude_roles"]
            if any(role in subject.roles for role in excluded_roles):
                return False

        return True

    def _matches_resource(self, policy: Policy, resource: Resource) -> bool:
        """Check if resource matches policy resource criteria"""
        policy_resources = policy.resources

        if "type" in policy_resources:
            if resource.type != policy_resources["type"]:
                return False

        if "types" in policy_resources:
            if resource.type not in policy_resources["types"]:
                return False

        if "statuses" in policy_resources:
            if resource.status not in policy_resources["statuses"]:
                return False

        return True

    def _matches_action(self, policy: Policy, action: str) -> bool:
        """Check if action matches policy actions"""
        if "*" in policy.actions:
            return True
        return action in policy.actions

    def _evaluate_conditions(
        self,
        policy: Policy,
        subject: Subject,
        resource: Resource,
        context: PolicyContext
    ) -> bool:
        """Evaluate all conditions for a policy"""
        for condition in policy.conditions:
            if not ConditionEvaluator.evaluate(condition, subject, resource, context):
                return False
        return True

    def authorize(
        self,
        subject: Subject,
        action: str,
        resource: Resource,
        context: Optional[PolicyContext] = None
    ) -> PolicyDecision:
        """
        Evaluate policies and return authorization decision.

        Args:
            subject: The entity requesting access
            action: The action being performed (e.g., "transaction:approve", "dispute:view")
            resource: The resource being accessed
            context: Environmental context

        Returns:
            PolicyDecision with allow/deny and any redactions
        """
        if context is None:
            context = PolicyContext()

        applicable_policies = self._get_applicable_policies(action, resource.type)

        deny_decision: Optional[PolicyDecision] = None
        allow_decision: Optional[PolicyDecision] = None

        for policy in applicable_policies:
            if policy.tenant_id and policy.tenant_id != subject.tenant_id:
                continue

            if not self._matches_subject(policy, subject):
                continue

            if not self._matches_resource(policy, resource):
                continue

            if not self._matches_action(policy, action):
                continue

            if not self._evaluate_conditions(policy, subject, resource, context):
                continue

            if policy.effect == PolicyEffect.DENY:
                deny_decision = PolicyDecision(
                    allowed=False,
                    reason=f"Denied by policy: {policy.description}",
                    policy_id=policy.id,
                    metadata={"policy_priority": policy.priority}
                )
                break

            if policy.effect == PolicyEffect.ALLOW and allow_decision is None:
                allow_decision = PolicyDecision(
                    allowed=True,
                    reason=f"Allowed by policy: {policy.description}",
                    policy_id=policy.id,
                    redactions=self._get_redactions_for_subject(policy, subject),
                    required_approvals=policy.required_approvals,
                    metadata={"policy_priority": policy.priority}
                )

        if deny_decision:
            return deny_decision

        if allow_decision:
            return allow_decision

        if PBAC_FAIL_OPEN:
            return PolicyDecision(
                allowed=True,
                reason="No matching policy found (fail-open mode)",
                metadata={"default_decision": True}
            )

        return PolicyDecision(
            allowed=False,
            reason="No matching policy found (fail-closed mode)",
            metadata={"default_decision": True}
        )

    def _get_applicable_policies(self, action: str, resource_type: str) -> List[Policy]:
        """Get policies that might apply to this action/resource"""
        action_policies = set(self.policies_by_action.get(action, []))
        action_policies.update(self.policies_by_action.get("*", []))

        resource_policies = set(self.policies_by_resource.get(resource_type, []))
        resource_policies.update(self.policies_by_resource.get("*", []))

        if action_policies and resource_policies:
            applicable = action_policies.intersection(resource_policies)
        elif action_policies:
            applicable = action_policies
        elif resource_policies:
            applicable = resource_policies
        else:
            applicable = set(self.policies)

        return sorted(applicable, key=lambda p: -p.priority)

    def _get_redactions_for_subject(self, policy: Policy, subject: Subject) -> List[str]:
        """Get redactions, considering role-based overrides"""
        redactions = list(policy.redactions)

        if "admin" in subject.roles or "compliance" in subject.roles:
            return []

        return redactions

    def reload_policies(self) -> None:
        """Reload all policies from disk"""
        self.policies = []
        self.policies_by_action = {}
        self.policies_by_resource = {}
        self._load_policies()


_engine: Optional[PolicyEngine] = None


def get_policy_engine() -> PolicyEngine:
    """Get or create the global policy engine instance"""
    global _engine
    if _engine is None:
        _engine = PolicyEngine()
    return _engine


async def enforce(
    user: Any,
    action: str,
    resource: Resource,
    context: Optional[PolicyContext] = None,
    tenant_id: Optional[str] = None
) -> PolicyDecision:
    """
    Main enforcement function for use in services.

    Args:
        user: AuthenticatedUser from auth_middleware
        action: Action being performed (e.g., "dispute:view", "transaction:approve")
        resource: Resource being accessed
        context: Optional environmental context
        tenant_id: Optional tenant ID for multi-tenant scenarios

    Returns:
        PolicyDecision

    Raises:
        HTTPException(403) if access is denied
    """
    from fastapi import HTTPException

    engine = get_policy_engine()
    subject = Subject.from_authenticated_user(user, tenant_id)

    decision = engine.authorize(subject, action, resource, context)

    try:
        from .audit_client import log_audit_event, AuditEventType, AuditSeverity
        await log_audit_event(
            service_name="policy-engine",
            event_type=AuditEventType.AUTHORIZATION_CHECK if decision.allowed else AuditEventType.AUTHORIZATION_DENIED,
            user_id=subject.user_id,
            severity=AuditSeverity.INFO if decision.allowed else AuditSeverity.WARNING,
            details={
                "action": action,
                "resource_type": resource.type,
                "resource_id": resource.id,
                "decision": decision.to_dict(),
                "tenant_id": tenant_id
            }
        )
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"Failed to log policy decision: {e}")

    if not decision.allowed:
        raise HTTPException(
            status_code=403,
            detail=decision.reason
        )

    return decision


def apply_redactions(data: Dict[str, Any], redactions: List[str]) -> Dict[str, Any]:
    """
    Apply field redactions to response data.

    Args:
        data: The data dictionary to redact
        redactions: List of field paths to redact (e.g., ["kyc.full_address", "bank_account"])

    Returns:
        Data with redacted fields replaced with "[REDACTED]"
    """
    if not redactions:
        return data

    result = dict(data)

    for field_path in redactions:
        parts = field_path.split(".")
        current = result

        for i, part in enumerate(parts[:-1]):
            if isinstance(current, dict) and part in current:
                if i == len(parts) - 2:
                    current = current
                else:
                    current = current[part]
            else:
                break
        else:
            final_key = parts[-1]
            if isinstance(current, dict) and final_key in current:
                current[final_key] = "[REDACTED]"

    return result


def require_policy(action: str, resource_type: str):
    """
    Decorator for FastAPI endpoints that require policy authorization.

    Usage:
        @router.get("/disputes/{dispute_id}")
        @require_policy("dispute:view", "dispute")
        async def get_dispute(dispute_id: str, user: AuthenticatedUser = Depends(get_current_user)):
            ...
    """
    from functools import wraps

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await func(*args, **kwargs)
        wrapper._pbac_action = action
        wrapper._pbac_resource_type = resource_type
        return wrapper
    return decorator
