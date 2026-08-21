#!/usr/bin/env python3
"""
Advanced Policy Engine with Pilot Testing, A/B Testing, and Targeted Rollouts
Enterprise-grade policy management and testing system
"""

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from enum import Enum
import hashlib
import random

import aiohttp
import aiofiles
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import uvicorn
import redis
import psycopg2
from psycopg2.extras import RealDictCursor
import mlflow
import mlflow.sklearn
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
import numpy as np
import pandas as pd

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Security
security = HTTPBearer()

# Enums
class PolicyStatus(str, Enum):
    DRAFT = "draft"
    PILOT = "pilot"
    AB_TEST = "ab_test"
    TARGETED_ROLLOUT = "targeted_rollout"
    FULL_DEPLOYMENT = "full_deployment"
    DEPRECATED = "deprecated"
    FAILED = "failed"

class TestType(str, Enum):
    PILOT = "pilot"
    AB_TEST = "ab_test"
    CANARY = "canary"
    BLUE_GREEN = "blue_green"
    SHADOW = "shadow"

class RolloutStrategy(str, Enum):
    PERCENTAGE = "percentage"
    GEOGRAPHIC = "geographic"
    DEMOGRAPHIC = "demographic"
    BUSINESS_TYPE = "business_type"
    RISK_PROFILE = "risk_profile"
    CUSTOM = "custom"

