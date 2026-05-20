"""
Customer Analytics Models
Advanced ML models for customer behavior analysis, segmentation, and lifetime value prediction
"""

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.cluster import KMeans, DBSCAN, AgglomerativeClustering
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler, LabelEncoder, MinMaxScaler
from sklearn.decomposition import PCA, FactorAnalysis
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import silhouette_score, calinski_harabasz_score, davies_bouldin_score
import xgboost as xgb
import lightgbm as lgb
from lifelines import CoxPHFitter, KaplanMeierFitter
from lifelines.utils import concordance_index
import matplotlib.pyplot as plt
import seaborn as sns
from typing import Dict, List, Tuple, Optional, Any, Union
import joblib
import json
import logging
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from enum import Enum
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CustomerSegment(Enum):
    """Customer segment types"""
    HIGH_VALUE = "high_value"
    MEDIUM_VALUE = "medium_value"
    LOW_VALUE = "low_value"
    NEW_CUSTOMER = "new_customer"
    AT_RISK = "at_risk"
    CHURNED = "churned"
    DORMANT = "dormant"
    FREQUENT_USER = "frequent_user"
    OCCASIONAL_USER = "occasional_user"

class RiskCategory(Enum):
    """Customer risk categories"""
    LOW_RISK = "low_risk"
    MEDIUM_RISK = "medium_risk"
    HIGH_RISK = "high_risk"
    VERY_HIGH_RISK = "very_high_risk"

@dataclass
class CustomerProfile:
    """Comprehensive customer profile"""
    customer_id: str
    demographic_features: Dict[str, Any]
    behavioral_features: Dict[str, float]
    transactional_features: Dict[str, float]
    engagement_features: Dict[str, float]
    risk_features: Dict[str, float]
    segment: CustomerSegment
    risk_category: RiskCategory
    lifetime_value: float
    churn_probability: float
    next_best_action: str
    created_at: datetime
    updated_at: datetime

@dataclass
class CustomerInsights:
    """Customer analytics insights"""
    customer_id: str
    segment: CustomerSegment
    segment_confidence: float
    lifetime_value_prediction: float
    churn_probability: float
    risk_score: float
    engagement_score: float
    satisfaction_score: float
    recommendations: List[str]
    key_behaviors: List[str]
    trends: Dict[str, float]
    next_best_actions: List[str]
    timestamp: datetime

