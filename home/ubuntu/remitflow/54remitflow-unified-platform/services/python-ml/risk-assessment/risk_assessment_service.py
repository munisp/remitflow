#!/usr/bin/env python3
"""
Comprehensive Risk Assessment and Scoring Service for Remittance Platform
Provides multi-dimensional risk analysis, credit scoring, and regulatory compliance
"""

import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple, Union
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
from enum import Enum

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.append(str(project_root))

try:
    # Flask and web framework
    from flask import Flask, request, jsonify, g
    from flask_cors import CORS
    
    # Machine Learning libraries
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler, LabelEncoder, RobustScaler
    from sklearn.model_selection import train_test_split, cross_val_score
    from sklearn.metrics import classification_report, roc_auc_score, precision_recall_curve
    from sklearn.pipeline import Pipeline
    from sklearn.compose import ColumnTransformer
    import xgboost as xgb
    import lightgbm as lgb
    
    # Deep Learning
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    
    # Statistical analysis
    import scipy.stats as stats
    from scipy.optimize import minimize
    
    # Time series
    from statsmodels.tsa.arima.model import ARIMA
    from statsmodels.stats.diagnostic import acorr_ljungbox
    
    # Data processing
    import redis
    import psycopg2
    from psycopg2.extras import RealDictCursor
    
    # Monitoring
    import mlflow
    import mlflow.sklearn
    import mlflow.pytorch
    
    # Financial calculations
    import numpy_financial as npf
    
except ImportError as e:
    logger.info(f"Required packages not installed: {e}")
    logger.info("Please install: pip install torch scikit-learn xgboost lightgbm statsmodels scipy mlflow redis psycopg2-binary numpy-financial")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class RiskCategory(Enum):
    """Risk category levels"""
    VERY_LOW = "very_low"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"

class RiskType(Enum):
    """Types of risk assessment"""
    CREDIT = "credit"
    OPERATIONAL = "operational"
    MARKET = "market"
    LIQUIDITY = "liquidity"
    COMPLIANCE = "compliance"
    FRAUD = "fraud"
    CONCENTRATION = "concentration"

@dataclass
class RiskAssessment:
    """Risk assessment result"""
    entity_id: str
    entity_type: str
    risk_type: RiskType
    risk_score: float
    risk_category: RiskCategory
    confidence: float
    factors: Dict[str, float]
    recommendations: List[str]
    regulatory_flags: List[str]
    assessment_date: datetime
    valid_until: datetime
    model_version: str

@dataclass
class CreditScore:
    """Credit scoring result"""
    customer_id: str
    credit_score: int
    probability_of_default: float
    credit_limit_recommendation: float
    risk_grade: str
    score_factors: Dict[str, float]
    bureau_data: Dict[str, Any]
    alternative_data: Dict[str, Any]
    assessment_date: datetime

@dataclass
class PortfolioRisk:
    """Portfolio risk metrics"""
    portfolio_id: str
    total_exposure: float
    var_95: float
    var_99: float
    expected_shortfall: float
    concentration_risk: float
    sector_distribution: Dict[str, float]
    geographic_distribution: Dict[str, float]
    risk_adjusted_return: float
    sharpe_ratio: float

class CreditScoringModel(nn.Module):
    """Deep learning model for credit scoring"""
    
    def __init__(self, input_dim: int, hidden_dims: List[int] = [128, 64, 32]):
        super(CreditScoringModel, self).__init__()
        
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
        
        # Output layer for probability of default
        layers.extend([
            nn.Linear(prev_dim, 1),
            nn.Sigmoid()
        ])
        
        self.network = nn.Sequential(*layers)
    
        super(CreditScoringModel, self).__init__()
        
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
        
        # Output layer for probability of default
        layers.extend([
            nn.Linear(prev_dim, 1),
            nn.Sigmoid()
        ])
        
        self.network = nn.Sequential(*layers)
    
    def forward(self, x):
        """Forward pass"""
        return self.network(x)

        """Forward pass"""
        return self.network(x)

