"""
Feature Store - Redis-backed feature storage and retrieval
Provides online and offline feature serving for ML models

Features:
- Real-time feature computation and caching
- Redis-backed storage for low-latency serving
- Feature versioning and lineage tracking
- Batch feature retrieval for training
- Feature drift monitoring
"""

import os
import json
import logging
import hashlib
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from enum import Enum

logger = logging.getLogger(__name__)

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
FEATURE_TTL_SECONDS = int(os.getenv("FEATURE_TTL_SECONDS", "300"))
USE_REDIS = os.getenv("USE_REDIS_FEATURE_STORE", "true").lower() == "true"

# Try to import redis
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logger.warning("Redis not available, using in-memory feature store")


class FeatureType(str, Enum):
    USER = "user"
    TRANSACTION = "transaction"
    DEVICE = "device"
    BENEFICIARY = "beneficiary"
    CORRIDOR = "corridor"


@dataclass
class FeatureDefinition:
    name: str
    feature_type: FeatureType
    data_type: str  # int, float, string, bool, list
    description: str
    default_value: Any = None
    is_required: bool = False
    version: str = "1.0.0"


@dataclass
class FeatureVector:
    entity_type: str
    entity_id: str
    features: Dict[str, Any]
    computed_at: datetime
    version: str
    ttl_seconds: int


