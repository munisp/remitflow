"""
Unit tests for the MiniFASNet liveness provider adapter.
Tests the provider factory, fallback logic, face matching, OCR, and name matching.
Run with: pytest test_liveness_provider.py -v
"""

import base64
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# ── Minimal stubs so we can import main.py without heavy ML deps ──────────────
sys.modules.setdefault("uniface", MagicMock())
sys.modules.setdefault("deepface", MagicMock())
sys.modules.setdefault("deepface.DeepFace", MagicMock())
sys.modules.setdefault("pytesseract", MagicMock())
sys.modules.setdefault("passporteye", MagicMock())
sys.modules.setdefault("cv2", MagicMock())

import numpy as np

# Patch numpy so cv2 mock doesn't break
import importlib

os.environ.setdefault("LIVENESS_PROVIDER", "minifasnet")

# Import the module under test
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "kyc_main",
    pathlib.Path(__file__).parent / "main.py",
)
kyc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kyc)


class TestProviderFactory(unittest.TestCase):
    """Tests for the LIVENESS_PROVIDER env var adapter."""

    def test_default_is_minifasnet(self):
        with patch.dict(os.environ, {"LIVENESS_PROVIDER": "minifasnet"}):
            # Reset singleton
            kyc._provider = None
            prov = kyc.provider()
            self.assertEqual(prov.name, "minifasnet")

    def test_iproov_provider_selected(self):
        with patch.dict(os.environ, {"LIVENESS_PROVIDER": "iproov", "IPROOV_API_KEY": "test_key"}):
            kyc._provider = None
            prov = kyc.get_liveness_provider()
            self.assertEqual(prov.name, "iproov")

    def test_onfido_provider_selected(self):
        with patch.dict(os.environ, {"LIVENESS_PROVIDER": "onfido", "ONFIDO_API_TOKEN": "test_token"}):
            kyc._provider = None
            prov = kyc.get_liveness_provider()
            self.assertEqual(prov.name, "onfido")

    def test_unknown_provider_falls_back_to_minifasnet(self):
        with patch.dict(os.environ, {"LIVENESS_PROVIDER": "nonexistent"}):
            kyc._provider = None
            prov = kyc.get_liveness_provider()
            self.assertEqual(prov.name, "minifasnet")


class TestMiniFASNetProvider(unittest.TestCase):
    """Tests for MiniFASNet provider with uniface mocked."""

    def _make_provider(self):
        kyc._provider = None
        prov = kyc.MiniFASNetProvider()
        return prov

    def test_provider_name(self):
        prov = self._make_provider()
        self.assertEqual(prov.name, "minifasnet")

    def test_heuristic_fallback_with_valid_image(self):
        """When uniface unavailable, heuristic fallback should still return a result."""
        prov = self._make_provider()
        prov._available = False  # Force fallback

        # Create a minimal valid JPEG (1x1 white pixel)
        import io
        try:
            from PIL import Image
            img = Image.new("RGB", (100, 100), color=(200, 200, 200))
            buf = io.BytesIO()
            img.save(buf, format="JPEG")
            img_b64 = base64.b64encode(buf.getvalue()).decode()
        except ImportError:
            # Pillow not available — use a raw JPEG header stub
            img_b64 = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 10000).decode()

        result = prov.check_passive(img_b64)
        self.assertIn("passed", result)
        self.assertIn("confidence", result)
        self.assertIn("method", result)
        self.assertEqual(result["method"], "heuristic_fallback")

    def test_heuristic_fallback_invalid_image_returns_false(self):
        prov = self._make_provider()
        prov._available = False
        result = prov.check_passive("not_valid_base64!!!")
        self.assertFalse(result["passed"])
        self.assertEqual(result["confidence"], 0.0)

    def test_minifasnet_live_result(self):
        """When uniface returns label=1, result should be passed=True."""
        prov = self._make_provider()
        prov._available = True

        mock_model = MagicMock()
        mock_model.predict.return_value = (1, 0.95)
        prov._model = mock_model

        # Encode a dummy image
        img_b64 = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 5000).decode()

        with patch("cv2.imdecode", return_value=np.zeros((80, 80, 3), dtype=np.uint8)):
            result = prov.check_passive(img_b64)

        self.assertTrue(result["passed"])
        self.assertAlmostEqual(result["confidence"], 0.95)
        self.assertEqual(result["method"], "minifasnet_onnx")
        self.assertIsNone(result["attack_type"])

    def test_minifasnet_spoof_result(self):
        """When uniface returns label=0, result should be passed=False with attack_type."""
        prov = self._make_provider()
        prov._available = True

        mock_model = MagicMock()
        mock_model.predict.return_value = (0, 0.20)  # Low score = printed photo
        prov._model = mock_model

        img_b64 = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 5000).decode()

        with patch("cv2.imdecode", return_value=np.zeros((80, 80, 3), dtype=np.uint8)):
            result = prov.check_passive(img_b64)

        self.assertFalse(result["passed"])
        self.assertEqual(result["attack_type"], "printed_photo")

    def test_minifasnet_screen_replay_detection(self):
        """Score 0.3–0.5 should classify as screen_replay."""
        prov = self._make_provider()
        prov._available = True

        mock_model = MagicMock()
        mock_model.predict.return_value = (0, 0.40)
        prov._model = mock_model

        img_b64 = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 5000).decode()

        with patch("cv2.imdecode", return_value=np.zeros((80, 80, 3), dtype=np.uint8)):
            result = prov.check_passive(img_b64)

        self.assertEqual(result["attack_type"], "screen_replay")

    def test_minifasnet_inference_error_falls_back(self):
        """If uniface raises an exception, should fall back to heuristic."""
        prov = self._make_provider()
        prov._available = True

        mock_model = MagicMock()
        mock_model.predict.side_effect = RuntimeError("ONNX inference failed")
        prov._model = mock_model

        img_b64 = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 5000).decode()

        with patch("cv2.imdecode", return_value=np.zeros((80, 80, 3), dtype=np.uint8)):
            result = prov.check_passive(img_b64)

        # Should fall back to heuristic, not raise
        self.assertIn("passed", result)
        self.assertIn("method", result)


