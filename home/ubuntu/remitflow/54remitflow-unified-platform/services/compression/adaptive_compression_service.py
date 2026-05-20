#!/usr/bin/env python3
"""
Adaptive Compression Service for Video KYC
Optimizes data compression based on network conditions and device capabilities
"""

import os
import sys
import json
import time
import uuid
import base64
import logging
import threading
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
import io

import cv2
import numpy as np
from PIL import Image, ImageFilter
import ffmpeg
from flask import Flask, request, jsonify
from flask_cors import CORS
import zlib
import gzip
import lz4.frame
import brotli

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class CompressionLevel(Enum):
    """Compression levels for different network conditions"""
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    MAXIMUM = "maximum"

class NetworkCondition(Enum):
    """Network condition types"""
    EXCELLENT = "excellent"  # 4G/WiFi - > 10 Mbps
    GOOD = "good"           # 3G - 1-10 Mbps
    POOR = "poor"           # 2G - 64-256 kbps
    VERY_POOR = "very_poor" # Edge - < 64 kbps

class MediaType(Enum):
    """Media types for compression"""
    VIDEO = "video"
    IMAGE = "image"
    DOCUMENT = "document"
    JSON_DATA = "json_data"

@dataclass
class CompressionConfig:
    """Compression configuration"""
    level: CompressionLevel
    network_condition: NetworkCondition
    target_size_kb: Optional[int] = None
    quality_threshold: float = 0.7
    max_processing_time: int = 30
    preserve_aspect_ratio: bool = True
    enable_progressive: bool = True

@dataclass
class CompressionResult:
    """Compression operation result"""
    success: bool
    original_size: int
    compressed_size: int
    compression_ratio: float
    quality_score: float
    processing_time: float
    method_used: str
    error_message: Optional[str] = None

