#!/usr/bin/env python3
"""
Insurance Suite Service
Comprehensive insurance management platform for remittance network
Handles policy management, claims processing, risk assessment, and premium calculations
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from decimal import Decimal
from enum import Enum
import asyncpg
import aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import numpy as np
from sklearn.ensemble import RandomForestRegressor, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
import joblib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8133"))

# FastAPI app
app = FastAPI(
    title="Insurance Suite",
    description="Comprehensive insurance management platform for remittance network",
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

# Enums
class PolicyStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PENDING = "PENDING"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"
    SUSPENDED = "SUSPENDED"

class PolicyType(str, Enum):
    LIFE = "LIFE"
    HEALTH = "HEALTH"
    AUTO = "AUTO"
    HOME = "HOME"
    BUSINESS = "BUSINESS"
    TRAVEL = "TRAVEL"
    DISABILITY = "DISABILITY"

class ClaimStatus(str, Enum):
    SUBMITTED = "SUBMITTED"
    UNDER_REVIEW = "UNDER_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    PAID = "PAID"
    CLOSED = "CLOSED"

class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"

class PaymentFrequency(str, Enum):
    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    SEMI_ANNUAL = "SEMI_ANNUAL"
    ANNUAL = "ANNUAL"

# Pydantic models
class PolicyApplication(BaseModel):
    application_id: Optional[str] = None
    applicant_id: str
    agent_id: str
    policy_type: PolicyType
    coverage_amount: Decimal
    premium_frequency: PaymentFrequency
    beneficiaries: List[Dict[str, Any]]
    medical_info: Optional[Dict[str, Any]] = None
    financial_info: Dict[str, Any]
    additional_info: Optional[Dict[str, Any]] = None

class InsurancePolicy(BaseModel):
    policy_id: str
    policy_number: str
    policyholder_id: str
    agent_id: str
    policy_type: PolicyType
    status: PolicyStatus
    coverage_amount: Decimal
    premium_amount: Decimal
    payment_frequency: PaymentFrequency
    start_date: datetime
    end_date: datetime
    beneficiaries: List[Dict[str, Any]]
    terms_conditions: Dict[str, Any]

class ClaimRequest(BaseModel):
    claim_id: Optional[str] = None
    policy_id: str
    claimant_id: str
    claim_type: str
    incident_date: datetime
    claim_amount: Decimal
    description: str
    supporting_documents: List[str]
    witness_info: Optional[Dict[str, Any]] = None

class InsuranceClaim(BaseModel):
    claim_id: str
    policy_id: str
    claimant_id: str
    claim_type: str
    status: ClaimStatus
    incident_date: datetime
    claim_amount: Decimal
    approved_amount: Optional[Decimal] = None
    description: str
    adjuster_notes: Optional[str] = None
    created_at: datetime
    processed_at: Optional[datetime] = None

class RiskAssessment(BaseModel):
    assessment_id: str
    applicant_id: str
    policy_type: PolicyType
    risk_level: RiskLevel
    risk_score: float
    risk_factors: List[str]
    recommendations: List[str]
    premium_adjustment: float
    assessment_date: datetime

class PremiumCalculation(BaseModel):
    calculation_id: str
    policy_type: PolicyType
    base_premium: Decimal
    risk_multiplier: float
    discounts: List[Dict[str, Any]]
    surcharges: List[Dict[str, Any]]
    final_premium: Decimal
    calculation_details: Dict[str, Any]

# Database functions
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS insurance_policies (
                    id SERIAL PRIMARY KEY,
                    policy_id VARCHAR(255) UNIQUE NOT NULL,
                    policy_number VARCHAR(100) UNIQUE NOT NULL,
                    policyholder_id VARCHAR(255) NOT NULL,
                    agent_id VARCHAR(255) NOT NULL,
                    policy_type VARCHAR(20) NOT NULL,
                    status VARCHAR(20) DEFAULT 'PENDING',
                    coverage_amount DECIMAL(15,2) NOT NULL,
                    premium_amount DECIMAL(10,2) NOT NULL,
                    payment_frequency VARCHAR(20) NOT NULL,
                    start_date DATE NOT NULL,
                    end_date DATE NOT NULL,
                    beneficiaries JSONB,
                    terms_conditions JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_policy_id (policy_id),
                    INDEX idx_policy_number (policy_number),
                    INDEX idx_policyholder_id (policyholder_id),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_status (status),
                    INDEX idx_policy_type (policy_type)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS insurance_claims (
                    id SERIAL PRIMARY KEY,
                    claim_id VARCHAR(255) UNIQUE NOT NULL,
                    policy_id VARCHAR(255) NOT NULL,
                    claimant_id VARCHAR(255) NOT NULL,
                    claim_type VARCHAR(100) NOT NULL,
                    status VARCHAR(20) DEFAULT 'SUBMITTED',
                    incident_date DATE NOT NULL,
                    claim_amount DECIMAL(15,2) NOT NULL,
                    approved_amount DECIMAL(15,2),
                    description TEXT,
                    adjuster_notes TEXT,
                    supporting_documents JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed_at TIMESTAMP,
                    INDEX idx_claim_id (claim_id),
                    INDEX idx_policy_id (policy_id),
                    INDEX idx_claimant_id (claimant_id),
                    INDEX idx_status (status),
                    INDEX idx_incident_date (incident_date),
                    FOREIGN KEY (policy_id) REFERENCES insurance_policies(policy_id)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_assessments (
                    id SERIAL PRIMARY KEY,
                    assessment_id VARCHAR(255) UNIQUE NOT NULL,
                    applicant_id VARCHAR(255) NOT NULL,
                    policy_type VARCHAR(20) NOT NULL,
                    risk_level VARCHAR(20) NOT NULL,
                    risk_score DECIMAL(5,4) NOT NULL,
                    risk_factors JSONB,
                    recommendations JSONB,
                    premium_adjustment DECIMAL(5,4) DEFAULT 1.0,
                    assessment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_assessment_id (assessment_id),
                    INDEX idx_applicant_id (applicant_id),
                    INDEX idx_policy_type (policy_type),
                    INDEX idx_risk_level (risk_level)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS premium_calculations (
                    id SERIAL PRIMARY KEY,
                    calculation_id VARCHAR(255) UNIQUE NOT NULL,
                    policy_type VARCHAR(20) NOT NULL,
                    base_premium DECIMAL(10,2) NOT NULL,
                    risk_multiplier DECIMAL(5,4) DEFAULT 1.0,
                    discounts JSONB,
                    surcharges JSONB,
                    final_premium DECIMAL(10,2) NOT NULL,
                    calculation_details JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_calculation_id (calculation_id),
                    INDEX idx_policy_type (policy_type)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS policy_applications (
                    id SERIAL PRIMARY KEY,
                    application_id VARCHAR(255) UNIQUE NOT NULL,
                    applicant_id VARCHAR(255) NOT NULL,
                    agent_id VARCHAR(255) NOT NULL,
                    policy_type VARCHAR(20) NOT NULL,
                    coverage_amount DECIMAL(15,2) NOT NULL,
                    premium_frequency VARCHAR(20) NOT NULL,
                    application_status VARCHAR(20) DEFAULT 'SUBMITTED',
                    beneficiaries JSONB,
                    medical_info JSONB,
                    financial_info JSONB,
                    additional_info JSONB,
                    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed_at TIMESTAMP,
                    INDEX idx_application_id (application_id),
                    INDEX idx_applicant_id (applicant_id),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_status (application_status)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS premium_payments (
                    id SERIAL PRIMARY KEY,
                    payment_id VARCHAR(255) UNIQUE NOT NULL,
                    policy_id VARCHAR(255) NOT NULL,
                    payment_amount DECIMAL(10,2) NOT NULL,
                    payment_date DATE NOT NULL,
                    due_date DATE NOT NULL,
                    payment_method VARCHAR(50),
                    payment_status VARCHAR(20) DEFAULT 'PENDING',
                    transaction_id VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_payment_id (payment_id),
                    INDEX idx_policy_id (policy_id),
                    INDEX idx_payment_date (payment_date),
                    INDEX idx_payment_status (payment_status),
                    FOREIGN KEY (policy_id) REFERENCES insurance_policies(policy_id)
                )
            """)
        
        # Initialize base premium rates
        await init_base_premium_rates()
        
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
        # Risk assessment model
        ml_models['risk_assessor'] = GradientBoostingClassifier(
            n_estimators=100,
            random_state=42
        )
        
        # Premium calculation model
        ml_models['premium_calculator'] = RandomForestRegressor(
            n_estimators=100,
            random_state=42
        )
        
        # Claims fraud detection model
        ml_models['fraud_detector'] = GradientBoostingClassifier(
            n_estimators=100,
            random_state=42
        )
        
        # Feature scaler
        ml_models['scaler'] = StandardScaler()
        
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
        n_samples = 1000
        
        # Features: age, income, health_score, credit_score, coverage_amount
        X = np.random.rand(n_samples, 5)
        X[:, 0] = np.random.randint(18, 80, n_samples)  # age
        X[:, 1] = np.random.lognormal(10, 1, n_samples)  # income
        X[:, 2] = np.random.beta(6, 2, n_samples) * 100  # health_score
        X[:, 3] = np.random.randint(300, 850, n_samples)  # credit_score
        X[:, 4] = np.random.uniform(10000, 1000000, n_samples)  # coverage_amount
        
        # Risk labels (0: Low, 1: Medium, 2: High, 3: Very High)
        y_risk = np.random.choice([0, 1, 2, 3], n_samples, p=[0.4, 0.3, 0.2, 0.1])
        
        # Premium amounts (based on risk and coverage)
        y_premium = X[:, 4] * 0.01 * (1 + y_risk * 0.5) + np.random.normal(0, 100, n_samples)
        
        # Fraud labels (0: Not fraud, 1: Fraud)
        y_fraud = np.random.choice([0, 1], n_samples, p=[0.95, 0.05])
        
        # Scale features
        X_scaled = ml_models['scaler'].fit_transform(X)
        
        # Train models
        ml_models['risk_assessor'].fit(X_scaled, y_risk)
        ml_models['premium_calculator'].fit(X_scaled, y_premium)
        ml_models['fraud_detector'].fit(X_scaled, y_fraud)
        
        logger.info("Initial model training completed")
        
    except Exception as e:
        logger.error(f"Initial model training failed: {e}")

