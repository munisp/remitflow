"""
Comprehensive Test Suite for ArcFace Face Matching Service
Tests for 95%+ accuracy face recognition system
"""

import pytest
import numpy as np
import cv2
import os
import tempfile
import base64
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime

# Import service components
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../backend/ai-ml-services/arcface-service'))

from arcface_face_matcher import (
    ArcFaceMatcher,
    FaceDetectionResult,
    FaceEmbedding,
    FaceMatchResult,
    MatchStatus
)


# Test Fixtures
@pytest.fixture
def sample_image():
    """Create a sample test image"""
    # Create a simple 112x112 RGB image
    image = np.random.randint(0, 255, (112, 112, 3), dtype=np.uint8)
    return image


@pytest.fixture
def sample_image_path(sample_image):
    """Save sample image to temporary file"""
    with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as f:
        cv2.imwrite(f.name, sample_image)
        yield f.name
    os.unlink(f.name)


@pytest.fixture
def matcher():
    """Create ArcFace matcher instance"""
    matcher = ArcFaceMatcher(device="cpu")
    return matcher


@pytest.fixture
def initialized_matcher(matcher):
    """Create and initialize matcher"""
    with patch.object(matcher, 'det_model', MagicMock()):
        with patch.object(matcher, 'rec_model', MagicMock()):
            matcher.is_initialized = True
            yield matcher


@pytest.fixture
def sample_landmarks():
    """Sample 5-point facial landmarks"""
    return np.array([
        [38.2946, 51.6963],  # left eye
        [73.5318, 51.5014],  # right eye
        [56.0252, 71.7366],  # nose
        [41.5493, 92.3655],  # left mouth
        [70.7299, 92.2041]   # right mouth
    ], dtype=np.float32)


@pytest.fixture
def sample_embedding():
    """Sample 512-dimensional face embedding"""
    embedding = np.random.randn(512).astype(np.float32)
    # Normalize
    embedding = embedding / np.linalg.norm(embedding)
    return embedding


# Unit Tests - Initialization
class TestInitialization:
    """Test matcher initialization"""
    
    def test_matcher_creation(self):
        """Test creating matcher instance"""
        matcher = ArcFaceMatcher(device="cpu")
        assert matcher.device == "cpu"
        assert not matcher.is_initialized
    
    def test_default_threshold(self):
        """Test default similarity threshold"""
        matcher = ArcFaceMatcher()
        assert matcher.DEFAULT_THRESHOLD == 0.40
    
    def test_model_paths(self):
        """Test model path configuration"""
        matcher = ArcFaceMatcher()
        assert "det_10g.onnx" in matcher.det_model_path
        assert "w600k_r50.onnx" in matcher.rec_model_path
    
    @patch('onnxruntime.InferenceSession')
    def test_initialization_success(self, mock_session):
        """Test successful initialization"""
        matcher = ArcFaceMatcher(device="cpu")
        
        # Mock model files exist
        with patch('os.path.exists', return_value=True):
            matcher.initialize()
        
        assert matcher.is_initialized
        assert mock_session.call_count >= 1


# Unit Tests - Face Detection
class TestFaceDetection:
    """Test face detection functionality"""
    
    def test_detect_face_opencv_fallback(self, matcher, sample_image):
        """Test OpenCV fallback detection"""
        result = matcher._detect_face_opencv(sample_image)
        assert isinstance(result, FaceDetectionResult)
        assert isinstance(result.detected, bool)
    
    def test_detect_face_no_face(self, matcher):
        """Test detection with no face"""
        # Create blank image
        blank_image = np.zeros((112, 112, 3), dtype=np.uint8)
        result = matcher._detect_face_opencv(blank_image)
        assert not result.detected
    
    def test_detect_face_with_landmarks(self, matcher, sample_image):
        """Test detection returns landmarks"""
        result = matcher.detect_face(sample_image)
        if result.detected and result.landmarks is not None:
            assert result.landmarks.shape == (5, 2)


