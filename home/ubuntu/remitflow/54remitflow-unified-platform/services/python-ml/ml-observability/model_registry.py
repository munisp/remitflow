"""
Enhanced Model Registry with Full Lifecycle Tracking
Production-grade model versioning, deployment, and rollback
"""

import os
import json
import logging
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum
import asyncio

import asyncpg
import redis.asyncio as redis
import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'redis.remittance.svc.cluster.local')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_URL = os.getenv('REDIS_URL', f'redis://{REDIS_HOST}:{REDIS_PORT}')
DB_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank')
S3_ENDPOINT = os.getenv('S3_ENDPOINT', 'http://rustfs.remittance.svc.cluster.local:9000')
S3_MODEL_BUCKET = os.getenv('S3_MODEL_BUCKET', 'ml-model-registry')
S3_ACCESS_KEY = os.getenv('S3_ACCESS_KEY', 'minioadmin')
S3_SECRET_KEY = os.getenv('S3_SECRET_KEY', 'minioadmin')


class ModelStage(str, Enum):
    """Model deployment stages"""
    DEVELOPMENT = "development"
    STAGING = "staging"
    CANARY = "canary"
    PRODUCTION = "production"
    ARCHIVED = "archived"
    ROLLBACK = "rollback"


class ModelStatus(str, Enum):
    """Model status"""
    REGISTERED = "registered"
    VALIDATING = "validating"
    VALIDATED = "validated"
    DEPLOYING = "deploying"
    DEPLOYED = "deployed"
    FAILED = "failed"
    RETIRED = "retired"


@dataclass
class ModelArtifact:
    """Model artifact metadata"""
    artifact_id: str
    model_name: str
    model_version: str
    artifact_path: str
    artifact_hash: str
    artifact_size_bytes: int
    created_at: datetime
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ModelVersion:
    """Complete model version record"""
    model_name: str
    model_version: str
    stage: ModelStage
    status: ModelStatus
    created_at: datetime
    updated_at: datetime
    
    # Training metadata
    training_dataset_start: Optional[datetime] = None
    training_dataset_end: Optional[datetime] = None
    training_sample_count: int = 0
    feature_schema_hash: str = ""
    hyperparameters: Dict[str, Any] = field(default_factory=dict)
    
    # Code versioning
    code_commit: str = ""
    code_branch: str = ""
    code_repo: str = ""
    
    # Artifacts
    artifact_path: str = ""
    artifact_hash: str = ""
    artifact_size_bytes: int = 0
    
    # Evaluation metrics
    evaluation_metrics: Dict[str, float] = field(default_factory=dict)
    validation_metrics: Dict[str, float] = field(default_factory=dict)
    
    # Deployment info
    deployed_at: Optional[datetime] = None
    deployed_by: str = ""
    rollback_version: Optional[str] = None
    
    # Approval
    approved_by: str = ""
    approved_at: Optional[datetime] = None
    approval_notes: str = ""
    
    # Tags and description
    tags: List[str] = field(default_factory=list)
    description: str = ""


@dataclass
class DeploymentRecord:
    """Record of a model deployment"""
    deployment_id: str
    model_name: str
    model_version: str
    stage: ModelStage
    deployed_at: datetime
    deployed_by: str
    previous_version: Optional[str] = None
    deployment_config: Dict[str, Any] = field(default_factory=dict)
    status: str = "success"
    rollback_reason: str = ""


