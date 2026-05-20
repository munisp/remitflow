#!/usr/bin/env python3
"""
Float Risk Engine Service
Real-time risk assessment for float management operations
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import asyncpg
import aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
import joblib
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8120"))

# FastAPI app
app = FastAPI(
    title="Float Risk Engine",
    description="Real-time risk assessment for float management operations",
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
risk_models = {}

# Pydantic models
class FloatTransaction(BaseModel):
    transaction_id: str
    agent_id: str
    amount: float
    transaction_type: str  # deposit, withdrawal, transfer
    timestamp: datetime
    location: Optional[str] = None
    device_id: Optional[str] = None

class RiskAssessmentRequest(BaseModel):
    transaction: FloatTransaction
    agent_context: Dict[str, Any]
    historical_data: Optional[Dict[str, Any]] = None

class RiskScore(BaseModel):
    transaction_id: str
    risk_score: float
    risk_level: str  # LOW, MEDIUM, HIGH, CRITICAL
    risk_factors: List[str]
    recommendations: List[str]
    confidence: float

class AgentRiskProfile(BaseModel):
    agent_id: str
    risk_score: float
    transaction_count: int
    average_amount: float
    risk_factors: List[str]
    last_updated: datetime

# Database functions
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS float_risk_assessments (
                    id SERIAL PRIMARY KEY,
                    transaction_id VARCHAR(255) UNIQUE NOT NULL,
                    agent_id VARCHAR(255) NOT NULL,
                    risk_score DECIMAL(5,4) NOT NULL,
                    risk_level VARCHAR(20) NOT NULL,
                    risk_factors JSONB,
                    recommendations JSONB,
                    confidence DECIMAL(5,4),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_risk_level (risk_level),
                    INDEX idx_created_at (created_at)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_risk_profiles (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(255) UNIQUE NOT NULL,
                    risk_score DECIMAL(5,4) NOT NULL,
                    transaction_count INTEGER DEFAULT 0,
                    average_amount DECIMAL(15,2) DEFAULT 0,
                    risk_factors JSONB,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_risk_score (risk_score)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_model_performance (
                    id SERIAL PRIMARY KEY,
                    model_name VARCHAR(100) NOT NULL,
                    accuracy DECIMAL(5,4),
                    precision_score DECIMAL(5,4),
                    recall_score DECIMAL(5,4),
                    f1_score DECIMAL(5,4),
                    evaluation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_model_name (model_name)
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

# Risk assessment functions
class FloatRiskEngine:
    """Main risk assessment engine"""
    
    def __init__(self):
        self.anomaly_detector = IsolationForest(contamination=0.1, random_state=42)
        self.fraud_classifier = RandomForestClassifier(n_estimators=100, random_state=42)
        self.scaler = StandardScaler()
        self.is_trained = False
        
    async def train_models(self):
        """Train risk assessment models"""
        try:
            # Generate synthetic training data for demonstration
            # In production, this would use real historical data
            training_data = self._generate_training_data()
            
            # Train anomaly detection model
            features = training_data['features']
            labels = training_data['labels']
            
            # Scale features
            scaled_features = self.scaler.fit_transform(features)
            
            # Train models
            self.anomaly_detector.fit(scaled_features)
            self.fraud_classifier.fit(scaled_features, labels)
            
            self.is_trained = True
            logger.info("Risk models trained successfully")
            
            # Save models
            await self._save_models()
            
        except Exception as e:
            logger.error(f"Model training failed: {e}")
            raise
    
    def _generate_training_data(self) -> Dict[str, np.ndarray]:
        """Generate synthetic training data"""
        np.random.seed(42)
        
        # Generate 10000 samples
        n_samples = 10000
        
        # Features: amount, hour, day_of_week, agent_transaction_count, 
        # agent_avg_amount, location_risk, device_risk
        features = []
        labels = []
        
        for i in range(n_samples):
            # Normal transactions (90%)
            if i < n_samples * 0.9:
                amount = np.random.lognormal(mean=3, sigma=1)  # Normal amounts
                hour = np.random.normal(12, 4)  # Business hours
                day_of_week = np.random.choice([1, 2, 3, 4, 5], p=[0.2, 0.2, 0.2, 0.2, 0.2])
                agent_tx_count = np.random.poisson(50)
                agent_avg_amount = np.random.normal(1000, 200)
                location_risk = np.random.uniform(0, 0.3)
                device_risk = np.random.uniform(0, 0.2)
                label = 0  # Normal
            else:
                # Fraudulent transactions (10%)
                amount = np.random.lognormal(mean=5, sigma=2)  # Unusual amounts
                hour = np.random.choice([2, 3, 22, 23])  # Odd hours
                day_of_week = np.random.choice([6, 7])  # Weekends
                agent_tx_count = np.random.poisson(5)  # Low activity agents
                agent_avg_amount = np.random.normal(500, 100)
                location_risk = np.random.uniform(0.7, 1.0)
                device_risk = np.random.uniform(0.8, 1.0)
                label = 1  # Fraudulent
            
            features.append([
                amount, hour, day_of_week, agent_tx_count,
                agent_avg_amount, location_risk, device_risk
            ])
            labels.append(label)
        
        return {
            'features': np.array(features),
            'labels': np.array(labels)
        }
    
    async def assess_risk(self, request: RiskAssessmentRequest) -> RiskScore:
        """Assess risk for a float transaction"""
        try:
            if not self.is_trained:
                await self.train_models()
            
            # Extract features
            features = await self._extract_features(request)
            
            # Scale features
            scaled_features = self.scaler.transform([features])
            
            # Get anomaly score
            anomaly_score = self.anomaly_detector.decision_function(scaled_features)[0]
            
            # Get fraud probability
            fraud_prob = self.fraud_classifier.predict_proba(scaled_features)[0][1]
            
            # Calculate combined risk score
            risk_score = self._calculate_risk_score(anomaly_score, fraud_prob)
            
            # Determine risk level
            risk_level = self._determine_risk_level(risk_score)
            
            # Identify risk factors
            risk_factors = await self._identify_risk_factors(request, risk_score)
            
            # Generate recommendations
            recommendations = self._generate_recommendations(risk_level, risk_factors)
            
            # Calculate confidence
            confidence = self._calculate_confidence(anomaly_score, fraud_prob)
            
            result = RiskScore(
                transaction_id=request.transaction.transaction_id,
                risk_score=risk_score,
                risk_level=risk_level,
                risk_factors=risk_factors,
                recommendations=recommendations,
                confidence=confidence
            )
            
            # Store assessment
            await self._store_assessment(result, request.transaction.agent_id)
            
            return result
            
        except Exception as e:
            logger.error(f"Risk assessment failed: {e}")
            raise HTTPException(status_code=500, detail=f"Risk assessment failed: {str(e)}")
    
    async def _extract_features(self, request: RiskAssessmentRequest) -> List[float]:
        """Extract features from transaction request"""
        tx = request.transaction
        context = request.agent_context
        
        # Basic transaction features
        amount = float(tx.amount)
        hour = tx.timestamp.hour
        day_of_week = tx.timestamp.weekday() + 1
        
        # Agent context features
        agent_tx_count = context.get('transaction_count', 0)
        agent_avg_amount = context.get('average_amount', 0)
        
        # Location and device risk (simplified)
        location_risk = self._calculate_location_risk(tx.location)
        device_risk = self._calculate_device_risk(tx.device_id)
        
        return [
            amount, hour, day_of_week, agent_tx_count,
            agent_avg_amount, location_risk, device_risk
        ]
    
    def _calculate_location_risk(self, location: Optional[str]) -> float:
        """Calculate location-based risk score"""
        if not location:
            return 0.5
        
        # Simplified location risk calculation
        high_risk_locations = ['border', 'remote', 'conflict']
        medium_risk_locations = ['rural', 'suburban']
        
        location_lower = location.lower()
        
        if any(risk_loc in location_lower for risk_loc in high_risk_locations):
            return 0.8
        elif any(risk_loc in location_lower for risk_loc in medium_risk_locations):
            return 0.4
        else:
            return 0.2
    
    def _calculate_device_risk(self, device_id: Optional[str]) -> float:
        """Calculate device-based risk score"""
        if not device_id:
            return 0.5
        
        # Simplified device risk calculation
        # In production, this would check device reputation, history, etc.
        return np.random.uniform(0.1, 0.3)
    
    def _calculate_risk_score(self, anomaly_score: float, fraud_prob: float) -> float:
        """Calculate combined risk score"""
        # Normalize anomaly score (lower is more anomalous)
        normalized_anomaly = max(0, min(1, (0.5 - anomaly_score) / 0.5))
        
        # Combine scores with weights
        risk_score = 0.6 * fraud_prob + 0.4 * normalized_anomaly
        
        return min(1.0, max(0.0, risk_score))
    
    def _determine_risk_level(self, risk_score: float) -> str:
        """Determine risk level from score"""
        if risk_score >= 0.8:
            return "CRITICAL"
        elif risk_score >= 0.6:
            return "HIGH"
        elif risk_score >= 0.3:
            return "MEDIUM"
        else:
            return "LOW"
    
    async def _identify_risk_factors(self, request: RiskAssessmentRequest, risk_score: float) -> List[str]:
        """Identify specific risk factors"""
        factors = []
        tx = request.transaction
        context = request.agent_context
        
        # Amount-based factors
        if tx.amount > 10000:
            factors.append("High transaction amount")
        
        # Time-based factors
        if tx.timestamp.hour < 6 or tx.timestamp.hour > 22:
            factors.append("Off-hours transaction")
        
        if tx.timestamp.weekday() >= 5:  # Weekend
            factors.append("Weekend transaction")
        
        # Agent-based factors
        if context.get('transaction_count', 0) < 10:
            factors.append("Low-activity agent")
        
        if context.get('average_amount', 0) > 0 and tx.amount > context['average_amount'] * 3:
            factors.append("Amount significantly above agent average")
        
        # Location-based factors
        location_risk = self._calculate_location_risk(tx.location)
        if location_risk > 0.6:
            factors.append("High-risk location")
        
        return factors
    
    def _generate_recommendations(self, risk_level: str, risk_factors: List[str]) -> List[str]:
        """Generate risk mitigation recommendations"""
        recommendations = []
        
        if risk_level == "CRITICAL":
            recommendations.extend([
                "Block transaction immediately",
                "Require manual approval",
                "Contact agent for verification",
                "Investigate transaction pattern"
            ])
        elif risk_level == "HIGH":
            recommendations.extend([
                "Require additional authentication",
                "Limit transaction amount",
                "Monitor agent activity closely"
            ])
        elif risk_level == "MEDIUM":
            recommendations.extend([
                "Apply enhanced monitoring",
                "Consider transaction limits"
            ])
        else:
            recommendations.append("Process normally with standard monitoring")
        
        # Factor-specific recommendations
        if "High transaction amount" in risk_factors:
            recommendations.append("Verify transaction purpose and authorization")
        
        if "Off-hours transaction" in risk_factors:
            recommendations.append("Verify agent identity and location")
        
        if "Low-activity agent" in risk_factors:
            recommendations.append("Enhanced due diligence on agent background")
        
        return list(set(recommendations))  # Remove duplicates
    
    def _calculate_confidence(self, anomaly_score: float, fraud_prob: float) -> float:
        """Calculate confidence in risk assessment"""
        # Higher confidence when both models agree
        anomaly_normalized = max(0, min(1, (0.5 - anomaly_score) / 0.5))
        
        agreement = 1 - abs(fraud_prob - anomaly_normalized)
        base_confidence = 0.7
        
        return min(1.0, base_confidence + 0.3 * agreement)
    
    async def _store_assessment(self, assessment: RiskScore, agent_id: str):
        """Store risk assessment in database"""
        try:
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO float_risk_assessments 
                    (transaction_id, agent_id, risk_score, risk_level, risk_factors, recommendations, confidence)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (transaction_id) DO UPDATE SET
                    risk_score = EXCLUDED.risk_score,
                    risk_level = EXCLUDED.risk_level,
                    risk_factors = EXCLUDED.risk_factors,
                    recommendations = EXCLUDED.recommendations,
                    confidence = EXCLUDED.confidence
                """, 
                assessment.transaction_id, agent_id, assessment.risk_score,
                assessment.risk_level, json.dumps(assessment.risk_factors),
                json.dumps(assessment.recommendations), assessment.confidence
                )
                
                # Cache in Redis
                await redis_client.setex(
                    f"risk_assessment:{assessment.transaction_id}",
                    3600,  # 1 hour TTL
                    json.dumps(assessment.dict())
                )
                
        except Exception as e:
            logger.error(f"Failed to store assessment: {e}")
    
    async def _save_models(self):
        """Save trained models"""
        try:
            # In production, save to persistent storage
            model_data = {
                'anomaly_detector': self.anomaly_detector,
                'fraud_classifier': self.fraud_classifier,
                'scaler': self.scaler,
                'trained_at': datetime.now().isoformat()
            }
            
            # Save to Redis for now
            await redis_client.set(
                "risk_models",
                json.dumps(model_data, default=str)
            )
            
            logger.info("Models saved successfully")
            
        except Exception as e:
            logger.error(f"Failed to save models: {e}")

