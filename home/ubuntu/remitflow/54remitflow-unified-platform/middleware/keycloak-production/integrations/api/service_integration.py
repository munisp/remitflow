"""
Keycloak Service Integration
Integrates Keycloak with platform services (Mojaloop, Temporal, etc.)
"""

import httpx
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class KeycloakServiceClient:
    """Client for service-to-service authentication with Keycloak"""
    
    def __init__(
        self,
        keycloak_url: str,
        realm: str,
        client_id: str,
        client_secret: str
    ):
        """
        Initialize Keycloak service client
        
        Args:
            keycloak_url: Keycloak server URL
            realm: Realm name
            client_id: Client ID
            client_secret: Client secret
        """
        self.keycloak_url = keycloak_url
        self.realm = realm
        self.client_id = client_id
        self.client_secret = client_secret
        self.access_token = None
        self.token_expires_at = None
    
    async def get_access_token(self) -> str:
        """
        Get access token using client credentials flow
        
        Returns:
            Access token string
        """
        # Check if token is still valid
        if self.access_token and self.token_expires_at:
            if datetime.now() < self.token_expires_at - timedelta(seconds=60):
                return self.access_token
        
        # Request new token
        try:
            url = f"{self.keycloak_url}/realms/{self.realm}/protocol/openid-connect/token"
            data = {
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(url, data=data)
                response.raise_for_status()
                token_data = response.json()
                
                self.access_token = token_data["access_token"]
                expires_in = token_data.get("expires_in", 300)
                self.token_expires_at = datetime.now() + timedelta(seconds=expires_in)
                
                logger.info(f"Access token obtained for client {self.client_id}")
                return self.access_token
                
        except Exception as e:
            logger.error(f"Failed to get access token: {e}")
            raise
    
    async def refresh_token(self, refresh_token: str) -> Dict[str, Any]:
        """
        Refresh access token using refresh token
        
        Args:
            refresh_token: Refresh token string
            
        Returns:
            Token response
        """
        try:
            url = f"{self.keycloak_url}/realms/{self.realm}/protocol/openid-connect/token"
            data = {
                "grant_type": "refresh_token",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": refresh_token
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(url, data=data)
                response.raise_for_status()
                return response.json()
                
        except Exception as e:
            logger.error(f"Failed to refresh token: {e}")
            raise
    
    async def create_authenticated_client(self, base_url: str) -> httpx.AsyncClient:
        """
        Create HTTP client with authentication
        
        Args:
            base_url: Base URL for the service
            
        Returns:
            Authenticated HTTP client
        """
        token = await self.get_access_token()
        
        client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {token}"}
        )
        
        return client


class MojaloopKeycloakIntegration:
    """Integration between Mojaloop and Keycloak"""
    
    def __init__(self):
        self.keycloak_client = KeycloakServiceClient(
            keycloak_url=os.getenv("KEYCLOAK_URL", "http://localhost:8080"),
            realm=os.getenv("KEYCLOAK_REALM", "remittance"),
            client_id=os.getenv("MOJALOOP_CLIENT_ID", "mojaloop-service"),
            client_secret=os.getenv("MOJALOOP_CLIENT_SECRET", "")
        )
    
    async def authenticate_mojaloop_request(self) -> str:
        """
        Authenticate Mojaloop service request
        
        Returns:
            Access token for Mojaloop
        """
        return await self.keycloak_client.get_access_token()
    
    async def create_mojaloop_client(self, mojaloop_url: str) -> httpx.AsyncClient:
        """
        Create authenticated Mojaloop HTTP client
        
        Args:
            mojaloop_url: Mojaloop service URL
            
        Returns:
            Authenticated HTTP client
        """
        return await self.keycloak_client.create_authenticated_client(mojaloop_url)


class TemporalKeycloakIntegration:
    """Integration between Temporal and Keycloak"""
    
    def __init__(self):
        self.keycloak_client = KeycloakServiceClient(
            keycloak_url=os.getenv("KEYCLOAK_URL", "http://localhost:8080"),
            realm=os.getenv("KEYCLOAK_REALM", "remittance"),
            client_id=os.getenv("TEMPORAL_CLIENT_ID", "temporal-service"),
            client_secret=os.getenv("TEMPORAL_CLIENT_SECRET", "")
        )
    
    async def authenticate_temporal_request(self) -> str:
        """
        Authenticate Temporal service request
        
        Returns:
            Access token for Temporal
        """
        return await self.keycloak_client.get_access_token()
    
    async def create_temporal_client(self, temporal_url: str) -> httpx.AsyncClient:
        """
        Create authenticated Temporal HTTP client
        
        Args:
            temporal_url: Temporal service URL
            
        Returns:
            Authenticated HTTP client
        """
        return await self.keycloak_client.create_authenticated_client(temporal_url)


class PermifyKeycloakIntegration:
    """Integration between Permify and Keycloak"""
    
    def __init__(self):
        self.keycloak_url = os.getenv("KEYCLOAK_URL", "http://localhost:8080")
        self.realm = os.getenv("KEYCLOAK_REALM", "remittance")
    
    async def sync_roles_to_permify(self, user_id: str, roles: list):
        """
        Sync Keycloak roles to Permify
        
        Args:
            user_id: User ID
            roles: List of roles
        """
        # Implementation to sync roles to Permify
        logger.info(f"Syncing roles for user {user_id}: {roles}")
        # This would call Permify API to update user permissions
    
    async def sync_user_to_permify(self, user_data: Dict[str, Any]):
        """
        Sync Keycloak user to Permify
        
        Args:
            user_data: User data from Keycloak
        """
        logger.info(f"Syncing user to Permify: {user_data.get('username')}")
        # This would call Permify API to create/update user


# Example usage
async def example_usage():
    """Example of using service integrations"""
    
    # Mojaloop integration
    mojaloop_integration = MojaloopKeycloakIntegration()
    mojaloop_token = await mojaloop_integration.authenticate_mojaloop_request()
    logger.info(f"Mojaloop token: {mojaloop_token[:20]}...")
    
    # Temporal integration
    temporal_integration = TemporalKeycloakIntegration()
    temporal_token = await temporal_integration.authenticate_temporal_request()
    logger.info(f"Temporal token: {temporal_token[:20]}...")
    
    # Permify integration
    permify_integration = PermifyKeycloakIntegration()
    await permify_integration.sync_roles_to_permify(
        user_id="user123",
        roles=["admin", "operator"]
    )


if __name__ == "__main__":
    import asyncio
    asyncio.run(example_usage())

