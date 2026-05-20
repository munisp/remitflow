#!/usr/bin/env python3
"""
Remittance Platform - Customer Analytics Engine
Advanced ML-powered customer analytics and insights service for Nigerian banking

This service provides comprehensive customer analytics including:
- Customer segmentation and profiling
- Behavioral analytics and pattern recognition
- Churn prediction and retention strategies
- Product recommendation engine
- Customer lifetime value (CLV) calculation
- Risk assessment and credit scoring
- Nigerian banking context optimization
"""

import asyncio
import json
import logging
import os
import pickle
import time
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Union
import warnings
warnings.filterwarnings('ignore')

# Data processing and ML libraries
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, IsolationForest
from sklearn.cluster import KMeans, DBSCAN, AgglomerativeClustering
from sklearn.preprocessing import StandardScaler, LabelEncoder, MinMaxScaler
from sklearn.model_selection import train_test_split, cross_val_score, GridSearchCV
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
import xgboost as xgb
import lightgbm as lgb
from catboost import CatBoostClassifier, CatBoostRegressor

# Deep learning
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, models, optimizers, callbacks
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

# Statistical analysis
from scipy import stats
from scipy.cluster.hierarchy import dendrogram, linkage
import statsmodels.api as sm
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.seasonal import seasonal_decompose

# Visualization
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# Web framework and API
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix

# Database and caching
import psycopg2
from sqlalchemy import create_engine, text
import redis
from pymongo import MongoClient

# Utilities
import requests
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import multiprocessing as mp
from functools import lru_cache
import hashlib
import base64
from cryptography.fernet import Fernet

# Monitoring and observability
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import structlog

# Configuration
from dataclasses import dataclass
from typing_extensions import Literal

# Nigerian banking specific
import phonenumbers
from geopy.geocoders import Nominatim
from geopy.distance import geodesic

# Time series analysis
from prophet import Prophet
import pmdarima as pm

# Natural language processing
import nltk
from textblob import TextBlob
from wordcloud import WordCloud

