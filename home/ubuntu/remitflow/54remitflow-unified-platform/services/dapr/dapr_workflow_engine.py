#!/usr/bin/env python3
"""
Dapr Workflow Engine for Remittance Platform
Implements distributed workflows using Dapr runtime for banking operations
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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WorkflowStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"

class ActivityStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"

@dataclass
class WorkflowActivity:
    """Represents a single activity in a workflow"""
    activity_id: str
    name: str
    service_name: str
    endpoint: str
    input_data: Dict[str, Any]
    timeout_seconds: int = 300
    retry_attempts: int = 3
    retry_delay_seconds: int = 5
    status: ActivityStatus = ActivityStatus.PENDING
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    attempt_count: int = 0

@dataclass
class WorkflowDefinition:
    """Defines a complete workflow with activities and dependencies"""
    workflow_id: str
    name: str
    description: str
    activities: List[WorkflowActivity]
    dependencies: Dict[str, List[str]]  # activity_id -> list of dependency activity_ids
    timeout_seconds: int = 3600
    status: WorkflowStatus = WorkflowStatus.PENDING
    created_at: str = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class DaprWorkflowEngine:
    """
    Dapr-based workflow engine for distributed banking operations
    Manages complex workflows across multiple microservices
    """
    
    def __init__(self, dapr_http_port: int = 3500, dapr_grpc_port: int = 50001):
        self.dapr_http_port = dapr_http_port
        self.dapr_grpc_port = dapr_grpc_port
        self.dapr_base_url = f"http://localhost:{dapr_http_port}"
        
        # Workflow registry
        self.active_workflows: Dict[str, WorkflowDefinition] = {}
        self.completed_workflows: Dict[str, WorkflowDefinition] = {}
        
        # Banking service endpoints
        self.banking_services = {
            "kyb-verification": {"host": "localhost", "port": 8100, "app_id": "kyb-service"},
            "document-analysis": {"host": "localhost", "port": 8101, "app_id": "document-service"},
            "compliance-automation": {"host": "localhost", "port": 8102, "app_id": "compliance-service"},
            "payment-orchestrator": {"host": "localhost", "port": 8090, "app_id": "payment-service"},
            "fraud-detection": {"host": "localhost", "port": 8096, "app_id": "fraud-service"},
            "tigerbeetle-edge": {"host": "localhost", "port": 8095, "app_id": "accounting-service"},
            "insurance-suite": {"host": "localhost", "port": 8105, "app_id": "insurance-service"},
            "communication-core": {"host": "localhost", "port": 8103, "app_id": "communication-service"},
            "kya-analytics": {"host": "localhost", "port": 8104, "app_id": "analytics-service"}
        }
        
        # Predefined workflow templates for banking operations
        self.workflow_templates = {
            "agent_onboarding": self._create_agent_onboarding_workflow,
            "payment_processing": self._create_payment_processing_workflow,
            "insurance_claim_processing": self._create_insurance_claim_workflow,
            "kyc_update": self._create_kyc_update_workflow,
            "fraud_investigation": self._create_fraud_investigation_workflow,
            "loan_application": self._create_loan_application_workflow,
            "account_closure": self._create_account_closure_workflow,
            "compliance_audit": self._create_compliance_audit_workflow
        }
    
    def _create_agent_onboarding_workflow(self, input_data: Dict[str, Any]) -> WorkflowDefinition:
        """Create agent onboarding workflow"""
        workflow_id = f"agent_onboarding_{uuid.uuid4().hex[:8]}"
        
        activities = [
            WorkflowActivity(
                activity_id="validate_documents",
                name="Document Validation",
                service_name="document-analysis",
                endpoint="/api/v1/analyze/documents",
                input_data={
                    "agent_id": input_data.get("agent_id"),
                    "documents": input_data.get("documents", []),
                    "verification_type": "agent_onboarding"
                },
                timeout_seconds=300,
                retry_attempts=3
            ),
            WorkflowActivity(
                activity_id="kyb_verification",
                name="KYB Verification",
                service_name="kyb-verification",
                endpoint="/api/v1/verify/business",
                input_data={
                    "business_name": input_data.get("business_name"),
                    "registration_number": input_data.get("registration_number"),
                    "business_address": input_data.get("business_address"),
                    "verification_level": "comprehensive"
                },
                timeout_seconds=600,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="compliance_check",
                name="Compliance Screening",
                service_name="compliance-automation",
                endpoint="/api/v1/screen/comprehensive",
                input_data={
                    "entity_type": "agent",
                    "entity_data": input_data,
                    "screening_types": ["sanctions", "pep", "adverse_media"]
                },
                timeout_seconds=300,
                retry_attempts=3
            ),
            WorkflowActivity(
                activity_id="create_account",
                name="Create Agent Account",
                service_name="tigerbeetle-edge",
                endpoint="/api/v1/accounts",
                input_data={
                    "account_type": "agent",
                    "agent_id": input_data.get("agent_id"),
                    "initial_balance": 0,
                    "currency": "NGN"
                },
                timeout_seconds=120,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="setup_communication",
                name="Setup Communication Channels",
                service_name="communication-core",
                endpoint="/api/v1/setup/agent",
                input_data={
                    "agent_id": input_data.get("agent_id"),
                    "phone_number": input_data.get("phone_number"),
                    "email": input_data.get("email"),
                    "preferred_language": input_data.get("preferred_language", "english")
                },
                timeout_seconds=180,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="send_welcome_notification",
                name="Send Welcome Notification",
                service_name="communication-core",
                endpoint="/api/v1/notify/agent_welcome",
                input_data={
                    "agent_id": input_data.get("agent_id"),
                    "notification_channels": ["sms", "email"],
                    "language": input_data.get("preferred_language", "english")
                },
                timeout_seconds=60,
                retry_attempts=3
            )
        ]
        
        # Define dependencies
        dependencies = {
            "kyb_verification": ["validate_documents"],
            "compliance_check": ["validate_documents", "kyb_verification"],
            "create_account": ["compliance_check"],
            "setup_communication": ["create_account"],
            "send_welcome_notification": ["setup_communication"]
        }
        
        return WorkflowDefinition(
            workflow_id=workflow_id,
            name="Agent Onboarding",
            description="Complete agent onboarding process with KYB verification",
            activities=activities,
            dependencies=dependencies,
            timeout_seconds=1800,  # 30 minutes
            created_at=datetime.now().isoformat()
        )
    
    def _create_payment_processing_workflow(self, input_data: Dict[str, Any]) -> WorkflowDefinition:
        """Create payment processing workflow"""
        workflow_id = f"payment_processing_{uuid.uuid4().hex[:8]}"
        
        activities = [
            WorkflowActivity(
                activity_id="fraud_check",
                name="Fraud Detection",
                service_name="fraud-detection",
                endpoint="/api/v1/analyze/transaction",
                input_data={
                    "transaction_data": input_data.get("transaction"),
                    "customer_id": input_data.get("customer_id"),
                    "agent_id": input_data.get("agent_id"),
                    "analysis_type": "real_time"
                },
                timeout_seconds=30,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="balance_check",
                name="Balance Verification",
                service_name="tigerbeetle-edge",
                endpoint="/api/v1/balance",
                input_data={
                    "account_id": input_data.get("from_account"),
                    "amount": input_data.get("amount")
                },
                timeout_seconds=15,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="execute_transaction",
                name="Execute Transaction",
                service_name="tigerbeetle-edge",
                endpoint="/api/v1/transfers",
                input_data={
                    "from_account": input_data.get("from_account"),
                    "to_account": input_data.get("to_account"),
                    "amount": input_data.get("amount"),
                    "currency": input_data.get("currency", "NGN"),
                    "reference": input_data.get("reference")
                },
                timeout_seconds=60,
                retry_attempts=1
            ),
            WorkflowActivity(
                activity_id="send_notification",
                name="Send Transaction Notification",
                service_name="communication-core",
                endpoint="/api/v1/notify/transaction",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "transaction_type": input_data.get("transaction_type"),
                    "amount": input_data.get("amount"),
                    "status": "completed"
                },
                timeout_seconds=30,
                retry_attempts=3
            ),
            WorkflowActivity(
                activity_id="update_analytics",
                name="Update KYA Analytics",
                service_name="kya-analytics",
                endpoint="/api/v1/update/transaction",
                input_data={
                    "agent_id": input_data.get("agent_id"),
                    "transaction_data": input_data.get("transaction"),
                    "performance_metrics": True
                },
                timeout_seconds=45,
                retry_attempts=2
            )
        ]
        
        # Define dependencies
        dependencies = {
            "balance_check": ["fraud_check"],
            "execute_transaction": ["fraud_check", "balance_check"],
            "send_notification": ["execute_transaction"],
            "update_analytics": ["execute_transaction"]
        }
        
        return WorkflowDefinition(
            workflow_id=workflow_id,
            name="Payment Processing",
            description="Complete payment processing with fraud detection and notifications",
            activities=activities,
            dependencies=dependencies,
            timeout_seconds=600,  # 10 minutes
            created_at=datetime.now().isoformat()
        )
    
    def _create_insurance_claim_workflow(self, input_data: Dict[str, Any]) -> WorkflowDefinition:
        """Create insurance claim processing workflow"""
        workflow_id = f"insurance_claim_{uuid.uuid4().hex[:8]}"
        
        activities = [
            WorkflowActivity(
                activity_id="validate_claim_documents",
                name="Validate Claim Documents",
                service_name="document-analysis",
                endpoint="/api/v1/analyze/insurance_claim",
                input_data={
                    "claim_id": input_data.get("claim_id"),
                    "policy_number": input_data.get("policy_number"),
                    "documents": input_data.get("documents", []),
                    "claim_type": input_data.get("claim_type")
                },
                timeout_seconds=300,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="ai_assessment",
                name="AI Claim Assessment",
                service_name="insurance-suite",
                endpoint="/api/v1/assess/claim",
                input_data={
                    "claim_id": input_data.get("claim_id"),
                    "policy_data": input_data.get("policy_data"),
                    "claim_amount": input_data.get("claim_amount"),
                    "assessment_type": "comprehensive"
                },
                timeout_seconds=180,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="fraud_assessment",
                name="Insurance Fraud Check",
                service_name="fraud-detection",
                endpoint="/api/v1/analyze/insurance_fraud",
                input_data={
                    "claim_data": input_data,
                    "policy_history": input_data.get("policy_history", []),
                    "customer_history": input_data.get("customer_history", [])
                },
                timeout_seconds=120,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="compliance_review",
                name="Compliance Review",
                service_name="compliance-automation",
                endpoint="/api/v1/review/insurance_claim",
                input_data={
                    "claim_id": input_data.get("claim_id"),
                    "regulatory_requirements": input_data.get("regulatory_requirements", []),
                    "review_type": "standard"
                },
                timeout_seconds=240,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="process_payout",
                name="Process Insurance Payout",
                service_name="payment-orchestrator",
                endpoint="/api/v1/insurance/payout",
                input_data={
                    "claim_id": input_data.get("claim_id"),
                    "beneficiary_account": input_data.get("beneficiary_account"),
                    "payout_amount": input_data.get("approved_amount"),
                    "payment_method": input_data.get("payment_method", "bank_transfer")
                },
                timeout_seconds=300,
                retry_attempts=1
            ),
            WorkflowActivity(
                activity_id="notify_customer",
                name="Notify Customer",
                service_name="communication-core",
                endpoint="/api/v1/notify/insurance_claim_status",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "claim_id": input_data.get("claim_id"),
                    "status": "processed",
                    "payout_amount": input_data.get("approved_amount")
                },
                timeout_seconds=60,
                retry_attempts=3
            )
        ]
        
        # Define dependencies
        dependencies = {
            "ai_assessment": ["validate_claim_documents"],
            "fraud_assessment": ["validate_claim_documents"],
            "compliance_review": ["ai_assessment", "fraud_assessment"],
            "process_payout": ["compliance_review"],
            "notify_customer": ["process_payout"]
        }
        
        return WorkflowDefinition(
            workflow_id=workflow_id,
            name="Insurance Claim Processing",
            description="Complete insurance claim processing with AI assessment and fraud detection",
            activities=activities,
            dependencies=dependencies,
            timeout_seconds=2400,  # 40 minutes
            created_at=datetime.now().isoformat()
        )
    
    def _create_kyc_update_workflow(self, input_data: Dict[str, Any]) -> WorkflowDefinition:
        """Create KYC update workflow"""
        workflow_id = f"kyc_update_{uuid.uuid4().hex[:8]}"
        
        activities = [
            WorkflowActivity(
                activity_id="document_verification",
                name="Document Verification",
                service_name="document-analysis",
                endpoint="/api/v1/verify/kyc_documents",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "documents": input_data.get("updated_documents", []),
                    "verification_type": "kyc_update"
                },
                timeout_seconds=240,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="risk_assessment",
                name="Risk Assessment",
                service_name="fraud-detection",
                endpoint="/api/v1/assess/customer_risk",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "updated_information": input_data.get("updated_information"),
                    "assessment_type": "kyc_update"
                },
                timeout_seconds=180,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="compliance_update",
                name="Update Compliance Records",
                service_name="compliance-automation",
                endpoint="/api/v1/update/kyc_compliance",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "compliance_data": input_data.get("compliance_data"),
                    "update_type": "kyc_refresh"
                },
                timeout_seconds=120,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="notify_completion",
                name="Notify KYC Update Completion",
                service_name="communication-core",
                endpoint="/api/v1/notify/kyc_update",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "update_status": "completed",
                    "next_review_date": input_data.get("next_review_date")
                },
                timeout_seconds=45,
                retry_attempts=3
            )
        ]
        
        # Define dependencies
        dependencies = {
            "risk_assessment": ["document_verification"],
            "compliance_update": ["document_verification", "risk_assessment"],
            "notify_completion": ["compliance_update"]
        }
        
        return WorkflowDefinition(
            workflow_id=workflow_id,
            name="KYC Update",
            description="Customer KYC information update and compliance refresh",
            activities=activities,
            dependencies=dependencies,
            timeout_seconds=900,  # 15 minutes
            created_at=datetime.now().isoformat()
        )
    
    def _create_fraud_investigation_workflow(self, input_data: Dict[str, Any]) -> WorkflowDefinition:
        """Create fraud investigation workflow"""
        workflow_id = f"fraud_investigation_{uuid.uuid4().hex[:8]}"
        
        activities = [
            WorkflowActivity(
                activity_id="collect_evidence",
                name="Collect Evidence",
                service_name="fraud-detection",
                endpoint="/api/v1/investigate/collect_evidence",
                input_data={
                    "case_id": input_data.get("case_id"),
                    "transaction_ids": input_data.get("suspicious_transactions", []),
                    "customer_id": input_data.get("customer_id"),
                    "investigation_type": "comprehensive"
                },
                timeout_seconds=600,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="analyze_patterns",
                name="Analyze Fraud Patterns",
                service_name="kya-analytics",
                endpoint="/api/v1/analyze/fraud_patterns",
                input_data={
                    "case_id": input_data.get("case_id"),
                    "evidence_data": input_data.get("evidence_data"),
                    "analysis_depth": "deep"
                },
                timeout_seconds=300,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="generate_report",
                name="Generate Investigation Report",
                service_name="compliance-automation",
                endpoint="/api/v1/generate/fraud_report",
                input_data={
                    "case_id": input_data.get("case_id"),
                    "investigation_findings": input_data.get("findings"),
                    "report_type": "regulatory"
                },
                timeout_seconds=180,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="take_action",
                name="Take Remedial Action",
                service_name="compliance-automation",
                endpoint="/api/v1/action/fraud_response",
                input_data={
                    "case_id": input_data.get("case_id"),
                    "recommended_actions": input_data.get("recommended_actions", []),
                    "severity_level": input_data.get("severity", "medium")
                },
                timeout_seconds=240,
                retry_attempts=1
            )
        ]
        
        # Define dependencies
        dependencies = {
            "analyze_patterns": ["collect_evidence"],
            "generate_report": ["analyze_patterns"],
            "take_action": ["generate_report"]
        }
        
        return WorkflowDefinition(
            workflow_id=workflow_id,
            name="Fraud Investigation",
            description="Comprehensive fraud investigation and response workflow",
            activities=activities,
            dependencies=dependencies,
            timeout_seconds=1800,  # 30 minutes
            created_at=datetime.now().isoformat()
        )
    
    def _create_loan_application_workflow(self, input_data: Dict[str, Any]) -> WorkflowDefinition:
        """Create loan application processing workflow"""
        workflow_id = f"loan_application_{uuid.uuid4().hex[:8]}"
        
        activities = [
            WorkflowActivity(
                activity_id="verify_documents",
                name="Verify Loan Documents",
                service_name="document-analysis",
                endpoint="/api/v1/verify/loan_documents",
                input_data={
                    "application_id": input_data.get("application_id"),
                    "documents": input_data.get("documents", []),
                    "loan_type": input_data.get("loan_type")
                },
                timeout_seconds=300,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="credit_assessment",
                name="Credit Risk Assessment",
                service_name="kya-analytics",
                endpoint="/api/v1/assess/credit_risk",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "loan_amount": input_data.get("loan_amount"),
                    "financial_data": input_data.get("financial_data"),
                    "assessment_type": "comprehensive"
                },
                timeout_seconds=240,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="compliance_check",
                name="Regulatory Compliance Check",
                service_name="compliance-automation",
                endpoint="/api/v1/check/loan_compliance",
                input_data={
                    "application_id": input_data.get("application_id"),
                    "loan_details": input_data.get("loan_details"),
                    "regulatory_requirements": input_data.get("regulatory_requirements", [])
                },
                timeout_seconds=180,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="approve_loan",
                name="Process Loan Approval",
                service_name="payment-orchestrator",
                endpoint="/api/v1/loans/approve",
                input_data={
                    "application_id": input_data.get("application_id"),
                    "approved_amount": input_data.get("approved_amount"),
                    "terms": input_data.get("loan_terms"),
                    "disbursement_account": input_data.get("disbursement_account")
                },
                timeout_seconds=300,
                retry_attempts=1
            ),
            WorkflowActivity(
                activity_id="notify_customer",
                name="Notify Customer of Decision",
                service_name="communication-core",
                endpoint="/api/v1/notify/loan_decision",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "application_id": input_data.get("application_id"),
                    "decision": input_data.get("decision"),
                    "approved_amount": input_data.get("approved_amount")
                },
                timeout_seconds=60,
                retry_attempts=3
            )
        ]
        
        # Define dependencies
        dependencies = {
            "credit_assessment": ["verify_documents"],
            "compliance_check": ["verify_documents"],
            "approve_loan": ["credit_assessment", "compliance_check"],
            "notify_customer": ["approve_loan"]
        }
        
        return WorkflowDefinition(
            workflow_id=workflow_id,
            name="Loan Application Processing",
            description="Complete loan application processing with credit assessment",
            activities=activities,
            dependencies=dependencies,
            timeout_seconds=1500,  # 25 minutes
            created_at=datetime.now().isoformat()
        )
    
    def _create_account_closure_workflow(self, input_data: Dict[str, Any]) -> WorkflowDefinition:
        """Create account closure workflow"""
        workflow_id = f"account_closure_{uuid.uuid4().hex[:8]}"
        
        activities = [
            WorkflowActivity(
                activity_id="verify_closure_request",
                name="Verify Closure Request",
                service_name="document-analysis",
                endpoint="/api/v1/verify/closure_request",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "account_id": input_data.get("account_id"),
                    "closure_documents": input_data.get("closure_documents", [])
                },
                timeout_seconds=180,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="check_outstanding_obligations",
                name="Check Outstanding Obligations",
                service_name="tigerbeetle-edge",
                endpoint="/api/v1/obligations/check",
                input_data={
                    "account_id": input_data.get("account_id"),
                    "customer_id": input_data.get("customer_id")
                },
                timeout_seconds=120,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="process_final_settlement",
                name="Process Final Settlement",
                service_name="payment-orchestrator",
                endpoint="/api/v1/settlement/final",
                input_data={
                    "account_id": input_data.get("account_id"),
                    "settlement_account": input_data.get("settlement_account"),
                    "final_balance": input_data.get("final_balance")
                },
                timeout_seconds=300,
                retry_attempts=1
            ),
            WorkflowActivity(
                activity_id="close_account",
                name="Close Account",
                service_name="tigerbeetle-edge",
                endpoint="/api/v1/accounts/close",
                input_data={
                    "account_id": input_data.get("account_id"),
                    "closure_reason": input_data.get("closure_reason"),
                    "closure_date": datetime.now().isoformat()
                },
                timeout_seconds=120,
                retry_attempts=1
            ),
            WorkflowActivity(
                activity_id="notify_closure",
                name="Notify Account Closure",
                service_name="communication-core",
                endpoint="/api/v1/notify/account_closure",
                input_data={
                    "customer_id": input_data.get("customer_id"),
                    "account_id": input_data.get("account_id"),
                    "closure_confirmation": True
                },
                timeout_seconds=60,
                retry_attempts=3
            )
        ]
        
        # Define dependencies
        dependencies = {
            "check_outstanding_obligations": ["verify_closure_request"],
            "process_final_settlement": ["check_outstanding_obligations"],
            "close_account": ["process_final_settlement"],
            "notify_closure": ["close_account"]
        }
        
        return WorkflowDefinition(
            workflow_id=workflow_id,
            name="Account Closure",
            description="Complete account closure process with final settlement",
            activities=activities,
            dependencies=dependencies,
            timeout_seconds=1200,  # 20 minutes
            created_at=datetime.now().isoformat()
        )
    
    def _create_compliance_audit_workflow(self, input_data: Dict[str, Any]) -> WorkflowDefinition:
        """Create compliance audit workflow"""
        workflow_id = f"compliance_audit_{uuid.uuid4().hex[:8]}"
        
        activities = [
            WorkflowActivity(
                activity_id="collect_audit_data",
                name="Collect Audit Data",
                service_name="compliance-automation",
                endpoint="/api/v1/audit/collect_data",
                input_data={
                    "audit_id": input_data.get("audit_id"),
                    "audit_scope": input_data.get("audit_scope"),
                    "date_range": input_data.get("date_range")
                },
                timeout_seconds=600,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="analyze_transactions",
                name="Analyze Transactions",
                service_name="kya-analytics",
                endpoint="/api/v1/analyze/compliance_transactions",
                input_data={
                    "audit_id": input_data.get("audit_id"),
                    "transaction_data": input_data.get("transaction_data"),
                    "compliance_rules": input_data.get("compliance_rules", [])
                },
                timeout_seconds=480,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="generate_audit_report",
                name="Generate Audit Report",
                service_name="compliance-automation",
                endpoint="/api/v1/generate/audit_report",
                input_data={
                    "audit_id": input_data.get("audit_id"),
                    "findings": input_data.get("findings"),
                    "report_type": "regulatory_audit"
                },
                timeout_seconds=300,
                retry_attempts=2
            ),
            WorkflowActivity(
                activity_id="submit_regulatory_report",
                name="Submit Regulatory Report",
                service_name="compliance-automation",
                endpoint="/api/v1/submit/regulatory_report",
                input_data={
                    "audit_id": input_data.get("audit_id"),
                    "report_data": input_data.get("report_data"),
                    "regulatory_body": input_data.get("regulatory_body", "CBN")
                },
                timeout_seconds=180,
                retry_attempts=2
            )
        ]
        
        # Define dependencies
        dependencies = {
            "analyze_transactions": ["collect_audit_data"],
            "generate_audit_report": ["analyze_transactions"],
            "submit_regulatory_report": ["generate_audit_report"]
        }
        
        return WorkflowDefinition(
            workflow_id=workflow_id,
            name="Compliance Audit",
            description="Comprehensive compliance audit and regulatory reporting",
            activities=activities,
            dependencies=dependencies,
            timeout_seconds=2400,  # 40 minutes
            created_at=datetime.now().isoformat()
        )
    
    async def start_workflow(self, workflow_type: str, input_data: Dict[str, Any]) -> str:
        """Start a new workflow"""
        try:
            if workflow_type not in self.workflow_templates:
                raise ValueError(f"Unknown workflow type: {workflow_type}")
            
            # Create workflow definition
            workflow = self.workflow_templates[workflow_type](input_data)
            workflow.status = WorkflowStatus.RUNNING
            workflow.started_at = datetime.now().isoformat()
            
            # Add to active workflows
            self.active_workflows[workflow.workflow_id] = workflow
            
            # Start workflow execution
            asyncio.create_task(self._execute_workflow(workflow))
            
            logger.info(f"Started workflow {workflow.workflow_id} of type {workflow_type}")
            return workflow.workflow_id
            
        except Exception as e:
            logger.error(f"Failed to start workflow {workflow_type}: {e}")
            raise
    
    async def _execute_workflow(self, workflow: WorkflowDefinition):
        """Execute workflow activities based on dependencies"""
        try:
            completed_activities = set()
            
            while len(completed_activities) < len(workflow.activities):
                # Find activities that can be executed (dependencies satisfied)
                ready_activities = []
                
                for activity in workflow.activities:
                    if activity.activity_id in completed_activities:
                        continue
                    
                    if activity.status in [ActivityStatus.RUNNING, ActivityStatus.RETRYING]:
                        continue
                    
                    # Check if dependencies are satisfied
                    dependencies = workflow.dependencies.get(activity.activity_id, [])
                    if all(dep in completed_activities for dep in dependencies):
                        ready_activities.append(activity)
                
                # Execute ready activities in parallel
                if ready_activities:
                    tasks = []
                    for activity in ready_activities:
                        task = asyncio.create_task(self._execute_activity(activity))
                        tasks.append(task)
                    
                    # Wait for all activities to complete
                    results = await asyncio.gather(*tasks, return_exceptions=True)
                    
                    # Process results
                    for i, result in enumerate(results):
                        activity = ready_activities[i]
                        if isinstance(result, Exception):
                            activity.status = ActivityStatus.FAILED
                            activity.error = str(result)
                            logger.error(f"Activity {activity.activity_id} failed: {result}")
                        else:
                            activity.status = ActivityStatus.COMPLETED
                            activity.result = result
                            activity.completed_at = datetime.now().isoformat()
                            completed_activities.add(activity.activity_id)
                            logger.info(f"Activity {activity.activity_id} completed successfully")
                
                # Check for failed activities
                failed_activities = [a for a in workflow.activities if a.status == ActivityStatus.FAILED]
                if failed_activities:
                    workflow.status = WorkflowStatus.FAILED
                    workflow.error = f"Activities failed: {[a.activity_id for a in failed_activities]}"
                    workflow.completed_at = datetime.now().isoformat()
                    break
                
                # Check for timeout
                if workflow.started_at:
                    start_time = datetime.fromisoformat(workflow.started_at)
                    if (datetime.now() - start_time).total_seconds() > workflow.timeout_seconds:
                        workflow.status = WorkflowStatus.TIMEOUT
                        workflow.error = "Workflow timeout exceeded"
                        workflow.completed_at = datetime.now().isoformat()
                        break
                
                # Small delay to prevent busy waiting
                await asyncio.sleep(1)
            
            # Mark workflow as completed if all activities succeeded
            if workflow.status == WorkflowStatus.RUNNING:
                workflow.status = WorkflowStatus.COMPLETED
                workflow.completed_at = datetime.now().isoformat()
                workflow.result = {
                    "activities_completed": len(completed_activities),
                    "total_activities": len(workflow.activities),
                    "execution_time_seconds": (
                        datetime.fromisoformat(workflow.completed_at) - 
                        datetime.fromisoformat(workflow.started_at)
                    ).total_seconds()
                }
            
            # Move to completed workflows
            if workflow.workflow_id in self.active_workflows:
                del self.active_workflows[workflow.workflow_id]
                self.completed_workflows[workflow.workflow_id] = workflow
            
            logger.info(f"Workflow {workflow.workflow_id} completed with status: {workflow.status}")
            
        except Exception as e:
            workflow.status = WorkflowStatus.FAILED
            workflow.error = str(e)
            workflow.completed_at = datetime.now().isoformat()
            logger.error(f"Workflow {workflow.workflow_id} execution failed: {e}")
    
    async def _execute_activity(self, activity: WorkflowActivity) -> Dict[str, Any]:
        """Execute a single activity"""
        activity.status = ActivityStatus.RUNNING
        activity.started_at = datetime.now().isoformat()
        
        for attempt in range(activity.retry_attempts):
            try:
                activity.attempt_count = attempt + 1
                
                # Get service configuration
                service_config = self.banking_services.get(activity.service_name)
                if not service_config:
                    raise ValueError(f"Unknown service: {activity.service_name}")
                
                # Make Dapr service invocation
                dapr_url = f"{self.dapr_base_url}/v1.0/invoke/{service_config['app_id']}/method{activity.endpoint}"
                
                response = requests.post(
                    dapr_url,
                    json=activity.input_data,
                    timeout=activity.timeout_seconds,
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    result = response.json()
                    activity.status = ActivityStatus.COMPLETED
                    activity.completed_at = datetime.now().isoformat()
                    return result
                else:
                    raise Exception(f"Service returned status {response.status_code}: {response.text}")
                    
            except Exception as e:
                if attempt < activity.retry_attempts - 1:
                    activity.status = ActivityStatus.RETRYING
                    logger.warning(f"Activity {activity.activity_id} attempt {attempt + 1} failed: {e}. Retrying...")
                    await asyncio.sleep(activity.retry_delay_seconds)
                else:
                    activity.status = ActivityStatus.FAILED
                    activity.error = str(e)
                    activity.completed_at = datetime.now().isoformat()
                    raise e
    
    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow status"""
        workflow = self.active_workflows.get(workflow_id) or self.completed_workflows.get(workflow_id)
        if not workflow:
            return None
        
        return {
            "workflow_id": workflow.workflow_id,
            "name": workflow.name,
            "status": workflow.status.value,
            "created_at": workflow.created_at,
            "started_at": workflow.started_at,
            "completed_at": workflow.completed_at,
            "activities": [
                {
                    "activity_id": activity.activity_id,
                    "name": activity.name,
                    "status": activity.status.value,
                    "started_at": activity.started_at,
                    "completed_at": activity.completed_at,
                    "attempt_count": activity.attempt_count,
                    "error": activity.error
                }
                for activity in workflow.activities
            ],
            "result": workflow.result,
            "error": workflow.error
        }
    
    def list_workflows(self) -> Dict[str, List[Dict[str, Any]]]:
        """List all workflows"""
        active = [
            {
                "workflow_id": wf.workflow_id,
                "name": wf.name,
                "status": wf.status.value,
                "started_at": wf.started_at
            }
            for wf in self.active_workflows.values()
        ]
        
        completed = [
            {
                "workflow_id": wf.workflow_id,
                "name": wf.name,
                "status": wf.status.value,
                "completed_at": wf.completed_at
            }
            for wf in self.completed_workflows.values()
        ]
        
        return {
            "active_workflows": active,
            "completed_workflows": completed
        }

