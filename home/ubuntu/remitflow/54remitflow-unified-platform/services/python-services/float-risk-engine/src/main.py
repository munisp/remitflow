#!/usr/bin/env python3
"""
Float Risk Assessment Engine
Advanced AI-powered risk assessment for agent float facilities
"""

import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from uuid import UUID
import json

import uvicorn
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib
import psycopg2
from sqlalchemy import create_engine, text
import redis
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from starlette.responses import Response

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Metrics
risk_assessments_total = Counter('risk_assessments_total', 'Total risk assessments performed')
risk_assessment_duration = Histogram('risk_assessment_duration_seconds', 'Risk assessment duration')
credit_score_gauge = Gauge('average_credit_score', 'Average credit score across agents')
high_risk_agents_gauge = Gauge('high_risk_agents_count', 'Number of high-risk agents')

# FastAPI app
app = FastAPI(
    title="Float Risk Assessment Engine",
    description="AI-powered risk assessment for agent float facilities",
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
# DATA MODELS
# ==========================================

class RiskAssessmentRequest(BaseModel):
    agent_id: str = Field(..., description="Agent UUID")
    assessment_type: str = Field(default="periodic", description="Type of assessment")
    force_refresh: bool = Field(default=False, description="Force refresh of cached data")

class RiskFactorWeights(BaseModel):
    transaction_volume: float = 0.25
    settlement_history: float = 0.20
    business_stability: float = 0.15
    geographic_risk: float = 0.10
    kyc_compliance: float = 0.10
    financial_health: float = 0.15
    behavioral_patterns: float = 0.05

class RiskAssessmentResponse(BaseModel):
    agent_id: str
    assessment_id: str
    overall_score: float = Field(..., ge=0, le=100)
    credit_score: float = Field(..., ge=0, le=100)
    transaction_volume_score: float = Field(..., ge=0, le=100)
    settlement_history_score: float = Field(..., ge=0, le=100)
    business_stability_score: float = Field(..., ge=0, le=100)
    geographic_risk_score: float = Field(..., ge=0, le=100)
    kyc_compliance_score: float = Field(..., ge=0, le=100)
    financial_health_score: float = Field(..., ge=0, le=100)
    behavioral_score: float = Field(..., ge=0, le=100)
    risk_level: str = Field(..., regex="^(low|medium|high|critical)$")
    recommended_limit: float = Field(..., ge=0)
    risk_factors: List[str]
    positive_factors: List[str]
    recommendations: List[str]
    model_version: str
    confidence_score: float = Field(..., ge=0, le=1)
    assessment_timestamp: datetime

# ==========================================
# RISK ASSESSMENT ENGINE
# ==========================================

class RiskAssessmentEngine:
    def __init__(self):
        self.db_engine = None
        self.redis_client = None
        self.models = {}
        self.scalers = {}
        self.feature_weights = RiskFactorWeights()
        self.model_version = "1.0.0"
        
    async def initialize(self):
        """Initialize database connections and ML models"""
        await self._init_database()
        await self._init_redis()
        await self._load_models()
        logger.info("Risk Assessment Engine initialized successfully")
    
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
    
    async def _load_models(self):
        """Load or train ML models"""
        try:
            # Try to load existing models
            self.models['credit_classifier'] = joblib.load('models/credit_classifier.pkl')
            self.models['limit_regressor'] = joblib.load('models/limit_regressor.pkl')
            self.scalers['features'] = joblib.load('models/feature_scaler.pkl')
            logger.info("Loaded existing ML models")
        except FileNotFoundError:
            # Train new models if none exist
            await self._train_models()
            logger.info("Trained new ML models")
    
    async def _train_models(self):
        """Train ML models using historical data"""
        # Generate synthetic training data for demonstration
        # In production, this would use real historical data
        
        n_samples = 1000
        np.random.seed(42)
        
        # Generate features
        features = pd.DataFrame({
            'transaction_volume_30d': np.random.lognormal(10, 1, n_samples),
            'settlement_success_rate': np.random.beta(8, 2, n_samples) * 100,
            'days_since_onboarding': np.random.exponential(365, n_samples),
            'kyc_score': np.random.beta(7, 3, n_samples) * 100,
            'geographic_risk_score': np.random.beta(3, 7, n_samples) * 100,
            'avg_transaction_size': np.random.lognormal(8, 1, n_samples),
            'transaction_frequency': np.random.poisson(50, n_samples),
            'failed_settlements': np.random.poisson(2, n_samples),
            'agent_tier_encoded': np.random.choice([1, 2, 3, 4], n_samples),
        })
        
        # Generate target variables
        credit_risk = (
            (100 - features['settlement_success_rate']) * 0.3 +
            (features['geographic_risk_score']) * 0.2 +
            (features['failed_settlements'] * 10) * 0.2 +
            np.random.normal(0, 10, n_samples)
        )
        
        credit_labels = pd.cut(credit_risk, 
                              bins=[-np.inf, 25, 50, 75, np.inf], 
                              labels=['low', 'medium', 'high', 'critical'])
        
        recommended_limits = (
            features['transaction_volume_30d'] * 0.1 +
            (100 - credit_risk) * 5000 +
            features['agent_tier_encoded'] * 100000 +
            np.random.normal(0, 50000, n_samples)
        ).clip(50000, 2000000)
        
        # Train models
        X_train, X_test, y_credit_train, y_credit_test, y_limit_train, y_limit_test = train_test_split(
            features, credit_labels, recommended_limits, test_size=0.2, random_state=42
        )
        
        # Feature scaling
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Credit risk classifier
        credit_classifier = RandomForestClassifier(n_estimators=100, random_state=42)
        credit_classifier.fit(X_train_scaled, y_credit_train)
        
        # Limit regressor
        limit_regressor = GradientBoostingRegressor(n_estimators=100, random_state=42)
        limit_regressor.fit(X_train_scaled, y_limit_train)
        
        # Save models
        os.makedirs('models', exist_ok=True)
        joblib.dump(credit_classifier, 'models/credit_classifier.pkl')
        joblib.dump(limit_regressor, 'models/limit_regressor.pkl')
        joblib.dump(scaler, 'models/feature_scaler.pkl')
        
        self.models['credit_classifier'] = credit_classifier
        self.models['limit_regressor'] = limit_regressor
        self.scalers['features'] = scaler
        
        logger.info(f"Models trained - Credit accuracy: {credit_classifier.score(X_test_scaled, y_credit_test):.3f}")
    
    async def assess_risk(self, agent_id: str, assessment_type: str = "periodic") -> RiskAssessmentResponse:
        """Perform comprehensive risk assessment for an agent"""
        
        with risk_assessment_duration.time():
            # Get agent data
            agent_data = await self._get_agent_data(agent_id)
            if not agent_data:
                raise HTTPException(status_code=404, detail="Agent not found")
            
            # Extract features
            features = await self._extract_features(agent_id, agent_data)
            
            # Calculate individual scores
            scores = await self._calculate_scores(features)
            
            # ML predictions
            ml_predictions = await self._get_ml_predictions(features)
            
            # Combine scores
            overall_score = self._calculate_overall_score(scores)
            
            # Determine risk level
            risk_level = self._determine_risk_level(overall_score)
            
            # Generate recommendations
            risk_factors, positive_factors, recommendations = self._generate_insights(scores, features)
            
            # Calculate recommended limit
            recommended_limit = max(ml_predictions['recommended_limit'], 50000)  # Minimum ₦50k
            
            # Create response
            assessment_id = f"RA_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{agent_id[:8]}"
            
            response = RiskAssessmentResponse(
                agent_id=agent_id,
                assessment_id=assessment_id,
                overall_score=round(overall_score, 2),
                credit_score=round(scores['credit_score'], 2),
                transaction_volume_score=round(scores['transaction_volume_score'], 2),
                settlement_history_score=round(scores['settlement_history_score'], 2),
                business_stability_score=round(scores['business_stability_score'], 2),
                geographic_risk_score=round(scores['geographic_risk_score'], 2),
                kyc_compliance_score=round(scores['kyc_compliance_score'], 2),
                financial_health_score=round(scores['financial_health_score'], 2),
                behavioral_score=round(scores['behavioral_score'], 2),
                risk_level=risk_level,
                recommended_limit=round(recommended_limit, 2),
                risk_factors=risk_factors,
                positive_factors=positive_factors,
                recommendations=recommendations,
                model_version=self.model_version,
                confidence_score=round(ml_predictions['confidence'], 3),
                assessment_timestamp=datetime.now()
            )
            
            # Cache result
            await self._cache_assessment(response)
            
            # Update metrics
            risk_assessments_total.inc()
            credit_score_gauge.set(overall_score)
            
            return response
    
    async def _get_agent_data(self, agent_id: str) -> Optional[Dict]:
        """Get comprehensive agent data from database"""
        query = text("""
            SELECT 
                a.id, a.agent_id, a.agent_tier, a.status,
                a.created_at, a.kyc_verified, a.training_completed,
                af.float_limit, af.utilized_amount, af.total_settlements,
                af.successful_settlements, af.failed_settlements,
                COUNT(t.id) as total_transactions,
                COALESCE(SUM(t.amount), 0) as total_volume,
                COALESCE(AVG(t.amount), 0) as avg_transaction_size,
                MAX(t.created_at) as last_transaction_date
            FROM agent_onboarding a
            LEFT JOIN agent_floats af ON a.agent_id = af.agent_id
            LEFT JOIN transactions t ON a.agent_id = t.agent_id
            WHERE a.agent_id = :agent_id
            GROUP BY a.id, a.agent_id, a.agent_tier, a.status, a.created_at, 
                     a.kyc_verified, a.training_completed, af.float_limit, 
                     af.utilized_amount, af.total_settlements, 
                     af.successful_settlements, af.failed_settlements
        """)
        
        try:
            with self.db_engine.connect() as conn:
                result = conn.execute(query, {"agent_id": agent_id}).fetchone()
                if result:
                    return dict(result._mapping)
        except Exception as e:
            logger.error(f"Error fetching agent data: {e}")
        
        return None
    
    async def _extract_features(self, agent_id: str, agent_data: Dict) -> Dict:
        """Extract features for risk assessment"""
        now = datetime.now()
        
        # Calculate days since onboarding
        onboarding_date = agent_data.get('created_at', now)
        if isinstance(onboarding_date, str):
            onboarding_date = datetime.fromisoformat(onboarding_date.replace('Z', '+00:00'))
        days_since_onboarding = (now - onboarding_date).days
        
        # Calculate settlement success rate
        total_settlements = agent_data.get('total_settlements', 0)
        successful_settlements = agent_data.get('successful_settlements', 0)
        settlement_success_rate = (successful_settlements / total_settlements * 100) if total_settlements > 0 else 100
        
        # Transaction metrics
        total_transactions = agent_data.get('total_transactions', 0)
        total_volume = float(agent_data.get('total_volume', 0))
        avg_transaction_size = float(agent_data.get('avg_transaction_size', 0))
        
        # Calculate transaction frequency (transactions per day)
        transaction_frequency = total_transactions / max(days_since_onboarding, 1)
        
        # Agent tier encoding
        tier_mapping = {'basic': 1, 'standard': 2, 'premium': 3, 'elite': 4}
        agent_tier_encoded = tier_mapping.get(agent_data.get('agent_tier', 'basic'), 1)
        
        # Geographic risk (placeholder - would be calculated based on location)
        geographic_risk_score = np.random.beta(3, 7) * 100  # Simulated
        
        # KYC compliance score
        kyc_score = 100 if agent_data.get('kyc_verified') else 50
        
        return {
            'days_since_onboarding': days_since_onboarding,
            'settlement_success_rate': settlement_success_rate,
            'total_transactions': total_transactions,
            'total_volume': total_volume,
            'avg_transaction_size': avg_transaction_size,
            'transaction_frequency': transaction_frequency,
            'agent_tier_encoded': agent_tier_encoded,
            'geographic_risk_score': geographic_risk_score,
            'kyc_score': kyc_score,
            'failed_settlements': agent_data.get('failed_settlements', 0),
            'float_limit': float(agent_data.get('float_limit', 0)),
            'utilized_amount': float(agent_data.get('utilized_amount', 0)),
        }
    
    async def _calculate_scores(self, features: Dict) -> Dict:
        """Calculate individual risk scores"""
        scores = {}
        
        # Transaction Volume Score (0-100, higher is better)
        volume_30d = features['total_volume'] / max(features['days_since_onboarding'] / 30, 1)
        scores['transaction_volume_score'] = min(volume_30d / 1000000 * 100, 100)  # ₦1M = 100 points
        
        # Settlement History Score (0-100, higher is better)
        scores['settlement_history_score'] = features['settlement_success_rate']
        
        # Business Stability Score (0-100, higher is better)
        stability_factor = min(features['days_since_onboarding'] / 365, 1)  # Max 1 year
        consistency_factor = min(features['transaction_frequency'] / 10, 1)  # Max 10 txns/day
        scores['business_stability_score'] = (stability_factor * 50 + consistency_factor * 50)
        
        # Geographic Risk Score (0-100, lower is better, so we invert)
        scores['geographic_risk_score'] = 100 - features['geographic_risk_score']
        
        # KYC Compliance Score (0-100, higher is better)
        scores['kyc_compliance_score'] = features['kyc_score']
        
        # Financial Health Score (0-100, higher is better)
        if features['float_limit'] > 0:
            utilization_rate = features['utilized_amount'] / features['float_limit']
            # Optimal utilization is around 60-80%
            if 0.6 <= utilization_rate <= 0.8:
                utilization_score = 100
            elif utilization_rate < 0.6:
                utilization_score = utilization_rate / 0.6 * 100
            else:
                utilization_score = max(0, 100 - (utilization_rate - 0.8) * 200)
        else:
            utilization_score = 80  # No float facility yet
        
        avg_txn_health = min(features['avg_transaction_size'] / 10000, 1) * 50  # ₦10k = 50 points
        scores['financial_health_score'] = (utilization_score * 0.7 + avg_txn_health * 0.3)
        
        # Behavioral Score (0-100, higher is better)
        failed_settlement_penalty = min(features['failed_settlements'] * 10, 50)
        consistency_bonus = min(features['transaction_frequency'] * 5, 50)
        scores['behavioral_score'] = max(0, 100 - failed_settlement_penalty + consistency_bonus)
        
        # Credit Score (composite of key factors)
        scores['credit_score'] = (
            scores['settlement_history_score'] * 0.4 +
            scores['financial_health_score'] * 0.3 +
            scores['business_stability_score'] * 0.2 +
            scores['behavioral_score'] * 0.1
        )
        
        return scores
    
    async def _get_ml_predictions(self, features: Dict) -> Dict:
        """Get ML model predictions"""
        # Prepare feature vector for ML models
        feature_vector = np.array([[
            features['total_volume'] / max(features['days_since_onboarding'] / 30, 1),  # Monthly volume
            features['settlement_success_rate'],
            features['days_since_onboarding'],
            features['kyc_score'],
            features['geographic_risk_score'],
            features['avg_transaction_size'],
            features['transaction_frequency'],
            features['failed_settlements'],
            features['agent_tier_encoded'],
        ]])
        
        # Scale features
        feature_vector_scaled = self.scalers['features'].transform(feature_vector)
        
        # Get predictions
        risk_probabilities = self.models['credit_classifier'].predict_proba(feature_vector_scaled)[0]
        recommended_limit = self.models['limit_regressor'].predict(feature_vector_scaled)[0]
        
        # Calculate confidence as the maximum probability
        confidence = max(risk_probabilities)
        
        return {
            'risk_probabilities': risk_probabilities,
            'recommended_limit': recommended_limit,
            'confidence': confidence
        }
    
    def _calculate_overall_score(self, scores: Dict) -> float:
        """Calculate overall risk score using weighted average"""
        weights = self.feature_weights
        
        overall_score = (
            scores['transaction_volume_score'] * weights.transaction_volume +
            scores['settlement_history_score'] * weights.settlement_history +
            scores['business_stability_score'] * weights.business_stability +
            scores['geographic_risk_score'] * weights.geographic_risk +
            scores['kyc_compliance_score'] * weights.kyc_compliance +
            scores['financial_health_score'] * weights.financial_health +
            scores['behavioral_score'] * weights.behavioral_patterns
        )
        
        return max(0, min(100, overall_score))
    
    def _determine_risk_level(self, overall_score: float) -> str:
        """Determine risk level based on overall score"""
        if overall_score >= 80:
            return "low"
        elif overall_score >= 60:
            return "medium"
        elif overall_score >= 40:
            return "high"
        else:
            return "critical"
    
    def _generate_insights(self, scores: Dict, features: Dict) -> tuple:
        """Generate risk factors, positive factors, and recommendations"""
        risk_factors = []
        positive_factors = []
        recommendations = []
        
        # Risk factors
        if scores['settlement_history_score'] < 90:
            risk_factors.append("Settlement success rate below 90%")
            recommendations.append("Improve settlement processes and monitoring")
        
        if scores['transaction_volume_score'] < 50:
            risk_factors.append("Low transaction volume")
            recommendations.append("Increase marketing efforts to grow transaction volume")
        
        if scores['business_stability_score'] < 60:
            risk_factors.append("Business stability concerns")
            recommendations.append("Focus on building consistent transaction patterns")
        
        if features['failed_settlements'] > 2:
            risk_factors.append("Multiple failed settlements")
            recommendations.append("Implement automated settlement monitoring")
        
        if scores['kyc_compliance_score'] < 100:
            risk_factors.append("KYC verification incomplete")
            recommendations.append("Complete KYC verification process")
        
        # Positive factors
        if scores['settlement_history_score'] >= 95:
            positive_factors.append("Excellent settlement history")
        
        if scores['transaction_volume_score'] >= 70:
            positive_factors.append("Strong transaction volume")
        
        if features['days_since_onboarding'] > 180:
            positive_factors.append("Established agent with operational history")
        
        if scores['behavioral_score'] >= 80:
            positive_factors.append("Consistent behavioral patterns")
        
        if features['agent_tier_encoded'] >= 3:
            positive_factors.append("Premium tier agent")
        
        # General recommendations
        if len(risk_factors) == 0:
            recommendations.append("Consider increasing float limit based on strong performance")
        elif len(risk_factors) > 3:
            recommendations.append("Implement enhanced monitoring and support")
        
        return risk_factors, positive_factors, recommendations
    
    async def _cache_assessment(self, assessment: RiskAssessmentResponse):
        """Cache assessment result in Redis"""
        try:
            cache_key = f"risk_assessment:{assessment.agent_id}"
            cache_data = assessment.dict()
            cache_data['assessment_timestamp'] = cache_data['assessment_timestamp'].isoformat()
            
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.redis_client.setex(
                    cache_key,
                    3600,  # 1 hour TTL
                    json.dumps(cache_data, default=str)
                )
            )
        except Exception as e:
            logger.warning(f"Failed to cache assessment: {e}")

