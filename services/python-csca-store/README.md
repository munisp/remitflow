# python-csca-store — CSCA Trust Store & eMRTD Chip Authentication

SPEC-wave15 §9. Server-side verification of NFC-read e-passport (eMRTD) chip
data produced by the React Native `NfcPassport` module
(`uis/react-native/src/nfc/NfcPassport.ts`).

## What it does

`POST /verify` accepts the base64 chip data groups from the mobile app:

```json
{
  "dg1":         "<base64 EF.DG1>",           // required
  "sod":         "<base64 EF.SOD>",           // required
  "dg2Portrait": "<base64 portrait image>",   // metadata only (see below)
  "dg2":         "<base64 raw EF.DG2>",       // optional — enables DG2 hash check
  "aaSignature": "<base64>",                  // optional
  "dg15":        "<base64 EF.DG15>",          // optional, needed for AA verify
  "aaChallenge": "<base64>"                   // optional, needed for AA verify
}
```

and returns:

```json
{
  "paValid": true, "aaValid": false,
  "issuingCountry": "DEU", "signerCountry": "DE",
  "errors": [], "paReason": "ok", "aaReason": "aa_not_performed: ..."
}
```

- **Passive Authentication (`paValid`)** — proves chip data integrity and the
  issuing-state chain: data-group hashes inside the SOD eContent match the
  received DG bytes, the CMS signature over the SOD verifies with the embedded
  Document Signer (DS) certificate, and the DS certificate chains (issuer name
  + signature + validity window) to a CSCA certificate in the loaded master
  list.
- **Active Authentication (`aaValid`)** — proves cloning resistance **only
  when the chip has DG15**: the chip's signature over a per-session random
  challenge verifies against the DG15 public key. Chips digest the challenge
  internally with issuer-dependent algorithms, so the standard candidate
  digests (SHA-256/1/384/512/224) are tried, as JMRTD/NFCPassportReader do.

## Honest capability notes (read before relying on this)

- **Coverage is partial.** The BSI master list covers ~114 issuing states;
  many ICAO states publish nowhere public. A missing CSCA returns
  `paValid=false, paReason="csca_not_found"` — a *coverage gap*, not evidence
  of fraud. The KYC orchestrator must route such sessions to `manual_review`,
  not reject them.
- **`dg2Portrait` cannot be hash-checked.** The minimal client contract ships
  the portrait image extracted from DG2, not raw DG2 bytes; only the raw DG2
  can be checked against the SOD hash. Clients that also send `dg2` get the
  full check (a "skipped" note appears in `errors` otherwise).
- **No CRL checking.** CSCA/DS revocation lists are not consulted; a revoked
  DS certificate would still verify. Planned follow-up: BSI CRL download
  (`http://bsi.bund.de/csca_crl`) + deviation list handling.
- **Master list signature is not verified.** The `.ml` file's CMS wrapper is
  parsed but the BSI Master List Signer signature is not chained to a
  pinned root. Integrity currently rests on TLS to `bsi.bund.de` and on
  mounting the file read-only.
- **AA with RSASSA-PSS DS certs** falls back to a SHA-256 assumption when the
  cert's signature-algorithm parameters are not in the static table.
- The strict `cryptography` DER parser rejects a handful of real-world CSCA
  certificates (trailing bytes in `signatureAlg`); those are counted in
  `skipped_unparsable` in `/health` and logged, never silently treated as
  anchors.
- This service is **verification-only**: it holds public trust anchors, no
  private keys, no PII persistence. Nothing is written to a database.

## Fail-closed behaviour

| Condition | Result |
|---|---|
| Master list missing/unparsable/empty at startup | `/health` = `degraded`; `/verify` → **503** |
| SOD unparseable / hash mismatch / bad CMS signature | `paValid=false` + reason |
| DS issuer absent from master list | `paValid=false, paReason=csca_not_found` (→ manual_review) |
| AA data absent | `aaValid=false, aaReason=aa_not_performed` (normal — many passports lack DG15) |
| AA signature invalid | `aaValid=false` + `errors` (→ fraud signal) |

## Trust anchor source — BSI only, never ICAO PKD

`scripts/fetch_masterlist.py` downloads the **German BSI CSCA Master List**:

```
https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/GermanMasterList.html
  → GermanMasterList.zip  (contains DE_ML_<date>.ml [+ LDIF])
```

Override via `CSCA_MASTERLIST_URL` if the path changes. The script **refuses
ICAO PKD URLs**: the ICAO PKD public master list is licensed for
non-commercial use only. The BSI list permits commercial use provided it is
not used for advertising and no appearance of BSI cooperation is created —
keep this notice in any user-facing copy.

Run the fetcher as an initContainer or scheduled sidecar; then call
`POST /reload` or restart. The service writes nothing of its own.

## Run

```bash
pip install -r requirements.txt
python scripts/fetch_masterlist.py --out ./data/masterlist.ml
CSCA_MASTERLIST_PATH=./data/masterlist.ml PORT=8231 python main.py
```

Endpoints: `GET /health`, `POST /reload`, `POST /verify`. Port `8231`.

## Dependencies (all permissive licenses)

| Package | License | Purpose |
|---|---|---|
| fastapi / uvicorn / pydantic | MIT / BSD / MIT | HTTP service |
| cryptography | Apache-2.0/BSD | X.509 + signature verification |
| asn1crypto | MIT | CMS SignedData (SOD) + CscaMasterList ASN.1 parsing |
| httpx | BSD-3-Clause | master list download script |