# Flask application for Dapr workflow engine
app = Flask(__name__)
CORS(app, origins="*")

# Initialize workflow engine
workflow_engine = DaprWorkflowEngine()

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "Dapr Workflow Engine",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/workflows/start', methods=['POST'])
async def start_workflow():
    """Start a new workflow"""
    try:
        data = request.get_json()
        workflow_type = data.get('workflow_type')
        input_data = data.get('input_data', {})
        
        if not workflow_type:
            return jsonify({"error": "Workflow type is required"}), 400
        
        workflow_id = await workflow_engine.start_workflow(workflow_type, input_data)
        
        return jsonify({
            "status": "success",
            "workflow_id": workflow_id,
            "message": f"Workflow {workflow_type} started successfully",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/workflows/<workflow_id>/status', methods=['GET'])
def get_workflow_status(workflow_id):
    """Get workflow status"""
    try:
        status = workflow_engine.get_workflow_status(workflow_id)
        if not status:
            return jsonify({"error": "Workflow not found"}), 404
        
        return jsonify(status)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/workflows', methods=['GET'])
def list_workflows():
    """List all workflows"""
    try:
        workflows = workflow_engine.list_workflows()
        return jsonify(workflows)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/workflows/templates', methods=['GET'])
def list_workflow_templates():
    """List available workflow templates"""
    templates = [
        {
            "name": "agent_onboarding",
            "description": "Complete agent onboarding process with KYB verification",
            "estimated_duration": "30 minutes",
            "activities": 6
        },
        {
            "name": "payment_processing",
            "description": "Complete payment processing with fraud detection",
            "estimated_duration": "10 minutes",
            "activities": 5
        },
        {
            "name": "insurance_claim_processing",
            "description": "Insurance claim processing with AI assessment",
            "estimated_duration": "40 minutes",
            "activities": 6
        },
        {
            "name": "kyc_update",
            "description": "Customer KYC information update",
            "estimated_duration": "15 minutes",
            "activities": 4
        },
        {
            "name": "fraud_investigation",
            "description": "Comprehensive fraud investigation workflow",
            "estimated_duration": "30 minutes",
            "activities": 4
        },
        {
            "name": "loan_application",
            "description": "Loan application processing with credit assessment",
            "estimated_duration": "25 minutes",
            "activities": 5
        },
        {
            "name": "account_closure",
            "description": "Account closure process with final settlement",
            "estimated_duration": "20 minutes",
            "activities": 5
        },
        {
            "name": "compliance_audit",
            "description": "Compliance audit and regulatory reporting",
            "estimated_duration": "40 minutes",
            "activities": 4
        }
    ]
    
    return jsonify({
        "workflow_templates": templates,
        "total_templates": len(templates)
    })

if __name__ == '__main__':
    print("🚀 Starting Dapr Workflow Engine...")
    print("🔄 Workflow Templates: Agent Onboarding, Payment Processing, Insurance Claims, KYC Updates")
    print("🌐 Server: http://localhost:8201")
    print("=" * 80)
    
    app.run(host='0.0.0.0', port=8201, debug=False)

