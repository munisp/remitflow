"""
Rate Cache Manager - Redis-based caching with TTL and invalidation
"""

import json
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from decimal import Decimal

logger = logging.getLogger(__name__)


class RateCacheManager:
    """Manages rate caching with Redis-like behavior (in-memory for now)"""
    
    def __init__(self, default_ttl_seconds: int = 30):
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.default_ttl = default_ttl_seconds
        self.hit_count = 0
        self.miss_count = 0
    
    def _generate_key(self, from_currency: str, to_currency: str, rate_type: str = "mid") -> str:
        """Generate cache key"""
        return f"rate:{from_currency}:{to_currency}:{rate_type}"
    
    def get(
        self,
        from_currency: str,
        to_currency: str,
        rate_type: str = "mid"
    ) -> Optional[Dict[str, Any]]:
        """Get rate from cache"""
        
        key = self._generate_key(from_currency, to_currency, rate_type)
        
        if key not in self.cache:
            self.miss_count += 1
            logger.debug(f"Cache MISS: {key}")
            return None
        
        entry = self.cache[key]
        
        # Check expiry
        if datetime.utcnow() > entry["expires_at"]:
            del self.cache[key]
            self.miss_count += 1
            logger.debug(f"Cache EXPIRED: {key}")
            return None
        
        self.hit_count += 1
        logger.debug(f"Cache HIT: {key}")
        return entry["data"]
    
    def set(
        self,
        from_currency: str,
        to_currency: str,
        rate_data: Dict[str, Any],
        rate_type: str = "mid",
        ttl_seconds: Optional[int] = None
    ) -> None:
        """Set rate in cache with TTL"""
        
        key = self._generate_key(from_currency, to_currency, rate_type)
        ttl = ttl_seconds or self.default_ttl
        
        self.cache[key] = {
            "data": rate_data,
            "created_at": datetime.utcnow(),
            "expires_at": datetime.utcnow() + timedelta(seconds=ttl)
        }
        
        logger.debug(f"Cache SET: {key} (TTL: {ttl}s)")
    
    def invalidate(
        self,
        from_currency: Optional[str] = None,
        to_currency: Optional[str] = None
    ) -> int:
        """Invalidate cache entries"""
        
        if from_currency is None and to_currency is None:
            # Clear all
            count = len(self.cache)
            self.cache.clear()
            logger.info(f"Cache cleared: {count} entries")
            return count
        
        # Selective invalidation
        keys_to_delete = []
        for key in self.cache.keys():
            parts = key.split(":")
            if len(parts) >= 3:
                key_from = parts[1]
                key_to = parts[2]
                
                if (from_currency and key_from == from_currency) or \
                   (to_currency and key_to == to_currency):
                    keys_to_delete.append(key)
        
        for key in keys_to_delete:
            del self.cache[key]
        
        logger.info(f"Cache invalidated: {len(keys_to_delete)} entries")
        return len(keys_to_delete)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        
        total_requests = self.hit_count + self.miss_count
        hit_rate = (self.hit_count / total_requests * 100) if total_requests > 0 else 0
        
        return {
            "total_entries": len(self.cache),
            "hit_count": self.hit_count,
            "miss_count": self.miss_count,
            "hit_rate_percent": round(hit_rate, 2),
            "total_requests": total_requests
        }
    
    def cleanup_expired(self) -> int:
        """Remove expired entries"""
        
        now = datetime.utcnow()
        keys_to_delete = [
            key for key, entry in self.cache.items()
            if now > entry["expires_at"]
        ]
        
        for key in keys_to_delete:
            del self.cache[key]
        
        if keys_to_delete:
            logger.info(f"Cleaned up {len(keys_to_delete)} expired entries")
        
        return len(keys_to_delete)


class CorridorConfigManager:
    """Manages corridor-specific configurations (markup, TTL, etc.)"""
    
    def __init__(self):
        self.configs: Dict[str, Dict[str, Any]] = {}
        self._load_default_configs()
    
    def _load_default_configs(self):
        """Load default corridor configurations"""
        
        # Major corridors (low markup, short TTL)
        major_corridors = [
            ("USD", "EUR"), ("USD", "GBP"), ("EUR", "GBP"),
            ("USD", "JPY"), ("EUR", "JPY")
        ]
        
        for from_curr, to_curr in major_corridors:
            self.set_config(from_curr, to_curr, {
                "markup_percentage": 0.2,
                "ttl_seconds": 30,
                "priority": "high"
            })
        
        # African corridors (medium markup, medium TTL)
        african_corridors = [
            ("USD", "NGN"), ("GBP", "NGN"), ("EUR", "NGN"),
            ("USD", "KES"), ("USD", "GHS"), ("USD", "ZAR")
        ]
        
        for from_curr, to_curr in african_corridors:
            self.set_config(from_curr, to_curr, {
                "markup_percentage": 1.0,
                "ttl_seconds": 60,
                "priority": "medium"
            })
        
        # Exotic corridors (high markup, long TTL)
        # Default for any other corridor
        self.default_config = {
            "markup_percentage": 2.0,
            "ttl_seconds": 120,
            "priority": "low"
        }
    
    def _generate_key(self, from_currency: str, to_currency: str) -> str:
        """Generate corridor key"""
        return f"{from_currency}/{to_currency}"
    
    def get_config(self, from_currency: str, to_currency: str) -> Dict[str, Any]:
        """Get corridor configuration"""
        
        key = self._generate_key(from_currency, to_currency)
        
        if key in self.configs:
            return self.configs[key]
        
        # Return default
        return self.default_config.copy()
    
    def set_config(
        self,
        from_currency: str,
        to_currency: str,
        config: Dict[str, Any]
    ) -> None:
        """Set corridor configuration"""
        
        key = self._generate_key(from_currency, to_currency)
        self.configs[key] = config
        logger.info(f"Corridor config set: {key} -> {config}")
    
    def get_markup(self, from_currency: str, to_currency: str) -> float:
        """Get markup percentage for corridor"""
        config = self.get_config(from_currency, to_currency)
        return config.get("markup_percentage", 1.0)
    
    def get_ttl(self, from_currency: str, to_currency: str) -> int:
        """Get TTL seconds for corridor"""
        config = self.get_config(from_currency, to_currency)
        return config.get("ttl_seconds", 60)
    
    def list_corridors(self) -> Dict[str, Dict[str, Any]]:
        """List all configured corridors"""
        return self.configs.copy()
    
    def update_markup(
        self,
        from_currency: str,
        to_currency: str,
        markup_percentage: float
    ) -> None:
        """Update markup for corridor"""
        
        key = self._generate_key(from_currency, to_currency)
        
        if key not in self.configs:
            self.configs[key] = self.default_config.copy()
        
        self.configs[key]["markup_percentage"] = markup_percentage
        logger.info(f"Markup updated: {key} -> {markup_percentage}%")
