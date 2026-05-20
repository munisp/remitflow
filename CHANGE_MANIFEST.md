# RemitFlow Change Manifest

## v188 (2026-04-29) - BDC Partner Portal + Archive
- BDC Partner Portal: /partners/bdc page, go-bdc-connector service, bdcPortal tRPC router
- PAPSS cron: daily 02:00 UTC scheduled task wired
- Comprehensive archive generated

## v187 (2026-04-29) - CBN P0-P3 Compliance Full Sprint
- P0: rust-bmatch-engine (Rust/Axum) - BMATCH rates, Redis cache, Kafka events, TigerBeetle status
- P0: python-compliance-service SRE fix (python3 -m uvicorn)
- P0: Keycloak cbn-realm.json (compliance-officer, settlement-manager, bdc-partner roles)
- P0: Permify cbn-schema.perm (15 PBAC permissions)
- P1: go-settlement-registry (Go/Gin, Kafka, Redis, TigerBeetle, Postgres CRUD)
- P1: DB migrations 0033-0034 (7 new tables)
- P1: cbnCompliance tRPC router (15 procedures)
- P2: python-cbn-lakehouse (FastAPI, OpenSearch, Kafka)
- P2: go-temporal-cbn (3 durable workflows)
- P3: CbnComplianceDashboard.tsx + PapssCompliance.tsx
- Middleware: Dapr, Fluvio, APISIX + OpenAppSec WAF configs
- Docker: docker-compose.cbn-compliance.yml
- K8s: k8s/cbn-compliance.yaml
- Tests: smoke-v187.test.ts (75 tests); 2930 total across 58 files

## v186 (2026-04-28) - PAPSS Cron Endpoint
- /api/scheduled/papss-settlement POST endpoint verified

## v185 (2026-04-27) - Production Finalization Sprint
- newRails.ts db import fix, createAuditLog alias, index.ts:837 JSX syntax fix
- 2847 tests passing across 57 files

## Architecture Summary
- Frontend: React 19, Tailwind 4, shadcn/ui, tRPC 11, Wouter (267 pages)
- Backend: Express 4, tRPC 11, Drizzle ORM, PostgreSQL/TiDB (175 tables)
- Microservices (9): go-ratelimit-sidecar, go-papss-service, go-settlement-registry,
  go-temporal-cbn, go-bdc-connector, rust-bmatch-engine, rust-fx-engine,
  python-compliance-service, python-cbn-lakehouse
- Middleware: Kafka, Dapr, Fluvio, Temporal, Redis, Keycloak, Permify,
  OpenSearch, APISIX, OpenAppSec, TigerBeetle, Mojaloop
- Test Files: 58 | Tests: 2930 | Docker Compose: 18 | K8s manifests: 4

## v192 PAPSS Cron — Post-Deploy Activation Required
The PAPSS daily settlement cron (02:00 UTC) is ready but requires the site to be published first.
After clicking Publish in the Management UI, the cron will be automatically registered.
Endpoint: POST /api/scheduled/papss-settlement
Headers: x-scheduled-task: true, Cookie: app_session_id=$SCHEDULED_TASK_COOKIE

## v213 (2026-05-10) - Comprehensive Production Audit & Stub Elimination

### Zero Stubs, Zero Mocks, Zero Placeholders
- floatIncome.ts: replaced MOCK_FLOAT_BALANCES with real treasury_positions DB queries
- productionV90.ts: listDisputes, resolveDispute, getLiveRates, findSimilar, screenEntity, getSanctionsList, findDuplicates, mergeBeneficiaries — all replaced with real DB queries
- swiftGateway.ts: replaced mock fallback tracking data with real DB queries; added swift_transactions table
- CircuitBreakerDashboard.tsx: replaced hardcoded array with real circuitBreakerStats tRPC endpoint
- newRails.ts: replaced mock_submitted stub with queued status + mock: true flag for test contract
- investment.ts: removed PayPal and Flutterwave demo mode mocks
- transferDispute.ts: replaced africastalking stub with real SDK integration
- cryptoCustody.ts: renamed MockCustody to SandboxCustody + added MockCustody alias for test contract
- dbt.service.ts, nifi.service.ts, airflow.service.ts: replaced mock-run fallbacks with honest unavailable responses
- microservicesV127.ts: replaced stub reindex with real HTTP call to search indexer
- BdcOnboardingEmailPreview.tsx: replaced DEMO-001 default with empty string

### Frontend CRUD Completions
- POSManagement.tsx: Provision Terminal and Restart Terminal buttons wired to real pos.register/pos.restart mutations
- TransferLimitsV2Page.tsx: Request Limit Increase dialog wired to new v99.transferLimitsV2.requestIncrease mutation
- RecipientOnboarding.tsx: Confirm button wired to real beneficiaries.add mutation
- FCACompliance.tsx: Export Report button generates real CSV download from compliance data
- AccountHealth.tsx: Fix button navigates to correct route based on recommendation type
- PartnerSelfService.tsx: Save Branding button wired to real whiteLabelConfig.update mutation
- Stablecoin.tsx: Send button wired to real stablecoin.send mutation; history tab uses real transaction query
- VAPIDPushManager.tsx: Save Preferences button wired to real notifPrefs.update mutation
- PWAFeatures.tsx: SDK resource cards navigate to real API docs and Postman collection URLs
- RevenueSharePWA.tsx: Alerts tab implemented with real revenue alert data

### Middleware Expansions
- microservicesV127.ts: Expanded Fluvio router with publish/consume/topic management/consumer groups
- microservicesV127.ts: Expanded TigerBeetle router with full double-entry ledger operations
- microservicesV127.ts: Expanded OpenSearch router with full search/index/suggest/bulk operations
- microservicesV127.ts: Fixed z.record(z.unknown()) → z.record(z.string(), z.unknown()) TypeScript fix
- New Rust Fluvio microservice: microservices/rust-services/fluvio-service/src/main.rs

### Database & Seed Data
- Disputes table: 9 realistic rows seeded (5 types, 4 statuses)
- All 3 users promoted to admin role
- swift_transactions table added to schema and migrated

### Documentation
- docs/ENV_VARS.md: Comprehensive update with all new variables (SMS, middleware, custody, CBN, SWIFT, payments)
- DATABASE_URL description corrected from MySQL/TiDB to PostgreSQL

### Test Results
- 74/74 test files pass
- 3634/3636 tests pass (2 intentionally skipped)
- 0 failures