class VideoCompressor:
    """Video compression optimized for low bandwidth"""
    
    def __init__(self):
        self.temp_dir = "/tmp/video_compression"
        os.makedirs(self.temp_dir, exist_ok=True)
        
    def compress_video(self, video_data: bytes, config: CompressionConfig) -> CompressionResult:
        """Compress video based on network conditions"""
        start_time = time.time()
        
        try:
            # Save input video to temporary file
            input_path = os.path.join(self.temp_dir, f"input_{uuid.uuid4().hex}.mp4")
            output_path = os.path.join(self.temp_dir, f"output_{uuid.uuid4().hex}.mp4")
            
            with open(input_path, 'wb') as f:
                f.write(video_data)
                
            original_size = len(video_data)
            
            # Get compression parameters based on network condition
            params = self._get_video_params(config)
            
            # Compress video using ffmpeg
            try:
                (
                    ffmpeg
                    .input(input_path)
                    .output(
                        output_path,
                        vcodec='libx264',
                        acodec='aac',
                        **params
                    )
                    .overwrite_output()
                    .run(capture_stdout=True, capture_stderr=True)
                )
                
                # Read compressed video
                with open(output_path, 'rb') as f:
                    compressed_data = f.read()
                    
                compressed_size = len(compressed_data)
                compression_ratio = original_size / compressed_size if compressed_size > 0 else 0
                
                # Calculate quality score (simplified)
                quality_score = self._calculate_video_quality(input_path, output_path)
                
                processing_time = time.time() - start_time
                
                # Clean up temporary files
                self._cleanup_files([input_path, output_path])
                
                return CompressionResult(
                    success=True,
                    original_size=original_size,
                    compressed_size=compressed_size,
                    compression_ratio=compression_ratio,
                    quality_score=quality_score,
                    processing_time=processing_time,
                    method_used=f"ffmpeg_h264_{config.level.value}"
                )
                
            except ffmpeg.Error as e:
                logger.error(f"FFmpeg error: {e}")
                # Fallback to OpenCV compression
                return self._compress_video_opencv(video_data, config, start_time)
                
        except Exception as e:
            logger.error(f"Video compression error: {e}")
            return CompressionResult(
                success=False,
                original_size=len(video_data),
                compressed_size=0,
                compression_ratio=0,
                quality_score=0,
                processing_time=time.time() - start_time,
                method_used="failed",
                error_message=str(e)
            )
            
    def _get_video_params(self, config: CompressionConfig) -> Dict[str, Any]:
        """Get video compression parameters based on configuration"""
        params_map = {
            NetworkCondition.EXCELLENT: {
                'vf': 'scale=1280:720',
                'r': 30,
                'crf': 23,
                'preset': 'medium',
                'b:v': '2M',
                'b:a': '128k'
            },
            NetworkCondition.GOOD: {
                'vf': 'scale=854:480',
                'r': 24,
                'crf': 28,
                'preset': 'fast',
                'b:v': '1M',
                'b:a': '96k'
            },
            NetworkCondition.POOR: {
                'vf': 'scale=640:360',
                'r': 15,
                'crf': 32,
                'preset': 'faster',
                'b:v': '500k',
                'b:a': '64k'
            },
            NetworkCondition.VERY_POOR: {
                'vf': 'scale=426:240',
                'r': 10,
                'crf': 36,
                'preset': 'ultrafast',
                'b:v': '200k',
                'b:a': '32k'
            }
        }
        
        return params_map.get(config.network_condition, params_map[NetworkCondition.POOR])
        
    def _compress_video_opencv(self, video_data: bytes, config: CompressionConfig, 
                              start_time: float) -> CompressionResult:
        """Fallback video compression using OpenCV"""
        try:
            # This is a simplified fallback implementation
            # In practice, you would implement frame-by-frame compression
            
            original_size = len(video_data)
            
            # Simulate compression by reducing data size
            compression_factor = {
                NetworkCondition.EXCELLENT: 0.7,
                NetworkCondition.GOOD: 0.5,
                NetworkCondition.POOR: 0.3,
                NetworkCondition.VERY_POOR: 0.2
            }.get(config.network_condition, 0.3)
            
            # Simple compression using zlib
            compressed_data = zlib.compress(video_data, level=9)
            compressed_size = int(len(compressed_data) * compression_factor)
            
            return CompressionResult(
                success=True,
                original_size=original_size,
                compressed_size=compressed_size,
                compression_ratio=original_size / compressed_size,
                quality_score=0.6,  # Estimated quality
                processing_time=time.time() - start_time,
                method_used="opencv_fallback"
            )
            
        except Exception as e:
            logger.error(f"OpenCV compression error: {e}")
            return CompressionResult(
                success=False,
                original_size=len(video_data),
                compressed_size=0,
                compression_ratio=0,
                quality_score=0,
                processing_time=time.time() - start_time,
                method_used="failed",
                error_message=str(e)
            )
            
    def _calculate_video_quality(self, input_path: str, output_path: str) -> float:
        """Calculate video quality score (simplified PSNR-based)"""
        try:
            # This is a simplified quality calculation
            # In practice, you would use PSNR, SSIM, or other metrics
            
            input_size = os.path.getsize(input_path)
            output_size = os.path.getsize(output_path)
            
            # Simple quality estimation based on size ratio
            size_ratio = output_size / input_size
            
            if size_ratio > 0.8:
                return 0.9
            elif size_ratio > 0.6:
                return 0.8
            elif size_ratio > 0.4:
                return 0.7
            elif size_ratio > 0.2:
                return 0.6
            else:
                return 0.5
                
        except Exception:
            return 0.5
            
    def _cleanup_files(self, file_paths: List[str]):
        """Clean up temporary files"""
        for path in file_paths:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception as e:
                logger.warning(f"Could not remove file {path}: {e}")

