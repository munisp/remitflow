"""
ISO 27001 Compliance Implementation for PayGate

Implements:
1. Information Security Management System (ISMS)
2. Risk Assessment Framework
3. Audit Logging
4. Incident Response
5. Access Control Policies
"""

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field


class RiskLevel(str, Enum):
    """Risk levels for ISO 27001 risk assessment"""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    NEGLIGIBLE = "negligible"


class IncidentSeverity(str, Enum):
    """Incident severity levels"""
    CRITICAL = "critical"  # P1 - Immediate response
    HIGH = "high"          # P2 - Response within 1 hour
    MEDIUM = "medium"      # P3 - Response within 4 hours
    LOW = "low"            # P4 - Response within 24 hours
    INFO = "info"          # Informational only


class IncidentStatus(str, Enum):
    """Incident lifecycle status"""
    DETECTED = "detected"
    TRIAGED = "triaged"
    INVESTIGATING = "investigating"
    CONTAINED = "contained"
    ERADICATED = "eradicated"
    RECOVERED = "recovered"
    CLOSED = "closed"


class ControlCategory(str, Enum):
    """ISO 27001 Annex A control categories"""
    A5_POLICIES = "A.5"           # Information security policies
    A6_ORGANIZATION = "A.6"       # Organization of information security
    A7_HR_SECURITY = "A.7"        # Human resource security
    A8_ASSET_MGMT = "A.8"         # Asset management
    A9_ACCESS_CONTROL = "A.9"     # Access control
    A10_CRYPTOGRAPHY = "A.10"     # Cryptography
    A11_PHYSICAL = "A.11"         # Physical and environmental security
    A12_OPERATIONS = "A.12"       # Operations security
    A13_COMMUNICATIONS = "A.13"   # Communications security
    A14_ACQUISITION = "A.14"      # System acquisition, development, maintenance
    A15_SUPPLIER = "A.15"         # Supplier relationships
    A16_INCIDENT = "A.16"         # Information security incident management
    A17_CONTINUITY = "A.17"       # Business continuity
    A18_COMPLIANCE = "A.18"       # Compliance


class AuditEventType(str, Enum):
    """Types of audit events"""
    AUTHENTICATION = "authentication"
    AUTHORIZATION = "authorization"
    DATA_ACCESS = "data_access"
    DATA_MODIFICATION = "data_modification"
    DATA_DELETION = "data_deletion"
    CONFIGURATION_CHANGE = "configuration_change"
    SECURITY_EVENT = "security_event"
    SYSTEM_EVENT = "system_event"
    COMPLIANCE_EVENT = "compliance_event"
    INCIDENT_EVENT = "incident_event"


@dataclass
class AuditLogEntry:
    """Audit log entry for ISO 27001 compliance"""
    log_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=datetime.utcnow)
    event_type: AuditEventType = AuditEventType.SYSTEM_EVENT
    actor_id: str = ""
    actor_type: str = "user"  # user, service, system
    action: str = ""
    resource: str = ""
    resource_id: str = ""
    outcome: str = "success"  # success, failure, error
    ip_address: str = ""
    user_agent: str = ""
    session_id: str = ""
    details: dict = field(default_factory=dict)
    risk_level: RiskLevel = RiskLevel.LOW
    control_reference: str = ""  # ISO 27001 control reference
    hash: str = ""  # Integrity hash
    
    def __post_init__(self):
        if not self.hash:
            self.hash = self._calculate_hash()
            
    def _calculate_hash(self) -> str:
        """Calculate integrity hash for the log entry"""
        data = f"{self.log_id}{self.timestamp}{self.event_type}{self.actor_id}{self.action}{self.resource}"
        return hashlib.sha256(data.encode()).hexdigest()
        
    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return {
            "log_id": self.log_id,
            "timestamp": self.timestamp.isoformat(),
            "event_type": self.event_type.value,
            "actor_id": self.actor_id,
            "actor_type": self.actor_type,
            "action": self.action,
            "resource": self.resource,
            "resource_id": self.resource_id,
            "outcome": self.outcome,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "session_id": self.session_id,
            "details": self.details,
            "risk_level": self.risk_level.value,
            "control_reference": self.control_reference,
            "hash": self.hash
        }


