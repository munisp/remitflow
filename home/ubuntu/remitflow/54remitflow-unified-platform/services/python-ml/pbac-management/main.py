#!/usr/bin/env python3
"""
PBAC Management Service with ML Capabilities
Advanced Policy-Based Access Control Management System

This service provides:
- Intelligent policy recommendation using ML
- Policy conflict detection and resolution
- Advanced analytics and reporting
- Integration with Go PBAC engine
"""

import os
import json
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import uuid

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score
import joblib

from flask import Flask, request, jsonify
from flask_cors import CORS
import redis
import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from prometheus_client import Counter, Histogram, Gauge, generate_latest

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Metrics
policy_recommendations = Counter('pbac_policy_recommendations_total', 'Total policy recommendations')
conflict_detections = Counter('pbac_conflict_detections_total', 'Total policy conflicts detected')
ml_predictions = Counter('pbac_ml_predictions_total', 'Total ML predictions made')
policy_evaluations = Histogram('pbac_policy_evaluation_duration_seconds', 'Policy evaluation duration')
active_policies = Gauge('pbac_active_policies_count', 'Number of active policies')

class PBACMLEngine:
    """Advanced PBAC Management with Machine Learning capabilities"""
    
    def __init__(self):
        self.db_config = {
            'host': os.getenv('DB_HOST', 'localhost'),
            'port': os.getenv('DB_PORT', '5432'),
            'user': os.getenv('DB_USER', 'postgres'),
            'password': os.getenv('DB_PASSWORD', ''),
            'database': os.getenv('DB_NAME', 'remittance')
        }
        
        # Validate critical configuration
        if not self.db_config['password']:
            logger.warning("DB_PASSWORD not set - database connection may fail")
        
        self.redis_client = redis.Redis(
            host=os.getenv('REDIS_HOST', os.getenv('HOST', 'localhost')),
            port=int(os.getenv('REDIS_PORT', '6379')),
            password=os.getenv('REDIS_PASSWORD', ''),
            decode_responses=True
        )
        
        self.pbac_engine_url = os.getenv('PBAC_ENGINE_URL', os.getenv('SERVICE_URL_8090', 'http://localhost:8090'))
        
        # ML Models
        self.policy_recommender = None
        self.anomaly_detector = None
        self.risk_classifier = None
        
        # Encoders and scalers
        self.label_encoders = {}
        self.scaler = StandardScaler()
        
        # Initialize ML models
        self.initialize_ml_models()
        
    def get_db_connection(self):
        """Get database connection"""
        return psycopg2.connect(**self.db_config)
    
    def initialize_ml_models(self):
        """Initialize and train ML models"""
        logger.info("Initializing ML models...")
        
        try:
            # Load existing models if available
            self.load_models()
        except Exception as e:
            logger.warning(f"Could not load existing models: {e}")
            # Train new models
            self.train_models()
    
    def load_models(self):
        """Load pre-trained ML models"""
        model_path = '/tmp/pbac_models'
        
        self.policy_recommender = joblib.load(f'{model_path}/policy_recommender.pkl')
        self.anomaly_detector = joblib.load(f'{model_path}/anomaly_detector.pkl')
        self.risk_classifier = joblib.load(f'{model_path}/risk_classifier.pkl')
        self.label_encoders = joblib.load(f'{model_path}/label_encoders.pkl')
        self.scaler = joblib.load(f'{model_path}/scaler.pkl')
        
        logger.info("ML models loaded successfully")
    
    def save_models(self):
        """Save trained ML models"""
        model_path = '/tmp/pbac_models'
        os.makedirs(model_path, exist_ok=True)
        
        joblib.dump(self.policy_recommender, f'{model_path}/policy_recommender.pkl')
        joblib.dump(self.anomaly_detector, f'{model_path}/anomaly_detector.pkl')
        joblib.dump(self.risk_classifier, f'{model_path}/risk_classifier.pkl')
        joblib.dump(self.label_encoders, f'{model_path}/label_encoders.pkl')
        joblib.dump(self.scaler, f'{model_path}/scaler.pkl')
        
        logger.info("ML models saved successfully")
    
    def train_models(self):
        """Train ML models using historical data"""
        logger.info("Training ML models...")
        
        # Get training data
        audit_data = self.get_audit_data()
        policy_data = self.get_policy_data()
        
        if len(audit_data) < 100:
            logger.warning("Insufficient data for training. Using synthetic data.")
            audit_data = self.generate_synthetic_audit_data()
        
        # Prepare features
        features_df = self.prepare_features(audit_data)
        
        # Train policy recommender
        self.train_policy_recommender(features_df, audit_data)
        
        # Train anomaly detector
        self.train_anomaly_detector(features_df)
        
        # Train risk classifier
        self.train_risk_classifier(features_df, audit_data)
        
        # Save models
        self.save_models()
        
        logger.info("ML models trained successfully")
    
    def get_audit_data(self) -> List[Dict]:
        """Get audit log data from database"""
        try:
            with self.get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT * FROM audit_logs 
                        WHERE timestamp >= %s 
                        ORDER BY timestamp DESC 
                        LIMIT 10000
                    """, (datetime.now() - timedelta(days=30),))
                    return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error getting audit data: {e}")
            return []
    
    def get_policy_data(self) -> List[Dict]:
        """Get policy data from database"""
        try:
            with self.get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("SELECT * FROM policies WHERE active = true")
                    return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error getting policy data: {e}")
            return []
    
    def generate_synthetic_audit_data(self) -> List[Dict]:
        """Generate synthetic audit data for training"""
        logger.info("Generating synthetic audit data...")
        
        subjects = ['user1', 'user2', 'admin1', 'agent1', 'agent2', 'manager1']
        resources = ['accounts', 'transactions', 'users', 'reports', 'settings']
        actions = ['read', 'write', 'delete', 'create', 'update']
        decisions = ['ALLOW', 'DENY']
        roles = ['customer', 'agent', 'manager', 'admin']
        
        synthetic_data = []
        
        for i in range(1000):
            subject = np.random.choice(subjects)
            resource = np.random.choice(resources)
            action = np.random.choice(actions)
            role = np.random.choice(roles)
            
            # Simulate realistic decision patterns
            if role == 'admin':
                decision = 'ALLOW'
            elif role == 'customer' and resource == 'accounts' and action == 'read':
                decision = 'ALLOW'
            elif role == 'agent' and resource == 'transactions' and action in ['read', 'create']:
                decision = 'ALLOW'
            else:
                decision = np.random.choice(decisions, p=[0.7, 0.3])
            
            synthetic_data.append({
                'id': i + 1,
                'request_id': str(uuid.uuid4()),
                'subject': subject,
                'resource': resource,
                'action': action,
                'decision': decision,
                'reason': f'Policy evaluation for {role}',
                'policies': json.dumps([f'{role}_policy']),
                'context': json.dumps({
                    'role': role,
                    'ip_address': f'192.168.1.{np.random.randint(1, 255)}',
                    'user_agent': 'Mozilla/5.0',
                    'timestamp': datetime.now().isoformat()
                }),
                'timestamp': datetime.now() - timedelta(days=np.random.randint(0, 30)),
                'duration_ms': np.random.randint(10, 500)
            })
        
        return synthetic_data
    
    def prepare_features(self, audit_data: List[Dict]) -> pd.DataFrame:
        """Prepare features for ML training"""
        df = pd.DataFrame(audit_data)
        
        # Extract context features
        context_features = []
        for _, row in df.iterrows():
            try:
                context = json.loads(row['context']) if isinstance(row['context'], str) else row['context']
                context_features.append(context)
            except (json.JSONDecodeError, TypeError, KeyError) as e:
                logger.warning(f"Failed to parse context: {e}")
                context_features.append({})
        
        context_df = pd.DataFrame(context_features)
        
        # Combine features
        features_df = pd.concat([
            df[['subject', 'resource', 'action', 'decision']],
            context_df
        ], axis=1)
        
        # Fill missing values
        features_df = features_df.fillna('unknown')
        
        # Encode categorical variables
        categorical_columns = ['subject', 'resource', 'action', 'role', 'user_agent']
        
        for col in categorical_columns:
            if col in features_df.columns:
                if col not in self.label_encoders:
                    self.label_encoders[col] = LabelEncoder()
                    features_df[f'{col}_encoded'] = self.label_encoders[col].fit_transform(features_df[col].astype(str))
                else:
                    # Handle new categories
                    known_classes = set(self.label_encoders[col].classes_)
                    new_classes = set(features_df[col].astype(str)) - known_classes
                    if new_classes:
                        # Add new classes to encoder
                        all_classes = list(known_classes) + list(new_classes)
                        self.label_encoders[col].classes_ = np.array(all_classes)
                    
                    features_df[f'{col}_encoded'] = self.label_encoders[col].transform(features_df[col].astype(str))
        
        return features_df
    
    def train_policy_recommender(self, features_df: pd.DataFrame, audit_data: List[Dict]):
        """Train policy recommendation model"""
        logger.info("Training policy recommender...")
        
        # Prepare features for policy recommendation
        feature_columns = [col for col in features_df.columns if col.endswith('_encoded')]
        
        if not feature_columns:
            logger.warning("No encoded features available for training")
            return
        
        X = features_df[feature_columns].fillna(0)
        
        # Create target variable (policy effectiveness score)
        y = []
        for _, row in features_df.iterrows():
            # Simple heuristic: ALLOW decisions with low duration are good
            if row['decision'] == 'ALLOW':
                score = 1.0
            else:
                score = 0.0
            y.append(score)
        
        y = np.array(y)
        
        # Train model
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        self.policy_recommender = RandomForestClassifier(n_estimators=100, random_state=42)
        self.policy_recommender.fit(X_train, y_train)
        
        # Evaluate
        y_pred = self.policy_recommender.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        logger.info(f"Policy recommender accuracy: {accuracy:.3f}")
    
    def train_anomaly_detector(self, features_df: pd.DataFrame):
        """Train anomaly detection model"""
        logger.info("Training anomaly detector...")
        
        feature_columns = [col for col in features_df.columns if col.endswith('_encoded')]
        
        if not feature_columns:
            logger.warning("No encoded features available for anomaly detection")
            return
        
        X = features_df[feature_columns].fillna(0)
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Train isolation forest
        self.anomaly_detector = IsolationForest(contamination=0.1, random_state=42)
        self.anomaly_detector.fit(X_scaled)
        
        logger.info("Anomaly detector trained successfully")
    
    def train_risk_classifier(self, features_df: pd.DataFrame, audit_data: List[Dict]):
        """Train risk classification model"""
        logger.info("Training risk classifier...")
        
        feature_columns = [col for col in features_df.columns if col.endswith('_encoded')]
        
        if not feature_columns:
            logger.warning("No encoded features available for risk classification")
            return
        
        X = features_df[feature_columns].fillna(0)
        
        # Create risk labels based on patterns
        y_risk = []
        for _, row in features_df.iterrows():
            # High risk patterns
            if (row['resource'] == 'transactions' and row['action'] == 'create' and 
                row['decision'] == 'DENY'):
                risk = 'high'
            elif row['decision'] == 'DENY':
                risk = 'medium'
            else:
                risk = 'low'
            y_risk.append(risk)
        
        # Encode risk labels
        risk_encoder = LabelEncoder()
        y_risk_encoded = risk_encoder.fit_transform(y_risk)
        self.label_encoders['risk'] = risk_encoder
        
        # Train model
        X_train, X_test, y_train, y_test = train_test_split(X, y_risk_encoded, test_size=0.2, random_state=42)
        
        self.risk_classifier = RandomForestClassifier(n_estimators=100, random_state=42)
        self.risk_classifier.fit(X_train, y_train)
        
        # Evaluate
        y_pred = self.risk_classifier.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        logger.info(f"Risk classifier accuracy: {accuracy:.3f}")
    
    def recommend_policies(self, context: Dict) -> List[Dict]:
        """Recommend policies based on context using ML"""
        policy_recommendations.inc()
        
        if not self.policy_recommender:
            return self.get_default_policy_recommendations(context)
        
        try:
            # Prepare features
            feature_dict = {
                'subject': context.get('subject', 'unknown'),
                'resource': context.get('resource', 'unknown'),
                'action': context.get('action', 'unknown'),
                'role': context.get('role', 'unknown'),
                'user_agent': context.get('user_agent', 'unknown')
            }
            
            # Encode features
            encoded_features = []
            feature_columns = [col for col in self.label_encoders.keys() if col != 'risk']
            
            for col in feature_columns:
                if col in feature_dict:
                    try:
                        encoded_value = self.label_encoders[col].transform([str(feature_dict[col])])[0]
                        encoded_features.append(encoded_value)
                    except ValueError:
                        # Unknown category
                        encoded_features.append(0)
                else:
                    encoded_features.append(0)
            
            if not encoded_features:
                return self.get_default_policy_recommendations(context)
            
            # Predict
            features_array = np.array(encoded_features).reshape(1, -1)
            prediction = self.policy_recommender.predict_proba(features_array)[0]
            
            # Generate recommendations based on prediction
            recommendations = []
            
            if prediction[1] > 0.7:  # High confidence for ALLOW
                recommendations.append({
                    'name': f"allow_{context.get('role', 'user')}_{context.get('resource', 'resource')}_{context.get('action', 'action')}",
                    'description': f"Allow {context.get('role', 'user')} to {context.get('action', 'action')} {context.get('resource', 'resource')}",
                    'resource': context.get('resource', '*'),
                    'action': context.get('action', '*'),
                    'effect': 'ALLOW',
                    'conditions': json.dumps({
                        'rules': [{'field': 'role', 'operator': 'eq', 'value': context.get('role', 'user')}],
                        'logic': 'AND'
                    }),
                    'priority': 50,
                    'confidence': float(prediction[1])
                })
            
            return recommendations
            
        except Exception as e:
            logger.error(f"Error in policy recommendation: {e}")
            return self.get_default_policy_recommendations(context)
    
    def get_default_policy_recommendations(self, context: Dict) -> List[Dict]:
        """Get default policy recommendations"""
        role = context.get('role', 'user')
        resource = context.get('resource', 'unknown')
        action = context.get('action', 'read')
        
        recommendations = []
        
        # Role-based recommendations
        if role == 'admin':
            recommendations.append({
                'name': f'admin_full_access_{resource}',
                'description': f'Full admin access to {resource}',
                'resource': resource,
                'action': '*',
                'effect': 'ALLOW',
                'conditions': json.dumps({
                    'rules': [{'field': 'role', 'operator': 'eq', 'value': 'admin'}],
                    'logic': 'AND'
                }),
                'priority': 10,
                'confidence': 0.9
            })
        elif role == 'agent' and resource == 'transactions':
            recommendations.append({
                'name': 'agent_transaction_access',
                'description': 'Allow agents to process transactions',
                'resource': 'transactions',
                'action': action,
                'effect': 'ALLOW',
                'conditions': json.dumps({
                    'rules': [
                        {'field': 'role', 'operator': 'eq', 'value': 'agent'},
                        {'field': 'status', 'operator': 'eq', 'value': 'active'}
                    ],
                    'logic': 'AND'
                }),
                'priority': 20,
                'confidence': 0.8
            })
        
        return recommendations
    
    def detect_policy_conflicts(self, policies: List[Dict]) -> List[Dict]:
        """Detect conflicts between policies"""
        conflict_detections.inc()
        
        conflicts = []
        
        for i, policy1 in enumerate(policies):
            for j, policy2 in enumerate(policies[i+1:], i+1):
                conflict = self.check_policy_conflict(policy1, policy2)
                if conflict:
                    conflicts.append({
                        'policy1': policy1['name'],
                        'policy2': policy2['name'],
                        'conflict_type': conflict['type'],
                        'description': conflict['description'],
                        'severity': conflict['severity'],
                        'resolution': conflict['resolution']
                    })
        
        return conflicts
    
    def check_policy_conflict(self, policy1: Dict, policy2: Dict) -> Optional[Dict]:
        """Check if two policies conflict"""
        # Same resource and action but different effects
        if (policy1['resource'] == policy2['resource'] and 
            policy1['action'] == policy2['action'] and 
            policy1['effect'] != policy2['effect']):
            
            return {
                'type': 'effect_conflict',
                'description': f"Policies have conflicting effects for {policy1['resource']}.{policy1['action']}",
                'severity': 'high',
                'resolution': 'Review policy priorities and conditions'
            }
        
        # Overlapping conditions with different effects
        if (self.conditions_overlap(policy1.get('conditions', ''), policy2.get('conditions', '')) and
            policy1['effect'] != policy2['effect']):
            
            return {
                'type': 'condition_conflict',
                'description': 'Policies have overlapping conditions but different effects',
                'severity': 'medium',
                'resolution': 'Refine policy conditions to avoid overlap'
            }
        
        return None
    
    def conditions_overlap(self, conditions1: str, conditions2: str) -> bool:
        """Check if policy conditions overlap"""
        try:
            cond1 = json.loads(conditions1) if conditions1 else {}
            cond2 = json.loads(conditions2) if conditions2 else {}
            
            # Simple overlap detection - can be enhanced
            rules1 = cond1.get('rules', [])
            rules2 = cond2.get('rules', [])
            
            for rule1 in rules1:
                for rule2 in rules2:
                    if (rule1.get('field') == rule2.get('field') and
                        rule1.get('operator') == rule2.get('operator') and
                        rule1.get('value') == rule2.get('value')):
                        return True
            
            return False
            
        except Exception:
            return False
    
    def detect_anomalies(self, access_requests: List[Dict]) -> List[Dict]:
        """Detect anomalous access patterns"""
        if not self.anomaly_detector:
            return []
        
        anomalies = []
        
        try:
            # Prepare features for each request
            for request in access_requests:
                features = self.prepare_request_features(request)
                if features is not None:
                    # Scale features
                    features_scaled = self.scaler.transform([features])
                    
                    # Predict anomaly
                    anomaly_score = self.anomaly_detector.decision_function(features_scaled)[0]
                    is_anomaly = self.anomaly_detector.predict(features_scaled)[0] == -1
                    
                    if is_anomaly:
                        anomalies.append({
                            'request_id': request.get('request_id', str(uuid.uuid4())),
                            'subject': request.get('subject'),
                            'resource': request.get('resource'),
                            'action': request.get('action'),
                            'anomaly_score': float(anomaly_score),
                            'risk_level': 'high' if anomaly_score < -0.5 else 'medium',
                            'description': 'Unusual access pattern detected'
                        })
        
        except Exception as e:
            logger.error(f"Error in anomaly detection: {e}")
        
        return anomalies
    
    def prepare_request_features(self, request: Dict) -> Optional[List[float]]:
        """Prepare features for a single request"""
        try:
            features = []
            
            # Encode categorical features
            categorical_features = ['subject', 'resource', 'action']
            
            for feature in categorical_features:
                value = request.get(feature, 'unknown')
                if feature in self.label_encoders:
                    try:
                        encoded = self.label_encoders[feature].transform([str(value)])[0]
                        features.append(float(encoded))
                    except ValueError:
                        features.append(0.0)
                else:
                    features.append(0.0)
            
            return features if features else None
            
        except Exception as e:
            logger.error(f"Error preparing request features: {e}")
            return None
    
    def classify_risk(self, context: Dict) -> Dict:
        """Classify risk level of an access request"""
        ml_predictions.inc()
        
        if not self.risk_classifier:
            return self.get_default_risk_classification(context)
        
        try:
            features = self.prepare_request_features(context)
            if features is None:
                return self.get_default_risk_classification(context)
            
            # Predict risk
            risk_encoded = self.risk_classifier.predict([features])[0]
            risk_proba = self.risk_classifier.predict_proba([features])[0]
            
            # Decode risk level
            risk_level = self.label_encoders['risk'].inverse_transform([risk_encoded])[0]
            confidence = float(max(risk_proba))
            
            return {
                'risk_level': risk_level,
                'confidence': confidence,
                'factors': self.get_risk_factors(context),
                'recommendations': self.get_risk_recommendations(risk_level)
            }
            
        except Exception as e:
            logger.error(f"Error in risk classification: {e}")
            return self.get_default_risk_classification(context)
    
    def get_default_risk_classification(self, context: Dict) -> Dict:
        """Get default risk classification"""
        resource = context.get('resource', '')
        action = context.get('action', '')
        role = context.get('role', '')
        
        # Simple rule-based risk assessment
        if resource == 'transactions' and action in ['create', 'delete']:
            risk_level = 'high'
        elif role == 'admin':
            risk_level = 'medium'
        else:
            risk_level = 'low'
        
        return {
            'risk_level': risk_level,
            'confidence': 0.7,
            'factors': self.get_risk_factors(context),
            'recommendations': self.get_risk_recommendations(risk_level)
        }
    
    def get_risk_factors(self, context: Dict) -> List[str]:
        """Get risk factors for the context"""
        factors = []
        
        if context.get('resource') == 'transactions':
            factors.append('Financial transaction access')
        
        if context.get('action') in ['delete', 'create']:
            factors.append('Destructive or creative action')
        
        if context.get('role') == 'admin':
            factors.append('Administrative privileges')
        
        return factors
    
    def get_risk_recommendations(self, risk_level: str) -> List[str]:
        """Get recommendations based on risk level"""
        recommendations = {
            'high': [
                'Require additional authentication',
                'Enable audit logging',
                'Implement approval workflow',
                'Monitor for suspicious activity'
            ],
            'medium': [
                'Enable audit logging',
                'Monitor access patterns',
                'Review periodically'
            ],
            'low': [
                'Standard monitoring',
                'Regular access review'
            ]
        }
        
        return recommendations.get(risk_level, [])
    
    def get_policy_analytics(self) -> Dict:
        """Get policy analytics and insights"""
        try:
            with self.get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    # Policy usage statistics
                    cur.execute("""
                        SELECT 
                            COUNT(*) as total_evaluations,
                            COUNT(CASE WHEN decision = 'ALLOW' THEN 1 END) as allow_count,
                            COUNT(CASE WHEN decision = 'DENY' THEN 1 END) as deny_count,
                            AVG(duration_ms) as avg_duration,
                            COUNT(DISTINCT subject) as unique_subjects,
                            COUNT(DISTINCT resource) as unique_resources
                        FROM audit_logs 
                        WHERE timestamp >= %s
                    """, (datetime.now() - timedelta(days=7),))
                    
                    stats = dict(cur.fetchone())
                    
                    # Top denied resources
                    cur.execute("""
                        SELECT resource, COUNT(*) as deny_count
                        FROM audit_logs 
                        WHERE decision = 'DENY' AND timestamp >= %s
                        GROUP BY resource 
                        ORDER BY deny_count DESC 
                        LIMIT 10
                    """, (datetime.now() - timedelta(days=7),))
                    
                    top_denied = [dict(row) for row in cur.fetchall()]
                    
                    # Policy effectiveness
                    cur.execute("""
                        SELECT 
                            policies,
                            COUNT(*) as usage_count,
                            COUNT(CASE WHEN decision = 'ALLOW' THEN 1 END) as allow_count,
                            AVG(duration_ms) as avg_duration
                        FROM audit_logs 
                        WHERE timestamp >= %s AND policies IS NOT NULL
                        GROUP BY policies 
                        ORDER BY usage_count DESC 
                        LIMIT 10
                    """, (datetime.now() - timedelta(days=7),))
                    
                    policy_effectiveness = [dict(row) for row in cur.fetchall()]
                    
                    return {
                        'summary': stats,
                        'top_denied_resources': top_denied,
                        'policy_effectiveness': policy_effectiveness,
                        'generated_at': datetime.now().isoformat()
                    }
                    
        except Exception as e:
            logger.error(f"Error getting policy analytics: {e}")
            return {'error': str(e)}

# Flask Application
app = Flask(__name__)
CORS(app)

# Initialize PBAC ML Engine
pbac_ml = PBACMLEngine()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'pbac-management',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/v1/recommend-policies', methods=['POST'])
def recommend_policies():
    """Recommend policies based on context"""
    try:
        context = request.get_json()
        if not context:
            return jsonify({'error': 'Context required'}), 400
        
        recommendations = pbac_ml.recommend_policies(context)
        
        return jsonify({
            'recommendations': recommendations,
            'count': len(recommendations),
            'context': context
        })
        
    except Exception as e:
        logger.error(f"Error in policy recommendation: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/detect-conflicts', methods=['POST'])
def detect_conflicts():
    """Detect policy conflicts"""
    try:
        data = request.get_json()
        policies = data.get('policies', [])
        
        if not policies:
            return jsonify({'error': 'Policies required'}), 400
        
        conflicts = pbac_ml.detect_policy_conflicts(policies)
        
        return jsonify({
            'conflicts': conflicts,
            'count': len(conflicts),
            'policies_analyzed': len(policies)
        })
        
    except Exception as e:
        logger.error(f"Error in conflict detection: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/detect-anomalies', methods=['POST'])
def detect_anomalies():
    """Detect anomalous access patterns"""
    try:
        data = request.get_json()
        requests_data = data.get('requests', [])
        
        if not requests_data:
            return jsonify({'error': 'Access requests required'}), 400
        
        anomalies = pbac_ml.detect_anomalies(requests_data)
        
        return jsonify({
            'anomalies': anomalies,
            'count': len(anomalies),
            'requests_analyzed': len(requests_data)
        })
        
    except Exception as e:
        logger.error(f"Error in anomaly detection: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/classify-risk', methods=['POST'])
def classify_risk():
    """Classify risk level of access request"""
    try:
        context = request.get_json()
        if not context:
            return jsonify({'error': 'Context required'}), 400
        
        risk_classification = pbac_ml.classify_risk(context)
        
        return jsonify({
            'risk_classification': risk_classification,
            'context': context
        })
        
    except Exception as e:
        logger.error(f"Error in risk classification: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/analytics', methods=['GET'])
def get_analytics():
    """Get policy analytics and insights"""
    try:
        analytics = pbac_ml.get_policy_analytics()
        return jsonify(analytics)
        
    except Exception as e:
        logger.error(f"Error getting analytics: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/retrain', methods=['POST'])
def retrain_models():
    """Retrain ML models"""
    try:
        pbac_ml.train_models()
        return jsonify({
            'status': 'success',
            'message': 'Models retrained successfully',
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error retraining models: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/metrics', methods=['GET'])
def metrics():
    """Prometheus metrics endpoint"""
    return generate_latest()

if __name__ == '__main__':
    port = int(os.getenv('PORT', 8091))
    
    logger.info("🚀 Starting PBAC Management Service with ML...")
    logger.info(f"🌐 Service running on port {port}")
    logger.info(f"🔗 Health check: http://localhost:{port}/health")
    logger.info(f"📊 Metrics: http://localhost:{port}/metrics")
    
    app.run(host=os.getenv('HOST', os.getenv('HOST', '0.0.0.0')), port=port, debug=False)

