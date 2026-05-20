#!/usr/bin/env python3
"""
Machine Learning Risk Assessment Service for Remittance Platform
Advanced risk assessment using multiple ML models and real-time scoring
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
import uuid

import psycopg2
import redis
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, classification_report
import joblib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

class MLRiskAssessmentService:
    def __init__(self):
        self.db_connection = None
        self.redis_client = None
        self.credit_risk_model = None
        self.operational_risk_model = None
        self.market_risk_model = None
        self.liquidity_risk_model = None
        self.scaler = None
        self.label_encoders = {}
        self.risk_factors = {}
        self.initialize_connections()
        self.initialize_ml_models()
        self.initialize_database()
        self.load_risk_factors()
    
    def initialize_connections(self):
        """Initialize database and Redis connections"""
        try:
            # PostgreSQL connection
            self.db_connection = psycopg2.connect(
                host=os.getenv('DB_HOST', 'localhost'),
                port=os.getenv('DB_PORT', '5432'),
                user=os.getenv('DB_USER', 'postgres'),
                password=os.getenv('DB_PASSWORD', 'password'),
                database=os.getenv('DB_NAME', 'remittance')
            )
            
            # Redis connection
            self.redis_client = redis.Redis(
                host=os.getenv('REDIS_HOST', 'localhost'),
                port=int(os.getenv('REDIS_PORT', '6379')),
                db=0,
                decode_responses=True
            )
            
            logger.info("Database and Redis connections initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize connections: {e}")
            raise
    
    def initialize_ml_models(self):
        """Initialize machine learning models for risk assessment"""
        try:
            # Credit Risk Model - Random Forest Regressor
            self.credit_risk_model = RandomForestRegressor(
                n_estimators=100,
                max_depth=10,
                random_state=42,
                n_jobs=-1
            )
            
            # Operational Risk Model - Gradient Boosting
            self.operational_risk_model = GradientBoostingRegressor(
                n_estimators=100,
                learning_rate=0.1,
                max_depth=6,
                random_state=42
            )
            
            # Market Risk Model - Random Forest
            self.market_risk_model = RandomForestRegressor(
                n_estimators=80,
                max_depth=8,
                random_state=42,
                n_jobs=-1
            )
            
            # Liquidity Risk Model - Logistic Regression for classification
            self.liquidity_risk_model = LogisticRegression(
                random_state=42,
                max_iter=1000
            )
            
            # Feature scaler
            self.scaler = StandardScaler()
            
            # Train models with synthetic data
            self.train_models_with_synthetic_data()
            
            logger.info("ML models initialized and trained successfully")
        except Exception as e:
            logger.error(f"Failed to initialize ML models: {e}")
            raise
    
    def train_models_with_synthetic_data(self):
        """Train models with synthetic risk data"""
        try:
            np.random.seed(42)
            n_samples = 5000
            
            # Generate synthetic features
            # Features: transaction_volume, agent_experience, customer_count, 
            # geographic_diversity, technology_adoption, compliance_score,
            # financial_stability, market_volatility
            X = np.random.rand(n_samples, 8)
            
            # Make features more realistic
            X[:, 0] = np.random.lognormal(10, 2, n_samples)  # transaction_volume
            X[:, 1] = np.random.gamma(2, 2, n_samples)       # agent_experience (years)
            X[:, 2] = np.random.poisson(100, n_samples)      # customer_count
            X[:, 3] = np.random.beta(2, 3, n_samples) * 10   # geographic_diversity
            X[:, 4] = np.random.beta(3, 2, n_samples) * 100  # technology_adoption
            X[:, 5] = np.random.beta(4, 2, n_samples) * 100  # compliance_score
            X[:, 6] = np.random.beta(3, 2, n_samples) * 100  # financial_stability
            X[:, 7] = np.random.beta(2, 3, n_samples) * 100  # market_volatility
            
            # Scale features
            X_scaled = self.scaler.fit_transform(X)
            
            # Generate target variables for different risk types
            
            # Credit Risk Score (0-100, higher is riskier)
            credit_risk = (
                X[:, 0] * 0.001 +  # Higher volume = lower risk
                (10 - X[:, 1]) * 5 +  # Less experience = higher risk
                (100 - X[:, 5]) * 0.3 +  # Lower compliance = higher risk
                (100 - X[:, 6]) * 0.4 +  # Lower stability = higher risk
                np.random.normal(0, 5, n_samples)  # noise
            )
            credit_risk = np.clip(credit_risk, 0, 100)
            
            # Operational Risk Score
            operational_risk = (
                (10 - X[:, 1]) * 4 +  # Less experience = higher risk
                (100 - X[:, 4]) * 0.3 +  # Lower tech adoption = higher risk
                (100 - X[:, 5]) * 0.5 +  # Lower compliance = higher risk
                X[:, 7] * 0.2 +  # Higher volatility = higher risk
                np.random.normal(0, 8, n_samples)  # noise
            )
            operational_risk = np.clip(operational_risk, 0, 100)
            
            # Market Risk Score
            market_risk = (
                X[:, 7] * 0.6 +  # Market volatility
                (10 - X[:, 3]) * 3 +  # Lower diversity = higher risk
                X[:, 0] * 0.0001 +  # Volume effect
                np.random.normal(0, 10, n_samples)  # noise
            )
            market_risk = np.clip(market_risk, 0, 100)
            
            # Liquidity Risk (binary: 0 = low risk, 1 = high risk)
            liquidity_risk_prob = (
                (100 - X[:, 6]) * 0.01 +  # Lower stability = higher risk
                X[:, 0] * -0.00001 +  # Higher volume = lower risk
                X[:, 2] * -0.001  # More customers = lower risk
            )
            liquidity_risk = (liquidity_risk_prob + np.random.normal(0, 0.1, n_samples)) > 0.3
            
            # Split data
            X_train, X_test, cr_train, cr_test = train_test_split(
                X_scaled, credit_risk, test_size=0.2, random_state=42
            )
            _, _, or_train, or_test = train_test_split(
                X_scaled, operational_risk, test_size=0.2, random_state=42
            )
            _, _, mr_train, mr_test = train_test_split(
                X_scaled, market_risk, test_size=0.2, random_state=42
            )
            _, _, lr_train, lr_test = train_test_split(
                X_scaled, liquidity_risk, test_size=0.2, random_state=42
            )
            
            # Train models
            self.credit_risk_model.fit(X_train, cr_train)
            self.operational_risk_model.fit(X_train, or_train)
            self.market_risk_model.fit(X_train, mr_train)
            self.liquidity_risk_model.fit(X_train, lr_train)
            
            # Evaluate models
            cr_pred = self.credit_risk_model.predict(X_test)
            or_pred = self.operational_risk_model.predict(X_test)
            mr_pred = self.market_risk_model.predict(X_test)
            
            logger.info(f"Credit Risk RMSE: {np.sqrt(mean_squared_error(cr_test, cr_pred)):.2f}")
            logger.info(f"Operational Risk RMSE: {np.sqrt(mean_squared_error(or_test, or_pred)):.2f}")
            logger.info(f"Market Risk RMSE: {np.sqrt(mean_squared_error(mr_test, mr_pred)):.2f}")
            
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise
    
    def initialize_database(self):
        """Initialize database tables"""
        try:
            cursor = self.db_connection.cursor()
            
            # Risk assessments table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS risk_assessments (
                    id SERIAL PRIMARY KEY,
                    assessment_id VARCHAR(50) UNIQUE NOT NULL,
                    entity_type VARCHAR(50) NOT NULL,
                    entity_id VARCHAR(50) NOT NULL,
                    assessment_type VARCHAR(50) NOT NULL,
                    credit_risk_score DECIMAL(5,2),
                    operational_risk_score DECIMAL(5,2),
                    market_risk_score DECIMAL(5,2),
                    liquidity_risk_level VARCHAR(20),
                    overall_risk_score DECIMAL(5,2) NOT NULL,
                    risk_level VARCHAR(20) NOT NULL,
                    risk_factors JSONB,
                    recommendations JSONB,
                    assessed_by VARCHAR(50) NOT NULL,
                    valid_until TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Risk factors table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS risk_factors (
                    id SERIAL PRIMARY KEY,
                    factor_name VARCHAR(100) NOT NULL,
                    factor_type VARCHAR(50) NOT NULL,
                    weight DECIMAL(5,4) NOT NULL,
                    description TEXT,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Risk monitoring table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS risk_monitoring (
                    id SERIAL PRIMARY KEY,
                    entity_type VARCHAR(50) NOT NULL,
                    entity_id VARCHAR(50) NOT NULL,
                    risk_metric VARCHAR(50) NOT NULL,
                    metric_value DECIMAL(10,4) NOT NULL,
                    threshold_value DECIMAL(10,4),
                    status VARCHAR(20) NOT NULL,
                    alert_level VARCHAR(20),
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Risk models table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS risk_models (
                    id SERIAL PRIMARY KEY,
                    model_name VARCHAR(100) NOT NULL,
                    model_type VARCHAR(50) NOT NULL,
                    version VARCHAR(20) NOT NULL,
                    accuracy_score DECIMAL(5,4),
                    last_trained TIMESTAMP,
                    is_active BOOLEAN DEFAULT true,
                    model_parameters JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Risk scenarios table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS risk_scenarios (
                    id SERIAL PRIMARY KEY,
                    scenario_name VARCHAR(100) NOT NULL,
                    scenario_type VARCHAR(50) NOT NULL,
                    description TEXT,
                    probability DECIMAL(5,4) NOT NULL,
                    impact_score DECIMAL(5,2) NOT NULL,
                    mitigation_strategies JSONB,
                    is_active BOOLEAN DEFAULT true,
                    created_by VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            self.db_connection.commit()
            cursor.close()
            
            # Insert default risk factors and scenarios
            self.insert_default_risk_factors()
            self.insert_default_risk_scenarios()
            
            logger.info("Database tables initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            self.db_connection.rollback()
            raise
    
    def insert_default_risk_factors(self):
        """Insert default risk factors"""
        try:
            cursor = self.db_connection.cursor()
            
            default_factors = [
                {
                    'factor_name': 'Transaction Volume',
                    'factor_type': 'credit',
                    'weight': 0.25,
                    'description': 'Total transaction volume processed by entity'
                },
                {
                    'factor_name': 'Agent Experience',
                    'factor_type': 'operational',
                    'weight': 0.20,
                    'description': 'Years of experience in banking operations'
                },
                {
                    'factor_name': 'Customer Base Size',
                    'factor_type': 'credit',
                    'weight': 0.15,
                    'description': 'Number of active customers served'
                },
                {
                    'factor_name': 'Geographic Diversity',
                    'factor_type': 'market',
                    'weight': 0.10,
                    'description': 'Spread across different geographic locations'
                },
                {
                    'factor_name': 'Technology Adoption',
                    'factor_type': 'operational',
                    'weight': 0.15,
                    'description': 'Level of technology integration and adoption'
                },
                {
                    'factor_name': 'Compliance Score',
                    'factor_type': 'operational',
                    'weight': 0.30,
                    'description': 'Regulatory compliance and audit scores'
                },
                {
                    'factor_name': 'Financial Stability',
                    'factor_type': 'liquidity',
                    'weight': 0.35,
                    'description': 'Financial health and stability indicators'
                },
                {
                    'factor_name': 'Market Volatility',
                    'factor_type': 'market',
                    'weight': 0.25,
                    'description': 'Market conditions and volatility exposure'
                }
            ]
            
            for factor in default_factors:
                cursor.execute("""
                    INSERT INTO risk_factors (factor_name, factor_type, weight, description)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (factor['factor_name'], factor['factor_type'], 
                      factor['weight'], factor['description']))
            
            self.db_connection.commit()
            cursor.close()
            
            logger.info("Default risk factors inserted successfully")
        except Exception as e:
            logger.error(f"Failed to insert default risk factors: {e}")
            self.db_connection.rollback()
    
    def insert_default_risk_scenarios(self):
        """Insert default risk scenarios"""
        try:
            cursor = self.db_connection.cursor()
            
            default_scenarios = [
                {
                    'scenario_name': 'Economic Recession',
                    'scenario_type': 'market',
                    'description': 'Economic downturn affecting transaction volumes',
                    'probability': 0.15,
                    'impact_score': 75.0,
                    'mitigation_strategies': {
                        'strategies': [
                            'Diversify service offerings',
                            'Strengthen cash reserves',
                            'Enhance customer retention programs'
                        ]
                    }
                },
                {
                    'scenario_name': 'Regulatory Changes',
                    'scenario_type': 'operational',
                    'description': 'New banking regulations affecting operations',
                    'probability': 0.25,
                    'impact_score': 60.0,
                    'mitigation_strategies': {
                        'strategies': [
                            'Regular compliance monitoring',
                            'Staff training programs',
                            'Legal consultation services'
                        ]
                    }
                },
                {
                    'scenario_name': 'Technology Disruption',
                    'scenario_type': 'operational',
                    'description': 'Major technology changes or system failures',
                    'probability': 0.20,
                    'impact_score': 65.0,
                    'mitigation_strategies': {
                        'strategies': [
                            'Regular system updates',
                            'Backup systems implementation',
                            'Staff technical training'
                        ]
                    }
                },
                {
                    'scenario_name': 'Liquidity Crisis',
                    'scenario_type': 'liquidity',
                    'description': 'Shortage of liquid funds for operations',
                    'probability': 0.10,
                    'impact_score': 85.0,
                    'mitigation_strategies': {
                        'strategies': [
                            'Maintain adequate cash reserves',
                            'Establish credit facilities',
                            'Monitor cash flow closely'
                        ]
                    }
                }
            ]
            
            for scenario in default_scenarios:
                cursor.execute("""
                    INSERT INTO risk_scenarios (scenario_name, scenario_type, description, 
                                              probability, impact_score, mitigation_strategies, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (scenario['scenario_name'], scenario['scenario_type'], scenario['description'],
                      scenario['probability'], scenario['impact_score'], 
                      json.dumps(scenario['mitigation_strategies']), 'system'))
            
            self.db_connection.commit()
            cursor.close()
            
            logger.info("Default risk scenarios inserted successfully")
        except Exception as e:
            logger.error(f"Failed to insert default risk scenarios: {e}")
            self.db_connection.rollback()
    
    def load_risk_factors(self):
        """Load risk factors from database"""
        try:
            cursor = self.db_connection.cursor()
            cursor.execute("""
                SELECT factor_name, factor_type, weight, description
                FROM risk_factors WHERE is_active = true
            """)
            
            self.risk_factors = {}
            for row in cursor.fetchall():
                factor_type = row[1]
                if factor_type not in self.risk_factors:
                    self.risk_factors[factor_type] = []
                
                self.risk_factors[factor_type].append({
                    'name': row[0],
                    'weight': float(row[2]),
                    'description': row[3]
                })
            
            cursor.close()
            logger.info(f"Loaded risk factors for {len(self.risk_factors)} categories")
        except Exception as e:
            logger.error(f"Failed to load risk factors: {e}")
    
    def extract_features(self, entity_data: Dict) -> np.ndarray:
        """Extract features from entity data for ML models"""
        try:
            features = [
                float(entity_data.get('transaction_volume', 0)),
                float(entity_data.get('agent_experience', 1)),
                float(entity_data.get('customer_count', 0)),
                float(entity_data.get('geographic_diversity', 1)),
                float(entity_data.get('technology_adoption', 50)),
                float(entity_data.get('compliance_score', 80)),
                float(entity_data.get('financial_stability', 70)),
                float(entity_data.get('market_volatility', 30))
            ]
            
            return np.array(features).reshape(1, -1)
        except Exception as e:
            logger.error(f"Failed to extract features: {e}")
            return np.zeros((1, 8))
    
    def assess_comprehensive_risk(self, entity_data: Dict) -> Dict:
        """Perform comprehensive risk assessment"""
        try:
            start_time = time.time()
            
            # Extract features
            features = self.extract_features(entity_data)
            scaled_features = self.scaler.transform(features)
            
            # Get individual risk scores
            credit_risk = float(self.credit_risk_model.predict(scaled_features)[0])
            operational_risk = float(self.operational_risk_model.predict(scaled_features)[0])
            market_risk = float(self.market_risk_model.predict(scaled_features)[0])
            
            # Get liquidity risk classification
            liquidity_risk_prob = self.liquidity_risk_model.predict_proba(scaled_features)[0][1]
            liquidity_risk_level = 'high' if liquidity_risk_prob > 0.5 else 'low'
            
            # Ensure scores are within bounds
            credit_risk = max(0, min(100, credit_risk))
            operational_risk = max(0, min(100, operational_risk))
            market_risk = max(0, min(100, market_risk))
            
            # Calculate overall risk score (weighted average)
            overall_risk = (
                credit_risk * 0.35 +
                operational_risk * 0.30 +
                market_risk * 0.25 +
                (liquidity_risk_prob * 100) * 0.10
            )
            
            # Determine risk level
            if overall_risk >= 80:
                risk_level = 'critical'
            elif overall_risk >= 60:
                risk_level = 'high'
            elif overall_risk >= 40:
                risk_level = 'medium'
            else:
                risk_level = 'low'
            
            # Generate recommendations
            recommendations = self.generate_recommendations(
                credit_risk, operational_risk, market_risk, liquidity_risk_level
            )
            
            # Identify key risk factors
            risk_factors = self.identify_key_risk_factors(entity_data, {
                'credit': credit_risk,
                'operational': operational_risk,
                'market': market_risk,
                'liquidity': liquidity_risk_prob * 100
            })
            
            processing_time = (time.time() - start_time) * 1000  # ms
            
            result = {
                'entity_id': entity_data.get('entity_id'),
                'entity_type': entity_data.get('entity_type', 'agent'),
                'assessment_type': 'comprehensive',
                'credit_risk_score': round(credit_risk, 2),
                'operational_risk_score': round(operational_risk, 2),
                'market_risk_score': round(market_risk, 2),
                'liquidity_risk_level': liquidity_risk_level,
                'liquidity_risk_probability': round(liquidity_risk_prob * 100, 2),
                'overall_risk_score': round(overall_risk, 2),
                'risk_level': risk_level,
                'risk_factors': risk_factors,
                'recommendations': recommendations,
                'processing_time_ms': round(processing_time, 2),
                'assessed_at': datetime.now().isoformat(),
                'valid_until': (datetime.now() + timedelta(days=30)).isoformat()
            }
            
            # Store assessment in database
            self.store_risk_assessment(result)
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to assess comprehensive risk: {e}")
            return {
                'entity_id': entity_data.get('entity_id'),
                'error': str(e),
                'assessed_at': datetime.now().isoformat()
            }
    
    def generate_recommendations(self, credit_risk: float, operational_risk: float, 
                               market_risk: float, liquidity_risk_level: str) -> List[Dict]:
        """Generate risk mitigation recommendations"""
        recommendations = []
        
        try:
            if credit_risk > 60:
                recommendations.append({
                    'category': 'credit',
                    'priority': 'high',
                    'recommendation': 'Implement stricter credit assessment procedures',
                    'description': 'Review and enhance customer creditworthiness evaluation'
                })
            
            if operational_risk > 60:
                recommendations.append({
                    'category': 'operational',
                    'priority': 'high',
                    'recommendation': 'Strengthen operational controls and procedures',
                    'description': 'Enhance staff training and system reliability'
                })
            
            if market_risk > 60:
                recommendations.append({
                    'category': 'market',
                    'priority': 'medium',
                    'recommendation': 'Diversify service offerings and geographic presence',
                    'description': 'Reduce dependency on single market segments'
                })
            
            if liquidity_risk_level == 'high':
                recommendations.append({
                    'category': 'liquidity',
                    'priority': 'critical',
                    'recommendation': 'Maintain higher cash reserves and establish credit facilities',
                    'description': 'Ensure adequate liquidity for operations'
                })
            
            # General recommendations
            if len(recommendations) == 0:
                recommendations.append({
                    'category': 'general',
                    'priority': 'low',
                    'recommendation': 'Continue monitoring risk indicators',
                    'description': 'Maintain current risk management practices'
                })
            
        except Exception as e:
            logger.error(f"Failed to generate recommendations: {e}")
        
        return recommendations
    
    def identify_key_risk_factors(self, entity_data: Dict, risk_scores: Dict) -> List[Dict]:
        """Identify key risk factors contributing to overall risk"""
        key_factors = []
        
        try:
            # Analyze each risk category
            for risk_type, score in risk_scores.items():
                if score > 50:  # Above average risk
                    if risk_type in self.risk_factors:
                        for factor in self.risk_factors[risk_type]:
                            # Check if this factor is problematic
                            factor_value = entity_data.get(factor['name'].lower().replace(' ', '_'), 50)
                            
                            if self.is_factor_problematic(factor['name'], factor_value):
                                key_factors.append({
                                    'factor_name': factor['name'],
                                    'factor_type': risk_type,
                                    'current_value': factor_value,
                                    'weight': factor['weight'],
                                    'impact': 'high' if score > 70 else 'medium',
                                    'description': factor['description']
                                })
            
        except Exception as e:
            logger.error(f"Failed to identify key risk factors: {e}")
        
        return key_factors
    
    def is_factor_problematic(self, factor_name: str, value: float) -> bool:
        """Determine if a factor value is problematic"""
        # Define thresholds for different factors
        thresholds = {
            'Transaction Volume': {'min': 1000000, 'type': 'min'},  # Low volume is risky
            'Agent Experience': {'min': 2, 'type': 'min'},  # Less than 2 years is risky
            'Customer Base Size': {'min': 50, 'type': 'min'},  # Small customer base is risky
            'Geographic Diversity': {'min': 3, 'type': 'min'},  # Low diversity is risky
            'Technology Adoption': {'min': 60, 'type': 'min'},  # Low adoption is risky
            'Compliance Score': {'min': 70, 'type': 'min'},  # Low compliance is risky
            'Financial Stability': {'min': 60, 'type': 'min'},  # Low stability is risky
            'Market Volatility': {'max': 60, 'type': 'max'}  # High volatility is risky
        }
        
        if factor_name in thresholds:
            threshold = thresholds[factor_name]
            if threshold['type'] == 'min':
                return value < threshold['min']
            else:
                return value > threshold['max']
        
        return False
    
    def store_risk_assessment(self, assessment: Dict):
        """Store risk assessment in database"""
        try:
            cursor = self.db_connection.cursor()
            
            assessment_id = str(uuid.uuid4())
            
            cursor.execute("""
                INSERT INTO risk_assessments (
                    assessment_id, entity_type, entity_id, assessment_type,
                    credit_risk_score, operational_risk_score, market_risk_score,
                    liquidity_risk_level, overall_risk_score, risk_level,
                    risk_factors, recommendations, assessed_by, valid_until
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                assessment_id,
                assessment['entity_type'],
                assessment['entity_id'],
                assessment['assessment_type'],
                assessment['credit_risk_score'],
                assessment['operational_risk_score'],
                assessment['market_risk_score'],
                assessment['liquidity_risk_level'],
                assessment['overall_risk_score'],
                assessment['risk_level'],
                json.dumps(assessment['risk_factors']),
                json.dumps(assessment['recommendations']),
                'ml_risk_assessment_service',
                assessment['valid_until']
            ))
            
            self.db_connection.commit()
            cursor.close()
            
            # Cache assessment in Redis
            cache_key = f"risk_assessment:{assessment['entity_type']}:{assessment['entity_id']}"
            self.redis_client.setex(cache_key, 3600, json.dumps(assessment))
            
            logger.info(f"Risk assessment stored: {assessment_id}")
            
        except Exception as e:
            logger.error(f"Failed to store risk assessment: {e}")
            self.db_connection.rollback()

