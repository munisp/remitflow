"""
ML Model Explainability Service
SHAP, feature importance, and audit-friendly explanations
"""

import os
import json
import logging
import hashlib
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum
import numpy as np

import asyncpg
import redis.asyncio as redis

logger = logging.getLogger(__name__)

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'redis.remittance.svc.cluster.local')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_URL = os.getenv('REDIS_URL', f'redis://{REDIS_HOST}:{REDIS_PORT}')
DB_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank')


class ExplanationType(str, Enum):
    """Types of explanations"""
    FEATURE_IMPORTANCE = "feature_importance"
    SHAP_VALUES = "shap_values"
    LIME = "lime"
    COUNTERFACTUAL = "counterfactual"
    RULE_BASED = "rule_based"
    REASON_CODES = "reason_codes"


@dataclass
class FeatureContribution:
    """Contribution of a single feature to prediction"""
    feature_name: str
    feature_value: Any
    contribution: float  # Positive = increases prediction, negative = decreases
    importance_rank: int
    baseline_value: Optional[float] = None
    description: str = ""


@dataclass
class ModelExplanation:
    """Complete explanation for a prediction"""
    model_name: str
    model_version: str
    request_id: str
    timestamp: datetime
    prediction: float
    explanation_type: ExplanationType
    feature_contributions: List[FeatureContribution]
    reason_codes: List[str]
    summary: str
    confidence: float
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GlobalExplanation:
    """Global model explanation (feature importance)"""
    model_name: str
    model_version: str
    timestamp: datetime
    feature_importances: Dict[str, float]
    top_features: List[str]
    sample_count: int
    explanation_method: str
    metadata: Dict[str, Any] = field(default_factory=dict)


class ReasonCodeMapper:
    """Maps feature contributions to human-readable reason codes"""
    
    def __init__(self):
        self._reason_codes = self._initialize_reason_codes()
    
    def _initialize_reason_codes(self) -> Dict[str, Dict[str, str]]:
        """Initialize reason code mappings"""
        return {
            # Routing model reason codes
            'routing_success': {
                'bank_success_rate_1h_low': 'RC001: Bank experiencing temporary issues',
                'bank_success_rate_24h_low': 'RC002: Bank has lower than average success rate',
                'amount_high': 'RC003: Transaction amount exceeds typical range',
                'hour_of_day_off_peak': 'RC004: Transaction during off-peak hours',
                'day_of_week_weekend': 'RC005: Weekend transaction may have slower processing',
                'rail_neft': 'RC006: NEFT rail has longer settlement time',
                'account_balance_ratio_low': 'RC007: Account balance relative to amount is low',
            },
            # Fraud detection reason codes
            'fraud_detection': {
                'amount_high': 'FR001: Unusually high transaction amount',
                'velocity_high': 'FR002: High transaction frequency detected',
                'new_merchant': 'FR003: First transaction with this merchant',
                'unusual_time': 'FR004: Transaction at unusual time',
                'location_mismatch': 'FR005: Transaction location differs from usual',
                'device_new': 'FR006: Transaction from new device',
                'amount_pattern_change': 'FR007: Transaction amount differs from typical pattern',
            },
            # Credit scoring reason codes
            'credit_scoring': {
                'debt_to_income_high': 'CS001: Debt-to-income ratio above threshold',
                'credit_history_short': 'CS002: Limited credit history',
                'income_low': 'CS003: Income below typical range for requested amount',
                'employment_length_short': 'CS004: Short employment tenure',
                'recent_inquiries': 'CS005: Multiple recent credit inquiries',
                'utilization_high': 'CS006: High credit utilization',
                'payment_history_issues': 'CS007: Past payment issues on record',
            }
        }
    
    def get_reason_codes(
        self,
        model_name: str,
        feature_contributions: List[FeatureContribution],
        prediction: float,
        threshold: float = 0.5
    ) -> List[str]:
        """Generate reason codes from feature contributions"""
        reason_codes = []
        model_codes = self._reason_codes.get(model_name, {})
        
        # Sort by absolute contribution
        sorted_contributions = sorted(
            feature_contributions,
            key=lambda x: abs(x.contribution),
            reverse=True
        )
        
        for contrib in sorted_contributions[:5]:  # Top 5 contributors
            # Generate reason code key
            code_key = self._get_code_key(contrib, prediction, threshold)
            
            if code_key and code_key in model_codes:
                reason_codes.append(model_codes[code_key])
            elif contrib.description:
                reason_codes.append(contrib.description)
        
        return reason_codes
    
    def _get_code_key(
        self,
        contrib: FeatureContribution,
        prediction: float,
        threshold: float
    ) -> Optional[str]:
        """Generate code key from contribution"""
        feature = contrib.feature_name.lower()
        
        # Determine direction
        if prediction > threshold:
            # High prediction - look at positive contributors
            if contrib.contribution > 0:
                if 'amount' in feature and contrib.feature_value > 100000:
                    return 'amount_high'
                if 'velocity' in feature or 'count' in feature:
                    return 'velocity_high'
                if 'success_rate' in feature and contrib.feature_value < 0.9:
                    return f'{feature}_low'
        else:
            # Low prediction - look at negative contributors
            if contrib.contribution < 0:
                if 'debt_to_income' in feature:
                    return 'debt_to_income_high'
                if 'credit_history' in feature:
                    return 'credit_history_short'
        
        return None


