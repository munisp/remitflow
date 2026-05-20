"""
RemitFlow — Python Anomaly Detector Tests
"""
import time
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


# ─── ATO Tests ────────────────────────────────────────────────────────────────

def test_ato_normal_login():
    """Normal login from same location should not be flagged."""
    resp = client.post("/detect/ato", json={
        "user_id": "user_normal_1",
        "ip_address": "1.2.3.4",
        "latitude": 51.5,
        "longitude": -0.1,
        "timestamp_ms": int(time.time() * 1000),
        "device_fingerprint": "fp_abc123",
        "user_agent": "Mozilla/5.0"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "allow"
    assert data["risk_score"] < 0.5


def test_ato_impossible_travel():
    """Login from London then immediately from Sydney should trigger impossible travel."""
    base_ts = int(time.time() * 1000)
    user_id = "user_travel_test"

    # First login: London
    client.post("/detect/ato", json={
        "user_id": user_id,
        "ip_address": "5.6.7.8",
        "latitude": 51.5,
        "longitude": -0.1,
        "timestamp_ms": base_ts,
        "device_fingerprint": "fp_london",
        "user_agent": "Mozilla/5.0"
    })

    # Second login: Sydney, 10 minutes later (17,000 km away)
    resp = client.post("/detect/ato", json={
        "user_id": user_id,
        "ip_address": "9.10.11.12",
        "latitude": -33.9,
        "longitude": 151.2,
        "timestamp_ms": base_ts + 600_000,  # 10 minutes later
        "device_fingerprint": "fp_sydney",
        "user_agent": "Mozilla/5.0"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["risk_score"] >= 0.9
    assert any("impossible_travel" in f for f in data["flags"])
    assert data["action"] == "block"


def test_ato_high_velocity():
    """Many logins from same IP in 5 minutes should trigger velocity flag."""
    ip = "20.21.22.23"
    base_ts = int(time.time() * 1000)
    user_id_prefix = "velocity_user_"

    # Send 25 login events from the same IP
    for i in range(25):
        client.post("/detect/ato", json={
            "user_id": f"{user_id_prefix}{i}",
            "ip_address": ip,
            "latitude": 40.7,
            "longitude": -74.0,
            "timestamp_ms": base_ts + i * 10_000,  # 10 seconds apart
            "device_fingerprint": f"fp_{i}",
            "user_agent": "python-requests/2.28"
        })

    resp = client.post("/detect/ato", json={
        "user_id": f"{user_id_prefix}final",
        "ip_address": ip,
        "latitude": 40.7,
        "longitude": -74.0,
        "timestamp_ms": base_ts + 25 * 10_000,
        "device_fingerprint": "fp_final",
        "user_agent": "python-requests/2.28"
    })
    data = resp.json()
    assert data["risk_score"] >= 0.5


# ─── Credential Stuffing Tests ────────────────────────────────────────────────

def test_credential_stuffing_normal():
    """Single failed login should not be flagged."""
    resp = client.post("/detect/credential-stuffing", json={
        "ip_address": "30.31.32.33",
        "timestamp_ms": int(time.time() * 1000),
        "success": False,
        "target_user_id": "user_cs_1"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "allow"


def test_credential_stuffing_attack():
    """High-volume failures against many accounts should be flagged."""
    ip = "40.41.42.43"
    base_ts = int(time.time() * 1000)

    # Simulate 60 failed logins against 25 different accounts
    for i in range(60):
        client.post("/detect/credential-stuffing", json={
            "ip_address": ip,
            "timestamp_ms": base_ts + i * 5_000,
            "success": False,
            "target_user_id": f"victim_{i % 25}"
        })

    resp = client.post("/detect/credential-stuffing", json={
        "ip_address": ip,
        "timestamp_ms": base_ts + 61 * 5_000,
        "success": False,
        "target_user_id": "victim_final"
    })
    data = resp.json()
    assert data["risk_score"] >= 0.7
    assert len(data["flags"]) > 0


# ─── BEC Tests ────────────────────────────────────────────────────────────────

def test_bec_last_minute_change():
    """Beneficiary changed 30 minutes before a large transfer should be high risk."""
    now_ms = int(time.time() * 1000)
    resp = client.post("/detect/bec", json={
        "user_id": "user_bec_1",
        "beneficiary_id": "ben_new_001",
        "beneficiary_changed_at_ms": now_ms - 1_800_000,  # 30 min ago
        "transfer_amount_usd": 15_000.0,
        "transfer_initiated_at_ms": now_ms,
        "destination_country": "NG",
        "user_typical_countries": ["GB", "US", "DE"]
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["risk_score"] >= 0.75
    assert any("last_minute" in f or "recent_beneficiary" in f for f in data["flags"])
    assert data["action"] in ("challenge", "block")


def test_bec_normal_transfer():
    """Transfer to a long-standing beneficiary in a known country should be low risk."""
    now_ms = int(time.time() * 1000)
    resp = client.post("/detect/bec", json={
        "user_id": "user_bec_2",
        "beneficiary_id": "ben_old_001",
        "beneficiary_changed_at_ms": now_ms - 30 * 24 * 3_600_000,  # 30 days ago
        "transfer_amount_usd": 500.0,
        "transfer_initiated_at_ms": now_ms,
        "destination_country": "GB",
        "user_typical_countries": ["GB", "US"]
    })
    data = resp.json()
    assert data["risk_score"] < 0.5
    assert data["action"] == "allow"


# ─── Round-Trip Tests ─────────────────────────────────────────────────────────

def test_round_trip_structuring():
    """Multiple transactions just below $10k threshold should flag structuring."""
    now_ms = int(time.time() * 1000)
    transfers = [
        {"amount_usd": 9_500.0, "currency": "USD", "destination_account": f"acc_{i}",
         "timestamp_ms": now_ms + i * 3_600_000, "direction": "out"}
        for i in range(4)
    ]
    resp = client.post("/detect/round-trip", json={
        "user_id": "user_rt_1",
        "recent_transfers": transfers,
        "reporting_threshold_usd": 10_000.0
    })
    data = resp.json()
    assert data["risk_score"] >= 0.8
    assert any("structuring" in f for f in data["flags"])


def test_round_trip_layering():
    """Rapid transfers to multiple accounts in <1h should flag layering."""
    now_ms = int(time.time() * 1000)
    transfers = [
        {"amount_usd": 2_000.0, "currency": "USD", "destination_account": f"acc_layer_{i}",
         "timestamp_ms": now_ms + i * 600_000, "direction": "out"}  # 10 min apart
        for i in range(5)
    ]
    resp = client.post("/detect/round-trip", json={
        "user_id": "user_rt_2",
        "recent_transfers": transfers,
        "reporting_threshold_usd": 10_000.0
    })
    data = resp.json()
    assert data["risk_score"] >= 0.7
    assert any("layering" in f for f in data["flags"])


# ─── Ransomware Tests ─────────────────────────────────────────────────────────

def test_ransomware_bulk_export():
    """Many export API calls should flag bulk data export."""
    now_ms = int(time.time() * 1000)
    events = [
        {"endpoint": "/api/trpc/transactions.export", "method": "GET",
         "response_size_bytes": 500_000, "timestamp_ms": now_ms + i * 10_000}
        for i in range(8)
    ]
    resp = client.post("/detect/ransomware", json={
        "ip_address": "50.51.52.53",
        "user_id": "user_rw_1",
        "recent_api_events": events
    })
    data = resp.json()
    assert data["risk_score"] >= 0.8
    assert any("bulk_data_export" in f for f in data["flags"])


def test_ransomware_normal_usage():
    """Normal API usage should not be flagged."""
    now_ms = int(time.time() * 1000)
    events = [
        {"endpoint": "/api/trpc/dashboard.summary", "method": "GET",
         "response_size_bytes": 2_000, "timestamp_ms": now_ms + i * 60_000}
        for i in range(5)
    ]
    resp = client.post("/detect/ransomware", json={
        "ip_address": "60.61.62.63",
        "user_id": "user_rw_2",
        "recent_api_events": events
    })
    data = resp.json()
    assert data["risk_score"] < 0.5
    assert data["action"] == "allow"


# ─── Health Test ──────────────────────────────────────────────────────────────

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "python-anomaly-detector"
