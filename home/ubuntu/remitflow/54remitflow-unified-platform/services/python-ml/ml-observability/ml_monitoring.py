"""
ML Model Monitoring and Observability Service
Production-grade monitoring for AI/ML services in Remittance Platform
"""

import os
import json
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum
from collections import defaultdict
import numpy as np

import asyncpg
import redis.asyncio as redis
from prometheus_client import Counter, Histogram, Gauge, Summary, CollectorRegistry, generate_latest
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

logger = logging.getLogger(__name__)

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'redis.remittance.svc.cluster.local')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_URL = os.getenv('REDIS_URL', f'redis://{REDIS_HOST}:{REDIS_PORT}')
DB_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank')
KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'kafka.remittance.svc.cluster.local:9092')


class MetricType(str, Enum):
    INFERENCE_LATENCY = "inference_latency"
    INFERENCE_COUNT = "inference_count"
    INFERENCE_ERROR = "inference_error"
    PREDICTION_DISTRIBUTION = "prediction_distribution"
    FEATURE_VALUE = "feature_value"
    MODEL_ACCURACY = "model_accuracy"
    CALIBRATION_ERROR = "calibration_error"
    BUSINESS_KPI = "business_kpi"


class AlertSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class InferenceMetrics:
    """Metrics for a single inference request"""
    model_name: str
    model_version: str
    request_id: str
    timestamp: datetime
    latency_ms: float
    prediction: float
    confidence: float
    features: Dict[str, Any]
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OutcomeMetrics:
    """Metrics for inference outcome (ground truth)"""
    model_name: str
    model_version: str
    request_id: str
    timestamp: datetime
    prediction: float
    actual: float
    was_correct: bool
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ModelPerformanceMetrics:
    """Aggregated model performance metrics"""
    model_name: str
    model_version: str
    window_start: datetime
    window_end: datetime
    total_predictions: int
    total_outcomes: int
    accuracy: float
    precision: float
    recall: float
    f1_score: float
    auc_roc: float
    auc_pr: float
    brier_score: float
    calibration_error: float
    mean_latency_ms: float
    p50_latency_ms: float
    p95_latency_ms: float
    p99_latency_ms: float
    error_rate: float
    prediction_mean: float
    prediction_std: float


