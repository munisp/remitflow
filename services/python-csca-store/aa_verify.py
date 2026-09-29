"""Active Authentication (AA) verification against DG15.

AA proves cloning resistance: the chip signs a per-session random challenge
with a private key that never leaves the chip; the matching public key is in
DG15 (whose integrity is covered by passive authentication via the SOD
hashes). The chip computes the digest internally, and different issuers use
different digests, so — like JMRTD and NFCPassportReader — we try the digest
candidates a real chip is known to use. Never raises; returns an honest
(result, reason) pair.
"""

from __future__ import annotations

import hashlib
import logging

from asn1crypto import keys as asn1_keys
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa, utils as asym_utils

from tlv import find_tag

log = logging.getLogger("python-csca-store.aa")

# Digests real chips are known to use for AA, most common first.
_CANDIDATES = ["sha256", "sha1", "sha384", "sha512", "sha224"]
_HASH = {
    "sha1": hashes.SHA1,
    "sha224": hashes.SHA224,
    "sha256": hashes.SHA256,
    "sha384": hashes.SHA384,
    "sha512": hashes.SHA512,
}


def _extract_spki(dg15_bytes: bytes) -> bytes:
    """DG15 content is tag 0x6F wrapping a SubjectPublicKeyInfo SEQUENCE."""
    inner = find_tag(dg15_bytes, b"\x6f")
    candidate = inner if inner is not None else dg15_bytes
    # candidate may be the SPKI directly or wrapped once more in 0x30.
    try:
        asn1_keys.PublicKeyInfo.load(candidate)
        return candidate
    except Exception:
        pass
    inner2 = find_tag(candidate, b"\x30")
    if inner2 is None:
        raise ValueError("no SubjectPublicKeyInfo found in DG15")
    # Rebuild full DER of the inner SEQUENCE (find_tag returns only the value).
    # PublicKeyInfo.load on the value fails without the SEQUENCE header, so
    # re-encode: length prefix + value.
    length = len(inner2)
    if length < 0x80:
        header = bytes([0x30, length])
    elif length < 0x100:
        header = bytes([0x30, 0x81, length])
    else:
        header = bytes([0x30, 0x82, length >> 8, length & 0xFF])
    der = header + inner2
    asn1_keys.PublicKeyInfo.load(der)  # raises if still invalid
    return der


def verify_active_authentication(
    dg15_bytes: bytes,
    challenge: bytes,
    signature: bytes,
) -> tuple[bool | None, str]:
    """Verify the chip's AA signature over the challenge.

    Returns (True, 'ok') on success, (False, reason) on a definitive failure,
    (None, reason) when verification could not be attempted (honest unknown).
    """
    if not challenge or not signature:
        return None, "aa_challenge_or_signature_missing"
    try:
        spki_der = _extract_spki(dg15_bytes)
        public_key = serialization.load_der_public_key(spki_der)
    except Exception as exc:
        return None, f"dg15_parse_failed: {exc}"

    if isinstance(public_key, rsa.RSAPublicKey):
        for name in _CANDIDATES:
            try:
                # Chips sign Hash(challenge) with PKCS#1 v1.5 (DigestInfo inside).
                public_key.verify(signature, challenge, padding.PKCS1v15(), _HASH[name]())
                return True, "ok"
            except InvalidSignature:
                continue
            except Exception:
                continue
        return False, "aa_signature_invalid"

    if isinstance(public_key, ec.EllipticCurvePublicKey):
        # Plain ECDSA AA: chip returns raw r||s over a digest of the challenge.
        size = (public_key.curve.key_size + 7) // 8
        if len(signature) == 2 * size:
            r = int.from_bytes(signature[:size], "big")
            s = int.from_bytes(signature[size:], "big")
            der_sig = asym_utils.encode_dss_signature(r, s)
        else:
            der_sig = signature  # some chips already return DER
        for name in _CANDIDATES:
            if _HASH[name]().digest_size > size:
                continue  # digest longer than curve order cannot be valid
            try:
                public_key.verify(der_sig, challenge, ec.ECDSA(_HASH[name]()))
                return True, "ok"
            except InvalidSignature:
                continue
            except Exception:
                continue
        return False, "aa_signature_invalid"

    return None, f"aa_unsupported_key_type: {type(public_key).__name__}"
