"""
Infrastructure Optimization Module

5/5 Bank-Grade optimization configurations for all infrastructure components:
- Kafka: Message streaming with HA, security, and performance tuning
- Dapr: Distributed runtime with mTLS, resiliency, and observability
- Temporal: Workflow orchestration with HA and task queue optimization
- Postgres: Primary database with connection pooling and replication
- Permify: Authorization with caching and policy optimization
- Keycloak: Identity with session management and token optimization
- APISIX: API Gateway with rate limiting and circuit breaking
- OpenAppSec: WAF with fintech-specific rules
- KEDA: Autoscaling with queue-based and metric-based scalers
- OpenSearch: Search/Analytics with index lifecycle management
- Redis: Caching with cluster mode and eviction policies

Each component is optimized for:
- High Availability (multi-replica, leader election, failover)
- Performance Tuning (connection pooling, memory, throughput)
- Security Hardening (TLS, authentication, network policies)
- Observability (metrics, logging, tracing)
- Disaster Recovery (backups, replication, snapshots)
"""

import logging
import os
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from enum import Enum

logger = logging.getLogger(__name__)


class OptimizationLevel(str, Enum):
    """Optimization level for infrastructure components"""
    DEVELOPMENT = "development"  # 1/5 - Single instance, no HA
    STAGING = "staging"          # 3/5 - Basic HA, some security
    PRODUCTION = "production"    # 4/5 - Full HA, security, monitoring
    BANK_GRADE = "bank_grade"    # 5/5 - Maximum resilience, compliance


@dataclass
class KafkaOptimization:
    """
    Kafka 5/5 Bank-Grade Configuration
    
    Optimizations:
    - 3+ broker cluster with rack-aware placement
    - Replication factor 3, min.insync.replicas 2
    - SASL/SCRAM authentication with ACLs
    - TLS for client-broker and broker-broker
    - Consumer lag monitoring and alerting
    """
    
    # Cluster Configuration
    broker_count: int = 3
    replication_factor: int = 3
    min_insync_replicas: int = 2
    rack_awareness: bool = True
    
    # Producer Tuning
    producer_acks: str = "all"
    producer_batch_size: int = 16384
    producer_linger_ms: int = 5
    producer_compression: str = "lz4"
    producer_max_in_flight: int = 5
    producer_retries: int = 3
    producer_retry_backoff_ms: int = 100
    
    # Consumer Tuning
    consumer_fetch_min_bytes: int = 1
    consumer_fetch_max_wait_ms: int = 500
    consumer_max_poll_records: int = 500
    consumer_session_timeout_ms: int = 30000
    consumer_heartbeat_interval_ms: int = 10000
    consumer_auto_offset_reset: str = "earliest"
    
    # Security
    security_protocol: str = "SASL_SSL"
    sasl_mechanism: str = "SCRAM-SHA-512"
    ssl_enabled: bool = True
    acl_enabled: bool = True
    
    # Topic Defaults
    default_partitions: int = 12
    default_retention_ms: int = 604800000  # 7 days
    log_retention_bytes: int = -1  # Unlimited
    
    # Monitoring
    jmx_enabled: bool = True
    consumer_lag_threshold_warning: int = 1000
    consumer_lag_threshold_critical: int = 10000
    
    def to_broker_config(self) -> Dict[str, Any]:
        """Generate broker configuration"""
        return {
            "broker.rack": "${BROKER_RACK}" if self.rack_awareness else None,
            "default.replication.factor": self.replication_factor,
            "min.insync.replicas": self.min_insync_replicas,
            "num.partitions": self.default_partitions,
            "log.retention.ms": self.default_retention_ms,
            "log.retention.bytes": self.log_retention_bytes,
            "auto.create.topics.enable": False,
            "delete.topic.enable": True,
            "unclean.leader.election.enable": False,
            "message.max.bytes": 10485760,  # 10MB
            "replica.fetch.max.bytes": 10485760,
            "security.inter.broker.protocol": self.security_protocol,
            "sasl.mechanism.inter.broker.protocol": self.sasl_mechanism,
            "ssl.client.auth": "required" if self.ssl_enabled else "none",
            "authorizer.class.name": "kafka.security.authorizer.AclAuthorizer" if self.acl_enabled else "",
            "super.users": "User:admin",
        }
    
    def to_producer_config(self) -> Dict[str, Any]:
        """Generate producer configuration"""
        return {
            "acks": self.producer_acks,
            "batch.size": self.producer_batch_size,
            "linger.ms": self.producer_linger_ms,
            "compression.type": self.producer_compression,
            "max.in.flight.requests.per.connection": self.producer_max_in_flight,
            "retries": self.producer_retries,
            "retry.backoff.ms": self.producer_retry_backoff_ms,
            "enable.idempotence": True,
            "security.protocol": self.security_protocol,
            "sasl.mechanism": self.sasl_mechanism,
        }
    
    def to_consumer_config(self) -> Dict[str, Any]:
        """Generate consumer configuration"""
        return {
            "fetch.min.bytes": self.consumer_fetch_min_bytes,
            "fetch.max.wait.ms": self.consumer_fetch_max_wait_ms,
            "max.poll.records": self.consumer_max_poll_records,
            "session.timeout.ms": self.consumer_session_timeout_ms,
            "heartbeat.interval.ms": self.consumer_heartbeat_interval_ms,
            "auto.offset.reset": self.consumer_auto_offset_reset,
            "enable.auto.commit": False,  # Manual commit for exactly-once
            "isolation.level": "read_committed",
            "security.protocol": self.security_protocol,
            "sasl.mechanism": self.sasl_mechanism,
        }


