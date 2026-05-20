#!/usr/bin/env python3
"""
APISIX Routes Configuration Script
Configures all routes and upstreams for the Nigerian Remittance Platform
"""

import requests
import json
import logging
from typing import Dict, List, Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class APISIXConfigurator:
    """Configure APISIX routes and upstreams"""
    
    def __init__(self, admin_url: str = "http://localhost:9180", admin_key: str = "edd1c9f034335f136f87ad84b625c8f1"):
        self.admin_url = admin_url
        self.headers = {
            "X-API-KEY": admin_key,
            "Content-Type": "application/json"
        }
    
    def create_upstream(self, upstream_id: str, config: Dict[str, Any]) -> bool:
        """Create or update an upstream"""
        url = f"{self.admin_url}/apisix/admin/upstreams/{upstream_id}"
        try:
            response = requests.put(url, headers=self.headers, json=config)
            response.raise_for_status()
            logger.info(f"Upstream '{upstream_id}' configured successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to configure upstream '{upstream_id}': {e}")
            return False
    
    def create_route(self, route_id: str, config: Dict[str, Any]) -> bool:
        """Create or update a route"""
        url = f"{self.admin_url}/apisix/admin/routes/{route_id}"
        try:
            response = requests.put(url, headers=self.headers, json=config)
            response.raise_for_status()
            logger.info(f"Route '{route_id}' configured successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to configure route '{route_id}': {e}")
            return False
    
    def configure_all(self):
        """Configure all upstreams and routes"""
        logger.info("Starting APISIX configuration...")
        
        # Configure upstreams
        upstreams = self.get_upstreams_config()
        for upstream_id, config in upstreams.items():
            self.create_upstream(upstream_id, config)
        
        # Configure routes
        routes = self.get_routes_config()
        for route_id, config in routes.items():
            self.create_route(route_id, config)
        
        logger.info("APISIX configuration completed")
    
    def get_upstreams_config(self) -> Dict[str, Dict]:
        """Get all upstream configurations"""
        return {
            # Keycloak upstream
            "keycloak": {
                "name": "keycloak-upstream",
                "type": "roundrobin",
                "nodes": {
                    "keycloak:8080": 1
                },
                "timeout": {
                    "connect": 6,
                    "send": 6,
                    "read": 6
                },
                "retries": 2,
                "checks": {
                    "active": {
                        "type": "http",
                        "http_path": "/health",
                        "healthy": {
                            "interval": 10,
                            "successes": 2
                        },
                        "unhealthy": {
                            "interval": 5,
                            "http_failures": 3
                        }
                    }
                }
            },
            
            # Mojaloop upstream
            "mojaloop": {
                "name": "mojaloop-upstream",
                "type": "roundrobin",
                "nodes": {
                    "mojaloop:8080": 1
                },
                "timeout": {
                    "connect": 30,
                    "send": 30,
                    "read": 30
                },
                "retries": 3,
                "checks": {
                    "active": {
                        "type": "http",
                        "http_path": "/health",
                        "healthy": {
                            "interval": 10,
                            "successes": 2
                        },
                        "unhealthy": {
                            "interval": 5,
                            "http_failures": 3
                        }
                    }
                }
            },
            
            # Payment Processing upstream
            "payment": {
                "name": "payment-upstream",
                "type": "roundrobin",
                "nodes": {
                    "payment-service:8080": 1
                },
                "timeout": {
                    "connect": 10,
                    "send": 10,
                    "read": 10
                },
                "retries": 2
            },
            
            # KYC Service upstream
            "kyc": {
                "name": "kyc-upstream",
                "type": "roundrobin",
                "nodes": {
                    "kyc-service:8080": 1
                },
                "timeout": {
                    "connect": 10,
                    "send": 10,
                    "read": 10
                },
                "retries": 2
            },
            
            # Fraud Detection upstream
            "fraud": {
                "name": "fraud-upstream",
                "type": "roundrobin",
                "nodes": {
                    "fraud-service:8080": 1
                },
                "timeout": {
                    "connect": 5,
                    "send": 5,
                    "read": 5
                },
                "retries": 1
            },
            
            # Compliance Service upstream
            "compliance": {
                "name": "compliance-upstream",
                "type": "roundrobin",
                "nodes": {
                    "compliance-service:8080": 1
                },
                "timeout": {
                    "connect": 10,
                    "send": 10,
                    "read": 10
                },
                "retries": 2
            },
            
            # Temporal upstream
            "temporal": {
                "name": "temporal-upstream",
                "type": "roundrobin",
                "nodes": {
                    "temporal:7233": 1
                },
                "timeout": {
                    "connect": 10,
                    "send": 10,
                    "read": 10
                },
                "retries": 2
            },
            
            # Frontend upstream
            "frontend": {
                "name": "frontend-upstream",
                "type": "roundrobin",
                "nodes": {
                    "frontend:3000": 1
                },
                "timeout": {
                    "connect": 5,
                    "send": 5,
                    "read": 5
                },
                "retries": 1
            }
        }
    
    def get_routes_config(self) -> Dict[str, Dict]:
        """Get all route configurations"""
        return {
            # Authentication routes (Keycloak)
            "auth": {
                "name": "Authentication API",
                "uri": "/auth/*",
                "methods": ["GET", "POST", "PUT", "DELETE"],
                "upstream_id": "keycloak",
                "plugins": {
                    "cors": {
                        "allow_origins": "*",
                        "allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
                        "allow_headers": "*",
                        "max_age": 3600
                    },
                    "prometheus": {}
                }
            },
            
            # Mojaloop routes
            "mojaloop": {
                "name": "Mojaloop Central Switch",
                "uri": "/mojaloop/*",
                "methods": ["GET", "POST", "PUT", "DELETE"],
                "upstream_id": "mojaloop",
                "plugins": {
                    "cors": {},
                    "prometheus": {},
                    "limit-req": {
                        "rate": 100,
                        "burst": 50,
                        "key": "remote_addr",
                        "rejected_code": 429
                    }
                }
            },
            
            # Payment routes
            "payment": {
                "name": "Payment Processing API",
                "uri": "/api/v1/payments/*",
                "methods": ["GET", "POST", "PUT", "DELETE"],
                "upstream_id": "payment",
                "plugins": {
                    "cors": {},
                    "prometheus": {},
                    "limit-req": {
                        "rate": 200,
                        "burst": 100,
                        "key": "remote_addr"
                    }
                }
            },
            
            # KYC routes
            "kyc": {
                "name": "KYC Verification API",
                "uri": "/api/v1/kyc/*",
                "methods": ["GET", "POST", "PUT", "DELETE"],
                "upstream_id": "kyc",
                "plugins": {
                    "cors": {},
                    "prometheus": {},
                    "limit-req": {
                        "rate": 50,
                        "burst": 25,
                        "key": "remote_addr"
                    }
                }
            },
            
            # Fraud detection routes
            "fraud": {
                "name": "Fraud Detection API",
                "uri": "/api/v1/fraud/*",
                "methods": ["GET", "POST"],
                "upstream_id": "fraud",
                "plugins": {
                    "cors": {},
                    "prometheus": {},
                    "limit-req": {
                        "rate": 500,
                        "burst": 250,
                        "key": "remote_addr"
                    }
                }
            },
            
            # Compliance routes
            "compliance": {
                "name": "Compliance API",
                "uri": "/api/v1/compliance/*",
                "methods": ["GET", "POST", "PUT"],
                "upstream_id": "compliance",
                "plugins": {
                    "cors": {},
                    "prometheus": {}
                }
            },
            
            # Temporal routes
            "temporal": {
                "name": "Temporal Workflow API",
                "uri": "/temporal/*",
                "methods": ["GET", "POST"],
                "upstream_id": "temporal",
                "plugins": {
                    "cors": {},
                    "prometheus": {}
                }
            },
            
            # Frontend routes
            "frontend": {
                "name": "Frontend Application",
                "uri": "/*",
                "methods": ["GET"],
                "upstream_id": "frontend",
                "priority": -1,  # Lowest priority (catch-all)
                "plugins": {
                    "cors": {},
                    "prometheus": {},
                    "proxy-cache": {
                        "cache_ttl": 300,
                        "cache_bypass": ["$arg_nocache"]
                    }
                }
            }
        }


def main():
    """Main function"""
    configurator = APISIXConfigurator()
    configurator.configure_all()


if __name__ == "__main__":
    main()

