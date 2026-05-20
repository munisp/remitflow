#!/usr/bin/env python3
"""
Advanced Credit Scoring Engine for Remittance Platform
Implements ensemble models, alternative data integration, regulatory compliance,
and explainable AI for Nigerian banking credit assessment
"""

logger = logging.getLogger(__name__)
import os
import sys
import json
import logging
import asyncio
import hashlib
import pickle
import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Core ML libraries
import sklearn
from sklearn.ensemble import (
    RandomForestRegressor, GradientBoostingRegressor, 
    VotingRegressor, ExtraTreesRegressor
)
from sklearn.linear_model import (
    LinearRegression, Ridge, Lasso, ElasticNet,
    LogisticRegression, SGDRegressor
)
from sklearn.svm import SVR
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import (
    StandardScaler, RobustScaler, MinMaxScaler,
    LabelEncoder, OneHotEncoder, PolynomialFeatures
)
from sklearn.feature_selection import SelectKBest, f_regression, RFE, RFECV
from sklearn.model_selection import (
    train_test_split, cross_val_score, GridSearchCV,
    StratifiedKFold, TimeSeriesSplit, RandomizedSearchCV
)
from sklearn.metrics import (
    mean_squared_error, mean_absolute_error, r2_score,
    classification_report, confusion_matrix, roc_auc_score,
    precision_recall_curve, roc_curve, f1_score
)
from sklearn.decomposition import PCA, TruncatedSVD
from sklearn.cluster import KMeans, DBSCAN
from sklearn.neighbors import KNeighborsRegressor

# Advanced ML libraries
import xgboost as xgb
import lightgbm as lgb
import catboost as cb
from imblearn.over_sampling import SMOTE, ADASYN
from imblearn.under_sampling import RandomUnderSampler

# Deep Learning
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import torch.nn.functional as F

# Explainable AI
import shap
import lime
from lime.lime_tabular import LimeTabularExplainer

# Time series and streaming
from river import linear_model, preprocessing, metrics, compose
import streamz

# Web framework and APIs
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
import redis
import psycopg2
from psycopg2.extras import RealDictCursor

# Monitoring and observability
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import structlog

# Utilities
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import threading
import multiprocessing
from functools import lru_cache
import time
import uuid
import base64

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# Prometheus metrics
CREDIT_SCORES = Counter('credit_scores_total', 'Total credit scores generated', ['model', 'score_band'])
SCORING_LATENCY = Histogram('credit_scoring_duration_seconds', 'Credit scoring latency')
MODEL_ACCURACY = Gauge('credit_model_accuracy', 'Current model accuracy', ['model'])
FEATURE_IMPORTANCE = Gauge('credit_feature_importance', 'Feature importance scores', ['feature', 'model'])

@dataclass
class CreditScore:
    """Credit score result structure"""
    application_id: str
    customer_id: str
    credit_score: int  # 300-850 scale
    probability_of_default: float
    risk_grade: str  # AAA, AA, A, BBB, BB, B, CCC, CC, C, D
    score_band: str  # EXCELLENT, GOOD, FAIR, POOR, VERY_POOR
    model_used: str
    features_used: List[str]
    explanation: Dict[str, Any]
    confidence: float
    processing_time_ms: float
    timestamp: datetime
    session_id: str
    regulatory_flags: Dict[str, Any]
    alternative_data_score: float
    traditional_score: float
    final_recommendation: str

@dataclass
class ModelPerformance:
    """Model performance metrics"""
    model_name: str
    mse: float
    mae: float
    r2_score: float
    accuracy: float
    precision: float
    recall: float
    f1_score: float
    auc_roc: float
    gini_coefficient: float
    ks_statistic: float
    training_time: float
    prediction_time_avg: float
    last_updated: datetime
    feature_count: int
    training_samples: int

