"""
Data Quality and Feature Validation Gates
Production-grade data quality checks for ML pipelines
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple, Set
from dataclasses import dataclass, field, asdict
from enum import Enum
import numpy as np
from collections import defaultdict

import asyncpg
import redis.asyncio as redis

logger = logging.getLogger(__name__)

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'redis.remittance.svc.cluster.local')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_URL = os.getenv('REDIS_URL', f'redis://{REDIS_HOST}:{REDIS_PORT}')
DB_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank')


class ValidationResult(str, Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"


class DataQualityIssue(str, Enum):
    MISSING_VALUE = "missing_value"
    OUT_OF_RANGE = "out_of_range"
    INVALID_TYPE = "invalid_type"
    CARDINALITY_EXPLOSION = "cardinality_explosion"
    DISTRIBUTION_SHIFT = "distribution_shift"
    SCHEMA_MISMATCH = "schema_mismatch"
    OUTLIER = "outlier"
    DUPLICATE = "duplicate"


@dataclass
class FeatureSchema:
    """Schema definition for a feature"""
    name: str
    dtype: str  # int, float, str, bool, categorical
    nullable: bool = False
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    allowed_values: Optional[List[Any]] = None
    max_cardinality: Optional[int] = None
    description: str = ""


@dataclass
class ValidationReport:
    """Report from data validation"""
    timestamp: datetime
    model_name: str
    validation_type: str  # training, inference
    total_records: int
    valid_records: int
    invalid_records: int
    result: ValidationResult
    issues: List[Dict[str, Any]] = field(default_factory=list)
    feature_stats: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)


@dataclass
class DriftReport:
    """Report from drift detection"""
    timestamp: datetime
    model_name: str
    feature_name: str
    drift_type: str  # feature, prediction, label
    psi_score: float
    kl_divergence: float
    is_drifted: bool
    reference_stats: Dict[str, float]
    current_stats: Dict[str, float]


class FeatureSchemaRegistry:
    """Registry for feature schemas"""
    
    def __init__(self):
        self._schemas: Dict[str, Dict[str, FeatureSchema]] = {}
        self._initialize_default_schemas()
    
    def _initialize_default_schemas(self):
        """Initialize default schemas for known models"""
        # Routing ML features
        self._schemas['routing_success'] = {
            'bank_code': FeatureSchema(
                name='bank_code', dtype='categorical', nullable=False,
                max_cardinality=100, description='Bank code identifier'
            ),
            'bank_category': FeatureSchema(
                name='bank_category', dtype='categorical', nullable=False,
                allowed_values=['commercial', 'microfinance', 'digital', 'merchant'],
                description='Bank category'
            ),
            'rail': FeatureSchema(
                name='rail', dtype='categorical', nullable=False,
                allowed_values=['nip', 'on_us', 'direct', 'neft'],
                description='Payment rail'
            ),
            'amount': FeatureSchema(
                name='amount', dtype='float', nullable=False,
                min_value=0, max_value=1000000000,
                description='Transaction amount in NGN'
            ),
            'hour_of_day': FeatureSchema(
                name='hour_of_day', dtype='int', nullable=False,
                min_value=0, max_value=23,
                description='Hour of day (0-23)'
            ),
            'day_of_week': FeatureSchema(
                name='day_of_week', dtype='int', nullable=False,
                min_value=0, max_value=6,
                description='Day of week (0=Monday)'
            ),
            'bank_success_rate_1h': FeatureSchema(
                name='bank_success_rate_1h', dtype='float', nullable=False,
                min_value=0, max_value=1,
                description='Bank success rate in last hour'
            ),
            'bank_success_rate_24h': FeatureSchema(
                name='bank_success_rate_24h', dtype='float', nullable=False,
                min_value=0, max_value=1,
                description='Bank success rate in last 24 hours'
            ),
            'account_balance_ratio': FeatureSchema(
                name='account_balance_ratio', dtype='float', nullable=False,
                min_value=0, max_value=1000,
                description='Account balance to amount ratio'
            ),
        }
        
        # Fraud detection features
        self._schemas['fraud_detection'] = {
            'amount': FeatureSchema(
                name='amount', dtype='float', nullable=False,
                min_value=0, max_value=1000000000,
                description='Transaction amount'
            ),
            'merchant_category': FeatureSchema(
                name='merchant_category', dtype='categorical', nullable=False,
                max_cardinality=500,
                description='Merchant category code'
            ),
            'transaction_type': FeatureSchema(
                name='transaction_type', dtype='categorical', nullable=False,
                allowed_values=['transfer', 'payment', 'withdrawal', 'deposit'],
                description='Transaction type'
            ),
            'hour_of_day': FeatureSchema(
                name='hour_of_day', dtype='int', nullable=False,
                min_value=0, max_value=23,
                description='Hour of day'
            ),
            'user_transaction_count_1h': FeatureSchema(
                name='user_transaction_count_1h', dtype='int', nullable=False,
                min_value=0, max_value=1000,
                description='User transaction count in last hour'
            ),
            'user_avg_amount': FeatureSchema(
                name='user_avg_amount', dtype='float', nullable=True,
                min_value=0, max_value=1000000000,
                description='User average transaction amount'
            ),
        }
        
        # Credit scoring features
        self._schemas['credit_scoring'] = {
            'age': FeatureSchema(
                name='age', dtype='int', nullable=False,
                min_value=18, max_value=120,
                description='Customer age'
            ),
            'income': FeatureSchema(
                name='income', dtype='float', nullable=False,
                min_value=0, max_value=1000000000,
                description='Annual income'
            ),
            'employment_length': FeatureSchema(
                name='employment_length', dtype='int', nullable=True,
                min_value=0, max_value=50,
                description='Years at current employment'
            ),
            'debt_to_income': FeatureSchema(
                name='debt_to_income', dtype='float', nullable=False,
                min_value=0, max_value=10,
                description='Debt to income ratio'
            ),
            'credit_history_length': FeatureSchema(
                name='credit_history_length', dtype='int', nullable=True,
                min_value=0, max_value=50,
                description='Years of credit history'
            ),
        }
    
    def get_schema(self, model_name: str) -> Dict[str, FeatureSchema]:
        """Get schema for a model"""
        return self._schemas.get(model_name, {})
    
    def register_schema(self, model_name: str, schema: Dict[str, FeatureSchema]):
        """Register a new schema"""
        self._schemas[model_name] = schema
    
    def get_schema_hash(self, model_name: str) -> str:
        """Get hash of schema for versioning"""
        schema = self._schemas.get(model_name, {})
        schema_str = json.dumps({k: asdict(v) for k, v in schema.items()}, sort_keys=True)
        import hashlib
        return hashlib.sha256(schema_str.encode()).hexdigest()[:16]


class DataQualityValidator:
    """Validates data quality for ML pipelines"""
    
    def __init__(self, schema_registry: FeatureSchemaRegistry = None):
        self.schema_registry = schema_registry or FeatureSchemaRegistry()
        self.redis: Optional[redis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        
        # Validation thresholds
        self.thresholds = {
            'max_missing_rate': 0.05,  # 5% max missing values
            'max_outlier_rate': 0.01,  # 1% max outliers
            'min_sample_size': 100,    # Minimum samples for training
            'max_cardinality_growth': 1.5,  # 50% max cardinality growth
        }
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
        self.db_pool = await asyncpg.create_pool(DB_URL, min_size=5, max_size=20)
    
    def validate_features(
        self,
        model_name: str,
        features: Dict[str, Any],
        validation_type: str = 'inference'
    ) -> Tuple[ValidationResult, List[Dict[str, Any]]]:
        """Validate a single feature set"""
        schema = self.schema_registry.get_schema(model_name)
        if not schema:
            return ValidationResult.WARN, [{'issue': 'no_schema', 'message': f'No schema for {model_name}'}]
        
        issues = []
        
        for feature_name, feature_schema in schema.items():
            value = features.get(feature_name)
            
            # Check for missing values
            if value is None:
                if not feature_schema.nullable:
                    issues.append({
                        'issue': DataQualityIssue.MISSING_VALUE.value,
                        'feature': feature_name,
                        'message': f'Missing required feature: {feature_name}'
                    })
                continue
            
            # Type validation
            if not self._validate_type(value, feature_schema.dtype):
                issues.append({
                    'issue': DataQualityIssue.INVALID_TYPE.value,
                    'feature': feature_name,
                    'expected': feature_schema.dtype,
                    'actual': type(value).__name__,
                    'message': f'Invalid type for {feature_name}'
                })
                continue
            
            # Range validation
            if feature_schema.min_value is not None and value < feature_schema.min_value:
                issues.append({
                    'issue': DataQualityIssue.OUT_OF_RANGE.value,
                    'feature': feature_name,
                    'value': value,
                    'min': feature_schema.min_value,
                    'message': f'{feature_name} below minimum: {value} < {feature_schema.min_value}'
                })
            
            if feature_schema.max_value is not None and value > feature_schema.max_value:
                issues.append({
                    'issue': DataQualityIssue.OUT_OF_RANGE.value,
                    'feature': feature_name,
                    'value': value,
                    'max': feature_schema.max_value,
                    'message': f'{feature_name} above maximum: {value} > {feature_schema.max_value}'
                })
            
            # Allowed values validation
            if feature_schema.allowed_values and value not in feature_schema.allowed_values:
                issues.append({
                    'issue': DataQualityIssue.OUT_OF_RANGE.value,
                    'feature': feature_name,
                    'value': value,
                    'allowed': feature_schema.allowed_values,
                    'message': f'{feature_name} not in allowed values: {value}'
                })
        
        # Determine result
        if any(i['issue'] in [DataQualityIssue.MISSING_VALUE.value, DataQualityIssue.INVALID_TYPE.value] 
               for i in issues):
            result = ValidationResult.FAIL
        elif issues:
            result = ValidationResult.WARN
        else:
            result = ValidationResult.PASS
        
        return result, issues
    
    def validate_batch(
        self,
        model_name: str,
        feature_batch: List[Dict[str, Any]],
        validation_type: str = 'training'
    ) -> ValidationReport:
        """Validate a batch of features"""
        schema = self.schema_registry.get_schema(model_name)
        
        total_records = len(feature_batch)
        valid_records = 0
        all_issues = []
        feature_stats = defaultdict(lambda: {
            'count': 0, 'missing': 0, 'invalid': 0,
            'values': [], 'unique_values': set()
        })
        warnings = []
        
        # Check minimum sample size
        if validation_type == 'training' and total_records < self.thresholds['min_sample_size']:
            warnings.append(f"Insufficient samples: {total_records} < {self.thresholds['min_sample_size']}")
        
        for features in feature_batch:
            result, issues = self.validate_features(model_name, features, validation_type)
            
            if result == ValidationResult.PASS:
                valid_records += 1
            
            all_issues.extend(issues)
            
            # Collect stats
            for feature_name in schema.keys():
                value = features.get(feature_name)
                stats = feature_stats[feature_name]
                stats['count'] += 1
                
                if value is None:
                    stats['missing'] += 1
                else:
                    if isinstance(value, (int, float)):
                        stats['values'].append(value)
                    stats['unique_values'].add(str(value))
        
        # Calculate aggregate stats
        for feature_name, stats in feature_stats.items():
            feature_schema = schema.get(feature_name)
            
            # Missing rate
            missing_rate = stats['missing'] / stats['count'] if stats['count'] > 0 else 0
            stats['missing_rate'] = missing_rate
            
            if missing_rate > self.thresholds['max_missing_rate']:
                warnings.append(f"High missing rate for {feature_name}: {missing_rate:.2%}")
            
            # Cardinality check
            cardinality = len(stats['unique_values'])
            stats['cardinality'] = cardinality
            
            if feature_schema and feature_schema.max_cardinality:
                if cardinality > feature_schema.max_cardinality:
                    warnings.append(f"Cardinality explosion for {feature_name}: {cardinality} > {feature_schema.max_cardinality}")
            
            # Numeric stats
            if stats['values']:
                stats['mean'] = np.mean(stats['values'])
                stats['std'] = np.std(stats['values'])
                stats['min'] = min(stats['values'])
                stats['max'] = max(stats['values'])
                stats['p50'] = np.percentile(stats['values'], 50)
                stats['p95'] = np.percentile(stats['values'], 95)
                stats['p99'] = np.percentile(stats['values'], 99)
            
            # Clean up for serialization
            del stats['values']
            stats['unique_values'] = cardinality
        
        # Determine overall result
        invalid_rate = (total_records - valid_records) / total_records if total_records > 0 else 0
        
        if invalid_rate > 0.1:  # More than 10% invalid
            result = ValidationResult.FAIL
        elif warnings or invalid_rate > 0.01:
            result = ValidationResult.WARN
        else:
            result = ValidationResult.PASS
        
        return ValidationReport(
            timestamp=datetime.utcnow(),
            model_name=model_name,
            validation_type=validation_type,
            total_records=total_records,
            valid_records=valid_records,
            invalid_records=total_records - valid_records,
            result=result,
            issues=all_issues[:100],  # Limit issues
            feature_stats=dict(feature_stats),
            warnings=warnings
        )
    
    def _validate_type(self, value: Any, expected_type: str) -> bool:
        """Validate value type"""
        if expected_type == 'int':
            return isinstance(value, int) or (isinstance(value, float) and value.is_integer())
        elif expected_type == 'float':
            return isinstance(value, (int, float))
        elif expected_type == 'str':
            return isinstance(value, str)
        elif expected_type == 'bool':
            return isinstance(value, bool)
        elif expected_type == 'categorical':
            return isinstance(value, (str, int))
        return True


class DriftDetector:
    """Detects feature and prediction drift"""
    
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        
        # Drift thresholds
        self.psi_threshold = 0.2  # PSI > 0.2 indicates significant drift
        self.kl_threshold = 0.1  # KL divergence threshold
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
        self.db_pool = await asyncpg.create_pool(DB_URL, min_size=5, max_size=20)
    
    def calculate_psi(
        self,
        reference: List[float],
        current: List[float],
        n_bins: int = 10
    ) -> float:
        """Calculate Population Stability Index (PSI)"""
        if not reference or not current:
            return 0.0
        
        # Create bins from reference distribution
        min_val = min(min(reference), min(current))
        max_val = max(max(reference), max(current))
        bins = np.linspace(min_val, max_val, n_bins + 1)
        
        # Calculate histograms
        ref_hist, _ = np.histogram(reference, bins=bins)
        cur_hist, _ = np.histogram(current, bins=bins)
        
        # Normalize to proportions
        ref_prop = ref_hist / len(reference)
        cur_prop = cur_hist / len(current)
        
        # Avoid division by zero
        ref_prop = np.clip(ref_prop, 0.0001, 1)
        cur_prop = np.clip(cur_prop, 0.0001, 1)
        
        # Calculate PSI
        psi = np.sum((cur_prop - ref_prop) * np.log(cur_prop / ref_prop))
        
        return float(psi)
    
    def calculate_kl_divergence(
        self,
        reference: List[float],
        current: List[float],
        n_bins: int = 10
    ) -> float:
        """Calculate KL Divergence"""
        if not reference or not current:
            return 0.0
        
        min_val = min(min(reference), min(current))
        max_val = max(max(reference), max(current))
        bins = np.linspace(min_val, max_val, n_bins + 1)
        
        ref_hist, _ = np.histogram(reference, bins=bins)
        cur_hist, _ = np.histogram(current, bins=bins)
        
        ref_prop = ref_hist / len(reference)
        cur_prop = cur_hist / len(current)
        
        ref_prop = np.clip(ref_prop, 0.0001, 1)
        cur_prop = np.clip(cur_prop, 0.0001, 1)
        
        kl = np.sum(ref_prop * np.log(ref_prop / cur_prop))
        
        return float(kl)
    
    async def detect_feature_drift(
        self,
        model_name: str,
        feature_name: str,
        current_values: List[float],
        reference_window_days: int = 7
    ) -> DriftReport:
        """Detect drift for a specific feature"""
        # Get reference distribution from database
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT feature_value
                FROM ml_feature_log
                WHERE model_name = $1 AND feature_name = $2
                AND timestamp >= NOW() - INTERVAL '%s days'
                AND timestamp < NOW() - INTERVAL '1 day'
                LIMIT 100000
            """, model_name, feature_name, reference_window_days)
        
        reference_values = [r['feature_value'] for r in rows if r['feature_value'] is not None]
        
        if not reference_values:
            # No reference data, use current as baseline
            await self._store_baseline(model_name, feature_name, current_values)
            return DriftReport(
                timestamp=datetime.utcnow(),
                model_name=model_name,
                feature_name=feature_name,
                drift_type='feature',
                psi_score=0,
                kl_divergence=0,
                is_drifted=False,
                reference_stats={},
                current_stats=self._calculate_stats(current_values)
            )
        
        # Calculate drift metrics
        psi = self.calculate_psi(reference_values, current_values)
        kl = self.calculate_kl_divergence(reference_values, current_values)
        
        is_drifted = psi > self.psi_threshold
        
        report = DriftReport(
            timestamp=datetime.utcnow(),
            model_name=model_name,
            feature_name=feature_name,
            drift_type='feature',
            psi_score=psi,
            kl_divergence=kl,
            is_drifted=is_drifted,
            reference_stats=self._calculate_stats(reference_values),
            current_stats=self._calculate_stats(current_values)
        )
        
        # Store drift report
        await self._store_drift_report(report)
        
        return report
    
    async def detect_prediction_drift(
        self,
        model_name: str,
        current_predictions: List[float],
        reference_window_days: int = 7
    ) -> DriftReport:
        """Detect drift in model predictions"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT prediction
                FROM ml_inference_log
                WHERE model_name = $1
                AND timestamp >= NOW() - INTERVAL '%s days'
                AND timestamp < NOW() - INTERVAL '1 day'
                LIMIT 100000
            """, model_name, reference_window_days)
        
        reference_predictions = [r['prediction'] for r in rows if r['prediction'] is not None]
        
        if not reference_predictions:
            return DriftReport(
                timestamp=datetime.utcnow(),
                model_name=model_name,
                feature_name='prediction',
                drift_type='prediction',
                psi_score=0,
                kl_divergence=0,
                is_drifted=False,
                reference_stats={},
                current_stats=self._calculate_stats(current_predictions)
            )
        
        psi = self.calculate_psi(reference_predictions, current_predictions)
        kl = self.calculate_kl_divergence(reference_predictions, current_predictions)
        
        is_drifted = psi > self.psi_threshold
        
        report = DriftReport(
            timestamp=datetime.utcnow(),
            model_name=model_name,
            feature_name='prediction',
            drift_type='prediction',
            psi_score=psi,
            kl_divergence=kl,
            is_drifted=is_drifted,
            reference_stats=self._calculate_stats(reference_predictions),
            current_stats=self._calculate_stats(current_predictions)
        )
        
        await self._store_drift_report(report)
        
        return report
    
    def _calculate_stats(self, values: List[float]) -> Dict[str, float]:
        """Calculate basic statistics"""
        if not values:
            return {}
        
        return {
            'count': len(values),
            'mean': float(np.mean(values)),
            'std': float(np.std(values)),
            'min': float(min(values)),
            'max': float(max(values)),
            'p25': float(np.percentile(values, 25)),
            'p50': float(np.percentile(values, 50)),
            'p75': float(np.percentile(values, 75)),
            'p95': float(np.percentile(values, 95))
        }
    
    async def _store_baseline(
        self,
        model_name: str,
        feature_name: str,
        values: List[float]
    ):
        """Store baseline distribution"""
        stats = self._calculate_stats(values)
        key = f"ml:baseline:{model_name}:{feature_name}"
        await self.redis.setex(key, 86400 * 30, json.dumps(stats))
    
    async def _store_drift_report(self, report: DriftReport):
        """Store drift report"""
        key = f"ml:drift:{report.model_name}:{report.feature_name}"
        await self.redis.lpush(key, json.dumps(asdict(report), default=str))
        await self.redis.ltrim(key, 0, 99)


