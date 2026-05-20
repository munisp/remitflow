#!/usr/bin/env python3
"""
APISIX Security Plugins Configuration
Implements authentication, authorization, and security features
"""

import requests
import json
import logging
from typing import Dict, List, Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SecurityPluginConfigurator:
    """Configure APISIX security plugins"""
    
    def __init__(self, admin_url: str = "http://localhost:9180", admin_key: str = "edd1c9f034335f136f87ad84b625c8f1"):
        self.admin_url = admin_url
        self.headers = {
            "X-API-KEY": admin_key,
            "Content-Type": "application/json"
        }
    
    def configure_keycloak_plugin(self):
        """Configure OpenID Connect plugin for Keycloak integration"""
        # Configure global plugin for Keycloak authentication
        plugin_config = {
            "openid-connect": {
                "client_id": "remittance-backend-api",
                "client_secret": "${KEYCLOAK_CLIENT_SECRET}",
                "discovery": "http://keycloak:8080/realms/remittance/.well-known/openid-configuration",
                "scope": "openid profile email",
                "bearer_only": True,
                "realm": "remittance",
                "introspection_endpoint_auth_method": "client_secret_post",
                "redirect_uri": "http://localhost:9080/callback"
            }
        }
        
        logger.info("Keycloak OpenID Connect plugin configured")
        return plugin_config
    
    def configure_jwt_auth(self):
        """Configure JWT authentication plugin"""
        jwt_config = {
            "jwt-auth": {
                "key": "remittance-jwt-key",
                "secret": "${JWT_SECRET}",
                "algorithm": "HS256",
                "exp": 86400  # 24 hours
            }
        }
        
        logger.info("JWT authentication plugin configured")
        return jwt_config
    
    def configure_api_key_auth(self):
        """Configure API key authentication plugin"""
        api_key_config = {
            "key-auth": {
                "key": "apikey"
            }
        }
        
        logger.info("API key authentication plugin configured")
        return api_key_config
    
    def configure_cors(self):
        """Configure CORS plugin"""
        cors_config = {
            "cors": {
                "allow_origins": "*",
                "allow_methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
                "allow_headers": "Authorization,Content-Type,X-Requested-With,X-API-KEY",
                "expose_headers": "X-Total-Count,X-Request-Id",
                "max_age": 3600,
                "allow_credential": True
            }
        }
        
        logger.info("CORS plugin configured")
        return cors_config
    
    def configure_ip_restriction(self):
        """Configure IP restriction plugin"""
        ip_config = {
            "ip-restriction": {
                "whitelist": [
                    "127.0.0.1",
                    "10.0.0.0/8",
                    "172.16.0.0/12",
                    "192.168.0.0/16"
                ]
            }
        }
        
        logger.info("IP restriction plugin configured")
        return ip_config
    
    def configure_csrf(self):
        """Configure CSRF protection plugin"""
        csrf_config = {
            "csrf": {
                "key": "edd1c9f034335f136f87ad84b625c8f1"
            }
        }
        
        logger.info("CSRF protection plugin configured")
        return csrf_config
    
    def configure_request_validation(self):
        """Configure request validation plugin"""
        validation_config = {
            "request-validation": {
                "body_schema": {
                    "type": "object",
                    "properties": {
                        "amount": {
                            "type": "number",
                            "minimum": 0
                        },
                        "currency": {
                            "type": "string",
                            "enum": ["NGN", "USD", "EUR", "GBP", "CNY"]
                        }
                    }
                }
            }
        }
        
        logger.info("Request validation plugin configured")
        return validation_config
    
    def apply_security_to_route(self, route_id: str, security_plugins: List[str]):
        """Apply security plugins to a specific route"""
        url = f"{self.admin_url}/apisix/admin/routes/{route_id}"
        
        try:
            # Get current route configuration
            response = requests.get(url, headers=self.headers)
            response.raise_for_status()
            route_config = response.json()
            
            # Add security plugins
            if "plugins" not in route_config:
                route_config["plugins"] = {}
            
            for plugin_name in security_plugins:
                if plugin_name == "openid-connect":
                    route_config["plugins"]["openid-connect"] = self.configure_keycloak_plugin()["openid-connect"]
                elif plugin_name == "jwt-auth":
                    route_config["plugins"]["jwt-auth"] = self.configure_jwt_auth()["jwt-auth"]
                elif plugin_name == "key-auth":
                    route_config["plugins"]["key-auth"] = self.configure_api_key_auth()["key-auth"]
                elif plugin_name == "cors":
                    route_config["plugins"]["cors"] = self.configure_cors()["cors"]
                elif plugin_name == "ip-restriction":
                    route_config["plugins"]["ip-restriction"] = self.configure_ip_restriction()["ip-restriction"]
                elif plugin_name == "csrf":
                    route_config["plugins"]["csrf"] = self.configure_csrf()["csrf"]
            
            # Update route
            response = requests.put(url, headers=self.headers, json=route_config)
            response.raise_for_status()
            
            logger.info(f"Security plugins applied to route '{route_id}'")
            return True
            
        except Exception as e:
            logger.error(f"Failed to apply security plugins to route '{route_id}': {e}")
            return False
    
    def configure_all_security(self):
        """Configure all security plugins for all routes"""
        logger.info("Configuring security plugins...")
        
        # Define security requirements for each route
        route_security = {
            "payment": ["openid-connect", "cors", "csrf"],
            "kyc": ["openid-connect", "cors"],
            "fraud": ["jwt-auth", "cors"],
            "compliance": ["openid-connect", "cors"],
            "mojaloop": ["jwt-auth", "cors", "ip-restriction"],
            "temporal": ["jwt-auth", "cors"],
            "frontend": ["cors"]
        }
        
        for route_id, plugins in route_security.items():
            self.apply_security_to_route(route_id, plugins)
        
        logger.info("Security configuration completed")


def main():
    """Main function"""
    configurator = SecurityPluginConfigurator()
    configurator.configure_all_security()


if __name__ == "__main__":
    main()

