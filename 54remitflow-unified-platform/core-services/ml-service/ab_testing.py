"""
A/B Testing Infrastructure - Model comparison and traffic splitting
Provides controlled experiments for comparing model versions in production

Features:
- Traffic splitting between model versions
- Statistical significance testing
- Experiment lifecycle management
- Real-time metrics collection
- Automatic winner selection
- Gradual rollout support
"""

import os
import json
import logging
import hashlib
import random
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict, field
from enum import Enum
import asyncio
from collections import defaultdict

logger = logging.getLogger(__name__)

# Configuration
AB_TEST_STORAGE_PATH = os.getenv("AB_TEST_STORAGE_PATH", "/tmp/ml_ab_tests")
MIN_SAMPLES_FOR_SIGNIFICANCE = int(os.getenv("MIN_SAMPLES_FOR_SIGNIFICANCE", "100"))
SIGNIFICANCE_LEVEL = float(os.getenv("SIGNIFICANCE_LEVEL", "0.05"))

# Try to import scipy for statistical tests
try:
    from scipy import stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    logger.info("SciPy not available, using simplified statistical tests")

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False


class ExperimentStatus(str, Enum):
    DRAFT = "draft"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class TrafficSplitStrategy(str, Enum):
    RANDOM = "random"  # Random assignment
    HASH_BASED = "hash_based"  # Consistent assignment based on user ID
    GRADUAL_ROLLOUT = "gradual_rollout"  # Gradually increase traffic to challenger
    MULTI_ARMED_BANDIT = "multi_armed_bandit"  # Dynamic allocation based on performance


class WinnerCriteria(str, Enum):
    HIGHER_IS_BETTER = "higher_is_better"  # e.g., accuracy, AUC
    LOWER_IS_BETTER = "lower_is_better"  # e.g., latency, error rate


@dataclass
class ModelVariant:
    """A model variant in an A/B test"""
    variant_id: str
    model_name: str
    model_version: str
    traffic_percentage: float
    is_control: bool = False
    description: str = ""


@dataclass
class ExperimentMetrics:
    """Metrics collected during an experiment"""
    variant_id: str
    total_predictions: int = 0
    total_latency_ms: float = 0.0
    predictions_by_outcome: Dict[str, int] = field(default_factory=dict)
    metric_values: Dict[str, List[float]] = field(default_factory=lambda: defaultdict(list))
    errors: int = 0
    
    @property
    def avg_latency_ms(self) -> float:
        if self.total_predictions == 0:
            return 0.0
        return self.total_latency_ms / self.total_predictions
    
    @property
    def error_rate(self) -> float:
        if self.total_predictions == 0:
            return 0.0
        return self.errors / self.total_predictions
    
    def get_metric_mean(self, metric_name: str) -> float:
        values = self.metric_values.get(metric_name, [])
        if not values:
            return 0.0
        return sum(values) / len(values)
    
    def get_metric_std(self, metric_name: str) -> float:
        values = self.metric_values.get(metric_name, [])
        if len(values) < 2:
            return 0.0
        mean = self.get_metric_mean(metric_name)
        variance = sum((x - mean) ** 2 for x in values) / (len(values) - 1)
        return variance ** 0.5
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "variant_id": self.variant_id,
            "total_predictions": self.total_predictions,
            "total_latency_ms": self.total_latency_ms,
            "avg_latency_ms": self.avg_latency_ms,
            "predictions_by_outcome": dict(self.predictions_by_outcome),
            "metric_values": {k: list(v) for k, v in self.metric_values.items()},
            "errors": self.errors,
            "error_rate": self.error_rate
        }


@dataclass
class StatisticalResult:
    """Result of statistical significance test"""
    is_significant: bool
    p_value: float
    confidence_level: float
    effect_size: float
    sample_size_control: int
    sample_size_treatment: int
    test_type: str
    recommendation: str


