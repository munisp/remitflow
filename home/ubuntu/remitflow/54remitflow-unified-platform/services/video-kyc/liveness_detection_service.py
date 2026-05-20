#!/usr/bin/env python3
"""
Liveness Detection Service for Video KYC
Advanced liveness detection with anti-spoofing measures
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

import numpy as np
import cv2
import dlib
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as transforms
from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM
import mediapipe as mp
import redis
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import prometheus_client
from prometheus_client import Counter, Histogram, Gauge, generate_latest

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class LivenessMethod(Enum):
    """Liveness detection methods"""
    PASSIVE = "passive"
    ACTIVE_BLINK = "active_blink"
    ACTIVE_SMILE = "active_smile"
    ACTIVE_HEAD_MOVEMENT = "active_head_movement"
    ACTIVE_MOUTH_MOVEMENT = "active_mouth_movement"
    TEXTURE_ANALYSIS = "texture_analysis"
    DEPTH_ANALYSIS = "depth_analysis"
    MOTION_ANALYSIS = "motion_analysis"
    CHALLENGE_RESPONSE = "challenge_response"

class SpoofingType(Enum):
    """Types of spoofing attacks"""
    PHOTO_ATTACK = "photo_attack"
    VIDEO_REPLAY = "video_replay"
    MASK_ATTACK = "mask_attack"
    DEEPFAKE = "deepfake"
    SCREEN_ATTACK = "screen_attack"
    PRINT_ATTACK = "print_attack"

@dataclass
class LivenessChallenge:
    """Liveness challenge data structure"""
    id: str
    type: LivenessMethod
    instruction: str
    duration: float
    expected_response: Dict[str, Any]
    tolerance: float
    timestamp: datetime

@dataclass
class LivenessResult:
    """Liveness detection result"""
    is_live: bool
    confidence: float
    method: LivenessMethod
    spoofing_probability: float
    spoofing_type: Optional[SpoofingType]
    challenge_results: List[Dict[str, Any]]
    quality_metrics: Dict[str, float]
    processing_time: float
    metadata: Dict[str, Any]
    timestamp: datetime

@dataclass
class AntiSpoofingMetrics:
    """Anti-spoofing analysis metrics"""
    texture_score: float
    motion_score: float
    depth_score: float
    frequency_score: float
    consistency_score: float
    overall_score: float

class LivenessDetectionModel:
    """Advanced liveness detection model"""
    
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.face_mesh = None
        self.face_detector = None
        self.landmark_predictor = None
        self.anti_spoofing_model = None
        self.motion_analyzer = None
        self.texture_analyzer = None
        
        self.load_models()
        
    def load_models(self):
        """Load liveness detection models"""
        try:
            # Initialize MediaPipe Face Mesh
            self.face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
            
            # Initialize dlib face detector
            self.face_detector = dlib.get_frontal_face_detector()
            
            # Load landmark predictor
            predictor_path = "models/shape_predictor_68_face_landmarks.dat"
            if os.path.exists(predictor_path):
                self.landmark_predictor = dlib.shape_predictor(predictor_path)
                
            # Initialize motion analyzer
            self.motion_analyzer = MotionAnalyzer()
            
            # Initialize texture analyzer
            self.texture_analyzer = TextureAnalyzer()
            
            # Load anti-spoofing model (placeholder for actual model)
            self.anti_spoofing_model = AntiSpoofingCNN()
            
            logger.info("Liveness detection models loaded successfully")
            
        except Exception as e:
            logger.error(f"Error loading liveness detection models: {e}")

class AntiSpoofingCNN(nn.Module):
    """CNN model for anti-spoofing detection"""
    
    def __init__(self, num_classes=2):
        super(AntiSpoofingCNN, self).__init__()
        
        # Convolutional layers
        self.conv1 = nn.Conv2d(3, 32, kernel_size=3, padding=1)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.conv3 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        self.conv4 = nn.Conv2d(128, 256, kernel_size=3, padding=1)
        
        # Batch normalization
        self.bn1 = nn.BatchNorm2d(32)
        self.bn2 = nn.BatchNorm2d(64)
        self.bn3 = nn.BatchNorm2d(128)
        self.bn4 = nn.BatchNorm2d(256)
        
        # Pooling
        self.pool = nn.MaxPool2d(2, 2)
        self.adaptive_pool = nn.AdaptiveAvgPool2d((4, 4))
        
        # Fully connected layers
        self.fc1 = nn.Linear(256 * 4 * 4, 512)
        self.fc2 = nn.Linear(512, 128)
        self.fc3 = nn.Linear(128, num_classes)
        
        # Dropout
        self.dropout = nn.Dropout(0.5)
        
    def forward(self, x):
        # Convolutional layers with ReLU and pooling
        x = self.pool(F.relu(self.bn1(self.conv1(x))))
        x = self.pool(F.relu(self.bn2(self.conv2(x))))
        x = self.pool(F.relu(self.bn3(self.conv3(x))))
        x = self.pool(F.relu(self.bn4(self.conv4(x))))
        
        # Adaptive pooling
        x = self.adaptive_pool(x)
        
        # Flatten
        x = x.view(-1, 256 * 4 * 4)
        
        # Fully connected layers
        x = F.relu(self.fc1(x))
        x = self.dropout(x)
        x = F.relu(self.fc2(x))
        x = self.dropout(x)
        x = self.fc3(x)
        
        return F.softmax(x, dim=1)

class MotionAnalyzer:
    """Analyze motion patterns for liveness detection"""
    
    def __init__(self):
        self.previous_landmarks = None
        self.motion_history = []
        self.max_history = 30  # frames
        
    def analyze_motion(self, landmarks: np.ndarray, timestamp: float) -> Dict[str, float]:
        """Analyze motion patterns in facial landmarks"""
        try:
            motion_metrics = {
                'velocity': 0.0,
                'acceleration': 0.0,
                'smoothness': 0.0,
                'naturalness': 0.0,
                'consistency': 0.0
            }
            
            if self.previous_landmarks is not None:
                # Calculate velocity (displacement between frames)
                displacement = np.linalg.norm(landmarks - self.previous_landmarks, axis=1)
                velocity = np.mean(displacement)
                motion_metrics['velocity'] = float(velocity)
                
                # Store motion data
                self.motion_history.append({
                    'timestamp': timestamp,
                    'velocity': velocity,
                    'landmarks': landmarks.copy()
                })
                
                # Keep only recent history
                if len(self.motion_history) > self.max_history:
                    self.motion_history.pop(0)
                
                # Calculate advanced metrics if we have enough history
                if len(self.motion_history) >= 5:
                    motion_metrics.update(self._calculate_advanced_motion_metrics())
                    
            self.previous_landmarks = landmarks.copy()
            return motion_metrics
            
        except Exception as e:
            logger.error(f"Error analyzing motion: {e}")
            return motion_metrics
            
    def _calculate_advanced_motion_metrics(self) -> Dict[str, float]:
        """Calculate advanced motion metrics"""
        try:
            velocities = [frame['velocity'] for frame in self.motion_history[-10:]]
            
            # Calculate acceleration (change in velocity)
            if len(velocities) >= 2:
                accelerations = np.diff(velocities)
                acceleration = np.mean(np.abs(accelerations))
            else:
                acceleration = 0.0
                
            # Calculate smoothness (variance in velocity)
            smoothness = 1.0 / (1.0 + np.var(velocities)) if len(velocities) > 1 else 0.0
            
            # Calculate naturalness (based on expected human motion patterns)
            naturalness = self._assess_motion_naturalness(velocities)
            
            # Calculate consistency (temporal consistency of motion)
            consistency = self._assess_motion_consistency()
            
            return {
                'acceleration': float(acceleration),
                'smoothness': float(smoothness),
                'naturalness': float(naturalness),
                'consistency': float(consistency)
            }
            
        except Exception as e:
            logger.error(f"Error calculating advanced motion metrics: {e}")
            return {
                'acceleration': 0.0,
                'smoothness': 0.0,
                'naturalness': 0.0,
                'consistency': 0.0
            }
            
    def _assess_motion_naturalness(self, velocities: List[float]) -> float:
        """Assess if motion patterns appear natural"""
        try:
            if len(velocities) < 3:
                return 0.5
                
            # Natural motion should have some variation but not be too erratic
            velocity_range = max(velocities) - min(velocities)
            mean_velocity = np.mean(velocities)
            
            if mean_velocity == 0:
                return 0.0
                
            # Calculate coefficient of variation
            cv = np.std(velocities) / mean_velocity
            
            # Natural motion typically has CV between 0.2 and 0.8
            if 0.2 <= cv <= 0.8:
                naturalness = 1.0 - abs(cv - 0.5) * 2
            else:
                naturalness = max(0.0, 1.0 - abs(cv - 0.5))
                
            return float(naturalness)
            
        except Exception as e:
            logger.error(f"Error assessing motion naturalness: {e}")
            return 0.0
            
    def _assess_motion_consistency(self) -> float:
        """Assess temporal consistency of motion"""
        try:
            if len(self.motion_history) < 5:
                return 0.5
                
            # Check for sudden jumps or inconsistencies
            timestamps = [frame['timestamp'] for frame in self.motion_history[-10:]]
            velocities = [frame['velocity'] for frame in self.motion_history[-10:]]
            
            # Calculate time intervals
            time_intervals = np.diff(timestamps)
            
            # Check for consistent timing
            time_consistency = 1.0 / (1.0 + np.var(time_intervals)) if len(time_intervals) > 1 else 1.0
            
            # Check for velocity consistency (no sudden jumps)
            velocity_changes = np.abs(np.diff(velocities))
            velocity_consistency = 1.0 / (1.0 + np.mean(velocity_changes))
            
            # Combined consistency score
            consistency = (time_consistency + velocity_consistency) / 2.0
            
            return float(consistency)
            
        except Exception as e:
            logger.error(f"Error assessing motion consistency: {e}")
            return 0.0

class TextureAnalyzer:
    """Analyze texture patterns for anti-spoofing"""
    
    def __init__(self):
        self.lbp_radius = 3
        self.lbp_n_points = 8 * self.lbp_radius
        
    def analyze_texture(self, face_image: np.ndarray) -> Dict[str, float]:
        """Analyze texture patterns in face image"""
        try:
            # Convert to grayscale
            if len(face_image.shape) == 3:
                gray = cv2.cvtColor(face_image, cv2.COLOR_BGR2GRAY)
            else:
                gray = face_image
                
            # Calculate Local Binary Pattern (LBP)
            lbp = self._calculate_lbp(gray)
            
            # Calculate texture metrics
            texture_metrics = {
                'lbp_uniformity': self._calculate_lbp_uniformity(lbp),
                'contrast': self._calculate_contrast(gray),
                'homogeneity': self._calculate_homogeneity(gray),
                'energy': self._calculate_energy(gray),
                'entropy': self._calculate_entropy(gray),
                'gradient_magnitude': self._calculate_gradient_magnitude(gray)
            }
            
            return texture_metrics
            
        except Exception as e:
            logger.error(f"Error analyzing texture: {e}")
            return {
                'lbp_uniformity': 0.0,
                'contrast': 0.0,
                'homogeneity': 0.0,
                'energy': 0.0,
                'entropy': 0.0,
                'gradient_magnitude': 0.0
            }
            
    def _calculate_lbp(self, image: np.ndarray) -> np.ndarray:
        """Calculate Local Binary Pattern"""
        try:
            # Simple LBP implementation
            height, width = image.shape
            lbp = np.zeros((height, width), dtype=np.uint8)
            
            for i in range(1, height - 1):
                for j in range(1, width - 1):
                    center = image[i, j]
                    code = 0
                    
                    # Compare with 8 neighbors
                    neighbors = [
                        image[i-1, j-1], image[i-1, j], image[i-1, j+1],
                        image[i, j+1], image[i+1, j+1], image[i+1, j],
                        image[i+1, j-1], image[i, j-1]
                    ]
                    
                    for k, neighbor in enumerate(neighbors):
                        if neighbor >= center:
                            code |= (1 << k)
                            
                    lbp[i, j] = code
                    
            return lbp
            
        except Exception as e:
            logger.error(f"Error calculating LBP: {e}")
            return np.zeros_like(image)
            
    def _calculate_lbp_uniformity(self, lbp: np.ndarray) -> float:
        """Calculate LBP uniformity measure"""
        try:
            # Count uniform patterns (patterns with at most 2 transitions)
            uniform_count = 0
            total_count = lbp.size
            
            for value in lbp.flatten():
                # Count bit transitions in binary representation
                binary = format(value, '08b')
                transitions = sum(1 for i in range(len(binary)) 
                                if binary[i] != binary[(i + 1) % len(binary)])
                
                if transitions <= 2:
                    uniform_count += 1
                    
            uniformity = uniform_count / total_count if total_count > 0 else 0.0
            return float(uniformity)
            
        except Exception as e:
            logger.error(f"Error calculating LBP uniformity: {e}")
            return 0.0
            
    def _calculate_contrast(self, image: np.ndarray) -> float:
        """Calculate image contrast"""
        try:
            return float(np.std(image) / 255.0)
        except Exception as e:
            logger.error(f"Error calculating contrast: {e}")
            return 0.0
            
    def _calculate_homogeneity(self, image: np.ndarray) -> float:
        """Calculate image homogeneity"""
        try:
            # Calculate gray level co-occurrence matrix (simplified)
            glcm = self._calculate_glcm(image)
            
            homogeneity = 0.0
            for i in range(glcm.shape[0]):
                for j in range(glcm.shape[1]):
                    homogeneity += glcm[i, j] / (1 + abs(i - j))
                    
            return float(homogeneity)
            
        except Exception as e:
            logger.error(f"Error calculating homogeneity: {e}")
            return 0.0
            
    def _calculate_energy(self, image: np.ndarray) -> float:
        """Calculate image energy"""
        try:
            glcm = self._calculate_glcm(image)
            energy = np.sum(glcm ** 2)
            return float(energy)
            
        except Exception as e:
            logger.error(f"Error calculating energy: {e}")
            return 0.0
            
    def _calculate_entropy(self, image: np.ndarray) -> float:
        """Calculate image entropy"""
        try:
            # Calculate histogram
            hist, _ = np.histogram(image, bins=256, range=(0, 256))
            hist = hist / np.sum(hist)  # Normalize
            
            # Calculate entropy
            entropy = -np.sum(hist * np.log2(hist + 1e-10))
            return float(entropy / 8.0)  # Normalize to 0-1
            
        except Exception as e:
            logger.error(f"Error calculating entropy: {e}")
            return 0.0
            
    def _calculate_gradient_magnitude(self, image: np.ndarray) -> float:
        """Calculate gradient magnitude"""
        try:
            # Calculate gradients
            grad_x = cv2.Sobel(image, cv2.CV_64F, 1, 0, ksize=3)
            grad_y = cv2.Sobel(image, cv2.CV_64F, 0, 1, ksize=3)
            
            # Calculate magnitude
            magnitude = np.sqrt(grad_x**2 + grad_y**2)
            return float(np.mean(magnitude) / 255.0)
            
        except Exception as e:
            logger.error(f"Error calculating gradient magnitude: {e}")
            return 0.0
            
    def _calculate_glcm(self, image: np.ndarray, distance: int = 1) -> np.ndarray:
        """Calculate Gray Level Co-occurrence Matrix (simplified)"""
        try:
            # Reduce gray levels for computational efficiency
            levels = 16
            image_reduced = (image // (256 // levels)).astype(np.uint8)
            
            # Initialize GLCM
            glcm = np.zeros((levels, levels), dtype=np.float32)
            
            # Calculate co-occurrence for horizontal direction
            for i in range(image_reduced.shape[0]):
                for j in range(image_reduced.shape[1] - distance):
                    gray1 = image_reduced[i, j]
                    gray2 = image_reduced[i, j + distance]
                    glcm[gray1, gray2] += 1
                    
            # Normalize
            glcm = glcm / np.sum(glcm) if np.sum(glcm) > 0 else glcm
            
            return glcm
            
        except Exception as e:
            logger.error(f"Error calculating GLCM: {e}")
            return np.zeros((16, 16), dtype=np.float32)

class LivenessDetectionService:
    """Main liveness detection service"""
    
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Initialize components
        self.model = LivenessDetectionModel()
        self.redis_client = None
        self.db_pool = None
        self.executor = ThreadPoolExecutor(max_workers=4)
        
        # Challenge management
        self.active_challenges = {}
        self.challenge_lock = threading.Lock()
        
        # Metrics
        self.setup_metrics()
        
        # Initialize connections
        self.setup_database()
        self.setup_redis()
        self.setup_routes()
        
        logger.info("Liveness Detection Service initialized")
        
    def setup_metrics(self):
        """Setup Prometheus metrics"""
        self.liveness_requests = Counter(
            'liveness_detection_requests_total',
            'Total liveness detection requests',
            ['method', 'result']
        )
        
        self.liveness_duration = Histogram(
            'liveness_detection_duration_seconds',
            'Liveness detection processing duration',
            ['method']
        )
        
        self.spoofing_attempts = Counter(
            'spoofing_attempts_total',
            'Total spoofing attempts detected',
            ['type']
        )
        
        self.liveness_accuracy = Gauge(
            'liveness_detection_accuracy',
            'Liveness detection accuracy percentage'
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
                maxconn=10,
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
            
    def create_tables(self):
        """Create database tables"""
        if not self.db_pool:
            return
            
        try:
            conn = self.db_pool.getconn()
            cursor = conn.cursor()
            
            # Liveness detection logs table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS liveness_detection_logs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    session_id VARCHAR(255),
                    request_id VARCHAR(255),
                    method VARCHAR(50),
                    is_live BOOLEAN,
                    confidence DECIMAL(5,4),
                    spoofing_probability DECIMAL(5,4),
                    spoofing_type VARCHAR(50),
                    challenge_results JSONB,
                    quality_metrics JSONB,
                    processing_time_ms INTEGER,
                    metadata JSONB,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_liveness_logs_session_id 
                ON liveness_detection_logs(session_id);
                
                CREATE INDEX IF NOT EXISTS idx_liveness_logs_request_id 
                ON liveness_detection_logs(request_id);
            """)
            
            # Liveness challenges table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS liveness_challenges (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    session_id VARCHAR(255),
                    challenge_type VARCHAR(50),
                    instruction TEXT,
                    duration DECIMAL(5,2),
                    expected_response JSONB,
                    actual_response JSONB,
                    success BOOLEAN,
                    confidence DECIMAL(5,4),
                    created_at TIMESTAMP DEFAULT NOW(),
                    completed_at TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_liveness_challenges_session_id 
                ON liveness_challenges(session_id);
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
                'service': 'liveness-detection',
                'version': '1.0.0'
            })
            
        @self.app.route('/metrics', methods=['GET'])
        def metrics():
            return generate_latest()
            
        @self.app.route('/detect', methods=['POST'])
        def detect_liveness():
            return self.detect_liveness_handler()
            
        @self.app.route('/challenge/create', methods=['POST'])
        def create_challenge():
            return self.create_challenge_handler()
            
        @self.app.route('/challenge/<challenge_id>/respond', methods=['POST'])
        def respond_challenge(challenge_id):
            return self.respond_challenge_handler(challenge_id)
            
        @self.app.route('/challenge/<challenge_id>/status', methods=['GET'])
        def challenge_status(challenge_id):
            return self.challenge_status_handler(challenge_id)
            
        @self.app.route('/antispoofing', methods=['POST'])
        def antispoofing_analysis():
            return self.antispoofing_analysis_handler()
            
        @self.app.route('/session/<session_id>/results', methods=['GET'])
        def session_results(session_id):
            return self.session_results_handler(session_id)
            
        @self.app.route('/batch/detect', methods=['POST'])
        def batch_detect():
            return self.batch_detect_handler()
            
        @self.app.route('/stats', methods=['GET'])
        def get_stats():
            return self.get_stats_handler()
            
    def detect_liveness_handler(self):
        """Handle liveness detection requests"""
        try:
            data = request.get_json()
            
            if not data or 'image_data' not in data:
                return jsonify({'error': 'Missing image_data'}), 400
                
            start_time = time.time()
            
            # Decode image
            image_data = base64.b64decode(data['image_data'])
            nparr = np.frombuffer(image_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return jsonify({'error': 'Invalid image data'}), 400
                
            # Get detection method
            method = LivenessMethod(data.get('method', 'passive'))
            session_id = data.get('session_id', str(uuid.uuid4()))
            
            # Perform liveness detection
            result = self.perform_liveness_detection(image, method, session_id)
            
            processing_time = (time.time() - start_time) * 1000
            result.processing_time = processing_time
            
            # Store results
            self.store_liveness_result(session_id, data.get('request_id'), result)
            
            # Update metrics
            result_label = 'live' if result.is_live else 'not_live'
            self.liveness_requests.labels(method=method.value, result=result_label).inc()
            self.liveness_duration.labels(method=method.value).observe(processing_time / 1000.0)
            
            if result.spoofing_type:
                self.spoofing_attempts.labels(type=result.spoofing_type.value).inc()
                
            return jsonify(asdict(result))
            
        except Exception as e:
            logger.error(f"Error in detect_liveness_handler: {e}")
            self.liveness_requests.labels(method='unknown', result='error').inc()
            return jsonify({'error': str(e)}), 500
            
    def perform_liveness_detection(self, image: np.ndarray, method: LivenessMethod, 
                                 session_id: str) -> LivenessResult:
        """Perform liveness detection using specified method"""
        try:
            # Initialize result
            result = LivenessResult(
                is_live=False,
                confidence=0.0,
                method=method,
                spoofing_probability=1.0,
                spoofing_type=None,
                challenge_results=[],
                quality_metrics={},
                processing_time=0.0,
                metadata={},
                timestamp=datetime.now()
            )
            
            # Detect face and landmarks
            face_landmarks = self.detect_face_landmarks(image)
            if face_landmarks is None:
                result.metadata['error'] = 'No face detected'
                return result
                
            # Perform method-specific detection
            if method == LivenessMethod.PASSIVE:
                result = self.passive_liveness_detection(image, face_landmarks, result)
            elif method == LivenessMethod.TEXTURE_ANALYSIS:
                result = self.texture_based_detection(image, face_landmarks, result)
            elif method == LivenessMethod.MOTION_ANALYSIS:
                result = self.motion_based_detection(image, face_landmarks, result, session_id)
            else:
                # For active methods, return challenge requirement
                result.metadata['requires_challenge'] = True
                result.metadata['challenge_type'] = method.value
                
            # Perform anti-spoofing analysis
            antispoofing_metrics = self.analyze_antispoofing(image, face_landmarks)
            result.spoofing_probability = 1.0 - antispoofing_metrics.overall_score
            result.spoofing_type = self.detect_spoofing_type(antispoofing_metrics)
            
            # Update overall confidence
            if result.spoofing_probability < 0.3:  # Low spoofing probability
                result.confidence = min(result.confidence * 1.2, 1.0)
            else:
                result.confidence = max(result.confidence * 0.8, 0.0)
                
            # Final liveness decision
            result.is_live = (result.confidence > 0.7 and result.spoofing_probability < 0.3)
            
            return result
            
        except Exception as e:
            logger.error(f"Error performing liveness detection: {e}")
            result.metadata['error'] = str(e)
            return result
            
    def detect_face_landmarks(self, image: np.ndarray) -> Optional[np.ndarray]:
        """Detect facial landmarks using MediaPipe"""
        try:
            # Convert BGR to RGB
            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Process with MediaPipe
            results = self.model.face_mesh.process(rgb_image)
            
            if results.multi_face_landmarks:
                landmarks = results.multi_face_landmarks[0]
                
                # Convert to numpy array
                landmark_points = []
                for landmark in landmarks.landmark:
                    landmark_points.append([landmark.x, landmark.y, landmark.z])
                    
                return np.array(landmark_points)
                
            return None
            
        except Exception as e:
            logger.error(f"Error detecting face landmarks: {e}")
            return None
            
    def passive_liveness_detection(self, image: np.ndarray, landmarks: np.ndarray, 
                                 result: LivenessResult) -> LivenessResult:
        """Perform passive liveness detection"""
        try:
            # Extract face region
            face_region = self.extract_face_region(image, landmarks)
            
            # Analyze texture
            texture_metrics = self.model.texture_analyzer.analyze_texture(face_region)
            
            # Calculate quality metrics
            quality_metrics = self.calculate_image_quality(face_region)
            
            # Combine metrics for liveness score
            liveness_score = (
                texture_metrics['lbp_uniformity'] * 0.3 +
                texture_metrics['contrast'] * 0.2 +
                quality_metrics['sharpness'] * 0.2 +
                quality_metrics['brightness'] * 0.15 +
                quality_metrics['naturalness'] * 0.15
            )
            
            result.confidence = liveness_score
            result.quality_metrics = {**texture_metrics, **quality_metrics}
            result.metadata['detection_method'] = 'passive_analysis'
            
            return result
            
        except Exception as e:
            logger.error(f"Error in passive liveness detection: {e}")
            result.metadata['error'] = str(e)
            return result
            
    def texture_based_detection(self, image: np.ndarray, landmarks: np.ndarray, 
                              result: LivenessResult) -> LivenessResult:
        """Perform texture-based liveness detection"""
        try:
            # Extract face region
            face_region = self.extract_face_region(image, landmarks)
            
            # Analyze texture patterns
            texture_metrics = self.model.texture_analyzer.analyze_texture(face_region)
            
            # Calculate texture-based liveness score
            # Real faces typically have more complex texture patterns
            texture_score = (
                texture_metrics['entropy'] * 0.3 +
                texture_metrics['lbp_uniformity'] * 0.25 +
                texture_metrics['gradient_magnitude'] * 0.25 +
                texture_metrics['contrast'] * 0.2
            )
            
            result.confidence = texture_score
            result.quality_metrics = texture_metrics
            result.metadata['detection_method'] = 'texture_analysis'
            
            return result
            
        except Exception as e:
            logger.error(f"Error in texture-based detection: {e}")
            result.metadata['error'] = str(e)
            return result
            
    def motion_based_detection(self, image: np.ndarray, landmarks: np.ndarray, 
                             result: LivenessResult, session_id: str) -> LivenessResult:
        """Perform motion-based liveness detection"""
        try:
            # Analyze motion patterns
            motion_metrics = self.model.motion_analyzer.analyze_motion(
                landmarks, time.time()
            )
            
            # Calculate motion-based liveness score
            motion_score = (
                motion_metrics['naturalness'] * 0.4 +
                motion_metrics['smoothness'] * 0.3 +
                motion_metrics['consistency'] * 0.3
            )
            
            result.confidence = motion_score
            result.quality_metrics = motion_metrics
            result.metadata['detection_method'] = 'motion_analysis'
            result.metadata['session_id'] = session_id
            
            return result
            
        except Exception as e:
            logger.error(f"Error in motion-based detection: {e}")
            result.metadata['error'] = str(e)
            return result
            
    def analyze_antispoofing(self, image: np.ndarray, landmarks: np.ndarray) -> AntiSpoofingMetrics:
        """Analyze image for anti-spoofing"""
        try:
            # Extract face region
            face_region = self.extract_face_region(image, landmarks)
            
            # Texture analysis
            texture_metrics = self.model.texture_analyzer.analyze_texture(face_region)
            texture_score = (texture_metrics['entropy'] + texture_metrics['lbp_uniformity']) / 2.0
            
            # Motion analysis (simplified for single frame)
            motion_score = 0.5  # Would need multiple frames for proper motion analysis
            
            # Depth analysis (using gradient information as proxy)
            depth_score = texture_metrics['gradient_magnitude']
            
            # Frequency analysis
            frequency_score = self.analyze_frequency_domain(face_region)
            
            # Consistency analysis
            consistency_score = self.analyze_consistency(face_region)
            
            # Overall anti-spoofing score
            overall_score = (
                texture_score * 0.3 +
                motion_score * 0.2 +
                depth_score * 0.2 +
                frequency_score * 0.15 +
                consistency_score * 0.15
            )
            
            return AntiSpoofingMetrics(
                texture_score=texture_score,
                motion_score=motion_score,
                depth_score=depth_score,
                frequency_score=frequency_score,
                consistency_score=consistency_score,
                overall_score=overall_score
            )
            
        except Exception as e:
            logger.error(f"Error in anti-spoofing analysis: {e}")
            return AntiSpoofingMetrics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
            
    def analyze_frequency_domain(self, image: np.ndarray) -> float:
        """Analyze frequency domain characteristics"""
        try:
            # Convert to grayscale
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
                
            # Apply FFT
            f_transform = np.fft.fft2(gray)
            f_shift = np.fft.fftshift(f_transform)
            magnitude_spectrum = np.log(np.abs(f_shift) + 1)
            
            # Analyze high frequency content
            # Real faces typically have more high frequency content
            center_y, center_x = magnitude_spectrum.shape[0] // 2, magnitude_spectrum.shape[1] // 2
            
            # Create high frequency mask
            y, x = np.ogrid[:magnitude_spectrum.shape[0], :magnitude_spectrum.shape[1]]
            mask = (x - center_x)**2 + (y - center_y)**2 > (min(magnitude_spectrum.shape) // 4)**2
            
            high_freq_energy = np.mean(magnitude_spectrum[mask])
            total_energy = np.mean(magnitude_spectrum)
            
            frequency_score = high_freq_energy / (total_energy + 1e-10)
            
            return min(max(frequency_score, 0.0), 1.0)
            
        except Exception as e:
            logger.error(f"Error analyzing frequency domain: {e}")
            return 0.0
            
    def analyze_consistency(self, image: np.ndarray) -> float:
        """Analyze image consistency for spoofing detection"""
        try:
            # Convert to grayscale
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
                
            # Divide image into regions and analyze consistency
            h, w = gray.shape
            regions = [
                gray[:h//2, :w//2],      # Top-left
                gray[:h//2, w//2:],      # Top-right
                gray[h//2:, :w//2],      # Bottom-left
                gray[h//2:, w//2:]       # Bottom-right
            ]
            
            # Calculate statistics for each region
            region_stats = []
            for region in regions:
                stats = {
                    'mean': np.mean(region),
                    'std': np.std(region),
                    'entropy': self.calculate_entropy(region)
                }
                region_stats.append(stats)
                
            # Calculate consistency across regions
            means = [stats['mean'] for stats in region_stats]
            stds = [stats['std'] for stats in region_stats]
            entropies = [stats['entropy'] for stats in region_stats]
            
            # Lower variance indicates more consistency (potentially artificial)
            mean_consistency = 1.0 / (1.0 + np.var(means) / 255.0)
            std_consistency = 1.0 / (1.0 + np.var(stds) / 255.0)
            entropy_consistency = 1.0 / (1.0 + np.var(entropies))
            
            # Real faces should have some inconsistency
            consistency_score = 1.0 - (mean_consistency + std_consistency + entropy_consistency) / 3.0
            
            return min(max(consistency_score, 0.0), 1.0)
            
        except Exception as e:
            logger.error(f"Error analyzing consistency: {e}")
            return 0.0
            
    def calculate_entropy(self, image: np.ndarray) -> float:
        """Calculate image entropy"""
        try:
            hist, _ = np.histogram(image, bins=256, range=(0, 256))
            hist = hist / np.sum(hist)
            entropy = -np.sum(hist * np.log2(hist + 1e-10))
            return entropy / 8.0  # Normalize to 0-1
        except Exception as e:
            logger.error(f"Error calculating entropy: {e}")
            return 0.0
            
    def detect_spoofing_type(self, metrics: AntiSpoofingMetrics) -> Optional[SpoofingType]:
        """Detect type of spoofing attack based on metrics"""
        try:
            # Simple heuristic-based spoofing type detection
            if metrics.texture_score < 0.3:
                if metrics.frequency_score < 0.2:
                    return SpoofingType.PRINT_ATTACK
                else:
                    return SpoofingType.SCREEN_ATTACK
            elif metrics.motion_score < 0.2:
                return SpoofingType.PHOTO_ATTACK
            elif metrics.consistency_score > 0.8:
                return SpoofingType.VIDEO_REPLAY
            elif metrics.depth_score < 0.3:
                return SpoofingType.MASK_ATTACK
            else:
                return None
                
        except Exception as e:
            logger.error(f"Error detecting spoofing type: {e}")
            return None
            
    def extract_face_region(self, image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        """Extract face region from image using landmarks"""
        try:
            # Convert normalized landmarks to pixel coordinates
            h, w = image.shape[:2]
            pixel_landmarks = landmarks.copy()
            pixel_landmarks[:, 0] *= w
            pixel_landmarks[:, 1] *= h
            
            # Find bounding box
            x_min = int(np.min(pixel_landmarks[:, 0]))
            x_max = int(np.max(pixel_landmarks[:, 0]))
            y_min = int(np.min(pixel_landmarks[:, 1]))
            y_max = int(np.max(pixel_landmarks[:, 1]))
            
            # Add padding
            padding = 20
            x_min = max(0, x_min - padding)
            x_max = min(w, x_max + padding)
            y_min = max(0, y_min - padding)
            y_max = min(h, y_max + padding)
            
            # Extract face region
            face_region = image[y_min:y_max, x_min:x_max]
            
            return face_region
            
        except Exception as e:
            logger.error(f"Error extracting face region: {e}")
            return image
            
    def calculate_image_quality(self, image: np.ndarray) -> Dict[str, float]:
        """Calculate image quality metrics"""
        try:
            # Convert to grayscale if needed
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
                
            # Sharpness (Laplacian variance)
            laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
            sharpness = min(laplacian_var / 1000.0, 1.0)
            
            # Brightness
            brightness = np.mean(gray) / 255.0
            
            # Contrast
            contrast = np.std(gray) / 255.0
            
            # Naturalness (based on histogram distribution)
            hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
            hist_norm = hist / np.sum(hist)
            naturalness = 1.0 - np.sum(hist_norm * np.log(hist_norm + 1e-10)) / 8.0
            
            return {
                'sharpness': float(sharpness),
                'brightness': float(brightness),
                'contrast': float(contrast),
                'naturalness': float(naturalness)
            }
            
        except Exception as e:
            logger.error(f"Error calculating image quality: {e}")
            return {
                'sharpness': 0.0,
                'brightness': 0.0,
                'contrast': 0.0,
                'naturalness': 0.0
            }
            
    def store_liveness_result(self, session_id: str, request_id: Optional[str], 
                            result: LivenessResult):
        """Store liveness detection result"""
        if not self.db_pool:
            return
            
        try:
            conn = self.db_pool.getconn()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO liveness_detection_logs 
                (session_id, request_id, method, is_live, confidence, spoofing_probability,
                 spoofing_type, challenge_results, quality_metrics, processing_time_ms, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                session_id, request_id, result.method.value, result.is_live,
                result.confidence, result.spoofing_probability,
                result.spoofing_type.value if result.spoofing_type else None,
                json.dumps(result.challenge_results), json.dumps(result.quality_metrics),
                result.processing_time, json.dumps(result.metadata)
            ))
            
            conn.commit()
            cursor.close()
            self.db_pool.putconn(conn)
            
        except Exception as e:
            logger.error(f"Error storing liveness result: {e}")
            
    # Additional handler methods would be implemented here...
    # (create_challenge_handler, respond_challenge_handler, etc.)
    
    def create_challenge_handler(self):
        """Handle challenge creation requests"""
        # Implementation for creating liveness challenges
        return jsonify({'message': 'Challenge creation endpoint - implementation in progress'})
        
    def respond_challenge_handler(self, challenge_id):
        """Handle challenge response"""
        # Implementation for processing challenge responses
        return jsonify({'message': 'Challenge response endpoint - implementation in progress'})
        
    def challenge_status_handler(self, challenge_id):
        """Handle challenge status requests"""
        # Implementation for checking challenge status
        return jsonify({'message': 'Challenge status endpoint - implementation in progress'})
        
    def antispoofing_analysis_handler(self):
        """Handle anti-spoofing analysis requests"""
        # Implementation for standalone anti-spoofing analysis
        return jsonify({'message': 'Anti-spoofing analysis endpoint - implementation in progress'})
        
    def session_results_handler(self, session_id):
        """Handle session results requests"""
        # Implementation for retrieving session results
        return jsonify({'message': 'Session results endpoint - implementation in progress'})
        
    def batch_detect_handler(self):
        """Handle batch detection requests"""
        # Implementation for batch liveness detection
        return jsonify({'message': 'Batch detection endpoint - implementation in progress'})
        
    def get_stats_handler(self):
        """Handle statistics requests"""
        try:
            stats = {
                'timestamp': datetime.now().isoformat(),
                'service': 'liveness-detection',
                'version': '1.0.0',
                'active_challenges': len(self.active_challenges),
                'models_loaded': {
                    'face_mesh': self.model.face_mesh is not None,
                    'face_detector': self.model.face_detector is not None,
                    'anti_spoofing_model': self.model.anti_spoofing_model is not None
                }
            }
            
            return jsonify(stats)
            
        except Exception as e:
            logger.error(f"Error getting service statistics: {e}")
            return jsonify({'error': str(e)}), 500
            
    def run(self, host='0.0.0.0', port=8085, debug=False):
        """Run the service"""
        logger.info(f"Starting Liveness Detection Service on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)

if __name__ == '__main__':
    service = LivenessDetectionService()
    
    port = int(os.getenv('PORT', 8085))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    service.run(port=port, debug=debug)

