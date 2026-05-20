#!/usr/bin/env python3
"""
Edge AI Models for Local Processing
Optimized AI models for face detection, recognition, and liveness detection on edge devices
"""

import os
import sys
import json
import time
import uuid
import numpy as np
import cv2
import threading
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
from pathlib import Path
import pickle
import gzip

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import transforms
import onnx
import onnxruntime as ort
from flask import Flask, request, jsonify
from flask_cors import CORS

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class ModelType(Enum):
    """AI model types"""
    FACE_DETECTION = "face_detection"
    FACE_RECOGNITION = "face_recognition"
    LIVENESS_DETECTION = "liveness_detection"
    EMOTION_RECOGNITION = "emotion_recognition"
    AGE_ESTIMATION = "age_estimation"
    GENDER_CLASSIFICATION = "gender_classification"

class ModelFormat(Enum):
    """Model formats"""
    PYTORCH = "pytorch"
    ONNX = "onnx"
    TFLITE = "tflite"
    OPENVINO = "openvino"

@dataclass
class ModelInfo:
    """Model information"""
    name: str
    type: ModelType
    format: ModelFormat
    version: str
    file_path: str
    input_shape: Tuple[int, ...]
    output_shape: Tuple[int, ...]
    accuracy: float
    inference_time_ms: float
    model_size_mb: float
    quantized: bool
    device: str

@dataclass
class DetectionResult:
    """Face detection result"""
    bbox: Tuple[int, int, int, int]  # x, y, width, height
    confidence: float
    landmarks: Optional[List[Tuple[int, int]]]
    attributes: Dict[str, Any]

@dataclass
class RecognitionResult:
    """Face recognition result"""
    embedding: np.ndarray
    confidence: float
    identity: Optional[str]
    similarity_score: Optional[float]

@dataclass
class LivenessResult:
    """Liveness detection result"""
    is_live: bool
    confidence: float
    spoofing_type: Optional[str]
    quality_score: float

