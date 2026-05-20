#!/usr/bin/env python3
"""
Edge Computing Orchestrator for Video KYC
Manages offline operations, power efficiency, and network optimization
"""

import os
import sys
import json
import time
import uuid
import sqlite3
import threading
import logging
import psutil
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
from pathlib import Path

import requests
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import schedule

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class PowerMode(Enum):
    """Power management modes"""
    FULL_PERFORMANCE = "full_performance"
    BALANCED = "balanced"
    POWER_SAVER = "power_saver"
    CRITICAL = "critical"
    EMERGENCY = "emergency"

class NetworkQuality(Enum):
    """Network quality levels"""
    EXCELLENT = "excellent"  # 4G/WiFi
    GOOD = "good"           # 3G
    POOR = "poor"           # 2G
    OFFLINE = "offline"     # No connection

class SyncStatus(Enum):
    """Data synchronization status"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CONFLICT = "conflict"

@dataclass
class EdgeConfig:
    """Edge computing configuration"""
    device_id: str
    edge_mode: bool = True
    offline_mode: bool = False
    power_management: bool = True
    auto_sync: bool = True
    max_storage_gb: float = 10.0
    sync_interval_minutes: int = 15
    battery_threshold_critical: int = 20
    battery_threshold_power_saver: int = 40
    cpu_threshold_throttle: float = 80.0
    network_timeout_seconds: int = 30
    max_retry_attempts: int = 3
    compression_enabled: bool = True
    encryption_enabled: bool = True

@dataclass
class SystemMetrics:
    """System performance metrics"""
    timestamp: datetime
    cpu_percent: float
    memory_percent: float
    battery_percent: Optional[float]
    network_quality: NetworkQuality
    power_mode: PowerMode
    storage_used_gb: float
    storage_available_gb: float
    temperature_celsius: Optional[float]

@dataclass
class SyncItem:
    """Data synchronization item"""
    id: str
    type: str  # session, video, document, etc.
    data: Dict[str, Any]
    status: SyncStatus
    priority: int
    created_at: datetime
    updated_at: datetime
    retry_count: int
    error_message: Optional[str]

class EdgeStorageManager:
    """Local storage management for edge computing"""
    
    def __init__(self, db_path: str = "/var/lib/video_kyc/edge.db"):
        self.db_path = db_path
        self.ensure_database()
        
    def ensure_database(self):
        """Ensure database exists and is properly initialized"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS kyc_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    synced BOOLEAN DEFAULT FALSE,
                    sync_hash TEXT
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS video_files (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    checksum TEXT NOT NULL,
                    compressed BOOLEAN DEFAULT FALSE,
                    encrypted BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    synced BOOLEAN DEFAULT FALSE
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_queue (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    data TEXT NOT NULL,
                    status TEXT NOT NULL,
                    priority INTEGER DEFAULT 5,
                    retry_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    error_message TEXT
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS system_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    cpu_percent REAL,
                    memory_percent REAL,
                    battery_percent REAL,
                    network_quality TEXT,
                    power_mode TEXT,
                    storage_used_gb REAL,
                    storage_available_gb REAL,
                    temperature_celsius REAL
                )
            """)
            
            conn.commit()
            
    def store_session(self, session_data: Dict[str, Any]) -> bool:
        """Store KYC session data locally"""
        try:
            session_id = session_data.get('id', str(uuid.uuid4()))
            data_json = json.dumps(session_data)
            sync_hash = hashlib.sha256(data_json.encode()).hexdigest()
            
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO kyc_sessions 
                    (id, user_id, status, data, updated_at, sync_hash)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                """, (
                    session_id,
                    session_data.get('user_id'),
                    session_data.get('status'),
                    data_json,
                    sync_hash
                ))
                conn.commit()
                
            return True
            
        except Exception as e:
            logger.error(f"Error storing session: {e}")
            return False
            
    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve session data from local storage"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM kyc_sessions WHERE id = ?",
                    (session_id,)
                )
                row = cursor.fetchone()
                
                if row:
                    data = json.loads(row['data'])
                    data['_local_metadata'] = {
                        'created_at': row['created_at'],
                        'updated_at': row['updated_at'],
                        'synced': bool(row['synced']),
                        'sync_hash': row['sync_hash']
                    }
                    return data
                    
            return None
            
        except Exception as e:
            logger.error(f"Error retrieving session: {e}")
            return None
            
    def store_video_file(self, video_data: Dict[str, Any]) -> bool:
        """Store video file metadata and data"""
        try:
            file_id = video_data.get('id', str(uuid.uuid4()))
            file_path = f"/var/lib/video_kyc/videos/{file_id}.mp4"
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            
            # Store file data
            if 'video_data' in video_data:
                import base64
                video_bytes = base64.b64decode(video_data['video_data'])
                
                with open(file_path, 'wb') as f:
                    f.write(video_bytes)
                    
                file_size = len(video_bytes)
                checksum = hashlib.sha256(video_bytes).hexdigest()
            else:
                file_size = 0
                checksum = ""
                
            # Store metadata
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO video_files
                    (id, session_id, file_path, file_size, checksum)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    file_id,
                    video_data.get('session_id'),
                    file_path,
                    file_size,
                    checksum
                ))
                conn.commit()
                
            return True
            
        except Exception as e:
            logger.error(f"Error storing video file: {e}")
            return False
            
    def add_to_sync_queue(self, item: SyncItem) -> bool:
        """Add item to synchronization queue"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT INTO sync_queue
                    (id, type, data, status, priority, retry_count)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    item.id,
                    item.type,
                    json.dumps(item.data),
                    item.status.value,
                    item.priority,
                    item.retry_count
                ))
                conn.commit()
                
            return True
            
        except Exception as e:
            logger.error(f"Error adding to sync queue: {e}")
            return False
            
    def get_sync_queue(self, limit: int = 100) -> List[SyncItem]:
        """Get items from sync queue"""
        try:
            items = []
            
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("""
                    SELECT * FROM sync_queue 
                    WHERE status IN ('pending', 'failed')
                    ORDER BY priority DESC, created_at ASC
                    LIMIT ?
                """, (limit,))
                
                for row in cursor.fetchall():
                    item = SyncItem(
                        id=row['id'],
                        type=row['type'],
                        data=json.loads(row['data']),
                        status=SyncStatus(row['status']),
                        priority=row['priority'],
                        created_at=datetime.fromisoformat(row['created_at']),
                        updated_at=datetime.fromisoformat(row['updated_at']),
                        retry_count=row['retry_count'],
                        error_message=row['error_message']
                    )
                    items.append(item)
                    
            return items
            
        except Exception as e:
            logger.error(f"Error getting sync queue: {e}")
            return []
            
    def update_sync_status(self, item_id: str, status: SyncStatus, 
                          error_message: Optional[str] = None) -> bool:
        """Update sync item status"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    UPDATE sync_queue 
                    SET status = ?, updated_at = CURRENT_TIMESTAMP, 
                        error_message = ?, retry_count = retry_count + 1
                    WHERE id = ?
                """, (status.value, error_message, item_id))
                conn.commit()
                
            return True
            
        except Exception as e:
            logger.error(f"Error updating sync status: {e}")
            return False
            
    def store_metrics(self, metrics: SystemMetrics) -> bool:
        """Store system metrics"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT INTO system_metrics
                    (cpu_percent, memory_percent, battery_percent, 
                     network_quality, power_mode, storage_used_gb, 
                     storage_available_gb, temperature_celsius)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    metrics.cpu_percent,
                    metrics.memory_percent,
                    metrics.battery_percent,
                    metrics.network_quality.value,
                    metrics.power_mode.value,
                    metrics.storage_used_gb,
                    metrics.storage_available_gb,
                    metrics.temperature_celsius
                ))
                conn.commit()
                
            return True
            
        except Exception as e:
            logger.error(f"Error storing metrics: {e}")
            return False

