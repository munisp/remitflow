"""
Performance and load tests for PaymentService
Tests system performance under various load conditions
"""
import pytest
import asyncio
import time
from locust import HttpUser, task, between
import statistics

class PaymentServiceLoadTest(HttpUser):
    """Load test for PaymentService using Locust."""
    
    wait_time = between(1, 3)
    
    @task(3)
    def get_quote(self):
        """Test get quote endpoint."""
        self.client.post("/api/v1/payments/quote", json={
            "amount": 1000.00,
            "from_currency": "USD",
            "to_currency": "NGN"
        })
    
    @task(2)
    def create_transfer(self):
        """Test create transfer endpoint."""
        self.client.post("/api/v1/payments/transfer", json={
            "quote_id": "quote_123",
            "sender": {"name": "Test User"},
            "recipient": {"name": "Test Recipient"}
        })
    
    @task(1)
    def get_status(self):
        """Test get status endpoint."""
        self.client.get("/api/v1/payments/status/txn_123")

@pytest.mark.performance
class TestPaymentServicePerformance:
    """Performance tests for PaymentService."""
    
    @pytest.mark.asyncio
    async def test_response_time_under_load(self):
        """Test response time under concurrent load."""
        import httpx
        
        async def make_request():
            async with httpx.AsyncClient() as client:
                start = time.time()
                response = await client.post(
                    "http://localhost:8000/api/v1/payments/quote",
                    json={"amount": 1000, "from_currency": "USD", "to_currency": "NGN"}
                )
                end = time.time()
                return end - start, response.status_code
        
        # Send 100 concurrent requests
        tasks = [make_request() for _ in range(100)]
        results = await asyncio.gather(*tasks)
        
        response_times = [r[0] for r in results]
        status_codes = [r[1] for r in results]
        
        # Assert performance metrics
        avg_response_time = statistics.mean(response_times)
        p95_response_time = statistics.quantiles(response_times, n=20)[18]  # 95th percentile
        
        assert avg_response_time < 0.5, f"Average response time {avg_response_time}s exceeds 0.5s"
        assert p95_response_time < 1.0, f"P95 response time {p95_response_time}s exceeds 1.0s"
        assert all(code == 200 for code in status_codes), "Some requests failed"
    
    @pytest.mark.asyncio
    async def test_throughput(self):
        """Test system throughput (requests per second)."""
        import httpx
        
        async def make_request(client):
            await client.post(
                "http://localhost:8000/api/v1/payments/quote",
                json={"amount": 1000, "from_currency": "USD", "to_currency": "NGN"}
            )
        
        start_time = time.time()
        
        async with httpx.AsyncClient() as client:
            tasks = [make_request(client) for _ in range(1000)]
            await asyncio.gather(*tasks)
        
        end_time = time.time()
        duration = end_time - start_time
        throughput = 1000 / duration
        
        # Assert minimum throughput of 100 requests/second
        assert throughput >= 100, f"Throughput {throughput} req/s is below 100 req/s"
    
    @pytest.mark.asyncio
    async def test_memory_usage(self):
        """Test memory usage under load."""
        import psutil
        import httpx
        
        process = psutil.Process()
        initial_memory = process.memory_info().rss / 1024 / 1024  # MB
        
        # Generate load
        async with httpx.AsyncClient() as client:
            tasks = [
                client.post(
                    "http://localhost:8000/api/v1/payments/quote",
                    json={"amount": 1000, "from_currency": "USD", "to_currency": "NGN"}
                )
                for _ in range(1000)
            ]
            await asyncio.gather(*tasks)
        
        final_memory = process.memory_info().rss / 1024 / 1024  # MB
        memory_increase = final_memory - initial_memory
        
        # Assert memory increase is reasonable (< 500MB)
        assert memory_increase < 500, f"Memory increased by {memory_increase}MB"