class AlternativeDataProcessor:
    """Process alternative data sources for credit scoring"""
    
    def __init__(self):
        self.processors = {}
        self.scalers = {}
        
    def process_mobile_money_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process mobile money transaction data"""
        logger.info("Processing mobile money data")
        
        features = {}
        
        if 'transactions' in data:
            transactions = pd.DataFrame(data['transactions'])
            
            # Transaction volume features
            features['mm_total_transactions'] = len(transactions)
            features['mm_total_volume'] = transactions['amount'].sum()
            features['mm_avg_transaction'] = transactions['amount'].mean()
            features['mm_median_transaction'] = transactions['amount'].median()
            features['mm_std_transaction'] = transactions['amount'].std()
            
            # Frequency features
            features['mm_transactions_per_day'] = len(transactions) / 30  # Assuming 30-day period
            features['mm_active_days'] = transactions['date'].nunique()
            features['mm_consistency_ratio'] = features['mm_active_days'] / 30
            
            # Balance features
            if 'balance' in transactions.columns:
                features['mm_avg_balance'] = transactions['balance'].mean()
                features['mm_min_balance'] = transactions['balance'].min()
                features['mm_max_balance'] = transactions['balance'].max()
                features['mm_balance_volatility'] = transactions['balance'].std()
            
            # Transaction type analysis
            if 'type' in transactions.columns:
                type_counts = transactions['type'].value_counts()
                features['mm_deposit_ratio'] = type_counts.get('deposit', 0) / len(transactions)
                features['mm_withdrawal_ratio'] = type_counts.get('withdrawal', 0) / len(transactions)
                features['mm_transfer_ratio'] = type_counts.get('transfer', 0) / len(transactions)
                features['mm_payment_ratio'] = type_counts.get('payment', 0) / len(transactions)
            
            # Time-based patterns
            transactions['hour'] = pd.to_datetime(transactions['timestamp']).dt.hour
            transactions['day_of_week'] = pd.to_datetime(transactions['timestamp']).dt.dayofweek
            
            features['mm_night_transactions'] = ((transactions['hour'] < 6) | (transactions['hour'] > 22)).sum()
            features['mm_weekend_transactions'] = (transactions['day_of_week'] >= 5).sum()
            features['mm_business_hours_ratio'] = ((transactions['hour'] >= 9) & (transactions['hour'] <= 17)).sum() / len(transactions)
        
        return features
    
    def process_social_media_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process social media data for credit insights"""
        logger.info("Processing social media data")
        
        features = {}
        
        # Network analysis
        features['social_connections'] = data.get('friend_count', 0)
        features['social_activity_score'] = data.get('activity_score', 0)
        features['social_engagement_rate'] = data.get('engagement_rate', 0)
        
        # Content analysis (simplified)
        features['financial_mentions'] = data.get('financial_keywords_count', 0)
        features['employment_indicators'] = data.get('employment_mentions', 0)
        features['education_level'] = data.get('education_score', 0)
        
        # Behavioral indicators
        features['social_stability'] = data.get('account_age_days', 0) / 365
        features['social_consistency'] = data.get('posting_consistency', 0)
        
        return features
    
    def process_utility_payment_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process utility payment history"""
        logger.info("Processing utility payment data")
        
        features = {}
        
        if 'payments' in data:
            payments = pd.DataFrame(data['payments'])
            
            # Payment consistency
            features['utility_payment_count'] = len(payments)
            features['utility_on_time_ratio'] = (payments['days_late'] == 0).sum() / len(payments)
            features['utility_avg_days_late'] = payments['days_late'].mean()
            features['utility_max_days_late'] = payments['days_late'].max()
            
            # Payment amounts
            features['utility_avg_amount'] = payments['amount'].mean()
            features['utility_total_amount'] = payments['amount'].sum()
            features['utility_payment_volatility'] = payments['amount'].std()
            
            # Service types
            if 'service_type' in payments.columns:
                service_types = payments['service_type'].unique()
                features['utility_service_diversity'] = len(service_types)
                features['utility_has_electricity'] = 'electricity' in service_types
                features['utility_has_water'] = 'water' in service_types
                features['utility_has_internet'] = 'internet' in service_types
        
        return features
    
    def process_geolocation_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process geolocation and mobility data"""
        logger.info("Processing geolocation data")
        
        features = {}
        
        # Location stability
        features['location_stability'] = data.get('home_location_consistency', 0)
        features['work_location_consistency'] = data.get('work_location_consistency', 0)
        features['location_diversity'] = data.get('unique_locations_count', 0)
        
        # Mobility patterns
        features['avg_daily_distance'] = data.get('avg_daily_distance_km', 0)
        features['mobility_regularity'] = data.get('routine_score', 0)
        features['urban_rural_ratio'] = data.get('urban_time_ratio', 0)
        
        # Economic indicators from location
        features['affluent_area_time'] = data.get('affluent_area_ratio', 0)
        features['commercial_area_visits'] = data.get('commercial_visits_count', 0)
        features['financial_district_visits'] = data.get('bank_visits_count', 0)
        
        return features
    
    def process_device_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process device and digital behavior data"""
        logger.info("Processing device data")
        
        features = {}
        
        # Device characteristics
        features['device_value_estimate'] = data.get('device_price_usd', 0)
        features['device_age_months'] = data.get('device_age_months', 0)
        features['has_multiple_devices'] = len(data.get('devices', [])) > 1
        
        # Usage patterns
        features['daily_usage_hours'] = data.get('avg_daily_usage_hours', 0)
        features['app_diversity'] = data.get('unique_apps_count', 0)
        features['financial_app_usage'] = data.get('financial_apps_usage_hours', 0)
        
        # Digital sophistication
        features['digital_literacy_score'] = data.get('digital_literacy', 0)
        features['security_awareness'] = data.get('security_score', 0)
        features['privacy_settings_score'] = data.get('privacy_score', 0)
        
        return features
    
    def combine_alternative_data(self, customer_data: Dict[str, Any]) -> Dict[str, float]:
        """Combine all alternative data sources"""
        logger.info("Combining alternative data sources")
        
        combined_features = {}
        
        # Process each data source
        if 'mobile_money' in customer_data:
            mm_features = self.process_mobile_money_data(customer_data['mobile_money'])
            combined_features.update(mm_features)
        
        if 'social_media' in customer_data:
            social_features = self.process_social_media_data(customer_data['social_media'])
            combined_features.update(social_features)
        
        if 'utility_payments' in customer_data:
            utility_features = self.process_utility_payment_data(customer_data['utility_payments'])
            combined_features.update(utility_features)
        
        if 'geolocation' in customer_data:
            geo_features = self.process_geolocation_data(customer_data['geolocation'])
            combined_features.update(geo_features)
        
        if 'device_data' in customer_data:
            device_features = self.process_device_data(customer_data['device_data'])
            combined_features.update(device_features)
        
        # Calculate composite scores
        combined_features['alt_data_completeness'] = len([k for k, v in combined_features.items() if v > 0]) / len(combined_features)
        combined_features['alt_data_quality_score'] = np.mean([v for v in combined_features.values() if v > 0])
        
        return combined_features

class TraditionalCreditFeatures:
    """Process traditional credit bureau and banking data"""
    
    def __init__(self):
        self.feature_processors = {}
        
    def process_credit_bureau_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process credit bureau data"""
        logger.info("Processing credit bureau data")
        
        features = {}
        
        # Credit history length
        features['credit_history_months'] = data.get('credit_history_months', 0)
        features['oldest_account_months'] = data.get('oldest_account_months', 0)
        features['newest_account_months'] = data.get('newest_account_months', 0)
        
        # Account information
        features['total_accounts'] = data.get('total_accounts', 0)
        features['open_accounts'] = data.get('open_accounts', 0)
        features['closed_accounts'] = data.get('closed_accounts', 0)
        features['account_mix_score'] = data.get('account_types_count', 0)
        
        # Credit utilization
        features['total_credit_limit'] = data.get('total_credit_limit', 0)
        features['total_balance'] = data.get('total_balance', 0)
        features['credit_utilization'] = features['total_balance'] / max(features['total_credit_limit'], 1)
        features['avg_utilization'] = data.get('avg_utilization', 0)
        features['max_utilization'] = data.get('max_utilization', 0)
        
        # Payment history
        features['payment_history_score'] = data.get('payment_history_score', 0)
        features['late_payments_30'] = data.get('late_payments_30_days', 0)
        features['late_payments_60'] = data.get('late_payments_60_days', 0)
        features['late_payments_90'] = data.get('late_payments_90_days', 0)
        features['total_late_payments'] = features['late_payments_30'] + features['late_payments_60'] + features['late_payments_90']
        
        # Derogatory marks
        features['bankruptcies'] = data.get('bankruptcies', 0)
        features['foreclosures'] = data.get('foreclosures', 0)
        features['collections'] = data.get('collections', 0)
        features['charge_offs'] = data.get('charge_offs', 0)
        features['total_derogatory'] = features['bankruptcies'] + features['foreclosures'] + features['collections'] + features['charge_offs']
        
        # Inquiries
        features['hard_inquiries_6m'] = data.get('hard_inquiries_6_months', 0)
        features['hard_inquiries_12m'] = data.get('hard_inquiries_12_months', 0)
        features['soft_inquiries'] = data.get('soft_inquiries', 0)
        
        return features
    
    def process_banking_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process banking transaction and account data"""
        logger.info("Processing banking data")
        
        features = {}
        
        # Account basics
        features['account_age_months'] = data.get('account_age_months', 0)
        features['account_type_score'] = data.get('account_type_score', 0)
        
        # Balance information
        features['current_balance'] = data.get('current_balance', 0)
        features['avg_balance_3m'] = data.get('avg_balance_3_months', 0)
        features['avg_balance_6m'] = data.get('avg_balance_6_months', 0)
        features['avg_balance_12m'] = data.get('avg_balance_12_months', 0)
        features['min_balance_12m'] = data.get('min_balance_12_months', 0)
        features['max_balance_12m'] = data.get('max_balance_12_months', 0)
        features['balance_volatility'] = data.get('balance_std_12_months', 0)
        
        # Transaction patterns
        if 'transactions' in data:
            transactions = pd.DataFrame(data['transactions'])
            
            # Volume metrics
            features['total_transactions'] = len(transactions)
            features['avg_monthly_transactions'] = len(transactions) / 12
            features['total_transaction_volume'] = transactions['amount'].sum()
            features['avg_transaction_amount'] = transactions['amount'].mean()
            features['median_transaction_amount'] = transactions['amount'].median()
            
            # Income estimation
            credits = transactions[transactions['amount'] > 0]
            if len(credits) > 0:
                features['estimated_monthly_income'] = credits['amount'].sum() / 12
                features['income_regularity'] = credits.groupby(credits['date'].dt.month)['amount'].sum().std()
                features['largest_credit'] = credits['amount'].max()
                features['avg_credit_amount'] = credits['amount'].mean()
            
            # Expense patterns
            debits = transactions[transactions['amount'] < 0]
            if len(debits) > 0:
                features['estimated_monthly_expenses'] = abs(debits['amount'].sum()) / 12
                features['expense_volatility'] = debits['amount'].std()
                features['largest_debit'] = abs(debits['amount'].min())
                features['avg_debit_amount'] = abs(debits['amount'].mean())
            
            # Cash flow
            features['net_cash_flow'] = features.get('estimated_monthly_income', 0) - features.get('estimated_monthly_expenses', 0)
            features['cash_flow_ratio'] = features['net_cash_flow'] / max(features.get('estimated_monthly_income', 1), 1)
            
            # Overdrafts and fees
            features['overdraft_count'] = (transactions['amount'] < 0).sum()
            features['overdraft_fees'] = data.get('overdraft_fees_12m', 0)
            features['nsf_fees'] = data.get('nsf_fees_12m', 0)
            features['total_fees'] = features['overdraft_fees'] + features['nsf_fees']
        
        return features
    
    def process_employment_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process employment and income data"""
        logger.info("Processing employment data")
        
        features = {}
        
        # Employment status
        employment_status = data.get('employment_status', 'unknown')
        features['is_employed'] = 1 if employment_status in ['employed', 'self_employed'] else 0
        features['is_self_employed'] = 1 if employment_status == 'self_employed' else 0
        features['is_unemployed'] = 1 if employment_status == 'unemployed' else 0
        features['is_retired'] = 1 if employment_status == 'retired' else 0
        
        # Employment details
        features['employment_length_months'] = data.get('employment_length_months', 0)
        features['job_stability_score'] = min(features['employment_length_months'] / 24, 1.0)  # Normalize to 2 years
        
        # Income information
        features['annual_income'] = data.get('annual_income', 0)
        features['monthly_income'] = features['annual_income'] / 12
        features['income_verified'] = 1 if data.get('income_verified', False) else 0
        features['income_source_diversity'] = data.get('income_sources_count', 1)
        
        # Industry and occupation
        industry = data.get('industry', 'unknown')
        high_stability_industries = ['government', 'education', 'healthcare', 'utilities']
        features['stable_industry'] = 1 if industry in high_stability_industries else 0
        
        occupation = data.get('occupation', 'unknown')
        professional_occupations = ['manager', 'professional', 'technician', 'teacher', 'nurse', 'engineer']
        features['professional_occupation'] = 1 if any(prof in occupation.lower() for prof in professional_occupations) else 0
        
        return features
    
    def process_demographic_data(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Process demographic data"""
        logger.info("Processing demographic data")
        
        features = {}
        
        # Age
        features['age'] = data.get('age', 0)
        features['age_squared'] = features['age'] ** 2
        features['is_young_adult'] = 1 if 18 <= features['age'] <= 25 else 0
        features['is_middle_aged'] = 1 if 26 <= features['age'] <= 45 else 0
        features['is_senior'] = 1 if features['age'] >= 60 else 0
        
        # Education
        education = data.get('education_level', 'unknown')
        education_scores = {
            'no_formal': 0, 'primary': 1, 'secondary': 2, 
            'tertiary': 3, 'university': 4, 'postgraduate': 5
        }
        features['education_score'] = education_scores.get(education, 1)
        features['has_university'] = 1 if features['education_score'] >= 4 else 0
        
        # Marital status
        marital_status = data.get('marital_status', 'single')
        features['is_married'] = 1 if marital_status == 'married' else 0
        features['is_single'] = 1 if marital_status == 'single' else 0
        features['has_dependents'] = data.get('dependents_count', 0)
        
        # Housing
        housing_status = data.get('housing_status', 'rent')
        features['owns_home'] = 1 if housing_status == 'own' else 0
        features['rents_home'] = 1 if housing_status == 'rent' else 0
        features['housing_stability'] = data.get('years_at_address', 0)
        
        # Location (Nigerian context)
        state = data.get('state', 'unknown')
        major_cities = ['Lagos', 'FCT', 'Kano', 'Rivers', 'Ogun']
        features['major_city'] = 1 if state in major_cities else 0
        features['is_lagos'] = 1 if state == 'Lagos' else 0
        
        return features
    
    def combine_traditional_features(self, customer_data: Dict[str, Any]) -> Dict[str, float]:
        """Combine all traditional credit features"""
        logger.info("Combining traditional credit features")
        
        combined_features = {}
        
        # Process each data source
        if 'credit_bureau' in customer_data:
            bureau_features = self.process_credit_bureau_data(customer_data['credit_bureau'])
            combined_features.update(bureau_features)
        
        if 'banking' in customer_data:
            banking_features = self.process_banking_data(customer_data['banking'])
            combined_features.update(banking_features)
        
        if 'employment' in customer_data:
            employment_features = self.process_employment_data(customer_data['employment'])
            combined_features.update(employment_features)
        
        if 'demographics' in customer_data:
            demo_features = self.process_demographic_data(customer_data['demographics'])
            combined_features.update(demo_features)
        
        # Calculate composite traditional score
        combined_features['traditional_data_completeness'] = len([k for k, v in combined_features.items() if v > 0]) / len(combined_features)
        
        return combined_features

class DeepCreditNet(nn.Module):
    """Deep neural network for credit scoring"""
    
    def __init__(self, input_dim: int, hidden_dims: List[int] = [512, 256, 128, 64]):
        super(DeepCreditNet, self).__init__()
        
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
        
        # Output layer for regression (credit score)
        layers.append(nn.Linear(prev_dim, 1))
        
        self.network = nn.Sequential(*layers)
        
    def forward(self, x):
        return self.network(x)

class EnsembleCreditModel:
    """Ensemble of multiple credit scoring models"""
    
    def __init__(self):
        self.models = {}
        self.weights = {}
        self.scalers = {}
        self.feature_processors = {
            'traditional': TraditionalCreditFeatures(),
            'alternative': AlternativeDataProcessor()
        }
        
    def add_model(self, name: str, model: Any, weight: float = 1.0):
        """Add a model to the ensemble"""
        self.models[name] = model
        self.weights[name] = weight
        logger.info("Added model to ensemble", model=name, weight=weight)
    
    def train_traditional_models(self, X_train: np.ndarray, y_train: np.ndarray):
        """Train traditional ML models"""
        logger.info("Training traditional ML models")
        
        # Random Forest
        rf = RandomForestRegressor(
            n_estimators=200, max_depth=15, min_samples_split=10,
            min_samples_leaf=5, random_state=42, n_jobs=-1
        )
        rf.fit(X_train, y_train)
        self.add_model('random_forest', rf, 0.25)
        
        # XGBoost
        xgb_model = xgb.XGBRegressor(
            n_estimators=200, max_depth=8, learning_rate=0.1,
            subsample=0.8, colsample_bytree=0.8, random_state=42
        )
        xgb_model.fit(X_train, y_train)
        self.add_model('xgboost', xgb_model, 0.3)
        
        # LightGBM
        lgb_model = lgb.LGBMRegressor(
            n_estimators=200, max_depth=8, learning_rate=0.1,
            subsample=0.8, colsample_bytree=0.8, random_state=42
        )
        lgb_model.fit(X_train, y_train)
        self.add_model('lightgbm', lgb_model, 0.25)
        
        # CatBoost
        cb_model = cb.CatBoostRegressor(
            iterations=200, depth=8, learning_rate=0.1,
            random_state=42, verbose=False
        )
        cb_model.fit(X_train, y_train)
        self.add_model('catboost', cb_model, 0.2)
    
    def train_deep_model(self, X_train: np.ndarray, y_train: np.ndarray):
        """Train deep neural network"""
        logger.info("Training deep neural network")
        
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # Convert to tensors
        X_tensor = torch.FloatTensor(X_train).to(device)
        y_tensor = torch.FloatTensor(y_train).to(device)
        
        # Create model
        model = DeepCreditNet(X_train.shape[1]).to(device)
        criterion = nn.MSELoss()
        optimizer = optim.Adam(model.parameters(), lr=0.001)
        
        # Training loop
        model.train()
        for epoch in range(100):
            optimizer.zero_grad()
            outputs = model(X_tensor).squeeze()
            loss = criterion(outputs, y_tensor)
            loss.backward()
            optimizer.step()
            
            if epoch % 20 == 0:
                logger.info("Deep model training", epoch=epoch, loss=loss.item())
        
        model.eval()
        self.add_model('deep_neural_network', model, 0.15)
    
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Ensemble prediction with weighted voting"""
        predictions = []
        
        for name, model in self.models.items():
            try:
                if name == 'deep_neural_network':
                    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
                    X_tensor = torch.FloatTensor(X).to(device)
                    with torch.no_grad():
                        pred = model(X_tensor).cpu().numpy().flatten()
                else:
                    pred = model.predict(X)
                
                predictions.append(pred * self.weights[name])
                
            except Exception as e:
                logger.error("Model prediction failed", model=name, error=str(e))
                predictions.append(np.zeros(len(X)))
        
        # Weighted ensemble
        ensemble_pred = np.sum(predictions, axis=0) / sum(self.weights.values())
        return ensemble_pred

class RegulatoryCompliance:
    """Handle regulatory compliance for credit scoring"""
    
    def __init__(self):
        self.prohibited_features = [
            'race', 'ethnicity', 'religion', 'gender', 'sexual_orientation',
            'political_affiliation', 'disability_status'
        ]
        self.sensitive_features = [
            'age', 'marital_status', 'location', 'education'
        ]
        
    def check_feature_compliance(self, features: List[str]) -> Dict[str, Any]:
        """Check if features comply with regulations"""
        compliance_report = {
            'compliant': True,
            'prohibited_features_found': [],
            'sensitive_features_found': [],
            'warnings': [],
            'recommendations': []
        }
        
        # Check for prohibited features
        for feature in features:
            if any(prohibited in feature.lower() for prohibited in self.prohibited_features):
                compliance_report['prohibited_features_found'].append(feature)
                compliance_report['compliant'] = False
        
        # Check for sensitive features
        for feature in features:
            if any(sensitive in feature.lower() for sensitive in self.sensitive_features):
                compliance_report['sensitive_features_found'].append(feature)
                compliance_report['warnings'].append(f"Sensitive feature detected: {feature}")
        
        # Add recommendations
        if compliance_report['prohibited_features_found']:
            compliance_report['recommendations'].append("Remove prohibited features from model")
        
        if compliance_report['sensitive_features_found']:
            compliance_report['recommendations'].append("Ensure sensitive features are used appropriately and documented")
        
        return compliance_report
    
    def generate_adverse_action_notice(self, credit_score: CreditScore) -> Dict[str, Any]:
        """Generate adverse action notice if required"""
        notice = {
            'required': False,
            'reason_codes': [],
            'primary_factors': [],
            'customer_rights': [],
            'contact_information': {}
        }
        
        # Determine if adverse action notice is required
        if credit_score.credit_score < 600 or credit_score.final_recommendation in ['DECLINE', 'REFER']:
            notice['required'] = True
            
            # Add reason codes based on explanation
            if 'payment_history' in credit_score.explanation:
                notice['reason_codes'].append('01 - Payment history')
            if 'credit_utilization' in credit_score.explanation:
                notice['reason_codes'].append('02 - Credit utilization')
            if 'credit_history_length' in credit_score.explanation:
                notice['reason_codes'].append('03 - Length of credit history')
            if 'income' in credit_score.explanation:
                notice['reason_codes'].append('04 - Income')
            
            # Add primary factors
            notice['primary_factors'] = credit_score.explanation.get('top_risk_factors', [])[:4]
            
            # Add customer rights
            notice['customer_rights'] = [
                'Right to obtain a free copy of credit report',
                'Right to dispute inaccurate information',
                'Right to add a consumer statement',
                'Right to know the credit score used'
            ]
            
            # Contact information
            notice['contact_information'] = {
                'company': 'Remittance Platform',
                'phone': '+234-800-BANKING',
                'email': 'credit@remittance-platform.ng',
                'address': 'Lagos, Nigeria'
            }
        
        return notice
    
    def calculate_disparate_impact(self, scores: List[CreditScore], 
                                 protected_attribute: str) -> Dict[str, Any]:
        """Calculate disparate impact analysis"""
        analysis = {
            'protected_attribute': protected_attribute,
            'disparate_impact_ratio': 0.0,
            'statistical_significance': False,
            'groups_analyzed': {},
            'recommendations': []
        }
        
        # This would require actual implementation with statistical tests
        # For now, return placeholder structure
        analysis['recommendations'] = [
            'Monitor model performance across demographic groups',
            'Conduct regular bias testing',
            'Document model validation procedures'
        ]
        
        return analysis

class CreditScoringService:
    """Main credit scoring service"""
    
    def __init__(self):
        self.model = None
        self.compliance = RegulatoryCompliance()
        self.redis_client = None
        self.db_config = None
        self.executor = ThreadPoolExecutor(max_workers=10)
        
        # Initialize connections
        self._init_redis()
        self._init_database()
        
        # Train models on startup
        self._initialize_models()
    
    def _init_redis(self):
        """Initialize Redis connection"""
        try:
            self.redis_client = redis.Redis(
                host=os.getenv('REDIS_HOST', os.getenv('HOST', 'localhost')),
                port=int(os.getenv('REDIS_PORT', '6379')),
                db=0,
                decode_responses=True
            )
            self.redis_client.ping()
            logger.info("Redis connection established")
        except Exception as e:
            logger.error("Redis connection failed", error=str(e))
            self.redis_client = None
    
    def _init_database(self):
        """Initialize database connection"""
        try:
            self.db_config = {
                'host': os.getenv('DB_HOST', os.getenv('HOST', 'localhost')),
                'port': os.getenv('DB_PORT', '5432'),
                'database': os.getenv('DB_NAME', 'remittance'),
                'user': os.getenv('DB_USER', 'postgres'),
                os.getenv('DB_PASSWORD', 'password'): os.getenv('DB_PASSWORD', os.getenv('DB_PASSWORD', 'password'))
            }
            
            # Test connection
            conn = psycopg2.connect(**self.db_config)
            conn.close()
            logger.info("Database connection established")
        except Exception as e:
            logger.error("Database connection failed", error=str(e))
            self.db_config = None
    
    def _initialize_models(self):
        """Initialize and train models"""
        logger.info("Initializing credit scoring models")
        
        try:
            self.model = self._train_models()
            logger.info("Models initialized successfully")
        except Exception as e:
            logger.error("Model initialization failed", error=str(e))
            raise
    
    def _train_models(self) -> EnsembleCreditModel:
        """Train credit scoring models"""
        logger.info("Training credit scoring models")
        
        # Generate synthetic training data
        X_train, y_train = self._generate_training_data()
        
        # Create and train ensemble
        ensemble = EnsembleCreditModel()
        ensemble.train_traditional_models(X_train, y_train)
        
        # Train deep model if GPU available
        if torch.cuda.is_available():
            ensemble.train_deep_model(X_train, y_train)
        
        return ensemble
    
    def _generate_training_data(self) -> Tuple[np.ndarray, np.ndarray]:
        """Generate synthetic training data"""
        logger.info("Generating synthetic training data")
        
        np.random.seed(42)
        n_samples = 50000
        n_features = 100
        
        # Generate features
        X = np.random.randn(n_samples, n_features)
        
        # Generate credit scores (300-850 range)
        # Create realistic relationships
        score_base = 500
        score_range = 350
        
        # Feature importance weights
        weights = np.random.exponential(1, n_features)
        weights = weights / np.sum(weights)
        
        # Generate scores with noise
        linear_combination = np.dot(X, weights)
        scores = score_base + score_range * (linear_combination - np.min(linear_combination)) / (np.max(linear_combination) - np.min(linear_combination))
        
        # Add some noise
        scores += np.random.normal(0, 20, n_samples)
        
        # Clip to valid range
        scores = np.clip(scores, 300, 850)
        
        logger.info("Training data generated", samples=n_samples, features=n_features)
        
        return X, scores
    
    def score_credit_application(self, application_data: Dict[str, Any]) -> CreditScore:
        """Score a credit application"""
        start_time = time.time()
        session_id = str(uuid.uuid4())
        
        try:
            # Process traditional features
            traditional_features = {}
            if 'traditional_data' in application_data:
                traditional_features = self.model.feature_processors['traditional'].combine_traditional_features(
                    application_data['traditional_data']
                )
            
            # Process alternative data features
            alternative_features = {}
            if 'alternative_data' in application_data:
                alternative_features = self.model.feature_processors['alternative'].combine_alternative_data(
                    application_data['alternative_data']
                )
            
            # Combine all features
            all_features = {**traditional_features, **alternative_features}
            
            # Convert to array for prediction
            feature_array = np.array(list(all_features.values())).reshape(1, -1)
            
            # Make prediction
            predicted_score = self.model.predict(feature_array)[0]
            
            # Ensure score is in valid range
            credit_score = int(np.clip(predicted_score, 300, 850))
            
            # Calculate probability of default (simplified)
            prob_default = max(0, min(1, (850 - credit_score) / 550))
            
            # Determine risk grade and score band
            risk_grade = self._get_risk_grade(credit_score)
            score_band = self._get_score_band(credit_score)
            
            # Generate explanation
            explanation = self._generate_explanation(all_features, credit_score)
            
            # Calculate alternative vs traditional scores
            traditional_score = np.mean(list(traditional_features.values())) if traditional_features else 0
            alternative_score = np.mean(list(alternative_features.values())) if alternative_features else 0
            
            # Final recommendation
            recommendation = self._get_recommendation(credit_score, prob_default)
            
            # Check regulatory compliance
            regulatory_flags = self.compliance.check_feature_compliance(list(all_features.keys()))
            
            processing_time = (time.time() - start_time) * 1000
            
            result = CreditScore(
                application_id=application_data.get('application_id', str(uuid.uuid4())),
                customer_id=application_data.get('customer_id', 'unknown'),
                credit_score=credit_score,
                probability_of_default=prob_default,
                risk_grade=risk_grade,
                score_band=score_band,
                model_used='ensemble',
                features_used=list(all_features.keys()),
                explanation=explanation,
                confidence=min(0.95, 0.7 + (len(all_features) / 200)),
                processing_time_ms=processing_time,
                timestamp=datetime.now(),
                session_id=session_id,
                regulatory_flags=regulatory_flags,
                alternative_data_score=alternative_score,
                traditional_score=traditional_score,
                final_recommendation=recommendation
            )
            
            # Update metrics
            CREDIT_SCORES.labels(model='ensemble', score_band=score_band).inc()
            SCORING_LATENCY.observe(processing_time / 1000)
            
            logger.info("Credit application scored",
                       application_id=result.application_id,
                       credit_score=credit_score,
                       risk_grade=risk_grade,
                       processing_time_ms=processing_time)
            
            return result
            
        except Exception as e:
            logger.error("Credit scoring error", error=str(e))
            
            # Return safe default
            return CreditScore(
                application_id=application_data.get('application_id', str(uuid.uuid4())),
                customer_id=application_data.get('customer_id', 'unknown'),
                credit_score=500,
                probability_of_default=0.5,
                risk_grade='BB',
                score_band='FAIR',
                model_used='error_fallback',
                features_used=[],
                explanation={'error': str(e)},
                confidence=0.1,
                processing_time_ms=(time.time() - start_time) * 1000,
                timestamp=datetime.now(),
                session_id=session_id,
                regulatory_flags={'compliant': False, 'error': str(e)},
                alternative_data_score=0.0,
                traditional_score=0.0,
                final_recommendation='REFER'
            )
    
    def _get_risk_grade(self, credit_score: int) -> str:
        """Convert credit score to risk grade"""
        if credit_score >= 800:
            return 'AAA'
        elif credit_score >= 750:
            return 'AA'
        elif credit_score >= 700:
            return 'A'
        elif credit_score >= 650:
            return 'BBB'
        elif credit_score >= 600:
            return 'BB'
        elif credit_score >= 550:
            return 'B'
        elif credit_score >= 500:
            return 'CCC'
        elif credit_score >= 450:
            return 'CC'
        elif credit_score >= 400:
            return 'C'
        else:
            return 'D'
    
    def _get_score_band(self, credit_score: int) -> str:
        """Convert credit score to score band"""
        if credit_score >= 750:
            return 'EXCELLENT'
        elif credit_score >= 700:
            return 'GOOD'
        elif credit_score >= 650:
            return 'FAIR'
        elif credit_score >= 600:
            return 'POOR'
        else:
            return 'VERY_POOR'
    
    def _get_recommendation(self, credit_score: int, prob_default: float) -> str:
        """Get final recommendation"""
        if credit_score >= 700 and prob_default < 0.1:
            return 'APPROVE'
        elif credit_score >= 650 and prob_default < 0.2:
            return 'APPROVE_WITH_CONDITIONS'
        elif credit_score >= 600 and prob_default < 0.3:
            return 'REFER'
        else:
            return 'DECLINE'
    
    def _generate_explanation(self, features: Dict[str, float], credit_score: int) -> Dict[str, Any]:
        """Generate explanation for credit score"""
        try:
            # Sort features by absolute value (importance proxy)
            sorted_features = sorted(features.items(), key=lambda x: abs(x[1]), reverse=True)
            
            # Top positive and negative factors
            top_positive = [(k, v) for k, v in sorted_features[:5] if v > 0]
            top_negative = [(k, v) for k, v in sorted_features[:5] if v < 0]
            
            explanation = {
                'credit_score': credit_score,
                'top_positive_factors': [f[0] for f in top_positive],
                'top_negative_factors': [f[0] for f in top_negative],
                'feature_importance': dict(sorted_features[:10]),
                'explanation_method': 'feature_analysis',
                'model_confidence': min(0.95, 0.7 + (len(features) / 200))
            }
            
            # Add narrative explanation
            if credit_score >= 700:
                explanation['narrative'] = "Strong credit profile with positive payment history and low risk indicators."
            elif credit_score >= 600:
                explanation['narrative'] = "Moderate credit profile with some areas for improvement."
            else:
                explanation['narrative'] = "Credit profile shows elevated risk factors requiring careful consideration."
            
            return explanation
            
        except Exception as e:
            logger.error("Explanation generation error", error=str(e))
            return {
                'credit_score': credit_score,
                'explanation_method': 'error',
                'error': str(e)
            }

# Flask Application
app = Flask(__name__)
CORS(app)

# Initialize credit scoring service
credit_service = CreditScoringService()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Advanced Credit Scoring Engine',
        'version': '2.0.0',
        'models_loaded': credit_service.model is not None,
        'redis_connected': credit_service.redis_client is not None,
        'database_connected': credit_service.db_config is not None,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/credit/score', methods=['POST'])
def score_application():
    """Score a credit application"""
    try:
        application_data = request.json
        
        if not application_data:
            return jsonify({'error': 'No application data provided'}), 400
        
        # Validate required fields
        required_fields = ['customer_id']
        for field in required_fields:
            if field not in application_data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Score application
        credit_score = credit_service.score_credit_application(application_data)
        
        return jsonify({
            'success': True,
            'credit_score': asdict(credit_score)
        })
        
    except Exception as e:
        logger.error("Credit scoring error", error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/credit/adverse-action', methods=['POST'])
def generate_adverse_action():
    """Generate adverse action notice"""
    try:
        data = request.json
        application_data = data.get('application_data')
        
        if not application_data:
            return jsonify({'error': 'No application data provided'}), 400
        
        # Score application first
        credit_score = credit_service.score_credit_application(application_data)
        
        # Generate adverse action notice
        notice = credit_service.compliance.generate_adverse_action_notice(credit_score)
        
        return jsonify({
            'success': True,
            'credit_score': asdict(credit_score),
            'adverse_action_notice': notice
        })
        
    except Exception as e:
        logger.error("Adverse action generation error", error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/metrics', methods=['GET'])
def metrics():
    """Prometheus metrics endpoint"""
    return generate_latest()

if __name__ == '__main__':
    logger.info("Starting Advanced Credit Scoring Engine")
    
    # Create necessary directories
    os.makedirs('models', exist_ok=True)
    os.makedirs('logs', exist_ok=True)
    os.makedirs('data', exist_ok=True)
    
    # Start the application
    app.run(
        host=os.getenv('HOST', os.getenv('HOST', '0.0.0.0')),
        port=int(os.getenv('PORT', 5006)),
        debug=os.getenv('DEBUG', 'False').lower() == 'true',
        threaded=True
    )

