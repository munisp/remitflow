#!/usr/bin/env python3
"""
Float Regulatory Compliance Service
Ensures compliance with financial regulations for float management operations
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from decimal import Decimal
import asyncpg
import aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from enum import Enum

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8122"))

# FastAPI app
app = FastAPI(
    title="Float Regulatory Compliance",
    description="Ensures compliance with financial regulations for float management operations",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
db_pool = None
redis_client = None

# Enums
class ComplianceStatus(str, Enum):
    COMPLIANT = "COMPLIANT"
    NON_COMPLIANT = "NON_COMPLIANT"
    UNDER_REVIEW = "UNDER_REVIEW"
    REQUIRES_ACTION = "REQUIRES_ACTION"

class RegulationType(str, Enum):
    CBN_GUIDELINES = "CBN_GUIDELINES"
    AML_CFT = "AML_CFT"
    KYC_REQUIREMENTS = "KYC_REQUIREMENTS"
    TRANSACTION_LIMITS = "TRANSACTION_LIMITS"
    REPORTING_REQUIREMENTS = "REPORTING_REQUIREMENTS"
    DATA_PROTECTION = "DATA_PROTECTION"

class ViolationSeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

# Pydantic models
class ComplianceCheckRequest(BaseModel):
    transaction_id: str
    agent_id: str
    transaction_type: str
    amount: Decimal
    currency: str = "NGN"
    counterparty_id: Optional[str] = None
    location: Optional[str] = None
    timestamp: datetime
    metadata: Optional[Dict[str, Any]] = None

class ComplianceResult(BaseModel):
    transaction_id: str
    status: ComplianceStatus
    violations: List[Dict[str, Any]]
    recommendations: List[str]
    risk_score: float
    regulatory_flags: List[str]
    required_actions: List[str]

class RegulationRule(BaseModel):
    rule_id: str
    regulation_type: RegulationType
    description: str
    parameters: Dict[str, Any]
    severity: ViolationSeverity
    is_active: bool = True

class ComplianceReport(BaseModel):
    report_id: str
    report_type: str
    period_start: datetime
    period_end: datetime
    total_transactions: int
    compliant_transactions: int
    violations_count: int
    compliance_rate: float
    generated_at: datetime

# Database functions
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS compliance_checks (
                    id SERIAL PRIMARY KEY,
                    transaction_id VARCHAR(255) UNIQUE NOT NULL,
                    agent_id VARCHAR(255) NOT NULL,
                    status VARCHAR(20) NOT NULL,
                    risk_score DECIMAL(5,4) NOT NULL,
                    violations JSONB,
                    recommendations JSONB,
                    regulatory_flags JSONB,
                    required_actions JSONB,
                    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_transaction_id (transaction_id),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_status (status),
                    INDEX idx_checked_at (checked_at)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS regulation_rules (
                    id SERIAL PRIMARY KEY,
                    rule_id VARCHAR(255) UNIQUE NOT NULL,
                    regulation_type VARCHAR(50) NOT NULL,
                    description TEXT NOT NULL,
                    parameters JSONB NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_rule_id (rule_id),
                    INDEX idx_regulation_type (regulation_type),
                    INDEX idx_is_active (is_active)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS compliance_violations (
                    id SERIAL PRIMARY KEY,
                    transaction_id VARCHAR(255) NOT NULL,
                    rule_id VARCHAR(255) NOT NULL,
                    violation_type VARCHAR(100) NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    description TEXT,
                    violation_data JSONB,
                    resolved BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    resolved_at TIMESTAMP,
                    INDEX idx_transaction_id (transaction_id),
                    INDEX idx_rule_id (rule_id),
                    INDEX idx_severity (severity),
                    INDEX idx_resolved (resolved)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS compliance_reports (
                    id SERIAL PRIMARY KEY,
                    report_id VARCHAR(255) UNIQUE NOT NULL,
                    report_type VARCHAR(50) NOT NULL,
                    period_start TIMESTAMP NOT NULL,
                    period_end TIMESTAMP NOT NULL,
                    report_data JSONB NOT NULL,
                    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_report_id (report_id),
                    INDEX idx_report_type (report_type),
                    INDEX idx_period (period_start, period_end)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_compliance_profiles (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(255) UNIQUE NOT NULL,
                    kyc_status VARCHAR(20) DEFAULT 'PENDING',
                    aml_risk_level VARCHAR(20) DEFAULT 'MEDIUM',
                    transaction_limits JSONB,
                    compliance_score DECIMAL(5,4) DEFAULT 0.5,
                    last_kyc_update TIMESTAMP,
                    last_assessment TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_kyc_status (kyc_status),
                    INDEX idx_aml_risk_level (aml_risk_level)
                )
            """)
        
        # Initialize default regulation rules
        await init_default_rules()
        
        logger.info("Database initialized successfully")
        
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise

