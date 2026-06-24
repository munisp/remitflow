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

### Python Platform Hardening Service (port 8270)
```bash
cd services/python-platform-hardening
pip install fastapi pydantic uvicorn numpy  # if not already installed
python3 main.py  # Starts on port 8270
```
Key endpoints:
- `POST /v1/biometric/profile` — Create behavioral biometrics profile (fields: `typing_speed`, `touch_pressure`, `scroll_pattern`, `device_handling`)
- `POST /v1/biometric/compare` — Compare current vs stored profile (returns `match`, `confidence`, `anomalies`, `recommendation`)
- `POST /v1/admin/anomaly` — Admin anomaly detection (fields: `admin_id`, `action_type`, `actions_count`, `time_window_hours`, `baseline_entries`)
- `POST /v1/canary/check` — Canary token trip detection (field: `record_ids` — check against CANARY_RECORDS list)
- `POST /v1/liquidity/predict` — Liquidity forecast (fields: `corridor`, `target_date`)
- `GET /fx/rate/{base}/{quote}` — FX rate
- `GET /stablecoin/price/{symbol}` — Stablecoin price
- `GET /health`

**IMPORTANT:** Python service uses **snake_case** field names (`typing_speed`, `touch_pressure`, `scroll_pattern`, `device_handling`), NOT camelCase. Canary records use IDs like `honey_user_001`, `honey_wallet_001`, `honey_tx_001` (defined in `CANARY_RECORDS` list in main.py).

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

### Go Kafka Service (port 8250)
```bash
cd services/go-kafka-service/cmd
go run main.go  # Starts on port 8250
```
**Note:** No standalone `go.mod` — verify structurally via grep, not compilation.

### Go Audit Sink (port 8180)
```bash
cd services/go-audit-sink
go run main.go  # Starts on port 8180
```
Endpoints: `/ingest`, `/query`, `/verify`, `/maker-checker`, `/break-glass`, `/canary-trip`, `/health`, `/metrics`

### Rust Bridge Verifier (port 8260)
```bash
cd services/rust-bridge-verifier
cargo run  # Starts on port 8260
```

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

## Adversarial Testing Patterns

When testing gap fixes or new features, write adversarial tests that distinguish working from broken implementations. Key patterns:

### Fail-Closed Guards
Test that production mode throws (not returns mock) when API keys are missing:
```typescript
process.env.NODE_ENV = "production";
delete process.env.MARQETA_APP_TOKEN;
await expect(issueVirtualCard(1, "USDC", 100)).rejects.toThrow("FAIL-CLOSED");
process.env.NODE_ENV = original; // restore
```
Apply to: virtual cards (Marqeta), insurance (Nexus Mutual/InsurAce), bridge (LI.FI), FX rates.

### Ed25519 Signature Verification
Test tamper detection — not just that signatures exist:
```typescript
const vc = issueVerifiableCredential(1, "tier3", ["passport"], ["NG"]);
expect(verifyVerifiableCredential(vc)).toBe(true);
vc.credentialSubject.kycTier = "tier1_TAMPERED";
expect(verifyVerifiableCredential(vc)).toBe(false);
```

### SQL Pattern Verification
For fencing tokens, PostgreSQL triggers, etc. — verify the SQL string contains the guard:
```typescript
const sql = buildFencedUpdateSQL(1, 100, "debit", "abc123");
expect(sql).toContain("fencing_token");
expect(sql).toContain("<=");
```

### Python Admin Anomaly Cold-Start
The admin anomaly endpoint needs `baseline_entries` to compute z-scores. Seed with ~5 normal entries before testing spike detection:
```json
{
  "admin_id": "admin_42",
  "action_type": "bulk_export",
  "actions_count": 50,
  "time_window_hours": 1,
  "baseline_entries": [
    {"count": 5, "hour": "2026-05-20T10:00:00Z"},
    {"count": 4, "hour": "2026-05-20T11:00:00Z"},
    {"count": 6, "hour": "2026-05-20T12:00:00Z"},
    {"count": 3, "hour": "2026-05-20T13:00:00Z"},
    {"count": 5, "hour": "2026-05-20T14:00:00Z"}
  ]
}
```