class CustomerFeatureEngineering:
    """Advanced feature engineering for customer analytics"""
    
    def __init__(self):
        self.scalers = {}
        self.encoders = {}
        
    def create_demographic_features(self, customers_df: pd.DataFrame) -> pd.DataFrame:
        """Create demographic features"""
        features_df = customers_df.copy()
        
        # Age-based features
        if 'date_of_birth' in features_df.columns:
            features_df['age'] = (datetime.now() - pd.to_datetime(features_df['date_of_birth'])).dt.days / 365.25
            features_df['age_group'] = pd.cut(features_df['age'], 
                                            bins=[0, 25, 35, 45, 55, 65, 100], 
                                            labels=['18-25', '26-35', '36-45', '46-55', '56-65', '65+'])
        
        # Income-based features
        if 'income' in features_df.columns:
            features_df['income_log'] = np.log1p(features_df['income'])
            features_df['income_quartile'] = pd.qcut(features_df['income'], q=4, labels=['Q1', 'Q2', 'Q3', 'Q4'])
        
        # Location-based features
        if 'location' in features_df.columns:
            # Extract urban/rural classification (simplified)
            features_df['is_urban'] = features_df['location'].str.contains('urban|city', case=False, na=False)
        
        # Education features
        if 'education' in features_df.columns:
            education_mapping = {
                'primary': 1, 'secondary': 2, 'tertiary': 3, 'university': 4, 'postgraduate': 5
            }
            features_df['education_level'] = features_df['education'].map(education_mapping).fillna(0)
        
        return features_df
    
    def create_behavioral_features(self, transactions_df: pd.DataFrame, 
                                 customers_df: pd.DataFrame) -> pd.DataFrame:
        """Create behavioral features from transaction data"""
        # Transaction frequency features
        freq_features = transactions_df.groupby('customer_id').agg({
            'transaction_id': 'count',
            'amount': ['sum', 'mean', 'std', 'min', 'max'],
            'timestamp': ['min', 'max']
        }).round(2)
        
        freq_features.columns = [
            'transaction_count', 'total_amount', 'avg_amount', 'std_amount', 
            'min_amount', 'max_amount', 'first_transaction', 'last_transaction'
        ]
        
        # Calculate customer tenure
        freq_features['tenure_days'] = (
            pd.to_datetime(freq_features['last_transaction']) - 
            pd.to_datetime(freq_features['first_transaction'])
        ).dt.days
        
        # Transaction patterns
        freq_features['avg_transactions_per_day'] = (
            freq_features['transaction_count'] / (freq_features['tenure_days'] + 1)
        )
        
        # Recency, Frequency, Monetary (RFM) features
        current_date = datetime.now()
        freq_features['recency_days'] = (
            current_date - pd.to_datetime(freq_features['last_transaction'])
        ).dt.days
        
        freq_features['frequency_score'] = freq_features['transaction_count']
        freq_features['monetary_score'] = freq_features['total_amount']
        
        # Time-based patterns
        transactions_df['hour'] = pd.to_datetime(transactions_df['timestamp']).dt.hour
        transactions_df['day_of_week'] = pd.to_datetime(transactions_df['timestamp']).dt.dayofweek
        transactions_df['is_weekend'] = transactions_df['day_of_week'].isin([5, 6])
        
        time_patterns = transactions_df.groupby('customer_id').agg({
            'hour': lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else 12,
            'is_weekend': 'mean'
        })
        
        time_patterns.columns = ['preferred_hour', 'weekend_usage_rate']
        
        # Transaction type diversity
        type_diversity = transactions_df.groupby('customer_id')['transaction_type'].nunique()
        type_diversity.name = 'transaction_type_diversity'
        
        # Combine all behavioral features
        behavioral_features = freq_features.join([time_patterns, type_diversity], how='left')
        behavioral_features = behavioral_features.fillna(0)
        
        return behavioral_features
    
    def create_engagement_features(self, interactions_df: pd.DataFrame) -> pd.DataFrame:
        """Create customer engagement features"""
        if interactions_df.empty:
            return pd.DataFrame()
        
        engagement_features = interactions_df.groupby('customer_id').agg({
            'interaction_type': 'count',
            'channel': 'nunique',
            'duration': ['sum', 'mean'],
            'satisfaction_score': 'mean',
            'timestamp': ['min', 'max', 'count']
        }).round(2)
        
        engagement_features.columns = [
            'total_interactions', 'channel_diversity', 'total_engagement_time',
            'avg_engagement_time', 'avg_satisfaction', 'first_interaction',
            'last_interaction', 'interaction_frequency'
        ]
        
        # Calculate engagement recency
        current_date = datetime.now()
        engagement_features['engagement_recency'] = (
            current_date - pd.to_datetime(engagement_features['last_interaction'])
        ).dt.days
        
        # Engagement consistency
        engagement_features['engagement_consistency'] = (
            engagement_features['interaction_frequency'] / 
            (engagement_features['engagement_recency'] + 1)
        )
        
        return engagement_features.fillna(0)
    
    def create_risk_features(self, transactions_df: pd.DataFrame, 
                           fraud_alerts_df: pd.DataFrame = None) -> pd.DataFrame:
        """Create risk-related features"""
        risk_features = pd.DataFrame(index=transactions_df['customer_id'].unique())
        
        # Transaction velocity risk
        velocity_risk = transactions_df.groupby('customer_id').apply(
            lambda x: self._calculate_velocity_risk(x)
        )
        risk_features['velocity_risk'] = velocity_risk
        
        # Amount pattern risk
        amount_risk = transactions_df.groupby('customer_id').apply(
            lambda x: self._calculate_amount_risk(x)
        )
        risk_features['amount_pattern_risk'] = amount_risk
        
        # Time pattern risk
        time_risk = transactions_df.groupby('customer_id').apply(
            lambda x: self._calculate_time_pattern_risk(x)
        )
        risk_features['time_pattern_risk'] = time_risk
        
        # Fraud alert features
        if fraud_alerts_df is not None and not fraud_alerts_df.empty:
            fraud_features = fraud_alerts_df.groupby('customer_id').agg({
                'alert_id': 'count',
                'severity': 'mean',
                'resolved': 'mean'
            })
            fraud_features.columns = ['fraud_alert_count', 'avg_alert_severity', 'resolution_rate']
            risk_features = risk_features.join(fraud_features, how='left')
        
        return risk_features.fillna(0)
    
    def _calculate_velocity_risk(self, customer_transactions: pd.DataFrame) -> float:
        """Calculate velocity-based risk score"""
        if len(customer_transactions) < 2:
            return 0.0
        
        # Calculate transaction intervals
        timestamps = pd.to_datetime(customer_transactions['timestamp']).sort_values()
        intervals = timestamps.diff().dt.total_seconds() / 3600  # Hours between transactions
        
        # Risk increases with very short intervals
        short_intervals = (intervals < 1).sum()  # Transactions within 1 hour
        velocity_risk = min(short_intervals / len(intervals), 1.0)
        
        return velocity_risk
    
    def _calculate_amount_risk(self, customer_transactions: pd.DataFrame) -> float:
        """Calculate amount pattern risk score"""
        amounts = customer_transactions['amount']
        
        if len(amounts) < 3:
            return 0.0
        
        # Risk based on amount volatility
        cv = amounts.std() / amounts.mean() if amounts.mean() > 0 else 0
        
        # Risk based on outliers
        q75, q25 = amounts.quantile([0.75, 0.25])
        iqr = q75 - q25
        outliers = ((amounts < (q25 - 1.5 * iqr)) | (amounts > (q75 + 1.5 * iqr))).sum()
        outlier_rate = outliers / len(amounts)
        
        amount_risk = min((cv + outlier_rate) / 2, 1.0)
        return amount_risk
    
    def _calculate_time_pattern_risk(self, customer_transactions: pd.DataFrame) -> float:
        """Calculate time pattern risk score"""
        timestamps = pd.to_datetime(customer_transactions['timestamp'])
        hours = timestamps.dt.hour
        
        # Risk increases for unusual hours (late night/early morning)
        unusual_hours = ((hours < 6) | (hours > 22)).sum()
        time_risk = min(unusual_hours / len(hours), 1.0)
        
        return time_risk

