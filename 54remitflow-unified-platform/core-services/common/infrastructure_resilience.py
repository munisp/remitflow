"""
Infrastructure Resilience for Developing Countries

Comprehensive implementation for:
1. Extended Offline Support (7+ days)
2. 2G Network Optimization
3. Power Management
4. Feature Phone Support (USSD/SMS)
5. Older Smartphone Optimization

Designed for African markets with infrastructure challenges.
"""

import asyncio
import gzip
import hashlib
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# =============================================================================
# CONFIGURATION CONSTANTS
# =============================================================================

class OfflineConfig:
    """Offline support configuration"""
    # Maximum days the app can function offline
    MAX_OFFLINE_DAYS = 7
    
    # Cache TTLs (in hours)
    BALANCE_CACHE_TTL_HOURS = 24  # Show "as of" warning after this
    TRANSACTION_CACHE_TTL_HOURS = 72
    BENEFICIARY_CACHE_TTL_HOURS = 168  # 7 days
    FX_RATE_CACHE_TTL_HOURS = 4  # Rates change frequently
    REFERENCE_DATA_CACHE_TTL_HOURS = 720  # 30 days for static data
    
    # Queue retention
    PENDING_QUEUE_RETENTION_DAYS = 14
    COMPLETED_QUEUE_RETENTION_DAYS = 7
    
    # Sync settings
    MAX_RETRY_ATTEMPTS = 5
    RETRY_BACKOFF_BASE_SECONDS = 30
    MAX_RETRY_BACKOFF_SECONDS = 3600  # 1 hour max
    
    # Offline restrictions
    MAX_OFFLINE_TRANSFER_AMOUNT = 50000  # NGN - limit risk for offline transfers
    BLOCK_HIGH_VALUE_AFTER_DAYS = 3  # Block high-value transfers after 3 days offline


class NetworkConfig:
    """Network optimization configuration"""
    # Connection types
    CONNECTION_2G = "2g"
    CONNECTION_3G = "3g"
    CONNECTION_4G = "4g"
    CONNECTION_WIFI = "wifi"
    CONNECTION_UNKNOWN = "unknown"
    
    # Sync intervals by connection type (seconds)
    SYNC_INTERVAL_2G = 300  # 5 minutes
    SYNC_INTERVAL_3G = 120  # 2 minutes
    SYNC_INTERVAL_4G = 60   # 1 minute
    SYNC_INTERVAL_WIFI = 30 # 30 seconds
    
    # Batch sizes by connection type
    BATCH_SIZE_2G = 5
    BATCH_SIZE_3G = 10
    BATCH_SIZE_4G = 25
    BATCH_SIZE_WIFI = 50
    
    # Compression thresholds
    COMPRESS_THRESHOLD_BYTES = 1024  # Compress payloads > 1KB
    
    # Request timeouts by connection type (seconds)
    TIMEOUT_2G = 60
    TIMEOUT_3G = 30
    TIMEOUT_4G = 15
    TIMEOUT_WIFI = 10


class PowerConfig:
    """Power management configuration"""
    # Battery thresholds
    CRITICAL_BATTERY_PERCENT = 10
    LOW_BATTERY_PERCENT = 20
    
    # Sync behavior by battery level
    SYNC_DISABLED_BELOW_PERCENT = 5
    REDUCED_SYNC_BELOW_PERCENT = 20
    
    # Background job limits
    MAX_BACKGROUND_JOBS_LOW_BATTERY = 1
    MAX_BACKGROUND_JOBS_NORMAL = 5
    
    # Wake lock durations (seconds)
    SYNC_WAKE_LOCK_SECONDS = 30
    CRITICAL_WAKE_LOCK_SECONDS = 60


class DeviceTier(str, Enum):
    """Device capability tiers"""
    TIER_1_MODERN = "tier_1"      # Modern devices: full features
    TIER_2_CAPABLE = "tier_2"    # Older but capable: reduced features
    TIER_3_BASIC = "tier_3"      # Very old/weak: essential only
    FEATURE_PHONE = "feature"    # Feature phones: USSD/SMS only


# =============================================================================
# EXTENDED OFFLINE SUPPORT (7+ DAYS)
# =============================================================================

class CacheCategory(str, Enum):
    """Categories of cached data"""
    COLD = "cold"      # Reference data, changes rarely (weeks)
    WARM = "warm"      # Personal data, moderate freshness (days)
    HOT = "hot"        # Frequently changing data (hours)
    STAGED = "staged"  # User-initiated operations waiting to sync


