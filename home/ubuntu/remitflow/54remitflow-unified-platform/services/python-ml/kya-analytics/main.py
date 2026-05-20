#!/usr/bin/env python3
"""
KYA (Know Your Agent) Analytics Service
Advanced analytics and behavioral analysis for agent performance and risk assessment
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
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report
import joblib
import plotly.graph_objects as go
import plotly.express as px
from plotly.utils import PlotlyJSONEncoder

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8132"))

# FastAPI app
app = FastAPI(
    title="KYA Analytics",
    description="Advanced analytics and behavioral analysis for agent performance and risk assessment",
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
class AgentRiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

class PerformanceCategory(str, Enum):
    EXCELLENT = "EXCELLENT"
    GOOD = "GOOD"
    AVERAGE = "AVERAGE"
    POOR = "POOR"

class AnalyticsType(str, Enum):
    PERFORMANCE = "PERFORMANCE"
    RISK = "RISK"
    BEHAVIORAL = "BEHAVIORAL"
    FINANCIAL = "FINANCIAL"
    COMPLIANCE = "COMPLIANCE"

class AlertSeverity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"

# Pydantic models
class AgentAnalyticsRequest(BaseModel):
    agent_id: str
    analysis_type: AnalyticsType
    date_range: Dict[str, datetime]
    include_predictions: bool = True
    include_recommendations: bool = True

class AgentPerformanceMetrics(BaseModel):
    agent_id: str
    period_start: datetime
    period_end: datetime
    transaction_volume: int
    transaction_value: Decimal
    success_rate: float
    average_transaction_time: float
    customer_satisfaction: float
    compliance_score: float
    risk_score: float
    performance_category: PerformanceCategory

class BehavioralPattern(BaseModel):
    pattern_id: str
    agent_id: str
    pattern_type: str
    description: str
    frequency: int
    risk_level: AgentRiskLevel
    first_observed: datetime
    last_observed: datetime
    confidence: float

class AgentCluster(BaseModel):
    cluster_id: int
    cluster_name: str
    agent_count: int
    characteristics: Dict[str, Any]
    performance_profile: Dict[str, float]
    risk_profile: Dict[str, float]

class AnalyticsAlert(BaseModel):
    alert_id: str
    agent_id: str
    alert_type: str
    severity: AlertSeverity
    message: str
    data: Dict[str, Any]
    created_at: datetime
    resolved: bool = False

class PredictiveInsight(BaseModel):
    insight_id: str
    agent_id: str
    prediction_type: str
    predicted_value: float
    confidence: float
    time_horizon: str
    factors: List[str]
    recommendations: List[str]

# Database functions
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_performance_metrics (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(255) NOT NULL,
                    period_start DATE NOT NULL,
                    period_end DATE NOT NULL,
                    transaction_volume INTEGER DEFAULT 0,
                    transaction_value DECIMAL(15,2) DEFAULT 0,
                    success_rate DECIMAL(5,4) DEFAULT 0,
                    average_transaction_time DECIMAL(8,2) DEFAULT 0,
                    customer_satisfaction DECIMAL(3,2) DEFAULT 0,
                    compliance_score DECIMAL(5,4) DEFAULT 0,
                    risk_score DECIMAL(5,4) DEFAULT 0,
                    performance_category VARCHAR(20),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_period (period_start, period_end),
                    UNIQUE(agent_id, period_start, period_end)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS behavioral_patterns (
                    id SERIAL PRIMARY KEY,
                    pattern_id VARCHAR(255) UNIQUE NOT NULL,
                    agent_id VARCHAR(255) NOT NULL,
                    pattern_type VARCHAR(100) NOT NULL,
                    description TEXT,
                    frequency INTEGER DEFAULT 1,
                    risk_level VARCHAR(20) DEFAULT 'LOW',
                    first_observed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_observed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    confidence DECIMAL(5,4) DEFAULT 0,
                    pattern_data JSONB,
                    INDEX idx_pattern_id (pattern_id),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_pattern_type (pattern_type),
                    INDEX idx_risk_level (risk_level)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_clusters (
                    id SERIAL PRIMARY KEY,
                    cluster_id INTEGER NOT NULL,
                    cluster_name VARCHAR(255),
                    agent_count INTEGER DEFAULT 0,
                    characteristics JSONB,
                    performance_profile JSONB,
                    risk_profile JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_cluster_id (cluster_id)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_cluster_assignments (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(255) NOT NULL,
                    cluster_id INTEGER NOT NULL,
                    assignment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    confidence DECIMAL(5,4) DEFAULT 0,
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_cluster_id (cluster_id),
                    UNIQUE(agent_id, assignment_date)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS analytics_alerts (
                    id SERIAL PRIMARY KEY,
                    alert_id VARCHAR(255) UNIQUE NOT NULL,
                    agent_id VARCHAR(255) NOT NULL,
                    alert_type VARCHAR(100) NOT NULL,
                    severity VARCHAR(20) DEFAULT 'INFO',
                    message TEXT NOT NULL,
                    alert_data JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    resolved BOOLEAN DEFAULT FALSE,
                    resolved_at TIMESTAMP,
                    INDEX idx_alert_id (alert_id),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_alert_type (alert_type),
                    INDEX idx_severity (severity),
                    INDEX idx_resolved (resolved)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS predictive_insights (
                    id SERIAL PRIMARY KEY,
                    insight_id VARCHAR(255) UNIQUE NOT NULL,
                    agent_id VARCHAR(255) NOT NULL,
                    prediction_type VARCHAR(100) NOT NULL,
                    predicted_value DECIMAL(10,4),
                    confidence DECIMAL(5,4),
                    time_horizon VARCHAR(50),
                    factors JSONB,
                    recommendations JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP,
                    INDEX idx_insight_id (insight_id),
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_prediction_type (prediction_type),
                    INDEX idx_expires_at (expires_at)
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agent_transaction_summary (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(255) NOT NULL,
                    date DATE DEFAULT CURRENT_DATE,
                    total_transactions INTEGER DEFAULT 0,
                    total_volume DECIMAL(15,2) DEFAULT 0,
                    successful_transactions INTEGER DEFAULT 0,
                    failed_transactions INTEGER DEFAULT 0,
                    average_amount DECIMAL(15,2) DEFAULT 0,
                    peak_hour INTEGER,
                    unique_customers INTEGER DEFAULT 0,
                    INDEX idx_agent_id (agent_id),
                    INDEX idx_date (date),
                    UNIQUE(agent_id, date)
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
        # Performance prediction model
        ml_models['performance_predictor'] = RandomForestClassifier(
            n_estimators=100,
            random_state=42
        )
        
        # Risk assessment model
        ml_models['risk_assessor'] = IsolationForest(
            contamination=0.1,
            random_state=42
        )
        
        # Behavioral clustering model
        ml_models['behavior_clusterer'] = KMeans(
            n_clusters=5,
            random_state=42
        )
        
        # Feature scaler
        ml_models['scaler'] = StandardScaler()
        
        # Train models with synthetic data initially
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
        
        # Features: transaction_volume, success_rate, avg_amount, customer_satisfaction, compliance_score
        X = np.random.rand(n_samples, 5)
        X[:, 0] *= 1000  # transaction_volume
        X[:, 1] = np.random.beta(8, 2, n_samples)  # success_rate (skewed towards high)
        X[:, 2] *= 50000  # avg_amount
        X[:, 3] = np.random.beta(6, 2, n_samples) * 5  # customer_satisfaction (1-5)
        X[:, 4] = np.random.beta(7, 2, n_samples)  # compliance_score
        
        # Performance labels (0: Poor, 1: Average, 2: Good, 3: Excellent)
        y_performance = np.random.choice([0, 1, 2, 3], n_samples, p=[0.1, 0.3, 0.4, 0.2])
        
        # Train performance predictor
        ml_models['performance_predictor'].fit(X, y_performance)
        
        # Train risk assessor (unsupervised)
        ml_models['risk_assessor'].fit(X)
        
        # Train behavioral clusterer
        ml_models['behavior_clusterer'].fit(X)
        
        # Fit scaler
        ml_models['scaler'].fit(X)
        
        logger.info("Initial model training completed")
        
    except Exception as e:
        logger.error(f"Initial model training failed: {e}")

# Analytics engine
class KYAAnalyticsEngine:
    """Main KYA analytics processing engine"""
    
    def __init__(self):
        self.analysis_cache = {}
        
    async def analyze_agent_performance(self, agent_id: str, date_range: Dict[str, datetime]) -> AgentPerformanceMetrics:
        """Comprehensive agent performance analysis"""
        try:
            start_date = date_range['start']
            end_date = date_range['end']
            
            # Get agent transaction data
            transaction_data = await self._get_agent_transaction_data(agent_id, start_date, end_date)
            
            # Calculate performance metrics
            metrics = await self._calculate_performance_metrics(agent_id, transaction_data, start_date, end_date)
            
            # Store metrics
            await self._store_performance_metrics(metrics)
            
            return metrics
            
        except Exception as e:
            logger.error(f"Performance analysis failed for agent {agent_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Performance analysis failed: {str(e)}")
    
    async def detect_behavioral_patterns(self, agent_id: str, lookback_days: int = 30) -> List[BehavioralPattern]:
        """Detect behavioral patterns and anomalies"""
        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=lookback_days)
            
            # Get agent behavior data
            behavior_data = await self._get_agent_behavior_data(agent_id, start_date, end_date)
            
            # Detect patterns
            patterns = []
            
            # Pattern 1: Unusual transaction timing
            timing_pattern = await self._detect_timing_patterns(agent_id, behavior_data)
            if timing_pattern:
                patterns.append(timing_pattern)
            
            # Pattern 2: Transaction amount clustering
            amount_pattern = await self._detect_amount_patterns(agent_id, behavior_data)
            if amount_pattern:
                patterns.append(amount_pattern)
            
            # Pattern 3: Customer interaction patterns
            interaction_pattern = await self._detect_interaction_patterns(agent_id, behavior_data)
            if interaction_pattern:
                patterns.append(interaction_pattern)
            
            # Pattern 4: Geographic patterns
            geo_pattern = await self._detect_geographic_patterns(agent_id, behavior_data)
            if geo_pattern:
                patterns.append(geo_pattern)
            
            # Store detected patterns
            for pattern in patterns:
                await self._store_behavioral_pattern(pattern)
            
            return patterns
            
        except Exception as e:
            logger.error(f"Behavioral pattern detection failed for agent {agent_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Pattern detection failed: {str(e)}")
    
    async def perform_agent_clustering(self, include_all_agents: bool = True) -> List[AgentCluster]:
        """Perform agent clustering analysis"""
        try:
            # Get agent features for clustering
            agent_features = await self._get_agent_features_for_clustering()
            
            if len(agent_features) < 5:
                raise ValueError("Insufficient data for clustering analysis")
            
            # Prepare feature matrix
            feature_matrix = np.array([list(features.values()) for features in agent_features.values()])
            
            # Scale features
            scaled_features = ml_models['scaler'].fit_transform(feature_matrix)
            
            # Perform clustering
            cluster_labels = ml_models['behavior_clusterer'].fit_predict(scaled_features)
            
            # Analyze clusters
            clusters = []
            unique_labels = np.unique(cluster_labels)
            
            for cluster_id in unique_labels:
                cluster_agents = [agent_id for i, agent_id in enumerate(agent_features.keys()) 
                                if cluster_labels[i] == cluster_id]
                
                cluster_features = scaled_features[cluster_labels == cluster_id]
                
                cluster = AgentCluster(
                    cluster_id=int(cluster_id),
                    cluster_name=f"Agent Cluster {cluster_id + 1}",
                    agent_count=len(cluster_agents),
                    characteristics=await self._analyze_cluster_characteristics(cluster_agents),
                    performance_profile=await self._analyze_cluster_performance(cluster_agents),
                    risk_profile=await self._analyze_cluster_risk(cluster_agents)
                )
                
                clusters.append(cluster)
                
                # Store cluster assignments
                await self._store_cluster_assignments(cluster_agents, cluster_id)
            
            # Store cluster information
            await self._store_clusters(clusters)
            
            return clusters
            
        except Exception as e:
            logger.error(f"Agent clustering failed: {e}")
            raise HTTPException(status_code=500, detail=f"Clustering failed: {str(e)}")
    
    async def generate_predictive_insights(self, agent_id: str) -> List[PredictiveInsight]:
        """Generate predictive insights for agent"""
        try:
            insights = []
            
            # Get agent historical data
            historical_data = await self._get_agent_historical_data(agent_id)
            
            if not historical_data:
                return insights
            
            # Predict performance trend
            performance_insight = await self._predict_performance_trend(agent_id, historical_data)
            if performance_insight:
                insights.append(performance_insight)
            
            # Predict risk level
            risk_insight = await self._predict_risk_level(agent_id, historical_data)
            if risk_insight:
                insights.append(risk_insight)
            
            # Predict transaction volume
            volume_insight = await self._predict_transaction_volume(agent_id, historical_data)
            if volume_insight:
                insights.append(volume_insight)
            
            # Predict customer satisfaction
            satisfaction_insight = await self._predict_customer_satisfaction(agent_id, historical_data)
            if satisfaction_insight:
                insights.append(satisfaction_insight)
            
            # Store insights
            for insight in insights:
                await self._store_predictive_insight(insight)
            
            return insights
            
        except Exception as e:
            logger.error(f"Predictive insights generation failed for agent {agent_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Insights generation failed: {str(e)}")
    
    async def generate_analytics_alerts(self, agent_id: str) -> List[AnalyticsAlert]:
        """Generate analytics-based alerts"""
        try:
            alerts = []
            
            # Get recent performance data
            recent_metrics = await self._get_recent_performance_metrics(agent_id)
            
            # Check for performance degradation
            if recent_metrics and recent_metrics.get('success_rate', 1.0) < 0.8:
                alert = AnalyticsAlert(
                    alert_id=f"perf_deg_{agent_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
                    agent_id=agent_id,
                    alert_type="PERFORMANCE_DEGRADATION",
                    severity=AlertSeverity.WARNING,
                    message=f"Agent {agent_id} showing performance degradation: {recent_metrics['success_rate']:.2%} success rate",
                    data=recent_metrics,
                    created_at=datetime.now()
                )
                alerts.append(alert)
            
            # Check for unusual patterns
            patterns = await self._get_recent_behavioral_patterns(agent_id)
            for pattern in patterns:
                if pattern.get('risk_level') in ['HIGH', 'CRITICAL']:
                    alert = AnalyticsAlert(
                        alert_id=f"pattern_{agent_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
                        agent_id=agent_id,
                        alert_type="BEHAVIORAL_ANOMALY",
                        severity=AlertSeverity.CRITICAL if pattern['risk_level'] == 'CRITICAL' else AlertSeverity.WARNING,
                        message=f"Unusual behavioral pattern detected: {pattern['description']}",
                        data=pattern,
                        created_at=datetime.now()
                    )
                    alerts.append(alert)
            
            # Check for compliance issues
            compliance_score = recent_metrics.get('compliance_score', 1.0) if recent_metrics else 1.0
            if compliance_score < 0.7:
                alert = AnalyticsAlert(
                    alert_id=f"compliance_{agent_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
                    agent_id=agent_id,
                    alert_type="COMPLIANCE_ISSUE",
                    severity=AlertSeverity.CRITICAL,
                    message=f"Agent {agent_id} compliance score below threshold: {compliance_score:.2%}",
                    data={"compliance_score": compliance_score},
                    created_at=datetime.now()
                )
                alerts.append(alert)
            
            # Store alerts
            for alert in alerts:
                await self._store_analytics_alert(alert)
            
            return alerts
            
        except Exception as e:
            logger.error(f"Alert generation failed for agent {agent_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Alert generation failed: {str(e)}")
    
    async def generate_analytics_dashboard_data(self, agent_id: Optional[str] = None) -> Dict[str, Any]:
        """Generate comprehensive dashboard data"""
        try:
            dashboard_data = {}
            
            if agent_id:
                # Single agent dashboard
                dashboard_data = await self._generate_agent_dashboard(agent_id)
            else:
                # System-wide dashboard
                dashboard_data = await self._generate_system_dashboard()
            
            return dashboard_data
            
        except Exception as e:
            logger.error(f"Dashboard data generation failed: {e}")
            raise HTTPException(status_code=500, detail=f"Dashboard generation failed: {str(e)}")
    
    # Helper methods
    async def _get_agent_transaction_data(self, agent_id: str, start_date: datetime, end_date: datetime) -> Dict:
        """Get agent transaction data for analysis"""
        # This would typically query the transaction database
        # For now, return simulated data
        return {
            'total_transactions': 150,
            'successful_transactions': 142,
            'failed_transactions': 8,
            'total_volume': Decimal('2500000.00'),
            'average_amount': Decimal('16666.67'),
            'unique_customers': 85,
            'peak_hour': 14,
            'transaction_times': [2.5, 3.1, 2.8, 4.2, 2.9]  # in minutes
        }
    
    async def _calculate_performance_metrics(self, agent_id: str, transaction_data: Dict, start_date: datetime, end_date: datetime) -> AgentPerformanceMetrics:
        """Calculate comprehensive performance metrics"""
        total_transactions = transaction_data['total_transactions']
        successful_transactions = transaction_data['successful_transactions']
        
        success_rate = successful_transactions / total_transactions if total_transactions > 0 else 0
        avg_transaction_time = np.mean(transaction_data['transaction_times'])
        
        # Simulate other metrics
        customer_satisfaction = min(5.0, 3.5 + (success_rate * 1.5))
        compliance_score = min(1.0, 0.7 + (success_rate * 0.3))
        risk_score = max(0.0, 0.5 - (success_rate * 0.4))
        
        # Determine performance category
        if success_rate >= 0.95 and customer_satisfaction >= 4.5:
            category = PerformanceCategory.EXCELLENT
        elif success_rate >= 0.90 and customer_satisfaction >= 4.0:
            category = PerformanceCategory.GOOD
        elif success_rate >= 0.80 and customer_satisfaction >= 3.5:
            category = PerformanceCategory.AVERAGE
        else:
            category = PerformanceCategory.POOR
        
        return AgentPerformanceMetrics(
            agent_id=agent_id,
            period_start=start_date,
            period_end=end_date,
            transaction_volume=total_transactions,
            transaction_value=transaction_data['total_volume'],
            success_rate=success_rate,
            average_transaction_time=avg_transaction_time,
            customer_satisfaction=customer_satisfaction,
            compliance_score=compliance_score,
            risk_score=risk_score,
            performance_category=category
        )
    
    async def _detect_timing_patterns(self, agent_id: str, behavior_data: Dict) -> Optional[BehavioralPattern]:
        """Detect unusual timing patterns"""
        # Simulate timing pattern detection
        if np.random.random() > 0.7:  # 30% chance of detecting pattern
            return BehavioralPattern(
                pattern_id=f"timing_{agent_id}_{datetime.now().strftime('%Y%m%d')}",
                agent_id=agent_id,
                pattern_type="UNUSUAL_TIMING",
                description="Agent frequently processes transactions outside normal business hours",
                frequency=5,
                risk_level=AgentRiskLevel.MEDIUM,
                first_observed=datetime.now() - timedelta(days=7),
                last_observed=datetime.now(),
                confidence=0.85
            )
        return None
    
    async def _detect_amount_patterns(self, agent_id: str, behavior_data: Dict) -> Optional[BehavioralPattern]:
        """Detect unusual amount patterns"""
        # Simulate amount pattern detection
        if np.random.random() > 0.8:  # 20% chance of detecting pattern
            return BehavioralPattern(
                pattern_id=f"amount_{agent_id}_{datetime.now().strftime('%Y%m%d')}",
                agent_id=agent_id,
                pattern_type="AMOUNT_CLUSTERING",
                description="Agent shows clustering around specific transaction amounts",
                frequency=12,
                risk_level=AgentRiskLevel.LOW,
                first_observed=datetime.now() - timedelta(days=14),
                last_observed=datetime.now(),
                confidence=0.72
            )
        return None
    
    async def _detect_interaction_patterns(self, agent_id: str, behavior_data: Dict) -> Optional[BehavioralPattern]:
        """Detect customer interaction patterns"""
        return None  # Placeholder
    
    async def _detect_geographic_patterns(self, agent_id: str, behavior_data: Dict) -> Optional[BehavioralPattern]:
        """Detect geographic patterns"""
        return None  # Placeholder
    
    async def _get_agent_behavior_data(self, agent_id: str, start_date: datetime, end_date: datetime) -> Dict:
        """Get agent behavior data"""
        return {}  # Placeholder
    
    async def _get_agent_features_for_clustering(self) -> Dict[str, Dict]:
        """Get agent features for clustering"""
        # Simulate agent features
        agents = [f"agent_{i:03d}" for i in range(1, 51)]  # 50 agents
        features = {}
        
        for agent_id in agents:
            features[agent_id] = {
                'transaction_volume': np.random.randint(50, 500),
                'success_rate': np.random.beta(8, 2),
                'avg_amount': np.random.uniform(5000, 50000),
                'customer_satisfaction': np.random.uniform(3.0, 5.0),
                'compliance_score': np.random.beta(7, 2)
            }
        
        return features
    
    async def _analyze_cluster_characteristics(self, cluster_agents: List[str]) -> Dict[str, Any]:
        """Analyze cluster characteristics"""
        return {
            "primary_characteristics": ["High volume", "Consistent performance"],
            "agent_count": len(cluster_agents),
            "geographic_distribution": "Urban areas",
            "service_types": ["Cash deposits", "Withdrawals", "Transfers"]
        }
    
    async def _analyze_cluster_performance(self, cluster_agents: List[str]) -> Dict[str, float]:
        """Analyze cluster performance profile"""
        return {
            "avg_success_rate": 0.92,
            "avg_customer_satisfaction": 4.2,
            "avg_transaction_volume": 250.0,
            "avg_compliance_score": 0.88
        }
    
    async def _analyze_cluster_risk(self, cluster_agents: List[str]) -> Dict[str, float]:
        """Analyze cluster risk profile"""
        return {
            "avg_risk_score": 0.25,
            "fraud_incidents": 0.02,
            "compliance_violations": 0.05,
            "operational_risk": 0.15
        }
    
    async def _get_agent_historical_data(self, agent_id: str) -> Dict:
        """Get agent historical data for predictions"""
        return {
            "performance_history": [0.85, 0.88, 0.90, 0.87, 0.92],
            "volume_history": [120, 135, 150, 142, 158],
            "satisfaction_history": [4.1, 4.2, 4.3, 4.0, 4.4]
        }
    
    async def _predict_performance_trend(self, agent_id: str, historical_data: Dict) -> Optional[PredictiveInsight]:
        """Predict performance trend"""
        performance_history = historical_data.get('performance_history', [])
        if len(performance_history) >= 3:
            trend = np.polyfit(range(len(performance_history)), performance_history, 1)[0]
            predicted_performance = performance_history[-1] + trend
            
            return PredictiveInsight(
                insight_id=f"perf_trend_{agent_id}_{datetime.now().strftime('%Y%m%d')}",
                agent_id=agent_id,
                prediction_type="PERFORMANCE_TREND",
                predicted_value=predicted_performance,
                confidence=0.78,
                time_horizon="30_days",
                factors=["Historical performance", "Transaction volume", "Customer feedback"],
                recommendations=["Maintain current practices" if trend >= 0 else "Focus on improvement areas"]
            )
        return None
    
    async def _predict_risk_level(self, agent_id: str, historical_data: Dict) -> Optional[PredictiveInsight]:
        """Predict risk level"""
        return PredictiveInsight(
            insight_id=f"risk_pred_{agent_id}_{datetime.now().strftime('%Y%m%d')}",
            agent_id=agent_id,
            prediction_type="RISK_LEVEL",
            predicted_value=0.25,
            confidence=0.82,
            time_horizon="7_days",
            factors=["Transaction patterns", "Compliance history", "Performance metrics"],
            recommendations=["Continue monitoring", "Regular compliance checks"]
        )
    
    async def _predict_transaction_volume(self, agent_id: str, historical_data: Dict) -> Optional[PredictiveInsight]:
        """Predict transaction volume"""
        return None  # Placeholder
    
    async def _predict_customer_satisfaction(self, agent_id: str, historical_data: Dict) -> Optional[PredictiveInsight]:
        """Predict customer satisfaction"""
        return None  # Placeholder
    
    async def _get_recent_performance_metrics(self, agent_id: str) -> Optional[Dict]:
        """Get recent performance metrics"""
        try:
            async with db_pool.acquire() as conn:
                metrics = await conn.fetchrow("""
                    SELECT * FROM agent_performance_metrics 
                    WHERE agent_id = $1 
                    ORDER BY period_end DESC 
                    LIMIT 1
                """, agent_id)
                
                return dict(metrics) if metrics else None
                
        except Exception as e:
            logger.error(f"Failed to get recent metrics: {e}")
            return None
    
    async def _get_recent_behavioral_patterns(self, agent_id: str) -> List[Dict]:
        """Get recent behavioral patterns"""
        try:
            async with db_pool.acquire() as conn:
                patterns = await conn.fetch("""
                    SELECT * FROM behavioral_patterns 
                    WHERE agent_id = $1 AND last_observed >= $2
                    ORDER BY last_observed DESC
                """, agent_id, datetime.now() - timedelta(days=7))
                
                return [dict(pattern) for pattern in patterns]
                
        except Exception as e:
            logger.error(f"Failed to get recent patterns: {e}")
            return []
    
    async def _generate_agent_dashboard(self, agent_id: str) -> Dict[str, Any]:
        """Generate single agent dashboard data"""
        return {
            "agent_id": agent_id,
            "performance_summary": {
                "current_rating": "GOOD",
                "success_rate": 0.92,
                "customer_satisfaction": 4.3,
                "risk_level": "LOW"
            },
            "recent_trends": {
                "performance_trend": "IMPROVING",
                "volume_trend": "STABLE",
                "satisfaction_trend": "IMPROVING"
            },
            "alerts": [],
            "recommendations": [
                "Continue current performance level",
                "Focus on customer service excellence"
            ]
        }
    
    async def _generate_system_dashboard(self) -> Dict[str, Any]:
        """Generate system-wide dashboard data"""
        return {
            "overview": {
                "total_agents": 50,
                "active_agents": 47,
                "avg_performance": 0.88,
                "total_alerts": 3
            },
            "performance_distribution": {
                "excellent": 12,
                "good": 23,
                "average": 10,
                "poor": 2
            },
            "risk_distribution": {
                "low": 35,
                "medium": 10,
                "high": 4,
                "critical": 1
            }
        }
    
    # Storage methods
    async def _store_performance_metrics(self, metrics: AgentPerformanceMetrics):
        """Store performance metrics"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO agent_performance_metrics 
                (agent_id, period_start, period_end, transaction_volume, transaction_value,
                 success_rate, average_transaction_time, customer_satisfaction, 
                 compliance_score, risk_score, performance_category)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (agent_id, period_start, period_end) DO UPDATE SET
                transaction_volume = EXCLUDED.transaction_volume,
                transaction_value = EXCLUDED.transaction_value,
                success_rate = EXCLUDED.success_rate,
                average_transaction_time = EXCLUDED.average_transaction_time,
                customer_satisfaction = EXCLUDED.customer_satisfaction,
                compliance_score = EXCLUDED.compliance_score,
                risk_score = EXCLUDED.risk_score,
                performance_category = EXCLUDED.performance_category,
                updated_at = CURRENT_TIMESTAMP
            """, 
            metrics.agent_id, metrics.period_start, metrics.period_end,
            metrics.transaction_volume, metrics.transaction_value,
            metrics.success_rate, metrics.average_transaction_time,
            metrics.customer_satisfaction, metrics.compliance_score,
            metrics.risk_score, metrics.performance_category.value
            )
    
    async def _store_behavioral_pattern(self, pattern: BehavioralPattern):
        """Store behavioral pattern"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO behavioral_patterns 
                (pattern_id, agent_id, pattern_type, description, frequency, 
                 risk_level, first_observed, last_observed, confidence)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (pattern_id) DO UPDATE SET
                frequency = EXCLUDED.frequency,
                last_observed = EXCLUDED.last_observed,
                confidence = EXCLUDED.confidence
            """, 
            pattern.pattern_id, pattern.agent_id, pattern.pattern_type,
            pattern.description, pattern.frequency, pattern.risk_level.value,
            pattern.first_observed, pattern.last_observed, pattern.confidence
            )
    
    async def _store_clusters(self, clusters: List[AgentCluster]):
        """Store cluster information"""
        async with db_pool.acquire() as conn:
            for cluster in clusters:
                await conn.execute("""
                    INSERT INTO agent_clusters 
                    (cluster_id, cluster_name, agent_count, characteristics, 
                     performance_profile, risk_profile)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (cluster_id) DO UPDATE SET
                    cluster_name = EXCLUDED.cluster_name,
                    agent_count = EXCLUDED.agent_count,
                    characteristics = EXCLUDED.characteristics,
                    performance_profile = EXCLUDED.performance_profile,
                    risk_profile = EXCLUDED.risk_profile,
                    updated_at = CURRENT_TIMESTAMP
                """, 
                cluster.cluster_id, cluster.cluster_name, cluster.agent_count,
                json.dumps(cluster.characteristics), json.dumps(cluster.performance_profile),
                json.dumps(cluster.risk_profile)
                )
    
    async def _store_cluster_assignments(self, agent_ids: List[str], cluster_id: int):
        """Store cluster assignments"""
        async with db_pool.acquire() as conn:
            for agent_id in agent_ids:
                await conn.execute("""
                    INSERT INTO agent_cluster_assignments (agent_id, cluster_id, confidence)
                    VALUES ($1, $2, $3)
                """, agent_id, cluster_id, 0.85)
    
    async def _store_predictive_insight(self, insight: PredictiveInsight):
        """Store predictive insight"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO predictive_insights 
                (insight_id, agent_id, prediction_type, predicted_value, confidence,
                 time_horizon, factors, recommendations, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (insight_id) DO NOTHING
            """, 
            insight.insight_id, insight.agent_id, insight.prediction_type,
            insight.predicted_value, insight.confidence, insight.time_horizon,
            json.dumps(insight.factors), json.dumps(insight.recommendations),
            datetime.now() + timedelta(days=30)
            )
    
    async def _store_analytics_alert(self, alert: AnalyticsAlert):
        """Store analytics alert"""
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO analytics_alerts 
                (alert_id, agent_id, alert_type, severity, message, alert_data, resolved)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (alert_id) DO NOTHING
            """, 
            alert.alert_id, alert.agent_id, alert.alert_type,
            alert.severity.value, alert.message, json.dumps(alert.data),
            alert.resolved
            )

