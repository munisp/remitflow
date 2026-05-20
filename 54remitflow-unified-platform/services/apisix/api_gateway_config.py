#!/usr/bin/env python3
"""
APISIX API Gateway Configuration for Remittance Platform
Comprehensive routing, security, and middleware integration
"""

import json
import yaml
import requests
from typing import Dict, List, Any
from dataclasses import dataclass
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class RouteConfig:
    """Configuration for API routes"""
    name: str
    uri: str
    upstream: str
    methods: List[str]
    plugins: Dict[str, Any]
    priority: int = 0

class APISIXGatewayManager:
    """Comprehensive APISIX API Gateway Manager for Remittance Platform"""
    
    def __init__(self, admin_url: str = "http://localhost:9180", admin_key: str = "edd1c9f034335f136f87ad84b625c8f1"):
        self.admin_url = admin_url
        self.admin_key = admin_key
        self.headers = {
            "X-API-KEY": admin_key,
            "Content-Type": "application/json"
        }
        
    def create_upstream(self, name: str, nodes: List[Dict[str, Any]], config: Dict[str, Any] = None) -> bool:
        """Create upstream configuration for service discovery"""
        upstream_config = {
            "name": name,
            "type": "roundrobin",
            "nodes": nodes,
            "timeout": {"connect": 6, "send": 6, "read": 6},
            "keepalive_pool": {"size": 320, "idle_timeout": 60, "requests": 1000},
            "retries": 3,
            "retry_timeout": 0.5,
            "scheme": "http"
        }
        
        if config:
            upstream_config.update(config)
            
        try:
            response = requests.put(
                f"{self.admin_url}/apisix/admin/upstreams/{name}",
                headers=self.headers,
                json=upstream_config
            )
            
            if response.status_code in [200, 201]:
                logger.info(f"✅ Created upstream: {name}")
                return True
            else:
                logger.error(f"❌ Failed to create upstream {name}: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error creating upstream {name}: {str(e)}")
            return False
    
    def create_route(self, route_config: RouteConfig) -> bool:
        """Create API route with comprehensive configuration"""
        route_data = {
            "name": route_config.name,
            "uri": route_config.uri,
            "methods": route_config.methods,
            "upstream": {"type": "roundrobin", "nodes": {route_config.upstream: 1}},
            "plugins": route_config.plugins,
            "priority": route_config.priority,
            "status": 1
        }
        
        try:
            response = requests.put(
                f"{self.admin_url}/apisix/admin/routes/{route_config.name}",
                headers=self.headers,
                json=route_data
            )
            
            if response.status_code in [200, 201]:
                logger.info(f"✅ Created route: {route_config.name}")
                return True
            else:
                logger.error(f"❌ Failed to create route {route_config.name}: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error creating route {route_config.name}: {str(e)}")
            return False
    
    def setup_banking_routes(self) -> bool:
        """Setup comprehensive banking API routes"""
        
        # Core Banking Services
        banking_upstreams = [
            ("kyb-service", [{"host": "localhost", "port": 8100, "weight": 1}]),
            ("payment-orchestrator", [{"host": "localhost", "port": 8090, "weight": 1}]),
            ("qr-payment", [{"host": "localhost", "port": 8091, "weight": 1}]),
            ("ussd-gateway", [{"host": "localhost", "port": 8092, "weight": 1}]),
            ("sms-handler", [{"host": "localhost", "port": 8093, "weight": 1}]),
            ("whatsapp-bot", [{"host": "localhost", "port": 8094, "weight": 1}]),
            ("tigerbeetle-edge", [{"host": "localhost", "port": 8095, "weight": 1}]),
            ("agent-management", [{"host": "localhost", "port": 8080, "weight": 1}]),
            ("user-service", [{"host": "localhost", "port": 8081, "weight": 1}]),
            ("transaction-service", [{"host": "localhost", "port": 8082, "weight": 1}]),
            ("notification-service", [{"host": "localhost", "port": 8083, "weight": 1}]),
            ("communication-platform", [{"host": "localhost", "port": 8096, "weight": 1}]),
            ("kya-analytics", [{"host": "localhost", "port": 8097, "weight": 1}]),
            ("insurance-platform", [{"host": "localhost", "port": 8098, "weight": 1}]),
        ]
        
        # Create upstreams
        for upstream_name, nodes in banking_upstreams:
            self.create_upstream(upstream_name, nodes)
        
        # Common plugins for all routes
        common_plugins = {
            "cors": {
                "allow_origins": "*",
                "allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
                "allow_headers": "*",
                "expose_headers": "*",
                "max_age": 5,
                "allow_credential": True
            },
            "limit-req": {
                "rate": 200,
                "burst": 100,
                "rejected_code": 429,
                "nodelay": False
            },
            "response-rewrite": {
                "headers": {
                    "X-Powered-By": "Remittance Platform",
                    "X-API-Version": "v6.0.0-ULTIMATE"
                }
            }
        }
        
        # Security plugins for sensitive routes
        security_plugins = {
            **common_plugins,
            "key-auth": {},
            "jwt-auth": {
                "header": "Authorization",
                "query": "jwt",
                "cookie": "jwt"
            },
            "ip-restriction": {
                "whitelist": ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
            }
        }
        
        # Define comprehensive routes
        routes = [
            # KYB Routes
            RouteConfig("kyb-verification", "/api/v1/kyb/*", "localhost:8100", ["GET", "POST", "PUT"], security_plugins, 100),
            RouteConfig("kyb-documents", "/api/v1/kyb/documents/*", "localhost:8100", ["POST", "GET"], security_plugins, 100),
            RouteConfig("kyb-compliance", "/api/v1/kyb/compliance/*", "localhost:8100", ["GET", "POST"], security_plugins, 100),
            
            # Payment Routes
            RouteConfig("payment-orchestrator", "/api/v1/payments/*", "localhost:8090", ["GET", "POST", "PUT"], security_plugins, 100),
            RouteConfig("qr-payments", "/api/v1/payments/qr/*", "localhost:8091", ["GET", "POST"], common_plugins, 90),
            RouteConfig("ussd-payments", "/api/v1/payments/ussd/*", "localhost:8092", ["GET", "POST"], common_plugins, 90),
            RouteConfig("sms-payments", "/api/v1/payments/sms/*", "localhost:8093", ["GET", "POST"], common_plugins, 90),
            RouteConfig("whatsapp-payments", "/api/v1/payments/whatsapp/*", "localhost:8094", ["GET", "POST"], common_plugins, 90),
            
            # Core Banking Routes
            RouteConfig("tigerbeetle-api", "/api/v1/accounting/*", "localhost:8095", ["GET", "POST"], security_plugins, 100),
            RouteConfig("agent-management", "/api/v1/agents/*", "localhost:8080", ["GET", "POST", "PUT", "DELETE"], security_plugins, 100),
            RouteConfig("user-management", "/api/v1/users/*", "localhost:8081", ["GET", "POST", "PUT", "DELETE"], security_plugins, 100),
            RouteConfig("transactions", "/api/v1/transactions/*", "localhost:8082", ["GET", "POST"], security_plugins, 100),
            RouteConfig("notifications", "/api/v1/notifications/*", "localhost:8083", ["GET", "POST"], common_plugins, 80),
            
            # Advanced Features Routes
            RouteConfig("communication", "/api/v1/communication/*", "localhost:8096", ["GET", "POST"], common_plugins, 80),
            RouteConfig("kya-analytics", "/api/v1/analytics/kya/*", "localhost:8097", ["GET", "POST"], security_plugins, 90),
            RouteConfig("insurance", "/api/v1/insurance/*", "localhost:8098", ["GET", "POST", "PUT"], security_plugins, 90),
            
            # Health and Status Routes
            RouteConfig("health-check", "/health", "localhost:8080", ["GET"], common_plugins, 10),
            RouteConfig("api-status", "/api/v1/status", "localhost:8080", ["GET"], common_plugins, 10),
        ]
        
        # Create all routes
        success_count = 0
        for route in routes:
            if self.create_route(route):
                success_count += 1
        
        logger.info(f"✅ Successfully created {success_count}/{len(routes)} routes")
        return success_count == len(routes)
    
    def setup_global_plugins(self) -> bool:
        """Setup global plugins for all routes"""
        global_plugins = {
            "prometheus": {
                "prefer_name": True
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
            },
            "real-ip": {
                "source": "http_x_forwarded_for",
                "trusted_addresses": ["127.0.0.1", "::1"]
            }
        }
        
        try:
            response = requests.put(
                f"{self.admin_url}/apisix/admin/global_rules/1",
                headers=self.headers,
                json={"plugins": global_plugins}
            )
            
            if response.status_code in [200, 201]:
                logger.info("✅ Global plugins configured successfully")
                return True
            else:
                logger.error(f"❌ Failed to configure global plugins: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error configuring global plugins: {str(e)}")
            return False
    
    def generate_config_files(self) -> Dict[str, str]:
        """Generate APISIX configuration files"""
        
        # Main APISIX configuration
        apisix_config = {
            "apisix": {
                "node_listen": 9080,
                "enable_ipv6": False,
                "allow_admin": ["127.0.0.1", "::1"],
                "admin_key": [
                    {
                        "name": "admin",
                        "key": self.admin_key,
                        "role": "admin"
                    }
                ],
                "enable_control": True,
                "control": {
                    "ip": "127.0.0.1",
                    "port": 9092
                }
            },
            "nginx_config": {
                "error_log": "/dev/stderr",
                "error_log_level": "warn",
                "worker_processes": "auto",
                "worker_rlimit_nofile": 20480,
                "event": {
                    "worker_connections": 10620
                },
                "http": {
                    "access_log": "/dev/stdout",
                    "keepalive_timeout": "60s",
                    "client_header_timeout": "60s",
                    "client_body_timeout": "60s",
                    "send_timeout": "10s",
                    "underscores_in_headers": "on",
                    "real_ip_header": "X-Real-IP",
                    "real_ip_from": ["127.0.0.1", "unix:"]
                }
            },
            "etcd": {
                "host": ["http://127.0.0.1:2379"],
                "prefix": "/apisix",
                "timeout": 30
            },
            "plugins": [
                "real-ip", "client-control", "proxy-control", "request-id",
                "zipkin", "ext-plugin-pre-req", "fault-injection",
                "mocking", "serverless-pre-function", "cors", "ip-restriction",
                "ua-restriction", "referer-restriction", "csrf", "uri-blocker",
                "request-validation", "openid-connect", "cas-auth", "authz-casbin",
                "authz-casdoor", "wolf-rbac", "ldap-auth", "hmac-auth", "basic-auth",
                "jwt-auth", "key-auth", "consumer-restriction", "authz-keycloak",
                "opa", "forward-auth", "multi-auth", "api-breaker", "limit-req",
                "limit-conn", "limit-count", "proxy-cache", "request-rewrite",
                "workflow", "proxy-rewrite", "grpc-transcode", "grpc-web",
                "public-api", "prometheus", "datadog", "echo", "loggly",
                "http-logger", "splunk-hec-logging", "skywalking-logger",
                "google-cloud-logging", "sls-logger", "tcp-logger", "kafka-logger",
                "rocketmq-logger", "syslog", "udp-logger", "file-logger",
                "clickhouse-logger", "tencent-cloud-cls", "inspect",
                "example-plugin", "aws-lambda", "azure-functions", "openwhisk",
                "serverless-post-function", "ext-plugin-post-req", "ext-plugin-post-resp"
            ]
        }
        
        # Docker Compose configuration for APISIX
        docker_compose = {
            "version": "3.8",
            "services": {
                "apisix": {
                    "image": "apache/apisix:3.7.0-debian",
                    "restart": "always",
                    "volumes": [
                        "./apisix_conf/config.yaml:/usr/local/apisix/conf/config.yaml:ro"
                    ],
                    "depends_on": ["etcd"],
                    "ports": ["9080:9080", "9091:9091", "9443:9443", "9092:9092"],
                    "networks": ["apisix"]
                },
                "etcd": {
                    "image": "bitnami/etcd:3.4.15",
                    "restart": "always",
                    "volumes": ["etcd_data:/bitnami/etcd"],
                    "environment": [
                        "ETCD_ENABLE_V2=true",
                        "ALLOW_NONE_AUTHENTICATION=yes",
                        "ETCD_ADVERTISE_CLIENT_URLS=http://127.0.0.1:2379",
                        "ETCD_LISTEN_CLIENT_URLS=http://0.0.0.0:2379"
                    ],
                    "ports": ["2379:2379", "2380:2380"],
                    "networks": ["apisix"]
                },
                "apisix-dashboard": {
                    "image": "apache/apisix-dashboard:3.0.1-alpine",
                    "restart": "always",
                    "volumes": ["./dashboard_conf/conf.yaml:/usr/local/apisix-dashboard/conf/conf.yaml"],
                    "ports": ["9000:9000"],
                    "networks": ["apisix"]
                }
            },
            "networks": {
                "apisix": {
                    "driver": "bridge"
                }
            },
            "volumes": {
                "etcd_data": {"driver": "local"}
            }
        }
        
        return {
            "apisix_config": yaml.dump(apisix_config, default_flow_style=False),
            "docker_compose": yaml.dump(docker_compose, default_flow_style=False)
        }
    
    def deploy_configuration(self) -> bool:
        """Deploy complete APISIX configuration"""
        logger.info("🚀 Deploying APISIX API Gateway Configuration...")
        
        try:
            # Setup global plugins
            if not self.setup_global_plugins():
                return False
            
            # Setup banking routes
            if not self.setup_banking_routes():
                return False
            
            # Generate configuration files
            configs = self.generate_config_files()
            
            # Save configuration files
            with open("/tmp/apisix_config.yaml", "w") as f:
                f.write(configs["apisix_config"])
            
            with open("/tmp/docker-compose-apisix.yaml", "w") as f:
                f.write(configs["docker_compose"])
            
            logger.info("✅ APISIX configuration deployed successfully!")
            logger.info("📁 Configuration files saved to /tmp/")
            logger.info("🌐 API Gateway available at: http://localhost:9080")
            logger.info("📊 Dashboard available at: http://localhost:9000")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error deploying APISIX configuration: {str(e)}")
            return False

def main():
    """Main function to setup APISIX API Gateway"""
    print("🚀 Remittance Platform - APISIX API Gateway Setup")
    print("=" * 60)
    
    gateway = APISIXGatewayManager()
    
    if gateway.deploy_configuration():
        print("\n✅ APISIX API Gateway configured successfully!")
        print("\n📋 Next Steps:")
        print("1. Start APISIX: docker-compose -f /tmp/docker-compose-apisix.yaml up -d")
        print("2. Access API Gateway: http://localhost:9080")
        print("3. Access Dashboard: http://localhost:9000")
        print("4. Test routes: curl http://localhost:9080/api/v1/status")
    else:
        print("\n❌ Failed to configure APISIX API Gateway")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())