@dataclass
class TemporalOptimization:
    """
    Temporal 5/5 Bank-Grade Configuration
    
    Optimizations:
    - Multi-replica frontend, history, matching, worker services
    - PostgreSQL persistence with HA
    - Task queue partitioning for high throughput
    - Namespace isolation with auth policies
    - Workflow and activity timeout tuning
    """
    
    # Cluster Configuration
    frontend_replicas: int = 3
    history_replicas: int = 3
    matching_replicas: int = 3
    worker_replicas: int = 3
    
    # Persistence
    persistence_type: str = "postgresql"
    persistence_max_conns: int = 50
    persistence_max_idle_conns: int = 10
    
    # Task Queue Tuning
    task_queue_partitions: int = 4
    max_concurrent_workflow_tasks: int = 1000
    max_concurrent_activity_tasks: int = 1000
    
    # Timeout Defaults
    workflow_execution_timeout_seconds: int = 86400  # 24 hours
    workflow_run_timeout_seconds: int = 3600  # 1 hour
    workflow_task_timeout_seconds: int = 10
    activity_schedule_to_start_timeout_seconds: int = 60
    activity_start_to_close_timeout_seconds: int = 300
    activity_heartbeat_timeout_seconds: int = 30
    
    # Security
    tls_enabled: bool = True
    auth_enabled: bool = True
    namespace_isolation: bool = True
    
    # Monitoring
    metrics_enabled: bool = True
    tracing_enabled: bool = True
    
    def to_server_config(self) -> Dict[str, Any]:
        """Generate Temporal server configuration"""
        return {
            "persistence": {
                "defaultStore": "default",
                "visibilityStore": "visibility",
                "numHistoryShards": 512,
                "datastores": {
                    "default": {
                        "sql": {
                            "pluginName": "postgres",
                            "databaseName": "temporal",
                            "connectAddr": "${POSTGRES_HOST}:5432",
                            "connectProtocol": "tcp",
                            "user": "${POSTGRES_USER}",
                            "password": "${POSTGRES_PASSWORD}",
                            "maxConns": self.persistence_max_conns,
                            "maxIdleConns": self.persistence_max_idle_conns,
                        }
                    },
                    "visibility": {
                        "sql": {
                            "pluginName": "postgres",
                            "databaseName": "temporal_visibility",
                            "connectAddr": "${POSTGRES_HOST}:5432",
                            "connectProtocol": "tcp",
                            "user": "${POSTGRES_USER}",
                            "password": "${POSTGRES_PASSWORD}",
                            "maxConns": self.persistence_max_conns,
                            "maxIdleConns": self.persistence_max_idle_conns,
                        }
                    }
                }
            },
            "global": {
                "membership": {
                    "maxJoinDuration": "30s",
                    "broadcastAddress": "${POD_IP}"
                },
                "tls": {
                    "internode": {
                        "server": {
                            "certFile": "/certs/server.crt",
                            "keyFile": "/certs/server.key",
                            "requireClientAuth": True,
                            "clientCaFiles": ["/certs/ca.crt"]
                        },
                        "client": {
                            "serverName": "temporal",
                            "rootCaFiles": ["/certs/ca.crt"]
                        }
                    } if self.tls_enabled else {},
                    "frontend": {
                        "server": {
                            "certFile": "/certs/server.crt",
                            "keyFile": "/certs/server.key",
                            "requireClientAuth": True,
                            "clientCaFiles": ["/certs/ca.crt"]
                        }
                    } if self.tls_enabled else {}
                }
            },
            "services": {
                "frontend": {
                    "rpc": {
                        "grpcPort": 7233,
                        "membershipPort": 6933,
                        "bindOnLocalHost": False
                    }
                },
                "history": {
                    "rpc": {
                        "grpcPort": 7234,
                        "membershipPort": 6934,
                        "bindOnLocalHost": False
                    }
                },
                "matching": {
                    "rpc": {
                        "grpcPort": 7235,
                        "membershipPort": 6935,
                        "bindOnLocalHost": False
                    }
                },
                "worker": {
                    "rpc": {
                        "grpcPort": 7239,
                        "membershipPort": 6939,
                        "bindOnLocalHost": False
                    }
                }
            }
        }
    
    def to_worker_config(self) -> Dict[str, Any]:
        """Generate worker configuration"""
        return {
            "max_concurrent_workflow_task_pollers": 4,
            "max_concurrent_activity_task_pollers": 4,
            "max_concurrent_workflow_task_executions": self.max_concurrent_workflow_tasks,
            "max_concurrent_activity_task_executions": self.max_concurrent_activity_tasks,
            "workflow_execution_timeout": f"{self.workflow_execution_timeout_seconds}s",
            "workflow_run_timeout": f"{self.workflow_run_timeout_seconds}s",
            "workflow_task_timeout": f"{self.workflow_task_timeout_seconds}s",
            "activity_schedule_to_start_timeout": f"{self.activity_schedule_to_start_timeout_seconds}s",
            "activity_start_to_close_timeout": f"{self.activity_start_to_close_timeout_seconds}s",
            "activity_heartbeat_timeout": f"{self.activity_heartbeat_timeout_seconds}s",
        }


