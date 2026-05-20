#!/usr/bin/env python3
"""
Credit Scoring Engine Service
Advanced ML-powered credit scoring and risk assessment platform
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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8142"))

app = FastAPI(title="Credit Scoring Engine Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

db_pool = None
redis_client = None
credit_models = {}

class CreditApplication(BaseModel):
    application_id: str
    customer_id: str
    requested_amount: float
    loan_purpose: str
    employment_status: str
    monthly_income: float
    existing_debt: float
    credit_history_length: int
    previous_defaults: int
    collateral_value: Optional[float] = 0

class CreditScore(BaseModel):
    application_id: str
    credit_score: int
    risk_grade: str
    approval_probability: float
    recommended_amount: float
    interest_rate: float
    risk_factors: List[str]
    processing_time: float

async def init_database():
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS credit_applications (
                    id SERIAL PRIMARY KEY,
                    application_id VARCHAR(255) UNIQUE NOT NULL,
                    customer_id VARCHAR(255) NOT NULL,
                    requested_amount DECIMAL(15,2) NOT NULL,
                    loan_purpose VARCHAR(100),
                    employment_status VARCHAR(50),
                    monthly_income DECIMAL(15,2),
                    existing_debt DECIMAL(15,2),
                    credit_history_length INTEGER,
                    previous_defaults INTEGER,
                    collateral_value DECIMAL(15,2),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_application_id (application_id),
                    INDEX idx_customer_id (customer_id)
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS credit_scores (
                    id SERIAL PRIMARY KEY,
                    application_id VARCHAR(255) NOT NULL,
                    credit_score INTEGER NOT NULL,
                    risk_grade VARCHAR(10) NOT NULL,
                    approval_probability DECIMAL(5,4),
                    recommended_amount DECIMAL(15,2),
                    interest_rate DECIMAL(5,4),
                    risk_factors JSONB,
                    processing_time DECIMAL(8,4),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_application_id (application_id),
                    INDEX idx_credit_score (credit_score)
                )
            """)
        logger.info("Credit scoring database initialized")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise

async def init_redis():
    global redis_client
    try:
        redis_client = await aioredis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Redis connection established")
    except Exception as e:
        logger.error(f"Redis initialization failed: {e}")
        raise

async def init_credit_models():
    global credit_models
    try:
        # Initialize models
        credit_models['score_classifier'] = RandomForestClassifier(n_estimators=100, random_state=42)
        credit_models['amount_regressor'] = GradientBoostingRegressor(n_estimators=100, random_state=42)
        credit_models['scaler'] = StandardScaler()
        
        # Train models with synthetic data
        await train_credit_models()
        logger.info("Credit models initialized and trained")
    except Exception as e:
        logger.error(f"Credit models initialization failed: {e}")