@dataclass
class CachedItem:
    """Cached data item with metadata"""
    key: str
    category: CacheCategory
    data: Any
    cached_at: datetime
    ttl_hours: int
    version: int = 1
    checksum: str = ""
    
    def __post_init__(self):
        if not self.checksum:
            self.checksum = self._calculate_checksum()
            
    def _calculate_checksum(self) -> str:
        """Calculate data checksum for integrity"""
        data_str = json.dumps(self.data, sort_keys=True, default=str)
        return hashlib.md5(data_str.encode()).hexdigest()[:8]
        
    @property
    def expires_at(self) -> datetime:
        return self.cached_at + timedelta(hours=self.ttl_hours)
        
    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() > self.expires_at
        
    @property
    def is_stale(self) -> bool:
        """Data is stale but still usable with warning"""
        stale_threshold = self.cached_at + timedelta(hours=self.ttl_hours * 0.75)
        return datetime.utcnow() > stale_threshold
        
    @property
    def age_hours(self) -> float:
        return (datetime.utcnow() - self.cached_at).total_seconds() / 3600


class QueuedOperation(BaseModel):
    """Operation queued for offline sync"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    idempotency_key: str = Field(default_factory=lambda: f"idem_{uuid.uuid4().hex[:16]}")
    operation_type: str
    payload: dict
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_attempt_at: Optional[datetime] = None
    attempt_count: int = 0
    status: str = "pending"  # pending, syncing, completed, failed, blocked
    error_message: Optional[str] = None
    server_transaction_id: Optional[str] = None
    
    # Offline context
    offline_balance_snapshot: Optional[float] = None
    offline_rate_snapshot: Optional[float] = None
    ui_version: Optional[str] = None
    
    class Config:
        json_encoders = {datetime: lambda v: v.isoformat()}


class OfflineDataManager:
    """
    Manages offline data persistence and sync queue.
    
    Guarantees:
    - Core flows usable for up to 7 days offline
    - Balance display guaranteed fresh for 24 hours
    - Queued operations retained for 14 days
    - Idempotency keys prevent double-spend on reconnect
    """
    
    def __init__(self):
        self.cache: dict[str, CachedItem] = {}
        self.operation_queue: list[QueuedOperation] = []
        self.last_online_at: Optional[datetime] = None
        self.last_sync_at: Optional[datetime] = None
        
    @property
    def offline_duration_hours(self) -> float:
        """How long we've been offline"""
        if self.last_online_at is None:
            return 0
        return (datetime.utcnow() - self.last_online_at).total_seconds() / 3600
        
    @property
    def offline_duration_days(self) -> float:
        return self.offline_duration_hours / 24
        
    def can_perform_operation(self, operation_type: str, amount: float = 0) -> tuple[bool, str]:
        """
        Check if an operation can be performed offline.
        
        Returns (allowed, reason)
        """
        # Check offline duration
        if self.offline_duration_days > OfflineConfig.MAX_OFFLINE_DAYS:
            return False, f"Offline for {self.offline_duration_days:.1f} days. Please connect to sync."
            
        # Check high-value transfer restrictions
        if operation_type == "transfer" and amount > OfflineConfig.MAX_OFFLINE_TRANSFER_AMOUNT:
            if self.offline_duration_days > OfflineConfig.BLOCK_HIGH_VALUE_AFTER_DAYS:
                return False, f"High-value transfers blocked after {OfflineConfig.BLOCK_HIGH_VALUE_AFTER_DAYS} days offline."
                
        # Check if we have required cached data
        if operation_type == "transfer":
            balance = self.get_cached("wallet_balance")
            if balance is None:
                return False, "Balance data not available. Please connect to sync."
            if balance.is_expired:
                return False, "Balance data expired. Please connect to sync."
                
        return True, "OK"
        
    def cache_data(
        self,
        key: str,
        data: Any,
        category: CacheCategory,
        ttl_hours: Optional[int] = None
    ) -> CachedItem:
        """Cache data with appropriate TTL"""
        if ttl_hours is None:
            ttl_hours = self._get_default_ttl(category)
            
        item = CachedItem(
            key=key,
            category=category,
            data=data,
            cached_at=datetime.utcnow(),
            ttl_hours=ttl_hours
        )
        self.cache[key] = item
        return item
        
    def get_cached(self, key: str) -> Optional[CachedItem]:
        """Get cached data if available and not expired"""
        item = self.cache.get(key)
        if item is None:
            return None
        if item.is_expired:
            del self.cache[key]
            return None
        return item
        
    def get_cached_with_staleness(self, key: str) -> tuple[Optional[Any], bool, Optional[datetime]]:
        """
        Get cached data with staleness info.
        
        Returns (data, is_stale, cached_at)
        """
        item = self.get_cached(key)
        if item is None:
            return None, False, None
        return item.data, item.is_stale, item.cached_at
        
    def queue_operation(
        self,
        operation_type: str,
        payload: dict,
        balance_snapshot: Optional[float] = None,
        rate_snapshot: Optional[float] = None
    ) -> QueuedOperation:
        """Queue an operation for offline sync"""
        operation = QueuedOperation(
            operation_type=operation_type,
            payload=payload,
            offline_balance_snapshot=balance_snapshot,
            offline_rate_snapshot=rate_snapshot
        )
        self.operation_queue.append(operation)
        return operation
        
    def get_pending_operations(self) -> list[QueuedOperation]:
        """Get operations pending sync"""
        return [op for op in self.operation_queue if op.status in ("pending", "failed")]
        
    def mark_operation_synced(self, operation_id: str, server_transaction_id: str) -> None:
        """Mark operation as successfully synced"""
        for op in self.operation_queue:
            if op.id == operation_id:
                op.status = "completed"
                op.server_transaction_id = server_transaction_id
                break
                
    def mark_operation_failed(self, operation_id: str, error: str) -> None:
        """Mark operation as failed"""
        for op in self.operation_queue:
            if op.id == operation_id:
                op.status = "failed"
                op.error_message = error
                op.attempt_count += 1
                op.last_attempt_at = datetime.utcnow()
                break
                
    def cleanup_old_operations(self) -> int:
        """Remove old completed/failed operations"""
        cutoff_completed = datetime.utcnow() - timedelta(days=OfflineConfig.COMPLETED_QUEUE_RETENTION_DAYS)
        cutoff_pending = datetime.utcnow() - timedelta(days=OfflineConfig.PENDING_QUEUE_RETENTION_DAYS)
        
        original_count = len(self.operation_queue)
        self.operation_queue = [
            op for op in self.operation_queue
            if not (
                (op.status == "completed" and op.created_at < cutoff_completed) or
                (op.status in ("pending", "failed") and op.created_at < cutoff_pending)
            )
        ]
        return original_count - len(self.operation_queue)
        
    def _get_default_ttl(self, category: CacheCategory) -> int:
        """Get default TTL for cache category"""
        ttls = {
            CacheCategory.COLD: OfflineConfig.REFERENCE_DATA_CACHE_TTL_HOURS,
            CacheCategory.WARM: OfflineConfig.TRANSACTION_CACHE_TTL_HOURS,
            CacheCategory.HOT: OfflineConfig.FX_RATE_CACHE_TTL_HOURS,
            CacheCategory.STAGED: OfflineConfig.PENDING_QUEUE_RETENTION_DAYS * 24
        }
        return ttls.get(category, 24)