class LightweightFaceDetector(nn.Module):
    """Lightweight face detection model optimized for edge devices"""
    
    def __init__(self, num_classes=2, input_size=320):
        super(LightweightFaceDetector, self).__init__()
        self.input_size = input_size
        
        # Backbone - MobileNetV2 inspired
        self.backbone = nn.Sequential(
            # Initial conv
            nn.Conv2d(3, 32, 3, stride=2, padding=1, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU6(inplace=True),
            
            # Depthwise separable convolutions
            self._make_layer(32, 64, 1),
            self._make_layer(64, 128, 2),
            self._make_layer(128, 128, 1),
            self._make_layer(128, 256, 2),
            self._make_layer(256, 256, 1),
            self._make_layer(256, 512, 2),
            
            # Final layers
            nn.AdaptiveAvgPool2d((1, 1)),
            nn.Conv2d(512, 1024, 1, bias=False),
            nn.BatchNorm2d(1024),
            nn.ReLU6(inplace=True)
        )
        
        # Detection head
        self.detection_head = nn.Sequential(
            nn.Conv2d(1024, 256, 3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(256, 128, 3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(128, num_classes + 4, 1)  # classes + bbox
        )
        
    def _make_layer(self, in_channels, out_channels, stride):
        """Create depthwise separable convolution layer"""
        return nn.Sequential(
            # Depthwise
            nn.Conv2d(in_channels, in_channels, 3, stride=stride, 
                     padding=1, groups=in_channels, bias=False),
            nn.BatchNorm2d(in_channels),
            nn.ReLU6(inplace=True),
            
            # Pointwise
            nn.Conv2d(in_channels, out_channels, 1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU6(inplace=True)
        )
        
    def forward(self, x):
        features = self.backbone(x)
        detections = self.detection_head(features)
        return detections

class CompactFaceRecognizer(nn.Module):
    """Compact face recognition model for edge deployment"""
    
    def __init__(self, embedding_size=128):
        super(CompactFaceRecognizer, self).__init__()
        self.embedding_size = embedding_size
        
        # Feature extractor
        self.features = nn.Sequential(
            # Block 1
            nn.Conv2d(3, 64, 3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2),
            
            # Block 2
            nn.Conv2d(64, 128, 3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2),
            
            # Block 3
            nn.Conv2d(128, 256, 3, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2),
            
            # Block 4
            nn.Conv2d(256, 512, 3, padding=1),
            nn.BatchNorm2d(512),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d((4, 4))
        )
        
        # Embedding layer
        self.embedding = nn.Sequential(
            nn.Linear(512 * 4 * 4, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.5),
            nn.Linear(512, embedding_size)
        )
        
    def forward(self, x):
        features = self.features(x)
        features = features.view(features.size(0), -1)
        embedding = self.embedding(features)
        # L2 normalize
        embedding = F.normalize(embedding, p=2, dim=1)
        return embedding

class EdgeLivenessDetector(nn.Module):
    """Edge-optimized liveness detection model"""
    
    def __init__(self, num_classes=2):
        super(EdgeLivenessDetector, self).__init__()
        
        # Temporal feature extractor
        self.temporal_conv = nn.Sequential(
            nn.Conv3d(3, 32, (3, 3, 3), padding=(1, 1, 1)),
            nn.BatchNorm3d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool3d((1, 2, 2)),
            
            nn.Conv3d(32, 64, (3, 3, 3), padding=(1, 1, 1)),
            nn.BatchNorm3d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool3d((1, 2, 2)),
            
            nn.Conv3d(64, 128, (3, 3, 3), padding=(1, 1, 1)),
            nn.BatchNorm3d(128),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool3d((1, 4, 4))
        )
        
        # Classifier
        self.classifier = nn.Sequential(
            nn.Linear(128 * 4 * 4, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.5),
            nn.Linear(256, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(64, num_classes)
        )
        
    def forward(self, x):
        # x shape: (batch, channels, frames, height, width)
        features = self.temporal_conv(x)
        features = features.view(features.size(0), -1)
        output = self.classifier(features)
        return output

class ModelOptimizer:
    """Model optimization for edge deployment"""
    
    def __init__(self):
        self.optimization_techniques = [
            'quantization',
            'pruning',
            'knowledge_distillation',
            'onnx_conversion'
        ]
        
    def quantize_model(self, model: nn.Module, calibration_data: torch.Tensor) -> nn.Module:
        """Quantize model to INT8"""
        try:
            # Prepare model for quantization
            model.eval()
            model.qconfig = torch.quantization.get_default_qconfig('fbgemm')
            
            # Prepare for quantization
            prepared_model = torch.quantization.prepare(model, inplace=False)
            
            # Calibrate with sample data
            with torch.no_grad():
                for data in calibration_data:
                    prepared_model(data)
                    
            # Convert to quantized model
            quantized_model = torch.quantization.convert(prepared_model, inplace=False)
            
            logger.info("Model quantization completed")
            return quantized_model
            
        except Exception as e:
            logger.error(f"Error quantizing model: {e}")
            return model
            
    def prune_model(self, model: nn.Module, pruning_ratio: float = 0.3) -> nn.Module:
        """Prune model weights"""
        try:
            import torch.nn.utils.prune as prune
            
            # Apply structured pruning to conv layers
            for name, module in model.named_modules():
                if isinstance(module, nn.Conv2d):
                    prune.ln_structured(module, name='weight', 
                                      amount=pruning_ratio, n=2, dim=0)
                elif isinstance(module, nn.Linear):
                    prune.l1_unstructured(module, name='weight', 
                                        amount=pruning_ratio)
                                        
            logger.info(f"Model pruning completed with ratio {pruning_ratio}")
            return model
            
        except Exception as e:
            logger.error(f"Error pruning model: {e}")
            return model
            
    def convert_to_onnx(self, model: nn.Module, input_shape: Tuple[int, ...], 
                       output_path: str) -> bool:
        """Convert PyTorch model to ONNX"""
        try:
            model.eval()
            dummy_input = torch.randn(1, *input_shape)
            
            torch.onnx.export(
                model,
                dummy_input,
                output_path,
                export_params=True,
                opset_version=11,
                do_constant_folding=True,
                input_names=['input'],
                output_names=['output'],
                dynamic_axes={
                    'input': {0: 'batch_size'},
                    'output': {0: 'batch_size'}
                }
            )
            
            logger.info(f"Model converted to ONNX: {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error converting to ONNX: {e}")
            return False
            
    def optimize_for_edge(self, model: nn.Module, input_shape: Tuple[int, ...],
                         calibration_data: Optional[torch.Tensor] = None) -> Dict[str, Any]:
        """Complete optimization pipeline for edge deployment"""
        try:
            results = {}
            
            # Original model size
            original_size = self._get_model_size(model)
            results['original_size_mb'] = original_size
            
            # Quantization
            if calibration_data is not None:
                quantized_model = self.quantize_model(model, calibration_data)
                quantized_size = self._get_model_size(quantized_model)
                results['quantized_size_mb'] = quantized_size
                results['quantization_ratio'] = quantized_size / original_size
            
            # Pruning
            pruned_model = self.prune_model(model.copy() if hasattr(model, 'copy') else model)
            pruned_size = self._get_model_size(pruned_model)
            results['pruned_size_mb'] = pruned_size
            results['pruning_ratio'] = pruned_size / original_size
            
            # ONNX conversion
            onnx_path = f"/tmp/optimized_model_{uuid.uuid4().hex}.onnx"
            if self.convert_to_onnx(model, input_shape, onnx_path):
                onnx_size = os.path.getsize(onnx_path) / (1024 * 1024)
                results['onnx_size_mb'] = onnx_size
                results['onnx_path'] = onnx_path
                
            return results
            
        except Exception as e:
            logger.error(f"Error in edge optimization: {e}")
            return {}
            
    def _get_model_size(self, model: nn.Module) -> float:
        """Calculate model size in MB"""
        try:
            param_size = 0
            buffer_size = 0
            
            for param in model.parameters():
                param_size += param.nelement() * param.element_size()
                
            for buffer in model.buffers():
                buffer_size += buffer.nelement() * buffer.element_size()
                
            size_mb = (param_size + buffer_size) / (1024 * 1024)
            return size_mb
            
        except Exception as e:
            logger.error(f"Error calculating model size: {e}")
            return 0.0

class EdgeInferenceEngine:
    """Optimized inference engine for edge devices"""
    
    def __init__(self, model_dir: str = "/var/lib/video_kyc/models"):
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        
        self.models = {}
        self.onnx_sessions = {}
        self.device = self._get_optimal_device()
        
        # Load models
        self._load_models()
        
    def _get_optimal_device(self) -> str:
        """Determine optimal device for inference"""
        if torch.cuda.is_available():
            return "cuda"
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            return "mps"
        else:
            return "cpu"
            
    def _load_models(self):
        """Load all available models"""
        try:
            # Load face detection model
            self._load_face_detector()
            
            # Load face recognition model
            self._load_face_recognizer()
            
            # Load liveness detection model
            self._load_liveness_detector()
            
            logger.info(f"Loaded {len(self.models)} models on device: {self.device}")
            
        except Exception as e:
            logger.error(f"Error loading models: {e}")
            
    def _load_face_detector(self):
        """Load face detection model"""
        try:
            model_path = self.model_dir / "face_detector.pth"
            
            if model_path.exists():
                model = LightweightFaceDetector()
                model.load_state_dict(torch.load(model_path, map_location=self.device))
                model.to(self.device)
                model.eval()
                
                self.models[ModelType.FACE_DETECTION] = model
                logger.info("Face detection model loaded")
            else:
                # Create and save a new model
                model = LightweightFaceDetector()
                model.to(self.device)
                model.eval()
                
                torch.save(model.state_dict(), model_path)
                self.models[ModelType.FACE_DETECTION] = model
                logger.info("New face detection model created and saved")
                
        except Exception as e:
            logger.error(f"Error loading face detector: {e}")
            
    def _load_face_recognizer(self):
        """Load face recognition model"""
        try:
            model_path = self.model_dir / "face_recognizer.pth"
            
            if model_path.exists():
                model = CompactFaceRecognizer()
                model.load_state_dict(torch.load(model_path, map_location=self.device))
                model.to(self.device)
                model.eval()
                
                self.models[ModelType.FACE_RECOGNITION] = model
                logger.info("Face recognition model loaded")
            else:
                # Create and save a new model
                model = CompactFaceRecognizer()
                model.to(self.device)
                model.eval()
                
                torch.save(model.state_dict(), model_path)
                self.models[ModelType.FACE_RECOGNITION] = model
                logger.info("New face recognition model created and saved")
                
        except Exception as e:
            logger.error(f"Error loading face recognizer: {e}")
            
    def _load_liveness_detector(self):
        """Load liveness detection model"""
        try:
            model_path = self.model_dir / "liveness_detector.pth"
            
            if model_path.exists():
                model = EdgeLivenessDetector()
                model.load_state_dict(torch.load(model_path, map_location=self.device))
                model.to(self.device)
                model.eval()
                
                self.models[ModelType.LIVENESS_DETECTION] = model
                logger.info("Liveness detection model loaded")
            else:
                # Create and save a new model
                model = EdgeLivenessDetector()
                model.to(self.device)
                model.eval()
                
                torch.save(model.state_dict(), model_path)
                self.models[ModelType.LIVENESS_DETECTION] = model
                logger.info("New liveness detection model created and saved")
                
        except Exception as e:
            logger.error(f"Error loading liveness detector: {e}")
            
    def detect_faces(self, image: np.ndarray, confidence_threshold: float = 0.5) -> List[DetectionResult]:
        """Detect faces in image"""
        try:
            if ModelType.FACE_DETECTION not in self.models:
                return []
                
            model = self.models[ModelType.FACE_DETECTION]
            
            # Preprocess image
            input_tensor = self._preprocess_image(image, (320, 320))
            
            # Inference
            with torch.no_grad():
                outputs = model(input_tensor)
                
            # Post-process results
            detections = self._postprocess_detections(outputs, image.shape, confidence_threshold)
            
            return detections
            
        except Exception as e:
            logger.error(f"Error in face detection: {e}")
            return []
            
    def recognize_face(self, face_image: np.ndarray) -> RecognitionResult:
        """Extract face embedding for recognition"""
        try:
            if ModelType.FACE_RECOGNITION not in self.models:
                return RecognitionResult(
                    embedding=np.zeros(128),
                    confidence=0.0,
                    identity=None,
                    similarity_score=None
                )
                
            model = self.models[ModelType.FACE_RECOGNITION]
            
            # Preprocess face image
            input_tensor = self._preprocess_image(face_image, (112, 112))
            
            # Inference
            with torch.no_grad():
                embedding = model(input_tensor)
                
            # Convert to numpy
            embedding_np = embedding.cpu().numpy().flatten()
            
            return RecognitionResult(
                embedding=embedding_np,
                confidence=1.0,  # Placeholder
                identity=None,
                similarity_score=None
            )
            
        except Exception as e:
            logger.error(f"Error in face recognition: {e}")
            return RecognitionResult(
                embedding=np.zeros(128),
                confidence=0.0,
                identity=None,
                similarity_score=None
            )
            
    def detect_liveness(self, video_frames: List[np.ndarray]) -> LivenessResult:
        """Detect liveness from video frames"""
        try:
            if ModelType.LIVENESS_DETECTION not in self.models:
                return LivenessResult(
                    is_live=True,  # Default to live for safety
                    confidence=0.5,
                    spoofing_type=None,
                    quality_score=0.5
                )
                
            model = self.models[ModelType.LIVENESS_DETECTION]
            
            # Preprocess video frames
            input_tensor = self._preprocess_video(video_frames)
            
            # Inference
            with torch.no_grad():
                outputs = model(input_tensor)
                probabilities = F.softmax(outputs, dim=1)
                
            # Get results
            live_prob = probabilities[0, 1].item()  # Assuming class 1 is live
            is_live = live_prob > 0.5
            
            return LivenessResult(
                is_live=is_live,
                confidence=live_prob if is_live else 1 - live_prob,
                spoofing_type="print_attack" if not is_live else None,
                quality_score=live_prob
            )
            
        except Exception as e:
            logger.error(f"Error in liveness detection: {e}")
            return LivenessResult(
                is_live=True,
                confidence=0.5,
                spoofing_type=None,
                quality_score=0.5
            )
            
    def _preprocess_image(self, image: np.ndarray, target_size: Tuple[int, int]) -> torch.Tensor:
        """Preprocess image for model input"""
        try:
            # Resize image
            resized = cv2.resize(image, target_size)
            
            # Convert BGR to RGB
            if len(resized.shape) == 3:
                resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
                
            # Normalize
            normalized = resized.astype(np.float32) / 255.0
            
            # Convert to tensor
            tensor = torch.from_numpy(normalized).permute(2, 0, 1).unsqueeze(0)
            tensor = tensor.to(self.device)
            
            return tensor
            
        except Exception as e:
            logger.error(f"Error preprocessing image: {e}")
            return torch.zeros(1, 3, *target_size).to(self.device)
            
    def _preprocess_video(self, frames: List[np.ndarray], num_frames: int = 16) -> torch.Tensor:
        """Preprocess video frames for model input"""
        try:
            # Sample frames if too many
            if len(frames) > num_frames:
                indices = np.linspace(0, len(frames) - 1, num_frames, dtype=int)
                frames = [frames[i] for i in indices]
            elif len(frames) < num_frames:
                # Repeat last frame if too few
                while len(frames) < num_frames:
                    frames.append(frames[-1])
                    
            # Preprocess each frame
            processed_frames = []
            for frame in frames:
                resized = cv2.resize(frame, (64, 64))
                if len(resized.shape) == 3:
                    resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
                normalized = resized.astype(np.float32) / 255.0
                processed_frames.append(normalized)
                
            # Stack frames
            video_array = np.stack(processed_frames, axis=0)  # (frames, height, width, channels)
            video_array = video_array.transpose(3, 0, 1, 2)  # (channels, frames, height, width)
            
            # Convert to tensor
            tensor = torch.from_numpy(video_array).unsqueeze(0)  # Add batch dimension
            tensor = tensor.to(self.device)
            
            return tensor
            
        except Exception as e:
            logger.error(f"Error preprocessing video: {e}")
            return torch.zeros(1, 3, num_frames, 64, 64).to(self.device)
            
    def _postprocess_detections(self, outputs: torch.Tensor, image_shape: Tuple[int, ...],
                              confidence_threshold: float) -> List[DetectionResult]:
        """Post-process detection outputs"""
        try:
            detections = []
            
            # Simplified post-processing (in practice, you'd use NMS, etc.)
            batch_size, channels, height, width = outputs.shape
            
            # Reshape outputs
            outputs = outputs.view(batch_size, -1, channels // (height * width))
            
            for detection in outputs[0]:  # Process first batch item
                if len(detection) >= 6:  # class_prob, objectness, x, y, w, h
                    confidence = detection[1].item()
                    
                    if confidence > confidence_threshold:
                        # Extract bbox (simplified)
                        x = int(detection[2].item() * image_shape[1])
                        y = int(detection[3].item() * image_shape[0])
                        w = int(detection[4].item() * image_shape[1])
                        h = int(detection[5].item() * image_shape[0])
                        
                        detections.append(DetectionResult(
                            bbox=(x, y, w, h),
                            confidence=confidence,
                            landmarks=None,
                            attributes={}
                        ))
                        
            return detections
            
        except Exception as e:
            logger.error(f"Error post-processing detections: {e}")
            return []
            
    def get_model_info(self) -> Dict[ModelType, ModelInfo]:
        """Get information about loaded models"""
        info = {}
        
        for model_type, model in self.models.items():
            # Calculate model size
            model_size = sum(p.numel() * p.element_size() for p in model.parameters()) / (1024 * 1024)
            
            info[model_type] = ModelInfo(
                name=f"{model_type.value}_model",
                type=model_type,
                format=ModelFormat.PYTORCH,
                version="1.0.0",
                file_path=str(self.model_dir / f"{model_type.value}.pth"),
                input_shape=(3, 224, 224),  # Placeholder
                output_shape=(1000,),  # Placeholder
                accuracy=0.95,  # Placeholder
                inference_time_ms=50.0,  # Placeholder
                model_size_mb=model_size,
                quantized=False,
                device=self.device
            )
            
        return info
        
    def benchmark_models(self, num_iterations: int = 100) -> Dict[ModelType, Dict[str, float]]:
        """Benchmark model performance"""
        results = {}
        
        for model_type, model in self.models.items():
            try:
                # Create dummy input
                if model_type == ModelType.LIVENESS_DETECTION:
                    dummy_input = torch.randn(1, 3, 16, 64, 64).to(self.device)
                else:
                    dummy_input = torch.randn(1, 3, 224, 224).to(self.device)
                    
                # Warmup
                with torch.no_grad():
                    for _ in range(10):
                        _ = model(dummy_input)
                        
                # Benchmark
                start_time = time.time()
                with torch.no_grad():
                    for _ in range(num_iterations):
                        _ = model(dummy_input)
                        
                end_time = time.time()
                
                avg_time_ms = (end_time - start_time) / num_iterations * 1000
                fps = 1000 / avg_time_ms
                
                results[model_type] = {
                    'avg_inference_time_ms': avg_time_ms,
                    'fps': fps,
                    'iterations': num_iterations
                }
                
            except Exception as e:
                logger.error(f"Error benchmarking {model_type}: {e}")
                results[model_type] = {
                    'avg_inference_time_ms': 0.0,
                    'fps': 0.0,
                    'iterations': 0
                }
                
        return results

class EdgeAIService:
    """Main edge AI service"""
    
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Initialize inference engine
        self.inference_engine = EdgeInferenceEngine()
        self.model_optimizer = ModelOptimizer()
        
        # Setup routes
        self.setup_routes()
        
        logger.info("Edge AI Service initialized")
        
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'service': 'edge-ai-service',
                'version': '1.0.0',
                'device': self.inference_engine.device,
                'models_loaded': len(self.inference_engine.models)
            })
            
        @self.app.route('/models', methods=['GET'])
        def get_models():
            return self.get_models_handler()
            
        @self.app.route('/detect/faces', methods=['POST'])
        def detect_faces():
            return self.detect_faces_handler()
            
        @self.app.route('/recognize/face', methods=['POST'])
        def recognize_face():
            return self.recognize_face_handler()
            
        @self.app.route('/detect/liveness', methods=['POST'])
        def detect_liveness():
            return self.detect_liveness_handler()
            
        @self.app.route('/benchmark', methods=['POST'])
        def benchmark():
            return self.benchmark_handler()
            
        @self.app.route('/optimize', methods=['POST'])
        def optimize():
            return self.optimize_handler()
            
    def get_models_handler(self):
        """Handle get models requests"""
        try:
            model_info = self.inference_engine.get_model_info()
            
            return jsonify({
                'success': True,
                'models': {k.value: asdict(v) for k, v in model_info.items()},
                'total_models': len(model_info)
            })
            
        except Exception as e:
            logger.error(f"Error getting models: {e}")
            return jsonify({'error': str(e)}), 500
            
    def detect_faces_handler(self):
        """Handle face detection requests"""
        try:
            # Get image from request
            if 'image' not in request.files:
                return jsonify({'error': 'No image provided'}), 400
                
            image_file = request.files['image']
            confidence_threshold = float(request.form.get('confidence_threshold', 0.5))
            
            # Read image
            image_bytes = image_file.read()
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return jsonify({'error': 'Invalid image format'}), 400
                
            # Detect faces
            detections = self.inference_engine.detect_faces(image, confidence_threshold)
            
            return jsonify({
                'success': True,
                'detections': [asdict(d) for d in detections],
                'num_faces': len(detections)
            })
            
        except Exception as e:
            logger.error(f"Error in face detection: {e}")
            return jsonify({'error': str(e)}), 500
            
    def recognize_face_handler(self):
        """Handle face recognition requests"""
        try:
            # Get image from request
            if 'image' not in request.files:
                return jsonify({'error': 'No face image provided'}), 400
                
            image_file = request.files['image']
            
            # Read image
            image_bytes = image_file.read()
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return jsonify({'error': 'Invalid image format'}), 400
                
            # Recognize face
            result = self.inference_engine.recognize_face(image)
            
            return jsonify({
                'success': True,
                'embedding': result.embedding.tolist(),
                'confidence': result.confidence,
                'identity': result.identity,
                'similarity_score': result.similarity_score
            })
            
        except Exception as e:
            logger.error(f"Error in face recognition: {e}")
            return jsonify({'error': str(e)}), 500
            
    def detect_liveness_handler(self):
        """Handle liveness detection requests"""
        try:
            # Get video frames from request
            if 'video' not in request.files:
                return jsonify({'error': 'No video provided'}), 400
                
            video_file = request.files['video']
            
            # Read video and extract frames
            video_bytes = video_file.read()
            
            # Save temporarily and read with OpenCV
            temp_path = f"/tmp/temp_video_{uuid.uuid4().hex}.mp4"
            with open(temp_path, 'wb') as f:
                f.write(video_bytes)
                
            # Extract frames
            cap = cv2.VideoCapture(temp_path)
            frames = []
            
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                frames.append(frame)
                
            cap.release()
            os.remove(temp_path)
            
            if not frames:
                return jsonify({'error': 'No frames extracted from video'}), 400
                
            # Detect liveness
            result = self.inference_engine.detect_liveness(frames)
            
            return jsonify({
                'success': True,
                'is_live': result.is_live,
                'confidence': result.confidence,
                'spoofing_type': result.spoofing_type,
                'quality_score': result.quality_score,
                'frames_processed': len(frames)
            })
            
        except Exception as e:
            logger.error(f"Error in liveness detection: {e}")
            return jsonify({'error': str(e)}), 500
            
    def benchmark_handler(self):
        """Handle benchmark requests"""
        try:
            data = request.get_json()
            iterations = data.get('iterations', 100) if data else 100
            
            results = self.inference_engine.benchmark_models(iterations)
            
            return jsonify({
                'success': True,
                'benchmark_results': {k.value: v for k, v in results.items()},
                'device': self.inference_engine.device,
                'iterations': iterations
            })
            
        except Exception as e:
            logger.error(f"Error in benchmarking: {e}")
            return jsonify({'error': str(e)}), 500
            
    def optimize_handler(self):
        """Handle model optimization requests"""
        try:
            data = request.get_json()
            model_type_str = data.get('model_type', 'face_detection')
            
            try:
                model_type = ModelType(model_type_str)
            except ValueError:
                return jsonify({'error': f'Invalid model type: {model_type_str}'}), 400
                
            if model_type not in self.inference_engine.models:
                return jsonify({'error': f'Model not loaded: {model_type_str}'}), 404
                
            model = self.inference_engine.models[model_type]
            
            # Determine input shape based on model type
            if model_type == ModelType.LIVENESS_DETECTION:
                input_shape = (3, 16, 64, 64)
            else:
                input_shape = (3, 224, 224)
                
            # Optimize model
            optimization_results = self.model_optimizer.optimize_for_edge(
                model, input_shape
            )
            
            return jsonify({
                'success': True,
                'optimization_results': optimization_results,
                'model_type': model_type_str
            })
            
        except Exception as e:
            logger.error(f"Error in optimization: {e}")
            return jsonify({'error': str(e)}), 500
            
    def run(self, host='0.0.0.0', port=8095, debug=False):
        """Run the edge AI service"""
        logger.info(f"Starting Edge AI Service on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)

if __name__ == '__main__':
    service = EdgeAIService()
    
    try:
        port = int(os.getenv('PORT', 8095))
        debug = os.getenv('DEBUG', 'false').lower() == 'true'
        
        service.run(port=port, debug=debug)
    except KeyboardInterrupt:
        logger.info("Edge AI Service stopped")