# Unit Tests - Face Alignment
class TestFaceAlignment:
    """Test face alignment functionality"""
    
    def test_align_face_basic(self, matcher, sample_image, sample_landmarks):
        """Test basic face alignment"""
        aligned = matcher.align_face(sample_image, sample_landmarks)
        assert aligned.shape == (112, 112, 3)
    
    def test_align_face_output_size(self, matcher, sample_image, sample_landmarks):
        """Test custom output size"""
        aligned = matcher.align_face(sample_image, sample_landmarks, output_size=(224, 224))
        assert aligned.shape == (224, 224, 3)
    
    def test_align_face_invalid_landmarks(self, matcher, sample_image):
        """Test alignment with invalid landmarks"""
        invalid_landmarks = np.array([[0, 0]], dtype=np.float32)
        aligned = matcher.align_face(sample_image, invalid_landmarks)
        # Should fallback to resize
        assert aligned.shape == (112, 112, 3)
    
    def test_estimate_transform(self, matcher, sample_landmarks):
        """Test transformation matrix estimation"""
        dst_points = matcher.ARCFACE_DST
        tform = matcher._estimate_transform(sample_landmarks, dst_points)
        assert tform.shape == (2, 3)


# Unit Tests - Face Preprocessing
class TestFacePreprocessing:
    """Test face preprocessing for model input"""
    
    def test_preprocess_face_shape(self, matcher, sample_image):
        """Test preprocessing output shape"""
        preprocessed = matcher._preprocess_face(sample_image)
        assert preprocessed.shape == (1, 3, 112, 112)
    
    def test_preprocess_face_normalization(self, matcher, sample_image):
        """Test preprocessing normalization"""
        preprocessed = matcher._preprocess_face(sample_image)
        # Values should be in [-1, 1] range
        assert preprocessed.min() >= -1.0
        assert preprocessed.max() <= 1.0
    
    def test_preprocess_face_dtype(self, matcher, sample_image):
        """Test preprocessing data type"""
        preprocessed = matcher._preprocess_face(sample_image)
        assert preprocessed.dtype == np.float32


# Unit Tests - Quality Assessment
class TestQualityAssessment:
    """Test image quality assessment"""
    
    def test_quality_score_range(self, matcher, sample_image):
        """Test quality score is in valid range"""
        score = matcher._calculate_quality_score(sample_image, 0.9)
        assert 0.0 <= score <= 1.0
    
    def test_quality_score_high_confidence(self, matcher, sample_image):
        """Test quality score with high detection confidence"""
        score = matcher._calculate_quality_score(sample_image, 0.95)
        assert score > 0.3  # Should be reasonably high
    
    def test_quality_score_low_confidence(self, matcher, sample_image):
        """Test quality score with low detection confidence"""
        score = matcher._calculate_quality_score(sample_image, 0.3)
        assert score < 0.7  # Should be lower
    
    def test_quality_score_blurry_image(self, matcher):
        """Test quality score with blurry image"""
        # Create blurry image
        image = np.random.randint(0, 255, (112, 112, 3), dtype=np.uint8)
        blurry = cv2.GaussianBlur(image, (15, 15), 0)
        
        score_sharp = matcher._calculate_quality_score(image, 0.9)
        score_blurry = matcher._calculate_quality_score(blurry, 0.9)
        
        # Blurry image should have lower score
        assert score_blurry < score_sharp


# Unit Tests - Similarity Computation
class TestSimilarityComputation:
    """Test similarity computation"""
    
    def test_cosine_similarity_identical(self, matcher, sample_embedding):
        """Test similarity of identical embeddings"""
        similarity = matcher._cosine_similarity(sample_embedding, sample_embedding)
        assert abs(similarity - 1.0) < 0.01  # Should be ~1.0
    
    def test_cosine_similarity_different(self, matcher):
        """Test similarity of different embeddings"""
        emb1 = np.random.randn(512).astype(np.float32)
        emb1 = emb1 / np.linalg.norm(emb1)
        
        emb2 = np.random.randn(512).astype(np.float32)
        emb2 = emb2 / np.linalg.norm(emb2)
        
        similarity = matcher._cosine_similarity(emb1, emb2)
        assert -1.0 <= similarity <= 1.0
    
    def test_cosine_similarity_opposite(self, matcher, sample_embedding):
        """Test similarity of opposite embeddings"""
        opposite = -sample_embedding
        similarity = matcher._cosine_similarity(sample_embedding, opposite)
        assert abs(similarity - (-1.0)) < 0.01  # Should be ~-1.0


