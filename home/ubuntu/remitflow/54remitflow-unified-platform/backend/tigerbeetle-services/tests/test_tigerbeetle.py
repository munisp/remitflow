"""
Comprehensive Test Suite for TigerBeetle Services
Includes: Unit tests, Integration tests, Load tests, Performance tests
"""

import pytest
import asyncio
import time
import random
import httpx
from typing import List, Dict
from concurrent.futures import ThreadPoolExecutor, as_completed

# Test configuration
BASE_URL_NATIVE = "http://localhost:8094"
BASE_URL_PRIMARY = "http://localhost:8091"
BASE_URL_EDGE = "http://localhost:8092"

# =============================================================================
# Unit Tests
# =============================================================================

class TestAccountCreation:
    """Test account creation functionality"""
    
    @pytest.mark.asyncio
    async def test_create_agent_wallet(self):
        """Test creating an agent wallet"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={
                    "id": random.randint(1, 1000000),
                    "ledger": 1,  # Remittance Platform
                    "code": 1,    # Agent Wallet
                    "user_data": 0
                }
            )
            assert response.status_code in [200, 201]
            data = response.json()
            assert data["success"] is True
    
    @pytest.mark.asyncio
    async def test_create_customer_wallet(self):
        """Test creating a customer wallet"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={
                    "id": random.randint(1, 1000000),
                    "ledger": 1,  # Remittance Platform
                    "code": 2,    # Customer Wallet
                    "user_data": 0
                }
            )
            assert response.status_code in [200, 201]
    
    @pytest.mark.asyncio
    async def test_create_merchant_account(self):
        """Test creating a merchant account"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={
                    "id": random.randint(1, 1000000),
                    "ledger": 2,  # E-commerce
                    "code": 5,    # Merchant Account
                    "user_data": 0
                }
            )
            assert response.status_code in [200, 201]
    
    @pytest.mark.asyncio
    async def test_duplicate_account_fails(self):
        """Test that creating duplicate account fails"""
        account_id = random.randint(1, 1000000)
        
        async with httpx.AsyncClient() as client:
            # Create first account
            response1 = await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account_id, "ledger": 1, "code": 1, "user_data": 0}
            )
            assert response1.status_code in [200, 201]
            
            # Try to create duplicate
            response2 = await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account_id, "ledger": 1, "code": 1, "user_data": 0}
            )
            assert response2.status_code == 409  # Conflict


class TestTransfers:
    """Test transfer functionality"""
    
    @pytest.mark.asyncio
    async def test_simple_transfer(self):
        """Test simple transfer between accounts"""
        # Create two accounts
        account1_id = random.randint(1, 1000000)
        account2_id = random.randint(1, 1000000)
        
        async with httpx.AsyncClient() as client:
            # Create accounts
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account1_id, "ledger": 1, "code": 1, "user_data": 0}
            )
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account2_id, "ledger": 1, "code": 2, "user_data": 0}
            )
            
            # Create transfer
            response = await client.post(
                f"{BASE_URL_PRIMARY}/transfers",
                json={
                    "id": random.randint(1, 1000000),
                    "debit_account_id": account1_id,
                    "credit_account_id": account2_id,
                    "amount": 10000,
                    "ledger": 1,
                    "code": 1,
                    "flags": 0
                }
            )
            assert response.status_code in [200, 201]
    
    @pytest.mark.asyncio
    async def test_pending_transfer(self):
        """Test pending transfer (two-phase commit)"""
        account1_id = random.randint(1, 1000000)
        account2_id = random.randint(1, 1000000)
        transfer_id = random.randint(1, 1000000)
        
        async with httpx.AsyncClient() as client:
            # Create accounts
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account1_id, "ledger": 1, "code": 1, "user_data": 0}
            )
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account2_id, "ledger": 1, "code": 2, "user_data": 0}
            )
            
            # Create pending transfer
            response = await client.post(
                f"{BASE_URL_PRIMARY}/transfers/pending",
                json={
                    "id": transfer_id,
                    "debit_account_id": account1_id,
                    "credit_account_id": account2_id,
                    "amount": 10000,
                    "ledger": 1,
                    "timeout": 3600
                }
            )
            assert response.status_code in [200, 201]
            
            # Post pending transfer
            response = await client.post(
                f"{BASE_URL_PRIMARY}/transfers/pending/{transfer_id}/post"
            )
            assert response.status_code in [200, 201]
    
    @pytest.mark.asyncio
    async def test_void_pending_transfer(self):
        """Test voiding a pending transfer"""
        account1_id = random.randint(1, 1000000)
        account2_id = random.randint(1, 1000000)
        transfer_id = random.randint(1, 1000000)
        
        async with httpx.AsyncClient() as client:
            # Create accounts
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account1_id, "ledger": 1, "code": 1, "user_data": 0}
            )
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account2_id, "ledger": 1, "code": 2, "user_data": 0}
            )
            
            # Create pending transfer
            await client.post(
                f"{BASE_URL_PRIMARY}/transfers/pending",
                json={
                    "id": transfer_id,
                    "debit_account_id": account1_id,
                    "credit_account_id": account2_id,
                    "amount": 10000,
                    "ledger": 1,
                    "timeout": 3600
                }
            )
            
            # Void pending transfer
            response = await client.post(
                f"{BASE_URL_PRIMARY}/transfers/pending/{transfer_id}/void"
            )
            assert response.status_code in [200, 201]


# =============================================================================
# Integration Tests
# =============================================================================

class TestIntegration:
    """Test integration scenarios"""
    
    @pytest.mark.asyncio
    async def test_agent_transaction_workflow(self):
        """Test complete agent transaction workflow"""
        customer_id = random.randint(1, 1000000)
        agent_id = random.randint(1, 1000000)
        commission_id = random.randint(1, 1000000)
        
        async with httpx.AsyncClient() as client:
            # Create accounts
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": customer_id, "ledger": 1, "code": 2, "user_data": 0}
            )
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": agent_id, "ledger": 1, "code": 1, "user_data": 0}
            )
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": commission_id, "ledger": 5, "code": 3, "user_data": 0}
            )
            
            # Process agent transaction
            response = await client.post(
                f"{BASE_URL_PRIMARY}/agent/transaction",
                json={
                    "transaction_id": random.randint(1, 1000000),
                    "customer_account": customer_id,
                    "agent_account": agent_id,
                    "amount": 100000,
                    "commission_account": commission_id,
                    "commission_amount": 5000
                }
            )
            assert response.status_code in [200, 201]
    
    @pytest.mark.asyncio
    async def test_ecommerce_order_workflow(self):
        """Test complete e-commerce order workflow"""
        customer_id = random.randint(1, 1000000)
        merchant_id = random.randint(1, 1000000)
        fee_id = random.randint(1, 1000000)
        
        async with httpx.AsyncClient() as client:
            # Create accounts
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": customer_id, "ledger": 2, "code": 2, "user_data": 0}
            )
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": merchant_id, "ledger": 2, "code": 5, "user_data": 0}
            )
            await client.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": fee_id, "ledger": 7, "code": 7, "user_data": 0}
            )
            
            # Process e-commerce order
            response = await client.post(
                f"{BASE_URL_PRIMARY}/ecommerce/order",
                json={
                    "order_id": random.randint(1, 1000000),
                    "customer_account": customer_id,
                    "merchant_account": merchant_id,
                    "amount": 50000,
                    "fee_account": fee_id,
                    "fee_amount": 2500
                }
            )
            assert response.status_code in [200, 201]


# =============================================================================
# Performance Tests
# =============================================================================

class TestPerformance:
    """Test performance benchmarks"""
    
    def test_account_creation_throughput(self):
        """Test account creation throughput"""
        num_accounts = 1000
        start_time = time.time()
        
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for i in range(num_accounts):
                future = executor.submit(
                    self._create_account,
                    random.randint(1, 10000000)
                )
                futures.append(future)
            
            for future in as_completed(futures):
                future.result()
        
        end_time = time.time()
        duration = end_time - start_time
        throughput = num_accounts / duration
        
        print(f"\nAccount Creation Throughput: {throughput:.2f} accounts/sec")
        assert throughput > 100  # At least 100 accounts/sec
    
    def test_transfer_throughput(self):
        """Test transfer throughput"""
        num_transfers = 1000
        
        # Create test accounts first
        account1_id = random.randint(1, 10000000)
        account2_id = random.randint(1, 10000000)
        self._create_account(account1_id)
        self._create_account(account2_id)
        
        start_time = time.time()
        
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for i in range(num_transfers):
                future = executor.submit(
                    self._create_transfer,
                    random.randint(1, 10000000),
                    account1_id,
                    account2_id,
                    1000
                )
                futures.append(future)
            
            for future in as_completed(futures):
                future.result()
        
        end_time = time.time()
        duration = end_time - start_time
        throughput = num_transfers / duration
        
        print(f"\nTransfer Throughput: {throughput:.2f} transfers/sec")
        assert throughput > 150  # At least 150 transfers/sec
    
    def test_latency_p99(self):
        """Test P99 latency"""
        num_requests = 1000
        latencies = []
        
        account1_id = random.randint(1, 10000000)
        account2_id = random.randint(1, 10000000)
        self._create_account(account1_id)
        self._create_account(account2_id)
        
        for i in range(num_requests):
            start_time = time.time()
            self._create_transfer(
                random.randint(1, 10000000),
                account1_id,
                account2_id,
                1000
            )
            end_time = time.time()
            latencies.append((end_time - start_time) * 1000)  # Convert to ms
        
        latencies.sort()
        p99 = latencies[int(len(latencies) * 0.99)]
        
        print(f"\nP99 Latency: {p99:.2f}ms")
        assert p99 < 100  # P99 should be less than 100ms
    
    # Helper methods
    def _create_account(self, account_id: int):
        """Helper to create account"""
        response = httpx.post(
            f"{BASE_URL_PRIMARY}/accounts",
            json={"id": account_id, "ledger": 1, "code": 1, "user_data": 0},
            timeout=10.0
        )
        return response.status_code in [200, 201, 409]  # 409 = already exists
    
    def _create_transfer(self, transfer_id: int, debit_id: int, credit_id: int, amount: int):
        """Helper to create transfer"""
        response = httpx.post(
            f"{BASE_URL_PRIMARY}/transfers",
            json={
                "id": transfer_id,
                "debit_account_id": debit_id,
                "credit_account_id": credit_id,
                "amount": amount,
                "ledger": 1,
                "code": 1,
                "flags": 0
            },
            timeout=10.0
        )
        return response.status_code in [200, 201]


# =============================================================================
# Load Tests
# =============================================================================

class TestLoad:
    """Test system under load"""
    
    def test_sustained_load(self):
        """Test system under sustained load"""
        duration_seconds = 60
        target_tps = 500
        
        start_time = time.time()
        total_requests = 0
        total_errors = 0
        
        # Create test accounts
        account1_id = random.randint(1, 10000000)
        account2_id = random.randint(1, 10000000)
        self._create_account(account1_id)
        self._create_account(account2_id)
        
        with ThreadPoolExecutor(max_workers=20) as executor:
            while time.time() - start_time < duration_seconds:
                futures = []
                
                # Submit batch of requests
                for _ in range(target_tps // 10):  # 10 batches per second
                    future = executor.submit(
                        self._create_transfer,
                        random.randint(1, 100000000),
                        account1_id,
                        account2_id,
                        random.randint(100, 10000)
                    )
                    futures.append(future)
                
                # Wait for batch to complete
                for future in as_completed(futures):
                    total_requests += 1
                    if not future.result():
                        total_errors += 1
                
                # Sleep to maintain target TPS
                time.sleep(0.1)
        
        end_time = time.time()
        actual_duration = end_time - start_time
        actual_tps = total_requests / actual_duration
        error_rate = total_errors / total_requests if total_requests > 0 else 0
        
        print(f"\nSustained Load Test Results:")
        print(f"  Duration: {actual_duration:.2f}s")
        print(f"  Total Requests: {total_requests}")
        print(f"  Actual TPS: {actual_tps:.2f}")
        print(f"  Error Rate: {error_rate:.2%}")
        
        assert error_rate < 0.01  # Less than 1% errors
        assert actual_tps > target_tps * 0.8  # At least 80% of target TPS
    
    # Helper methods
    def _create_account(self, account_id: int):
        """Helper to create account"""
        try:
            response = httpx.post(
                f"{BASE_URL_PRIMARY}/accounts",
                json={"id": account_id, "ledger": 1, "code": 1, "user_data": 0},
                timeout=10.0
            )
            return response.status_code in [200, 201, 409]
        except:
            return False
    
    def _create_transfer(self, transfer_id: int, debit_id: int, credit_id: int, amount: int):
        """Helper to create transfer"""
        try:
            response = httpx.post(
                f"{BASE_URL_PRIMARY}/transfers",
                json={
                    "id": transfer_id,
                    "debit_account_id": debit_id,
                    "credit_account_id": credit_id,
                    "amount": amount,
                    "ledger": 1,
                    "code": 1,
                    "flags": 0
                },
                timeout=10.0
            )
            return response.status_code in [200, 201]
        except:
            return False


# =============================================================================
# Health Check Tests
# =============================================================================

class TestHealthChecks:
    """Test service health checks"""
    
    @pytest.mark.asyncio
    async def test_native_service_health(self):
        """Test native Zig service health"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{BASE_URL_NATIVE}/health")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "healthy"
    
    @pytest.mark.asyncio
    async def test_primary_service_health(self):
        """Test primary Python service health"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{BASE_URL_PRIMARY}/health")
            assert response.status_code == 200
    
    @pytest.mark.asyncio
    async def test_edge_service_health(self):
        """Test edge Go service health"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{BASE_URL_EDGE}/health")
            assert response.status_code == 200


# =============================================================================
# Test Runner
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])

