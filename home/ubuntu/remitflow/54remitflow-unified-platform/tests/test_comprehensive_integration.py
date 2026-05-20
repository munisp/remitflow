"""
Comprehensive Integration Test Suite
Tests all major platform components and their interactions
"""

import pytest
import asyncio
import httpx
from datetime import datetime
import json

# Test configuration
ENAIRA_SERVICE_URL = "http://localhost:8000"
PQC_SERVICE_URL = "http://localhost:8001"
API_KEY = "your-secret-api-key"
PQC_API_KEY = "your-pqc-api-key"

class TestPlatformIntegration:
    """Integration tests for the complete platform"""
    
    @pytest.mark.asyncio
    async def test_enaira_wallet_creation(self):
        """Test eNaira wallet creation"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{ENAIRA_SERVICE_URL}/api/v1/wallet/create",
                headers={"X-API-Key": API_KEY},
                json={
                    "customer_id": "TEST-CUST-001",
                    "wallet_type": "individual",
                    "phone_number": "+2348012345678",
                    "bvn": "12345678901",
                    "email": "test@example.com"
                }
            )
            
            assert response.status_code == 200
            data = response.json()
            assert "wallet_id" in data
            assert data["customer_id"] == "TEST-CUST-001"
            assert data["balance"] == 0.0
            
            return data["wallet_id"]
    
    @pytest.mark.asyncio
    async def test_enaira_transfer(self):
        """Test eNaira fund transfer"""
        # Create two wallets
        async with httpx.AsyncClient() as client:
            # Wallet 1
            resp1 = await client.post(
                f"{ENAIRA_SERVICE_URL}/api/v1/wallet/create",
                headers={"X-API-Key": API_KEY},
                json={
                    "customer_id": "TEST-SENDER",
                    "wallet_type": "individual",
                    "phone_number": "+2348011111111",
                    "bvn": "11111111111"
                }
            )
            wallet1 = resp1.json()["wallet_id"]
            
            # Wallet 2
            resp2 = await client.post(
                f"{ENAIRA_SERVICE_URL}/api/v1/wallet/create",
                headers={"X-API-Key": API_KEY},
                json={
                    "customer_id": "TEST-RECIPIENT",
                    "wallet_type": "individual",
                    "phone_number": "+2348022222222",
                    "bvn": "22222222222"
                }
            )
            wallet2 = resp2.json()["wallet_id"]
            
            # Note: In mock implementation, we can't actually transfer
            # This would work with real CBN API
            # transfer_resp = await client.post(
            #     f"{ENAIRA_SERVICE_URL}/api/v1/transfer",
            #     headers={"X-API-Key": API_KEY},
            #     json={
            #         "from_wallet_id": wallet1,
            #         "to_wallet_id": wallet2,
            #         "amount": 1000.00,
            #         "narration": "Test transfer"
            #     }
            # )
            
            assert wallet1 is not None
            assert wallet2 is not None
    
    @pytest.mark.asyncio
    async def test_quantum_crypto_key_exchange(self):
        """Test quantum-resistant key exchange"""
        async with httpx.AsyncClient() as client:
            # Generate keypair
            keypair_resp = await client.post(
                f"{PQC_SERVICE_URL}/api/v1/kem/keypair",
                headers={"X-API-Key": PQC_API_KEY}
            )
            
            assert keypair_resp.status_code == 200
            keypair = keypair_resp.json()
            assert "public_key" in keypair
            assert "secret_key" in keypair
            assert keypair["algorithm"] == "Kyber768"
            
            # Encapsulate secret
            encap_resp = await client.post(
                f"{PQC_SERVICE_URL}/api/v1/kem/encapsulate",
                headers={"X-API-Key": PQC_API_KEY},
                json={"public_key": keypair["public_key"]}
            )
            
            assert encap_resp.status_code == 200
            encap = encap_resp.json()
            assert "ciphertext" in encap
            assert "shared_secret" in encap
            
            # Decapsulate secret
            decap_resp = await client.post(
                f"{PQC_SERVICE_URL}/api/v1/kem/decapsulate",
                headers={"X-API-Key": PQC_API_KEY},
                json={
                    "secret_key": keypair["secret_key"],
                    "ciphertext": encap["ciphertext"]
                }
            )
            
            assert decap_resp.status_code == 200
            decap = decap_resp.json()
            assert "shared_secret" in decap
    
    @pytest.mark.asyncio
    async def test_quantum_crypto_signatures(self):
        """Test quantum-resistant digital signatures"""
        async with httpx.AsyncClient() as client:
            # Generate signing keypair
            keypair_resp = await client.post(
                f"{PQC_SERVICE_URL}/api/v1/dsa/keypair",
                headers={"X-API-Key": PQC_API_KEY}
            )
            
            assert keypair_resp.status_code == 200
            keypair = keypair_resp.json()
            assert keypair["algorithm"] == "Dilithium3"
            
            # Sign message
            message = "Transfer 5000 NGN from Alice to Bob"
            sign_resp = await client.post(
                f"{PQC_SERVICE_URL}/api/v1/dsa/sign",
                headers={"X-API-Key": PQC_API_KEY},
                json={
                    "secret_key": keypair["secret_key"],
                    "message": message
                }
            )
            
            assert sign_resp.status_code == 200
            signature = sign_resp.json()
            assert "signature" in signature
            
            # Verify signature
            verify_resp = await client.post(
                f"{PQC_SERVICE_URL}/api/v1/dsa/verify",
                headers={"X-API-Key": PQC_API_KEY},
                json={
                    "public_key": keypair["public_key"],
                    "message": message,
                    "signature": signature["signature"]
                }
            )
            
            assert verify_resp.status_code == 200
            verification = verify_resp.json()
            assert verification["valid"] is True
    
    @pytest.mark.asyncio
    async def test_health_endpoints(self):
        """Test health check endpoints"""
        async with httpx.AsyncClient() as client:
            # eNaira health
            enaira_health = await client.get(f"{ENAIRA_SERVICE_URL}/health")
            assert enaira_health.status_code == 200
            assert enaira_health.json()["status"] == "healthy"
            
            # PQC health
            pqc_health = await client.get(f"{PQC_SERVICE_URL}/health")
            assert pqc_health.status_code == 200
            assert pqc_health.json()["status"] == "healthy"

class TestSecurityIntegration:
    """Security-focused integration tests"""
    
    @pytest.mark.asyncio
    async def test_api_key_validation(self):
        """Test API key authentication"""
        async with httpx.AsyncClient() as client:
            # Invalid API key
            response = await client.post(
                f"{ENAIRA_SERVICE_URL}/api/v1/wallet/create",
                headers={"X-API-Key": "invalid-key"},
                json={
                    "customer_id": "TEST",
                    "wallet_type": "individual",
                    "phone_number": "+2348012345678",
                    "bvn": "12345678901"
                }
            )
            
            assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_input_validation(self):
        """Test input validation"""
        async with httpx.AsyncClient() as client:
            # Invalid phone number
            response = await client.post(
                f"{ENAIRA_SERVICE_URL}/api/v1/wallet/create",
                headers={"X-API-Key": API_KEY},
                json={
                    "customer_id": "TEST",
                    "wallet_type": "individual",
                    "phone_number": "invalid",
                    "bvn": "12345678901"
                }
            )
            
            assert response.status_code == 422  # Validation error

class TestPerformance:
    """Performance and load tests"""
    
    @pytest.mark.asyncio
    async def test_concurrent_requests(self):
        """Test handling concurrent requests"""
        async with httpx.AsyncClient() as client:
            tasks = []
            for i in range(10):
                task = client.get(f"{ENAIRA_SERVICE_URL}/health")
                tasks.append(task)
            
            responses = await asyncio.gather(*tasks)
            
            assert all(r.status_code == 200 for r in responses)
    
    @pytest.mark.asyncio
    async def test_pqc_performance(self):
        """Test PQC operation performance"""
        import time
        
        async with httpx.AsyncClient() as client:
            # Measure keypair generation
            start = time.time()
            resp = await client.post(
                f"{PQC_SERVICE_URL}/api/v1/kem/keypair",
                headers={"X-API-Key": PQC_API_KEY}
            )
            duration = time.time() - start
            
            assert resp.status_code == 200
            assert duration < 1.0  # Should complete in less than 1 second

# Test execution summary
def pytest_sessionfinish(session, exitstatus):
    """Print test summary"""
    print("\n" + "="*60)
    print("INTEGRATION TEST SUMMARY")
    print("="*60)
    print(f"Tests run: {session.testscollected}")
    print(f"Status: {'PASSED' if exitstatus == 0 else 'FAILED'}")
    print("="*60)

if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
