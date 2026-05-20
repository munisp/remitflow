#!/usr/bin/env python3
"""
Advanced Biometric Authentication Service for Remittance Platform
Implements fingerprint and facial recognition with liveness detection
Optimized for African banking security requirements and edge deployment
"""

import os
import io
import json
import logging
import asyncio
import hashlib
import tempfile
import base64
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from pathlib import Path
import uuid

import cv2
import numpy as np
from PIL import Image
import mediapipe as mp
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import redis
import psycopg2
from psycopg2.extras import RealDictCursor
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as transforms
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize
import face_recognition
import dlib
from scipy.spatial.distance import euclidean
from concurrent.futures import ThreadPoolExecutor
import threading
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class BiometricTemplate:
    """Biometric template structure"""
    user_id: str
    template_id: str
    biometric_type: str  # 'fingerprint', 'face', 'iris'
    template_data: bytes
    quality_score: float
    created_at: datetime
    last_used: Optional[datetime]
    usage_count: int
    is_active: bool

@dataclass
class AuthenticationResult:
    """Authentication result structure"""
    success: bool
    user_id: Optional[str]
    confidence_score: float
    biometric_type: str
    match_template_id: Optional[str]
    processing_time: float
    liveness_score: float
    quality_score: float
    error_message: Optional[str]
    session_id: str
    timestamp: datetime

@dataclass
class LivenessResult:
    """Liveness detection result"""
    is_live: bool
    confidence: float
    checks_passed: List[str]
    checks_failed: List[str]
    processing_time: float

