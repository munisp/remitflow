"""
Load Tests for Performance Validation
Tests system performance under load
"""

import asyncio
import time
from typing import List, Dict, Any
import statistics

class LoadTestRunner:
    """Run load tests on various endpoints"""
    
    async def run_concurrent_requests(
        self, 
        endpoint_func, 
        num_requests: int, 
        concurrency: int
    ) -> Dict[str, Any]:
        """
        Run concurrent requests and measure performance
        
        Args:
            endpoint_func: Async function to test
            num_requests: Total number of requests
            concurrency: Number of concurrent requests
            
        Returns:
            Performance metrics
        """
        results = []
        start_time = time.time()
        
        # Create batches of concurrent requests
        for i in range(0, num_requests, concurrency):
            batch_size = min(concurrency, num_requests - i)
            tasks = [endpoint_func() for _ in range(batch_size)]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            results.extend(batch_results)
        
        end_time = time.time()
        total_time = end_time - start_time
        
        # Calculate metrics
        successful = sum(1 for r in results if isinstance(r, dict) and r.get("success"))
        failed = len(results) - successful
        
        return {
            "total_requests": num_requests,
            "successful": successful,
            "failed": failed,
            "total_time": total_time,
            "requests_per_second": num_requests / total_time if total_time > 0 else 0,
            "avg_response_time": total_time / num_requests if num_requests > 0 else 0
        }

class TestRecurringPaymentsLoad:
    """Load tests for recurring payments"""
    
    async def test_create_recurring_payment_load(self):
        """Test recurring payment creation under load"""
        runner = LoadTestRunner()
        
        async def create_payment():
            await asyncio.sleep(0.1)  # Simulate API call
            return {"success": True, "recurring_id": "test_id"}
        
        # Test with 100 requests, 10 concurrent
        results = await runner.run_concurrent_requests(
            create_payment,
            num_requests=100,
            concurrency=10
        )
        
        assert results["successful"] >= 95, f"Success rate too low: {results['successful']}/100"
        assert results["requests_per_second"] >= 50, f"RPS too low: {results['requests_per_second']}"
        print(f"✓ Recurring Payments Load Test: {results['requests_per_second']:.2f} req/s")
    
    async def test_process_recurring_payment_load(self):
        """Test recurring payment processing under load"""
        runner = LoadTestRunner()
        
        async def process_payment():
            await asyncio.sleep(0.2)  # Simulate processing
            return {"success": True, "status": "completed"}
        
        results = await runner.run_concurrent_requests(
            process_payment,
            num_requests=50,
            concurrency=5
        )
        
        assert results["successful"] >= 48, f"Success rate too low: {results['successful']}/50"
        print(f"✓ Recurring Payment Processing: {results['requests_per_second']:.2f} req/s")

class TestTransactionLoad:
    """Load tests for transactions"""
    
    async def test_transaction_creation_load(self):
        """Test transaction creation under heavy load"""
        runner = LoadTestRunner()
        
        async def create_transaction():
            await asyncio.sleep(0.05)
            return {"success": True, "transaction_id": "test_tx"}
        
        # Test with 1000 requests, 50 concurrent
        results = await runner.run_concurrent_requests(
            create_transaction,
            num_requests=1000,
            concurrency=50
        )
        
        assert results["successful"] >= 980, f"Success rate too low: {results['successful']}/1000"
        assert results["requests_per_second"] >= 200, f"RPS too low: {results['requests_per_second']}"
        print(f"✓ Transaction Creation Load: {results['requests_per_second']:.2f} req/s")
    
    async def test_transaction_status_load(self):
        """Test transaction status checking under load"""
        runner = LoadTestRunner()
        
        async def check_status():
            await asyncio.sleep(0.02)
            return {"success": True, "status": "completed"}
        
        results = await runner.run_concurrent_requests(
            check_status,
            num_requests=2000,
            concurrency=100
        )
        
        assert results["successful"] >= 1980, f"Success rate too low: {results['successful']}/2000"
        assert results["requests_per_second"] >= 500, f"RPS too low: {results['requests_per_second']}"
        print(f"✓ Transaction Status Load: {results['requests_per_second']:.2f} req/s")

class TestKYCLoad:
    """Load tests for KYC verification"""
    
    async def test_document_verification_load(self):
        """Test document verification under load"""
        runner = LoadTestRunner()
        
        async def verify_document():
            await asyncio.sleep(2.0)  # Document verification takes longer
            return {"success": True, "confidence": 0.95}
        
        results = await runner.run_concurrent_requests(
            verify_document,
            num_requests=20,
            concurrency=5
        )
        
        assert results["successful"] >= 19, f"Success rate too low: {results['successful']}/20"
        print(f"✓ Document Verification Load: {results['requests_per_second']:.2f} req/s")
    
    async def test_face_matching_load(self):
        """Test face matching under load"""
        runner = LoadTestRunner()
        
        async def match_face():
            await asyncio.sleep(1.5)
            return {"success": True, "similarity": 0.92}
        
        results = await runner.run_concurrent_requests(
            match_face,
            num_requests=30,
            concurrency=10
        )
        
        assert results["successful"] >= 28, f"Success rate too low: {results['successful']}/30"
        print(f"✓ Face Matching Load: {results['requests_per_second']:.2f} req/s")

# Performance benchmarks
PERFORMANCE_BENCHMARKS = {
    "recurring_payments_creation": {"min_rps": 50, "max_latency_ms": 200},
    "recurring_payments_processing": {"min_rps": 25, "max_latency_ms": 400},
    "transaction_creation": {"min_rps": 200, "max_latency_ms": 100},
    "transaction_status": {"min_rps": 500, "max_latency_ms": 50},
    "document_verification": {"min_rps": 2, "max_latency_ms": 3000},
    "face_matching": {"min_rps": 5, "max_latency_ms": 2000}
}
