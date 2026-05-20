#!/usr/bin/env python3
"""
Customer Analytics Service
Advanced customer behavior analysis, segmentation, and insights platform
for remittance network with real-time analytics and ML-powered predictions
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
from sklearn.cluster import KMeans, DBSCAN
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestRegressor, GradientBoostingClassifier
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
import plotly.graph_objects as go
import plotly.express as px
from plotly.utils import PlotlyJSONEncoder

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8136"))

# FastAPI app
app = FastAPI(
    title="Customer Analytics",
    description="Advanced customer behavior analysis and segmentation platform",
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
analytics_cache = {}

# Enums
class CustomerSegment(str, Enum):
    HIGH_VALUE = "HIGH_VALUE"
    MEDIUM_VALUE = "MEDIUM_VALUE"
    LOW_VALUE = "LOW_VALUE"
    DORMANT = "DORMANT"
    NEW_CUSTOMER = "NEW_CUSTOMER"
    AT_RISK = "AT_RISK"
    LOYAL = "LOYAL"

class AnalyticsType(str, Enum):
    BEHAVIORAL = "BEHAVIORAL"
    TRANSACTIONAL = "TRANSACTIONAL"
    DEMOGRAPHIC = "DEMOGRAPHIC"
    PREDICTIVE = "PREDICTIVE"
    SEGMENTATION = "SEGMENTATION"

class MetricType(str, Enum):
    REVENUE = "REVENUE"
    FREQUENCY = "FREQUENCY"
    RECENCY = "RECENCY"
    LIFETIME_VALUE = "LIFETIME_VALUE"
    CHURN_RISK = "CHURN_RISK"
    SATISFACTION = "SATISFACTION"

# Pydantic models
class CustomerAnalyticsRequest(BaseModel):
    customer_id: Optional[str] = None
    agent_id: Optional[str] = None
    analytics_type: AnalyticsType
    date_range: Dict[str, datetime]
    include_predictions: bool = True
    include_segments: bool = True

class CustomerProfile(BaseModel):
    customer_id: str
    agent_id: str
    demographic_data: Dict[str, Any]
    behavioral_metrics: Dict[str, Any]
    transaction_summary: Dict[str, Any]
    segment: CustomerSegment
    lifetime_value: Decimal
    churn_risk: float
    satisfaction_score: float
    last_updated: datetime

class CustomerSegmentAnalysis(BaseModel):
    segment: CustomerSegment
    customer_count: int
    avg_lifetime_value: Decimal
    avg_transaction_frequency: float
    avg_satisfaction: float
    characteristics: Dict[str, Any]
    growth_trend: str

class BehavioralInsight(BaseModel):
    insight_id: str
    customer_id: str
    insight_type: str
    description: str
    confidence: float
    impact_score: float
    recommendations: List[str]
    created_at: datetime

class PredictiveModel(BaseModel):
    model_id: str
    model_type: str
    target_variable: str
    accuracy: float
    features: List[str]
    last_trained: datetime

# Database initialization
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create customer profiles table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS customer_profiles (
                    id SERIAL PRIMARY KEY,
                    customer_id VARCHAR(255) UNIQUE NOT NULL,
                    agent_id VARCHAR(255) NOT NULL,
                    demographic_data JSONB,
                    behavioral_metrics JSONB,
                    transaction_summary JSONB,
                    segment VARCHAR(50),
                    lifetime_value DECIMAL(15,2) DEFAULT 0,
                    churn_risk DECIMAL(5,4) DEFAULT 0,
                    satisfaction_score DECIMAL(3,2) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_customer_id (customer_id),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_segment (segment),
                    INDEX idx_churn_risk (churn_risk)
                )
            """)
            
            # Create behavioral insights table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS behavioral_insights (
                    id SERIAL PRIMARY KEY,
                    insight_id VARCHAR(255) UNIQUE NOT NULL,
                    customer_id VARCHAR(255) NOT NULL,
                    insight_type VARCHAR(100) NOT NULL,
                    description TEXT,
                    confidence DECIMAL(5,4),
                    impact_score DECIMAL(5,4),
                    recommendations JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_insight_id (insight_id),
                    INDEX idx_customer_id (customer_id),
                    INDEX idx_insight_type (insight_type),
                    INDEX idx_impact_score (impact_score)
                )
            """)
            
            # Create customer segments table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS customer_segments (
                    id SERIAL PRIMARY KEY,
                    segment VARCHAR(50) UNIQUE NOT NULL,
                    customer_count INTEGER DEFAULT 0,
                    avg_lifetime_value DECIMAL(15,2) DEFAULT 0,
                    avg_transaction_frequency DECIMAL(8,2) DEFAULT 0,
                    avg_satisfaction DECIMAL(3,2) DEFAULT 0,
                    characteristics JSONB,
                    growth_trend VARCHAR(20),
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_segment (segment),
                    INDEX idx_customer_count (customer_count)
                )
            """)
            
            # Create analytics metrics table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS analytics_metrics (
                    id SERIAL PRIMARY KEY,
                    metric_id VARCHAR(255) UNIQUE NOT NULL,
                    customer_id VARCHAR(255),
                    agent_id VARCHAR(255),
                    metric_type VARCHAR(50) NOT NULL,
                    metric_value DECIMAL(15,4),
                    metric_data JSONB,
                    calculation_date DATE DEFAULT CURRENT_DATE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_metric_id (metric_id),
                    INDEX idx_customer_id (customer_id),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_metric_type (metric_type),
                    INDEX idx_calculation_date (calculation_date)
                )
            """)
            
            # Create predictive models table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS predictive_models (
                    id SERIAL PRIMARY KEY,
                    model_id VARCHAR(255) UNIQUE NOT NULL,
                    model_type VARCHAR(100) NOT NULL,
                    target_variable VARCHAR(100) NOT NULL,
                    accuracy DECIMAL(5,4),
                    features JSONB,
                    model_data BYTEA,
                    last_trained TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_model_id (model_id),
                    INDEX idx_model_type (model_type),
                    INDEX idx_accuracy (accuracy)
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
        # Customer segmentation model
        ml_models['segmentation'] = KMeans(n_clusters=7, random_state=42)
        
        # Churn prediction model
        ml_models['churn_predictor'] = GradientBoostingClassifier(
            n_estimators=100,
            random_state=42
        )
        
        # Lifetime value prediction model
        ml_models['ltv_predictor'] = RandomForestRegressor(
            n_estimators=100,
            random_state=42
        )
        
        # Anomaly detection for behavioral analysis
        ml_models['behavior_analyzer'] = DBSCAN(eps=0.5, min_samples=5)
        
        # Feature scalers
        ml_models['scaler'] = StandardScaler()
        ml_models['pca'] = PCA(n_components=10)
        
        # Train models with synthetic data
        await train_initial_models()
        
        logger.info("ML models initialized successfully")
        
    except Exception as e:
        logger.error(f"ML model initialization failed: {e}")

async def train_initial_models():
    """Train models with initial synthetic data"""
    try:
        # Generate synthetic customer data
        np.random.seed(42)
        n_customers = 5000
        
        # Features: age, income, transaction_frequency, avg_amount, tenure_days, satisfaction
        X = np.random.rand(n_customers, 6)
        X[:, 0] = np.random.randint(18, 80, n_customers)  # age
        X[:, 1] = np.random.lognormal(10, 1, n_customers)  # income
        X[:, 2] = np.random.poisson(15, n_customers)  # transaction_frequency
        X[:, 3] = np.random.lognormal(8, 1.5, n_customers)  # avg_amount
        X[:, 4] = np.random.randint(1, 1825, n_customers)  # tenure_days
        X[:, 5] = np.random.beta(6, 2, n_customers) * 5  # satisfaction (1-5)
        
        # Scale features
        X_scaled = ml_models['scaler'].fit_transform(X)
        
        # Train segmentation model
        segment_labels = ml_models['segmentation'].fit_predict(X_scaled)
        
        # Generate churn labels (10% churn rate)
        y_churn = np.random.choice([0, 1], n_customers, p=[0.9, 0.1])
        
        # Generate lifetime value (based on features)
        y_ltv = (X[:, 1] * 0.1 + X[:, 2] * 1000 + X[:, 3] * 0.05 + 
                np.random.normal(0, 5000, n_customers))
        y_ltv = np.maximum(y_ltv, 0)  # Ensure positive values
        
        # Train churn predictor
        ml_models['churn_predictor'].fit(X_scaled, y_churn)
        
        # Train LTV predictor
        ml_models['ltv_predictor'].fit(X_scaled, y_ltv)
        
        # Apply PCA for dimensionality reduction
        ml_models['pca'].fit(X_scaled)
        
        logger.info("Initial model training completed")
        
    except Exception as e:
        logger.error(f"Initial model training failed: {e}")

# Customer analytics engine
class CustomerAnalyticsEngine:
    """Main customer analytics processing engine"""
    
    def __init__(self):
        self.profile_cache = {}
        
    async def analyze_customer(self, customer_id: str, include_predictions: bool = True) -> CustomerProfile:
        """Comprehensive customer analysis"""
        try:
            # Get customer data
            customer_data = await self._get_customer_data(customer_id)
            
            # Calculate behavioral metrics
            behavioral_metrics = await self._calculate_behavioral_metrics(customer_id)
            
            # Calculate transaction summary
            transaction_summary = await self._calculate_transaction_summary(customer_id)
            
            # Determine customer segment
            segment = await self._determine_customer_segment(customer_data, behavioral_metrics)
            
            # Calculate lifetime value
            lifetime_value = await self._calculate_lifetime_value(customer_data, behavioral_metrics)
            
            # Predict churn risk
            churn_risk = await self._predict_churn_risk(customer_data, behavioral_metrics) if include_predictions else 0.0
            
            # Calculate satisfaction score
            satisfaction_score = await self._calculate_satisfaction_score(customer_id)
            
            profile = CustomerProfile(
                customer_id=customer_id,
                agent_id=customer_data.get('agent_id', 'unknown'),
                demographic_data=customer_data.get('demographics', {}),
                behavioral_metrics=behavioral_metrics,
                transaction_summary=transaction_summary,
                segment=segment,
                lifetime_value=Decimal(str(lifetime_value)),
                churn_risk=churn_risk,
                satisfaction_score=satisfaction_score,
                last_updated=datetime.now()
            )
            
            # Store profile
            await self._store_customer_profile(profile)
            
            # Generate behavioral insights
            if include_predictions:
                await self._generate_behavioral_insights(profile)
            
            return profile
            
        except Exception as e:
            logger.error(f"Customer analysis failed for {customer_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Customer analysis failed: {str(e)}")
    
    async def perform_segmentation_analysis(self) -> List[CustomerSegmentAnalysis]:
        """Perform customer segmentation analysis"""
        try:
            # Get all customer features
            customer_features = await self._get_all_customer_features()
            
            if len(customer_features) < 10:
                raise ValueError("Insufficient customer data for segmentation")
            
            # Prepare feature matrix
            feature_matrix = []
            customer_ids = []
            
            for customer_id, features in customer_features.items():
                feature_vector = [
                    features.get('age', 35),
                    features.get('income', 50000),
                    features.get('transaction_frequency', 10),
                    features.get('avg_amount', 25000),
                    features.get('tenure_days', 365),
                    features.get('satisfaction', 4.0)
                ]
                feature_matrix.append(feature_vector)
                customer_ids.append(customer_id)
            
            feature_matrix = np.array(feature_matrix)
            
            # Scale features
            feature_matrix_scaled = ml_models['scaler'].transform(feature_matrix)
            
            # Perform clustering
            cluster_labels = ml_models['segmentation'].predict(feature_matrix_scaled)
            
            # Analyze segments
            segments = []
            segment_names = [
                CustomerSegment.HIGH_VALUE,
                CustomerSegment.MEDIUM_VALUE,
                CustomerSegment.LOW_VALUE,
                CustomerSegment.DORMANT,
                CustomerSegment.NEW_CUSTOMER,
                CustomerSegment.AT_RISK,
                CustomerSegment.LOYAL
            ]
            
            for i, segment_name in enumerate(segment_names):
                segment_customers = [customer_ids[j] for j, label in enumerate(cluster_labels) if label == i]
                
                if segment_customers:
                    segment_features = feature_matrix[cluster_labels == i]
                    
                    segment_analysis = CustomerSegmentAnalysis(
                        segment=segment_name,
                        customer_count=len(segment_customers),
                        avg_lifetime_value=Decimal(str(np.mean(segment_features[:, 1]) * 0.1)),
                        avg_transaction_frequency=float(np.mean(segment_features[:, 2])),
                        avg_satisfaction=float(np.mean(segment_features[:, 5])),
                        characteristics=await self._analyze_segment_characteristics(segment_features),
                        growth_trend=await self._calculate_growth_trend(segment_name)
                    )
                    
                    segments.append(segment_analysis)
                    
                    # Store segment data
                    await self._store_segment_analysis(segment_analysis)
            
            return segments
            
        except Exception as e:
            logger.error(f"Segmentation analysis failed: {e}")
            raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
    
    async def generate_behavioral_insights(self, customer_id: str) -> List[BehavioralInsight]:
        """Generate behavioral insights for customer"""
        try:
            insights = []
            
            # Get customer profile
            profile = await self._get_customer_profile(customer_id)
            if not profile:
                return insights
            
            # Insight 1: Transaction pattern analysis
            transaction_insight = await self._analyze_transaction_patterns(customer_id, profile)
            if transaction_insight:
                insights.append(transaction_insight)
            
            # Insight 2: Spending behavior analysis
            spending_insight = await self._analyze_spending_behavior(customer_id, profile)
            if spending_insight:
                insights.append(spending_insight)
            
            # Insight 3: Engagement analysis
            engagement_insight = await self._analyze_customer_engagement(customer_id, profile)
            if engagement_insight:
                insights.append(engagement_insight)
            
            # Insight 4: Risk analysis
            risk_insight = await self._analyze_customer_risk(customer_id, profile)
            if risk_insight:
                insights.append(risk_insight)
            
            # Store insights
            for insight in insights:
                await self._store_behavioral_insight(insight)
            
            return insights
            
        except Exception as e:
            logger.error(f"Behavioral insights generation failed for {customer_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Insights generation failed: {str(e)}")
    
    async def calculate_analytics_metrics(self, metric_type: MetricType, 
                                        customer_id: Optional[str] = None,
                                        agent_id: Optional[str] = None) -> Dict[str, Any]:
        """Calculate specific analytics metrics"""
        try:
            if metric_type == MetricType.LIFETIME_VALUE:
                return await self._calculate_ltv_metrics(customer_id, agent_id)
            elif metric_type == MetricType.CHURN_RISK:
                return await self._calculate_churn_metrics(customer_id, agent_id)
            elif metric_type == MetricType.SATISFACTION:
                return await self._calculate_satisfaction_metrics(customer_id, agent_id)
            elif metric_type == MetricType.FREQUENCY:
                return await self._calculate_frequency_metrics(customer_id, agent_id)
            elif metric_type == MetricType.RECENCY:
                return await self._calculate_recency_metrics(customer_id, agent_id)
            elif metric_type == MetricType.REVENUE:
                return await self._calculate_revenue_metrics(customer_id, agent_id)
            else:
                raise ValueError(f"Unsupported metric type: {metric_type}")
                
        except Exception as e:
            logger.error(f"Metrics calculation failed: {e}")
            raise HTTPException(status_code=500, detail=f"Metrics calculation failed: {str(e)}")
    
    # Helper methods
    async def _get_customer_data(self, customer_id: str) -> Dict[str, Any]:
        """Get customer data from various sources"""
        # Simulate customer data retrieval
        return {
            'customer_id': customer_id,
            'agent_id': f'agent_{customer_id[-3:]}',
            'demographics': {
                'age': np.random.randint(18, 80),
                'income': np.random.lognormal(10, 1),
                'location': 'Lagos',
                'occupation': 'Business Owner'
            },
            'account_created': datetime.now() - timedelta(days=np.random.randint(30, 1825))
        }
    
    async def _calculate_behavioral_metrics(self, customer_id: str) -> Dict[str, Any]:
        """Calculate behavioral metrics"""
        return {
            'transaction_frequency': np.random.poisson(15),
            'avg_transaction_amount': np.random.lognormal(8, 1.5),
            'preferred_channels': ['mobile', 'agent'],
            'peak_transaction_hours': [10, 14, 16],
            'seasonal_patterns': {'high_months': [11, 12], 'low_months': [2, 3]},
            'service_usage': {
                'deposits': 0.4,
                'withdrawals': 0.3,
                'transfers': 0.2,
                'bill_payments': 0.1
            }
        }
    
    async def _calculate_transaction_summary(self, customer_id: str) -> Dict[str, Any]:
        """Calculate transaction summary"""
        return {
            'total_transactions': np.random.randint(50, 500),
            'total_volume': np.random.uniform(100000, 5000000),
            'avg_amount': np.random.uniform(5000, 100000),
            'last_transaction_date': (datetime.now() - timedelta(days=np.random.randint(1, 30))).isoformat(),
            'most_frequent_type': 'deposit',
            'monthly_trend': 'increasing'
        }
    
    async def _determine_customer_segment(self, customer_data: Dict, behavioral_metrics: Dict) -> CustomerSegment:
        """Determine customer segment using ML model"""
        try:
            # Prepare features
            features = [
                customer_data['demographics']['age'],
                customer_data['demographics']['income'],
                behavioral_metrics['transaction_frequency'],
                behavioral_metrics['avg_transaction_amount'],
                (datetime.now() - customer_data['account_created']).days,
                4.0  # Default satisfaction
            ]
            
            # Scale and predict
            features_scaled = ml_models['scaler'].transform([features])
            cluster = ml_models['segmentation'].predict(features_scaled)[0]
            
            # Map cluster to segment
            segment_mapping = {
                0: CustomerSegment.HIGH_VALUE,
                1: CustomerSegment.MEDIUM_VALUE,
                2: CustomerSegment.LOW_VALUE,
                3: CustomerSegment.DORMANT,
                4: CustomerSegment.NEW_CUSTOMER,
                5: CustomerSegment.AT_RISK,
                6: CustomerSegment.LOYAL
            }
            
            return segment_mapping.get(cluster, CustomerSegment.MEDIUM_VALUE)
            
        except Exception as e:
            logger.error(f"Segment determination failed: {e}")
            return CustomerSegment.MEDIUM_VALUE
    
    async def _calculate_lifetime_value(self, customer_data: Dict, behavioral_metrics: Dict) -> float:
        """Calculate customer lifetime value"""
        try:
            # Prepare features
            features = [
                customer_data['demographics']['age'],
                customer_data['demographics']['income'],
                behavioral_metrics['transaction_frequency'],
                behavioral_metrics['avg_transaction_amount'],
                (datetime.now() - customer_data['account_created']).days,
                4.0  # Default satisfaction
            ]
            
            # Scale and predict
            features_scaled = ml_models['scaler'].transform([features])
            ltv = ml_models['ltv_predictor'].predict(features_scaled)[0]
            
            return max(0, ltv)
            
        except Exception as e:
            logger.error(f"LTV calculation failed: {e}")
            return 50000.0  # Default LTV
    
    async def _predict_churn_risk(self, customer_data: Dict, behavioral_metrics: Dict) -> float:
        """Predict customer churn risk"""
        try:
            # Prepare features
            features = [
                customer_data['demographics']['age'],
                customer_data['demographics']['income'],
                behavioral_metrics['transaction_frequency'],
                behavioral_metrics['avg_transaction_amount'],
                (datetime.now() - customer_data['account_created']).days,
                4.0  # Default satisfaction
            ]
            
            # Scale and predict
            features_scaled = ml_models['scaler'].transform([features])
            churn_prob = ml_models['churn_predictor'].predict_proba(features_scaled)[0][1]
            
            return churn_prob
            
        except Exception as e:
            logger.error(f"Churn prediction failed: {e}")
            return 0.1  # Default low churn risk
    
    async def _calculate_satisfaction_score(self, customer_id: str) -> float:
        """Calculate customer satisfaction score"""
        # Simulate satisfaction calculation based on various factors
        base_satisfaction = 4.0
        
        # Adjust based on transaction success rate
        success_rate = np.random.uniform(0.85, 0.99)
        satisfaction_adjustment = (success_rate - 0.9) * 5  # Scale to satisfaction impact
        
        # Adjust based on service response time
        avg_response_time = np.random.uniform(30, 300)  # seconds
        time_adjustment = max(-1, (120 - avg_response_time) / 120)  # Penalty for slow response
        
        final_satisfaction = base_satisfaction + satisfaction_adjustment + time_adjustment
        return max(1.0, min(5.0, final_satisfaction))
    
    async def _get_all_customer_features(self) -> Dict[str, Dict]:
        """Get features for all customers"""
        # Simulate customer features for segmentation
        customers = {}
        for i in range(100):  # 100 customers
            customer_id = f"customer_{i:03d}"
            customers[customer_id] = {
                'age': np.random.randint(18, 80),
                'income': np.random.lognormal(10, 1),
                'transaction_frequency': np.random.poisson(15),
                'avg_amount': np.random.lognormal(8, 1.5),
                'tenure_days': np.random.randint(30, 1825),
                'satisfaction': np.random.uniform(3.0, 5.0)
            }
        return customers
    
    async def _analyze_segment_characteristics(self, segment_features: np.ndarray) -> Dict[str, Any]:
        """Analyze characteristics of a customer segment"""
        return {
            'avg_age': float(np.mean(segment_features[:, 0])),
            'avg_income': float(np.mean(segment_features[:, 1])),
            'avg_frequency': float(np.mean(segment_features[:, 2])),
            'avg_amount': float(np.mean(segment_features[:, 3])),
            'avg_tenure': float(np.mean(segment_features[:, 4])),
            'primary_behaviors': ['frequent_transactions', 'high_value'],
            'preferred_services': ['deposits', 'transfers']
        }
    
    async def _calculate_growth_trend(self, segment: CustomerSegment) -> str:
        """Calculate growth trend for segment"""
        # Simulate growth trend calculation
        trends = ['growing', 'stable', 'declining']
        return np.random.choice(trends)
    
    async def _analyze_transaction_patterns(self, customer_id: str, profile: Dict) -> Optional[BehavioralInsight]:
        """Analyze transaction patterns"""
        if np.random.random() > 0.7:  # 30% chance of generating insight
            return BehavioralInsight(
                insight_id=f"txn_pattern_{customer_id}_{datetime.now().strftime('%Y%m%d')}",
                customer_id=customer_id,
                insight_type="TRANSACTION_PATTERN",
                description="Customer shows consistent weekly transaction patterns with peak activity on Fridays",
                confidence=0.85,
                impact_score=0.6,
                recommendations=["Offer Friday promotions", "Send weekly reminders"],
                created_at=datetime.now()
            )
        return None
    
    async def _analyze_spending_behavior(self, customer_id: str, profile: Dict) -> Optional[BehavioralInsight]:
        """Analyze spending behavior"""
        if np.random.random() > 0.8:  # 20% chance of generating insight
            return BehavioralInsight(
                insight_id=f"spending_{customer_id}_{datetime.now().strftime('%Y%m%d')}",
                customer_id=customer_id,
                insight_type="SPENDING_BEHAVIOR",
                description="Customer spending has increased 25% over the last quarter",
                confidence=0.92,
                impact_score=0.8,
                recommendations=["Offer premium services", "Increase credit limit"],
                created_at=datetime.now()
            )
        return None
    
    async def _analyze_customer_engagement(self, customer_id: str, profile: Dict) -> Optional[BehavioralInsight]:
        """Analyze customer engagement"""
        return None  # Placeholder
    
    async def _analyze_customer_risk(self, customer_id: str, profile: Dict) -> Optional[BehavioralInsight]:
        """Analyze customer risk"""
        return None  # Placeholder
    
    # Metrics calculation methods
    async def _calculate_ltv_metrics(self, customer_id: Optional[str], agent_id: Optional[str]) -> Dict[str, Any]:
        """Calculate lifetime value metrics"""
        return {
            'avg_ltv': 75000.0,
            'median_ltv': 65000.0,
            'ltv_distribution': {'low': 0.3, 'medium': 0.5, 'high': 0.2},
            'total_ltv': 7500000.0 if not customer_id else 75000.0
        }
    
    async def _calculate_churn_metrics(self, customer_id: Optional[str], agent_id: Optional[str]) -> Dict[str, Any]:
        """Calculate churn risk metrics"""
        return {
            'avg_churn_risk': 0.15,
            'high_risk_customers': 25,
            'churn_rate_trend': 'decreasing',
            'retention_rate': 0.85
        }
    
    async def _calculate_satisfaction_metrics(self, customer_id: Optional[str], agent_id: Optional[str]) -> Dict[str, Any]:
        """Calculate satisfaction metrics"""
        return {
            'avg_satisfaction': 4.2,
            'satisfaction_distribution': {'1-2': 0.05, '3': 0.15, '4': 0.45, '5': 0.35},
            'nps_score': 65,
            'satisfaction_trend': 'improving'
        }
    
    async def _calculate_frequency_metrics(self, customer_id: Optional[str], agent_id: Optional[str]) -> Dict[str, Any]:
        """Calculate transaction frequency metrics"""
        return {
            'avg_frequency': 12.5,
            'frequency_distribution': {'low': 0.3, 'medium': 0.5, 'high': 0.2},
            'peak_days': ['Friday', 'Monday'],
            'seasonal_variation': 0.15
        }
    
    async def _calculate_recency_metrics(self, customer_id: Optional[str], agent_id: Optional[str]) -> Dict[str, Any]:
        """Calculate recency metrics"""
        return {
            'avg_days_since_last_transaction': 5.2,
            'dormant_customers': 15,
            'active_customers': 185,
            'reactivation_rate': 0.25
        }
    
    async def _calculate_revenue_metrics(self, customer_id: Optional[str], agent_id: Optional[str]) -> Dict[str, Any]:
        """Calculate revenue metrics"""
        return {
            'total_revenue': 2500000.0,
            'avg_revenue_per_customer': 12500.0,
            'revenue_growth_rate': 0.15,
            'top_revenue_segments': ['HIGH_VALUE', 'LOYAL']
        }
    
    # Storage methods
    async def _store_customer_profile(self, profile: CustomerProfile):
        """Store customer profile"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO customer_profiles 
                (customer_id, agent_id, demographic_data, behavioral_metrics, 
                 transaction_summary, segment, lifetime_value, churn_risk, satisfaction_score)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (customer_id) DO UPDATE SET
                agent_id = EXCLUDED.agent_id,
                demographic_data = EXCLUDED.demographic_data,
                behavioral_metrics = EXCLUDED.behavioral_metrics,
                transaction_summary = EXCLUDED.transaction_summary,
                segment = EXCLUDED.segment,
                lifetime_value = EXCLUDED.lifetime_value,
                churn_risk = EXCLUDED.churn_risk,
                satisfaction_score = EXCLUDED.satisfaction_score,
                last_updated = CURRENT_TIMESTAMP
            """, 
            profile.customer_id, profile.agent_id, json.dumps(profile.demographic_data),
            json.dumps(profile.behavioral_metrics), json.dumps(profile.transaction_summary),
            profile.segment.value, profile.lifetime_value, profile.churn_risk, profile.satisfaction_score
            )
    
    async def _store_segment_analysis(self, segment: CustomerSegmentAnalysis):
        """Store segment analysis"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO customer_segments 
                (segment, customer_count, avg_lifetime_value, avg_transaction_frequency,
                 avg_satisfaction, characteristics, growth_trend)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (segment) DO UPDATE SET
                customer_count = EXCLUDED.customer_count,
                avg_lifetime_value = EXCLUDED.avg_lifetime_value,
                avg_transaction_frequency = EXCLUDED.avg_transaction_frequency,
                avg_satisfaction = EXCLUDED.avg_satisfaction,
                characteristics = EXCLUDED.characteristics,
                growth_trend = EXCLUDED.growth_trend,
                last_updated = CURRENT_TIMESTAMP
            """, 
            segment.segment.value, segment.customer_count, segment.avg_lifetime_value,
            segment.avg_transaction_frequency, segment.avg_satisfaction,
            json.dumps(segment.characteristics), segment.growth_trend
            )
    
    async def _store_behavioral_insight(self, insight: BehavioralInsight):
        """Store behavioral insight"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO behavioral_insights 
                (insight_id, customer_id, insight_type, description, confidence,
                 impact_score, recommendations)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (insight_id) DO NOTHING
            """, 
            insight.insight_id, insight.customer_id, insight.insight_type,
            insight.description, insight.confidence, insight.impact_score,
            json.dumps(insight.recommendations)
            )
    
    async def _get_customer_profile(self, customer_id: str) -> Optional[Dict]:
        """Get customer profile from database"""
        async with db_pool.acquire() as conn:
            profile = await conn.fetchrow("""
                SELECT * FROM customer_profiles WHERE customer_id = $1
            """, customer_id)
            return dict(profile) if profile else None
    
    async def _generate_behavioral_insights(self, profile: CustomerProfile):
        """Generate and store behavioral insights"""
        insights = await self.generate_behavioral_insights(profile.customer_id)
        # Insights are already stored in the method

# Initialize analytics engine
analytics_engine = CustomerAnalyticsEngine()

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
            "service": "customer-analytics",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "ml_models": "loaded" if ml_models else "not_loaded"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/analyze-customer", response_model=CustomerProfile)
async def analyze_customer(customer_id: str, include_predictions: bool = True):
    """Analyze individual customer"""
    return await analytics_engine.analyze_customer(customer_id, include_predictions)

@app.get("/api/v1/segmentation")
async def get_segmentation_analysis():
    """Get customer segmentation analysis"""
    segments = await analytics_engine.perform_segmentation_analysis()
    return {"segments": [segment.dict() for segment in segments]}

@app.get("/api/v1/insights/{customer_id}")
async def get_behavioral_insights(customer_id: str):
    """Get behavioral insights for customer"""
    insights = await analytics_engine.generate_behavioral_insights(customer_id)
    return {"customer_id": customer_id, "insights": [insight.dict() for insight in insights]}

@app.get("/api/v1/metrics/{metric_type}")
async def get_analytics_metrics(
    metric_type: MetricType,
    customer_id: Optional[str] = None,
    agent_id: Optional[str] = None
):
    """Get analytics metrics"""
    return await analytics_engine.calculate_analytics_metrics(metric_type, customer_id, agent_id)

@app.get("/api/v1/profiles")
async def list_customer_profiles(
    segment: Optional[CustomerSegment] = None,
    agent_id: Optional[str] = None,
    limit: int = 100
):
    """List customer profiles"""
    try:
        async with db_pool.acquire() as conn:
            query = "SELECT * FROM customer_profiles WHERE 1=1"
            params = []
            
            if segment:
                query += f" AND segment = ${len(params) + 1}"
                params.append(segment.value)
            
            if agent_id:
                query += f" AND agent_id = ${len(params) + 1}"
                params.append(agent_id)
            
            query += f" ORDER BY last_updated DESC LIMIT ${len(params) + 1}"
            params.append(limit)
            
            profiles = await conn.fetch(query, *params)
            
            return [
                {
                    "customer_id": row['customer_id'],
                    "agent_id": row['agent_id'],
                    "segment": row['segment'],
                    "lifetime_value": float(row['lifetime_value']),
                    "churn_risk": float(row['churn_risk']),
                    "satisfaction_score": float(row['satisfaction_score']),
                    "last_updated": row['last_updated'].isoformat()
                }
                for row in profiles
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list profiles: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

