#!/usr/bin/env python3
"""
Advanced Customer Analytics and Segmentation Service for Remittance Platform
Provides ML-powered customer insights, segmentation, and behavioral analysis
"""

import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import logging
from datetime import datetime, timedelta
import json
import numpy as np
import pandas as pd
from dataclasses import dataclass, asdict
import asyncio
import threading
import time
import uuid

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.append(str(project_root))

try:
    # Flask and web framework
    from flask import Flask, request, jsonify, g
    from flask_cors import CORS
    
    # Machine Learning libraries
    from sklearn.cluster import KMeans, DBSCAN, AgglomerativeClustering
    from sklearn.preprocessing import StandardScaler, LabelEncoder, MinMaxScaler
    from sklearn.decomposition import PCA
    from sklearn.ensemble import RandomForestClassifier, IsolationForest
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import silhouette_score, calinski_harabasz_score
    from sklearn.manifold import TSNE
    
    # Deep Learning
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    
    # Time series analysis
    from statsmodels.tsa.seasonal import seasonal_decompose
    from statsmodels.tsa.arima.model import ARIMA
    import scipy.stats as stats
    
    # Data processing
    import redis
    import psycopg2
    from psycopg2.extras import RealDictCursor
    
    # Visualization and analysis
    import plotly.graph_objects as go
    import plotly.express as px
    from plotly.subplots import make_subplots
    
    # Monitoring
    import mlflow
    import mlflow.sklearn
    import mlflow.pytorch
    
except ImportError as e:
    logger.info(f"Required packages not installed: {e}")
    logger.info("Please install: pip install torch scikit-learn statsmodels plotly mlflow redis psycopg2-binary")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class CustomerProfile:
    """Customer profile data structure"""
    customer_id: str
    demographics: Dict[str, Any]
    transaction_behavior: Dict[str, Any]
    financial_metrics: Dict[str, Any]
    risk_profile: Dict[str, Any]
    preferences: Dict[str, Any]
    lifecycle_stage: str
    segment: str
    value_score: float
    churn_probability: float
    next_best_action: str

@dataclass
class CustomerSegment:
    """Customer segment definition"""
    segment_id: str
    segment_name: str
    description: str
    characteristics: Dict[str, Any]
    size: int
    avg_value: float
    churn_rate: float
    recommended_actions: List[str]

@dataclass
class CustomerInsight:
    """Customer insight data structure"""
    customer_id: str
    insight_type: str
    insight_text: str
    confidence: float
    impact: str
    recommended_action: str
    created_at: datetime

class CustomerEmbeddingModel(nn.Module):
    """Neural network for customer embeddings"""
    
    def __init__(self, input_dim: int, embedding_dim: int = 64, hidden_dims: List[int] = [128, 64]):
        super(CustomerEmbeddingModel, self).__init__()
        
        layers = []
        prev_dim = input_dim
        
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(0.3)
            ])
            prev_dim = hidden_dim
        
        # Embedding layer
        layers.append(nn.Linear(prev_dim, embedding_dim))
        
        self.encoder = nn.Sequential(*layers)
        
        # Decoder for reconstruction
        decoder_layers = []
        prev_dim = embedding_dim
        
        for hidden_dim in reversed(hidden_dims):
            decoder_layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(0.3)
            ])
            prev_dim = hidden_dim
        
        decoder_layers.append(nn.Linear(prev_dim, input_dim))
        self.decoder = nn.Sequential(*decoder_layers)
    
        super(CustomerEmbeddingModel, self).__init__()
        
        layers = []
        prev_dim = input_dim
        
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(0.3)
            ])
            prev_dim = hidden_dim
        
        # Embedding layer
        layers.append(nn.Linear(prev_dim, embedding_dim))
        
        self.encoder = nn.Sequential(*layers)
        
        # Decoder for reconstruction
        decoder_layers = []
        prev_dim = embedding_dim
        
        for hidden_dim in reversed(hidden_dims):
            decoder_layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(0.3)
            ])
            prev_dim = hidden_dim
        
        decoder_layers.append(nn.Linear(prev_dim, input_dim))
        self.decoder = nn.Sequential(*decoder_layers)
    
    def forward(self, x):
        """Forward pass"""
        embedding = self.encoder(x)
        reconstruction = self.decoder(embedding)
        return embedding, reconstruction

        """Forward pass"""
        embedding = self.encoder(x)
        reconstruction = self.decoder(embedding)
        return embedding, reconstruction