# Initialize analytics engine
analytics_engine = KYAAnalyticsEngine()

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
            "service": "kya-analytics",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "ml_models": "loaded" if ml_models else "not_loaded"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/analyze-performance", response_model=AgentPerformanceMetrics)
async def analyze_agent_performance(request: AgentAnalyticsRequest):
    """Analyze agent performance"""
    return await analytics_engine.analyze_agent_performance(request.agent_id, request.date_range)

@app.post("/api/v1/detect-patterns")
async def detect_behavioral_patterns(agent_id: str, lookback_days: int = 30):
    """Detect behavioral patterns"""
    patterns = await analytics_engine.detect_behavioral_patterns(agent_id, lookback_days)
    return {"agent_id": agent_id, "patterns": [pattern.dict() for pattern in patterns]}

@app.post("/api/v1/cluster-agents")
async def perform_agent_clustering():
    """Perform agent clustering analysis"""
    clusters = await analytics_engine.perform_agent_clustering()
    return {"clusters": [cluster.dict() for cluster in clusters]}

@app.get("/api/v1/insights/{agent_id}")
async def get_predictive_insights(agent_id: str):
    """Get predictive insights for agent"""
    insights = await analytics_engine.generate_predictive_insights(agent_id)
    return {"agent_id": agent_id, "insights": [insight.dict() for insight in insights]}

