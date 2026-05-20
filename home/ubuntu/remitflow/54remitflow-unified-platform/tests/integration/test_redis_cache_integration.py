"""
Integration tests for Redis caching
"""

import pytest
import json

@pytest.mark.integration
class TestRedisCacheIntegration:
    """Test Redis caching integration"""
    
    def test_cache_product_data(self, mock_redis, sample_product):
        """Test caching product data"""
        key = f"product:{sample_product['product_id']}"
        value = json.dumps(sample_product)
        
        mock_redis.set(key, value, ex=3600)
        cached = mock_redis.get(key)
        
        assert cached is not None
    
    def test_cache_order_data(self, mock_redis, sample_order):
        """Test caching order data"""
        key = f"order:{sample_order['order_id']}"
        value = json.dumps(sample_order)
        
        mock_redis.set(key, value, ex=1800)
        cached = mock_redis.get(key)
        
        assert cached is not None
    
    def test_distributed_lock(self, mock_redis):
        """Test distributed locking"""
        lock_key = "payment:lock:12345"
        lock_value = "worker-1"
        
        # Acquire lock
        acquired = mock_redis.set(lock_key, lock_value, nx=True, ex=30)
        assert acquired is not None
        
        # Release lock
        mock_redis.delete(lock_key)
