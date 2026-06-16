# Changelog

All notable changes to RemitFlow are documented in this file.

## [2.0.0] - 2026-05-20

### Critical Bug Fixes (P0)
- **Dashboard**: Fixed "undefined NaN" in transaction display — `formatTxn` now includes backward-compatible `amount`/`currency` fields
- **Dashboard**: Replaced hardcoded `monthlyChange: 12.4%` with real calculation `((thisMonthNet - lastMonthNet) / totalNGN) * 100`
- **Dashboard**: Replaced fabricated spend categories (0.18/0.22/0.12/0.08 multipliers) with real database queries per category
- **Dashboard**: Batched 12 sequential chart queries into single GROUP BY query (12 DB calls → 1)
- **Notifications**: Fixed `TypeError: notifs.map is not a function` — API returns `{ notifications: [...] }` not flat array
- **Auth**: Fixed missing `VITE_APP_ID` env var causing session token validation failures

### Security Enhancements
- Added CSP (Content Security Policy) headers via Helmet with strict directives
- Added RBAC enforcement on admin routes (previously any authenticated user could access)
- Added stack trace stripping in production error responses (tRPC + Express)
- Added global Express error handler with production-safe error messages
- 2FA/MFA enforcement for admin roles and sensitive mutations
- API key rotation with SHA256 hashing and 365-day lifecycle
- Brute force protection with progressive exponential backoff
- Webhook signature verification (timing-safe HMAC)

### Performance
- Connection pool auto-tuning based on CPU/memory
- Redis cache layer with graceful fallback
- Request coalescing for duplicate in-flight requests
- ETag/304 support for API responses
- CDN cache headers (static: 1yr, API: no-cache, HTML: 5min)
- Read replica load balancing (round-robin/random/least-connections)
- Table partitioning config (transactions: monthly, audit_logs: monthly, KYC: quarterly)

### Frontend UX
- **Dark mode**: Full dark theme with toggle in header and Settings page
- **Bottom navigation**: 5-tab mobile nav (Home / Wallet / Send FAB / Activity / More)
- **Haptic feedback**: `navigator.vibrate()` on all interactive elements
- **Session timeout**: 60-second warning countdown before auto-logout
- **Biometric auth**: Face ID / fingerprint hook for mobile
- **Offline queue**: Banner showing queued transfers when offline
- **Pull-to-refresh**: Custom hook for list views
- **Safe-area padding**: Support for notched/Dynamic Island devices
- **Reduced motion**: Respects `prefers-reduced-motion` system setting
- **ErrorState component**: Consistent error display across all pages
- **QueryWrapper component**: Reusable loading/error wrapper for pages
- **Fee breakdown**: Detailed transfer fee + FX markup display in send flow
- **Currency formatting**: Locale-aware `Intl.NumberFormat` utility

### Languages
- Added 11 African/Nigerian languages (14 total):
  Yoruba (yo), Igbo (ig), Hausa (ha), Nigerian Pidgin (pcm),
  Swahili (sw), Amharic (am), Twi/Akan (ak), Wolof (wo),
  Fulfulde (ff), Arabic (ar), Portuguese (pt)
- Language switcher redesigned with region grouping and search

### KYC/KYB/AML
- Kafka event consumer for automatic KYC workflow triggers (14 topics)
- BVN/NIN verification microservice (NIBSS/NIMC integration)
- Sanctions batch re-screening (existing customer re-checks)
- goAML STR/SAR/CTR filing integration (NFIU compliance)
- Fail-closed account-opening KYC gate (CBN spec)
- Enhanced KYB: ownership graph, UBO detection (≥25%), shell company scoring
- PEP screening (Dow Jones/World-Check/ComplyAdvantage)
- Adverse media screening and continuous monitoring
- KYC funnel analytics and SLA compliance tracking
- Temporal KYC workflow expanded from 5 to 7 steps

### Microservices
- Circuit breaker pattern (closed → open → half-open) with health probes
- Bulkhead pattern (payments: 50 concurrent, KYC: 20, FX: 100)
- Service discovery registry for all microservices
- Retry policies per service type (KYC: 2 retries, payments: 5, FX: 1)

### Observability
- 6 SLOs (transfer availability 99.95%, P99 <2s, KYC completion 99%)
- 10 Grafana alert rules (transfer failures, KYC down, DB pool exhaustion, etc.)
- PagerDuty + OpsGenie integration
- Error budget tracking with burn rate alerting
- Health check aggregation across 9 service categories

### Payment Rails
- 10-state payment state machine with validated transitions
- Exponential backoff retry with jitter (base 1s, max 60s, 5 attempts)
- Dead Letter Queue with batch processing (50 at a time)
- Settlement reconciliation engine (flags mismatches > $0.01)
- 24-hour idempotency key enforcement (in-memory + DB)
- Auto-expiry (pending: 30min, processing: 120min)

### Database
- Added 11 production tables: payment_dlq, payment_state_transitions,
  idempotency_keys, settlement_reconciliations, continuous_monitoring,
  pep_screening_results, adverse_media_results, api_key_rotations,
  security_events, circuit_breaker_state, slo_metrics

### Documentation
- CONTRIBUTING.md with code style, branch naming, PR process
- CHANGELOG.md (this file)
- README.md updated with architecture diagram and setup guide

## [1.0.0] - 2026-04-15

### Initial Release
- 317 frontend pages with React + TypeScript + Tailwind
- 72 tRPC server routers
- 60+ polyglot microservices (Go, Rust, Python, Node.js)
- PostgreSQL with Drizzle ORM (113 migration files)
- CBN 3-tier KYC compliance system
- Multi-rail payment processing (Stripe, PayPal, Flutterwave, M-Pesa, SWIFT)
- Temporal workflows for KYC orchestration
- Kafka event bus for async processing
- Real-time FX rates and rate locking
- PWA with offline support
