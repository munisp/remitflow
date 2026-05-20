#!/usr/bin/env python3
"""
Advanced Fraud Detection Service
Sophisticated AI-powered fraud detection system for remittance network
with real-time analysis, behavioral modeling, network analysis, and adaptive learning
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union, Tuple
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

# ML and AI Libraries
from sklearn.ensemble import IsolationForest, RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.cluster import DBSCAN
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
import networkx as nx
from scipy import stats
import joblib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/remittance")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8140"))

# FastAPI app
app = FastAPI(
    title="Advanced Fraud Detection Service",
    description="AI-powered fraud detection with behavioral analysis and network modeling",
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
fraud_models = {}
behavioral_profiles = {}
transaction_network = None

# Enums
class FraudType(str, Enum):
    IDENTITY_THEFT = "IDENTITY_THEFT"
    ACCOUNT_TAKEOVER = "ACCOUNT_TAKEOVER"
    TRANSACTION_FRAUD = "TRANSACTION_FRAUD"
    SYNTHETIC_IDENTITY = "SYNTHETIC_IDENTITY"
    MONEY_LAUNDERING = "MONEY_LAUNDERING"
    CARD_FRAUD = "CARD_FRAUD"
    SOCIAL_ENGINEERING = "SOCIAL_ENGINEERING"
    INSIDER_FRAUD = "INSIDER_FRAUD"

class RiskLevel(str, Enum):
    VERY_LOW = "VERY_LOW"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"
    CRITICAL = "CRITICAL"

class AlertStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INVESTIGATING = "INVESTIGATING"
    CONFIRMED = "CONFIRMED"
    FALSE_POSITIVE = "FALSE_POSITIVE"
    RESOLVED = "RESOLVED"

class ModelType(str, Enum):
    ISOLATION_FOREST = "ISOLATION_FOREST"
    RANDOM_FOREST = "RANDOM_FOREST"
    NEURAL_NETWORK = "NEURAL_NETWORK"
    GRADIENT_BOOSTING = "GRADIENT_BOOSTING"
    ENSEMBLE = "ENSEMBLE"

# Pydantic models
class TransactionData(BaseModel):
    transaction_id: str
    account_id: str
    amount: float
    transaction_type: str
    timestamp: datetime
    location: Optional[Dict[str, Any]] = {}
    device_info: Optional[Dict[str, Any]] = {}
    merchant_info: Optional[Dict[str, Any]] = {}
    additional_data: Optional[Dict[str, Any]] = {}

class FraudAnalysisRequest(BaseModel):
    transaction: TransactionData
    include_behavioral: bool = True
    include_network: bool = True
    include_device: bool = True
    real_time: bool = True

class FraudAnalysisResponse(BaseModel):
    transaction_id: str
    fraud_score: float
    risk_level: RiskLevel
    fraud_types: List[Dict[str, Any]]
    behavioral_anomalies: List[Dict[str, Any]]
    network_anomalies: List[Dict[str, Any]]
    device_anomalies: List[Dict[str, Any]]
    recommendations: List[str]
    confidence: float
    processing_time: float

class FraudAlert(BaseModel):
    alert_id: str
    transaction_id: str
    account_id: str
    fraud_type: FraudType
    risk_level: RiskLevel
    fraud_score: float
    description: str
    evidence: List[Dict[str, Any]]
    status: AlertStatus
    created_at: datetime
    updated_at: Optional[datetime] = None

class BehavioralProfile(BaseModel):
    account_id: str
    profile_data: Dict[str, Any]
    last_updated: datetime
    transaction_count: int
    anomaly_score: float
    risk_factors: List[str]

class NetworkAnalysis(BaseModel):
    account_id: str
    connected_accounts: List[str]
    network_risk_score: float
    suspicious_patterns: List[Dict[str, Any]]
    community_detection: Dict[str, Any]

class ModelPerformance(BaseModel):
    model_type: ModelType
    accuracy: float
    precision: float
    recall: float
    f1_score: float
    false_positive_rate: float
    last_trained: datetime
    training_samples: int

# Database initialization
async def init_database():
    """Initialize database connection and tables"""
    global db_pool
    
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        
        async with db_pool.acquire() as conn:
            # Create fraud analysis table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS fraud_analysis (
                    id SERIAL PRIMARY KEY,
                    analysis_id VARCHAR(255) UNIQUE NOT NULL,
                    transaction_id VARCHAR(255) NOT NULL,
                    account_id VARCHAR(255) NOT NULL,
                    fraud_score DECIMAL(5,4) NOT NULL,
                    risk_level VARCHAR(20) NOT NULL,
                    fraud_types JSONB,
                    behavioral_anomalies JSONB,
                    network_anomalies JSONB,
                    device_anomalies JSONB,
                    recommendations JSONB,
                    confidence DECIMAL(5,4),
                    processing_time DECIMAL(8,4),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_analysis_id (analysis_id),
                    INDEX idx_transaction_id (transaction_id),
                    INDEX idx_account_id (account_id),
                    INDEX idx_fraud_score (fraud_score),
                    INDEX idx_risk_level (risk_level),
                    INDEX idx_created_at (created_at)
                )
            """)
            
            # Create fraud alerts table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS fraud_alerts (
                    id SERIAL PRIMARY KEY,
                    alert_id VARCHAR(255) UNIQUE NOT NULL,
                    transaction_id VARCHAR(255) NOT NULL,
                    account_id VARCHAR(255) NOT NULL,
                    fraud_type VARCHAR(50) NOT NULL,
                    risk_level VARCHAR(20) NOT NULL,
                    fraud_score DECIMAL(5,4) NOT NULL,
                    description TEXT,
                    evidence JSONB,
                    status VARCHAR(20) DEFAULT 'ACTIVE',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_alert_id (alert_id),
                    INDEX idx_transaction_id (transaction_id),
                    INDEX idx_account_id (account_id),
                    INDEX idx_fraud_type (fraud_type),
                    INDEX idx_status (status),
                    INDEX idx_created_at (created_at)
                )
            """)
            
            # Create behavioral profiles table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS behavioral_profiles (
                    id SERIAL PRIMARY KEY,
                    account_id VARCHAR(255) UNIQUE NOT NULL,
                    profile_data JSONB NOT NULL,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    transaction_count INTEGER DEFAULT 0,
                    anomaly_score DECIMAL(5,4) DEFAULT 0.0,
                    risk_factors JSONB,
                    INDEX idx_account_id (account_id),
                    INDEX idx_anomaly_score (anomaly_score),
                    INDEX idx_last_updated (last_updated)
                )
            """)
            
            # Create network relationships table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS network_relationships (
                    id SERIAL PRIMARY KEY,
                    source_account VARCHAR(255) NOT NULL,
                    target_account VARCHAR(255) NOT NULL,
                    relationship_type VARCHAR(50) NOT NULL,
                    strength DECIMAL(5,4) DEFAULT 0.5,
                    transaction_count INTEGER DEFAULT 0,
                    total_amount DECIMAL(15,2) DEFAULT 0.0,
                    first_interaction TIMESTAMP,
                    last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_source_account (source_account),
                    INDEX idx_target_account (target_account),
                    INDEX idx_relationship_type (relationship_type),
                    INDEX idx_strength (strength)
                )
            """)
            
            # Create model performance table
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS model_performance (
                    id SERIAL PRIMARY KEY,
                    model_type VARCHAR(50) NOT NULL,
                    accuracy DECIMAL(5,4),
                    precision_score DECIMAL(5,4),
                    recall_score DECIMAL(5,4),
                    f1_score DECIMAL(5,4),
                    false_positive_rate DECIMAL(5,4),
                    last_trained TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    training_samples INTEGER,
                    model_version VARCHAR(50),
                    INDEX idx_model_type (model_type),
                    INDEX idx_last_trained (last_trained)
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

async def init_fraud_models():
    """Initialize fraud detection models"""
    global fraud_models, transaction_network
    
    try:
        # Initialize models
        fraud_models['isolation_forest'] = IsolationForest(
            contamination=0.1, random_state=42, n_estimators=100
        )
        
        fraud_models['random_forest'] = RandomForestClassifier(
            n_estimators=200, random_state=42, class_weight='balanced'
        )
        
        fraud_models['neural_network'] = MLPClassifier(
            hidden_layer_sizes=(100, 50, 25), random_state=42, max_iter=500
        )
        
        fraud_models['gradient_boosting'] = GradientBoostingClassifier(
            n_estimators=150, random_state=42, learning_rate=0.1
        )
        
        fraud_models['scaler'] = StandardScaler()
        
        # Initialize transaction network
        transaction_network = nx.Graph()
        
        # Train models with synthetic data
        await train_fraud_models()
        
        logger.info("Fraud detection models initialized successfully")
        
    except Exception as e:
        logger.error(f"Fraud models initialization failed: {e}")

async def train_fraud_models():
    """Train fraud detection models with synthetic data"""
    try:
        # Generate synthetic training data
        n_samples = 10000
        n_fraud = int(n_samples * 0.05)  # 5% fraud rate
        
        np.random.seed(42)
        
        # Generate features
        X = np.random.rand(n_samples, 15)
        
        # Feature engineering for realistic banking data
        X[:, 0] = np.random.lognormal(8, 1.5, n_samples)  # transaction_amount
        X[:, 1] = np.random.randint(0, 24, n_samples)  # hour_of_day
        X[:, 2] = np.random.randint(0, 7, n_samples)  # day_of_week
        X[:, 3] = np.random.uniform(0, 1, n_samples)  # velocity_score
        X[:, 4] = np.random.uniform(0, 1, n_samples)  # location_risk
        X[:, 5] = np.random.uniform(0, 1, n_samples)  # device_risk
        X[:, 6] = np.random.uniform(0, 1, n_samples)  # behavioral_score
        X[:, 7] = np.random.randint(1, 3650, n_samples)  # account_age_days
        X[:, 8] = np.random.uniform(0, 1, n_samples)  # merchant_risk
        X[:, 9] = np.random.uniform(0, 1, n_samples)  # network_risk
        X[:, 10] = np.random.randint(0, 100, n_samples)  # transaction_count_day
        X[:, 11] = np.random.uniform(0, 1, n_samples)  # amount_deviation
        X[:, 12] = np.random.uniform(0, 1, n_samples)  # time_deviation
        X[:, 13] = np.random.uniform(0, 1, n_samples)  # location_deviation
        X[:, 14] = np.random.uniform(0, 1, n_samples)  # pattern_anomaly
        
        # Generate labels (fraud/legitimate)
        y = np.zeros(n_samples)
        
        # Create fraud patterns
        fraud_indices = np.random.choice(n_samples, n_fraud, replace=False)
        y[fraud_indices] = 1
        
        # Make fraud samples more anomalous
        X[fraud_indices, 3] += np.random.uniform(0.3, 0.7, n_fraud)  # Higher velocity
        X[fraud_indices, 4] += np.random.uniform(0.2, 0.5, n_fraud)  # Higher location risk
        X[fraud_indices, 5] += np.random.uniform(0.2, 0.5, n_fraud)  # Higher device risk
        X[fraud_indices, 11] += np.random.uniform(0.3, 0.6, n_fraud)  # Higher amount deviation
        X[fraud_indices, 14] += np.random.uniform(0.4, 0.8, n_fraud)  # Higher pattern anomaly
        
        # Clip values to [0, 1] range where applicable
        for i in [3, 4, 5, 6, 8, 9, 11, 12, 13, 14]:
            X[:, i] = np.clip(X[:, i], 0, 1)
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Scale features
        X_train_scaled = fraud_models['scaler'].fit_transform(X_train)
        X_test_scaled = fraud_models['scaler'].transform(X_test)
        
        # Train models
        fraud_models['isolation_forest'].fit(X_train_scaled)
        fraud_models['random_forest'].fit(X_train_scaled, y_train)
        fraud_models['neural_network'].fit(X_train_scaled, y_train)
        fraud_models['gradient_boosting'].fit(X_train_scaled, y_train)
        
        # Evaluate models
        await evaluate_models(X_test_scaled, y_test)
        
        logger.info(f"Fraud models trained with {n_samples} samples ({n_fraud} fraud cases)")
        
    except Exception as e:
        logger.error(f"Model training failed: {e}")

async def evaluate_models(X_test, y_test):
    """Evaluate model performance"""
    try:
        models_to_evaluate = ['random_forest', 'neural_network', 'gradient_boosting']
        
        for model_name in models_to_evaluate:
            model = fraud_models[model_name]
            y_pred = model.predict(X_test)
            
            # Calculate metrics
            from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
            
            accuracy = accuracy_score(y_test, y_pred)
            precision = precision_score(y_test, y_pred, zero_division=0)
            recall = recall_score(y_test, y_pred, zero_division=0)
            f1 = f1_score(y_test, y_pred, zero_division=0)
            
            # Calculate false positive rate
            tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
            fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
            
            # Store performance metrics
            await store_model_performance(
                ModelType(model_name.upper()), accuracy, precision, recall, f1, fpr, len(X_test)
            )
            
            logger.info(f"{model_name} - Accuracy: {accuracy:.4f}, Precision: {precision:.4f}, "
                       f"Recall: {recall:.4f}, F1: {f1:.4f}, FPR: {fpr:.4f}")
        
    except Exception as e:
        logger.error(f"Model evaluation failed: {e}")

async def store_model_performance(model_type: ModelType, accuracy: float, precision: float,
                                recall: float, f1: float, fpr: float, training_samples: int):
    """Store model performance metrics"""
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO model_performance 
                (model_type, accuracy, precision_score, recall_score, f1_score, 
                 false_positive_rate, training_samples, model_version)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, 
            model_type.value, accuracy, precision, recall, f1, fpr, training_samples, "1.0"
            )
            
    except Exception as e:
        logger.error(f"Failed to store model performance: {e}")

# Fraud detection engine
class FraudDetectionEngine:
    """Main fraud detection engine"""
    
    def __init__(self):
        self.feature_extractors = {
            'transaction': self._extract_transaction_features,
            'behavioral': self._extract_behavioral_features,
            'network': self._extract_network_features,
            'device': self._extract_device_features,
            'temporal': self._extract_temporal_features
        }
    
    async def analyze_transaction(self, request: FraudAnalysisRequest) -> FraudAnalysisResponse:
        """Comprehensive fraud analysis"""
        try:
            start_time = datetime.now()
            
            # Extract features
            features = await self._extract_all_features(request)
            
            # Get fraud predictions from multiple models
            fraud_scores = await self._get_fraud_predictions(features)
            
            # Calculate ensemble score
            ensemble_score = np.mean(list(fraud_scores.values()))
            
            # Determine risk level
            risk_level = self._calculate_risk_level(ensemble_score)
            
            # Identify fraud types
            fraud_types = await self._identify_fraud_types(features, fraud_scores)
            
            # Analyze anomalies
            behavioral_anomalies = []
            network_anomalies = []
            device_anomalies = []
            
            if request.include_behavioral:
                behavioral_anomalies = await self._analyze_behavioral_anomalies(request.transaction)
            
            if request.include_network:
                network_anomalies = await self._analyze_network_anomalies(request.transaction)
            
            if request.include_device:
                device_anomalies = await self._analyze_device_anomalies(request.transaction)
            
            # Generate recommendations
            recommendations = await self._generate_recommendations(
                ensemble_score, risk_level, fraud_types, behavioral_anomalies, 
                network_anomalies, device_anomalies
            )
            
            # Calculate confidence
            confidence = self._calculate_confidence(fraud_scores, features)
            
            processing_time = (datetime.now() - start_time).total_seconds()
            
            response = FraudAnalysisResponse(
                transaction_id=request.transaction.transaction_id,
                fraud_score=ensemble_score,
                risk_level=risk_level,
                fraud_types=fraud_types,
                behavioral_anomalies=behavioral_anomalies,
                network_anomalies=network_anomalies,
                device_anomalies=device_anomalies,
                recommendations=recommendations,
                confidence=confidence,
                processing_time=processing_time
            )
            
            # Store analysis
            await self._store_analysis(response, request.transaction.account_id)
            
            # Create alert if high risk
            if risk_level in [RiskLevel.HIGH, RiskLevel.VERY_HIGH, RiskLevel.CRITICAL]:
                await self._create_fraud_alert(request.transaction, response)
            
            # Update behavioral profile
            if request.include_behavioral:
                await self._update_behavioral_profile(request.transaction, features)
            
            return response
            
        except Exception as e:
            logger.error(f"Fraud analysis failed: {e}")
            raise HTTPException(status_code=500, detail=f"Fraud analysis failed: {str(e)}")
    
    async def _extract_all_features(self, request: FraudAnalysisRequest) -> np.ndarray:
        """Extract all features for fraud detection"""
        all_features = []
        
        # Transaction features
        tx_features = await self.feature_extractors['transaction'](request.transaction)
        all_features.extend(tx_features)
        
        # Behavioral features
        if request.include_behavioral:
            behavioral_features = await self.feature_extractors['behavioral'](request.transaction)
            all_features.extend(behavioral_features)
        else:
            all_features.extend([0.5] * 3)  # Default values
        
        # Network features
        if request.include_network:
            network_features = await self.feature_extractors['network'](request.transaction)
            all_features.extend(network_features)
        else:
            all_features.extend([0.5] * 2)  # Default values
        
        # Device features
        if request.include_device:
            device_features = await self.feature_extractors['device'](request.transaction)
            all_features.extend(device_features)
        else:
            all_features.extend([0.5] * 2)  # Default values
        
        # Temporal features
        temporal_features = await self.feature_extractors['temporal'](request.transaction)
        all_features.extend(temporal_features)
        
        return np.array(all_features[:15])  # Ensure 15 features
    
    async def _extract_transaction_features(self, transaction: TransactionData) -> List[float]:
        """Extract transaction-specific features"""
        features = []
        
        # Amount (log-transformed)
        features.append(np.log1p(transaction.amount))
        
        # Hour of day
        features.append(transaction.timestamp.hour)
        
        # Day of week
        features.append(transaction.timestamp.weekday())
        
        # Transaction velocity (transactions per hour)
        velocity = await self._calculate_velocity(transaction.account_id, transaction.timestamp)
        features.append(velocity)
        
        return features
    
    async def _extract_behavioral_features(self, transaction: TransactionData) -> List[float]:
        """Extract behavioral features"""
        features = []
        
        # Get behavioral profile
        profile = await self._get_behavioral_profile(transaction.account_id)
        
        if profile:
            # Amount deviation from normal
            avg_amount = profile.get('avg_amount', transaction.amount)
            amount_deviation = abs(transaction.amount - avg_amount) / max(avg_amount, 1)
            features.append(min(amount_deviation, 1.0))
            
            # Time deviation from normal
            normal_hours = profile.get('normal_hours', [transaction.timestamp.hour])
            time_deviation = 1.0 if transaction.timestamp.hour not in normal_hours else 0.0
            features.append(time_deviation)
            
            # Location deviation
            location_deviation = await self._calculate_location_deviation(transaction, profile)
            features.append(location_deviation)
        else:
            # New account - higher risk
            features.extend([0.7, 0.6, 0.5])
        
        return features
    
    async def _extract_network_features(self, transaction: TransactionData) -> List[float]:
        """Extract network-based features"""
        features = []
        
        # Network risk score
        network_risk = await self._calculate_network_risk(transaction.account_id)
        features.append(network_risk)
        
        # Community detection score
        community_score = await self._calculate_community_score(transaction.account_id)
        features.append(community_score)
        
        return features
    
    async def _extract_device_features(self, transaction: TransactionData) -> List[float]:
        """Extract device-based features"""
        features = []
        
        device_info = transaction.device_info or {}
        
        # Device risk score
        device_risk = await self._calculate_device_risk(device_info, transaction.account_id)
        features.append(device_risk)
        
        # New device indicator
        is_new_device = await self._is_new_device(device_info, transaction.account_id)
        features.append(1.0 if is_new_device else 0.0)
        
        return features
    
    async def _extract_temporal_features(self, transaction: TransactionData) -> List[float]:
        """Extract temporal features"""
        features = []
        
        # Transaction count in last 24 hours
        daily_count = await self._get_daily_transaction_count(
            transaction.account_id, transaction.timestamp
        )
        features.append(min(daily_count / 50.0, 1.0))  # Normalize to [0,1]
        
        # Amount deviation from recent transactions
        recent_avg = await self._get_recent_average_amount(
            transaction.account_id, transaction.timestamp
        )
        if recent_avg > 0:
            amount_deviation = abs(transaction.amount - recent_avg) / recent_avg
            features.append(min(amount_deviation, 1.0))
        else:
            features.append(0.5)
        
        # Time since last transaction
        time_since_last = await self._get_time_since_last_transaction(
            transaction.account_id, transaction.timestamp
        )
        features.append(min(time_since_last / 86400.0, 1.0))  # Normalize to days
        
        # Location change frequency
        location_changes = await self._get_location_change_frequency(
            transaction.account_id, transaction.timestamp
        )
        features.append(min(location_changes / 10.0, 1.0))
        
        return features
    
    async def _get_fraud_predictions(self, features: np.ndarray) -> Dict[str, float]:
        """Get predictions from all fraud models"""
        predictions = {}
        
        # Scale features
        features_scaled = fraud_models['scaler'].transform([features])
        
        # Isolation Forest (anomaly score)
        isolation_score = fraud_models['isolation_forest'].decision_function(features_scaled)[0]
        # Convert to probability (0-1 range)
        predictions['isolation_forest'] = max(0, min(1, (1 - isolation_score) / 2))
        
        # Random Forest
        rf_proba = fraud_models['random_forest'].predict_proba(features_scaled)[0]
        predictions['random_forest'] = rf_proba[1] if len(rf_proba) > 1 else 0.0
        
        # Neural Network
        nn_proba = fraud_models['neural_network'].predict_proba(features_scaled)[0]
        predictions['neural_network'] = nn_proba[1] if len(nn_proba) > 1 else 0.0
        
        # Gradient Boosting
        gb_proba = fraud_models['gradient_boosting'].predict_proba(features_scaled)[0]
        predictions['gradient_boosting'] = gb_proba[1] if len(gb_proba) > 1 else 0.0
        
        return predictions
    
    def _calculate_risk_level(self, fraud_score: float) -> RiskLevel:
        """Calculate risk level based on fraud score"""
        if fraud_score >= 0.9:
            return RiskLevel.CRITICAL
        elif fraud_score >= 0.7:
            return RiskLevel.VERY_HIGH
        elif fraud_score >= 0.5:
            return RiskLevel.HIGH
        elif fraud_score >= 0.3:
            return RiskLevel.MEDIUM
        elif fraud_score >= 0.1:
            return RiskLevel.LOW
        else:
            return RiskLevel.VERY_LOW
    
    async def _identify_fraud_types(self, features: np.ndarray, 
                                  fraud_scores: Dict[str, float]) -> List[Dict[str, Any]]:
        """Identify potential fraud types"""
        fraud_types = []
        
        # Analyze feature patterns to identify fraud types
        if features[3] > 0.8:  # High velocity
            fraud_types.append({
                'type': FraudType.ACCOUNT_TAKEOVER.value,
                'confidence': fraud_scores.get('random_forest', 0.5),
                'indicators': ['high_velocity', 'unusual_pattern']
            })
        
        if features[11] > 0.7:  # High amount deviation
            fraud_types.append({
                'type': FraudType.TRANSACTION_FRAUD.value,
                'confidence': fraud_scores.get('gradient_boosting', 0.5),
                'indicators': ['amount_anomaly', 'pattern_deviation']
            })
        
        if features[5] > 0.6:  # Device risk
            fraud_types.append({
                'type': FraudType.IDENTITY_THEFT.value,
                'confidence': fraud_scores.get('neural_network', 0.5),
                'indicators': ['device_anomaly', 'location_mismatch']
            })
        
        if features[9] > 0.7:  # Network risk
            fraud_types.append({
                'type': FraudType.MONEY_LAUNDERING.value,
                'confidence': fraud_scores.get('isolation_forest', 0.5),
                'indicators': ['network_anomaly', 'suspicious_connections']
            })
        
        return fraud_types
    
    # Helper methods for feature extraction
    async def _calculate_velocity(self, account_id: str, timestamp: datetime) -> float:
        """Calculate transaction velocity"""
        try:
            # Get transactions in last hour from Redis cache
            cache_key = f"velocity:{account_id}:{timestamp.strftime('%Y%m%d%H')}"
            count = await redis_client.get(cache_key)
            
            if count:
                return min(float(count) / 10.0, 1.0)  # Normalize
            else:
                return 0.1  # Default low velocity
                
        except Exception as e:
            logger.error(f"Velocity calculation failed: {e}")
            return 0.5
    
    async def _get_behavioral_profile(self, account_id: str) -> Optional[Dict[str, Any]]:
        """Get behavioral profile for account"""
        try:
            # Check cache first
            cache_key = f"profile:{account_id}"
            cached_profile = await redis_client.get(cache_key)
            
            if cached_profile:
                return json.loads(cached_profile)
            
            # Get from database
            async with db_pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT profile_data FROM behavioral_profiles WHERE account_id = $1
                """, account_id)
                
                if row:
                    profile = json.loads(row['profile_data'])
                    # Cache for 1 hour
                    await redis_client.setex(cache_key, 3600, json.dumps(profile))
                    return profile
            
            return None
            
        except Exception as e:
            logger.error(f"Failed to get behavioral profile: {e}")
            return None
    
    async def _calculate_location_deviation(self, transaction: TransactionData, 
                                          profile: Dict[str, Any]) -> float:
        """Calculate location deviation from normal"""
        try:
            location = transaction.location or {}
            normal_locations = profile.get('normal_locations', [])
            
            if not normal_locations or not location:
                return 0.5  # Default moderate risk
            
            # Simple distance calculation (in practice, use proper geolocation)
            current_lat = location.get('latitude', 0)
            current_lon = location.get('longitude', 0)
            
            min_distance = float('inf')
            for normal_loc in normal_locations:
                lat_diff = abs(current_lat - normal_loc.get('latitude', 0))
                lon_diff = abs(current_lon - normal_loc.get('longitude', 0))
                distance = np.sqrt(lat_diff**2 + lon_diff**2)
                min_distance = min(min_distance, distance)
            
            # Normalize distance to [0,1] range
            return min(min_distance / 10.0, 1.0)
            
        except Exception as e:
            logger.error(f"Location deviation calculation failed: {e}")
            return 0.5
    
    async def _calculate_network_risk(self, account_id: str) -> float:
        """Calculate network-based risk score"""
        try:
            # Simple network risk calculation
            # In practice, this would analyze the transaction network graph
            return np.random.uniform(0.1, 0.4)  # Default low-medium risk
            
        except Exception as e:
            logger.error(f"Network risk calculation failed: {e}")
            return 0.3
    
    async def _calculate_community_score(self, account_id: str) -> float:
        """Calculate community detection score"""
        try:
            # Simple community score
            return np.random.uniform(0.2, 0.6)
            
        except Exception as e:
            logger.error(f"Community score calculation failed: {e}")
            return 0.4
    
    async def _calculate_device_risk(self, device_info: Dict[str, Any], account_id: str) -> float:
        """Calculate device risk score"""
        try:
            risk_factors = 0
            
            # Check for suspicious device characteristics
            if device_info.get('is_emulator', False):
                risk_factors += 0.3
            
            if device_info.get('is_rooted', False):
                risk_factors += 0.2
            
            if device_info.get('vpn_detected', False):
                risk_factors += 0.2
            
            if device_info.get('proxy_detected', False):
                risk_factors += 0.2
            
            return min(risk_factors, 1.0)
            
        except Exception as e:
            logger.error(f"Device risk calculation failed: {e}")
            return 0.3
    
    async def _is_new_device(self, device_info: Dict[str, Any], account_id: str) -> bool:
        """Check if device is new for this account"""
        try:
            device_id = device_info.get('device_id', '')
            if not device_id:
                return True
            
            # Check Redis cache for known devices
            cache_key = f"devices:{account_id}"
            known_devices = await redis_client.smembers(cache_key)
            
            return device_id not in [d.decode() for d in known_devices]
            
        except Exception as e:
            logger.error(f"New device check failed: {e}")
            return False
    
    async def _get_daily_transaction_count(self, account_id: str, timestamp: datetime) -> int:
        """Get transaction count for the day"""
        try:
            cache_key = f"daily_count:{account_id}:{timestamp.strftime('%Y%m%d')}"
            count = await redis_client.get(cache_key)
            return int(count) if count else 0
            
        except Exception as e:
            logger.error(f"Daily count retrieval failed: {e}")
            return 0
    
    async def _get_recent_average_amount(self, account_id: str, timestamp: datetime) -> float:
        """Get recent average transaction amount"""
        try:
            # Simple implementation - in practice, calculate from recent transactions
            return 25000.0  # Default average
            
        except Exception as e:
            logger.error(f"Recent average calculation failed: {e}")
            return 25000.0
    
    async def _get_time_since_last_transaction(self, account_id: str, timestamp: datetime) -> float:
        """Get time since last transaction in seconds"""
        try:
            cache_key = f"last_tx:{account_id}"
            last_tx_time = await redis_client.get(cache_key)
            
            if last_tx_time:
                last_time = datetime.fromisoformat(last_tx_time.decode())
                return (timestamp - last_time).total_seconds()
            
            return 86400.0  # Default 1 day
            
        except Exception as e:
            logger.error(f"Time since last transaction failed: {e}")
            return 3600.0  # Default 1 hour
    
    async def _get_location_change_frequency(self, account_id: str, timestamp: datetime) -> int:
        """Get location change frequency"""
        try:
            # Simple implementation
            return np.random.randint(0, 5)
            
        except Exception as e:
            logger.error(f"Location change frequency failed: {e}")
            return 1
    
    async def _analyze_behavioral_anomalies(self, transaction: TransactionData) -> List[Dict[str, Any]]:
        """Analyze behavioral anomalies"""
        anomalies = []
        
        # Amount anomaly
        if transaction.amount > 100000:  # High amount
            anomalies.append({
                'type': 'amount_anomaly',
                'severity': 'high',
                'description': 'Transaction amount significantly higher than normal',
                'value': transaction.amount
            })
        
        # Time anomaly
        if transaction.timestamp.hour < 6 or transaction.timestamp.hour > 22:
            anomalies.append({
                'type': 'time_anomaly',
                'severity': 'medium',
                'description': 'Transaction outside normal business hours',
                'value': transaction.timestamp.hour
            })
        
        return anomalies
    
    async def _analyze_network_anomalies(self, transaction: TransactionData) -> List[Dict[str, Any]]:
        """Analyze network anomalies"""
        anomalies = []
        
        # Simple network anomaly detection
        network_risk = await self._calculate_network_risk(transaction.account_id)
        
        if network_risk > 0.7:
            anomalies.append({
                'type': 'network_anomaly',
                'severity': 'high',
                'description': 'Account connected to high-risk network',
                'value': network_risk
            })
        
        return anomalies
    
    async def _analyze_device_anomalies(self, transaction: TransactionData) -> List[Dict[str, Any]]:
        """Analyze device anomalies"""
        anomalies = []
        
        device_info = transaction.device_info or {}
        
        if device_info.get('is_emulator', False):
            anomalies.append({
                'type': 'device_anomaly',
                'severity': 'high',
                'description': 'Transaction from emulated device',
                'value': True
            })
        
        if device_info.get('vpn_detected', False):
            anomalies.append({
                'type': 'network_anomaly',
                'severity': 'medium',
                'description': 'VPN or proxy detected',
                'value': True
            })
        
        return anomalies
    
    async def _generate_recommendations(self, fraud_score: float, risk_level: RiskLevel,
                                      fraud_types: List[Dict[str, Any]],
                                      behavioral_anomalies: List[Dict[str, Any]],
                                      network_anomalies: List[Dict[str, Any]],
                                      device_anomalies: List[Dict[str, Any]]) -> List[str]:
        """Generate fraud prevention recommendations"""
        recommendations = []
        
        if risk_level in [RiskLevel.CRITICAL, RiskLevel.VERY_HIGH]:
            recommendations.extend([
                "Block transaction immediately",
                "Freeze account pending investigation",
                "Contact customer for verification",
                "Escalate to fraud investigation team"
            ])
        elif risk_level == RiskLevel.HIGH:
            recommendations.extend([
                "Require additional authentication",
                "Manual review required",
                "Contact customer for verification",
                "Monitor account closely"
            ])
        elif risk_level == RiskLevel.MEDIUM:
            recommendations.extend([
                "Apply enhanced monitoring",
                "Consider step-up authentication",
                "Review transaction pattern"
            ])
        else:
            recommendations.append("Process transaction normally")
        
        # Specific recommendations based on anomalies
        if behavioral_anomalies:
            recommendations.append("Review behavioral patterns")
        
        if network_anomalies:
            recommendations.append("Investigate network connections")
        
        if device_anomalies:
            recommendations.append("Verify device authenticity")
        
        return recommendations
    
    def _calculate_confidence(self, fraud_scores: Dict[str, float], features: np.ndarray) -> float:
        """Calculate confidence in fraud prediction"""
        # Calculate confidence based on model agreement
        scores = list(fraud_scores.values())
        
        if not scores:
            return 0.5
        
        # High confidence if models agree
        score_std = np.std(scores)
        confidence = 1.0 - min(score_std * 2, 1.0)
        
        return max(0.1, confidence)
    
    async def _store_analysis(self, response: FraudAnalysisResponse, account_id: str):
        """Store fraud analysis results"""
        try:
            analysis_id = f"fraud_{response.transaction_id}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO fraud_analysis 
                    (analysis_id, transaction_id, account_id, fraud_score, risk_level,
                     fraud_types, behavioral_anomalies, network_anomalies, device_anomalies,
                     recommendations, confidence, processing_time)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """, 
                analysis_id, response.transaction_id, account_id, response.fraud_score,
                response.risk_level.value, json.dumps(response.fraud_types),
                json.dumps(response.behavioral_anomalies), json.dumps(response.network_anomalies),
                json.dumps(response.device_anomalies), json.dumps(response.recommendations),
                response.confidence, response.processing_time
                )
                
        except Exception as e:
            logger.error(f"Analysis storage failed: {e}")
    
    async def _create_fraud_alert(self, transaction: TransactionData, response: FraudAnalysisResponse):
        """Create fraud alert for high-risk transactions"""
        try:
            alert_id = f"alert_{transaction.transaction_id}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
            
            # Determine primary fraud type
            primary_fraud_type = FraudType.TRANSACTION_FRAUD
            if response.fraud_types:
                primary_fraud_type = FraudType(response.fraud_types[0]['type'])
            
            # Create evidence
            evidence = []
            evidence.extend(response.behavioral_anomalies)
            evidence.extend(response.network_anomalies)
            evidence.extend(response.device_anomalies)
            
            description = f"High-risk transaction detected with fraud score {response.fraud_score:.3f}"
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO fraud_alerts 
                    (alert_id, transaction_id, account_id, fraud_type, risk_level,
                     fraud_score, description, evidence)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, 
                alert_id, transaction.transaction_id, transaction.account_id,
                primary_fraud_type.value, response.risk_level.value, response.fraud_score,
                description, json.dumps(evidence)
                )
            
            logger.info(f"Fraud alert created: {alert_id}")
            
        except Exception as e:
            logger.error(f"Alert creation failed: {e}")
    
    async def _update_behavioral_profile(self, transaction: TransactionData, features: np.ndarray):
        """Update behavioral profile with new transaction"""
        try:
            # Simple profile update - in practice, use more sophisticated learning
            profile_data = {
                'last_transaction': transaction.timestamp.isoformat(),
                'avg_amount': transaction.amount,
                'normal_hours': [transaction.timestamp.hour],
                'normal_locations': [transaction.location] if transaction.location else [],
                'transaction_count': 1
            }
            
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO behavioral_profiles 
                    (account_id, profile_data, transaction_count, anomaly_score)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (account_id) DO UPDATE SET
                    profile_data = EXCLUDED.profile_data,
                    last_updated = CURRENT_TIMESTAMP,
                    transaction_count = behavioral_profiles.transaction_count + 1
                """, 
                transaction.account_id, json.dumps(profile_data), 1, features[14]
                )
            
            # Update cache
            cache_key = f"profile:{transaction.account_id}"
            await redis_client.setex(cache_key, 3600, json.dumps(profile_data))
            
        except Exception as e:
            logger.error(f"Profile update failed: {e}")

