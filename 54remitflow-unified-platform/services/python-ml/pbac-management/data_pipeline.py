"""
PBAC ML Data Pipeline - Production-Ready Data Collection and Processing

This module provides real data collection from audit logs, Kafka streams,
and database sources for ML model training instead of synthetic data.
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Generator
import asyncio
from dataclasses import dataclass, asdict

import psycopg2
from psycopg2.extras import RealDictCursor
import redis
from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import KafkaError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class AuditEvent:
    """Structured audit event for ML training"""
    request_id: str
    subject: str
    resource: str
    action: str
    decision: str
    reason: str
    policies: List[str]
    context: Dict[str, Any]
    timestamp: datetime
    duration_ms: int
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'request_id': self.request_id,
            'subject': self.subject,
            'resource': self.resource,
            'action': self.action,
            'decision': self.decision,
            'reason': self.reason,
            'policies': json.dumps(self.policies),
            'context': json.dumps(self.context),
            'timestamp': self.timestamp.isoformat() if isinstance(self.timestamp, datetime) else self.timestamp,
            'duration_ms': self.duration_ms
        }


class DatabaseDataSource:
    """Collects audit data from PostgreSQL database"""
    
    def __init__(self, db_config: Dict[str, str]):
        self.db_config = db_config
        
    def get_connection(self):
        return psycopg2.connect(**self.db_config)
    
    def get_audit_data(self, days: int = 30, limit: int = 10000) -> List[Dict]:
        """Get audit log data from database"""
        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT 
                            request_id,
                            subject,
                            resource,
                            action,
                            decision,
                            reason,
                            policies,
                            context,
                            timestamp,
                            duration_ms
                        FROM audit_logs 
                        WHERE timestamp >= %s 
                        ORDER BY timestamp DESC 
                        LIMIT %s
                    """, (datetime.now() - timedelta(days=days), limit))
                    
                    rows = cur.fetchall()
                    logger.info(f"Retrieved {len(rows)} audit records from database")
                    return [dict(row) for row in rows]
                    
        except psycopg2.Error as e:
            logger.error(f"Database error getting audit data: {e}")
            return []
    
    def get_policy_data(self) -> List[Dict]:
        """Get active policies from database"""
        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT 
                            id, name, description, resource, action, 
                            effect, conditions, priority, active,
                            created_at, updated_at
                        FROM policies 
                        WHERE active = true
                        ORDER BY priority ASC
                    """)
                    
                    rows = cur.fetchall()
                    logger.info(f"Retrieved {len(rows)} active policies from database")
                    return [dict(row) for row in rows]
                    
        except psycopg2.Error as e:
            logger.error(f"Database error getting policy data: {e}")
            return []
    
    def get_user_access_patterns(self, subject: str, days: int = 7) -> List[Dict]:
        """Get access patterns for a specific user"""
        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT 
                            resource,
                            action,
                            decision,
                            COUNT(*) as count,
                            AVG(duration_ms) as avg_duration_ms
                        FROM audit_logs 
                        WHERE subject = %s 
                          AND timestamp >= %s 
                        GROUP BY resource, action, decision
                        ORDER BY count DESC
                    """, (subject, datetime.now() - timedelta(days=days)))
                    
                    return [dict(row) for row in cur.fetchall()]
                    
        except psycopg2.Error as e:
            logger.error(f"Database error getting user patterns: {e}")
            return []


class KafkaDataSource:
    """Collects real-time audit events from Kafka"""
    
    def __init__(self, bootstrap_servers: str, topic: str = 'pbac.audit.events'):
        self.bootstrap_servers = bootstrap_servers
        self.topic = topic
        self.consumer = None
        self.producer = None
        
    def connect_consumer(self, group_id: str = 'pbac-ml-training'):
        """Connect Kafka consumer for real-time events"""
        try:
            self.consumer = KafkaConsumer(
                self.topic,
                bootstrap_servers=self.bootstrap_servers,
                group_id=group_id,
                auto_offset_reset='earliest',
                enable_auto_commit=True,
                value_deserializer=lambda x: json.loads(x.decode('utf-8'))
            )
            logger.info(f"Connected to Kafka topic: {self.topic}")
            return True
        except KafkaError as e:
            logger.error(f"Failed to connect to Kafka: {e}")
            return False
    
    def connect_producer(self):
        """Connect Kafka producer for publishing events"""
        try:
            self.producer = KafkaProducer(
                bootstrap_servers=self.bootstrap_servers,
                value_serializer=lambda x: json.dumps(x).encode('utf-8')
            )
            logger.info("Connected Kafka producer")
            return True
        except KafkaError as e:
            logger.error(f"Failed to connect Kafka producer: {e}")
            return False
    
    def consume_events(self, max_events: int = 1000, timeout_ms: int = 5000) -> List[Dict]:
        """Consume events from Kafka for batch training"""
        if not self.consumer:
            if not self.connect_consumer():
                return []
        
        events = []
        try:
            # Poll for messages
            messages = self.consumer.poll(timeout_ms=timeout_ms, max_records=max_events)
            
            for topic_partition, records in messages.items():
                for record in records:
                    events.append(record.value)
            
            logger.info(f"Consumed {len(events)} events from Kafka")
            return events
            
        except KafkaError as e:
            logger.error(f"Error consuming Kafka events: {e}")
            return []
    
    def stream_events(self) -> Generator[Dict, None, None]:
        """Stream events from Kafka for online learning"""
        if not self.consumer:
            if not self.connect_consumer():
                return
        
        try:
            for message in self.consumer:
                yield message.value
        except KafkaError as e:
            logger.error(f"Error streaming Kafka events: {e}")
    
    def publish_training_event(self, event: AuditEvent):
        """Publish audit event for ML training pipeline"""
        if not self.producer:
            if not self.connect_producer():
                return False
        
        try:
            self.producer.send(self.topic, event.to_dict())
            self.producer.flush()
            return True
        except KafkaError as e:
            logger.error(f"Error publishing event: {e}")
            return False
    
    def close(self):
        """Close Kafka connections"""
        if self.consumer:
            self.consumer.close()
        if self.producer:
            self.producer.close()