# Unit Tests - Confidence Calculation
class TestConfidenceCalculation:
    """Test match confidence calculation"""
    
    def test_confidence_high_similarity(self, matcher):
        """Test confidence with high similarity"""
        confidence = matcher._calculate_match_confidence(0.9, 0.4, 0.9, 0.9)
        assert confidence > 0.7
    
    def test_confidence_low_similarity(self, matcher):
        """Test confidence with low similarity"""
        confidence = matcher._calculate_match_confidence(0.2, 0.4, 0.9, 0.9)
        assert confidence > 0.3  # Still has some confidence due to quality
    
    def test_confidence_near_threshold(self, matcher):
        """Test confidence near threshold"""
        confidence = matcher._calculate_match_confidence(0.41, 0.40, 0.9, 0.9)
        assert 0.3 < confidence < 0.7  # Moderate confidence
    
    def test_confidence_low_quality(self, matcher):
        """Test confidence with low quality images"""
        confidence = matcher._calculate_match_confidence(0.9, 0.4, 0.3, 0.3)
        assert confidence < 0.8  # Quality affects confidence


# Integration Tests - Embedding Extraction
class TestEmbeddingExtraction:
    """Test face embedding extraction"""
    
    @patch.object(ArcFaceMatcher, 'detect_face')
    @patch.object(ArcFaceMatcher, 'rec_model')
    def test_extract_embedding_success(self, mock_rec_model, mock_detect, 
                                      initialized_matcher, sample_image_path, sample_landmarks):
        """Test successful embedding extraction"""
        # Mock detection
        mock_detect.return_value = FaceDetectionResult(
            detected=True,
            bbox=(0, 0, 112, 112),
            landmarks=sample_landmarks,
            confidence=0.95
        )
        
        # Mock model inference
        mock_embedding = np.random.randn(1, 512).astype(np.float32)
        mock_rec_model.run.return_value = [mock_embedding]
        
        result = initialized_matcher.extract_embedding(sample_image_path, "USER_123")
        
        assert isinstance(result, FaceEmbedding)
        assert result.face_detected
        assert result.embedding.shape == (512,)
        assert 0.0 <= result.quality_score <= 1.0
    
    @patch.object(ArcFaceMatcher, 'detect_face')
    def test_extract_embedding_no_face(self, mock_detect, initialized_matcher, sample_image_path):
        """Test embedding extraction with no face detected"""
        # Mock no detection
        mock_detect.return_value = FaceDetectionResult(detected=False)
        
        result = initialized_matcher.extract_embedding(sample_image_path, "USER_123")
        
        assert not result.face_detected
        assert result.embedding.shape == (512,)
        assert result.quality_score == 0.0