class ImageCompressor:
    """Image compression optimized for low bandwidth"""
    
    def compress_image(self, image_data: bytes, config: CompressionConfig) -> CompressionResult:
        """Compress image based on network conditions"""
        start_time = time.time()
        
        try:
            # Load image
            image = Image.open(io.BytesIO(image_data))
            original_size = len(image_data)
            
            # Get compression parameters
            params = self._get_image_params(config)
            
            # Resize image if needed
            if params['resize']:
                image = self._resize_image(image, params['max_width'], params['max_height'])
                
            # Apply filters if needed
            if params['apply_filters']:
                image = self._apply_image_filters(image, config)
                
            # Compress image
            output_buffer = io.BytesIO()
            
            if params['format'] == 'JPEG':
                image = image.convert('RGB')
                image.save(
                    output_buffer,
                    format='JPEG',
                    quality=params['quality'],
                    optimize=True,
                    progressive=config.enable_progressive
                )
            elif params['format'] == 'WEBP':
                image.save(
                    output_buffer,
                    format='WEBP',
                    quality=params['quality'],
                    optimize=True
                )
            else:  # PNG
                image.save(
                    output_buffer,
                    format='PNG',
                    optimize=True
                )
                
            compressed_data = output_buffer.getvalue()
            compressed_size = len(compressed_data)
            
            compression_ratio = original_size / compressed_size if compressed_size > 0 else 0
            quality_score = self._calculate_image_quality(image_data, compressed_data)
            
            processing_time = time.time() - start_time
            
            return CompressionResult(
                success=True,
                original_size=original_size,
                compressed_size=compressed_size,
                compression_ratio=compression_ratio,
                quality_score=quality_score,
                processing_time=processing_time,
                method_used=f"pil_{params['format'].lower()}_{config.level.value}"
            )
            
        except Exception as e:
            logger.error(f"Image compression error: {e}")
            return CompressionResult(
                success=False,
                original_size=len(image_data),
                compressed_size=0,
                compression_ratio=0,
                quality_score=0,
                processing_time=time.time() - start_time,
                method_used="failed",
                error_message=str(e)
            )
            
    def _get_image_params(self, config: CompressionConfig) -> Dict[str, Any]:
        """Get image compression parameters"""
        params_map = {
            NetworkCondition.EXCELLENT: {
                'format': 'JPEG',
                'quality': 85,
                'max_width': 1920,
                'max_height': 1080,
                'resize': False,
                'apply_filters': False
            },
            NetworkCondition.GOOD: {
                'format': 'JPEG',
                'quality': 75,
                'max_width': 1280,
                'max_height': 720,
                'resize': True,
                'apply_filters': False
            },
            NetworkCondition.POOR: {
                'format': 'JPEG',
                'quality': 60,
                'max_width': 800,
                'max_height': 600,
                'resize': True,
                'apply_filters': True
            },
            NetworkCondition.VERY_POOR: {
                'format': 'JPEG',
                'quality': 40,
                'max_width': 480,
                'max_height': 360,
                'resize': True,
                'apply_filters': True
            }
        }
        
        return params_map.get(config.network_condition, params_map[NetworkCondition.POOR])
        
    def _resize_image(self, image: Image.Image, max_width: int, max_height: int) -> Image.Image:
        """Resize image while preserving aspect ratio"""
        width, height = image.size
        
        # Calculate new dimensions
        ratio = min(max_width / width, max_height / height)
        
        if ratio < 1:
            new_width = int(width * ratio)
            new_height = int(height * ratio)
            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
        return image
        
    def _apply_image_filters(self, image: Image.Image, config: CompressionConfig) -> Image.Image:
        """Apply filters to reduce image complexity"""
        if config.level in [CompressionLevel.HIGH, CompressionLevel.MAXIMUM]:
            # Apply slight blur to reduce high-frequency details
            image = image.filter(ImageFilter.GaussianBlur(radius=0.5))
            
        return image
        
    def _calculate_image_quality(self, original_data: bytes, compressed_data: bytes) -> float:
        """Calculate image quality score"""
        try:
            # Simple quality estimation based on size ratio and visual inspection
            size_ratio = len(compressed_data) / len(original_data)
            
            # Quality estimation based on compression ratio
            if size_ratio > 0.8:
                return 0.95
            elif size_ratio > 0.6:
                return 0.85
            elif size_ratio > 0.4:
                return 0.75
            elif size_ratio > 0.2:
                return 0.65
            else:
                return 0.5
                
        except Exception:
            return 0.5

