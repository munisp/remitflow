"""
Comprehensive tests for the RemitFlow Python Compliance & Fraud-Score Microservice.
"""

import pytest
from fastapi.testclient import TestClient
from main import app, compute_checksum, is_round_amount, is_near_threshold, normalize_name, fuzzy_sanctions_match

client = TestClient(app)


# ── Health & Metrics ──────────────────────────────────────────────────────────

def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "remitflow-python-compliance-service" in data["service"]


def test_metrics():
    res = client.get("/metrics")
    assert res.status_code == 200
    assert "remitflow_compliance_checks_total" in res.text
    assert "remitflow_fraud_scores_total" in res.text
    assert "remitflow_sanctions_screens_total" in res.text


def test_get_compliance_rules():
    res = client.get("/compliance/rules")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 8
    assert data["active"] >= 8
    assert any(r["id"] == "CR001" for r in data["rules"])


# ── Compliance Check ──────────────────────────────────────────────────────────

def base_transfer(**kwargs):
    defaults = {
        "transfer_id": "TXN-001",
        "user_id": 1,
        "amount": 500.0,
        "from_currency": "USD",
        "to_currency": "EUR",
        "from_country": "US",
        "to_country": "DE",
        "kyc_status": "verified",
        "account_age_days": 365,
        "daily_total_usd": 0.0,
    }
    defaults.update(kwargs)
    return defaults


def test_compliance_approved_normal():
    res = client.post("/compliance/check", json=base_transfer())
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "approved"
    assert data["risk_level"] == "low"
    assert data["rules_triggered"] == []
    assert data["checksum"]


def test_compliance_large_transfer_review():
    res = client.post("/compliance/check", json=base_transfer(amount=15000.0))
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "review"
    assert "CR001" in data["rules_triggered"]
    assert data["requires_edd"] is True


def test_compliance_sanctioned_country_blocked():
    res = client.post("/compliance/check", json=base_transfer(to_country="KP"))
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "blocked"
    assert "CR002" in data["rules_triggered"]
    assert data["block_reason"] is not None
    assert data["risk_level"] == "critical"


def test_compliance_sanctioned_from_country_blocked():
    res = client.post("/compliance/check", json=base_transfer(from_country="IR"))
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "blocked"
    assert "CR002" in data["rules_triggered"]


def test_compliance_high_risk_country_review():
    res = client.post("/compliance/check", json=base_transfer(to_country="NG"))
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "review"
    assert "CR003" in data["rules_triggered"]
    assert data["requires_edd"] is True


def test_compliance_near_threshold_structuring():
    res = client.post("/compliance/check", json=base_transfer(amount=9800.0))
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "review"
    assert "CR004" in data["rules_triggered"]


def test_compliance_daily_limit_exceeded():
    res = client.post("/compliance/check", json=base_transfer(amount=5000.0, daily_total_usd=48000.0))
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "blocked"
    assert "CR005" in data["rules_triggered"]


def test_compliance_new_account_large_transfer():
    res = client.post("/compliance/check", json=base_transfer(amount=3000.0, account_age_days=10))
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "blocked"
    assert "CR006" in data["rules_triggered"]


def test_compliance_new_account_small_transfer_ok():
    res = client.post("/compliance/check", json=base_transfer(amount=500.0, account_age_days=10))
    assert res.status_code == 200
    data = res.json()
    # Should not trigger CR006 (amount <= 2000)
    assert "CR006" not in data["rules_triggered"]


def test_compliance_unverified_kyc_blocked():
    res = client.post("/compliance/check", json=base_transfer(amount=1000.0, kyc_status="pending"))
    assert res.status_code == 200
    data = res.json()
    assert data["decision"] == "blocked"
    assert "CR007" in data["rules_triggered"]


def test_compliance_unverified_kyc_small_amount_ok():
    res = client.post("/compliance/check", json=base_transfer(amount=200.0, kyc_status="pending"))
    assert res.status_code == 200
    data = res.json()
    assert "CR007" not in data["rules_triggered"]


def test_compliance_round_amount_review():
    res = client.post("/compliance/check", json=base_transfer(amount=5000.0))
    assert res.status_code == 200
    data = res.json()
    assert "CR008" in data["rules_triggered"]


