# RemitFlow Deployment Guide

## Overview

RemitFlow is a production-grade cross-border remittance platform built on React 19 + Express 4 + tRPC 11 + MySQL. This guide covers all deployment paths.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22+ |
| pnpm | 10+ |
| MySQL | 8.0+ |
| Docker | 24+ (optional) |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all required values before deploying.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | MySQL connection string: `mysql://user:pass@host:3306/remitflow` |
| `JWT_SECRET` | 64-character random string for session signing |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL |
| `OWNER_OPEN_ID` | Owner's Manus Open ID |
| `OWNER_NAME` | Owner's display name |
| `BUILT_IN_FORGE_API_URL` | Manus built-in API URL |
| `BUILT_IN_FORGE_API_KEY` | Manus built-in API bearer token (server-side) |
| `VITE_FRONTEND_FORGE_API_KEY` | Manus built-in API bearer token (frontend) |
| `VITE_FRONTEND_FORGE_API_URL` | Manus built-in API URL (frontend) |

### Optional (but recommended for production)

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend API key for transactional email (get at resend.com) |
| `RESEND_FROM_EMAIL` | Verified sender email (e.g. `noreply@yourdomain.com`) |
| `STRIPE_SECRET_KEY` | Stripe secret key for wallet top-ups |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (frontend) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `TWILIO_ACCOUNT_SID` | Twilio SID for SMS notifications |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Twilio sender phone number |
| `OPEN_EXCHANGE_RATES_APP_ID` | OpenExchangeRates API key for live FX rates |
| `TEMPORAL_ADDRESS` | Temporal server address (e.g. `temporal:7233`) |
| `KYC_SERVICE_URL` | KYC FastAPI service URL (e.g. `http://kyc-service:8000`) |

---

## Local Development

```bash
# Install dependencies
pnpm install

# Push DB schema
pnpm db:push

# Seed demo data
pnpm seed

# Start dev server (hot reload)
pnpm dev
```

The app runs at `http://localhost:3000`.

---

## Production Build

```bash
# Build frontend + backend
pnpm build

# Start production server
pnpm start
```

---

## Docker Deployment

### Single-command stack (app + MySQL + Redis + Nginx)

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your values

# Start all services
docker compose up -d

# Run DB migrations
docker compose exec app pnpm db:push

# Seed demo data (optional)
docker compose exec app pnpm seed
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| `app` | 3000 | RemitFlow Node.js server |
| `mysql` | 3306 | MySQL 8.0 database |
| `redis` | 6379 | Redis 7 cache |
| `nginx` | 80, 443 | Reverse proxy + TLS termination |

---

## Manus Platform Deployment (Recommended)

1. Click the **Publish** button in the Management UI
2. The platform handles TLS, CDN, and scaling automatically
3. Configure your custom domain via Settings → Domains
4. Add secrets via Settings → Secrets

---

## Health Check

The health endpoint is available at:

```
GET /api/trpc/system.health?batch=1&input={"0":{"json":null}}
```

Expected response:
```json
[{"result":{"data":{"json":{"status":"ok","db":true,"timestamp":"...","version":"2.0.0","uptime":123}}}}]
```

Use this URL for load balancer health checks.

---

## Database Migrations

```bash
# Generate and apply migrations
pnpm db:push

# Seed demo data
pnpm seed

# Reset and re-seed (development only)
pnpm seed:reset
```

---

## Smoke Tests

Run the 15-test smoke suite against any environment:

```bash
# Against local dev server
BASE_URL=http://localhost:3000 node scripts/smoke-test.mjs

# Against production
BASE_URL=https://your-domain.com node scripts/smoke-test.mjs
```

Expected: `15/15 tests passed`.

---

## Security Checklist

Before going live, verify:

- [ ] `JWT_SECRET` is a unique 64-character random string (not the default)
- [ ] `DATABASE_URL` uses SSL: append `?ssl={"rejectUnauthorized":true}`
- [ ] `RESEND_API_KEY` is configured for transactional email
- [ ] Stripe keys are production keys (not test keys)
- [ ] Nginx TLS certificates are valid (use Let's Encrypt or Cloudflare)
- [ ] `NODE_ENV=production` is set
- [ ] Rate limiting is active (built-in: 100 req/15min per IP)
- [ ] CORS is restricted to your domain (configured in `server/security.middleware.ts`)

---

## Monitoring

| Endpoint | Purpose |
|----------|---------|
| `/api/trpc/system.health` | Application health + DB connectivity |
| `/api/trpc/system.workerHealth` | Temporal workflow worker status |

---

## Support

- Email: `RESEND_FROM_EMAIL` (configure in secrets)
- Docs: `/docs` directory in the project root
- Security issues: see `docs/SECURITY_AUDIT.md`
