"""
Unit tests for the RemitFlow Deepfake Detection Service.
Run with: pytest test_deepfake_detector.py -v
"""
import asyncio
import base64
import io
import os
import sys
import time

import numpy as np
import pytest

# ─── Ensure main module is importable ────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_fake_jpeg(width: int = 64, height: int = 64) -> bytes:
    """Generate a minimal valid JPEG image for testing."""
    from PIL import Image
    img = Image.fromarray(np.random.randint(0, 255, (height, width, 3), dtype=np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _b64_image(width: int = 64, height: int = 64) -> str:
    return base64.b64encode(_make_fake_jpeg(width, height)).decode()


# ─── Rate Limiter Tests ───────────────────────────────────────────────────────

class TestSlidingWindowRateLimiter:
    def test_allows_requests_within_limit(self):
        from main import SlidingWindowRateLimiter
        rl = SlidingWindowRateLimiter(max_rpm=5)
        for _ in range(5):
            assert rl.check("user1") is True

    def test_blocks_after_limit(self):
        from main import SlidingWindowRateLimiter
        rl = SlidingWindowRateLimiter(max_rpm=3)
        for _ in range(3):
            rl.check("user1")
        assert rl.check("user1") is False

    def test_different_users_independent(self):
        from main import SlidingWindowRateLimiter
        rl = SlidingWindowRateLimiter(max_rpm=1)
        assert rl.check("user1") is True
        assert rl.check("user2") is True  # different user, not blocked

    def test_window_evicts_old_entries(self):
        from main import SlidingWindowRateLimiter
        rl = SlidingWindowRateLimiter(max_rpm=2)
        rl.check("user1")
        rl.check("user1")
        # Manually age the entries
        from collections import deque
        rl._windows["user1"] = deque([time.monotonic() - 61, time.monotonic() - 61])
        # Now should allow again
        assert rl.check("user1") is True


# ─── Frequency Domain Analysis Tests ─────────────────────────────────────────

class TestFrequencyDomainAnalysis:
    def test_returns_tuple_of_three(self):
        from main import _check_frequency_domain
        img_bytes = _make_fake_jpeg()
        result = _check_frequency_domain(img_bytes)
        assert len(result) == 3
        is_deepfake, confidence, indicators = result
        assert isinstance(is_deepfake, bool)
        assert 0.0 <= confidence <= 1.0
        assert isinstance(indicators, list)

    def test_handles_invalid_bytes(self):
        from main import _check_frequency_domain
        result = _check_frequency_domain(b"not an image")
        is_deepfake, confidence, indicators = result
        assert isinstance(is_deepfake, bool)

    def test_natural_image_low_score(self):
        """A smooth gradient image should have low GAN artifact score."""
        from main import _check_frequency_domain
        import cv2
        # Create a smooth gradient (low high-frequency energy)
        gradient = np.zeros((256, 256), dtype=np.uint8)
        for i in range(256):
            gradient[i, :] = i
        _, buf = cv2.imencode(".jpg", gradient)
        img_bytes = buf.tobytes()
        _, confidence, _ = _check_frequency_domain(img_bytes)
        # Smooth gradient should have low spoof score
        assert confidence < 0.8


# ─── Landmark Consistency Tests ───────────────────────────────────────────────

class TestLandmarkConsistency:
    def test_returns_tuple_of_three(self):
        from main import _check_landmark_consistency
        img_bytes = _make_fake_jpeg()
        result = _check_landmark_consistency(img_bytes)
        assert len(result) == 3
        is_deepfake, confidence, indicators = result
        assert isinstance(is_deepfake, bool)
        assert 0.0 <= confidence <= 1.0
        assert isinstance(indicators, list)

    def test_handles_no_face(self):
        from main import _check_landmark_consistency
        # Pure noise image — no face
        img_bytes = _make_fake_jpeg()
        is_deepfake, confidence, indicators = _check_landmark_consistency(img_bytes)
        # Should not crash; may return no_face_detected or mediapipe_not_available
        assert isinstance(indicators, list)


# ─── DeepfakeCheckResponse Model Tests ───────────────────────────────────────

class TestDeepfakeCheckResponse:
    def test_confidence_bounds(self):
        from main import DeepfakeCheckResponse
        resp = DeepfakeCheckResponse(
            is_deepfake=True,
            confidence=0.95,
            method="test",
            processing_time_ms=10.0,
            timestamp="2026-01-01T00:00:00Z",
        )
        assert resp.confidence == 0.95
        assert resp.is_deepfake is True

    def test_fail_closed_defaults(self):
        from main import DeepfakeCheckResponse
        resp = DeepfakeCheckResponse(
            is_deepfake=True,
            confidence=0.0,
            method="fail_closed",
            indicators=["all_detection_methods_failed"],
            processing_time_ms=0.0,
            timestamp="2026-01-01T00:00:00Z",
        )
        assert resp.is_deepfake is True
        assert "all_detection_methods_failed" in resp.indicators


# ─── FastAPI Endpoint Tests ───────────────────────────────────────────────────

class TestEndpoints:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from main import app
        return TestClient(app)

    def test_health_endpoint(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "python-deepfake-detector"
        assert data["status"] == "healthy"
        assert "model_loaded" in data

    def test_metrics_endpoint(self, client):
        resp = client.get("/metrics")
        assert resp.status_code == 200
        assert "deepfake_requests_total" in resp.text

    def test_check_requires_image(self, client):
        resp = client.post("/check", json={"user_id": "test"})
        assert resp.status_code == 422

    def test_check_with_base64_image(self, client):
        b64 = _b64_image()
        resp = client.post("/check", json={"image_base64": b64, "user_id": "test_user"})
        assert resp.status_code == 200
        data = resp.json()
        assert "is_deepfake" in data
        assert "confidence" in data
        assert "method" in data
        assert 0.0 <= data["confidence"] <= 1.0

    def test_batch_check(self, client):
        images = [{"image_base64": _b64_image()} for _ in range(3)]
        resp = client.post("/batch", json={"images": images, "user_id": "test_user"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) == 3
        assert "any_deepfake" in data
        assert "max_confidence" in data

    def test_batch_size_limit(self, client):
        images = [{"image_base64": _b64_image()} for _ in range(9)]
        resp = client.post("/batch", json={"images": images})
        assert resp.status_code == 422

    def test_rate_limiting(self, client):
        """Exhaust the rate limit for a specific user."""
        import main
        original_rpm = main.RATE_LIMIT_RPM
        main._rate_limiter = main.SlidingWindowRateLimiter(max_rpm=2)
        b64 = _b64_image()
        client.post("/check", json={"image_base64": b64, "user_id": "rl_test"})
        client.post("/check", json={"image_base64": b64, "user_id": "rl_test"})
        resp = client.post("/check", json={"image_base64": b64, "user_id": "rl_test"})
        assert resp.status_code == 429
        # Restore
        main._rate_limiter = main.SlidingWindowRateLimiter(max_rpm=original_rpm)