class PrometheusMetrics:
    """Prometheus metrics for ML monitoring"""
    
    def __init__(self, registry: CollectorRegistry = None):
        self.registry = registry or CollectorRegistry()
        
        # Inference metrics
        self.inference_latency = Histogram(
            'ml_inference_latency_seconds',
            'ML inference latency in seconds',
            ['model_name', 'model_version', 'endpoint'],
            buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
            registry=self.registry
        )
        
        self.inference_count = Counter(
            'ml_inference_total',
            'Total ML inference requests',
            ['model_name', 'model_version', 'status'],
            registry=self.registry
        )
        
        self.inference_errors = Counter(
            'ml_inference_errors_total',
            'Total ML inference errors',
            ['model_name', 'model_version', 'error_type'],
            registry=self.registry
        )
        
        # Prediction distribution
        self.prediction_value = Histogram(
            'ml_prediction_value',
            'ML prediction value distribution',
            ['model_name', 'model_version'],
            buckets=[0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
            registry=self.registry
        )
        
        self.prediction_confidence = Histogram(
            'ml_prediction_confidence',
            'ML prediction confidence distribution',
            ['model_name', 'model_version'],
            buckets=[0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0],
            registry=self.registry
        )
        
        # Model performance
        self.model_accuracy = Gauge(
            'ml_model_accuracy',
            'Current model accuracy',
            ['model_name', 'model_version', 'window'],
            registry=self.registry
        )
        
        self.model_auc = Gauge(
            'ml_model_auc_roc',
            'Current model AUC-ROC',
            ['model_name', 'model_version', 'window'],
            registry=self.registry
        )
        
        self.model_brier_score = Gauge(
            'ml_model_brier_score',
            'Current model Brier score (calibration)',
            ['model_name', 'model_version', 'window'],
            registry=self.registry
        )
        
        self.model_calibration_error = Gauge(
            'ml_model_calibration_error',
            'Expected calibration error',
            ['model_name', 'model_version', 'window'],
            registry=self.registry
        )
        
        # Business KPIs
        self.business_kpi = Gauge(
            'ml_business_kpi',
            'Business KPI value',
            ['model_name', 'kpi_name'],
            registry=self.registry
        )
        
        # Feature drift
        self.feature_drift_score = Gauge(
            'ml_feature_drift_psi',
            'Feature drift PSI score',
            ['model_name', 'feature_name'],
            registry=self.registry
        )
        
        self.prediction_drift_score = Gauge(
            'ml_prediction_drift_psi',
            'Prediction drift PSI score',
            ['model_name', 'model_version'],
            registry=self.registry
        )


class MLMonitoringService:
    """Core ML monitoring service"""
    
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        self.metrics = PrometheusMetrics()
        
        # In-memory buffers for aggregation
        self._inference_buffer: List[InferenceMetrics] = []
        self._outcome_buffer: List[OutcomeMetrics] = []
        self._buffer_size = 1000
        self._flush_interval = 60  # seconds
        
        # Alert thresholds
        self.alert_thresholds = {
            'latency_p99_ms': 5000,
            'error_rate': 0.05,
            'accuracy_drop': 0.05,
            'calibration_error': 0.1,
            'drift_psi': 0.2
        }
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
        self.db_pool = await asyncpg.create_pool(DB_URL, min_size=5, max_size=20)
        
        # Start background tasks
        asyncio.create_task(self._flush_buffers_periodically())
        asyncio.create_task(self._compute_metrics_periodically())
        
        logger.info("ML Monitoring Service initialized")
    
    async def record_inference(
        self,
        model_name: str,
        model_version: str,
        request_id: str,
        latency_ms: float,
        prediction: float,
        confidence: float,
        features: Dict[str, Any],
        metadata: Dict[str, Any] = None
    ):
        """Record an inference request"""
        metrics = InferenceMetrics(
            model_name=model_name,
            model_version=model_version,
            request_id=request_id,
            timestamp=datetime.utcnow(),
            latency_ms=latency_ms,
            prediction=prediction,
            confidence=confidence,
            features=features,
            metadata=metadata or {}
        )
        
        # Update Prometheus metrics
        self.metrics.inference_latency.labels(
            model_name=model_name,
            model_version=model_version,
            endpoint='predict'
        ).observe(latency_ms / 1000.0)
        
        self.metrics.inference_count.labels(
            model_name=model_name,
            model_version=model_version,
            status='success'
        ).inc()
        
        self.metrics.prediction_value.labels(
            model_name=model_name,
            model_version=model_version
        ).observe(prediction)
        
        self.metrics.prediction_confidence.labels(
            model_name=model_name,
            model_version=model_version
        ).observe(confidence)
        
        # Buffer for batch processing
        self._inference_buffer.append(metrics)
        
        # Store in Redis for real-time access
        await self._store_inference_redis(metrics)
        
        # Check for alerts
        await self._check_inference_alerts(metrics)
    
    async def record_outcome(
        self,
        model_name: str,
        model_version: str,
        request_id: str,
        prediction: float,
        actual: float,
        metadata: Dict[str, Any] = None
    ):
        """Record inference outcome (ground truth)"""
        was_correct = (prediction >= 0.5) == (actual >= 0.5)
        
        metrics = OutcomeMetrics(
            model_name=model_name,
            model_version=model_version,
            request_id=request_id,
            timestamp=datetime.utcnow(),
            prediction=prediction,
            actual=actual,
            was_correct=was_correct,
            metadata=metadata or {}
        )
        
        self._outcome_buffer.append(metrics)
        
        # Store in Redis
        await self._store_outcome_redis(metrics)
    
    async def record_error(
        self,
        model_name: str,
        model_version: str,
        error_type: str,
        error_message: str,
        request_id: str = None
    ):
        """Record an inference error"""
        self.metrics.inference_errors.labels(
            model_name=model_name,
            model_version=model_version,
            error_type=error_type
        ).inc()
        
        self.metrics.inference_count.labels(
            model_name=model_name,
            model_version=model_version,
            status='error'
        ).inc()
        
        # Store error details
        error_data = {
            'model_name': model_name,
            'model_version': model_version,
            'error_type': error_type,
            'error_message': error_message,
            'request_id': request_id,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        await self.redis.lpush(
            f"ml:errors:{model_name}",
            json.dumps(error_data)
        )
        await self.redis.ltrim(f"ml:errors:{model_name}", 0, 999)
    
    async def get_model_performance(
        self,
        model_name: str,
        model_version: str = None,
        window_hours: int = 24
    ) -> ModelPerformanceMetrics:
        """Get aggregated model performance metrics"""
        window_start = datetime.utcnow() - timedelta(hours=window_hours)
        
        # Fetch from database
        async with self.db_pool.acquire() as conn:
            # Get inference metrics
            inference_rows = await conn.fetch("""
                SELECT latency_ms, prediction, confidence
                FROM ml_inference_log
                WHERE model_name = $1
                AND ($2 IS NULL OR model_version = $2)
                AND timestamp >= $3
            """, model_name, model_version, window_start)
            
            # Get outcome metrics
            outcome_rows = await conn.fetch("""
                SELECT prediction, actual, was_correct
                FROM ml_outcome_log
                WHERE model_name = $1
                AND ($2 IS NULL OR model_version = $2)
                AND timestamp >= $3
            """, model_name, model_version, window_start)
        
        if not inference_rows:
            return None
        
        # Calculate metrics
        latencies = [r['latency_ms'] for r in inference_rows]
        predictions = [r['prediction'] for r in inference_rows]
        
        # Outcome-based metrics
        if outcome_rows:
            actuals = [r['actual'] for r in outcome_rows]
            preds = [r['prediction'] for r in outcome_rows]
            correct = [r['was_correct'] for r in outcome_rows]
            
            accuracy = sum(correct) / len(correct)
            brier_score = np.mean([(p - a) ** 2 for p, a in zip(preds, actuals)])
            calibration_error = self._calculate_calibration_error(preds, actuals)
            
            # Calculate precision, recall, F1
            tp = sum(1 for p, a in zip(preds, actuals) if p >= 0.5 and a >= 0.5)
            fp = sum(1 for p, a in zip(preds, actuals) if p >= 0.5 and a < 0.5)
            fn = sum(1 for p, a in zip(preds, actuals) if p < 0.5 and a >= 0.5)
            
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0
            f1_score = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
            
            # AUC approximation
            auc_roc = self._calculate_auc(preds, actuals)
        else:
            accuracy = precision = recall = f1_score = auc_roc = 0
            brier_score = calibration_error = 0
        
        # Error rate
        error_count = await self.redis.llen(f"ml:errors:{model_name}")
        error_rate = error_count / len(inference_rows) if inference_rows else 0
        
        return ModelPerformanceMetrics(
            model_name=model_name,
            model_version=model_version or "all",
            window_start=window_start,
            window_end=datetime.utcnow(),
            total_predictions=len(inference_rows),
            total_outcomes=len(outcome_rows) if outcome_rows else 0,
            accuracy=accuracy,
            precision=precision,
            recall=recall,
            f1_score=f1_score,
            auc_roc=auc_roc,
            auc_pr=self._calculate_auc_pr(predictions, actuals),
            brier_score=brier_score,
            calibration_error=calibration_error,
            mean_latency_ms=np.mean(latencies),
            p50_latency_ms=np.percentile(latencies, 50),
            p95_latency_ms=np.percentile(latencies, 95),
            p99_latency_ms=np.percentile(latencies, 99),
            error_rate=error_rate,
            prediction_mean=np.mean(predictions),
            prediction_std=np.std(predictions)
        )
    
    async def get_real_time_metrics(
        self,
        model_name: str,
        window_minutes: int = 5
    ) -> Dict[str, Any]:
        """Get real-time metrics from Redis"""
        window_key = f"ml:realtime:{model_name}:{window_minutes}m"
        
        data = await self.redis.hgetall(window_key)
        if not data:
            return {}
        
        return {
            'request_count': int(data.get('request_count', 0)),
            'error_count': int(data.get('error_count', 0)),
            'mean_latency_ms': float(data.get('mean_latency_ms', 0)),
            'p99_latency_ms': float(data.get('p99_latency_ms', 0)),
            'prediction_mean': float(data.get('prediction_mean', 0)),
            'last_updated': data.get('last_updated')
        }
    
    async def get_business_kpis(
        self,
        model_name: str,
        window_hours: int = 24
    ) -> Dict[str, float]:
        """Get business KPIs for a model"""
        kpis = {}
        
        if model_name == 'routing_success':
            # Success rate uplift
            async with self.db_pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT 
                        AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END) as success_rate,
                        AVG(actual_latency_ms) as avg_latency,
                        SUM(actual_cost) as total_cost
                    FROM routing_metrics
                    WHERE created_at >= NOW() - INTERVAL '%s hours'
                """, window_hours)
                
                if row:
                    kpis['success_rate'] = float(row['success_rate'] or 0)
                    kpis['avg_latency_ms'] = float(row['avg_latency'] or 0)
                    kpis['total_cost'] = float(row['total_cost'] or 0)
        
        elif model_name == 'fraud_detection':
            async with self.db_pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT 
                        COUNT(*) FILTER (WHERE is_fraud AND predicted_fraud) as true_positives,
                        COUNT(*) FILTER (WHERE NOT is_fraud AND predicted_fraud) as false_positives,
                        COUNT(*) FILTER (WHERE is_fraud AND NOT predicted_fraud) as false_negatives,
                        SUM(CASE WHEN is_fraud AND NOT predicted_fraud THEN amount ELSE 0 END) as missed_fraud_amount
                    FROM fraud_predictions
                    WHERE created_at >= NOW() - INTERVAL '%s hours'
                """, window_hours)
                
                if row:
                    tp = row['true_positives'] or 0
                    fp = row['false_positives'] or 0
                    fn = row['false_negatives'] or 0
                    
                    kpis['fraud_catch_rate'] = tp / (tp + fn) if (tp + fn) > 0 else 0
                    kpis['false_positive_rate'] = fp / (tp + fp) if (tp + fp) > 0 else 0
                    kpis['missed_fraud_amount'] = float(row['missed_fraud_amount'] or 0)
        
        return kpis
    
    def _calculate_calibration_error(
        self,
        predictions: List[float],
        actuals: List[float],
        n_bins: int = 10
    ) -> float:
        """Calculate Expected Calibration Error (ECE)"""
        if not predictions:
            return 0
        
        bin_boundaries = np.linspace(0, 1, n_bins + 1)
        ece = 0
        
        for i in range(n_bins):
            bin_lower = bin_boundaries[i]
            bin_upper = bin_boundaries[i + 1]
            
            in_bin = [(p, a) for p, a in zip(predictions, actuals) 
                      if bin_lower <= p < bin_upper]
            
            if in_bin:
                bin_preds = [p for p, _ in in_bin]
                bin_actuals = [a for _, a in in_bin]
                
                avg_confidence = np.mean(bin_preds)
                avg_accuracy = np.mean(bin_actuals)
                
                ece += len(in_bin) / len(predictions) * abs(avg_accuracy - avg_confidence)
        
        return ece
    
    def _calculate_auc(
        self,
        predictions: List[float],
        actuals: List[float]
    ) -> float:
        """Calculate AUC-ROC (simplified)"""
        if not predictions or len(set(actuals)) < 2:
            return 0.5
        
        # Sort by prediction descending
        sorted_pairs = sorted(zip(predictions, actuals), reverse=True)
        
        n_pos = sum(1 for _, a in sorted_pairs if a >= 0.5)
        n_neg = len(sorted_pairs) - n_pos
        
        if n_pos == 0 or n_neg == 0:
            return 0.5
        
        # Calculate AUC using Mann-Whitney U statistic
        rank_sum = 0
        for i, (_, actual) in enumerate(sorted_pairs):
            if actual >= 0.5:
                rank_sum += len(sorted_pairs) - i
        
        auc = (rank_sum - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)
        return auc
    
    def _calculate_auc_pr(
        self,
        predictions: List[float],
        actuals: List[float]
    ) -> float:
        """Calculate Area Under the Precision-Recall Curve"""
        if not predictions or len(set(actuals)) < 2:
            return 0.0
        sorted_pairs = sorted(zip(predictions, actuals), key=lambda x: -x[0])
        tp = 0
        fp = 0
        total_positives = sum(1 for _, a in sorted_pairs if a >= 0.5)
        if total_positives == 0:
            return 0.0
        precisions = []
        recalls = []
        for pred, actual in sorted_pairs:
            if actual >= 0.5:
                tp += 1
            else:
                fp += 1
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            recall = tp / total_positives
            precisions.append(precision)
            recalls.append(recall)
        auc_pr = 0.0
        for i in range(1, len(recalls)):
            auc_pr += (recalls[i] - recalls[i - 1]) * precisions[i]
        return auc_pr

    async def _store_inference_redis(self, metrics: InferenceMetrics):
        """Store inference metrics in Redis for real-time access"""
        key = f"ml:inference:{metrics.model_name}:{metrics.request_id}"
        await self.redis.setex(key, 3600, json.dumps(asdict(metrics), default=str))
        
        # Update real-time counters
        window_key = f"ml:realtime:{metrics.model_name}:5m"
        await self.redis.hincrby(window_key, 'request_count', 1)
        await self.redis.expire(window_key, 300)
    
    async def _store_outcome_redis(self, metrics: OutcomeMetrics):
        """Store outcome metrics in Redis"""
        key = f"ml:outcome:{metrics.model_name}:{metrics.request_id}"
        await self.redis.setex(key, 3600, json.dumps(asdict(metrics), default=str))
    
    async def _check_inference_alerts(self, metrics: InferenceMetrics):
        """Check for alert conditions"""
        alerts = []
        
        # Latency alert
        if metrics.latency_ms > self.alert_thresholds['latency_p99_ms']:
            alerts.append({
                'severity': AlertSeverity.WARNING.value,
                'type': 'high_latency',
                'message': f"High latency detected: {metrics.latency_ms}ms",
                'model_name': metrics.model_name,
                'request_id': metrics.request_id
            })
        
        for alert in alerts:
            await self._publish_alert(alert)
    
    async def _publish_alert(self, alert: Dict):
        """Publish alert to Redis pub/sub"""
        await self.redis.publish('ml:alerts', json.dumps(alert))
        await self.redis.lpush('ml:alert_history', json.dumps(alert))
        await self.redis.ltrim('ml:alert_history', 0, 999)
    
    async def _flush_buffers_periodically(self):
        """Periodically flush buffers to database"""
        while True:
            await asyncio.sleep(self._flush_interval)
            await self._flush_buffers()
    
    async def _flush_buffers(self):
        """Flush in-memory buffers to database"""
        if self._inference_buffer:
            inference_batch = self._inference_buffer[:self._buffer_size]
            self._inference_buffer = self._inference_buffer[self._buffer_size:]
            
            async with self.db_pool.acquire() as conn:
                await conn.executemany("""
                    INSERT INTO ml_inference_log (
                        model_name, model_version, request_id, timestamp,
                        latency_ms, prediction, confidence, features, metadata
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """, [
                    (m.model_name, m.model_version, m.request_id, m.timestamp,
                     m.latency_ms, m.prediction, m.confidence,
                     json.dumps(m.features), json.dumps(m.metadata))
                    for m in inference_batch
                ])
        
        if self._outcome_buffer:
            outcome_batch = self._outcome_buffer[:self._buffer_size]
            self._outcome_buffer = self._outcome_buffer[self._buffer_size:]
            
            async with self.db_pool.acquire() as conn:
                await conn.executemany("""
                    INSERT INTO ml_outcome_log (
                        model_name, model_version, request_id, timestamp,
                        prediction, actual, was_correct, metadata
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, [
                    (m.model_name, m.model_version, m.request_id, m.timestamp,
                     m.prediction, m.actual, m.was_correct, json.dumps(m.metadata))
                    for m in outcome_batch
                ])
    
    async def _compute_metrics_periodically(self):
        """Periodically compute and update Prometheus metrics"""
        while True:
            await asyncio.sleep(60)
            await self._update_prometheus_metrics()
    
    async def _update_prometheus_metrics(self):
        """Update Prometheus gauges with latest metrics"""
        models = ['routing_success', 'routing_latency', 'fraud_detection', 'credit_scoring']
        
        for model_name in models:
            try:
                perf = await self.get_model_performance(model_name, window_hours=1)
                if perf:
                    self.metrics.model_accuracy.labels(
                        model_name=model_name,
                        model_version=perf.model_version,
                        window='1h'
                    ).set(perf.accuracy)
                    
                    self.metrics.model_auc.labels(
                        model_name=model_name,
                        model_version=perf.model_version,
                        window='1h'
                    ).set(perf.auc_roc)
                    
                    self.metrics.model_brier_score.labels(
                        model_name=model_name,
                        model_version=perf.model_version,
                        window='1h'
                    ).set(perf.brier_score)
                    
                    self.metrics.model_calibration_error.labels(
                        model_name=model_name,
                        model_version=perf.model_version,
                        window='1h'
                    ).set(perf.calibration_error)
                
                # Business KPIs
                kpis = await self.get_business_kpis(model_name)
                for kpi_name, kpi_value in kpis.items():
                    self.metrics.business_kpi.labels(
                        model_name=model_name,
                        kpi_name=kpi_name
                    ).set(kpi_value)
            except Exception as e:
                logger.error(f"Error updating metrics for {model_name}: {e}")


# FastAPI Application
app = FastAPI(
    title="ML Monitoring Service",
    description="Production-grade ML monitoring and observability",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

monitoring_service: Optional[MLMonitoringService] = None


class InferenceRequest(BaseModel):
    model_name: str
    model_version: str
    request_id: str
    latency_ms: float
    prediction: float
    confidence: float
    features: Dict[str, Any]
    metadata: Optional[Dict[str, Any]] = None


class OutcomeRequest(BaseModel):
    model_name: str
    model_version: str
    request_id: str
    prediction: float
    actual: float
    metadata: Optional[Dict[str, Any]] = None


class ErrorRequest(BaseModel):
    model_name: str
    model_version: str
    error_type: str
    error_message: str
    request_id: Optional[str] = None


@app.on_event("startup")
async def startup():
    global monitoring_service
    monitoring_service = MLMonitoringService()
    await monitoring_service.initialize()


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ml-monitoring"}


@app.get("/metrics")
async def prometheus_metrics():
    """Prometheus metrics endpoint"""
    return generate_latest(monitoring_service.metrics.registry)


@app.post("/api/v1/inference")
async def record_inference(request: InferenceRequest):
    """Record an inference request"""
    await monitoring_service.record_inference(
        model_name=request.model_name,
        model_version=request.model_version,
        request_id=request.request_id,
        latency_ms=request.latency_ms,
        prediction=request.prediction,
        confidence=request.confidence,
        features=request.features,
        metadata=request.metadata
    )
    return {"status": "recorded"}


@app.post("/api/v1/outcome")
async def record_outcome(request: OutcomeRequest):
    """Record inference outcome"""
    await monitoring_service.record_outcome(
        model_name=request.model_name,
        model_version=request.model_version,
        request_id=request.request_id,
        prediction=request.prediction,
        actual=request.actual,
        metadata=request.metadata
    )
    return {"status": "recorded"}


@app.post("/api/v1/error")
async def record_error(request: ErrorRequest):
    """Record inference error"""
    await monitoring_service.record_error(
        model_name=request.model_name,
        model_version=request.model_version,
        error_type=request.error_type,
        error_message=request.error_message,
        request_id=request.request_id
    )
    return {"status": "recorded"}


@app.get("/api/v1/performance/{model_name}")
async def get_performance(model_name: str, model_version: str = None, window_hours: int = 24):
    """Get model performance metrics"""
    perf = await monitoring_service.get_model_performance(
        model_name=model_name,
        model_version=model_version,
        window_hours=window_hours
    )
    if not perf:
        raise HTTPException(status_code=404, detail="No metrics found")
    return asdict(perf)


@app.get("/api/v1/realtime/{model_name}")
async def get_realtime(model_name: str, window_minutes: int = 5):
    """Get real-time metrics"""
    return await monitoring_service.get_real_time_metrics(model_name, window_minutes)


@app.get("/api/v1/kpis/{model_name}")
async def get_kpis(model_name: str, window_hours: int = 24):
    """Get business KPIs"""
    return await monitoring_service.get_business_kpis(model_name, window_hours)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8160)