async def train_credit_models():
    try:
        # Generate synthetic training data
        n_samples = 5000
        np.random.seed(42)
        
        # Generate features
        X = np.random.rand(n_samples, 8)
        X[:, 0] = np.random.lognormal(10, 0.5, n_samples)  # monthly_income
        X[:, 1] = np.random.lognormal(8, 1, n_samples)     # existing_debt
        X[:, 2] = np.random.randint(0, 20, n_samples)      # credit_history_length
        X[:, 3] = np.random.poisson(0.5, n_samples)        # previous_defaults
        X[:, 4] = np.random.lognormal(9, 1, n_samples)     # requested_amount
        X[:, 5] = np.random.lognormal(10, 1, n_samples)    # collateral_value
        X[:, 6] = np.random.uniform(0, 1, n_samples)       # employment_stability
        X[:, 7] = X[:, 0] / (X[:, 1] + 1)                  # debt_to_income_ratio
        
        # Generate credit scores (300-850 range)
        base_score = 500 + (X[:, 0] / np.max(X[:, 0])) * 200  # Income factor
        base_score += (X[:, 2] / 20) * 100  # Credit history factor
        base_score -= X[:, 3] * 50  # Defaults penalty
        base_score -= np.clip(X[:, 7] * 100, 0, 150)  # Debt ratio penalty
        
        y_scores = np.clip(base_score + np.random.normal(0, 30, n_samples), 300, 850).astype(int)
        
        # Generate approval labels
        y_approval = (y_scores > 600).astype(int)
        
        # Generate recommended amounts
        y_amounts = X[:, 4] * (y_scores / 850) * np.random.uniform(0.5, 1.2, n_samples)
        
        # Split and train
        X_train, X_test, y_scores_train, y_scores_test = train_test_split(X, y_scores, test_size=0.2, random_state=42)
        _, _, y_approval_train, y_approval_test = train_test_split(X, y_approval, test_size=0.2, random_state=42)
        _, _, y_amounts_train, y_amounts_test = train_test_split(X, y_amounts, test_size=0.2, random_state=42)
        
        # Scale features
        X_train_scaled = credit_models['scaler'].fit_transform(X_train)
        X_test_scaled = credit_models['scaler'].transform(X_test)
        
        # Train models
        credit_models['score_classifier'].fit(X_train_scaled, y_approval_train)
        credit_models['amount_regressor'].fit(X_train_scaled, y_amounts_train)
        
        logger.info(f"Credit models trained with {n_samples} samples")
    except Exception as e:
        logger.error(f"Model training failed: {e}")

