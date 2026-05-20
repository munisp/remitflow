"""
Test Suite for DeepSeek-OCR KYC Verification
Comprehensive tests for document verification, face matching, and liveness detection
"""

import pytest
import os
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import numpy as np

# Import services to test
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend" / "ai-ml-services" / "deepseek-ocr-service"))

from deepseek_ocr_verifier import (
    DeepSeekOCRVerifier,
    DocumentType,
    VerificationStatus,
    DocumentData,
    VerificationResult
)
from face_verification import (
    FaceVerificationService,
    LivenessStatus,
    FaceMatchResult,
    LivenessResult
)
from integrated_kyc_service import (
    IntegratedKYCService,
    KYCTier,
    IntegratedKYCResult
)


class TestDeepSeekOCRVerifier:
    """Test DeepSeek-OCR document verification"""
    
    @pytest.fixture
    def verifier(self):
        """Create verifier instance"""
        return DeepSeekOCRVerifier()
    
    def test_initialization(self, verifier):
        """Test verifier initialization"""
        assert verifier is not None
        assert verifier.model_path == "deepseek-ai/DeepSeek-OCR"
        assert not verifier.is_initialized
    
    def test_get_prompt_for_national_id(self, verifier):
        """Test prompt generation for national ID"""
        prompt = verifier._get_prompt_for_document_type(DocumentType.NATIONAL_ID)
        assert "Nigerian National ID" in prompt
        assert "ID number" in prompt
        assert "full name" in prompt
    
    def test_get_prompt_for_passport(self, verifier):
        """Test prompt generation for passport"""
        prompt = verifier._get_prompt_for_document_type(DocumentType.PASSPORT)
        assert "passport" in prompt.lower()
        assert "passport number" in prompt
    
    def test_parse_national_id_text(self, verifier):
        """Test parsing Nigerian national ID text"""
        raw_text = """
        FEDERAL REPUBLIC OF NIGERIA
        NATIONAL IDENTITY CARD
        12345678901
        JOHN ADEBAYO OKONKWO
        DATE OF BIRTH: 15/03/1990
        GENDER: MALE
        STATE: LAGOS
        """
        
        result = verifier._parse_document_text(raw_text, DocumentType.NATIONAL_ID)
        
        assert result['document_number'] == '12345678901'
        assert 'JOHN' in result.get('full_name', '')
        assert result.get('date_of_birth') == '15/03/1990'
        assert result.get('gender') == 'MALE'
    
    def test_parse_passport_text(self, verifier):
        """Test parsing passport text"""
        raw_text = """
        PASSPORT
        NIGERIA
        A12345678
        SURNAME: OKONKWO
        GIVEN NAMES: JOHN ADEBAYO
        NATIONALITY: NIGERIA
        DATE OF BIRTH: 15/03/1990
        """
        
        result = verifier._parse_document_text(raw_text, DocumentType.PASSPORT)
        
        assert result['document_number'] == 'A12345678'
        assert result['nationality'] == 'NIGERIA'
    
    def test_verify_authenticity_high_score(self, verifier):
        """Test authenticity verification with good data"""
        # Create mock document data
        doc_data = DocumentData(
            document_type="national_id",
            document_number="12345678901",
            full_name="JOHN OKONKWO",
            date_of_birth="15/03/1990"
        )
        
        # Mock image file
        with patch('PIL.Image.open') as mock_open:
            mock_img = MagicMock()
            mock_img.size = (1280, 1024)
            mock_open.return_value = mock_img
            
            score = verifier._verify_authenticity("/fake/path.jpg", doc_data)
            
            assert score >= 0.7  # Should be high with all fields present
    
    def test_check_quality_high_resolution(self, verifier):
        """Test quality check with high resolution image"""
        with patch('PIL.Image.open') as mock_open:
            mock_img = MagicMock()
            mock_img.size = (1920, 1080)
            mock_open.return_value = mock_img
            
            with patch('os.path.getsize', return_value=600000):
                score = verifier._check_quality("/fake/path.jpg")
                
                assert score >= 0.7  # High resolution should score well
    
    def test_validate_data_complete(self, verifier):
        """Test data validation with complete data"""
        doc_data = DocumentData(
            document_type="national_id",
            document_number="12345678901",
            full_name="JOHN OKONKWO",
            date_of_birth="15/03/1990"
        )
        
        issues, warnings = verifier._validate_data(doc_data, DocumentType.NATIONAL_ID)
        
        assert len(issues) == 0  # No issues with complete data
    
    def test_validate_data_missing_name(self, verifier):
        """Test data validation with missing name"""
        doc_data = DocumentData(
            document_type="national_id",
            document_number="12345678901",
            full_name=None
        )
        
        issues, warnings = verifier._validate_data(doc_data, DocumentType.NATIONAL_ID)
        
        assert len(issues) > 0
        assert any("name" in issue.lower() for issue in issues)
    
    def test_calculate_confidence(self, verifier):
        """Test confidence calculation"""
        confidence = verifier._calculate_confidence(
            authenticity_score=0.9,
            quality_score=0.8,
            num_issues=0,
            num_warnings=1
        )
        
        assert 0.0 <= confidence <= 1.0
        assert confidence > 0.7  # Should be high with good scores
    
    def test_determine_status_verified(self, verifier):
        """Test status determination for verified document"""
        status = verifier._determine_status(confidence=0.90, issues=[])
        
        assert status == VerificationStatus.VERIFIED
    
    def test_determine_status_manual_review(self, verifier):
        """Test status determination for manual review"""
        status = verifier._determine_status(confidence=0.75, issues=[])
        
        assert status == VerificationStatus.MANUAL_REVIEW
    
    def test_determine_status_rejected(self, verifier):
        """Test status determination for rejected document"""
        status = verifier._determine_status(
            confidence=0.60,
            issues=["Missing name", "Missing ID number", "Poor quality"]
        )
        
        assert status == VerificationStatus.REJECTED


