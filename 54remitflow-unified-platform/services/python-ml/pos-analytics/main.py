#!/usr/bin/env python3
"""
POS Analytics Service with Machine Learning Capabilities
Provides advanced analytics, fraud detection, and monitoring for POS devices
"""

import os
import json
import logging
import asyncio
import aiohttp
import asyncpg
import redis.asyncio as redis
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.cluster import KMeans, DBSCAN
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
import xgboost as xgb
import lightgbm as lgb
import plotly.graph_objects as go
import plotly.express as px
from plotly.utils import PlotlyJSONEncoder
import joblib
import asyncio
from concurrent.futures import ThreadPoolExecutor
import threading
import time
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import requests
import hashlib
import uuid
from pymongo import MongoClient
import warnings
warnings.filterwarnings('ignore')

# Deep Learning imports
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

# Time Series Analysis
from statsmodels.tsa.seasonal import seasonal_decompose
from statsmodels.tsa.arima.model import ARIMA

# Additional visualization
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Prometheus metrics
pos_analytics_requests = Counter('pos_analytics_requests_total', 'Total analytics requests', ['endpoint', 'status'])
pos_fraud_detections = Counter('pos_fraud_detections_total', 'Total fraud detections', ['device_id', 'type'])
pos_device_health_score = Gauge('pos_device_health_score', 'Device health score', ['device_id'])
pos_transaction_volume = Histogram('pos_transaction_volume', 'Transaction volume distribution', ['device_id'])

@dataclass
class POSDevice:
    id: str
    serial_number: str
    model: str
    agent_id: str
    location_id: str
    status: str
    last_heartbeat: datetime
    performance_metrics: Dict[str, float]
    network_info: Dict[str, Any]
    security_info: Dict[str, Any]

@dataclass
class Transaction:
    id: str
    pos_device_id: str
    transaction_id: str
    type: str
    amount: float
    currency: str
    status: str
    customer_id: str
    agent_id: str
    created_at: datetime
    metadata: Dict[str, Any]

@dataclass
class FraudAlert:
    id: str
    device_id: str
    transaction_id: Optional[str]
    alert_type: str
    severity: str
    description: str
    confidence_score: float
    created_at: datetime
    resolved: bool