class CustomerSegmentationModel:
    """Advanced customer segmentation using multiple algorithms"""
    
    def __init__(self):
        self.models = {}
        self.scalers = {}
        self.feature_importance = {}
        self.segment_profiles = {}
        
    def prepare_segmentation_features(self, customer_data: pd.DataFrame) -> pd.DataFrame:
        """Prepare features for segmentation"""
        # Select key features for segmentation
        segmentation_features = [
            'total_amount', 'avg_amount', 'transaction_count', 'recency_days',
            'frequency_score', 'monetary_score', 'tenure_days', 'transaction_type_diversity',
            'avg_transactions_per_day', 'weekend_usage_rate'
        ]
        
        # Filter available features
        available_features = [f for f in segmentation_features if f in customer_data.columns]
        features_df = customer_data[available_features].fillna(0)
        
        return features_df
    
    def perform_kmeans_segmentation(self, features_df: pd.DataFrame, n_clusters: int = 5) -> Dict[str, Any]:
        """Perform K-means clustering"""
        # Scale features
        scaler = StandardScaler()
        features_scaled = scaler.fit_transform(features_df)
        
        # Fit K-means
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        cluster_labels = kmeans.fit_predict(features_scaled)
        
        # Calculate metrics
        silhouette_avg = silhouette_score(features_scaled, cluster_labels)
        calinski_harabasz = calinski_harabasz_score(features_scaled, cluster_labels)
        davies_bouldin = davies_bouldin_score(features_scaled, cluster_labels)
        
        # Store model
        self.models['kmeans'] = kmeans
        self.scalers['kmeans'] = scaler
        
        # Create segment profiles
        segment_profiles = self._create_segment_profiles(features_df, cluster_labels)
        self.segment_profiles['kmeans'] = segment_profiles
        
        return {
            'labels': cluster_labels,
            'silhouette_score': silhouette_avg,
            'calinski_harabasz_score': calinski_harabasz,
            'davies_bouldin_score': davies_bouldin,
            'segment_profiles': segment_profiles
        }
    
    def perform_dbscan_segmentation(self, features_df: pd.DataFrame, 
                                  eps: float = 0.5, min_samples: int = 5) -> Dict[str, Any]:
        """Perform DBSCAN clustering"""
        # Scale features
        scaler = StandardScaler()
        features_scaled = scaler.fit_transform(features_df)
        
        # Fit DBSCAN
        dbscan = DBSCAN(eps=eps, min_samples=min_samples)
        cluster_labels = dbscan.fit_predict(features_scaled)
        
        # Calculate metrics (excluding noise points)
        if len(set(cluster_labels)) > 1:
            mask = cluster_labels != -1
            if mask.sum() > 1:
                silhouette_avg = silhouette_score(features_scaled[mask], cluster_labels[mask])
            else:
                silhouette_avg = 0
        else:
            silhouette_avg = 0
        
        # Store model
        self.models['dbscan'] = dbscan
        self.scalers['dbscan'] = scaler
        
        # Create segment profiles
        segment_profiles = self._create_segment_profiles(features_df, cluster_labels)
        self.segment_profiles['dbscan'] = segment_profiles
        
        return {
            'labels': cluster_labels,
            'silhouette_score': silhouette_avg,
            'n_clusters': len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0),
            'noise_points': (cluster_labels == -1).sum(),
            'segment_profiles': segment_profiles
        }
    
    def perform_hierarchical_segmentation(self, features_df: pd.DataFrame, 
                                        n_clusters: int = 5) -> Dict[str, Any]:
        """Perform hierarchical clustering"""
        # Scale features
        scaler = StandardScaler()
        features_scaled = scaler.fit_transform(features_df)
        
        # Fit hierarchical clustering
        hierarchical = AgglomerativeClustering(n_clusters=n_clusters, linkage='ward')
        cluster_labels = hierarchical.fit_predict(features_scaled)
        
        # Calculate metrics
        silhouette_avg = silhouette_score(features_scaled, cluster_labels)
        calinski_harabasz = calinski_harabasz_score(features_scaled, cluster_labels)
        davies_bouldin = davies_bouldin_score(features_scaled, cluster_labels)
        
        # Store model
        self.models['hierarchical'] = hierarchical
        self.scalers['hierarchical'] = scaler
        
        # Create segment profiles
        segment_profiles = self._create_segment_profiles(features_df, cluster_labels)
        self.segment_profiles['hierarchical'] = segment_profiles
        
        return {
            'labels': cluster_labels,
            'silhouette_score': silhouette_avg,
            'calinski_harabasz_score': calinski_harabasz,
            'davies_bouldin_score': davies_bouldin,
            'segment_profiles': segment_profiles
        }
    
    def _create_segment_profiles(self, features_df: pd.DataFrame, 
                               cluster_labels: np.ndarray) -> Dict[int, Dict[str, float]]:
        """Create profiles for each segment"""
        profiles = {}
        
        for cluster_id in set(cluster_labels):
            if cluster_id == -1:  # Skip noise points in DBSCAN
                continue
                
            cluster_mask = cluster_labels == cluster_id
            cluster_data = features_df[cluster_mask]
            
            profile = {
                'size': cluster_mask.sum(),
                'percentage': (cluster_mask.sum() / len(cluster_labels)) * 100
            }
            
            # Calculate feature statistics
            for feature in features_df.columns:
                profile[f'{feature}_mean'] = cluster_data[feature].mean()
                profile[f'{feature}_median'] = cluster_data[feature].median()
                profile[f'{feature}_std'] = cluster_data[feature].std()
            
            profiles[cluster_id] = profile
        
        return profiles
    
    def assign_business_segments(self, features_df: pd.DataFrame, 
                               cluster_labels: np.ndarray) -> np.ndarray:
        """Assign business-meaningful segment names"""
        business_segments = np.full(len(cluster_labels), CustomerSegment.LOW_VALUE.value, dtype=object)
        
        # Calculate RFM scores for business logic
        rfm_data = features_df[['recency_days', 'frequency_score', 'monetary_score']].copy()
        
        # Normalize RFM scores
        rfm_data['R_score'] = pd.qcut(rfm_data['recency_days'], q=5, labels=[5,4,3,2,1])
        rfm_data['F_score'] = pd.qcut(rfm_data['frequency_score'].rank(method='first'), q=5, labels=[1,2,3,4,5])
        rfm_data['M_score'] = pd.qcut(rfm_data['monetary_score'].rank(method='first'), q=5, labels=[1,2,3,4,5])
        
        # Convert to numeric
        rfm_data['R_score'] = pd.to_numeric(rfm_data['R_score'])
        rfm_data['F_score'] = pd.to_numeric(rfm_data['F_score'])
        rfm_data['M_score'] = pd.to_numeric(rfm_data['M_score'])
        
        # Business rules for segmentation
        for i in range(len(business_segments)):
            r, f, m = rfm_data.iloc[i][['R_score', 'F_score', 'M_score']]
            
            if r >= 4 and f >= 4 and m >= 4:
                business_segments[i] = CustomerSegment.HIGH_VALUE.value
            elif r >= 3 and f >= 3 and m >= 3:
                business_segments[i] = CustomerSegment.MEDIUM_VALUE.value
            elif r <= 2:
                business_segments[i] = CustomerSegment.AT_RISK.value
            elif f >= 4:
                business_segments[i] = CustomerSegment.FREQUENT_USER.value
            elif f <= 2:
                business_segments[i] = CustomerSegment.OCCASIONAL_USER.value
            else:
                business_segments[i] = CustomerSegment.LOW_VALUE.value
        
        return business_segments

