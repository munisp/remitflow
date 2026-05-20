#!/usr/bin/env python3
"""
Risk Assessment Service
Comprehensive risk assessment and management platform for remittance network
with real-time risk scoring, ML-based predictions, and regulatory compliance
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from decimal import Decimal
from enum import Enum
import asyncpg
import aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import joblib
import hashlib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8137"))

# FastAPI app
app = FastAPI(
    title="Risk Assessment Service",
    description="Comprehensive risk assessment and management platform",
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
ml_models = {}
risk_rules = {}

# Enums
class RiskLevel(str, Enum):
    VERY_LOW = "VERY_LOW"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"
    CRITICAL = "CRITICAL"

class RiskType(str, Enum):
    CREDIT_RISK = "CREDIT_RISK"
    OPERATIONAL_RISK = "OPERATIONAL_RISK"
    MARKET_RISK = "MARKET_RISK"
    LIQUIDITY_RISK = "LIQUIDITY_RISK"
    COMPLIANCE_RISK = "COMPLIANCE_RISK"
    FRAUD_RISK = "FRAUD_RISK"
    REPUTATIONAL_RISK = "REPUTATIONAL_RISK"
    TECHNOLOGY_RISK = "TECHNOLOGY_RISK"

class AssessmentStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    REQUIRES_REVIEW = "REQUIRES_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"

class RiskCategory(str, Enum):
    CUSTOMER = "CUSTOMER"
    AGENT = "AGENT"
    TRANSACTION = "TRANSACTION"
    PORTFOLIO = "PORTFOLIO"
    SYSTEM = "SYSTEM"

# Pydantic models
class RiskAssessmentRequest(BaseModel):
    entity_id: str
    entity_type: RiskCategory
    assessment_type: List[RiskType]
    data: Dict[str, Any]
    urgency: str = "NORMAL"
    requested_by: str

class RiskScore(BaseModel):
    risk_type: RiskType
    score: float
    level: RiskLevel
    confidence: float
    factors: List[str]
    recommendations: List[str]

class RiskAssessment(BaseModel):
    assessment_id: str
    entity_id: str
    entity_type: RiskCategory
    overall_risk_score: float
    overall_risk_level: RiskLevel
    risk_scores: List[RiskScore]
    status: AssessmentStatus
    created_at: datetime
    completed_at: Optional[datetime] = None
    assessed_by: str
    expires_at: datetime

class RiskProfile(BaseModel):
    entity_id: str
    entity_type: RiskCategory
    current_risk_level: RiskLevel
    risk_history: List[Dict[str, Any]]
    risk_factors: Dict[str, Any]
    mitigation_measures: List[str]
    last_assessment: datetime
    next_review_date: datetime

class RiskAlert(BaseModel):
    alert_id: str
    entity_id: str
    risk_type: RiskType
    severity: str
    description: str
    triggered_at: datetime
    resolved: bool = False
    resolution_notes: Optional[str] = None

class RiskRule(BaseModel):
    rule_id: str
    rule_name: str
    risk_type: RiskType
    conditions: Dict[str, Any]
    threshold: float
    action: str
    enabled: bool = True

# Database initialization
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create risk assessments table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_assessments (
                    id SERIAL PRIMARY KEY,
                    assessment_id VARCHAR(255) UNIQUE NOT NULL,
                    entity_id VARCHAR(255) NOT NULL,
                    entity_type VARCHAR(50) NOT NULL,
                    overall_risk_score DECIMAL(5,4) NOT NULL,
                    overall_risk_level VARCHAR(20) NOT NULL,
                    risk_scores JSONB,
                    status VARCHAR(20) DEFAULT 'PENDING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    assessed_by VARCHAR(255),
                    expires_at TIMESTAMP,
                    INDEX idx_assessment_id (assessment_id),
                    INDEX idx_entity_id (entity_id),
                    INDEX idx_entity_type (entity_type),
                    INDEX idx_risk_level (overall_risk_level),
                    INDEX idx_status (status),
                    INDEX idx_created_at (created_at)
                )
            """)
            
            # Create risk profiles table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_profiles (
                    id SERIAL PRIMARY KEY,
                    entity_id VARCHAR(255) UNIQUE NOT NULL,
                    entity_type VARCHAR(50) NOT NULL,
                    current_risk_level VARCHAR(20) NOT NULL,
                    risk_history JSONB,
                    risk_factors JSONB,
                    mitigation_measures JSONB,
                    last_assessment TIMESTAMP,
                    next_review_date TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_entity_id (entity_id),
                    INDEX idx_entity_type (entity_type),
                    INDEX idx_risk_level (current_risk_level),
                    INDEX idx_next_review (next_review_date)
                )
            """)
            
            # Create risk alerts table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_alerts (
                    id SERIAL PRIMARY KEY,
                    alert_id VARCHAR(255) UNIQUE NOT NULL,
                    entity_id VARCHAR(255) NOT NULL,
                    risk_type VARCHAR(50) NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    description TEXT,
                    triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    resolved BOOLEAN DEFAULT FALSE,
                    resolved_at TIMESTAMP,
                    resolution_notes TEXT,
                    INDEX idx_alert_id (alert_id),
                    INDEX idx_entity_id (entity_id),
                    INDEX idx_risk_type (risk_type),
                    INDEX idx_severity (severity),
                    INDEX idx_resolved (resolved)
                )
            """)
            
            # Create risk rules table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_rules (
                    id SERIAL PRIMARY KEY,
                    rule_id VARCHAR(255) UNIQUE NOT NULL,
                    rule_name VARCHAR(255) NOT NULL,
                    risk_type VARCHAR(50) NOT NULL,
                    conditions JSONB NOT NULL,
                    threshold DECIMAL(5,4) NOT NULL,
                    action VARCHAR(100) NOT NULL,
                    enabled BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_rule_id (rule_id),
                    INDEX idx_risk_type (risk_type),
                    INDEX idx_enabled (enabled)
                )
            """)
            
            # Create risk metrics table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_metrics (
                    id SERIAL PRIMARY KEY,
                    metric_id VARCHAR(255) UNIQUE NOT NULL,
                    entity_id VARCHAR(255),
                    metric_type VARCHAR(100) NOT NULL,
                    metric_value DECIMAL(15,4),
                    metric_data JSONB,
                    calculation_date DATE DEFAULT CURRENT_DATE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_metric_id (metric_id),
                    INDEX idx_entity_id (entity_id),
                    INDEX idx_metric_type (metric_type),
                    INDEX idx_calculation_date (calculation_date)
                )
            """)
        
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