class PowerManager:
    """Power management for edge devices"""
    
    def __init__(self, config: EdgeConfig):
        self.config = config
        self.current_mode = PowerMode.FULL_PERFORMANCE
        self.monitoring = False
        
    def get_battery_level(self) -> Optional[float]:
        """Get current battery level"""
        try:
            battery = psutil.sensors_battery()
            if battery:
                return battery.percent
            return None
        except Exception:
            return None
            
    def get_power_mode(self) -> PowerMode:
        """Determine appropriate power mode based on battery level"""
        battery_level = self.get_battery_level()
        
        if battery_level is None:
            return PowerMode.FULL_PERFORMANCE
            
        if battery_level < self.config.battery_threshold_critical:
            return PowerMode.EMERGENCY
        elif battery_level < self.config.battery_threshold_power_saver:
            return PowerMode.CRITICAL
        elif battery_level < 60:
            return PowerMode.POWER_SAVER
        elif battery_level < 80:
            return PowerMode.BALANCED
        else:
            return PowerMode.FULL_PERFORMANCE
            
    def apply_power_mode(self, mode: PowerMode):
        """Apply power management settings"""
        self.current_mode = mode
        
        try:
            if mode == PowerMode.EMERGENCY:
                # Minimal processing only
                self._set_cpu_governor("powersave")
                self._limit_background_tasks(max_tasks=1)
                
            elif mode == PowerMode.CRITICAL:
                # Essential features only
                self._set_cpu_governor("powersave")
                self._limit_background_tasks(max_tasks=2)
                
            elif mode == PowerMode.POWER_SAVER:
                # Reduced performance
                self._set_cpu_governor("conservative")
                self._limit_background_tasks(max_tasks=3)
                
            elif mode == PowerMode.BALANCED:
                # Balanced performance
                self._set_cpu_governor("ondemand")
                self._limit_background_tasks(max_tasks=5)
                
            else:  # FULL_PERFORMANCE
                # Maximum performance
                self._set_cpu_governor("performance")
                self._limit_background_tasks(max_tasks=10)
                
            logger.info(f"Applied power mode: {mode.value}")
            
        except Exception as e:
            logger.error(f"Error applying power mode: {e}")
            
    def _set_cpu_governor(self, governor: str):
        """Set CPU frequency governor"""
        try:
            # This would require root privileges
            # os.system(f"echo {governor} > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")
            pass
        except Exception as e:
            logger.warning(f"Could not set CPU governor: {e}")
            
    def _limit_background_tasks(self, max_tasks: int):
        """Limit number of background tasks"""
        # Implementation would depend on task scheduler
        logger.debug(f"Limited background tasks to {max_tasks}")
        
    def start_monitoring(self):
        """Start power monitoring"""
        self.monitoring = True
        
        def monitor_loop():
            while self.monitoring:
                try:
                    new_mode = self.get_power_mode()
                    if new_mode != self.current_mode:
                        self.apply_power_mode(new_mode)
                        
                    time.sleep(30)  # Check every 30 seconds
                    
                except Exception as e:
                    logger.error(f"Error in power monitoring: {e}")
                    time.sleep(60)
                    
        threading.Thread(target=monitor_loop, daemon=True).start()
        logger.info("Power monitoring started")
        
    def stop_monitoring(self):
        """Stop power monitoring"""
        self.monitoring = False
        logger.info("Power monitoring stopped")

