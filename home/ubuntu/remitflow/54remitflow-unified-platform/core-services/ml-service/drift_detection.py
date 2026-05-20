"""
Model Drift Detection and Monitoring
Detects data drift, concept drift, and model performance degradation

Features:
- Statistical drift detection (KS test, PSI, Chi-squared)
- Feature distribution monitoring
- Prediction distribution monitoring
- Performance metric tracking
- Automated alerting
"""

import os
import json
import logging
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from enum import Enum
from collections import defaultdict

logger = logging.getLogger(__name__)

# Try to import numpy for statistical calculations
try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    logger.warning("NumPy not available for drift detection")

try:
    from scipy import stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    logger.warning("SciPy not available for statistical tests")


class DriftType(str, Enum):
    DATA_DRIFT = "data_drift"
    CONCEPT_DRIFT = "concept_drift"
    PREDICTION_DRIFT = "prediction_drift"
    PERFORMANCE_DRIFT = "performance_drift"


class DriftSeverity(str, Enum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class DriftResult:
    """Result of drift detection"""
    drift_type: DriftType
    drift_detected: bool
    drift_score: float
    severity: DriftSeverity
    details: Dict[str, Any]
    timestamp: datetime
    recommendation: str


@dataclass
class FeatureDriftResult:
    """Drift result for a single feature"""
    feature_name: str
    drift_score: float
    drift_detected: bool
    test_statistic: float
    p_value: float
    baseline_mean: float
    current_mean: float
    baseline_std: float
    current_std: float


@dataclass
class ModelMonitoringReport:
    """Comprehensive monitoring report for a model"""
    model_name: str
    model_version: str
    report_period: str
    data_drift: DriftResult
    prediction_drift: DriftResult
    performance_drift: Optional[DriftResult]
    feature_drifts: List[FeatureDriftResult]
    overall_health: str
    recommendations: List[str]
    generated_at: datetime


class StatisticalTests:
    """Statistical tests for drift detection"""
    
    @staticmethod
    def kolmogorov_smirnov_test(baseline: List[float], current: List[float]) -> Tuple[float, float]:
        """
        Kolmogorov-Smirnov test for comparing two distributions.
        Returns (statistic, p_value)
        """
        if not SCIPY_AVAILABLE or not NUMPY_AVAILABLE:
            # Fallback to simple comparison
            baseline_mean = sum(baseline) / len(baseline) if baseline else 0
            current_mean = sum(current) / len(current) if current else 0
            diff = abs(baseline_mean - current_mean) / (baseline_mean + 0.001)
            return diff, 1.0 - diff
        
        statistic, p_value = stats.ks_2samp(baseline, current)
        return float(statistic), float(p_value)
    
    @staticmethod
    def population_stability_index(baseline: List[float], current: List[float], bins: int = 10) -> float:
        """
        Calculate Population Stability Index (PSI).
        PSI < 0.1: No significant change
        0.1 <= PSI < 0.2: Moderate change
        PSI >= 0.2: Significant change
        """
        if not NUMPY_AVAILABLE:
            return 0.0
        
        import numpy as np
        
        # Create bins from baseline
        baseline_arr = np.array(baseline)
        current_arr = np.array(current)
        
        # Handle edge cases
        if len(baseline_arr) == 0 or len(current_arr) == 0:
            return 0.0
        
        # Create bins
        min_val = min(baseline_arr.min(), current_arr.min())
        max_val = max(baseline_arr.max(), current_arr.max())
        bin_edges = np.linspace(min_val, max_val, bins + 1)
        
        # Calculate proportions
        baseline_counts, _ = np.histogram(baseline_arr, bins=bin_edges)
        current_counts, _ = np.histogram(current_arr, bins=bin_edges)
        
        # Convert to proportions (add small value to avoid division by zero)
        baseline_props = (baseline_counts + 0.001) / (len(baseline_arr) + 0.001 * bins)
        current_props = (current_counts + 0.001) / (len(current_arr) + 0.001 * bins)
        
        # Calculate PSI
        psi = np.sum((current_props - baseline_props) * np.log(current_props / baseline_props))
        
        return float(psi)
    
    @staticmethod
    def chi_squared_test(baseline_counts: Dict[str, int], current_counts: Dict[str, int]) -> Tuple[float, float]:
        """
        Chi-squared test for categorical features.
        Returns (statistic, p_value)
        """
        if not SCIPY_AVAILABLE:
            return 0.0, 1.0
        
        # Align categories
        all_categories = set(baseline_counts.keys()) | set(current_counts.keys())
        baseline_arr = [baseline_counts.get(cat, 0) for cat in all_categories]
        current_arr = [current_counts.get(cat, 0) for cat in all_categories]
        
        # Perform chi-squared test
        try:
            statistic, p_value = stats.chisquare(current_arr, f_exp=baseline_arr)
            return float(statistic), float(p_value)
        except Exception:
            return 0.0, 1.0


class DriftDetector:
    """Main drift detection class"""
    
    def __init__(self, drift_threshold: float = 0.1, p_value_threshold: float = 0.05):
        self.drift_threshold = drift_threshold
        self.p_value_threshold = p_value_threshold
        self.baselines: Dict[str, Dict] = {}
        self.prediction_history: Dict[str, List[Dict]] = defaultdict(list)
        self.performance_history: Dict[str, List[Dict]] = defaultdict(list)
        self.tests = StatisticalTests()
    
    def set_baseline(self, model_name: str, feature_distributions: Dict[str, List[float]], 
                     prediction_distribution: List[float] = None, 
                     performance_metrics: Dict[str, float] = None):
        """Set baseline distributions for a model"""
        
        baseline = {
            "model_name": model_name,
            "feature_distributions": feature_distributions,
            "prediction_distribution": prediction_distribution or [],
            "performance_metrics": performance_metrics or {},
            "created_at": datetime.utcnow().isoformat(),
            "sample_size": len(list(feature_distributions.values())[0]) if feature_distributions else 0
        }
        
        # Calculate baseline statistics
        if NUMPY_AVAILABLE:
            import numpy as np
            baseline["feature_stats"] = {}
            for feature, values in feature_distributions.items():
                arr = np.array(values)
                baseline["feature_stats"][feature] = {
                    "mean": float(np.mean(arr)),
                    "std": float(np.std(arr)),
                    "min": float(np.min(arr)),
                    "max": float(np.max(arr)),
                    "median": float(np.median(arr))
                }
        
        self.baselines[model_name] = baseline
        logger.info(f"Baseline set for model {model_name}")
    
    def detect_feature_drift(self, model_name: str, current_features: Dict[str, List[float]]) -> List[FeatureDriftResult]:
        """Detect drift in individual features"""
        
        if model_name not in self.baselines:
            logger.warning(f"No baseline found for model {model_name}")
            return []
        
        baseline = self.baselines[model_name]
        baseline_features = baseline.get("feature_distributions", {})
        baseline_stats = baseline.get("feature_stats", {})
        
        results = []
        
        for feature_name, current_values in current_features.items():
            if feature_name not in baseline_features:
                continue
            
            baseline_values = baseline_features[feature_name]
            
            # Perform KS test
            ks_stat, p_value = self.tests.kolmogorov_smirnov_test(baseline_values, current_values)
            
            # Calculate PSI
            psi = self.tests.population_stability_index(baseline_values, current_values)
            
            # Determine if drift detected
            drift_detected = p_value < self.p_value_threshold or psi >= self.drift_threshold
            
            # Get baseline stats
            b_stats = baseline_stats.get(feature_name, {})
            
            # Calculate current stats
            if NUMPY_AVAILABLE:
                import numpy as np
                current_arr = np.array(current_values)
                current_mean = float(np.mean(current_arr))
                current_std = float(np.std(current_arr))
            else:
                current_mean = sum(current_values) / len(current_values) if current_values else 0
                current_std = 0
            
            results.append(FeatureDriftResult(
                feature_name=feature_name,
                drift_score=psi,
                drift_detected=drift_detected,
                test_statistic=ks_stat,
                p_value=p_value,
                baseline_mean=b_stats.get("mean", 0),
                current_mean=current_mean,
                baseline_std=b_stats.get("std", 0),
                current_std=current_std
            ))
        
        return results
    
    def detect_data_drift(self, model_name: str, current_features: Dict[str, List[float]]) -> DriftResult:
        """Detect overall data drift across all features"""
        
        feature_drifts = self.detect_feature_drift(model_name, current_features)
        
        if not feature_drifts:
            return DriftResult(
                drift_type=DriftType.DATA_DRIFT,
                drift_detected=False,
                drift_score=0.0,
                severity=DriftSeverity.NONE,
                details={"message": "No baseline or features to compare"},
                timestamp=datetime.utcnow(),
                recommendation="Set baseline first"
            )
        
        # Calculate overall drift score
        drift_scores = [f.drift_score for f in feature_drifts]
        drifted_features = [f for f in feature_drifts if f.drift_detected]
        
        if NUMPY_AVAILABLE:
            import numpy as np
            overall_score = float(np.mean(drift_scores))
            max_score = float(np.max(drift_scores))
        else:
            overall_score = sum(drift_scores) / len(drift_scores)
            max_score = max(drift_scores)
        
        drift_detected = len(drifted_features) > 0
        drift_ratio = len(drifted_features) / len(feature_drifts)
        
        # Determine severity
        if not drift_detected:
            severity = DriftSeverity.NONE
        elif drift_ratio < 0.2 and max_score < 0.2:
            severity = DriftSeverity.LOW
        elif drift_ratio < 0.4 and max_score < 0.3:
            severity = DriftSeverity.MEDIUM
        elif drift_ratio < 0.6 and max_score < 0.5:
            severity = DriftSeverity.HIGH
        else:
            severity = DriftSeverity.CRITICAL
        
        # Generate recommendation
        if severity == DriftSeverity.NONE:
            recommendation = "No action needed"
        elif severity == DriftSeverity.LOW:
            recommendation = "Monitor closely, consider retraining if drift persists"
        elif severity == DriftSeverity.MEDIUM:
            recommendation = "Schedule model retraining within 1-2 weeks"
        elif severity == DriftSeverity.HIGH:
            recommendation = "Retrain model soon, consider A/B testing new model"
        else:
            recommendation = "Immediate retraining required, consider fallback to rules"
        
        return DriftResult(
            drift_type=DriftType.DATA_DRIFT,
            drift_detected=drift_detected,
            drift_score=overall_score,
            severity=severity,
            details={
                "drifted_features": [f.feature_name for f in drifted_features],
                "drift_ratio": drift_ratio,
                "max_drift_score": max_score,
                "feature_drift_scores": {f.feature_name: f.drift_score for f in feature_drifts}
            },
            timestamp=datetime.utcnow(),
            recommendation=recommendation
        )
    
    def detect_prediction_drift(self, model_name: str, current_predictions: List[float]) -> DriftResult:
        """Detect drift in model predictions"""
        
        if model_name not in self.baselines:
            return DriftResult(
                drift_type=DriftType.PREDICTION_DRIFT,
                drift_detected=False,
                drift_score=0.0,
                severity=DriftSeverity.NONE,
                details={"message": "No baseline found"},
                timestamp=datetime.utcnow(),
                recommendation="Set baseline first"
            )
        
        baseline_predictions = self.baselines[model_name].get("prediction_distribution", [])
        
        if not baseline_predictions:
            return DriftResult(
                drift_type=DriftType.PREDICTION_DRIFT,
                drift_detected=False,
                drift_score=0.0,
                severity=DriftSeverity.NONE,
                details={"message": "No baseline predictions"},
                timestamp=datetime.utcnow(),
                recommendation="Set baseline predictions"
            )
        
        # Perform statistical tests
        ks_stat, p_value = self.tests.kolmogorov_smirnov_test(baseline_predictions, current_predictions)
        psi = self.tests.population_stability_index(baseline_predictions, current_predictions)
        
        drift_detected = p_value < self.p_value_threshold or psi >= self.drift_threshold
        
        # Determine severity based on PSI
        if psi < 0.1:
            severity = DriftSeverity.NONE if not drift_detected else DriftSeverity.LOW
        elif psi < 0.2:
            severity = DriftSeverity.MEDIUM
        elif psi < 0.3:
            severity = DriftSeverity.HIGH
        else:
            severity = DriftSeverity.CRITICAL
        
        if NUMPY_AVAILABLE:
            import numpy as np
            baseline_mean = float(np.mean(baseline_predictions))
            current_mean = float(np.mean(current_predictions))
        else:
            baseline_mean = sum(baseline_predictions) / len(baseline_predictions)
            current_mean = sum(current_predictions) / len(current_predictions)
        
        recommendation = "No action needed" if not drift_detected else "Investigate prediction distribution shift"
        
        return DriftResult(
            drift_type=DriftType.PREDICTION_DRIFT,
            drift_detected=drift_detected,
            drift_score=psi,
            severity=severity,
            details={
                "ks_statistic": ks_stat,
                "p_value": p_value,
                "psi": psi,
                "baseline_mean": baseline_mean,
                "current_mean": current_mean
            },
            timestamp=datetime.utcnow(),
            recommendation=recommendation
        )
    
    def detect_performance_drift(self, model_name: str, current_metrics: Dict[str, float]) -> DriftResult:
        """Detect drift in model performance metrics"""
        
        if model_name not in self.baselines:
            return DriftResult(
                drift_type=DriftType.PERFORMANCE_DRIFT,
                drift_detected=False,
                drift_score=0.0,
                severity=DriftSeverity.NONE,
                details={"message": "No baseline found"},
                timestamp=datetime.utcnow(),
                recommendation="Set baseline first"
            )
        
        baseline_metrics = self.baselines[model_name].get("performance_metrics", {})
        
        if not baseline_metrics:
            return DriftResult(
                drift_type=DriftType.PERFORMANCE_DRIFT,
                drift_detected=False,
                drift_score=0.0,
                severity=DriftSeverity.NONE,
                details={"message": "No baseline metrics"},
                timestamp=datetime.utcnow(),
                recommendation="Set baseline metrics"
            )
        
        # Calculate metric degradation
        degradations = {}
        for metric, baseline_value in baseline_metrics.items():
            if metric in current_metrics:
                current_value = current_metrics[metric]
                # For metrics where higher is better (accuracy, precision, recall, f1, auc)
                if metric in ["accuracy", "precision", "recall", "f1_score", "auc_roc", "auc_pr", "r2_score"]:
                    degradation = (baseline_value - current_value) / (baseline_value + 0.001)
                # For metrics where lower is better (rmse, mae)
                elif metric in ["rmse", "mae"]:
                    degradation = (current_value - baseline_value) / (baseline_value + 0.001)
                else:
                    degradation = abs(current_value - baseline_value) / (baseline_value + 0.001)
                
                degradations[metric] = degradation
        
        if not degradations:
            return DriftResult(
                drift_type=DriftType.PERFORMANCE_DRIFT,
                drift_detected=False,
                drift_score=0.0,
                severity=DriftSeverity.NONE,
                details={"message": "No comparable metrics"},
                timestamp=datetime.utcnow(),
                recommendation="Ensure metrics match baseline"
            )
        
        # Calculate overall degradation
        max_degradation = max(degradations.values())
        avg_degradation = sum(degradations.values()) / len(degradations)
        
        # Determine if drift detected (>5% degradation)
        drift_detected = max_degradation > 0.05
        
        # Determine severity
        if max_degradation < 0.05:
            severity = DriftSeverity.NONE
        elif max_degradation < 0.10:
            severity = DriftSeverity.LOW
        elif max_degradation < 0.15:
            severity = DriftSeverity.MEDIUM
        elif max_degradation < 0.25:
            severity = DriftSeverity.HIGH
        else:
            severity = DriftSeverity.CRITICAL
        
        if severity == DriftSeverity.NONE:
            recommendation = "No action needed"
        elif severity == DriftSeverity.LOW:
            recommendation = "Monitor performance, consider retraining if degradation continues"
        elif severity == DriftSeverity.MEDIUM:
            recommendation = "Schedule retraining, investigate root cause"
        else:
            recommendation = "Immediate retraining required"
        
        return DriftResult(
            drift_type=DriftType.PERFORMANCE_DRIFT,
            drift_detected=drift_detected,
            drift_score=max_degradation,
            severity=severity,
            details={
                "metric_degradations": degradations,
                "max_degradation": max_degradation,
                "avg_degradation": avg_degradation,
                "baseline_metrics": baseline_metrics,
                "current_metrics": current_metrics
            },
            timestamp=datetime.utcnow(),
            recommendation=recommendation
        )
    
    def generate_monitoring_report(self, model_name: str, model_version: str,
                                   current_features: Dict[str, List[float]],
                                   current_predictions: List[float],
                                   current_metrics: Dict[str, float] = None,
                                   report_period: str = "last_7_days") -> ModelMonitoringReport:
        """Generate comprehensive monitoring report"""
        
        # Detect all types of drift
        data_drift = self.detect_data_drift(model_name, current_features)
        prediction_drift = self.detect_prediction_drift(model_name, current_predictions)
        performance_drift = self.detect_performance_drift(model_name, current_metrics) if current_metrics else None
        feature_drifts = self.detect_feature_drift(model_name, current_features)
        
        # Determine overall health
        severities = [data_drift.severity, prediction_drift.severity]
        if performance_drift:
            severities.append(performance_drift.severity)
        
        severity_order = [DriftSeverity.NONE, DriftSeverity.LOW, DriftSeverity.MEDIUM, 
                         DriftSeverity.HIGH, DriftSeverity.CRITICAL]
        max_severity = max(severities, key=lambda s: severity_order.index(s))
        
        if max_severity == DriftSeverity.NONE:
            overall_health = "healthy"
        elif max_severity == DriftSeverity.LOW:
            overall_health = "good"
        elif max_severity == DriftSeverity.MEDIUM:
            overall_health = "warning"
        elif max_severity == DriftSeverity.HIGH:
            overall_health = "degraded"
        else:
            overall_health = "critical"
        
        # Collect recommendations
        recommendations = []
        if data_drift.drift_detected:
            recommendations.append(data_drift.recommendation)
        if prediction_drift.drift_detected:
            recommendations.append(prediction_drift.recommendation)
        if performance_drift and performance_drift.drift_detected:
            recommendations.append(performance_drift.recommendation)
        
        if not recommendations:
            recommendations.append("Model is performing within expected parameters")
        
        return ModelMonitoringReport(
            model_name=model_name,
            model_version=model_version,
            report_period=report_period,
            data_drift=data_drift,
            prediction_drift=prediction_drift,
            performance_drift=performance_drift,
            feature_drifts=feature_drifts,
            overall_health=overall_health,
            recommendations=recommendations,
            generated_at=datetime.utcnow()
        )


# Global drift detector instance
_drift_detector = None


def get_drift_detector() -> DriftDetector:
    """Get the global drift detector instance"""
    global _drift_detector
    if _drift_detector is None:
        _drift_detector = DriftDetector()
    return _drift_detector