class RedisDataSource:
    """Collects cached access patterns from Redis"""
    
    def __init__(self, host: str, port: int = 6379, password: str = ''):
        self.client = redis.Redis(
            host=host,
            port=port,
            password=password,
            decode_responses=True
        )
    
    def get_recent_decisions(self, pattern: str = 'pbac:decision:*', limit: int = 1000) -> List[Dict]:
        """Get recent cached decisions"""
        decisions = []
        
        try:
            cursor = 0
            count = 0
            
            while count < limit:
                cursor, keys = self.client.scan(cursor, match=pattern, count=100)
                
                for key in keys:
                    if count >= limit:
                        break
                    
                    data = self.client.get(key)
                    if data:
                        try:
                            decisions.append(json.loads(data))
                            count += 1
                        except json.JSONDecodeError:
                            continue
                
                if cursor == 0:
                    break
            
            logger.info(f"Retrieved {len(decisions)} cached decisions from Redis")
            return decisions
            
        except redis.RedisError as e:
            logger.error(f"Redis error: {e}")
            return []
    
    def get_access_frequency(self, subject: str) -> Dict[str, int]:
        """Get access frequency for a subject"""
        try:
            key = f'pbac:frequency:{subject}'
            data = self.client.hgetall(key)
            return {k: int(v) for k, v in data.items()}
        except redis.RedisError as e:
            logger.error(f"Redis error getting frequency: {e}")
            return {}
    
    def increment_access_frequency(self, subject: str, resource: str, action: str):
        """Increment access frequency counter"""
        try:
            key = f'pbac:frequency:{subject}'
            field = f'{resource}:{action}'
            self.client.hincrby(key, field, 1)
            self.client.expire(key, 86400 * 7)  # 7 days TTL
        except redis.RedisError as e:
            logger.error(f"Redis error incrementing frequency: {e}")


class PBACDataPipeline:
    """Unified data pipeline for PBAC ML training"""
    
    def __init__(self):
        # Database source
        self.db_source = DatabaseDataSource({
            'host': os.getenv('DB_HOST', 'localhost'),
            'port': os.getenv('DB_PORT', '5432'),
            'user': os.getenv('DB_USER', 'postgres'),
            'password': os.getenv('DB_PASSWORD', ''),
            'database': os.getenv('DB_NAME', 'remittance')
        })
        
        # Kafka source
        kafka_servers = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
        self.kafka_source = KafkaDataSource(kafka_servers)
        
        # Redis source
        self.redis_source = RedisDataSource(
            host=os.getenv('REDIS_HOST', 'localhost'),
            port=int(os.getenv('REDIS_PORT', '6379')),
            password=os.getenv('REDIS_PASSWORD', '')
        )
        
        # Minimum data threshold for real training
        self.min_training_samples = int(os.getenv('MIN_TRAINING_SAMPLES', '100'))
    
    def collect_training_data(self, days: int = 30) -> List[Dict]:
        """Collect training data from all sources"""
        all_data = []
        
        # 1. Get historical data from database (primary source)
        db_data = self.db_source.get_audit_data(days=days)
        all_data.extend(db_data)
        logger.info(f"Collected {len(db_data)} records from database")
        
        # 2. Get recent events from Kafka (real-time supplement)
        kafka_data = self.kafka_source.consume_events(max_events=1000)
        all_data.extend(kafka_data)
        logger.info(f"Collected {len(kafka_data)} records from Kafka")
        
        # 3. Get cached decisions from Redis (recent patterns)
        redis_data = self.redis_source.get_recent_decisions()
        all_data.extend(redis_data)
        logger.info(f"Collected {len(redis_data)} records from Redis")
        
        # Deduplicate by request_id
        seen_ids = set()
        unique_data = []
        for record in all_data:
            request_id = record.get('request_id')
            if request_id and request_id not in seen_ids:
                seen_ids.add(request_id)
                unique_data.append(record)
        
        logger.info(f"Total unique training records: {len(unique_data)}")
        return unique_data
    
    def has_sufficient_data(self) -> bool:
        """Check if we have enough real data for training"""
        count = len(self.db_source.get_audit_data(days=30, limit=self.min_training_samples + 1))
        return count >= self.min_training_samples
    
    def get_policies(self) -> List[Dict]:
        """Get current active policies"""
        return self.db_source.get_policy_data()
    
    def get_user_patterns(self, subject: str) -> Dict[str, Any]:
        """Get comprehensive access patterns for a user"""
        return {
            'db_patterns': self.db_source.get_user_access_patterns(subject),
            'frequency': self.redis_source.get_access_frequency(subject)
        }
    
    def close(self):
        """Close all connections"""
        self.kafka_source.close()


# Singleton instance
_pipeline_instance: Optional[PBACDataPipeline] = None

def get_data_pipeline() -> PBACDataPipeline:
    """Get or create the data pipeline singleton"""
    global _pipeline_instance
    if _pipeline_instance is None:
        _pipeline_instance = PBACDataPipeline()
    return _pipeline_instance


if __name__ == '__main__':
    # Test the data pipeline
    pipeline = get_data_pipeline()
    
    print(f"Has sufficient data: {pipeline.has_sufficient_data()}")
    
    data = pipeline.collect_training_data(days=7)
    print(f"Collected {len(data)} training records")
    
    policies = pipeline.get_policies()
    print(f"Active policies: {len(policies)}")
    
    pipeline.close()