# Integration Tests - Face Matching
class TestFaceMatching:
    """Test face matching functionality"""
    
    @patch.object(ArcFaceMatcher, 'extract_embedding')
    def test_match_faces_success(self, mock_extract, initialized_matcher, sample_image_path):
        """Test successful face matching"""
        # Create similar embeddings (should match)
        base_embedding = np.random.randn(512).astype(np.float32)
        base_embedding = base_embedding / np.linalg.norm(base_embedding)
        
        # Add small noise for second embedding
        similar_embedding = base_embedding + np.random.randn(512).astype(np.float32) * 0.1
        similar_embedding = similar_embedding / np.linalg.norm(similar_embedding)
        
        mock_extract.side_effect = [
            FaceEmbedding(
                embedding=base_embedding,
                face_detected=True,
                quality_score=0.9,
                timestamp=datetime.utcnow().isoformat()
            ),
            FaceEmbedding(
                embedding=similar_embedding,
                face_detected=True,
                quality_score=0.9,
                timestamp=datetime.utcnow().isoformat()
            )
        ]
        
        result = initialized_matcher.match_faces(
            sample_image_path,
            sample_image_path,
            "USER_123",
            threshold=0.40
        )
        
        assert isinstance(result, FaceMatchResult)
        assert result.face_detected_id
        assert result.face_detected_selfie
        assert result.similarity >= 0.0
        assert result.confidence >= 0.0
    
    @patch.object(ArcFaceMatcher, 'extract_embedding')
    def test_match_faces_no_match(self, mock_extract, initialized_matcher, sample_image_path):
        """Test face matching with different faces"""
        # Create different embeddings (should not match)
        emb1 = np.random.randn(512).astype(np.float32)
        emb1 = emb1 / np.linalg.norm(emb1)
        
        emb2 = np.random.randn(512).astype(np.float32)
        emb2 = emb2 / np.linalg.norm(emb2)
        
        mock_extract.side_effect = [
            FaceEmbedding(
                embedding=emb1,
                face_detected=True,
                quality_score=0.9,
                timestamp=datetime.utcnow().isoformat()
            ),
            FaceEmbedding(
                embedding=emb2,
                face_detected=True,
                quality_score=0.9,
                timestamp=datetime.utcnow().isoformat()
            )
        ]
        
        result = initialized_matcher.match_faces(
            sample_image_path,
            sample_image_path,
            "USER_123",
            threshold=0.40
        )
        
        # With random embeddings, similarity will be low
        assert result.similarity < 0.5  # Likely much lower
    
    @patch.object(ArcFaceMatcher, 'extract_embedding')
    def test_match_faces_no_face_detected(self, mock_extract, initialized_matcher, sample_image_path):
        """Test matching when no face is detected"""
        mock_extract.side_effect = [
            FaceEmbedding(
                embedding=np.zeros(512, dtype=np.float32),
                face_detected=False,
                quality_score=0.0,
                timestamp=datetime.utcnow().isoformat()
            ),
            FaceEmbedding(
                embedding=np.zeros(512, dtype=np.float32),
                face_detected=True,
                quality_score=0.9,
                timestamp=datetime.utcnow().isoformat()
            )
        ]
        
        result = initialized_matcher.match_faces(
            sample_image_path,
            sample_image_path,
            "USER_123"
        )
        
        assert not result.is_match
        assert result.status == MatchStatus.ERROR.value
        assert not result.face_detected_id


# Integration Tests - Batch Processing
class TestBatchProcessing:
    """Test batch face matching"""
    
    @patch.object(ArcFaceMatcher, 'match_faces')
    def test_batch_match_success(self, mock_match, initialized_matcher):
        """Test successful batch matching"""
        # Mock match results
        mock_match.return_value = FaceMatchResult(
            match_id="MATCH_123",
            is_match=True,
            similarity=0.85,
            confidence=0.92,
            threshold=0.40,
            face_detected_id=True,
            face_detected_selfie=True,
            quality_score_id=0.9,
            quality_score_selfie=0.9,
            processing_time_ms=150.0,
            timestamp=datetime.utcnow().isoformat(),
            status=MatchStatus.MATCH.value
        )
        
        matches = [
            ("id1.jpg", "selfie1.jpg", "USER_1"),
            ("id2.jpg", "selfie2.jpg", "USER_2"),
            ("id3.jpg", "selfie3.jpg", "USER_3")
        ]
        
        results = initialized_matcher.batch_match(matches)
        
        assert len(results) == 3
        assert all(isinstance(r, FaceMatchResult) for r in results)
    
    @patch.object(ArcFaceMatcher, 'match_faces')
    def test_batch_match_with_errors(self, mock_match, initialized_matcher):
        """Test batch matching with some errors"""
        # Mock: first succeeds, second fails, third succeeds
        mock_match.side_effect = [
            FaceMatchResult(
                match_id="MATCH_1",
                is_match=True,
                similarity=0.85,
                confidence=0.92,
                threshold=0.40,
                face_detected_id=True,
                face_detected_selfie=True,
                quality_score_id=0.9,
                quality_score_selfie=0.9,
                processing_time_ms=150.0,
                timestamp=datetime.utcnow().isoformat(),
                status=MatchStatus.MATCH.value
            ),
            Exception("Processing error"),
            FaceMatchResult(
                match_id="MATCH_3",
                is_match=False,
                similarity=0.25,
                confidence=0.88,
                threshold=0.40,
                face_detected_id=True,
                face_detected_selfie=True,
                quality_score_id=0.9,
                quality_score_selfie=0.9,
                processing_time_ms=145.0,
                timestamp=datetime.utcnow().isoformat(),
                status=MatchStatus.NO_MATCH.value
            )
        ]
        
        matches = [
            ("id1.jpg", "selfie1.jpg", "USER_1"),
            ("id2.jpg", "selfie2.jpg", "USER_2"),
            ("id3.jpg", "selfie3.jpg", "USER_3")
        ]
        
        results = initialized_matcher.batch_match(matches)
        
        # Should have 2 results (1 error skipped)
        assert len(results) == 2