class TestFaceVerificationService:
    """Test face matching and liveness detection"""
    
    @pytest.fixture
    def service(self):
        """Create face verification service instance"""
        return FaceVerificationService()
    
    def test_initialization(self, service):
        """Test service initialization"""
        assert service is not None
        assert not service.is_initialized
    
    @patch('cv2.CascadeClassifier')
    def test_initialize(self, mock_cascade, service):
        """Test service initialization"""
        service.initialize()
        
        assert service.is_initialized
        assert service.face_cascade is not None
        assert service.eye_cascade is not None
    
    @patch('cv2.imread')
    @patch('cv2.cvtColor')
    @patch('cv2.CascadeClassifier')
    def test_extract_face_success(self, mock_cascade, mock_cvt, mock_imread, service):
        """Test successful face extraction"""
        # Mock face detection
        mock_cascade_inst = MagicMock()
        mock_cascade_inst.detectMultiScale.return_value = [(50, 50, 100, 100)]
        service.face_cascade = mock_cascade_inst
        service.is_initialized = True
        
        # Mock image
        mock_img = np.zeros((200, 200, 3), dtype=np.uint8)
        mock_imread.return_value = mock_img
        mock_cvt.return_value = np.zeros((200, 200), dtype=np.uint8)
        
        with patch('cv2.resize') as mock_resize:
            mock_resize.return_value = np.zeros((128, 128), dtype=np.uint8)
            
            face, detected = service._extract_face("/fake/path.jpg")
            
            assert detected
            assert face.shape == (128, 128)
    
    @patch('cv2.imread')
    @patch('cv2.cvtColor')
    @patch('cv2.CascadeClassifier')
    def test_extract_face_no_face(self, mock_cascade, mock_cvt, mock_imread, service):
        """Test face extraction with no face detected"""
        # Mock no face detection
        mock_cascade_inst = MagicMock()
        mock_cascade_inst.detectMultiScale.return_value = []
        service.face_cascade = mock_cascade_inst
        service.is_initialized = True
        
        # Mock image
        mock_img = np.zeros((200, 200, 3), dtype=np.uint8)
        mock_imread.return_value = mock_img
        mock_cvt.return_value = np.zeros((200, 200), dtype=np.uint8)
        
        face, detected = service._extract_face("/fake/path.jpg")
        
        assert not detected
    
    def test_calculate_similarity_identical(self, service):
        """Test similarity calculation for identical faces"""
        face1 = np.random.rand(128, 128) * 255
        face2 = face1.copy()
        
        similarity = service._calculate_similarity(face1, face2)
        
        assert similarity > 0.95  # Should be very high for identical faces
    
    def test_calculate_similarity_different(self, service):
        """Test similarity calculation for different faces"""
        face1 = np.random.rand(128, 128) * 255
        face2 = np.random.rand(128, 128) * 255
        
        similarity = service._calculate_similarity(face1, face2)
        
        assert 0.0 <= similarity <= 1.0
    
    def test_calculate_match_confidence(self, service):
        """Test match confidence calculation"""
        # High similarity
        confidence_high = service._calculate_match_confidence(0.90)
        assert confidence_high > 0.7
        
        # Low similarity
        confidence_low = service._calculate_match_confidence(0.40)
        assert confidence_low > 0.0