class CreditScoringEngine:
    def __init__(self):
        self.risk_grades = {
            (750, 850): 'AAA',
            (700, 749): 'AA',
            (650, 699): 'A',
            (600, 649): 'BBB',
            (550, 599): 'BB',
            (500, 549): 'B',
            (450, 499): 'CCC',
            (300, 449): 'D'
        }
    
    async def calculate_credit_score(self, application: CreditApplication) -> CreditScore:
        try:
            start_time = datetime.now()
            
            # Extract features
            features = self._extract_features(application)
            
            # Scale features
            features_scaled = credit_models['scaler'].transform([features])
            
            # Get predictions
            approval_prob = credit_models['score_classifier'].predict_proba(features_scaled)[0][1]
            recommended_amount = max(0, credit_models['amount_regressor'].predict(features_scaled)[0])
            
            # Calculate credit score
            credit_score = self._calculate_score(features, approval_prob)
            
            # Determine risk grade
            risk_grade = self._get_risk_grade(credit_score)
            
            # Calculate interest rate
            interest_rate = self._calculate_interest_rate(credit_score, risk_grade)
            
            # Identify risk factors
            risk_factors = self._identify_risk_factors(application, features)
            
            processing_time = (datetime.now() - start_time).total_seconds()
            
            result = CreditScore(
                application_id=application.application_id,
                credit_score=credit_score,
                risk_grade=risk_grade,
                approval_probability=approval_prob,
                recommended_amount=recommended_amount,
                interest_rate=interest_rate,
                risk_factors=risk_factors,
                processing_time=processing_time
            )
            
            # Store results
            await self._store_application(application)
            await self._store_score(result)
            
            return result
            
        except Exception as e:
            logger.error(f"Credit scoring failed: {e}")
            raise HTTPException(status_code=500, detail=f"Credit scoring failed: {str(e)}")
    
    def _extract_features(self, app: CreditApplication) -> List[float]:
        features = [
            app.monthly_income,
            app.existing_debt,
            app.credit_history_length,
            app.previous_defaults,
            app.requested_amount,
            app.collateral_value or 0,
            1.0 if app.employment_status == 'EMPLOYED' else 0.5,
            app.existing_debt / max(app.monthly_income, 1)  # debt-to-income ratio
        ]
        return features
    
    def _calculate_score(self, features: List[float], approval_prob: float) -> int:
        # Base score calculation
        base_score = 500
        
        # Income factor (0-100 points)
        income_score = min(features[0] / 100000 * 100, 100)
        
        # Credit history factor (0-80 points)
        history_score = min(features[2] / 10 * 80, 80)
        
        # Defaults penalty (0-150 points deduction)
        defaults_penalty = features[3] * 50
        
        # Debt ratio penalty (0-100 points deduction)
        debt_ratio_penalty = min(features[7] * 100, 100)
        
        # Approval probability factor (0-70 points)
        approval_score = approval_prob * 70
        
        final_score = base_score + income_score + history_score + approval_score - defaults_penalty - debt_ratio_penalty
        
        return int(np.clip(final_score, 300, 850))
    
    def _get_risk_grade(self, credit_score: int) -> str:
        for (min_score, max_score), grade in self.risk_grades.items():
            if min_score <= credit_score <= max_score:
                return grade
        return 'D'
    
    def _calculate_interest_rate(self, credit_score: int, risk_grade: str) -> float:
        base_rates = {
            'AAA': 0.05, 'AA': 0.07, 'A': 0.09, 'BBB': 0.12,
            'BB': 0.15, 'B': 0.18, 'CCC': 0.22, 'D': 0.25
        }
        return base_rates.get(risk_grade, 0.25)
    
    def _identify_risk_factors(self, app: CreditApplication, features: List[float]) -> List[str]:
        risk_factors = []
        
        if app.previous_defaults > 0:
            risk_factors.append(f"Previous defaults: {app.previous_defaults}")
        
        if features[7] > 0.4:  # debt-to-income ratio > 40%
            risk_factors.append("High debt-to-income ratio")
        
        if app.credit_history_length < 2:
            risk_factors.append("Limited credit history")
        
        if app.employment_status != 'EMPLOYED':
            risk_factors.append("Unstable employment")
        
        if app.monthly_income < 30000:
            risk_factors.append("Low monthly income")
        
        return risk_factors
    
    async def _store_application(self, app: CreditApplication):
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO credit_applications 
                (application_id, customer_id, requested_amount, loan_purpose, employment_status,
                 monthly_income, existing_debt, credit_history_length, previous_defaults, collateral_value)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (application_id) DO NOTHING
            """, 
            app.application_id, app.customer_id, app.requested_amount, app.loan_purpose,
            app.employment_status, app.monthly_income, app.existing_debt,
            app.credit_history_length, app.previous_defaults, app.collateral_value
            )
    
    async def _store_score(self, score: CreditScore):
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO credit_scores 
                (application_id, credit_score, risk_grade, approval_probability,
                 recommended_amount, interest_rate, risk_factors, processing_time)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, 
            score.application_id, score.credit_score, score.risk_grade,
            score.approval_probability, score.recommended_amount, score.interest_rate,
            json.dumps(score.risk_factors), score.processing_time
            )

credit_engine = CreditScoringEngine()

@app.on_event("startup")
async def startup_event():
    await init_database()
    await init_redis()
    await init_credit_models()

@app.on_event("shutdown")
async def shutdown_event():
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

@app.get("/health")
async def health_check():
    try:
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        await redis_client.ping()
        return {"status": "healthy", "service": "credit-scoring-engine", "timestamp": datetime.now().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/score", response_model=CreditScore)
async def calculate_credit_score(application: CreditApplication):
    return await credit_engine.calculate_credit_score(application)

@app.get("/api/v1/scores/{application_id}")
async def get_credit_score(application_id: str):
    try:
        async with db_pool.acquire() as conn:
            score = await conn.fetchrow("""
                SELECT * FROM credit_scores WHERE application_id = $1
            """, application_id)
            
            if not score:
                raise HTTPException(status_code=404, detail="Credit score not found")
            
            return {
                "application_id": score['application_id'],
                "credit_score": score['credit_score'],
                "risk_grade": score['risk_grade'],
                "approval_probability": float(score['approval_probability']),
                "recommended_amount": float(score['recommended_amount']),
                "interest_rate": float(score['interest_rate']),
                "risk_factors": json.loads(score['risk_factors'] or '[]'),
                "created_at": score['created_at'].isoformat()
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get credit score: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False, log_level="info")