class FingerprintProcessor:
    """Advanced fingerprint processing and matching"""
    
    def __init__(self):
        self.min_quality_score = 0.6
        self.match_threshold = 0.7
        logger.info("Fingerprint processor initialized")

    def extract_minutiae(self, fingerprint_image: np.ndarray) -> Dict[str, Any]:
        """Extract minutiae points from fingerprint image"""
        try:
            # Preprocess image
            processed_image = self._preprocess_fingerlogger.info(fingerprint_image)
            
            # Extract minutiae using custom algorithm
            minutiae = self._detect_minutiae(processed_image)
            
            # Calculate quality score
            quality_score = self._calculate_fingerprint_quality(processed_image, minutiae)
            
            return {
                'minutiae': minutiae,
                'quality_score': quality_score,
                'image_dimensions': fingerprint_image.shape,
                'processing_successful': True
            }
            
        except Exception as e:
            logger.error(f"Minutiae extraction error: {e}")
            return {
                'minutiae': [],
                'quality_score': 0.0,
                'image_dimensions': fingerprint_image.shape,
                'processing_successful': False
            }

    def _preprocess_fingerlogger.info(self, image: np.ndarray) -> np.ndarray:
        """Preprocess fingerprint image for better feature extraction"""
        try:
            # Convert to grayscale if needed
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()
            
            # Normalize image
            normalized = cv2.equalizeHist(gray)
            
            # Apply Gaussian blur to reduce noise
            blurred = cv2.GaussianBlur(normalized, (3, 3), 0)
            
            # Apply binary threshold
            _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            
            # Morphological operations to clean up
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
            
            return cleaned
            
        except Exception as e:
            logger.error(f"Fingerprint preprocessing error: {e}")
            return image

    def _detect_minutiae(self, image: np.ndarray) -> List[Dict[str, Any]]:
        """Detect minutiae points (ridge endings and bifurcations)"""
        try:
            minutiae = []
            
            # Apply thinning algorithm to get skeleton
            skeleton = self._zhang_suen_thinning(image)
            
            # Find minutiae points
            height, width = skeleton.shape
            
            for y in range(1, height - 1):
                for x in range(1, width - 1):
                    if skeleton[y, x] == 255:  # Ridge pixel
                        # Check 8-neighborhood
                        neighbors = []
                        for dy in [-1, 0, 1]:
                            for dx in [-1, 0, 1]:
                                if dy == 0 and dx == 0:
                                    continue
                                ny, nx = y + dy, x + dx
                                neighbors.append(1 if skeleton[ny, nx] == 255 else 0)
                        
                        # Count transitions from 0 to 1
                        transitions = 0
                        for i in range(len(neighbors)):
                            if neighbors[i] == 0 and neighbors[(i + 1) % len(neighbors)] == 1:
                                transitions += 1
                        
                        # Classify minutiae
                        if transitions == 1:
                            minutiae.append({
                                'type': 'ending',
                                'x': x,
                                'y': y,
                                'angle': self._calculate_ridge_direction(skeleton, x, y)
                            })
                        elif transitions == 3:
                            minutiae.append({
                                'type': 'bifurcation',
                                'x': x,
                                'y': y,
                                'angle': self._calculate_ridge_direction(skeleton, x, y)
                            })
            
            return minutiae
            
        except Exception as e:
            logger.error(f"Minutiae detection error: {e}")
            return []

    def _zhang_suen_thinning(self, image: np.ndarray) -> np.ndarray:
        """Zhang-Suen thinning algorithm for skeletonization"""
        try:
            # Convert to binary
            binary = (image > 127).astype(np.uint8)
            
            # Iterative thinning
            changing = True
            while changing:
                changing = False
                
                # Sub-iteration 1
                to_remove = []
                for y in range(1, binary.shape[0] - 1):
                    for x in range(1, binary.shape[1] - 1):
                        if binary[y, x] == 1:
                            # Get 8-neighbors
                            p = [binary[y-1, x], binary[y-1, x+1], binary[y, x+1],
                                 binary[y+1, x+1], binary[y+1, x], binary[y+1, x-1],
                                 binary[y, x-1], binary[y-1, x-1]]
                            
                            # Apply Zhang-Suen conditions
                            if self._zhang_suen_conditions(p, 1):
                                to_remove.append((y, x))
                                changing = True
                
                # Remove marked pixels
                for y, x in to_remove:
                    binary[y, x] = 0
                
                # Sub-iteration 2
                to_remove = []
                for y in range(1, binary.shape[0] - 1):
                    for x in range(1, binary.shape[1] - 1):
                        if binary[y, x] == 1:
                            # Get 8-neighbors
                            p = [binary[y-1, x], binary[y-1, x+1], binary[y, x+1],
                                 binary[y+1, x+1], binary[y+1, x], binary[y+1, x-1],
                                 binary[y, x-1], binary[y-1, x-1]]
                            
                            # Apply Zhang-Suen conditions
                            if self._zhang_suen_conditions(p, 2):
                                to_remove.append((y, x))
                                changing = True
                
                # Remove marked pixels
                for y, x in to_remove:
                    binary[y, x] = 0
            
            return binary * 255
            
        except Exception as e:
            logger.error(f"Thinning error: {e}")
            return image

    def _zhang_suen_conditions(self, p: List[int], iteration: int) -> bool:
        """Zhang-Suen algorithm conditions"""
        try:
            # Condition 1: 2 <= B(P1) <= 6
            b_p1 = sum(p)
            if not (2 <= b_p1 <= 6):
                return False
            
            # Condition 2: A(P1) = 1
            a_p1 = 0
            for i in range(len(p)):
                if p[i] == 0 and p[(i + 1) % len(p)] == 1:
                    a_p1 += 1
            if a_p1 != 1:
                return False
            
            # Conditions 3 and 4 depend on iteration
            if iteration == 1:
                # P2 * P4 * P6 = 0
                if p[0] * p[2] * p[4] != 0:
                    return False
                # P4 * P6 * P8 = 0
                if p[2] * p[4] * p[6] != 0:
                    return False
            else:
                # P2 * P4 * P8 = 0
                if p[0] * p[2] * p[6] != 0:
                    return False
                # P2 * P6 * P8 = 0
                if p[0] * p[4] * p[6] != 0:
                    return False
            
            return True
            
        except Exception as e:
            logger.error(f"Zhang-Suen conditions error: {e}")
            return False

    def _calculate_ridge_direction(self, skeleton: np.ndarray, x: int, y: int) -> float:
        """Calculate ridge direction at a point"""
        try:
            # Use gradient-based approach
            window_size = 5
            half_window = window_size // 2
            
            # Extract window around the point
            y_start = max(0, y - half_window)
            y_end = min(skeleton.shape[0], y + half_window + 1)
            x_start = max(0, x - half_window)
            x_end = min(skeleton.shape[1], x + half_window + 1)
            
            window = skeleton[y_start:y_end, x_start:x_end]
            
            # Calculate gradients
            grad_x = cv2.Sobel(window, cv2.CV_64F, 1, 0, ksize=3)
            grad_y = cv2.Sobel(window, cv2.CV_64F, 0, 1, ksize=3)
            
            # Calculate angle
            angle = np.arctan2(grad_y.mean(), grad_x.mean())
            return float(angle)
            
        except Exception as e:
            logger.error(f"Ridge direction calculation error: {e}")
            return 0.0

    def _calculate_fingerprint_quality(self, image: np.ndarray, minutiae: List[Dict]) -> float:
        """Calculate fingerprint quality score"""
        try:
            # Quality factors
            clarity_score = self._calculate_clarity(image)
            minutiae_score = min(len(minutiae) / 30.0, 1.0)  # Normalize by expected count
            
            # Overall quality
            quality = (clarity_score * 0.6 + minutiae_score * 0.4)
            return round(quality, 3)
            
        except Exception as e:
            logger.error(f"Quality calculation error: {e}")
            return 0.0

    def _calculate_clarity(self, image: np.ndarray) -> float:
        """Calculate image clarity using variance of Laplacian"""
        try:
            laplacian = cv2.Laplacian(image, cv2.CV_64F)
            variance = laplacian.var()
            
            # Normalize variance (empirically determined threshold)
            clarity = min(variance / 1000.0, 1.0)
            return clarity
            
        except Exception as e:
            logger.error(f"Clarity calculation error: {e}")
            return 0.0

    def match_fingerprints(self, template1: Dict[str, Any], template2: Dict[str, Any]) -> float:
        """Match two fingerprint templates"""
        try:
            minutiae1 = template1.get('minutiae', [])
            minutiae2 = template2.get('minutiae', [])
            
            if not minutiae1 or not minutiae2:
                return 0.0
            
            # Simple matching based on minutiae proximity and angle similarity
            matches = 0
            total_comparisons = 0
            
            for m1 in minutiae1:
                best_match_score = 0.0
                
                for m2 in minutiae2:
                    # Calculate distance
                    distance = np.sqrt((m1['x'] - m2['x'])**2 + (m1['y'] - m2['y'])**2)
                    
                    # Calculate angle difference
                    angle_diff = abs(m1['angle'] - m2['angle'])
                    angle_diff = min(angle_diff, 2 * np.pi - angle_diff)  # Handle wrap-around
                    
                    # Calculate match score
                    if distance < 20 and angle_diff < np.pi/4:  # Thresholds
                        distance_score = max(0, 1 - distance / 20)
                        angle_score = max(0, 1 - angle_diff / (np.pi/4))
                        match_score = (distance_score + angle_score) / 2
                        best_match_score = max(best_match_score, match_score)
                
                if best_match_score > 0.5:
                    matches += 1
                total_comparisons += 1
            
            # Calculate overall match score
            if total_comparisons > 0:
                match_ratio = matches / total_comparisons
                return round(match_ratio, 3)
            
            return 0.0
            
        except Exception as e:
            logger.error(f"Fingerprint matching error: {e}")
            return 0.0