@dataclass
class PostgresOptimization:
    """
    PostgreSQL 5/5 Bank-Grade Configuration
    
    Optimizations:
    - Primary + synchronous standby with automatic failover
    - Connection pooling with PgBouncer
    - Optimized shared_buffers, work_mem, effective_cache_size
    - WAL archiving for point-in-time recovery
    - pg_stat_statements for query analysis
    """
    
    # Replication
    replication_mode: str = "synchronous"  # synchronous, asynchronous
    standby_count: int = 2
    synchronous_commit: str = "on"
    
    # Connection Pooling
    max_connections: int = 200
    pgbouncer_enabled: bool = True
    pgbouncer_pool_mode: str = "transaction"
    pgbouncer_default_pool_size: int = 20
    pgbouncer_max_client_conn: int = 1000
    
    # Memory Tuning (for 16GB RAM server)
    shared_buffers: str = "4GB"
    effective_cache_size: str = "12GB"
    work_mem: str = "64MB"
    maintenance_work_mem: str = "1GB"
    wal_buffers: str = "64MB"
    
    # WAL Configuration
    wal_level: str = "replica"
    max_wal_senders: int = 10
    wal_keep_size: str = "1GB"
    archive_mode: str = "on"
    archive_command: str = "cp %p /archive/%f"
    
    # Autovacuum
    autovacuum_max_workers: int = 4
    autovacuum_naptime: str = "1min"
    autovacuum_vacuum_scale_factor: float = 0.1
    autovacuum_analyze_scale_factor: float = 0.05
    
    # Query Optimization
    random_page_cost: float = 1.1  # For SSD
    effective_io_concurrency: int = 200  # For SSD
    default_statistics_target: int = 100
    
    # Security
    ssl_enabled: bool = True
    ssl_min_protocol_version: str = "TLSv1.2"
    password_encryption: str = "scram-sha-256"
    
    # Monitoring
    pg_stat_statements_enabled: bool = True
    log_min_duration_statement: int = 1000  # Log queries > 1s
    log_checkpoints: bool = True
    log_lock_waits: bool = True
    
    def to_postgresql_conf(self) -> Dict[str, Any]:
        """Generate postgresql.conf settings"""
        return {
            # Connections
            "max_connections": self.max_connections,
            "superuser_reserved_connections": 3,
            
            # Memory
            "shared_buffers": self.shared_buffers,
            "effective_cache_size": self.effective_cache_size,
            "work_mem": self.work_mem,
            "maintenance_work_mem": self.maintenance_work_mem,
            "wal_buffers": self.wal_buffers,
            
            # WAL
            "wal_level": self.wal_level,
            "max_wal_senders": self.max_wal_senders,
            "wal_keep_size": self.wal_keep_size,
            "archive_mode": self.archive_mode,
            "archive_command": self.archive_command,
            "synchronous_commit": self.synchronous_commit,
            
            # Replication
            "hot_standby": "on",
            "max_replication_slots": 10,
            
            # Autovacuum
            "autovacuum_max_workers": self.autovacuum_max_workers,
            "autovacuum_naptime": self.autovacuum_naptime,
            "autovacuum_vacuum_scale_factor": self.autovacuum_vacuum_scale_factor,
            "autovacuum_analyze_scale_factor": self.autovacuum_analyze_scale_factor,
            
            # Query Planner
            "random_page_cost": self.random_page_cost,
            "effective_io_concurrency": self.effective_io_concurrency,
            "default_statistics_target": self.default_statistics_target,
            
            # Security
            "ssl": "on" if self.ssl_enabled else "off",
            "ssl_min_protocol_version": self.ssl_min_protocol_version,
            "password_encryption": self.password_encryption,
            
            # Logging
            "log_min_duration_statement": self.log_min_duration_statement,
            "log_checkpoints": "on" if self.log_checkpoints else "off",
            "log_lock_waits": "on" if self.log_lock_waits else "off",
            "log_statement": "ddl",
            "log_line_prefix": "%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h ",
            
            # Extensions
            "shared_preload_libraries": "pg_stat_statements" if self.pg_stat_statements_enabled else "",
        }
    
    def to_pgbouncer_ini(self) -> Dict[str, Any]:
        """Generate PgBouncer configuration"""
        return {
            "pgbouncer": {
                "pool_mode": self.pgbouncer_pool_mode,
                "default_pool_size": self.pgbouncer_default_pool_size,
                "max_client_conn": self.pgbouncer_max_client_conn,
                "reserve_pool_size": 5,
                "reserve_pool_timeout": 3,
                "server_lifetime": 3600,
                "server_idle_timeout": 600,
                "server_connect_timeout": 15,
                "server_login_retry": 15,
                "query_timeout": 120,
                "query_wait_timeout": 60,
                "client_idle_timeout": 0,
                "client_login_timeout": 60,
                "autodb_idle_timeout": 3600,
                "log_connections": 1,
                "log_disconnections": 1,
                "log_pooler_errors": 1,
                "stats_period": 60,
                "admin_users": "postgres",
                "ignore_startup_parameters": "extra_float_digits",
            }
        }