# =============================================================================
# 2G NETWORK OPTIMIZATION
# =============================================================================

class NetworkProfile:
    """Network profile for adaptive behavior"""
    
    def __init__(self):
        self.connection_type: str = NetworkConfig.CONNECTION_UNKNOWN
        self.effective_bandwidth_kbps: float = 0
        self.rtt_ms: float = 0
        self.is_metered: bool = True
        self.save_data_enabled: bool = False
        
    def update_from_connection_info(
        self,
        connection_type: str,
        downlink_mbps: Optional[float] = None,
        rtt_ms: Optional[float] = None,
        save_data: bool = False
    ) -> None:
        """Update profile from navigator.connection or native API"""
        self.connection_type = connection_type
        self.effective_bandwidth_kbps = (downlink_mbps or 0) * 1000
        self.rtt_ms = rtt_ms or self._estimate_rtt(connection_type)
        self.save_data_enabled = save_data
        
    def _estimate_rtt(self, connection_type: str) -> float:
        """Estimate RTT based on connection type"""
        estimates = {
            NetworkConfig.CONNECTION_2G: 2000,
            NetworkConfig.CONNECTION_3G: 500,
            NetworkConfig.CONNECTION_4G: 100,
            NetworkConfig.CONNECTION_WIFI: 50,
        }
        return estimates.get(connection_type, 1000)
        
    @property
    def is_slow_connection(self) -> bool:
        return self.connection_type in (NetworkConfig.CONNECTION_2G, NetworkConfig.CONNECTION_3G)
        
    @property
    def sync_interval_seconds(self) -> int:
        intervals = {
            NetworkConfig.CONNECTION_2G: NetworkConfig.SYNC_INTERVAL_2G,
            NetworkConfig.CONNECTION_3G: NetworkConfig.SYNC_INTERVAL_3G,
            NetworkConfig.CONNECTION_4G: NetworkConfig.SYNC_INTERVAL_4G,
            NetworkConfig.CONNECTION_WIFI: NetworkConfig.SYNC_INTERVAL_WIFI,
        }
        return intervals.get(self.connection_type, NetworkConfig.SYNC_INTERVAL_3G)
        
    @property
    def batch_size(self) -> int:
        sizes = {
            NetworkConfig.CONNECTION_2G: NetworkConfig.BATCH_SIZE_2G,
            NetworkConfig.CONNECTION_3G: NetworkConfig.BATCH_SIZE_3G,
            NetworkConfig.CONNECTION_4G: NetworkConfig.BATCH_SIZE_4G,
            NetworkConfig.CONNECTION_WIFI: NetworkConfig.BATCH_SIZE_WIFI,
        }
        return sizes.get(self.connection_type, NetworkConfig.BATCH_SIZE_3G)
        
    @property
    def request_timeout_seconds(self) -> int:
        timeouts = {
            NetworkConfig.CONNECTION_2G: NetworkConfig.TIMEOUT_2G,
            NetworkConfig.CONNECTION_3G: NetworkConfig.TIMEOUT_3G,
            NetworkConfig.CONNECTION_4G: NetworkConfig.TIMEOUT_4G,
            NetworkConfig.CONNECTION_WIFI: NetworkConfig.TIMEOUT_WIFI,
        }
        return timeouts.get(self.connection_type, NetworkConfig.TIMEOUT_3G)


