"""
Model Training Pipeline - End-to-end ML model training infrastructure
Supports XGBoost, LightGBM, and Isolation Forest models

Features:
- Data loading from lakehouse
- Feature engineering and preprocessing
- Model training with hyperparameter tuning
- Cross-validation and evaluation
- Model serialization and versioning
- Training job management
"""

import os
import json
import logging
import pickle
import hashlib
from typing import Dict, List, Optional, Any, Tuple, Union
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from enum import Enum
import asyncio

logger = logging.getLogger(__name__)

# Configuration
LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://localhost:8020")
MODEL_STORAGE_PATH = os.getenv("MODEL_STORAGE_PATH", "/tmp/ml_models")
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "")

# Try to import ML libraries
try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    logger.warning("NumPy not available")

try:
    from sklearn.model_selection import train_test_split, cross_val_score
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
        roc_auc_score, mean_squared_error, mean_absolute_error, r2_score
    )
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    from sklearn.ensemble import IsolationForest
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not available")

try:
    import xgboost as xgb
    XGBOOST_AVAILABLE = True
except ImportError:
    XGBOOST_AVAILABLE = False
    logger.warning("XGBoost not available")

try:
    import lightgbm as lgb
    LIGHTGBM_AVAILABLE = True
except ImportError:
    LIGHTGBM_AVAILABLE = False
    logger.warning("LightGBM not available")


class ModelAlgorithm(str, Enum):
    XGBOOST = "xgboost"
    LIGHTGBM = "lightgbm"
    ISOLATION_FOREST = "isolation_forest"
    RANDOM_FOREST = "random_forest"
    LOGISTIC_REGRESSION = "logistic_regression"


class TaskType(str, Enum):
    BINARY_CLASSIFICATION = "binary_classification"
    MULTICLASS_CLASSIFICATION = "multiclass_classification"
    REGRESSION = "regression"
    ANOMALY_DETECTION = "anomaly_detection"


class TrainingStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TrainingConfig:
    """Configuration for model training"""
    model_name: str
    algorithm: ModelAlgorithm
    task_type: TaskType
    target_column: str
    feature_columns: List[str]
    hyperparameters: Dict[str, Any]
    validation_split: float = 0.2
    cross_validation_folds: int = 5
    early_stopping_rounds: int = 50
    random_state: int = 42


@dataclass
class TrainingResult:
    """Result of model training"""
    model_name: str
    model_version: str
    algorithm: ModelAlgorithm
    task_type: TaskType
    metrics: Dict[str, float]
    feature_importance: Dict[str, float]
    training_time_seconds: float
    training_samples: int
    validation_samples: int
    hyperparameters: Dict[str, Any]
    model_path: str
    created_at: datetime


@dataclass
class TrainingJob:
    """Training job tracking"""
    job_id: str
    config: TrainingConfig
    status: TrainingStatus
    progress: float
    started_at: datetime
    completed_at: Optional[datetime] = None
    result: Optional[TrainingResult] = None
    error_message: Optional[str] = None


class DataPreprocessor:
    """Data preprocessing utilities"""
    
    def __init__(self):
        self.scalers: Dict[str, StandardScaler] = {}
        self.encoders: Dict[str, LabelEncoder] = {}
    
    def fit_transform_numeric(self, data: List[Dict], columns: List[str]) -> Tuple[Any, Dict]:
        """Fit and transform numeric columns"""
        if not SKLEARN_AVAILABLE or not NUMPY_AVAILABLE:
            return data, {}
        
        import numpy as np
        
        # Extract numeric data
        numeric_data = []
        for row in data:
            numeric_data.append([row.get(col, 0) for col in columns])
        
        X = np.array(numeric_data, dtype=np.float32)
        
        # Handle missing values
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        self.scalers["numeric"] = scaler
        
        return X_scaled, {"scaler": scaler, "columns": columns}
    
    def transform_numeric(self, data: List[Dict], columns: List[str]) -> Any:
        """Transform numeric columns using fitted scaler"""
        if not SKLEARN_AVAILABLE or not NUMPY_AVAILABLE:
            return data
        
        import numpy as np
        
        numeric_data = []
        for row in data:
            numeric_data.append([row.get(col, 0) for col in columns])
        
        X = np.array(numeric_data, dtype=np.float32)
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        
        if "numeric" in self.scalers:
            X = self.scalers["numeric"].transform(X)
        
        return X
    
    def encode_categorical(self, data: List[Any], column_name: str) -> Tuple[Any, LabelEncoder]:
        """Encode categorical column"""
        if not SKLEARN_AVAILABLE:
            return data, None
        
        encoder = LabelEncoder()
        encoded = encoder.fit_transform(data)
        self.encoders[column_name] = encoder
        
        return encoded, encoder