class EnhancedModelRegistry:
    """Enhanced model registry with full lifecycle management"""
    
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        self.s3_client = None
    
    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(REDIS_URL)
        self.db_pool = await asyncpg.create_pool(DB_URL, min_size=5, max_size=20)
        
        # Initialize S3 client for RustFS
        self.s3_client = boto3.client(
            's3',
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            config=Config(signature_version='s3v4')
        )
        
        # Ensure bucket exists
        try:
            self.s3_client.head_bucket(Bucket=S3_MODEL_BUCKET)
        except Exception:
            try:
                self.s3_client.create_bucket(Bucket=S3_MODEL_BUCKET)
            except Exception as e:
                logger.warning(f"Could not create bucket: {e}")
        
        # Initialize database schema
        await self._init_schema()
        
        logger.info("Enhanced Model Registry initialized")
    
    async def _init_schema(self):
        """Initialize database schema"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_model_versions (
                    id SERIAL PRIMARY KEY,
                    model_name VARCHAR(255) NOT NULL,
                    model_version VARCHAR(100) NOT NULL,
                    stage VARCHAR(50) NOT NULL DEFAULT 'development',
                    status VARCHAR(50) NOT NULL DEFAULT 'registered',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    
                    -- Training metadata
                    training_dataset_start TIMESTAMP,
                    training_dataset_end TIMESTAMP,
                    training_sample_count INTEGER DEFAULT 0,
                    feature_schema_hash VARCHAR(64),
                    hyperparameters JSONB DEFAULT '{}',
                    
                    -- Code versioning
                    code_commit VARCHAR(64),
                    code_branch VARCHAR(255),
                    code_repo VARCHAR(255),
                    
                    -- Artifacts
                    artifact_path VARCHAR(1024),
                    artifact_hash VARCHAR(64),
                    artifact_size_bytes BIGINT DEFAULT 0,
                    
                    -- Evaluation metrics
                    evaluation_metrics JSONB DEFAULT '{}',
                    validation_metrics JSONB DEFAULT '{}',
                    
                    -- Deployment info
                    deployed_at TIMESTAMP,
                    deployed_by VARCHAR(255),
                    rollback_version VARCHAR(100),
                    
                    -- Approval
                    approved_by VARCHAR(255),
                    approved_at TIMESTAMP,
                    approval_notes TEXT,
                    
                    -- Tags and description
                    tags JSONB DEFAULT '[]',
                    description TEXT,
                    
                    UNIQUE(model_name, model_version)
                );
                
                CREATE INDEX IF NOT EXISTS idx_model_versions_name_stage 
                ON ml_model_versions(model_name, stage);
                
                CREATE INDEX IF NOT EXISTS idx_model_versions_status 
                ON ml_model_versions(status);
                
                CREATE TABLE IF NOT EXISTS ml_deployment_history (
                    id SERIAL PRIMARY KEY,
                    deployment_id VARCHAR(64) NOT NULL UNIQUE,
                    model_name VARCHAR(255) NOT NULL,
                    model_version VARCHAR(100) NOT NULL,
                    stage VARCHAR(50) NOT NULL,
                    deployed_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    deployed_by VARCHAR(255),
                    previous_version VARCHAR(100),
                    deployment_config JSONB DEFAULT '{}',
                    status VARCHAR(50) DEFAULT 'success',
                    rollback_reason TEXT
                );
                
                CREATE INDEX IF NOT EXISTS idx_deployment_history_model 
                ON ml_deployment_history(model_name, deployed_at DESC);
            """)
    
    async def register_model(
        self,
        model_name: str,
        model_version: str,
        artifact_data: bytes,
        training_metadata: Dict[str, Any],
        evaluation_metrics: Dict[str, float],
        code_info: Dict[str, str] = None,
        description: str = "",
        tags: List[str] = None
    ) -> ModelVersion:
        """Register a new model version"""
        # Calculate artifact hash
        artifact_hash = hashlib.sha256(artifact_data).hexdigest()
        artifact_size = len(artifact_data)
        
        # Upload artifact to S3
        artifact_path = f"{model_name}/{model_version}/model.joblib"
        self.s3_client.put_object(
            Bucket=S3_MODEL_BUCKET,
            Key=artifact_path,
            Body=artifact_data
        )
        
        # Create model version record
        model_version_record = ModelVersion(
            model_name=model_name,
            model_version=model_version,
            stage=ModelStage.DEVELOPMENT,
            status=ModelStatus.REGISTERED,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            training_dataset_start=training_metadata.get('dataset_start'),
            training_dataset_end=training_metadata.get('dataset_end'),
            training_sample_count=training_metadata.get('sample_count', 0),
            feature_schema_hash=training_metadata.get('schema_hash', ''),
            hyperparameters=training_metadata.get('hyperparameters', {}),
            code_commit=code_info.get('commit', '') if code_info else '',
            code_branch=code_info.get('branch', '') if code_info else '',
            code_repo=code_info.get('repo', '') if code_info else '',
            artifact_path=artifact_path,
            artifact_hash=artifact_hash,
            artifact_size_bytes=artifact_size,
            evaluation_metrics=evaluation_metrics,
            description=description,
            tags=tags or []
        )
        
        # Store in database
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO ml_model_versions (
                    model_name, model_version, stage, status, created_at, updated_at,
                    training_dataset_start, training_dataset_end, training_sample_count,
                    feature_schema_hash, hyperparameters, code_commit, code_branch, code_repo,
                    artifact_path, artifact_hash, artifact_size_bytes, evaluation_metrics,
                    description, tags
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            """, 
                model_name, model_version, ModelStage.DEVELOPMENT.value, ModelStatus.REGISTERED.value,
                model_version_record.created_at, model_version_record.updated_at,
                model_version_record.training_dataset_start, model_version_record.training_dataset_end,
                model_version_record.training_sample_count, model_version_record.feature_schema_hash,
                json.dumps(model_version_record.hyperparameters),
                model_version_record.code_commit, model_version_record.code_branch, model_version_record.code_repo,
                artifact_path, artifact_hash, artifact_size,
                json.dumps(evaluation_metrics), description, json.dumps(tags or [])
            )
        
        # Update Redis cache
        await self._update_cache(model_name, model_version, model_version_record)
        
        logger.info(f"Registered model: {model_name} v{model_version}")
        return model_version_record
    
    async def get_model_version(
        self,
        model_name: str,
        model_version: str
    ) -> Optional[ModelVersion]:
        """Get a specific model version"""
        # Check cache first
        cache_key = f"ml:registry:{model_name}:{model_version}"
        cached = await self.redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            return self._dict_to_model_version(data)
        
        # Fetch from database
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM ml_model_versions
                WHERE model_name = $1 AND model_version = $2
            """, model_name, model_version)
        
        if not row:
            return None
        
        model_ver = self._row_to_model_version(row)
        await self._update_cache(model_name, model_version, model_ver)
        return model_ver
    
    async def get_latest_version(
        self,
        model_name: str,
        stage: ModelStage = None
    ) -> Optional[ModelVersion]:
        """Get the latest model version, optionally filtered by stage"""
        async with self.db_pool.acquire() as conn:
            if stage:
                row = await conn.fetchrow("""
                    SELECT * FROM ml_model_versions
                    WHERE model_name = $1 AND stage = $2
                    ORDER BY created_at DESC
                    LIMIT 1
                """, model_name, stage.value)
            else:
                row = await conn.fetchrow("""
                    SELECT * FROM ml_model_versions
                    WHERE model_name = $1
                    ORDER BY created_at DESC
                    LIMIT 1
                """, model_name)
        
        if not row:
            return None
        
        return self._row_to_model_version(row)
    
    async def get_production_version(self, model_name: str) -> Optional[ModelVersion]:
        """Get the current production version"""
        return await self.get_latest_version(model_name, ModelStage.PRODUCTION)
    
    async def promote_model(
        self,
        model_name: str,
        model_version: str,
        target_stage: ModelStage,
        promoted_by: str,
        validation_metrics: Dict[str, float] = None,
        notes: str = ""
    ) -> ModelVersion:
        """Promote a model to a new stage"""
        model_ver = await self.get_model_version(model_name, model_version)
        if not model_ver:
            raise ValueError(f"Model not found: {model_name} v{model_version}")
        
        # Validate promotion path
        valid_promotions = {
            ModelStage.DEVELOPMENT: [ModelStage.STAGING],
            ModelStage.STAGING: [ModelStage.CANARY, ModelStage.PRODUCTION],
            ModelStage.CANARY: [ModelStage.PRODUCTION, ModelStage.STAGING],
            ModelStage.PRODUCTION: [ModelStage.ARCHIVED],
            ModelStage.ROLLBACK: [ModelStage.PRODUCTION],
        }
        
        if target_stage not in valid_promotions.get(model_ver.stage, []):
            raise ValueError(f"Invalid promotion: {model_ver.stage} -> {target_stage}")
        
        # Update model version
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE ml_model_versions
                SET stage = $3, status = $4, updated_at = $5,
                    validation_metrics = $6, approved_by = $7, approved_at = $8, approval_notes = $9
                WHERE model_name = $1 AND model_version = $2
            """, model_name, model_version, target_stage.value, ModelStatus.VALIDATED.value,
                datetime.utcnow(), json.dumps(validation_metrics or {}),
                promoted_by, datetime.utcnow(), notes)
        
        # Invalidate cache
        await self.redis.delete(f"ml:registry:{model_name}:{model_version}")
        
        logger.info(f"Promoted {model_name} v{model_version} to {target_stage}")
        return await self.get_model_version(model_name, model_version)
    
    async def deploy_model(
        self,
        model_name: str,
        model_version: str,
        stage: ModelStage,
        deployed_by: str,
        deployment_config: Dict[str, Any] = None
    ) -> DeploymentRecord:
        """Deploy a model version to a stage"""
        model_ver = await self.get_model_version(model_name, model_version)
        if not model_ver:
            raise ValueError(f"Model not found: {model_name} v{model_version}")
        
        # Get current production version for rollback reference
        current_prod = await self.get_production_version(model_name)
        previous_version = current_prod.model_version if current_prod else None
        
        # Create deployment record
        deployment_id = hashlib.sha256(
            f"{model_name}:{model_version}:{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:16]
        
        deployment = DeploymentRecord(
            deployment_id=deployment_id,
            model_name=model_name,
            model_version=model_version,
            stage=stage,
            deployed_at=datetime.utcnow(),
            deployed_by=deployed_by,
            previous_version=previous_version,
            deployment_config=deployment_config or {}
        )
        
        async with self.db_pool.acquire() as conn:
            # If deploying to production, demote current production
            if stage == ModelStage.PRODUCTION and current_prod:
                await conn.execute("""
                    UPDATE ml_model_versions
                    SET stage = $3, updated_at = $4
                    WHERE model_name = $1 AND model_version = $2
                """, model_name, current_prod.model_version, 
                    ModelStage.ARCHIVED.value, datetime.utcnow())
            
            # Update new version
            await conn.execute("""
                UPDATE ml_model_versions
                SET stage = $3, status = $4, deployed_at = $5, deployed_by = $6,
                    rollback_version = $7, updated_at = $8
                WHERE model_name = $1 AND model_version = $2
            """, model_name, model_version, stage.value, ModelStatus.DEPLOYED.value,
                datetime.utcnow(), deployed_by, previous_version, datetime.utcnow())
            
            # Record deployment
            await conn.execute("""
                INSERT INTO ml_deployment_history (
                    deployment_id, model_name, model_version, stage,
                    deployed_at, deployed_by, previous_version, deployment_config
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, deployment_id, model_name, model_version, stage.value,
                deployment.deployed_at, deployed_by, previous_version,
                json.dumps(deployment_config or {}))
        
        # Update Redis with current production version
        if stage == ModelStage.PRODUCTION:
            await self.redis.set(f"ml:production:{model_name}", model_version)
        
        # Invalidate caches
        await self.redis.delete(f"ml:registry:{model_name}:{model_version}")
        if previous_version:
            await self.redis.delete(f"ml:registry:{model_name}:{previous_version}")
        
        logger.info(f"Deployed {model_name} v{model_version} to {stage}")
        return deployment
    
    async def rollback_model(
        self,
        model_name: str,
        rolled_back_by: str,
        reason: str,
        target_version: str = None
    ) -> DeploymentRecord:
        """Rollback to previous model version"""
        current_prod = await self.get_production_version(model_name)
        if not current_prod:
            raise ValueError(f"No production model found for {model_name}")
        
        # Determine rollback target
        if target_version:
            rollback_target = await self.get_model_version(model_name, target_version)
        else:
            # Use the rollback_version from current production
            if not current_prod.rollback_version:
                raise ValueError("No rollback version available")
            rollback_target = await self.get_model_version(model_name, current_prod.rollback_version)
        
        if not rollback_target:
            raise ValueError("Rollback target not found")
        
        # Create deployment record for rollback
        deployment_id = hashlib.sha256(
            f"rollback:{model_name}:{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:16]
        
        deployment = DeploymentRecord(
            deployment_id=deployment_id,
            model_name=model_name,
            model_version=rollback_target.model_version,
            stage=ModelStage.PRODUCTION,
            deployed_at=datetime.utcnow(),
            deployed_by=rolled_back_by,
            previous_version=current_prod.model_version,
            status="rollback",
            rollback_reason=reason
        )
        
        async with self.db_pool.acquire() as conn:
            # Mark current production as rolled back
            await conn.execute("""
                UPDATE ml_model_versions
                SET stage = $3, status = $4, updated_at = $5
                WHERE model_name = $1 AND model_version = $2
            """, model_name, current_prod.model_version,
                ModelStage.ROLLBACK.value, ModelStatus.RETIRED.value, datetime.utcnow())
            
            # Restore rollback target to production
            await conn.execute("""
                UPDATE ml_model_versions
                SET stage = $3, status = $4, deployed_at = $5, deployed_by = $6, updated_at = $7
                WHERE model_name = $1 AND model_version = $2
            """, model_name, rollback_target.model_version,
                ModelStage.PRODUCTION.value, ModelStatus.DEPLOYED.value,
                datetime.utcnow(), rolled_back_by, datetime.utcnow())
            
            # Record rollback
            await conn.execute("""
                INSERT INTO ml_deployment_history (
                    deployment_id, model_name, model_version, stage,
                    deployed_at, deployed_by, previous_version, status, rollback_reason
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, deployment_id, model_name, rollback_target.model_version,
                ModelStage.PRODUCTION.value, deployment.deployed_at, rolled_back_by,
                current_prod.model_version, "rollback", reason)
        
        # Update Redis
        await self.redis.set(f"ml:production:{model_name}", rollback_target.model_version)
        
        logger.info(f"Rolled back {model_name} from v{current_prod.model_version} to v{rollback_target.model_version}")
        return deployment
    
    async def get_deployment_history(
        self,
        model_name: str,
        limit: int = 20
    ) -> List[DeploymentRecord]:
        """Get deployment history for a model"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM ml_deployment_history
                WHERE model_name = $1
                ORDER BY deployed_at DESC
                LIMIT $2
            """, model_name, limit)
        
        return [
            DeploymentRecord(
                deployment_id=row['deployment_id'],
                model_name=row['model_name'],
                model_version=row['model_version'],
                stage=ModelStage(row['stage']),
                deployed_at=row['deployed_at'],
                deployed_by=row['deployed_by'],
                previous_version=row['previous_version'],
                deployment_config=json.loads(row['deployment_config']) if row['deployment_config'] else {},
                status=row['status'],
                rollback_reason=row['rollback_reason'] or ''
            )
            for row in rows
        ]
    
    async def get_model_artifact(
        self,
        model_name: str,
        model_version: str
    ) -> bytes:
        """Download model artifact"""
        model_ver = await self.get_model_version(model_name, model_version)
        if not model_ver:
            raise ValueError(f"Model not found: {model_name} v{model_version}")
        
        response = self.s3_client.get_object(
            Bucket=S3_MODEL_BUCKET,
            Key=model_ver.artifact_path
        )
        return response['Body'].read()
    
    async def list_models(self) -> List[str]:
        """List all registered models"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT DISTINCT model_name FROM ml_model_versions
                ORDER BY model_name
            """)
        return [row['model_name'] for row in rows]
    
    async def list_versions(
        self,
        model_name: str,
        stage: ModelStage = None
    ) -> List[ModelVersion]:
        """List all versions of a model"""
        async with self.db_pool.acquire() as conn:
            if stage:
                rows = await conn.fetch("""
                    SELECT * FROM ml_model_versions
                    WHERE model_name = $1 AND stage = $2
                    ORDER BY created_at DESC
                """, model_name, stage.value)
            else:
                rows = await conn.fetch("""
                    SELECT * FROM ml_model_versions
                    WHERE model_name = $1
                    ORDER BY created_at DESC
                """, model_name)
        
        return [self._row_to_model_version(row) for row in rows]
    
    async def compare_versions(
        self,
        model_name: str,
        version_a: str,
        version_b: str
    ) -> Dict[str, Any]:
        """Compare two model versions"""
        ver_a = await self.get_model_version(model_name, version_a)
        ver_b = await self.get_model_version(model_name, version_b)
        
        if not ver_a or not ver_b:
            raise ValueError("One or both versions not found")
        
        return {
            'version_a': version_a,
            'version_b': version_b,
            'metrics_comparison': {
                metric: {
                    'version_a': ver_a.evaluation_metrics.get(metric),
                    'version_b': ver_b.evaluation_metrics.get(metric),
                    'diff': (ver_b.evaluation_metrics.get(metric, 0) - 
                            ver_a.evaluation_metrics.get(metric, 0))
                }
                for metric in set(ver_a.evaluation_metrics.keys()) | set(ver_b.evaluation_metrics.keys())
            },
            'training_comparison': {
                'sample_count_a': ver_a.training_sample_count,
                'sample_count_b': ver_b.training_sample_count,
                'schema_match': ver_a.feature_schema_hash == ver_b.feature_schema_hash
            },
            'artifact_comparison': {
                'size_a': ver_a.artifact_size_bytes,
                'size_b': ver_b.artifact_size_bytes,
                'hash_match': ver_a.artifact_hash == ver_b.artifact_hash
            }
        }
    
    async def _update_cache(
        self,
        model_name: str,
        model_version: str,
        model_ver: ModelVersion
    ):
        """Update Redis cache"""
        cache_key = f"ml:registry:{model_name}:{model_version}"
        await self.redis.setex(
            cache_key, 3600,
            json.dumps(asdict(model_ver), default=str)
        )
    
    def _row_to_model_version(self, row) -> ModelVersion:
        """Convert database row to ModelVersion"""
        return ModelVersion(
            model_name=row['model_name'],
            model_version=row['model_version'],
            stage=ModelStage(row['stage']),
            status=ModelStatus(row['status']),
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            training_dataset_start=row['training_dataset_start'],
            training_dataset_end=row['training_dataset_end'],
            training_sample_count=row['training_sample_count'] or 0,
            feature_schema_hash=row['feature_schema_hash'] or '',
            hyperparameters=json.loads(row['hyperparameters']) if row['hyperparameters'] else {},
            code_commit=row['code_commit'] or '',
            code_branch=row['code_branch'] or '',
            code_repo=row['code_repo'] or '',
            artifact_path=row['artifact_path'] or '',
            artifact_hash=row['artifact_hash'] or '',
            artifact_size_bytes=row['artifact_size_bytes'] or 0,
            evaluation_metrics=json.loads(row['evaluation_metrics']) if row['evaluation_metrics'] else {},
            validation_metrics=json.loads(row['validation_metrics']) if row['validation_metrics'] else {},
            deployed_at=row['deployed_at'],
            deployed_by=row['deployed_by'] or '',
            rollback_version=row['rollback_version'],
            approved_by=row['approved_by'] or '',
            approved_at=row['approved_at'],
            approval_notes=row['approval_notes'] or '',
            tags=json.loads(row['tags']) if row['tags'] else [],
            description=row['description'] or ''
        )
    
    def _dict_to_model_version(self, data: Dict) -> ModelVersion:
        """Convert dict to ModelVersion"""
        return ModelVersion(
            model_name=data['model_name'],
            model_version=data['model_version'],
            stage=ModelStage(data['stage']),
            status=ModelStatus(data['status']),
            created_at=datetime.fromisoformat(data['created_at']) if isinstance(data['created_at'], str) else data['created_at'],
            updated_at=datetime.fromisoformat(data['updated_at']) if isinstance(data['updated_at'], str) else data['updated_at'],
            training_dataset_start=datetime.fromisoformat(data['training_dataset_start']) if data.get('training_dataset_start') else None,
            training_dataset_end=datetime.fromisoformat(data['training_dataset_end']) if data.get('training_dataset_end') else None,
            training_sample_count=data.get('training_sample_count', 0),
            feature_schema_hash=data.get('feature_schema_hash', ''),
            hyperparameters=data.get('hyperparameters', {}),
            code_commit=data.get('code_commit', ''),
            code_branch=data.get('code_branch', ''),
            code_repo=data.get('code_repo', ''),
            artifact_path=data.get('artifact_path', ''),
            artifact_hash=data.get('artifact_hash', ''),
            artifact_size_bytes=data.get('artifact_size_bytes', 0),
            evaluation_metrics=data.get('evaluation_metrics', {}),
            validation_metrics=data.get('validation_metrics', {}),
            deployed_at=datetime.fromisoformat(data['deployed_at']) if data.get('deployed_at') else None,
            deployed_by=data.get('deployed_by', ''),
            rollback_version=data.get('rollback_version'),
            approved_by=data.get('approved_by', ''),
            approved_at=datetime.fromisoformat(data['approved_at']) if data.get('approved_at') else None,
            approval_notes=data.get('approval_notes', ''),
            tags=data.get('tags', []),
            description=data.get('description', '')
        )


# Export classes
__all__ = [
    'EnhancedModelRegistry',
    'ModelVersion',
    'ModelStage',
    'ModelStatus',
    'DeploymentRecord'
]
