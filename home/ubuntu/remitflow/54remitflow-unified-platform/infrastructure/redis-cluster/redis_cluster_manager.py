#!/usr/bin/env python3
"""
Redis Cluster Management System for Remittance Platform
Provides complete Redis cluster setup, monitoring, and management
Optimized for high-availability banking operations
"""

import os
import sys
import json
import logging
import asyncio
import subprocess
import time
import signal
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Redis and clustering
import redis
import redis.sentinel
from rediscluster import RedisCluster
import hiredis

# Monitoring and metrics
from prometheus_client import Counter, Histogram, Gauge, generate_latest, start_http_server
import psutil

# Configuration management
import yaml
import configparser

# Async support
import aioredis
import asyncio

# Web framework for management API
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS

# Utilities
import hashlib
import uuid
import base64
from concurrent.futures import ThreadPoolExecutor
import multiprocessing

# Structured logging
import structlog

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# Prometheus metrics
REDIS_OPERATIONS = Counter('redis_operations_total', 'Total Redis operations', ['operation', 'node', 'status'])
REDIS_LATENCY = Histogram('redis_operation_duration_seconds', 'Redis operation latency', ['operation', 'node'])
REDIS_MEMORY_USAGE = Gauge('redis_memory_usage_bytes', 'Redis memory usage', ['node', 'type'])
REDIS_CONNECTIONS = Gauge('redis_connections_total', 'Redis connections', ['node', 'type'])
REDIS_KEYSPACE_HITS = Counter('redis_keyspace_hits_total', 'Redis keyspace hits', ['node'])
REDIS_KEYSPACE_MISSES = Counter('redis_keyspace_misses_total', 'Redis keyspace misses', ['node'])
REDIS_CLUSTER_STATE = Gauge('redis_cluster_state', 'Redis cluster state', ['cluster'])

@dataclass
class RedisNodeConfig:
    """Redis node configuration"""
    node_id: str
    host: str
    port: int
    role: str  # master, slave, sentinel
    cluster_enabled: bool
    max_memory: str
    max_memory_policy: str
    save_config: List[str]
    appendonly: bool
    appendfsync: str
    data_dir: str
    log_file: str
    pid_file: str
    config_file: str

@dataclass
class ClusterConfig:
    """Redis cluster configuration"""
    cluster_name: str
    nodes: List[RedisNodeConfig]
    sentinel_nodes: List[RedisNodeConfig]
    cluster_require_full_coverage: bool
    cluster_node_timeout: int
    cluster_migration_barrier: int
    cluster_replica_validity_factor: int
    replication_factor: int
    auth_password: Optional[str]
    tls_enabled: bool
    backup_schedule: str
    monitoring_enabled: bool

@dataclass
class NodeStatus:
    """Redis node status"""
    node_id: str
    host: str
    port: int
    role: str
    status: str  # online, offline, failed
    memory_usage: int
    memory_peak: int
    connected_clients: int
    total_commands_processed: int
    keyspace_hits: int
    keyspace_misses: int
    hit_rate: float
    replication_lag: int
    last_save: datetime
    uptime: int
    version: str
    config_epoch: int
    cluster_state: str

