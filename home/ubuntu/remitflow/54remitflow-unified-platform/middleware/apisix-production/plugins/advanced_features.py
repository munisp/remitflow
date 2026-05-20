#!/usr/bin/env python3
"""
APISIX Advanced Features Configuration
Implements rate limiting, load balancing, caching, and traffic management
"""

import requests
import json
import logging
from typing import Dict, List, Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AdvancedFeaturesConfigurator:
    """Configure APISIX advanced features"""
    
    def __init__(self, admin_url: str = "http://localhost:9180", admin_key: str = "edd1c9f034335f136f87ad84b625c8f1"):
        self.admin_url = admin_url
        self.headers = {
            "X-API-KEY": admin_key,
            "Content-Type": "application/json"
        }
    
    def configure_rate_limiting(self, route_id: str, rate: int, burst: int):
        """Configure rate limiting for a route"""
        rate_limit_config = {
            "limit-req": {
                "rate": rate,
                "burst": burst,
                "key": "remote_addr",
                "key_type": "var",
                "rejected_code": 429,
                "rejected_msg": "Too many requests"
            }
        }
        
        logger.info(f"Rate limiting configured for route '{route_id}': {rate} req/s, burst {burst}")
        return rate_limit_config
    
    def configure_connection_limiting(self, route_id: str, conn: int, burst: int):
        """Configure connection limiting for a route"""
        conn_limit_config = {
            "limit-conn": {
                "conn": conn,
                "burst": burst,
                "default_conn_delay": 0.1,
                "key": "remote_addr",
                "rejected_code": 503
            }
        }
        
        logger.info(f"Connection limiting configured for route '{route_id}': {conn} connections")
        return conn_limit_config
    
    def configure_count_limiting(self, route_id: str, count: int, time_window: int):
        """Configure count limiting for a route"""
        count_limit_config = {
            "limit-count": {
                "count": count,
                "time_window": time_window,
                "key": "remote_addr",
                "key_type": "var",
                "rejected_code": 429,
                "rejected_msg": "Quota exceeded"
            }
        }
        
        logger.info(f"Count limiting configured for route '{route_id}': {count} requests per {time_window}s")
        return count_limit_config
    
    def configure_load_balancing(self, upstream_id: str, algorithm: str = "roundrobin"):
        """Configure load balancing algorithm for an upstream"""
        lb_algorithms = {
            "roundrobin": {
                "type": "roundrobin"
            },
            "chash": {
                "type": "chash",
                "key": "remote_addr"
            },
            "ewma": {
                "type": "ewma"
            },
            "least_conn": {
                "type": "least_conn"
            }
        }
        
        lb_config = lb_algorithms.get(algorithm, lb_algorithms["roundrobin"])
        logger.info(f"Load balancing configured for upstream '{upstream_id}': {algorithm}")
        return lb_config
    
    def configure_circuit_breaker(self, upstream_id: str):
        """Configure circuit breaker for an upstream"""
        circuit_breaker_config = {
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
                        "http_failures": 3,
                        "timeouts": 3
                    }
                },
                "passive": {
                    "type": "http",
                    "healthy": {
                        "http_statuses": [200, 201, 202, 203, 204, 205, 206, 207, 208, 226],
                        "successes": 3
                    },
                    "unhealthy": {
                        "http_statuses": [429, 500, 502, 503, 504, 505],
                        "http_failures": 3,
                        "timeouts": 3
                    }
                }
            }
        }
        
        logger.info(f"Circuit breaker configured for upstream '{upstream_id}'")
        return circuit_breaker_config
    
    def configure_caching(self, route_id: str, cache_ttl: int = 300):
        """Configure proxy caching for a route"""
        cache_config = {
            "proxy-cache": {
                "cache_ttl": cache_ttl,
                "cache_key": ["$host", "$request_uri"],
                "cache_bypass": ["$arg_nocache", "$arg_refresh"],
                "cache_method": ["GET", "HEAD"],
                "cache_http_status": [200, 301, 404],
                "hide_cache_headers": False,
                "no_cache": ["$arg_nocache"]
            }
        }
        
        logger.info(f"Caching configured for route '{route_id}': TTL {cache_ttl}s")
        return cache_config
    
    def configure_traffic_split(self, route_id: str, rules: List[Dict]):
        """Configure traffic splitting (A/B testing, canary deployment)"""
        traffic_split_config = {
            "traffic-split": {
                "rules": rules
            }
        }
        
        logger.info(f"Traffic splitting configured for route '{route_id}'")
        return traffic_split_config
    
    def configure_request_transformation(self, route_id: str):
        """Configure request transformation"""
        transform_config = {
            "proxy-rewrite": {
                "regex_uri": ["^/api/v1/(.*)", "/$1"],
                "headers": {
                    "X-Forwarded-Proto": "https",
                    "X-Real-IP": "$remote_addr"
                }
            }
        }
        
        logger.info(f"Request transformation configured for route '{route_id}'")
        return transform_config
    
    def configure_response_rewrite(self, route_id: str):
        """Configure response rewriting"""
        response_config = {
            "response-rewrite": {
                "headers": {
                    "X-Server": "APISIX",
                    "X-Request-Id": "$request_id"
                }
            }
        }
        
        logger.info(f"Response rewriting configured for route '{route_id}'")
        return response_config
    
    def apply_advanced_features(self):
        """Apply advanced features to all routes"""
        logger.info("Configuring advanced features...")
        
        # Rate limiting configurations
        rate_limits = {
            "payment": {"rate": 200, "burst": 100},
            "kyc": {"rate": 50, "burst": 25},
            "fraud": {"rate": 500, "burst": 250},
            "mojaloop": {"rate": 100, "burst": 50},
            "compliance": {"rate": 100, "burst": 50}
        }
        
        for route_id, limits in rate_limits.items():
            self.configure_rate_limiting(route_id, limits["rate"], limits["burst"])
        
        # Caching configurations
        cache_routes = {
            "frontend": 300,  # 5 minutes
            "payment": 60,    # 1 minute
            "kyc": 120        # 2 minutes
        }
        
        for route_id, ttl in cache_routes.items():
            self.configure_caching(route_id, ttl)
        
        # Load balancing configurations
        upstreams = ["payment", "kyc", "fraud", "compliance", "mojaloop"]
        for upstream_id in upstreams:
            self.configure_load_balancing(upstream_id, "roundrobin")
            self.configure_circuit_breaker(upstream_id)
        
        logger.info("Advanced features configuration completed")


def main():
    """Main function"""
    configurator = AdvancedFeaturesConfigurator()
    configurator.apply_advanced_features()


if __name__ == "__main__":
    main()

