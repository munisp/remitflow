"""
Safe Deployment Controls for ML Models
Shadow mode, canary deployments, and A/B testing
"""

import os
import json
import logging
import hashlib
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
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


class DeploymentMode(str, Enum):
    """Deployment modes"""
    PRODUCTION = "production"      # 100% traffic to production model
    SHADOW = "shadow"              # Production serves, shadow logs predictions
    CANARY = "canary"              # Small % to canary, rest to production
    AB_TEST = "ab_test"            # Split traffic for A/B testing
    BLUE_GREEN = "blue_green"      # Switch between blue/green deployments


class TrafficSplitStrategy(str, Enum):
    """Traffic split strategies"""
    RANDOM = "random"              # Random assignment
    USER_HASH = "user_hash"        # Consistent per user
    FEATURE_FLAG = "feature_flag"  # Based on feature flags
    GRADUAL = "gradual"            # Gradually increase traffic


@dataclass
class DeploymentConfig:
    """Configuration for a deployment"""
    model_name: str
    mode: DeploymentMode
    production_version: str
    candidate_version: Optional[str] = None
    traffic_percentage: float = 0.0  # % to candidate (0-100)
    split_strategy: TrafficSplitStrategy = TrafficSplitStrategy.RANDOM
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    success_threshold: float = 0.95  # Min success rate for promotion
    latency_threshold_ms: float = 5000  # Max p99 latency
    min_samples: int = 1000  # Min samples before evaluation
    auto_promote: bool = False
    auto_rollback: bool = True
    rollback_threshold: float = 0.90  # Rollback if below this
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RoutingDecision:
    """Decision on which model to use"""
    model_name: str
    selected_version: str
    is_candidate: bool
    is_shadow: bool
    cohort: str  # 'control' or 'treatment'
    request_id: str
    user_id: Optional[str] = None
    decision_reason: str = ""


@dataclass
class ExperimentMetrics:
    """Metrics for an A/B experiment"""
    experiment_id: str
    model_name: str
    control_version: str
    treatment_version: str
    start_time: datetime
    end_time: Optional[datetime]
    control_samples: int
    treatment_samples: int
    control_success_rate: float
    treatment_success_rate: float
    control_latency_p50: float
    treatment_latency_p50: float
    control_latency_p99: float
    treatment_latency_p99: float
    statistical_significance: float
    lift: float  # % improvement
    is_significant: bool
    recommendation: str


