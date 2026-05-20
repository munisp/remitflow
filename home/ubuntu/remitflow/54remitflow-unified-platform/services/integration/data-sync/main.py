#!/usr/bin/env python3
"""
Data Sync Integration Service
Handles data synchronization between different data stores and services
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum

import aioredis
import asyncpg
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SyncType(str, Enum):
    REAL_TIME = "real_time"
    BATCH = "batch"
    SCHEDULED = "scheduled"
    EVENT_DRIVEN = "event_driven"

class SyncStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"

class DataSource(str, Enum):
    POSTGRESQL = "postgresql"
    REDIS = "redis"
    MONGODB = "mongodb"
    ELASTICSEARCH = "elasticsearch"
    KAFKA = "kafka"
    REST_API = "rest_api"
    GRAPHQL = "graphql"
    FILE_SYSTEM = "file_system"
    S3 = "s3"
    DELTA_LAKE = "delta_lake"

@dataclass
class SyncConfiguration:
    id: str
    name: str
    source_type: DataSource
    target_type: DataSource
    source_config: Dict[str, Any]
    target_config: Dict[str, Any]
    sync_type: SyncType
    schedule: Optional[str]  # Cron expression for scheduled syncs
    transformation_rules: List[Dict[str, Any]]
    filters: List[Dict[str, Any]]
    batch_size: int
    retry_count: int
    active: bool
    created_at: datetime
    updated_at: datetime

class SyncJob(BaseModel):
    id: str
    config_id: str
    status: SyncStatus
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    records_processed: int
    records_failed: int
    error_message: Optional[str]
    metadata: Dict[str, Any]

class SyncRequest(BaseModel):
    config_id: str
    force: bool = False
    batch_size: Optional[int] = None

class DataSyncService:
    def __init__(self):
        self.app = FastAPI(title="Data Sync Service", version="1.0.0")
        self.redis: Optional[aioredis.Redis] = None
        self.db_pool: Optional[asyncpg.Pool] = None
        self.sync_configs: Dict[str, SyncConfiguration] = {}
        self.active_jobs: Dict[str, SyncJob] = {}
        
        self.setup_routes()
        self.setup_middleware()

    def setup_middleware(self):
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def setup_routes(self):
        @self.app.on_event("startup")
        async def startup():
            await self.initialize()

        @self.app.on_event("shutdown")
        async def shutdown():
            await self.cleanup()

        @self.app.get("/health")
        async def health_check():
            return {
                "status": "healthy",
                "service": "data-sync",
                "version": "1.0.0",
                "timestamp": datetime.now().isoformat(),
                "active_configs": len(self.sync_configs),
                "active_jobs": len(self.active_jobs)
            }

        @self.app.get("/api/sync/configs")
        async def list_sync_configs():
            configs = await self.get_sync_configs()
            return {
                "configs": configs,
                "count": len(configs)
            }

        @self.app.post("/api/sync/configs")
        async def create_sync_config(config_data: Dict[str, Any]):
            config = await self.create_sync_configuration(config_data)
            return {"config": config, "status": "created"}

        @self.app.get("/api/sync/configs/{config_id}")
        async def get_sync_config(config_id: str):
            config = await self.get_sync_config_by_id(config_id)
            if not config:
                raise HTTPException(status_code=404, detail="Config not found")
            return config

        @self.app.put("/api/sync/configs/{config_id}")
        async def update_sync_config(config_id: str, config_data: Dict[str, Any]):
            config = await self.update_sync_configuration(config_id, config_data)
            return {"config": config, "status": "updated"}

        @self.app.delete("/api/sync/configs/{config_id}")
        async def delete_sync_config(config_id: str):
            await self.delete_sync_configuration(config_id)
            return {"status": "deleted"}

        @self.app.post("/api/sync/jobs")
        async def start_sync_job(sync_request: SyncRequest, background_tasks: BackgroundTasks):
            job = await self.start_sync(sync_request.config_id, sync_request.force, sync_request.batch_size)
            background_tasks.add_task(self.execute_sync_job, job.id)
            return {"job": job, "status": "started"}

        @self.app.get("/api/sync/jobs")
        async def list_sync_jobs(status: Optional[SyncStatus] = None, limit: int = 100):
            jobs = await self.get_sync_jobs(status, limit)
            return {
                "jobs": jobs,
                "count": len(jobs)
            }

        @self.app.get("/api/sync/jobs/{job_id}")
        async def get_sync_job(job_id: str):
            job = await self.get_sync_job_by_id(job_id)
            if not job:
                raise HTTPException(status_code=404, detail="Job not found")
            return job

        @self.app.post("/api/sync/jobs/{job_id}/cancel")
        async def cancel_sync_job(job_id: str):
            await self.cancel_sync_job(job_id)
            return {"status": "cancelled"}

        @self.app.get("/api/sync/metrics")
        async def get_sync_metrics():
            metrics = await self.calculate_sync_metrics()
            return metrics

        @self.app.post("/api/sync/test-connection")
        async def test_connection(connection_config: Dict[str, Any]):
            result = await self.test_data_source_connection(connection_config)
            return result

        @self.app.get("/api/sync/schema/{source_type}")
        async def get_data_schema(source_type: DataSource, connection_config: Dict[str, Any]):
            schema = await self.get_data_source_schema(source_type, connection_config)
            return {"schema": schema}

    async def initialize(self):
        """Initialize Redis and PostgreSQL connections"""
        try:
            # Initialize Redis
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            self.redis = await aioredis.from_url(redis_url, decode_responses=True)
            
            # Initialize PostgreSQL
            db_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/remittance")
            self.db_pool = await asyncpg.create_pool(db_url)
            
            # Create tables
            await self.create_tables()
            
            # Load sync configurations
            await self.load_sync_configurations()
            
            # Start background tasks
            asyncio.create_task(self.sync_scheduler())
            asyncio.create_task(self.monitor_sync_jobs())
            asyncio.create_task(self.cleanup_old_jobs())
            
            logger.info("🔄 Data Sync Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Data Sync Service: {e}")
            raise

    async def cleanup(self):
        """Cleanup connections"""
        if self.redis:
            await self.redis.close()
        if self.db_pool:
            await self.db_pool.close()

    async def create_tables(self):
        """Create database tables"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_configurations (
                    id VARCHAR PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    source_type VARCHAR NOT NULL,
                    target_type VARCHAR NOT NULL,
                    source_config JSONB NOT NULL,
                    target_config JSONB NOT NULL,
                    sync_type VARCHAR NOT NULL,
                    schedule VARCHAR,
                    transformation_rules JSONB DEFAULT '[]',
                    filters JSONB DEFAULT '[]',
                    batch_size INTEGER DEFAULT 1000,
                    retry_count INTEGER DEFAULT 3,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS sync_jobs (
                    id VARCHAR PRIMARY KEY,
                    config_id VARCHAR NOT NULL REFERENCES sync_configurations(id),
                    status VARCHAR NOT NULL,
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    records_processed INTEGER DEFAULT 0,
                    records_failed INTEGER DEFAULT 0,
                    error_message TEXT,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
                CREATE INDEX IF NOT EXISTS idx_sync_jobs_config_id ON sync_jobs(config_id);
                CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_at ON sync_jobs(created_at);
                
                CREATE TABLE IF NOT EXISTS sync_metrics (
                    id SERIAL PRIMARY KEY,
                    config_id VARCHAR NOT NULL,
                    job_id VARCHAR NOT NULL,
                    metric_name VARCHAR NOT NULL,
                    metric_value NUMERIC NOT NULL,
                    timestamp TIMESTAMP DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_sync_metrics_config_id ON sync_metrics(config_id);
                CREATE INDEX IF NOT EXISTS idx_sync_metrics_timestamp ON sync_metrics(timestamp);
            """)

    async def load_sync_configurations(self):
        """Load sync configurations from database"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM sync_configurations WHERE active = TRUE")
            
            for row in rows:
                config = SyncConfiguration(
                    id=row['id'],
                    name=row['name'],
                    source_type=DataSource(row['source_type']),
                    target_type=DataSource(row['target_type']),
                    source_config=row['source_config'],
                    target_config=row['target_config'],
                    sync_type=SyncType(row['sync_type']),
                    schedule=row['schedule'],
                    transformation_rules=row['transformation_rules'],
                    filters=row['filters'],
                    batch_size=row['batch_size'],
                    retry_count=row['retry_count'],
                    active=row['active'],
                    created_at=row['created_at'],
                    updated_at=row['updated_at']
                )
                
                self.sync_configs[config.id] = config

    async def create_sync_configuration(self, config_data: Dict[str, Any]) -> SyncConfiguration:
        """Create new sync configuration"""
        import uuid
        
        config_id = str(uuid.uuid4())
        config = SyncConfiguration(
            id=config_id,
            name=config_data['name'],
            source_type=DataSource(config_data['source_type']),
            target_type=DataSource(config_data['target_type']),
            source_config=config_data['source_config'],
            target_config=config_data['target_config'],
            sync_type=SyncType(config_data['sync_type']),
            schedule=config_data.get('schedule'),
            transformation_rules=config_data.get('transformation_rules', []),
            filters=config_data.get('filters', []),
            batch_size=config_data.get('batch_size', 1000),
            retry_count=config_data.get('retry_count', 3),
            active=config_data.get('active', True),
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
        
        # Store in database
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO sync_configurations (
                    id, name, source_type, target_type, source_config, target_config,
                    sync_type, schedule, transformation_rules, filters, batch_size,
                    retry_count, active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            """, 
                config.id, config.name, config.source_type.value, config.target_type.value,
                json.dumps(config.source_config), json.dumps(config.target_config),
                config.sync_type.value, config.schedule, json.dumps(config.transformation_rules),
                json.dumps(config.filters), config.batch_size, config.retry_count,
                config.active, config.created_at, config.updated_at
            )
        
        # Store in memory
        self.sync_configs[config.id] = config
        
        return config

    async def start_sync(self, config_id: str, force: bool = False, batch_size: Optional[int] = None) -> SyncJob:
        """Start a sync job"""
        import uuid
        
        if config_id not in self.sync_configs:
            raise HTTPException(status_code=404, detail="Sync configuration not found")
        
        config = self.sync_configs[config_id]
        
        # Check if there's already a running job for this config
        if not force:
            for job in self.active_jobs.values():
                if job.config_id == config_id and job.status == SyncStatus.RUNNING:
                    raise HTTPException(status_code=409, detail="Sync job already running for this configuration")
        
        job_id = str(uuid.uuid4())
        job = SyncJob(
            id=job_id,
            config_id=config_id,
            status=SyncStatus.PENDING,
            started_at=None,
            completed_at=None,
            records_processed=0,
            records_failed=0,
            error_message=None,
            metadata={
                "batch_size": batch_size or config.batch_size,
                "force": force
            }
        )
        
        # Store in database
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO sync_jobs (id, config_id, status, metadata)
                VALUES ($1, $2, $3, $4)
            """, job.id, job.config_id, job.status.value, json.dumps(job.metadata))
        
        # Store in memory
        self.active_jobs[job_id] = job
        
        return job

    async def execute_sync_job(self, job_id: str):
        """Execute a sync job"""
        try:
            job = self.active_jobs.get(job_id)
            if not job:
                logger.error(f"Job {job_id} not found")
                return
            
            config = self.sync_configs.get(job.config_id)
            if not config:
                await self.update_job_status(job_id, SyncStatus.FAILED, "Configuration not found")
                return
            
            # Update job status to running
            await self.update_job_status(job_id, SyncStatus.RUNNING)
            job.started_at = datetime.now()
            
            logger.info(f"🔄 Starting sync job {job_id} for config {config.name}")
            
            # Execute sync based on type
            if config.sync_type == SyncType.REAL_TIME:
                await self.execute_real_time_sync(job, config)
            elif config.sync_type == SyncType.BATCH:
                await self.execute_batch_sync(job, config)
            elif config.sync_type == SyncType.SCHEDULED:
                await self.execute_scheduled_sync(job, config)
            elif config.sync_type == SyncType.EVENT_DRIVEN:
                await self.execute_event_driven_sync(job, config)
            
            # Mark job as completed
            await self.update_job_status(job_id, SyncStatus.COMPLETED)
            job.completed_at = datetime.now()
            
            logger.info(f"✅ Sync job {job_id} completed successfully")
            
        except Exception as e:
            logger.error(f"❌ Sync job {job_id} failed: {e}")
            await self.update_job_status(job_id, SyncStatus.FAILED, str(e))
        finally:
            # Remove from active jobs
            if job_id in self.active_jobs:
                del self.active_jobs[job_id]

    async def execute_batch_sync(self, job: SyncJob, config: SyncConfiguration):
        """Execute batch synchronization"""
        batch_size = job.metadata.get("batch_size", config.batch_size)
        
        # Get source data
        source_data = await self.read_from_source(config.source_type, config.source_config, batch_size)
        
        # Apply filters
        filtered_data = await self.apply_filters(source_data, config.filters)
        
        # Apply transformations
        transformed_data = await self.apply_transformations(filtered_data, config.transformation_rules)
        
        # Write to target
        await self.write_to_target(config.target_type, config.target_config, transformed_data)
        
        # Update job metrics
        job.records_processed = len(transformed_data)
        await self.update_job_metrics(job.id, job.records_processed, 0)

    async def execute_real_time_sync(self, job: SyncJob, config: SyncConfiguration):
        """Execute real-time synchronization"""
        # For real-time sync, we set up listeners/watchers
        # This is a simplified implementation
        
        if config.source_type == DataSource.POSTGRESQL:
            await self.setup_postgres_listener(job, config)
        elif config.source_type == DataSource.REDIS:
            await self.setup_redis_listener(job, config)
        elif config.source_type == DataSource.KAFKA:
            await self.setup_kafka_listener(job, config)
        else:
            raise Exception(f"Real-time sync not supported for {config.source_type}")

    async def execute_scheduled_sync(self, job: SyncJob, config: SyncConfiguration):
        """Execute scheduled synchronization"""
        # For scheduled sync, we execute batch sync at specified intervals
        await self.execute_batch_sync(job, config)

    async def execute_event_driven_sync(self, job: SyncJob, config: SyncConfiguration):
        """Execute event-driven synchronization"""
        # For event-driven sync, we listen to specific events
        # This would integrate with the event bus service
        pass

    async def read_from_source(self, source_type: DataSource, config: Dict[str, Any], limit: int = 1000) -> List[Dict[str, Any]]:
        """Read data from source"""
        if source_type == DataSource.POSTGRESQL:
            return await self.read_from_postgres(config, limit)
        elif source_type == DataSource.REDIS:
            return await self.read_from_redis(config, limit)
        elif source_type == DataSource.REST_API:
            return await self.read_from_rest_api(config, limit)
        else:
            raise Exception(f"Source type {source_type} not implemented")

    async def read_from_postgres(self, config: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
        """Read data from PostgreSQL"""
        import asyncpg
        
        conn = await asyncpg.connect(config['connection_string'])
        try:
            query = config['query']
            if 'LIMIT' not in query.upper():
                query += f" LIMIT {limit}"
            
            rows = await conn.fetch(query)
            return [dict(row) for row in rows]
        finally:
            await conn.close()

    async def read_from_redis(self, config: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
        """Read data from Redis"""
        redis_client = await aioredis.from_url(config['connection_string'])
        try:
            pattern = config.get('pattern', '*')
            keys = await redis_client.keys(pattern)
            
            data = []
            for key in keys[:limit]:
                value = await redis_client.get(key)
                if value:
                    try:
                        data.append({"key": key, "value": json.loads(value)})
                    except json.JSONDecodeError:
                        data.append({"key": key, "value": value})
            
            return data
        finally:
            await redis_client.close()

    async def read_from_rest_api(self, config: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
        """Read data from REST API"""
        import aiohttp
        
        async with aiohttp.ClientSession() as session:
            url = config['url']
            headers = config.get('headers', {})
            params = config.get('params', {})
            params['limit'] = limit
            
            async with session.get(url, headers=headers, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    return data if isinstance(data, list) else [data]
                else:
                    raise Exception(f"API request failed with status {response.status}")

    async def write_to_target(self, target_type: DataSource, config: Dict[str, Any], data: List[Dict[str, Any]]):
        """Write data to target"""
        if target_type == DataSource.POSTGRESQL:
            await self.write_to_postgres(config, data)
        elif target_type == DataSource.REDIS:
            await self.write_to_redis(config, data)
        elif target_type == DataSource.REST_API:
            await self.write_to_rest_api(config, data)
        else:
            raise Exception(f"Target type {target_type} not implemented")

    async def write_to_postgres(self, config: Dict[str, Any], data: List[Dict[str, Any]]):
        """Write data to PostgreSQL"""
        import asyncpg
        
        conn = await asyncpg.connect(config['connection_string'])
        try:
            table = config['table']
            
            for record in data:
                columns = list(record.keys())
                values = list(record.values())
                placeholders = ', '.join([f'${i+1}' for i in range(len(values))])
                
                query = f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})"
                await conn.execute(query, *values)
        finally:
            await conn.close()

    async def write_to_redis(self, config: Dict[str, Any], data: List[Dict[str, Any]]):
        """Write data to Redis"""
        redis_client = await aioredis.from_url(config['connection_string'])
        try:
            key_field = config.get('key_field', 'id')
            
            for record in data:
                key = record.get(key_field, str(uuid.uuid4()))
                value = json.dumps(record)
                await redis_client.set(key, value)
        finally:
            await redis_client.close()

    async def write_to_rest_api(self, config: Dict[str, Any], data: List[Dict[str, Any]]):
        """Write data to REST API"""
        import aiohttp
        
        async with aiohttp.ClientSession() as session:
            url = config['url']
            headers = config.get('headers', {})
            
            for record in data:
                async with session.post(url, json=record, headers=headers) as response:
                    if response.status >= 400:
                        raise Exception(f"API request failed with status {response.status}")

    async def apply_filters(self, data: List[Dict[str, Any]], filters: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Apply filters to data"""
        if not filters:
            return data
        
        filtered_data = []
        for record in data:
            include = True
            for filter_rule in filters:
                field = filter_rule['field']
                operator = filter_rule['operator']
                value = filter_rule['value']
                
                if field not in record:
                    include = False
                    break
                
                record_value = record[field]
                
                if operator == 'eq' and record_value != value:
                    include = False
                    break
                elif operator == 'ne' and record_value == value:
                    include = False
                    break
                elif operator == 'gt' and record_value <= value:
                    include = False
                    break
                elif operator == 'lt' and record_value >= value:
                    include = False
                    break
                elif operator == 'contains' and value not in str(record_value):
                    include = False
                    break
            
            if include:
                filtered_data.append(record)
        
        return filtered_data

    async def apply_transformations(self, data: List[Dict[str, Any]], rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Apply transformation rules to data"""
        if not rules:
            return data
        
        transformed_data = []
        for record in data:
            transformed_record = record.copy()
            
            for rule in rules:
                rule_type = rule['type']
                
                if rule_type == 'rename':
                    old_field = rule['old_field']
                    new_field = rule['new_field']
                    if old_field in transformed_record:
                        transformed_record[new_field] = transformed_record.pop(old_field)
                
                elif rule_type == 'map':
                    field = rule['field']
                    mapping = rule['mapping']
                    if field in transformed_record and transformed_record[field] in mapping:
                        transformed_record[field] = mapping[transformed_record[field]]
                
                elif rule_type == 'format':
                    field = rule['field']
                    format_string = rule['format']
                    if field in transformed_record:
                        transformed_record[field] = format_string.format(transformed_record[field])
                
                elif rule_type == 'calculate':
                    new_field = rule['new_field']
                    expression = rule['expression']
                    # Simple expression evaluation (in production, use a safe evaluator)
                    try:
                        transformed_record[new_field] = eval(expression, {"__builtins__": {}}, transformed_record)
                    except:
                        pass
            
            transformed_data.append(transformed_record)
        
        return transformed_data

    async def update_job_status(self, job_id: str, status: SyncStatus, error_message: Optional[str] = None):
        """Update job status"""
        async with self.db_pool.acquire() as conn:
            if error_message:
                await conn.execute("""
                    UPDATE sync_jobs 
                    SET status = $2, error_message = $3, completed_at = NOW()
                    WHERE id = $1
                """, job_id, status.value, error_message)
            else:
                await conn.execute("""
                    UPDATE sync_jobs 
                    SET status = $2, started_at = CASE WHEN $2 = 'running' THEN NOW() ELSE started_at END,
                        completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN NOW() ELSE completed_at END
                    WHERE id = $1
                """, job_id, status.value)
        
        # Update in-memory job
        if job_id in self.active_jobs:
            self.active_jobs[job_id].status = status
            if error_message:
                self.active_jobs[job_id].error_message = error_message

    async def update_job_metrics(self, job_id: str, processed: int, failed: int):
        """Update job metrics"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE sync_jobs 
                SET records_processed = $2, records_failed = $3
                WHERE id = $1
            """, job_id, processed, failed)
        
        # Update in-memory job
        if job_id in self.active_jobs:
            self.active_jobs[job_id].records_processed = processed
            self.active_jobs[job_id].records_failed = failed

    async def get_sync_configs(self) -> List[Dict[str, Any]]:
        """Get all sync configurations"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM sync_configurations ORDER BY created_at DESC")
            return [dict(row) for row in rows]

    async def get_sync_config_by_id(self, config_id: str) -> Optional[Dict[str, Any]]:
        """Get sync configuration by ID"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM sync_configurations WHERE id = $1", config_id)
            return dict(row) if row else None

    async def get_sync_jobs(self, status: Optional[SyncStatus], limit: int) -> List[Dict[str, Any]]:
        """Get sync jobs"""
        async with self.db_pool.acquire() as conn:
            if status:
                rows = await conn.fetch("""
                    SELECT * FROM sync_jobs 
                    WHERE status = $1 
                    ORDER BY created_at DESC 
                    LIMIT $2
                """, status.value, limit)
            else:
                rows = await conn.fetch("""
                    SELECT * FROM sync_jobs 
                    ORDER BY created_at DESC 
                    LIMIT $1
                """, limit)
            
            return [dict(row) for row in rows]

    async def get_sync_job_by_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get sync job by ID"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM sync_jobs WHERE id = $1", job_id)
            return dict(row) if row else None

    async def calculate_sync_metrics(self) -> Dict[str, Any]:
        """Calculate sync metrics"""
        async with self.db_pool.acquire() as conn:
            # Total jobs
            total_jobs = await conn.fetchval("SELECT COUNT(*) FROM sync_jobs")
            
            # Jobs by status
            status_counts = await conn.fetch("""
                SELECT status, COUNT(*) as count 
                FROM sync_jobs 
                GROUP BY status
            """)
            
            # Jobs in last 24 hours
            jobs_24h = await conn.fetchval("""
                SELECT COUNT(*) FROM sync_jobs 
                WHERE created_at > NOW() - INTERVAL '24 hours'
            """)
            
            # Average processing time
            avg_processing_time = await conn.fetchval("""
                SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) 
                FROM sync_jobs 
                WHERE completed_at IS NOT NULL AND started_at IS NOT NULL
            """)
            
            # Total records processed
            total_records = await conn.fetchval("""
                SELECT SUM(records_processed) FROM sync_jobs 
                WHERE status = 'completed'
            """)
            
            return {
                "total_jobs": total_jobs,
                "jobs_24h": jobs_24h,
                "status_distribution": {row['status']: row['count'] for row in status_counts},
                "avg_processing_time_seconds": float(avg_processing_time or 0),
                "total_records_processed": total_records or 0,
                "active_configs": len(self.sync_configs),
                "active_jobs": len(self.active_jobs),
                "timestamp": datetime.now().isoformat()
            }

    async def test_data_source_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Test connection to data source"""
        try:
            source_type = DataSource(config['source_type'])
            
            if source_type == DataSource.POSTGRESQL:
                conn = await asyncpg.connect(config['connection_string'])
                await conn.close()
            elif source_type == DataSource.REDIS:
                redis_client = await aioredis.from_url(config['connection_string'])
                await redis_client.ping()
                await redis_client.close()
            elif source_type == DataSource.REST_API:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.get(config['url']) as response:
                        if response.status >= 400:
                            raise Exception(f"HTTP {response.status}")
            
            return {"status": "success", "message": "Connection successful"}
            
        except Exception as e:
            return {"status": "error", "message": str(e)}

    async def sync_scheduler(self):
        """Background task to handle scheduled syncs"""
        while True:
            try:
                # Check for scheduled syncs
                for config in self.sync_configs.values():
                    if config.sync_type == SyncType.SCHEDULED and config.schedule:
                        # Simple cron-like scheduling (in production, use proper cron parser)
                        # For now, just run every hour for scheduled syncs
                        last_run_key = f"last_run:{config.id}"
                        last_run = await self.redis.get(last_run_key)
                        
                        if not last_run or (time.time() - float(last_run)) > 3600:  # 1 hour
                            job = await self.start_sync(config.id)
                            asyncio.create_task(self.execute_sync_job(job.id))
                            await self.redis.set(last_run_key, str(time.time()))
                
                await asyncio.sleep(300)  # Check every 5 minutes
                
            except Exception as e:
                logger.error(f"Error in sync scheduler: {e}")
                await asyncio.sleep(300)

    async def monitor_sync_jobs(self):
        """Background task to monitor sync jobs"""
        while True:
            try:
                # Check for stuck jobs
                stuck_threshold = datetime.now() - timedelta(hours=2)
                
                async with self.db_pool.acquire() as conn:
                    stuck_jobs = await conn.fetch("""
                        SELECT id FROM sync_jobs 
                        WHERE status = 'running' 
                        AND started_at < $1
                    """, stuck_threshold)
                    
                    for job in stuck_jobs:
                        await self.update_job_status(job['id'], SyncStatus.FAILED, "Job timeout")
                        logger.warning(f"Marked stuck job {job['id']} as failed")
                
                await asyncio.sleep(600)  # Check every 10 minutes
                
            except Exception as e:
                logger.error(f"Error monitoring sync jobs: {e}")
                await asyncio.sleep(600)

    async def cleanup_old_jobs(self):
        """Background task to cleanup old jobs"""
        while True:
            try:
                # Delete jobs older than 30 days
                async with self.db_pool.acquire() as conn:
                    deleted_count = await conn.fetchval("""
                        DELETE FROM sync_jobs 
                        WHERE created_at < NOW() - INTERVAL '30 days'
                        RETURNING COUNT(*)
                    """)
                    
                    if deleted_count > 0:
                        logger.info(f"🧹 Cleaned up {deleted_count} old sync jobs")
                
                await asyncio.sleep(3600)  # Check every hour
                
            except Exception as e:
                logger.error(f"Error cleaning up old jobs: {e}")
                await asyncio.sleep(3600)

# Create service instance
data_sync_service = DataSyncService()
app = data_sync_service.app

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8203"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info"
    )