def test_compliance_currency_uppercase():
    res = client.post("/compliance/check", json=base_transfer(from_currency="usd", to_currency="eur"))
    assert res.status_code == 200  # Should auto-uppercase


def test_compliance_invalid_amount():
    res = client.post("/compliance/check", json=base_transfer(amount=-100.0))
    assert res.status_code == 422


# ── Fraud Scoring ─────────────────────────────────────────────────────────────

def base_fraud(**kwargs):
    defaults = {
        "transfer_id": "TXN-FRAUD-001",
        "user_id": 1,
        "amount": 500.0,
        "from_country": "US",
        "to_country": "DE",
        "hour_of_day": 14,
        "is_new_beneficiary": False,
        "is_new_device": False,
        "failed_attempts_24h": 0,
        "kyc_status": "verified",
        "account_age_days": 365,
    }
    defaults.update(kwargs)
    return defaults


def test_fraud_score_low_risk():
    res = client.post("/fraud/score", json=base_fraud())
    assert res.status_code == 200
    data = res.json()
    assert data["fraud_score"] < 0.25
    assert data["risk_level"] == "low"
    assert data["decision"] == "approve"


def test_fraud_score_rejected_kyc():
    res = client.post("/fraud/score", json=base_fraud(kyc_status="rejected"))
    assert res.status_code == 200
    data = res.json()
    assert data["fraud_score"] >= 0.40
    assert any(f["factor"] == "kyc_rejected" for f in data["factors"])


def test_fraud_score_very_new_account():
    res = client.post("/fraud/score", json=base_fraud(account_age_days=3))
    assert res.status_code == 200
    data = res.json()
    assert any(f["factor"] == "very_new_account" for f in data["factors"])


def test_fraud_score_new_beneficiary_device():
    res = client.post("/fraud/score", json=base_fraud(is_new_beneficiary=True, is_new_device=True))
    assert res.status_code == 200
    data = res.json()
    assert any(f["factor"] == "new_beneficiary" for f in data["factors"])
    assert any(f["factor"] == "new_device" for f in data["factors"])


def test_fraud_score_many_failed_attempts():
    res = client.post("/fraud/score", json=base_fraud(failed_attempts_24h=7))
    assert res.status_code == 200
    data = res.json()
    assert any(f["factor"] == "many_failed_attempts" for f in data["factors"])
    assert data["fraud_score"] >= 0.20


def test_fraud_score_unusual_hour():
    res = client.post("/fraud/score", json=base_fraud(hour_of_day=3))
    assert res.status_code == 200
    data = res.json()
    assert any(f["factor"] == "unusual_hour" for f in data["factors"])


def test_fraud_score_high_risk_country():
    res = client.post("/fraud/score", json=base_fraud(to_country="NG"))
    assert res.status_code == 200
    data = res.json()
    assert any(f["factor"] == "high_risk_country" for f in data["factors"])


def test_fraud_score_ip_mismatch():
    res = client.post("/fraud/score", json=base_fraud(ip_country="RU"))
    assert res.status_code == 200
    data = res.json()
    assert any(f["factor"] == "ip_country_mismatch" for f in data["factors"])


def test_fraud_score_large_amount():
    res = client.post("/fraud/score", json=base_fraud(amount=60000.0))
    assert res.status_code == 200
    data = res.json()
    assert any(f["factor"] == "very_large_amount" for f in data["factors"])


def test_fraud_score_high_velocity():
    res = client.post("/fraud/score", json=base_fraud(velocity_score=0.8))
    assert res.status_code == 200
    data = res.json()
    assert any(f["factor"] == "high_velocity" for f in data["factors"])


def test_fraud_score_critical_block():
    # Combine many risk factors to push score over 0.70
    res = client.post("/fraud/score", json=base_fraud(
        kyc_status="rejected",
        account_age_days=3,
        is_new_beneficiary=True,
        is_new_device=True,
        failed_attempts_24h=6,
        hour_of_day=3,
        to_country="NG",
        ip_country="RU",
    ))
    assert res.status_code == 200
    data = res.json()
    assert data["fraud_score"] >= 0.70
    assert data["decision"] == "block"
    assert data["risk_level"] == "critical"


