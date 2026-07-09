"""
Multi-Bank Smart Routing ML Models
Production-grade ML models for route success prediction, latency prediction,
and intelligent rail selection using XGBoost, LightGBM, and Multi-Armed Bandits.
"""

import os
import json
import pickle
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field, asdict
from enum import Enum
import hashlib

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    mean_absolute_error, mean_squared_error, r2_score,
    roc_auc_score, classification_report
)
import xgboost as xgb
import lightgbm as lgb
import joblib

import asyncpg
import redis.asyncio as redis

logger = logging.getLogger(__name__)


class TransferRail(str, Enum):
    ON_US = "on_us"
    NIP = "nip"
    NEFT = "neft"
    RTGS = "rtgs"
    DIRECT = "direct"


class ModelType(str, Enum):
    SUCCESS_PREDICTION = "success_prediction"
    LATENCY_PREDICTION = "latency_prediction"
    COST_PREDICTION = "cost_prediction"


@dataclass
class RoutingFeatures:
    """Features for ML-based routing decisions"""
    # Bank features
    bank_code: str
    bank_category: str  # commercial, microfinance, mobile_money
    has_direct_api: bool
    has_on_us: bool
    
    # Rail features
    rail: str
    
    # Transaction features
    amount: float
    amount_bucket: str  # small, medium, large, xlarge
    
    # Temporal features
    hour_of_day: int
    day_of_week: int
    is_weekend: bool
    is_business_hours: bool
    is_month_end: bool
    
    # Historical features (from feature store)
    bank_success_rate_1h: float
    bank_success_rate_24h: float
    bank_success_rate_7d: float
    bank_avg_latency_1h: float
    bank_avg_latency_24h: float
    rail_success_rate_1h: float
    rail_success_rate_24h: float
    
    # Liquidity features
    account_balance_ratio: float  # available / required
    daily_utilization: float  # today_outflow / max_daily
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    def to_feature_vector(self, encoders: Dict[str, LabelEncoder]) -> np.ndarray:
        """Convert to numeric feature vector for ML models"""
        features = []
        
        # Encode categorical features
        features.append(encoders['bank_code'].transform([self.bank_code])[0])
        features.append(encoders['bank_category'].transform([self.bank_category])[0])
        features.append(encoders['rail'].transform([self.rail])[0])
        features.append(encoders['amount_bucket'].transform([self.amount_bucket])[0])
        
        # Binary features
        features.append(1 if self.has_direct_api else 0)
        features.append(1 if self.has_on_us else 0)
        features.append(1 if self.is_weekend else 0)
        features.append(1 if self.is_business_hours else 0)
        features.append(1 if self.is_month_end else 0)
        
        # Numeric features
        features.extend([
            self.amount,
            self.hour_of_day,
            self.day_of_week,
            self.bank_success_rate_1h,
            self.bank_success_rate_24h,
            self.bank_success_rate_7d,
            self.bank_avg_latency_1h,
            self.bank_avg_latency_24h,
            self.rail_success_rate_1h,
            self.rail_success_rate_24h,
            self.account_balance_ratio,
            self.daily_utilization,
        ])
        
        return np.array(features, dtype=np.float32)


@dataclass
class ModelMetrics:
    """Metrics for model evaluation"""
    model_type: ModelType
    model_version: str
    trained_at: datetime
    training_samples: int
    validation_samples: int
    
    # Classification metrics (for success prediction)
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1: Optional[float] = None
    auc_roc: Optional[float] = None
    
    # Regression metrics (for latency/cost prediction)
    mae: Optional[float] = None
    rmse: Optional[float] = None
    r2: Optional[float] = None
    
    def to_dict(self) -> Dict:
        d = asdict(self)
        d['trained_at'] = self.trained_at.isoformat()
        d['model_type'] = self.model_type.value
        return d