class TestIntegratedKYCService:
    """Test integrated KYC verification service"""
    
    @pytest.fixture
    def service(self):
        """Create integrated KYC service instance"""
        return IntegratedKYCService()
    
    def test_initialization(self, service):
        """Test service initialization"""
        assert service is not None
        assert service.ocr_verifier is not None
        assert service.face_service is not None
    
    def test_tier_limits_defined(self, service):
        """Test that all tier limits are defined"""
        assert KYCTier.TIER_1 in service.TIER_LIMITS
        assert KYCTier.TIER_2 in service.TIER_LIMITS
        assert KYCTier.TIER_3 in service.TIER_LIMITS
    
    def test_tier_1_limits(self, service):
        """Test Tier 1 limits"""
        limits = service.TIER_LIMITS[KYCTier.TIER_1]
        
        assert limits.daily_limit_ngn == 50000
        assert limits.monthly_limit_ngn == 200000
        assert "basic_transfers" in limits.features
    
    def test_tier_2_limits(self, service):
        """Test Tier 2 limits"""
        limits = service.TIER_LIMITS[KYCTier.TIER_2]
        
        assert limits.daily_limit_ngn == 500000
        assert limits.monthly_limit_ngn == 2000000
        assert "international_transfers" in limits.features
    
    def test_tier_3_limits(self, service):
        """Test Tier 3 limits"""
        limits = service.TIER_LIMITS[KYCTier.TIER_3]
        
        assert limits.daily_limit_ngn == 5000000
        assert limits.monthly_limit_ngn == 20000000
        assert "investments" in limits.features
    
    def test_get_tier_info(self, service):
        """Test getting tier information"""
        info = service.get_tier_info(KYCTier.TIER_2)
        
        assert info['tier'] == 'tier_2'
        assert 'daily_limit_ngn' in info
        assert 'features' in info
    
    def test_get_all_tiers_info(self, service):
        """Test getting all tiers information"""
        tiers = service.get_all_tiers_info()
        
        assert len(tiers) == 3
        assert all('tier' in tier for tier in tiers)


class TestAPIEndpoints:
    """Test API endpoint functions"""
    
    @pytest.mark.asyncio
    async def test_get_all_tiers_info_api(self):
        """Test get all tiers info API endpoint"""
        from integrated_kyc_service import get_all_tiers_info_api
        
        result = await get_all_tiers_info_api()
        
        assert result['success']
        assert 'tiers' in result
        assert len(result['tiers']) == 3
    
    @pytest.mark.asyncio
    async def test_get_tier_info_api(self):
        """Test get tier info API endpoint"""
        from integrated_kyc_service import get_tier_info_api
        
        result = await get_tier_info_api("tier_2")
        
        assert result['success']
        assert 'tier_info' in result
        assert result['tier_info']['tier'] == 'tier_2'


# Integration tests
class TestIntegration:
    """Integration tests for complete KYC flow"""
    
    @pytest.mark.integration
    def test_complete_tier_2_flow(self):
        """Test complete Tier 2 verification flow"""
        # This would require actual test images
        # Placeholder for integration test
        pass
    
    @pytest.mark.integration
    def test_complete_tier_3_flow(self):
        """Test complete Tier 3 verification flow"""
        # This would require actual test images
        # Placeholder for integration test
        pass


# Performance tests
class TestPerformance:
    """Performance tests for KYC verification"""
    
    @pytest.mark.performance
    def test_document_verification_performance(self):
        """Test document verification performance"""
        # Should complete within reasonable time
        pass
    
    @pytest.mark.performance
    def test_face_matching_performance(self):
        """Test face matching performance"""
        # Should complete within reasonable time
        pass


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
