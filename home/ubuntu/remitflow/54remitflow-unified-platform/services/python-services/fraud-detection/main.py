#!/usr/bin/env python3
"""
Advanced Fraud Detection Service for Remittance Platform
Real-time fraud detection using machine learning and rule-based systems
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
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
import joblib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

class FraudDetectionService:
    def __init__(self):
        self.db_connection = None
        self.redis_client = None
        self.fraud_classifier = None
        self.anomaly_detector = None
        self.scaler = None
        self.label_encoders = {}
        self.fraud_rules = []
        self.initialize_connections()
        self.initialize_ml_models()
        self.initialize_database()
        self.load_fraud_rules()
    
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
        """Initialize machine learning models for fraud detection"""
        try:
            # Random Forest classifier for fraud detection
            self.fraud_classifier = RandomForestClassifier(
                n_estimators=100,
                max_depth=10,
                random_state=42,
                class_weight='balanced'
            )
            
            # Isolation Forest for anomaly detection
            self.anomaly_detector = IsolationForest(
                contamination=0.05,
                random_state=42,
                n_estimators=100
            )
            
            # Feature scaler
            self.scaler = StandardScaler()
            
            # Train models with synthetic data (in production, use historical data)
            self.train_models_with_synthetic_data()
            
            logger.info("ML models initialized and trained successfully")
        except Exception as e:
            logger.error(f"Failed to initialize ML models: {e}")
            raise
    
    def train_models_with_synthetic_data(self):
        """Train models with synthetic fraud data"""
        try:
            # Generate synthetic training data
            np.random.seed(42)
            n_samples = 10000
            
            # Features: amount, hour, day_of_week, agent_risk_score, customer_risk_score, 
            # transaction_frequency, location_risk, device_risk
            X = np.random.rand(n_samples, 8)
            
            # Simulate realistic patterns
            X[:, 0] = np.random.lognormal(3, 1, n_samples)  # amount (log-normal distribution)
            X[:, 1] = np.random.randint(0, 24, n_samples)   # hour
            X[:, 2] = np.random.randint(0, 7, n_samples)    # day_of_week
            X[:, 3] = np.random.beta(2, 5, n_samples) * 100  # agent_risk_score
            X[:, 4] = np.random.beta(2, 5, n_samples) * 100  # customer_risk_score
            X[:, 5] = np.random.poisson(5, n_samples)       # transaction_frequency
            X[:, 6] = np.random.beta(1, 9, n_samples) * 100  # location_risk
            X[:, 7] = np.random.beta(1, 9, n_samples) * 100  # device_risk
            
            # Generate labels (5% fraud)
            y = np.zeros(n_samples)
            fraud_indices = np.random.choice(n_samples, size=int(0.05 * n_samples), replace=False)
            y[fraud_indices] = 1
            
            # Make fraud cases more extreme
            X[fraud_indices, 0] *= 5  # Higher amounts
            X[fraud_indices, 1] = np.random.choice([0, 1, 2, 22, 23], len(fraud_indices))  # Unusual hours
            X[fraud_indices, 3] += 30  # Higher agent risk
            X[fraud_indices, 4] += 30  # Higher customer risk
            X[fraud_indices, 5] *= 3   # Higher frequency
            X[fraud_indices, 6] += 40  # Higher location risk
            X[fraud_indices, 7] += 40  # Higher device risk
            
            # Scale features
            X_scaled = self.scaler.fit_transform(X)
            
            # Train fraud classifier
            X_train, X_test, y_train, y_test = train_test_split(
                X_scaled, y, test_size=0.2, random_state=42, stratify=y
            )
            
            self.fraud_classifier.fit(X_train, y_train)
            
            # Train anomaly detector on normal transactions only
            normal_data = X_scaled[y == 0]
            self.anomaly_detector.fit(normal_data)
            
            # Evaluate models
            y_pred = self.fraud_classifier.predict(X_test)
            logger.info(f"Fraud classifier accuracy: {(y_pred == y_test).mean():.3f}")
            
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise
    
    def initialize_database(self):
        """Initialize database tables"""
        try:
            cursor = self.db_connection.cursor()
            
            # Fraud alerts table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS fraud_alerts (
                    id SERIAL PRIMARY KEY,
                    alert_id VARCHAR(50) UNIQUE NOT NULL,
                    transaction_id VARCHAR(50) NOT NULL,
                    agent_id VARCHAR(50) NOT NULL,
                    customer_id VARCHAR(50),
                    alert_type VARCHAR(50) NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    fraud_score DECIMAL(5,2) NOT NULL,
                    anomaly_score DECIMAL(5,2),
                    rule_triggered VARCHAR(100),
                    details JSONB NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'open',
                    investigated_by VARCHAR(50),
                    investigated_at TIMESTAMP,
                    resolution VARCHAR(20),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Fraud rules table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS fraud_rules (
                    id SERIAL PRIMARY KEY,
                    rule_name VARCHAR(100) NOT NULL,
                    rule_type VARCHAR(50) NOT NULL,
                    conditions JSONB NOT NULL,
                    action VARCHAR(50) NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    is_active BOOLEAN DEFAULT true,
                    created_by VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Agent risk profiles table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS agent_risk_profiles (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(50) UNIQUE NOT NULL,
                    risk_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
                    risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
                    total_transactions INTEGER DEFAULT 0,
                    fraud_incidents INTEGER DEFAULT 0,
                    last_fraud_date TIMESTAMP,
                    risk_factors JSONB,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Customer risk profiles table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS customer_risk_profiles (
                    id SERIAL PRIMARY KEY,
                    customer_id VARCHAR(50) UNIQUE NOT NULL,
                    risk_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
                    risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
                    total_transactions INTEGER DEFAULT 0,
                    fraud_incidents INTEGER DEFAULT 0,
                    last_fraud_date TIMESTAMP,
                    risk_factors JSONB,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Fraud investigation cases table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS fraud_investigations (
                    id SERIAL PRIMARY KEY,
                    case_id VARCHAR(50) UNIQUE NOT NULL,
                    alert_ids JSONB NOT NULL,
                    investigator_id VARCHAR(50) NOT NULL,
                    case_type VARCHAR(50) NOT NULL,
                    priority VARCHAR(20) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'open',
                    findings TEXT,
                    actions_taken TEXT,
                    resolution VARCHAR(20),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    closed_at TIMESTAMP
                )
            """)
            
            self.db_connection.commit()
            cursor.close()
            
            # Insert default fraud rules
            self.insert_default_fraud_rules()
            
            logger.info("Database tables initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            self.db_connection.rollback()
            raise
    
    def insert_default_fraud_rules(self):
        """Insert default fraud detection rules"""
        try:
            cursor = self.db_connection.cursor()
            
            default_rules = [
                {
                    'rule_name': 'High Amount Transaction',
                    'rule_type': 'threshold',
                    'conditions': {
                        'field': 'amount',
                        'operator': '>',
                        'value': 500000,
                        'description': 'Transaction amount exceeds 500,000'
                    },
                    'action': 'flag',
                    'severity': 'high',
                    'created_by': 'system'
                },
                {
                    'rule_name': 'Unusual Hour Transaction',
                    'rule_type': 'time_based',
                    'conditions': {
                        'field': 'hour',
                        'operator': 'in',
                        'value': [0, 1, 2, 3, 4, 5],
                        'description': 'Transaction during unusual hours (12AM-5AM)'
                    },
                    'action': 'review',
                    'severity': 'medium',
                    'created_by': 'system'
                },
                {
                    'rule_name': 'High Frequency Transactions',
                    'rule_type': 'frequency',
                    'conditions': {
                        'field': 'transaction_count',
                        'operator': '>',
                        'value': 20,
                        'timeframe': '1_hour',
                        'description': 'More than 20 transactions in 1 hour'
                    },
                    'action': 'block',
                    'severity': 'critical',
                    'created_by': 'system'
                },
                {
                    'rule_name': 'Multiple Failed Attempts',
                    'rule_type': 'pattern',
                    'conditions': {
                        'field': 'failed_attempts',
                        'operator': '>=',
                        'value': 5,
                        'timeframe': '10_minutes',
                        'description': '5 or more failed attempts in 10 minutes'
                    },
                    'action': 'block',
                    'severity': 'high',
                    'created_by': 'system'
                },
                {
                    'rule_name': 'Velocity Check',
                    'rule_type': 'velocity',
                    'conditions': {
                        'field': 'amount_sum',
                        'operator': '>',
                        'value': 1000000,
                        'timeframe': '24_hours',
                        'description': 'Total amount exceeds 1M in 24 hours'
                    },
                    'action': 'flag',
                    'severity': 'high',
                    'created_by': 'system'
                }
            ]
            
            for rule in default_rules:
                cursor.execute("""
                    INSERT INTO fraud_rules (rule_name, rule_type, conditions, action, severity, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (rule['rule_name'], rule['rule_type'], json.dumps(rule['conditions']),
                      rule['action'], rule['severity'], rule['created_by']))
            
            self.db_connection.commit()
            cursor.close()
            
            logger.info("Default fraud rules inserted successfully")
        except Exception as e:
            logger.error(f"Failed to insert default fraud rules: {e}")
            self.db_connection.rollback()
    
    def load_fraud_rules(self):
        """Load fraud rules from database"""
        try:
            cursor = self.db_connection.cursor()
            cursor.execute("""
                SELECT rule_name, rule_type, conditions, action, severity
                FROM fraud_rules WHERE is_active = true
            """)
            
            self.fraud_rules = []
            for row in cursor.fetchall():
                self.fraud_rules.append({
                    'rule_name': row[0],
                    'rule_type': row[1],
                    'conditions': row[2],
                    'action': row[3],
                    'severity': row[4]
                })
            
            cursor.close()
            logger.info(f"Loaded {len(self.fraud_rules)} fraud rules")
        except Exception as e:
            logger.error(f"Failed to load fraud rules: {e}")
    
    def extract_features(self, transaction_data: Dict) -> np.ndarray:
        """Extract features from transaction data for ML models"""
        try:
            # Get additional context from Redis cache
            agent_risk = self.get_agent_risk_score(transaction_data.get('agent_id', ''))
            customer_risk = self.get_customer_risk_score(transaction_data.get('customer_id', ''))
            
            features = [
                float(transaction_data.get('amount', 0)),
                int(transaction_data.get('hour', datetime.now().hour)),
                int(transaction_data.get('day_of_week', datetime.now().weekday())),
                float(agent_risk),
                float(customer_risk),
                int(transaction_data.get('transaction_frequency', 1)),
                float(transaction_data.get('location_risk', 0)),
                float(transaction_data.get('device_risk', 0))
            ]
            
            return np.array(features).reshape(1, -1)
        except Exception as e:
            logger.error(f"Failed to extract features: {e}")
            return np.zeros((1, 8))
    
    def get_agent_risk_score(self, agent_id: str) -> float:
        """Get agent risk score from cache or database"""
        try:
            # Try Redis cache first
            cached_score = self.redis_client.get(f"agent_risk:{agent_id}")
            if cached_score:
                return float(cached_score)
            
            # Get from database
            cursor = self.db_connection.cursor()
            cursor.execute("""
                SELECT risk_score FROM agent_risk_profiles WHERE agent_id = %s
            """, (agent_id,))
            
            result = cursor.fetchone()
            cursor.close()
            
            if result:
                score = float(result[0])
                # Cache for 1 hour
                self.redis_client.setex(f"agent_risk:{agent_id}", 3600, str(score))
                return score
            
            return 0.0
        except Exception as e:
            logger.error(f"Failed to get agent risk score: {e}")
            return 0.0
    
    def get_customer_risk_score(self, customer_id: str) -> float:
        """Get customer risk score from cache or database"""
        try:
            if not customer_id:
                return 0.0
                
            # Try Redis cache first
            cached_score = self.redis_client.get(f"customer_risk:{customer_id}")
            if cached_score:
                return float(cached_score)
            
            # Get from database
            cursor = self.db_connection.cursor()
            cursor.execute("""
                SELECT risk_score FROM customer_risk_profiles WHERE customer_id = %s
            """, (customer_id,))
            
            result = cursor.fetchone()
            cursor.close()
            
            if result:
                score = float(result[0])
                # Cache for 1 hour
                self.redis_client.setex(f"customer_risk:{customer_id}", 3600, str(score))
                return score
            
            return 0.0
        except Exception as e:
            logger.error(f"Failed to get customer risk score: {e}")
            return 0.0
    
    def check_fraud_rules(self, transaction_data: Dict) -> List[Dict]:
        """Check transaction against fraud rules"""
        triggered_rules = []
        
        try:
            for rule in self.fraud_rules:
                conditions = rule['conditions']
                
                if rule['rule_type'] == 'threshold':
                    field_value = transaction_data.get(conditions['field'], 0)
                    threshold_value = conditions['value']
                    operator = conditions['operator']
                    
                    if operator == '>' and field_value > threshold_value:
                        triggered_rules.append(rule)
                    elif operator == '<' and field_value < threshold_value:
                        triggered_rules.append(rule)
                    elif operator == '==' and field_value == threshold_value:
                        triggered_rules.append(rule)
                
                elif rule['rule_type'] == 'time_based':
                    hour = int(transaction_data.get('hour', datetime.now().hour))
                    if hour in conditions['value']:
                        triggered_rules.append(rule)
                
                # Add more rule types as needed
                
        except Exception as e:
            logger.error(f"Failed to check fraud rules: {e}")
        
        return triggered_rules
    
    def analyze_transaction(self, transaction_data: Dict) -> Dict:
        """Comprehensive fraud analysis of a transaction"""
        try:
            start_time = time.time()
            
            # Extract features
            features = self.extract_features(transaction_data)
            scaled_features = self.scaler.transform(features)
            
            # ML-based fraud detection
            fraud_probability = self.fraud_classifier.predict_proba(scaled_features)[0][1]
            fraud_prediction = self.fraud_classifier.predict(scaled_features)[0]
            
            # Anomaly detection
            anomaly_score = self.anomaly_detector.decision_function(scaled_features)[0]
            is_anomaly = self.anomaly_detector.predict(scaled_features)[0] == -1
            
            # Rule-based checks
            triggered_rules = self.check_fraud_rules(transaction_data)
            
            # Calculate overall fraud score (0-100)
            fraud_score = (fraud_probability * 60) + (len(triggered_rules) * 10)
            if is_anomaly:
                fraud_score += 20
            fraud_score = min(100, fraud_score)
            
            # Determine risk level
            if fraud_score >= 80:
                risk_level = 'critical'
            elif fraud_score >= 60:
                risk_level = 'high'
            elif fraud_score >= 40:
                risk_level = 'medium'
            else:
                risk_level = 'low'
            
            # Determine recommended action
            if fraud_score >= 80 or any(rule['action'] == 'block' for rule in triggered_rules):
                recommended_action = 'block'
            elif fraud_score >= 60 or any(rule['action'] == 'flag' for rule in triggered_rules):
                recommended_action = 'flag'
            elif fraud_score >= 40:
                recommended_action = 'review'
            else:
                recommended_action = 'approve'
            
            processing_time = (time.time() - start_time) * 1000  # ms
            
            result = {
                'transaction_id': transaction_data.get('transaction_id'),
                'fraud_score': round(fraud_score, 2),
                'risk_level': risk_level,
                'fraud_probability': round(fraud_probability * 100, 2),
                'is_anomaly': bool(is_anomaly),
                'anomaly_score': round(float(anomaly_score), 4),
                'triggered_rules': [rule['rule_name'] for rule in triggered_rules],
                'recommended_action': recommended_action,
                'processing_time_ms': round(processing_time, 2),
                'analyzed_at': datetime.now().isoformat()
            }
            
            # Create fraud alert if necessary
            if fraud_score >= 60:
                self.create_fraud_alert(transaction_data, result, triggered_rules)
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to analyze transaction: {e}")
            return {
                'transaction_id': transaction_data.get('transaction_id'),
                'error': str(e),
                'analyzed_at': datetime.now().isoformat()
            }
    
    def create_fraud_alert(self, transaction_data: Dict, analysis_result: Dict, triggered_rules: List[Dict]):
        """Create fraud alert in database"""
        try:
            cursor = self.db_connection.cursor()
            
            alert_id = str(uuid.uuid4())
            
            details = {
                'transaction_data': transaction_data,
                'analysis_result': analysis_result,
                'triggered_rules': triggered_rules
            }
            
            cursor.execute("""
                INSERT INTO fraud_alerts (
                    alert_id, transaction_id, agent_id, customer_id, alert_type,
                    severity, fraud_score, anomaly_score, rule_triggered, details
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                alert_id,
                transaction_data.get('transaction_id'),
                transaction_data.get('agent_id'),
                transaction_data.get('customer_id'),
                'fraud_detection',
                analysis_result['risk_level'],
                analysis_result['fraud_score'],
                analysis_result.get('anomaly_score'),
                ', '.join(analysis_result['triggered_rules']),
                json.dumps(details)
            ))
            
            self.db_connection.commit()
            cursor.close()
            
            logger.info(f"Fraud alert created: {alert_id}")
            
        except Exception as e:
            logger.error(f"Failed to create fraud alert: {e}")
            self.db_connection.rollback()

# Initialize service
fraud_service = FraudDetectionService()

# API Routes
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        cursor = fraud_service.db_connection.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        
        # Test Redis connection
        fraud_service.redis_client.ping()
        
        return jsonify({
            'status': 'healthy',
            'service': 'fraud-detection-service',
            'timestamp': datetime.now().isoformat(),
            'database': 'connected',
            'redis': 'connected',
            'ml_models': 'loaded',
            'fraud_rules': len(fraud_service.fraud_rules)
        })
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 503

@app.route('/api/v1/fraud/analyze', methods=['POST'])
def analyze_transaction():
    """Analyze transaction for fraud"""
    try:
        transaction_data = request.get_json()
        if not transaction_data:
            return jsonify({'error': 'No transaction data provided'}), 400
        
        result = fraud_service.analyze_transaction(transaction_data)
        
        return jsonify({
            'status': 'success',
            'data': result
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/fraud/alerts', methods=['GET'])
def get_fraud_alerts():
    """Get fraud alerts"""
    try:
        status = request.args.get('status', 'open')
        severity = request.args.get('severity')
        limit = int(request.args.get('limit', 100))
        
        cursor = fraud_service.db_connection.cursor()
        
        query = """
            SELECT alert_id, transaction_id, agent_id, customer_id, alert_type,
                   severity, fraud_score, anomaly_score, rule_triggered, status,
                   created_at, updated_at
            FROM fraud_alerts WHERE 1=1
        """
        params = []
        
        if status:
            query += " AND status = %s"
            params.append(status)
        
        if severity:
            query += " AND severity = %s"
            params.append(severity)
        
        query += " ORDER BY created_at DESC LIMIT %s"
        params.append(limit)
        
        cursor.execute(query, params)
        
        alerts = []
        for row in cursor.fetchall():
            alerts.append({
                'alert_id': row[0],
                'transaction_id': row[1],
                'agent_id': row[2],
                'customer_id': row[3],
                'alert_type': row[4],
                'severity': row[5],
                'fraud_score': float(row[6]),
                'anomaly_score': float(row[7]) if row[7] else None,
                'rule_triggered': row[8],
                'status': row[9],
                'created_at': row[10].isoformat(),
                'updated_at': row[11].isoformat() if row[11] else None
            })
        
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': alerts,
            'count': len(alerts)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/fraud/rules', methods=['GET'])
def get_fraud_rules():
    """Get fraud detection rules"""
    try:
        cursor = fraud_service.db_connection.cursor()
        cursor.execute("""
            SELECT rule_name, rule_type, conditions, action, severity, is_active, created_at
            FROM fraud_rules
            ORDER BY created_at DESC
        """)
        
        rules = []
        for row in cursor.fetchall():
            rules.append({
                'rule_name': row[0],
                'rule_type': row[1],
                'conditions': row[2],
                'action': row[3],
                'severity': row[4],
                'is_active': row[5],
                'created_at': row[6].isoformat()
            })
        
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': rules,
            'count': len(rules)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/fraud/dashboard', methods=['GET'])
def get_dashboard():
    """Get fraud detection dashboard summary"""
    try:
        cursor = fraud_service.db_connection.cursor()
        
        # Get alert summary
        cursor.execute("""
            SELECT COUNT(*),
                   SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END),
                   AVG(fraud_score)
            FROM fraud_alerts
            WHERE created_at >= NOW() - INTERVAL '24 hours'
        """)
        
        alert_stats = cursor.fetchone()
        
        # Get rule summary
        cursor.execute("""
            SELECT COUNT(*), SUM(CASE WHEN is_active THEN 1 ELSE 0 END)
            FROM fraud_rules
        """)
        
        rule_stats = cursor.fetchone()
        
        cursor.close()
        
        summary = {
            'alerts_24h': {
                'total': alert_stats[0] if alert_stats[0] else 0,
                'critical': alert_stats[1] if alert_stats[1] else 0,
                'high': alert_stats[2] if alert_stats[2] else 0,
                'open': alert_stats[3] if alert_stats[3] else 0,
                'avg_fraud_score': float(alert_stats[4]) if alert_stats[4] else 0
            },
            'rules': {
                'total': rule_stats[0] if rule_stats[0] else 0,
                'active': rule_stats[1] if rule_stats[1] else 0
            },
            'ml_models': {
                'fraud_classifier': 'active',
                'anomaly_detector': 'active'
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
    port = int(os.getenv('PORT', 8002))
    app.run(host='0.0.0.0', port=port, debug=False)

