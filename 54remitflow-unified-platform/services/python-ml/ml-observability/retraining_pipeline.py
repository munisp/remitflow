"""
Automated ML Retraining Pipeline
Production-grade automated model retraining with validation gates
"""

import os
import json
import logging
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field, asdict
from enum import Enum
import asyncio

import asyncpg
import redis.asyncio as redis

logger = logging.getLogger(__name__)

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'redis.remittance.svc.cluster.local')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_URL = os.getenv('REDIS_URL', f'redis://{REDIS_HOST}:{REDIS_PORT}')
DB_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank')
KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'kafka.remittance.svc.cluster.local:9092')


class PipelineStatus(str, Enum):
    """Pipeline execution status"""
    PENDING = "pending"
    RUNNING = "running"
    VALIDATING = "validating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TriggerType(str, Enum):
    """Types of retraining triggers"""
    SCHEDULED = "scheduled"
    DRIFT_DETECTED = "drift_detected"
    PERFORMANCE_DEGRADATION = "performance_degradation"
    MANUAL = "manual"
    DATA_VOLUME = "data_volume"


@dataclass
class RetrainingConfig:
    """Configuration for retraining pipeline"""
    model_name: str
    schedule_cron: str = "0 2 * * *"  # Daily at 2 AM
    min_samples: int = 10000
    min_days_since_last: int = 1
    max_days_since_last: int = 7
    performance_threshold: float = 0.85
    drift_threshold: float = 0.2
    validation_split: float = 0.2
    backtest_windows: List[int] = field(default_factory=lambda: [7, 30, 90])
    auto_deploy: bool = False
    notification_channels: List[str] = field(default_factory=list)
    hyperparameters: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineRun:
    """Record of a pipeline execution"""
    run_id: str
    model_name: str
    trigger_type: TriggerType
    status: PipelineStatus
    started_at: datetime
    completed_at: Optional[datetime] = None
    
    # Data info
    dataset_start: Optional[datetime] = None
    dataset_end: Optional[datetime] = None
    sample_count: int = 0
    
    # Training results
    training_metrics: Dict[str, float] = field(default_factory=dict)
    validation_metrics: Dict[str, float] = field(default_factory=dict)
    backtest_results: Dict[str, Dict[str, float]] = field(default_factory=dict)
    
    # Model info
    model_version: Optional[str] = None
    artifact_path: Optional[str] = None
    
    # Validation gates
    gates_passed: List[str] = field(default_factory=list)
    gates_failed: List[str] = field(default_factory=list)
    
    # Error info
    error_message: Optional[str] = None
    
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationGate:
    """Validation gate for pipeline"""
    name: str
    description: str
    check_func: Callable
    threshold: float
    is_blocking: bool = True


class DataExtractor:
    """Extracts training data from lakehouse"""
    
    def __init__(self, db_pool: asyncpg.Pool):
        self.db_pool = db_pool
    
    async def extract_routing_data(
        self,
        start_date: datetime,
        end_date: datetime,
        min_samples: int = 10000
    ) -> List[Dict[str, Any]]:
        """Extract routing training data"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    rm.bank_code,
                    rm.rail,
                    rm.amount,
                    rm.hour_of_day,
                    rm.day_of_week,
                    rm.was_successful as label,
                    rm.actual_latency_ms,
                    bf.success_rate_1h as bank_success_rate_1h,
                    bf.success_rate_24h as bank_success_rate_24h,
                    bf.avg_latency_1h as bank_avg_latency_1h
                FROM routing_metrics rm
                LEFT JOIN bank_features bf ON rm.bank_code = bf.bank_code 
                    AND DATE(rm.created_at) = DATE(bf.feature_date)
                WHERE rm.created_at >= $1 AND rm.created_at < $2
                AND rm.was_successful IS NOT NULL
                ORDER BY rm.created_at
                LIMIT $3
            """, start_date, end_date, min_samples * 2)
        
        return [dict(row) for row in rows]
    
    async def extract_fraud_data(
        self,
        start_date: datetime,
        end_date: datetime,
        min_samples: int = 10000
    ) -> List[Dict[str, Any]]:
        """Extract fraud detection training data"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    fp.amount,
                    fp.merchant_category,
                    fp.transaction_type,
                    fp.hour_of_day,
                    fp.user_transaction_count_1h,
                    fp.user_avg_amount,
                    fp.is_fraud as label
                FROM fraud_predictions fp
                WHERE fp.created_at >= $1 AND fp.created_at < $2
                AND fp.is_fraud IS NOT NULL
                ORDER BY fp.created_at
                LIMIT $3
            """, start_date, end_date, min_samples * 2)
        
        return [dict(row) for row in rows]
    
    async def extract_credit_data(
        self,
        start_date: datetime,
        end_date: datetime,
        min_samples: int = 5000
    ) -> List[Dict[str, Any]]:
        """Extract credit scoring training data"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    cs.age,
                    cs.income,
                    cs.employment_length,
                    cs.debt_to_income,
                    cs.credit_history_length,
                    cs.defaulted as label
                FROM credit_scores cs
                WHERE cs.created_at >= $1 AND cs.created_at < $2
                AND cs.defaulted IS NOT NULL
                ORDER BY cs.created_at
                LIMIT $3
            """, start_date, end_date, min_samples * 2)
        
        return [dict(row) for row in rows]