@app.get("/api/v1/alerts/{agent_id}")
async def get_analytics_alerts(agent_id: str):
    """Get analytics alerts for agent"""
    alerts = await analytics_engine.generate_analytics_alerts(agent_id)
    return {"agent_id": agent_id, "alerts": [alert.dict() for alert in alerts]}

@app.get("/api/v1/dashboard")
async def get_dashboard_data(agent_id: Optional[str] = None):
    """Get analytics dashboard data"""
    return await analytics_engine.generate_analytics_dashboard_data(agent_id)

@app.get("/api/v1/performance-metrics/{agent_id}")
async def get_performance_metrics(agent_id: str, days: int = 30):
    """Get agent performance metrics"""
    try:
        async with db_pool.acquire() as conn:
            metrics = await conn.fetch("""
                SELECT * FROM agent_performance_metrics 
                WHERE agent_id = $1 AND period_start >= $2
                ORDER BY period_start DESC
            """, agent_id, datetime.now().date() - timedelta(days=days))
            
            return [
                {
                    "period_start": row['period_start'].isoformat(),
                    "period_end": row['period_end'].isoformat(),
                    "transaction_volume": row['transaction_volume'],
                    "success_rate": float(row['success_rate']),
                    "customer_satisfaction": float(row['customer_satisfaction']),
                    "performance_category": row['performance_category']
                }
                for row in metrics
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

