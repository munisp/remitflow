#!/usr/bin/env python3
"""
Float Regulatory Compliance Framework
Comprehensive compliance monitoring and reporting for agent float facilities
"""

import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from uuid import UUID, uuid4
import json
from decimal import Decimal
from enum import Enum
import hashlib

import uvicorn
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
import redis
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from starlette.responses import Response
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
import io
import zipfile

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Metrics
compliance_checks_total = Counter('compliance_checks_total', 'Total compliance checks performed')
compliance_violations = Counter('compliance_violations_total', 'Total compliance violations detected')
regulatory_reports_generated = Counter('regulatory_reports_generated_total', 'Total regulatory reports generated')
audit_trail_entries = Counter('audit_trail_entries_total', 'Total audit trail entries created')

# FastAPI app
app = FastAPI(
    title="Float Regulatory Compliance Framework",
    description="Comprehensive compliance monitoring and reporting for agent float facilities",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# ENUMS AND MODELS
# ==========================================

class ComplianceStatus(str, Enum):
    COMPLIANT = "compliant"
    NON_COMPLIANT = "non_compliant"
    UNDER_REVIEW = "under_review"
    REMEDIATION_REQUIRED = "remediation_required"

class ViolationType(str, Enum):
    LENDING_LIMIT = "lending_limit_violation"
    CAPITAL_ADEQUACY = "capital_adequacy_violation"
    LIQUIDITY_RATIO = "liquidity_ratio_violation"
    CONCENTRATION_RISK = "concentration_risk_violation"
    AML_SUSPICIOUS = "aml_suspicious_activity"
    KYC_INCOMPLETE = "kyc_incomplete"
    REPORTING_DELAY = "reporting_delay"
    INTEREST_RATE = "interest_rate_violation"
    DOCUMENTATION = "documentation_incomplete"

class RegulatoryFramework(str, Enum):
    CBN_NIGERIA = "cbn_nigeria"
    BASEL_III = "basel_iii"
    FATF_AML = "fatf_aml"
    GDPR = "gdpr"
    PCI_DSS = "pci_dss"
    SOX = "sox"

class ReportType(str, Enum):
    DAILY_POSITION = "daily_position_report"
    WEEKLY_SUMMARY = "weekly_summary_report"
    MONTHLY_COMPLIANCE = "monthly_compliance_report"
    QUARTERLY_RISK = "quarterly_risk_report"
    ANNUAL_AUDIT = "annual_audit_report"
    INCIDENT_REPORT = "incident_report"
    REGULATORY_FILING = "regulatory_filing"

# ==========================================
# DATA MODELS
# ==========================================

class ComplianceCheck(BaseModel):
    check_id: str = Field(..., description="Unique check identifier")
    check_type: str = Field(..., description="Type of compliance check")
    framework: RegulatoryFramework = Field(..., description="Regulatory framework")
    agent_id: Optional[str] = Field(None, description="Agent ID if agent-specific")
    check_date: datetime = Field(default_factory=datetime.now)
    status: ComplianceStatus = Field(..., description="Compliance status")
    score: float = Field(..., ge=0, le=100, description="Compliance score")
    violations: List[str] = Field(default_factory=list, description="List of violations")
    recommendations: List[str] = Field(default_factory=list, description="Remediation recommendations")
    next_check_date: datetime = Field(..., description="Next scheduled check")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

class ComplianceViolation(BaseModel):
    violation_id: str = Field(..., description="Unique violation identifier")
    violation_type: ViolationType = Field(..., description="Type of violation")
    severity: str = Field(..., regex="^(low|medium|high|critical)$", description="Violation severity")
    agent_id: Optional[str] = Field(None, description="Agent ID if applicable")
    description: str = Field(..., description="Violation description")
    detected_date: datetime = Field(default_factory=datetime.now)
    resolution_deadline: datetime = Field(..., description="Resolution deadline")
    status: str = Field(default="open", description="Violation status")
    remediation_actions: List[str] = Field(default_factory=list, description="Required actions")
    resolved_date: Optional[datetime] = Field(None, description="Resolution date")
    resolved_by: Optional[str] = Field(None, description="Resolved by user ID")

class RegulatoryReport(BaseModel):
    report_id: str = Field(..., description="Unique report identifier")
    report_type: ReportType = Field(..., description="Type of report")
    framework: RegulatoryFramework = Field(..., description="Regulatory framework")
    reporting_period_start: datetime = Field(..., description="Reporting period start")
    reporting_period_end: datetime = Field(..., description="Reporting period end")
    generated_date: datetime = Field(default_factory=datetime.now)
    generated_by: str = Field(..., description="Generated by user ID")
    status: str = Field(default="draft", description="Report status")
    file_path: Optional[str] = Field(None, description="Report file path")
    submission_date: Optional[datetime] = Field(None, description="Submission date")
    acknowledgment_ref: Optional[str] = Field(None, description="Regulatory acknowledgment reference")

class AuditTrailEntry(BaseModel):
    entry_id: str = Field(..., description="Unique entry identifier")
    timestamp: datetime = Field(default_factory=datetime.now)
    user_id: str = Field(..., description="User ID performing action")
    action_type: str = Field(..., description="Type of action")
    resource_type: str = Field(..., description="Type of resource affected")
    resource_id: str = Field(..., description="Resource identifier")
    old_values: Optional[Dict[str, Any]] = Field(None, description="Previous values")
    new_values: Optional[Dict[str, Any]] = Field(None, description="New values")
    ip_address: Optional[str] = Field(None, description="User IP address")
    user_agent: Optional[str] = Field(None, description="User agent string")
    session_id: Optional[str] = Field(None, description="Session identifier")

# ==========================================
# REGULATORY COMPLIANCE ENGINE
# ==========================================

class RegulatoryComplianceEngine:
    def __init__(self):
        self.db_engine = None
        self.redis_client = None
        self.compliance_rules = {}
        self.regulatory_limits = {}
        
    async def initialize(self):
        """Initialize database connections and compliance rules"""
        await self._init_database()
        await self._init_redis()
        await self._load_compliance_rules()
        await self._load_regulatory_limits()
        logger.info("Regulatory Compliance Engine initialized successfully")
    
    async def _init_database(self):
        """Initialize database connection"""
        db_url = (
            f"postgresql://{os.getenv('DB_USER', 'postgres')}:"
            f"{os.getenv('DB_PASSWORD', 'password')}@"
            f"{os.getenv('DB_HOST', 'localhost')}:"
            f"{os.getenv('DB_PORT', '5432')}/"
            f"{os.getenv('DB_NAME', 'remittance')}"
        )
        self.db_engine = create_engine(db_url)
        logger.info("Database connection initialized")
    
    async def _init_redis(self):
        """Initialize Redis connection"""
        self.redis_client = redis.Redis(
            host=os.getenv('REDIS_HOST', 'localhost'),
            port=int(os.getenv('REDIS_PORT', '6379')),
            password=os.getenv('REDIS_PASSWORD', ''),
            decode_responses=True
        )
        logger.info("Redis connection initialized")
    
    async def _load_compliance_rules(self):
        """Load compliance rules and regulations"""
        self.compliance_rules = {
            # CBN Nigeria Regulations
            'cbn_lending_limits': {
                'max_single_agent_exposure': 0.20,  # 20% of capital
                'max_total_float_exposure': 0.80,   # 80% of deposits
                'min_capital_adequacy_ratio': 0.15,  # 15%
                'max_concentration_risk': 0.25,     # 25% to single sector
            },
            
            # Basel III Requirements
            'basel_iii_ratios': {
                'min_tier1_capital_ratio': 0.06,    # 6%
                'min_total_capital_ratio': 0.08,    # 8%
                'min_leverage_ratio': 0.03,         # 3%
                'min_liquidity_coverage_ratio': 1.0, # 100%
            },
            
            # AML/CFT Requirements
            'aml_requirements': {
                'max_cash_transaction_limit': 5000000,  # ₦5M
                'suspicious_activity_threshold': 10000000,  # ₦10M
                'kyc_refresh_period_months': 12,
                'transaction_monitoring_period_days': 30,
            },
            
            # Interest Rate Regulations
            'interest_rate_limits': {
                'max_annual_interest_rate': 0.30,    # 30%
                'max_penalty_rate': 0.05,           # 5%
                'min_grace_period_days': 3,
            },
            
            # Reporting Requirements
            'reporting_deadlines': {
                'daily_position_hours': 24,
                'weekly_summary_days': 7,
                'monthly_compliance_days': 15,
                'quarterly_risk_days': 30,
            }
        }
        logger.info("Compliance rules loaded")
    
    async def _load_regulatory_limits(self):
        """Load regulatory limits from database"""
        try:
            query = text("""
                SELECT 
                    SUM(float_limit) as total_float_limit,
                    SUM(utilized_amount) as total_utilized,
                    COUNT(*) as total_agents,
                    AVG(interest_rate) as avg_interest_rate
                FROM agent_floats 
                WHERE status = 'active'
            """)
            
            with self.db_engine.connect() as conn:
                result = conn.execute(query).fetchone()
                if result:
                    self.regulatory_limits = {
                        'total_float_limit': float(result.total_float_limit or 0),
                        'total_utilized': float(result.total_utilized or 0),
                        'total_agents': int(result.total_agents or 0),
                        'avg_interest_rate': float(result.avg_interest_rate or 0),
                    }
        except Exception as e:
            logger.error(f"Failed to load regulatory limits: {e}")
            self.regulatory_limits = {}
    
    async def perform_compliance_check(self, framework: RegulatoryFramework, 
                                     agent_id: Optional[str] = None) -> ComplianceCheck:
        """Perform comprehensive compliance check"""
        
        check_id = f"CC_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{framework.value}"
        if agent_id:
            check_id += f"_{agent_id[:8]}"
        
        violations = []
        recommendations = []
        score = 100.0
        
        try:
            if framework == RegulatoryFramework.CBN_NIGERIA:
                violations, recommendations, score = await self._check_cbn_compliance(agent_id)
            elif framework == RegulatoryFramework.BASEL_III:
                violations, recommendations, score = await self._check_basel_compliance(agent_id)
            elif framework == RegulatoryFramework.FATF_AML:
                violations, recommendations, score = await self._check_aml_compliance(agent_id)
            elif framework == RegulatoryFramework.GDPR:
                violations, recommendations, score = await self._check_gdpr_compliance(agent_id)
            else:
                violations, recommendations, score = await self._check_general_compliance(agent_id)
            
            # Determine compliance status
            if score >= 90:
                status = ComplianceStatus.COMPLIANT
            elif score >= 70:
                status = ComplianceStatus.UNDER_REVIEW
            else:
                status = ComplianceStatus.NON_COMPLIANT
            
            # Create compliance check record
            compliance_check = ComplianceCheck(
                check_id=check_id,
                check_type=f"{framework.value}_compliance",
                framework=framework,
                agent_id=agent_id,
                status=status,
                score=score,
                violations=violations,
                recommendations=recommendations,
                next_check_date=datetime.now() + timedelta(days=30),
                metadata={
                    'total_violations': len(violations),
                    'regulatory_limits': self.regulatory_limits,
                    'check_duration_seconds': 0.5,  # Simulated
                }
            )
            
            # Log violations if any
            for violation in violations:
                await self._log_compliance_violation(violation, agent_id, framework)
            
            # Update metrics
            compliance_checks_total.inc()
            if violations:
                compliance_violations.inc(len(violations))
            
            return compliance_check
            
        except Exception as e:
            logger.error(f"Compliance check failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    async def _check_cbn_compliance(self, agent_id: Optional[str]) -> tuple:
        """Check CBN Nigeria compliance"""
        violations = []
        recommendations = []
        score = 100.0
        
        # Check lending limits
        if self.regulatory_limits.get('total_utilized', 0) > 0:
            utilization_ratio = (
                self.regulatory_limits['total_utilized'] / 
                max(self.regulatory_limits.get('total_float_limit', 1), 1)
            )
            
            if utilization_ratio > self.compliance_rules['cbn_lending_limits']['max_total_float_exposure']:
                violations.append("Total float exposure exceeds CBN limit of 80%")
                recommendations.append("Reduce total float exposure or increase capital base")
                score -= 20
        
        # Check interest rate compliance
        avg_rate = self.regulatory_limits.get('avg_interest_rate', 0)
        max_rate = self.compliance_rules['interest_rate_limits']['max_annual_interest_rate']
        
        if avg_rate > max_rate:
            violations.append(f"Average interest rate {avg_rate:.2%} exceeds maximum {max_rate:.2%}")
            recommendations.append("Reduce interest rates to comply with CBN guidelines")
            score -= 15
        
        # Check agent-specific compliance if agent_id provided
        if agent_id:
            agent_violations, agent_recommendations, agent_score_deduction = await self._check_agent_cbn_compliance(agent_id)
            violations.extend(agent_violations)
            recommendations.extend(agent_recommendations)
            score -= agent_score_deduction
        
        return violations, recommendations, max(0, score)
    
    async def _check_agent_cbn_compliance(self, agent_id: str) -> tuple:
        """Check agent-specific CBN compliance"""
        violations = []
        recommendations = []
        score_deduction = 0
        
        try:
            # Get agent float data
            query = text("""
                SELECT af.*, ao.kyc_verified, ao.status as agent_status
                FROM agent_floats af
                JOIN agent_onboarding ao ON af.agent_id = ao.agent_id
                WHERE af.agent_id = :agent_id
            """)
            
            with self.db_engine.connect() as conn:
                result = conn.execute(query, {"agent_id": agent_id}).fetchone()
                
                if result:
                    # Check KYC compliance
                    if not result.kyc_verified:
                        violations.append("KYC verification incomplete")
                        recommendations.append("Complete KYC verification process")
                        score_deduction += 10
                    
                    # Check float utilization
                    if result.utilized_amount > result.float_limit:
                        violations.append("Float utilization exceeds approved limit")
                        recommendations.append("Settle outstanding float or request limit increase")
                        score_deduction += 15
                    
                    # Check interest rate
                    if result.interest_rate > self.compliance_rules['interest_rate_limits']['max_annual_interest_rate']:
                        violations.append("Interest rate exceeds regulatory maximum")
                        recommendations.append("Adjust interest rate to comply with regulations")
                        score_deduction += 10
                        
        except Exception as e:
            logger.error(f"Agent CBN compliance check failed: {e}")
            violations.append("Unable to verify agent compliance data")
            score_deduction += 5
        
        return violations, recommendations, score_deduction
    
    async def _check_basel_compliance(self, agent_id: Optional[str]) -> tuple:
        """Check Basel III compliance"""
        violations = []
        recommendations = []
        score = 100.0
        
        # Simulate Basel III checks
        # In production, this would calculate actual capital ratios
        
        # Capital adequacy ratio check
        simulated_capital_ratio = 0.12  # 12%
        min_ratio = self.compliance_rules['basel_iii_ratios']['min_total_capital_ratio']
        
        if simulated_capital_ratio < min_ratio:
            violations.append(f"Capital adequacy ratio {simulated_capital_ratio:.2%} below minimum {min_ratio:.2%}")
            recommendations.append("Increase capital base or reduce risk-weighted assets")
            score -= 25
        
        # Liquidity coverage ratio check
        simulated_lcr = 0.95  # 95%
        min_lcr = self.compliance_rules['basel_iii_ratios']['min_liquidity_coverage_ratio']
        
        if simulated_lcr < min_lcr:
            violations.append(f"Liquidity coverage ratio {simulated_lcr:.2%} below minimum {min_lcr:.2%}")
            recommendations.append("Increase high-quality liquid assets")
            score -= 20
        
        return violations, recommendations, max(0, score)
    
    async def _check_aml_compliance(self, agent_id: Optional[str]) -> tuple:
        """Check AML/CFT compliance"""
        violations = []
        recommendations = []
        score = 100.0
        
        try:
            # Check for suspicious transactions
            query = text("""
                SELECT COUNT(*) as suspicious_count
                FROM transactions 
                WHERE amount > :threshold 
                AND created_at > NOW() - INTERVAL '30 days'
                AND (:agent_id IS NULL OR agent_id = :agent_id)
            """)
            
            threshold = self.compliance_rules['aml_requirements']['suspicious_activity_threshold']
            
            with self.db_engine.connect() as conn:
                result = conn.execute(query, {
                    "threshold": threshold,
                    "agent_id": agent_id
                }).fetchone()
                
                if result and result.suspicious_count > 0:
                    violations.append(f"{result.suspicious_count} transactions above suspicious activity threshold")
                    recommendations.append("Review high-value transactions and file STRs if necessary")
                    score -= 15
            
            # Check KYC refresh compliance
            if agent_id:
                kyc_query = text("""
                    SELECT kyc_verified, kyc_verified_date
                    FROM agent_onboarding 
                    WHERE agent_id = :agent_id
                """)
                
                with self.db_engine.connect() as conn:
                    result = conn.execute(kyc_query, {"agent_id": agent_id}).fetchone()
                    
                    if result and result.kyc_verified_date:
                        months_since_kyc = (datetime.now() - result.kyc_verified_date).days / 30
                        refresh_period = self.compliance_rules['aml_requirements']['kyc_refresh_period_months']
                        
                        if months_since_kyc > refresh_period:
                            violations.append("KYC refresh overdue")
                            recommendations.append("Perform KYC refresh within regulatory timeline")
                            score -= 10
                            
        except Exception as e:
            logger.error(f"AML compliance check failed: {e}")
            violations.append("Unable to complete AML compliance verification")
            score -= 5
        
        return violations, recommendations, max(0, score)
    
    async def _check_gdpr_compliance(self, agent_id: Optional[str]) -> tuple:
        """Check GDPR compliance"""
        violations = []
        recommendations = []
        score = 100.0
        
        # Simulate GDPR compliance checks
        # In production, this would check data processing consents, retention policies, etc.
        
        if agent_id:
            # Check data retention compliance
            query = text("""
                SELECT COUNT(*) as old_data_count
                FROM agent_onboarding 
                WHERE agent_id = :agent_id 
                AND created_at < NOW() - INTERVAL '7 years'
            """)
            
            try:
                with self.db_engine.connect() as conn:
                    result = conn.execute(query, {"agent_id": agent_id}).fetchone()
                    
                    if result and result.old_data_count > 0:
                        violations.append("Data retention period exceeded")
                        recommendations.append("Review and purge data beyond retention period")
                        score -= 10
                        
            except Exception as e:
                logger.error(f"GDPR compliance check failed: {e}")
        
        return violations, recommendations, max(0, score)
    
    async def _check_general_compliance(self, agent_id: Optional[str]) -> tuple:
        """Check general compliance requirements"""
        violations = []
        recommendations = []
        score = 100.0
        
        # Check reporting compliance
        # This would check if required reports are submitted on time
        
        return violations, recommendations, score
    
    async def _log_compliance_violation(self, violation: str, agent_id: Optional[str], 
                                      framework: RegulatoryFramework):
        """Log compliance violation"""
        
        violation_id = f"CV_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hashlib.md5(violation.encode()).hexdigest()[:8]}"
        
        # Determine violation type and severity
        violation_type, severity = self._classify_violation(violation)
        
        violation_record = ComplianceViolation(
            violation_id=violation_id,
            violation_type=violation_type,
            severity=severity,
            agent_id=agent_id,
            description=violation,
            resolution_deadline=datetime.now() + timedelta(days=self._get_resolution_days(severity)),
            remediation_actions=self._get_remediation_actions(violation_type)
        )
        
        # Store violation record (in production, this would be stored in database)
        logger.warning(f"Compliance violation logged: {violation_record.dict()}")
    
    def _classify_violation(self, violation: str) -> tuple:
        """Classify violation type and severity"""
        
        violation_lower = violation.lower()
        
        # Determine violation type
        if 'kyc' in violation_lower:
            violation_type = ViolationType.KYC_INCOMPLETE
        elif 'interest rate' in violation_lower:
            violation_type = ViolationType.INTEREST_RATE
        elif 'lending limit' in violation_lower or 'exposure' in violation_lower:
            violation_type = ViolationType.LENDING_LIMIT
        elif 'capital' in violation_lower:
            violation_type = ViolationType.CAPITAL_ADEQUACY
        elif 'liquidity' in violation_lower:
            violation_type = ViolationType.LIQUIDITY_RATIO
        elif 'suspicious' in violation_lower:
            violation_type = ViolationType.AML_SUSPICIOUS
        else:
            violation_type = ViolationType.DOCUMENTATION
        
        # Determine severity
        if 'exceeds' in violation_lower or 'overdue' in violation_lower:
            severity = 'high'
        elif 'incomplete' in violation_lower or 'missing' in violation_lower:
            severity = 'medium'
        else:
            severity = 'low'
        
        return violation_type, severity
    
    def _get_resolution_days(self, severity: str) -> int:
        """Get resolution deadline days based on severity"""
        return {
            'critical': 1,
            'high': 3,
            'medium': 7,
            'low': 14
        }.get(severity, 7)
    
    def _get_remediation_actions(self, violation_type: ViolationType) -> List[str]:
        """Get remediation actions for violation type"""
        
        actions_map = {
            ViolationType.KYC_INCOMPLETE: [
                "Complete KYC verification process",
                "Update customer documentation",
                "Verify identity documents"
            ],
            ViolationType.INTEREST_RATE: [
                "Review and adjust interest rates",
                "Ensure compliance with regulatory limits",
                "Update rate calculation methodology"
            ],
            ViolationType.LENDING_LIMIT: [
                "Reduce exposure to comply with limits",
                "Increase capital base if necessary",
                "Implement exposure monitoring controls"
            ],
            ViolationType.CAPITAL_ADEQUACY: [
                "Increase capital reserves",
                "Reduce risk-weighted assets",
                "Review capital allocation strategy"
            ],
            ViolationType.AML_SUSPICIOUS: [
                "Investigate suspicious transactions",
                "File Suspicious Transaction Reports (STRs)",
                "Enhance transaction monitoring"
            ]
        }
        
        return actions_map.get(violation_type, ["Review and remediate violation"])
    
    async def generate_regulatory_report(self, report_type: ReportType, 
                                       framework: RegulatoryFramework,
                                       period_start: datetime,
                                       period_end: datetime,
                                       generated_by: str) -> RegulatoryReport:
        """Generate regulatory report"""
        
        report_id = f"RR_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{report_type.value}"
        
        try:
            # Generate report data
            report_data = await self._generate_report_data(report_type, framework, period_start, period_end)
            
            # Create report file
            file_path = await self._create_report_file(report_id, report_type, report_data)
            
            # Create report record
            report = RegulatoryReport(
                report_id=report_id,
                report_type=report_type,
                framework=framework,
                reporting_period_start=period_start,
                reporting_period_end=period_end,
                generated_by=generated_by,
                file_path=file_path
            )
            
            # Update metrics
            regulatory_reports_generated.inc()
            
            return report
            
        except Exception as e:
            logger.error(f"Report generation failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    async def _generate_report_data(self, report_type: ReportType, framework: RegulatoryFramework,
                                  period_start: datetime, period_end: datetime) -> Dict:
        """Generate report data based on type and framework"""
        
        data = {
            'report_metadata': {
                'report_type': report_type.value,
                'framework': framework.value,
                'period_start': period_start.isoformat(),
                'period_end': period_end.isoformat(),
                'generated_date': datetime.now().isoformat()
            }
        }
        
        try:
            if report_type == ReportType.DAILY_POSITION:
                data.update(await self._generate_daily_position_data(period_start, period_end))
            elif report_type == ReportType.MONTHLY_COMPLIANCE:
                data.update(await self._generate_monthly_compliance_data(period_start, period_end))
            elif report_type == ReportType.QUARTERLY_RISK:
                data.update(await self._generate_quarterly_risk_data(period_start, period_end))
            else:
                data.update(await self._generate_general_report_data(period_start, period_end))
                
        except Exception as e:
            logger.error(f"Report data generation failed: {e}")
            data['error'] = str(e)
        
        return data
    
    async def _generate_daily_position_data(self, period_start: datetime, period_end: datetime) -> Dict:
        """Generate daily position report data"""
        
        query = text("""
            SELECT 
                DATE(created_at) as report_date,
                COUNT(*) as total_agents,
                SUM(float_limit) as total_float_limit,
                SUM(utilized_amount) as total_utilized,
                SUM(available_float) as total_available,
                AVG(interest_rate) as avg_interest_rate
            FROM agent_floats 
            WHERE created_at BETWEEN :start_date AND :end_date
            AND status = 'active'
            GROUP BY DATE(created_at)
            ORDER BY report_date
        """)
        
        try:
            with self.db_engine.connect() as conn:
                results = conn.execute(query, {
                    "start_date": period_start,
                    "end_date": period_end
                }).fetchall()
                
                daily_positions = []
                for row in results:
                    daily_positions.append({
                        'date': row.report_date.isoformat(),
                        'total_agents': row.total_agents,
                        'total_float_limit': float(row.total_float_limit or 0),
                        'total_utilized': float(row.total_utilized or 0),
                        'total_available': float(row.total_available or 0),
                        'utilization_rate': (float(row.total_utilized or 0) / max(float(row.total_float_limit or 1), 1)) * 100,
                        'avg_interest_rate': float(row.avg_interest_rate or 0)
                    })
                
                return {
                    'daily_positions': daily_positions,
                    'summary': {
                        'total_reporting_days': len(daily_positions),
                        'avg_daily_utilization': np.mean([pos['utilization_rate'] for pos in daily_positions]) if daily_positions else 0
                    }
                }
                
        except Exception as e:
            logger.error(f"Daily position data generation failed: {e}")
            return {'error': str(e)}
    
    async def _generate_monthly_compliance_data(self, period_start: datetime, period_end: datetime) -> Dict:
        """Generate monthly compliance report data"""
        
        # This would generate comprehensive compliance metrics
        return {
            'compliance_summary': {
                'total_checks_performed': 150,  # Simulated
                'compliance_rate': 92.5,
                'total_violations': 8,
                'resolved_violations': 6,
                'pending_violations': 2
            },
            'regulatory_metrics': {
                'capital_adequacy_ratio': 0.125,
                'liquidity_coverage_ratio': 1.05,
                'concentration_risk_ratio': 0.18
            },
            'recommendations': [
                "Enhance KYC refresh procedures",
                "Implement automated compliance monitoring",
                "Strengthen risk assessment processes"
            ]
        }
    
    async def _generate_quarterly_risk_data(self, period_start: datetime, period_end: datetime) -> Dict:
        """Generate quarterly risk report data"""
        
        return {
            'risk_summary': {
                'overall_risk_rating': 'Medium',
                'credit_risk_score': 75.2,
                'operational_risk_score': 82.1,
                'compliance_risk_score': 88.5
            },
            'risk_factors': [
                'Concentration in specific geographic regions',
                'Increasing float utilization rates',
                'Regulatory changes in lending requirements'
            ],
            'mitigation_strategies': [
                'Diversify agent portfolio geographically',
                'Implement dynamic limit adjustments',
                'Enhance regulatory monitoring systems'
            ]
        }
    
    async def _generate_general_report_data(self, period_start: datetime, period_end: datetime) -> Dict:
        """Generate general report data"""
        
        return {
            'general_metrics': {
                'reporting_period_days': (period_end - period_start).days,
                'data_quality_score': 95.5,
                'system_availability': 99.8
            }
        }
    
    async def _create_report_file(self, report_id: str, report_type: ReportType, data: Dict) -> str:
        """Create report file"""
        
        # Create reports directory
        reports_dir = "/tmp/regulatory_reports"
        os.makedirs(reports_dir, exist_ok=True)
        
        # Generate filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{report_id}_{timestamp}.json"
        file_path = os.path.join(reports_dir, filename)
        
        # Write report data to file
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2, default=str)
        
        logger.info(f"Report file created: {file_path}")
        return file_path
    
    async def create_audit_trail_entry(self, user_id: str, action_type: str, 
                                     resource_type: str, resource_id: str,
                                     old_values: Optional[Dict] = None,
                                     new_values: Optional[Dict] = None,
                                     ip_address: Optional[str] = None) -> AuditTrailEntry:
        """Create audit trail entry"""
        
        entry_id = f"AT_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hashlib.md5(f'{user_id}{action_type}{resource_id}'.encode()).hexdigest()[:8]}"
        
        entry = AuditTrailEntry(
            entry_id=entry_id,
            user_id=user_id,
            action_type=action_type,
            resource_type=resource_type,
            resource_id=resource_id,
            old_values=old_values,
            new_values=new_values,
            ip_address=ip_address
        )
        
        # Store audit trail entry (in production, this would be stored in database)
        logger.info(f"Audit trail entry created: {entry.dict()}")
        
        # Update metrics
        audit_trail_entries.inc()
        
        return entry

# Global compliance engine instance
compliance_engine = RegulatoryComplianceEngine()

# ==========================================
# API ENDPOINTS
# ==========================================

@app.on_event("startup")
async def startup_event():
    """Initialize the compliance engine on startup"""
    await compliance_engine.initialize()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "float-regulatory-compliance",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(generate_latest(), media_type="text/plain")

@app.post("/compliance-check", response_model=ComplianceCheck)
async def perform_compliance_check(
    framework: RegulatoryFramework,
    agent_id: Optional[str] = None,
    background_tasks: BackgroundTasks = None
):
    """Perform compliance check"""
    
    try:
        result = await compliance_engine.perform_compliance_check(framework, agent_id)
        
        # Create audit trail entry in background
        if background_tasks:
            background_tasks.add_task(
                compliance_engine.create_audit_trail_entry,
                user_id="system",
                action_type="compliance_check",
                resource_type="agent_float",
                resource_id=agent_id or "all_agents"
            )
        
        return result
        
    except Exception as e:
        logger.error(f"Compliance check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-report", response_model=RegulatoryReport)
async def generate_regulatory_report(
    report_type: ReportType,
    framework: RegulatoryFramework,
    period_start: datetime,
    period_end: datetime,
    generated_by: str,
    background_tasks: BackgroundTasks
):
    """Generate regulatory report"""
    
    try:
        result = await compliance_engine.generate_regulatory_report(
            report_type, framework, period_start, period_end, generated_by
        )
        
        # Create audit trail entry in background
        background_tasks.add_task(
            compliance_engine.create_audit_trail_entry,
            user_id=generated_by,
            action_type="generate_report",
            resource_type="regulatory_report",
            resource_id=result.report_id
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Report generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/compliance-frameworks")
async def get_compliance_frameworks():
    """Get available compliance frameworks"""
    
    frameworks = [
        {
            "code": framework.value,
            "name": framework.value.replace('_', ' ').title(),
            "description": f"Compliance framework for {framework.value}"
        }
        for framework in RegulatoryFramework
    ]
    
    return {"frameworks": frameworks}

@app.get("/report-types")
async def get_report_types():
    """Get available report types"""
    
    report_types = [
        {
            "code": report_type.value,
            "name": report_type.value.replace('_', ' ').title(),
            "description": f"Report type: {report_type.value}"
        }
        for report_type in ReportType
    ]
    
    return {"report_types": report_types}

@app.post("/audit-trail", response_model=AuditTrailEntry)
async def create_audit_trail_entry(
    user_id: str,
    action_type: str,
    resource_type: str,
    resource_id: str,
    old_values: Optional[Dict] = None,
    new_values: Optional[Dict] = None,
    ip_address: Optional[str] = None
):
    """Create audit trail entry"""
    
    try:
        return await compliance_engine.create_audit_trail_entry(
            user_id, action_type, resource_type, resource_id,
            old_values, new_values, ip_address
        )
        
    except Exception as e:
        logger.error(f"Audit trail entry creation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/compliance-rules")
async def get_compliance_rules():
    """Get current compliance rules and limits"""
    
    return {
        "compliance_rules": compliance_engine.compliance_rules,
        "regulatory_limits": compliance_engine.regulatory_limits,
        "last_updated": datetime.now().isoformat()
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8003")),
        reload=os.getenv("ENVIRONMENT") == "development",
        log_level="info"
    )