class SafeDeploymentManager:
    """Manages safe deployment of ML models"""
    
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        self._configs: Dict[str, DeploymentConfig] = {}
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
        self.db_pool = await asyncpg.create_pool(DB_URL, min_size=5, max_size=20)
        
        # Load existing configs from Redis
        await self._load_configs()
        
        # Start background monitoring
        asyncio.create_task(self._monitor_deployments())
        
        logger.info("Safe Deployment Manager initialized")
    
    async def _load_configs(self):
        """Load deployment configs from Redis"""
        keys = await self.redis.keys("ml:deployment:config:*")
        for key in keys:
            data = await self.redis.get(key)
            if data:
                config_dict = json.loads(data)
                model_name = config_dict['model_name']
                self._configs[model_name] = self._dict_to_config(config_dict)
    
    async def configure_deployment(self, config: DeploymentConfig):
        """Configure deployment for a model"""
        self._configs[config.model_name] = config
        
        # Store in Redis
        await self.redis.set(
            f"ml:deployment:config:{config.model_name}",
            json.dumps(asdict(config), default=str)
        )
        
        # Log configuration change
        await self._log_config_change(config)
        
        logger.info(f"Configured {config.mode} deployment for {config.model_name}")
    
    async def start_shadow_deployment(
        self,
        model_name: str,
        production_version: str,
        shadow_version: str,
        duration_hours: int = 24
    ) -> DeploymentConfig:
        """Start shadow deployment"""
        config = DeploymentConfig(
            model_name=model_name,
            mode=DeploymentMode.SHADOW,
            production_version=production_version,
            candidate_version=shadow_version,
            traffic_percentage=100,  # Shadow gets all traffic (but doesn't serve)
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow() + timedelta(hours=duration_hours)
        )
        
        await self.configure_deployment(config)
        return config
    
    async def start_canary_deployment(
        self,
        model_name: str,
        production_version: str,
        canary_version: str,
        initial_percentage: float = 5.0,
        max_percentage: float = 50.0,
        ramp_hours: int = 24,
        auto_promote: bool = False
    ) -> DeploymentConfig:
        """Start canary deployment with gradual traffic increase"""
        config = DeploymentConfig(
            model_name=model_name,
            mode=DeploymentMode.CANARY,
            production_version=production_version,
            candidate_version=canary_version,
            traffic_percentage=initial_percentage,
            split_strategy=TrafficSplitStrategy.GRADUAL,
            start_time=datetime.utcnow(),
            auto_promote=auto_promote,
            auto_rollback=True,
            metadata={
                'max_percentage': max_percentage,
                'ramp_hours': ramp_hours,
                'ramp_step': (max_percentage - initial_percentage) / ramp_hours
            }
        )
        
        await self.configure_deployment(config)
        return config
    
    async def start_ab_test(
        self,
        model_name: str,
        control_version: str,
        treatment_version: str,
        traffic_percentage: float = 50.0,
        duration_hours: int = 168,  # 1 week
        min_samples: int = 10000
    ) -> str:
        """Start A/B test experiment"""
        experiment_id = hashlib.sha256(
            f"{model_name}:{control_version}:{treatment_version}:{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:16]
        
        config = DeploymentConfig(
            model_name=model_name,
            mode=DeploymentMode.AB_TEST,
            production_version=control_version,
            candidate_version=treatment_version,
            traffic_percentage=traffic_percentage,
            split_strategy=TrafficSplitStrategy.USER_HASH,
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow() + timedelta(hours=duration_hours),
            min_samples=min_samples,
            metadata={'experiment_id': experiment_id}
        )
        
        await self.configure_deployment(config)
        
        # Store experiment record
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ml_experiments (
                    experiment_id, model_name, control_version, treatment_version,
                    traffic_percentage, start_time, end_time, min_samples, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, experiment_id, model_name, control_version, treatment_version,
                traffic_percentage, config.start_time, config.end_time, min_samples, 'running')
        
        logger.info(f"Started A/B test {experiment_id} for {model_name}")
        return experiment_id
    
    async def route_request(
        self,
        model_name: str,
        request_id: str,
        user_id: str = None,
        features: Dict[str, Any] = None
    ) -> RoutingDecision:
        """Route a request to the appropriate model version"""
        config = self._configs.get(model_name)
        
        if not config:
            # No special deployment, use production
            prod_version = await self._get_production_version(model_name)
            return RoutingDecision(
                model_name=model_name,
                selected_version=prod_version,
                is_candidate=False,
                is_shadow=False,
                cohort='control',
                request_id=request_id,
                user_id=user_id,
                decision_reason='no_deployment_config'
            )
        
        # Check if deployment is still active
        if config.end_time and datetime.utcnow() > config.end_time:
            return RoutingDecision(
                model_name=model_name,
                selected_version=config.production_version,
                is_candidate=False,
                is_shadow=False,
                cohort='control',
                request_id=request_id,
                user_id=user_id,
                decision_reason='deployment_ended'
            )
        
        # Route based on deployment mode
        if config.mode == DeploymentMode.SHADOW:
            return await self._route_shadow(config, request_id, user_id)
        elif config.mode == DeploymentMode.CANARY:
            return await self._route_canary(config, request_id, user_id)
        elif config.mode == DeploymentMode.AB_TEST:
            return await self._route_ab_test(config, request_id, user_id)
        else:
            return RoutingDecision(
                model_name=model_name,
                selected_version=config.production_version,
                is_candidate=False,
                is_shadow=False,
                cohort='control',
                request_id=request_id,
                user_id=user_id,
                decision_reason='production_mode'
            )
    
    async def _route_shadow(
        self,
        config: DeploymentConfig,
        request_id: str,
        user_id: str = None
    ) -> RoutingDecision:
        """Route for shadow deployment - always serve production, log shadow"""
        return RoutingDecision(
            model_name=config.model_name,
            selected_version=config.production_version,
            is_candidate=False,
            is_shadow=True,  # Indicates shadow should also run
            cohort='control',
            request_id=request_id,
            user_id=user_id,
            decision_reason='shadow_mode'
        )
    
    async def _route_canary(
        self,
        config: DeploymentConfig,
        request_id: str,
        user_id: str = None
    ) -> RoutingDecision:
        """Route for canary deployment"""
        # Determine if this request goes to canary
        if config.split_strategy == TrafficSplitStrategy.USER_HASH and user_id:
            # Consistent routing per user
            hash_val = int(hashlib.md5(user_id.encode()).hexdigest(), 16) % 100
            is_canary = hash_val < config.traffic_percentage
        else:
            # Random routing
            is_canary = random.random() * 100 < config.traffic_percentage
        
        return RoutingDecision(
            model_name=config.model_name,
            selected_version=config.candidate_version if is_canary else config.production_version,
            is_candidate=is_canary,
            is_shadow=False,
            cohort='treatment' if is_canary else 'control',
            request_id=request_id,
            user_id=user_id,
            decision_reason=f'canary_{config.traffic_percentage}%'
        )
    
    async def _route_ab_test(
        self,
        config: DeploymentConfig,
        request_id: str,
        user_id: str = None
    ) -> RoutingDecision:
        """Route for A/B test"""
        # Use user hash for consistent assignment
        if user_id:
            hash_val = int(hashlib.md5(user_id.encode()).hexdigest(), 16) % 100
            is_treatment = hash_val < config.traffic_percentage
        else:
            # Fall back to request hash for anonymous users
            hash_val = int(hashlib.md5(request_id.encode()).hexdigest(), 16) % 100
            is_treatment = hash_val < config.traffic_percentage
        
        return RoutingDecision(
            model_name=config.model_name,
            selected_version=config.candidate_version if is_treatment else config.production_version,
            is_candidate=is_treatment,
            is_shadow=False,
            cohort='treatment' if is_treatment else 'control',
            request_id=request_id,
            user_id=user_id,
            decision_reason=f'ab_test_{config.metadata.get("experiment_id", "unknown")}'
        )
    
    async def record_shadow_prediction(
        self,
        model_name: str,
        request_id: str,
        production_prediction: float,
        shadow_prediction: float,
        production_latency_ms: float,
        shadow_latency_ms: float
    ):
        """Record shadow prediction for comparison"""
        await self.redis.lpush(
            f"ml:shadow:{model_name}",
            json.dumps({
                'request_id': request_id,
                'timestamp': datetime.utcnow().isoformat(),
                'production_prediction': production_prediction,
                'shadow_prediction': shadow_prediction,
                'production_latency_ms': production_latency_ms,
                'shadow_latency_ms': shadow_latency_ms,
                'prediction_diff': abs(production_prediction - shadow_prediction)
            })
        )
        await self.redis.ltrim(f"ml:shadow:{model_name}", 0, 99999)
    
    async def record_experiment_outcome(
        self,
        model_name: str,
        request_id: str,
        cohort: str,
        model_version: str,
        prediction: float,
        actual: float,
        latency_ms: float,
        was_successful: bool
    ):
        """Record outcome for experiment analysis"""
        config = self._configs.get(model_name)
        if not config or config.mode != DeploymentMode.AB_TEST:
            return
        
        experiment_id = config.metadata.get('experiment_id')
        if not experiment_id:
            return
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ml_experiment_outcomes (
                    experiment_id, request_id, cohort, model_version,
                    prediction, actual, latency_ms, was_successful, timestamp
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, experiment_id, request_id, cohort, model_version,
                prediction, actual, latency_ms, was_successful, datetime.utcnow())
    
    async def get_experiment_metrics(
        self,
        experiment_id: str
    ) -> Optional[ExperimentMetrics]:
        """Get metrics for an A/B experiment"""
        async with self.db_pool.acquire() as conn:
            # Get experiment info
            exp_row = await conn.fetchrow("""
                SELECT * FROM ml_experiments WHERE experiment_id = $1
            """, experiment_id)
            
            if not exp_row:
                return None
            
            # Get control metrics
            control_row = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as samples,
                    AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END) as success_rate,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as latency_p50,
                    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as latency_p99
                FROM ml_experiment_outcomes
                WHERE experiment_id = $1 AND cohort = 'control'
            """, experiment_id)
            
            # Get treatment metrics
            treatment_row = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as samples,
                    AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END) as success_rate,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as latency_p50,
                    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as latency_p99
                FROM ml_experiment_outcomes
                WHERE experiment_id = $1 AND cohort = 'treatment'
            """, experiment_id)
        
        control_success = float(control_row['success_rate'] or 0)
        treatment_success = float(treatment_row['success_rate'] or 0)
        
        # Calculate lift
        lift = ((treatment_success - control_success) / control_success * 100) if control_success > 0 else 0
        
        # Simple statistical significance (z-test approximation)
        n1 = control_row['samples'] or 0
        n2 = treatment_row['samples'] or 0
        
        if n1 > 0 and n2 > 0:
            p1, p2 = control_success, treatment_success
            p_pooled = (p1 * n1 + p2 * n2) / (n1 + n2)
            se = (p_pooled * (1 - p_pooled) * (1/n1 + 1/n2)) ** 0.5
            z_score = abs(p2 - p1) / se if se > 0 else 0
            # Approximate p-value (two-tailed)
            significance = min(1.0, 2 * (1 - self._norm_cdf(z_score)))
        else:
            significance = 1.0
        
        is_significant = significance < 0.05 and n1 >= exp_row['min_samples'] and n2 >= exp_row['min_samples']
        
        # Recommendation
        if not is_significant:
            recommendation = "Continue experiment - insufficient data or not significant"
        elif lift > 0:
            recommendation = f"Promote treatment - {lift:.1f}% improvement"
        else:
            recommendation = f"Keep control - treatment {-lift:.1f}% worse"
        
        return ExperimentMetrics(
            experiment_id=experiment_id,
            model_name=exp_row['model_name'],
            control_version=exp_row['control_version'],
            treatment_version=exp_row['treatment_version'],
            start_time=exp_row['start_time'],
            end_time=exp_row['end_time'],
            control_samples=n1,
            treatment_samples=n2,
            control_success_rate=control_success,
            treatment_success_rate=treatment_success,
            control_latency_p50=float(control_row['latency_p50'] or 0),
            treatment_latency_p50=float(treatment_row['latency_p50'] or 0),
            control_latency_p99=float(control_row['latency_p99'] or 0),
            treatment_latency_p99=float(treatment_row['latency_p99'] or 0),
            statistical_significance=significance,
            lift=lift,
            is_significant=is_significant,
            recommendation=recommendation
        )
    
    async def get_shadow_comparison(
        self,
        model_name: str,
        limit: int = 1000
    ) -> Dict[str, Any]:
        """Get shadow vs production comparison"""
        records = await self.redis.lrange(f"ml:shadow:{model_name}", 0, limit - 1)
        
        if not records:
            return {'status': 'no_data'}
        
        data = [json.loads(r) for r in records]
        
        prod_latencies = [d['production_latency_ms'] for d in data]
        shadow_latencies = [d['shadow_latency_ms'] for d in data]
        prediction_diffs = [d['prediction_diff'] for d in data]
        
        import numpy as np
        
        return {
            'sample_count': len(data),
            'production': {
                'latency_mean': np.mean(prod_latencies),
                'latency_p50': np.percentile(prod_latencies, 50),
                'latency_p99': np.percentile(prod_latencies, 99)
            },
            'shadow': {
                'latency_mean': np.mean(shadow_latencies),
                'latency_p50': np.percentile(shadow_latencies, 50),
                'latency_p99': np.percentile(shadow_latencies, 99)
            },
            'prediction_diff': {
                'mean': np.mean(prediction_diffs),
                'max': max(prediction_diffs),
                'std': np.std(prediction_diffs)
            }
        }
    
    async def stop_deployment(self, model_name: str):
        """Stop special deployment and revert to production only"""
        if model_name in self._configs:
            del self._configs[model_name]
        
        await self.redis.delete(f"ml:deployment:config:{model_name}")
        logger.info(f"Stopped deployment for {model_name}")
    
    async def promote_canary(self, model_name: str):
        """Promote canary to production"""
        config = self._configs.get(model_name)
        if not config or config.mode != DeploymentMode.CANARY:
            raise ValueError("No canary deployment found")
        
        # Update production version
        await self.redis.set(f"ml:production:{model_name}", config.candidate_version)
        
        # Stop canary deployment
        await self.stop_deployment(model_name)
        
        logger.info(f"Promoted canary {config.candidate_version} to production for {model_name}")
    
    async def rollback_canary(self, model_name: str, reason: str):
        """Rollback canary deployment"""
        config = self._configs.get(model_name)
        if not config:
            return
        
        # Log rollback
        await self.redis.lpush(
            f"ml:rollbacks:{model_name}",
            json.dumps({
                'timestamp': datetime.utcnow().isoformat(),
                'candidate_version': config.candidate_version,
                'production_version': config.production_version,
                'reason': reason
            })
        )
        
        # Stop deployment
        await self.stop_deployment(model_name)
        
        logger.warning(f"Rolled back canary for {model_name}: {reason}")
    
    async def _monitor_deployments(self):
        """Background task to monitor deployments"""
        while True:
            await asyncio.sleep(60)  # Check every minute
            
            for model_name, config in list(self._configs.items()):
                try:
                    await self._check_deployment_health(model_name, config)
                except Exception as e:
                    logger.error(f"Error monitoring {model_name}: {e}")
    
    async def _check_deployment_health(
        self,
        model_name: str,
        config: DeploymentConfig
    ):
        """Check health of a deployment"""
        if config.mode == DeploymentMode.CANARY:
            # Get canary metrics
            metrics = await self._get_canary_metrics(model_name, config)
            
            if metrics:
                # Check for auto-rollback
                if config.auto_rollback and metrics['success_rate'] < config.rollback_threshold:
                    await self.rollback_canary(
                        model_name,
                        f"Success rate {metrics['success_rate']:.2%} below threshold {config.rollback_threshold:.2%}"
                    )
                    return
                
                # Check for auto-promote
                if config.auto_promote:
                    if (metrics['sample_count'] >= config.min_samples and
                        metrics['success_rate'] >= config.success_threshold and
                        metrics['latency_p99'] <= config.latency_threshold_ms):
                        await self.promote_canary(model_name)
                        return
                
                # Gradual traffic increase
                if config.split_strategy == TrafficSplitStrategy.GRADUAL:
                    max_pct = config.metadata.get('max_percentage', 50)
                    step = config.metadata.get('ramp_step', 5)
                    
                    if config.traffic_percentage < max_pct:
                        config.traffic_percentage = min(
                            config.traffic_percentage + step,
                            max_pct
                        )
                        await self.configure_deployment(config)
    
    async def _get_canary_metrics(
        self,
        model_name: str,
        config: DeploymentConfig
    ) -> Optional[Dict[str, Any]]:
        """Get metrics for canary version"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as sample_count,
                    AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END) as success_rate,
                    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY actual_latency_ms) as latency_p99
                FROM routing_metrics
                WHERE model_version = $1
                AND created_at >= $2
            """, config.candidate_version, config.start_time)
        
        if not row or row['sample_count'] == 0:
            return None
        
        return {
            'sample_count': row['sample_count'],
            'success_rate': float(row['success_rate'] or 0),
            'latency_p99': float(row['latency_p99'] or 0)
        }
    
    async def _get_production_version(self, model_name: str) -> str:
        """Get current production version"""
        version = await self.redis.get(f"ml:production:{model_name}")
        return version or "v1"
    
    async def _log_config_change(self, config: DeploymentConfig):
        """Log configuration change"""
        await self.redis.lpush(
            f"ml:deployment:history:{config.model_name}",
            json.dumps(asdict(config), default=str)
        )
        await self.redis.ltrim(f"ml:deployment:history:{config.model_name}", 0, 99)
    
    def _dict_to_config(self, data: Dict) -> DeploymentConfig:
        """Convert dict to DeploymentConfig"""
        return DeploymentConfig(
            model_name=data['model_name'],
            mode=DeploymentMode(data['mode']),
            production_version=data['production_version'],
            candidate_version=data.get('candidate_version'),
            traffic_percentage=data.get('traffic_percentage', 0),
            split_strategy=TrafficSplitStrategy(data.get('split_strategy', 'random')),
            start_time=datetime.fromisoformat(data['start_time']) if data.get('start_time') else None,
            end_time=datetime.fromisoformat(data['end_time']) if data.get('end_time') else None,
            success_threshold=data.get('success_threshold', 0.95),
            latency_threshold_ms=data.get('latency_threshold_ms', 5000),
            min_samples=data.get('min_samples', 1000),
            auto_promote=data.get('auto_promote', False),
            auto_rollback=data.get('auto_rollback', True),
            rollback_threshold=data.get('rollback_threshold', 0.90),
            metadata=data.get('metadata', {})
        )
    
    @staticmethod
    def _norm_cdf(x: float) -> float:
        """Approximate normal CDF"""
        import math
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))


# Export classes
__all__ = [
    'SafeDeploymentManager',
    'DeploymentConfig',
    'DeploymentMode',
    'TrafficSplitStrategy',
    'RoutingDecision',
    'ExperimentMetrics'
]
