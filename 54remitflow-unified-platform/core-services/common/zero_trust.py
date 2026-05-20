"""
Zero Trust Architecture Implementation for PayGate

Implements:
1. Identity verification at every access point
2. Least privilege access
3. Micro-segmentation
4. Continuous validation
5. Device trust scoring
"""

import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional

import jwt
from cryptography.fernet import Fernet
from pydantic import BaseModel, Field


class TrustLevel(str, Enum):
    """Trust levels for Zero Trust scoring"""
    UNTRUSTED = "untrusted"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERIFIED = "verified"


class AccessDecision(str, Enum):
    """Access control decisions"""
    ALLOW = "allow"
    DENY = "deny"
    CHALLENGE = "challenge"
    STEP_UP = "step_up"


class DeviceType(str, Enum):
    """Device types for trust scoring"""
    UNKNOWN = "unknown"
    MOBILE = "mobile"
    DESKTOP = "desktop"
    TABLET = "tablet"
    API_CLIENT = "api_client"
    SERVICE = "service"


@dataclass
class DeviceFingerprint:
    """Device fingerprint for trust scoring"""
    device_id: str
    device_type: DeviceType
    user_agent: str
    ip_address: str
    geo_location: Optional[str] = None
    os_version: Optional[str] = None
    app_version: Optional[str] = None
    screen_resolution: Optional[str] = None
    timezone: Optional[str] = None
    language: Optional[str] = None
    is_rooted: bool = False
    is_emulator: bool = False
    last_seen: datetime = field(default_factory=datetime.utcnow)
    trust_score: float = 0.0


@dataclass
class SessionContext:
    """Session context for continuous validation"""
    session_id: str
    user_id: str
    device: DeviceFingerprint
    created_at: datetime
    last_activity: datetime
    trust_level: TrustLevel
    mfa_verified: bool = False
    biometric_verified: bool = False
    ip_addresses: list = field(default_factory=list)
    risk_score: float = 0.0
    access_history: list = field(default_factory=list)


class ZeroTrustPolicy(BaseModel):
    """Zero Trust policy configuration"""
    policy_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str
    resource_pattern: str
    required_trust_level: TrustLevel = TrustLevel.MEDIUM
    require_mfa: bool = False
    require_biometric: bool = False
    max_session_age_minutes: int = 60
    max_risk_score: float = 0.7
    allowed_device_types: list[DeviceType] = Field(default_factory=lambda: list(DeviceType))
    allowed_geo_locations: list[str] = Field(default_factory=list)
    denied_geo_locations: list[str] = Field(default_factory=list)
    time_restrictions: Optional[dict] = None
    rate_limit_per_minute: int = 100
    require_encryption: bool = True
    audit_all_access: bool = True


class DeviceTrustScorer:
    """Device trust scoring engine"""
    
    def __init__(self):
        self.known_devices: dict[str, DeviceFingerprint] = {}
        self.suspicious_patterns: list[str] = []
        
    def calculate_trust_score(self, device: DeviceFingerprint, user_id: str) -> float:
        """Calculate device trust score (0.0 - 1.0)"""
        score = 0.5  # Base score
        
        # Known device bonus
        device_key = f"{user_id}:{device.device_id}"
        if device_key in self.known_devices:
            known = self.known_devices[device_key]
            # Consistent device gets higher score
            if known.user_agent == device.user_agent:
                score += 0.1
            if known.timezone == device.timezone:
                score += 0.05
            # Long-standing device relationship
            days_known = (datetime.utcnow() - known.last_seen).days
            if days_known > 30:
                score += 0.1
            elif days_known > 7:
                score += 0.05
        else:
            # New device penalty
            score -= 0.1
            
        # Security indicators
        if device.is_rooted:
            score -= 0.3
        if device.is_emulator:
            score -= 0.4
            
        # Device type scoring
        if device.device_type == DeviceType.SERVICE:
            score += 0.1  # Service accounts are pre-verified
        elif device.device_type == DeviceType.UNKNOWN:
            score -= 0.2
            
        # Geo-location consistency
        if device.geo_location:
            if device_key in self.known_devices:
                known = self.known_devices[device_key]
                if known.geo_location == device.geo_location:
                    score += 0.05
                else:
                    score -= 0.1  # Location change
                    
        # Clamp score
        return max(0.0, min(1.0, score))
    
    def register_device(self, device: DeviceFingerprint, user_id: str) -> None:
        """Register a device for a user"""
        device_key = f"{user_id}:{device.device_id}"
        device.trust_score = self.calculate_trust_score(device, user_id)
        self.known_devices[device_key] = device
        
    def get_trust_level(self, score: float) -> TrustLevel:
        """Convert trust score to trust level"""
        if score >= 0.9:
            return TrustLevel.VERIFIED
        elif score >= 0.7:
            return TrustLevel.HIGH
        elif score >= 0.5:
            return TrustLevel.MEDIUM
        elif score >= 0.3:
            return TrustLevel.LOW
        else:
            return TrustLevel.UNTRUSTED


