---
name: testing-remitflow-e2e
description: End-to-end testing of the RemitFlow platform. Use when verifying tRPC endpoints, middleware integrations, polyglot services, mobile apps, or database migrations.
---

# Testing RemitFlow E2E

## Prerequisites
- PostgreSQL running at localhost:5432 (credentials: remitflow:remitflow123, database: remitflow)
- Node.js 20+ with npm

## Dev Server Setup
```bash
cd /home/ubuntu/remitflow/remitflow
PORT=3001 npm run dev &
# Wait ~15s for server to start
# Verify: curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
```

Port 3000 may be occupied — always use PORT=3001.

## Authentication
The dev-login endpoint creates a session without Keycloak:
```bash
curl -s -c /tmp/cookies.txt -L http://localhost:3001/api/dev-login --max-time 30
```
- Cookie name is `app_session_id` (NOT `connect.sid`)
- Also sets `csrf_token` cookie
- May take 10-20s on first call (DB upsert + seed)
- To promote user to admin: `PGPASSWORD=remitflow123 psql -h localhost -U remitflow -d remitflow -c "UPDATE users SET role = 'admin' WHERE \"openId\" = 'dev-user-001';"`

## Key Testing Commands
```bash
# TypeScript check
npx tsc --noEmit

# Unit tests
npx vitest run

# Public endpoints (no auth needed)
curl -s "http://localhost:3001/api/trpc/futureProofing.iso20022.validateLEI?input=%7B%22json%22%3A%7B%22lei%22%3A%22529900T8BM49AURSDO55%22%7D%7D"

# Protected endpoints (auth cookie needed)
curl -s -b /tmp/cookies.txt -X POST "http://localhost:3001/api/trpc/futureProofing.iso20022.generatePacs002" \
  -H "Content-Type: application/json" \
  -d '{"json":{"originalMsgId":"MSG-001","originalEndToEndId":"E2E-001","status":"ACCP"}}'
```

## Known Issues
- **Redis-dependent endpoints hang** when Redis is unavailable. `RedisIntegration.connect()` blocks without timeout. Endpoints affected: `parseIntent`, `fxForecasting.forecast`, `middlewareHealth`. Use `--max-time 15` on curl to avoid indefinite hangs.
- **Table name mismatch**: `futureProofing.ts:136` uses `FROM audit_logs` but DB table is `"auditLogs"` (camelCase). This causes `conversationalPayments.history` to return 500.
- **80 unit tests fail** due to external service dependencies (Redis, Kafka, Go/Rust microservices). This is the pre-existing baseline — not a regression.
- **Migration 0057** may not be auto-applied. Run manually: `PGPASSWORD=remitflow123 psql -h localhost -U remitflow -d remitflow -f drizzle/migrations/0057_future_proofing_tables.sql`

## tRPC Endpoint Types
- **Public** (no auth): `validateLEI`, `validateStructuredAddress`
- **Protected** (auth cookie): `generatePacs002`, `getAccounts`, `submitDSAR`, `forecast`, `parseIntent`
- **Admin** (admin role): `middlewareHealth`, `eventSourcingStats`

## DB Verification
```bash
PGPASSWORD=remitflow123 psql -h localhost -U remitflow -d remitflow -c "SELECT message_id, status FROM iso20022_messages ORDER BY id DESC LIMIT 3;"
```

## Polyglot Services (Code Verification Only)
Services at `services/go-fednow-gateway/`, `services/rust-pq-crypto/`, `services/python-compliance-engine/` — verify via file inspection (line counts, key function refs). They require Go/Rust/Python toolchains to compile, which may not be available.

## Mobile Apps (Code Verification Only)
- Flutter screens: `mobile/flutter/lib/screens/`
- React Native screens: `mobile/react-native/src/screens/futureProofing/`
- PWA service worker: `client/public/sw.js` (check `FUTURE_PROOFING_API_PATTERNS`)

## Devin Secrets Needed
None — all testing uses the dev-login bypass and local PostgreSQL with hardcoded credentials in `.env`.
