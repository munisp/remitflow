#!/usr/bin/env python3
"""
Biometric Matching Service for Video KYC
Advanced biometric matching between live face and document photos
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
from PIL import Image, ImageEnhance, ImageFilter
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as transforms
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import PCA
from sklearn.cluster import DBSCAN
import face_recognition
import pytesseract
import easyocr
import redis
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import prometheus_client
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DocumentType(Enum):
    """Supported document types"""
    PASSPORT = "passport"
    NATIONAL_ID = "national_id"
    DRIVERS_LICENSE = "drivers_license"
    VOTER_ID = "voter_id"
    RESIDENCE_PERMIT = "residence_permit"
    MILITARY_ID = "military_id"

class MatchingMethod(Enum):
    """Biometric matching methods"""
    FACE_RECOGNITION = "face_recognition"
    DEEP_LEARNING = "deep_learning"
    HYBRID = "hybrid"
    ENSEMBLE = "ensemble"

class MatchingResult(Enum):
    """Matching result types"""
    MATCH = "match"
    NO_MATCH = "no_match"
    INCONCLUSIVE = "inconclusive"
    ERROR = "error"

@dataclass
class DocumentPhoto:
    """Document photo data structure"""
    id: str
    document_type: DocumentType
    photo_region: Tuple[int, int, int, int]  # x, y, width, height
    face_encoding: List[float]
    face_landmarks: List[Dict[str, float]]
    quality_score: float
    confidence: float
    extracted_at: datetime
    preprocessing_applied: List[str]

@dataclass
class LivePhoto:
    """Live photo data structure"""
    id: str
    session_id: str
    face_encoding: List[float]
    face_landmarks: List[Dict[str, float]]
    quality_score: float
    liveness_score: float
    confidence: float
    captured_at: datetime

@dataclass
class BiometricMatch:
    """Biometric matching result"""
    id: str
    live_photo_id: str
    document_photo_id: str
    method: MatchingMethod
    result: MatchingResult
    similarity_score: float
    confidence: float
    threshold: float
    quality_factors: Dict[str, float]
    processing_time: float
    metadata: Dict[str, Any]
    created_at: datetime

@dataclass
class DocumentAnalysis:
    """Document analysis result"""
    document_type: DocumentType
    photo_detected: bool
    photo_regions: List[Tuple[int, int, int, int]]
    text_regions: List[Dict[str, Any]]
    security_features: Dict[str, bool]
    quality_assessment: Dict[str, float]
    authenticity_score: float

class DocumentPhotoExtractor:
    """Extract photos from identity documents"""
    
    def __init__(self):
        self.face_detector = dlib.get_frontal_face_detector()
        self.landmark_predictor = None
        self.ocr_reader = None
        self.load_models()
        
    def load_models(self):
        """Load document processing models"""
        try:
            # Load landmark predictor
            predictor_path = "models/shape_predictor_68_face_landmarks.dat"
            if os.path.exists(predictor_path):
                self.landmark_predictor = dlib.shape_predictor(predictor_path)
                
            # Initialize OCR reader
            self.ocr_reader = easyocr.Reader(['en'])
            
            logger.info("Document photo extractor models loaded successfully")
            
        except Exception as e:
            logger.error(f"Error loading document extractor models: {e}")
            
    def extract_document_photo(self, document_image: np.ndarray, 
                             document_type: DocumentType) -> Optional[DocumentPhoto]:
        """Extract photo from document"""
        try:
            # Preprocess document image
            processed_image = self.preprocess_document(document_image)
            
            # Detect document layout
            layout = self.detect_document_layout(processed_image, document_type)
            
            # Extract photo region
            photo_region = self.extract_photo_region(processed_image, layout)
            if photo_region is None:
                return None
                
            # Extract face from photo region
            face_data = self.extract_face_from_region(photo_region)
            if face_data is None:
                return None
                
            # Create document photo object
            doc_photo = DocumentPhoto(
                id=str(uuid.uuid4()),
                document_type=document_type,
                photo_region=face_data['region'],
                face_encoding=face_data['encoding'],
                face_landmarks=face_data['landmarks'],
                quality_score=face_data['quality'],
                confidence=face_data['confidence'],
                extracted_at=datetime.now(),
                preprocessing_applied=face_data['preprocessing']
            )
            
            return doc_photo
            
        except Exception as e:
            logger.error(f"Error extracting document photo: {e}")
            return None
            
    def preprocess_document(self, image: np.ndarray) -> np.ndarray:
        """Preprocess document image for better extraction"""
        try:
            # Convert to PIL Image for processing
            pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            
            # Enhance contrast
            enhancer = ImageEnhance.Contrast(pil_image)
            pil_image = enhancer.enhance(1.2)
            
            # Enhance sharpness
            enhancer = ImageEnhance.Sharpness(pil_image)
            pil_image = enhancer.enhance(1.1)
            
            # Apply slight denoising
            pil_image = pil_image.filter(ImageFilter.MedianFilter(size=3))
            
            # Convert back to OpenCV format
            processed = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
            
            return processed
            
        except Exception as e:
            logger.error(f"Error preprocessing document: {e}")
            return image
            
    def detect_document_layout(self, image: np.ndarray, 
                             document_type: DocumentType) -> Dict[str, Any]:
        """Detect document layout and regions"""
        try:
            layout = {
                'photo_regions': [],
                'text_regions': [],
                'security_features': [],
                'orientation': 0
            }
            
            # Convert to grayscale for analysis
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            
            # Detect text regions using OCR
            if self.ocr_reader:
                ocr_results = self.ocr_reader.readtext(image)
                for (bbox, text, confidence) in ocr_results:
                    if confidence > 0.5:
                        # Convert bbox to rectangle
                        x_coords = [point[0] for point in bbox]
                        y_coords = [point[1] for point in bbox]
                        x, y = int(min(x_coords)), int(min(y_coords))
                        w, h = int(max(x_coords) - x), int(max(y_coords) - y)
                        
                        layout['text_regions'].append({
                            'bbox': (x, y, w, h),
                            'text': text,
                            'confidence': confidence
                        })
            
            # Detect potential photo regions using contour analysis
            photo_regions = self.detect_photo_regions(gray)
            layout['photo_regions'] = photo_regions
            
            # Document-specific layout detection
            if document_type == DocumentType.PASSPORT:
                layout.update(self.detect_passport_layout(image))
            elif document_type == DocumentType.NATIONAL_ID:
                layout.update(self.detect_national_id_layout(image))
            elif document_type == DocumentType.DRIVERS_LICENSE:
                layout.update(self.detect_drivers_license_layout(image))
                
            return layout
            
        except Exception as e:
            logger.error(f"Error detecting document layout: {e}")
            return {'photo_regions': [], 'text_regions': [], 'security_features': []}
            
    def detect_photo_regions(self, gray_image: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """Detect potential photo regions in document"""
        try:
            photo_regions = []
            
            # Apply edge detection
            edges = cv2.Canny(gray_image, 50, 150)
            
            # Find contours
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            # Filter contours by size and aspect ratio
            for contour in contours:
                x, y, w, h = cv2.boundingRect(contour)
                area = w * h
                aspect_ratio = w / h if h > 0 else 0
                
                # Photo regions are typically rectangular with specific size constraints
                if (area > 5000 and area < 100000 and  # Size constraints
                    0.6 <= aspect_ratio <= 1.4):       # Aspect ratio constraints
                    photo_regions.append((x, y, w, h))
                    
            # Sort by area (largest first)
            photo_regions.sort(key=lambda r: r[2] * r[3], reverse=True)
            
            return photo_regions[:3]  # Return top 3 candidates
            
        except Exception as e:
            logger.error(f"Error detecting photo regions: {e}")
            return []
            
    def detect_passport_layout(self, image: np.ndarray) -> Dict[str, Any]:
        """Detect passport-specific layout"""
        # Passport photos are typically in the top-right area
        h, w = image.shape[:2]
        
        # Standard passport photo location (approximate)
        photo_x = int(w * 0.6)
        photo_y = int(h * 0.1)
        photo_w = int(w * 0.35)
        photo_h = int(h * 0.45)
        
        return {
            'primary_photo_region': (photo_x, photo_y, photo_w, photo_h),
            'document_type_confidence': 0.8
        }
        
    def detect_national_id_layout(self, image: np.ndarray) -> Dict[str, Any]:
        """Detect national ID-specific layout"""
        # National ID photos can be in various locations
        h, w = image.shape[:2]
        
        # Common locations for national ID photos
        possible_regions = [
            (int(w * 0.05), int(h * 0.1), int(w * 0.3), int(h * 0.4)),  # Left side
            (int(w * 0.65), int(h * 0.1), int(w * 0.3), int(h * 0.4)),  # Right side
        ]
        
        return {
            'possible_photo_regions': possible_regions,
            'document_type_confidence': 0.7
        }
        
    def detect_drivers_license_layout(self, image: np.ndarray) -> Dict[str, Any]:
        """Detect driver's license-specific layout"""
        # Driver's license photos are typically on the left side
        h, w = image.shape[:2]
        
        photo_x = int(w * 0.05)
        photo_y = int(h * 0.15)
        photo_w = int(w * 0.25)
        photo_h = int(h * 0.35)
        
        return {
            'primary_photo_region': (photo_x, photo_y, photo_w, photo_h),
            'document_type_confidence': 0.75
        }
        
    def extract_photo_region(self, image: np.ndarray, 
                           layout: Dict[str, Any]) -> Optional[np.ndarray]:
        """Extract the best photo region from document"""
        try:
            # Try primary photo region first
            if 'primary_photo_region' in layout:
                x, y, w, h = layout['primary_photo_region']
                photo_region = image[y:y+h, x:x+w]
                
                # Validate that this region contains a face
                if self.validate_photo_region(photo_region):
                    return photo_region
                    
            # Try detected photo regions
            for region in layout.get('photo_regions', []):
                x, y, w, h = region
                photo_region = image[y:y+h, x:x+w]
                
                if self.validate_photo_region(photo_region):
                    return photo_region
                    
            # Try possible photo regions
            for region in layout.get('possible_photo_regions', []):
                x, y, w, h = region
                photo_region = image[y:y+h, x:x+w]
                
                if self.validate_photo_region(photo_region):
                    return photo_region
                    
            return None
            
        except Exception as e:
            logger.error(f"Error extracting photo region: {e}")
            return None
            
    def validate_photo_region(self, region: np.ndarray) -> bool:
        """Validate that a region contains a face photo"""
        try:
            if region.size == 0:
                return False
                
            # Convert to grayscale for face detection
            gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
            
            # Detect faces in the region
            faces = self.face_detector(gray)
            
            # Region is valid if it contains at least one face
            return len(faces) > 0
            
        except Exception as e:
            logger.error(f"Error validating photo region: {e}")
            return False
            
    def extract_face_from_region(self, photo_region: np.ndarray) -> Optional[Dict[str, Any]]:
        """Extract face data from photo region"""
        try:
            # Convert to grayscale
            gray = cv2.cvtColor(photo_region, cv2.COLOR_BGR2GRAY)
            
            # Detect faces
            faces = self.face_detector(gray)
            if not faces:
                return None
                
            # Use the largest face
            face = max(faces, key=lambda f: f.width() * f.height())
            
            # Extract face region
            x, y, w, h = face.left(), face.top(), face.width(), face.height()
            face_region = photo_region[y:y+h, x:x+w]
            
            # Generate face encoding
            face_locations = [(y, x+w, y+h, x)]  # face_recognition format
            encodings = face_recognition.face_encodings(photo_region, face_locations)
            
            if not encodings:
                return None
                
            encoding = encodings[0].tolist()
            
            # Extract landmarks
            landmarks = []
            if self.landmark_predictor:
                shape = self.landmark_predictor(gray, face)
                for i in range(shape.num_parts):
                    point = shape.part(i)
                    landmarks.append({
                        'x': float(point.x),
                        'y': float(point.y),
                        'index': i
                    })
                    
            # Calculate quality score
            quality_score = self.calculate_photo_quality(face_region)
            
            return {
                'region': (x, y, w, h),
                'encoding': encoding,
                'landmarks': landmarks,
                'quality': quality_score,
                'confidence': 0.9,  # High confidence for successful extraction
                'preprocessing': ['contrast_enhancement', 'sharpness_enhancement']
            }
            
        except Exception as e:
            logger.error(f"Error extracting face from region: {e}")
            return None
            
    def calculate_photo_quality(self, face_image: np.ndarray) -> float:
        """Calculate quality score for extracted photo"""
        try:
            # Convert to grayscale
            gray = cv2.cvtColor(face_image, cv2.COLOR_BGR2GRAY)
            
            # Calculate sharpness (Laplacian variance)
            laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
            sharpness = min(laplacian_var / 500.0, 1.0)
            
            # Calculate brightness
            brightness = np.mean(gray) / 255.0
            brightness_score = 1.0 - abs(brightness - 0.5) * 2
            
            # Calculate contrast
            contrast = np.std(gray) / 255.0
            
            # Calculate size score
            min_size = 50
            size_score = min(min(face_image.shape[:2]) / min_size, 1.0)
            
            # Combined quality score
            quality = (sharpness * 0.4 + brightness_score * 0.3 + 
                      contrast * 0.2 + size_score * 0.1)
            
            return min(max(quality, 0.0), 1.0)
            
        except Exception as e:
            logger.error(f"Error calculating photo quality: {e}")
            return 0.0

