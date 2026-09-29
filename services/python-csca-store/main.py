"""
RemitFlow CSCA Trust Store & eMRTD Chip Authentication Service (Python)

SPEC-wave15 §9 — server-side chip authentication for NFC-read e-passports:

  POST /verify  {dg1, dg2Portrait, sod, aaSignature?, dg15?, aaChallenge?, dg2?}
      -> {paValid, aaValid, issuingCountry, signerCountry, errors[], paReason, aaReason}

  POST /nfc/passive-auth  {dg1, dg2_portrait, sod, aa_signature?, dg15?, aa_challenge?}
      -> {pa_valid, aa_valid, issuing_country, signer_country, dg2_hash_checked, errors[]}
      Snake_case variant consumed by server/routers/kycCapture.ts. dg2_portrait is the
      EXTRACTED portrait image (not raw EF.DG2), so the DG2 hash cannot be checked
      against SOD — reported honestly as dg2_hash_checked=false. Same verification
      core and fail-closed 503 semantics as /verify.

  Passive Authentication (paValid) proves chip data integrity and the
  issuing-state chain (DS cert -> CSCA cert from the loaded master list).
  Active Authentication (aaValid) proves chip cloning resistance when DG15
  is present.

FAIL CLOSED: master list not loaded -> 503 on /verify. Any verification
failure returns paValid/aaValid=false with an explicit reason — the caller
(KYC orchestrator) routes to manual_review. A missing CSCA returns
paValid=false with paReason='csca_not_found' (coverage gap, NOT proof of
fraud).

Trust anchors come from the German BSI CSCA master list ONLY — the ICAO PKD
public master list is not used (non-commercial download terms). See README.md.

Port: 8231 (configurable via PORT env var)
"""

import base64
import binascii
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import tlv
from aa_verify import verify_active_authentication
from masterlist import MasterList, load_master_list
from sod_verify import verify_passive_auth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("python-csca-store")

CSCA_MASTERLIST_PATH = os.environ.get("CSCA_MASTERLIST_PATH", "/app/data/masterlist.ml")

_store: MasterList | None = None
_store_loaded = False
_store_loaded_at: str | None = None
_store_error: str | None = None