class FaceProcessor:
    """Advanced face processing and recognition"""
    
    def __init__(self):
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5
        )
        self.match_threshold = 0.6
        logger.info("Face processor initialized")

    def extract_face_encoding(self, face_image: np.ndarray) -> Dict[str, Any]:
        """Extract face encoding using face_recognition library"""
        try:
            # Convert BGR to RGB if needed
            if len(face_image.shape) == 3 and face_image.shape[2] == 3:
                rgb_image = cv2.cvtColor(face_image, cv2.COLOR_BGR2RGB)
            else:
                rgb_image = face_image
            
            # Find face locations
            face_locations = face_recognition.face_locations(rgb_image)
            
            if not face_locations:
                return {
                    'encoding': None,
                    'quality_score': 0.0,
                    'face_detected': False,
                    'landmarks': None
                }
            
            # Extract face encodings
            face_encodings = face_recognition.face_encodings(rgb_image, face_locations)
            
            if not face_encodings:
                return {
                    'encoding': None,
                    'quality_score': 0.0,
                    'face_detected': True,
                    'landmarks': None
                }
            
            # Get face landmarks
            face_landmarks = face_recognition.face_landmarks(rgb_image, face_locations)
            
            # Calculate quality score
            quality_score = self._calculate_face_quality(rgb_image, face_locations[0])
            
            return {
                'encoding': face_encodings[0],
                'quality_score': quality_score,
                'face_detected': True,
                'landmarks': face_landmarks[0] if face_landmarks else None,
                'face_location': face_locations[0]
            }
            
        except Exception as e:
            logger.error(f"Face encoding extraction error: {e}")
            return {
                'encoding': None,
                'quality_score': 0.0,
                'face_detected': False,
                'landmarks': None
            }

    def _calculate_face_quality(self, image: np.ndarray, face_location: Tuple[int, int, int, int]) -> float:
        """Calculate face image quality"""
        try:
            top, right, bottom, left = face_location
            face_image = image[top:bottom, left:right]
            
            # Quality factors
            size_score = self._calculate_face_size_score(face_image)
            sharpness_score = self._calculate_sharpness(face_image)
            brightness_score = self._calculate_brightness_score(face_image)
            
            # Overall quality
            quality = (size_score * 0.3 + sharpness_score * 0.4 + brightness_score * 0.3)
            return round(quality, 3)
            
        except Exception as e:
            logger.error(f"Face quality calculation error: {e}")
            return 0.0

    def _calculate_face_size_score(self, face_image: np.ndarray) -> float:
        """Calculate score based on face size"""
        try:
            height, width = face_image.shape[:2]
            min_size = 100  # Minimum acceptable face size
            optimal_size = 200  # Optimal face size
            
            face_size = min(height, width)
            
            if face_size < min_size:
                return face_size / min_size
            elif face_size <= optimal_size:
                return 1.0
            else:
                # Penalize very large faces (might be too close)
                return max(0.5, 1.0 - (face_size - optimal_size) / optimal_size)
            
        except Exception as e:
            logger.error(f"Face size score calculation error: {e}")
            return 0.0

    def _calculate_sharpness(self, image: np.ndarray) -> float:
        """Calculate image sharpness using Laplacian variance"""
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
            else:
                gray = image
            
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            variance = laplacian.var()
            
            # Normalize variance (empirically determined)
            sharpness = min(variance / 500.0, 1.0)
            return sharpness
            
        except Exception as e:
            logger.error(f"Sharpness calculation error: {e}")
            return 0.0

    def _calculate_brightness_score(self, image: np.ndarray) -> float:
        """Calculate brightness score"""
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
            else:
                gray = image
            
            mean_brightness = gray.mean()
            
            # Optimal brightness range
            optimal_min, optimal_max = 80, 180
            
            if optimal_min <= mean_brightness <= optimal_max:
                return 1.0
            elif mean_brightness < optimal_min:
                return mean_brightness / optimal_min
            else:
                return max(0.3, 1.0 - (mean_brightness - optimal_max) / (255 - optimal_max))
            
        except Exception as e:
            logger.error(f"Brightness score calculation error: {e}")
            return 0.0

    def match_faces(self, encoding1: np.ndarray, encoding2: np.ndarray) -> float:
        """Match two face encodings"""
        try:
            # Calculate cosine similarity
            similarity = cosine_similarity([encoding1], [encoding2])[0][0]
            
            # Convert to match score (0-1 range)
            match_score = (similarity + 1) / 2  # Convert from [-1, 1] to [0, 1]
            
            return round(match_score, 3)
            
        except Exception as e:
            logger.error(f"Face matching error: {e}")
            return 0.0