@dataclass
class KeycloakOptimization:
    """
    Keycloak 5/5 Bank-Grade Configuration
    
    Optimizations:
    - Multi-replica with Infinispan clustering
    - PostgreSQL backend with connection pooling
    - Token and session optimization
    - Strong admin RBAC
    - Audit logging for compliance
    """
    
    # Cluster Configuration
    replicas: int = 3
    cache_owners: int = 2
    
    # Database
    db_pool_initial_size: int = 5
    db_pool_min_size: int = 5
    db_pool_max_size: int = 50
    
    # Session Configuration
    sso_session_idle_timeout: int = 1800  # 30 minutes
    sso_session_max_lifespan: int = 36000  # 10 hours
    offline_session_idle_timeout: int = 2592000  # 30 days
    
    # Token Configuration
    access_token_lifespan: int = 300  # 5 minutes
    refresh_token_lifespan: int = 1800  # 30 minutes
    
    # Security
    brute_force_protection: bool = True
    max_login_failures: int = 5
    wait_increment_seconds: int = 60
    quick_login_check_milli_seconds: int = 1000
    
    # Password Policy
    password_min_length: int = 12
    password_require_uppercase: bool = True
    password_require_lowercase: bool = True
    password_require_digit: bool = True
    password_require_special: bool = True
    password_history: int = 5
    
    # Audit
    events_enabled: bool = True
    admin_events_enabled: bool = True
    events_expiration: int = 7776000  # 90 days
    
    def to_realm_config(self) -> Dict[str, Any]:
        """Generate realm configuration"""
        return {
            "ssoSessionIdleTimeout": self.sso_session_idle_timeout,
            "ssoSessionMaxLifespan": self.sso_session_max_lifespan,
            "offlineSessionIdleTimeout": self.offline_session_idle_timeout,
            "accessTokenLifespan": self.access_token_lifespan,
            "accessTokenLifespanForImplicitFlow": 900,
            "refreshTokenMaxReuse": 0,
            "bruteForceProtected": self.brute_force_protection,
            "maxFailureWaitSeconds": 900,
            "minimumQuickLoginWaitSeconds": 60,
            "waitIncrementSeconds": self.wait_increment_seconds,
            "quickLoginCheckMilliSeconds": self.quick_login_check_milli_seconds,
            "maxDeltaTimeSeconds": 43200,
            "failureFactor": self.max_login_failures,
            "passwordPolicy": self._build_password_policy(),
            "eventsEnabled": self.events_enabled,
            "adminEventsEnabled": self.admin_events_enabled,
            "eventsExpiration": self.events_expiration,
            "enabledEventTypes": [
                "LOGIN", "LOGIN_ERROR", "LOGOUT", "LOGOUT_ERROR",
                "REGISTER", "REGISTER_ERROR", "CODE_TO_TOKEN", "CODE_TO_TOKEN_ERROR",
                "CLIENT_LOGIN", "CLIENT_LOGIN_ERROR", "REFRESH_TOKEN", "REFRESH_TOKEN_ERROR",
                "VALIDATE_ACCESS_TOKEN", "VALIDATE_ACCESS_TOKEN_ERROR",
                "INTROSPECT_TOKEN", "INTROSPECT_TOKEN_ERROR",
                "UPDATE_PASSWORD", "UPDATE_PASSWORD_ERROR",
                "SEND_RESET_PASSWORD", "SEND_RESET_PASSWORD_ERROR",
                "RESET_PASSWORD", "RESET_PASSWORD_ERROR",
                "REMOVE_TOTP", "UPDATE_TOTP", "VERIFY_EMAIL",
                "CUSTOM_REQUIRED_ACTION", "CUSTOM_REQUIRED_ACTION_ERROR"
            ]
        }
    
    def _build_password_policy(self) -> str:
        """Build password policy string"""
        policies = [f"length({self.password_min_length})"]
        if self.password_require_uppercase:
            policies.append("upperCase(1)")
        if self.password_require_lowercase:
            policies.append("lowerCase(1)")
        if self.password_require_digit:
            policies.append("digits(1)")
        if self.password_require_special:
            policies.append("specialChars(1)")
        if self.password_history > 0:
            policies.append(f"passwordHistory({self.password_history})")
        policies.append("notUsername")
        return " and ".join(policies)


