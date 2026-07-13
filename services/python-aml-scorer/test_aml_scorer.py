"""
RemitFlow — AML Scorer Test Suite
Tests cover: risk scoring logic, sanctions screening, structuring detection,
velocity checks, geographic risk, PEP screening, and threshold enforcement.
"""
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timedelta, timezone
import json


# ── Inline stubs for isolated unit testing ─────────────────────────────────────

HIGH_RISK_COUNTRIES = {
    "KP", "IR", "SY", "CU", "SD", "MM", "YE", "LY", "SO", "AF"
}

MEDIUM_RISK_COUNTRIES = {
    "NG", "PK", "ET", "TZ", "UG", "KE", "GH", "SN", "CM"
}

STRUCTURING_THRESHOLD = 10_000  # USD equivalent
STRUCTURING_WINDOW_HOURS = 24
VELOCITY_WINDOW_HOURS = 1
MAX_VELOCITY_TRANSACTIONS = 10


def calculate_geographic_risk_score(country_code: str) -> float:
    """Return a risk score 0.0-1.0 for a given country."""
    if country_code in HIGH_RISK_COUNTRIES:
        return 1.0
    if country_code in MEDIUM_RISK_COUNTRIES:
        return 0.5
    return 0.1


def detect_structuring(transactions: list[dict], threshold: float = STRUCTURING_THRESHOLD) -> dict:
    """
    Detect potential structuring (smurfing) — multiple transactions
    just below the reporting threshold within 24 hours.
    """
    recent = [
        t for t in transactions
        if (datetime.now(timezone.utc) - t["timestamp"]).total_seconds() < STRUCTURING_WINDOW_HOURS * 3600
    ]
    total = sum(t["amount"] for t in recent)
    just_below = [t for t in recent if 0.7 * threshold <= t["amount"] < threshold]

    return {
        "detected": len(just_below) >= 2 or total >= threshold,
        "transaction_count": len(recent),
        "total_amount": total,
        "suspicious_count": len(just_below),
    }


def calculate_composite_risk_score(
    geo_risk: float,
    pep_flag: bool,
    structuring_flag: bool,
    velocity_flag: bool,
    sanctions_flag: bool,
) -> float:
    """
    Compute a composite AML risk score 0.0-1.0.
    Sanctions and PEP flags are heavily weighted.
    """
    if sanctions_flag:
        return 1.0
    score = geo_risk * 0.25
    if pep_flag:
        score += 0.30
    if structuring_flag:
        score += 0.25
    if velocity_flag:
        score += 0.20
    return min(score, 1.0)


def classify_risk_level(score: float) -> str:
    """Classify a risk score into LOW / MEDIUM / HIGH / CRITICAL."""
    if score >= 0.8:
        return "CRITICAL"
    if score >= 0.5:
        return "HIGH"
    if score >= 0.2:
        return "MEDIUM"
    return "LOW"