class IdentityVerifier:
    """Identity verification at every access point"""
    
    def __init__(self, jwt_secret: str, jwt_algorithm: str = "HS256"):
        self.jwt_secret = jwt_secret
        self.jwt_algorithm = jwt_algorithm
        self.revoked_tokens: set[str] = set()
        self.active_sessions: dict[str, SessionContext] = {}
        
    def create_token(
        self,
        user_id: str,
        session_id: str,
        claims: dict[str, Any],
        expiry_minutes: int = 15
    ) -> str:
        """Create a short-lived JWT token"""
        now = datetime.utcnow()
        payload = {
            "sub": user_id,
            "sid": session_id,
            "iat": now,
            "exp": now + timedelta(minutes=expiry_minutes),
            "jti": str(uuid.uuid4()),
            **claims
        }
        return jwt.encode(payload, self.jwt_secret, algorithm=self.jwt_algorithm)
    
    def verify_token(self, token: str) -> tuple[bool, Optional[dict]]:
        """Verify JWT token"""
        try:
            payload = jwt.decode(
                token,
                self.jwt_secret,
                algorithms=[self.jwt_algorithm]
            )
            
            # Check if token is revoked
            if payload.get("jti") in self.revoked_tokens:
                return False, None
                
            # Check if session is still active
            session_id = payload.get("sid")
            if session_id and session_id not in self.active_sessions:
                return False, None
                
            return True, payload
        except jwt.ExpiredSignatureError:
            return False, None
        except jwt.InvalidTokenError:
            return False, None
            
    def revoke_token(self, token_id: str) -> None:
        """Revoke a token"""
        self.revoked_tokens.add(token_id)
        
    def create_session(
        self,
        user_id: str,
        device: DeviceFingerprint,
        trust_level: TrustLevel
    ) -> SessionContext:
        """Create a new session"""
        now = datetime.utcnow()
        session = SessionContext(
            session_id=str(uuid.uuid4()),
            user_id=user_id,
            device=device,
            created_at=now,
            last_activity=now,
            trust_level=trust_level,
            ip_addresses=[device.ip_address]
        )
        self.active_sessions[session.session_id] = session
        return session
        
    def validate_session(self, session_id: str) -> tuple[bool, Optional[SessionContext]]:
        """Validate an active session"""
        session = self.active_sessions.get(session_id)
        if not session:
            return False, None
            
        # Check session age
        age = datetime.utcnow() - session.created_at
        if age > timedelta(hours=24):
            self.terminate_session(session_id)
            return False, None
            
        return True, session
        
    def terminate_session(self, session_id: str) -> None:
        """Terminate a session"""
        if session_id in self.active_sessions:
            del self.active_sessions[session_id]


