"""
OpenLane Core Integration - GRC/Compliance Automation Patterns
Integrates with OpenLane Core for compliance program management, evidence collection,
and controls mapping without replacing existing runtime security modules.

This module provides:
1. Controls mapping to ISO27001, SOC2, NIST 800-53
2. Evidence collection and submission
3. Compliance task automation
4. Audit trail integration
"""

import os
import json
import logging
import hashlib
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from enum import Enum
import httpx

logger = logging.getLogger(__name__)


# =============================================================================
# CONFIGURATION
# =============================================================================

class OpenLaneConfig:
    """Configuration for OpenLane integration"""
    
    # OpenLane Core API settings
    API_URL = os.getenv("OPENLANE_API_URL", "http://openlane-core:17608")
    API_TOKEN = os.getenv("OPENLANE_API_TOKEN", "")
    GRAPHQL_ENDPOINT = f"{API_URL}/query"
    
    # Integration settings
    ENABLED = os.getenv("OPENLANE_ENABLED", "false").lower() == "true"
    ORGANIZATION_ID = os.getenv("OPENLANE_ORG_ID", "")
    
    # Evidence collection settings
    EVIDENCE_RETENTION_DAYS = 365
    AUTO_SUBMIT_EVIDENCE = True
    
    # Supported compliance frameworks
    FRAMEWORKS = ["ISO27001", "SOC2", "NIST800-53", "PCI-DSS", "GDPR"]


class ComplianceFramework(Enum):
    """Supported compliance frameworks"""
    ISO27001 = "iso27001"
    SOC2 = "soc2"
    NIST800_53 = "nist800-53"
    PCI_DSS = "pci-dss"
    GDPR = "gdpr"


class ControlStatus(Enum):
    """Control implementation status"""
    NOT_IMPLEMENTED = "not_implemented"
    PARTIALLY_IMPLEMENTED = "partially_implemented"
    IMPLEMENTED = "implemented"
    NOT_APPLICABLE = "not_applicable"


class EvidenceType(Enum):
    """Types of compliance evidence"""
    AUDIT_LOG = "audit_log"
    CONFIGURATION = "configuration"
    SCREENSHOT = "screenshot"
    DOCUMENT = "document"
    TEST_RESULT = "test_result"
    METRIC = "metric"
    ATTESTATION = "attestation"


# =============================================================================
# DATA MODELS
# =============================================================================

@dataclass
class Control:
    """Represents a compliance control"""
    id: str
    framework: ComplianceFramework
    control_id: str  # e.g., "A.8.1" for ISO27001
    title: str
    description: str
    status: ControlStatus = ControlStatus.NOT_IMPLEMENTED
    implementation_notes: str = ""
    owner: str = ""
    evidence_required: List[str] = field(default_factory=list)
    last_reviewed: Optional[datetime] = None
    next_review: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "framework": self.framework.value,
            "control_id": self.control_id,
            "title": self.title,
            "description": self.description,
            "status": self.status.value,
            "implementation_notes": self.implementation_notes,
            "owner": self.owner,
            "evidence_required": self.evidence_required,
            "last_reviewed": self.last_reviewed.isoformat() if self.last_reviewed else None,
            "next_review": self.next_review.isoformat() if self.next_review else None
        }


@dataclass
class Evidence:
    """Represents compliance evidence"""
    id: str
    control_id: str
    evidence_type: EvidenceType
    title: str
    description: str
    content: str  # JSON string or reference
    collected_at: datetime
    collected_by: str
    hash: str = ""  # SHA-256 hash for integrity
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        if not self.hash:
            self.hash = hashlib.sha256(self.content.encode()).hexdigest()
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "control_id": self.control_id,
            "evidence_type": self.evidence_type.value,
            "title": self.title,
            "description": self.description,
            "content": self.content,
            "collected_at": self.collected_at.isoformat(),
            "collected_by": self.collected_by,
            "hash": self.hash,
            "metadata": self.metadata
        }


@dataclass
class ComplianceTask:
    """Represents a compliance task"""
    id: str
    title: str
    description: str
    control_id: str
    assignee: str
    due_date: datetime
    status: str = "pending"
    priority: str = "medium"
    created_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "control_id": self.control_id,
            "assignee": self.assignee,
            "due_date": self.due_date.isoformat(),
            "status": self.status,
            "priority": self.priority,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None
        }


# =============================================================================
# CONTROLS MAPPING
# =============================================================================