async def init_ml_models():
    """Initialize machine learning models"""
    global ml_models
    
    try:
        # Credit risk model
        ml_models['credit_risk'] = RandomForestClassifier(
            n_estimators=100,
            random_state=42,
            class_weight='balanced'
        )
        
        # Operational risk model
        ml_models['operational_risk'] = GradientBoostingRegressor(
            n_estimators=100,
            random_state=42
        )
        
        # Fraud risk model
        ml_models['fraud_risk'] = RandomForestClassifier(
            n_estimators=150,
            random_state=42,
            class_weight='balanced'
        )
        
        # Market risk model
        ml_models['market_risk'] = GradientBoostingRegressor(
            n_estimators=80,
            random_state=42
        )
        
        # Feature scalers
        ml_models['scaler'] = StandardScaler()
        ml_models['label_encoder'] = LabelEncoder()
        
        # Train models with synthetic data
        await train_initial_models()
        
        logger.info("ML models initialized successfully")
        
    except Exception as e:
        logger.error(f"ML model initialization failed: {e}")

async def train_initial_models():
    """Train models with initial synthetic data"""
    try:
        # Generate synthetic training data
        np.random.seed(42)
        n_samples = 5000
        
        # Features for risk assessment
        # [age, income, credit_history, transaction_volume, account_age, location_risk, 
        #  device_risk, behavioral_score, compliance_score, market_exposure]
        X = np.random.rand(n_samples, 10)
        
        # Realistic feature distributions
        X[:, 0] = np.random.randint(18, 80, n_samples)  # age
        X[:, 1] = np.random.lognormal(10, 1, n_samples)  # income
        X[:, 2] = np.random.uniform(300, 850, n_samples)  # credit_history
        X[:, 3] = np.random.lognormal(12, 2, n_samples)  # transaction_volume
        X[:, 4] = np.random.randint(1, 3650, n_samples)  # account_age
        X[:, 5] = np.random.beta(2, 8, n_samples)  # location_risk
        X[:, 6] = np.random.beta(2, 8, n_samples)  # device_risk
        X[:, 7] = np.random.uniform(0, 1, n_samples)  # behavioral_score
        X[:, 8] = np.random.uniform(0, 1, n_samples)  # compliance_score
        X[:, 9] = np.random.uniform(0, 1, n_samples)  # market_exposure
        
        # Scale features
        X_scaled = ml_models['scaler'].fit_transform(X)
        
        # Generate labels for different risk types
        
        # Credit risk (binary classification)
        y_credit = np.random.choice([0, 1], n_samples, p=[0.85, 0.15])
        # Higher risk for low credit history, high transaction volume
        high_risk_mask = (X[:, 2] < 500) | (X[:, 3] > np.percentile(X[:, 3], 90))
        y_credit[high_risk_mask] = np.random.choice([0, 1], np.sum(high_risk_mask), p=[0.3, 0.7])
        
        # Operational risk (regression)
        y_operational = (X[:, 7] * 0.3 + X[:, 8] * 0.4 + X[:, 5] * 0.3 + 
                        np.random.normal(0, 0.1, n_samples))
        y_operational = np.clip(y_operational, 0, 1)
        
        # Fraud risk (binary classification)
        y_fraud = np.random.choice([0, 1], n_samples, p=[0.95, 0.05])
        # Higher fraud risk for new accounts, high device risk
        fraud_risk_mask = (X[:, 4] < 30) | (X[:, 6] > 0.7)
        y_fraud[fraud_risk_mask] = np.random.choice([0, 1], np.sum(fraud_risk_mask), p=[0.7, 0.3])
        
        # Market risk (regression)
        y_market = X[:, 9] * 0.8 + np.random.normal(0, 0.1, n_samples)
        y_market = np.clip(y_market, 0, 1)
        
        # Train models
        ml_models['credit_risk'].fit(X_scaled, y_credit)
        ml_models['operational_risk'].fit(X_scaled, y_operational)
        ml_models['fraud_risk'].fit(X_scaled, y_fraud)
        ml_models['market_risk'].fit(X_scaled, y_market)
        
        # Evaluate models
        X_train, X_test, y_train, y_test = train_test_split(X_scaled, y_credit, test_size=0.2, random_state=42)
        credit_score = ml_models['credit_risk'].score(X_test, y_test)
        logger.info(f"Credit risk model accuracy: {credit_score:.3f}")
        
        logger.info("Initial model training completed")
        
    except Exception as e:
        logger.error(f"Initial model training failed: {e}")