### Verifying Function Exports Before Writing Tests
Always grep for actual export names before writing import statements. Function names may differ from what you expect:
```bash
grep "export function\|export async function\|export const" server/_core/kycHardening.ts
```

### Key Test Files
- `server/tests/platform-hardening.test.ts` — 99 assertions for all 44 recommendations
- `server/tests/audit-gap-adversarial.test.ts` — 64 adversarial assertions for 19 gap fixes
- `server/tests/insiderThreatControls.test.ts` — 37 assertions for 13 insider threat controls
- `server/tests/fundFlowIntegration.test.ts` — Integration tests for atomic fund flows

### Key Core Modules
- `server/_core/fundFlowHardening.ts` — Transaction coordinator, fencing tokens, PostgreSQL LISTEN/NOTIFY
- `server/_core/stablecoinHardening.ts` — Virtual cards, DCA, auto-convert, insurance, bridge, yield, FX
- `server/_core/kycHardening.ts` — Video KYC, Ed25519 VCs, biometrics, UBO analysis
- `server/middleware/insiderThreat.ts` — Maker-checker, JIT access, geo-fencing, DLP, WebAuthn, canary tokens

## Key Thresholds to Test Against

| Control | Threshold | Variable |
|---------|-----------|----------|
| FX deviation | 0.5% (0.005) | `FX_RATE_DEVIATION_THRESHOLD` |
| Collusion min txs | 5 | `COLLUSION_MIN_TRANSACTIONS` |
| Admin anomaly z-score | 3.0 | `ADMIN_ANOMALY_THRESHOLD` |
| Maker-checker transfer reversal | $10,000 | `MAKER_CHECKER_THRESHOLDS.transfer_reversal` |
| Maker-checker 2 approvers | $100,000 | Amount >= $100K needs 2 approvers |
| JIT max duration | 2 hours | `JIT_MAX_DURATION_HOURS` |
| JIT max grants/day | 3 | `JIT_MAX_GRANTS_PER_DAY` |
| DLP max records/query | 100 | `DLP_MAX_RECORDS_PER_QUERY` |
| DLP max queries/hour | 50 | `DLP_MAX_QUERIES_PER_HOUR` |
| Delayed reversal threshold | $10,000 | 4-hour cooling period |
| Allowed countries | CA, NG, US, GB, KE, GH, ZA | Geo-fence |
| Business hours | 6 AM - 10 PM UTC, Mon-Fri | Time-fence |
| De-peg warning | 0.5%-2% deviation | `evaluateDePeg()` |
| De-peg critical | 2%-5% deviation | `evaluateDePeg()` |
| De-peg emergency | >5% deviation | `evaluateDePeg()` |
| UBO threshold | 25% ownership | `analyzeOwnershipGraph()` |

## Devin Secrets Needed
- `OAUTH_SERVER_URL` — Required for dev server to boot
- `BUILT_IN_FORGE_API_KEY` — Required for dev server to boot
- `BUILT_IN_FORGE_API_URL` — Required for dev server to boot

## Tips
- The Python platform-hardening service (port 8270) is the easiest to test at runtime (no auth required, starts quickly, has biometrics/anomaly/canary/liquidity endpoints)
- The Python reconciliation engine (port 8170) has insider threat analytics (collusion, FX verification, admin anomaly)
- Go and Rust services may not have standalone `go.mod` — verify structurally via grep, not compilation
- For tRPC route testing, vitest is more reliable than trying to boot the dev server without env vars
- Always test BOTH positive (should detect) AND negative (should not detect) cases to catch inverted logic
- When writing adversarial tests, read the actual implementation first to get correct function names, field names, and return types — don't assume
- Python services use snake_case fields; TypeScript uses camelCase — mismatches are a common test failure source
- For Kafka topic parity checks, grep all three services (Go/Python/TypeScript) for the same topic strings
- Structural verification (grep for SQL patterns, API references) is useful when live middleware isn't available
- Base branch has 13 pre-existing test failures (fund-flow-safety, agent-cash-pickup, smoke) — these are NOT regressions
