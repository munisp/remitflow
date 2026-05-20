"""
Lakehouse Data Connector - Connect ML training to real lakehouse data
Provides data loading, feature extraction, and training dataset generation

Features:
- Query lakehouse for training data
- Extract features from transaction, user, and risk data
- Generate labeled datasets for supervised learning
- Support for incremental training with new data
"""

import os
import logging
import httpx
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum
import asyncio

logger = logging.getLogger(__name__)

# Configuration
LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://localhost:8020")
LAKEHOUSE_TIMEOUT = float(os.getenv("LAKEHOUSE_TIMEOUT", "30.0"))

# Try to import numpy
try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    logger.warning("NumPy not available")


class DatasetType(str, Enum):
    FRAUD_DETECTION = "fraud_detection"
    RISK_SCORING = "risk_scoring"
    ANOMALY_DETECTION = "anomaly_detection"
    CHURN_PREDICTION = "churn_prediction"
    TRANSACTION_CLASSIFICATION = "transaction_classification"


@dataclass
class DatasetConfig:
    """Configuration for dataset generation"""
    dataset_type: DatasetType
    start_date: str
    end_date: str
    min_samples: int = 1000
    max_samples: int = 100000
    include_features: Optional[List[str]] = None
    exclude_features: Optional[List[str]] = None
    label_column: Optional[str] = None
    sampling_strategy: str = "random"  # random, stratified, time_based


@dataclass
class DatasetMetadata:
    """Metadata about a generated dataset"""
    dataset_id: str
    dataset_type: DatasetType
    num_samples: int
    num_features: int
    feature_names: List[str]
    label_distribution: Dict[str, int]
    date_range: Dict[str, str]
    created_at: datetime
    source_tables: List[str]


