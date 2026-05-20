"""
ML Observability Package
Production-grade ML monitoring, data quality, model registry, and deployment controls
"""

from .ml_monitoring import (
    MLMonitoringService,
    PrometheusMetrics,
    InferenceMetrics,
    OutcomeMetrics,
    ModelPerformanceMetrics,
    MetricType,
    AlertSeverity
)

from .data_quality import (
    FeatureSchemaRegistry,
    DataQualityValidator,
    DriftDetector,
    OnlineLearningGate,
    ValidationReport,
    DriftReport,
    ValidationResult,
    FeatureSchema
)

from .model_registry import (
    EnhancedModelRegistry,
    ModelVersion,
    ModelStage,
    ModelStatus,
    DeploymentRecord
)

from .safe_deployment import (
    SafeDeploymentManager,
    DeploymentConfig,
    DeploymentMode,
    TrafficSplitStrategy,
    RoutingDecision,
    ExperimentMetrics
)

from .resilience import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitBreakerOpenError,
    circuit_breaker,
    circuit_breaker_registry,
    with_timeout,
    with_retry,
    RetryConfig,
    Bulkhead,
    BulkheadFullError,
    bulkhead_registry,
    with_bulkhead,
    MLFallbackStrategy,
    ResilientMLService
)

from .explainability import (
    ExplainabilityService,
    ModelExplanation,
    GlobalExplanation,
    FeatureContribution,
    ExplanationType,
    ReasonCodeMapper,
    TreeModelExplainer
)

from .retraining_pipeline import (
    RetrainingPipeline,
    RetrainingConfig,
    PipelineRun,
    PipelineStatus,
    TriggerType,
    DataExtractor,
    ModelTrainer,
    ValidationGateRunner,
    BacktestRunner
)

__version__ = "1.0.0"

__all__ = [
    # Monitoring
    'MLMonitoringService',
    'PrometheusMetrics',
    'InferenceMetrics',
    'OutcomeMetrics',
    'ModelPerformanceMetrics',
    'MetricType',
    'AlertSeverity',
    
    # Data Quality
    'FeatureSchemaRegistry',
    'DataQualityValidator',
    'DriftDetector',
    'OnlineLearningGate',
    'ValidationReport',
    'DriftReport',
    'ValidationResult',
    'FeatureSchema',
    
    # Model Registry
    'EnhancedModelRegistry',
    'ModelVersion',
    'ModelStage',
    'ModelStatus',
    'DeploymentRecord',
    
    # Safe Deployment
    'SafeDeploymentManager',
    'DeploymentConfig',
    'DeploymentMode',
    'TrafficSplitStrategy',
    'RoutingDecision',
    'ExperimentMetrics',
    
    # Resilience
    'CircuitBreaker',
    'CircuitBreakerConfig',
    'CircuitBreakerOpenError',
    'circuit_breaker',
    'circuit_breaker_registry',
    'with_timeout',
    'with_retry',
    'RetryConfig',
    'Bulkhead',
    'BulkheadFullError',
    'bulkhead_registry',
    'with_bulkhead',
    'MLFallbackStrategy',
    'ResilientMLService',
    
    # Explainability
    'ExplainabilityService',
    'ModelExplanation',
    'GlobalExplanation',
    'FeatureContribution',
    'ExplanationType',
    'ReasonCodeMapper',
    'TreeModelExplainer',
    
    # Retraining Pipeline
    'RetrainingPipeline',
    'RetrainingConfig',
    'PipelineRun',
    'PipelineStatus',
    'TriggerType',
    'DataExtractor',
    'ModelTrainer',
    'ValidationGateRunner',
    'BacktestRunner',
]