async def init_risk_rules():
    """Initialize risk assessment rules"""
    global risk_rules
    
    try:
        # Define risk rules
        rules = [
            {
                'rule_id': 'high_transaction_volume',
                'rule_name': 'High Transaction Volume',
                'risk_type': RiskType.OPERATIONAL_RISK,
                'conditions': {
                    'daily_volume_threshold': 1000000,
                    'comparison': 'greater_than'
                },
                'threshold': 0.7,
                'action': 'ALERT'
            },
            {
                'rule_id': 'new_customer_high_amount',
                'rule_name': 'New Customer High Amount',
                'risk_type': RiskType.CREDIT_RISK,
                'conditions': {
                    'account_age_days': 30,
                    'transaction_amount': 100000,
                    'comparison': 'less_than_and_greater_than'
                },
                'threshold': 0.8,
                'action': 'REVIEW'
            },
            {
                'rule_id': 'multiple_failed_transactions',
                'rule_name': 'Multiple Failed Transactions',
                'risk_type': RiskType.FRAUD_RISK,
                'conditions': {
                    'failed_count': 5,
                    'time_window_hours': 24,
                    'comparison': 'greater_than'
                },
                'threshold': 0.9,
                'action': 'BLOCK'
            },
            {
                'rule_id': 'high_risk_location',
                'rule_name': 'High Risk Location',
                'risk_type': RiskType.COMPLIANCE_RISK,
                'conditions': {
                    'risk_countries': ['XX', 'YY', 'ZZ'],
                    'comparison': 'in_list'
                },
                'threshold': 0.8,
                'action': 'REVIEW'
            },
            {
                'rule_id': 'unusual_device_pattern',
                'rule_name': 'Unusual Device Pattern',
                'risk_type': RiskType.TECHNOLOGY_RISK,
                'conditions': {
                    'device_changes': 3,
                    'time_window_days': 7,
                    'comparison': 'greater_than'
                },
                'threshold': 0.6,
                'action': 'ALERT'
            }
        ]
        
        # Store rules in memory and database
        for rule_data in rules:
            rule = RiskRule(
                rule_id=rule_data['rule_id'],
                rule_name=rule_data['rule_name'],
                risk_type=rule_data['risk_type'],
                conditions=rule_data['conditions'],
                threshold=rule_data['threshold'],
                action=rule_data['action']
            )
            
            risk_rules[rule.rule_id] = rule
            
            # Store in database
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO risk_rules 
                    (rule_id, rule_name, risk_type, conditions, threshold, action)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (rule_id) DO UPDATE SET
                    rule_name = EXCLUDED.rule_name,
                    risk_type = EXCLUDED.risk_type,
                    conditions = EXCLUDED.conditions,
                    threshold = EXCLUDED.threshold,
                    action = EXCLUDED.action,
                    updated_at = CURRENT_TIMESTAMP
                """, 
                rule.rule_id, rule.rule_name, rule.risk_type.value,
                json.dumps(rule.conditions), rule.threshold, rule.action
                )
        
        logger.info(f"Initialized {len(rules)} risk assessment rules")
        
    except Exception as e:
        logger.error(f"Risk rules initialization failed: {e}")

# Risk assessment engine
class RiskAssessmentEngine:
    """Main risk assessment processing engine"""
    
    def __init__(self):
        self.assessment_cache = {}
        
    async def assess_risk(self, request: RiskAssessmentRequest) -> RiskAssessment:
        """Comprehensive risk assessment"""
        try:
            assessment_id = f"risk_{request.entity_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
            
            # Extract features from data
            features = await self._extract_features(request.data, request.entity_type)
            
            # Calculate risk scores for each requested type
            risk_scores = []
            for risk_type in request.assessment_type:
                score = await self._calculate_risk_score(risk_type, features, request.data)
                risk_scores.append(score)
            
            # Calculate overall risk
            overall_score, overall_level = await self._calculate_overall_risk(risk_scores)
            
            # Create assessment
            assessment = RiskAssessment(
                assessment_id=assessment_id,
                entity_id=request.entity_id,
                entity_type=request.entity_type,
                overall_risk_score=overall_score,
                overall_risk_level=overall_level,
                risk_scores=risk_scores,
                status=AssessmentStatus.COMPLETED,
                created_at=datetime.now(),
                completed_at=datetime.now(),
                assessed_by=request.requested_by,
                expires_at=datetime.now() + timedelta(days=30)
            )
            
            # Store assessment
            await self._store_assessment(assessment)
            
            # Update risk profile
            await self._update_risk_profile(assessment)
            
            # Check for alerts
            await self._check_risk_alerts(assessment)
            
            return assessment
            
        except Exception as e:
            logger.error(f"Risk assessment failed for {request.entity_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Risk assessment failed: {str(e)}")
    
    async def _extract_features(self, data: Dict[str, Any], entity_type: RiskCategory) -> np.ndarray:
        """Extract features for ML models"""
        try:
            if entity_type == RiskCategory.CUSTOMER:
                features = [
                    data.get('age', 35),
                    data.get('income', 50000),
                    data.get('credit_score', 650),
                    data.get('transaction_volume', 100000),
                    data.get('account_age_days', 365),
                    data.get('location_risk', 0.3),
                    data.get('device_risk', 0.2),
                    data.get('behavioral_score', 0.7),
                    data.get('compliance_score', 0.8),
                    data.get('market_exposure', 0.1)
                ]
            elif entity_type == RiskCategory.AGENT:
                features = [
                    data.get('agent_age', 30),
                    data.get('agent_income', 75000),
                    data.get('performance_score', 750),
                    data.get('monthly_volume', 500000),
                    data.get('tenure_days', 730),
                    data.get('location_risk', 0.2),
                    data.get('system_risk', 0.1),
                    data.get('compliance_score', 0.9),
                    data.get('customer_satisfaction', 0.85),
                    data.get('fraud_incidents', 0.05)
                ]
            elif entity_type == RiskCategory.TRANSACTION:
                features = [
                    data.get('amount', 25000),
                    data.get('sender_risk', 0.3),
                    data.get('receiver_risk', 0.3),
                    data.get('channel_risk', 0.2),
                    data.get('time_risk', 0.1),
                    data.get('location_risk', 0.3),
                    data.get('device_risk', 0.2),
                    data.get('pattern_risk', 0.4),
                    data.get('velocity_risk', 0.3),
                    data.get('compliance_risk', 0.1)
                ]
            else:
                # Default features
                features = [0.5] * 10
            
            return np.array(features).reshape(1, -1)
            
        except Exception as e:
            logger.error(f"Feature extraction failed: {e}")
            return np.array([0.5] * 10).reshape(1, -1)
    
    async def _calculate_risk_score(self, risk_type: RiskType, features: np.ndarray, 
                                  data: Dict[str, Any]) -> RiskScore:
        """Calculate risk score for specific risk type"""
        try:
            # Scale features
            features_scaled = ml_models['scaler'].transform(features)
            
            # Calculate ML score
            if risk_type == RiskType.CREDIT_RISK:
                ml_score = ml_models['credit_risk'].predict_proba(features_scaled)[0][1]
            elif risk_type == RiskType.OPERATIONAL_RISK:
                ml_score = ml_models['operational_risk'].predict(features_scaled)[0]
            elif risk_type == RiskType.FRAUD_RISK:
                ml_score = ml_models['fraud_risk'].predict_proba(features_scaled)[0][1]
            elif risk_type == RiskType.MARKET_RISK:
                ml_score = ml_models['market_risk'].predict(features_scaled)[0]
            else:
                # For other risk types, use rule-based scoring
                ml_score = await self._rule_based_score(risk_type, data)
            
            # Apply rule-based adjustments
            rule_adjustment = await self._apply_risk_rules(risk_type, data)
            
            # Combine scores
            final_score = min(1.0, max(0.0, ml_score + rule_adjustment))
            
            # Determine risk level
            risk_level = self._determine_risk_level(final_score)
            
            # Calculate confidence
            confidence = self._calculate_confidence(ml_score, rule_adjustment)
            
            # Identify risk factors
            risk_factors = await self._identify_risk_factors(risk_type, data, features)
            
            # Generate recommendations
            recommendations = await self._generate_recommendations(risk_type, risk_level, risk_factors)
            
            return RiskScore(
                risk_type=risk_type,
                score=final_score,
                level=risk_level,
                confidence=confidence,
                factors=risk_factors,
                recommendations=recommendations
            )
            
        except Exception as e:
            logger.error(f"Risk score calculation failed for {risk_type}: {e}")
            return RiskScore(
                risk_type=risk_type,
                score=0.5,
                level=RiskLevel.MEDIUM,
                confidence=0.5,
                factors=["Assessment error"],
                recommendations=["Manual review required"]
            )
    
    async def _rule_based_score(self, risk_type: RiskType, data: Dict[str, Any]) -> float:
        """Calculate rule-based risk score"""
        try:
            score = 0.0
            rule_count = 0
            
            for rule_id, rule in risk_rules.items():
                if rule.risk_type == risk_type and rule.enabled:
                    if await self._evaluate_rule(rule, data):
                        score += rule.threshold
                        rule_count += 1
            
            return score / max(1, rule_count) if rule_count > 0 else 0.3
            
        except Exception as e:
            logger.error(f"Rule-based scoring failed: {e}")
            return 0.3
    
    async def _apply_risk_rules(self, risk_type: RiskType, data: Dict[str, Any]) -> float:
        """Apply risk rules and return adjustment"""
        try:
            adjustment = 0.0
            
            for rule_id, rule in risk_rules.items():
                if rule.risk_type == risk_type and rule.enabled:
                    if await self._evaluate_rule(rule, data):
                        if rule.action == 'BLOCK':
                            adjustment += 0.3
                        elif rule.action == 'REVIEW':
                            adjustment += 0.2
                        elif rule.action == 'ALERT':
                            adjustment += 0.1
            
            return min(0.5, adjustment)  # Cap adjustment at 0.5
            
        except Exception as e:
            logger.error(f"Risk rule application failed: {e}")
            return 0.0
    
    async def _evaluate_rule(self, rule: RiskRule, data: Dict[str, Any]) -> bool:
        """Evaluate a single risk rule"""
        try:
            conditions = rule.conditions
            
            if rule.rule_id == 'high_transaction_volume':
                daily_volume = data.get('daily_volume', 0)
                return daily_volume > conditions['daily_volume_threshold']
            
            elif rule.rule_id == 'new_customer_high_amount':
                account_age = data.get('account_age_days', 365)
                amount = data.get('amount', 0)
                return account_age < conditions['account_age_days'] and amount > conditions['transaction_amount']
            
            elif rule.rule_id == 'multiple_failed_transactions':
                failed_count = data.get('failed_transactions_24h', 0)
                return failed_count > conditions['failed_count']
            
            elif rule.rule_id == 'high_risk_location':
                country = data.get('country', 'NG')
                return country in conditions['risk_countries']
            
            elif rule.rule_id == 'unusual_device_pattern':
                device_changes = data.get('device_changes_7d', 0)
                return device_changes > conditions['device_changes']
            
            return False
            
        except Exception as e:
            logger.error(f"Rule evaluation failed for {rule.rule_id}: {e}")
            return False
    
    def _determine_risk_level(self, score: float) -> RiskLevel:
        """Determine risk level based on score"""
        if score >= 0.9:
            return RiskLevel.CRITICAL
        elif score >= 0.75:
            return RiskLevel.VERY_HIGH
        elif score >= 0.6:
            return RiskLevel.HIGH
        elif score >= 0.4:
            return RiskLevel.MEDIUM
        elif score >= 0.2:
            return RiskLevel.LOW
        else:
            return RiskLevel.VERY_LOW
    
    def _calculate_confidence(self, ml_score: float, rule_adjustment: float) -> float:
        """Calculate confidence in risk assessment"""
        # Higher confidence when ML and rules agree
        if rule_adjustment > 0 and ml_score > 0.5:
            return min(1.0, 0.8 + rule_adjustment)
        elif rule_adjustment == 0 and ml_score < 0.5:
            return min(1.0, 0.7 + (0.5 - ml_score))
        else:
            return 0.6  # Moderate confidence when they disagree
    
    async def _identify_risk_factors(self, risk_type: RiskType, data: Dict[str, Any], 
                                   features: np.ndarray) -> List[str]:
        """Identify specific risk factors"""
        factors = []
        
        if risk_type == RiskType.CREDIT_RISK:
            if data.get('credit_score', 650) < 500:
                factors.append("Low credit score")
            if data.get('account_age_days', 365) < 90:
                factors.append("New customer")
            if data.get('income', 50000) < 30000:
                factors.append("Low income")
        
        elif risk_type == RiskType.FRAUD_RISK:
            if data.get('device_risk', 0.2) > 0.7:
                factors.append("High-risk device")
            if data.get('location_risk', 0.3) > 0.7:
                factors.append("High-risk location")
            if data.get('velocity_risk', 0.3) > 0.6:
                factors.append("High transaction velocity")
        
        elif risk_type == RiskType.OPERATIONAL_RISK:
            if data.get('system_downtime', 0) > 0.05:
                factors.append("High system downtime")
            if data.get('error_rate', 0) > 0.02:
                factors.append("High error rate")
        
        # Add generic factors if none found
        if not factors:
            factors.append("Standard risk assessment")
        
        return factors
    
    async def _generate_recommendations(self, risk_type: RiskType, risk_level: RiskLevel, 
                                      risk_factors: List[str]) -> List[str]:
        """Generate risk mitigation recommendations"""
        recommendations = []
        
        if risk_level in [RiskLevel.HIGH, RiskLevel.VERY_HIGH, RiskLevel.CRITICAL]:
            recommendations.append("Immediate manual review required")
            
            if risk_type == RiskType.CREDIT_RISK:
                recommendations.extend([
                    "Verify customer identity and income",
                    "Request additional documentation",
                    "Consider lower credit limits"
                ])
            elif risk_type == RiskType.FRAUD_RISK:
                recommendations.extend([
                    "Enhanced transaction monitoring",
                    "Multi-factor authentication",
                    "Contact customer for verification"
                ])
            elif risk_type == RiskType.OPERATIONAL_RISK:
                recommendations.extend([
                    "Implement additional controls",
                    "Increase monitoring frequency",
                    "Review operational procedures"
                ])
        
        elif risk_level == RiskLevel.MEDIUM:
            recommendations.extend([
                "Enhanced monitoring",
                "Periodic review",
                "Standard risk controls"
            ])
        
        else:
            recommendations.append("Standard monitoring")
        
        return recommendations
    
    async def _calculate_overall_risk(self, risk_scores: List[RiskScore]) -> tuple:
        """Calculate overall risk score and level"""
        if not risk_scores:
            return 0.3, RiskLevel.MEDIUM
        
        # Weight different risk types
        weights = {
            RiskType.CREDIT_RISK: 0.25,
            RiskType.FRAUD_RISK: 0.25,
            RiskType.OPERATIONAL_RISK: 0.20,
            RiskType.COMPLIANCE_RISK: 0.15,
            RiskType.MARKET_RISK: 0.10,
            RiskType.LIQUIDITY_RISK: 0.05
        }
        
        weighted_score = 0.0
        total_weight = 0.0
        
        for score in risk_scores:
            weight = weights.get(score.risk_type, 0.1)
            weighted_score += score.score * weight
            total_weight += weight
        
        overall_score = weighted_score / max(total_weight, 0.1)
        overall_level = self._determine_risk_level(overall_score)
        
        return overall_score, overall_level
    
    async def _store_assessment(self, assessment: RiskAssessment):
        """Store risk assessment"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO risk_assessments 
                (assessment_id, entity_id, entity_type, overall_risk_score, overall_risk_level,
                 risk_scores, status, completed_at, assessed_by, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, 
            assessment.assessment_id, assessment.entity_id, assessment.entity_type.value,
            assessment.overall_risk_score, assessment.overall_risk_level.value,
            json.dumps([score.dict() for score in assessment.risk_scores]),
            assessment.status.value, assessment.completed_at, assessment.assessed_by,
            assessment.expires_at
            )
    
    async def _update_risk_profile(self, assessment: RiskAssessment):
        """Update entity risk profile"""
        try:
            # Get existing profile
            async with db_pool.acquire() as conn:
                existing_profile = await conn.fetchrow("""
                    SELECT * FROM risk_profiles WHERE entity_id = $1
                """, assessment.entity_id)
                
                if existing_profile:
                    risk_history = json.loads(existing_profile['risk_history'] or '[]')
                    risk_factors = json.loads(existing_profile['risk_factors'] or '{}')
                else:
                    risk_history = []
                    risk_factors = {}
                
                # Add current assessment to history
                risk_history.append({
                    'assessment_id': assessment.assessment_id,
                    'risk_score': assessment.overall_risk_score,
                    'risk_level': assessment.overall_risk_level.value,
                    'date': assessment.completed_at.isoformat()
                })
                
                # Keep only last 50 assessments
                risk_history = risk_history[-50:]
                
                # Update risk factors
                for score in assessment.risk_scores:
                    risk_factors[score.risk_type.value] = {
                        'score': score.score,
                        'level': score.level.value,
                        'factors': score.factors
                    }
                
                # Calculate next review date
                if assessment.overall_risk_level in [RiskLevel.HIGH, RiskLevel.VERY_HIGH, RiskLevel.CRITICAL]:
                    next_review = datetime.now() + timedelta(days=7)
                elif assessment.overall_risk_level == RiskLevel.MEDIUM:
                    next_review = datetime.now() + timedelta(days=30)
                else:
                    next_review = datetime.now() + timedelta(days=90)
                
                # Store updated profile
                await conn.execute("""
                    INSERT INTO risk_profiles 
                    (entity_id, entity_type, current_risk_level, risk_history, risk_factors,
                     mitigation_measures, last_assessment, next_review_date)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (entity_id) DO UPDATE SET
                    current_risk_level = EXCLUDED.current_risk_level,
                    risk_history = EXCLUDED.risk_history,
                    risk_factors = EXCLUDED.risk_factors,
                    last_assessment = EXCLUDED.last_assessment,
                    next_review_date = EXCLUDED.next_review_date,
                    updated_at = CURRENT_TIMESTAMP
                """, 
                assessment.entity_id, assessment.entity_type.value,
                assessment.overall_risk_level.value, json.dumps(risk_history),
                json.dumps(risk_factors), json.dumps([]),
                assessment.completed_at, next_review
                )
                
        except Exception as e:
            logger.error(f"Risk profile update failed: {e}")
    
    async def _check_risk_alerts(self, assessment: RiskAssessment):
        """Check if alerts should be generated"""
        try:
            if assessment.overall_risk_level in [RiskLevel.HIGH, RiskLevel.VERY_HIGH, RiskLevel.CRITICAL]:
                alert_id = f"alert_{assessment.entity_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
                
                severity = "CRITICAL" if assessment.overall_risk_level == RiskLevel.CRITICAL else "HIGH"
                
                alert = RiskAlert(
                    alert_id=alert_id,
                    entity_id=assessment.entity_id,
                    risk_type=RiskType.OPERATIONAL_RISK,  # Default type for overall alerts
                    severity=severity,
                    description=f"High risk detected: {assessment.overall_risk_level.value}",
                    triggered_at=datetime.now()
                )
                
                # Store alert
                await self._store_alert(alert)
                
                # Send notification (simulate)
                await self._send_alert_notification(alert)
                
        except Exception as e:
            logger.error(f"Risk alert check failed: {e}")
    
    async def _store_alert(self, alert: RiskAlert):
        """Store risk alert"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO risk_alerts 
                (alert_id, entity_id, risk_type, severity, description)
                VALUES ($1, $2, $3, $4, $5)
            """, 
            alert.alert_id, alert.entity_id, alert.risk_type.value,
            alert.severity, alert.description
            )
    
    async def _send_alert_notification(self, alert: RiskAlert):
        """Send alert notification"""
        try:
            # Store in Redis for real-time notifications
            notification_data = {
                'alert_id': alert.alert_id,
                'entity_id': alert.entity_id,
                'severity': alert.severity,
                'description': alert.description,
                'timestamp': alert.triggered_at.isoformat()
            }
            
            await redis_client.lpush('risk_alerts', json.dumps(notification_data))
            await redis_client.expire('risk_alerts', 3600)  # Expire after 1 hour
            
            logger.info(f"Risk alert notification sent: {alert.alert_id}")
            
        except Exception as e:
            logger.error(f"Alert notification failed: {e}")

