# go-bdc-regulatory-returns

Builder + honest submission adapter for the periodic regulatory returns a
CBN-licensed Bureau de Change must file (requirement inventory §M7):

| Return type | Fixture layout covers |
|---|---|
| `fifx` | FX purchase/sale transaction lines + per-currency totals |
| `fina` | Financial position: shareholders' funds, NOP & borrowing vs limits (integer bps math) |
| `carp` | Consolidated per-branch activity (buy/sell counts and volumes) |
| `trms` | Transaction-monitoring reportable lines (≥$10k SoF threshold, PEP) |
| `extranet` | Consolidated CBN extranet periodic upload envelope |

## ⚠️ Honest-adapter policy (READ FIRST)

Per SPEC-bdc §0 rule 4:

1. **Fixture layouts, not CBN conformance.** The real CBN field layouts for
   FIFX/FinA/CARP/TRMS/extranet are **not publicly published**. Every payload
   this service builds is stamped `formatVersion: "v1-fixture"` and every
   `/returns/build` response carries `metadata.fixtureNotice` stating that
   fixture fidelity is validated during the CBN Provisional Approval (PA)
   window. **Nothing here claims CBN conformance.** When the real layouts are
   confirmed in the PA window, bump `FixtureFormatVersion` and regenerate the
   golden files.
2. **Submission never fabricates success.** `/returns/submit` behaviour is
   driven by `BDC_RETURNS_MODE`:
   - `sandbox` (default): returns `{ "simulated": true, "ackRef": "SIM-<uuid>" }`.
     No external call is made; the marker is explicit.
   - `production` **without** `CBN_EXTRANET_BASE_URL` + `CBN_EXTRANET_TOKEN`:
     fails closed with `503 {"error":"UNAVAILABLE","reason":"credentials not configured"}`.
   - `production` **with** credentials configured: performs the real HTTPS POST
     to the extranet endpoint (15s bounded client) and returns the real ack
     reference; upstream rejection → `502 UPSTREAM_ERROR`, record kept as `failed`.

## Endpoints

- `POST /returns/build` — `{tenantId, returnType, periodStart, periodEnd, data}`
  → `{payload, validationErrors[], formatVersion, metadata}`.
  **Deterministic**: same input → same payload bytes (lines sorted by
  `(date, txnRef)`, integer-only math, no wall-clock fields inside payloads).
  `validationErrors[]` entries are `{field, rule, value}` with indexed field
  paths (e.g. `transactions[2].purposeCode`).
- `POST /returns/submit` — `{returnType, payload}` → see honest-adapter policy.
- `GET /returns/status/{id}` — submission record (in-memory store, mirrored to
  Postgres when `DATABASE_URL` is set).
- `GET /healthz` — liveness: `{status, service, version, mode, db}`.

## Validation rules enforced (field, rule, value)

- Header: `tenantId` positive, `returnType` enum, `periodStart/periodEnd`
  `YYYY-MM-DD` and ordered.
- Transactions: required `txnRef`; date within period; `txnType` enum;
  `currency` ISO-4217 alpha-3 upper; positive `fxAmountMinor`,
  `nairaAmountMinor`, `rateMinor`; `sell_fx` requires an approved
  `purposeCode` (PTA/BTA/SCHOOL_FEES/MEDICAL/EXAM_FEES/SUBSCRIPTION/
  NONRESIDENT_REPATRIATION); cash portion ≤ 25% of the FX amount
  (requirement inventory §C).
- `trms`: lines ≥ $10k (`fxAmountMinor ≥ 1_000_000` minor units) require
  `sofDeclarationId` (SoF hard limit, requirement inventory §C).
- `carp`: non-empty unique branch list; every transaction's `branchCode` must
  reference a listed branch.
- `fina`: positive shareholders' funds, non-negative NOP/borrowing, limit
  percents in 1..100.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8137` | listen port |
| `BDC_RETURNS_MODE` | `sandbox` | `sandbox` \| `production` |
| `CBN_EXTRANET_BASE_URL` | — | production extranet endpoint (required in production) |
| `CBN_EXTRANET_TOKEN` | — | production bearer token (required in production) |
| `DATABASE_URL` | — | optional Postgres DSN; when reachable, status records are mirrored to table `bdc_return_submissions` (created IF NOT EXISTS, sibling `ensureTransferTable` pattern). Without it the status store is in-memory only — records are lost on restart. |
| `GIN_MODE` | release | gin framework mode |

Headers: `X-Trace-Id` is propagated (generated if absent, echoed on every
response); `X-Tenant-Id` is captured into the request context.

## Fixture-versioning policy

- Current version: **`v1-fixture`** (constant `FixtureFormatVersion` in
  `builders.go`).
- Layouts are derived from the requirement inventory (M7 regulatory
  reporting), not from any CBN-published schema.
- Any layout change requires: bump the version constant, regenerate goldens
  (`go test ./... -update`), and review the diff. Golden files under
  `testdata/` pin the exact payload bytes per builder.

## Development

```bash
go test ./...            # run golden + handler tests
go test ./... -update    # regenerate golden files (review the diff!)
gofmt -l . && go vet ./... && go build ./...
```

Conventions copied from sibling services `go-bdc-connector` and
`go-goaml-integration`: gin framework, `github.com/remitflow/<name>` module
path, `envOr` config helper, lib/pq optional-Postgres pattern, structured
startup/shutdown log lines, graceful shutdown, non-root Alpine Dockerfile.
