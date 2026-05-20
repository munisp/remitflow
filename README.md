# RemitFlow — Cross-Border Remittance Platform

RemitFlow is a production-grade, multi-corridor remittance and financial services platform built for the African diaspora. It provides real-time FX, multi-rail payment processing, CBN-compliant KYC/AML, diaspora bonds, payroll, and invoice financing in a single unified platform.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  React 19 + Tailwind 4 + tRPC 11 (TypeScript end-to-end)           │
├─────────────────────────────────────────────────────────────────────┤
│  Express 4 + tRPC Server + Manus OAuth + Drizzle ORM (PostgreSQL)  │
├──────────────┬──────────────┬──────────────┬────────────────────────┤
│  Go Services │ Rust Services│ Python Svcs  │ Node.js Microservices  │
│  BDC Gateway │ AML Engine   │ Compliance   │ Temporal Workflows     │
│  FX Router   │ BMATCH Engine│ Sanctions    │ Kafka Event Bus        │
│  Mojaloop    │              │ ML Fraud     │ TigerBeetle Ledger     │
└──────────────┴──────────────┴──────────────┴────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Tailwind CSS 4, shadcn/ui, tRPC client |
| Backend | Node.js 22, Express 4, tRPC 11, Drizzle ORM |
| Database | PostgreSQL (TiDB-compatible), Drizzle migrations |
| Auth | Manus OAuth 2.0 + TOTP 2FA + Keycloak OIDC |
| Payments | Stripe, PayPal, Flutterwave, Mojaloop FSPIOP |
| KYC/AML | Onfido, Sumsub, Veriff + in-house AML engine (Rust) |
| Microservices | Go (BDC, FX), Rust (AML, BMATCH), Python (Compliance, ML) |
| Observability | Pino structured logs, Prometheus metrics, Grafana dashboards |
| Messaging | Apache Kafka (event sourcing, audit stream) |
| Ledger | TigerBeetle (double-entry, ACID financial ledger) |

---

## Quick Start

### Prerequisites

- Node.js 22+, pnpm 9+
- PostgreSQL 15+ (or TiDB)
- Rust 1.78+ (for AML/BMATCH microservices)
- Go 1.22+ (for BDC/FX microservices)
- Python 3.11+ (for compliance/ML microservices)

### Development Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables (copy and fill in)
cp .env.example .env

# 3. Push database schema
pnpm db:push

# 4. Start the development server
pnpm dev
```

The app will be available at `http://localhost:3000`.

### Environment Variables

See `.env.example` for the full list. Critical variables (server will not start without these in production):

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Session cookie signing secret (min 32 chars) |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend URL |
| `BUILT_IN_FORGE_API_KEY` | Manus built-in API bearer token |
| `BUILT_IN_FORGE_API_URL` | Manus built-in API base URL |

---

## Build Loop

1. **Schema changes** → edit `drizzle/schema.ts` → run `pnpm db:push`
2. **DB queries** → add helpers in `server/db.ts`
3. **API procedures** → add/edit in `server/routers.ts` (or `server/routers/*.ts`)
4. **Frontend** → build pages in `client/src/pages/`, wire via `trpc.*` hooks
5. **Tests** → write/update Vitest specs in `server/*.test.ts` → run `pnpm test`

---

## Key Features

### Payments & Transfers
- Multi-corridor transfers: NGN/GBP/USD/EUR/CAD/AUD with live FX rates
- Payment rails: Stripe, PayPal, Flutterwave, Mojaloop FSPIOP, SWIFT, SEPA
- Scheduled transfers, recurring payments, batch disbursements
- TigerBeetle double-entry ledger for ACID financial integrity

### KYC / AML Compliance
- 4-tier KYC architecture (Basic → Enhanced → Full → PEP)
- Providers: Onfido, Sumsub (Sum&Substance), Veriff
- LLM-powered document OCR + biometric liveness check
- Post-approval AML/sanctions screening (OFAC, UN, EU, HMT, CBN, FATF, Interpol)
- Transaction monitoring: 8 alert types, composite risk scoring (0–100)
- SAR/CTR regulatory report generation with LLM-powered narratives
- FATF Travel Rule (Recommendation 16) enforcement ≥ $1,000
- KYB (Know Your Business) for merchants and agents

### Financial Products
- Diaspora bonds (FGN, state, infrastructure)
- Invoice financing (SME trade finance)
- Savings goals with compound interest
- Payroll management (global payroll + disbursement)
- Stablecoin wallet (USDT, USDC)
- Virtual accounts (NGN, GBP, USD)

### Infrastructure
- Temporal workflow orchestration (6-step transfer saga)
- Apache Kafka event bus (audit stream, compliance events)
- Prometheus + Grafana observability stack
- OpenAppSec ML-powered WAF
- PBAC (48 policies, 13 roles)
- Rate limiting: 14 tier-specific limiters

---

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test --coverage

# Run specific test file
pnpm test server/auth.logout.test.ts
```

Current test coverage: **3,836 passing, 2 skipped, 0 failing** (77 test files).

---

## Database Migrations

```bash
# Push schema changes to the database
pnpm db:push

# Generate migration files (for version-controlled migrations)
pnpm db:generate

# View current schema
pnpm db:studio
```

---

## Deployment

1. Create a checkpoint in the Manus Management UI
2. Click **Publish** in the Management UI header
3. Bind a custom domain under **Settings → Domains**
4. Configure production secrets under **Settings → Secrets**

For self-hosted deployment, see `docker-compose.prod.yml` and `k8s/` manifests.

---

## Security

- OWASP Top 10: 10/10 controls passing (see `/api/security/score`)
- PCI-DSS SAQ-A compliant (card data never touches our servers)
- GDPR Article 17 erasure requests implemented
- CBN AML/KYC framework compliant
- All financial mutations wrapped in database transactions
- Atomic SQL for wallet balance operations (no race conditions)

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Write tests for your changes
4. Ensure `pnpm test` passes with 0 failures
5. Submit a pull request

---

## License

Proprietary — All rights reserved. © 2026 RemitFlow Technologies Ltd.
