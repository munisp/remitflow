# go-vault-inventory

Denomination-level vault/drawer/CIT stock RPCs for branch gateways in the BDC
platform (SPEC-bdc §4.3). The TS `bdc.vault` router remains the primary owner
of vault workflows; this service exposes lean stock read/adjust RPCs backed by
`bdc_denomination_inventory` (`drizzle/0089_bdc_platform.sql`).

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Liveness + DB reachability |
| GET | `/vault/stock/{tenantId}/{locationType}/{locationId}` | Denomination rows + per-currency totals (`denomination × noteCount`) |
| POST | `/vault/stock/adjust` | Version-guarded stocktake correction |

`/vault/*` routes require the `X-Internal-Key` header (see below).

`locationType` ∈ `vault | drawer | cit` (per DDL). `denomination` is the face
value of one note in major units (`numeric(18,2)`, e.g. `100.00` = $100 bill).

### `POST /vault/stock/adjust`

```json
{
  "tenantId": 1, "locationType": "vault", "locationId": 7,
  "currency": "USD", "denomination": 100.00,
  "delta": -25, "expectedVersion": 11
}
```

Guarded update:

```sql
UPDATE bdc_denomination_inventory
SET note_count = note_count + $6, version = version + 1, updated_at = now()
WHERE tenant_id=$1 AND location_type=$2 AND location_id=$3
  AND currency=$4 AND denomination=$5
  AND version=$7               -- optimistic concurrency
  AND note_count + $6 >= 0     -- never drive stock negative
RETURNING note_count, version
```

0 rows (version mismatch, unknown row, or negative resulting count) →
`409 { "error": "CONFLICT", ... }`. Fail closed: no partial writes.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8105` | Listen port |
| `DATABASE_URL` | `postgres://remitflow:remitflow@postgres:5432/remitflow?sslmode=disable` | Postgres DSN |
| `INTERNAL_SERVICE_KEY` | — (required) | Shared internal key; service **panics at startup if unset** (no well-known fallback) |

## Development

```bash
go test ./...
go vet ./...
go build ./...
```