class TreeModelExplainer:
    """Explainer for tree-based models (XGBoost, LightGBM, RandomForest)"""
    
    def __init__(self, model, feature_names: List[str]):
        self.model = model
        self.feature_names = feature_names
        self._global_importance = None
    
    def get_feature_importance(self) -> Dict[str, float]:
        """Get global feature importance"""
        if self._global_importance is not None:
            return self._global_importance
        
        try:
            # Try different methods based on model type
            if hasattr(self.model, 'feature_importances_'):
                importances = self.model.feature_importances_
            elif hasattr(self.model, 'get_score'):
                # XGBoost
                score = self.model.get_score(importance_type='gain')
                importances = [score.get(f'f{i}', 0) for i in range(len(self.feature_names))]
            else:
                # Default to equal importance
                importances = [1.0 / len(self.feature_names)] * len(self.feature_names)
            
            # Normalize
            total = sum(importances)
            if total > 0:
                importances = [i / total for i in importances]
            
            self._global_importance = dict(zip(self.feature_names, importances))
            return self._global_importance
        except Exception as e:
            logger.error(f"Error getting feature importance: {e}")
            return {f: 1.0 / len(self.feature_names) for f in self.feature_names}
    
    def explain_prediction(
        self,
        features: Dict[str, Any],
        prediction: float
    ) -> List[FeatureContribution]:
        """Explain a single prediction using feature importance approximation"""
        global_importance = self.get_feature_importance()
        
        contributions = []
        for i, (feature_name, importance) in enumerate(
            sorted(global_importance.items(), key=lambda x: -x[1])
        ):
            feature_value = features.get(feature_name)
            
            # Approximate contribution based on importance and value deviation
            contribution = self._estimate_contribution(
                feature_name, feature_value, importance, prediction
            )
            
            contributions.append(FeatureContribution(
                feature_name=feature_name,
                feature_value=feature_value,
                contribution=contribution,
                importance_rank=i + 1,
                description=self._get_feature_description(feature_name, feature_value)
            ))
        
        return contributions
    
    def _estimate_contribution(
        self,
        feature_name: str,
        feature_value: Any,
        importance: float,
        prediction: float
    ) -> float:
        """Estimate feature contribution (simplified SHAP approximation)"""
        # This is a simplified approximation
        # In production, use actual SHAP values
        base_contribution = importance * (prediction - 0.5) * 2
        
        # Adjust based on feature value characteristics
        if isinstance(feature_value, (int, float)):
            # Numeric features
            if feature_value > 0:
                return base_contribution
            else:
                return -base_contribution * 0.5
        
        return base_contribution
    
    def _get_feature_description(
        self,
        feature_name: str,
        feature_value: Any
    ) -> str:
        """Generate human-readable description"""
        descriptions = {
            'amount': f'Transaction amount: {feature_value:,.2f}' if isinstance(feature_value, (int, float)) else f'Amount: {feature_value}',
            'bank_success_rate_1h': f'Bank success rate (1h): {feature_value:.1%}' if isinstance(feature_value, float) else '',
            'bank_success_rate_24h': f'Bank success rate (24h): {feature_value:.1%}' if isinstance(feature_value, float) else '',
            'hour_of_day': f'Hour of day: {feature_value}',
            'day_of_week': f'Day of week: {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][feature_value]}' if isinstance(feature_value, int) and 0 <= feature_value <= 6 else '',
            'debt_to_income': f'Debt-to-income ratio: {feature_value:.2f}' if isinstance(feature_value, float) else '',
            'credit_history_length': f'Credit history: {feature_value} years' if isinstance(feature_value, (int, float)) else '',
        }
        
        for key, desc in descriptions.items():
            if key in feature_name.lower():
                return desc
        
        return f'{feature_name}: {feature_value}'


