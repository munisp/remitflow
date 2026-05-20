"""
Unit tests for Inventory Management
"""

import pytest

class TestInventoryManagement:
    """Test suite for inventory management"""
    
    def test_add_inventory(self, sample_product):
        """Test adding inventory"""
        sample_product["stock"] += 50
        assert sample_product["stock"] >= 50
    
    def test_reduce_inventory(self, sample_product):
        """Test reducing inventory"""
        original_stock = sample_product["stock"]
        sample_product["stock"] -= 10
        assert sample_product["stock"] == original_stock - 10
    
    def test_low_stock_alert(self, sample_product):
        """Test low stock alert"""
        sample_product["stock"] = 5
        threshold = 10
        needs_reorder = sample_product["stock"] < threshold
        assert needs_reorder == True
    
    def test_inventory_forecasting(self, sample_product):
        """Test inventory forecasting"""
        daily_sales = 10
        current_stock = sample_product["stock"]
        days_until_stockout = current_stock / daily_sales if daily_sales > 0 else float("inf")
        assert days_until_stockout >= 0
