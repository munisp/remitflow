"""
Performance tests for Redis Cache
"""

import pytest

@pytest.mark.performance
class TestCachePerformance:
    """Performance benchmarks for caching operations"""
    
    def test_cache_read_performance(self, benchmark, mock_redis):
        """Benchmark cache read performance"""
        mock_redis.set("test_key", "test_value")
        
        def read_cache():
            return mock_redis.get("test_key")
        
        result = benchmark(read_cache)
        assert result is not None
        
        # Cache read should be < 1ms
        assert benchmark.stats["mean"] < 0.001
    
    def test_cache_write_performance(self, benchmark, mock_redis):
        """Benchmark cache write performance"""
        def write_cache():
            mock_redis.set("test_key", "test_value", ex=3600)
            return True
        
        result = benchmark(write_cache)
        assert result == True
        
        # Cache write should be < 2ms
        assert benchmark.stats["mean"] < 0.002