class RequestCompressor:
    """Compress requests for slow networks"""
    
    @staticmethod
    def compress(data: bytes) -> tuple[bytes, bool]:
        """Compress data if above threshold"""
        if len(data) < NetworkConfig.COMPRESS_THRESHOLD_BYTES:
            return data, False
        compressed = gzip.compress(data, compresslevel=6)
        # Only use compression if it actually reduces size
        if len(compressed) < len(data):
            return compressed, True
        return data, False
        
    @staticmethod
    def decompress(data: bytes, is_compressed: bool) -> bytes:
        """Decompress data if it was compressed"""
        if not is_compressed:
            return data
        return gzip.decompress(data)


class DeltaSyncManager:
    """Manage delta sync for efficient updates"""
    
    def __init__(self):
        self.sync_tokens: dict[str, str] = {}
        self.last_sync_timestamps: dict[str, datetime] = {}
        
    def get_sync_params(self, resource: str) -> dict:
        """Get sync parameters for a resource"""
        params = {}
        
        if resource in self.sync_tokens:
            params["sync_token"] = self.sync_tokens[resource]
            
        if resource in self.last_sync_timestamps:
            params["since"] = self.last_sync_timestamps[resource].isoformat()
            
        return params
        
    def update_sync_state(self, resource: str, sync_token: Optional[str], timestamp: datetime) -> None:
        """Update sync state after successful sync"""
        if sync_token:
            self.sync_tokens[resource] = sync_token
        self.last_sync_timestamps[resource] = timestamp


class RequestBatcher:
    """Batch multiple requests for slow networks"""
    
    def __init__(self, network_profile: NetworkProfile):
        self.network_profile = network_profile
        self.pending_requests: list[dict] = []
        
    def add_request(self, endpoint: str, method: str, payload: Optional[dict] = None) -> str:
        """Add request to batch, returns request ID"""
        request_id = str(uuid.uuid4())
        self.pending_requests.append({
            "id": request_id,
            "endpoint": endpoint,
            "method": method,
            "payload": payload
        })
        return request_id
        
    def should_flush(self) -> bool:
        """Check if batch should be sent"""
        return len(self.pending_requests) >= self.network_profile.batch_size
        
    def get_batch_payload(self) -> dict:
        """Get batch payload for sending"""
        payload = {
            "requests": self.pending_requests.copy(),
            "batch_id": str(uuid.uuid4())
        }
        self.pending_requests.clear()
        return payload


class NetworkOptimizer:
    """
    Optimizes network usage for 2G and slow connections.
    
    Features:
    - Adaptive sync intervals based on connection type
    - Request batching to reduce round trips
    - Payload compression for large requests
    - Delta sync to minimize data transfer
    - Progressive loading for lists
    """
    
    def __init__(self):
        self.profile = NetworkProfile()
        self.delta_sync = DeltaSyncManager()
        self.batcher: Optional[RequestBatcher] = None
        
    def update_connection(
        self,
        connection_type: str,
        downlink_mbps: Optional[float] = None,
        rtt_ms: Optional[float] = None,
        save_data: bool = False
    ) -> None:
        """Update network profile"""
        self.profile.update_from_connection_info(
            connection_type, downlink_mbps, rtt_ms, save_data
        )
        
        # Create batcher for slow connections
        if self.profile.is_slow_connection:
            self.batcher = RequestBatcher(self.profile)
        else:
            self.batcher = None
            
    def prepare_request(self, endpoint: str, method: str, payload: Optional[dict] = None) -> dict:
        """
        Prepare a request with optimizations.
        
        Returns request config with compression and batching info.
        """
        config = {
            "endpoint": endpoint,
            "method": method,
            "timeout": self.profile.request_timeout_seconds,
            "headers": {}
        }
        
        if payload:
            payload_bytes = json.dumps(payload).encode()
            compressed, is_compressed = RequestCompressor.compress(payload_bytes)
            
            if is_compressed:
                config["body"] = compressed
                config["headers"]["Content-Encoding"] = "gzip"
            else:
                config["body"] = payload_bytes
                
        return config
        
    def get_progressive_load_params(self, resource: str, page_size: int = 10) -> dict:
        """Get params for progressive loading on slow connections"""
        if self.profile.is_slow_connection:
            # Smaller page size for slow connections
            page_size = min(page_size, 5)
            
        params = {
            "limit": page_size,
            "fields": "essential"  # Request only essential fields
        }
        
        # Add delta sync params
        params.update(self.delta_sync.get_sync_params(resource))
        
        return params


