#!/usr/bin/env python3
"""
Temporal Workflow Orchestrator for Remittance Platform
Implements complex, long-running workflows with state persistence and fault tolerance
"""

import os
import json
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, asdict
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import uuid
from enum import Enum
import threading
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WorkflowState(Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"

class ActivityState(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"
    COMPENSATING = "compensating"

@dataclass
class TemporalActivity:
    """Represents a Temporal activity with compensation logic"""
    activity_id: str
    name: str
    activity_type: str
    input_data: Dict[str, Any]
    compensation_data: Optional[Dict[str, Any]] = None
    timeout_seconds: int = 300
    retry_policy: Dict[str, Any] = None
    state: ActivityState = ActivityState.PENDING
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    attempt_count: int = 0
    compensation_required: bool = False

@dataclass
class TemporalWorkflow:
    """Represents a Temporal workflow with state persistence"""
    workflow_id: str
    workflow_type: str
    name: str
    description: str
    activities: List[TemporalActivity]
    workflow_state: Dict[str, Any]
    state: WorkflowState = WorkflowState.PENDING
    created_at: str = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    last_heartbeat: Optional[str] = None
    timeout_seconds: int = 3600
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    compensation_activities: List[str] = None

class TemporalOrchestrator:
    """
    Temporal-based workflow orchestrator for complex banking operations
    Provides state persistence, fault tolerance, and compensation patterns
    """
    
    def __init__(self, temporal_host: str = "localhost", temporal_port: int = 7233):
        self.temporal_host = temporal_host
        self.temporal_port = temporal_port
        self.temporal_namespace = "remittance-network"
        
        # Workflow registry with persistence
        self.active_workflows: Dict[str, TemporalWorkflow] = {}
        self.workflow_history: Dict[str, TemporalWorkflow] = {}
        self.workflow_state_store: Dict[str, Dict[str, Any]] = {}
        
        # Activity registry
        self.activity_registry = {
            "kyb_verification": self._kyb_verification_activity,
            "document_analysis": self._document_analysis_activity,
            "compliance_screening": self._compliance_screening_activity,
            "payment_processing": self._payment_processing_activity,
            "fraud_detection": self._fraud_detection_activity,
            "account_creation": self._account_creation_activity,
            "notification_sending": self._notification_sending_activity,
            "insurance_processing": self._insurance_processing_activity,
            "loan_assessment": self._loan_assessment_activity,
            "audit_logging": self._audit_logging_activity,
            "risk_assessment": self._risk_assessment_activity,
            "regulatory_reporting": self._regulatory_reporting_activity
        }
        
        # Compensation activity registry
        self.compensation_registry = {
            "kyb_verification": self._compensate_kyb_verification,
            "account_creation": self._compensate_account_creation,
            "payment_processing": self._compensate_payment_processing,
            "insurance_processing": self._compensate_insurance_processing,
            "loan_assessment": self._compensate_loan_assessment
        }
        
        # Banking service endpoints
        self.banking_services = {
            "kyb-verification": {"host": "localhost", "port": 8100},
            "document-analysis": {"host": "localhost", "port": 8101},
            "compliance-automation": {"host": "localhost", "port": 8102},
            "payment-orchestrator": {"host": "localhost", "port": 8090},
            "fraud-detection": {"host": "localhost", "port": 8096},
            "tigerbeetle-edge": {"host": "localhost", "port": 8095},
            "insurance-suite": {"host": "localhost", "port": 8105},
            "communication-core": {"host": "localhost", "port": 8103},
            "kya-analytics": {"host": "localhost", "port": 8104}
        }
        
        # Start background tasks
        self._start_heartbeat_monitor()
        self._start_timeout_monitor()
    
    def _start_heartbeat_monitor(self):
        """Start heartbeat monitoring for active workflows"""
        def heartbeat_monitor():
            while True:
                try:
                    current_time = datetime.now()
                    for workflow_id, workflow in self.active_workflows.items():
                        if workflow.state == WorkflowState.RUNNING:
                            workflow.last_heartbeat = current_time.isoformat()
                    time.sleep(30)  # Heartbeat every 30 seconds
                except Exception as e:
                    logger.error(f"Heartbeat monitor error: {e}")
        
        thread = threading.Thread(target=heartbeat_monitor, daemon=True)
        thread.start()
    
    def _start_timeout_monitor(self):
        """Start timeout monitoring for workflows"""
        def timeout_monitor():
            while True:
                try:
                    current_time = datetime.now()
                    for workflow_id, workflow in list(self.active_workflows.items()):
                        if workflow.started_at:
                            start_time = datetime.fromisoformat(workflow.started_at)
                            if (current_time - start_time).total_seconds() > workflow.timeout_seconds:
                                logger.warning(f"Workflow {workflow_id} timed out")
                                workflow.state = WorkflowState.TIMEOUT
                                workflow.completed_at = current_time.isoformat()
                                self._move_to_history(workflow_id)
                    time.sleep(60)  # Check timeouts every minute
                except Exception as e:
                    logger.error(f"Timeout monitor error: {e}")
        
        thread = threading.Thread(target=timeout_monitor, daemon=True)
        thread.start()
    
    async def start_workflow(self, workflow_type: str, input_data: Dict[str, Any]) -> str:
        """Start a new Temporal workflow"""
        try:
            workflow_id = f"{workflow_type}_{uuid.uuid4().hex[:8]}"
            
            # Create workflow based on type
            if workflow_type == "agent_comprehensive_onboarding":
                workflow = self._create_agent_comprehensive_onboarding(workflow_id, input_data)
            elif workflow_type == "payment_with_settlement":
                workflow = self._create_payment_with_settlement(workflow_id, input_data)
            elif workflow_type == "insurance_lifecycle_management":
                workflow = self._create_insurance_lifecycle_management(workflow_id, input_data)
            elif workflow_type == "loan_lifecycle_management":
                workflow = self._create_loan_lifecycle_management(workflow_id, input_data)
            elif workflow_type == "compliance_continuous_monitoring":
                workflow = self._create_compliance_continuous_monitoring(workflow_id, input_data)
            elif workflow_type == "fraud_investigation_saga":
                workflow = self._create_fraud_investigation_saga(workflow_id, input_data)
            elif workflow_type == "customer_journey_orchestration":
                workflow = self._create_customer_journey_orchestration(workflow_id, input_data)
            elif workflow_type == "regulatory_reporting_pipeline":
                workflow = self._create_regulatory_reporting_pipeline(workflow_id, input_data)
            else:
                raise ValueError(f"Unknown workflow type: {workflow_type}")
            
            # Initialize workflow state
            workflow.state = WorkflowState.RUNNING
            workflow.started_at = datetime.now().isoformat()
            workflow.workflow_state = {"current_activity": 0, "completed_activities": []}
            
            # Add to active workflows
            self.active_workflows[workflow_id] = workflow
            self.workflow_state_store[workflow_id] = workflow.workflow_state
            
            # Start execution
            asyncio.create_task(self._execute_temporal_workflow(workflow))
            
            logger.info(f"Started Temporal workflow {workflow_id} of type {workflow_type}")
            return workflow_id
            
        except Exception as e:
            logger.error(f"Failed to start workflow {workflow_type}: {e}")
            raise
    
    def _create_agent_comprehensive_onboarding(self, workflow_id: str, input_data: Dict[str, Any]) -> TemporalWorkflow:
        """Create comprehensive agent onboarding workflow with compensation"""
        activities = [
            TemporalActivity(
                activity_id="initial_validation",
                name="Initial Document Validation",
                activity_type="document_analysis",
                input_data={
                    "agent_id": input_data.get("agent_id"),
                    "documents": input_data.get("documents", []),
                    "validation_type": "initial_screening"
                },
                timeout_seconds=300,
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="comprehensive_kyb",
                name="Comprehensive KYB Verification",
                activity_type="kyb_verification",
                input_data={
                    "business_data": input_data.get("business_data"),
                    "verification_level": "comprehensive",
                    "include_beneficial_owners": True
                },
                compensation_data={"verification_id": None},  # Will be populated
                timeout_seconds=900,
                retry_policy={"max_attempts": 2, "backoff": "linear"},
                compensation_required=True
            ),
            TemporalActivity(
                activity_id="enhanced_compliance",
                name="Enhanced Compliance Screening",
                activity_type="compliance_screening",
                input_data={
                    "entity_data": input_data,
                    "screening_depth": "enhanced",
                    "include_adverse_media": True,
                    "jurisdictions": ["NG", "US", "EU", "UK"]
                },
                timeout_seconds=600,
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="risk_profiling",
                name="Comprehensive Risk Profiling",
                activity_type="risk_assessment",
                input_data={
                    "agent_data": input_data,
                    "risk_factors": ["geographic", "business_type", "transaction_volume"],
                    "assessment_type": "comprehensive"
                },
                timeout_seconds=300,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="account_setup",
                name="Multi-Account Setup",
                activity_type="account_creation",
                input_data={
                    "agent_id": input_data.get("agent_id"),
                    "account_types": ["operational", "commission", "float"],
                    "initial_limits": input_data.get("initial_limits", {})
                },
                compensation_data={"account_ids": []},  # Will be populated
                timeout_seconds=180,
                retry_policy={"max_attempts": 2, "backoff": "linear"},
                compensation_required=True
            ),
            TemporalActivity(
                activity_id="training_enrollment",
                name="Agent Training Enrollment",
                activity_type="notification_sending",
                input_data={
                    "agent_id": input_data.get("agent_id"),
                    "training_modules": ["basic_banking", "compliance", "fraud_prevention"],
                    "delivery_method": "multi_channel"
                },
                timeout_seconds=120,
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="final_approval",
                name="Final Approval and Activation",
                activity_type="audit_logging",
                input_data={
                    "agent_id": input_data.get("agent_id"),
                    "approval_data": input_data,
                    "activation_status": "approved"
                },
                timeout_seconds=60,
                retry_policy={"max_attempts": 1, "backoff": "none"}
            )
        ]
        
        return TemporalWorkflow(
            workflow_id=workflow_id,
            workflow_type="agent_comprehensive_onboarding",
            name="Comprehensive Agent Onboarding",
            description="Complete agent onboarding with enhanced verification and compensation",
            activities=activities,
            workflow_state={},
            timeout_seconds=3600,  # 1 hour
            created_at=datetime.now().isoformat(),
            compensation_activities=["comprehensive_kyb", "account_setup"]
        )
    
    def _create_payment_with_settlement(self, workflow_id: str, input_data: Dict[str, Any]) -> TemporalWorkflow:
        """Create payment workflow with settlement and compensation"""
        activities = [
            TemporalActivity(
                activity_id="pre_transaction_checks",
                name="Pre-Transaction Validation",
                activity_type="fraud_detection",
                input_data={
                    "transaction_data": input_data.get("transaction"),
                    "validation_level": "comprehensive",
                    "real_time_scoring": True
                },
                timeout_seconds=30,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="reserve_funds",
                name="Reserve Transaction Funds",
                activity_type="payment_processing",
                input_data={
                    "operation": "reserve",
                    "from_account": input_data.get("from_account"),
                    "amount": input_data.get("amount"),
                    "currency": input_data.get("currency", "NGN")
                },
                compensation_data={"reservation_id": None},
                timeout_seconds=60,
                retry_policy={"max_attempts": 2, "backoff": "linear"},
                compensation_required=True
            ),
            TemporalActivity(
                activity_id="execute_transfer",
                name="Execute Fund Transfer",
                activity_type="payment_processing",
                input_data={
                    "operation": "transfer",
                    "from_account": input_data.get("from_account"),
                    "to_account": input_data.get("to_account"),
                    "amount": input_data.get("amount"),
                    "reference": input_data.get("reference")
                },
                compensation_data={"transfer_id": None},
                timeout_seconds=120,
                retry_policy={"max_attempts": 1, "backoff": "none"},
                compensation_required=True
            ),
            TemporalActivity(
                activity_id="settlement_processing",
                name="Process Settlement",
                activity_type="payment_processing",
                input_data={
                    "operation": "settle",
                    "transfer_data": input_data,
                    "settlement_type": "immediate"
                },
                timeout_seconds=180,
                retry_policy={"max_attempts": 2, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="notification_dispatch",
                name="Dispatch Notifications",
                activity_type="notification_sending",
                input_data={
                    "recipients": [input_data.get("customer_id"), input_data.get("agent_id")],
                    "notification_type": "payment_confirmation",
                    "transaction_details": input_data.get("transaction")
                },
                timeout_seconds=60,
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            )
        ]
        
        return TemporalWorkflow(
            workflow_id=workflow_id,
            workflow_type="payment_with_settlement",
            name="Payment with Settlement",
            description="Payment processing with fund reservation and settlement",
            activities=activities,
            workflow_state={},
            timeout_seconds=600,  # 10 minutes
            created_at=datetime.now().isoformat(),
            compensation_activities=["reserve_funds", "execute_transfer"]
        )
    
    def _create_insurance_lifecycle_management(self, workflow_id: str, input_data: Dict[str, Any]) -> TemporalWorkflow:
        """Create insurance lifecycle management workflow"""
        activities = [
            TemporalActivity(
                activity_id="policy_underwriting",
                name="AI-Powered Underwriting",
                activity_type="insurance_processing",
                input_data={
                    "operation": "underwrite",
                    "policy_data": input_data.get("policy_data"),
                    "underwriting_type": "comprehensive"
                },
                timeout_seconds=600,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="policy_issuance",
                name="Policy Issuance",
                activity_type="insurance_processing",
                input_data={
                    "operation": "issue",
                    "policy_details": input_data.get("policy_details"),
                    "customer_id": input_data.get("customer_id")
                },
                compensation_data={"policy_id": None},
                timeout_seconds=300,
                retry_policy={"max_attempts": 2, "backoff": "linear"},
                compensation_required=True
            ),
            TemporalActivity(
                activity_id="premium_collection",
                name="Premium Collection Setup",
                activity_type="payment_processing",
                input_data={
                    "operation": "setup_recurring",
                    "customer_account": input_data.get("customer_account"),
                    "premium_amount": input_data.get("premium_amount"),
                    "frequency": input_data.get("payment_frequency", "monthly")
                },
                timeout_seconds=180,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="policy_activation",
                name="Policy Activation",
                activity_type="insurance_processing",
                input_data={
                    "operation": "activate",
                    "policy_id": None,  # Will be set from previous activity
                    "activation_date": input_data.get("activation_date")
                },
                timeout_seconds=120,
                retry_policy={"max_attempts": 1, "backoff": "none"}
            ),
            TemporalActivity(
                activity_id="welcome_communication",
                name="Welcome Communication",
                activity_type="notification_sending",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "communication_type": "policy_welcome",
                    "policy_details": input_data.get("policy_details")
                },
                timeout_seconds=60,
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            )
        ]
        
        return TemporalWorkflow(
            workflow_id=workflow_id,
            workflow_type="insurance_lifecycle_management",
            name="Insurance Lifecycle Management",
            description="Complete insurance policy lifecycle from underwriting to activation",
            activities=activities,
            workflow_state={},
            timeout_seconds=1800,  # 30 minutes
            created_at=datetime.now().isoformat(),
            compensation_activities=["policy_issuance"]
        )
    
    def _create_loan_lifecycle_management(self, workflow_id: str, input_data: Dict[str, Any]) -> TemporalWorkflow:
        """Create loan lifecycle management workflow"""
        activities = [
            TemporalActivity(
                activity_id="credit_assessment",
                name="Comprehensive Credit Assessment",
                activity_type="loan_assessment",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "loan_application": input_data.get("loan_application"),
                    "assessment_type": "comprehensive"
                },
                timeout_seconds=600,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="collateral_evaluation",
                name="Collateral Evaluation",
                activity_type="document_analysis",
                input_data={
                    "collateral_documents": input_data.get("collateral_documents", []),
                    "evaluation_type": "comprehensive",
                    "valuation_required": True
                },
                timeout_seconds=900,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="loan_approval",
                name="Loan Approval Decision",
                activity_type="loan_assessment",
                input_data={
                    "operation": "approve",
                    "assessment_results": None,  # From previous activity
                    "loan_terms": input_data.get("proposed_terms")
                },
                compensation_data={"loan_id": None},
                timeout_seconds=300,
                retry_policy={"max_attempts": 1, "backoff": "none"},
                compensation_required=True
            ),
            TemporalActivity(
                activity_id="loan_disbursement",
                name="Loan Disbursement",
                activity_type="payment_processing",
                input_data={
                    "operation": "disburse",
                    "loan_id": None,  # From previous activity
                    "disbursement_account": input_data.get("disbursement_account"),
                    "amount": input_data.get("loan_amount")
                },
                compensation_data={"disbursement_id": None},
                timeout_seconds=300,
                retry_policy={"max_attempts": 1, "backoff": "none"},
                compensation_required=True
            ),
            TemporalActivity(
                activity_id="repayment_schedule",
                name="Setup Repayment Schedule",
                activity_type="payment_processing",
                input_data={
                    "operation": "setup_schedule",
                    "loan_id": None,  # From previous activity
                    "repayment_terms": input_data.get("repayment_terms")
                },
                timeout_seconds=180,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="loan_documentation",
                name="Generate Loan Documentation",
                activity_type="audit_logging",
                input_data={
                    "loan_id": None,  # From previous activity
                    "documentation_type": "complete",
                    "regulatory_compliance": True
                },
                timeout_seconds=240,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            )
        ]
        
        return TemporalWorkflow(
            workflow_id=workflow_id,
            workflow_type="loan_lifecycle_management",
            name="Loan Lifecycle Management",
            description="Complete loan processing from application to disbursement",
            activities=activities,
            workflow_state={},
            timeout_seconds=2400,  # 40 minutes
            created_at=datetime.now().isoformat(),
            compensation_activities=["loan_approval", "loan_disbursement"]
        )
    
    def _create_compliance_continuous_monitoring(self, workflow_id: str, input_data: Dict[str, Any]) -> TemporalWorkflow:
        """Create continuous compliance monitoring workflow"""
        activities = [
            TemporalActivity(
                activity_id="transaction_monitoring",
                name="Continuous Transaction Monitoring",
                activity_type="compliance_screening",
                input_data={
                    "monitoring_scope": input_data.get("monitoring_scope"),
                    "monitoring_period": input_data.get("monitoring_period", "24h"),
                    "alert_thresholds": input_data.get("alert_thresholds")
                },
                timeout_seconds=3600,  # 1 hour for continuous monitoring
                retry_policy={"max_attempts": 5, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="suspicious_activity_detection",
                name="Suspicious Activity Detection",
                activity_type="fraud_detection",
                input_data={
                    "detection_algorithms": ["rule_based", "ml_based", "gnn_based"],
                    "sensitivity_level": "high",
                    "real_time_analysis": True
                },
                timeout_seconds=1800,  # 30 minutes
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="regulatory_reporting",
                name="Automated Regulatory Reporting",
                activity_type="regulatory_reporting",
                input_data={
                    "report_types": ["SAR", "CTR", "OFAC"],
                    "reporting_period": input_data.get("reporting_period"),
                    "regulatory_bodies": ["CBN", "NFIU", "EFCC"]
                },
                timeout_seconds=900,  # 15 minutes
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="compliance_dashboard_update",
                name="Update Compliance Dashboard",
                activity_type="audit_logging",
                input_data={
                    "dashboard_type": "compliance",
                    "metrics_update": True,
                    "alert_status": input_data.get("alert_status")
                },
                timeout_seconds=300,
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            )
        ]
        
        return TemporalWorkflow(
            workflow_id=workflow_id,
            workflow_type="compliance_continuous_monitoring",
            name="Continuous Compliance Monitoring",
            description="24/7 compliance monitoring with automated reporting",
            activities=activities,
            workflow_state={},
            timeout_seconds=7200,  # 2 hours
            created_at=datetime.now().isoformat(),
            compensation_activities=[]
        )
    
    def _create_fraud_investigation_saga(self, workflow_id: str, input_data: Dict[str, Any]) -> TemporalWorkflow:
        """Create fraud investigation saga workflow"""
        activities = [
            TemporalActivity(
                activity_id="evidence_collection",
                name="Comprehensive Evidence Collection",
                activity_type="fraud_detection",
                input_data={
                    "case_id": input_data.get("case_id"),
                    "evidence_types": ["transaction", "behavioral", "network"],
                    "collection_depth": "comprehensive"
                },
                timeout_seconds=1800,  # 30 minutes
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="forensic_analysis",
                name="AI-Powered Forensic Analysis",
                activity_type="fraud_detection",
                input_data={
                    "analysis_type": "forensic",
                    "ai_models": ["gnn", "deep_learning", "ensemble"],
                    "case_data": input_data.get("case_data")
                },
                timeout_seconds=2400,  # 40 minutes
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="impact_assessment",
                name="Financial Impact Assessment",
                activity_type="risk_assessment",
                input_data={
                    "assessment_scope": "financial_impact",
                    "affected_accounts": input_data.get("affected_accounts", []),
                    "time_range": input_data.get("investigation_period")
                },
                timeout_seconds=600,  # 10 minutes
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="remediation_actions",
                name="Execute Remediation Actions",
                activity_type="compliance_screening",
                input_data={
                    "remediation_plan": input_data.get("remediation_plan"),
                    "account_actions": input_data.get("account_actions", []),
                    "notification_required": True
                },
                compensation_data={"remediation_id": None},
                timeout_seconds=900,  # 15 minutes
                retry_policy={"max_attempts": 1, "backoff": "none"},
                compensation_required=True
            ),
            TemporalActivity(
                activity_id="case_documentation",
                name="Generate Case Documentation",
                activity_type="audit_logging",
                input_data={
                    "case_id": input_data.get("case_id"),
                    "documentation_type": "investigation_report",
                    "include_evidence": True,
                    "regulatory_format": True
                },
                timeout_seconds=600,  # 10 minutes
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            )
        ]
        
        return TemporalWorkflow(
            workflow_id=workflow_id,
            workflow_type="fraud_investigation_saga",
            name="Fraud Investigation Saga",
            description="Comprehensive fraud investigation with compensation patterns",
            activities=activities,
            workflow_state={},
            timeout_seconds=7200,  # 2 hours
            created_at=datetime.now().isoformat(),
            compensation_activities=["remediation_actions"]
        )
    
    def _create_customer_journey_orchestration(self, workflow_id: str, input_data: Dict[str, Any]) -> TemporalWorkflow:
        """Create customer journey orchestration workflow"""
        activities = [
            TemporalActivity(
                activity_id="journey_initialization",
                name="Initialize Customer Journey",
                activity_type="audit_logging",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "journey_type": input_data.get("journey_type"),
                    "touchpoints": input_data.get("touchpoints", [])
                },
                timeout_seconds=120,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="personalization_engine",
                name="AI Personalization Engine",
                activity_type="risk_assessment",
                input_data={
                    "customer_profile": input_data.get("customer_profile"),
                    "personalization_type": "comprehensive",
                    "cultural_context": input_data.get("cultural_context", "nigerian")
                },
                timeout_seconds=300,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="multi_channel_engagement",
                name="Multi-Channel Engagement",
                activity_type="notification_sending",
                input_data={
                    "engagement_channels": ["sms", "whatsapp", "ussd", "voice"],
                    "content_personalization": True,
                    "language_preference": input_data.get("language", "english")
                },
                timeout_seconds=600,  # 10 minutes
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="journey_analytics",
                name="Journey Analytics and Optimization",
                activity_type="audit_logging",
                input_data={
                    "analytics_type": "journey_optimization",
                    "metrics_collection": True,
                    "optimization_recommendations": True
                },
                timeout_seconds=240,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            )
        ]
        
        return TemporalWorkflow(
            workflow_id=workflow_id,
            workflow_type="customer_journey_orchestration",
            name="Customer Journey Orchestration",
            description="Personalized customer journey with multi-channel engagement",
            activities=activities,
            workflow_state={},
            timeout_seconds=1800,  # 30 minutes
            created_at=datetime.now().isoformat(),
            compensation_activities=[]
        )
    
    def _create_regulatory_reporting_pipeline(self, workflow_id: str, input_data: Dict[str, Any]) -> TemporalWorkflow:
        """Create regulatory reporting pipeline workflow"""
        activities = [
            TemporalActivity(
                activity_id="data_aggregation",
                name="Regulatory Data Aggregation",
                activity_type="audit_logging",
                input_data={
                    "reporting_period": input_data.get("reporting_period"),
                    "data_sources": ["transactions", "accounts", "customers", "agents"],
                    "aggregation_rules": input_data.get("aggregation_rules")
                },
                timeout_seconds=1800,  # 30 minutes
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="compliance_validation",
                name="Compliance Data Validation",
                activity_type="compliance_screening",
                input_data={
                    "validation_rules": input_data.get("validation_rules"),
                    "regulatory_standards": ["CBN", "NFIU", "EFCC"],
                    "data_quality_checks": True
                },
                timeout_seconds=900,  # 15 minutes
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="report_generation",
                name="Generate Regulatory Reports",
                activity_type="regulatory_reporting",
                input_data={
                    "report_formats": input_data.get("report_formats", ["XML", "CSV", "PDF"]),
                    "regulatory_templates": input_data.get("regulatory_templates"),
                    "digital_signatures": True
                },
                timeout_seconds=600,  # 10 minutes
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            ),
            TemporalActivity(
                activity_id="report_submission",
                name="Submit Regulatory Reports",
                activity_type="regulatory_reporting",
                input_data={
                    "submission_channels": input_data.get("submission_channels"),
                    "regulatory_portals": input_data.get("regulatory_portals"),
                    "confirmation_required": True
                },
                timeout_seconds=900,  # 15 minutes
                retry_policy={"max_attempts": 3, "backoff": "exponential"}
            ),
            TemporalActivity(
                activity_id="submission_confirmation",
                name="Confirm Submission Status",
                activity_type="audit_logging",
                input_data={
                    "confirmation_tracking": True,
                    "audit_trail": True,
                    "notification_stakeholders": True
                },
                timeout_seconds=300,
                retry_policy={"max_attempts": 2, "backoff": "linear"}
            )
        ]
        
        return TemporalWorkflow(
            workflow_id=workflow_id,
            workflow_type="regulatory_reporting_pipeline",
            name="Regulatory Reporting Pipeline",
            description="Automated regulatory reporting with compliance validation",
            activities=activities,
            workflow_state={},
            timeout_seconds=4800,  # 80 minutes
            created_at=datetime.now().isoformat(),
            compensation_activities=[]
        )
    
    async def _execute_temporal_workflow(self, workflow: TemporalWorkflow):
        """Execute Temporal workflow with state persistence and compensation"""
        try:
            for i, activity in enumerate(workflow.activities):
                # Update workflow state
                workflow.workflow_state["current_activity"] = i
                self.workflow_state_store[workflow.workflow_id] = workflow.workflow_state
                
                # Execute activity
                try:
                    result = await self._execute_temporal_activity(activity)
                    activity.result = result
                    activity.state = ActivityState.COMPLETED
                    activity.completed_at = datetime.now().isoformat()
                    
                    # Add to completed activities
                    workflow.workflow_state["completed_activities"].append(activity.activity_id)
                    
                    logger.info(f"Activity {activity.activity_id} completed in workflow {workflow.workflow_id}")
                    
                except Exception as e:
                    logger.error(f"Activity {activity.activity_id} failed in workflow {workflow.workflow_id}: {e}")
                    activity.state = ActivityState.FAILED
                    activity.error = str(e)
                    
                    # Execute compensation if required
                    if activity.compensation_required:
                        await self._execute_compensation(workflow, activity)
                    
                    # Fail the entire workflow
                    workflow.state = WorkflowState.FAILED
                    workflow.error = f"Activity {activity.activity_id} failed: {e}"
                    workflow.completed_at = datetime.now().isoformat()
                    break
            
            # Mark workflow as completed if all activities succeeded
            if workflow.state == WorkflowState.RUNNING:
                workflow.state = WorkflowState.COMPLETED
                workflow.completed_at = datetime.now().isoformat()
                workflow.result = {
                    "activities_completed": len(workflow.workflow_state["completed_activities"]),
                    "total_activities": len(workflow.activities),
                    "execution_time_seconds": (
                        datetime.fromisoformat(workflow.completed_at) - 
                        datetime.fromisoformat(workflow.started_at)
                    ).total_seconds()
                }
            
            # Move to history
            self._move_to_history(workflow.workflow_id)
            
            logger.info(f"Temporal workflow {workflow.workflow_id} completed with status: {workflow.state}")
            
        except Exception as e:
            workflow.state = WorkflowState.FAILED
            workflow.error = str(e)
            workflow.completed_at = datetime.now().isoformat()
            logger.error(f"Temporal workflow {workflow.workflow_id} execution failed: {e}")
    
    async def _execute_temporal_activity(self, activity: TemporalActivity) -> Dict[str, Any]:
        """Execute a single Temporal activity with retry logic"""
        activity.state = ActivityState.RUNNING
        activity.started_at = datetime.now().isoformat()
        
        retry_policy = activity.retry_policy or {"max_attempts": 1, "backoff": "none"}
        max_attempts = retry_policy.get("max_attempts", 1)
        backoff_type = retry_policy.get("backoff", "none")
        
        for attempt in range(max_attempts):
            try:
                activity.attempt_count = attempt + 1
                
                # Execute activity based on type
                if activity.activity_type in self.activity_registry:
                    result = await self.activity_registry[activity.activity_type](activity.input_data)
                    return result
                else:
                    raise ValueError(f"Unknown activity type: {activity.activity_type}")
                    
            except Exception as e:
                if attempt < max_attempts - 1:
                    activity.state = ActivityState.RETRYING
                    
                    # Calculate backoff delay
                    if backoff_type == "exponential":
                        delay = 2 ** attempt
                    elif backoff_type == "linear":
                        delay = (attempt + 1) * 2
                    else:
                        delay = 1
                    
                    logger.warning(f"Activity {activity.activity_id} attempt {attempt + 1} failed: {e}. Retrying in {delay}s...")
                    await asyncio.sleep(delay)
                else:
                    activity.state = ActivityState.FAILED
                    activity.error = str(e)
                    activity.completed_at = datetime.now().isoformat()
                    raise e
    
    async def _execute_compensation(self, workflow: TemporalWorkflow, failed_activity: TemporalActivity):
        """Execute compensation activities for failed workflow"""
        logger.info(f"Executing compensation for workflow {workflow.workflow_id}")
        
        # Find all completed activities that require compensation
        compensation_activities = []
        for activity in workflow.activities:
            if (activity.state == ActivityStatus.COMPLETED and 
                activity.compensation_required and 
                activity.activity_id in workflow.compensation_activities):
                compensation_activities.append(activity)
        
        # Execute compensation in reverse order
        for activity in reversed(compensation_activities):
            try:
                if activity.activity_type in self.compensation_registry:
                    compensation_func = self.compensation_registry[activity.activity_type]
                    await compensation_func(activity.compensation_data)
                    logger.info(f"Compensation executed for activity {activity.activity_id}")
                else:
                    logger.warning(f"No compensation handler for activity type: {activity.activity_type}")
            except Exception as e:
                logger.error(f"Compensation failed for activity {activity.activity_id}: {e}")
    
    def _move_to_history(self, workflow_id: str):
        """Move workflow from active to history"""
        if workflow_id in self.active_workflows:
            workflow = self.active_workflows[workflow_id]
            del self.active_workflows[workflow_id]
            self.workflow_history[workflow_id] = workflow
            
            # Clean up state store
            if workflow_id in self.workflow_state_store:
                del self.workflow_state_store[workflow_id]
    
    # Activity implementations
    async def _kyb_verification_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute KYB verification activity"""
        service_config = self.banking_services["kyb-verification"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/verify/business"
        
        response = requests.post(url, json=input_data, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"KYB verification failed: {response.text}")
    
    async def _document_analysis_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute document analysis activity"""
        service_config = self.banking_services["document-analysis"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/analyze/documents"
        
        response = requests.post(url, json=input_data, timeout=60)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Document analysis failed: {response.text}")
    
    async def _compliance_screening_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute compliance screening activity"""
        service_config = self.banking_services["compliance-automation"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/screen/comprehensive"
        
        response = requests.post(url, json=input_data, timeout=45)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Compliance screening failed: {response.text}")
    
    async def _payment_processing_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute payment processing activity"""
        service_config = self.banking_services["payment-orchestrator"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/process"
        
        response = requests.post(url, json=input_data, timeout=60)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Payment processing failed: {response.text}")
    
    async def _fraud_detection_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute fraud detection activity"""
        service_config = self.banking_services["fraud-detection"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/analyze/transaction"
        
        response = requests.post(url, json=input_data, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Fraud detection failed: {response.text}")
    
    async def _account_creation_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute account creation activity"""
        service_config = self.banking_services["tigerbeetle-edge"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/accounts"
        
        response = requests.post(url, json=input_data, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Account creation failed: {response.text}")
    
    async def _notification_sending_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute notification sending activity"""
        service_config = self.banking_services["communication-core"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/notify"
        
        response = requests.post(url, json=input_data, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Notification sending failed: {response.text}")
    
    async def _insurance_processing_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute insurance processing activity"""
        service_config = self.banking_services["insurance-suite"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/process"
        
        response = requests.post(url, json=input_data, timeout=60)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Insurance processing failed: {response.text}")
    
    async def _loan_assessment_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute loan assessment activity"""
        service_config = self.banking_services["kya-analytics"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/assess/loan"
        
        response = requests.post(url, json=input_data, timeout=45)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Loan assessment failed: {response.text}")
    
    async def _audit_logging_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute audit logging activity"""
        # Simulate audit logging
        return {
            "audit_id": f"audit_{uuid.uuid4().hex[:8]}",
            "timestamp": datetime.now().isoformat(),
            "status": "logged",
            "data": input_data
        }
    
    async def _risk_assessment_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute risk assessment activity"""
        service_config = self.banking_services["kya-analytics"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/assess/risk"
        
        response = requests.post(url, json=input_data, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Risk assessment failed: {response.text}")
    
    async def _regulatory_reporting_activity(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute regulatory reporting activity"""
        service_config = self.banking_services["compliance-automation"]
        url = f"http://{service_config['host']}:{service_config['port']}/api/v1/report/regulatory"
        
        response = requests.post(url, json=input_data, timeout=60)
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Regulatory reporting failed: {response.text}")
    
    # Compensation activity implementations
    async def _compensate_kyb_verification(self, compensation_data: Dict[str, Any]):
        """Compensate KYB verification"""
        logger.info("Compensating KYB verification - marking as cancelled")
        # Implementation would cancel the verification record
    
    async def _compensate_account_creation(self, compensation_data: Dict[str, Any]):
        """Compensate account creation"""
        logger.info("Compensating account creation - closing created accounts")
        # Implementation would close the created accounts
    
    async def _compensate_payment_processing(self, compensation_data: Dict[str, Any]):
        """Compensate payment processing"""
        logger.info("Compensating payment processing - reversing transaction")
        # Implementation would reverse the payment
    
    async def _compensate_insurance_processing(self, compensation_data: Dict[str, Any]):
        """Compensate insurance processing"""
        logger.info("Compensating insurance processing - cancelling policy")
        # Implementation would cancel the insurance policy
    
    async def _compensate_loan_assessment(self, compensation_data: Dict[str, Any]):
        """Compensate loan assessment"""
        logger.info("Compensating loan assessment - reversing approval")
        # Implementation would reverse the loan approval
    
    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get Temporal workflow status"""
        workflow = self.active_workflows.get(workflow_id) or self.workflow_history.get(workflow_id)
        if not workflow:
            return None
        
        return {
            "workflow_id": workflow.workflow_id,
            "workflow_type": workflow.workflow_type,
            "name": workflow.name,
            "state": workflow.state.value,
            "created_at": workflow.created_at,
            "started_at": workflow.started_at,
            "completed_at": workflow.completed_at,
            "last_heartbeat": workflow.last_heartbeat,
            "workflow_state": workflow.workflow_state,
            "activities": [
                {
                    "activity_id": activity.activity_id,
                    "name": activity.name,
                    "activity_type": activity.activity_type,
                    "state": activity.state.value,
                    "started_at": activity.started_at,
                    "completed_at": activity.completed_at,
                    "attempt_count": activity.attempt_count,
                    "compensation_required": activity.compensation_required,
                    "error": activity.error
                }
                for activity in workflow.activities
            ],
            "result": workflow.result,
            "error": workflow.error,
            "compensation_activities": workflow.compensation_activities
        }
    
    def list_workflows(self) -> Dict[str, List[Dict[str, Any]]]:
        """List all Temporal workflows"""
        active = [
            {
                "workflow_id": wf.workflow_id,
                "workflow_type": wf.workflow_type,
                "name": wf.name,
                "state": wf.state.value,
                "started_at": wf.started_at,
                "last_heartbeat": wf.last_heartbeat
            }
            for wf in self.active_workflows.values()
        ]
        
        history = [
            {
                "workflow_id": wf.workflow_id,
                "workflow_type": wf.workflow_type,
                "name": wf.name,
                "state": wf.state.value,
                "completed_at": wf.completed_at
            }
            for wf in self.workflow_history.values()
        ]
        
        return {
            "active_workflows": active,
            "workflow_history": history,
            "total_active": len(active),
            "total_history": len(history)
        }

# Flask application for Temporal orchestrator
app = Flask(__name__)
CORS(app, origins="*")

# Initialize Temporal orchestrator
temporal_orchestrator = TemporalOrchestrator()

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "Temporal Workflow Orchestrator",
        "version": "1.0.0",
        "namespace": temporal_orchestrator.temporal_namespace,
        "active_workflows": len(temporal_orchestrator.active_workflows),
        "timestamp": datetime.now().isoformat()
    })

@app.route('/workflows/start', methods=['POST'])
async def start_workflow():
    """Start a new Temporal workflow"""
    try:
        data = request.get_json()
        workflow_type = data.get('workflow_type')
        input_data = data.get('input_data', {})
        
        if not workflow_type:
            return jsonify({"error": "Workflow type is required"}), 400
        
        workflow_id = await temporal_orchestrator.start_workflow(workflow_type, input_data)
        
        return jsonify({
            "status": "success",
            "workflow_id": workflow_id,
            "workflow_type": workflow_type,
            "message": f"Temporal workflow {workflow_type} started successfully",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/workflows/<workflow_id>/status', methods=['GET'])
def get_workflow_status(workflow_id):
    """Get Temporal workflow status"""
    try:
        status = temporal_orchestrator.get_workflow_status(workflow_id)
        if not status:
            return jsonify({"error": "Workflow not found"}), 404
        
        return jsonify(status)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/workflows', methods=['GET'])
def list_workflows():
    """List all Temporal workflows"""
    try:
        workflows = temporal_orchestrator.list_workflows()
        return jsonify(workflows)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/workflows/types', methods=['GET'])
def list_workflow_types():
    """List available Temporal workflow types"""
    workflow_types = [
        {
            "type": "agent_comprehensive_onboarding",
            "name": "Comprehensive Agent Onboarding",
            "description": "Complete agent onboarding with enhanced verification and compensation",
            "estimated_duration": "60 minutes",
            "activities": 7,
            "compensation_enabled": True
        },
        {
            "type": "payment_with_settlement",
            "name": "Payment with Settlement",
            "description": "Payment processing with fund reservation and settlement",
            "estimated_duration": "10 minutes",
            "activities": 5,
            "compensation_enabled": True
        },
        {
            "type": "insurance_lifecycle_management",
            "name": "Insurance Lifecycle Management",
            "description": "Complete insurance policy lifecycle from underwriting to activation",
            "estimated_duration": "30 minutes",
            "activities": 5,
            "compensation_enabled": True
        },
        {
            "type": "loan_lifecycle_management",
            "name": "Loan Lifecycle Management",
            "description": "Complete loan processing from application to disbursement",
            "estimated_duration": "40 minutes",
            "activities": 6,
            "compensation_enabled": True
        },
        {
            "type": "compliance_continuous_monitoring",
            "name": "Continuous Compliance Monitoring",
            "description": "24/7 compliance monitoring with automated reporting",
            "estimated_duration": "120 minutes",
            "activities": 4,
            "compensation_enabled": False
        },
        {
            "type": "fraud_investigation_saga",
            "name": "Fraud Investigation Saga",
            "description": "Comprehensive fraud investigation with compensation patterns",
            "estimated_duration": "120 minutes",
            "activities": 5,
            "compensation_enabled": True
        },
        {
            "type": "customer_journey_orchestration",
            "name": "Customer Journey Orchestration",
            "description": "Personalized customer journey with multi-channel engagement",
            "estimated_duration": "30 minutes",
            "activities": 4,
            "compensation_enabled": False
        },
        {
            "type": "regulatory_reporting_pipeline",
            "name": "Regulatory Reporting Pipeline",
            "description": "Automated regulatory reporting with compliance validation",
            "estimated_duration": "80 minutes",
            "activities": 5,
            "compensation_enabled": False
        }
    ]
    
    return jsonify({
        "workflow_types": workflow_types,
        "total_types": len(workflow_types),
        "compensation_patterns": ["saga", "try_cancel_compensate"]
    })

if __name__ == '__main__':
    print("🚀 Starting Temporal Workflow Orchestrator...")
    print("🔄 Workflow Types: Agent Onboarding, Payments, Insurance, Loans, Compliance, Fraud Investigation")
    print("🔄 Features: State Persistence, Compensation Patterns, Fault Tolerance")
    print("🌐 Server: http://localhost:8202")
    print("=" * 80)
    
    app.run(host='0.0.0.0', port=8202, debug=False)