class LivenessDetector:
    """Advanced liveness detection for anti-spoofing"""
    
    def __init__(self):
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        logger.info("Liveness detector initialized")

    def detect_liveness(self, frames: List[np.ndarray]) -> LivenessResult:
        """Detect liveness from multiple frames"""
        start_time = time.time()
        
        try:
            checks_passed = []
            checks_failed = []
            
            # Check 1: Face movement detection
            if self._check_face_movement(frames):
                checks_passed.append("face_movement")
            else:
                checks_failed.append("face_movement")
            
            # Check 2: Eye blink detection
            if self._check_eye_blinks(frames):
                checks_passed.append("eye_blinks")
            else:
                checks_failed.append("eye_blinks")
            
            # Check 3: Texture analysis
            if self._check_texture_analysis(frames):
                checks_passed.append("texture_analysis")
            else:
                checks_failed.append("texture_analysis")
            
            # Check 4: 3D face structure
            if self._check_3d_structure(frames):
                checks_passed.append("3d_structure")
            else:
                checks_failed.append("3d_structure")
            
            # Calculate overall confidence
            total_checks = len(checks_passed) + len(checks_failed)
            confidence = len(checks_passed) / total_checks if total_checks > 0 else 0.0
            
            # Determine if live (require at least 2 checks to pass)
            is_live = len(checks_passed) >= 2 and confidence >= 0.5
            
            processing_time = time.time() - start_time
            
            return LivenessResult(
                is_live=is_live,
                confidence=round(confidence, 3),
                checks_passed=checks_passed,
                checks_failed=checks_failed,
                processing_time=round(processing_time, 3)
            )
            
        except Exception as e:
            logger.error(f"Liveness detection error: {e}")
            processing_time = time.time() - start_time
            
            return LivenessResult(
                is_live=False,
                confidence=0.0,
                checks_passed=[],
                checks_failed=["error"],
                processing_time=round(processing_time, 3)
            )

    def _check_face_movement(self, frames: List[np.ndarray]) -> bool:
        """Check for natural face movement between frames"""
        try:
            if len(frames) < 3:
                return False
            
            face_positions = []
            
            for frame in frames:
                # Convert to RGB
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                
                # Detect face
                results = self.face_mesh.process(rgb_frame)
                
                if results.multi_face_landmarks:
                    landmarks = results.multi_face_landmarks[0]
                    
                    # Get nose tip position (landmark 1)
                    nose_tip = landmarks.landmark[1]
                    face_positions.append((nose_tip.x, nose_tip.y))
                else:
                    face_positions.append(None)
            
            # Calculate movement variance
            valid_positions = [pos for pos in face_positions if pos is not None]
            
            if len(valid_positions) < 3:
                return False
            
            x_positions = [pos[0] for pos in valid_positions]
            y_positions = [pos[1] for pos in valid_positions]
            
            x_variance = np.var(x_positions)
            y_variance = np.var(y_positions)
            
            # Check for reasonable movement (not too static, not too erratic)
            movement_threshold_min = 0.0001
            movement_threshold_max = 0.01
            
            total_variance = x_variance + y_variance
            
            return movement_threshold_min < total_variance < movement_threshold_max
            
        except Exception as e:
            logger.error(f"Face movement check error: {e}")
            return False

    def _check_eye_blinks(self, frames: List[np.ndarray]) -> bool:
        """Check for eye blinks"""
        try:
            if len(frames) < 5:
                return False
            
            ear_values = []  # Eye Aspect Ratio values
            
            for frame in frames:
                # Convert to RGB
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                
                # Detect face landmarks
                results = self.face_mesh.process(rgb_frame)
                
                if results.multi_face_landmarks:
                    landmarks = results.multi_face_landmarks[0]
                    
                    # Calculate Eye Aspect Ratio (EAR)
                    ear = self._calculate_ear(landmarks)
                    ear_values.append(ear)
                else:
                    ear_values.append(None)
            
            # Analyze EAR values for blinks
            valid_ears = [ear for ear in ear_values if ear is not None]
            
            if len(valid_ears) < 5:
                return False
            
            # Look for blink patterns (EAR drops and recovers)
            blink_threshold = 0.25
            blinks_detected = 0
            
            for i in range(1, len(valid_ears) - 1):
                if (valid_ears[i] < blink_threshold and 
                    valid_ears[i-1] > blink_threshold and 
                    valid_ears[i+1] > blink_threshold):
                    blinks_detected += 1
            
            # Expect at least one blink in the sequence
            return blinks_detected >= 1
            
        except Exception as e:
            logger.error(f"Eye blink check error: {e}")
            return False

    def _calculate_ear(self, landmarks) -> float:
        """Calculate Eye Aspect Ratio"""
        try:
            # Left eye landmarks (approximate indices for MediaPipe)
            left_eye_indices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
            
            # Get left eye landmarks
            left_eye_points = []
            for idx in left_eye_indices[:6]:  # Use first 6 points
                point = landmarks.landmark[idx]
                left_eye_points.append([point.x, point.y])
            
            left_eye_points = np.array(left_eye_points)
            
            # Calculate EAR for left eye
            # Vertical distances
            A = np.linalg.norm(left_eye_points[1] - left_eye_points[5])
            B = np.linalg.norm(left_eye_points[2] - left_eye_points[4])
            
            # Horizontal distance
            C = np.linalg.norm(left_eye_points[0] - left_eye_points[3])
            
            # EAR formula
            ear = (A + B) / (2.0 * C)
            
            return ear
            
        except Exception as e:
            logger.error(f"EAR calculation error: {e}")
            return 0.3  # Default value

    def _check_texture_analysis(self, frames: List[np.ndarray]) -> bool:
        """Check texture patterns to detect printed photos"""
        try:
            if not frames:
                return False
            
            # Analyze first frame
            frame = frames[0]
            
            # Convert to grayscale
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Calculate Local Binary Pattern (LBP) variance
            lbp = self._calculate_lbp(gray)
            lbp_variance = np.var(lbp)
            
            # Real faces have more texture variation than printed photos
            texture_threshold = 100  # Empirically determined
            
            return lbp_variance > texture_threshold
            
        except Exception as e:
            logger.error(f"Texture analysis error: {e}")
            return False

    def _calculate_lbp(self, image: np.ndarray, radius: int = 1, n_points: int = 8) -> np.ndarray:
        """Calculate Local Binary Pattern"""
        try:
            height, width = image.shape
            lbp = np.zeros((height, width), dtype=np.uint8)
            
            for i in range(radius, height - radius):
                for j in range(radius, width - radius):
                    center = image[i, j]
                    binary_string = ""
                    
                    for k in range(n_points):
                        angle = 2 * np.pi * k / n_points
                        x = i + radius * np.cos(angle)
                        y = j + radius * np.sin(angle)
                        
                        # Bilinear interpolation
                        x1, y1 = int(x), int(y)
                        x2, y2 = x1 + 1, y1 + 1
                        
                        if x2 < height and y2 < width:
                            # Interpolate
                            dx, dy = x - x1, y - y1
                            pixel_value = (
                                image[x1, y1] * (1 - dx) * (1 - dy) +
                                image[x2, y1] * dx * (1 - dy) +
                                image[x1, y2] * (1 - dx) * dy +
                                image[x2, y2] * dx * dy
                            )
                            
                            binary_string += "1" if pixel_value >= center else "0"
                    
                    lbp[i, j] = int(binary_string, 2)
            
            return lbp
            
        except Exception as e:
            logger.error(f"LBP calculation error: {e}")
            return np.zeros_like(image)

    def _check_3d_structure(self, frames: List[np.ndarray]) -> bool:
        """Check for 3D face structure using depth cues"""
        try:
            if len(frames) < 3:
                return False
            
            # Analyze face landmark depth variations
            depth_scores = []
            
            for frame in frames:
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self.face_mesh.process(rgb_frame)
                
                if results.multi_face_landmarks:
                    landmarks = results.multi_face_landmarks[0]
                    
                    # Calculate depth score based on landmark z-coordinates
                    z_coords = [landmark.z for landmark in landmarks.landmark]
                    z_variance = np.var(z_coords)
                    depth_scores.append(z_variance)
            
            if not depth_scores:
                return False
            
            # Real faces have more depth variation
            avg_depth_variance = np.mean(depth_scores)
            depth_threshold = 0.001  # Empirically determined
            
            return avg_depth_variance > depth_threshold
            
        except Exception as e:
            logger.error(f"3D structure check error: {e}")
            return False