# =============================================================================
# POWER MANAGEMENT
# =============================================================================

class BatteryState:
    """Battery state information"""
    
    def __init__(self):
        self.level_percent: float = 100
        self.is_charging: bool = False
        self.charging_time_seconds: Optional[float] = None
        self.discharging_time_seconds: Optional[float] = None
        
    def update(
        self,
        level: float,
        charging: bool,
        charging_time: Optional[float] = None,
        discharging_time: Optional[float] = None
    ) -> None:
        self.level_percent = level * 100 if level <= 1 else level
        self.is_charging = charging
        self.charging_time_seconds = charging_time
        self.discharging_time_seconds = discharging_time
        
    @property
    def is_critical(self) -> bool:
        return self.level_percent <= PowerConfig.CRITICAL_BATTERY_PERCENT
        
    @property
    def is_low(self) -> bool:
        return self.level_percent <= PowerConfig.LOW_BATTERY_PERCENT
        
    @property
    def can_sync(self) -> bool:
        """Check if sync is allowed based on battery"""
        if self.is_charging:
            return True
        return self.level_percent > PowerConfig.SYNC_DISABLED_BELOW_PERCENT


class PowerManager:
    """
    Manages power consumption for mobile devices.
    
    Features:
    - Battery-aware sync scheduling
    - Background job limits based on battery level
    - Deferred sync when on low battery
    - Opportunistic sync when charging
    """
    
    def __init__(self):
        self.battery = BatteryState()
        self.deferred_syncs: list[dict] = []
        self.power_save_mode: bool = False
        
    def update_battery_state(
        self,
        level: float,
        charging: bool,
        charging_time: Optional[float] = None,
        discharging_time: Optional[float] = None
    ) -> None:
        """Update battery state from device API"""
        was_charging = self.battery.is_charging
        self.battery.update(level, charging, charging_time, discharging_time)
        
        # Trigger deferred syncs when plugged in
        if charging and not was_charging and self.deferred_syncs:
            logger.info(f"Device plugged in, {len(self.deferred_syncs)} deferred syncs ready")
            
    def set_power_save_mode(self, enabled: bool) -> None:
        """Set power save mode (from OS or user setting)"""
        self.power_save_mode = enabled
        
    def should_sync_now(self, priority: str = "normal") -> tuple[bool, str]:
        """
        Check if sync should happen now.
        
        Returns (should_sync, reason)
        """
        if not self.battery.can_sync:
            return False, "Battery too low for sync"
            
        if self.power_save_mode and priority != "critical":
            return False, "Power save mode enabled"
            
        if self.battery.is_low and not self.battery.is_charging:
            if priority == "normal":
                return False, "Low battery, deferring non-critical sync"
                
        return True, "OK"
        
    def defer_sync(self, sync_type: str, payload: dict) -> None:
        """Defer a sync operation until conditions improve"""
        self.deferred_syncs.append({
            "type": sync_type,
            "payload": payload,
            "deferred_at": datetime.utcnow().isoformat()
        })
        
    def get_deferred_syncs(self) -> list[dict]:
        """Get and clear deferred syncs"""
        syncs = self.deferred_syncs.copy()
        self.deferred_syncs.clear()
        return syncs
        
    def get_max_background_jobs(self) -> int:
        """Get maximum allowed background jobs"""
        if self.battery.is_low and not self.battery.is_charging:
            return PowerConfig.MAX_BACKGROUND_JOBS_LOW_BATTERY
        return PowerConfig.MAX_BACKGROUND_JOBS_NORMAL
        
    def get_sync_strategy(self) -> dict:
        """Get recommended sync strategy based on power state"""
        strategy = {
            "sync_enabled": self.battery.can_sync,
            "max_jobs": self.get_max_background_jobs(),
            "defer_non_critical": self.battery.is_low and not self.battery.is_charging,
            "aggressive_sync": self.battery.is_charging and self.battery.level_percent > 50,
            "recommendations": []
        }
        
        if self.battery.is_critical:
            strategy["recommendations"].append("Critical battery - only essential operations")
        elif self.battery.is_low:
            strategy["recommendations"].append("Low battery - sync deferred until charging")
        elif self.battery.is_charging:
            strategy["recommendations"].append("Charging - good time for full sync")
            
        return strategy