class ControlsMapping:
    """
    Maps platform controls to compliance frameworks
    This allows tracking which platform features satisfy which compliance requirements
    """
    
    # ISO 27001 Annex A Controls mapping to platform features
    ISO27001_MAPPING = {
        "A.5.1": {
            "title": "Policies for information security",
            "platform_features": ["policy_engine", "pbac"],
            "evidence_sources": ["policy_documents", "access_logs"]
        },
        "A.5.2": {
            "title": "Information security roles and responsibilities",
            "platform_features": ["rbac", "pbac", "keycloak"],
            "evidence_sources": ["role_assignments", "access_reviews"]
        },
        "A.6.1": {
            "title": "Screening",
            "platform_features": ["kyc_service", "compliance_service"],
            "evidence_sources": ["kyc_records", "background_checks"]
        },
        "A.8.1": {
            "title": "User endpoint devices",
            "platform_features": ["device_trust", "zero_trust"],
            "evidence_sources": ["device_inventory", "security_configs"]
        },
        "A.8.2": {
            "title": "Privileged access rights",
            "platform_features": ["pbac", "keycloak_enforced"],
            "evidence_sources": ["privileged_access_logs", "role_reviews"]
        },
        "A.8.3": {
            "title": "Information access restriction",
            "platform_features": ["pbac", "data_classification"],
            "evidence_sources": ["access_control_lists", "permission_audits"]
        },
        "A.8.9": {
            "title": "Configuration management",
            "platform_features": ["infrastructure_configs", "gitops"],
            "evidence_sources": ["config_snapshots", "change_logs"]
        },
        "A.8.10": {
            "title": "Information deletion",
            "platform_features": ["data_retention", "gdpr_compliance"],
            "evidence_sources": ["deletion_logs", "retention_policies"]
        },
        "A.8.11": {
            "title": "Data masking",
            "platform_features": ["encryption_at_rest", "field_encryption"],
            "evidence_sources": ["encryption_configs", "masking_rules"]
        },
        "A.8.12": {
            "title": "Data leakage prevention",
            "platform_features": ["audit_service", "dlp_rules"],
            "evidence_sources": ["dlp_alerts", "data_flow_logs"]
        },
        "A.8.15": {
            "title": "Logging",
            "platform_features": ["audit_service", "lakehouse"],
            "evidence_sources": ["audit_logs", "log_retention_configs"]
        },
        "A.8.16": {
            "title": "Monitoring activities",
            "platform_features": ["monitoring_stack", "alerting"],
            "evidence_sources": ["monitoring_dashboards", "alert_history"]
        },
        "A.8.24": {
            "title": "Use of cryptography",
            "platform_features": ["encryption_at_rest", "tls_everywhere"],
            "evidence_sources": ["encryption_inventory", "certificate_logs"]
        },
        "A.8.25": {
            "title": "Secure development lifecycle",
            "platform_features": ["ci_cd", "security_scanning"],
            "evidence_sources": ["pipeline_configs", "scan_results"]
        },
        "A.8.28": {
            "title": "Secure coding",
            "platform_features": ["code_review", "sast_dast"],
            "evidence_sources": ["code_review_logs", "vulnerability_reports"]
        }
    }
    
    # SOC 2 Trust Services Criteria mapping
    SOC2_MAPPING = {
        "CC1.1": {
            "title": "COSO Principle 1: Integrity and Ethical Values",
            "platform_features": ["policy_engine", "code_of_conduct"],
            "evidence_sources": ["policy_documents", "training_records"]
        },
        "CC2.1": {
            "title": "Information and Communication",
            "platform_features": ["notification_service", "audit_service"],
            "evidence_sources": ["communication_logs", "incident_reports"]
        },
        "CC3.1": {
            "title": "Risk Assessment",
            "platform_features": ["risk_service", "ml_fraud_detection"],
            "evidence_sources": ["risk_assessments", "fraud_reports"]
        },
        "CC5.1": {
            "title": "Logical Access Controls",
            "platform_features": ["pbac", "zero_trust", "keycloak"],
            "evidence_sources": ["access_logs", "authentication_logs"]
        },
        "CC5.2": {
            "title": "New User Registration",
            "platform_features": ["kyc_service", "user_onboarding"],
            "evidence_sources": ["registration_logs", "kyc_records"]
        },
        "CC6.1": {
            "title": "Logical and Physical Access",
            "platform_features": ["zero_trust", "network_segmentation"],
            "evidence_sources": ["access_reviews", "network_configs"]
        },
        "CC6.6": {
            "title": "Encryption",
            "platform_features": ["encryption_at_rest", "tls_everywhere"],
            "evidence_sources": ["encryption_configs", "certificate_inventory"]
        },
        "CC7.1": {
            "title": "System Operations",
            "platform_features": ["monitoring_stack", "incident_response"],
            "evidence_sources": ["operations_logs", "incident_tickets"]
        },
        "CC7.2": {
            "title": "Change Management",
            "platform_features": ["ci_cd", "gitops"],
            "evidence_sources": ["change_logs", "deployment_records"]
        },
        "CC8.1": {
            "title": "Incident Management",
            "platform_features": ["dispute_service", "alerting"],
            "evidence_sources": ["incident_logs", "resolution_records"]
        }
    }
    
    @classmethod
    def get_controls_for_framework(cls, framework: ComplianceFramework) -> Dict[str, Any]:
        """Get all controls for a framework"""
        if framework == ComplianceFramework.ISO27001:
            return cls.ISO27001_MAPPING
        elif framework == ComplianceFramework.SOC2:
            return cls.SOC2_MAPPING
        else:
            return {}
    
    @classmethod
    def get_platform_features_for_control(cls, framework: ComplianceFramework, control_id: str) -> List[str]:
        """Get platform features that implement a control"""
        mapping = cls.get_controls_for_framework(framework)
        control = mapping.get(control_id, {})
        return control.get("platform_features", [])
    
    @classmethod
    def get_evidence_sources_for_control(cls, framework: ComplianceFramework, control_id: str) -> List[str]:
        """Get evidence sources for a control"""
        mapping = cls.get_controls_for_framework(framework)
        control = mapping.get(control_id, {})
        return control.get("evidence_sources", [])