class RedisConfigGenerator:
    """Generate Redis configuration files"""
    
    def __init__(self, base_dir: str = "/home/ubuntu/remittance-network/infrastructure/redis-cluster"):
        self.base_dir = Path(base_dir)
        self.config_dir = self.base_dir / "config"
        self.data_dir = self.base_dir / "data"
        self.logs_dir = self.base_dir / "logs"
        
        # Create directories
        for dir_path in [self.config_dir, self.data_dir, self.logs_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)
    
    def generate_node_config(self, node: RedisNodeConfig) -> str:
        """Generate Redis configuration for a node"""
        config_content = f"""# Redis Configuration for {node.node_id}
# Generated on {datetime.now().isoformat()}

# Network Configuration
bind 0.0.0.0
port {node.port}
tcp-backlog 511
timeout 0
tcp-keepalive 300

# General Configuration
daemonize yes
supervised no
pidfile {node.pid_file}
loglevel notice
logfile {node.log_file}
databases 16

# Snapshotting Configuration
"""
        
        # Add save configurations
        for save_config in node.save_config:
            config_content += f"save {save_config}\n"
        
        config_content += f"""
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir {node.data_dir}

# Replication Configuration
replica-serve-stale-data yes
replica-read-only yes
repl-diskless-sync no
repl-diskless-sync-delay 5
repl-ping-replica-period 10
repl-timeout 60
repl-disable-tcp-nodelay no
repl-backlog-size 1mb
repl-backlog-ttl 3600

# Security Configuration
"""
        
        if hasattr(node, 'auth_password') and node.auth_password:
            config_content += f"requirepass {node.auth_password}\n"
            config_content += f"masterauth {node.auth_password}\n"
        
        config_content += f"""
# Memory Management
maxmemory {node.max_memory}
maxmemory-policy {node.max_memory_policy}
maxmemory-samples 5

# Append Only File Configuration
appendonly {str(node.appendonly).lower()}
appendfilename "appendonly.aof"
appendfsync {node.appendfsync}
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes
aof-use-rdb-preamble yes

# Lua Scripting
lua-time-limit 5000

# Slow Log Configuration
slowlog-log-slower-than 10000
slowlog-max-len 128

# Latency Monitoring
latency-monitor-threshold 100

# Event Notification
notify-keyspace-events ""

# Advanced Configuration
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
list-compress-depth 0
set-max-intset-entries 512
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
hll-sparse-max-bytes 3000
stream-node-max-bytes 4096
stream-node-max-entries 100
activerehashing yes
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60
hz 10
dynamic-hz yes
aof-rewrite-incremental-fsync yes
rdb-save-incremental-fsync yes

# Cluster Configuration
"""
        
        if node.cluster_enabled:
            config_content += f"""cluster-enabled yes
cluster-config-file nodes-{node.port}.conf
cluster-node-timeout 15000
cluster-announce-ip {node.host}
cluster-announce-port {node.port}
cluster-announce-bus-port {node.port + 10000}
cluster-require-full-coverage yes
cluster-replica-validity-factor 10
cluster-migration-barrier 1
"""
        
        # Banking-specific optimizations
        config_content += f"""
# Banking-Specific Optimizations
# High availability settings
min-replicas-to-write 1
min-replicas-max-lag 10

# Performance tuning for banking workloads
tcp-keepalive 60
timeout 300

# Memory optimization for transaction data
maxmemory-samples 10

# Persistence for financial data integrity
save 900 1
save 300 10
save 60 10000

# Monitoring and debugging
latency-monitor-threshold 50
slowlog-log-slower-than 5000
"""
        
        return config_content
    
    def generate_sentinel_config(self, sentinel_node: RedisNodeConfig, 
                                master_nodes: List[RedisNodeConfig]) -> str:
        """Generate Redis Sentinel configuration"""
        config_content = f"""# Redis Sentinel Configuration for {sentinel_node.node_id}
# Generated on {datetime.now().isoformat()}

# Network Configuration
bind 0.0.0.0
port {sentinel_node.port}

# General Configuration
daemonize yes
pidfile {sentinel_node.pid_file}
logfile {sentinel_node.log_file}
dir {sentinel_node.data_dir}

# Sentinel Configuration
"""
        
        for master in master_nodes:
            if master.role == 'master':
                config_content += f"""
# Monitor master {master.node_id}
sentinel monitor {master.node_id} {master.host} {master.port} 2
sentinel down-after-milliseconds {master.node_id} 30000
sentinel parallel-syncs {master.node_id} 1
sentinel failover-timeout {master.node_id} 180000
"""
                
                if hasattr(master, 'auth_password') and master.auth_password:
                    config_content += f"sentinel auth-pass {master.node_id} {master.auth_password}\n"
        
        config_content += """
# Sentinel Security
# sentinel deny-scripts-reconfig yes

# Notification Scripts
# sentinel notification-script mymaster /var/redis/notify.sh
# sentinel client-reconfig-script mymaster /var/redis/reconfig.sh

# Banking-specific Sentinel settings
sentinel resolve-hostnames yes
sentinel announce-hostnames yes
"""
        
        return config_content
    
    def write_config_files(self, cluster_config: ClusterConfig):
        """Write all configuration files"""
        logger.info("Writing Redis configuration files", cluster=cluster_config.cluster_name)
        
        # Write node configurations
        for node in cluster_config.nodes:
            config_content = self.generate_node_config(node)
            config_file = self.config_dir / f"redis-{node.node_id}.conf"
            
            with open(config_file, 'w') as f:
                f.write(config_content)
            
            logger.info("Node configuration written", node=node.node_id, file=str(config_file))
        
        # Write sentinel configurations
        master_nodes = [node for node in cluster_config.nodes if node.role == 'master']
        for sentinel in cluster_config.sentinel_nodes:
            config_content = self.generate_sentinel_config(sentinel, master_nodes)
            config_file = self.config_dir / f"sentinel-{sentinel.node_id}.conf"
            
            with open(config_file, 'w') as f:
                f.write(config_content)
            
            logger.info("Sentinel configuration written", sentinel=sentinel.node_id, file=str(config_file))