# =============================================================================
# FEATURE PHONE SUPPORT (USSD/SMS)
# =============================================================================

class USSDMenuBuilder:
    """Build USSD menus for feature phones"""
    
    MAX_MENU_LENGTH = 160  # Standard SMS length
    MAX_OPTIONS = 9  # Single digit selection
    
    @staticmethod
    def build_menu(title: str, options: list[tuple[str, str]], footer: str = "0. Back") -> str:
        """
        Build a USSD menu string.
        
        Args:
            title: Menu title
            options: List of (key, label) tuples
            footer: Footer text (usually navigation)
        """
        lines = [title]
        
        for key, label in options[:USSDMenuBuilder.MAX_OPTIONS]:
            lines.append(f"{key}. {label}")
            
        if footer:
            lines.append(footer)
            
        menu = "\n".join(lines)
        
        # Truncate if too long
        if len(menu) > USSDMenuBuilder.MAX_MENU_LENGTH:
            menu = menu[:USSDMenuBuilder.MAX_MENU_LENGTH - 3] + "..."
            
        return menu
        
    @staticmethod
    def format_amount(amount: float, currency: str = "NGN") -> str:
        """Format amount for USSD display"""
        if currency == "NGN":
            return f"N{amount:,.0f}"
        return f"{currency}{amount:,.2f}"
        
    @staticmethod
    def truncate_name(name: str, max_length: int = 15) -> str:
        """Truncate name for USSD display"""
        if len(name) <= max_length:
            return name
        return name[:max_length - 2] + ".."


class SMSGateway:
    """SMS gateway for notifications and OTPs"""
    
    def __init__(self):
        self.pending_messages: list[dict] = []
        self.sent_messages: dict[str, dict] = {}
        
    def queue_message(
        self,
        phone: str,
        message: str,
        message_type: str = "notification",
        priority: str = "normal"
    ) -> str:
        """Queue an SMS message for sending"""
        message_id = str(uuid.uuid4())
        
        # Truncate to SMS length
        if len(message) > 160:
            message = message[:157] + "..."
            
        self.pending_messages.append({
            "id": message_id,
            "phone": phone,
            "message": message,
            "type": message_type,
            "priority": priority,
            "queued_at": datetime.utcnow().isoformat(),
            "attempts": 0
        })
        
        return message_id
        
    def queue_otp(self, phone: str, otp: str, expiry_minutes: int = 5) -> str:
        """Queue an OTP SMS"""
        message = f"Your verification code is {otp}. Valid for {expiry_minutes} minutes. Do not share."
        return self.queue_message(phone, message, "otp", "high")
        
    def queue_transaction_notification(
        self,
        phone: str,
        transaction_type: str,
        amount: float,
        currency: str = "NGN",
        reference: str = ""
    ) -> str:
        """Queue a transaction notification SMS"""
        amount_str = USSDMenuBuilder.format_amount(amount, currency)
        
        if transaction_type == "credit":
            message = f"Credit: {amount_str} received. Ref: {reference}"
        elif transaction_type == "debit":
            message = f"Debit: {amount_str} sent. Ref: {reference}"
        else:
            message = f"Transaction: {amount_str}. Ref: {reference}"
            
        return self.queue_message(phone, message, "transaction", "high")
        
    def get_pending_messages(self, priority: Optional[str] = None) -> list[dict]:
        """Get pending messages, optionally filtered by priority"""
        if priority:
            return [m for m in self.pending_messages if m["priority"] == priority]
        return self.pending_messages.copy()


