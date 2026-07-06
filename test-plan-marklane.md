# Mark Lane Integration — Test Plan

## What Changed
PR #4 adds a full Mark Lane (Canadian MSB) integration to RemitFlow:
- TypeScript: `markLaneClient.ts` (API client with circuit breaker), `markLaneRouter.ts` (18 tRPC endpoints), wired into `AppRouter` as `markLane.*`
- Go service (port 8128): Composite FX quote engine
- Rust service (port 8129): KYC/compliance bridge
- Python service (port 8130): Settlement reconciliation
- 5 new PostgreSQL tables, 10 Kafka events, TigerBeetle ledger entries
- 31 integration tests

## Testing Approach
Shell-only (no UI changes). No recording needed.

1. **TypeScript compilation** — proves all types match across router, client, and featurePersistence
2. **Unit tests** — 31 Mark Lane scenario tests exercising client mock path + router logic
3. **Live tRPC endpoint verification** — start dev server, authenticate, hit real endpoints via curl
4. **Polyglot service code verification** — compile Go/Rust, syntax-check Python
5. **Regression** — full vitest run to confirm no breakage

---

## Test Cases

### T1: TypeScript Compilation (0 errors expected)
```bash
npx tsc --noEmit
```
**Pass:** Exit code 0, no output
**Fail:** Any TypeScript error

### T2: Mark Lane Unit Tests (31/31 expected)
```bash
npx vitest run server/integrations/marklane/__tests__/markLane.test.ts
```
**Pass:** "Tests 31 passed (31)" in output
**Fail:** Any test failure or count < 31

### T3: Full Regression Suite
```bash
npx vitest run
```
**Pass:** Only 2 pre-existing `beneficiaries.add` failures (from smoke.test.ts)
**Fail:** Any NEW test failure not in smoke.test.ts

### T4: Dev Server Starts and Serves Mark Lane Router
```bash
PORT=3001 npm run dev &
# Wait 15s
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
```
**Pass:** HTTP 200
**Fail:** Non-200 or connection refused

### T5: Authentication via dev-login
```bash
curl -s -c /tmp/ml-cookies.txt -L http://localhost:3001/api/dev-login --max-time 30
```
**Pass:** Cookie file contains `app_session_id`
**Fail:** No cookie or connection error

### T6: listCorridors — Returns 8 Canadian Corridors
```bash
curl -s -b /tmp/ml-cookies.txt "http://localhost:3001/api/trpc/markLane.listCorridors" --max-time 15
```
**Pass criteria (all must be true):**
- HTTP 200 with JSON response
- `result.data.json.count` == 8
- `result.data.json.corridors[0].id` starts with "CA-"
- Contains "CA-NG", "CA-GH", "CA-KE", "CA-ZA"
- Each corridor has `provider: "marklane"` and `fintracCompliant: true`

**Fail:** Missing corridors, wrong count, or error response

### T7: getCorridorDetails — CA-NG Returns Nigeria Details
```bash
curl -s -b /tmp/ml-cookies.txt \
  'http://localhost:3001/api/trpc/markLane.getCorridorDetails?input=%7B%22json%22%3A%7B%22corridorId%22%3A%22CA-NG%22%7D%7D' \
  --max-time 15
```
**Pass criteria:**
- `toCountry` == "Nigeria"
- `rail` == "NIBSS"
- `compliance.sourceRegulator` == "FINTRAC"
- `compliance.targetRegulator` == "CBN"
- `limits.maxAmount` == 50000
- `fees.flatFee` == 5

**Fail:** Wrong values or error

### T8: getNostroBalances — Returns CAD and USD Balances
```bash
curl -s -b /tmp/ml-cookies.txt "http://localhost:3001/api/trpc/markLane.getNostroBalances" --max-time 15
```
**Pass criteria:**
- Returns array with at least 2 entries
- CAD entry: `available` == 500000, `total` == 550000, `accountId` == "ml-nostro-cad"
- USD entry: `available` == 350000, `total` == 375000
- `provider` == "marklane"

**Fail:** Missing balances, wrong amounts, or error

### T9: getQuote — FX Quote Returns Valid Rate (mutation)
```bash
curl -s -b /tmp/ml-cookies.txt -X POST \
  "http://localhost:3001/api/trpc/markLane.getQuote" \
  -H "Content-Type: application/json" \
  -d '{"json":{"corridorId":"CA-NG","amount":1000,"type":"spot"}}' \
  --max-time 15
```
**Pass criteria:**
- Returns JSON with `quoteId` starting with "mlq-"
- `fromCurrency` == "CAD"
- `rate` == 0.7350 (mock rate)
- `convertedAmount` == 735.0
- `fee` == 5.0
- `provider` == "marklane"
- `type` == "spot"

**Fail:** Missing fields, wrong values, or error

### T10: getLiveRates — Multi-pair Rate Fetch
```bash
curl -s -b /tmp/ml-cookies.txt \
  'http://localhost:3001/api/trpc/markLane.getLiveRates?input=%7B%22json%22%3A%7B%22pairs%22%3A%5B%22CAD%2FUSD%22%2C%22CAD%2FNGN%22%5D%7D%7D' \
  --max-time 15
```
**Pass criteria:**
- Returns rates object with `CAD/USD` and `CAD/NGN` keys
- `CAD/USD.mid` == 0.7350
- `CAD/NGN.mid` == 1100
- `provider` == "marklane"

**Fail:** Missing pairs or wrong values

### T11: getAnalytics — Returns Empty Analytics for New User
```bash
curl -s -b /tmp/ml-cookies.txt \
  'http://localhost:3001/api/trpc/markLane.getAnalytics?input=%7B%22json%22%3A%7B%7D%7D' \
  --max-time 15
```
**Pass criteria:**
- `totalTransfers` == 0
- `successRate` == 0
- `totalVolume` == 0
- `currency` == "CAD"

**Fail:** Non-zero values or error

### T12: Go Service Compilation
```bash
cd services/go-marklane-fx-bridge && go build -o /dev/null . 2>&1
```
**Pass:** Exit code 0
**Fail:** Compilation errors

### T13: Rust Service Compilation
```bash
cd services/rust-kyc-compliance-bridge && rustc --edition 2021 main.rs --crate-type bin -o /dev/null 2>&1 || echo "Checking syntax only"
```
**Pass:** Compiles or only has linking errors (missing crates — acceptable for standalone file check)
**Fail:** Syntax errors

### T14: Python Service Syntax Check
```bash
python3 -m py_compile services/python-settlement-reconciliation/main.py
```
**Pass:** Exit code 0
**Fail:** SyntaxError

### T15: PostgreSQL Tables Created
```bash
PGPASSWORD=remitflow123 psql -h localhost -U remitflow -d remitflow -c "
  SELECT table_name FROM information_schema.tables 
  WHERE table_name LIKE 'feature_marklane%' ORDER BY table_name;"
```
**Pass:** All 5 tables present: `feature_marklane_fx_professionals`, `feature_marklane_kyc_passports`, `feature_marklane_prefunding`, `feature_marklane_quotes`, `feature_marklane_transfers`
**Fail:** Any table missing (note: tables auto-created on first server start — may need server to have run first)

### T16: FeatureEvents Includes Mark Lane Events
```bash
grep -c "markLane" server/_core/featurePersistence.ts
```
**Pass:** At least 10 matches (10 event methods)
**Fail:** < 10

### T17: Router Integration — markLane Wired Into AppRouter
```bash
grep "markLane: markLaneRouter" server/routers.ts
```
**Pass:** Line found
**Fail:** Not found