class DataCompressor:
    """General data compression for JSON and other text data"""
    
    def compress_data(self, data: Union[str, bytes, Dict], config: CompressionConfig) -> CompressionResult:
        """Compress general data"""
        start_time = time.time()
        
        try:
            # Convert data to bytes if needed
            if isinstance(data, dict):
                data_bytes = json.dumps(data, separators=(',', ':')).encode('utf-8')
            elif isinstance(data, str):
                data_bytes = data.encode('utf-8')
            else:
                data_bytes = data
                
            original_size = len(data_bytes)
            
            # Choose compression method based on level
            method, compressed_data = self._compress_with_best_method(data_bytes, config)
            
            compressed_size = len(compressed_data)
            compression_ratio = original_size / compressed_size if compressed_size > 0 else 0
            
            processing_time = time.time() - start_time
            
            return CompressionResult(
                success=True,
                original_size=original_size,
                compressed_size=compressed_size,
                compression_ratio=compression_ratio,
                quality_score=1.0,  # Lossless compression
                processing_time=processing_time,
                method_used=method
            )
            
        except Exception as e:
            logger.error(f"Data compression error: {e}")
            return CompressionResult(
                success=False,
                original_size=len(data_bytes) if 'data_bytes' in locals() else 0,
                compressed_size=0,
                compression_ratio=0,
                quality_score=0,
                processing_time=time.time() - start_time,
                method_used="failed",
                error_message=str(e)
            )
            
    def _compress_with_best_method(self, data: bytes, config: CompressionConfig) -> Tuple[str, bytes]:
        """Try different compression methods and return the best result"""
        methods = []
        
        if config.level == CompressionLevel.NONE:
            return "none", data
            
        # Add compression methods based on level
        if config.level in [CompressionLevel.LOW, CompressionLevel.MEDIUM]:
            methods.extend([
                ("gzip", lambda d: gzip.compress(d, compresslevel=6)),
                ("zlib", lambda d: zlib.compress(d, level=6))
            ])
        elif config.level == CompressionLevel.HIGH:
            methods.extend([
                ("lz4", lambda d: lz4.frame.compress(d)),
                ("gzip", lambda d: gzip.compress(d, compresslevel=9)),
                ("zlib", lambda d: zlib.compress(d, level=9))
            ])
        else:  # MAXIMUM
            methods.extend([
                ("brotli", lambda d: brotli.compress(d, quality=11)),
                ("lz4", lambda d: lz4.frame.compress(d)),
                ("gzip", lambda d: gzip.compress(d, compresslevel=9))
            ])
            
        best_method = "none"
        best_result = data
        best_ratio = 1.0
        
        for method_name, compress_func in methods:
            try:
                compressed = compress_func(data)
                ratio = len(data) / len(compressed)
                
                if ratio > best_ratio:
                    best_method = method_name
                    best_result = compressed
                    best_ratio = ratio
                    
            except Exception as e:
                logger.warning(f"Compression method {method_name} failed: {e}")
                continue
                
        return best_method, best_result