class TestNameMatching(unittest.TestCase):
    """Tests for the fuzzy name matching function."""

    def test_exact_match_returns_1(self):
        self.assertEqual(kyc.compare_names("John Doe", "JOHN DOE"), 1.0)

    def test_partial_match(self):
        score = kyc.compare_names("John Michael Doe", "John Doe")
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)

    def test_no_match_returns_low_score(self):
        score = kyc.compare_names("Alice Smith", "Bob Johnson")
        self.assertLess(score, 0.5)

    def test_empty_ocr_returns_zero(self):
        self.assertEqual(kyc.compare_names("John Doe", None), 0.0)
        self.assertEqual(kyc.compare_names("John Doe", ""), 0.0)

    def test_single_name_match(self):
        score = kyc.compare_names("Alice", "ALICE")
        self.assertEqual(score, 1.0)


class TestRiskFlags(unittest.TestCase):
    """Tests for the risk flag detection logic."""

    def _ocr(self, confidence=0.9):
        return kyc.OCRResult(
            name="John Doe", dob="1990-01-01", document_number="AB123",
            nationality="USA", expiry_date="2030-01-01",
            mrz_line1=None, mrz_line2=None, confidence=confidence
        )

    def test_no_flags_when_all_pass(self):
        liveness = {"passed": True, "confidence": 0.95}
        face_match = {"match": True, "score": 0.92}
        flags = kyc.detect_risk_flags(liveness, face_match, self._ocr(), "John Doe", 1.0)
        self.assertEqual(flags, [])

    def test_liveness_failed_flag(self):
        liveness = {"passed": False, "confidence": 0.2, "attack_type": "printed_photo"}
        face_match = {"match": True, "score": 0.92}
        flags = kyc.detect_risk_flags(liveness, face_match, self._ocr(), "John Doe", 1.0)
        self.assertTrue(any("liveness_failed" in f for f in flags))
        self.assertTrue(any("printed_photo" in f for f in flags))

    def test_face_mismatch_flag(self):
        liveness = {"passed": True, "confidence": 0.95}
        face_match = {"match": False, "score": 0.45}
        flags = kyc.detect_risk_flags(liveness, face_match, self._ocr(), "John Doe", 1.0)
        self.assertTrue(any("face_mismatch" in f for f in flags))

    def test_name_mismatch_flag(self):
        liveness = {"passed": True, "confidence": 0.95}
        face_match = {"match": True, "score": 0.92}
        flags = kyc.detect_risk_flags(liveness, face_match, self._ocr(), "Alice Smith", 0.1)
        self.assertTrue(any("name_mismatch" in f for f in flags))

    def test_low_ocr_confidence_flag(self):
        liveness = {"passed": True, "confidence": 0.95}
        face_match = {"match": True, "score": 0.92}
        flags = kyc.detect_risk_flags(liveness, face_match, self._ocr(confidence=0.3), "John Doe", 1.0)
        self.assertIn("low_ocr_confidence", flags)

    def test_multiple_flags_combined(self):
        liveness = {"passed": False, "confidence": 0.1, "attack_type": "screen_replay"}
        face_match = {"match": False, "score": 0.3}
        flags = kyc.detect_risk_flags(liveness, face_match, self._ocr(confidence=0.2), "Alice", 0.0)
        self.assertGreaterEqual(len(flags), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