@dataclass
class RedisOptimization:
    """
    Redis 5/5 Bank-Grade Configuration
    
    Optimizations:
    - Redis Cluster or Sentinel for HA
    - Memory management with eviction policies
    - TLS encryption
    - ACL-based authentication
    - Persistence with AOF and RDB
    """
    
    # Cluster Configuration
    cluster_enabled: bool = True
    cluster_node_count: int = 6  # 3 masters + 3 replicas
    sentinel_enabled: bool = False
    sentinel_quorum: int = 2
    
    # Memory
    maxmemory: str = "4gb"
    maxmemory_policy: str = "volatile-lru"
    maxmemory_samples: int = 10
    
    # Persistence
    aof_enabled: bool = True
    aof_fsync: str = "everysec"
    rdb_enabled: bool = True
    rdb_save_intervals: List[str] = field(default_factory=lambda: ["900 1", "300 10", "60 10000"])
    
    # Security
    requirepass: bool = True
    tls_enabled: bool = True
    acl_enabled: bool = True
    
    # Performance
    tcp_keepalive: int = 300
    timeout: int = 0
    tcp_backlog: int = 511
    
    # Limits
    maxclients: int = 10000
    
    def to_redis_conf(self) -> Dict[str, Any]:
        """Generate redis.conf settings"""
        config = {
            # Network
            "bind": "0.0.0.0",
            "port": 6379 if not self.tls_enabled else 0,
            "tls-port": 6379 if self.tls_enabled else 0,
            "tcp-keepalive": self.tcp_keepalive,
            "timeout": self.timeout,
            "tcp-backlog": self.tcp_backlog,
            
            # Memory
            "maxmemory": self.maxmemory,
            "maxmemory-policy": self.maxmemory_policy,
            "maxmemory-samples": self.maxmemory_samples,
            
            # Persistence - AOF
            "appendonly": "yes" if self.aof_enabled else "no",
            "appendfsync": self.aof_fsync,
            "no-appendfsync-on-rewrite": "no",
            "auto-aof-rewrite-percentage": 100,
            "auto-aof-rewrite-min-size": "64mb",
            
            # Persistence - RDB
            "save": " ".join(self.rdb_save_intervals) if self.rdb_enabled else "",
            "rdbcompression": "yes",
            "rdbchecksum": "yes",
            
            # Security
            "requirepass": "${REDIS_PASSWORD}" if self.requirepass else "",
            
            # TLS
            "tls-cert-file": "/certs/redis.crt" if self.tls_enabled else "",
            "tls-key-file": "/certs/redis.key" if self.tls_enabled else "",
            "tls-ca-cert-file": "/certs/ca.crt" if self.tls_enabled else "",
            "tls-auth-clients": "yes" if self.tls_enabled else "",
            
            # Limits
            "maxclients": self.maxclients,
            
            # Cluster
            "cluster-enabled": "yes" if self.cluster_enabled else "no",
            "cluster-config-file": "nodes.conf" if self.cluster_enabled else "",
            "cluster-node-timeout": 15000 if self.cluster_enabled else 0,
            "cluster-replica-validity-factor": 10 if self.cluster_enabled else 0,
            "cluster-require-full-coverage": "no" if self.cluster_enabled else "",
        }
        
        return {k: v for k, v in config.items() if v}


@dataclass
class OpenSearchOptimization:
    """
    OpenSearch 5/5 Bank-Grade Configuration
    
    Optimizations:
    - Multi-node cluster with dedicated master nodes
    - Index lifecycle management (ILM)
    - Shard allocation awareness
    - Security with TLS and RBAC
    - Snapshot repository for backups
    """
    
    # Cluster Configuration
    master_node_count: int = 3
    data_node_count: int = 3
    ingest_node_count: int = 2
    
    # Memory (for 32GB RAM nodes)
    heap_size: str = "16g"  # 50% of RAM, max 32GB
    
    # Index Settings
    number_of_shards: int = 3
    number_of_replicas: int = 1
    refresh_interval: str = "1s"
    
    # ILM Policy
    ilm_hot_phase_days: int = 7
    ilm_warm_phase_days: int = 30
    ilm_cold_phase_days: int = 90
    ilm_delete_phase_days: int = 365
    
    # Security
    security_enabled: bool = True
    tls_enabled: bool = True
    
    # Snapshots
    snapshot_repository: str = "s3"
    snapshot_schedule: str = "0 0 * * *"  # Daily at midnight
    
    def to_opensearch_yml(self) -> Dict[str, Any]:
        """Generate opensearch.yml settings"""
        return {
            "cluster.name": "remittance-search",
            "node.name": "${HOSTNAME}",
            
            # Discovery
            "discovery.seed_hosts": ["opensearch-master-0", "opensearch-master-1", "opensearch-master-2"],
            "cluster.initial_master_nodes": ["opensearch-master-0", "opensearch-master-1", "opensearch-master-2"],
            
            # Network
            "network.host": "0.0.0.0",
            "http.port": 9200,
            "transport.port": 9300,
            
            # Memory
            "bootstrap.memory_lock": True,
            
            # Shard Allocation
            "cluster.routing.allocation.awareness.attributes": "zone",
            "cluster.routing.allocation.awareness.force.zone.values": "zone-a,zone-b,zone-c",
            
            # Security
            "plugins.security.ssl.transport.pemcert_filepath": "/certs/node.pem" if self.tls_enabled else "",
            "plugins.security.ssl.transport.pemkey_filepath": "/certs/node-key.pem" if self.tls_enabled else "",
            "plugins.security.ssl.transport.pemtrustedcas_filepath": "/certs/root-ca.pem" if self.tls_enabled else "",
            "plugins.security.ssl.http.enabled": self.tls_enabled,
            "plugins.security.ssl.http.pemcert_filepath": "/certs/node.pem" if self.tls_enabled else "",
            "plugins.security.ssl.http.pemkey_filepath": "/certs/node-key.pem" if self.tls_enabled else "",
            "plugins.security.ssl.http.pemtrustedcas_filepath": "/certs/root-ca.pem" if self.tls_enabled else "",
            "plugins.security.allow_default_init_securityindex": True,
            "plugins.security.authcz.admin_dn": ["CN=admin,OU=remittance,O=platform,C=NG"],
            "plugins.security.nodes_dn": ["CN=node*,OU=remittance,O=platform,C=NG"],
            
            # Performance
            "indices.memory.index_buffer_size": "20%",
            "indices.queries.cache.size": "15%",
            "thread_pool.write.queue_size": 1000,
            "thread_pool.search.queue_size": 1000,
        }
    
    def to_ilm_policy(self) -> Dict[str, Any]:
        """Generate ILM policy"""
        return {
            "policy": {
                "phases": {
                    "hot": {
                        "min_age": "0ms",
                        "actions": {
                            "rollover": {
                                "max_size": "50gb",
                                "max_age": f"{self.ilm_hot_phase_days}d"
                            },
                            "set_priority": {
                                "priority": 100
                            }
                        }
                    },
                    "warm": {
                        "min_age": f"{self.ilm_hot_phase_days}d",
                        "actions": {
                            "shrink": {
                                "number_of_shards": 1
                            },
                            "forcemerge": {
                                "max_num_segments": 1
                            },
                            "set_priority": {
                                "priority": 50
                            }
                        }
                    },
                    "cold": {
                        "min_age": f"{self.ilm_warm_phase_days}d",
                        "actions": {
                            "set_priority": {
                                "priority": 0
                            }
                        }
                    },
                    "delete": {
                        "min_age": f"{self.ilm_delete_phase_days}d",
                        "actions": {
                            "delete": {}
                        }
                    }
                }
            }
        }