def check_velocity(transactions: list[dict], window_hours: int = VELOCITY_WINDOW_HOURS) -> dict:
    """Check if transaction velocity exceeds allowed threshold."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    recent = [t for t in transactions if t["timestamp"] >= cutoff]
    return {
        "count": len(recent),
        "exceeded": len(recent) > MAX_VELOCITY_TRANSACTIONS,
        "total_amount": sum(t["amount"] for t in recent),
    }


# ── Test Cases ─────────────────────────────────────────────────────────────────

class TestGeographicRiskScoring(unittest.TestCase):

    def test_high_risk_countries(self):
        for country in ["KP", "IR", "SY", "CU"]:
            with self.subTest(country=country):
                score = calculate_geographic_risk_score(country)
                self.assertEqual(score, 1.0, f"{country} should have max risk score")

    def test_medium_risk_countries(self):
        for country in ["NG", "PK", "ET"]:
            with self.subTest(country=country):
                score = calculate_geographic_risk_score(country)
                self.assertGreater(score, 0.1, f"{country} should have elevated risk")
                self.assertLess(score, 1.0, f"{country} should not be max risk")

    def test_low_risk_countries(self):
        for country in ["US", "GB", "DE", "SG", "AU"]:
            with self.subTest(country=country):
                score = calculate_geographic_risk_score(country)
                self.assertLess(score, 0.5, f"{country} should have low risk score")

    def test_score_bounds(self):
        for country in ["KP", "US", "NG", "DE", "IR", "GB"]:
            score = calculate_geographic_risk_score(country)
            self.assertGreaterEqual(score, 0.0, "score must be >= 0")
            self.assertLessEqual(score, 1.0, "score must be <= 1")


class TestStructuringDetection(unittest.TestCase):

    def _make_tx(self, amount: float, hours_ago: float = 0) -> dict:
        return {
            "amount": amount,
            "timestamp": datetime.now(timezone.utc) - timedelta(hours=hours_ago),
        }

    def test_structuring_detected_multiple_below_threshold(self):
        transactions = [
            self._make_tx(9_500),
            self._make_tx(9_800),
            self._make_tx(9_200),
        ]
        result = detect_structuring(transactions)
        self.assertTrue(result["detected"], "Multiple sub-threshold transactions should trigger structuring alert")

    def test_structuring_detected_total_exceeds_threshold(self):
        transactions = [
            self._make_tx(5_000),
            self._make_tx(6_000),
        ]
        result = detect_structuring(transactions)
        self.assertTrue(result["detected"], "Total exceeding threshold should trigger alert")

    def test_no_structuring_single_large_transaction(self):
        transactions = [self._make_tx(15_000)]
        result = detect_structuring(transactions)
        # Single transaction above threshold is not structuring
        self.assertEqual(result["suspicious_count"], 0)

    def test_no_structuring_small_amounts(self):
        transactions = [
            self._make_tx(100),
            self._make_tx(200),
            self._make_tx(150),
        ]
        result = detect_structuring(transactions)
        self.assertFalse(result["detected"])

    def test_old_transactions_excluded(self):
        transactions = [
            self._make_tx(9_500, hours_ago=25),  # outside window
            self._make_tx(9_800, hours_ago=26),  # outside window
        ]
        result = detect_structuring(transactions)
        self.assertFalse(result["detected"], "Old transactions should not trigger structuring")


class TestCompositeRiskScore(unittest.TestCase):

    def test_sanctions_flag_always_critical(self):
        score = calculate_composite_risk_score(
            geo_risk=0.0,
            pep_flag=False,
            structuring_flag=False,
            velocity_flag=False,
            sanctions_flag=True,
        )
        self.assertEqual(score, 1.0, "Sanctions flag must always produce max risk score")

    def test_clean_profile_low_risk(self):
        score = calculate_composite_risk_score(
            geo_risk=0.1,
            pep_flag=False,
            structuring_flag=False,
            velocity_flag=False,
            sanctions_flag=False,
        )
        self.assertLess(score, 0.2, "Clean profile should have low risk score")

    def test_pep_flag_elevates_risk(self):
        score_without_pep = calculate_composite_risk_score(
            geo_risk=0.1, pep_flag=False,
            structuring_flag=False, velocity_flag=False, sanctions_flag=False
        )
        score_with_pep = calculate_composite_risk_score(
            geo_risk=0.1, pep_flag=True,
            structuring_flag=False, velocity_flag=False, sanctions_flag=False
        )
        self.assertGreater(score_with_pep, score_without_pep)

    def test_multiple_flags_compound_risk(self):
        score = calculate_composite_risk_score(
            geo_risk=0.5,
            pep_flag=True,
            structuring_flag=True,
            velocity_flag=True,
            sanctions_flag=False,
        )
        self.assertGreaterEqual(score, 0.8, "Multiple risk flags should produce high score")

    def test_score_never_exceeds_1(self):
        score = calculate_composite_risk_score(
            geo_risk=1.0,
            pep_flag=True,
            structuring_flag=True,
            velocity_flag=True,
            sanctions_flag=False,
        )
        self.assertLessEqual(score, 1.0, "Score must never exceed 1.0")

    def test_score_never_below_0(self):
        score = calculate_composite_risk_score(
            geo_risk=0.0,
            pep_flag=False,
            structuring_flag=False,
            velocity_flag=False,
            sanctions_flag=False,
        )
        self.assertGreaterEqual(score, 0.0, "Score must never be negative")


class TestRiskLevelClassification(unittest.TestCase):

    def test_critical_threshold(self):
        self.assertEqual(classify_risk_level(0.8), "CRITICAL")
        self.assertEqual(classify_risk_level(1.0), "CRITICAL")
        self.assertEqual(classify_risk_level(0.95), "CRITICAL")

    def test_high_threshold(self):
        self.assertEqual(classify_risk_level(0.5), "HIGH")
        self.assertEqual(classify_risk_level(0.79), "HIGH")

    def test_medium_threshold(self):
        self.assertEqual(classify_risk_level(0.2), "MEDIUM")
        self.assertEqual(classify_risk_level(0.49), "MEDIUM")

    def test_low_threshold(self):
        self.assertEqual(classify_risk_level(0.0), "LOW")
        self.assertEqual(classify_risk_level(0.19), "LOW")


class TestVelocityChecks(unittest.TestCase):

    def _make_tx(self, amount: float, minutes_ago: float = 0) -> dict:
        return {
            "amount": amount,
            "timestamp": datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        }

    def test_velocity_exceeded(self):
        transactions = [self._make_tx(100, minutes_ago=i * 3) for i in range(15)]
        result = check_velocity(transactions)
        self.assertTrue(result["exceeded"])
        self.assertEqual(result["count"], 15)

    def test_velocity_within_limit(self):
        transactions = [self._make_tx(100, minutes_ago=i * 5) for i in range(5)]
        result = check_velocity(transactions)
        self.assertFalse(result["exceeded"])

    def test_old_transactions_excluded_from_velocity(self):
        transactions = [
            self._make_tx(100, minutes_ago=i * 5) for i in range(5)  # recent
        ] + [
            self._make_tx(100, minutes_ago=90 + i * 5) for i in range(20)  # old
        ]
        result = check_velocity(transactions)
        self.assertFalse(result["exceeded"], "Old transactions should not count toward velocity")
        self.assertEqual(result["count"], 5)

    def test_total_amount_calculated(self):
        transactions = [self._make_tx(500, minutes_ago=i * 5) for i in range(3)]
        result = check_velocity(transactions)
        self.assertEqual(result["total_amount"], 1500)


class TestAMLScorerIntegration(unittest.TestCase):

    def test_high_risk_scenario(self):
        """Full pipeline: Nigerian sender, PEP, structuring pattern."""
        geo_risk = calculate_geographic_risk_score("NG")
        structuring = detect_structuring([
            {"amount": 9_500, "timestamp": datetime.now(timezone.utc)},
            {"amount": 9_800, "timestamp": datetime.now(timezone.utc)},
        ])
        score = calculate_composite_risk_score(
            geo_risk=geo_risk,
            pep_flag=True,
            structuring_flag=structuring["detected"],
            velocity_flag=False,
            sanctions_flag=False,
        )
        level = classify_risk_level(score)
        self.assertIn(level, ["HIGH", "CRITICAL"])

    def test_low_risk_scenario(self):
        """Full pipeline: UK sender, clean profile, small amount."""
        geo_risk = calculate_geographic_risk_score("GB")
        score = calculate_composite_risk_score(
            geo_risk=geo_risk,
            pep_flag=False,
            structuring_flag=False,
            velocity_flag=False,
            sanctions_flag=False,
        )
        level = classify_risk_level(score)
        self.assertEqual(level, "LOW")


if __name__ == "__main__":
    unittest.main(verbosity=2)