async def init_redis():
    """Initialize Redis connection"""
    global redis_client
    
    try:
        redis_client = await aioredis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Redis connection established")
        
    except Exception as e:
        logger.error(f"Redis initialization failed: {e}")
        raise

async def init_default_rules():
    """Initialize default regulatory rules"""
    default_rules = [
        {
            "rule_id": "CBN_DAILY_LIMIT",
            "regulation_type": "CBN_GUIDELINES",
            "description": "CBN daily transaction limit for agents",
            "parameters": {"daily_limit": 1000000, "currency": "NGN"},
            "severity": "HIGH"
        },
        {
            "rule_id": "CBN_SINGLE_TRANSACTION_LIMIT",
            "regulation_type": "CBN_GUIDELINES", 
            "description": "CBN single transaction limit",
            "parameters": {"single_limit": 500000, "currency": "NGN"},
            "severity": "HIGH"
        },
        {
            "rule_id": "AML_SUSPICIOUS_AMOUNT",
            "regulation_type": "AML_CFT",
            "description": "AML suspicious transaction amount threshold",
            "parameters": {"threshold": 100000, "currency": "NGN"},
            "severity": "CRITICAL"
        },
        {
            "rule_id": "KYC_VERIFICATION_REQUIRED",
            "regulation_type": "KYC_REQUIREMENTS",
            "description": "KYC verification required for high-value transactions",
            "parameters": {"threshold": 50000, "currency": "NGN"},
            "severity": "MEDIUM"
        },
        {
            "rule_id": "TRANSACTION_FREQUENCY_LIMIT",
            "regulation_type": "TRANSACTION_LIMITS",
            "description": "Maximum transactions per hour",
            "parameters": {"max_per_hour": 20},
            "severity": "MEDIUM"
        },
        {
            "rule_id": "CROSS_BORDER_REPORTING",
            "regulation_type": "REPORTING_REQUIREMENTS",
            "description": "Cross-border transaction reporting requirement",
            "parameters": {"threshold": 10000, "currency": "USD"},
            "severity": "HIGH"
        }
    ]
    
    try:
        async with db_pool.acquire() as conn:
            for rule in default_rules:
                await conn.execute("""
                    INSERT INTO regulation_rules 
                    (rule_id, regulation_type, description, parameters, severity)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (rule_id) DO NOTHING
                """, 
                rule["rule_id"], rule["regulation_type"], rule["description"],
                json.dumps(rule["parameters"]), rule["severity"]
                )
        
        logger.info("Default regulation rules initialized")
        
    except Exception as e:
        logger.error(f"Failed to initialize default rules: {e}")