class FeaturePhoneSupport:
    """
    Support for feature phones via USSD and SMS.
    
    Core flows supported:
    1. Check balance
    2. Send money to saved beneficiary
    3. Buy airtime
    4. View recent transactions
    5. Cash out
    """
    
    def __init__(self):
        self.sms_gateway = SMSGateway()
        
    def get_main_menu(self, user_name: str) -> str:
        """Get main USSD menu"""
        first_name = user_name.split()[0] if user_name else "User"
        return USSDMenuBuilder.build_menu(
            f"Welcome {first_name}!",
            [
                ("1", "Check Balance"),
                ("2", "Send Money"),
                ("3", "Buy Airtime"),
                ("4", "Recent Txns"),
                ("5", "Cash Out"),
            ],
            "0. Exit"
        )
        
    def get_beneficiary_menu(self, beneficiaries: list[dict]) -> str:
        """Get beneficiary selection menu"""
        options = []
        for i, ben in enumerate(beneficiaries[:5], 1):
            name = USSDMenuBuilder.truncate_name(ben.get("name", "Unknown"))
            phone_suffix = ben.get("phone", "")[-4:]
            options.append((str(i), f"{name} ({phone_suffix})"))
            
        return USSDMenuBuilder.build_menu(
            "Select recipient:",
            options,
            "0. Back"
        )
        
    def get_amount_prompt(self, balance: float, currency: str = "NGN") -> str:
        """Get amount entry prompt"""
        balance_str = USSDMenuBuilder.format_amount(balance, currency)
        return f"Enter amount:\n(Balance: {balance_str})"
        
    def get_confirmation_menu(
        self,
        action: str,
        recipient: str,
        amount: float,
        fee: float = 0,
        currency: str = "NGN"
    ) -> str:
        """Get transaction confirmation menu"""
        amount_str = USSDMenuBuilder.format_amount(amount, currency)
        total = amount + fee
        total_str = USSDMenuBuilder.format_amount(total, currency)
        
        lines = [
            f"Confirm {action}:",
            f"To: {USSDMenuBuilder.truncate_name(recipient)}",
            f"Amount: {amount_str}",
        ]
        
        if fee > 0:
            fee_str = USSDMenuBuilder.format_amount(fee, currency)
            lines.append(f"Fee: {fee_str}")
            lines.append(f"Total: {total_str}")
            
        lines.extend(["", "1. Confirm", "0. Cancel"])
        
        return "\n".join(lines)
        
    def format_transaction_history(self, transactions: list[dict]) -> str:
        """Format transaction history for USSD"""
        if not transactions:
            return "No recent transactions."
            
        lines = ["Recent Transactions:"]
        
        for txn in transactions[:3]:
            txn_type = txn.get("type", "")
            amount = txn.get("amount", 0)
            amount_str = USSDMenuBuilder.format_amount(amount)
            
            if txn_type == "sent":
                recipient = USSDMenuBuilder.truncate_name(txn.get("to", ""), 10)
                lines.append(f"- Sent {amount_str} to {recipient}")
            elif txn_type == "received":
                sender = USSDMenuBuilder.truncate_name(txn.get("from", ""), 10)
                lines.append(f"- Got {amount_str} from {sender}")
            elif txn_type == "airtime":
                lines.append(f"- Airtime {amount_str}")
                
        return "\n".join(lines)


# =============================================================================
# OLDER SMARTPHONE OPTIMIZATION
# =============================================================================

class DeviceCapabilityDetector:
    """Detect device capabilities for optimization"""
    
    @staticmethod
    def detect_tier(
        ram_mb: Optional[int] = None,
        os_version: Optional[str] = None,
        screen_width: Optional[int] = None,
        supports_webgl: bool = True,
        supports_service_worker: bool = True
    ) -> DeviceTier:
        """
        Detect device tier based on capabilities.
        
        Tier 1 (Modern): Full features, animations, charts
        Tier 2 (Capable): Reduced features, simpler UI
        Tier 3 (Basic): Essential only, minimal UI
        """
        # RAM-based detection
        if ram_mb is not None:
            if ram_mb < 1024:  # < 1GB
                return DeviceTier.TIER_3_BASIC
            elif ram_mb < 2048:  # < 2GB
                return DeviceTier.TIER_2_CAPABLE
                
        # Screen-based detection
        if screen_width is not None:
            if screen_width < 320:
                return DeviceTier.TIER_3_BASIC
            elif screen_width < 375:
                return DeviceTier.TIER_2_CAPABLE
                
        # Feature-based detection
        if not supports_service_worker:
            return DeviceTier.TIER_3_BASIC
        if not supports_webgl:
            return DeviceTier.TIER_2_CAPABLE
            
        return DeviceTier.TIER_1_MODERN


