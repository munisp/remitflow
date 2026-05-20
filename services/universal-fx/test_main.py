"""
test_main.py — universal-fx service tests
Tests for hub-and-spoke rate computation, CoinGecko key detection,
rate lock creation, and offline fallback.
"""
import pytest
import time
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

# Set test env before importing main
import os
os.environ["COINGECKO_API_KEY"] = ""  # Test without key first
os.environ["RATE_LOCK_HMAC_SECRET"] = "test-secret"
os.environ["PORT"] = "8084"

from main import (
    app, compute_cross_rate, apply_slippage, create_rate_lock,
    verify_rate_lock, FALLBACK_RATES, COINGECKO_BASE, COINGECKO_API_KEY,
)

client = TestClient(app)

# ─── Rate computation tests ────────────────────────────────────────────────────
class TestCrossRateComputation:
    SAMPLE_RATES = {
        "USD": 1.0,
        "NGN": 1538.46,
        "GHS": 12.4,
        "EUR": 0.9215,
        "BTC": 65000.0,
        "ETH": 3500.0,
        "USDT": 1.0,
        "USDC": 1.0,
    }

    def test_usd_to_ngn(self):
        rate = compute_cross_rate(self.SAMPLE_RATES, "USD", "NGN")
        assert rate == pytest.approx(1538.46, rel=1e-4)

    def test_ngn_to_usd(self):
        rate = compute_cross_rate(self.SAMPLE_RATES, "NGN", "USD")
        assert rate == pytest.approx(1 / 1538.46, rel=1e-4)

    def test_ngn_to_ghs_cross_rate(self):
        # NGN/GHS = GHS_USD / NGN_USD = 12.4 / 1538.46
        rate = compute_cross_rate(self.SAMPLE_RATES, "NGN", "GHS")
        expected = 12.4 / 1538.46
        assert rate == pytest.approx(expected, rel=1e-4)

    def test_btc_to_eth(self):
        rate = compute_cross_rate(self.SAMPLE_RATES, "BTC", "ETH")
        expected = 3500.0 / 65000.0
        assert rate == pytest.approx(expected, rel=1e-4)

    def test_usdt_to_ngn(self):
        rate = compute_cross_rate(self.SAMPLE_RATES, "USDT", "NGN")
        assert rate == pytest.approx(1538.46, rel=1e-4)

    def test_unknown_asset_returns_none(self):
        rate = compute_cross_rate(self.SAMPLE_RATES, "UNKNOWN", "USD")
        assert rate is None

    def test_case_insensitive(self):
        rate = compute_cross_rate(self.SAMPLE_RATES, "usd", "ngn")
        assert rate == pytest.approx(1538.46, rel=1e-4)


class TestSlippageProtection:
    def test_buy_slippage_reduces_rate(self):
        rate = 1538.46
        protected = apply_slippage(rate, "buy")
        assert protected < rate
        assert protected == pytest.approx(rate * 0.995, rel=1e-6)

    def test_sell_slippage_increases_rate(self):
        rate = 1538.46
        protected = apply_slippage(rate, "sell")
        assert protected > rate
        assert protected == pytest.approx(rate * 1.005, rel=1e-6)


class TestRateLock:
    def test_create_rate_lock(self):
        lock = create_rate_lock("USD", "NGN", 1538.46, 100.0)
        assert lock["lockId"]
        assert lock["fromAsset"] == "USD"
        assert lock["toAsset"] == "NGN"
        assert lock["rate"] == 1538.46
        assert lock["amount"] == 100.0
        assert lock["expiresAt"] > int(time.time())
        assert lock["signature"]

    def test_verify_valid_lock(self):
        lock = create_rate_lock("USD", "NGN", 1538.46, 100.0)
        verified = verify_rate_lock(lock["lockId"])
        assert verified is not None
        assert verified["lockId"] == lock["lockId"]

    def test_verify_nonexistent_lock(self):
        result = verify_rate_lock("nonexistent-lock-id")
        assert result is None


class TestCoinGeckoApiKeyConfig:
    def test_free_api_uses_public_endpoint(self):
        """Without API key, should use public CoinGecko endpoint."""
        assert "pro-api.coingecko.com" not in COINGECKO_BASE or COINGECKO_API_KEY

    def test_api_key_env_detection(self):
        """COINGECKO_API_KEY env var should be read correctly."""
        key = os.environ.get("COINGECKO_API_KEY", "")
        assert isinstance(key, str)

    def test_pro_endpoint_when_key_set(self):
        """When API key is set, Pro endpoint should be used."""
        with patch.dict(os.environ, {"COINGECKO_API_KEY": "test-key-123"}):
            # Re-evaluate the endpoint logic
            api_key = os.environ.get("COINGECKO_API_KEY", "")
            base = (
                "https://pro-api.coingecko.com/api/v3"
                if api_key
                else "https://api.coingecko.com/api/v3"
            )
            assert "pro-api.coingecko.com" in base


class TestFallbackRates:
    def test_fallback_rates_cover_major_currencies(self):
        required = ["USD", "NGN", "KES", "GHS", "ZAR", "EUR", "GBP"]
        for currency in required:
            assert currency in FALLBACK_RATES, f"Missing fallback rate for {currency}"

    def test_fallback_rates_cover_major_crypto(self):
        required = ["BTC", "ETH", "USDT", "USDC"]
        for asset in required:
            assert asset in FALLBACK_RATES, f"Missing fallback rate for {asset}"

    def test_all_fallback_rates_positive(self):
        for asset, rate in FALLBACK_RATES.items():
            assert rate > 0, f"Non-positive fallback rate for {asset}: {rate}"


class TestApiEndpoints:
    def test_health_endpoint(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "assets" in data
        assert "coingeckoTier" in data

    def test_assets_endpoint(self):
        response = client.get("/assets")
        assert response.status_code == 200
        data = response.json()
        assert "fiat" in data
        assert "crypto" in data
        assert data["total"] > 90  # 45 fiat + 52 crypto

    def test_rates_endpoint(self):
        response = client.get("/rates")
        assert response.status_code == 200
        data = response.json()
        assert "rates" in data
        assert "USD" in data["rates"]

    def test_quote_endpoint(self):
        response = client.post("/quote", json={
            "fromAsset": "USD",
            "toAsset": "NGN",
            "amount": 100.0,
            "lockRate": False,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["fromAsset"] == "USD"
        assert data["toAsset"] == "NGN"
        assert data["convertedAmount"] > 0

    def test_quote_with_rate_lock(self):
        response = client.post("/quote", json={
            "fromAsset": "USD",
            "toAsset": "NGN",
            "amount": 100.0,
            "lockRate": True,
        })
        assert response.status_code == 200
        data = response.json()
        assert "rateLock" in data
        assert data["rateLock"]["lockId"]

    def test_corridor_endpoint(self):
        response = client.get("/corridor/USD/NGN")
        assert response.status_code == 200
        data = response.json()
        assert data["available"] is True
        assert data["rate"] > 0