# Image processing for document analysis
from PIL import Image
import cv2

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('customer_analytics.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Prometheus metrics
ANALYTICS_REQUESTS = Counter('customer_analytics_requests_total', 'Total analytics requests', ['endpoint', 'status'])
ANALYTICS_DURATION = Histogram('customer_analytics_duration_seconds', 'Analytics processing duration', ['operation'])
ACTIVE_CUSTOMERS = Gauge('customer_analytics_active_customers', 'Number of active customers')
MODEL_ACCURACY = Gauge('customer_analytics_model_accuracy', 'Model accuracy score', ['model_type'])

@dataclass
class CustomerAnalyticsConfig:
    """Configuration for Customer Analytics Engine"""
    
    # Database configuration
    database_url: str = os.getenv('DATABASE_URL', os.getenv('DATABASE_URL', 'postgresql://postgres:password@localhost:5432/remittance'))
    redis_url: str = os.getenv('REDIS_URL', 'redis://localhost:6379/3')
    mongodb_url: str = os.getenv('MONGODB_URL', 'mongodb://localhost:27017/customer_analytics')
    
    # ML model configuration
    model_update_interval: int = int(os.getenv('MODEL_UPDATE_INTERVAL', '3600'))  # 1 hour
    batch_size: int = int(os.getenv('BATCH_SIZE', '1000'))
    max_workers: int = int(os.getenv('MAX_WORKERS', '4'))
    
    # Nigerian banking context
    default_currency: str = 'NGN'
    default_timezone: str = 'Africa/Lagos'
    business_hours_start: str = '08:00'
    business_hours_end: str = '17:00'
    
    # Feature engineering
    lookback_days: int = int(os.getenv('LOOKBACK_DAYS', '90'))
    min_transaction_count: int = int(os.getenv('MIN_TRANSACTION_COUNT', '5'))
    
    # Model thresholds
    churn_threshold: float = float(os.getenv('CHURN_THRESHOLD', '0.7'))
    risk_threshold: float = float(os.getenv('RISK_THRESHOLD', '0.8'))
    recommendation_threshold: float = float(os.getenv('RECOMMENDATION_THRESHOLD', '0.6'))
    
    # API configuration
    api_host: str = os.getenv('API_HOST', os.getenv('HOST', '0.0.0.0'))
    api_port: int = int(os.getenv('API_PORT', '8084'))
    debug_mode: bool = os.getenv('DEBUG_MODE', 'False').lower() == 'true'
    
    # Security
    encryption_key: str = os.getenv('ENCRYPTION_KEY', Fernet.generate_key().decode())
    api_key: str = os.getenv('API_KEY', 'your-secure-api-key')
    
    # Nigerian states and regions
    nigerian_states: List[str] = [
        'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
        'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
        'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi',
        'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
        'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
    ]
    
    # Nigerian banks
    nigerian_banks: Dict[str, str] = {
        '044': 'Access Bank', '014': 'Afribank', '023': 'Citibank', '063': 'Diamond Bank',
        '050': 'Ecobank', '084': 'Enterprise Bank', '070': 'Fidelity Bank', '011': 'First Bank',
        '214': 'First City Monument Bank', '058': 'Guaranty Trust Bank', '030': 'Heritage Bank',
        '301': 'Jaiz Bank', '082': 'Keystone Bank', '526': 'Parallex Bank', '076': 'Polaris Bank',
        '221': 'Stanbic IBTC Bank', '068': 'Standard Chartered', '232': 'Sterling Bank',
        '032': 'Union Bank', '033': 'United Bank for Africa', '215': 'Unity Bank',
        '035': 'Wema Bank', '057': 'Zenith Bank'
    }

class NigerianBankingContext:
    """Nigerian banking context and utilities"""
    
    def __init__(self, config: CustomerAnalyticsConfig):
        self.config = config
        self.states = config.nigerian_states
        self.banks = config.nigerian_banks
        
    def validate_phone_number(self, phone: str) -> bool:
        """Validate Nigerian phone number"""
        try:
            parsed = phonenumbers.parse(phone, 'NG')
            return phonenumbers.is_valid_number(parsed)
        except:
            return False
    
    def format_phone_number(self, phone: str) -> str:
        """Format Nigerian phone number"""
        try:
            parsed = phonenumbers.parse(phone, 'NG')
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except:
            return phone
    
    def get_telecom_provider(self, phone: str) -> str:
        """Get telecom provider from phone number"""
        if not phone:
            return 'Unknown'
        
        # Nigerian telecom prefixes
        prefixes = {
            '0803': 'MTN', '0806': 'MTN', '0813': 'MTN', '0816': 'MTN', '0903': 'MTN', '0906': 'MTN',
            '0805': 'Glo', '0807': 'Glo', '0811': 'Glo', '0815': 'Glo', '0905': 'Glo',
            '0802': 'Airtel', '0808': 'Airtel', '0812': 'Airtel', '0901': 'Airtel', '0902': 'Airtel',
            '0809': '9mobile', '0817': '9mobile', '0818': '9mobile', '0908': '9mobile', '0909': '9mobile'
        }
        
        for prefix, provider in prefixes.items():
            if phone.startswith(prefix):
                return provider
        
        return 'Unknown'
    
    def get_state_region(self, state: str) -> str:
        """Get region for Nigerian state"""
        regions = {
            'North Central': ['FCT', 'Benue', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Plateau'],
            'North East': ['Adamawa', 'Bauchi', 'Borno', 'Gombe', 'Taraba', 'Yobe'],
            'North West': ['Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Sokoto', 'Zamfara'],
            'South East': ['Abia', 'Anambra', 'Ebonyi', 'Enugu', 'Imo'],
            'South South': ['Akwa Ibom', 'Bayelsa', 'Cross River', 'Delta', 'Edo', 'Rivers'],
            'South West': ['Ekiti', 'Lagos', 'Ogun', 'Ondo', 'Osun', 'Oyo']
        }
        
        for region, states in regions.items():
            if state in states:
                return region
        
        return 'Unknown'
    
    def is_business_hours(self, timestamp: datetime = None) -> bool:
        """Check if timestamp is within Nigerian business hours"""
        if timestamp is None:
            timestamp = datetime.now()
        
        # Convert to Lagos timezone
        import pytz
        lagos_tz = pytz.timezone(self.config.default_timezone)
        local_time = timestamp.astimezone(lagos_tz)
        
        # Check if weekday and within business hours
        if local_time.weekday() >= 5:  # Weekend
            return False
        
        start_hour = int(self.config.business_hours_start.split(':')[0])
        end_hour = int(self.config.business_hours_end.split(':')[0])
        
        return start_hour <= local_time.hour < end_hour

class DataProcessor:
    """Advanced data processing for customer analytics"""
    
    def __init__(self, config: CustomerAnalyticsConfig):
        self.config = config
        self.scaler = StandardScaler()
        self.label_encoders = {}
        self.banking_context = NigerianBankingContext(config)
        
    def load_customer_data(self, customer_id: str = None) -> pd.DataFrame:
        """Load customer data from database"""
        try:
            engine = create_engine(self.config.database_url)
            
            if customer_id:
                query = """
                SELECT c.*, t.*, a.*, p.*
                FROM customers c
                LEFT JOIN transactions t ON c.id = t.customer_id
                LEFT JOIN accounts a ON c.id = a.customer_id
                LEFT JOIN profiles p ON c.id = p.customer_id
                WHERE c.id = %s
                AND t.created_at >= NOW() - INTERVAL '%s days'
                ORDER BY t.created_at DESC
                """
                df = pd.read_sql(query, engine, params=[customer_id, self.config.lookback_days])
            else:
                query = """
                SELECT c.*, t.*, a.*, p.*
                FROM customers c
                LEFT JOIN transactions t ON c.id = t.customer_id
                LEFT JOIN accounts a ON c.id = a.customer_id
                LEFT JOIN profiles p ON c.id = p.customer_id
                WHERE t.created_at >= NOW() - INTERVAL '%s days'
                ORDER BY c.id, t.created_at DESC
                LIMIT 10000
                """
                df = pd.read_sql(query, engine, params=[self.config.lookbook_days])
            
            return df
            
        except Exception as e:
            logger.error(f"Error loading customer data: {e}")
            return pd.DataFrame()
    
    def engineer_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Engineer features for customer analytics"""
        if df.empty:
            return df
        
        logger.info("Engineering customer features...")
        
        # Basic customer features
        df['age'] = (datetime.now() - pd.to_datetime(df['date_of_birth'])).dt.days / 365.25
        df['account_age_days'] = (datetime.now() - pd.to_datetime(df['created_at'])).dt.days
        df['phone_provider'] = df['phone_number'].apply(self.banking_context.get_telecom_provider)
        df['state_region'] = df['state'].apply(self.banking_context.get_state_region)
        
        # Transaction features
        customer_features = []
        
        for customer_id in df['customer_id'].unique():
            customer_data = df[df['customer_id'] == customer_id]
            
            # Transaction volume features
            total_transactions = len(customer_data)
            total_amount = customer_data['amount'].sum()
            avg_transaction_amount = customer_data['amount'].mean()
            median_transaction_amount = customer_data['amount'].median()
            std_transaction_amount = customer_data['amount'].std()
            
            # Transaction frequency features
            days_active = customer_data['transaction_date'].nunique()
            avg_transactions_per_day = total_transactions / max(days_active, 1)
            
            # Transaction type distribution
            transaction_types = customer_data['transaction_type'].value_counts(normalize=True)
            
            # Channel usage
            channel_usage = customer_data['channel'].value_counts(normalize=True)
            
            # Time-based features
            customer_data['hour'] = pd.to_datetime(customer_data['created_at']).dt.hour
            customer_data['day_of_week'] = pd.to_datetime(customer_data['created_at']).dt.dayofweek
            customer_data['is_weekend'] = customer_data['day_of_week'].isin([5, 6])
            customer_data['is_business_hours'] = customer_data['created_at'].apply(
                lambda x: self.banking_context.is_business_hours(pd.to_datetime(x))
            )
            
            # Behavioral features
            weekend_transactions = customer_data[customer_data['is_weekend']]['amount'].sum()
            business_hours_transactions = customer_data[customer_data['is_business_hours']]['amount'].sum()
            
            # Recency, Frequency, Monetary (RFM) features
            last_transaction_date = customer_data['transaction_date'].max()
            recency = (datetime.now().date() - pd.to_datetime(last_transaction_date).date()).days
            frequency = total_transactions
            monetary = total_amount
            
            # Risk indicators
            large_transaction_count = len(customer_data[customer_data['amount'] > customer_data['amount'].quantile(0.95)])
            failed_transaction_count = len(customer_data[customer_data['status'] == 'failed'])
            failed_transaction_rate = failed_transaction_count / max(total_transactions, 1)
            
            # Geographic features
            unique_locations = customer_data['location'].nunique() if 'location' in customer_data.columns else 1
            
            # Account features
            account_balance = customer_data['balance'].iloc[-1] if 'balance' in customer_data.columns else 0
            min_balance = customer_data['balance'].min() if 'balance' in customer_data.columns else 0
            max_balance = customer_data['balance'].max() if 'balance' in customer_data.columns else 0
            
            # Product usage
            products_used = customer_data['product_type'].nunique() if 'product_type' in customer_data.columns else 1
            
            customer_features.append({
                'customer_id': customer_id,
                'total_transactions': total_transactions,
                'total_amount': total_amount,
                'avg_transaction_amount': avg_transaction_amount,
                'median_transaction_amount': median_transaction_amount,
                'std_transaction_amount': std_transaction_amount,
                'days_active': days_active,
                'avg_transactions_per_day': avg_transactions_per_day,
                'recency': recency,
                'frequency': frequency,
                'monetary': monetary,
                'large_transaction_count': large_transaction_count,
                'failed_transaction_count': failed_transaction_count,
                'failed_transaction_rate': failed_transaction_rate,
                'unique_locations': unique_locations,
                'account_balance': account_balance,
                'min_balance': min_balance,
                'max_balance': max_balance,
                'products_used': products_used,
                'weekend_transactions': weekend_transactions,
                'business_hours_transactions': business_hours_transactions,
                
                # Transaction type features
                'transfer_ratio': transaction_types.get('transfer', 0),
                'deposit_ratio': transaction_types.get('deposit', 0),
                'withdrawal_ratio': transaction_types.get('withdrawal', 0),
                'payment_ratio': transaction_types.get('payment', 0),
                
                # Channel features
                'mobile_ratio': channel_usage.get('mobile', 0),
                'web_ratio': channel_usage.get('web', 0),
                'ussd_ratio': channel_usage.get('ussd', 0),
                'pos_ratio': channel_usage.get('pos', 0),
                'atm_ratio': channel_usage.get('atm', 0),
                
                # Time features
                'avg_transaction_hour': customer_data['hour'].mean(),
                'weekend_transaction_ratio': len(customer_data[customer_data['is_weekend']]) / max(total_transactions, 1),
                'business_hours_ratio': len(customer_data[customer_data['is_business_hours']]) / max(total_transactions, 1),
            })
        
        features_df = pd.DataFrame(customer_features)
        
        # Merge with customer demographic data
        customer_demo = df[['customer_id', 'age', 'gender', 'state', 'state_region', 'phone_provider', 'account_age_days']].drop_duplicates()
        features_df = features_df.merge(customer_demo, on='customer_id', how='left')
        
        # Handle missing values
        features_df = features_df.fillna(0)
        
        logger.info(f"Engineered {len(features_df.columns)} features for {len(features_df)} customers")
        return features_df

class CustomerSegmentation:
    """Advanced customer segmentation using multiple ML techniques"""
    
    def __init__(self, config: CustomerAnalyticsConfig):
        self.config = config
        self.models = {}
        self.scalers = {}
        
    def rfm_segmentation(self, df: pd.DataFrame) -> pd.DataFrame:
        """RFM (Recency, Frequency, Monetary) based segmentation"""
        logger.info("Performing RFM segmentation...")
        
        # Calculate RFM scores
        df['R_score'] = pd.qcut(df['recency'].rank(method='first'), 5, labels=[5, 4, 3, 2, 1])
        df['F_score'] = pd.qcut(df['frequency'].rank(method='first'), 5, labels=[1, 2, 3, 4, 5])
        df['M_score'] = pd.qcut(df['monetary'].rank(method='first'), 5, labels=[1, 2, 3, 4, 5])
        
        # Combine RFM scores
        df['RFM_score'] = df['R_score'].astype(str) + df['F_score'].astype(str) + df['M_score'].astype(str)
        
        # Define customer segments
        def rfm_segment(rfm_score):
            if rfm_score in ['555', '554', '544', '545', '454', '455', '445']:
                return 'Champions'
            elif rfm_score in ['543', '444', '435', '355', '354', '345', '344', '335']:
                return 'Loyal Customers'
            elif rfm_score in ['512', '511', '422', '421', '412', '411', '311']:
                return 'Potential Loyalists'
            elif rfm_score in ['533', '532', '531', '523', '522', '521', '515', '514', '513', '425', '424', '413', '414', '415', '315', '314', '313']:
                return 'New Customers'
            elif rfm_score in ['155', '154', '144', '214', '215', '115', '114']:
                return 'Promising'
            elif rfm_score in ['155', '154', '144', '214', '215', '115', '114']:
                return 'Need Attention'
            elif rfm_score in ['331', '321', '231', '241', '251']:
                return 'About to Sleep'
            elif rfm_score in ['155', '154', '144', '214', '215', '115', '114']:
                return 'At Risk'
            elif rfm_score in ['125', '124', '123', '122', '121', '221', '131', '141', '151']:
                return 'Cannot Lose Them'
            elif rfm_score in ['332', '322', '231', '241', '251', '233', '232', '223', '222', '132', '123']:
                return 'Hibernating'
            else:
                return 'Lost'
        
        df['rfm_segment'] = df['RFM_score'].apply(rfm_segment)
        
        return df
    
    def kmeans_segmentation(self, df: pd.DataFrame, n_clusters: int = 5) -> pd.DataFrame:
        """K-means clustering for customer segmentation"""
        logger.info(f"Performing K-means segmentation with {n_clusters} clusters...")
        
        # Select features for clustering
        feature_columns = [col for col in df.columns if col not in ['customer_id', 'rfm_segment']]
        features = df[feature_columns].select_dtypes(include=[np.number])
        
        # Scale features
        scaler = StandardScaler()
        features_scaled = scaler.fit_transform(features)
        
        # Perform K-means clustering
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        df['kmeans_cluster'] = kmeans.fit_predict(features_scaled)
        
        # Store model and scaler
        self.models['kmeans'] = kmeans
        self.scalers['kmeans'] = scaler
        
        # Analyze clusters
        cluster_analysis = df.groupby('kmeans_cluster').agg({
            'total_transactions': 'mean',
            'total_amount': 'mean',
            'recency': 'mean',
            'frequency': 'mean',
            'monetary': 'mean',
            'failed_transaction_rate': 'mean',
            'account_balance': 'mean'
        }).round(2)
        
        logger.info(f"K-means cluster analysis:\n{cluster_analysis}")
        
        return df
    
    def hierarchical_segmentation(self, df: pd.DataFrame, n_clusters: int = 5) -> pd.DataFrame:
        """Hierarchical clustering for customer segmentation"""
        logger.info(f"Performing hierarchical segmentation with {n_clusters} clusters...")
        
        # Select features for clustering
        feature_columns = [col for col in df.columns if col not in ['customer_id', 'rfm_segment', 'kmeans_cluster']]
        features = df[feature_columns].select_dtypes(include=[np.number])
        
        # Scale features
        scaler = StandardScaler()
        features_scaled = scaler.fit_transform(features)
        
        # Perform hierarchical clustering
        hierarchical = AgglomerativeClustering(n_clusters=n_clusters)
        df['hierarchical_cluster'] = hierarchical.fit_predict(features_scaled)
        
        # Store model and scaler
        self.models['hierarchical'] = hierarchical
        self.scalers['hierarchical'] = scaler
        
        return df
    
    def advanced_segmentation(self, df: pd.DataFrame) -> pd.DataFrame:
        """Combine multiple segmentation techniques"""
        logger.info("Performing advanced multi-technique segmentation...")
        
        # Apply all segmentation techniques
        df = self.rfm_segmentation(df)
        df = self.kmeans_segmentation(df)
        df = self.hierarchical_segmentation(df)
        
        # Create ensemble segment
        def create_ensemble_segment(row):
            rfm = row['rfm_segment']
            kmeans = row['kmeans_cluster']
            hierarchical = row['hierarchical_cluster']
            
            # High-value customers
            if rfm in ['Champions', 'Loyal Customers'] and row['monetary'] > df['monetary'].quantile(0.8):
                return 'Premium'
            
            # At-risk customers
            elif rfm in ['At Risk', 'Cannot Lose Them'] or row['recency'] > 60:
                return 'At Risk'
            
            # New customers
            elif rfm in ['New Customers', 'Promising'] and row['account_age_days'] < 90:
                return 'New'
            
            # Active customers
            elif rfm in ['Potential Loyalists'] and row['frequency'] > df['frequency'].median():
                return 'Active'
            
            # Dormant customers
            elif rfm in ['Hibernating', 'About to Sleep'] or row['recency'] > 90:
                return 'Dormant'
            
            # Lost customers
            elif rfm == 'Lost' or row['recency'] > 180:
                return 'Lost'
            
            else:
                return 'Regular'
        
        df['ensemble_segment'] = df.apply(create_ensemble_segment, axis=1)
        
        # Segment analysis
        segment_summary = df.groupby('ensemble_segment').agg({
            'customer_id': 'count',
            'total_amount': 'mean',
            'frequency': 'mean',
            'recency': 'mean',
            'failed_transaction_rate': 'mean'
        }).round(2)
        
        logger.info(f"Ensemble segmentation summary:\n{segment_summary}")
        
        return df

class ChurnPrediction:
    """Advanced churn prediction using multiple ML models"""
    
    def __init__(self, config: CustomerAnalyticsConfig):
        self.config = config
        self.models = {}
        self.feature_importance = {}
        
    def prepare_churn_data(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
        """Prepare data for churn prediction"""
        logger.info("Preparing churn prediction data...")
        
        # Define churn based on recency and activity
        df['is_churned'] = (
            (df['recency'] > 90) |  # No transaction in 90 days
            (df['frequency'] < 2) |  # Less than 2 transactions
            (df['total_amount'] < 1000)  # Very low transaction volume
        ).astype(int)
        
        # Select features for churn prediction
        feature_columns = [
            'total_transactions', 'total_amount', 'avg_transaction_amount',
            'recency', 'frequency', 'monetary', 'failed_transaction_rate',
            'account_balance', 'products_used', 'unique_locations',
            'weekend_transaction_ratio', 'business_hours_ratio',
            'transfer_ratio', 'deposit_ratio', 'withdrawal_ratio',
            'mobile_ratio', 'web_ratio', 'ussd_ratio', 'age', 'account_age_days'
        ]
        
        # Handle categorical variables
        categorical_columns = ['gender', 'state_region', 'phone_provider']
        for col in categorical_columns:
            if col in df.columns:
                df[col] = LabelEncoder().fit_transform(df[col].fillna('Unknown'))
                feature_columns.append(col)
        
        X = df[feature_columns].fillna(0)
        y = df['is_churned']
        
        logger.info(f"Churn prediction dataset: {X.shape[0]} customers, {X.shape[1]} features")
        logger.info(f"Churn rate: {y.mean():.2%}")
        
        return X, y
    
    def train_churn_models(self, X: pd.DataFrame, y: pd.Series) -> Dict[str, Any]:
        """Train multiple churn prediction models"""
        logger.info("Training churn prediction models...")
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        models = {}
        results = {}
        
        # Random Forest
        logger.info("Training Random Forest...")
        rf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
        rf.fit(X_train, y_train)
        rf_pred = rf.predict(X_test)
        rf_prob = rf.predict_proba(X_test)[:, 1]
        
        models['random_forest'] = rf
        results['random_forest'] = {
            'accuracy': accuracy_score(y_test, rf_pred),
            'precision': precision_score(y_test, rf_pred),
            'recall': recall_score(y_test, rf_pred),
            'f1': f1_score(y_test, rf_pred),
            'auc': roc_auc_score(y_test, rf_prob)
        }
        
        # XGBoost
        logger.info("Training XGBoost...")
        xgb_model = xgb.XGBClassifier(random_state=42, eval_metric='logloss')
        xgb_model.fit(X_train, y_train)
        xgb_pred = xgb_model.predict(X_test)
        xgb_prob = xgb_model.predict_proba(X_test)[:, 1]
        
        models['xgboost'] = xgb_model
        results['xgboost'] = {
            'accuracy': accuracy_score(y_test, xgb_pred),
            'precision': precision_score(y_test, xgb_pred),
            'recall': recall_score(y_test, xgb_pred),
            'f1': f1_score(y_test, xgb_pred),
            'auc': roc_auc_score(y_test, xgb_prob)
        }
        
        # LightGBM
        logger.info("Training LightGBM...")
        lgb_model = lgb.LGBMClassifier(random_state=42, verbose=-1)
        lgb_model.fit(X_train, y_train)
        lgb_pred = lgb_model.predict(X_test)
        lgb_prob = lgb_model.predict_proba(X_test)[:, 1]
        
        models['lightgbm'] = lgb_model
        results['lightgbm'] = {
            'accuracy': accuracy_score(y_test, lgb_pred),
            'precision': precision_score(y_test, lgb_pred),
            'recall': recall_score(y_test, lgb_pred),
            'f1': f1_score(y_test, lgb_pred),
            'auc': roc_auc_score(y_test, lgb_prob)
        }
        
        # Neural Network
        logger.info("Training Neural Network...")
        nn_model = keras.Sequential([
            layers.Dense(128, activation='relu', input_shape=(X_train_scaled.shape[1],)),
            layers.Dropout(0.3),
            layers.Dense(64, activation='relu'),
            layers.Dropout(0.3),
            layers.Dense(32, activation='relu'),
            layers.Dense(1, activation='sigmoid')
        ])
        
        nn_model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
        nn_model.fit(X_train_scaled, y_train, epochs=50, batch_size=32, verbose=0,
                    validation_data=(X_test_scaled, y_test))
        
        nn_prob = nn_model.predict(X_test_scaled).flatten()
        nn_pred = (nn_prob > 0.5).astype(int)
        
        models['neural_network'] = nn_model
        results['neural_network'] = {
            'accuracy': accuracy_score(y_test, nn_pred),
            'precision': precision_score(y_test, nn_pred),
            'recall': recall_score(y_test, nn_pred),
            'f1': f1_score(y_test, nn_pred),
            'auc': roc_auc_score(y_test, nn_prob)
        }
        
        # Store models and results
        self.models = models
        self.scaler = scaler
        
        # Feature importance
        self.feature_importance['random_forest'] = dict(zip(X.columns, rf.feature_importances_))
        self.feature_importance['xgboost'] = dict(zip(X.columns, xgb_model.feature_importances_))
        self.feature_importance['lightgbm'] = dict(zip(X.columns, lgb_model.feature_importances_))
        
        # Log results
        for model_name, metrics in results.items():
            logger.info(f"{model_name} - AUC: {metrics['auc']:.3f}, F1: {metrics['f1']:.3f}")
            MODEL_ACCURACY.labels(model_type=f'churn_{model_name}').set(metrics['auc'])
        
        return results
    
    def predict_churn(self, customer_data: pd.DataFrame) -> Dict[str, Any]:
        """Predict churn probability for customers"""
        if not self.models:
            raise ValueError("Models not trained. Call train_churn_models first.")
        
        # Prepare features
        feature_columns = [
            'total_transactions', 'total_amount', 'avg_transaction_amount',
            'recency', 'frequency', 'monetary', 'failed_transaction_rate',
            'account_balance', 'products_used', 'unique_locations',
            'weekend_transaction_ratio', 'business_hours_ratio',
            'transfer_ratio', 'deposit_ratio', 'withdrawal_ratio',
            'mobile_ratio', 'web_ratio', 'ussd_ratio', 'age', 'account_age_days'
        ]
        
        X = customer_data[feature_columns].fillna(0)
        
        # Get predictions from all models
        predictions = {}
        
        # Random Forest
        rf_prob = self.models['random_forest'].predict_proba(X)[:, 1]
        predictions['random_forest'] = rf_prob
        
        # XGBoost
        xgb_prob = self.models['xgboost'].predict_proba(X)[:, 1]
        predictions['xgboost'] = xgb_prob
        
        # LightGBM
        lgb_prob = self.models['lightgbm'].predict_proba(X)[:, 1]
        predictions['lightgbm'] = lgb_prob
        
        # Neural Network
        X_scaled = self.scaler.transform(X)
        nn_prob = self.models['neural_network'].predict(X_scaled).flatten()
        predictions['neural_network'] = nn_prob
        
        # Ensemble prediction (average)
        ensemble_prob = np.mean([rf_prob, xgb_prob, lgb_prob, nn_prob], axis=0)
        predictions['ensemble'] = ensemble_prob
        
        # Risk categories
        risk_categories = []
        for prob in ensemble_prob:
            if prob >= 0.8:
                risk_categories.append('Very High')
            elif prob >= 0.6:
                risk_categories.append('High')
            elif prob >= 0.4:
                risk_categories.append('Medium')
            elif prob >= 0.2:
                risk_categories.append('Low')
            else:
                risk_categories.append('Very Low')
        
        return {
            'churn_probabilities': predictions,
            'risk_categories': risk_categories,
            'feature_importance': self.feature_importance
        }

class ProductRecommendation:
    """Advanced product recommendation system"""
    
    def __init__(self, config: CustomerAnalyticsConfig):
        self.config = config
        self.models = {}
        
    def prepare_recommendation_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Prepare data for product recommendation"""
        logger.info("Preparing product recommendation data...")
        
        # Define available products
        products = [
            'savings_account', 'current_account', 'fixed_deposit', 'loan',
            'credit_card', 'debit_card', 'mobile_banking', 'internet_banking',
            'pos_terminal', 'insurance', 'investment', 'forex'
        ]
        
        # Create product usage matrix
        for product in products:
            df[f'uses_{product}'] = np.random.choice([0, 1], size=len(df), p=[0.7, 0.3])
        
        return df
    
    def train_recommendation_model(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Train collaborative filtering recommendation model"""
        logger.info("Training product recommendation model...")
        
        # Create user-product matrix
        product_columns = [col for col in df.columns if col.startswith('uses_')]
        user_product_matrix = df[['customer_id'] + product_columns].set_index('customer_id')
        
        # Simple collaborative filtering using cosine similarity
        from sklearn.metrics.pairwise import cosine_similarity
        
        # Calculate user similarity
        user_similarity = cosine_similarity(user_product_matrix)
        user_similarity_df = pd.DataFrame(user_similarity, 
                                        index=user_product_matrix.index,
                                        columns=user_product_matrix.index)
        
        self.models['user_similarity'] = user_similarity_df
        self.models['user_product_matrix'] = user_product_matrix
        
        return {'model_type': 'collaborative_filtering', 'users': len(user_product_matrix)}
    
    def recommend_products(self, customer_id: str, n_recommendations: int = 5) -> List[Dict[str, Any]]:
        """Recommend products for a customer"""
        if not self.models:
            raise ValueError("Models not trained. Call train_recommendation_model first.")
        
        user_similarity_df = self.models['user_similarity']
        user_product_matrix = self.models['user_product_matrix']
        
        if customer_id not in user_product_matrix.index:
            return []
        
        # Find similar users
        similar_users = user_similarity_df[customer_id].sort_values(ascending=False)[1:11]  # Top 10 similar users
        
        # Get products used by similar users but not by target user
        target_user_products = user_product_matrix.loc[customer_id]
        recommendations = []
        
        for product in user_product_matrix.columns:
            if target_user_products[product] == 0:  # User doesn't have this product
                # Calculate recommendation score based on similar users
                score = 0
                for similar_user, similarity in similar_users.items():
                    if user_product_matrix.loc[similar_user, product] == 1:
                        score += similarity
                
                if score > 0:
                    recommendations.append({
                        'product': product.replace('uses_', ''),
                        'score': score,
                        'confidence': min(score / len(similar_users), 1.0)
                    })
        
        # Sort by score and return top N
        recommendations = sorted(recommendations, key=lambda x: x['score'], reverse=True)
        return recommendations[:n_recommendations]

class CustomerLifetimeValue:
    """Customer Lifetime Value (CLV) calculation and prediction"""
    
    def __init__(self, config: CustomerAnalyticsConfig):
        self.config = config
        self.models = {}
        
    def calculate_historical_clv(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate historical Customer Lifetime Value"""
        logger.info("Calculating historical CLV...")
        
        # Calculate CLV components
        df['avg_order_value'] = df['total_amount'] / df['total_transactions']
        df['purchase_frequency'] = df['frequency'] / (df['account_age_days'] / 365.25)
        df['customer_lifespan'] = df['account_age_days'] / 365.25
        
        # Historical CLV = Average Order Value × Purchase Frequency × Customer Lifespan
        df['historical_clv'] = df['avg_order_value'] * df['purchase_frequency'] * df['customer_lifespan']
        
        # Handle infinite and NaN values
        df['historical_clv'] = df['historical_clv'].replace([np.inf, -np.inf], 0).fillna(0)
        
        return df
    
    def predict_future_clv(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Predict future Customer Lifetime Value using ML"""
        logger.info("Training CLV prediction model...")
        
        # Prepare features for CLV prediction
        feature_columns = [
            'total_transactions', 'avg_transaction_amount', 'frequency',
            'recency', 'account_age_days', 'failed_transaction_rate',
            'products_used', 'mobile_ratio', 'age'
        ]
        
        X = df[feature_columns].fillna(0)
        y = df['historical_clv']
        
        # Remove outliers
        q99 = y.quantile(0.99)
        X = X[y <= q99]
        y = y[y <= q99]
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        # Train models
        models = {}
        results = {}
        
        # Random Forest Regressor
        rf = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
        rf.fit(X_train, y_train)
        rf_pred = rf.predict(X_test)
        
        models['random_forest'] = rf
        results['random_forest'] = {
            'mae': np.mean(np.abs(y_test - rf_pred)),
            'rmse': np.sqrt(np.mean((y_test - rf_pred) ** 2)),
            'r2': rf.score(X_test, y_test)
        }
        
        # XGBoost Regressor
        xgb_model = xgb.XGBRegressor(random_state=42)
        xgb_model.fit(X_train, y_train)
        xgb_pred = xgb_model.predict(X_test)
        
        models['xgboost'] = xgb_model
        results['xgboost'] = {
            'mae': np.mean(np.abs(y_test - xgb_pred)),
            'rmse': np.sqrt(np.mean((y_test - xgb_pred) ** 2)),
            'r2': xgb_model.score(X_test, y_test)
        }
        
        self.models = models
        
        # Log results
        for model_name, metrics in results.items():
            logger.info(f"CLV {model_name} - R²: {metrics['r2']:.3f}, RMSE: {metrics['rmse']:.2f}")
        
        return results
    
    def predict_clv(self, customer_data: pd.DataFrame) -> np.ndarray:
        """Predict CLV for customers"""
        if not self.models:
            raise ValueError("Models not trained. Call predict_future_clv first.")
        
        feature_columns = [
            'total_transactions', 'avg_transaction_amount', 'frequency',
            'recency', 'account_age_days', 'failed_transaction_rate',
            'products_used', 'mobile_ratio', 'age'
        ]
        
        X = customer_data[feature_columns].fillna(0)
        
        # Ensemble prediction
        rf_pred = self.models['random_forest'].predict(X)
        xgb_pred = self.models['xgboost'].predict(X)
        
        ensemble_pred = (rf_pred + xgb_pred) / 2
        
        return ensemble_pred

class CustomerAnalyticsEngine:
    """Main Customer Analytics Engine"""
    
    def __init__(self, config: CustomerAnalyticsConfig = None):
        self.config = config or CustomerAnalyticsConfig()
        self.data_processor = DataProcessor(self.config)
        self.segmentation = CustomerSegmentation(self.config)
        self.churn_prediction = ChurnPrediction(self.config)
        self.recommendation = ProductRecommendation(self.config)
        self.clv = CustomerLifetimeValue(self.config)
        self.banking_context = NigerianBankingContext(self.config)
        
        # Initialize Redis for caching
        self.redis_client = redis.from_url(self.config.redis_url)
        
        # Initialize encryption
        self.cipher = Fernet(self.config.encryption_key.encode())
        
        logger.info("Customer Analytics Engine initialized")
    
    def analyze_customer(self, customer_id: str) -> Dict[str, Any]:
        """Comprehensive customer analysis"""
        start_time = time.time()
        
        try:
            # Check cache first
            cache_key = f"customer_analysis:{customer_id}"
            cached_result = self.redis_client.get(cache_key)
            
            if cached_result:
                logger.info(f"Returning cached analysis for customer {customer_id}")
                return json.loads(cached_result)
            
            logger.info(f"Analyzing customer {customer_id}")
            
            # Load customer data
            df = self.data_processor.load_customer_data(customer_id)
            if df.empty:
                return {'error': 'Customer not found or no data available'}
            
            # Engineer features
            features_df = self.data_processor.engineer_features(df)
            
            # Customer segmentation
            segmented_df = self.segmentation.advanced_segmentation(features_df)
            customer_segment = segmented_df[segmented_df['customer_id'] == customer_id]['ensemble_segment'].iloc[0]
            
            # Churn prediction
            churn_results = self.churn_prediction.predict_churn(features_df[features_df['customer_id'] == customer_id])
            churn_probability = churn_results['churn_probabilities']['ensemble'][0]
            churn_risk = churn_results['risk_categories'][0]
            
            # Product recommendations
            recommendations = self.recommendation.recommend_products(customer_id)
            
            # CLV calculation
            clv_df = self.clv.calculate_historical_clv(features_df)
            historical_clv = clv_df[clv_df['customer_id'] == customer_id]['historical_clv'].iloc[0]
            predicted_clv = self.clv.predict_clv(features_df[features_df['customer_id'] == customer_id])[0]
            
            # Customer profile
            customer_row = features_df[features_df['customer_id'] == customer_id].iloc[0]
            
            result = {
                'customer_id': customer_id,
                'analysis_timestamp': datetime.now().isoformat(),
                'segment': customer_segment,
                'churn_risk': {
                    'probability': float(churn_probability),
                    'category': churn_risk,
                    'factors': self._get_churn_factors(customer_row)
                },
                'lifetime_value': {
                    'historical': float(historical_clv),
                    'predicted': float(predicted_clv),
                    'category': self._categorize_clv(predicted_clv)
                },
                'recommendations': recommendations,
                'profile': {
                    'total_transactions': int(customer_row['total_transactions']),
                    'total_amount': float(customer_row['total_amount']),
                    'avg_transaction_amount': float(customer_row['avg_transaction_amount']),
                    'recency_days': int(customer_row['recency']),
                    'frequency': int(customer_row['frequency']),
                    'account_age_days': int(customer_row['account_age_days']),
                    'preferred_channel': self._get_preferred_channel(customer_row),
                    'risk_indicators': {
                        'failed_transaction_rate': float(customer_row['failed_transaction_rate']),
                        'large_transactions': int(customer_row['large_transaction_count']),
                        'unique_locations': int(customer_row['unique_locations'])
                    }
                },
                'insights': self._generate_insights(customer_row, customer_segment, churn_probability),
                'processing_time': time.time() - start_time
            }
            
            # Cache result for 1 hour
            self.redis_client.setex(cache_key, 3600, json.dumps(result))
            
            ANALYTICS_REQUESTS.labels(endpoint='analyze_customer', status='success').inc()
            ANALYTICS_DURATION.labels(operation='analyze_customer').observe(time.time() - start_time)
            
            return result
            
        except Exception as e:
            logger.error(f"Error analyzing customer {customer_id}: {e}")
            ANALYTICS_REQUESTS.labels(endpoint='analyze_customer', status='error').inc()
            return {'error': str(e)}
    
    def batch_analyze_customers(self, customer_ids: List[str]) -> Dict[str, Any]:
        """Batch analysis of multiple customers"""
        start_time = time.time()
        
        logger.info(f"Batch analyzing {len(customer_ids)} customers")
        
        results = {}
        
        # Use ThreadPoolExecutor for parallel processing
        with ThreadPoolExecutor(max_workers=self.config.max_workers) as executor:
            future_to_customer = {
                executor.submit(self.analyze_customer, customer_id): customer_id
                for customer_id in customer_ids
            }
            
            for future in future_to_customer:
                customer_id = future_to_customer[future]
                try:
                    result = future.result()
                    results[customer_id] = result
                except Exception as e:
                    logger.error(f"Error in batch analysis for customer {customer_id}: {e}")
                    results[customer_id] = {'error': str(e)}
        
        batch_result = {
            'batch_id': str(uuid.uuid4()),
            'timestamp': datetime.now().isoformat(),
            'total_customers': len(customer_ids),
            'successful_analyses': len([r for r in results.values() if 'error' not in r]),
            'failed_analyses': len([r for r in results.values() if 'error' in r]),
            'results': results,
            'processing_time': time.time() - start_time
        }
        
        ANALYTICS_REQUESTS.labels(endpoint='batch_analyze', status='success').inc()
        ANALYTICS_DURATION.labels(operation='batch_analyze').observe(time.time() - start_time)
        
        return batch_result
    
    def get_segment_analysis(self) -> Dict[str, Any]:
        """Get comprehensive segment analysis"""
        start_time = time.time()
        
        try:
            # Load all customer data
            df = self.data_processor.load_customer_data()
            if df.empty:
                return {'error': 'No customer data available'}
            
            # Engineer features
            features_df = self.data_processor.engineer_features(df)
            
            # Perform segmentation
            segmented_df = self.segmentation.advanced_segmentation(features_df)
            
            # Analyze segments
            segment_analysis = segmented_df.groupby('ensemble_segment').agg({
                'customer_id': 'count',
                'total_amount': ['mean', 'sum'],
                'frequency': 'mean',
                'recency': 'mean',
                'monetary': 'mean',
                'failed_transaction_rate': 'mean',
                'account_balance': 'mean',
                'age': 'mean',
                'account_age_days': 'mean'
            }).round(2)
            
            # Convert to dictionary
            segment_dict = {}
            for segment in segment_analysis.index:
                segment_dict[segment] = {
                    'customer_count': int(segment_analysis.loc[segment, ('customer_id', 'count')]),
                    'avg_total_amount': float(segment_analysis.loc[segment, ('total_amount', 'mean')]),
                    'total_revenue': float(segment_analysis.loc[segment, ('total_amount', 'sum')]),
                    'avg_frequency': float(segment_analysis.loc[segment, ('frequency', 'mean')]),
                    'avg_recency': float(segment_analysis.loc[segment, ('recency', 'mean')]),
                    'avg_monetary': float(segment_analysis.loc[segment, ('monetary', 'mean')]),
                    'avg_failed_rate': float(segment_analysis.loc[segment, ('failed_transaction_rate', 'mean')]),
                    'avg_balance': float(segment_analysis.loc[segment, ('account_balance', 'mean')]),
                    'avg_age': float(segment_analysis.loc[segment, ('age', 'mean')]),
                    'avg_account_age': float(segment_analysis.loc[segment, ('account_age_days', 'mean')])
                }
            
            result = {
                'analysis_timestamp': datetime.now().isoformat(),
                'total_customers': len(segmented_df),
                'segments': segment_dict,
                'processing_time': time.time() - start_time
            }
            
            ANALYTICS_REQUESTS.labels(endpoint='segment_analysis', status='success').inc()
            ANALYTICS_DURATION.labels(operation='segment_analysis').observe(time.time() - start_time)
            
            return result
            
        except Exception as e:
            logger.error(f"Error in segment analysis: {e}")
            ANALYTICS_REQUESTS.labels(endpoint='segment_analysis', status='error').inc()
            return {'error': str(e)}
    
    def train_models(self) -> Dict[str, Any]:
        """Train all ML models"""
        start_time = time.time()
        
        try:
            logger.info("Training all ML models...")
            
            # Load data
            df = self.data_processor.load_customer_data()
            if df.empty:
                return {'error': 'No training data available'}
            
            # Engineer features
            features_df = self.data_processor.engineer_features(df)
            
            results = {}
            
            # Train churn prediction models
            X, y = self.churn_prediction.prepare_churn_data(features_df)
            churn_results = self.churn_prediction.train_churn_models(X, y)
            results['churn_prediction'] = churn_results
            
            # Train recommendation model
            recommendation_df = self.recommendation.prepare_recommendation_data(features_df)
            rec_results = self.recommendation.train_recommendation_model(recommendation_df)
            results['recommendation'] = rec_results
            
            # Train CLV model
            clv_df = self.clv.calculate_historical_clv(features_df)
            clv_results = self.clv.predict_future_clv(clv_df)
            results['clv_prediction'] = clv_results
            
            # Update active customers metric
            ACTIVE_CUSTOMERS.set(len(features_df))
            
            result = {
                'training_timestamp': datetime.now().isoformat(),
                'training_data_size': len(features_df),
                'models_trained': list(results.keys()),
                'results': results,
                'processing_time': time.time() - start_time
            }
            
            logger.info(f"Model training completed in {time.time() - start_time:.2f} seconds")
            
            return result
            
        except Exception as e:
            logger.error(f"Error training models: {e}")
            return {'error': str(e)}
    
    def _get_churn_factors(self, customer_row: pd.Series) -> List[str]:
        """Get factors contributing to churn risk"""
        factors = []
        
        if customer_row['recency'] > 60:
            factors.append('Long time since last transaction')
        
        if customer_row['frequency'] < 5:
            factors.append('Low transaction frequency')
        
        if customer_row['failed_transaction_rate'] > 0.1:
            factors.append('High failed transaction rate')
        
        if customer_row['account_balance'] < 1000:
            factors.append('Low account balance')
        
        if customer_row['products_used'] < 2:
            factors.append('Limited product usage')
        
        return factors
    
    def _categorize_clv(self, clv: float) -> str:
        """Categorize CLV value"""
        if clv >= 100000:
            return 'Very High'
        elif clv >= 50000:
            return 'High'
        elif clv >= 20000:
            return 'Medium'
        elif clv >= 5000:
            return 'Low'
        else:
            return 'Very Low'
    
    def _get_preferred_channel(self, customer_row: pd.Series) -> str:
        """Get customer's preferred channel"""
        channels = {
            'mobile': customer_row['mobile_ratio'],
            'web': customer_row['web_ratio'],
            'ussd': customer_row['ussd_ratio'],
            'pos': customer_row['pos_ratio'],
            'atm': customer_row['atm_ratio']
        }
        
        return max(channels, key=channels.get)
    
    def _generate_insights(self, customer_row: pd.Series, segment: str, churn_prob: float) -> List[str]:
        """Generate actionable insights"""
        insights = []
        
        # Segment-based insights
        if segment == 'Premium':
            insights.append('High-value customer - provide premium service and exclusive offers')
        elif segment == 'At Risk':
            insights.append('Customer at risk - implement retention strategies immediately')
        elif segment == 'New':
            insights.append('New customer - focus on onboarding and engagement')
        elif segment == 'Dormant':
            insights.append('Dormant customer - re-engagement campaign needed')
        
        # Churn-based insights
        if churn_prob > 0.7:
            insights.append('High churn risk - urgent intervention required')
        elif churn_prob > 0.5:
            insights.append('Medium churn risk - proactive retention measures recommended')
        
        # Behavioral insights
        if customer_row['mobile_ratio'] > 0.8:
            insights.append('Mobile-first customer - optimize mobile experience')
        
        if customer_row['weekend_transaction_ratio'] > 0.3:
            insights.append('Active weekend user - consider weekend-specific offers')
        
        if customer_row['failed_transaction_rate'] > 0.05:
            insights.append('High failure rate - investigate technical issues')
        
        return insights

# Flask API
app = Flask(__name__)
CORS(app)
app.wsgi_app = ProxyFix(app.wsgi_app)

# Rate limiting
limiter = Limiter(
    app,
    key_func=get_remote_address,
    default_limits=["1000 per hour"]
)

# Initialize analytics engine
analytics_engine = CustomerAnalyticsEngine()

def require_api_key(f):
    """Decorator to require API key authentication"""
    def decorated_function(*args, **kwargs):
        api_key = request.headers.get('X-API-Key')
        if not api_key or api_key != analytics_engine.config.api_key:
            return jsonify({'error': 'Invalid API key'}), 401
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'customer-analytics-engine',
        'timestamp': datetime.now().isoformat(),
        'version': '2.0.0'
    })

@app.route('/metrics', methods=['GET'])
def metrics():
    """Prometheus metrics endpoint"""
    return generate_latest()

@app.route('/api/v1/customer/<customer_id>/analyze', methods=['GET'])
@require_api_key
@limiter.limit("100 per hour")
def analyze_customer(customer_id):
    """Analyze individual customer"""
    result = analytics_engine.analyze_customer(customer_id)
    return jsonify(result)

@app.route('/api/v1/customers/batch-analyze', methods=['POST'])
@require_api_key
@limiter.limit("10 per hour")
def batch_analyze_customers():
    """Batch analyze multiple customers"""
    data = request.get_json()
    
    if not data or 'customer_ids' not in data:
        return jsonify({'error': 'customer_ids required'}), 400
    
    customer_ids = data['customer_ids']
    
    if not isinstance(customer_ids, list) or len(customer_ids) > 100:
        return jsonify({'error': 'customer_ids must be a list with max 100 items'}), 400
    
    result = analytics_engine.batch_analyze_customers(customer_ids)
    return jsonify(result)

@app.route('/api/v1/segments/analyze', methods=['GET'])
@require_api_key
@limiter.limit("50 per hour")
def analyze_segments():
    """Get segment analysis"""
    result = analytics_engine.get_segment_analysis()
    return jsonify(result)

@app.route('/api/v1/models/train', methods=['POST'])
@require_api_key
@limiter.limit("5 per hour")
def train_models():
    """Train ML models"""
    result = analytics_engine.train_models()
    return jsonify(result)

@app.route('/api/v1/customer/<customer_id>/recommendations', methods=['GET'])
@require_api_key
@limiter.limit("200 per hour")
def get_recommendations(customer_id):
    """Get product recommendations for customer"""
    n_recommendations = request.args.get('limit', 5, type=int)
    
    try:
        recommendations = analytics_engine.recommendation.recommend_products(customer_id, n_recommendations)
        return jsonify({
            'customer_id': customer_id,
            'recommendations': recommendations,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/dashboard', methods=['GET'])
@require_api_key
def get_dashboard_data():
    """Get dashboard data"""
    try:
        # Get basic statistics
        df = analytics_engine.data_processor.load_customer_data()
        
        if df.empty:
            return jsonify({'error': 'No data available'}), 404
        
        features_df = analytics_engine.data_processor.engineer_features(df)
        
        # Calculate dashboard metrics
        total_customers = len(features_df)
        active_customers = len(features_df[features_df['recency'] <= 30])
        high_value_customers = len(features_df[features_df['monetary'] > features_df['monetary'].quantile(0.8)])
        at_risk_customers = len(features_df[features_df['recency'] > 90])
        
        # Revenue metrics
        total_revenue = features_df['total_amount'].sum()
        avg_clv = features_df['monetary'].mean()
        
        # Channel distribution
        channel_data = {
            'mobile': features_df['mobile_ratio'].mean(),
            'web': features_df['web_ratio'].mean(),
            'ussd': features_df['ussd_ratio'].mean(),
            'pos': features_df['pos_ratio'].mean(),
            'atm': features_df['atm_ratio'].mean()
        }
        
        return jsonify({
            'timestamp': datetime.now().isoformat(),
            'metrics': {
                'total_customers': int(total_customers),
                'active_customers': int(active_customers),
                'high_value_customers': int(high_value_customers),
                'at_risk_customers': int(at_risk_customers),
                'total_revenue': float(total_revenue),
                'avg_clv': float(avg_clv),
                'activity_rate': float(active_customers / total_customers),
                'risk_rate': float(at_risk_customers / total_customers)
            },
            'channel_distribution': channel_data
        })
        
    except Exception as e:
        logger.error(f"Error getting dashboard data: {e}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize models on startup
    logger.info("Initializing Customer Analytics Engine...")
    
    # Train models in background
    import threading
    
    def train_models_background():
        time.sleep(10)  # Wait for app to start
        try:
            analytics_engine.train_models()
            logger.info("Initial model training completed")
        except Exception as e:
            logger.error(f"Error in initial model training: {e}")
    
    training_thread = threading.Thread(target=train_models_background)
    training_thread.daemon = True
    training_thread.start()
    
    # Start Flask app
    app.run(
        host=analytics_engine.config.api_host,
        port=analytics_engine.config.api_port,
        debug=analytics_engine.config.debug_mode,
        threaded=True
    )

