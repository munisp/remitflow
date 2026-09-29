"""
Unit tests for the MiniFASNet liveness provider adapter.
Tests the provider factory, FAIL-CLOSED behavior (SPEC-wave15 §5 — no silent
heuristic fallback), face matching, OCR, name matching, and the
/challenge/validate helper logic (order / timing / blendshape mapping).
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
sys.modules.setdefault("mediapipe", MagicMock())

import numpy as np

# Patch numpy so cv2 mock doesn't break
import importlib

os.environ.setdefault("LIVENESS_PROVIDER", "minifasnet")
# main.py refuses to start without an explicit DATABASE_URL (fail-closed config);
# tests never open a connection, so a placeholder is fine.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")

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

    def test_iproov_without_creds_hard_fails(self):
        """SPEC-wave15 §5: commercial provider selected without creds must hard-fail."""
        env = {"LIVENESS_PROVIDER": "iproov", "IPROOV_API_KEY": ""}
        with patch.dict(os.environ, env):
            kyc._provider = None
            with self.assertRaises(RuntimeError):
                kyc.get_liveness_provider()

    def test_onfido_without_creds_hard_fails(self):
        env = {"LIVENESS_PROVIDER": "onfido", "ONFIDO_API_TOKEN": ""}
        with patch.dict(os.environ, env):
            kyc._provider = None
            with self.assertRaises(RuntimeError):
                kyc.get_liveness_provider()

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

    def test_unavailable_model_fails_closed(self):
        """SPEC-wave15 §5: model unavailable must return an error, never a
        silent heuristic success (the old DCT fallback was removed)."""
        prov = self._make_provider()
        prov._available = False
        prov._load_error = "uniface not installed (test)"

        import io
        try:
            from PIL import Image
            img = Image.new("RGB", (100, 100), color=(200, 200, 200))
            buf = io.BytesIO()
            img.save(buf, format="JPEG")
            img_b64 = base64.b64encode(buf.getvalue()).decode()
        except ImportError:
            img_b64 = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 10000).decode()

        result = prov.check_passive(img_b64)
        self.assertFalse(result["passed"])
        self.assertEqual(result["confidence"], 0.0)
        self.assertIn("error", result)                 # fail-closed → error surfaced (→ HTTP 503)
        self.assertIn("minifasnet_unavailable", result["error"])
        self.assertNotEqual(result["method"], "heuristic_fallback")

    def test_heuristic_fallback_removed(self):
        """The silent heuristic DCT fallback must no longer exist."""
        self.assertFalse(hasattr(self._make_provider(), "_heuristic_fallback"))

    def test_invalid_image_fails_closed(self):
        prov = self._make_provider()
        prov._available = False
        result = prov.check_passive("not_valid_base64!!!")
        self.assertFalse(result["passed"])
        self.assertEqual(result["confidence"], 0.0)
        self.assertIn("error", result)

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

    def test_minifasnet_inference_error_fails_closed(self):
        """If uniface raises, the provider must fail closed (error), NOT fall back."""
        prov = self._make_provider()
        prov._available = True

        mock_model = MagicMock()
        mock_model.predict.side_effect = RuntimeError("ONNX inference failed")
        prov._model = mock_model

        img_b64 = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 5000).decode()

        with patch("cv2.imdecode", return_value=np.zeros((80, 80, 3), dtype=np.uint8)):
            result = prov.check_passive(img_b64)

        self.assertFalse(result["passed"])
        self.assertEqual(result["confidence"], 0.0)
        self.assertIn("error", result)
        self.assertIn("minifasnet_inference_error", result["error"])


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


class TestChallengeValidation(unittest.TestCase):
    """Tests for /challenge/validate helper logic (SPEC-wave15 §5)."""

    def _ev(self, seq, event, ts, payload=None):
        # Server shape (kycCapture.ts): timestamp_ms
        return kyc.ChallengeEvent(seq=seq, event=event, timestamp_ms=ts, payload=payload)

    # ── request model: server shape primary, legacy names as aliases ─────────
    def test_request_model_accepts_server_shape(self):
        """Residual #2: kycCapture.ts POSTs nonce/challenge/sampled_frames and
        per-event timestamp_ms — this shape must validate (previously 422)."""
        req = kyc.ChallengeValidateRequest.model_validate({
            "session_id": "6f0d2b34-0000-4000-8000-0000000000aa",  # extra field ignored
            "user_id": 42,                                          # extra field ignored
            "nonce": "ab" * 16,
            "challenge": ["blink", "turnLeft"],
            "events": [
                {"seq": 0, "event": "blink", "payload": None, "timestamp_ms": 1000.0},
                {"seq": 1, "event": "turnLeft", "payload": {"frame_index": 1}, "timestamp_ms": 3500.0},
            ],
            "sampled_frames": ["frameA", "frameB"],
        })
        self.assertEqual(req.nonce, "ab" * 16)
        self.assertEqual(req.challenge, ["blink", "turnLeft"])
        self.assertEqual(req.sampled_frames, ["frameA", "frameB"])
        self.assertEqual(req.events[0].timestamp_ms, 1000.0)
        self.assertEqual(req.events[1].payload, {"frame_index": 1})

    def test_request_model_accepts_null_timestamp_ms(self):
        """Server maps an absent client timestampMs to null — must validate."""
        req = kyc.ChallengeValidateRequest.model_validate({
            "nonce": "n", "challenge": ["blink"],
            "events": [{"seq": 0, "event": "blink", "payload": None, "timestamp_ms": None}],
            "sampled_frames": ["frameA"],
        })
        self.assertIsNone(req.events[0].timestamp_ms)

    def test_request_model_accepts_legacy_alias_shape(self):
        """Backward compat: session_nonce/challenge_sequence/frames/timestamp
        remain accepted aliases."""
        req = kyc.ChallengeValidateRequest.model_validate({
            "session_nonce": "legacy-nonce",
            "challenge_sequence": ["smile"],
            "events": [{"seq": 0, "event": "smile", "timestamp": 2000.0}],
            "frames": ["frameA"],
        })
        self.assertEqual(req.nonce, "legacy-nonce")
        self.assertEqual(req.challenge, ["smile"])
        self.assertEqual(req.sampled_frames, ["frameA"])
        self.assertEqual(req.events[0].timestamp_ms, 2000.0)

    # ── event name normalization ──────────────────────────────────────────────
    def test_normalize_event_aliases(self):
        self.assertEqual(kyc._normalize_event_name("turn_left"), "turnLeft")
        self.assertEqual(kyc._normalize_event_name("turnRight"), "turnRight")
        self.assertEqual(kyc._normalize_event_name("open_mouth"), "jawOpen")
        self.assertEqual(kyc._normalize_event_name("jawOpen"), "jawOpen")
        self.assertEqual(kyc._normalize_event_name("BLINK"), "blink")
        self.assertEqual(kyc._normalize_event_name("bogus"), "")

    # ── order check ───────────────────────────────────────────────────────────
    def test_order_matches_issued_sequence(self):
        events = [self._ev(0, "blink", 1000), self._ev(1, "turnLeft", 3000),
                  self._ev(2, "smile", 6000)]
        res = kyc._validate_event_order(events, ["blink", "turn_left", "smile"])
        self.assertTrue(res["passed"], res["detail"])

    def test_order_mismatch_fails(self):
        events = [self._ev(0, "smile", 1000), self._ev(1, "blink", 3000)]
        res = kyc._validate_event_order(events, ["blink", "smile"])
        self.assertFalse(res["passed"])

    def test_order_ignores_frame_events(self):
        events = [self._ev(0, "blink", 1000), self._ev(1, "frame", 2000),
                  self._ev(2, "smile", 4000)]
        res = kyc._validate_event_order(events, ["blink", "smile"])
        self.assertTrue(res["passed"], res["detail"])

    def test_non_increasing_seq_fails(self):
        events = [self._ev(0, "blink", 1000), self._ev(0, "smile", 3000)]
        res = kyc._validate_event_order(events, ["blink", "smile"])
        self.assertFalse(res["passed"])

    def test_unknown_event_fails(self):
        events = [self._ev(0, "backflip", 1000)]
        res = kyc._validate_event_order(events, ["blink"])
        self.assertFalse(res["passed"])

    # ── timing check ──────────────────────────────────────────────────────────
    def test_timing_plausible(self):
        events = [self._ev(0, "blink", 1000), self._ev(1, "smile", 4000),
                  self._ev(2, "turnLeft", 9000)]
        res = kyc._validate_event_timing(events)
        self.assertTrue(res["passed"], res["detail"])

    def test_timing_too_fast_fails(self):
        events = [self._ev(0, "blink", 1000), self._ev(1, "smile", 1050)]  # 50ms dwell
        res = kyc._validate_event_timing(events)
        self.assertFalse(res["passed"])

    def test_timing_non_monotonic_fails(self):
        events = [self._ev(0, "blink", 5000), self._ev(1, "smile", 4000)]
        res = kyc._validate_event_timing(events)
        self.assertFalse(res["passed"])

    def test_timing_too_slow_fails(self):
        events = [self._ev(0, "blink", 1000), self._ev(1, "smile", 1000 + 31000)]
        res = kyc._validate_event_timing(events)
        self.assertFalse(res["passed"])

    def test_timing_missing_timestamp_fails_closed(self):
        """Server may send timestamp_ms=null — timing must fail closed, never crash."""
        events = [self._ev(0, "blink", 1000), self._ev(1, "smile", None)]
        res = kyc._validate_event_timing(events)
        self.assertFalse(res["passed"])
        self.assertIn("missing", res["detail"])

    # ── blendshape event matching ─────────────────────────────────────────────
    def _analysis(self, bs=None, yaw=None, pitch=None):
        return {"blendshapes": bs or {}, "yaw_deg": yaw, "pitch_deg": pitch}

    def test_blink_match(self):
        ok, _ = kyc._event_matches_analysis(
            "blink", self._analysis({"eyeBlinkLeft": 0.9, "eyeBlinkRight": 0.8}))
        self.assertTrue(ok)

    def test_blink_no_match(self):
        ok, _ = kyc._event_matches_analysis(
            "blink", self._analysis({"eyeBlinkLeft": 0.1, "eyeBlinkRight": 0.1}))
        self.assertFalse(ok)

    def test_smile_match(self):
        ok, _ = kyc._event_matches_analysis(
            "smile", self._analysis({"mouthSmileLeft": 0.7, "mouthSmileRight": 0.6}))
        self.assertTrue(ok)

    def test_jawopen_match(self):
        ok, _ = kyc._event_matches_analysis("jawOpen", self._analysis({"jawOpen": 0.8}))
        self.assertTrue(ok)

    def test_turn_left_right_signs(self):
        ok_l, _ = kyc._event_matches_analysis("turnLeft", self._analysis(yaw=25.0))
        ok_r, _ = kyc._event_matches_analysis("turnRight", self._analysis(yaw=-25.0))
        self.assertTrue(ok_l)
        self.assertTrue(ok_r)
        bad, _ = kyc._event_matches_analysis("turnLeft", self._analysis(yaw=-25.0))
        self.assertFalse(bad)

    def test_nod_pitch(self):
        ok, _ = kyc._event_matches_analysis("nod", self._analysis(pitch=-15.0))
        self.assertTrue(ok)
        ok2, _ = kyc._event_matches_analysis("nod", self._analysis(pitch=2.0))
        self.assertFalse(ok2)

    # ── blendshape verification orchestration (analyzer mocked) ───────────────
    def test_verify_blendshapes_all_corroborated(self):
        events = [self._ev(0, "blink", 1000), self._ev(1, "smile", 4000)]
        frames = ["frameA", "frameB"]

        def fake_analyze(frame_b64):
            if frame_b64 == "frameA":
                return self._analysis({"eyeBlinkLeft": 0.9, "eyeBlinkRight": 0.9})
            return self._analysis({"mouthSmileLeft": 0.8, "mouthSmileRight": 0.8})

        with patch.object(kyc, "_analyze_frame_blendshapes", side_effect=fake_analyze):
            res = kyc._verify_blendshapes(events, frames)
        self.assertTrue(res["passed"], res["detail"])
        self.assertEqual(len(res["per_event"]), 2)

    def test_verify_blendshapes_uncorroborated(self):
        events = [self._ev(0, "blink", 1000), self._ev(1, "smile", 4000)]
        frames = ["frameA", "frameB"]

        def fake_analyze(frame_b64):
            return self._analysis({})  # neutral face — no event corroborated

        with patch.object(kyc, "_analyze_frame_blendshapes", side_effect=fake_analyze):
            res = kyc._verify_blendshapes(events, frames)
        self.assertFalse(res["passed"])

    def test_verify_blendshapes_no_frames_fails(self):
        events = [self._ev(0, "blink", 1000)]
        res = kyc._verify_blendshapes(events, [])
        self.assertFalse(res["passed"])

    def test_verify_blendshapes_analyzer_error_propagates(self):
        """Fail-closed: mediapipe unavailable must raise, not return success."""
        events = [self._ev(0, "blink", 1000)]
        with patch.object(kyc, "_analyze_frame_blendshapes",
                          side_effect=RuntimeError("mediapipe_unavailable: not installed")):
            with self.assertRaises(RuntimeError):
                kyc._verify_blendshapes(events, ["frameA"])

    # ── cross-frame consistency helpers ───────────────────────────────────────
    def test_cosine_similarity(self):
        self.assertAlmostEqual(kyc._cosine_similarity([1, 0], [1, 0]), 1.0)
        self.assertAlmostEqual(kyc._cosine_similarity([1, 0], [0, 1]), 0.0)
        self.assertEqual(kyc._cosine_similarity([0, 0], [1, 1]), 0.0)

    def test_synthetic_user_id_removed(self):
        """Residual #9: the enroll+match fallback (synthetic negative user ids
        writing into biometric_embeddings, hardcoded quality_score) is gone."""
        self.assertFalse(hasattr(kyc, "_synthetic_challenge_user_id"))

    def test_frame_embeddings_fail_closed_without_url(self):
        """rust-biometric URL unset → RuntimeError (fail-closed → HTTP 503)."""
        import asyncio
        old = kyc.RUST_BIOMETRIC_URL
        kyc.RUST_BIOMETRIC_URL = ""
        try:
            with self.assertRaises(RuntimeError):
                asyncio.run(kyc._frame_embeddings(["f0", "f1"]))
        finally:
            kyc.RUST_BIOMETRIC_URL = old

    def test_frame_embeddings_uses_stateless_embed_only(self):
        """Residual #9: consistency check must call ONLY POST /embed
        (image base64 → embedding, no persistence) — never enroll/match."""
        import asyncio

        calls = []

        class _Resp:
            def __init__(self, payload):
                self._payload = payload

            def raise_for_status(self):
                pass

            def json(self):
                return self._payload

        class _Client:
            async def post(self, url, json=None):
                calls.append((url, json))
                return _Resp({"embedding": [1.0, 0.0]})

        old_url, old_client_fn = kyc.RUST_BIOMETRIC_URL, kyc.get_http_client
        kyc.RUST_BIOMETRIC_URL = "http://rust-biometric:8090"
        kyc.get_http_client = lambda timeout=None: _Client()
        try:
            embeddings, min_sim = asyncio.run(kyc._frame_embeddings(["f0", "f1"]))
        finally:
            kyc.RUST_BIOMETRIC_URL, kyc.get_http_client = old_url, old_client_fn

        self.assertEqual(len(calls), 2)
        for url, body in calls:
            self.assertEqual(url, "http://rust-biometric:8090/embed")
            self.assertEqual(set(body.keys()), {"image_base64"})  # no user_id, no quality_score
        self.assertEqual(len(embeddings), 2)
        self.assertAlmostEqual(min_sim, 1.0)

    def test_frame_embeddings_fail_closed_on_http_error(self):
        """rust-biometric error → RuntimeError (fail-closed → HTTP 503), no fallback."""
        import asyncio
        import httpx

        class _Client:
            async def post(self, url, json=None):
                raise httpx.ConnectError("connection refused")

        old_url, old_client_fn = kyc.RUST_BIOMETRIC_URL, kyc.get_http_client
        kyc.RUST_BIOMETRIC_URL = "http://rust-biometric:8090"
        kyc.get_http_client = lambda timeout=None: _Client()
        try:
            with self.assertRaises(RuntimeError):
                asyncio.run(kyc._frame_embeddings(["f0", "f1"]))
        finally:
            kyc.RUST_BIOMETRIC_URL, kyc.get_http_client = old_url, old_client_fn

    # ── public method labels ──────────────────────────────────────────────────
    def test_public_method_labels(self):
        self.assertEqual(kyc._public_method("minifasnet"), "minifasnet-passive")
        self.assertEqual(kyc._public_method("iproov"), "iproov-commercial")
        self.assertEqual(kyc._public_method("onfido"), "onfido-commercial")

    def test_response_models_default_uncertified(self):
        resp = kyc.ChallengeValidateResponse(
            session_nonce="n", passed=False, checks={}, per_event=[],
            consistency_score=None, risk_flags=[], processing_time_ms=1,
            validated_at="2026-01-01T00:00:00+00:00",
        )
        self.assertFalse(resp.certified)
        self.assertEqual(resp.method, "mediapipe-challenge")


if __name__ == "__main__":
    unittest.main(verbosity=2)