async def init_base_premium_rates():
    """Initialize base premium rates for different policy types"""
    base_rates = {
        PolicyType.LIFE: {
            "base_rate": 0.005,  # 0.5% of coverage amount annually
            "age_factor": 0.02,
            "health_factor": 0.03
        },
        PolicyType.HEALTH: {
            "base_rate": 0.08,  # 8% of coverage amount annually
            "age_factor": 0.01,
            "health_factor": 0.05
        },
        PolicyType.AUTO: {
            "base_rate": 0.15,  # 15% of vehicle value annually
            "age_factor": -0.01,  # Younger drivers pay more
            "driving_record_factor": 0.1
        },
        PolicyType.HOME: {
            "base_rate": 0.003,  # 0.3% of home value annually
            "location_factor": 0.02,
            "security_factor": -0.01
        },
        PolicyType.BUSINESS: {
            "base_rate": 0.02,  # 2% of business value annually
            "industry_factor": 0.05,
            "size_factor": 0.01
        },
        PolicyType.TRAVEL: {
            "base_rate": 0.05,  # 5% of trip cost
            "destination_factor": 0.03,
            "duration_factor": 0.01
        },
        PolicyType.DISABILITY: {
            "base_rate": 0.02,  # 2% of annual income
            "occupation_factor": 0.03,
            "health_factor": 0.04
        }
    }
    
    # Store in Redis for quick access
    try:
        await redis_client.set("base_premium_rates", json.dumps(base_rates, default=str))
        logger.info("Base premium rates initialized")
    except Exception as e:
        logger.error(f"Failed to initialize base rates: {e}")