class MicroSegmentation:
    """Micro-segmentation for network and service isolation"""
    
    def __init__(self):
        self.segments: dict[str, set[str]] = {}
        self.service_permissions: dict[str, set[str]] = {}
        self.resource_segments: dict[str, str] = {}
        
    def define_segment(self, segment_name: str, services: list[str]) -> None:
        """Define a network segment"""
        self.segments[segment_name] = set(services)
        
    def assign_resource_to_segment(self, resource: str, segment: str) -> None:
        """Assign a resource to a segment"""
        self.resource_segments[resource] = segment
        
    def grant_segment_access(self, service: str, segment: str) -> None:
        """Grant a service access to a segment"""
        if service not in self.service_permissions:
            self.service_permissions[service] = set()
        self.service_permissions[service].add(segment)
        
    def can_access_resource(self, service: str, resource: str) -> bool:
        """Check if a service can access a resource"""
        segment = self.resource_segments.get(resource)
        if not segment:
            return False
            
        allowed_segments = self.service_permissions.get(service, set())
        return segment in allowed_segments
        
    def get_allowed_services(self, segment: str) -> set[str]:
        """Get services allowed in a segment"""
        return self.segments.get(segment, set())


class ContinuousValidator:
    """Continuous validation of access and behavior"""
    
    def __init__(self, device_scorer: DeviceTrustScorer):
        self.device_scorer = device_scorer
        self.behavior_baselines: dict[str, dict] = {}
        self.anomaly_threshold = 0.7
        
    def update_baseline(self, user_id: str, behavior: dict) -> None:
        """Update user behavior baseline"""
        if user_id not in self.behavior_baselines:
            self.behavior_baselines[user_id] = {
                "typical_hours": set(),
                "typical_locations": set(),
                "typical_actions": {},
                "typical_amounts": []
            }
            
        baseline = self.behavior_baselines[user_id]
        
        if "hour" in behavior:
            baseline["typical_hours"].add(behavior["hour"])
        if "location" in behavior:
            baseline["typical_locations"].add(behavior["location"])
        if "action" in behavior:
            action = behavior["action"]
            baseline["typical_actions"][action] = baseline["typical_actions"].get(action, 0) + 1
        if "amount" in behavior:
            baseline["typical_amounts"].append(behavior["amount"])
            # Keep last 100 amounts
            baseline["typical_amounts"] = baseline["typical_amounts"][-100:]
            
    def calculate_anomaly_score(self, user_id: str, current_behavior: dict) -> float:
        """Calculate anomaly score for current behavior"""
        baseline = self.behavior_baselines.get(user_id)
        if not baseline:
            return 0.5  # No baseline, moderate risk
            
        anomaly_score = 0.0
        factors = 0
        
        # Time anomaly
        if "hour" in current_behavior:
            hour = current_behavior["hour"]
            if hour not in baseline["typical_hours"]:
                anomaly_score += 0.3
            factors += 1
            
        # Location anomaly
        if "location" in current_behavior:
            location = current_behavior["location"]
            if location not in baseline["typical_locations"]:
                anomaly_score += 0.4
            factors += 1
            
        # Action frequency anomaly
        if "action" in current_behavior:
            action = current_behavior["action"]
            if action not in baseline["typical_actions"]:
                anomaly_score += 0.2
            factors += 1
            
        # Amount anomaly
        if "amount" in current_behavior and baseline["typical_amounts"]:
            amount = current_behavior["amount"]
            avg_amount = sum(baseline["typical_amounts"]) / len(baseline["typical_amounts"])
            if amount > avg_amount * 3:  # 3x average is suspicious
                anomaly_score += 0.5
            factors += 1
            
        return anomaly_score / max(factors, 1)
        
    def should_challenge(self, user_id: str, behavior: dict) -> bool:
        """Determine if user should be challenged"""
        anomaly_score = self.calculate_anomaly_score(user_id, behavior)
        return anomaly_score >= self.anomaly_threshold