# Compliance engine
class FloatComplianceEngine:
    """Main compliance checking engine"""
    
    def __init__(self):
        self.rules_cache = {}
        self.last_cache_update = None
        
    async def check_compliance(self, request: ComplianceCheckRequest) -> ComplianceResult:
        """Perform comprehensive compliance check"""
        try:
            # Load regulation rules
            await self._load_rules()
            
            violations = []
            regulatory_flags = []
            required_actions = []
            
            # Check each regulation type
            for regulation_type in RegulationType:
                type_violations = await self._check_regulation_type(request, regulation_type)
                violations.extend(type_violations)
            
            # Calculate risk score
            risk_score = self._calculate_risk_score(violations)
            
            # Determine compliance status
            status = self._determine_compliance_status(violations, risk_score)
            
            # Generate regulatory flags
            regulatory_flags = self._generate_regulatory_flags(violations)
            
            # Generate recommendations and required actions
            recommendations = self._generate_recommendations(violations, status)
            required_actions = self._generate_required_actions(violations, status)
            
            result = ComplianceResult(
                transaction_id=request.transaction_id,
                status=status,
                violations=violations,
                recommendations=recommendations,
                risk_score=risk_score,
                regulatory_flags=regulatory_flags,
                required_actions=required_actions
            )
            
            # Store compliance check result
            await self._store_compliance_result(result, request.agent_id)
            
            # Store violations if any
            if violations:
                await self._store_violations(request.transaction_id, violations)
            
            return result
            
        except Exception as e:
            logger.error(f"Compliance check failed: {e}")
            raise HTTPException(status_code=500, detail=f"Compliance check failed: {str(e)}")
    
    async def _load_rules(self):
        """Load regulation rules from database"""
        # Check if cache needs refresh (refresh every 5 minutes)
        if (not self.last_cache_update or 
            datetime.now() - self.last_cache_update > timedelta(minutes=5)):
            
            async with db_pool.acquire() as conn:
                rules = await conn.fetch("""
                    SELECT rule_id, regulation_type, description, parameters, severity
                    FROM regulation_rules 
                    WHERE is_active = TRUE
                """)
                
                self.rules_cache = {}
                for rule in rules:
                    reg_type = rule['regulation_type']
                    if reg_type not in self.rules_cache:
                        self.rules_cache[reg_type] = []
                    
                    self.rules_cache[reg_type].append({
                        'rule_id': rule['rule_id'],
                        'description': rule['description'],
                        'parameters': json.loads(rule['parameters']),
                        'severity': rule['severity']
                    })
                
                self.last_cache_update = datetime.now()
    
    async def _check_regulation_type(self, request: ComplianceCheckRequest, regulation_type: RegulationType) -> List[Dict]:
        """Check compliance for specific regulation type"""
        violations = []
        
        if regulation_type == RegulationType.CBN_GUIDELINES:
            violations.extend(await self._check_cbn_guidelines(request))
        elif regulation_type == RegulationType.AML_CFT:
            violations.extend(await self._check_aml_cft(request))
        elif regulation_type == RegulationType.KYC_REQUIREMENTS:
            violations.extend(await self._check_kyc_requirements(request))
        elif regulation_type == RegulationType.TRANSACTION_LIMITS:
            violations.extend(await self._check_transaction_limits(request))
        elif regulation_type == RegulationType.REPORTING_REQUIREMENTS:
            violations.extend(await self._check_reporting_requirements(request))
        elif regulation_type == RegulationType.DATA_PROTECTION:
            violations.extend(await self._check_data_protection(request))
        
        return violations
    
    async def _check_cbn_guidelines(self, request: ComplianceCheckRequest) -> List[Dict]:
        """Check CBN regulatory guidelines"""
        violations = []
        rules = self.rules_cache.get(RegulationType.CBN_GUIDELINES.value, [])
        
        for rule in rules:
            if rule['rule_id'] == 'CBN_DAILY_LIMIT':
                # Check daily transaction limit
                daily_total = await self._get_agent_daily_total(request.agent_id, request.timestamp.date())
                limit = rule['parameters']['daily_limit']
                
                if daily_total + request.amount > limit:
                    violations.append({
                        'rule_id': rule['rule_id'],
                        'violation_type': 'DAILY_LIMIT_EXCEEDED',
                        'severity': rule['severity'],
                        'description': f"Daily limit exceeded: {daily_total + request.amount} > {limit}",
                        'current_amount': float(daily_total + request.amount),
                        'limit': limit
                    })
            
            elif rule['rule_id'] == 'CBN_SINGLE_TRANSACTION_LIMIT':
                # Check single transaction limit
                limit = rule['parameters']['single_limit']
                
                if request.amount > limit:
                    violations.append({
                        'rule_id': rule['rule_id'],
                        'violation_type': 'SINGLE_TRANSACTION_LIMIT_EXCEEDED',
                        'severity': rule['severity'],
                        'description': f"Single transaction limit exceeded: {request.amount} > {limit}",
                        'amount': float(request.amount),
                        'limit': limit
                    })
        
        return violations
    
    async def _check_aml_cft(self, request: ComplianceCheckRequest) -> List[Dict]:
        """Check AML/CFT compliance"""
        violations = []
        rules = self.rules_cache.get(RegulationType.AML_CFT.value, [])
        
        for rule in rules:
            if rule['rule_id'] == 'AML_SUSPICIOUS_AMOUNT':
                threshold = rule['parameters']['threshold']
                
                if request.amount >= threshold:
                    violations.append({
                        'rule_id': rule['rule_id'],
                        'violation_type': 'SUSPICIOUS_AMOUNT',
                        'severity': rule['severity'],
                        'description': f"Transaction amount meets AML reporting threshold: {request.amount}",
                        'amount': float(request.amount),
                        'threshold': threshold
                    })
        
        # Check for suspicious patterns
        suspicious_patterns = await self._detect_suspicious_patterns(request)
        violations.extend(suspicious_patterns)
        
        return violations
    
    async def _check_kyc_requirements(self, request: ComplianceCheckRequest) -> List[Dict]:
        """Check KYC compliance requirements"""
        violations = []
        rules = self.rules_cache.get(RegulationType.KYC_REQUIREMENTS.value, [])
        
        # Get agent KYC status
        kyc_status = await self._get_agent_kyc_status(request.agent_id)
        
        for rule in rules:
            if rule['rule_id'] == 'KYC_VERIFICATION_REQUIRED':
                threshold = rule['parameters']['threshold']
                
                if request.amount >= threshold and kyc_status != 'VERIFIED':
                    violations.append({
                        'rule_id': rule['rule_id'],
                        'violation_type': 'KYC_VERIFICATION_REQUIRED',
                        'severity': rule['severity'],
                        'description': f"KYC verification required for amount {request.amount}",
                        'amount': float(request.amount),
                        'threshold': threshold,
                        'current_kyc_status': kyc_status
                    })
        
        return violations
    
    async def _check_transaction_limits(self, request: ComplianceCheckRequest) -> List[Dict]:
        """Check transaction frequency and velocity limits"""
        violations = []
        rules = self.rules_cache.get(RegulationType.TRANSACTION_LIMITS.value, [])
        
        for rule in rules:
            if rule['rule_id'] == 'TRANSACTION_FREQUENCY_LIMIT':
                max_per_hour = rule['parameters']['max_per_hour']
                
                # Check hourly transaction count
                hourly_count = await self._get_agent_hourly_count(request.agent_id, request.timestamp)
                
                if hourly_count >= max_per_hour:
                    violations.append({
                        'rule_id': rule['rule_id'],
                        'violation_type': 'FREQUENCY_LIMIT_EXCEEDED',
                        'severity': rule['severity'],
                        'description': f"Hourly transaction limit exceeded: {hourly_count} >= {max_per_hour}",
                        'current_count': hourly_count,
                        'limit': max_per_hour
                    })
        
        return violations
    
    async def _check_reporting_requirements(self, request: ComplianceCheckRequest) -> List[Dict]:
        """Check regulatory reporting requirements"""
        violations = []
        rules = self.rules_cache.get(RegulationType.REPORTING_REQUIREMENTS.value, [])
        
        for rule in rules:
            if rule['rule_id'] == 'CROSS_BORDER_REPORTING':
                threshold = rule['parameters']['threshold']
                
                # Check if this is a cross-border transaction
                if (request.counterparty_id and 
                    await self._is_cross_border_transaction(request) and
                    request.amount >= threshold):
                    
                    violations.append({
                        'rule_id': rule['rule_id'],
                        'violation_type': 'CROSS_BORDER_REPORTING_REQUIRED',
                        'severity': rule['severity'],
                        'description': f"Cross-border transaction reporting required: {request.amount}",
                        'amount': float(request.amount),
                        'threshold': threshold
                    })
        
        return violations
    
    async def _check_data_protection(self, request: ComplianceCheckRequest) -> List[Dict]:
        """Check data protection compliance"""
        violations = []
        
        # Check for PII in metadata
        if request.metadata:
            pii_fields = ['ssn', 'bvn', 'nin', 'passport', 'account_number']
            for field in pii_fields:
                if field in str(request.metadata).lower():
                    violations.append({
                        'rule_id': 'DATA_PROTECTION_PII',
                        'violation_type': 'PII_IN_METADATA',
                        'severity': 'MEDIUM',
                        'description': f"Potential PII detected in transaction metadata: {field}",
                        'field': field
                    })
        
        return violations
    
    async def _detect_suspicious_patterns(self, request: ComplianceCheckRequest) -> List[Dict]:
        """Detect suspicious transaction patterns"""
        violations = []
        
        # Check for round number amounts (potential structuring)
        if request.amount % 10000 == 0 and request.amount >= 50000:
            violations.append({
                'rule_id': 'SUSPICIOUS_ROUND_AMOUNT',
                'violation_type': 'POTENTIAL_STRUCTURING',
                'severity': 'MEDIUM',
                'description': f"Suspicious round amount: {request.amount}",
                'amount': float(request.amount)
            })
        
        # Check for unusual timing (late night/early morning)
        hour = request.timestamp.hour
        if hour < 6 or hour > 22:
            violations.append({
                'rule_id': 'UNUSUAL_TIMING',
                'violation_type': 'OFF_HOURS_TRANSACTION',
                'severity': 'LOW',
                'description': f"Transaction at unusual hour: {hour}:00",
                'hour': hour
            })
        
        return violations
    
    async def _get_agent_daily_total(self, agent_id: str, date) -> Decimal:
        """Get agent's total transactions for the day"""
        # This would query the transaction database
        # For now, return a simulated value
        return Decimal('50000')
    
    async def _get_agent_hourly_count(self, agent_id: str, timestamp: datetime) -> int:
        """Get agent's transaction count for the current hour"""
        # This would query the transaction database
        # For now, return a simulated value
        return 5
    
    async def _get_agent_kyc_status(self, agent_id: str) -> str:
        """Get agent's KYC verification status"""
        try:
            async with db_pool.acquire() as conn:
                status = await conn.fetchval("""
                    SELECT kyc_status FROM agent_compliance_profiles WHERE agent_id = $1
                """, agent_id)
                
                return status or 'PENDING'
                
        except Exception:
            return 'PENDING'
    
    async def _is_cross_border_transaction(self, request: ComplianceCheckRequest) -> bool:
        """Check if transaction is cross-border"""
        # This would check counterparty location/jurisdiction
        # For now, return False
        return False
    
    def _calculate_risk_score(self, violations: List[Dict]) -> float:
        """Calculate overall risk score based on violations"""
        if not violations:
            return 0.1
        
        severity_weights = {
            'LOW': 0.1,
            'MEDIUM': 0.3,
            'HIGH': 0.6,
            'CRITICAL': 1.0
        }
        
        total_score = 0
        for violation in violations:
            severity = violation.get('severity', 'MEDIUM')
            total_score += severity_weights.get(severity, 0.3)
        
        # Normalize to 0-1 range
        return min(1.0, total_score / len(violations))
    
    def _determine_compliance_status(self, violations: List[Dict], risk_score: float) -> ComplianceStatus:
        """Determine overall compliance status"""
        if not violations:
            return ComplianceStatus.COMPLIANT
        
        critical_violations = [v for v in violations if v.get('severity') == 'CRITICAL']
        high_violations = [v for v in violations if v.get('severity') == 'HIGH']
        
        if critical_violations:
            return ComplianceStatus.NON_COMPLIANT
        elif high_violations or risk_score > 0.7:
            return ComplianceStatus.REQUIRES_ACTION
        elif risk_score > 0.3:
            return ComplianceStatus.UNDER_REVIEW
        else:
            return ComplianceStatus.COMPLIANT
    
    def _generate_regulatory_flags(self, violations: List[Dict]) -> List[str]:
        """Generate regulatory flags based on violations"""
        flags = []
        
        for violation in violations:
            violation_type = violation.get('violation_type', '')
            
            if 'AML' in violation_type or 'SUSPICIOUS' in violation_type:
                flags.append('AML_ALERT')
            if 'KYC' in violation_type:
                flags.append('KYC_REQUIRED')
            if 'LIMIT' in violation_type:
                flags.append('LIMIT_BREACH')
            if 'REPORTING' in violation_type:
                flags.append('REPORTING_REQUIRED')
        
        return list(set(flags))  # Remove duplicates
    
    def _generate_recommendations(self, violations: List[Dict], status: ComplianceStatus) -> List[str]:
        """Generate compliance recommendations"""
        recommendations = []
        
        if status == ComplianceStatus.NON_COMPLIANT:
            recommendations.append("Block transaction immediately")
            recommendations.append("Escalate to compliance team")
        elif status == ComplianceStatus.REQUIRES_ACTION:
            recommendations.append("Require additional verification")
            recommendations.append("Apply enhanced monitoring")
        elif status == ComplianceStatus.UNDER_REVIEW:
            recommendations.append("Flag for manual review")
            recommendations.append("Monitor subsequent transactions")
        
        # Specific recommendations based on violation types
        for violation in violations:
            violation_type = violation.get('violation_type', '')
            
            if 'KYC' in violation_type:
                recommendations.append("Complete KYC verification process")
            if 'LIMIT' in violation_type:
                recommendations.append("Review and adjust transaction limits")
            if 'SUSPICIOUS' in violation_type:
                recommendations.append("File suspicious activity report (SAR)")
        
        return list(set(recommendations))
    
    def _generate_required_actions(self, violations: List[Dict], status: ComplianceStatus) -> List[str]:
        """Generate required compliance actions"""
        actions = []
        
        for violation in violations:
            violation_type = violation.get('violation_type', '')
            severity = violation.get('severity', 'MEDIUM')
            
            if severity == 'CRITICAL':
                actions.append(f"Immediate action required for {violation_type}")
            elif 'REPORTING' in violation_type:
                actions.append("Submit regulatory report within 24 hours")
            elif 'KYC' in violation_type:
                actions.append("Complete KYC verification within 7 days")
        
        return actions
    
    async def _store_compliance_result(self, result: ComplianceResult, agent_id: str):
        """Store compliance check result"""
        try:
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO compliance_checks 
                    (transaction_id, agent_id, status, risk_score, violations, 
                     recommendations, regulatory_flags, required_actions)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (transaction_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    risk_score = EXCLUDED.risk_score,
                    violations = EXCLUDED.violations,
                    recommendations = EXCLUDED.recommendations,
                    regulatory_flags = EXCLUDED.regulatory_flags,
                    required_actions = EXCLUDED.required_actions
                """, 
                result.transaction_id, agent_id, result.status.value,
                result.risk_score, json.dumps(result.violations),
                json.dumps(result.recommendations), json.dumps(result.regulatory_flags),
                json.dumps(result.required_actions)
                )
                
                # Cache in Redis
                await redis_client.setex(
                    f"compliance:{result.transaction_id}",
                    3600,  # 1 hour TTL
                    json.dumps(result.dict(), default=str)
                )
                
        except Exception as e:
            logger.error(f"Failed to store compliance result: {e}")
    
    async def _store_violations(self, transaction_id: str, violations: List[Dict]):
        """Store individual violations"""
        try:
            async with db_pool.acquire() as conn:
                for violation in violations:
                    await conn.execute("""
                        INSERT INTO compliance_violations 
                        (transaction_id, rule_id, violation_type, severity, description, violation_data)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    """, 
                    transaction_id, violation.get('rule_id', 'UNKNOWN'),
                    violation.get('violation_type', 'UNKNOWN'),
                    violation.get('severity', 'MEDIUM'),
                    violation.get('description', ''),
                    json.dumps(violation)
                    )
                    
        except Exception as e:
            logger.error(f"Failed to store violations: {e}")

# Initialize compliance engine
compliance_engine = FloatComplianceEngine()

# API endpoints
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    await init_database()
    await init_redis()

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check database
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        # Check Redis
        await redis_client.ping()
        
        return {
            "status": "healthy",
            "service": "float-regulatory-compliance",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "rules_loaded": len(compliance_engine.rules_cache)
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/check-compliance", response_model=ComplianceResult)
async def check_compliance(request: ComplianceCheckRequest):
    """Perform compliance check for a transaction"""
    return await compliance_engine.check_compliance(request)

@app.get("/api/v1/compliance/{transaction_id}")
async def get_compliance_result(transaction_id: str):
    """Get compliance result for a transaction"""
    try:
        # Check Redis cache first
        cached_data = await redis_client.get(f"compliance:{transaction_id}")
        if cached_data:
            return json.loads(cached_data)
        
        # Get from database
        async with db_pool.acquire() as conn:
            result = await conn.fetchrow("""
                SELECT * FROM compliance_checks WHERE transaction_id = $1
            """, transaction_id)
            
            if not result:
                raise HTTPException(status_code=404, detail="Compliance result not found")
            
            return {
                "transaction_id": result['transaction_id'],
                "status": result['status'],
                "risk_score": float(result['risk_score']),
                "violations": json.loads(result['violations']),
                "recommendations": json.loads(result['recommendations']),
                "regulatory_flags": json.loads(result['regulatory_flags']),
                "required_actions": json.loads(result['required_actions']),
                "checked_at": result['checked_at'].isoformat()
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get compliance result: {str(e)}")

@app.get("/api/v1/violations")
async def list_violations(
    severity: Optional[ViolationSeverity] = None,
    resolved: Optional[bool] = None,
    limit: int = 100
):
    """List compliance violations"""
    try:
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM compliance_violations WHERE 1=1"
            params = []
            
            if severity:
                query += f" AND severity = ${len(params) + 1}"
                params.append(severity.value)
            
            if resolved is not None:
                query += f" AND resolved = ${len(params) + 1}"
                params.append(resolved)
            
            query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
            params.append(limit)
            
            violations = await conn.fetch(query, *params)
            
            return [
                {
                    "id": row['id'],
                    "transaction_id": row['transaction_id'],
                    "rule_id": row['rule_id'],
                    "violation_type": row['violation_type'],
                    "severity": row['severity'],
                    "description": row['description'],
                    "violation_data": json.loads(row['violation_data']),
                    "resolved": row['resolved'],
                    "created_at": row['created_at'].isoformat(),
                    "resolved_at": row['resolved_at'].isoformat() if row['resolved_at'] else None
                }
                for row in violations
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list violations: {str(e)}")

@app.get("/api/v1/rules")
async def list_regulation_rules():
    """List all regulation rules"""
    try:
        async with db_pool.acquire() as conn:
            rules = await conn.fetch("""
                SELECT * FROM regulation_rules ORDER BY regulation_type, rule_id
            """)
            
            return [
                {
                    "rule_id": row['rule_id'],
                    "regulation_type": row['regulation_type'],
                    "description": row['description'],
                    "parameters": json.loads(row['parameters']),
                    "severity": row['severity'],
                    "is_active": row['is_active'],
                    "created_at": row['created_at'].isoformat(),
                    "updated_at": row['updated_at'].isoformat()
                }
                for row in rules
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list rules: {str(e)}")

@app.post("/api/v1/rules")
async def create_regulation_rule(rule: RegulationRule):
    """Create a new regulation rule"""
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO regulation_rules 
                (rule_id, regulation_type, description, parameters, severity, is_active)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, 
            rule.rule_id, rule.regulation_type.value, rule.description,
            json.dumps(rule.parameters), rule.severity.value, rule.is_active
            )
        
        # Clear rules cache to force reload
        compliance_engine.last_cache_update = None
        
        return {"message": "Regulation rule created successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create rule: {str(e)}")

@app.get("/api/v1/reports/compliance-summary")
async def get_compliance_summary(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
):
    """Get compliance summary report"""
    try:
        if not start_date:
            start_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        if not end_date:
            end_date = datetime.now()
        
        async with db_pool.acquire() as conn:
            summary = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_checks,
                    COUNT(CASE WHEN status = 'COMPLIANT' THEN 1 END) as compliant_count,
                    COUNT(CASE WHEN status = 'NON_COMPLIANT' THEN 1 END) as non_compliant_count,
                    COUNT(CASE WHEN status = 'REQUIRES_ACTION' THEN 1 END) as requires_action_count,
                    AVG(risk_score) as avg_risk_score
                FROM compliance_checks
                WHERE checked_at BETWEEN $1 AND $2
            """, start_date, end_date)
            
            violations_summary = await conn.fetch("""
                SELECT severity, COUNT(*) as count
                FROM compliance_violations
                WHERE created_at BETWEEN $1 AND $2
                GROUP BY severity
            """, start_date, end_date)
            
            compliance_rate = 0.0
            if summary['total_checks'] > 0:
                compliance_rate = summary['compliant_count'] / summary['total_checks'] * 100
            
            return {
                "period": {
                    "start": start_date.isoformat(),
                    "end": end_date.isoformat()
                },
                "total_checks": summary['total_checks'],
                "compliant_count": summary['compliant_count'],
                "non_compliant_count": summary['non_compliant_count'],
                "requires_action_count": summary['requires_action_count'],
                "compliance_rate": compliance_rate,
                "average_risk_score": float(summary['avg_risk_score']) if summary['avg_risk_score'] else 0.0,
                "violations_by_severity": {row['severity']: row['count'] for row in violations_summary}
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get compliance summary: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

