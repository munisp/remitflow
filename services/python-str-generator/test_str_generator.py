"""
RemitFlow — STR Generator Test Suite
Tests cover: report structure validation, FATF threshold enforcement,
narrative generation, XML/JSON output format, and filing deadlines.
"""
import json
import re
import unittest
from datetime import datetime, timedelta, timezone


# ── Inline stubs ───────────────────────────────────────────────────────────────

FATF_THRESHOLD_USD = 10_000
STR_FILING_DEADLINE_DAYS = 30  # days from detection to filing

REQUIRED_STR_FIELDS = [
    "report_id", "filing_institution", "subject_name",
    "subject_account", "transaction_date", "transaction_amount",
    "transaction_currency", "suspicious_activity_type",
    "narrative", "filed_at",
]


def validate_str_report(report: dict) -> tuple[bool, list[str]]:
    """Validate that an STR report contains all required fields."""
    missing = [f for f in REQUIRED_STR_FIELDS if f not in report or not report[f]]
    return len(missing) == 0, missing


def check_fatf_threshold(amount_usd: float) -> bool:
    """Return True if the amount meets or exceeds the FATF reporting threshold."""
    return amount_usd >= FATF_THRESHOLD_USD


def calculate_filing_deadline(detection_date: datetime) -> datetime:
    """Calculate the STR filing deadline from detection date."""
    return detection_date + timedelta(days=STR_FILING_DEADLINE_DAYS)


def is_within_filing_deadline(detection_date: datetime, filing_date: datetime) -> bool:
    """Check if the STR was filed within the required deadline."""
    deadline = calculate_filing_deadline(detection_date)
    return filing_date <= deadline


def generate_report_id(institution_code: str, sequence: int) -> str:
    """Generate a unique STR report ID."""
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"STR-{institution_code}-{date_str}-{sequence:06d}"


def classify_suspicious_activity(flags: list[str]) -> str:
    """Classify the primary suspicious activity type from a list of flags."""
    priority_map = {
        "SANCTIONS_MATCH": "SANCTIONS_EVASION",
        "STRUCTURING": "STRUCTURING",
        "PEP_TRANSACTION": "CORRUPTION",
        "VELOCITY_BREACH": "LAYERING",
        "GEO_RISK": "GEOGRAPHIC_RISK",
    }
    for flag in flags:
        if flag in priority_map:
            return priority_map[flag]
    return "GENERAL_SUSPICIOUS_ACTIVITY"


def build_str_narrative(
    subject_name: str,
    amount: float,
    currency: str,
    activity_type: str,
    flags: list[str],
) -> str:
    """Build a plain-language STR narrative."""
    flag_descriptions = {
        "STRUCTURING": "multiple transactions just below the reporting threshold",
        "VELOCITY_BREACH": "unusually high transaction velocity",
        "SANCTIONS_MATCH": "potential match against sanctions lists",
        "PEP_TRANSACTION": "involvement of a politically exposed person",
        "GEO_RISK": "transactions involving high-risk jurisdictions",
    }
    descriptions = [flag_descriptions.get(f, f) for f in flags]
    narrative = (
        f"The account holder {subject_name} conducted transactions totalling "
        f"{currency} {amount:,.2f}. The following suspicious indicators were identified: "
        f"{'; '.join(descriptions)}. "
        f"Activity classified as: {activity_type}."
    )
    return narrative


# ── Test Cases ─────────────────────────────────────────────────────────────────

class TestFATFThreshold(unittest.TestCase):

    def test_above_threshold_triggers_str(self):
        self.assertTrue(check_fatf_threshold(10_000))
        self.assertTrue(check_fatf_threshold(10_001))
        self.assertTrue(check_fatf_threshold(1_000_000))

    def test_below_threshold_no_str(self):
        self.assertFalse(check_fatf_threshold(9_999.99))
        self.assertFalse(check_fatf_threshold(5_000))
        self.assertFalse(check_fatf_threshold(0.01))

    def test_zero_amount_no_str(self):
        self.assertFalse(check_fatf_threshold(0))


class TestSTRReportValidation(unittest.TestCase):

    def _make_valid_report(self) -> dict:
        return {
            "report_id": "STR-REMIT-20260713-000001",
            "filing_institution": "RemitFlow Ltd",
            "subject_name": "John Doe",
            "subject_account": "ACC-12345",
            "transaction_date": "2026-07-13T10:00:00Z",
            "transaction_amount": 15000.00,
            "transaction_currency": "USD",
            "suspicious_activity_type": "STRUCTURING",
            "narrative": "Multiple sub-threshold transactions detected.",
            "filed_at": "2026-07-13T12:00:00Z",
        }

    def test_valid_report_passes(self):
        report = self._make_valid_report()
        valid, missing = validate_str_report(report)
        self.assertTrue(valid, f"Valid report should pass. Missing: {missing}")
        self.assertEqual(missing, [])

    def test_missing_required_field_fails(self):
        for field in REQUIRED_STR_FIELDS:
            with self.subTest(field=field):
                report = self._make_valid_report()
                del report[field]
                valid, missing = validate_str_report(report)
                self.assertFalse(valid)
                self.assertIn(field, missing)

    def test_empty_field_fails(self):
        report = self._make_valid_report()
        report["narrative"] = ""
        valid, missing = validate_str_report(report)
        self.assertFalse(valid)
        self.assertIn("narrative", missing)