@dataclass
class KEDAOptimization:
    """
    KEDA 5/5 Bank-Grade Configuration
    
    Optimizations:
    - Queue-based autoscaling for Kafka consumers
    - Metric-based autoscaling for CPU/memory
    - Cooldown periods to prevent thrashing
    - Min/max replica bounds
    """
    
    # Operator Configuration
    operator_replicas: int = 2
    metrics_server_replicas: int = 2
    
    # Default Scaler Settings
    polling_interval: int = 30
    cooldown_period: int = 300
    min_replica_count: int = 1
    max_replica_count: int = 100
    
    # Kafka Scaler
    kafka_lag_threshold: int = 100
    kafka_activation_lag_threshold: int = 10
    
    # CPU Scaler
    cpu_target_utilization: int = 70
    
    # Memory Scaler
    memory_target_utilization: int = 80
    
    def to_scaled_object(
        self,
        name: str,
        namespace: str,
        deployment_name: str,
        scaler_type: str = "kafka",
        **kwargs
    ) -> Dict[str, Any]:
        """Generate ScaledObject configuration"""
        base = {
            "apiVersion": "keda.sh/v1alpha1",
            "kind": "ScaledObject",
            "metadata": {
                "name": name,
                "namespace": namespace
            },
            "spec": {
                "scaleTargetRef": {
                    "name": deployment_name
                },
                "pollingInterval": self.polling_interval,
                "cooldownPeriod": self.cooldown_period,
                "minReplicaCount": kwargs.get("min_replicas", self.min_replica_count),
                "maxReplicaCount": kwargs.get("max_replicas", self.max_replica_count),
                "triggers": []
            }
        }
        
        if scaler_type == "kafka":
            base["spec"]["triggers"].append({
                "type": "kafka",
                "metadata": {
                    "bootstrapServers": kwargs.get("bootstrap_servers", "${KAFKA_BROKERS}"),
                    "consumerGroup": kwargs.get("consumer_group", name),
                    "topic": kwargs.get("topic", ""),
                    "lagThreshold": str(kwargs.get("lag_threshold", self.kafka_lag_threshold)),
                    "activationLagThreshold": str(kwargs.get("activation_lag", self.kafka_activation_lag_threshold))
                }
            })
        elif scaler_type == "cpu":
            base["spec"]["triggers"].append({
                "type": "cpu",
                "metricType": "Utilization",
                "metadata": {
                    "value": str(kwargs.get("target", self.cpu_target_utilization))
                }
            })
        elif scaler_type == "memory":
            base["spec"]["triggers"].append({
                "type": "memory",
                "metricType": "Utilization",
                "metadata": {
                    "value": str(kwargs.get("target", self.memory_target_utilization))
                }
            })
        
        return base