# Insurance engine
class InsuranceSuite:
    """Main insurance management engine"""
    
    def __init__(self):
        self.policy_cache = {}
        
    async def process_policy_application(self, application: PolicyApplication) -> Dict[str, Any]:
        """Process insurance policy application"""
        try:
            # Generate application ID if not provided
            if not application.application_id:
                application.application_id = f"app_{datetime.now().strftime('%Y%m%d%H%M%S')}_{application.applicant_id}"
            
            # Perform risk assessment
            risk_assessment = await self._assess_risk(application)
            
            # Calculate premium
            premium_calc = await self._calculate_premium(application, risk_assessment)
            
            # Store application
            await self._store_policy_application(application)
            
            # Auto-approve low-risk applications
            if risk_assessment.risk_level in [RiskLevel.LOW, RiskLevel.MEDIUM]:
                policy = await self._create_policy(application, premium_calc)
                status = "APPROVED"
                policy_id = policy.policy_id
            else:
                status = "UNDER_REVIEW"
                policy_id = None
            
            return {
                "application_id": application.application_id,
                "status": status,
                "policy_id": policy_id,
                "risk_assessment": risk_assessment.dict(),
                "premium_calculation": premium_calc.dict(),
                "next_steps": self._get_next_steps(status, risk_assessment.risk_level)
            }
            
        except Exception as e:
            logger.error(f"Policy application processing failed: {e}")
            raise HTTPException(status_code=500, detail=f"Application processing failed: {str(e)}")
    
    async def submit_claim(self, claim_request: ClaimRequest) -> InsuranceClaim:
        """Submit insurance claim"""
        try:
            # Generate claim ID if not provided
            if not claim_request.claim_id:
                claim_request.claim_id = f"claim_{datetime.now().strftime('%Y%m%d%H%M%S')}_{claim_request.policy_id}"
            
            # Validate policy
            policy = await self._get_policy(claim_request.policy_id)
            if not policy or policy['status'] != 'ACTIVE':
                raise HTTPException(status_code=400, detail="Invalid or inactive policy")
            
            # Perform fraud detection
            fraud_score = await self._detect_fraud(claim_request, policy)
            
            # Determine initial status
            if fraud_score > 0.8:
                status = ClaimStatus.UNDER_REVIEW
            elif claim_request.claim_amount <= policy['coverage_amount'] * 0.1:  # Small claims auto-approve
                status = ClaimStatus.APPROVED
            else:
                status = ClaimStatus.UNDER_REVIEW
            
            # Create claim
            claim = InsuranceClaim(
                claim_id=claim_request.claim_id,
                policy_id=claim_request.policy_id,
                claimant_id=claim_request.claimant_id,
                claim_type=claim_request.claim_type,
                status=status,
                incident_date=claim_request.incident_date,
                claim_amount=claim_request.claim_amount,
                approved_amount=claim_request.claim_amount if status == ClaimStatus.APPROVED else None,
                description=claim_request.description,
                created_at=datetime.now()
            )
            
            # Store claim
            await self._store_claim(claim, claim_request.supporting_documents, fraud_score)
            
            return claim
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Claim submission failed: {e}")
            raise HTTPException(status_code=500, detail=f"Claim submission failed: {str(e)}")
    
    async def process_claim(self, claim_id: str, action: str, adjuster_notes: str = None) -> Dict[str, Any]:
        """Process insurance claim (approve/reject)"""
        try:
            # Get claim
            claim = await self._get_claim(claim_id)
            if not claim:
                raise HTTPException(status_code=404, detail="Claim not found")
            
            # Update claim status
            if action.upper() == "APPROVE":
                new_status = ClaimStatus.APPROVED
                approved_amount = claim['claim_amount']
            elif action.upper() == "REJECT":
                new_status = ClaimStatus.REJECTED
                approved_amount = Decimal('0')
            else:
                raise HTTPException(status_code=400, detail="Invalid action")
            
            # Update claim in database
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE insurance_claims 
                    SET status = $1, approved_amount = $2, adjuster_notes = $3, processed_at = CURRENT_TIMESTAMP
                    WHERE claim_id = $4
                """, new_status.value, approved_amount, adjuster_notes, claim_id)
            
            # If approved, initiate payment
            if new_status == ClaimStatus.APPROVED:
                payment_result = await self._initiate_claim_payment(claim_id, approved_amount)
            else:
                payment_result = None
            
            return {
                "claim_id": claim_id,
                "status": new_status.value,
                "approved_amount": float(approved_amount),
                "adjuster_notes": adjuster_notes,
                "payment_initiated": payment_result is not None,
                "processed_at": datetime.now().isoformat()
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Claim processing failed: {e}")
            raise HTTPException(status_code=500, detail=f"Claim processing failed: {str(e)}")
    
    async def calculate_premium_quote(self, policy_type: PolicyType, coverage_amount: Decimal, 
                                    applicant_info: Dict[str, Any]) -> PremiumCalculation:
        """Calculate premium quote"""
        try:
            # Create temporary application for risk assessment
            temp_app = PolicyApplication(
                applicant_id=applicant_info.get('applicant_id', 'temp'),
                agent_id=applicant_info.get('agent_id', 'temp'),
                policy_type=policy_type,
                coverage_amount=coverage_amount,
                premium_frequency=PaymentFrequency.ANNUAL,
                beneficiaries=[],
                financial_info=applicant_info
            )
            
            # Assess risk
            risk_assessment = await self._assess_risk(temp_app)
            
            # Calculate premium
            premium_calc = await self._calculate_premium(temp_app, risk_assessment)
            
            return premium_calc
            
        except Exception as e:
            logger.error(f"Premium quote calculation failed: {e}")
            raise HTTPException(status_code=500, detail=f"Premium calculation failed: {str(e)}")
    
    async def get_policy_details(self, policy_id: str) -> Dict[str, Any]:
        """Get comprehensive policy details"""
        try:
            policy = await self._get_policy(policy_id)
            if not policy:
                raise HTTPException(status_code=404, detail="Policy not found")
            
            # Get related claims
            claims = await self._get_policy_claims(policy_id)
            
            # Get payment history
            payments = await self._get_policy_payments(policy_id)
            
            # Calculate policy metrics
            metrics = await self._calculate_policy_metrics(policy_id)
            
            return {
                "policy": dict(policy),
                "claims": claims,
                "payments": payments,
                "metrics": metrics
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to get policy details: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to get policy: {str(e)}")
    
    # Helper methods
    async def _assess_risk(self, application: PolicyApplication) -> RiskAssessment:
        """Assess risk for policy application"""
        try:
            # Extract features for ML model
            features = self._extract_risk_features(application)
            
            # Scale features
            features_scaled = ml_models['scaler'].transform([features])
            
            # Predict risk level
            risk_prediction = ml_models['risk_assessor'].predict(features_scaled)[0]
            risk_probabilities = ml_models['risk_assessor'].predict_proba(features_scaled)[0]
            
            # Map prediction to risk level
            risk_levels = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.VERY_HIGH]
            risk_level = risk_levels[risk_prediction]
            risk_score = max(risk_probabilities)
            
            # Identify risk factors
            risk_factors = self._identify_risk_factors(application, features)
            
            # Generate recommendations
            recommendations = self._generate_risk_recommendations(risk_level, risk_factors)
            
            # Calculate premium adjustment
            premium_adjustment = 1.0 + (risk_prediction * 0.25)  # 0%, 25%, 50%, 75% increase
            
            assessment = RiskAssessment(
                assessment_id=f"risk_{application.applicant_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
                applicant_id=application.applicant_id,
                policy_type=application.policy_type,
                risk_level=risk_level,
                risk_score=risk_score,
                risk_factors=risk_factors,
                recommendations=recommendations,
                premium_adjustment=premium_adjustment,
                assessment_date=datetime.now()
            )
            
            # Store assessment
            await self._store_risk_assessment(assessment)
            
            return assessment
            
        except Exception as e:
            logger.error(f"Risk assessment failed: {e}")
            raise
    
    async def _calculate_premium(self, application: PolicyApplication, risk_assessment: RiskAssessment) -> PremiumCalculation:
        """Calculate insurance premium"""
        try:
            # Get base rates
            base_rates_data = await redis_client.get("base_premium_rates")
            base_rates = json.loads(base_rates_data) if base_rates_data else {}
            
            policy_rates = base_rates.get(application.policy_type.value, {"base_rate": 0.01})
            
            # Calculate base premium
            base_premium = application.coverage_amount * Decimal(str(policy_rates["base_rate"]))
            
            # Apply risk multiplier
            risk_multiplier = risk_assessment.premium_adjustment
            
            # Calculate discounts
            discounts = self._calculate_discounts(application)
            total_discount = sum(discount['amount'] for discount in discounts)
            
            # Calculate surcharges
            surcharges = self._calculate_surcharges(application, risk_assessment)
            total_surcharge = sum(surcharge['amount'] for surcharge in surcharges)
            
            # Calculate final premium
            adjusted_premium = base_premium * Decimal(str(risk_multiplier))
            final_premium = adjusted_premium - Decimal(str(total_discount)) + Decimal(str(total_surcharge))
            
            # Adjust for payment frequency
            frequency_multiplier = self._get_frequency_multiplier(application.premium_frequency)
            final_premium = final_premium * Decimal(str(frequency_multiplier))
            
            calculation = PremiumCalculation(
                calculation_id=f"calc_{application.applicant_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
                policy_type=application.policy_type,
                base_premium=base_premium,
                risk_multiplier=risk_multiplier,
                discounts=discounts,
                surcharges=surcharges,
                final_premium=final_premium,
                calculation_details={
                    "coverage_amount": float(application.coverage_amount),
                    "base_rate": policy_rates["base_rate"],
                    "frequency_multiplier": frequency_multiplier,
                    "total_discount": total_discount,
                    "total_surcharge": total_surcharge
                }
            )
            
            # Store calculation
            await self._store_premium_calculation(calculation)
            
            return calculation
            
        except Exception as e:
            logger.error(f"Premium calculation failed: {e}")
            raise
    
    async def _detect_fraud(self, claim_request: ClaimRequest, policy: Dict) -> float:
        """Detect potential fraud in claim"""
        try:
            # Extract features for fraud detection
            features = self._extract_fraud_features(claim_request, policy)
            
            # Scale features
            features_scaled = ml_models['scaler'].transform([features])
            
            # Predict fraud probability
            fraud_probabilities = ml_models['fraud_detector'].predict_proba(features_scaled)[0]
            fraud_score = fraud_probabilities[1]  # Probability of fraud
            
            return fraud_score
            
        except Exception as e:
            logger.error(f"Fraud detection failed: {e}")
            return 0.0  # Default to no fraud if detection fails
    
    def _extract_risk_features(self, application: PolicyApplication) -> List[float]:
        """Extract features for risk assessment"""
        financial_info = application.financial_info
        
        # Default values if information is missing
        age = financial_info.get('age', 35)
        income = financial_info.get('annual_income', 50000)
        credit_score = financial_info.get('credit_score', 650)
        health_score = financial_info.get('health_score', 80)
        coverage_amount = float(application.coverage_amount)
        
        return [age, income, health_score, credit_score, coverage_amount]
    
    def _extract_fraud_features(self, claim_request: ClaimRequest, policy: Dict) -> List[float]:
        """Extract features for fraud detection"""
        # Calculate days between policy start and incident
        policy_start = datetime.strptime(policy['start_date'], '%Y-%m-%d') if isinstance(policy['start_date'], str) else policy['start_date']
        days_since_policy = (claim_request.incident_date - policy_start).days
        
        # Calculate claim to coverage ratio
        claim_ratio = float(claim_request.claim_amount) / float(policy['coverage_amount'])
        
        # Other features
        claim_amount = float(claim_request.claim_amount)
        premium_amount = float(policy['premium_amount'])
        
        return [days_since_policy, claim_ratio, claim_amount, premium_amount, len(claim_request.supporting_documents)]
    
    def _identify_risk_factors(self, application: PolicyApplication, features: List[float]) -> List[str]:
        """Identify specific risk factors"""
        risk_factors = []
        
        age, income, health_score, credit_score, coverage_amount = features
        
        if age > 65:
            risk_factors.append("Advanced age")
        if age < 25:
            risk_factors.append("Young age")
        if income < 30000:
            risk_factors.append("Low income")
        if credit_score < 600:
            risk_factors.append("Poor credit score")
        if health_score < 60:
            risk_factors.append("Poor health indicators")
        if coverage_amount > income * 10:
            risk_factors.append("High coverage relative to income")
        
        return risk_factors
    
    def _generate_risk_recommendations(self, risk_level: RiskLevel, risk_factors: List[str]) -> List[str]:
        """Generate risk mitigation recommendations"""
        recommendations = []
        
        if risk_level in [RiskLevel.HIGH, RiskLevel.VERY_HIGH]:
            recommendations.append("Require medical examination")
            recommendations.append("Verify income documentation")
            recommendations.append("Consider lower coverage amount")
        
        if "Poor credit score" in risk_factors:
            recommendations.append("Request credit report verification")
        
        if "Poor health indicators" in risk_factors:
            recommendations.append("Require comprehensive health screening")
        
        if not recommendations:
            recommendations.append("Standard underwriting process")
        
        return recommendations
    
    def _calculate_discounts(self, application: PolicyApplication) -> List[Dict[str, Any]]:
        """Calculate applicable discounts"""
        discounts = []
        
        financial_info = application.financial_info
        
        # Multi-policy discount
        if financial_info.get('existing_policies', 0) > 0:
            discounts.append({
                "type": "multi_policy",
                "description": "Multi-policy discount",
                "percentage": 10,
                "amount": float(application.coverage_amount) * 0.001  # 0.1% discount
            })
        
        # Good credit discount
        if financial_info.get('credit_score', 650) > 750:
            discounts.append({
                "type": "good_credit",
                "description": "Good credit score discount",
                "percentage": 5,
                "amount": float(application.coverage_amount) * 0.0005  # 0.05% discount
            })
        
        return discounts
    
    def _calculate_surcharges(self, application: PolicyApplication, risk_assessment: RiskAssessment) -> List[Dict[str, Any]]:
        """Calculate applicable surcharges"""
        surcharges = []
        
        # High risk surcharge
        if risk_assessment.risk_level == RiskLevel.VERY_HIGH:
            surcharges.append({
                "type": "high_risk",
                "description": "High risk surcharge",
                "percentage": 50,
                "amount": float(application.coverage_amount) * 0.005  # 0.5% surcharge
            })
        
        return surcharges
    
    def _get_frequency_multiplier(self, frequency: PaymentFrequency) -> float:
        """Get payment frequency multiplier"""
        multipliers = {
            PaymentFrequency.MONTHLY: 1.05,  # 5% surcharge for monthly
            PaymentFrequency.QUARTERLY: 1.02,  # 2% surcharge for quarterly
            PaymentFrequency.SEMI_ANNUAL: 1.01,  # 1% surcharge for semi-annual
            PaymentFrequency.ANNUAL: 1.0  # No surcharge for annual
        }
        return multipliers.get(frequency, 1.0)
    
    def _get_next_steps(self, status: str, risk_level: RiskLevel) -> List[str]:
        """Get next steps based on application status"""
        if status == "APPROVED":
            return ["Policy documents will be generated", "First premium payment due"]
        elif risk_level == RiskLevel.VERY_HIGH:
            return ["Manual underwriting review required", "Additional documentation needed"]
        else:
            return ["Application under review", "Decision within 5 business days"]
    
    async def _create_policy(self, application: PolicyApplication, premium_calc: PremiumCalculation) -> InsurancePolicy:
        """Create insurance policy from approved application"""
        policy_id = f"pol_{datetime.now().strftime('%Y%m%d%H%M%S')}_{application.applicant_id}"
        policy_number = f"POL-{datetime.now().strftime('%Y')}-{policy_id[-8:].upper()}"
        
        start_date = datetime.now()
        end_date = start_date + timedelta(days=365)  # 1 year policy
        
        policy = InsurancePolicy(
            policy_id=policy_id,
            policy_number=policy_number,
            policyholder_id=application.applicant_id,
            agent_id=application.agent_id,
            policy_type=application.policy_type,
            status=PolicyStatus.ACTIVE,
            coverage_amount=application.coverage_amount,
            premium_amount=premium_calc.final_premium,
            payment_frequency=application.premium_frequency,
            start_date=start_date,
            end_date=end_date,
            beneficiaries=application.beneficiaries,
            terms_conditions={}
        )
        
        # Store policy
        await self._store_policy(policy)
        
        return policy
    
    async def _initiate_claim_payment(self, claim_id: str, amount: Decimal) -> Dict[str, Any]:
        """Initiate claim payment"""
        # This would integrate with payment processing system
        # For now, simulate payment initiation
        payment_id = f"pay_{claim_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # Update claim status to PAID
        async with db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE insurance_claims 
                SET status = 'PAID'
                WHERE claim_id = $1
            """, claim_id)
        
        return {
            "payment_id": payment_id,
            "amount": float(amount),
            "status": "INITIATED",
            "estimated_completion": (datetime.now() + timedelta(days=3)).isoformat()
        }
    
    # Database operations
    async def _store_policy_application(self, application: PolicyApplication):
        """Store policy application"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO policy_applications 
                (application_id, applicant_id, agent_id, policy_type, coverage_amount,
                 premium_frequency, beneficiaries, medical_info, financial_info, additional_info)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, 
            application.application_id, application.applicant_id, application.agent_id,
            application.policy_type.value, application.coverage_amount,
            application.premium_frequency.value, json.dumps(application.beneficiaries),
            json.dumps(application.medical_info), json.dumps(application.financial_info),
            json.dumps(application.additional_info)
            )
    
    async def _store_policy(self, policy: InsurancePolicy):
        """Store insurance policy"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO insurance_policies 
                (policy_id, policy_number, policyholder_id, agent_id, policy_type, status,
                 coverage_amount, premium_amount, payment_frequency, start_date, end_date,
                 beneficiaries, terms_conditions)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            """, 
            policy.policy_id, policy.policy_number, policy.policyholder_id,
            policy.agent_id, policy.policy_type.value, policy.status.value,
            policy.coverage_amount, policy.premium_amount, policy.payment_frequency.value,
            policy.start_date.date(), policy.end_date.date(),
            json.dumps(policy.beneficiaries), json.dumps(policy.terms_conditions)
            )
    
    async def _store_claim(self, claim: InsuranceClaim, supporting_docs: List[str], fraud_score: float):
        """Store insurance claim"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO insurance_claims 
                (claim_id, policy_id, claimant_id, claim_type, status, incident_date,
                 claim_amount, approved_amount, description, supporting_documents)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, 
            claim.claim_id, claim.policy_id, claim.claimant_id, claim.claim_type,
            claim.status.value, claim.incident_date.date(), claim.claim_amount,
            claim.approved_amount, claim.description, json.dumps(supporting_docs)
            )
    
    async def _store_risk_assessment(self, assessment: RiskAssessment):
        """Store risk assessment"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO risk_assessments 
                (assessment_id, applicant_id, policy_type, risk_level, risk_score,
                 risk_factors, recommendations, premium_adjustment)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, 
            assessment.assessment_id, assessment.applicant_id, assessment.policy_type.value,
            assessment.risk_level.value, assessment.risk_score, json.dumps(assessment.risk_factors),
            json.dumps(assessment.recommendations), assessment.premium_adjustment
            )
    
    async def _store_premium_calculation(self, calculation: PremiumCalculation):
        """Store premium calculation"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO premium_calculations 
                (calculation_id, policy_type, base_premium, risk_multiplier, discounts,
                 surcharges, final_premium, calculation_details)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, 
            calculation.calculation_id, calculation.policy_type.value, calculation.base_premium,
            calculation.risk_multiplier, json.dumps(calculation.discounts),
            json.dumps(calculation.surcharges), calculation.final_premium,
            json.dumps(calculation.calculation_details)
            )
    
    async def _get_policy(self, policy_id: str) -> Optional[Dict]:
        """Get policy by ID"""
        async with db_pool.acquire() as conn:
            policy = await conn.fetchrow("""
                SELECT * FROM insurance_policies WHERE policy_id = $1
            """, policy_id)
            return dict(policy) if policy else None
    
    async def _get_claim(self, claim_id: str) -> Optional[Dict]:
        """Get claim by ID"""
        async with db_pool.acquire() as conn:
            claim = await conn.fetchrow("""
                SELECT * FROM insurance_claims WHERE claim_id = $1
            """, claim_id)
            return dict(claim) if claim else None
    
    async def _get_policy_claims(self, policy_id: str) -> List[Dict]:
        """Get all claims for a policy"""
        async with db_pool.acquire() as conn:
            claims = await conn.fetch("""
                SELECT * FROM insurance_claims WHERE policy_id = $1 ORDER BY created_at DESC
            """, policy_id)
            return [dict(claim) for claim in claims]
    
    async def _get_policy_payments(self, policy_id: str) -> List[Dict]:
        """Get payment history for a policy"""
        async with db_pool.acquire() as conn:
            payments = await conn.fetch("""
                SELECT * FROM premium_payments WHERE policy_id = $1 ORDER BY payment_date DESC
            """, policy_id)
            return [dict(payment) for payment in payments]
    
    async def _calculate_policy_metrics(self, policy_id: str) -> Dict[str, Any]:
        """Calculate policy performance metrics"""
        claims = await self._get_policy_claims(policy_id)
        payments = await self._get_policy_payments(policy_id)
        
        total_claims = len(claims)
        total_claim_amount = sum(Decimal(str(claim.get('claim_amount', 0))) for claim in claims)
        total_paid_claims = sum(Decimal(str(claim.get('approved_amount', 0))) for claim in claims if claim.get('approved_amount'))
        
        total_premiums = sum(Decimal(str(payment.get('payment_amount', 0))) for payment in payments)
        
        return {
            "total_claims": total_claims,
            "total_claim_amount": float(total_claim_amount),
            "total_paid_claims": float(total_paid_claims),
            "total_premiums_collected": float(total_premiums),
            "loss_ratio": float(total_paid_claims / total_premiums) if total_premiums > 0 else 0,
            "claims_frequency": total_claims / max(1, len(payments))  # Claims per payment period
        }