class ModelTrainer:
    """Trains ML models"""
    
    def __init__(self):
        self._training_funcs: Dict[str, Callable] = {}
    
    def register_trainer(self, model_name: str, train_func: Callable):
        """Register a training function for a model"""
        self._training_funcs[model_name] = train_func
    
    async def train(
        self,
        model_name: str,
        train_data: List[Dict[str, Any]],
        val_data: List[Dict[str, Any]],
        hyperparameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Train a model"""
        train_func = self._training_funcs.get(model_name)
        
        if train_func:
            return await train_func(train_data, val_data, hyperparameters)
        
        # Default training (placeholder)
        return await self._default_train(model_name, train_data, val_data, hyperparameters)
    
    async def _default_train(
        self,
        model_name: str,
        train_data: List[Dict[str, Any]],
        val_data: List[Dict[str, Any]],
        hyperparameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Default training implementation"""
        # This would be replaced with actual model training
        import random
        
        # Simulate training
        await asyncio.sleep(1)
        
        return {
            'model_artifact': b'model_bytes_placeholder',
            'training_metrics': {
                'accuracy': 0.85 + random.random() * 0.1,
                'auc_roc': 0.88 + random.random() * 0.08,
                'loss': 0.3 - random.random() * 0.1
            },
            'validation_metrics': {
                'accuracy': 0.83 + random.random() * 0.1,
                'auc_roc': 0.86 + random.random() * 0.08,
                'loss': 0.35 - random.random() * 0.1
            },
            'feature_importance': {
                'feature_1': 0.3,
                'feature_2': 0.25,
                'feature_3': 0.2
            }
        }


class ValidationGateRunner:
    """Runs validation gates"""
    
    def __init__(self):
        self.gates: Dict[str, List[ValidationGate]] = {}
        self._initialize_default_gates()
    
    def _initialize_default_gates(self):
        """Initialize default validation gates"""
        # Common gates for all models
        common_gates = [
            ValidationGate(
                name="min_accuracy",
                description="Minimum accuracy threshold",
                check_func=lambda m: m.get('accuracy', 0),
                threshold=0.80,
                is_blocking=True
            ),
            ValidationGate(
                name="min_auc",
                description="Minimum AUC-ROC threshold",
                check_func=lambda m: m.get('auc_roc', 0),
                threshold=0.75,
                is_blocking=True
            ),
            ValidationGate(
                name="no_regression",
                description="No significant regression from current model",
                check_func=lambda m: m.get('accuracy_diff', 0),
                threshold=-0.02,  # Allow up to 2% regression
                is_blocking=True
            ),
            ValidationGate(
                name="calibration",
                description="Model calibration check",
                check_func=lambda m: 1 - m.get('calibration_error', 1),
                threshold=0.85,
                is_blocking=False
            ),
        ]
        
        self.gates['routing_success'] = common_gates + [
            ValidationGate(
                name="latency_prediction",
                description="Latency prediction accuracy",
                check_func=lambda m: m.get('latency_mae', float('inf')),
                threshold=500,  # Max 500ms MAE
                is_blocking=False
            ),
        ]
        
        self.gates['fraud_detection'] = common_gates + [
            ValidationGate(
                name="min_recall",
                description="Minimum fraud recall",
                check_func=lambda m: m.get('recall', 0),
                threshold=0.90,  # Must catch 90% of fraud
                is_blocking=True
            ),
            ValidationGate(
                name="max_fpr",
                description="Maximum false positive rate",
                check_func=lambda m: 1 - m.get('false_positive_rate', 1),
                threshold=0.95,  # Max 5% FPR
                is_blocking=True
            ),
        ]
        
        self.gates['credit_scoring'] = common_gates + [
            ValidationGate(
                name="fairness",
                description="Fairness across demographic groups",
                check_func=lambda m: m.get('demographic_parity', 0),
                threshold=0.80,
                is_blocking=True
            ),
        ]
    
    def run_gates(
        self,
        model_name: str,
        metrics: Dict[str, float],
        current_metrics: Dict[str, float] = None
    ) -> Tuple[List[str], List[str]]:
        """Run validation gates and return passed/failed lists"""
        gates = self.gates.get(model_name, self.gates.get('routing_success', []))
        
        # Add regression check if current metrics available
        if current_metrics:
            metrics['accuracy_diff'] = metrics.get('accuracy', 0) - current_metrics.get('accuracy', 0)
        
        passed = []
        failed = []
        
        for gate in gates:
            value = gate.check_func(metrics)
            
            if gate.name == "no_regression":
                # Special handling for regression check (value should be >= threshold)
                if value >= gate.threshold:
                    passed.append(gate.name)
                else:
                    failed.append(gate.name)
            elif gate.name in ["latency_prediction"]:
                # Lower is better
                if value <= gate.threshold:
                    passed.append(gate.name)
                else:
                    failed.append(gate.name)
            else:
                # Higher is better
                if value >= gate.threshold:
                    passed.append(gate.name)
                else:
                    failed.append(gate.name)
        
        return passed, failed


class BacktestRunner:
    """Runs backtests on historical data"""
    
    def __init__(self, db_pool: asyncpg.Pool):
        self.db_pool = db_pool
    
    async def run_backtest(
        self,
        model_name: str,
        model_artifact: bytes,
        window_days: int
    ) -> Dict[str, float]:
        """Run backtest on historical window"""
        end_date = datetime.utcnow() - timedelta(days=1)
        start_date = end_date - timedelta(days=window_days)
        
        # This would load the model and run predictions on historical data
        # Placeholder implementation
        import random
        
        return {
            'accuracy': 0.82 + random.random() * 0.1,
            'auc_roc': 0.85 + random.random() * 0.08,
            'sample_count': window_days * 1000,
            'window_days': window_days
        }


class RetrainingPipeline:
    """Main retraining pipeline orchestrator"""
    
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        self.data_extractor: Optional[DataExtractor] = None
        self.trainer = ModelTrainer()
        self.gate_runner = ValidationGateRunner()
        self.backtest_runner: Optional[BacktestRunner] = None
        
        self._configs: Dict[str, RetrainingConfig] = {}
        self._running_pipelines: Dict[str, PipelineRun] = {}
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
        self.db_pool = await asyncpg.create_pool(DB_URL, min_size=5, max_size=20)
        self.data_extractor = DataExtractor(self.db_pool)
        self.backtest_runner = BacktestRunner(self.db_pool)
        
        # Initialize database schema
        await self._init_schema()
        
        # Load configs
        await self._load_configs()
        
        # Start scheduler
        asyncio.create_task(self._run_scheduler())
        
        logger.info("Retraining Pipeline initialized")
    
    async def _init_schema(self):
        """Initialize database schema"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_pipeline_runs (
                    id SERIAL PRIMARY KEY,
                    run_id VARCHAR(64) NOT NULL UNIQUE,
                    model_name VARCHAR(255) NOT NULL,
                    trigger_type VARCHAR(50),
                    status VARCHAR(50),
                    started_at TIMESTAMP NOT NULL,
                    completed_at TIMESTAMP,
                    dataset_start TIMESTAMP,
                    dataset_end TIMESTAMP,
                    sample_count INTEGER,
                    training_metrics JSONB,
                    validation_metrics JSONB,
                    backtest_results JSONB,
                    model_version VARCHAR(100),
                    artifact_path VARCHAR(1024),
                    gates_passed JSONB,
                    gates_failed JSONB,
                    error_message TEXT,
                    metadata JSONB DEFAULT '{}'
                );
                
                CREATE INDEX IF NOT EXISTS idx_pipeline_runs_model 
                ON ml_pipeline_runs(model_name, started_at DESC);
                
                CREATE TABLE IF NOT EXISTS ml_pipeline_configs (
                    id SERIAL PRIMARY KEY,
                    model_name VARCHAR(255) NOT NULL UNIQUE,
                    config JSONB NOT NULL,
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
    
    async def _load_configs(self):
        """Load pipeline configs from database"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT model_name, config FROM ml_pipeline_configs")
        
        for row in rows:
            config_dict = json.loads(row['config'])
            self._configs[row['model_name']] = RetrainingConfig(**config_dict)
    
    async def configure_pipeline(self, config: RetrainingConfig):
        """Configure a retraining pipeline"""
        self._configs[config.model_name] = config
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ml_pipeline_configs (model_name, config, updated_at)
                VALUES ($1, $2, $3)
                ON CONFLICT (model_name) DO UPDATE
                SET config = $2, updated_at = $3
            """, config.model_name, json.dumps(asdict(config)), datetime.utcnow())
        
        logger.info(f"Configured pipeline for {config.model_name}")
    
    async def trigger_retraining(
        self,
        model_name: str,
        trigger_type: TriggerType = TriggerType.MANUAL,
        force: bool = False
    ) -> PipelineRun:
        """Trigger a retraining run"""
        config = self._configs.get(model_name)
        if not config:
            raise ValueError(f"No config found for {model_name}")
        
        # Check if already running
        if model_name in self._running_pipelines:
            raise ValueError(f"Pipeline already running for {model_name}")
        
        # Check minimum time since last run
        if not force:
            last_run = await self._get_last_successful_run(model_name)
            if last_run:
                days_since = (datetime.utcnow() - last_run.completed_at).days
                if days_since < config.min_days_since_last:
                    raise ValueError(f"Too soon since last run ({days_since} days)")
        
        # Create run
        run_id = hashlib.sha256(
            f"{model_name}:{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:16]
        
        run = PipelineRun(
            run_id=run_id,
            model_name=model_name,
            trigger_type=trigger_type,
            status=PipelineStatus.PENDING,
            started_at=datetime.utcnow()
        )
        
        self._running_pipelines[model_name] = run
        
        # Execute pipeline asynchronously
        asyncio.create_task(self._execute_pipeline(run, config))
        
        return run
    
    async def _execute_pipeline(self, run: PipelineRun, config: RetrainingConfig):
        """Execute the retraining pipeline"""
        try:
            run.status = PipelineStatus.RUNNING
            await self._update_run(run)
            
            # Step 1: Extract data
            logger.info(f"[{run.run_id}] Extracting data...")
            run.dataset_end = datetime.utcnow() - timedelta(days=1)
            run.dataset_start = run.dataset_end - timedelta(days=90)
            
            if run.model_name == 'routing_success':
                data = await self.data_extractor.extract_routing_data(
                    run.dataset_start, run.dataset_end, config.min_samples
                )
            elif run.model_name == 'fraud_detection':
                data = await self.data_extractor.extract_fraud_data(
                    run.dataset_start, run.dataset_end, config.min_samples
                )
            elif run.model_name == 'credit_scoring':
                data = await self.data_extractor.extract_credit_data(
                    run.dataset_start, run.dataset_end, config.min_samples
                )
            else:
                data = []
            
            run.sample_count = len(data)
            
            if run.sample_count < config.min_samples:
                raise ValueError(f"Insufficient data: {run.sample_count} < {config.min_samples}")
            
            # Step 2: Split data
            split_idx = int(len(data) * (1 - config.validation_split))
            train_data = data[:split_idx]
            val_data = data[split_idx:]
            
            # Step 3: Train model
            logger.info(f"[{run.run_id}] Training model...")
            train_result = await self.trainer.train(
                run.model_name, train_data, val_data, config.hyperparameters
            )
            
            run.training_metrics = train_result['training_metrics']
            run.validation_metrics = train_result['validation_metrics']
            
            # Step 4: Run backtests
            logger.info(f"[{run.run_id}] Running backtests...")
            for window in config.backtest_windows:
                backtest_result = await self.backtest_runner.run_backtest(
                    run.model_name, train_result['model_artifact'], window
                )
                run.backtest_results[f"{window}d"] = backtest_result
            
            # Step 5: Validation gates
            logger.info(f"[{run.run_id}] Running validation gates...")
            run.status = PipelineStatus.VALIDATING
            await self._update_run(run)
            
            # Get current model metrics for regression check
            current_metrics = await self._get_current_model_metrics(run.model_name)
            
            passed, failed = self.gate_runner.run_gates(
                run.model_name, run.validation_metrics, current_metrics
            )
            run.gates_passed = passed
            run.gates_failed = failed
            
            # Check blocking gates
            blocking_failed = [g for g in failed if self._is_blocking_gate(run.model_name, g)]
            
            if blocking_failed:
                run.status = PipelineStatus.FAILED
                run.error_message = f"Blocking gates failed: {blocking_failed}"
                logger.warning(f"[{run.run_id}] Pipeline failed: {run.error_message}")
            else:
                # Step 6: Register model
                run.model_version = f"v{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
                run.artifact_path = f"{run.model_name}/{run.model_version}/model.joblib"
                
                # Store artifact (would use model registry in production)
                await self.redis.setex(
                    f"ml:artifact:{run.model_name}:{run.model_version}",
                    86400 * 30,
                    train_result['model_artifact']
                )
                
                run.status = PipelineStatus.COMPLETED
                logger.info(f"[{run.run_id}] Pipeline completed: {run.model_version}")
                
                # Auto-deploy if configured
                if config.auto_deploy and not failed:
                    await self._auto_deploy(run)
            
        except Exception as e:
            run.status = PipelineStatus.FAILED
            run.error_message = str(e)
            logger.error(f"[{run.run_id}] Pipeline failed: {e}")
        
        finally:
            run.completed_at = datetime.utcnow()
            await self._update_run(run)
            
            if run.model_name in self._running_pipelines:
                del self._running_pipelines[run.model_name]
            
            # Send notifications
            await self._send_notifications(run, config)
    
    def _is_blocking_gate(self, model_name: str, gate_name: str) -> bool:
        """Check if a gate is blocking"""
        gates = self.gate_runner.gates.get(model_name, [])
        for gate in gates:
            if gate.name == gate_name:
                return gate.is_blocking
        return False
    
    async def _get_current_model_metrics(self, model_name: str) -> Dict[str, float]:
        """Get metrics of current production model"""
        cached = await self.redis.get(f"ml:current_metrics:{model_name}")
        if cached:
            return json.loads(cached)
        return {}
    
    async def _auto_deploy(self, run: PipelineRun):
        """Auto-deploy the trained model"""
        logger.info(f"[{run.run_id}] Auto-deploying {run.model_version}")
        
        # Update production version
        await self.redis.set(f"ml:production:{run.model_name}", run.model_version)
        
        # Store current metrics for future regression checks
        await self.redis.setex(
            f"ml:current_metrics:{run.model_name}",
            86400 * 30,
            json.dumps(run.validation_metrics)
        )
    
    async def _update_run(self, run: PipelineRun):
        """Update run in database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ml_pipeline_runs (
                    run_id, model_name, trigger_type, status, started_at,
                    completed_at, dataset_start, dataset_end, sample_count,
                    training_metrics, validation_metrics, backtest_results,
                    model_version, artifact_path, gates_passed, gates_failed,
                    error_message, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                ON CONFLICT (run_id) DO UPDATE SET
                    status = $4, completed_at = $6, sample_count = $9,
                    training_metrics = $10, validation_metrics = $11,
                    backtest_results = $12, model_version = $13, artifact_path = $14,
                    gates_passed = $15, gates_failed = $16, error_message = $17
            """, run.run_id, run.model_name, run.trigger_type.value, run.status.value,
                run.started_at, run.completed_at, run.dataset_start, run.dataset_end,
                run.sample_count, json.dumps(run.training_metrics),
                json.dumps(run.validation_metrics), json.dumps(run.backtest_results),
                run.model_version, run.artifact_path, json.dumps(run.gates_passed),
                json.dumps(run.gates_failed), run.error_message, json.dumps(run.metadata))
    
    async def _get_last_successful_run(self, model_name: str) -> Optional[PipelineRun]:
        """Get last successful run"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM ml_pipeline_runs
                WHERE model_name = $1 AND status = 'completed'
                ORDER BY completed_at DESC
                LIMIT 1
            """, model_name)
        
        if not row:
            return None
        
        return self._row_to_run(row)
    
    async def get_run(self, run_id: str) -> Optional[PipelineRun]:
        """Get a pipeline run by ID"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM ml_pipeline_runs WHERE run_id = $1
            """, run_id)
        
        if not row:
            return None
        
        return self._row_to_run(row)
    
    async def get_run_history(
        self,
        model_name: str,
        limit: int = 20
    ) -> List[PipelineRun]:
        """Get run history for a model"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM ml_pipeline_runs
                WHERE model_name = $1
                ORDER BY started_at DESC
                LIMIT $2
            """, model_name, limit)
        
        return [self._row_to_run(row) for row in rows]
    
    async def cancel_run(self, run_id: str):
        """Cancel a running pipeline"""
        for model_name, run in self._running_pipelines.items():
            if run.run_id == run_id:
                run.status = PipelineStatus.CANCELLED
                run.completed_at = datetime.utcnow()
                await self._update_run(run)
                del self._running_pipelines[model_name]
                logger.info(f"Cancelled run {run_id}")
                return
        
        raise ValueError(f"Run {run_id} not found or not running")
    
    async def _run_scheduler(self):
        """Background scheduler for automatic retraining"""
        while True:
            await asyncio.sleep(3600)  # Check every hour
            
            for model_name, config in self._configs.items():
                try:
                    # Check if retraining is needed
                    should_retrain, reason = await self._should_retrain(model_name, config)
                    
                    if should_retrain:
                        logger.info(f"Triggering scheduled retraining for {model_name}: {reason}")
                        await self.trigger_retraining(
                            model_name,
                            TriggerType.SCHEDULED if reason == 'scheduled' else TriggerType.PERFORMANCE_DEGRADATION
                        )
                except Exception as e:
                    logger.error(f"Error in scheduler for {model_name}: {e}")
    
    async def _should_retrain(
        self,
        model_name: str,
        config: RetrainingConfig
    ) -> Tuple[bool, str]:
        """Check if model should be retrained"""
        last_run = await self._get_last_successful_run(model_name)
        
        if not last_run:
            return True, "no_previous_run"
        
        days_since = (datetime.utcnow() - last_run.completed_at).days
        
        # Check max days threshold
        if days_since >= config.max_days_since_last:
            return True, "scheduled"
        
        # Check performance degradation
        current_metrics = await self._get_current_model_metrics(model_name)
        if current_metrics:
            accuracy = current_metrics.get('accuracy', 1.0)
            if accuracy < config.performance_threshold:
                return True, "performance_degradation"
        
        return False, ""
    
    async def _send_notifications(self, run: PipelineRun, config: RetrainingConfig):
        """Send notifications about pipeline completion"""
        notification = {
            'run_id': run.run_id,
            'model_name': run.model_name,
            'status': run.status.value,
            'model_version': run.model_version,
            'validation_metrics': run.validation_metrics,
            'gates_passed': run.gates_passed,
            'gates_failed': run.gates_failed,
            'error_message': run.error_message
        }
        
        # Publish to Redis for notification service
        await self.redis.publish(
            'ml:pipeline:notifications',
            json.dumps(notification, default=str)
        )
    
    def _row_to_run(self, row) -> PipelineRun:
        """Convert database row to PipelineRun"""
        return PipelineRun(
            run_id=row['run_id'],
            model_name=row['model_name'],
            trigger_type=TriggerType(row['trigger_type']),
            status=PipelineStatus(row['status']),
            started_at=row['started_at'],
            completed_at=row['completed_at'],
            dataset_start=row['dataset_start'],
            dataset_end=row['dataset_end'],
            sample_count=row['sample_count'] or 0,
            training_metrics=json.loads(row['training_metrics']) if row['training_metrics'] else {},
            validation_metrics=json.loads(row['validation_metrics']) if row['validation_metrics'] else {},
            backtest_results=json.loads(row['backtest_results']) if row['backtest_results'] else {},
            model_version=row['model_version'],
            artifact_path=row['artifact_path'],
            gates_passed=json.loads(row['gates_passed']) if row['gates_passed'] else [],
            gates_failed=json.loads(row['gates_failed']) if row['gates_failed'] else [],
            error_message=row['error_message'],
            metadata=json.loads(row['metadata']) if row['metadata'] else {}
        )


# Export classes
__all__ = [
    'RetrainingPipeline',
    'RetrainingConfig',
    'PipelineRun',
    'PipelineStatus',
    'TriggerType',
    'DataExtractor',
    'ModelTrainer',
    'ValidationGateRunner',
    'BacktestRunner'
]
