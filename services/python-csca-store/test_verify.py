"""End-to-end self-test for python-csca-store.

Builds a synthetic trust chain in-memory (CSCA -> DS cert -> CMS SOD ->
DG1/DG2 hashes, plus an AA keypair) and exercises:
  * passive auth success, hash-mismatch failure, csca_not_found
  * active auth success/failure
  * FastAPI /verify fail-closed 503 when no master list is loaded
  * LDIF + .ml master list parsing round-trip

Run: python test_verify.py   (no pytest dependency)
"""

import base64
import hashlib
import io
import os
import sys
import zipfile
from datetime import datetime, timedelta, timezone

from asn1crypto import algos, cms, core, keys as asn1_keys, x509 as asn1_x509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID

import main
import masterlist
import sod_verify
from aa_verify import verify_active_authentication
from sod_verify import verify_passive_auth

FAILURES = []


def check(name: str, cond: bool, detail: str = ""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def der(tag: int, content: bytes) -> bytes:
    n = len(content)
    if n < 0x80:
        lb = bytes([n])
    elif n < 0x100:
        lb = bytes([0x81, n])
    else:
        lb = bytes([0x82, n >> 8, n & 0xFF])
    return bytes([tag]) + lb + content


def der_int(v: int) -> bytes:
    return der(0x02, bytes([v]))


def make_cert(subject_name, issuer_cert, issuer_key, public_key, is_ca, serial):
    builder = (
        x509.CertificateBuilder()
        .subject_name(subject_name)
        .issuer_name(issuer_cert.subject if issuer_cert else subject_name)
        .public_key(public_key)
        .serial_number(serial)
        .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=365))
    )
    if is_ca:
        builder = builder.add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
    return builder.sign(issuer_key, hashes.SHA256())


# ── Fixture: trust chain + chip data ─────────────────────────────────────────
csca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ds_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
aa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

csca_name = x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME, "DE"),
    x509.NameAttribute(NameOID.COMMON_NAME, "CSCA-TEST"),
])
ds_name = x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME, "DE"),
    x509.NameAttribute(NameOID.COMMON_NAME, "DS-TEST"),
])
csca_cert = make_cert(csca_name, None, csca_key, csca_key.public_key(), True, 1000)
ds_cert = make_cert(ds_name, csca_cert, csca_key, ds_key.public_key(), False, 2000)

MRZ_L1 = "P<DEUDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<"
MRZ_L1 = MRZ_L1.ljust(44, "<")
MRZ_L2 = "A000000007DE7001017M3001016<<<<<<<<<<<000"
MRZ_L2 = MRZ_L2.ljust(44, "<")
# DG1: tag 61 { 02 01 01 , 5F1F <len> mrz }
mrz = (MRZ_L1 + MRZ_L2).encode("ascii")
DG1 = der(0x61, der_int(1) + bytes([0x5F, 0x1F]) + bytes([len(mrz)]) + mrz)
DG2 = der(0x75, b"\x02\x01\x01fake-jpeg-bytes-for-hash-check")

digest = hashlib.sha256
h1 = digest(DG1).digest()
h2 = digest(DG2).digest()

SHA256_OID = bytes.fromhex("0609608648016503040201")
econtent = der(
    0x30,
    der_int(0)
    + der(0x30, SHA256_OID)
    + der(0x30, der(0x30, der_int(1) + der(0x04, h1)) + der(0x30, der_int(2) + der(0x04, h2))),
)

# CMS SignedData with signedAttrs
attrs = cms.CMSAttributes([
    cms.CMSAttribute({"type": "content_type", "values": ["data"]}),
    cms.CMSAttribute({"type": "message_digest", "values": [digest(econtent).digest()]}),
])
si = cms.SignerInfo({
    "version": 1,
    "sid": {
        "issuer_and_serial_number": {
            "issuer": asn1_x509.Name.load(ds_cert.issuer.public_bytes()),
            "serial_number": ds_cert.serial_number,
        }
    },
    "digest_algorithm": algos.DigestAlgorithm({"algorithm": "sha256"}),
    "signed_attrs": attrs,
    "signature_algorithm": algos.SignedDigestAlgorithm({"algorithm": "1.2.840.113549.1.1.11"}),
    "signature": b"\x00",  # placeholder, replaced below
})
# Sign the SET OF encoding (0x31) of the signed attributes.
signed_data_bytes = b"\x31" + si["signed_attrs"].dump()[1:]
signature = ds_key.sign(signed_data_bytes, padding.PKCS1v15(), hashes.SHA256())
si["signature"] = signature