class OnlineLearningGate:
    """Gate for online learning updates"""
    
    def __init__(
        self,
        validator: DataQualityValidator,
        drift_detector: DriftDetector
    ):
        self.validator = validator
        self.drift_detector = drift_detector
        self.redis: Optional[redis.Redis] = None
        
        # Gate thresholds
        self.min_samples = 100
        self.max_label_delay_hours = 24
        self.max_drift_psi = 0.3
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
    
    async def should_update(
        self,
        model_name: str,
        new_samples: List[Dict[str, Any]],
        labels: List[float]
    ) -> Tuple[bool, List[str]]:
        """Check if online learning update should proceed"""
        reasons = []
        
        # Check sample size
        if len(new_samples) < self.min_samples:
            reasons.append(f"Insufficient samples: {len(new_samples)} < {self.min_samples}")
        
        # Check label availability
        if len(labels) != len(new_samples):
            reasons.append(f"Label count mismatch: {len(labels)} != {len(new_samples)}")
        
        # Validate data quality
        report = self.validator.validate_batch(model_name, new_samples, 'training')
        if report.result == ValidationResult.FAIL:
            reasons.append(f"Data quality validation failed: {report.warnings}")
        
        # Check for drift
        for feature_name in new_samples[0].keys() if new_samples else []:
            values = [s.get(feature_name) for s in new_samples if isinstance(s.get(feature_name), (int, float))]
            if values:
                drift_report = await self.drift_detector.detect_feature_drift(
                    model_name, feature_name, values
                )
                if drift_report.psi_score > self.max_drift_psi:
                    reasons.append(f"High drift detected for {feature_name}: PSI={drift_report.psi_score:.3f}")
        
        should_proceed = len(reasons) == 0
        
        # Log decision
        await self.redis.lpush(
            f"ml:gate:{model_name}",
            json.dumps({
                'timestamp': datetime.utcnow().isoformat(),
                'should_proceed': should_proceed,
                'reasons': reasons,
                'sample_count': len(new_samples)
            })
        )
        await self.redis.ltrim(f"ml:gate:{model_name}", 0, 99)
        
        return should_proceed, reasons


# Export classes
__all__ = [
    'FeatureSchemaRegistry',
    'DataQualityValidator',
    'DriftDetector',
    'OnlineLearningGate',
    'ValidationReport',
    'DriftReport',
    'ValidationResult'
]