@dataclass
class SecurityIncident:
    """Security incident for incident response"""
    incident_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    title: str = ""
    description: str = ""
    severity: IncidentSeverity = IncidentSeverity.MEDIUM
    status: IncidentStatus = IncidentStatus.DETECTED
    detected_at: datetime = field(default_factory=datetime.utcnow)
    reported_by: str = ""
    assigned_to: str = ""
    affected_systems: list = field(default_factory=list)
    affected_users: list = field(default_factory=list)
    attack_vector: str = ""
    indicators_of_compromise: list = field(default_factory=list)
    containment_actions: list = field(default_factory=list)
    eradication_actions: list = field(default_factory=list)
    recovery_actions: list = field(default_factory=list)
    lessons_learned: str = ""
    timeline: list = field(default_factory=list)
    related_incidents: list = field(default_factory=list)
    control_failures: list = field(default_factory=list)
    closed_at: Optional[datetime] = None


@dataclass
class RiskAssessment:
    """Risk assessment entry"""
    assessment_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    asset: str = ""
    threat: str = ""
    vulnerability: str = ""
    likelihood: int = 1  # 1-5
    impact: int = 1      # 1-5
    risk_level: RiskLevel = RiskLevel.LOW
    existing_controls: list = field(default_factory=list)
    recommended_controls: list = field(default_factory=list)
    risk_owner: str = ""
    treatment_plan: str = ""
    residual_risk: RiskLevel = RiskLevel.LOW
    review_date: Optional[datetime] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    
    def calculate_risk_score(self) -> int:
        """Calculate risk score (1-25)"""
        return self.likelihood * self.impact
        
    def determine_risk_level(self) -> RiskLevel:
        """Determine risk level from score"""
        score = self.calculate_risk_score()
        if score >= 20:
            return RiskLevel.CRITICAL
        elif score >= 15:
            return RiskLevel.HIGH
        elif score >= 10:
            return RiskLevel.MEDIUM
        elif score >= 5:
            return RiskLevel.LOW
        else:
            return RiskLevel.NEGLIGIBLE


class ISMSControl(BaseModel):
    """ISO 27001 ISMS Control"""
    control_id: str
    category: ControlCategory
    name: str
    description: str
    implementation_status: str = "not_implemented"  # not_implemented, partial, implemented
    implementation_evidence: str = ""
    responsible_party: str = ""
    review_frequency: str = "annual"
    last_review: Optional[datetime] = None
    next_review: Optional[datetime] = None
    effectiveness: str = "not_assessed"  # not_assessed, effective, partially_effective, ineffective
    notes: str = ""