sd = cms.SignedData({
    "version": 1,
    "digest_algorithms": [algos.DigestAlgorithm({"algorithm": "sha256"})],
    "encap_content_info": cms.ContentInfo({
        "content_type": "data",
        "content": econtent,
    }),
    "certificates": [cms.CertificateChoices(name="certificate", value=asn1_x509.Certificate.load(
        ds_cert.public_bytes(serialization.Encoding.DER)))],
    "signer_infos": [si],
})
SOD = cms.ContentInfo({"content_type": "signed_data", "content": sd}).dump()

# DG15 wrapping the AA public key
SPKI = aa_key.public_key().public_bytes(
    serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
DG15 = der(0x6F, SPKI)
AA_CHALLENGE = os.urandom(8)
AA_SIGNATURE = aa_key.sign(AA_CHALLENGE, padding.PKCS1v15(), hashes.SHA256())


def store_with(certs):
    ml = masterlist.MasterList(certs=list(certs), source_format="test")
    return ml


# ── 1. Passive auth happy path ───────────────────────────────────────────────
res = verify_passive_auth(SOD, {1: DG1, 2: DG2}, store_with([csca_cert]))
check("PA happy path paValid", res.pa_valid, f"{res.reason} {res.errors}")
check("PA signerCountry=DE", res.signer_country == "DE", str(res.signer_country))

# ── 2. Hash mismatch fails closed ────────────────────────────────────────────
tampered = DG2[:-1] + bytes([DG2[-1] ^ 0x01])
res = verify_passive_auth(SOD, {1: DG1, 2: tampered}, store_with([csca_cert]))
check("PA tampered DG2 rejected", not res.pa_valid and res.reason == "dg_hash_mismatch",
      f"{res.reason} {res.errors}")

# ── 3. Missing CSCA -> csca_not_found (manual_review routing) ────────────────
other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
other_cert = make_cert(x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME, "FR"),
    x509.NameAttribute(NameOID.COMMON_NAME, "CSCA-OTHER"),
]), None, other_key, other_key.public_key(), True, 3000)
res = verify_passive_auth(SOD, {1: DG1}, store_with([other_cert]))
check("PA csca_not_found", not res.pa_valid and res.reason == "csca_not_found", res.reason)

# ── 4. Wrong-CSCA signature -> chain invalid ─────────────────────────────────
wrong_issuer_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
# cert with the same subject NAME as the real CSCA but a different key
impostor = make_cert(csca_name, None, wrong_issuer_key, wrong_issuer_key.public_key(), True, 1000)
res = verify_passive_auth(SOD, {1: DG1}, store_with([impostor]))
check("PA impostor CSCA rejected", not res.pa_valid and res.reason == "csca_chain_invalid",
      f"{res.reason} {res.errors}")