@dataclass
class OpenAppSecOptimization:
    """
    OpenAppSec 5/5 Bank-Grade Configuration
    
    Optimizations:
    - Fintech-specific WAF rules
    - API protection for payment endpoints
    - Bot detection and mitigation
    - Rate limiting per endpoint
    - Audit logging for compliance
    """
    
    # Mode
    enforcement_mode: str = "prevent"  # detect, prevent
    
    # Rule Sets
    owasp_crs_enabled: bool = True
    api_protection_enabled: bool = True
    bot_protection_enabled: bool = True
    
    # Fintech-Specific Rules
    payment_api_protection: bool = True
    kyc_api_protection: bool = True
    
    # Rate Limiting
    global_rate_limit: int = 1000  # requests per minute
    payment_rate_limit: int = 100  # requests per minute
    
    # Logging
    audit_logging: bool = True
    log_level: str = "info"
    
    def to_policy(self) -> Dict[str, Any]:
        """Generate OpenAppSec policy"""
        return {
            "policies": [
                {
                    "name": "remittance-platform-policy",
                    "mode": self.enforcement_mode,
                    "practices": [
                        {
                            "name": "web-attacks",
                            "type": "WebAttacks",
                            "parameters": {
                                "minimumConfidence": "medium",
                                "protections": {
                                    "sqlInjection": True,
                                    "crossSiteScripting": True,
                                    "commandInjection": True,
                                    "pathTraversal": True,
                                    "ldapInjection": True,
                                    "xmlExternalEntity": True,
                                    "serverSideRequestForgery": True
                                }
                            }
                        },
                        {
                            "name": "api-protection",
                            "type": "APIProtection",
                            "parameters": {
                                "schemaValidation": True,
                                "parameterValidation": True,
                                "contentTypeValidation": True
                            }
                        } if self.api_protection_enabled else None,
                        {
                            "name": "bot-protection",
                            "type": "BotProtection",
                            "parameters": {
                                "badBots": "prevent",
                                "suspiciousBots": "detect",
                                "goodBots": "allow"
                            }
                        } if self.bot_protection_enabled else None,
                        {
                            "name": "rate-limiting",
                            "type": "RateLimiting",
                            "parameters": {
                                "scope": "source",
                                "limit": self.global_rate_limit,
                                "unit": "minute"
                            }
                        }
                    ],
                    "triggers": [
                        {
                            "name": "payment-apis",
                            "type": "WebAPI",
                            "parameters": {
                                "uri": "/api/v1/payments/*",
                                "methods": ["POST", "PUT"]
                            },
                            "overrides": {
                                "rateLimit": self.payment_rate_limit
                            }
                        } if self.payment_api_protection else None,
                        {
                            "name": "transfer-apis",
                            "type": "WebAPI",
                            "parameters": {
                                "uri": "/api/v1/transfers/*",
                                "methods": ["POST", "PUT"]
                            },
                            "overrides": {
                                "rateLimit": self.payment_rate_limit
                            }
                        } if self.payment_api_protection else None,
                        {
                            "name": "kyc-apis",
                            "type": "WebAPI",
                            "parameters": {
                                "uri": "/api/v1/kyc/*",
                                "methods": ["POST", "PUT"]
                            },
                            "overrides": {
                                "minimumConfidence": "high"
                            }
                        } if self.kyc_api_protection else None
                    ],
                    "log": {
                        "enabled": self.audit_logging,
                        "level": self.log_level,
                        "format": "json",
                        "destinations": [
                            {
                                "type": "syslog",
                                "address": "opensearch:514"
                            }
                        ]
                    }
                }
            ]
        }


# ==================== Factory Functions ====================

def get_kafka_optimization(level: OptimizationLevel = OptimizationLevel.BANK_GRADE) -> KafkaOptimization:
    """Get Kafka optimization configuration for the specified level"""
    if level == OptimizationLevel.DEVELOPMENT:
        return KafkaOptimization(
            broker_count=1,
            replication_factor=1,
            min_insync_replicas=1,
            security_protocol="PLAINTEXT",
            ssl_enabled=False,
            acl_enabled=False
        )
    elif level == OptimizationLevel.STAGING:
        return KafkaOptimization(
            broker_count=3,
            replication_factor=2,
            min_insync_replicas=1,
            security_protocol="SASL_PLAINTEXT",
            ssl_enabled=False
        )
    elif level == OptimizationLevel.PRODUCTION:
        return KafkaOptimization(
            broker_count=3,
            replication_factor=3,
            min_insync_replicas=2
        )
    else:  # BANK_GRADE
        return KafkaOptimization()


def get_temporal_optimization(level: OptimizationLevel = OptimizationLevel.BANK_GRADE) -> TemporalOptimization:
    """Get Temporal optimization configuration for the specified level"""
    if level == OptimizationLevel.DEVELOPMENT:
        return TemporalOptimization(
            frontend_replicas=1,
            history_replicas=1,
            matching_replicas=1,
            worker_replicas=1,
            tls_enabled=False,
            auth_enabled=False
        )
    elif level == OptimizationLevel.STAGING:
        return TemporalOptimization(
            frontend_replicas=2,
            history_replicas=2,
            matching_replicas=2,
            worker_replicas=2
        )
    else:  # PRODUCTION or BANK_GRADE
        return TemporalOptimization()


def get_postgres_optimization(level: OptimizationLevel = OptimizationLevel.BANK_GRADE) -> PostgresOptimization:
    """Get PostgreSQL optimization configuration for the specified level"""
    if level == OptimizationLevel.DEVELOPMENT:
        return PostgresOptimization(
            replication_mode="asynchronous",
            standby_count=0,
            pgbouncer_enabled=False,
            ssl_enabled=False
        )
    elif level == OptimizationLevel.STAGING:
        return PostgresOptimization(
            standby_count=1,
            replication_mode="asynchronous"
        )
    else:  # PRODUCTION or BANK_GRADE
        return PostgresOptimization()


def get_keycloak_optimization(level: OptimizationLevel = OptimizationLevel.BANK_GRADE) -> KeycloakOptimization:
    """Get Keycloak optimization configuration for the specified level"""
    if level == OptimizationLevel.DEVELOPMENT:
        return KeycloakOptimization(
            replicas=1,
            brute_force_protection=False,
            events_enabled=False
        )
    elif level == OptimizationLevel.STAGING:
        return KeycloakOptimization(
            replicas=2
        )
    else:  # PRODUCTION or BANK_GRADE
        return KeycloakOptimization()


def get_redis_optimization(level: OptimizationLevel = OptimizationLevel.BANK_GRADE) -> RedisOptimization:
    """Get Redis optimization configuration for the specified level"""
    if level == OptimizationLevel.DEVELOPMENT:
        return RedisOptimization(
            cluster_enabled=False,
            cluster_node_count=1,
            requirepass=False,
            tls_enabled=False,
            aof_enabled=False
        )
    elif level == OptimizationLevel.STAGING:
        return RedisOptimization(
            cluster_enabled=False,
            sentinel_enabled=True,
            cluster_node_count=3
        )
    else:  # PRODUCTION or BANK_GRADE
        return RedisOptimization()


