"""
Online Learning Pipeline
Kafka-based online learning for continuous model updates and real-time adaptation.
"""

import os
import json
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable, Any
from dataclasses import dataclass, asdict
from enum import Enum
import hashlib

import numpy as np
import pandas as pd

import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.errors import KafkaError

logger = logging.getLogger(__name__)


class MLEventType(str, Enum):
    # Routing events
    ROUTING_DECISION = "routing.decision"
    ROUTING_OUTCOME = "routing.outcome"
    
    # Model events
    MODEL_TRAINING_STARTED = "model.training.started"
    MODEL_TRAINING_COMPLETED = "model.training.completed"
    MODEL_DEPLOYED = "model.deployed"
    MODEL_ROLLBACK = "model.rollback"
    
    # Feature events
    FEATURE_UPDATED = "feature.updated"
    FEATURE_DRIFT_DETECTED = "feature.drift.detected"
    
    # Alert events
    MODEL_PERFORMANCE_DEGRADED = "model.performance.degraded"
    PREDICTION_ANOMALY = "prediction.anomaly"


class KafkaTopic(str, Enum):
    ROUTING_DECISIONS = "multibank.routing.decisions"
    ROUTING_OUTCOMES = "multibank.routing.outcomes"
    ML_TRAINING = "multibank.ml.training"
    ML_FEATURES = "multibank.ml.features"
    ML_ALERTS = "multibank.ml.alerts"


@dataclass
class RoutingDecisionEvent:
    """Event emitted when a routing decision is made"""
    event_id: str
    event_type: str
    timestamp: str
    transfer_id: str
    bank_code: str
    rail: str
    amount: float
    predicted_success_rate: float
    predicted_latency_ms: int
    predicted_cost: float
    score: float
    model_version: str
    features: Dict[str, Any]
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'RoutingDecisionEvent':
        return cls(**data)


@dataclass
class RoutingOutcomeEvent:
    """Event emitted when a routing outcome is known"""
    event_id: str
    event_type: str
    timestamp: str
    transfer_id: str
    bank_code: str
    rail: str
    amount: float
    was_successful: bool
    actual_latency_ms: int
    actual_cost: float
    error_code: Optional[str]
    error_message: Optional[str]
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'RoutingOutcomeEvent':
        return cls(**data)


@dataclass
class ModelTrainingEvent:
    """Event for model training lifecycle"""
    event_id: str
    event_type: str
    timestamp: str
    model_type: str
    model_version: str
    status: str  # started, completed, failed
    metrics: Optional[Dict[str, float]]
    training_samples: int
    duration_seconds: Optional[float]
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class FeatureUpdateEvent:
    """Event when features are updated"""
    event_id: str
    event_type: str
    timestamp: str
    feature_name: str
    entity_type: str  # bank, rail, account
    entity_id: str
    old_value: Optional[float]
    new_value: float
    
    def to_dict(self) -> Dict:
        return asdict(self)