class ExplainabilityService:
    """Main explainability service"""
    
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        self.reason_mapper = ReasonCodeMapper()
        self._explainers: Dict[str, TreeModelExplainer] = {}
        self._global_explanations: Dict[str, GlobalExplanation] = {}
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
        self.db_pool = await asyncpg.create_pool(DB_URL, min_size=5, max_size=20)
        
        # Initialize database schema
        await self._init_schema()
        
        logger.info("Explainability Service initialized")
    
    async def _init_schema(self):
        """Initialize database schema"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_explanations (
                    id SERIAL PRIMARY KEY,
                    model_name VARCHAR(255) NOT NULL,
                    model_version VARCHAR(100),
                    request_id VARCHAR(64) NOT NULL,
                    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
                    prediction FLOAT,
                    explanation_type VARCHAR(50),
                    feature_contributions JSONB,
                    reason_codes JSONB,
                    summary TEXT,
                    confidence FLOAT,
                    metadata JSONB DEFAULT '{}'
                );
                
                CREATE INDEX IF NOT EXISTS idx_explanations_request 
                ON ml_explanations(request_id);
                
                CREATE INDEX IF NOT EXISTS idx_explanations_model_time 
                ON ml_explanations(model_name, timestamp DESC);
            """)
    
    def register_explainer(
        self,
        model_name: str,
        model: Any,
        feature_names: List[str]
    ):
        """Register a model explainer"""
        self._explainers[model_name] = TreeModelExplainer(model, feature_names)
    
    async def explain_prediction(
        self,
        model_name: str,
        model_version: str,
        request_id: str,
        features: Dict[str, Any],
        prediction: float,
        store: bool = True
    ) -> ModelExplanation:
        """Generate explanation for a prediction"""
        explainer = self._explainers.get(model_name)
        
        if explainer:
            # Use model-specific explainer
            contributions = explainer.explain_prediction(features, prediction)
            explanation_type = ExplanationType.FEATURE_IMPORTANCE
        else:
            # Use generic feature-based explanation
            contributions = self._generic_explanation(features, prediction)
            explanation_type = ExplanationType.RULE_BASED
        
        # Generate reason codes
        reason_codes = self.reason_mapper.get_reason_codes(
            model_name, contributions, prediction
        )
        
        # Generate summary
        summary = self._generate_summary(model_name, prediction, contributions, reason_codes)
        
        explanation = ModelExplanation(
            model_name=model_name,
            model_version=model_version,
            request_id=request_id,
            timestamp=datetime.utcnow(),
            prediction=prediction,
            explanation_type=explanation_type,
            feature_contributions=contributions,
            reason_codes=reason_codes,
            summary=summary,
            confidence=0.8 if explainer else 0.5
        )
        
        # Store explanation
        if store:
            await self._store_explanation(explanation)
        
        return explanation
    
    def _generic_explanation(
        self,
        features: Dict[str, Any],
        prediction: float
    ) -> List[FeatureContribution]:
        """Generate generic explanation based on feature values"""
        contributions = []
        
        for i, (name, value) in enumerate(features.items()):
            if isinstance(value, (int, float)):
                # Simple heuristic: higher values contribute more to higher predictions
                contribution = (value / 1000) * (prediction - 0.5) if value != 0 else 0
            else:
                contribution = 0
            
            contributions.append(FeatureContribution(
                feature_name=name,
                feature_value=value,
                contribution=contribution,
                importance_rank=i + 1,
                description=f'{name}: {value}'
            ))
        
        # Sort by absolute contribution
        contributions.sort(key=lambda x: abs(x.contribution), reverse=True)
        for i, c in enumerate(contributions):
            c.importance_rank = i + 1
        
        return contributions
    
    def _generate_summary(
        self,
        model_name: str,
        prediction: float,
        contributions: List[FeatureContribution],
        reason_codes: List[str]
    ) -> str:
        """Generate human-readable summary"""
        top_features = contributions[:3]
        
        if model_name == 'routing_success':
            if prediction > 0.9:
                summary = f"High likelihood of successful routing ({prediction:.1%}). "
            elif prediction > 0.7:
                summary = f"Moderate likelihood of successful routing ({prediction:.1%}). "
            else:
                summary = f"Lower likelihood of successful routing ({prediction:.1%}). "
            
            summary += f"Key factors: {', '.join(c.feature_name for c in top_features)}."
            
        elif model_name == 'fraud_detection':
            if prediction > 0.7:
                summary = f"High fraud risk detected ({prediction:.1%}). "
            elif prediction > 0.3:
                summary = f"Moderate fraud risk ({prediction:.1%}). "
            else:
                summary = f"Low fraud risk ({prediction:.1%}). "
            
            if reason_codes:
                summary += f"Reasons: {'; '.join(reason_codes[:3])}."
            
        elif model_name == 'credit_scoring':
            summary = f"Credit score assessment. "
            if reason_codes:
                summary += f"Key factors affecting score: {'; '.join(reason_codes[:3])}."
        
        else:
            summary = f"Prediction: {prediction:.3f}. Top contributing features: {', '.join(c.feature_name for c in top_features)}."
        
        return summary
    
    async def _store_explanation(self, explanation: ModelExplanation):
        """Store explanation in database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ml_explanations (
                    model_name, model_version, request_id, timestamp,
                    prediction, explanation_type, feature_contributions,
                    reason_codes, summary, confidence, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """, 
                explanation.model_name, explanation.model_version,
                explanation.request_id, explanation.timestamp,
                explanation.prediction, explanation.explanation_type.value,
                json.dumps([asdict(c) for c in explanation.feature_contributions]),
                json.dumps(explanation.reason_codes),
                explanation.summary, explanation.confidence,
                json.dumps(explanation.metadata)
            )
        
        # Also cache in Redis for quick access
        cache_key = f"ml:explanation:{explanation.request_id}"
        await self.redis.setex(
            cache_key, 86400,
            json.dumps(asdict(explanation), default=str)
        )
    
    async def get_explanation(self, request_id: str) -> Optional[ModelExplanation]:
        """Retrieve explanation by request ID"""
        # Try cache first
        cache_key = f"ml:explanation:{request_id}"
        cached = await self.redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            return self._dict_to_explanation(data)
        
        # Fetch from database
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM ml_explanations WHERE request_id = $1
            """, request_id)
        
        if not row:
            return None
        
        return self._row_to_explanation(row)
    
    async def get_global_explanation(
        self,
        model_name: str
    ) -> Optional[GlobalExplanation]:
        """Get global feature importance for a model"""
        explainer = self._explainers.get(model_name)
        if not explainer:
            return None
        
        importances = explainer.get_feature_importance()
        top_features = sorted(importances.keys(), key=lambda x: -importances[x])[:10]
        
        return GlobalExplanation(
            model_name=model_name,
            model_version="current",
            timestamp=datetime.utcnow(),
            feature_importances=importances,
            top_features=top_features,
            sample_count=0,
            explanation_method="tree_importance"
        )
    
    async def get_adverse_action_notice(
        self,
        model_name: str,
        request_id: str,
        customer_name: str = "Customer"
    ) -> str:
        """Generate adverse action notice for regulatory compliance"""
        explanation = await self.get_explanation(request_id)
        if not explanation:
            return "Explanation not available."
        
        notice = f"""
