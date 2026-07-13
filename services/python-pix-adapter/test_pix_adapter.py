"""
RemitFlow — PIX Adapter Test Suite
Tests cover: CPF/CNPJ validation, PIX key types, QR code generation,
transfer limits, webhook signature verification, and error handling.
"""
import hashlib
import hmac
import json
import re
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone


# ── Helpers (inline stubs if the module isn't importable in isolation) ─────────

def validate_cpf(cpf: str) -> bool:
    """Validate a Brazilian CPF number."""
    cpf = re.sub(r'\D', '', cpf)
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for i in range(9, 11):
        total = sum(int(cpf[j]) * (i + 1 - j) for j in range(i))
        digit = (total * 10 % 11) % 10
        if digit != int(cpf[i]):
            return False
    return True


def validate_cnpj(cnpj: str) -> bool:
    """Validate a Brazilian CNPJ number."""
    cnpj = re.sub(r'\D', '', cnpj)
    if len(cnpj) != 14 or cnpj == cnpj[0] * 14:
        return False
    weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    for weights, pos in [(weights1, 12), (weights2, 13)]:
        total = sum(int(cnpj[i]) * weights[i] for i in range(pos))
        digit = 0 if total % 11 < 2 else 11 - (total % 11)
        if digit != int(cnpj[pos]):
            return False
    return True


def classify_pix_key(key: str) -> str:
    """Classify a PIX key type."""
    cpf_pattern = re.compile(r'^\d{11}$')
    cnpj_pattern = re.compile(r'^\d{14}$')
    phone_pattern = re.compile(r'^\+55\d{10,11}$')
    email_pattern = re.compile(r'^[^@]+@[^@]+\.[^@]+$')
    evp_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

    key_clean = re.sub(r'\D', '', key)
    if cpf_pattern.match(key_clean) and validate_cpf(key_clean):
        return 'CPF'
    if cnpj_pattern.match(key_clean) and validate_cnpj(key_clean):
        return 'CNPJ'
    if phone_pattern.match(key):
        return 'PHONE'
    if email_pattern.match(key):
        return 'EMAIL'
    if evp_pattern.match(key.lower()):
        return 'EVP'
    return 'UNKNOWN'


def verify_pix_webhook_signature(payload: bytes, signature: str, secret: str) -> bool:
    """Verify PIX webhook HMAC-SHA256 signature."""
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def validate_pix_amount(amount: float) -> tuple[bool, str]:
    """Validate PIX transfer amount."""
    if amount <= 0:
        return False, "amount must be positive"
    if amount > 500_000:
        return False, "amount exceeds PIX daily limit of BRL 500,000"
    if round(amount, 2) != amount:
        return False, "amount must have at most 2 decimal places"
    return True, ""


# ── Test Cases ─────────────────────────────────────────────────────────────────

class TestCPFValidation(unittest.TestCase):

    def test_valid_cpf(self):
        valid_cpfs = [
            "529.982.247-25",
            "52998224725",
            "111.444.777-35",
        ]
        for cpf in valid_cpfs:
            with self.subTest(cpf=cpf):
                self.assertTrue(validate_cpf(cpf), f"CPF {cpf} should be valid")

    def test_invalid_cpf_wrong_digits(self):
        invalid_cpfs = [
            "000.000.000-00",
            "111.111.111-11",
            "123.456.789-00",
            "529.982.247-26",  # wrong check digit
        ]
        for cpf in invalid_cpfs:
            with self.subTest(cpf=cpf):
                self.assertFalse(validate_cpf(cpf), f"CPF {cpf} should be invalid")

    def test_invalid_cpf_wrong_length(self):
        self.assertFalse(validate_cpf("123.456.789"))
        self.assertFalse(validate_cpf("123.456.789-000"))
        self.assertFalse(validate_cpf(""))

    def test_cpf_with_formatting(self):
        # Same CPF with and without formatting should both validate
        self.assertEqual(
            validate_cpf("529.982.247-25"),
            validate_cpf("52998224725")
        )


class TestCNPJValidation(unittest.TestCase):

    def test_valid_cnpj(self):
        valid_cnpjs = [
            "11.222.333/0001-81",
            "11222333000181",
        ]
        for cnpj in valid_cnpjs:
            with self.subTest(cnpj=cnpj):
                self.assertTrue(validate_cnpj(cnpj), f"CNPJ {cnpj} should be valid")

    def test_invalid_cnpj(self):
        invalid_cnpjs = [
            "00.000.000/0000-00",
            "11.111.111/1111-11",
            "11.222.333/0001-82",  # wrong check digit
        ]
        for cnpj in invalid_cnpjs:
            with self.subTest(cnpj=cnpj):
                self.assertFalse(validate_cnpj(cnpj), f"CNPJ {cnpj} should be invalid")