# Initialize risk assessment engine
risk_engine = RiskAssessmentEngine()

# API endpoints
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    await init_database()
    await init_redis()
    await init_ml_models()
    await init_risk_rules()

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
            "service": "risk-assessment",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "ml_models": "loaded" if ml_models else "not_loaded",
            "risk_rules": len(risk_rules)
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/assess", response_model=RiskAssessment)
async def assess_risk(request: RiskAssessmentRequest):
    """Perform risk assessment"""
    return await risk_engine.assess_risk(request)

@app.get("/api/v1/profile/{entity_id}")
async def get_risk_profile(entity_id: str):
    """Get risk profile for entity"""
    try:
        async with db_pool.acquire() as conn:
            profile = await conn.fetchrow("""
                SELECT * FROM risk_profiles WHERE entity_id = $1
            """, entity_id)
            
            if not profile:
                raise HTTPException(status_code=404, detail="Risk profile not found")
            
            return {
                "entity_id": profile['entity_id'],
                "entity_type": profile['entity_type'],
                "current_risk_level": profile['current_risk_level'],
                "risk_history": json.loads(profile['risk_history'] or '[]'),
                "risk_factors": json.loads(profile['risk_factors'] or '{}'),
                "mitigation_measures": json.loads(profile['mitigation_measures'] or '[]'),
                "last_assessment": profile['last_assessment'].isoformat() if profile['last_assessment'] else None,
                "next_review_date": profile['next_review_date'].isoformat() if profile['next_review_date'] else None
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get profile: {str(e)}")

@app.get("/api/v1/alerts")
async def get_risk_alerts(
    entity_id: Optional[str] = None,
    risk_type: Optional[RiskType] = None,
    resolved: Optional[bool] = None,
    limit: int = 100
):
    """Get risk alerts"""
    try:
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM risk_alerts WHERE 1=1"
            params = []
            
            if entity_id:
                query += f" AND entity_id = ${len(params) + 1}"
                params.append(entity_id)
            
            if risk_type:
                query += f" AND risk_type = ${len(params) + 1}"
                params.append(risk_type.value)
            
            if resolved is not None:
                query += f" AND resolved = ${len(params) + 1}"
                params.append(resolved)
            
            query += f" ORDER BY triggered_at DESC LIMIT ${len(params) + 1}"
            params.append(limit)
            
            alerts = await conn.fetch(query, *params)
            
            return [
                {
                    "alert_id": row['alert_id'],
                    "entity_id": row['entity_id'],
                    "risk_type": row['risk_type'],
                    "severity": row['severity'],
                    "description": row['description'],
                    "triggered_at": row['triggered_at'].isoformat(),
                    "resolved": row['resolved']
                }
                for row in alerts
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get alerts: {str(e)}")

@app.get("/api/v1/rules")
async def get_risk_rules():
    """Get risk assessment rules"""
    return [
        {
            "rule_id": rule.rule_id,
            "rule_name": rule.rule_name,
            "risk_type": rule.risk_type.value,
            "conditions": rule.conditions,
            "threshold": rule.threshold,
            "action": rule.action,
            "enabled": rule.enabled
        }
        for rule in risk_rules.values()
    ]

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

