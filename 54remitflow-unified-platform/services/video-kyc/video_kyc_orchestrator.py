#!/usr/bin/env python3
"""
Video KYC Orchestrator Service
Complete workflow orchestration for video KYC process
"""

import os
import sys
import json
import time
import uuid
import base64
import hashlib
import asyncio
import logging
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from concurrent.futures import ThreadPoolExecutor
from enum import Enum

import redis
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import prometheus_client
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import requests
from celery import Celery
from celery.result import AsyncResult

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class KYCStatus(Enum):
    """KYC process status"""
    INITIATED = "initiated"
    DOCUMENT_UPLOADED = "document_uploaded"
    VIDEO_RECORDING = "video_recording"
    VIDEO_UPLOADED = "video_uploaded"
    FACE_DETECTION = "face_detection"
    LIVENESS_CHECK = "liveness_check"
    BIOMETRIC_MATCHING = "biometric_matching"
    VERIFICATION_COMPLETE = "verification_complete"
    APPROVED = "approved"
    REJECTED = "rejected"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"

class KYCStep(Enum):
    """Individual KYC steps"""
    DOCUMENT_CAPTURE = "document_capture"
    DOCUMENT_VERIFICATION = "document_verification"
    VIDEO_CAPTURE = "video_capture"
    FACE_DETECTION = "face_detection"
    LIVENESS_DETECTION = "liveness_detection"
    BIOMETRIC_MATCHING = "biometric_matching"
    FINAL_VERIFICATION = "final_verification"

class NotificationType(Enum):
    """Notification types"""
    STATUS_UPDATE = "status_update"
    STEP_COMPLETE = "step_complete"
    ERROR_OCCURRED = "error_occurred"
    VERIFICATION_RESULT = "verification_result"
    EXPIRY_WARNING = "expiry_warning"

@dataclass
class KYCSession:
    """KYC session data structure"""
    id: str
    user_id: str
    agent_id: Optional[str]
    status: KYCStatus
    current_step: Optional[KYCStep]
    steps_completed: List[KYCStep]
    document_data: Dict[str, Any]
    video_data: Dict[str, Any]
    verification_results: Dict[str, Any]
    metadata: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    completed_at: Optional[datetime]

@dataclass
class StepResult:
    """Result of a KYC step"""
    step: KYCStep
    success: bool
    confidence: float
    data: Dict[str, Any]
    error_message: Optional[str]
    processing_time: float
    timestamp: datetime

@dataclass
class KYCNotification:
    """KYC notification"""
    id: str
    session_id: str
    type: NotificationType
    title: str
    message: str
    data: Dict[str, Any]
    sent_at: datetime
    read: bool