class OnlineLearningProducer:
    """Kafka producer for ML events"""
    
    def __init__(
        self,
        bootstrap_servers: str = "kafka.remittance.svc.cluster.local:9092",
        client_id: str = "multibank-ml-producer"
    ):
        self.bootstrap_servers = bootstrap_servers
        self.client_id = client_id
        self.producer: Optional[AIOKafkaProducer] = None
        self._started = False
    
    async def start(self):
        """Start the Kafka producer"""
        if self._started:
            return
        
        self.producer = AIOKafkaProducer(
            bootstrap_servers=self.bootstrap_servers,
            client_id=self.client_id,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None,
            acks='all',
            enable_idempotence=True,
            max_in_flight_requests_per_connection=5
        )
        
        await self.producer.start()
        self._started = True
        logger.info("Online learning producer started")
    
    async def stop(self):
        """Stop the Kafka producer"""
        if self.producer and self._started:
            await self.producer.stop()
            self._started = False
            logger.info("Online learning producer stopped")
    
    async def publish_routing_decision(self, event: RoutingDecisionEvent):
        """Publish a routing decision event"""
        await self._send(
            topic=KafkaTopic.ROUTING_DECISIONS.value,
            key=event.transfer_id,
            value=event.to_dict()
        )
    
    async def publish_routing_outcome(self, event: RoutingOutcomeEvent):
        """Publish a routing outcome event"""
        await self._send(
            topic=KafkaTopic.ROUTING_OUTCOMES.value,
            key=event.transfer_id,
            value=event.to_dict()
        )
    
    async def publish_model_training(self, event: ModelTrainingEvent):
        """Publish a model training event"""
        await self._send(
            topic=KafkaTopic.ML_TRAINING.value,
            key=event.model_type,
            value=event.to_dict()
        )
    
    async def publish_feature_update(self, event: FeatureUpdateEvent):
        """Publish a feature update event"""
        await self._send(
            topic=KafkaTopic.ML_FEATURES.value,
            key=f"{event.entity_type}:{event.entity_id}",
            value=event.to_dict()
        )
    
    async def publish_alert(self, alert_type: str, details: Dict):
        """Publish an ML alert"""
        event = {
            'event_id': hashlib.sha256(f"{alert_type}:{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16],
            'event_type': alert_type,
            'timestamp': datetime.utcnow().isoformat(),
            'details': details
        }
        
        await self._send(
            topic=KafkaTopic.ML_ALERTS.value,
            key=alert_type,
            value=event
        )
    
    async def _send(self, topic: str, key: str, value: Dict):
        """Send a message to Kafka"""
        if not self._started:
            await self.start()
        
        try:
            await self.producer.send_and_wait(
                topic=topic,
                key=key,
                value=value
            )
            logger.debug(f"Published to {topic}: {key}")
        except KafkaError as e:
            logger.error(f"Failed to publish to {topic}: {e}")
            raise


class OnlineLearningConsumer:
    """Kafka consumer for ML events with online learning"""
    
    def __init__(
        self,
        bootstrap_servers: str = "kafka.remittance.svc.cluster.local:9092",
        group_id: str = "multibank-ml-consumer",
        db_pool: asyncpg.Pool = None,
        redis_client: redis.Redis = None
    ):
        self.bootstrap_servers = bootstrap_servers
        self.group_id = group_id
        self.db_pool = db_pool
        self.redis = redis_client
        self.consumer: Optional[AIOKafkaConsumer] = None
        self._started = False
        self._handlers: Dict[str, List[Callable]] = {}
        
        # Online learning state
        self._outcome_buffer: List[RoutingOutcomeEvent] = []
        self._buffer_size = 100
        self._last_retrain_time = datetime.utcnow()
        self._retrain_interval = timedelta(hours=1)
        
        # Performance monitoring
        self._prediction_errors: List[float] = []
        self._error_window = 1000
    
    def register_handler(self, event_type: str, handler: Callable):
        """Register a handler for an event type"""
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)
    
    async def start(self):
        """Start the Kafka consumer"""
        if self._started:
            return
        
        self.consumer = AIOKafkaConsumer(
            KafkaTopic.ROUTING_OUTCOMES.value,
            KafkaTopic.ML_FEATURES.value,
            bootstrap_servers=self.bootstrap_servers,
            group_id=self.group_id,
            value_deserializer=lambda v: json.loads(v.decode('utf-8')),
            key_deserializer=lambda k: k.decode('utf-8') if k else None,
            auto_offset_reset='latest',
            enable_auto_commit=True
        )
        
        await self.consumer.start()
        self._started = True
        logger.info("Online learning consumer started")
    
    async def stop(self):
        """Stop the Kafka consumer"""
        if self.consumer and self._started:
            await self.consumer.stop()
            self._started = False
            logger.info("Online learning consumer stopped")
    
    async def consume(self):
        """Main consume loop"""
        if not self._started:
            await self.start()
        
        try:
            async for msg in self.consumer:
                await self._process_message(msg)
        except Exception as e:
            logger.error(f"Consumer error: {e}")
            raise
    
    async def _process_message(self, msg):
        """Process a Kafka message"""
        topic = msg.topic
        value = msg.value
        
        try:
            if topic == KafkaTopic.ROUTING_OUTCOMES.value:
                await self._handle_routing_outcome(value)
            elif topic == KafkaTopic.ML_FEATURES.value:
                await self._handle_feature_update(value)
            
            # Call registered handlers
            event_type = value.get('event_type')
            if event_type in self._handlers:
                for handler in self._handlers[event_type]:
                    await handler(value)
                    
        except Exception as e:
            logger.error(f"Error processing message: {e}")
    
    async def _handle_routing_outcome(self, data: Dict):
        """Handle routing outcome for online learning"""
        event = RoutingOutcomeEvent.from_dict(data)
        
        # Add to buffer
        self._outcome_buffer.append(event)
        
        # Update real-time metrics
        await self._update_realtime_metrics(event)
        
        # Check if we should trigger retraining
        if len(self._outcome_buffer) >= self._buffer_size:
            await self._process_outcome_buffer()
        
        # Check for performance degradation
        await self._check_performance()
    
    async def _update_realtime_metrics(self, event: RoutingOutcomeEvent):
        """Update real-time metrics in Redis"""
        if not self.redis:
            return
        
        # Update success rate
        success_key = f"metrics:success:{event.bank_code}:{event.rail}"
        await self.redis.lpush(success_key, '1' if event.was_successful else '0')
        await self.redis.ltrim(success_key, 0, 999)  # Keep last 1000
        
        # Update latency
        if event.was_successful and event.actual_latency_ms:
            latency_key = f"metrics:latency:{event.bank_code}:{event.rail}"
            await self.redis.lpush(latency_key, str(event.actual_latency_ms))
            await self.redis.ltrim(latency_key, 0, 999)
        
        # Invalidate feature cache
        await self.redis.delete(f"features:bank:{event.bank_code}")
        await self.redis.delete(f"features:rail:{event.rail}")
    
    async def _process_outcome_buffer(self):
        """Process buffered outcomes for batch updates"""
        if not self._outcome_buffer:
            return
        
        # Store outcomes in database
        if self.db_pool:
            async with self.db_pool.acquire() as conn:
                for event in self._outcome_buffer:
                    await conn.execute("""
                        INSERT INTO routing_metrics (
                            transfer_id, bank_code, rail, amount, was_successful,
                            actual_latency_ms, actual_cost, hour_of_day, day_of_week, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        ON CONFLICT (transfer_id) DO NOTHING
                    """, event.transfer_id, event.bank_code, event.rail, event.amount,
                        event.was_successful, event.actual_latency_ms, event.actual_cost,
                        datetime.fromisoformat(event.timestamp).hour,
                        datetime.fromisoformat(event.timestamp).weekday(),
                        datetime.fromisoformat(event.timestamp))
        
        # Clear buffer
        self._outcome_buffer = []
        
        # Check if we should retrain
        now = datetime.utcnow()
        if now - self._last_retrain_time > self._retrain_interval:
            await self._trigger_retraining()
            self._last_retrain_time = now
    
    async def _trigger_retraining(self):
        """Trigger model retraining"""
        logger.info("Triggering model retraining...")
        
        # Emit retraining event
        if 'retrain' in self._handlers:
            for handler in self._handlers['retrain']:
                await handler({})
    
    async def _check_performance(self):
        """Check for model performance degradation"""
        if not self.redis:
            return
        
        # Get recent predictions vs actuals
        # This would compare predicted success rates with actual outcomes
        
        # Calculate error rate
        if len(self._prediction_errors) >= 100:
            recent_error = np.mean(self._prediction_errors[-100:])
            overall_error = np.mean(self._prediction_errors)
            
            # Alert if recent error is significantly higher
            if recent_error > overall_error * 1.5:
                logger.warning(f"Model performance degraded: recent_error={recent_error:.4f}, overall={overall_error:.4f}")
                
                # Publish alert
                if 'alert' in self._handlers:
                    for handler in self._handlers['alert']:
                        await handler({
                            'type': MLEventType.MODEL_PERFORMANCE_DEGRADED.value,
                            'recent_error': recent_error,
                            'overall_error': overall_error
                        })
    
    async def _handle_feature_update(self, data: Dict):
        """Handle feature update events"""
        event = FeatureUpdateEvent(**data)
        
        # Invalidate relevant caches
        if self.redis:
            if event.entity_type == 'bank':
                await self.redis.delete(f"features:bank:{event.entity_id}")
            elif event.entity_type == 'rail':
                await self.redis.delete(f"features:rail:{event.entity_id}")