# Initialize fraud detection engine
fraud_detection_engine = FraudDetectionEngine()

# API endpoints
@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    await init_database()
    await init_redis()
    await init_fraud_models()

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
            "service": "advanced-fraud-detection",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": "connected",
            "models_loaded": len(fraud_models),
            "network_nodes": transaction_network.number_of_nodes() if transaction_network else 0
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/api/v1/analyze", response_model=FraudAnalysisResponse)
async def analyze_fraud(request: FraudAnalysisRequest):
    """Analyze transaction for fraud"""
    return await fraud_detection_engine.analyze_transaction(request)

@app.get("/api/v1/alerts")
async def get_fraud_alerts(status: Optional[AlertStatus] = None, limit: int = 100):
    """Get fraud alerts"""
    try:
        async with db_pool.acquire() as conn:
            if status:
                alerts = await conn.fetch("""
                    SELECT * FROM fraud_alerts 
                    WHERE status = $1 
                    ORDER BY created_at DESC 
                    LIMIT $2
                """, status.value, limit)
            else:
                alerts = await conn.fetch("""
                    SELECT * FROM fraud_alerts 
                    ORDER BY created_at DESC 
                    LIMIT $1
                """, limit)
            
            return [
                {
                    "alert_id": alert['alert_id'],
                    "transaction_id": alert['transaction_id'],
                    "account_id": alert['account_id'],
                    "fraud_type": alert['fraud_type'],
                    "risk_level": alert['risk_level'],
                    "fraud_score": float(alert['fraud_score']),
                    "description": alert['description'],
                    "status": alert['status'],
                    "created_at": alert['created_at'].isoformat()
                }
                for alert in alerts
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get alerts: {str(e)}")

@app.get("/api/v1/profile/{account_id}")
async def get_behavioral_profile(account_id: str):
    """Get behavioral profile for account"""
    try:
        profile = await fraud_detection_engine._get_behavioral_profile(account_id)
        
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        return profile
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get profile: {str(e)}")

@app.get("/api/v1/models/performance")
async def get_model_performance():
    """Get model performance metrics"""
    try:
        async with db_pool.acquire() as conn:
            performance = await conn.fetch("""
                SELECT * FROM model_performance 
                ORDER BY last_trained DESC
            """)
            
            return [
                {
                    "model_type": perf['model_type'],
                    "accuracy": float(perf['accuracy']) if perf['accuracy'] else 0,
                    "precision": float(perf['precision_score']) if perf['precision_score'] else 0,
                    "recall": float(perf['recall_score']) if perf['recall_score'] else 0,
                    "f1_score": float(perf['f1_score']) if perf['f1_score'] else 0,
                    "false_positive_rate": float(perf['false_positive_rate']) if perf['false_positive_rate'] else 0,
                    "last_trained": perf['last_trained'].isoformat(),
                    "training_samples": perf['training_samples']
                }
                for perf in performance
            ]
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get performance: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=SERVICE_PORT,
        reload=False,
        log_level="info"
    )

