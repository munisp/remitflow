# Changelog

All notable changes to RemitFlow are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — Wave 3 Enhancements

### Added

**AI-Native Features (Ollama Local Inference)**

The platform now includes three Ollama-powered AI routers. The `aiSupportAgentRouter` provides a multi-turn customer support agent with Redis-backed session memory, tool-augmented reasoning via the ART (Adaptive Reasoning & Tools) framework, automatic escalation detection, sentiment analysis, and multilingual support for EN, FR, PT, SW, HA, YO, and IG. The `aiKycReviewerRouter` uses Ollama vision models (llama3.2-vision, llava) to pre-screen KYC documents, extracting structured data, detecting forgery indicators, and issuing auto-approve/manual-review/auto-reject recommendations. The `aiFxCommentaryRouter` generates real-time corridor-specific FX commentary, rate alert narratives, and weekly FX digests using Mistral.

**Open Banking (PSD2 AISP/PISP)**

The `openBankingPsd2Router` implements full PSD2-compliant account information and payment initiation capabilities. AISP features include consent lifecycle management, account aggregation, balance and transaction retrieval, and an affordability assessment engine for BNPL eligibility. PISP features include payment initiation from linked bank accounts and payment status tracking. Supported standards include UK OBIE v3.1, Berlin Group NextGenPSD2 v1.3, STET v1.4, and Nigeria CBN Open Banking v1.0.

**Financial Product Innovation**

The `financialProductsRouter` adds three major financial products. The BNPL engine computes a composite credit score (0–1000) from KYC tier, transaction frequency, volume, account age, and repayment history, then generates dynamic instalment plans with risk-adjusted interest rates (0–3.5%). The micro-savings module supports round-up savings (nearest $1/$5/$10), recurring auto-save rules (daily/weekly/monthly), and goal-based savings with streak tracking and gamification badges. The investment micro-products catalogue exposes T-Bills, money market funds, and DeFi yield vaults per corridor.

**Platform Hardening**

The `platformHardening` library introduces four resilience patterns. Per-tenant rate limiting uses a Redis sliding window with configurable limits per tenant tier (free/standard/premium/enterprise) and per-endpoint granularity. The `CircuitBreaker` class wraps all 12 external service dependencies with configurable failure thresholds, recovery timeouts, and half-open probe counts, with state persisted to Redis for cross-instance consistency. Feature flags backed by Redis enable instant toggles and gradual rollouts by user ID hash. The bulkhead pattern enforces concurrency limits per operation type with fast-fail load shedding.

**Developer Portal**

The `developerPortalRouter` provides a complete self-service B2B developer experience. Webhook management includes registration, listing, deletion, and a webhook simulator that fires test events with real HMAC-SHA256 signatures to registered endpoints. API key management supports scoped permissions, IP allowlists, test mode, and revocation. The SDK information endpoint documents TypeScript, Python, and Go SDKs. A sandbox transfer simulator enables integration testing without moving real money.

**Mobile UX**

The `BiometricReAuthScreen` provides a FIDO2-grade re-authentication gate for high-value actions in the React Native app. It supports FaceID, TouchID, fingerprint, and iris scan via expo-local-authentication, with a 6-digit PIN fallback, animated feedback, haptic responses, 3-attempt lockout with 30-second cooldown, and full VoiceOver/TalkBack accessibility support. The `pushNotificationRouter` manages Expo push token registration, per-category notification preferences, rich notification templates for all 20 platform events, and admin broadcast capabilities.

**Repository Documentation**

Added `.env.example` with all 80+ environment variables documented across 18 categories. Added `SECURITY.md` with responsible disclosure policy, scope definition, and security hardening measures. Added `CHANGELOG.md` (this file).

---

## [2.0.0] — Wave 2 Enhancements

### Added

**Fraud Orchestration** — Unified `fraudOrchestratorRouter` aggregating GNN, Isolation Forest, and rule-based signals into a composite risk score with configurable action thresholds (allow/review/block).

**Real-Time Streaming** — Restored and enhanced SSE infrastructure with transfer lifecycle events, FX rate alerts, and system health push notifications.

**CBDC & Stablecoin Rails** — `cbdcSettlementRouter` bridging the TypeScript API with Go/Rust engines for dynamic routing across AfriCBDC, USDC/USDT, and fiat rails, including FX forward hedging.

**Multi-Tenancy & White-Label** — `multiTenancyRouter` for B2B BaaS partners with dedicated Keycloak realms, custom branding, granular feature flags, and API key management.

**WebAuthn Passkeys** — FIDO2-compliant `webauthnRouter` for phishing-resistant authentication and dynamic device trust scoring.

**Chaos Engineering** — Chaos Mesh experiments for network latency, pod failures, and resource exhaustion.

**Load Testing** — k6 load test scripts for the transfer API, KYC onboarding flow, and middleware health endpoints.

**Advanced Analytics** — `analyticsDashboardRouter` integrating OpenSearch and PostgreSQL for real-time business intelligence, SLO tracking, and fraud metrics.

**Contract Testing** — vitest contract tests ensuring tRPC API layer conforms to strict input/output schemas and authentication guards.

---

## [1.0.0] — Wave 1 — Initial Middleware Integration

### Added

**Middleware Stack** — Full integration of Kafka, Dapr, Fluvio, Temporal, PostgreSQL, Keycloak, Permify, Redis, Mojaloop, OpenSearch, OpenAppSec, APISIX, TigerBeetle, and Delta Lake Lakehouse.

**Microservices** — 198 microservices across Go, Rust, and Python covering transfer pipeline, KYC orchestration, fraud detection, AML scoring, FX hedging, CBDC settlement, social ledger, agent intelligence, and lakehouse analytics.

**Security Hardening** — Granular RBAC schema, adaptive rate limiting, and secrets management patterns.

**Observability** — OpenTelemetry SDK wiring, SLO tracker, and Prometheus alerting rules.

**Compliance** — Mojaloop ISO 20022 message generator (pacs.008, pacs.002, pacs.004) and TigerBeetle double-entry reconciliation engine.

**Developer Experience** — vitest configuration, unit tests for fee engine, ISO 20022 builder, and SLO tracker. GitHub CODEOWNERS, Dependabot configuration, and PR template.

**Docker Compose** — Complete docker-compose stack including OpenSearch, Permify, OpenAppSec, Dapr, APISIX, and etcd.

---

## [0.1.0] — RemitFlow Baseline

### Added

Initial RemitFlow platform baseline with core transfer, wallet, KYC, and authentication functionality.