class InMemoryFeatureStore:
    """In-memory feature store for development/testing"""
    
    def __init__(self):
        self._cache: Dict[str, Dict] = {}
        self._feature_definitions: Dict[str, FeatureDefinition] = {}
        self._initialize_feature_definitions()
        logger.info("In-memory feature store initialized")
    
    def _initialize_feature_definitions(self):
        """Initialize standard feature definitions"""
        
        # User features
        user_features = [
            FeatureDefinition("account_age_days", FeatureType.USER, "int", "Days since account creation"),
            FeatureDefinition("kyc_level", FeatureType.USER, "int", "KYC verification level (1-3)"),
            FeatureDefinition("total_transactions", FeatureType.USER, "int", "Total transaction count"),
            FeatureDefinition("total_volume_usd", FeatureType.USER, "float", "Total transaction volume in USD"),
            FeatureDefinition("avg_transaction_value", FeatureType.USER, "float", "Average transaction value"),
            FeatureDefinition("tx_frequency_30d", FeatureType.USER, "int", "Transactions in last 30 days"),
            FeatureDefinition("unique_beneficiaries", FeatureType.USER, "int", "Unique beneficiaries count"),
            FeatureDefinition("unique_corridors", FeatureType.USER, "int", "Unique corridors used"),
            FeatureDefinition("failed_tx_rate", FeatureType.USER, "float", "Failed transaction rate"),
            FeatureDefinition("days_since_last_tx", FeatureType.USER, "int", "Days since last transaction"),
            FeatureDefinition("device_count", FeatureType.USER, "int", "Number of registered devices"),
            FeatureDefinition("velocity_hourly", FeatureType.USER, "int", "Transactions in last hour"),
            FeatureDefinition("velocity_daily", FeatureType.USER, "int", "Transactions in last 24 hours"),
            FeatureDefinition("historical_fraud_rate", FeatureType.USER, "float", "Historical fraud rate"),
            FeatureDefinition("tx_frequency_trend", FeatureType.USER, "float", "Transaction frequency trend"),
            FeatureDefinition("volume_trend", FeatureType.USER, "float", "Volume trend"),
            FeatureDefinition("engagement_score", FeatureType.USER, "float", "App engagement score"),
            FeatureDefinition("risk_segment", FeatureType.USER, "string", "Risk segment classification"),
        ]
        
        # Transaction features
        transaction_features = [
            FeatureDefinition("amount", FeatureType.TRANSACTION, "float", "Transaction amount"),
            FeatureDefinition("amount_usd", FeatureType.TRANSACTION, "float", "Amount in USD"),
            FeatureDefinition("amount_zscore", FeatureType.TRANSACTION, "float", "Amount z-score vs user history"),
            FeatureDefinition("amount_percentile", FeatureType.TRANSACTION, "float", "Amount percentile"),
            FeatureDefinition("is_international", FeatureType.TRANSACTION, "bool", "Is international transfer"),
            FeatureDefinition("is_high_risk_corridor", FeatureType.TRANSACTION, "bool", "Is high-risk corridor"),
            FeatureDefinition("corridor_risk_level", FeatureType.TRANSACTION, "int", "Corridor risk level (1-5)"),
            FeatureDefinition("is_new_beneficiary", FeatureType.TRANSACTION, "bool", "Is new beneficiary"),
            FeatureDefinition("beneficiary_risk_score", FeatureType.TRANSACTION, "float", "Beneficiary risk score"),
            FeatureDefinition("is_new_device", FeatureType.TRANSACTION, "bool", "Is new device"),
            FeatureDefinition("device_trust_score", FeatureType.TRANSACTION, "float", "Device trust score"),
            FeatureDefinition("time_of_day_risk", FeatureType.TRANSACTION, "float", "Time of day risk score"),
            FeatureDefinition("time_since_last_tx_minutes", FeatureType.TRANSACTION, "int", "Minutes since last tx"),
        ]
        
        # Device features
        device_features = [
            FeatureDefinition("device_age_days", FeatureType.DEVICE, "int", "Days since device registration"),
            FeatureDefinition("device_tx_count", FeatureType.DEVICE, "int", "Transactions from this device"),
            FeatureDefinition("device_fraud_rate", FeatureType.DEVICE, "float", "Fraud rate on this device"),
            FeatureDefinition("device_users_count", FeatureType.DEVICE, "int", "Users on this device"),
            FeatureDefinition("is_rooted", FeatureType.DEVICE, "bool", "Is device rooted/jailbroken"),
            FeatureDefinition("is_emulator", FeatureType.DEVICE, "bool", "Is device an emulator"),
        ]
        
        for feature in user_features + transaction_features + device_features:
            self._feature_definitions[feature.name] = feature
    
    def _get_cache_key(self, entity_type: str, entity_id: str) -> str:
        return f"features:{entity_type}:{entity_id}"
    
    def set_features(self, entity_type: str, entity_id: str, features: Dict[str, Any], ttl: int = None) -> bool:
        """Store features for an entity"""
        cache_key = self._get_cache_key(entity_type, entity_id)
        
        feature_vector = {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "features": features,
            "computed_at": datetime.utcnow().isoformat(),
            "version": "1.0.0",
            "ttl_seconds": ttl or FEATURE_TTL_SECONDS,
            "expires_at": (datetime.utcnow() + timedelta(seconds=ttl or FEATURE_TTL_SECONDS)).isoformat()
        }
        
        self._cache[cache_key] = feature_vector
        return True
    
    def get_features(self, entity_type: str, entity_id: str, feature_names: List[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieve features for an entity"""
        cache_key = self._get_cache_key(entity_type, entity_id)
        
        if cache_key not in self._cache:
            return None
        
        cached = self._cache[cache_key]
        
        # Check expiration
        expires_at = datetime.fromisoformat(cached["expires_at"])
        if datetime.utcnow() > expires_at:
            del self._cache[cache_key]
            return None
        
        features = cached["features"]
        
        # Filter to requested features if specified
        if feature_names:
            features = {k: v for k, v in features.items() if k in feature_names}
        
        return {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "features": features,
            "computed_at": cached["computed_at"],
            "version": cached["version"]
        }
    
    def delete_features(self, entity_type: str, entity_id: str) -> bool:
        """Delete features for an entity"""
        cache_key = self._get_cache_key(entity_type, entity_id)
        if cache_key in self._cache:
            del self._cache[cache_key]
            return True
        return False
    
    def get_batch_features(self, entity_type: str, entity_ids: List[str], feature_names: List[str] = None) -> List[Dict]:
        """Retrieve features for multiple entities"""
        results = []
        for entity_id in entity_ids:
            features = self.get_features(entity_type, entity_id, feature_names)
            if features:
                results.append(features)
            else:
                results.append({
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "features": {},
                    "computed_at": None,
                    "version": None
                })
        return results
    
    def get_feature_definitions(self, feature_type: FeatureType = None) -> List[FeatureDefinition]:
        """Get all feature definitions, optionally filtered by type"""
        definitions = list(self._feature_definitions.values())
        if feature_type:
            definitions = [d for d in definitions if d.feature_type == feature_type]
        return definitions
    
    def get_stats(self) -> Dict[str, Any]:
        """Get feature store statistics"""
        return {
            "total_cached_entities": len(self._cache),
            "total_feature_definitions": len(self._feature_definitions),
            "storage_type": "in-memory"
        }


class RedisFeatureStore:
    """Redis-backed feature store for production"""
    
    def __init__(self, redis_url: str = None):
        self._redis_url = redis_url or REDIS_URL
        self._client = None
        self._feature_definitions: Dict[str, FeatureDefinition] = {}
        self._initialize_feature_definitions()
        self._connect()
    
    def _initialize_feature_definitions(self):
        """Initialize standard feature definitions (same as in-memory)"""
        # User features
        user_features = [
            FeatureDefinition("account_age_days", FeatureType.USER, "int", "Days since account creation"),
            FeatureDefinition("kyc_level", FeatureType.USER, "int", "KYC verification level (1-3)"),
            FeatureDefinition("total_transactions", FeatureType.USER, "int", "Total transaction count"),
            FeatureDefinition("total_volume_usd", FeatureType.USER, "float", "Total transaction volume in USD"),
            FeatureDefinition("avg_transaction_value", FeatureType.USER, "float", "Average transaction value"),
            FeatureDefinition("tx_frequency_30d", FeatureType.USER, "int", "Transactions in last 30 days"),
            FeatureDefinition("unique_beneficiaries", FeatureType.USER, "int", "Unique beneficiaries count"),
            FeatureDefinition("velocity_hourly", FeatureType.USER, "int", "Transactions in last hour"),
            FeatureDefinition("velocity_daily", FeatureType.USER, "int", "Transactions in last 24 hours"),
            FeatureDefinition("historical_fraud_rate", FeatureType.USER, "float", "Historical fraud rate"),
            FeatureDefinition("engagement_score", FeatureType.USER, "float", "App engagement score"),
        ]
        
        for feature in user_features:
            self._feature_definitions[feature.name] = feature
    
    def _connect(self):
        """Connect to Redis"""
        if not REDIS_AVAILABLE:
            logger.warning("Redis not available")
            return
        
        try:
            self._client = redis.from_url(self._redis_url, decode_responses=True)
            self._client.ping()
            logger.info(f"Connected to Redis at {self._redis_url}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self._client = None
    
    def _get_cache_key(self, entity_type: str, entity_id: str) -> str:
        return f"features:{entity_type}:{entity_id}"
    
    def set_features(self, entity_type: str, entity_id: str, features: Dict[str, Any], ttl: int = None) -> bool:
        """Store features for an entity in Redis"""
        if not self._client:
            return False
        
        cache_key = self._get_cache_key(entity_type, entity_id)
        ttl = ttl or FEATURE_TTL_SECONDS
        
        feature_vector = {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "features": features,
            "computed_at": datetime.utcnow().isoformat(),
            "version": "1.0.0"
        }
        
        try:
            self._client.setex(cache_key, ttl, json.dumps(feature_vector))
            return True
        except Exception as e:
            logger.error(f"Failed to set features in Redis: {e}")
            return False
    
    def get_features(self, entity_type: str, entity_id: str, feature_names: List[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieve features for an entity from Redis"""
        if not self._client:
            return None
        
        cache_key = self._get_cache_key(entity_type, entity_id)
        
        try:
            data = self._client.get(cache_key)
            if not data:
                return None
            
            cached = json.loads(data)
            features = cached["features"]
            
            if feature_names:
                features = {k: v for k, v in features.items() if k in feature_names}
            
            return {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "features": features,
                "computed_at": cached["computed_at"],
                "version": cached["version"]
            }
        except Exception as e:
            logger.error(f"Failed to get features from Redis: {e}")
            return None
    
    def delete_features(self, entity_type: str, entity_id: str) -> bool:
        """Delete features for an entity from Redis"""
        if not self._client:
            return False
        
        cache_key = self._get_cache_key(entity_type, entity_id)
        try:
            self._client.delete(cache_key)
            return True
        except Exception as e:
            logger.error(f"Failed to delete features from Redis: {e}")
            return False
    
    def get_batch_features(self, entity_type: str, entity_ids: List[str], feature_names: List[str] = None) -> List[Dict]:
        """Retrieve features for multiple entities using Redis pipeline"""
        if not self._client:
            return []
        
        try:
            pipe = self._client.pipeline()
            for entity_id in entity_ids:
                cache_key = self._get_cache_key(entity_type, entity_id)
                pipe.get(cache_key)
            
            results = []
            for entity_id, data in zip(entity_ids, pipe.execute()):
                if data:
                    cached = json.loads(data)
                    features = cached["features"]
                    if feature_names:
                        features = {k: v for k, v in features.items() if k in feature_names}
                    results.append({
                        "entity_type": entity_type,
                        "entity_id": entity_id,
                        "features": features,
                        "computed_at": cached["computed_at"],
                        "version": cached["version"]
                    })
                else:
                    results.append({
                        "entity_type": entity_type,
                        "entity_id": entity_id,
                        "features": {},
                        "computed_at": None,
                        "version": None
                    })
            return results
        except Exception as e:
            logger.error(f"Failed to get batch features from Redis: {e}")
            return []
    
    def get_feature_definitions(self, feature_type: FeatureType = None) -> List[FeatureDefinition]:
        """Get all feature definitions"""
        definitions = list(self._feature_definitions.values())
        if feature_type:
            definitions = [d for d in definitions if d.feature_type == feature_type]
        return definitions
    
    def get_stats(self) -> Dict[str, Any]:
        """Get feature store statistics"""
        if not self._client:
            return {"storage_type": "redis", "connected": False}
        
        try:
            info = self._client.info("keyspace")
            keys_count = 0
            for db_info in info.values():
                if isinstance(db_info, dict):
                    keys_count += db_info.get("keys", 0)
            
            return {
                "storage_type": "redis",
                "connected": True,
                "total_keys": keys_count,
                "total_feature_definitions": len(self._feature_definitions)
            }
        except Exception as e:
            logger.error(f"Failed to get Redis stats: {e}")
            return {"storage_type": "redis", "connected": False, "error": str(e)}


def get_feature_store() -> Union[RedisFeatureStore, InMemoryFeatureStore]:
    """Get the appropriate feature store based on configuration"""
    if USE_REDIS and REDIS_AVAILABLE:
        store = RedisFeatureStore()
        if store._client:
            return store
        logger.warning("Redis connection failed, falling back to in-memory store")
    
    return InMemoryFeatureStore()


# Global feature store instance
_feature_store = None


def init_feature_store() -> Union[RedisFeatureStore, InMemoryFeatureStore]:
    """Initialize and return the global feature store"""
    global _feature_store
    if _feature_store is None:
        _feature_store = get_feature_store()
    return _feature_store