class ServiceClient:
    """Client for communicating with other services"""
    
    def __init__(self, base_url: str, timeout: int = 30):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        
    def post(self, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Make POST request to service"""
        try:
            url = f"{self.base_url}/{endpoint.lstrip('/')}"
            response = requests.post(url, json=data, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Service request failed: {e}")
            raise
            
    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Make GET request to service"""
        try:
            url = f"{self.base_url}/{endpoint.lstrip('/')}"
            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Service request failed: {e}")
            raise

class VideoKYCOrchestrator:
    """Main video KYC orchestration service"""
    
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Service clients (configurable via env vars)
        self.face_detection_client = ServiceClient(os.getenv("FACE_DETECTION_URL", "http://localhost:8084"))
        self.liveness_detection_client = ServiceClient(os.getenv("LIVENESS_DETECTION_URL", "http://localhost:8085"))
        self.video_storage_client = ServiceClient(os.getenv("VIDEO_STORAGE_URL", "http://localhost:8086"))
        self.biometric_matching_client = ServiceClient(os.getenv("BIOMETRIC_MATCHING_URL", "http://localhost:8087"))
        
        # Database and Redis
        self.redis_client = None
        self.db_pool = None
        
        # Celery for async tasks
        self.celery = None
        
        # Configuration
        self.session_timeout = timedelta(hours=24)
        self.step_timeout = timedelta(minutes=30)
        
        # Metrics
        self.setup_metrics()
        
        # Initialize connections
        self.setup_database()
        self.setup_redis()
        self.setup_celery()
        self.setup_routes()
        
        # Start background tasks
        self.start_background_tasks()
        
        logger.info("Video KYC Orchestrator initialized")
        
    def setup_metrics(self):
        """Setup Prometheus metrics"""
        self.kyc_sessions_total = Counter(
            'kyc_sessions_total',
            'Total KYC sessions',
            ['status']
        )
        
        self.kyc_steps_total = Counter(
            'kyc_steps_total',
            'Total KYC steps processed',
            ['step', 'status']
        )
        
        self.kyc_session_duration = Histogram(
            'kyc_session_duration_seconds',
            'KYC session duration',
            ['status']
        )
        
        self.active_sessions = Gauge(
            'kyc_active_sessions',
            'Number of active KYC sessions'
        )
        
        self.verification_accuracy = Gauge(
            'kyc_verification_accuracy',
            'KYC verification accuracy percentage'
        )
        
    def setup_database(self):
        """Setup database connection"""
        try:
            db_config = {
                'host': os.getenv('DB_HOST', 'localhost'),
                'port': os.getenv('DB_PORT', '5432'),
                'database': os.getenv('DB_NAME', 'remittance'),
                'user': os.getenv('DB_USER', 'postgres'),
                'password': os.getenv('DB_PASSWORD', 'password')
            }
            
            self.db_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=20,
                **db_config
            )
            
            # Create tables
            self.create_tables()
            
            logger.info("Database connection established")
            
        except Exception as e:
            logger.error(f"Database setup failed: {e}")
            
    def setup_redis(self):
        """Setup Redis connection"""
        try:
            redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
            self.redis_client = redis.from_url(redis_url)
            self.redis_client.ping()
            
            logger.info("Redis connection established")
            
        except Exception as e:
            logger.error(f"Redis setup failed: {e}")
            
    def setup_celery(self):
        """Setup Celery for async tasks"""
        try:
            broker_url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/1')
            result_backend = os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/2')
            
            self.celery = Celery(
                'video_kyc_orchestrator',
                broker=broker_url,
                backend=result_backend
            )
            
            # Configure Celery
            self.celery.conf.update(
                task_serializer='json',
                accept_content=['json'],
                result_serializer='json',
                timezone='UTC',
                enable_utc=True,
                task_routes={
                    'video_kyc_orchestrator.process_step': {'queue': 'kyc_processing'},
                    'video_kyc_orchestrator.send_notification': {'queue': 'notifications'},
                }
            )
            
            logger.info("Celery configured for async processing")
            
        except Exception as e:
            logger.error(f"Celery setup failed: {e}")
            
    def create_tables(self):
        """Create database tables"""
        if not self.db_pool:
            return
            
        try:
            conn = self.db_pool.getconn()
            cursor = conn.cursor()
            
            # KYC sessions table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS kyc_sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR(255) NOT NULL,
                    agent_id VARCHAR(255),
                    status VARCHAR(50) NOT NULL,
                    current_step VARCHAR(50),
                    steps_completed JSONB DEFAULT '[]',
                    document_data JSONB DEFAULT '{}',
                    video_data JSONB DEFAULT '{}',
                    verification_results JSONB DEFAULT '{}',
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    expires_at TIMESTAMP NOT NULL,
                    completed_at TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS kyc_step_results (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    session_id UUID REFERENCES kyc_sessions(id),
                    step VARCHAR(50) NOT NULL,
                    success BOOLEAN NOT NULL,
                    confidence DECIMAL(5,4),
                    data JSONB DEFAULT '{}',
                    error_message TEXT,
                    processing_time_ms INTEGER,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS kyc_notifications (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    session_id UUID REFERENCES kyc_sessions(id),
                    type VARCHAR(50) NOT NULL,
                    title VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    data JSONB DEFAULT '{}',
                    sent_at TIMESTAMP DEFAULT NOW(),
                    read BOOLEAN DEFAULT FALSE
                );
                
                CREATE INDEX IF NOT EXISTS idx_kyc_sessions_user_id ON kyc_sessions(user_id);
                CREATE INDEX IF NOT EXISTS idx_kyc_sessions_status ON kyc_sessions(status);
                CREATE INDEX IF NOT EXISTS idx_kyc_sessions_expires_at ON kyc_sessions(expires_at);
                CREATE INDEX IF NOT EXISTS idx_kyc_step_results_session_id ON kyc_step_results(session_id);
                CREATE INDEX IF NOT EXISTS idx_kyc_notifications_session_id ON kyc_notifications(session_id);
            """)
            
            conn.commit()
            cursor.close()
            self.db_pool.putconn(conn)
            
            logger.info("Database tables created successfully")
            
        except Exception as e:
            logger.error(f"Error creating database tables: {e}")
            
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'service': 'video-kyc-orchestrator',
                'version': '1.0.0'
            })
            
        @self.app.route('/metrics', methods=['GET'])
        def metrics():
            return generate_latest()
            
        # Session management
        @self.app.route('/session/start', methods=['POST'])
        def start_session():
            return self.start_session_handler()
            
        @self.app.route('/session/<session_id>', methods=['GET'])
        def get_session(session_id):
            return self.get_session_handler(session_id)
            
        @self.app.route('/session/<session_id>/status', methods=['GET'])
        def get_session_status(session_id):
            return self.get_session_status_handler(session_id)
            
        @self.app.route('/session/<session_id>/cancel', methods=['POST'])
        def cancel_session(session_id):
            return self.cancel_session_handler(session_id)
            
        # Step processing
        @self.app.route('/session/<session_id>/step/<step>', methods=['POST'])
        def process_step(session_id, step):
            return self.process_step_handler(session_id, step)
            
        @self.app.route('/session/<session_id>/document', methods=['POST'])
        def upload_document(session_id):
            return self.upload_document_handler(session_id)
            
        @self.app.route('/session/<session_id>/video', methods=['POST'])
        def upload_video(session_id):
            return self.upload_video_handler(session_id)
            
        # Workflow control
        @self.app.route('/session/<session_id>/next', methods=['POST'])
        def next_step(session_id):
            return self.next_step_handler(session_id)
            
        @self.app.route('/session/<session_id>/retry', methods=['POST'])
        def retry_step(session_id):
            return self.retry_step_handler(session_id)
            
        @self.app.route('/session/<session_id>/complete', methods=['POST'])
        def complete_session(session_id):
            return self.complete_session_handler(session_id)
            
        # Notifications
        @self.app.route('/session/<session_id>/notifications', methods=['GET'])
        def get_notifications(session_id):
            return self.get_notifications_handler(session_id)
            
        @self.app.route('/notification/<notification_id>/read', methods=['POST'])
        def mark_notification_read(notification_id):
            return self.mark_notification_read_handler(notification_id)
            
        # Analytics and reporting
        @self.app.route('/analytics/sessions', methods=['GET'])
        def get_session_analytics():
            return self.get_session_analytics_handler()
            
        @self.app.route('/analytics/performance', methods=['GET'])
        def get_performance_analytics():
            return self.get_performance_analytics_handler()
            
        @self.app.route('/admin/sessions', methods=['GET'])
        def list_sessions():
            return self.list_sessions_handler()
            
    def start_background_tasks(self):
        """Start background tasks"""
        # Session cleanup task
        threading.Thread(target=self.session_cleanup_worker, daemon=True).start()
        
        # Metrics collection task
        threading.Thread(target=self.metrics_collection_worker, daemon=True).start()
        
        # Notification processing task
        threading.Thread(target=self.notification_worker, daemon=True).start()
        
    def session_cleanup_worker(self):
        """Background worker for session cleanup"""
        while True:
            try:
                self.cleanup_expired_sessions()
                time.sleep(300)  # Run every 5 minutes
            except Exception as e:
                logger.error(f"Error in session cleanup worker: {e}")
                time.sleep(60)
                
    def metrics_collection_worker(self):
        """Background worker for metrics collection"""
        while True:
            try:
                self.update_metrics()
                time.sleep(60)  # Run every minute
            except Exception as e:
                logger.error(f"Error in metrics collection worker: {e}")
                time.sleep(60)
                
    def notification_worker(self):
        """Background worker for notification processing"""
        while True:
            try:
                self.process_pending_notifications()
                time.sleep(10)  # Run every 10 seconds
            except Exception as e:
                logger.error(f"Error in notification worker: {e}")
                time.sleep(30)
                
    # HTTP Handlers
    
    def start_session_handler(self):
        """Handle session start requests"""
        try:
            data = request.get_json()
            
            if not data or 'user_id' not in data:
                return jsonify({'error': 'Missing user_id'}), 400
                
            # Create new session
            session = KYCSession(
                id=str(uuid.uuid4()),
                user_id=data['user_id'],
                agent_id=data.get('agent_id'),
                status=KYCStatus.INITIATED,
                current_step=None,
                steps_completed=[],
                document_data={},
                video_data={},
                verification_results={},
                metadata=data.get('metadata', {}),
                created_at=datetime.now(),
                updated_at=datetime.now(),
                expires_at=datetime.now() + self.session_timeout,
                completed_at=None
            )
            
            # Store session
            self.store_session(session)
            
            # Send notification
            self.send_notification(
                session.id,
                NotificationType.STATUS_UPDATE,
                "KYC Session Started",
                "Your KYC verification session has been initiated.",
                {'session_id': session.id}
            )
            
            # Update metrics
            self.kyc_sessions_total.labels(status='initiated').inc()
            
            return jsonify({
                'success': True,
                'session_id': session.id,
                'status': session.status.value,
                'expires_at': session.expires_at.isoformat(),
                'next_steps': self.get_next_steps(session)
            })
            
        except Exception as e:
            logger.error(f"Error starting session: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_session_handler(self, session_id: str):
        """Handle session retrieval requests"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
                
            return jsonify({
                'session': asdict(session),
                'next_steps': self.get_next_steps(session),
                'progress': self.calculate_progress(session)
            })
            
        except Exception as e:
            logger.error(f"Error getting session: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_session_status_handler(self, session_id: str):
        """Handle session status requests"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
                
            return jsonify({
                'session_id': session.id,
                'status': session.status.value,
                'current_step': session.current_step.value if session.current_step else None,
                'progress': self.calculate_progress(session),
                'updated_at': session.updated_at.isoformat()
            })
            
        except Exception as e:
            logger.error(f"Error getting session status: {e}")
            return jsonify({'error': str(e)}), 500
            
    def upload_document_handler(self, session_id: str):
        """Handle document upload requests"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
                
            data = request.get_json()
            if not data or 'document_image' not in data:
                return jsonify({'error': 'Missing document_image'}), 400
                
            # Process document upload
            result = self.process_document_upload(session, data)
            
            if result['success']:
                # Update session
                session.status = KYCStatus.DOCUMENT_UPLOADED
                session.document_data = result['document_data']
                session.updated_at = datetime.now()
                self.update_session(session)
                
                # Send notification
                self.send_notification(
                    session_id,
                    NotificationType.STEP_COMPLETE,
                    "Document Uploaded",
                    "Your identity document has been successfully uploaded and verified.",
                    result
                )
                
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error uploading document: {e}")
            return jsonify({'error': str(e)}), 500
            
    def upload_video_handler(self, session_id: str):
        """Handle video upload requests"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
                
            data = request.get_json()
            if not data or 'video_data' not in data:
                return jsonify({'error': 'Missing video_data'}), 400
                
            # Process video upload
            result = self.process_video_upload(session, data)
            
            if result['success']:
                # Update session
                session.status = KYCStatus.VIDEO_UPLOADED
                session.video_data = result['video_data']
                session.updated_at = datetime.now()
                self.update_session(session)
                
                # Trigger async processing
                self.trigger_video_processing(session_id)
                
                # Send notification
                self.send_notification(
                    session_id,
                    NotificationType.STEP_COMPLETE,
                    "Video Uploaded",
                    "Your video has been uploaded and is being processed.",
                    result
                )
                
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error uploading video: {e}")
            return jsonify({'error': str(e)}), 500
            
    def process_step_handler(self, session_id: str, step: str):
        """Handle step processing requests"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
                
            try:
                kyc_step = KYCStep(step)
            except ValueError:
                return jsonify({'error': f'Invalid step: {step}'}), 400
                
            # Process step
            result = self.process_kyc_step(session, kyc_step, request.get_json() or {})
            
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error processing step: {e}")
            return jsonify({'error': str(e)}), 500
            
    def complete_session_handler(self, session_id: str):
        """Handle session completion requests"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
                
            # Perform final verification
            final_result = self.perform_final_verification(session)
            
            # Update session status
            if final_result['approved']:
                session.status = KYCStatus.APPROVED
            else:
                session.status = KYCStatus.REJECTED
                
            session.verification_results = final_result
            session.completed_at = datetime.now()
            session.updated_at = datetime.now()
            
            self.update_session(session)
            
            # Send final notification
            self.send_notification(
                session_id,
                NotificationType.VERIFICATION_RESULT,
                "KYC Verification Complete",
                f"Your KYC verification has been {'approved' if final_result['approved'] else 'rejected'}.",
                final_result
            )
            
            # Update metrics
            status = 'approved' if final_result['approved'] else 'rejected'
            self.kyc_sessions_total.labels(status=status).inc()
            
            duration = (session.completed_at - session.created_at).total_seconds()
            self.kyc_session_duration.labels(status=status).observe(duration)
            
            return jsonify({
                'success': True,
                'session_id': session_id,
                'status': session.status.value,
                'verification_result': final_result
            })
            
        except Exception as e:
            logger.error(f"Error completing session: {e}")
            return jsonify({'error': str(e)}), 500
            
    # Core processing methods
    
    def process_document_upload(self, session: KYCSession, data: Dict[str, Any]) -> Dict[str, Any]:
        """Process document upload"""
        try:
            # Extract document photo using biometric matching service
            extract_request = {
                'document_image': data['document_image'],
                'document_type': data.get('document_type', 'national_id')
            }
            
            extract_result = self.biometric_matching_client.post(
                '/extract/document-photo',
                extract_request
            )
            
            if not extract_result.get('success'):
                return {
                    'success': False,
                    'error': 'Failed to extract photo from document',
                    'details': extract_result
                }
                
            return {
                'success': True,
                'document_data': {
                    'document_type': data.get('document_type'),
                    'document_photo_id': extract_result['document_photo_id'],
                    'quality_score': extract_result['quality_score'],
                    'confidence': extract_result['confidence'],
                    'uploaded_at': datetime.now().isoformat()
                }
            }
            
        except Exception as e:
            logger.error(f"Error processing document upload: {e}")
            return {
                'success': False,
                'error': str(e)
            }
            
    def process_video_upload(self, session: KYCSession, data: Dict[str, Any]) -> Dict[str, Any]:
        """Process video upload"""
        try:
            # Upload video to storage service
            upload_request = {
                'session_id': session.id,
                'kyc_request_id': session.id,
                'original_name': f"kyc_video_{session.id}.mp4",
                'mime_type': 'video/mp4',
                'metadata': {
                    'user_id': session.user_id,
                    'upload_type': 'kyc_video'
                },
                'retention_policy': 'extended',
                'encrypt': True,
                'compress': True
            }
            
            # Convert video data to base64 if needed
            video_data = data['video_data']
            if isinstance(video_data, str):
                # Assume it's already base64 encoded
                pass
            else:
                # Convert to base64
                import base64
                video_data = base64.b64encode(video_data).decode('utf-8')
                
            # Make request to video storage service
            storage_result = self.video_storage_client.post('/upload', {
                **upload_request,
                'video_data': video_data
            })
            
            if not storage_result.get('success'):
                return {
                    'success': False,
                    'error': 'Failed to store video',
                    'details': storage_result
                }
                
            return {
                'success': True,
                'video_data': {
                    'file_id': storage_result['file_id'],
                    'file_size': storage_result['file_size'],
                    'checksum': storage_result['checksum'],
                    'uploaded_at': datetime.now().isoformat()
                }
            }
            
        except Exception as e:
            logger.error(f"Error processing video upload: {e}")
            return {
                'success': False,
                'error': str(e)
            }
            
    def trigger_video_processing(self, session_id: str):
        """Trigger async video processing"""
        try:
            if self.celery:
                # Queue async processing tasks
                self.celery.send_task(
                    'video_kyc_orchestrator.process_video_pipeline',
                    args=[session_id],
                    queue='kyc_processing'
                )
            else:
                # Fallback to synchronous processing
                self.process_video_pipeline(session_id)
                
        except Exception as e:
            logger.error(f"Error triggering video processing: {e}")
            
    def process_video_pipeline(self, session_id: str):
        """Process complete video pipeline"""
        try:
            session = self.get_session(session_id)
            if not session:
                return
                
            # Step 1: Face detection
            self.update_session_status(session_id, KYCStatus.FACE_DETECTION)
            face_result = self.process_kyc_step(session, KYCStep.FACE_DETECTION, {})
            
            if not face_result['success']:
                self.update_session_status(session_id, KYCStatus.FAILED)
                return
                
            # Step 2: Liveness detection
            self.update_session_status(session_id, KYCStatus.LIVENESS_CHECK)
            liveness_result = self.process_kyc_step(session, KYCStep.LIVENESS_DETECTION, {})
            
            if not liveness_result['success']:
                self.update_session_status(session_id, KYCStatus.FAILED)
                return
                
            # Step 3: Biometric matching
            self.update_session_status(session_id, KYCStatus.BIOMETRIC_MATCHING)
            matching_result = self.process_kyc_step(session, KYCStep.BIOMETRIC_MATCHING, {})
            
            if not matching_result['success']:
                self.update_session_status(session_id, KYCStatus.FAILED)
                return
                
            # Update session as verification complete
            self.update_session_status(session_id, KYCStatus.VERIFICATION_COMPLETE)
            
        except Exception as e:
            logger.error(f"Error in video processing pipeline: {e}")
            self.update_session_status(session_id, KYCStatus.FAILED)
            
    def process_kyc_step(self, session: KYCSession, step: KYCStep, 
                        data: Dict[str, Any]) -> Dict[str, Any]:
        """Process individual KYC step"""
        try:
            start_time = time.time()
            
            if step == KYCStep.FACE_DETECTION:
                result = self.process_face_detection(session, data)
            elif step == KYCStep.LIVENESS_DETECTION:
                result = self.process_liveness_detection(session, data)
            elif step == KYCStep.BIOMETRIC_MATCHING:
                result = self.process_biometric_matching(session, data)
            elif step == KYCStep.FINAL_VERIFICATION:
                result = self.perform_final_verification(session)
            else:
                result = {
                    'success': False,
                    'error': f'Unsupported step: {step.value}'
                }
                
            processing_time = (time.time() - start_time) * 1000
            
            # Store step result
            step_result = StepResult(
                step=step,
                success=result['success'],
                confidence=result.get('confidence', 0.0),
                data=result,
                error_message=result.get('error'),
                processing_time=processing_time,
                timestamp=datetime.now()
            )
            
            self.store_step_result(session.id, step_result)
            
            # Update metrics
            status = 'success' if result['success'] else 'failed'
            self.kyc_steps_total.labels(step=step.value, status=status).inc()
            
            # Update session if step completed successfully
            if result['success']:
                if step not in session.steps_completed:
                    session.steps_completed.append(step)
                session.current_step = self.get_next_step(session)
                session.updated_at = datetime.now()
                self.update_session(session)
                
            return result
            
        except Exception as e:
            logger.error(f"Error processing KYC step {step.value}: {e}")
            return {
                'success': False,
                'error': str(e)
            }
            
    def process_face_detection(self, session: KYCSession, data: Dict[str, Any]) -> Dict[str, Any]:
        """Process face detection step"""
        try:
            if not session.video_data.get('file_id'):
                return {
                    'success': False,
                    'error': 'No video file available for face detection'
                }
                
            # Get video file and extract frames for face detection
            # This would typically involve downloading the video and extracting frames
            # For now, simulate the process
            
            face_detection_request = {
                'video_file_id': session.video_data['file_id'],
                'extract_frames': True,
                'frame_interval': 1.0  # Extract frame every second
            }
            
            # Call face detection service
            face_result = self.face_detection_client.post('/detect/video', face_detection_request)
            
            if face_result.get('success'):
                return {
                    'success': True,
                    'confidence': face_result.get('confidence', 0.0),
                    'faces_detected': face_result.get('faces_detected', 0),
                    'face_encodings': face_result.get('face_encodings', []),
                    'quality_scores': face_result.get('quality_scores', [])
                }
            else:
                return {
                    'success': False,
                    'error': 'Face detection failed',
                    'details': face_result
                }
                
        except Exception as e:
            logger.error(f"Error in face detection: {e}")
            return {
                'success': False,
                'error': str(e)
            }
            
    def process_liveness_detection(self, session: KYCSession, data: Dict[str, Any]) -> Dict[str, Any]:
        """Process liveness detection step"""
        try:
            if not session.video_data.get('file_id'):
                return {
                    'success': False,
                    'error': 'No video file available for liveness detection'
                }
                
            liveness_request = {
                'video_file_id': session.video_data['file_id'],
                'method': 'passive',  # or 'active' based on requirements
                'session_id': session.id
            }
            
            # Call liveness detection service
            liveness_result = self.liveness_detection_client.post('/detect/video', liveness_request)
            
            if liveness_result.get('is_live'):
                return {
                    'success': True,
                    'is_live': True,
                    'confidence': liveness_result.get('confidence', 0.0),
                    'spoofing_probability': liveness_result.get('spoofing_probability', 0.0),
                    'method': liveness_result.get('method'),
                    'quality_metrics': liveness_result.get('quality_metrics', {})
                }
            else:
                return {
                    'success': False,
                    'is_live': False,
                    'error': 'Liveness check failed',
                    'details': liveness_result
                }
                
        except Exception as e:
            logger.error(f"Error in liveness detection: {e}")
            return {
                'success': False,
                'error': str(e)
            }
            
    def process_biometric_matching(self, session: KYCSession, data: Dict[str, Any]) -> Dict[str, Any]:
        """Process biometric matching step"""
        try:
            if not session.document_data.get('document_photo_id'):
                return {
                    'success': False,
                    'error': 'No document photo available for matching'
                }
                
            if not session.video_data.get('file_id'):
                return {
                    'success': False,
                    'error': 'No video file available for matching'
                }
                
            # Extract best frame from video for matching
            # This would typically be done by the face detection service
            
            matching_request = {
                'live_photo_data': {
                    'video_file_id': session.video_data['file_id'],
                    'session_id': session.id,
                    'extract_best_frame': True
                },
                'document_photo_id': session.document_data['document_photo_id'],
                'method': 'hybrid'  # Use hybrid matching method
            }
            
            # Call biometric matching service
            matching_result = self.biometric_matching_client.post('/match/biometric', matching_request)
            
            if matching_result.get('result') == 'match':
                return {
                    'success': True,
                    'match': True,
                    'similarity_score': matching_result.get('similarity_score', 0.0),
                    'confidence': matching_result.get('confidence', 0.0),
                    'method': matching_result.get('method'),
                    'quality_factors': matching_result.get('quality_factors', {})
                }
            else:
                return {
                    'success': False,
                    'match': False,
                    'error': 'Biometric matching failed',
                    'details': matching_result
                }
                
        except Exception as e:
            logger.error(f"Error in biometric matching: {e}")
            return {
                'success': False,
                'error': str(e)
            }
            
    def perform_final_verification(self, session: KYCSession) -> Dict[str, Any]:
        """Perform final verification and make approval decision"""
        try:
            # Get all step results
            step_results = self.get_step_results(session.id)
            
            # Calculate overall scores
            scores = {
                'document_quality': 0.0,
                'face_detection': 0.0,
                'liveness_detection': 0.0,
                'biometric_matching': 0.0
            }
            
            # Extract scores from step results
            for result in step_results:
                if result.step == KYCStep.DOCUMENT_VERIFICATION:
                    scores['document_quality'] = result.confidence
                elif result.step == KYCStep.FACE_DETECTION:
                    scores['face_detection'] = result.confidence
                elif result.step == KYCStep.LIVENESS_DETECTION:
                    scores['liveness_detection'] = result.confidence
                elif result.step == KYCStep.BIOMETRIC_MATCHING:
                    scores['biometric_matching'] = result.confidence
                    
            # Calculate weighted overall score
            weights = {
                'document_quality': 0.2,
                'face_detection': 0.2,
                'liveness_detection': 0.3,
                'biometric_matching': 0.3
            }
            
            overall_score = sum(scores[key] * weights[key] for key in scores)
            
            # Approval threshold
            approval_threshold = 0.7
            
            # Make approval decision
            approved = overall_score >= approval_threshold
            
            # Additional checks
            if approved:
                # Check minimum requirements
                if scores['liveness_detection'] < 0.6:
                    approved = False
                    
                if scores['biometric_matching'] < 0.6:
                    approved = False
                    
            return {
                'approved': approved,
                'overall_score': overall_score,
                'individual_scores': scores,
                'threshold': approval_threshold,
                'decision_factors': {
                    'liveness_passed': scores['liveness_detection'] >= 0.6,
                    'biometric_match': scores['biometric_matching'] >= 0.6,
                    'document_quality': scores['document_quality'] >= 0.5,
                    'face_detection': scores['face_detection'] >= 0.5
                },
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error in final verification: {e}")
            return {
                'approved': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
            
    # Helper methods
    
    def get_next_steps(self, session: KYCSession) -> List[str]:
        """Get next steps for session"""
        if session.status == KYCStatus.INITIATED:
            return ['document_capture']
        elif session.status == KYCStatus.DOCUMENT_UPLOADED:
            return ['video_capture']
        elif session.status == KYCStatus.VIDEO_UPLOADED:
            return ['processing']
        elif session.status == KYCStatus.VERIFICATION_COMPLETE:
            return ['complete']
        else:
            return []
            
    def get_next_step(self, session: KYCSession) -> Optional[KYCStep]:
        """Get next step for session"""
        completed_steps = set(session.steps_completed)
        
        all_steps = [
            KYCStep.DOCUMENT_CAPTURE,
            KYCStep.DOCUMENT_VERIFICATION,
            KYCStep.VIDEO_CAPTURE,
            KYCStep.FACE_DETECTION,
            KYCStep.LIVENESS_DETECTION,
            KYCStep.BIOMETRIC_MATCHING,
            KYCStep.FINAL_VERIFICATION
        ]
        
        for step in all_steps:
            if step not in completed_steps:
                return step
                
        return None
        
    def calculate_progress(self, session: KYCSession) -> Dict[str, Any]:
        """Calculate session progress"""
        total_steps = 7  # Total number of steps
        completed_steps = len(session.steps_completed)
        
        progress_percentage = (completed_steps / total_steps) * 100
        
        return {
            'percentage': progress_percentage,
            'completed_steps': completed_steps,
            'total_steps': total_steps,
            'current_step': session.current_step.value if session.current_step else None
        }
        
    # Database operations

    def store_session(self, session: KYCSession):
        """Store session in database"""
        try:
            if self.redis_client:
                key = f"kyc_session:{session.session_id}"
                session_data = {
                    'session_id': session.session_id,
                    'customer_id': session.customer_id,
                    'agent_id': session.agent_id,
                    'status': session.status.value if session.status else None,
                    'current_step': session.current_step.value if session.current_step else None,
                    'created_at': session.created_at.isoformat() if session.created_at else None,
                    'updated_at': datetime.utcnow().isoformat(),
                }
                self.redis_client.setex(key, int(self.session_timeout.total_seconds()), json.dumps(session_data))
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute(
                        """INSERT INTO kyc_sessions (session_id, customer_id, agent_id, status, current_step, created_at, updated_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s)
                           ON CONFLICT (session_id) DO UPDATE SET status=%s, current_step=%s, updated_at=%s""",
                        (session.session_id, session.customer_id, session.agent_id,
                         session.status.value if session.status else None,
                         session.current_step.value if session.current_step else None,
                         session.created_at, datetime.utcnow(),
                         session.status.value if session.status else None,
                         session.current_step.value if session.current_step else None,
                         datetime.utcnow())
                    )
                    conn.commit()
                finally:
                    self.db_pool.putconn(conn)
        except Exception as e:
            logger.error(f"Failed to store session {session.session_id}: {e}")

    def get_session(self, session_id: str) -> Optional[KYCSession]:
        """Get session from database"""
        try:
            if self.redis_client:
                key = f"kyc_session:{session_id}"
                data = self.redis_client.get(key)
                if data:
                    session_data = json.loads(data)
                    return KYCSession(
                        session_id=session_data['session_id'],
                        customer_id=session_data['customer_id'],
                        agent_id=session_data['agent_id'],
                        status=KYCStatus(session_data['status']) if session_data.get('status') else None,
                        current_step=KYCStep(session_data['current_step']) if session_data.get('current_step') else None,
                        created_at=datetime.fromisoformat(session_data['created_at']) if session_data.get('created_at') else None,
                    )
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT * FROM kyc_sessions WHERE session_id = %s", (session_id,))
                    row = cur.fetchone()
                    if row:
                        return KYCSession(
                            session_id=row[0], customer_id=row[1], agent_id=row[2],
                            status=KYCStatus(row[3]) if row[3] else None,
                            current_step=KYCStep(row[4]) if row[4] else None,
                            created_at=row[5],
                        )
                finally:
                    self.db_pool.putconn(conn)
        except Exception as e:
            logger.error(f"Failed to get session {session_id}: {e}")
        return None

    def update_session(self, session: KYCSession):
        """Update session in database"""
        self.store_session(session)

    def update_session_status(self, session_id: str, status: KYCStatus):
        """Update session status"""
        try:
            if self.redis_client:
                key = f"kyc_session:{session_id}"
                data = self.redis_client.get(key)
                if data:
                    session_data = json.loads(data)
                    session_data['status'] = status.value
                    session_data['updated_at'] = datetime.utcnow().isoformat()
                    self.redis_client.setex(key, int(self.session_timeout.total_seconds()), json.dumps(session_data))
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE kyc_sessions SET status = %s, updated_at = %s WHERE session_id = %s",
                        (status.value, datetime.utcnow(), session_id)
                    )
                    conn.commit()
                finally:
                    self.db_pool.putconn(conn)
            self.kyc_sessions_total.labels(status=status.value).inc()
        except Exception as e:
            logger.error(f"Failed to update session status {session_id}: {e}")

    def store_step_result(self, session_id: str, step_result: StepResult):
        """Store step result in database"""
        try:
            if self.redis_client:
                key = f"kyc_step_results:{session_id}"
                existing = self.redis_client.get(key)
                results = json.loads(existing) if existing else []
                results.append({
                    'step': step_result.step.value if step_result.step else None,
                    'status': step_result.status,
                    'score': step_result.score,
                    'timestamp': datetime.utcnow().isoformat(),
                    'data': step_result.data if hasattr(step_result, 'data') else {},
                })
                self.redis_client.setex(key, int(self.session_timeout.total_seconds()), json.dumps(results))
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute(
                        """INSERT INTO kyc_step_results (session_id, step, status, score, created_at)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (session_id, step_result.step.value if step_result.step else None,
                         step_result.status, step_result.score, datetime.utcnow())
                    )
                    conn.commit()
                finally:
                    self.db_pool.putconn(conn)
        except Exception as e:
            logger.error(f"Failed to store step result for {session_id}: {e}")

    def get_step_results(self, session_id: str) -> List[StepResult]:
        """Get step results for session"""
        try:
            if self.redis_client:
                key = f"kyc_step_results:{session_id}"
                data = self.redis_client.get(key)
                if data:
                    results = json.loads(data)
                    return [StepResult(
                        step=KYCStep(r['step']) if r.get('step') else None,
                        status=r.get('status'),
                        score=r.get('score'),
                    ) for r in results]
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT step, status, score FROM kyc_step_results WHERE session_id = %s ORDER BY created_at", (session_id,))
                    rows = cur.fetchall()
                    return [StepResult(
                        step=KYCStep(row[0]) if row[0] else None,
                        status=row[1], score=row[2],
                    ) for row in rows]
                finally:
                    self.db_pool.putconn(conn)
        except Exception as e:
            logger.error(f"Failed to get step results for {session_id}: {e}")
        return []

    def send_notification(self, session_id: str, notification_type: NotificationType,
                         title: str, message: str, data: Dict[str, Any]):
        """Send notification"""
        try:
            notification = KYCNotification(
                notification_id=str(uuid.uuid4()) if hasattr(uuid, 'uuid4') else session_id,
                session_id=session_id,
                type=notification_type,
                title=title,
                message=message,
                data=data,
                created_at=datetime.utcnow(),
            )
            if self.redis_client:
                key = f"kyc_notifications:{session_id}"
                existing = self.redis_client.get(key)
                notifications = json.loads(existing) if existing else []
                notifications.append({
                    'notification_id': notification.notification_id,
                    'session_id': session_id,
                    'type': notification_type.value,
                    'title': title,
                    'message': message,
                    'data': data,
                    'read': False,
                    'created_at': datetime.utcnow().isoformat(),
                })
                self.redis_client.setex(key, 86400, json.dumps(notifications))
            logger.info(f"Notification sent for session {session_id}: {title}")
        except Exception as e:
            logger.error(f"Failed to send notification for {session_id}: {e}")

    def cleanup_expired_sessions(self):
        """Clean up expired sessions"""
        try:
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cutoff = datetime.utcnow() - self.session_timeout
                    cur.execute(
                        "UPDATE kyc_sessions SET status = %s WHERE status NOT IN (%s, %s, %s) AND updated_at < %s",
                        (KYCStatus.EXPIRED.value, KYCStatus.COMPLETED.value,
                         KYCStatus.FAILED.value, KYCStatus.EXPIRED.value, cutoff)
                    )
                    count = cur.rowcount
                    conn.commit()
                    if count > 0:
                        logger.info(f"Cleaned up {count} expired KYC sessions")
                finally:
                    self.db_pool.putconn(conn)
        except Exception as e:
            logger.error(f"Session cleanup failed: {e}")

    def update_metrics(self):
        """Update Prometheus metrics"""
        try:
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT status, COUNT(*) FROM kyc_sessions GROUP BY status")
                    for row in cur.fetchall():
                        self.kyc_sessions_total.labels(status=row[0]).inc(0)
                finally:
                    self.db_pool.putconn(conn)
        except Exception as e:
            logger.error(f"Metrics update failed: {e}")

    def process_pending_notifications(self):
        """Process pending notifications"""
        try:
            if self.redis_client:
                keys = self.redis_client.keys("kyc_notifications:*")
                for key in keys:
                    data = self.redis_client.get(key)
                    if data:
                        notifications = json.loads(data)
                        unread = [n for n in notifications if not n.get('read')]
                        if unread:
                            logger.debug(f"Processing {len(unread)} pending notifications for {key}")
        except Exception as e:
            logger.error(f"Notification processing failed: {e}")

    def cancel_session_handler(self, session_id: str):
        """Handle session cancellation"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
            if session.status in (KYCStatus.COMPLETED, KYCStatus.FAILED):
                return jsonify({'error': f'Cannot cancel session in {session.status.value} state'}), 400
            self.update_session_status(session_id, KYCStatus.CANCELLED)
            self.send_notification(session_id, NotificationType.SESSION_CANCELLED,
                                   "Session Cancelled", "KYC session has been cancelled", {})
            return jsonify({'session_id': session_id, 'status': 'cancelled'})
        except Exception as e:
            logger.error(f"Cancel session failed: {e}")
            return jsonify({'error': str(e)}), 500

    def next_step_handler(self, session_id: str):
        """Handle next step requests"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
            next_step = self.get_next_step(session)
            if not next_step:
                return jsonify({'session_id': session_id, 'message': 'All steps completed', 'next_step': None})
            session.current_step = next_step
            self.update_session(session)
            return jsonify({
                'session_id': session_id,
                'next_step': next_step.value,
                'progress': self.calculate_progress(session),
            })
        except Exception as e:
            logger.error(f"Next step failed: {e}")
            return jsonify({'error': str(e)}), 500

    def retry_step_handler(self, session_id: str):
        """Handle step retry requests"""
        try:
            session = self.get_session(session_id)
            if not session:
                return jsonify({'error': 'Session not found'}), 404
            current_step = session.current_step
            if not current_step:
                return jsonify({'error': 'No current step to retry'}), 400
            return jsonify({
                'session_id': session_id,
                'retry_step': current_step.value,
                'status': 'retry_initiated',
            })
        except Exception as e:
            logger.error(f"Retry step failed: {e}")
            return jsonify({'error': str(e)}), 500

    def get_notifications_handler(self, session_id: str):
        """Handle notification retrieval"""
        try:
            if self.redis_client:
                key = f"kyc_notifications:{session_id}"
                data = self.redis_client.get(key)
                notifications = json.loads(data) if data else []
                return jsonify({'session_id': session_id, 'notifications': notifications})
            return jsonify({'session_id': session_id, 'notifications': []})
        except Exception as e:
            logger.error(f"Get notifications failed: {e}")
            return jsonify({'error': str(e)}), 500

    def mark_notification_read_handler(self, notification_id: str):
        """Handle notification read marking"""
        try:
            if self.redis_client:
                keys = self.redis_client.keys("kyc_notifications:*")
                for key in keys:
                    data = self.redis_client.get(key)
                    if data:
                        notifications = json.loads(data)
                        updated = False
                        for n in notifications:
                            if n.get('notification_id') == notification_id:
                                n['read'] = True
                                updated = True
                        if updated:
                            self.redis_client.setex(key, 86400, json.dumps(notifications))
                            return jsonify({'notification_id': notification_id, 'read': True})
            return jsonify({'error': 'Notification not found'}), 404
        except Exception as e:
            logger.error(f"Mark notification read failed: {e}")
            return jsonify({'error': str(e)}), 500

    def get_session_analytics_handler(self):
        """Handle session analytics requests"""
        try:
            analytics = {'total_sessions': 0, 'by_status': {}, 'avg_completion_time': None}
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT status, COUNT(*) FROM kyc_sessions GROUP BY status")
                    for row in cur.fetchall():
                        analytics['by_status'][row[0]] = row[1]
                        analytics['total_sessions'] += row[1]
                finally:
                    self.db_pool.putconn(conn)
            return jsonify(analytics)
        except Exception as e:
            logger.error(f"Session analytics failed: {e}")
            return jsonify({'error': str(e)}), 500

    def get_performance_analytics_handler(self):
        """Handle performance analytics requests"""
        try:
            perf = {
                'avg_step_duration_ms': 0,
                'success_rate': 0,
                'total_completed': 0,
                'total_failed': 0,
            }
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT COUNT(*) FROM kyc_sessions WHERE status = %s", (KYCStatus.COMPLETED.value,))
                    row = cur.fetchone()
                    perf['total_completed'] = row[0] if row else 0
                    cur.execute("SELECT COUNT(*) FROM kyc_sessions WHERE status = %s", (KYCStatus.FAILED.value,))
                    row = cur.fetchone()
                    perf['total_failed'] = row[0] if row else 0
                    total = perf['total_completed'] + perf['total_failed']
                    perf['success_rate'] = (perf['total_completed'] / total * 100) if total > 0 else 0
                finally:
                    self.db_pool.putconn(conn)
            return jsonify(perf)
        except Exception as e:
            logger.error(f"Performance analytics failed: {e}")
            return jsonify({'error': str(e)}), 500

    def list_sessions_handler(self):
        """Handle session listing requests"""
        try:
            sessions = []
            if self.db_pool:
                conn = self.db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT session_id, customer_id, agent_id, status, current_step, created_at, updated_at FROM kyc_sessions ORDER BY created_at DESC LIMIT 100")
                    for row in cur.fetchall():
                        sessions.append({
                            'session_id': row[0],
                            'customer_id': row[1],
                            'agent_id': row[2],
                            'status': row[3],
                            'current_step': row[4],
                            'created_at': row[5].isoformat() if row[5] else None,
                            'updated_at': row[6].isoformat() if row[6] else None,
                        })
                finally:
                    self.db_pool.putconn(conn)
            return jsonify({'sessions': sessions, 'total': len(sessions)})
        except Exception as e:
            logger.error(f"List sessions failed: {e}")
            return jsonify({'error': str(e)}), 500
        
    def run(self, host='0.0.0.0', port=8088, debug=False):
        """Run the service"""
        logger.info(f"Starting Video KYC Orchestrator on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)

if __name__ == '__main__':
    orchestrator = VideoKYCOrchestrator()
    
    port = int(os.getenv('PORT', 8088))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    orchestrator.run(port=port, debug=debug)