# Initialize risk engine
risk_engine = FloatRiskEngine()

# API endpoints
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    await init_database()
    await init_redis()
    await risk_engine.train_models()

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
            "service": "float-risk-engine",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "models_trained": risk_engine.is_trained
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/assess-risk", response_model=RiskScore)
async def assess_transaction_risk(request: RiskAssessmentRequest):
    """Assess risk for a float transaction"""
    return await risk_engine.assess_risk(request)

@app.get("/api/v1/agent-profile/{agent_id}", response_model=AgentRiskProfile)
async def get_agent_risk_profile(agent_id: str):
    """Get risk profile for an agent"""
    try:
        async with db_pool.acquire() as conn:
            profile = await conn.fetchrow("""
                SELECT agent_id, risk_score, transaction_count, average_amount, 
                       risk_factors, last_updated
                FROM agent_risk_profiles 
                WHERE agent_id = $1
            """, agent_id)
            
            if not profile:
                # Create default profile
                await conn.execute("""
                    INSERT INTO agent_risk_profiles (agent_id, risk_score, transaction_count, average_amount, risk_factors)
                    VALUES ($1, 0.5, 0, 0, '[]')
                """, agent_id)
                
                return AgentRiskProfile(
                    agent_id=agent_id,
                    risk_score=0.5,
                    transaction_count=0,
                    average_amount=0.0,
                    risk_factors=[],
                    last_updated=datetime.now()
                )
            
            return AgentRiskProfile(
                agent_id=profile['agent_id'],
                risk_score=float(profile['risk_score']),
                transaction_count=profile['transaction_count'],
                average_amount=float(profile['average_amount']),
                risk_factors=json.loads(profile['risk_factors']),
                last_updated=profile['last_updated']
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get agent profile: {str(e)}")

@app.get("/api/v1/assessments")
async def get_recent_assessments(limit: int = 100, risk_level: Optional[str] = None):
    """Get recent risk assessments"""
    try:
        async with db_pool.acquire() as conn:
            query = """
                SELECT transaction_id, agent_id, risk_score, risk_level, 
                       risk_factors, recommendations, confidence, created_at
                FROM float_risk_assessments
            """
            params = []
            
            if risk_level:
                query += " WHERE risk_level = $1"
                params.append(risk_level)
            
            query += " ORDER BY created_at DESC LIMIT $" + str(len(params) + 1)
            params.append(limit)
            
            assessments = await conn.fetch(query, *params)
            
            return [
                {
                    "transaction_id": row['transaction_id'],
                    "agent_id": row['agent_id'],
                    "risk_score": float(row['risk_score']),
                    "risk_level": row['risk_level'],
                    "risk_factors": json.loads(row['risk_factors']),
                    "recommendations": json.loads(row['recommendations']),
                    "confidence": float(row['confidence']),
                    "created_at": row['created_at'].isoformat()
                }
                for row in assessments
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get assessments: {str(e)}")

@app.post("/api/v1/retrain-models")
async def retrain_models(background_tasks: BackgroundTasks):
    """Retrain risk assessment models"""
    background_tasks.add_task(risk_engine.train_models)
    return {"message": "Model retraining started"}

@app.get("/api/v1/model-performance")
async def get_model_performance():
    """Get model performance metrics"""
    try:
        async with db_pool.acquire() as conn:
            performance = await conn.fetch("""
                SELECT model_name, accuracy, precision_score, recall_score, f1_score, evaluation_date
                FROM risk_model_performance
                ORDER BY evaluation_date DESC
                LIMIT 10
            """)
            
            return [
                {
                    "model_name": row['model_name'],
                    "accuracy": float(row['accuracy']) if row['accuracy'] else None,
                    "precision": float(row['precision_score']) if row['precision_score'] else None,
                    "recall": float(row['recall_score']) if row['recall_score'] else None,
                    "f1_score": float(row['f1_score']) if row['f1_score'] else None,
                    "evaluation_date": row['evaluation_date'].isoformat()
                }
                for row in performance
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get performance metrics: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

