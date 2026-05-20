"""
Kafka Configuration Module
Production-ready Kafka configuration for Nigerian Remittance Platform
"""

import os
from dataclasses import dataclass
from typing import List, Dict, Any

@dataclass
class KafkaConfig:
    """Kafka cluster configuration"""
    
    # Broker configuration
    bootstrap_servers: List[str] = None
    schema_registry_url: str = None
    
    # Producer configuration
    producer_config: Dict[str, Any] = None
    
    # Consumer configuration
    consumer_config: Dict[str, Any] = None
    
    # Topic configuration
    topics: Dict[str, Dict[str, Any]] = None
    
    def __post_init__(self):
        """Initialize default configurations"""
        if self.bootstrap_servers is None:
            self.bootstrap_servers = os.getenv(
                'KAFKA_BOOTSTRAP_SERVERS',
                'localhost:19092,localhost:19093,localhost:19094'
            ).split(',')
        
        if self.schema_registry_url is None:
            self.schema_registry_url = os.getenv(
                'SCHEMA_REGISTRY_URL',
                'http://localhost:8081'
            )
        
        if self.producer_config is None:
            self.producer_config = {
                'bootstrap.servers': ','.join(self.bootstrap_servers),
                'client.id': 'remittance-producer',
                'acks': 'all',  # Wait for all replicas
                'retries': 3,
                'max.in.flight.requests.per.connection': 5,
                'compression.type': 'snappy',
                'linger.ms': 10,
                'batch.size': 16384,
                'buffer.memory': 33554432,
                'enable.idempotence': True,
                'transactional.id': 'remittance-transactions',
            }
        
        if self.consumer_config is None:
            self.consumer_config = {
                'bootstrap.servers': ','.join(self.bootstrap_servers),
                'group.id': 'remittance-consumer-group',
                'auto.offset.reset': 'earliest',
                'enable.auto.commit': False,  # Manual commit for exactly-once
                'max.poll.interval.ms': 300000,
                'session.timeout.ms': 10000,
                'max.poll.records': 500,
                'isolation.level': 'read_committed',
            }
        
        if self.topics is None:
            self.topics = {
                # Transaction events
                'transactions.created': {
                    'partitions': 6,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 604800000,  # 7 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                'transactions.completed': {
                    'partitions': 6,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 2592000000,  # 30 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                'transactions.failed': {
                    'partitions': 3,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 2592000000,  # 30 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                
                # Fraud detection events
                'fraud.alerts': {
                    'partitions': 3,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 7776000000,  # 90 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                'fraud.analysis': {
                    'partitions': 6,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 2592000000,  # 30 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                
                # Compliance events
                'compliance.kyc': {
                    'partitions': 3,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 31536000000,  # 365 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                'compliance.aml': {
                    'partitions': 3,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 31536000000,  # 365 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                
                # User events
                'users.created': {
                    'partitions': 3,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 2592000000,  # 30 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                'users.updated': {
                    'partitions': 3,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 2592000000,  # 30 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'compact',
                    }
                },
                
                # Payment corridor events
                'corridors.papss': {
                    'partitions': 6,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 2592000000,  # 30 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                'corridors.cips': {
                    'partitions': 6,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 2592000000,  # 30 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                'corridors.pix': {
                    'partitions': 6,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 2592000000,  # 30 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
                
                # Dead letter queue
                'dlq.errors': {
                    'partitions': 3,
                    'replication_factor': 3,
                    'config': {
                        'retention.ms': 7776000000,  # 90 days
                        'min.insync.replicas': 2,
                        'cleanup.policy': 'delete',
                    }
                },
            }


# Global configuration instance
kafka_config = KafkaConfig()


def get_producer_config() -> Dict[str, Any]:
    """Get producer configuration"""
    return kafka_config.producer_config.copy()


def get_consumer_config(group_id: str = None) -> Dict[str, Any]:
    """Get consumer configuration with optional group ID override"""
    config = kafka_config.consumer_config.copy()
    if group_id:
        config['group.id'] = group_id
    return config


def get_topic_config(topic_name: str) -> Dict[str, Any]:
    """Get configuration for a specific topic"""
    return kafka_config.topics.get(topic_name, {})


def get_all_topics() -> List[str]:
    """Get list of all configured topics"""
    return list(kafka_config.topics.keys())