class RiskAssessmentService:
    """Comprehensive risk assessment and scoring service"""
    
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
        
        # Risk models
        self.credit_model = None
        self.operational_risk_model = None
        self.market_risk_model = None
        self.liquidity_risk_model = None
        self.compliance_risk_model = None
        self.deep_credit_model = None
        
        # Preprocessing
        self.scalers = {}
        self.label_encoders = {}
        
        # Risk parameters
        self.risk_weights = {
            RiskType.CREDIT: 0.30,
            RiskType.OPERATIONAL: 0.20,
            RiskType.MARKET: 0.15,
            RiskType.LIQUIDITY: 0.15,
            RiskType.COMPLIANCE: 0.10,
            RiskType.FRAUD: 0.10
        }
        
        # Feature definitions
        self.credit_features = [
            'income', 'debt_to_income', 'credit_history_length', 'payment_history_score',
            'credit_utilization', 'number_of_accounts', 'recent_inquiries', 'account_age_avg',
            'transaction_volume_3m', 'transaction_frequency', 'balance_volatility'
        ]
        
        self.operational_features = [
            'agent_experience_months', 'transaction_volume', 'error_rate', 'compliance_score',
            'customer_complaints', 'system_downtime', 'staff_turnover', 'audit_findings'
        ]
        
        # Initialize MLflow
        mlflow.set_tracking_uri("http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")")"):5000")
        mlflow.set_experiment("risk_assessment")
        
        self._initialize_models()
        self._load_regulatory_rules()
    
    def _initialize_models(self):
        """Initialize risk assessment models"""
        try:
            # Credit risk model
            self.credit_model = Pipeline([
                ('scaler', StandardScaler()),
                ('classifier', GradientBoostingClassifier(
                    n_estimators=100,
                    learning_rate=0.1,
                    max_depth=6,
                    random_state=42
                ))
            ])
            
            # Operational risk model
            self.operational_risk_model = Pipeline([
                ('scaler', RobustScaler()),
                ('classifier', RandomForestClassifier(
                    n_estimators=100,
                    max_depth=8,
                    random_state=42
                ))
            ])
            
            # Market risk model (for portfolio analysis)
            self.market_risk_model = Pipeline([
                ('scaler', StandardScaler()),
                ('regressor', xgb.XGBRegressor(
                    n_estimators=100,
                    learning_rate=0.1,
                    max_depth=6,
                    random_state=42
                ))
            ])
            
            # Deep learning credit model
            self.deep_credit_model = CreditScoringModel(
                input_dim=len(self.credit_features),
                hidden_dims=[128, 64, 32]
            )
            
            # Initialize scalers
            for risk_type in RiskType:
                self.scalers[risk_type] = StandardScaler()
            
            logger.info("Risk assessment models initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize models: {e}")
            raise
    
        """Initialize risk assessment models"""
        try:
            # Credit risk model
            self.credit_model = Pipeline([
                ('scaler', StandardScaler()),
                ('classifier', GradientBoostingClassifier(
                    n_estimators=100,
                    learning_rate=0.1,
                    max_depth=6,
                    random_state=42
                ))
            ])
            
            # Operational risk model
            self.operational_risk_model = Pipeline([
                ('scaler', RobustScaler()),
                ('classifier', RandomForestClassifier(
                    n_estimators=100,
                    max_depth=8,
                    random_state=42
                ))
            ])
            
            # Market risk model (for portfolio analysis)
            self.market_risk_model = Pipeline([
                ('scaler', StandardScaler()),
                ('regressor', xgb.XGBRegressor(
                    n_estimators=100,
                    learning_rate=0.1,
                    max_depth=6,
                    random_state=42
                ))
            ])
            
            # Deep learning credit model
            self.deep_credit_model = CreditScoringModel(
                input_dim=len(self.credit_features),
                hidden_dims=[128, 64, 32]
            )
            
            # Initialize scalers
            for risk_type in RiskType:
                self.scalers[risk_type] = StandardScaler()
            
            logger.info("Risk assessment models initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize models: {e}")
            raise
    
    def _load_regulatory_rules(self):
        """Load regulatory compliance rules"""
        try:
            # African banking regulatory requirements
            self.regulatory_rules = {
                'south_africa': {
                    'max_single_exposure': 0.25,  # 25% of capital
                    'max_large_exposures': 0.80,  # 80% of capital
                    'min_capital_ratio': 0.08,    # 8% minimum
                    'max_leverage_ratio': 0.06,   # 6% maximum
                    'liquidity_coverage_ratio': 1.0  # 100% minimum
                },
                'nigeria': {
                    'max_single_exposure': 0.20,
                    'max_large_exposures': 0.75,
                    'min_capital_ratio': 0.10,
                    'max_leverage_ratio': 0.05,
                    'liquidity_coverage_ratio': 1.0
                },
                'kenya': {
                    'max_single_exposure': 0.25,
                    'max_large_exposures': 0.80,
                    'min_capital_ratio': 0.105,
                    'max_leverage_ratio': 0.06,
                    'liquidity_coverage_ratio': 1.0
                }
            }
            
            logger.info("Regulatory rules loaded")
            
        except Exception as e:
            logger.error(f"Failed to load regulatory rules: {e}")
    
        """Load regulatory compliance rules"""
        try:
            # African banking regulatory requirements
            self.regulatory_rules = {
                'south_africa': {
                    'max_single_exposure': 0.25,  # 25% of capital
                    'max_large_exposures': 0.80,  # 80% of capital
                    'min_capital_ratio': 0.08,    # 8% minimum
                    'max_leverage_ratio': 0.06,   # 6% maximum
                    'liquidity_coverage_ratio': 1.0  # 100% minimum
                },
                'nigeria': {
                    'max_single_exposure': 0.20,
                    'max_large_exposures': 0.75,
                    'min_capital_ratio': 0.10,
                    'max_leverage_ratio': 0.05,
                    'liquidity_coverage_ratio': 1.0
                },
                'kenya': {
                    'max_single_exposure': 0.25,
                    'max_large_exposures': 0.80,
                    'min_capital_ratio': 0.105,
                    'max_leverage_ratio': 0.06,
                    'liquidity_coverage_ratio': 1.0
                }
            }
            
            logger.info("Regulatory rules loaded")
            
        except Exception as e:
            logger.error(f"Failed to load regulatory rules: {e}")
    
    def extract_credit_features(self, customer_id: str) -> Dict[str, float]:
        """Extract credit risk features for a customer"""
        try:
            with psycopg2.connect(**self.postgres_config) as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Get customer financial data
                    cursor.execute("""
                        SELECT 
                            c.monthly_income,
                            c.total_debt,
                            c.credit_history_months,
                            COUNT(t.transaction_id) as transaction_count_3m,
                            SUM(t.amount) as transaction_volume_3m,
                            AVG(t.amount) as avg_transaction_amount,
                            STDDEV(t.amount) as transaction_volatility,
                            COUNT(DISTINCT t.agent_id) as unique_agents,
                            MIN(t.created_at) as first_transaction,
                            MAX(t.created_at) as last_transaction
                        FROM customers c
                        LEFT JOIN transactions t ON c.customer_id = t.customer_id 
                            AND t.created_at >= CURRENT_DATE - INTERVAL '3 months'
                        WHERE c.customer_id = %s
                        GROUP BY c.customer_id, c.monthly_income, c.total_debt, c.credit_history_months
                    """, (customer_id,))
                    
                    data = cursor.fetchone()
                    
                    if not data:
                        return {col: 0.0 for col in self.credit_features}
                    
                    # Calculate derived features
                    income = float(data['monthly_income'] or 0)
                    debt = float(data['total_debt'] or 0)
                    debt_to_income = debt / max(income, 1) if income > 0 else 0
                    
                    credit_history_length = float(data['credit_history_months'] or 0)
                    transaction_volume_3m = float(data['transaction_volume_3m'] or 0)
                    transaction_frequency = float(data['transaction_count_3m'] or 0) / 90  # per day
                    balance_volatility = float(data['transaction_volatility'] or 0) / max(data['avg_transaction_amount'] or 1, 1)
                    
                    # Get additional credit bureau data (simulated)
                    payment_history_score = self._get_payment_history_score(customer_id)
                    credit_utilization = self._get_credit_utilization(customer_id)
                    number_of_accounts = self._get_number_of_accounts(customer_id)
                    recent_inquiries = self._get_recent_inquiries(customer_id)
                    account_age_avg = self._get_average_account_age(customer_id)
                    
                    features = {
                        'income': income,
                        'debt_to_income': debt_to_income,
                        'credit_history_length': credit_history_length,
                        'payment_history_score': payment_history_score,
                        'credit_utilization': credit_utilization,
                        'number_of_accounts': number_of_accounts,
                        'recent_inquiries': recent_inquiries,
                        'account_age_avg': account_age_avg,
                        'transaction_volume_3m': transaction_volume_3m,
                        'transaction_frequency': transaction_frequency,
                        'balance_volatility': balance_volatility
                    }
                    
                    return features
            
        except Exception as e:
            logger.error(f"Failed to extract credit features for {customer_id}: {e}")
            return {col: 0.0 for col in self.credit_features}
    
    def _get_payment_history_score(self, customer_id: str) -> float:
        """Get payment history score (simulated credit bureau data)"""
        try:
            # In production, this would integrate with credit bureaus
            # For now, simulate based on transaction patterns
            
            # Get payment behavior from transaction history
            with psycopg2.connect(**self.postgres_config) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT 
                            COUNT(CASE WHEN transaction_type = 'bill_payment' THEN 1 END) as bill_payments,
                            COUNT(CASE WHEN transaction_type = 'loan_payment' THEN 1 END) as loan_payments,
                            COUNT(*) as total_transactions
                        FROM transactions 
                        WHERE customer_id = %s 
                        AND created_at >= CURRENT_DATE - INTERVAL '12 months'
                    """, (customer_id,))
                    
                    data = cursor.fetchone()
                    
                    if data and data[2] > 0:  # total_transactions > 0
                        payment_ratio = (data[0] + data[1]) / data[2]  # payment transactions ratio
                        return min(100, payment_ratio * 100 + np.random.normal(70, 10))
                    else:
                        return 50.0  # Default score for new customers
            
        except Exception as e:
            logger.error(f"Failed to get payment history score: {e}")
            return 50.0
    
    def _get_credit_utilization(self, customer_id: str) -> float:
        """Get credit utilization ratio"""
        try:
            # Simulate credit utilization based on account balance patterns
            key = f"customer:{customer_id}:credit_utilization"
            utilization = self.redis_client.get(key)
            
            if utilization:
                return float(utilization)
            else:
                # Simulate utilization ratio
                utilization = np.random.beta(2, 5)  # Typically low utilization
                self.redis_client.setex(key, 3600, utilization)  # Cache for 1 hour
                return utilization
            
        except Exception as e:
            logger.error(f"Failed to get credit utilization: {e}")
            return 0.3  # Default 30% utilization
    
    def _get_number_of_accounts(self, customer_id: str) -> float:
        """Get number of credit accounts"""
        try:
            # In production, this would come from credit bureau
            # Simulate based on customer profile
            return float(np.random.poisson(3) + 1)  # 1-10 accounts typically
            
        except Exception as e:
            logger.error(f"Failed to get number of accounts: {e}")
            return 2.0
    
    def _get_recent_inquiries(self, customer_id: str) -> float:
        """Get number of recent credit inquiries"""
        try:
            # Simulate recent inquiries
            return float(np.random.poisson(1))  # 0-5 inquiries typically
            
        except Exception as e:
            logger.error(f"Failed to get recent inquiries: {e}")
            return 1.0
    
    def _get_average_account_age(self, customer_id: str) -> float:
        """Get average age of credit accounts in months"""
        try:
            # Simulate account age
            return float(np.random.gamma(2, 12))  # Average 24 months
            
        except Exception as e:
            logger.error(f"Failed to get average account age: {e}")
            return 24.0
    
    def assess_credit_risk(self, customer_id: str) -> RiskAssessment:
        """Assess credit risk for a customer"""
        try:
            # Extract features
            features = self.extract_credit_features(customer_id)
            feature_vector = np.array([features[col] for col in self.credit_features]).reshape(1, -1)
            
            # Traditional ML prediction
            ml_probability = self.credit_model.predict_proba(feature_vector)[0][1] if hasattr(self.credit_model, 'predict_proba') else 0.5
            
            # Deep learning prediction
            feature_tensor = torch.tensor(feature_vector, dtype=torch.float32)
            self.deep_credit_model.eval()
            with torch.no_grad():
                dl_probability = float(self.deep_credit_model(feature_tensor).item())
            
            # Ensemble prediction
            ensemble_probability = 0.6 * ml_probability + 0.4 * dl_probability
            risk_score = ensemble_probability * 100
            
            # Determine risk category
            if risk_score < 20:
                risk_category = RiskCategory.VERY_LOW
            elif risk_score < 40:
                risk_category = RiskCategory.LOW
            elif risk_score < 60:
                risk_category = RiskCategory.MEDIUM
            elif risk_score < 80:
                risk_category = RiskCategory.HIGH
            else:
                risk_category = RiskCategory.VERY_HIGH
            
            # Calculate feature importance
            feature_importance = self._calculate_feature_importance(features, self.credit_features)
            
            # Generate recommendations
            recommendations = self._generate_credit_recommendations(risk_score, features)
            
            # Check regulatory flags
            regulatory_flags = self._check_credit_regulatory_flags(features)
            
            return RiskAssessment(
                entity_id=customer_id,
                entity_type="customer",
                risk_type=RiskType.CREDIT,
                risk_score=risk_score,
                risk_category=risk_category,
                confidence=0.85,
                factors=feature_importance,
                recommendations=recommendations,
                regulatory_flags=regulatory_flags,
                assessment_date=datetime.now(),
                valid_until=datetime.now() + timedelta(days=30),
                model_version="v1.0"
            )
            
        except Exception as e:
            logger.error(f"Failed to assess credit risk for {customer_id}: {e}")
            return self._default_risk_assessment(customer_id, RiskType.CREDIT)
    
    def assess_operational_risk(self, agent_id: str) -> RiskAssessment:
        """Assess operational risk for an agent"""
        try:
            # Extract operational features
            features = self._extract_operational_features(agent_id)
            feature_vector = np.array([features[col] for col in self.operational_features]).reshape(1, -1)
            
            # Predict operational risk
            risk_probability = self.operational_risk_model.predict_proba(feature_vector)[0][1] if hasattr(self.operational_risk_model, 'predict_proba') else 0.3
            risk_score = risk_probability * 100
            
            # Determine risk category
            if risk_score < 25:
                risk_category = RiskCategory.VERY_LOW
            elif risk_score < 45:
                risk_category = RiskCategory.LOW
            elif risk_score < 65:
                risk_category = RiskCategory.MEDIUM
            elif risk_score < 85:
                risk_category = RiskCategory.HIGH
            else:
                risk_category = RiskCategory.VERY_HIGH
            
            # Calculate feature importance
            feature_importance = self._calculate_feature_importance(features, self.operational_features)
            
            # Generate recommendations
            recommendations = self._generate_operational_recommendations(risk_score, features)
            
            # Check regulatory flags
            regulatory_flags = self._check_operational_regulatory_flags(features)
            
            return RiskAssessment(
                entity_id=agent_id,
                entity_type="agent",
                risk_type=RiskType.OPERATIONAL,
                risk_score=risk_score,
                risk_category=risk_category,
                confidence=0.80,
                factors=feature_importance,
                recommendations=recommendations,
                regulatory_flags=regulatory_flags,
                assessment_date=datetime.now(),
                valid_until=datetime.now() + timedelta(days=7),
                model_version="v1.0"
            )
            
        except Exception as e:
            logger.error(f"Failed to assess operational risk for {agent_id}: {e}")
            return self._default_risk_assessment(agent_id, RiskType.OPERATIONAL)
    
    def _extract_operational_features(self, agent_id: str) -> Dict[str, float]:
        """Extract operational risk features for an agent"""
        try:
            with psycopg2.connect(**self.postgres_config) as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Get agent operational data
                    cursor.execute("""
                        SELECT 
                            a.experience_months,
                            COUNT(t.transaction_id) as transaction_count,
                            SUM(t.amount) as transaction_volume,
                            COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_transactions,
                            a.compliance_score,
                            a.customer_rating,
                            EXTRACT(DAYS FROM (CURRENT_DATE - a.last_training_date)) as days_since_training
                        FROM agents a
                        LEFT JOIN transactions t ON a.agent_id = t.agent_id 
                            AND t.created_at >= CURRENT_DATE - INTERVAL '30 days'
                        WHERE a.agent_id = %s
                        GROUP BY a.agent_id, a.experience_months, a.compliance_score, 
                                a.customer_rating, a.last_training_date
                    """, (agent_id,))
                    
                    data = cursor.fetchone()
                    
                    if not data:
                        return {col: 0.0 for col in self.operational_features}
                    
                    # Calculate derived features
                    total_transactions = float(data['transaction_count'] or 0)
                    failed_transactions = float(data['failed_transactions'] or 0)
                    error_rate = failed_transactions / max(total_transactions, 1)
                    
                    features = {
                        'agent_experience_months': float(data['experience_months'] or 0),
                        'transaction_volume': float(data['transaction_volume'] or 0),
                        'error_rate': error_rate,
                        'compliance_score': float(data['compliance_score'] or 50),
                        'customer_complaints': self._get_customer_complaints(agent_id),
                        'system_downtime': self._get_system_downtime(agent_id),
                        'staff_turnover': self._get_staff_turnover(agent_id),
                        'audit_findings': self._get_audit_findings(agent_id)
                    }
                    
                    return features
            
        except Exception as e:
            logger.error(f"Failed to extract operational features for {agent_id}: {e}")
            return {col: 0.0 for col in self.operational_features}
    
    def _get_customer_complaints(self, agent_id: str) -> float:
        """Get number of customer complaints for agent"""
        try:
            # Simulate customer complaints
            return float(np.random.poisson(0.5))  # Low complaint rate
        except:
            return 0.0
    
    def _get_system_downtime(self, agent_id: str) -> float:
        """Get system downtime percentage for agent"""
        try:
            # Simulate system downtime
            return float(np.random.beta(1, 20))  # Low downtime typically
        except:
            return 0.02  # 2% default
    
    def _get_staff_turnover(self, agent_id: str) -> float:
        """Get staff turnover rate for agent location"""
        try:
            # Simulate staff turnover
            return float(np.random.beta(2, 8))  # Moderate turnover
        except:
            return 0.15  # 15% default
    
    def _get_audit_findings(self, agent_id: str) -> float:
        """Get number of audit findings for agent"""
        try:
            # Simulate audit findings
            return float(np.random.poisson(1))  # Few findings typically
        except:
            return 1.0
    
    def calculate_portfolio_risk(self, portfolio_id: str) -> PortfolioRisk:
        """Calculate portfolio risk metrics"""
        try:
            # Get portfolio data
            portfolio_data = self._get_portfolio_data(portfolio_id)
            
            if not portfolio_data:
                raise ValueError(f"Portfolio {portfolio_id} not found")
            
            # Calculate Value at Risk (VaR)
            returns = np.array(portfolio_data['returns'])
            var_95 = np.percentile(returns, 5)
            var_99 = np.percentile(returns, 1)
            
            # Calculate Expected Shortfall (Conditional VaR)
            expected_shortfall = returns[returns <= var_95].mean()
            
            # Calculate concentration risk
            exposures = np.array(portfolio_data['exposures'])
            concentration_risk = self._calculate_concentration_risk(exposures)
            
            # Calculate risk-adjusted return
            mean_return = np.mean(returns)
            return_volatility = np.std(returns)
            sharpe_ratio = mean_return / return_volatility if return_volatility > 0 else 0
            
            return PortfolioRisk(
                portfolio_id=portfolio_id,
                total_exposure=float(np.sum(exposures)),
                var_95=float(var_95),
                var_99=float(var_99),
                expected_shortfall=float(expected_shortfall),
                concentration_risk=float(concentration_risk),
                sector_distribution=portfolio_data['sector_distribution'],
                geographic_distribution=portfolio_data['geographic_distribution'],
                risk_adjusted_return=float(mean_return),
                sharpe_ratio=float(sharpe_ratio)
            )
            
        except Exception as e:
            logger.error(f"Failed to calculate portfolio risk for {portfolio_id}: {e}")
            raise
    
    def _get_portfolio_data(self, portfolio_id: str) -> Dict[str, Any]:
        """Get portfolio data for risk calculation"""
        try:
            # Simulate portfolio data
            n_assets = 50
            
            # Generate synthetic returns
            returns = np.random.normal(0.08/252, 0.15/np.sqrt(252), 252)  # Daily returns for 1 year
            
            # Generate exposures
            exposures = np.random.lognormal(10, 1, n_assets)
            
            # Sector distribution
            sectors = ['Financial Services', 'Agriculture', 'Manufacturing', 'Technology', 'Retail']
            sector_weights = np.random.dirichlet([1] * len(sectors))
            sector_distribution = dict(zip(sectors, sector_weights))
            
            # Geographic distribution
            countries = ['South Africa', 'Nigeria', 'Kenya', 'Ghana', 'Uganda']
            geo_weights = np.random.dirichlet([1] * len(countries))
            geographic_distribution = dict(zip(countries, geo_weights))
            
            return {
                'returns': returns,
                'exposures': exposures,
                'sector_distribution': sector_distribution,
                'geographic_distribution': geographic_distribution
            }
            
        except Exception as e:
            logger.error(f"Failed to get portfolio data: {e}")
            return None
    
    def _calculate_concentration_risk(self, exposures: np.ndarray) -> float:
        """Calculate concentration risk using Herfindahl-Hirschman Index"""
        try:
            total_exposure = np.sum(exposures)
            weights = exposures / total_exposure
            hhi = np.sum(weights ** 2)
            
            # Normalize to 0-1 scale (1 = maximum concentration)
            return float(hhi)
            
        except Exception as e:
            logger.error(f"Failed to calculate concentration risk: {e}")
            return 0.5
    
    def generate_credit_score(self, customer_id: str) -> CreditScore:
        """Generate comprehensive credit score"""
        try:
            # Get credit risk assessment
            risk_assessment = self.assess_credit_risk(customer_id)
            
            # Convert risk score to credit score (300-850 scale)
            # Lower risk = higher credit score
            credit_score = int(850 - (risk_assessment.risk_score * 5.5))
            credit_score = max(300, min(850, credit_score))
            
            # Determine credit grade
            if credit_score >= 750:
                risk_grade = "A"
            elif credit_score >= 700:
                risk_grade = "B"
            elif credit_score >= 650:
                risk_grade = "C"
            elif credit_score >= 600:
                risk_grade = "D"
            else:
                risk_grade = "E"
            
            # Calculate credit limit recommendation
            features = self.extract_credit_features(customer_id)
            income = features.get('income', 0)
            debt_to_income = features.get('debt_to_income', 0)
            
            # Conservative credit limit calculation
            available_income = income * (1 - debt_to_income)
            credit_limit = available_income * 0.3 * 12  # 30% of available annual income
            
            # Adjust based on credit score
            score_multiplier = credit_score / 750  # Normalize to 750 as baseline
            credit_limit *= score_multiplier
            
            return CreditScore(
                customer_id=customer_id,
                credit_score=credit_score,
                probability_of_default=risk_assessment.risk_score / 100,
                credit_limit_recommendation=float(credit_limit),
                risk_grade=risk_grade,
                score_factors=risk_assessment.factors,
                bureau_data={},  # Would be populated from credit bureau
                alternative_data=features,
                assessment_date=datetime.now()
            )
            
        except Exception as e:
            logger.error(f"Failed to generate credit score for {customer_id}: {e}")
            # Return default credit score
            return CreditScore(
                customer_id=customer_id,
                credit_score=600,
                probability_of_default=0.15,
                credit_limit_recommendation=10000.0,
                risk_grade="C",
                score_factors={},
                bureau_data={},
                alternative_data={},
                assessment_date=datetime.now()
            )
    
    def _calculate_feature_importance(self, features: Dict[str, float], feature_names: List[str]) -> Dict[str, float]:
        """Calculate feature importance for risk factors"""
        try:
            # Simplified feature importance calculation
            # In production, this would use SHAP values or model-specific importance
            
            importance = {}
            total_value = sum(abs(features[name]) for name in feature_names)
            
            for name in feature_names:
                if total_value > 0:
                    importance[name] = abs(features[name]) / total_value
                else:
                    importance[name] = 1.0 / len(feature_names)
            
            return importance
            
        except Exception as e:
            logger.error(f"Failed to calculate feature importance: {e}")
            return {name: 1.0 / len(feature_names) for name in feature_names}
    
    def _generate_credit_recommendations(self, risk_score: float, features: Dict[str, float]) -> List[str]:
        """Generate credit risk recommendations"""
        recommendations = []
        
        try:
            if risk_score > 80:
                recommendations.extend([
                    "Decline credit application",
                    "Require additional collateral if proceeding",
                    "Implement enhanced monitoring"
                ])
            elif risk_score > 60:
                recommendations.extend([
                    "Approve with reduced credit limit",
                    "Require co-signer or guarantor",
                    "Implement monthly review process"
                ])
            elif risk_score > 40:
                recommendations.extend([
                    "Approve with standard terms",
                    "Monitor payment behavior closely",
                    "Offer financial education resources"
                ])
            else:
                recommendations.extend([
                    "Approve with favorable terms",
                    "Consider for premium products",
                    "Offer credit limit increases"
                ])
            
            # Specific recommendations based on features
            if features.get('debt_to_income', 0) > 0.4:
                recommendations.append("Recommend debt consolidation services")
            
            if features.get('credit_utilization', 0) > 0.8:
                recommendations.append("Advise on credit utilization management")
            
            if features.get('payment_history_score', 0) < 60:
                recommendations.append("Provide payment reminder services")
            
            return recommendations
            
        except Exception as e:
            logger.error(f"Failed to generate credit recommendations: {e}")
            return ["Standard risk management procedures"]
    
    def _generate_operational_recommendations(self, risk_score: float, features: Dict[str, float]) -> List[str]:
        """Generate operational risk recommendations"""
        recommendations = []
        
        try:
            if risk_score > 80:
                recommendations.extend([
                    "Immediate operational review required",
                    "Suspend high-risk activities",
                    "Implement enhanced controls"
                ])
            elif risk_score > 60:
                recommendations.extend([
                    "Increase monitoring frequency",
                    "Provide additional training",
                    "Review operational procedures"
                ])
            else:
                recommendations.extend([
                    "Continue standard operations",
                    "Regular performance reviews",
                    "Maintain current controls"
                ])
            
            # Specific recommendations
            if features.get('error_rate', 0) > 0.05:
                recommendations.append("Implement error reduction training")
            
            if features.get('compliance_score', 0) < 70:
                recommendations.append("Mandatory compliance training required")
            
            if features.get('customer_complaints', 0) > 2:
                recommendations.append("Customer service improvement program")
            
            return recommendations
            
        except Exception as e:
            logger.error(f"Failed to generate operational recommendations: {e}")
            return ["Standard operational procedures"]
    
    def _check_credit_regulatory_flags(self, features: Dict[str, float]) -> List[str]:
        """Check for credit regulatory compliance flags"""
        flags = []
        
        try:
            # Check debt-to-income ratio
            if features.get('debt_to_income', 0) > 0.5:
                flags.append("High debt-to-income ratio exceeds regulatory guidelines")
            
            # Check credit utilization
            if features.get('credit_utilization', 0) > 0.9:
                flags.append("Credit utilization near maximum limit")
            
            # Check recent inquiries
            if features.get('recent_inquiries', 0) > 5:
                flags.append("Excessive recent credit inquiries")
            
            return flags
            
        except Exception as e:
            logger.error(f"Failed to check credit regulatory flags: {e}")
            return []
    
    def _check_operational_regulatory_flags(self, features: Dict[str, float]) -> List[str]:
        """Check for operational regulatory compliance flags"""
        flags = []
        
        try:
            # Check compliance score
            if features.get('compliance_score', 0) < 60:
                flags.append("Compliance score below regulatory minimum")
            
            # Check error rate
            if features.get('error_rate', 0) > 0.1:
                flags.append("Error rate exceeds acceptable threshold")
            
            # Check audit findings
            if features.get('audit_findings', 0) > 3:
                flags.append("Multiple audit findings require attention")
            
            return flags
            
        except Exception as e:
            logger.error(f"Failed to check operational regulatory flags: {e}")
            return []
    
    def _default_risk_assessment(self, entity_id: str, risk_type: RiskType) -> RiskAssessment:
        """Return default risk assessment in case of errors"""
        return RiskAssessment(
            entity_id=entity_id,
            entity_type="unknown",
            risk_type=risk_type,
            risk_score=50.0,
            risk_category=RiskCategory.MEDIUM,
            confidence=0.5,
            factors={},
            recommendations=["Manual review required"],
            regulatory_flags=[],
            assessment_date=datetime.now(),
            valid_until=datetime.now() + timedelta(days=1),
            model_version="v1.0"
        )
    
    def train_models(self, training_data: pd.DataFrame):
        """Train all risk assessment models"""
        try:
            with mlflow.start_run():
                # Train credit risk model
                if 'credit_default' in training_data.columns:
                    credit_features = training_data[self.credit_features].fillna(0)
                    credit_labels = training_data['credit_default']
                    
                    X_train, X_test, y_train, y_test = train_test_split(
                        credit_features, credit_labels, test_size=0.2, random_state=42
                    )
                    
                    self.credit_model.fit(X_train, y_train)
                    credit_score = self.credit_model.score(X_test, y_test)
                    
                    # Train deep credit model
                    X_train_tensor = torch.tensor(X_train.values, dtype=torch.float32)
                    y_train_tensor = torch.tensor(y_train.values, dtype=torch.float32).unsqueeze(1)
                    
                    optimizer = optim.Adam(self.deep_credit_model.parameters(), lr=0.001)
                    criterion = nn.BCELoss()
                    
                    self.deep_credit_model.train()
                    for epoch in range(100):
                        optimizer.zero_grad()
                        outputs = self.deep_credit_model(X_train_tensor)
                        loss = criterion(outputs, y_train_tensor)
                        loss.backward()
                        optimizer.step()
                    
                    mlflow.log_metric("credit_model_accuracy", credit_score)
                
                # Train operational risk model
                if 'operational_risk' in training_data.columns:
                    operational_features = training_data[self.operational_features].fillna(0)
                    operational_labels = training_data['operational_risk']
                    
                    X_train, X_test, y_train, y_test = train_test_split(
                        operational_features, operational_labels, test_size=0.2, random_state=42
                    )
                    
                    self.operational_risk_model.fit(X_train, y_train)
                    operational_score = self.operational_risk_model.score(X_test, y_test)
                    
                    mlflow.log_metric("operational_model_accuracy", operational_score)
                
                # Save models
                mlflow.sklearn.log_model(self.credit_model, "credit_model")
                mlflow.sklearn.log_model(self.operational_risk_model, "operational_model")
                mlflow.pytorch.log_model(self.deep_credit_model, "deep_credit_model")
                
                logger.info("Risk assessment models trained successfully")
                
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise

        """Train all risk assessment models"""
        try:
            with mlflow.start_run():
                # Train credit risk model
                if 'credit_default' in training_data.columns:
                    credit_features = training_data[self.credit_features].fillna(0)
                    credit_labels = training_data['credit_default']
                    
                    X_train, X_test, y_train, y_test = train_test_split(
                        credit_features, credit_labels, test_size=0.2, random_state=42
                    )
                    
                    self.credit_model.fit(X_train, y_train)
                    credit_score = self.credit_model.score(X_test, y_test)
                    
                    # Train deep credit model
                    X_train_tensor = torch.tensor(X_train.values, dtype=torch.float32)
                    y_train_tensor = torch.tensor(y_train.values, dtype=torch.float32).unsqueeze(1)
                    
                    optimizer = optim.Adam(self.deep_credit_model.parameters(), lr=0.001)
                    criterion = nn.BCELoss()
                    
                    self.deep_credit_model.train()
                    for epoch in range(100):
                        optimizer.zero_grad()
                        outputs = self.deep_credit_model(X_train_tensor)
                        loss = criterion(outputs, y_train_tensor)
                        loss.backward()
                        optimizer.step()
                    
                    mlflow.log_metric("credit_model_accuracy", credit_score)
                
                # Train operational risk model
                if 'operational_risk' in training_data.columns:
                    operational_features = training_data[self.operational_features].fillna(0)
                    operational_labels = training_data['operational_risk']
                    
                    X_train, X_test, y_train, y_test = train_test_split(
                        operational_features, operational_labels, test_size=0.2, random_state=42
                    )
                    
                    self.operational_risk_model.fit(X_train, y_train)
                    operational_score = self.operational_risk_model.score(X_test, y_test)
                    
                    mlflow.log_metric("operational_model_accuracy", operational_score)
                
                # Save models
                mlflow.sklearn.log_model(self.credit_model, "credit_model")
                mlflow.sklearn.log_model(self.operational_risk_model, "operational_model")
                mlflow.pytorch.log_model(self.deep_credit_model, "deep_credit_model")
                
                logger.info("Risk assessment models trained successfully")
                
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise

# Flask API
app = Flask(__name__)
CORS(app)

# Initialize risk assessment service
risk_service = RiskAssessmentService()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'risk_assessment',
        'timestamp': datetime.now().isoformat()
    })

    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'risk_assessment',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/risk/credit/<customer_id>', methods=['GET'])
def assess_credit_risk_endpoint(customer_id: str):
    """Assess credit risk for a customer"""
    try:
        assessment = risk_service.assess_credit_risk(customer_id)
        return jsonify(asdict(assessment))
        
    except Exception as e:
        logger.error(f"Credit risk assessment failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Assess credit risk for a customer"""
    try:
        assessment = risk_service.assess_credit_risk(customer_id)
        return jsonify(asdict(assessment))
        
    except Exception as e:
        logger.error(f"Credit risk assessment failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/risk/operational/<agent_id>', methods=['GET'])
def assess_operational_risk_endpoint(agent_id: str):
    """Assess operational risk for an agent"""
    try:
        assessment = risk_service.assess_operational_risk(agent_id)
        return jsonify(asdict(assessment))
        
    except Exception as e:
        logger.error(f"Operational risk assessment failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Assess operational risk for an agent"""
    try:
        assessment = risk_service.assess_operational_risk(agent_id)
        return jsonify(asdict(assessment))
        
    except Exception as e:
        logger.error(f"Operational risk assessment failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/credit-score/<customer_id>', methods=['GET'])
def get_credit_score(customer_id: str):
    """Get comprehensive credit score for a customer"""
    try:
        credit_score = risk_service.generate_credit_score(customer_id)
        return jsonify(asdict(credit_score))
        
    except Exception as e:
        logger.error(f"Credit score generation failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Get comprehensive credit score for a customer"""
    try:
        credit_score = risk_service.generate_credit_score(customer_id)
        return jsonify(asdict(credit_score))
        
    except Exception as e:
        logger.error(f"Credit score generation failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/portfolio-risk/<portfolio_id>', methods=['GET'])
def get_portfolio_risk(portfolio_id: str):
    """Get portfolio risk metrics"""
    try:
        portfolio_risk = risk_service.calculate_portfolio_risk(portfolio_id)
        return jsonify(asdict(portfolio_risk))
        
    except Exception as e:
        logger.error(f"Portfolio risk calculation failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Get portfolio risk metrics"""
    try:
        portfolio_risk = risk_service.calculate_portfolio_risk(portfolio_id)
        return jsonify(asdict(portfolio_risk))
        
    except Exception as e:
        logger.error(f"Portfolio risk calculation failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/train', methods=['POST'])
def train_models():
    """Train risk assessment models"""
    try:
        # Create sample training data
        n_samples = 10000
        np.random.seed(42)
        
        # Credit risk training data
        training_data = pd.DataFrame({
            'income': np.random.lognormal(10, 0.5, n_samples),
            'debt_to_income': np.random.beta(2, 5, n_samples),
            'credit_history_length': np.random.gamma(2, 12, n_samples),
            'payment_history_score': np.random.normal(70, 15, n_samples),
            'credit_utilization': np.random.beta(2, 5, n_samples),
            'number_of_accounts': np.random.poisson(3, n_samples),
            'recent_inquiries': np.random.poisson(1, n_samples),
            'account_age_avg': np.random.gamma(2, 12, n_samples),
            'transaction_volume_3m': np.random.lognormal(9, 1, n_samples),
            'transaction_frequency': np.random.gamma(2, 2, n_samples),
            'balance_volatility': np.random.gamma(1, 0.5, n_samples),
            'credit_default': np.random.choice([0, 1], n_samples, p=[0.85, 0.15]),
            
            # Operational risk features
            'agent_experience_months': np.random.gamma(2, 12, n_samples),
            'transaction_volume': np.random.lognormal(10, 1, n_samples),
            'error_rate': np.random.beta(1, 20, n_samples),
            'compliance_score': np.random.normal(75, 10, n_samples),
            'customer_complaints': np.random.poisson(0.5, n_samples),
            'system_downtime': np.random.beta(1, 20, n_samples),
            'staff_turnover': np.random.beta(2, 8, n_samples),
            'audit_findings': np.random.poisson(1, n_samples),
            'operational_risk': np.random.choice([0, 1], n_samples, p=[0.7, 0.3])
        })
        
        # Train models
        risk_service.train_models(training_data)
        
        return jsonify({'status': 'training_completed'})
        
    except Exception as e:
        logger.error(f"Model training failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Train risk assessment models"""
    try:
        # Create sample training data
        n_samples = 10000
        np.random.seed(42)
        
        # Credit risk training data
        training_data = pd.DataFrame({
            'income': np.random.lognormal(10, 0.5, n_samples),
            'debt_to_income': np.random.beta(2, 5, n_samples),
            'credit_history_length': np.random.gamma(2, 12, n_samples),
            'payment_history_score': np.random.normal(70, 15, n_samples),
            'credit_utilization': np.random.beta(2, 5, n_samples),
            'number_of_accounts': np.random.poisson(3, n_samples),
            'recent_inquiries': np.random.poisson(1, n_samples),
            'account_age_avg': np.random.gamma(2, 12, n_samples),
            'transaction_volume_3m': np.random.lognormal(9, 1, n_samples),
            'transaction_frequency': np.random.gamma(2, 2, n_samples),
            'balance_volatility': np.random.gamma(1, 0.5, n_samples),
            'credit_default': np.random.choice([0, 1], n_samples, p=[0.85, 0.15]),
            
            # Operational risk features
            'agent_experience_months': np.random.gamma(2, 12, n_samples),
            'transaction_volume': np.random.lognormal(10, 1, n_samples),
            'error_rate': np.random.beta(1, 20, n_samples),
            'compliance_score': np.random.normal(75, 10, n_samples),
            'customer_complaints': np.random.poisson(0.5, n_samples),
            'system_downtime': np.random.beta(1, 20, n_samples),
            'staff_turnover': np.random.beta(2, 8, n_samples),
            'audit_findings': np.random.poisson(1, n_samples),
            'operational_risk': np.random.choice([0, 1], n_samples, p=[0.7, 0.3])
        })
        
        # Train models
        risk_service.train_models(training_data)
        
        return jsonify({'status': 'training_completed'})
        
    except Exception as e:
        logger.error(f"Model training failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/risk/comprehensive/<entity_id>', methods=['GET'])
def comprehensive_risk_assessment(entity_id: str):
    """Get comprehensive risk assessment across all risk types"""
    try:
        entity_type = request.args.get('entity_type', 'customer')
        
        assessments = {}
        
        if entity_type == 'customer':
            assessments['credit'] = asdict(risk_service.assess_credit_risk(entity_id))
            assessments['credit_score'] = asdict(risk_service.generate_credit_score(entity_id))
        elif entity_type == 'agent':
            assessments['operational'] = asdict(risk_service.assess_operational_risk(entity_id))
        elif entity_type == 'portfolio':
            assessments['portfolio'] = asdict(risk_service.calculate_portfolio_risk(entity_id))
        
        return jsonify(assessments)
        
    except Exception as e:
        logger.error(f"Comprehensive risk assessment failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Get comprehensive risk assessment across all risk types"""
    try:
        entity_type = request.args.get('entity_type', 'customer')
        
        assessments = {}
        
        if entity_type == 'customer':
            assessments['credit'] = asdict(risk_service.assess_credit_risk(entity_id))
            assessments['credit_score'] = asdict(risk_service.generate_credit_score(entity_id))
        elif entity_type == 'agent':
            assessments['operational'] = asdict(risk_service.assess_operational_risk(entity_id))
        elif entity_type == 'portfolio':
            assessments['portfolio'] = asdict(risk_service.calculate_portfolio_risk(entity_id))
        
        return jsonify(assessments)
        
    except Exception as e:
        logger.error(f"Comprehensive risk assessment failed: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug = False)

