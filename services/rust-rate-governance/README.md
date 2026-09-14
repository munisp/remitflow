# rust-rate-governance

BDC platform rate governance service (SPEC-bdc §4.4): band validation and
two-leg cross-rate computation with **integer-exact math — no floats anywhere
in the computation**. Pure-compute service: no database, no external calls.

## Rate scale convention

All rates are **integers scaled 1e4** (4 decimal places of rate precision):

| Human rate | Wire value (JSON number, i64) |
|---|---|
| 1600.25 | `16002500` |
| 2050.0000 | `20500000` |
| 1.0000 | `10000` |

For naira rates the wire value is kobo per 1 FX unit × 10⁴. JSON numbers MUST
be integers — a fractional JSON number (e.g. `1600.25` on the wire) is a
client bug and is rejected with `400 MALFORMED_BODY`.

## Rounding rules

- **Band decision (`withinBand`)**: exact cross-multiplied integer comparison
  `|rate − reference| × 10000 <= bandBps × reference` — no division, no
  rounding. A rate at **exactly** `bandBps` deviation is within the band; one
  scaled unit beyond it is not.
- **Reported `deviationBps`**: `|rate − reference| × 10000 / reference` with
  integer (floor) division. This is a display value; the band decision never
  depends on its rounding.
- **Cross rates**: **round-half-away-from-zero** in integer math:
  `q = sign(n) × ⌊(2|n| + d) / 2d⌋`. Exact `.5` ties round away from zero
  (`5/2 → 3`, `-5/2 → -3`, `1/2 → 1`). No float is ever constructed.

All intermediate arithmetic is `i128`, so overflow is impossible for any i64
inputs; results that would exceed i64 saturate (documented, never wrap/panic).

## Endpoints

### `POST /quote/validate`

Request (contract field names; SPEC-bdc §4.4 aliases `rateMinor` /
`referenceMinor` are also accepted):

```json
{ "rate": 16080000, "reference": 16000000, "bandBps": 50 }
```

Response:

```json
{ "withinBand": true, "deviationBps": 50 }
```

Validation (400): `reference <= 0` → `INVALID_REFERENCE` (zero/negative
reference rejected); `rate <= 0` → `INVALID_RATE`; `bandBps < 0` →
`INVALID_BAND`.

### `POST /quote/cross`

Two-leg cross rates via the naira mid. `ngnMidPerUnit.from` / `.to` are the
naira mids (scaled 1e4 kobo) for one unit of `fromCcy` / `toCcy`.

```json
{ "fromCcy": "USD", "toCcy": "GBP", "ngnMidPerUnit": { "from": 16002500, "to": 20500000 } }
```

Response:

```json
{
  "fromCcy": "USD",
  "toCcy": "GBP",
  "buyRate": 7806,
  "sellRate": 12810,
  "scale": 10000,
  "rounding": "round-half-away-from-zero",
  "legs": [
    { "leg": 1, "action": "buy",  "currency": "USD", "ngnMidPerUnit": 16002500, "description": "buy fromCcy with naira at the naira mid" },
    { "leg": 2, "action": "sell", "currency": "GBP", "ngnMidPerUnit": 20500000, "description": "sell toCcy for naira at the naira mid" }
  ]
}
```

Composition (per SPEC: buy fromCcy with naira, sell toCcy for naira):

- `buyRate` = `from × 10000 / to` — toCcy units (scaled 1e4) per 1 fromCcy unit.
- `sellRate` = `to × 10000 / from` — fromCcy units (scaled 1e4) per 1 toCcy unit.

Both rounded half-away-from-zero. Worked example above:
`16002500×10000/20500000 = 7806.0975… → 7806`;
`20500000×10000/16002500 = 12810.4983… → 12810`.

Validation (400): currency codes not 3 ASCII letters → `INVALID_CURRENCY`
(input is upper-case normalized); `fromCcy == toCcy` → `SAME_CURRENCY`;
either mid `<= 0` → `INVALID_MID`.

### `GET /healthz`

`{ "status": "healthy", "service": "rust-rate-governance", "version", "timestamp" }`.
No dependency probes — this service has no dependencies to probe (the sibling
`rust-tigerbeetle-bridge` probes Postgres/TigerBeetle; there is nothing
equivalent here).

### `GET /metrics`

Prometheus exposition (`rate_governance_requests_total`,
`rate_governance_errors_total`, process collectors).

## Errors

Typed JSON, sibling-compatible HTTP statuses:

```json
{ "error": { "code": "INVALID_REFERENCE", "message": "reference must be a positive integer — zero/negative reference rejected" } }
```

400 on all invalid input (including malformed/fractional JSON bodies as
`MALFORMED_BODY`); 500 `INTERNAL_ERROR` for any unexpected internal failure
(this deterministic service has no fallible internals, so 500 is reachable
only through isolated handler panics).

## Trace-id passthrough

Sibling convention (`rust-tigerbeetle-bridge`): the W3C `traceparent` header
is honored — its trace id is attached to the request log span and echoed back
as the `x-trace-id` response header. An explicit `x-trace-id` request header
is passed through as fallback. Deliberate deviation from the sibling: no OTLP
exporter stack (opentelemetry/reqwest) — this is a leaf pure-compute service
with no outbound spans to correlate, so trace ids are propagated and echoed
via headers instead of exported spans.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `PORT` / `RATE_GOVERNANCE_PORT` | `8310` | listen port |
| `RUST_LOG` | `info,rate_governance=info` | tracing filter |

## Build, test, run

```bash
cargo check && cargo clippy && cargo test
docker build -t remitflow/rust-rate-governance .
```

Dependencies are copied verbatim (crate + version) from
`services/rust-tigerbeetle-bridge/Cargo.toml` per SPEC-bdc §0.2; only the
crates this service needs are kept (see Cargo.toml header comment).