class LakehouseConnector:
    """Connect to lakehouse for ML training data"""
    
    def __init__(self, base_url: str = None, timeout: float = None):
        self.base_url = base_url or LAKEHOUSE_URL
        self.timeout = timeout or LAKEHOUSE_TIMEOUT
        self._client = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout
            )
        return self._client
    
    async def close(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def health_check(self) -> bool:
        """Check if lakehouse is healthy"""
        try:
            client = await self._get_client()
            response = await client.get("/health")
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"Lakehouse health check failed: {e}")
            return False
    
    async def query_table(
        self,
        table: str,
        layer: str = "gold",
        filters: Optional[Dict[str, Any]] = None,
        columns: Optional[List[str]] = None,
        limit: int = 10000
    ) -> List[Dict[str, Any]]:
        """Query a lakehouse table"""
        try:
            client = await self._get_client()
            response = await client.post(
                "/query",
                json={
                    "table": table,
                    "layer": layer,
                    "filters": filters or {},
                    "columns": columns,
                    "limit": limit
                }
            )
            
            if response.status_code != 200:
                logger.error(f"Lakehouse query failed: {response.status_code}")
                return []
            
            result = response.json()
            return result.get("data", [])
            
        except Exception as e:
            logger.error(f"Lakehouse query error: {e}")
            return []
    
    async def get_user_features(self, user_id: str) -> Dict[str, Any]:
        """Get user features from lakehouse"""
        try:
            client = await self._get_client()
            response = await client.get(f"/user_features/{user_id}")
            
            if response.status_code != 200:
                return {}
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Failed to get user features: {e}")
            return {}
    
    async def get_transaction_features(self, transaction_id: str) -> Dict[str, Any]:
        """Get transaction features from lakehouse"""
        try:
            client = await self._get_client()
            response = await client.get(f"/transaction_features/{transaction_id}")
            
            if response.status_code != 200:
                return {}
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Failed to get transaction features: {e}")
            return {}
    
    async def get_risk_summary(self, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Get risk summary data for training"""
        try:
            client = await self._get_client()
            response = await client.get(
                "/risk_summary",
                params={"start_date": start_date, "end_date": end_date}
            )
            
            if response.status_code != 200:
                return []
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Failed to get risk summary: {e}")
            return []
    
    async def get_transaction_summary(self, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Get transaction summary data for training"""
        try:
            client = await self._get_client()
            response = await client.get(
                "/transaction_summary",
                params={"start_date": start_date, "end_date": end_date}
            )
            
            if response.status_code != 200:
                return []
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Failed to get transaction summary: {e}")
            return []
    
    async def get_user_segments(self, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Get user segment data for training"""
        try:
            client = await self._get_client()
            response = await client.get(
                "/user_segments",
                params={"start_date": start_date, "end_date": end_date}
            )
            
            if response.status_code != 200:
                return []
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Failed to get user segments: {e}")
            return []


class TrainingDataGenerator:
    """Generate training datasets from lakehouse data"""
    
    def __init__(self, connector: LakehouseConnector = None):
        self.connector = connector or LakehouseConnector()
    
    async def generate_fraud_detection_dataset(
        self,
        start_date: str,
        end_date: str,
        max_samples: int = 50000
    ) -> Tuple[Any, Any, DatasetMetadata]:
        """
        Generate fraud detection training dataset.
        
        Features:
        - Transaction amount, velocity, time features
        - User history features (total transactions, avg amount, etc.)
        - Device and location features
        - Risk assessment features
        
        Labels:
        - 0: Legitimate transaction
        - 1: Fraudulent transaction
        """
        if not NUMPY_AVAILABLE:
            raise RuntimeError("NumPy required for dataset generation")
        
        import numpy as np
        
        # Query risk summary for labeled data
        risk_data = await self.connector.get_risk_summary(start_date, end_date)
        transaction_data = await self.connector.get_transaction_summary(start_date, end_date)
        
        # If no real data, generate synthetic data based on lakehouse schema
        if not risk_data or not transaction_data:
            logger.warning("No lakehouse data available, generating synthetic dataset")
            return await self._generate_synthetic_fraud_dataset(max_samples)
        
        # Extract features from real data
        features = []
        labels = []
        
        for risk_record in risk_data[:max_samples]:
            # Extract features
            feature_vector = [
                float(risk_record.get("total_assessments", 0)),
                float(risk_record.get("blocked_transactions", 0)),
                float(risk_record.get("review_transactions", 0)),
                float(risk_record.get("allowed_transactions", 0)),
                float(risk_record.get("avg_risk_score", 0)),
                float(risk_record.get("high_risk_corridors", 0)),
                float(risk_record.get("velocity_violations", 0))
            ]
            features.append(feature_vector)
            
            # Label based on blocked ratio
            total = risk_record.get("total_assessments", 1)
            blocked = risk_record.get("blocked_transactions", 0)
            fraud_rate = blocked / max(total, 1)
            labels.append(1 if fraud_rate > 0.05 else 0)
        
        X = np.array(features, dtype=np.float32)
        y = np.array(labels, dtype=np.int32)
        
        # Create metadata
        metadata = DatasetMetadata(
            dataset_id=f"fraud_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            dataset_type=DatasetType.FRAUD_DETECTION,
            num_samples=len(X),
            num_features=X.shape[1] if len(X) > 0 else 0,
            feature_names=[
                "total_assessments", "blocked_transactions", "review_transactions",
                "allowed_transactions", "avg_risk_score", "high_risk_corridors",
                "velocity_violations"
            ],
            label_distribution={"legitimate": int(np.sum(y == 0)), "fraud": int(np.sum(y == 1))},
            date_range={"start": start_date, "end": end_date},
            created_at=datetime.utcnow(),
            source_tables=["risk_summary", "daily_transaction_summary"]
        )
        
        return X, y, metadata
    
    async def _generate_synthetic_fraud_dataset(self, n_samples: int) -> Tuple[Any, Any, DatasetMetadata]:
        """Generate synthetic fraud detection dataset"""
        import numpy as np
        np.random.seed(42)
        
        # Feature names matching lakehouse schema
        feature_names = [
            "amount", "amount_usd", "velocity_hourly", "velocity_daily",
            "is_new_device", "is_high_risk_corridor", "kyc_level",
            "user_total_transactions", "user_avg_amount", "user_days_since_first_tx",
            "time_since_last_tx_hours", "is_weekend", "hour_of_day",
            "beneficiary_is_new", "device_risk_score"
        ]
        
        n_features = len(feature_names)
        X = np.random.randn(n_samples, n_features).astype(np.float32)
        
        # Make features realistic
        X[:, 0] = np.abs(X[:, 0]) * 50000 + 1000  # amount (NGN)
        X[:, 1] = X[:, 0] * 0.0013  # amount_usd
        X[:, 2] = np.clip(np.abs(X[:, 2]) * 3, 0, 20)  # velocity_hourly
        X[:, 3] = np.clip(np.abs(X[:, 3]) * 10, 0, 100)  # velocity_daily
        X[:, 4] = np.random.randint(0, 2, n_samples)  # is_new_device
        X[:, 5] = np.random.randint(0, 2, n_samples)  # is_high_risk_corridor
        X[:, 6] = np.random.randint(1, 4, n_samples)  # kyc_level
        X[:, 7] = np.abs(X[:, 7]) * 50 + 1  # user_total_transactions
        X[:, 8] = np.abs(X[:, 8]) * 30000 + 5000  # user_avg_amount
        X[:, 9] = np.abs(X[:, 9]) * 365  # user_days_since_first_tx
        X[:, 10] = np.abs(X[:, 10]) * 24  # time_since_last_tx_hours
        X[:, 11] = np.random.randint(0, 2, n_samples)  # is_weekend
        X[:, 12] = np.random.randint(0, 24, n_samples)  # hour_of_day
        X[:, 13] = np.random.randint(0, 2, n_samples)  # beneficiary_is_new
        X[:, 14] = np.clip(np.abs(X[:, 14]) * 30, 0, 100)  # device_risk_score
        
        # Generate labels based on realistic fraud patterns
        fraud_prob = (
            0.02 +  # base rate
            0.15 * X[:, 5] +  # high risk corridor
            0.10 * X[:, 4] +  # new device
            0.08 * (X[:, 2] > 5) +  # high hourly velocity
            0.05 * (X[:, 3] > 30) +  # high daily velocity
            0.05 * (X[:, 6] < 2) +  # low KYC
            0.08 * X[:, 13] +  # new beneficiary
            0.03 * (X[:, 14] > 50)  # high device risk
        )
        y = (np.random.random(n_samples) < fraud_prob).astype(np.int32)
        
        metadata = DatasetMetadata(
            dataset_id=f"fraud_synthetic_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            dataset_type=DatasetType.FRAUD_DETECTION,
            num_samples=n_samples,
            num_features=n_features,
            feature_names=feature_names,
            label_distribution={"legitimate": int(np.sum(y == 0)), "fraud": int(np.sum(y == 1))},
            date_range={"start": "synthetic", "end": "synthetic"},
            created_at=datetime.utcnow(),
            source_tables=["synthetic"]
        )
        
        return X, y, metadata
    
    async def generate_risk_scoring_dataset(
        self,
        start_date: str,
        end_date: str,
        max_samples: int = 50000
    ) -> Tuple[Any, Any, DatasetMetadata]:
        """
        Generate risk scoring training dataset.
        
        Features: Same as fraud detection
        Labels: Continuous risk score (0-100)
        """
        if not NUMPY_AVAILABLE:
            raise RuntimeError("NumPy required for dataset generation")
        
        import numpy as np
        
        # Query data from lakehouse
        risk_data = await self.connector.get_risk_summary(start_date, end_date)
        
        if not risk_data:
            logger.warning("No lakehouse data available, generating synthetic dataset")
            return await self._generate_synthetic_risk_dataset(max_samples)
        
        # Extract features and labels
        features = []
        labels = []
        
        for record in risk_data[:max_samples]:
            feature_vector = [
                float(record.get("total_assessments", 0)),
                float(record.get("blocked_transactions", 0)),
                float(record.get("review_transactions", 0)),
                float(record.get("velocity_violations", 0)),
                float(record.get("high_risk_corridors", 0))
            ]
            features.append(feature_vector)
            labels.append(float(record.get("avg_risk_score", 25)))
        
        X = np.array(features, dtype=np.float32)
        y = np.array(labels, dtype=np.float32)
        
        metadata = DatasetMetadata(
            dataset_id=f"risk_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            dataset_type=DatasetType.RISK_SCORING,
            num_samples=len(X),
            num_features=X.shape[1] if len(X) > 0 else 0,
            feature_names=[
                "total_assessments", "blocked_transactions", "review_transactions",
                "velocity_violations", "high_risk_corridors"
            ],
            label_distribution={"min": float(np.min(y)), "max": float(np.max(y)), "mean": float(np.mean(y))},
            date_range={"start": start_date, "end": end_date},
            created_at=datetime.utcnow(),
            source_tables=["risk_summary"]
        )
        
        return X, y, metadata
    
    async def _generate_synthetic_risk_dataset(self, n_samples: int) -> Tuple[Any, Any, DatasetMetadata]:
        """Generate synthetic risk scoring dataset"""
        import numpy as np
        np.random.seed(42)
        
        feature_names = [
            "amount", "velocity_hourly", "velocity_daily", "is_new_device",
            "is_high_risk_corridor", "kyc_level", "user_total_transactions",
            "time_since_last_tx_hours", "beneficiary_is_new", "device_risk_score"
        ]
        
        n_features = len(feature_names)
        X = np.random.randn(n_samples, n_features).astype(np.float32)
        
        # Make features realistic
        X[:, 0] = np.abs(X[:, 0]) * 50000 + 1000  # amount
        X[:, 1] = np.clip(np.abs(X[:, 1]) * 3, 0, 20)  # velocity_hourly
        X[:, 2] = np.clip(np.abs(X[:, 2]) * 10, 0, 100)  # velocity_daily
        X[:, 3] = np.random.randint(0, 2, n_samples)  # is_new_device
        X[:, 4] = np.random.randint(0, 2, n_samples)  # is_high_risk_corridor
        X[:, 5] = np.random.randint(1, 4, n_samples)  # kyc_level
        X[:, 6] = np.abs(X[:, 6]) * 50 + 1  # user_total_transactions
        X[:, 7] = np.abs(X[:, 7]) * 24  # time_since_last_tx_hours
        X[:, 8] = np.random.randint(0, 2, n_samples)  # beneficiary_is_new
        X[:, 9] = np.clip(np.abs(X[:, 9]) * 30, 0, 100)  # device_risk_score
        
        # Generate continuous risk scores
        y = (
            15 +  # base score
            20 * X[:, 4] +  # high risk corridor
            15 * X[:, 3] +  # new device
            10 * (X[:, 1] > 5) +  # high hourly velocity
            8 * (X[:, 2] > 30) +  # high daily velocity
            10 * (X[:, 5] < 2) +  # low KYC
            12 * X[:, 8] +  # new beneficiary
            0.3 * X[:, 9] +  # device risk score contribution
            np.random.randn(n_samples) * 5  # noise
        )
        y = np.clip(y, 0, 100).astype(np.float32)
        
        metadata = DatasetMetadata(
            dataset_id=f"risk_synthetic_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            dataset_type=DatasetType.RISK_SCORING,
            num_samples=n_samples,
            num_features=n_features,
            feature_names=feature_names,
            label_distribution={"min": float(np.min(y)), "max": float(np.max(y)), "mean": float(np.mean(y))},
            date_range={"start": "synthetic", "end": "synthetic"},
            created_at=datetime.utcnow(),
            source_tables=["synthetic"]
        )
        
        return X, y, metadata
    
    async def generate_churn_prediction_dataset(
        self,
        start_date: str,
        end_date: str,
        max_samples: int = 50000
    ) -> Tuple[Any, Any, DatasetMetadata]:
        """
        Generate churn prediction training dataset.
        
        Features: User engagement and transaction patterns
        Labels: 0 = retained, 1 = churned
        """
        if not NUMPY_AVAILABLE:
            raise RuntimeError("NumPy required for dataset generation")
        
        import numpy as np
        
        # Query user segment data
        segment_data = await self.connector.get_user_segments(start_date, end_date)
        
        if not segment_data:
            logger.warning("No lakehouse data available, generating synthetic dataset")
            return await self._generate_synthetic_churn_dataset(max_samples)
        
        features = []
        labels = []
        
        for record in segment_data[:max_samples]:
            feature_vector = [
                float(record.get("user_count", 0)),
                float(record.get("total_volume_usd", 0)),
                float(record.get("avg_transaction_value", 0)),
                float(record.get("avg_transactions_per_user", 0)),
                float(record.get("ltv_estimate", 0))
            ]
            features.append(feature_vector)
            
            # Label based on churn rate
            churn_rate = float(record.get("churn_rate", 0))
            labels.append(1 if churn_rate > 0.1 else 0)
        
        X = np.array(features, dtype=np.float32)
        y = np.array(labels, dtype=np.int32)
        
        metadata = DatasetMetadata(
            dataset_id=f"churn_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            dataset_type=DatasetType.CHURN_PREDICTION,
            num_samples=len(X),
            num_features=X.shape[1] if len(X) > 0 else 0,
            feature_names=[
                "user_count", "total_volume_usd", "avg_transaction_value",
                "avg_transactions_per_user", "ltv_estimate"
            ],
            label_distribution={"retained": int(np.sum(y == 0)), "churned": int(np.sum(y == 1))},
            date_range={"start": start_date, "end": end_date},
            created_at=datetime.utcnow(),
            source_tables=["user_segments"]
        )
        
        return X, y, metadata
    
    async def _generate_synthetic_churn_dataset(self, n_samples: int) -> Tuple[Any, Any, DatasetMetadata]:
        """Generate synthetic churn prediction dataset"""
        import numpy as np
        np.random.seed(42)
        
        feature_names = [
            "days_since_last_transaction", "total_transactions_30d", "total_volume_30d",
            "avg_transaction_value", "transaction_frequency", "days_since_registration",
            "kyc_level", "support_tickets_30d", "failed_transactions_30d",
            "unique_beneficiaries", "app_sessions_30d", "notification_clicks_30d"
        ]
        
        n_features = len(feature_names)
        X = np.random.randn(n_samples, n_features).astype(np.float32)
        
        # Make features realistic
        X[:, 0] = np.abs(X[:, 0]) * 30  # days_since_last_transaction
        X[:, 1] = np.clip(np.abs(X[:, 1]) * 10, 0, 50)  # total_transactions_30d
        X[:, 2] = np.abs(X[:, 2]) * 5000  # total_volume_30d
        X[:, 3] = np.abs(X[:, 3]) * 500 + 50  # avg_transaction_value
        X[:, 4] = np.clip(np.abs(X[:, 4]) * 2, 0, 10)  # transaction_frequency
        X[:, 5] = np.abs(X[:, 5]) * 365  # days_since_registration
        X[:, 6] = np.random.randint(1, 4, n_samples)  # kyc_level
        X[:, 7] = np.clip(np.abs(X[:, 7]) * 2, 0, 10)  # support_tickets_30d
        X[:, 8] = np.clip(np.abs(X[:, 8]) * 3, 0, 15)  # failed_transactions_30d
        X[:, 9] = np.clip(np.abs(X[:, 9]) * 5, 1, 20)  # unique_beneficiaries
        X[:, 10] = np.clip(np.abs(X[:, 10]) * 20, 0, 100)  # app_sessions_30d
        X[:, 11] = np.clip(np.abs(X[:, 11]) * 10, 0, 50)  # notification_clicks_30d
        
        # Generate churn labels
        churn_prob = (
            0.05 +  # base rate
            0.02 * X[:, 0] / 30 +  # days since last tx
            -0.01 * X[:, 1] / 10 +  # more transactions = less churn
            -0.005 * X[:, 4] +  # higher frequency = less churn
            0.03 * X[:, 7] / 5 +  # more support tickets = more churn
            0.02 * X[:, 8] / 5 +  # more failed tx = more churn
            -0.01 * X[:, 10] / 50  # more app sessions = less churn
        )
        churn_prob = np.clip(churn_prob, 0, 1)
        y = (np.random.random(n_samples) < churn_prob).astype(np.int32)
        
        metadata = DatasetMetadata(
            dataset_id=f"churn_synthetic_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            dataset_type=DatasetType.CHURN_PREDICTION,
            num_samples=n_samples,
            num_features=n_features,
            feature_names=feature_names,
            label_distribution={"retained": int(np.sum(y == 0)), "churned": int(np.sum(y == 1))},
            date_range={"start": "synthetic", "end": "synthetic"},
            created_at=datetime.utcnow(),
            source_tables=["synthetic"]
        )
        
        return X, y, metadata


# Global instances
_connector = None
_generator = None


def get_lakehouse_connector() -> LakehouseConnector:
    """Get the global lakehouse connector instance"""
    global _connector
    if _connector is None:
        _connector = LakehouseConnector()
    return _connector


def get_training_data_generator() -> TrainingDataGenerator:
    """Get the global training data generator instance"""
    global _generator
    if _generator is None:
        _generator = TrainingDataGenerator(get_lakehouse_connector())
    return _generator