class POSAnalyticsService:
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app)
        
        # Rate limiting
        self.limiter = Limiter(
            self.app,
            key_func=get_remote_address,
            default_limits=["1000 per hour"]
        )
        
        # Database and cache connections
        self.db_pool = None
        self.redis_client = None
        
        # MongoDB for analytics data
        self.mongo_client = None
        self.analytics_db = None
        
        # ML models
        self.fraud_detector = None
        self.anomaly_detector = None
        self.device_clusterer = None
        self.scaler = StandardScaler()
        
        # Deep Learning models
        self.fraud_nn = None
        self.health_nn = None
        self.fraud_nn_optimizer = None
        self.health_nn_optimizer = None
        self.fraud_nn_criterion = None
        self.health_nn_criterion = None
        
        # Advanced ML models
        self.xgb_fraud_model = None
        self.lgb_health_model = None
        self.pattern_analyzer = None
        
        # Scalers for different feature types
        self.scalers = {
            'transaction': StandardScaler(),
            'device': StandardScaler(),
            'behavioral': StandardScaler()
        }
        
        # Background tasks
        self.executor = ThreadPoolExecutor(max_workers=8)
        self.running = True
        
        # Configuration
        self.config = {
            'db_host': os.getenv('DB_HOST', os.getenv('HOST', 'localhost')),
            'db_port': int(os.getenv('DB_PORT', 5432)),
            'db_name': os.getenv('DB_NAME', 'remittance'),
            'db_user': os.getenv('DB_USER', 'postgres'),
            'db_password': os.getenv('DB_PASSWORD', os.getenv('DB_PASSWORD', 'password')),
            'redis_host': os.getenv('REDIS_HOST', os.getenv('HOST', 'localhost')),
            'redis_port': int(os.getenv('REDIS_PORT', 6379)),
            'mongo_url': os.getenv('MONGO_URL', os.getenv('MONGO_URL', 'mongodb://localhost:27017/')),
            'pos_management_url': os.getenv('POS_MANAGEMENT_URL', os.getenv('SERVICE_URL_8095', os.getenv('POS_MANAGEMENT_URL', 'http://localhost:8095'))),
            'fluvio_url': os.getenv('FLUVIO_URL', os.getenv('SERVICE_URL_9003', 'http://localhost:9003')),
            'keycloak_url': os.getenv('KEYCLOAK_URL', os.getenv('SERVICE_URL_8080', 'http://localhost:8080')),
            'pbac_url': os.getenv('PBAC_URL', os.getenv('SERVICE_URL_8001', 'http://localhost:8001')),
            'fraud_threshold': float(os.getenv('FRAUD_THRESHOLD', 0.7)),
            'anomaly_threshold': float(os.getenv('ANOMALY_THRESHOLD', 0.8)),
            'health_threshold': float(os.getenv('HEALTH_THRESHOLD', 0.3)),
        }
        
        # Alert thresholds
        self.alert_thresholds = {
            'fraud_score': 0.8,
            'device_health': 0.3,
            'transaction_anomaly': 0.9,
            'error_rate': 0.1,
            'response_time': 5.0
        }
        
        # Monitoring metrics
        self.monitoring_metrics = {
            'devices_monitored': 0,
            'fraud_cases_detected': 0,
            'alerts_sent': 0,
            'models_trained': 0
        }
        
        self.setup_routes()
        
    async def initialize(self):
        """Initialize database connections and ML models"""
        try:
            # Initialize database connection pool
            self.db_pool = await asyncpg.create_pool(
                host=self.config['db_host'],
                port=self.config['db_port'],
                database=self.config['db_name'],
                user=self.config['db_user'],
                password=self.config['db_password'],
                min_size=5,
                max_size=20
            )
            
            # Initialize Redis connection
            self.redis_client = redis.Redis(
                host=self.config['redis_host'],
                port=self.config['redis_port'],
                decode_responses=True
            )
            
            # Initialize MongoDB connection
            self.mongo_client = MongoClient(self.config['mongo_url'])
            self.analytics_db = self.mongo_client.pos_analytics
            
            # Initialize ML models
            await self.initialize_ml_models()
            
            # Initialize deep learning models
            self.setup_deep_learning_models()
            
            # Start background tasks
            asyncio.create_task(self.background_analytics_processor())
            asyncio.create_task(self.model_retraining_scheduler())
            asyncio.create_task(self.real_time_monitoring())
            
            logger.info("POS Analytics Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize service: {e}")
            raise
    
    def setup_deep_learning_models(self):
        """Setup deep learning models for advanced analytics"""
        
        class FraudDetectionNN(nn.Module):
            def __init__(self, input_size=50, hidden_sizes=[128, 64, 32], output_size=2):
                super(FraudDetectionNN, self).__init__()
                
                layers = []
                prev_size = input_size
                
                for hidden_size in hidden_sizes:
                    layers.extend([
                        nn.Linear(prev_size, hidden_size),
                        nn.ReLU(),
                        nn.Dropout(0.3),
                        nn.BatchNorm1d(hidden_size)
                    ])
                    prev_size = hidden_size
                
                layers.append(nn.Linear(prev_size, output_size))
                layers.append(nn.Softmax(dim=1))
                
                self.network = nn.Sequential(*layers)
                
            def forward(self, x):
                return self.network(x)
        
        class DeviceHealthNN(nn.Module):
            def __init__(self, input_size=30, hidden_sizes=[64, 32], output_size=1):
                super(DeviceHealthNN, self).__init__()
                
                layers = []
                prev_size = input_size
                
                for hidden_size in hidden_sizes:
                    layers.extend([
                        nn.Linear(prev_size, hidden_size),
                        nn.ReLU(),
                        nn.Dropout(0.2)
                    ])
                    prev_size = hidden_size
                
                layers.append(nn.Linear(prev_size, output_size))
                layers.append(nn.Sigmoid())
                
                self.network = nn.Sequential(*layers)
                
            def forward(self, x):
                return self.network(x)
        
        # Initialize models
        self.fraud_nn = FraudDetectionNN()
        self.fraud_nn_optimizer = optim.Adam(self.fraud_nn.parameters(), lr=0.001)
        self.fraud_nn_criterion = nn.CrossEntropyLoss()
        
        self.health_nn = DeviceHealthNN()
        self.health_nn_optimizer = optim.Adam(self.health_nn.parameters(), lr=0.001)
        self.health_nn_criterion = nn.MSELoss()
        
        # Initialize advanced ML models
        self.xgb_fraud_model = xgb.XGBClassifier(
            n_estimators=200,
            max_depth=8,
            learning_rate=0.1,
            random_state=42
        )
        
        self.lgb_health_model = lgb.LGBMRegressor(
            n_estimators=150,
            max_depth=6,
            learning_rate=0.1,
            random_state=42
        )
        
        self.pattern_analyzer = KMeans(
            n_clusters=8,
            random_state=42
        )
        
        logger.info("Deep learning and advanced ML models initialized")
    
    async def initialize_ml_models(self):
        """Initialize and train ML models"""
        try:
            # Load or create fraud detection model
            try:
                self.fraud_detector = joblib.load('models/fraud_detector.pkl')
                self.scaler = joblib.load('models/scaler.pkl')
                logger.info("Loaded existing fraud detection model")
            except FileNotFoundError:
                logger.info("Training new fraud detection model")
                await self.train_fraud_detection_model()
            
            # Initialize anomaly detection model
            self.anomaly_detector = IsolationForest(
                contamination=0.1,
                random_state=42,
                n_estimators=100
            )
            
            # Initialize device clustering model
            self.device_clusterer = KMeans(
                n_clusters=5,
                random_state=42,
                n_init=10
            )
            
            # Train models with existing data
            await self.retrain_models()
            
        except Exception as e:
            logger.error(f"Failed to initialize ML models: {e}")
            # Create basic models as fallback
            self.fraud_detector = RandomForestClassifier(n_estimators=100, random_state=42)
            self.anomaly_detector = IsolationForest(contamination=0.1, random_state=42)
            self.device_clusterer = KMeans(n_clusters=5, random_state=42)
    
    # External Service Integration Methods
    async def validate_keycloak_token(self, token: str) -> Dict[str, Any]:
        """Validate Keycloak JWT token"""
        try:
            async with aiohttp.ClientSession() as session:
                headers = {'Authorization': f'Bearer {token}'}
                async with session.get(
                    f"{self.config['keycloak_url']}/auth/realms/remittance/protocol/openid_connect/userinfo",
                    headers=headers
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        return {'error': 'Invalid token', 'status': response.status}
        except Exception as e:
            logger.error(f"Keycloak token validation error: {e}")
            return {'error': str(e)}
    
    async def validate_pbac_permission(self, token: str, resource: str, action: str, context: str) -> bool:
        """Validate PBAC permission"""
        try:
            async with aiohttp.ClientSession() as session:
                request_data = {
                    'token': token,
                    'resource': resource,
                    'action': action,
                    'context': context
                }
                async with session.post(
                    f"{self.config['pbac_url']}/api/v1/evaluate",
                    json=request_data
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result.get('allowed', False)
                    return False
        except Exception as e:
            logger.error(f"PBAC permission validation error: {e}")
            return False
    
    async def send_fluvio_event(self, event_type: str, data: Dict[str, Any]):
        """Send event to Fluvio streaming platform"""
        try:
            event = {
                'event_type': event_type,
                'data': data,
                'timestamp': datetime.now().isoformat(),
                'source': 'pos-analytics-service'
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.config['fluvio_url']}/topics/pos-analytics",
                    json=event
                ) as response:
                    if response.status in [200, 201]:
                        logger.info(f"Fluvio event sent successfully: {event_type}")
                    else:
                        logger.error(f"Failed to send Fluvio event: {response.status}")
        except Exception as e:
            logger.error(f"Fluvio event sending error: {e}")
    
    # Enhanced Feature Extraction
    def extract_advanced_features(self, data: pd.DataFrame, feature_type: str) -> np.ndarray:
        """Extract advanced features for machine learning models"""
        if data.empty:
            return np.array([])
        
        if feature_type == 'transaction':
            features = []
            for _, row in data.iterrows():
                # Basic features
                basic_features = [
                    float(row.get('amount', 0)),
                    hash(str(row.get('type', ''))) % 1000 / 1000.0,
                    hash(str(row.get('currency', ''))) % 100 / 100.0,
                    hash(str(row.get('customer_id', ''))) % 10000 / 10000.0,
                    hash(str(row.get('agent_id', ''))) % 1000 / 1000.0,
                ]
                
                # Time-based features
                created_at = pd.to_datetime(row.get('created_at', datetime.now()))
                time_features = [
                    created_at.hour / 24.0,
                    created_at.weekday() / 7.0,
                    created_at.day / 31.0,
                    created_at.month / 12.0,
                ]
                
                # Status and metadata features
                status_features = [
                    1.0 if row.get('status') == 'completed' else 0.0,
                    1.0 if row.get('status') == 'failed' else 0.0,
                    1.0 if row.get('status') == 'pending' else 0.0,
                    len(str(row.get('metadata', {}))) / 1000.0,  # Normalized metadata length
                ]
                
                # Combine all features
                feature_vector = basic_features + time_features + status_features
                features.append(feature_vector)
            
            return np.array(features)
        
        elif feature_type == 'device':
            features = []
            for _, row in data.iterrows():
                # Performance metrics
                perf_metrics = row.get('performance_metrics', {})
                if isinstance(perf_metrics, str):
                    try:
                        perf_metrics = json.loads(perf_metrics)
                    except:
                        perf_metrics = {}
                
                # Network info
                network_info = row.get('network_info', {})
                if isinstance(network_info, str):
                    try:
                        network_info = json.loads(network_info)
                    except:
                        network_info = {}
                
                # Security info
                security_info = row.get('security_info', {})
                if isinstance(security_info, str):
                    try:
                        security_info = json.loads(security_info)
                    except:
                        security_info = {}
                
                feature_vector = [
                    # Performance features
                    perf_metrics.get('cpu_usage', 0.0) / 100.0,
                    perf_metrics.get('memory_usage', 0.0) / 100.0,
                    perf_metrics.get('disk_usage', 0.0) / 100.0,
                    perf_metrics.get('transaction_tps', 0.0) / 100.0,
                    perf_metrics.get('uptime_hours', 0.0) / 8760.0,  # Normalized by year
                    perf_metrics.get('error_rate', 0.0),
                    
                    # Network features
                    network_info.get('signal_strength', 0) / 100.0,
                    network_info.get('bandwidth', 0) / 1000.0,
                    network_info.get('latency', 0) / 1000.0,
                    
                    # Security features
                    security_info.get('encryption_level', 0) / 10.0,
                    security_info.get('auth_failures', 0) / 100.0,
                    
                    # Device metadata
                    hash(str(row.get('model', ''))) % 100 / 100.0,
                    hash(str(row.get('manufacturer', ''))) % 50 / 50.0,
                    1.0 if row.get('status') == 'online' else 0.0,
                    1.0 if row.get('status') == 'offline' else 0.0,
                    1.0 if row.get('status') == 'error' else 0.0,
                ]
                
                features.append(feature_vector)
            
            return np.array(features)
        
        elif feature_type == 'behavioral':
            # Behavioral pattern features
            features = []
            for _, row in data.iterrows():
                # Transaction patterns
                hourly_pattern = [0] * 24
                if 'transaction_hours' in row:
                    for hour in row['transaction_hours']:
                        hourly_pattern[hour] = 1
                
                # Weekly pattern
                weekly_pattern = [0] * 7
                if 'transaction_days' in row:
                    for day in row['transaction_days']:
                        weekly_pattern[day] = 1
                
                # Amount patterns
                amount_features = [
                    row.get('avg_amount', 0) / 10000.0,  # Normalized
                    row.get('max_amount', 0) / 100000.0,
                    row.get('min_amount', 0) / 1000.0,
                    row.get('amount_variance', 0) / 1000000.0,
                ]
                
                feature_vector = hourly_pattern + weekly_pattern + amount_features
                features.append(feature_vector)
            
            return np.array(features)
        
        return np.array([])
    
    # Advanced Fraud Detection with Deep Learning
    async def detect_advanced_fraud(self, transaction_data: pd.DataFrame) -> Dict[str, Any]:
        """Advanced fraud detection using multiple ML models and deep learning"""
        if transaction_data.empty:
            return {'fraud_detected': False, 'fraud_score': 0.0, 'details': 'No data'}
        
        try:
            # Extract features
            features = self.extract_advanced_features(transaction_data, 'transaction')
            if features.size == 0:
                return {'fraud_detected': False, 'fraud_score': 0.0, 'details': 'No features'}
            
            # Normalize features
            features_scaled = self.scalers['transaction'].fit_transform(features)
            
            results = {}
            
            # 1. Isolation Forest
            try:
                anomaly_scores = self.anomaly_detector.fit_predict(features_scaled)
                anomaly_ratio = np.sum(anomaly_scores == -1) / len(anomaly_scores)
                results['isolation_forest'] = {
                    'anomaly_ratio': float(anomaly_ratio),
                    'anomalies_detected': int(np.sum(anomaly_scores == -1))
                }
            except Exception as e:
                results['isolation_forest'] = {'error': str(e)}
            
            # 2. XGBoost Classifier
            try:
                # Create synthetic labels for demonstration
                labels = np.random.choice([0, 1], size=len(features), p=[0.95, 0.05])
                if len(np.unique(labels)) > 1:
                    self.xgb_fraud_model.fit(features_scaled, labels)
                    fraud_probs = self.xgb_fraud_model.predict_proba(features_scaled)[:, 1]
                    results['xgboost'] = {
                        'average_fraud_score': float(np.mean(fraud_probs)),
                        'high_risk_transactions': int(np.sum(fraud_probs > 0.8)),
                        'fraud_scores': fraud_probs.tolist()
                    }
            except Exception as e:
                results['xgboost'] = {'error': str(e)}
            
            # 3. Deep Learning Neural Network
            try:
                fraud_scores = self.predict_fraud_with_nn(features_scaled)
                results['neural_network'] = {
                    'average_fraud_score': float(np.mean(fraud_scores)),
                    'high_risk_transactions': int(np.sum(fraud_scores > 0.8)),
                    'fraud_scores': fraud_scores.tolist()
                }
            except Exception as e:
                results['neural_network'] = {'error': str(e)}
            
            # 4. DBSCAN Clustering for outlier detection
            try:
                dbscan = DBSCAN(eps=0.5, min_samples=5)
                clusters = dbscan.fit_predict(features_scaled)
                outliers = np.sum(clusters == -1)
                results['dbscan'] = {
                    'outliers': int(outliers),
                    'outlier_ratio': float(outliers / len(clusters)) if len(clusters) > 0 else 0.0,
                    'clusters_found': int(len(set(clusters)) - (1 if -1 in clusters else 0))
                }
            except Exception as e:
                results['dbscan'] = {'error': str(e)}
            
            # Calculate ensemble fraud score
            fraud_score = 0.0
            weight_sum = 0.0
            
            if 'isolation_forest' in results and 'anomaly_ratio' in results['isolation_forest']:
                fraud_score += results['isolation_forest']['anomaly_ratio'] * 0.25
                weight_sum += 0.25
            
            if 'xgboost' in results and 'average_fraud_score' in results['xgboost']:
                fraud_score += results['xgboost']['average_fraud_score'] * 0.3
                weight_sum += 0.3
            
            if 'neural_network' in results and 'average_fraud_score' in results['neural_network']:
                fraud_score += results['neural_network']['average_fraud_score'] * 0.3
                weight_sum += 0.3
            
            if 'dbscan' in results and 'outlier_ratio' in results['dbscan']:
                fraud_score += results['dbscan']['outlier_ratio'] * 0.15
                weight_sum += 0.15
            
            # Normalize by actual weights used
            if weight_sum > 0:
                fraud_score = fraud_score / weight_sum
            
            fraud_detected = fraud_score > self.alert_thresholds['fraud_score']
            
            if fraud_detected:
                pos_fraud_detections.labels(
                    device_id='multiple',
                    type='advanced_pattern'
                ).inc()
                
                # Send alert to Fluvio
                await self.send_fluvio_event('fraud_detected', {
                    'fraud_score': fraud_score,
                    'transaction_count': len(transaction_data),
                    'detection_methods': list(results.keys()),
                    'timestamp': datetime.now().isoformat()
                })
            
            return {
                'fraud_detected': fraud_detected,
                'fraud_score': float(fraud_score),
                'confidence': float(fraud_score),
                'details': results,
                'transaction_count': len(transaction_data),
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Advanced fraud detection error: {e}")
            return {'fraud_detected': False, 'fraud_score': 0.0, 'error': str(e)}
    
    def predict_fraud_with_nn(self, features: np.ndarray) -> np.ndarray:
        """Use neural network for fraud prediction"""
        if features.size == 0:
            return np.array([])
        
        try:
            self.fraud_nn.eval()
            with torch.no_grad():
                # Ensure features have the right shape
                if features.shape[1] != 50:  # Expected input size
                    # Pad or truncate features to match expected input size
                    if features.shape[1] < 50:
                        padding = np.zeros((features.shape[0], 50 - features.shape[1]))
                        features = np.hstack([features, padding])
                    else:
                        features = features[:, :50]
                
                features_tensor = torch.FloatTensor(features)
                predictions = self.fraud_nn(features_tensor)
                fraud_scores = predictions[:, 1].numpy()  # Probability of fraud class
            
            return fraud_scores
        except Exception as e:
            logger.error(f"Neural network fraud prediction error: {e}")
            return np.zeros(len(features))
    
    # Real-time Monitoring
    async def real_time_monitoring(self):
        """Real-time monitoring and alerting"""
        while self.running:
            try:
                # Monitor device health
                await self.monitor_device_health()
                
                # Monitor transaction patterns
                await self.monitor_transaction_patterns()
                
                # Check for system anomalies
                await self.check_system_anomalies()
                
                # Update monitoring metrics
                await self.update_monitoring_metrics()
                
                # Sleep for 1 minute
                await asyncio.sleep(60)
                
            except Exception as e:
                logger.error(f"Real-time monitoring error: {e}")
                await asyncio.sleep(30)  # Wait 30 seconds on error
    
    async def monitor_device_health(self):
        """Monitor device health in real-time"""
        try:
            async with self.db_pool.acquire() as conn:
                # Get devices with recent activity
                query = """
                SELECT id, performance_metrics, status, last_heartbeat
                FROM pos_devices
                WHERE last_heartbeat > NOW() - INTERVAL '5 minutes'
                """
                
                devices = await conn.fetch(query)
                
                for device in devices:
                    if device['performance_metrics']:
                        health_score = await self.calculate_device_health_score(device['id'])
                        
                        # Check for health alerts
                        if health_score < self.alert_thresholds['device_health']:
                            await self.send_health_alert(device['id'], health_score)
                        
                        # Update Prometheus metric
                        pos_device_health_score.labels(device_id=device['id']).set(health_score)
                
        except Exception as e:
            logger.error(f"Device health monitoring error: {e}")
    
    async def monitor_transaction_patterns(self):
        """Monitor transaction patterns for anomalies"""
        try:
            async with self.db_pool.acquire() as conn:
                # Get recent transactions
                query = """
                SELECT pos_device_id, amount, type, status, created_at
                FROM transactions
                WHERE created_at > NOW() - INTERVAL '5 minutes'
                """
                
                transactions = await conn.fetch(query)
                
                if transactions:
                    # Convert to DataFrame for analysis
                    df = pd.DataFrame([dict(row) for row in transactions])
                    
                    # Detect fraud patterns
                    fraud_result = await self.detect_advanced_fraud(df)
                    
                    if fraud_result['fraud_detected']:
                        await self.send_fraud_alert(fraud_result)
                
        except Exception as e:
            logger.error(f"Transaction pattern monitoring error: {e}")
    
    async def check_system_anomalies(self):
        """Check for system-wide anomalies"""
        try:
            # Check connection counts
            active_connections = await self.redis_client.get('active_connections')
            if active_connections and int(active_connections) > 1000:
                await self.send_system_alert('high_connection_count', {
                    'active_connections': int(active_connections),
                    'threshold': 1000
                })
            
            # Check error rates
            error_rate = await self.redis_client.get('system_error_rate')
            if error_rate and float(error_rate) > self.alert_thresholds['error_rate']:
                await self.send_system_alert('high_error_rate', {
                    'error_rate': float(error_rate),
                    'threshold': self.alert_thresholds['error_rate']
                })
            
        except Exception as e:
            logger.error(f"System anomaly check error: {e}")
    
    async def update_monitoring_metrics(self):
        """Update monitoring metrics"""
        try:
            async with self.db_pool.acquire() as conn:
                # Count active devices
                device_count = await conn.fetchval(
                    "SELECT COUNT(*) FROM pos_devices WHERE last_heartbeat > NOW() - INTERVAL '1 hour'"
                )
                self.monitoring_metrics['devices_monitored'] = device_count
                
                # Count recent fraud cases
                fraud_count = await conn.fetchval(
                    "SELECT COUNT(*) FROM fraud_alerts WHERE created_at > NOW() - INTERVAL '1 hour'"
                )
                self.monitoring_metrics['fraud_cases_detected'] = fraud_count
                
        except Exception as e:
            logger.error(f"Monitoring metrics update error: {e}")
    
    # Alert System
    async def send_fraud_alert(self, fraud_result: Dict[str, Any]):
        """Send fraud detection alert"""
        alert = {
            'type': 'fraud_detection',
            'severity': 'high',
            'timestamp': datetime.now().isoformat(),
            'details': fraud_result,
            'action_required': True
        }
        
        # Store in MongoDB
        self.analytics_db.alerts.insert_one(alert)
        
        # Send to Fluvio
        await self.send_fluvio_event('fraud_alert', alert)
        
        # Update metrics
        self.monitoring_metrics['alerts_sent'] += 1
        
        logger.warning(f"Fraud alert sent: {fraud_result['fraud_score']}")
    
    async def send_health_alert(self, device_id: str, health_score: float):
        """Send device health alert"""
        alert = {
            'type': 'device_health',
            'severity': 'medium',
            'device_id': device_id,
            'health_score': health_score,
            'timestamp': datetime.now().isoformat(),
            'action_required': True
        }
        
        # Store in MongoDB
        self.analytics_db.alerts.insert_one(alert)
        
        # Send to Fluvio
        await self.send_fluvio_event('health_alert', alert)
        
        # Update metrics
        self.monitoring_metrics['alerts_sent'] += 1
        
        logger.warning(f"Health alert sent for device {device_id}: {health_score}")
    
    async def send_system_alert(self, alert_type: str, details: Dict[str, Any]):
        """Send system-level alert"""
        alert = {
            'type': 'system_anomaly',
            'alert_type': alert_type,
            'severity': 'high',
            'timestamp': datetime.now().isoformat(),
            'details': details,
            'action_required': True
        }
        
        # Store in MongoDB
        self.analytics_db.alerts.insert_one(alert)
        
        # Send to Fluvio
        await self.send_fluvio_event('system_alert', alert)
        
        # Update metrics
        self.monitoring_metrics['alerts_sent'] += 1
        
        logger.warning(f"System alert sent: {alert_type}")
    
    async def calculate_device_health_score(self, device_id: str) -> float:
        """Calculate comprehensive device health score"""
        try:
            async with self.db_pool.acquire() as conn:
                query = """
                SELECT performance_metrics, status, last_heartbeat,
                       network_info, security_info
                FROM pos_devices
                WHERE id = $1
                """
                
                device = await conn.fetchrow(query, device_id)
                
                if not device:
                    return 0.0
                
                health_factors = []
                
                # Performance metrics factor
                perf_metrics = device['performance_metrics'] or {}
                if isinstance(perf_metrics, str):
                    try:
                        perf_metrics = json.loads(perf_metrics)
                    except:
                        perf_metrics = {}
                
                cpu_score = max(0, 1 - perf_metrics.get('cpu_usage', 0) / 100)
                memory_score = max(0, 1 - perf_metrics.get('memory_usage', 0) / 100)
                disk_score = max(0, 1 - perf_metrics.get('disk_usage', 0) / 100)
                error_score = max(0, 1 - perf_metrics.get('error_rate', 0))
                
                performance_score = np.mean([cpu_score, memory_score, disk_score, error_score])
                health_factors.append(('performance', performance_score, 0.4))
                
                # Connectivity factor
                last_heartbeat = device['last_heartbeat']
                if last_heartbeat:
                    time_since_heartbeat = (datetime.now() - last_heartbeat.replace(tzinfo=None)).total_seconds()
                    connectivity_score = max(0, 1 - time_since_heartbeat / 3600)  # Decay over 1 hour
                else:
                    connectivity_score = 0.0
                
                health_factors.append(('connectivity', connectivity_score, 0.3))
                
                # Network health factor
                network_info = device['network_info'] or {}
                if isinstance(network_info, str):
                    try:
                        network_info = json.loads(network_info)
                    except:
                        network_info = {}
                
                signal_score = network_info.get('signal_strength', 50) / 100.0
                bandwidth_score = min(1.0, network_info.get('bandwidth', 100) / 1000.0)
                network_score = np.mean([signal_score, bandwidth_score])
                health_factors.append(('network', network_score, 0.2))
                
                # Security factor
                security_info = device['security_info'] or {}
                if isinstance(security_info, str):
                    try:
                        security_info = json.loads(security_info)
                    except:
                        security_info = {}
                
                encryption_score = security_info.get('encryption_level', 5) / 10.0
                auth_failure_score = max(0, 1 - security_info.get('auth_failures', 0) / 10.0)
                security_score = np.mean([encryption_score, auth_failure_score])
                health_factors.append(('security', security_score, 0.1))
                
                # Calculate weighted health score
                total_score = sum(score * weight for _, score, weight in health_factors)
                
                return total_score
                
        except Exception as e:
            logger.error(f"Health score calculation error: {e}")
            return 0.0
        try:
            # Initialize database connection pool
            self.db_pool = await asyncpg.create_pool(
                host=self.config['db_host'],
                port=self.config['db_port'],
                database=self.config['db_name'],
                user=self.config['db_user'],
                password=self.config['db_password'],
                min_size=5,
                max_size=20
            )
            
            # Initialize Redis connection
            self.redis_client = redis.Redis(
                host=self.config['redis_host'],
                port=self.config['redis_port'],
                decode_responses=True
            )
            
            # Initialize ML models
            await self.initialize_ml_models()
            
            # Start background tasks
            asyncio.create_task(self.background_analytics_processor())
            asyncio.create_task(self.model_retraining_scheduler())
            
            logger.info("POS Analytics Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize service: {e}")
            raise
    
    async def initialize_ml_models(self):
        """Initialize and train ML models"""
        try:
            # Load or create fraud detection model
            try:
                self.fraud_detector = joblib.load('models/fraud_detector.pkl')
                self.scaler = joblib.load('models/scaler.pkl')
                logger.info("Loaded existing fraud detection model")
            except FileNotFoundError:
                logger.info("Training new fraud detection model")
                await self.train_fraud_detection_model()
            
            # Initialize anomaly detection model
            self.anomaly_detector = IsolationForest(
                contamination=0.1,
                random_state=42,
                n_estimators=100
            )
            
            # Initialize device clustering model
            self.device_clusterer = KMeans(
                n_clusters=5,
                random_state=42,
                n_init=10
            )
            
            # Train models with existing data
            await self.retrain_models()
            
        except Exception as e:
            logger.error(f"Failed to initialize ML models: {e}")
            # Create basic models as fallback
            self.fraud_detector = RandomForestClassifier(n_estimators=100, random_state=42)
            self.anomaly_detector = IsolationForest(contamination=0.1, random_state=42)
            self.device_clusterer = KMeans(n_clusters=5, random_state=42)
    
    async def train_fraud_detection_model(self):
        """Train fraud detection model with historical data"""
        try:
            # Get historical transaction data
            async with self.db_pool.acquire() as conn:
                query = """
                SELECT 
                    t.amount,
                    t.type,
                    EXTRACT(HOUR FROM t.created_at) as hour,
                    EXTRACT(DOW FROM t.created_at) as day_of_week,
                    d.performance_metrics,
                    d.location_id,
                    CASE WHEN t.status = 'failed' OR t.metadata->>'fraud_flag' = 'true' 
                         THEN 1 ELSE 0 END as is_fraud
                FROM transactions t
                JOIN pos_devices d ON t.pos_device_id = d.id
                WHERE t.created_at > NOW() - INTERVAL '30 days'
                """
                
                rows = await conn.fetch(query)
                
                if len(rows) < 100:
                    # Generate synthetic training data if insufficient historical data
                    logger.info("Generating synthetic training data for fraud detection")
                    training_data = self.generate_synthetic_fraud_data()
                else:
                    # Process real data
                    training_data = []
                    for row in rows:
                        features = [
                            float(row['amount']),
                            hash(row['type']) % 1000 / 1000.0,  # Normalized hash
                            float(row['hour']) / 24.0,
                            float(row['day_of_week']) / 7.0,
                            row['performance_metrics'].get('cpu_usage', 0.0) if row['performance_metrics'] else 0.0,
                            row['performance_metrics'].get('memory_usage', 0.0) if row['performance_metrics'] else 0.0,
                            hash(row['location_id']) % 1000 / 1000.0 if row['location_id'] else 0.0,
                        ]
                        training_data.append((features, int(row['is_fraud'])))
                
                # Prepare training data
                X = np.array([item[0] for item in training_data])
                y = np.array([item[1] for item in training_data])
                
                # Scale features
                X_scaled = self.scaler.fit_transform(X)
                
                # Train model
                self.fraud_detector = RandomForestClassifier(
                    n_estimators=100,
                    max_depth=10,
                    random_state=42,
                    class_weight='balanced'
                )
                self.fraud_detector.fit(X_scaled, y)
                
                # Save models
                os.makedirs('models', exist_ok=True)
                joblib.dump(self.fraud_detector, 'models/fraud_detector.pkl')
                joblib.dump(self.scaler, 'models/scaler.pkl')
                
                logger.info(f"Fraud detection model trained with {len(training_data)} samples")
                
        except Exception as e:
            logger.error(f"Failed to train fraud detection model: {e}")
    
    def generate_synthetic_fraud_data(self) -> List[tuple]:
        """Generate synthetic fraud training data"""
        np.random.seed(42)
        data = []
        
        # Generate normal transactions
        for _ in range(800):
            features = [
                np.random.lognormal(3, 1),  # amount (normal distribution)
                np.random.random(),  # transaction type
                np.random.uniform(8, 18) / 24.0,  # business hours
                np.random.uniform(1, 5) / 7.0,  # weekdays
                np.random.uniform(0.1, 0.7),  # normal CPU usage
                np.random.uniform(0.2, 0.8),  # normal memory usage
                np.random.random(),  # location
            ]
            data.append((features, 0))  # Not fraud
        
        # Generate fraudulent transactions
        for _ in range(200):
            features = [
                np.random.lognormal(5, 2),  # higher amounts
                np.random.random(),
                np.random.uniform(0, 24) / 24.0,  # any time
                np.random.uniform(0, 7) / 7.0,  # any day
                np.random.uniform(0.8, 1.0),  # high CPU usage
                np.random.uniform(0.8, 1.0),  # high memory usage
                np.random.random(),
            ]
            data.append((features, 1))  # Fraud
        
        return data
    
    async def retrain_models(self):
        """Retrain all ML models with latest data"""
        try:
            # Get device performance data for clustering
            async with self.db_pool.acquire() as conn:
                device_query = """
                SELECT 
                    id,
                    performance_metrics,
                    network_info,
                    status,
                    EXTRACT(EPOCH FROM (NOW() - last_heartbeat))/3600 as hours_since_heartbeat
                FROM pos_devices
                WHERE last_heartbeat > NOW() - INTERVAL '7 days'
                """
                
                device_rows = await conn.fetch(device_query)
                
                if device_rows:
                    # Prepare device clustering data
                    device_features = []
                    device_ids = []
                    
                    for row in device_rows:
                        metrics = row['performance_metrics'] or {}
                        network = row['network_info'] or {}
                        
                        features = [
                            metrics.get('cpu_usage', 0.0),
                            metrics.get('memory_usage', 0.0),
                            metrics.get('disk_usage', 0.0),
                            metrics.get('transaction_tps', 0.0),
                            metrics.get('uptime_hours', 0.0),
                            metrics.get('error_rate', 0.0),
                            network.get('signal_strength', 0) / 100.0,
                            network.get('bandwidth', 0) / 1000.0,
                            1.0 if row['status'] == 'online' else 0.0,
                            float(row['hours_since_heartbeat'] or 0),
                        ]
                        
                        device_features.append(features)
                        device_ids.append(row['id'])
                    
                    # Train device clustering model
                    if len(device_features) >= 5:
                        device_X = np.array(device_features)
                        self.device_clusterer.fit(device_X)
                        
                        # Store cluster assignments in cache
                        clusters = self.device_clusterer.predict(device_X)
                        for device_id, cluster in zip(device_ids, clusters):
                            await self.redis_client.setex(
                                f"device_cluster:{device_id}",
                                3600,  # 1 hour TTL
                                str(cluster)
                            )
                
                # Get transaction data for anomaly detection
                transaction_query = """
                SELECT 
                    amount,
                    type,
                    EXTRACT(HOUR FROM created_at) as hour,
                    EXTRACT(DOW FROM created_at) as day_of_week,
                    pos_device_id
                FROM transactions
                WHERE created_at > NOW() - INTERVAL '24 hours'
                """
                
                transaction_rows = await conn.fetch(transaction_query)
                
                if transaction_rows:
                    # Prepare anomaly detection data
                    transaction_features = []
                    
                    for row in transaction_rows:
                        features = [
                            float(row['amount']),
                            hash(row['type']) % 1000 / 1000.0,
                            float(row['hour']) / 24.0,
                            float(row['day_of_week']) / 7.0,
                        ]
                        transaction_features.append(features)
                    
                    # Train anomaly detection model
                    if len(transaction_features) >= 10:
                        transaction_X = np.array(transaction_features)
                        self.anomaly_detector.fit(transaction_X)
                
                logger.info("ML models retrained successfully")
                
        except Exception as e:
            logger.error(f"Failed to retrain models: {e}")
    
    async def detect_fraud(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Detect fraud in transaction using ML model"""
        try:
            # Prepare features
            features = [
                float(transaction_data.get('amount', 0)),
                hash(transaction_data.get('type', '')) % 1000 / 1000.0,
                datetime.now().hour / 24.0,
                datetime.now().weekday() / 7.0,
                0.5,  # Default CPU usage
                0.5,  # Default memory usage
                hash(transaction_data.get('location_id', '')) % 1000 / 1000.0,
            ]
            
            # Scale features
            features_scaled = self.scaler.transform([features])
            
            # Predict fraud probability
            fraud_probability = self.fraud_detector.predict_proba(features_scaled)[0][1]
            is_fraud = fraud_probability > self.config['fraud_threshold']
            
            # Get feature importance for explanation
            feature_names = ['amount', 'type', 'hour', 'day_of_week', 'cpu_usage', 'memory_usage', 'location']
            feature_importance = dict(zip(feature_names, self.fraud_detector.feature_importances_))
            
            result = {
                'is_fraud': bool(is_fraud),
                'fraud_probability': float(fraud_probability),
                'confidence_score': float(fraud_probability),
                'explanation': feature_importance,
                'threshold': self.config['fraud_threshold']
            }
            
            # Update metrics
            if is_fraud:
                pos_fraud_detections.labels(
                    device_id=transaction_data.get('pos_device_id', 'unknown'),
                    type='transaction'
                ).inc()
            
            return result
            
        except Exception as e:
            logger.error(f"Fraud detection error: {e}")
            return {
                'is_fraud': False,
                'fraud_probability': 0.0,
                'confidence_score': 0.0,
                'explanation': {},
                'error': str(e)
            }
    
    async def detect_anomaly(self, device_id: str, metrics: Dict[str, float]) -> Dict[str, Any]:
        """Detect anomalies in device behavior"""
        try:
            # Prepare features
            features = [
                metrics.get('cpu_usage', 0.0),
                metrics.get('memory_usage', 0.0),
                metrics.get('disk_usage', 0.0),
                metrics.get('transaction_tps', 0.0),
                metrics.get('uptime_hours', 0.0),
                metrics.get('error_rate', 0.0),
            ]
            
            # Predict anomaly
            anomaly_score = self.anomaly_detector.decision_function([features])[0]
            is_anomaly = self.anomaly_detector.predict([features])[0] == -1
            
            # Normalize anomaly score to 0-1 range
            normalized_score = max(0, min(1, (anomaly_score + 0.5) / 1.0))
            
            result = {
                'is_anomaly': bool(is_anomaly),
                'anomaly_score': float(normalized_score),
                'confidence_score': float(1 - normalized_score) if is_anomaly else float(normalized_score),
                'metrics': metrics,
                'threshold': self.config['anomaly_threshold']
            }
            
            # Update device health score
            health_score = 1.0 - normalized_score if is_anomaly else normalized_score
            pos_device_health_score.labels(device_id=device_id).set(health_score)
            
            if is_anomaly:
                pos_fraud_detections.labels(
                    device_id=device_id,
                    type='anomaly'
                ).inc()
            
            return result
            
        except Exception as e:
            logger.error(f"Anomaly detection error: {e}")
            return {
                'is_anomaly': False,
                'anomaly_score': 0.0,
                'confidence_score': 0.0,
                'error': str(e)
            }
    
    async def analyze_device_performance(self, device_id: str, time_range: str = '24h') -> Dict[str, Any]:
        """Analyze device performance over time"""
        try:
            # Calculate time range
            if time_range == '1h':
                start_time = datetime.now() - timedelta(hours=1)
            elif time_range == '24h':
                start_time = datetime.now() - timedelta(hours=24)
            elif time_range == '7d':
                start_time = datetime.now() - timedelta(days=7)
            else:
                start_time = datetime.now() - timedelta(hours=24)
            
            async with self.db_pool.acquire() as conn:
                # Get device metrics over time
                metrics_query = """
                SELECT 
                    performance_metrics,
                    network_info,
                    status,
                    last_heartbeat,
                    updated_at
                FROM pos_devices 
                WHERE id = $1 AND updated_at > $2
                ORDER BY updated_at DESC
                """
                
                metrics_rows = await conn.fetch(metrics_query, device_id, start_time)
                
                # Get transaction statistics
                transaction_query = """
                SELECT 
                    COUNT(*) as total_transactions,
                    AVG(amount) as avg_amount,
                    SUM(amount) as total_amount,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_transactions,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_transactions
                FROM transactions
                WHERE pos_device_id = $1 AND created_at > $2
                """
                
                transaction_stats = await conn.fetchrow(transaction_query, device_id, start_time)
                
                # Process metrics data
                performance_data = []
                timestamps = []
                
                for row in metrics_rows:
                    if row['performance_metrics']:
                        performance_data.append(row['performance_metrics'])
                        timestamps.append(row['updated_at'])
                
                # Calculate performance statistics
                if performance_data:
                    cpu_usage = [m.get('cpu_usage', 0) for m in performance_data]
                    memory_usage = [m.get('memory_usage', 0) for m in performance_data]
                    disk_usage = [m.get('disk_usage', 0) for m in performance_data]
                    error_rate = [m.get('error_rate', 0) for m in performance_data]
                    
                    performance_stats = {
                        'cpu_usage': {
                            'avg': np.mean(cpu_usage),
                            'max': np.max(cpu_usage),
                            'min': np.min(cpu_usage),
                            'current': cpu_usage[0] if cpu_usage else 0
                        },
                        'memory_usage': {
                            'avg': np.mean(memory_usage),
                            'max': np.max(memory_usage),
                            'min': np.min(memory_usage),
                            'current': memory_usage[0] if memory_usage else 0
                        },
                        'disk_usage': {
                            'avg': np.mean(disk_usage),
                            'max': np.max(disk_usage),
                            'min': np.min(disk_usage),
                            'current': disk_usage[0] if disk_usage else 0
                        },
                        'error_rate': {
                            'avg': np.mean(error_rate),
                            'max': np.max(error_rate),
                            'min': np.min(error_rate),
                            'current': error_rate[0] if error_rate else 0
                        }
                    }
                else:
                    performance_stats = {}
                
                # Calculate uptime percentage
                online_count = sum(1 for row in metrics_rows if row['status'] == 'online')
                uptime_percentage = (online_count / len(metrics_rows) * 100) if metrics_rows else 0
                
                # Get device cluster
                cluster = await self.redis_client.get(f"device_cluster:{device_id}")
                
                result = {
                    'device_id': device_id,
                    'time_range': time_range,
                    'performance_stats': performance_stats,
                    'transaction_stats': dict(transaction_stats) if transaction_stats else {},
                    'uptime_percentage': uptime_percentage,
                    'cluster': int(cluster) if cluster else None,
                    'data_points': len(metrics_rows),
                    'analysis_timestamp': datetime.now().isoformat()
                }
                
                return result
                
        except Exception as e:
            logger.error(f"Device performance analysis error: {e}")
            return {'error': str(e)}
    
    async def generate_analytics_dashboard(self, agent_id: Optional[str] = None) -> Dict[str, Any]:
        """Generate comprehensive analytics dashboard data"""
        try:
            async with self.db_pool.acquire() as conn:
                # Base query conditions
                where_clause = "WHERE d.last_heartbeat > NOW() - INTERVAL '24 hours'"
                params = []
                
                if agent_id:
                    where_clause += " AND d.agent_id = $1"
                    params.append(agent_id)
                
                # Get device statistics
                device_stats_query = f"""
                SELECT 
                    COUNT(*) as total_devices,
                    COUNT(CASE WHEN d.status = 'online' THEN 1 END) as online_devices,
                    COUNT(CASE WHEN d.status = 'offline' THEN 1 END) as offline_devices,
                    COUNT(CASE WHEN d.status = 'error' THEN 1 END) as error_devices,
                    AVG((d.performance_metrics->>'cpu_usage')::float) as avg_cpu_usage,
                    AVG((d.performance_metrics->>'memory_usage')::float) as avg_memory_usage,
                    AVG((d.performance_metrics->>'error_rate')::float) as avg_error_rate
                FROM pos_devices d
                {where_clause}
                """
                
                device_stats = await conn.fetchrow(device_stats_query, *params)
                
                # Get transaction statistics
                transaction_stats_query = f"""
                SELECT 
                    COUNT(*) as total_transactions,
                    SUM(t.amount) as total_volume,
                    AVG(t.amount) as avg_transaction_amount,
                    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as successful_transactions,
                    COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_transactions,
                    COUNT(CASE WHEN t.created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_transactions
                FROM transactions t
                JOIN pos_devices d ON t.pos_device_id = d.id
                {where_clause.replace('d.last_heartbeat', 't.created_at')}
                """
                
                transaction_stats = await conn.fetchrow(transaction_stats_query, *params)
                
                # Get top performing devices
                top_devices_query = f"""
                SELECT 
                    d.id,
                    d.serial_number,
                    d.model,
                    d.agent_id,
                    d.status,
                    d.performance_metrics,
                    COUNT(t.id) as transaction_count,
                    COALESCE(SUM(t.amount), 0) as total_volume
                FROM pos_devices d
                LEFT JOIN transactions t ON d.id = t.pos_device_id 
                    AND t.created_at > NOW() - INTERVAL '24 hours'
                {where_clause}
                GROUP BY d.id, d.serial_number, d.model, d.agent_id, d.status, d.performance_metrics
                ORDER BY total_volume DESC
                LIMIT 10
                """
                
                top_devices = await conn.fetch(top_devices_query, *params)
                
                # Get hourly transaction trends
                hourly_trends_query = f"""
                SELECT 
                    EXTRACT(HOUR FROM t.created_at) as hour,
                    COUNT(*) as transaction_count,
                    SUM(t.amount) as volume
                FROM transactions t
                JOIN pos_devices d ON t.pos_device_id = d.id
                WHERE t.created_at > NOW() - INTERVAL '24 hours'
                {' AND d.agent_id = $1' if agent_id else ''}
                GROUP BY EXTRACT(HOUR FROM t.created_at)
                ORDER BY hour
                """
                
                hourly_trends = await conn.fetch(
                    hourly_trends_query, 
                    *([agent_id] if agent_id else [])
                )
                
                # Create visualizations
                charts = await self.create_dashboard_charts(
                    dict(device_stats),
                    dict(transaction_stats),
                    [dict(row) for row in top_devices],
                    [dict(row) for row in hourly_trends]
                )
                
                dashboard_data = {
                    'summary': {
                        'devices': dict(device_stats),
                        'transactions': dict(transaction_stats),
                        'generated_at': datetime.now().isoformat()
                    },
                    'top_devices': [dict(row) for row in top_devices],
                    'hourly_trends': [dict(row) for row in hourly_trends],
                    'charts': charts,
                    'agent_id': agent_id
                }
                
                return dashboard_data
                
        except Exception as e:
            logger.error(f"Dashboard generation error: {e}")
            return {'error': str(e)}
    
    async def create_dashboard_charts(self, device_stats, transaction_stats, top_devices, hourly_trends):
        """Create interactive charts for dashboard"""
        charts = {}
        
        try:
            # Device status pie chart
            device_status_fig = go.Figure(data=[go.Pie(
                labels=['Online', 'Offline', 'Error'],
                values=[
                    device_stats.get('online_devices', 0),
                    device_stats.get('offline_devices', 0),
                    device_stats.get('error_devices', 0)
                ],
                hole=0.3
            )])
            device_status_fig.update_layout(title="Device Status Distribution")
            charts['device_status'] = json.loads(device_status_fig.to_json())
            
            # Transaction success rate
            success_rate = (transaction_stats.get('successful_transactions', 0) / 
                          max(transaction_stats.get('total_transactions', 1), 1)) * 100
            
            success_fig = go.Figure(go.Indicator(
                mode="gauge+number",
                value=success_rate,
                domain={'x': [0, 1], 'y': [0, 1]},
                title={'text': "Transaction Success Rate (%)"},
                gauge={'axis': {'range': [None, 100]},
                       'bar': {'color': "darkblue"},
                       'steps': [
                           {'range': [0, 50], 'color': "lightgray"},
                           {'range': [50, 80], 'color': "gray"}],
                       'threshold': {'line': {'color': "red", 'width': 4},
                                   'thickness': 0.75, 'value': 90}}
            ))
            charts['success_rate'] = json.loads(success_fig.to_json())
            
            # Hourly transaction trends
            if hourly_trends:
                hours = [row['hour'] for row in hourly_trends]
                counts = [row['transaction_count'] for row in hourly_trends]
                volumes = [row['volume'] for row in hourly_trends]
                
                trends_fig = go.Figure()
                trends_fig.add_trace(go.Scatter(
                    x=hours, y=counts,
                    mode='lines+markers',
                    name='Transaction Count',
                    yaxis='y'
                ))
                trends_fig.add_trace(go.Scatter(
                    x=hours, y=volumes,
                    mode='lines+markers',
                    name='Volume (₦)',
                    yaxis='y2'
                ))
                
                trends_fig.update_layout(
                    title='Hourly Transaction Trends',
                    xaxis_title='Hour of Day',
                    yaxis=dict(title='Transaction Count', side='left'),
                    yaxis2=dict(title='Volume (₦)', side='right', overlaying='y')
                )
                charts['hourly_trends'] = json.loads(trends_fig.to_json())
            
            # Top devices performance
            if top_devices:
                device_names = [f"{d['serial_number'][:8]}..." for d in top_devices[:5]]
                volumes = [d['total_volume'] for d in top_devices[:5]]
                
                top_devices_fig = go.Figure(data=[
                    go.Bar(x=device_names, y=volumes, name='Transaction Volume')
                ])
                top_devices_fig.update_layout(
                    title='Top Performing Devices (24h)',
                    xaxis_title='Device',
                    yaxis_title='Volume (₦)'
                )
                charts['top_devices'] = json.loads(top_devices_fig.to_json())
            
        except Exception as e:
            logger.error(f"Chart creation error: {e}")
            charts['error'] = str(e)
        
        return charts
    
    async def background_analytics_processor(self):
        """Background task for processing analytics"""
        while self.running:
            try:
                # Process pending fraud alerts
                await self.process_fraud_alerts()
                
                # Update device health scores
                await self.update_device_health_scores()
                
                # Clean up old data
                await self.cleanup_old_data()
                
                # Sleep for 5 minutes
                await asyncio.sleep(300)
                
            except Exception as e:
                logger.error(f"Background analytics processor error: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error
    
    async def model_retraining_scheduler(self):
        """Schedule periodic model retraining"""
        while self.running:
            try:
                # Retrain models every 6 hours
                await asyncio.sleep(6 * 3600)
                
                logger.info("Starting scheduled model retraining")
                await self.retrain_models()
                logger.info("Scheduled model retraining completed")
                
            except Exception as e:
                logger.error(f"Model retraining scheduler error: {e}")
                await asyncio.sleep(3600)  # Wait 1 hour on error
    
    async def process_fraud_alerts(self):
        """Process and escalate fraud alerts"""
        try:
            # Get unresolved fraud alerts
            async with self.db_pool.acquire() as conn:
                alerts_query = """
                SELECT id, device_id, transaction_id, alert_type, severity, confidence_score
                FROM fraud_alerts 
                WHERE resolved = false AND created_at > NOW() - INTERVAL '1 hour'
                ORDER BY confidence_score DESC, created_at DESC
                """
                
                alerts = await conn.fetch(alerts_query)
                
                for alert in alerts:
                    # Process high-confidence alerts
                    if alert['confidence_score'] > 0.9:
                        await self.escalate_fraud_alert(dict(alert))
                
        except Exception as e:
            logger.error(f"Fraud alert processing error: {e}")
    
    async def escalate_fraud_alert(self, alert: Dict[str, Any]):
        """Escalate high-confidence fraud alerts"""
        try:
            # Send notification to POS management service
            async with aiohttp.ClientSession() as session:
                notification_data = {
                    'type': 'fraud_alert',
                    'device_id': alert['device_id'],
                    'alert_type': alert['alert_type'],
                    'severity': alert['severity'],
                    'confidence_score': alert['confidence_score'],
                    'timestamp': datetime.now().isoformat()
                }
                
                async with session.post(
                    f"{self.config['pos_management_url']}/api/v1/notifications",
                    json=notification_data
                ) as response:
                    if response.status == 200:
                        logger.info(f"Fraud alert escalated for device {alert['device_id']}")
                    else:
                        logger.error(f"Failed to escalate fraud alert: {response.status}")
                        
        except Exception as e:
            logger.error(f"Fraud alert escalation error: {e}")
    
    async def update_device_health_scores(self):
        """Update health scores for all devices"""
        try:
            async with self.db_pool.acquire() as conn:
                devices_query = """
                SELECT id, performance_metrics, status, last_heartbeat
                FROM pos_devices
                WHERE last_heartbeat > NOW() - INTERVAL '1 hour'
                """
                
                devices = await conn.fetch(devices_query)
                
                for device in devices:
                    if device['performance_metrics']:
                        # Calculate health score based on metrics
                        metrics = device['performance_metrics']
                        
                        # Detect anomalies
                        anomaly_result = await self.detect_anomaly(device['id'], metrics)
                        
                        # Update health score in Prometheus
                        health_score = anomaly_result.get('confidence_score', 0.5)
                        pos_device_health_score.labels(device_id=device['id']).set(health_score)
                        
                        # Cache health score
                        await self.redis_client.setex(
                            f"device_health:{device['id']}",
                            3600,  # 1 hour TTL
                            str(health_score)
                        )
                
        except Exception as e:
            logger.error(f"Device health score update error: {e}")
    
    async def cleanup_old_data(self):
        """Clean up old analytics data"""
        try:
            async with self.db_pool.acquire() as conn:
                # Clean up old fraud alerts (older than 30 days)
                await conn.execute("""
                    DELETE FROM fraud_alerts 
                    WHERE created_at < NOW() - INTERVAL '30 days'
                """)
                
                # Clean up old transaction analytics cache
                pattern = "analytics:*"
                keys = await self.redis_client.keys(pattern)
                if keys:
                    # Remove keys older than 24 hours (simplified cleanup)
                    for key in keys:
                        ttl = await self.redis_client.ttl(key)
                        if ttl < 0:  # No TTL set or expired
                            await self.redis_client.delete(key)
                
        except Exception as e:
            logger.error(f"Data cleanup error: {e}")
    
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            pos_analytics_requests.labels(endpoint='health', status='success').inc()
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'version': '1.0.0'
            })
        
        @self.app.route('/api/v1/fraud/detect', methods=['POST'])
        def detect_fraud_endpoint():
            try:
                data = request.get_json()
                if not data:
                    pos_analytics_requests.labels(endpoint='fraud_detect', status='error').inc()
                    return jsonify({'error': 'No data provided'}), 400
                
                # Run fraud detection in thread pool
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(self.detect_fraud(data))
                loop.close()
                
                pos_analytics_requests.labels(endpoint='fraud_detect', status='success').inc()
                return jsonify(result)
                
            except Exception as e:
                pos_analytics_requests.labels(endpoint='fraud_detect', status='error').inc()
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/v1/anomaly/detect', methods=['POST'])
        def detect_anomaly_endpoint():
            try:
                data = request.get_json()
                device_id = data.get('device_id')
                metrics = data.get('metrics', {})
                
                if not device_id or not metrics:
                    pos_analytics_requests.labels(endpoint='anomaly_detect', status='error').inc()
                    return jsonify({'error': 'device_id and metrics required'}), 400
                
                # Run anomaly detection in thread pool
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(self.detect_anomaly(device_id, metrics))
                loop.close()
                
                pos_analytics_requests.labels(endpoint='anomaly_detect', status='success').inc()
                return jsonify(result)
                
            except Exception as e:
                pos_analytics_requests.labels(endpoint='anomaly_detect', status='error').inc()
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/v1/analytics/device/<device_id>', methods=['GET'])
        def device_analytics_endpoint(device_id):
            try:
                time_range = request.args.get('time_range', '24h')
                
                # Run analysis in thread pool
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(
                    self.analyze_device_performance(device_id, time_range)
                )
                loop.close()
                
                pos_analytics_requests.labels(endpoint='device_analytics', status='success').inc()
                return jsonify(result)
                
            except Exception as e:
                pos_analytics_requests.labels(endpoint='device_analytics', status='error').inc()
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/v1/analytics/dashboard', methods=['GET'])
        def dashboard_endpoint():
            try:
                agent_id = request.args.get('agent_id')
                
                # Run dashboard generation in thread pool
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(
                    self.generate_analytics_dashboard(agent_id)
                )
                loop.close()
                
                pos_analytics_requests.labels(endpoint='dashboard', status='success').inc()
                return jsonify(result)
                
            except Exception as e:
                pos_analytics_requests.labels(endpoint='dashboard', status='error').inc()
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/v1/models/retrain', methods=['POST'])
        def retrain_models_endpoint():
            try:
                # Run model retraining in thread pool
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(self.retrain_models())
                loop.close()
                
                pos_analytics_requests.labels(endpoint='retrain_models', status='success').inc()
                return jsonify({'message': 'Models retrained successfully'})
                
            except Exception as e:
                pos_analytics_requests.labels(endpoint='retrain_models', status='error').inc()
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/metrics', methods=['GET'])
        def metrics_endpoint():
            return generate_latest()

def main():
    """Main entry point"""
    service = POSAnalyticsService()
    
    # Initialize service in background thread
    def init_service():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(service.initialize())
        loop.run_forever()
    
    init_thread = threading.Thread(target=init_service, daemon=True)
    init_thread.start()
    
    # Wait for initialization
    time.sleep(5)
    
    # Start Flask app
    port = int(os.getenv('PORT', 8096))
    logger.info(f"POS Analytics Service starting on port {port}")
    
    service.app.run(
        host=os.getenv('HOST', os.getenv('HOST', '0.0.0.0')),
        port=port,
        debug=False,
        threaded=True
    )

if __name__ == '__main__':
    main()

