"""
Load Testing Suite
Performance and scalability testing for the Nigerian Remittance Platform
"""

import asyncio
import httpx
import time
import statistics
from datetime import datetime
from typing import List, Dict
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class LoadTest:
    """Load testing orchestrator"""
    
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
        self.results = []
    
    async def single_request(self, endpoint: str, method: str = "GET", data: dict = None) -> Dict:
        """Execute a single request and measure performance"""
        start_time = time.time()
        
        async with httpx.AsyncClient() as client:
            try:
                if method == "GET":
                    response = await client.get(
                        f"{self.base_url}{endpoint}",
                        headers={"X-API-Key": self.api_key}
                    )
                elif method == "POST":
                    response = await client.post(
                        f"{self.base_url}{endpoint}",
                        headers={"X-API-Key": self.api_key},
                        json=data
                    )
                
                duration = time.time() - start_time
                
                return {
                    "status": response.status_code,
                    "duration": duration,
                    "success": response.status_code < 400
                }
                
            except Exception as e:
                duration = time.time() - start_time
                return {
                    "status": 0,
                    "duration": duration,
                    "success": False,
                    "error": str(e)
                }
    
    async def concurrent_requests(self, endpoint: str, count: int, method: str = "GET", data: dict = None) -> List[Dict]:
        """Execute concurrent requests"""
        logger.info(f"Executing {count} concurrent {method} requests to {endpoint}")
        
        tasks = []
        for i in range(count):
            task = self.single_request(endpoint, method, data)
            tasks.append(task)
        
        results = await asyncio.gather(*tasks)
        return results
    
    async def sustained_load_test(self, endpoint: str, duration_seconds: int, requests_per_second: int) -> List[Dict]:
        """Execute sustained load test"""
        logger.info(f"Running sustained load test for {duration_seconds}s at {requests_per_second} req/s")
        
        results = []
        start_time = time.time()
        request_interval = 1.0 / requests_per_second
        
        while time.time() - start_time < duration_seconds:
            result = await self.single_request(endpoint)
            results.append(result)
            await asyncio.sleep(request_interval)
        
        return results
    
    def analyze_results(self, results: List[Dict]) -> Dict:
        """Analyze load test results"""
        if not results:
            return {"error": "No results to analyze"}
        
        durations = [r["duration"] for r in results]
        successes = [r for r in results if r["success"]]
        failures = [r for r in results if not r["success"]]
        
        return {
            "total_requests": len(results),
            "successful_requests": len(successes),
            "failed_requests": len(failures),
            "success_rate": f"{(len(successes)/len(results)*100):.2f}%",
            "avg_response_time": f"{statistics.mean(durations):.4f}s",
            "min_response_time": f"{min(durations):.4f}s",
            "max_response_time": f"{max(durations):.4f}s",
            "median_response_time": f"{statistics.median(durations):.4f}s",
            "p95_response_time": f"{statistics.quantiles(durations, n=20)[18]:.4f}s" if len(durations) > 20 else "N/A",
            "p99_response_time": f"{statistics.quantiles(durations, n=100)[98]:.4f}s" if len(durations) > 100 else "N/A"
        }
    
    async def run_comprehensive_load_test(self):
        """Run comprehensive load testing suite"""
        logger.info("Starting comprehensive load testing")
        
        test_results = {}
        
        # Test 1: Health endpoint - Low load
        logger.info("\n=== Test 1: Health Endpoint - 10 concurrent requests ===")
        results = await self.concurrent_requests("/health", 10)
        test_results["health_low_load"] = self.analyze_results(results)
        
        # Test 2: Health endpoint - Medium load
        logger.info("\n=== Test 2: Health Endpoint - 100 concurrent requests ===")
        results = await self.concurrent_requests("/health", 100)
        test_results["health_medium_load"] = self.analyze_results(results)
        
        # Test 3: Health endpoint - High load
        logger.info("\n=== Test 3: Health Endpoint - 500 concurrent requests ===")
        results = await self.concurrent_requests("/health", 500)
        test_results["health_high_load"] = self.analyze_results(results)
        
        # Test 4: Wallet creation - Concurrent
        logger.info("\n=== Test 4: Wallet Creation - 50 concurrent requests ===")
        wallet_data = {
            "customer_id": f"LOAD-TEST-{int(time.time())}",
            "wallet_type": "individual",
            "phone_number": "+2348012345678",
            "bvn": "12345678901"
        }
        results = await self.concurrent_requests("/api/v1/wallet/create", 50, "POST", wallet_data)
        test_results["wallet_creation_concurrent"] = self.analyze_results(results)
        
        # Test 5: Sustained load
        logger.info("\n=== Test 5: Sustained Load - 30s at 10 req/s ===")
        results = await self.sustained_load_test("/health", 30, 10)
        test_results["sustained_load_30s"] = self.analyze_results(results)
        
        return test_results