class BiometricAuthService:
    """Main biometric authentication service"""
    
    def __init__(self):
        self.fingerprint_processor = FingerprintProcessor()
        self.face_processor = FaceProcessor()
        self.liveness_detector = LivenessDetector()
        
        # Initialize database connection
        self.db_config = None
        self._init_database()
        
        # Initialize Redis cache
        self.redis_client = None
        self._init_redis()
        
        # Initialize thread pool
        self.executor = ThreadPoolExecutor(max_workers=4)

    def _init_database(self):
        """Initialize database connection"""
        try:
            self.db_config = {
                'host': os.getenv('DB_HOST', os.getenv('HOST', 'localhost')),
                'port': os.getenv('DB_PORT', '5432'),
                'database': os.getenv('DB_NAME', 'remittance'),
                'user': os.getenv('DB_USER', 'postgres'),
                os.getenv('DB_PASSWORD', 'password'): os.getenv('DB_PASSWORD', os.getenv('DB_PASSWORD', 'password'))
            }
            
            # Test connection
            conn = psycopg2.connect(**self.db_config)
            conn.close()
            
            logger.info("Database connection initialized")
            
        except Exception as e:
            logger.error(f"Database initialization error: {e}")
            self.db_config = None

    def _init_redis(self):
        """Initialize Redis cache"""
        try:
            self.redis_client = redis.Redis(
                host=os.getenv('REDIS_HOST', os.getenv('HOST', 'localhost')),
                port=int(os.getenv('REDIS_PORT', '6379')),
                db=0,
                decode_responses=False  # Keep binary data
            )
            
            # Test connection
            self.redis_client.ping()
            logger.info("Redis connection initialized")
            
        except Exception as e:
            logger.error(f"Redis initialization error: {e}")
            self.redis_client = None

    def enroll_biometric(self, user_id: str, biometric_data: bytes, 
                        biometric_type: str) -> Dict[str, Any]:
        """Enroll new biometric template"""
        try:
            # Load image
            image = self._load_image(biometric_data)
            if image is None:
                return {'success': False, 'error': 'Invalid image data'}
            
            # Process based on biometric type
            if biometric_type == 'fingerprint':
                result = self.fingerprint_processor.extract_minutiae(image)
                if not result['processing_successful']:
                    return {'success': False, 'error': 'Fingerprint processing failed'}
                
                template_data = json.dumps(result).encode('utf-8')
                quality_score = result['quality_score']
                
            elif biometric_type == 'face':
                result = self.face_processor.extract_face_encoding(image)
                if result['encoding'] is None:
                    return {'success': False, 'error': 'Face processing failed'}
                
                template_data = result['encoding'].tobytes()
                quality_score = result['quality_score']
                
            else:
                return {'success': False, 'error': 'Unsupported biometric type'}
            
            # Check quality threshold
            if quality_score < 0.5:
                return {'success': False, 'error': 'Biometric quality too low'}
            
            # Create template
            template_id = str(uuid.uuid4())
            template = BiometricTemplate(
                user_id=user_id,
                template_id=template_id,
                biometric_type=biometric_type,
                template_data=template_data,
                quality_score=quality_score,
                created_at=datetime.now(),
                last_used=None,
                usage_count=0,
                is_active=True
            )
            
            # Store in database
            if self._store_template(template):
                return {
                    'success': True,
                    'template_id': template_id,
                    'quality_score': quality_score
                }
            else:
                return {'success': False, 'error': 'Database storage failed'}
                
        except Exception as e:
            logger.error(f"Biometric enrollment error: {e}")
            return {'success': False, 'error': str(e)}

    def authenticate_biometric(self, biometric_data: bytes, biometric_type: str,
                             liveness_frames: Optional[List[bytes]] = None) -> AuthenticationResult:
        """Authenticate using biometric data"""
        start_time = time.time()
        session_id = str(uuid.uuid4())
        
        try:
            # Load image
            image = self._load_image(biometric_data)
            if image is None:
                return AuthenticationResult(
                    success=False,
                    user_id=None,
                    confidence_score=0.0,
                    biometric_type=biometric_type,
                    match_template_id=None,
                    processing_time=time.time() - start_time,
                    liveness_score=0.0,
                    quality_score=0.0,
                    error_message="Invalid image data",
                    session_id=session_id,
                    timestamp=datetime.now()
                )
            
            # Liveness detection for face authentication
            liveness_score = 0.0
            if biometric_type == 'face' and liveness_frames:
                liveness_images = []
                for frame_data in liveness_frames:
                    frame_image = self._load_image(frame_data)
                    if frame_image is not None:
                        liveness_images.append(frame_image)
                
                if liveness_images:
                    liveness_result = self.liveness_detector.detect_liveness(liveness_images)
                    liveness_score = liveness_result.confidence
                    
                    if not liveness_result.is_live:
                        return AuthenticationResult(
                            success=False,
                            user_id=None,
                            confidence_score=0.0,
                            biometric_type=biometric_type,
                            match_template_id=None,
                            processing_time=time.time() - start_time,
                            liveness_score=liveness_score,
                            quality_score=0.0,
                            error_message="Liveness detection failed",
                            session_id=session_id,
                            timestamp=datetime.now()
                        )
            
            # Extract features
            if biometric_type == 'fingerprint':
                result = self.fingerprint_processor.extract_minutiae(image)
                if not result['processing_successful']:
                    return AuthenticationResult(
                        success=False,
                        user_id=None,
                        confidence_score=0.0,
                        biometric_type=biometric_type,
                        match_template_id=None,
                        processing_time=time.time() - start_time,
                        liveness_score=liveness_score,
                        quality_score=0.0,
                        error_message="Fingerprint processing failed",
                        session_id=session_id,
                        timestamp=datetime.now()
                    )
                
                query_template = result
                quality_score = result['quality_score']
                
            elif biometric_type == 'face':
                result = self.face_processor.extract_face_encoding(image)
                if result['encoding'] is None:
                    return AuthenticationResult(
                        success=False,
                        user_id=None,
                        confidence_score=0.0,
                        biometric_type=biometric_type,
                        match_template_id=None,
                        processing_time=time.time() - start_time,
                        liveness_score=liveness_score,
                        quality_score=0.0,
                        error_message="Face processing failed",
                        session_id=session_id,
                        timestamp=datetime.now()
                    )
                
                query_template = result['encoding']
                quality_score = result['quality_score']
                
            else:
                return AuthenticationResult(
                    success=False,
                    user_id=None,
                    confidence_score=0.0,
                    biometric_type=biometric_type,
                    match_template_id=None,
                    processing_time=time.time() - start_time,
                    liveness_score=liveness_score,
                    quality_score=0.0,
                    error_message="Unsupported biometric type",
                    session_id=session_id,
                    timestamp=datetime.now()
                )
            
            # Match against stored templates
            best_match = self._find_best_match(query_template, biometric_type)
            
            processing_time = time.time() - start_time
            
            if best_match and best_match['confidence'] >= (
                self.fingerprint_processor.match_threshold if biometric_type == 'fingerprint' 
                else self.face_processor.match_threshold
            ):
                # Update template usage
                self._update_template_usage(best_match['template_id'])
                
                return AuthenticationResult(
                    success=True,
                    user_id=best_match['user_id'],
                    confidence_score=best_match['confidence'],
                    biometric_type=biometric_type,
                    match_template_id=best_match['template_id'],
                    processing_time=processing_time,
                    liveness_score=liveness_score,
                    quality_score=quality_score,
                    error_message=None,
                    session_id=session_id,
                    timestamp=datetime.now()
                )
            else:
                return AuthenticationResult(
                    success=False,
                    user_id=None,
                    confidence_score=best_match['confidence'] if best_match else 0.0,
                    biometric_type=biometric_type,
                    match_template_id=None,
                    processing_time=processing_time,
                    liveness_score=liveness_score,
                    quality_score=quality_score,
                    error_message="No matching template found",
                    session_id=session_id,
                    timestamp=datetime.now()
                )
                
        except Exception as e:
            logger.error(f"Biometric authentication error: {e}")
            processing_time = time.time() - start_time
            
            return AuthenticationResult(
                success=False,
                user_id=None,
                confidence_score=0.0,
                biometric_type=biometric_type,
                match_template_id=None,
                processing_time=processing_time,
                liveness_score=0.0,
                quality_score=0.0,
                error_message=str(e),
                session_id=session_id,
                timestamp=datetime.now()
            )

    def _load_image(self, image_data: bytes) -> Optional[np.ndarray]:
        """Load image from bytes"""
        try:
            nparr = np.frombuffer(image_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            return image
        except Exception as e:
            logger.error(f"Image loading error: {e}")
            return None

    def _store_template(self, template: BiometricTemplate) -> bool:
        """Store biometric template in database"""
        try:
            if not self.db_config:
                return False
            
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()
            
            query = """
            INSERT INTO biometric_templates (
                user_id, template_id, biometric_type, template_data,
                quality_score, created_at, last_used, usage_count, is_active
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            
            cursor.execute(query, (
                template.user_id, template.template_id, template.biometric_type,
                template.template_data, template.quality_score, template.created_at,
                template.last_used, template.usage_count, template.is_active
            ))
            
            conn.commit()
            cursor.close()
            conn.close()
            
            return True
            
        except Exception as e:
            logger.error(f"Template storage error: {e}")
            return False

    def _find_best_match(self, query_template, biometric_type: str) -> Optional[Dict[str, Any]]:
        """Find best matching template"""
        try:
            if not self.db_config:
                return None
            
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Get all active templates of the same type
            cursor.execute("""
                SELECT user_id, template_id, template_data, quality_score
                FROM biometric_templates
                WHERE biometric_type = %s AND is_active = true
            """, (biometric_type,))
            
            templates = cursor.fetchall()
            cursor.close()
            conn.close()
            
            best_match = None
            best_score = 0.0
            
            for template in templates:
                try:
                    if biometric_type == 'fingerprint':
                        stored_template = json.loads(template['template_data'].decode('utf-8'))
                        score = self.fingerprint_processor.match_fingerprints(
                            query_template, stored_template
                        )
                    elif biometric_type == 'face':
                        stored_encoding = np.frombuffer(template['template_data'], dtype=np.float64)
                        score = self.face_processor.match_faces(query_template, stored_encoding)
                    else:
                        continue
                    
                    if score > best_score:
                        best_score = score
                        best_match = {
                            'user_id': template['user_id'],
                            'template_id': template['template_id'],
                            'confidence': score
                        }
                        
                except Exception as e:
                    logger.error(f"Template matching error: {e}")
                    continue
            
            return best_match
            
        except Exception as e:
            logger.error(f"Best match search error: {e}")
            return None

    def _update_template_usage(self, template_id: str):
        """Update template usage statistics"""
        try:
            if not self.db_config:
                return
            
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE biometric_templates
                SET last_used = %s, usage_count = usage_count + 1
                WHERE template_id = %s
            """, (datetime.now(), template_id))
            
            conn.commit()
            cursor.close()
            conn.close()
            
        except Exception as e:
            logger.error(f"Template usage update error: {e}")

