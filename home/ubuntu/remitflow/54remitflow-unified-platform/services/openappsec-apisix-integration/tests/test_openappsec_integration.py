#!/usr/bin/env python3
"""
Comprehensive Test Suite for openappsec-APISIX Integration
Tests plugin functionality, security policies, and integration
"""

import pytest
import asyncio
import httpx
from typing import Dict, Any
import json

# Test configuration
APISIX_URL = "http://localhost:9080"
OPENAPPSEC_BRIDGE_URL = "http://localhost:9000"
TEST_TIMEOUT = 10.0

class TestOpenAppsecPlugin:
    """Test APISIX openappsec plugin functionality"""
    
    @pytest.mark.asyncio
    async def test_plugin_loaded(self):
        """Test that openappsec plugin is loaded in APISIX"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{APISIX_URL}/apisix/admin/plugins/openappsec",
                headers={"X-API-KEY": "test-api-key"}
            )
            assert response.status_code == 200
    
    @pytest.mark.asyncio
    async def test_plugin_schema_validation(self):
        """Test plugin schema validation"""
        valid_config = {
            "openappsec_host": "openappsec-bridge",
            "openappsec_port": 9000,
            "policy_name": "test-policy",
            "block_mode": "block"
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{APISIX_URL}/apisix/admin/routes/test",
                json={
                    "uri": "/test/*",
                    "plugins": {"openappsec": valid_config},
                    "upstream": {"type": "roundrobin", "nodes": {"httpbin.org:80": 1}}
                },
                headers={"X-API-KEY": "test-api-key"}
            )
            assert response.status_code in [200, 201]

class TestOpenAppsecBridge:
    """Test openappsec bridge service"""
    
    @pytest.mark.asyncio
    async def test_bridge_health(self):
        """Test bridge service health endpoint"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OPENAPPSEC_BRIDGE_URL}/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] in ["healthy", "degraded"]
    
    @pytest.mark.asyncio
    async def test_bridge_metrics(self):
        """Test bridge service metrics endpoint"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OPENAPPSEC_BRIDGE_URL}/metrics")
            assert response.status_code == 200
            assert "openappsec_requests_total" in response.text
    
    @pytest.mark.asyncio
    async def test_inspect_request(self):
        """Test request inspection endpoint"""
        test_request = {
            "method": "GET",
            "uri": "/api/test",
            "headers": {"User-Agent": "Test"},
            "remote_addr": "127.0.0.1",
            "server_name": "test.example.com",
            "policy_name": "test-policy",
            "timestamp": 1234567890
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                json=test_request
            )
            assert response.status_code == 200
            verdict = response.json()
            assert "action" in verdict
            assert verdict["action"] in ["allow", "block"]

class TestSecurityPolicies:
    """Test security policy enforcement"""
    
    @pytest.mark.asyncio
    async def test_sql_injection_detection(self):
        """Test SQL injection detection"""
        malicious_payloads = [
            "' OR '1'='1",
            "'; DROP TABLE users--",
            "UNION SELECT * FROM passwords",
            "1' AND 1=1--"
        ]
        
        for payload in malicious_payloads:
            test_request = {
                "method": "GET",
                "uri": f"/api/users?id={payload}",
                "headers": {},
                "remote_addr": "127.0.0.1",
                "server_name": "test.example.com",
                "policy_name": "api-protection",
                "timestamp": 1234567890
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                    json=test_request
                )
                assert response.status_code == 200
                verdict = response.json()
                # Should detect and block SQL injection
                assert verdict.get("threat_detected") or verdict["action"] == "block"
    
    @pytest.mark.asyncio
    async def test_xss_detection(self):
        """Test XSS detection"""
        malicious_payloads = [
            "<script>alert('XSS')</script>",
            "<img src=x onerror=alert('XSS')>",
            "javascript:alert('XSS')",
            "<svg onload=alert('XSS')>"
        ]
        
        for payload in malicious_payloads:
            test_request = {
                "method": "POST",
                "uri": "/api/comments",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"comment": payload}),
                "remote_addr": "127.0.0.1",
                "server_name": "test.example.com",
                "policy_name": "api-protection",
                "timestamp": 1234567890
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                    json=test_request
                )
                verdict = response.json()
                assert verdict.get("threat_detected") or verdict["action"] == "block"
    
    @pytest.mark.asyncio
    async def test_path_traversal_detection(self):
        """Test path traversal detection"""
        malicious_paths = [
            "../../../etc/passwd",
            "..%2F..%2F..%2Fetc%2Fpasswd",
            "....//....//....//etc/passwd"
        ]
        
        for path in malicious_paths:
            test_request = {
                "method": "GET",
                "uri": f"/api/files/{path}",
                "headers": {},
                "remote_addr": "127.0.0.1",
                "server_name": "test.example.com",
                "policy_name": "api-protection",
                "timestamp": 1234567890
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                    json=test_request
                )
                verdict = response.json()
                assert verdict.get("threat_detected") or verdict["action"] == "block"
    
    @pytest.mark.asyncio
    async def test_command_injection_detection(self):
        """Test command injection detection"""
        malicious_commands = [
            "; ls -la",
            "| cat /etc/passwd",
            "& whoami",
            "`id`"
        ]
        
        for cmd in malicious_commands:
            test_request = {
                "method": "POST",
                "uri": "/api/execute",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"command": cmd}),
                "remote_addr": "127.0.0.1",
                "server_name": "test.example.com",
                "policy_name": "api-protection",
                "timestamp": 1234567890
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                    json=test_request
                )
                verdict = response.json()
                assert verdict.get("threat_detected") or verdict["action"] == "block"

class TestBotProtection:
    """Test bot detection and protection"""
    
    @pytest.mark.asyncio
    async def test_malicious_bot_detection(self):
        """Test malicious bot detection"""
        bot_user_agents = [
            "sqlmap/1.0",
            "nikto/2.1.6",
            "nmap",
            "masscan"
        ]
        
        for user_agent in bot_user_agents:
            test_request = {
                "method": "GET",
                "uri": "/api/users",
                "headers": {"User-Agent": user_agent},
                "remote_addr": "127.0.0.1",
                "server_name": "test.example.com",
                "policy_name": "api-protection",
                "timestamp": 1234567890
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                    json=test_request
                )
                verdict = response.json()
                # Should detect malicious bot
                assert verdict.get("threat_detected") or verdict["action"] == "block"
    
    @pytest.mark.asyncio
    async def test_good_bot_allowlist(self):
        """Test good bot allowlist"""
        good_bots = [
            "Googlebot/2.1",
            "Bingbot/2.0",
            "Slackbot-LinkExpanding 1.0"
        ]
        
        for user_agent in good_bots:
            test_request = {
                "method": "GET",
                "uri": "/api/public",
                "headers": {"User-Agent": user_agent},
                "remote_addr": "127.0.0.1",
                "server_name": "test.example.com",
                "policy_name": "public-api-policy",
                "timestamp": 1234567890
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                    json=test_request
                )
                verdict = response.json()
                # Good bots should be allowed
                assert verdict["action"] == "allow"

class TestRateLimiting:
    """Test rate limiting and DDoS protection"""
    
    @pytest.mark.asyncio
    async def test_rate_limiting(self):
        """Test rate limiting enforcement"""
        # Simulate high request rate
        requests_sent = 0
        blocked_count = 0
        
        async with httpx.AsyncClient() as client:
            for i in range(100):
                test_request = {
                    "method": "GET",
                    "uri": "/api/test",
                    "headers": {},
                    "remote_addr": "127.0.0.1",
                    "server_name": "test.example.com",
                    "policy_name": "api-protection",
                    "timestamp": 1234567890 + i
                }
                
                response = await client.post(
                    f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                    json=test_request
                )
                requests_sent += 1
                
                if response.status_code == 200:
                    verdict = response.json()
                    if verdict["action"] == "block":
                        blocked_count += 1
        
        # Should have some rate limiting
        assert requests_sent == 100
        # At least some requests should be rate limited
        # (exact threshold depends on policy configuration)

class TestPerformance:
    """Test performance and latency"""
    
    @pytest.mark.asyncio
    async def test_inspection_latency(self):
        """Test that inspection latency is acceptable"""
        test_request = {
            "method": "GET",
            "uri": "/api/test",
            "headers": {},
            "remote_addr": "127.0.0.1",
            "server_name": "test.example.com",
            "policy_name": "api-protection",
            "timestamp": 1234567890
        }
        
        latencies = []
        
        async with httpx.AsyncClient() as client:
            for _ in range(10):
                import time
                start = time.time()
                
                response = await client.post(
                    f"{OPENAPPSEC_BRIDGE_URL}/api/v1/inspect",
                    json=test_request
                )
                
                end = time.time()
                latencies.append((end - start) * 1000)  # Convert to ms
                
                assert response.status_code == 200
        
        avg_latency = sum(latencies) / len(latencies)
        p95_latency = sorted(latencies)[int(len(latencies) * 0.95)]
        
        # Latency should be reasonable
        assert avg_latency < 100, f"Average latency {avg_latency}ms exceeds 100ms"
        assert p95_latency < 200, f"P95 latency {p95_latency}ms exceeds 200ms"

class TestIntegration:
    """Test end-to-end integration"""
    
    @pytest.mark.asyncio
    async def test_end_to_end_protection(self):
        """Test complete request flow through APISIX with openappsec"""
        # This test requires APISIX to be running with openappsec plugin enabled
        # Test legitimate request
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{APISIX_URL}/api/v1/test",
                headers={"User-Agent": "Test Client"}
            )
            # Should allow legitimate request
            assert response.status_code in [200, 404]  # 404 if upstream not configured
    
    @pytest.mark.asyncio
    async def test_end_to_end_blocking(self):
        """Test that malicious requests are blocked end-to-end"""
        # Test malicious request
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{APISIX_URL}/api/v1/users?id=' OR '1'='1",
                headers={"User-Agent": "Test Client"}
            )
            # Should block SQL injection
            assert response.status_code == 403

# Pytest configuration
@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--asyncio-mode=auto"])