class CustomerLifetimeValueModel:
    """Customer Lifetime Value (CLV) prediction models"""
    
    def __init__(self):
        self.models = {}
        self.scalers = {}
        self.feature_importance = {}
        
    def prepare_clv_features(self, customer_data: pd.DataFrame) -> pd.DataFrame:
        """Prepare features for CLV prediction"""
        clv_features = customer_data.copy()
        
        # Historical value features
        clv_features['avg_monthly_value'] = clv_features['total_amount'] / (clv_features['tenure_days'] / 30 + 1)
        clv_features['transaction_frequency'] = clv_features['transaction_count'] / (clv_features['tenure_days'] + 1)
        
        # Growth trends
        if 'recent_3m_amount' in clv_features.columns and 'previous_3m_amount' in clv_features.columns:
            clv_features['value_growth_rate'] = (
                (clv_features['recent_3m_amount'] - clv_features['previous_3m_amount']) / 
                (clv_features['previous_3m_amount'] + 1)
            )
        else:
            clv_features['value_growth_rate'] = 0
        
        # Engagement indicators
        clv_features['engagement_score'] = (
            clv_features.get('total_interactions', 0) * 0.3 +
            clv_features.get('avg_satisfaction', 0) * 0.4 +
            clv_features.get('channel_diversity', 0) * 0.3
        )
        
        return clv_features
    
    def train_traditional_clv_model(self, features_df: pd.DataFrame, 
                                  target_clv: pd.Series) -> Dict[str, Any]:
        """Train traditional CLV prediction model"""
        # Select features for CLV prediction
        clv_feature_cols = [
            'avg_amount', 'transaction_count', 'tenure_days', 'recency_days',
            'avg_monthly_value', 'transaction_frequency', 'value_growth_rate',
            'engagement_score', 'transaction_type_diversity'
        ]
        
        available_features = [f for f in clv_feature_cols if f in features_df.columns]
        X = features_df[available_features].fillna(0)
        y = target_clv
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Train Random Forest
        rf_model = RandomForestRegressor(n_estimators=100, random_state=42)
        rf_model.fit(X_train_scaled, y_train)
        rf_score = rf_model.score(X_test_scaled, y_test)
        
        # Train XGBoost
        xgb_model = xgb.XGBRegressor(n_estimators=100, random_state=42)
        xgb_model.fit(X_train_scaled, y_train)
        xgb_score = xgb_model.score(X_test_scaled, y_test)
        
        # Train LightGBM
        lgb_model = lgb.LGBMRegressor(n_estimators=100, random_state=42)
        lgb_model.fit(X_train_scaled, y_train)
        lgb_score = lgb_model.score(X_test_scaled, y_test)
        
        # Store best model
        models_scores = [
            ('random_forest', rf_model, rf_score),
            ('xgboost', xgb_model, xgb_score),
            ('lightgbm', lgb_model, lgb_score)
        ]
        
        best_model_name, best_model, best_score = max(models_scores, key=lambda x: x[2])
        
        self.models['clv_traditional'] = best_model
        self.scalers['clv_traditional'] = scaler
        
        # Feature importance
        if hasattr(best_model, 'feature_importances_'):
            self.feature_importance['clv_traditional'] = dict(
                zip(available_features, best_model.feature_importances_)
            )
        
        return {
            'best_model': best_model_name,
            'best_score': best_score,
            'all_scores': {name: score for name, _, score in models_scores},
            'feature_importance': self.feature_importance.get('clv_traditional', {})
        }
    
    def train_deep_clv_model(self, features_df: pd.DataFrame, 
                           target_clv: pd.Series) -> Dict[str, Any]:
        """Train deep learning CLV model"""
        # Prepare data
        clv_feature_cols = [
            'avg_amount', 'transaction_count', 'tenure_days', 'recency_days',
            'avg_monthly_value', 'transaction_frequency', 'value_growth_rate',
            'engagement_score', 'transaction_type_diversity'
        ]
        
        available_features = [f for f in clv_feature_cols if f in features_df.columns]
        X = features_df[available_features].fillna(0).values
        y = target_clv.values
        
        # Split and scale data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        scaler_X = StandardScaler()
        scaler_y = StandardScaler()
        
        X_train_scaled = scaler_X.fit_transform(X_train)
        X_test_scaled = scaler_X.transform(X_test)
        y_train_scaled = scaler_y.fit_transform(y_train.reshape(-1, 1)).flatten()
        y_test_scaled = scaler_y.transform(y_test.reshape(-1, 1)).flatten()
        
        # Define neural network
        class CLVNet(nn.Module):
            def __init__(self, input_dim):
                super(CLVNet, self).__init__()
                self.network = nn.Sequential(
                    nn.Linear(input_dim, 128),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(128, 64),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(64, 32),
                    nn.ReLU(),
                    nn.Dropout(0.2),
                    nn.Linear(32, 16),
                    nn.ReLU(),
                    nn.Linear(16, 1)
                )
            
            def forward(self, x):
                return self.network(x)
        
        # Train model
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = CLVNet(X_train_scaled.shape[1]).to(device)
        
        criterion = nn.MSELoss()
        optimizer = torch.optim.Adam(model.parameters(), lr=0.001, weight_decay=1e-5)
        
        # Convert to tensors
        X_train_tensor = torch.FloatTensor(X_train_scaled).to(device)
        y_train_tensor = torch.FloatTensor(y_train_scaled).to(device)
        X_test_tensor = torch.FloatTensor(X_test_scaled).to(device)
        y_test_tensor = torch.FloatTensor(y_test_scaled).to(device)
        
        # Training loop
        model.train()
        train_losses = []
        
        for epoch in range(200):
            optimizer.zero_grad()
            outputs = model(X_train_tensor).squeeze()
            loss = criterion(outputs, y_train_tensor)
            loss.backward()
            optimizer.step()
            
            train_losses.append(loss.item())
            
            if epoch % 50 == 0:
                logger.info(f'Epoch {epoch}, Loss: {loss.item():.4f}')
        
        # Evaluate model
        model.eval()
        with torch.no_grad():
            test_outputs = model(X_test_tensor).squeeze()
            test_loss = criterion(test_outputs, y_test_tensor)
            
            # Calculate R² score
            y_pred_scaled = test_outputs.cpu().numpy()
            y_pred = scaler_y.inverse_transform(y_pred_scaled.reshape(-1, 1)).flatten()
            
            ss_res = np.sum((y_test - y_pred) ** 2)
            ss_tot = np.sum((y_test - np.mean(y_test)) ** 2)
            r2_score = 1 - (ss_res / ss_tot)
        
        # Store model
        self.models['clv_deep'] = {
            'model': model,
            'scaler_X': scaler_X,
            'scaler_y': scaler_y,
            'feature_names': available_features
        }
        
        return {
            'r2_score': r2_score,
            'test_loss': test_loss.item(),
            'train_losses': train_losses
        }
    
    def predict_clv(self, features_df: pd.DataFrame, model_type: str = 'clv_traditional') -> np.ndarray:
        """Predict customer lifetime value"""
        if model_type not in self.models:
            raise ValueError(f"Model {model_type} not found")
        
        if model_type == 'clv_deep':
            model_data = self.models[model_type]
            model = model_data['model']
            scaler_X = model_data['scaler_X']
            scaler_y = model_data['scaler_y']
            feature_names = model_data['feature_names']
            
            # Prepare features
            X = features_df[feature_names].fillna(0).values
            X_scaled = scaler_X.transform(X)
            
            # Predict
            device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            model.eval()
            with torch.no_grad():
                X_tensor = torch.FloatTensor(X_scaled).to(device)
                predictions_scaled = model(X_tensor).squeeze().cpu().numpy()
                predictions = scaler_y.inverse_transform(predictions_scaled.reshape(-1, 1)).flatten()
            
            return predictions
        
        else:
            model = self.models[model_type]
            scaler = self.scalers[model_type]
            
            # Get feature names from training
            feature_names = list(self.feature_importance.get(model_type, {}).keys())
            if not feature_names:
                # Fallback to common features
                feature_names = [
                    'avg_amount', 'transaction_count', 'tenure_days', 'recency_days',
                    'avg_monthly_value', 'transaction_frequency', 'value_growth_rate',
                    'engagement_score', 'transaction_type_diversity'
                ]
            
            available_features = [f for f in feature_names if f in features_df.columns]
            X = features_df[available_features].fillna(0)
            X_scaled = scaler.transform(X)
            
            predictions = model.predict(X_scaled)
            return predictions

