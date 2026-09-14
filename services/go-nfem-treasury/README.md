# go-nfem-treasury

NFEM weekly FX purchase lifecycle support + CBN FXBT adapter for the BDC
platform (SPEC-bdc §4.2). Part of the RemitFlow monorepo.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Liveness + DB reachability |
| POST | `/nfem/fxbt/request` | Submit an FX purchase request to the FXBT adapter |
| GET | `/nfem/entitlement/{tenantId}?bankCode=` | Read-only mirror of `bdc_nfem_entitlements` (+ recent `bdc_nfem_purchase_batches`), with `remainingUsd` headroom |
| POST | `/nfem/liquidate` | Record a liquidation/return instruction for a `selling` batch (guarded single-winner update) |

`/nfem/*` routes require the `X-Internal-Key` header (see below).

### `POST /nfem/fxbt/request`

```json
{ "tenantId": 1, "bankCode": "GTB", "amountUsd": 50000.00, "rate": 1530.50 }
```

Money fields are major units, matching the `numeric(18,2)` columns in
`drizzle/0089_bdc_platform.sql` (no minor-unit suffixes).

## Honest adapter modes (SPEC-bdc §0.4)

This service **never fabricates a real market purchase**.

- `FXBT_MODE=sandbox` (default): no external call is made. The response carries
  explicit simulation markers:
  `{ "simulated": true, "fxbtReference": "SIM-FXBT-<uuid>", ... }`.
- `FXBT_MODE=production` **without** `FXBT_BASE_URL` + `FXBT_CLIENT_ID` +
  `FXBT_CLIENT_SECRET`: fails closed —
  `503 { "error": "UNAVAILABLE", "reason": "credentials not configured" }`.
- `FXBT_MODE=production` with credentials: performs a real POST to
  `FXBT_BASE_URL/fxbt/requests` (10s timeout). Upstream rejection propagates;
  no success is ever synthesized.

### `POST /nfem/liquidate`

```json
{ "batchId": 123, "mode": "market" }   // or "return"
```

Validates the batch exists and is `selling` (24h NFEM liquidation window),
then records the operator-attested instruction with a guarded single-winner
update (`UPDATE ... WHERE id=$1 AND status='selling'`; 0 rows → 409 CONFLICT).
The response is an **instruction payload** (`SELL_TO_PUBLIC` /
`RETURN_TO_BANK`); the service performs no market or bank-side execution
(`externalExecution: "operator_attested"`).

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8103` | Listen port |
| `DATABASE_URL` | `postgres://remitflow:remitflow@postgres:5432/remitflow?sslmode=disable` | Postgres DSN |
| `INTERNAL_SERVICE_KEY` | — (required) | Shared internal key; service **panics at startup if unset** (no well-known fallback) |
| `FXBT_MODE` | `sandbox` | `sandbox` or `production` |
| `FXBT_BASE_URL` | — | FXBT endpoint base (production) |
| `FXBT_CLIENT_ID` / `FXBT_CLIENT_SECRET` | — | FXBT credentials (production) |

## Development

```bash
go test ./...
go vet ./...
go build ./...
```
