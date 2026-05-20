#!/usr/bin/env python3
"""
QR Analytics Service with Advanced Features
Comprehensive QR Code Analytics and Management System

This service provides:
- Advanced QR code usage analytics
- Fraud detection for QR codes
- Usage pattern analysis
- Performance optimization recommendations
- Integration with Go QR service
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
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.cluster import KMeans
from sklearn.model_selection import train_test_split
import joblib

from flask import Flask, request, jsonify
from flask_cors import CORS
import redis
import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import plotly.graph_objects as go
import plotly.express as px
from plotly.utils import PlotlyJSONEncoder

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Metrics
qr_analytics_requests = Counter('qr_analytics_requests_total', 'Total QR analytics requests')
fraud_detections = Counter('qr_fraud_detections_total', 'Total QR fraud detections')
usage_predictions = Counter('qr_usage_predictions_total', 'Total QR usage predictions')
analytics_processing_time = Histogram('qr_analytics_processing_duration_seconds', 'Analytics processing duration')
active_qr_codes = Gauge('qr_active_codes_count', 'Number of active QR codes')

class QRAnalyticsEngine:
    """Advanced QR Analytics with Machine Learning capabilities"""
    
    def __init__(self):
        self.db_config = {
            'host': os.getenv('DB_HOST', os.getenv('HOST', 'localhost')),
            'port': os.getenv('DB_PORT', '5432'),
            'user': os.getenv('DB_USER', 'postgres'),
            os.getenv('DB_PASSWORD', 'password'): os.getenv('DB_PASSWORD', os.getenv('DB_PASSWORD', 'password')),
            'database': os.getenv('DB_NAME', 'remittance')
        }
        
        self.redis_client = redis.Redis(
            host=os.getenv('REDIS_HOST', os.getenv('HOST', 'localhost')),
            port=int(os.getenv('REDIS_PORT', '6379')),
            password=os.getenv('REDIS_PASSWORD', ''),
            decode_responses=True
        )
        
        self.qr_service_url = os.getenv('QR_SERVICE_URL', os.getenv('SERVICE_URL_8092', 'http://localhost:8092'))
        
        # ML Models
        self.fraud_detector = None
        self.usage_predictor = None
        self.pattern_analyzer = None
        
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
        logger.info("Initializing QR Analytics ML models...")
        
        try:
            # Load existing models if available
            self.load_models()
        except Exception as e:
            logger.warning(f"Could not load existing models: {e}")
            # Train new models
            self.train_models()
    
    def load_models(self):
        """Load pre-trained ML models"""
        model_path = '/tmp/qr_analytics_models'
        
        self.fraud_detector = joblib.load(f'{model_path}/fraud_detector.pkl')
        self.usage_predictor = joblib.load(f'{model_path}/usage_predictor.pkl')
        self.pattern_analyzer = joblib.load(f'{model_path}/pattern_analyzer.pkl')
        self.label_encoders = joblib.load(f'{model_path}/label_encoders.pkl')
        self.scaler = joblib.load(f'{model_path}/scaler.pkl')
        
        logger.info("QR Analytics ML models loaded successfully")
    
    def save_models(self):
        """Save trained ML models"""
        model_path = '/tmp/qr_analytics_models'
        os.makedirs(model_path, exist_ok=True)
        
        joblib.dump(self.fraud_detector, f'{model_path}/fraud_detector.pkl')
        joblib.dump(self.usage_predictor, f'{model_path}/usage_predictor.pkl')
        joblib.dump(self.pattern_analyzer, f'{model_path}/pattern_analyzer.pkl')
        joblib.dump(self.label_encoders, f'{model_path}/label_encoders.pkl')
        joblib.dump(self.scaler, f'{model_path}/scaler.pkl')
        
        logger.info("QR Analytics ML models saved successfully")
    
    def train_models(self):
        """Train ML models using QR usage data"""
        logger.info("Training QR Analytics ML models...")
        
        # Get training data
        qr_data = self.get_qr_data()
        usage_data = self.get_usage_data()
        
        if len(usage_data) < 100:
            logger.warning("Insufficient data for training. Using synthetic data.")
            usage_data = self.generate_synthetic_usage_data()
        
        # Prepare features
        features_df = self.prepare_features(qr_data, usage_data)
        
        # Train fraud detector
        self.train_fraud_detector(features_df)
        
        # Train usage predictor
        self.train_usage_predictor(features_df)
        
        # Train pattern analyzer
        self.train_pattern_analyzer(features_df)
        
        # Save models
        self.save_models()
        
        logger.info("QR Analytics ML models trained successfully")
    
    def get_qr_data(self) -> List[Dict]:
        """Get QR code data from database"""
        try:
            with self.get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT * FROM qr_codes 
                        WHERE created_at >= %s 
                        ORDER BY created_at DESC 
                        LIMIT 10000
                    """, (datetime.now() - timedelta(days=30),))
                    return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error getting QR data: {e}")
            return []
    
    def get_usage_data(self) -> List[Dict]:
        """Get QR usage data from database"""
        try:
            with self.get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT * FROM qr_usages 
                        WHERE used_at >= %s 
                        ORDER BY used_at DESC 
                        LIMIT 10000
                    """, (datetime.now() - timedelta(days=30),))
                    return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error getting usage data: {e}")
            return []
    
    def generate_synthetic_usage_data(self) -> List[Dict]:
        """Generate synthetic QR usage data for training"""
        logger.info("Generating synthetic QR usage data...")
        
        qr_types = ['payment', 'auth', 'agent_verification', 'transaction', 'account']
        purposes = ['payment_request', 'login', 'agent_verify', 'receipt', 'link_account']
        locations = ['Lagos', 'Abuja', 'Kano', 'Port Harcourt', 'Ibadan']
        
        synthetic_data = []
        
        for i in range(2000):
            qr_type = np.random.choice(qr_types)
            purpose = np.random.choice(purposes)
            location = np.random.choice(locations)
            
            # Simulate realistic usage patterns
            hour = np.random.randint(6, 23)  # Business hours
            success_rate = 0.95 if qr_type == 'payment' else 0.98
            
            # Simulate fraud patterns (5% of data)
            is_fraud = np.random.random() < 0.05
            if is_fraud:
                # Fraudulent patterns
                hour = np.random.randint(0, 6)  # Unusual hours
                success_rate = 0.3
                location = 'Unknown'
            
            synthetic_data.append({
                'id': i + 1,
                'qr_code_id': str(uuid.uuid4()),
                'used_by': f'user_{np.random.randint(1, 1000)}',
                'used_at': datetime.now() - timedelta(
                    days=np.random.randint(0, 30),
                    hours=hour,
                    minutes=np.random.randint(0, 60)
                ),
                'ip_address': f'192.168.{np.random.randint(1, 255)}.{np.random.randint(1, 255)}',
                'user_agent': np.random.choice([
                    'Mozilla/5.0 (Android)',
                    'Mozilla/5.0 (iPhone)',
                    'Mozilla/5.0 (Windows)',
                    'Unknown'
                ]),
                'location': location,
                'success': np.random.random() < success_rate,
                'error_msg': '' if np.random.random() < success_rate else 'Validation failed',
                'metadata': json.dumps({
                    'qr_type': qr_type,
                    'purpose': purpose,
                    'amount': np.random.randint(100, 100000) if qr_type == 'payment' else None,
                    'is_fraud': is_fraud
                })
            })
        
        return synthetic_data
    
    def prepare_features(self, qr_data: List[Dict], usage_data: List[Dict]) -> pd.DataFrame:
        """Prepare features for ML training"""
        # Combine QR and usage data
        usage_df = pd.DataFrame(usage_data)
        
        # Extract metadata features
        metadata_features = []
        for _, row in usage_df.iterrows():
            try:
                metadata = json.loads(row['metadata']) if isinstance(row['metadata'], str) else row['metadata']
                metadata_features.append(metadata)
            except:
                metadata_features.append({})
        
        metadata_df = pd.DataFrame(metadata_features)
        
        # Extract time features
        usage_df['used_at'] = pd.to_datetime(usage_df['used_at'])
        usage_df['hour'] = usage_df['used_at'].dt.hour
        usage_df['day_of_week'] = usage_df['used_at'].dt.dayofweek
        usage_df['is_weekend'] = usage_df['day_of_week'].isin([5, 6])
        
        # Combine features
        features_df = pd.concat([
            usage_df[['used_by', 'ip_address', 'user_agent', 'location', 'success', 'hour', 'day_of_week', 'is_weekend']],
            metadata_df
        ], axis=1)
        
        # Fill missing values
        features_df = features_df.fillna('unknown')
        
        # Encode categorical variables
        categorical_columns = ['used_by', 'user_agent', 'location', 'qr_type', 'purpose']
        
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
                        all_classes = list(known_classes) + list(new_classes)
                        self.label_encoders[col].classes_ = np.array(all_classes)
                    
                    features_df[f'{col}_encoded'] = self.label_encoders[col].transform(features_df[col].astype(str))
        
        return features_df
    
    def train_fraud_detector(self, features_df: pd.DataFrame):
        """Train fraud detection model"""
        logger.info("Training QR fraud detector...")
        
        # Prepare features for fraud detection
        feature_columns = [col for col in features_df.columns if col.endswith('_encoded')] + ['hour', 'day_of_week']
        
        if not feature_columns:
            logger.warning("No features available for fraud detection training")
            return
        
        X = features_df[feature_columns].fillna(0)
        
        # Create fraud labels
        y_fraud = features_df.get('is_fraud', [False] * len(features_df))
        
        # If no fraud labels, use anomaly detection
        if not any(y_fraud):
            logger.info("No fraud labels found, using unsupervised anomaly detection")
            X_scaled = self.scaler.fit_transform(X)
            self.fraud_detector = IsolationForest(contamination=0.05, random_state=42)
            self.fraud_detector.fit(X_scaled)
        else:
            # Supervised fraud detection
            X_train, X_test, y_train, y_test = train_test_split(X, y_fraud, test_size=0.2, random_state=42)
            
            self.fraud_detector = RandomForestClassifier(n_estimators=100, random_state=42)
            self.fraud_detector.fit(X_train, y_train)
            
            # Evaluate
            y_pred = self.fraud_detector.predict(X_test)
            accuracy = np.mean(y_pred == y_test)
            logger.info(f"Fraud detector accuracy: {accuracy:.3f}")
    
    def train_usage_predictor(self, features_df: pd.DataFrame):
        """Train usage prediction model"""
        logger.info("Training QR usage predictor...")
        
        feature_columns = [col for col in features_df.columns if col.endswith('_encoded')] + ['hour', 'day_of_week']
        
        if not feature_columns:
            logger.warning("No features available for usage prediction training")
            return
        
        X = features_df[feature_columns].fillna(0)
        
        # Create usage success labels
        y_success = features_df['success'].astype(int)
        
        # Train model
        X_train, X_test, y_train, y_test = train_test_split(X, y_success, test_size=0.2, random_state=42)
        
        self.usage_predictor = RandomForestClassifier(n_estimators=100, random_state=42)
        self.usage_predictor.fit(X_train, y_train)
        
        # Evaluate
        y_pred = self.usage_predictor.predict(X_test)
        accuracy = np.mean(y_pred == y_test)
        logger.info(f"Usage predictor accuracy: {accuracy:.3f}")
    
    def train_pattern_analyzer(self, features_df: pd.DataFrame):
        """Train pattern analysis model"""
        logger.info("Training QR pattern analyzer...")
        
        feature_columns = [col for col in features_df.columns if col.endswith('_encoded')] + ['hour', 'day_of_week']
        
        if not feature_columns:
            logger.warning("No features available for pattern analysis training")
            return
        
        X = features_df[feature_columns].fillna(0)
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Train clustering model
        self.pattern_analyzer = KMeans(n_clusters=5, random_state=42)
        self.pattern_analyzer.fit(X_scaled)
        
        logger.info("Pattern analyzer trained successfully")
    
    def detect_fraud(self, usage_data: List[Dict]) -> List[Dict]:
        """Detect fraudulent QR usage patterns"""
        fraud_detections.inc()
        
        if not self.fraud_detector:
            return []
        
        fraudulent_usage = []
        
        try:
            for usage in usage_data:
                features = self.prepare_usage_features(usage)
                if features is not None:
                    # Scale features if using isolation forest
                    if hasattr(self.fraud_detector, 'decision_function'):
                        features_scaled = self.scaler.transform([features])
                        fraud_score = self.fraud_detector.decision_function(features_scaled)[0]
                        is_fraud = self.fraud_detector.predict(features_scaled)[0] == -1
                    else:
                        # Random forest classifier
                        fraud_prob = self.fraud_detector.predict_proba([features])[0]
                        is_fraud = fraud_prob[1] > 0.5
                        fraud_score = fraud_prob[1]
                    
                    if is_fraud:
                        fraudulent_usage.append({
                            'usage_id': usage.get('id'),
                            'qr_code_id': usage.get('qr_code_id'),
                            'used_by': usage.get('used_by'),
                            'fraud_score': float(fraud_score),
                            'risk_level': 'high' if fraud_score > 0.8 else 'medium',
                            'reasons': self.get_fraud_reasons(usage),
                            'timestamp': usage.get('used_at')
                        })
        
        except Exception as e:
            logger.error(f"Error in fraud detection: {e}")
        
        return fraudulent_usage
    
    def prepare_usage_features(self, usage: Dict) -> Optional[List[float]]:
        """Prepare features for a single usage record"""
        try:
            features = []
            
            # Extract metadata
            metadata = json.loads(usage.get('metadata', '{}')) if isinstance(usage.get('metadata'), str) else usage.get('metadata', {})
            
            # Time features
            used_at = pd.to_datetime(usage.get('used_at'))
            hour = used_at.hour
            day_of_week = used_at.dayofweek
            
            features.extend([hour, day_of_week])
            
            # Encode categorical features
            categorical_features = ['used_by', 'user_agent', 'location', 'qr_type', 'purpose']
            
            for feature in categorical_features:
                value = usage.get(feature) or metadata.get(feature, 'unknown')
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
            logger.error(f"Error preparing usage features: {e}")
            return None
    
    def get_fraud_reasons(self, usage: Dict) -> List[str]:
        """Get reasons why usage might be fraudulent"""
        reasons = []
        
        # Check time patterns
        used_at = pd.to_datetime(usage.get('used_at'))
        if used_at.hour < 6 or used_at.hour > 22:
            reasons.append('Unusual time of usage')
        
        # Check location
        if usage.get('location') == 'Unknown':
            reasons.append('Unknown location')
        
        # Check success rate
        if not usage.get('success', True):
            reasons.append('Failed usage attempt')
        
        # Check user agent
        if usage.get('user_agent') == 'Unknown':
            reasons.append('Unknown user agent')
        
        return reasons
    
    def predict_usage_success(self, qr_context: Dict) -> Dict:
        """Predict QR usage success probability"""
        usage_predictions.inc()
        
        if not self.usage_predictor:
            return {'success_probability': 0.8, 'confidence': 0.5}
        
        try:
            features = self.prepare_usage_features(qr_context)
            if features is None:
                return {'success_probability': 0.8, 'confidence': 0.5}
            
            # Predict success probability
            success_prob = self.usage_predictor.predict_proba([features])[0][1]
            
            return {
                'success_probability': float(success_prob),
                'confidence': float(max(self.usage_predictor.predict_proba([features])[0])),
                'recommendations': self.get_usage_recommendations(success_prob)
            }
            
        except Exception as e:
            logger.error(f"Error in usage prediction: {e}")
            return {'success_probability': 0.8, 'confidence': 0.5}
    
    def get_usage_recommendations(self, success_prob: float) -> List[str]:
        """Get recommendations based on usage success probability"""
        recommendations = []
        
        if success_prob < 0.5:
            recommendations.extend([
                'Verify QR code validity',
                'Check network connectivity',
                'Ensure proper authentication'
            ])
        elif success_prob < 0.8:
            recommendations.extend([
                'Monitor usage closely',
                'Provide user guidance'
            ])
        else:
            recommendations.append('Normal usage expected')
        
        return recommendations
    
    def analyze_usage_patterns(self, usage_data: List[Dict]) -> Dict:
        """Analyze QR usage patterns"""
        if not usage_data:
            return {'patterns': [], 'insights': []}
        
        df = pd.DataFrame(usage_data)
        
        # Time-based patterns
        df['used_at'] = pd.to_datetime(df['used_at'])
        df['hour'] = df['used_at'].dt.hour
        df['day_of_week'] = df['used_at'].dt.dayofweek
        
        # Hourly usage pattern
        hourly_usage = df.groupby('hour').size().to_dict()
        
        # Daily usage pattern
        daily_usage = df.groupby('day_of_week').size().to_dict()
        
        # Success rate by hour
        success_by_hour = df.groupby('hour')['success'].mean().to_dict()
        
        # Location patterns
        location_usage = df['location'].value_counts().head(10).to_dict()
        
        # Generate insights
        insights = []
        
        # Peak usage hours
        peak_hour = max(hourly_usage, key=hourly_usage.get)
        insights.append(f"Peak usage hour: {peak_hour}:00")
        
        # Success rate insights
        avg_success_rate = df['success'].mean()
        insights.append(f"Overall success rate: {avg_success_rate:.1%}")
        
        # Location insights
        top_location = max(location_usage, key=location_usage.get)
        insights.append(f"Top usage location: {top_location}")
        
        return {
            'patterns': {
                'hourly_usage': hourly_usage,
                'daily_usage': daily_usage,
                'success_by_hour': success_by_hour,
                'location_usage': location_usage
            },
            'insights': insights,
            'summary': {
                'total_usage': len(df),
                'success_rate': avg_success_rate,
                'unique_users': df['used_by'].nunique(),
                'unique_locations': df['location'].nunique()
            }
        }
    
    def generate_usage_report(self, start_date: datetime, end_date: datetime) -> Dict:
        """Generate comprehensive QR usage report"""
        try:
            with self.get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    # Get usage data for the period
                    cur.execute("""
                        SELECT qu.*, qc.type, qc.purpose 
                        FROM qr_usages qu
                        JOIN qr_codes qc ON qu.qr_code_id = qc.qr_code_id
                        WHERE qu.used_at BETWEEN %s AND %s
                        ORDER BY qu.used_at DESC
                    """, (start_date, end_date))
                    
                    usage_data = [dict(row) for row in cur.fetchall()]
                    
                    if not usage_data:
                        return {'error': 'No usage data found for the specified period'}
                    
                    # Analyze patterns
                    patterns = self.analyze_usage_patterns(usage_data)
                    
                    # Detect fraud
                    fraud_cases = self.detect_fraud(usage_data)
                    
                    # Generate visualizations
                    charts = self.generate_usage_charts(usage_data)
                    
                    return {
                        'period': {
                            'start_date': start_date.isoformat(),
                            'end_date': end_date.isoformat()
                        },
                        'summary': patterns['summary'],
                        'patterns': patterns['patterns'],
                        'insights': patterns['insights'],
                        'fraud_analysis': {
                            'total_fraud_cases': len(fraud_cases),
                            'fraud_rate': len(fraud_cases) / len(usage_data) if usage_data else 0,
                            'fraud_cases': fraud_cases[:10]  # Top 10 fraud cases
                        },
                        'charts': charts,
                        'generated_at': datetime.now().isoformat()
                    }
                    
        except Exception as e:
            logger.error(f"Error generating usage report: {e}")
            return {'error': str(e)}
    
    def generate_usage_charts(self, usage_data: List[Dict]) -> Dict:
        """Generate usage visualization charts"""
        df = pd.DataFrame(usage_data)
        df['used_at'] = pd.to_datetime(df['used_at'])
        df['hour'] = df['used_at'].dt.hour
        
        charts = {}
        
        try:
            # Hourly usage chart
            hourly_data = df.groupby('hour').size().reset_index(name='count')
            fig_hourly = px.bar(hourly_data, x='hour', y='count', title='QR Usage by Hour')
            charts['hourly_usage'] = json.loads(fig_hourly.to_json())
            
            # Success rate chart
            success_data = df.groupby('hour')['success'].mean().reset_index()
            fig_success = px.line(success_data, x='hour', y='success', title='Success Rate by Hour')
            charts['success_rate'] = json.loads(fig_success.to_json())
            
            # Type distribution
            type_data = df['type'].value_counts().reset_index()
            type_data.columns = ['type', 'count']
            fig_type = px.pie(type_data, values='count', names='type', title='QR Usage by Type')
            charts['type_distribution'] = json.loads(fig_type.to_json())
            
        except Exception as e:
            logger.error(f"Error generating charts: {e}")
            charts['error'] = str(e)
        
        return charts

# Flask Application
app = Flask(__name__)
CORS(app)

# Initialize QR Analytics Engine
qr_analytics = QRAnalyticsEngine()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'qr-analytics',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/v1/detect-fraud', methods=['POST'])
def detect_fraud():
    """Detect fraudulent QR usage"""
    try:
        data = request.get_json()
        usage_data = data.get('usage_data', [])
        
        if not usage_data:
            return jsonify({'error': 'Usage data required'}), 400
        
        fraud_cases = qr_analytics.detect_fraud(usage_data)
        
        return jsonify({
            'fraud_cases': fraud_cases,
            'total_cases': len(fraud_cases),
            'fraud_rate': len(fraud_cases) / len(usage_data) if usage_data else 0
        })
        
    except Exception as e:
        logger.error(f"Error in fraud detection: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/predict-usage', methods=['POST'])
def predict_usage():
    """Predict QR usage success"""
    try:
        context = request.get_json()
        if not context:
            return jsonify({'error': 'Context required'}), 400
        
        prediction = qr_analytics.predict_usage_success(context)
        
        return jsonify({
            'prediction': prediction,
            'context': context
        })
        
    except Exception as e:
        logger.error(f"Error in usage prediction: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/analyze-patterns', methods=['POST'])
def analyze_patterns():
    """Analyze QR usage patterns"""
    try:
        data = request.get_json()
        usage_data = data.get('usage_data', [])
        
        if not usage_data:
            return jsonify({'error': 'Usage data required'}), 400
        
        patterns = qr_analytics.analyze_usage_patterns(usage_data)
        
        return jsonify(patterns)
        
    except Exception as e:
        logger.error(f"Error in pattern analysis: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/usage-report', methods=['GET'])
def get_usage_report():
    """Get comprehensive usage report"""
    try:
        # Get date range from query parameters
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        
        if not start_date_str or not end_date_str:
            # Default to last 7 days
            end_date = datetime.now()
            start_date = end_date - timedelta(days=7)
        else:
            start_date = datetime.fromisoformat(start_date_str)
            end_date = datetime.fromisoformat(end_date_str)
        
        report = qr_analytics.generate_usage_report(start_date, end_date)
        
        return jsonify(report)
        
    except Exception as e:
        logger.error(f"Error generating usage report: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/retrain', methods=['POST'])
def retrain_models():
    """Retrain ML models"""
    try:
        qr_analytics.train_models()
        return jsonify({
            'status': 'success',
            'message': 'QR Analytics models retrained successfully',
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
    port = int(os.getenv('PORT', 8093))
    
    logger.info("🚀 Starting QR Analytics Service...")
    logger.info(f"🌐 Service running on port {port}")
    logger.info(f"🔗 Health check: http://localhost:{port}/health")
    logger.info(f"📊 Metrics: http://localhost:{port}/metrics")
    
    app.run(host=os.getenv('HOST', os.getenv('HOST', '0.0.0.0')), port=port, debug=False)