class RedisClusterManager:
    """Manage Redis cluster operations"""
    
    def __init__(self, cluster_config: ClusterConfig):
        self.cluster_config = cluster_config
        self.config_generator = RedisConfigGenerator()
        self.processes = {}
        self.cluster_client = None
        self.sentinel_client = None
        self.monitoring_thread = None
        self.running = False
        
    def setup_cluster(self):
        """Setup the Redis cluster"""
        logger.info("Setting up Redis cluster", cluster=self.cluster_config.cluster_name)
        
        # Generate configuration files
        self.config_generator.write_config_files(self.cluster_config)
        
        # Start Redis nodes
        self.start_nodes()
        
        # Wait for nodes to be ready
        time.sleep(5)
        
        # Create cluster
        if self.cluster_config.nodes[0].cluster_enabled:
            self.create_cluster()
        
        # Start sentinels
        self.start_sentinels()
        
        # Initialize cluster client
        self.initialize_clients()
        
        logger.info("Redis cluster setup completed")
    
    def start_nodes(self):
        """Start all Redis nodes"""
        logger.info("Starting Redis nodes")
        
        for node in self.cluster_config.nodes:
            self.start_node(node)
    
    def start_node(self, node: RedisNodeConfig):
        """Start a single Redis node"""
        logger.info("Starting Redis node", node=node.node_id)
        
        config_file = self.config_generator.config_dir / f"redis-{node.node_id}.conf"
        
        cmd = [
            'redis-server',
            str(config_file)
        ]
        
        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid
            )
            
            self.processes[node.node_id] = process
            logger.info("Redis node started", node=node.node_id, pid=process.pid)
            
        except Exception as e:
            logger.error("Failed to start Redis node", node=node.node_id, error=str(e))
            raise
    
    def start_sentinels(self):
        """Start Redis Sentinel nodes"""
        logger.info("Starting Redis Sentinels")
        
        for sentinel in self.cluster_config.sentinel_nodes:
            self.start_sentinel(sentinel)
    
    def start_sentinel(self, sentinel: RedisNodeConfig):
        """Start a single Redis Sentinel"""
        logger.info("Starting Redis Sentinel", sentinel=sentinel.node_id)
        
        config_file = self.config_generator.config_dir / f"sentinel-{sentinel.node_id}.conf"
        
        cmd = [
            'redis-sentinel',
            str(config_file)
        ]
        
        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid
            )
            
            self.processes[f"sentinel-{sentinel.node_id}"] = process
            logger.info("Redis Sentinel started", sentinel=sentinel.node_id, pid=process.pid)
            
        except Exception as e:
            logger.error("Failed to start Redis Sentinel", sentinel=sentinel.node_id, error=str(e))
            raise
    
    def create_cluster(self):
        """Create Redis cluster"""
        logger.info("Creating Redis cluster")
        
        # Get master nodes
        master_nodes = [node for node in self.cluster_config.nodes if node.role == 'master']
        
        if len(master_nodes) < 3:
            raise ValueError("At least 3 master nodes required for cluster")
        
        # Build cluster create command
        node_addresses = [f"{node.host}:{node.port}" for node in master_nodes]
        
        # Add replica nodes
        replica_nodes = [node for node in self.cluster_config.nodes if node.role == 'slave']
        node_addresses.extend([f"{node.host}:{node.port}" for node in replica_nodes])
        
        cmd = [
            'redis-cli',
            '--cluster', 'create'
        ] + node_addresses + [
            '--cluster-replicas', str(self.cluster_config.replication_factor),
            '--cluster-yes'
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            
            if result.returncode == 0:
                logger.info("Redis cluster created successfully")
            else:
                logger.error("Failed to create Redis cluster", error=result.stderr)
                raise RuntimeError(f"Cluster creation failed: {result.stderr}")
                
        except subprocess.TimeoutExpired:
            logger.error("Cluster creation timed out")
            raise
        except Exception as e:
            logger.error("Cluster creation error", error=str(e))
            raise
    
    def initialize_clients(self):
        """Initialize Redis clients"""
        logger.info("Initializing Redis clients")
        
        try:
            # Initialize cluster client
            if self.cluster_config.nodes[0].cluster_enabled:
                startup_nodes = [
                    {"host": node.host, "port": node.port} 
                    for node in self.cluster_config.nodes 
                    if node.role == 'master'
                ]
                
                self.cluster_client = RedisCluster(
                    startup_nodes=startup_nodes,
                    decode_responses=True,
                    skip_full_coverage_check=not self.cluster_config.cluster_require_full_coverage,
                    password=self.cluster_config.auth_password
                )
            
            # Initialize sentinel client
            if self.cluster_config.sentinel_nodes:
                sentinel_addresses = [
                    (sentinel.host, sentinel.port) 
                    for sentinel in self.cluster_config.sentinel_nodes
                ]
                
                self.sentinel_client = redis.sentinel.Sentinel(
                    sentinel_addresses,
                    password=self.cluster_config.auth_password
                )
            
            logger.info("Redis clients initialized")
            
        except Exception as e:
            logger.error("Failed to initialize Redis clients", error=str(e))
            raise
    
    def get_cluster_info(self) -> Dict[str, Any]:
        """Get cluster information"""
        if not self.cluster_client:
            return {}
        
        try:
            cluster_info = self.cluster_client.cluster_info()
            cluster_nodes = self.cluster_client.cluster_nodes()
            
            return {
                'cluster_info': cluster_info,
                'cluster_nodes': cluster_nodes,
                'cluster_state': cluster_info.get('cluster_state', 'unknown'),
                'cluster_size': cluster_info.get('cluster_size', 0),
                'cluster_known_nodes': cluster_info.get('cluster_known_nodes', 0)
            }
            
        except Exception as e:
            logger.error("Failed to get cluster info", error=str(e))
            return {'error': str(e)}
    
    def get_node_status(self, node: RedisNodeConfig) -> NodeStatus:
        """Get status of a Redis node"""
        try:
            client = redis.Redis(
                host=node.host,
                port=node.port,
                password=self.cluster_config.auth_password,
                decode_responses=True
            )
            
            info = client.info()
            
            status = NodeStatus(
                node_id=node.node_id,
                host=node.host,
                port=node.port,
                role=info.get('role', 'unknown'),
                status='online' if client.ping() else 'offline',
                memory_usage=info.get('used_memory', 0),
                memory_peak=info.get('used_memory_peak', 0),
                connected_clients=info.get('connected_clients', 0),
                total_commands_processed=info.get('total_commands_processed', 0),
                keyspace_hits=info.get('keyspace_hits', 0),
                keyspace_misses=info.get('keyspace_misses', 0),
                hit_rate=info.get('keyspace_hits', 0) / max(info.get('keyspace_hits', 0) + info.get('keyspace_misses', 0), 1),
                replication_lag=info.get('master_repl_offset', 0) - info.get('slave_repl_offset', 0),
                last_save=datetime.fromtimestamp(info.get('rdb_last_save_time', 0)),
                uptime=info.get('uptime_in_seconds', 0),
                version=info.get('redis_version', 'unknown'),
                config_epoch=info.get('cluster_config_epoch', 0),
                cluster_state=info.get('cluster_state', 'unknown')
            )
            
            return status
            
        except Exception as e:
            logger.error("Failed to get node status", node=node.node_id, error=str(e))
            return NodeStatus(
                node_id=node.node_id,
                host=node.host,
                port=node.port,
                role='unknown',
                status='offline',
                memory_usage=0,
                memory_peak=0,
                connected_clients=0,
                total_commands_processed=0,
                keyspace_hits=0,
                keyspace_misses=0,
                hit_rate=0.0,
                replication_lag=0,
                last_save=datetime.now(),
                uptime=0,
                version='unknown',
                config_epoch=0,
                cluster_state='unknown'
            )
    
    def monitor_cluster(self):
        """Monitor cluster health and metrics"""
        logger.info("Starting cluster monitoring")
        
        while self.running:
            try:
                # Monitor each node
                for node in self.cluster_config.nodes:
                    status = self.get_node_status(node)
                    
                    # Update Prometheus metrics
                    REDIS_MEMORY_USAGE.labels(node=node.node_id, type='used').set(status.memory_usage)
                    REDIS_MEMORY_USAGE.labels(node=node.node_id, type='peak').set(status.memory_peak)
                    REDIS_CONNECTIONS.labels(node=node.node_id, type='clients').set(status.connected_clients)
                    REDIS_KEYSPACE_HITS.labels(node=node.node_id)._value._value = status.keyspace_hits
                    REDIS_KEYSPACE_MISSES.labels(node=node.node_id)._value._value = status.keyspace_misses
                
                # Monitor cluster state
                cluster_info = self.get_cluster_info()
                if 'cluster_state' in cluster_info:
                    cluster_state_value = 1 if cluster_info['cluster_state'] == 'ok' else 0
                    REDIS_CLUSTER_STATE.labels(cluster=self.cluster_config.cluster_name).set(cluster_state_value)
                
                time.sleep(30)  # Monitor every 30 seconds
                
            except Exception as e:
                logger.error("Monitoring error", error=str(e))
                time.sleep(60)  # Wait longer on error
    
    def start_monitoring(self):
        """Start monitoring thread"""
        self.running = True
        self.monitoring_thread = threading.Thread(target=self.monitor_cluster)
        self.monitoring_thread.daemon = True
        self.monitoring_thread.start()
        logger.info("Cluster monitoring started")
    
    def stop_monitoring(self):
        """Stop monitoring thread"""
        self.running = False
        if self.monitoring_thread:
            self.monitoring_thread.join(timeout=10)
        logger.info("Cluster monitoring stopped")
    
    def shutdown_cluster(self):
        """Shutdown the entire cluster"""
        logger.info("Shutting down Redis cluster")
        
        # Stop monitoring
        self.stop_monitoring()
        
        # Shutdown all processes
        for process_name, process in self.processes.items():
            try:
                logger.info("Stopping process", process=process_name, pid=process.pid)
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                logger.warning("Process did not stop gracefully, killing", process=process_name)
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except Exception as e:
                logger.error("Error stopping process", process=process_name, error=str(e))
        
        self.processes.clear()
        logger.info("Redis cluster shutdown completed")

class BankingCacheManager:
    """Banking-specific cache management"""
    
    def __init__(self, cluster_manager: RedisClusterManager):
        self.cluster_manager = cluster_manager
        self.client = cluster_manager.cluster_client
        
    def cache_user_session(self, user_id: str, session_data: Dict[str, Any], ttl: int = 3600):
        """Cache user session data"""
        key = f"session:{user_id}"
        self.client.setex(key, ttl, json.dumps(session_data))
        logger.info("User session cached", user_id=user_id, ttl=ttl)
    
    def get_user_session(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user session data"""
        key = f"session:{user_id}"
        data = self.client.get(key)
        if data:
            return json.loads(data)
        return None
    
    def cache_transaction_data(self, transaction_id: str, transaction_data: Dict[str, Any], ttl: int = 86400):
        """Cache transaction data"""
        key = f"transaction:{transaction_id}"
        self.client.setex(key, ttl, json.dumps(transaction_data))
        logger.info("Transaction cached", transaction_id=transaction_id, ttl=ttl)
    
    def get_transaction_data(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        """Get transaction data"""
        key = f"transaction:{transaction_id}"
        data = self.client.get(key)
        if data:
            return json.loads(data)
        return None
    
    def cache_fraud_score(self, user_id: str, score: float, ttl: int = 1800):
        """Cache fraud score"""
        key = f"fraud_score:{user_id}"
        self.client.setex(key, ttl, score)
        logger.info("Fraud score cached", user_id=user_id, score=score, ttl=ttl)
    
    def get_fraud_score(self, user_id: str) -> Optional[float]:
        """Get cached fraud score"""
        key = f"fraud_score:{user_id}"
        score = self.client.get(key)
        if score:
            return float(score)
        return None
    
    def cache_account_balance(self, account_id: str, balance: float, ttl: int = 300):
        """Cache account balance"""
        key = f"balance:{account_id}"
        self.client.setex(key, ttl, balance)
        logger.info("Account balance cached", account_id=account_id, balance=balance, ttl=ttl)
    
    def get_account_balance(self, account_id: str) -> Optional[float]:
        """Get cached account balance"""
        key = f"balance:{account_id}"
        balance = self.client.get(key)
        if balance:
            return float(balance)
        return None
    
    def increment_transaction_counter(self, user_id: str, window: int = 3600) -> int:
        """Increment transaction counter for rate limiting"""
        key = f"tx_count:{user_id}"
        pipe = self.client.pipeline()
        pipe.incr(key)
        pipe.expire(key, window)
        results = pipe.execute()
        count = results[0]
        logger.info("Transaction counter incremented", user_id=user_id, count=count)
        return count
    
    def get_transaction_count(self, user_id: str) -> int:
        """Get transaction count"""
        key = f"tx_count:{user_id}"
        count = self.client.get(key)
        return int(count) if count else 0

def create_default_cluster_config() -> ClusterConfig:
    """Create default cluster configuration"""
    base_dir = "/home/ubuntu/remittance-network/infrastructure/redis-cluster"
    
    # Master nodes
    master_nodes = []
    for i in range(3):
        port = 7000 + i
        node = RedisNodeConfig(
            node_id=f"master-{i}",
            host="127.0.0.1",
            port=port,
            role="master",
            cluster_enabled=True,
            max_memory="1gb",
            max_memory_policy="allkeys-lru",
            save_config=["900 1", "300 10", "60 10000"],
            appendonly=True,
            appendfsync="everysec",
            data_dir=f"{base_dir}/data/master-{i}",
            log_file=f"{base_dir}/logs/master-{i}.log",
            pid_file=f"{base_dir}/master-{i}.pid",
            config_file=f"{base_dir}/config/redis-master-{i}.conf"
        )
        master_nodes.append(node)
    
    # Replica nodes
    replica_nodes = []
    for i in range(3):
        port = 7003 + i
        node = RedisNodeConfig(
            node_id=f"replica-{i}",
            host="127.0.0.1",
            port=port,
            role="slave",
            cluster_enabled=True,
            max_memory="1gb",
            max_memory_policy="allkeys-lru",
            save_config=["900 1", "300 10", "60 10000"],
            appendonly=True,
            appendfsync="everysec",
            data_dir=f"{base_dir}/data/replica-{i}",
            log_file=f"{base_dir}/logs/replica-{i}.log",
            pid_file=f"{base_dir}/replica-{i}.pid",
            config_file=f"{base_dir}/config/redis-replica-{i}.conf"
        )
        replica_nodes.append(node)
    
    # Sentinel nodes
    sentinel_nodes = []
    for i in range(3):
        port = 26379 + i
        node = RedisNodeConfig(
            node_id=f"sentinel-{i}",
            host="127.0.0.1",
            port=port,
            role="sentinel",
            cluster_enabled=False,
            max_memory="256mb",
            max_memory_policy="noeviction",
            save_config=[],
            appendonly=False,
            appendfsync="no",
            data_dir=f"{base_dir}/data/sentinel-{i}",
            log_file=f"{base_dir}/logs/sentinel-{i}.log",
            pid_file=f"{base_dir}/sentinel-{i}.pid",
            config_file=f"{base_dir}/config/sentinel-{i}.conf"
        )
        sentinel_nodes.append(node)
    
    return ClusterConfig(
        cluster_name="remittance-cluster",
        nodes=master_nodes + replica_nodes,
        sentinel_nodes=sentinel_nodes,
        cluster_require_full_coverage=True,
        cluster_node_timeout=15000,
        cluster_migration_barrier=1,
        cluster_replica_validity_factor=10,
        replication_factor=1,
        auth_password=None,
        tls_enabled=False,
        backup_schedule="0 2 * * *",  # Daily at 2 AM
        monitoring_enabled=True
    )

# Flask Application for Management API
app = Flask(__name__)
CORS(app)

# Global cluster manager
cluster_manager = None
cache_manager = None

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Redis Cluster Manager',
        'version': '2.0.0',
        'cluster_running': cluster_manager is not None,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/cluster/info', methods=['GET'])
def get_cluster_info():
    """Get cluster information"""
    if not cluster_manager:
        return jsonify({'error': 'Cluster not initialized'}), 500
    
    try:
        cluster_info = cluster_manager.get_cluster_info()
        return jsonify({
            'success': True,
            'cluster_info': cluster_info
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/cluster/nodes', methods=['GET'])
def get_node_status():
    """Get status of all nodes"""
    if not cluster_manager:
        return jsonify({'error': 'Cluster not initialized'}), 500
    
    try:
        node_statuses = []
        for node in cluster_manager.cluster_config.nodes:
            status = cluster_manager.get_node_status(node)
            node_statuses.append(asdict(status))
        
        return jsonify({
            'success': True,
            'nodes': node_statuses
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/cache/set', methods=['POST'])
def cache_set():
    """Set cache value"""
    if not cache_manager:
        return jsonify({'error': 'Cache manager not initialized'}), 500
    
    try:
        data = request.json
        key = data.get('key')
        value = data.get('value')
        ttl = data.get('ttl', 3600)
        
        if not key or value is None:
            return jsonify({'error': 'Key and value required'}), 400
        
        cache_manager.client.setex(key, ttl, json.dumps(value))
        
        return jsonify({
            'success': True,
            'message': f'Key {key} set with TTL {ttl}'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/cache/get/<key>', methods=['GET'])
def cache_get(key):
    """Get cache value"""
    if not cache_manager:
        return jsonify({'error': 'Cache manager not initialized'}), 500
    
    try:
        value = cache_manager.client.get(key)
        
        if value:
            return jsonify({
                'success': True,
                'key': key,
                'value': json.loads(value)
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Key not found'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/metrics', methods=['GET'])
def metrics():
    """Prometheus metrics endpoint"""
    return generate_latest()

def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info("Received shutdown signal", signal=signum)
    if cluster_manager:
        cluster_manager.shutdown_cluster()
    sys.exit(0)

def main():
    """Main function"""
    global cluster_manager, cache_manager
    
    # Set up signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    logger.info("Starting Redis Cluster Manager")
    
    try:
        # Create cluster configuration
        cluster_config = create_default_cluster_config()
        
        # Initialize cluster manager
        cluster_manager = RedisClusterManager(cluster_config)
        
        # Setup cluster
        cluster_manager.setup_cluster()
        
        # Initialize cache manager
        cache_manager = BankingCacheManager(cluster_manager)
        
        # Start monitoring
        cluster_manager.start_monitoring()
        
        # Start Prometheus metrics server
        start_http_server(9090)
        
        logger.info("Redis cluster is ready")
        
        # Start Flask API
        app.run(
            host='0.0.0.0',
            port=int(os.getenv('PORT', 5007)),
            debug=os.getenv('DEBUG', 'False').lower() == 'true',
            threaded=True
        )
        
    except Exception as e:
        logger.error("Failed to start Redis cluster", error=str(e))
        if cluster_manager:
            cluster_manager.shutdown_cluster()
        sys.exit(1)

if __name__ == '__main__':
    main()