# Initialize insurance suite
insurance_suite = InsuranceSuite()

# API endpoints
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    await init_database()
    await init_redis()
    await init_ml_models()

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
            "service": "insurance-suite",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "ml_models": "loaded" if ml_models else "not_loaded"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/applications")
async def submit_policy_application(application: PolicyApplication):
    """Submit insurance policy application"""
    return await insurance_suite.process_policy_application(application)

@app.post("/api/v1/claims")
async def submit_claim(claim_request: ClaimRequest):
    """Submit insurance claim"""
    claim = await insurance_suite.submit_claim(claim_request)
    return claim.dict()

@app.post("/api/v1/claims/{claim_id}/process")
async def process_claim(claim_id: str, action: str, adjuster_notes: str = None):
    """Process insurance claim (approve/reject)"""
    return await insurance_suite.process_claim(claim_id, action, adjuster_notes)

@app.post("/api/v1/quotes")
async def get_premium_quote(
    policy_type: PolicyType,
    coverage_amount: Decimal,
    applicant_info: Dict[str, Any]
):
    """Get premium quote"""
    quote = await insurance_suite.calculate_premium_quote(policy_type, coverage_amount, applicant_info)
    return quote.dict()

@app.get("/api/v1/policies/{policy_id}")
async def get_policy_details(policy_id: str):
    """Get comprehensive policy details"""
    return await insurance_suite.get_policy_details(policy_id)

