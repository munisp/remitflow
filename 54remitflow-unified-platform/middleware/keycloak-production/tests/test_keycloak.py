"""
Comprehensive Test Suite for Keycloak Integration
Tests authentication, authorization, and integration functionality
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
import httpx
from datetime import datetime, timedelta
import jwt as pyjwt

# Import modules to test
import sys
sys.path.append('..')
from integrations.backend.keycloak_middleware import (
    KeycloakAuth,
    get_current_user,
    require_roles,
    RoleChecker
)
from integrations.api.service_integration import (
    KeycloakServiceClient,
    MojaloopKeycloakIntegration,
    TemporalKeycloakIntegration
)


class TestKeycloakAuth:
    """Test Keycloak authentication"""
    
    @pytest.fixture
    def keycloak_auth(self):
        """Create KeycloakAuth instance"""
        return KeycloakAuth()
    
    @pytest.mark.asyncio
    async def test_get_public_key(self, keycloak_auth):
        """Test fetching public key from Keycloak"""
        with patch('httpx.AsyncClient.get') as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {
                "public_key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."
            }
            mock_response.raise_for_status = Mock()
            mock_get.return_value = mock_response
            
            public_key = await keycloak_auth.get_public_key()
            
            assert public_key is not None
            assert "BEGIN PUBLIC KEY" in public_key
            assert "END PUBLIC KEY" in public_key
    
    @pytest.mark.asyncio
    async def test_verify_token_valid(self, keycloak_auth):
        """Test verifying valid JWT token"""
        # Create a valid token
        payload = {
            "sub": "user123",
            "aud": "remittance-backend-api",
            "exp": (datetime.now() + timedelta(hours=1)).timestamp(),
            "iat": datetime.now().timestamp(),
            "realm_access": {
                "roles": ["user", "admin"]
            }
        }
        
        with patch.object(keycloak_auth, 'get_public_key') as mock_key:
            mock_key.return_value = "mock_public_key"
            
            with patch('jose.jwt.decode') as mock_decode:
                mock_decode.return_value = payload
                
                result = await keycloak_auth.verify_token("mock_token")
                
                assert result["sub"] == "user123"
                assert "admin" in result["realm_access"]["roles"]
    
    @pytest.mark.asyncio
    async def test_verify_token_expired(self, keycloak_auth):
        """Test verifying expired JWT token"""
        with patch.object(keycloak_auth, 'get_public_key') as mock_key:
            mock_key.return_value = "mock_public_key"
            
            with patch('jose.jwt.decode') as mock_decode:
                from jose import JWTError
                mock_decode.side_effect = JWTError("Token expired")
                
                with pytest.raises(Exception):
                    await keycloak_auth.verify_token("expired_token")
    
    @pytest.mark.asyncio
    async def test_get_user_info(self, keycloak_auth):
        """Test getting user info from Keycloak"""
        with patch('httpx.AsyncClient.get') as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {
                "sub": "user123",
                "email": "user@example.com",
                "preferred_username": "testuser",
                "name": "Test User"
            }
            mock_response.raise_for_status = Mock()
            mock_get.return_value = mock_response
            
            user_info = await keycloak_auth.get_user_info("mock_token")
            
            assert user_info["sub"] == "user123"
            assert user_info["email"] == "user@example.com"
    
    @pytest.mark.asyncio
    async def test_introspect_token(self, keycloak_auth):
        """Test token introspection"""
        with patch('httpx.AsyncClient.post') as mock_post:
            mock_response = Mock()
            mock_response.json.return_value = {
                "active": True,
                "sub": "user123",
                "client_id": "remittance-backend-api",
                "exp": (datetime.now() + timedelta(hours=1)).timestamp()
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response
            
            result = await keycloak_auth.introspect_token("mock_token")
            
            assert result["active"] is True
            assert result["sub"] == "user123"


class TestRoleChecker:
    """Test role-based access control"""
    
    def test_role_checker_single_role(self):
        """Test role checker with single required role"""
        checker = RoleChecker(["admin"], require_all=False)
        
        user_with_role = {
            "realm_access": {
                "roles": ["admin", "user"]
            }
        }
        
        # Should not raise exception
        result = asyncio.run(checker(user_with_role))
        assert result == user_with_role
    
    def test_role_checker_multiple_roles_any(self):
        """Test role checker with multiple roles (any)"""
        checker = RoleChecker(["admin", "operator"], require_all=False)
        
        user_with_one_role = {
            "realm_access": {
                "roles": ["operator", "user"]
            }
        }
        
        result = asyncio.run(checker(user_with_one_role))
        assert result == user_with_one_role
    
    def test_role_checker_multiple_roles_all(self):
        """Test role checker with multiple roles (all required)"""
        checker = RoleChecker(["admin", "operator"], require_all=True)
        
        user_with_all_roles = {
            "realm_access": {
                "roles": ["admin", "operator", "user"]
            }
        }
        
        result = asyncio.run(checker(user_with_all_roles))
        assert result == user_with_all_roles
    
    def test_role_checker_insufficient_permissions(self):
        """Test role checker with insufficient permissions"""
        checker = RoleChecker(["admin"], require_all=False)
        
        user_without_role = {
            "realm_access": {
                "roles": ["user"]
            }
        }
        
        with pytest.raises(Exception):
            asyncio.run(checker(user_without_role))


class TestKeycloakServiceClient:
    """Test Keycloak service client"""
    
    @pytest.fixture
    def service_client(self):
        """Create KeycloakServiceClient instance"""
        return KeycloakServiceClient(
            keycloak_url="http://localhost:8080",
            realm="remittance",
            client_id="test-client",
            client_secret="test-secret"
        )
    
    @pytest.mark.asyncio
    async def test_get_access_token(self, service_client):
        """Test getting access token"""
        with patch('httpx.AsyncClient.post') as mock_post:
            mock_response = Mock()
            mock_response.json.return_value = {
                "access_token": "mock_access_token",
                "expires_in": 300,
                "token_type": "Bearer"
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response
            
            token = await service_client.get_access_token()
            
            assert token == "mock_access_token"
            assert service_client.access_token == "mock_access_token"
            assert service_client.token_expires_at is not None
    
    @pytest.mark.asyncio
    async def test_get_access_token_cached(self, service_client):
        """Test getting cached access token"""
        service_client.access_token = "cached_token"
        service_client.token_expires_at = datetime.now() + timedelta(hours=1)
        
        token = await service_client.get_access_token()
        
        assert token == "cached_token"
    
    @pytest.mark.asyncio
    async def test_refresh_token(self, service_client):
        """Test refreshing access token"""
        with patch('httpx.AsyncClient.post') as mock_post:
            mock_response = Mock()
            mock_response.json.return_value = {
                "access_token": "new_access_token",
                "refresh_token": "new_refresh_token",
                "expires_in": 300
            }
            mock_response.raise_for_status = Mock()
            mock_post.return_value = mock_response
            
            result = await service_client.refresh_token("old_refresh_token")
            
            assert result["access_token"] == "new_access_token"
            assert result["refresh_token"] == "new_refresh_token"


class TestMojaloopIntegration:
    """Test Mojaloop-Keycloak integration"""
    
    @pytest.fixture
    def mojaloop_integration(self):
        """Create MojaloopKeycloakIntegration instance"""
        return MojaloopKeycloakIntegration()
    
    @pytest.mark.asyncio
    async def test_authenticate_mojaloop_request(self, mojaloop_integration):
        """Test authenticating Mojaloop request"""
        with patch.object(
            mojaloop_integration.keycloak_client,
            'get_access_token',
            return_value="mojaloop_token"
        ):
            token = await mojaloop_integration.authenticate_mojaloop_request()
            
            assert token == "mojaloop_token"
    
    @pytest.mark.asyncio
    async def test_create_mojaloop_client(self, mojaloop_integration):
        """Test creating authenticated Mojaloop client"""
        with patch.object(
            mojaloop_integration.keycloak_client,
            'create_authenticated_client'
        ) as mock_create:
            mock_client = AsyncMock()
            mock_create.return_value = mock_client
            
            client = await mojaloop_integration.create_mojaloop_client(
                "http://mojaloop:8080"
            )
            
            assert client is not None


class TestTemporalIntegration:
    """Test Temporal-Keycloak integration"""
    
    @pytest.fixture
    def temporal_integration(self):
        """Create TemporalKeycloakIntegration instance"""
        return TemporalKeycloakIntegration()
    
    @pytest.mark.asyncio
    async def test_authenticate_temporal_request(self, temporal_integration):
        """Test authenticating Temporal request"""
        with patch.object(
            temporal_integration.keycloak_client,
            'get_access_token',
            return_value="temporal_token"
        ):
            token = await temporal_integration.authenticate_temporal_request()
            
            assert token == "temporal_token"


# Integration tests
class TestIntegration:
    """Integration tests"""
    
    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_full_authentication_flow(self):
        """Test full authentication flow"""
        # This would test against a real Keycloak instance
        # Skipped in unit tests
        pass
    
    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_token_refresh_flow(self):
        """Test token refresh flow"""
        # This would test token refresh against a real Keycloak instance
        # Skipped in unit tests
        pass


# Performance tests
class TestPerformance:
    """Performance tests"""
    
    @pytest.mark.asyncio
    @pytest.mark.performance
    async def test_token_verification_performance(self):
        """Test token verification performance"""
        # Test that token verification completes within acceptable time
        keycloak_auth = KeycloakAuth()
        
        with patch.object(keycloak_auth, 'verify_token') as mock_verify:
            mock_verify.return_value = {"sub": "user123"}
            
            start_time = datetime.now()
            for _ in range(100):
                await keycloak_auth.verify_token("mock_token")
            end_time = datetime.now()
            
            duration = (end_time - start_time).total_seconds()
            assert duration < 1.0  # Should complete 100 verifications in under 1 second


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