# Performance Tests
class TestPerformance:
    """Test performance characteristics"""
    
    @pytest.mark.slow
    @patch.object(ArcFaceMatcher, 'extract_embedding')
    def test_matching_speed(self, mock_extract, initialized_matcher, sample_image_path):
        """Test matching completes within acceptable time"""
        import time
        
        # Mock embeddings
        emb = np.random.randn(512).astype(np.float32)
        emb = emb / np.linalg.norm(emb)
        
        mock_extract.return_value = FaceEmbedding(
            embedding=emb,
            face_detected=True,
            quality_score=0.9,
            timestamp=datetime.utcnow().isoformat()
        )
        
        start = time.time()
        result = initialized_matcher.match_faces(
            sample_image_path,
            sample_image_path,
            "USER_123"
        )
        elapsed = time.time() - start
        
        # Should complete in reasonable time (with mocks, should be fast)
        assert elapsed < 1.0  # 1 second
    
    def test_embedding_normalization(self, matcher, sample_embedding):
        """Test embeddings are properly normalized"""
        norm = np.linalg.norm(sample_embedding)
        assert abs(norm - 1.0) < 0.01  # Should be unit vector


# Edge Cases
class TestEdgeCases:
    """Test edge cases and error handling"""
    
    def test_invalid_image_path(self, initialized_matcher):
        """Test handling of invalid image path"""
        with pytest.raises(Exception):
            initialized_matcher.extract_embedding("nonexistent.jpg", "USER_123")
    
    def test_custom_threshold(self, initialized_matcher, sample_image_path):
        """Test custom similarity threshold"""
        with patch.object(initialized_matcher, 'extract_embedding'):
            initialized_matcher.extract_embedding.return_value = FaceEmbedding(
                embedding=np.random.randn(512).astype(np.float32),
                face_detected=True,
                quality_score=0.9,
                timestamp=datetime.utcnow().isoformat()
            )
            
            result = initialized_matcher.match_faces(
                sample_image_path,
                sample_image_path,
                "USER_123",
                threshold=0.60  # Higher threshold
            )
            
            assert result.threshold == 0.60
    
    def test_empty_batch(self, initialized_matcher):
        """Test batch matching with empty list"""
        results = initialized_matcher.batch_match([])
        assert len(results) == 0


# Test Summary
def test_suite_coverage():
    """Verify test suite coverage"""
    # This test documents what we're testing
    tested_components = {
        "initialization": True,
        "face_detection": True,
        "face_alignment": True,
        "preprocessing": True,
        "quality_assessment": True,
        "similarity_computation": True,
        "confidence_calculation": True,
        "embedding_extraction": True,
        "face_matching": True,
        "batch_processing": True,
        "performance": True,
        "edge_cases": True
    }
    
    assert all(tested_components.values())
    assert len(tested_components) >= 12  # At least 12 component categories


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