# Flask Application
app = Flask(__name__)
CORS(app)

# Initialize biometric service
biometric_service = BiometricAuthService()

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32MB max file size
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'bmp', 'tiff'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Biometric Authentication Service',
        'version': '1.0.0',
        'supported_biometrics': ['fingerprint', 'face'],
        'features': ['liveness_detection', 'anti_spoofing', 'quality_assessment'],
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/biometric/enroll', methods=['POST'])
def enroll_biometric():
    """Enroll new biometric template"""
    try:
        # Check required parameters
        if 'file' not in request.files:
            return jsonify({'error': 'No biometric data provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': 'File type not allowed'}), 400
        
        user_id = request.form.get('user_id')
        biometric_type = request.form.get('biometric_type', 'face')
        
        if not user_id:
            return jsonify({'error': 'User ID required'}), 400
        
        if biometric_type not in ['fingerprint', 'face']:
            return jsonify({'error': 'Invalid biometric type'}), 400
        
        # Read file data
        file_data = file.read()
        
        # Enroll biometric
        result = biometric_service.enroll_biometric(user_id, file_data, biometric_type)
        
        if result['success']:
            return jsonify({
                'success': True,
                'template_id': result['template_id'],
                'quality_score': result['quality_score'],
                'message': 'Biometric enrolled successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': result['error']
            }), 400
            
    except Exception as e:
        logger.error(f"Biometric enrollment error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/biometric/authenticate', methods=['POST'])
def authenticate_biometric():
    """Authenticate using biometric data"""
    try:
        # Check required parameters
        if 'file' not in request.files:
            return jsonify({'error': 'No biometric data provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': 'File type not allowed'}), 400
        
        biometric_type = request.form.get('biometric_type', 'face')
        
        if biometric_type not in ['fingerprint', 'face']:
            return jsonify({'error': 'Invalid biometric type'}), 400
        
        # Read file data
        file_data = file.read()
        
        # Get liveness frames if provided
        liveness_frames = None
        if biometric_type == 'face':
            liveness_files = request.files.getlist('liveness_frames')
            if liveness_files:
                liveness_frames = []
                for liveness_file in liveness_files:
                    if liveness_file and allowed_file(liveness_file.filename):
                        liveness_frames.append(liveness_file.read())
        
        # Authenticate biometric
        result = biometric_service.authenticate_biometric(
            file_data, biometric_type, liveness_frames
        )
        
        return jsonify({
            'success': result.success,
            'user_id': result.user_id,
            'confidence_score': result.confidence_score,
            'biometric_type': result.biometric_type,
            'match_template_id': result.match_template_id,
            'processing_time': result.processing_time,
            'liveness_score': result.liveness_score,
            'quality_score': result.quality_score,
            'error_message': result.error_message,
            'session_id': result.session_id,
            'timestamp': result.timestamp.isoformat()
        })
        
    except Exception as e:
        logger.error(f"Biometric authentication error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/biometric/liveness', methods=['POST'])
def check_liveness():
    """Check liveness from multiple frames"""
    try:
        files = request.files.getlist('frames')
        if not files:
            return jsonify({'error': 'No frames provided'}), 400
        
        frames = []
        for file in files:
            if file and allowed_file(file.filename):
                file_data = file.read()
                image = biometric_service._load_image(file_data)
                if image is not None:
                    frames.append(image)
        
        if not frames:
            return jsonify({'error': 'No valid frames provided'}), 400
        
        # Perform liveness detection
        result = biometric_service.liveness_detector.detect_liveness(frames)
        
        return jsonify({
            'is_live': result.is_live,
            'confidence': result.confidence,
            'checks_passed': result.checks_passed,
            'checks_failed': result.checks_failed,
            'processing_time': result.processing_time
        })
        
    except Exception as e:
        logger.error(f"Liveness detection error: {e}")
        return jsonify({
            'error': str(e)
        }), 500

@app.route('/api/biometric/templates/<user_id>', methods=['GET'])
def get_user_templates(user_id):
    """Get biometric templates for a user"""
    try:
        if not biometric_service.db_config:
            return jsonify({'error': 'Database not available'}), 500
        
        conn = psycopg2.connect(**biometric_service.db_config)
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute("""
            SELECT template_id, biometric_type, quality_score, created_at,
                   last_used, usage_count, is_active
            FROM biometric_templates
            WHERE user_id = %s
            ORDER BY created_at DESC
        """, (user_id,))
        
        templates = cursor.fetchall()
        cursor.close()
        conn.close()
        
        # Convert datetime objects to strings
        for template in templates:
            template['created_at'] = template['created_at'].isoformat()
            if template['last_used']:
                template['last_used'] = template['last_used'].isoformat()
        
        return jsonify({
            'user_id': user_id,
            'templates': templates,
            'count': len(templates)
        })
        
    except Exception as e:
        logger.error(f"Template retrieval error: {e}")
        return jsonify({
            'error': str(e)
        }), 500

@app.route('/api/biometric/stats', methods=['GET'])
def get_stats():
    """Get biometric authentication statistics"""
    try:
        stats = {
            'total_templates': 0,
            'active_templates': 0,
            'authentication_attempts': 0,
            'success_rate': 0.0,
            'biometric_types': {},
            'average_quality': 0.0
        }
        
        if biometric_service.db_config:
            conn = psycopg2.connect(**biometric_service.db_config)
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            # Get template stats
            cursor.execute("""
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN is_active THEN 1 END) as active,
                    AVG(quality_score) as avg_quality,
                    biometric_type,
                    COUNT(*) as type_count
                FROM biometric_templates
                GROUP BY biometric_type
            """)
            
            results = cursor.fetchall()
            
            total_templates = 0
            active_templates = 0
            total_quality = 0
            quality_count = 0
            
            for row in results:
                stats['biometric_types'][row['biometric_type']] = row['type_count']
                total_templates += row['total']
                active_templates += row['active']
                if row['avg_quality']:
                    total_quality += row['avg_quality'] * row['total']
                    quality_count += row['total']
            
            stats['total_templates'] = total_templates
            stats['active_templates'] = active_templates
            stats['average_quality'] = total_quality / quality_count if quality_count > 0 else 0.0
            
            cursor.close()
            conn.close()
        
        return jsonify(stats)
        
    except Exception as e:
        logger.error(f"Stats retrieval error: {e}")
        return jsonify({
            'error': str(e)
        }), 500

if __name__ == '__main__':
    # Create necessary directories
    os.makedirs('uploads', exist_ok=True)
    os.makedirs('cache', exist_ok=True)
    
    # Start the application
    app.run(
        host=os.getenv('HOST', os.getenv('HOST', '0.0.0.0')),
        port=int(os.getenv('PORT', 5004)),
        debug=os.getenv('DEBUG', 'False').lower() == 'true'
    )