ADVERSE ACTION NOTICE

Date: {datetime.utcnow().strftime('%Y-%m-%d')}
Reference: {request_id}

Dear {customer_name},

We have reviewed your application and regret to inform you that we are unable to approve your request at this time.

PRINCIPAL REASONS FOR THIS DECISION:
"""
        
        for i, reason in enumerate(explanation.reason_codes[:4], 1):
            notice += f"\n{i}. {reason}"
        
        notice += """

YOUR RIGHTS:
You have the right to obtain a free copy of your credit report from the credit reporting agency used in this decision. You also have the right to dispute the accuracy of information in your credit report.

If you have any questions regarding this notice, please contact our customer service department.

Sincerely,
Remittance Platform
"""
        
        return notice
    
    def _dict_to_explanation(self, data: Dict) -> ModelExplanation:
        """Convert dict to ModelExplanation"""
        return ModelExplanation(
            model_name=data['model_name'],
            model_version=data['model_version'],
            request_id=data['request_id'],
            timestamp=datetime.fromisoformat(data['timestamp']) if isinstance(data['timestamp'], str) else data['timestamp'],
            prediction=data['prediction'],
            explanation_type=ExplanationType(data['explanation_type']),
            feature_contributions=[
                FeatureContribution(**c) for c in data['feature_contributions']
            ],
            reason_codes=data['reason_codes'],
            summary=data['summary'],
            confidence=data['confidence'],
            metadata=data.get('metadata', {})
        )
    
    def _row_to_explanation(self, row) -> ModelExplanation:
        """Convert database row to ModelExplanation"""
        return ModelExplanation(
            model_name=row['model_name'],
            model_version=row['model_version'],
            request_id=row['request_id'],
            timestamp=row['timestamp'],
            prediction=row['prediction'],
            explanation_type=ExplanationType(row['explanation_type']),
            feature_contributions=[
                FeatureContribution(**c) for c in json.loads(row['feature_contributions'])
            ],
            reason_codes=json.loads(row['reason_codes']),
            summary=row['summary'],
            confidence=row['confidence'],
            metadata=json.loads(row['metadata']) if row['metadata'] else {}
        )


# Export classes
__all__ = [
    'ExplainabilityService',
    'ModelExplanation',
    'GlobalExplanation',
    'FeatureContribution',
    'ExplanationType',
    'ReasonCodeMapper',
    'TreeModelExplainer'
]