# ── 5. Corrupt SOD fails closed ──────────────────────────────────────────────
res = verify_passive_auth(SOD[: len(SOD) // 2], {1: DG1}, store_with([csca_cert]))
check("PA corrupt SOD rejected", not res.pa_valid and res.reason == "sod_parse_failed", res.reason)

# ── 6. Active auth ───────────────────────────────────────────────────────────
ok, reason = verify_active_authentication(DG15, AA_CHALLENGE, AA_SIGNATURE)
check("AA happy path", ok is True, reason)

ok, reason = verify_active_authentication(DG15, os.urandom(8), AA_SIGNATURE)
check("AA wrong challenge rejected", ok is False, reason)

ok, reason = verify_active_authentication(b"\x6f\x05garbage", AA_CHALLENGE, AA_SIGNATURE)
check("AA corrupt DG15 honest unknown", ok is None, reason)

# ── 7. DG1 issuing country ───────────────────────────────────────────────────
country = main._extract_issuing_country(DG1)
check("DG1 issuingCountry=DEU", country == "DEU", str(country))

# ── 8. FastAPI: fail closed when store empty, then happy path ────────────────
from fastapi.testclient import TestClient

with TestClient(main.app) as client:
    r = client.post("/verify", json={"dg1": base64.b64encode(DG1).decode(),
                                     "sod": base64.b64encode(SOD).decode()})
    check("API 503 when master list missing", r.status_code == 503, str(r.status_code))

    # Load store manually and retry
    main._store = store_with([csca_cert])
    main._store_loaded = True
    r = client.post("/verify", json={
        "dg1": base64.b64encode(DG1).decode(),
        "dg2": base64.b64encode(DG2).decode(),
        "sod": base64.b64encode(SOD).decode(),
        "dg15": base64.b64encode(DG15).decode(),
        "aaChallenge": base64.b64encode(AA_CHALLENGE).decode(),
        "aaSignature": base64.b64encode(AA_SIGNATURE).decode(),
    })
    body = r.json()
    check("API happy path paValid+aaValid", r.status_code == 200 and body["paValid"] and body["aaValid"],
          f"{r.status_code} {body}")
    check("API issuingCountry", body.get("issuingCountry") == "DEU", str(body.get("issuingCountry")))

    r = client.post("/verify", json={"dg1": "!!!not-base64!!!", "sod": "e30="})
    check("API 422 on bad base64", r.status_code == 422, str(r.status_code))

# ── 10. /nfc/passive-auth (snake_case kycCapture.ts contract) ────────────────
b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731

with TestClient(main.app) as client:
    # fail-closed: no master list loaded (lifespan load failed in test env)
    main._store = None
    main._store_loaded = False
    r = client.post("/nfc/passive-auth", json={
        "dg1": b64(DG1),
        "dg2_portrait": b64(b"extracted-portrait-jpeg"),
        "sod": b64(SOD),
        "aa_signature": b64(AA_SIGNATURE),
    })
    check("NFC 503 when master list missing", r.status_code == 503, str(r.status_code))

    # load the synthetic trust chain and exercise the happy path
    main._store = store_with([csca_cert])
    main._store_loaded = True
    r = client.post("/nfc/passive-auth", json={
        "session_id": "sess-test",  # extra caller fields must be tolerated
        "user_id": "user-test",
        "dg1": b64(DG1),
        "dg2_portrait": b64(b"extracted-portrait-jpeg"),
        "sod": b64(SOD),
        "aa_signature": b64(AA_SIGNATURE),
        "dg15": b64(DG15),
        "aa_challenge": b64(AA_CHALLENGE),
    })
    body = r.json()
    check("NFC happy path pa_valid+aa_valid",
          r.status_code == 200 and body["pa_valid"] and body["aa_valid"],
          f"{r.status_code} {body}")
    check("NFC issuing_country", body.get("issuing_country") == "DEU", str(body.get("issuing_country")))
    check("NFC signer_country", body.get("signer_country") == "DE", str(body.get("signer_country")))
    check("NFC dg2_hash_checked false (extracted portrait)",
          body.get("dg2_hash_checked") is False, str(body.get("dg2_hash_checked")))

    # bad base64 -> 422 (not a 500)
    r = client.post("/nfc/passive-auth", json={
        "dg1": "!!!not-base64!!!",
        "dg2_portrait": b64(b"x"),
        "sod": b64(SOD),
        "aa_signature": b64(AA_SIGNATURE),
    })
    check("NFC 422 on bad base64", r.status_code == 422, str(r.status_code))

    # AA signature present but no dg15/aa_challenge -> aa_valid false +
    # honest 'aa_not_evaluable' error token (NOT an exception/5xx)
    r = client.post("/nfc/passive-auth", json={
        "dg1": b64(DG1),
        "dg2_portrait": b64(b"extracted-portrait-jpeg"),
        "sod": b64(SOD),
        "aa_signature": b64(AA_SIGNATURE),
    })
    body = r.json()
    check("NFC aa-not-evaluable pa_valid still true",
          r.status_code == 200 and body["pa_valid"], f"{r.status_code} {body}")
    check("NFC aa-not-evaluable aa_valid false + token",
          body.get("aa_valid") is False and "aa_not_evaluable" in body.get("errors", []),
          str(body))

# ── 9. Master list parsing: LDIF and .ml round-trip ──────────────────────────
der_csca = csca_cert.public_bytes(serialization.Encoding.DER)
ldif = ("dn: cn=CSCA-TEST,c=DE\n"
        "userCertificate;binary:: " + base64.b64encode(der_csca).decode() + "\n\n")
ml = masterlist.parse_master_list(ldif.encode())
check("LDIF parse", len(ml.certs) == 1 and ml.source_format == "ldif", f"{len(ml.certs)}")

ml_content = der(0x30, der_int(0) + der(0x31, der_csca))  # CscaMasterList ::= SEQ { int, SET OF cert }
ml_sd = cms.SignedData({
    "version": 1,
    "digest_algorithms": [algos.DigestAlgorithm({"algorithm": "sha256"})],
    "encap_content_info": cms.ContentInfo({"content_type": "data", "content": ml_content}),
    "signer_infos": [],
})
ml_bytes = cms.ContentInfo({"content_type": "signed_data", "content": ml_sd}).dump()
ml2 = masterlist.parse_master_list(ml_bytes)
check(".ml parse", len(ml2.certs) == 1 and ml2.source_format == "ml", f"{len(ml2.certs)}")
check("store issuer index", len(ml2.find_issuer_candidates(ds_cert.issuer)) == 1)

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
    sys.exit(1)
print("ALL CHECKS PASSED")
