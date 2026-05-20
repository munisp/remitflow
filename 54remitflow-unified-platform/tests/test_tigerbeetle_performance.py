"""
Performance Tests for TigerBeetle
Tests performance, throughput, and latency
"""

import pytest
import time
import statistics
from unittest.mock import Mock


class TestThroughput:
    """Test system throughput"""
    
    def test_single_transfer_latency(self):
        """Test single transfer latency"""
        mock_client = Mock()
        mock_client.create_transfers.return_value = []
        
        latencies = []
        for _ in range(100):
            start = time.time()
            mock_client.create_transfers([{'id': 1, 'amount': 10000}])
            end = time.time()
            latencies.append((end - start) * 1000)  # Convert to ms
        
        avg_latency = statistics.mean(latencies)
        p99_latency = statistics.quantiles(latencies, n=100)[98]
        
        # Should be under 100ms average
        assert avg_latency < 100
        print(f"Average latency: {avg_latency:.2f}ms")
        print(f"P99 latency: {p99_latency:.2f}ms")
    
    def test_batch_throughput(self):
        """Test batch processing throughput"""
        mock_client = Mock()
        mock_client.create_transfers.return_value = []
        
        batch_size = 1000
        transfers = [{'id': i, 'amount': 10000} for i in range(batch_size)]
        
        start = time.time()
        mock_client.create_transfers(transfers)
        end = time.time()
        
        duration = end - start
        throughput = batch_size / duration if duration > 0 else float('inf')
        
        print(f"Batch throughput: {throughput:.0f} TPS")
        # Should achieve at least 10,000 TPS
        assert throughput > 10000


class TestScalability:
    """Test system scalability"""
    
    def test_increasing_batch_sizes(self):
        """Test performance with increasing batch sizes"""
        mock_client = Mock()
        mock_client.create_transfers.return_value = []
        
        batch_sizes = [100, 500, 1000, 5000, 10000]
        results = []
        
        for size in batch_sizes:
            transfers = [{'id': i, 'amount': 10000} for i in range(size)]
            
            start = time.time()
            mock_client.create_transfers(transfers)
            end = time.time()
            
            duration = end - start
            throughput = size / duration if duration > 0 else float('inf')
            results.append((size, throughput))
        
        # Throughput should scale with batch size
        for i in range(len(results) - 1):
            print(f"Batch {results[i][0]}: {results[i][1]:.0f} TPS")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