class NetworkManager:
    """Network quality monitoring and optimization"""
    
    def __init__(self, config: EdgeConfig):
        self.config = config
        self.current_quality = NetworkQuality.OFFLINE
        
    def detect_network_quality(self) -> NetworkQuality:
        """Detect current network quality"""
        try:
            # Test connectivity with small request
            start_time = time.time()
            response = requests.get(
                "http://httpbin.org/get",
                timeout=self.config.network_timeout_seconds
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                if response_time < 1.0:
                    return NetworkQuality.EXCELLENT
                elif response_time < 3.0:
                    return NetworkQuality.GOOD
                else:
                    return NetworkQuality.POOR
            else:
                return NetworkQuality.OFFLINE
                
        except Exception:
            return NetworkQuality.OFFLINE
            
    def get_optimal_settings(self, quality: NetworkQuality) -> Dict[str, Any]:
        """Get optimal settings for network quality"""
        settings = {
            NetworkQuality.EXCELLENT: {
                'video_quality': 'high',
                'compression_level': 'low',
                'batch_size': 10,
                'timeout': 30,
                'retry_delay': 1
            },
            NetworkQuality.GOOD: {
                'video_quality': 'medium',
                'compression_level': 'medium',
                'batch_size': 5,
                'timeout': 45,
                'retry_delay': 2
            },
            NetworkQuality.POOR: {
                'video_quality': 'low',
                'compression_level': 'high',
                'batch_size': 1,
                'timeout': 60,
                'retry_delay': 5
            },
            NetworkQuality.OFFLINE: {
                'video_quality': 'offline',
                'compression_level': 'maximum',
                'batch_size': 0,
                'timeout': 0,
                'retry_delay': 60
            }
        }
        
        return settings.get(quality, settings[NetworkQuality.POOR])

class SyncManager:
    """Data synchronization manager"""
    
    def __init__(self, storage: EdgeStorageManager, network: NetworkManager, config: EdgeConfig):
        self.storage = storage
        self.network = network
        self.config = config
        self.syncing = False
        
    def start_sync_scheduler(self):
        """Start automatic synchronization scheduler"""
        schedule.every(self.config.sync_interval_minutes).minutes.do(self.sync_data)
        
        def scheduler_loop():
            while True:
                schedule.run_pending()
                time.sleep(60)
                
        threading.Thread(target=scheduler_loop, daemon=True).start()
        logger.info("Sync scheduler started")
        
    def sync_data(self) -> Dict[str, Any]:
        """Synchronize local data with cloud"""
        if self.syncing:
            return {'status': 'already_syncing'}
            
        self.syncing = True
        
        try:
            # Check network quality
            network_quality = self.network.detect_network_quality()
            
            if network_quality == NetworkQuality.OFFLINE:
                return {'status': 'offline', 'message': 'No network connectivity'}
                
            # Get sync queue
            sync_items = self.storage.get_sync_queue()
            
            if not sync_items:
                return {'status': 'no_data', 'message': 'No data to sync'}
                
            # Get optimal settings for current network
            settings = self.network.get_optimal_settings(network_quality)
            
            # Process sync items
            results = {
                'total': len(sync_items),
                'successful': 0,
                'failed': 0,
                'errors': []
            }
            
            for item in sync_items[:settings['batch_size']]:
                try:
                    success = self._sync_item(item, settings)
                    
                    if success:
                        self.storage.update_sync_status(item.id, SyncStatus.COMPLETED)
                        results['successful'] += 1
                    else:
                        self.storage.update_sync_status(
                            item.id, 
                            SyncStatus.FAILED, 
                            "Sync failed"
                        )
                        results['failed'] += 1
                        
                except Exception as e:
                    error_msg = str(e)
                    self.storage.update_sync_status(item.id, SyncStatus.FAILED, error_msg)
                    results['failed'] += 1
                    results['errors'].append(error_msg)
                    
            return {
                'status': 'completed',
                'network_quality': network_quality.value,
                'results': results
            }
            
        except Exception as e:
            logger.error(f"Error in sync process: {e}")
            return {'status': 'error', 'message': str(e)}
            
        finally:
            self.syncing = False
            
    def _sync_item(self, item: SyncItem, settings: Dict[str, Any]) -> bool:
        """Sync individual item"""
        try:
            # This would make actual API calls to sync data
            # For now, simulate the process
            
            if item.type == 'session':
                # Sync session data
                return self._sync_session(item.data, settings)
            elif item.type == 'video':
                # Sync video file
                return self._sync_video(item.data, settings)
            elif item.type == 'document':
                # Sync document
                return self._sync_document(item.data, settings)
            else:
                logger.warning(f"Unknown sync item type: {item.type}")
                return False
                
        except Exception as e:
            logger.error(f"Error syncing item {item.id}: {e}")
            return False
            
    def _sync_session(self, session_data: Dict[str, Any], settings: Dict[str, Any]) -> bool:
        """Sync session data to cloud"""
        # Implementation would make API call to cloud service
        logger.info(f"Syncing session {session_data.get('id')}")
        return True
        
    def _sync_video(self, video_data: Dict[str, Any], settings: Dict[str, Any]) -> bool:
        """Sync video file to cloud"""
        # Implementation would upload video file
        logger.info(f"Syncing video {video_data.get('id')}")
        return True
        
    def _sync_document(self, document_data: Dict[str, Any], settings: Dict[str, Any]) -> bool:
        """Sync document to cloud"""
        # Implementation would upload document
        logger.info(f"Syncing document {document_data.get('id')}")
        return True

class EdgeOrchestrator:
    """Main edge computing orchestrator"""
    
    def __init__(self, config: EdgeConfig):
        self.config = config
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Initialize components
        self.storage = EdgeStorageManager()
        self.power_manager = PowerManager(config)
        self.network_manager = NetworkManager(config)
        self.sync_manager = SyncManager(self.storage, self.network_manager, config)
        
        # Setup routes
        self.setup_routes()
        
        # Start background services
        if config.power_management:
            self.power_manager.start_monitoring()
            
        if config.auto_sync:
            self.sync_manager.start_sync_scheduler()
            
        logger.info("Edge Orchestrator initialized")
        
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'service': 'edge-orchestrator',
                'version': '1.0.0',
                'edge_mode': self.config.edge_mode,
                'offline_mode': self.config.offline_mode
            })
            
        @self.app.route('/metrics', methods=['GET'])
        def get_metrics():
            return jsonify(self.get_system_metrics())
            
        @self.app.route('/session/start', methods=['POST'])
        def start_session():
            return self.start_session_handler()
            
        @self.app.route('/session/<session_id>', methods=['GET'])
        def get_session(session_id):
            return self.get_session_handler(session_id)
            
        @self.app.route('/session/<session_id>/video', methods=['POST'])
        def upload_video(session_id):
            return self.upload_video_handler(session_id)
            
        @self.app.route('/sync/trigger', methods=['POST'])
        def trigger_sync():
            return self.trigger_sync_handler()
            
        @self.app.route('/sync/status', methods=['GET'])
        def sync_status():
            return self.sync_status_handler()
            
        @self.app.route('/power/mode', methods=['GET', 'POST'])
        def power_mode():
            return self.power_mode_handler()
            
        @self.app.route('/network/quality', methods=['GET'])
        def network_quality():
            return self.network_quality_handler()
            
    def get_system_metrics(self) -> Dict[str, Any]:
        """Get current system metrics"""
        try:
            # CPU and memory
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            
            # Storage
            disk = psutil.disk_usage('/')
            storage_used_gb = (disk.total - disk.free) / (1024**3)
            storage_available_gb = disk.free / (1024**3)
            
            # Battery
            battery_percent = self.power_manager.get_battery_level()
            
            # Network
            network_quality = self.network_manager.detect_network_quality()
            
            # Temperature (if available)
            temperature = None
            try:
                temps = psutil.sensors_temperatures()
                if temps:
                    # Get first available temperature sensor
                    for name, entries in temps.items():
                        if entries:
                            temperature = entries[0].current
                            break
            except:
                pass
                
            metrics = SystemMetrics(
                timestamp=datetime.now(),
                cpu_percent=cpu_percent,
                memory_percent=memory.percent,
                battery_percent=battery_percent,
                network_quality=network_quality,
                power_mode=self.power_manager.current_mode,
                storage_used_gb=storage_used_gb,
                storage_available_gb=storage_available_gb,
                temperature_celsius=temperature
            )
            
            # Store metrics
            self.storage.store_metrics(metrics)
            
            return asdict(metrics)
            
        except Exception as e:
            logger.error(f"Error getting system metrics: {e}")
            return {}
            
    # HTTP Handlers
    
    def start_session_handler(self):
        """Handle session start requests"""
        try:
            data = request.get_json()
            
            if not data or 'user_id' not in data:
                return jsonify({'error': 'Missing user_id'}), 400
                
            # Create session
            session_data = {
                'id': str(uuid.uuid4()),
                'user_id': data['user_id'],
                'status': 'initiated',
                'created_at': datetime.now().isoformat(),
                'edge_mode': True,
                'offline_capable': True
            }
            
            # Store locally
            success = self.storage.store_session(session_data)
            
            if success:
                # Add to sync queue
                sync_item = SyncItem(
                    id=str(uuid.uuid4()),
                    type='session',
                    data=session_data,
                    status=SyncStatus.PENDING,
                    priority=5,
                    created_at=datetime.now(),
                    updated_at=datetime.now(),
                    retry_count=0,
                    error_message=None
                )
                
                self.storage.add_to_sync_queue(sync_item)
                
                return jsonify({
                    'success': True,
                    'session_id': session_data['id'],
                    'edge_mode': True,
                    'offline_capable': True
                })
            else:
                return jsonify({'error': 'Failed to create session'}), 500
                
        except Exception as e:
            logger.error(f"Error starting session: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_session_handler(self, session_id: str):
        """Handle session retrieval requests"""
        try:
            session_data = self.storage.get_session(session_id)
            
            if session_data:
                return jsonify({
                    'success': True,
                    'session': session_data
                })
            else:
                return jsonify({'error': 'Session not found'}), 404
                
        except Exception as e:
            logger.error(f"Error getting session: {e}")
            return jsonify({'error': str(e)}), 500
            
    def upload_video_handler(self, session_id: str):
        """Handle video upload requests"""
        try:
            data = request.get_json()
            
            if not data or 'video_data' not in data:
                return jsonify({'error': 'Missing video_data'}), 400
                
            # Store video locally
            video_data = {
                'id': str(uuid.uuid4()),
                'session_id': session_id,
                'video_data': data['video_data'],
                'uploaded_at': datetime.now().isoformat()
            }
            
            success = self.storage.store_video_file(video_data)
            
            if success:
                # Add to sync queue
                sync_item = SyncItem(
                    id=str(uuid.uuid4()),
                    type='video',
                    data=video_data,
                    status=SyncStatus.PENDING,
                    priority=8,  # Higher priority for videos
                    created_at=datetime.now(),
                    updated_at=datetime.now(),
                    retry_count=0,
                    error_message=None
                )
                
                self.storage.add_to_sync_queue(sync_item)
                
                return jsonify({
                    'success': True,
                    'video_id': video_data['id'],
                    'stored_locally': True,
                    'queued_for_sync': True
                })
            else:
                return jsonify({'error': 'Failed to store video'}), 500
                
        except Exception as e:
            logger.error(f"Error uploading video: {e}")
            return jsonify({'error': str(e)}), 500
            
    def trigger_sync_handler(self):
        """Handle manual sync trigger requests"""
        try:
            result = self.sync_manager.sync_data()
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error triggering sync: {e}")
            return jsonify({'error': str(e)}), 500
            
    def sync_status_handler(self):
        """Handle sync status requests"""
        try:
            sync_items = self.storage.get_sync_queue()
            
            status = {
                'total_items': len(sync_items),
                'pending': len([i for i in sync_items if i.status == SyncStatus.PENDING]),
                'failed': len([i for i in sync_items if i.status == SyncStatus.FAILED]),
                'last_sync': None,  # Would track last successful sync
                'network_quality': self.network_manager.detect_network_quality().value
            }
            
            return jsonify(status)
            
        except Exception as e:
            logger.error(f"Error getting sync status: {e}")
            return jsonify({'error': str(e)}), 500
            
    def power_mode_handler(self):
        """Handle power mode requests"""
        try:
            if request.method == 'GET':
                return jsonify({
                    'current_mode': self.power_manager.current_mode.value,
                    'battery_level': self.power_manager.get_battery_level(),
                    'available_modes': [mode.value for mode in PowerMode]
                })
            else:  # POST
                data = request.get_json()
                mode_str = data.get('mode')
                
                try:
                    mode = PowerMode(mode_str)
                    self.power_manager.apply_power_mode(mode)
                    
                    return jsonify({
                        'success': True,
                        'mode': mode.value
                    })
                except ValueError:
                    return jsonify({'error': f'Invalid power mode: {mode_str}'}), 400
                    
        except Exception as e:
            logger.error(f"Error handling power mode: {e}")
            return jsonify({'error': str(e)}), 500
            
    def network_quality_handler(self):
        """Handle network quality requests"""
        try:
            quality = self.network_manager.detect_network_quality()
            settings = self.network_manager.get_optimal_settings(quality)
            
            return jsonify({
                'quality': quality.value,
                'optimal_settings': settings,
                'timestamp': datetime.now().isoformat()
            })
            
        except Exception as e:
            logger.error(f"Error getting network quality: {e}")
            return jsonify({'error': str(e)}), 500
            
    def run(self, host='0.0.0.0', port=8090, debug=False):
        """Run the edge orchestrator"""
        logger.info(f"Starting Edge Orchestrator on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)

def main():
    """Main entry point"""
    # Configuration
    config = EdgeConfig(
        device_id=os.getenv('DEVICE_ID', str(uuid.uuid4())),
        edge_mode=True,
        offline_mode=os.getenv('OFFLINE_MODE', 'false').lower() == 'true',
        power_management=os.getenv('POWER_MANAGEMENT', 'true').lower() == 'true',
        auto_sync=os.getenv('AUTO_SYNC', 'true').lower() == 'true'
    )
    
    # Create and run orchestrator
    orchestrator = EdgeOrchestrator(config)
    
    port = int(os.getenv('PORT', 8090))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    orchestrator.run(port=port, debug=debug)

if __name__ == '__main__':
    main()

