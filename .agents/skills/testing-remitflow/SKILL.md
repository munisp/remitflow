---
name: testing-remitflow
description: End-to-end testing of the RemitFlow platform. Use when verifying tRPC endpoints, middleware integrations, polyglot services, mobile apps, or database migrations.
---

# Testing RemitFlow Platform

## Environment Setup

### Dev Server (TypeScript/tRPC)
```bash
cd /home/ubuntu/remitflow/remitflow
npm run dev  # Starts on port 3001
```
**Known issue:** Dev server requires `OAUTH_SERVER_URL`, `BUILT_IN_FORGE_API_KEY`, `BUILT_IN_FORGE_API_URL` to boot. Without these, it crashes after startup. Workaround: use `npx tsc --noEmit` to verify router wiring + vitest for logic.

### Python Reconciliation Engine (port 8170)
```bash
cd services/python-reconciliation-engine
pip install fastapi pydantic uvicorn  # if not already installed
python3 main.py  # Starts on port 8170
```
Includes insider threat analytics endpoints:
- `POST /insider-threat/collusion/detect`
- `POST /insider-threat/fx/verify`
- `POST /insider-threat/admin-anomaly`
- `POST /insider-threat/canary/check`
- `POST /insider-threat/pgaudit/analyze`
- `GET /insider-threat/metrics`
- `GET /insider-threat/collusion/alerts`
- `GET /insider-threat/fx/history`
- `GET /health`
- `POST /reconcile`

### Go Audit Sink (port 8180)
```bash
cd services/go-audit-sink
go run main.go  # Starts on port 8180
```
Endpoints: `/ingest`, `/query`, `/verify`, `/maker-checker`, `/break-glass`, `/canary-trip`, `/health`, `/metrics`

### Rust Credential Guard (port 8190)
```bash
cd services/rust-credential-guard
cargo run  # Starts on port 8190
```
Endpoints: `/webauthn/challenge`, `/webauthn/register`, `/webauthn/verify`, `/cert/issue`, `/cert/validate`, `/token/issue`, `/token/validate`, `/canary/create`, `/canary/trip`

## Testing Approach

### Shell-Only Testing (No Recording)
This platform's testing is primarily shell-based:
- **TypeScript:** `npx tsc --noEmit` (0 errors = correct wiring)
- **Vitest:** `npx vitest run server/tests/<test-file>.test.ts`
- **Python runtime:** Start service + curl endpoints
- **Go/Rust structure:** grep for key patterns in source files

### Key Test Files
- `server/tests/insiderThreatControls.test.ts` — 37 assertions for 13 insider threat controls
- `server/tests/fundFlowIntegration.test.ts` — Integration tests for atomic fund flows
- `server/tests/chaosTest.test.ts` — Chaos/failure mode tests

### Testing Insider Threat Controls

**FX Rate Verification** — test with rates within AND outside 0.5% threshold:
```bash
# Should pass (0.013% deviation)
curl -X POST http://localhost:8170/insider-threat/fx/verify \
  -H "Content-Type: application/json" \
  -d '{"pair":"USD/NGN","proposed_rate":1538.0,"source_rates":{"ecb":1537.5,"openexchangerates":1538.2,"xe":1537.8,"wise":1538.5}}'

# Should fail (4% deviation)
curl -X POST http://localhost:8170/insider-threat/fx/verify \
  -H "Content-Type: application/json" \
  -d '{"pair":"USD/NGN","proposed_rate":1600.0,"source_rates":{"ecb":1537.5,"openexchangerates":1538.2,"xe":1537.8,"wise":1538.5}}'
```

**Collusion Detection** — test at and below the COLLUSION_MIN_TRANSACTIONS=5 boundary:
```bash
# 6 txs from same pair → should flag (circular_approval)
curl -X POST http://localhost:8170/insider-threat/collusion/detect \
  -H "Content-Type: application/json" \
  -d '{"transactions":[{"approved_by":42,"agent_id":99,"amount":9500},{"approved_by":42,"agent_id":99,"amount":8900},{"approved_by":42,"agent_id":99,"amount":9100},{"approved_by":42,"agent_id":99,"amount":7800},{"approved_by":42,"agent_id":99,"amount":9999},{"approved_by":42,"agent_id":99,"amount":8500}]}'

# 3 txs → should NOT flag (below minimum)
curl -X POST http://localhost:8170/insider-threat/collusion/detect \
  -H "Content-Type: application/json" \
  -d '{"transactions":[{"approved_by":10,"agent_id":20,"amount":9500},{"approved_by":10,"agent_id":20,"amount":8900},{"approved_by":10,"agent_id":20,"amount":9100}]}'
```

**Canary Tokens** — test with honey_* prefix records vs normal:
```bash
# Should trip (honey_ prefix)
curl -X POST http://localhost:8170/insider-threat/canary/check \
  -H "Content-Type: application/json" \
  -d '{"table":"users","record_ids":["1","2","honey_secret_user","5"]}'

# Should NOT trip (normal records)
curl -X POST http://localhost:8170/insider-threat/canary/check \
  -H "Content-Type: application/json" \
  -d '{"table":"users","record_ids":["1","2","3","4"]}'
```

**Admin Anomaly** — test with high vs normal frequency:
```bash
# Should flag (25/hr >> baseline ~4)
curl -X POST http://localhost:8170/insider-threat/admin-anomaly \
  -H "Content-Type: application/json" \
  -d '{"user_id":42,"action":"bulk_export","current_hour_count":25}'

# Should NOT flag (2/hr < baseline)
curl -X POST http://localhost:8170/insider-threat/admin-anomaly \
  -H "Content-Type: application/json" \
  -d '{"user_id":42,"action":"bulk_export","current_hour_count":2}'
```

## Key Thresholds to Test Against

| Control | Threshold | Variable |
|---------|-----------|----------|
| FX deviation | 0.5% (0.005) | `FX_RATE_DEVIATION_THRESHOLD` |
| Collusion min txs | 5 | `COLLUSION_MIN_TRANSACTIONS` |
| Admin anomaly z-score | 3.0 | `ADMIN_ANOMALY_THRESHOLD` |
| Maker-checker transfer reversal | $10,000 | `MAKER_CHECKER_THRESHOLDS.transfer_reversal` |
| JIT max duration | 2 hours | `JIT_MAX_DURATION_HOURS` |
| JIT max grants/day | 3 | `JIT_MAX_GRANTS_PER_DAY` |
| DLP max records/query | 100 | `DLP_MAX_RECORDS_PER_QUERY` |
| DLP max queries/hour | 50 | `DLP_MAX_QUERIES_PER_HOUR` |
| Delayed reversal threshold | $10,000 | 4-hour cooling period |
| Allowed countries | CA, NG, US, GB, KE, GH, ZA | Geo-fence |
| Business hours | 6 AM - 10 PM UTC, Mon-Fri | Time-fence |

## Devin Secrets Needed
- `OAUTH_SERVER_URL` — Required for dev server to boot
- `BUILT_IN_FORGE_API_KEY` — Required for dev server to boot
- `BUILT_IN_FORGE_API_URL` — Required for dev server to boot

## Tips
- The Python service is the easiest to test at runtime (no auth required, starts quickly)
- Go and Rust services need their toolchains installed to compile and run
- For tRPC route testing, vitest is more reliable than trying to boot the dev server without env vars
- Always test BOTH positive (should detect) AND negative (should not detect) cases to catch inverted logic
- Metrics endpoint (`GET /insider-threat/metrics`) aggregates all detection events — useful as a smoke test