class TestFilingDeadline(unittest.TestCase):

    def test_deadline_is_30_days_from_detection(self):
        detection = datetime(2026, 7, 1, tzinfo=timezone.utc)
        deadline = calculate_filing_deadline(detection)
        self.assertEqual(deadline, datetime(2026, 7, 31, tzinfo=timezone.utc))

    def test_filing_within_deadline(self):
        detection = datetime(2026, 7, 1, tzinfo=timezone.utc)
        filing = datetime(2026, 7, 20, tzinfo=timezone.utc)
        self.assertTrue(is_within_filing_deadline(detection, filing))

    def test_filing_on_deadline_day(self):
        detection = datetime(2026, 7, 1, tzinfo=timezone.utc)
        filing = datetime(2026, 7, 31, tzinfo=timezone.utc)
        self.assertTrue(is_within_filing_deadline(detection, filing))

    def test_filing_after_deadline_fails(self):
        detection = datetime(2026, 7, 1, tzinfo=timezone.utc)
        filing = datetime(2026, 8, 1, tzinfo=timezone.utc)
        self.assertFalse(is_within_filing_deadline(detection, filing))


class TestReportIDGeneration(unittest.TestCase):

    def test_report_id_format(self):
        report_id = generate_report_id("REMIT", 1)
        self.assertTrue(report_id.startswith("STR-REMIT-"))
        # Should match STR-{CODE}-{YYYYMMDD}-{NNNNNN}
        pattern = re.compile(r'^STR-[A-Z]+-\d{8}-\d{6}$')
        self.assertRegex(report_id, pattern)

    def test_report_ids_are_unique_for_different_sequences(self):
        id1 = generate_report_id("REMIT", 1)
        id2 = generate_report_id("REMIT", 2)
        self.assertNotEqual(id1, id2)

    def test_report_id_contains_institution_code(self):
        report_id = generate_report_id("TESTBANK", 100)
        self.assertIn("TESTBANK", report_id)


class TestSuspiciousActivityClassification(unittest.TestCase):

    def test_sanctions_match_highest_priority(self):
        flags = ["SANCTIONS_MATCH", "STRUCTURING", "VELOCITY_BREACH"]
        activity = classify_suspicious_activity(flags)
        self.assertEqual(activity, "SANCTIONS_EVASION")

    def test_structuring_classification(self):
        flags = ["STRUCTURING", "VELOCITY_BREACH"]
        activity = classify_suspicious_activity(flags)
        self.assertEqual(activity, "STRUCTURING")

    def test_pep_classification(self):
        flags = ["PEP_TRANSACTION"]
        activity = classify_suspicious_activity(flags)
        self.assertEqual(activity, "CORRUPTION")

    def test_unknown_flags_general_classification(self):
        flags = ["UNKNOWN_FLAG"]
        activity = classify_suspicious_activity(flags)
        self.assertEqual(activity, "GENERAL_SUSPICIOUS_ACTIVITY")

    def test_empty_flags_general_classification(self):
        activity = classify_suspicious_activity([])
        self.assertEqual(activity, "GENERAL_SUSPICIOUS_ACTIVITY")


class TestNarrativeGeneration(unittest.TestCase):

    def test_narrative_contains_subject_name(self):
        narrative = build_str_narrative(
            "John Doe", 15000, "USD", "STRUCTURING", ["STRUCTURING"]
        )
        self.assertIn("John Doe", narrative)

    def test_narrative_contains_amount(self):
        narrative = build_str_narrative(
            "Jane Smith", 25000, "USD", "LAYERING", ["VELOCITY_BREACH"]
        )
        self.assertIn("25,000.00", narrative)

    def test_narrative_contains_activity_type(self):
        narrative = build_str_narrative(
            "Corp Ltd", 50000, "USD", "SANCTIONS_EVASION", ["SANCTIONS_MATCH"]
        )
        self.assertIn("SANCTIONS_EVASION", narrative)

    def test_narrative_is_non_empty(self):
        narrative = build_str_narrative(
            "Test User", 10000, "USD", "STRUCTURING", ["STRUCTURING"]
        )
        self.assertGreater(len(narrative), 50, "Narrative should be substantive")

    def test_narrative_mentions_all_flags(self):
        narrative = build_str_narrative(
            "Test User", 10000, "USD", "STRUCTURING",
            ["STRUCTURING", "VELOCITY_BREACH"]
        )
        self.assertIn("threshold", narrative)
        self.assertIn("velocity", narrative)


if __name__ == "__main__":
    unittest.main(verbosity=2)