class AuditLogger:
    """ISO 27001 compliant audit logging"""
    
    def __init__(self, retention_days: int = 365):
        self.logs: list[AuditLogEntry] = []
        self.retention_days = retention_days
        self.log_handlers: list[Callable[[AuditLogEntry], None]] = []
        
    def add_handler(self, handler: Callable[[AuditLogEntry], None]) -> None:
        """Add a log handler (e.g., for external storage)"""
        self.log_handlers.append(handler)
        
    def log(
        self,
        event_type: AuditEventType,
        actor_id: str,
        action: str,
        resource: str,
        resource_id: str = "",
        outcome: str = "success",
        details: Optional[dict] = None,
        ip_address: str = "",
        user_agent: str = "",
        session_id: str = "",
        risk_level: RiskLevel = RiskLevel.LOW,
        control_reference: str = ""
    ) -> AuditLogEntry:
        """Create an audit log entry"""
        entry = AuditLogEntry(
            event_type=event_type,
            actor_id=actor_id,
            action=action,
            resource=resource,
            resource_id=resource_id,
            outcome=outcome,
            details=details or {},
            ip_address=ip_address,
            user_agent=user_agent,
            session_id=session_id,
            risk_level=risk_level,
            control_reference=control_reference
        )
        
        self.logs.append(entry)
        
        # Call handlers
        for handler in self.log_handlers:
            try:
                handler(entry)
            except Exception:
                pass  # Don't fail on handler errors
                
        # Cleanup old logs
        self._cleanup_old_logs()
        
        return entry
        
    def log_authentication(
        self,
        user_id: str,
        success: bool,
        method: str,
        ip_address: str,
        user_agent: str,
        details: Optional[dict] = None
    ) -> AuditLogEntry:
        """Log authentication event"""
        return self.log(
            event_type=AuditEventType.AUTHENTICATION,
            actor_id=user_id,
            action=f"login_{method}",
            resource="authentication",
            outcome="success" if success else "failure",
            details=details or {},
            ip_address=ip_address,
            user_agent=user_agent,
            risk_level=RiskLevel.LOW if success else RiskLevel.MEDIUM,
            control_reference="A.9.4.2"
        )
        
    def log_authorization(
        self,
        user_id: str,
        resource: str,
        action: str,
        granted: bool,
        ip_address: str = "",
        session_id: str = ""
    ) -> AuditLogEntry:
        """Log authorization event"""
        return self.log(
            event_type=AuditEventType.AUTHORIZATION,
            actor_id=user_id,
            action=action,
            resource=resource,
            outcome="success" if granted else "failure",
            ip_address=ip_address,
            session_id=session_id,
            risk_level=RiskLevel.LOW if granted else RiskLevel.MEDIUM,
            control_reference="A.9.4.1"
        )
        
    def log_data_access(
        self,
        user_id: str,
        resource: str,
        resource_id: str,
        access_type: str,
        ip_address: str = "",
        session_id: str = ""
    ) -> AuditLogEntry:
        """Log data access event"""
        return self.log(
            event_type=AuditEventType.DATA_ACCESS,
            actor_id=user_id,
            action=access_type,
            resource=resource,
            resource_id=resource_id,
            ip_address=ip_address,
            session_id=session_id,
            control_reference="A.9.4.1"
        )
        
    def log_security_event(
        self,
        event_name: str,
        severity: RiskLevel,
        details: dict,
        actor_id: str = "system"
    ) -> AuditLogEntry:
        """Log security event"""
        return self.log(
            event_type=AuditEventType.SECURITY_EVENT,
            actor_id=actor_id,
            action=event_name,
            resource="security",
            details=details,
            risk_level=severity,
            control_reference="A.16.1.2"
        )
        
    def _cleanup_old_logs(self) -> None:
        """Remove logs older than retention period"""
        cutoff = datetime.utcnow() - timedelta(days=self.retention_days)
        self.logs = [log for log in self.logs if log.timestamp > cutoff]
        
    def search_logs(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        event_type: Optional[AuditEventType] = None,
        actor_id: Optional[str] = None,
        resource: Optional[str] = None,
        outcome: Optional[str] = None,
        risk_level: Optional[RiskLevel] = None
    ) -> list[AuditLogEntry]:
        """Search audit logs"""
        results = self.logs
        
        if start_time:
            results = [log for log in results if log.timestamp >= start_time]
        if end_time:
            results = [log for log in results if log.timestamp <= end_time]
        if event_type:
            results = [log for log in results if log.event_type == event_type]
        if actor_id:
            results = [log for log in results if log.actor_id == actor_id]
        if resource:
            results = [log for log in results if log.resource == resource]
        if outcome:
            results = [log for log in results if log.outcome == outcome]
        if risk_level:
            results = [log for log in results if log.risk_level == risk_level]
            
        return results
        
    def verify_log_integrity(self, log_entry: AuditLogEntry) -> bool:
        """Verify integrity of a log entry"""
        expected_hash = log_entry._calculate_hash()
        return log_entry.hash == expected_hash


