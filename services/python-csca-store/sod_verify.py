"""Passive Authentication: SOD (EF.SOD) CMS SignedData verification.

Clean-room implementation over asn1crypto (MIT) + cryptography (Apache-2.0).

Checks performed (ICAO Doc 9303-10/-11):
  1. SOD is a CMS SignedData; eContent is an LdsSecurityObject.
  2. Data-group hash integrity: hash(DG bytes) == the hash stored in the
     eContent for every data group supplied by the caller.
  3. CMS signature over the eContent (via signedAttrs, incl. messageDigest
     attribute cross-check) using the embedded Document Signer (DS) cert.
  4. DS certificate chains to a CSCA certificate in the loaded master list
     (issuer name match + signature verification + validity window).

FAIL CLOSED: any structural or cryptographic failure yields paValid=False
with a specific reason string. Missing CSCA yields reason 'csca_not_found'
so the server routes the session to manual_review instead of rejecting a
plausibly-legitimate document from a state absent from the BSI list.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from asn1crypto import algos, cms, core
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa, utils as asym_utils

from masterlist import MasterList

log = logging.getLogger("python-csca-store.sod")


class DataGroupHash(core.Sequence):
    """DataGroupHash ::= SEQUENCE { dataGroupNumber INTEGER, dataGroupHashValue OCTET STRING }"""
    _fields = [
        ("data_group_number", core.Integer),
        ("data_group_hash_value", core.OctetString),
    ]


class LdsSecurityObject(core.Sequence):
    """LdsSecurityObject ::= SEQUENCE { version, hashAlgorithm, dataGroupHashValues }"""
    _fields = [
        ("version", core.Integer),
        ("hash_algorithm", algos.DigestAlgorithm),
        ("data_group_hash_values", core.SequenceOf, {"spec": DataGroupHash}),
    ]

# DigestAlgorithmIdentifier OID -> (hashlib name, cryptography HashAlgorithm)
_DIGEST_OIDS = {
    "1.3.14.3.2.26": ("sha1", hashes.SHA1),
    "2.16.840.1.101.3.4.2.1": ("sha256", hashes.SHA256),
    "2.16.840.1.101.3.4.2.2": ("sha384", hashes.SHA384),
    "2.16.840.1.101.3.4.2.3": ("sha512", hashes.SHA512),
}

# signatureAlgorithm OID -> kind ("rsa" / "pss" / "ecdsa") + digest OID suffix
_SIG_ALGOS = {
    "1.2.840.113549.1.1.5": ("rsa", "sha1"),
    "1.2.840.113549.1.1.11": ("rsa", "sha256"),
    "1.2.840.1.101.3.4.3.2": ("pss", "sha256"),
    "1.2.840.113549.1.1.12": ("rsa", "sha384"),
    "1.2.840.1.101.3.4.3.3": ("pss", "sha384"),
    "1.2.840.113549.1.1.13": ("rsa", "sha512"),
    "1.2.840.113549.1.1.14": ("rsa", "sha224"),
    "1.2.840.113549.1.1.10": ("pss", None),  # params carry the digest
    "1.2.840.10045.4.1": ("ecdsa", "sha1"),
    "1.2.840.10045.4.3.1": ("ecdsa", "sha224"),
    "1.2.840.10045.4.3.2": ("ecdsa", "sha256"),
    "1.2.840.10045.4.3.3": ("ecdsa", "sha384"),
    "1.2.840.10045.4.3.4": ("ecdsa", "sha512"),
    # Brainpool ECDSA (RFC 5639 / TR-03111)
    "1.3.36.3.3.2.8.1.1.7": ("ecdsa", "sha256"),
    "1.3.36.3.3.2.8.1.1.11": ("ecdsa", "sha384"),
    "1.3.36.3.3.2.8.1.1.13": ("ecdsa", "sha512"),
}

_HASH_BY_NAME = {
    "sha1": hashes.SHA1,
    "sha224": hashes.SHA224,
    "sha256": hashes.SHA256,
    "sha384": hashes.SHA384,
    "sha512": hashes.SHA512,
}

# asn1crypto maps well-known OIDs to short names in .native; accept both.
_SIG_ALIASES = {
    "sha1_rsa": "1.2.840.113549.1.1.5",
    "sha256_rsa": "1.2.840.113549.1.1.11",
    "sha384_rsa": "1.2.840.113549.1.1.12",
    "sha512_rsa": "1.2.840.113549.1.1.13",
    "sha224_rsa": "1.2.840.113549.1.1.14",
    "rsassa_pss": "1.2.840.113549.1.1.10",
    "sha1_ecdsa": "1.2.840.10045.4.1",
    "sha224_ecdsa": "1.2.840.10045.4.3.1",
    "sha256_ecdsa": "1.2.840.10045.4.3.2",
    "sha384_ecdsa": "1.2.840.10045.4.3.3",
    "sha512_ecdsa": "1.2.840.10045.4.3.4",
    # brainpool names used by asn1crypto (RFC 5639)
    "ecdsa_sha256": "1.3.36.3.3.2.8.1.1.7",
    "ecdsa_sha384": "1.3.36.3.3.2.8.1.1.11",
    "ecdsa_sha512": "1.3.36.3.3.2.8.1.1.13",
}


def _normalize_sig_algo(key: str) -> str:
    return _SIG_ALIASES.get(key, key)


@dataclass
class PassiveAuthResult:
    pa_valid: bool = False
    reason: str = ""
    errors: list[str] = field(default_factory=list)
    signer_country: str | None = None  # CSCA subject C that anchored the chain
    ds_issuer_country: str | None = None  # DS cert issuer C
    digest_algorithm: str | None = None


def _verify_signature(public_key, signature: bytes, data: bytes, algo_oid: str,
                      params: core.Asn1Value | None = None) -> None:
    """Verify a signature; raises InvalidSignature / ValueError on failure."""
    algo_oid = _normalize_sig_algo(algo_oid)
    if algo_oid not in _SIG_ALGOS:
        raise ValueError(f"unsupported signature algorithm OID {algo_oid}")
    kind, hash_name = _SIG_ALGOS[algo_oid]

    if kind == "pss" and hash_name is None and params is not None:
        # rsaPSS params: hashAlgorithm [0], maskGenAlgorithm [1], saltLength [2]
        try:
            raw = params["hash_algorithm"]["algorithm"].native  # name or dotted OID
            for oid, entry in _DIGEST_OIDS.items():
                if raw in (oid, entry[0]):
                    hash_name = entry[0]
                    break
        except Exception:
            hash_name = "sha256"  # RFC 4056 default is sha1, but eMRTD PSS is sha256 in practice
    if hash_name is None:
        hash_name = "sha256"
    hash_algo = _HASH_BY_NAME[hash_name]()

    if isinstance(public_key, rsa.RSAPublicKey):
        if kind == "pss":
            pad = padding.PSS(mgf=padding.MGF1(hash_algo), salt_length=hash_algo.digest_size)
        else:
            pad = padding.PKCS1v15()
        public_key.verify(signature, data, pad, hash_algo)
    elif isinstance(public_key, ec.EllipticCurvePublicKey):
        public_key.verify(signature, data, ec.ECDSA(hash_algo))
    else:
        raise ValueError(f"unsupported public key type {type(public_key).__name__}")


def _cert_country(cert: x509.Certificate, attr: str = "subject") -> str | None:
    name = cert.subject if attr == "subject" else cert.issuer
    attrs = name.get_attributes_for_oid(x509.NameOID.COUNTRY_NAME)
    return attrs[0].value if attrs else None


def _check_validity(cert: x509.Certificate, label: str, errors: list[str]) -> bool:
    now = datetime.now(timezone.utc)
    try:
        nb, na = cert.not_valid_before_utc, cert.not_valid_after_utc
    except AttributeError:  # older cryptography
        nb = cert.not_valid_before.replace(tzinfo=timezone.utc)
        na = cert.not_valid_after.replace(tzinfo=timezone.utc)
    if now < nb:
        errors.append(f"{label}_not_yet_valid")
        return False
    if now > na:
        errors.append(f"{label}_expired")
        return False
    return True


def parse_sod(sod_der: bytes) -> tuple[cms.SignedData, bytes, dict[int, bytes], str]:
    """Parse SOD -> (SignedData, eContent bytes, {dg_number: dg_hash}, hashlib name)."""
    ci = cms.ContentInfo.load(sod_der)
    if ci["content_type"].native != "signed_data":
        raise ValueError("SOD content is not CMS signed_data")
    sd = ci["content"]

    ec_content = sd["encap_content_info"]["content"]
    econtent_bytes = ec_content.contents  # inner OCTET STRING payload
    # ParsableOctetString.parsed for known content types; otherwise parse the
    # payload with our own LdsSecurityObject spec.
    parsed = getattr(ec_content, "parsed", None)
    lds = parsed if isinstance(parsed, LdsSecurityObject) else LdsSecurityObject.load(econtent_bytes)

    digest_key = lds["hash_algorithm"]["algorithm"].native  # name ('sha256') or dotted OID
    digest = None
    for oid, entry in _DIGEST_OIDS.items():
        if digest_key in (oid, entry[0]):
            digest = entry
            break
    if digest is None:
        raise ValueError(f"unsupported SOD digest algorithm {digest_key}")

    dg_hashes: dict[int, bytes] = {}
    for dg_hash in lds["data_group_hash_values"]:
        dg_hashes[int(dg_hash["data_group_number"].native)] = bytes(
            dg_hash["data_group_hash_value"].native
        )
    return sd, econtent_bytes, dg_hashes, digest[0]


def _find_ds_certificate(sd: cms.SignedData, si: cms.SignerInfo) -> x509.Certificate:
    sid = si["sid"]
    if sid.name != "issuer_and_serial_number":
        raise ValueError(f"unsupported signer id type {sid.name}")
    wanted_serial = sid.chosen["serial_number"].native
    wanted_issuer = sid.chosen["issuer"].dump()
    for cert_choice in sd["certificates"]:
        if cert_choice.name != "certificate":
            continue
        cert = x509.load_der_x509_certificate(cert_choice.chosen.dump())
        if cert.serial_number == wanted_serial and cert.issuer.public_bytes() == wanted_issuer:
            return cert
    raise ValueError("document signer certificate not found in SOD")


def verify_passive_auth(
    sod_der: bytes,
    data_groups: dict[int, bytes],
    store: MasterList,
) -> PassiveAuthResult:
    """Run all passive-auth checks. Never raises; failures land in errors[]."""
    result = PassiveAuthResult()
    try:
        sd, econtent_bytes, dg_hashes, hashlib_name = parse_sod(sod_der)
        result.digest_algorithm = hashlib_name
    except Exception as exc:
        result.reason = "sod_parse_failed"
        result.errors.append(f"sod_parse_failed: {exc}")
        return result

    # 1. Data-group hash integrity for every group the caller supplied.
    for dg_number, dg_bytes in sorted(data_groups.items()):
        expected = dg_hashes.get(dg_number)
        if expected is None:
            result.errors.append(f"dg{dg_number}_hash_absent_from_sod")
            result.reason = "dg_hash_mismatch"
            return result
        actual = hashlib.new(hashlib_name, dg_bytes).digest()
        if actual != expected:
            result.errors.append(f"dg{dg_number}_hash_mismatch")
            result.reason = "dg_hash_mismatch"
            return result

    # 2. CMS signature over eContent using the embedded DS certificate.
    try:
        si = sd["signer_infos"][0]
        ds_cert = _find_ds_certificate(sd, si)
        result.ds_issuer_country = _cert_country(ds_cert, "issuer")

        signed_attrs = si["signed_attrs"]
        if len(signed_attrs) > 0:  # len() triggers asn1crypto lazy child parsing
            # Verify messageDigest attribute == hash(eContent)
            md_ok = False
            for attr in signed_attrs:
                if attr["type"].native == "message_digest":
                    md_ok = bytes(attr["values"][0].native) == hashlib.new(
                        hashlib_name, econtent_bytes
                    ).digest()
            if not md_ok:
                result.reason = "message_digest_mismatch"
                result.errors.append("signed_attrs message_digest does not match eContent hash")
                return result
            # Signature covers DER of signedAttrs with the SET OF tag (0x31),
            # not the CMS [0] IMPLICIT tag — rewrite the first byte.
            data_to_verify = b"\x31" + signed_attrs.dump()[1:]
        else:
            data_to_verify = econtent_bytes

        sig_algo_oid = si["signature_algorithm"]["algorithm"].native
        sig_params = si["signature_algorithm"]["parameters"]
        _verify_signature(ds_cert.public_key(), bytes(si["signature"].native),
                          data_to_verify, sig_algo_oid, sig_params)
    except InvalidSignature:
        result.reason = "sod_signature_invalid"
        result.errors.append("SOD CMS signature verification failed")
        return result
    except Exception as exc:
        result.reason = "sod_signature_error"
        result.errors.append(f"sod_signature_error: {exc}")
        return result

    if not _check_validity(ds_cert, "ds_cert", result.errors):
        result.reason = "ds_cert_invalid_validity"
        return result

    # 3. Chain DS -> CSCA from the master list.
    candidates = store.find_issuer_candidates(ds_cert.issuer)
    if not candidates:
        result.reason = "csca_not_found"
        result.errors.append(
            "no CSCA certificate in the master list matches the DS issuer — "
            "route to manual_review (coverage gap, not proof of fraud)"
        )
        return result

    chain_ok = False
    chain_errors: list[str] = []
    for csca in candidates:
        try:
            oid = ds_cert.signature_algorithm_oid.dotted_string
            params = None
            _verify_signature(csca.public_key(), ds_cert.signature,
                              ds_cert.tbs_certificate_bytes, oid, params)
        except InvalidSignature:
            chain_errors.append("ds_signature_not_from_candidate_csca")
            continue
        except Exception as exc:
            chain_errors.append(f"chain_verify_error: {exc}")
            continue
        if _check_validity(csca, "csca_cert", result.errors):
            chain_ok = True
            result.signer_country = _cert_country(csca)
            break

    if not chain_ok:
        result.reason = "csca_chain_invalid"
        result.errors.extend(chain_errors or ["csca_chain_invalid"])
        return result

    result.pa_valid = True
    result.reason = "ok"
    return result