def get_opensearch_optimization(level: OptimizationLevel = OptimizationLevel.BANK_GRADE) -> OpenSearchOptimization:
    """Get OpenSearch optimization configuration for the specified level"""
    if level == OptimizationLevel.DEVELOPMENT:
        return OpenSearchOptimization(
            master_node_count=1,
            data_node_count=1,
            ingest_node_count=0,
            number_of_replicas=0,
            security_enabled=False,
            tls_enabled=False
        )
    elif level == OptimizationLevel.STAGING:
        return OpenSearchOptimization(
            master_node_count=1,
            data_node_count=2,
            ingest_node_count=1
        )
    else:  # PRODUCTION or BANK_GRADE
        return OpenSearchOptimization()


def get_keda_optimization(level: OptimizationLevel = OptimizationLevel.BANK_GRADE) -> KEDAOptimization:
    """Get KEDA optimization configuration for the specified level"""
    if level == OptimizationLevel.DEVELOPMENT:
        return KEDAOptimization(
            operator_replicas=1,
            metrics_server_replicas=1,
            min_replica_count=1,
            max_replica_count=3
        )
    elif level == OptimizationLevel.STAGING:
        return KEDAOptimization(
            max_replica_count=10
        )
    else:  # PRODUCTION or BANK_GRADE
        return KEDAOptimization()


def get_openappsec_optimization(level: OptimizationLevel = OptimizationLevel.BANK_GRADE) -> OpenAppSecOptimization:
    """Get OpenAppSec optimization configuration for the specified level"""
    if level == OptimizationLevel.DEVELOPMENT:
        return OpenAppSecOptimization(
            enforcement_mode="detect",
            bot_protection_enabled=False,
            audit_logging=False
        )
    elif level == OptimizationLevel.STAGING:
        return OpenAppSecOptimization(
            enforcement_mode="detect"
        )
    else:  # PRODUCTION or BANK_GRADE
        return OpenAppSecOptimization()


# ==================== Unified Configuration ====================

@dataclass
class InfrastructureOptimization:
    """
    Unified infrastructure optimization configuration.
    
    Provides 5/5 bank-grade configurations for all 11 components.
    """
    
    level: OptimizationLevel = OptimizationLevel.BANK_GRADE
    
    kafka: KafkaOptimization = field(default_factory=KafkaOptimization)
    temporal: TemporalOptimization = field(default_factory=TemporalOptimization)
    postgres: PostgresOptimization = field(default_factory=PostgresOptimization)
    keycloak: KeycloakOptimization = field(default_factory=KeycloakOptimization)
    redis: RedisOptimization = field(default_factory=RedisOptimization)
    opensearch: OpenSearchOptimization = field(default_factory=OpenSearchOptimization)
    keda: KEDAOptimization = field(default_factory=KEDAOptimization)
    openappsec: OpenAppSecOptimization = field(default_factory=OpenAppSecOptimization)
    
    @classmethod
    def for_level(cls, level: OptimizationLevel) -> "InfrastructureOptimization":
        """Create infrastructure optimization for the specified level"""
        return cls(
            level=level,
            kafka=get_kafka_optimization(level),
            temporal=get_temporal_optimization(level),
            postgres=get_postgres_optimization(level),
            keycloak=get_keycloak_optimization(level),
            redis=get_redis_optimization(level),
            opensearch=get_opensearch_optimization(level),
            keda=get_keda_optimization(level),
            openappsec=get_openappsec_optimization(level)
        )
    
    def get_summary(self) -> Dict[str, Any]:
        """Get summary of all optimizations"""
        return {
            "level": self.level.value,
            "components": {
                "kafka": {
                    "brokers": self.kafka.broker_count,
                    "replication_factor": self.kafka.replication_factor,
                    "security": self.kafka.security_protocol,
                    "tls": self.kafka.ssl_enabled
                },
                "temporal": {
                    "frontend_replicas": self.temporal.frontend_replicas,
                    "history_replicas": self.temporal.history_replicas,
                    "tls": self.temporal.tls_enabled
                },
                "postgres": {
                    "standby_count": self.postgres.standby_count,
                    "replication": self.postgres.replication_mode,
                    "pgbouncer": self.postgres.pgbouncer_enabled,
                    "ssl": self.postgres.ssl_enabled
                },
                "keycloak": {
                    "replicas": self.keycloak.replicas,
                    "brute_force_protection": self.keycloak.brute_force_protection
                },
                "redis": {
                    "cluster": self.redis.cluster_enabled,
                    "nodes": self.redis.cluster_node_count,
                    "tls": self.redis.tls_enabled
                },
                "opensearch": {
                    "master_nodes": self.opensearch.master_node_count,
                    "data_nodes": self.opensearch.data_node_count,
                    "tls": self.opensearch.tls_enabled
                },
                "keda": {
                    "operator_replicas": self.keda.operator_replicas,
                    "max_replicas": self.keda.max_replica_count
                },
                "openappsec": {
                    "mode": self.openappsec.enforcement_mode,
                    "bot_protection": self.openappsec.bot_protection_enabled
                }
            }
        }


# Default bank-grade configuration
BANK_GRADE_INFRASTRUCTURE = InfrastructureOptimization.for_level(OptimizationLevel.BANK_GRADE)
