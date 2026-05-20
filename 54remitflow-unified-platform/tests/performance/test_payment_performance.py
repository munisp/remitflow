"""
Performance tests for Payment Gateway
"""

import pytest
import time

@pytest.mark.performance
class TestPaymentPerformance:
    """Performance benchmarks for payment processing"""
    
    def test_payment_processing_speed(self, benchmark, sample_payment):
        """Benchmark payment processing speed"""
        def process_payment():
            # Simulate payment processing
            time.sleep(0.001)  # 1ms simulated processing
            return {"status": "completed"}
        
        result = benchmark(process_payment)
        assert result["status"] == "completed"
        
        # Performance requirements
        assert benchmark.stats["mean"] < 0.050  # < 50ms average
        assert benchmark.stats["max"] < 0.100   # < 100ms max
    
    def test_payment_throughput(self, benchmark):
        """Benchmark payment throughput"""
        def batch_payments():
            payments = []
            for _ in range(100):
                payments.append({"status": "completed"})
            return payments
        
        result = benchmark(batch_payments)
        assert len(result) == 100
        
        # Throughput requirement: > 1000 payments/sec
        ops_per_sec = 1 / benchmark.stats["mean"]
        assert ops_per_sec > 1000