class LeastPrivilegeManager:
    """Least privilege access management"""
    
    def __init__(self):
        self.role_permissions: dict[str, set[str]] = {}
        self.user_roles: dict[str, set[str]] = {}
        self.temporary_grants: dict[str, dict] = {}
        
    def define_role(self, role: str, permissions: list[str]) -> None:
        """Define a role with permissions"""
        self.role_permissions[role] = set(permissions)
        
    def assign_role(self, user_id: str, role: str) -> None:
        """Assign a role to a user"""
        if user_id not in self.user_roles:
            self.user_roles[user_id] = set()
        self.user_roles[user_id].add(role)
        
    def revoke_role(self, user_id: str, role: str) -> None:
        """Revoke a role from a user"""
        if user_id in self.user_roles:
            self.user_roles[user_id].discard(role)
            
    def grant_temporary_permission(
        self,
        user_id: str,
        permission: str,
        duration_minutes: int,
        reason: str
    ) -> str:
        """Grant temporary elevated permission"""
        grant_id = str(uuid.uuid4())
        expiry = datetime.utcnow() + timedelta(minutes=duration_minutes)
        
        if user_id not in self.temporary_grants:
            self.temporary_grants[user_id] = {}
            
        self.temporary_grants[user_id][grant_id] = {
            "permission": permission,
            "expiry": expiry,
            "reason": reason,
            "granted_at": datetime.utcnow()
        }
        
        return grant_id
        
    def has_permission(self, user_id: str, permission: str) -> bool:
        """Check if user has a permission"""
        # Check role-based permissions
        user_roles = self.user_roles.get(user_id, set())
        for role in user_roles:
            role_perms = self.role_permissions.get(role, set())
            if permission in role_perms:
                return True
                
        # Check temporary grants
        grants = self.temporary_grants.get(user_id, {})
        now = datetime.utcnow()
        for grant_id, grant in list(grants.items()):
            if grant["expiry"] < now:
                del grants[grant_id]  # Clean up expired
                continue
            if grant["permission"] == permission:
                return True
                
        return False
        
    def get_effective_permissions(self, user_id: str) -> set[str]:
        """Get all effective permissions for a user"""
        permissions = set()
        
        # Role-based permissions
        user_roles = self.user_roles.get(user_id, set())
        for role in user_roles:
            permissions.update(self.role_permissions.get(role, set()))
            
        # Temporary grants
        grants = self.temporary_grants.get(user_id, {})
        now = datetime.utcnow()
        for grant in grants.values():
            if grant["expiry"] >= now:
                permissions.add(grant["permission"])
                
        return permissions