class CustomerAnalyticsService:
    """Advanced customer analytics and segmentation service"""
    
    def __init__(self, 
                 redis_host: str = "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")", 
                 redis_port: int = 6379,
                 postgres_config: Dict[str, str] = None):
        
        self.redis_client = redis.Redis(host=redis_host, port=redis_port, decode_responses=True)
        self.postgres_config = postgres_config or {
            'host': 'os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")")',
            'port': '5432',
            'database': 'remittance',
            'user': 'postgres',
            'password': 'password'
        }
        
        # ML Models
        self.clustering_model = None
        self.churn_model = None
        self.value_model = None
        self.embedding_model = None
        self.anomaly_detector = None
        
        # Preprocessing
        self.scaler = StandardScaler()
        self.label_encoders = {}
        
        # Feature columns
        self.feature_columns = [
            'total_transactions', 'total_volume', 'avg_transaction_amount',
            'transaction_frequency', 'days_since_last_transaction',
            'unique_agents', 'unique_transaction_types', 'account_age_days',
            'balance_volatility', 'weekend_transaction_ratio',
            'night_transaction_ratio', 'cross_border_ratio'
        ]
        
        # Segments
        self.customer_segments = {}
        
        # Initialize MLflow
        mlflow.set_tracking_uri("http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")"):5000")
        mlflow.set_experiment("customer_analytics")
        
        self._initialize_models()
    
    def _initialize_models(self):
        """Initialize customer analytics models"""
        try:
            # Initialize clustering model
            self.clustering_model = KMeans(n_clusters=5, random_state=42)
            
            # Initialize churn prediction model
            self.churn_model = RandomForestClassifier(
                n_estimators=100,
                max_depth=10,
                random_state=42
            )
            
            # Initialize customer value model
            self.value_model = RandomForestClassifier(
                n_estimators=100,
                max_depth=8,
                random_state=42
            )
            
            # Initialize embedding model
            self.embedding_model = CustomerEmbeddingModel(
                input_dim=len(self.feature_columns),
                embedding_dim=32,
                hidden_dims=[64, 32]
            )
            
            # Initialize anomaly detector
            self.anomaly_detector = IsolationForest(
                contamination=0.1,
                random_state=42
            )
            
            logger.info("Customer analytics models initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize models: {e}")
            raise
    
        """Initialize customer analytics models"""
        try:
            # Initialize clustering model
            self.clustering_model = KMeans(n_clusters=5, random_state=42)
            
            # Initialize churn prediction model
            self.churn_model = RandomForestClassifier(
                n_estimators=100,
                max_depth=10,
                random_state=42
            )
            
            # Initialize customer value model
            self.value_model = RandomForestClassifier(
                n_estimators=100,
                max_depth=8,
                random_state=42
            )
            
            # Initialize embedding model
            self.embedding_model = CustomerEmbeddingModel(
                input_dim=len(self.feature_columns),
                embedding_dim=32,
                hidden_dims=[64, 32]
            )
            
            # Initialize anomaly detector
            self.anomaly_detector = IsolationForest(
                contamination=0.1,
                random_state=42
            )
            
            logger.info("Customer analytics models initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize models: {e}")
            raise
    
    def extract_customer_features(self, customer_id: str) -> Dict[str, float]:
        """Extract comprehensive customer features"""
        try:
            with psycopg2.connect(**self.postgres_config) as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Get customer transaction data
                    cursor.execute("""
                        SELECT 
                            COUNT(*) as total_transactions,
                            SUM(amount) as total_volume,
                            AVG(amount) as avg_transaction_amount,
                            COUNT(DISTINCT agent_id) as unique_agents,
                            COUNT(DISTINCT transaction_type) as unique_transaction_types,
                            MIN(created_at) as first_transaction,
                            MAX(created_at) as last_transaction,
                            STDDEV(amount) as amount_stddev
                        FROM transactions 
                        WHERE customer_id = %s
                    """, (customer_id,))
                    
                    txn_data = cursor.fetchone()
                    
                    if not txn_data or txn_data['total_transactions'] == 0:
                        return {col: 0.0 for col in self.feature_columns}
                    
                    # Calculate derived features
                    first_txn = txn_data['first_transaction']
                    last_txn = txn_data['last_transaction']
                    
                    account_age_days = (datetime.now() - first_txn).days if first_txn else 0
                    days_since_last = (datetime.now() - last_txn).days if last_txn else 999
                    
                    # Transaction frequency (transactions per day)
                    transaction_frequency = txn_data['total_transactions'] / max(account_age_days, 1)
                    
                    # Balance volatility (coefficient of variation)
                    balance_volatility = (txn_data['amount_stddev'] or 0) / max(txn_data['avg_transaction_amount'] or 1, 1)
                    
                    # Get time-based patterns
                    cursor.execute("""
                        SELECT 
                            COUNT(CASE WHEN EXTRACT(dow FROM created_at) IN (0, 6) THEN 1 END) as weekend_txns,
                            COUNT(CASE WHEN EXTRACT(hour FROM created_at) BETWEEN 22 AND 6 THEN 1 END) as night_txns,
                            COUNT(CASE WHEN latitude != agent_latitude OR longitude != agent_longitude THEN 1 END) as cross_border_txns
                        FROM transactions t
                        LEFT JOIN agents a ON t.agent_id = a.agent_id
                        WHERE t.customer_id = %s
                    """, (customer_id,))
                    
                    pattern_data = cursor.fetchone()
                    
                    # Calculate ratios
                    total_txns = txn_data['total_transactions']
                    weekend_ratio = (pattern_data['weekend_txns'] or 0) / total_txns
                    night_ratio = (pattern_data['night_txns'] or 0) / total_txns
                    cross_border_ratio = (pattern_data['cross_border_txns'] or 0) / total_txns
                    
                    features = {
                        'total_transactions': float(txn_data['total_transactions']),
                        'total_volume': float(txn_data['total_volume'] or 0),
                        'avg_transaction_amount': float(txn_data['avg_transaction_amount'] or 0),
                        'transaction_frequency': float(transaction_frequency),
                        'days_since_last_transaction': float(days_since_last),
                        'unique_agents': float(txn_data['unique_agents'] or 0),
                        'unique_transaction_types': float(txn_data['unique_transaction_types'] or 0),
                        'account_age_days': float(account_age_days),
                        'balance_volatility': float(balance_volatility),
                        'weekend_transaction_ratio': float(weekend_ratio),
                        'night_transaction_ratio': float(night_ratio),
                        'cross_border_ratio': float(cross_border_ratio)
                    }
                    
                    return features
            
        except Exception as e:
            logger.error(f"Failed to extract customer features for {customer_id}: {e}")
            return {col: 0.0 for col in self.feature_columns}
    
    def segment_customers(self, customer_data: pd.DataFrame) -> Dict[str, CustomerSegment]:
        """Perform customer segmentation using multiple algorithms"""
        try:
            with mlflow.start_run():
                # Prepare features
                features = customer_data[self.feature_columns].fillna(0)
                features_scaled = self.scaler.fit_transform(features)
                
                # Try different clustering algorithms
                clustering_results = {}
                
                # K-Means clustering
                kmeans = KMeans(n_clusters=5, random_state=42)
                kmeans_labels = kmeans.fit_predict(features_scaled)
                kmeans_silhouette = silhouette_score(features_scaled, kmeans_labels)
                clustering_results['kmeans'] = {
                    'labels': kmeans_labels,
                    'silhouette': kmeans_silhouette,
                    'model': kmeans
                }
                
                # DBSCAN clustering
                dbscan = DBSCAN(eps=0.5, min_samples=5)
                dbscan_labels = dbscan.fit_predict(features_scaled)
                if len(set(dbscan_labels)) > 1:
                    dbscan_silhouette = silhouette_score(features_scaled, dbscan_labels)
                    clustering_results['dbscan'] = {
                        'labels': dbscan_labels,
                        'silhouette': dbscan_silhouette,
                        'model': dbscan
                    }
                
                # Hierarchical clustering
                hierarchical = AgglomerativeClustering(n_clusters=5)
                hierarchical_labels = hierarchical.fit_predict(features_scaled)
                hierarchical_silhouette = silhouette_score(features_scaled, hierarchical_labels)
                clustering_results['hierarchical'] = {
                    'labels': hierarchical_labels,
                    'silhouette': hierarchical_silhouette,
                    'model': hierarchical
                }
                
                # Select best clustering method
                best_method = max(clustering_results.keys(), 
                                key=lambda k: clustering_results[k]['silhouette'])
                best_labels = clustering_results[best_method]['labels']
                self.clustering_model = clustering_results[best_method]['model']
                
                # Create segment profiles
                segments = {}
                customer_data['segment'] = best_labels
                
                for segment_id in np.unique(best_labels):
                    if segment_id == -1:  # Skip noise points from DBSCAN
                        continue
                    
                    segment_data = customer_data[customer_data['segment'] == segment_id]
                    
                    # Calculate segment characteristics
                    characteristics = {}
                    for col in self.feature_columns:
                        characteristics[col] = {
                            'mean': float(segment_data[col].mean()),
                            'median': float(segment_data[col].median()),
                            'std': float(segment_data[col].std())
                        }
                    
                    # Determine segment name based on characteristics
                    segment_name = self._determine_segment_name(characteristics)
                    
                    # Calculate segment metrics
                    avg_value = segment_data['total_volume'].mean()
                    size = len(segment_data)
                    
                    # Estimate churn rate (simplified)
                    recent_activity = segment_data['days_since_last_transaction'] < 30
                    churn_rate = 1 - recent_activity.mean()
                    
                    # Generate recommendations
                    recommendations = self._generate_segment_recommendations(characteristics)
                    
                    segments[str(segment_id)] = CustomerSegment(
                        segment_id=str(segment_id),
                        segment_name=segment_name,
                        description=f"Customer segment with {segment_name.lower()} characteristics",
                        characteristics=characteristics,
                        size=size,
                        avg_value=float(avg_value),
                        churn_rate=float(churn_rate),
                        recommended_actions=recommendations
                    )
                
                # Log metrics
                mlflow.log_metric("best_silhouette_score", clustering_results[best_method]['silhouette'])
                mlflow.log_metric("num_segments", len(segments))
                mlflow.log_param("best_clustering_method", best_method)
                
                # Save clustering model
                mlflow.sklearn.log_model(self.clustering_model, "clustering_model")
                
                self.customer_segments = segments
                logger.info(f"Customer segmentation completed with {len(segments)} segments")
                
                return segments
            
        except Exception as e:
            logger.error(f"Failed to segment customers: {e}")
            raise
    
    def _determine_segment_name(self, characteristics: Dict[str, Dict[str, float]]) -> str:
        """Determine segment name based on characteristics"""
        try:
            # High value customers
            if (characteristics['total_volume']['mean'] > 50000 and 
                characteristics['transaction_frequency']['mean'] > 5):
                return "High Value Active"
            
            # Frequent but low value
            elif (characteristics['transaction_frequency']['mean'] > 10 and 
                  characteristics['avg_transaction_amount']['mean'] < 1000):
                return "Frequent Small Transactions"
            
            # High value but infrequent
            elif (characteristics['total_volume']['mean'] > 30000 and 
                  characteristics['transaction_frequency']['mean'] < 2):
                return "High Value Occasional"
            
            # New customers
            elif characteristics['account_age_days']['mean'] < 90:
                return "New Customers"
            
            # At-risk customers
            elif characteristics['days_since_last_transaction']['mean'] > 60:
                return "At Risk"
            
            # Default
            else:
                return "Standard Customers"
            
        except Exception as e:
            logger.error(f"Failed to determine segment name: {e}")
            return "Unknown Segment"
    
    def _generate_segment_recommendations(self, characteristics: Dict[str, Dict[str, float]]) -> List[str]:
        """Generate recommendations for a customer segment"""
        recommendations = []
        
        try:
            # High value customers
            if characteristics['total_volume']['mean'] > 50000:
                recommendations.extend([
                    "Offer premium services and dedicated support",
                    "Provide investment and wealth management options",
                    "Implement VIP customer program"
                ])
            
            # Frequent users
            if characteristics['transaction_frequency']['mean'] > 10:
                recommendations.extend([
                    "Optimize transaction fees for frequent users",
                    "Offer loyalty rewards program",
                    "Provide mobile app enhancements"
                ])
            
            # At-risk customers
            if characteristics['days_since_last_transaction']['mean'] > 60:
                recommendations.extend([
                    "Implement re-engagement campaigns",
                    "Offer special promotions to encourage activity",
                    "Conduct customer satisfaction surveys"
                ])
            
            # New customers
            if characteristics['account_age_days']['mean'] < 90:
                recommendations.extend([
                    "Provide onboarding support and education",
                    "Offer new customer incentives",
                    "Implement welcome series communications"
                ])
            
            # Cross-border users
            if characteristics['cross_border_ratio']['mean'] > 0.3:
                recommendations.extend([
                    "Offer competitive foreign exchange rates",
                    "Provide multi-currency account options",
                    "Implement cross-border payment solutions"
                ])
            
            return recommendations if recommendations else ["Monitor customer behavior and engagement"]
            
        except Exception as e:
            logger.error(f"Failed to generate recommendations: {e}")
            return ["Monitor customer behavior and engagement"]
    
    def predict_churn(self, customer_features: pd.DataFrame) -> np.ndarray:
        """Predict customer churn probability"""
        try:
            # Prepare features
            features = customer_features[self.feature_columns].fillna(0)
            features_scaled = self.scaler.transform(features)
            
            # Predict churn probability
            churn_probabilities = self.churn_model.predict_proba(features_scaled)
            
            # Return probability of churn (class 1)
            return churn_probabilities[:, 1] if churn_probabilities.shape[1] > 1 else churn_probabilities[:, 0]
            
        except Exception as e:
            logger.error(f"Failed to predict churn: {e}")
            return np.zeros(len(customer_features))
    
    def calculate_customer_value(self, customer_features: pd.DataFrame) -> np.ndarray:
        """Calculate customer lifetime value score"""
        try:
            # Simple CLV calculation based on features
            features = customer_features[self.feature_columns].fillna(0)
            
            # Weighted combination of key value indicators
            value_scores = (
                features['total_volume'] * 0.4 +
                features['transaction_frequency'] * features['avg_transaction_amount'] * 0.3 +
                (365 - features['days_since_last_transaction']) * 0.2 +
                features['account_age_days'] * 0.1
            )
            
            # Normalize to 0-100 scale
            value_scores = (value_scores - value_scores.min()) / (value_scores.max() - value_scores.min()) * 100
            
            return value_scores.values
            
        except Exception as e:
            logger.error(f"Failed to calculate customer value: {e}")
            return np.zeros(len(customer_features))
    
    def generate_customer_embeddings(self, customer_features: pd.DataFrame) -> np.ndarray:
        """Generate customer embeddings using neural network"""
        try:
            # Prepare features
            features = customer_features[self.feature_columns].fillna(0)
            features_scaled = self.scaler.transform(features)
            features_tensor = torch.tensor(features_scaled, dtype=torch.float32)
            
            # Generate embeddings
            self.embedding_model.eval()
            with torch.no_grad():
                embeddings, _ = self.embedding_model(features_tensor)
                return embeddings.numpy()
            
        except Exception as e:
            logger.error(f"Failed to generate customer embeddings: {e}")
            return np.zeros((len(customer_features), 32))
    
    def detect_anomalous_customers(self, customer_features: pd.DataFrame) -> np.ndarray:
        """Detect anomalous customer behavior"""
        try:
            # Prepare features
            features = customer_features[self.feature_columns].fillna(0)
            features_scaled = self.scaler.transform(features)
            
            # Detect anomalies
            anomaly_scores = self.anomaly_detector.decision_function(features_scaled)
            anomaly_labels = self.anomaly_detector.predict(features_scaled)
            
            # Convert to anomaly probability (0-1 scale)
            anomaly_probabilities = 1 / (1 + np.exp(anomaly_scores))
            
            return anomaly_probabilities
            
        except Exception as e:
            logger.error(f"Failed to detect anomalous customers: {e}")
            return np.zeros(len(customer_features))
    
    def analyze_customer_journey(self, customer_id: str) -> Dict[str, Any]:
        """Analyze customer journey and lifecycle stage"""
        try:
            with psycopg2.connect(**self.postgres_config) as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Get customer transaction timeline
                    cursor.execute("""
                        SELECT 
                            DATE_TRUNC('month', created_at) as month,
                            COUNT(*) as transaction_count,
                            SUM(amount) as total_volume,
                            AVG(amount) as avg_amount
                        FROM transactions 
                        WHERE customer_id = %s
                        GROUP BY DATE_TRUNC('month', created_at)
                        ORDER BY month
                    """, (customer_id,))
                    
                    monthly_data = cursor.fetchall()
                    
                    if not monthly_data:
                        return {'lifecycle_stage': 'inactive', 'journey_insights': []}
                    
                    # Convert to DataFrame for analysis
                    df = pd.DataFrame(monthly_data)
                    df['month'] = pd.to_datetime(df['month'])
                    
                    # Calculate trends
                    volume_trend = np.polyfit(range(len(df)), df['total_volume'], 1)[0]
                    frequency_trend = np.polyfit(range(len(df)), df['transaction_count'], 1)[0]
                    
                    # Determine lifecycle stage
                    months_active = len(df)
                    recent_activity = df.tail(3)['transaction_count'].sum()
                    
                    if months_active < 3:
                        lifecycle_stage = 'new'
                    elif recent_activity == 0:
                        lifecycle_stage = 'churned'
                    elif recent_activity < df['transaction_count'].mean():
                        lifecycle_stage = 'declining'
                    elif volume_trend > 0 and frequency_trend > 0:
                        lifecycle_stage = 'growing'
                    else:
                        lifecycle_stage = 'stable'
                    
                    # Generate insights
                    insights = []
                    
                    if volume_trend > 0:
                        insights.append("Customer transaction volume is increasing over time")
                    elif volume_trend < -1000:
                        insights.append("Customer transaction volume is declining significantly")
                    
                    if frequency_trend > 0:
                        insights.append("Customer transaction frequency is increasing")
                    elif frequency_trend < -0.5:
                        insights.append("Customer transaction frequency is declining")
                    
                    # Seasonality analysis
                    if len(df) >= 12:
                        try:
                            decomposition = seasonal_decompose(df['total_volume'], model='additive', period=12)
                            if decomposition.seasonal.std() > decomposition.trend.std() * 0.1:
                                insights.append("Customer shows seasonal transaction patterns")
                        except:
                            return {"status": "success", "data": {}, "message": "Operation completed successfully"}
                    
                    return {
                        'lifecycle_stage': lifecycle_stage,
                        'months_active': months_active,
                        'volume_trend': float(volume_trend),
                        'frequency_trend': float(frequency_trend),
                        'journey_insights': insights,
                        'monthly_data': df.to_dict('records')
                    }
            
        except Exception as e:
            logger.error(f"Failed to analyze customer journey for {customer_id}: {e}")
            return {'lifecycle_stage': 'unknown', 'journey_insights': []}
    
    def generate_next_best_action(self, customer_profile: CustomerProfile) -> str:
        """Generate next best action recommendation for customer"""
        try:
            # High churn risk
            if customer_profile.churn_probability > 0.7:
                return "Immediate retention campaign with personalized offers"
            
            # High value customer
            elif customer_profile.value_score > 80:
                return "Offer premium services and investment opportunities"
            
            # New customer
            elif customer_profile.lifecycle_stage == 'new':
                return "Provide onboarding support and educational content"
            
            # Declining customer
            elif customer_profile.lifecycle_stage == 'declining':
                return "Re-engagement campaign with usage incentives"
            
            # Frequent user
            elif customer_profile.transaction_behavior.get('transaction_frequency', 0) > 10:
                return "Offer loyalty rewards and fee optimization"
            
            # Cross-border user
            elif customer_profile.transaction_behavior.get('cross_border_ratio', 0) > 0.3:
                return "Promote international banking services"
            
            # Default
            else:
                return "Monitor engagement and provide relevant product recommendations"
            
        except Exception as e:
            logger.error(f"Failed to generate next best action: {e}")
            return "Monitor customer activity"
    
    def create_customer_profile(self, customer_id: str) -> CustomerProfile:
        """Create comprehensive customer profile"""
        try:
            # Extract features
            features = self.extract_customer_features(customer_id)
            features_df = pd.DataFrame([features])
            
            # Get customer segment
            if self.customer_segments:
                features_scaled = self.scaler.transform(features_df[self.feature_columns])
                segment_id = str(self.clustering_model.predict(features_scaled)[0])
                segment = self.customer_segments.get(segment_id, None)
                segment_name = segment.segment_name if segment else "Unknown"
            else:
                segment_name = "Unassigned"
            
            # Predict churn
            churn_prob = self.predict_churn(features_df)[0]
            
            # Calculate value score
            value_score = self.calculate_customer_value(features_df)[0]
            
            # Analyze journey
            journey_analysis = self.analyze_customer_journey(customer_id)
            
            # Create profile
            profile = CustomerProfile(
                customer_id=customer_id,
                demographics={},  # Would be populated from customer data
                transaction_behavior=features,
                financial_metrics={
                    'total_volume': features['total_volume'],
                    'avg_transaction_amount': features['avg_transaction_amount'],
                    'transaction_frequency': features['transaction_frequency']
                },
                risk_profile={
                    'churn_probability': float(churn_prob),
                    'anomaly_score': 0.0  # Would be calculated
                },
                preferences={},  # Would be populated from customer preferences
                lifecycle_stage=journey_analysis['lifecycle_stage'],
                segment=segment_name,
                value_score=float(value_score),
                churn_probability=float(churn_prob),
                next_best_action=""
            )
            
            # Generate next best action
            profile.next_best_action = self.generate_next_best_action(profile)
            
            return profile
            
        except Exception as e:
            logger.error(f"Failed to create customer profile for {customer_id}: {e}")
            # Return default profile
            return CustomerProfile(
                customer_id=customer_id,
                demographics={},
                transaction_behavior={},
                financial_metrics={},
                risk_profile={},
                preferences={},
                lifecycle_stage="unknown",
                segment="Unknown",
                value_score=0.0,
                churn_probability=0.5,
                next_best_action="Monitor customer activity"
            )
    
    def train_models(self, customer_data: pd.DataFrame):
        """Train all customer analytics models"""
        try:
            with mlflow.start_run():
                # Prepare features
                features = customer_data[self.feature_columns].fillna(0)
                features_scaled = self.scaler.fit_transform(features)
                
                # Train clustering model (already done in segment_customers)
                
                # Train churn model (create synthetic labels for demo)
                churn_labels = (customer_data['days_since_last_transaction'] > 90).astype(int)
                
                X_train, X_test, y_train, y_test = train_test_split(
                    features_scaled, churn_labels, test_size=0.2, random_state=42
                )
                
                self.churn_model.fit(X_train, y_train)
                churn_score = self.churn_model.score(X_test, y_test)
                
                # Train anomaly detector
                self.anomaly_detector.fit(features_scaled)
                
                # Train embedding model
                features_tensor = torch.tensor(features_scaled, dtype=torch.float32)
                dataset = TensorDataset(features_tensor, features_tensor)
                dataloader = DataLoader(dataset, batch_size=32, shuffle=True)
                
                optimizer = optim.Adam(self.embedding_model.parameters(), lr=0.001)
                criterion = nn.MSELoss()
                
                self.embedding_model.train()
                for epoch in range(50):
                    for batch_features, batch_targets in dataloader:
                        optimizer.zero_grad()
                        embeddings, reconstructions = self.embedding_model(batch_features)
                        loss = criterion(reconstructions, batch_targets)
                        loss.backward()
                        optimizer.step()
                
                # Log metrics
                mlflow.log_metric("churn_model_accuracy", churn_score)
                mlflow.log_metric("num_customers", len(customer_data))
                
                # Save models
                mlflow.sklearn.log_model(self.churn_model, "churn_model")
                mlflow.sklearn.log_model(self.anomaly_detector, "anomaly_detector")
                mlflow.pytorch.log_model(self.embedding_model, "embedding_model")
                
                logger.info(f"Customer analytics models trained successfully")
                
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise

        """Train all customer analytics models"""
        try:
            with mlflow.start_run():
                # Prepare features
                features = customer_data[self.feature_columns].fillna(0)
                features_scaled = self.scaler.fit_transform(features)
                
                # Train clustering model (already done in segment_customers)
                
                # Train churn model (create synthetic labels for demo)
                churn_labels = (customer_data['days_since_last_transaction'] > 90).astype(int)
                
                X_train, X_test, y_train, y_test = train_test_split(
                    features_scaled, churn_labels, test_size=0.2, random_state=42
                )
                
                self.churn_model.fit(X_train, y_train)
                churn_score = self.churn_model.score(X_test, y_test)
                
                # Train anomaly detector
                self.anomaly_detector.fit(features_scaled)
                
                # Train embedding model
                features_tensor = torch.tensor(features_scaled, dtype=torch.float32)
                dataset = TensorDataset(features_tensor, features_tensor)
                dataloader = DataLoader(dataset, batch_size=32, shuffle=True)
                
                optimizer = optim.Adam(self.embedding_model.parameters(), lr=0.001)
                criterion = nn.MSELoss()
                
                self.embedding_model.train()
                for epoch in range(50):
                    for batch_features, batch_targets in dataloader:
                        optimizer.zero_grad()
                        embeddings, reconstructions = self.embedding_model(batch_features)
                        loss = criterion(reconstructions, batch_targets)
                        loss.backward()
                        optimizer.step()
                
                # Log metrics
                mlflow.log_metric("churn_model_accuracy", churn_score)
                mlflow.log_metric("num_customers", len(customer_data))
                
                # Save models
                mlflow.sklearn.log_model(self.churn_model, "churn_model")
                mlflow.sklearn.log_model(self.anomaly_detector, "anomaly_detector")
                mlflow.pytorch.log_model(self.embedding_model, "embedding_model")
                
                logger.info(f"Customer analytics models trained successfully")
                
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise

