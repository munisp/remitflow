"""CSCA master list parsing (clean-room, asn1crypto + cryptography only).

Supports the two formats the German BSI distributes its CSCA master list in:

  * LDIF  — LDAP dump with `userCertificate;binary:: <base64>` attributes
  * .ml   — ICAO Doc 9303 Part 12 CscaMasterList:
            ContentInfo / SignedData / eContent = SEQUENCE { version, SET OF Certificate }

NOTE: the ICAO PKD public master list (pkddownloadsg.icao.int) is NOT used
anywhere in this service — its download terms are non-commercial. The BSI
master list permits redistribution/commercial use subject to the conditions
documented in README.md. Do not add ICAO PKD scraping here.
"""

from __future__ import annotations

import base64
import binascii
import logging
from dataclasses import dataclass, field

from asn1crypto import cms, core, x509 as asn1_x509
from cryptography import x509

log = logging.getLogger("python-csca-store.masterlist")


class CscaMasterList(core.Sequence):
    """CscaMasterList ::= SEQUENCE { version INTEGER, certList SET OF Certificate }"""
    _fields = [
        ("version", core.Integer),
        ("cert_list", core.SetOf, {"spec": asn1_x509.Certificate}),
    ]


@dataclass
class MasterList:
    certs: list[x509.Certificate] = field(default_factory=list)
    skipped_unparsable: int = 0
    source_format: str = "unknown"
    _idx: dict[bytes, list[x509.Certificate]] | None = field(default=None, repr=False)

    # subject DER -> certs (a CSCA's subject == the DS cert's issuer)
    def _index(self) -> dict[bytes, list[x509.Certificate]]:
        if self._idx is None:
            idx: dict[bytes, list[x509.Certificate]] = {}
            for c in self.certs:
                idx.setdefault(c.subject.public_bytes(), []).append(c)
            self._idx = idx
        return self._idx

    def find_issuer_candidates(self, issuer: x509.Name) -> list[x509.Certificate]:
        return self._index().get(issuer.public_bytes(), [])


def _parse_ldif(raw: bytes) -> list[bytes]:
    """Extract DER certs from LDIF `userCertificate;binary::` attributes.

    Handles RFC 2849 line unfolding (continuation lines start with a space)
    and both `userCertificate;binary::` (base64) and `userCertificate::`
    (base64 without the binary transfer option) spellings.
    """
    text = raw.decode("utf-8", errors="replace")
    # Unfold continuation lines.
    lines: list[str] = []
    for line in text.splitlines():
        if line.startswith(" ") and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line.rstrip("\r"))

    ders: list[bytes] = []
    for line in lines:
        lower = line.lower()
        if lower.startswith("usercertificate") and "::" in line:
            _, _, b64 = line.partition("::")
            try:
                ders.append(base64.b64decode(b64.strip()))
            except (binascii.Error, ValueError):
                log.warning("ldif: skipping entry with invalid base64 certificate")
        elif lower.startswith("usercertificate") and ":" in line:
            # userCertificate: <PEM-ish or raw> — rare; only handle PEM blocks elsewhere.
            continue
    return ders


def _parse_ml(raw: bytes) -> list[bytes]:
    """Extract DER certs from an ICAO CscaMasterList (.ml) CMS structure."""
    ci = cms.ContentInfo.load(raw)
    if ci["content_type"].native != "signed_data":
        raise ValueError(f".ml content type is {ci['content_type'].native}, expected signed_data")
    sd = ci["content"]
    econtent = sd["encap_content_info"]["content"]
    # ParsableOctetString.parsed for known content types; otherwise parse the
    # OCTET STRING payload with our own CscaMasterList spec.
    parsed = getattr(econtent, "parsed", None)
    ml = parsed if isinstance(parsed, CscaMasterList) else CscaMasterList.load(econtent.contents)
    return [cert.dump() for cert in ml["cert_list"]]


def parse_master_list(raw: bytes) -> MasterList:
    """Auto-detect LDIF vs .ml and return a MasterList of CSCA certificates."""
    head = raw[:4096].lower()
    if raw.lstrip().startswith(b"dn:") or b"usercertificate" in head:
        ders, fmt = _parse_ldif(raw), "ldif"
    else:
        ders, fmt = _parse_ml(raw), "ml"

    ml = MasterList(source_format=fmt)
    seen: set[bytes] = set()
    for der in ders:
        try:
            cert = x509.load_der_x509_certificate(der)
        except Exception as exc:  # strict DER rejects some real-world CSCAs
            ml.skipped_unparsable += 1
            log.warning("master list: unparsable CSCA certificate skipped: %s", exc)
            continue
        if der in seen:
            continue
        seen.add(der)
        ml.certs.append(cert)
    return ml


def load_master_list(path: str) -> MasterList:
    with open(path, "rb") as fh:
        return parse_master_list(fh.read())