class OnlineLearningPipeline:
    """Complete online learning pipeline"""
    
    def __init__(
        self,
        db_pool: asyncpg.Pool,
        redis_client: redis.Redis,
        bootstrap_servers: str = "kafka.remittance.svc.cluster.local:9092",
        model_dir: str = "/var/lib/ml-models"
    ):
        self.db_pool = db_pool
        self.redis = redis_client
        self.model_dir = model_dir
        
        self.producer = OnlineLearningProducer(bootstrap_servers)
        self.consumer = OnlineLearningConsumer(
            bootstrap_servers=bootstrap_servers,
            db_pool=db_pool,
            redis_client=redis_client
        )
        
        # Import ML models (lazy import to avoid circular deps)
        self._ml_engine = None
        
        # Performance tracking
        self._metrics_window: List[Dict] = []
        self._window_size = 10000
    
    async def initialize(self, ml_engine=None):
        """Initialize the pipeline"""
        self._ml_engine = ml_engine
        
        # Register handlers
        self.consumer.register_handler('retrain', self._handle_retrain)
        self.consumer.register_handler('alert', self._handle_alert)
        
        # Start producer
        await self.producer.start()
        
        logger.info("Online learning pipeline initialized")
    
    async def start_consumer(self):
        """Start the consumer in background"""
        await self.consumer.start()
        asyncio.create_task(self.consumer.consume())
        logger.info("Online learning consumer started in background")
    
    async def stop(self):
        """Stop the pipeline"""
        await self.producer.stop()
        await self.consumer.stop()
    
    async def record_decision(
        self,
        transfer_id: str,
        bank_code: str,
        rail: str,
        amount: float,
        predicted_success_rate: float,
        predicted_latency_ms: int,
        predicted_cost: float,
        score: float,
        model_version: str,
        features: Dict[str, Any]
    ):
        """Record a routing decision"""
        event = RoutingDecisionEvent(
            event_id=hashlib.sha256(f"{transfer_id}:{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16],
            event_type=MLEventType.ROUTING_DECISION.value,
            timestamp=datetime.utcnow().isoformat(),
            transfer_id=transfer_id,
            bank_code=bank_code,
            rail=rail,
            amount=amount,
            predicted_success_rate=predicted_success_rate,
            predicted_latency_ms=predicted_latency_ms,
            predicted_cost=predicted_cost,
            score=score,
            model_version=model_version,
            features=features
        )
        
        await self.producer.publish_routing_decision(event)
        
        # Store in Redis for later matching with outcome
        await self.redis.setex(
            f"decision:{transfer_id}",
            3600,  # 1 hour TTL
            json.dumps(event.to_dict())
        )
    
    async def record_outcome(
        self,
        transfer_id: str,
        bank_code: str,
        rail: str,
        amount: float,
        was_successful: bool,
        actual_latency_ms: int,
        actual_cost: float,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None
    ):
        """Record a routing outcome"""
        event = RoutingOutcomeEvent(
            event_id=hashlib.sha256(f"{transfer_id}:outcome:{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16],
            event_type=MLEventType.ROUTING_OUTCOME.value,
            timestamp=datetime.utcnow().isoformat(),
            transfer_id=transfer_id,
            bank_code=bank_code,
            rail=rail,
            amount=amount,
            was_successful=was_successful,
            actual_latency_ms=actual_latency_ms,
            actual_cost=actual_cost,
            error_code=error_code,
            error_message=error_message
        )
        
        await self.producer.publish_routing_outcome(event)
        
        # Get original decision for comparison
        decision_data = await self.redis.get(f"decision:{transfer_id}")
        if decision_data:
            decision = json.loads(decision_data)
            
            # Calculate prediction error
            prediction_error = abs(decision['predicted_success_rate'] - (1.0 if was_successful else 0.0))
            
            # Track metrics
            self._metrics_window.append({
                'transfer_id': transfer_id,
                'predicted_success': decision['predicted_success_rate'],
                'actual_success': was_successful,
                'predicted_latency': decision['predicted_latency_ms'],
                'actual_latency': actual_latency_ms,
                'prediction_error': prediction_error,
                'timestamp': datetime.utcnow()
            })
            
            # Trim window
            if len(self._metrics_window) > self._window_size:
                self._metrics_window = self._metrics_window[-self._window_size:]
            
            # Update ML engine if available
            if self._ml_engine:
                from .routing_ml_models import RoutingFeatures
                
                # Reconstruct features
                features_dict = decision.get('features', {})
                if features_dict:
                    try:
                        features = RoutingFeatures(**features_dict)
                        await self._ml_engine.record_outcome(
                            transfer_id=transfer_id,
                            features=features,
                            was_successful=was_successful,
                            actual_latency_ms=actual_latency_ms,
                            actual_cost=actual_cost,
                            predicted_success=decision['predicted_success_rate'],
                            predicted_latency=decision['predicted_latency_ms'],
                            predicted_cost=decision['predicted_cost']
                        )
                    except Exception as e:
                        logger.error(f"Failed to update ML engine: {e}")
    
    async def _handle_retrain(self, data: Dict):
        """Handle retraining request"""
        if not self._ml_engine:
            logger.warning("ML engine not available for retraining")
            return
        
        logger.info("Starting model retraining...")
        
        # Emit training started event
        await self.producer.publish_model_training(ModelTrainingEvent(
            event_id=hashlib.sha256(f"train:{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16],
            event_type=MLEventType.MODEL_TRAINING_STARTED.value,
            timestamp=datetime.utcnow().isoformat(),
            model_type='all',
            model_version='pending',
            status='started',
            metrics=None,
            training_samples=0,
            duration_seconds=None
        ))
        
        start_time = datetime.utcnow()
        
        try:
            # Retrain models
            results = await self._ml_engine.retrain_models()
            
            duration = (datetime.utcnow() - start_time).total_seconds()
            
            # Emit training completed event
            await self.producer.publish_model_training(ModelTrainingEvent(
                event_id=hashlib.sha256(f"train:complete:{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16],
                event_type=MLEventType.MODEL_TRAINING_COMPLETED.value,
                timestamp=datetime.utcnow().isoformat(),
                model_type='all',
                model_version=results.get('success_model', {}).get('model_version', 'unknown'),
                status='completed',
                metrics=results,
                training_samples=results.get('success_model', {}).get('training_samples', 0),
                duration_seconds=duration
            ))
            
            logger.info(f"Model retraining completed in {duration:.2f}s")
            
        except Exception as e:
            logger.error(f"Model retraining failed: {e}")
            
            await self.producer.publish_model_training(ModelTrainingEvent(
                event_id=hashlib.sha256(f"train:failed:{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16],
                event_type=MLEventType.MODEL_TRAINING_COMPLETED.value,
                timestamp=datetime.utcnow().isoformat(),
                model_type='all',
                model_version='failed',
                status='failed',
                metrics={'error': str(e)},
                training_samples=0,
                duration_seconds=(datetime.utcnow() - start_time).total_seconds()
            ))
    
    async def _handle_alert(self, data: Dict):
        """Handle ML alerts"""
        alert_type = data.get('type')
        
        logger.warning(f"ML Alert: {alert_type} - {data}")
        
        # Publish to alerts topic
        await self.producer.publish_alert(alert_type, data)
        
        # If performance degraded, trigger immediate retraining
        if alert_type == MLEventType.MODEL_PERFORMANCE_DEGRADED.value:
            await self._handle_retrain({})
    
    def get_metrics_summary(self) -> Dict[str, Any]:
        """Get summary of online learning metrics"""
        if not self._metrics_window:
            return {'status': 'no_data'}
        
        df = pd.DataFrame(self._metrics_window)
        
        # Calculate metrics
        success_accuracy = (df['predicted_success'] > 0.5).eq(df['actual_success']).mean()
        avg_prediction_error = df['prediction_error'].mean()
        
        latency_mae = abs(df['predicted_latency'] - df['actual_latency']).mean()
        
        # Recent vs overall
        recent = df.tail(100)
        recent_accuracy = (recent['predicted_success'] > 0.5).eq(recent['actual_success']).mean()
        recent_error = recent['prediction_error'].mean()
        
        return {
            'total_samples': len(df),
            'success_prediction_accuracy': success_accuracy,
            'avg_prediction_error': avg_prediction_error,
            'latency_mae_ms': latency_mae,
            'recent_accuracy': recent_accuracy,
            'recent_error': recent_error,
            'performance_trend': 'stable' if abs(recent_accuracy - success_accuracy) < 0.05 else (
                'improving' if recent_accuracy > success_accuracy else 'degrading'
            ),
            'last_updated': datetime.utcnow().isoformat()
        }


class ModelRegistry:
    """Model registry for versioning and deployment"""
    
    def __init__(self, db_pool: asyncpg.Pool, redis_client: redis.Redis, model_dir: str = "./models"):
        self.db_pool = db_pool
        self.redis = redis_client
        self.model_dir = model_dir
    
    async def register_model(
        self,
        model_type: str,
        model_version: str,
        model_path: str,
        metrics: Dict[str, float],
        metadata: Dict[str, Any] = None
    ):
        """Register a new model version"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ml_model_registry (
                    model_type, model_version, model_path, metrics, metadata, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6)
            """, model_type, model_version, model_path, json.dumps(metrics),
                json.dumps(metadata or {}), datetime.utcnow())
        
        logger.info(f"Registered model: {model_type} v{model_version}")
    
    async def get_latest_model(self, model_type: str) -> Optional[Dict]:
        """Get the latest deployed model"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT model_type, model_version, model_path, metrics, metadata, created_at
                FROM ml_model_registry
                WHERE model_type = $1 AND is_deployed = true
                ORDER BY created_at DESC
                LIMIT 1
            """, model_type)
        
        if row:
            return dict(row)
        return None
    
    async def deploy_model(self, model_type: str, model_version: str):
        """Deploy a specific model version"""
        async with self.db_pool.acquire() as conn:
            # Undeploy current
            await conn.execute("""
                UPDATE ml_model_registry
                SET is_deployed = false
                WHERE model_type = $1 AND is_deployed = true
            """, model_type)
            
            # Deploy new
            await conn.execute("""
                UPDATE ml_model_registry
                SET is_deployed = true, deployed_at = $3
                WHERE model_type = $1 AND model_version = $2
            """, model_type, model_version, datetime.utcnow())
        
        # Update Redis cache
        await self.redis.set(f"model:deployed:{model_type}", model_version)
        
        logger.info(f"Deployed model: {model_type} v{model_version}")
    
    async def rollback_model(self, model_type: str):
        """Rollback to previous model version"""
        async with self.db_pool.acquire() as conn:
            # Get previous deployed version
            row = await conn.fetchrow("""
                SELECT model_version
                FROM ml_model_registry
                WHERE model_type = $1 AND is_deployed = false
                ORDER BY deployed_at DESC NULLS LAST, created_at DESC
                LIMIT 1
            """, model_type)
            
            if row:
                await self.deploy_model(model_type, row['model_version'])
                logger.info(f"Rolled back {model_type} to v{row['model_version']}")
                return row['model_version']
        
        return None
    
    async def get_model_history(self, model_type: str, limit: int = 10) -> List[Dict]:
        """Get model version history"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT model_type, model_version, model_path, metrics, metadata, 
                       is_deployed, created_at, deployed_at
                FROM ml_model_registry
                WHERE model_type = $1
                ORDER BY created_at DESC
                LIMIT $2
            """, model_type, limit)
        
        return [dict(row) for row in rows]