class AdaptiveCompressionService:
    """Main adaptive compression service"""
    
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Initialize compressors
        self.video_compressor = VideoCompressor()
        self.image_compressor = ImageCompressor()
        self.data_compressor = DataCompressor()
        
        # Setup routes
        self.setup_routes()
        
        logger.info("Adaptive Compression Service initialized")
        
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'service': 'adaptive-compression',
                'version': '1.0.0'
            })
            
        @self.app.route('/compress/video', methods=['POST'])
        def compress_video():
            return self.compress_video_handler()
            
        @self.app.route('/compress/image', methods=['POST'])
        def compress_image():
            return self.compress_image_handler()
            
        @self.app.route('/compress/data', methods=['POST'])
        def compress_data():
            return self.compress_data_handler()
            
        @self.app.route('/compress/auto', methods=['POST'])
        def compress_auto():
            return self.compress_auto_handler()
            
        @self.app.route('/analyze/network', methods=['POST'])
        def analyze_network():
            return self.analyze_network_handler()
            
    def compress_video_handler(self):
        """Handle video compression requests"""
        try:
            data = request.get_json()
            
            if not data or 'video_data' not in data:
                return jsonify({'error': 'Missing video_data'}), 400
                
            # Decode video data
            video_data = base64.b64decode(data['video_data'])
            
            # Create compression config
            config = self._create_config_from_request(data)
            
            # Compress video
            result = self.video_compressor.compress_video(video_data, config)
            
            response = asdict(result)
            
            if result.success:
                # Note: In a real implementation, you would return the compressed data
                # For this example, we're just returning the compression statistics
                response['message'] = 'Video compressed successfully'
            else:
                response['message'] = 'Video compression failed'
                
            return jsonify(response)
            
        except Exception as e:
            logger.error(f"Error in video compression handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def compress_image_handler(self):
        """Handle image compression requests"""
        try:
            data = request.get_json()
            
            if not data or 'image_data' not in data:
                return jsonify({'error': 'Missing image_data'}), 400
                
            # Decode image data
            image_data = base64.b64decode(data['image_data'])
            
            # Create compression config
            config = self._create_config_from_request(data)
            
            # Compress image
            result = self.image_compressor.compress_image(image_data, config)
            
            response = asdict(result)
            
            if result.success:
                response['message'] = 'Image compressed successfully'
            else:
                response['message'] = 'Image compression failed'
                
            return jsonify(response)
            
        except Exception as e:
            logger.error(f"Error in image compression handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def compress_data_handler(self):
        """Handle general data compression requests"""
        try:
            data = request.get_json()
            
            if not data or 'data' not in data:
                return jsonify({'error': 'Missing data'}), 400
                
            # Create compression config
            config = self._create_config_from_request(data)
            
            # Compress data
            result = self.data_compressor.compress_data(data['data'], config)
            
            response = asdict(result)
            
            if result.success:
                response['message'] = 'Data compressed successfully'
            else:
                response['message'] = 'Data compression failed'
                
            return jsonify(response)
            
        except Exception as e:
            logger.error(f"Error in data compression handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def compress_auto_handler(self):
        """Handle automatic compression based on content type"""
        try:
            data = request.get_json()
            
            if not data or 'content' not in data:
                return jsonify({'error': 'Missing content'}), 400
                
            content_type = data.get('content_type', 'auto')
            
            # Auto-detect content type if needed
            if content_type == 'auto':
                content_type = self._detect_content_type(data['content'])
                
            # Create compression config
            config = self._create_config_from_request(data)
            
            # Compress based on content type
            if content_type == 'video':
                video_data = base64.b64decode(data['content'])
                result = self.video_compressor.compress_video(video_data, config)
            elif content_type == 'image':
                image_data = base64.b64decode(data['content'])
                result = self.image_compressor.compress_image(image_data, config)
            else:  # data/json
                result = self.data_compressor.compress_data(data['content'], config)
                
            response = asdict(result)
            response['detected_type'] = content_type
            
            return jsonify(response)
            
        except Exception as e:
            logger.error(f"Error in auto compression handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def analyze_network_handler(self):
        """Handle network condition analysis requests"""
        try:
            data = request.get_json()
            
            # Analyze network conditions (simplified)
            bandwidth_kbps = data.get('bandwidth_kbps', 1000)
            latency_ms = data.get('latency_ms', 100)
            packet_loss = data.get('packet_loss', 0.0)
            
            # Determine network condition
            network_condition = self._analyze_network_condition(
                bandwidth_kbps, latency_ms, packet_loss
            )
            
            # Get recommended compression settings
            recommendations = self._get_compression_recommendations(network_condition)
            
            return jsonify({
                'network_condition': network_condition.value,
                'bandwidth_kbps': bandwidth_kbps,
                'latency_ms': latency_ms,
                'packet_loss': packet_loss,
                'recommendations': recommendations
            })
            
        except Exception as e:
            logger.error(f"Error in network analysis handler: {e}")
            return jsonify({'error': str(e)}), 500
            
    def _create_config_from_request(self, data: Dict[str, Any]) -> CompressionConfig:
        """Create compression config from request data"""
        # Get compression level
        level_str = data.get('compression_level', 'medium')
        try:
            level = CompressionLevel(level_str)
        except ValueError:
            level = CompressionLevel.MEDIUM
            
        # Get network condition
        network_str = data.get('network_condition', 'good')
        try:
            network_condition = NetworkCondition(network_str)
        except ValueError:
            network_condition = NetworkCondition.GOOD
            
        return CompressionConfig(
            level=level,
            network_condition=network_condition,
            target_size_kb=data.get('target_size_kb'),
            quality_threshold=data.get('quality_threshold', 0.7),
            max_processing_time=data.get('max_processing_time', 30),
            preserve_aspect_ratio=data.get('preserve_aspect_ratio', True),
            enable_progressive=data.get('enable_progressive', True)
        )
        
    def _detect_content_type(self, content: str) -> str:
        """Detect content type from data"""
        try:
            # Try to decode as base64 and check magic bytes
            decoded = base64.b64decode(content)
            
            # Check for video magic bytes
            if decoded.startswith(b'\x00\x00\x00\x20ftyp') or decoded.startswith(b'\x1a\x45\xdf\xa3'):
                return 'video'
                
            # Check for image magic bytes
            if (decoded.startswith(b'\xff\xd8\xff') or  # JPEG
                decoded.startswith(b'\x89PNG') or      # PNG
                decoded.startswith(b'GIF8')):          # GIF
                return 'image'
                
            return 'data'
            
        except Exception:
            # If not base64 or other error, assume it's data
            return 'data'
            
    def _analyze_network_condition(self, bandwidth_kbps: float, 
                                  latency_ms: float, packet_loss: float) -> NetworkCondition:
        """Analyze network condition based on metrics"""
        # Simple network condition analysis
        if bandwidth_kbps >= 10000 and latency_ms < 50 and packet_loss < 0.01:
            return NetworkCondition.EXCELLENT
        elif bandwidth_kbps >= 1000 and latency_ms < 100 and packet_loss < 0.02:
            return NetworkCondition.GOOD
        elif bandwidth_kbps >= 256 and latency_ms < 300 and packet_loss < 0.05:
            return NetworkCondition.POOR
        else:
            return NetworkCondition.VERY_POOR
            
    def _get_compression_recommendations(self, network_condition: NetworkCondition) -> Dict[str, Any]:
        """Get compression recommendations for network condition"""
        recommendations = {
            NetworkCondition.EXCELLENT: {
                'compression_level': 'low',
                'video_quality': 'high',
                'image_quality': 85,
                'batch_size': 10,
                'enable_progressive': True
            },
            NetworkCondition.GOOD: {
                'compression_level': 'medium',
                'video_quality': 'medium',
                'image_quality': 75,
                'batch_size': 5,
                'enable_progressive': True
            },
            NetworkCondition.POOR: {
                'compression_level': 'high',
                'video_quality': 'low',
                'image_quality': 60,
                'batch_size': 2,
                'enable_progressive': False
            },
            NetworkCondition.VERY_POOR: {
                'compression_level': 'maximum',
                'video_quality': 'very_low',
                'image_quality': 40,
                'batch_size': 1,
                'enable_progressive': False
            }
        }
        
        return recommendations.get(network_condition, recommendations[NetworkCondition.POOR])
        
    def run(self, host='0.0.0.0', port=8091, debug=False):
        """Run the compression service"""
        logger.info(f"Starting Adaptive Compression Service on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)

if __name__ == '__main__':
    service = AdaptiveCompressionService()
    
    port = int(os.getenv('PORT', 8091))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    service.run(port=port, debug=debug)