class PQCLoadTest(LoadTest):
    """Load testing for Quantum Crypto service"""
    
    async def run_pqc_load_test(self):
        """Run PQC-specific load tests"""
        logger.info("Starting PQC load testing")
        
        test_results = {}
        
        # Test 1: Keypair generation
        logger.info("\n=== Test 1: KEM Keypair Generation - 50 concurrent ===")
        results = await self.concurrent_requests("/api/v1/kem/keypair", 50, "POST")
        test_results["kem_keypair_generation"] = self.analyze_results(results)
        
        # Test 2: DSA keypair generation
        logger.info("\n=== Test 2: DSA Keypair Generation - 50 concurrent ===")
        results = await self.concurrent_requests("/api/v1/dsa/keypair", 50, "POST")
        test_results["dsa_keypair_generation"] = self.analyze_results(results)
        
        return test_results

async def run_all_load_tests():
    """Run all load tests"""
    
    # eNaira service load test
    enaira_tester = LoadTest("http://localhost:8000", "your-secret-api-key")
    enaira_results = await enaira_tester.run_comprehensive_load_test()
    
    # PQC service load test
    pqc_tester = PQCLoadTest("http://localhost:8001", "your-pqc-api-key")
    pqc_results = await pqc_tester.run_pqc_load_test()
    
    # Combine results
    all_results = {
        "timestamp": datetime.utcnow().isoformat(),
        "enaira_service": enaira_results,
        "pqc_service": pqc_results
    }
    
    # Print report
    print("\n" + "="*80)
    print("LOAD TESTING REPORT")
    print("="*80)
    print(f"Timestamp: {all_results['timestamp']}")
    print("\n" + "-"*80)
    print("eNAIRA SERVICE RESULTS")
    print("-"*80)
    
    for test_name, results in enaira_results.items():
        print(f"\n{test_name.upper().replace('_', ' ')}:")
        for key, value in results.items():
            print(f"  {key}: {value}")
    
    print("\n" + "-"*80)
    print("QUANTUM CRYPTO SERVICE RESULTS")
    print("-"*80)
    
    for test_name, results in pqc_results.items():
        print(f"\n{test_name.upper().replace('_', ' ')}:")
        for key, value in results.items():
            print(f"  {key}: {value}")
    
    print("\n" + "="*80)
    
    # Save report
    report_path = '/home/ubuntu/NIGERIAN_REMITTANCE_ULTIMATE_FINAL/tests/performance/load_test_report.json'
    with open(report_path, 'w') as f:
        json.dump(all_results, f, indent=2)
    
    print(f"Report saved to: {report_path}")
    print("="*80)
    
    # Performance recommendations
    print("\nPERFORMANCE RECOMMENDATIONS:")
    print("-"*80)
    
    # Check if any test has high response times
    for service, tests in [("eNaira", enaira_results), ("PQC", pqc_results)]:
        for test_name, results in tests.items():
            if "avg_response_time" in results:
                avg_time = float(results["avg_response_time"].replace("s", ""))
                if avg_time > 1.0:
                    print(f"⚠️  {service} - {test_name}: High average response time ({avg_time:.2f}s)")
                    print(f"   Consider: Caching, connection pooling, or horizontal scaling")
                elif avg_time > 0.5:
                    print(f"ℹ️  {service} - {test_name}: Moderate response time ({avg_time:.2f}s)")
                else:
                    print(f"✅ {service} - {test_name}: Good response time ({avg_time:.2f}s)")
    
    print("="*80)
    
    return all_results

if __name__ == "__main__":
    asyncio.run(run_all_load_tests())
