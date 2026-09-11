# go-investment-feed — NGX Market-Data Bridge

Minimal, **fail-closed** market-data service for Nigerian Exchange (NGX) equity
prices. Stdlib only — zero third-party dependencies.

An ops cron (or the platform scheduler) calls `POST /refresh`; the service
fetches the upstream NGX feed, strictly validates every entry, and forwards the
validated batch to the RemitFlow TS core ingest endpoint. It never writes to the
database itself and **never pretends success**: any fetch, validation, or ingest
failure is surfaced as a non-2xx response with counts.

## Endpoints

| Method | Path       | Auth           | Purpose                                    |
|--------|------------|----------------|--------------------------------------------|
| GET    | `/health`  | none           | Liveness probe                             |
| POST   | `/refresh` | `X-Internal-Key` | Fetch → validate → forward to ingest     |
| GET    | `/metrics` | none           | Prometheus-style counters (no secrets)     |

## Environment variables

| Variable               | Required | Description                                                        |
|------------------------|----------|--------------------------------------------------------------------|
| `INTERNAL_SERVICE_KEY` | **YES**  | Shared internal credential. Auth comparison is `subtle.ConstantTimeCompare`. **Boot fails (`log.Fatal`) if unset** — no well-known default. |
| `NGX_FEED_URL`         | **YES**  | Upstream feed URL returning the JSON array below. Fetched with a 10s-timeout client. **Boot fails if unset.** |
| `INGEST_URL`           | **YES**  | TS core ingest endpoint (e.g. `https://api…/api/trpc/investment.ingestPrices`). Validated batch is POSTed here with the `X-Internal-Key` header, 15s timeout. **Boot fails if unset.** |
| `PORT`                 | no       | Listen port. Default `8080`.                                       |

## JSON contract

Upstream feed must return a JSON array:

```json
[
  {
    "ticker": "DANGCEM",
    "price_ngn": 550.5,
    "previous_close_ngn": 545.0,
    "change_percent": 1.01,
    "market_cap_ngn": 9200000000000
  }
]
```

Validation (applied to **every** entry; one bad entry rejects the whole batch):

- `ticker` matches `^[A-Z0-9.]{1,20}$`
- `price_ngn` finite and `> 0`
- `previous_close_ngn` finite and `>= 0`
- `change_percent` finite and within `[-100, 10000]`
- `market_cap_ngn` finite and `>= 0`
- batch size: 1–5000 entries; body ≤ 10 MiB

The validated array is forwarded **unchanged** to `INGEST_URL`.

## Response contract (`POST /refresh`)

Structured JSON: `{ "updated": N, "rejected": M, "errors": [...] }`

| Status | Meaning                                                              |
|--------|----------------------------------------------------------------------|
| 200    | Ingest endpoint accepted the batch; `updated` = entry count          |
| 401    | Missing/wrong `X-Internal-Key`                                       |
| 422    | Validation failed — **whole batch rejected**, `rejected` = batch size, `errors` lists per-entry reasons (capped at 50) |
| 502    | Feed fetch/decode failed, or ingest returned non-2xx — prices **NOT** updated |
| 500    | Internal marshal error                                               |

## Fail-closed behavior

- Refuses to boot without all three required env vars.
- Never defaults the internal key; constant-time comparison.
- Never reports success unless the ingest endpoint returned 2xx.
- Empty feed batches are treated as upstream failure (silence ≠ success).

## Ops flow

```
cron ──POST /refresh (X-Internal-Key)──▶ go-investment-feed
        │                                   │ GET NGX_FEED_URL (10s timeout)
        │                                   │ validate every entry
        │                                   ▼
        └──── {updated, rejected, errors} ◀─ POST INGEST_URL (X-Internal-Key, 15s timeout)
                                            (TS core UPSERTs ngx_stocks, sets lastUpdated=now)
```

## Example

```bash
curl -s -X POST http://localhost:8080/refresh \
  -H "X-Internal-Key: $INTERNAL_SERVICE_KEY"
# {"updated":187,"rejected":0,"errors":[]}

curl -s http://localhost:8080/health
# {"service":"go-investment-feed","status":"ok","uptime_seconds":42,"version":"v1"}

curl -s http://localhost:8080/metrics
# go_investment_feed_refresh_total 12
# go_investment_feed_refresh_success_total 11
# ...
```

## Development

```bash
go build ./...     # Go 1.22+, stdlib only
go test ./...
docker build -t remitflow/go-investment-feed .
```

The runtime image is `gcr.io/distroless/static-debian12:nonroot` (no shell);
probe `GET /health` from the orchestrator for liveness.