class DeviceOptimizer:
    """
    Optimizes app behavior for older/weaker devices.
    
    Features:
    - Tiered feature sets based on device capability
    - Reduced memory footprint for weak devices
    - Graceful degradation of UI features
    - Legacy API compatibility
    """
    
    def __init__(self, tier: DeviceTier = DeviceTier.TIER_1_MODERN):
        self.tier = tier
        
    def get_feature_flags(self) -> dict:
        """Get feature flags based on device tier"""
        if self.tier == DeviceTier.TIER_1_MODERN:
            return {
                "animations_enabled": True,
                "charts_enabled": True,
                "live_updates_enabled": True,
                "image_quality": "high",
                "prefetch_enabled": True,
                "background_sync_enabled": True,
                "biometric_enabled": True,
                "push_notifications_enabled": True,
            }
        elif self.tier == DeviceTier.TIER_2_CAPABLE:
            return {
                "animations_enabled": False,
                "charts_enabled": True,  # Simplified charts
                "live_updates_enabled": False,
                "image_quality": "medium",
                "prefetch_enabled": False,
                "background_sync_enabled": True,
                "biometric_enabled": True,
                "push_notifications_enabled": True,
            }
        else:  # TIER_3_BASIC
            return {
                "animations_enabled": False,
                "charts_enabled": False,
                "live_updates_enabled": False,
                "image_quality": "low",
                "prefetch_enabled": False,
                "background_sync_enabled": False,
                "biometric_enabled": False,
                "push_notifications_enabled": False,
            }
            
    def get_list_page_size(self) -> int:
        """Get recommended list page size"""
        sizes = {
            DeviceTier.TIER_1_MODERN: 25,
            DeviceTier.TIER_2_CAPABLE: 15,
            DeviceTier.TIER_3_BASIC: 10,
            DeviceTier.FEATURE_PHONE: 5,
        }
        return sizes.get(self.tier, 15)
        
    def get_cache_limits(self) -> dict:
        """Get cache size limits based on device tier"""
        if self.tier == DeviceTier.TIER_1_MODERN:
            return {
                "max_transactions_cached": 500,
                "max_beneficiaries_cached": 100,
                "max_image_cache_mb": 50,
            }
        elif self.tier == DeviceTier.TIER_2_CAPABLE:
            return {
                "max_transactions_cached": 200,
                "max_beneficiaries_cached": 50,
                "max_image_cache_mb": 20,
            }
        else:
            return {
                "max_transactions_cached": 50,
                "max_beneficiaries_cached": 20,
                "max_image_cache_mb": 5,
            }
            
    def should_defer_load(self, component: str) -> bool:
        """Check if a component should be deferred/lazy loaded"""
        heavy_components = ["charts", "analytics", "recommendations", "ml_features"]
        
        if self.tier == DeviceTier.TIER_3_BASIC:
            return component in heavy_components
        elif self.tier == DeviceTier.TIER_2_CAPABLE:
            return component in ["analytics", "ml_features"]
            
        return False


# =============================================================================
# UNIFIED RESILIENCE MANAGER
# =============================================================================

class InfrastructureResilienceManager:
    """
    Unified manager for all infrastructure resilience features.
    
    Provides a single interface for:
    - Extended offline support (7+ days)
    - 2G network optimization
    - Power management
    - Feature phone support
    - Older smartphone optimization
    """
    
    def __init__(self):
        self.offline_manager = OfflineDataManager()
        self.network_optimizer = NetworkOptimizer()
        self.power_manager = PowerManager()
        self.feature_phone = FeaturePhoneSupport()
        self.device_optimizer: Optional[DeviceOptimizer] = None
        
    def initialize(
        self,
        device_tier: DeviceTier = DeviceTier.TIER_1_MODERN,
        connection_type: str = NetworkConfig.CONNECTION_UNKNOWN
    ) -> dict:
        """
        Initialize resilience manager with device and network info.
        
        Returns configuration summary.
        """
        self.device_optimizer = DeviceOptimizer(device_tier)
        self.network_optimizer.update_connection(connection_type)
        
        return {
            "device_tier": device_tier.value,
            "connection_type": connection_type,
            "offline_max_days": OfflineConfig.MAX_OFFLINE_DAYS,
            "feature_flags": self.device_optimizer.get_feature_flags(),
            "sync_interval_seconds": self.network_optimizer.profile.sync_interval_seconds,
            "batch_size": self.network_optimizer.profile.batch_size,
        }
        
    def get_sync_recommendation(self) -> dict:
        """Get comprehensive sync recommendation"""
        power_strategy = self.power_manager.get_sync_strategy()
        
        return {
            "should_sync": power_strategy["sync_enabled"],
            "sync_interval": self.network_optimizer.profile.sync_interval_seconds,
            "batch_size": self.network_optimizer.profile.batch_size,
            "defer_non_critical": power_strategy["defer_non_critical"],
            "pending_operations": len(self.offline_manager.get_pending_operations()),
            "offline_hours": self.offline_manager.offline_duration_hours,
            "recommendations": power_strategy["recommendations"],
        }
        
    def can_perform_transfer(self, amount: float) -> tuple[bool, str]:
        """Check if a transfer can be performed"""
        return self.offline_manager.can_perform_operation("transfer", amount)
        
    def queue_transfer(
        self,
        recipient_id: str,
        amount: float,
        currency: str,
        balance_snapshot: float
    ) -> QueuedOperation:
        """Queue a transfer for offline sync"""
        return self.offline_manager.queue_operation(
            "transfer",
            {
                "recipient_id": recipient_id,
                "amount": amount,
                "currency": currency,
            },
            balance_snapshot=balance_snapshot
        )


# Create default instance
resilience_manager = InfrastructureResilienceManager()