@dataclass
class ABExperiment:
    """An A/B testing experiment"""
    experiment_id: str
    experiment_name: str
    description: str
    status: ExperimentStatus
    variants: List[ModelVariant]
    primary_metric: str
    winner_criteria: WinnerCriteria
    traffic_split_strategy: TrafficSplitStrategy
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    min_samples_per_variant: int = 100
    max_duration_hours: int = 168  # 1 week
    auto_stop_on_significance: bool = True
    tags: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "experiment_name": self.experiment_name,
            "description": self.description,
            "status": self.status.value,
            "variants": [asdict(v) for v in self.variants],
            "primary_metric": self.primary_metric,
            "winner_criteria": self.winner_criteria.value,
            "traffic_split_strategy": self.traffic_split_strategy.value,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "min_samples_per_variant": self.min_samples_per_variant,
            "max_duration_hours": self.max_duration_hours,
            "auto_stop_on_significance": self.auto_stop_on_significance,
            "tags": self.tags
        }


@dataclass
class ExperimentResult:
    """Final result of an A/B experiment"""
    experiment_id: str
    experiment_name: str
    winner_variant_id: Optional[str]
    winner_model_name: Optional[str]
    winner_model_version: Optional[str]
    statistical_result: Optional[StatisticalResult]
    variant_metrics: Dict[str, Dict[str, Any]]
    duration_hours: float
    total_predictions: int
    recommendation: str
    confidence: float