# =============================================================================
# EVIDENCE COLLECTOR
# =============================================================================

class EvidenceCollector:
    """
    Collects evidence from platform services for compliance
    Integrates with audit service, lakehouse, and other data sources
    """
    
    def __init__(self):
        self._evidence_cache: Dict[str, Evidence] = {}
    
    async def collect_audit_logs(
        self,
        control_id: str,
        start_date: datetime,
        end_date: datetime,
        filters: Dict[str, Any] = None
    ) -> Evidence:
        """Collect audit logs as evidence"""
        # In production, this would query the audit service
        evidence_content = {
            "source": "audit_service",
            "period": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat()
            },
            "filters": filters or {},
            "summary": {
                "total_events": 0,
                "event_types": [],
                "anomalies": 0
            }
        }
        
        return Evidence(
            id=f"evidence_{control_id}_{datetime.utcnow().timestamp()}",
            control_id=control_id,
            evidence_type=EvidenceType.AUDIT_LOG,
            title=f"Audit Logs for {control_id}",
            description=f"Audit log evidence collected from {start_date} to {end_date}",
            content=json.dumps(evidence_content),
            collected_at=datetime.utcnow(),
            collected_by="system",
            metadata={"filters": filters}
        )
    
    async def collect_configuration_snapshot(
        self,
        control_id: str,
        config_type: str
    ) -> Evidence:
        """Collect configuration snapshot as evidence"""
        # In production, this would fetch actual configs
        evidence_content = {
            "source": "configuration_management",
            "config_type": config_type,
            "snapshot_time": datetime.utcnow().isoformat(),
            "configurations": {}
        }
        
        return Evidence(
            id=f"evidence_{control_id}_{datetime.utcnow().timestamp()}",
            control_id=control_id,
            evidence_type=EvidenceType.CONFIGURATION,
            title=f"Configuration Snapshot: {config_type}",
            description=f"Configuration snapshot for {config_type}",
            content=json.dumps(evidence_content),
            collected_at=datetime.utcnow(),
            collected_by="system",
            metadata={"config_type": config_type}
        )
    
    async def collect_test_results(
        self,
        control_id: str,
        test_type: str,
        results: Dict[str, Any]
    ) -> Evidence:
        """Collect test results as evidence"""
        evidence_content = {
            "source": "testing_framework",
            "test_type": test_type,
            "execution_time": datetime.utcnow().isoformat(),
            "results": results
        }
        
        return Evidence(
            id=f"evidence_{control_id}_{datetime.utcnow().timestamp()}",
            control_id=control_id,
            evidence_type=EvidenceType.TEST_RESULT,
            title=f"Test Results: {test_type}",
            description=f"Test results for {test_type}",
            content=json.dumps(evidence_content),
            collected_at=datetime.utcnow(),
            collected_by="system",
            metadata={"test_type": test_type}
        )
    
    async def collect_metrics(
        self,
        control_id: str,
        metric_name: str,
        start_date: datetime,
        end_date: datetime
    ) -> Evidence:
        """Collect metrics as evidence"""
        evidence_content = {
            "source": "monitoring_stack",
            "metric_name": metric_name,
            "period": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat()
            },
            "data_points": [],
            "summary": {
                "min": 0,
                "max": 0,
                "avg": 0
            }
        }
        
        return Evidence(
            id=f"evidence_{control_id}_{datetime.utcnow().timestamp()}",
            control_id=control_id,
            evidence_type=EvidenceType.METRIC,
            title=f"Metrics: {metric_name}",
            description=f"Metric data for {metric_name} from {start_date} to {end_date}",
            content=json.dumps(evidence_content),
            collected_at=datetime.utcnow(),
            collected_by="system",
            metadata={"metric_name": metric_name}
        )


