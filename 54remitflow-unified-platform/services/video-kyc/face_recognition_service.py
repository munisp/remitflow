#!/usr/bin/env python3
"""
Face Recognition Service for Video KYC
Advanced face recognition using deep learning models
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
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from concurrent.futures import ThreadPoolExecutor
import threading

import numpy as np
import cv2
import face_recognition
import dlib
from PIL import Image
import torch
import torch.nn as nn
import torchvision.transforms as transforms
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import PCA
import redis
import psycopg2
from psycopg2.extras import RealDictCursor
import aioredis
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

@dataclass
class FaceEncoding:
    """Face encoding data structure"""
    encoding: List[float]
    landmarks: List[Dict[str, float]]
    quality_score: float
    confidence: float
    method: str
    timestamp: datetime

@dataclass
class FaceRecognitionResult:
    """Face recognition result data structure"""
    match: bool
    similarity: float
    distance: float
    confidence: float
    threshold: float
    processing_time: float
    method: str
    metadata: Dict[str, Any]

@dataclass
class BiometricTemplate:
    """Biometric template for face recognition"""
    id: str
    person_id: str
    encodings: List[FaceEncoding]
    created_at: datetime
    updated_at: datetime
    active: bool

class FaceRecognitionModel:
    """Advanced face recognition model wrapper"""
    
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.face_detector = None
        self.landmark_predictor = None
        self.face_encoder = None
        self.pca_model = None
        self.load_models()
        
    def load_models(self):
        """Load face recognition models"""
        try:
            # Load dlib face detector
            self.face_detector = dlib.get_frontal_face_detector()
            
            # Load landmark predictor
            predictor_path = "models/shape_predictor_68_face_landmarks.dat"
            if os.path.exists(predictor_path):
                self.landmark_predictor = dlib.shape_predictor(predictor_path)
            else:
                logger.warning(f"Landmark predictor not found at {predictor_path}")
                
            # Load face encoder
            encoder_path = "models/dlib_face_recognition_resnet_model_v1.dat"
            if os.path.exists(encoder_path):
                self.face_encoder = dlib.face_recognition_model_v1(encoder_path)
            else:
                logger.warning(f"Face encoder not found at {encoder_path}")
                
            # Initialize PCA for dimensionality reduction
            self.pca_model = PCA(n_components=128)
            
            logger.info("Face recognition models loaded successfully")
            
        except Exception as e:
            logger.error(f"Error loading face recognition models: {e}")
            
    def detect_faces(self, image: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """Detect faces in image"""
        try:
            # Convert to grayscale
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            
            # Detect faces
            faces = self.face_detector(gray)
            
            # Convert to (x, y, w, h) format
            face_locations = []
            for face in faces:
                x, y, w, h = face.left(), face.top(), face.width(), face.height()
                face_locations.append((x, y, w, h))
                
            return face_locations
            
        except Exception as e:
            logger.error(f"Error detecting faces: {e}")
            return []
            
    def extract_landmarks(self, image: np.ndarray, face_location: Tuple[int, int, int, int]) -> List[Dict[str, float]]:
        """Extract facial landmarks"""
        try:
            if not self.landmark_predictor:
                return []
                
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            x, y, w, h = face_location
            
            # Create dlib rectangle
            rect = dlib.rectangle(x, y, x + w, y + h)
            
            # Get landmarks
            landmarks = self.landmark_predictor(gray, rect)
            
            # Convert to list of dictionaries
            landmark_points = []
            for i in range(landmarks.num_parts):
                point = landmarks.part(i)
                landmark_points.append({
                    'x': float(point.x),
                    'y': float(point.y),
                    'index': i
                })
                
            return landmark_points
            
        except Exception as e:
            logger.error(f"Error extracting landmarks: {e}")
            return []
            
    def generate_encoding(self, image: np.ndarray, face_location: Tuple[int, int, int, int]) -> Optional[List[float]]:
        """Generate face encoding"""
        try:
            # Method 1: Use dlib face encoder
            if self.face_encoder and self.landmark_predictor:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                x, y, w, h = face_location
                rect = dlib.rectangle(x, y, x + w, y + h)
                
                landmarks = self.landmark_predictor(gray, rect)
                encoding = self.face_encoder.compute_face_descriptor(gray, landmarks)
                return list(encoding)
                
            # Method 2: Use face_recognition library as fallback
            else:
                # Convert face location to face_recognition format
                top, right, bottom, left = y, x + w, y + h, x
                face_locations = [(top, right, bottom, left)]
                
                encodings = face_recognition.face_encodings(image, face_locations)
                if encodings:
                    return encodings[0].tolist()
                    
            return None
            
        except Exception as e:
            logger.error(f"Error generating face encoding: {e}")
            return None
            
    def calculate_quality_score(self, image: np.ndarray, face_location: Tuple[int, int, int, int]) -> float:
        """Calculate face quality score"""
        try:
            x, y, w, h = face_location
            face_roi = image[y:y+h, x:x+w]
            
            # Convert to grayscale
            gray_face = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
            
            # Calculate sharpness using Laplacian variance
            laplacian_var = cv2.Laplacian(gray_face, cv2.CV_64F).var()
            sharpness_score = min(laplacian_var / 1000.0, 1.0)
            
            # Calculate brightness
            brightness = np.mean(gray_face) / 255.0
            brightness_score = 1.0 - abs(brightness - 0.5) * 2
            
            # Calculate contrast
            contrast = np.std(gray_face) / 255.0
            
            # Calculate size score (larger faces are generally better)
            image_area = image.shape[0] * image.shape[1]
            face_area = w * h
            size_score = min(face_area / (image_area * 0.1), 1.0)
            
            # Combined quality score
            quality_score = (sharpness_score * 0.4 + brightness_score * 0.3 + 
                           contrast * 0.2 + size_score * 0.1)
            
            return min(max(quality_score, 0.0), 1.0)
            
        except Exception as e:
            logger.error(f"Error calculating quality score: {e}")
            return 0.0

class FaceRecognitionService:
    """Main face recognition service"""
    
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Initialize components
        self.model = FaceRecognitionModel()
        self.redis_client = None
        self.db_pool = None
        self.executor = ThreadPoolExecutor(max_workers=4)
        
        # Metrics
        self.setup_metrics()
        
        # Initialize connections
        self.setup_database()
        self.setup_redis()
        self.setup_routes()
        
        logger.info("Face Recognition Service initialized")
        
    def setup_metrics(self):
        """Setup Prometheus metrics"""
        self.recognition_requests = Counter(
            'face_recognition_requests_total',
            'Total face recognition requests',
            ['method', 'status']
        )
        
        self.recognition_duration = Histogram(
            'face_recognition_duration_seconds',
            'Face recognition processing duration',
            ['method']
        )
        
        self.recognition_accuracy = Gauge(
            'face_recognition_accuracy',
            'Face recognition accuracy percentage'
        )
        
        self.active_templates = Gauge(
            'face_recognition_active_templates',
            'Number of active biometric templates'
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
            
            # Biometric templates table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS biometric_templates (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    person_id VARCHAR(255) NOT NULL,
                    encoding_data JSONB NOT NULL,
                    quality_score DECIMAL(5,4),
                    confidence DECIMAL(5,4),
                    method VARCHAR(50),
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_biometric_templates_person_id 
                ON biometric_templates(person_id);
                
                CREATE INDEX IF NOT EXISTS idx_biometric_templates_active 
                ON biometric_templates(active);
            """)
            
            # Face recognition logs table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS face_recognition_logs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    request_id VARCHAR(255),
                    person_id VARCHAR(255),
                    template_id UUID,
                    match_result BOOLEAN,
                    similarity DECIMAL(5,4),
                    confidence DECIMAL(5,4),
                    processing_time_ms INTEGER,
                    method VARCHAR(50),
                    metadata JSONB,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_face_recognition_logs_request_id 
                ON face_recognition_logs(request_id);
                
                CREATE INDEX IF NOT EXISTS idx_face_recognition_logs_person_id 
                ON face_recognition_logs(person_id);
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
                'service': 'face-recognition',
                'version': '1.0.0'
            })
            
        @self.app.route('/metrics', methods=['GET'])
        def metrics():
            return generate_latest()
            
        @self.app.route('/encode', methods=['POST'])
        def encode_face():
            return self.encode_face_handler()
            
        @self.app.route('/recognize', methods=['POST'])
        def recognize_face():
            return self.recognize_face_handler()
            
        @self.app.route('/compare', methods=['POST'])
        def compare_faces():
            return self.compare_faces_handler()
            
        @self.app.route('/template', methods=['POST'])
        def create_template():
            return self.create_template_handler()
            
        @self.app.route('/template/<person_id>', methods=['GET'])
        def get_template(person_id):
            return self.get_template_handler(person_id)
            
        @self.app.route('/template/<person_id>', methods=['DELETE'])
        def delete_template(person_id):
            return self.delete_template_handler(person_id)
            
        @self.app.route('/verify', methods=['POST'])
        def verify_identity():
            return self.verify_identity_handler()
            
        @self.app.route('/batch/encode', methods=['POST'])
        def batch_encode():
            return self.batch_encode_handler()
            
        @self.app.route('/stats', methods=['GET'])
        def get_stats():
            return self.get_stats_handler()
            
    def encode_face_handler(self):
        """Handle face encoding requests"""
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
                
            # Detect faces
            face_locations = self.model.detect_faces(image)
            
            if not face_locations:
                return jsonify({'error': 'No faces detected'}), 400
                
            # Process first face (or specified face)
            face_index = data.get('face_index', 0)
            if face_index >= len(face_locations):
                face_index = 0
                
            face_location = face_locations[face_index]
            
            # Generate encoding
            encoding = self.model.generate_encoding(image, face_location)
            if not encoding:
                return jsonify({'error': 'Failed to generate face encoding'}), 500
                
            # Extract landmarks
            landmarks = self.model.extract_landmarks(image, face_location)
            
            # Calculate quality score
            quality_score = self.model.calculate_quality_score(image, face_location)
            
            processing_time = (time.time() - start_time) * 1000
            
            result = {
                'success': True,
                'encoding': encoding,
                'landmarks': landmarks,
                'quality_score': quality_score,
                'confidence': 0.95,  # Default confidence for successful encoding
                'face_location': face_location,
                'processing_time_ms': processing_time,
                'method': 'dlib_resnet',
                'timestamp': datetime.now().isoformat()
            }
            
            # Update metrics
            self.recognition_requests.labels(method='encode', status='success').inc()
            self.recognition_duration.labels(method='encode').observe(processing_time / 1000.0)
            
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error in encode_face_handler: {e}")
            self.recognition_requests.labels(method='encode', status='error').inc()
            return jsonify({'error': str(e)}), 500
            
    def recognize_face_handler(self):
        """Handle face recognition requests"""
        try:
            data = request.get_json()
            
            required_fields = ['image_data', 'person_id']
            for field in required_fields:
                if field not in data:
                    return jsonify({'error': f'Missing {field}'}), 400
                    
            start_time = time.time()
            
            # Get person's biometric template
            template = self.get_biometric_template(data['person_id'])
            if not template:
                return jsonify({'error': 'No biometric template found for person'}), 404
                
            # Encode face from image
            encode_result = self.encode_face_from_data(data['image_data'])
            if not encode_result['success']:
                return jsonify(encode_result), 400
                
            # Compare with template
            comparison_result = self.compare_with_template(
                encode_result['encoding'], 
                template,
                data.get('threshold', 0.6)
            )
            
            processing_time = (time.time() - start_time) * 1000
            
            result = {
                'success': True,
                'person_id': data['person_id'],
                'match': comparison_result['match'],
                'similarity': comparison_result['similarity'],
                'confidence': comparison_result['confidence'],
                'threshold': comparison_result['threshold'],
                'processing_time_ms': processing_time,
                'method': 'template_matching',
                'timestamp': datetime.now().isoformat()
            }
            
            # Log recognition attempt
            self.log_recognition_attempt(data['person_id'], template.id, result)
            
            # Update metrics
            status = 'success' if comparison_result['match'] else 'no_match'
            self.recognition_requests.labels(method='recognize', status=status).inc()
            self.recognition_duration.labels(method='recognize').observe(processing_time / 1000.0)
            
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error in recognize_face_handler: {e}")
            self.recognition_requests.labels(method='recognize', status='error').inc()
            return jsonify({'error': str(e)}), 500
            
    def compare_faces_handler(self):
        """Handle face comparison requests"""
        try:
            data = request.get_json()
            
            if 'encoding1' in data and 'encoding2' in data:
                # Direct encoding comparison
                similarity = self.calculate_similarity(data['encoding1'], data['encoding2'])
                threshold = data.get('threshold', 0.6)
                
                result = {
                    'success': True,
                    'match': similarity >= threshold,
                    'similarity': similarity,
                    'distance': 1.0 - similarity,
                    'threshold': threshold,
                    'method': 'encoding_comparison'
                }
                
            elif 'image_data1' in data and 'image_data2' in data:
                # Image-to-image comparison
                result = self.compare_images(data['image_data1'], data['image_data2'], data.get('threshold', 0.6))
                
            else:
                return jsonify({'error': 'Invalid comparison data'}), 400
                
            self.recognition_requests.labels(method='compare', status='success').inc()
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error in compare_faces_handler: {e}")
            self.recognition_requests.labels(method='compare', status='error').inc()
            return jsonify({'error': str(e)}), 500
            
    def create_template_handler(self):
        """Handle biometric template creation"""
        try:
            data = request.get_json()
            
            required_fields = ['person_id', 'image_data']
            for field in required_fields:
                if field not in data:
                    return jsonify({'error': f'Missing {field}'}), 400
                    
            # Encode face
            encode_result = self.encode_face_from_data(data['image_data'])
            if not encode_result['success']:
                return jsonify(encode_result), 400
                
            # Create biometric template
            template_id = self.store_biometric_template(
                data['person_id'],
                encode_result['encoding'],
                encode_result['landmarks'],
                encode_result['quality_score'],
                encode_result['confidence']
            )
            
            result = {
                'success': True,
                'template_id': template_id,
                'person_id': data['person_id'],
                'quality_score': encode_result['quality_score'],
                'confidence': encode_result['confidence']
            }
            
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error in create_template_handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_template_handler(self, person_id):
        """Handle biometric template retrieval"""
        try:
            template = self.get_biometric_template(person_id)
            if not template:
                return jsonify({'error': 'Template not found'}), 404
                
            result = {
                'success': True,
                'template_id': template.id,
                'person_id': template.person_id,
                'created_at': template.created_at.isoformat(),
                'updated_at': template.updated_at.isoformat(),
                'active': template.active,
                'encoding_count': len(template.encodings)
            }
            
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error in get_template_handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def delete_template_handler(self, person_id):
        """Handle biometric template deletion"""
        try:
            success = self.delete_biometric_template(person_id)
            if not success:
                return jsonify({'error': 'Template not found'}), 404
                
            return jsonify({'success': True, 'message': 'Template deleted'})
            
        except Exception as e:
            logger.error(f"Error in delete_template_handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def verify_identity_handler(self):
        """Handle identity verification requests"""
        try:
            data = request.get_json()
            
            required_fields = ['person_id', 'image_data']
            for field in required_fields:
                if field not in data:
                    return jsonify({'error': f'Missing {field}'}), 400
                    
            # Perform recognition
            recognition_result = self.recognize_face_from_data(data)
            
            # Additional verification checks
            verification_score = self.calculate_verification_score(recognition_result)
            
            result = {
                'success': True,
                'person_id': data['person_id'],
                'verified': recognition_result['match'] and verification_score > 0.8,
                'recognition_result': recognition_result,
                'verification_score': verification_score,
                'timestamp': datetime.now().isoformat()
            }
            
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error in verify_identity_handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def batch_encode_handler(self):
        """Handle batch encoding requests"""
        try:
            data = request.get_json()
            
            if 'images' not in data:
                return jsonify({'error': 'Missing images array'}), 400
                
            results = []
            for i, image_data in enumerate(data['images']):
                try:
                    encode_result = self.encode_face_from_data(image_data)
                    encode_result['index'] = i
                    results.append(encode_result)
                except Exception as e:
                    results.append({
                        'success': False,
                        'index': i,
                        'error': str(e)
                    })
                    
            return jsonify({
                'success': True,
                'results': results,
                'total_processed': len(results)
            })
            
        except Exception as e:
            logger.error(f"Error in batch_encode_handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_stats_handler(self):
        """Handle statistics requests"""
        try:
            stats = self.get_service_statistics()
            return jsonify(stats)
            
        except Exception as e:
            logger.error(f"Error in get_stats_handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def encode_face_from_data(self, image_data: str) -> Dict[str, Any]:
        """Encode face from base64 image data"""
        try:
            # Decode image
            image_bytes = base64.b64decode(image_data)
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return {'success': False, 'error': 'Invalid image data'}
                
            # Detect faces
            face_locations = self.model.detect_faces(image)
            
            if not face_locations:
                return {'success': False, 'error': 'No faces detected'}
                
            face_location = face_locations[0]  # Use first face
            
            # Generate encoding
            encoding = self.model.generate_encoding(image, face_location)
            if not encoding:
                return {'success': False, 'error': 'Failed to generate encoding'}
                
            # Extract landmarks
            landmarks = self.model.extract_landmarks(image, face_location)
            
            # Calculate quality
            quality_score = self.model.calculate_quality_score(image, face_location)
            
            return {
                'success': True,
                'encoding': encoding,
                'landmarks': landmarks,
                'quality_score': quality_score,
                'confidence': 0.95,
                'face_location': face_location
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
            
    def calculate_similarity(self, encoding1: List[float], encoding2: List[float]) -> float:
        """Calculate similarity between two face encodings"""
        try:
            # Convert to numpy arrays
            enc1 = np.array(encoding1).reshape(1, -1)
            enc2 = np.array(encoding2).reshape(1, -1)
            
            # Calculate cosine similarity
            similarity = cosine_similarity(enc1, enc2)[0][0]
            
            return float(similarity)
            
        except Exception as e:
            logger.error(f"Error calculating similarity: {e}")
            return 0.0
            
    def compare_images(self, image_data1: str, image_data2: str, threshold: float) -> Dict[str, Any]:
        """Compare two images"""
        try:
            # Encode both images
            result1 = self.encode_face_from_data(image_data1)
            result2 = self.encode_face_from_data(image_data2)
            
            if not result1['success']:
                return {'success': False, 'error': f"Image 1: {result1['error']}"}
                
            if not result2['success']:
                return {'success': False, 'error': f"Image 2: {result2['error']}"}
                
            # Calculate similarity
            similarity = self.calculate_similarity(result1['encoding'], result2['encoding'])
            
            return {
                'success': True,
                'match': similarity >= threshold,
                'similarity': similarity,
                'distance': 1.0 - similarity,
                'threshold': threshold,
                'quality_score1': result1['quality_score'],
                'quality_score2': result2['quality_score'],
                'method': 'image_comparison'
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
            
    def store_biometric_template(self, person_id: str, encoding: List[float], 
                               landmarks: List[Dict], quality_score: float, 
                               confidence: float) -> str:
        """Store biometric template in database"""
        if not self.db_pool:
            raise Exception("Database not available")
            
        try:
            conn = self.db_pool.getconn()
            cursor = conn.cursor()
            
            # Deactivate existing templates for this person
            cursor.execute(
                "UPDATE biometric_templates SET active = FALSE WHERE person_id = %s",
                (person_id,)
            )
            
            # Create new template
            template_data = {
                'encoding': encoding,
                'landmarks': landmarks,
                'quality_score': quality_score,
                'confidence': confidence
            }
            
            cursor.execute("""
                INSERT INTO biometric_templates 
                (person_id, encoding_data, quality_score, confidence, method, active)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (person_id, json.dumps(template_data), quality_score, confidence, 'dlib_resnet', True))
            
            template_id = cursor.fetchone()[0]
            
            conn.commit()
            cursor.close()
            self.db_pool.putconn(conn)
            
            return str(template_id)
            
        except Exception as e:
            logger.error(f"Error storing biometric template: {e}")
            raise
            
    def get_biometric_template(self, person_id: str) -> Optional[BiometricTemplate]:
        """Get biometric template from database"""
        if not self.db_pool:
            return None
            
        try:
            conn = self.db_pool.getconn()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            cursor.execute("""
                SELECT id, person_id, encoding_data, quality_score, confidence, 
                       method, active, created_at, updated_at
                FROM biometric_templates
                WHERE person_id = %s AND active = TRUE
                ORDER BY created_at DESC
                LIMIT 1
            """, (person_id,))
            
            row = cursor.fetchone()
            cursor.close()
            self.db_pool.putconn(conn)
            
            if not row:
                return None
                
            # Parse encoding data
            encoding_data = json.loads(row['encoding_data'])
            
            face_encoding = FaceEncoding(
                encoding=encoding_data['encoding'],
                landmarks=encoding_data['landmarks'],
                quality_score=encoding_data['quality_score'],
                confidence=encoding_data['confidence'],
                method='dlib_resnet',
                timestamp=row['created_at']
            )
            
            return BiometricTemplate(
                id=str(row['id']),
                person_id=row['person_id'],
                encodings=[face_encoding],
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                active=row['active']
            )
            
        except Exception as e:
            logger.error(f"Error getting biometric template: {e}")
            return None
            
    def delete_biometric_template(self, person_id: str) -> bool:
        """Delete biometric template"""
        if not self.db_pool:
            return False
            
        try:
            conn = self.db_pool.getconn()
            cursor = conn.cursor()
            
            cursor.execute(
                "UPDATE biometric_templates SET active = FALSE WHERE person_id = %s",
                (person_id,)
            )
            
            affected_rows = cursor.rowcount
            conn.commit()
            cursor.close()
            self.db_pool.putconn(conn)
            
            return affected_rows > 0
            
        except Exception as e:
            logger.error(f"Error deleting biometric template: {e}")
            return False
            
    def compare_with_template(self, encoding: List[float], template: BiometricTemplate, 
                            threshold: float) -> Dict[str, Any]:
        """Compare encoding with biometric template"""
        try:
            best_similarity = 0.0
            
            for template_encoding in template.encodings:
                similarity = self.calculate_similarity(encoding, template_encoding.encoding)
                best_similarity = max(best_similarity, similarity)
                
            return {
                'match': best_similarity >= threshold,
                'similarity': best_similarity,
                'distance': 1.0 - best_similarity,
                'confidence': best_similarity,
                'threshold': threshold
            }
            
        except Exception as e:
            logger.error(f"Error comparing with template: {e}")
            return {
                'match': False,
                'similarity': 0.0,
                'distance': 1.0,
                'confidence': 0.0,
                'threshold': threshold
            }
            
    def log_recognition_attempt(self, person_id: str, template_id: str, result: Dict[str, Any]):
        """Log recognition attempt"""
        if not self.db_pool:
            return
            
        try:
            conn = self.db_pool.getconn()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO face_recognition_logs 
                (person_id, template_id, match_result, similarity, confidence, 
                 processing_time_ms, method, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                person_id, template_id, result['match'], result['similarity'],
                result['confidence'], result['processing_time_ms'], result['method'],
                json.dumps(result)
            ))
            
            conn.commit()
            cursor.close()
            self.db_pool.putconn(conn)
            
        except Exception as e:
            logger.error(f"Error logging recognition attempt: {e}")
            
    def calculate_verification_score(self, recognition_result: Dict[str, Any]) -> float:
        """Calculate overall verification score"""
        try:
            base_score = recognition_result.get('similarity', 0.0)
            confidence = recognition_result.get('confidence', 0.0)
            
            # Additional factors could include:
            # - Image quality
            # - Liveness detection results
            # - Historical verification patterns
            
            verification_score = (base_score * 0.7 + confidence * 0.3)
            
            return min(max(verification_score, 0.0), 1.0)
            
        except Exception as e:
            logger.error(f"Error calculating verification score: {e}")
            return 0.0
            
    def get_service_statistics(self) -> Dict[str, Any]:
        """Get service statistics"""
        try:
            stats = {
                'timestamp': datetime.now().isoformat(),
                'service': 'face-recognition',
                'version': '1.0.0',
                'uptime': time.time(),  # Would need to track actual uptime
                'models_loaded': {
                    'face_detector': self.model.face_detector is not None,
                    'landmark_predictor': self.model.landmark_predictor is not None,
                    'face_encoder': self.model.face_encoder is not None
                }
            }
            
            if self.db_pool:
                try:
                    conn = self.db_pool.getconn()
                    cursor = conn.cursor()
                    
                    # Count active templates
                    cursor.execute("SELECT COUNT(*) FROM biometric_templates WHERE active = TRUE")
                    stats['active_templates'] = cursor.fetchone()[0]
                    
                    # Count recent recognitions
                    cursor.execute("""
                        SELECT COUNT(*) FROM face_recognition_logs 
                        WHERE created_at > NOW() - INTERVAL '24 hours'
                    """)
                    stats['recognitions_24h'] = cursor.fetchone()[0]
                    
                    cursor.close()
                    self.db_pool.putconn(conn)
                    
                except Exception as e:
                    logger.error(f"Error getting database stats: {e}")
                    
            return stats
            
        except Exception as e:
            logger.error(f"Error getting service statistics: {e}")
            return {'error': str(e)}
            
    def run(self, host='0.0.0.0', port=8084, debug=False):
        """Run the service"""
        logger.info(f"Starting Face Recognition Service on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)

if __name__ == '__main__':
    service = FaceRecognitionService()
    
    port = int(os.getenv('PORT', 8084))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    service.run(port=port, debug=debug)