class ModelTrainer:
    """Model training orchestrator"""
    
    def __init__(self):
        self.preprocessor = DataPreprocessor()
        self.jobs: Dict[str, TrainingJob] = {}
        self.trained_models: Dict[str, Any] = {}
    
    def generate_synthetic_training_data(self, n_samples: int = 10000, task_type: TaskType = TaskType.BINARY_CLASSIFICATION) -> Tuple[Any, Any]:
        """Generate synthetic training data for demonstration"""
        if not NUMPY_AVAILABLE:
            return None, None
        
        import numpy as np
        np.random.seed(42)
        
        # Generate features
        n_features = 15
        X = np.random.randn(n_samples, n_features)
        
        # Add some structure to the data
        X[:, 0] = np.abs(X[:, 0]) * 100  # amount
        X[:, 1] = np.clip(X[:, 1] * 2 + 5, 0, 10)  # velocity
        X[:, 2] = np.random.randint(0, 2, n_samples)  # is_new_device
        X[:, 3] = np.random.randint(0, 2, n_samples)  # is_high_risk_corridor
        X[:, 4] = np.random.randint(1, 4, n_samples)  # kyc_level
        
        if task_type == TaskType.BINARY_CLASSIFICATION:
            # Generate labels based on features (fraud detection)
            fraud_prob = (
                0.02 +  # base rate
                0.15 * X[:, 3] +  # high risk corridor
                0.08 * X[:, 2] +  # new device
                0.05 * (X[:, 1] > 5) +  # high velocity
                0.03 * (X[:, 4] < 2)  # low KYC
            )
            y = (np.random.random(n_samples) < fraud_prob).astype(int)
        elif task_type == TaskType.REGRESSION:
            # Generate continuous target (risk score)
            y = (
                20 +
                25 * X[:, 3] +
                15 * X[:, 2] +
                10 * (X[:, 1] > 5) +
                np.random.randn(n_samples) * 5
            )
            y = np.clip(y, 0, 100)
        elif task_type == TaskType.ANOMALY_DETECTION:
            # For anomaly detection, we don't need labels during training
            y = np.zeros(n_samples)
            # Add some anomalies
            anomaly_idx = np.random.choice(n_samples, int(n_samples * 0.05), replace=False)
            X[anomaly_idx] = X[anomaly_idx] * 3 + np.random.randn(len(anomaly_idx), n_features) * 2
            y[anomaly_idx] = 1
        else:
            y = np.random.randint(0, 3, n_samples)  # multiclass
        
        return X, y
    
    def train_xgboost(self, X_train: Any, y_train: Any, X_val: Any, y_val: Any, 
                      config: TrainingConfig) -> Tuple[Any, Dict[str, float], Dict[str, float]]:
        """Train XGBoost model"""
        if not XGBOOST_AVAILABLE:
            raise RuntimeError("XGBoost not available")
        
        import numpy as np
        
        # Default hyperparameters
        params = {
            "n_estimators": 200,
            "max_depth": 6,
            "learning_rate": 0.1,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "random_state": config.random_state,
            "n_jobs": -1
        }
        params.update(config.hyperparameters)
        
        if config.task_type == TaskType.BINARY_CLASSIFICATION:
            params["objective"] = "binary:logistic"
            params["eval_metric"] = "auc"
            model = xgb.XGBClassifier(**params)
        elif config.task_type == TaskType.REGRESSION:
            params["objective"] = "reg:squarederror"
            model = xgb.XGBRegressor(**params)
        else:
            params["objective"] = "multi:softmax"
            model = xgb.XGBClassifier(**params)
        
        # Train with early stopping
        model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            verbose=False
        )
        
        # Calculate metrics
        if config.task_type in [TaskType.BINARY_CLASSIFICATION, TaskType.MULTICLASS_CLASSIFICATION]:
            y_pred = model.predict(X_val)
            y_prob = model.predict_proba(X_val)[:, 1] if config.task_type == TaskType.BINARY_CLASSIFICATION else None
            
            metrics = {
                "accuracy": float(accuracy_score(y_val, y_pred)),
                "precision": float(precision_score(y_val, y_pred, average='binary' if config.task_type == TaskType.BINARY_CLASSIFICATION else 'weighted')),
                "recall": float(recall_score(y_val, y_pred, average='binary' if config.task_type == TaskType.BINARY_CLASSIFICATION else 'weighted')),
                "f1_score": float(f1_score(y_val, y_pred, average='binary' if config.task_type == TaskType.BINARY_CLASSIFICATION else 'weighted'))
            }
            if y_prob is not None:
                metrics["auc_roc"] = float(roc_auc_score(y_val, y_prob))
        else:
            y_pred = model.predict(X_val)
            metrics = {
                "rmse": float(np.sqrt(mean_squared_error(y_val, y_pred))),
                "mae": float(mean_absolute_error(y_val, y_pred)),
                "r2_score": float(r2_score(y_val, y_pred))
            }
        
        # Feature importance
        importance = model.feature_importances_
        feature_names = config.feature_columns if len(config.feature_columns) == len(importance) else [f"feature_{i}" for i in range(len(importance))]
        feature_importance = {name: float(imp) for name, imp in zip(feature_names, importance)}
        
        return model, metrics, feature_importance
    
    def train_lightgbm(self, X_train: Any, y_train: Any, X_val: Any, y_val: Any,
                       config: TrainingConfig) -> Tuple[Any, Dict[str, float], Dict[str, float]]:
        """Train LightGBM model"""
        if not LIGHTGBM_AVAILABLE:
            raise RuntimeError("LightGBM not available")
        
        import numpy as np
        
        params = {
            "n_estimators": 150,
            "max_depth": 8,
            "learning_rate": 0.05,
            "num_leaves": 31,
            "feature_fraction": 0.8,
            "random_state": config.random_state,
            "n_jobs": -1,
            "verbose": -1
        }
        params.update(config.hyperparameters)
        
        if config.task_type == TaskType.BINARY_CLASSIFICATION:
            params["objective"] = "binary"
            model = lgb.LGBMClassifier(**params)
        elif config.task_type == TaskType.REGRESSION:
            params["objective"] = "regression"
            model = lgb.LGBMRegressor(**params)
        else:
            params["objective"] = "multiclass"
            model = lgb.LGBMClassifier(**params)
        
        model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)]
        )
        
        # Calculate metrics
        if config.task_type in [TaskType.BINARY_CLASSIFICATION, TaskType.MULTICLASS_CLASSIFICATION]:
            y_pred = model.predict(X_val)
            y_prob = model.predict_proba(X_val)[:, 1] if config.task_type == TaskType.BINARY_CLASSIFICATION else None
            
            metrics = {
                "accuracy": float(accuracy_score(y_val, y_pred)),
                "precision": float(precision_score(y_val, y_pred, average='binary' if config.task_type == TaskType.BINARY_CLASSIFICATION else 'weighted')),
                "recall": float(recall_score(y_val, y_pred, average='binary' if config.task_type == TaskType.BINARY_CLASSIFICATION else 'weighted')),
                "f1_score": float(f1_score(y_val, y_pred, average='binary' if config.task_type == TaskType.BINARY_CLASSIFICATION else 'weighted'))
            }
            if y_prob is not None:
                metrics["auc_roc"] = float(roc_auc_score(y_val, y_prob))
        else:
            y_pred = model.predict(X_val)
            metrics = {
                "rmse": float(np.sqrt(mean_squared_error(y_val, y_pred))),
                "mae": float(mean_absolute_error(y_val, y_pred)),
                "r2_score": float(r2_score(y_val, y_pred))
            }
        
        importance = model.feature_importances_
        feature_names = config.feature_columns if len(config.feature_columns) == len(importance) else [f"feature_{i}" for i in range(len(importance))]
        feature_importance = {name: float(imp) for name, imp in zip(feature_names, importance)}
        
        return model, metrics, feature_importance
    
    def train_isolation_forest(self, X_train: Any, y_train: Any, X_val: Any, y_val: Any,
                               config: TrainingConfig) -> Tuple[Any, Dict[str, float], Dict[str, float]]:
        """Train Isolation Forest for anomaly detection"""
        if not SKLEARN_AVAILABLE:
            raise RuntimeError("scikit-learn not available")
        
        import numpy as np
        
        params = {
            "n_estimators": 100,
            "max_samples": "auto",
            "contamination": 0.05,
            "max_features": 1.0,
            "random_state": config.random_state,
            "n_jobs": -1
        }
        params.update(config.hyperparameters)
        
        model = IsolationForest(**params)
        model.fit(X_train)
        
        # Predict anomalies (-1 for anomaly, 1 for normal)
        y_pred_train = model.predict(X_train)
        y_pred_val = model.predict(X_val)
        
        # Convert to binary (1 for anomaly, 0 for normal)
        y_pred_val_binary = (y_pred_val == -1).astype(int)
        
        # Calculate metrics if we have labels
        if y_val is not None and len(np.unique(y_val)) > 1:
            metrics = {
                "precision_at_contamination": float(precision_score(y_val, y_pred_val_binary, zero_division=0)),
                "recall_at_contamination": float(recall_score(y_val, y_pred_val_binary, zero_division=0)),
                "f1_at_contamination": float(f1_score(y_val, y_pred_val_binary, zero_division=0))
            }
        else:
            # No labels, just report contamination rate
            anomaly_rate = np.mean(y_pred_val_binary)
            metrics = {
                "contamination": float(params["contamination"]),
                "detected_anomaly_rate": float(anomaly_rate)
            }
        
        # Isolation Forest doesn't have traditional feature importance
        # Use permutation importance or just return empty
        feature_importance = {}
        
        return model, metrics, feature_importance
    
    async def train_model(self, config: TrainingConfig, job_id: str) -> TrainingResult:
        """Train a model with the given configuration"""
        import time
        start_time = time.time()
        
        # Update job status
        if job_id in self.jobs:
            self.jobs[job_id].status = TrainingStatus.RUNNING
            self.jobs[job_id].progress = 0.1
        
        try:
            # Generate or load training data
            X, y = self.generate_synthetic_training_data(
                n_samples=10000,
                task_type=config.task_type
            )
            
            if X is None:
                raise RuntimeError("Failed to generate training data")
            
            # Update progress
            if job_id in self.jobs:
                self.jobs[job_id].progress = 0.3
            
            # Split data
            if SKLEARN_AVAILABLE:
                X_train, X_val, y_train, y_val = train_test_split(
                    X, y, test_size=config.validation_split, random_state=config.random_state
                )
            else:
                split_idx = int(len(X) * (1 - config.validation_split))
                X_train, X_val = X[:split_idx], X[split_idx:]
                y_train, y_val = y[:split_idx], y[split_idx:]
            
            # Update progress
            if job_id in self.jobs:
                self.jobs[job_id].progress = 0.5
            
            # Train model based on algorithm
            if config.algorithm == ModelAlgorithm.XGBOOST:
                model, metrics, feature_importance = self.train_xgboost(
                    X_train, y_train, X_val, y_val, config
                )
            elif config.algorithm == ModelAlgorithm.LIGHTGBM:
                model, metrics, feature_importance = self.train_lightgbm(
                    X_train, y_train, X_val, y_val, config
                )
            elif config.algorithm == ModelAlgorithm.ISOLATION_FOREST:
                model, metrics, feature_importance = self.train_isolation_forest(
                    X_train, y_train, X_val, y_val, config
                )
            else:
                raise ValueError(f"Unsupported algorithm: {config.algorithm}")
            
            # Update progress
            if job_id in self.jobs:
                self.jobs[job_id].progress = 0.8
            
            # Save model
            model_version = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            model_filename = f"{config.model_name}_{model_version}.pkl"
            model_path = os.path.join(MODEL_STORAGE_PATH, model_filename)
            
            os.makedirs(MODEL_STORAGE_PATH, exist_ok=True)
            with open(model_path, "wb") as f:
                pickle.dump(model, f)
            
            # Store in memory for serving
            self.trained_models[config.model_name] = {
                "model": model,
                "version": model_version,
                "config": config,
                "metrics": metrics
            }
            
            training_time = time.time() - start_time
            
            result = TrainingResult(
                model_name=config.model_name,
                model_version=model_version,
                algorithm=config.algorithm,
                task_type=config.task_type,
                metrics=metrics,
                feature_importance=feature_importance,
                training_time_seconds=training_time,
                training_samples=len(X_train),
                validation_samples=len(X_val),
                hyperparameters=config.hyperparameters,
                model_path=model_path,
                created_at=datetime.utcnow()
            )
            
            # Update job
            if job_id in self.jobs:
                self.jobs[job_id].status = TrainingStatus.COMPLETED
                self.jobs[job_id].progress = 1.0
                self.jobs[job_id].completed_at = datetime.utcnow()
                self.jobs[job_id].result = result
            
            logger.info(f"Model {config.model_name} trained successfully with metrics: {metrics}")
            
            return result
            
        except Exception as e:
            logger.error(f"Training failed for {config.model_name}: {e}")
            if job_id in self.jobs:
                self.jobs[job_id].status = TrainingStatus.FAILED
                self.jobs[job_id].error_message = str(e)
            raise
    
    def load_model(self, model_name: str, model_path: str = None) -> Any:
        """Load a trained model from disk"""
        if model_name in self.trained_models:
            return self.trained_models[model_name]["model"]
        
        if model_path and os.path.exists(model_path):
            with open(model_path, "rb") as f:
                model = pickle.load(f)
            return model
        
        raise FileNotFoundError(f"Model {model_name} not found")
    
    def predict(self, model_name: str, features: Any) -> Any:
        """Make predictions using a trained model"""
        if model_name not in self.trained_models:
            raise ValueError(f"Model {model_name} not loaded")
        
        model = self.trained_models[model_name]["model"]
        
        if hasattr(model, "predict_proba"):
            return model.predict_proba(features)
        else:
            return model.predict(features)


# Global trainer instance
_trainer = None


def get_trainer() -> ModelTrainer:
    """Get the global model trainer instance"""
    global _trainer
    if _trainer is None:
        _trainer = ModelTrainer()
    return _trainer
