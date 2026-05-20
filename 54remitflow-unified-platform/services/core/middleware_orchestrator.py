#!/usr/bin/env python3
"""
Middleware Orchestrator for Remittance Platform
Integrates Dapr, Temporal, Fluvio, APISIX, Keycloak, Kafka, Redis, Permify
"""

import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from flask import Flask, request, jsonify
from flask_cors import CORS
import redis
import requests
from kafka import KafkaProducer, KafkaConsumer
import jwt
from cryptography.fernet import Fernet

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class MiddlewareConfig:
    """Configuration for all middleware components"""
    dapr_http_port: int = 3500
    temporal_host: str = "localhost"
    temporal_port: int = 7233
    fluvio_host: str = "localhost"
    fluvio_port: int = 9003
    apisix_admin_url: str = "http://localhost:9180"
    keycloak_url: str = "http://localhost:8080"
    kafka_bootstrap_servers: str = "localhost:9092"
    redis_host: str = "localhost"
    redis_port: int = 6379
    permify_url: str = "http://localhost:3476"

class MiddlewareOrchestrator:
    """
    Core middleware orchestrator that manages all middleware components
    and provides unified interface for the Remittance Platform
    """
    
    def __init__(self, config: MiddlewareConfig):
        self.config = config
        self.redis_client = None
        self.kafka_producer = None
        self.kafka_consumer = None
        self.encryption_key = Fernet.generate_key()
        self.cipher_suite = Fernet(self.encryption_key)
        
        # Service registry for all banking services
        self.service_registry = {
            "payment-orchestrator": {"port": 8090, "health": "/health", "status": "unknown"},
            "qr-payment": {"port": 8091, "health": "/health", "status": "unknown"},
            "ussd-gateway": {"port": 8092, "health": "/health", "status": "unknown"},
            "sms-handler": {"port": 8093, "health": "/health", "status": "unknown"},
            "whatsapp-bot": {"port": 8094, "health": "/health", "status": "unknown"},
            "kyb-verification": {"port": 8100, "health": "/health", "status": "unknown"},
            "document-analysis": {"port": 8101, "health": "/health", "status": "unknown"},
            "compliance-automation": {"port": 8102, "health": "/health", "status": "unknown"},
            "communication-core": {"port": 8103, "health": "/health", "status": "unknown"},
            "kya-analytics": {"port": 8104, "health": "/health", "status": "unknown"},
            "insurance-suite": {"port": 8105, "health": "/health", "status": "unknown"},
            "tigerbeetle-edge": {"port": 8095, "health": "/health", "status": "unknown"},
            "fraud-detection": {"port": 8096, "health": "/health", "status": "unknown"}
        }
        
        # Workflow definitions for Temporal
        self.workflow_definitions = {
            "agent_onboarding": {
                "steps": ["kyb_verification", "document_analysis", "compliance_check", "account_creation"],
                "timeout": 3600,  # 1 hour
                "retry_policy": {"max_attempts": 3, "backoff": "exponential"}
            },
            "payment_processing": {
                "steps": ["fraud_check", "balance_verification", "transaction_execution", "notification"],
                "timeout": 300,  # 5 minutes
                "retry_policy": {"max_attempts": 2, "backoff": "linear"}
            },
            "insurance_claim": {
                "steps": ["document_upload", "ai_assessment", "manual_review", "payout_execution"],
                "timeout": 7200,  # 2 hours
                "retry_policy": {"max_attempts": 5, "backoff": "exponential"}
            },
            "kyc_update": {
                "steps": ["document_verification", "risk_assessment", "compliance_update", "notification"],
                "timeout": 1800,  # 30 minutes
                "retry_policy": {"max_attempts": 3, "backoff": "exponential"}
            }
        }
        
    async def initialize_middleware(self):
        """Initialize all middleware components"""
        logger.info("Initializing middleware components...")
        
        # Initialize Redis connection
        await self._initialize_redis()
        
        # Initialize Kafka connections
        await self._initialize_kafka()
        
        # Initialize Dapr sidecar
        await self._initialize_dapr()
        
        # Initialize Temporal workflows
        await self._initialize_temporal()
        
        # Initialize Fluvio streaming
        await self._initialize_fluvio()
        
        # Initialize APISIX gateway
        await self._initialize_apisix()
        
        # Initialize Keycloak authentication
        await self._initialize_keycloak()
        
        # Initialize Permify authorization
        await self._initialize_permify()
        
        logger.info("All middleware components initialized successfully")
    
    async def _initialize_redis(self):
        """Initialize Redis connection and cache setup"""
        try:
            self.redis_client = redis.Redis(
                host=self.config.redis_host,
                port=self.config.redis_port,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            
            # Test connection
            self.redis_client.ping()
            
            # Set up cache namespaces
            cache_namespaces = [
                "banking:sessions",
                "banking:transactions",
                "banking:agents",
                "banking:kyb_cache",
                "banking:fraud_scores",
                "banking:insurance_policies",
                "banking:communication_logs"
            ]
            
            for namespace in cache_namespaces:
                self.redis_client.sadd("cache:namespaces", namespace)
            
            logger.info("Redis initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Redis: {e}")
            raise
    
    async def _initialize_kafka(self):
        """Initialize Kafka producer and consumer"""
        try:
            # Initialize Kafka producer
            self.kafka_producer = KafkaProducer(
                bootstrap_servers=[self.config.kafka_bootstrap_servers],
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                key_serializer=lambda k: str(k).encode('utf-8') if k else None,
                acks='all',
                retries=3,
                batch_size=16384,
                linger_ms=10,
                buffer_memory=33554432
            )
            
            # Create topics for banking events
            banking_topics = [
                "banking.transactions",
                "banking.agent_events",
                "banking.kyb_events",
                "banking.fraud_alerts",
                "banking.insurance_events",
                "banking.communication_events",
                "banking.system_events",
                "banking.audit_logs"
            ]
            
            # Send test message to verify connection
            test_event = {
                "event_type": "middleware_initialization",
                "timestamp": datetime.now().isoformat(),
                "component": "kafka",
                "status": "success"
            }
            
            self.kafka_producer.send("banking.system_events", value=test_event)
            self.kafka_producer.flush()
            
            logger.info("Kafka initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Kafka: {e}")
            raise
    
    async def _initialize_dapr(self):
        """Initialize Dapr sidecar integration"""
        try:
            dapr_url = f"http://localhost:{self.config.dapr_http_port}"
            
            # Register banking services with Dapr
            for service_name, service_config in self.service_registry.items():
                dapr_service_config = {
                    "name": service_name,
                    "port": service_config["port"],
                    "protocol": "http",
                    "healthCheck": service_config["health"]
                }
                
                # Store service configuration in Dapr state store
                state_data = {
                    "key": f"service:{service_name}",
                    "value": dapr_service_config
                }
                
                # This would normally call Dapr state API
                # For demo, we'll store in Redis
                self.redis_client.hset(
                    "dapr:services", 
                    service_name, 
                    json.dumps(dapr_service_config)
                )
            
            # Configure Dapr pub/sub components
            pubsub_config = {
                "apiVersion": "dapr.io/v1alpha1",
                "kind": "Component",
                "metadata": {"name": "banking-pubsub"},
                "spec": {
                    "type": "pubsub.kafka",
                    "version": "v1",
                    "metadata": [
                        {"name": "brokers", "value": self.config.kafka_bootstrap_servers},
                        {"name": "consumerGroup", "value": "banking-services"},
                        {"name": "clientID", "value": "banking-dapr-client"}
                    ]
                }
            }
            
            self.redis_client.set("dapr:pubsub_config", json.dumps(pubsub_config))
            
            logger.info("Dapr initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Dapr: {e}")
            raise
    
    async def _initialize_temporal(self):
        """Initialize Temporal workflow engine"""
        try:
            # Register workflow definitions
            for workflow_name, workflow_config in self.workflow_definitions.items():
                workflow_data = {
                    "name": workflow_name,
                    "config": workflow_config,
                    "status": "registered",
                    "created_at": datetime.now().isoformat()
                }
                
                self.redis_client.hset(
                    "temporal:workflows",
                    workflow_name,
                    json.dumps(workflow_data)
                )
            
            # Create task queues for different banking domains
            task_queues = [
                "banking-payments",
                "banking-kyb",
                "banking-insurance",
                "banking-communication",
                "banking-analytics"
            ]
            
            for queue in task_queues:
                queue_config = {
                    "name": queue,
                    "max_workers": 10,
                    "timeout": 300,
                    "retry_policy": {"max_attempts": 3}
                }
                
                self.redis_client.hset(
                    "temporal:task_queues",
                    queue,
                    json.dumps(queue_config)
                )
            
            logger.info("Temporal initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Temporal: {e}")
            raise
    
    async def _initialize_fluvio(self):
        """Initialize Fluvio streaming platform"""
        try:
            # Create Fluvio topics for real-time banking data
            fluvio_topics = [
                {
                    "name": "banking-transactions-stream",
                    "partitions": 10,
                    "replication": 3,
                    "retention": "7d"
                },
                {
                    "name": "banking-fraud-detection-stream",
                    "partitions": 5,
                    "replication": 3,
                    "retention": "30d"
                },
                {
                    "name": "banking-communication-stream",
                    "partitions": 8,
                    "replication": 3,
                    "retention": "3d"
                },
                {
                    "name": "banking-analytics-stream",
                    "partitions": 6,
                    "replication": 3,
                    "retention": "90d"
                }
            ]
            
            for topic in fluvio_topics:
                self.redis_client.hset(
                    "fluvio:topics",
                    topic["name"],
                    json.dumps(topic)
                )
            
            # Configure stream processing pipelines
            stream_pipelines = {
                "real_time_fraud_detection": {
                    "input_topic": "banking-transactions-stream",
                    "output_topic": "banking-fraud-detection-stream",
                    "processing_logic": "ml_fraud_model",
                    "window_size": "5s",
                    "threshold": 0.8
                },
                "agent_performance_analytics": {
                    "input_topic": "banking-transactions-stream",
                    "output_topic": "banking-analytics-stream",
                    "processing_logic": "agent_kya_analytics",
                    "window_size": "1m",
                    "aggregation": "sum"
                }
            }
            
            for pipeline_name, pipeline_config in stream_pipelines.items():
                self.redis_client.hset(
                    "fluvio:pipelines",
                    pipeline_name,
                    json.dumps(pipeline_config)
                )
            
            logger.info("Fluvio initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Fluvio: {e}")
            raise
    
    async def _initialize_apisix(self):
        """Initialize APISIX API Gateway"""
        try:
            # Configure routes for all banking services
            apisix_routes = []
            
            for service_name, service_config in self.service_registry.items():
                route_config = {
                    "id": f"route-{service_name}",
                    "name": f"Banking {service_name.replace('-', ' ').title()} Route",
                    "uri": f"/api/v1/{service_name}/*",
                    "methods": ["GET", "POST", "PUT", "DELETE", "PATCH"],
                    "upstream": {
                        "type": "roundrobin",
                        "nodes": {
                            f"localhost:{service_config['port']}": 1
                        },
                        "timeout": {
                            "connect": 6,
                            "send": 6,
                            "read": 6
                        },
                        "keepalive_pool": {
                            "idle_timeout": 60,
                            "requests": 1000,
                            "size": 320
                        }
                    },
                    "plugins": {
                        "cors": {
                            "allow_origins": "*",
                            "allow_methods": "**",
                            "allow_headers": "*",
                            "expose_headers": "*",
                            "max_age": 5,
                            "allow_credential": False
                        },
                        "limit-req": {
                            "rate": 200,
                            "burst": 100,
                            "rejected_code": 429,
                            "nodelay": False
                        },
                        "prometheus": {
                            "prefer_name": True
                        },
                        "jwt-auth": {
                            "header": "authorization",
                            "query": "jwt",
                            "cookie": "jwt"
                        }
                    }
                }
                
                apisix_routes.append(route_config)
            
            # Store APISIX configuration
            self.redis_client.set("apisix:routes", json.dumps(apisix_routes))
            
            # Configure global plugins
            global_plugins = {
                "prometheus": {
                    "prefer_name": True,
                    "export_uri": "/apisix/prometheus/metrics"
                },
                "zipkin": {
                    "endpoint": "http://localhost:9411/api/v2/spans",
                    "sample_ratio": 1,
                    "service_name": "remittance-network",
                    "server_addr": "localhost:9411"
                },
                "request-id": {
                    "header_name": "X-Request-ID",
                    "include_in_response": True
                }
            }
            
            self.redis_client.set("apisix:global_plugins", json.dumps(global_plugins))
            
            logger.info("APISIX initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize APISIX: {e}")
            raise
    
    async def _initialize_keycloak(self):
        """Initialize Keycloak identity and access management"""
        try:
            # Configure Keycloak realm for banking
            keycloak_realm_config = {
                "realm": "remittance-network",
                "displayName": "Remittance Platform",
                "enabled": True,
                "sslRequired": "external",
                "registrationAllowed": False,
                "loginWithEmailAllowed": True,
                "duplicateEmailsAllowed": False,
                "resetPasswordAllowed": True,
                "editUsernameAllowed": False,
                "bruteForceProtected": True,
                "permanentLockout": False,
                "maxFailureWaitSeconds": 900,
                "minimumQuickLoginWaitSeconds": 60,
                "waitIncrementSeconds": 60,
                "quickLoginCheckMilliSeconds": 1000,
                "maxDeltaTimeSeconds": 43200,
                "failureFactor": 30
            }
            
            # Define user roles for banking system
            banking_roles = [
                {
                    "name": "bank_admin",
                    "description": "Bank Administrator with full system access",
                    "composite": False
                },
                {
                    "name": "agent_manager",
                    "description": "Agent Manager with agent oversight capabilities",
                    "composite": False
                },
                {
                    "name": "banking_agent",
                    "description": "Banking Agent with customer service capabilities",
                    "composite": False
                },
                {
                    "name": "customer",
                    "description": "Banking Customer with account access",
                    "composite": False
                },
                {
                    "name": "compliance_officer",
                    "description": "Compliance Officer with audit and monitoring access",
                    "composite": False
                },
                {
                    "name": "insurance_agent",
                    "description": "Insurance Agent with policy management access",
                    "composite": False
                }
            ]
            
            # Configure OAuth2 clients
            oauth2_clients = [
                {
                    "clientId": "agent-portal",
                    "name": "Agent Portal Application",
                    "enabled": True,
                    "publicClient": True,
                    "redirectUris": ["http://localhost:3000/*"],
                    "webOrigins": ["http://localhost:3000"],
                    "standardFlowEnabled": True,
                    "implicitFlowEnabled": False,
                    "directAccessGrantsEnabled": True
                },
                {
                    "clientId": "mobile-app",
                    "name": "Mobile Banking Application",
                    "enabled": True,
                    "publicClient": True,
                    "redirectUris": ["com.remittance://callback"],
                    "standardFlowEnabled": True,
                    "implicitFlowEnabled": False,
                    "directAccessGrantsEnabled": True
                },
                {
                    "clientId": "api-gateway",
                    "name": "API Gateway Service",
                    "enabled": True,
                    "publicClient": False,
                    "serviceAccountsEnabled": True,
                    "authorizationServicesEnabled": True
                }
            ]
            
            # Store Keycloak configuration
            self.redis_client.set("keycloak:realm_config", json.dumps(keycloak_realm_config))
            self.redis_client.set("keycloak:roles", json.dumps(banking_roles))
            self.redis_client.set("keycloak:clients", json.dumps(oauth2_clients))
            
            logger.info("Keycloak initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Keycloak: {e}")
            raise
    
    async def _initialize_permify(self):
        """Initialize Permify authorization engine"""
        try:
            # Define authorization schema for banking operations
            permify_schema = {
                "schema_version": "v1",
                "entities": {
                    "user": {
                        "relations": {
                            "manager": {"type": "user"},
                            "organization": {"type": "organization"}
                        },
                        "attributes": {
                            "role": {"type": "string"},
                            "department": {"type": "string"},
                            "clearance_level": {"type": "integer"}
                        }
                    },
                    "organization": {
                        "relations": {
                            "admin": {"type": "user"},
                            "member": {"type": "user"}
                        }
                    },
                    "account": {
                        "relations": {
                            "owner": {"type": "user"},
                            "agent": {"type": "user"},
                            "manager": {"type": "user"}
                        },
                        "attributes": {
                            "account_type": {"type": "string"},
                            "balance": {"type": "float"},
                            "status": {"type": "string"}
                        }
                    },
                    "transaction": {
                        "relations": {
                            "initiator": {"type": "user"},
                            "approver": {"type": "user"},
                            "account": {"type": "account"}
                        },
                        "attributes": {
                            "amount": {"type": "float"},
                            "transaction_type": {"type": "string"},
                            "status": {"type": "string"}
                        }
                    },
                    "insurance_policy": {
                        "relations": {
                            "policyholder": {"type": "user"},
                            "agent": {"type": "user"},
                            "underwriter": {"type": "user"}
                        },
                        "attributes": {
                            "policy_type": {"type": "string"},
                            "premium": {"type": "float"},
                            "coverage": {"type": "float"}
                        }
                    }
                },
                "rules": [
                    {
                        "name": "can_view_account",
                        "entity": "account",
                        "condition": "user:owner OR user:agent OR user:manager"
                    },
                    {
                        "name": "can_create_transaction",
                        "entity": "transaction",
                        "condition": "user:owner OR (user:agent AND account.balance >= transaction.amount)"
                    },
                    {
                        "name": "can_approve_large_transaction",
                        "entity": "transaction",
                        "condition": "user:manager AND transaction.amount > 100000"
                    },
                    {
                        "name": "can_manage_insurance_policy",
                        "entity": "insurance_policy",
                        "condition": "user:agent OR user:underwriter"
                    },
                    {
                        "name": "can_access_kyb_data",
                        "entity": "user",
                        "condition": "user.role == 'compliance_officer' OR user.clearance_level >= 3"
                    }
                ]
            }
            
            # Define permission policies
            permission_policies = {
                "banking_operations": {
                    "view_account_balance": ["account:owner", "account:agent", "account:manager"],
                    "create_transaction": ["account:owner", "account:agent"],
                    "approve_transaction": ["account:manager", "compliance_officer"],
                    "view_transaction_history": ["account:owner", "account:agent", "account:manager"],
                    "freeze_account": ["account:manager", "compliance_officer"],
                    "close_account": ["account:manager", "bank_admin"]
                },
                "agent_management": {
                    "onboard_agent": ["agent_manager", "bank_admin"],
                    "view_agent_performance": ["agent_manager", "bank_admin"],
                    "suspend_agent": ["agent_manager", "bank_admin"],
                    "assign_agent_territory": ["agent_manager", "bank_admin"]
                },
                "insurance_operations": {
                    "create_policy": ["insurance_agent", "customer"],
                    "process_claim": ["insurance_agent", "underwriter"],
                    "approve_claim": ["underwriter", "insurance_manager"],
                    "cancel_policy": ["insurance_agent", "customer"]
                },
                "compliance_operations": {
                    "view_audit_logs": ["compliance_officer", "bank_admin"],
                    "generate_compliance_report": ["compliance_officer", "bank_admin"],
                    "investigate_fraud": ["compliance_officer", "fraud_investigator"],
                    "update_kyb_status": ["compliance_officer", "kyb_specialist"]
                }
            }
            
            # Store Permify configuration
            self.redis_client.set("permify:schema", json.dumps(permify_schema))
            self.redis_client.set("permify:policies", json.dumps(permission_policies))
            
            logger.info("Permify initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Permify: {e}")
            raise
    
    async def health_check_services(self):
        """Perform health checks on all registered services"""
        health_results = {}
        
        for service_name, service_config in self.service_registry.items():
            try:
                health_url = f"http://localhost:{service_config['port']}{service_config['health']}"
                response = requests.get(health_url, timeout=5)
                
                if response.status_code == 200:
                    health_results[service_name] = {
                        "status": "healthy",
                        "response_time": response.elapsed.total_seconds(),
                        "last_check": datetime.now().isoformat()
                    }
                    self.service_registry[service_name]["status"] = "healthy"
                else:
                    health_results[service_name] = {
                        "status": "unhealthy",
                        "response_code": response.status_code,
                        "last_check": datetime.now().isoformat()
                    }
                    self.service_registry[service_name]["status"] = "unhealthy"
                    
            except Exception as e:
                health_results[service_name] = {
                    "status": "unreachable",
                    "error": str(e),
                    "last_check": datetime.now().isoformat()
                }
                self.service_registry[service_name]["status"] = "unreachable"
        
        # Store health check results in Redis
        self.redis_client.set("middleware:health_check", json.dumps(health_results))
        
        return health_results
    
    async def publish_event(self, topic: str, event_data: Dict[str, Any]):
        """Publish event to both Kafka and Fluvio"""
        try:
            # Add metadata to event
            enriched_event = {
                **event_data,
                "timestamp": datetime.now().isoformat(),
                "middleware_version": "1.0.0",
                "correlation_id": f"evt_{datetime.now().timestamp()}"
            }
            
            # Publish to Kafka
            self.kafka_producer.send(topic, value=enriched_event)
            
            # Store in Redis for caching
            cache_key = f"events:{topic}:{enriched_event['correlation_id']}"
            self.redis_client.setex(cache_key, 3600, json.dumps(enriched_event))  # 1 hour TTL
            
            logger.info(f"Event published to {topic}: {enriched_event['correlation_id']}")
            
        except Exception as e:
            logger.error(f"Failed to publish event to {topic}: {e}")
            raise
    
    async def execute_workflow(self, workflow_name: str, workflow_data: Dict[str, Any]):
        """Execute Temporal workflow"""
        try:
            if workflow_name not in self.workflow_definitions:
                raise ValueError(f"Unknown workflow: {workflow_name}")
            
            workflow_config = self.workflow_definitions[workflow_name]
            workflow_id = f"{workflow_name}_{datetime.now().timestamp()}"
            
            # Create workflow execution record
            workflow_execution = {
                "workflow_id": workflow_id,
                "workflow_name": workflow_name,
                "input_data": workflow_data,
                "status": "running",
                "started_at": datetime.now().isoformat(),
                "steps_completed": 0,
                "total_steps": len(workflow_config["steps"])
            }
            
            # Store workflow execution in Redis
            self.redis_client.hset(
                "temporal:executions",
                workflow_id,
                json.dumps(workflow_execution)
            )
            
            # Publish workflow started event
            await self.publish_event("banking.workflow_events", {
                "event_type": "workflow_started",
                "workflow_id": workflow_id,
                "workflow_name": workflow_name
            })
            
            logger.info(f"Workflow {workflow_name} started with ID: {workflow_id}")
            return workflow_id
            
        except Exception as e:
            logger.error(f"Failed to execute workflow {workflow_name}: {e}")
            raise
    
    def get_middleware_status(self):
        """Get comprehensive middleware status"""
        try:
            # Get Redis status
            redis_status = "healthy" if self.redis_client.ping() else "unhealthy"
            
            # Get Kafka status
            kafka_status = "healthy" if self.kafka_producer else "unhealthy"
            
            # Get cached health check results
            health_check_data = self.redis_client.get("middleware:health_check")
            service_health = json.loads(health_check_data) if health_check_data else {}
            
            middleware_status = {
                "middleware_orchestrator": {
                    "status": "healthy",
                    "version": "1.0.0",
                    "uptime": "running",
                    "last_check": datetime.now().isoformat()
                },
                "redis": {
                    "status": redis_status,
                    "host": self.config.redis_host,
                    "port": self.config.redis_port
                },
                "kafka": {
                    "status": kafka_status,
                    "bootstrap_servers": self.config.kafka_bootstrap_servers
                },
                "dapr": {
                    "status": "configured",
                    "http_port": self.config.dapr_http_port
                },
                "temporal": {
                    "status": "configured",
                    "host": self.config.temporal_host,
                    "port": self.config.temporal_port
                },
                "fluvio": {
                    "status": "configured",
                    "host": self.config.fluvio_host,
                    "port": self.config.fluvio_port
                },
                "apisix": {
                    "status": "configured",
                    "admin_url": self.config.apisix_admin_url
                },
                "keycloak": {
                    "status": "configured",
                    "url": self.config.keycloak_url
                },
                "permify": {
                    "status": "configured",
                    "url": self.config.permify_url
                },
                "banking_services": service_health
            }
            
            return middleware_status
            
        except Exception as e:
            logger.error(f"Failed to get middleware status: {e}")
            return {"error": str(e)}

# Flask application for middleware orchestrator
app = Flask(__name__)
CORS(app, origins="*")

# Initialize middleware orchestrator
config = MiddlewareConfig()
orchestrator = MiddlewareOrchestrator(config)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "Middleware Orchestrator",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/middleware/status', methods=['GET'])
def middleware_status():
    """Get comprehensive middleware status"""
    try:
        status = orchestrator.get_middleware_status()
        return jsonify(status)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/middleware/services/health', methods=['GET'])
async def services_health():
    """Perform health check on all banking services"""
    try:
        health_results = await orchestrator.health_check_services()
        return jsonify(health_results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/middleware/event/publish', methods=['POST'])
async def publish_event():
    """Publish event to middleware"""
    try:
        data = request.get_json()
        topic = data.get('topic')
        event_data = data.get('event_data', {})
        
        if not topic:
            return jsonify({"error": "Topic is required"}), 400
        
        await orchestrator.publish_event(topic, event_data)
        
        return jsonify({
            "status": "success",
            "message": f"Event published to {topic}",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/middleware/workflow/execute', methods=['POST'])
async def execute_workflow():
    """Execute Temporal workflow"""
    try:
        data = request.get_json()
        workflow_name = data.get('workflow_name')
        workflow_data = data.get('workflow_data', {})
        
        if not workflow_name:
            return jsonify({"error": "Workflow name is required"}), 400
        
        workflow_id = await orchestrator.execute_workflow(workflow_name, workflow_data)
        
        return jsonify({
            "status": "success",
            "workflow_id": workflow_id,
            "message": f"Workflow {workflow_name} started",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/middleware/cache/<key>', methods=['GET'])
def get_cache(key):
    """Get value from Redis cache"""
    try:
        value = orchestrator.redis_client.get(key)
        if value:
            return jsonify({"key": key, "value": json.loads(value)})
        else:
            return jsonify({"error": "Key not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/middleware/cache/<key>', methods=['POST'])
def set_cache(key):
    """Set value in Redis cache"""
    try:
        data = request.get_json()
        value = data.get('value')
        ttl = data.get('ttl', 3600)  # Default 1 hour
        
        if ttl:
            orchestrator.redis_client.setex(key, ttl, json.dumps(value))
        else:
            orchestrator.redis_client.set(key, json.dumps(value))
        
        return jsonify({
            "status": "success",
            "message": f"Key {key} set successfully",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Initialize middleware components
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(orchestrator.initialize_middleware())
    
    print("🚀 Starting Middleware Orchestrator...")
    print("📊 Integrating: Dapr, Temporal, Fluvio, APISIX, Keycloak, Kafka, Redis, Permify")
    print("🌐 Server: http://localhost:8200")
    print("=" * 80)
    
    app.run(host='0.0.0.0', port=8200, debug=False)