# Global risk engine instance
risk_engine = RiskAssessmentEngine()

# ==========================================
# API ENDPOINTS
# ==========================================

@app.on_event("startup")
async def startup_event():
    """Initialize the risk engine on startup"""
    await risk_engine.initialize()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "float-risk-engine",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(generate_latest(), media_type="text/plain")

@app.post("/assess-risk", response_model=RiskAssessmentResponse)
async def assess_risk(request: RiskAssessmentRequest, background_tasks: BackgroundTasks):
    """Perform risk assessment for an agent"""
    try:
        assessment = await risk_engine.assess_risk(
            agent_id=request.agent_id,
            assessment_type=request.assessment_type
        )
        
        # Update high-risk agents metric
        if assessment.risk_level in ["high", "critical"]:
            background_tasks.add_task(update_high_risk_count)
        
        return assessment
        
    except Exception as e:
        logger.error(f"Risk assessment failed for agent {request.agent_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/agents/{agent_id}/risk-history")
async def get_risk_history(agent_id: str):
    """Get risk assessment history for an agent"""
    # This would fetch historical assessments from database
    return {
        "agent_id": agent_id,
        "assessments": [],
        "message": "Risk history endpoint - implementation pending"
    }

@app.post("/retrain-models")
async def retrain_models():
    """Retrain ML models with latest data"""
    try:
        await risk_engine._train_models()
        return {"message": "Models retrained successfully"}
    except Exception as e:
        logger.error(f"Model retraining failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/model-info")
async def get_model_info():
    """Get information about current models"""
    return {
        "model_version": risk_engine.model_version,
        "models": list(risk_engine.models.keys()),
        "feature_weights": risk_engine.feature_weights.dict(),
        "last_trained": "2024-01-01T00:00:00Z"  # Would be stored in database
    }

async def update_high_risk_count():
    """Update high-risk agents count metric"""
    try:
        query = text("""
            SELECT COUNT(*) as high_risk_count
            FROM float_risk_assessments 
            WHERE risk_level IN ('high', 'critical')
            AND assessment_date > NOW() - INTERVAL '30 days'
        """)
        
        with risk_engine.db_engine.connect() as conn:
            result = conn.execute(query).fetchone()
            if result:
                high_risk_agents_gauge.set(result.high_risk_count)
    except Exception as e:
        logger.error(f"Failed to update high-risk count: {e}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8001")),
        reload=os.getenv("ENVIRONMENT") == "development",
        log_level="info"
    )