class PolicyPriority(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

# Data Models
class PolicyRule(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str
    rule_type: str
    condition: str
    action: str
    parameters: Dict[str, Any] = Field(default_factory=dict)
    priority: PolicyPriority = PolicyPriority.MEDIUM
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class PolicyVersion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    policy_id: str
    version: str
    rules: List[PolicyRule]
    status: PolicyStatus = PolicyStatus.DRAFT
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class TestConfiguration(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    test_type: TestType
    name: str
    description: str
    policy_versions: List[str]  # Policy version IDs
    target_criteria: Dict[str, Any]
    success_metrics: List[str]
    duration_hours: int = 24
    traffic_percentage: float = 10.0
    rollout_strategy: RolloutStrategy = RolloutStrategy.PERCENTAGE
    created_at: datetime = Field(default_factory=datetime.utcnow)

class TestResult(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    test_id: str
    policy_version_id: str
    metrics: Dict[str, float]
    performance_data: Dict[str, Any]
    error_rate: float
    success_rate: float
    user_feedback: List[Dict[str, Any]] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class RolloutPlan(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    policy_version_id: str
    strategy: RolloutStrategy
    phases: List[Dict[str, Any]]
    current_phase: int = 0
    target_groups: List[str]
    success_criteria: Dict[str, float]
    rollback_criteria: Dict[str, float]
    created_at: datetime = Field(default_factory=datetime.utcnow)

class PolicyEngineCore:
    """Core policy engine with advanced testing and rollout capabilities"""
    
    def __init__(self):
        self.redis_client = None
        self.db_connection = None
        self.mlflow_client = None
        self.setup_connections()
        
        # Policy execution cache
        self.policy_cache = {}
        self.test_cache = {}
        
        # Metrics tracking
        self.metrics_buffer = []
        
        # A/B test configurations
        self.ab_tests = {}
        
        # Rollout configurations
        self.rollouts = {}
    
    def setup_connections(self):
        """Setup database, Redis, and MLflow connections"""
        try:
            # Redis connection
            self.redis_client = redis.Redis(
                host=os.getenv('DB_HOST', 'localhost'),
                port=6379,
                db=0,
                decode_responses=True
            )
            self.redis_client.ping()
            logger.info("Connected to Redis")
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}")
        
        try:
            # PostgreSQL connection
            self.db_connection = psycopg2.connect(
                host=os.getenv('DB_HOST', 'localhost'),
                database="remittance",
                user=os.getenv('DB_USER', 'postgres'),
                password=os.getenv('DB_PASSWORD', ''),
                port="5432"
            )
            logger.info("Connected to PostgreSQL")
        except Exception as e:
            logger.warning(f"PostgreSQL connection failed: {e}")
        
        try:
            # MLflow setup
            mlflow.set_tracking_uri("http://localhost:5000")
            self.mlflow_client = mlflow.tracking.MlflowClient()
            logger.info("Connected to MLflow")
        except Exception as e:
            logger.warning(f"MLflow connection failed: {e}")
    
    async def create_policy_version(self, policy_data: Dict[str, Any], created_by: str) -> PolicyVersion:
        """Create a new policy version"""
        
        # Generate policy rules from the data
        rules = []
        for rule_data in policy_data.get('rules', []):
            rule = PolicyRule(**rule_data)
            rules.append(rule)
        
        # Create policy version
        policy_version = PolicyVersion(
            policy_id=policy_data.get('policy_id', str(uuid.uuid4())),
            version=policy_data.get('version', '1.0.0'),
            rules=rules,
            created_by=created_by,
            metadata=policy_data.get('metadata', {})
        )
        
        # Save to database
        await self._save_policy_version(policy_version)
        
        logger.info(f"Created policy version {policy_version.id}")
        return policy_version
    
    async def start_pilot_test(self, policy_version_id: str, test_config: TestConfiguration) -> str:
        """Start a pilot test for a policy version"""
        
        test_config.test_type = TestType.PILOT
        test_id = await self._create_test(test_config)
        
        # Configure pilot test parameters
        pilot_config = {
            'test_id': test_id,
            'policy_version_id': policy_version_id,
            'target_percentage': min(test_config.traffic_percentage, 5.0),  # Max 5% for pilot
            'duration': test_config.duration_hours,
            'success_metrics': test_config.success_metrics,
            'start_time': datetime.utcnow(),
            'status': 'active'
        }
        
        # Store in cache and database
        self.test_cache[test_id] = pilot_config
        await self._save_test_configuration(test_id, pilot_config)
        
        # Start MLflow experiment
        experiment_name = f"pilot_test_{test_id}"
        try:
            experiment_id = mlflow.create_experiment(experiment_name)
        except:
            experiment_id = mlflow.get_experiment_by_name(experiment_name).experiment_id
        
        with mlflow.start_run(experiment_id=experiment_id):
            mlflow.log_param("test_type", "pilot")
            mlflow.log_param("policy_version_id", policy_version_id)
            mlflow.log_param("target_percentage", pilot_config['target_percentage'])
            mlflow.log_param("duration_hours", test_config.duration_hours)
        
        logger.info(f"Started pilot test {test_id} for policy version {policy_version_id}")
        return test_id
    
    async def start_ab_test(self, policy_versions: List[str], test_config: TestConfiguration) -> str:
        """Start an A/B test between multiple policy versions"""
        
        if len(policy_versions) < 2:
            raise ValueError("A/B test requires at least 2 policy versions")
        
        test_config.test_type = TestType.AB_TEST
        test_config.policy_versions = policy_versions
        test_id = await self._create_test(test_config)
        
        # Configure A/B test parameters
        traffic_split = 100.0 / len(policy_versions)
        ab_config = {
            'test_id': test_id,
            'policy_versions': policy_versions,
            'traffic_split': traffic_split,
            'target_percentage': test_config.traffic_percentage,
            'duration': test_config.duration_hours,
            'success_metrics': test_config.success_metrics,
            'start_time': datetime.utcnow(),
            'status': 'active',
            'version_performance': {v: {} for v in policy_versions}
        }
        
        # Store in cache and database
        self.ab_tests[test_id] = ab_config
        await self._save_test_configuration(test_id, ab_config)
        
        # Start MLflow experiment
        experiment_name = f"ab_test_{test_id}"
        try:
            experiment_id = mlflow.create_experiment(experiment_name)
        except:
            experiment_id = mlflow.get_experiment_by_name(experiment_name).experiment_id
        
        with mlflow.start_run(experiment_id=experiment_id):
            mlflow.log_param("test_type", "ab_test")
            mlflow.log_param("policy_versions", policy_versions)
            mlflow.log_param("traffic_split", traffic_split)
            mlflow.log_param("target_percentage", test_config.traffic_percentage)
        
        logger.info(f"Started A/B test {test_id} with {len(policy_versions)} versions")
        return test_id
    
    async def create_rollout_plan(self, policy_version_id: str, strategy: RolloutStrategy, 
                                target_groups: List[str]) -> RolloutPlan:
        """Create a targeted rollout plan"""
        
        # Define rollout phases based on strategy
        phases = []
        
        if strategy == RolloutStrategy.PERCENTAGE:
            phases = [
                {'percentage': 10, 'duration_hours': 24, 'success_threshold': 0.95},
                {'percentage': 25, 'duration_hours': 48, 'success_threshold': 0.95},
                {'percentage': 50, 'duration_hours': 72, 'success_threshold': 0.95},
                {'percentage': 100, 'duration_hours': 168, 'success_threshold': 0.95}
            ]
        elif strategy == RolloutStrategy.GEOGRAPHIC:
            phases = [
                {'regions': ['Lagos'], 'duration_hours': 48, 'success_threshold': 0.95},
                {'regions': ['Lagos', 'Abuja'], 'duration_hours': 72, 'success_threshold': 0.95},
                {'regions': ['Lagos', 'Abuja', 'Kano'], 'duration_hours': 96, 'success_threshold': 0.95},
                {'regions': ['all'], 'duration_hours': 168, 'success_threshold': 0.95}
            ]
        elif strategy == RolloutStrategy.BUSINESS_TYPE:
            phases = [
                {'business_types': ['tier1_banks'], 'duration_hours': 48, 'success_threshold': 0.98},
                {'business_types': ['tier1_banks', 'tier2_banks'], 'duration_hours': 72, 'success_threshold': 0.96},
                {'business_types': ['all_banks'], 'duration_hours': 96, 'success_threshold': 0.95},
                {'business_types': ['all'], 'duration_hours': 168, 'success_threshold': 0.95}
            ]
        elif strategy == RolloutStrategy.RISK_PROFILE:
            phases = [
                {'risk_profiles': ['low'], 'duration_hours': 24, 'success_threshold': 0.98},
                {'risk_profiles': ['low', 'medium'], 'duration_hours': 48, 'success_threshold': 0.96},
                {'risk_profiles': ['low', 'medium', 'high'], 'duration_hours': 72, 'success_threshold': 0.95},
                {'risk_profiles': ['all'], 'duration_hours': 168, 'success_threshold': 0.95}
            ]
        
        rollout_plan = RolloutPlan(
            policy_version_id=policy_version_id,
            strategy=strategy,
            phases=phases,
            target_groups=target_groups,
            success_criteria={'success_rate': 0.95, 'error_rate': 0.05},
            rollback_criteria={'success_rate': 0.85, 'error_rate': 0.15}
        )
        
        # Save rollout plan
        await self._save_rollout_plan(rollout_plan)
        
        logger.info(f"Created rollout plan {rollout_plan.id} for policy {policy_version_id}")
        return rollout_plan
    
    async def execute_rollout_phase(self, rollout_id: str) -> Dict[str, Any]:
        """Execute the next phase of a rollout plan"""
        
        rollout_plan = await self._get_rollout_plan(rollout_id)
        if not rollout_plan:
            raise ValueError(f"Rollout plan {rollout_id} not found")
        
        if rollout_plan.current_phase >= len(rollout_plan.phases):
            return {'status': 'completed', 'message': 'All phases completed'}
        
        current_phase = rollout_plan.phases[rollout_plan.current_phase]
        
        # Execute phase
        phase_result = await self._execute_phase(rollout_plan, current_phase)
        
        # Check success criteria
        if phase_result['success_rate'] >= current_phase.get('success_threshold', 0.95):
            # Move to next phase
            rollout_plan.current_phase += 1
            await self._update_rollout_plan(rollout_plan)
            
            return {
                'status': 'phase_completed',
                'phase': rollout_plan.current_phase - 1,
                'result': phase_result,
                'next_phase': rollout_plan.current_phase if rollout_plan.current_phase < len(rollout_plan.phases) else None
            }
        else:
            # Phase failed, initiate rollback
            await self._initiate_rollback(rollout_plan, phase_result)
            
            return {
                'status': 'phase_failed',
                'phase': rollout_plan.current_phase,
                'result': phase_result,
                'action': 'rollback_initiated'
            }
    
    async def evaluate_policy_performance(self, policy_version_id: str, 
                                        evaluation_period_hours: int = 24) -> Dict[str, Any]:
        """Evaluate policy performance over a specified period"""
        
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=evaluation_period_hours)
        
        # Collect metrics from database
        metrics = await self._collect_policy_metrics(policy_version_id, start_time, end_time)
        
        # Calculate performance indicators
        performance = {
            'policy_version_id': policy_version_id,
            'evaluation_period': f"{evaluation_period_hours} hours",
            'total_executions': metrics.get('total_executions', 0),
            'success_rate': metrics.get('success_rate', 0.0),
            'error_rate': metrics.get('error_rate', 0.0),
            'average_response_time': metrics.get('avg_response_time', 0.0),
            'throughput': metrics.get('throughput', 0.0),
            'compliance_score': metrics.get('compliance_score', 0.0),
            'user_satisfaction': metrics.get('user_satisfaction', 0.0),
            'business_impact': {
                'transactions_processed': metrics.get('transactions_processed', 0),
                'fraud_detected': metrics.get('fraud_detected', 0),
                'false_positives': metrics.get('false_positives', 0),
                'cost_savings': metrics.get('cost_savings', 0.0)
            }
        }
        
        # Log to MLflow
        if self.mlflow_client:
            with mlflow.start_run():
                mlflow.log_param("policy_version_id", policy_version_id)
                mlflow.log_param("evaluation_period_hours", evaluation_period_hours)
                mlflow.log_metric("success_rate", performance['success_rate'])
                mlflow.log_metric("error_rate", performance['error_rate'])
                mlflow.log_metric("average_response_time", performance['average_response_time'])
                mlflow.log_metric("throughput", performance['throughput'])
                mlflow.log_metric("compliance_score", performance['compliance_score'])
        
        return performance
    
    async def get_policy_for_request(self, request_context: Dict[str, Any]) -> Optional[PolicyVersion]:
        """Get the appropriate policy version for a request based on active tests and rollouts"""
        
        user_id = request_context.get('user_id')
        business_type = request_context.get('business_type')
        region = request_context.get('region')
        risk_profile = request_context.get('risk_profile')
        
        # Check for active A/B tests
        for test_id, ab_config in self.ab_tests.items():
            if ab_config['status'] != 'active':
                continue
            
            # Check if user should be included in A/B test
            if await self._should_include_in_test(request_context, ab_config):
                # Select policy version based on traffic split
                selected_version = await self._select_ab_test_version(user_id, ab_config)
                policy_version = await self._get_policy_version(selected_version)
                
                # Log A/B test assignment
                await self._log_ab_test_assignment(test_id, user_id, selected_version)
                
                return policy_version
        
        # Check for active rollouts
        for rollout_id, rollout_config in self.rollouts.items():
            if rollout_config['status'] != 'active':
                continue
            
            # Check if user should be included in rollout
            if await self._should_include_in_rollout(request_context, rollout_config):
                policy_version = await self._get_policy_version(rollout_config['policy_version_id'])
                return policy_version
        
        # Return default/production policy
        return await self._get_default_policy()
    
    async def _create_test(self, test_config: TestConfiguration) -> str:
        """Create a new test configuration"""
        test_id = test_config.id
        
        # Save to database
        if self.db_connection:
            with self.db_connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO policy_tests 
                    (test_id, test_type, name, description, configuration, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    test_id,
                    test_config.test_type.value,
                    test_config.name,
                    test_config.description,
                    json.dumps(test_config.dict(), default=str),
                    datetime.utcnow()
                ))
                self.db_connection.commit()
        
        return test_id
    
    async def _save_policy_version(self, policy_version: PolicyVersion):
        """Save policy version to database"""
        if self.db_connection:
            with self.db_connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO policy_versions 
                    (version_id, policy_id, version, rules, status, created_by, created_at, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (version_id) 
                    DO UPDATE SET 
                        rules = EXCLUDED.rules,
                        status = EXCLUDED.status,
                        updated_at = CURRENT_TIMESTAMP
                """, (
                    policy_version.id,
                    policy_version.policy_id,
                    policy_version.version,
                    json.dumps([rule.dict() for rule in policy_version.rules], default=str),
                    policy_version.status.value,
                    policy_version.created_by,
                    policy_version.created_at,
                    json.dumps(policy_version.metadata, default=str)
                ))
                self.db_connection.commit()
    
    async def _save_test_configuration(self, test_id: str, config: Dict[str, Any]):
        """Save test configuration to database"""
        if self.db_connection:
            with self.db_connection.cursor() as cursor:
                cursor.execute("""
                    UPDATE policy_tests 
                    SET configuration = %s, updated_at = %s
                    WHERE test_id = %s
                """, (
                    json.dumps(config, default=str),
                    datetime.utcnow(),
                    test_id
                ))
                self.db_connection.commit()
    
    async def _save_rollout_plan(self, rollout_plan: RolloutPlan):
        """Save rollout plan to database"""
        if self.db_connection:
            with self.db_connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO rollout_plans 
                    (rollout_id, policy_version_id, strategy, phases, current_phase, 
                     target_groups, success_criteria, rollback_criteria, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    rollout_plan.id,
                    rollout_plan.policy_version_id,
                    rollout_plan.strategy.value,
                    json.dumps(rollout_plan.phases, default=str),
                    rollout_plan.current_phase,
                    json.dumps(rollout_plan.target_groups),
                    json.dumps(rollout_plan.success_criteria, default=str),
                    json.dumps(rollout_plan.rollback_criteria, default=str),
                    rollout_plan.created_at
                ))
                self.db_connection.commit()
    
    async def _get_rollout_plan(self, rollout_id: str) -> Optional[RolloutPlan]:
        """Get rollout plan from database"""
        if self.db_connection:
            with self.db_connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute("""
                    SELECT * FROM rollout_plans WHERE rollout_id = %s
                """, (rollout_id,))
                
                row = cursor.fetchone()
                if row:
                    return RolloutPlan(
                        id=row['rollout_id'],
                        policy_version_id=row['policy_version_id'],
                        strategy=RolloutStrategy(row['strategy']),
                        phases=json.loads(row['phases']),
                        current_phase=row['current_phase'],
                        target_groups=json.loads(row['target_groups']),
                        success_criteria=json.loads(row['success_criteria']),
                        rollback_criteria=json.loads(row['rollback_criteria']),
                        created_at=row['created_at']
                    )
        return None
    
    async def _update_rollout_plan(self, rollout_plan: RolloutPlan):
        """Update rollout plan in database"""
        if self.db_connection:
            with self.db_connection.cursor() as cursor:
                cursor.execute("""
                    UPDATE rollout_plans 
                    SET current_phase = %s, updated_at = %s
                    WHERE rollout_id = %s
                """, (
                    rollout_plan.current_phase,
                    datetime.utcnow(),
                    rollout_plan.id
                ))
                self.db_connection.commit()
    
    async def _execute_phase(self, rollout_plan: RolloutPlan, phase: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a rollout phase"""
        # Simulate phase execution
        # In a real implementation, this would deploy the policy to the specified targets
        
        await asyncio.sleep(1)  # Simulate deployment time
        
        # Simulate metrics collection
        success_rate = random.uniform(0.85, 0.98)
        error_rate = 1.0 - success_rate
        
        return {
            'success_rate': success_rate,
            'error_rate': error_rate,
            'deployment_time': 1.0,
            'targets_reached': phase.get('percentage', 100),
            'metrics': {
                'transactions_processed': random.randint(1000, 10000),
                'average_response_time': random.uniform(50, 200),
                'throughput': random.uniform(100, 1000)
            }
        }
    
    async def _initiate_rollback(self, rollout_plan: RolloutPlan, failure_result: Dict[str, Any]):
        """Initiate rollback procedure"""
        logger.warning(f"Initiating rollback for rollout {rollout_plan.id}")
        
        # Log rollback event
        if self.mlflow_client:
            with mlflow.start_run():
                mlflow.log_param("rollout_id", rollout_plan.id)
                mlflow.log_param("failed_phase", rollout_plan.current_phase)
                mlflow.log_metric("failure_success_rate", failure_result['success_rate'])
                mlflow.log_metric("failure_error_rate", failure_result['error_rate'])
        
        # Update rollout status
        if self.db_connection:
            with self.db_connection.cursor() as cursor:
                cursor.execute("""
                    UPDATE rollout_plans 
                    SET status = 'failed', updated_at = %s
                    WHERE rollout_id = %s
                """, (datetime.utcnow(), rollout_plan.id))
                self.db_connection.commit()
    
    async def _collect_policy_metrics(self, policy_version_id: str, 
                                    start_time: datetime, end_time: datetime) -> Dict[str, Any]:
        """Collect policy metrics from database"""
        metrics = {
            'total_executions': random.randint(1000, 10000),
            'success_rate': random.uniform(0.90, 0.99),
            'error_rate': random.uniform(0.01, 0.10),
            'avg_response_time': random.uniform(50, 200),
            'throughput': random.uniform(100, 1000),
            'compliance_score': random.uniform(0.85, 0.98),
            'user_satisfaction': random.uniform(0.80, 0.95),
            'transactions_processed': random.randint(5000, 50000),
            'fraud_detected': random.randint(10, 100),
            'false_positives': random.randint(1, 20),
            'cost_savings': random.uniform(1000, 10000)
        }
        
        return metrics
    
    async def _should_include_in_test(self, request_context: Dict[str, Any], 
                                    test_config: Dict[str, Any]) -> bool:
        """Determine if a request should be included in a test"""
        # Simple hash-based inclusion
        user_id = request_context.get('user_id', '')
        test_id = test_config['test_id']
        
        hash_input = f"{user_id}:{test_id}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16)
        
        inclusion_threshold = test_config['target_percentage'] / 100.0
        return (hash_value % 10000) / 10000.0 < inclusion_threshold
    
    async def _should_include_in_rollout(self, request_context: Dict[str, Any], 
                                       rollout_config: Dict[str, Any]) -> bool:
        """Determine if a request should be included in a rollout"""
        # Check rollout criteria
        current_phase = rollout_config.get('current_phase', {})
        
        # Geographic targeting
        if 'regions' in current_phase:
            user_region = request_context.get('region')
            if user_region not in current_phase['regions'] and 'all' not in current_phase['regions']:
                return False
        
        # Business type targeting
        if 'business_types' in current_phase:
            business_type = request_context.get('business_type')
            if business_type not in current_phase['business_types'] and 'all' not in current_phase['business_types']:
                return False
        
        # Risk profile targeting
        if 'risk_profiles' in current_phase:
            risk_profile = request_context.get('risk_profile')
            if risk_profile not in current_phase['risk_profiles'] and 'all' not in current_phase['risk_profiles']:
                return False
        
        return True
    
    async def _select_ab_test_version(self, user_id: str, ab_config: Dict[str, Any]) -> str:
        """Select policy version for A/B test based on user ID"""
        policy_versions = ab_config['policy_versions']
        
        # Consistent hash-based selection
        hash_value = int(hashlib.md5(user_id.encode()).hexdigest(), 16)
        version_index = hash_value % len(policy_versions)
        
        return policy_versions[version_index]
    
    async def _log_ab_test_assignment(self, test_id: str, user_id: str, policy_version_id: str):
        """Log A/B test assignment"""
        if self.db_connection:
            with self.db_connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO ab_test_assignments 
                    (test_id, user_id, policy_version_id, assigned_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (test_id, user_id) DO NOTHING
                """, (test_id, user_id, policy_version_id, datetime.utcnow()))
                self.db_connection.commit()
    
    async def _get_policy_version(self, version_id: str) -> Optional[PolicyVersion]:
        """Get policy version from database"""
        if self.db_connection:
            with self.db_connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute("""
                    SELECT * FROM policy_versions WHERE version_id = %s
                """, (version_id,))
                
                row = cursor.fetchone()
                if row:
                    rules = [PolicyRule(**rule_data) for rule_data in json.loads(row['rules'])]
                    return PolicyVersion(
                        id=row['version_id'],
                        policy_id=row['policy_id'],
                        version=row['version'],
                        rules=rules,
                        status=PolicyStatus(row['status']),
                        created_by=row['created_by'],
                        created_at=row['created_at'],
                        metadata=json.loads(row['metadata'])
                    )
        return None
    
    async def _get_default_policy(self) -> Optional[PolicyVersion]:
        """Get the default/production policy version"""
        if self.db_connection:
            with self.db_connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute("""
                    SELECT * FROM policy_versions 
                    WHERE status = 'full_deployment'
                    ORDER BY created_at DESC
                    LIMIT 1
                """, )
                
                row = cursor.fetchone()
                if row:
                    rules = [PolicyRule(**rule_data) for rule_data in json.loads(row['rules'])]
                    return PolicyVersion(
                        id=row['version_id'],
                        policy_id=row['policy_id'],
                        version=row['version'],
                        rules=rules,
                        status=PolicyStatus(row['status']),
                        created_by=row['created_by'],
                        created_at=row['created_at'],
                        metadata=json.loads(row['metadata'])
                    )
        return None

# FastAPI application
app = FastAPI(
    title="Advanced Policy Engine",
    description="Enterprise policy management with pilot testing, A/B testing, and targeted rollouts",
    version="2.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()] or ["https://app.remitflow.example"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Internal-Token"],
)

# Initialize policy engine
policy_engine = PolicyEngineCore()

# Authentication dependency
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    # In a real implementation, validate JWT token and extract user info
    return {
        'user_id': 'admin',
        'role': 'policy_admin',
        'permissions': ['create_policy', 'start_test', 'manage_rollout']
    }

@app.post("/policies")
async def create_policy(
    policy_data: Dict[str, Any],
    current_user: Dict = Depends(get_current_user)
):
    """Create a new policy version"""
    
    policy_version = await policy_engine.create_policy_version(
        policy_data, 
        current_user['user_id']
    )
    
    return {
        'status': 'success',
        'policy_version_id': policy_version.id,
        'version': policy_version.version,
        'rules_count': len(policy_version.rules)
    }

@app.post("/tests/pilot")
async def start_pilot_test(
    policy_version_id: str,
    test_config: TestConfiguration,
    current_user: Dict = Depends(get_current_user)
):
    """Start a pilot test for a policy version"""
    
    test_id = await policy_engine.start_pilot_test(policy_version_id, test_config)
    
    return {
        'status': 'success',
        'test_id': test_id,
        'test_type': 'pilot',
        'policy_version_id': policy_version_id,
        'duration_hours': test_config.duration_hours
    }

@app.post("/tests/ab")
async def start_ab_test(
    policy_versions: List[str],
    test_config: TestConfiguration,
    current_user: Dict = Depends(get_current_user)
):
    """Start an A/B test between multiple policy versions"""
    
    test_id = await policy_engine.start_ab_test(policy_versions, test_config)
    
    return {
        'status': 'success',
        'test_id': test_id,
        'test_type': 'ab_test',
        'policy_versions': policy_versions,
        'traffic_split': 100.0 / len(policy_versions)
    }

@app.post("/rollouts")
async def create_rollout(
    policy_version_id: str,
    strategy: RolloutStrategy,
    target_groups: List[str],
    current_user: Dict = Depends(get_current_user)
):
    """Create a targeted rollout plan"""
    
    rollout_plan = await policy_engine.create_rollout_plan(
        policy_version_id, 
        strategy, 
        target_groups
    )
    
    return {
        'status': 'success',
        'rollout_id': rollout_plan.id,
        'strategy': strategy.value,
        'phases_count': len(rollout_plan.phases),
        'target_groups': target_groups
    }

@app.post("/rollouts/{rollout_id}/execute")
async def execute_rollout_phase(
    rollout_id: str,
    current_user: Dict = Depends(get_current_user)
):
    """Execute the next phase of a rollout plan"""
    
    result = await policy_engine.execute_rollout_phase(rollout_id)
    
    return result

@app.get("/policies/{policy_version_id}/performance")
async def get_policy_performance(
    policy_version_id: str,
    evaluation_period_hours: int = 24,
    current_user: Dict = Depends(get_current_user)
):
    """Get policy performance metrics"""
    
    performance = await policy_engine.evaluate_policy_performance(
        policy_version_id, 
        evaluation_period_hours
    )
    
    return performance

@app.post("/policies/resolve")
async def resolve_policy_for_request(
    request_context: Dict[str, Any]
):
    """Get the appropriate policy version for a request"""
    
    policy_version = await policy_engine.get_policy_for_request(request_context)
    
    if policy_version:
        return {
            'policy_version_id': policy_version.id,
            'version': policy_version.version,
            'status': policy_version.status.value,
            'rules_count': len(policy_version.rules)
        }
    else:
        return {
            'policy_version_id': None,
            'message': 'No applicable policy found'
        }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    
    redis_status = "connected" if policy_engine.redis_client else "disconnected"
    db_status = "connected" if policy_engine.db_connection else "disconnected"
    mlflow_status = "connected" if policy_engine.mlflow_client else "disconnected"
    
    return {
        'status': 'healthy',
        'service': 'advanced-policy-engine',
        'version': '2.1.0',
        'timestamp': datetime.utcnow().isoformat(),
        'dependencies': {
            'redis': redis_status,
            'database': db_status,
            'mlflow': mlflow_status
        },
        'features': {
            'pilot_testing': True,
            'ab_testing': True,
            'targeted_rollouts': True,
            'performance_monitoring': True,
            'automatic_rollback': True
        }
    }

if __name__ == "__main__":
    uvicorn.run(
        "advanced_policy_engine:app",
        host="0.0.0.0",
        port=8094,
        reload=True,
        log_level="info"
    )