class BiometricMatcher:
    """Advanced biometric matching engine"""
    
    def __init__(self):
        self.face_recognition_threshold = 0.6
        self.deep_learning_threshold = 0.7
        self.ensemble_weights = {
            'face_recognition': 0.4,
            'deep_learning': 0.4,
            'quality_factors': 0.2
        }
        
    def match_biometrics(self, live_photo: LivePhoto, document_photo: DocumentPhoto,
                        method: MatchingMethod = MatchingMethod.HYBRID) -> BiometricMatch:
        """Perform biometric matching between live and document photos"""
        try:
            start_time = time.time()
            
            # Initialize match result
            match = BiometricMatch(
                id=str(uuid.uuid4()),
                live_photo_id=live_photo.id,
                document_photo_id=document_photo.id,
                method=method,
                result=MatchingResult.ERROR,
                similarity_score=0.0,
                confidence=0.0,
                threshold=0.0,
                quality_factors={},
                processing_time=0.0,
                metadata={},
                created_at=datetime.now()
            )
            
            # Perform matching based on method
            if method == MatchingMethod.FACE_RECOGNITION:
                result = self.face_recognition_match(live_photo, document_photo)
            elif method == MatchingMethod.DEEP_LEARNING:
                result = self.deep_learning_match(live_photo, document_photo)
            elif method == MatchingMethod.HYBRID:
                result = self.hybrid_match(live_photo, document_photo)
            elif method == MatchingMethod.ENSEMBLE:
                result = self.ensemble_match(live_photo, document_photo)
            else:
                raise ValueError(f"Unsupported matching method: {method}")
                
            # Update match object with results
            match.similarity_score = result['similarity']
            match.confidence = result['confidence']
            match.threshold = result['threshold']
            match.quality_factors = result['quality_factors']
            match.metadata = result['metadata']
            
            # Determine final result
            if match.similarity_score >= match.threshold:
                match.result = MatchingResult.MATCH
            elif match.confidence < 0.5:
                match.result = MatchingResult.INCONCLUSIVE
            else:
                match.result = MatchingResult.NO_MATCH
                
            match.processing_time = (time.time() - start_time) * 1000
            
            return match
            
        except Exception as e:
            logger.error(f"Error in biometric matching: {e}")
            match.result = MatchingResult.ERROR
            match.metadata['error'] = str(e)
            return match
            
    def face_recognition_match(self, live_photo: LivePhoto, 
                             document_photo: DocumentPhoto) -> Dict[str, Any]:
        """Perform face recognition-based matching"""
        try:
            # Calculate similarity using cosine similarity
            live_encoding = np.array(live_photo.face_encoding).reshape(1, -1)
            doc_encoding = np.array(document_photo.face_encoding).reshape(1, -1)
            
            similarity = cosine_similarity(live_encoding, doc_encoding)[0][0]
            
            # Calculate quality factors
            quality_factors = {
                'live_quality': live_photo.quality_score,
                'document_quality': document_photo.quality_score,
                'liveness_score': live_photo.liveness_score,
                'encoding_distance': 1.0 - similarity
            }
            
            # Adjust confidence based on quality factors
            quality_adjustment = (
                quality_factors['live_quality'] * 0.3 +
                quality_factors['document_quality'] * 0.3 +
                quality_factors['liveness_score'] * 0.4
            )
            
            confidence = similarity * quality_adjustment
            
            return {
                'similarity': float(similarity),
                'confidence': float(confidence),
                'threshold': self.face_recognition_threshold,
                'quality_factors': quality_factors,
                'metadata': {
                    'method': 'face_recognition',
                    'encoding_length': len(live_photo.face_encoding)
                }
            }
            
        except Exception as e:
            logger.error(f"Error in face recognition matching: {e}")
            return {
                'similarity': 0.0,
                'confidence': 0.0,
                'threshold': self.face_recognition_threshold,
                'quality_factors': {},
                'metadata': {'error': str(e)}
            }
            
    def deep_learning_match(self, live_photo: LivePhoto, 
                          document_photo: DocumentPhoto) -> Dict[str, Any]:
        """Perform deep learning-based matching"""
        try:
            # For now, use enhanced face recognition with additional features
            # In production, this would use a trained deep learning model
            
            # Calculate base similarity
            live_encoding = np.array(live_photo.face_encoding)
            doc_encoding = np.array(document_photo.face_encoding)
            
            # Euclidean distance
            euclidean_distance = np.linalg.norm(live_encoding - doc_encoding)
            euclidean_similarity = 1.0 / (1.0 + euclidean_distance)
            
            # Cosine similarity
            cosine_sim = cosine_similarity(
                live_encoding.reshape(1, -1), 
                doc_encoding.reshape(1, -1)
            )[0][0]
            
            # Combine similarities
            combined_similarity = (euclidean_similarity + cosine_sim) / 2.0
            
            # Landmark-based similarity
            landmark_similarity = self.calculate_landmark_similarity(
                live_photo.face_landmarks, 
                document_photo.face_landmarks
            )
            
            # Final similarity with landmark weighting
            final_similarity = (combined_similarity * 0.8 + landmark_similarity * 0.2)
            
            # Quality factors
            quality_factors = {
                'live_quality': live_photo.quality_score,
                'document_quality': document_photo.quality_score,
                'liveness_score': live_photo.liveness_score,
                'landmark_similarity': landmark_similarity,
                'euclidean_distance': euclidean_distance,
                'cosine_similarity': cosine_sim
            }
            
            # Enhanced confidence calculation
            confidence = final_similarity * min(
                quality_factors['live_quality'] + 0.2,
                quality_factors['document_quality'] + 0.2,
                1.0
            )
            
            return {
                'similarity': float(final_similarity),
                'confidence': float(confidence),
                'threshold': self.deep_learning_threshold,
                'quality_factors': quality_factors,
                'metadata': {
                    'method': 'deep_learning',
                    'landmark_count': len(live_photo.face_landmarks)
                }
            }
            
        except Exception as e:
            logger.error(f"Error in deep learning matching: {e}")
            return {
                'similarity': 0.0,
                'confidence': 0.0,
                'threshold': self.deep_learning_threshold,
                'quality_factors': {},
                'metadata': {'error': str(e)}
            }
            
    def hybrid_match(self, live_photo: LivePhoto, 
                    document_photo: DocumentPhoto) -> Dict[str, Any]:
        """Perform hybrid matching combining multiple methods"""
        try:
            # Get results from both methods
            fr_result = self.face_recognition_match(live_photo, document_photo)
            dl_result = self.deep_learning_match(live_photo, document_photo)
            
            # Combine similarities with weights
            combined_similarity = (
                fr_result['similarity'] * 0.5 +
                dl_result['similarity'] * 0.5
            )
            
            # Combine confidences
            combined_confidence = (
                fr_result['confidence'] * 0.5 +
                dl_result['confidence'] * 0.5
            )
            
            # Use average threshold
            combined_threshold = (
                fr_result['threshold'] + dl_result['threshold']
            ) / 2.0
            
            # Merge quality factors
            quality_factors = {**fr_result['quality_factors'], **dl_result['quality_factors']}
            
            return {
                'similarity': float(combined_similarity),
                'confidence': float(combined_confidence),
                'threshold': combined_threshold,
                'quality_factors': quality_factors,
                'metadata': {
                    'method': 'hybrid',
                    'face_recognition_result': fr_result,
                    'deep_learning_result': dl_result
                }
            }
            
        except Exception as e:
            logger.error(f"Error in hybrid matching: {e}")
            return {
                'similarity': 0.0,
                'confidence': 0.0,
                'threshold': 0.65,
                'quality_factors': {},
                'metadata': {'error': str(e)}
            }
            
    def ensemble_match(self, live_photo: LivePhoto, 
                      document_photo: DocumentPhoto) -> Dict[str, Any]:
        """Perform ensemble matching with weighted voting"""
        try:
            # Get results from all methods
            fr_result = self.face_recognition_match(live_photo, document_photo)
            dl_result = self.deep_learning_match(live_photo, document_photo)
            
            # Calculate quality-based weights
            quality_weight = (
                live_photo.quality_score * document_photo.quality_score * 
                live_photo.liveness_score
            )
            
            # Weighted ensemble
            weights = self.ensemble_weights
            ensemble_similarity = (
                fr_result['similarity'] * weights['face_recognition'] +
                dl_result['similarity'] * weights['deep_learning'] +
                quality_weight * weights['quality_factors']
            )
            
            ensemble_confidence = (
                fr_result['confidence'] * weights['face_recognition'] +
                dl_result['confidence'] * weights['deep_learning'] +
                quality_weight * weights['quality_factors']
            )
            
            # Adaptive threshold based on quality
            base_threshold = 0.65
            quality_adjustment = (quality_weight - 0.5) * 0.1
            adaptive_threshold = base_threshold + quality_adjustment
            
            # Merge all quality factors
            quality_factors = {
                **fr_result['quality_factors'],
                **dl_result['quality_factors'],
                'ensemble_quality_weight': quality_weight,
                'adaptive_threshold': adaptive_threshold
            }
            
            return {
                'similarity': float(ensemble_similarity),
                'confidence': float(ensemble_confidence),
                'threshold': adaptive_threshold,
                'quality_factors': quality_factors,
                'metadata': {
                    'method': 'ensemble',
                    'weights': weights,
                    'component_results': {
                        'face_recognition': fr_result,
                        'deep_learning': dl_result
                    }
                }
            }
            
        except Exception as e:
            logger.error(f"Error in ensemble matching: {e}")
            return {
                'similarity': 0.0,
                'confidence': 0.0,
                'threshold': 0.65,
                'quality_factors': {},
                'metadata': {'error': str(e)}
            }
            
    def calculate_landmark_similarity(self, landmarks1: List[Dict[str, float]], 
                                    landmarks2: List[Dict[str, float]]) -> float:
        """Calculate similarity between facial landmarks"""
        try:
            if not landmarks1 or not landmarks2:
                return 0.0
                
            # Convert to numpy arrays
            points1 = np.array([[lm['x'], lm['y']] for lm in landmarks1])
            points2 = np.array([[lm['x'], lm['y']] for lm in landmarks2])
            
            # Ensure same number of landmarks
            min_points = min(len(points1), len(points2))
            points1 = points1[:min_points]
            points2 = points2[:min_points]
            
            # Normalize landmarks to same scale
            points1_norm = self.normalize_landmarks(points1)
            points2_norm = self.normalize_landmarks(points2)
            
            # Calculate Procrustes distance
            distance = np.mean(np.linalg.norm(points1_norm - points2_norm, axis=1))
            
            # Convert distance to similarity (0-1 scale)
            similarity = 1.0 / (1.0 + distance * 10)
            
            return float(similarity)
            
        except Exception as e:
            logger.error(f"Error calculating landmark similarity: {e}")
            return 0.0
            
    def normalize_landmarks(self, landmarks: np.ndarray) -> np.ndarray:
        """Normalize landmarks to unit scale"""
        try:
            # Center landmarks
            centered = landmarks - np.mean(landmarks, axis=0)
            
            # Scale to unit variance
            scale = np.std(centered)
            if scale > 0:
                normalized = centered / scale
            else:
                normalized = centered
                
            return normalized
            
        except Exception as e:
            logger.error(f"Error normalizing landmarks: {e}")
            return landmarks

