#!/usr/bin/env python3
"""
RemitFlow Microservices Smoke Test Suite
Tests: analytics (8085), pdf-receipt (8086), fraud-ml (8082), aml-engine (8083)

Usage:
  python smoke_test.py                         # test all services
  python smoke_test.py --service analytics     # test one service
  python smoke_test.py --base-url http://host  # custom base URL

Exit codes:
  0 — all tests passed
  1 — one or more tests failed
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from dataclasses import dataclass, field
from typing import Callable, List, Optional

import requests

# ─── Config ───────────────────────────────────────────────────────────────────

DEFAULT_TIMEOUT = 10  # seconds

SERVICES = {
    "analytics":  {"port": 8085, "base": "http://localhost:8085"},
    "pdf-receipt": {"port": 8086, "base": "http://localhost:8086"},
    "fraud-ml":   {"port": 8082, "base": "http://localhost:8082"},
    "aml-engine": {"port": 8083, "base": "http://localhost:8083"},
    "node-api":   {"port": 3000, "base": "http://localhost:3000"},
}

# ─── Test Framework ───────────────────────────────────────────────────────────

@dataclass
class TestResult:
    name: str
    service: str
    passed: bool
    duration_ms: float
    error: Optional[str] = None

@dataclass
class TestSuite:
    results: List[TestResult] = field(default_factory=list)

    def run(self, name: str, service: str, fn: Callable[[], None]) -> None:
        start = time.perf_counter()
        try:
            fn()
            duration = (time.perf_counter() - start) * 1000
            self.results.append(TestResult(name=name, service=service, passed=True, duration_ms=duration))
            print(f"  ✓ {name} ({duration:.0f}ms)")
        except Exception as exc:
            duration = (time.perf_counter() - start) * 1000
            err = f"{type(exc).__name__}: {exc}"
            self.results.append(TestResult(name=name, service=service, passed=False, duration_ms=duration, error=err))
            print(f"  ✗ {name} ({duration:.0f}ms) — {err}")

    def summary(self) -> bool:
        passed = sum(1 for r in self.results if r.passed)
        failed = len(self.results) - passed
        print(f"\n{'='*60}")
        print(f"Results: {passed}/{len(self.results)} passed, {failed} failed")
        if failed:
            print("\nFailed tests:")
            for r in self.results:
                if not r.passed:
                    print(f"  [{r.service}] {r.name}: {r.error}")
        print(f"{'='*60}")
        return failed == 0

suite = TestSuite()

# ─── Analytics Tests ──────────────────────────────────────────────────────────

def test_analytics(base: str) -> None:
    print(f"\n[analytics] {base}")

    def health():
        r = requests.get(f"{base}/health", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert data["service"] == "analytics-pipeline"

    def overview():
        r = requests.get(f"{base}/metrics/overview", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "total_volume_usd" in data
        assert data["total_volume_usd"] > 0
        assert "total_transactions" in data
        assert "total_users" in data

    def transactions_daily():
        r = requests.get(f"{base}/metrics/transactions?days=7&granularity=daily", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data["granularity"] == "daily"
        assert len(data["data"]) == 7

    def transactions_weekly():
        r = requests.get(f"{base}/metrics/transactions?days=30&granularity=weekly", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data["granularity"] == "weekly"

    def corridors():
        r = requests.get(f"{base}/metrics/corridors", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "corridors" in data
        assert len(data["corridors"]) >= 1
        c = data["corridors"][0]
        assert "corridor" in c
        assert "volume_usd_30d" in c

    def users():
        r = requests.get(f"{base}/metrics/users?days=30", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "total_users" in data
        assert "kyc_distribution" in data

    def revenue():
        r = requests.get(f"{base}/metrics/revenue?days=30", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "total_fee_revenue_usd" in data
        assert data["total_fee_revenue_usd"] > 0

    def kyc_funnel():
        r = requests.get(f"{base}/metrics/kyc-funnel", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "total_registered" in data
        assert "tier1_count" in data

    def fraud_metrics():
        r = requests.get(f"{base}/metrics/fraud", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "total_screened_30d" in data
        assert "block_rate" in data

    def system_health():
        r = requests.get(f"{base}/metrics/system", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "api_uptime_pct" in data
        assert "services" in data

    def report_csv():
        r = requests.post(f"{base}/reports/generate?report_type=transactions&format=csv&days=7",
                          timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        lines = r.text.strip().split("\n")
        assert len(lines) >= 2  # header + data rows

    def report_json():
        r = requests.post(f"{base}/reports/generate?report_type=corridors&format=json",
                          timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    for name, fn in [
        ("health check", health),
        ("metrics overview", overview),
        ("transactions daily", transactions_daily),
        ("transactions weekly", transactions_weekly),
        ("corridors", corridors),
        ("users", users),
        ("revenue", revenue),
        ("kyc funnel", kyc_funnel),
        ("fraud metrics", fraud_metrics),
        ("system health", system_health),
        ("report CSV", report_csv),
        ("report JSON", report_json),
    ]:
        suite.run(name, "analytics", fn)

# ─── PDF Receipt Tests ────────────────────────────────────────────────────────

def test_pdf_receipt(base: str) -> None:
    print(f"\n[pdf-receipt] {base}")

    def health():
        r = requests.get(f"{base}/health", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def transfer_receipt():
        payload = {
            "transaction_id": "txn_smoke_001",
            "reference": "RF-2024-SMOKE-001",
            "sender_name": "Adaeze Okonkwo",
            "sender_email": "adaeze@example.com",
            "sender_country": "United Kingdom",
            "receiver_name": "Chukwuemeka Okonkwo",
            "receiver_bank": "Access Bank",
            "receiver_account": "0123456789",
            "receiver_country": "Nigeria",
            "send_amount": 250.00,
            "send_currency": "GBP",
            "receive_amount": 465000.00,
            "receive_currency": "NGN",
            "exchange_rate": 1860.0,
            "fee_amount": 3.99,
            "fee_currency": "GBP",
            "total_deducted": 253.99,
            "status": "completed",
            "created_at": "2024-01-15T10:30:00Z",
            "completed_at": "2024-01-15T10:32:15Z",
            "delivery_method": "Bank Transfer",
        }
        r = requests.post(f"{base}/receipt/transfer", json=payload, timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        assert r.headers.get("content-type") == "application/pdf"
        assert len(r.content) > 1000  # non-trivial PDF
        assert r.content[:4] == b"%PDF"  # valid PDF magic bytes

    def statement_receipt():
        payload = {
            "account_holder": "Adaeze Okonkwo",
            "account_id": "acc_smoke_001",
            "email": "adaeze@example.com",
            "period_start": "2024-01-01",
            "period_end": "2024-01-31",
            "opening_balance_usd": 500.00,
            "closing_balance_usd": 250.00,
            "transactions": [
                {"date": "2024-01-05", "description": "Transfer to Nigeria", "amount": 250.00, "status": "completed"},
                {"date": "2024-01-12", "description": "Wallet top-up", "amount": 100.00, "status": "completed"},
            ],
        }
        r = requests.post(f"{base}/receipt/statement", json=payload, timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        assert r.headers.get("content-type") == "application/pdf"
        assert r.content[:4] == b"%PDF"

    def kyc_letter():
        payload = {
            "user_name": "Adaeze Okonkwo",
            "user_email": "adaeze@example.com",
            "kyc_tier": 2,
            "verified_at": "2024-01-10T09:00:00Z",
            "daily_limit_usd": 5000.00,
            "monthly_limit_usd": 25000.00,
            "reference_number": "KYC-2024-SMOKE-001",
        }
        r = requests.post(f"{base}/receipt/kyc", json=payload, timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        assert r.headers.get("content-type") == "application/pdf"
        assert r.content[:4] == b"%PDF"

    for name, fn in [
        ("health check", health),
        ("transfer receipt PDF", transfer_receipt),
        ("account statement PDF", statement_receipt),
        ("KYC letter PDF", kyc_letter),
    ]:
        suite.run(name, "pdf-receipt", fn)

# ─── Fraud ML Tests ───────────────────────────────────────────────────────────

def test_fraud_ml(base: str) -> None:
    print(f"\n[fraud-ml] {base}")

    def health():
        r = requests.get(f"{base}/health", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200

    def score_transaction():
        payload = {
            "transaction_id": "txn_smoke_002",
            "amount_usd": 500.0,
            "sender_country": "GB",
            "receiver_country": "NG",
            "sender_age_days": 180,
            "transaction_hour": 14,
            "is_first_transfer": False,
            "transfers_last_24h": 1,
            "amount_deviation": 0.2,
        }
        r = requests.post(f"{base}/score", json=payload, timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "risk_score" in data or "score" in data or "fraud_probability" in data

    def score_high_risk():
        payload = {
            "transaction_id": "txn_smoke_003",
            "amount_usd": 9999.0,
            "sender_country": "US",
            "receiver_country": "NG",
            "sender_age_days": 2,
            "transaction_hour": 3,
            "is_first_transfer": True,
            "transfers_last_24h": 5,
            "amount_deviation": 3.5,
        }
        r = requests.post(f"{base}/score", json=payload, timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200

    for name, fn in [
        ("health check", health),
        ("score normal transaction", score_transaction),
        ("score high-risk transaction", score_high_risk),
    ]:
        suite.run(name, "fraud-ml", fn)

# ─── AML Engine Tests ─────────────────────────────────────────────────────────

def test_aml_engine(base: str) -> None:
    print(f"\n[aml-engine] {base}")

    def health():
        r = requests.get(f"{base}/health", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200

    def screen_clean():
        payload = {
            "transaction_id": "txn_smoke_004",
            "sender_name": "Adaeze Okonkwo",
            "sender_country": "GB",
            "receiver_name": "Chukwuemeka Okonkwo",
            "receiver_country": "NG",
            "amount_usd": 250.0,
            "currency": "GBP",
        }
        r = requests.post(f"{base}/screen", json=payload, timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "result" in data or "status" in data or "passed" in data

    def velocity_check():
        payload = {
            "user_id": "user_smoke_001",
            "amount_usd": 500.0,
            "window_hours": 24,
        }
        r = requests.post(f"{base}/velocity-check", json=payload, timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200

    for name, fn in [
        ("health check", health),
        ("screen clean transaction", screen_clean),
        ("velocity check", velocity_check),
    ]:
        suite.run(name, "aml-engine", fn)

# ─── Node.js API Tests ────────────────────────────────────────────────────────

def test_node_api(base: str) -> None:
    print(f"\n[node-api] {base}")

    def health():
        r = requests.get(f"{base}/api/health", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200

    def ready():
        r = requests.get(f"{base}/api/ready", timeout=DEFAULT_TIMEOUT)
        assert r.status_code in (200, 503)  # 503 if DB not connected

    def health_detailed():
        r = requests.get(f"{base}/api/health/detailed", timeout=DEFAULT_TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "status" in data

    for name, fn in [
        ("health check", health),
        ("readiness probe", ready),
        ("detailed health", health_detailed),
    ]:
        suite.run(name, "node-api", fn)

# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="RemitFlow Microservices Smoke Tests")
    parser.add_argument("--service", choices=list(SERVICES.keys()) + ["all"], default="all")
    parser.add_argument("--analytics-url", default=SERVICES["analytics"]["base"])
    parser.add_argument("--pdf-receipt-url", default=SERVICES["pdf-receipt"]["base"])
    parser.add_argument("--fraud-ml-url", default=SERVICES["fraud-ml"]["base"])
    parser.add_argument("--aml-engine-url", default=SERVICES["aml-engine"]["base"])
    parser.add_argument("--node-api-url", default=SERVICES["node-api"]["base"])
    args = parser.parse_args()

    print("RemitFlow Microservices Smoke Test Suite")
    print(f"Started at: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    print("=" * 60)

    run_all = args.service == "all"

    if run_all or args.service == "analytics":
        test_analytics(args.analytics_url)
    if run_all or args.service == "pdf-receipt":
        test_pdf_receipt(args.pdf_receipt_url)
    if run_all or args.service == "fraud-ml":
        test_fraud_ml(args.fraud_ml_url)
    if run_all or args.service == "aml-engine":
        test_aml_engine(args.aml_engine_url)
    if run_all or args.service == "node-api":
        test_node_api(args.node_api_url)

    ok = suite.summary()
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