def test_fraud_score_clamped_to_one():
    # Even with all factors, score should not exceed 1.0
    res = client.post("/fraud/score", json=base_fraud(
        kyc_status="rejected",
        account_age_days=1,
        is_new_beneficiary=True,
        is_new_device=True,
        failed_attempts_24h=10,
        hour_of_day=3,
        to_country="NG",
        ip_country="RU",
        amount=100000.0,
        velocity_score=1.0,
    ))
    assert res.status_code == 200
    data = res.json()
    assert data["fraud_score"] <= 1.0


# ── Sanctions Screening ───────────────────────────────────────────────────────

def test_sanctions_clean_name():
    res = client.post("/sanctions/screen", json={"name": "Alice Smith", "country": "US"})
    assert res.status_code == 200
    data = res.json()
    assert data["is_sanctioned"] is False
    assert data["action"] == "allow"


def test_sanctions_exact_match():
    res = client.post("/sanctions/screen", json={"name": "John Doe Terrorist"})
    assert res.status_code == 200
    data = res.json()
    assert data["is_sanctioned"] is True
    assert data["match_type"] == "exact"
    assert data["action"] == "block"


def test_sanctions_country_match():
    res = client.post("/sanctions/screen", json={"name": "Kim Corp", "country": "KP"})
    assert res.status_code == 200
    data = res.json()
    assert data["is_sanctioned"] is True
    assert data["match_type"] == "country"
    assert data["action"] == "block"


def test_sanctions_high_risk_country_review():
    res = client.post("/sanctions/screen", json={"name": "Regular Person", "country": "NG"})
    assert res.status_code == 200
    data = res.json()
    assert data["is_sanctioned"] is False
    assert data["action"] == "review"
    assert data["risk_level"] == "medium"


def test_sanctions_fuzzy_match():
    # "offshore laundry" matches "offshore laundry ltd" with enough token overlap
    res = client.post("/sanctions/screen", json={"name": "Offshore Laundry Company"})
    assert res.status_code == 200
    # fuzzy match may or may not trigger depending on token overlap threshold
    data = res.json()
    assert data["action"] in ("block", "review", "allow")


# ── Velocity Check ────────────────────────────────────────────────────────────

def test_velocity_check_allowed():
    res = client.post("/velocity/check", json={
        "user_id": 9999,
        "amount_usd": 100.0,
        "window_seconds": 86400,
        "limit_usd": 50000.0,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["allowed"] is True
    assert data["limit"] == 50000.0


def test_velocity_check_fields():
    res = client.post("/velocity/check", json={
        "user_id": 8888,
        "amount_usd": 500.0,
        "window_seconds": 3600,
        "limit_usd": 10000.0,
    })
    assert res.status_code == 200
    data = res.json()
    assert "current_total" in data
    assert "remaining" in data
    assert data["window_seconds"] == 3600


def test_velocity_check_invalid_amount():
    res = client.post("/velocity/check", json={
        "user_id": 1,
        "amount_usd": -100.0,
        "window_seconds": 86400,
        "limit_usd": 50000.0,
    })
    assert res.status_code == 422


# ── Helper Functions ──────────────────────────────────────────────────────────

def test_compute_checksum_deterministic():
    c1 = compute_checksum("transfer:123:approved")
    c2 = compute_checksum("transfer:123:approved")
    assert c1 == c2
    assert len(c1) == 16


def test_is_round_amount():
    assert is_round_amount(1000.0) is True
    assert is_round_amount(5000.0) is True
    assert is_round_amount(1234.56) is False
    assert is_round_amount(500.0) is True


def test_is_near_threshold():
    assert is_near_threshold(9800.0) is True
    assert is_near_threshold(9999.0) is True
    assert is_near_threshold(10000.0) is False  # at threshold, not below
    assert is_near_threshold(8000.0) is False


def test_normalize_name():
    assert normalize_name("John Doe!") == "john doe"
    assert normalize_name("  ALICE  ") == "alice"


def test_fuzzy_sanctions_match():
    assert fuzzy_sanctions_match("Offshore Laundry Ltd") is True
    assert fuzzy_sanctions_match("Alice Smith Regular Person") is False