def _load_store() -> None:
    global _store, _store_loaded, _store_loaded_at, _store_error
    try:
        _store = load_master_list(CSCA_MASTERLIST_PATH)
        _store_loaded = len(_store.certs) > 0
        _store_error = None if _store_loaded else "master list contained no parsable certificates"
        _store_loaded_at = datetime.now(timezone.utc).isoformat()
        log.info(
            "CSCA master list loaded: %d certs (%d skipped, format=%s, path=%s)",
            len(_store.certs), _store.skipped_unparsable, _store.source_format,
            CSCA_MASTERLIST_PATH,
        )
    except Exception as exc:
        _store = None
        _store_loaded = False
        _store_error = str(exc)
        log.error("CSCA master list NOT loaded (%s) — /verify will fail closed with 503", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_store()
    yield


app = FastAPI(title="RemitFlow CSCA Store / eMRTD Chip Authentication", lifespan=lifespan)


class VerifyRequest(BaseModel):
    dg1: str  # base64 EF.DG1 bytes (mandatory — anchors MRZ + hash check)
    sod: str  # base64 EF.SOD bytes (mandatory)
    dg2Portrait: Optional[str] = None  # portrait image extracted from DG2 (metadata only)
    dg2: Optional[str] = None  # base64 raw EF.DG2 bytes — enables DG2 hash check
    aaSignature: Optional[str] = None  # base64 AA signature over aaChallenge
    dg15: Optional[str] = None  # base64 EF.DG15 bytes (needed for AA verification)
    aaChallenge: Optional[str] = None  # base64 per-session random challenge


class VerifyResponse(BaseModel):
    paValid: bool
    aaValid: bool
    issuingCountry: Optional[str] = None
    signerCountry: Optional[str] = None
    errors: list[str] = []
    paReason: Optional[str] = None
    aaReason: Optional[str] = None


class NfcPassiveAuthRequest(BaseModel):
    # Snake_case contract of server/routers/kycCapture.ts (extra fields such as
    # session_id/user_id are ignored by pydantic).
    dg1: str  # base64 EF.DG1 bytes (mandatory)
    sod: str  # base64 EF.SOD bytes (mandatory)
    dg2_portrait: Optional[str] = None  # base64 EXTRACTED portrait image (metadata only)
    aa_signature: Optional[str] = None  # base64 AA signature over aa_challenge
    dg15: Optional[str] = None  # base64 EF.DG15 bytes (needed for AA verification)
    aa_challenge: Optional[str] = None  # base64 per-session random challenge


class NfcPassiveAuthResponse(BaseModel):
    pa_valid: bool
    aa_valid: bool
    issuing_country: Optional[str] = None
    signer_country: Optional[str] = None
    dg2_hash_checked: bool = False  # always False here: portrait is extracted, not raw DG2
    errors: list[str] = []


def _b64(value: str, field_name: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{field_name} is not valid base64: {exc}")


def _extract_issuing_country(dg1_bytes: bytes) -> str | None:
    """DG1 -> tag 5F1F (MRZ) -> issuing state at positions 2..4 of line 1."""
    mrz_bytes = tlv.find_tag(dg1_bytes, b"\x5f\x1f")
    if not mrz_bytes:
        return None
    mrz = mrz_bytes.decode("ascii", errors="replace")
    if len(mrz) < 5:
        return None
    return mrz[2:5].replace("<", "").strip() or None


@app.get("/health")
def health():
    return {
        "status": "ok" if _store_loaded else "degraded",
        "cscaCount": len(_store.certs) if _store else 0,
        "masterListLoaded": _store_loaded,
        "masterListLoadedAt": _store_loaded_at,
        "masterListPath": CSCA_MASTERLIST_PATH,
        "masterListError": _store_error,
    }


@app.post("/reload")
def reload_store():
    """Reload the master list after scripts/fetch_masterlist.py refreshes it."""
    _load_store()
    if not _store_loaded:
        raise HTTPException(status_code=503, detail=f"master list still not loaded: {_store_error}")
    return {"cscaCount": len(_store.certs), "loadedAt": _store_loaded_at}


class _VerificationOutcome:
    """Internal result of the shared verification core (_run_verification)."""

    def __init__(
        self,
        *,
        pa_valid: bool,
        aa_valid: bool,
        issuing_country: Optional[str],
        signer_country: Optional[str],
        errors: list[str],
        pa_reason: Optional[str],
        aa_reason: str,
        dg2_hash_checked: bool,
    ):
        self.pa_valid = pa_valid
        self.aa_valid = aa_valid
        self.issuing_country = issuing_country
        self.signer_country = signer_country
        self.errors = errors
        self.pa_reason = pa_reason
        self.aa_reason = aa_reason
        self.dg2_hash_checked = dg2_hash_checked


def _require_store() -> None:
    if not _store_loaded or _store is None:
        # FAIL CLOSED: no trust anchors -> no verification, ever.
        raise HTTPException(
            status_code=503,
            detail=f"CSCA master list not loaded ({_store_error}); verification unavailable",
        )


def _run_verification(
    *,
    dg1_bytes: bytes,
    sod_bytes: bytes,
    dg2_bytes: Optional[bytes] = None,
    aa_signature_bytes: Optional[bytes] = None,
    dg15_bytes: Optional[bytes] = None,
    aa_challenge_bytes: Optional[bytes] = None,
    aa_attempted: bool = False,
    aa_dg15_provided: bool = False,
    aa_not_evaluable_reason: Optional[str] = None,
) -> _VerificationOutcome:
    """Shared passive+active authentication core for /verify and /nfc/passive-auth.

    aa_not_evaluable_reason, when set, replaces the AA-unavailable reason strings
    and is always appended to errors (used by /nfc/passive-auth, whose contract
    requires the honest token 'aa_not_evaluable' instead of an exception).
    """
    data_groups: dict[int, bytes] = {1: dg1_bytes}
    errors: list[str] = []
    dg2_hash_checked = dg2_bytes is not None
    if dg2_bytes is not None:
        data_groups[2] = dg2_bytes
    else:
        # The minimal client contract sends only the extracted portrait, whose
        # bytes cannot be hash-checked against SOD. Honest coverage note, not
        # a failure.
        errors.append("dg2_full_not_provided: portrait extracted client-side; DG2 hash check skipped")

    pa = verify_passive_auth(sod_bytes, data_groups, _store)

    aa_valid = False
    aa_reason: str
    if aa_signature_bytes is not None and dg15_bytes is not None and aa_challenge_bytes is not None:
        aa_result, aa_reason = verify_active_authentication(dg15_bytes, aa_challenge_bytes, aa_signature_bytes)
        aa_valid = aa_result is True
        if aa_result is False:
            errors.append(f"aa_failed: {aa_reason}")
    elif aa_attempted and not aa_dg15_provided:
        aa_reason = aa_not_evaluable_reason or "aa_signature_present_but_dg15_missing"
        errors.append(aa_reason)
    else:
        aa_reason = aa_not_evaluable_reason or "aa_not_performed: chip has no DG15 or client could not run AA"
        if aa_not_evaluable_reason:
            errors.append(aa_reason)

    return _VerificationOutcome(
        pa_valid=pa.pa_valid,
        aa_valid=aa_valid,
        issuing_country=_extract_issuing_country(dg1_bytes),
        signer_country=pa.signer_country or pa.ds_issuer_country,
        errors=pa.errors + errors,
        pa_reason=pa.reason,
        aa_reason=aa_reason,
        dg2_hash_checked=dg2_hash_checked,
    )


@app.post("/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
    _require_store()

    dg1_bytes = _b64(req.dg1, "dg1")
    sod_bytes = _b64(req.sod, "sod")
    dg2_bytes = _b64(req.dg2, "dg2") if req.dg2 else None

    # AA inputs are only decoded when all three are present (unchanged behaviour).
    dg15_bytes: Optional[bytes] = None
    challenge: Optional[bytes] = None
    signature: Optional[bytes] = None
    if req.aaSignature and req.dg15 and req.aaChallenge:
        dg15_bytes = _b64(req.dg15, "dg15")
        challenge = _b64(req.aaChallenge, "aaChallenge")
        signature = _b64(req.aaSignature, "aaSignature")

    out = _run_verification(
        dg1_bytes=dg1_bytes,
        sod_bytes=sod_bytes,
        dg2_bytes=dg2_bytes,
        aa_signature_bytes=signature,
        dg15_bytes=dg15_bytes,
        aa_challenge_bytes=challenge,
        aa_attempted=bool(req.aaSignature),
        aa_dg15_provided=bool(req.dg15),
    )

    return VerifyResponse(
        paValid=out.pa_valid,
        aaValid=out.aa_valid,
        issuingCountry=out.issuing_country,
        signerCountry=out.signer_country,
        errors=out.errors,
        paReason=out.pa_reason,
        aaReason=out.aa_reason,
    )


@app.post("/nfc/passive-auth", response_model=NfcPassiveAuthResponse)
def nfc_passive_auth(req: NfcPassiveAuthRequest):
    """Snake_case NFC endpoint consumed by server/routers/kycCapture.ts.

    dg2_portrait is the EXTRACTED portrait image, not raw EF.DG2, so the DG2
    hash integrity check cannot run from it — reported as dg2_hash_checked=false.
    AA is only evaluable when aa_signature, dg15 AND aa_challenge are all
    present; otherwise aa_valid=false with the honest token 'aa_not_evaluable'
    (a coverage note, not an exception).
    """
    _require_store()

    dg1_bytes = _b64(req.dg1, "dg1")
    sod_bytes = _b64(req.sod, "sod")
    if req.dg2_portrait is not None:
        _b64(req.dg2_portrait, "dg2_portrait")  # validate encoding only; bytes not hash-checkable

    # AA inputs are only decoded when all three are present.
    dg15_bytes: Optional[bytes] = None
    challenge: Optional[bytes] = None
    signature: Optional[bytes] = None
    if req.aa_signature and req.dg15 and req.aa_challenge:
        dg15_bytes = _b64(req.dg15, "dg15")
        challenge = _b64(req.aa_challenge, "aa_challenge")
        signature = _b64(req.aa_signature, "aa_signature")

    out = _run_verification(
        dg1_bytes=dg1_bytes,
        sod_bytes=sod_bytes,
        dg2_bytes=None,  # only the extracted portrait is available — DG2 hash not checkable
        aa_signature_bytes=signature,
        dg15_bytes=dg15_bytes,
        aa_challenge_bytes=challenge,
        aa_attempted=bool(req.aa_signature),
        aa_dg15_provided=bool(req.dg15),
        aa_not_evaluable_reason="aa_not_evaluable",
    )

    return NfcPassiveAuthResponse(
        pa_valid=out.pa_valid,
        aa_valid=out.aa_valid,
        issuing_country=out.issuing_country,
        signer_country=out.signer_country,
        dg2_hash_checked=out.dg2_hash_checked,
        errors=out.errors,
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8231")))