# Initialize service
risk_service = MLRiskAssessmentService()

# API Routes
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        cursor = risk_service.db_connection.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        
        # Test Redis connection
        risk_service.redis_client.ping()
        
        return jsonify({
            'status': 'healthy',
            'service': 'ml-risk-assessment-service',
            'timestamp': datetime.now().isoformat(),
            'database': 'connected',
            'redis': 'connected',
            'ml_models': {
                'credit_risk': 'loaded',
                'operational_risk': 'loaded',
                'market_risk': 'loaded',
                'liquidity_risk': 'loaded'
            },
            'risk_factors': len(risk_service.risk_factors)
        })
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 503

@app.route('/api/v1/risk/assess', methods=['POST'])
def assess_risk():
    """Perform comprehensive risk assessment"""
    try:
        entity_data = request.get_json()
        if not entity_data:
            return jsonify({'error': 'No entity data provided'}), 400
        
        result = risk_service.assess_comprehensive_risk(entity_data)
        
        return jsonify({
            'status': 'success',
            'data': result
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/risk/assessments', methods=['GET'])
def get_risk_assessments():
    """Get risk assessments"""
    try:
        entity_type = request.args.get('entity_type')
        entity_id = request.args.get('entity_id')
        risk_level = request.args.get('risk_level')
        limit = int(request.args.get('limit', 100))
        
        cursor = risk_service.db_connection.cursor()
        
        query = """
            SELECT assessment_id, entity_type, entity_id, assessment_type,
                   credit_risk_score, operational_risk_score, market_risk_score,
                   liquidity_risk_level, overall_risk_score, risk_level,
                   assessed_by, valid_until, created_at
            FROM risk_assessments WHERE 1=1
        """
        params = []
        
        if entity_type:
            query += " AND entity_type = %s"
            params.append(entity_type)
        
        if entity_id:
            query += " AND entity_id = %s"
            params.append(entity_id)
        
        if risk_level:
            query += " AND risk_level = %s"
            params.append(risk_level)
        
        query += " ORDER BY created_at DESC LIMIT %s"
        params.append(limit)
        
        cursor.execute(query, params)
        
        assessments = []
        for row in cursor.fetchall():
            assessments.append({
                'assessment_id': row[0],
                'entity_type': row[1],
                'entity_id': row[2],
                'assessment_type': row[3],
                'credit_risk_score': float(row[4]) if row[4] else None,
                'operational_risk_score': float(row[5]) if row[5] else None,
                'market_risk_score': float(row[6]) if row[6] else None,
                'liquidity_risk_level': row[7],
                'overall_risk_score': float(row[8]),
                'risk_level': row[9],
                'assessed_by': row[10],
                'valid_until': row[11].isoformat() if row[11] else None,
                'created_at': row[12].isoformat()
            })
        
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': assessments,
            'count': len(assessments)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/risk/factors', methods=['GET'])
def get_risk_factors():
    """Get risk factors"""
    try:
        cursor = risk_service.db_connection.cursor()
        cursor.execute("""
            SELECT factor_name, factor_type, weight, description, is_active, created_at
            FROM risk_factors
            ORDER BY factor_type, weight DESC
        """)
        
        factors = []
        for row in cursor.fetchall():
            factors.append({
                'factor_name': row[0],
                'factor_type': row[1],
                'weight': float(row[2]),
                'description': row[3],
                'is_active': row[4],
                'created_at': row[5].isoformat()
            })
        
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': factors,
            'count': len(factors)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/risk/scenarios', methods=['GET'])
def get_risk_scenarios():
    """Get risk scenarios"""
    try:
        cursor = risk_service.db_connection.cursor()
        cursor.execute("""
            SELECT scenario_name, scenario_type, description, probability,
                   impact_score, mitigation_strategies, is_active, created_at
            FROM risk_scenarios
            WHERE is_active = true
            ORDER BY impact_score DESC, probability DESC
        """)
        
        scenarios = []
        for row in cursor.fetchall():
            scenarios.append({
                'scenario_name': row[0],
                'scenario_type': row[1],
                'description': row[2],
                'probability': float(row[3]),
                'impact_score': float(row[4]),
                'mitigation_strategies': row[5],
                'is_active': row[6],
                'created_at': row[7].isoformat()
            })
        
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': scenarios,
            'count': len(scenarios)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/risk/dashboard', methods=['GET'])
def get_dashboard():
    """Get risk assessment dashboard summary"""
    try:
        cursor = risk_service.db_connection.cursor()
        
        # Get assessment summary
        cursor.execute("""
            SELECT COUNT(*),
                   SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN risk_level = 'medium' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN risk_level = 'low' THEN 1 ELSE 0 END),
                   AVG(overall_risk_score)
            FROM risk_assessments
            WHERE created_at >= NOW() - INTERVAL '30 days'
        """)
        
        assessment_stats = cursor.fetchone()
        
        # Get model summary
        cursor.execute("""
            SELECT COUNT(*), SUM(CASE WHEN is_active THEN 1 ELSE 0 END)
            FROM risk_models
        """)
        
        model_stats = cursor.fetchone()
        
        cursor.close()
        
        summary = {
            'assessments_30d': {
                'total': assessment_stats[0] if assessment_stats[0] else 0,
                'critical': assessment_stats[1] if assessment_stats[1] else 0,
                'high': assessment_stats[2] if assessment_stats[2] else 0,
                'medium': assessment_stats[3] if assessment_stats[3] else 0,
                'low': assessment_stats[4] if assessment_stats[4] else 0,
                'avg_risk_score': float(assessment_stats[5]) if assessment_stats[5] else 0
            },
            'models': {
                'total': model_stats[0] if model_stats[0] else 0,
                'active': model_stats[1] if model_stats[1] else 0
            },
            'risk_categories': {
                'credit': 'active',
                'operational': 'active',
                'market': 'active',
                'liquidity': 'active'
            },
            'generated_at': datetime.now().isoformat()
        }
        
        return jsonify({
            'status': 'success',
            'data': summary
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 8003))
    app.run(host='0.0.0.0', port=port, debug=False)

