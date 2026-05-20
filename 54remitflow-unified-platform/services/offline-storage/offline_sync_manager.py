#!/usr/bin/env python3
"""
Offline Storage and Synchronization Manager
Handles local data storage, conflict resolution, and synchronization with cloud services
"""

import os
import sys
import json
import time
import uuid
import sqlite3
import hashlib
import threading
import logging
import shutil
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
from pathlib import Path
import queue
import asyncio

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
import schedule

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class SyncStatus(Enum):
    """Synchronization status"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CONFLICT = "conflict"
    CANCELLED = "cancelled"

class ConflictResolution(Enum):
    """Conflict resolution strategies"""
    LOCAL_WINS = "local_wins"
    REMOTE_WINS = "remote_wins"
    MERGE = "merge"
    MANUAL = "manual"
    TIMESTAMP = "timestamp"

class DataType(Enum):
    """Data types for synchronization"""
    SESSION = "session"
    VIDEO = "video"
    IMAGE = "image"
    DOCUMENT = "document"
    USER_DATA = "user_data"
    CONFIGURATION = "configuration"

@dataclass
class SyncItem:
    """Synchronization item"""
    id: str
    data_type: DataType
    local_id: str
    remote_id: Optional[str]
    data: Dict[str, Any]
    status: SyncStatus
    priority: int
    created_at: datetime
    updated_at: datetime
    last_sync_attempt: Optional[datetime]
    retry_count: int
    max_retries: int
    error_message: Optional[str]
    checksum: str
    conflict_data: Optional[Dict[str, Any]] = None

@dataclass
class ConflictItem:
    """Data conflict item"""
    id: str
    sync_item_id: str
    local_data: Dict[str, Any]
    remote_data: Dict[str, Any]
    local_timestamp: datetime
    remote_timestamp: datetime
    resolution_strategy: ConflictResolution
    resolved: bool
    resolved_at: Optional[datetime]
    resolved_data: Optional[Dict[str, Any]]

@dataclass
class StorageMetrics:
    """Storage metrics"""
    total_items: int
    pending_sync: int
    failed_sync: int
    conflicts: int
    storage_used_mb: float
    storage_available_mb: float
    last_sync: Optional[datetime]
    sync_success_rate: float

class OfflineDatabase:
    """Local SQLite database manager"""
    
    def __init__(self, db_path: str = "/var/lib/video_kyc/offline.db"):
        self.db_path = db_path
        self.connection_pool = queue.Queue(maxsize=10)
        self.init_database()
        self.init_connection_pool()
        
    def init_database(self):
        """Initialize database schema"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        with sqlite3.connect(self.db_path) as conn:
            # Enable WAL mode for better concurrency
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA cache_size=10000")
            conn.execute("PRAGMA temp_store=MEMORY")
            
            # Create tables
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_items (
                    id TEXT PRIMARY KEY,
                    data_type TEXT NOT NULL,
                    local_id TEXT NOT NULL,
                    remote_id TEXT,
                    data TEXT NOT NULL,
                    status TEXT NOT NULL,
                    priority INTEGER DEFAULT 5,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_sync_attempt TIMESTAMP,
                    retry_count INTEGER DEFAULT 0,
                    max_retries INTEGER DEFAULT 3,
                    error_message TEXT,
                    checksum TEXT NOT NULL,
                    conflict_data TEXT
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS conflicts (
                    id TEXT PRIMARY KEY,
                    sync_item_id TEXT NOT NULL,
                    local_data TEXT NOT NULL,
                    remote_data TEXT NOT NULL,
                    local_timestamp TIMESTAMP NOT NULL,
                    remote_timestamp TIMESTAMP NOT NULL,
                    resolution_strategy TEXT NOT NULL,
                    resolved BOOLEAN DEFAULT FALSE,
                    resolved_at TIMESTAMP,
                    resolved_data TEXT,
                    FOREIGN KEY (sync_item_id) REFERENCES sync_items (id)
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS file_storage (
                    id TEXT PRIMARY KEY,
                    file_path TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    checksum TEXT NOT NULL,
                    mime_type TEXT,
                    compressed BOOLEAN DEFAULT FALSE,
                    encrypted BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    sync_status TEXT DEFAULT 'pending'
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sync_item_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    details TEXT,
                    error_message TEXT
                )
            """)
            
            # Create indexes
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sync_items_status ON sync_items(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sync_items_priority ON sync_items(priority)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sync_items_type ON sync_items(data_type)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_conflicts_resolved ON conflicts(resolved)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_file_storage_sync ON file_storage(sync_status)")
            
            conn.commit()
            
    def init_connection_pool(self):
        """Initialize connection pool"""
        for _ in range(5):
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            self.connection_pool.put(conn)
            
    def get_connection(self):
        """Get connection from pool"""
        try:
            return self.connection_pool.get(timeout=5)
        except queue.Empty:
            # Create new connection if pool is empty
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            return conn
            
    def return_connection(self, conn):
        """Return connection to pool"""
        try:
            self.connection_pool.put_nowait(conn)
        except queue.Full:
            conn.close()
            
    def execute_query(self, query: str, params: tuple = ()) -> List[sqlite3.Row]:
        """Execute query and return results"""
        conn = self.get_connection()
        try:
            cursor = conn.execute(query, params)
            results = cursor.fetchall()
            conn.commit()
            return results
        finally:
            self.return_connection(conn)
            
    def execute_update(self, query: str, params: tuple = ()) -> int:
        """Execute update query and return affected rows"""
        conn = self.get_connection()
        try:
            cursor = conn.execute(query, params)
            conn.commit()
            return cursor.rowcount
        finally:
            self.return_connection(conn)

class FileManager:
    """Local file storage manager"""
    
    def __init__(self, storage_path: str = "/var/lib/video_kyc/files"):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
    def store_file(self, file_data: bytes, file_id: str, mime_type: str = None) -> str:
        """Store file locally and return path"""
        try:
            # Create subdirectories based on file type
            if mime_type:
                if mime_type.startswith('video/'):
                    subdir = 'videos'
                elif mime_type.startswith('image/'):
                    subdir = 'images'
                elif mime_type.startswith('application/'):
                    subdir = 'documents'
                else:
                    subdir = 'other'
            else:
                subdir = 'other'
                
            file_dir = self.storage_path / subdir
            file_dir.mkdir(exist_ok=True)
            
            # Determine file extension
            extension = self._get_extension_from_mime(mime_type) if mime_type else '.bin'
            file_path = file_dir / f"{file_id}{extension}"
            
            # Write file
            with open(file_path, 'wb') as f:
                f.write(file_data)
                
            return str(file_path)
            
        except Exception as e:
            logger.error(f"Error storing file {file_id}: {e}")
            raise
            
    def get_file(self, file_path: str) -> Optional[bytes]:
        """Retrieve file data"""
        try:
            if os.path.exists(file_path):
                with open(file_path, 'rb') as f:
                    return f.read()
            return None
        except Exception as e:
            logger.error(f"Error retrieving file {file_path}: {e}")
            return None
            
    def delete_file(self, file_path: str) -> bool:
        """Delete file"""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting file {file_path}: {e}")
            return False
            
    def get_storage_usage(self) -> Tuple[float, float]:
        """Get storage usage in MB (used, available)"""
        try:
            # Calculate used space
            used_bytes = sum(
                f.stat().st_size 
                for f in self.storage_path.rglob('*') 
                if f.is_file()
            )
            
            # Get available space
            statvfs = os.statvfs(self.storage_path)
            available_bytes = statvfs.f_frsize * statvfs.f_bavail
            
            return used_bytes / (1024 * 1024), available_bytes / (1024 * 1024)
            
        except Exception as e:
            logger.error(f"Error calculating storage usage: {e}")
            return 0.0, 0.0
            
    def _get_extension_from_mime(self, mime_type: str) -> str:
        """Get file extension from MIME type"""
        mime_map = {
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'video/avi': '.avi',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'application/pdf': '.pdf',
            'application/json': '.json',
            'text/plain': '.txt'
        }
        return mime_map.get(mime_type, '.bin')

class ConflictResolver:
    """Handles data conflicts during synchronization"""
    
    def __init__(self, db: OfflineDatabase):
        self.db = db
        
    def detect_conflict(self, local_data: Dict[str, Any], 
                       remote_data: Dict[str, Any]) -> bool:
        """Detect if there's a conflict between local and remote data"""
        try:
            # Compare checksums if available
            local_checksum = local_data.get('_checksum')
            remote_checksum = remote_data.get('_checksum')
            
            if local_checksum and remote_checksum:
                return local_checksum != remote_checksum
                
            # Compare timestamps
            local_timestamp = local_data.get('updated_at')
            remote_timestamp = remote_data.get('updated_at')
            
            if local_timestamp and remote_timestamp:
                local_dt = datetime.fromisoformat(local_timestamp.replace('Z', '+00:00'))
                remote_dt = datetime.fromisoformat(remote_timestamp.replace('Z', '+00:00'))
                
                # Consider it a conflict if timestamps differ by more than 1 second
                return abs((local_dt - remote_dt).total_seconds()) > 1
                
            # If no reliable comparison method, assume conflict
            return True
            
        except Exception as e:
            logger.error(f"Error detecting conflict: {e}")
            return True
            
    def resolve_conflict(self, conflict: ConflictItem) -> Dict[str, Any]:
        """Resolve conflict based on strategy"""
        try:
            if conflict.resolution_strategy == ConflictResolution.LOCAL_WINS:
                return conflict.local_data
                
            elif conflict.resolution_strategy == ConflictResolution.REMOTE_WINS:
                return conflict.remote_data
                
            elif conflict.resolution_strategy == ConflictResolution.TIMESTAMP:
                if conflict.local_timestamp > conflict.remote_timestamp:
                    return conflict.local_data
                else:
                    return conflict.remote_data
                    
            elif conflict.resolution_strategy == ConflictResolution.MERGE:
                return self._merge_data(conflict.local_data, conflict.remote_data)
                
            else:  # MANUAL
                # Return conflict for manual resolution
                return {
                    '_conflict': True,
                    'local': conflict.local_data,
                    'remote': conflict.remote_data,
                    'conflict_id': conflict.id
                }
                
        except Exception as e:
            logger.error(f"Error resolving conflict {conflict.id}: {e}")
            return conflict.local_data  # Default to local data
            
    def _merge_data(self, local_data: Dict[str, Any], 
                   remote_data: Dict[str, Any]) -> Dict[str, Any]:
        """Merge local and remote data"""
        try:
            # Simple merge strategy - combine non-conflicting fields
            merged = local_data.copy()
            
            for key, value in remote_data.items():
                if key not in merged:
                    merged[key] = value
                elif key.startswith('_'):
                    # Skip metadata fields
                    continue
                elif isinstance(value, dict) and isinstance(merged[key], dict):
                    # Recursively merge dictionaries
                    merged[key] = self._merge_data(merged[key], value)
                elif isinstance(value, list) and isinstance(merged[key], list):
                    # Merge lists (remove duplicates)
                    merged[key] = list(set(merged[key] + value))
                    
            # Update metadata
            merged['_merged'] = True
            merged['_merge_timestamp'] = datetime.now().isoformat()
            
            return merged
            
        except Exception as e:
            logger.error(f"Error merging data: {e}")
            return local_data

class SyncEngine:
    """Core synchronization engine"""
    
    def __init__(self, db: OfflineDatabase, file_manager: FileManager, 
                 cloud_endpoint: str = "https://api.example.com"):
        self.db = db
        self.file_manager = file_manager
        self.cloud_endpoint = cloud_endpoint
        self.conflict_resolver = ConflictResolver(db)
        self.sync_queue = queue.PriorityQueue()
        self.is_syncing = False
        self.sync_thread = None
        
    def add_sync_item(self, item: SyncItem) -> bool:
        """Add item to sync queue"""
        try:
            # Calculate checksum
            data_str = json.dumps(item.data, sort_keys=True)
            item.checksum = hashlib.sha256(data_str.encode()).hexdigest()
            
            # Store in database
            self.db.execute_update("""
                INSERT OR REPLACE INTO sync_items
                (id, data_type, local_id, remote_id, data, status, priority,
                 created_at, updated_at, retry_count, max_retries, checksum)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                item.id,
                item.data_type.value,
                item.local_id,
                item.remote_id,
                json.dumps(item.data),
                item.status.value,
                item.priority,
                item.created_at.isoformat(),
                item.updated_at.isoformat(),
                item.retry_count,
                item.max_retries,
                item.checksum
            ))
            
            # Add to sync queue
            self.sync_queue.put((item.priority, item.id))
            
            return True
            
        except Exception as e:
            logger.error(f"Error adding sync item: {e}")
            return False
            
    def start_sync_worker(self):
        """Start background sync worker"""
        if self.sync_thread and self.sync_thread.is_alive():
            return
            
        self.is_syncing = True
        self.sync_thread = threading.Thread(target=self._sync_worker, daemon=True)
        self.sync_thread.start()
        logger.info("Sync worker started")
        
    def stop_sync_worker(self):
        """Stop background sync worker"""
        self.is_syncing = False
        if self.sync_thread:
            self.sync_thread.join(timeout=10)
        logger.info("Sync worker stopped")
        
    def _sync_worker(self):
        """Background sync worker"""
        while self.is_syncing:
            try:
                # Get next item from queue (with timeout)
                try:
                    priority, item_id = self.sync_queue.get(timeout=5)
                except queue.Empty:
                    continue
                    
                # Get item from database
                rows = self.db.execute_query(
                    "SELECT * FROM sync_items WHERE id = ?",
                    (item_id,)
                )
                
                if not rows:
                    continue
                    
                row = rows[0]
                
                # Skip if already completed or cancelled
                if row['status'] in ['completed', 'cancelled']:
                    continue
                    
                # Create sync item object
                item = SyncItem(
                    id=row['id'],
                    data_type=DataType(row['data_type']),
                    local_id=row['local_id'],
                    remote_id=row['remote_id'],
                    data=json.loads(row['data']),
                    status=SyncStatus(row['status']),
                    priority=row['priority'],
                    created_at=datetime.fromisoformat(row['created_at']),
                    updated_at=datetime.fromisoformat(row['updated_at']),
                    last_sync_attempt=datetime.fromisoformat(row['last_sync_attempt']) if row['last_sync_attempt'] else None,
                    retry_count=row['retry_count'],
                    max_retries=row['max_retries'],
                    error_message=row['error_message'],
                    checksum=row['checksum'],
                    conflict_data=json.loads(row['conflict_data']) if row['conflict_data'] else None
                )
                
                # Attempt sync
                self._sync_item(item)
                
            except Exception as e:
                logger.error(f"Error in sync worker: {e}")
                time.sleep(1)
                
    def _sync_item(self, item: SyncItem):
        """Sync individual item"""
        try:
            # Update status to in_progress
            self._update_sync_status(item.id, SyncStatus.IN_PROGRESS)
            
            # Check network connectivity
            if not self._check_connectivity():
                self._update_sync_status(item.id, SyncStatus.FAILED, "No network connectivity")
                return
                
            # Perform sync based on data type
            if item.data_type == DataType.SESSION:
                success = self._sync_session(item)
            elif item.data_type == DataType.VIDEO:
                success = self._sync_video(item)
            elif item.data_type == DataType.IMAGE:
                success = self._sync_image(item)
            elif item.data_type == DataType.DOCUMENT:
                success = self._sync_document(item)
            else:
                success = self._sync_generic_data(item)
                
            if success:
                self._update_sync_status(item.id, SyncStatus.COMPLETED)
                self._log_sync_action(item.id, "sync", "completed", "Successfully synced")
            else:
                self._handle_sync_failure(item)
                
        except Exception as e:
            logger.error(f"Error syncing item {item.id}: {e}")
            self._handle_sync_failure(item, str(e))
            
    def _sync_session(self, item: SyncItem) -> bool:
        """Sync session data"""
        try:
            # Prepare payload
            payload = {
                'local_id': item.local_id,
                'data': item.data,
                'checksum': item.checksum
            }
            
            # Make API call
            response = requests.post(
                f"{self.cloud_endpoint}/sessions/sync",
                json=payload,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                
                # Check for conflicts
                if result.get('conflict'):
                    self._handle_conflict(item, result['remote_data'])
                    return False
                    
                # Update remote ID
                if result.get('remote_id'):
                    self._update_remote_id(item.id, result['remote_id'])
                    
                return True
                
            elif response.status_code == 409:
                # Conflict detected
                result = response.json()
                self._handle_conflict(item, result['remote_data'])
                return False
                
            else:
                logger.error(f"Sync failed with status {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"Error syncing session {item.id}: {e}")
            return False
            
    def _sync_video(self, item: SyncItem) -> bool:
        """Sync video file"""
        try:
            # Get video file path
            file_path = item.data.get('file_path')
            if not file_path or not os.path.exists(file_path):
                logger.error(f"Video file not found: {file_path}")
                return False
                
            # Read video file
            video_data = self.file_manager.get_file(file_path)
            if not video_data:
                logger.error(f"Could not read video file: {file_path}")
                return False
                
            # Upload video file
            files = {'video': ('video.mp4', video_data, 'video/mp4')}
            data = {
                'local_id': item.local_id,
                'session_id': item.data.get('session_id'),
                'metadata': json.dumps(item.data)
            }
            
            response = requests.post(
                f"{self.cloud_endpoint}/videos/upload",
                files=files,
                data=data,
                timeout=120  # Longer timeout for video uploads
            )
            
            if response.status_code == 200:
                result = response.json()
                
                # Update remote ID
                if result.get('video_id'):
                    self._update_remote_id(item.id, result['video_id'])
                    
                return True
            else:
                logger.error(f"Video upload failed with status {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"Error syncing video {item.id}: {e}")
            return False
            
    def _sync_image(self, item: SyncItem) -> bool:
        """Sync image file"""
        # Similar to video sync but for images
        return self._sync_video(item)  # Simplified for this example
        
    def _sync_document(self, item: SyncItem) -> bool:
        """Sync document file"""
        # Similar to video sync but for documents
        return self._sync_video(item)  # Simplified for this example
        
    def _sync_generic_data(self, item: SyncItem) -> bool:
        """Sync generic data"""
        return self._sync_session(item)  # Simplified for this example
        
    def _handle_conflict(self, item: SyncItem, remote_data: Dict[str, Any]):
        """Handle sync conflict"""
        try:
            # Create conflict record
            conflict = ConflictItem(
                id=str(uuid.uuid4()),
                sync_item_id=item.id,
                local_data=item.data,
                remote_data=remote_data,
                local_timestamp=item.updated_at,
                remote_timestamp=datetime.fromisoformat(remote_data.get('updated_at', datetime.now().isoformat())),
                resolution_strategy=ConflictResolution.TIMESTAMP,  # Default strategy
                resolved=False,
                resolved_at=None,
                resolved_data=None
            )
            
            # Store conflict in database
            self.db.execute_update("""
                INSERT INTO conflicts
                (id, sync_item_id, local_data, remote_data, local_timestamp,
                 remote_timestamp, resolution_strategy, resolved)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                conflict.id,
                conflict.sync_item_id,
                json.dumps(conflict.local_data),
                json.dumps(conflict.remote_data),
                conflict.local_timestamp.isoformat(),
                conflict.remote_timestamp.isoformat(),
                conflict.resolution_strategy.value,
                conflict.resolved
            ))
            
            # Update sync item status
            self._update_sync_status(item.id, SyncStatus.CONFLICT)
            
            # Attempt automatic resolution
            resolved_data = self.conflict_resolver.resolve_conflict(conflict)
            
            if not resolved_data.get('_conflict'):
                # Conflict resolved automatically
                self._resolve_conflict(conflict.id, resolved_data)
                
        except Exception as e:
            logger.error(f"Error handling conflict for item {item.id}: {e}")
            
    def _resolve_conflict(self, conflict_id: str, resolved_data: Dict[str, Any]):
        """Resolve conflict with provided data"""
        try:
            # Update conflict record
            self.db.execute_update("""
                UPDATE conflicts 
                SET resolved = TRUE, resolved_at = ?, resolved_data = ?
                WHERE id = ?
            """, (
                datetime.now().isoformat(),
                json.dumps(resolved_data),
                conflict_id
            ))
            
            # Get conflict details
            rows = self.db.execute_query(
                "SELECT sync_item_id FROM conflicts WHERE id = ?",
                (conflict_id,)
            )
            
            if rows:
                sync_item_id = rows[0]['sync_item_id']
                
                # Update sync item with resolved data
                self.db.execute_update("""
                    UPDATE sync_items 
                    SET data = ?, status = 'pending', updated_at = ?
                    WHERE id = ?
                """, (
                    json.dumps(resolved_data),
                    datetime.now().isoformat(),
                    sync_item_id
                ))
                
                # Re-queue for sync
                self.sync_queue.put((5, sync_item_id))
                
        except Exception as e:
            logger.error(f"Error resolving conflict {conflict_id}: {e}")
            
    def _handle_sync_failure(self, item: SyncItem, error_message: str = None):
        """Handle sync failure"""
        try:
            item.retry_count += 1
            
            if item.retry_count >= item.max_retries:
                # Max retries reached
                self._update_sync_status(item.id, SyncStatus.FAILED, error_message)
                self._log_sync_action(item.id, "sync", "failed", f"Max retries reached: {error_message}")
            else:
                # Retry later
                self._update_sync_status(item.id, SyncStatus.PENDING, error_message)
                
                # Calculate retry delay (exponential backoff)
                delay = min(300, 2 ** item.retry_count)  # Max 5 minutes
                
                # Re-queue with delay
                def retry_later():
                    time.sleep(delay)
                    self.sync_queue.put((item.priority, item.id))
                    
                threading.Thread(target=retry_later, daemon=True).start()
                
        except Exception as e:
            logger.error(f"Error handling sync failure for item {item.id}: {e}")
            
    def _check_connectivity(self) -> bool:
        """Check network connectivity"""
        try:
            response = requests.get(f"{self.cloud_endpoint}/health", timeout=5)
            return response.status_code == 200
        except:
            return False
            
    def _update_sync_status(self, item_id: str, status: SyncStatus, error_message: str = None):
        """Update sync item status"""
        try:
            self.db.execute_update("""
                UPDATE sync_items 
                SET status = ?, last_sync_attempt = ?, error_message = ?,
                    retry_count = retry_count + 1, updated_at = ?
                WHERE id = ?
            """, (
                status.value,
                datetime.now().isoformat(),
                error_message,
                datetime.now().isoformat(),
                item_id
            ))
        except Exception as e:
            logger.error(f"Error updating sync status: {e}")
            
    def _update_remote_id(self, item_id: str, remote_id: str):
        """Update remote ID for sync item"""
        try:
            self.db.execute_update("""
                UPDATE sync_items SET remote_id = ? WHERE id = ?
            """, (remote_id, item_id))
        except Exception as e:
            logger.error(f"Error updating remote ID: {e}")
            
    def _log_sync_action(self, item_id: str, action: str, status: str, details: str = None):
        """Log sync action"""
        try:
            self.db.execute_update("""
                INSERT INTO sync_log (sync_item_id, action, status, details)
                VALUES (?, ?, ?, ?)
            """, (item_id, action, status, details))
        except Exception as e:
            logger.error(f"Error logging sync action: {e}")

class OfflineSyncManager:
    """Main offline storage and synchronization manager"""
    
    def __init__(self, cloud_endpoint: str = "https://api.example.com"):
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Initialize components
        self.db = OfflineDatabase()
        self.file_manager = FileManager()
        self.sync_engine = SyncEngine(self.db, self.file_manager, cloud_endpoint)
        
        # Setup routes
        self.setup_routes()
        
        # Start sync worker
        self.sync_engine.start_sync_worker()
        
        logger.info("Offline Sync Manager initialized")
        
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'service': 'offline-sync-manager',
                'version': '1.0.0'
            })
            
        @self.app.route('/store', methods=['POST'])
        def store_data():
            return self.store_data_handler()
            
        @self.app.route('/retrieve/<item_id>', methods=['GET'])
        def retrieve_data(item_id):
            return self.retrieve_data_handler(item_id)
            
        @self.app.route('/sync/trigger', methods=['POST'])
        def trigger_sync():
            return self.trigger_sync_handler()
            
        @self.app.route('/sync/status', methods=['GET'])
        def sync_status():
            return self.sync_status_handler()
            
        @self.app.route('/conflicts', methods=['GET'])
        def get_conflicts():
            return self.get_conflicts_handler()
            
        @self.app.route('/conflicts/<conflict_id>/resolve', methods=['POST'])
        def resolve_conflict(conflict_id):
            return self.resolve_conflict_handler(conflict_id)
            
        @self.app.route('/metrics', methods=['GET'])
        def get_metrics():
            return self.get_metrics_handler()
            
    def store_data_handler(self):
        """Handle data storage requests"""
        try:
            data = request.get_json()
            
            if not data:
                return jsonify({'error': 'No data provided'}), 400
                
            # Create sync item
            item = SyncItem(
                id=str(uuid.uuid4()),
                data_type=DataType(data.get('data_type', 'session')),
                local_id=data.get('local_id', str(uuid.uuid4())),
                remote_id=data.get('remote_id'),
                data=data.get('data', {}),
                status=SyncStatus.PENDING,
                priority=data.get('priority', 5),
                created_at=datetime.now(),
                updated_at=datetime.now(),
                last_sync_attempt=None,
                retry_count=0,
                max_retries=data.get('max_retries', 3),
                error_message=None,
                checksum=""
            )
            
            # Add to sync queue
            success = self.sync_engine.add_sync_item(item)
            
            if success:
                return jsonify({
                    'success': True,
                    'item_id': item.id,
                    'local_id': item.local_id,
                    'status': 'stored_and_queued'
                })
            else:
                return jsonify({'error': 'Failed to store data'}), 500
                
        except Exception as e:
            logger.error(f"Error storing data: {e}")
            return jsonify({'error': str(e)}), 500
            
    def retrieve_data_handler(self, item_id: str):
        """Handle data retrieval requests"""
        try:
            rows = self.db.execute_query(
                "SELECT * FROM sync_items WHERE id = ? OR local_id = ?",
                (item_id, item_id)
            )
            
            if not rows:
                return jsonify({'error': 'Item not found'}), 404
                
            row = rows[0]
            
            return jsonify({
                'success': True,
                'item': {
                    'id': row['id'],
                    'data_type': row['data_type'],
                    'local_id': row['local_id'],
                    'remote_id': row['remote_id'],
                    'data': json.loads(row['data']),
                    'status': row['status'],
                    'created_at': row['created_at'],
                    'updated_at': row['updated_at'],
                    'sync_status': row['status']
                }
            })
            
        except Exception as e:
            logger.error(f"Error retrieving data: {e}")
            return jsonify({'error': str(e)}), 500
            
    def trigger_sync_handler(self):
        """Handle manual sync trigger"""
        try:
            # Get all pending items and re-queue them
            rows = self.db.execute_query(
                "SELECT id, priority FROM sync_items WHERE status IN ('pending', 'failed')"
            )
            
            queued = 0
            for row in rows:
                self.sync_engine.sync_queue.put((row['priority'], row['id']))
                queued += 1
                
            return jsonify({
                'success': True,
                'message': f'Queued {queued} items for sync'
            })
            
        except Exception as e:
            logger.error(f"Error triggering sync: {e}")
            return jsonify({'error': str(e)}), 500
            
    def sync_status_handler(self):
        """Handle sync status requests"""
        try:
            # Get sync statistics
            stats = self.db.execute_query("""
                SELECT 
                    status,
                    COUNT(*) as count
                FROM sync_items 
                GROUP BY status
            """)
            
            status_counts = {row['status']: row['count'] for row in stats}
            
            # Get storage metrics
            used_mb, available_mb = self.file_manager.get_storage_usage()
            
            # Get last sync time
            last_sync_rows = self.db.execute_query("""
                SELECT MAX(timestamp) as last_sync
                FROM sync_log 
                WHERE status = 'completed'
            """)
            
            last_sync = last_sync_rows[0]['last_sync'] if last_sync_rows else None
            
            return jsonify({
                'status_counts': status_counts,
                'storage': {
                    'used_mb': used_mb,
                    'available_mb': available_mb
                },
                'last_sync': last_sync,
                'sync_worker_active': self.sync_engine.is_syncing
            })
            
        except Exception as e:
            logger.error(f"Error getting sync status: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_conflicts_handler(self):
        """Handle get conflicts requests"""
        try:
            rows = self.db.execute_query("""
                SELECT * FROM conflicts WHERE resolved = FALSE
                ORDER BY id DESC
            """)
            
            conflicts = []
            for row in rows:
                conflicts.append({
                    'id': row['id'],
                    'sync_item_id': row['sync_item_id'],
                    'local_data': json.loads(row['local_data']),
                    'remote_data': json.loads(row['remote_data']),
                    'local_timestamp': row['local_timestamp'],
                    'remote_timestamp': row['remote_timestamp'],
                    'resolution_strategy': row['resolution_strategy']
                })
                
            return jsonify({
                'success': True,
                'conflicts': conflicts
            })
            
        except Exception as e:
            logger.error(f"Error getting conflicts: {e}")
            return jsonify({'error': str(e)}), 500
            
    def resolve_conflict_handler(self, conflict_id: str):
        """Handle conflict resolution requests"""
        try:
            data = request.get_json()
            
            if not data or 'resolved_data' not in data:
                return jsonify({'error': 'Missing resolved_data'}), 400
                
            # Resolve conflict
            self.sync_engine._resolve_conflict(conflict_id, data['resolved_data'])
            
            return jsonify({
                'success': True,
                'message': 'Conflict resolved successfully'
            })
            
        except Exception as e:
            logger.error(f"Error resolving conflict: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_metrics_handler(self):
        """Handle metrics requests"""
        try:
            metrics = self._calculate_metrics()
            return jsonify(metrics)
            
        except Exception as e:
            logger.error(f"Error getting metrics: {e}")
            return jsonify({'error': str(e)}), 500
            
    def _calculate_metrics(self) -> Dict[str, Any]:
        """Calculate storage and sync metrics"""
        try:
            # Get item counts
            total_rows = self.db.execute_query("SELECT COUNT(*) as count FROM sync_items")
            total_items = total_rows[0]['count'] if total_rows else 0
            
            pending_rows = self.db.execute_query(
                "SELECT COUNT(*) as count FROM sync_items WHERE status = 'pending'"
            )
            pending_sync = pending_rows[0]['count'] if pending_rows else 0
            
            failed_rows = self.db.execute_query(
                "SELECT COUNT(*) as count FROM sync_items WHERE status = 'failed'"
            )
            failed_sync = failed_rows[0]['count'] if failed_rows else 0
            
            conflict_rows = self.db.execute_query(
                "SELECT COUNT(*) as count FROM conflicts WHERE resolved = FALSE"
            )
            conflicts = conflict_rows[0]['count'] if conflict_rows else 0
            
            # Get storage usage
            used_mb, available_mb = self.file_manager.get_storage_usage()
            
            # Calculate success rate
            completed_rows = self.db.execute_query(
                "SELECT COUNT(*) as count FROM sync_items WHERE status = 'completed'"
            )
            completed = completed_rows[0]['count'] if completed_rows else 0
            
            success_rate = (completed / total_items * 100) if total_items > 0 else 0
            
            # Get last sync
            last_sync_rows = self.db.execute_query("""
                SELECT MAX(timestamp) as last_sync
                FROM sync_log 
                WHERE status = 'completed'
            """)
            last_sync = last_sync_rows[0]['last_sync'] if last_sync_rows else None
            
            return {
                'total_items': total_items,
                'pending_sync': pending_sync,
                'failed_sync': failed_sync,
                'conflicts': conflicts,
                'storage_used_mb': used_mb,
                'storage_available_mb': available_mb,
                'last_sync': last_sync,
                'sync_success_rate': success_rate
            }
            
        except Exception as e:
            logger.error(f"Error calculating metrics: {e}")
            return {}
            
    def run(self, host='0.0.0.0', port=8093, debug=False):
        """Run the offline sync manager"""
        logger.info(f"Starting Offline Sync Manager on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)
        
    def shutdown(self):
        """Shutdown the sync manager"""
        self.sync_engine.stop_sync_worker()
        logger.info("Offline Sync Manager shutdown")

if __name__ == '__main__':
    manager = OfflineSyncManager()
    
    try:
        port = int(os.getenv('PORT', 8093))
        debug = os.getenv('DEBUG', 'false').lower() == 'true'
        
        manager.run(port=port, debug=debug)
    except KeyboardInterrupt:
        manager.shutdown()

