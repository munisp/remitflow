"""
Airtime Top-up Redis Cache
Journey: journey_09_airtime_topup
"""

import redis
import json
from typing import Optional

class AirtimeTop-upCache:
    def __init__(self, host='localhost', port=6379):
        self.redis_client = redis.Redis(host=host, port=port, decode_responses=True)
        self.prefix = "journey_09_airtime_topup"
    
    def set(self, key: str, value: dict, ttl: int = 3600):
        full_key = f"{self.prefix}:{key}"
        self.redis_client.setex(full_key, ttl, json.dumps(value))
    
    def get(self, key: str) -> Optional[dict]:
        full_key = f"{self.prefix}:{key}"
        value = self.redis_client.get(full_key)
        return json.loads(value) if value else None
    
    def delete(self, key: str):
        full_key = f"{self.prefix}:{key}"
        self.redis_client.delete(full_key)
