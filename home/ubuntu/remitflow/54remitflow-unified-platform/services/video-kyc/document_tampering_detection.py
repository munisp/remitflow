"""
Document Tampering Detection Service
ML-based detection of forged, altered, or tampered identity documents
"""

import os
import logging
import hashlib
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from enum import Enum

import numpy as np
import cv2
from PIL import Image, ImageFilter, ImageEnhance
from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TamperingType(str, Enum):
    """Types of document tampering"""
    PHOTO_REPLACEMENT = "photo_replacement"
    TEXT_ALTERATION = "text_alteration"
    DIGITAL_MANIPULATION = "digital_manipulation"
    PHYSICAL_ALTERATION = "physical_alteration"
    COPY_MOVE_FORGERY = "copy_move_forgery"
    SPLICING = "splicing"
    RESAMPLING = "resampling"
    JPEG_ARTIFACTS = "jpeg_artifacts"
    METADATA_INCONSISTENCY = "metadata_inconsistency"
    FONT_INCONSISTENCY = "font_inconsistency"


class RiskLevel(str, Enum):
    """Risk level for tampering detection"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class TamperingResult:
    """Result of tampering detection analysis"""
    id: str
    document_id: str
    is_tampered: bool
    confidence: float
    risk_level: RiskLevel
    tampering_types: List[TamperingType]
    analysis_details: Dict[str, Any]
    recommendations: List[str]
    processing_time: float
    timestamp: datetime


@dataclass
class ForensicAnalysis:
    """Forensic analysis results"""
    ela_score: float  # Error Level Analysis
    noise_analysis_score: float
    edge_consistency_score: float
    compression_artifact_score: float
    metadata_consistency_score: float
    copy_move_score: float
    splicing_score: float
    overall_authenticity_score: float


class ErrorLevelAnalyzer:
    """
    Error Level Analysis (ELA) for detecting digital manipulation
    Identifies areas that have been modified by analyzing JPEG compression artifacts
    """
    
    def __init__(self, quality: int = 90):
        self.quality = quality
    
    def analyze(self, image: np.ndarray) -> Tuple[float, np.ndarray]:
        """
        Perform ELA analysis on image
        Returns (tampering_score, ela_image)
        """
        try:
            # Convert to PIL Image
            if len(image.shape) == 3:
                pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            else:
                pil_image = Image.fromarray(image)
            
            # Save and reload with specific quality
            import io
            buffer = io.BytesIO()
            pil_image.save(buffer, format='JPEG', quality=self.quality)
            buffer.seek(0)
            recompressed = Image.open(buffer)
            
            # Calculate difference
            original_array = np.array(pil_image).astype(np.float32)
            recompressed_array = np.array(recompressed).astype(np.float32)
            
            ela_image = np.abs(original_array - recompressed_array)
            
            # Enhance for visualization
            ela_image = (ela_image * 10).clip(0, 255).astype(np.uint8)
            
            # Calculate tampering score based on variance in ELA
            if len(ela_image.shape) == 3:
                ela_gray = cv2.cvtColor(ela_image, cv2.COLOR_RGB2GRAY)
            else:
                ela_gray = ela_image
            
            # High variance in specific regions indicates tampering
            local_variance = self._calculate_local_variance(ela_gray)
            
            # Normalize score (0 = authentic, 1 = likely tampered)
            tampering_score = min(1.0, local_variance / 50.0)
            
            return tampering_score, ela_image
            
        except Exception as e:
            logger.error(f"ELA analysis failed: {e}")
            return 0.5, image
    
    def _calculate_local_variance(self, image: np.ndarray, block_size: int = 16) -> float:
        """Calculate local variance to detect inconsistent regions"""
        h, w = image.shape[:2]
        variances = []
        
        for i in range(0, h - block_size, block_size):
            for j in range(0, w - block_size, block_size):
                block = image[i:i+block_size, j:j+block_size]
                variances.append(np.var(block))
        
        if not variances:
            return 0.0
        
        # High variance in variances indicates inconsistent compression
        return float(np.std(variances))


class NoiseAnalyzer:
    """
    Noise pattern analysis for detecting splicing and manipulation
    Authentic images have consistent noise patterns
    """
    
    def analyze(self, image: np.ndarray) -> Tuple[float, Dict[str, Any]]:
        """
        Analyze noise patterns in image
        Returns (tampering_score, analysis_details)
        """
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
            
            # Extract noise using high-pass filter
            noise = self._extract_noise(gray)
            
            # Analyze noise consistency across regions
            consistency_score = self._analyze_noise_consistency(noise)
            
            # Analyze noise level
            noise_level = np.std(noise)
            
            # Calculate tampering score
            # Inconsistent noise patterns indicate tampering
            tampering_score = 1.0 - consistency_score
            
            details = {
                "noise_level": float(noise_level),
                "consistency_score": float(consistency_score),
                "regions_analyzed": 16
            }
            
            return tampering_score, details
            
        except Exception as e:
            logger.error(f"Noise analysis failed: {e}")
            return 0.5, {}
    
    def _extract_noise(self, image: np.ndarray) -> np.ndarray:
        """Extract noise component from image"""
        # Apply Gaussian blur to get low-frequency component
        blurred = cv2.GaussianBlur(image, (5, 5), 0)
        
        # Noise is the difference between original and blurred
        noise = image.astype(np.float32) - blurred.astype(np.float32)
        
        return noise
    
    def _analyze_noise_consistency(self, noise: np.ndarray, grid_size: int = 4) -> float:
        """Analyze noise consistency across image regions"""
        h, w = noise.shape[:2]
        block_h, block_w = h // grid_size, w // grid_size
        
        noise_stats = []
        
        for i in range(grid_size):
            for j in range(grid_size):
                block = noise[i*block_h:(i+1)*block_h, j*block_w:(j+1)*block_w]
                noise_stats.append({
                    "mean": np.mean(block),
                    "std": np.std(block),
                    "skewness": self._calculate_skewness(block)
                })
        
        # Calculate consistency based on standard deviation of statistics
        std_means = np.std([s["std"] for s in noise_stats])
        
        # Lower variance = more consistent = more authentic
        consistency = 1.0 / (1.0 + std_means)
        
        return float(consistency)
    
    def _calculate_skewness(self, data: np.ndarray) -> float:
        """Calculate skewness of data"""
        mean = np.mean(data)
        std = np.std(data)
        if std == 0:
            return 0.0
        return float(np.mean(((data - mean) / std) ** 3))


class CopyMoveDetector:
    """
    Detect copy-move forgery where parts of image are copied and pasted
    """
    
    def __init__(self, block_size: int = 16, threshold: float = 0.95):
        self.block_size = block_size
        self.threshold = threshold
    
    def detect(self, image: np.ndarray) -> Tuple[float, List[Dict[str, Any]]]:
        """
        Detect copy-move forgery
        Returns (tampering_score, detected_regions)
        """
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
            
            # Extract overlapping blocks
            blocks, positions = self._extract_blocks(gray)
            
            if len(blocks) < 2:
                return 0.0, []
            
            # Find similar blocks
            similar_pairs = self._find_similar_blocks(blocks, positions)
            
            # Filter by distance (copy-move typically has some distance)
            forgery_regions = self._filter_by_distance(similar_pairs)
            
            # Calculate tampering score
            if forgery_regions:
                tampering_score = min(1.0, len(forgery_regions) / 10.0)
            else:
                tampering_score = 0.0
            
            return tampering_score, forgery_regions
            
        except Exception as e:
            logger.error(f"Copy-move detection failed: {e}")
            return 0.0, []
    
    def _extract_blocks(self, image: np.ndarray) -> Tuple[List[np.ndarray], List[Tuple[int, int]]]:
        """Extract overlapping blocks from image"""
        h, w = image.shape[:2]
        blocks = []
        positions = []
        
        step = self.block_size // 2
        
        for i in range(0, h - self.block_size, step):
            for j in range(0, w - self.block_size, step):
                block = image[i:i+self.block_size, j:j+self.block_size]
                blocks.append(block.flatten())
                positions.append((i, j))
        
        return blocks, positions
    
    def _find_similar_blocks(
        self, 
        blocks: List[np.ndarray], 
        positions: List[Tuple[int, int]]
    ) -> List[Dict[str, Any]]:
        """Find pairs of similar blocks"""
        similar_pairs = []
        
        # Use DCT for efficient comparison
        dct_blocks = []
        for block in blocks:
            block_2d = block.reshape(self.block_size, self.block_size)
            dct = cv2.dct(block_2d.astype(np.float32))
            dct_blocks.append(dct[:8, :8].flatten())  # Use top-left coefficients
        
        dct_array = np.array(dct_blocks)
        
        # Find similar blocks using correlation
        for i in range(len(dct_blocks)):
            for j in range(i + 1, min(i + 1000, len(dct_blocks))):  # Limit comparisons
                correlation = np.corrcoef(dct_array[i], dct_array[j])[0, 1]
                
                if correlation > self.threshold:
                    similar_pairs.append({
                        "block1_pos": positions[i],
                        "block2_pos": positions[j],
                        "similarity": float(correlation)
                    })
        
        return similar_pairs
    
    def _filter_by_distance(self, pairs: List[Dict[str, Any]], min_distance: int = 32) -> List[Dict[str, Any]]:
        """Filter pairs by minimum distance"""
        filtered = []
        
        for pair in pairs:
            pos1 = pair["block1_pos"]
            pos2 = pair["block2_pos"]
            
            distance = np.sqrt((pos1[0] - pos2[0])**2 + (pos1[1] - pos2[1])**2)
            
            if distance >= min_distance:
                pair["distance"] = float(distance)
                filtered.append(pair)
        
        return filtered


class EdgeConsistencyAnalyzer:
    """
    Analyze edge consistency to detect splicing and photo replacement
    """
    
    def analyze(self, image: np.ndarray) -> Tuple[float, Dict[str, Any]]:
        """
        Analyze edge consistency
        Returns (tampering_score, analysis_details)
        """
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
            
            # Detect edges using multiple methods
            canny_edges = cv2.Canny(gray, 50, 150)
            sobel_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
            sobel_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
            sobel_magnitude = np.sqrt(sobel_x**2 + sobel_y**2)
            
            # Analyze edge density in different regions
            edge_density_variance = self._analyze_edge_density(canny_edges)
            
            # Analyze edge direction consistency
            direction_consistency = self._analyze_edge_directions(sobel_x, sobel_y)
            
            # Calculate tampering score
            # High variance in edge density or inconsistent directions indicate tampering
            tampering_score = (edge_density_variance * 0.6 + (1 - direction_consistency) * 0.4)
            tampering_score = min(1.0, tampering_score)
            
            details = {
                "edge_density_variance": float(edge_density_variance),
                "direction_consistency": float(direction_consistency),
                "total_edges": int(np.sum(canny_edges > 0))
            }
            
            return tampering_score, details
            
        except Exception as e:
            logger.error(f"Edge consistency analysis failed: {e}")
            return 0.5, {}
    
    def _analyze_edge_density(self, edges: np.ndarray, grid_size: int = 4) -> float:
        """Analyze edge density variance across regions"""
        h, w = edges.shape[:2]
        block_h, block_w = h // grid_size, w // grid_size
        
        densities = []
        
        for i in range(grid_size):
            for j in range(grid_size):
                block = edges[i*block_h:(i+1)*block_h, j*block_w:(j+1)*block_w]
                density = np.sum(block > 0) / block.size
                densities.append(density)
        
        # Normalize variance
        variance = np.var(densities)
        normalized_variance = min(1.0, variance * 100)
        
        return float(normalized_variance)
    
    def _analyze_edge_directions(self, sobel_x: np.ndarray, sobel_y: np.ndarray) -> float:
        """Analyze consistency of edge directions"""
        # Calculate edge directions
        directions = np.arctan2(sobel_y, sobel_x)
        
        # Create histogram of directions
        hist, _ = np.histogram(directions.flatten(), bins=36, range=(-np.pi, np.pi))
        hist = hist / np.sum(hist)
        
        # Calculate entropy (higher entropy = more consistent/natural)
        entropy = -np.sum(hist * np.log2(hist + 1e-10))
        
        # Normalize to 0-1 (max entropy for 36 bins is log2(36) ≈ 5.17)
        consistency = entropy / 5.17
        
        return float(consistency)


class DocumentTamperingDetector:
    """
    Main document tampering detection service
    Combines multiple forensic analysis techniques
    """
    
    def __init__(self):
        self.ela_analyzer = ErrorLevelAnalyzer()
        self.noise_analyzer = NoiseAnalyzer()
        self.copy_move_detector = CopyMoveDetector()
        self.edge_analyzer = EdgeConsistencyAnalyzer()
        
        # Weights for combining scores
        self.weights = {
            "ela": 0.25,
            "noise": 0.20,
            "copy_move": 0.25,
            "edge": 0.15,
            "metadata": 0.15
        }
        
        # Thresholds for risk levels
        self.risk_thresholds = {
            RiskLevel.LOW: 0.3,
            RiskLevel.MEDIUM: 0.5,
            RiskLevel.HIGH: 0.7,
            RiskLevel.CRITICAL: 0.85
        }
    
    def analyze_document(self, image: np.ndarray, document_id: str = None) -> TamperingResult:
        """
        Perform comprehensive tampering analysis on document
        """
        start_time = datetime.utcnow()
        
        if document_id is None:
            document_id = str(uuid.uuid4())
        
        analysis_details = {}
        tampering_types = []
        
        # Error Level Analysis
        ela_score, ela_image = self.ela_analyzer.analyze(image)
        analysis_details["ela"] = {
            "score": ela_score,
            "description": "Error Level Analysis for digital manipulation"
        }
        if ela_score > 0.6:
            tampering_types.append(TamperingType.DIGITAL_MANIPULATION)
        
        # Noise Analysis
        noise_score, noise_details = self.noise_analyzer.analyze(image)
        analysis_details["noise"] = {
            "score": noise_score,
            "details": noise_details,
            "description": "Noise pattern consistency analysis"
        }
        if noise_score > 0.6:
            tampering_types.append(TamperingType.SPLICING)
        
        # Copy-Move Detection
        copy_move_score, copy_move_regions = self.copy_move_detector.detect(image)
        analysis_details["copy_move"] = {
            "score": copy_move_score,
            "regions_detected": len(copy_move_regions),
            "description": "Copy-move forgery detection"
        }
        if copy_move_score > 0.3:
            tampering_types.append(TamperingType.COPY_MOVE_FORGERY)
        
        # Edge Consistency Analysis
        edge_score, edge_details = self.edge_analyzer.analyze(image)
        analysis_details["edge"] = {
            "score": edge_score,
            "details": edge_details,
            "description": "Edge consistency analysis"
        }
        if edge_score > 0.6:
            tampering_types.append(TamperingType.PHOTO_REPLACEMENT)
        
        # Calculate overall score
        overall_score = (
            ela_score * self.weights["ela"] +
            noise_score * self.weights["noise"] +
            copy_move_score * self.weights["copy_move"] +
            edge_score * self.weights["edge"]
        )
        
        # Normalize
        weight_sum = sum(self.weights[k] for k in ["ela", "noise", "copy_move", "edge"])
        overall_score = overall_score / weight_sum
        
        # Determine risk level
        risk_level = self._determine_risk_level(overall_score)
        
        # Generate recommendations
        recommendations = self._generate_recommendations(
            overall_score, tampering_types, analysis_details
        )
        
        # Calculate processing time
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        
        return TamperingResult(
            id=str(uuid.uuid4()),
            document_id=document_id,
            is_tampered=overall_score > 0.5,
            confidence=1.0 - abs(overall_score - 0.5) * 2,  # Higher confidence at extremes
            risk_level=risk_level,
            tampering_types=tampering_types,
            analysis_details=analysis_details,
            recommendations=recommendations,
            processing_time=processing_time,
            timestamp=datetime.utcnow()
        )
    
    def _determine_risk_level(self, score: float) -> RiskLevel:
        """Determine risk level based on overall score"""
        if score >= self.risk_thresholds[RiskLevel.CRITICAL]:
            return RiskLevel.CRITICAL
        elif score >= self.risk_thresholds[RiskLevel.HIGH]:
            return RiskLevel.HIGH
        elif score >= self.risk_thresholds[RiskLevel.MEDIUM]:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW
    
    def _generate_recommendations(
        self,
        score: float,
        tampering_types: List[TamperingType],
        details: Dict[str, Any]
    ) -> List[str]:
        """Generate recommendations based on analysis"""
        recommendations = []
        
        if score > 0.7:
            recommendations.append("REJECT: High probability of document tampering detected")
            recommendations.append("Request original physical document for manual verification")
        elif score > 0.5:
            recommendations.append("MANUAL REVIEW: Moderate tampering indicators detected")
            recommendations.append("Request additional supporting documents")
        elif score > 0.3:
            recommendations.append("CAUTION: Minor anomalies detected, proceed with additional verification")
        else:
            recommendations.append("PASS: Document appears authentic")
        
        if TamperingType.PHOTO_REPLACEMENT in tampering_types:
            recommendations.append("Photo area shows signs of manipulation - verify with video KYC")
        
        if TamperingType.COPY_MOVE_FORGERY in tampering_types:
            recommendations.append("Copy-move forgery detected - document may have duplicated regions")
        
        if TamperingType.DIGITAL_MANIPULATION in tampering_types:
            recommendations.append("Digital editing detected - request original unedited document")
        
        return recommendations


# Flask Application
app = Flask(__name__)
CORS(app)

detector = DocumentTamperingDetector()


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'document-tampering-detection',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    })


@app.route('/analyze', methods=['POST'])
def analyze_document():
    """Analyze document for tampering"""
    try:
        data = request.get_json()
        
        if not data or 'image' not in data:
            return jsonify({'error': 'Missing image data'}), 400
        
        # Decode base64 image
        import base64
        image_data = base64.b64decode(data['image'])
        nparr = np.frombuffer(image_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            return jsonify({'error': 'Invalid image data'}), 400
        
        document_id = data.get('document_id')
        
        # Perform analysis
        result = detector.analyze_document(image, document_id)
        
        return jsonify({
            'success': True,
            'result': asdict(result)
        })
        
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/batch-analyze', methods=['POST'])
def batch_analyze():
    """Analyze multiple documents"""
    try:
        data = request.get_json()
        
        if not data or 'images' not in data:
            return jsonify({'error': 'Missing images data'}), 400
        
        results = []
        
        for item in data['images']:
            import base64
            image_data = base64.b64decode(item['image'])
            nparr = np.frombuffer(image_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is not None:
                result = detector.analyze_document(image, item.get('document_id'))
                results.append(asdict(result))
        
        return jsonify({
            'success': True,
            'results': results,
            'total_analyzed': len(results)
        })
        
    except Exception as e:
        logger.error(f"Batch analysis failed: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', 8088))
    app.run(host='0.0.0.0', port=port, debug=False)