# =============================================================================
# OPENLANE CLIENT
# =============================================================================

class OpenLaneClient:
    """
    Client for communicating with OpenLane Core API
    Handles evidence submission, task management, and compliance reporting
    """
    
    def __init__(self):
        self.api_url = OpenLaneConfig.API_URL
        self.api_token = OpenLaneConfig.API_TOKEN
        self.enabled = OpenLaneConfig.ENABLED
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.api_url,
                headers={
                    "Authorization": f"Bearer {self.api_token}",
                    "Content-Type": "application/json"
                },
                timeout=30.0
            )
        return self._client
    
    async def submit_evidence(self, evidence: Evidence) -> Dict[str, Any]:
        """Submit evidence to OpenLane"""
        if not self.enabled:
            logger.info(f"OpenLane disabled, evidence {evidence.id} not submitted")
            return {"status": "skipped", "reason": "OpenLane disabled"}
        
        try:
            client = await self._get_client()
            
            # GraphQL mutation for evidence submission
            mutation = """
            mutation CreateEvidence($input: CreateEvidenceInput!) {
                createEvidence(input: $input) {
                    evidence {
                        id
                        title
                        createdAt
                    }
                }
            }
            """
            
            variables = {
                "input": {
                    "title": evidence.title,
                    "description": evidence.description,
                    "evidenceType": evidence.evidence_type.value,
                    "content": evidence.content,
                    "controlID": evidence.control_id,
                    "collectedAt": evidence.collected_at.isoformat(),
                    "hash": evidence.hash
                }
            }
            
            response = await client.post(
                "/query",
                json={"query": mutation, "variables": variables}
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to submit evidence: {response.status_code}")
                return {"status": "error", "code": response.status_code}
        except Exception as e:
            logger.error(f"Error submitting evidence to OpenLane: {e}")
            return {"status": "error", "message": str(e)}
    
    async def create_task(self, task: ComplianceTask) -> Dict[str, Any]:
        """Create a compliance task in OpenLane"""
        if not self.enabled:
            logger.info(f"OpenLane disabled, task {task.id} not created")
            return {"status": "skipped", "reason": "OpenLane disabled"}
        
        try:
            client = await self._get_client()
            
            mutation = """
            mutation CreateTask($input: CreateTaskInput!) {
                createTask(input: $input) {
                    task {
                        id
                        title
                        status
                    }
                }
            }
            """
            
            variables = {
                "input": {
                    "title": task.title,
                    "description": task.description,
                    "assignee": task.assignee,
                    "dueDate": task.due_date.isoformat(),
                    "priority": task.priority,
                    "controlID": task.control_id
                }
            }
            
            response = await client.post(
                "/query",
                json={"query": mutation, "variables": variables}
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to create task: {response.status_code}")
                return {"status": "error", "code": response.status_code}
        except Exception as e:
            logger.error(f"Error creating task in OpenLane: {e}")
            return {"status": "error", "message": str(e)}
    
    async def get_compliance_status(self, framework: ComplianceFramework) -> Dict[str, Any]:
        """Get compliance status for a framework"""
        if not self.enabled:
            return {"status": "skipped", "reason": "OpenLane disabled"}
        
        try:
            client = await self._get_client()
            
            query = """
            query GetComplianceStatus($framework: String!) {
                complianceStatus(framework: $framework) {
                    framework
                    totalControls
                    implementedControls
                    partialControls
                    notImplementedControls
                    compliancePercentage
                }
            }
            """
            
            response = await client.post(
                "/query",
                json={"query": query, "variables": {"framework": framework.value}}
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                return {"status": "error", "code": response.status_code}
        except Exception as e:
            logger.error(f"Error getting compliance status: {e}")
            return {"status": "error", "message": str(e)}
    
    async def close(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None


# =============================================================================
# COMPLIANCE SERVICE
# =============================================================================

class OpenLaneComplianceService:
    """
    High-level service for compliance automation
    Coordinates evidence collection, controls mapping, and OpenLane integration
    """
    
    def __init__(self):
        self.client = OpenLaneClient()
        self.evidence_collector = EvidenceCollector()
        self.controls_mapping = ControlsMapping()
        self._initialized = False
    
    def initialize(self):
        """Initialize the compliance service"""
        if self._initialized:
            return
        
        logger.info("OpenLane compliance service initialized")
        self._initialized = True
    
    async def run_compliance_check(
        self,
        framework: ComplianceFramework,
        controls: List[str] = None
    ) -> Dict[str, Any]:
        """
        Run a compliance check for specified controls
        
        Args:
            framework: Compliance framework to check
            controls: Specific controls to check (or all if None)
        
        Returns:
            Compliance check results
        """
        if not self._initialized:
            self.initialize()
        
        mapping = self.controls_mapping.get_controls_for_framework(framework)
        controls_to_check = controls or list(mapping.keys())
        
        results = {
            "framework": framework.value,
            "checked_at": datetime.utcnow().isoformat(),
            "controls": {},
            "summary": {
                "total": len(controls_to_check),
                "implemented": 0,
                "partial": 0,
                "not_implemented": 0
            }
        }
        
        for control_id in controls_to_check:
            if control_id not in mapping:
                continue
            
            control_info = mapping[control_id]
            platform_features = control_info.get("platform_features", [])
            
            # Check if platform features are implemented
            # In production, this would actually verify feature status
            status = ControlStatus.IMPLEMENTED if platform_features else ControlStatus.NOT_IMPLEMENTED
            
            results["controls"][control_id] = {
                "title": control_info.get("title"),
                "status": status.value,
                "platform_features": platform_features,
                "evidence_sources": control_info.get("evidence_sources", [])
            }
            
            if status == ControlStatus.IMPLEMENTED:
                results["summary"]["implemented"] += 1
            elif status == ControlStatus.PARTIALLY_IMPLEMENTED:
                results["summary"]["partial"] += 1
            else:
                results["summary"]["not_implemented"] += 1
        
        return results
    
    async def collect_and_submit_evidence(
        self,
        control_id: str,
        framework: ComplianceFramework,
        evidence_type: EvidenceType,
        start_date: datetime = None,
        end_date: datetime = None
    ) -> Dict[str, Any]:
        """
        Collect evidence for a control and submit to OpenLane
        """
        if not self._initialized:
            self.initialize()
        
        start_date = start_date or (datetime.utcnow() - timedelta(days=30))
        end_date = end_date or datetime.utcnow()
        
        # Collect evidence based on type
        if evidence_type == EvidenceType.AUDIT_LOG:
            evidence = await self.evidence_collector.collect_audit_logs(
                control_id, start_date, end_date
            )
        elif evidence_type == EvidenceType.CONFIGURATION:
            evidence = await self.evidence_collector.collect_configuration_snapshot(
                control_id, "security"
            )
        elif evidence_type == EvidenceType.METRIC:
            evidence = await self.evidence_collector.collect_metrics(
                control_id, "security_metrics", start_date, end_date
            )
        else:
            return {"status": "error", "message": f"Unsupported evidence type: {evidence_type}"}
        
        # Submit to OpenLane
        result = await self.client.submit_evidence(evidence)
        
        return {
            "evidence_id": evidence.id,
            "control_id": control_id,
            "framework": framework.value,
            "evidence_type": evidence_type.value,
            "submission_result": result
        }
    
    async def create_remediation_task(
        self,
        control_id: str,
        framework: ComplianceFramework,
        assignee: str,
        due_days: int = 30
    ) -> Dict[str, Any]:
        """
        Create a remediation task for a non-compliant control
        """
        if not self._initialized:
            self.initialize()
        
        mapping = self.controls_mapping.get_controls_for_framework(framework)
        control_info = mapping.get(control_id, {})
        
        task = ComplianceTask(
            id=f"task_{control_id}_{datetime.utcnow().timestamp()}",
            title=f"Remediate {control_id}: {control_info.get('title', 'Unknown')}",
            description=f"Implement or improve control {control_id} for {framework.value} compliance",
            control_id=control_id,
            assignee=assignee,
            due_date=datetime.utcnow() + timedelta(days=due_days),
            priority="high"
        )
        
        result = await self.client.create_task(task)
        
        return {
            "task_id": task.id,
            "control_id": control_id,
            "framework": framework.value,
            "assignee": assignee,
            "due_date": task.due_date.isoformat(),
            "creation_result": result
        }
    
    async def generate_compliance_report(
        self,
        framework: ComplianceFramework
    ) -> Dict[str, Any]:
        """
        Generate a compliance report for a framework
        """
        if not self._initialized:
            self.initialize()
        
        # Run compliance check
        check_results = await self.run_compliance_check(framework)
        
        # Get status from OpenLane if available
        openlane_status = await self.client.get_compliance_status(framework)
        
        report = {
            "framework": framework.value,
            "generated_at": datetime.utcnow().isoformat(),
            "platform_assessment": check_results,
            "openlane_status": openlane_status,
            "recommendations": []
        }
        
        # Generate recommendations for non-implemented controls
        for control_id, control_data in check_results.get("controls", {}).items():
            if control_data.get("status") != ControlStatus.IMPLEMENTED.value:
                report["recommendations"].append({
                    "control_id": control_id,
                    "title": control_data.get("title"),
                    "action": "Implement missing platform features",
                    "required_features": control_data.get("platform_features", [])
                })
        
        return report
    
    async def close(self):
        """Close the service"""
        await self.client.close()


# =============================================================================
# GLOBAL INSTANCE
# =============================================================================

_compliance_service: Optional[OpenLaneComplianceService] = None


def get_compliance_service() -> OpenLaneComplianceService:
    """Get or create the global compliance service instance"""
    global _compliance_service
    if _compliance_service is None:
        _compliance_service = OpenLaneComplianceService()
    return _compliance_service


# =============================================================================
# INTEGRATION RECOMMENDATIONS
# =============================================================================

OPENLANE_INTEGRATION_GUIDE = """
# OpenLane Core Integration Guide

## Overview

OpenLane Core is a GRC (Governance, Risk, Compliance) automation platform that
complements the Nigerian Remittance Platform's existing security modules. It
provides compliance program management, evidence collection, and audit workflows.

## Architecture

```
+---------------------------+     +---------------------------+
|  Nigerian Remittance      |     |  OpenLane Core            |
|  Platform                 |     |  (GRC Backend)            |
+---------------------------+     +---------------------------+
|                           |     |                           |
|  Runtime Security:        |     |  Compliance Management:   |
|  - Zero Trust             |     |  - Programs (SOC2, ISO)   |
|  - PBAC (Permify)         |     |  - Controls tracking      |
|  - Encryption at Rest     |     |  - Evidence management    |
|  - Audit Service          |     |  - Task workflows         |
|  - KYC/Compliance         |     |  - Questionnaires         |
|                           |     |  - Policy documents       |
+---------------------------+     +---------------------------+
            |                               ^
            |  Evidence Feed                |
            +-------------------------------+
```

## Integration Points

1. **Evidence Collection**: Push audit logs, configs, and metrics to OpenLane
2. **Controls Mapping**: Map platform features to compliance controls
3. **Task Automation**: Create remediation tasks for gaps
4. **Reporting**: Generate compliance reports combining both systems

## Deployment Options

### Option A: Standalone OpenLane (Recommended)
- Deploy OpenLane Core as a separate service
- Connect via API for evidence submission
- Use for internal compliance team workflows

### Option B: Embedded Patterns
- Use OpenLane's data models and patterns
- Implement controls mapping locally
- Skip full OpenLane deployment

## What NOT to Do

- Do NOT replace existing PBAC with OpenFGA
- Do NOT migrate runtime auth to OpenLane
- Do NOT duplicate audit logging
- Do NOT use OpenLane for transaction authorization

## Value Proposition

OpenLane adds value for:
- Compliance officers tracking SOC2/ISO27001 programs
- Evidence collection and audit preparation
- Questionnaire automation for vendors/auditors
- Policy document management

It does NOT replace:
- Runtime security controls (Zero Trust, PBAC)
- Transaction authorization
- KYC/AML screening
- Fraud detection
"""