class BiometricMatchingService:
    """Main biometric matching service"""
    
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Initialize components
        self.photo_extractor = DocumentPhotoExtractor()
        self.matcher = BiometricMatcher()
        self.redis_client = None
        self.db_pool = None
        self.executor = ThreadPoolExecutor(max_workers=4)
        
        # Metrics
        self.setup_metrics()
        
        # Initialize connections
        self.setup_database()
        self.setup_redis()
        self.setup_routes()
        
        logger.info("Biometric Matching Service initialized")
        
    def setup_metrics(self):
        """Setup Prometheus metrics"""
        self.matching_requests = Counter(
            'biometric_matching_requests_total',
            'Total biometric matching requests',
            ['method', 'result']
        )
        
        self.matching_duration = Histogram(
            'biometric_matching_duration_seconds',
            'Biometric matching processing duration',
            ['method']
        )
        
        self.extraction_success = Counter(
            'document_photo_extraction_total',
            'Total document photo extractions',
            ['document_type', 'status']
        )
        
        self.matching_accuracy = Gauge(
            'biometric_matching_accuracy',
            'Biometric matching accuracy percentage'
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
            
            # Document photos table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS document_photos (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    document_type VARCHAR(50),
                    photo_region JSONB,
                    face_encoding JSONB,
                    face_landmarks JSONB,
                    quality_score DECIMAL(5,4),
                    confidence DECIMAL(5,4),
                    preprocessing_applied JSONB,
                    extracted_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS live_photos (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    session_id VARCHAR(255),
                    face_encoding JSONB,
                    face_landmarks JSONB,
                    quality_score DECIMAL(5,4),
                    liveness_score DECIMAL(5,4),
                    confidence DECIMAL(5,4),
                    captured_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS biometric_matches (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    live_photo_id UUID REFERENCES live_photos(id),
                    document_photo_id UUID REFERENCES document_photos(id),
                    method VARCHAR(50),
                    result VARCHAR(20),
                    similarity_score DECIMAL(5,4),
                    confidence DECIMAL(5,4),
                    threshold_used DECIMAL(5,4),
                    quality_factors JSONB,
                    processing_time_ms INTEGER,
                    metadata JSONB,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_biometric_matches_live_photo_id 
                ON biometric_matches(live_photo_id);
                
                CREATE INDEX IF NOT EXISTS idx_biometric_matches_document_photo_id 
                ON biometric_matches(document_photo_id);
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
                'service': 'biometric-matching',
                'version': '1.0.0'
            })
            
        @self.app.route('/metrics', methods=['GET'])
        def metrics():
            return generate_latest()
            
        @self.app.route('/extract/document-photo', methods=['POST'])
        def extract_document_photo():
            return self.extract_document_photo_handler()
            
        @self.app.route('/match/biometric', methods=['POST'])
        def match_biometric():
            return self.match_biometric_handler()
            
        @self.app.route('/match/batch', methods=['POST'])
        def batch_match():
            return self.batch_match_handler()
            
        @self.app.route('/analyze/document', methods=['POST'])
        def analyze_document():
            return self.analyze_document_handler()
            
        @self.app.route('/compare/faces', methods=['POST'])
        def compare_faces():
            return self.compare_faces_handler()
            
        @self.app.route('/match/<match_id>', methods=['GET'])
        def get_match_result(match_id):
            return self.get_match_result_handler(match_id)
            
        @self.app.route('/stats', methods=['GET'])
        def get_stats():
            return self.get_stats_handler()
            
    def extract_document_photo_handler(self):
        """Handle document photo extraction requests"""
        try:
            data = request.get_json()
            
            if not data or 'document_image' not in data:
                return jsonify({'error': 'Missing document_image'}), 400
                
            # Decode image
            image_data = base64.b64decode(data['document_image'])
            nparr = np.frombuffer(image_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return jsonify({'error': 'Invalid image data'}), 400
                
            # Get document type
            doc_type_str = data.get('document_type', 'national_id')
            try:
                document_type = DocumentType(doc_type_str)
            except ValueError:
                return jsonify({'error': f'Unsupported document type: {doc_type_str}'}), 400
                
            # Extract photo
            start_time = time.time()
            document_photo = self.photo_extractor.extract_document_photo(image, document_type)
            processing_time = (time.time() - start_time) * 1000
            
            if document_photo is None:
                self.extraction_success.labels(
                    document_type=doc_type_str, 
                    status='failed'
                ).inc()
                return jsonify({'error': 'No photo found in document'}), 404
                
            # Store in database
            self.store_document_photo(document_photo)
            
            # Update metrics
            self.extraction_success.labels(
                document_type=doc_type_str, 
                status='success'
            ).inc()
            
            result = {
                'success': True,
                'document_photo_id': document_photo.id,
                'document_type': document_photo.document_type.value,
                'quality_score': document_photo.quality_score,
                'confidence': document_photo.confidence,
                'processing_time_ms': processing_time,
                'photo_region': document_photo.photo_region,
                'preprocessing_applied': document_photo.preprocessing_applied
            }
            
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error in extract_document_photo_handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def match_biometric_handler(self):
        """Handle biometric matching requests"""
        try:
            data = request.get_json()
            
            required_fields = ['live_photo_data', 'document_photo_id']
            for field in required_fields:
                if field not in data:
                    return jsonify({'error': f'Missing {field}'}), 400
                    
            # Create live photo object
            live_photo = self.create_live_photo_from_data(data['live_photo_data'])
            if not live_photo:
                return jsonify({'error': 'Failed to process live photo'}), 400
                
            # Get document photo
            document_photo = self.get_document_photo(data['document_photo_id'])
            if not document_photo:
                return jsonify({'error': 'Document photo not found'}), 404
                
            # Get matching method
            method_str = data.get('method', 'hybrid')
            try:
                method = MatchingMethod(method_str)
            except ValueError:
                return jsonify({'error': f'Unsupported matching method: {method_str}'}), 400
                
            # Perform matching
            start_time = time.time()
            match_result = self.matcher.match_biometrics(live_photo, document_photo, method)
            
            # Store results
            self.store_biometric_match(match_result)
            
            # Update metrics
            self.matching_requests.labels(
                method=method_str, 
                result=match_result.result.value
            ).inc()
            self.matching_duration.labels(method=method_str).observe(
                match_result.processing_time / 1000.0
            )
            
            result = asdict(match_result)
            result['live_photo_id'] = live_photo.id
            
            return jsonify(result)
            
        except Exception as e:
            logger.error(f"Error in match_biometric_handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    # Additional handler methods would be implemented here...
    
    def batch_match_handler(self):
        """Handle batch matching requests"""
        return jsonify({'message': 'Batch matching endpoint - implementation in progress'})
        
    def analyze_document_handler(self):
        """Handle document analysis requests"""
        return jsonify({'message': 'Document analysis endpoint - implementation in progress'})
        
    def compare_faces_handler(self):
        """Handle face comparison requests"""
        return jsonify({'message': 'Face comparison endpoint - implementation in progress'})
        
    def get_match_result_handler(self, match_id):
        """Handle match result retrieval"""
        return jsonify({'message': 'Get match result endpoint - implementation in progress'})
        
    def get_stats_handler(self):
        """Handle statistics requests"""
        try:
            stats = {
                'timestamp': datetime.now().isoformat(),
                'service': 'biometric-matching',
                'version': '1.0.0',
                'models_loaded': {
                    'face_detector': self.photo_extractor.face_detector is not None,
                    'landmark_predictor': self.photo_extractor.landmark_predictor is not None,
                    'ocr_reader': self.photo_extractor.ocr_reader is not None
                }
            }
            
            return jsonify(stats)
            
        except Exception as e:
            logger.error(f"Error getting service statistics: {e}")
            return jsonify({'error': str(e)}), 500
            
    def create_live_photo_from_data(self, photo_data: Dict[str, Any]) -> Optional[LivePhoto]:
        """Create live photo object from request data"""
        try:
            # This would typically extract face encoding from the live photo
            # For now, use provided encoding or extract from image
            
            if 'face_encoding' in photo_data:
                face_encoding = photo_data['face_encoding']
            else:
                # Extract from image data
                image_data = base64.b64decode(photo_data['image_data'])
                nparr = np.frombuffer(image_data, np.uint8)
                image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                
                # Extract face encoding (simplified)
                face_locations = face_recognition.face_locations(image)
                if not face_locations:
                    return None
                    
                encodings = face_recognition.face_encodings(image, face_locations)
                if not encodings:
                    return None
                    
                face_encoding = encodings[0].tolist()
                
            live_photo = LivePhoto(
                id=str(uuid.uuid4()),
                session_id=photo_data.get('session_id', ''),
                face_encoding=face_encoding,
                face_landmarks=photo_data.get('face_landmarks', []),
                quality_score=photo_data.get('quality_score', 0.8),
                liveness_score=photo_data.get('liveness_score', 0.9),
                confidence=photo_data.get('confidence', 0.9),
                captured_at=datetime.now()
            )
            
            # Store in database
            self.store_live_photo(live_photo)
            
            return live_photo
            
        except Exception as e:
            logger.error(f"Error creating live photo: {e}")
            return None
            
    def store_document_photo(self, document_photo: DocumentPhoto):
        """Store document photo in database"""
        # Implementation for storing document photo
        pass
        
    def store_live_photo(self, live_photo: LivePhoto):
        """Store live photo in database"""
        # Implementation for storing live photo
        pass
        
    def store_biometric_match(self, match_result: BiometricMatch):
        """Store biometric match result in database"""
        # Implementation for storing match result
        pass
        
    def get_document_photo(self, photo_id: str) -> Optional[DocumentPhoto]:
        """Get document photo from database"""
        # Implementation for retrieving document photo
        return None
        
    def run(self, host='0.0.0.0', port=8087, debug=False):
        """Run the service"""
        logger.info(f"Starting Biometric Matching Service on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)

if __name__ == '__main__':
    service = BiometricMatchingService()
    
    port = int(os.getenv('PORT', 8087))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    service.run(port=port, debug=debug)

