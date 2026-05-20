#!/usr/bin/env python3
"""
Redis Cluster Manager for Remittance Platform
High-availability caching, session management, and real-time data
"""

import json
import time
import logging
import hashlib
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
import threading
import uuid
import asyncio
from concurrent.futures import ThreadPoolExecutor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class CacheEntry:
    """Cache entry with metadata"""
    key: str
    value: Any
    ttl: int
    created_at: str
    accessed_at: str
    access_count: int = 0
    tags: List[str] = None

@dataclass
class SessionData:
    """User session data structure"""
    session_id: str
    user_id: str
    user_type: str  # customer, agent, admin
    tenant_id: str
    created_at: str
    last_accessed: str
    expires_at: str
    data: Dict[str, Any]
    ip_address: str = None
    user_agent: str = None

class RedisClusterManager:
    """Comprehensive Redis cluster manager for Remittance Platform"""
    
    def __init__(self, nodes: List[Dict[str, Any]] = None):
        self.nodes = nodes or [
            {"host": "localhost", "port": 6379, "role": "master"},
            {"host": "localhost", "port": 6380, "role": "replica"},
            {"host": "localhost", "port": 6381, "role": "replica"}
        ]
        self.clients = {}
        self.cluster_info = {}
        self.cache_stats = {
            'hits': 0,
            'misses': 0,
            'sets': 0,
            'deletes': 0,
            'evictions': 0
        }
        self.session_store = {}
        self.pub_sub_channels = {}
        
    def initialize(self) -> bool:
        """Initialize Redis cluster connections"""
        try:
            # Mock Redis cluster implementation
            class MockRedisCluster:
                def __init__(self, node_info):
                    self.node_info = node_info
                    self.data = {}
                    self.sessions = {}
                    self.streams = {}
                    self.pub_sub = {}
                    self.sorted_sets = {}
                    self.hash_maps = {}
                    self.lists = {}
                    self.sets = {}
                    
                def ping(self):
                    return True
                
                def info(self):
                    return {
                        'redis_version': '7.0.0',
                        'role': self.node_info['role'],
                        'connected_clients': 10,
                        'used_memory': 1024000,
                        'keyspace_hits': 1000,
                        'keyspace_misses': 100
                    }
                
                # String operations
                def set(self, key: str, value: Any, ex: int = None, nx: bool = False):
                    if nx and key in self.data:
                        return False
                    
                    self.data[key] = {
                        'value': json.dumps(value) if not isinstance(value, str) else value,
                        'type': 'string',
                        'expires_at': time.time() + ex if ex else None,
                        'created_at': time.time()
                    }
                    return True
                
                def get(self, key: str):
                    entry = self.data.get(key)
                    if not entry:
                        return None
                    
                    if entry.get('expires_at') and time.time() > entry['expires_at']:
                        del self.data[key]
                        return None
                    
                    try:
                        return json.loads(entry['value'])
                    except:
                        return entry['value']
                
                def delete(self, *keys):
                    deleted = 0
                    for key in keys:
                        if key in self.data:
                            del self.data[key]
                            deleted += 1
                    return deleted
                
                def exists(self, key: str):
                    return key in self.data
                
                def expire(self, key: str, seconds: int):
                    if key in self.data:
                        self.data[key]['expires_at'] = time.time() + seconds
                        return True
                    return False
                
                def ttl(self, key: str):
                    entry = self.data.get(key)
                    if not entry:
                        return -2
                    
                    expires_at = entry.get('expires_at')
                    if not expires_at:
                        return -1
                    
                    remaining = expires_at - time.time()
                    return int(remaining) if remaining > 0 else -2
                
                # Hash operations
                def hset(self, name: str, key: str, value: Any):
                    if name not in self.hash_maps:
                        self.hash_maps[name] = {}
                    self.hash_maps[name][key] = json.dumps(value) if not isinstance(value, str) else value
                    return True
                
                def hget(self, name: str, key: str):
                    hash_map = self.hash_maps.get(name, {})
                    value = hash_map.get(key)
                    if value:
                        try:
                            return json.loads(value)
                        except:
                            return value
                    return None
                
                def hgetall(self, name: str):
                    hash_map = self.hash_maps.get(name, {})
                    result = {}
                    for k, v in hash_map.items():
                        try:
                            result[k] = json.loads(v)
                        except:
                            result[k] = v
                    return result
                
                def hdel(self, name: str, *keys):
                    if name not in self.hash_maps:
                        return 0
                    
                    deleted = 0
                    for key in keys:
                        if key in self.hash_maps[name]:
                            del self.hash_maps[name][key]
                            deleted += 1
                    return deleted
                
                # List operations
                def lpush(self, name: str, *values):
                    if name not in self.lists:
                        self.lists[name] = []
                    
                    for value in reversed(values):
                        self.lists[name].insert(0, json.dumps(value) if not isinstance(value, str) else value)
                    return len(self.lists[name])
                
                def rpush(self, name: str, *values):
                    if name not in self.lists:
                        self.lists[name] = []
                    
                    for value in values:
                        self.lists[name].append(json.dumps(value) if not isinstance(value, str) else value)
                    return len(self.lists[name])
                
                def lpop(self, name: str):
                    if name not in self.lists or not self.lists[name]:
                        return None
                    
                    value = self.lists[name].pop(0)
                    try:
                        return json.loads(value)
                    except:
                        return value
                
                def lrange(self, name: str, start: int, end: int):
                    if name not in self.lists:
                        return []
                    
                    result = []
                    for value in self.lists[name][start:end+1 if end != -1 else None]:
                        try:
                            result.append(json.loads(value))
                        except:
                            result.append(value)
                    return result
                
                # Set operations
                def sadd(self, name: str, *values):
                    if name not in self.sets:
                        self.sets[name] = set()
                    
                    added = 0
                    for value in values:
                        str_value = json.dumps(value) if not isinstance(value, str) else value
                        if str_value not in self.sets[name]:
                            self.sets[name].add(str_value)
                            added += 1
                    return added
                
                def smembers(self, name: str):
                    if name not in self.sets:
                        return set()
                    
                    result = set()
                    for value in self.sets[name]:
                        try:
                            result.add(json.loads(value))
                        except:
                            result.add(value)
                    return result
                
                def srem(self, name: str, *values):
                    if name not in self.sets:
                        return 0
                    
                    removed = 0
                    for value in values:
                        str_value = json.dumps(value) if not isinstance(value, str) else value
                        if str_value in self.sets[name]:
                            self.sets[name].remove(str_value)
                            removed += 1
                    return removed
                
                # Sorted set operations
                def zadd(self, name: str, mapping: Dict[str, float]):
                    if name not in self.sorted_sets:
                        self.sorted_sets[name] = {}
                    
                    added = 0
                    for member, score in mapping.items():
                        if member not in self.sorted_sets[name]:
                            added += 1
                        self.sorted_sets[name][member] = score
                    return added
                
                def zrange(self, name: str, start: int, end: int, withscores: bool = False):
                    if name not in self.sorted_sets:
                        return []
                    
                    sorted_items = sorted(self.sorted_sets[name].items(), key=lambda x: x[1])
                    result = sorted_items[start:end+1 if end != -1 else None]
                    
                    if withscores:
                        return result
                    else:
                        return [item[0] for item in result]
                
                def zrem(self, name: str, *members):
                    if name not in self.sorted_sets:
                        return 0
                    
                    removed = 0
                    for member in members:
                        if member in self.sorted_sets[name]:
                            del self.sorted_sets[name][member]
                            removed += 1
                    return removed
                
                # Pub/Sub operations
                def publish(self, channel: str, message: Any):
                    if channel not in self.pub_sub:
                        return 0
                    
                    message_data = json.dumps(message) if not isinstance(message, str) else message
                    subscriber_count = 0
                    
                    for callback in self.pub_sub[channel]:
                        try:
                            callback(message_data)
                            subscriber_count += 1
                        except Exception as e:
                            logger.error(f"Error in pub/sub callback: {e}")
                    
                    return subscriber_count
                
                def subscribe(self, channel: str, callback):
                    if channel not in self.pub_sub:
                        self.pub_sub[channel] = []
                    self.pub_sub[channel].append(callback)
                
                # Stream operations
                def xadd(self, name: str, fields: Dict[str, Any], id: str = "*"):
                    if name not in self.streams:
                        self.streams[name] = []
                    
                    if id == "*":
                        id = f"{int(time.time() * 1000)}-{len(self.streams[name])}"
                    
                    entry = {
                        'id': id,
                        'fields': fields,
                        'timestamp': time.time()
                    }
                    
                    self.streams[name].append(entry)
                    return id
                
                def xread(self, streams: Dict[str, str], count: int = None, block: int = None):
                    result = {}
                    
                    for stream_name, last_id in streams.items():
                        if stream_name in self.streams:
                            stream_entries = []
                            
                            for entry in self.streams[stream_name]:
                                if entry['id'] > last_id:
                                    stream_entries.append([entry['id'], entry['fields']])
                                    
                                    if count and len(stream_entries) >= count:
                                        break
                            
                            if stream_entries:
                                result[stream_name] = stream_entries
                    
                    return result
            
            # Initialize cluster nodes
            for i, node in enumerate(self.nodes):
                client = MockRedisCluster(node)
                node_id = f"{node['host']}:{node['port']}"
                self.clients[node_id] = client
                
                # Test connection
                if client.ping():
                    self.cluster_info[node_id] = {
                        'status': 'connected',
                        'role': node['role'],
                        'info': client.info()
                    }
                    logger.info(f"✅ Connected to Redis node: {node_id} ({node['role']})")
                else:
                    self.cluster_info[node_id] = {
                        'status': 'disconnected',
                        'role': node['role']
                    }
                    logger.error(f"❌ Failed to connect to Redis node: {node_id}")
            
            # Setup banking-specific data structures
            self.setup_banking_structures()
            
            logger.info("🚀 Redis cluster manager initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Redis cluster: {str(e)}")
            return False
    
    def setup_banking_structures(self):
        """Setup banking-specific Redis data structures"""
        try:
            master_client = self.get_master_client()
            if not master_client:
                return False
            
            # Initialize banking data structures
            banking_structures = {
                # Session management
                'sessions:active': 'hash',  # Active user sessions
                'sessions:expired': 'sorted_set',  # Expired sessions for cleanup
                
                # Transaction caching
                'transactions:pending': 'hash',  # Pending transactions
                'transactions:completed': 'sorted_set',  # Completed transactions by timestamp
                'transactions:failed': 'list',  # Failed transactions for retry
                
                # KYB application caching
                'kyb:applications': 'hash',  # KYB applications
                'kyb:documents': 'hash',  # Document metadata
                'kyb:decisions': 'sorted_set',  # Decisions by timestamp
                
                # Payment channel caches
                'payments:qr_codes': 'hash',  # Active QR codes
                'payments:ussd_sessions': 'hash',  # USSD sessions
                'payments:sms_commands': 'list',  # SMS command queue
                'payments:whatsapp_sessions': 'hash',  # WhatsApp sessions
                
                # Insurance data
                'insurance:policies': 'hash',  # Active policies
                'insurance:claims': 'sorted_set',  # Claims by priority
                'insurance:premiums': 'hash',  # Premium calculations
                
                # Agent performance
                'agents:performance': 'sorted_set',  # Agent rankings
                'agents:locations': 'hash',  # Agent locations
                'agents:float_balances': 'hash',  # Agent float balances
                
                # Fraud detection
                'fraud:alerts': 'list',  # Active fraud alerts
                'fraud:patterns': 'set',  # Known fraud patterns
                'fraud:blacklist': 'set',  # Blacklisted entities
                
                # Analytics and reporting
                'analytics:daily_stats': 'hash',  # Daily statistics
                'analytics:real_time': 'stream',  # Real-time events
                'analytics:user_activity': 'sorted_set',  # User activity scores
                
                # Configuration and feature flags
                'config:feature_flags': 'hash',  # Feature flags
                'config:rate_limits': 'hash',  # Rate limiting configs
                'config:maintenance': 'string',  # Maintenance mode
                
                # Notification queues
                'notifications:email': 'list',  # Email queue
                'notifications:sms': 'list',  # SMS queue
                'notifications:push': 'list',  # Push notification queue
                'notifications:whatsapp': 'list',  # WhatsApp queue
            }
            
            # Initialize structures
            for structure_name, structure_type in banking_structures.items():
                if structure_type == 'hash':
                    master_client.hset(f"meta:{structure_name}", "initialized", "true")
                elif structure_type == 'sorted_set':
                    master_client.zadd(f"meta:{structure_name}", {"initialized": time.time()})
                elif structure_type == 'list':
                    master_client.lpush(f"meta:{structure_name}", "initialized")
                elif structure_type == 'set':
                    master_client.sadd(f"meta:{structure_name}", "initialized")
                elif structure_type == 'stream':
                    master_client.xadd(f"meta:{structure_name}", {"initialized": "true"})
                elif structure_type == 'string':
                    master_client.set(f"meta:{structure_name}", "initialized")
            
            logger.info("✅ Banking data structures initialized")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to setup banking structures: {str(e)}")
            return False
    
    def get_master_client(self):
        """Get the master Redis client"""
        for node_id, info in self.cluster_info.items():
            if info.get('role') == 'master' and info.get('status') == 'connected':
                return self.clients[node_id]
        return None
    
    def get_replica_client(self):
        """Get a replica Redis client for read operations"""
        replicas = [
            (node_id, client) for node_id, client in self.clients.items()
            if self.cluster_info[node_id].get('role') == 'replica' and 
               self.cluster_info[node_id].get('status') == 'connected'
        ]
        
        if replicas:
            # Simple round-robin selection
            import random
            return random.choice(replicas)[1]
        
        # Fallback to master if no replicas available
        return self.get_master_client()
    
    # Session Management
    def create_session(self, user_id: str, user_type: str, tenant_id: str, 
                      session_data: Dict[str, Any], ttl: int = 3600) -> str:
        """Create user session"""
        try:
            session_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc)
            expires_at = now + timedelta(seconds=ttl)
            
            session = SessionData(
                session_id=session_id,
                user_id=user_id,
                user_type=user_type,
                tenant_id=tenant_id,
                created_at=now.isoformat(),
                last_accessed=now.isoformat(),
                expires_at=expires_at.isoformat(),
                data=session_data
            )
            
            master_client = self.get_master_client()
            if master_client:
                # Store session data
                master_client.hset("sessions:active", session_id, json.dumps(asdict(session)))
                master_client.expire(f"session:{session_id}", ttl)
                
                # Add to expiration tracking
                master_client.zadd("sessions:expired", {session_id: expires_at.timestamp()})
                
                logger.info(f"✅ Created session: {session_id} for user: {user_id}")
                return session_id
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Failed to create session: {str(e)}")
            return None
    
    def get_session(self, session_id: str) -> Optional[SessionData]:
        """Get session data"""
        try:
            client = self.get_replica_client()
            if client:
                session_data = client.hget("sessions:active", session_id)
                if session_data:
                    session_dict = json.loads(session_data)
                    session = SessionData(**session_dict)
                    
                    # Check if session is expired
                    expires_at = datetime.fromisoformat(session.expires_at.replace('Z', '+00:00'))
                    if datetime.now(timezone.utc) > expires_at:
                        self.delete_session(session_id)
                        return None
                    
                    # Update last accessed
                    session.last_accessed = datetime.now(timezone.utc).isoformat()
                    master_client = self.get_master_client()
                    if master_client:
                        master_client.hset("sessions:active", session_id, json.dumps(asdict(session)))
                    
                    return session
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Failed to get session: {str(e)}")
            return None
    
    def delete_session(self, session_id: str) -> bool:
        """Delete session"""
        try:
            master_client = self.get_master_client()
            if master_client:
                # Remove from active sessions
                master_client.hdel("sessions:active", session_id)
                # Remove from expiration tracking
                master_client.zrem("sessions:expired", session_id)
                
                logger.info(f"✅ Deleted session: {session_id}")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"❌ Failed to delete session: {str(e)}")
            return False
    
    # Caching Operations
    def cache_set(self, key: str, value: Any, ttl: int = 3600, tags: List[str] = None) -> bool:
        """Set cache entry with metadata"""
        try:
            master_client = self.get_master_client()
            if master_client:
                now = datetime.now(timezone.utc).isoformat()
                
                cache_entry = CacheEntry(
                    key=key,
                    value=value,
                    ttl=ttl,
                    created_at=now,
                    accessed_at=now,
                    tags=tags or []
                )
                
                # Store the actual value
                master_client.set(f"cache:{key}", json.dumps(value), ex=ttl)
                
                # Store metadata
                master_client.hset("cache:metadata", key, json.dumps(asdict(cache_entry)))
                
                # Tag indexing
                if tags:
                    for tag in tags:
                        master_client.sadd(f"cache:tag:{tag}", key)
                
                self.cache_stats['sets'] += 1
                logger.info(f"✅ Cached: {key} (TTL: {ttl}s)")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"❌ Failed to cache {key}: {str(e)}")
            return False
    
    def cache_get(self, key: str) -> Any:
        """Get cache entry"""
        try:
            client = self.get_replica_client()
            if client:
                value = client.get(f"cache:{key}")
                if value:
                    # Update access metadata
                    master_client = self.get_master_client()
                    if master_client:
                        metadata = master_client.hget("cache:metadata", key)
                        if metadata:
                            cache_entry = CacheEntry(**json.loads(metadata))
                            cache_entry.accessed_at = datetime.now(timezone.utc).isoformat()
                            cache_entry.access_count += 1
                            master_client.hset("cache:metadata", key, json.dumps(asdict(cache_entry)))
                    
                    self.cache_stats['hits'] += 1
                    return json.loads(value)
                else:
                    self.cache_stats['misses'] += 1
                    return None
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Failed to get cache {key}: {str(e)}")
            self.cache_stats['misses'] += 1
            return None
    
    def cache_delete(self, key: str) -> bool:
        """Delete cache entry"""
        try:
            master_client = self.get_master_client()
            if master_client:
                # Get metadata for tag cleanup
                metadata = master_client.hget("cache:metadata", key)
                if metadata:
                    cache_entry = CacheEntry(**json.loads(metadata))
                    
                    # Remove from tag indexes
                    for tag in cache_entry.tags:
                        master_client.srem(f"cache:tag:{tag}", key)
                
                # Delete cache entry and metadata
                master_client.delete(f"cache:{key}")
                master_client.hdel("cache:metadata", key)
                
                self.cache_stats['deletes'] += 1
                logger.info(f"✅ Deleted cache: {key}")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"❌ Failed to delete cache {key}: {str(e)}")
            return False
    
    def cache_invalidate_by_tag(self, tag: str) -> int:
        """Invalidate all cache entries with specific tag"""
        try:
            master_client = self.get_master_client()
            if master_client:
                keys = master_client.smembers(f"cache:tag:{tag}")
                deleted_count = 0
                
                for key in keys:
                    if self.cache_delete(key):
                        deleted_count += 1
                
                # Clean up tag index
                master_client.delete(f"cache:tag:{tag}")
                
                logger.info(f"✅ Invalidated {deleted_count} cache entries with tag: {tag}")
                return deleted_count
            
            return 0
            
        except Exception as e:
            logger.error(f"❌ Failed to invalidate cache by tag {tag}: {str(e)}")
            return 0
    
    # Banking-specific operations
    def store_transaction(self, transaction_id: str, transaction_data: Dict[str, Any], ttl: int = 86400) -> bool:
        """Store transaction data"""
        return self.cache_set(f"transaction:{transaction_id}", transaction_data, ttl, ["transactions"])
    
    def get_transaction(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        """Get transaction data"""
        return self.cache_get(f"transaction:{transaction_id}")
    
    def store_kyb_application(self, application_id: str, application_data: Dict[str, Any]) -> bool:
        """Store KYB application data"""
        return self.cache_set(f"kyb:{application_id}", application_data, 86400, ["kyb", "applications"])
    
    def get_kyb_application(self, application_id: str) -> Optional[Dict[str, Any]]:
        """Get KYB application data"""
        return self.cache_get(f"kyb:{application_id}")
    
    def store_agent_performance(self, agent_id: str, performance_data: Dict[str, Any]) -> bool:
        """Store agent performance data"""
        try:
            master_client = self.get_master_client()
            if master_client:
                # Store detailed performance data
                self.cache_set(f"agent_performance:{agent_id}", performance_data, 3600, ["agents", "performance"])
                
                # Update performance ranking
                score = performance_data.get('overall_score', 0)
                master_client.zadd("agents:performance", {agent_id: score})
                
                return True
            return False
        except Exception as e:
            logger.error(f"❌ Failed to store agent performance: {str(e)}")
            return False
    
    def get_top_agents(self, limit: int = 10) -> List[Tuple[str, float]]:
        """Get top performing agents"""
        try:
            client = self.get_replica_client()
            if client:
                return client.zrange("agents:performance", 0, limit-1, withscores=True)
            return []
        except Exception as e:
            logger.error(f"❌ Failed to get top agents: {str(e)}")
            return []
    
    # Real-time analytics
    def add_analytics_event(self, event_type: str, event_data: Dict[str, Any]) -> bool:
        """Add real-time analytics event"""
        try:
            master_client = self.get_master_client()
            if master_client:
                event_id = master_client.xadd("analytics:real_time", {
                    'event_type': event_type,
                    'data': json.dumps(event_data),
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
                
                logger.info(f"✅ Added analytics event: {event_type} ({event_id})")
                return True
            return False
        except Exception as e:
            logger.error(f"❌ Failed to add analytics event: {str(e)}")
            return False
    
    def get_analytics_events(self, last_id: str = "0", count: int = 100) -> List[Dict[str, Any]]:
        """Get recent analytics events"""
        try:
            client = self.get_replica_client()
            if client:
                events = client.xread({"analytics:real_time": last_id}, count=count)
                
                result = []
                for stream_name, stream_events in events.items():
                    for event_id, fields in stream_events:
                        result.append({
                            'id': event_id,
                            'event_type': fields.get('event_type'),
                            'data': json.loads(fields.get('data', '{}')),
                            'timestamp': fields.get('timestamp')
                        })
                
                return result
            return []
        except Exception as e:
            logger.error(f"❌ Failed to get analytics events: {str(e)}")
            return []
    
    # Pub/Sub for real-time notifications
    def publish_notification(self, channel: str, message: Dict[str, Any]) -> int:
        """Publish notification to channel"""
        try:
            master_client = self.get_master_client()
            if master_client:
                return master_client.publish(channel, json.dumps(message))
            return 0
        except Exception as e:
            logger.error(f"❌ Failed to publish notification: {str(e)}")
            return 0
    
    def subscribe_notifications(self, channel: str, callback: Callable) -> bool:
        """Subscribe to notification channel"""
        try:
            client = self.get_replica_client()
            if client:
                def message_handler(message):
                    try:
                        data = json.loads(message)
                        callback(data)
                    except Exception as e:
                        logger.error(f"❌ Error processing notification: {str(e)}")
                
                client.subscribe(channel, message_handler)
                logger.info(f"🔔 Subscribed to channel: {channel}")
                return True
            return False
        except Exception as e:
            logger.error(f"❌ Failed to subscribe to {channel}: {str(e)}")
            return False
    
    # Cluster management
    def get_cluster_status(self) -> Dict[str, Any]:
        """Get cluster status and health"""
        try:
            status = {
                'nodes': {},
                'total_nodes': len(self.nodes),
                'connected_nodes': 0,
                'master_nodes': 0,
                'replica_nodes': 0,
                'cache_stats': self.cache_stats.copy()
            }
            
            for node_id, info in self.cluster_info.items():
                status['nodes'][node_id] = info.copy()
                
                if info.get('status') == 'connected':
                    status['connected_nodes'] += 1
                    
                    if info.get('role') == 'master':
                        status['master_nodes'] += 1
                    elif info.get('role') == 'replica':
                        status['replica_nodes'] += 1
            
            # Calculate cache hit rate
            total_requests = self.cache_stats['hits'] + self.cache_stats['misses']
            if total_requests > 0:
                status['cache_hit_rate'] = (self.cache_stats['hits'] / total_requests) * 100
            else:
                status['cache_hit_rate'] = 0
            
            return status
            
        except Exception as e:
            logger.error(f"❌ Failed to get cluster status: {str(e)}")
            return {}
    
    def cleanup_expired_sessions(self) -> int:
        """Clean up expired sessions"""
        try:
            master_client = self.get_master_client()
            if master_client:
                now = time.time()
                
                # Get expired sessions
                expired_sessions = master_client.zrange("sessions:expired", 0, now, withscores=True)
                
                cleaned_count = 0
                for session_id, expire_time in expired_sessions:
                    if expire_time <= now:
                        self.delete_session(session_id)
                        cleaned_count += 1
                
                logger.info(f"✅ Cleaned up {cleaned_count} expired sessions")
                return cleaned_count
            
            return 0
            
        except Exception as e:
            logger.error(f"❌ Failed to cleanup expired sessions: {str(e)}")
            return 0
    
    def generate_docker_compose(self) -> str:
        """Generate Docker Compose configuration for Redis cluster"""
        
        docker_compose = {
            "version": "3.8",
            "services": {
                "redis-master": {
                    "image": "redis:7-alpine",
                    "ports": ["6379:6379"],
                    "command": [
                        "redis-server",
                        "--appendonly", "yes",
                        "--replica-announce-ip", "redis-master",
                        "--replica-announce-port", "6379"
                    ],
                    "volumes": [
                        "redis_master_data:/data"
                    ],
                    "networks": ["redis-cluster"]
                },
                "redis-replica-1": {
                    "image": "redis:7-alpine",
                    "ports": ["6380:6379"],
                    "command": [
                        "redis-server",
                        "--replicaof", "redis-master", "6379",
                        "--appendonly", "yes",
                        "--replica-announce-ip", "redis-replica-1",
                        "--replica-announce-port", "6379"
                    ],
                    "depends_on": ["redis-master"],
                    "volumes": [
                        "redis_replica1_data:/data"
                    ],
                    "networks": ["redis-cluster"]
                },
                "redis-replica-2": {
                    "image": "redis:7-alpine",
                    "ports": ["6381:6379"],
                    "command": [
                        "redis-server",
                        "--replicaof", "redis-master", "6379",
                        "--appendonly", "yes",
                        "--replica-announce-ip", "redis-replica-2",
                        "--replica-announce-port", "6379"
                    ],
                    "depends_on": ["redis-master"],
                    "volumes": [
                        "redis_replica2_data:/data"
                    ],
                    "networks": ["redis-cluster"]
                },
                "redis-sentinel-1": {
                    "image": "redis:7-alpine",
                    "ports": ["26379:26379"],
                    "command": [
                        "redis-sentinel",
                        "/etc/redis/sentinel.conf"
                    ],
                    "depends_on": ["redis-master"],
                    "volumes": [
                        "./sentinel.conf:/etc/redis/sentinel.conf"
                    ],
                    "networks": ["redis-cluster"]
                },
                "redis-commander": {
                    "image": "rediscommander/redis-commander:latest",
                    "ports": ["8081:8081"],
                    "environment": [
                        "REDIS_HOSTS=master:redis-master:6379,replica1:redis-replica-1:6379,replica2:redis-replica-2:6379"
                    ],
                    "depends_on": ["redis-master"],
                    "networks": ["redis-cluster"]
                }
            },
            "networks": {
                "redis-cluster": {
                    "driver": "bridge"
                }
            },
            "volumes": {
                "redis_master_data": {"driver": "local"},
                "redis_replica1_data": {"driver": "local"},
                "redis_replica2_data": {"driver": "local"}
            }
        }
        
        return json.dumps(docker_compose, indent=2)

def main():
    """Main function to demonstrate Redis cluster management"""
    print("🔴 Remittance Platform - Redis Cluster Manager")
    print("=" * 70)
    
    cluster = RedisClusterManager()
    
    if cluster.initialize():
        print("\n✅ Redis cluster initialized successfully!")
        
        # Test session management
        session_id = cluster.create_session(
            user_id="user123",
            user_type="agent",
            tenant_id="tenant1",
            session_data={"role": "agent", "permissions": ["read", "write"]},
            ttl=3600
        )
        
        if session_id:
            print(f"📝 Created session: {session_id}")
            
            # Get session
            session = cluster.get_session(session_id)
            if session:
                print(f"📖 Retrieved session: {session.user_id} ({session.user_type})")
        
        # Test caching
        cluster.cache_set("test_key", {"message": "Hello Redis!"}, ttl=300, tags=["test"])
        cached_value = cluster.cache_get("test_key")
        if cached_value:
            print(f"💾 Cached value: {cached_value}")
        
        # Test banking operations
        cluster.store_transaction("TXN001", {
            "amount": 5000,
            "currency": "NGN",
            "type": "transfer",
            "status": "pending"
        })
        
        transaction = cluster.get_transaction("TXN001")
        if transaction:
            print(f"💳 Transaction: {transaction['amount']} {transaction['currency']}")
        
        # Test analytics
        cluster.add_analytics_event("user_login", {
            "user_id": "user123",
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        events = cluster.get_analytics_events()
        print(f"📊 Analytics events: {len(events)}")
        
        # Show cluster status
        status = cluster.get_cluster_status()
        print(f"\n🏥 Cluster Status:")
        print(f"   Connected Nodes: {status['connected_nodes']}/{status['total_nodes']}")
        print(f"   Master Nodes: {status['master_nodes']}")
        print(f"   Replica Nodes: {status['replica_nodes']}")
        print(f"   Cache Hit Rate: {status['cache_hit_rate']:.1f}%")
        print(f"   Cache Operations: {status['cache_stats']['sets']} sets, {status['cache_stats']['hits']} hits, {status['cache_stats']['misses']} misses")
        
        # Generate Docker Compose
        docker_compose = cluster.generate_docker_compose()
        with open("/tmp/docker-compose-redis.json", "w") as f:
            f.write(docker_compose)
        
        print(f"\n📁 Docker Compose configuration saved to /tmp/docker-compose-redis.json")
        print(f"🚀 Redis Master: localhost:6379")
        print(f"🚀 Redis Replica 1: localhost:6380")
        print(f"🚀 Redis Replica 2: localhost:6381")
        print(f"🌐 Redis Commander: http://localhost:8081")
        
    else:
        print("\n❌ Failed to initialize Redis cluster")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())