class ZeroTrustEngine:
    """Main Zero Trust enforcement engine"""
    
    def __init__(self, jwt_secret: str):
        self.device_scorer = DeviceTrustScorer()
        self.identity_verifier = IdentityVerifier(jwt_secret)
        self.micro_segmentation = MicroSegmentation()
        self.continuous_validator = ContinuousValidator(self.device_scorer)
        self.privilege_manager = LeastPrivilegeManager()
        self.policies: dict[str, ZeroTrustPolicy] = {}
        
    def register_policy(self, policy: ZeroTrustPolicy) -> None:
        """Register a Zero Trust policy"""
        self.policies[policy.policy_id] = policy
        
    def evaluate_access(
        self,
        user_id: str,
        resource: str,
        action: str,
        session: SessionContext,
        context: dict[str, Any]
    ) -> tuple[AccessDecision, str]:
        """Evaluate access request against Zero Trust policies"""
        
        # Find applicable policy
        policy = self._find_policy(resource)
        if not policy:
            return AccessDecision.DENY, "No policy found for resource"
            
        # Check trust level
        if self._trust_level_value(session.trust_level) < self._trust_level_value(policy.required_trust_level):
            return AccessDecision.STEP_UP, f"Insufficient trust level. Required: {policy.required_trust_level}"
            
        # Check MFA requirement
        if policy.require_mfa and not session.mfa_verified:
            return AccessDecision.CHALLENGE, "MFA verification required"
            
        # Check biometric requirement
        if policy.require_biometric and not session.biometric_verified:
            return AccessDecision.CHALLENGE, "Biometric verification required"
            
        # Check session age
        session_age = (datetime.utcnow() - session.created_at).total_seconds() / 60
        if session_age > policy.max_session_age_minutes:
            return AccessDecision.STEP_UP, "Session expired, re-authentication required"
            
        # Check risk score
        if session.risk_score > policy.max_risk_score:
            return AccessDecision.DENY, f"Risk score too high: {session.risk_score}"
            
        # Check device type
        if policy.allowed_device_types and session.device.device_type not in policy.allowed_device_types:
            return AccessDecision.DENY, f"Device type not allowed: {session.device.device_type}"
            
        # Check geo-location
        if session.device.geo_location:
            if policy.denied_geo_locations and session.device.geo_location in policy.denied_geo_locations:
                return AccessDecision.DENY, f"Access denied from location: {session.device.geo_location}"
            if policy.allowed_geo_locations and session.device.geo_location not in policy.allowed_geo_locations:
                return AccessDecision.DENY, f"Location not in allowed list: {session.device.geo_location}"
                
        # Check permission
        permission = f"{resource}:{action}"
        if not self.privilege_manager.has_permission(user_id, permission):
            return AccessDecision.DENY, f"Permission denied: {permission}"
            
        # Continuous validation - check for anomalies
        behavior = {
            "hour": datetime.utcnow().hour,
            "location": session.device.geo_location,
            "action": action,
            **context
        }
        if self.continuous_validator.should_challenge(user_id, behavior):
            return AccessDecision.CHALLENGE, "Unusual behavior detected"
            
        # Update baseline with this access
        self.continuous_validator.update_baseline(user_id, behavior)
        
        return AccessDecision.ALLOW, "Access granted"
        
    def _find_policy(self, resource: str) -> Optional[ZeroTrustPolicy]:
        """Find applicable policy for resource"""
        for policy in self.policies.values():
            if resource.startswith(policy.resource_pattern) or policy.resource_pattern == "*":
                return policy
        return None
        
    def _trust_level_value(self, level: TrustLevel) -> int:
        """Convert trust level to numeric value"""
        values = {
            TrustLevel.UNTRUSTED: 0,
            TrustLevel.LOW: 1,
            TrustLevel.MEDIUM: 2,
            TrustLevel.HIGH: 3,
            TrustLevel.VERIFIED: 4
        }
        return values.get(level, 0)


# Default policies for PayGate
DEFAULT_PAYGATE_POLICIES = [
    ZeroTrustPolicy(
        name="payment_initiation",
        description="Policy for initiating payments",
        resource_pattern="/api/payments",
        required_trust_level=TrustLevel.HIGH,
        require_mfa=True,
        max_session_age_minutes=30,
        max_risk_score=0.5,
        audit_all_access=True
    ),
    ZeroTrustPolicy(
        name="high_value_transfer",
        description="Policy for high-value transfers (>$10,000)",
        resource_pattern="/api/transfers/high-value",
        required_trust_level=TrustLevel.VERIFIED,
        require_mfa=True,
        require_biometric=True,
        max_session_age_minutes=15,
        max_risk_score=0.3,
        audit_all_access=True
    ),
    ZeroTrustPolicy(
        name="account_settings",
        description="Policy for account settings changes",
        resource_pattern="/api/account/settings",
        required_trust_level=TrustLevel.HIGH,
        require_mfa=True,
        max_session_age_minutes=30,
        audit_all_access=True
    ),
    ZeroTrustPolicy(
        name="read_only_access",
        description="Policy for read-only operations",
        resource_pattern="/api/read",
        required_trust_level=TrustLevel.MEDIUM,
        max_session_age_minutes=60,
        max_risk_score=0.7,
        audit_all_access=False
    ),
    ZeroTrustPolicy(
        name="service_to_service",
        description="Policy for internal service communication",
        resource_pattern="/internal",
        required_trust_level=TrustLevel.VERIFIED,
        allowed_device_types=[DeviceType.SERVICE],
        max_session_age_minutes=5,
        max_risk_score=0.1,
        audit_all_access=True
    )
]
