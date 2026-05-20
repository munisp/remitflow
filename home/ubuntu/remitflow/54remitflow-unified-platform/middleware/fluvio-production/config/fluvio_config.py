"""
Fluvio Configuration
Configuration management for Fluvio streaming service
"""

import os
from typing import Dict, Any, List
from dataclasses import dataclass, field


@dataclass
class FluvioConfig:
    """Fluvio configuration"""
    
    # Cluster configuration
    cluster_url: str = field(default_factory=lambda: os.getenv("FLUVIO_CLUSTER_URL", "localhost:9003"))
    profile: str = field(default_factory=lambda: os.getenv("FLUVIO_PROFILE", "default"))
    
    # Producer configuration
    producer_batch_size: int = field(default_factory=lambda: int(os.getenv("FLUVIO_PRODUCER_BATCH_SIZE", "100")))
    producer_flush_interval: float = field(default_factory=lambda: float(os.getenv("FLUVIO_PRODUCER_FLUSH_INTERVAL", "1.0")))
    producer_max_retries: int = field(default_factory=lambda: int(os.getenv("FLUVIO_PRODUCER_MAX_RETRIES", "3")))
    
    # Consumer configuration
    consumer_group_id: str = field(default_factory=lambda: os.getenv("FLUVIO_CONSUMER_GROUP_ID", "remittance-group"))
    consumer_auto_commit: bool = field(default_factory=lambda: os.getenv("FLUVIO_CONSUMER_AUTO_COMMIT", "true").lower() == "true")
    consumer_max_retries: int = field(default_factory=lambda: int(os.getenv("FLUVIO_CONSUMER_MAX_RETRIES", "3")))
    
    # Topics configuration
    topics: Dict[str, Dict[str, Any]] = field(default_factory=lambda: {
        "payment-events": {
            "partitions": 3,
            "replication": 2,
            "retention_time": "7d",
            "compression": "gzip"
        },
        "transaction-events": {
            "partitions": 3,
            "replication": 2,
            "retention_time": "30d",
            "compression": "gzip"
        },
        "audit-events": {
            "partitions": 2,
            "replication": 2,
            "retention_time": "90d",
            "compression": "gzip"
        },
        "kyc-events": {
            "partitions": 2,
            "replication": 2,
            "retention_time": "365d",
            "compression": "gzip"
        },
        "fraud-alerts": {
            "partitions": 2,
            "replication": 3,
            "retention_time": "180d",
            "compression": "gzip"
        },
        "system-metrics": {
            "partitions": 1,
            "replication": 2,
            "retention_time": "7d",
            "compression": "snappy"
        }
    })
    
    # Monitoring configuration
    metrics_enabled: bool = field(default_factory=lambda: os.getenv("FLUVIO_METRICS_ENABLED", "true").lower() == "true")
    metrics_port: int = field(default_factory=lambda: int(os.getenv("FLUVIO_METRICS_PORT", "9091")))
    
    # Logging configuration
    log_level: str = field(default_factory=lambda: os.getenv("FLUVIO_LOG_LEVEL", "INFO"))
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            "cluster_url": self.cluster_url,
            "profile": self.profile,
            "producer": {
                "batch_size": self.producer_batch_size,
                "flush_interval": self.producer_flush_interval,
                "max_retries": self.producer_max_retries
            },
            "consumer": {
                "group_id": self.consumer_group_id,
                "auto_commit": self.consumer_auto_commit,
                "max_retries": self.consumer_max_retries
            },
            "topics": self.topics,
            "monitoring": {
                "metrics_enabled": self.metrics_enabled,
                "metrics_port": self.metrics_port
            },
            "logging": {
                "log_level": self.log_level
            }
        }


# Global configuration instance
_config: FluvioConfig = None


def get_config() -> FluvioConfig:
    """Get global Fluvio configuration"""
    global _config
    if _config is None:
        _config = FluvioConfig()
    return _config


def load_config(config_dict: Dict[str, Any] = None) -> FluvioConfig:
    """Load configuration from dictionary"""
    global _config
    
    if config_dict:
        _config = FluvioConfig(**config_dict)
    else:
        _config = FluvioConfig()
    
    return _config