class IncidentResponseManager:
    """ISO 27001 A.16 Incident Response Management"""
    
    def __init__(self, audit_logger: AuditLogger):
        self.incidents: dict[str, SecurityIncident] = {}
        self.audit_logger = audit_logger
        self.escalation_contacts: dict[IncidentSeverity, list[str]] = {}
        self.playbooks: dict[str, dict] = {}
        
    def register_escalation_contact(self, severity: IncidentSeverity, contact: str) -> None:
        """Register escalation contact for severity level"""
        if severity not in self.escalation_contacts:
            self.escalation_contacts[severity] = []
        self.escalation_contacts[severity].append(contact)
        
    def register_playbook(self, incident_type: str, playbook: dict) -> None:
        """Register incident response playbook"""
        self.playbooks[incident_type] = playbook
        
    def create_incident(
        self,
        title: str,
        description: str,
        severity: IncidentSeverity,
        reported_by: str,
        affected_systems: Optional[list] = None,
        attack_vector: str = ""
    ) -> SecurityIncident:
        """Create a new security incident"""
        incident = SecurityIncident(
            title=title,
            description=description,
            severity=severity,
            reported_by=reported_by,
            affected_systems=affected_systems or [],
            attack_vector=attack_vector
        )
        
        incident.timeline.append({
            "timestamp": datetime.utcnow().isoformat(),
            "action": "incident_created",
            "actor": reported_by,
            "details": f"Incident created with severity {severity.value}"
        })
        
        self.incidents[incident.incident_id] = incident
        
        # Log the incident
        self.audit_logger.log_security_event(
            event_name="incident_created",
            severity=self._severity_to_risk(severity),
            details={
                "incident_id": incident.incident_id,
                "title": title,
                "severity": severity.value
            },
            actor_id=reported_by
        )
        
        # Trigger escalation
        self._escalate(incident)
        
        return incident
        
    def update_status(
        self,
        incident_id: str,
        new_status: IncidentStatus,
        actor: str,
        notes: str = ""
    ) -> Optional[SecurityIncident]:
        """Update incident status"""
        incident = self.incidents.get(incident_id)
        if not incident:
            return None
            
        old_status = incident.status
        incident.status = new_status
        
        incident.timeline.append({
            "timestamp": datetime.utcnow().isoformat(),
            "action": "status_changed",
            "actor": actor,
            "details": f"Status changed from {old_status.value} to {new_status.value}. {notes}"
        })
        
        if new_status == IncidentStatus.CLOSED:
            incident.closed_at = datetime.utcnow()
            
        # Log status change
        self.audit_logger.log_security_event(
            event_name="incident_status_changed",
            severity=self._severity_to_risk(incident.severity),
            details={
                "incident_id": incident_id,
                "old_status": old_status.value,
                "new_status": new_status.value,
                "notes": notes
            },
            actor_id=actor
        )
        
        return incident
        
    def add_containment_action(
        self,
        incident_id: str,
        action: str,
        actor: str
    ) -> Optional[SecurityIncident]:
        """Add containment action to incident"""
        incident = self.incidents.get(incident_id)
        if not incident:
            return None
            
        incident.containment_actions.append({
            "action": action,
            "actor": actor,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        incident.timeline.append({
            "timestamp": datetime.utcnow().isoformat(),
            "action": "containment_action_added",
            "actor": actor,
            "details": action
        })
        
        return incident
        
    def get_active_incidents(self) -> list[SecurityIncident]:
        """Get all active (non-closed) incidents"""
        return [
            incident for incident in self.incidents.values()
            if incident.status != IncidentStatus.CLOSED
        ]
        
    def get_incidents_by_severity(self, severity: IncidentSeverity) -> list[SecurityIncident]:
        """Get incidents by severity"""
        return [
            incident for incident in self.incidents.values()
            if incident.severity == severity
        ]
        
    def _escalate(self, incident: SecurityIncident) -> None:
        """Escalate incident to appropriate contacts"""
        contacts = self.escalation_contacts.get(incident.severity, [])
        for contact in contacts:
            # In production, this would send notifications
            incident.timeline.append({
                "timestamp": datetime.utcnow().isoformat(),
                "action": "escalation_sent",
                "actor": "system",
                "details": f"Escalation sent to {contact}"
            })
            
    def _severity_to_risk(self, severity: IncidentSeverity) -> RiskLevel:
        """Convert incident severity to risk level"""
        mapping = {
            IncidentSeverity.CRITICAL: RiskLevel.CRITICAL,
            IncidentSeverity.HIGH: RiskLevel.HIGH,
            IncidentSeverity.MEDIUM: RiskLevel.MEDIUM,
            IncidentSeverity.LOW: RiskLevel.LOW,
            IncidentSeverity.INFO: RiskLevel.NEGLIGIBLE
        }
        return mapping.get(severity, RiskLevel.MEDIUM)


class RiskAssessmentFramework:
    """ISO 27001 Risk Assessment Framework"""
    
    def __init__(self):
        self.assessments: dict[str, RiskAssessment] = {}
        self.risk_register: list[RiskAssessment] = []
        self.risk_appetite: RiskLevel = RiskLevel.MEDIUM
        
    def set_risk_appetite(self, level: RiskLevel) -> None:
        """Set organizational risk appetite"""
        self.risk_appetite = level
        
    def create_assessment(
        self,
        asset: str,
        threat: str,
        vulnerability: str,
        likelihood: int,
        impact: int,
        risk_owner: str,
        existing_controls: Optional[list] = None
    ) -> RiskAssessment:
        """Create a new risk assessment"""
        assessment = RiskAssessment(
            asset=asset,
            threat=threat,
            vulnerability=vulnerability,
            likelihood=likelihood,
            impact=impact,
            risk_owner=risk_owner,
            existing_controls=existing_controls or []
        )
        
        assessment.risk_level = assessment.determine_risk_level()
        
        self.assessments[assessment.assessment_id] = assessment
        self.risk_register.append(assessment)
        
        return assessment
        
    def update_assessment(
        self,
        assessment_id: str,
        likelihood: Optional[int] = None,
        impact: Optional[int] = None,
        treatment_plan: Optional[str] = None,
        recommended_controls: Optional[list] = None
    ) -> Optional[RiskAssessment]:
        """Update an existing risk assessment"""
        assessment = self.assessments.get(assessment_id)
        if not assessment:
            return None
            
        if likelihood is not None:
            assessment.likelihood = likelihood
        if impact is not None:
            assessment.impact = impact
        if treatment_plan is not None:
            assessment.treatment_plan = treatment_plan
        if recommended_controls is not None:
            assessment.recommended_controls = recommended_controls
            
        assessment.risk_level = assessment.determine_risk_level()
        
        return assessment
        
    def get_risks_above_appetite(self) -> list[RiskAssessment]:
        """Get risks above organizational risk appetite"""
        appetite_value = self._risk_level_value(self.risk_appetite)
        return [
            assessment for assessment in self.risk_register
            if self._risk_level_value(assessment.risk_level) > appetite_value
        ]
        
    def get_risk_summary(self) -> dict:
        """Get summary of risk register"""
        summary = {
            "total_risks": len(self.risk_register),
            "by_level": {
                RiskLevel.CRITICAL.value: 0,
                RiskLevel.HIGH.value: 0,
                RiskLevel.MEDIUM.value: 0,
                RiskLevel.LOW.value: 0,
                RiskLevel.NEGLIGIBLE.value: 0
            },
            "above_appetite": 0,
            "risk_appetite": self.risk_appetite.value
        }
        
        for assessment in self.risk_register:
            summary["by_level"][assessment.risk_level.value] += 1
            
        summary["above_appetite"] = len(self.get_risks_above_appetite())
        
        return summary
        
    def _risk_level_value(self, level: RiskLevel) -> int:
        """Convert risk level to numeric value"""
        values = {
            RiskLevel.NEGLIGIBLE: 0,
            RiskLevel.LOW: 1,
            RiskLevel.MEDIUM: 2,
            RiskLevel.HIGH: 3,
            RiskLevel.CRITICAL: 4
        }
        return values.get(level, 0)


class AccessControlPolicy:
    """ISO 27001 A.9 Access Control Policy"""
    
    def __init__(self):
        self.policies: dict[str, dict] = {}
        self.user_access_rights: dict[str, set[str]] = {}
        self.access_reviews: list[dict] = []
        
    def define_policy(
        self,
        policy_id: str,
        name: str,
        description: str,
        rules: list[dict]
    ) -> None:
        """Define an access control policy"""
        self.policies[policy_id] = {
            "policy_id": policy_id,
            "name": name,
            "description": description,
            "rules": rules,
            "created_at": datetime.utcnow().isoformat(),
            "version": 1
        }
        
    def grant_access(self, user_id: str, access_right: str) -> None:
        """Grant access right to user"""
        if user_id not in self.user_access_rights:
            self.user_access_rights[user_id] = set()
        self.user_access_rights[user_id].add(access_right)
        
    def revoke_access(self, user_id: str, access_right: str) -> None:
        """Revoke access right from user"""
        if user_id in self.user_access_rights:
            self.user_access_rights[user_id].discard(access_right)
            
    def check_access(self, user_id: str, access_right: str) -> bool:
        """Check if user has access right"""
        return access_right in self.user_access_rights.get(user_id, set())
        
    def schedule_access_review(
        self,
        review_date: datetime,
        reviewer: str,
        scope: str
    ) -> str:
        """Schedule an access review"""
        review_id = str(uuid.uuid4())
        self.access_reviews.append({
            "review_id": review_id,
            "review_date": review_date.isoformat(),
            "reviewer": reviewer,
            "scope": scope,
            "status": "scheduled",
            "findings": []
        })
        return review_id
        
    def complete_access_review(
        self,
        review_id: str,
        findings: list[dict],
        reviewer: str
    ) -> Optional[dict]:
        """Complete an access review"""
        for review in self.access_reviews:
            if review["review_id"] == review_id:
                review["status"] = "completed"
                review["findings"] = findings
                review["completed_by"] = reviewer
                review["completed_at"] = datetime.utcnow().isoformat()
                return review
        return None


class ISMSManager:
    """Information Security Management System Manager"""
    
    def __init__(self):
        self.controls: dict[str, ISMSControl] = {}
        self.audit_logger = AuditLogger()
        self.incident_manager = IncidentResponseManager(self.audit_logger)
        self.risk_framework = RiskAssessmentFramework()
        self.access_policy = AccessControlPolicy()
        self._initialize_controls()
        
    def _initialize_controls(self) -> None:
        """Initialize ISO 27001 Annex A controls"""
        default_controls = [
            ISMSControl(
                control_id="A.5.1.1",
                category=ControlCategory.A5_POLICIES,
                name="Policies for information security",
                description="A set of policies for information security shall be defined, approved by management, published and communicated to employees and relevant external parties."
            ),
            ISMSControl(
                control_id="A.9.1.1",
                category=ControlCategory.A9_ACCESS_CONTROL,
                name="Access control policy",
                description="An access control policy shall be established, documented and reviewed based on business and information security requirements."
            ),
            ISMSControl(
                control_id="A.9.2.1",
                category=ControlCategory.A9_ACCESS_CONTROL,
                name="User registration and de-registration",
                description="A formal user registration and de-registration process shall be implemented to enable assignment of access rights."
            ),
            ISMSControl(
                control_id="A.9.4.1",
                category=ControlCategory.A9_ACCESS_CONTROL,
                name="Information access restriction",
                description="Access to information and application system functions shall be restricted in accordance with the access control policy."
            ),
            ISMSControl(
                control_id="A.9.4.2",
                category=ControlCategory.A9_ACCESS_CONTROL,
                name="Secure log-on procedures",
                description="Where required by the access control policy, access to systems and applications shall be controlled by a secure log-on procedure."
            ),
            ISMSControl(
                control_id="A.10.1.1",
                category=ControlCategory.A10_CRYPTOGRAPHY,
                name="Policy on the use of cryptographic controls",
                description="A policy on the use of cryptographic controls for protection of information shall be developed and implemented."
            ),
            ISMSControl(
                control_id="A.10.1.2",
                category=ControlCategory.A10_CRYPTOGRAPHY,
                name="Key management",
                description="A policy on the use, protection and lifetime of cryptographic keys shall be developed and implemented through their whole lifecycle."
            ),
            ISMSControl(
                control_id="A.12.4.1",
                category=ControlCategory.A12_OPERATIONS,
                name="Event logging",
                description="Event logs recording user activities, exceptions, faults and information security events shall be produced, kept and regularly reviewed."
            ),
            ISMSControl(
                control_id="A.12.4.2",
                category=ControlCategory.A12_OPERATIONS,
                name="Protection of log information",
                description="Logging facilities and log information shall be protected against tampering and unauthorized access."
            ),
            ISMSControl(
                control_id="A.16.1.1",
                category=ControlCategory.A16_INCIDENT,
                name="Responsibilities and procedures",
                description="Management responsibilities and procedures shall be established to ensure a quick, effective and orderly response to information security incidents."
            ),
            ISMSControl(
                control_id="A.16.1.2",
                category=ControlCategory.A16_INCIDENT,
                name="Reporting information security events",
                description="Information security events shall be reported through appropriate management channels as quickly as possible."
            ),
            ISMSControl(
                control_id="A.18.1.1",
                category=ControlCategory.A18_COMPLIANCE,
                name="Identification of applicable legislation",
                description="All relevant legislative statutory, regulatory, contractual requirements and the organization's approach to meet these requirements shall be explicitly identified, documented and kept up to date."
            ),
            ISMSControl(
                control_id="A.18.2.1",
                category=ControlCategory.A18_COMPLIANCE,
                name="Independent review of information security",
                description="The organization's approach to managing information security and its implementation shall be reviewed independently at planned intervals or when significant changes occur."
            )
        ]
        
        for control in default_controls:
            self.controls[control.control_id] = control
            
    def update_control_status(
        self,
        control_id: str,
        status: str,
        evidence: str = "",
        responsible_party: str = ""
    ) -> Optional[ISMSControl]:
        """Update control implementation status"""
        control = self.controls.get(control_id)
        if not control:
            return None
            
        control.implementation_status = status
        control.implementation_evidence = evidence
        control.responsible_party = responsible_party
        control.last_review = datetime.utcnow()
        
        return control
        
    def get_compliance_summary(self) -> dict:
        """Get ISMS compliance summary"""
        summary = {
            "total_controls": len(self.controls),
            "implemented": 0,
            "partial": 0,
            "not_implemented": 0,
            "by_category": {}
        }
        
        for control in self.controls.values():
            if control.implementation_status == "implemented":
                summary["implemented"] += 1
            elif control.implementation_status == "partial":
                summary["partial"] += 1
            else:
                summary["not_implemented"] += 1
                
            category = control.category.value
            if category not in summary["by_category"]:
                summary["by_category"][category] = {
                    "total": 0,
                    "implemented": 0
                }
            summary["by_category"][category]["total"] += 1
            if control.implementation_status == "implemented":
                summary["by_category"][category]["implemented"] += 1
                
        summary["compliance_percentage"] = (
            summary["implemented"] / summary["total_controls"] * 100
            if summary["total_controls"] > 0 else 0
        )
        
        return summary


# Create default ISMS instance for PayGate
paygate_isms = ISMSManager()