@app.get("/api/v1/policies")
async def list_policies(
    agent_id: Optional[str] = None,
    status: Optional[PolicyStatus] = None,
    limit: int = 100
):
    """List insurance policies"""
    try:
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM insurance_policies WHERE 1=1"
            params = []
            
            if agent_id:
                query += f" AND agent_id = ${len(params) + 1}"
                params.append(agent_id)
            
            if status:
                query += f" AND status = ${len(params) + 1}"
                params.append(status.value)
            
            query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
            params.append(limit)
            
            policies = await conn.fetch(query, *params)
            
            return [
                {
                    "policy_id": row['policy_id'],
                    "policy_number": row['policy_number'],
                    "policyholder_id": row['policyholder_id'],
                    "policy_type": row['policy_type'],
                    "status": row['status'],
                    "coverage_amount": float(row['coverage_amount']),
                    "premium_amount": float(row['premium_amount']),
                    "start_date": row['start_date'].isoformat(),
                    "end_date": row['end_date'].isoformat()
                }
                for row in policies
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list policies: {str(e)}")

@app.get("/api/v1/claims")
async def list_claims(
    policy_id: Optional[str] = None,
    status: Optional[ClaimStatus] = None,
    limit: int = 100
):
    """List insurance claims"""
    try:
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM insurance_claims WHERE 1=1"
            params = []
            
            if policy_id:
                query += f" AND policy_id = ${len(params) + 1}"
                params.append(policy_id)
            
            if status:
                query += f" AND status = ${len(params) + 1}"
                params.append(status.value)
            
            query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
            params.append(limit)
            
            claims = await conn.fetch(query, *params)
            
            return [
                {
                    "claim_id": row['claim_id'],
                    "policy_id": row['policy_id'],
                    "claimant_id": row['claimant_id'],
                    "claim_type": row['claim_type'],
                    "status": row['status'],
                    "claim_amount": float(row['claim_amount']),
                    "approved_amount": float(row['approved_amount']) if row['approved_amount'] else None,
                    "incident_date": row['incident_date'].isoformat(),
                    "created_at": row['created_at'].isoformat()
                }
                for row in claims
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list claims: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