class FeatureStore:
    """Real-time and historical feature store for routing ML"""
    
    def __init__(self, redis_client: redis.Redis, db_pool: asyncpg.Pool):
        self.redis = redis_client
        self.db_pool = db_pool
        self._feature_cache: Dict[str, Tuple[datetime, Dict]] = {}
        self._cache_ttl = timedelta(minutes=5)
    
    async def get_bank_features(self, bank_code: str) -> Dict[str, float]:
        """Get real-time bank performance features"""
        cache_key = f"features:bank:{bank_code}"
        
        # Check local cache first
        if cache_key in self._feature_cache:
            cached_time, cached_features = self._feature_cache[cache_key]
            if datetime.utcnow() - cached_time < self._cache_ttl:
                return cached_features
        
        # Check Redis cache
        cached = await self.redis.get(cache_key)
        if cached:
            features = json.loads(cached)
            self._feature_cache[cache_key] = (datetime.utcnow(), features)
            return features
        
        # Compute from database
        features = await self._compute_bank_features(bank_code)
        
        # Cache in Redis (5 minute TTL)
        await self.redis.setex(cache_key, 300, json.dumps(features))
        self._feature_cache[cache_key] = (datetime.utcnow(), features)
        
        return features
    
    async def _compute_bank_features(self, bank_code: str) -> Dict[str, float]:
        """Compute bank features from routing_metrics table"""
        async with self.db_pool.acquire() as conn:
            # Success rate over different time windows
            success_1h = await conn.fetchval("""
                SELECT COALESCE(AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END), 0.95)
                FROM routing_metrics
                WHERE bank_code = $1 AND created_at > NOW() - INTERVAL '1 hour'
            """, bank_code)
            
            success_24h = await conn.fetchval("""
                SELECT COALESCE(AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END), 0.95)
                FROM routing_metrics
                WHERE bank_code = $1 AND created_at > NOW() - INTERVAL '24 hours'
            """, bank_code)
            
            success_7d = await conn.fetchval("""
                SELECT COALESCE(AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END), 0.95)
                FROM routing_metrics
                WHERE bank_code = $1 AND created_at > NOW() - INTERVAL '7 days'
            """, bank_code)
            
            # Average latency over different time windows
            latency_1h = await conn.fetchval("""
                SELECT COALESCE(AVG(actual_latency_ms), 1000)
                FROM routing_metrics
                WHERE bank_code = $1 AND created_at > NOW() - INTERVAL '1 hour'
                AND was_successful = true
            """, bank_code)
            
            latency_24h = await conn.fetchval("""
                SELECT COALESCE(AVG(actual_latency_ms), 1000)
                FROM routing_metrics
                WHERE bank_code = $1 AND created_at > NOW() - INTERVAL '24 hours'
                AND was_successful = true
            """, bank_code)
            
            return {
                'success_rate_1h': float(success_1h),
                'success_rate_24h': float(success_24h),
                'success_rate_7d': float(success_7d),
                'avg_latency_1h': float(latency_1h),
                'avg_latency_24h': float(latency_24h),
            }
    
    async def get_rail_features(self, rail: str) -> Dict[str, float]:
        """Get real-time rail performance features"""
        cache_key = f"features:rail:{rail}"
        
        cached = await self.redis.get(cache_key)
        if cached:
            return json.loads(cached)
        
        async with self.db_pool.acquire() as conn:
            success_1h = await conn.fetchval("""
                SELECT COALESCE(AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END), 0.95)
                FROM routing_metrics
                WHERE rail = $1 AND created_at > NOW() - INTERVAL '1 hour'
            """, rail)
            
            success_24h = await conn.fetchval("""
                SELECT COALESCE(AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END), 0.95)
                FROM routing_metrics
                WHERE rail = $1 AND created_at > NOW() - INTERVAL '24 hours'
            """, rail)
            
            features = {
                'success_rate_1h': float(success_1h),
                'success_rate_24h': float(success_24h),
            }
            
            await self.redis.setex(cache_key, 300, json.dumps(features))
            return features
    
    async def record_routing_outcome(
        self,
        transfer_id: str,
        bank_code: str,
        rail: str,
        amount: float,
        was_successful: bool,
        actual_latency_ms: int,
        actual_cost: float,
        predicted_success_rate: float,
        predicted_latency_ms: int,
        predicted_cost: float
    ):
        """Record routing outcome for model training"""
        now = datetime.utcnow()
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO routing_metrics (
                    transfer_id, bank_code, rail, amount, was_successful,
                    actual_latency_ms, actual_cost, predicted_success_rate,
                    predicted_latency_ms, predicted_cost, hour_of_day, day_of_week, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            """, transfer_id, bank_code, rail, amount, was_successful,
                actual_latency_ms, actual_cost, predicted_success_rate,
                predicted_latency_ms, predicted_cost, now.hour, now.weekday(), now)
        
        # Invalidate feature cache for this bank/rail
        await self.redis.delete(f"features:bank:{bank_code}")
        await self.redis.delete(f"features:rail:{rail}")


class RouteSuccessPredictor:
    """XGBoost model for predicting transfer success probability"""
    
    def __init__(self, model_dir: str = "/var/lib/ml-models"):
        self.model_dir = model_dir
        self.model: Optional[xgb.XGBClassifier] = None
        self.scaler: Optional[StandardScaler] = None
        self.encoders: Dict[str, LabelEncoder] = {}
        self.model_version: str = "v0"
        self.metrics: Optional[ModelMetrics] = None
        
        os.makedirs(model_dir, exist_ok=True)
    
    def _init_encoders(self, df: pd.DataFrame):
        """Initialize label encoders for categorical features"""
        categorical_cols = ['bank_code', 'bank_category', 'rail', 'amount_bucket']
        
        for col in categorical_cols:
            if col in df.columns:
                self.encoders[col] = LabelEncoder()
                self.encoders[col].fit(df[col].astype(str))
    
    def _prepare_features(self, df: pd.DataFrame) -> np.ndarray:
        """Prepare feature matrix from dataframe"""
        feature_cols = [
            'bank_code_encoded', 'bank_category_encoded', 'rail_encoded', 'amount_bucket_encoded',
            'has_direct_api', 'has_on_us', 'is_weekend', 'is_business_hours', 'is_month_end',
            'amount', 'hour_of_day', 'day_of_week',
            'bank_success_rate_1h', 'bank_success_rate_24h', 'bank_success_rate_7d',
            'bank_avg_latency_1h', 'bank_avg_latency_24h',
            'rail_success_rate_1h', 'rail_success_rate_24h',
            'account_balance_ratio', 'daily_utilization'
        ]
        
        # Encode categorical features
        df = df.copy()
        df['bank_code_encoded'] = self.encoders['bank_code'].transform(df['bank_code'].astype(str))
        df['bank_category_encoded'] = self.encoders['bank_category'].transform(df['bank_category'].astype(str))
        df['rail_encoded'] = self.encoders['rail'].transform(df['rail'].astype(str))
        df['amount_bucket_encoded'] = self.encoders['amount_bucket'].transform(df['amount_bucket'].astype(str))
        
        # Convert boolean to int
        for col in ['has_direct_api', 'has_on_us', 'is_weekend', 'is_business_hours', 'is_month_end']:
            df[col] = df[col].astype(int)
        
        return df[feature_cols].values
    
    async def train(self, db_pool: asyncpg.Pool, min_samples: int = 1000) -> ModelMetrics:
        """Train the success prediction model"""
        logger.info("Starting success prediction model training...")
        
        # Fetch training data
        async with db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    rm.bank_code, bd.category as bank_category,
                    bd.has_direct_api, bd.has_on_us_transfer as has_on_us,
                    rm.rail, rm.amount, rm.was_successful,
                    rm.hour_of_day, rm.day_of_week, rm.created_at
                FROM routing_metrics rm
                JOIN bank_directory bd ON rm.bank_code = bd.code
                WHERE rm.created_at > NOW() - INTERVAL '30 days'
                ORDER BY rm.created_at DESC
                LIMIT 100000
            """)
        
        if len(rows) < min_samples:
            logger.warning(f"Insufficient training data: {len(rows)} < {min_samples}")
            # Generate synthetic data for initial training
            df = self._generate_synthetic_data(min_samples)
        else:
            df = pd.DataFrame([dict(r) for r in rows])
        
        # Feature engineering
        df = self._engineer_features(df)
        
        # Initialize encoders
        self._init_encoders(df)
        
        # Prepare features and target
        X = self._prepare_features(df)
        y = df['was_successful'].astype(int).values
        
        # Split data
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Scale features
        self.scaler = StandardScaler()
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_val_scaled = self.scaler.transform(X_val)
        
        # Train XGBoost model
        self.model = xgb.XGBClassifier(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=3,
            gamma=0.1,
            reg_alpha=0.1,
            reg_lambda=1.0,
            objective='binary:logistic',
            eval_metric='auc',
            use_label_encoder=False,
            random_state=42,
            n_jobs=-1
        )
        
        self.model.fit(
            X_train_scaled, y_train,
            eval_set=[(X_val_scaled, y_val)],
            verbose=False
        )
        
        # Evaluate
        y_pred = self.model.predict(X_val_scaled)
        y_pred_proba = self.model.predict_proba(X_val_scaled)[:, 1]
        
        self.model_version = f"v{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        
        self.metrics = ModelMetrics(
            model_type=ModelType.SUCCESS_PREDICTION,
            model_version=self.model_version,
            trained_at=datetime.utcnow(),
            training_samples=len(X_train),
            validation_samples=len(X_val),
            accuracy=accuracy_score(y_val, y_pred),
            precision=precision_score(y_val, y_pred),
            recall=recall_score(y_val, y_pred),
            f1=f1_score(y_val, y_pred),
            auc_roc=roc_auc_score(y_val, y_pred_proba)
        )
        
        # Save model
        self._save_model()
        
        logger.info(f"Success model trained: AUC={self.metrics.auc_roc:.4f}, F1={self.metrics.f1:.4f}")
        return self.metrics
    
    def _engineer_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Engineer features from raw data"""
        df = df.copy()
        
        # Amount bucket
        df['amount_bucket'] = pd.cut(
            df['amount'],
            bins=[0, 10000, 100000, 1000000, float('inf')],
            labels=['small', 'medium', 'large', 'xlarge']
        ).astype(str)
        
        # Temporal features
        if 'created_at' in df.columns:
            df['hour_of_day'] = pd.to_datetime(df['created_at']).dt.hour
            df['day_of_week'] = pd.to_datetime(df['created_at']).dt.dayofweek
        
        df['is_weekend'] = df['day_of_week'].isin([5, 6])
        df['is_business_hours'] = df['hour_of_day'].between(9, 17)
        df['is_month_end'] = pd.to_datetime(df.get('created_at', datetime.utcnow())).dt.day > 25
        
        # Default values for missing features
        for col in ['bank_success_rate_1h', 'bank_success_rate_24h', 'bank_success_rate_7d']:
            if col not in df.columns:
                df[col] = 0.95
        
        for col in ['bank_avg_latency_1h', 'bank_avg_latency_24h']:
            if col not in df.columns:
                df[col] = 1000
        
        for col in ['rail_success_rate_1h', 'rail_success_rate_24h']:
            if col not in df.columns:
                df[col] = 0.95
        
        if 'account_balance_ratio' not in df.columns:
            df['account_balance_ratio'] = 2.0
        
        if 'daily_utilization' not in df.columns:
            df['daily_utilization'] = 0.3
        
        return df
    
    def _generate_synthetic_data(self, n_samples: int) -> pd.DataFrame:
        """Generate synthetic training data for initial model"""
        np.random.seed(42)
        
        banks = ['058', '044', '057', '033', '011', '032', '035', '050', '076', '221']
        categories = ['commercial', 'commercial', 'commercial', 'commercial', 'commercial',
                     'commercial', 'commercial', 'commercial', 'commercial', 'commercial']
        rails = ['on_us', 'nip', 'direct', 'neft']
        
        data = []
        for _ in range(n_samples):
            bank_idx = np.random.randint(0, len(banks))
            bank_code = banks[bank_idx]
            rail = np.random.choice(rails, p=[0.3, 0.4, 0.2, 0.1])
            amount = np.random.exponential(50000)
            hour = np.random.randint(0, 24)
            day = np.random.randint(0, 7)
            
            # Success probability based on features
            base_success = 0.95
            if rail == 'on_us':
                base_success = 0.99
            elif rail == 'nip':
                base_success = 0.96
            elif rail == 'neft':
                base_success = 0.98
            
            # Time-based adjustments
            if hour < 6 or hour > 22:
                base_success -= 0.02
            if day in [5, 6]:
                base_success -= 0.01
            
            # Amount-based adjustments
            if amount > 1000000:
                base_success -= 0.03
            
            was_successful = np.random.random() < base_success
            
            data.append({
                'bank_code': bank_code,
                'bank_category': categories[bank_idx],
                'has_direct_api': bank_idx < 5,
                'has_on_us': bank_idx < 7,
                'rail': rail,
                'amount': amount,
                'was_successful': was_successful,
                'hour_of_day': hour,
                'day_of_week': day,
                'created_at': datetime.utcnow() - timedelta(days=np.random.randint(0, 30))
            })
        
        return pd.DataFrame(data)
    
    def predict(self, features: RoutingFeatures) -> float:
        """Predict success probability for a routing decision"""
        if self.model is None:
            self._load_model()
        
        if self.model is None:
            # Return default if no model available
            return 0.95
        
        feature_vector = features.to_feature_vector(self.encoders)
        feature_vector_scaled = self.scaler.transform(feature_vector.reshape(1, -1))
        
        proba = self.model.predict_proba(feature_vector_scaled)[0, 1]
        return float(proba)
    
    def predict_batch(self, features_list: List[RoutingFeatures]) -> List[float]:
        """Batch prediction for multiple routing options"""
        if self.model is None:
            self._load_model()
        
        if self.model is None:
            return [0.95] * len(features_list)
        
        feature_matrix = np.array([f.to_feature_vector(self.encoders) for f in features_list])
        feature_matrix_scaled = self.scaler.transform(feature_matrix)
        
        probas = self.model.predict_proba(feature_matrix_scaled)[:, 1]
        return probas.tolist()
    
    def _save_model(self):
        """Save model to disk"""
        model_path = os.path.join(self.model_dir, f"success_model_{self.model_version}.joblib")
        
        model_data = {
            'model': self.model,
            'scaler': self.scaler,
            'encoders': self.encoders,
            'version': self.model_version,
            'metrics': self.metrics.to_dict() if self.metrics else None
        }
        
        joblib.dump(model_data, model_path)
        
        # Also save as latest
        latest_path = os.path.join(self.model_dir, "success_model_latest.joblib")
        joblib.dump(model_data, latest_path)
        
        logger.info(f"Success model saved: {model_path}")
    
    def _load_model(self):
        """Load model from disk"""
        latest_path = os.path.join(self.model_dir, "success_model_latest.joblib")
        
        if os.path.exists(latest_path):
            model_data = joblib.load(latest_path)
            self.model = model_data['model']
            self.scaler = model_data['scaler']
            self.encoders = model_data['encoders']
            self.model_version = model_data['version']
            logger.info(f"Success model loaded: {self.model_version}")


class LatencyPredictor:
    """LightGBM model for predicting transfer latency"""
    
    def __init__(self, model_dir: str = "/var/lib/ml-models"):
        self.model_dir = model_dir
        self.model: Optional[lgb.LGBMRegressor] = None
        self.scaler: Optional[StandardScaler] = None
        self.encoders: Dict[str, LabelEncoder] = {}
        self.model_version: str = "v0"
        self.metrics: Optional[ModelMetrics] = None
        
        os.makedirs(model_dir, exist_ok=True)
    
    async def train(self, db_pool: asyncpg.Pool, min_samples: int = 1000) -> ModelMetrics:
        """Train the latency prediction model"""
        logger.info("Starting latency prediction model training...")
        
        # Fetch training data
        async with db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    rm.bank_code, bd.category as bank_category,
                    bd.has_direct_api, bd.has_on_us_transfer as has_on_us,
                    rm.rail, rm.amount, rm.actual_latency_ms,
                    rm.hour_of_day, rm.day_of_week, rm.created_at
                FROM routing_metrics rm
                JOIN bank_directory bd ON rm.bank_code = bd.code
                WHERE rm.was_successful = true
                AND rm.actual_latency_ms IS NOT NULL
                AND rm.created_at > NOW() - INTERVAL '30 days'
                ORDER BY rm.created_at DESC
                LIMIT 100000
            """)
        
        if len(rows) < min_samples:
            logger.warning(f"Insufficient training data: {len(rows)} < {min_samples}")
            df = self._generate_synthetic_data(min_samples)
        else:
            df = pd.DataFrame([dict(r) for r in rows])
        
        # Feature engineering
        df = self._engineer_features(df)
        
        # Initialize encoders
        self._init_encoders(df)
        
        # Prepare features and target
        X = self._prepare_features(df)
        y = df['actual_latency_ms'].values
        
        # Split data
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        # Scale features
        self.scaler = StandardScaler()
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_val_scaled = self.scaler.transform(X_val)
        
        # Train LightGBM model
        self.model = lgb.LGBMRegressor(
            n_estimators=200,
            max_depth=8,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_samples=20,
            reg_alpha=0.1,
            reg_lambda=1.0,
            random_state=42,
            n_jobs=-1,
            verbose=-1
        )
        
        self.model.fit(
            X_train_scaled, y_train,
            eval_set=[(X_val_scaled, y_val)],
            callbacks=[lgb.early_stopping(50, verbose=False)]
        )
        
        # Evaluate
        y_pred = self.model.predict(X_val_scaled)
        
        self.model_version = f"v{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        
        self.metrics = ModelMetrics(
            model_type=ModelType.LATENCY_PREDICTION,
            model_version=self.model_version,
            trained_at=datetime.utcnow(),
            training_samples=len(X_train),
            validation_samples=len(X_val),
            mae=mean_absolute_error(y_val, y_pred),
            rmse=np.sqrt(mean_squared_error(y_val, y_pred)),
            r2=r2_score(y_val, y_pred)
        )
        
        # Save model
        self._save_model()
        
        logger.info(f"Latency model trained: MAE={self.metrics.mae:.2f}ms, R2={self.metrics.r2:.4f}")
        return self.metrics
    
    def _init_encoders(self, df: pd.DataFrame):
        """Initialize label encoders"""
        categorical_cols = ['bank_code', 'bank_category', 'rail', 'amount_bucket']
        
        for col in categorical_cols:
            if col in df.columns:
                self.encoders[col] = LabelEncoder()
                self.encoders[col].fit(df[col].astype(str))
    
    def _prepare_features(self, df: pd.DataFrame) -> np.ndarray:
        """Prepare feature matrix"""
        df = df.copy()
        
        df['bank_code_encoded'] = self.encoders['bank_code'].transform(df['bank_code'].astype(str))
        df['bank_category_encoded'] = self.encoders['bank_category'].transform(df['bank_category'].astype(str))
        df['rail_encoded'] = self.encoders['rail'].transform(df['rail'].astype(str))
        df['amount_bucket_encoded'] = self.encoders['amount_bucket'].transform(df['amount_bucket'].astype(str))
        
        for col in ['has_direct_api', 'has_on_us', 'is_weekend', 'is_business_hours']:
            df[col] = df[col].astype(int)
        
        feature_cols = [
            'bank_code_encoded', 'bank_category_encoded', 'rail_encoded', 'amount_bucket_encoded',
            'has_direct_api', 'has_on_us', 'is_weekend', 'is_business_hours',
            'amount', 'hour_of_day', 'day_of_week'
        ]
        
        return df[feature_cols].values
    
    def _engineer_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Engineer features"""
        df = df.copy()
        
        df['amount_bucket'] = pd.cut(
            df['amount'],
            bins=[0, 10000, 100000, 1000000, float('inf')],
            labels=['small', 'medium', 'large', 'xlarge']
        ).astype(str)
        
        if 'created_at' in df.columns:
            df['hour_of_day'] = pd.to_datetime(df['created_at']).dt.hour
            df['day_of_week'] = pd.to_datetime(df['created_at']).dt.dayofweek
        
        df['is_weekend'] = df['day_of_week'].isin([5, 6])
        df['is_business_hours'] = df['hour_of_day'].between(9, 17)
        
        return df
    
    def _generate_synthetic_data(self, n_samples: int) -> pd.DataFrame:
        """Generate synthetic training data"""
        np.random.seed(42)
        
        banks = ['058', '044', '057', '033', '011', '032', '035', '050', '076', '221']
        categories = ['commercial'] * 10
        rails = ['on_us', 'nip', 'direct', 'neft']
        
        # Base latencies per rail
        rail_latencies = {'on_us': 300, 'nip': 1000, 'direct': 500, 'neft': 3600000}
        
        data = []
        for _ in range(n_samples):
            bank_idx = np.random.randint(0, len(banks))
            rail = np.random.choice(rails, p=[0.3, 0.4, 0.2, 0.1])
            amount = np.random.exponential(50000)
            hour = np.random.randint(0, 24)
            day = np.random.randint(0, 7)
            
            # Base latency with noise
            base_latency = rail_latencies[rail]
            latency = base_latency * (1 + np.random.normal(0, 0.2))
            
            # Time-based adjustments
            if hour < 6 or hour > 22:
                latency *= 1.2
            if day in [5, 6]:
                latency *= 1.1
            
            latency = max(100, latency)  # Minimum 100ms
            
            data.append({
                'bank_code': banks[bank_idx],
                'bank_category': categories[bank_idx],
                'has_direct_api': bank_idx < 5,
                'has_on_us': bank_idx < 7,
                'rail': rail,
                'amount': amount,
                'actual_latency_ms': int(latency),
                'hour_of_day': hour,
                'day_of_week': day,
                'created_at': datetime.utcnow() - timedelta(days=np.random.randint(0, 30))
            })
        
        return pd.DataFrame(data)
    
    def predict(self, features: RoutingFeatures) -> int:
        """Predict latency in milliseconds"""
        if self.model is None:
            self._load_model()
        
        if self.model is None:
            # Return default based on rail
            defaults = {'on_us': 300, 'nip': 1000, 'direct': 500, 'neft': 3600000}
            return defaults.get(features.rail, 1000)
        
        feature_vector = features.to_feature_vector(self.encoders)
        feature_vector_scaled = self.scaler.transform(feature_vector.reshape(1, -1))
        
        latency = self.model.predict(feature_vector_scaled)[0]
        return max(100, int(latency))
    
    def _save_model(self):
        """Save model to disk"""
        model_path = os.path.join(self.model_dir, f"latency_model_{self.model_version}.joblib")
        
        model_data = {
            'model': self.model,
            'scaler': self.scaler,
            'encoders': self.encoders,
            'version': self.model_version,
            'metrics': self.metrics.to_dict() if self.metrics else None
        }
        
        joblib.dump(model_data, model_path)
        
        latest_path = os.path.join(self.model_dir, "latency_model_latest.joblib")
        joblib.dump(model_data, latest_path)
        
        logger.info(f"Latency model saved: {model_path}")
    
    def _load_model(self):
        """Load model from disk"""
        latest_path = os.path.join(self.model_dir, "latency_model_latest.joblib")
        
        if os.path.exists(latest_path):
            model_data = joblib.load(latest_path)
            self.model = model_data['model']
            self.scaler = model_data['scaler']
            self.encoders = model_data['encoders']
            self.model_version = model_data['version']
            logger.info(f"Latency model loaded: {self.model_version}")


class MultiArmedBandit:
    """Thompson Sampling Multi-Armed Bandit for rail selection"""
    
    def __init__(self, redis_client: redis.Redis, arms: List[str] = None):
        self.redis = redis_client
        self.arms = arms or ['on_us', 'nip', 'direct', 'neft']
        self._alpha: Dict[str, float] = {arm: 1.0 for arm in self.arms}  # Successes + 1
        self._beta: Dict[str, float] = {arm: 1.0 for arm in self.arms}   # Failures + 1
    
    async def load_state(self):
        """Load bandit state from Redis"""
        for arm in self.arms:
            alpha = await self.redis.get(f"bandit:alpha:{arm}")
            beta = await self.redis.get(f"bandit:beta:{arm}")
            
            if alpha:
                self._alpha[arm] = float(alpha)
            if beta:
                self._beta[arm] = float(beta)
    
    async def save_state(self):
        """Save bandit state to Redis"""
        for arm in self.arms:
            await self.redis.set(f"bandit:alpha:{arm}", str(self._alpha[arm]))
            await self.redis.set(f"bandit:beta:{arm}", str(self._beta[arm]))
    
    def select_arm(self, available_arms: List[str] = None) -> str:
        """Select arm using Thompson Sampling"""
        arms_to_consider = available_arms or self.arms
        
        samples = {}
        for arm in arms_to_consider:
            if arm in self._alpha:
                # Sample from Beta distribution
                samples[arm] = np.random.beta(self._alpha[arm], self._beta[arm])
            else:
                samples[arm] = np.random.beta(1.0, 1.0)
        
        return max(samples, key=samples.get)
    
    def get_arm_probabilities(self, available_arms: List[str] = None) -> Dict[str, float]:
        """Get expected success probability for each arm"""
        arms_to_consider = available_arms or self.arms
        
        probs = {}
        for arm in arms_to_consider:
            alpha = self._alpha.get(arm, 1.0)
            beta = self._beta.get(arm, 1.0)
            probs[arm] = alpha / (alpha + beta)
        
        return probs
    
    async def update(self, arm: str, reward: bool):
        """Update arm statistics based on reward"""
        if arm not in self._alpha:
            self._alpha[arm] = 1.0
            self._beta[arm] = 1.0
        
        if reward:
            self._alpha[arm] += 1.0
        else:
            self._beta[arm] += 1.0
        
        # Decay old observations (exponential forgetting)
        decay_factor = 0.999
        for a in self.arms:
            self._alpha[a] = 1.0 + (self._alpha[a] - 1.0) * decay_factor
            self._beta[a] = 1.0 + (self._beta[a] - 1.0) * decay_factor
        
        await self.save_state()


class ContextualBandit:
    """Contextual Multi-Armed Bandit using LinUCB for rail selection"""
    
    def __init__(self, redis_client: redis.Redis, n_features: int = 10, alpha: float = 1.0):
        self.redis = redis_client
        self.arms = ['on_us', 'nip', 'direct', 'neft']
        self.n_features = n_features
        self.alpha = alpha  # Exploration parameter
        
        # LinUCB parameters for each arm
        self._A: Dict[str, np.ndarray] = {arm: np.eye(n_features) for arm in self.arms}
        self._b: Dict[str, np.ndarray] = {arm: np.zeros(n_features) for arm in self.arms}
    
    def _get_context_vector(self, features: RoutingFeatures) -> np.ndarray:
        """Extract context vector from routing features"""
        context = np.array([
            features.hour_of_day / 24.0,
            features.day_of_week / 7.0,
            1.0 if features.is_weekend else 0.0,
            1.0 if features.is_business_hours else 0.0,
            min(features.amount / 1000000, 1.0),  # Normalized amount
            features.bank_success_rate_24h,
            features.bank_avg_latency_24h / 5000.0,  # Normalized latency
            features.account_balance_ratio / 5.0,  # Normalized ratio
            features.daily_utilization,
            1.0 if features.has_on_us else 0.0,
        ], dtype=np.float32)
        
        return context
    
    def select_arm(self, features: RoutingFeatures, available_arms: List[str] = None) -> Tuple[str, float]:
        """Select arm using LinUCB"""
        arms_to_consider = available_arms or self.arms
        context = self._get_context_vector(features)
        
        ucb_values = {}
        for arm in arms_to_consider:
            A_inv = np.linalg.inv(self._A[arm])
            theta = A_inv @ self._b[arm]
            
            # UCB = theta^T * x + alpha * sqrt(x^T * A^-1 * x)
            exploitation = theta @ context
            exploration = self.alpha * np.sqrt(context @ A_inv @ context)
            
            ucb_values[arm] = exploitation + exploration
        
        best_arm = max(ucb_values, key=ucb_values.get)
        return best_arm, ucb_values[best_arm]
    
    async def update(self, features: RoutingFeatures, arm: str, reward: float):
        """Update arm parameters based on reward"""
        context = self._get_context_vector(features)
        
        # Update A and b for the selected arm
        self._A[arm] += np.outer(context, context)
        self._b[arm] += reward * context
        
        # Save state periodically (every 100 updates)
        update_count = await self.redis.incr("bandit:update_count")
        if update_count % 100 == 0:
            await self._save_state()
    
    async def _save_state(self):
        """Save bandit state to Redis"""
        for arm in self.arms:
            await self.redis.set(
                f"linucb:A:{arm}",
                pickle.dumps(self._A[arm])
            )
            await self.redis.set(
                f"linucb:b:{arm}",
                pickle.dumps(self._b[arm])
            )
    
    async def load_state(self):
        """Load bandit state from Redis"""
        for arm in self.arms:
            A_data = await self.redis.get(f"linucb:A:{arm}")
            b_data = await self.redis.get(f"linucb:b:{arm}")
            
            if A_data:
                self._A[arm] = pickle.loads(A_data)
            if b_data:
                self._b[arm] = pickle.loads(b_data)


class MLRoutingEngine:
    """Unified ML-powered routing engine"""
    
    def __init__(
        self,
        db_pool: asyncpg.Pool,
        redis_client: redis.Redis,
        model_dir: str = "/var/lib/ml-models"
    ):
        self.db_pool = db_pool
        self.redis = redis_client
        self.model_dir = model_dir
        
        # Initialize components
        self.feature_store = FeatureStore(redis_client, db_pool)
        self.success_predictor = RouteSuccessPredictor(model_dir)
        self.latency_predictor = LatencyPredictor(model_dir)
        self.bandit = MultiArmedBandit(redis_client)
        self.contextual_bandit = ContextualBandit(redis_client)
        
        # Weights for final scoring
        self.weights = {
            'success': 0.40,
            'latency': 0.25,
            'cost': 0.20,
            'bandit': 0.15
        }
    
    async def initialize(self):
        """Initialize ML components"""
        await self.bandit.load_state()
        await self.contextual_bandit.load_state()
        
        # Load or train models
        try:
            self.success_predictor._load_model()
        except Exception:
            logger.info("Training success prediction model...")
            await self.success_predictor.train(self.db_pool)
        
        try:
            self.latency_predictor._load_model()
        except Exception:
            logger.info("Training latency prediction model...")
            await self.latency_predictor.train(self.db_pool)
    
    async def build_features(
        self,
        bank_code: str,
        bank_category: str,
        has_direct_api: bool,
        has_on_us: bool,
        rail: str,
        amount: float,
        account_balance: float,
        daily_utilization: float
    ) -> RoutingFeatures:
        """Build routing features with real-time data from feature store"""
        now = datetime.utcnow()
        
        # Get real-time features
        bank_features = await self.feature_store.get_bank_features(bank_code)
        rail_features = await self.feature_store.get_rail_features(rail)
        
        # Determine amount bucket
        if amount < 10000:
            amount_bucket = 'small'
        elif amount < 100000:
            amount_bucket = 'medium'
        elif amount < 1000000:
            amount_bucket = 'large'
        else:
            amount_bucket = 'xlarge'
        
        return RoutingFeatures(
            bank_code=bank_code,
            bank_category=bank_category,
            has_direct_api=has_direct_api,
            has_on_us=has_on_us,
            rail=rail,
            amount=amount,
            amount_bucket=amount_bucket,
            hour_of_day=now.hour,
            day_of_week=now.weekday(),
            is_weekend=now.weekday() in [5, 6],
            is_business_hours=9 <= now.hour <= 17,
            is_month_end=now.day > 25,
            bank_success_rate_1h=bank_features['success_rate_1h'],
            bank_success_rate_24h=bank_features['success_rate_24h'],
            bank_success_rate_7d=bank_features['success_rate_7d'],
            bank_avg_latency_1h=bank_features['avg_latency_1h'],
            bank_avg_latency_24h=bank_features['avg_latency_24h'],
            rail_success_rate_1h=rail_features['success_rate_1h'],
            rail_success_rate_24h=rail_features['success_rate_24h'],
            account_balance_ratio=account_balance / amount if amount > 0 else 10.0,
            daily_utilization=daily_utilization
        )
    
    async def score_route(
        self,
        features: RoutingFeatures,
        estimated_cost: float
    ) -> Dict[str, Any]:
        """Score a routing option using ML models"""
        # Predict success probability
        success_prob = self.success_predictor.predict(features)
        
        # Predict latency
        predicted_latency = self.latency_predictor.predict(features)
        
        # Get bandit score
        bandit_probs = self.bandit.get_arm_probabilities([features.rail])
        bandit_score = bandit_probs.get(features.rail, 0.5)
        
        # Normalize scores (0-1, higher is better)
        success_score = success_prob
        latency_score = 1.0 - min(predicted_latency / 5000.0, 1.0)  # 5s max
        cost_score = 1.0 - min(estimated_cost / 100.0, 1.0)  # 100 NGN max
        
        # Weighted final score
        final_score = (
            self.weights['success'] * success_score +
            self.weights['latency'] * latency_score +
            self.weights['cost'] * cost_score +
            self.weights['bandit'] * bandit_score
        )
        
        return {
            'final_score': final_score,
            'success_probability': success_prob,
            'predicted_latency_ms': predicted_latency,
            'success_score': success_score,
            'latency_score': latency_score,
            'cost_score': cost_score,
            'bandit_score': bandit_score
        }
    
    async def record_outcome(
        self,
        transfer_id: str,
        features: RoutingFeatures,
        was_successful: bool,
        actual_latency_ms: int,
        actual_cost: float,
        predicted_success: float,
        predicted_latency: int,
        predicted_cost: float
    ):
        """Record routing outcome for model updates"""
        # Record in feature store
        await self.feature_store.record_routing_outcome(
            transfer_id=transfer_id,
            bank_code=features.bank_code,
            rail=features.rail,
            amount=features.amount,
            was_successful=was_successful,
            actual_latency_ms=actual_latency_ms,
            actual_cost=actual_cost,
            predicted_success_rate=predicted_success,
            predicted_latency_ms=predicted_latency,
            predicted_cost=predicted_cost
        )
        
        # Update bandits
        await self.bandit.update(features.rail, was_successful)
        
        # Reward for contextual bandit (normalized)
        reward = 1.0 if was_successful else 0.0
        if was_successful:
            # Bonus for fast transactions
            latency_bonus = max(0, 1.0 - actual_latency_ms / 5000.0) * 0.2
            reward += latency_bonus
        
        await self.contextual_bandit.update(features, features.rail, reward)
    
    async def retrain_models(self):
        """Retrain all ML models with latest data"""
        logger.info("Retraining ML models...")
        
        success_metrics = await self.success_predictor.train(self.db_pool)
        latency_metrics = await self.latency_predictor.train(self.db_pool)
        
        return {
            'success_model': success_metrics.to_dict(),
            'latency_model': latency_metrics.to_dict()
        }
    
    def get_model_metrics(self) -> Dict[str, Any]:
        """Get current model metrics"""
        return {
            'success_model': self.success_predictor.metrics.to_dict() if self.success_predictor.metrics else None,
            'latency_model': self.latency_predictor.metrics.to_dict() if self.latency_predictor.metrics else None,
            'bandit_probabilities': self.bandit.get_arm_probabilities()
        }
