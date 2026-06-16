"""Tests for the anomaly detector service."""
import json
import os
import pickle
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Make the service importable
sys.path.insert(0, str(Path(__file__).parent))

MODELS_DIR = Path(__file__).parent / "models"


class TestModelTraining(unittest.TestCase):
    """Verify trained models exist and produce valid scores."""

    def test_isolation_forest_model_exists(self):
        model_path = MODELS_DIR / "isolation_forest.pkl"
        self.assertTrue(model_path.exists(), "isolation_forest.pkl not found")

    def test_login_velocity_model_exists(self):
        model_path = MODELS_DIR / "login_velocity.pkl"
        self.assertTrue(model_path.exists(), "login_velocity.pkl not found")

    def test_beneficiary_change_model_exists(self):
        model_path = MODELS_DIR / "beneficiary_change.pkl"
        self.assertTrue(model_path.exists(), "beneficiary_change.pkl not found")

    def test_isolation_forest_prediction(self):
        model_path = MODELS_DIR / "isolation_forest.pkl"
        if not model_path.exists():
            self.skipTest("Model not trained yet")

        import numpy as np
        with open(model_path, "rb") as f:
            bundle = pickle.load(f)

        model = bundle["model"]
        scaler = bundle["scaler"]
        features = bundle["features"]

        self.assertEqual(len(features), 8, "Expected 8 features for anomaly detection")

        # Normal transaction
        normal = np.array([[50.0, 14, 2, 5, 30, 0, 0, 1.0]])
        normal_scaled = scaler.transform(normal)
        pred = model.predict(normal_scaled)
        self.assertIn(pred[0], [-1, 1], "Prediction should be -1 or 1")

        # Anomalous transaction (very high amount, unusual hour, rapid velocity)
        anomaly = np.array([[50000.0, 3, 20, 60, 10000, 1, 1, 15.0]])
        anom_scaled = scaler.transform(anomaly)
        anom_pred = model.predict(anom_scaled)
        self.assertEqual(anom_pred[0], -1, "High-risk transaction should be flagged")

    def test_model_metadata(self):
        model_path = MODELS_DIR / "isolation_forest.pkl"
        if not model_path.exists():
            self.skipTest("Model not trained yet")

        with open(model_path, "rb") as f:
            bundle = pickle.load(f)

        self.assertIn("version", bundle)
        self.assertIn("trained_at", bundle)
        self.assertIn("detection_rate", bundle)
        self.assertGreaterEqual(bundle["detection_rate"], 0.9)
        self.assertLessEqual(bundle["false_positive_rate"], 0.1)

    def test_detection_rate_above_threshold(self):
        model_path = MODELS_DIR / "isolation_forest.pkl"
        if not model_path.exists():
            self.skipTest("Model not trained yet")

        with open(model_path, "rb") as f:
            bundle = pickle.load(f)

        self.assertGreaterEqual(
            bundle["detection_rate"], 0.95,
            f"Detection rate {bundle['detection_rate']} below 95% threshold"
        )


class TestSafeDecimalArithmetic(unittest.TestCase):
    """Test that financial math avoids float precision issues."""

    def test_float_precision_issue(self):
        # This is the classic JS/Python float issue: 0.1 + 0.2 != 0.3
        result = 0.1 + 0.2
        self.assertNotEqual(result, 0.3, "Float precision issue exists")

    def test_decimal_precision(self):
        from decimal import Decimal
        result = Decimal("0.1") + Decimal("0.2")
        self.assertEqual(result, Decimal("0.3"), "Decimal math should be exact")

    def test_money_operations(self):
        from decimal import Decimal
        balance = Decimal("1000.00")
        fee = Decimal("2.50")
        amount = Decimal("500.00")
        remaining = balance - amount - fee
        self.assertEqual(remaining, Decimal("497.50"))


if __name__ == "__main__":
    unittest.main()