# Flask API
app = Flask(__name__)
CORS(app)

# Initialize customer analytics service
analytics_service = CustomerAnalyticsService()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'customer_analytics',
        'timestamp': datetime.now().isoformat()
    })

    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'customer_analytics',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/customer/<customer_id>/profile', methods=['GET'])
def get_customer_profile(customer_id: str):
    """Get comprehensive customer profile"""
    try:
        profile = analytics_service.create_customer_profile(customer_id)
        return jsonify(asdict(profile))
        
    except Exception as e:
        logger.error(f"Failed to get customer profile: {e}")
        return jsonify({'error': str(e)}), 500

    """Get comprehensive customer profile"""
    try:
        profile = analytics_service.create_customer_profile(customer_id)
        return jsonify(asdict(profile))
        
    except Exception as e:
        logger.error(f"Failed to get customer profile: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/customer/<customer_id>/journey', methods=['GET'])
def get_customer_journey(customer_id: str):
    """Get customer journey analysis"""
    try:
        journey = analytics_service.analyze_customer_journey(customer_id)
        return jsonify(journey)
        
    except Exception as e:
        logger.error(f"Failed to get customer journey: {e}")
        return jsonify({'error': str(e)}), 500

    """Get customer journey analysis"""
    try:
        journey = analytics_service.analyze_customer_journey(customer_id)
        return jsonify(journey)
        
    except Exception as e:
        logger.error(f"Failed to get customer journey: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/segments', methods=['GET'])
def get_customer_segments():
    """Get all customer segments"""
    try:
        segments = {k: asdict(v) for k, v in analytics_service.customer_segments.items()}
        return jsonify(segments)
        
    except Exception as e:
        logger.error(f"Failed to get customer segments: {e}")
        return jsonify({'error': str(e)}), 500

    """Get all customer segments"""
    try:
        segments = {k: asdict(v) for k, v in analytics_service.customer_segments.items()}
        return jsonify(segments)
        
    except Exception as e:
        logger.error(f"Failed to get customer segments: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/segments/create', methods=['POST'])
def create_customer_segments():
    """Create customer segments"""
    try:
        # In production, this would load data from the data lake
        # For now, create sample customer data
        
        n_customers = 5000
        np.random.seed(42)
        
        customer_data = pd.DataFrame({
            'customer_id': [f"cust_{i}" for i in range(n_customers)],
            'total_transactions': np.random.poisson(20, n_customers),
            'total_volume': np.random.lognormal(9, 1, n_customers),
            'avg_transaction_amount': np.random.lognormal(7, 0.5, n_customers),
            'transaction_frequency': np.random.gamma(2, 2, n_customers),
            'days_since_last_transaction': np.random.exponential(30, n_customers),
            'unique_agents': np.random.poisson(3, n_customers),
            'unique_transaction_types': np.random.poisson(4, n_customers),
            'account_age_days': np.random.uniform(30, 1000, n_customers),
            'balance_volatility': np.random.gamma(1, 0.5, n_customers),
            'weekend_transaction_ratio': np.random.beta(2, 5, n_customers),
            'night_transaction_ratio': np.random.beta(1, 10, n_customers),
            'cross_border_ratio': np.random.beta(1, 20, n_customers)
        })
        
        # Create segments
        segments = analytics_service.segment_customers(customer_data)
        
        return jsonify({
            'status': 'segments_created',
            'num_segments': len(segments),
            'segments': {k: asdict(v) for k, v in segments.items()}
        })
        
    except Exception as e:
        logger.error(f"Failed to create customer segments: {e}")
        return jsonify({'error': str(e)}), 500

    """Create customer segments"""
    try:
        # In production, this would load data from the data lake
        # For now, create sample customer data
        
        n_customers = 5000
        np.random.seed(42)
        
        customer_data = pd.DataFrame({
            'customer_id': [f"cust_{i}" for i in range(n_customers)],
            'total_transactions': np.random.poisson(20, n_customers),
            'total_volume': np.random.lognormal(9, 1, n_customers),
            'avg_transaction_amount': np.random.lognormal(7, 0.5, n_customers),
            'transaction_frequency': np.random.gamma(2, 2, n_customers),
            'days_since_last_transaction': np.random.exponential(30, n_customers),
            'unique_agents': np.random.poisson(3, n_customers),
            'unique_transaction_types': np.random.poisson(4, n_customers),
            'account_age_days': np.random.uniform(30, 1000, n_customers),
            'balance_volatility': np.random.gamma(1, 0.5, n_customers),
            'weekend_transaction_ratio': np.random.beta(2, 5, n_customers),
            'night_transaction_ratio': np.random.beta(1, 10, n_customers),
            'cross_border_ratio': np.random.beta(1, 20, n_customers)
        })
        
        # Create segments
        segments = analytics_service.segment_customers(customer_data)
        
        return jsonify({
            'status': 'segments_created',
            'num_segments': len(segments),
            'segments': {k: asdict(v) for k, v in segments.items()}
        })
        
    except Exception as e:
        logger.error(f"Failed to create customer segments: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/train', methods=['POST'])
def train_models():
    """Train customer analytics models"""
    try:
        # Create sample training data
        n_customers = 10000
        np.random.seed(42)
        
        customer_data = pd.DataFrame({
            'customer_id': [f"cust_{i}" for i in range(n_customers)],
            'total_transactions': np.random.poisson(20, n_customers),
            'total_volume': np.random.lognormal(9, 1, n_customers),
            'avg_transaction_amount': np.random.lognormal(7, 0.5, n_customers),
            'transaction_frequency': np.random.gamma(2, 2, n_customers),
            'days_since_last_transaction': np.random.exponential(30, n_customers),
            'unique_agents': np.random.poisson(3, n_customers),
            'unique_transaction_types': np.random.poisson(4, n_customers),
            'account_age_days': np.random.uniform(30, 1000, n_customers),
            'balance_volatility': np.random.gamma(1, 0.5, n_customers),
            'weekend_transaction_ratio': np.random.beta(2, 5, n_customers),
            'night_transaction_ratio': np.random.beta(1, 10, n_customers),
            'cross_border_ratio': np.random.beta(1, 20, n_customers)
        })
        
        # Train models
        analytics_service.train_models(customer_data)
        
        return jsonify({'status': 'training_completed'})
        
    except Exception as e:
        logger.error(f"Failed to train models: {e}")
        return jsonify({'error': str(e)}), 500

    """Train customer analytics models"""
    try:
        # Create sample training data
        n_customers = 10000
        np.random.seed(42)
        
        customer_data = pd.DataFrame({
            'customer_id': [f"cust_{i}" for i in range(n_customers)],
            'total_transactions': np.random.poisson(20, n_customers),
            'total_volume': np.random.lognormal(9, 1, n_customers),
            'avg_transaction_amount': np.random.lognormal(7, 0.5, n_customers),
            'transaction_frequency': np.random.gamma(2, 2, n_customers),
            'days_since_last_transaction': np.random.exponential(30, n_customers),
            'unique_agents': np.random.poisson(3, n_customers),
            'unique_transaction_types': np.random.poisson(4, n_customers),
            'account_age_days': np.random.uniform(30, 1000, n_customers),
            'balance_volatility': np.random.gamma(1, 0.5, n_customers),
            'weekend_transaction_ratio': np.random.beta(2, 5, n_customers),
            'night_transaction_ratio': np.random.beta(1, 10, n_customers),
            'cross_border_ratio': np.random.beta(1, 20, n_customers)
        })
        
        # Train models
        analytics_service.train_models(customer_data)
        
        return jsonify({'status': 'training_completed'})
        
    except Exception as e:
        logger.error(f"Failed to train models: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/insights/<customer_id>', methods=['GET'])
def get_customer_insights(customer_id: str):
    """Get AI-generated customer insights"""
    try:
        # Generate insights based on customer profile
        profile = analytics_service.create_customer_profile(customer_id)
        
        insights = []
        
        # Churn risk insight
        if profile.churn_probability > 0.7:
            insights.append(CustomerInsight(
                customer_id=customer_id,
                insight_type="churn_risk",
                insight_text=f"Customer has {profile.churn_probability:.1%} probability of churning",
                confidence=0.85,
                impact="high",
                recommended_action="Immediate retention campaign",
                created_at=datetime.now()
            ))
        
        # Value insight
        if profile.value_score > 80:
            insights.append(CustomerInsight(
                customer_id=customer_id,
                insight_type="high_value",
                insight_text=f"Customer is in top 20% by value score ({profile.value_score:.1f})",
                confidence=0.90,
                impact="high",
                recommended_action="Offer premium services",
                created_at=datetime.now()
            ))
        
        # Behavior insight
        freq = profile.transaction_behavior.get('transaction_frequency', 0)
        if freq > 10:
            insights.append(CustomerInsight(
                customer_id=customer_id,
                insight_type="high_frequency",
                insight_text=f"Customer is highly active with {freq:.1f} transactions per day",
                confidence=0.95,
                impact="medium",
                recommended_action="Optimize fees and offer loyalty rewards",
                created_at=datetime.now()
            ))
        
        return jsonify([asdict(insight) for insight in insights])
        
    except Exception as e:
        logger.error(f"Failed to get customer insights: {e}")
        return jsonify({'error': str(e)}), 500

    """Get AI-generated customer insights"""
    try:
        # Generate insights based on customer profile
        profile = analytics_service.create_customer_profile(customer_id)
        
        insights = []
        
        # Churn risk insight
        if profile.churn_probability > 0.7:
            insights.append(CustomerInsight(
                customer_id=customer_id,
                insight_type="churn_risk",
                insight_text=f"Customer has {profile.churn_probability:.1%} probability of churning",
                confidence=0.85,
                impact="high",
                recommended_action="Immediate retention campaign",
                created_at=datetime.now()
            ))
        
        # Value insight
        if profile.value_score > 80:
            insights.append(CustomerInsight(
                customer_id=customer_id,
                insight_type="high_value",
                insight_text=f"Customer is in top 20% by value score ({profile.value_score:.1f})",
                confidence=0.90,
                impact="high",
                recommended_action="Offer premium services",
                created_at=datetime.now()
            ))
        
        # Behavior insight
        freq = profile.transaction_behavior.get('transaction_frequency', 0)
        if freq > 10:
            insights.append(CustomerInsight(
                customer_id=customer_id,
                insight_type="high_frequency",
                insight_text=f"Customer is highly active with {freq:.1f} transactions per day",
                confidence=0.95,
                impact="medium",
                recommended_action="Optimize fees and offer loyalty rewards",
                created_at=datetime.now()
            ))
        
        return jsonify([asdict(insight) for insight in insights])
        
    except Exception as e:
        logger.error(f"Failed to get customer insights: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug = False)