class ChurnPredictionModel:
    """Customer churn prediction models"""
    
    def __init__(self):
        self.models = {}
        self.scalers = {}
        self.feature_importance = {}
        
    def prepare_churn_features(self, customer_data: pd.DataFrame) -> pd.DataFrame:
        """Prepare features for churn prediction"""
        churn_features = customer_data.copy()
        
        # Recency-based features
        churn_features['days_since_last_transaction'] = churn_features['recency_days']
        churn_features['is_recent_user'] = (churn_features['recency_days'] <= 30).astype(int)
        
        # Activity decline features
        if 'recent_3m_transactions' in churn_features.columns and 'previous_3m_transactions' in churn_features.columns:
            churn_features['activity_decline'] = (
                (churn_features['previous_3m_transactions'] - churn_features['recent_3m_transactions']) /
                (churn_features['previous_3m_transactions'] + 1)
            )
        else:
            churn_features['activity_decline'] = 0
        
        # Engagement decline
        if 'recent_engagement_score' in churn_features.columns and 'previous_engagement_score' in churn_features.columns:
            churn_features['engagement_decline'] = (
                (churn_features['previous_engagement_score'] - churn_features['recent_engagement_score']) /
                (churn_features['previous_engagement_score'] + 1)
            )
        else:
            churn_features['engagement_decline'] = 0
        
        # Support interaction features
        churn_features['support_interactions'] = churn_features.get('support_ticket_count', 0)
        churn_features['complaint_rate'] = churn_features.get('complaint_count', 0) / (churn_features['transaction_count'] + 1)
        
        return churn_features
    
    def train_churn_model(self, features_df: pd.DataFrame, churn_labels: pd.Series) -> Dict[str, Any]:
        """Train churn prediction model"""
        # Select features for churn prediction
        churn_feature_cols = [
            'recency_days', 'frequency_score', 'monetary_score', 'tenure_days',
            'days_since_last_transaction', 'is_recent_user', 'activity_decline',
            'engagement_decline', 'support_interactions', 'complaint_rate',
            'transaction_type_diversity', 'avg_transactions_per_day'
        ]
        
        available_features = [f for f in churn_feature_cols if f in features_df.columns]
        X = features_df[available_features].fillna(0)
        y = churn_labels
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Train models
        models = {
            'random_forest': RandomForestRegressor(n_estimators=100, random_state=42),
            'xgboost': xgb.XGBClassifier(n_estimators=100, random_state=42),
            'lightgbm': lgb.LGBMClassifier(n_estimators=100, random_state=42)
        }
        
        results = {}
        for name, model in models.items():
            model.fit(X_train_scaled, y_train)
            score = model.score(X_test_scaled, y_test)
            results[name] = score
        
        # Select best model
        best_model_name = max(results, key=results.get)
        best_model = models[best_model_name]
        
        self.models['churn'] = best_model
        self.scalers['churn'] = scaler
        
        # Feature importance
        if hasattr(best_model, 'feature_importances_'):
            self.feature_importance['churn'] = dict(
                zip(available_features, best_model.feature_importances_)
            )
        
        return {
            'best_model': best_model_name,
            'best_score': results[best_model_name],
            'all_scores': results,
            'feature_importance': self.feature_importance.get('churn', {})
        }
    
    def predict_churn_probability(self, features_df: pd.DataFrame) -> np.ndarray:
        """Predict churn probability"""
        if 'churn' not in self.models:
            raise ValueError("Churn model not trained")
        
        model = self.models['churn']
        scaler = self.scalers['churn']
        
        # Get feature names from training
        feature_names = list(self.feature_importance.get('churn', {}).keys())
        if not feature_names:
            feature_names = [
                'recency_days', 'frequency_score', 'monetary_score', 'tenure_days',
                'days_since_last_transaction', 'is_recent_user', 'activity_decline',
                'engagement_decline', 'support_interactions', 'complaint_rate',
                'transaction_type_diversity', 'avg_transactions_per_day'
            ]
        
        available_features = [f for f in feature_names if f in features_df.columns]
        X = features_df[available_features].fillna(0)
        X_scaled = scaler.transform(X)
        
        if hasattr(model, 'predict_proba'):
            probabilities = model.predict_proba(X_scaled)[:, 1]
        else:
            probabilities = model.predict(X_scaled)
        
        return probabilities