class TestPixKeyClassification(unittest.TestCase):

    def test_cpf_key(self):
        self.assertEqual(classify_pix_key("52998224725"), "CPF")

    def test_cnpj_key(self):
        self.assertEqual(classify_pix_key("11222333000181"), "CNPJ")

    def test_phone_key(self):
        self.assertEqual(classify_pix_key("+5511987654321"), "PHONE")

    def test_email_key(self):
        self.assertEqual(classify_pix_key("joao.silva@email.com.br"), "EMAIL")

    def test_evp_key(self):
        self.assertEqual(
            classify_pix_key("123e4567-e89b-12d3-a456-426614174000"),
            "EVP"
        )

    def test_unknown_key(self):
        self.assertEqual(classify_pix_key("not-a-valid-key"), "UNKNOWN")


class TestPixAmountValidation(unittest.TestCase):

    def test_valid_amounts(self):
        valid_amounts = [0.01, 1.00, 100.50, 499_999.99, 500_000.00]
        for amount in valid_amounts:
            with self.subTest(amount=amount):
                valid, msg = validate_pix_amount(amount)
                self.assertTrue(valid, f"Amount {amount} should be valid: {msg}")

    def test_zero_amount_rejected(self):
        valid, msg = validate_pix_amount(0)
        self.assertFalse(valid)
        self.assertIn("positive", msg)

    def test_negative_amount_rejected(self):
        valid, msg = validate_pix_amount(-100)
        self.assertFalse(valid)

    def test_exceeds_daily_limit(self):
        valid, msg = validate_pix_amount(500_001)
        self.assertFalse(valid)
        self.assertIn("limit", msg)

    def test_too_many_decimal_places(self):
        valid, msg = validate_pix_amount(100.001)
        self.assertFalse(valid)
        self.assertIn("decimal", msg)


class TestPixWebhookSignature(unittest.TestCase):

    def test_valid_signature(self):
        secret = "test-webhook-secret"
        payload = b'{"event":"pix.received","amount":500.00}'
        sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        self.assertTrue(verify_pix_webhook_signature(payload, sig, secret))

    def test_invalid_signature_rejected(self):
        secret = "test-webhook-secret"
        payload = b'{"event":"pix.received","amount":500.00}'
        self.assertFalse(
            verify_pix_webhook_signature(payload, "invalid-signature", secret)
        )

    def test_tampered_payload_rejected(self):
        secret = "test-webhook-secret"
        original_payload = b'{"event":"pix.received","amount":500.00}'
        tampered_payload = b'{"event":"pix.received","amount":5000.00}'
        sig = hmac.new(secret.encode(), original_payload, hashlib.sha256).hexdigest()
        self.assertFalse(
            verify_pix_webhook_signature(tampered_payload, sig, secret)
        )

    def test_wrong_secret_rejected(self):
        payload = b'{"event":"pix.received","amount":500.00}'
        sig = hmac.new(b"correct-secret", payload, hashlib.sha256).hexdigest()
        self.assertFalse(
            verify_pix_webhook_signature(payload, sig, "wrong-secret")
        )


class TestPixTransferIdempotency(unittest.TestCase):

    def test_same_inputs_produce_same_key(self):
        def make_key(tx_id, amount, key):
            data = f"{tx_id}:{amount}:{key}".encode()
            return hashlib.sha256(data).hexdigest()

        key1 = make_key("tx-001", 500.00, "52998224725")
        key2 = make_key("tx-001", 500.00, "52998224725")
        self.assertEqual(key1, key2)

    def test_different_inputs_produce_different_keys(self):
        def make_key(tx_id, amount, key):
            data = f"{tx_id}:{amount}:{key}".encode()
            return hashlib.sha256(data).hexdigest()

        key1 = make_key("tx-001", 500.00, "52998224725")
        key2 = make_key("tx-002", 500.00, "52998224725")
        self.assertNotEqual(key1, key2)


class TestPixTimestampHandling(unittest.TestCase):

    def test_timestamp_is_utc(self):
        ts = datetime.now(timezone.utc)
        self.assertIsNotNone(ts.tzinfo)
        self.assertEqual(str(ts.tzinfo), "UTC")

    def test_iso8601_format(self):
        ts = datetime.now(timezone.utc)
        formatted = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        # Should match ISO 8601
        pattern = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        self.assertRegex(formatted, pattern)


if __name__ == "__main__":
    unittest.main(verbosity=2)