class StatisticalTests:
    """Statistical tests for A/B experiment analysis"""
    
    @staticmethod
    def two_sample_t_test(
        control_values: List[float],
        treatment_values: List[float]
    ) -> Tuple[float, float]:
        """Perform two-sample t-test"""
        if SCIPY_AVAILABLE:
            statistic, p_value = stats.ttest_ind(control_values, treatment_values)
            return float(statistic), float(p_value)
        else:
            # Simplified t-test without scipy
            n1, n2 = len(control_values), len(treatment_values)
            if n1 < 2 or n2 < 2:
                return 0.0, 1.0
            
            mean1 = sum(control_values) / n1
            mean2 = sum(treatment_values) / n2
            
            var1 = sum((x - mean1) ** 2 for x in control_values) / (n1 - 1)
            var2 = sum((x - mean2) ** 2 for x in treatment_values) / (n2 - 1)
            
            se = ((var1 / n1) + (var2 / n2)) ** 0.5
            if se == 0:
                return 0.0, 1.0
            
            t_stat = (mean2 - mean1) / se
            
            # Approximate p-value (simplified)
            df = n1 + n2 - 2
            p_value = 2 * (1 - min(0.9999, abs(t_stat) / (df ** 0.5)))
            
            return t_stat, max(0.0001, p_value)
    
    @staticmethod
    def chi_squared_test(
        control_outcomes: Dict[str, int],
        treatment_outcomes: Dict[str, int]
    ) -> Tuple[float, float]:
        """Perform chi-squared test for categorical outcomes"""
        if SCIPY_AVAILABLE:
            all_outcomes = set(control_outcomes.keys()) | set(treatment_outcomes.keys())
            observed = []
            for outcome in all_outcomes:
                observed.append([
                    control_outcomes.get(outcome, 0),
                    treatment_outcomes.get(outcome, 0)
                ])
            
            if len(observed) < 2:
                return 0.0, 1.0
            
            chi2, p_value, dof, expected = stats.chi2_contingency(observed)
            return float(chi2), float(p_value)
        else:
            # Simplified chi-squared without scipy
            return 0.0, 1.0
    
    @staticmethod
    def calculate_effect_size(
        control_values: List[float],
        treatment_values: List[float]
    ) -> float:
        """Calculate Cohen's d effect size"""
        if not control_values or not treatment_values:
            return 0.0
        
        n1, n2 = len(control_values), len(treatment_values)
        mean1 = sum(control_values) / n1
        mean2 = sum(treatment_values) / n2
        
        if n1 < 2 or n2 < 2:
            return 0.0
        
        var1 = sum((x - mean1) ** 2 for x in control_values) / (n1 - 1)
        var2 = sum((x - mean2) ** 2 for x in treatment_values) / (n2 - 1)
        
        pooled_std = (((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2)) ** 0.5
        
        if pooled_std == 0:
            return 0.0
        
        return (mean2 - mean1) / pooled_std
    
    @staticmethod
    def calculate_sample_size(
        baseline_rate: float,
        minimum_detectable_effect: float,
        significance_level: float = 0.05,
        power: float = 0.8
    ) -> int:
        """Calculate required sample size for experiment"""
        if SCIPY_AVAILABLE:
            from scipy.stats import norm
            
            alpha = significance_level
            beta = 1 - power
            
            z_alpha = norm.ppf(1 - alpha / 2)
            z_beta = norm.ppf(power)
            
            p1 = baseline_rate
            p2 = baseline_rate * (1 + minimum_detectable_effect)
            
            p_bar = (p1 + p2) / 2
            
            n = (2 * p_bar * (1 - p_bar) * (z_alpha + z_beta) ** 2) / ((p2 - p1) ** 2)
            
            return int(n) + 1
        else:
            # Simplified calculation
            return int(16 * (baseline_rate * (1 - baseline_rate)) / (minimum_detectable_effect ** 2)) + 1


class ABTestingManager:
    """Manager for A/B testing experiments"""
    
    def __init__(self, storage_path: str = None):
        self.storage_path = storage_path or AB_TEST_STORAGE_PATH
        os.makedirs(self.storage_path, exist_ok=True)
        
        self._experiments: Dict[str, ABExperiment] = {}
        self._metrics: Dict[str, Dict[str, ExperimentMetrics]] = {}  # experiment_id -> variant_id -> metrics
        self._load_state()
        
        logger.info(f"A/B Testing Manager initialized at {self.storage_path}")
    
    def _load_state(self):
        """Load state from disk"""
        state_file = os.path.join(self.storage_path, "ab_tests.json")
        if os.path.exists(state_file):
            try:
                with open(state_file, "r") as f:
                    data = json.load(f)
                    
                    for exp_id, exp_data in data.get("experiments", {}).items():
                        variants = [
                            ModelVariant(**v) for v in exp_data["variants"]
                        ]
                        self._experiments[exp_id] = ABExperiment(
                            experiment_id=exp_data["experiment_id"],
                            experiment_name=exp_data["experiment_name"],
                            description=exp_data["description"],
                            status=ExperimentStatus(exp_data["status"]),
                            variants=variants,
                            primary_metric=exp_data["primary_metric"],
                            winner_criteria=WinnerCriteria(exp_data["winner_criteria"]),
                            traffic_split_strategy=TrafficSplitStrategy(exp_data["traffic_split_strategy"]),
                            start_time=datetime.fromisoformat(exp_data["start_time"]) if exp_data.get("start_time") else None,
                            end_time=datetime.fromisoformat(exp_data["end_time"]) if exp_data.get("end_time") else None,
                            created_at=datetime.fromisoformat(exp_data["created_at"]),
                            updated_at=datetime.fromisoformat(exp_data["updated_at"]),
                            min_samples_per_variant=exp_data.get("min_samples_per_variant", 100),
                            max_duration_hours=exp_data.get("max_duration_hours", 168),
                            auto_stop_on_significance=exp_data.get("auto_stop_on_significance", True),
                            tags=exp_data.get("tags", {})
                        )
                    
                    for exp_id, variants_data in data.get("metrics", {}).items():
                        self._metrics[exp_id] = {}
                        for variant_id, metrics_data in variants_data.items():
                            self._metrics[exp_id][variant_id] = ExperimentMetrics(
                                variant_id=variant_id,
                                total_predictions=metrics_data.get("total_predictions", 0),
                                total_latency_ms=metrics_data.get("total_latency_ms", 0.0),
                                predictions_by_outcome=metrics_data.get("predictions_by_outcome", {}),
                                metric_values=defaultdict(list, metrics_data.get("metric_values", {})),
                                errors=metrics_data.get("errors", 0)
                            )
            except Exception as e:
                logger.error(f"Failed to load A/B test state: {e}")
    
    def _save_state(self):
        """Save state to disk"""
        state_file = os.path.join(self.storage_path, "ab_tests.json")
        
        data = {
            "experiments": {
                exp_id: exp.to_dict() for exp_id, exp in self._experiments.items()
            },
            "metrics": {
                exp_id: {
                    variant_id: metrics.to_dict()
                    for variant_id, metrics in variants.items()
                }
                for exp_id, variants in self._metrics.items()
            }
        }
        
        with open(state_file, "w") as f:
            json.dump(data, f, indent=2)
    
    def create_experiment(
        self,
        experiment_name: str,
        description: str,
        control_model_name: str,
        control_model_version: str,
        challenger_model_name: str,
        challenger_model_version: str,
        primary_metric: str = "accuracy",
        winner_criteria: WinnerCriteria = WinnerCriteria.HIGHER_IS_BETTER,
        traffic_split_strategy: TrafficSplitStrategy = TrafficSplitStrategy.HASH_BASED,
        control_traffic_pct: float = 50.0,
        min_samples_per_variant: int = 100,
        max_duration_hours: int = 168,
        auto_stop_on_significance: bool = True,
        tags: Dict[str, str] = None
    ) -> ABExperiment:
        """Create a new A/B testing experiment"""
        
        experiment_id = hashlib.md5(
            f"{experiment_name}_{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:12]
        
        # Create variants
        control_variant = ModelVariant(
            variant_id="control",
            model_name=control_model_name,
            model_version=control_model_version,
            traffic_percentage=control_traffic_pct,
            is_control=True,
            description="Control variant (current production model)"
        )
        
        challenger_variant = ModelVariant(
            variant_id="challenger",
            model_name=challenger_model_name,
            model_version=challenger_model_version,
            traffic_percentage=100.0 - control_traffic_pct,
            is_control=False,
            description="Challenger variant (new model being tested)"
        )
        
        now = datetime.utcnow()
        experiment = ABExperiment(
            experiment_id=experiment_id,
            experiment_name=experiment_name,
            description=description,
            status=ExperimentStatus.DRAFT,
            variants=[control_variant, challenger_variant],
            primary_metric=primary_metric,
            winner_criteria=winner_criteria,
            traffic_split_strategy=traffic_split_strategy,
            start_time=None,
            end_time=None,
            created_at=now,
            updated_at=now,
            min_samples_per_variant=min_samples_per_variant,
            max_duration_hours=max_duration_hours,
            auto_stop_on_significance=auto_stop_on_significance,
            tags=tags or {}
        )
        
        self._experiments[experiment_id] = experiment
        self._metrics[experiment_id] = {
            "control": ExperimentMetrics(variant_id="control"),
            "challenger": ExperimentMetrics(variant_id="challenger")
        }
        self._save_state()
        
        logger.info(f"Created A/B experiment {experiment_id}: {experiment_name}")
        return experiment
    
    def start_experiment(self, experiment_id: str) -> bool:
        """Start an experiment"""
        if experiment_id not in self._experiments:
            return False
        
        experiment = self._experiments[experiment_id]
        if experiment.status != ExperimentStatus.DRAFT:
            return False
        
        experiment.status = ExperimentStatus.RUNNING
        experiment.start_time = datetime.utcnow()
        experiment.updated_at = datetime.utcnow()
        self._save_state()
        
        logger.info(f"Started A/B experiment {experiment_id}")
        return True
    
    def pause_experiment(self, experiment_id: str) -> bool:
        """Pause an experiment"""
        if experiment_id not in self._experiments:
            return False
        
        experiment = self._experiments[experiment_id]
        if experiment.status != ExperimentStatus.RUNNING:
            return False
        
        experiment.status = ExperimentStatus.PAUSED
        experiment.updated_at = datetime.utcnow()
        self._save_state()
        
        logger.info(f"Paused A/B experiment {experiment_id}")
        return True
    
    def resume_experiment(self, experiment_id: str) -> bool:
        """Resume a paused experiment"""
        if experiment_id not in self._experiments:
            return False
        
        experiment = self._experiments[experiment_id]
        if experiment.status != ExperimentStatus.PAUSED:
            return False
        
        experiment.status = ExperimentStatus.RUNNING
        experiment.updated_at = datetime.utcnow()
        self._save_state()
        
        logger.info(f"Resumed A/B experiment {experiment_id}")
        return True
    
    def stop_experiment(self, experiment_id: str) -> Optional[ExperimentResult]:
        """Stop an experiment and determine winner"""
        if experiment_id not in self._experiments:
            return None
        
        experiment = self._experiments[experiment_id]
        experiment.status = ExperimentStatus.COMPLETED
        experiment.end_time = datetime.utcnow()
        experiment.updated_at = datetime.utcnow()
        
        result = self._analyze_experiment(experiment_id)
        self._save_state()
        
        logger.info(f"Stopped A/B experiment {experiment_id}")
        return result
    
    def get_variant_for_user(
        self,
        experiment_id: str,
        user_id: str
    ) -> Optional[ModelVariant]:
        """Get the variant assignment for a user"""
        if experiment_id not in self._experiments:
            return None
        
        experiment = self._experiments[experiment_id]
        if experiment.status != ExperimentStatus.RUNNING:
            return None
        
        # Determine variant based on traffic split strategy
        if experiment.traffic_split_strategy == TrafficSplitStrategy.HASH_BASED:
            # Consistent assignment based on user ID hash
            hash_value = int(hashlib.md5(f"{experiment_id}_{user_id}".encode()).hexdigest(), 16)
            bucket = hash_value % 100
            
            cumulative = 0.0
            for variant in experiment.variants:
                cumulative += variant.traffic_percentage
                if bucket < cumulative:
                    return variant
            
            return experiment.variants[-1]
        
        elif experiment.traffic_split_strategy == TrafficSplitStrategy.RANDOM:
            # Random assignment
            rand_value = random.random() * 100
            
            cumulative = 0.0
            for variant in experiment.variants:
                cumulative += variant.traffic_percentage
                if rand_value < cumulative:
                    return variant
            
            return experiment.variants[-1]
        
        elif experiment.traffic_split_strategy == TrafficSplitStrategy.GRADUAL_ROLLOUT:
            # Gradually increase challenger traffic over time
            if experiment.start_time:
                hours_running = (datetime.utcnow() - experiment.start_time).total_seconds() / 3600
                rollout_pct = min(50.0, hours_running * 2)  # 2% per hour up to 50%
                
                hash_value = int(hashlib.md5(f"{experiment_id}_{user_id}".encode()).hexdigest(), 16)
                bucket = hash_value % 100
                
                if bucket < rollout_pct:
                    return next((v for v in experiment.variants if not v.is_control), experiment.variants[0])
                else:
                    return next((v for v in experiment.variants if v.is_control), experiment.variants[0])
            
            return experiment.variants[0]
        
        elif experiment.traffic_split_strategy == TrafficSplitStrategy.MULTI_ARMED_BANDIT:
            # Dynamic allocation based on performance (Thompson Sampling)
            metrics = self._metrics.get(experiment_id, {})
            
            # Calculate success rates for each variant
            success_rates = {}
            for variant in experiment.variants:
                variant_metrics = metrics.get(variant.variant_id)
                if variant_metrics and variant_metrics.total_predictions > 0:
                    # Use primary metric as success rate
                    success_rates[variant.variant_id] = variant_metrics.get_metric_mean(experiment.primary_metric)
                else:
                    success_rates[variant.variant_id] = 0.5  # Prior
            
            # Thompson Sampling: sample from beta distribution
            if NUMPY_AVAILABLE:
                import numpy as np
                samples = {}
                for variant_id, rate in success_rates.items():
                    # Convert rate to alpha/beta for beta distribution
                    alpha = max(1, rate * 10)
                    beta = max(1, (1 - rate) * 10)
                    samples[variant_id] = np.random.beta(alpha, beta)
                
                best_variant_id = max(samples, key=samples.get)
                return next((v for v in experiment.variants if v.variant_id == best_variant_id), experiment.variants[0])
            else:
                # Fallback to random
                return random.choice(experiment.variants)
        
        return experiment.variants[0]
    
    def record_prediction(
        self,
        experiment_id: str,
        variant_id: str,
        outcome: str,
        latency_ms: float,
        metrics: Dict[str, float] = None,
        is_error: bool = False
    ):
        """Record a prediction result for an experiment"""
        if experiment_id not in self._metrics:
            return
        
        if variant_id not in self._metrics[experiment_id]:
            return
        
        variant_metrics = self._metrics[experiment_id][variant_id]
        variant_metrics.total_predictions += 1
        variant_metrics.total_latency_ms += latency_ms
        
        if outcome:
            variant_metrics.predictions_by_outcome[outcome] = \
                variant_metrics.predictions_by_outcome.get(outcome, 0) + 1
        
        if metrics:
            for metric_name, value in metrics.items():
                variant_metrics.metric_values[metric_name].append(value)
        
        if is_error:
            variant_metrics.errors += 1
        
        # Check for auto-stop conditions
        experiment = self._experiments.get(experiment_id)
        if experiment and experiment.auto_stop_on_significance:
            self._check_auto_stop(experiment_id)
        
        # Periodically save state
        if variant_metrics.total_predictions % 100 == 0:
            self._save_state()
    
    def _check_auto_stop(self, experiment_id: str):
        """Check if experiment should auto-stop"""
        experiment = self._experiments.get(experiment_id)
        if not experiment or experiment.status != ExperimentStatus.RUNNING:
            return
        
        metrics = self._metrics.get(experiment_id, {})
        
        # Check minimum samples
        min_samples_met = all(
            m.total_predictions >= experiment.min_samples_per_variant
            for m in metrics.values()
        )
        
        if not min_samples_met:
            return
        
        # Check statistical significance
        result = self._analyze_experiment(experiment_id)
        if result and result.statistical_result and result.statistical_result.is_significant:
            logger.info(f"Experiment {experiment_id} reached statistical significance, auto-stopping")
            self.stop_experiment(experiment_id)
        
        # Check max duration
        if experiment.start_time:
            hours_running = (datetime.utcnow() - experiment.start_time).total_seconds() / 3600
            if hours_running >= experiment.max_duration_hours:
                logger.info(f"Experiment {experiment_id} reached max duration, auto-stopping")
                self.stop_experiment(experiment_id)
    
    def _analyze_experiment(self, experiment_id: str) -> Optional[ExperimentResult]:
        """Analyze experiment results and determine winner"""
        experiment = self._experiments.get(experiment_id)
        if not experiment:
            return None
        
        metrics = self._metrics.get(experiment_id, {})
        
        # Get control and challenger metrics
        control_metrics = metrics.get("control")
        challenger_metrics = metrics.get("challenger")
        
        if not control_metrics or not challenger_metrics:
            return None
        
        # Get primary metric values
        control_values = list(control_metrics.metric_values.get(experiment.primary_metric, []))
        challenger_values = list(challenger_metrics.metric_values.get(experiment.primary_metric, []))
        
        # Perform statistical test
        statistical_result = None
        if len(control_values) >= MIN_SAMPLES_FOR_SIGNIFICANCE and len(challenger_values) >= MIN_SAMPLES_FOR_SIGNIFICANCE:
            t_stat, p_value = StatisticalTests.two_sample_t_test(control_values, challenger_values)
            effect_size = StatisticalTests.calculate_effect_size(control_values, challenger_values)
            
            is_significant = p_value < SIGNIFICANCE_LEVEL
            
            # Determine recommendation
            control_mean = sum(control_values) / len(control_values) if control_values else 0
            challenger_mean = sum(challenger_values) / len(challenger_values) if challenger_values else 0
            
            if experiment.winner_criteria == WinnerCriteria.HIGHER_IS_BETTER:
                challenger_is_better = challenger_mean > control_mean
            else:
                challenger_is_better = challenger_mean < control_mean
            
            if is_significant and challenger_is_better:
                recommendation = "Deploy challenger model - statistically significant improvement"
            elif is_significant and not challenger_is_better:
                recommendation = "Keep control model - challenger performed worse"
            else:
                recommendation = "Inconclusive - continue experiment or increase sample size"
            
            statistical_result = StatisticalResult(
                is_significant=is_significant,
                p_value=p_value,
                confidence_level=1 - p_value,
                effect_size=effect_size,
                sample_size_control=len(control_values),
                sample_size_treatment=len(challenger_values),
                test_type="two_sample_t_test",
                recommendation=recommendation
            )
        
        # Determine winner
        winner_variant_id = None
        winner_model_name = None
        winner_model_version = None
        confidence = 0.0
        
        if statistical_result and statistical_result.is_significant:
            control_mean = sum(control_values) / len(control_values) if control_values else 0
            challenger_mean = sum(challenger_values) / len(challenger_values) if challenger_values else 0
            
            if experiment.winner_criteria == WinnerCriteria.HIGHER_IS_BETTER:
                if challenger_mean > control_mean:
                    winner_variant_id = "challenger"
                else:
                    winner_variant_id = "control"
            else:
                if challenger_mean < control_mean:
                    winner_variant_id = "challenger"
                else:
                    winner_variant_id = "control"
            
            winner_variant = next((v for v in experiment.variants if v.variant_id == winner_variant_id), None)
            if winner_variant:
                winner_model_name = winner_variant.model_name
                winner_model_version = winner_variant.model_version
            
            confidence = statistical_result.confidence_level
        
        # Calculate duration
        duration_hours = 0.0
        if experiment.start_time:
            end = experiment.end_time or datetime.utcnow()
            duration_hours = (end - experiment.start_time).total_seconds() / 3600
        
        # Build variant metrics summary
        variant_metrics_summary = {}
        for variant_id, vm in metrics.items():
            variant_metrics_summary[variant_id] = {
                "total_predictions": vm.total_predictions,
                "avg_latency_ms": vm.avg_latency_ms,
                "error_rate": vm.error_rate,
                "primary_metric_mean": vm.get_metric_mean(experiment.primary_metric),
                "primary_metric_std": vm.get_metric_std(experiment.primary_metric)
            }
        
        recommendation = statistical_result.recommendation if statistical_result else "Insufficient data for analysis"
        
        return ExperimentResult(
            experiment_id=experiment_id,
            experiment_name=experiment.experiment_name,
            winner_variant_id=winner_variant_id,
            winner_model_name=winner_model_name,
            winner_model_version=winner_model_version,
            statistical_result=statistical_result,
            variant_metrics=variant_metrics_summary,
            duration_hours=duration_hours,
            total_predictions=sum(m.total_predictions for m in metrics.values()),
            recommendation=recommendation,
            confidence=confidence
        )
    
    def get_experiment(self, experiment_id: str) -> Optional[ABExperiment]:
        """Get an experiment by ID"""
        return self._experiments.get(experiment_id)
    
    def list_experiments(self, status: ExperimentStatus = None) -> List[ABExperiment]:
        """List all experiments, optionally filtered by status"""
        experiments = list(self._experiments.values())
        if status:
            experiments = [e for e in experiments if e.status == status]
        return sorted(experiments, key=lambda e: e.created_at, reverse=True)
    
    def get_experiment_metrics(self, experiment_id: str) -> Dict[str, ExperimentMetrics]:
        """Get metrics for an experiment"""
        return self._metrics.get(experiment_id, {})
    
    def get_experiment_result(self, experiment_id: str) -> Optional[ExperimentResult]:
        """Get the result analysis for an experiment"""
        return self._analyze_experiment(experiment_id)


# Global instance
_ab_manager = None


def get_ab_testing_manager() -> ABTestingManager:
    """Get the global A/B testing manager instance"""
    global _ab_manager
    if _ab_manager is None:
        _ab_manager = ABTestingManager()
    return _ab_manager