class CustomerAnalyticsEngine:
    """Main customer analytics engine combining all models"""
    
    def __init__(self):
        self.feature_engineering = CustomerFeatureEngineering()
        self.segmentation_model = CustomerSegmentationModel()
        self.clv_model = CustomerLifetimeValueModel()
        self.churn_model = ChurnPredictionModel()
        self.is_trained = False
        
    def train_all_models(self, transactions_df: pd.DataFrame, 
                        customers_df: pd.DataFrame,
                        interactions_df: pd.DataFrame = None,
                        fraud_alerts_df: pd.DataFrame = None) -> Dict[str, Any]:
        """Train all customer analytics models"""
        logger.info("Training customer analytics models...")
        
        # Feature engineering
        demographic_features = self.feature_engineering.create_demographic_features(customers_df)
        behavioral_features = self.feature_engineering.create_behavioral_features(transactions_df, customers_df)
        
        if interactions_df is not None:
            engagement_features = self.feature_engineering.create_engagement_features(interactions_df)
        else:
            engagement_features = pd.DataFrame()
        
        risk_features = self.feature_engineering.create_risk_features(transactions_df, fraud_alerts_df)
        
        # Combine all features
        all_features = demographic_features.set_index('customer_id').join([
            behavioral_features, engagement_features, risk_features
        ], how='left').fillna(0)
        
        # Train segmentation model
        segmentation_features = self.segmentation_model.prepare_segmentation_features(all_features)
        segmentation_results = self.segmentation_model.perform_kmeans_segmentation(segmentation_features)
        
        # Assign business segments
        business_segments = self.segmentation_model.assign_business_segments(
            segmentation_features, segmentation_results['labels']
        )
        
        # Create synthetic CLV targets (in production, use actual CLV data)
        synthetic_clv = (
            all_features['total_amount'] * 1.2 + 
            all_features['transaction_count'] * 100 +
            np.random.normal(0, 1000, len(all_features))
        )
        synthetic_clv = np.maximum(synthetic_clv, 0)  # Ensure positive values
        
        # Train CLV model
        clv_features = self.clv_model.prepare_clv_features(all_features)
        clv_results = self.clv_model.train_traditional_clv_model(clv_features, pd.Series(synthetic_clv))
        
        # Create synthetic churn labels (in production, use actual churn data)
        churn_probability = 1 / (1 + np.exp(-(all_features['recency_days'] - 60) / 30))
        synthetic_churn = np.random.binomial(1, churn_probability)
        
        # Train churn model
        churn_features = self.churn_model.prepare_churn_features(all_features)
        churn_results = self.churn_model.train_churn_model(churn_features, pd.Series(synthetic_churn))
        
        self.is_trained = True
        
        return {
            'segmentation_results': segmentation_results,
            'clv_results': clv_results,
            'churn_results': churn_results,
            'feature_count': len(all_features.columns),
            'customer_count': len(all_features)
        }
    
    def analyze_customer(self, customer_id: str, transactions_df: pd.DataFrame,
                        customers_df: pd.DataFrame, interactions_df: pd.DataFrame = None) -> CustomerInsights:
        """Analyze a single customer"""
        if not self.is_trained:
            raise ValueError("Models not trained. Call train_all_models first.")
        
        # Get customer data
        customer_transactions = transactions_df[transactions_df['customer_id'] == customer_id]
        customer_info = customers_df[customers_df['customer_id'] == customer_id]
        
        if customer_info.empty:
            raise ValueError(f"Customer {customer_id} not found")
        
        # Feature engineering
        demographic_features = self.feature_engineering.create_demographic_features(customer_info)
        behavioral_features = self.feature_engineering.create_behavioral_features(customer_transactions, customer_info)
        
        if interactions_df is not None:
            customer_interactions = interactions_df[interactions_df['customer_id'] == customer_id]
            engagement_features = self.feature_engineering.create_engagement_features(customer_interactions)
        else:
            engagement_features = pd.DataFrame()
        
        risk_features = self.feature_engineering.create_risk_features(customer_transactions)
        
        # Combine features
        customer_features = demographic_features.set_index('customer_id').join([
            behavioral_features, engagement_features, risk_features
        ], how='left').fillna(0)
        
        # Make predictions
        segmentation_features = self.segmentation_model.prepare_segmentation_features(customer_features)
        
        # Predict segment (using K-means model)
        if 'kmeans' in self.segmentation_model.models:
            scaler = self.segmentation_model.scalers['kmeans']
            model = self.segmentation_model.models['kmeans']
            
            features_scaled = scaler.transform(segmentation_features)
            cluster_label = model.predict(features_scaled)[0]
            
            # Map to business segment
            business_segments = self.segmentation_model.assign_business_segments(
                segmentation_features, np.array([cluster_label])
            )
            segment = CustomerSegment(business_segments[0])
            segment_confidence = 0.8  # Simplified confidence calculation
        else:
            segment = CustomerSegment.LOW_VALUE
            segment_confidence = 0.5
        
        # Predict CLV
        clv_features = self.clv_model.prepare_clv_features(customer_features)
        try:
            clv_prediction = self.clv_model.predict_clv(clv_features)[0]
        except:
            clv_prediction = 0.0
        
        # Predict churn probability
        churn_features = self.churn_model.prepare_churn_features(customer_features)
        try:
            churn_probability = self.churn_model.predict_churn_probability(churn_features)[0]
        except:
            churn_probability = 0.5
        
        # Calculate additional scores
        risk_score = customer_features[['velocity_risk', 'amount_pattern_risk', 'time_pattern_risk']].mean().mean()
        engagement_score = customer_features.get('engagement_score', 0.5)
        satisfaction_score = customer_features.get('avg_satisfaction', 0.7)
        
        # Generate recommendations
        recommendations = self._generate_recommendations(
            segment, clv_prediction, churn_probability, risk_score, engagement_score
        )
        
        # Identify key behaviors
        key_behaviors = self._identify_key_behaviors(customer_features)
        
        # Calculate trends
        trends = self._calculate_trends(customer_features)
        
        # Generate next best actions
        next_best_actions = self._generate_next_best_actions(
            segment, churn_probability, engagement_score
        )
        
        return CustomerInsights(
            customer_id=customer_id,
            segment=segment,
            segment_confidence=segment_confidence,
            lifetime_value_prediction=clv_prediction,
            churn_probability=churn_probability,
            risk_score=risk_score,
            engagement_score=engagement_score,
            satisfaction_score=satisfaction_score,
            recommendations=recommendations,
            key_behaviors=key_behaviors,
            trends=trends,
            next_best_actions=next_best_actions,
            timestamp=datetime.now()
        )
    
    def _generate_recommendations(self, segment: CustomerSegment, clv: float, 
                                churn_prob: float, risk_score: float, 
                                engagement_score: float) -> List[str]:
        """Generate personalized recommendations"""
        recommendations = []
        
        if churn_prob > 0.7:
            recommendations.append("Implement retention campaign")
            recommendations.append("Offer personalized incentives")
        
        if segment == CustomerSegment.HIGH_VALUE:
            recommendations.append("Provide VIP customer service")
            recommendations.append("Offer premium products")
        
        if engagement_score < 0.3:
            recommendations.append("Increase engagement through targeted content")
            recommendations.append("Simplify user experience")
        
        if risk_score > 0.6:
            recommendations.append("Enhanced monitoring required")
            recommendations.append("Consider additional verification")
        
        return recommendations
    
    def _identify_key_behaviors(self, customer_features: pd.DataFrame) -> List[str]:
        """Identify key customer behaviors"""
        behaviors = []
        
        features = customer_features.iloc[0] if len(customer_features) > 0 else {}
        
        if features.get('weekend_usage_rate', 0) > 0.5:
            behaviors.append("High weekend activity")
        
        if features.get('transaction_type_diversity', 0) > 3:
            behaviors.append("Uses multiple service types")
        
        if features.get('avg_transactions_per_day', 0) > 2:
            behaviors.append("Frequent user")
        
        return behaviors
    
    def _calculate_trends(self, customer_features: pd.DataFrame) -> Dict[str, float]:
        """Calculate customer trends"""
        features = customer_features.iloc[0] if len(customer_features) > 0 else {}
        
        return {
            'activity_trend': features.get('value_growth_rate', 0),
            'engagement_trend': features.get('engagement_decline', 0) * -1,  # Invert decline to trend
            'risk_trend': features.get('velocity_risk', 0)
        }
    
    def _generate_next_best_actions(self, segment: CustomerSegment, 
                                  churn_prob: float, engagement_score: float) -> List[str]:
        """Generate next best actions"""
        actions = []
        
        if churn_prob > 0.6:
            actions.append("Contact for retention offer")
        elif engagement_score < 0.4:
            actions.append("Send engagement survey")
        elif segment == CustomerSegment.HIGH_VALUE:
            actions.append("Offer premium upgrade")
        else:
            actions.append("Send product recommendations")
        
        return actions

# Example usage
if __name__ == "__main__":
    # Create sample data
    np.random.seed(42)
    n_customers = 1000
    n_transactions = 10000
    
    # Sample customer data
    customers_data = {
        'customer_id': [f'cust_{i}' for i in range(n_customers)],
        'date_of_birth': pd.date_range('1960-01-01', '2000-01-01', periods=n_customers),
        'income': np.random.lognormal(mean=10, sigma=0.5, size=n_customers),
        'education': np.random.choice(['primary', 'secondary', 'tertiary', 'university'], size=n_customers),
        'location': np.random.choice(['urban', 'rural'], size=n_customers)
    }
    customers_df = pd.DataFrame(customers_data)
    
    # Sample transaction data
    transactions_data = {
        'transaction_id': [f'txn_{i}' for i in range(n_transactions)],
        'customer_id': np.random.choice([f'cust_{i}' for i in range(n_customers)], size=n_transactions),
        'amount': np.random.lognormal(mean=5, sigma=1, size=n_transactions),
        'transaction_type': np.random.choice(['cash_in', 'cash_out', 'transfer', 'bill_payment'], size=n_transactions),
        'timestamp': pd.date_range('2023-01-01', '2024-01-01', periods=n_transactions)
    }
    transactions_df = pd.DataFrame(transactions_data)
    
    # Initialize and train analytics engine
    analytics_engine = CustomerAnalyticsEngine()
    training_results = analytics_engine.train_all_models(transactions_df, customers_df)
    
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    
    # Analyze a sample customer
    sample_customer_id = 'cust_0'
    customer_insights = analytics_engine.analyze_customer(
        sample_customer_id, transactions_df, customers_df
    )
    
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")

